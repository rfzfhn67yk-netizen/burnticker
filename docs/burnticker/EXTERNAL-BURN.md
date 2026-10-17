# External burn targets: burn_receipts round 5 (status 2026-10-16: deployed on devnet and mainnet on 2026-10-15)

Owner, 2026-10-13: "is there another example where we can make the actual wif and bonk coins burn?" → "build it". Built on a branch
first (2026-10-13), then deployed with the review fixes on devnet and mainnet on 2026-10-15. Brief: `mct-runner-study/launch-debt-egg-2026-10-09/ROUND5-EXTERNAL-BURN-BRIEF.md`; the venue measurement and the
AMM v4 decision: docs/burnticker/EXTERNAL-BURN-VENUES.md.

## What a target coin does

A Burnticker coin may name a **burn target** before it exists: an existing plain SPL token (WIF, BONK, ...), its **Pyth price feed**, and
ONE pool of it against WSOL: a **Raydium CPMM** pool or a **Raydium AMM v4** pool (swap-only). The coin's burn pool (its fee SOL) is then
spent on the target instead of on itself. Each crank swaps SOL for the target on the pinned pool and burns everything it received, in the
same instruction, with a receipt memo naming the target mint and the amount burned. Everything else is unchanged: the coin's fees still come
from its own trading, and the rule, the share, the platform cap, the slices, pair forwarding (SOL moves between burn pools), the end sinks,
the attesters and the quorum all work at the SOL level exactly as before. Default stays self-burn.

Why AMM v4 too: CPMM admits almost no real target (measured 2026-10-13: of WIF, BONK, POPCAT, PENGU, FARTCOIN, MEW and TRUMP only PENGU has
a CPMM pool over the 50 SOL floor). AMM v4 admits WIF (27,631 SOL), POPCAT (16,783), FARTCOIN (37,319), MEW (43,117) and BONK (87).
BONK's, PENGU's and TRUMP's real depth is on Orca and Meteora, which are not in this round.

Coin vs Coin: each side may choose "Burn the real BONK" (per side). $TEAMBONK then burns actual BONK on BONK's days.

## Program (burn_receipts round 5)

