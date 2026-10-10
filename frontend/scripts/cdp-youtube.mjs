/**
 * Open YouTube using the raw Chrome DevTools Protocol (no Playwright automation API).
 *
 * 1. Launch Edge with --remote-debugging-port (dedicated temp profile).
 * 2. Connect to the browser target over its CDP WebSocket.
 * 3. Target.createTarget -> Target.attachToTarget (flatten) -> Page.navigate.
 * 4. Read document.title / location.href via Runtime.evaluate, capture a screenshot.
 *
 * Usage: node scripts/cdp-youtube.mjs
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import WebSocket from 'ws';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9333;
const PROFILE = 'C:\\Users\\ARNAV BRAHMANE\\AppData\\Local\\Temp\\opencode\\cdp-profile';
const SHOT = 'C:\\Users\\ARNAV BRAHMANE\\AppData\\Local\\Temp\\opencode\\cdp-youtube.jpg';

// 1 — launch Edge with a remote-debugging port (own profile, windowed so you can see it).
const edge = spawn(
  EDGE,
  [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

async function cdpVersion() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      const j = await res.json();
      if (j.webSocketDebuggerUrl) return j;
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  throw new Error('CDP endpoint never came up on port ' + PORT);
}

const version = await cdpVersion();
console.log('Connected to:', version.Browser);
console.log('Browser WS  :', version.webSocketDebuggerUrl);

// 2 — open the CDP WebSocket.
const ws = new WebSocket(version.webSocketDebuggerUrl, { perMessageDeflate: false });
let msgId = 0;
const pending = new Map();

function send(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`timeout waiting for ${method}`));
      }
    }, 20000);
  });
}

ws.on('message', (data) => {
  const m = JSON.parse(String(data));
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id);
    pending.delete(m.id);
    if (m.error) reject(new Error(m.error.message));
    else resolve(m.result);
  }
});

await new Promise((res) => ws.once('open', res));

// 3 — create a tab, attach to it, enable the Page domain, navigate.
const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
console.log('Target       :', targetId, '| session:', sessionId);

await send('Page.enable', {}, sessionId);
const nav = await send('Page.navigate', { url: 'https://www.youtube.com/' }, sessionId);
console.log('Page.navigate:', JSON.stringify(nav));

// wait for load
for (let i = 0; i < 60; i++) {
  try {
    const r = await send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true }, sessionId);
    if (r.result.value === 'complete') break;
  } catch {
    /* retry */
  }
  await sleep(250);
}

// 4 — read the result straight from the page via CDP.
const title = await send('Runtime.evaluate', { expression: 'document.title', returnByValue: true }, sessionId);
const href = await send('Runtime.evaluate', { expression: 'location.href', returnByValue: true }, sessionId);
console.log('\nTitle (via CDP Runtime.evaluate):', title.result.value);
console.log('URL  (via CDP Runtime.evaluate):', href.result.value);

const shot = await send('Page.captureScreenshot', { type: 'jpeg', quality: 45 }, sessionId);
writeFileSync(SHOT, Buffer.from(shot.data, 'base64'));
console.log('Screenshot saved:', SHOT);

await send('Target.closeTarget', { targetId });
ws.close();
edge.kill();
console.log('\nDONE: YouTube opened via the raw Chrome DevTools Protocol.');
process.exit(0);
