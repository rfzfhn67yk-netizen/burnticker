# Burnticker: coins that burn on real-world results, with receipts

Technical paper, draft 1, 2026-10-10. Written from the code and documents of the Burnticker repository at commit `76b9caa`. Every
statement names its source file; where a component does not exist, this paper says "not built" or "not done".

**Status at the time of writing.** The program is deployed on devnet (the 2026-10-10 rehearsal, `docs/burnkeeper/devnet-run.md`);
nothing is deployed on mainnet and no mainnet key exists.

| Component | State | Source |
|---|---|---|
| `burn_receipts` program (Anchor 1.2.1) | built; 82 Rust tests and the TS suites pass; deployed on devnet, not on mainnet | `docs/burn-receipts/README.md`, `CHANGELOG.md` |
| $DEFICIT keeper and Burnticker multi-token keeper | built; run against the program in a local end-to-end test; pages run on `FakeBurnProgram` | `docs/burnkeeper/README-execution.md` |
| Devnet rehearsal | done 2026-10-10 | `docs/burnkeeper/devnet-run.md` §4 |
| Mainnet rehearsal coin | not done | `docs/burnticker/REHEARSAL-RUNSHEET.md` |
| `pair_curve` program (rivalry pairs: both coins graduate or neither; Anchor 1.2.1) | built 2026-10-10; LiteSVM suite and TS fixtures pass; devnet rehearsal run (one pair graduated to two CPMM pools and registered, one pair voided and sold back); not on mainnet; not reviewed | `docs/burnticker/PAIR-CURVE.md`, `docs/burnkeeper/devnet-paircurve-run-log-2026-10-10.md` |
| Program deployment, program id, verifiable hash | devnet: deployed 2026-10-10 (`AuQjoSgq7upmyPBv2itwy2TSZ1VjoVipyy4z9wd7zhMM`, upgrade authority a Squads 2-of-3 vault); mainnet: not done | `docs/burnkeeper/devnet-run.md` §4, `docs/burn-receipts/README.md` §5.4 |
| Team-coin and matchup settlement (sports) | no ESPN reads: schedules from MLB StatsAPI, the NHL feed and the NBA feed (free), TheSportsDB v2 for every other league (`BURNTICKER_THESPORTSDB_KEY` not yet set); each game settles on its Polymarket on-chain payout where a moneyline market exists, else on TheSportsDB's final, and counts only when a second independent operator agrees (the on-chain payout and TheSportsDB confirm each other; the league's official feed where free; API-Sports optional) | `src/lib/burnticker/sources/gameSettle.ts`, `docs/burnticker/SETTLEMENT-COVERAGE.md` |
| Second, independent attester | not built | `config/burnticker/transparency.json` (`switchboard-down`, `quorum-1`) |
| Public repository | public | https://github.com/rfzfhn67yk-netizen/burnticker |
| Operator contact | set: contact@burnticker.com; security@burnticker.com for reports | `src/lib/burnticker/fees.ts` (`OPERATOR_LINE`), `config/public-repo/overlay/SECURITY.md` |
| Bug bounty | terms drafted, not published | `config/public-repo/overlay/SECURITY.md` |
| Security firm audit | none, by decision | `docs/burnticker/decisions.md` (2026-10-09, Audit) |

## 1. Abstract

**Coins that burn on real-world results — with receipts.** Burnticker is a launchpad for Solana memecoins whose supply burns when a
settled real-world result says so. The receipt is the product: every burn leaves one that a stranger can recompute, and nothing is ever
won — things are only burned.

A creator binds a coin to a selector over a resolution source and to a mapping from outcomes to burns. The source is a primary source
with an independent cross-read, or the on-chain payout of an adjudicated Polymarket market. The rule is hashed and locked when the coin
is created. When an event in the selector settles, attesters sign the settled reading. The `burn_receipts` program then spends a share
of the coin's own creator-fee pool buying the coin on its Raydium CPMM pool and burns every token it receives, in one instruction that
also writes a memo with the reading, the arithmetic and the rule hash. Anyone can recompute that memo from the public source and the
published rule.

The platform has two layers. The engine is the launchpad and the program: rules locked at launch, readings signed before use, burns run
by a program rather than promised by a person. The show is built from the same receipts: team coins scored by burns league by
league, rivalry pairs (§5) whose pages keep the tally, and Burn Derby pairs and brackets (§5.2). A season is a scoreboard of burns.
There is one per league and season, never a ranking across leagues; when a season ends, the coin with the most receipts is its
league's champion — a stat, never a recipient: no coin pays anything on any outcome.

Burnticker is run by one independent operator, reachable at contact@burnticker.com; the operator’s identity is held privately until a legal entity is formed. It is not an investment product: a coin holds no position in any
market, and the rule says what the supply does, not what the price does. The program is not audited by a security firm.

## 2. The problem with "burn" claims today

Most token burns are statements by whoever controls the tokens. Three patterns recur:

- **Operator-controlled burns.** A team wallet decides when and how much to burn, and the same wallet can also sell.
- **Unverifiable triggers.** "We burn when X happens" names an event but not a source, a unit or a formula, so nobody can check that a
  burn matches the event or that one was skipped.
- **Team allocations.** Burning tokens a team was given for free removes supply the market never held, and the allocation gives
  insiders a position the burn posts serve.

Burnticker takes the trigger, the amount and the custody away from the operator and leaves a receipt a stranger can recompute: the rule
is fixed before the first trade, the reading comes from an adjudicated source signed by named keys, the money sits in an account with no
withdraw instruction, and the program computes the amount and writes the receipt in the same instruction as the burn.

## 3. Design

### 3.1 The rule: a selector and an outcome→burn mapping

A rule is a JSON document with schema `burnticker.rules/v1` (`src/lib/burnticker/rules.ts`). It names an oracle and a selector, maps
outcomes to burns, and applies to markets that do not exist yet.

```json
{ "schema": "burnticker.rules/v1", "oracle": "kalshi", "series": "KXNFLGAME", "market": null,
  "filter": { "tickerIncludes": "-DEN" }, "kind": "binary",
  "binary": { "onYes": { "fractionOfPool": 0.02 }, "onNo": null }, "scalar": null, "pair": null,
  "onVoid": "skip", "floorUsd": "1", "reserveSol": "0.02", "vault": null }
```

