#!/bin/sh
# SWAP THE STAGED WEB BUILD IN, SMOKE IT, AND SWAP BACK ON FAILURE (third prelaunch audit F02, 2026-10-16). Runs ON THE HOST as mct, from
# the repo directory, called by scripts/ops/deploy-burnticker-host.sh after the build was copied into .next-staging. The deploy SENDS this
# file from the Mac it runs on (review of F02: a rollback to a public commit made before this script existed mirrors it away on the host,
# so the host's copy is never what runs).
#
#   sh scripts/ops/swap-web-build.sh
#     BT_WEB_URL       the web unit's local origin (default http://127.0.0.1:3000)
#     BT_WEB_RESTART   the command that restarts the web unit (default: systemctl --user restart mct-burnticker-web)
#     BT_WEB_DEADLINE  seconds the smoke may take in all, restart included (default 150); each request is capped at 10 s
#     BT_WEB_ROLLBACK_DEADLINE  the same for the previous build after a swap back (default 60)
#
# What it does:
#   1. reads the staged build id (.next-staging/BUILD_ID); refuses without one (nothing is touched)
#   2. drops the release kept from the deploy before last (.next-old), moves the running build to .next-old and the staged one to .next
#   3. restarts the web unit and SMOKES it until the deadline: GET /api/burnticker/build must answer HTTP 200 with {"build":"<staged id>"}
#      from a NEW process: systemd's MainPID and ActiveEnterTimestampMonotonic of the web unit must have changed since before the restart
#      (works for a build of any commit, including rollback targets made before the route reported a start time); a `startedAt` the
#      route reports (builds since 2026-10-16) must also be no earlier than the restart. So an answer from the old process or a unit
#      that did not restart cannot pass; and GET /burnticker must answer HTTP 200 with a page that names Burnticker. A 403 / 404 / 500, another build id, a body without the expected text, or no answer at all keeps it trying until
#      the deadline; then it fails.
#   4. on success: "web is up on build <id>". The previous release STAYS in .next-old (until the next deploy replaces it), so a later
#      check (the public deploy smoke) can still be answered with a swap back by hand: mv .next .next-failed && mv .next-old .next.
#   5. on failure: SWAPS BACK by itself (.next → .next-failed, .next-old → .next), restarts the web unit, checks that the previous build
#      answers, says which build is live, and exits 1. A previous build without a BUILD_ID, or from before `startedAt` existed, is checked
#      for what it can show: HTTP 200 on both paths, a new unit process, and a fresh start time only when it reports one.
#
# THE LIMIT (say it plainly): only the Next build is swapped back. The deploy has already mirrored the SOURCE (keepers and scripts run
# from it) and, when package-lock.json changed, run npm ci in place; neither is undone here. A failed web smoke therefore leaves the old
# web build serving next to new source and node_modules. A full rollback is scripts/ops/rollback-burnticker.sh (a previous public commit,
# shipped the normal way; docs/burnticker/ROLLBACK.md).
set -eu
URL="${BT_WEB_URL:-http://127.0.0.1:3000}"
RESTART="${BT_WEB_RESTART:-systemctl --user restart mct-burnticker-web}"
# The web unit's process identity (review of F02, 2026-10-16): changes with every (re)start. systemctl prints Key=Value lines, and its
# order of the properties is not the order asked for (systemd 259 on the box prints ActiveEnterTimestampMonotonic first), so both are
# read BY NAME and printed as "pid=<MainPID> ts=<ActiveEnterTimestampMonotonic>"; pid empty or 0 = no process.
UNIT_ID="${BT_WEB_UNIT_ID:-systemctl --user show mct-burnticker-web -p MainPID -p ActiveEnterTimestampMonotonic}"
unit_id() {
  out=$(sh -c "$UNIT_ID" 2>/dev/null) || out=""
  pid=$(printf '%s\n' "$out" | sed -n 's/^MainPID=//p' | head -1)
  ts=$(printf '%s\n' "$out" | sed -n 's/^ActiveEnterTimestampMonotonic=//p' | head -1)
  echo "pid=$pid ts=$ts"
}
unit_pid() { p="${1#pid=}"; echo "${p%% *}"; }
DEADLINE="${BT_WEB_DEADLINE:-150}"
BACK_DEADLINE="${BT_WEB_ROLLBACK_DEADLINE:-60}"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/bt-swap.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

[ -f .next-staging/BUILD_ID ] || { echo "SWAP REFUSED: no staged build (.next-staging/BUILD_ID); the running build is untouched"; exit 1; }
NEW="$(cat .next-staging/BUILD_ID)"
[ -n "$NEW" ] || { echo "SWAP REFUSED: the staged BUILD_ID is empty; the running build is untouched"; exit 1; }
OLD=""; [ -f .next/BUILD_ID ] && OLD="$(cat .next/BUILD_ID)"

