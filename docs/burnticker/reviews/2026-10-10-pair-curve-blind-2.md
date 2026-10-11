# pair_curve — blind security review 2 (2026-10-10)

Reviewer: Claude, working alone with no prior exposure. Commit reviewed: **547558fa** (`fix/price-integrity-and-engine-correctness`,
merge of `burnticker/copy-receipts-first`), reviewed in the worktree `mct-wt-REVIEW-PC2`. Scope: `programs/burn-receipts/programs/pair_curve`,
`burn_receipts`' `register_pair_pool`, policy 2 and `src/pair_curve.rs`, `src/lib/pairCurve/`, the keeper hook, `scripts/paircurve-admin.mts`,
`scripts/squads-program-upgrade.mts` and the wizard path behind `BURNTICKER_PAIR_CURVE_ENABLED`. Emphasis: economics, griefing, liveness.
Method: read-only. I wrote exploit tests in a local `tests/review_pc2.rs`, a copy of the lifecycle harness with 9 extra tests (not
committed), and ran them against the real CPMM fixture (raydium-cp-swap@b3187ae5). I wrote the findings before reading
`PAIR-CURVE.md` §5–§9 or any review. Baseline: the 9 math unit tests, the 14 lifecycle tests and the 27 TS pair-curve tests all pass.

## Findings, most severe first

| # | Sev | Where | One line |
|---|---|---|---|
| H-1 | High | `graduate.rs:203` | About 0.004 SOL sent to the two CPMM WSOL pool-vault PDAs makes every `graduate` revert, permanently: every pair voids, or the second side is stranded |
| H-2 | High | `void_pair.rs:67-75` × `register_pair_pool.rs:53` | `close_pair` straight after the second `graduate` (same transaction is fine) deletes the Pair, so the burn pools can never be registered and the buyback is dead |
| H-3 | High | `init_pair.rs:50-53` | Anyone who sees tx 1 creates ATA(vault, mint A), and `init_pair` fails forever: a deterministic DoS of every launch for 0.002 SOL |
| M-1 | Medium | `trade.rs:144-168`, PAIR-CURVE §5.3 | A void is a first-come race that charges the 1 % fee, not a refund: early buyers take late buyers' SOL (+7.12 / −7.96 SOL measured); 75 bps of every trade of a voided pair stay stranded for good |
| M-2 | Medium | `scripts/squads-program-upgrade.mts:34,56-61` | The upgrade proposal takes any `--buffer`/`--spill`; it checks neither the buffer's contents (hash), its authority nor the program's authority |
| L-1 | Low | `void_pair.rs:73` | One raw token burned by a holder after a void keeps `sold ≠ 0` forever, so `close_pair` can never run (1 lamport stays owed) |
| L-2 | Low | `math.rs:114-118`, `constants.rs` (MAX_SIDE_SHARE_BPS) | Minimum-share flip: one sell of the weak side blocks graduation and costs only the fee; at share 5,000 graduation needs both raises equal to the lamport |
| L-3 | Low | `pairCurve/client.ts:224`, `admin.rs:199-202` | The keeper sends graduate+register as one transaction; if register fails (e.g. the admin moved a policy-2 token to policy 0/1) the keeper can never graduate the pair |
| L-4 | Low | `crank_buyback.rs:195-196` | A pair pool nobody has swapped on has no CPMM observation, so `TwapUnavailable` blocks it forever, and that state is not counted toward the 30-day unblock |
| I-1 | Info | `pairCurveCrank.ts:40-54` | The keeper cranks every third-party pair (getProgramAccounts plus 3–5 RPC calls per pair per cycle, including a genesis-hash call); pair spam is cheap and its rent comes back |
| I-2 | Info | `graduate.rs:230-241`, `void_pair.rs:40` | The first cranker chooses which burn pool gets every donation; close rent goes to `creator`, never to `payer` |
| I-3 | Info | `initialize_token.rs:168-174`, `init_pair.rs:141-150` | Any LaunchLab-owned platform can be pinned, so a third-party pair's 25 bps "developer" slice goes wherever its creator chose; the UI must filter pairs by platform |
| I-4 | Info | CPMM `create_pool` | Holders can open the canonical CPMM pool (config, WSOL, mint) at any price before or between the graduate calls; aggregators may route there |
| I-5 | Info | `cpmm.rs:195-249` | On a brand-new pair pool the first swapper writes the first observation; this is the known multi-block TWAP-hold class, bounded by the 2 % cap |

## H-1 — pre-funded WSOL pool vault blocks graduation (liveness, the griefing that costs every honest user)

