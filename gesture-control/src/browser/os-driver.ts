/**
 * browser/os-driver.ts — drop-in replacement for playwright-driver.ts.
 *
 * Same function signatures, but forwards to the Python PyAutoGUI server
 * (PyautoGUI_cursor/pyautogui_server.py, http://127.0.0.1:8765) instead of
 * a Playwright Chromium window — so gestures drive the REAL OS cursor.
 *
 * Swap in main.ts: replace the './browser/playwright-driver' import with
 * './browser/os-driver'. launch/close just health-check the server
 * (start it first via PyautoGUI_cursor/run.sh).
 */

const BASE = 'http://127.0.0.1:8765';

let open = false;

async function post(path: string, body: unknown): Promise<void> {
  if (!open) return;
  try {
    await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    // server down mid-gesture — next tick retries
  }
}

export function isBrowserOpen(): boolean {
  return open;
}

export async function launchGestureBrowser(_url?: string): Promise<void> {
  const res = await fetch(`${BASE}/health`);
  if (!res.ok)
    throw new Error(
      'PyAutoGUI server not responding — run PyautoGUI_cursor/run.sh first.',
    );
  open = true;
}

export async function closeGestureBrowser(): Promise<void> {
  open = false;
}

/** Absolute pointer move (legacy / Playwright-viewport fallback). */
export async function moveBrowserCursor(nx: number, ny: number): Promise<void> {
  await post('/move', { x: nx, y: ny });
}

/**
 * Relative pointer step — the head-cursor protocol.
 * dnx/dny are NORMALIZED frame deltas (X_os += dnx * screenW).
 * Server side (pyautogui): moveRel(dnx * size().width, dny * size().height).
 * No call = no movement, so a physical mouse works untouched in the zone.
 */
export async function moveBrowserCursorRel(
  dnx: number,
  dny: number,
): Promise<void> {
  if (dnx === 0 && dny === 0) return;
  await post('/moveRel', { dx: dnx, dy: dny });
}

/** Pinch → left click at the cursor. */
export async function clickBrowserCursor(
  nx: number,
  ny: number,
): Promise<void> {
  await post('/click', { x: nx, y: ny });
}

/** Pinch → left click at the CURRENT OS cursor (relative mode, no jump). */
export async function clickBrowserCursorCurrent(): Promise<void> {
  await post('/clickCurrent', {});
}

export async function wheelBrowser(dy: number): Promise<void> {
  await post('/wheel', { dy });
}

export async function navBrowser(where: 'back' | 'forward'): Promise<void> {
  await post('/nav', { where });
}

export async function pressBrowserKey(key: string): Promise<void> {
  await post('/key', { key });
}
