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
#      A restart command that itself exits non-zero (fourth prelaunch audit F01, 2026-10-18) is a failure like a failed smoke: the same
#      swap back, restart and check. If the restart fails again on the previous build, it says the web is down and exits 1.
#   The exit status of a failure survives the EXIT cleanup (it is never turned into 0).
#
# RELEASE MODE (audit 2026-10-19 L-5): with BT_RELEASE=<a release directory holding its own source, node_modules and .next> and
# BT_CURRENT=<the release link, ~mct/meme-coin-trader> (scripts/ops/release-host.sh), nothing is moved inside a running tree. The
# swap is one atomic switch of the link to the new release (a new link renamed over the old one); the smoke is the same; a failure
# switches the link back to the release that was serving, so the source, node_modules and the build all return together. The static
# carry copies the serving release's own chunks into the new release's .next. On success the serving release is recorded in
# <releases>/.previous, which is what a rollback (rollback-burnticker.sh --previous-release) switches back to with this same script.
#
# THE LIMIT (legacy mode only, say it plainly): only the Next build is swapped back. The deploy has already mirrored the SOURCE (keepers and scripts run
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
# for a message: "none" when systemd gave no identity at all (review of A-7/F01, 2026-10-18), never a bare "pid= ts="
show_id() { case "$1" in ""|"pid= ts=") echo none ;; *) echo "$1" ;; esac; }
DEADLINE="${BT_WEB_DEADLINE:-150}"
BACK_DEADLINE="${BT_WEB_ROLLBACK_DEADLINE:-60}"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/bt-swap.XXXXXX")"
# keep the script's own exit status through the cleanup (a shell that exits on an error otherwise reports the cleanup's 0)
trap 'rc=$?; rm -rf "$TMP"; exit $rc' EXIT

# where the running build and the staged one are: one tree (legacy: .next and .next-staging) or two releases behind a link (release mode)
RELEASE="${BT_RELEASE:-}"; LINK="${BT_CURRENT:-}"; PREV=""
if [ -n "$RELEASE" ]; then
  [ -n "$LINK" ] || { echo "SWAP REFUSED: BT_RELEASE needs BT_CURRENT, the release link; nothing was touched"; exit 1; }
  [ -L "$LINK" ] || { echo "SWAP REFUSED: $LINK is not a release link (run release-host.sh migrate once); nothing was touched"; exit 1; }
  RELEASE="$(cd "$RELEASE" 2>/dev/null && pwd -P)" || { echo "SWAP REFUSED: the release ${BT_RELEASE} does not exist; nothing was touched"; exit 1; }
  PREV="$(readlink "$LINK")"
  [ "$(cd "$PREV" 2>/dev/null && pwd -P)" != "$RELEASE" ] || { echo "SWAP REFUSED: $LINK already points at $RELEASE; nothing was touched"; exit 1; }
  RUN="$LINK/.next"; STAGE="$RELEASE/.next"
else
  RUN=.next; STAGE=.next-staging
fi
# the atomic switch: a new link renamed over the old one (GNU mv -T; elsewhere perl's rename, the same rename(2))
switch_link() {
  tmp="$LINK.switch.$$"; rm -f "$tmp"; ln -s "$1" "$tmp"
  mv -T "$tmp" "$LINK" 2>/dev/null || perl -e 'rename($ARGV[0], $ARGV[1]) or die "rename: $!\n"' "$tmp" "$LINK"
}

[ -f "$STAGE/BUILD_ID" ] || { echo "SWAP REFUSED: no staged build ($STAGE/BUILD_ID); the running build is untouched"; exit 1; }
NEW="$(cat "$STAGE/BUILD_ID")"
[ -n "$NEW" ] || { echo "SWAP REFUSED: the staged BUILD_ID is empty; the running build is untouched"; exit 1; }
OLD=""; [ -f "$RUN/BUILD_ID" ] && OLD="$(cat "$RUN/BUILD_ID")"

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
      WHY="the web unit's process did not change across the restart (before: $(show_id "$before"), now: $(show_id "$now_id")): the old process, or none, is answering"
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

# KEEP THE RUNNING BUILD'S STATIC FILES SERVABLE (review of A-22 item 3, 2026-10-18). The edge may keep a page for up to 90 s, and a
# browser may hold one open longer; that HTML names the running build's /_next/static chunks, which the new build does not have, so
# for a minute and a half after every deploy those visitors got broken pages. Before the swap, every static file the RUNNING build
# brought itself (its static-own.txt, or all of .next/static for a build from before this list) that the staged build lacks is copied
# into the staged build. Only one build back is carried: the staged build records its own files in static-own.txt, so files carried
# into it are not carried again next time and nothing piles up across deploys. A staged file is never overwritten.
carry_static() {
  [ -d "$RUN/static" ] && [ -d "$STAGE/static" ] || { echo "static carry: nothing to carry (no $RUN/static or no $STAGE/static)"; return 0; }
  (cd "$STAGE" && find static -type f) > "$TMP/own"
  if [ -f "$RUN/static-own.txt" ]; then cp "$RUN/static-own.txt" "$TMP/prev"; else (cd "$RUN" && find static -type f) > "$TMP/prev"; fi
  n=0
  while IFS= read -r f; do
    [ -n "$f" ] && [ -f "$RUN/$f" ] || continue
    [ -e "$STAGE/$f" ] && continue
    mkdir -p "$STAGE/$(dirname "$f")" && cp -p "$RUN/$f" "$STAGE/$f" && n=$((n + 1))
  done < "$TMP/prev"
  # a release that already has its list (a rollback target) keeps it, so files carried into it are never counted as its own
  if [ -z "$RELEASE" ] || [ ! -f "$STAGE/static-own.txt" ]; then cp "$TMP/own" "$STAGE/static-own.txt"; fi
  echo "static carry: kept $n static files of the running build${OLD:+ $OLD} servable from the new build"
}
carry_static

