# pair_curve — independent re-check of the blind-review fixes (2026-10-10)

Commit reviewed: **`4eda2e3d`** (`burnticker/pair-curve`; program sources as of the fix commit `fa8627a4`, re-rehearsal `bee17539`).
`fix/price-integrity-and-engine-correctness` at `1f717cb6` carries byte-identical `programs/` (the merge has landed there; `main`
does not have pair_curve yet). Note: `claim_developer_fee` lives in `instructions/void_pair.rs:66-106`, not in its own file.
Worktree `mct-wt-REVIEW-PC3`, branch `burnticker/review-pc-3`. Read-only: no key or `.env*` touched, no transaction sent; devnet
reads used only the public RPC.

Inputs: blind reviews R1 / R2 (`2026-10-10-pair-curve-blind-{1,2}.md`), their inverted suites `review_pc{1,2}.rs`, the CHANGELOG
"late evening" table, `PAIR-CURVE.md`, run log §R2 and its `r2-*` evidence. New tests: `programs/pair_curve/tests/review_pc3.rs`
(6 tests, each asserting **current** behaviour; tests named `…still…` document a residual and must be inverted when fixed).

**Baseline (all at `4eda2e3d`).** pair_curve 45/45 (11 unit, 15 lifecycle, 10 `review_pc1`, 9 `review_pc2`); burn_receipts 90/90
(all nine suites); `review_pc3` 6/6. `scripts/test.sh` from a clean worktree stops at burn_receipts'
`the_idl_has_no_withdraw_close_or_sweep_instruction` until `target/idl/*.json` exists (`anchor idl build -p …`); environmental, same
note as R1 §5.

## Verdict

Every High is fixed and I could not break the fixes for H-1, H-2, H-3 or R1 H-2. **One Medium is only partly fixed: R2 M-1** — the
pro-rata redemption is correct, but nothing stops a holder from selling **on the curve** after the deadline and before anyone calls
`void_pair`; the reviewer's exact scenario still pays the early buyer **+7.12 SOL** and costs the late buyer **−7.25 SOL** (original
report: +7.12 / −7.96). One new Low: the stricter stuck-side rule (R1 L-3) means any CPMM refusal that does not show in the AmmConfig
locks a side's raise forever. The devnet evidence checks out signature by signature, and the deployed program equals a local devnet
build of this commit.

## 1. Finding-by-finding

