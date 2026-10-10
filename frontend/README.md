# Handsfree — NOVA Voice Agent

Futuristic AI voice-assistant frontend with **two modes** behind one tab switcher:

- **MAIN** — the original console: a real-time **voice-reactive Three.js orb**, real microphone analysis (Web Audio API), real webcam preview, dictation + typed commands, an honest agent-activity timeline, and expanded/compact layouts.
- **SIMULATION** — submit a natural-language browser command, watch the assistant compact to the right, and follow a **real Chromium session** executing it (navigation, typing, clicking, scrolling, tabs) with a live frame stream and a truthful execution trace.

## Quick start

```bash
cd handsfree-nova
npm install

# Terminal 1 — the local browser-execution service (owns Chromium via Playwright)
npm run sim              # → http://127.0.0.1:8787  (ws://127.0.0.1:8787/ws)

# Terminal 2 — the frontend
npm run dev              # → http://localhost:5173

npm run build            # production build (tsc + vite)
npm run preview          # serve dist/
```

Node 20+ recommended (tested on Node 24, npm 11).

> The **MAIN** tab works with no service running. The **SIMULATION** tab needs `npm run sim`; the UI reports `SIM.OFFLINE` honestly when it is not reachable and never fabricates activity.

### Simulation service options

| Env var | Default | Meaning |
|---|---|---|
| `NOVA_SIM_PORT` | `8787` | Service port (bound to `127.0.0.1` only) |
| `NOVA_HEADLESS` | *(unset = windowed)* | `1` runs Chromium headless; frames stream either way |
| `NOVA_BROWSER_PATH` | *(auto)* | Explicit Chromium-family executable |
| `NOVA_PROFILE_DIR` | `server/.nova-profile` | Dedicated automation profile (never your personal one) |
| `NOVA_NAV_TIMEOUT` | `25000` | Navigation timeout (ms) |
| `NOVA_ACTION_TIMEOUT` | `12000` | Element action timeout (ms) |
| `VITE_NOVA_SIM_WS` / `VITE_NOVA_SIM_URL` | `ws://<host>:8787/ws` | Override the service endpoint from the frontend |

## What is real vs. pending integration

| Feature | Status |
|---|---|
| 3D computational core (holographic sphere, wireframe grid, 5 thin orbit rings, vertical energy axis, orbit particles, fresnel shell) | ✅ Real (Three.js / React Three Fiber) |
| Single-screen layout (`h-dvh`, no page scroll at 1920×1080 / 1366×768 / 1280×720) | ✅ Verified via headless Edge + Playwright measurements |
| Idle / listening / speech / thinking / error animations | ✅ Real, state-driven |
| Microphone → orb reactivity (RMS + low/mid/high bands, attack/release) | ✅ Real Web Audio API, no fake levels |
| Webcam preview (getUserMedia, permission states, cleanup) | ✅ Real |
| Speech dictation (Web Speech API adapter + typing fallback) | ✅ Real where browser supports it |
| **Simulation: real browser execution** (navigate, search field typing, click, scroll, tabs, back/forward) | ✅ Real Playwright automation of a dedicated Chromium |
| **Simulation: live workspace frames** | ✅ Real JPEG screenshots streamed from the live page |
| **Simulation: execution trace** | ✅ Real events emitted from actual operations with measured durations, observed URLs/titles, and verbatim errors |
| **Chrome extension (mobile side panel)** | ✅ MV3 extension: "Hey Nova" wake word, speech → orb → auto-execute, webcam toggle, expand to full webapp — drives the same execution service ([docs/EXTENSION.md](docs/EXTENSION.md)) |
| Command → runtime agent → timeline events (MAIN) | ⏳ Boundary only — agent reports `disconnected` until teammates connect the service |
| Head/hand tracking overlay | ⏳ Typed interface only, honestly "unavailable" |

The UI **never fabricates** browser actions, activity events, tracking results, or completions. When the local executor cannot interpret a command, it says so and stops; when an operation fails, the later steps are not shown as completed.

## Project layout

