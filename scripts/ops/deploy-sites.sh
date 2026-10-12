#!/bin/sh
# Static hosting for Burnticker + $DEFICIT (2026-10-09): merge the brand pages (site/burnticker, site/deficit) and the keepers' publish
# dirs (data/burnticker-site, data/burnkeeper-site) into what Caddy serves (/var/www/burnticker, /var/www/deficit) — local rsync on the
# Burnticker VPS, run as `mct` (the directories are chown'd to mct once by provision-burnticker-host.sh).
#
#   sh scripts/ops/deploy-sites.sh                 brand pages + keeper files (after a change to site/, or the first time)
#   sh scripts/ops/deploy-sites.sh --publish-only  keeper files only — what mct-burnticker-publish.timer runs every minute
#   sh scripts/ops/deploy-sites.sh --check         dry run: print what would change, touch nothing
#   sh scripts/ops/deploy-sites.sh --pages-only    only the two pages Caddy serves on its own (trust ops, 2026-10-10 night):
#                                                  site/burnticker/status/ → $BURNTICKER_WWW/status/ (the public status page; the keeper writes
#                                                  status/status.json beside it, served at https://status.burnticker.com/ and /status/) and
#                                                  site/burnticker/fallback/ → $BURNTICKER_WWW/fallback/ (Caddy's static page while the app is
#                                                  down). --publish-only ships them too, so the timer keeps them in place after every ship.
#
# Layout (site/deficit/README.md "deploy"): the brand page's index.html is the root; the keeper's own index.html is kept beside it as
# status.html ($DEFICIT) / tokens.html (Burnticker's platform index with the audit badge) because its links (t/<ticker>/, trust/) are
# relative to the root. Everything else of the keepers' (status.json, burns.json, receipts.json, rules.json, audit.json, ops.json,
# index.json, t/…) lands as is. Nothing is ever deleted from /var/www by this script; sample/ and README.md never ship. The brand's
# pre-launch status.json / burns.json / rules.json ship only while the keeper has not published its own (audit 4).
# Prints only changed items (rsync -i), so the timer's log stays quiet. Exit code: 0, or the last failing rsync's (ops-2 2026-10-12: a
# failing copy used to be hidden behind the `| sed` that labels the lines, so a status.json that could not be copied left the unit
# green and status.burnticker.com answering 404). rsync's own error lines are printed with the label.
# Runs as `mct`, never as root (ops-2): a root run leaves root-owned directories in /var/www that the mct timer can no longer write.
# --publish-only also runs scripts/ops/keeper-status-check.sh: one line when the keeper's status/status.json goes missing or stale, and
# the optional heartbeat ping (BURNTICKER_STATUS_HEARTBEAT_URL) while it is fresh — docs/burnticker/OPS-EDGE.md "Uptime monitors".
set -eu
cd "$(dirname "$0")/../.."
if [ "$(id -u)" = 0 ] && [ "${DEPLOY_SITES_AS_ROOT:-0}" != 1 ]; then
  echo "refusing to run as root: files written now would be root-owned and the mct publish timer could no longer update them."
  echo "run it as mct:  su - mct -c 'cd ~/meme-coin-trader && sh scripts/ops/deploy-sites.sh $*'"
  exit 2
fi
. ./scripts/load-env.sh
load_env_local .
CHECK=0; PUBLISH_ONLY=0; PAGES_ONLY=0
for a in "$@"; do case "$a" in --check) CHECK=1 ;; --publish-only) PUBLISH_ONLY=1 ;; --pages-only) PAGES_ONLY=1 ;; *) echo "unknown flag $a"; exit 2 ;; esac; done
DEFICIT_WWW="${DEFICIT_WWW:-/var/www/deficit}"
BURNTICKER_WWW="${BURNTICKER_WWW:-/var/www/burnticker}"
BK_PUB="${BURNKEEPER_PUBLISH_DIR:-data/burnkeeper-site}"
BT_PUB="${BURNTICKER_PUBLISH_DIR:-data/burnticker-site}"
# No -p and umask 022: new files land 644 / dirs 755 for Caddy to read (portable to the Mac's rsync 2.6.9, which has no --chmod D/F prefixes).
umask 022
# -O: never set or report directory mtimes — the keeper's tmp+rename publish touches its directory every cycle, which would print one noise line a minute.
RS="rsync -rltO --no-owner --no-group -i --exclude=*.tmp-*"
[ "$CHECK" = 1 ] && RS="$RS -n"
command -v rsync >/dev/null 2>&1 || { echo "rsync is not installed (apt install rsync)"; exit 1; }
stamp() { date '+%Y-%m-%d %H:%M:%S'; }

