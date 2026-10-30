#!/bin/sh
# SEEDS THE LOG ROTATION STATE (sixth-pass audit OP6-8, 2026-10-19). logrotate never rotates a file the first time it sees it: with no
# line for the file in its state file it writes "rotated now" and skips it. The units were installed on 2026-10-19, so the first daily
# run only wrote that state, and a log that appears later (a new unit's log) waits a day the same way. This writes a line dated
# 2000-01-01 for every logs/*.log the state file does not name yet, so the run that follows rotates it on its own schedule.
#   seed-logrotate-state.sh <state file> <logs dir>     (mct-burnticker-logrotate.service runs it before logrotate)
# Paths are written exactly as the rendered config names them (<repo>/logs/<file>.log), one per line, quoted, which is logrotate's
# own state format. Nothing is removed or changed for a file the state already names.
set -eu
state="$1"; logs="$2"
mkdir -p "$(dirname "$state")"
[ -f "$state" ] || printf 'logrotate state -- version 2\n' > "$state"
for f in "$logs"/*.log; do
  [ -e "$f" ] || continue
  if ! grep -qF "\"$f\" " "$state"; then printf '"%s" 2000-1-1-0:0:0\n' "$f" >> "$state"; echo "seeded $f"; fi
done
