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
curl -s "$API/tokens/BRONCO" | jq '.status.next'                          # next possible burn + implied chance (display only)
curl -s "$API/tokens/BRONCO/verify/KXNFLGAME-26SEP27LARDEN-DEN" | jq '.verified, .checks'
```

## 2. Endpoints

| Method | Path | Cache | Bucket | What |
|---|---|---|---|---|
| GET | `/catalogue` | 300 s | read | every source with kind + tier, launchability, last fixture reading, preview, and the public selection config (header *values* withheld) |
| GET | `/sources/{id}/preview?fractionOfPool=&tokens=` | 300 s | read | what a catalogue rule would have burned over the source's frozen fixture |
| GET | `/kalshi/search?q=&category=` · `?series=` | 60 s | heavy | live Kalshi series search with refuse-list verdicts, plus event-level hits (`events`, `ranking`: events first when the query names a team or a market); one series with its open markets (prices display only) |
| GET | `/kalshi/events?q=&series=&status=` | 60 s | heavy | event-level search — games, contests, people: event title / ticker / market labels, with a team-alias table (eagles / philadelphia / PHI; jaguars / jacksonville / JAC / JAX); `?series=` alone lists its upcoming events; no parameters → the league chooser. Two-team games carry both sides and both selector modes (this game only = one market, side B inverted; every game = each side's own-leg filter). Events cached 10 min per series |
| GET | `/kalshi/teams?series=` | 60 s | heavy | the team picker for a game series (team coins): every team, its next game, its record since the season started, its own-leg filter (`-PHI`) |
| POST | `/kalshi/backtest` `{ rule, months? }` | — | heavy | the back-test on the venue's own settled history, the matched markets, the canonical text and hash |
| POST | `/rules/validate` `{ rule, ticker? }` | — | read | `canonical` (the exact bytes `rules.json` holds), `sha256`, `statement`, `receiptFormat`; 400 lists every problem |
| POST | `/launch/bundle` | — | write | unsigned base64 transactions + the review payload the wizard shows; registers a DRAFT unless `register: false`; never signs |
| POST | `/launch/confirm` `{ mint, signature }` | — | write | the landed launch transaction takes the draft live; settlements after this moment count (409 once the draft has expired) |
| GET | `/tokens?status=&limit=&offset=` | 30 s | read | the registry: status (`draft` / `live` / `paused` / `retired` / `expired`), rule hash, receipt and burn counts (no network calls) |
| GET | `/tokens/{ticker}` | 30 s | read | `status` (supply, burned, pool, `next` = next possible burn + implied chance), `receipts`, `readings`, exact `rulesText`; `{ticker}` may be the mint |
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
ticker or mint is taken, 502 if Kalshi is unreachable. **A draft reserves its ticker for 24 hours.** Confirm the launch within that window. After it, the draft becomes `expired`: the row stays, the ticker is free for anyone, and confirming is refused, so build a fresh bundle. Mainnet is refused until the program and the LaunchLab adapter are live.

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
| heavy | 20 burst, 20/min sustained | Kalshi search and back-test, verify (these call Kalshi or re-read a source) |
| write | 10/hour | launch bundle, launch confirm |

Every response carries `RateLimit-Limit` and `RateLimit-Remaining`. A 429 carries `Retry-After` (seconds). The limiter is in
memory on the one app process. Be polite: the read routes are cacheable, Kalshi itself is cached server-side (series 1 h, settled
5 min, open 1 min), and `subscribe()` defaults to a 15 s poll.

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
the SDK's `verifyReceipt` repeats all of them on your machine: Kalshi re-read from Kalshi, feeds re-read through their published
config, spend recomputed with the exact integer formula, and the memo read from the transaction itself. See [sdk.md](sdk.md) §5.
