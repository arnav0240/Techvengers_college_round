/**
 * UI acceptance test (Test F) driven through a real headless Edge.
 * Verifies: tab switch, unchanged Main UI, compact transition, live frames,
 * synchronized activity events, expand/cancel, and no page-level scrolling.
 */
import { chromium } from 'playwright-core';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP = 'http://localhost:5173/';
const OUT = 'C:\\Users\\ARNAV BRAHMANE\\AppData\\Local\\Temp\\opencode';
const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
  { width: 1280, height: 720 },
];

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch({
  executablePath: EDGE,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader'],
});

const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200));
});
page.on('pageerror', (e) => consoleErrors.push(String(e).slice(0, 200)));

await page.goto(APP, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

// --- Main tab renders, with the new switcher present -------------------------
const tabs = await page.locator('[role="tablist"] [role="tab"]').allTextContents();
check('Tab switcher has MAIN + SIMULATION', tabs.join(',') === 'MAIN,SIMULATION', tabs.join(','));
const mainSelected = await page.locator('[role="tab"][aria-selected="true"]').innerText();
check('MAIN is selected by default', mainSelected.trim() === 'MAIN', mainSelected);

// Main UI signature elements still present
for (const [label, sel] of [
  ['orb canvas', 'canvas'],
  ['command deck', 'section[aria-label="Command deck"]'],
  ['command input', '#nova-command'],
]) {
  check(`Main keeps ${label}`, (await page.locator(sel).count()) > 0);
}

// --- Switch to SIMULATION ----------------------------------------------------
await page.locator('[role="tab"]', { hasText: 'SIMULATION' }).click();
await page.waitForTimeout(800);
check(
  'Switching to SIMULATION does not reload the page',
  await page.evaluate(() => performance.getEntriesByType('navigation').length === 1),
);
check('SIMULATION tab becomes selected', (await page.locator('[role="tab"][aria-selected="true"]').innerText()).trim() === 'SIMULATION');

// Simulation console still shows the orb + a command deck (reused component)
check('Sim console keeps the orb', (await page.locator('canvas').count()) > 0);
check('Sim console has a command deck', (await page.locator('section[aria-label="Command deck"]').count()) > 0);

// Service link state should be honest
const svcState = await page.locator('text=/SIM\\.(LINKED|OFFLINE)/').first().innerText().catch(() => '');
check('Sim console reports service link state', /SIM\.(LINKED|OFFLINE)/.test(svcState), svcState);

await page.screenshot({ path: `${OUT}\\sim-1-console.png` });

// --- Submit a command --------------------------------------------------------
const cmd = 'Open YouTube';
await page.locator('#nova-command').fill(cmd);
await page.locator('#nova-command').press('Enter');
await page.waitForTimeout(1200);

// Should transition to the workspace layout with the compact panel
const compactPanel = page.locator('aside[aria-label="NOVA compact assistant"]');
await compactPanel.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
check('Compact assistant panel appears after RUN', await compactPanel.isVisible());
check(
  'Compact panel shows the submitted request',
  (await page.locator('aside[aria-label="NOVA compact assistant"]').innerText()).includes(cmd),
);
check('Browser workspace is visible', await page.locator('section[aria-label="Real browser workspace"]').isVisible());

// Activity events stream in and are synchronized.
// In compact layout the trace lives inside the compact panel; the full
// section[aria-label="Agent activity"] only appears in the expanded layout.
await page.waitForTimeout(6000);
const evCount = await page.evaluate(
  () =>
    document.querySelectorAll('section[aria-label="Agent activity"] li').length ||
    document.querySelectorAll('aside[aria-label="NOVA compact assistant"] ul li').length,
);
check('Activity events stream in', evCount >= 3, `${evCount} events`);

// A real frame should arrive from the live browser
await page.waitForTimeout(4000);
const hasFrame = await page.evaluate(() => {
  const img = document.querySelector('section[aria-label="Real browser workspace"] img');
  return !!img && img.src.startsWith('data:image/jpeg') && img.naturalWidth > 0;
});
check('Live frame from the real browser is rendered', hasFrame);

await page.screenshot({ path: `${OUT}\\sim-2-executing.png` });

// --- Wait for the request to reach a terminal state --------------------------
// The compact panel always shows the live status badge.
let terminal = 'running';
for (let i = 0; i < 40; i++) {
  terminal = await page.evaluate(() => {
    const panel = document.querySelector('aside[aria-label="NOVA compact assistant"]');
    const badge = panel?.querySelector('.hud-mono.tracking-\\[0\\.16em\\]');
    return badge ? badge.textContent.trim() : null;
  });
  if (terminal && ['COMPLETED', 'FAILED', 'CANCELLED'].includes(terminal)) break;
  await page.waitForTimeout(1500);
}
check(
  'Request reaches a terminal state (not stuck in PROCESSING)',
  ['COMPLETED', 'FAILED', 'CANCELLED'].includes((terminal ?? '').trim()),
  terminal ?? 'none',
);
check('Zero console errors during execution', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

// --- Expand keeps history + browser visible ---------------------------------
await compactPanel.locator('button:has-text("Expand")').click();
await page.waitForTimeout(700);
check('Expand shows the expanded assistant', (await page.locator('aside[aria-label="NOVA assistant (expanded)"]').count()) > 0);
check('Browser workspace still visible when expanded', await page.locator('section[aria-label="Real browser workspace"]').isVisible());
check('Activity history preserved across expand', (await page.locator('section[aria-label="Agent activity"] li').count()) >= 3);
await page.screenshot({ path: `${OUT}\\sim-3-expanded.png` });

// --- No page-level scrolling in either tab ----------------------------------
const scroll = await page.evaluate(() => ({
  v: document.documentElement.scrollHeight <= window.innerHeight + 1,
  h: document.documentElement.scrollWidth <= window.innerWidth + 1,
}));
check('No vertical page scroll (simulation)', scroll.v);
check('No horizontal page scroll (simulation)', scroll.h);

await page.locator('[role="tab"]', { hasText: 'MAIN' }).click();
await page.waitForTimeout(900);
const mainScroll = await page.evaluate(() => ({
  v: document.documentElement.scrollHeight <= window.innerHeight + 1,
  h: document.documentElement.scrollWidth <= window.innerWidth + 1,
}));
check('No vertical page scroll (main, after returning)', mainScroll.v);
check('No horizontal page scroll (main, after returning)', mainScroll.h);
await page.screenshot({ path: `${OUT}\\sim-4-back-to-main.png` });

// --- Multi-viewport sanity (simulation tab) ---------------------------------
for (const vp of VIEWPORTS.slice(1)) {
  await page.setViewportSize(vp);
  await page.locator('[role="tab"]', { hasText: 'SIMULATION' }).click();
  await page.waitForTimeout(700);
  const s = await page.evaluate(() => ({
    v: document.documentElement.scrollHeight <= window.innerHeight + 1,
    h: document.documentElement.scrollWidth <= window.innerWidth + 1,
  }));
  check(`No page scroll at ${vp.width}x${vp.height} (simulation)`, s.v && s.h);
  await page.screenshot({ path: `${OUT}\\sim-${vp.width}x${vp.height}.png` });
}

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log('FAILED:');
  for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
  process.exit(1);
}
