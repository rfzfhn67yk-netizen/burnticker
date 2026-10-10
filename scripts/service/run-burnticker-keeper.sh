#!/bin/sh
# Entrypoint for the BURNTICKER KEEPER (mct-burnticker-keeper, 2026-10-09): one loop over every token registered in data/burnticker.db —
# read each selector's settled results on its schedule, plan receipts with the locked rule, run them through the burn_receipts program
# (attest each closed day's unit counter, claim, crank — docs/burnkeeper/README-execution.md; FakeBurnProgram without
# BURNTICKER_PROGRAM_ID + BURNTICKER_RPC_URL, and the pages say so), publish every token's status.json + page and the platform index,
# rewrite data/own-tokens.generated.json (the arms' refuse list for platform coins) and run the ops alert check. LOOP MODE: the
# script loops internally (one cycle a minute); systemd restarts it only on a crash. Extra flags pass through (--once, --dry-run, --alerts).
#
# Environment (.env.local on that host, or the unit — NAMES ONLY here; no value is ever printed):
#   BURNTICKER_DB              the registry, default data/burnticker.db (append-only; back it up with sqlite3 .backup, never by copying)
#   BURNTICKER_PUBLISH_DIR     where index.html / index.json / t/<ticker>/{index.html,status.json,receipts.json,rules.json} go each
#                              cycle, default data/burnticker-site (the publish timer syncs it into /var/www/burnticker)
#   BURNTICKER_CLUSTER         devnet (default) | mainnet
#   BURNTICKER_KEEPER_PUBKEY   the keeper's data key, PUBLIC KEY — recorded on every reading (attester v1); its SOL balance is watched
#   BURNTICKER_FEE_WALLET      the developer wallet, PUBLIC KEY — its balance feeds the daily summary and the morning check's delta
#   BURNTICKER_RPC_URL         the RPC: balances, and (with BURNTICKER_PROGRAM_ID) the program client; unset = the fake, balances "unknown"
#   BURNTICKER_PLATFORM_ID / BURNTICKER_PROGRAM_ID   the LaunchLab platform config / the burn_receipts program id
#   BURNTICKER_SIGNER_PATH     the keeper's OWN encrypted key (default ~/.config/meme-coin-trader/signer-burnticker.enc.json; passphrase
#                              BURNTICKER_SIGNER_PASSPHRASE or the shared one) — pays fees, signs readings as the attester, holds no funds
#   BURNTICKER_ADMIN           the config authority every new TokenConfig names (the Squads vault) — launch bundles only
#   BURNTICKER_MAINNET=1       required before the keeper will talk to a mainnet RPC
#   BURNTICKER_ALERT_WEBHOOK / BURNTICKER_ALERT_WEBHOOK_TOKEN   the operator's alert intake (src/lib/burnticker/alerts.ts); without them
#                                                    alerts are still recorded in the registry's alerts table and published in ops.json
#   OWN_TOKENS_GENERATED_PATH  where the generated refuse list is written (default data/own-tokens.generated.json; the arms read the same path)
# data/PAUSE-burnticker holds cranks (reading, publishing and alerts go on). THIS SCRIPT LOADS NO SIGNING KEY: burnticker-keeper.mts reads
# the keeper's own encrypted file (run-burnkeeper.sh's pattern: outside the repo, passphrase from .env.local or the Keychain).
set -eu
cd "$(dirname "$0")/../.."
. ./scripts/load-env.sh
load_env_local .
export BURNTICKER_DB="${BURNTICKER_DB:-data/burnticker.db}"
export BURNTICKER_PUBLISH_DIR="${BURNTICKER_PUBLISH_DIR:-data/burnticker-site}"
export BURNTICKER_CLUSTER="${BURNTICKER_CLUSTER:-devnet}"
mkdir -p data logs "$BURNTICKER_PUBLISH_DIR"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] starting the burnticker keeper (registry $BURNTICKER_DB, site $BURNTICKER_PUBLISH_DIR, cluster $BURNTICKER_CLUSTER)"
exec node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/alias-hook.mjs scripts/burnticker-keeper.mts "$@"
