#!/bin/sh
# Entrypoint for mct-burnticker-synth (2026-10-15): the nightly synthetic creator against a DEVNET instance of the shipped build.
#
# How the box runs devnet beside mainnet: the same prebuilt .next is started a second time with `next start` on 127.0.0.1:3100, with
# BURNTICKER_CLUSTER=devnet and its own data directory (data/devnet-synth/: registry, publish dir, its own mint bank). The cluster is read
# at request time, so one build serves both. The one baked-in value is the wallet RPC (NEXT_PUBLIC_BURNTICKER_RPC_URL, the mainnet proxy
# https://burnticker.com/api/burnticker/rpc); the synthetic creator answers every browser call to it from the devnet RPC
# (BURNTICKER_SYNTH_BROWSER_RPC), so nothing it signs or reads touches mainnet. Caddy does not route to 3100 or 3101: loopback only.
#
# The devnet instance gets devnet-synth.env and NOTHING of the live host's env file except the two read-only sports data keys: `next
# start` reads the live env file by itself, so every name in it is set empty first (start_web below). devnet-synth.env holds public values: BURNTICKER_PROGRAM_ID, BURNTICKER_PLATFORM_ID, BURNTICKER_ADMIN, BURNTICKER_KEEPER_PUBKEY, BURNTICKER_FEE_WALLET,
# BURNTICKER_LOOKUP_TABLE (the devnet table, docs/burnticker/HOSTED-LAUNCH-DEVNET-PROOF.md step A), BURNTICKER_RPC_URL (devnet), and the
# synthetic creator's BURNTICKER_SYNTH_KEYPAIR (a devnet-only keypair file) and BURNTICKER_SYNTH_CHAIN (real, or stub until the devnet table
# exists). The push channel (BURNTICKER_PUSH_URL / _TOKEN) comes from the live env file, loaded for the creator process only (after
# devnet-synth.env, so its values win), never for the devnet web process.
#
# THE DEVNET MINT BANK (2026-10-15: on the box the browser's burn-address search takes about 200 s, so five scenarios ran out of their wait).
# With BURNTICKER_SYNTH_BANK_KEY in devnet-synth.env (its own 32-byte key, made by the owner; never the live bank's key or file) this:
#   1. tops data/devnet-synth/bank.db up to BURNTICKER_SYNTH_BANK_SIZE ready keys (default 12) on ONE worker at nice 19, for at most
#      BURNTICKER_SYNTH_BANK_FILL_S seconds (default 300; the live bank already grinds on three of the box's four cores);
#   2. starts the devnet instance on that bank (it hands each launch a prepared key, as mainnet does), and a SECOND instance on
#      BURNTICKER_SYNTH_EMPTY_PORT (default 3101) with no bank, where only d-mint-source runs, to prove the page's browser search;
#   3. keeps the bank at that size on the same one worker while the scenarios take keys, and stops the grinder when the run ends.
# Without the key every launch searches in the browser, as before (one instance, the empty bank).
#
#   sh scripts/service/run-burnticker-synth.sh --fill-bank     the owner's one-off first fill: grind to SIZE on one worker, no time limit
#   sh scripts/service/run-burnticker-synth.sh --bank-status   the devnet bank's counts (no key is printed)
set -eu
cd "$(dirname "$0")/../.."
PORT=${BURNTICKER_SYNTH_PORT:-3100}
D=data/devnet-synth
BANK=$D/bank.db
stamp() { date -u '+%F %TZ'; }
mkdir -p "$D" logs
[ -f .next/BUILD_ID ] || { echo "[$(stamp)] no production build in .next"; exit 2; }
[ -f devnet-synth.env ] || { echo "[$(stamp)] devnet-synth.env is missing (docs/burnticker/SYNTHETIC-CREATOR.md)"; exit 2; }
# one value of devnet-synth.env, read in a subshell (nothing else of the file reaches this shell)
synth_var() { ( set -a; . ./devnet-synth.env; eval "printf '%s' \"\${$1-}\"" ); }
EMPTY_PORT=$(synth_var BURNTICKER_SYNTH_EMPTY_PORT); EMPTY_PORT=${EMPTY_PORT:-$((PORT + 1))}
SIZE=$(synth_var BURNTICKER_SYNTH_BANK_SIZE); SIZE=${SIZE:-12}
FILL_S=$(synth_var BURNTICKER_SYNTH_BANK_FILL_S); FILL_S=${FILL_S:-300}
HAVE_BANK=0
if [ -n "$(synth_var BURNTICKER_SYNTH_BANK_KEY)" ]; then
  HAVE_BANK=1
  # never the live bank's sealing key: compared in a subshell, nothing printed
  if ( . ./scripts/load-env.sh; load_env_local .; L=${BURNTICKER_MINT_BANK_KEY-}; set -a; . ./devnet-synth.env; [ -n "$L" ] && [ "$L" = "$BURNTICKER_SYNTH_BANK_KEY" ] ); then
    echo "[$(stamp)] refusing: BURNTICKER_SYNTH_BANK_KEY is the live bank's key. Make the devnet bank its own key (docs/burnticker/SYNTHETIC-CREATOR.md)."; exit 2
  fi
