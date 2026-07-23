#!/usr/bin/env bash
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
# Screen recording -> README-sized GIF. Companion to shot.sh (stills).
#
#   record.sh start            # begin a screen recording (stop it from the tray)
#   record.sh gif <file> [name]  # convert a recording to an optimized GIF
#
# Backend is Spectacle, which goes through the Wayland screencast portal.
# NOTE: ffmpeg -f x11grab does NOT work on this setup — XWayland is rootless, so
# grabbing the X root window yields pure black (verified: mean luma ~1e-5).
# Spectacle has no D-Bus stop method either (only RecordScreen/Region/Window),
# so stopping is a manual click on the recording indicator. Hence the two steps.
set -euo pipefail

DIR="${SHOT_DIR:-${TMPDIR:-/tmp}/snowrunner-plus/shots}"
mkdir -p "$DIR"
CMD="${1:-start}"

case "$CMD" in
  start)
    command -v spectacle >/dev/null || { echo "ERROR: spectacle not found" >&2; exit 1; }
    echo "Starting screen recording. Stop it from the recording indicator in the system tray."
    echo "Spectacle will save to your Videos folder; then run:"
    echo "    tools/auto/record.sh gif <that-file>"
    spectacle -R s >/dev/null 2>&1 &
    ;;

  gif)
    SRC="${2:-}"; NAME="${3:-dashboard}"
    [ -f "$SRC" ] || { echo "ERROR: usage: record.sh gif <video-file> [name]" >&2; exit 1; }
    command -v ffmpeg >/dev/null || { echo "ERROR: ffmpeg not found" >&2; exit 1; }
    OUT="$DIR/$NAME.gif"; PAL="$DIR/.$NAME-palette.png"
    # Two-pass palette beats a naive convert; 960px @ 15fps keeps a README embed sane.
    ffmpeg -hide_banner -loglevel error -y -i "$SRC" \
      -vf "fps=15,scale=960:-1:flags=lanczos,palettegen=stats_mode=diff" "$PAL"
    ffmpeg -hide_banner -loglevel error -y -i "$SRC" -i "$PAL" \
      -lavfi "fps=15,scale=960:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3" \
      "$OUT"
    rm -f "$PAL"
    echo "$OUT  ($(du -h "$OUT" | cut -f1))"
    ;;

  *) echo "usage: record.sh start | record.sh gif <file> [name]" >&2; exit 1 ;;
esac