STARTED=$(date +%s)
# the deploy reads this line: from here on .next may change, so a failure is never "before the swap" (A-9, audit 2026-10-18)
if [ -n "$RELEASE" ]; then
  echo "SWAP STARTED: switching $LINK to release $(basename "$RELEASE") (build $NEW); the serving release $(basename "$PREV")${OLD:+ (build $OLD)} stays in place"
  switch_link "$RELEASE"
else
  echo "SWAP STARTED: moving build $NEW into .next (the running build${OLD:+ $OLD} goes to .next-old)"
  rm -rf .next-old
  if [ -d .next ]; then mv .next .next-old; fi
  mv .next-staging .next
fi
# restart: runs the restart command; on a non-zero exit sets WHY and returns 1 (the smoke never runs, the rollback path does)
restart() {
  if sh -c "$RESTART"; then return 0; else rc=$?; WHY="the restart command failed (exit $rc)"; return 1; fi
}
WHY="the restart or the smoke did not finish"
T0=$(date +%s); ID0=$(unit_id)
if restart && smoke "$NEW" "$DEADLINE" "$T0" "$ID0"; then
  if [ -n "$RELEASE" ]; then
    printf '%s\n' "$PREV" > "$(dirname "$RELEASE")/.previous"
    echo "web is up on build $NEW (smoke passed in $(( $(date +%s) - STARTED )) s; release $(basename "$RELEASE"); the previous release $(basename "$PREV")${OLD:+ (build $OLD)} is kept for a rollback)"
  else
    echo "web is up on build $NEW (smoke passed in $(( $(date +%s) - STARTED )) s; the previous build${OLD:+ $OLD} is kept in .next-old until the next deploy)"
  fi
  exit 0
fi
echo "WEB SMOKE FAILED for build $NEW within ${DEADLINE} s: $WHY"
if [ -n "$RELEASE" ]; then
  switch_link "$PREV"
  : > "$RELEASE/.failed"
  echo "SWAPPED BACK: $LINK points at the previous release $(basename "$PREV") again; the failed release $(basename "$RELEASE") stays in place, marked .failed"
  echo "WHOLE RELEASE SWAPPED BACK: the previous release's source, node_modules and build serve again (only the systemd units this deploy installed stay)"
  T1=$(date +%s); ID1=$(unit_id); WHY="the restart or the smoke did not finish"
  RWHY=""; restart || RWHY="$WHY"
  if smoke "$OLD" "$BACK_DEADLINE" "$T1" "$ID1"; then
    echo "ROLLED BACK: the web is up on the previous build ${OLD:-(no BUILD_ID)} in release $(basename "$PREV")${RWHY:+ (the restart command reported a failure, $RWHY, but the previous build answers)}"
  else
    echo "ROLLBACK DID NOT ANSWER EITHER: ${RWHY:+$RWHY; }$WHY. $LINK points at the previous release $(basename "$PREV") but the web is down; act now (docs/burnticker/ROLLBACK.md)"
  fi
  exit 1
fi
if [ ! -d .next-old ]; then
  echo "NO PREVIOUS BUILD to swap back to (first deploy on this host); build $NEW stays in place and the web is NOT healthy"
  exit 1
fi
rm -rf .next-failed
mv .next .next-failed
mv .next-old .next
echo "SWAPPED BACK: the failed build is in .next-failed; restarting the web unit on the previous build ${OLD:-(no BUILD_ID)}"
echo "ONLY THE WEB BUILD IS SWAPPED BACK: the source, node_modules and systemd units from this deploy stay in place (see the limit in this script's header)"
T1=$(date +%s); ID1=$(unit_id); WHY="the restart or the smoke did not finish"
# the smoke runs even when the restart command reports a failure: a unit can come up although systemctl exited non-zero (review, 2026-10-18)
RWHY=""; restart || RWHY="$WHY"
if smoke "$OLD" "$BACK_DEADLINE" "$T1" "$ID1"; then
  echo "ROLLED BACK: the web is up on the previous build ${OLD:-(no BUILD_ID)}${RWHY:+ (the restart command reported a failure, $RWHY, but the previous build answers)}; the source and node_modules stay the new ones (see the limit in this script's header)"
elif [ -n "$RWHY" ]; then
  echo "ROLLBACK DID NOT ANSWER EITHER: $RWHY on the previous build too, and the check found that $WHY. The previous build ${OLD:-(no BUILD_ID)} is in .next but the web is down; act now (docs/burnticker/ROLLBACK.md)"
else
  echo "ROLLBACK DID NOT ANSWER EITHER: $WHY. The web is down; act now (docs/burnticker/ROLLBACK.md)"
fi
exit 1
