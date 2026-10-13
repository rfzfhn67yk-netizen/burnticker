# Burnticker: coins that burn on real-world results, with receipts

> **Current specification, dated 2026-10-12.** This paper describes the design in the code at public commit
> [af52b4a](https://github.com/rfzfhn67yk-netizen/burnticker/tree/af52b4a4ea0b80168a4c2e0f47a32045d1035c91). It includes the decisions
> of 2026-10-11, such as the winner-takes-the-burn rule for pairs in section 5.5 and the locked-liquidity fees in section 6. Live
> deployment and readiness are not part of this paper. They are on [the trust page](https://burnticker.com/burnticker/trust) and at
> [/api/burnticker/v1/current-status](https://burnticker.com/api/burnticker/v1/current-status). Where a section states a status, such as
> the status table below or sections 9 to 11 on governance, reviews and the bounty, that status is as of 2026-10-10 and is kept for the
> record. The first draft, as it stood at the end of 2026-10-10, is archived unchanged at
> [whitepaper-2026-10-10.html](https://burnticker.com/whitepaper-2026-10-10.html).

Draft 1 of this technical paper was written on 2026-10-10 from the code and documents of the Burnticker repository at commit
`76b9caa`. This version is dated 2026-10-12. Every statement names its source file. Where a component does not exist, the paper says "not built" or "not done".

**Status on 2026-10-10, kept for the record.** The program is deployed on devnet for the rehearsal of 2026-10-10 (`docs/burnkeeper/devnet-run.md`).
Nothing is deployed on mainnet, and no mainnet key exists.

| Component | State | Source |
|---|---|---|
| `burn_receipts` program (Anchor 1.2.1) | built; 82 Rust tests and the TS suites pass; deployed on devnet, not on mainnet | `docs/burn-receipts/README.md`, `CHANGELOG.md` |
| $DEFICIT keeper and Burnticker multi-token keeper | built; run against the program in a local end-to-end test; pages run on `FakeBurnProgram` | `docs/burnkeeper/README-execution.md` |
| Devnet rehearsal | done 2026-10-10 | `docs/burnkeeper/devnet-run.md` §4 |
| Mainnet rehearsal coin | not done | `docs/burnticker/REHEARSAL-RUNSHEET.md` |
| `pair_curve` program (rivalry pairs: both coins graduate or neither; Anchor 1.2.1) | built 2026-10-10; LiteSVM suite and TS fixtures pass; devnet rehearsal run (one pair graduated to two CPMM pools and registered, one pair voided and sold back); not on mainnet; not reviewed | `docs/burnticker/PAIR-CURVE.md`, `docs/burnkeeper/devnet-paircurve-run-log-2026-10-10.md` |
| Program deployment, program id, verifiable hash | devnet: deployed 2026-10-10 (`AuQjoSgq7upmyPBv2itwy2TSZ1VjoVipyy4z9wd7zhMM`, upgrade authority a Squads 2-of-3 vault); mainnet: not done | `docs/burnkeeper/devnet-run.md` §4, `docs/burn-receipts/README.md` §5.4 |
| Team-coin and matchup settlement (sports) | Nothing is read from ESPN. Schedules come from MLB StatsAPI, the NHL feed and the NBA feed, which are free, and from TheSportsDB v2 for every other league (`BURNTICKER_THESPORTSDB_KEY` is not set yet). Each game settles on its Polymarket on-chain payout where a moneyline market exists, and otherwise on TheSportsDB's final. A game counts only when a second, independent operator agrees. The on-chain payout and TheSportsDB confirm each other, the league's official feed is used where it is free, and API-Sports is optional. | `src/lib/burnticker/sources/gameSettle.ts`, `docs/burnticker/SETTLEMENT-COVERAGE.md` |
| Second, independent attester | not built | `config/burnticker/transparency.json` (`switchboard-down`, `quorum-1`) |
| Public repository | public | https://github.com/rfzfhn67yk-netizen/burnticker |
| Operator contact | set: contact@burnticker.com; security@burnticker.com for reports | `src/lib/burnticker/fees.ts` (`OPERATOR_LINE`), `config/public-repo/overlay/SECURITY.md` |
| Bug bounty | terms drafted, not published | `config/public-repo/overlay/SECURITY.md` |
| Security firm audit | none, by decision | `docs/burnticker/decisions.md` (2026-10-09, Audit) |

## 1. Abstract

**Coins that burn on real-world results — with receipts.** Burnticker is a launchpad for Solana memecoins whose supply burns when a
settled real-world result says so. The receipt is the product. Every burn leaves a receipt that a stranger can recompute. On Burnticker, nothing is ever
won — things are only burned.

A creator ties each coin to a rule. The rule picks events from a resolution source, which is called the selector, and says how much
burns for each outcome, which is called the mapping. The source is either a primary source with an independent cross-read, or the
on-chain payout of an adjudicated Polymarket market. The rule is hashed and locked when the coin is created. When an event that the
selector picks settles, attesters sign the settled reading. The settlement program (`burn_receipts`) then spends a share of the coin's
own creator-fee pool buying the coin on its Raydium CPMM pool. It burns every token it receives. The same instruction writes a memo with
the reading, the arithmetic and the rule hash. Anyone can recompute that memo from the public source and the published rule.

The platform has two layers. The first is the engine, which is the launchpad and the program. Rules are locked at launch, readings are
signed before use, and a program runs the burns instead of a person promising them. The second layer is the show, and it is built from
the same receipts. It has team coins scored by burns, league by league. It has rivalry pairs (section 5), whose pages keep the tally. It
has Burn Derby pairs and brackets (section 5.2). A season is a scoreboard of burns. There is one per league and season, and there is
never a ranking across leagues. When a season ends, the coin with the most receipts is its league's champion. The champion is a stat,
never a recipient. No coin pays anything on any outcome.

Burnticker is run by one independent operator, reachable at contact@burnticker.com. The operator’s identity is held privately until a
legal entity is formed. Burnticker is not an investment product. A coin holds no position in any market, and the rule says what the
supply does, not what the price does. The program is not audited by a security firm.

## 2. The problem with "burn" claims today

Most token burns are statements by whoever controls the tokens. Three patterns show up again and again.

- **Operator-controlled burns.** A team wallet decides when to burn and how much. The same wallet can also sell.
- **Unverifiable triggers.** "We burn when X happens" names an event, but it names no source, unit or formula. Nobody can check that a
  burn matches the event, or that a burn was skipped.
- **Team allocations.** Burning tokens that a team got for free removes supply the market never held. The allocation also gives
  insiders a position that the burn posts serve.

Burnticker takes the trigger, the amount and the custody away from the operator, and it leaves a receipt that a stranger can recompute.
The rule is fixed before the first trade. The reading comes from an adjudicated source and is signed by named keys. The money sits in
an account that has no withdraw instruction. The program computes the amount and writes the receipt in the same instruction as the burn.

## 3. Design

### 3.1 The rule: a selector and an outcome–burn mapping

A rule is a JSON document with the schema `burnticker.rules/v1` (`src/lib/burnticker/rules.ts`). It names an oracle and a selector, and
it maps outcomes to burns. It can apply to markets that do not exist yet.

```json
{ "schema": "burnticker.rules/v1", "oracle": "kalshi", "series": "KXNFLGAME", "market": null,
  "filter": { "tickerIncludes": "-DEN" }, "kind": "binary",
  "binary": { "onYes": { "fractionOfPool": 0.02 }, "onNo": null }, "scalar": null, "pair": null,
  "onVoid": "skip", "floorUsd": "1", "reserveSol": "0.02", "vault": null }
```

| Field | Meaning |
|---|---|
| `oracle` | `kalshi`, `polymarket` (binary only) and `catalogue` are live; `uma`, `drift-bet`, `hedgehog` are parsers and stubs, not launchable |
| `series` + `filter` | every present and future market of the series whose ticker contains the text, whose title matches a regex, or both |
| `market` | one market ticker: a one-shot rule that resolves once, after which the supply is fixed |
| `kind: binary` | reads the settled yes-or-no result (Polymarket: the payout vector on Polygon; Kalshi's `result` only for coins launched on it before 2026-10-10); `onYes` and `onNo` give the burn for each outcome |
| `kind: scalar` | reads the settled number and counts `unit`s from a baseline (`previousSettlement` or a number) in a direction (`up`, `down`, `abs`) |
| `fractionOfPool` / `tokens` | buyback mode: fraction `f` of the burn pool per unit (1 % to 25 % for a rule that repeats, up to 100 % for a one-shot; rules.ts RULE_BOUNDS); vault mode: tokens per unit |
| `onVoid` | `skip`, the only policy |
| `pair` | rivalry pairs (§5): `pairId`, `side`, `counterpartMint` |

**Locking.** `lockRule` writes the validated rule as canonical JSON, with keys sorted, a two-space indent and a trailing newline. It
hashes those bytes with sha256. The hash goes into three places: `TokenConfig.rules_sha256` at `initialize_token`, the footer of the
token description, and every on-chain memo as `rules=sha256:<first 12 hex>`. No instruction changes it. A different rule makes a
different coin.

**Finality.** A Polymarket market counts once its payout vector is on chain. A primary source's period counts once the period is
complete (`src/lib/burnticker/sources/attestedHttp.ts`). Some coins were launched on a Kalshi rule before 2026-10-10. For those coins, a
Kalshi market counts when its status is `finalized`, or when it is `settled` and `settlement_ts + settlement_timer_seconds` has passed
(`src/lib/burnticker/oracle/kalshi.ts`). The rule reads only settled results, never prices. The token page shows a "market-implied chance
of the next burn", and that figure is labelled display-only.

### 3.2 Sources

**Coins settle on primary sources.** Prediction markets serve for discovery, and as optional cross-checks where their terms permit. On
2026-10-10 the owner decided that Kalshi is not a settlement input. Kalshi's Developer Agreement limits API use to a member's own
trading. Its Data Terms forbid using Kalshi data to settle products, and they forbid caching or redistributing it. A coin settles on one
of two things. The first is a primary source read together with an independent cross-read of the same fact, from another operator on
another domain. The second is the payout vector of an adjudicated Polymarket market, as Polygon's Conditional Tokens contract stores it
(section 3.4). The Kalshi adapter (`src/lib/burnticker/oracle/kalshi.ts`) remains for discovery behind `BURNTICKER_KALSHI_ENABLED`. The
creation preflight refuses every Kalshi rule.

**Polymarket binary markets are the adjudicated source.** This has been the case since 2026-10-10. Gamma
(`https://gamma-api.polymarket.com`) finds the markets. The result is the payout vector that the Conditional Tokens contract on Polygon
stores for the market's condition id, read with `eth_call`. A reading counts only once that payout is on chain, and a 50-50 payout is a
void (`src/lib/burnticker/oracle/polymarket.ts`). A single game pairs on Polymarket's moneyline market. Team coins have no settlement
route on Polymarket, because it lists the two teams in an order that changes from game to game.

**First-party feeds are the primary path.** The source list (`config/burnticker/sources.json`) holds 34 sources, four of them
cross-read-only. One generic adapter reads them all (`src/lib/burnticker/sources/attestedHttp.ts`). They include Treasury, BLS, NOAA,
Launch Library 2, JPL, Wikimedia and others. Each source has a saved fixture, plausibility bounds, a fixed unit, a direction, a baseline
and a carry. Each one also names the `operator` that runs the endpoint. Where another operator publishes the same number, the two
sources share a `fact`. Sources that need a key are present but not launchable.

**$DEFICIT is the stated exception.** The operator's own first coin reads U.S. Treasury "Debt to the Penny" (`tot_pub_debt_out_amt`)
directly. Every full $1,000,000,000 added since the previous business day is one unit. Remainders carry only across consecutive
increases. Each unit spends 2 % of the burn pool. That is the Federal Reserve's 2 % inflation goal, pointed the other way
(`config/burnkeeper/deficit.rules.json`). The devnet rehearsal coin used 1 %.

**Some topics are refused whatever the source** (`config/burnticker/refuse.json`, applied at create time). They are deaths, violence,
terror, casualty counts, disasters and named private individuals. Names that claim to be official are refused. So is any selector on the
coin's own trading, which means never the token's price. Elections are allowed.

### 3.3 Tiers: what a skeptic can verify at each

| Tier | Source kind | Admission | What a skeptic verifies | What stays trusted |
|---|---|---|---|---|
| 1 | adjudicated market (Polymarket live; Kalshi not a settlement input since 2026-10-10; Drift BET, Hedgehog stubs) | settled results only; finality window respected; voids never burn | the payout vector on Polygon (public chain data) and Gamma's report; the memo's `units` from the rule | Polymarket's adjudication (UMA); the attesters' honesty about the read |
| 2 | optimistic assertion (UMA, stub) | counts only once settled and not disputed-and-lost | the assertion's settlement on chain | UMA's dispute process |
| 3 | primary API attested by a TEE or zk job | third-party asset rates allowed from here up | the job definition and the oracle's on-chain record | not wired: Switchboard, the planned provider, ended service on 2026-09-25 |
| 4 | primary API read by the keeper | no asset rates; one real fixture; plausibility bounds; complete periods only | the exact source row with the `curl` in every receipt | the attesters (quorum 1 at launch: the operator) |
| 5 | page-scraped | owner's approval per source; regex pinned to the markup | the page and the regex | the page's editorial number and the attesters |

The table comes from `docs/burnticker/README.md` section 6 and `docs/burnkeeper/attestation.md` section 1.

### 3.4 Settlement coverage

The coverage audit (`src/lib/burnticker/coverage/`) checks every category in `config/burnticker/categories.json` and every selector kind
the wizard can emit. For each one, it asks whether a coin can be settled without Kalshi. A category is **settleable** only when it has
at least one primary source and an independent cross-read of the same fact. A primary source here means a first-party adapter that is
attested-http or on-chain, tier 4 or better, launchable, and not an aggregator. A category is **adjudicated-only** when Polymarket's
binary markets are its only route. Otherwise it is **uncovered**. Each source also gets a 90-day dry run. The dry run compares the
readings its schedule expected with the readings it produced. It measures the median delay from the end of a period to the keeper's
first sighting. It also measures how often the primary and its cross-read disagree.

On the frozen fixtures of 2026-10-10, five of eleven categories are settleable (`docs/burnticker/SETTLEMENT-COVERAGE.md`). The first is
Sports. Each game settles on its Polymarket on-chain payout where a moneyline market exists. Otherwise it settles on TheSportsDB under
its commercial license, confirmed by the league's own feed (MLB, NHL or NBA) or by API-Sports. Nothing is read from ESPN, and schedules
come from the leagues' own feeds or from TheSportsDB. The second is Economics, where four series are each checked against a cross-read.
They are `fred.UNRATE` against BLS `LNS14000000`, `fred.CPIAUCSL` against BLS `CUSR0000SA0`, `bls.eggs` against FRED `APU0000708111`,
and `treasury.debt` against FRED `GFDEBTN` at quarter ends. There were 0 disagreements in every shared month. The third is Financial
markets, where Pyth is checked against RedStone. The fourth is Weather & Climate, where the NWS climate report is checked against the
Iowa Environmental Mesonet. The fifth is Crypto & On-chain, where `bitcoin.blockHeight` is checked against blockstream.info, and Pyth
against RedStone or the pool TWAP. The other six categories are adjudicated-only, and none is uncovered. Reading a fact twice catches a
broken endpoint, a parser error or a tampered response. When the cross-read is a mirror, as when FRED republishes BLS, it does not catch
an error in the original release.

Creation first runs the selector live once (`preflightSelector`, which is wired into the launch pipeline). The primary and its cross-read
are both read. Creation is refused on a Kalshi rule, a missing cross-read, a failed read, or a disagreement on the latest shared period.
The coverage matrix is served at `GET /api/burnticker/v1/coverage`, drawn on the trust page and rendered to
`docs/burnticker/SETTLEMENT-COVERAGE.md`. The test suite fails when any category is uncovered.

### 3.5 How burns are settled

A coin settled by a market is read every 5 minutes. A coin settled by a published data feed is read on that feed's own schedule, and a
feed with no schedule of its own is read every 60 minutes. $DEFICIT reads the Treasury's debt figure at 4:30 p.m. and 8:00 p.m. New
York time on business days. A result counts only when it is final: a game when its feed marks it final, a Polymarket market only after
its on-chain payout is recorded, which follows UMA's dispute window of about 2 hours (longer if a proposal is disputed), and a scheduled
publisher's number when it is posted. The cycle that sees a final result submits the reading and runs the burn in the same pass. Before
it swaps, the program checks the pool's current rate against its average over the last 10 to 20 minutes, which a trading pool already
has. One burn spends at most 2% of the pool's SOL reserve, and the rest carries to the next burn, so a large burn arrives in slices.
Typical times after the event are about 5 to 25 minutes for sports results and scheduled data, and about 2 hours plus a few minutes for
Polymarket markets. When the transaction confirms, the receipt appears on the coin's page. The page
[How burns are settled](https://burnticker.com/burnticker/how-burns-settle) states the same facts, each number read from the code.

## 4. Settlement on chain: the burn receipts program

### 4.1 Accounts

All accounts are program-derived addresses (PDAs) of the program, keyed by the mint
(`programs/burn-receipts/programs/burn_receipts/src/constants.rs`, `state.rs`).

| Account | Seeds | Holds |
|---|---|---|
| `TokenConfig` | `["config", mint]` | the immutable rule (`RuleParams`), feed id, memo prefix and source, `rules_sha256`, params hash, attester set and quorum, any pending attester proposal, the registered CPMM pool and `pool_verified`, the pinned LaunchLab platform, the cluster genesis, and running state (last reading, carry, crank cursor, carried spend, totals) |
| fee PDA | `["fee", mint]` | a system-owned account with no data: the burn pool. It is LaunchLab's recorded creator, so creator fees land here. Its WSOL and token ATAs are the buyback's working accounts |
| `Reading` | `["reading", config, record_date u32 LE]` | one attested reading (value, prev, delta, carry in/out, units, signer mask, source and proof hashes) and its crank outcome (pool basis, rule spend, carried spend, spent, received, burned, the pool traded on). Never closed |
| vault (vault mode) | ATA(config PDA, mint) | tokens to burn; authority is the config PDA |
| `PlatformConfig` | `["platform"]`, one per program | the pre-audit burn-pool cap, its sunset, its authority, a pending raise, an optional cranker allowlist |

### 4.2 Lifecycle

```
initialize_token (mint keypair signs, once)        rule, hash, attesters, quorum; fee PDA funded with the reserve; LaunchLab platform pinned
        |
LaunchLab create with creator = fee PDA            curve trades pay the creator fee into LaunchLab's [fee PDA, WSOL] vault
        |
claim_launchlab_creator_fee (anyone)               curve creator fee -> fee PDA's WSOL account
        |
graduation -> register_pool (anyone)               only LaunchLab's own migration pool, LP burned or locked
        |
collect_creator_fee_permissionless (Raydium, anyone)   CPMM creator fee -> fee PDA's ATAs
        |
event settles -> attesters sign -> submit_reading (anyone + quorum)   Reading PDA, units by the carry rule
        |
crank_buyback (anyone; allowlist only while the cap stands)
        fee PDA SOL -> WSOL -> CPMM swap -> fee PDA token ATA -> BURN 100 % -> Memo CPI      one instruction
```

Before graduation there is no CPMM pool. Buyback readings wait in order until `register_pool` succeeds. The 30-day dead-pool rule
(section 4.9) does not apply to a pool that is not registered yet (`docs/burn-receipts/README.md` section 3).

### 4.3 `initialize_token`

Three keys sign it: the payer, the creator and the new mint keypair. The mint does not need to exist yet. So only the launcher can
create the config for a mint, and only once. The instruction records the rule, the feed id, the memo text, the rules hash, the attester
set and the quorum. It funds the fee PDA with the reserve. It enforces the swap-safety bounds of section 4.5. For buyback policy 0, it
also pins the key of LaunchLab's `PlatformConfig` account, its `cpConfigId`, and its LP lock and burn scales. It refuses a platform whose
`platformCpCreator` is set to anything other than the fee PDA, or whose scales cover less than 50 %. It takes no token program or token
account, because the program has no mint path.

### 4.4 Readings

Anyone can send `submit_reading(record_date, value, source_url_hash, proof_hash)`, but it is valid only with a quorum of attester
signatures. Each attester signs exactly these bytes (`src/attest.rs`):

```
BURNRECEIPTS-v3|<cluster genesis>|<program id>|<mint>|<feed_id>|prev=<previous date or none>|<YYYY-MM-DD>|<value>|src=<sha256(source URL), hex>|proof=<proof locator, hex>
```

The signatures travel in an `Ed25519SigVerify` instruction in the same transaction, with one shared message and one entry per key. The
program reads them back through the instructions sysvar. It requires every offset to point into that instruction, counts each key once,
and matches the message byte for byte. The message binds the genesis, the program id and the mint, so a signature is useless on another
cluster, token or deployment. It also binds the previous date, which fixes the order, so pre-signed readings cannot be reordered or
skipped. An attester set holds at most 5 keys, and the quorum is at most 3. That is the largest quorum that fits a legacy transaction,
which is 966 bytes for 1 key, 1,076 bytes for 2 keys and 1,186 bytes for 3 keys.

Dates strictly increase, and no future date is accepted. Readings are never edited, deleted or closed. Units follow the rule
(`src/math.rs`, mirrored in `src/lib/burnReceipts/math.ts`):

- On an increase, `units = floor((delta + carry_in) / unit_value)`. Under carry rule 0 the remainder carries across consecutive
  increases. Under rule 1 it is dropped.
- A reading that goes down or stays flat earns nothing and resets the carry.
- A quorum-signed reading whose change exceeds `max_abs_delta` is accepted as a RESET. It gives 0 units, resets the carry, sets a new
  baseline and emits `ReadingReset`. It never wedges the feed (review 1, M-2).

**How event rules use the unit counter.** The program's reading model is one value per UTC date. A Burnticker token is initialised with
`value_decimals 0`, `unit_value 1`, no carry and the feed id `bt.units:<TICKER>`. The attested value is a counter, defined as
`value(D) = 1 + every unit the token's settled receipts carried through date D`. The day's delta is the day's units, so one crank
covers all of a day's settlements. The signed `src` hash commits to the exact events counted, as
`sha256("burnticker://<TICKER>/units/<YYYY-MM-DD>?events=<id,id,…>")` (`src/lib/burnticker/program.ts`). The current program cannot
express a rule that pays different fractions for different outcomes, and the launch bundle refuses such a rule.

### 4.5 `crank_buyback`: swap, burn and memo in one instruction

`crank_buyback(record_date)` processes the next reading in line, which is the one where `prev_date == crank_cursor`. The cranker
supplies no amount, pool, rate or recipient. The steps run in this order (`src/instructions/crank_buyback.rs`):

1. **Pool.** The pool is `pool = fee PDA lamports − reserve + WSOL already held` (`spendable_pool`). While the pre-audit cap is in
   force, the rule is applied to `min(pool, cap)`. When the cap binds, `BurnPoolCapBound` is emitted, and the Reading keeps both the
   basis and the actual pool.
2. **Rule spend.** The spend is `spend = pool × (1 − (1 − f)^units)`, where `f = fraction_per_unit_bps / 10,000`. It is computed in u128
   fixed point as `keep = floor(pool × pow_floor(1 − f, units) / 1e18)` and `spend = pool − keep`, so the spend never exceeds the pool.
   It agrees with the keeper's exact rational result to within one lamport for pools under 10^15 lamports, and a test pins this. The
   amount due is the rule spend plus any spend carried from earlier cranks.
3. **Spend floor.** Under `floor_lamports`, nothing is bought. The reading is processed with the memo `swap=none`, and the pool keeps
   the SOL.
4. **Per-crank cap.** One crank spends at most 2 % of the pool's WSOL reserve. The rest is carried (`carried_spend_lamports`,
   `SpendCapBound`). Small, frequent swaps limit trade impact and leave less room for a sandwich.
5. **TWAP guard.** Initialisation enforces `max_twap_deviation_bps` ≤ 300 and a `twap_window_secs` of 600 to 1,200. The spot exchange
   rate (tokens per SOL) may not sit more than the deviation below the CPMM oracle's time-weighted average. The oracle records the rate
   before each swap, and only across distinct seconds, so a front-run in the same block cannot move it. A refused crank defers the burn
   day. The burn is late, not lost.
6. **Minimum output.** `min_out` is the larger of two quotes. Each quote is the constant-product output, less the pool's whole fee and
   less `slippage_bps` (≤ 300). One quote uses the live reserves. The other uses a pool of the same SOL depth at the TWAP rate. A push
   inside the same transaction lowers the first quote but not the second. So a sandwich can take at most `slippage_bps` of a spend, and
   that spend is itself at most 2 % of the reserve.
7. **Swap.** A system transfer moves SOL from the fee PDA to its WSOL account. Then a CPI calls Raydium CPMM `swap_base_input` on the
   registered, verified pool. The CPMM program id is hard-coded. The vaults, `amm_config` and the observation account are checked
   against the pool.
8. **Burn.** Every token the fee PDA holds is burned. That is what the swap delivered, plus any token-side creator fees or donations.
9. **Memo.** The program calls the Memo program through a CPI with the canonical v2 memo (section 13.4), built from the accounts alone.
10. **Events.** The program emits `ReadingProcessed` through `emit_cpi!`, and also `SpendCapBound`, `SpendCarried` and
    `BurnPoolCapBound` when they apply.

`crank_vault` is the vault-mode twin. It computes `owed = min(units × tokens_per_unit + shortfall_in, allocation_left)` and
`burn = min(owed, vault)`. The rest becomes a public shortfall carried forward, and the memo is v1. `crank_no_units` marks a zero-unit
reading as processed.

The measured cost is about 110,000 compute units in a typical case and 137,009 in the worst case. The crank transaction is 907 bytes.

### 4.6 How fees reach the burn pool

The fee PDA is LaunchLab's recorded creator. LaunchLab's `initialize_v2` takes `creator` as a non-signer, so the launch passes
`feePda(programId, mint)` there (`docs/burnkeeper/fees.md` section 1). A devnet simulation with a PDA creator succeeded and used
188,143 compute units.

- **On the curve.** LaunchLab accrues the creator fee in its vault `[fee PDA, WSOL]`, and only the creator's signature can claim it.
  Anyone can call `claim_launchlab_creator_fee`. It calls LaunchLab's `claim_creator_fee` with the fee PDA signing by seeds, and the
  recipient is pinned to the fee PDA's own WSOL account.
- **After graduation.** When the platform's `platformCpCreator` is unset, the CPMM pool records the launch creator as `pool_creator`.
  Raydium's `collect_creator_fee_permissionless` pays that creator's token accounts (ATAs). Any payer may call it.
- **Seed deposits.** Anyone can send SOL to the fee PDA. Nobody can take it out.

### 4.7 Pool registration and provenance

*Pair coins (registration policy 2, section 5.4) register through `register_pair_pool` instead. Everything below describes the
LaunchLab path, which is unchanged.*

Anyone can call `register_pool`, once. It accepts only LaunchLab's own migration pool:

1. The token's LaunchLab pool (`["pool", mint, WSOL]` under LaunchLab) records the fee PDA as creator, CPMM as its migration
   destination, and the platform pinned at init.
2. The CPMM pool is the deterministic PDA `["pool", cpConfigId, token0, token1]` of the `cpConfigId` pinned at init.
3. Its `pool_creator` is the fee PDA.
4. At least 50 % of its live LP supply is burned or held by Raydium's LP lock (`ATA(LOCK_CPMM_AUTH, lp_mint)`). This minimum sits on
   top of the provenance proof. To block registration, a griefer has to deposit more than the whole migrated liquidity and leave it there.

The mint must have no mint authority and no freeze authority. Burnticker's platform locks 100 % of graduation LP (section 6), so a
correct migration passes with margin. **One point is not confirmed yet.** It is whether the real LaunchLab migration passes the creator
through, creates the pool at the `cpConfigId` PDA, and locks or burns LP as its SDK says. LaunchLab is closed source, so this is a gate
for the devnet rehearsal.

**Stranding recovery.** If no pool can be registered, or if the registered one stays untradeable for 7 days in a row, the token's admin
may propose `set_registration_policy` to a fixed pool that passes the same creator and LP checks, plus either 90 % of LP burned or locked
or the pool PDA of a LaunchLab-known `AmmConfig`. The proposal waits 48 hours and expires after 14 days. Any one current attester can
veto it. The power ends at the pre-audit cap's sunset or at `renounce_admin`.

### 4.8 Post-CPI guards

Two instructions lend the fee PDA's signature to outside programs that can be upgraded: the LaunchLab claim and the CPMM swap. After
each one, the program checks that the fee PDA is still System-owned, with no data and the expected lamports. It checks that each
fee-PDA token account keeps its owner and mint, with no delegate and no close authority. It also checks that the swap's output vault
paid exactly what the fee PDA received. Any violation reverts the transaction (`FeeAccountTampered`, `SwapOutputMismatch`;
`src/guards.rs`). This is tested against a hostile stand-in loaded at LaunchLab's and CPMM's program ids (`mocks/evil_callee`).

### 4.9 Pool health and replacement

Anyone can call `check_pool_health`. It must be a top-level instruction, alone in its transaction with the pool. It records
observations of the registered pool being untradeable, which means swaps are disabled, the account is gone, or the WSOL reserve is under
0.01 SOL. A spell starts on the second of two observations at least 1 hour apart. It stays continuous while observations are at most 24
hours apart. After 7 continuous days, anyone can call `replace_pool` to move to a different tradeable pool that passes every
`register_pool` check. After 30 days, cranks process readings below the spend floor with the amount carried, so the queue never wedges.
A Jito bundle of separate transactions is invisible to these checks, and that gap is accepted (`pool_health.rs`).

### 4.10 Powers: what exists, with timelocks and sunsets

The Powers Register (`docs/burn-receipts/powers-register.md`) lists every power. It is generated from the IDL, and the generator fails
on any instruction or signer that has no description.

| Power | Holder | Limit | Timelock | Sunset |
|---|---|---|---|---|
| Propose attester changes | token admin (intended: the Squads vault) | quorum never lowered, never above 3; set never smaller than quorum; one proposal keeps ≥ quorum current keys and adds fewer new keys than the new quorum; kept keys vouch for added keys only after 7 days in the set | 48 h, applied by anyone | `renounce_admin` |
| Raise the burn-pool cap | platform authority (intended: the Squads vault) | raise only | 48 h, applied by anyone | cap sunset, set once at `initialize_platform`, ≤ 365 days and ≤ 2027-10-01 |
| Clear the cranker allowlist | platform authority or any listed key | clear only, never add | none | allowlist lapses at the cap sunset or 90 days after `initialize_platform` |
| Registration-policy switch | token admin | stranding only (§4.7) | 48 h, 14-day expiry, attester veto | cap sunset; `renounce_admin` |
| Program upgrade | upgrade authority (plan: Squads 2-of-3) | can replace all code | 48 h Squads time lock | set to none after review (§9) |
| LaunchLab platform admin (outside the program) | the key that created the platform | fee rates, wallets, `cpConfigId`, `platformCpCreator`, LP scales for launches not yet migrated | **none** | none: the admin cannot be transferred |

**What has no instruction.** There is no withdraw, sweep, transfer, close or set-recipient instruction for the fee PDA, its token
accounts, the vault or any program account. There is no mint, no pause or freeze, and no rule update. Nothing changes the feed, the
memo, the rules hash, the mint, the creator or the registered pool. Nothing edits or deletes a reading. There is no fee change, because
the program charges no fee. No account is ever closed, so no rent is refunded. Without a `PlatformConfig`, the hard-coded default cap
applies, which is 25 SOL until 2027-10-01T00:00Z. So a lost or finalised upgrade authority cannot wedge buybacks.

### 4.11 The pre-audit cap

While the cap is in force, each crank's basis is `min(pool, 25 SOL)`. SOL above the cap stays in the fee PDA. Only the upgrade authority
can call `initialize_platform`, and only once. It must set exactly the default, so the cap is never lowered. The cap can only be raised,
through the 48-hour timelock, and it disappears at its sunset. It protects against program bugs. It does not protect against the
operator, whose multisig can replace the code until the upgrade authority is finalised.

Every state change emits an event through `emit_cpi!`. Those events are inner-instruction data, which cannot be truncated the way logs
can, so an indexer can rebuild state. There are 34 event types, listed in section 13.3. The one exception is `PairResultSubmitted`. It
is a plain `emit!` log event, which appears as "Program data:" in the transaction's logs. `submit_pair_result` carries both coins'
attester signatures and has no room for the self-CPI accounts. The `PairResult` account it writes is the durable record.

## 5. Rivalry pairs

Two coins launch together on the same tier-1 selector with inverted mappings (`src/lib/burnticker/rules.ts` `invertMapping`,
`launchBundle.ts` `buildPairBundles`). For example, $BRONCOS burns on the NO of each `-DEN` leg of `KXNFLGAME`, and $CHIEFS burns on
the YES. $BULLS and $BEARS burn on the direction of the S&P close (scalar `up` against `down`). A binary settlement burns exactly one
side. A flat scalar settlement burns neither.

- `pair: { pairId, side, counterpartMint }` is part of each side's canonical JSON, so the link is inside both locked rules. The two
  rules are hashed separately. Side A is created first. Side B's rule names A's mint as its counterpart, and A's counterpart is held in
  the registry's append-only `pairs` table.
- Binary sides swap `onYes` and `onNo`. Scalar sides flip `up` and `down`. An `abs` rule cannot pair. Pairs must use a tier-1
  adjudicated market source.
- **The scoreboard.** The pair page shows both sides, the burn tally, the supply burned on each side, and the receipts of both coins in
  time order. For a binary pair, the burn counts of the two back-tests add up to the number of the selector's settlements that were not
  voids.

A relative-value perpetual version was considered and rejected. The reasons were pool-depth caps, oracle manipulation and the lack of a
legal path in the US (LAUNCHPAD-PATH section 22).

### 5.1 Both or neither

Every pair created since 2026-10-10 carries a clause in both sides' canonical rules: `pair.clause = "both-or-neither"`, with a `voidBy`
date. That date is a one-shot's first settlement date, or else 30 days after launch.

- Event burns on either side apply only once BOTH coins have a registered pool. A settlement read before that is recorded as a
  `pending-pair` receipt. In the cycle when the second pool registers, the pair goes live and the waiting receipts execute in
  settlement order.
- If either side has no registered pool when the `voidBy` UTC date ends, the pair voids. Waiting receipts become `voided`, which is
  final. No event burn happens on either side again, and the rule has ended. Each coin's pool then winds down (section 5.3), once that
  coin has a pool, so no fee is stranded in a pool that can never burn.
- The outcome, live or voided, is written once to the registry's append-only `pair_outcomes` table. The pair page shows the state, the
  void date and both bonding curves side by side.

### 5.2 Burn Derby: coin against coin

Burn Derby is a selector kind for pairs. It compares how two existing coins perform over a UTC day (00:00 to 00:00) or a week. The
rule's `derby` block names both coins, the window, the measure and the season. For each coin it gives a Pyth feed id, a Solana mint, the
deepest SOL pool and an independent cross-read. The measure is either the % change, or the change of circulating supply times the feed
value. The rule's `series` is derived from the block, and the whole block is inside the rule hash
(`src/lib/burnticker/derby/spec.ts`).

- **Settlement.** A window's margin is coin A's % change minus coin B's, exact to six decimals. A positive margin settles YES, and side
  A's coin burns. A negative margin settles NO, and side B's coin burns. An exact tie is a void on both sides. The coin on the winning
  side burns, and nothing is paid to anyone. A one-shot variant settles once. It settles YES on the first window that ends with A's size
  above B's, or NO at the end of the season if that never happens.
- **Values.** For Pyth, the values come from the sponsored `PriceUpdateV2` accounts on Solana. Pyth's receiver program writes them
  after it verifies the Wormhole-signed update. They are read without a key and snapshotted at each boundary. The other option is the
  Hermes update published at the boundary, which is Pyth's pull service and needs an API key. The sha256 of its bytes becomes the proof.
  A coin without a Pyth feed is read from the time-weighted vault balances of its deepest SOL pool, priced with Pyth's SOL/USD feed.
- **Cross-read.** An independent operator (Jupiter, DexScreener or RedStone) is snapshotted at the same boundaries. If its margin
  differs from the primary's by more than two percentage points, or if a value is missing, the window is withheld. There is no reading
  and no burn, and an alert goes out. Each window is decided once and stored append-only.
- **Proof on chain.** The reading carries `derby:sha256:<hex>` of the window's proof document. The counter attestation's quorum-signed
  message carries the same hash as `proof=` (section 4.4). Its `src=` commits to the event ids, and those ids carry the first 16 hex
  digits of the hash.
- **Brackets.** A bracket has eight or sixteen coins, with one derby per match per round. A round lasts seven days by default. The coin
  with more winning days advances. The tiebreak is the compounded change over the round, then the lower seed. The losing fan coin
  retires and reads nothing more. A winning day in the final counts as two units. The program compounds them as
  pool × (1 − (1 − f)²), while two times f stays within the rules' 10% maximum.
- **Refused.** A derby refuses a Burnticker coin as an input, anything on the refuse list, the same coin twice, and a coin with no Pyth
  feed and under $250,000 of liquidity. It also refuses US index proxy feeds unless the host enables them. A coin's own trading is never
  an input.

### 5.3 No pool is left behind

Every rule created since 2026-10-10 carries `onEnd: { windDownDays: 28, sweepThresholdLamports }` inside its hash.

- **The wind-down.** A rule can end for several reasons: a one-shot resolved NO or void, a pair voided, a derby season over, a bracket
  coin knocked out, or a team's season over. When it ends, the keeper attests a daily reading from a date-based clock whose proof is
  sha256("clock|<date>|<rules sha256>"). Each day counts the smallest number of units n of the rule's own fraction f for which
  (1 − f)^(28n) ≤ 1 %. At 1 % that is 17 units a day. So at least 99 % of the pool is spent within 28 days. The 2 % per-crank cap
  carries the rest forward, and the $1 floor ends the tail. Then the coin retires.
- **A one-shot at 100 %.** A one-shot mapping may spend the whole pool. Recurring rules stay at 10 % or less. The program already
  accepts 10,000 basis points. A crank spends at most 2 % of the pool's reserve and needs a reading with units. So after the YES, the
  keeper attests one drain unit a day until the program carries nothing more. Each drain unit's rule spend is exactly the whole pool.
- **The sweep.** A retired coin's burn pool keeps receiving the post-graduation creator fee. When its spendable balance passes the
  threshold, the keeper attests one full-spend reading, at most once a week. A permissionless instruction that lets anyone do this
  without the keeper is queued for the next program review (`PROGRAM-UPGRADE-QUEUE.md`). So is forwarding a losing coin's leftover to
  the winning coin of an outcome set.

One idea was to let communities add to a score by burning their own tokens into the program. It was considered and not built. It would
turn the score into a function of spending, and it would add a deposit path to a program designed without one.

### 5.4 The pair curve: both coins graduate, or neither does

On LaunchLab each coin of a pair has its own curve, so one side can graduate while the other stalls. On 2026-10-10 the owner decided on
a second program that runs both curves of a pair together (`pair_curve`, described in `docs/burnticker/PAIR-CURVE.md`). A pair launches
through it when `BURNTICKER_PAIR_CURVE_ENABLED` is set. The setting is off by default, and single coins stay on LaunchLab. Until it is
on, pairs launch on two LaunchLab curves under the rules-level "both or neither" clause of section 5.1.

- **One account per pair.** Each pair has one account with two virtual-reserve bonding curves. By default they use pump.fun's
  constants: 30 SOL virtual, 1.073 B virtual tokens, 793.1 M sellable and 206.9 M reserved for the pool. There is one System-owned SOL
  vault. Each coin has 1,000,000,000 tokens at 6 decimals, with mint authority revoked at creation and no freeze authority. The curve is
  path-independent. After any sequence of trades the vault holds exactly `F(sold) = ceil(V_s · sold / (V_t − sold))` per side, so
  selling everything back drains it exactly.
- **The fee is 1 % of every curve trade, which is 100 basis points.** Of that, 25 basis points go to the developer wallet, which is the
  claim wallet of Burnticker's own LaunchLab platform, compiled into the program. The other 75 basis points go to the traded coin's fee
  PDA in the settlement program (`burn_receipts`). Both shares stay in the pair's vault until they are due. The 75 basis points reach
  the fee PDA when that coin's pool is created, or go back to its holders on a void. The 25 basis points are paid by a permissionless
  claim. No trade pays any other account, so no outside wallet can stop trading. There is no Raydium curve fee, no referral and no
  creator slice.
- **Graduation.** Graduation needs the combined raise to reach the pair's threshold before the deadline. Each side must hold a minimum
  share of it, which is 25 % by default and at most 40 %. Both sides must also be able to pay for their pools. The trade that meets this
  commits the pair on the spot. Both curves close, and the pair can no longer void. Each `graduate` call then creates its side's CPMM
  pool at a `pair_curve` address that nobody else can sign for. It puts in SOL and tokens in the curve's closing ratio, and it burns
  every token the pool did not need. Then anyone can call `lock_lp`, which locks 100 % of the LP with Raydium's LP lock. The Fee Key is
  owned by the fee-keys PDA of `burn_receipts`, and the LP is locked forever (section 6). Graduation takes two transactions, because
  both pools in one transaction would sit at Solana's 64-entry instruction-trace cap, and a griefer could push them over it.
- **Void.** If the deadline passes without graduation, buys close. Each coin's holders share what that side raised, pro rata. That is
  its curve SOL plus the 75 basis points held for its fee PDA. There is no fee and no advantage in leaving first. Once nothing
  circulates, the pair's accounts close. A side that Raydium still blocks three days after the commit is put into the same pro-rata
  exit on its own. So is any side still without its pool thirty days after the commit. Once the deadline has passed, nobody can leave
  along the curve ahead of the others.
- **Registration.** The settlement program gained registration policy 2 and the instruction `register_pair_pool`. It accepts only the
  pool that the pair program recorded for that mint, at its `pair_curve` address, created by the pair's vault on the pinned `cpConfigId`,
  with ≥ 90 % of the creation LP burned or locked (section 4.7).
- **Powers.** The pair program has no powers over funds. It has no admin, no parameter update and no withdraw. Its upgrade authority is
  the same Squads vault as the settlement program's, and it is to be finalised before the first public pair
  (`docs/burn-receipts/pair-curve-powers-register.md`). Two blind reviews on 2026-10-10 found five High issues in the first version. All
  of them are fixed and were re-run on devnet (`docs/burn-receipts/CHANGELOG.md`).

### 5.5 Winner takes the burn

The owner decided this on 2026-10-11 (LAUNCHPAD-PATH section 40): "the fees for both the winner and loser should burn the winner's
supply." Every pair made since then carries `pair.winnerTakesBurn: true` in both sides' canonical rules. The flag is inside each hash.
Pairs made before then keep their bytes.

- **Pairing on chain.** Two LaunchLab coins pair by naming each other in `initialize_token`. Each one passes `pair_mint`, the partner's
  `PairLink` address, which is passed every time, and `pair_void_by`. That last value is the rules' locked voidBy, the same on both
  coins. Side A is provisional until side B names it back. If that does not happen within 7 days, both stay plain coins for good, and
  the keeper raises the `pair-unmatched` alert every day in the meantime. A `pair_curve` pair is linked by `link_pair`, which anyone can
  call right after `init_pair`, with the `Pair` account as the witness. `register_pair_pool` refuses until `link_pair` has run, or after
  an unlink. `link_pair` is refused only for a voided `Pair` or a refunding side (`PairTerminal`). Both coins must have the SAME attester
  set and quorum, with the same keys in the same order. This is checked at the second `initialize_token` and at `link_pair`
  (`PairAttestersDiffer`). Periods already read when the coins pair stay as unpaired history. Both coins record this in
  `pair_after_date`. No `PairResult` may name those periods, and the crank passes them as plain periods. So a coin that read first is
  never frozen. Pairing is deliberately left out of a coin's rules hash and `params_hash`. Those are fixed at `initialize_token`, while a
  `pair_curve` pairing happens later and can be undone. The record is the chain's `pair_state` (0 none, 1 provisional, 2 paired,
  3 unlinked) and the `PairLink` accounts. A paired coin changes its attesters only through `apply_paired_attester_change`, with the
  partner's quorum co-signing the pending set. `apply_attester_change` refuses a paired coin (`PairedAttesterChange`). One risk remains,
  and it is stated plainly here. Whoever holds the common attester quorum decides every result. On Burnticker that is the operator's
  keeper alone, at quorum 1.
- **Each result.** One `PairResult` account (`["pair_result", mint_lo, mint_hi, date]`) names the winner or a draw. The winner is the
  coin whose rule the result fires. No result may name a date before the pairing day, or a date on or before `pair_after_date`
  (`PairPeriodUnpaired`). Every result needs both coins' quorums. The two coins share one attester set, so one set of signatures covers
  both; a rotation applies to both coins at once (`apply_paired_attester_change`, program round 4). A win is recorded only when both coins have a reading for the date and the loser's reading is still unprocessed. Otherwise the
  call fails with `PairResultNotServable`. There is no pool condition. When the winner had nothing to read that day, the keeper first
  attests a flat 0-unit reading for it. A draw is posted only for a true draw and needs both quorums. The loser's `crank_buyback` for
  that period refuses (`ForwardRequired`). Anyone can then call `forward_to_winner`. It moves exactly what the loser's own rule would
  have spent, which is `buyback_spend(min(spendable pool − the loser's carried spend, cap), units, f)` with the loser's units and
  fraction. The amount moves from the loser's burn pool into the winner's. Nothing below the rule's minimum spend moves. A one-shot pair
  maps 100 %, so all of it moves. The instruction writes a memo in every case, in the form
  `<LOSER PREFIX>|forward|from=<12>|to=<12>|period=<date>|lamports=N|v1`. If either coin has no verified pool, or if the pair has been
  unlinked, it moves 0 lamports and still processes the loser's reading. So a dead side can never wedge the queue. Either way,
  a lost period never burns the losing coin unless no forward lands within 72 hours, in which case it burns as a plain period and a PairForwardMissing event is published.
  If the winner is dead, the fuel stays in the loser's pool, where the loser's own later burns spend it. The loser's reading is
  processed with outcome 6 (forwarded). The winner's ordinary cranks then spend its pool on the winner's coin and burn what they get.
- **What does not happen.** The loser's supply is untouched, and nothing is paid to holders. SOL moves between two program PDAs that
  have no withdraw path. A draw or a void forwards nothing, and each coin burns its own fuel. If there is no result 72 hours after a
  reading, or if a LOST period's forward never landed within 72 hours, the coin cranks as unpaired (`PairResultMissing` or
  `PairForwardMissing`). That period can no longer forward. `forward_to_winner` is refused after the window (`ForwardWindowClosed`), so
  there is no race with the crank. At that point the planner switches from the forward to the paired buyback, and the keeper does not
  repeat the time-out. The keeper raises `pair-result-missing` 12 hours after the reading and `pair-forward-pending` 1 hour after it. It
  raises `pair-result-unservable` when a win cannot be recorded, and `pair-forward-missing` if a time-out happens. No draw is ever
  substituted for a result.
- **Unlinking.** Anyone can call `unlink_pair` to turn a pair back into two plain coins, but only on TERMINAL on-chain evidence. For a
  `pair_curve` coin, the evidence is that the `Pair` is Voided or one of its sides is refunding. The `Pair` is required evidence for such
  a coin, and an Open pair is never unlinked, however long its curve runs. For a LaunchLab pair, the evidence is that the locked voidBy
  day has ended with a coin still without a verified pool. Otherwise the call fails with `PairStillLive`. Both coins become `unlinked`
  (`pair_state` 3), and a `pair_curve` coin still registers its pool. Both `PairLink` accounts close, and their rent goes to each coin's
  burn pool. Recorded results stay as history. The keeper sends the instruction when the evidence holds. The pair page then says
  "unpaired (reason)", and later receipts carry no pair role.
- **Order.** The keeper attests both coins' readings, posts the `PairResult`, runs the loser's forward, and only then runs the winner's
  crank. That way the forwarded fuel is in the pool that the crank spends. After a one-shot pair's result, anything that reaches the
  loser's burn pool later, such as its end-of-rule burns and sweeps, forwards to the winner while the winner is live. On such a day the
  keeper attests a flat reading (0 units) for the winner, because a win needs both coins' readings for the date.
- **Receipts.** The loser's receipt shows `forwarded` with the SOL moved. The receipt line reads
  `forwarded from $LOSER: N SOL → $WINNER burn pool`. The registry keeps an append-only `pair_forwards` table. The pair page tallies four
  numbers: burned on A, burned on B, forwarded from A to B, and forwarded from B to A. The Burn Derby scoreboard counts forwarded fuel.
  On devnet on 2026-10-11 (pair 6), one forward moved exactly 79,306,876 lamports from side B to side A, and side A's paired cranks then
  burned its coin (`docs/burnkeeper/evidence/devnet-pair-forward-2026-10-11/`).

## 6. Economics

Fee dials were read from the pinned Raydium SDK, Raydium's documentation and the live config accounts (`docs/burnkeeper/fees.md`). The
designed values are in `src/lib/burnticker/fees.ts`. The table gives fees in basis points (bps). One basis point is 0.01 % of volume.

| Phase, per unit of volume | Raydium | Burnticker (developer / operator) | Burn pool (fee PDA) | Nobody |
|---|---|---|---|---|
| Bonding curve (LaunchLab) | 25 bps | 25 bps (platform `feeRate` 2,500 ppm) | 50 bps (`creatorFeeRate` 5,000 ppm, the maximum) | none |
| After graduation (CPMM tier 9: 25 bps trade fee + 75 bps creator fee) | 4 bps of trade fee (3 RAY buyback + 1 treasury) + 3.75 bps (5 % of the creator fee) | 4.2 bps (20 % of the locked LP's 21 bps, by `claim_lock_fees`) | 16.8 bps (80 % of the locked LP's fees) + 71.25 bps (Raydium's fixed 75 bps creator fee, less 5 %) | none |
| Pair curve (`pair_curve`, §5.4) | 0 | 25 bps | 75 bps | none |
| Pair coin after graduation (CPMM tier 9, public `initialize`, creator fee off) | 4 bps of trade fee | 4.2 bps (20 % of the locked LP's fees) | 16.8 bps (80 % of the locked LP's fees; public pool creation cannot turn the creator fee on) | none |

- **The LP is locked forever, and its fees fund the burn.** The owner decided this on 2026-10-10, replacing "all graduation LP is burned".
  100 % of every coin's graduation LP is locked with Raydium's LP lock (LaunchLab `platformScale` 1,000,000, creator 0, burn 0; pair
  coins through `lock_lp`). It can never be withdrawn, and the creator cannot configure it. The Fee Key NFT is owned by the
  `["fee_keys"]` PDA of `burn_receipts`. Anyone can call `claim_lock_fees`, which splits the SOL side of the LP fees by compiled
  constants. `LOCK_FEE_BURN_BPS` sends 8,000 basis points of it to the coin's burn pool. `LOCK_FEE_OPERATOR_BPS` sends 2,000 basis points
  to the operator treasury, which is the Squads vault. The coin side is burned. No admin key or config field can change the split.
  Per swap after graduation, that was about 21.55 basis points toward the burn on CPMM tier 0 (16.8 + 4.75; it was 4.75 with the LP
  burned) and 4.2 basis points to the operator. **After graduation, about 0.88% of every swap goes to the coin's burn pool and about 0.04% to the operator — 20% of the locked pool's liquidity fees. Raydium keeps about 0.08%.** On mainnet the treasury is not compiled in yet.
  Until it is, every claim refuses with `TreasuryNotPinned`, and the fees stay in the lock.
- **The Raydium pool tier is 9.** The owner decided this on 2026-10-12, replacing tier 0. The LaunchLab platform's `cpConfigId` names
  Raydium CPMM AmmConfig index 9 (`LNmHRmMvk9kmtepfTSr98kqGLThd61kH1DPWf2cVRaC`): the same 25 bps trade fee as tier 0 and a 75 bps
  creator fee instead of 5 bps. Per 1 SOL of volume after graduation, traders pay 100 bps. The burn pool gets about 88.05 bps
  (16.8 from the locked LP + 71.25 from the creator fee after Raydium's 5 % share), the operator 4.2 bps, and Raydium 7.75 bps.
  `burn_receipts` pins the platform's `cpConfigId` into each coin at `initialize_token`, so a coin keeps the tier it pinned. The vault
  changes the platform's `cpConfigId` in a separate signed step. Devnet has no matching creator-fee tier, so the rehearsal stays on its
  index 0 (25 bps trade, 25 bps creator fee). The ids and rates live in `src/lib/burnticker/cpmmTier.ts`.
- **In rivalry pairs, the winner takes the burn.** The owner decided this on 2026-10-11 (section 5.5). In a pair, fees from both coins
  burn the winner's supply. At each result, the loser's burn-pool spend for that result moves to the winner's burn pool
  (`forward_to_winner`) instead of buying the loser's coin. This changes where a pair's burn-pool SOL is spent. It does not change any
  fee rate above. No one is paid, and the operator takes nothing from a forward.
- **Creators earn no cash from fees.** The creator-fee slot pays the burn pool, 100 %, by construction, because the fee PDA is the
  creator.
- **No coin has a team allocation.** The program has no mint path. Supply is LaunchLab's fixed 1,000,000,000 at 6 decimals.
- **Seed deposits are gifts.** $DEFICIT's planned 3 SOL seed to its burn pool is disclosed and carries no claim.
- **There is no referral share** (`shareFeeRate` 0), no hidden parameter and no creator fee slice (`CREATOR_FEE_SLICE_BPS = 0`).
- **What the platform fee funds.** The fee list (`USE_OF_FEES`) says: "attesters, hosting, the audit, and the operator. The platform
  never buys back any coin, including its own." The bounty pool (5 to 10 SOL) is drawn from the same fee.
- A creator pays LaunchLab's creation cost and gas, and pays nothing to Burnticker up front.

The platform admin key can change these dials for launches not yet migrated (section 9). When the host has an RPC configured, the trust
page shows the live platform config beside the designed dials (`compareLivePlatform`).

## 7. Attestation and the trust ladder

Every attester is an ed25519 key with a kind tag (operator, zkTLS relayer or oracle), and the tag is for information only. The program
checks only signatures and the quorum. Proof checking happens off chain by design (`docs/burn-receipts/attestation.md`).

| Level | Configuration | Who could sign a false reading | Who holds the money | What remains trusted |
|---|---|---|---|---|
| 1 (launch) | the operator's keeper key, quorum 1 | the operator's key | nobody: the fee PDA has no withdraw path | the operator's read of the source; the visible, permanent record bounds the damage to wrongly sized burns |
| 2 | keeper plus an independent attester (second operator or zkTLS relayer), quorum 2 | two independent keys acting together | nobody | both attesters; with a relayer, the zkTLS provider |
| 3 | a quorum of independent operators or relayers whose proofs are public | a colluding quorum, against public proofs | nobody | the proof system and the source |

**Current status.** Level 1 is the launch design. Switchboard, the planned second signer, ended all oracle services on 2026-09-25. Its
attester was built, then removed from the program the same day (commit `f94089c5`). The candidate replacements were a Reclaim zkTLS proof of the
source response posted by a relayer key, a second human operator, or both. The second-operator signer is built in the repository and not
running (`docs/burnticker/SIGNER-TWO.md`). The relayer was set aside, because Reclaim's keys cannot sign what the program checks. The decision log names "attester two
within 14 days of the first launch", and that line is a schedule. For Kalshi, no independent on-chain attestation exists. Kalshi
publishes settlement through its own API. There were reports of Kalshi markets tokenised on Solana through DFlow, but they could not be
confirmed from a primary source (`docs/burnticker/README.md` section 8). At every level, the upgrade authority remains until it is
finalised.

## 8. Verification walk-through: recompute one receipt

Take the $DEFICIT reading for 2026-10-08. The program's own memo tests use it (`src/memo.rs`).

**Step 1, the source.**

```sh
curl -s 'https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/debt_to_penny?fields=record_date,tot_pub_debt_out_amt&filter=record_date:eq:2026-10-08'
```

The row gives `40305316210829.72`. The previous business day gave `40284036147367.19`. The attested `src` field is the sha256 of that
exact URL. Recompute it with `printf %s '<url>' | shasum -a 256` and compare it with `Reading.source_url_hash`.

**Step 2, the signature.** Rebuild the canonical message of section 4.4 from the `Reading` and the `TokenConfig`. Then check each
signature in the Ed25519 instruction of the `submit_reading` transaction against the attester keys listed in the `TokenConfig`.

**Step 3, the units.** The change is `delta = 21,280,063,462.53` dollars. With carry 0 and a $1B unit,
`units = floor(21,280,063,462.53 / 1,000,000,000) = 21`. The remainder `280,063,462.53` carries into the next reading if that reading
is also an increase.

**Step 4, the spend.** Take `f = 1 %` and a pool basis of 1 SOL (1,000,000,000 lamports). The program's fixed-point arithmetic gives
`spend = 1,000,000,000 × (1 − 0.99^21) = 190,272,132` lamports, and `buybackSpend` in `src/lib/burnReceipts/math.ts` gives the same.
Then apply the per-crank cap. If 2 % of the CPMM pool's WSOL reserve is smaller, the crank spends that, and the Reading's
`carried_out_lamports` holds the rest. The memo's `pool=` is the basis actually used, so the arithmetic checks against the memo itself.

**Step 5, the swap and the burn.** The crank transaction is itself the swap and the burn. Its inner instructions hold three steps. The
first is the CPMM `swap_base_input` from the fee PDA's WSOL account. The second is the SPL Token `Burn` from the fee PDA's token account,
and supply falls by `burn=`. The third is the Memo CPI. Check that the swap's minimum output is at least the larger of the spot and TWAP
quotes, less `slippage_bps`.

**Step 6, the memo.**

```
DEBT|2026-10-08|src=fiscaldata.treasury.gov debt_to_penny|prev=40284036147367.19|now=40305316210829.72|delta=21280063462.53|units=21|pool=<lamports>|spent=<lamports>|got=<tokens>|burn=<tokens>|swap=<first 12 chars of the CPMM pool>|rules=sha256:<12>|v2
```

`swap=` carries the first 12 base58 characters of the pool, because one instruction cannot know its own transaction signature. `burn`
can exceed `got` when donated or fee tokens were also burned. `memoFromChain()` in `src/lib/burnReceipts/` rebuilds the memo from the
accounts alone.

**For a Kalshi receipt**, step 1 is the settled market. For example,
`curl -s 'https://api.elections.kalshi.com/trade-api/v2/markets?series_ticker=KXNFLGAME&status=settled'` gives the market
`KXNFLGAME-26OCT04DENSF-DEN` with status `finalized` and `result` `no`, settled at `2026-10-04T23:41:27Z`. The saved fixture is
`config/burnticker/fixtures/kalshi/KXNFLGAME.settled.json`. Step 3 applies the locked rule to each settlement of the day, and the
counter's `src` hash commits to the event ids counted.

**The public audit.** The audit script (`scripts/burnticker-audit.mts`) recomputes every receipt of every token from the recorded
readings and the published rule. It writes `audit.json` and exits non-zero on any mismatch. It reads no key and sends nothing. Its chain
leg, which would compare each memo on chain, is not wired. The script runs with no program client and reports "chain not checked".

## 9. Governance and custody

- **The plan is a Squads 2-of-3 vault with a 48-hour time lock.** The owner holds two of its keys, and a trusted third party holds the
  third. The vault is the planned holder of the upgrade authority, the platform authority and each token's config authority. The
  program's own 48-hour timelocks come on top. The commands are in `docs/burn-receipts/README.md` section 5.2. The vault is not created
  yet.
- **Upgrade authority plan.** Deploy the verifiable build, hand the authority to the Squads vault, and after review set it to none. That
  last step is the BPF Upgradeable Loader's `SetAuthority` with no new authority, executed as a Squads vault transaction. The runbook's
  launch gate says the mainnet launch is published only after `solana program show` prints `Authority: none` and the deployed hash
  equals the published verifiable hash (README section 5.3). Until then, every "no extraction" property depends on the multisig not
  shipping a malicious upgrade.
- **The LaunchLab platform admin is disclosed and has no timelock.** Raydium's `updatePlatformConfig` has no way to change the admin,
  and the platform config PDA is seeded by the admin key. So the admin cannot be moved under Squads after creation (D-3). It can change
  the platform's fee rates, claim wallets, `cpConfigId`, `platformCpCreator` and LP scales for launches not yet migrated. Four things
  limit this. `initialize_token` pins what matters. `verify-platform-pins` re-reads the platform just before each create and refuses on
  any difference. The stranding switch covers a change between init and migration. The trust page shows the live config.
- **Cranker allowlist during the cap.** `initialize_platform` may name up to 3 keys that are allowed to call `crank_buyback` while the
  cap is in force. This guards against an outside cranker timing a multi-block TWAP hold. The list can only be cleared, by the platform
  authority or any listed key. It lapses 90 days after `initialize_platform` or at the cap sunset, whichever comes first. Readings, vault
  cranks, claims and health checks stay permissionless.

## 10. Security review history

Burnticker is **not audited by a security firm**. On 2026-10-09 the owner decided against a paid audit, in favor of independent AI
reviews, free tooling and a public bounty. Reports are published as delivered:

| Round | Report | Findings | Outcome |
|---|---|---|---|
| Blind review 1 (2026-10-09) | [2026-10-09-claude-blind-1.md](reviews/2026-10-09-claude-blind-1.md) | 2 High, 4 Medium, 7 Low, 6 Info | no extraction path found; sandwich budget (H-1) and the fee-inflow routing (H-2) fixed |
| Blind review 2 (2026-10-10) | [2026-10-10-claude-blind-2.md](reviews/2026-10-10-claude-blind-2.md) | 5 Medium, 4 Low, 8 Info | sandwich bound via TWAP quote, attester takeover, stray-lamport wedge, quorum-2 transaction size, pool squatting fixed |
| Blind review 3 and re-check (2026-10-10) | [2026-10-10-claude-blind-3.md](reviews/2026-10-10-claude-blind-3.md) | 3 Medium, 6 Low, 6 Info; re-check 4 Low, 2 Info | callee signer abuse (M-1) closed; LP griefing, LaunchLab pinning and iterated attester takeover partly closed by design |

Each reviewer was a fresh Claude agent given the code. It read earlier reports only after writing its own findings. Every fix and its
closing test is in `docs/burn-receipts/CHANGELOG.md`. Review 3 found that no path that moves funds was added, and it found no Critical
or High issue.

**Open or accepted after the re-check.** LP-ratio griefing is still possible through a deposit larger than the whole migrated liquidity.
The LaunchLab platform admin can still make changes between init and migration, which the launch gate and the stranding switch cover.
Attester proposals still need no consent from current attesters. They are bounded by 48 hours, then 7 days, then 48 hours, all in
public. The Jito-bundle gap in pool-health observations remains. So does the multi-block TWAP hold once the allowlist lapses.
Informational items I-3 to I-6 are also open (`docs/burn-receipts/README.md` section 8).

**Not done.** The ChatGPT review named in the decision log is not done. Neither are cargo-audit, Trident fuzzing and Sec3 X-ray. Review 3
ran clippy with `-D warnings`, and the result was clean. The bounty is not done either. It is 5 to 10 SOL from the developer fee, and its
terms are drafted in `SECURITY.md` but not published.

## 11. Limitations and risks

- **Settlement coverage.** Without Kalshi, settled numbers exist only where a primary source has an independent cross-read. That is five
  of eleven categories today (section 3.4). Everything else settles on Polymarket's payout vector or not at all, and Polymarket is
  binary-only. Coins launched on a Kalshi rule before 2026-10-10 carry the event-contract disclosure on every page.
- **LaunchLab is closed source.** The claim, the migration's pool address, `pool_creator` and LP handling rest on its SDK and docs. They
  have run only against a stand-in. Confirming them is a devnet-rehearsal gate, and it is not done.
- **Sandwich bound.** A sandwich can take up to `slippage_bps` (≤ 3 %) of each crank's spend, and that spend is at most 2 % of the
  reserve. Once the allowlist lapses, a manipulator who holds the rate up for a full TWAP window can still shift a crank.
- **Quorum 1 at launch.** The operator's key alone signs readings. A false reading is permanent and public, but it would size a burn.
- **Pre-audit cap.** Each crank's basis is capped at 25 SOL until the sunset, so larger pools burn more slowly.
- **Upgradeable until finalised.** The upgrade authority can replace every property in this paper until it is set to none.
- **Oracle voids and late data.** A late source means no burn until it posts. A missed Treasury date cannot be inserted later, and the
  next delta absorbs it.
- **No adoption of existing tokens.** `initialize_token` needs the new mint's signature, and the fee PDA must be LaunchLab's creator
  from the first trade.
- **Per-outcome fractions are not supported.** The current program cannot express a rule that pays a different fraction for each
  outcome.
- **Burns wait on the curve.** No buyback runs before graduation and pool registration.
- **Not built.** Mainnet program deployment, the second attester, the audit's chain leg, and the systemd units for the multi-token
  keeper and the audit timer are not built.

## 12. Open source and transparency

- **Public repository.** This draft left the address as a placeholder. The repository is public at
  https://github.com/rfzfhn67yk-netizen/burnticker, as the status table above says. The program, keeper, platform, sites, docs, deploy
  files, tests and fixtures are carved out of a private monorepo. An explicit allowlist (`config/public-repo.allowlist`) and a leak
  scan (`config/public-repo.denypatterns`) decide what leaves. The operator's trading code never leaves. The license is MIT, with brand
  assets excluded. Every publish adds the commit, program hash, IDL hash and allowlist hash to `docs/burnticker/CHANGELOG.md`.
- **Powers Register.** It is generated from the IDL and published as `docs/burn-receipts/powers-register.{md,json}`.
- **Logs.** The decision log (`docs/burnticker/decisions.md`) is append-only. The incident log (`docs/burnticker/incidents/LOG.md`) has
  no incidents recorded. Review reports are in `docs/burnticker/reviews/`.
- **Wallet list.** The transparency file (`config/burnticker/transparency.json`) names every role: operations, deployer, keeper,
  developer fee, LaunchLab platform admin, the Squads vault and its three members, the $DEFICIT mint, and the operator's trading
  wallets. In this draft every public key is a placeholder until it is set.
- **Policies.** Posts on X are not deleted, and corrections go in the same thread with the receipt. There is no paid promotion and no
  talk of what any coin trades at. Nothing is described as forthcoming. The platform never buys any coin.
- **The operator also runs trading bots.** Each bot refuses any platform coin by mint and by ticker. The check is in code and fails
  closed (`src/lib/ownTokens.ts`, which reads `config/own-tokens.json`). Both files are published.
- **The operator.** Burnticker is run by one independent operator in the United States. The contact address is contact@burnticker.com,
  and security reports go to security@burnticker.com.
- **How it was built.** It was built with AI assistance (Claude Code), under the operator's direction and review.

## 13. Appendix

### 13.1 Glossary

| Term | Meaning |
|---|---|
| fee PDA | `["fee", mint]` under `burn_receipts`; the burn pool and LaunchLab creator |
| reading | one attested value for one UTC date (`Reading` account) |
| unit | the rule's step: $1B of debt, one settlement, one scalar unit |
| crank | the permissionless instruction that processes the next reading |
| carry | a sub-unit remainder, or spend left over by a cap |
| TWAP | time-weighted average exchange rate from the CPMM oracle ring |
| attester | an ed25519 key whose signature counts toward the quorum |
| graduation | LaunchLab's migration of a filled curve to a CPMM pool |
| pre-audit cap | the 25 SOL per-crank basis limit with a sunset |

### 13.2 Account layouts (summary, from the IDL)

- **RuleParams:** `mode`, `carry_rule`, `pool_policy`, `value_decimals`, `unit_value`, `max_abs_delta`, `fraction_per_unit_bps`,
  `slippage_bps`, `max_twap_deviation_bps`, `twap_window_secs`, `floor_lamports`, `reserve_lamports`, `tokens_per_unit`, `vault_allocation`.
- **TokenConfig:** identity (`mint`, `creator`, `admin`), `rule`, `rules_sha256`, `params_hash`, feed id, memo prefix and source,
  `attesters[5]` with `attester_added_at[5]`, `quorum`, the pending attester and policy proposals, `cpmm_pool`, `pool_verified`,
  `registration_policy`, the pinned LaunchLab fields (`ll_platform`, `ll_cp_config`, `ll_lock_scale_ppm`), `cluster_genesis`, running
  state (`last_record_date`, `last_value`, `carry`, `crank_cursor`, `carried_spend_lamports`, totals, `shortfall`), the pool-untradeable
  timestamps, reserved bytes.
- **Reading:** `kind`, `processed`, `config`, `record_date`, `prev_date`, `value`, `prev_value`, `delta`, `carry_in`, `carry_out`,
  `units`, `signers_mask`, `source_url_hash`, `proof_hash`, `submitted_at`, `outcome`, `processed_at`, `pool_lamports`,
  `spent_lamports`, `got`, `burned`, `owed`, `shortfall`, `pool_actual_lamports`, `rule_spend_lamports`, `carried_in_lamports`,
  `carried_out_lamports`, `pool`.
- **PlatformConfig:** `authority`, `burn_pool_cap_lamports`, `cap_sunset_ts`, `pending_cap_lamports`, `pending_cap_eta`, `created_at`,
  `crankers[3]`, `cranker_count`, reserved.

### 13.3 Instructions (39, generated from `src/lib/burnReceipts/idl.ts`)

| Instruction | Arguments | Signers | Class |
|---|---|---|---|
| `initialize_token` | args | payer, creator, mint | creation |
| `initialize_platform` | authority, burn_pool_cap_lamports, cap_sunset_ts, crankers | payer, upgrade_authority | creation |
| `submit_reading` | record_date, value, source_url_hash, proof_hash | payer (+ quorum via Ed25519) | permissionless |
| `crank_buyback` | record_date | cranker | permissionless |
| `crank_vault` | record_date | cranker | permissionless |
| `crank_no_units` | record_date | cranker | permissionless |
| `pin_burn_target` | target_feed_id | payer, mint (before the mint exists) | creation |
| `crank_target_burn` | record_date | cranker | permissionless |
| `apply_target_pool` | — | caller | permissionless |
| `claim_launchlab_creator_fee` | — | payer | permissionless |
| `register_pool` | — | registrar | permissionless |
| `register_pair_pool` | — | registrar | permissionless |
| `link_pair` | — | payer | permissionless |
| `submit_pair_result` | record_date, winner, source_url_hash, proof_hash | payer (+ both coins' quorums via Ed25519) | permissionless |
| `forward_to_winner` | record_date | cranker | permissionless |
| `unlink_pair` | — | cranker | permissionless |
| `apply_paired_attester_change` | — | caller (+ the partner's quorum via Ed25519) | permissionless |
| `submit_rule_end` | record_date, outcome, source_url_hash, proof_hash | payer (+ quorum via Ed25519) | permissionless |
| `forward_on_end` | — | cranker (allowlist while the cap is in force) | permissionless |
| `register_fee_key` | — | payer | permissionless |
| `claim_lock_fees` | — | cranker (allowlist while the cap is in force) | permissionless |
| `check_pool_health` | — | caller | permissionless |
| `replace_pool` | — | caller | permissionless |
| `apply_attester_change` | — | caller | permissionless |
| `apply_cap_raise` | — | caller | permissionless |
| `apply_registration_policy` | — | caller | permissionless |
| `propose_attesters` | attesters, quorum | admin | privileged |
| `cancel_attester_change` | — | admin | privileged |
| `renounce_admin` | — | admin | privileged |
| `set_registration_policy` | policy, pool | admin | privileged |
| `cancel_registration_policy` | — | admin | privileged |
| `veto_registration_policy` | — | attester | privileged |
| `propose_target_pool` | pool | admin | privileged |
| `cancel_target_pool` | — | admin | privileged |
| `veto_target_pool` | — | attester | privileged |
| `propose_cap_raise` | new_cap_lamports | authority | privileged |
| `cancel_cap_raise` | — | authority | privileged |
| `renounce_platform_authority` | — | authority | privileged |
| `clear_cranker_allowlist` | — | caller (authority or listed cranker) | privileged |

The program has 42 event types: AdminRenounced, AttesterChangeApplied, AttesterChangeCancelled, AttesterChangeProposed,
BurnPoolCapBound, BurnTargetPinned, BuybackQueueUnblocked, CapRaiseCancelled, CapRaiseProposed, CapRaised, CrankerAllowlistCleared, EndSinkPinned,
FeeKeyRegistered, ForwardedOnEnd, ForwardedToWinner, LaunchLabCreatorFeeClaimed, LockFeesClaimed, PairForwardMissing, PairLinked,
PairResultMissing, PairResultSubmitted (plain `emit!`), PairUnlinked, PlatformAuthorityRenounced, PlatformInitialized, PoolRegistered,
PoolReplaced, PoolUntradeableCleared, PoolUntradeableFlagged, ReadingProcessed, ReadingReset, ReadingSubmitted,
RegistrationPolicyApplied, RegistrationPolicyCancelled, RegistrationPolicyProposed, RuleEnded, SpendCapBound, SpendCarried,
TargetBurned, TargetPoolProposalCancelled, TargetPoolProposed, TargetPoolRepinned, TokenInitialized. Error codes: 129. (Round 5, a coin that
burns another token: docs/burnticker/EXTERNAL-BURN.md; built, not deployed.)

The pair program (`pair_curve`, IDL in `src/lib/pairCurve/idl.ts`) has 9 entrypoints. `init_pair` takes args, is signed by the payer
and the creator, and creates the pair. The two curve-trade instructions take a side, an amount and a slippage bound, and the trader
signs. `graduate` takes a side and is sent by a cranker. `lock_lp` takes a side and is sent by a cranker. It locks the side's LP
forever, with the Fee Key going to the fee-keys PDA of `burn_receipts`. `burn_lp` takes a side and is sent by a cranker. It is the
30-day fallback if the lock refuses, and it is the only path that destroys LP. `claim_developer_fee`, `void_pair` and `close_pair` are
sent by any caller. Every instruction after `init_pair` is permissionless. The pair program has 9 event types: PairInitialized, Trade,
PairCommitted, SideGraduated, LpLocked, LpBurnedFallback, DeveloperFeeClaimed, PairVoided, PairClosed.

### 13.4 Memo grammars

The program writes these memos on chain (`src/memo.rs`). A memo is at most 566 bytes.

```
v1 (vault):   <PREFIX>|<YYYY-MM-DD>|src=<source>|prev=<v>|now=<v>|delta=<v>|units=<n>|burn=<tokens>[|short=<tokens>]|rules=sha256:<12>|v1
v2 (buyback): <PREFIX>|<YYYY-MM-DD>|src=<source>|prev=<v>|now=<v>|delta=<v>|units=<n>|pool=<lamports>|spent=<lamports>|got=<tokens>|burn=<tokens>|swap=<pool12|none>|rules=sha256:<12>|v2
```

For $DEFICIT the prefix is `DEBT` and the source is `fiscaldata.treasury.gov debt_to_penny`. For a Burnticker counter token the prefix
is the ticker and the source is `burnticker <selector>`. In that case `prev` and `now` are counter values.

The platform's per-event receipt line is v3 (`src/lib/burnticker/receipt.ts`). The platform parses and publishes it. The current
program does not write it on chain.

```
BT|<TICKER>|<id>|oracle=<oracle>|market=<ticker>|result=<yes|no|void|->|settled=<ISO second or period>|src=<host+path>|value=<decimal|->|units=<n>|pool=<lamports>|spent=<lamports>|got=<tokens>|burn=<tokens>|swap=<sig12|none>|rules=sha256:<12>|v3
```

The signed attestation message (section 4.4) is a separate grammar, `BURNRECEIPTS-v3`.

### 13.5 Addresses

| What | Address |
|---|---|
| `burn_receipts` program id | not set in draft 1 (localnet test key `GV9CMjXPGbmXnn3ci3RjvTBpfdgiZ4Ts7UWu1LCnSuF8` is not a deployment) |
| Burnticker LaunchLab platform id | not set in draft 1 |
| $DEFICIT mint | not set in draft 1 |
| Squads vault | not set in draft 1 |
| Developer fee wallet | not set in draft 1 |
| Raydium LaunchLab (mainnet) | `LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj` |
| Raydium CPMM (mainnet) | `CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C` |
| Raydium CPMM LP lock authority (mainnet) | `3f7GcQFG397GAaEnv51zR6tsTVihYRydnydDD1cXekxH` |
| SPL Memo | `MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr` |
| Mainnet genesis bound into signatures | `5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d` |

The Raydium and system addresses come from `programs/burn-receipts/programs/burn_receipts/src/constants.rs`.
