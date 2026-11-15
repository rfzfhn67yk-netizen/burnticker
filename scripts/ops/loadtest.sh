#!/bin/sh
# LAUNCH-DAY LOAD TEST, FROM THE MAC (trust-ops item 7, 2026-10-10 night): scripts/ops/loadtest.mjs against the box with the box's RAM and
# CPU sampled over ssh every 8 s (free -m, /proc/loadavg, top -bn1 — read-only). Keyless on the HTTP side; no package is downloaded.
#
#   sh scripts/ops/loadtest.sh [--write] [--stages 10x20,25x30,50x30] [--base https://burnticker.com] [--json]
#
#   --write appends the report to docs/burnticker/LOADTEST.md. BURNTICKER_HOST (or the operator's burnticker-host file, as deploy-burnticker-host.sh; refused when neither is set) ·
#   BURNTICKER_SSH (default "ssh -o BatchMode=yes -o ConnectTimeout=8": ~/.ssh/config decides; add -i <key>). Without ssh the run still happens; the
#   resource table is missing. Exit 0 = the last stage met the pass bar (50 RPS mixed, p95 < 800 ms, 0 5xx/timeouts).
set -eu
cd "$(dirname "$0")/../.."
# OP7-9 (seventh pre-launch audit): the host is explicit. BURNTICKER_HOST, else the first line of the operator's untracked file
# ${XDG_CONFIG_HOME:-$HOME/.config}/meme-coin-trader/burnticker-host (for example root@<tailnet name>); with neither, refuse. No address
# is kept in the repository.
HOST="${BURNTICKER_HOST:-}"
BT_HOST_FILE="${XDG_CONFIG_HOME:-$HOME/.config}/meme-coin-trader/burnticker-host"
[ -n "$HOST" ] || { [ -r "$BT_HOST_FILE" ] && HOST=$(head -n 1 "$BT_HOST_FILE" | tr -d '[:space:]'); } || true
[ -n "$HOST" ] || { echo "refused: the Burnticker host is not set. Export BURNTICKER_HOST=root@<host>, or write it on the first line of $BT_HOST_FILE." >&2; exit 2; }
SSH="${BURNTICKER_SSH:-ssh -o BatchMode=yes -o ConnectTimeout=8}"
ARGS=""
for a in "$@"; do case "$a" in --write) ARGS="$ARGS --write docs/burnticker/LOADTEST.md" ;; *) ARGS="$ARGS $a" ;; esac; done
# shellcheck disable=SC2086
exec node scripts/ops/loadtest.mjs --ssh "$HOST" --ssh-cmd "$SSH" $ARGS
