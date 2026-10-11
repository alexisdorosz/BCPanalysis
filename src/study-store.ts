import { createHash, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Archive, atomicWrite, privateDirectory } from './archive.js';
import { parseList } from './parse-list.js';
import type { Study } from './study-types.js';
import type { ArchiveContent } from './types.js';
import { safeId } from './types.js';

export function contentFingerprint(content: ArchiveContent): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        text: content.text,
        textVariants: content.textVariants,
        attachments: content.attachments,
        supports: content.supports,
      }),
    )
    .digest('hex');
}
export class StudyStore {
  constructor(readonly dataDir: string) {}
  archive(eventId: string): Archive {
    return new Archive(this.dataDir, safeId(eventId));
  }
  private folder(eventId: string, playerId: string): string {
    return resolve(this.archive(eventId).root, 'studies', safeId(playerId));
  }
  async events() {
    let directories;
    try {
      directories = await readdir(resolve(this.dataDir, 'events'), { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const events = [];
    for (const directory of directories)
      if (directory.isDirectory() && /^[a-zA-Z0-9_-]+$/.test(directory.name)) {
        try {
          const event = await this.archive(directory.name).readEvent();
          events.push({
            id: event.id,
            name: event.name,
            url: event.url,
            collectedAt: event.collectedAt,
            playerCount: event.players.length,
          });
        } catch {
          /* Incomplete imports do not appear until event.json exists. */
        }
      }
    return events.sort((a, b) => b.collectedAt.localeCompare(a.collectedAt));
  }
  async player(eventId: string, playerId: string) {
    const archive = this.archive(eventId),
      event = await archive.readEvent();
    const player = event.players.find((item) => item.id === safeId(playerId));
    if (!player) throw new Error('Player not found in this tournament.');
    const record = await archive.readRecord(playerId),
      content = record ? await archive.readContent(record) : undefined;
    const hash = content ? contentFingerprint(content) : undefined;
    let study: Study | undefined;
    try {
      study = JSON.parse(
        await readFile(resolve(this.folder(eventId, playerId), 'latest.json'), 'utf8'),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const stale = !!study && study.contentHash !== hash;
    return {
      player,
      record,
      content,
      contentHash: hash,
      parsed: content?.text ? parseList(content.text, player.faction) : undefined,
      study: stale ? undefined : study,
      stale,
    };
  }
  async roster(eventId: string) {
    const event = await this.archive(eventId).readEvent();
    const players = await Promise.all(
      event.players.map(async (player) => {
        try {
          const detail = await this.player(eventId, player.id);
          return {
            ...player,
            faction:
              detail.study?.resolutions.find(
                (entry) => entry.kind === 'faction' && entry.status === 'resolved',
              )?.selected?.name ??
              detail.parsed?.faction ??
              player.faction,
            status: detail.record?.status ?? 'pending',
            studyStatus: detail.stale ? 'outdated' : detail.study?.status,
            reason: detail.record?.reason,
          };
        } catch (error) {
          return {
            ...player,
            status: 'error',
            studyStatus: undefined,
            reason: (error as Error).message,
          };
        }
      }),
    );
    return { ...event, players };
  }
  async save(study: Study): Promise<void> {
    const current = await this.player(study.eventId, study.playerId);
    if (current.contentHash !== study.contentHash)
      throw new Error(
        'The BCP list changed during generation. Generate again from the new content.',
      );
    const folder = this.folder(study.eventId, study.playerId);
    await privateDirectory(folder);
    const json = JSON.stringify(study, null, 2) + '\n';
    await atomicWrite(
      resolve(folder, `${study.contentHash}-${Date.now()}-${randomUUID()}.json`),
      json,
    );
    await atomicWrite(resolve(folder, 'latest.json'), json);
  }
  async mappings(eventId: string, playerId: string): Promise<Record<string, string>> {
    try {
      return JSON.parse(
        await readFile(resolve(this.folder(eventId, playerId), 'mappings.json'), 'utf8'),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw error;
    }
  }
  async confirm(eventId: string, playerId: string, entryId: string, key: string): Promise<void> {
    const detail = await this.player(eventId, playerId),
      resolution = detail.study?.resolutions.find((item) => item.entryId === entryId);
    if (!resolution?.candidates.some((item) => item.key === key))
      throw new Error('Choose a candidate from the current study sheet.');
    const mappings = await this.mappings(eventId, playerId);
    mappings[resolution.kind + ':' + resolution.label] = key;
    const folder = this.folder(eventId, playerId);
    await privateDirectory(folder);
    await atomicWrite(resolve(folder, 'mappings.json'), JSON.stringify(mappings, null, 2) + '\n');
  }
}
