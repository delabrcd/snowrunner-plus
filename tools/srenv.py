"""Shared: resolve the SnowRunner install dir and a scratch dir.

Python counterpart to tools/_env.sh. Install locations are machine-specific and must never
be committed, so ask for them here rather than hardcoding a path.

    import sys, pathlib
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
    from srenv import game_dir, scratch_dir
    SR_GAME = game_dir()
    SCRATCH = scratch_dir("engine_audio")

Resolution order: $SR_GAME -> .env.local at the repo root -> usual Steam locations.
"""
import os
import glob
import pathlib
import tempfile

REPO = pathlib.Path(__file__).resolve().parents[1]

_CANDIDATES = (
    "~/.local/share/Steam/steamapps/common/SnowRunner",
    "~/.steam/steam/steamapps/common/SnowRunner",
    "~/.var/app/com.valvesoftware.Steam/data/Steam/steamapps/common/SnowRunner",
    "/run/media/*/*/SteamLibrary/steamapps/common/SnowRunner",
    "/mnt/*/SteamLibrary/steamapps/common/SnowRunner",
    "/media/*/*/SteamLibrary/steamapps/common/SnowRunner",
)


def _from_env_local():
    """Read SR_GAME out of the repo-root .env.local (shell-style KEY=VALUE)."""
    path = REPO / ".env.local"
    if not path.is_file():
        return None
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        if key.strip() == "SR_GAME":
            return os.path.expanduser(val.strip().strip("'\""))
    return None


def game_dir():
    """Absolute path to the SnowRunner install root. Raises if it can't be found."""
    # An explicit setting that doesn't exist is an error, not a reason to autodetect —
    # silently ignoring a typo'd path would be worse than failing (matches tools/_env.sh).
    for src, cand in (("$SR_GAME", os.environ.get("SR_GAME")),
                      (".env.local", _from_env_local())):
        if cand:
            if os.path.isdir(cand):
                return cand
            raise SystemExit(f"ERROR: {src} is set to '{cand}', which is not a directory.")
    for pattern in _CANDIDATES:
        for hit in sorted(glob.glob(os.path.expanduser(pattern))):
            if os.path.isdir(hit):
                return hit
    raise SystemExit(
        "ERROR: SnowRunner install not found.\n"
        "  Set it:   export SR_GAME=/path/to/steamapps/common/SnowRunner\n"
        "  Or:       cp .env.local.example .env.local   # then edit it"
    )


def scratch_dir(name):
    """A writable scratch dir for extracted audio. Game assets are never committed."""
    base = os.environ.get("SR_SCRATCH") or os.path.join(tempfile.gettempdir(), "snowrunner-plus")
    path = os.path.join(base, name)
    os.makedirs(path, exist_ok=True)
    return path
