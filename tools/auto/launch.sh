#!/usr/bin/env bash
# Launch SnowRunner through the running Steam client. Uses the self-safe game-pid helper.
source "$(dirname "$0")/_gamepids.sh"
pgrep -x steam >/dev/null || { echo "ERROR: Steam client not running"; exit 1; }
if game_running; then echo "already running"; exit 0; fi
echo "launching appid 1465360 via Steam..."
steam "steam://rungameid/1465360" >/dev/null 2>&1 &
for i in $(seq 1 90); do
  if game_running; then echo "game process up after ${i}s"; exit 0; fi
  sleep 1
done
echo "ERROR: game did not start within 90s"; exit 1
