#!/usr/bin/env bash
# Remove the engine mod, restore stock game.
. "$(dirname "$0")/../tools/_env.sh"   # resolves SR_GAME / SR_BIN (never hardcode the install path)
BIN="$SR_BIN"
for f in dinput8.dll snowrunner-engine.asi snowrunner-engine.ini snowrunner-engine.log snowrunner-overlay.cfg .mod-installed; do
  [ -e "$BIN/$f" ] && rm -v "$BIN/$f" || echo "  (absent) $f"
done
echo "game restored to stock."
