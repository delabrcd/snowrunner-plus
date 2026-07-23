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
