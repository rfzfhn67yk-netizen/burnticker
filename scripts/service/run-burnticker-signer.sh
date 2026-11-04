#!/bin/sh
# Entrypoint for the SECOND READING SIGNER (mct-burnticker-signer, signer-2 2026-10-12; docs/burnticker/SIGNER-TWO-ROLLOUT.md). It runs on
# its OWN small host: never the keeper's box, never the trading VPS. It reads the coins' rules and sources itself, recomputes each reading
# and co-signs the exact message only when its own bytes agree. It sends no transaction and holds no funds; its RPC is read only.
#
# Environment (the signer host's own local env file, mode 600, typed in by the owner — NAMES ONLY here; no value is ever printed):
#   BURNTICKER_COSIGNER_KEY, BURNTICKER_COSIGNER_PASSPHRASE, BURNTICKER_COSIGNER_CLUSTER, BURNTICKER_COSIGNER_PROGRAM_ID,
#   BURNTICKER_COSIGNER_RPC_URL, BURNTICKER_COSIGNER_COINS, BURNTICKER_COSIGNER_JOURNAL, BURNTICKER_COSIGNER_LISTEN, BURNTICKER_COSIGNER_TOKEN
# (what each one is: the header of scripts/burnticker-signer.mts). Extra arguments pass through (health, decide <request.json>).
set -eu
cd "$(dirname "$0")/../.."
. ./scripts/load-env.sh
load_env_local .
mkdir -p logs
echo "[$(date -u '+%Y-%m-%d %H:%M:%SZ')] starting the second reading signer (cluster ${BURNTICKER_COSIGNER_CLUSTER:-unset})"
exec node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/alias-hook.mjs scripts/burnticker-signer.mts "$@"