```
server/                             local browser-execution service (Node, ESM)
  index.js                          HTTP + WebSocket API, event log, broadcast
  browser.js                        BrowserManager — owns the Chromium process (playwright-core)
  interpreter.js                    bounded pattern-based NL interpreter (replaceable)
  engine.js                         ExecutionEngine — runs the plan, emits typed events
scripts/
  sim-test.mjs                      submit commands via HTTP, print the real event stream
  sim-ui-test.mjs                   end-to-end UI acceptance test (real headless Edge)
  sim-cancel-test.mjs               cancellation + concurrency-guard test
  gen-ext-icons.mjs                 generate the extension's PNG icons (no canvas dep)
  ext-load-test.mjs                 load the extension in Chromium, verify MV3 worker + panel boot
  ext-e2e-test.mjs                  open the panel, submit a real command, assert events flow
extension/                          NOVA Chrome extension (MV3, mobile side panel)
  manifest.json  background.js  offscreen.*  panel.*  icons/
src/
  app/store.tsx                     shared state machine (+ view tab)
  types/index.ts                    AppStatus, AgentEvent, AudioLevels, …
  features/audio/                   MicrophoneAnalyser + level bus
  features/speech/                  Web Speech adapter hook
  features/camera/                  getUserMedia hook
  features/agent/agentAdapter.ts    AgentAdapter + disconnected impl + useAgent (MAIN)
  features/simulation/              typed protocol + WebSocket client hook (SIMULATION)
  components/assistant/NovaOrb.tsx  R3F scene
  components/hud/                   TopBar (+ ViewSwitcher), rails, reticle, waveform
  components/simulation/            SimScreen, SimWorkspace, SimActivity, SimCompact
  components/command-input/  compact-assistant/  webcam/
docs/
  INTEGRATION.md                    runtime-agent contract (MAIN)
  SIMULATION.md                     execution-service contract + AI-agent integration
  EXTENSION.md                      Chrome extension: install, usage, architecture, limitations
```

## Simulation architecture

```
┌──────────────────────────┐   WebSocket (127.0.0.1:8787/ws)   ┌─────────────────────────────┐
│  React frontend           │ ◄──── events, frames, page ─────► │  server/index.js            │
│  useSimulation()          │ ──── submit / cancel ───────────► │  engine.js  (plan → steps)  │
│  SimWorkspace (live view) │                                   │  interpreter.js (patterns)  │
│  SimActivity (trace)      │                                   │  browser.js (Playwright)    │
└──────────────────────────┘                                   └──────────────┬──────────────┘
                                                                                │ drives
                                                                     ┌──────────▼──────────┐
                                                                     │ Dedicated Chromium  │
                                                                     │ (own profile)       │
                                                                     └─────────────────────┘
```

See [`docs/SIMULATION.md`](docs/SIMULATION.md) for the event schema, the supported command list, safety rules, known limitations, and how the future AI runtime agent plugs in.

## Testing

```bash
# Service-level acceptance (real browser): Test A/B/C/D/E
node scripts/sim-test.mjs "Open YouTube"
node scripts/sim-test.mjs "Search YouTube for Technical Guruji"
node scripts/sim-test.mjs "Open YouTube, search for Technical Guruji, find the latest video, and open it."
node scripts/sim-test.mjs "Open a new tab" "Go to example.com" "Go back" "Scroll down" "What's the url"
node scripts/sim-test.mjs "Book a flight to Mars" "Go to javascript:alert(1)"   # honest failures

# Cancellation + concurrency guard
node scripts/sim-cancel-test.mjs

# End-to-end UI (needs the dev server + sim service running)
node scripts/sim-ui-test.mjs

# Chrome extension (loads it in Playwright's bundled Chromium — see docs/EXTENSION.md)
npm run ext:load-test
npm run ext:e2e-test      # needs the sim service running
```

## Runtime-agent contract (MAIN)

See [`docs/INTEGRATION.md`](docs/INTEGRATION.md). Implement `AgentAdapter` (`submitRequest`, `subscribeToEvents`, `cancelRequest`, `getConnectionStatus`) with the real transport — no UI changes required.

## Privacy

Mic/camera start only on user action, stop releases all tracks, AudioContext is closed, mic is never routed to speakers, nothing is recorded or uploaded by the frontend. The simulation browser uses a **dedicated profile** (`server/.nova-profile`), the service binds to **localhost only**, no remote-debugging port is exposed, and only `http(s)` navigation is allowed (`javascript:`/`data:`/`file:` are blocked).
