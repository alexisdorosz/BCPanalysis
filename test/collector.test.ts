import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { analyseText } from '../src/analysis.js';
import { Archive, assertSeparateDirectories } from '../src/archive.js';
import { eventFromUrl, fetchEvent, fetchRoster, listPageUrl } from '../src/bcp.js';
import { collectLists, prepareRecords } from '../src/collect.js';
import { captureContent } from '../src/content.js';
import { writeReport } from '../src/report.js';
import { type EventSnapshot, type Player } from '../src/types.js';

const player = (id: string): Player => ({ id, name: `Player ${id}`, faction: 'Lumineth Realm-lords', dropped: false, listId: `list-${id}`, listUrl: `/list/list-${id}`, updatedAt: '2026-10-09' });
const event = (players: Player[]): EventSnapshot => ({ schemaVersion: 1, id: 'event-1', name: 'Test event', url: 'https://www.bestcoastpairings.com/event/event-1?active_tab=roster', collectedAt: '2026-10-09T00:00:00Z', metadata: {}, players });
const fixture = await readFile(new URL('../fixtures/lumineth.txt', import.meta.url), 'utf8');

async function withArchive(fn: (archive: Archive) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(resolve(tmpdir(), 'bcp-test-'));
  try { const archive = new Archive(directory, 'event-1'); await archive.initialise(); await fn(archive); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

test('event URLs reject foreign hosts, credentials and unsafe paths; query is canonicalised', () => {
  assert.equal(eventFromUrl('https://bestcoastpairings.com/event/RpBCJzCBsTCO?active_tab=roster').id, 'RpBCJzCBsTCO');
  for (const value of ['https://evil.example/event/abc', 'http://bestcoastpairings.com/event/abc', 'https://u:p@bestcoastpairings.com/event/abc', 'https://bestcoastpairings.com/event/a/b', 'https://bestcoastpairings.com:123/event/a']) {
    assert.throws(() => eventFromUrl(value));
  }
  assert.equal(listPageUrl({ ...player('a'), listUrl: '/list/other' }).kind, 'invalid');
  assert.equal(listPageUrl({ ...player('a'), listUrl: 'javascript:alert(1)' }).kind, 'invalid');
  assert.equal(listPageUrl({ ...player('a'), listUrl: 'https://external.example/list.pdf' }).kind, 'external');
});

test('roster follows cursors, de-duplicates players and accepts an empty terminal page with a cursor', async () => {
  const calls: (Record<string, string> | undefined)[] = [];
  const pages = [
    { data: [{ id: 'a', user: { firstName: 'Alice' }, listId: 'list-a' }], nextKey: 'cursor+1=' },
    { data: [{ id: 'a', user: { firstName: 'Alice updated' }, listId: 'list-a' }, { id: 'b', listUrl: '/list/list-b' }], nextKey: 'cursor2' },
    { data: [], nextKey: 'cursor2' },
  ];
  const roster = await fetchRoster('event-1', async (path, params) => { assert.equal(path, '/players'); calls.push(params); return pages[calls.length - 1]; });
  assert.equal(roster.length, 2);
  assert.equal(roster[0]?.name, 'Alice updated');
  assert.equal(roster[1]?.listId, 'list-b');
  assert.equal(calls[1]?.nextKey, 'cursor+1=');
  assert.equal(calls[2]?.nextKey, 'cursor2');
});

test('non-empty repeated cursors and malformed rosters fail rather than claim completeness', async () => {
  await assert.rejects(fetchRoster('event-1', async () => ({ data: [{ id: 'a' }], nextKey: 'same' })), /repeated/);
  await assert.rejects(fetchRoster('event-1', async () => ({ players: [] })), /data/);
  await assert.rejects(fetchEvent('https://bestcoastpairings.com/event/event-1', async () => ({ id: 'event-1', hideRoster: true })), /hidden/);
});

test('capture validates player/list/event associations and excludes credentials/account expansions', () => {
  const payload = {
    id: 'list-a', playerId: 'a', eventId: 'event-1', armyListText: fixture,
    armyListToken: 'private', accessToken: 'private', user: { email: 'private@example.com' },
    event: { id: 'event-1', description: 'not list content' }, listInfo: { listText: fixture, token: 'private' },
  };
  const result = captureContent(payload, player('a'), 'event-1');
  assert.equal(result.text, fixture);
  assert.equal(result.original.armyListText, fixture);
  assert.ok(!JSON.stringify(result).includes('private'));
  assert.ok(!('user' in result.original));
  assert.deepEqual(result.supports, ['text']);
  assert.throws(() => captureContent({ ...payload, id: 'list-b' }, player('a'), 'event-1'), /identifier/);
  assert.throws(() => captureContent({ ...payload, playerId: 'b' }, player('a'), 'event-1'), /player/);
  assert.throws(() => captureContent({ ...payload, eventId: 'other' }, player('a'), 'event-1'), /event/);
});

test('image/file references, different text fields and unfamiliar content remain observable', () => {
  const result = captureContent({
    armyListText: fixture, listText: 'different text', armyListImages: ['https://example.com/image.png'],
    listInfo: { listImageFiles: [{ imageURL: 'https://example.com/other.png' }], listFiles: [{ url: 'https://example.com/list.pdf' }] },
  }, player('a'), 'event-1');
  assert.equal(result.textVariants.length, 2);
  assert.ok(result.supports.includes('image'));
  assert.ok(result.supports.includes('file'));
  assert.ok(result.attachments.some(a => a.kind === 'file' && a.url.endsWith('list.pdf')));
  assert.ok(result.notices.some(notice => notice.includes('Multiple')));
  assert.deepEqual(captureContent({ listFutureFormat: { anything: 123 } }, player('a'), 'event-1').supports, ['unknown']);
  assert.deepEqual(captureContent({ armyListText: fixture, armyListContent: {}, armyListImages: [] }, player('a'), 'event-1').supports, ['text']);
  const unknown = captureContent({ unfamiliarBody: { rows: ['a', 'b'] } }, player('a'), 'event-1');
  assert.deepEqual(unknown.original.unfamiliarBody, { rows: ['a', 'b'] });
  assert.equal(unknown.payloadShape['unfamiliarBody.rows'], 'array');
  assert.ok(captureContent({ listInfo: { listFiles: [{ fileId: 'opaque' }] } }, player('a'), 'event-1').supports.includes('file'));
});

test('Lumineth reference preserves all lines and modifier associations without summing extra costs', () => {
  const result = analyseText(fixture, 'Lumineth Realm-lords');
  assert.equal(result.source, 'official-app');
  assert.equal(result.language, 'English');
  assert.equal(result.counts['unit-candidate'], 7);
  assert.equal(result.counts.reinforcement, 3);
  const scinari = result.lines.find(line => line.raw === 'Scinari Enlightener (180)')!;
  for (const text of ['• Silver Wand', '• Acolyte of the Runes']) assert.equal(result.lines.find(line => line.raw === text)?.parentLine, scinari.number);
  const wardens = result.lines.find(line => line.raw === 'Vanari Auralan Wardens (260)')!;
  const patient = result.lines.find(line => line.raw === '• Patient Strike - (20) Points')!;
  assert.equal(patient.parentLine, wardens.number);
  assert.deepEqual(patient.pointValues, [20]);
  assert.ok(result.ambiguities.some(item => item.line === patient.number));
  assert.deepEqual(result.lines.map(line => line.raw), fixture.split('\n'));
  assert.equal(analyseText(fixture.replaceAll('\n', '\r\n')).lineEnding, 'CRLF');
});

test('unfamiliar formats and orphan options are flagged instead of attaching to an older candidate', () => {
  const result = analyseText('Title\nRegiment 1\nKnown unit (100)\nUnknown syntax 2 x models\n• Reinforced\n');
  assert.equal(result.source, 'unknown');
  assert.equal(result.lines[4]?.parentLine, undefined);
  assert.ok(result.ambiguities.some(item => item.line === 4));
  assert.ok(result.ambiguities.some(item => item.line === 5));
});

test('observed manual syntax and Octolith markers are inventoried; separators/version numbers do not become terrain costs', () => {
  const text = "Title\n--- General's Regiment ---\nExample unit -- 100\nAnother unit (100) • Reinforced\nFaction terrain : Example\nCréé avec 0ctolith, v:2.63.8\nundefined\n";
  const result = analyseText(text);
  assert.equal(result.source, 'octolith');
  for (const kind of ['decorated-regiment-heading', 'dash-point-cost', 'inline-option', 'inline-terrain', 'literal-placeholder']) {
    assert.ok(result.observations.some(observation => observation.kind === kind));
  }
  const terrain = analyseText("Title\nFaction Terrain\nExample terrain\n-----\nCreated with Warhammer Age of Sigmar: The App\nApp: v1.38.0 (1) | Data: v483\nundefined\n");
  assert.equal(terrain.counts['terrain-candidate'], 1);
  assert.equal(terrain.lines[3]?.kind, 'separator');
  assert.equal(terrain.lines[5]?.pointValues, undefined);
  assert.equal(terrain.lines[6]?.kind, 'placeholder');
});

test('archive round-trips exact CRLF text, retains old captures and detects corruption before resuming', async () => withArchive(async archive => {
  assert.throws(() => assertSeparateDirectories('/tmp/corpus', '/tmp/corpus/session'), /separate/);
  const p = player('a');
  const text = fixture.replaceAll('\n', '\r\n');
  const first = await archive.saveContent(p, captureContent({ armyListText: text }, p, 'event-1'));
  assert.equal(await readFile(resolve(archive.root, first.textPath!), 'utf8'), text);
  assert.equal((await archive.readContent(first))?.text, text);
  assert.equal(await archive.canResume(p, first), true);
  assert.equal(await archive.canResume({ ...p, updatedAt: 'later' }, first), false);
  const second = await archive.saveContent(p, captureContent({ armyListText: 'new text' }, p, 'event-1'));
  assert.notEqual(first.archivePath, second.archivePath);
  assert.equal((await archive.readContent(first))?.text, text);
  await writeFile(resolve(archive.root, second.textPath!), 'corrupted');
  assert.equal(await archive.canResume(p, second), false);
  await assert.rejects(archive.readContent(second), /text/);
}));

test('collection checkpoints successes, missing lists, external links and denials; resume skips intact originals', async () => withArchive(async archive => {
  const e = event([player('a'), { ...player('b'), listId: undefined, listUrl: undefined }, { ...player('c'), listId: undefined, listUrl: 'https://example.com/list.pdf' }, player('d')]);
  await archive.writeEvent(e); await prepareRecords(e, archive);
  const calls: string[] = [];
  const readList = async (p: Player) => { calls.push(p.id); return p.id === 'd' ? { status: 'denied' as const, httpStatus: 403, reason: 'Denied' } : { status: 'ok' as const, payload: { id: p.listId, playerId: p.id, armyListText: fixture } }; };
  await collectLists(e, archive, { readList, authenticate: async () => { throw new Error('403 must not initiate authentication'); } });
  assert.deepEqual(calls, ['a', 'd']);
  assert.equal((await archive.readRecord('a'))?.status, 'collected');
  assert.equal((await archive.readRecord('b'))?.status, 'absent');
  assert.equal((await archive.readRecord('c'))?.status, 'unsupported');
  assert.equal((await archive.readRecord('d'))?.status, 'inaccessible');
  calls.length = 0;
  await prepareRecords(e, archive);
  await collectLists(e, archive, { readList, authenticate: async () => true });
  assert.deepEqual(calls, ['d']);
  const report = await writeReport(e, archive);
  assert.deepEqual(report.statusCounts, { pending: 0, collected: 1, absent: 1, inaccessible: 1, unsupported: 1, error: 0 });
  assert.equal(report.formats.length, 1);
  assert.equal(report.players[0]?.analysis?.counts['unit-candidate'], 7);
}));

test('expired session gets one manual reauthentication and retry; later 401s remain inaccessible', async () => withArchive(async archive => {
  const e = event([player('a'), player('b')]); await prepareRecords(e, archive);
  let calls = 0, prompts = 0;
  await collectLists(e, archive, {
    readList: async () => (++calls === 2 ? { status: 'ok', payload: { armyListText: fixture } } : { status: 'denied', httpStatus: 401, loginRequired: true }),
    authenticate: async () => { prompts++; return true; },
  });
  assert.equal(prompts, 1); assert.equal(calls, 3);
  assert.equal((await archive.readRecord('a'))?.status, 'collected');
  assert.equal((await archive.readRecord('b'))?.status, 'inaccessible');
}));

test('interruption preserves completed lists; authentication cancellation keeps remaining lists pending', async () => withArchive(async archive => {
  const e = event([player('a'), player('b')]); await prepareRecords(e, archive);
  const abort = new AbortController();
  await collectLists(e, archive, {
    signal: abort.signal, readList: async () => ({ status: 'ok', payload: { armyListText: fixture } }), authenticate: async () => true,
    onRecord: async () => abort.abort(),
  });
  assert.equal((await archive.readRecord('a'))?.status, 'collected');
  assert.equal((await archive.readRecord('b'))?.status, 'pending');
  await collectLists(e, archive, {
    readList: async () => ({ status: 'denied', httpStatus: 401, loginRequired: true }), authenticate: async () => false,
  });
  assert.equal((await archive.readRecord('b'))?.status, 'pending');
}));

test('hidden lists are not opened, mixed supports are inventoried and empty corpora do not count the fixture', async () => withArchive(async archive => {
  const e = event([player('a')]); e.metadata.hideLists = true; await prepareRecords(e, archive);
  await collectLists(e, archive, { readList: async () => { throw new Error('Hidden list was opened'); }, authenticate: async () => true });
  assert.equal((await archive.readRecord('a'))?.status, 'inaccessible');
  const emptyReport = await writeReport(e, archive); assert.equal(emptyReport.formats.length, 0);
  const record = await archive.saveContent(player('a'), captureContent({ armyListText: fixture, armyListImages: ['https://example.com/image.png'] }, player('a'), 'event-1'));
  assert.equal(record.status, 'unsupported');
  assert.equal((await writeReport(e, archive)).formats.length, 1);
}));