| Piece | What it is |
| --- | --- |
| `TokenConfig.burn_target_kind` | The last spare byte (`reserved: [u8; 1]`): account size and offsets unchanged; every earlier config reads `0` = SELF. `1` = EXTERNAL. `2` = EXTERNAL whose own pool passed registration (the rollback fence, R5-12: such a coin keeps `pool_verified` false). |
| `CarriedPace` `["carried_pace", mint]` (round-5 review R5-8) | Not a target-coin account (crank_carried refuses target coins), listed here because it is round 5's other new account. 94 bytes: Anchor discriminator (8) · `version` u8 @8 (1; any other refused, `InvalidCarriedPace`) · `bump` u8 @9 · `mint` @10 · `last_carried_at` i64 @42 · `pieces` u32 @50 · `spent_lamports` u64 @54 · `budget_lamports` u64 @62 (the carried budget left after the last piece) · `reserved` [u8; 24] @70. Created by a coin's first `crank_carried` (the cranker pays the rent; an address someone pre-funded is topped up and taken over). The budget now = min(cap, `budget_lamports` + cap × min(now − `last_carried_at`, 600) / 600), cap = the per-crank cap now (2 % of the pool's WSOL reserve); a coin with no pace has a full cap. A piece above the budget, or a second piece in the same second, is refused (`CarriedTooSoon`): a dust piece takes only a dust budget. Read and written at those fixed offsets (state.rs, crank_carried.rs); the TS decoder is `accounts.ts decodeCarriedPace`. TokenConfig is untouched: it has no spare bytes left. |
| `BurnTarget` `["burn_target", mint]` | `target_mint`, `target_decimals`, `target_feed_id` (immutable), `pool_kind` (0 CPMM / 1 AMM v4), the pinned `pool`, `amm_config` (CPMM AmmConfig / AMM v4 vault authority), both vaults, `observation` (CPMM observation / the AMM v4 pool itself), orientation, totals, a pending re-pin. |
| `pin_burn_target(target_feed_id)` | Signed by the coin's MINT keypair, once, only while the mint account does not exist, buyback mode, no readings / burns / verified pool. Admission below, the Pyth check, records what it read. Launch order (launchBundle.ts launchTransactions): on LaunchLab, [initialize_token, pin_burn_target] as v0 against the lookup table (at most about 1,020 B), then the LaunchLab create in the next transaction (init + pin + create is over 1,232 B; a coin that burns itself is split the same way since 2026-10-15, [initialize_token] then the create); on the pair curve, the side's one transaction runs initialize_token, the pin, then the mint creation. |
| `crank_target_burn(record_date)` | Permissionless. The same spend as `crank_buyback`; the Pyth guard; at most 2 % of the pinned pool's SOL reserve; the swap (CPMM `swap_base_input` / AMM v4 `swap_base_in_v2`); post-CPI integrity of the fee PDA and its three token accounts; burns the target, then the coin's own fee tokens; memo v3. |
| `release_target` (round-5 review R5-6) | Permissionless. A stalled target coin (last target event a 30-day unblock, no burn since, 30 days since its last burn or pin, no reading waiting) moves its carried spend, and only that, to the flagship's fee PDA. |
| `propose_target_pool` / `cancel_target_pool` (admin), `veto_target_pool` (any attester), `apply_target_pool` (anyone) | Re-pin the POOL (either kind) for the same token and feed: 48 h, until 14 days after the proposal, the same admission and Pyth check. |
| `crank_buyback` | One added check: `burn_target_kind == SELF` (else `BurnTargetSet`). |
| `initialize_token` | Unchanged: round 4's bytes. |

### Admission (pin and re-pin; the pool half again at every crank)

- Target: plain SPL Token (Token-2022 refused), not the coin, not WSOL, **no freeze authority, no mint authority**.
- CPMM pool: mints exactly {target, WSOL} on SPL Token, swaps enabled, fee (trade + creator when charged) ≤ 1 %, SOL reserve net of owed
  fees ≥ 50 SOL (devnet build 2 SOL).
- AMM v4 pool: owner 675kPX9M… (devnet DRaya7Kj…), AmmInfo 752 bytes, **status 6 (swap-only; no OpenBook orders)**, mints {target, WSOL},
  the vault authority passed = create_program_address(["amm authority", nonce]), swap fee ≤ 1 %, SOL reserve = vault − need_take_pnl ≥
  50 SOL. Layout from raydium-amm d26944bf, checked against five live mainnet pools.
- The pool's LP need not be locked and its creator is not checked: **the pool is not ours.**
- **Pyth at pin / re-pin:** both feeds fresh (≤ 60 s), confidence ≤ 1 %, fully verified, and the pool's spot within the rule's
  deviation of the Pyth ratio (two-sided). A feed that is not this token's market cannot be pinned.

### The price guard (both pool kinds)

The reference is Pyth's target/SOL ratio: `(SOL/USD ÷ target/USD) × 10^(target_decimals − 9) × 2^32`, from two PriceUpdateV2 accounts of
the Pyth receiver (rec5EKMG…): owner, discriminator, **Full** verification, the pinned feed id / the compiled SOL/USD id. A crank:
1. reads both prices: an account that is not the receiver's, not Full, or of another feed is refused outright (`TargetPythInvalid`); a price
   older than 60 s, a publish time more than 60 s in the future, a confidence over 1 % or a non-positive price **holds** the crank
   (`PythStale` / `PythUnusable`);
2. requires the pool's spot within `max_twap_deviation_bps` of the Pyth ratio **both ways**, else holds (`TargetPriceDeviation`);
3. CPMM only: the pool's own TWAP check as before (`TwapUnavailable` / `TwapDeviation`, deferrals as in crank_buyback);
4. min-out = the larger of the spot, Pyth and (CPMM) TWAP quotes, each less the pool fee and `slippage_bps`.

Why Pyth and not the pool: AMM v4 has no observation ring, and any reference the program records from the pool can be forged with a Jito
bundle of separate transactions (push, record, push back). No trade on the pool moves Pyth. The LiteSVM suite runs the attack against the
real raydium-amm program: a push as its own transaction then the crank, and push + crank in one v0 transaction: both refused, nothing
leaves the fee PDA; after the push back the same Pyth price burns at the market.

### The cap

At most **2 % of the pinned pool's SOL reserve** per crank (`MAX_SPEND_RESERVE_BPS`); the rest is carried. After the platform cap's sunset
this is the only bound: tested on a 5,000 SOL AMM v4 pool (100 SOL per crank), with a pushed pool refused at that size.

### Held, never lost

Every "not now" reason (pool gone / off / changed / fee above 1 % / under the floor; Pyth stale / wide / future; pool away from Pyth) refuses
the crank and moves nothing. 30 days after the reading's `submitted_at`, the crank processes it below-floor with its whole spend carried, so
the queue never wedges; the carried spend is spent when the pool and the price are healthy again or after a re-pin.

### Receipts

Memo v3 `…|pool=…|spent=…|got=…|burn=…|target=<mint>|own=…|swap=<pool 12>|rules=sha256:<12>|v3`; the Reading's `got`/`burned` are the
target's raw units, `owed` the coin's own tokens burned. Events: `BurnTargetPinned` (with the pool kind, feed id, reference and spot),
`TargetBurned` (with the reference), `TargetPoolProposed`, `TargetPoolProposalCancelled`, `TargetPoolRepinned` (with the kind).

## What the creator can and cannot do

Can: choose a target token, its Pyth feed and one CPMM or AMM v4 pool, once, before the coin exists; per side in a Coin vs Coin race.

Cannot: change the token or the feed after the mint exists; point the crank at any other pool or program; move the SOL anywhere but the
pinned pool's vault in exchange for the target that is then burned; re-pin the pool (only the admin, the Squads vault, with 48 hours of
notice and an attester veto, to a pool that passes the same checks); pin a feed the pool's market disagrees with; control or lock the
target's pool.

