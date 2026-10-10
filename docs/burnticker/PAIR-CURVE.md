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
couples the two launches: **one account per pair, two bonding curves, one graduation condition over the combined raise, a crank whose
first call commits both sides and creates the Raydium pools one per transaction, and one void path that leaves every buyer able to
sell back.**

## 2. Accounts

| Account | Address | Owner | Holds |
|---|---|---|---|
| `Pair` | `["pair", mint_a, mint_b]` | pair_curve | parameters (fixed at init), curve state per side, status, pools, LP record |
| SOL vault | `["vault", pair]` | **System** (no data) | every lamport the curves raised, plus its own rent minimum |
| token vault A / B | ATA(SOL vault, mint) | SPL Token | the side's unsold curve tokens plus its liquidity reserve |
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

Consequences, each pinned by a TS fixture test (`test/pairCurvePricing.test.ts`) and a Rust test: the vault holds exactly
`F(sold_A) + F(sold_B)` (+ its rent minimum) after every trade; buying `t` and selling `t` returns exactly `cost` to the vault and the
price to where it was; when every holder has sold back, both sides are at `sold = 0`, `F(0) = 0`, and the vault holds only its rent
minimum — the SOL vault drains *exactly*.

**Defaults** (pump.fun's published constants, which make the graduation price match the pool price at sell-out):
`V_s` = 30 SOL, `V_t` = 1,073,000,000 tokens, `curve_supply` = 793,100,000 tokens, liquidity reserve = 206,900,000 tokens (20.69 %).
One side sells out at `F(curve_supply)` ≈ 85.0 SOL. The pair's `target_raise` (combined) defaults to 85 SOL. All of these are per-pair
`init_pair` arguments, validated (§6) and **never writable afterwards** — no instruction takes them.

## 4. Fees on the curve

**100 bps on every trade, buy and sell, in both statuses that allow trading (Open, and sells after a void):**

| Recipient | bps | Address |
|---|---|---|
| Burnticker developer wallet | 25 | `platformClaimFeeWallet` of the LaunchLab PlatformConfig the token's `burn_receipts` TokenConfig pinned (the same key that receives the 25 bps on LaunchLab), copied into the Pair at init |
| that mint's burn pool | 75 | the `burn_receipts` fee PDA `["fee", mint]` of the side traded |
| nobody else | 0 | no referral, no Raydium curve fee, no creator slice |

The developer's slice matches what we publish for LaunchLab (25 bps). On LaunchLab Raydium keeps 25 bps of the curve; on `pair_curve`
there is no Raydium curve fee, so the burn pool's slot is 75 bps instead of 50.

If a developer-fee transfer would leave the developer wallet below the rent-exempt minimum (a wallet emptied to 0 cannot receive a
sub-rent amount), that trade's developer slice goes to the burn pool instead: **the developer wallet can never block trading, and
in particular can never block exits.** The fee PDA always holds at least its burn_receipts reserve (≥ rent), so its leg cannot fail
the same way.

**After graduation.** The pools are created through CPMM's public `initialize` (the permissioned path LaunchLab uses needs a Raydium
permission PDA we do not have), which sets `enable_creator_fee = false`: the burn pool earns **nothing** from post-graduation CPMM
volume on a pair coin (a LaunchLab coin earns 4.75 bps there). The CPMM trade fee's LP share accrues to the burned LP (nobody), Raydium
keeps its protocol and fund shares. This is the main economic difference from a LaunchLab coin; the whitepaper's fee table states it.

## 5. Lifecycle

```
            buy/sell (both sides)        graduate(first side) — permissionless, condition met, before the deadline
   Open ──────────────────────────────▶ Graduating ──graduate(other side)──▶ Graduated  (two CPMM pools, 100 % of LP burned)
    │
    │ void_pair — permissionless, at/after the deadline, graduation never started
    ▼
  Voided   (buys closed; sells stay open along the same curves until every holder is out)
```

- **Buys**: only while `Open` and `now < deadline`.
- **Sells**: while `Open` (also after the deadline, before anyone voids) and while `Voided`. Never once graduation has started (the
  coin trades on its CPMM pool then) — except the stuck-second-side rule of §5.1.
- **Graduation condition** (checked by the first `graduate`): `sol_A + sol_B ≥ target_raise` **and** `sol_A · 10,000 ≥ min_side_share_bps · (sol_A + sol_B)` **and**
  the same for B (default 2,500 bps = each side holds ≥ 25 % of the combined raise). Checked at the crank; trading does not lock when
  the condition is first met (a later trade can un-meet it; whatever holds when `graduate` runs decides).
