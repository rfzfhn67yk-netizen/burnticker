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
| a-team | Team, the league, a team, the burn step (each win), the name step: one team coin launches. |
| a-rivalry-game | Rivalry, Two teams, the league, two teams that meet in a listed game at least three hours away, that game: a linked pair (two coins, two addresses, four signing steps on a real chain). |
| a-rivalry-series | The same two teams, "Every game between them this season": a linked series pair. Skipped with the page's reason when the series is not offered for them. |
| a-coin-vs-coin | Not driven yet. |
| a-published | A national-debt (published data) coin launches. |
| b-double-press | Two quick presses send one launch request, and the wallet is asked at most once per step (a single coin is two steps: its rule locked, then the coin created). |
| b-reject-retry | The wallet refuses, the card says the step was not signed, nothing is sent; the second press reuses the plan and draft (no "already registered"). |
| b-reload-relaunch | The wallet refuses, the tab reloads on the kept review (`?resume=review`), and Launch works again with no "already registered". |
| b-reload-expired | The same, but the kept signature is aged past its 15-minute limit before the reload (its Issued line moved back 20 minutes). The review shows the draft-held notice saying the signature no longer counts, Launch stays on, and a signed press launches (LA-4). |
| b-reload-pair, b-pair-twice | Not driven yet (the pair form is driven by a-rivalry-game; these need a pair landed on chain, or launched twice). |
| c-deploy-window | With `/deploying.json` served and Caddy's JSON 503 on the launch route, the review says the site is being updated, never "catching up". |
| d-mint-source | An empty bank falls back to the browser search (address ends in burn, the page sends its own public key); a bank hands its key with no search panel. With `--empty-base` (the box) it runs on the instance with no bank and must see the search; otherwise `BURNTICKER_SYNTH_EXPECT_BANK=empty|filled` asserts which. |
| e-slow | A wallet slower than the stale line: no send ever carries an expired blockhash; an expired one is rebuilt and asked again. |
| e-tamper | Refused before the send with "was not sent because the wallet changed the transaction…". |

`--chain real` (default) needs devnet SOL (it asks the faucet for 2 SOL and stops if refused) and a devnet lookup table pinned on the
host. `--chain stub` intercepts the browser's RPC: the pinned table is answered with the expected entries, the page's dry run with "ok",
and the send is refused on purpose. Everything up to the network is real, and every sent transaction is checked (each signature verifies,
the blockhash is valid at the send, the Lighthouse instructions are still there). Stub mode does not check that the coin goes live. Since
2026-10-15 a single coin is two steps, so in stub mode the checked send is step 1, the one that locks in the rule.

The team and rivalry kinds take their teams from the page's own list (`GET /api/burnticker/v1/sports/teams`) for the first league in
`BURNTICKER_SYNTH_LEAGUES` (default `nhl,mlb,nba,nfl`) that has what they need. NHL and MLB come from the leagues' free official feeds,
so no key is needed in their seasons; NBA and NFL need the host's `BURNTICKER_THESPORTSDB_KEY`. The pick rotates by day. The host's
request budget lets the web read the NHL and MLB feeds only a few times a minute (`apiBudget.ts`), so a launch can be refused with "the
schedule for … could not be read just now. Please try again in a few minutes.", and the rivalry step can show "could not be read" with
Retry. The creator does what a creator would: it waits 90 s and presses Launch again (twice at most), or waits 30 s and presses Retry
(three times at most), and says so in the report.

