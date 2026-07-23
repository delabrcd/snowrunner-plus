#!/usr/bin/env bash
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
# Combined dev install: Frida gadget (memexplore.js — audio takeover, RPM, auto-box,
# dash.json telemetry) PLUS the C++ ASI in OVERLAY-ONLY mode (xaudio/telemetry off via ini,
# since the Frida script owns those hooks — double-patching the same prologues would crash).
# The overlay renders dash.json in-game; F9 toggles it.
set -euo pipefail
. "$(dirname "$0")/../_env.sh"   # resolves SR_GAME / SR_BIN (never hardcode the install path)
BIN="$SR_BIN"
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
STAGE="$HERE/../staging"
MOD="$REPO/mod/build/snowrunner-engine.asi"

[ -f "$MOD" ] || { echo "ERROR: build the mod first (cd mod && cmake --build build)"; exit 1; }
"$HERE/build.sh"   # regenerate memexplore.js from src/

winpath() { echo "Z:${1//\//\\}"; }
# --remove-destination: unlink before copy so a RUNNING game's mapped DLLs are never
# truncated in place (the old inode lives on until the game exits; new launch gets the new file)
cp -v --remove-destination "$STAGE/dinput8.dll" "$BIN/dinput8.dll"
cp -v --remove-destination "$STAGE/frida.asi"   "$BIN/frida.asi"
cp -v --remove-destination "$HERE/frida.config" "$BIN/frida.config"
cp -v --remove-destination "$MOD"               "$BIN/snowrunner-engine.asi"
printf 'log=%s\ndata_dir=%s\nxaudio=off\ntelemetry=off\n' \
  "$(winpath "$REPO/mod/mod.log")" "$(winpath "$HERE")" > "$BIN/snowrunner-engine.ini"
touch "$BIN/.mod-installed"
echo "dev+overlay installed: Frida harness (audio/auto-box) + ASI overlay-only (F9 toggles)"
