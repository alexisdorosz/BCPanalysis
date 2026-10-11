import { Archive } from './archive.js';
import { listsHidden, listPageUrl } from './bcp.js';
import { captureContent } from './content.js';
import { type CollectionRecord, type EventSnapshot, type Player, type ReadResult } from './types.js';

export interface CollectorOptions {
  readList: (player: Player, url: string) => Promise<ReadResult>;
  authenticate: (reason: string) => Promise<boolean>;
  refresh?: boolean;
  signal?: AbortSignal;
  onRecord?: (record: CollectionRecord, resumed: boolean) => Promise<void>;
}

export function pendingRecord(event: EventSnapshot, player: Player): CollectionRecord {
  return { schemaVersion: 1, eventId: event.id, player, status: 'pending', attemptedAt: new Date().toISOString() };
}

export async function prepareRecords(event: EventSnapshot, archive: Archive, refresh = false): Promise<void> {
  for (const player of event.players) {
    const previous = await archive.readRecord(player.id);
    if (!refresh && await archive.canResume(player, previous)) {
      await archive.writeRecord({ ...previous!, player });
    } else await archive.writeRecord(pendingRecord(event, player));
  }
}

export async function collectLists(event: EventSnapshot, archive: Archive, options: CollectorOptions): Promise<void> {
  let recoveredSession = false;
  for (const player of event.players) {
    if (options.signal?.aborted) break;
    const previous = await archive.readRecord(player.id);
    if (!options.refresh && await archive.canResume(player, previous)) {
      await options.onRecord?.(previous!, true); continue;
    }
    let record = pendingRecord(event, player);
    const link = listPageUrl(player);
    if (!player.listId && !player.listUrl) {
      record = { ...record, status: 'absent', reason: 'No list identifier or link was provided by BCP.' };
    } else if (listsHidden(event)) {
      record = { ...record, status: 'inaccessible', reason: 'The event marks its lists as hidden. No list page was opened.' };
    } else if (link.kind === 'external') {
      record = await archive.saveContent(player, captureContent({ listUrl: link.url }, player, event.id));
    } else if (link.kind === 'invalid' || !player.listId) {
      record = { ...record, status: 'error', reason: 'The roster contains an invalid, conflicting or unsupported BCP list link.' };
    } else {
      try {
        let result = await options.readList(player, link.url!);
        if (result.loginRequired && !recoveredSession && !options.signal?.aborted) {
          recoveredSession = true;
          const continued = await options.authenticate('BCP requires authentication. Sign in again, then continue; the current list will be retried once.');
          if (!continued || options.signal?.aborted) break;
          result = await options.readList(player, link.url!);
        }
        if (options.signal?.aborted) break;
        if (result.status === 'ok') record = await archive.saveContent(player, captureContent(result.payload, player, event.id));
        else record = {
          ...record, status: result.status === 'denied' ? 'inaccessible' : 'error',
          reason: result.reason ?? 'The list could not be read.', httpStatus: result.httpStatus,
        };
      } catch (error) {
        if (options.signal?.aborted) break;
        record = { ...record, status: 'error', reason: (error as Error).message };
      }
    }
    await archive.writeRecord(record);
    await options.onRecord?.(record, false);
  }
}
