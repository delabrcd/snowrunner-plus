#!/usr/bin/env bash
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
# Install the engine mod into SnowRunner's Bin/: Ultimate ASI Loader (dinput8.dll) +
# snowrunner-engine.asi. Only ADDS files -> uninstall is a clean delete.
# Also writes snowrunner-engine.ini (DEV override: points the mod's log + dash.json at this
# repo via the Wine Z: drive). The binary itself contains no machine-specific paths; a public
# install would ship no ini and everything lands next to the .asi.
set -euo pipefail
. "$(dirname "$0")/../tools/_env.sh"   # resolves SR_GAME / SR_BIN (never hardcode the install path)
BIN="$SR_BIN"
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
ASI_LOADER="$HERE/../tools/staging/dinput8.dll"
MOD="$HERE/build/snowrunner-engine.asi"

[ -f "$MOD" ] || { echo "ERROR: build the mod first (cmake --build build)"; exit 1; }
[ -f "$ASI_LOADER" ] || { echo "ERROR: ASI loader missing at $ASI_LOADER"; exit 1; }
if [ -e "$BIN/dinput8.dll" ] && [ ! -e "$BIN/.mod-installed" ] && [ ! -e "$BIN/.recon-installed" ]; then
  echo "ERROR: $BIN/dinput8.dll exists and isn't ours — not overwriting."; exit 1
fi

winpath() { echo "Z:${1//\//\\}"; }   # /home/... -> Z:\home\...
cp -v "$ASI_LOADER" "$BIN/dinput8.dll"
cp -v "$MOD"        "$BIN/snowrunner-engine.asi"
printf 'log=%s\ndata_dir=%s\n' "$(winpath "$REPO/mod/mod.log")" "$(winpath "$REPO/tools/dev")" \
  > "$BIN/snowrunner-engine.ini"
echo "wrote $BIN/snowrunner-engine.ini (dev paths -> repo)"
touch "$BIN/.mod-installed"
echo "installed. log -> mod/mod.log   (uninstall: mod/uninstall-mod.sh)"
