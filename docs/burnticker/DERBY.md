# Burn Derby — design note (2026-10-10)

Owner-approved 2026-10-10 ("build it all"). Rivalry pairs index two coins to opposite outcomes of one selector. Burn Derby adds a
selector kind: **the relative performance of two existing coins over a window**, and the products on top of it — coin-vs-coin pairs,
a one-shot "flippening", single-asset rules (the coverage audit's Financial-markets primaries), and brackets ("tournaments"). Code:
`src/lib/burnticker/derby/`. Tests: `test/burntickerDerby.test.ts`, `test/burntickerDerbyBracket.test.ts`.

## 1. The selectors (the rule's `derby` block, locked by the rule hash)

| `selector` | What a window settles | Rule kind | Pairs? |
|---|---|---|---|
| `coinvs` | coin A's % change (or market-cap change) vs coin B's over a UTC day (00:00 → 00:00) or week (Monday → Monday): YES = A wins, NO = B wins, an exact tie = void | binary (side A `onYes`; side B derived by inversion) | yes |
| `coinvs` + `flip: true` | one-shot: YES on the first window that ends with A's size (circulating supply × value) above B's; NO when the season ends without it | binary | yes |
| `price` | one asset's % change over the window (a coin, a stock or fund, an FX rate, a metal, a commodity), counted in units of `unit` percentage points | scalar, baseline 0, `up` / `down` | yes (side B counts the other direction) |
| `bracket` | the fan coin's points for the day in its current match: 1 for a win, 2 in the final, 0 for a loss; a tie = void | scalar, unit 1, baseline 0, `up` | no |

`series` is derived from the block (`derbySeriesId`): `coinvs:<A>-<B>:<daily|weekly>:<pct|mcap>[-flip]:<10 hex>`, `price:<SYM>:<window>:<10 hex>`,
`bracket:<tournament>:<slot>`; the hash covers the two underlyings, the window, the measure and the flip flag (and the season, only for
a flippening), so pairs on the same matchup share one reading stream and each token counts only its own season's windows
(`derby/season.ts`). Each underlying is `{ symbol, pyth, mint, pool, cross }`: the Pyth feed id (primary), the Solana mint (needed for
`mcap` and the flippening), the deepest SOL pool (the TWAP fallback when there is no Pyth feed) and the cross-read locator.

**Pair semantics (the owner's choice):** the coin on the WINNING side burns `fractionOfPool` (the owner chose the winning side; it is a supply rule, nothing is paid to anyone). A tie burns neither
and still posts a receipt (a void receipt on both sides).

## 2. Where the values come from

**Primary: Pyth.** Two routes to the same signed data:

1. **Hermes (Pyth's designed pull path), with a key.** For a boundary `t` (unix seconds):
   `GET https://hermes.pyth.network/v2/updates/price/<t>?ids[]=<feed id>&encoding=base64&parsed=true` — one request per (feed, boundary);
   the update is used when its `publish_time` is at or after `t` and within 60 s, with `conf` ≤ 2% of the value. The update BYTES
   (`binary.data`, the accumulator update Pyth's receiver program verifies) are stored in `derby_points`; their sha256 is the reading's
   proof input. The display card uses `GET …/v2/updates/price/latest?ids[]=<feed id>&encoding=base64&parsed=true`. The catalogue
   (`GET …/v2/price_feeds`, 1,883 feeds on 10-10) is cached in `config/burnticker/fixtures/pyth/feeds.json` (symbol, id, asset_type).
   **Measured 2026-10-10:** the catalogue answers keyless; every price-update path (`/v2/updates/price/latest`, `/v2/updates/price/<t>`,
   the stream, `benchmarks.pyth.network/v1/updates/price/<t>`) answered **401 unauthorized** to a keyless client, and the parameter must be
   `ids[]` (`ids=` is rejected with 400). So Hermes is used only when the host sets `BURNTICKER_PYTH_API_KEY` (sent as a bearer token,
   never logged; `BURNTICKER_PYTH_HERMES_URL` overrides the host). The test fixture `fixtures/derby/hermes.synthetic.json` is therefore
   synthetic, in the documented v2 shape, and says so.
2. **Pyth on Solana, keyless (the default).** Pyth sponsors a `PriceUpdateV2` account per major feed at the PDA `[shard 0, feed id]` of
   `pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT`, written by the receiver program `rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ` after it
   verifies the Wormhole-signed update. Any RPC reads it (`BURNTICKER_DERBY_RPC_URL`, else the public mainnet RPC). It holds the latest
   value only, so the keeper snapshots it after each boundary (slot, the account bytes' sha256, the decoded message): crypto uses the
   first snapshot published at or after the boundary within one hour; market-hours feeds (stocks, FX, metals, commodities) use the last
   value published by the boundary (at most 4 days old — a closed market is a 0% window). WIF, SOL, BONK, AAPL, SPY, EUR/USD and XAU had
   accounts on 10-10; SHIB/USD did not (an EVM-native coin needs Hermes).

**Fallback primary: the pool TWAP** for a coin with no Pyth feed (e.g. GIGA): the time-weighted mean of the coin's deepest SOL pool's spot
ratio over the hour before each boundary, from the two vault balances (Raydium CPMM through `src/lib/burnReceipts/cpmm.ts`, protocol and
fund fees excluded; PumpSwap with its signed i128 quote offset at byte 245), ≥ 3 samples, × Pyth SOL/USD at the boundary. The proof
lists the pool, every sample's slot and both raw balances. Meteora pools are not read (dynamic fees, bin liquidity) and are refused.

**Primary of last resort: RedStone's signed packages** (coordinator follow-up, 10-10) — for a coin with no Pyth sponsored Solana account,
no Hermes key on the host and no Solana pool for the TWAP (the SHIB case). The underlying names a RedStone feed (`redstone: "SHIB"`); the
keeper snapshots the keyless gateway `https://oracle-gateway-1.a.redstone.finance/data-packages/latest/redstone-primary-prod` after each
boundary (packages signed at most 5 minutes before the boundary). Every package is serialised exactly as RedStone signs it (feed id
bytes32 ‖ value × 10^8 uint256 ‖ timestamp 6 bytes ‖ value size 4 bytes ‖ count 3 bytes), its secp256k1 signature is recovered over
keccak256 of those bytes, and it counts only when the signer is one of the five redstone-primary-prod nodes RedStone publishes (npm
`@redstone-finance/oracles-smartweave-contracts@0.8.0`, `redstone-oracle-registry/initial-state.json`). The value is the median of ≥ 3
distinct verified signers; the proof keeps every package (signer, timestamp, value, signature) and their sha256 — **signatures verified**.
Its cross-read must be another operator: DexScreener on the coin's home chain (a curated contract table,
`config/burnticker/derby-home-chains.json` — never a symbol search, which returns copies with inflated liquidity) or Jupiter. The order
of preference everywhere (keeper and preflight): Pyth's Solana account → Hermes (with a key) → the Raydium / PumpSwap TWAP → RedStone.
On 10-10 the gateway priced SHIB, PEPE, DOGE, WIF, BONK, FARTCOIN, TRUMP, SOL, BTC, ETH, AAPL, XAU and EUR, not GIGA, SPX6900, POPCAT or SPY.

**Cross-read (an independent operator, snapshotted within 15 min of each boundary):** Jupiter's price API
`https://lite-api.jup.ag/price/v3?ids=<mint>` (the brief named `api.jup.ag/price/v2`: it answered 404 on 10-10), DexScreener
`https://api.dexscreener.com/latest/dex/tokens/<address>` (EVM-native coins), RedStone's keyless gateway
`https://oracle-gateway-1.a.redstone.finance/data-packages/latest/redstone-primary-prod` (the median of the valid-signature packages;
FX, equities, metals, oil and coins such as SHIB). The existing Birdeye / DexScreener adapters belong to the private trading tree and are
not imported; these are small public readers.

## 3. The decision (pure, exact decimals — `derby/measure.ts`)

- % change = (end / start − 1) × 100, 6 decimals truncated toward zero; `mcap` = the change of value × circulating supply (the mint's
  supply, snapshotted at the boundary).
- **Margin** = A's change − B's change (percentage points). > 0 YES, < 0 NO, = 0 void.
- **Withheld** when the cross-read's margin differs by more than **2 points** (single asset: its change; flippening: the size ratio, 2%),
  when a cross-read snapshot is missing, or when a primary value is missing or out of bounds (late / early / wide confidence / too few
  pool samples). Withheld = no reading, no burn, an ops alert (`derby-withheld`), and the window is never read again.
- Each window is decided ONCE (`derby_windows`, append-only by trigger); the registry reading is derived from the stored decision, so a
  re-read can never mint a second event. The event id is `<window>:<first 16 hex of the proof sha256>`; the reading's `proof` is
  `derby:sha256:<hex>` (the canonical proof document: both sides' boundary values with their update hashes / account hashes / pool
  samples, the cross-read snapshots, the margins).

## 4. From a decision to a burn

1. The keeper's sampler (`DerbyAdapter.sample`, before each fetch) takes the boundary snapshots.
2. `fetchDue` → `DerbyAdapter.settledSince` decides closed windows (15 min after the boundary) and returns settled events.
3. `planToken` runs the unit engine: side A gets 1 unit on YES, side B on NO (`invertMapping`), voids burn nothing.
4. The counter attestation (`submit_reading`) for the day carries the window's proof hash as **`proof=`** in the quorum-signed
   `BURNRECEIPTS-v3|…|src=…|proof=…` message (multiKeeper → `ProgramPort.buildReading({ proofHash })` → `attestReading` /
   `submitReadingIx`); `src=` commits to the event ids (which carry the proof digest too).
5. `crank_buyback` (or `crank_vault`) burns on chain; the receipt records the program's amounts.
6. The planning pass (`DerbyAdapter.plan`, after each cycle) retires coins whose season ended, whose flippening settled, or whose bracket
   slot lost — never over receipts still to execute.

The day post (`derby/post.ts`): `Day 12 · WIF 7 – SHIB 5 · $TEAMWIF burned 1% · receipt 5h3K…`, the two communities' @handles (Jupiter's
token list or the coins' registry links), the scoreboard link, the pair disclaimer; lint-clean; no odds, no predictions.

## 5. Brackets

`Tournament = { id, title, underlyings (8 or 16, bracket order), start, roundDays (default 7), fractionOfPool }`, locked by its
canonical JSON's sha256 (`registerTournament`; `scripts/burnticker-derby.mts create|show|fan-rule`). Each fan coin's rule names
`{ tournamentId, tournamentSha, slot, underlying }`. Every day of a round each live match is one derby window (daily % change, Pyth,
cross-read, withheld on disagreement); decisions are stored under the match key (`derby:bracketmatch:<id>:r<round>m<match>`) so both
fan coins read the same one. A round's winner has more winning days; tiebreak: the larger compounded % change over the round's
decided days, then the lower slot. The loser's fan coin retires (no further readings; its page says so). The final's winning days burn
**two units** — the program compounds them, pool × (1 − (1 − f)²) — while 2 × f stays within the rules' 10% maximum; above it the final
pays one unit. Nothing on chain changes: scheduling is the keeper's planning pass.

## 6. Both or neither (every rivalry pair, owner decision 2026-10-10)

Every pair created from now on carries `pair.clause = "both-or-neither"` and `pair.voidBy` in both sides' canonical rules. Event burns
apply only once BOTH coins have a registered pool (the TokenConfig names its CPMM pool): settlements read before that are `pending-pair`
receipts, promoted to `planned` (and executed in settlement order) the cycle the second pool registers. If either side is unregistered
when the `voidBy` UTC date ends, the pair voids (`pair_outcomes`, append-only): pending receipts become `voided` (final), no event burns
on either side ever again, and the rule has ENDED — each pool winds down under `onEnd` (§6a). `voidBy` defaults to a one-shot's first
settlement date (a Kalshi close, a Polymarket end date, a flippening's last season day), else 30 days after launch. A voided derby is a
no-contest. Pages show the state (`live` / `waiting-on:A|B` / `voided`), the void date and both bonding curves side by side; the pair
post says "Pair live" or "Pair voided — both pools wind down over four weeks". A rule never ends while its pair still waits.

## 6a. No burn pool is ever left behind (owner decisions 2026-10-10)

- **`onEnd: { windDownDays: 28, sweepThresholdLamports: 50000000 }`** is in every new rule's hash (`prepareLaunch` adds it to a rule
  sent without one; the SDK adds the same default and re-checks the bytes). When a rule ENDS for any reason — a one-shot resolved NO or
  void, a pair voided, a derby season over, a flippening settled, a bracket coin knocked out, or an adapter's explicit mark
  (`registry.markRuleEnded`: a team's season over, a nominee replaced) — the keeper records it once (`rule_ends`) and, from the first day
  after the end, attests a daily `clock` reading of `windDownUnits(f, 28)` units of the rule's own fraction: the smallest n with
  (1 − f)^(28n) ≤ 1 % (17 units a day at 1 %, 2 at 10 %, 1 at 100 %), so ≥ 99 % of the pool is spent in 28 days before the per-crank cap;
  the 2 %-of-reserve cap carries the rest day by day and the $1 floor stops the tail; then the coin retires. Each clock day's
  attestation carries `proof = sha256("clock|<YYYY-MM-DD>|<rules sha256>")` — date-based and recomputable by anyone. Receipts: kind
  `winddown`.
- **One-shot YES → 100 %.** A one-shot mapping may be `fractionOfPool` ≤ 1.00 (recurring rules stay ≤ 0.10). The program accepts
  `fraction_per_unit_bps` up to 10,000 (`initialize_token` validate_rule: 1 ≤ bps ≤ BPS_DENOMINATOR) — no program change. A crank needs a
  reading with units and spends at most 2 % of the pool's WSOL reserve, carrying the rest, so after the YES the keeper attests one `drain`
  unit a day (each one's rule spend is exactly the whole pool: 1 − (1 − 1)^1 = 1) while the program's last crank still carried spend;
  then the coin retires. Every amount is the program's, on the receipts.
- **Retired-coin sweep.** A retired coin's fee PDA keeps receiving the post-graduation creator fee (71.25 bps on mainnet CPMM tier 9 since 2026-10-12, 4.75 bps on tier 0; and 80 % of its locked LP's fees, by claim_lock_fees); when its spendable balance
  passes `sweepThresholdLamports` the keeper attests one `sweep` reading of full-spend units (≥ 99 % in one reading), continued daily while
  the cap carries spend, at most one sweep start per 7 days. The coin page shows "retired · swept <date> · pool ≈ 0" and every coin page
  "creator fees → burn pool → burned; LP locked forever, its fees → 80% burn pool / 20% operator (fixed in code)." The permissionless `sweep_retired` instruction is queued
  (PROGRAM-UPGRADE-QUEUE.md §1).
- **Outcome sets** (`set: { id, outcome, forwardBps }`, opt-in, in the hash): the forward-to-winner design is queued
  (PROGRAM-UPGRADE-QUEUE.md §2); until it exists the whole leftover winds down on the coin itself, and the description says so.

## 7. Refusals at launch (`derby/admission.ts`, then the creation preflight)

An underlying that is a Burnticker platform coin (any registry token by mint or ticker, or `config/own-tokens.json`); a symbol the refuse
list matches; a Pyth id not in the catalogue, or (coin-vs-coin) not a Crypto/USD feed; no Pyth feed and under **$250,000** of liquidity;
the same coin twice; a season that starts before the next 00:00 UTC; a bracket slot that does not match its registered tournament, is
already taken, or a tournament that has started. Then the coverage gate's preflight (`coverage/preflight.ts`, strict by default) reads
each coin's primary and cross-read in the same minute and refuses on an unreadable source, a missing cross-read or a gap above 2%.
Pyth's US index feeds (`Equity.Index.US500/US30/US100`) are excluded unless `BURNTICKER_INDEX_PROXIES_ENABLED=1`.

## 8. Positions recorded

- **Pyth terms.** Pyth's on-chain feeds are permissionless to read. The pyth.network website's terms forbid scraping the website — we do
  not: we read Hermes, Pyth's designed pull path for its signed updates, and the on-chain accounts. The price-feed disclaimer carries no
  commercial-use restriction. Keys, when used, are the host's own.
- **RedStone terms.** RedStone's website Terms of Use (dated 2023-05-15) cover the website's content; RedStone publishes no API terms; the
  oracle gateway is its documented public pull path for signed data packages, and we verify each package's signature rather than trust
  the transport. Open item: confirm with RedStone (dev@redstone.finance) that settling coins on the public gateway is within their intent.
- **Index licences.** Burnticker never names the S&P 500, the Dow Jones Industrial Average or the Nasdaq-100 (trademarks licensed for
  financial products). SPY, QQQ and DIA are fund tickers and may be used as fund tickers. Pyth's US index proxy feeds stay behind the flag.
- **Our coins' own trading is never an input.** A derby's inputs are OTHER coins' published feeds; the copy lint admits "WIF out-gains SHIB"
  and "WIF's market cap passes SHIB's" only for symbols that are not `$TICKER`s.

## 9. Deferred — NOT built

**"Communities burn their own tokens into the receipt program to add to a score."** Rejected for now: it would let anyone buy a derby
outcome with tokens, opens a deposit path into the receipts program (whose design has no withdraw and no third-party deposit of the
coin), turns the score into a function of whoever spends most, and widens the attack surface (wash deposits, flash-borrowed tokens, a
second mint impersonating a community). The score stays a function of the published feeds alone.

## 10. Open items

- The wind-down, drain and sweep are keeper-driven clock readings today; the permissionless `sweep_retired` and `forward_to_winner`
  instructions are queued (PROGRAM-UPGRADE-QUEUE.md). A vault-mode rule has no pool to wind down.
- Hermes needs a key on this host; until one is set, a coin without a sponsored Solana account (SHIB) is read from RedStone when its
  rule names a RedStone feed, else its pair is refused by the preflight.
- RedStone terms: the API question to dev@redstone.finance is open (§8).
- Cross-reads are spot reads snapshotted by the keeper; a keeper that misses a boundary withholds that window (no historical cross-read).
- Meteora pools are not read; a TWAP coin whose deepest pool is Meteora is refused.
- Interest-rate feeds have no keyless independent cross-read: listed as primaries without one (the preflight refuses a rate rule).
- The wizard tile launches coin-vs-coin pairs; single-asset rules and bracket fan coins launch through the API (`POST /v1/launch/bundle`)
  and `scripts/burnticker-derby.mts fan-rule`.