| Finding | Status | Evidence (file:line at `4eda2e3d`) | Proving test |
|---|---|---|---|
| R1 H-1 / R2 H-2 `close_pair` strands registration | **fixed** | `void_pair.rs:152` (Voided only); status Voided is set only in the Open branch of `handle_void` (`void_pair.rs:42-48`), which needs `now ≥ deadline`, while every commit needs `now < deadline` (`commit.rs:42`) — no path from Graduating/Graduated to Voided | `pc1_h1_*` (2), `pc2_close_pair_front_runs_registration`, `lifecycle::a_graduated_pair_can_never_be_closed` |
| R1 H-2 executable dev wallet freezes trades | **fixed** | trades credit only the vault (`trade.rs:88-91`, `159-164`); fees accrue (`trade.rs:71-76`); claim checks `executable` and rent (`void_pair.rs:83-89`) | `pc1_h2_*` (2), `lifecycle::a_drained_developer_wallet…`; residual for `close_pair` → RC-5 |
| R1 M-1 / R2 I-3 creator-chosen platform | **fixed** | `init_pair.rs:141,150-152`, `constants.rs:30-35`; devnet: `GvSKpe5p…` is owned by devnet LaunchLab `DRay6fNd…`, its claim wallet @16 is `3s97xfWw…` = pair 3's `dev_wallet` = the claim's recipient | `pc1_m1_creator_routes_dev_fee_to_itself` |
| R1 M-2 upgrade authority | **accepted-with-reason** (still open until finalisation) | written plan PAIR-CURVE §7: finalise before the first public pair; devnet time lock still 60 s. New Info: the layout grew 888 → 946 B, and devnet pair 1 (`5etkAGzW…`, 888 B, Graduated) can no longer be loaded by the upgraded program — an upgrade with a live pair would freeze it, exits included | — |
| R1 L-1 commit without other side payable | **fixed** | `commit.rs:36-38,48`; `graduate.rs:104` | `lifecycle::review_followups_…` |
| R1 L-2 Graduating forever | **fixed** (terminal `refunding[s]`; such a pair is never closable, by design) | `void_pair.rs:50-57`, `graduate.rs:107` | `pc1_l2_…`, `lifecycle::graduating_commits_…` |
| R1 L-3 3-day rule on inactivity | **fixed**, but see **RC-2** (new Low) and RC-3 (Info) | `void_pair.rs:51-53` | `pc1_l3_…`; `pc3_l3_still_locked_…`, `pc3_void_stuck_side_needs_…` |
| R1 I-1 zero-cost buy | **fixed** | `math.rs:89` | `pc1_i1_…` |
| R1 I-2 `net_budget` overflow | **fixed** | `math.rs:66-78` (u128) | `pc1_i2_…`, `math::net_budget_survives_u64_max` |
| R1 I-3 vault never closed / burned tokens / executable creator | **partly fixed** | executable creator → rent to burn pool A (`void_pair.rs:156`); burned tokens via R2 L-1; vault rent kept (accepted, written reason); new: executable **dev wallet** blocks close (RC-5) | `lifecycle::review_followups_…`; `pc3_executable_dev_wallet_still_blocks_close_pair` |
| R2 H-1 pre-funded WSOL pool vault | **fixed** | `graduate.rs:159-163,206` | `pc2_prefunded_*` (3), `lifecycle::prefunded_addresses…`; RC-4 shows abuse is unprofitable |
| R2 H-3 pre-created token vault | **fixed** | `init_pair.rs:53-56,137-139` | `pc2_precreated_token_vault_blocks_init_pair`, `lifecycle::review_followups_…` (refusal half) |
| R2 M-1 void race / stranded 75 bps | **partly fixed** | escrow + snapshot + fee-free pro rata correct (`void_pair.rs:28-33`, `math.rs:121-128`, `trade.rs:143-145`); **but `handle_sell` accepts an Open pair past the deadline** (`trade.rs:141`, no deadline check; PAIR-CURVE §5 says so) | `pc2_void_is_a_race_not_a_refund` (void-first only); **`pc3_m1_still_a_race_curve_sell_after_deadline_front_runs_the_void`** |
| R2 M-2 Squads upgrade script | **fixed, with a Low caveat** | `squads-program-upgrade.mts:44-49,72-87`; caveat below | devnet `r2-squads-refusals.log` (5 refusals) |
| R2 L-1 burned dust blocks close | **fixed** | `void_pair.rs:159-161` | `pc2_burned_dust_blocks_close_after_void`; devnet `3zBiM3pq…` → `yz16Uprn…` |
| R2 L-2 share flip / 5,000 knife-edge | **fixed** | `commit.rs:41-55`, `trade.rs:111,174`, `constants.rs:60`, `init_pair.rs:109` | `pc2_share_flip_blocks_graduation`; devnet `4mkLixEZ…` |
| R2 L-3 graduate+register bundled | **fixed** off-chain (`client.ts:154-175`); on-chain policy switch **accepted-with-reason** | — | TS crank planner tests |
| R2 L-4 never-swapped pool | **partly fixed / accepted** (keeper seeds; burn_receipts unblock clock unchanged, deferred) | — | devnet seeds `3BJ9y9fN…`, `3Z8PWYGq…` |
| R2 I-1 keeper cranks third-party pairs | **accepted-with-reason** | — | — |
| R2 I-2 first cranker picks the burn pool | **partly fixed** (escrow is per side, `graduate.rs:237-246`; pre-commit vault donations still go to the side graduated first; close residue halved) | — | — |
| R2 I-4 canonical pool squatting | **accepted** (documented) | — | — |
| R2 I-5 first-observation TWAP | **accepted** (keeper seeds; 2 % cap) | — | — |

No finding regressed.

## 2. Attacks on the fixes

**RC-1 (Medium, R2 M-1 residual) — the race moved, it did not go away.** After the deadline buys are refused and a commit is
impossible, so the pair can only void; but until someone calls `void_pair` the status is Open, and `handle_sell` sells along the
curve (top-of-curve prices, 1 % fee). `pc3_m1_still_a_race…` runs the reviewer's scenario both ways: void first → early +2.46 SOL,
late −2.57 SOL (the documented per-token transfer of §5.3); early sells on the curve first → early **+7.12 SOL**, late **−7.25 SOL**.
The keeper voids on its next cycle after the deadline, so the window is a priority-fee race at the deadline second (and the same sale
one slot *before* the deadline is legal anyway). Fix: in `handle_sell`, an Open pair at/after the deadline runs the void transition
(`start_redemption` on both sides) and redeems; or refuse curve sells at/after the deadline. A pre-deadline bank run on a pair that is
visibly failing is inherent to a curve and should be stated in the UI.

