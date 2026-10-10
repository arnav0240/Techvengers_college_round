// ext-load-test.mjs — load the NOVA extension into Playwright's bundled
// Chromium (Chrome for Testing, non-branded) and verify the MV3 background
// service worker registers and the chrome.* APIs are wired correctly.
//
// NOTE: branded Google Chrome / Edge (137+) block --load-extension, so we test
// against the non-branded "chromium" channel. Loading the extension manually in
// the user's own Chrome (chrome://extensions → Load unpacked) is unaffected.
import { chromium } from "playwright-core";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { execSync } from "node:child_process";
import { rmSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rawExt = join(__dirname, "..", "extension");
// The workspace path has a space ("ARNAV BRAHMANE"); use the 8.3 short path so
// --load-extension parses cleanly.
const extDir = execSync(
  `(New-Object -ComObject Scripting.FileSystemObject).GetFolder("${rawExt}").ShortPath`,
  { shell: "powershell.exe", encoding: "utf8" },
).trim();

const userData = join(process.env.TEMP || process.env.TMP || ".", "nova-ext-profile");
try {
  rmSync(userData, { recursive: true, force: true });
} catch {}

let failures = 0;
const check = (ok, label) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failures++;
};

const context = await chromium.launchPersistentContext(userData, {
  channel: "chromium", // non-branded Chrome for Testing → --load-extension works
  headless: false,
  args: [
    `--disable-extensions-except=${extDir}`,
    `--load-extension=${extDir}`,
    "--no-first-run",
    "--no-default-browser-check",
  ],
});

// Wait for the service worker to register.
let bg = null;
for (let i = 0; i < 20 && !bg; i++) {
  await new Promise((r) => setTimeout(r, 500));
  const sws = context.serviceWorkers();
  bg = sws.find((w) => w.url().includes("background")) || sws[0] || null;
}

check(!!bg, "background service worker registered");

if (bg) {
  console.log(`      SW url: ${bg.url()}`);
  const ok = await bg
    .evaluate(() => typeof chrome !== "undefined" && !!chrome.runtime?.id)
    .catch(() => false);
  check(ok, "chrome.runtime available in service worker");

  const hasSidePanel = await bg.evaluate(() => !!chrome.sidePanel).catch(() => false);
  check(hasSidePanel, "sidePanel API exposed");

  const hasOffscreen = await bg.evaluate(() => !!chrome.offscreen).catch(() => false);
  check(hasOffscreen, "offscreen API exposed");

  const hasAction = await bg.evaluate(() => !!chrome.action).catch(() => false);
  check(hasAction, "action API exposed");
}

// Open the panel (mobile layout) directly and verify it boots cleanly.
const extId = bg ? new URL(bg.url()).host : null;
if (extId) {
  const panel = await context.newPage();
  const errors = [];
  panel.on("pageerror", (e) => errors.push(String(e)));
  panel.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await panel.goto(`chrome-extension://${extId}/panel.html`);
  await new Promise((r) => setTimeout(r, 1500));

  const orbPresent = await panel.locator("#orb").count();
  check(orbPresent === 1, "panel renders the orb");

  const transcript = await panel.locator("#transcript").count();
  check(transcript === 1, "panel has the speech transcript field");

  // The panel should reach a definite service state (connected or disconnected),
  // never hang in "connecting…" forever — the sim service may not be running.
  const svc = await panel.locator("#serviceState").textContent();
  const settled = svc && svc !== "connecting…";
  check(settled, `service state settles (got "${svc}")`);

  const hint = await panel.locator("#hint").textContent();
  check(!!hint && hint.length > 0, `hint text present ("${hint}")`);

  // Buttons wired: mic, webcam, expand.
  const micBtn = await panel.locator("#micBtn").count();
  const camBtn = await panel.locator("#webcamBtn").count();
  const expandBtn = await panel.locator("#expandBtn").count();
  check(micBtn && camBtn && expandBtn, "controls present (mic / webcam / expand)");

  check(errors.length === 0, `panel console clean (${errors.length} errors)`);
  if (errors.length) console.log("      errors:", errors.slice(0, 5));

  await panel.close();
} else {
  check(false, "extension id derived from service worker");
}

await context.close();

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
