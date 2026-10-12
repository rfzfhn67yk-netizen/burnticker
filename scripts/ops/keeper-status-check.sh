#!/bin/sh
# Is the keeper's public status document being written? (ops-2, 2026-10-12.) Run every minute by the publish timer through
# `deploy-sites.sh --publish-only`; safe to run by hand. Read-only apart from its one-word state file and the optional heartbeat ping.
#
#   sh scripts/ops/keeper-status-check.sh <keeper publish dir> [state file]
#
# Looks at <publish dir>/status/status.json (src/lib/burnticker/ops/status.ts writes it after every keeper cycle, about once a minute)
# and decides fresh / stale (older than BURNTICKER_STATUS_STALE_SEC, default 300) / missing. It prints ONE line when that state changes
# (so the timer's log says when the keeper stopped and when it came back, not once a minute) and nothing otherwise. Always exits 0: it
# reports, it never fails the publish.
#
# BURNTICKER_STATUS_HEARTBEAT_URL (optional, set in the host's local env file): a dead-man's-switch URL (Healthchecks.io "ping URL"). While the file
# is fresh, each run pings it, so the monitor alerts when the keeper stops, crashes, or stops publishing, even though the website itself
# still answers. The URL is never printed.
set -u
PUB="${1:?usage: keeper-status-check.sh <keeper publish dir> [state file]}"
STATE_FILE="${2:-}"
STALE="${BURNTICKER_STATUS_STALE_SEC:-300}"
F="$PUB/status/status.json"

now=$(date +%s)
if [ ! -f "$F" ]; then
  state=missing; age=""
else
  m=$(stat -c %Y "$F" 2>/dev/null || stat -f %m "$F" 2>/dev/null || echo 0)
  age=$((now - m))
  if [ "$age" -gt "$STALE" ]; then state=stale; else state=fresh; fi
fi

prev=""
[ -n "$STATE_FILE" ] && [ -f "$STATE_FILE" ] && prev=$(cat "$STATE_FILE" 2>/dev/null || true)
if [ "$state" != "$prev" ]; then
  case "$state" in
    missing) echo "$F does not exist. The keeper has not written its status file, so status.burnticker.com/status.json answers 404. Check: systemctl --user status mct-burnticker-keeper; tail -n 30 logs/burnticker-keeper.log" ;;
    stale)   echo "$F was last written $age s ago (limit $STALE s). The keeper has stopped cycling or stopped publishing. Check: systemctl --user status mct-burnticker-keeper; tail -n 30 logs/burnticker-keeper.log" ;;
    fresh)   [ -n "$prev" ] && echo "$F is fresh again (written $age s ago)." ;;
  esac
  if [ -n "$STATE_FILE" ]; then printf '%s\n' "$state" > "$STATE_FILE" 2>/dev/null || true; fi
fi

if [ "$state" = fresh ] && [ -n "${BURNTICKER_STATUS_HEARTBEAT_URL:-}" ]; then
  if ! curl -fsS -m 10 --retry 2 -o /dev/null "$BURNTICKER_STATUS_HEARTBEAT_URL" 2>/dev/null; then
    echo "the heartbeat ping failed (the monitor will alert if this continues; the URL is BURNTICKER_STATUS_HEARTBEAT_URL in the host's env file)"
  fi
fi
exit 0
