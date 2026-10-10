import { app, BrowserWindow, ipcMain } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import {
  launchGestureBrowser,
  closeGestureBrowser,
  isBrowserOpen,
  moveBrowserCursor,
  moveBrowserCursorRel,
  clickBrowserCursor,
  clickBrowserCursorCurrent,
  wheelBrowser,
  navBrowser,
  pressBrowserKey,
} from './browser/os-driver';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

/**
 * Permanent fix for "○ exited (SIGTRAP)" on Ubuntu 24.04+ / hardened kernels.
 * Those kernels restrict unprivileged user namespaces
 * (kernel.apparmor_restrict_unprivileged_userns = 1), which Chromium's
 * sandbox needs — so the sandbox aborts startup with SIGTRAP before any
 * window opens. Same story when running as root. In exactly those cases we
 * pass --no-sandbox (what Chrome/VSCode launchers do); everywhere else the
 * sandbox stays fully enabled. Must run before app.ready().
 */
function chromiumSandboxUsable(): boolean {
  try {
    if (typeof process.getuid === 'function' && process.getuid() === 0) {
      return false;
    }
  } catch {
    // Non-POSIX platform — assume usable.
  }
  try {
    const v = fs
      .readFileSync(
        '/proc/sys/kernel/apparmor_restrict_unprivileged_userns',
        'utf8',
      )
      .trim();
    // 1/2 = restricted (Ubuntu 24.04+ default): userns creation fails.
    if (v === '1' || v === '2') return false;
  } catch {
    // Sysctl absent (non-Ubuntu kernel) — assume usable.
  }
  return true;
}

if (!chromiumSandboxUsable()) {
  console.warn(
    '[main] Chromium sandbox unavailable on this kernel — launching with --no-sandbox --no-zygote.',
  );
  app.commandLine.appendSwitch('no-sandbox');
  // Same root cause one layer down: the zygote helper dies identically on
  // restricted kernels, taking the GPU process with it
  // ("GPU process isn't usable. Goodbye."). Skipping it fixes startup;
  // renderers/GPU then run as plain child processes.
  app.commandLine.appendSwitch('no-zygote');
}

const createWindow = () => {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1080,
    height: 760,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  // and load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  // Open the DevTools.
  mainWindow.webContents.openDevTools();
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  createWindow();

  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  void closeGestureBrowser();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.

/** Clamp renderer-supplied input to sane ranges (never trust IPC blindly). */
function clean01(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return Math.min(1, Math.max(0, v));
}

function cleanDelta(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return Math.min(4000, Math.max(-4000, v));
}

function cleanRel(v: unknown): number | null {
  // Normalized frame delta: typically ±0.0005..±0.05, cap generously.
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return Math.min(1, Math.max(-1, v));
}

ipcMain.handle(
  'browser:launch',
  async (_event, url: unknown): Promise<{ ok: boolean; error?: string }> => {
    try {
      const start =
        typeof url === 'string' && url.startsWith('http') ? url : undefined;
      await launchGestureBrowser(start);
      return { ok: true };
    } catch (error) {
      console.error('[browser] launch failed:', error);
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
);

ipcMain.handle('browser:close', async (): Promise<{ ok: boolean }> => {
  await closeGestureBrowser();
  return { ok: true };
});

ipcMain.handle('browser:status', (): { open: boolean } => ({
  open: isBrowserOpen(),
}));

// High-frequency input: send-style (no reply) so 25Hz cursor ticks never block.
ipcMain.on('browser:move', (_event, nx: unknown, ny: unknown) => {
  const x = clean01(nx);
  const y = clean01(ny);
  if (x === null || y === null) return;
  void moveBrowserCursor(x, y);
});

// Relative head-cursor steps: only these fire during head motion — idle
// dead-zone ticks send nothing, so the physical mouse is never overridden.
ipcMain.on('browser:moveRel', (_event, dx: unknown, dy: unknown) => {
  const x = cleanRel(dx);
  const y = cleanRel(dy);
  if (x === null || y === null) return;
  if (x === 0 && y === 0) return;
  void moveBrowserCursorRel(x, y);
});

ipcMain.on('browser:click', (_event, nx: unknown, ny: unknown) => {
  const x = clean01(nx);
  const y = clean01(ny);
  if (x === null || y === null) return;
  void clickBrowserCursor(x, y);
});

ipcMain.on('browser:clickCurrent', () => {
  void clickBrowserCursorCurrent();
});

ipcMain.on('browser:wheel', (_event, dy: unknown) => {
  const d = cleanDelta(dy);
  if (d === null) return;
  void wheelBrowser(d);
});

ipcMain.on('browser:nav', (_event, where: unknown) => {
  if (where !== 'back' && where !== 'forward') return;
  void navBrowser(where);
});

const ALLOWED_KEYS = new Set(['Enter', 'Escape']);
ipcMain.on('browser:key', (_event, key: unknown) => {
  if (typeof key !== 'string' || !ALLOWED_KEYS.has(key)) return;
  void pressBrowserKey(key);
});