| Field | Meaning |
|---|---|
| `oracle` | `kalshi`, `polymarket` (binary only) and `catalogue` are live; `uma`, `drift-bet`, `hedgehog` are parsers and stubs, not launchable |
| `series` + `filter` | every present and future market of the series whose ticker contains the text and/or whose title matches a regex |
| `market` | one market ticker: a one-shot rule that resolves once, after which the supply is fixed |
| `kind: binary` | reads the settled yes/no result (Polymarket: the payout vector on Polygon; Kalshi's `result` only for coins launched on it before 2026-10-10); `onYes` / `onNo` give the burn for each outcome |
| `kind: scalar` | reads the settled number and counts `unit`s from a baseline (`previousSettlement` or a number) in a direction (`up`, `down`, `abs`) |
| `fractionOfPool` / `tokens` | buyback mode: fraction `f` of the burn pool per unit (1 % to 10 %); vault mode: tokens per unit |
| `onVoid` | `skip`, the only policy |
| `pair` | rivalry pairs (§5): `pairId`, `side`, `counterpartMint` |

**Locking.** `lockRule` serialises the validated rule as canonical JSON (keys sorted, two-space indent, trailing newline) and hashes
those bytes with sha256. The hash goes into `TokenConfig.rules_sha256` at `initialize_token`, into the token description's footer and
into every on-chain memo as `rules=sha256:<first 12 hex>`. No instruction changes it. A different rule is a different coin.

**Finality.** A Polymarket market counts once its payout vector is on chain; a primary source's period counts once it is complete
(`src/lib/burnticker/sources/attestedHttp.ts`). For coins launched on a Kalshi rule before 2026-10-10, a Kalshi market counts when its
status is `finalized`, or `settled` once `settlement_ts + settlement_timer_seconds` has passed (`src/lib/burnticker/oracle/kalshi.ts`). The rule reads settled results only, never prices; the token page's "market-implied chance of the next
burn" is labelled display-only.

### 3.2 Sources

**Settled on primary sources; prediction markets are discovery and optional cross-checks where their terms permit.** On 2026-10-10
the owner decided that Kalshi is not a settlement input: Kalshi's Developer Agreement limits API use to a member's own trading, and its
Data Terms forbid using Kalshi data to settle products or to cache or redistribute it. A coin settles on one of two things: a primary
source read together with an independent cross-read of the same fact (another operator on another domain), or the payout vector of an
adjudicated Polymarket market as Polygon's Conditional Tokens contract stores it (§3.4). The Kalshi adapter
(`src/lib/burnticker/oracle/kalshi.ts`) remains for discovery behind `BURNTICKER_KALSHI_ENABLED`, and the creation preflight refuses
every Kalshi rule.

**Polymarket binary markets are the adjudicated source** (since 2026-10-10): Gamma (`https://gamma-api.polymarket.com`) finds the
markets, and the result is the payout vector the Conditional Tokens contract on Polygon stores for the market's condition id, read with
`eth_call`; a reading counts only once that payout is on chain, a 50-50 payout is a void (`src/lib/burnticker/oracle/polymarket.ts`). A single game pairs on Polymarket's
moneyline market; team coins have no settlement route (Polymarket lists the two teams in an order that changes from game to game).

**First-party feeds are the primary path.** `config/burnticker/sources.json` holds 34 sources (four of them cross-read-only) read through one generic adapter
(`src/lib/burnticker/sources/attestedHttp.ts`): Treasury, BLS, NOAA, Launch Library 2, JPL, Wikimedia and others, each with a saved
fixture, plausibility bounds, a fixed unit, direction, baseline and carry, the `operator` that runs the endpoint and, where another
operator publishes the same number, a shared `fact`. Key-required sources are present but not launchable.

**$DEFICIT is the stated exception.** The operator's own first coin reads U.S. Treasury "Debt to the Penny"
(`tot_pub_debt_out_amt`) directly: every full $1,000,000,000 added since the previous business day is one unit, remainders carry only
across consecutive increases, and each unit spends 2 % of the burn pool — the Federal Reserve's 2 % inflation goal, pointed the other way
(`config/burnkeeper/deficit.rules.json`; the devnet rehearsal coin used 1 %).

**Refused regardless of source** (`config/burnticker/refuse.json`, applied at create time): deaths, violence, terror, casualty counts,
disasters and named private individuals; names that claim to be official; any selector on the coin's own trading (never the token's price). Elections are allowed.

### 3.3 Tiers: what a skeptic can verify at each

| Tier | Source kind | Admission | What a skeptic verifies | What stays trusted |
|---|---|---|---|---|
| 1 | adjudicated market (Polymarket live; Kalshi not a settlement input since 2026-10-10; Drift BET, Hedgehog stubs) | settled results only; finality window respected; voids never burn | the payout vector on Polygon (public chain data) and Gamma's report; the memo's `units` from the rule | Polymarket's adjudication (UMA); the attesters' honesty about the read |
| 2 | optimistic assertion (UMA, stub) | counts only once settled and not disputed-and-lost | the assertion's settlement on chain | UMA's dispute process |
| 3 | primary API attested by a TEE or zk job | third-party asset rates allowed from here up | the job definition and the oracle's on-chain record | not wired: Switchboard, the planned provider, ended service on 2026-09-25 |
| 4 | primary API read by the keeper | no asset rates; one real fixture; plausibility bounds; complete periods only | the exact source row with the `curl` in every receipt | the attesters (quorum 1 at launch: the operator) |
| 5 | page-scraped | owner's approval per source; regex pinned to the markup | the page and the regex | the page's editorial number and the attesters |

Source: `docs/burnticker/README.md` §6 and `docs/burnkeeper/attestation.md` §1.

### 3.4 Settlement coverage

`src/lib/burnticker/coverage/` audits, for every category of `config/burnticker/categories.json` and every selector kind the wizard
can emit, whether a coin can be settled without Kalshi. A category is **settleable** only with at least one primary source (a
first-party adapter: attested-http or on-chain, tier 4 or better, launchable, not an aggregator) AND an independent cross-read of the
same fact; **adjudicated-only** when Polymarket's binary markets are the only route; **uncovered** otherwise. Each source also gets a
90-day dry run: readings its schedule expected against readings produced, the median latency from the period's end to the keeper's
first sighting, and the rate at which the primary and its cross-read disagree.

On the frozen fixtures of 2026-10-10 five of eleven categories are settleable (`docs/burnticker/SETTLEMENT-COVERAGE.md`): Sports (each game
settles on its Polymarket on-chain payout where a moneyline market exists, else on TheSportsDB under its commercial licence,
confirmed by the league's own feed — MLB, NHL, NBA — or API-Sports; no ESPN reads — schedules come from the leagues' own feeds or TheSportsDB), Economics (`fred.UNRATE` ↔ BLS `LNS14000000`, `fred.CPIAUCSL` ↔ BLS
`CUSR0000SA0`, `bls.eggs` ↔ FRED `APU0000708111`, `treasury.debt` ↔ FRED `GFDEBTN` at quarter ends; 0 disagreements on every shared
month), Financial markets (Pyth ↔ RedStone), Weather & Climate (the NWS climate report ↔ the Iowa Environmental Mesonet) and Crypto &
On-chain (`bitcoin.blockHeight` ↔ blockstream.info; Pyth ↔ RedStone or the pool TWAP). The other six are adjudicated-only; none is
uncovered. The pair catches a broken endpoint, a parser error or a
tampered response; when the cross-read is a mirror (FRED republishes BLS), it does not catch an error in the original release.

Creation runs the selector live once first (`preflightSelector`, wired into the launch pipeline): the primary and its cross-read are
read, and creation is refused on a Kalshi rule, a missing cross-read, a failed read or a disagreement on the latest shared period. The
matrix is served at `GET /api/burnticker/v1/coverage`, drawn on the trust page and rendered to `docs/burnticker/SETTLEMENT-COVERAGE.md`;
the test suite fails when any category is uncovered.

## 4. Settlement on chain: the `burn_receipts` program

### 4.1 Accounts

All accounts are PDAs of the program keyed by the mint (`programs/burn-receipts/programs/burn_receipts/src/constants.rs`, `state.rs`).

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