CPMM `initialize` creates each pool vault with `create_or_allocate_account` (cp-swap `utils/token.rs:405-455`). If the address
already holds lamports, it allocates and assigns the account without refunding anything, then calls `InitializeAccount3`. On the
**native mint**, InitializeAccount sets `amount = lamports − rent`. The vault address is
`["pool_vault", pool, NATIVE_MINT]` under CPMM, and `pool = ["pool", pair, [side]]` under pair_curve. Both can be derived from the
two mint keys, which are public once tx 1 and tx 2 land and even before `init_pair`. After the CPI, `graduate.rs:203` requires
`token_amount(pool_vault) == amt` exactly, so it reverts with `PoolMismatch`. Nobody can ever remove the lamports, because only CPMM
can use the address, and only inside `initialize` with pair_curve's pool signature. That makes the block permanent.

Steps (test `pc2_prefunded_wsol_pool_vault_blocks_graduation_forever`, passes):
1. Fill a pair to ready (50/40 SOL budgets).
2. Send `rent(165)+1` lamports to the WSOL pool vault of each side: 4,078,562 lamports in total at LiteSVM rent.
3. `graduate(0)` and `graduate(1)` both fail with `PoolMismatch`. At the deadline `void_pair` succeeds and the holders exit paying the
   1 % fee. The burn pools rise from 0.39/0.32 SOL to 0.76/0.61 SOL, and that SOL can never be spent (M-1).

Variant (`pc2_prefund_after_first_side_strands_the_second`, passes): pre-fund only side B, after `graduate(A)`. B then fails forever,
the pair stays `Graduating`, B's holders can sell only after 3 days, the pair never reaches `Graduated`, never closes, and B's burn
pool can never be registered. This refutes PAIR-CURVE §5.1, "Only Raydium's admin can cause that between the two calls". The existing
liveness test pre-funds 1,000,000 lamports, which is below the 2,039,280 token-account rent, so it never puts any WSOL in the vault.
Control: the vault's own WSOL ATA pre-funded with 5 SOL does **not** block, because `wsol_before` absorbs it
(`pc2_prefunded_vault_wsol_above_rent_does_not_block`). Pre-funding the pool PDA, the LP mint, the observation account, the token-side
pool vault or the LP ATA does not block either, since those are non-native or have no amount.

Fix: before the CPI, read the WSOL pool vault's lamports and set `excess = lamports.saturating_sub(rent(165))`. After the CPI, require
`amount == amt + excess` (the token side stays exact), and record the excess as a donation to the pool. Add a test with
`rent + 1` on both sides.

## H-2 — `close_pair` strands registration

`close_pair` on a `Graduated` pair closes the Pair account (`close = creator`). `register_pair_pool` needs that account
(`PairView::load` checks owner and discriminator), and the only other routes, policy 0 and policy 1, require `pool_creator == fee PDA`
(`register_pool.rs:73`). A pair pool's creator is the pair vault. The fee PDA cannot sign for CPMM, so no pool can ever pass. After
the close, the token's buyback can never run and the fee PDA keeps its SOL forever.

Steps (`pc2_close_pair_front_runs_registration`, passes): the keeper sends graduate(A)+register(A). The attacker lands
`[graduate(B), close_pair]` in **one legacy transaction** (181 k CU). `register_pair_pool(B)` then fails with `InvalidPairAccount`
(6066), and 0.32 SOL is stranded in B's burn pool in the test. The attacker can block both sides by sending `graduate(A)` and then
`[graduate(B), close_pair]` before the keeper's next cycle (or as one Jito bundle). It costs only transaction fees, and the rent goes
to the creator anyway. The repository's own admin CLI `close` command does the same without warning.

Fix: in `handle_close`, refuse to close a graduated pair until both mints' TokenConfigs show `cpmm_pool == pools[side]`. Pass both
configs and check their owner and PDA. Alternatively, make `close_pair` a no-op for graduated pairs and leave the 888-byte account in
place.

## H-3 — a pre-created token vault blocks `init_pair` (launch liveness)

`token_vault_a/b` use `init, associated_token::…`. Anchor's codegen calls the non-idempotent ATA `create`, which fails on an existing
account. The wizard (and the admin CLI) send three transactions. Tx 1 lands a mint whose **mint authority is the vault PDA**, so an
observer reads the vault straight from the mint and creates `ATA(vault, mint A)`. The mints can never be used again, because only
`init_pair` can sign for the vault and no other path exists. The TokenConfigs are dead too. The attacker can repeat this for every
retry at 0.002 SOL; the creator loses about 0.016 SOL of rent each time.

