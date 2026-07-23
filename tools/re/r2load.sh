#!/usr/bin/env bash
# Open the decrypted+repaired SnowRunner image in r2, rebased to 0 so addresses == RVA
# (offsets from recon like SnowRunner.exe+0xdfb32f are RVAs -> seek directly to them).
#   tools/re/r2load.sh            # interactive
#   tools/re/r2load.sh -qc '...'  # batch commands
HERE="$(cd "$(dirname "$0")/../.." && pwd)"
DUMP="$HERE/reference/snowrunner-fixed.bin"
[ -f "$DUMP" ] || { echo "missing $DUMP — run: python3 tools/re/unmap_pe.py reference/snowrunner-dump.bin reference/snowrunner-fixed.bin"; exit 1; }
exec r2 -B 0 "$@" "$DUMP"
