# LP-lock release (LAUNCHPAD-PATH §35) — blind adversarial review (2026-10-11)

Reviewed commit: **07adf0fe** (`fix/price-integrity-and-engine-correctness`; the program sources are identical to **3d82b6b5**, the
source of the devnet round-2 upgrade — `git diff 9ec8599b 07adf0fe -- programs/burn-receipts` touches no program file). Scope: the new
release only — burn_receipts `register_fee_key`, `claim_lock_fees`, the policy-0 LP-lock pins in `initialize_token`,
`register_pair_pool`'s `lp_lock_vault`, `FeeKeyRecord`; pair_curve `lock_lp(side)`, `graduate` no longer burning LP,
`register_pair_pool` refusing until locked, `lp_burned → lp_locked`; their interaction with the earlier fixes; and the fidelity of the
test-only lock stand-in `mocks/cpmm_lock_mock`.

Method. I read LAUNCHPAD-PATH §35/§38 and the devnet lock run log first (for the intended behaviour), then the code, and wrote §1 before
reading PAIR-CURVE.md beyond its LP-lock paragraphs; of the earlier reviews I read only pair-curve-blind-1 (for this file's shape and
its M-1). Tests run in LiteSVM against the real burn_receipts and pair_curve builds (`cargo-build-sbf`, default + `--features localnet`),
the source-built Raydium CPMM fixture and — new in this review — **the real Raydium CPMM lock program**: its mainnet binary
(`LockrWmn…`, sha256 `efd657a9…802d`, 613,632 B) was dumped read-only with `solana program dump` (no key, no transaction) and loaded at
its own id, where its authority PDA (`3f7GcQ…`) and compiled CPMM id are exactly what the localnet build expects. Metaplex's id gets an
inert executable (the real program declares the account; `with_metadata = false` never invokes it).

Baseline at 07adf0fe: burn_receipts 98/98 + pair_curve 54/54 (= the 152/152 of §38) with the mock. **With the real lock program
instead of the mock, every suite that uses the lock still passes**: `lock_fees` 7/7, `lifecycle` 17/17, `review_pc1` 10/10,
`review_pc2` 9/9, `review_pc3` 7/7 (temporary local harness switch, reverted, not committed). The real program and the mock deliver
the identical WSOL amount in the claim scenarios tried (59,456,045 and 8,224,401 lamports) — the mock's fee formula matches.

**No Critical or High finding.** Two Mediums, three Lows, Infos below.

## Findings table (most severe first)

