# Pyauto_cmds 🖱️

OS-level input bridge for [`../gesture-control`](../gesture-control): a tiny zero-dependency HTTP server that turns the app's normalized gesture commands into **real cursor moves, clicks, scrolls, and keys**.

## Why ydotool?

PyAutoGUI only speaks X11. On GNOME/Wayland its `moveTo`/`click` are **silent no-ops** (verified: cursor never budges, no error). So this server prefers **`ydotool`** (uinput injection — moves the real compositor cursor on Wayland *and* X11) and keeps PyAutoGUI as fallback. `/health` always reports which backend is live.

## Files

| File | What |
|---|---|
| `daemon.sh` | Starts `sudo ydotoold` with its socket **in this folder** (`./.ydotool_socket`, mode `0666`) — survives `/tmp` wipes, no `chmod` needed after restarts |
| `run.sh` | Wayland-safe launcher for the server (XWayland auth fix, `DISPLAY=:0`) |
| `pyautogui_server.py` | The bridge: stdlib `http.server` on `127.0.0.1:8765`, no pip deps beyond `pyautogui` |

## Quickstart

```bash
sudo apt install -y ydotool          # once
./daemon.sh &                        # sudo password, daemon stays up
./run.sh                             # the bridge (foreground; Ctrl+C to stop)
curl -s localhost:8765/health        # want "backend": "ydotool"
```

Then in the Electron app press **Launch Browser** (it health-checks this server), **Calibrate neutral**, and lean.

> Reboot reminder: sockets can't persist — after a reboot just `./daemon.sh &` again and you're back. If moves stop with `ydotool failed rc=2` in the log, the daemon died; restart it (the server self-heals on its next probe, no restart needed).

## API

Base `http://127.0.0.1:8765`. **All positions are normalized `0–1`** (the app never sends pixels).

| Method | Endpoint | Body | Effect |
|---|---|---|---|
| GET | `/health` | — | `{ok, screen:{w,h}, backend}` |
| POST | `/moveRel` | `{dx, dy}` | **Head-cursor step:** `X += dx×W`, `Y += dy×H`. Only sent while moving — idle sends nothing so a physical mouse wins |
| POST | `/move` | `{x, y}` | Absolute move (legacy fallback) |
| POST | `/clickCurrent` | `{}` | Left-click where the cursor already is (relative mode — never yanks the mouse) |
| POST | `/click` | `{x, y}` | Move + click at normalized pos (legacy) |
| POST | `/wheel` | `{dy}` | Scroll tick in Playwright px (`∓500`): Up/Down arrows ×~4 on the **focused** window (ydotool has no wheel axis) |
| POST | `/nav` | `{where: back\|forward}` | `Alt+Left` / `Alt+Right` |
| POST | `/key` | `{key: Enter\|Escape}` | `Enter` / `Esc` |

Behavior notes: `FAILSAFE` is off (edge-to-edge control must reach screen corners); every handler is fire-and-forget with a 25Hz tick in mind — one bad tick logs but never crashes the loop.

## Troubleshooting

| Symptom | Cause → fix |
|---|---|
| `OSError: Address already in use` | Another server holds `:8765` → kill it, run only one `./run.sh` |
| `[mover] ydotool failed rc=2` | Daemon dead or socket unreachable → `./daemon.sh &`, check `./.ydotool_socket` exists |
| `backend: pyautogui`, cursor still | Expected on Wayland — PyAutoGUI can't inject there; start the daemon |
| Scroll too jumpy / slow | Tweak taps in the `/wheel` handler (`seq = [...] * taps`) |
