#!/usr/bin/env bash
# Run the PyAutoGUI OS-cursor server through XWayland (Wayland-safe).
# Usage: ./run.sh   (then press "Launch Browser" in the Electron app)
set -euo pipefail
cd "$(dirname "$0")"

# Mutter rotates this auth file every login — never hardcode it.
XAUTH=$(ls /run/user/$(id -u)/.mutter-Xwaylandauth.* 2>/dev/null | head -n1 || true)
if [ -z "${XAUTH:-}" ]; then
  echo "No mutter XWayland auth found — are you on Wayland? Trying plain :0 anyway."
  DISPLAY=:0 python3 pyautogui_server.py
  exit 0
fi
echo "XAUTH=$XAUTH"
# python-xlib needs explicit :0/:1 cookies (mutter stores wildcards C accepts but xlib-python doesn't).
COOKIE=$(XAUTHORITY="$XAUTH" xauth list 2>/dev/null | head -n1 | awk '{print $3}')
if [ -n "${COOKIE:-}" ]; then
  XAUTHORITY="$XAUTH" xauth add ":0" MIT-MAGIC-COOKIE-1 "$COOKIE" 2>/dev/null || true
  XAUTHORITY="$XAUTH" xauth add ":1" MIT-MAGIC-COOKIE-1 "$COOKIE" 2>/dev/null || true
fi

# Daemon socket lives in THIS folder (./.ydotool_socket, see daemon.sh),
# not /tmp — the user-level client defaults elsewhere, so point it here.
export YDOTOOL_SOCKET="$PWD/.ydotool_socket"

GDK_BACKEND=x11 QT_QPA_PLATFORM=xcb SDL_VIDEODRIVER=x11 \
  DISPLAY=:0 XAUTHORITY="$XAUTH" \
  python3 pyautogui_server.py

# --- Wayland cursor control (REQUIRED on GNOME/Wayland; PyAutoGUI alone is a
# --- silent no-op there). One-time setup, in your own terminal (needs sudo):
#   ./daemon.sh        # starts sudo ydotoold with the socket in this folder
#   (then restart this server so it picks up the new socket path)
#   check: curl -s localhost:8765/health | grep backend   # want "ydotool"
