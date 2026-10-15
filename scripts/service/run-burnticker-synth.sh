#!/bin/sh
# Entrypoint for mct-burnticker-synth (2026-10-15): the nightly synthetic creator against a DEVNET instance of the shipped build.
#
# How the box runs devnet beside mainnet: the same prebuilt .next is started a second time with `next start` on 127.0.0.1:3100, with
# BURNTICKER_CLUSTER=devnet and its own data directory (data/devnet-synth/: registry, publish dir, an empty mint bank). The cluster is read
# at request time, so one build serves both. The one baked-in value is the wallet RPC (NEXT_PUBLIC_BURNTICKER_RPC_URL, the mainnet proxy
# https://burnticker.com/api/burnticker/rpc); the synthetic creator answers every browser call to it from the devnet RPC
# (BURNTICKER_SYNTH_BROWSER_RPC), so nothing it signs or reads touches mainnet. Caddy does not route to 3100: it is loopback only.
#
# The devnet instance gets ONLY devnet-synth.env (never the live host's env file, which holds its uploader and bank keys). That file holds
# public values: BURNTICKER_PROGRAM_ID, BURNTICKER_PLATFORM_ID, BURNTICKER_ADMIN, BURNTICKER_KEEPER_PUBKEY, BURNTICKER_FEE_WALLET,
# BURNTICKER_LOOKUP_TABLE (the devnet table, docs/burnticker/HOSTED-LAUNCH-DEVNET-PROOF.md step A), BURNTICKER_RPC_URL (devnet), and the
# synthetic creator's BURNTICKER_SYNTH_KEYPAIR (a devnet-only keypair file) and BURNTICKER_SYNTH_CHAIN (real, or stub until the devnet table
# exists). The push channel (BURNTICKER_PUSH_URL / _TOKEN) comes from the live env file, loaded for the creator process only (after
# devnet-synth.env, so its values win), never for the devnet web process.
set -eu
cd "$(dirname "$0")/../.."
PORT=${BURNTICKER_SYNTH_PORT:-3100}
D=data/devnet-synth
mkdir -p "$D" logs
[ -f .next/BUILD_ID ] || { echo "[$(date '+%F %T')] no production build in .next"; exit 2; }
[ -f devnet-synth.env ] || { echo "[$(date '+%F %T')] devnet-synth.env is missing (docs/burnticker/SYNTHETIC-CREATOR.md)"; exit 2; }
echo "[$(date '+%F %T')] synthetic creator: starting the devnet instance on 127.0.0.1:$PORT (build $(cat .next/BUILD_ID))"
env -i PATH="$PATH" HOME="$HOME" TZ=America/Denver NODE_ENV=production sh -c "set -a; . ./devnet-synth.env; set +a; \
  export BURNTICKER_CLUSTER=devnet BURNTICKER_DB=$D/registry.db BURNTICKER_PUBLISH_DIR=$D/site BURNTICKER_MINT_BANK_PATH=$D/empty-bank.db \
    BURNTICKER_CREATOR_LAUNCHES_ENABLED=1 BURNTICKER_ALLOW_HOSTED_METADATA=1 BURNTICKER_END_SINKS_LIVE=1 BURNTICKER_DEVNET_WRITE_BURST=60 BURNTICKER_PUBLIC_ORIGIN=http://127.0.0.1:$PORT; \
  exec ./node_modules/.bin/next start -H 127.0.0.1 -p $PORT" > logs/burnticker-synth-web.log 2>&1 &
WEB=$!
trap 'kill $WEB 2>/dev/null || true' EXIT INT TERM
i=0; until curl -fsS -o /dev/null "http://127.0.0.1:$PORT/api/burnticker/build"; do i=$((i+1)); [ $i -lt 60 ] || { echo "the devnet instance did not answer in 60 s"; exit 2; }; sleep 1; done
set +e
( set -a; . ./devnet-synth.env; set +a
  . ./scripts/load-env.sh; load_env_local .
  BURNTICKER_SYNTH_DB="$D/registry.db" \
  BURNTICKER_SYNTH_BROWSER_RPC="${BURNTICKER_SYNTH_BROWSER_RPC:-https://burnticker.com/api/burnticker/rpc}" BURNTICKER_SYNTH_RPC="${BURNTICKER_SYNTH_RPC:-https://api.devnet.solana.com}" \
  node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/alias-hook.mjs scripts/burnticker-synthetic-creator.mts \
    --base "http://127.0.0.1:$PORT" --chain "${BURNTICKER_SYNTH_CHAIN:-real}" --report "logs/synthetic-creator-$(date -u +%Y%m%d).json" )
CODE=$?
echo "[$(date '+%F %T')] synthetic creator finished (exit $CODE)"
exit $CODE
