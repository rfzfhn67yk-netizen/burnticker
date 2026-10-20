# Burnticker public HTTP API (v1)

Base: `https://<host>/api/burnticker/v1`. The machine-readable contract is `GET /openapi.json` (OpenAPI 3.1). It is generated from
`src/lib/burnticker/api/spec.ts`, the same table the routes read their cache and rate-limit settings from, and the route tests
validate every response against it. TypeScript bots can use the SDK ([sdk.md](sdk.md)), which wraps every endpoint and adds local
verification, the crank, and events.

**Public data and unsigned transactions only.** There are no keys, accounts, cookies or signing. Nothing here can change a rule,
claim a fee, or adopt an existing token.

## 1. Quickstart (curl)

```bash
API=https://<host>/api/burnticker/v1
curl -s "$API/kalshi/search?q=broncos"                                   # find a series
curl -s -X POST "$API/rules/validate" -H 'content-type: application/json' -H "origin: https://<host>" \
  -d '{"rule":{"schema":"burnticker.rules/v1","oracle":"kalshi","series":"KXNFLGAME","market":null,"filter":{"tickerIncludes":"-DEN"},"kind":"binary","binary":{"onYes":{"fractionOfPool":0.02},"onNo":null},"scalar":null,"onVoid":"skip","floorUsd":"1","reserveSol":"0.02","vault":null}}'
curl -s "$API/polymarket/search?q=eagles" | jq '.events[0].markets[0]'    # a Polymarket binary market (YES = first outcome)
curl -s "$API/tokens/BRONCO" | jq '.status.next'                          # next possible burn + implied chance (display only)
curl -s "$API/tokens/BRONCO/verify/KXNFLGAME-26SEP27LARDEN-DEN" | jq '.verified, .checks'
```

## 2. Endpoints

**Kalshi is one venue behind a switch** (2026-10-10, `src/lib/burnticker/venues.ts`): with `BURNTICKER_KALSHI_ENABLED=0` every `/kalshi/*` route, a back-test of an `oracle: "kalshi"` rule and a launch bundle for one answer **503 venue unavailable**; `/browse` and `/catalogue` keep working with first-party feeds and Polymarket. Default: on.

