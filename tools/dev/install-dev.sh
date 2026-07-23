#!/usr/bin/env bash
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
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
