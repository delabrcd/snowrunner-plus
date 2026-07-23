# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
# Shared helper: list the REAL SnowRunner game PIDs, never matching our own tool shells.
# `pkill -f SnowRunner.exe` is unsafe — it matches any process whose cmdline contains that
# string, including the very shell running our commands. Enumerate + filter instead.
game_pids() {
  local p c
  for p in $(pgrep -f 'SnowRunner\.exe' 2>/dev/null); do
    [ "$p" = "$$" ] && continue
    [ "$p" = "$PPID" ] && continue
    c=$(cat "/proc/$p/comm" 2>/dev/null)
    case "$c" in bash|sh|dash|zsh|fish|pgrep|pkill|grep|make|cat|for) continue ;; esac
    echo "$p"
  done
}
game_running() { [ -n "$(game_pids)" ]; }
