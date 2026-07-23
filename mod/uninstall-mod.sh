#!/usr/bin/env bash
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
# Remove the engine mod, restore stock game.
. "$(dirname "$0")/../tools/_env.sh"   # resolves SR_GAME / SR_BIN (never hardcode the install path)
BIN="$SR_BIN"
for f in dinput8.dll snowrunner-engine.asi snowrunner-engine.ini snowrunner-engine.log snowrunner-overlay.cfg .mod-installed; do
  [ -e "$BIN/$f" ] && rm -v "$BIN/$f" || echo "  (absent) $f"
done
echo "game restored to stock."
