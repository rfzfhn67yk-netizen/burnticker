# `pair_curve` — the launch program for rivalry pairs (both graduate, or neither does)

Design written 2026-10-10, before the code, for the owner's decision of the same day: *a rivalry pair launches through one program in
which both coins graduate together or neither does.* Single coins stay on Raydium LaunchLab. Until this program ships, pairs launch as
two LaunchLab curves under the rules-level "both or neither" void clause (branch `burnticker/derby`). Program source:
`programs/burn-receipts/programs/pair_curve/` (a second member of the same Anchor workspace as `burn_receipts`). Measured numbers
(sizes, compute units, devnet signatures) are in §9 and in `docs/burnkeeper/devnet-paircurve-run-log-2026-10-10.md`.

## 1. Why a pair curve

A rivalry pair is two coins indexed to opposite outcomes of the same event (WHITEPAPER §5). On LaunchLab each coin has its own curve and
its own graduation threshold, so one side can graduate and trade on Raydium while the other stays stuck on its curve — the pair's
scoreboard then compares a liquid coin with an illiquid one, and the losing side's holders cannot leave at a fair price. `pair_curve`
couples the two launches: **one account per pair, two bonding curves, one graduation condition over the combined raise that latches
the pair the moment a trade meets it, a crank that creates the Raydium pools one per transaction, and one void path that turns every
holder's tokens into a fixed pro-rata share of what their side raised.**