| # | Sev | Title | Where | Status |
|---|---|---|---|---|
| RL-2 | Medium | `register_fee_key` measures the coin's position against the LIVE `lp_supply`: anyone who deposits more liquidity than the migrated/graduated pool blocks the coin's Fee Key registration for as long as the deposit stays (LaunchLab and pair pools) — the blind-3 M-2 dilution class, reopened for the fee stream | lock_fees.rs:113; constants.rs:235 | reproduced, mock **and real lock program** |
| RL-3 | Medium | The policy-0 LP-lock pins are a one-time read at `initialize_token`; the LaunchLab platform admin can redirect the Fee Key (and with it 100 % of the LP fees) before migration; `register_pool` still verifies the pool and buybacks run — nothing on chain ties `pool_verified` to "the LP fees fund the burn"; any creator can pin a platform they administer | initialize_token.rs:81-90, 183-191; register_pool.rs:102-118 | reproduced (migration simulated) |
| L-1 | Low | `FeeKeyRecord` is pinned to the pool at registration but `claim_lock_fees` requires `config.cpmm_pool`: a later `replace_pool` / `apply_registration_policy` strands the lock's fees forever, and the replacement pool's lock can never be recorded (one record per mint) | lock_fees.rs:192, 227; pool_health.rs:245; admin.rs:313 | by inspection |
| L-2 | Low | `lock_lp` is the only way out of the vault for a graduated side's LP and depends on Raydium's upgradeable lock program; if `lock_cp_liquidity` ever refuses, `register_pair_pool` refuses forever (pre-§35 the LP burn was internal) | lock_lp.rs:161; register_pair_pool.rs:79-80 | by inspection |
| L-3 | Low | `claim_lock_fees(lp_fee_amount)` is caller-chosen; its safety rests entirely on the lock program carrying the uncollected remainder (it does today) | lock_fees.rs:217, 265-266 | real program keeps the remainder (MF-1) |
| I-1 (MF-1) | Info | Mock fidelity: a partial `collect_cp_fees` in the mock re-bases and forfeits the remainder (a 10,000-LP claim erases 100 % of accrued fees); the real program keeps it | cpmm_lock_mock/src/lib.rs:192, 221-226 | tested both binaries |
| I-2 (MF-2) | Info | Mock fidelity: the mock creates the NFT mint and the lock state with bare `create_account`, so pre-funding either address blocks `lock_lp` forever in the mock; the real program (Anchor `init`) accepts pre-funded addresses | cpmm_lock_mock/src/lib.rs:122, 139-143 | tested both binaries |
| I-3 | Info | Mock fidelity: the mock writes the Fee Key owner at LockedCpLiquidityState @128; the real program writes the **liquidity owner** (the locker: LaunchLab's `vault_auth_seed` PDA, the pair's SOL vault). constants.rs:202-203 calls it "owner" | cpmm_lock_mock/src/lib.rs:152; constants.rs:202-203 | tested both + devnet bytes |
| I-4 | Info | No slippage bound on the claim's LP withdrawal: a sandwich shifts a claim's WSOL/coin mix (less SOL to burn pool and operator, more coin burned); it costs the sandwicher, extracts nothing | lock_fees.rs:262-309 | analysis |
| I-5 | Info | Receipts and dust: the memo omits `operator_paid`/`operator_pending`; a coin-token donation alone makes a "claim" (memo, `claims += 1`); `rent_back` goes to the cranker even when a third party paid the WSOL ATA's rent; lamports sent to FEE_KEYS are stranded | lock_fees.rs:336-368 | inspection |
| I-6 | Info | `register_fee_key` does not require the NFT mint's mint/freeze authority to be None (the real program revokes both — observed) | lock_fees.rs:108 | tested (real) |
| I-7 | Info | `OPERATOR_TREASURY` per cluster: a `localnet`/`devnet` build deployed to mainnet would pay `[0x7e; 32]` / the devnet vault address; the mainnet placeholder is the System Program id, harmless only because the handler refuses at line 218 before anything else | constants.rs:227-232; lock_fees.rs:162, 218 | inspection |
| I-8 | Info | LP fees earned between `graduate` and `lock_lp` fold into the locked principal (the lock's baseline starts at lock time) | lock_lp.rs | analysis |

Tests: `programs/burn-receipts/programs/burn_receipts/tests/review_lock.rs` and `programs/burn-receipts/programs/pair_curve/tests/review_lock.rs`
(committed). Every `rl*`/`mf*` test asserts the SAFE behaviour and is `#[ignore]`d so `scripts/test.sh` stays green; run them with
`--include-ignored`. `REVIEW_LOCK_SO=<path>` loads another lock binary (the real one) in place of the mock.

| test | mock | real lock program |
|---|---|---|
| br `ctl_lock_register_trade_claim` (control; prints state@128 and the NFT mint's authorities) | pass | pass |
| br `ctl_an_executable_treasury_is_still_credited` (control; hypothesis refuted, see §3) | pass | pass |
| br `rl2_a_depositor_must_not_block_register_fee_key` | **FAIL** (`LockNotMajority`) | **FAIL** (`LockNotMajority`) |
| br `rl3_a_platform_nft_wallet_changed_after_init_must_not_verify_the_pool` | **FAIL** (pool_verified = true, `FeeKeyNotHeld`) | **FAIL** (same) |
| br `mf1_a_dust_lp_fee_amount_must_not_erase_accrued_fees` | **FAIL** (59,456,045 → 0) | pass (59,455,942) |
| pc `ctl_graduate_lock_register_and_claim` (control) | pass | pass |
| pc `rl2b_a_depositor_must_not_block_register_fee_key_on_a_pair_pool` | **FAIL** (`LockNotMajority`) | **FAIL** (same) |
| pc `mf2_prefunded_lock_addresses_must_not_block_lock_lp` | **FAIL** (NFT mint, lock state) | pass (all three addresses) |

No High+ finding, so no High+ exploit test exists; the Medium tests above fail against the current code as required of exploit tests.

## 1. Blind findings

### RL-2 (Medium) — a depositor blocks the coin's Fee Key registration (dilution)

`register_fee_key` accepts a position only if `locked_lp > 50 % × pool.lp_supply` (lock_fees.rs:113, `FEE_KEY_MIN_LOCKED_LP_BPS`
constants.rs:235). `lp_supply` is the pool's LIVE supply, which anyone grows by depositing. After the migration (LaunchLab) or
`lock_lp` (pair) the coin's position holds lp_supply − 100; a deposit of a bit more than the pool's own liquidity makes it a minority.

Exploit (`rl2_…`, `rl2b_…`): policy-0 coin with 85 SOL migrated and 100 % locked to FEE_KEYS, `register_pool` passes; a third party
deposits 1.05 × the LP (lp_supply 8,246,211,251,235 → 16,904,733,065,031); `register_fee_key` on the coin's own position →
`LockNotMajority` (6072). Same on a pair pool after `lock_lp` and `register_pair_pool` (3,518,908,420,617 → 7,213,762,262,264). The
depositor earns LP fees on its deposit meanwhile, so the cost is capital and IL only — and in a rivalry pair the other side's holders
have a motive. The fees keep accruing in the lock and become claimable once the deposit leaves and someone registers, so this is a
(possibly indefinite) delay, not a loss — unless a squatter uses the window: with the coin's position diluted, a squatter who locks a
majority of its own LP (forever) with the Fee Key sent to FEE_KEYS takes the one-per-mint slot, and the coin's real position's fees are
then never claimable (the squatter's fees go to the coin's burn pool instead, so this costs the squatter more than the pool is worth).
register_pair_pool closed exactly this class by measuring against the creation supply (blind-3 M-2); register_fee_key reintroduces it.

Fix (either): (a) identify the position by provenance instead of a majority — the real LockedCpLiquidityState records the **locker**
at @128 (I-3): require @128 = LaunchLab's `["vault_auth_seed"]` PDA under `LAUNCHLAB_PROGRAM_ID` for policy 0 (devnet: `5xqNaZXX…`,
matches the $LOCKT bytes) and = the Pair's SOL vault for policy 2 (or the NFT mint = pair_curve PDA `["fee_nft", pair, [side]]`,
passing the Pair account); (b) measure the majority against the LP in the lock authority's account `ATA(LOCK_CPMM_AUTHORITY, lp_mint)`
instead of `pool.lp_supply` — deposits then cannot dilute; only a competing permanent lock can, which costs its owner its liquidity
forever and pays the coin. Fix the mock's @128 first if (a) is chosen.