## Client, keeper, site

- `src/lib/burnReceipts/burnTarget.ts`: PDA, decoders (BurnTarget, AmmInfo, PriceUpdateV2), the sponsored-feed PDA, admission + Pyth from
  chain (`checkTargetAdmission(…, { feedId })`), the quote, the six builders (Pyth accounts default to the sponsored feeds).
- Keeper: `planCrank` kind `target` (CU + three ATA creates + SyncNative + crank: 1,180 B CPMM / 1,116 B AMM v4); the six hold errors are
  waits ("target pool unhealthy …"); the multi keeper names the target; the single-coin keeper refuses a target config.
- Rules: `burnTarget: { mint, pool, symbol, feedId }` (hashed). Site copy in `src/lib/burnticker/burnTarget.ts`. API:
  `GET /api/burnticker/burn-target?mint=&pool=&symbol=&feed=`. Admin CLI: `pin-burn-target`, `check-target --feed`, `target-status`, the
  re-pin commands. Host flag `BURNTICKER_INITIALIZE_TOKEN_LAYOUT=r5`.
- **Pyth updates.** The keeper uses Pyth's sponsored (push) feed accounts (`[0u16, feed id]` under pythWSnswVUd…, Full verification).
  Live on mainnet 2026-10-13 for SOL, WIF, BONK, FARTCOIN, MEW, TRUMP (ages 17–56 s); POPCAT's and PENGU's sponsored accounts were ~55
  days stale. Posting a fresh Hermes update from the keeper was **not built**: a Full-verification post needs the encoded-VAA flow over
  several transactions (an atomic post is only Partial and the program refuses Partial), it does not fit in the crank transaction, and the
  Pyth receiver SDK is not a dependency here. Until it is, a target whose sponsored feed is stale stays held.

## Reviewer risk list (round 5)

1. **Program size:** 826,384 → 967,304 bytes (mainnet build; VERIFIED-BUILD.md); both clusters need
   `solana program extend` before the upgrade.
