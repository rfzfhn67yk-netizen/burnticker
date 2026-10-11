# pair_curve — blind adversarial review 1 (2026-10-10)

Reviewed commit: **547558fa** (`fix/price-integrity-and-engine-correctness`). Scope: `programs/burn-receipts/programs/pair_curve/`,
burn_receipts `register_pair_pool` / policy 2 / `src/pair_curve.rs`, `src/lib/pairCurve/`, `src/lib/burnKeeper/pairCurveCrank.ts`,
`src/lib/burnticker/pairCurveLaunch.ts`, `scripts/paircurve-admin.mts`, `scripts/squads-program-upgrade.mts`.

Method: §1–§3 were written **before** reading `docs/burnticker/PAIR-CURVE.md` or any file in `docs/burnticker/reviews/`; §4 was added
afterwards. Exploit tests were written in a scratch file (`programs/pair_curve/tests/review_pc1.rs`, not committed; harness = the
first 400 lines of `tests/lifecycle.rs`) and run against the real pair_curve, burn_receipts and Raydium CPMM builds in LiteSVM 0.17
(LiteSVM's default `with_mainnet_features()`, the mainnet feature list of 2026-09-27). Baseline: pair_curve 14/14 LiteSVM + 9/9 unit,
burn_receipts all suites, TS `pairCurve*` 27/27 — all pass at 547558fa (the two IDL tests need `target/idl/*.json` from `anchor build`).

## Findings table (most severe first)

| # | Sev | Title | Where | Status |
|---|---|---|---|---|
| H-1 | High | `close_pair` deletes the Pair record `register_pair_pool` needs; anyone can bundle `graduate(B)` + `close_pair` and strand both burn pipelines forever (no recovery path) | void_pair.rs:40,67-73; register_pair_pool.rs:53; admin.rs:290-296; register_pool.rs:73 | reproduced |
| H-2 | High | An executable developer wallet freezes every buy **and every sell, including void exits** — the dev-wallet key holder can lock all curve SOL | trade.rs:69-75,102,167 | reproduced |
| M-1 | Medium | The 25 bps "developer wallet" is whatever LaunchLab platform the creator pins — any creator can take it (and so can trigger H-2) | initialize_token.rs:168-175; init_pair.rs:140-150 | reproduced |
| M-2 | Medium | "No admin / no withdraw" holds only at instruction level: pair_curve is upgradeable by a 2-of-3 Squads vault with a 60 s time lock | devnet run log §D | by inspection |
| L-1 | Low | The first `graduate` commits the pair without checking the other side can still pay for its pool at the current AmmConfig fee | graduate.rs:94-100,130 | by inspection (authors' test covers the effect) |
| L-2 | Low | A pair can sit in Graduating forever (stuck side sold out → B can never graduate, `close_pair` NotClosable); rent stranded, no terminal state | graduate.rs:130; void_pair.rs:71-75 | reproduced |
| L-3 | Low | The 3-day "stuck side" rule fires on mere crank inactivity, not only on a Raydium block (comment says otherwise) | constants.rs:21-24; trade.rs:149-152 | reproduced |
| I-1 | Info | Zero-lamport buys deliver the rest of a ceil step after a sell leaves `sold` mid-step (≤ 1 lamport of value) | math.rs:77-90 | reproduced |
| I-2 | Info | `net_budget(u64::MAX)` overflows (panic → tx abort) | math.rs:68 | reproduced |
| I-3 | Info | SOL vault is never closed; a voided pair whose holders burned/lost tokens never closes; an executable creator blocks `close_pair` | void_pair.rs | by inspection |

## 1. Blind findings

### H-1 (High) — `close_pair` strands registration, permanently

`close_pair` (void_pair.rs:40 `close = creator`) is permissionless the instant status is Graduated, and closes the Pair account.
`register_pair_pool` proves provenance by loading that account (register_pair_pool.rs:53 → pair_curve.rs:49 owner check). Once it is
closed, neither side can ever register: re-init is impossible (mint authority revoked), and the burn_receipts fallback cannot help —
`apply_registration_policy` with POOL_POLICY_FIXED runs `verify_pool_provenance`, which requires `pool_creator == fee PDA`
(admin.rs:296 → register_pool.rs:73), while the pair's pools have `pool_creator == pair vault`. Policy 0 needs a LaunchLab pool. So the fee PDAs (75 bps of all
curve volume plus graduation residue) are stranded forever and the burn mechanic never runs, short of a burn_receipts upgrade.

Exploit (test `pc1_close_pair_before_registration_strands_the_burn_pipeline`): the keeper sends `graduate(A)+register(A)` (best case);
the attacker, watching, sends `[graduate(B), close_pair]` in one transaction (both permissionless, ~5,000 lamports). Then
`register_pair_pool(B)` fails with `InvalidPairAccount` (6066), and `config_B.cpmm_pool` stays default. If a third party graduated A without
registering it, both sides are lost (`pc1_close_pair_right_after_graduation_blocks_both_registrations`). The keeper (pairCurveCrank.ts)
cannot win this race: the second side is always front-runnable.

Fix (any one; first two together are best): (a) `close_pair` must not close the Pair account (close only the token vaults; ~0.006 SOL);
(b) `close_pair` on Graduated requires both TokenConfigs (owner + PDA checked) to show `pool_verified && cpmm_pool == pools[i]`;
(c) make `register_pair_pool` independent of the Pair account: the pool address `["pool", PDA(mints), side]` under pair_curve plus
`pool_creator == ["vault", pair]` already prove only `graduate` made it (pass the other mint to rederive the pair).

### H-2 (High) — an executable developer wallet freezes all trades and exits

Every buy and every sell credits `pair.dev_wallet` through a System-program CPI (trade.rs:102,167). `dev_can_receive` (trade.rs:69-75)
only checks rent. In the runtime (solana-program-runtime 4.3.0 `cpi.rs:1014`) an **executable** account passed to a CPI is never mapped back
into the caller's serialized view; when pair_curve returns, `deserialize_parameters` (serialization.rs:646) writes pair_curve's stale,
lower lamport value back, which fails with `ExternalAccountLamportSpend`. The dev wallet is fixed at init, but the account at that address
can become executable later: its key holder signs `Allocate(36)` + `Assign(BPFLoaderUpgradeable)` and deploys any program there.

Test `pc1_executable_dev_wallet_controls`: dev address replaced by a copy of a real deployed loader-v3 program account → buy FAILS and
sell FAILS (`ExternalAccountLamportSpend`); the same account with `executable = false` → both succeed (control).
`pc1_executable_dev_wallet_after_init`: after `void_pair`, the holder's exit sell fails. Consequence: no buys, no sells, no void exits
ever again for every pair recording that wallet; unless the pair is already at target (graduate does not touch the dev wallet), all curve
SOL is locked permanently. Actor: the developer for official pairs (a de facto kill switch, contradicting "no admin"); **any creator**
via M-1.

Fix: do not push to the dev wallet inside trades. Accrue the dev slice in a pair_curve PDA (or in `Pair`) and add a permissionless
`claim_dev_fees` that pays the recorded wallet; at minimum add `|| dev.executable` to the redirect condition in `dev_can_receive`.

### M-1 (Medium) — the developer wallet is creator-chosen

`initialize_token` pins whichever LaunchLab PlatformConfig the creator passes, subject only to cpConfigId set, cpCreator unset/fee PDA and
lock scales (initialize_token.rs:61-75,168-175). `init_pair` then reads `platformClaimFeeWallet` from it (init_pair.rs:140-150). The wizard
uses the developer's platform (pairCurveLaunch.ts:101), but a creator calling the programs directly can pin their own (or any third
party's) platform. Test `pc1_creator_routes_dev_fee_to_itself`: claim wallet = creator → the creator receives 2,475,247 lamports on a
1 SOL buy. The keeper cranks "any pair, not only ours" (pairCurveCrank.ts:9). This also makes H-2 available to every creator.
Fix: hard-code the expected platform (or dev wallet) in pair_curve per cluster, or have the registry/UI/keeper refuse pairs whose
`ll_platform`/`dev_wallet` differ. (I did not verify on chain that LaunchLab platform creation is permissionless; the
fix is the same either way, since existing third-party platforms qualify too.)

### M-2 (Medium) — the upgrade authority is the real admin

The devnet run log (§D) records `set-upgrade-authority → the Squads vault A8VV…` with a **60 s** time lock. A 2-of-3 can replace pair_curve
with a program that drains every SOL vault; the IDL test (`the_idl_has_no_admin_withdraw_or_parameter_update`) only proves the current
binary has none. Fix: for mainnet, a Squads time lock longer than the longest pair (≥ 30 days by default; 90 days max duration), a
published plan to make the program immutable, and say so in the UI next to "no admin".

### L-1 — first graduate commits the pair without checking the other side

The Open branch (graduate.rs:94-100) checks the share condition; only *this* side's `pool_sol > 0` is checked (graduate.rs:130). If
Raydium raised `create_pool_fee` between init and graduation, the cranker graduates the affordable side and the pair is committed with
a side that cannot graduate → certain split after 3 days. Fix: in the Open branch also require
`sol[1-s] ≥ side_costs(current fee) + MIN_POOL_LIQUIDITY_LAMPORTS` (and `disable_create_pool == 0`).

### L-2 — Graduating forever

Test `pc1_graduating_forever_after_stuck_side_sells_out`: side B blocked → 3 days → B's holders sell out → Raydium relents →
`graduate(B)` = `InsufficientPoolSol` forever, `close_pair` = `NotClosable`. Rent of the Pair and the two token accounts is stranded;
indexers never see a terminal state. Fix: when `stuck && sold[s] == 0`, let `close_pair` treat the side as refunded.

### L-3 — 3-day rule is not Raydium-only

Test `pc1_three_day_rule_fires_without_raydium`: nobody cranks side B for 3 days → B sells reopen. Benign (anyone could crank), but the
constants.rs:21-24 rationale is wrong; the pair then splits. Fix the comment, or require evidence (e.g. `graduate` recorded a failure)
— simplest is to document it.

### Info

I-1: buys always end at the top of a ceil step, but a sell can leave `sold` mid-step; `buy(max_in = 0)` then gets the rest of that step
free (`pc1_sell_leaves_mid_step_then_free_tokens`: 12,345 raw tokens, vault delta 0). Value ≤ 1 lamport; the invariant
`vault = rent + F(sold_A) + F(sold_B)` still holds. I-2: `net_budget(u64::MAX)` panics at `n + 1 + fee` (math.rs:68); clients never pass
it today. I-3: the SOL vault keeps its rent forever; a voided pair with any burned/lost token never reaches `sold == 0`; a creator account
made executable makes `close_pair` fail (same mechanism as H-2; rent only).

## 2. Passes (with evidence)

- **CPMM CPIs holding the vault signature.** A callee sees only the 18 accounts passed (cpmm.rs:41-86); cross-program re-entry is
  impossible. After the CPI: vault System-owned, no data, ≥ before − CPMM's take (guards.rs:16-21, graduate.rs:192); WSOL, token vault and
  LP account keep owner/mint, no delegate, no close authority, Initialized, exact amounts (graduate.rs:193-205); pool fields, vault
  balances and LP supply cross-checked. The worst a hostile CPMM can keep is `graduation_costs` (create fee + 6 rents ≈ 0.19 SOL) — bounded
  and inherent. Test `graduate_reverts_when_the_cpmm_callee_abuses_the_vault_signature` (assign, +1 SOL, Approve, close authority, no pool)
  passes. The other side's token vault and pool PDA are never passed.
- **Curve math.** F is monotone; buys charge F(new) − F(old) ≤ net budget, sells pay F(old) − F(new) (math.rs:77-111) → telescoping
  path independence, round trip loses exactly the fees (unit test `buy_then_sell_round_trip_restores_the_curve`); inverse exact
  (`inverse_is_exact`); fee split exact, dev + burn = fee (`fee_split_is_exact`); u128 throughout, MAX_SIDE_RAISE bound at init.
  Vault solvency: only buys credit (exactly `cost`), only sells/graduate/close debit — `vault ≥ rent + Σsol` holds (asserted in
  `trades_follow_the_curve…`, `void_after_the_deadline…`).
- **Graduation share.** Checked atomically in the deciding call; sells close the same instant (trade.rs:149-152), so a flash buy to
  qualify is irrevocably committed. Price-matched pool rounds tokens down (math.rs:122-127) → no graduation arbitrage.
- **register_pair_pool provenance.** Owner = hard-coded pair_curve id, discriminator, length, and address = PDA(mints read from the
  data) (pair_curve.rs:48-63) — only `init_pair` can create such an account. Pool must equal both `pools[side]` and PDA(pair, side)
  (register_pair_pool.rs:58-59): foreign pools, the other side's pool and default keys are refused. `pool_creator == vault`, pinned
  AmmConfig on config and Pair, LP checks against creation supply, once only (`PoolAlreadyRegistered`). Offsets recomputed by hand
  (12/76/140/156/172/204/236) and pinned by `layout_offsets_…`. One mint ↔ one pair: mint authority must be *this* pair's vault, supply 0
  (init_pair.rs:92-96) and is revoked.
- **Liveness.** Void cannot be blocked (void_pair.rs:21-31). All addresses pre-funded: trace 47/64, 186 K CU (`prefunded_addresses…`);
  pool address unsquattable (pair_curve PDA signs). Deadline: graduate `< deadline`, void `≥ deadline` — disjoint.
- **Accounts.** Token-2022 refused (`Account<Mint>`, `Program<Token>`, pool token programs checked). Re-init impossible (authority
  revoked). Signers as asserted by the IDL test; every pair-derived account address-checked; `side < 2` enforced.

## 3. Attempts that failed (and what stopped them)

- *Extract SOL from the vault or a fee PDA*: sells pay exactly ΔF (math.rs:103-111); graduate keeps `rent + other side's sol`
  (graduate.rs:232-235); close requires Graduated or Voided with `sol == [0,0]` (void_pair.rs:71-75); fee PDAs are only credited.
- *Graduate below the share*: `graduation_ready` in the deciding call; no sells while Graduating.
- *Wedge void*: none found; *wedge exits*: only via H-2.
- *Double/foreign registration*: `PoolAlreadyRegistered`; `pools[side]` + pool PDA check; mint-position side lookup.
- *Hostile dev-wallet duplicates at init* (vault WSOL ATA, token vault, pool PDA, Pair): duplicates are accepted by Anchor
  (`pc1_dev_wallet_as_trader` OK) and only move the dev slice to the burn pool or the creator; reserved/sysvar keys block trades from the
  first buy, so no funds can be at risk.

## 4. After reading PAIR-CURVE.md and the earlier reviews

The earlier reviews (`2026-10-09-claude-blind-1`, `2026-10-10-claude-blind-2`, `-3`) cover burn_receipts only; none covers pair_curve.

| Claim / earlier finding | Verdict | Note |
|---|---|---|
| PAIR-CURVE §4 "the developer wallet can never block trading, and in particular can never block exits" | **Contradicted — new (H-2)** | holds for a drained wallet, not an executable one |
| §4 table: 25 bps to "the Burnticker developer wallet" | **Not enforced — new (M-1)** | it is the creator-pinned platform's wallet |
| §5.4 `close_pair` "only when nothing is owed" | **New (H-1)** | the registration still owed to burn_receipts is not counted; §5.2 and the keeper assume the Pair account outlives registration |
| §5.1 "Only Raydium's admin can cause" a stuck second side | **Inaccurate (L-3)**; L-1 is the cheap guard | |
| §5.2 "has status Graduated" | **Doc drift (Info)** | code also accepts Graduating with the side's pool recorded (register_pair_pool.rs:55), which the keeper relies on; update the doc |
| §7 upgrade authority "the one power above all of this", finalised later | **Disclosed; still open (M-2)** | the residual is the 60 s time lock until finalisation |
| §8.1 graduation CPI | **Pass** | §2; the hostile-CPMM suite covers assign, extra lamports, Approve, close authority, no pool; I found no unguarded vault-signed path |
| §8.2 curve math | **Pass** (I-1, I-2 informational) | |
| §8.3 graduation edge / whale | **Pass** | share edge tested (`graduation_condition_edges`); deadline windows disjoint; price match rounds against the arbitrageur |
| §8.4 registration provenance | **Pass** for forgery / other side / layout; **fails liveness (H-1)** | |
| §8.5 liveness and the commit | **Pass** for squatting, pre-funding (47/64 trace), CU; L-1, L-2, L-3 | "first call succeeds, second impossible": only via Raydium (L-1) |
| §8.6 rent and residue | H-1, H-2, L-2, I-3 | residue sweep itself passes |
| blind-3 M-1 (lending a vault signature to a CPI callee) | **Closed for pair_curve** | the same guard pattern is applied after the CPMM CPI and tested |
| blind-3 M-2 (LP ratio griefable by deposits) | **Closed for policy 2** | measured against creation supply; `register_pair_pool_refuses_forgeries_and_survives_lp_dilution` |
| blind-3 M-3 (dependence on LaunchLab platform state) | **Partly regressed** | pair_curve adds a new dependency, `platformClaimFeeWallet`, read at init (M-1). Snapshotting it at init is right; who chose the platform is the gap |
| re-check R3-2 fixed-pool fallback | **Cannot rescue a pair pool (feeds H-1)** | `verify_pool_provenance` requires `pool_creator == fee PDA` |

Not attacked further: CPMM's own pool security after graduation, Metaplex metadata (absent from the bundle), and the off-chain
indexer/UI. The `devnet` feature switches only the CPMM/LaunchLab ids, and both programs' `PAIR_CURVE_PROGRAM_ID` match
(`layout_offsets_…` asserts it).

## 5. Reproduction

Build in a worktree with `cargo-build-sbf` for both programs and the four mocks (scripts/test.sh); copy `target/idl/*.json` from an
`anchor build` for the two IDL tests; then `cargo test -p pair_curve --test review_pc1 -- --test-threads=1 --nocapture`. The scratch file
is the first 400 lines of `tests/lifecycle.rs` plus the `pc1_*` tests named above (kept in the review worktree, not committed). No key,
`.env*` or cluster was touched; no transaction was sent.