Steps (`pc2_precreated_token_vault_blocks_init_pair`, passes): run `prepare` (mints and configs), read the authority from mint A, call
`create_ata(vault, mint A)`, and `init_pair` fails with `IllegalOwner` inside the ATA program.

Fix: use `init_if_needed` (or `create_idempotent`) for both token vaults, then require amount 0, owner vault, no delegate and no close
authority. The ATA program guarantees the owner, and only the vault can add a delegate. Better still, create the mints inside
`init_pair`, or send all three transactions as one bundle.

## M-1 — the void path: who bears the fees, and value extraction

The value-extraction sequence (`pc2_void_is_a_race_not_a_refund`, passes): an early buyer pays 2 SOL on side A, a late buyer pays
40 SOL on side A, and side B stays at 5 SOL, so its share is below 25 %. At the deadline the early buyer sends
`[void_pair, sell(all)]` atomically (sells are open at the deadline even before the void). Result: early **+7.12 SOL**, late
**−7.96 SOL**, on a pair that "voided so everyone can exit". Exit price depends on the order of selling, so the void is a
priority-fee race, and every exit pays 1 %. Of that 1 %, 75 bps goes to a burn pool that can never be spent: crank_buyback needs a
registered pool, a voided pair can never register one, and `crank_vault` is vault-mode only. PAIR-CURVE §5.3 says the pair rules'
fallback weekly clock spends these fees. Nothing in the code does. The same applies to the 75 bps of every buy before the void.

H-1, H-3 and L-2 turn this into a griefing path: anyone can force the void.

Fix: on `Voided`, switch to a race-free pro-rata redemption at a rate fixed at void time (`sol[s] / sold[s]` per raw token) and charge
no fee. Consider routing a voided pair's burn-pool SOL back pro-rata, or document plainly that it is burned in place. State in the UI
that a void is not a refund.

## M-2 — the Squads upgrade script

Checked and correct: the inner message layout (1 signer, 0 writable signers, 4 writable non-signers; `Upgrade` = u32 3, accounts in
loader order programdata, program, buffer, spill, rent, clock, authority), the multisig offsets (`transaction_index` @78), the
`VaultTransactionCreateArgs` and `proposal_create` encodings, and the refusal to send on mainnet. The script **cannot** be made to
propose a different *authority*: the vault is derived from `--multisig` and `--vault-index`. It **can** be made to propose a different
*buffer*. Anyone can create a buffer holding arbitrary code and run `set-buffer-authority` to point it at the Squads vault. If the
operator pastes that address (a log, a chat, a lookalike), voters approve an opaque hex message that upgrades a program holding every
raise. `--spill`, which receives the buffer's ~2.4 SOL of rent, is unchecked too, and `--vault-index` is not range-checked (256
wraps to 0 consistently).

Fix: require `--expect-sha256 <hash of the verifiable build>`, then fetch the buffer, hash `data[37..]` (trimmed to the ELF length)
and refuse on a mismatch. Also require the buffer authority == vault, the programData upgrade authority == vault, and spill ∈ {vault,
member}. Print the hash in the output for the voters.

## Low and Info detail

- **L-1** (`pc2_burned_dust_blocks_close_after_void`, passes): the holder burns 1 raw token and sells the rest. State afterwards:
  `sold [1,0] sol [1,0]`, and `close_pair` fails with `NotClosable` forever. Fix: on `Voided`, allow close once `sol == [0,0]`, or once
  the vault's token balance plus `sold` equals the supply minus what was burned (read the mint supply).
- **L-2** (`pc2_share_flip_blocks_graduation`, passes): with 64.5/22.5 SOL budgets the pair is ready. Selling 5 % of B's tokens gives
  `NotReadyToGraduate`. Each flip costs the griefer 1 %, and buying back costs another 1 % (curve round trips are otherwise free).
  Near the deadline a single flip forces the void (M-1). At `min_side_share_bps = 5000`, `a·10⁴ ≥ 5000(a+b)` and the mirror condition
  mean `a == b` to the lamport. That is reachable only by an atomic balance-buy plus graduate, and a one-lamport trade breaks it.
  Fix: cap the share at about 4,000, or measure the share on a time-weighted raise.
- **L-3**: `planPairCrank` bundles `register` with `graduate`. `set_registration_policy` does not refuse policy-2 configs, so an admin
  switch after the 48 h timelock makes every keeper graduate revert. Send graduate alone and register afterwards, and refuse policy
  switches on policy-2 tokens before graduation.
- **L-4**: CPMM writes observations only in swaps. A pair pool with no swap returns `TwapUnavailable` (an error, not "untradeable"),
  so the reading queue never advances until someone swaps dust. Have the keeper seed a dust swap after graduation, or count
  `TwapUnavailable` toward the unblock clock.
