#!/usr/bin/env python3
"""PyAutoGUI OS-cursor server — sibling of gesture-control/ (../Pyauto_cmds/).

Speaks the exact API src/browser/os-driver.ts expects:
  GET  /health          -> { ok:true }
  POST /move     {x,y}  -> absolute, normalized 0..1  (legacy fallback)
  POST /moveRel  {dx,dy}-> RELATIVE head-cursor step, normalized deltas:
                          X_os += dx * screenW  (only fires while moving;
                          idle dead-zone sends nothing, so physical mouse wins)
  POST /click    {x,y}  -> click at normalized pos (legacy)
  POST /clickCurrent {} -> click where the OS cursor already is (relative mode)
  POST /wheel    {dy}   -> scroll, Playwright-pixel units (∓500)
  POST /nav      {where: back|forward}
  POST /key      {key: Enter|Escape}

Run via ./run.sh (fixes XWayland auth, sets DISPLAY=:0).
Port: 8765.
"""

import json
import os
import shutil
import subprocess
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

import pyautogui

# Edge-to-edge head control MUST reach screen corners — failsafe would throw
# every time the cursor hits (0,0). No delay between 25Hz ticks.
pyautogui.FAILSAFE = False
pyautogui.PAUSE = 0

PORT = 8765

# --- Mover backend: ydotool (Wayland/uinput) preferred, pyautogui fallback.
# PyAutoGUI only speaks X11: on GNOME/Wayland its moveTo/moveRel are silent
# no-ops (verified: position never changes). ydotool injects via uinput, so
# it moves the real compositor cursor. Needs: `sudo apt install ydotool` +
# a running `ydotoold` (see run.sh notes). We probe the daemon and fall back
# gracefully when it is absent.
# ydotoold socket lives INSIDE this folder (not /tmp, which gets wiped) —
# see daemon.sh. Default explicitly so even a bare
# `python3 pyautogui_server.py` finds the daemon.
os.environ.setdefault(
    "YDOTOOL_SOCKET",
    os.path.join(
        os.path.dirname(os.path.abspath(__file__)), ".ydotool_socket"
    ),
)
YDTOOL = shutil.which("ydotool")
_yd_down_until = 0.0  # backoff: skip broken-daemon probes for a few seconds


def ydotool(args, timeout=3):
    """Run `ydotool <args>`. Returns True on success, False otherwise."""
    global _yd_down_until
    if not YDTOOL:
        return False
    if time.monotonic() < _yd_down_until:
        return False
    try:
        r = subprocess.run(
            [YDTOOL, *args], capture_output=True, timeout=timeout
        )
        if r.returncode == 0:
            return True
        _yd_down_until = time.monotonic() + 10
        print(
            f"[mover] ydotool failed rc={r.returncode}: "
            f"stdout={r.stdout!r} stderr={r.stderr!r} "
            "(daemon dead? run ./daemon.sh, then restart this server — "
            "it self-heals on the next probe)"
        )
        return False
    except Exception as e:
        _yd_down_until = time.monotonic() + 10
        print(f"[mover] ydotool error: {e}")
        return False


def backend_name():
    if YDTOOL and time.monotonic() >= _yd_down_until:
        return "ydotool"
    return "pyautogui" if YDTOOL is None else "pyautogui (ydotoold down)"


def screen_size():
    try:
        s = pyautogui.size()
        return s.width, s.height
    except Exception:
        return 1920, 1080  # ydotool-only path has no X query; sane default


def rel_move(dx_px, dy_px):
    dx_px, dy_px = int(round(dx_px)), int(round(dy_px))
    if dx_px == 0 and dy_px == 0:
        return
    # Relative move: ydotool's native mode (no absolute/accel quirks).
    if ydotool(["mousemove", "--", str(dx_px), str(dy_px)]):
        return
    pyautogui.moveRel(dx_px, dy_px, _pause=False)


def abs_move(x_px, y_px):
    if ydotool(
        ["mousemove", "--absolute", str(int(x_px)), str(int(y_px))]
    ):
        return
    pyautogui.moveTo(x_px, y_px, _pause=False)


def click_current():
    if ydotool(["click", "0xC0"]):
        return
    pyautogui.click(_pause=False)


def press_key(code):
    """Linux input keycode press+release, e.g. 28=Enter, 1=Esc."""
    if ydotool(["key", f"{code}:1", f"{code}:0"]):
        return
    pyautogui.press({28: "enter", 1: "esc"}.get(code, "enter"), _pause=False)


def clamp01(v):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return min(1.0, max(0.0, f))


