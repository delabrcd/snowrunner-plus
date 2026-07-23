# Shared: resolve the SnowRunner install directory.
#
# Source this instead of hardcoding a path — install locations are machine-specific and must
# never be committed. Sets SR_GAME (install root) and SR_BIN (Sources/Bin).
#
# Resolution order:
#   1. $SR_GAME already exported in the environment
#   2. .env.local at the repo root (gitignored; copy .env.local.example)
#   3. autodetect in the usual Steam library locations
# Exits with instructions if none of those find a real install.

_srenv_root() { cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd; }

if [ -z "${SR_GAME:-}" ] && [ -f "$(_srenv_root)/.env.local" ]; then
  # shellcheck disable=SC1090
  . "$(_srenv_root)/.env.local"
fi

if [ -z "${SR_GAME:-}" ]; then
  for _c in \
    "$HOME/.local/share/Steam/steamapps/common/SnowRunner" \
    "$HOME/.steam/steam/steamapps/common/SnowRunner" \
    "$HOME/.var/app/com.valvesoftware.Steam/data/Steam/steamapps/common/SnowRunner" \
    /run/media/*/*/SteamLibrary/steamapps/common/SnowRunner \
    /mnt/*/SteamLibrary/steamapps/common/SnowRunner \
    /media/*/*/SteamLibrary/steamapps/common/SnowRunner
  do
    [ -d "$_c" ] && { SR_GAME="$_c"; break; }
  done
  unset _c
fi

if [ -z "${SR_GAME:-}" ] || [ ! -d "$SR_GAME" ]; then
  echo "ERROR: SnowRunner install not found." >&2
  echo "  Set it:   export SR_GAME=/path/to/steamapps/common/SnowRunner" >&2
  echo "  Or:       cp .env.local.example .env.local   # then edit it" >&2
  exit 1
fi

SR_BIN="$SR_GAME/Sources/Bin"