**Revised after two blind reviews (2026-10-10).** `docs/burnticker/reviews/2026-10-10-pair-curve-blind-1.md` and `…-blind-2.md` found
five Highs between them (pre-funded and pre-created accounts that blocked graduation or `init_pair` forever, a `close_pair` that could
strand a graduated side's burn pool, and a developer wallet that could freeze every trade). §8 lists what was wrong and what replaced it;
the finding → commit table is in `docs/burn-receipts/CHANGELOG.md`. An independent re-check of the fixes
(`docs/burnticker/reviews/2026-10-10-pair-curve-recheck.md`) and a PR review found five residuals, fixed in round 2 (§8, second table).

## 2. Accounts

| Account | Address | Owner | Holds |
|---|---|---|---|
| `Pair` | `["pair", mint_a, mint_b]` | pair_curve | parameters (fixed at init), curve state per side, status, pools, LP record |
| SOL vault | `["vault", pair]` | **System** (no data) | every lamport the curves raised, the escrowed 75 bps burn share of each side, the accrued 25 bps developer share, plus its own rent minimum |
| token vault A / B | ATA(SOL vault, mint) | SPL Token | the side's unsold curve tokens plus its liquidity reserve (`init_pair` creates it, or accepts one somebody pre-created if it is empty, undelegated and has no close authority) |
| pool A / B (after graduation) | `["pool", pair, [side]]` under pair_curve, created by CPMM | Raydium CPMM | the graduated CPMM pool of that side |

**Why the SOL vault is a lamports-only system PDA, not wrapped SOL.** (1) Raydium CPMM's `initialize` makes its `creator` pay the rent
of the pool accounts with `system_program::create_account`, whose `from` must be a system-owned account without data — the vault can
play that role directly and is therefore the pool creator. (2) Buys and sells move native SOL with one System transfer each: no wrap /
unwrap per trade, no token account whose authority a callee could re-assign, two fewer accounts per trade. (3) The only time SOL is
wrapped is inside `graduate`, for the CPMM deposit, in a WSOL account the program creates and closes in the same instruction.

Each coin: a classic SPL Token mint (no Token-2022), **1,000,000,000 supply, 6 decimals**, minted in full into the side's token vault
by `init_pair`, mint authority revoked in the same instruction, freeze authority never set. The client creates the mint accounts
beforehand (so it can attach Metaplex metadata while it still holds the mint authority) and hands the mint authority to the SOL vault
PDA; `init_pair` refuses a mint with any supply, any freeze authority, other decimals or another mint authority.

## 3. The curve (per side)

Pump.fun / LaunchLab-style constant product with virtual reserves, made **path-independent** so the SOL vault can never gain or lose a
lamport to rounding:

```
V_s = virtual SOL (lamports), V_t = virtual tokens (raw), sold = tokens the curve has sold (raw), 0 ≤ sold ≤ curve_supply < V_t
F(sold) = ceil(V_s · sold / (V_t − sold))          the lamports the side's curve holds when `sold` tokens are out
```

The program stores `sold` per side and keeps `sol[side] = F(sold[side])` as an invariant.

- **buy(side, max_lamports_in, min_tokens_out)**: the net budget `N` is the largest value with `N + fee(N) ≤ max_lamports_in`; the
  buyer receives `t = min(floor((F(sold) + N) · V_t / (V_s + F(sold) + N)), curve_supply) − sold` tokens (the closed-form inverse of F:
  `ceil(x) ≤ σ ⇔ x ≤ σ`) and pays exactly `cost = F(sold + t) − F(sold)` plus `fee(cost)`. A budget the curve cannot use (sell-out cap,
  rounding) stays in the buyer's wallet.
- **sell(side, amount, min_lamports_out)**: gross `= F(sold) − F(sold − amount)`; the seller receives `gross − fee(gross)`.
- `fee(x) = floor(x · 100 / 10,000)` (100 bps, rounded down: rounding never favours the program or the fee recipients); split
  `dev = floor(fee · 25 / 100)`, `burn = fee − dev` — so `dev + burn = fee` exactly, every trade.
- A buy whose budget buys nothing, or whose curve cost would be 0, is refused (`ZeroOutput`); the net-budget search runs in u128, so a
  `max_lamports_in` of `u64::MAX` cannot overflow (blind review 1 I-1/I-2).

Consequences, each pinned by a TS fixture test (`test/pairCurvePricing.test.ts`) and a Rust test: the vault holds exactly
`F(sold_A) + F(sold_B)` + the escrowed and accrued fees (+ its rent minimum) after every trade; buying `t` and selling `t` returns exactly `cost` to the vault and the
price to where it was; when every holder has sold back, both sides are at `sold = 0`, `F(0) = 0`, and the vault holds only its rent
minimum — the SOL vault drains *exactly*.

**Defaults** (pump.fun's published constants, which make the graduation price match the pool price at sell-out):
`V_s` = 30 SOL, `V_t` = 1,073,000,000 tokens, `curve_supply` = 793,100,000 tokens, liquidity reserve = 206,900,000 tokens (20.69 %).
One side sells out at `F(curve_supply)` ≈ 85.0 SOL. The pair's `target_raise` (combined) defaults to 85 SOL. All of these are per-pair
`init_pair` arguments, validated (§6) and **never writable afterwards** — no instruction takes them.

## 4. Fees on the curve

**100 bps on every curve trade, buy and sell, while the pair is Open. Redemptions after a void carry no fee (§5.3).**

| Share | bps | Where it goes |
|---|---|---|
| Burnticker developer | 25 | accrued in the SOL vault (`Pair.dev_accrued`); `claim_developer_fee` (permissionless) pays it to the `platformClaimFeeWallet` of the ONE LaunchLab platform compiled into the build (`BURNTICKER_PLATFORM`, §6), copied into the Pair at init |
| that side's burn pool | 75 | escrowed in the SOL vault (`Pair.burn_escrow[side]`); paid to the `burn_receipts` fee PDA `["fee", mint]` when the side's pool is created, returned to the side's holders if the pair voids |
| nobody else | 0 | no referral, no Raydium curve fee, no creator slice |

The developer's slice matches what we publish for LaunchLab (25 bps). On LaunchLab Raydium keeps 25 bps of the curve; on `pair_curve`
there is no Raydium curve fee, so the burn pool's slot is 75 bps instead of 50.

**No trade credits any account except the SOL vault and the trader** (blind review 1 H-2). The first version paid both fee legs inside
every trade; a developer wallet that could not be credited (an executable account, or one a trader drained below rent) then failed
every buy *and* every sell. Now the developer's 25 bps sit in the vault until a separate, permissionless `claim_developer_fee`, which
is refused (and affects nothing else) while the wallet cannot receive them; `close_pair` waits for the claim to be payable. The burn
share is escrowed rather than paid at once because a burn pool can only spend through a registered pool: if the pair voids, that money
belongs to the side's holders (§5.3), not to a fee PDA that will never have a pool (blind review 2 M-1).

**After graduation.** The pools are created through CPMM's public `initialize` (the permissioned path LaunchLab uses needs a Raydium
permission PDA we do not have), which sets `enable_creator_fee = false`: the burn pool earns **nothing** from post-graduation CPMM
volume on a pair coin (a LaunchLab coin earns 4.75 bps there). The CPMM trade fee's LP share accrues to the pool's LP, which is
**locked forever** in Raydium's CPMM lock (LAUNCHPAD-PATH §35, owner decision 2026-10-10; §5.1 step 6): its Fee Key NFT is held by
burn_receipts' FEE_KEYS PDA, and burn_receipts' permissionless `claim_lock_fees` collects those fees and splits the SOL side 80 % to
the side's burn pool and 20 % to the operator treasury (compiled constants, no admin) and burns the coin side. Raydium keeps its
protocol and fund shares.

## 5. Lifecycle

```
            buy/sell (both sides)    the trade that meets the condition commits the pair (or graduate(first side) does)
   Open ──────────────────────────────▶ Graduating ──graduate(A), graduate(B)──▶ Graduated  (two CPMM pools; lock_lp per side: 100 % of
                                                                                          the LP locked forever, Fee Key → FEE_KEYS)
    │                                       │
    │ void_pair — permissionless,           │ void_pair — a missing side goes into redemption (refunding[side]) ≥ 3 days
    │ at/after the deadline, never committed│ after the commit if Raydium blocks it, ≥ 30 days after it whatever the reason
    ▼                                       ▼
  Voided   (buys closed; each holder redeems a fixed pro-rata share of their side, no fee — §5.3)
```

- **Buys**: only while `Open` and `now < deadline`.
- **Curve sells**: while `Open` and `now < deadline`. **Redemptions**: while `Voided`, or on a refunding side. Never on a side whose
  pool exists or is committed to exist. At/after the deadline an Open pair can only void, so a curve sell there is refused
  (`DeadlinePassed`): the first version of the fix still let a holder sell at the top of the curve between the deadline and the
  `void_pair` call, ahead of everyone's pro-rata redemption (re-check RC-1). Clients send `void_pair` and the redemption in one
  transaction. A sell before the deadline on a pair that is visibly going to fail is a normal curve exit (a bank run on a failing curve
  is inherent; the UI says so).
- **Graduation condition**: `sol_A + sol_B ≥ target_raise` **and** `sol_A · 10,000 ≥ min_side_share_bps · (sol_A + sol_B)` **and**
  the same for B (default 2,500 bps; at most 4,000 — §6) **and** both sides can pay for their pools at the pinned AmmConfig's current
  `create_pool_fee` with pool creation enabled (blind review 1 L-1).
- **The commit latches** (blind review 2 L-2). The first version checked the condition only when the crank ran, so a holder of the
  weak side could sell a hair before `graduate` landed and un-meet the share by one lamport, every time, until the deadline voided the
  pair. Now every buy and curve sell re-evaluates the condition, and the trade that meets it commits the pair in the same instruction
  (status Graduating, `PairCommitted` event; curves closed to buys and sells). `graduate`'s first call applies the same rule, for a
  pair that became ready while Raydium's fee was too high.
- **Deadline**: commits require `now < deadline`; `void_pair` requires `now ≥ deadline` and status `Open`. Exactly one of the two can
  ever succeed. The second side's `graduate` has no deadline — the pair is already committed. The keeper cranks `graduate` the
  moment a pair is committed (`src/lib/burnKeeper/pairCurveCrank.ts`), each side in its own transaction, each registration in its own
  transaction (blind review 2 L-3), and seeds a pool's first oracle observation with a dust swap when nobody has traded it yet (L-4).

### 5.1 `graduate(side)` — one pool per transaction

`graduate` runs **once per side**, permissionless, on a committed pair (or commits it first, §5). Each call creates its own side's
pool; the call that completes the second side sets **Graduated**.

*Why not both pools in one instruction (the first draft of this design).* Solana caps a transaction's instruction trace at 64 entries
(the top-level instruction plus every CPI at every depth). One CPMM `initialize` costs ~19 entries; with the program's own wrap, LP burn,
token burn and account closes one side costs ~26, and ~35 when a griefer pre-funds the addresses CPMM creates (each `create_account`
then becomes transfer + allocate + assign). Both sides in one transaction measured ~58 entries before griefing — a griefer spending
~0.01 SOL on pre-funding could push every pair's graduation over 64 and force it to void. One side per transaction measures 45–47
entries with every address pre-funded (`tests/lifecycle.rs` `prefunded_addresses_do_not_block_graduation`).

*If a side cannot be created.* After the commit only Raydium can cause that: raising the pinned AmmConfig's `create_pool_fee` above the
side's raise, disabling pool creation, or changing CPMM so that it refuses the pair's PDA-signed `initialize` (a refusal that leaves no
trace in the AmmConfig — and a failed `graduate` reverts, so it leaves no evidence on chain either). `void_pair` examines **every**
missing side and puts it alone into redemption (`refunding[side]`, §5.3) when either `GRADUATION_STUCK_SECS` (3 days) have passed
since the commit and the AmmConfig shows the block, or `GRADUATION_FALLBACK_SECS` (30 days) have passed whatever the reason (re-check
RC-2/RC-3). Inactivity alone never refunds a side within 30 days — a pair nobody cranked for 3 days is still graduated by the next
crank (blind review 1 L-3). If neither pool exists and both sides end up refunding, the pair becomes Voided (nothing can be registered,
so it is closable once everyone has redeemed). Otherwise the other side keeps its pool and its registration and the Pair account is
never closed, so the state is terminal and readable (blind review 1 L-2;
`graduating_commits_the_pair_and_only_a_real_raydium_block_refunds_the_second_side`).

Each call, for its side:
1. `overhead` = CPMM's `create_pool_fee` (read from the pinned AmmConfig) + the rent of the six accounts `initialize` creates (pool 637 B,
   observation 4,075 B, LP mint 82 B, two pool vaults and the LP account 165 B each) + the rent of the vault's own WSOL account (165 B,
   created first and closed last — it comes back as residue). The rent comes from the Rent sysvar (5,080 lamports/byte on devnet and
   mainnet in October 2026).
