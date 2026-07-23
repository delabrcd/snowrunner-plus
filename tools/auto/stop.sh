#!/usr/bin/env bash
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
# Stop the game safely (never pkill -f a string our own shell contains).
source "$(dirname "$0")/_gamepids.sh"
steam "steam://stop/1465360" >/dev/null 2>&1 || true
sleep 3
pids=$(game_pids)
[ -n "$pids" ] && kill -TERM $pids 2>/dev/null && sleep 4
pids=$(game_pids)
[ -n "$pids" ] && kill -KILL $pids 2>/dev/null && sleep 1
if game_running; then echo "STILL RUNNING: $(game_pids | tr '\n' ' ')"; else echo "game stopped"; fi
