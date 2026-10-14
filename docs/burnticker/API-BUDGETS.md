# API budgets

The owner asked on 2026-10-13: "make sure we never exceed our API limits for any keeper." This page lists every outside service
the two keepers and the web server call, the limit each provider documents, where the code calls it, how many calls a cycle makes,
and the budget the code enforces. The code is `src/lib/burnticker/apiBudget.ts`. The table there (`SOURCES`) and this page must
agree. `test/burntickerApiBudget.test.ts` fails if a source in the code is missing here.

## How the budget works

- **60% of each documented limit, shared.** A process may use 60% of a provider's limit times its share. The shares for one
  provider add up to 1 or less, so the platform keeper (`keeper`), the $DEFICIT keeper (`deficit`) and the site (`web`) together
  stay at or under 60%. The default split is keeper 0.5, web 0.3, deficit 0.2. Some providers have their own split (see the table).
- **Rate buckets** for per-second, per-minute and per-hour limits. An empty bucket waits. It does not fail. If the wait would be
  longer than 20 seconds, the call answers "busy" and that read is skipped until the next cycle. A bucket never holds more than
  10 seconds of its rate, so a quiet spell cannot build up into a burst.
- **A day budget** per UTC day. A monthly limit counts as 30 days, and rate limits cap the day too. The count is kept in the
  `status` table: the registry for the platform keeper and the site, the ledger for the $DEFICIT keeper. Keys are
  `apiBudget.day.<role>.<source>`. Each add is a single atomic upsert, so a restart keeps the count and two processes never lose
  one. Counts are written every 20 units or 5 seconds, at the end of every cycle, and on exit.
- **Hold.** When the day budget is spent, `take` answers `hold` at once. No request goes out and nothing waits. The read fails the
  way a network error would, and the keeper's normal error path skips it. No call site retries in a tight loop: the RPC wrapper
  `jsonRpc` throws before its retry loop, and the other clients have no retry. The hold is logged once per source per day. A
  marker (`apiBudget.hold.<role>.<source>`) keeps a restart from logging it again. Reads start again on their own at 00:00 UTC.
- **Essential calls pass a hold:** `sendTransaction`, `getSignatureStatuses` and `getBlockHeight`. These finish a send that is
  already in flight, so a hold never leaves a transaction half done. They are still counted, and they still wait for the rate
  bucket. Every read that would start a new send is held.
- **Alert.** A `bt-api-budget` alert goes out when a source passes 80% of its day budget, and again when it goes on hold. It is
  recorded with `registry.recordAlert` (deduplicated per key per Denver day) and pushed to the phone as push kind `api-budget`
  (`push.ts`, at most once an hour). The $DEFICIT keeper writes its alert into the platform registry when that file is on its host.
  It never creates the file.
- **Status.** The keeper logs one line per source on every ops check and adds the same lines to `ops.json`, for example
  `api budget helius: 4,210 / 120,000 credits today (3%) · ok`. The $DEFICIT keeper logs them after every cycle.
- **Passive mode.** A process that never calls `configureApiBudget` (tests, one-off scripts, a browser tab) only counts. It never
  waits or holds. The exception is a server running with `NODE_ENV=production`, which enforces with an in-memory count. The two
  keepers configure the budget at start. The site configures it in `platform()`, and the RPC proxy and burn-target routes call
  `ensureWebApiBudget()` before they read.

## The table

"Budget/day" is the keeper's figure, or another role's where the keeper does not call the source. Each figure is the documented
limit × 0.6 × the role's share. "Calls per cycle" is counted from the code paths. It is an estimate, not a measurement: from the
first day after deploy, the status lines measure it.