fi

# the devnet bank's grinder: devnet-synth.env only, its own file and key, one worker, lowest priority. $1: --max-seconds (0 = until full);
# $2 = bg: started in the background, holding the bank at SIZE while the scenarios take keys (--hold), with FILL set to the grinder's own
# pid (env and sh exec into node, so the TERM at the end reaches it and it stops between batches)
bank_fill() {
  set -- "$1" "${2:-}" "set -a; . ./devnet-synth.env; set +a; \
    export BURNTICKER_MINT_BANK_KEY=\"\$BURNTICKER_SYNTH_BANK_KEY\" BURNTICKER_MINT_BANK_PATH=$BANK BURNTICKER_MINT_BANK_WORKERS=1 BURNTICKER_DB=$D/registry.db; unset BURNTICKER_SYNTH_BANK_KEY; \
    exec nice -n 19 node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/alias-hook.mjs scripts/burnticker-mint-bank.mts --once --to $SIZE --max-seconds $1 $([ "${2:-}" != bg ] || echo --hold)"
  if [ "$2" = bg ]; then env -i PATH="$PATH" HOME="$HOME" TZ=America/Denver sh -c "$3" >> logs/burnticker-synth-bank.log 2>&1 & FILL=$!
  else env -i PATH="$PATH" HOME="$HOME" TZ=America/Denver sh -c "$3" >> logs/burnticker-synth-bank.log 2>&1; fi
}
# one devnet web instance: $1 port, $2 bank file, $3 1 = sealed with the devnet bank key, 0 = no bank key (every launch searches). The
# write burst and the per-wallet pin cap are raised for the night's dozen launches from one wallet on one loopback client (2026-10-18: the
# cap of 6 refused every scenario after the sixth pin); both settings are honoured on devnet only (http.ts limitsFromEnv, handlers.ts
# pinCreatorDailyCapFromEnv), so the live host's limits never move.
#
# THE LIVE HOST'S ENV NEVER REACHES A DEVNET INSTANCE (2026-10-18). `env -i` is not enough: `next start` reads the live env file in the
# repository by itself (@next/env, the file scripts/load-env.sh reads) and fills in every name the process does not already have. So
# EVERY name in that file (env_local_names: names only, no value is read here) and the SYNTH_WEB_SECRETS floor are set EMPTY before
# devnet-synth.env is read: a name that is defined, even empty, is never filled in by Next, and anything devnet-synth.env or start_web sets
# itself still wins. A secret added to the live file later is blanked with no change here. Kept ON PURPOSE (SYNTH_WEB_KEPT): the
# read-only sports data keys the team and rivalry schedules need. The consequence: no uploader, so devnet coins use hosted metadata and
# the pin budget is not exercised on devnet; and no live push, alert, PIN, signer, bank, RPC or API key in a devnet process.
SYNTH_WEB_SECRETS="BURNTICKER_UPLOAD_PAYER BURNTICKER_MINT_BANK_KEY BURNTICKER_SYNTH_BANK_KEY BURNTICKER_PUSH_URL BURNTICKER_PUSH_TOKEN \
BURNTICKER_ALERT_WEBHOOK BURNTICKER_ALERT_WEBHOOK_TOKEN BURNTICKER_OPS_PIN MCT_ACTION_PIN BURNTICKER_RPC_URL"
SYNTH_WEB_KEPT="BURNTICKER_THESPORTSDB_KEY BURNTICKER_APISPORTS_KEY"
# the names start_web sets empty: the floor and every name in the live env file, less the kept ones (names only, never a value)
synth_web_blank() {
  ( . ./scripts/load-env.sh
    for n in $SYNTH_WEB_SECRETS $(env_local_names .); do
      case " $SYNTH_WEB_KEPT " in (*" $n "*) continue ;; esac
      # the process's own basics are never blanked, whatever the live file holds
      case "$n" in (PATH|HOME|TZ|NODE_ENV|NODE_OPTIONS) continue ;; esac
      printf '%s= ' "$n"
    done )
}
SYNTH_WEB_BLANK=$(synth_web_blank)
start_web() {
  # the secrets blanked first (above), then devnet-synth.env; the 3100 instance's bank key is the devnet bank's, set from
  # BURNTICKER_SYNTH_BANK_KEY here; on 3101 it stays empty
  env -i PATH="$PATH" HOME="$HOME" TZ=America/Denver NODE_ENV=production sh -c "export $SYNTH_WEB_BLANK; set -a; . ./devnet-synth.env; set +a; BURNTICKER_MINT_BANK_KEY=; \
    if [ $3 = 1 ]; then BURNTICKER_MINT_BANK_KEY=\"\$BURNTICKER_SYNTH_BANK_KEY\"; fi; export BURNTICKER_MINT_BANK_KEY BURNTICKER_SYNTH_BANK_KEY=; \
    export BURNTICKER_CLUSTER=devnet BURNTICKER_DB=$D/registry.db BURNTICKER_PUBLISH_DIR=$D/site BURNTICKER_MINT_BANK_PATH=$2 \
      BURNTICKER_CREATOR_LAUNCHES_ENABLED=1 BURNTICKER_ALLOW_HOSTED_METADATA=1 BURNTICKER_END_SINKS_LIVE=1 BURNTICKER_DEVNET_WRITE_BURST=60 BURNTICKER_DEVNET_PIN_CREATOR_DAILY_CAP=40 BURNTICKER_PUBLIC_ORIGIN=http://127.0.0.1:$1; \
    exec ./node_modules/.bin/next start -H 127.0.0.1 -p $1" >> "logs/burnticker-synth-web-$1.log" 2>&1 &
}
wait_web() { i=0; until curl -fsS -o /dev/null "http://127.0.0.1:$1/api/burnticker/build"; do i=$((i+1)); [ $i -lt 60 ] || { echo "[$(stamp)] the devnet instance on $1 did not answer in 60 s"; exit 2; }; sleep 1; done; }