def clamp_rel(v):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return min(1.0, max(-1.0, f))


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        # quieter than default, still visible per request
        print(f"[pyautogui] {self.command} {self.path}")

    def _json(self, obj, code=200):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        try:
            n = int(self.headers.get("Content-Length", 0))
        except ValueError:
            n = 0
        if not n:
            return {}
        try:
            return json.loads(self.rfile.read(n) or b"{}")
        except json.JSONDecodeError:
            return {}

    def do_GET(self):
        if self.path == "/health":
            w, h = screen_size()
            self._json(
                {
                    "ok": True,
                    "screen": {"width": w, "height": h},
                    "backend": backend_name(),
                }
            )
        else:
            self._json({"ok": False, "error": "not found"}, 404)

    def do_POST(self):
        data = self._body()
        try:
            if self.path == "/move":
                x, y = clamp01(data.get("x")), clamp01(data.get("y"))
                if x is None or y is None:
                    return self._json({"ok": False}, 400)
                w, h = screen_size()
                abs_move(x * w, y * h)
                return self._json({"ok": True, "backend": backend_name()})

            if self.path == "/moveRel":
                dx, dy = clamp_rel(data.get("dx")), clamp_rel(data.get("dy"))
                if dx is None or dy is None:
                    return self._json({"ok": False}, 400)
                if dx == 0 and dy == 0:
                    return self._json({"ok": True, "skipped": True})
                w, h = screen_size()
                rel_move(dx * w, dy * h)
                return self._json({"ok": True, "backend": backend_name()})

            if self.path == "/click":
                x, y = clamp01(data.get("x")), clamp01(data.get("y"))
                if x is None or y is None:
                    return self._json({"ok": False}, 400)
                w, h = screen_size()
                abs_move(x * w, y * h)
                click_current()
                return self._json({"ok": True, "backend": backend_name()})

            if self.path == "/clickCurrent":
                click_current()
                return self._json({"ok": True, "backend": backend_name()})

            if self.path == "/wheel":
                try:
                    dy = float(data.get("dy", 0))
                except (TypeError, ValueError):
                    return self._json({"ok": False}, 400)
                # renderer sends Playwright px (∓500). pyautogui wants clicks
                # (sign inverted: wheel(-500)=up, scroll(+n)=up). ydotool has
                # no wheel: use Up/Down arrows (103/108) on the FOCUSED window
                # — one ydotool call with chained presses. ~4 arrow taps per
                # tick × 4 ticks/sec ≈ smooth continuous scroll; arrows work
                # in browsers, terminals, file managers, PDF viewers.
                clicks = max(-10, min(10, int(round(-dy / 100)))) or (
                    1 if dy < 0 else (-1 if dy > 0 else 0)
                )
                if clicks:
                    if YDTOOL and time.monotonic() >= _yd_down_until:
                        code = 103 if clicks > 0 else 108
                        taps = max(1, min(4, abs(clicks)))
                        seq = [f"{code}:1", f"{code}:0"] * taps
                        if not ydotool(["key", *seq]):
                            pyautogui.scroll(clicks, _pause=False)
                    else:
                        pyautogui.scroll(clicks, _pause=False)
                return self._json({"ok": True, "clicks": clicks})

            if self.path == "/nav":
                where = data.get("where")
                # Alt+Left / Alt+Right (56=Alt, 105=Left, 106=Right).
                if where == "back":
                    seq = ["56:1", "105:1", "105:0", "56:0"]
                elif where == "forward":
                    seq = ["56:1", "106:1", "106:0", "56:0"]
                else:
                    return self._json({"ok": False}, 400)
                if not ydotool(["key", *seq]):
                    pyautogui.hotkey(
                        "alt",
                        "left" if where == "back" else "right",
                        _pause=False,
                    )
                return self._json({"ok": True})

            if self.path == "/key":
                key = data.get("key")
                if key == "Enter":
                    press_key(28)
                elif key == "Escape":
                    press_key(1)
                else:
                    return self._json({"ok": False}, 400)
                return self._json({"ok": True})

            return self._json({"ok": False, "error": "not found"}, 404)
        except Exception as e:  # never crash the loop on one bad tick
            print(f"[pyautogui] ERROR {self.path}: {e}")
            return self._json({"ok": False, "error": str(e)}, 500)


if __name__ == "__main__":
    w, h = screen_size()
    print(
        f"[pyautogui] serving on 127.0.0.1:{PORT} screen={w}x{h} "
        f"backend={backend_name()} (ydotool={'found' if YDTOOL else 'missing'}). "
        "On Wayland, PyAutoGUI alone CANNOT move the cursor — install ydotool "
        "and run ydotoold (see run.sh)."
    )
    HTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
