#!/bin/sh
# Entrypoint for the BURNTICKER WEB (mct-burnticker-web, 2026-10-10): `next start` of the public Burnticker app — the tree
# scripts/ops/publish-public-repo.sh writes, shipped with its prebuilt .next by scripts/ops/deploy-burnticker-host.sh — on the address
# and port the unit pins (127.0.0.1:3000; Caddy proxies only /burnticker, /api/burnticker and /_next to it). Production only: a 4 GB
# host never builds or runs a dev server. Reads the host's env file for the public BURNTICKER_* names the routes use (no keys).
set -eu
cd "$(dirname "$0")/../.."
. ./scripts/load-env.sh
load_env_local .
export PORT="${PORT:-3000}"
BIND="${MCT_BIND_HOST:-127.0.0.1}"
if [ ! -f .next/BUILD_ID ]; then
  echo "[$(date -u '+%Y-%m-%d %H:%M:%SZ')] no production build in .next — ship one from the Mac (docs/burnticker/deploy.md)"
  exit 1
fi
# L-5 (audit 2026-10-19): a bounded SIGTERM drain (scripts/service/web-graceful.cjs), so a restart takes seconds, not the unit's whole
# stop timeout. Absolute path: Node resolves --require against the working directory of every process it starts.
GRACEFUL="$(pwd -P)/scripts/service/web-graceful.cjs"
if [ -f "$GRACEFUL" ]; then export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--require $GRACEFUL"; fi
# HB-138 (2026-10-20): the home and coins memos start building the moment the port opens (scripts/service/web-warm.cjs; a 10 s bounded
# wait and one "warm:" log line), so the first visitors and the deploy smoke join those builds instead of finding the loop busy
WARM="$(pwd -P)/scripts/service/web-warm.cjs"
if [ -f "$WARM" ]; then export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--require $WARM"; fi
# HB-145 (2026-10-20): every request over 2 s and every event-loop hold over 1 s is written to the web log and to
# logs/burnticker-web-slow.log (scripts/service/web-slowlog.cjs); the keeper counts the last hour into ops.json
SLOWLOG="$(pwd -P)/scripts/service/web-slowlog.cjs"
if [ -f "$SLOWLOG" ]; then export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--require $SLOWLOG"; fi
echo "[$(date -u '+%Y-%m-%d %H:%M:%SZ')] starting burnticker web on $BIND:$PORT (build $(cat .next/BUILD_ID)) from $(pwd -P)"
exec ./node_modules/.bin/next start -H "$BIND" -p "$PORT"