# One request: prints "<status>" and leaves the body in $TMP/body. curl exits non-zero on no answer / timeout: status 000.
get() { # $1 path, $2 max seconds
  code=$(curl -s -o "$TMP/body" -w '%{http_code}' --max-time "$2" "$URL$1" 2>/dev/null) || code="${code:-000}"
  [ -n "$code" ] || code=000
  echo "$code"
}
# Smokes until the deadline. $1 the build id to require ("" = any: a previous build without BUILD_ID), $2 seconds, $3 the restart time
# (unix s), $4 the web unit's process identity before the restart (it must differ now).
# Sets WHY to the last failure. Returns 0 when every check passes.
smoke() {
  want="$1"; until_s=$(( $(date +%s) + $2 )); since="$3"; before="$4"; WHY="no answer"
  while :; do
    left=$(( until_s - $(date +%s) ))
    [ "$left" -gt 0 ] || return 1
    t=$left; [ "$t" -gt 10 ] && t=10
    code=$(get /api/burnticker/build "$t")
    started=$(sed -n 's/.*"startedAt":\([0-9][0-9]*\).*/\1/p' "$TMP/body" 2>/dev/null | head -1)
    if [ "$code" != 200 ]; then
      WHY="GET /api/burnticker/build answered HTTP $code"; [ "$code" = 000 ] && WHY="GET /api/burnticker/build did not answer (refused or timed out)"
    elif ! grep -q '"build":' "$TMP/body"; then
      WHY="GET /api/burnticker/build answered 200 without a build field"
    elif [ -n "$want" ] && ! grep -qF "\"build\":\"$want\"" "$TMP/body"; then
      WHY="GET /api/burnticker/build serves another build ($(head -c 120 "$TMP/body" | tr -d '\n')), not $want"
    elif now_id=$(unit_id); now_pid=$(unit_pid "$now_id"); [ -z "$now_pid" ] || [ "$now_pid" = 0 ] || [ "$now_id" = "$before" ]; then
      WHY="the web unit's process did not change across the restart (before: ${before:-none}, now: ${now_id:-none}): the old process, or none, is answering"
    elif [ -n "$started" ] && [ $(( started / 1000 )) -lt $(( since - 1 )) ]; then
      WHY="the process answering started before the restart (startedAt $started): the web unit did not restart onto this build"
    else
      left=$(( until_s - $(date +%s) )); t=$left; [ "$t" -gt 10 ] && t=10; [ "$t" -gt 0 ] || t=1
      code=$(get /burnticker "$t")
      if [ "$code" != 200 ]; then WHY="GET /burnticker answered HTTP $code"; [ "$code" = 000 ] && WHY="GET /burnticker did not answer"
      elif ! grep -q "Burnticker" "$TMP/body"; then WHY="GET /burnticker answered 200 without the Burnticker page"
      else return 0
      fi
    fi
    [ $(( until_s - $(date +%s) )) -gt 1 ] || return 1
    sleep 1
  done
}

STARTED=$(date +%s)
rm -rf .next-old
if [ -d .next ]; then mv .next .next-old; fi
mv .next-staging .next
T0=$(date +%s); ID0=$(unit_id)
if sh -c "$RESTART" && smoke "$NEW" "$DEADLINE" "$T0" "$ID0"; then
  echo "web is up on build $NEW (smoke passed in $(( $(date +%s) - STARTED )) s; the previous build${OLD:+ $OLD} is kept in .next-old until the next deploy)"
  exit 0
fi
echo "WEB SMOKE FAILED for build $NEW within ${DEADLINE} s: $WHY"
if [ ! -d .next-old ]; then
  echo "NO PREVIOUS BUILD to swap back to (first deploy on this host); build $NEW stays in place and the web is NOT healthy"
  exit 1
fi
rm -rf .next-failed
mv .next .next-failed
mv .next-old .next
echo "SWAPPED BACK: the failed build is in .next-failed; restarting the web unit on the previous build ${OLD:-(no BUILD_ID)}"
T1=$(date +%s); ID1=$(unit_id)
if sh -c "$RESTART" && smoke "$OLD" "$BACK_DEADLINE" "$T1" "$ID1"; then
  echo "ROLLED BACK: the web is up on the previous build ${OLD:-(no BUILD_ID)}; the source and node_modules stay the new ones (see the limit in this script's header)"
else
  echo "ROLLBACK DID NOT ANSWER EITHER: $WHY — the web is down; act now (docs/burnticker/ROLLBACK.md)"
fi
exit 1