- **I-1…I-5** as in the table.

## Attempts that failed (and the check that stopped them)

- **Sandwiching graduation** (buy just before, sell into the new pool): the pool's reserves are λ·(V_s+F, V_t−sold) with λ < 1. Its
  price equals the curve's, but it is shallower, so selling Δ yields λ(V_s+F)Δ/(λ(V_t−s)+Δ), which is less than the curve cost of Δ.
  The attack loses money. `price_matched_tokens` (`math.rs:122-127`) rounds tokens down, so the pool opens at or a hair above the curve
  price. `open_time = now+1` means no swap can land in the creation transaction.
- **Gap between the two calls**: both curves close at the first call (`graduate.rs:93-100`, sells `trade.rs:149-152`), and the second
  pool's amounts are fixed by frozen state. The only lever left is H-1.
- **Squatting the pool address**: the pool is a pair_curve PDA, and CPMM requires a signer for any non-canonical address
  (`create_pool`).
- **Pre-funding the pool PDA, LP mint, observation, token-side vault or LP ATA**: `create_or_allocate_account` and Anchor `init`
  handle it. The extra lamports end up as residue or sit in CPMM accounts.
- **Donating to the vault, the token vault or the vault's WSOL ATA**: the donations become residue or burned tokens
  (`graduate.rs:148,193-195,218-241`).
- **Rounding / dust**: F is a function of `sold` (`math.rs:22-28`), so any path pays or receives F(end) − F(start) (test
  `buy_then_sell_round_trip_restores_the_curve`). The per-trade fee floor exempts only trades under 100 lamports, saving at most 0.99
  lamport per instruction against 5,000 lamports per signature.
- **Blocking exits through the developer wallet**: `dev_can_receive` (`trade.rs:69-75`) redirects the slice to the burn pool (test
  `a_drained_developer_wallet…`). The wallet is fixed at init, and init refuses the vault and both fee PDAs (`init_pair.rs:150`).
- **Re-initialising a closed pair, or a foreign pool / forged Pair**: `require_fresh_mint` (mint authority must be the vault), and
  `register_pair_pool.rs:53-70` with the forgery test.
- **Token-2022 / freeze authority**: `Account<Mint>` from `anchor_spl::token` rejects non-SPL-Token owners, and
  `init_pair.rs:93-95` rejects any freeze authority. CPMM's `initialize` sets `enable_creator_fee = false`, and `crank_buyback.rs:204`
  adds the creator fee only when it is enabled, so the fee table is correct. Pool fees are never stuck with the vault.
- **Instruction trace / compute under full pre-funding** (`pc2_keeper_tx_budget_under_prefunding`): the keeper's graduate+register
  costs 201 k CU (limit 600 k) and has a trace of about 48–50 of 64. No adversary can add entries beyond pre-funding.
- **Reentrancy**: Solana forbids A→B→A.
- **Signer/owner/PDA/mutability**: every instruction re-derives the Pair from its seeds and bump. The vault, fee vaults, dev wallet,
  mint and token vaults are address-pinned to the Pair. The graduate pool comes from its seeds and the stored bump, and CPMM's own
  accounts are checked against `PoolView` afterwards. The post-CPI guards are tested with the hostile CPMM. Pair size is 888 B.

## Comparison with PAIR-CURVE.md §8 and earlier reviews (read after the above)

The three earlier blind reviews cover `burn_receipts` only; none mentions pair_curve, so nothing is closed or regressed relative to
them. On the threat model, item by item:

1. CPI integrity: **holds** (post-CPI guards are tested).
2. Math: **holds**.
3. Graduation edge and forced void: **open**. L-2, plus H-1, which forces a void for 0.004 SOL; there is no profitable
   price-match attack.
4. Registration provenance: **holds** for forgeries. **New**: H-2, registration can be destroyed by `close_pair`.
5. Liveness and the commit: **refuted**. §5.1's claim that only Raydium's admin can block the second side is wrong (H-1), and the
   question "can anyone make the first call succeed and the second impossible?" has the answer yes, for 0.002 SOL. **New**: H-3, the
   launch-time variant, which the threat model does not consider.
6. Rent and residue: §5.3's "fallback weekly clock spends them" and §5.4's "only when nothing is owed" are **incorrect or incomplete**
   (M-1, L-1, H-2).

The measured numbers match §9: graduate trace 45–47, plus about 3 for the keeper's register and budget instructions.

Test evidence: 9 `pc2_*` tests in a local copy of the harness (uncommitted). Every finding above with a test name was reproduced
against commit 547558fa.