### RL-3 (Medium) — the platform admin can redirect the LP fees after `initialize_token`

`require_platform_locks_to_fee_keys` (initialize_token.rs:81-90, called at 189-191 for policy 0) checks `platformLockNftWallet == FEE_KEYS`
and scales 1,000,000/0/0 once. LaunchLab's platform admin can change both at any time (SDK `updatePlatformConfig` types
`updateLockNftWallet` and `migrateCpLockNftScale`; the devnet run log shows the operator doing exactly that on `GvSKpe5p…`). The
migration, which reads the platform when it happens, then mints the Fee Key to the admin's wallet (or to the creator with creatorScale,
or burns with burnScale). `register_pool` (register_pool.rs:102-118) still passes — 100 % locked counts as locked, the provenance checks
do not look at the Fee Key — so `pool_verified = true` and buybacks run, while `register_fee_key` can never succeed (`FeeKeyNotHeld`)
and ~21 bps of every swap goes to the admin instead of 80 % burn / 20 % treasury, with nothing on chain marking the coin as different.

Exploit (`rl3_…`): coin initialised under the pinned platform; migration simulated with the Fee Key minted to another wallet →
`pool_verified = true`, `register_fee_key` → `FeeKeyNotHeld` (6071). Actors: (1) any creator who pins a platform it administers —
`initialize_token` accepts any LaunchLab-owned platform meeting the pins (unlike pair_curve's `init_pair`, which pins
`BURNTICKER_PLATFORM`; burn_receipts has no such constant); (2) the operator's own platform admin key, between a coin's create and its
migration (the off-chain `verify-platform-pins` gate runs before create and cannot cover that window). The same one-time-read gap
applies to `platformCpCreator` (review-3 M-3), which strands registration rather than redirecting fees.

Fix: pin the operator's platform per cluster in burn_receipts for policy 0 (as pair_curve does) and keep its admin under the Squads
vault; and make the fee path part of verification — at `register_pool` for policy 0 (post-migration) require, and record, the
FEE_KEYS-held migration position (fold `register_fee_key` in, identified as in RL-2 (a)), so `pool_verified` implies the LP fees reach
the burn. If stranding a coin on a platform-admin change is unacceptable, at least store a `fee_key_registered` flag that the API,
status page and `.well-known` must show before any "LP fees fund the burn" copy.