if [ "${1:-}" = --fill-bank ] || [ "${1:-}" = --bank-status ]; then
  [ $HAVE_BANK = 1 ] || { echo "no BURNTICKER_SYNTH_BANK_KEY in devnet-synth.env (docs/burnticker/SYNTHETIC-CREATOR.md)"; exit 2; }
  if [ "$1" = --bank-status ]; then
    env -i PATH="$PATH" HOME="$HOME" sh -c "set -a; . ./devnet-synth.env; set +a; export BURNTICKER_MINT_BANK_KEY=\"\$BURNTICKER_SYNTH_BANK_KEY\" BURNTICKER_MINT_BANK_PATH=$BANK; unset BURNTICKER_SYNTH_BANK_KEY; \
      exec node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/alias-hook.mjs scripts/burnticker-mint-bank.mts --status"
    exit $?
  fi
  echo "[$(stamp)] devnet mint bank $BANK: filling to $SIZE ready keys on one worker (about four minutes a key on the box); log: logs/burnticker-synth-bank.log"
  bank_fill 0; CODE=$?; tail -n 1 logs/burnticker-synth-bank.log; exit $CODE
fi

# --serve (2026-10-19, the owner's real-wallet devnet check): start ONLY the devnet instance on 127.0.0.1:$PORT, with the same blanked
# environment and the devnet bank when there is one, and hold it until this process is stopped. No scenarios, no bank top-up, no
# Playwright. Loopback only: reach it with an ssh tunnel (ssh -N -L 3100:127.0.0.1:3100 <host>) so a browser wallet sees http://localhost.
if [ "${1:-}" = --serve ]; then
  WEB=""
  trap '[ -z "$WEB" ] || kill "$WEB" 2>/dev/null || true' EXIT INT TERM
  if [ $HAVE_BANK = 1 ]; then start_web "$PORT" "$BANK" 1; else start_web "$PORT" "$D/empty-bank.db" 0; fi; WEB=$!
  wait_web "$PORT"
  echo "[$(stamp)] devnet instance serving on 127.0.0.1:$PORT (build $(cat .next/BUILD_ID), $([ $HAVE_BANK = 1 ] && echo 'devnet bank' || echo 'no bank: launches search in the browser')); stop with Ctrl-C or kill $$"
  wait "$WEB"; exit $?
