#!/usr/bin/env bash
# Remove the recon harness from SnowRunner's Bin/. Clean delete — restores stock game.
set -euo pipefail
. "$(dirname "$0")/_env.sh"   # resolves SR_GAME / SR_BIN (never hardcode the install path)
BIN="$SR_BIN"
for f in dinput8.dll frida.asi frida.config .recon-installed; do
  if [ -e "$BIN/$f" ]; then rm -v "$BIN/$f"; else echo "  (absent) $f"; fi
done
echo "Done. Game restored to stock (these were added files, not originals)."