Before graduation there is no CPMM pool, so buyback readings wait in order until `register_pool` succeeds; the 30-day dead-pool rule
(§4.9) does not apply to an unregistered pool (`docs/burn-receipts/README.md` §3).

### 4.3 `initialize_token`

Signed by the payer, the creator and the new mint keypair (the mint need not exist yet), so only the launcher can create the config
for a mint, and only once. It records the rule, feed id, memo text, rules hash, attester set and quorum; funds the fee PDA with the
reserve; enforces the swap-safety bounds of §4.5; and, for buyback policy 0, pins the LaunchLab PlatformConfig's key, `cpConfigId` and LP
lock and burn scales, refusing a platform whose `platformCpCreator` is not unset or the fee PDA, or whose scales cover under 50 %. It
takes no token program or token account: the program has no mint path.

### 4.4 Readings

`submit_reading(record_date, value, source_url_hash, proof_hash)` is permissionless but valid only with a quorum of attester
signatures. Each attester signs exactly these bytes (`src/attest.rs`):

```
BURNRECEIPTS-v3|<cluster genesis>|<program id>|<mint>|<feed_id>|prev=<previous date or none>|<YYYY-MM-DD>|<value>|src=<sha256(source URL), hex>|proof=<proof locator, hex>
```

The signatures ride in an `Ed25519SigVerify` instruction of the same transaction (one shared message, one entry per key); the program
reads them back through the instructions sysvar, requires every offset to point into that instruction, counts each key once, and
matches the message byte for byte. Binding the genesis, program id and mint makes a signature useless on another cluster, token or
deployment; binding the previous date fixes the order, so pre-signed readings cannot be reordered or skipped. Attester sets hold at
most 5 keys and the quorum is at most 3, the largest that fits a legacy transaction (966 / 1,076 / 1,186 bytes for 1 / 2 / 3 keys).

Dates strictly increase and no future date is accepted. Readings are never edited, deleted or closed. Units follow the rule
(`src/math.rs`, mirrored in `src/lib/burnReceipts/math.ts`):

- on an increase, `units = floor((delta + carry_in) / unit_value)`; under carry rule 0 the remainder carries across consecutive
  increases, under rule 1 it is dropped;
- a down or flat reading earns nothing and resets the carry;
- a quorum-signed reading whose change exceeds `max_abs_delta` is accepted as a RESET: 0 units, carry reset, new baseline,
  `ReadingReset` emitted. It never wedges the feed (review 1, M-2).

**Event rules on the program: the unit counter.** The program's reading model is one value per UTC date. A Burnticker token is
initialised with `value_decimals 0`, `unit_value 1`, carry none, feed id `bt.units:<TICKER>`, and the attested value is a counter:
`value(D) = 1 + every unit the token's settled receipts carried through date D`. The day's delta is the day's units, so one crank
covers all of a day's settlements. The signed `src` hash commits to the exact events counted:
`sha256("burnticker://<TICKER>/units/<YYYY-MM-DD>?events=<id,id,…>")` (`src/lib/burnticker/program.ts`). A rule that pays different
fractions for different outcomes cannot be expressed on the current program; the launch bundle refuses it.

### 4.5 `crank_buyback`: swap, burn and memo in one instruction

`crank_buyback(record_date)` processes the next reading in line (`prev_date == crank_cursor`). The cranker supplies no amount, pool,
rate or recipient. In order (`src/instructions/crank_buyback.rs`):

1. **Pool.** `pool = fee PDA lamports − reserve + WSOL already held` (`spendable_pool`). While the pre-audit cap is in force the rule is
   applied to `min(pool, cap)`; `BurnPoolCapBound` is emitted when the cap binds and the Reading keeps both the basis and the actual pool.
2. **Rule spend.** `spend = pool × (1 − (1 − f)^units)`, `f = fraction_per_unit_bps / 10,000`, computed as
   `keep = floor(pool × pow_floor(1 − f, units) / 1e18)`, `spend = pool − keep` in u128 fixed point, so spend never exceeds the pool. It
   agrees with the keeper's exact rational to within one lamport for pools under 10^15 lamports (pinned by test). The amount due is the
   rule spend plus any spend carried from earlier cranks.
3. **Spend floor.** Under `floor_lamports` nothing is bought; the reading is processed and memo'd `swap=none`, and the pool keeps the SOL.
4. **Per-crank cap.** One crank spends at most 2 % of the pool's WSOL reserve; the rest is carried (`carried_spend_lamports`,
   `SpendCapBound`). Small, frequent swaps limit trade impact and sandwich room.
5. **TWAP guard.** `max_twap_deviation_bps` ≤ 300 and `twap_window_secs` 600 to 1,200 are enforced at init. The spot exchange rate
   (tokens per SOL) may not sit more than the deviation below the CPMM oracle's time-weighted average. The oracle records the rate before
   each swap and only across distinct seconds, so a same-block front-run cannot move it. A refused crank defers the burn day: late, not
   lost.
6. **Minimum output.** `min_out` is the larger of two quotes, each the constant-product output less the pool's whole fee and
   `slippage_bps` (≤ 300): one on the live reserves, one on a pool of the same SOL depth at the TWAP rate. A same-transaction push lowers
   the first quote, not the second, so a sandwich can take at most `slippage_bps` of a spend that is itself at most 2 % of the reserve.
7. **Swap.** System transfer from the fee PDA to its WSOL account, then a CPI to Raydium CPMM `swap_base_input` on the registered,
   verified pool. The CPMM program id is hard-coded; vaults, `amm_config` and the observation account are checked against the pool.
8. **Burn.** Every token the fee PDA holds is burned: what the swap delivered plus any token-side creator fees or donations.
9. **Memo.** The program CPIs the Memo program with the canonical v2 memo (§13.4), built from the accounts alone.
10. **Events.** `ReadingProcessed`, plus `SpendCapBound`, `SpendCarried`, `BurnPoolCapBound` as they apply, via `emit_cpi!`.

`crank_vault` is the vault-mode twin: `owed = min(units × tokens_per_unit + shortfall_in, allocation_left)`,
`burn = min(owed, vault)`, the rest a public shortfall carried forward, memo v1. `crank_no_units` marks a zero-unit reading processed.

Measured: about 110,000 compute units typical, 137,009 worst case; the crank transaction is 907 bytes.

### 4.6 How fees reach the burn pool

The fee PDA is LaunchLab's recorded creator. LaunchLab's `initialize_v2` takes `creator` as a non-signer, so the launch passes
`feePda(programId, mint)` there (`docs/burnkeeper/fees.md` §1; devnet simulation with a PDA creator succeeded, 188,143 CU).

- **On the curve,** LaunchLab accrues the creator fee in its vault `[fee PDA, WSOL]`, claimable only with the creator's signature.
  `claim_launchlab_creator_fee` (permissionless) CPIs LaunchLab's `claim_creator_fee` with the fee PDA signing by seeds and the
  recipient pinned to the fee PDA's own WSOL account.
- **After graduation,** the CPMM pool records `pool_creator` = the launch creator when the platform's `platformCpCreator` is unset, and
  Raydium's `collect_creator_fee_permissionless` pays that creator's ATAs. Any payer may call it.