2. `pool_sol = sol_side − overhead` (refused if not positive — the commit rule makes this unreachable unless Raydium raises its fee).
3. `pool_tokens = min(floor(pool_sol · (V_t − sold) / (V_s + F(sold))), token-vault balance)` — the pool opens at (or a hair above)
   the curve's last price, so there is no graduation gap to arbitrage.
4. Wrap `pool_sol` into the vault's WSOL account; CPI CPMM `initialize` with the vault as `creator` and the pool account at the
   pair_curve PDA `["pool", pair, [side]]` (signed by pair_curve's seeds), `open_time = now + 1`.
5. Post-CPI checks (`guards.rs`): the SOL vault is still System-owned with no data and lost at most CPMM's own take; the WSOL account
   and the token vault keep owner, mint, no delegate and no close authority, and moved exactly the deposit; the pool is CPMM-owned and
   records the vault as `pool_creator`, the pinned AmmConfig, the two mints, the two vaults and the observation account; its token vault
   holds exactly `pool_tokens` and its WSOL vault exactly `pool_sol` **plus whatever lamports somebody sent to that address beforehand**
   (above its rent; blind review 2 H-1 — CPMM's `create_or_allocate_account` keeps them and WSOL's `InitializeAccount` counts them as
   balance, so the first version's exact check reverted forever; the excess now simply joins the pool and is reported in the
   `SideGraduated` event as `prefunded_wsol`); the vault's LP account holds `lp_supply − 100` (CPMM keeps 100 units unminted).
6. Record `lp_supply_at_creation[side]` and leave the LP (`lp_supply − 100`, event `SideGraduated.lp_minted`) in the vault's LP account.
   **`lock_lp(side)`** — a separate permissionless instruction, its own transaction — then moves ALL of it into Raydium's CPMM lock
   program (`lock_cp_liquidity`; permanent, never withdrawable), with the Fee Key NFT's mint at the pair_curve PDA
   `["fee_nft", pair, [side]]` and `fee_nft_owner` = burn_receipts' FEE_KEYS PDA; it checks afterwards that the vault kept every lamport
   and is still the System account, that no LP is left in the vault, that the lock's LP account grew by exactly the LP, that FEE_KEYS
   holds the one NFT and that the lock state names this pool and NFT; it records `lp_locked[side]` (the field formerly `lp_burned`,
   same offset) and closes the emptied LP account (rent to the side's burn pool). The cranker pays the lock's rents (≈ 0.0065 SOL).
   *Before LAUNCHPAD-PATH §35 this step burned 100 % of the LP; pairs graduated then keep their burn record in the same field.*
7. Burn every token left in the side's token vault (unsold curve tokens and any reserve the price match did not need), close the WSOL
   account (the account is synced before it is first read, so lamports somebody sent to an existing vault WSOL account without
`SyncNative` are just residue — PR review, Low), and send to this side's burn pool everything above what the vault must keep — its rent minimum, the developer accrual, and
   the other side's raise and escrow while that side's pool is still to come. That transfer includes this side's escrowed 75 bps
   (`burn_escrow_paid` in the event) and the rent refunds.

**Squatting.** A CPMM pool at the canonical PDA `["pool", cpConfig, WSOL, mint]` can be created by anyone who holds a few tokens of the
mint (CPMM `initialize` is public). If graduation used that address, one griefer could make it fail forever. The pools are therefore
created at **pair_curve PDAs**, which only pair_curve can sign for (CPMM accepts a signing non-PDA pool account — its "random account"
path). A squatter can still open a separate pool at the canonical address; it does not block graduation and it is not the registered
pool (blind review 2 I-4: aggregators may route there; the site links only the registered pool).

### 5.2 Registration in `burn_receipts`

`burn_receipts.register_pair_pool` (new, permissionless, once per token) accepts a pair pool when:

1. the token's TokenConfig has registration policy **2 = `POOL_POLICY_PAIR_CURVE`** (chosen at `initialize_token`, which still pins the
   LaunchLab platform and its cpConfigId exactly as policy 0 does);
2. the `Pair` account is owned by the hard-coded pair_curve program id, carries the `Pair` discriminator, sits at
   `["pair", mint_a, mint_b]`, has status `Graduated`, and lists this mint as one of its sides;
3. the pool is the one the Pair records for that side **and** the pair_curve PDA `["pool", pair, [side]]` (only pair_curve can have
   created it), is a CPMM PoolState of WSOL / this mint on SPL Token, its `pool_creator` is the pair's SOL vault PDA and its AmmConfig is
   the cpConfigId pinned in the TokenConfig;
4. **LP**: the Pair's record says ≥ 90 % of the LP that existed at creation was locked by `lock_lp` (or burned, for pairs graduated
   before LAUNCHPAD-PATH §35), **and** the chain agrees: the LP in Raydium's lock account ATA(LOCK_CPMM_AUTHORITY, lp_mint) plus CPMM
   `lp_supply − LP mint supply` (everything ever burned plus the 100 never-minted units) is at least the record. Measured against the
   creation supply, not the live one, so a later depositor cannot dilute the ratio and block registration (the class of blind-review-3
   M-2). A pool whose LP is not locked yet is refused (`LpNotLocked`).
