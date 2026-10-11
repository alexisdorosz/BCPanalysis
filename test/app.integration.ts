import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { build } from 'vite';
import { createApi } from '../src/api.js';
import { serveWeb } from '../src/web-server.js';
import { eventFromUrl } from '../src/bcp.js';
import { fixtureSources, seedEvent } from './study-fixtures.js';

test('Chrome: import, player selection, generation, confirmed match, fresh sources and offline reading across two tournaments', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'bcp-app-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await build({ configFile: 'vite.config.ts', logLevel: 'silent' });
  const sources = fixtureSources();
  const api = createApi({
    dataDir: dir,
    profileDir: join(dir, '../browser-profile'),
    loader: sources.loader,
    importer: async (url, options) => {
      const id = eventFromUrl(url).id;
      options.progress?.('Reading roster', 0, 1);
      const event = await seedEvent(dir, id);
      options.progress?.('List collected', 1, 1, event);
      return event;
    },
  });
  serveWeb(api);
  await api.listen({ host: '127.0.0.1', port: 0 });
  t.after(() => api.close());
  const address = api.server.address();
  assert(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1500, height: 1080 } }),
    errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(origin);
  await page
    .getByLabel('Import a BCP event')
    .fill('https://www.bestcoastpairings.com/event/event-one');
  await page.getByRole('button', { name: /Import tournament/ }).click();
  await page.getByRole('heading', { name: 'Autumn tournament' }).waitFor();
  await page.getByRole('button', { name: /Alex Example/ }).click();
  await page.getByRole('heading', { name: 'Army at a glance' }).waitFor();
  await page
    .getByRole('button', { name: /^Generate study sheet/ })
    .first()
    .click();
  await page.getByRole('heading', { name: 'Entries to resolve' }).waitFor();
  assert.equal(await page.locator('.candidate').count(), 2);
  await page
    .locator('.candidate')
    .filter({ has: page.getByText('Ratling Guns', { exact: true }) })
    .getByRole('button', { name: 'Use this match' })
    .click();
  await page.getByText('Saved study', { exact: true }).waitFor();
  assert.equal(await page.locator('.resolution').count(), 0);
  await page
    .getByRole('region', { name: 'Battle Traits', exact: true })
    .getByRole('heading', { name: 'Battle Traits', exact: true })
    .waitFor();
  const spell = page
    .getByRole('region', { name: 'Spell Lore', exact: true })
    .getByRole('article', { name: 'WITHER', exact: true });
  await spell.getByLabel('Casting value 6').waitFor();
  assert.equal(
    await spell
      .locator('.ability-header')
      .evaluate((node) => getComputedStyle(node).backgroundColor),
    'rgb(118, 96, 43)',
  );
  assert.equal(await spell.locator('.ability-body strong').last().textContent(), 'Effect:');
  assert.equal(await page.locator('.rule-card,.chosen-section').count(), 0);
  await page
    .getByRole('region', { name: 'Formation / Army of Renown' })
    .locator('.rule-prose')
    .getByText('Only applies to the selected formation.')
    .waitFor();
  const spellGraphic = await page.request.get(origin + '/wahapedia/abSpellPoints1.png');
  assert.equal(spellGraphic.headers()['content-type'], 'image/png');
  assert.equal(
    (await page.request.get(origin + '/wahapedia/MinionPro-Bold.otf')).headers()['content-type'],
    'font/otf',
  );
  await page.getByRole('button', { name: 'Units (3)' }).click();
  await page.locator('.unit-card').nth(1).locator('summary').click();
  assert.equal(await page.locator('.unit-card').nth(1).locator('.unit-number').textContent(), '20');
  await page
    .locator('.unit-card')
    .nth(1)
    .getByText('Base characteristics', { exact: false })
    .waitFor();
  assert.equal(await page.locator('.unit-card').nth(1).locator('tbody tr').count(), 1);
  const before = sources.requests.length;
  sources.bump();
  await page.getByRole('button', { name: /Regenerate from Wahapedia/ }).click();
  await page.locator('.sources summary').click();
  await page.getByText('2026-10-09T10:00:02Z', { exact: false }).first().waitFor();
  assert(sources.requests.length > before);
  sources.offline(true);
  const offlineRequests = sources.requests.length;
  await page.reload();
  await page.getByRole('button', { name: /Alex Example/ }).click();
  await page.getByText('Saved study', { exact: true }).waitFor();
  assert.equal(sources.requests.length, offlineRequests);
  await page.getByLabel('Casting value 6').waitFor();
  await page.getByRole('button', { name: /Regenerate from Wahapedia/ }).click();
  await page.getByRole('alert').filter({ hasText: 'Simulated source outage' }).waitFor();
  await page.getByText('Saved study', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Original list' }).click();
  assert(
    (await page.locator('.original-text').textContent())?.includes(
      '20x Ratling (300) • Reinforced',
    ),
  );
  await page
    .getByLabel('Import a BCP event')
    .fill('https://www.bestcoastpairings.com/event/event-two');
  await page.getByRole('button', { name: /Import tournament/ }).click();
  await page.getByRole('button', { name: /Second tournament/ }).click();
  await page.getByRole('heading', { name: 'Second tournament' }).waitFor();
  await page.getByRole('button', { name: /Alex Example/ }).click();
  await page
    .getByRole('button', { name: /^Generate study sheet/ })
    .first()
    .waitFor();
  assert.equal((await (await fetch(origin + '/api/events')).json()).length, 2);
  assert.equal(
    (await (await fetch(origin + '/api/events/event-two/players/player-one')).json()).study,
    undefined,
  );
  await page.getByRole('button', { name: /Autumn tournament/ }).click();
  await page.getByRole('button', { name: /Alex Example/ }).click();
  await page.getByText('Saved study', { exact: true }).waitFor();
  await page.getByLabel('Search players').fill('no matches');
  await page.getByText('No players match this search.').waitFor();
  await page.getByLabel('Search players').fill('');
  await mkdir('.local', { recursive: true });
  await page.screenshot({ path: '.local/app-test-preview.png', fullPage: true });
  assert.deepEqual(errors, []);
});
