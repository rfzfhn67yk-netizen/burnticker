#!/bin/sh
# Entrypoint for mct-burnticker-web-probe (audit 2026-10-19 I-11 / B-4: a hung web process or a dead Caddy was caught by nobody; the only
# off-box signal was the keeper's heartbeat). Fired every 5 minutes by mct-burnticker-web-probe.timer; also safe to run by hand.
#
#   sh scripts/service/burnticker-web-probe.sh           probe once, report to the monitor
#   sh scripts/service/burnticker-web-probe.sh --check   print what a run would do; no request is made, nothing is written
#
# What a run does:
#   1. GETs https://<BURNTICKER_WEB_PROBE_HOST, default burnticker.com>/api/burnticker/v1/current-status through the PUBLIC hostname, so
#      the path is DNS, Cloudflare, the origin, Caddy and the Next process: one try, a 20-second limit, no retry.
#   2. It is good only when the answer is HTTP 200 and the body parses as JSON whose "schema" is burnticker.current-status/v1.
#   3. Good: GET the monitor's ping URL (BURNTICKER_WEB_HEARTBEAT_URL, a Healthchecks.io check). Anything else: POST "<url>/fail" with a
#      short body naming the status code and the reason. Each ping is one try with a 10-second limit; a ping that fails is logged, never
#      retried (the monitor goes red on its own when the pings stop).
#   4. Appends ONE line to logs/burnticker-web-probe.log and writes data/web-probe-last.json ({ configured, outcome, at, code, reason,
#      lastOkAt, pinged }); the keeper's ops facts read that file (ops/unitHealth.ts readWebProbeStatus). The URL is never logged or
#      written anywhere: it carries the check's token.
# Unset URL: no request is made; the log says "skipped" once a UTC day and the run exits 0.
# BURNTICKER_WEB_HEARTBEAT_URL is read from the environment, else from that ONE line of .env.local (no other line of the file is read).
# A URL that is not https, or that already ends in /fail (each good ping would report a failure), is refused: exit 2, the unit fails.
set -u
ROOT=${BURNTICKER_WEB_PROBE_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}
cd "$ROOT" || exit 2
HOST=${BURNTICKER_WEB_PROBE_HOST:-burnticker.com}
TARGET="https://$HOST/api/burnticker/v1/current-status"
SCHEMA="burnticker.current-status/v1"
LOG=logs/burnticker-web-probe.log
STATUS=data/web-probe-last.json
CHECK=0
for a in "$@"; do case "$a" in --check) CHECK=1 ;; *) echo "usage: $0 [--check]"; exit 2 ;; esac; done
case "$HOST" in ''|*[!A-Za-z0-9.:-]*|-*) echo "refusing: BURNTICKER_WEB_PROBE_HOST must be a bare host name"; exit 2 ;; esac

URL=${BURNTICKER_WEB_HEARTBEAT_URL:-}
if [ -z "$URL" ] && [ -f .env.local ]; then
  URL=$(grep -E '^(export[[:space:]]+)?BURNTICKER_WEB_HEARTBEAT_URL=' .env.local 2>/dev/null | tail -n 1 | cut -d= -f2- | tr -d "\"'" || true)
fi
URL=$(printf '%s' "$URL" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
URL_STATE=unset
if [ -n "$URL" ]; then
  case "$URL" in
    *[[:space:]]*) URL_STATE=refused ;;
    https://*/fail|https://*/fail/) URL_STATE=refused ;;
    https://?*) URL_STATE=set ;;
    *) URL_STATE=refused ;;
  esac
fi

