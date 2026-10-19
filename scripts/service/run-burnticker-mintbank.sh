#!/bin/sh
# Entrypoint for the BURNTICKER MINT KEY BANK (mct-burnticker-mintbank, owner 2026-10-14 night: "the BURN vanity address is mandatory.
# Save them like pump.fun does so they launch instantly."). Grinds mint keypairs whose address ends in burn or BURN and keeps them sealed
# in the bank the launch route takes from (src/lib/burnticker/mintBank.ts, scripts/burnticker-mint-bank.mts). Extra flags pass through
# (--once --fill N, --status, --bench).
#
# Environment (the host's local env file, or the unit; NAMES ONLY here, no value is ever printed):
#   BURNTICKER_MINT_BANK_KEY      32 bytes, base64 (openssl rand -base64 32): seals every key. Unset: the service refuses to start.
#   BURNTICKER_MINT_BANK_PATH     the bank file, default data/burnticker-mintbank.db (mode 0600; never copied off this host)
#   BURNTICKER_MINT_BANK_SIZE     keys kept ready, default 300
#   BURNTICKER_MINT_BANK_LOW      refill below this, default 100; a push alert (bt-mint-bank-low) after an hour below it
#   BURNTICKER_MINT_BANK_WORKERS  grinding threads, default every core but one
#   BURNTICKER_DB                 the registry: launched mints are marked spent, the low alert is recorded there
set -eu
cd "$(dirname "$0")/../.."
. ./scripts/load-env.sh
load_env_local .
umask 077
export BURNTICKER_MINT_BANK_PATH="${BURNTICKER_MINT_BANK_PATH:-data/burnticker-mintbank.db}"
mkdir -p data logs
echo "[$(date -u '+%Y-%m-%d %H:%M:%SZ')] starting the mint key bank ($BURNTICKER_MINT_BANK_PATH)"
exec node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/alias-hook.mjs scripts/burnticker-mint-bank.mts "$@"
