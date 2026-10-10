# Burnticker: event-indexed burns with on-chain receipts

Technical paper, draft 1, 2026-10-10. Written from the code and documents of the Burnticker repository at commit `76b9caa`. Every
statement names its source file; where a component does not exist, this paper says "not built" or "not done".

**Status at the time of writing.** Nothing is deployed on devnet or mainnet and no real key exists.

| Component | State | Source |
|---|---|---|
| `burn_receipts` program (Anchor 1.2.1) | built; 82 Rust tests and the TS suites pass; localnet only | `docs/burn-receipts/README.md`, `CHANGELOG.md` |
| $DEFICIT keeper and Burnticker multi-token keeper | built; run against the program in a local end-to-end test; pages run on `FakeBurnProgram` | `docs/burnkeeper/README-execution.md` |
| Devnet rehearsal, mainnet rehearsal coin | not done | `docs/burnticker/REHEARSAL-RUNSHEET.md` |
| Program deployment, program id, verifiable hash | not done | `docs/burn-receipts/README.md` §5.4 |
| Second, independent attester | not built | `config/burnticker/transparency.json` (`switchboard-down`, `quorum-1`) |
| Public repository | not created | `docs/burnticker/transparency.md` §3 |
| Bug bounty | terms drafted, not published | `config/public-repo/overlay/SECURITY.md` |
| Security firm audit | none, by decision | `docs/burnticker/decisions.md` (2026-10-09, Audit) |

## 1. Abstract

Burnticker is a launchpad for Solana memecoins whose supply burns when an adjudicated real-world event settles. A creator binds a coin
to a selector over a resolution source, usually a Kalshi series, and to a mapping from outcomes to burns. The rule is hashed and locked
when the coin is created. When an event in the selector settles, attesters sign the settled reading, and the `burn_receipts` program
spends a share of the coin's own creator-fee pool buying the coin on its Raydium CPMM pool and burns every token it receives, in one
instruction that also writes a memo with the reading, the arithmetic and the rule hash. Anyone can recompute that memo from the public
source and the published rule. Burnticker is run by one independent operator, reachable at contact@burnticker.com; the operator’s identity is held privately until a legal entity is formed. It is not an investment product: a
coin pays nothing on any outcome, holds no position in any market, and the rule says what the supply does, not what the price does.
The program is not audited by a security firm.

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
| `oracle` | `kalshi` or `catalogue` are live; `polymarket`, `uma`, `drift-bet`, `hedgehog` are parsers and stubs, not launchable |
| `series` + `filter` | every present and future market of the series whose ticker contains the text and/or whose title matches a regex |
| `market` | one market ticker: a one-shot rule that resolves once, after which the supply is fixed |
| `kind: binary` | reads Kalshi's `result` (yes/no); `onYes` / `onNo` give the burn for each outcome |
| `kind: scalar` | reads the settled number and counts `unit`s from a baseline (`previousSettlement` or a number) in a direction (`up`, `down`, `abs`) |
| `fractionOfPool` / `tokens` | buyback mode: fraction `f` of the burn pool per unit (1 % to 10 %); vault mode: tokens per unit |
| `onVoid` | `skip`, the only policy |
| `pair` | rivalry pairs (§5): `pairId`, `side`, `counterpartMint` |

**Locking.** `lockRule` serialises the validated rule as canonical JSON (keys sorted, two-space indent, trailing newline) and hashes
those bytes with sha256. The hash goes into `TokenConfig.rules_sha256` at `initialize_token`, into the token description's footer and
into every on-chain memo as `rules=sha256:<first 12 hex>`. No instruction changes it. A different rule is a different coin.

**Finality.** A Kalshi market counts when its status is `finalized`, or `settled` once `settlement_ts + settlement_timer_seconds` has
passed (`src/lib/burnticker/oracle/kalshi.ts`). The rule reads settled results only, never prices; the token page's "market-implied chance of the next
burn" is labelled display-only.