**RC-2 (Low, new) — the stuck-side refund only sees the AmmConfig.** `void_pair` refunds a missing side only if pool creation is
disabled or the fee leaves no liquidity (`void_pair.rs:53`). Any other reason CPMM refuses `initialize` — a CPMM upgrade that changes
the instruction or its accounts, or a new check pair_curve's PDA-signed pool fails — leaves B's holders with no graduate, no refund
and no sell, forever (`pc3_l3_still_locked…`: CPMM replaced after `graduate(A)`; 30 days later `NotStuck`, `SellsClosed`, B's ~39.6
SOL in the vault). I found no attacker-reachable blocker left (pre-funding every CPMM-created address, the vault's WSOL ATA, the
token vault, CU and trace all pass), so this needs Raydium to act — but the consequence is a permanent lock where the first version
had a 3-day exit. A failed `graduate` cannot leave evidence on chain (it reverts), so the practical fix is a long unconditional
fallback (e.g. refund any side still missing 30 days after the commit), keeping the 3-day + AmmConfig path as is.

**RC-3 (Info).** `void_pair.rs:51` takes the *first* missing side. With both pools missing and a fee that only B cannot pay, it answers
`NotStuck` until someone graduates A (`pc3_void_stuck_side_needs…`). Permissionless, so not a lock; iterate over both sides instead.

**`init_if_needed` acceptance (`VaultAccountTampered`).** Anchor pins the address (ATA of vault/mint), the owner (SPL Token) and the
token account's owner and mint. Supply is 0 at init (`init_pair.rs:96`), so `amount == 0` is automatic; a delegate or close authority
needs the vault's signature, which no one has before `init_pair`; `Frozen` needs a freeze authority, refused by `init_pair.rs:97`;
extra lamports end up in the rent returned at close. `state` is not checked explicitly, but no reachable state passes that is unsafe.
Devnet `26Qn8w9q…` created the ATA, `52bM6PEY…` minted 10¹⁵ into it with no lamport change.

**"Accept ≥, the excess joins the pool".** The excess is computed only while the vault address has no data (`graduate.rs:162`);
CPMM's own `create_or_allocate_account` makes `amount = lamports − rent`, and the post-CPI check is exact against `amt + excess`,
so partial (below-rent) pre-funding just lowers the vault's rent cost. RC-4 (`pc3_h1_prefunded_wsol…`): a holder donates 2 SOL to
skew the opening price, then dumps its bag into the pool — it receives 1.03 SOL more than without the donation, i.e. loses 0.97
SOL. The LP minted on the donation is burned with the rest (`graduate.rs:208-215`); `register_pair_pool` measures against
`lp_supply_at_creation` and has no SOL threshold, so registration cannot be griefed (registration succeeds in RC-4 and in the devnet
pair 3 run).

**`claim_developer_fee`.** Recipient fixed at init (`void_pair.rs:77`), caller anyone at any status while the Pair exists; one system
transfer of exactly `dev_accrued` (fee floors happen per trade in `fee_split`), state zeroed after — Solana forbids re-entry and the
callee is the System program. Graduate keeps `dev_accrued` in the vault (`graduate.rs:238`), redemptions are capped by `sol[s]`, so the
accrual is always backed (`assert_identity` after every step of RC-1 and RC-6, including a claim mid-redemption). RC-5: an executable
dev wallet makes the claim and `close_pair` refuse; rent only, trading unaffected; route the accrual to the burn pools when the wallet
cannot receive at close, like the creator case.

**Void snapshot and pro-rata exits.** `floor(amount·pool/supply)` never exceeds the one-shot share; the remainder goes only to whoever
returns the *last* outstanding unit (`math.rs:123-124`). RC-6: 25-chunk exit ≤ one-shot (loss ≤ 25 lamports), the side drains to
exactly 0. The 1-unit burn: `sold` never reaches 0, nobody is "last", the dust becomes residue at close, which now works (R2 L-1).