| Method | Path | Cache | Bucket | What |
|---|---|---|---|---|
| GET | `/catalogue` | 300 s | read | every source with kind + tier, launchability, last fixture reading, preview, and the public selection config (header *values* withheld) |
| GET | `/sources/{id}/preview?fractionOfPool=&tokens=` | 300 s | read | what a catalogue rule would have burned over the source's frozen fixture |
| GET | `/kalshi/search?q=&category=` · `?series=` | 60 s | heavy | live Kalshi series search with refuse-list verdicts, plus event-level hits (`events`, `ranking`: events first when the query names a team or a market); one series with its open markets (prices display only) |
| GET | `/kalshi/events?q=&series=&status=` | 60 s | heavy | event-level search — games, contests, people: event title / ticker / market labels, with a team-alias table (eagles / philadelphia / PHI; jaguars / jacksonville / JAC / JAX); `?series=` alone lists its upcoming events; no parameters → the league chooser. Two-team games carry both sides and both selector modes (this game only = one market, side B inverted; every game = each side's own-leg filter). Events cached 10 min per series |
| GET | `/search?q=` | 60 s | heavy | the universal search (API 1.4.0): describe the event → ready-made rules from every enabled source — teams in every league and their next game, NWS stations ("Detroit high above 90"), first-party feeds, Polymarket election races and markets (named outcomes only), Kalshi only when enabled, the Coin vs Coin tile; each card carries the complete rule, the venue, who settles it, when, and how; no prices, odds, volume or liquidity. Since 10-10 a card is a ready rule: `shape` (recurring / one-shot / pair), `crossRead`, `nextAt`, `endAt` / `endText`, `badge` (2026 SEASON / PERPETUAL / ONE-SHOT · date), `text` (the generated name, ticker, one-liner, window sentence and paragraph), `descCtx`, `windows` (a team card's four windows, this season first), `seasonYear`, `leagueSet`, `matchup` (both sides of the next game), `note` (why a card cannot offer its rule); suggested tickers are unique against the registry and the refuse list |
| GET | `/elections?type=&state=` · `/elections/pair?slug=&a=&b=` | 300 s | heavy | Elections & Politics: race type → state → race → named outcomes (unnamed placeholders hidden), each with a ready one-shot rule settled on the on-chain payout and the state's certified-results publisher as the cross-read; the election-pair template (FEC beats + winner per side; pending gates listed). 503 with Polymarket discovery off |
| GET | `/sports/teams?league=&q=` · `/sports/games?league=&q=` | 300 s | heavy | the team and game pickers (schedules from MLB StatsAPI, the NHL feed and the NBA feed, else TheSportsDB with its licensed key — `scheduleNote` says "schedule needs the licensed key" without it; no ESPN reads): a league's teams with next game, record and `espn.team:` selectors; upcoming games with each side's one-game `espn.game:` loss selector (a matchup = two coins) |
| GET | `/sports/rivalry?league=&a=&b=` | 300 s | heavy | the rivalry series picker: every game between two teams this season, regular season and postseason, from the league's own schedule (MLB StatsAPI, the NHL feed, the NBA feed) or TheSportsDB with its licensed key (no ESPN reads), each with its status and result from team `a`'s side, the head-to-head count so far, and the pair's two `espn.team:<league>-<ABBR>.<id>-win-m<season>.<OPP>.<id>` series ids (one per team; the `espn.` prefix only pins the team ids); `offered` is false when no game between them is listed |
| GET | `/browse` · `?category=&q=` | 300 s | heavy | browse every source by Burnticker category (`config/burnticker/categories.json`: sports, politics, economics, financials, weather, science, culture, crypto, companies, health, world): one `SourceCard` per source — first-party feeds first, then the Polymarket tag's open events, then Kalshi series while `BURNTICKER_KALSHI_ENABLED` is on — with venue + tier, cadence, next event (or last reading), the "burns when …" `example`, launchability, refuse-list verdict and the `pick` (selector) to use; `venues` says what this host serves |
| GET | `/kalshi/categories` · `?category=&tag=&q=&limit=&offset=&events=&polymarket=` | 300 s | heavy | browse like Kalshi (API 1.2.0): no parameters → Kalshi's categories exactly as its API reports them (`/search/tags_by_categories`), each with its tags, series count and the Polymarket tag it maps to; `?category=` → that category's series, most traded first (volume orders, never shown, never a rule input), each with `kindHint` (yes/no or a settled number), a one-line `example`, the refuse-list verdict and — for the first `events` (≤ 24) — the upcoming-event summary (open count, next event + close, `ladder`); plus the matching Polymarket tag's open events (`polymarket: 0` skips). Drill down with `/kalshi/events?series=` |
| — | rules since 1.4.0 | — | — | a rule sent without `onEnd` gets `{ windDownDays: 28, sweepThresholdLamports: 50000000 }` (no burn pool is ever left behind — the hash in the response covers it; `@burnticker/sdk` adds the same default); a one-shot mapping may be `fractionOfPool` ≤ 1.00; `set: { id, outcome, forwardBps }` is the opt-in outcome-set field |
| GET | `/derby` | 30 s | read | Burn Derby (API 1.4.0; docs/burnticker/DERBY.md): every bracket and coin-vs-coin pair from the registry — score, season, page links |
| GET | `/derby/{id}` | 30 s | read | a bracket (rounds, matches with day strips, who advanced and why, retired fan coins, the champion) or a derby pair's block (score as a receipt tally, the day strip with both readings and proof links, the season end, the latest day post) |
| GET | `/derby/search?q=&assets=` | 60 s | heavy | coins for a derby: Pyth's catalogue (crypto; `assets=all` adds equities/funds, FX, metals, commodities; US index proxies only behind `BURNTICKER_INDEX_PROXIES_ENABLED`) + Jupiter's token list, each hit with the underlying a rule locks (feed, mint, cross-read) or why it cannot be used |
| POST | `/derby/high` | — | heavy | a coin's record daily close (1.15.0, sources-4): body `{ u, span }` (a `/derby/search` underlying with a Pyth feed; `span` all, 30 or 90) → `today` (UTC), the `baseline` to lock into a `selector: "high"` derby block whose season starts today, and the review's current-high `line`; or `refusal` `{ code, reason }` with code no-readings or already-decided (already at its record: no coin is offered). Each close is Pyth's value at a 00:00 UTC boundary (Hermes needs the host's key) |
| GET | `/coverage` | 600 s | read | the settlement-coverage matrix (API 1.3.0; `src/lib/burnticker/coverage`): per Burnticker category and selector kind, the primary sources, their independent cross-reads (the same `fact` from another operator on another domain), each one's 90-day dry run (expected vs produced readings, median latency, disagreement) and the verdict `settleable` / `adjudicated-only` (Polymarket) / `uncovered`; offline from the frozen fixtures, cached; `docs/burnticker/SETTLEMENT-COVERAGE.md` is rendered from the same object. Kalshi is never an input |
| GET | `/kalshi/teams?series=` | 60 s | heavy | the team picker for a game series (team coins): every team, its next game, its record since the season started, its own-leg filter (`-PHI`) |
| POST | `/kalshi/backtest` `{ rule, months? }` | — | heavy | the back-test on the venue's own settled history, the matched markets, the canonical text and hash (a Polymarket rule sent here is back-tested the Polymarket way) |
| GET | `/polymarket/search?q=&status=` | 60 s | heavy | Polymarket (Gamma) search by text, event slug or condition id: events with their binary markets (`yes` / `no` = the first / second outcome; each a one-shot selector), the event as `event:<slug>`, the tags seen as `tag:<slug>` / `tag:<slug>/moneyline`; refused events marked; no prices, odds or volume; `status` open (default) / closed / all |
| POST | `/polymarket/backtest` `{ rule, months? }` | — | heavy | a Polymarket rule (`rule.oracle` must be `polymarket`) back-tested on Gamma's closed markets; `scanComplete: false` says where a dense selector's scan stopped. Display-grade: the keeper reads every result from the Polygon payout vector |
| POST | `/rules/validate` `{ rule, ticker? }` | — | read | `canonical` (the exact bytes `rules.json` holds), `sha256`, `statement`, `receiptFormat`; 400 lists every problem |
| POST | `/launch/bundle` | — | write | unsigned base64 transactions + the review payload the wizard shows; registers a DRAFT unless `register: false`; never signs. Since 1.3.0 the selector's creation **preflight** runs first (primary + independent cross-read, or the Polymarket payout vector + Gamma) and a failure refuses the bundle (400 `code: "preflight"`, or 502 when a read failed) with the `preflight` result attached; every Kalshi rule is refused. On success the bundle carries `preflight` (null when `BURNTICKER_PREFLIGHT_STRICT` is off on the host) |
| POST | `/launch/confirm` `{ mint, signature }` | — | write | the landed launch transaction takes the draft live; settlements after this moment count (409 once the draft has expired) |
| POST | `/launch/review` `{ rule, ticker, name, note?, descCtx?, pair?, companion?, warnings? }` | — | read | (API 1.14.0, launch audit 5 L02 / L06; `src/lib/burnticker/launchReview.ts`) the read-only pre-wallet review: network, launch type and availability, canonical rule + sha256, names and tickers, allocation, fee split per 1 SOL, transactions and signer roles, estimated SOL, prerequisites, who can change what, problems. Builds, pins, registers and reads nothing; answers in preview and open modes (closed: 403 `creator-launches-closed`) |
| GET | `/sinks?network=&exclude=` | 30 s | read | (API 1.17.0) the live coins a new coin may name to take its rest when its rule ends: `{ network, sinks: [{ mint, ticker, name, rule }], count, fallback }`; never $DEFICIT (its own choice), never a coin in `exclude` or its pair partner |
| GET | `/tokens?status=&limit=&offset=` | 30 s | read | the registry: status (`draft` / `live` / `paused` / `retired` / `expired`), rule hash, receipt and burn counts (no network calls) |
| GET | `/tokens/{ticker}` | 30 s | read | `status` (supply, burned, pool, `next` = next possible burn + implied chance), `receipts`, `readings` (each with `sourceUrl`, `method` and, for Polymarket, `proof` = the Polygon payout locator), exact `rulesText`; `{ticker}` may be the mint. `status.status` is the registry row state, and `status.lifecycleState` is what the coin is doing now (`decided`, `voided`, `ended`, `live`, or the row state) |
| GET | `/tokens/{ticker}/receipts` | 30 s | read | every receipt, recomputed at request time (`verify.verified`) |
| GET | `/tokens/{ticker}/verify/{id}` | 60 s | heavy | rules / memo / source / units / spend / chain checks for one receipt |
| GET | `/trust` | 60 s | read | the Powers Register, designed fees vs the LIVE LaunchLab platform config (when the host has an RPC), program facts, statements |
| GET | `/check` | 600 s | read | the sceptic's checklist (API 1.5.0, trust pack; `src/lib/burnticker/trustpack/checklist.ts`): every instruction of burn_receipts and pair_curve with the only place it can move funds, every privileged power (none over funds), what is locked, what is not done, the verified-build table; `docs/burnticker/CHECK-THIS-YOURSELF.md` is rendered from the same object |
| GET | `/check/receipts` | 600 s | read | the devnet receipts the `/burnticker/check` verifier offers (from the rehearsal evidence), each token's exact rules text |
| GET | `/check/receipts/{signature}` | 300 s | heavy | the browser verifier's ten checks run on the server: transaction, program, memo, the program's Reading + TokenConfig accounts, rules hash, the Treasury source (URL hashed against `source_url_hash`), units, spend, burn — `ok` true / false / null with the reason |
| GET | `/fees/ledger` | 600 s | read | the pinned developer fee wallet's ledger from chain, by UTC month, and the expenses the fee pays (`config/burnticker/expenses.json`, placeholders marked) |
| GET | `/operator` | 60 s | read | who runs this, every operator wallet per cluster (TODO placeholders listed), the signed-statement check (ed25519), the never-buys monitor's last report |
| GET | `/bounty` | 60 s | read | the bounty wallet (operator-held, funded 2026-10-11), its live balance read from chain, the decided reports |
| GET | `/snapshots?limit=` | 60 s | read | (API 1.7.0, trust ops; `src/lib/burnticker/ops/snapshot.ts`) the daily registry snapshots pinned to Arweave, newest first: `{ date, sha256, arweaveTxId, url, rowCounts, bytes, capturedAt, verify }` — the append-only ledger (rules, readings, receipts, pairs, pair outcomes, rule ends, launch pins) as canonical JSONL; re-download and recompute with `scripts/burnticker-verify-snapshot.mts <txid>` |
| GET | `/current-status` | 60 s | read | (API 1.13.0, website brief §4; `src/lib/burnticker/currentStatus.ts`) the one current-status summary: phase, network deployment, programs (devnet bytes = build, upgrade authority read from chain), attesters and quorum, each Squads vault's time lock read from chain beside the planned value, settlement providers, per-finding review status, open release requirements, design vs historical |
| GET | `/` | 300 s | read | the base path itself (1.16.0): `{ name, version, openapi, docs }`, so the address the site footer prints answers |
| GET | `/openapi.json` | 3600 s | read | the OpenAPI 3.1 document |
| GET | `/coins/{mint}/calendar` | 300 s | heavy | (API 1.18.0, cheap-features item 2; `src/lib/burnticker/calendar.ts`) a coin's next scheduled readings, at most five: a team coin's next games inside its window (the league's own schedule), a Treasury coin's next business days, else the status record's next check and market end. A reading is a time a result can arrive, not a burn. A game coin burns once two sources agree on the final, or once one source has shown the same final twice a few minutes apart, so a corrected score or a disputed result can still stop it; while it waits, the next check is the time of that second read |
| GET | `/coins/{mint}/calendar.ics` | 300 s | heavy | (1.18.0) the same entries as an iCalendar file (`text/calendar`, RFC 5545, `content-disposition: attachment`) |
| GET | `/coins/{mint}/checklist` | 30 s | read | (1.18.0, item 10; `checklist.ts`) created, trading, graduated, pool verified, first reading, first burn (each `done` true / false / null = not read), the next action and who does it, and `shareImage` |
| GET | `/leaderboard` | 60 s | read | (1.18.0, item 3; `leaderboard.ts`) most burned, biggest single burn, longest streak, newest receipt: ten rows each, read from the receipts, launched coins only, memoised per minute |
| GET | `/digest?day=YYYY-MM-DD` | 300 s | read | (1.18.0, item 8; `digest.ts`) one UTC day (default today): results read, confirmed burns, new coins, graduations this site registered, and plain lines; `scripts/burnticker-posts.mts digest --digest-file=FILE` turns a saved answer into one queued post |
| GET | `/ops/post-queue?state=` | — | read | (1.18.0, item 9; `postApproval.ts`) operator only (the operator's network and `x-action-pin`): the owner's post queue with each post `waiting` or `used`. Never posts |
| POST | `/ops/post-queue/used` `{ id, note? }` | — | read | (1.18.0) operator only: appends a "used" mark to `data/launch/post-queue-used.jsonl`; the queue file is never changed and nothing posts |
| GET | `/ops/platform-fees` | — | read | (`platformFeeClaim.ts`) operator only (the post queue's gate): the LaunchLab platform config read from chain, the wrapped-SOL fee vault's balance and the three unsigned instructions of the claim for `/burnticker/operator/claim-fees`. Never signs or sends |
| GET | `/ops/statement-text?date=YYYY-MM-DD` | — | read | (`trustpack/statementOps.ts`) operator only (the claim page's gate): the operator statement's exact text for that day (default today in UTC, the same text `scripts/burnticker-sign-statement.mts --print-text` prints; both build it with `trustpack/statement.ts`) and the signer wallet, for `/burnticker/operator/sign-statement`. Reads `operator.json` only; nothing is signed or kept |

## Cheap-features pass (API 1.18.0, 2026-10-13)

- **The receipt share card and the embeddable widget** (items 1 and 7; `src/lib/burnticker/receiptCard.ts`): `GET /burnticker/img/receipt/<MINT>.png`
  (or `.svg`; a ticker one coin holds also answers) is a 1200 × 630 card in the receipt style: the coin's own generated image, the
  ticker, the rule's sentence, the latest burn and the burn count (a Coin vs Coin coin draws its pair's scoreboard instead). It is the
  coin page's Open Graph and X image, and the stable URL by mint is the one to embed:
  `<img src="https://burnticker.com/burnticker/img/receipt/<MINT>.png" alt="..." width="600" height="315">`. Cached five minutes; the
  server renders each (coin, newest burn) once. Outside `/v1`, so it carries no rate-limit headers.
- **The review** (`POST /launch/review`) carries `backtest` (item 5: a team rule counted over the team's previous season from the
  league's own schedule, `available: false` with the reason otherwise) and `simulation` (item 6: the result, a tie, a void, no result
  and no graduation for a hypothetical 1 SOL burn pool and an 85 SOL trading pool, both coins for a pair; `src/lib/burnticker/simulator.ts`,
  client-safe, for other amounts).
- **Generated team tickers say the side** (item 4): `$LADWIN`, `$LADLOSS`, `$LADDRAW`, `$LADNOWIN`; a long one shortens the window first
  (`$LADWINN5`). Registered tickers and pair tickers do not change.
- **Coin vs Coin** (items 12 to 15): `GET /derby/{id}` pair blocks carry `scoreboard` (days won, the current streak, SOL moved to the
  winning side, run day N of M, one line); a coin page's `status.derbyScoreboard` carries the same. Run-length presets are 7, 14 and 30
  days (`DERBY_RUN_PRESETS`; the API takes 1 to 366). A two-coin daily race's sentence ends "At the end, the side with more winning days
  takes the rest.", and its generated tickers carry the fight (`$WIFWINS` / `$BONKWINS`).

### `POST /launch/bundle`

```json
{ "creator": "<wallet pubkey: pays and signs>", "mint": "<PUBLIC key of a mint keypair you generated>", "ticker": "BRONCO",
  "name": "Bronco Burn", "description": "…", "imageUrl": null, "links": [], "rule": { … }, "firstBuySol": "0",
  "acknowledgements": { "ruleLocked": true, "noReturns": true }, "recentBlockhash": "<optional, from your RPC>", "register": true }
```

`mint` is required. Generate the keypair yourself (`solana-keygen new`, or `Keypair.generate()`); the secret never travels. The
response has `review` (rule text and hash, `receiptFormat`, addresses, allocation, fee split, `burnPoolAuthority` = the coin's fee PDA,
disclosures, operator powers), `transactions[]` (`transaction` = base64 wire format with empty signature slots, `message`, `signers:
["creator","mint"]`, `recentBlockhash`, `blockhashPlaceholder`, the instructions), `ready`, `pending`, `registered`, and `next`.
Without `recentBlockhash` the transactions carry the all-ones placeholder, so rebuild them with a fresh blockhash before signing (the
SDK does this). While `ready` is `false`, send nothing. Refusals: 400 for invalid input or rule, 403 for the refuse list, 409 if the
ticker or mint is taken, 502 if Kalshi or Polymarket is unreachable (or the Polymarket selector is unknown). A Polymarket tag series
must settle at most one keeper scan of markets a week (600 at the defaults); a denser tag is refused with a hint to add a market type
(`tag:nfl/moneyline`) or an event pattern (`tag:nfl/moneyline:nfl-*den-*`). **A draft reserves its ticker for 24 hours.** Confirm the launch within that window. After it, the draft becomes `expired`: the row stays, the ticker is free for anyone, and confirming is refused, so build a fresh bundle. Mainnet is refused until the program and the LaunchLab adapter are live.

**Wire size: version-0 transactions and the lookup table (re-check 2026-10-11).** A real single-coin create (`initialize_token` plus
LaunchLab's `initialize_v2`) is 1,262 bytes as a legacy transaction, over Solana's 1,232-byte packet limit, so the launch page's
signing plan (`src/lib/burnticker/signPlan.ts`) compiles every step as a version-0 transaction against the network's address lookup
table: the fixed accounts every launch touches (both programs, LaunchLab's program, global config, authority, event authority and
Burnticker's platform and its fee vault, the CPMM config, the fee-keys PDA, the operator treasury, the token, system, rent, metadata
and memo programs, the WSOL mint) come from the table, and the creator, the mint and its accounts stay in the message. The entries
and their order are `src/lib/burnticker/lookupTable.ts`; the address is pinned per network in `src/lib/burnticker/networks.ts`
(`LOOKUP_TABLES`); the browser reads the table and checks every entry, its index and its authority (the operations key or none)
before anything is signed, and stops with "lookup table mismatch — nothing was sent" otherwise. `scripts/burnticker-lut.mts verify
--cluster devnet|mainnet` prints the same comparison. Measured (2026-10-15, `test/burntickerLookupTable.test.ts`): a single coin is two
steps, its rule locked (691 to 701 bytes) and then the coin created (640 to 694 bytes); a LaunchLab pair is four steps of at most 829
bytes; the pair-curve steps are 882, 882 and 683. Every step leaves at least 330 bytes for checks a wallet adds before it signs. A
single coin used to be one step of 1,031 to 1,095 bytes, and a wallet that added two checks and a compute-budget instruction took it to
1,234 bytes, over the limit. A create together with the creator's opening purchase is 933 bytes (1,053 in vault mode), which fits the
limit but not that margin, so the hosted path still carries no opening purchase. A caller of this endpoint who signs `message` as a legacy transaction meets the
same limit (the `transaction` field is null when the legacy form does not fit): compile `instructions` as version 0 with that table.

### Polymarket rules (since 2026-10-10, API 1.1.0)

`oracle: "polymarket"`, binary only. One market: `market` = its condition id (`0x` + 64 lowercase hex). Recurring: `series` =
`tag:<tag slug>[/<sports market type>][:<event slug glob>]` (every binary market Gamma lists under the tag, optionally of one type and
whose event slug matches the glob) or `event:<event slug>` (every binary market of one event); `filter.titleRegex` matches the market
question (`tickerIncludes` is Kalshi's and is refused). YES = slot 0 of the condition = the market's first outcome ("Yes", or the
first-listed team of a game), NO = slot 1. A reading is written only once the payout vector is on chain; a 50-50 payout is a void.
Rivalry pairs work on a Polymarket market exactly like a Kalshi one-shot (side A YES, side B NO). Team coins and matchup pairs stay
on Kalshi: a Polymarket game is one market whose YES is whichever team its title lists first, with no per-team leg.

## The wallet's signed launch request (API 1.19.0, 2026-10-18)

`POST /launch/bundle` (and the wizard's launch route) accepts an optional `walletProof: { message, signature }`: the creator
wallet's `signMessage` signature (base58), raw or as a Solana off-chain message (hardware wallets), over a short text naming this
site and its origin, the wallet, the ticker(s), the mint(s) (or "chosen by this site"), a nonce and the time. A proof is spent once
its prepare succeeds. It is checked before anything is counted, uploaded or prepared. A request with a valid signature, from a wallet
that already holds the launch's cost, may use the whole daily upload limit; any other request shares the part that is not kept for
signed ones (429 `upload-budget-unsigned`, or `upload-budget-unfunded` for a signed wallet below the cost). A signature that does not
check out is refused with 401 `wallet-proof-invalid`. The SDK's `buildLaunchBundle` signs it when given `signMessage`. Top-level
fields a launch does not read are dropped.

## 3. Calling it from a bot

- **GET** routes are keyless and CORS-open (`Access-Control-Allow-Origin: *`), with `Cache-Control: public, max-age=N,
  stale-while-revalidate`. Cache them.
- **POST** routes keep the repository's cross-site refusal. Send `Content-Type: application/json` (otherwise 415) and, from a
  non-browser client, `Origin: https://<host>` equal to the API's origin (otherwise 403). A browser page on another site can set
  neither, which is the point. POST routes have no CORS headers.
- Errors are JSON `{ "error", "code"?, "problems"?, "retryAfterSec"? }` and are never cached.

## 4. Rate limits

These are per client IP: the right-most `X-Forwarded-For` hop, which the platform's own Caddy appends. When that hop is one of
Cloudflare's published addresses, the client is the visitor address Cloudflare sends in `CF-Connecting-IP` instead; that header is
ignored on any other request. An IPv6 client is counted per /64. Each limit is a token bucket:

| Bucket | Limit | Endpoints |
|---|---|---|
| read | 120 burst, 120/min sustained | catalogue, previews, validate, tokens, receipts, trust, openapi |
| heavy | 20 burst, 20/min sustained | Kalshi and Polymarket search and back-test, verify (these call Kalshi or Polymarket, or re-read a source) |
| write | 10/hour | launch bundle, launch confirm |

Every response carries `RateLimit-Limit` and `RateLimit-Remaining`. A 429 carries `Retry-After` (seconds). The limiter is in
memory on the one app process. Be polite: the read routes are cacheable, Kalshi itself is cached server-side (series 1 h, settled
5 min, open 1 min), Polymarket's Gamma responses are cached 10 min (a resolved on-chain payout for good), and `subscribe()`
defaults to a 15 s poll.

## 5. What you cannot do

You cannot change a rule (a different rule is a different token), claim or redirect a fee (the burn pool has no withdraw path), or
adopt an existing token: `initialize_token` must be signed by the new mint keypair, and the burn pool must be LaunchLab's recorded
creator from the first trade. You cannot get anything signed. And there are no referral codes, discounts or hidden parameters:
every parameter of a coin is in its `rules.json`.

## 6. Versioning

- Paths are under `/v1`. Within v1, changes are **additive only**: new endpoints, new optional request fields, new response
  fields. A field is never removed, renamed or retyped, and an enum never loses a value. Ignore fields you do not know.
- A breaking change ships as `/v2`. `/v1` keeps answering for at least 90 days afterwards, with a `Deprecation` header.
- `info.version` in `/openapi.json` (and the `x-burnticker-api` response header) is the semver of the document. Minor versions add,
  and patch versions fix descriptions.
- The SDK follows the same policy: semver, additive within a major.

## 7. Verifying the API's own answers

You should not have to trust this server. `rulesText` hashes to the `sha256` every receipt cites. `/verify` explains each check, and
the SDK's `verifyReceipt` repeats all of them on your machine: Kalshi re-read from Kalshi, Polymarket re-read from the Conditional
Tokens payout vector on Polygon (`eth_call` to `0x4D97DCd97eC945f40cF65F87097ACe5EA0476045`), feeds re-read through their published
config, spend recomputed with the exact integer formula, and the memo read from the transaction itself. See [sdk.md](sdk.md) §5.


## Launch: the generated description, the creator's note, the pin (2026-10-10)

`POST /launch/bundle` (and the wizard's `/api/burnticker/launch`) never stores a free-text description. The coin's description is
describe.ts's paragraph for the locked rule, generated on the server; the request's `descCtx` is checked word by word before it
reaches a template. The other fields:

- `note`: optional, ≤ 140 characters. It is stored apart and shown as "creator's note — not part of the rule".
- `name`, `ticker` and `note` pass the copy lint with the creator scope. A hit returns 403 `code: "copy-lint"` with `categories`
  (for example `no-affiliation`).
- The coin's image is one of two things: the creator's own picture, sent as bytes in `image` (`{ contentType, base64 }`, with
  `imageRights: true`; only where `BURNTICKER_CUSTOM_IMAGES_ENABLED` is set, otherwise 400 `custom-image-off`), which is decoded,
  size-checked, marked and pinned on Arweave with its sha256; or, with no `image`, the generated receipt art, pinned the same way.
- `imageUrl` must be `null` or left out (API 1.20.0, since 2026-10-19, on `/v1/launch/bundle`, the launch page's route and its dry run, and on a
  pair's side B). Any address is refused with 400 `code: "image-url-refused"` and the sentence "A coin's image cannot be given as a
  web address. Send the picture itself in the image field, and it is checked and pinned with the coin's details. Leave the image out
  and the coin uses its generated receipt art." (prefixed "Side B: " for a pair's second coin). That covers plain https links and
  Arweave references alike (`ar://<txid>`, `https://arweave.net/<txid>`, any gateway): an Arweave transaction id is not a hash of
  the image bytes, so confirming what it holds would mean fetching it, and the launch path fetches nothing from outside hosts. A
  linked image could be swapped or vanish after launch, every visitor's browser would contact that host, and the upload checks never
  see its bytes. Coins registered earlier with a linked image keep it (the registry is append-only); their pinned check says
  "The image is a link to another website, not a pinned copy."
- At launch (`register: true`), the metadata JSON and the PNG are pinned on Arweave (Irys). The bundle's `metadataUri` is the arweave
  URL. A failed upload returns 502 `pin-failed`.
- A preview bundle carries `ar://pending-upload-at-launch`.
- `status.json` gains `pinned` (`metadataUri`, `metadataSha256`, `imageUri`, `imageSha256`, `hosted`, `expectedDescription`). It also
  gains `profile.badge`, `profile.note` and `profile.affiliation`.

To verify a coin yourself:

```sh
curl -s "$SITE/t/RAYS26/status.json" | jq .pinned
curl -s "<pinned.metadataUri>" | sha256sum                 # = pinned.metadataSha256
curl -s "<pinned.metadataUri>" | jq -r .description        # = pinned.expectedDescription, byte for byte
```


## Product batch (API 1.6.0)

| Method | Path | Cache | Bucket | What |
|---|---|---|---|---|
| POST | `/search/miss` | — | read | The launch page reports a search that showed cards but got no "Use this" click. Anonymous: the query folded to plain words, the UTC hour. No IP, no id. A search with no card is logged by `/search` itself. |
| GET | `/ops/search-misses?days=` | — | read | Admin only (the operator's network + `x-action-pin`): missed searches by query, and time-to-launch p50 / p90 per wizard step. |
| GET | `/creators/{wallet}` | 30 s | read | Read-only: every coin whose creator wallet matches. Each coin has its state (draft / curve / graduated / retired / voided), queued units, the next settlement, the last reading and how many independent reads confirmed it, receipts, the wind-down, and today's lint-checked post to copy. The `/burnticker/me` dashboard reads it. |

`POST /launch/bundle` (and the wizard's launch route) accepts an optional `timings` object holding the page's step timestamps
(`search`, `card`, `create`, `review`, `launch`). They are stored with the draft as durations.

## Growth batch (API 1.7.0)

| Method | Path | Cache | Bucket | What |
|---|---|---|---|---|
| GET | `/badge/{TICKER}.svg` · `.png` · `.json` | 60 s | read | A coin's embeddable receipt card: ticker, the rule's one-liner, the last burn (date + units), receipts this season, "verify →" to the coin page's `#verify`. `.json` is the payload (`burnticker.badge/v1`) with the iframe / Markdown / HTML snippets. **No market data**: no price, market cap, odds, implied chance or volume in any payload (`badgePayloadProblems`). Drafts are 404. |
| GET | `/badge/pairs/{pairId}.svg` · `.png` · `.json` | 60 s | read | The same card for a rivalry pair: both coins, the burns per side, the last burn, "verify →" to the pair page. |
| GET | `/verify-mint/{mint}` | 60 s | heavy | Is this mint a Burnticker coin? The burn_receipts program's TokenConfig on devnet and mainnet (a read-only getAccountInfo against the canonical per-network program id — `src/lib/burnticker/networks.ts`, the receipt verifier's configuration; since audit 4 the host's wiring is not consulted) and the registry, with the rules sha256 compared. `registration` (per network: registered / not-registered / unavailable) and `catalogue` (launched / draft / expired / absent, on the network the host reads) are separate fields; `disclosed` names the platform's own rehearsal coins. `verdict`: `burnticker` ("Burnticker coin: yes": ticker, creator, launch date, receipts, page), `program-only` (registered, not in the catalogue), `not-launched` (a draft), `not-registered` ("NOT registered with the burn_receipts program" — every network answered), `unavailable` ("Unable to verify" — a chain read failed; never a no), `invalid`. Always 200 with the verdict. |
| GET | `/clones` | 300 s | read | The "Not Burnticker" list (`burnticker.clones/v1`): Solana tokens whose name or ticker resembles DEFICIT, Burnticker or a launched ticker and that are not Burnticker coins, as the clone watch recorded them. Each has the mint, pool, first / last seen, `registered` (program), `bundle` (top holders with identical shares), `lp` (present / thin / pulled + when) and `evidence` lines. Evidence only: it names no one. |

The badge endpoints answer `image/svg+xml` and `image/png` as well as JSON. The OpenAPI document lists those media types beside
`application/json` on the 200. Errors stay JSON.

**Embedding (not under `/v1`).** `GET /burnticker/embed/{TICKER}` and `/burnticker/embed/pairs/{pairId}` serve one self-contained
HTML document: the badge's SVG and a live "next settlement" line. It is built for an iframe:
- the CSP is `frame-ancestors *`, with `default-src 'none'` and a sha256 hash for its one style and its one script;
- it sets no cookies and sends `Referrer-Policy: no-referrer`;
- it is cached for 60 s and the page reloads itself every 60 s.

Snippets:

```html
<iframe src="https://burnticker.com/burnticker/embed/DEFICIT" width="480" height="230" style="border:0;max-width:100%" loading="lazy" title="$DEFICIT receipts on Burnticker"></iframe>
```

```markdown
[![$DEFICIT receipts on Burnticker](https://burnticker.com/api/burnticker/v1/badge/DEFICIT.svg)](https://burnticker.com/burnticker/t/DEFICIT)
```

**Launch refusals added in 1.7.0.** `POST /launch/bundle` answers **409** in two new cases:
- `code: "lookalike"` with `hits`: the ticker or name reads as an existing Burnticker coin's. That covers homoglyphs, 0/O and 1/l/I,
  accents, a single edit, a copycat suffix or prefix such as `DEFICIT2` or `REALDEFICIT`, and the platform's own name;
- `code: "mint-exists"`: the mint is already registered, or already exists on chain when the host has an RPC to check. Burnticker
  never adopts an existing token.

**Other new pages.** `/burnticker/leagues` and `/burnticker/leagues/{league}/{season}` are the league scoreboards. The season is
`2026-27` for leagues whose season spans two years and `2026` for the others. `/burnticker/verify` answers for a mint,
`/burnticker/not-burnticker` lists lookalikes, and `/sitemap.xml` is the sitemap.

A bot that follows receipts, previews a launch or queues posts can start from `packages/burnticker-bot-starter/` ([sdk.md](sdk.md) §10).

## LP locked forever (API 1.8.0)

Owner decision 2026-10-10: graduation LP is locked forever (Raydium's LP lock), the Fee Key is owned by the burn program's
`["fee_keys"]` PDA, and the permissionless `claim_lock_fees` pays 80 % of the LP fees' SOL side to the coin's burn pool and 20 % to the
operator treasury (fixed in code; the coin side is burned). On mainnet, for new coins: After graduation, about 0.98% of every swap goes to the coin's burn pool and about 0.13% to the operator — 20% of the locked pool's liquidity fees. Raydium keeps about 0.15%. Coins created before the change keep the tier they pinned (tier 9: about 0.88% to the burn pool, about 0.04% to the operator, about 0.08% to Raydium). All additions, nothing removed:

- `GET /tokens/{ticker}` → `status.lp` (`LpLock`): `policy` "locked-forever", `lockProgram`, `feeKey` (the Fee Key NFT mint; null before
  graduation), `feeKeyOwner` (the fee-keys PDA), `lockedLiquidity`, `feeKeyRecord`, `lockedPct`, `split` { burnBps 8000, operatorBps
  2000 }, `operatorTreasury` (null = not pinned on this cluster: claims refuse `TreasuryNotPinned`), `lastClaim` { at, signature, sol,
  toBurnPool, toOperator, tokenBurnedRaw, txUrl, line } and `totals`. `status.trust.lpBurnedPct` is 0 from 1.8.0; read `lpLockedPct`.
- `GET /trust` → `lpLock` (`LpLockPolicy`): the cluster's lock program and authority, the fee-keys PDA, the treasury, the split and the
  per-swap numbers for new coins on the host's cluster (mainnet CPMM tier 14: 50.4 bps to the burn pool, 12.6 bps to the operator, 97.9 bps to the burn pool with the creator fee; 16.8 / 4.2 / 88.05 on tier 9 and 21.55 on tier 0); `fees.designed.postGraduation` is the tier the live platform gives new coins, and `GET /tokens/{ticker}` → `status.fees` is the tier that coin pinned; `fees.designed`
  gains `lpLockedPct` and `lpFeeSplit`.
- `GET /fees/ledger` → `lpFees`: the operator's LP-fee line (claims, SOL to the operator and to burn pools, the treasury).
- A claim's receipt is its memo, `<PREFIX>|lockfees|wsol=…|burnpool=…|operator=…|burned=…|nft=<first 12 of the Fee Key>|v1`; the SDK's
  `parseLockFeesMemo` reads it and `fees.splitLockFees(lamports)` recomputes the split (operator = floor(20 %), the burn pool the rest).

## LP lock round 2 (API 1.9.0)

The blind review's fixes (2026-10-11), all additive: `status.lp.lastError` { at, error, sentence } — the keeper's last refusal for the coin's
lock steps with the program error in plain words (`PlatformNotPinned`, `LockerMismatch`, `FeeKeyNotRegistered`, `FeeKeyMismatch`,
`TreasuryNotPinned`…); `/trust` `lpLock` gains `platform` / `platformPinned` (the LaunchLab platform compiled into burn_receipts; null =
not pinned, `initialize_token` refuses `PlatformNotPinned`) and `launchLabLocker`, and `lpLock.feeKeysPda` is never null (a fixed PDA of the
program id). Claim memos are v2 — `<PREFIX>|lockfees|wsol=…|burnpool=…|operator=…|paid=…|pending=…|burned=…|nft=…|v2`; v1 memos (devnet
history) still parse, and `lp.lastClaim.line` names any operator amount still owed. A claim that moves nothing writes no memo and no receipt.

## Winner takes the burn (API 1.10.0)

Rivalry pairs since 2026-10-11 (owner decision, LAUNCHPAD-PATH §40): fees from both coins burn the winner's supply — at each result the
losing coin's fuel moves to the winning coin's burn pool (`forward_to_winner`); nothing is paid to holders and the loser's supply is untouched. All
additions, nothing removed:

- `Receipt.status` may be `forwarded` (this coin lost the period; `spent` is the SOL moved; nothing of this coin was bought or burned),
  and `Receipt.pairRole` is `won` / `lost` / `draw` on pair receipts (a lost receipt carries the units it would have had had it won).
- `GET /tokens/{ticker}` → `status.pair.winnerTakesBurn` and `status.pair.forwards[]` (`PairForward`: recordDate, from, to, fromMint,
  toMint, sol, units, signature, txUrl), oldest first. The app's pair endpoint (`/api/burnticker/pairs/{pairId}`) carries the same in
  each side's status and in `tally` (`winnerTakesBurn`, `forwardedAtoB`, `forwardedBtoA`, `forwards`).
- `GET /derby/{id}` → `pair.forwarded` { aToB, bToA, windows }.
- `status/status.json` (ops) → `pairs[]` { pairId, a, b, winnerTakesBurn, forwards, lastForward }.
- A forward's receipt is its memo, `<LOSER PREFIX>|forward|from=<12>|to=<12>|period=<YYYY-MM-DD>|lamports=N|v1`. The program's pair
  refusals (6077–6089) appear as plain sentences in keeper alerts. The SDK reads `PairResultSubmitted` from "Program data:" logs.

## Pair-forward round 2 (API 1.11.0)

The pair-forward blind review's fixes (2026-10-11), all additive: `status.pair.unpaired` { reason, at, signature } once `unlink_pair` ran
(a voided pair curve, a refunding side, or, since round 3, a LaunchLab pair whose locked voidBy day ended with a coin still without a verified pool) — two plain coins from then on, later
receipts carry no `pairRole`; the pair page says "unpaired (reason)"; `status/status.json` `pairs[].unpaired`. A forward against a side
without a verified pool is a `forwarded` receipt with `spent` 0 (the program always writes the memo, `lamports=0`). The keeper's new alerts:
`pair-result-unservable` (a win could not be recorded yet; no draw is substituted), `pair-forward-missing` (a lost period cranked unpaired after 72 h),
`pair-unlinked`, `pair-link-refused`. Errors 6090–6093 (`PairResultNotServable`, `PairDateBeforePairing`, `PairHasReadings`,
`PairStillLive`) appear as plain sentences.

## Pair-forward round 3 (API 1.12.0)

All additive: `status.pair.pairState` — this coin's pair state on chain: `none`, `provisional`, `paired` or `unlinked` (round 3: `unlink_pair`
on terminal evidence leaves both coins unlinked, plain coins); `status.pair.pairVoidBy` — a LaunchLab pair's locked voidBy as stored on
chain (YYYY-MM-DD, the same on both coins); `status.pair.pairAfterDate` — periods on or before it were read before the pairing and stay
unpaired (no pair result). The pair page states who decides results: "Whoever holds the common attester quorum decides every result; on
Burnticker that is the operator's keeper alone at quorum 1." Errors 6094–6099 (`PairAttestersDiffer`, `ForwardWindowClosed`,
`PairedAttesterChange`, `InvalidPairVoidBy`, `PairTerminal`, `PairPeriodUnpaired`) appear as plain sentences.



## Current status (API 1.13.0)

`GET /current-status` is the single source every page uses for "what is true now" (`config/burnticker/current-status.json` joined with
`config/burnticker/verified-build.json`, `config/burnticker/operator.json`, the host's environment and live chain reads, cached five
minutes). A chain read that fails reports `timeLockSource: "unavailable"`, never a guessed value.
The same rule holds per program (code review 3, F1, 2026-10-11): `devnet.authoritySource` is `chain` only when the ProgramData account was
read and decoded — then, and only then, a null `upgradeAuthority` means no upgrade authority — `unavailable` when the read failed, came back
partial or did not decode (the dated `verified-build.json` record is carried beside it as `recordedUpgradeAuthority` / `recordedAt`), and
`verified-build` when no live read was made. `mainnet.deployed` is `true`, `false` or `null` (`source: "unavailable"`, line "mainnet
deployment unknown (the chain read failed)") — a failed lookup never reads as "not deployed".

## Launch availability and preview mode (API 1.14.0)

`GET /catalogue` → `launches` keeps `creators` (true only when creator launches are open) and adds `mode` (`closed` / `preview` /
`open`), `banner`, `types` (team, matchup, markets, elections, feeds, weather, derby, pairs — each `{ label, available, reason }`) and
`sources` (sports settlement and schedules, Polymarket, NWS, publishers, the pair curve). `src/lib/burnticker/launchAvailability.ts`
derives all of it from the host's environment:

- `BURNTICKER_CREATOR_LAUNCHES_ENABLED=1` → `open`. `BURNTICKER_CREATOR_LAUNCHES_PREVIEW=1` (with ENABLED off) → `preview`: the wizard
  and the review card render under the banner "Preview: creator launches are closed; nothing here builds or sends a transaction.",
  `POST /launch/bundle`, `/launch/confirm` and the wizard's `/api/burnticker/launch` refuse with 403 `{ code: "launches-closed",
  preview: true }`, and `POST /launch/review` answers. Neither → `closed` (403 `creator-launches-closed`, `preview: false`).
- Per type: on a mainnet host sports (team coins, matchups) need TheSportsDB's licence key (`BURNTICKER_THESPORTSDB_KEY`) — games
  without an on-chain market settle on its final — and registered pairs (election pair, Coin vs Coin) need
  `BURNTICKER_PAIR_CURVE_ENABLED`. An unavailable type is refused with 403 `{ code: "launch-type-unavailable", type }`.


## Hosted launches: the real LaunchLab client, the mainnet allowance, no opening purchase, no vault mode (launch-10, 2026-10-12)

- A host with `BURNTICKER_RPC_URL`, `BURNTICKER_PROGRAM_ID` and `BURNTICKER_PLATFORM_ID` now builds the real LaunchLab create
  (`src/lib/burnticker/launchLabChain.ts`: it reads LaunchLab's global config and the platform config on every launch, checks the
  LP-lock pins, and uses the CLI's own builder). The bundle then says `ready: true` with `pending: []`. Without those settings, or
  with `BURNTICKER_LAUNCHLAB_CLIENT=fake`, the practice client stays and the bundle says `ready: false`.
- A mainnet host refuses every launch with 403 `{ code: "mainnet-launches-off" }` unless its owner sets
  `BURNTICKER_ALLOW_MAINNET_LAUNCHES=1`. The refusal comes before anything is pinned or registered.
- `firstBuySol` must be `"0"` or absent. Anything else is refused with 400 `{ code: "opening-purchase-off" }`: a create with an
  opening purchase leaves too little room in the create step for the checks a wallet adds. The creator trades on the curve after the create like anyone else. The offline SDK
  builder and the operator's CLI (`scripts/burnkeeper-launch.mts --first-buy-sol`) keep the option.
- A vault-mode rule is refused with 400 `{ code: "vault-off" }`: its bundle needs a signature from the burn program's fee PDA, which
  no wallet can give.
- `GET /api/burnticker/launch` answers `{ lookupTables: { devnet, mainnet } }`, the lookup-table pins the signing card checks. A host
  sets its own network's pin at runtime with `BURNTICKER_LOOKUP_TABLE` (and `BURNTICKER_LOOKUP_TABLE_AUTHORITY` while the table is
  not frozen); otherwise the values compiled into `networks.ts` apply. The card still checks every entry of the table it finds.

## Feeds (RSS 2.0 and JSON Feed 1.1; polish-1, 2026-10-12)

Not under `/v1`: these are reader feeds, built from the same rows the pages read (`src/lib/burnticker/feedsData.ts` collects them the
way the home API does: each registered coin's status and receipts, the $DEFICIT keeper's published `status.json` and `burns.json`
while $DEFICIT is not registered here, and the devnet rehearsal's evidence; `src/lib/burnticker/feeds.ts` renders them).

| Path | What |
|---|---|
| `/api/burnticker/feeds/receipts.rss` · `.json` | every confirmed burn this site shows, newest first; each item links to its own receipt check |
| `/api/burnticker/feeds/coin/{TICKER}.rss` · `.json` | one coin's burns, signed readings, graduation and pool registration, newest first; each item links to its evidence |
| `/api/burnticker/feeds/next-results.rss` · `.json` | the next result each coin waits for and where its latest result stands (the `/burnticker/upcoming` page); one item per coin, whose `id` changes when the coin's state changes |

- Content types: `application/rss+xml; charset=utf-8` and `application/feed+json; charset=utf-8`. `Cache-Control: public,
  max-age=300, stale-while-revalidate=600`, an `ETag` of the content (a conditional GET with `If-None-Match` answers 304), CORS open.
- RSS items carry `title`, `link`, `description`, a non-permalink `guid` (`burn:<signature>`, `reading:<signature>`, `next:<TICKER>:…`)
  and `pubDate` when the row's time is read; graduation and pool rows have no date, and their text says the site does not read it.
  JSON Feed items carry `id`, `url`, `title`, `content_text` and `date_published` on the same terms, plus the extension object
  `_burnticker` { `feed`, `rss`, `updated`, `empty` }.
- Devnet rows say they are devnet. No item carries a price, a market figure or a promised date.
- Empty states: a feed with nothing to show is a valid feed with no items, and its description (and `_burnticker.empty`) says why in a
  sentence. A registry that cannot be read answers **503** in plain text, never an empty feed. An unknown coin is **404**. $DEFICIT has a
  feed before it is registered here; it stays empty until its keeper publishes.

## CSV export (polish-1, 2026-10-12)

| Path | Columns |
|---|---|
| `/api/burnticker/coins/{TICKER}/burns.csv` | `date, value, units, signature, spent, got, burned, memo, verified, status` |
| `/api/burnticker/coins/{TICKER}/readings.csv` | `date, event, result, value, units, signature, source` |

UTF-8, a header row, RFC 4180 quoting, CRLF line ends, streamed; `Content-Type: text/csv; charset=utf-8; header=present` and
`Content-Disposition: attachment; filename="<TICKER>-burns.csv"`; cached 60 s. The rows are the coin page's Burn log: a registered coin's
receipts recomputed at request time (`verified` is the receipt's own check, `status` its state), oldest first, and the readings its
rule counted (`units` summed over the receipts of that reading; `signature` filled when this site holds the reading's transaction).
For $DEFICIT before it is registered here, the rows come from its keeper's published files and `verified` stays empty (this site does
not recompute them). `spent` is SOL, `got` and `burned` are whole tokens, `value` is the source's own figure. An empty cell means the value
does not exist yet or was not checked here. A text cell that starts like a spreadsheet formula gets a leading apostrophe. Unknown coin
**404**; a keeper file that exists and cannot be read **503**; a keeper that has not published yet gives the header row alone.

## Review parity (API 1.15.0, ChatGPT audits 6 and 7, 2026-10-12)

- `POST /launch/review` runs the bundle route's own refusals (`src/lib/burnticker/launchPreflight.ts`): a catalogue source that is not
  launchable, an oracle this host has off (`uma`, Kalshi without its flag), an unknown series, a reserve outside 0.001 to 1 SOL, a title
  regex that could backtrack catastrophically, major coins' tickers (`majors` in `config/burnticker/reserved-tickers.json`), control
  characters in a name, description or note, lookalikes of registered coins, and links that fail their field (X = x.com or twitter.com,
  Telegram = t.me, no burnticker.com, look-alike or `xn--` addresses). `problems` is empty exactly when the bundle would be built on an
  open host. A share off the web launcher's presets is a warning, not a problem: the bundle accepts any share inside the rule's bounds.
- New review fields: `end` (`result` and `void` stated apart), `projection` (1, 2 and 5% from the source's saved sample, or the reason),
  `timing` (a one-time result's due date, the game the rule names, the due-soon warning, what an unplayed game does).
- `GET /sports/teams`: `season.status` (`upcoming`, `none-listed`, `unknown`, `over`) and `season.warning`; teams with a listed game first;
  `record` only when the schedule has one; `ticker` is the one team ticker (`src/lib/burnticker/tickers.ts`), with the league's tag when
  several leagues share a code (`$ATLMLB`, `$ATLNBA`).
- `GET /search`: one-time markets closing within 48 hours are hidden unless `closingSoon=1` (`hiddenClosingSoon` counts them); a pasted
  mint on the Not Burnticker list answers `lookalike`. `GET /verify-mint/{mint}` carries the same `lookalike`.
- `GET /sources/{id}/preview` carries `projection`. The fraction limits are in `shareLimitsText()` (rules.ts): 0.01 to 0.25 for a rule
  that repeats, up to 1.00 for a one-shot.
- Every place a title regex is evaluated (the Kalshi and Polymarket readers, the registry) runs it through `safeRegexTest`: a refused
  pattern never runs, and the title is cut to 300 characters.

## The end-sink picker (API 1.17.0, 2026-10-13)

When a rule ends on a result, the rest of the burn pool leaves the coin. A new launch picks where it goes:

- `$DEFICIT's burn`: `onEnd: { windDownDays, sweepThresholdLamports, endSink: true }` (what a rule sent without `onEnd` gets).
- another live coin's burn: the same with `mint` and `ticker` from `GET /sinks`, for example
  `onEnd: { windDownDays: 28, sweepThresholdLamports: 50000000, endSink: true, mint: "<mint>", ticker: "LAD" }`. The program pins it at
  creation (end.rs `END_SINK_MINT`). If that coin is not live when the rule ends, the rest goes to $DEFICIT's burn instead; the review's
  `end.result` and the coin's description both say so ("the rest goes to $LAD's burn; if $LAD is not live then, to $DEFICIT's burn").
- a winner-takes-the-burn pair keeps the pair winner (`mint` is refused there), and a pair's other side is never in the list.

`POST /launch/review` and `POST /launch/bundle` refuse a `mint` that is not in the list (`end-sink-coin`: a coin that is not live on this
network, this coin itself, or its pair partner) in a plain sentence. An independent pair's second coin (`companion.rule`) picks its own.

A coin never burns itself on its losing path (owner rule, 2026-10-13). A new rule that could carry an end sink and ends on the wind-down
alone (`onEnd` without `endSink`) is refused (`end-self-on-loss`). Burning the rest on the coin itself stays only on the winning path: a
champion-path team coin whose team wins the title, or a one-shot that fired. Rules made before this are untouched.
