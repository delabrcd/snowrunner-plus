#!/usr/bin/env bash
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
# One-shot health snapshot. Uses the self-safe game-pid helper.
source "$(dirname "$0")/_gamepids.sh"
REPO="$(cd "$(dirname "$0")/../.." && pwd)"   # derived, so renaming the checkout can't stale these
LOG="$REPO/tools/staging/xrecon.log"
CSV="$REPO/tools/staging/xrecon-events.csv"
MODLOG="$REPO/mod/mod.log"
. "$(dirname "$0")/../_env.sh"   # resolves SR_GAME / SR_BIN (never hardcode the install path)
BIN="$SR_BIN"
echo "time:  $(date '+%H:%M:%S')"
pids=$(game_pids)
if [ -n "$pids" ]; then echo "game:  RUNNING pids=[$(echo $pids)]"; else echo "game:  NOT running"; fi
pgrep -x steam >/dev/null && echo "steam: up" || echo "steam: DOWN"
[ -e "$BIN/.mod-installed" ] && echo "mod: INSTALLED" || echo "mod: not installed"
[ -e "$BIN/.recon-installed" ] && echo "recon-harness: INSTALLED"
[ -f "$MODLOG" ] && echo "mod.log: $(wc -l <"$MODLOG") lines"
[ -f "$LOG" ] && echo "xrecon.log: $(wc -l <"$LOG") lines"
[ -f "$CSV" ] && echo "events.csv: $(wc -l <"$CSV") rows"
