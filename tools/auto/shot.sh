#!/usr/bin/env bash
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
# Screenshot the KDE Wayland screen via spectacle. Prints the PNG path (for the agent to Read).
# Usage: shot.sh [name]   (default name "shot"; same name overwrites)
set -euo pipefail
DIR="${SHOT_DIR:-${TMPDIR:-/tmp}/snowrunner-plus/shots}"   # override with $SHOT_DIR
mkdir -p "$DIR"
OUT="$DIR/${1:-shot}.png"
rm -f "$OUT"
spectacle -b -n -f -o "$OUT" >/dev/null 2>&1 || true
for _ in $(seq 1 30); do [ -s "$OUT" ] && break; sleep 0.1; done
[ -s "$OUT" ] || { echo "CAPTURE FAILED" >&2; exit 1; }
echo "$OUT"
