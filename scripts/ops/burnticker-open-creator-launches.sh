#!/bin/sh
# OPEN CREATOR LAUNCHES (owner decision 2026-10-12: Monday 2026-10-19, singles, pairs and end sinks together). OWNER-RUN, on the
# Burnticker host, ONLY after both burn_receipts deployments run round 4 (devnet run green; mainnet Squads upgrade executed and read back:
# `bash scripts/ops/verified-build.sh --onchain mainnet` shows the round-4 hash). It sets four host flags in the env file you name and
# prints them; it reads no other line of that file, prints no value but these four, sends nothing, and restarts nothing.
#
#   sh scripts/ops/burnticker-open-creator-launches.sh --check  <host env file>   # print what is set now (these four names only)
#   sh scripts/ops/burnticker-open-creator-launches.sh --apply  <host env file>   # set the four flags (a backup copy is written first)
#
# The flags (docs/burnticker/END-SINK.md "What flips creator launches on"):
#   BURNTICKER_INITIALIZE_TOKEN_LAYOUT=r4    initialize_token in the round-4 layout (default r3 = the round-3 program)
#   BURNTICKER_END_SINKS_LIVE=1              the hosted builder pins each rule's EndSink (default off: such rules are refused)
#   BURNTICKER_PAIR_CURVE_ENABLED=1          rivalry pairs on the pair curve
#   BURNTICKER_CREATOR_LAUNCHES_ENABLED=1    the launch page and routes open (last)
# Then restart the web and keeper units yourself (systemctl restart mct-burnticker-web mct-burnticker-keeper) and check
# GET /api/burnticker/v1/current-status. To close again: set BURNTICKER_CREATOR_LAUNCHES_ENABLED=0 and restart the web unit.
set -eu
MODE="${1:-}"; FILE="${2:-}"
[ -n "$FILE" ] || { echo "usage: $0 --check|--apply <host env file>"; exit 2; }
[ -f "$FILE" ] || { echo "no such file: $FILE"; exit 2; }
FLAGS="BURNTICKER_INITIALIZE_TOKEN_LAYOUT=r4 BURNTICKER_END_SINKS_LIVE=1 BURNTICKER_PAIR_CURVE_ENABLED=1 BURNTICKER_CREATOR_LAUNCHES_ENABLED=1"
show() { for kv in $FLAGS; do k="${kv%%=*}"; v="$(grep -E "^${k}=" "$FILE" | tail -1 | cut -d= -f2-)"; echo "$k=${v:-<unset>}"; done; }
case "$MODE" in
  --check) show ;;
  --apply)
    cp "$FILE" "$FILE.before-open-$(date +%Y%m%d%H%M%S)"
    for kv in $FLAGS; do
      k="${kv%%=*}"
      grep -vE "^${k}=" "$FILE" > "$FILE.tmp" || true
      printf '%s\n' "$kv" >> "$FILE.tmp"
      mv "$FILE.tmp" "$FILE"
    done
    chmod 600 "$FILE"
    echo "set:"; show
    echo "now restart: systemctl restart mct-burnticker-web mct-burnticker-keeper" ;;
  *) echo "usage: $0 --check|--apply <host env file>"; exit 2 ;;
esac
