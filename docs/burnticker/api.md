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
| GET | `/search?q=` | 60 s | heavy | the universal search (API 1.4.0): describe the event → ready-made rules from every enabled source — ESPN teams and their next game, NWS stations ("Detroit high above 90"), first-party feeds, Polymarket election races and markets (named outcomes only), Kalshi only when enabled, the Coin vs Coin tile; each card carries the complete rule, the venue, who settles it, when, and how; no prices, odds, volume or liquidity |
| GET | `/elections?type=&state=` · `/elections/pair?slug=&a=&b=` | 300 s | heavy | Elections & Politics: race type → state → race → named outcomes (unnamed placeholders hidden), each with a ready one-shot rule settled on the on-chain payout and the state's certified-results publisher as the cross-read; the election-pair template (FEC beats + winner per side; pending gates listed). 503 with Polymarket discovery off |
| GET | `/sports/teams?league=&q=` · `/sports/games?league=&q=` | 300 s | heavy | the ESPN scoreboard pickers: a league's teams with next game, record and `espn.team:` selectors; upcoming games with each side's one-game `espn.game:` loss selector (a matchup = two coins) |
| GET | `/browse` · `?category=&q=` | 300 s | heavy | browse every source by Burnticker category (`config/burnticker/categories.json`: sports, politics, economics, financials, weather, science, culture, crypto, companies, health, world): one `SourceCard` per source — first-party feeds first, then the Polymarket tag's open events, then Kalshi series while `BURNTICKER_KALSHI_ENABLED` is on — with venue + tier, cadence, next event (or last reading), the "burns when …" `example`, launchability, refuse-list verdict and the `pick` (selector) to use; `venues` says what this host serves |
| GET | `/kalshi/categories` · `?category=&tag=&q=&limit=&offset=&events=&polymarket=` | 300 s | heavy | browse like Kalshi (API 1.2.0): no parameters → Kalshi's categories exactly as its API reports them (`/search/tags_by_categories`), each with its tags, series count and the Polymarket tag it maps to; `?category=` → that category's series, most traded first (volume orders, never shown, never a rule input), each with `kindHint` (yes/no or a settled number), a one-line `example`, the refuse-list verdict and — for the first `events` (≤ 24) — the upcoming-event summary (open count, next event + close, `ladder`); plus the matching Polymarket tag's open events (`polymarket: 0` skips). Drill down with `/kalshi/events?series=` |
| — | rules since 1.4.0 | — | — | a rule sent without `onEnd` gets `{ windDownDays: 28, sweepThresholdLamports: 50000000 }` (no burn pool is ever left behind — the hash in the response covers it; `@burnticker/sdk` adds the same default); a one-shot mapping may be `fractionOfPool` ≤ 1.00; `set: { id, outcome, forwardBps }` is the opt-in outcome-set field |
| GET | `/derby` | 30 s | read | Burn Derby (API 1.4.0; docs/burnticker/DERBY.md): every bracket and coin-vs-coin pair from the registry — score, season, page links |
| GET | `/derby/{id}` | 30 s | read | a bracket (rounds, matches with day strips, who advanced and why, retired fan coins, the champion) or a derby pair's block (score as a receipt tally, the day strip with both readings and proof links, the season end, the latest day post) |
| GET | `/derby/search?q=&assets=` | 60 s | heavy | coins for a derby: Pyth's catalogue (crypto; `assets=all` adds equities/funds, FX, metals, commodities; US index proxies only behind `BURNTICKER_INDEX_PROXIES_ENABLED`) + Jupiter's token list, each hit with the underlying a rule locks (feed, mint, cross-read) or why it cannot be used |
| GET | `/coverage` | 600 s | read | the settlement-coverage matrix (API 1.3.0; `src/lib/burnticker/coverage`): per Burnticker category and selector kind, the primary sources, their independent cross-reads (the same `fact` from another operator on another domain), each one's 90-day dry run (expected vs produced readings, median latency, disagreement) and the verdict `settleable` / `adjudicated-only` (Polymarket) / `uncovered`; offline from the frozen fixtures, cached; `docs/burnticker/SETTLEMENT-COVERAGE.md` is rendered from the same object. Kalshi is never an input |
| GET | `/kalshi/teams?series=` | 60 s | heavy | the team picker for a game series (team coins): every team, its next game, its record since the season started, its own-leg filter (`-PHI`) |
| POST | `/kalshi/backtest` `{ rule, months? }` | — | heavy | the back-test on the venue's own settled history, the matched markets, the canonical text and hash (a Polymarket rule sent here is back-tested the Polymarket way) |
| GET | `/polymarket/search?q=&status=` | 60 s | heavy | Polymarket (Gamma) search by text, event slug or condition id: events with their binary markets (`yes` / `no` = the first / second outcome; each a one-shot selector), the event as `event:<slug>`, the tags seen as `tag:<slug>` / `tag:<slug>/moneyline`; refused events marked; no prices, odds or volume; `status` open (default) / closed / all |
| POST | `/polymarket/backtest` `{ rule, months? }` | — | heavy | a Polymarket rule (`rule.oracle` must be `polymarket`) back-tested on Gamma's closed markets; `scanComplete: false` says where a dense selector's scan stopped. Display-grade: the keeper reads every result from the Polygon payout vector |
| POST | `/rules/validate` `{ rule, ticker? }` | — | read | `canonical` (the exact bytes `rules.json` holds), `sha256`, `statement`, `receiptFormat`; 400 lists every problem |
| POST | `/launch/bundle` | — | write | unsigned base64 transactions + the review payload the wizard shows; registers a DRAFT unless `register: false`; never signs. Since 1.3.0 the selector's creation **preflight** runs first (primary + independent cross-read, or the Polymarket payout vector + Gamma) and a failure refuses the bundle (400 `code: "preflight"`, or 502 when a read failed) with the `preflight` result attached; every Kalshi rule is refused. On success the bundle carries `preflight` (null when `BURNTICKER_PREFLIGHT_STRICT` is off on the host) |
| POST | `/launch/confirm` `{ mint, signature }` | — | write | the landed launch transaction takes the draft live; settlements after this moment count (409 once the draft has expired) |
| GET | `/tokens?status=&limit=&offset=` | 30 s | read | the registry: status (`draft` / `live` / `paused` / `retired` / `expired`), rule hash, receipt and burn counts (no network calls) |
| GET | `/tokens/{ticker}` | 30 s | read | `status` (supply, burned, pool, `next` = next possible burn + implied chance), `receipts`, `readings` (each with `sourceUrl`, `method` and, for Polymarket, `proof` = the Polygon payout locator), exact `rulesText`; `{ticker}` may be the mint |
| GET | `/tokens/{ticker}/receipts` | 30 s | read | every receipt, recomputed at request time (`verify.verified`) |
| GET | `/tokens/{ticker}/verify/{id}` | 60 s | heavy | rules / memo / source / units / spend / chain checks for one receipt |
| GET | `/trust` | 60 s | read | the Powers Register, designed fees vs the LIVE LaunchLab platform config (when the host has an RPC), program facts, statements |
| GET | `/openapi.json` | 3600 s | read | the OpenAPI 3.1 document |

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