### L-1 (Low) — a pool replacement strands the lock fees

`claim_lock_fees` requires `pool_state == config.cpmm_pool` (lock_fees.rs:192) and `fee_key.pool == config.cpmm_pool` (227).
`replace_pool` (pool_health.rs:245) and `apply_registration_policy` (admin.rs:313) change `config.cpmm_pool`. Afterwards every claim fails
`FeeKeyMismatch` forever, and `register_fee_key` cannot record the replacement pool's lock (`init` on `["fee_key", mint]`). Reaching it
needs 7 days of continuous "untradeable" (Raydium disabling swaps, or a WSOL reserve under 0.01 SOL — not reachable by dumping on a
pool of real depth), so the likelihood is low; the loss is the old lock's remaining fees and any future lock fees of the coin.
Fix: claim against the recorded position — `pool_state` address = `fee_key.pool`, no `config.cpmm_pool` comparison (the position was
verified at registration and its pool is immutable in the lock state) — and, if replacements matter, key records by pool.

### L-2 (Low) — `lock_lp` has no fallback

After `graduate` the side's LP sits in `ATA(vault, lp_mint)`; the only instruction that moves it is `lock_lp`, a CPI into Raydium's
upgradeable lock program (lock_lp.rs:161), and `register_pair_pool` refuses until `lp_locked` is set (register_pair_pool.rs:79-80).
If Raydium pauses or changes `lock_cp_liquidity` (account list, a fee, a minimum), every graduated-but-unlocked side is stuck: no
registration, the side's burn pool (escrowed curve fees + residue) never usable, short of a pair_curve upgrade. Before §35 the LP burn
was internal to `graduate`. The keeper locks immediately, so exposure is a window, not a standing risk.
Fix: a permissionless `burn_lp(side)` fallback after N days with `lp_locked == 0` (burn the vault's LP and record it in the same field —
`register_pair_pool` already counts burned LP), and a keeper alert on any unlocked graduated side.

### L-3 (Low) — `lp_fee_amount` should not be a parameter

The cranker chooses how much fee LP to collect (lock_fees.rs:217, encoded at 265-266). With the real program a partial collect carries
the remainder (MF-1 passes against it: 59,455,942 vs 59,456,045 lamports after a 10,000-LP claim), so today this only lets crankers
split a claim into rounding-losing pieces. But whether a partial collect forfeits the rest is the lock program's choice — the mock
forfeits it (MF-1), and the lock program is upgradeable by Raydium. Fix: drop the argument; always pass `u64::MAX` (the keeper already
does; the real program accepts it with and without accrued fees).

### Info

