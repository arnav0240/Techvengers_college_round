# NOVA Simulation mode — execution-service contract

Simulation mode runs natural-language browser commands against a **real Chromium session** driven by Playwright, and streams a truthful execution trace back to the UI. This document is the contract between the four layers, and the place a future AI runtime agent plugs in.

## 1. Layers

| Layer | File(s) | Responsibility |
|---|---|---|
| Frontend UI | `src/components/simulation/*` | Renders the workspace (live frames, URL, tabs), the activity trace, and the compact assistant |
| Frontend transport | `src/features/simulation/useSimulation.ts`, `types.ts` | WebSocket client, event buffering for the *current* request, `submit` / `cancel` |
| Command interpretation | `server/interpreter.js` | Bounded pattern-based natural-language → ordered plan. **Replaceable.** |
| Browser automation | `server/browser.js`, `server/engine.js` | Owns the Chromium process; executes the plan; emits typed events from real results |

## 2. Starting the service

```bash
npm run sim          # node server/index.js → http://127.0.0.1:8787
```

The service binds to `127.0.0.1` only. It does **not** expose a remote-debugging port. Chromium runs in a **dedicated profile** (`server/.nova-profile`, git-ignored) so it never touches a personal browser profile.

## 3. Protocol

### HTTP

| Method | Path | Body | Response |
|---|---|---|---|
| `GET` | `/api/health` | — | `{ ok, service, browser, executing, supportedPatterns }` |
| `POST` | `/api/request` | `{ command, requestId? }` | `202 { ok, requestId }` or `400 { ok:false, error }` |
| `POST` | `/api/cancel` | `{ requestId? }` | `{ ok, cancelled }` |
| `GET` | `/api/requests` | — | `{ requests: [...] }` |
| `GET` | `/api/requests/:id` | — | `{ request, events }` |

### WebSocket — `ws://127.0.0.1:8787/ws`

Client → server: `{type:'submit', requestId, command}` · `{type:'cancel', requestId?}` · `{type:'frame-now'}` · `{type:'ping'}`

Server → client:

| `type` | Payload | Meaning |
|---|---|---|
| `hello` | `browser, frame, requests, executing, supportedPatterns` | Full snapshot on connect (recovers after refresh) |
| `browser` | `{state, headless, error, description}` | Browser lifecycle: `idle \| starting \| ready \| error \| crashed` |
| `frame` | `{t, dataUrl}` | Live JPEG screenshot of the active page (~2–5 fps) |
| `page` | `SimPageSnapshot` | Real title, URL, and tab list |
| `event` | `SimEvent` | One execution-trace entry |
| `request` | `SimRequest` | Request status changes |
| `result` | `{requestId, status, summary}` | Terminal result |
| `accepted` | `{requestId, command}` | Submit acknowledged (correlates by client `requestId`) |
| `error` | `{message}` | Rejection (e.g. another request is running) |

## 4. Event schema

```ts
interface SimEvent {
  id: string;            // `${requestId}#${n}`
  requestId: string;
  timestamp: number;     // epoch ms
  type: 'lifecycle' | 'plan' | 'browser' | 'navigation'
      | 'interaction' | 'observation' | 'verification' | 'error';
  title: string;
  description: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'waiting_confirmation';
  url?: string;          // live browser URL when relevant
  durationMs?: number;   // measured wall-clock duration of the operation
  error?: string;        // verbatim failure message
}
```

Every event is generated from a **real operation result** — a measured duration, an observed URL/title, an observed element count, or a caught error. Nothing is invented. If a step fails, execution stops and later steps are **not** reported as completed.

## 5. Supported commands

The local interpreter is deliberately bounded. It understands:

- `Open <site>` / `Go to <url>` / `Visit …` — e.g. `Open YouTube`, `Go to github.com`
- `Search <site> for <text>` — types into the **real search field** and submits
- `Search <text>` / `Look up <text>` — uses the current site, else Google
- `Find/open/play the latest video and open it` — inspects real results, picks with an explicit strategy
- `Click <link text>` · `Type <text> into <field>`
- `Scroll down` / `Scroll up` / `Scroll to top` / `Scroll to bottom`
- `Go back` / `Go forward`
- `Open a new tab` / `Switch to tab 2` / `Close tab`
- `Read the title` / `What's the url`

Composite commands are split on commas/`and`/`then`, and context flows between clauses — so `Open YouTube, search for X, find the latest video, and open it.` searches **YouTube**, not Google.

Recognised sites (home URL, real search-field selectors, direct search URL, result selectors): YouTube, Google, Bing, DuckDuckGo, GitHub, Reddit, Wikipedia, Stack Overflow, X, Amazon, plus navigation-only entries (ChatGPT, Claude, Gmail, Maps, Drive, Netflix, LinkedIn, Facebook, Instagram, Twitch, Medium).

### Honest selection strategy

When opening a result, the event states the strategy that was actually used. Because the page is **not** filtered by upload date by default, the trace explicitly says `"latest" is NOT verified — this is the top relevance-ranked match for the query` rather than claiming to have found the newest video.

## 6. Safety rules

- Only `http(s)` navigation. `javascript:`, `data:`, `file:`, `blob:`, `about:`, `chrome:`, `devtools:` are rejected with a specific message.
- Service binds to `127.0.0.1`; no remote-debugging port is exposed.
- Dedicated automation profile; never the personal browser profile.
- One request at a time — a second `submit` while busy is refused with `400`, so two requests never fight over the same page.
- Commands are length-capped (400 chars) and validated; no shell is ever executed from prompt text.
- Navigation/action timeouts are enforced; missing elements and crashes are reported verbatim.
- Cancellation is checked between steps (long page operations cannot always be interrupted mid-flight; the request then finishes as `cancelled` after the current step).
- No CAPTCHA-solving, authentication bypass, or access-restriction circumvention is attempted. Consequential-action confirmation hooks (`waiting_confirmation`) exist in the schema for future use.

## 7. Known limitations

- **Cannot embed a native window in a web page.** The workspace shows a live JPEG frame stream from the real page (2–5 fps) plus the real URL, title, and tab strip. When run windowed (the default), a native Chromium window is *also* open on the desktop; `NOVA_HEADLESS=1` suppresses it and the frames remain the live view.
- The interpreter is pattern-based, not an LLM. Unrecognised phrasings fail honestly with the supported list.
- Result selection is strategy-driven (first organic / title match), not semantic ranking.
- Sites that block automation (e.g. Google's `sorry` interstitial) are reported as they appear — no circumvention.
- Frame streaming is JPEG at ~2–5 fps, not video; it is a live view, not a recording.

## 8. Connecting the real AI runtime agent

The interpreter is the single replaceable seam. Two integration paths, no UI redesign required:

1. **Replace the interpreter.** Keep the transport and engine; swap `interpret()` for a call to your agent that returns the same plan shape (`{op, ...}` steps). Everything downstream — events, frames, cancellation — is unchanged.

2. **Let the agent drive and stream its own events.** The agent speaks the WebSocket protocol above: accept with `accepted`, emit `event` messages using the schema in §4, push `frame`/`page` for the workspace, and finish with `result`. The frontend already renders any conforming stream and ignores stale `requestId`s.

Either way the UI consumes the same typed `SimEvent`s, so progress reporting stays truthful by construction — the agent is the source of every claim on screen.