- **Seed deposits.** Anyone can send SOL to the fee PDA. Nobody can take it out.

### 4.7 Pool registration and provenance

*Pair coins (registration policy 2, §5.4) register through `register_pair_pool` instead; everything below is the LaunchLab path,
unchanged.*

`register_pool` (permissionless, once) accepts only LaunchLab's own migration pool:

1. the token's LaunchLab pool (`["pool", mint, WSOL]` under LaunchLab) records the fee PDA as creator, CPMM as its migration destination,
   and the platform pinned at init;
2. the CPMM pool is the deterministic PDA `["pool", cpConfigId, token0, token1]` of the `cpConfigId` pinned at init;
3. its `pool_creator` is the fee PDA;
4. at least 50 % of its live LP supply is burned or held by Raydium's LP lock (`ATA(LOCK_CPMM_AUTH, lp_mint)`). This is a minimum under
   the provenance proof: to block registration a griefer must deposit more than the whole migrated liquidity and leave it there.

The mint must have no mint authority and no freeze authority. Burnticker's platform locks 100 % of graduation LP (§6), so a correct
migration passes with margin. **Not yet confirmed:** that the real LaunchLab migration passes the creator through, creates the pool at
the `cpConfigId` PDA and locks or burns LP as its SDK says. LaunchLab is closed source; this is a devnet-rehearsal gate.

**Stranding recovery.** If no pool can be registered, or the registered one is continuously untradeable for 7 days, the token's admin
may propose `set_registration_policy` to a fixed pool passing the same creator and LP checks, plus either 90 % of LP burned or locked
or the pool PDA of a LaunchLab-known AmmConfig. The proposal waits 48 hours, expires after 14 days, can be vetoed by any one current
attester, and the power ends at the pre-audit cap's sunset or at `renounce_admin`.

### 4.8 Post-CPI guards

Two instructions lend the fee PDA's signature to external, upgradeable programs: the LaunchLab claim and the CPMM swap. After each, the
program requires the fee PDA to still be System-owned with no data and the expected lamports, and each fee-PDA token account to keep
owner, mint, no delegate and no close authority; the swap's output vault must have paid exactly what the fee PDA received. Any
violation reverts (`FeeAccountTampered`, `SwapOutputMismatch`; `src/guards.rs`). This is tested against a hostile stand-in loaded at
LaunchLab's and CPMM's program ids (`mocks/evil_callee`).

### 4.9 Pool health and replacement

`check_pool_health` (permissionless, top-level only, alone with the pool in its transaction) records observations of the registered pool
being untradeable (swaps disabled, account gone, or under 0.01 SOL WSOL reserve). A spell starts on the second of two observations at
least 1 hour apart and stays continuous while observations are at most 24 hours apart. After 7 continuous days, `replace_pool`
(permissionless) moves to a different tradeable pool passing every `register_pool` check; after 30 days, cranks process readings below
the spend floor with the amount carried, so the queue never wedges. A Jito bundle of separate transactions is invisible to these checks;
that residual is accepted (`pool_health.rs`).

### 4.10 Powers: what exists, with timelocks and sunsets

From the Powers Register (`docs/burn-receipts/powers-register.md`, generated from the IDL; the generator fails on any undescribed
instruction or signer):

| Power | Holder | Limit | Timelock | Sunset |
|---|---|---|---|---|
| Propose attester changes | token admin (intended: the Squads vault) | quorum never lowered, never above 3; set never smaller than quorum; one proposal keeps ≥ quorum current keys and adds fewer new keys than the new quorum; kept keys vouch for added keys only after 7 days in the set | 48 h, applied by anyone | `renounce_admin` |
| Raise the burn-pool cap | platform authority (intended: the Squads vault) | raise only | 48 h, applied by anyone | cap sunset, set once at `initialize_platform`, ≤ 365 days and ≤ 2027-10-01 |
| Clear the cranker allowlist | platform authority or any listed key | clear only, never add | none | allowlist lapses at the cap sunset or 90 days after `initialize_platform` |
| Registration-policy switch | token admin | stranding only (§4.7) | 48 h, 14-day expiry, attester veto | cap sunset; `renounce_admin` |
| Program upgrade | upgrade authority (plan: Squads 2-of-3) | can replace all code | 48 h Squads time lock | set to none after review (§9) |
| LaunchLab platform admin (outside the program) | the key that created the platform | fee rates, wallets, `cpConfigId`, `platformCpCreator`, LP scales for launches not yet migrated | **none** | none: the admin cannot be transferred |

**What has no instruction:** withdraw, sweep, transfer, close or set-recipient for the fee PDA, its token accounts, the vault or any
program account; mint; pause or freeze; rule update; feed, memo, rules-hash, mint, creator or registered-pool change; reading edit or
delete; fee change (the program charges no fee). No account is ever closed, so no rent is refunded. Without a PlatformConfig the
hard-coded default cap applies (25 SOL until 2027-10-01T00:00Z), so a lost or finalised upgrade authority cannot wedge buybacks.

### 4.11 The pre-audit cap

While in force, each crank's basis is `min(pool, 25 SOL)`; SOL above the cap stays in the fee PDA. `initialize_platform` (upgrade
authority only, once) must set exactly the default, so the cap is never lowered; it can only be raised through the 48-hour timelock and
disappears at its sunset. It protects against program bugs, not against the operator, whose multisig can replace the code until the
upgrade authority is finalised.

Every state change emits an event through `emit_cpi!` (inner-instruction data, not truncatable logs), so an indexer can rebuild state
(26 event types, §13.3).

## 5. Rivalry pairs

Two coins launch together on the same tier-1 selector with inverted mappings (`src/lib/burnticker/rules.ts` `invertMapping`,
`launchBundle.ts` `buildPairBundles`). Examples: $BRONCOS burns on the NO of each `-DEN` leg of `KXNFLGAME`, $CHIEFS on the YES; $BULLS
and $BEARS on the S&P close direction (scalar `up` against `down`). A binary settlement burns exactly one side; a flat scalar settlement burns neither.

- `pair: { pairId, side, counterpartMint }` is part of each side's canonical JSON, so the link is inside both locked rules; the two
  rules are hashed independently. Side A is created first; side B's rule names A's mint as counterpart, and A's counterpart is held in
  the registry's append-only `pairs` table.
- Binary sides swap `onYes` and `onNo`; scalar sides flip `up` and `down`; an `abs` rule cannot pair. Pairs must use a tier-1
  adjudicated market source.
- **The scoreboard.** The pair page shows both sides, the burn tally, the supply burned per side and the interleaved receipts; for a binary
  pair both back-tests' burn counts sum to the selector's non-void settlement count.

A relative-value perpetual version was considered and rejected (pool-depth caps, oracle manipulation, no US-legal path;
LAUNCHPAD-PATH §22).

### 5.1 Both or neither

