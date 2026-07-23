#!/usr/bin/env bash
# Dev mode: ASI loader + Frida gadget -> memexplore.js (hot-reload). Removes the C++ mod so
# only the explorer runs. memexplore.js is GENERATED: edit src/*.js and run ./build.sh
# (or ./build.sh --watch) — the gadget reloads the rebuilt file live in the game (~1s).
set -euo pipefail
. "$(dirname "$0")/../_env.sh"   # resolves SR_GAME / SR_BIN (never hardcode the install path)
BIN="$SR_BIN"
HERE="$(cd "$(dirname "$0")" && pwd)"
STAGE="$HERE/../staging"
rm -f "$BIN/snowrunner-engine.asi"            # no C++ mod in dev mode
cp -v "$STAGE/dinput8.dll" "$BIN/dinput8.dll"
cp -v "$STAGE/frida.asi"   "$BIN/frida.asi"
cp -v "$HERE/frida.config" "$BIN/frida.config"
touch "$BIN/.mod-installed"
echo "dev mode installed. explorer -> tools/dev/explore.log (hot-reloads on edit)"
