// preload.ts — exposes a minimal gesture→browser input bridge.
// The renderer (sandboxed) can only SEND normalized input; all Playwright
// work happens in main. High-frequency cursor ticks use send (no reply).

import { contextBridge, ipcRenderer } from 'electron';

export interface BrowserInputAPI {
  launch: (url?: string) => Promise<{ ok: boolean; error?: string }>;
  close: () => Promise<{ ok: boolean }>;
  status: () => Promise<{ open: boolean }>;
  move: (x: number, y: number) => void;
  click: (x: number, y: number) => void;
  /** Relative head-cursor step: normalized deltas (X_os += dx * screenW). */
  moveRel: (dx: number, dy: number) => void;
  /** Click at the CURRENT OS cursor — no coords, never yanks the mouse. */
  clickCurrent: () => void;
  wheel: (dy: number) => void;
  nav: (where: 'back' | 'forward') => void;
  key: (key: 'Enter' | 'Escape') => void;
}

const browserInput: BrowserInputAPI = {
  launch: (url?: string) => ipcRenderer.invoke('browser:launch', url),
  close: () => ipcRenderer.invoke('browser:close'),
  status: () => ipcRenderer.invoke('browser:status'),
  move: (x, y) => ipcRenderer.send('browser:move', x, y),
  click: (x, y) => ipcRenderer.send('browser:click', x, y),
  moveRel: (dx, dy) => ipcRenderer.send('browser:moveRel', dx, dy),
  clickCurrent: () => ipcRenderer.send('browser:clickCurrent'),
  wheel: (dy) => ipcRenderer.send('browser:wheel', dy),
  nav: (where) => ipcRenderer.send('browser:nav', where),
  key: (key) => ipcRenderer.send('browser:key', key),
};

contextBridge.exposeInMainWorld('browserInput', browserInput);
