# The synthetic creator and the deploy smoke (2026-10-15)

Launch night's bugs lived in the seams the unit tests cannot see: Caddy's 20 s upstream limit answering a launch with its fallback 503,
Phantom's Lighthouse guard rewriting the transaction, retries refused as "already registered", a pair retry colliding on its pair id, a
press during a deploy restart, a three-minute address search, and the pin check blocked by the CSP. Two programs now walk those seams.

## 1. The synthetic creator (`scripts/burnticker-synthetic-creator.mts`)

Chrome (Playwright) drives the real site build like a creator: it fills the form, reaches the review, presses Launch, connects a test
wallet and signs. The wallet (`scripts/burnticker-synth/wallet.mts`) is injected before any page script. It registers through the Wallet
Standard as "Phantom" (the page discovers wallets only that way) and also sets `window.phantom.solana` / `window.solana`. Its modes:
`plain`, `lighthouse` (Phantom's shape: one or two Lighthouse assertions appended, a compute-budget instruction at the front every second
call, leaving out whatever would push the step past the 1,232-byte packet; the assertion bytes are copied from landed mainnet transactions and simulate as success on devnet), `slow` (50 s, past the page's
45 s stale line), `reject`, `tamper` (one data byte flipped).

| Scenario | What must happen |
|---|---|
| a-event | A Polymarket event coin launches with the Lighthouse wallet. |
| a-team, a-rivalry-game, a-rivalry-series | Skipped without `BURNTICKER_THESPORTSDB_KEY` (NBA and NFL schedules); not driven yet. |
| a-coin-vs-coin | Not driven yet. |
| a-published | A national-debt (published data) coin launches. |
| b-double-press | Two quick presses send one launch request and one wallet request. |
| b-reject-retry | The wallet refuses, the card says the step was not signed, nothing is sent; the second press reuses the plan and draft (no "already registered"). |
| b-reload-relaunch | The wallet refuses, the tab reloads on the kept review (`?resume=review`), and Launch works again with no "already registered". |
| b-reload-pair, b-pair-twice | Not driven yet (they need a pair). |
| c-deploy-window | With `/deploying.json` served and Caddy's JSON 503 on the launch route, the review says the site is being updated, never "catching up". |
| d-mint-source | An empty bank falls back to the browser search (address ends in burn, the page sends its own public key); a bank hands its key with no search panel. `BURNTICKER_SYNTH_EXPECT_BANK=empty|filled` asserts which. |
| e-slow | A wallet slower than the stale line: no send ever carries an expired blockhash; an expired one is rebuilt and asked again. |
| e-tamper | Refused before the send with "was not sent because the wallet changed the transaction…". |

`--chain real` (default) needs devnet SOL (it asks the faucet for 2 SOL and stops if refused) and a devnet lookup table pinned on the
host. `--chain stub` intercepts the browser's RPC: the pinned table is answered with the expected entries, the page's dry run with "ok",
and the send is refused on purpose. Everything up to the network is real, and every sent transaction is checked (each signature verifies,
the blockhash is valid at the send, the Lighthouse instructions are still there). Stub mode does not check that the coin goes live.

Every mint it makes is appended to `logs/synthetic-creator.jsonl`, and with `BURNTICKER_SYNTH_DB` it is flagged
`token_flags.synthetic = 1`, which hides it from every browse surface like a test coin (`testCoins.ts`), without listing it on
`/burnticker/test-coins`. Any failure records one `bt-synthetic-failed` alert per run and pushes it (`push.ts`).

Install once (outside the repository): `mkdir -p ~/.cache/burnticker-synth && cd ~/.cache/burnticker-synth && npm i playwright-core@1.48.2`,
then on Linux `npx playwright-core install --with-deps chromium`. On the Mac the installed Google Chrome is used.

