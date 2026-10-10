/**
 * BrowserManager — owns the single real Chromium/Edge/Chrome process used by
 * NOVA's Simulation mode.
 *
 * Playwright (playwright-core) drives a *dedicated persistent profile* so the
 * automation never touches the user's personal browser profile. The service
 * binds to 127.0.0.1 only, and no remote-debugging port is exposed.
 *
 * Environment:
 *   NOVA_HEADLESS=1        run headless (frames are streamed to the UI either way)
 *   NOVA_BROWSER_PATH      explicit Chromium-family executable
 *   NOVA_PROFILE_DIR       override the dedicated profile directory
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PROFILE = path.join(here, '.nova-profile');

const KNOWN_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
];

export const VIEWPORT = { width: 1280, height: 800 };
export const NAV_TIMEOUT = Number(process.env.NOVA_NAV_TIMEOUT || 25000);
export const ACTION_TIMEOUT = Number(process.env.NOVA_ACTION_TIMEOUT || 12000);

const isHeadless = () =>
  process.env.NOVA_HEADLESS === '1' || process.env.NOVA_HEADLESS === 'true';

/** Normalise a user-supplied navigation target into a safe http(s) URL. */
export function validateUrl(input) {
  const raw = String(input ?? '').trim();
  if (!raw) throw new Error('Empty URL — nothing to navigate to.');
  if (/^(javascript|data|file|blob|about|chrome|devtools):/i.test(raw)) {
    throw new Error(`Blocked unsafe URL scheme: ${raw.slice(0, 40)}`);
  }
  let candidate = raw;
  if (!/^https?:\/\//i.test(candidate)) {
    if (/^[\w-]+(\.[\w-]+)+(:\d+)?([/?#].*)?$/.test(candidate)) candidate = `https://${candidate}`;
    else throw new Error(`"${raw}" is not a valid URL (expected something like example.com).`);
  }
  let url;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error(`"${raw}" could not be parsed as a URL.`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Blocked non-http(s) URL scheme: ${url.protocol}`);
  }
  // Tolerate a trailing dot in the hostname ("google.com.").
  url.hostname = url.hostname.replace(/\.+$/, '');
  return url.toString();
}

export class BrowserManager {
  /** @param {{onStatus?:Function,onFrame?:Function,onPage?:Function}} hooks */
  constructor(hooks = {}) {
    this.hooks = hooks;
    this.state = 'idle'; // idle | starting | ready | error | crashed
    this.error = null;
    this.context = null;
    this.launchDesc = null;
    this.activeIndex = 0;
    this.headless = isHeadless();
    this.profileDir = process.env.NOVA_PROFILE_DIR || DEFAULT_PROFILE;
    this.lastFrame = null;
    this.frameTimer = null;
    this.frameInterval = 2000;
    this.subscribers = 0;
    this._starting = null;
    this._lastUrl = null;
  }

  // ---------------------------------------------------------------- lifecycle

  async start() {
    if (this.state === 'ready' && this.context) return;
    if (this._starting) return this._starting;
    this._starting = this._launch().finally(() => {
      this._starting = null;
    });
    return this._starting;
  }

  async _launch() {
    this._setStatus('starting');
    try {
      fs.mkdirSync(this.profileDir, { recursive: true });
      const base = {
        headless: this.headless,
        viewport: VIEWPORT,
        args: [
          '--disable-dev-shm-usage',
          '--no-first-run',
          '--no-default-browser-check',
          '--disable-popup-blocking',
          '--window-size=1280,860',
        ],
      };
      const attempts = [];
      if (process.env.NOVA_BROWSER_PATH) attempts.push({ executablePath: process.env.NOVA_BROWSER_PATH });
      // Prefer Chrome so the automation window matches the browser running the
      // webapp / extension (override with NOVA_BROWSER_CHANNEL=msedge|chrome).
      const order = (process.env.NOVA_BROWSER_CHANNEL ?? 'chrome').toLowerCase() === 'msedge'
        ? ['msedge', 'chrome']
        : ['chrome', 'msedge'];
      for (const ch of order) attempts.push({ channel: ch });
      for (const p of KNOWN_PATHS) if (fs.existsSync(p)) attempts.push({ executablePath: p });
      attempts.push({ channel: 'chromium' });

      let ctx = null;
      let lastErr = null;
      const seen = new Set();
      for (const extra of attempts) {
        const key = extra.channel || extra.executablePath;
        if (seen.has(key)) continue;
        seen.add(key);
        try {
          ctx = await chromium.launchPersistentContext(this.profileDir, { ...base, ...extra });
          this.launchDesc = extra.channel ? `channel:${extra.channel}` : path.basename(extra.executablePath);
          break;
        } catch (err) {
          lastErr = err;
        }
      }
      if (!ctx) throw lastErr ?? new Error('No Chromium-family browser executable was found.');

      this.context = ctx;
      ctx.on('close', () => {
        if (this.state === 'ready') {
          this._setStatus('crashed', 'The browser window closed unexpectedly.');
          this.stopFrames();
        }
      });
      if (ctx.pages().length === 0) await ctx.newPage();
      this.activeIndex = 0;
      this._lastUrl = this.page()?.url() ?? null;
      this._setStatus('ready');
      this.startFrames();
      this.emitPage(true);
    } catch (err) {
      this._setStatus('error', err?.message ?? String(err));
      throw err;
    }
  }

  stopFrames() {
    if (this.frameTimer) clearInterval(this.frameTimer);
    this.frameTimer = null;
  }

  startFrames() {
    this.stopFrames();
    this.frameTimer = setInterval(() => this.captureFrame(), this.frameInterval);
  }

  /** Frame rate: fast while a request executes, slow when idle, off when no clients. */
  setFrameRate(ms) {
    if (this.frameInterval === ms) return;
    this.frameInterval = ms;
    if (this.frameTimer) this.startFrames();
  }

  setSubscribers(n) {
    this.subscribers = n;
    this.setFrameRate(n <= 0 ? 2000 : this.frameInterval === 500 ? 500 : 2000);
  }

  // ------------------------------------------------------------------- access

  pages() {
    return this.context?.pages() ?? [];
  }

  page() {
    const pages = this.pages();
    if (!pages.length) return null;
    const i = Math.min(this.activeIndex, pages.length - 1);
    return pages[i] ?? null;
  }

  ensureReady() {
    if (this.state !== 'ready' || !this.context) {
      throw new Error(`Browser service is not ready (state: ${this.state}${this.error ? ` — ${this.error}` : ''}).`);
    }
  }

  describe() {
    return `${this.headless ? 'headless' : 'windowed'} ${this.launchDesc ?? 'browser'} · profile ${path.basename(this.profileDir)}`;
  }

  // --------------------------------------------------------------- operations

  async navigate(input, { timeout = NAV_TIMEOUT } = {}) {
    this.ensureReady();
    const url = validateUrl(input);
    const page = this.page();
    if (!page) throw new Error('No browser page is open.');
    const t0 = Date.now();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
    await page.waitForLoadState('load', { timeout: 8000 }).catch(() => {});
    const title = await this.safeTitle(page);
    this.emitPage(true);
    return { url: page.url(), title, durationMs: Date.now() - t0 };
  }

  async back() {
    this.ensureReady();
    const page = this.page();
    const t0 = Date.now();
    try {
      await page.goBack({ waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
    } catch (err) {
      throw new Error(`Could not go back: ${err?.message ?? 'no history or navigation failed.'}`);
    }
    this.emitPage(true);
    return { url: page.url(), title: await this.safeTitle(page), durationMs: Date.now() - t0 };
  }

  async forward() {
    this.ensureReady();
    const page = this.page();
    const t0 = Date.now();
    try {
      await page.goForward({ waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
    } catch (err) {
      throw new Error(`Could not go forward: ${err?.message ?? 'no forward history or navigation failed.'}`);
    }
    this.emitPage(true);
    return { url: page.url(), title: await this.safeTitle(page), durationMs: Date.now() - t0 };
  }

  async newTab(input) {
    this.ensureReady();
    const page = await this.context.newPage();
    this.activeIndex = this.context.pages().length - 1;
    let url = 'about:blank';
    if (input) url = validateUrl(input);
    if (url !== 'about:blank') {
      const t0 = Date.now();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
      this.emitPage(true);
      return { index: this.activeIndex, url: page.url(), title: await this.safeTitle(page), durationMs: Date.now() - t0 };
    }
    this.emitPage(true);
    return { index: this.activeIndex, url: page.url(), title: await this.safeTitle(page), durationMs: 0 };
  }

  async switchTab(index) {
    this.ensureReady();
    const pages = this.pages();
    const i = Number(index);
    if (!Number.isInteger(i) || i < 0 || i >= pages.length) {
      throw new Error(`Tab ${index} does not exist — there are ${pages.length} open tab(s).`);
    }
    this.activeIndex = i;
    await pages[i].bringToFront().catch(() => {});
    this.emitPage(true);
    return { index: i, url: pages[i].url(), title: await this.safeTitle(pages[i]) };
  }

  async closeTab(index) {
    this.ensureReady();
    const pages = this.pages();
    const i = index == null ? this.activeIndex : Number(index);
    if (i < 0 || i >= pages.length) throw new Error(`Tab ${index} does not exist.`);
    if (pages.length === 1) throw new Error('Refusing to close the last remaining tab.');
    await pages[i].close();
    this.activeIndex = Math.max(0, Math.min(i, this.pages().length - 1));
    this.emitPage(true);
    return { remaining: this.pages().length };
  }

  async scroll(dir = 'down', amount = 760) {
    this.ensureReady();
    const page = this.page();
    const delta = dir === 'up' ? -Math.abs(amount) : Math.abs(amount);
    await page.mouse.wheel(0, delta);
    await page.waitForTimeout(250);
    const pos = await page
      .evaluate(() => ({ y: Math.round(window.scrollY), max: Math.round(document.body.scrollHeight - window.innerHeight) }))
      .catch(() => null);
    return { dir, y: pos?.y ?? null, max: pos?.max ?? null };
  }

  /** Find the first visible element matching any selector; returns the matched selector. */
  async findVisible(selectors, timeoutMs = 3000) {
    const page = this.page();
    if (!page) return null;
    for (const sel of selectors) {
      try {
        const loc = page.locator(sel).first();
        await loc.waitFor({ state: 'visible', timeout: timeoutMs });
        if (await loc.isVisible().catch(() => false)) return { selector: sel, locator: loc };
      } catch {
        /* try next selector */
      }
    }
    return null;
  }

  /** Collect candidate result links (title + absolute href) using the site's selectors. */
  async collectResults(selectors, { limit = 12, videoOnly = false } = {}) {
    const page = this.page();
    if (!page) return [];
    for (const sel of selectors) {
      try {
        const items = await page.$$eval(
          sel,
          (els, args) => {
            const abs = (h) => {
              try {
                return new URL(h, location.href).toString();
              } catch {
                return h || '';
              }
            };
            return els.slice(0, args.limit).map((el) => ({
              title: (el.getAttribute('title') || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 160),
              href: abs(el.getAttribute('href') || ''),
            }));
          },
          { limit: limit * 3 },
        );
        const filtered = items
          .filter((it) => it.title && it.href)
          .filter((it) => (videoOnly ? it.href.includes('/watch') || it.href.includes('/video') : true))
          .slice(0, limit);
        if (filtered.length) return filtered;
      } catch {
        /* try next selector */
      }
    }
    return [];
  }

  /** Wait until any of the selectors matches at least one element; returns the matched selector. */
  async waitForAny(selectors, timeoutMs = 12000) {
    const page = this.page();
    if (!page || !selectors.length) return null;
    try {
      const handle = await page.waitForFunction(
        (sels) => sels.find((s) => document.querySelectorAll(s).length > 0) ?? null,
        selectors,
        { timeout: timeoutMs },
      );
      return await handle.jsonValue();
    } catch {
      return null;
    }
  }

  /** Count elements matching the first selector that matches anything. */
  async countResults(selectors) {
    const page = this.page();
    if (!page) return 0;
    for (const sel of selectors) {
      try {
        const n = await page.locator(sel).count();
        if (n > 0) return n;
      } catch {
        /* try next selector */
      }
    }
    return 0;
  }

  /** Click an element by visible text (a / button / role=button). */
  async clickByText(text) {
    const page = this.page();
    const needle = String(text).trim().toLowerCase();
    const strategies = [
      page.locator('a, button, [role="button"], summary'),
      page.getByRole('link'),
      page.getByRole('button'),
    ];
    for (const base of strategies) {
      try {
        const target = base.filter({ hasText: needle }).first();
        if ((await target.count()) === 0) continue;
        await target.click({ timeout: ACTION_TIMEOUT });
        await page.waitForLoadState('domcontentloaded', { timeout: 8000 }).catch(() => {});
        this.emitPage(true);
        return { matched: true, url: page.url(), title: await this.safeTitle(page) };
      } catch {
        /* try the next strategy */
      }
    }
    return { matched: false };
  }

  async titleAndUrl() {
    this.ensureReady();
    const page = this.page();
    return { title: await this.safeTitle(page), url: page.url() };
  }

  async safeTitle(page) {
    try {
      return (await page.title()) || '(no title)';
    } catch {
      return '(no title)';
    }
  }

  // ----------------------------------------------------------------- streams

  async captureFrame() {
    if (this.state !== 'ready') return;
    const page = this.page();
    if (!page) return;
    try {
      const buf = await page.screenshot({ type: 'jpeg', quality: 42 });
      const dataUrl = `data:image/jpeg;base64,${buf.toString('base64')}`;
      this.lastFrame = dataUrl;
      this.hooks.onFrame?.({ t: Date.now(), dataUrl });
    } catch {
      /* frame capture is best-effort */
    }
  }

  snapshot() {
    const pages = this.pages();
    return {
      state: this.state,
      headless: this.headless,
      error: this.error,
      description: this.state === 'ready' ? this.describe() : null,
      page: pages.length
        ? { title: null, url: this.page()?.url() ?? null }
        : null,
      tabs: pages.map((p, i) => ({
        index: i,
        title: p.url() === 'about:blank' ? 'New tab' : null,
        url: p.url(),
        active: i === Math.min(this.activeIndex, pages.length - 1),
      })),
      activeIndex: Math.min(this.activeIndex, Math.max(0, pages.length - 1)),
    };
  }

  async emitPage(force = false) {
    if (!this.context) return;
    const snap = this.snapshot();
    const active = this.page();
    if (active) {
      const url = active.url();
      const title = await this.safeTitle(active).catch(() => null);
      snap.page = { title, url };
      if (!force && url === this._lastUrl) return;
      this._lastUrl = url;
    }
    this.hooks.onPage?.(snap);
  }

  _setStatus(state, error = null) {
    this.state = state;
    this.error = error;
    this.hooks.onStatus?.({ state, error, headless: this.headless, description: state === 'ready' ? this.describe() : null });
  }

  async shutdown() {
    this.stopFrames();
    try {
      await this.context?.close();
    } catch {
      /* already closed */
    }
    this.context = null;
    this._setStatus('idle');
  }
}
