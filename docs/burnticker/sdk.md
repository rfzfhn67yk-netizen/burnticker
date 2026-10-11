# @burnticker/sdk — build on Burnticker from a bot

Burnticker launches memecoins whose supply burns on a verifiable event — two coins on one matchup (a rivalry pair: when a side
loses, its coin burns) or one coin on one rule. Readings come from first-party primaries with an independent cross-read (Treasury,
BLS, FRED, ESPN, NWS, EDGAR, on-chain data; $DEFICIT runs on Treasury data directly) or from an on-chain Polymarket payout (the
result read from the payout vector on Polygon). Kalshi is discovery-only and off by default (its terms do not permit settlement on
its data; the launch preflight refuses Kalshi rules). Everything below works the same for every source.

Owner decision, 2026-10-09: *"no tokens will be adopted into the platform, provide the sdk/api so people can incorporate into bots."*
So there is no adopt-an-existing-token path anywhere. Instead, this TypeScript SDK (and the HTTP API it wraps, [api.md](api.md))
lets a bot do everything the launch wizard does and read everything the pages show. Public data and **unsigned** transactions only:
the SDK never asks for a key, never signs for you, never sends.

Source: `packages/burnticker-sdk/` (publishable as `@burnticker/sdk`). Examples: `packages/burnticker-sdk/examples/`.

## 1. Who this is for