Run against a local devnet build (the PUBLIC tree: the monorepo's own root layout has no wallet provider):

```sh
sh scripts/ops/publish-public-repo.sh --out ~/bt-devnet/public && cd ~/bt-devnet/public && ln -s <repo>/node_modules node_modules
NEXT_PUBLIC_BURNTICKER_RPC_URL=https://api.devnet.solana.com BURNTICKER_CLUSTER=devnet npx next build --webpack
env BURNTICKER_CLUSTER=devnet BURNTICKER_RPC_URL=https://api.devnet.solana.com BURNTICKER_PROGRAM_ID=AuQjoSgq7upmyPBv2itwy2TSZ1VjoVipyy4z9wd7zhMM \
  BURNTICKER_PLATFORM_ID=GvSKpe5pwLuRzCQ56EGAA1urjtcxx554NivsGHexv3tf BURNTICKER_ADMIN=A8VVQ8ztPcPmKTzWJDADP8EthMg8DvqKcK15dNBqMffD \
  BURNTICKER_KEEPER_PUBKEY=D8seUoC1RZUs7918Atcc7TbFwRf1khqFvPdjkB4qktbn BURNTICKER_FEE_WALLET=3s97xfWwH5qwPjqrmjHwPobZ3Z6oxWMQm2CDVQoA5pZp \
  BURNTICKER_CREATOR_LAUNCHES_ENABLED=1 BURNTICKER_ALLOW_HOSTED_METADATA=1 BURNTICKER_END_SINKS_LIVE=1 BURNTICKER_LOOKUP_TABLE=<devnet table, or any address for --chain stub> \
  BURNTICKER_DB=~/bt-devnet/registry.db BURNTICKER_PUBLISH_DIR=~/bt-devnet/site BURNTICKER_MINT_BANK_PATH=~/bt-devnet/empty-bank.db BURNTICKER_PUBLIC_ORIGIN=http://127.0.0.1:3417 \
  ./node_modules/.bin/next start -H 127.0.0.1 -p 3417
# from the monorepo:
BURNTICKER_SYNTH_DB=~/bt-devnet/registry.db node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/alias-hook.mjs \
  scripts/burnticker-synthetic-creator.mts --base http://127.0.0.1:3417 --chain stub
```

### On the box: devnet beside mainnet

`mct-burnticker-synth.timer` (09:30 UTC = 03:30 Denver in daylight time) fires `mct-burnticker-synth.service`, which runs
`scripts/service/run-burnticker-synth.sh`: a second `next start` of the SAME shipped build on 127.0.0.1:3100 with
`BURNTICKER_CLUSTER=devnet` and its own `data/devnet-synth/` (registry, publish dir, an empty bank), the creator against it, then stop.
The cluster is read per request, so one build serves both. The one baked value is the wallet RPC (`NEXT_PUBLIC_BURNTICKER_RPC_URL`, the
mainnet proxy): the creator answers every browser call to it from the devnet RPC, so nothing touches mainnet. Caddy does not route to
3100. It sets `BURNTICKER_DEVNET_WRITE_BURST=60` (the write bucket is 10 an hour per client; ignored on mainnet). The devnet instance reads only `devnet-synth.env` (public ids, the devnet table, `BURNTICKER_SYNTH_KEYPAIR`, `BURNTICKER_SYNTH_CHAIN`),
never the live host's env file. The unit is capped at 1.5 GB and 45 minutes. Enable it once `devnet-synth.env` and Chrome are in place:
`systemctl --user enable --now mct-burnticker-synth.timer`.

## 2. The deploy smoke (`scripts/ops/burnticker-deploy-smoke.sh`)

`publish-and-deploy.sh` runs it after the deploy, through `https://burnticker.com` (Cloudflare and Caddy): the launch page (200, not the
fallback), `/api/burnticker/build`, a launch review for an open Polymarket market (under 20 s), `POST /api/burnticker/launch` with
`dryRun: true` (under 60 s; it runs the preflight, the pin budget and the uploader check and registers, uploads and takes nothing), and the
pin check of the newest live coin. A failure prints its sentence and stops the publish with "The deploy already happened". Private ops.