- **I-1 / MF-1, I-2 / MF-2, I-3 — the mock diverges from the real program** in three places (above). None hides a program bug today
  (every authors' suite passes on the real binary), but each would mislead a future test: MF-1 would make L-3 look Critical, MF-2 would
  make a pre-funding grief look like a permanent lock_lp DoS, and I-3 matters as soon as a fix reads @128. Fix the mock (carry
  `fee_lp − amount` as unclaimed @24; Anchor-style create for pre-funded addresses; write the liquidity owner at @128), and keep a CI
  job that runs the lock suites against the dumped real binary (`REVIEW_LOCK_SO`).
- **I-4** No minimum-out on the claim's LP withdrawal. A sandwich moves the reserves so the proportional withdrawal returns more coin
  (burned) and less WSOL (burn pool + operator); the round trip against a pool shrunk by the withdrawal costs the sandwicher. Accepted
  risk; note it in the fee statement.
- **I-5** The receipt memo says `operator=<this claim's share>` but not what was delivered from `operator_pending`; the event has both.
  A coin-token donation to `ATA(FEE_KEYS, mint)` alone triggers a memo and `claims += 1`. The WSOL ATA's rent goes to the cranker even
  if someone else created it. SOL sent to FEE_KEYS itself has no way out.
- **I-6** `register_fee_key` checks the NFT mint's supply and decimals only; add `mint_authority == None && freeze_authority == None`
  (the real program revokes both).
- **I-7** The treasury is a per-feature constant; the verified-build table must state the feature set, since a `localnet` build would
  route 20 % to `[0x7e; 32]` (unspendable) and a `devnet` build to the devnet vault's address on mainnet.
- **I-8** Fees earned between `graduate` and `lock_lp` become principal; negligible with the keeper's ordering.

## 2. Passes (with evidence)

- **20 % only to the pinned treasury, 80 % only to the coin's fee PDA**: treasury address-constrained (lock_fees.rs:162) and refused
  when the build has none (218); fee PDA seeds-checked from `config.mint`; split `floor(x·2000/10000)` with the rest to the burn pool,
  exhaustive unit test plus `split_lock_fees(u64::MAX)`; `released − claimed` (rent + donations) goes to the fee PDA except one ATA rent
  to the cranker; FEE_KEYS must end exactly where it started (350). Test `a_claim_refuses_another_treasury_mint_pool_or_fee_key`.
- **Coin side burned from the right account**: only `ATA(FEE_KEYS, config.mint)`, address-constrained (172), whole balance burned
  with `mint = config.mint`, then closed.
- **Account substitution** on every `claim_lock_fees` / `lock_lp` account: each is seeds-, address-, record- or pool-derived; the only
  unchecked one (`cpmm_authority`) is seed-checked by CPMM. FEE_KEYS is passed to the lock CPI read-only (cannot be debited); its token
  accounts and the Fee Key are re-checked after the CPI (owner, mint, amount, no delegate, no close authority); the vault in `lock_lp`
  is read-only in the CPI and re-checked, with only `vault_lp` (emptied, checked) among its token accounts reachable.
- **Fee Key for another pool / NFT elsewhere / dust locks**: `lock.pool == config.cpmm_pool`, `lock.lp_mint == pool.lp_mint`, ATA of
  FEE_KEYS holding exactly 1, lock-state PDA re-derived; minority positions refused (authors' test); only FEE_KEYS signs for its NFT
  accounts, and only inside `claim_lock_fees`.
- **WSOL sync / pre-created ATAs**: `create_idempotent`, `sync_native` before sampling, donations counted as donations; NATIVE_MINT has
  no freeze authority and registered coin mints are checked for none (register_pool / register_pair_pool).
- **Token-2022**: registration requires both pool token programs = SPL Token; `claim_lock_fees` takes `Account<Mint>` (SPL Token).
- **Unfunded treasury**: the 80 % is never held up; the 20 % parks in the FeeKeyRecord and is delivered later (authors' test, devnet).
  An executable account at the treasury address is still credited (`ctl_an_executable_treasury_is_still_credited`): the payment is
  direct lamport arithmetic, not a System CPI, so the pair_curve PC-1 H-2 class does not apply — keep it that way.
- **Rent / pre-funding on the real lock program**: NFT mint PDA, lock state PDA and FEE_KEYS's NFT ATA each pre-funded with the rent
  minimum → `lock_lp` succeeds (MF-2 on the real binary).
- **Compat**: `FeeKeyRecord` round 1 → round 2 took 8 bytes of `reserved` (zeroed) for `operator_pending`; `TokenConfig` unchanged;
  `Pair.lp_locked` at the old `lp_burned` offset (156), pre-§35 pairs register on their burned LP (`burned_on_chain` counts).
- **Mock account order and layout** vs SDK 0.2.74 `cpmmLockPositionInstruction` / `collectCpFeeInstruction`: identical order,
  signer/writable flags and discriminators (`lockCpLiquidity [216,157,29,78,38,51,31,26]`, `collectCpFee [8,30,51,199,209,184,247,133]`);
  devnet LockedCpLiquidityState bytes decode as locked @8, claimed @16, unclaimed @24, last_lp @32, last_k (u128) @40, epoch @56,
  pool @64, NFT mint @96, locker @128, lp_mint @160, zeros @192–255 — the program reads only @8/@64/@96/@160, all correct.
- **Earlier fixes**: review_pc1/2/3 and the LP-floor / provenance / 30-day-fallback / Voided-only close tests all pass on mock and real
  lock; a pair with one side graduated and the other refunding stays Graduating, and both `lock_lp` and `register_pair_pool` accept
  that state; `close_pair` cannot reach a graduated vault's LP account.
- **Upgrade of LaunchLab platform fields after migration**: no effect on an existing lock (the NFT is already FEE_KEYS's).

## 3. Attempts that failed (and what stopped them)

- Erase a coin's accrued fees with a dust `lp_fee_amount` → real program carries the remainder (MF-1 real: pass).
- Block `lock_lp` forever by pre-funding its created addresses → real program's Anchor `init` handles pre-funded accounts (MF-2 real).
- Wedge every claim with an executable treasury → crediting an executable account by direct lamport change is accepted.
- Make the lock CPI move FEE_KEYS lamports, approve a delegate or move the Fee Key → read-only signer + post-CPI checks (and the
  authors' hostile-callee pattern for the earlier CPIs).
- Make `register_pair_pool` fail by collecting fees before registration (collect lowers the lock account's LP) → only FEE_KEYS can
  collect, and only after registration.
- Profit from sandwiching a claim → the reversal trades against a pool shrunk by the withdrawal; the attacker loses (I-4).

## 4. After reading PAIR-CURVE.md and §35/§38

| Claim | Verdict | Note |
|---|---|---|
| §38 "majority-of-LP lock required — dust-lock griefing refused" | **Pass for dust; new RL-2** | majority of the live supply is dilutable by an unlocked deposit |
| PAIR-CURVE §5.2 step 4 "measured against the CREATION supply, so a later depositor cannot dilute" | **Pass for register_pair_pool** | step 5 (register_fee_key) does not inherit it (RL-2) |
| §35 "the split is a compiled constant — no admin key, no config field" | **Pass (program)**; **RL-3** | the LaunchLab platform admin decides where the Fee Key goes for policy-0 coins until migration |
| initialize_token.rs:78-80 "the launch gate re-reads them immediately before LaunchLab's create" (D-3) | **Disclosed; window remains (RL-3)** | create → migration can be days; third-party platforms bypass the gate |
| §38 "Mainnet gate: OPERATOR_TREASURY and BURNTICKER_PLATFORM must be compiled in" | **Half true in code** | `BURNTICKER_PLATFORM` exists only in pair_curve; burn_receipts policy 0 pins no platform (RL-3) |
| Run log finding 4 "the real lock program accepts lp_fee_amount = u64::MAX" | **Confirmed** (LiteSVM, mainnet binary) | L-3: make it the only value |
| Mock header "LockedCpLiquidityState layout read from devnet accounts … owner @128" | **Partly wrong (I-3)** | @128 is the locker, not the Fee Key owner |
| PAIR-CURVE §5.1 step 6: `lock_lp` "permanent, never withdrawable" | **Pass** | no withdraw path in the CPI'd instruction set; lock vault only shrinks by fee collection |

## 5. What I did not check

- The TS side (keeper crank, planners, API 1.8.0 fields, copy) beyond the evidence that the keeper passes `lp_fee_amount = u64::MAX`.
- The **devnet** lock binary in LiteSVM (sha256 `10ddd211…7745`, differs from mainnet's; it compiles devnet ids the localnet harness
  does not use) — only the mainnet binary was exercised; devnet behaviour rests on the run-log evidence.
- LaunchLab's migration code (closed source): how it derives the Fee Key NFT mint and which fields it reads at migration time; RL-3 is
  shown with a simulated migration. I did not verify on chain that LaunchLab platform creation is permissionless (the SDK's
  `createPlatformConfig` has no Raydium signer; the fix is the same either way).
- The deployed CPMM binary (tests use the source-built fixture at the pinned commit), Metaplex (stubbed), Raydium-side pauses.
- Fuzzing of rounding over many claims, compute/size limits beyond the harness's 1,232-byte legacy assert, mainnet build artefacts.
- No `.env*`, key file or keypair was read or touched; no transaction was sent to any cluster (the two program dumps are read-only RPC
  `getAccountInfo` calls).

## 6. Reproduction

In a worktree: `cargo-build-sbf` both programs (default and `--features localnet --sbf-out-dir target/deploy-localnet`) and the five
mocks (scripts/test.sh), copy `fixtures/raydium_cp_swap.so` and `target/idl/*.json` from a full build, then

    cargo test -p burn_receipts --test review_lock -- --include-ignored --test-threads=1 --nocapture
    cargo test -p pair_curve    --test review_lock -- --include-ignored --test-threads=1 --nocapture
    solana program dump -u https://api.mainnet-beta.solana.com LockrWmn6K5twhz3y9w1dQERbmgSaRkfnTeTKbpofwE /tmp/lock_mainnet.so
    REVIEW_LOCK_SO=/tmp/lock_mainnet.so cargo test -p burn_receipts --test review_lock -- --include-ignored --test-threads=1 --nocapture
    REVIEW_LOCK_SO=/tmp/lock_mainnet.so cargo test -p pair_curve    --test review_lock -- --include-ignored --test-threads=1 --nocapture
