#!/usr/bin/env bash
# Start ydotoold with its socket INSIDE this folder (./.ydotool_socket),
# so /tmp wipes can never lose it. Needs sudo for /dev/uinput.
# Socket is created 0666: the user-level server/client can talk to it,
# no chmod needed after restarts.
# Usage: ./daemon.sh &   (or its own terminal; Ctrl+C stops the daemon)
set -euo pipefail
cd "$(dirname "$0")"
exec sudo ydotoold -p "$PWD/.ydotool_socket" -P 0666