5. **The Fee Key** (LAUNCHPAD-PATH §35): after registration, burn_receipts' permissionless `register_fee_key` records the side's lock
   position in a FeeKeyRecord — the lock program's LockedCpLiquidityState for the registered pool whose NFT FEE_KEYS holds, identified
   by its **locker** (state @128 = the pair's SOL vault, which `lock_lp` also re-checks after the CPI) and holding a strict majority of
   the LP in Raydium's lock account ATA(LOCK_CPMM_AUTHORITY, lp_mint) — so a later deposit cannot dilute it (lp-lock blind review 2026-10-11
   RL-2; before r2 the majority was measured against the live `lp_supply`); `claim_lock_fees` then collects the LP fees with the FEE_KEYS signature — SOL 80 % to the side's burn pool, 20 %
   to the compiled operator treasury (parked in the record while the treasury cannot receive it), the coin side burned, a receipt memo.
   The keeper's order per side: graduate → lock_lp → register_pair_pool → register_fee_key → seed swap → claim_lock_fees on its cadence.
   **LAUNCHPAD-PATH §40 — winner takes the burn (2026-10-11).** Before register_pair_pool (which now requires it), burn_receipts'
   permissionless `link_pair` pairs the two coins with the Pair as the witness (PairLink ["pair_link", mint] per coin, any status but
   Voided). Then at each result a quorum of each coin's attesters signs one PairResult ["pair_result", mint_lo, mint_hi, date] naming
   the winner (or a draw); the loser's crank for that period refuses and `forward_to_winner` moves exactly what its rule would have
   spent — buyback_spend(min(spendable, cap), units, f), nothing under its floor — from the loser's burn pool to the winner's; the
   winner's ordinary cranks burn the winner's coin. The loser's supply is untouched; a draw forwards nothing; no result within 72 h of
   the reading lets the coin crank as unpaired. Devnet: docs/burnkeeper/devnet-pair-forward-run-log-2026-10-11.md.
   The keeper (src/lib/burnKeeper/pairCurveCrank.ts) sends `link_pair` as its own transaction once a side has a pool and both
   TokenConfigs exist, before register_pair_pool; then per period (src/lib/burnticker/multiKeeper.ts): both coins attest, the PairResult
   is posted, the loser's `forward_to_winner` lands, then the winner cranks — receipts `forwarded`, the append-only `pair_forwards`
   table, the receipt line "forwarded from $LOSER: N SOL → $WINNER burn pool".
   `claim_lock_fees` always collects everything accrued (no amount argument, r2 L-3) against the FeeKeyRecord's pool (r2 L-1).
