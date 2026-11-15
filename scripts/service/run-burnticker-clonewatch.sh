#!/bin/sh
# Entrypoint for the CLONE WATCH (mct-burnticker-clonewatch.timer → .service, growth batch 2026-10-10): one keyless DexScreener scan for
# Solana tokens named like DEFICIT / Burnticker / a launched ticker that are not Burnticker coins, recorded append-only in the registry
# database for /burnticker/not-burnticker and GET /api/burnticker/v1/clones. Reads no key, signs nothing.
#   BURNTICKER_DB (data/burnticker.db) · BURNTICKER_RPC_URL (holders; program read with BURNTICKER_PROGRAM_ID)
set -eu
cd "$(dirname "$0")/../.."
. ./scripts/load-env.sh
load_env_local .
export BURNTICKER_DB="${BURNTICKER_DB:-data/burnticker.db}"
if [ ! -f "$BURNTICKER_DB" ]; then echo "[$(date -u '+%Y-%m-%d %H:%M:%SZ')] no registry at $BURNTICKER_DB yet — nothing to watch"; exit 0; fi
exec node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/alias-hook.mjs scripts/burnticker-clone-watch.mts "$@"
