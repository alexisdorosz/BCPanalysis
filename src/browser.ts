import { chromium, type BrowserContext, type Page } from 'playwright';
import { privateDirectory } from './archive.js';
import { BCP_API, BCP_SITE } from './bcp.js';
import { type Player, type ReadResult } from './types.js';

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export interface BrowserOptions {
  profileDir: string;
  channel: 'chrome' | 'chromium';
  timeoutMs: number;
  eventUrl: string;
  signal?: AbortSignal;
  onStop?: () => void;
  log: (message: string) => void;
}

export class BcpBrowser {
  private context?: BrowserContext;
  private page?: Page;
  private control?: Page;
  private promptResolver?: (value: boolean) => void;
  private closed = false;
  private intentionalClose = false;
  private abortListener = () => { void this.close().catch(() => {}); };

  constructor(private readonly options: BrowserOptions) {}

  async start(): Promise<boolean> {
    if (this.context) return !this.closed;
    if (this.closed || this.options.signal?.aborted) return false;
    await privateDirectory(this.options.profileDir);
    this.context = await chromium.launchPersistentContext(this.options.profileDir, {
      channel: this.options.channel === 'chrome' ? 'chrome' : undefined,
      headless: false, acceptDownloads: false, timeout: this.options.timeoutMs,
      viewport: null,
    });
    this.options.signal?.addEventListener('abort', this.abortListener, { once: true });
    this.context.on('close', () => {
      this.closed = true; this.promptResolver?.(false);
      if (!this.intentionalClose) this.options.onStop?.();
    });
    this.control = await this.context.newPage();
    this.control.on('close', () => {
      this.promptResolver?.(false);
      if (!this.intentionalClose) this.options.onStop?.();
      void this.close().catch(() => {});
    });
    await this.control.exposeFunction('collectorContinue', () => this.promptResolver?.(true));
    await this.control.exposeFunction('collectorCancel', () => this.promptResolver?.(false));
    this.page = await this.context.newPage();
    return this.authenticate('Sign in to BCP in the other tab. If this dedicated profile is already signed in, you can continue immediately.');
  }

  async authenticate(reason: string): Promise<boolean> {
    if (!this.context) return this.start();
    if (this.closed || this.options.signal?.aborted || !this.control || !this.page) return false;
    const waiting = new Promise<boolean>(resolve => { this.promptResolver = resolve; });
    await this.showControl('Sign in to BCP', reason, true);
    this.options.log('Chrome is waiting for you: sign in in the BCP tab, then click “Continue collection” in the collector tab.');
    try {
      await this.page.goto(`${BCP_SITE}/login`, { waitUntil: 'domcontentloaded', timeout: this.options.timeoutMs });
      await this.page.bringToFront();
    } catch {
      this.options.log('BCP navigation did not finish. Open BCP in the browser tab and sign in manually.');
    }
    if (this.closed || this.options.signal?.aborted) this.promptResolver?.(false);
    const continued = await waiting;
    this.promptResolver = undefined;
    if (!continued) { this.options.onStop?.(); await this.close(); }
    if (continued) await this.showControl('Collecting lists', 'Collection is running. Originals and progress are saved after each player.', false);
    return continued;
  }

  private async showControl(title: string, message: string, prompt: boolean): Promise<void> {
    if (!this.control || this.control.isClosed()) return;
    await this.control.setContent(`<!doctype html><html lang="en"><meta charset="utf-8"><title>BCP list collector</title>
      <style>body{font:18px system-ui;background:#f5f6f8;color:#192635;padding:8vh 8vw}main{max-width:700px;background:white;padding:36px;border-radius:16px}h1{font-size:28px}p{line-height:1.6}button{font:inherit;padding:12px 20px;border:0;border-radius:8px;cursor:pointer;background:#215ee8;color:white;margin-right:12px}button.secondary{background:#e8ecf3;color:#192635}small{display:block;margin-top:26px;color:#526072}</style>
      <main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>
      ${prompt ? '<button onclick="window.collectorContinue()">Continue collection</button><button class="secondary" onclick="window.collectorCancel()">Stop for now</button>' : '<p>You can close this browser to stop. Run the same command to resume.</p>'}
      <small>This collector uses a separate browser profile. Enter your credentials only on the BCP website.</small></main></html>`);
  }

  async readList(player: Player, url: string): Promise<ReadResult> {
    if (!await this.start()) return { status: 'error', reason: 'Browser collection was cancelled.' };
    if (!this.page || this.closed || this.options.signal?.aborted) return { status: 'error', reason: 'The collection browser was closed.' };
    await this.showControl('Collecting lists', `Reading ${player.name}. Completed lists are already saved locally.`, false);
    return readListFromPage(this.page, player, url, this.options.timeoutMs);
  }

  async close(): Promise<void> {
    this.intentionalClose = true;
    this.closed = true;
    this.promptResolver?.(false);
    this.options.signal?.removeEventListener('abort', this.abortListener);
    await this.context?.close();
  }
}

export async function readListFromPage(page: Page, player: Player, url: string, timeoutMs: number): Promise<ReadResult> {
    const expectedPath = new URL(`${BCP_API}/armylists/${player.listId}`).pathname;
    const expectedOrigin = new URL(BCP_API).origin;
    const responsePromise = page.waitForResponse(response => {
      const responseUrl = new URL(response.url());
      return response.request().method() === 'GET' && responseUrl.origin === expectedOrigin && responseUrl.pathname === expectedPath;
    }, { timeout: timeoutMs });
    try {
      // Listen before navigating; both modern and legacy page responses use the same list endpoint.
      const [response] = await Promise.all([
        responsePromise,
        page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs }),
      ]);
      const status = response.status();
      if ([401, 403, 404].includes(status)) return {
        status: 'denied', httpStatus: status, loginRequired: status === 401,
        reason: `BCP refused this list (HTTP ${status}). Its access restriction was respected.`,
      };
      if (!response.ok()) return { status: 'error', httpStatus: status, reason: `BCP list read failed (HTTP ${status}). No automatic request retry was performed.` };
      return { status: 'ok', httpStatus: status, payload: await response.json() };
    } catch {
      if (page.isClosed()) return { status: 'error', reason: 'The collection browser was closed.' };
      const current = new URL(page.url());
      if (/login|sign.?in|oauth|auth\./i.test(current.pathname + current.hostname)) return {
        status: 'denied', loginRequired: true, reason: 'BCP redirected to authentication before returning the list.',
      };
      const visibleText = await page.locator('body').innerText({ timeout: 2000 }).catch(() => '');
      if (/access denied|unauthorized|lists? (?:is|are) hidden|subscription required/i.test(visibleText)) return {
        status: 'denied', reason: 'The BCP page displays an access restriction; no alternative access was attempted.',
      };
      return { status: 'error', reason: 'No readable list response was observed before the timeout. BCP may have changed its page or endpoint.' };
    }
}
