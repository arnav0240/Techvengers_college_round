/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />
declare module '*.css';

/** Preload bridge (see src/preload.ts) — typed here for the renderer. */
interface BrowserInputAPI {
  launch: (url?: string) => Promise<{ ok: boolean; error?: string }>;
  close: () => Promise<{ ok: boolean }>;
  status: () => Promise<{ open: boolean }>;
  move: (x: number, y: number) => void;
  click: (x: number, y: number) => void;
  moveRel: (dx: number, dy: number) => void;
  clickCurrent: () => void;
  wheel: (dy: number) => void;
  nav: (where: 'back' | 'forward') => void;
  key: (key: 'Enter' | 'Escape') => void;
}

interface Window {
  browserInput: BrowserInputAPI;
}
