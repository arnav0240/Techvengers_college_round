# Techvengers — Hands-Free Control Suite 🖐️🎙️

Control computers without touching them — by **voice**, by **gesture**, by **head motion**.
One repo, four folder-wise components that run independently or together.

![Electron](https://img.shields.io/badge/Electron-39-47848F?logo=electron&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![MediaPipe](https://img.shields.io/badge/MediaPipe-Tasks_Vision-0097A7?logo=google&logoColor=white)
![ydotool](https://img.shields.io/badge/ydotool-uinput-2ECC71)
![Platform](https://img.shields.io/badge/Linux-Wayland%20%2F%20X11-FCC624?logo=linux&logoColor=black)

---

## 🗺️ Repo map

```
Techvengers_college_round/
├── frontend/                   🎙️ NOVA voice agent — React webapp + browser-execution service + Chrome extension
├── gesture-control-component/  📷 Streamlined gesture component — video feed + banners only (this round's build)
│   └── electron-app/
└── Pyauto_cmds/                🖱️ OS input bridge — tiny HTTP server turning gestures into real cursor/keys
```

| Folder | What it is | Run it |
|---|---|---|
| `frontend/` | NOVA voice assistant: voice-reactive orb, mic + webcam, typed/dictated commands, simulated Chromium execution with live frames | `npm install` → `npm run sim` + `npm run dev` |
| `gesture-control-component/` | Drop-in streamlined build: same tracking pipeline, UI is just the video frame + status banners | `npm install` → `npm run dev` |
| `Pyauto_cmds/` | `ydotool`-backed bridge on `127.0.0.1:8765` (moves the real Wayland cursor where PyAutoGUI can't) | `./daemon.sh &` + `./run.sh` |

---

## ✨ Spotlight: `gesture-control-component`

The competition build. The **entire** gesture-control tracking pipeline —
MediaPipe face + hand landmarkers, gesture classifier, head-cursor physics —
with every control stripped away. What you see is all there is:

```
┌─────────────────────────────────────┐
│  ● LIVE                             │
│  ┌───────────────────────────────┐  │
│  │                               │  │
│  │        📷 video feed          │  │
│  │     + landmark overlay        │  │
│  │                               │  │
│  │              SCROLL MODE  [🧭] │  │
│  │              SCROLL UP    [🟢] │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
```

- 📷 **Video feed** with mirrored selfie view + live landmark/axis overlay
- 🧭 **Mode banner** — `SCROLL MODE` / `CURSOR MODE`
- 🟢 **Command banner** — `SCROLL UP`, `SCROLL DOWN`, `CLICK`, `PAUSED`, … (holds 1.5s so it reads like a sign)
- 🔌 **Zero-click backend** — the app auto-starts `Pyauto_cmds` (`ydotoold` via a one-time password prompt, then the `:8765` server) and auto-links + auto-calibrates. Open it, look at it, drive.

### Gestures

| Sign | Do this | You get |
|:----:|---|---|
| 🗺️ | Lean head out of the stop-circle, hold | Cursor moves — farther lean = faster; back inside = stop |
| 🤏 | Pinch thumb + index, release to re-arm | **CLICK** where the cursor is |
| ☝️ / 👇 | Point index up / down and hold | **SCROLL UP / DOWN**, repeats while held |
| 🖐️ | Open palm, hold still | **PAUSED** — any gesture resumes |
| ✊ / ✌️ | Fist / two fingers, hold briefly | **CURSOR** / **SCROLL** mode |
| 👍 / 👎 | Thumb up / down | `Enter` / `Escape` |

### Run it

```bash
cd gesture-control-component/electron-app
npm install
npm run dev        # approve the one-time ydotoold password prompt
```

Look straight ahead for a second on startup (auto-calibration), then lean.
Details live in [`gesture-control-component/electron-app/README.md`](gesture-control-component/electron-app/README.md).

---

## 🔌 `Pyauto_cmds` — the OS bridge

PyAutoGUI only speaks X11 — on GNOME/Wayland its moves are silent no-ops.
This stdlib-only Python server prefers **`ydotool`** (uinput injection, moves the
real compositor cursor) with PyAutoGUI fallback, and reports the live backend
on every response. Full API + troubleshooting:
[`Pyauto_cmds/README.md`](Pyauto_cmds/README.md).

```bash
sudo apt install -y ydotool
./daemon.sh &      # sudo ydotoold, socket kept in-folder
./run.sh           # bridge on 127.0.0.1:8765
curl -s localhost:8765/health   # want "backend": "ydotool"
```

---

## 🧰 Requirements

- **Linux** with Node 20+ and Python 3 (tested on Ubuntu 24.04, Node 24)
- **Webcam** + **internet once** (MediaPipe models download on first run, then cached)
- `ydotool` for real cursor control on Wayland (`sudo apt install -y ydotool`)

## 🛠️ Tech stack

Electron · React · TypeScript · MediaPipe Tasks-Vision (Face + Hand Landmarkers) ·
Playwright/Chromium (simulation service) · Three.js (NOVA orb) · ydotool/uinput ·
Python stdlib HTTP bridge — zero native gesture deps, all coordinates normalized `0–1` end to end.