2. **Pyth is now in the trust base** of every target burn: a wrong or compromised Pyth price within the deviation band can shift min-out
   by up to the band; the pool-vs-Pyth band (two-sided, the rule's 1.25–3 %) and slippage (≤ 3 %) bound it. A Pyth outage holds target
   burns (30-day unblock carries).
3. **Pin-time feed check** is the only binding of feed to token: a creator could pin another token's feed only if that feed's price
   matches this pool within the band at pin time.
4. **AMM v4 layout by offset** (raydium-amm d26944bf, 752 bytes, swap-only): a Raydium upgrade that changes AmmInfo or the swap-only reserve
   rule would make the reads wrong; the crank re-checks status, vaults, authority and fee every time. The fixture is built from source, not
   the deployed binary.
5. **Duplicated swap path** in `crank_target_burn` (vs `crank_buyback`); fixes must be applied twice.
6. **The pool is not ours:** LPs can withdraw (held), anyone can push it out of band to hold a crank (cost: the push), and at the 30-day
   mark force a carry (spend stays owed).
7. **Staleness 60 s** against sponsored feeds that update about once a minute: some cranks will be held and retried; POPCAT/PENGU need
   a keeper-posted update path (not built).
8. **Pinning order:** the pin must precede mint creation; pair_curve's "create mint + initialize_token" transaction must be reordered.
9. **Rollback hazard:** round 4 would read `burn_target_kind` as reserved and self-burn a target coin's fuel once its own pool is verified.
   Fenced since the 2026-10-14 fixes (R5-12): a target coin's own-pool registration leaves `pool_verified` false, so round 4 refuses to
   crank it (PoolNotVerified). The fence does not cover a FIXED-policy target coin (round 4's `register_pool` would verify it again). The
   rule stays: no program rollback while any BurnTarget-pinned coin holds fuel (docs/burnticker/ROLLBACK.md).
10. **Field reuse:** `Reading.owed` = own-coin burn on target readings; `TokenConfig.total_burned` counts own tokens only.
11. **Admin re-pin trust:** the vault can re-pin to any pool passing admission + Pyth; the veto keys are the operator's.
12. **Public docs move early:** the powers register, whitepaper and CHECK-THIS-YOURSELF describe round 5 before deploy ("built, not deployed").
13. **The incinerator end sink (same round):** `burn_sol_on_end` is a fifth way SOL leaves a fee PDA, only after a quorum-signed RESOLVED
   end, only for a coin whose pinned EndSink kind is INCINERATOR, only to `1nc1nerator11111111111111111111111111111111` (address-checked).
   It closes the fee PDA's WSOL account to unwrap it and creates it again in the same instruction (the cranker's ATA rent refunded from
   the account's own rent); review that close/re-create pair. Sends under an empty account's rent-exempt minimum wait. docs/burnticker/END-SINK.md.
14. **Deliberate restriction, no self-burn on the losing path:** `initialize_token_r5` refuses a buyback coin without an end sink
   (`LostPathBurnsSelf`). It is a second create entrypoint with initialize_token's accounts and arguments; `initialize_token` itself is
   retired since the 2026-10-14 fixes (R5-5): every deployable build refuses it with `InitializeTokenRetired` (same discriminator), and
   `pin_burn_target` requires the coin's EndSink. Only the `test-pins` LiteSVM build keeps the old create (feature `legacy-init`), so the
   round-4 suites can still model coins round 4 created.

## Round-5 blind review fixes (2026-10-14)

From ROUND5-BLIND-REVIEW-CLAUDE-2026-10-14.md and a second review's R5-01. Program size (local, non-verified `cargo-build-sbf`, default
features): 1,019,048 bytes, up 21,248 from the reviewed round 5 (997,800) and 192,664 from round 4 (826,384); the ProgramData account must
be extended by at least the difference before the upgrade.

| Finding | Change |
| --- | --- |
| R5-1 end gate | `forward_on_end` / `burn_sol_on_end` skip the "readings processed" wait only for a SELF coin with no registered pool (`end::end_readings_done`). A target coin always waits for its result reading. |
| R5-2 band vs min-out | A pool inside the deviation band but under the Pyth min-out, a missing CPMM TWAP and a TWAP away from spot are holds (the 30-day unblock runs), not hard reverts. Chosen over "slippage at least deviation at pin" because it touches only `burn_target.rs` (the self path stays byte-identical) and also covers the TWAP refusals. |
| R5-3 VOID | `crank_carried` runs after any end (VOID included). `RuleNotLive` stays in the error list, unused. |
| R5-4 order | For 30 days after a RESOLVED end, the end paths leave a SELF coin's carried spend (verified pool) in the fee PDA and do not clear it, so `crank_carried` burns it on the coin first; after that they move everything and clear it, so nothing can strand. Chosen over refusing `submit_rule_end` while carry is owed, which would strand the fuel of a coin whose pool is dead. |
| R5-5 create | `initialize_token` refused in every deployable build (`InitializeTokenRetired`); `pin_burn_target` takes the coin's EndSink account and refuses without it (`LostPathBurnsSelf`). |
| R5-6 liveness | `release_target` (above). Minimal version: the destination is always the flagship ($DEFICIT), not the coin's own end sink. Not done: routing by EndSink kind (named coin, incinerator). |
| R5-7 Pyth | BurnTarget stores the last accepted SOL and target publish times (pin, re-pin, each swapping crank); an older update is refused (`PythWentBackwards`); the two updates must be within 60 s of each other (`PythFeedSkew`, a hold). |
| R5-01 (second review) | `pyth::within` no longer saturates: an overflowing product refuses. A publish time more than 5 s ahead of the clock is unusable (it was 60 s). |
| Second review (A) stale snapshot | The crank's (and pin's, re-pin's) two price accounts must be the feeds' SPONSORED push-oracle accounts, PDA([0u16 LE, feed id]) under `pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT` (address-checked: `TargetPythInvalid`, hard). Anyone may refresh those accounts and nobody can roll them back, so their content (stale, wide, missing) is the feed's state and stays a hold; the 30-day unblock now means the feed really stopped, and a caller can no longer settle a healthy target's reading with an old snapshot. This also closes R5-10. A keeper that needs a fresher price posts it into the sponsored account (push oracle `update_price_feed`) before cranking. |
| Second review (B) decimals | `raw_to_tokens` splits a decimal string (any u8 decimals; the old version overflowed at 20); a target mint with more than 18 decimals is refused at admission (`TargetDecimalsTooLarge`). |
| Second review (C) holds | Inside the crank, a failure to load the pinned pool's reserves, fee or AmmConfig, a missing or unreadable CPMM TWAP and a quote that overflows are holds (the 30-day unblock applies), not `?` reverts. |
| R5-12 fence | A target coin's own-pool registration (`register_pool`, `register_pair_pool`, `replace_pool`, `apply_registration_policy`) leaves `pool_verified` false and sets `burn_target_kind = 2`; round-5 readers use `own_pool_verified()`. |

BurnTarget's 32 reserved bytes became `last_sol_publish_time`, `last_target_publish_time`, `last_burn_at` and `last_unblocked_at` (size
unchanged, 373 bytes; no BurnTarget exists on chain yet). New errors: `InitializeTokenRetired`, `PythWentBackwards`, `PythFeedSkew`,
`TargetNotStalled`, `TargetDecimalsTooLarge` (141 in all). New event `TargetReleased` (45). New instruction `release_target` (43).