### Polymarket rules (since 2026-10-10, API 1.1.0)

`oracle: "polymarket"`, binary only. One market: `market` = its condition id (`0x` + 64 lowercase hex). Recurring: `series` =
`tag:<tag slug>[/<sports market type>][:<event slug glob>]` (every binary market Gamma lists under the tag, optionally of one type and
whose event slug matches the glob) or `event:<event slug>` (every binary market of one event); `filter.titleRegex` matches the market
question (`tickerIncludes` is Kalshi's and is refused). YES = slot 0 of the condition = the market's first outcome ("Yes", or the
first-listed team of a game), NO = slot 1. A reading is written only once the payout vector is on chain; a 50-50 payout is a void.
Rivalry pairs work on a Polymarket market exactly like a Kalshi one-shot (side A YES, side B NO). Team coins and matchup pairs stay
on Kalshi: a Polymarket game is one market whose YES is whichever team its title lists first, with no per-team leg.

## 3. Calling it from a bot

- **GET** routes are keyless and CORS-open (`Access-Control-Allow-Origin: *`), with `Cache-Control: public, max-age=N,
  stale-while-revalidate`. Cache them.
- **POST** routes keep the repository's cross-site refusal. Send `Content-Type: application/json` (otherwise 415) and, from a
  non-browser client, `Origin: https://<host>` equal to the API's origin (otherwise 403). A browser page on another site can set
  neither, which is the point. POST routes have no CORS headers.
- Errors are JSON `{ "error", "code"?, "problems"?, "retryAfterSec"? }` and are never cached.

## 4. Rate limits

These are per client IP: the right-most `X-Forwarded-For` hop, which the platform's own Caddy appends. Each limit is a token bucket:

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
