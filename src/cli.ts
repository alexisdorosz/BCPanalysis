import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { analyseText } from './analysis.js';
import { Archive, assertSeparateDirectories } from './archive.js';
import { importEvent } from './collection-service.js';
import { eventFromUrl } from './bcp.js';
import { writeReport } from './report.js';
import { safeId } from './types.js';

const HELP = `BCP list collector (local, English, no AI)

Usage:
  npm run collect -- <BCP-event-URL> [options]
  npm run report -- <event-id> [--data-dir <directory>]
  npm run inspect -- <text-file> [--faction <name>]
  npm run example

Options:
  --roster-only        Save the public event/roster and an initial report; no browser
  --refresh            Re-read previously archived lists (older originals retained)
  --data-dir <path>    Corpus root (default: ./data)
  --profile-dir <path> Dedicated browser session (default: ./.local/bcp-profile)
  --browser <name>     chrome (installed Google Chrome) or chromium (Playwright)
  --timeout <ms>       Per-request/navigation timeout (default: 30000)
  --faction <name>     Optional known faction for text inspection
  --help              Show this help

Sign in manually in the BCP tab, then click "Continue collection" in the collector
tab. Closing Chrome or clicking "Stop for now" stops the run. Repeat the command
to resume. No passwords, cookies, request headers or session tokens are exported.
`;

function terminal(value: string): string {
  return value.replace(/[\x00-\x1f\x7f-\x9f]/g, ' ');
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      'roster-only': { type: 'boolean', default: false },
      refresh: { type: 'boolean', default: false },
      'data-dir': { type: 'string', default: 'data' },
      'profile-dir': { type: 'string', default: '.local/bcp-profile' },
      browser: { type: 'string', default: 'chrome' },
      timeout: { type: 'string', default: '30000' },
      faction: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help || !positionals.length) {
    console.log(HELP);
    return;
  }
  const [command, target] = positionals;
  if (!target || positionals.length !== 2)
    throw new Error('Expected one command and one URL, event identifier or file. Use --help.');
  const dataDir = resolve(values['data-dir']);
  if (command === 'inspect') {
    const text = await readFile(resolve(target), 'utf8');
    const knownFaction =
      values.faction ?? (target.endsWith('lumineth.txt') ? 'Lumineth Realm-lords' : undefined);
    console.log(JSON.stringify(analyseText(text, knownFaction), null, 2));
    return;
  }
  if (command === 'report') {
    const archive = new Archive(dataDir, safeId(target));
    const event = await archive.readEvent();
    const report = await writeReport(event, archive);
    console.log(`Report: ${resolve(archive.root, 'report.md')}`);
    console.log(JSON.stringify(report.statusCounts));
    return;
  }
  if (command !== 'collect') throw new Error(`Unknown command: ${terminal(command!)}. Use --help.`);
  eventFromUrl(target);
  const timeoutMs = Number(values.timeout);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120000)
    throw new Error('--timeout must be an integer between 1000 and 120000 ms.');
  if (!['chrome', 'chromium'].includes(values.browser))
    throw new Error('--browser must be chrome or chromium.');
  const profileDir = resolve(values['profile-dir']);
  assertSeparateDirectories(dataDir, profileDir);
  const abort = new AbortController();
  const stop = () => abort.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    const event = await importEvent(target, {
      dataDir,
      profileDir,
      refresh: values.refresh,
      rosterOnly: values['roster-only'],
      channel: values.browser as 'chrome' | 'chromium',
      timeoutMs,
      abort,
      progress: (message) => console.log(terminal(message)),
    });
    const report = await writeReport(event, new Archive(dataDir, event.id));
    console.log(JSON.stringify(report.statusCounts));
    if (abort.signal.aborted) process.exitCode = 130;
    else if (
      !values['roster-only'] &&
      (report.statusCounts.error ||
        report.statusCounts.inaccessible ||
        report.statusCounts.pending ||
        report.players.some((item) => item.archiveError))
    )
      process.exitCode = 2;
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    if (abort.signal.aborted) process.exitCode = 130;
  }
}

main().catch((error) => {
  console.error(
    `Collection failed: ${terminal(error instanceof Error ? error.message : String(error))}`,
  );
  console.error(
    'Saved originals remain available. Fix the reported issue, then repeat the command to resume.',
  );
  process.exitCode = process.exitCode === 130 ? 130 : 1;
});
