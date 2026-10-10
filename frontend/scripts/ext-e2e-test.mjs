// ext-e2e-test.mjs — end-to-end: open the NOVA side panel, submit a real
// command through it, and verify typed events flow back from the simulation
// service. Also captures a screenshot of the mobile layout.
import { chromium } from "playwright-core";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { execSync } from "node:child_process";
import { rmSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rawExt = join(__dirname, "..", "extension");
const extDir = execSync(
  `(New-Object -ComObject Scripting.FileSystemObject).GetFolder("${rawExt}").ShortPath`,
  { shell: "powershell.exe", encoding: "utf8" },
).trim();
const userData = join(process.env.TEMP || process.env.TMP || ".", "nova-ext-e2e");
try {
  rmSync(userData, { recursive: true, force: true });
} catch {}

let failures = 0;
const check = (ok, label) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failures++;
};

const context = await chromium.launchPersistentContext(userData, {
  channel: "chromium",
  headless: false,
  args: [
    `--disable-extensions-except=${extDir}`,
    `--load-extension=${extDir}`,
    "--no-first-run",
    "--no-default-browser-check",
  ],
});

// Wait for the background SW so we can derive the extension id.
let bg = null;
for (let i = 0; i < 20 && !bg; i++) {
  await new Promise((r) => setTimeout(r, 500));
  bg = context.serviceWorkers()[0] || null;
}
if (!bg) {
  console.log("FAIL  background service worker registered");
  await context.close();
  process.exit(1);
}
const extId = new URL(bg.url()).host;

const panel = await context.newPage();
panel.on("pageerror", (e) => console.log("  pageerror:", String(e)));
await panel.goto(`chrome-extension://${extId}/panel.html`);
await panel.setViewportSize({ width: 400, height: 760 });

// 1) Panel connects to the running simulation service.
let svc = "";
for (let i = 0; i < 20; i++) {
  svc = await panel.locator("#serviceState").textContent();
  if (svc === "connected") break;
  await new Promise((r) => setTimeout(r, 500));
}
check(svc === "connected", `panel connects to service (got "${svc}")`);

// 2) Submit a real command through the panel's text field.
await panel.fill("#typeBox", "open youtube");
await panel.press("#typeBox", "Enter");

// 3) The request should leave "idle" and start accepting events.
let reqState = "";
for (let i = 0; i < 20; i++) {
  reqState = await panel.locator("#requestState").textContent();
  if (reqState && reqState !== "idle") break;
  await new Promise((r) => setTimeout(r, 400));
}
check(reqState !== "idle", `request state leaves idle (got "${reqState}")`);

// 4) Events must actually arrive (real operations → typed events). Distinguish
//    real events from the "Waiting for the first event…" placeholder (which also
//    matches .event but carries the event-muted class).
let realEvents = 0;
const seenTitles = [];
for (let i = 0; i < 40; i++) {
  const items = await panel.locator("#eventList .event").all();
  const titles = [];
  for (const it of items) {
    const cls = (await it.getAttribute("class")) || "";
    if (!cls.includes("event-muted")) titles.push((await it.textContent()).trim());
  }
  if (titles.length > realEvents) {
    realEvents = titles.length;
    seenTitles.length = 0;
    seenTitles.push(...titles);
  }
  if (realEvents > 0) break;
  await new Promise((r) => setTimeout(r, 500));
}
check(realEvents > 0, `real events render in the panel (${realEvents})`);
if (seenTitles.length) console.log(`      first events: ${seenTitles.slice(0, 4).join(" | ")}`);

// 5) Wait for the request to finish (completed / failed / cancelled / busy —
//    i.e. a terminal state, never stuck in accepted/running).
const isTerminal = (s) =>
  !!s && /^(completed|failed|cancelled|busy)( ·|$)/.test(s);
let finalState = "";
let closedReason = "";
for (let i = 0; i < 60; i++) {
  try {
    finalState = await panel.locator("#requestState").textContent({ timeout: 3000 });
    if (isTerminal(finalState)) break;
  } catch (e) {
    closedReason = String(e.message || e).split("\n")[0];
    break;
  }
  await new Promise((r) => setTimeout(r, 1000));
}
if (closedReason) {
  console.log(`      page unavailable: ${closedReason}`);
  console.log(`      browser isConnected: ${context.browser()?.isConnected?.() ?? "n/a"}`);
}
check(
  isTerminal(finalState),
  `request reaches terminal state (got "${finalState || closedReason}")`,
);

// 6) Capture the mobile layout.
const shot = join(__dirname, "..", "extension-panel.png");
try {
  await panel.screenshot({ path: shot });
  console.log(`      screenshot: ${shot}`);
} catch (e) {
  console.log(`      screenshot failed: ${String(e.message || e).split("\n")[0]}`);
}

// 7) The progress bar reflects completion.
try {
  const width = await panel.locator("#progressFill").evaluate((el) => el.style.width);
  console.log(`      progress width: ${width}`);
} catch {
  /* page gone */
}

await panel.close();
await context.close();

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