for d in "$DEFICIT_WWW" "$BURNTICKER_WWW"; do
  if [ ! -d "$d" ] || [ ! -w "$d" ]; then
    echo "[$(stamp)] $d is missing or not writable by $(id -un). Once, as root:  install -d -o $(id -un) -g $(id -gn) -m 755 $d"
    [ "$CHECK" = 1 ] || exit 2
  fi
done

OUT=""; RC=0
add() { if [ -n "$1" ]; then OUT="$OUT$1
"; fi; }
# copy_dir <label> <rsync args…>: runs rsync, labels every line it printed (changes and errors), keeps a failure's exit code in RC.
copy_dir() {
  label="$1"; shift
  # shellcheck disable=SC2086
  if out=$($RS "$@" 2>&1); then :; else st=$?; RC=$st; out="$out
rsync FAILED (exit $st)"; fi
  [ -z "$out" ] || add "$(printf '%s\n' "$out" | sed "s|^|  $label: |")"
}
site() {   # site <label> <brand dir> <publish dir> <www> <keeper index name>
  label="$1"; brand="$2"; pub="$3"; www="$4"; keeper_index="$5"
  if [ "$PUBLISH_ONLY" = 0 ] && [ -d "$brand" ]; then
    # Audit 4 BT-03: the brand dir carries pre-launch evidence files (site/deficit/{status,burns,rules}.json: an explicit "not launched"
    # state and the exact rule bytes) so the advertised links never 404. Once the keeper publishes its own copy of one, the keeper's wins:
    # the brand copy is excluded and never overwrites live data.
    KEEP=""
    for f in status.json burns.json rules.json; do [ -f "$pub/$f" ] && KEEP="$KEEP --exclude=/$f"; done
    # shellcheck disable=SC2086
    copy_dir "$label brand" --exclude='sample/' --exclude='README.md' --exclude='*.mjs' $KEEP "$brand/" "$www/"
  fi
  if [ -d "$pub" ]; then
    copy_dir "$label publish" --exclude='index.html' "$pub/" "$www/"
    if [ -f "$pub/index.html" ] && { [ ! -f "$www/$keeper_index" ] || ! cmp -s "$pub/index.html" "$www/$keeper_index"; }; then
      if [ "$CHECK" = 1 ]; then add "  $label publish: would copy index.html → $keeper_index"; else install -m 644 "$pub/index.html" "$www/$keeper_index.tmp-$$" && mv "$www/$keeper_index.tmp-$$" "$www/$keeper_index"; add "  $label publish: index.html → $keeper_index"; fi
    fi
  else
    [ "$PUBLISH_ONLY" = 1 ] || add "  $label publish: $pub does not exist yet (the keeper writes it on its first cycle)"
  fi
}
pages() {   # the status page and the app-down fallback: small, and Caddy needs both in place whatever else ships
  for p in status fallback; do
    if [ -d "site/burnticker/$p" ]; then
      [ "$CHECK" = 1 ] || [ -d "$BURNTICKER_WWW/$p" ] || install -d -m 755 "$BURNTICKER_WWW/$p"
      copy_dir "burnticker $p page" "site/burnticker/$p/" "$BURNTICKER_WWW/$p/"
    fi
  done
}
if [ "$PAGES_ONLY" = 1 ]; then
  pages
else
  site deficit site/deficit "$BK_PUB" "$DEFICIT_WWW" status.html
  site burnticker site/burnticker "$BT_PUB" "$BURNTICKER_WWW" tokens.html
  if [ "$PUBLISH_ONLY" = 1 ]; then
    pages
    add "$(sh scripts/ops/keeper-status-check.sh "$BT_PUB" data/.keeper-status-state | sed "s|^|  keeper status: |")"
  fi
fi

if [ -n "$OUT" ]; then
  echo "[$(stamp)] deploy-sites$([ "$CHECK" = 1 ] && echo ' (check — nothing written)')$([ "$PUBLISH_ONLY" = 1 ] && echo ' (publish only)')$([ "$PAGES_ONLY" = 1 ] && echo ' (pages only)'):"
  printf '%s' "$OUT"
fi
exit $RC