- **Deadline**: the first `graduate` requires `now < deadline`; `void_pair` requires `now ≥ deadline` and status `Open`. Exactly one of the two can
  ever succeed, so the outcome is deterministic: if nobody starts graduation by the deadline, the pair voids (the second side's
  `graduate` has no deadline — the pair is already committed). The keeper cranks
  `graduate` the moment the condition holds (`src/lib/burnKeeper/pairCurveCrank.ts`).

### 5.1 `graduate(side)` — the decision, then one pool per transaction

`graduate` runs **once per side**. The first call is the decision: it requires the graduation condition and `now < deadline`, and
moves the pair to **Graduating** — from that instant both curves are closed to buys *and* sells and the pair can no longer void, so the
second side is committed. Each call creates its own side's pool; the call that completes the second side sets **Graduated**.

*Why not both pools in one instruction (the first draft of this design).* Solana caps a transaction's instruction trace at 64 entries
(the top-level instruction plus every CPI at every depth). One CPMM `initialize` costs ~19 entries; with the program's own wrap, LP burn,
token burn and account closes one side costs ~26, and ~35 when a griefer pre-funds the addresses CPMM creates (each `create_account`
then becomes transfer + allocate + assign). Both sides in one transaction measured ~58 entries before griefing — a griefer spending
~0.01 SOL on pre-funding could push every pair's graduation over 64 and force it to void. One side per transaction measures 45–47
entries with every address pre-funded (`tests/lifecycle.rs` `prefunded_addresses_do_not_block_graduation`). The keeper sends side A's
`graduate` + `register_pair_pool` in one legacy transaction and side B's in the next (1,061 bytes each on devnet).

*If the second side cannot be created.* Only Raydium's admin can cause that between the two calls (raising the pinned AmmConfig's
`create_pool_fee` above the side's raise, or disabling pool creation). The second side stays creatable; and if it is still missing
`GRADUATION_STUCK_SECS` (3 days) after the decision, **sells reopen on that side's curve** so its holders are never locked in
(`graduating_commits_the_pair_and_a_blocked_second_side_reopens_its_sells_after_three_days`).

Each call, for its side:
1. `overhead` = CPMM's `create_pool_fee` (read from the pinned AmmConfig) + the rent of the six accounts `initialize` creates (pool 637 B,
   observation 4,075 B, LP mint 82 B, two pool vaults and the LP account 165 B each) + the rent of the vault's own WSOL account (165 B,
   created first and closed last — it comes back as residue). The rent comes from the Rent sysvar (5,080 lamports/byte on devnet and
   mainnet in October 2026).
2. `pool_sol = sol_side − overhead` (refused if not positive — the init check of §6 makes this unreachable unless Raydium raises its fee).
3. `pool_tokens = min(floor(pool_sol · (V_t − sold) / (V_s + F(sold))), token-vault balance)` — the pool opens at (or a hair above)
   the curve's last price, so there is no graduation gap to arbitrage.
4. Wrap `pool_sol` into the vault's WSOL account; CPI CPMM `initialize` with the vault as `creator` and the pool account at the
   pair_curve PDA `["pool", pair, [side]]` (signed by pair_curve's seeds), `open_time = now + 1`.
5. Post-CPI checks (`guards.rs`): the SOL vault is still System-owned with no data and lost at most CPMM's own take; the WSOL account
   and the token vault keep owner, mint, no delegate and no close authority, and moved exactly the deposit; the pool is CPMM-owned and
   records the vault as `pool_creator`, the pinned AmmConfig, the two mints, the two vaults and the observation account; its vaults hold
   exactly `pool_sol` and `pool_tokens`; the vault's LP account holds `lp_supply − 100` (CPMM keeps 100 units unminted).
6. **Burn 100 % of the LP** with SPL `burn` (the LP mint supply drops to 0; CPMM's `lp_supply` keeps counting it, which is how
   `burn_receipts` measures "burned"), close the LP account, record `lp_supply_at_creation[side]` and `lp_burned[side]`.
7. Burn every token left in the side's token vault (unsold curve tokens and any reserve the price match did not need), close the WSOL
   account, and send everything above the vault's rent minimum and the other side's still-owed raise to this side's burn pool (rent
   refunds and dust — a few thousandths of a SOL).

**Squatting.** A CPMM pool at the canonical PDA `["pool", cpConfig, WSOL, mint]` can be created by anyone who holds a few tokens of the
mint (CPMM `initialize` is public). If graduation used that address, one griefer could make it fail forever. The pools are therefore
created at **pair_curve PDAs**, which only pair_curve can sign for (CPMM accepts a signing non-PDA pool account — its "random account"
path). A squatter can still open a separate pool at the canonical address; it does not block graduation and it is not the registered
pool.