Every pair created since 2026-10-10 carries a clause in both sides' canonical rules: `pair.clause = "both-or-neither"`, a `voidBy` date
(a one-shot's first settlement date, else 30 days after launch).

- Event burns on either side apply only once BOTH coins have a registered pool. A settlement read before that is recorded as a
  `pending-pair` receipt; the cycle the second pool registers, the pair goes live and the waiting receipts execute in settlement order.
- If either side has no registered pool when the `voidBy` UTC date ends, the pair voids. Waiting receipts become `voided` (final), no
  event burn happens on either side again, and the rule has ended: each coin's pool winds down (section 5.3), executed once that coin
  has a pool, so no fee is stranded in a pool that can never burn.
- The outcome (live or voided) is written once to the registry's append-only `pair_outcomes` table. The pair page shows the state, the
  void date and both bonding curves side by side.

### 5.2 Burn Derby: coin against coin

Burn Derby is a selector kind for pairs: the relative performance of two existing coins over a UTC day (00:00 to 00:00) or week. The
rule's `derby` block names both coins (a Pyth feed id, a Solana mint, the deepest SOL pool, an independent cross-read), the window, the
measure (% change, or the change of circulating supply times the feed value) and the season; the rule's `series` is derived from it and
the whole block is inside the rule hash (`src/lib/burnticker/derby/spec.ts`).

- **Settlement.** A window's margin is coin A's % change minus coin B's, exact to six decimals. A positive margin settles YES and side A's
  coin burns; a negative margin settles NO and side B's coin burns; an exact tie is a void on both sides. The coin on the winning side burns;
  nothing is paid to anyone. A one-shot variant settles once, on the first window that ends with A's size above B's (YES), or at the end of the
  season without it (NO).
- **Values.** Pyth: the sponsored `PriceUpdateV2` accounts on Solana, which Pyth's receiver program writes after verifying the
  Wormhole-signed update, read keylessly and snapshotted at each boundary; or the Hermes update published at the boundary (Pyth's
  pull service, with an API key), whose bytes' sha256 becomes the proof. A coin without a Pyth feed is read from the time-weighted vault
  balances of its deepest SOL pool, priced with Pyth's SOL/USD feed.
- **Cross-read.** An independent operator (Jupiter, DexScreener or RedStone) is snapshotted at the same boundaries. When its margin
  differs from the primary's by more than two percentage points, or a value is missing, the window is withheld: no reading, no burn, an
  alert. Each window is decided once and stored append-only.
- **Proof on chain.** The reading carries `derby:sha256:<hex>` of the window's proof document; the counter attestation's quorum-signed
  message carries the same hash as `proof=` (section 4.4), and `src=` commits to the event ids, which carry its first 16 hex digits.
- **Brackets.** Eight or sixteen coins, one derby per match per round (default seven days). More winning days advances; the tiebreak is
  the compounded change over the round, then the lower seed. The losing fan coin retires and reads nothing more. A winning day in the
  final counts two units, which the program compounds as pool × (1 − (1 − f)²), while two times f stays within the rules' 10% maximum.
- **Refused.** A Burnticker coin as an input, the refuse list, the same coin twice, a coin with no Pyth feed and under $250,000 of
  liquidity, and US index proxy feeds unless the host enables them. A coin's own trading is never an input.

### 5.3 No pool is left behind

Every rule created since 2026-10-10 carries `onEnd: { windDownDays: 28, sweepThresholdLamports }` inside its hash.

- **The wind-down.** When a rule ends for any reason (a one-shot resolved NO or void, a pair voided, a derby season over, a bracket coin
  knocked out, a team's season over), the keeper attests a daily reading from a date-based clock whose proof is
  sha256("clock|<date>|<rules sha256>"). Each day counts the smallest number of units n of the rule's own fraction f with
  (1 − f)^(28n) ≤ 1 % — 17 units a day at 1 % — so at least 99 % of the pool is spent within 28 days; the 2 % per-crank cap carries the
  rest forward and the $1 floor ends the tail. Then the coin retires.
- **A one-shot at 100 %.** A one-shot mapping may spend the whole pool (recurring rules stay at 10 % or less); the program already accepts
  10,000 basis points. Because a crank spends at most 2 % of the pool's reserve and needs a reading with units, the keeper attests one
  drain unit a day after the YES — each one's rule spend is the whole pool, exactly — until the program carries nothing more.
- **The sweep.** A retired coin's burn pool keeps receiving the post-graduation creator fee. When its spendable balance passes the
  threshold the keeper attests one full-spend reading (at most once a week). A permissionless instruction that lets anyone do this
  without the keeper is queued for the next program review (`PROGRAM-UPGRADE-QUEUE.md`), as is forwarding a losing coin's leftover to
  the winning coin of an outcome set.

Communities adding to a score by burning their own tokens into the program was considered and not built: it would turn the score into a
function of spending and add a deposit path to a program designed without one.

### 5.4 The pair curve: both coins graduate, or neither does

On LaunchLab each coin of a pair has its own curve, so one side can graduate while the other stalls. The owner's decision of
2026-10-10 is a second program, `pair_curve` (`docs/burnticker/PAIR-CURVE.md`), through which a pair launches when
`BURNTICKER_PAIR_CURVE_ENABLED` is set (default off; single coins stay on LaunchLab). Until it is on, pairs launch on two LaunchLab
curves under the rules-level "both or neither" clause of §5.1.

- **One account per pair**, two virtual-reserve bonding curves (pump.fun's constants by default: 30 SOL virtual, 1.073 B virtual
  tokens, 793.1 M sellable, 206.9 M reserved for the pool), one System-owned SOL vault, 1,000,000,000 tokens per coin at 6 decimals,
  mint authority revoked at creation and no freeze authority. The curve is path-independent — the vault holds exactly
  `F(sold) = ceil(V_s · sold / (V_t − sold))` per side after any sequence of trades, so selling everything back drains it exactly.
- **Fee: 100 bps of every curve trade**, 25 for the developer wallet (the claim wallet of Burnticker's own LaunchLab platform, compiled
  into the program) and 75 for the traded coin's `burn_receipts` fee PDA. Both stay in the pair's vault until they are due: the 75 bps
  reach the fee PDA when that coin's pool is created (or go back to its holders on a void), the 25 bps are paid by a permissionless
  claim. No trade pays any other account, so no outside wallet can stop trading. No Raydium curve fee, no referral, no creator slice.
- **Graduation** needs the combined raise to reach the pair's threshold with each side holding a minimum share of it (default 25 %, at
  most 40 %), before the deadline, and both sides able to pay for their pools. The trade that meets this commits the pair on the spot
  (both curves close; it can no longer void); each `graduate` call then creates its side's CPMM
  pool at a `pair_curve` address nobody else can sign for, with SOL and tokens in the curve's closing ratio, and burns every token the pool
  did not need; a permissionless `lock_lp` then locks 100 % of the LP with Raydium's LP lock, the Fee Key owned by `burn_receipts`' fee-keys
  PDA (LP locked forever, §6). Two transactions, because both pools in one would sit at Solana's 64-entry instruction-trace cap and a griefer could
  push them over it.
- **Void**: at the deadline without graduation, buys close and each coin's holders share what that side raised (its curve SOL plus the
  75 bps held for its fee PDA) pro rata, with no fee and no advantage in leaving first. Once nothing circulates the pair's accounts
  close. A side Raydium still blocks three days after the commit, or any side still without its pool thirty days after it, is put
  into the same pro-rata exit, alone. Once the deadline has passed nobody can leave along the curve ahead of the others.