### 3.2 Sources

**Kalshi settlements are the primary source.** Kalshi publishes settled results through a public, keyless API
(`https://api.elections.kalshi.com/trade-api/v2`), each series carrying its own `settlement_sources` (for example BLS, the Fed, a
sports league). The selector binds to that adjudicated result, not to the underlying data. The landing-page copy of 2026-10-10 counts
14,934 Kalshi series: sports 3,883, entertainment 2,582, elections 2,276, politics 2,193, financials 1,001, economics 852, weather 422,
science and technology 372, crypto 276, other categories 1,077 (source: `docs/burnticker/README.md` on branch
`agent/RIVAL-2026-10-10`, commit `c0eb7ed`).

**First-party feeds are the advanced path.** `config/burnticker/sources.json` holds 30 sources read through one generic adapter
(`src/lib/burnticker/sources/attestedHttp.ts`): Treasury, BLS, NOAA, Launch Library 2, JPL, Wikimedia and others, each with a saved
fixture, plausibility bounds and a fixed unit, direction, baseline and carry. Key-required sources are present but not launchable.

**$DEFICIT is the stated exception.** The operator's own first coin reads U.S. Treasury "Debt to the Penny"
(`tot_pub_debt_out_amt`) directly: every full $1,000,000,000 added since the previous business day is one unit, remainders carry only
across consecutive increases, and each unit spends 1 % of the burn pool (`config/burnkeeper/deficit.rules.json`).

**Refused regardless of source** (`config/burnticker/refuse.json`, applied at create time): deaths, violence, terror, casualty counts,
disasters and named private individuals; names that claim to be official; any selector on the coin's own trading (never the token's price). Elections are allowed.

### 3.3 Tiers: what a skeptic can verify at each

| Tier | Source kind | Admission | What a skeptic verifies | What stays trusted |
|---|---|---|---|---|
| 1 | adjudicated market (Kalshi live; Polymarket, Drift BET, Hedgehog stubs) | settled results only; finality window respected; voids never burn | the settled market JSON (public, keyless) and the series' settlement source; the memo's `units` from the rule | Kalshi's adjudication and API availability; the attesters' honesty about the read |
| 2 | optimistic assertion (UMA, stub) | counts only once settled and not disputed-and-lost | the assertion's settlement on chain | UMA's dispute process |
| 3 | primary API attested by a TEE or zk job | third-party asset rates allowed from here up | the job definition and the oracle's on-chain record | not wired: Switchboard, the planned provider, ended service on 2026-09-25 |
| 4 | primary API read by the keeper | no asset rates; one real fixture; plausibility bounds; complete periods only | the exact source row with the `curl` in every receipt | the attesters (quorum 1 at launch: the operator) |
| 5 | page-scraped | owner's approval per source; regex pinned to the markup | the page and the regex | the page's editorial number and the attesters |

Source: `docs/burnticker/README.md` §6 and `docs/burnkeeper/attestation.md` §1.

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

`register_pool` (permissionless, once) accepts only LaunchLab's own migration pool:

1. the token's LaunchLab pool (`["pool", mint, WSOL]` under LaunchLab) records the fee PDA as creator, CPMM as its migration destination,
   and the platform pinned at init;
2. the CPMM pool is the deterministic PDA `["pool", cpConfigId, token0, token1]` of the `cpConfigId` pinned at init;
3. its `pool_creator` is the fee PDA;
4. at least 50 % of its live LP supply is burned or held by Raydium's LP lock (`ATA(LOCK_CPMM_AUTH, lp_mint)`). This is a minimum under
   the provenance proof: to block registration a griefer must deposit more than the whole migrated liquidity and leave it there.

The mint must have no mint authority and no freeze authority. Burnticker's platform burns 100 % of graduation LP (§6), so a correct
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

## 6. Economics