| id | provider | documented limit (source, read 2026-10-13) | where the code calls it | calls per cycle today (estimate) | budget (keeper unless noted) |
|---|---|---|---|---|---|
| `helius` | Helius RPC, Developer plan, one plan with two keys (keeper and site; OPS-EDGE.md). Env `BURNTICKER_RPC_URL`, `BURNKEEPER_RPC_URL`, the proxy `/api/burnticker/rpc` | 10,000,000 credits/month, RPC 50/s, getProgramAccounts 25/s, DAS 10/s. Credits: a standard, archival or send call costs 1; getProgramAccounts and DAS cost 10 (helius.dev/pricing, helius.dev/docs/billing/credits, /rate-limits) | Keeper: `scripts/burnticker-keeper.mts` Connections (program client, market reader); `alerts.ts` rpcBalanceLamports; `lockFeesChain.ts`, `programClient.ts`, `market.ts` through those Connections. $DEFICIT keeper: `scripts/burn-keeper.mts` Connection. Site: `server.ts` Connections (program, LaunchLab, market, launch verifier), `rpc/route.ts` (browser proxy), `burn-target/route.ts`, `trustpack/receiptCheck.ts` jsonRpc (mintRegistration, currentStatus, trust pack), `sources/copycats.ts` (DAS searchAssets) | Platform keeper, each 60 s cycle, per live coin: about 10 to 14 reads in `publishAll` (getTokenSupply ×2, the fee PDA's getBalance, the TokenConfig, the lock-fee pool lookup 2 to 4, market reads 3 per 30 s cache, pair coins 2 to 3 more). Each crank adds about 10 to 20 (blockhash, simulate, send, then a confirm poll of 2 a second for up to 120 s). The ops check every 5 min adds 2 getBalance. That is about 17,000 credits per live coin per day. $DEFICIT keeper: about 5 to 8 per cycle (at most one cycle every 15 min), plus a send path per burn. Site: 1 per proxied browser call, plus page reads (market cached 30 s) | keeper 0.6 share: **120,000 credits/day, 18 req/s**. web 0.3: 60,000/day, 9/s. deficit 0.1: 20,000/day, 3/s. **The keeper's day budget covers about 7 live coins at today's publish cadence.** See Findings. |
| `helius-send` | Helius sendTransaction | 5/s on the Developer plan (helius.dev/docs/billing/rate-limits) | Every Helius body containing `sendTransaction` (`takeRpc`) | 1 per crank, claim or registration | keeper 1.8/s, web 0.9/s, deficit 0.3/s (essential: never held) |
| `solana-public` | Solana public RPC (`api.mainnet-beta`, `api.devnet`) | 100 requests per 10 s per IP; 40 per 10 s per IP for one method (solana.com/docs/references/clusters). The tighter method limit is taken: 4/s | The derby's pool reads when `BURNTICKER_DERBY_RPC_URL` is unset (keeper and `server.ts`); the $DEFICIT keeper's `--devnet` default; the catalogue's one on-chain source (`sources/onchain.ts`); the trust pack's devnet sample | Per derby sample: about 2 to 4 reads per pool | keeper 1.2/s (103,680/day by the rate) |
| `thesportsdb` | TheSportsDB v1/v2 (licensed key `BURNTICKER_THESPORTSDB_KEY`) | Premium 100/min; Business 120/min; Free 30/min (thesportsdb.com/pricing). The repo does not say which plan was bought (OPS-EDGE.md says "about $9 (check)"), so Premium's 100/min is used | `sources/espn.ts` EspnClient.get / tsdbRead; `sources/gameSettle.ts` through EspnClient | 1 to 3 GETs per team coin per hourly poll (cached 10 min); 1 per schedule read on the site | keeper 0.6: 36/min (51,840/day by the rate); web 0.4: 24/min |
| `mlb-stats` | MLB Stats API | No published limit; house default | `espn.ts` EspnClient.get | 1 to 2 per MLB coin per hourly poll | keeper 0.6: 0.18/s, 3.6/min, 720/day |
| `nhl-api` | NHL api-web.nhle.com | No published limit; house default | `espn.ts` EspnClient.get | 1 to 2 per NHL coin per hourly poll | as `mlb-stats` |
| `nba-cdn` | NBA cdn.nba.com | No published limit; house default (the feed answers 403 today, `NBA_OFFICIAL_ANSWERS` false) | `espn.ts` EspnClient.get | 0 while it answers 403 | as `mlb-stats` |
| `espn` | ESPN site endpoints (the soccer scoreboard cross-read) | No published limit; house default | `gameSettle.ts` through EspnClient.get | 1 per soccer settlement read | as `mlb-stats` |
| `polymarket-gamma` | Polymarket Gamma | 300 per 10 s on /markets (the tightest endpoint the code reads), 500 on /events, 4,000 general, per IP (docs.polymarket.com/quickstart/introduction/rate-limits). 30/s used | `oracle/polymarket.ts` PolymarketClient.get (the keeper and the site); `verify.ts` | 1 to 3 per Polymarket selector per 5 min poll (cached 10 min); seriesInfo for display 1 per coin per 10 min when discovery is on | keeper 0.6: 10.8/s; web 0.4: 7.2/s |
| `polygon-rpc` | Polygon public RPCs (`polygon-bor.publicnode.com`, `1rpc.io/matic`, `polygon-rpc.com`, `polygon-bor-rpc.publicnode.com`, `polygon.drpc.org`; `BURNTICKER_POLYGON_RPC_URLS`) | None published by polygon-rpc.com or publicnode. 1rpc says 1,000/day (its pages conflict: 1,000 or 20,000). dRPC's free-tier figures come from search snippets only. House default used | `burnKeeper/attesters/polymarketOnchain.ts` rpc() (the payout vector, read by `polymarket.ts` and `verify.ts`) | 3 eth_call + 1 eth_blockNumber per condition read; one read per due game or market settlement | keeper 0.6: 720/day, under 1rpc's 1,000/day even if every call went there |
| `kalshi` | Kalshi API | Basic tier 200 read tokens/s at 10 tokens per request, so 20 reads/s (docs.kalshi.com/getting_started/rate_limits) | `oracle/kalshi.ts` KalshiClient.get; `verify.ts` | 0 while `BURNTICKER_KALSHI_ENABLED` is off (the default); else 1 to 3 per series per 5 min | keeper 0.6: 7.2/s |
| `pyth-hermes` | Pyth Hermes (`BURNTICKER_PYTH_API_KEY`) | Docs conflict: 10 per 10 s per IP (newer page) or 30 per 10 s (Benchmarks page). Hermes now requires a key, and no keyed rate is published. 1/s used | `derby/pyth.ts` HermesClient | 1 per derby sample per coin | keeper 0.6: 0.36/s |
| `irys` | Irys uploads | No published limit (docs.irys.xyz says uploads under 100 KiB are free). House default; there is also the existing `BURNTICKER_PIN_DAILY_CAP` | `pin.ts` IrysUploader.upload (the daily snapshot on the keeper, launch pins on the site) | Keeper: 1 to 2 a day. Site: 2 to 3 per launch | keeper 0.5: 600/day; web 0.5: 600/day |
| `fiscal-data` | Treasury Fiscal Data API | No published limit; the docs list no 429 (fiscaldata.treasury.gov/api-documentation). House default | `burnKeeper/feeds/treasury.ts` getJson ($DEFICIT); `sources/attestedHttp.ts` (catalogue feed) | $DEFICIT: 2 polls a day × 1 to 2 GETs, plus history pages after a gap. Catalogue: 1 per poll | deficit 0.5: 600/day, 0.15/s; keeper 0.3: 360/day |
| `fred` | FRED | 120 requests/min (fred.stlouisfed.org/docs/api/fred/errors.html). The catalogue reads `fred.stlouisfed.org/graph/fredgraph.csv`, which is the same host but not the keyed API; the API's figure is used | `sources/attestedHttp.ts` | 1 per FRED selector per poll | keeper 0.5: 36/min |
| `nws` | NWS api.weather.gov | "not public information" (weather.gov/documentation/services-web-api). House default | `sources/nws.ts` NwsClient | 1 to 2 per weather coin per poll | keeper 0.5: 600/day |
| `iem` | Iowa Environmental Mesonet | No published limit. House default | `sources/nws.ts` NwsClient (the climate cross-read) | 1 per weather settlement | keeper 0.5: 600/day |
| `fec` | FEC API (api.data.gov key) | 1,000/hour for a registered key (api.data.gov/docs/developer-manual) | `sources/fec.ts` FecClient | 1 to 3 per FEC coin per poll | keeper 0.5: 300/hour |
| `jupiter` | Jupiter (`lite-api.jup.ag`, keyless) | Keyless 0.5/s, which is 30/min (developers.jup.ag/docs/api-rate-limit; the page does not name lite-api) | `burnKeeper/jupiterSwap.ts` (usdPrice on each program crank and on the site's program client; the legacy swap); `derby/search.ts`, `derby/post.ts` | 1 per crank (SOL price) | keeper 0.5: 9/min |
| `dexscreener` | DexScreener API | 60/min on the endpoints that state a limit. The search, pairs and tokens endpoints the code reads state none, so 60/min is used (docs.dexscreener.com/api/reference) | `derby/search.ts`, `ops/cloneWatch.ts`, `sources/copycats.ts` | Clone watch: 1 per term per run. Derby: 1 per lookup | keeper 0.5: 18/min |
| `geckoterminal` | GeckoTerminal public API | Conflicting: 30/min (CoinGecko support) or 10/min (geckoterminal.com/dex-api). 10/min used | `sources/copycats.ts` (fallback indexer) | Only when DexScreener fails | keeper 0.5: 3/min |
| `redstone` | RedStone gateway | No published limit. House default | `derby/search.ts`, `derby/adapter.ts`, `coverage/preflight.ts` | 1 per derby cross-read (cached) | keeper 0.5: 600/day |
| `bls` | BLS API | 500/day for a registered key, 25/day without one (BLS's own page; not re-read in this pass) | `sources/attestedHttp.ts` | 1 per BLS selector per poll | keeper 0.5: 150/day |
| `launch-library` | Launch Library 2 | 15/hour unauthenticated (thespacedevs.com/llapi) | `sources/attestedHttp.ts` | 1 per launch coin per poll | keeper 0.5: 4.5/hour |
| `github` | GitHub REST API | 60/hour unauthenticated (GitHub's docs; not re-read in this pass) | `sources/attestedHttp.ts` | 1 per GitHub selector per poll | keeper 0.5: 18/hour |
| `reclaim` | Reclaim attestor list | No published limit. House default | `burnKeeper/attesters/zktls.ts` | Only when the list is refreshed by hand | 600/day |
| `other-http` | Every other catalogue host (USGS, NOAA NHC and SPC, Federal Register, EIA, Census, BEA, USDA, SEC EDGAR, openFDA, Steam, DefiLlama, mempool.space, Blockstream, CoinGecko, Billboard, Spotify, Box Office Mojo, Wikimedia, ArcGIS, ultrasound.money, NASA JPL, NOAA SWPC, Congress) | Not individually established. House default, counted per host as `http:<host>` | `sources/attestedHttp.ts`, `verify.ts`, `trustpack/api.ts` (by host) | 1 per selector per poll (most poll hourly or slower) | keeper 0.5 per host: 600/day, 0.15/s, 3/min |

The house default for a provider that publishes no limit is one request every 2 seconds, 10 a minute and 2,000 a day. The 60%
and the share apply on top of that.

Not budgeted, because they are our own endpoints and not a provider's API: the alert webhook (`alerts.ts` postAlert, our own
intake route); the phone push channel (`push.ts`, already capped at 6 an hour); the standby keeper's heartbeat read of the
leader's status (`ops/leaderLock.ts`); the remote `ops.json` read (`checkin.ts`); the second signer (`attesters/cosign.ts`, our
own host). A browser tab's own reads (`catalogueClient.ts`, `watchlist.ts`, the receipt checker with an RPC the visitor picks) are
passive: they count and never hold.

## Limits not established

These fall back to the house default (`established: false` in the code):

- MLB Stats API, the NHL web API, the NBA data feed and ESPN: none of them publishes a limit or public API docs.
- The Polygon public RPCs: no published limit from polygon-rpc.com or publicnode. 1rpc's pages conflict. dRPC's figures come
  from search snippets only.
- Irys, Treasury Fiscal Data, NWS (it states its limit is not public), the Iowa Environmental Mesonet, RedStone and Reclaim.
- Every other catalogue host listed under `other-http`.
- TheSportsDB's plan: the limit is published per plan, but the repo does not record which plan the key is on. Premium's 100/min
  is assumed. If the key is on the free plan (30/min), the keeper's 36/min would be over. Confirm the plan.
- Pyth Hermes: the published per-IP figures conflict (10 or 30 per 10 s), and no keyed rate is published. The lower one is used.
- BLS and GitHub: these figures were not re-read from the providers' pages in this pass.

## Findings

- **Helius is the binding budget.** The keeper's publish loop reads each live coin's chain state every minute, about 17,000
  credits per coin per day. At 120,000 credits a day (60% of the plan × the keeper's 0.6 share) the keeper goes on hold at about
  7 live coins. With more coins than that, the budget holds the keeper's RPC reads late in the UTC day, and pages and cranks stop
  until midnight UTC. Before that happens, either slow the publish loop's chain reads (cache supply, the fee PDA and the TokenConfig
  for 5 minutes) or move to a larger plan. The `api budget helius` status line shows the real figure from day one.
- The confirm loops poll `getSignatureStatuses` and `getBlockHeight` once a second for up to 120 s per send. They are essential,
  so they pass a hold, but they still count.
