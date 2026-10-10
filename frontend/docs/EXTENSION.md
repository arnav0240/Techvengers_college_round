# NOVA Chrome Extension

A mobile-layout companion for Handsfree — NOVA that lives in Chrome's **side
panel**. Say **"Hey Nova"**, speak a browser command, and watch it execute in a
real Chrome window driven by the local simulation service. Expand any time to
jump into the full NOVA webapp.

```
extension/
├── manifest.json     MV3 manifest (side panel + offscreen + permissions)
├── background.js     service worker: opens the side panel, coordinates the mic
├── offscreen.html/js background "Hey Nova" wake-word listener (panel closed)
├── panel.html/css/js the mobile layout + speech + execution client
└── icons/            generated PNG icons (16/48/128)
```

---

## 1. Loading the extension

> **Important:** Since **Chrome 137**, branded Google Chrome disables the
> `--load-extension` command‑line flag for security. The extension therefore
> must be loaded **once, manually**, through the extensions page (this is the
> normal way to install a local/unpacked extension and is unaffected by the
> flag removal):

1. Open `chrome://extensions` in Chrome.
2. Turn **Developer mode** on (toggle, top‑right).
3. Click **Load unpacked** and select this project's `extension/` folder.
4. Pin the **NOVA** icon to the toolbar (puzzle‑piece menu → pin).

Click the **NOVA** toolbar icon to open the mobile side panel.

> Requires **Chrome 116+** (for the `sidePanel` API).

---

## 2. Using it

| Step | What happens |
|------|--------------|
| **Open the panel** | Click the NOVA toolbar icon → the mobile side panel opens. |
| **Say "Hey Nova"** | The panel's microphone arms the assistant (the orb pulses). You can also just tap the mic button. |
| **Speak your command** | Your speech is transcribed live **into the centre of the orb**. |
| **Stop speaking** | After ~1.8 s of silence the command auto‑submits to the service and starts executing. |
| **Watch it run** | Real typed events stream into the ACTIVITY list; the progress bar and request status update live. |
| **Webcam** | `CAM` toggles a small mirrored preview on the orb. |
| **Expand** | `EXPAND` opens the full NOVA webapp (`http://localhost:5173`) in a new tab. |
| **Type instead** | The text field (and ▶ button) submit a command without voice. |

### Wake word while the panel is closed
An **offscreen document** keeps listening for "Hey Nova" while the side panel is
closed. When heard, it sets an `ON` badge and *attempts* to open the side panel.
Chrome may require a **user gesture** to programmatically open a side panel, so
if it doesn't auto‑open, click the toolbar icon once — the badge tells you the
wake word was heard. This handoff also guarantees only one document owns the
microphone at a time (offscreen = wake word when closed, panel = command
dictation when open).

---

## 3. How it works

The extension is a thin client over the **same simulation service** that powers
the webapp's SIMULATION tab (`npm run sim`, `ws://127.0.0.1:8787/ws`):

```
microphone ─► Web Speech API ─► transcript on orb
                                   │  (silence > 1.8s)
                                   ▼
panel.js ── {type:'submit', requestId, command} ──► sim service (ws:8787)
   ▲                                                     │
   └──── {type:'event', event} / {type:'result', …} ◄────┘  (typed, real ops)
```

* **Speech gating** — the first utterance is matched against the wake word
  (`hey nova` / `nova`). Only once armed does the following speech become the
  command; the wake word itself is stripped from the command text. Anything you
  say *before* arming is still shown on the orb (with a "Start with **Hey
  Nova**" hint) so you can always see the mic is hearing you.
* **Stale‑request filtering** — events whose `requestId` doesn't match the
  in‑flight request are dropped (identical to the webapp client).
* **Protocol** — the panel consumes the real message shapes produced by
  `server/index.js`: `{type:'event', event}` and `{type:'request', request}`
  are *nested*; `accepted` / `result` are *flat*. Request statuses are
  `accepted → running → completed | failed | cancelled | busy`.
* **Expand** — simply opens the full webapp in a tab; no reload of the panel.

---

## 4. Requirements

* Simulation service running: `npm run sim` (port `8787`). The panel shows
  `Service: connected` when it's reachable, and an honest failure state when not.
* Webapp running for **Expand**: `npm run dev` (port `5173`).
* Microphone permission (granted on first use) for voice; camera permission for
  the webcam toggle.

---

## 5. Honest limitations

* **Wake‑word reliability** depends on Chrome's network speech service
  (SpeechRecognition). It requires microphone permission and, in practice, an
  internet connection. If unavailable, use the **mic button** or the **text
  field** — both exercise the exact same execution path.
* **First mic access** may require a user gesture (a tap on the mic) depending on
  the browser's autoplay/permission policy; afterwards it auto‑listens.
* **Opening the side panel from the wake word** is best‑effort because Chrome
  gates programmatic side‑panel opening behind a user gesture (see §2).
* The extension **executes in a separate Chrome window** (the automation browser
  launched by the sim service), not inside your current tab — this is the honest
  behaviour of a browser automation backend.

---

## 6. Tests

The extension is verified with Playwright against Playwright's **bundled
Chromium** (non‑branded), because branded Chrome/Edge 137+ block
`--load-extension`:

```bash
npm run ext:load-test   # loads the extension, verifies the MV3 service worker + panel boot
npm run ext:e2e-test    # opens the panel, submits a real command, asserts events flow
```

Both suites are expected to print `ALL PASS`. Regenerate icons with
`npm run ext:icons`.