### Keeper rules after these fixes

1. After a RESOLVED end of a self coin with a carried spend, run `crank_carried` in pieces until the carry is zero, then `forward_on_end`
   or `burn_sol_on_end`. The program enforces the order for 30 days (the end paths leave the carry in place); after 30 days the end path
   takes what is left.
2. After a VOID end, keep running `crank_carried` on whatever the wind-down carried.
3. A target coin whose last reading was processed by the 30-day unblock and that has not burned for 30 days: call `release_target`. It
   moves only the carried spend, to $DEFICIT's fee PDA.
4. Pass the feeds' sponsored push-oracle accounts (the only ones accepted). If one is stale, post a fresh update into it first; the two
   must be published within 60 s of each other.

### Still open from the review

R5-8 and R5-9 are fixed in round 5 (owner, 2026-10-15; the two checklist errata of 2026-10-15): `crank_carried` spends from a per-coin
carried budget, one per-crank cap per 600 seconds up to one cap, one piece per second (the `CarriedPace` account, a separate account
because TokenConfig has no spare bytes after `burn_target_kind`; pieces counted apart from `burns`), and a target coin whose BurnTarget is
pinned and not stalled (no 30-day unblock since its last target burn) is live for pair forwarding and as a named end sink before its own
pool is verified. Still open: R5-11 (rehearse `burn_sol_on_end`'s close and re-create of the WSOL account against the real Token program),
R5-13 to R5-16 (notes). R5-10 is mostly closed by the sponsored-account binding (second review A); what is left is timing: if a feed's
sponsored account is genuinely stale at the moment a 30-day-old reading is cranked, that reading settles below floor.

## Not done (owner steps)

The devnet upgrade and run (`DEVNET-ROUND5-TEST-PLAN.md`), the round-5 blind review, the mainnet upgrade through the Squads vault, the
verified-build table, the page wiring (`WIRING-ROUND5.md`), the keeper's Hermes posting path, Orca / Meteora (EXTERNAL-BURN-VENUES.md §3).
