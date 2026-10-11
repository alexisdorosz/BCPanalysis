import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { type ArchiveContent, type CapturedContent, type CollectionRecord, type EventSnapshot, type Player, safeId } from './types.js';

export async function privateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  await chmod(path, 0o700);
}

export async function atomicWrite(path: string, data: string): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, data, { mode: 0o600, flag: 'wx' });
  await rename(temporary, path);
}

export function assertSeparateDirectories(dataDir: string, profileDir: string): void {
  const data = resolve(dataDir), profile = resolve(profileDir);
  const contains = (parent: string, child: string) => child === parent || child.startsWith(parent + sep);
  if (contains(data, profile) || contains(profile, data)) throw new Error('The browser profile and corpus directories must be separate, with neither inside the other.');
}

export class Archive {
  readonly root: string;
  constructor(dataDir: string, readonly eventId: string) { this.root = resolve(dataDir, 'events', safeId(eventId)); }

  async initialise(): Promise<void> {
    await privateDirectory(this.root);
    await privateDirectory(resolve(this.root, 'records'));
    await privateDirectory(resolve(this.root, 'content'));
  }

  private localPath(path: string): string {
    const target = resolve(this.root, path);
    const rel = relative(this.root, target);
    if (!rel || rel.startsWith('..' + sep) || rel === '..' || isAbsolute(rel)) throw new Error('Invalid archive reference.');
    return target;
  }

  async writeEvent(event: EventSnapshot): Promise<void> { await this.writeJson('event.json', event); }
  async readEvent(): Promise<EventSnapshot> { return JSON.parse(await readFile(resolve(this.root, 'event.json'), 'utf8')); }
  async writeJson(path: string, value: unknown): Promise<void> { await atomicWrite(this.localPath(path), JSON.stringify(value, null, 2) + '\n'); }
  async writeText(path: string, value: string): Promise<void> { await atomicWrite(this.localPath(path), value); }

  async readRecord(playerId: string): Promise<CollectionRecord | undefined> {
    try { return JSON.parse(await readFile(resolve(this.root, 'records', `${safeId(playerId)}.json`), 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  }

  async writeRecord(record: CollectionRecord): Promise<void> {
    if (record.eventId !== this.eventId) throw new Error('Record event does not match the archive.');
    await this.writeJson(`records/${safeId(record.player.id)}.json`, record);
  }

  async readContent(record: CollectionRecord): Promise<ArchiveContent | undefined> {
    if (!record.archivePath) return undefined;
    const value: ArchiveContent = JSON.parse(await readFile(this.localPath(record.archivePath), 'utf8'));
    if (value.eventId !== this.eventId || value.playerId !== record.player.id) throw new Error('Archive content association is invalid.');
    const hash = createHash('sha256').update(JSON.stringify(value)).digest('hex');
    if (hash !== record.contentHash) throw new Error('Archive content checksum is invalid.');
    if (record.textPath) {
      const text = await readFile(this.localPath(record.textPath), 'utf8');
      if (text !== value.text) throw new Error('Archived text does not match the captured original.');
    }
    return value;
  }

  async canResume(player: Player, record?: CollectionRecord): Promise<boolean> {
    if (!record || !['collected', 'unsupported'].includes(record.status) || !record.archivePath ||
        player.listId !== record.player.listId || player.listUrl !== record.player.listUrl || player.updatedAt !== record.player.updatedAt) return false;
    try { return !!await this.readContent(record); } catch { return false; }
  }

  async saveContent(player: Player, captured: CapturedContent): Promise<CollectionRecord> {
    const collectedAt = new Date().toISOString();
    const content: ArchiveContent = { schemaVersion: 1, eventId: this.eventId, playerId: player.id, collectedAt, ...captured };
    const contentHash = createHash('sha256').update(JSON.stringify(content)).digest('hex');
    const stem = `content/${safeId(player.id)}-${contentHash}`;
    await this.writeJson(`${stem}.json`, content);
    const textPath = captured.text !== undefined ? `${stem}.txt` : undefined;
    if (textPath) await this.writeText(textPath, captured.text!);
    const record: CollectionRecord = {
      schemaVersion: 1, eventId: this.eventId, player, attemptedAt: collectedAt,
      status: captured.text?.trim() && captured.supports.every(s => s === 'text') ? 'collected' : 'unsupported',
      reason: captured.notices.length ? captured.notices.join(' ') : undefined,
      supports: captured.supports, archivePath: `${stem}.json`, textPath, contentHash,
    };
    await this.writeRecord(record);
    return record;
  }
}
