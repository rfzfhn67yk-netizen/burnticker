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
#
# BURNTICKER_PUSH_URL / BURNTICKER_PUSH_TOKEN (optional, polish-1 2026-10-12; src/lib/burnticker/push.ts has the keeper's side): when the
# status file has been stale or missing for more than BURNTICKER_PUSH_STALE_SEC (default 7200, two hours) and a state file is given, one
# push to the owner's phone, repeated every two hours while it lasts, and one more when the file is fresh again. Plain-text POST with
# Title and Priority headers; the token travels in curl's config on stdin, never on the command line, and is never printed.
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

push() {   # push <priority> <title> <body>
  if [ -n "${BURNTICKER_PUSH_TOKEN:-}" ]; then
    printf 'header = "Authorization: Bearer %s"\n' "$BURNTICKER_PUSH_TOKEN" | curl -fsS -m 10 --retry 2 -o /dev/null --config - -X POST -H "Title: $2" -H "Priority: $1" -H "Content-Type: text/plain; charset=utf-8" --data-binary "$3" "$BURNTICKER_PUSH_URL" 2>/dev/null
  else
    curl -fsS -m 10 --retry 2 -o /dev/null -X POST -H "Title: $2" -H "Priority: $1" -H "Content-Type: text/plain; charset=utf-8" --data-binary "$3" "$BURNTICKER_PUSH_URL" 2>/dev/null
  fi
}
if [ -n "${BURNTICKER_PUSH_URL:-}" ] && [ -n "$STATE_FILE" ]; then
  PUSH_STALE="${BURNTICKER_PUSH_STALE_SEC:-7200}"
  SINCE_FILE="$STATE_FILE.since"; PUSHED_FILE="$STATE_FILE.pushed"
  if [ "$state" = fresh ]; then
    if [ -f "$PUSHED_FILE" ]; then
      push default "Burnticker keeper is back" "The keeper's status file is being written again. It was last written $age seconds ago." || echo "the recovery push failed (BURNTICKER_PUSH_URL in the host's env file)"
      rm -f "$PUSHED_FILE"
    fi
    rm -f "$SINCE_FILE"
  else
    [ -f "$SINCE_FILE" ] || printf '%s\n' "$now" > "$SINCE_FILE" 2>/dev/null || true
    since=$(cat "$SINCE_FILE" 2>/dev/null || echo "$now"); down=$((now - since))
    if [ -n "$age" ] && [ "$age" -gt "$down" ]; then down=$age; fi
    last=$(cat "$PUSHED_FILE" 2>/dev/null || echo 0)
    if [ "$down" -gt "$PUSH_STALE" ] && [ $((now - last)) -ge "$PUSH_STALE" ]; then
      if [ "$state" = missing ]; then what="has not been written"; else what="was last written $((age / 60)) minutes ago"; fi
      if push high "Burnticker keeper is not publishing" "The keeper's status file $what. The keeper has stopped cycling or stopped publishing for more than $((PUSH_STALE / 3600)) hours. Check the keeper unit and its log on the host."; then
        printf '%s\n' "$now" > "$PUSHED_FILE" 2>/dev/null || true
      else
        echo "the stale-status push failed (BURNTICKER_PUSH_URL in the host's env file)"
      fi
    fi
  fi
fi

if [ "$state" = fresh ] && [ -n "${BURNTICKER_STATUS_HEARTBEAT_URL:-}" ]; then
  if ! curl -fsS -m 10 --retry 2 -o /dev/null "$BURNTICKER_STATUS_HEARTBEAT_URL" 2>/dev/null; then
    echo "the heartbeat ping failed (the monitor will alert if this continues; the URL is BURNTICKER_STATUS_HEARTBEAT_URL in the host's env file)"
  fi
fi
exit 0
