import { resolve } from 'node:path';
import { Archive, assertSeparateDirectories } from './archive.js';
import { BcpBrowser } from './browser.js';
import { eventFromUrl, fetchEvent, publicClient } from './bcp.js';
import { collectLists, prepareRecords } from './collect.js';
import { writeReport } from './report.js';
import type { EventSnapshot } from './types.js';

export interface ImportOptions {
  dataDir: string;
  profileDir: string;
  refresh?: boolean;
  rosterOnly?: boolean;
  channel?: 'chrome' | 'chromium';
  timeoutMs?: number;
  abort: AbortController;
  progress?: (
    message: string,
    completed: number,
    total: number,
    event?: EventSnapshot,
    login?: boolean,
  ) => void;
}
export async function importEvent(url: string, options: ImportOptions): Promise<EventSnapshot> {
  const { dataDir, profileDir, abort, progress } = options,
    timeoutMs = options.timeoutMs ?? 30000;
  assertSeparateDirectories(resolve(dataDir), resolve(profileDir));
  eventFromUrl(url);
  progress?.('Reading the complete public roster…', 0, 0);
  const event = await fetchEvent(url, publicClient(timeoutMs, abort.signal));
  const archive = new Archive(dataDir, event.id);
  await archive.initialise();
  await archive.writeEvent(event);
  await prepareRecords(event, archive, options.refresh);
  await writeReport(event, archive);
  progress?.(`${event.players.length} players. Collecting lists…`, 0, event.players.length, event);
  if (options.rosterOnly) return event;
  let completed = 0,
    waitingForLogin = false;
  const browser = new BcpBrowser({
    profileDir,
    channel: options.channel ?? 'chrome',
    timeoutMs,
    eventUrl: event.url,
    signal: abort.signal,
    onStop: () => abort.abort(),
    log: (message) => {
      if (/waiting for you/.test(message)) waitingForLogin = true;
      progress?.(message, completed, event.players.length, event, waitingForLogin);
    },
  });
  try {
    await collectLists(event, archive, {
      refresh: options.refresh,
      signal: abort.signal,
      readList: (player, target) => browser.readList(player, target),
      authenticate: (reason) => browser.authenticate(reason),
      onRecord: async (record, resumed) => {
        completed++;
        waitingForLogin = false;
        await writeReport(event, archive);
        progress?.(
          `[${resumed ? 'saved' : record.status}] ${record.player.name}${record.reason ? ' — ' + record.reason : ''}`,
          completed,
          event.players.length,
          event,
        );
      },
    });
  } finally {
    await browser.close();
    await writeReport(event, archive);
  }
  return event;
}
