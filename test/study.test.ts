import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseList, normaliseName } from '../src/parse-list.js';
import { extractRules, extractWarscroll, rulesFor, SourceSession, NAV } from '../src/wahapedia.js';
import { generateStudy, resolveEntry } from '../src/generate-study.js';
import { StudyStore } from '../src/study-store.js';
import { createApi } from '../src/api.js';
import { BASE, army, fixtureSources, scroll, seedEvent, ability } from './study-fixtures.js';

async function setup(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'bcp-study-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new StudyStore(dir);
  await seedEvent(dir);
  return { dir, store, sources: fixtureSources() };
}
test('official reference: preserve original lines, explicit counts, extra costs and unit associations', async () => {
  const raw = await readFile('fixtures/lumineth.txt', 'utf8'),
    parsed = parseList(raw, 'Lumineth Realm-lords');
  assert.equal(parsed.raw, raw);
  assert.equal(parsed.units.length, 7);
  assert.equal(parsed.points, 1960);
  assert.equal(parsed.drops, 2);
  assert.equal(parsed.formation, 'Warhost of Duality');
  assert.equal(parsed.units.find((unit) => unit.name === 'Scinari Enlightener')?.options.length, 2);
  assert.equal(parsed.choices.find((choice) => choice.name === 'Patient Strike')?.points, 20);
  const inline = parseList(army);
  assert.equal(inline.units[1]?.explicitCount, 20);
  assert.equal(inline.units[1]?.reinforced, true);
  assert.notEqual(inline.units[1]?.id, inline.units[2]?.id);
});
test('nested common traits retain prerequisite text, tables and their own context', () => {
  const source = { url: BASE + 'factions/example', fetchedAt: 'now', hash: 'hash' };
  const page = extractRules({
    source,
    html: `<div id="wahMainContent"><h2 id="Battle-Traits">Battle Traits</h2>Choose a facet before using these abilities.<h3 id="Facet-Wind">Facet of Wind</h3>Only when this facet is active.${ability('WIND RULE', 'Apply the listed result.')}<h2 id="Battle-Formations">Battle Formations</h2><h3 id="Unchosen">Unchosen</h3>${ability('UNRELATED', 'Must not appear.')}</div>`,
  });
  const rules = rulesFor(
    page.entries.find((entry) => entry.name === 'Battle Traits')!,
    page,
    source,
  );
  assert(rules.some((rule) => rule.text.includes('Choose a facet')));
  assert(rules.some((rule) => rule.text.includes('Only when this facet')));
  assert(rules.some((rule) => rule.name === 'WIND RULE'));
  assert(!rules.some((rule) => rule.name === 'UNRELATED'));
});
test('manual, War Nexus and Octolith syntax; auxiliary and renown entries; unknown lines stay visible', () => {
  const parsed = parseList(
    `Manual\nFaction: Sons of Behemat\nFormation: Eager Louts\n2000/2000 pts\nDomaine de sorts : Lore of Ruin\n--- General's Regiment ---\nGatebreaker Mega-Gargant (Scourge of Aqshy) (500 pts) • General\nRegiment #1 :\n6x Rockgut Troggoths -- 360\n-- Reinforced\n-- Loontouched -- 20\nAuxiliary Units\nGrey Seer 100\nRegiments of Renown\nGodmarked Ascendant (240)\nDaemon Prince\n• Witherstave\n42 ???\nCréé avec 0ctolith, v:2.63.8`,
  );
  assert.equal(parsed.units.length, 5);
  assert.equal(parsed.units[1]?.explicitCount, 6);
  assert.equal(parsed.units[1]?.options[0]?.points, 20);
  assert.equal(parsed.regiments[2]?.kind, 'auxiliary');
  assert.equal(parsed.regiments[3]?.kind, 'renown');
  assert.equal(parsed.units[4]?.componentOf, parsed.units[3]?.id);
  assert.equal(parsed.unparsed[0]?.raw, '42 ???');
  assert.equal(parsed.choices[1]?.kind, 'spell-lore');
  const war = parseList(
    'War list\nSkaven | Claw-horde\n--- General’s Regiment ---\n3x Ratling Guns (160 pts) • Reinforced • General\nCreated with War Nexus\nApp Version: 24.0.3',
  );
  assert.equal(war.units[0]?.name, 'Ratling Guns');
  assert.equal(war.unparsed.length, 0);
});
test('variants remain distinct and only exact matches resolve automatically', () => {
  assert.equal(normaliseName('SoA Grey Seer'), normaliseName('Grey Seer (Scourge of Aqshy)'));
  const catalog = [
    { key: 'a', name: 'Grey Seer', url: BASE + 'normal' },
    { key: 'b', name: 'Scourge of Aqshy Grey Seer', url: BASE + 'variant' },
  ];
  assert.equal(resolveEntry('u', 'SoA Grey Seer', 'unit', catalog, {}).selected?.key, 'b');
  assert.equal(resolveEntry('u', 'Grey Seer', 'unit', catalog, {}).selected?.key, 'a');
  assert.equal(resolveEntry('u', 'SoA Grey Seer', 'unit', [catalog[0]!], {}).status, 'missing');
});
test('multiple faction contexts exclude unrelated modes and scripts; flavor stays separate from operative facts', async () => {
  const sources = fixtureSources();
  for (const faction of ['skaven', 'lumineth-realm-lords']) {
    const rules = extractRules(await sources.loader(BASE + 'factions/' + faction));
    assert.equal(rules.rules.length, 5);
    assert(!rules.rules.some((rule) => /SPEARHEAD|PATH RULE/.test(rule.name)));
  }
  const warscroll = extractWarscroll({
    html: scroll('Ratling Guns'),
    source: { url: BASE + 'factions/skaven/Ratling-Guns', hash: 'hash', fetchedAt: 'now' },
  });
  assert.equal(warscroll.weapons.length, 1);
  assert.equal(warscroll.rules.length, 1);
  assert.equal(warscroll.control, '1');
  assert.equal(warscroll.ward, '5+');
  assert.equal(warscroll.unitSize, 3);
  assert(!JSON.stringify(warscroll).includes('advertisement'));
  assert(!warscroll.rules.some((rule) => rule.text.includes('narrative')));
  assert(JSON.stringify(warscroll.rules[0]?.presentation).includes('narrative'));
  assert(warscroll.notes.join(' ').includes('Must use'));
});
test('generation uses common lore and card context, deduplicates pages, and never doubles explicit reinforced counts', async (t) => {
  const { store, sources } = await setup(t);
  const sheet = await generateStudy(store, 'event-one', 'player-one', { loader: sources.loader });
  assert.equal(sheet.status, 'partial');
  assert.equal(sheet.armyRules.length, 1);
  assert(!sheet.armyRules.some((rule) => rule.name === 'OTHER ARMY'));
  assert(
    sheet.selectedRules
      .find((item) => item.choice.kind === 'battle-tactics')
      ?.rules.some((rule) => rule.text.includes('choose a hideout')),
  );
  assert.equal(
    sheet.selectedRules.find((item) => item.choice.kind === 'manifestation-lore')?.warscrolls
      ?.length,
    1,
  );
  assert.equal(sheet.units[2]?.modelCount, 3);
  assert.equal(sheet.units[2]?.countSource, 'declared');
  assert.equal(sources.requests.length, new Set(sources.requests).size);
  const resolution = sheet.resolutions.find((item) => item.label === 'Ratling')!;
  assert.equal(resolution.status, 'ambiguous');
  assert.equal(resolution.candidates.length, 2);
  await store.confirm(
    'event-one',
    'player-one',
    resolution.entryId,
    resolution.candidates.find((candidate) => candidate.name === 'Ratling Guns')!.key,
  );
  sources.requests.length = 0;
  const regenerated = await generateStudy(store, 'event-one', 'player-one', {
    loader: sources.loader,
  });
  assert.equal(regenerated.units[1]?.modelCount, 20);
  assert.equal(regenerated.units[1]?.countSource, 'declared');
  assert.equal(regenerated.status, 'ready');
  assert.equal(sources.requests.filter((url) => url.endsWith('/Ratling-Guns')).length, 1);
});
test('confirmed source disappearance requires a new decision; current source hashes are checked on regeneration', async (t) => {
  const { store, sources } = await setup(t);
  const sheet = await generateStudy(store, 'event-one', 'player-one', { loader: sources.loader });
  const match = sheet.resolutions.find((item) => item.label === 'Ratling')!;
  await store.confirm('event-one', 'player-one', match.entryId, match.candidates[0]!.key);
  sources.bump();
  const next = await generateStudy(store, 'event-one', 'player-one', { loader: sources.loader });
  assert.notEqual(next.sources[0]?.hash, sheet.sources[0]?.hash);
  const menu = BASE + 'factions/skaven/armylist.html';
  sources.pages.set(menu, sources.pages.get(menu)!.replace(/<a[^>]*>Ratling Guns<\/a>/, ''));
  const changed = await generateStudy(store, 'event-one', 'player-one', { loader: sources.loader });
  assert.notEqual(changed.resolutions.find((item) => item.label === 'Ratling')?.status, 'resolved');
});
test('regiments of renown expose included cross-faction unit links without changing army faction', async (t) => {
  const { dir, store, sources } = await setup(t);
  await seedEvent(
    dir,
    'renown-event',
    'RoR list\nSkaven | Claw-horde\nRegiments of Renown\nGodmarked Ascendant (240)\nDaemon Prince',
  );
  const sheet = await generateStudy(store, 'renown-event', 'player-one', {
    loader: sources.loader,
  });
  assert.equal(sheet.units.filter((unit) => unit.warscroll).length, 2);
  assert.equal(sheet.units[1]?.warscroll?.name, 'Daemon Prince');
  assert.equal(sheet.parsed.faction, 'Skaven');
});
test('army of renown uses its own traits and excludes ordinary faction enhancements', async (t) => {
  const { dir, store, sources } = await setup(t);
  await seedEvent(
    dir,
    'renown-army',
    "Renown\nSkaven | Different Army\nGeneral's Regiment\nGrey Seer (100)\n• Silver Wand",
  );
  const sheet = await generateStudy(store, 'renown-army', 'player-one', { loader: sources.loader });
  assert.equal(sheet.armyRules.length, 1);
  assert.equal(sheet.armyRules[0]?.name, 'OTHER ARMY');
  assert.equal(sheet.units[0]?.optionRules.length, 0);
});
test('undeclared battlepack discovers current handbook; inferred reinforced counts are labelled', async (t) => {
  const { dir, store, sources } = await setup(t);
  await seedEvent(
    dir,
    'current-pack',
    "Current list\nSkaven | Claw-horde\nBattle Tactic Cards: Blazing Onslaught & Siege of Ashes\nGeneral's Regiment\nRatling Guns (320)\n• Reinforced",
  );
  const sheet = await generateStudy(store, 'current-pack', 'player-one', {
    loader: sources.loader,
  });
  assert.equal(sheet.units[0]?.modelCount, 6);
  assert.equal(sheet.units[0]?.countSource, 'inferred');
  assert.equal(
    sheet.selectedRules.find((item) => item.choice.kind === 'battle-tactics')?.rules.length,
    2,
  );
});
test('archives: independent tournaments, stable content fingerprint, changed-list invalidation, offline sheets and failed refresh retention', async (t) => {
  const { dir, store, sources } = await setup(t);
  await seedEvent(dir, 'event-two', army.replace('1980', '1990'));
  const sheet = await generateStudy(store, 'event-one', 'player-one', { loader: sources.loader });
  await seedEvent(dir);
  assert.equal(
    (await store.player('event-one', 'player-one')).study?.contentHash,
    sheet.contentHash,
  );
  assert.equal((await store.player('event-two', 'player-one')).study, undefined);
  assert.equal((await store.events()).length, 2);
  sources.offline(true);
  assert((await store.player('event-one', 'player-one')).study);
  await assert.rejects(
    generateStudy(store, 'event-one', 'player-one', { loader: sources.loader }),
    /outage/,
  );
  assert.equal(
    (await store.player('event-one', 'player-one')).study?.generatedAt,
    sheet.generatedAt,
  );
  await seedEvent(dir, 'event-one', army.replace('1980', '1970'));
  const updated = await store.player('event-one', 'player-one');
  assert.equal(updated.stale, true);
  assert.equal(updated.study, undefined);
});
test('source session respects cancellation and HTTPS host/path boundaries', async () => {
  const sources = fixtureSources(),
    session = new SourceSession(sources.loader);
  await Promise.all([session.get(NAV), session.get(NAV)]);
  assert.equal(sources.requests.length, 1);
  assert.throws(() => session.get('https://example.com/aos4/nav.html'));
  assert.throws(() => session.get('https://wahapedia.ru/wh40k10/nav.html'));
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(new SourceSession(sources.loader, abort.signal).get(NAV));
});
test('local API validates origins, supports job progress, generation and cancellation', async (t) => {
  const { dir, sources } = await setup(t);
  const api = createApi({
    dataDir: dir,
    profileDir: join(dir, '../profile'),
    loader: sources.loader,
  });
  t.after(() => api.close());
  assert.equal(
    (await api.inject({ url: '/api/events', headers: { host: 'evil.example' } })).statusCode,
    403,
  );
  assert.equal(
    (
      await api.inject({
        method: 'POST',
        url: '/api/imports',
        headers: { host: '127.0.0.1:4310', origin: 'https://evil.example' },
        payload: { url: 'https://www.bestcoastpairings.com/event/event-one' },
      })
    ).statusCode,
    403,
  );
  const headers = { host: '127.0.0.1:4310' };
  assert.equal((await api.inject({ url: '/api/events', headers })).json().length, 1);
  const response = await api.inject({
    method: 'POST',
    url: '/api/events/event-one/players/player-one/generate',
    headers,
    payload: {},
  });
  assert.equal(response.statusCode, 202);
  for (let attempt = 0; attempt < 100; attempt++) {
    const jobs = (await api.inject({ url: '/api/jobs', headers })).json();
    if (jobs[0]?.finishedAt) {
      assert.equal(jobs[0].state, 'completed');
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert(
    (await api.inject({ url: '/api/events/event-one/players/player-one', headers })).json().study,
  );
  const cancelApi = createApi({
    dataDir: dir,
    profileDir: join(dir, '../profile'),
    importer: async (_url, options) => {
      await new Promise<void>((resolve) =>
        options.abort.signal.addEventListener('abort', () => resolve(), { once: true }),
      );
      return await new StudyStore(dir).archive('event-one').readEvent();
    },
  });
  t.after(() => cancelApi.close());
  const job = (
    await cancelApi.inject({
      method: 'POST',
      url: '/api/imports',
      headers,
      payload: { url: 'https://www.bestcoastpairings.com/event/event-one' },
    })
  ).json();
  await cancelApi.inject({
    method: 'POST',
    url: `/api/jobs/${job.id}/cancel`,
    headers,
    payload: {},
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(
    (await cancelApi.inject({ url: '/api/jobs', headers })).json()[0].state,
    'cancelled',
  );
});
test('the twenty archived lists retain composition and every original line', async (t) => {
  const store = new StudyStore('data');
  let event;
  try {
    event = await store.archive('RpBCJzCBsTCO').readEvent();
  } catch {
    t.skip('Private event corpus is not distributed with the source.');
    return;
  }
  assert.equal(event.players.length, 20);
  let total = 0;
  for (const player of event.players) {
    const detail = await store.player(event.id, player.id);
    assert.equal(detail.parsed?.raw, detail.content?.text);
    assert(detail.parsed?.faction);
    assert(detail.parsed?.formation);
    assert(detail.parsed!.units.length >= 5);
    assert.equal(detail.parsed!.unparsed.length, 0);
    total += detail.parsed!.units.length;
  }
  assert.equal(total, 180);
});