**Memecoin creators.** Launch from the wizard at `/burnticker/launch`, or with one SDK call (`buildLaunchBundle`). Either way the
coin is a normal Raydium LaunchLab coin: same bonding curve, same graduation to a Raydium CPMM pool, so every trading bot, wallet and
aggregator that already supports LaunchLab coins supports yours. The only differences are on the fee side (the creator-fee slot pays
the coin's burn pool, 100%; you earn no cash from fees) and the published rule that burns supply when the event settles.

**Launch bots, Telegram launchers, agent frameworks.** `buildLaunchBundle()` returns unsigned transactions plus the review payload
the wizard shows (rule text and hash, the exact receipt format, the fee split, the allocation, what the operator can and cannot do).
Your user's wallet signs; you send; `confirmLaunch()` takes the coin live. `crank()` is public: anyone can build and submit the
burn transaction. `subscribe()` and the read calls feed announcements, dashboards and agents.

**Other LaunchLab-based launchpads.** The burn program (`burn_receipts`) does not care whose LaunchLab platform config a coin was
created under. The flow is the same three instructions under **your own** platform config: `initialize_token` (signed by the new
mint), LaunchLab's create with the coin's fee PDA (`feePdaFor(programId, mint)`) as the recorded creator, and, after graduation,
the permissionless `register_pool`. From then on `crank` is public. Only the 25 bps developer slice is Burnticker's, and it exists only
on coins created under Burnticker's platform config. One caveat: readings come from the attesters named at `initialize_token`. Either
run your own attester (the program takes generic ed25519 keys and a quorum) or register the coin with Burnticker so its keeper attests.
The low-level builders are exported: `initializeTokenIx`, `registerPoolIx`, `operatorAttester`, `planLaunch`, `buildCreateTx`.

## 2. Quickstart (a bot in 10 lines)

```ts
import { Burnticker } from "@burnticker/sdk";
import { Connection, Keypair } from "@solana/web3.js";

const bt = new Burnticker({ apiBase: "https://<host>/api/burnticker/v1", connection: new Connection("https://api.devnet.solana.com") });
const wallet = Keypair.generate();                                   // your bot's (or your user's) wallet
const launch = await bt.buildLaunchBundle({
  wallet: wallet.publicKey, selector: { series: "KXNFLGAME", filter: { tickerIncludes: "-DEN" } },
  rule: { kind: "binary", binary: { onYes: { fractionOfPool: 0.02 } } },
  metadata: { ticker: "BRONCO", name: "Bronco Burn" }, acknowledgements: { ruleLocked: true, noReturns: true } });
if (launch.ready) for (const tx of launch.transactions) { tx.partialSign(wallet); /* send it, then: */ }
// await bt.confirmLaunch(launch.mint, signature)
```

The mint keypair is generated **on your machine**. Only its public key goes to the API. The SDK re-checks the response (rule bytes
and hash, mint, creator, the fee PDA recorded as LaunchLab's creator, no extra signers), takes a fresh blockhash from your RPC, and
co-signs with the mint. Your wallet signs last. Today `ready` is `false` (the Receipts program and the LaunchLab adapter are not live,
and `pending` says what is missing), so nothing is signable on a cluster yet. The whole flow runs end to end on the fakes.

## 3. The surface

| Call | Network | What it does |
|---|---|---|
| `new Burnticker({ apiBase, connection?, programId?, cluster?, allowMainnet?, fetch? })` | — | the client; `apiBase` for platform data, `connection` + `programId` for chain work |
| `bt.catalogue()` | API | every source with its tier (1 adjudicated market … 5 page-scraped), launchability, last reading, and the public selection config a verifier needs |
| `bt.sourcePreview(id, { fractionOfPool \| tokens })` | API | what a catalogue rule would have burned over the source's frozen fixture |
| `bt.kalshi.search(q, { category })` · `bt.kalshi.series(ticker)` | API | live Kalshi series search with refuse-list verdicts; one series with its open markets (prices display-only) |
| `bt.search(q)` · `bt.elections({ type, state })` · `bt.electionPair(slug, a, b)` · `bt.sports.teams(league)` · `bt.sports.games(league)` | API | the universal search (ready-made rules), the Elections & Politics flow and the election-pair template, the ESPN team / game pickers (API 1.4.0) |
| `bt.browse()` · `bt.browse("weather", { q })` | API | every source by Burnticker category: first-party feeds, Polymarket events, Kalshi series (when the host enables Kalshi) as one `SourceCard` shape with the "burns when …" example and the selector to use |
| `bt.kalshi.categories()` · `bt.kalshi.categories("Climate and Weather", { tag, q, events })` | API | browse like Kalshi: its categories (tags, series counts, the matching Polymarket tag); one category's series, most traded first, with `kindHint`, `example`, refuse-list verdicts and (for the first `events`) the upcoming-event summary |
| `bt.kalshi.backtest(selector, mapping, { months })` | API | "settled N times in 12 months and would have burned X", plus the matched markets |
| `bt.polymarket.search(q, { status })` | API | Polymarket (Gamma) search by text, event slug or condition id: events with their binary markets (`yes` / `no` labels), the event and its tags as recurring selectors; no prices, odds or volume |
| `bt.polymarket.backtest(selector, mapping, { months })` | API | a Polymarket selector (`{ market: "0x…" }`, `{ series: "tag:nfl/moneyline", filter: { titleRegex } }`, `{ series: "event:<slug>" }`; oracle defaults to `polymarket`) back-tested on Gamma's closed markets |
| `rules.compose / validate / canonical / sha256 / lock / fromText / statement / receiptFormat` | local | the platform's own rule code: the hash you compute is the hash every receipt cites |
| `fees.split({ phase, volumeSol })` | local | the designed split (curve: Raydium 25, Burnticker 25, burn pool 50 bps; post-graduation burn pool 4.75 bps) per volume, exact to the lamport; live values via `bt.trust()` |
| `bt.buildLaunchBundle({ wallet, selector, rule, metadata, … })` | API + RPC | unsigned transactions, the review payload, `receiptFormat`, `rulesSha256`, `feePda`; mainnet refused unless `allowMainnet: true` |
| `bt.confirmLaunch(mint, signature)` | API | the draft goes live; settlements after this moment count (a draft not confirmed within 24 h expires and frees its ticker) |
| `bt.feePdaFor(mint)` / `feePdaFor(programId, mint)` | local | the burn pool: `burn_receipts` `["fee", mint]`, LaunchLab's recorded creator for every coin |
| `bt.tokens({ status, limit, offset })` · `bt.token(tickerOrMint)` · `bt.receipts(tickerOrMint)` | API | the registry list; one coin's status, receipts, `nextBurn`, `impliedChance` (display only), exact `rulesText` |
| `bt.verifyReceipt(receipt, { ticker, rulesText })` or `bt.verifyReceipt(ticker, { eventId })` | source + RPC | the full recomputation on **your** machine (section 5) |
| `bt.verifyOnServer(ticker, eventId)` | API | the same checks, run by the server |
| `bt.crank(mint, crankerPubkey)` | RPC | the permissionless crank transaction for the next attested reading, unsigned |
| `bt.subscribe(mint, onEvent, { ticker, pollMs, websocket, since })` | RPC or API | program events (decoded `emit_cpi` events) with `connection` + `programId`; otherwise receipts polled from the API |
| `bt.derby.list()` · `bt.derby.get(id)` · `bt.derby.search(q, { assets })` | API | Burn Derby (API 1.4.0): brackets and coin-vs-coin pairs; one bracket or one pair's score, day strip and proof links; coins for a derby with the underlying to lock. `derbySeriesId`, `derbySentence`, `derbySpecProblems` are exported for building a derby rule locally |
| `bt.trust()` · `bt.openapi()` | API | the Powers Register and the live fee bps; the OpenAPI document |

Lower-level building blocks are re-exported from the platform's modules, not re-implemented: `KalshiClient`, `PolymarketClient`,
`resolvePolymarket`, `readConditionResolution` (the Polygon CTF payout-vector read), `backtest`,
`unitStep`, `parseReceiptMemo`, `verifyReceiptCore`, `compileUnsigned`, `buildLaunchBundleOffline` (the platform's builder, for dry
runs on `FakeBurnProgram` / `FakeLaunchLab`), the `burn_receipts` PDAs and account fetchers, `buybackSpend`, `burnPoolFor`.

## 4. What you cannot do

- **Change a rule.** The rule is locked at launch by the sha256 of its canonical JSON. A different rule is a different token. No
  endpoint, SDK call or program instruction updates one.
- **Claim, redirect or discount a fee.** The burn pool has no withdraw instruction. The creator slot pays the burn pool, 100%.
  There are no referral codes or fee parameters anywhere in the API.
- **Adopt an existing token.** `initialize_token` must be signed by the new mint keypair, so a burn config can only be created by
  whoever creates the mint, once.
- **Sign or send through the platform.** You get unsigned transactions; your code signs and sends.
- **Launch on mainnet** until the platform says the program and the LaunchLab adapter are live. Even then, the SDK refuses mainnet
  unless you pass `allowMainnet: true`, checked against the API's cluster and your RPC's genesis hash.
- **Read a price into a rule.** Rules read settled results only. `impliedChance` is display-only.

## 5. Verifying a receipt yourself

Every burn writes a v3 memo on chain:

```
BT|BRONCO|KXNFLGAME-26SEP27LARDEN-DEN|oracle=kalshi|market=KXNFLGAME-26SEP27LARDEN-DEN|result=yes|settled=2026-09-28T…Z|src=…|value=-|units=1|pool=<lamports>|spent=<lamports>|got=<tokens>|burn=<tokens>|swap=<sig12|none>|rules=sha256:<12>|v3
```

**Receipts executed by the burn_receipts program** (2026-10-10; `docs/burnkeeper/README-execution.md` §4) carry the program's memo
instead — written by the program in the crank, for the day's reading that the receipt's units were counted into (a unit counter:
`prev`/`now` are the counter, `units` the day's total across its receipts; one crank per reading):

```
BRONCO|2026-09-28|src=burnticker kalshi:KXNFLGAME:binary|prev=1|now=2|delta=1|units=1|pool=<lamports>|spent=<lamports>|got=<tokens>|burn=<tokens>|swap=<pool12|none>|rules=sha256:<12>|v2
```

The receipt says which reading (`readingDate`) and whether it carries the reading's amounts (`lead`); the others of that day carry the
same signature and memo with zero amounts.

`verifyReceipt` runs six named checks. Each one is `ok: true` (passed), `false` (the receipt is wrong) or `null` (it could not be
checked here, e.g. no RPC was given, or the source no longer serves that period). It never counts an unreachable source as a pass.

1. **rules.** The published `rules.json` re-serialises to itself, and its sha256 starts with the memo's `rules=sha256:`. Run
   `shasum -a 256 rules.json` to get the same number.
2. **memo.** The memo parses as v3 and names the same event, units, result and value as the receipt — or, for a program receipt, it is
   the program's memo for the receipt's reading: the token's prefix, the reading date, a unit count that includes this receipt's, and
   `now − prev = units`. (The program memo has no result field; a wrong result fails the units and source checks.)
3. **source.** The settled result is re-read from the original source. For Kalshi, the verifier builds the URL itself from the event
   id (`/markets/<ticker>` for binaries, `/markets?event_ticker=` for scalar ladders) and applies the same finality rules (finalized,
   or settled plus the settlement timer). For catalogue feeds it uses the feed's own published request, parsed by its published
   selection config from `GET /catalogue`. For Polymarket it reads the market from Gamma (built from the condition id) and the
   AUTHORITATIVE payout vector from the Conditional Tokens contract on Polygon with three `eth_call`s (pass `polygonRpcUrls` /
   `polygonFetch` to choose the RPC; default: public endpoints); a market whose payout is not on chain is `null`, never a pass.
   A receipt cannot point the verifier at a URL.
4. **units.** The published rule is applied to that settled result, with the previous value and carried remainder the receipt
   states, by the platform's own unit engine.
5. **spend.** For buyback coins, `spend = pool × (1 − (1 − f)^units)` using the keeper's exact integer formula must equal the memo's
   `spent`, and `burn` must equal `got`. Program receipts use the program's own fixed-point rule spend over the reading's units; a crank
   spends at most 2% of the pool's reserve and carries the rest, so a smaller `spent` is reported `null` (carried — see the Reading
   account), never a pass.
6. **chain.** With a `connection`, the transaction at the receipt's signature exists, succeeded, and wrote exactly this memo.

`verified` is true when nothing failed and the rules and units checks passed. The receipt announcer example
(`examples/receipt-announcer.ts`) prints this result for every new burn.

## 6. The crank

`burn_receipts` processes attested readings strictly in order. Anyone can submit the crank. The program computes every amount from
the rule and the fee PDA's balance, swaps on the coin's own pool, and burns everything it bought. The cranker chooses nothing and
earns nothing: it pays the transaction fee, plus, the first time, rent for the fee PDA's two token accounts. `crank()` returns
`ready` (an unsigned transaction), `idle`, or `waiting-for-pool` (the graduated pool is not registered yet). If simulation refuses
with one of `DEFERRABLE_ERRORS` (TWAP deviation, pool not tradable), retry later. See `examples/crank-bot.ts`.

## 7. Events

With `connection` + `programId`, `subscribe()` watches the coin's `TokenConfig` address. Every new confirmed transaction is fetched
and its `burn_receipts` events are decoded from the inner instructions (`TokenInitialized`, `PoolRegistered`, `ReadingSubmitted`,
`ReadingProcessed`, `BurnPoolCapBound`, governance events). With `websocket: true`, a logs subscription triggers the fetch
immediately, and polling stays on as the fallback. Without a connection it polls the API's receipts and emits `ReceiptNew` /
`ReceiptUpdated`. `since: "now"` (the default) skips history; `since: "recent"` replays first.

## 8. FAQ

**Can I add this to a coin that already exists?** No. There are two reasons, and neither has a workaround:
1. The rule is locked at `initialize_token`, and that instruction must be signed by the mint keypair. Only whoever creates the mint
   can create its burn config, once, at creation.
2. Fees reach the burn pool only if LaunchLab's recorded creator is the coin's fee PDA from the first trade. The creator is set at
   LaunchLab create, and Raydium copies it into the graduated pool's `pool_creator`, which `register_pool` requires to be the fee PDA.

pump.fun and PumpSwap coins cannot complete the loop either: they use a different curve, a different fee-recipient model, and a
different graduation target.

**Does a launched coin need Burnticker to keep running?** Readings are attested by the keys named at init (today Burnticker's data
key, quorum 1). The crank is permissionless, and receipts are recomputable by anyone. See the trust ladder in
[README.md](README.md) §8.

**Is the SDK the same code as the platform?** Yes. It re-exports the platform's modules (`src/lib/burnticker`,
`src/lib/burnReceipts`, and six `src/lib/burnKeeper` modules). `packages/burnticker-sdk/public-closure.json` lists every repository
file it needs, and `test/burntickerSdkLeak.test.ts` keeps that list current and private-free.

## 9. Building and publishing the package

`node packages/burnticker-sdk/scripts/build.mjs` copies the import closure into `build/`, rewriting every repo alias to a relative
path, and compiles it to `dist/` (ESM + `.d.ts`). `prepublishOnly` refuses a stale closure manifest. Before the first `npm publish`,
the owner chooses the license; `package.json` says `UNLICENSED` until then. Versioning follows the API's policy
([api.md](api.md) §6): semver, additive within a major.