- **Registration**: `burn_receipts` gained registration policy 2 and `register_pair_pool`, which accepts only the pool `pair_curve`
  recorded for that mint, at its `pair_curve` address, created by the pair's vault on the pinned cpConfigId, with ≥ 90 % of the creation
  LP burned or locked (§4.7).
- **Powers**: none over funds. No admin, no parameter update, no withdraw; the upgrade authority is the same Squads vault as
  `burn_receipts`, to be finalised before the first public pair (`docs/burn-receipts/pair-curve-powers-register.md`). Two blind reviews
  (2026-10-10) found five High issues in the first version; all are fixed and re-run on devnet (`docs/burn-receipts/CHANGELOG.md`).
## 6. Economics

Fee dials were read from the pinned Raydium SDK, Raydium's documentation and the live config accounts (`docs/burnkeeper/fees.md`;
designed values in `src/lib/burnticker/fees.ts`).

| Phase, per unit of volume | Raydium | Burnticker (developer / operator) | Burn pool (fee PDA) | Nobody |
|---|---|---|---|---|
| Bonding curve (LaunchLab) | 25 bps | 25 bps (platform `feeRate` 2,500 ppm) | 50 bps (`creatorFeeRate` 5,000 ppm, the maximum) | none |
| After graduation (CPMM tier 0, 25 bps trade fee) | 4 bps of trade fee (3 RAY buyback + 1 treasury) + 0.25 bp (5 % of the creator fee) | 4.2 bps (20 % of the locked LP's 21 bps, by `claim_lock_fees`) | 16.8 bps (80 % of the locked LP's fees) + 4.75 bps (Raydium's fixed 5 bps creator fee, less 5 %) | none |
| Pair curve (`pair_curve`, §5.4) | 0 | 25 bps | 75 bps | none |
| Pair coin after graduation (CPMM public `initialize`, creator fee off) | 4 bps of trade fee | 4.2 bps (20 % of the locked LP's fees) | 16.8 bps (80 % of the locked LP's fees; public pool creation cannot turn the creator fee on) | none |

- **LP locked forever; its fees fund the burn** (owner decision 2026-10-10, replacing "all graduation LP is burned"). 100 % of every
  coin's graduation LP is locked with Raydium's LP lock (LaunchLab `platformScale` 1,000,000, creator 0, burn 0; pair coins through
  `lock_lp`), never withdrawable and not creator-configurable. The Fee Key NFT is owned by `burn_receipts`' `["fee_keys"]` PDA. The
  permissionless `claim_lock_fees` splits the SOL side of the LP fees by compiled constants — `LOCK_FEE_BURN_BPS` 8,000 to the coin's
  burn pool, `LOCK_FEE_OPERATOR_BPS` 2,000 to the operator treasury (the Squads vault) — and burns the coin side; no admin key or config
  field can change the split. Per swap after graduation that is ≈ 21.55 bps toward the burn (16.8 + 4.75; it was 4.75 with the LP
  burned) and 4.2 bps to the operator: **the operator earns 20 % of post-graduation LP fees.** On mainnet the treasury is not compiled
  in yet; until it is, every claim refuses `TreasuryNotPinned` and the fees stay in the lock.
- **Creators earn no cash from fees.** The creator-fee slot pays the burn pool, 100 %, by construction: the fee PDA is the creator.
- **No team allocation** on any coin. The program has no mint path; supply is LaunchLab's fixed 1,000,000,000 at 6 decimals.
- **Seed deposits are gifts.** $DEFICIT's planned 3 SOL seed to its burn pool is disclosed and carries no claim.
- **No referral share** (`shareFeeRate` 0), no hidden parameters, no creator fee slice (`CREATOR_FEE_SLICE_BPS = 0`).
- **What the platform fee funds** (`USE_OF_FEES`): "attesters, hosting, the audit, and the operator. The platform never buys back any
  coin, including its own." The bounty pool (5 to 10 SOL) is drawn from the same fee.
- A creator pays LaunchLab's creation cost and gas; nothing to Burnticker up front.

The platform admin key can change these dials for launches not yet migrated (§9); the trust page shows the live PlatformConfig beside
the designed dials when the host has an RPC configured (`compareLivePlatform`).

## 7. Attestation and the trust ladder

Every attester is an ed25519 key with an informational kind tag (operator, zkTLS relayer, oracle). The program verifies only signatures
and the quorum; proof checking is off chain by design (`docs/burn-receipts/attestation.md`).

| Level | Configuration | Who could sign a false reading | Who holds the money | What remains trusted |
|---|---|---|---|---|
| 1 (launch) | the operator's keeper key, quorum 1 | the operator's key | nobody: the fee PDA has no withdraw path | the operator's read of the source; the visible, permanent record bounds the damage to wrongly sized burns |
| 2 | keeper plus an independent attester (second operator or zkTLS relayer), quorum 2 | two independent keys acting together | nobody | both attesters; with a relayer, the zkTLS provider |
| 3 | a quorum of independent operators or relayers whose proofs are public | a colluding quorum, against public proofs | nobody | the proof system and the source |

**Current status.** Level 1 is the launch design. Switchboard, the planned second signer, ended all oracle services on 2026-09-25; its
attester was built and removed from the program the same day (commit `f94089c5`). The replacements, a Reclaim zkTLS proof of the source
response posted by a relayer key and/or a second human operator, are not built; the decision log's "attester two within 14 days of the
first launch" is a schedule. For Kalshi no independent on-chain attestation exists: settlement is published through Kalshi's own API,
and reports of Kalshi markets tokenised on Solana through DFlow could not be confirmed from a primary source
(`docs/burnticker/README.md` §8). At every level the upgrade authority remains until finalised.

## 8. Verification walk-through: recompute one receipt

Take the $DEFICIT reading for 2026-10-08 used in the program's own memo tests (`src/memo.rs`).

**Step 1, the source.**

```sh
curl -s 'https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/debt_to_penny?fields=record_date,tot_pub_debt_out_amt&filter=record_date:eq:2026-10-08'
```

The row gives `40305316210829.72`; the previous business day gave `40284036147367.19`. The attested `src` field is the sha256 of that
exact URL; recompute it with `printf %s '<url>' | shasum -a 256` and compare with `Reading.source_url_hash`.

**Step 2, the signature.** Rebuild the canonical message of §4.4 from the Reading and TokenConfig and check each signature in the
`submit_reading` transaction's Ed25519 instruction against the attester keys listed in the TokenConfig.

**Step 3, the units.** `delta = 21,280,063,462.53` dollars. With carry 0 and a $1B unit, `units = floor(21,280,063,462.53 / 1,000,000,000) = 21`;
the remainder `280,063,462.53` carries into the next reading if that reading is also an increase.

**Step 4, the spend.** With `f = 1 %` and a pool basis of 1 SOL (1,000,000,000 lamports), `spend = 1,000,000,000 × (1 − 0.99^21) =
190,272,132` lamports by the program's fixed-point arithmetic (`buybackSpend` in `src/lib/burnReceipts/math.ts` gives the same). Then
apply the per-crank cap: if 2 % of the CPMM pool's WSOL reserve is smaller, the crank spends that and the Reading's
`carried_out_lamports` holds the rest. The memo's `pool=` is the basis actually used, so the arithmetic checks against the memo itself.

**Step 5, the swap and the burn.** The crank transaction is itself the swap and the burn. In its inner instructions find the CPMM
`swap_base_input` from the fee PDA's WSOL account, the SPL Token `Burn` from the fee PDA's token account (supply falls by `burn=`), and
the Memo CPI. Check that the swap's minimum output is at least the larger of the spot and TWAP quotes less `slippage_bps`.

**Step 6, the memo.**

```
DEBT|2026-10-08|src=fiscaldata.treasury.gov debt_to_penny|prev=40284036147367.19|now=40305316210829.72|delta=21280063462.53|units=21|pool=<lamports>|spent=<lamports>|got=<tokens>|burn=<tokens>|swap=<first 12 chars of the CPMM pool>|rules=sha256:<12>|v2
```

`swap=` carries the first 12 base58 characters of the pool, because one instruction cannot know its own transaction signature.
`burn` can exceed `got` when donated or fee tokens were also burned. `memoFromChain()` in `src/lib/burnReceipts/` rebuilds the memo
from accounts alone.

**For a Kalshi receipt**, step 1 is the settled market, for example
`curl -s 'https://api.elections.kalshi.com/trade-api/v2/markets?series_ticker=KXNFLGAME&status=settled'`: market
`KXNFLGAME-26OCT04DENSF-DEN`, status `finalized`, `result` `no`, settled `2026-10-04T23:41:27Z` (saved fixture
`config/burnticker/fixtures/kalshi/KXNFLGAME.settled.json`). Step 3 applies the locked rule to each settlement of the day; the counter's
`src` hash commits to the event ids counted.

**The public audit.** `scripts/burnticker-audit.mts` recomputes every receipt of every token from the recorded readings and the
published rule, writes `audit.json` and exits non-zero on any mismatch; it reads no key and sends nothing. Its chain leg (comparing each
memo on chain) is not wired: the script runs with no program client and reports "chain not checked".

## 9. Governance and custody

- **Squads 2-of-3 with a 48-hour time lock** (owner hardware key, owner second key, a trusted third party) is the planned holder of the
  upgrade authority, the platform authority and each token's config authority; the program's own 48-hour timelocks come on top.
  Commands: `docs/burn-receipts/README.md` §5.2. Not created yet.
- **Upgrade authority plan.** Deploy the verifiable build, hand the authority to the Squads vault, and after review set it to none
  (BPF Upgradeable Loader `SetAuthority` with no new authority, executed as a Squads vault transaction). The runbook's launch gate is
  that the mainnet launch is published only after `solana program show` prints `Authority: none` and the deployed hash equals the
  published verifiable hash (README §5.3). Until then, every "no extraction" property depends on the multisig not shipping a malicious
  upgrade.
- **LaunchLab platform admin, disclosed and untimelocked.** Raydium's `updatePlatformConfig` has no admin-change variant and the
  PlatformConfig PDA is seeded by the admin key, so the admin cannot be moved under Squads after creation (D-3). It can change the
  platform's fee rates, claim wallets, `cpConfigId`, `platformCpCreator` and LP scales for launches not yet migrated. Mitigations:
  `initialize_token` pins what matters; `verify-platform-pins` re-reads the platform immediately before each create and refuses on any
  difference; the stranding switch covers a change between init and migration; the trust page shows the live config.
- **Cranker allowlist during the cap.** `initialize_platform` may name up to 3 keys allowed to call `crank_buyback` while the cap is in
  force, against an outside cranker timing a multi-block TWAP hold. It can only be cleared, by the platform authority or any listed key,
  and lapses 90 days after `initialize_platform` or at the cap sunset, whichever comes first. Readings, vault cranks, claims and health
  checks stay permissionless.

## 10. Security review history

Burnticker is **not audited by a security firm**. The owner decided on 2026-10-09 against a paid audit, in favour of independent AI
reviews, free tooling and a public bounty. Reports are published as delivered:

| Round | Report | Findings | Outcome |
|---|---|---|---|
| Blind review 1 (2026-10-09) | [2026-10-09-claude-blind-1.md](reviews/2026-10-09-claude-blind-1.md) | 2 High, 4 Medium, 7 Low, 6 Info | no extraction path found; sandwich budget (H-1) and the fee-inflow routing (H-2) fixed |
| Blind review 2 (2026-10-10) | [2026-10-10-claude-blind-2.md](reviews/2026-10-10-claude-blind-2.md) | 5 Medium, 4 Low, 8 Info | sandwich bound via TWAP quote, attester takeover, stray-lamport wedge, quorum-2 transaction size, pool squatting fixed |
| Blind review 3 and re-check (2026-10-10) | [2026-10-10-claude-blind-3.md](reviews/2026-10-10-claude-blind-3.md) | 3 Medium, 6 Low, 6 Info; re-check 4 Low, 2 Info | callee signer abuse (M-1) closed; LP griefing, LaunchLab pinning and iterated attester takeover partly closed by design |

Each reviewer was a fresh Claude agent given the code, reading earlier reports only after writing its own findings. Every fix and its
closing test is in `docs/burn-receipts/CHANGELOG.md`. Review 3: no path that moves funds was added and no Critical or High issue found.

**Open or accepted after the re-check:** LP-ratio griefing by a deposit larger than the whole migrated liquidity; LaunchLab platform
admin changes between init and migration (launch gate plus stranding switch); attester proposals still need no consent from current
attesters (bounded by 48 h + 7 days + 48 h, all public); the Jito-bundle residual on pool-health observations; the multi-block TWAP
hold once the allowlist lapses; informational items I-3 to I-6 (`docs/burn-receipts/README.md` §8).

**Not done:** the ChatGPT review in the decision log; cargo-audit, Trident fuzzing and Sec3 X-ray (review 3 ran clippy with
`-D warnings`: clean); the bounty (5 to 10 SOL from the developer fee, terms drafted in `SECURITY.md`, not published).

## 11. Limitations and risks

- **Settlement coverage.** Without Kalshi, settled numbers exist only where a primary source has an independent cross-read: two of
  eleven categories today (§3.4). Everything else settles on Polymarket's payout vector or not at all, and Polymarket is binary-only.
  Coins launched on a Kalshi rule before 2026-10-10 carry the event-contract disclosure on every page.
- **LaunchLab is closed source.** The claim, the migration's pool address, `pool_creator` and LP handling rest on its SDK and docs, and
  have run only against a stand-in. Confirmation is a devnet-rehearsal gate, not done.
- **Sandwich bound.** A sandwich can take up to `slippage_bps` (≤ 3 %) of each crank's spend, itself at most 2 % of the reserve. A
  manipulator who holds the rate up for a full TWAP window can still shift a crank once the allowlist lapses.
- **Quorum 1 at launch.** The operator's key alone signs readings. A false reading is permanent and public, but it would size a burn.
- **Pre-audit cap.** Each crank's basis is capped at 25 SOL until the sunset; larger pools burn more slowly.
- **Upgradeable until finalised.** The upgrade authority can replace every property in this paper until it is set to none.
- **Oracle voids and late data.** A late source means no burn until it posts; a missed Treasury date cannot be inserted later (the
  next delta absorbs it).
- **No adoption of existing tokens.** `initialize_token` needs the new mint's signature and the fee PDA must be LaunchLab's creator
  from the first trade.
- **Per-outcome fractions unsupported.** A rule paying different fractions per outcome cannot be expressed on the current program.
- **Burns wait on the curve.** No buyback runs before graduation and pool registration.
- **Not built:** mainnet program deployment, second attester, the audit's chain leg, systemd units for the multi-token keeper and
  audit timer.

## 12. Open source and transparency

- **Public repository:** `TODO_PUBLIC_REPO_URL`. The program, keeper, platform, sites, docs, deploy files, tests and fixtures are carved
  out of a private monorepo by an explicit allowlist (`config/public-repo.allowlist`) and a leak scan
  (`config/public-repo.denypatterns`); the operator's trading code never leaves. Licence: MIT, brand assets excluded. Every publish
  appends the commit, program hash, IDL hash and allowlist hash to `docs/burnticker/CHANGELOG.md`.
- **Powers Register:** `docs/burn-receipts/powers-register.{md,json}`, generated from the IDL.
- **Decision log:** `docs/burnticker/decisions.md`, append-only. **Incident log:** `docs/burnticker/incidents/LOG.md` (no incidents
  recorded). **Review reports:** `docs/burnticker/reviews/`.
- **Wallet list:** `config/burnticker/transparency.json` names every role (operations, deployer, keeper, developer fee, LaunchLab
  platform admin, Squads vault and three members, the $DEFICIT mint, the operator's trading wallets). Every public key is TODO until set.
- **Policies:** no deletions on X, corrections in-thread with the receipt; no paid promotion; no talk of what any coin trades at; nothing
  described as forthcoming; the platform never buys any coin.
- **The operator also runs trading bots.** Every one refuses any platform coin by mint and ticker, fail-closed, in code
  (`src/lib/ownTokens.ts` reading `config/own-tokens.json`, both published).
- **The operator:** one independent operator (United States). Contact: contact@burnticker.com; security reports: security@burnticker.com.
- **How it was built:** with AI assistance (Claude Code) under the operator's direction and review.

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

### 13.3 Instructions (26, generated from `src/lib/burnReceipts/idl.ts`)

| Instruction | Arguments | Signers | Class |
|---|---|---|---|
| `initialize_token` | args | payer, creator, mint | creation |
| `initialize_platform` | authority, burn_pool_cap_lamports, cap_sunset_ts, crankers | payer, upgrade_authority | creation |
| `submit_reading` | record_date, value, source_url_hash, proof_hash | payer (+ quorum via Ed25519) | permissionless |
| `crank_buyback` | record_date | cranker | permissionless |
| `crank_vault` | record_date | cranker | permissionless |
| `crank_no_units` | record_date | cranker | permissionless |
| `claim_launchlab_creator_fee` | — | payer | permissionless |
| `register_pool` | — | registrar | permissionless |
| `register_pair_pool` | — | registrar | permissionless |
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
| `propose_cap_raise` | new_cap_lamports | authority | privileged |
| `cancel_cap_raise` | — | authority | privileged |
| `renounce_platform_authority` | — | authority | privileged |
| `clear_cranker_allowlist` | — | caller (authority or listed cranker) | privileged |

Events (28): AdminRenounced, AttesterChangeApplied, AttesterChangeCancelled, AttesterChangeProposed, BurnPoolCapBound,
BuybackQueueUnblocked, CapRaiseCancelled, CapRaiseProposed, CapRaised, CrankerAllowlistCleared, FeeKeyRegistered,
LaunchLabCreatorFeeClaimed, LockFeesClaimed, PlatformAuthorityRenounced, PlatformInitialized, PoolRegistered, PoolReplaced, PoolUntradeableCleared, PoolUntradeableFlagged,
ReadingProcessed, ReadingReset, ReadingSubmitted, RegistrationPolicyApplied, RegistrationPolicyCancelled, RegistrationPolicyProposed,
SpendCapBound, SpendCarried, TokenInitialized. Error codes: 77.

`pair_curve` (`src/lib/pairCurve/idl.ts`): `init_pair` (args; payer, creator — creation), the two curve-trade instructions (side, an
amount, a slippage bound; the trader signs), `graduate` (side; cranker), `lock_lp` (side; cranker — locks the side's LP forever, Fee
Key to burn_receipts' fee-keys PDA), `burn_lp` (side; cranker — the 30-day fallback if the lock refuses, the only path that destroys
LP), `claim_developer_fee` (caller), `void_pair` (caller), `close_pair` (caller) — every one after `init_pair` permissionless (9
entrypoints). Events (9): PairInitialized, Trade, PairCommitted, SideGraduated, LpLocked, LpBurnedFallback, DeveloperFeeClaimed,
PairVoided, PairClosed.

### 13.4 Memo grammars

Written on chain by the program (`src/memo.rs`), at most 566 bytes:

```
v1 (vault):   <PREFIX>|<YYYY-MM-DD>|src=<source>|prev=<v>|now=<v>|delta=<v>|units=<n>|burn=<tokens>[|short=<tokens>]|rules=sha256:<12>|v1
v2 (buyback): <PREFIX>|<YYYY-MM-DD>|src=<source>|prev=<v>|now=<v>|delta=<v>|units=<n>|pool=<lamports>|spent=<lamports>|got=<tokens>|burn=<tokens>|swap=<pool12|none>|rules=sha256:<12>|v2
```

For $DEFICIT the prefix is `DEBT` and the source `fiscaldata.treasury.gov debt_to_penny`. For a Burnticker counter token the prefix is
the ticker, the source `burnticker <selector>`, and `prev`/`now` are counter values.

The platform's per-event receipt line, v3 (`src/lib/burnticker/receipt.ts`), parsed and published by the platform; the current
program does not write it on chain:

```
BT|<TICKER>|<id>|oracle=<oracle>|market=<ticker>|result=<yes|no|void|->|settled=<ISO second or period>|src=<host+path>|value=<decimal|->|units=<n>|pool=<lamports>|spent=<lamports>|got=<tokens>|burn=<tokens>|swap=<sig12|none>|rules=sha256:<12>|v3
```

The signed attestation message (§4.4) is a separate grammar, `BURNRECEIPTS-v3`.

### 13.5 Addresses

| What | Address |
|---|---|
| `burn_receipts` program id | `TODO_PROGRAM_ID` (localnet test key `GV9CMjXPGbmXnn3ci3RjvTBpfdgiZ4Ts7UWu1LCnSuF8` is not a deployment) |
| Burnticker LaunchLab platform id | `TODO_PLATFORM_ID` |
| $DEFICIT mint | `TODO_DEFICIT_MINT` |
| Squads vault | `TODO_SQUADS_VAULT` |
| Developer fee wallet | `TODO_DEV_FEE_WALLET` |
| Raydium LaunchLab (mainnet) | `LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj` |
| Raydium CPMM (mainnet) | `CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C` |
| Raydium CPMM LP lock authority (mainnet) | `3f7GcQFG397GAaEnv51zR6tsTVihYRydnydDD1cXekxH` |
| SPL Memo | `MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr` |
| Mainnet genesis bound into signatures | `5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d` |

Source for the Raydium and system addresses: `programs/burn-receipts/programs/burn_receipts/src/constants.rs`.