6. **Fallback if the lock cannot be made** (r2 L-2): `lock_lp` depends on Raydium's upgradeable lock program. If a graduated side's LP
   is still unlocked 30 days (`LP_LOCK_FALLBACK_SECS`) after the graduation decision, anyone may call pair_curve's `burn_lp(side)`: it
   burns all of the vault's LP for that side, records it in `lp_locked` (so step 4 still passes on burned LP) and closes the LP account
   into the side's burn pool. That side then earns no LP fees. `burn_lp` is the **only** instruction that destroys LP; it refuses before
   the 30 days and once `lock_lp` ran. The keeper locks at graduation and alerts on any graduated side still unlocked.
   **LP policy (round 2, 2026-10-11).** The LP is locked forever. `burn_lp` exists as a fallback — the only path that destroys LP; used only if Raydium's lock refuses for 30 days. The keeper sends it only when it is due
   and raises `pair-side-unlocked` for every graduated side still unlocked, from the first cycle after graduation (before the fallback is
   due as well), so a refusing lock is a visible alarm long before the fallback could run.

Nothing else in `burn_receipts` changed: `register_pool` (LaunchLab, policy 0), `replace_pool`, the fixed-pool fallback and every
post-CPI guard are untouched; `crank_buyback` only needs `pool_verified` and the registered address, which `register_pair_pool` sets.
Why `pool_creator` is the vault PDA and not the fee PDA: CPMM's public `initialize` requires the creator to *sign and pay*; only
`burn_receipts` can sign for the fee PDA, and lending the burn pool's signature to an external program to pay pool rent is exactly the
exposure blind review 3 (M-1) warned about. With the creator fee disabled, `pool_creator` carries no money on these pools; the
provenance comes from the pool address (a pair_curve PDA), the Pair record and the creator check together.

### 5.3 `void_pair` and redemption

`void_pair` flips `Open → Voided` at or after the deadline. It snapshots, per side, a **redemption pool** = the side's curve SOL plus its
escrowed 75 bps, and the **redemption supply** = the tokens outstanding. From then on a "sell" on that side is a redemption: `amount`
tokens return `floor(amount · pool / supply)` lamports, no fee, and whoever returns the last outstanding tokens receives exactly what is
left. The same applies to a side refunded under the stuck rule (§5.1).

*What was wrong before* (blind review 2 M-1). The first version kept the curve open after a void: each exit paid `F(sold) − F(sold −
amount)` less 1 %. Selling down a curve pays early sellers the top of the curve and late sellers the bottom, so a void was a race, and
the 75 bps of every exit went to a burn pool that — with no pool ever registered — could never spend it.

*Redemption is fair per token, not per lamport paid.* Every token of a side redeems at the same rate whatever the order of exits
(tested: `redemption_is_order_independent_and_drains_exactly` in `math.rs`, and on devnet). Buyers paid different prices along the
curve, so this is not a refund of each buyer's cost: an early buyer gets back more than they paid, a late buyer less. Over the side as
a whole every lamport the curve raised plus the escrowed burn share goes back to the holders. The protocol keeps only the developer's
25 bps (accrued) and has no claim on the rest.

### 5.4 `close_pair()`

Permissionless, **only for a Voided pair**, and only once no token of either coin circulates outside the vault — measured as `mint
supply = token-vault balance` per side, so tokens a holder burned count as gone and one burned raw unit cannot block the close
forever (blind review 2 L-1). It burns the returned supplies, pays the developer accrual — or, if the wallet cannot receive it (an
executable account, or a payment that would leave it below rent), sends it to the burn pools with the residue
(`PairClosed.dev_accrual_to_burn_pools`; re-check RC-5) —
sends any lamports above the SOL vault's rent minimum (redemption dust, donations) to the two burn pools, and closes the token vaults
and the Pair with their rent to the pair's recorded creator — or to burn pool A if that address is executable and cannot be credited
(blind review 1 I-3). The SOL vault PDA stays as a system account with its rent minimum. A Pair can never be re-created for the same
mints (they have no mint authority any more).

*What was wrong before* (blind review 1 H-1 = blind review 2 H-2). The first version also closed a **Graduated** pair once its token
vaults were empty. `burn_receipts.register_pair_pool` reads the Pair account to prove a pool's provenance; a pair closed before both
registrations had landed left that side's burn pool unable to register, ever. A committed or graduated Pair is now permanent.

## 6. Parameter validation at `init_pair` (all fixed thereafter)

- signers: payer and **creator**, and the creator must equal the `creator` recorded in BOTH mints' burn_receipts TokenConfigs (so nobody
  can open a pair on someone else's mints between `initialize_token` and `init_pair`);