now_iso() { date -u +%Y-%m-%dT%H:%M:%SZ; }
say() { mkdir -p logs; printf '[%s] %s\n' "$(date -u '+%F %TZ')" "$*" >> "$LOG"; }
prev_field() { grep -o "\"$1\":\"[^\"]*\"" "$STATUS" 2>/dev/null | head -n 1 | cut -d'"' -f4; }
jstr() { if [ -n "$1" ]; then printf '"%s"' "$(printf '%s' "$1" | tr -d '"\\\n' | head -c 200)"; else printf 'null'; fi; }
write_status() { # configured outcome code reason lastOkAt pinged
  mkdir -p data
  printf '{"configured":%s,"outcome":"%s","at":"%s","code":%s,"reason":%s,"lastOkAt":%s,"pinged":%s,"host":"%s"}\n' \
    "$1" "$2" "$(now_iso)" "$(jstr "$3")" "$(jstr "$4")" "$(jstr "$5")" "$6" "$HOST" > "$STATUS.tmp" && mv "$STATUS.tmp" "$STATUS"
}

if [ "$CHECK" = 1 ]; then
  echo "web probe (check only: no request, nothing written)"
  echo "  would GET  $TARGET  (one try, 20 s limit)"
  echo "  good when  HTTP 200 and the body is JSON with schema $SCHEMA"
  case "$URL_STATE" in
    set) echo "  monitor    BURNTICKER_WEB_HEARTBEAT_URL is set: a good run pings it, a bad run POSTs <url>/fail with the code" ;;
    refused) echo "  monitor    BURNTICKER_WEB_HEARTBEAT_URL is set but REFUSED (not https, or it already ends in /fail): a run exits 2" ;;
    *) echo "  monitor    BURNTICKER_WEB_HEARTBEAT_URL is not set: a run makes no request and logs \"skipped\" once a day" ;;
  esac
  echo "  log        $ROOT/$LOG"
  echo "  status     $ROOT/$STATUS"
  [ -f "$STATUS" ] && echo "  last       $(cat "$STATUS")"
  exit 0
fi

if [ "$URL_STATE" = refused ]; then
  say "refused: BURNTICKER_WEB_HEARTBEAT_URL is not an https URL, or it already ends in /fail; nothing was sent"
  write_status true refused "" "the ping URL was refused" "$(prev_field lastOkAt)" false
  exit 2
fi
if [ "$URL_STATE" = unset ]; then
  TODAY=$(date -u +%F)
  case "$(prev_field outcome)|$(prev_field at)" in "skipped|$TODAY"*) exit 0 ;; esac
  say "skipped: BURNTICKER_WEB_HEARTBEAT_URL is not set (docs/burnticker/runbook.md, External web check); no request made"
  write_status false skipped "" "" "$(prev_field lastOkAt)" false
  exit 0
fi

BODY=$(mktemp "${TMPDIR:-/tmp}/bt-web-probe.XXXXXX") || exit 2
trap 'rm -f "$BODY"' EXIT
T0=$(date +%s)
CODE=$(curl -sS --max-time 20 -o "$BODY" -w '%{http_code}' "$TARGET" 2>/dev/null)
RC=$?
SECS=$(( $(date +%s) - T0 ))
CODE=$(printf '%s' "$CODE" | tr -cd '0-9' | head -c 3)
[ -n "$CODE" ] || CODE=000
REASON=""
if [ "$RC" -ne 0 ]; then
  case "$RC" in 28) REASON="timed out after 20 s" ;; 6) REASON="could not resolve the host" ;; 7) REASON="could not connect" ;; 35|60) REASON="TLS failed" ;; *) REASON="curl exit $RC" ;; esac
elif [ "$CODE" != 200 ]; then REASON="HTTP $CODE"
else
  if command -v node >/dev/null 2>&1; then
    node -e 'const fs=require("fs");let j;try{j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"))}catch{process.exit(3)}process.exit(j&&typeof j==="object"&&j.schema===process.argv[2]?0:4)' "$BODY" "$SCHEMA"
    J=$?
  else
    # no node on PATH: a JSON object that names the schema (the box has node; this is a fallback, not the rule)
    if head -c 1 "$BODY" | grep -q '{' && tr -d ' \n' < "$BODY" | grep -q "\"schema\":\"$SCHEMA\""; then J=0; else J=4; fi
  fi
  case "$J" in 0) ;; 3) REASON="HTTP 200 but the body is not JSON" ;; *) REASON="HTTP 200 but the JSON is not $SCHEMA" ;; esac
fi

if [ -z "$REASON" ]; then
  if curl -fsS --max-time 10 -o /dev/null "$URL" >/dev/null 2>&1; then PINGED=true; PNOTE=""; else PINGED=false; PNOTE="; the ping to the monitor FAILED"; fi
  say "ok: HTTP 200, $SCHEMA, ${SECS}s$PNOTE"
  write_status true ok "$CODE" "" "$(now_iso)" "$PINGED"
else
  FAIL="${URL%/}/fail"
  if curl -fsS --max-time 10 -o /dev/null --data-raw "code=$CODE $REASON" "$FAIL" >/dev/null 2>&1; then PINGED=true; PNOTE=""; else PINGED=false; PNOTE="; the /fail ping to the monitor FAILED"; fi
  say "FAIL: code=$CODE $REASON (${SECS}s)$PNOTE"
  write_status true fail "$CODE" "$REASON" "$(prev_field lastOkAt)" "$PINGED"
fi
exit 0
