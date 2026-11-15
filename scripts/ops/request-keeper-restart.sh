#!/bin/sh
# DEPLOY-REQUESTED RESTART (2026-10-15; src/lib/burnticker/restartRequest.ts). Run ON THE HOST as mct from the repo directory, after
# the new source is in place: drops data/restart-requested.<unit> for the Burnticker keeper and the mint key bank. Each loop checks for
# its own file at the end of a cycle (never mid-crank), logs "restart requested by deploy <build>", removes the file and exits 0;
# systemd (Restart=always) starts it on the new code. The $DEFICIT keeper (mct-burnkeeper) is not part of this.
#   sh scripts/ops/request-keeper-restart.sh [build id] [--wait SECONDS]
#     build id   default: .next/BUILD_ID, else the time
#     --wait N   then watch the logs for up to N seconds: logs/burnticker-keeper.log for "restart requested by deploy <build>" followed by
#                "burnticker keeper starting" (or "startup (the genesis read) waits": a keeper waiting at startup is up and on the new code),
#                and logs/burnticker-mintbank.log for its own "restart requested by deploy <build>" followed by "mint key bank:". Says which
#                came back; exit 0 when both did, exit 3 otherwise
set -eu
cd "$(dirname "$0")/../.."
BUILD=""; WAIT=0
while [ $# -gt 0 ]; do
  case "$1" in --wait) WAIT="${2:?--wait needs seconds}"; shift 2 ;; *) BUILD="$1"; shift ;; esac
done
[ -n "$BUILD" ] || BUILD="$(cat .next/BUILD_ID 2>/dev/null || date -u +%Y%m%d%H%M%S)"
AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
KLOG=logs/burnticker-keeper.log; MLOG=logs/burnticker-mintbank.log
size() { [ -f "$1" ] && wc -c < "$1" | tr -d ' ' || echo 0; }
KFROM=$(size "$KLOG"); MFROM=$(size "$MLOG")
mkdir -p data
for u in keeper mintbank; do
  printf '{"build":"%s","at":"%s"}\n' "$BUILD" "$AT" > "data/restart-requested.$u.tmp" && mv "data/restart-requested.$u.tmp" "data/restart-requested.$u"
done
echo "restart requested for the keeper and the mint bank (build $BUILD): each exits after its current cycle and systemd starts the new code"
[ "$WAIT" -gt 0 ] 2>/dev/null || exit 0
# came_back <log> <from byte> <start-line pattern>: the request line for this build, then a start line, in what the log gained since
came_back() {
  new=$( [ -f "$1" ] && tail -c "+$(( $2 + 1 ))" "$1" 2>/dev/null || true )
  printf '%s\n' "$new" | grep -q "restart requested by deploy $BUILD" && printf '%s\n' "$new" | sed -n "/restart requested by deploy $BUILD/,\$p" | grep -Eq "$3"
}
start=$(date +%s); K=0; M=0
while :; do
  [ "$K" = 1 ] || { came_back "$KLOG" "$KFROM" "burnticker keeper starting|startup \(the genesis read\) waits" && { K=1; echo "keeper restarted on build $BUILD after $(( $(date +%s) - start )) s"; }; }
  [ "$M" = 1 ] || { came_back "$MLOG" "$MFROM" "mint key bank:" && { M=1; echo "mint bank restarted on build $BUILD after $(( $(date +%s) - start )) s"; }; }
  [ "$K" = 1 ] && [ "$M" = 1 ] && exit 0
  if [ $(( $(date +%s) - start )) -ge "$WAIT" ]; then
    for u in keeper mintbank; do
      done_=$K; [ "$u" = mintbank ] && done_=$M
      [ "$done_" = 1 ] && continue
      if [ -f "data/restart-requested.$u" ]; then why="the request is still waiting (a long cycle or fill, or the unit is not running: systemctl --user status mct-burnticker-$u)"
      else why="the request was taken but no new start line yet"; fi
      name=$([ "$u" = keeper ] && echo KEEPER || echo "MINT BANK")
      echo "$name DID NOT RESTART within $WAIT s: $why; check logs/burnticker-$u.log"
    done
    exit 3
  fi
  sleep 5
done