### 5.2 Registration in `burn_receipts`

`burn_receipts.register_pair_pool` (new, permissionless, once per token) accepts a pair pool when:

1. the token's TokenConfig has registration policy **2 = `POOL_POLICY_PAIR_CURVE`** (chosen at `initialize_token`, which still pins the
   LaunchLab platform and its cpConfigId exactly as policy 0 does);
2. the `Pair` account is owned by the hard-coded pair_curve program id, carries the `Pair` discriminator, sits at
   `["pair", mint_a, mint_b]`, has status `Graduated`, and lists this mint as one of its sides;
3. the pool is the one the Pair records for that side **and** the pair_curve PDA `["pool", pair, [side]]` (only pair_curve can have
   created it), is a CPMM PoolState of WSOL / this mint on SPL Token, its `pool_creator` is the pair's SOL vault PDA and its AmmConfig is
   the cpConfigId pinned in the TokenConfig;
4. **LP**: the Pair's record says ≥ 90 % of the LP that existed at creation was burned, **and** the chain agrees: CPMM `lp_supply − LP
   mint supply` (everything ever burned plus the 100 never-minted units) is at least the recorded burn. Measured against the creation
   supply, not the live one, so a later depositor cannot dilute the ratio and block registration (the class of blind-review-3 M-2).

Nothing else in `burn_receipts` changed: `register_pool` (LaunchLab, policy 0), `replace_pool`, the fixed-pool fallback and every
post-CPI guard are untouched; `crank_buyback` only needs `pool_verified` and the registered address, which `register_pair_pool` sets.
Why `pool_creator` is the vault PDA and not the fee PDA: CPMM's public `initialize` requires the creator to *sign and pay*; only
`burn_receipts` can sign for the fee PDA, and lending the burn pool's signature to an external program to pay pool rent is exactly the
exposure blind review 3 (M-1) warned about. With the creator fee disabled, `pool_creator` carries no money on these pools; the
provenance comes from the pool address (a pair_curve PDA), the Pair record and the creator check together.

### 5.3 `void_pair` and exits

`void_pair` flips `Open → Voided` after the deadline. Buys are off; sells stay open on the same curves at the same prices, so each holder can
exit for `F(sold) − F(sold − amount)` less the 100 bps fee; when everyone is out the SOL vault holds exactly its rent minimum. Curve fees
collected so far are already in the fee PDAs; the pair rules' fallback weekly clock spends them (rules-level, not this program).

### 5.4 `close_pair()`

Permissionless, only when nothing is owed: status `Graduated` with both token vaults empty, or status `Voided` with `sold_A = sold_B = 0`
(its token vaults then hold the full supplies, which are burned). Any lamports above the SOL vault's rent minimum (donations, dust) go
to the two burn pools; the token-vault accounts and the Pair account are closed with their rent returned to the pair's creator (who
paid it). The SOL vault PDA itself stays as a system account with its rent minimum. A Pair can never be re-created for the same mints
(its mints have no mint authority any more).

## 6. Parameter validation at `init_pair` (all fixed thereafter)

- signers: payer and **creator**, and the creator must equal the `creator` recorded in BOTH mints' burn_receipts TokenConfigs (so nobody
  can open a pair on someone else's mints between `initialize_token` and `init_pair`);
- both TokenConfigs: owned by the hard-coded burn_receipts id, at `["config", mint]`, buyback mode, registration policy 2, the same
  pinned LaunchLab platform and cpConfigId; the platform account passed is that platform (owner LaunchLab) — the developer wallet is read
  from it; the AmmConfig passed is the pinned one (owner CPMM, pool creation enabled);
- `V_t > curve_supply ≥ 1`; `curve_supply + reserve = 10^15` raw; reserve between 10 % and 50 % of supply; `V_s ≥ 0.01 SOL`;
- `min_side_share_bps` ∈ [1,000, 5,000]; `target_raise` ≥ 0.1 SOL and reachable: `2 · F(curve_supply) ≥ target_raise` and
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
| `init_pair` | payer + the creator recorded in both TokenConfigs | create the pair once; mint the supplies into the vaults; revoke mint authority |
| `buy` / `sell` | anyone, for their own wallet | trade along the curve at the formula's price; slippage bounds are theirs |
| `graduate` | anyone | once per side; the first call (condition met, before the deadline) commits the pair; each creates its side's pool and burns the LP and leftovers |
| `void_pair` | anyone | after the deadline, if graduation never started |
| `close_pair` | anyone | close empty accounts; rent to the recorded creator; residue to the burn pools |

There is **no** admin, no authority field, no pause, no parameter update, no withdraw / sweep / transfer-out of the SOL vault or the
token vaults except: a seller's own exit (formula price), the fee legs (formula amounts, fixed recipients), the CPMM deposit at
graduation (formula amounts, into pools whose LP is burned in the same instruction), and residue to the burn pools. The **program
upgrade authority** is the one power above all of this, exactly as for `burn_receipts`: deployed under the same Squads 2-of-3 vault
with its time lock, finalised (set to none) on the same plan (`docs/burnticker/runbook.md` "Pair program gates").

## 8. Threat model — what reviewers should attack first

1. **The graduation CPI.** `graduate` lends the SOL vault's signature (signer + writable, holding the raise) to CPMM, an external
   upgradeable program, once per side. The post-CPI checks are in §5.1 step 5 (`guards.rs`). Can a malicious CPMM upgrade drain more than the
   intended deposit, re-assign the vault, or leave an LP the program does not burn? (The vault is a System account: `assign` needs the
   vault's signature, which CPMM holds during the CPI — the owner re-check after each CPI is what stops it.)
2. **The curve math** (`math.rs`): path independence, the inverse, the fee split, overflow at the extremes (u128 everywhere, `V_s`,
   `V_t` up to u64), and whether any sequence of trades leaves the vault short (insolvency) or long (stranded dust).
3. **The graduation condition at the edge** (`sol_A · 10,000 = share · total`, the deadline second, the sell-out cap) and whether a
   whale can force a void, force a graduation at a manipulated price, or profit from the price match.
4. **Registration provenance** in `burn_receipts.register_pair_pool`: forged Pair accounts (another owner, wrong PDA, status), a pool
   from another pair or side, LP-ratio griefing, Pair layout drift (burn_receipts reads it by byte offset).
5. **Liveness and the commit.** Anything that can make `graduate` fail for good (squatted addresses, pre-funded PDAs, Raydium raising its
   pool fee, CU, account or instruction-trace limits). Before the first call the fallback is the deadline void; after it the pair is
   committed and the fallback is the 3-day stuck rule (sells reopen on the missing side). Can a trader exploit the window between the
   two calls, or the stuck rule? Can anyone make the first call succeed and the second impossible?
6. **Rent and residue.** The developer-wallet redirection rule, the residue sweep to the burn pools, and `close_pair`.

## 9. Sizes and compute (measured)

| | value | where measured |
|---|---|---|
| program size | 344,688 B (opt-level "z" for this package only; 420 KB at opt-level 3) — devnet rent 1.752 SOL | `target/deploy/pair_curve.so`, devnet deploy |
| `Pair` account | 888 B (8 + 880) | LiteSVM, devnet |
| `init_pair` | 90–125 k CU (PDA bump searches vary) | LiteSVM; devnet 124,767 / 109,767 |
| `buy` | 35–84 k CU (the top end creates the buyer's token account) | devnet 35,770–83,923 |
| `sell` | ≈ 32 k CU | devnet 32,140–32,365 |
| `graduate(side)` | ≈ 150–162 k CU; instruction trace 45–47 of 64 with every created address pre-funded | LiteSVM |
| `graduate(side)` + `register_pair_pool` | 178–187 k CU, one legacy transaction of 1,061–1,157 B | devnet 185,067 / 187,291 (1,061 B) |
| `register_pair_pool` alone | 21–30 k CU | LiteSVM |
| `void_pair` | 10–18 k CU | devnet 18,057 |
| `close_pair` (voided, burns both supplies) | 20–28 k CU | devnet 28,422 |
| `crank_buyback` on a pair pool | 103–106 k CU in LiteSVM; 213–223 k on devnet (keeper's transaction incl. memo and ATA creation) | devnet `6gLu9k4u…`, `4W2njhur…` |

Tests: `programs/burn-receipts/programs/pair_curve/src/math.rs` (9 unit tests, reference values shared with the TS fixtures),
`programs/burn-receipts/programs/pair_curve/tests/lifecycle.rs` (14 LiteSVM tests against the real CPMM and burn_receipts, plus a
hostile CPMM stand-in), `test/pairCurvePricing.test.ts`, `test/pairCurveClient.test.ts`, `test/pairCurveLaunch.test.ts`. Devnet:
`docs/burnkeeper/devnet-paircurve-run-log-2026-10-10.md`.
