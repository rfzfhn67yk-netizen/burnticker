#!/bin/sh
# Removes a stale Playwright install lock (2026-10-16 prelaunch audit F-32). `playwright-core install chromium` holds
# <cache>/__dirlock while it downloads; one started from an interactive root ssh hung for 15 hours and every nightly synthetic run
# behind it waited on the lock. A __dirlock older than an hour while no installer process is alive is left over: removed, and said.
#
#   sh scripts/service/playwright-dirlock.sh [cache dir]     default: $PLAYWRIGHT_BROWSERS_PATH, else ~/.cache/ms-playwright
#
# Only that one path is removed. PLAYWRIGHT_LOCK_PGREP (tests) replaces the live-installer check with a command whose exit status says
# whether one is alive.
set -eu
DIR=${1:-${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}}
LOCK="$DIR/__dirlock"
[ -e "$LOCK" ] || exit 0
installer_alive() {
  if [ -n "${PLAYWRIGHT_LOCK_PGREP:-}" ]; then sh -c "$PLAYWRIGHT_LOCK_PGREP"; return $?; fi
  pgrep -f 'playwright(-core)?[^ ]* install' >/dev/null 2>&1
}
if [ -z "$(find "$LOCK" -maxdepth 0 -mmin +60 2>/dev/null)" ]; then echo "[$(date '+%F %T')] a Playwright install lock is held (under an hour old); left alone"; exit 0; fi
if installer_alive; then echo "[$(date '+%F %T')] a Playwright install lock is held by a running installer; left alone"; exit 0; fi
rm -rf "$LOCK"
echo "[$(date '+%F %T')] removed a stale Playwright install lock ($LOCK, over an hour old, no installer running)"
