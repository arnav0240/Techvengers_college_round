# Gesture Control 🖐️

Hands-free desktop control via webcam. An Electron app that turns **head motion into a relative OS cursor** and **hand poses into clicks, scrolls, and commands** — no touching the mouse.

> Companion: [`../Pyauto_cmds`](../Pyauto_cmds) — the OS-level input bridge (required for the real cursor on Wayland).

## How it works

```
webcam ─┬─ Face Landmarker ─> nose tip ─> HeadCursorController ─> relative deltas ─┐
        └─ Hand Landmarker ─> 21 landmarks ─> GestureDetector ─> gesture ─> action ─┤
                                                                                    ▼
                                                              Electron bridge ─> Pyauto_cmds ─> OS cursor / keys
```

**Head cursor (relative, not absolute).** Calibrate once looking straight ahead — that locks the *neutral* nose point. Leaning out of the stop-circle moves the cursor; the farther you lean, the faster it goes (progressive acceleration, capped). Drifting back inside *stops* it where it is — it never snaps back to center, and a physical mouse works untouched while you're idle.

**All coordinates are normalized `0–1`.** MediaPipe returns normalized landmarks; the app integrates them into normalized deltas (`X_os += dx × screenW`). Pixel math happens only at the OS bridge.

## Gestures

| Do this | Action |
|---|---|
| 🗺️ Lean head out of circle | Move cursor (farther = faster) |
| 🤏 Pinch thumb + index (release to re-arm) | **CLICK** at current cursor |
| ☝️ Point index up / down, hold (scroll mode) | **SCROLL UP / DOWN** (repeats) |
| 🖐️ Open palm, hold ~0.4s | **PAUSED** (any gesture resumes) |
| ✊ Fist, hold briefly | **CURSOR mode** badge |
| ✌️ Two fingers, hold 0.7s | **SCROLL mode** badge (default) |
| 👍 Thumbs up | **CONFIRM** + `is_confirm=True` (change-only) |
| 👎 Thumbs down | **CANCEL** + `is_confirm=False` (change-only) |

Sideways points read as neutral (no action). The on-screen debug readout shows live detector internals + `is_confirm` + a `gesture-confirm` window event fires on every flip.

## Run

```bash
cd gesture-control
npm install
npm start          # Electron — allow the camera when asked
```

In the app, in order:

1. **Launch Browser** — links the OS bridge (needs `../Pyauto_cmds/run.sh` running; button shows `LINKED`).
2. **Calibrate neutral** — look straight ahead, hold still, press it. The XY stop-circle appears at your nose.
3. Lean gently out of the circle → cursor moves. Pinch → clicks.

Sliders: **Sensitivity** (cursor speed) and **Stop-circle radius** (dead zone). **Recentre cursor** only resets the in-app preview anchor.

## Scripts

| Command | What |
|---|---|
| `npm start` / `npm run dev` | Run the Electron app |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` / `lint:fix` | `oxlint` + `oxfmt` check / fix |
| `npm run package` / `make` | Build installers |

## Structure

```
src/
├── vision/        camera.ts, hand-landmarker.ts, face-landmarker.ts (MediaPipe, VIDEO mode)
├── gestures/      gesture-detector.ts (static-pose classifier), confirm-tracker.ts (edge bool)
├── controller/    head-cursor-controller.ts (relative velocity + dead zone),
│                  gesture-controller.ts (pose → command), cursor-controller.ts (smoother)
├── browser/       os-driver.ts (HTTP → Pyauto_cmds), playwright-driver.ts (CDP fallback),
│                  cdp-client.ts
├── renderer.ts    loop: detect → classify → move/click/scroll + overlay widgets
├── main.ts        Electron main + IPC (absolute + relative channels)
└── preload.ts     sandboxed bridge (move, moveRel, clickCurrent, wheel, key, …)
```

## Notes / limits

- Face models download once from Google storage (~8MB hand model) — first run needs internet.
- **Wayland:** PyAutoGUI alone silently can't move the cursor — the bridge uses `ydotool` + `ydotoold` (see `../Pyauto_cmds/README.md`). The Playwright driver (`browser/playwright-driver.ts`) is a no-sudo fallback that drives its own Chromium window instead of the OS.
- Scroll/keys go to whichever window is **focused** — pinch-click a window first, then scroll.
