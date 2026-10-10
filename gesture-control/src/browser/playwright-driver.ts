/**
 * browser/playwright-driver.ts — MAIN-PROCESS side gesture browser.
 *
 * Why Playwright instead of OS mouse injection: this Linux session runs
 * Wayland, which blocks synthetic global input (xdotool-style movers don't
 * work). Playwright drives its own headed Chromium window, so the head
 * cursor + pinch map to a REAL browser with zero compositor privileges:
 *
 *   head displacement → page.mouse.move(x, y)   (absolute, viewport px)
 *   pinch             → page.mouse.click(x, y)
 *   point up/down     → page.mouse.wheel(0, ∓500)
 *   thumb up/down     → Enter / Escape
 *
 * Normalized 0..1 input is scaled to the Playwright viewport. Runs in the
 * Electron main process (Node) — never import this from the renderer.
 */

import { chromium, type Browser, type Page } from 'playwright';

const DEFAULT_URL = 'https://example.com';
const VIEWPORT = { width: 1280, height: 800 };

let browser: Browser | null = null;
let page: Page | null = null;
/** Last known viewport cursor (for relative steps — no OS query needed). */
let relPos: { x: number; y: number } | null = null;

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

function toPixels(nx: number, ny: number): { x: number; y: number } | null {
  if (!page || page.isClosed()) return null;
  const vp = page.viewportSize() ?? VIEWPORT;
  return {
    x: Math.round(clamp01(nx) * vp.width),
    y: Math.round(clamp01(ny) * vp.height),
  };
}

export function isBrowserOpen(): boolean {
  return browser !== null && page !== null && !page.isClosed();
}

export async function launchGestureBrowser(
  url: string = DEFAULT_URL,
): Promise<void> {
  if (isBrowserOpen()) return;
  await closeGestureBrowser();
  browser = await chromium.launch({
    headless: false,
    args: ['--window-size=1400,900'],
  });
  const context = await browser.newContext({ viewport: VIEWPORT });
  page = await context.newPage();
  relPos = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };
  await page.goto(url, { waitUntil: 'domcontentloaded' });
}

export async function closeGestureBrowser(): Promise<void> {
  const b = browser;
  browser = null;
  page = null;
  relPos = null;
  if (b) {
    try {
      await b.close();
    } catch {
      // already closed — nothing to do
    }
  }
}

/** Absolute pointer move (head cursor ticks at ~25Hz — fire and forget). */
export async function moveBrowserCursor(nx: number, ny: number): Promise<void> {
  const p = toPixels(nx, ny);
  if (!p || !page) return;
  relPos = { ...p };
  try {
    await page.mouse.move(p.x, p.y);
  } catch {
    // page closed mid-gesture — the next tick no-ops via toPixels
  }
}

/**
 * Relative step: X ← X + dnx * viewportW. Only call while moved=true —
 * idle ticks must send nothing so a physical mouse over the Chromium
 * window keeps working.
 */
export async function moveBrowserCursorRel(
  dnx: number,
  dny: number,
): Promise<void> {
  if (!page || page.isClosed()) return;
  if (dnx === 0 && dny === 0) return;
  const vp = page.viewportSize() ?? VIEWPORT;
  if (!relPos) relPos = { x: vp.width / 2, y: vp.height / 2 };
  relPos = {
    x: Math.min(vp.width, Math.max(0, relPos.x + dnx * vp.width)),
    y: Math.min(vp.height, Math.max(0, relPos.y + dny * vp.height)),
  };
  try {
    await page.mouse.move(Math.round(relPos.x), Math.round(relPos.y));
  } catch {
    // ignore — page closed mid-gesture
  }
}

/** Pinch → left click at the cursor. */
export async function clickBrowserCursor(
  nx: number,
  ny: number,
): Promise<void> {
  const p = toPixels(nx, ny);
  if (!p || !page) return;
  relPos = { ...p };
  try {
    await page.mouse.click(p.x, p.y);
  } catch {
    // ignore — page closed mid-gesture
  }
}

/** Pinch → click where the cursor already is (relative mode). */
export async function clickBrowserCursorCurrent(): Promise<void> {
  if (!page || page.isClosed()) return;
  const vp = page.viewportSize() ?? VIEWPORT;
  const p = relPos ?? { x: vp.width / 2, y: vp.height / 2 };
  try {
    await page.mouse.click(Math.round(p.x), Math.round(p.y));
  } catch {
    // ignore — page closed mid-gesture
  }
}

export async function wheelBrowser(dy: number): Promise<void> {
  if (!page || page.isClosed()) return;
  try {
    await page.mouse.wheel(0, dy);
  } catch {
    // ignore — page closed mid-gesture
  }
}

export async function navBrowser(where: 'back' | 'forward'): Promise<void> {
  if (!page || page.isClosed()) return;
  try {
    if (where === 'back') await page.goBack({ waitUntil: 'domcontentloaded' });
    else await page.goForward({ waitUntil: 'domcontentloaded' });
  } catch {
    // no history or closed — safe to ignore
  }
}

export async function pressBrowserKey(key: string): Promise<void> {
  if (!page || page.isClosed()) return;
  try {
    await page.keyboard.press(key);
  } catch {
    // ignore — page closed mid-gesture
  }
}
