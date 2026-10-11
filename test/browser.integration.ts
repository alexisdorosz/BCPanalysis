import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { BCP_API, BCP_SITE } from '../src/bcp.js';
import { BcpBrowser, readListFromPage } from '../src/browser.js';
import { type Player } from '../src/types.js';

test('Chrome captures only the matching list response loaded by the page', async t => {
  const directory = await mkdtemp(resolve(tmpdir(), 'bcp-browser-test-'));
  const context = await chromium.launchPersistentContext(directory, { channel: 'chrome', headless: true });
  const page = await context.newPage();
  const player: Player = { id: 'p', name: 'Test', listId: 'list-p', dropped: false };
  let status = 200;
  let scenario: 'ordinary' | 'legacy' | 'login' | 'timeout' = 'ordinary';
  let pageRead = false;
  const payload = { id: 'list-p', armyListText: 'Exact text\r\n• Reinforced\r\n' };
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === new URL(BCP_API).origin && url.pathname === '/v1/armylists/list-p') {
      assert.equal(pageRead, true, 'List API traffic must originate from the mocked normal page');
      await route.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(status === 200 ? payload : 'unauthorized access') });
    } else if (url.origin === new URL(BCP_API).origin) {
      await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ id: 'unrelated', armyListText: 'wrong list' }) });
    } else if (url.origin === BCP_SITE) {
      pageRead = true;
      const scripts = scenario === 'login' ? 'location.href="/login"' : scenario === 'timeout' ? '' : scenario === 'legacy' && !url.pathname.startsWith('/legacy/') ? 'location.href="/legacy/list/list-p"' : `fetch('${BCP_API}/armylists/unrelated'); fetch('${BCP_API}/armylists/list-p?expand[]=event')`;
      await route.fulfill({ contentType: 'text/html', body: `<html><body>Mock BCP<script>${url.pathname === '/login' ? '' : scripts}</script></body></html>` });
    } else await route.abort(); // No real network or BCP credentials are used.
  });
  try {
    await t.test('successful normal-page response preserves text', async () => {
      const result = await readListFromPage(page, player, `${BCP_SITE}/list/list-p`, 3000);
      assert.equal(result.status, 'ok'); assert.deepEqual(result.payload, payload);
    });
    await t.test('legacy navigation remains observable', async () => {
      scenario = 'legacy';
      const result = await readListFromPage(page, player, `${BCP_SITE}/list/list-p`, 3000);
      assert.equal(result.status, 'ok'); assert.deepEqual(result.payload, payload);
    });
    await t.test('401 requests manual login; 403 remains a denial', async () => {
      scenario = 'ordinary'; status = 401;
      const expired = await readListFromPage(page, player, `${BCP_SITE}/list/list-p`, 3000);
      assert.equal(expired.status, 'denied'); assert.equal(expired.loginRequired, true);
      status = 403;
      const denied = await readListFromPage(page, player, `${BCP_SITE}/list/list-p`, 3000);
      assert.equal(denied.status, 'denied'); assert.equal(denied.loginRequired, false);
    });
    await t.test('redirect to login without an API response is distinguished from page changes', async () => {
      scenario = 'login';
      const login = await readListFromPage(page, player, `${BCP_SITE}/list/list-p`, 500);
      assert.equal(login.status, 'denied'); assert.equal(login.loginRequired, true);
      scenario = 'timeout';
      const changed = await readListFromPage(page, player, `${BCP_SITE}/list/list-p`, 500);
      assert.equal(changed.status, 'error'); assert.match(changed.reason!, /timeout/);
    });
  } finally { await context.close(); await rm(directory, { recursive: true, force: true }); }
});

test('dedicated browser control supports continuing and cancelling without terminal input', async t => {
  for (const cancel of [false, true]) {
    await t.test(cancel ? 'Stop for now stops collection before a list is read' : 'Continue collection reads a list and final close is not cancellation', async child => {
      const directory = await mkdtemp(resolve(tmpdir(), 'bcp-control-test-'));
      const launch = chromium.launchPersistentContext.bind(chromium);
      let stops = 0, listRequests = 0;
      let resolveControl!: (page: Page) => void;
      const controlReady = new Promise<Page>(resolve => { resolveControl = resolve; });
      child.mock.method(chromium, 'launchPersistentContext', async (path: string, options: Parameters<typeof chromium.launchPersistentContext>[1]) => {
        const context: BrowserContext = await launch(path, { ...options, headless: true });
        await context.route('**/*', async route => {
          const url = new URL(route.request().url());
          if (url.origin === new URL(BCP_API).origin) {
            listRequests++;
            await route.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ id: 'list-p', armyListText: 'Example' }) });
          } else if (url.origin === BCP_SITE) {
            await route.fulfill({ contentType: 'text/html', body: url.pathname === '/login' ? '<html>Mock login</html>' : `<html><script>fetch('${BCP_API}/armylists/list-p')</script></html>` });
          } else await route.abort();
        });
        context.on('page', page => {
          void page.getByRole('button', { name: 'Continue collection' }).waitFor({ timeout: 5000 }).then(() => resolveControl(page)).catch(() => {});
        });
        return context;
      });
      const browser = new BcpBrowser({ profileDir: directory, channel: 'chrome', eventUrl: `${BCP_SITE}/event/event-1`, timeoutMs: 3000, log: () => {}, onStop: () => { stops++; } });
      try {
        const reading = browser.readList({ id: 'p', name: 'Test', listId: 'list-p', dropped: false }, `${BCP_SITE}/list/list-p`);
        const control = await controlReady;
        await control.getByRole('button', { name: cancel ? 'Stop for now' : 'Continue collection' }).click();
        const result = await reading;
        assert.equal(result.status, cancel ? 'error' : 'ok');
        assert.equal(listRequests, cancel ? 0 : 1);
        assert.equal(stops, cancel ? 1 : 0);
        await browser.close();
        assert.equal(stops, cancel ? 1 : 0);
      } finally { await browser.close(); await rm(directory, { recursive: true, force: true }); }
    });
  }
});