fi

# audit 2026-10-16 F-32: a Playwright install lock left by a hung installer (over an hour old, no installer alive) is removed first
sh ./scripts/service/playwright-dirlock.sh || true

WEB=""; WEB2=""; FILL=""
cleanup() {
  [ -z "$FILL" ] || { kill -TERM "$FILL" 2>/dev/null || true; wait "$FILL" 2>/dev/null || true; }
  for p in $WEB $WEB2; do kill "$p" 2>/dev/null || true; done
}
trap cleanup EXIT INT TERM

if [ $HAVE_BANK = 1 ]; then
  echo "[$(stamp)] devnet mint bank $BANK: topping up to $SIZE ready keys on one worker, for at most $FILL_S s"
  bank_fill "$FILL_S" || echo "[$(stamp)] the devnet bank top-up failed (logs/burnticker-synth-bank.log); launches search in the browser when it is empty"
  tail -n 1 logs/burnticker-synth-bank.log
fi
echo "[$(stamp)] synthetic creator: starting the devnet instance on 127.0.0.1:$PORT (build $(cat .next/BUILD_ID))$([ $HAVE_BANK = 1 ] && echo ", on the devnet bank; the empty-bank instance on 127.0.0.1:$EMPTY_PORT")"
if [ $HAVE_BANK = 1 ]; then
  start_web "$PORT" "$BANK" 1; WEB=$!
  start_web "$EMPTY_PORT" "$D/empty-bank.db" 0; WEB2=$!
  wait_web "$PORT"; wait_web "$EMPTY_PORT"
  # the top-up goes on while the scenarios take keys; stopped (SIGTERM, it exits between batches) when the run ends
  bank_fill 0 bg
  EMPTY_ARG="--empty-base http://127.0.0.1:$EMPTY_PORT"
else
  echo "[$(stamp)] no BURNTICKER_SYNTH_BANK_KEY in devnet-synth.env: every launch searches for its address in the browser"
  start_web "$PORT" "$D/empty-bank.db" 0; WEB=$!
  wait_web "$PORT"
  EMPTY_ARG=""
fi
set +e
( set -a; . ./devnet-synth.env; set +a; unset BURNTICKER_SYNTH_BANK_KEY
  . ./scripts/load-env.sh; load_env_local .
  unset BURNTICKER_MINT_BANK_KEY
  BURNTICKER_SYNTH_DB="$D/registry.db" \
  BURNTICKER_SYNTH_BROWSER_RPC="${BURNTICKER_SYNTH_BROWSER_RPC:-https://burnticker.com/api/burnticker/rpc}" BURNTICKER_SYNTH_RPC="${BURNTICKER_SYNTH_RPC:-https://api.devnet.solana.com}" \
  node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/alias-hook.mjs scripts/burnticker-synthetic-creator.mts \
    --base "http://127.0.0.1:$PORT" $EMPTY_ARG --chain "${BURNTICKER_SYNTH_CHAIN:-real}" --report "logs/synthetic-creator-$(date -u +%Y%m%d).json" )
CODE=$?
cleanup; trap - EXIT
[ $HAVE_BANK = 0 ] || tail -n 1 logs/burnticker-synth-bank.log
echo "[$(stamp)] synthetic creator finished (exit $CODE)"
exit $CODE