- both TokenConfigs: owned by the hard-coded burn_receipts id, at `["config", mint]`, buyback mode, registration policy 2, the same
  pinned LaunchLab platform and cpConfigId; the platform account passed is that platform (owner LaunchLab) — the developer wallet is read
  from it; the AmmConfig passed is the pinned one (owner CPMM, pool creation enabled);
- **the platform is Burnticker's own**: it must equal `BURNTICKER_PLATFORM`, compiled into the build per cluster (devnet
  `GvSKpe5pwLuRzCQ56EGAA1urjtcxx554NivsGHexv3tf`; the mainnet build carries a placeholder and refuses every `init_pair` with
  `PlatformNotPinned` until the owner's mainnet platform is compiled in — runbook gate P0). The first version accepted any
  LaunchLab-owned platform, so a creator could route the "developer" 25 bps of a pair shown on our site to a wallet of their choosing
  (blind review 1 M-1, blind review 2 I-3);
- the two token vaults are created, or, when somebody already created the associated token account, accepted if it holds 0 tokens and
  has no delegate and no close authority (blind review 2 H-3: anyone could create the vault's ATA once the mints existed, and the first
  version's plain `init` then failed forever);
- `V_t > curve_supply ≥ 1`; `curve_supply + reserve = 10^15` raw; reserve between 10 % and 50 % of supply; `V_s ≥ 0.01 SOL`;
- `min_side_share_bps` ∈ [1,000, 4,000] (at 5,000 graduation would need both raises equal to the lamport — blind review 2 L-2); `target_raise` ≥ 0.1 SOL and reachable: `2 · F(curve_supply) ≥ target_raise` and
  `F(curve_supply) ≥ target_raise · share` (each side can reach its minimum);
- each side's minimum raise `target_raise · share` covers that side's graduation costs (CPMM fee + rents, at init-time values) plus
  0.01 SOL of pool liquidity;
- at sell-out the price-matched pool needs no more tokens than the reserve;
- deadline between 60 seconds and 90 days from now.

## 7. Powers

**None over funds.** The full register (`docs/burn-receipts/pair-curve-powers-register.md`, generated from the IDL; the generator fails
on an undescribed instruction or signer):

| Instruction | Who | What it can do |
|---|---|---|
| `init_pair` | payer + the creator recorded in both TokenConfigs | create the pair once (Burnticker's compiled-in platform only); mint the supplies into the vaults; revoke mint authority |
| `buy` / `sell` | anyone, for their own wallet | trade along the curve at the formula's price while Open (the trade that meets the condition commits the pair); after a void, redeem pro rata, no fee |
| `graduate` | anyone | once per side on a committed pair; creates its side's pool, burns the leftover tokens, pays the side's escrowed burn share; the LP stays in the vault for lock_lp |
| `lock_lp` | anyone | once per side after graduate: locks ALL of the pool's LP in Raydium's CPMM lock forever, Fee Key NFT to burn_receipts' FEE_KEYS PDA (LAUNCHPAD-PATH §35); round 2: the lock state's locker (@128) must be the pair vault |
| `burn_lp` | anyone | round 2 (2026-10-11) fallback, once pools[side] is set, lp_locked[side] is 0 and 30 days have passed since graduation started (`LP_LOCK_FALLBACK_SECS`; `LpLockFallbackNotDue` before): burns the vault's LP, records it in lp_locked, closes the LP account into the side's fee vault (event `LpBurnedFallback`) — the only path that destroys LP; used only if Raydium's lock refuses for 30 days |
| `void_pair` | anyone | after the deadline if never committed; on a committed pair, each missing side ≥ 3 days after the commit while Raydium blocks it, or ≥ 30 days after it whatever the reason |
| `claim_developer_fee` | anyone | pay the accrued 25 bps to the developer wallet recorded at init |
| `close_pair` | anyone | Voided pairs with nothing circulating; burn the returned supplies; rent to the recorded creator; residue (and an accrual the developer wallet cannot receive) to the burn pools |

There is **no** admin, no authority field, no pause, no parameter update, no withdraw / sweep / transfer-out of the SOL vault or the
token vaults except: a seller's own exit (formula price or pro-rata redemption), the developer claim (the accrual, fixed recipient),
the CPMM deposit at graduation (formula amounts, into pools whose LP lock_lp then locks forever with the Fee Key at burn_receipts'
FEE_KEYS PDA), and escrow plus residue to
the side's own burn pool. The **program upgrade authority** is the one power above all of this, exactly as for `burn_receipts`
(blind review 1 M-2): an upgrade could change any rule above for pairs already raising. It sits with the Squads 2-of-3 vault and its
time lock. A time lock longer than the longest pair (up to 90 days, §6) is not practical, so the mainnet plan is to finalise the
program (authority set to none) once the review period ends, before the first public pair; until then every upgrade proposal is made with `scripts/squads-program-upgrade.mts`, which refuses unless the buffer's
code hashes to the local verifiable build, the buffer and the program are both under the vault, and the rent goes back to the vault
or a member (blind review 2 M-2; `docs/burnticker/runbook.md` "Pair program gates"). The code check compares the buffer's
**executable hash** (solana-verify's definition) with `config/burnticker/verified-build.json` for that program and cluster — mandatory,
never a hash the operator types (re-check, M-2 caveat).

**Upgrades and the Pair layout.** An upgrade replaces the code for every pair at once, including pairs that are raising. Anchor
deserialises `Pair` by its exact layout, so an upgrade that changes the layout makes every existing Pair unloadable — trades, exits,
claims and closes would all fail with `AccountDidNotDeserialize`. This happened on devnet: pair 1 (`5etkAGzW…`, 888 B, Graduated
before the 946 B layout of `fa8627a4`) is unloadable by the current program and is retired
(`docs/burnkeeper/evidence/devnet-paircurve-2026-10-10/pair1-RETIRED.json`; nothing was owed by it, its pools stay registered). Rule:
**while any pair is live, an upgrade must keep the `Pair` layout byte-for-byte (new fields only inside `reserved`, 64 bytes) or ship
a migration instruction and run it before anything else**; burn_receipts reads only the first 236 bytes, which never change
(runbook gate P3).

## 8. Threat model — what was wrong, and what reviewers should attack next

**What the two blind reviews found in the first version** (reviewed at `547558fa`; every attack is now a regression test in
`tests/review_pc1.rs` / `tests/review_pc2.rs` that must fail with the named error):

| Finding | What was wrong | Now |
|---|---|---|
| R2 H-1 | Sending lamports to a side's future WSOL pool vault made CPMM count them as balance; `graduate`'s exact balance check then reverted forever and the pair could only void | the check accepts ≥; the excess joins the pool (§5.1 step 5) |
| R2 H-2 = R1 H-1 | `close_pair` closed a Graduated pair; a pair closed before both registrations stranded a burn pool forever | Voided pairs only (§5.4) |
| R2 H-3 | Pre-creating the vault's ATA for a mint made `init_pair` fail forever | `init_if_needed` + empty / no delegate / no close authority (§6) |
| R1 H-2 | Trades paid the developer wallet directly; an executable or drained wallet failed every buy and sell, exits included | fees accounted in the vault; permissionless `claim_developer_fee` (§4) |
| R2 M-1 | A void left a curve race (early exits at the top, late at the bottom) and sent 75 bps of every exit to a burn pool that could never spend it | fixed pro-rata redemption, no fee, burn escrow returned (§5.3) |
| R1 M-1 / R2 I-3 | Any LaunchLab platform could be pinned, so a pair's 25 bps "developer" share could go anywhere | `BURNTICKER_PLATFORM` compiled per cluster (§6) |
| R2 M-2 | The Squads upgrade script proposed any buffer and any spill address | four checks, all printed (§7) |
| R1 M-2 | The upgrade authority can change live pairs | written plan: finalise before the first public pair (§7) |
| R2 L-1 | One burned raw token kept `sold ≠ 0` and blocked `close_pair` forever | close on `mint supply = vault balance` (§5.4) |
| R2 L-2 | The share condition could be un-met by one sell just before the crank, repeatedly | the commit latches on the trade that meets it; share ≤ 4,000 bps (§5) |
| R1 L-1 | The first `graduate` could commit a pair whose other side could not pay for its pool | the commit requires both sides payable at the current AmmConfig (§5) |
| R1 L-2 / L-3 | The stuck rule reopened sells after 3 days of mere inactivity, and a Graduating pair had no terminal state | refund only while Raydium really blocks the side; `refunding[side]` is terminal (§5.1) |
| R2 L-3 | The keeper sent graduate + register in one transaction, so a failing registration blocked graduation | separate transactions; graduation never depends on registration (§5) |
| R2 L-4 | A pool nobody had traded had no oracle observation, so `crank_buyback` deferred forever | the keeper seeds a dust swap (§5) |
| R1 I-1 / I-2 | `net_budget` could overflow at `u64::MAX`; a 0-cost buy was possible at extreme parameters | u128 search; 0-cost buys refused (§3) |

**Round 2 — what the re-check and the PR review found in the fixes** (`2026-10-10-pair-curve-recheck.md`, tests `tests/review_pc3.rs`):

| Finding | What was still wrong | Now |
|---|---|---|
| RC-1 (R2 M-1 residual, Medium) | Between the deadline and the `void_pair` call an Open pair still sold along the curve: the early buyer of the reviewer's scenario took +7.12 SOL instead of its +2.46 SOL pro-rata share | curve sells at/after the deadline refused; void, then redeem (§5) |
| RC-2 (Low) | The stuck-side refund only recognised a block visible in the AmmConfig; a CPMM-side refusal locked a side forever | 30-day unconditional fallback (§5.1) |
| RC-3 (Info) | `void_pair` looked only at the first missing side | every missing side examined; both refunded without pools → Voided |
| RC-5 (Info) | An executable developer wallet with an accrual outstanding blocked `close_pair` (rent stranded) | the accrual goes to the burn pools at close (§5.4) |
| M-2 caveat (Low) | The upgrade script compared a local file and an optional plain sha256, not the published executable hash | mandatory check against `verified-build.json` (§7) |
| PR review (Low) | An unsynced lamport donation to an existing vault WSOL account made `graduate` fail until somebody synced | `SyncNative` before the first read; the keeper prepends one too |
| Layout (Info) | A layout-changing upgrade freezes live pairs (devnet pair 1) | documented rule + runbook gate (§7) |

**What to attack next:**

1. **The graduation CPI.** `graduate` lends the SOL vault's signature (signer + writable, holding the raise, the escrows and the
   developer accrual) to CPMM, an external upgradeable program, once per side. The post-CPI checks are in §5.1 step 5 (`guards.rs`).
   Can a malicious CPMM upgrade drain more than the intended deposit, re-assign the vault, or leave an LP the program does not burn?
2. **The accounting identity.** After every instruction the vault must hold `Σ sol + Σ burn_escrow + dev_accrued + rent`. Any path
   that breaks it (a redemption rounding, the residue sweep in `graduate` and `close_pair`, a pre-funded or donated lamport) is a bug.
3. **The commit latch and redemption.** Can a trader force a commit at a manipulated split, or engineer a commit that a side cannot
   complete? Is the pro-rata redemption order-independent at the extremes (one raw token outstanding, supply near u64)?
4. **The stuck-side refund.** It needs 3 days *and* a real Raydium block (pool creation disabled, or the fee leaves the side no
   liquidity). Can it be triggered without one, or can a refunded side's redemption reach the graduated side's money?
5. **Registration provenance** in `burn_receipts.register_pair_pool` (Graduated, or Graduating with this side's pool recorded):
   forged Pair accounts, a pool from another pair or side, LP-ratio griefing, Pair layout drift (burn_receipts reads it by byte offset;
   the new fields were appended after offset 236).
6. **Residual liveness.** Pre-funded or pre-created accounts anywhere else in `init_pair` / `graduate`; the 64-entry trace; a
   developer wallet or creator that cannot be credited (claim and close must stay independent of trading).
7. **The LP lock (LAUNCHPAD-PATH §35).** `lock_lp` lends the SOL vault's signature (as the LP's owner) and the Fee Key mint PDA's
   signature to Raydium's lock program, whose source is not public. Can a hostile or upgraded lock program take vault lamports, leave
   LP behind, mint the Fee Key elsewhere, or leave a state that burn_receipts' `register_fee_key` would accept for another pool? And
   in burn_receipts: can `claim_lock_fees` be made to pay anyone but the side's fee PDA and the compiled treasury, touch the locked
   principal or the Fee Key, or be blocked (an unfunded treasury parks the operator share in the FeeKeyRecord instead)?


## 9. Sizes and compute (measured)

| | value | where measured |
|---|---|---|
| program size | 393,488 B mainnet build / 393,544 B devnet build (opt-level "z") — devnet rent ≈ 2.0 SOL | `target/deploy/pair_curve.so`, devnet upgrade 2026-10-10 21:56 (LP-lock release, vault transaction 7) |
| `Pair` account | 946 B (8 + 938) | LiteSVM, devnet |
| `init_pair` | 110–125 k CU (PDA bump searches vary) | devnet 121,967 / 112,479 |
| `buy` | 34–55 k CU (the top end creates the buyer's token account) | devnet 33,977–55,130 |
| `sell` (curve) / redemption | ≈ 30 k / ≈ 29 k CU | devnet 30,004 / 28,830–29,200 |
| `graduate(side)` | 163–172 k CU on devnet; instruction trace 45–47 of 64 with every created address pre-funded | devnet 172,203 (WSOL vault pre-funded) / 162,739; LiteSVM |
| `lock_lp(side)` (real devnet lock program `DRay25Us…`) | 140–158 k CU, 946 B | devnet 158,245 / 140,245 (pair 6); LiteSVM 117 k with the test-only lock stand-in |
| `register_pair_pool` (own transaction) | 22–36 k CU | devnet 33,959 / 35,497 (LP-lock release) |
| burn_receipts `register_fee_key` / `claim_lock_fees` on a pair pool | 37–43 k / 235–252 k CU (1,118 B) | devnet pair 6 (`docs/burnkeeper/evidence/devnet-lock-2026-10-10/`) |
| `claim_developer_fee` | ≈ 23 k CU | devnet 22,579 |
| `void_pair` | ≈ 20 k CU | devnet 20,150 |
| `close_pair` (voided, burns both supplies, pays the accrual) | ≈ 34 k CU | devnet 33,771 |
| keeper seed swap (CPMM `swap_base_input`, 10,000 lamports) | 41–49 k CU | devnet |
| `crank_buyback` on a pair pool | 103–106 k CU in LiteSVM; 210–225 k on devnet (keeper's transaction incl. memo and ATA creation) | devnet run log |

Tests: `programs/burn-receipts/programs/pair_curve/src/math.rs` (11 unit tests, reference values shared with the TS fixtures),
`tests/lifecycle.rs` (16 LiteSVM tests against the real CPMM and burn_receipts, plus a hostile CPMM stand-in), `tests/review_pc1.rs` (10) and
`tests/review_pc2.rs` (9), `tests/review_pc3.rs` (7) — the reviewers' exploits inverted into regressions —, `test/pairCurvePricing.test.ts`,
`test/pairCurveClient.test.ts`, `test/pairCurveLaunch.test.ts`. Devnet: `docs/burnkeeper/devnet-paircurve-run-log-2026-10-10.md`
(first rehearsal at 17:00, re-rehearsal of the fixed program at 18:32, round-2 spot check at 19:58–20:10) and the LP-lock run in
`docs/burnkeeper/evidence/devnet-lock-2026-10-10/` (21:38–22:08: both programs upgraded, pair 6 graduated + locked + registered +
claimed, a LaunchLab coin migrated with 100 % of its LP locked to FEE_KEYS and claimed). The lock program's source is not public: the
LiteSVM suites use a TEST-ONLY stand-in (`mocks/cpmm_lock_mock`) built to the SDK's account orders and the on-chain
LockedCpLiquidityState layout; the devnet run exercises the real program.