**Commit latch with 4,000 bps.** The commit is evaluated inside the same trade (`trade.rs:111,174`) and closes both curves; sol is then
frozen, so no later trade can make a side unpayable. A front-runner can only commit first (the victim's buy fails `NotOpen`) or sell
the weak side to delay readiness, paying the fee each time — no way to strand a side except Raydium raising the fee (handled by the
stuck rule, RC-2 aside).

**`refunding[side]` "real block".** Determined only from the pinned AmmConfig (`address = pair.cp_config`, owner CPMM, discriminator,
`commit.rs:25-38`) plus 3 days since the commit. Cannot be faked or forced by anyone but Raydium's admin. Too narrow rather than too
loose (RC-2).

**`BURNTICKER_PLATFORM`.** Default build = all zeros → `PlatformNotPinned`; `localnet` = test key; `devnet` wins if both features are
set. Same program id on both clusters (D-7): a devnet build deployed to mainnet fails closed (devnet CPMM/LaunchLab ids, and the devnet
platform account does not exist there). When the owner pins the mainnet platform the mainnet hash in `verified-build.json` changes;
the table's current mainnet hash (`40584764…`) is a build that can never open a pair — fine, but say so next to it.

**Upgrade script's four checks.** Buffer code = `--expect-file`, buffer authority = vault, program authority = vault (binds to the
real vault even if `--multisig` is wrong), spill ∈ {vault, members}; the Squads member parse is correct. Caveat (Low): the code check
trusts an operator-supplied local file and `--expect-sha256` is optional and is the **plain file sha256** (`1ab6b1c9…`), while the
published verified-build number is the **executable hash** (`35b5b3e1…`). An operator who pastes the published number is refused;
one who drops the flag is protected only by the file they were given. Make the script read `config/burnticker/verified-build.json`
and require the executable hash of the buffer to equal `builds[cluster].hash` for that program id.

## 3. Devnet evidence

All 25 signatures I sampled from §R2 exist on devnet with `err = null`, the run-log CU counts and times 18:33–19:21 Denver
(upgrade propose/approve×2/execute; pair 3 init, buy, sell, commit, pre-fund, graduate A/B, register A/B, claim, seeds, crank; pair 4
pre-create, init, void, burn, three redemptions, close). Balance deltas match the log: buy A1 credits only the vault (+200,000,000)
and the buyer's ATA rent; graduate A's WSOL pool vault `AJZpVSbK…` holds 87,621,485 = 86,609,925 + (2,500,000 − 1,488,440 devnet
rent); claim pays `3s97xfWw…` +1,407,035; redemptions 29,925,743 / 14,036,378 (= the stated floor, recomputed) / 20,876,989; close pays
the dev wallet +160,889, the creator +8,432,800, 1 lamport to burn pool B. Pair 3 is Graduated (946 B), pair 4 closed, both vaults at
650,240. Program authority = Squads vault `A8VV…MqffD`, last deploy at the execute slot. `scripts/ops/verified-build.sh --onchain
devnet` → **MATCH** for both programs; note it compares the chain to the committed table, so I also rebuilt pair_curve here with
`--features devnet`: 365,240 B, sha256 `1ab6b1c9…`, executable hash `35b5b3e1…` = deployed; default build `40584764…` = table.

## 4. burn_receipts

`git diff 547558fa 4eda2e3d -- programs/burn-receipts/programs/burn_receipts` is empty; the devnet burn_receipts executable hash equals
the table. The Pair grew to 946 B with new fields appended after offset 236; burn_receipts reads by offset with `MIN_LEN 236`
(`src/pair_curve.rs:48-52`), and `layout_offsets_…` passes. `register_pair_pool` accepting Graduating-with-pool is now load-bearing:
a pair with a refunding side stays Graduating forever. All 90 burn_receipts tests pass, so the three earlier burn_receipts reviews'
regressions still hold; R2 L-4's unblock-clock change is still owed to the next burn_receipts upgrade.

## 5. Recommendations, in order

1. Close the post-deadline curve-sell window (RC-1) before mainnet.
2. Add a long unconditional stuck-side fallback (RC-2); iterate both sides in `void_pair` (RC-3).
3. Upgrade script: verify the executable hash against the verified-build table (§2).
4. Close/claim with an uncreditable dev wallet: send the accrual to the burn pools at close (RC-5).
5. Do not upgrade with live pairs unless the layout is unchanged or migrated (pair 1 orphan); finalise as planned (R1 M-2).