**The Launch wait.** Before the scenarios the run times the page's address search in this browser for 8 s (the same WebCrypto loop, on
the page's worker count) and sizes every Launch wait from it: 60 s plus the 95th percentile of the search (3.0 mean search times for one
address, 4.74 for a pair's two), at least 300 s and at most 900 s. The report's head line says the rate and both waits. Measured on
the Mac (2026-10-15): about 190,000 keys a second on 9 workers, about 30 s an address, so the 300 s floor. On the box the
2026-10-15 run's one finished search (d-mint-source) took 161 s and five others ran past 300 s, so expect one address near 600 s
and a pair at the 900 s ceiling.
`BURNTICKER_SYNTH_MINT_SEARCH_MS` fixes the wait instead (still between 300 s and 900 s). A launch request still unanswered when the
wait runs out gets 120 s more, once (the page's search is done; the host is building the launch). When a wait runs out, the failure says what
the page was doing: hunting for an address (with the tries so far), waiting for the launch service to answer (the bank), or waiting for
the wallet; never the page's text.

Every mint it makes is appended to `logs/synthetic-creator.jsonl`, and with `BURNTICKER_SYNTH_DB` it is flagged
`token_flags.synthetic = 1`, which hides it from every browse surface like a test coin (`testCoins.ts`), without listing it on
`/burnticker/test-coins`. Any failure records one `bt-synthetic-failed` alert per run and pushes it (`push.ts`).

Install once (outside the repository): `mkdir -p ~/.cache/burnticker-synth && cd ~/.cache/burnticker-synth && npm i playwright-core@1.48.2`,
then on Linux `timeout 900 npx playwright-core install --with-deps chromium` (as the service user, never from a root shell: the browser
lands in that user's `~/.cache/ms-playwright`). On the Mac the installed Google Chrome is used. The time limit matters: an install that
hangs holds `~/.cache/ms-playwright/__dirlock` (audit 2026-10-16 F-32, 15 hours); the nightly run removes a lock over an hour old when
no installer is running (`scripts/service/playwright-dirlock.sh`).

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
`BURNTICKER_CLUSTER=devnet` and its own `data/devnet-synth/` (registry, publish dir, its devnet mint bank; below), a second one on
127.0.0.1:3101 with no bank for d-mint-source, the creator against them, then stop.
The cluster is read per request, so one build serves both. The one baked value is the wallet RPC (`NEXT_PUBLIC_BURNTICKER_RPC_URL`, the
mainnet proxy): the creator answers every browser call to it from the devnet RPC, so nothing touches mainnet. Caddy does not route to
3100 or 3101. It sets `BURNTICKER_DEVNET_WRITE_BURST=60` (the write bucket is 10 an hour per client; ignored on mainnet). The devnet instance reads only `devnet-synth.env` (public ids, the devnet table, `BURNTICKER_SYNTH_KEYPAIR`, `BURNTICKER_SYNTH_CHAIN`),
never the live host's env file. The unit is capped at 2 GB and an hour. Enable it once `devnet-synth.env` and Chrome are in place:
`systemctl --user enable --now mct-burnticker-synth.timer`.

### The devnet mint bank (2026-10-15)

On the box the browser's burn-address search takes three to four minutes, so with an empty bank every launch waited that long, and on
2026-10-15 five scenarios ran out of their 300 s wait. Mainnet launches take a prepared key from the live bank (`mct-burnticker-mintbank`,
300 keys); the devnet instance now has a small bank of its own:

- **Its own file and key.** `data/devnet-synth/bank.db`, sealed with `BURNTICKER_SYNTH_BANK_KEY` from `devnet-synth.env`. Never the live
  bank's file (`data/burnticker-mintbank.db`) or its key: the service script refuses to run when the two keys are the same. A mint key is
  just a keypair, the same on devnet and mainnet, so keeping the two banks apart is what stops a devnet test from spending a key the live
  site could hand out.
- **Filled on one worker.** The live bank grinds on three of the box's four cores (about 69,000 keys a second, so about 23,000 a worker).
  The devnet bank uses one worker at nice 19: about 246 s a key, so 12 keys take about 50 minutes (35 to 65 typically; the search is
  luck). A night's run draws about 14 (one per single coin, two per pair; c-deploy-window none; d-mint-source none, it runs on the
  empty-bank instance).
- **When.** `mct-burnticker-synthbank.timer` (06:00 UTC) fills it to `BURNTICKER_SYNTH_BANK_SIZE` (default 12) and exits, two hours at
  most. At 09:30 the synthetic creator's run tops it up again for at most `BURNTICKER_SYNTH_BANK_FILL_S` seconds (default 300), then
  holds it at size on the same one worker while the scenarios take keys, and stops the grinder when the run ends. A bank that runs dry is
  not a failure: the page searches in the browser and the measured wait covers it.
- **Two instances.** The bank instance on 127.0.0.1:3100 serves every scenario but d-mint-source, which runs on a second instance of the
  same build on 127.0.0.1:3101 (`BURNTICKER_SYNTH_EMPTY_PORT`) with no bank key: the one scenario that proves the page's fallback.
  Both share the devnet registry. The unit's limits are now an hour and 2 GB (two web instances, Chrome and the grinder).
- **What a pair does when the bank has one key left.** The launch route takes both of a pair's keys in one request, or none
  (`MintBank.take`): with one key ready it answers `mint-bank-empty`, the key stays in the bank, and the page searches for both
  addresses in the browser. There is no second request that could find the bank emptied halfway. The report's line for a pair says which
  happened.

**Setup on the box, once** (as `mct`, in `~/meme-coin-trader`, after the deploy that brings this change and
`sh scripts/ops/install-burnticker-units.sh`). The owner makes the key; it is written straight into the file and never printed:

```sh
umask 077
printf 'BURNTICKER_SYNTH_BANK_KEY=%s\n' "$(node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("base64"))')" >> devnet-synth.env
chmod 600 devnet-synth.env
sh scripts/service/run-burnticker-synth.sh --bank-status     # {"ready":0,…}: the key opens a new, empty bank
systemctl --user start mct-burnticker-synthbank.service       # the first fill, about 50 minutes, in the background (logs/burnticker-synth-bank.log)
systemctl --user enable --now mct-burnticker-synthbank.timer  # the nightly top-up at 06:00 UTC
```

A real wallet on devnet: `sh scripts/service/run-burnticker-synth.sh --serve` starts only the devnet instance on 127.0.0.1:3100 (same
blanked environment, the devnet bank when there is one) and holds it until stopped. It is loopback only; from another machine open an
ssh tunnel (`ssh -N -L 3100:127.0.0.1:3100 <host>`) and browse http://localhost:3100/burnticker/launch with the wallet set to devnet.

Optional lines in `devnet-synth.env`: `BURNTICKER_SYNTH_BANK_SIZE` (default 12), `BURNTICKER_SYNTH_BANK_FILL_S` (default 300),
`BURNTICKER_SYNTH_EMPTY_PORT` (default 3101). Without `BURNTICKER_SYNTH_BANK_KEY` the run is as before: one instance, every launch
searches in the browser.

## 2. The deploy smoke (`scripts/ops/burnticker-deploy-smoke.sh`)

`publish-and-deploy.sh` runs it after the deploy, through `https://burnticker.com` (Cloudflare and Caddy): the launch page (200, not the
fallback), `/api/burnticker/build`, a launch review for an open Polymarket market (under 20 s), `POST /api/burnticker/launch` with
`dryRun: true` (under 60 s; it runs the preflight, the pin budget and the uploader check and registers, uploads and takes nothing), and the
pin check of the newest live coin. A failure prints its sentence and stops the publish with "The deploy already happened". Private ops.
