#!/bin/sh
# Entrypoint for the hourly BURNTICKER AUDIT (mct-burnticker-audit.timer → .service, 2026-10-09): recompute every receipt of every
# token from the recorded readings and the locked rule, write <BURNTICKER_PUBLISH_DIR>/audit.json (the badge the platform index and
# the trust page read) and EXIT NON-ZERO on any mismatch — the unit then shows as failed in `systemctl --user list-units --failed`,
# and the keeper's alert check raises bt-audit-mismatch (and bt-audit-stale when this stops running). Reads no key, sends nothing.
#   BURNTICKER_DB (data/burnticker.db) · BURNTICKER_PUBLISH_DIR (data/burnticker-site) · BURNTICKER_PROGRAM_ID + BURNTICKER_RPC_URL + BURNTICKER_CLUSTER (the chain leg: a read-only program client, no key)
set -eu
cd "$(dirname "$0")/../.."
. ./scripts/load-env.sh
load_env_local .
export BURNTICKER_DB="${BURNTICKER_DB:-data/burnticker.db}"
export BURNTICKER_PUBLISH_DIR="${BURNTICKER_PUBLISH_DIR:-data/burnticker-site}"
if [ ! -f "$BURNTICKER_DB" ]; then echo "[$(date -u '+%Y-%m-%d %H:%M:%SZ')] no registry at $BURNTICKER_DB yet — nothing to audit"; exit 0; fi
echo "[$(date -u '+%Y-%m-%d %H:%M:%SZ')] burnticker audit (registry $BURNTICKER_DB → $BURNTICKER_PUBLISH_DIR/audit.json)"
exec node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/alias-hook.mjs scripts/burnticker-audit.mts "$@"