Fee dials were read from the pinned Raydium SDK, Raydium's documentation and the live config accounts (`docs/burnkeeper/fees.md`;
designed values in `src/lib/burnticker/fees.ts`).

| Phase, per unit of volume | Raydium | Burnticker (developer) | Burn pool (fee PDA) | Nobody |
|---|---|---|---|---|
| Bonding curve (LaunchLab) | 25 bps | 25 bps (platform `feeRate` 2,500 ppm) | 50 bps (`creatorFeeRate` 5,000 ppm, the maximum) | none |
| After graduation (CPMM tier 0, 25 bps trade fee) | 4 bps of trade fee + 0.25 bp (5 % of the creator fee) | 0 | 4.75 bps (Raydium's fixed 5 bps creator fee, less 5 %) | 21 bps (the burned LP's share of LP fees) |

- **All graduation LP is burned** for every coin (`platformScale 0`, not creator-configurable), so the developer's post-graduation take
  is 0.
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

- **Kalshi dependency.** Kalshi results are read off chain from Kalshi's API and signed by the attesters. Kalshi can delist or void a
  series (voids never burn). Kalshi's API terms on redistribution have not been reviewed. A coin tracking a CFTC event contract's
  resolution is disclosed as such on every oracle-backed page; the owner decided to proceed without a lawyer.
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
- **Not built:** program deployment, devnet rehearsal, second attester, the audit's chain leg, systemd units for the multi-token keeper
  and audit timer, the public repository, the operator contact address.

## 12. Open source and transparency

- **Public repository:** `TODO_PUBLIC_REPO_URL`. The program, keeper, platform, sites, docs, deploy files, tests and fixtures are carved
  out of a private monorepo by an explicit allowlist (`config/public-repo.allowlist`) and a leak scan
  (`config/public-repo.denypatterns`); the operator's trading code never leaves. Licence: MIT, brand assets excluded. Every publish
  appends the commit, program hash, IDL hash and allowlist hash to `docs/burnticker/CHANGELOG.md`.
- **Powers Register:** `docs/burn-receipts/powers-register.{md,json}`, generated from the IDL.
- **Decision log:** `docs/burnticker/decisions.md`, append-only. **Incident log:** `docs/burnticker/incidents.md` (no incidents
  recorded). **Review reports:** `docs/burnticker/reviews/`.
- **Wallet list:** `config/burnticker/transparency.json` names every role (operations, deployer, keeper, developer fee, LaunchLab
  platform admin, Squads vault and three members, the $DEFICIT mint, the operator's trading wallets). Every public key is TODO until set.
- **Policies:** no deletions on X, corrections in-thread with the receipt; no paid promotion; no talk of what any coin trades at; nothing
  described as forthcoming; the platform never buys any coin.
- **The operator also runs trading bots.** Every one refuses any platform coin by mint and ticker, fail-closed, in code
  (`src/lib/ownTokens.ts` reading `config/own-tokens.json`, both published).
- **The operator:** one independent operator (United States). Contact address: TODO (`OPERATOR_CONTACT_TODO`).
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

### 13.3 Instructions (23, generated from `src/lib/burnReceipts/idl.ts`)

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

Events (26): AdminRenounced, AttesterChangeApplied, AttesterChangeCancelled, AttesterChangeProposed, BurnPoolCapBound,
BuybackQueueUnblocked, CapRaiseCancelled, CapRaiseProposed, CapRaised, CrankerAllowlistCleared, LaunchLabCreatorFeeClaimed,
PlatformAuthorityRenounced, PlatformInitialized, PoolRegistered, PoolReplaced, PoolUntradeableCleared, PoolUntradeableFlagged,
ReadingProcessed, ReadingReset, ReadingSubmitted, RegistrationPolicyApplied, RegistrationPolicyCancelled, RegistrationPolicyProposed,
SpendCapBound, SpendCarried, TokenInitialized. Error codes: 66.

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
