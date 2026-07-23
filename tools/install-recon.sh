#!/usr/bin/env bash
# Install the XAudio2 recon (+ optional autodrive) harness into SnowRunner's Bin/.
# Injection: Ultimate ASI Loader (dinput8.dll) -> loads frida.asi (Frida gadget)
#            -> runs the combined script (tracer [+ autodrive]) at game start.
# Only ADDS files (game ships no dinput8.dll in Bin/), so uninstall is a clean delete.
#
# Usage:
#   install-recon.sh            # trace only (safe)
#   install-recon.sh --drive    # trace + AUTODRIVE the scenario (no hands)
set -euo pipefail

. "$(dirname "$0")/_env.sh"   # resolves SR_GAME / SR_BIN (never hardcode the install path)
BIN="$SR_BIN"
TOOLS="$(cd "$(dirname "$0")" && pwd)"
STAGE="$TOOLS/staging"
DRIVE=0
[ "${1:-}" = "--drive" ] && DRIVE=1

echo "Target: $BIN   (autodrive=$DRIVE)"
[ -d "$BIN" ] || { echo "ERROR: Bin dir not found"; exit 1; }

# Build the combined Frida script.
# TRACE-ONLY (default): combined.js = ONLY the XAudio2 tracer -> byte-for-byte the
#   known-good, crash-free script from recon-run-01. The tracer touches ZERO game code
#   (it only hooks XAudio2 in xaudio2_9redist.dll).
# --drive (EXPERIMENTAL): also append the autodrive harness, which hooks the game's own
#   SetPowerCoef. This is UNVALIDATED and suspected in a crash under Wine; use with care.
COMBINED="$STAGE/combined.js"
if [ "$DRIVE" = "1" ]; then
  cat "$TOOLS/frida-trace-xaudio.js" "$TOOLS/frida-drive-harness.js" > "$COMBINED"
  sed -i 's/^  enabled: false,.*$/  enabled: true,   \/\/ AUTODRIVE ON (set by install --drive)/' "$COMBINED"
  grep -q 'enabled: true,' "$COMBINED" || { echo "ERROR: failed to enable autodrive in combined.js"; exit 1; }
  echo "  !! autodrive ENABLED (EXPERIMENTAL — hooks game code, may crash). "
else
  cp "$TOOLS/frida-trace-xaudio.js" "$COMBINED"   # pure tracer, known-good, no game-code hooks
  echo "  trace-only (pure XAudio2 tracer — no game-code hooks, known-good)"
fi
echo "  built $(basename "$COMBINED") ($(wc -l < "$COMBINED") lines)"

# Inject the Wine-visible staging path into the bundle (@@STAGE@@) and (re)generate
# frida.config pointing at combined.js. Both are derived from this script's location, so a
# renamed/moved checkout stays correct. Python does the path math + escaping (str.replace is
# literal; json.dumps escapes backslashes) so we never fight sed/awk over backslashes —
# same approach as tools/dev/build.sh.
python3 - "$COMBINED" "$STAGE/frida.config" "$STAGE" <<'PY'
import sys, json
combined, cfgpath, stage = sys.argv[1:4]
stage_win = 'Z:' + stage.replace('/', '\\') + '\\'          # Z:\home\...\tools\staging\
src = open(combined, encoding='utf-8').read()
open(combined, 'w', encoding='utf-8').write(src.replace('@@STAGE@@', stage_win.replace('\\', '\\\\')))
cfg = {"interaction": {"type": "script", "path": stage_win + "combined.js", "on_change": "reload"}}
open(cfgpath, 'w', encoding='utf-8').write(json.dumps(cfg, indent=2) + "\n")
PY
grep -q '@@STAGE@@' "$COMBINED" && { echo "ERROR: @@STAGE@@ substitution failed in combined.js"; exit 1; }

# Safety: refuse to clobber a real game DLL. The game ships NO dinput8.dll in Bin/.
if [ -e "$BIN/dinput8.dll" ] && [ ! -e "$BIN/.recon-installed" ]; then
  echo "ERROR: $BIN/dinput8.dll exists and wasn't installed by us — not overwriting."; exit 1
fi

for f in dinput8.dll frida.asi frida.config combined.js; do
  [ -e "$STAGE/$f" ] || { echo "ERROR: missing staging/$f"; exit 1; }
done

cp -v "$STAGE/dinput8.dll"  "$BIN/dinput8.dll"    # Ultimate ASI Loader (proxies dinput8)
cp -v "$STAGE/frida.asi"    "$BIN/frida.asi"       # Frida gadget, loaded as an .asi
cp -v "$STAGE/frida.config" "$BIN/frida.config"    # -> combined.js
touch "$BIN/.recon-installed"

echo
echo "Installed (autodrive=$DRIVE)."
echo "  Script:  tools/staging/combined.js  (regenerated each install; on_change:reload)"
echo "  Output:  tools/staging/xrecon.log  +  tools/staging/xrecon-events.csv"
echo "Launch SnowRunner, (drive if not autodriving), quit. Remove: tools/uninstall-recon.sh"
