// ext-speech-diag.mjs — find out exactly why voice isn't working in the panel.
// Uses a fake mic device so getUserMedia/SpeechRecognition can start headlessly,
// then reports: is SR available? does it start? what error fires? any results?
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
const userData = join(process.env.TEMP || process.env.TMP || ".", "nova-speech-diag");
try {
  rmSync(userData, { recursive: true, force: true });
} catch {}

const context = await chromium.launchPersistentContext(userData, {
  channel: "chromium",
  headless: false,
  args: [
    `--disable-extensions-except=${extDir}`,
    `--load-extension=${extDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    // Fake mic so we can start capture without real hardware/permission prompts.
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
  ],
});

let bg = null;
for (let i = 0; i < 20 && !bg; i++) {
  await new Promise((r) => setTimeout(r, 500));
  bg = context.serviceWorkers()[0] || null;
}
const extId = new URL(bg.url()).host;

// Grant mic/camera to the extension origin.
try {
  await context.grantPermissions(["microphone", "camera"], {
    origin: `chrome-extension://${extId}`,
  });
  console.log("granted microphone+camera to extension origin");
} catch (e) {
  console.log("grantPermissions failed:", e.message);
}

const panel = await context.newPage();
const consoleMsgs = [];
panel.on("console", (m) => consoleMsgs.push(`[${m.type()}] ${m.text()}`));
panel.on("pageerror", (e) => consoleMsgs.push(`[pageerror] ${e.message}`));
await panel.goto(`chrome-extension://${extId}/panel.html`);
await new Promise((r) => setTimeout(r, 1200));

// --- Independent probe: does SpeechRecognition work in this side panel? ---
const report = await panel.evaluate(async () => {
  const out = {};
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  out.hasSR = !!SR;
  out.SRname = window.SpeechRecognition ? "SpeechRecognition" : window.webkitSpeechRecognition ? "webkitSpeechRecognition" : null;

  // getUserMedia
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    out.mic = "ok tracks=" + s.getTracks().length;
    s.getTracks().forEach((t) => t.stop());
  } catch (e) {
    out.mic = `${e.name}: ${e.message}`;
  }

  if (SR) {
    await new Promise((resolve) => {
      const r = new SR();
      r.lang = "en-US";
      r.continuous = false;
      r.interimResults = true;
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      r.onstart = () => { out.onstart = true; };
      r.onerror = (e) => { out.onerror = e.error; out.onerrorMsg = e.message || ""; finish(); };
      r.onresult = (e) => {
        out.onresult = true;
        out.resultText = e.results[0][0].transcript;
        out.resultIsFinal = e.results[0].isFinal;
      };
      r.onend = () => { out.onend = true; finish(); };
      setTimeout(() => { out.timedOut = true; try { r.stop(); } catch {} finish(); }, 6000);
      try { r.start(); out.startCalled = true; } catch (e) { out.startThrew = String(e); finish(); }
    });
  }

  // Panel's own UI state (did its auto-start mic engage?)
  const micBtn = document.getElementById("micBtn");
  out.panelMicListening = micBtn ? micBtn.classList.contains("listening") : null;
  out.hint = document.getElementById("hint")?.textContent || "";
  out.transcript = document.getElementById("transcript")?.textContent || "";
  return out;
});

console.log("\n=== SPEECH DIAGNOSTIC (side panel) ===");
for (const [k, v] of Object.entries(report)) console.log(`  ${k}: ${JSON.stringify(v)}`);
console.log("\n=== PANEL CONSOLE ===");
console.log(consoleMsgs.length ? consoleMsgs.join("\n") : "  (none)");

await context.close();
