# burn_receipts — the on-chain burn program for Receipts ($DEFICIT)

**Status (2026-10-10): engineering build, localnet only; second and third blind reviews closed (`CHANGELOG.md`).** Nothing has been deployed anywhere; no real key exists. The program id in
`Anchor.toml` / `declare_id!` is a localnet test key generated on the dev Mac. The owner performs every real deployment (runbook below).

The idea in one line: *a token whose supply shrinks by a public number nobody involved controls* (SPEC §0). The off-chain keeper
(level 1) already does this with a hot key. This program is levels 2–3: **the formula and the money live in a Solana program, the
data arrives as an attested reading, anyone can crank, and nobody custodies the creator's fees.**

| Path | What |
|---|---|
| `programs/burn-receipts/` | Anchor 1.2.1 workspace (program `burn_receipts`, LiteSVM tests, CPMM fixture script, IDL / powers-register generators) |
| `src/lib/burnReceipts/` | TypeScript client: PDAs, IDL-driven instruction builders, attestation signing, memo, CPMM views, `crank.ts` for the keeper |
| `test/burnReceipts*.test.ts` | TS unit tests (in `npm test`) + an opt-in end-to-end test on a local validator |
| LiteSVM / localnet pins | LP-lock round 2 (2026-10-11): the `test-pins` cargo feature compiles test values for `OPERATOR_TREASURY` and `BURNTICKER_PLATFORM` into localnet builds, so the Rust suites can exercise claims and initialize_token; it is never part of a devnet or mainnet build |
| `docs/burn-receipts/attestation.md` | Attestation: N-of-M ed25519 attesters (keeper, second operator, zkTLS relayer), the signed message, the zkTLS relayer path; why there is no Switchboard attester |
| `docs/burn-receipts/powers-register.{json,md}` | Every power anyone holds — generated from the IDL |

---

## 1. Architecture

```
            Treasury "Debt to the Penny" (public JSON)
                  │                          │
     keeper data key        second operator key        zkTLS relayer key      ← ATTESTERS: ed25519 keys, quorum N of M
                  │  each signs (feed, period, value, sha256(source URL), proof locator)
                  └──────────┬───────────────┘
                             ▼
   submit_reading(record_date, value)  ── permissionless, quorum-checked, append-only ──►  Reading PDA (one per date)
                             │                                                             units = carry rule(prev, now)
                             ▼
   crank_buyback(record_date) ── permissionless, strictly in order ──►
        fee PDA SOL ──► fee PDA's WSOL ATA ──► Raydium CPMM swap_base_input ──► fee PDA's token ATA ──► BURN (100 %)
        + Memo program CPI: the canonical memo v2, written by the program in the same instruction
   (vault mode: crank_vault burns units × tokens_per_unit from the config PDA's ATA; shortfall carried; memo v1)
```

**Accounts (all PDAs of the program, keyed by the mint):**

| Account | Seeds | Holds |
|---|---|---|
| `TokenConfig` | `["config", mint]` | the immutable rule (`RuleParams`), feed id, memo text, rules-file sha256, params hash, attester set + quorum, pending attester proposal, the registered CPMM pool and whether it passed the provenance checks (`pool_verified`), the untradeable spell (`pool_untradeable_since` / `_last_seen`), the cluster genesis the signed message binds (`cluster_genesis`), and running state (last reading, carry, carried spend, crank cursor, totals, vault shortfall) |
| fee PDA | `["fee", mint]` | a **system-owned** account (no data) — the creator-fee recipient. SOL. Its ATAs (WSOL, token) are the buyback's working accounts; Raydium CPMM pays creator fees into them. |
| `Reading` | `["reading", config, record_date u32 LE]` | one attested reading: value, prev, delta, carry in/out, units, voters bitmask, then the crank outcome (pool basis, spent, got, burned / owed, shortfall, carried spend, and the CPMM pool it traded on). Never closed. |
| vault (vault mode) | ATA(config PDA, mint) | tokens to burn; authority = the config PDA |
| `PlatformConfig` | `["platform"]` (one per program) | the temporary pre-audit **burn-pool cap** (default 25 SOL), its sunset time, its authority and a pending raise |

**Instructions** (full table with signers and limits: `powers-register.md`):
`initialize_token` (mint-signed, once) · `register_pool` · `submit_reading` · `crank_buyback` · `crank_vault` · `crank_no_units` ·
`propose_attesters` / `cancel_attester_change` / `renounce_admin` (config authority) · `apply_attester_change` ·
`initialize_platform` (upgrade-authority-signed, once) · `propose_cap_raise` / `cancel_cap_raise` / `renounce_platform_authority`
(platform authority) · `apply_cap_raise`. **There is no withdraw, sweep, close, set-recipient, pause, mint or rule-update
instruction.**

### The rule (fixed at init; `src/math.rs`, mirrored in `src/lib/burnReceipts/math.ts`)

- **Units:** on an increase, `units = floor((delta + carry_in) / unit_value)`; the remainder carries across *consecutive* increases;
  a down or flat day earns nothing and resets the carry to zero (the keeper's `debtStep`, SPEC §2). `$1B = 100,000,000,000` cents.
- **Buyback (primary):** `pool = fee PDA lamports − reserve + WSOL already held`;
  `rule spend = pool × (1 − (1 − f)^units)`, `f = fraction_per_unit_bps / 10,000` (500 = 5 %). Fixed-point (1e18) binary
  exponentiation with floors, u128 throughout; agrees with the keeper's exact rational to ≤ 1 lamport for pools under 10^15 lamports
  (pinned by test). The crank's **target** is the rule spend plus any spend **carried** from earlier cranks; under `floor_lamports`
  nothing is bought (the pool keeps the SOL; the reading is still processed and memo'd `swap=none`).
- **Swap safety (review H-1 / L-7):** the cranker chooses nothing.
  - **Per-crank size cap:** one crank spends at most **2 % of the pool's WSOL reserve** (price impact under ~4 %) and at most the
    platform basis; the rest of the target is carried (`TokenConfig.carried_spend_lamports`, `Reading.carried_in/out_lamports`) and a
    `SpendCapBound` event is emitted. Small, frequent buys are the structural defence against sandwiching.
  - **Mandatory TWAP guard:** `max_twap_deviation_bps` ≤ 300 and `twap_window_secs` 600–1,200 (enforced at init; the window
    fits CPMM's 100-entry oracle ring). The spot SOL price (in tokens) may not sit more than the deviation below the CPMM oracle's
    time-weighted average — the oracle records prices *before* each swap and only across distinct seconds, so a same-block front-run
    cannot move it. The TWAP runs to *now* (the pool's current price since its last swap is exactly what CPMM will accumulate for
    that stretch; a same-transaction front-run moves the oracle's `last_update` to now and adds nothing). A refused crank defers the
    burn day (late, never lost).
  - **`min_out` (review-2 F1)** = the larger of two quotes, each the constant-product output minus the pool's whole fee minus
    `slippage_bps` (≤ 300): one on the live reserves, one on a pool of the same SOL depth priced at the TWAP. A same-transaction push
    lowers the first, not the second, so a sandwich can take at most `slippage_bps` of a spend that is itself ≤ 2 % of the reserve.
  - **The oracle's 15-second buckets (review-2 F1):** an older observation's cumulative is exact at its bucket's last swap, up to 14 s
    after its timestamp. The program dates it at the latest possible moment, so the TWAP can read HIGH by up to 14/window (never low):
    the guard and the TWAP quote are only ever stricter. Both tolerances must therefore cover 15 s of the window
    (`deviation × window ≥ 150,000` and `slippage × window ≥ 150,000`: ≥ 250 bps at 600 s, ≥ 125 bps at 1,200 s). **Recommended for
    $DEFICIT: window 1,200 s, deviation 300, slippage 300** — in a quiet pool that leaves ≈ 1.8 % of headroom against a recent rise.
  - **Dead pool (review-2 F7):** after 30 days of *continuous* untradeability (observations ≤ 24 h apart, see §3) a buyback reading is
    processed below-floor with its whole target carried, so the queue never wedges; the carry is spent once the pool trades again.
- **Platform burn-pool cap (temporary, pre-audit — owner decision 2026-10-09):** while `now < PlatformConfig.cap_sunset_ts`, the
  rule is applied to `min(pool, cap)` instead of the whole pool (default cap 25 SOL). SOL above the cap simply stays in the fee PDA;
  every time the cap binds, `BurnPoolCapBound` is emitted and the reading records both `pool_lamports` (the basis used — also the
  memo's `pool=`, so the memo's arithmetic still checks) and `pool_actual_lamports`. The cap can only be **raised** (48 h timelock,
  anyone applies), the sunset is fixed at creation (≤ 365 days, never extendable), the authority can renounce, and only the program's
  upgrade authority can create the PlatformConfig (with an initial cap ≤ 25 SOL). **If no PlatformConfig exists, the hard-coded default
  applies (25 SOL until 2027-10-01T00:00Z)** — review M-1: a lost or finalised upgrade authority can never wedge buybacks. The cap
  bounds each crank's basis, not a cumulative total.
- **Burn:** every token the fee PDA holds is burned — what the swap delivered plus any creator-fee tokens Raydium paid in.
- **Vault (alternative):** `owed = min(units × tokens_per_unit + shortfall_in, allocation_left)`, `burn = min(owed, vault)`,
  `shortfall = owed − burn` (public, carried) — the keeper's `settleBurn`.
- **Order:** readings are processed strictly in submission order (`prev_date == crank_cursor`); zero-unit readings auto-process.
- **Plausibility (review M-2):** a quorum-signed reading whose change exceeds `max_abs_delta` is **accepted as a RESET** — 0 units,
  carry reset, it becomes the new baseline — and `ReadingReset` is emitted. It never wedges the feed.
- **Fixed supply (review L-3):** `register_pool`, `replace_pool` and both cranks require the mint to have no mint authority and no
  freeze authority.
- **Memo:** byte-for-byte the keeper's v1/v2 format; in v2 `swap=` is the first 12 base58 characters of the CPMM pool (the swap and
  the burn are one instruction, which cannot know its own signature). `memoFromChain()` rebuilds it from the accounts alone.

---

### Registration policy 2 — pools created by `pair_curve` (2026-10-10)

A rivalry pair launched through the `pair_curve` program (`docs/burnticker/PAIR-CURVE.md`) has no LaunchLab pool: its CPMM pools are
created by `pair_curve`'s `graduate` at pair_curve PDAs, with the pair's SOL vault as `pool_creator` and all LP burned. Such a token is
initialised with `pool_policy = 2` (the LaunchLab platform is still pinned — its cpConfigId is the AmmConfig the pools must use) and its
pool is registered by `register_pair_pool` (`src/instructions/register_pair_pool.rs`, `src/pair_curve.rs`). Nothing else changes:
`crank_buyback`, `check_pool_health` and the fee PDA work the same; `replace_pool` stays policy-0 only; the stranding switch cannot
select policy 2.

## 2. Trust model, level by level

| Level | Who can lie about the number | Who holds the money | What a stranger checks |
|---|---|---|---|
| **1 — keeper only** (the off-chain keeper) | the keeper | the keeper's hot key (fee pool, vault authority) | memo vs Treasury, after the fact |
| **2 — this program, `attesters = [keeper data key]`, quorum 1** | the keeper's **data** key (can sign a false reading; bounded by the plausibility bound, monotone dates, and visible forever on chain) | **nobody**: the fee PDA and vault have no withdraw path; only swap→burn | every reading's signature, units, spend, min-out and memo are recomputable from accounts + Treasury |
| **2+ — keeper + second operator (or + zkTLS relayer), quorum 2** | two independent keys would both have to sign the false value; with a relayer, the signed `proof_hash` points at a zkTLS proof anyone can check against the TLS session | nobody | as above + the second signature, and the proof at `proof_hash` |
| **3 — quorum of independent operators / relayers whose proofs are checked publicly** | a colluding quorum, against public zkTLS proofs | nobody | the proofs alone (the program verifies signatures only; proof checking is off chain by design) |

Powers that remain at every level (all public, all in the register): the config authority's attester proposals (48 h timelock, quorum
never lowered; renounceable), and the **program upgrade authority** (Squads multisig + time lock at launch, then `--final`).

### The owner's "no room for suspicion" requirements (2026-10-09) — how each is met and where it is tested

| # | Requirement | Status | Test(s) |
|---|---|---|---|
| 1 | No withdraw/sweep/close/set-recipient; SOL and tokens leave only via swap→burn or burn; rent stays | **Met.** No such instruction; no account is ever closed. | `integration.rs::the_idl_has_no_withdraw_close_or_sweep_instruction`, `fee_pda_lamports_move_only_in_crank_buyback`; `governance.rs::program_token_accounts_cannot_be_moved_closed_or_reassigned`; TS `burnReceiptsClient` IDL test |
| 2 | Readings append-only, quorum-checked; no override/delete | **Met.** | `governance.rs::readings_are_append_only`, `integration.rs::readings_without_quorum…`, `…stale_future_invalid_conflicting…` |
| 3 | No pause that can trap funds | **Met by absence** — there is no pause. Guards (TWAP, closed pool) only defer a burn day. | IDL test (no pause instruction) |
| 4 | Rule immutable; attesters added only by the config authority under a 48 h timelock, never below quorum | **Met, slightly stronger:** proposals (add / rotate / remove) take 48 h, anyone applies after; the quorum can never be lowered (and never exceeds 3); the set can never be smaller than the quorum; a proposal keeps ≥ quorum current keys and adds fewer keys than the new quorum, so new keys alone never reach a quorum; the authority can renounce forever. | `integration.rs::attester_rotation_waits_48h…`, `governance.rs::quorum_never_lowered_and_set_never_below_quorum` |
| 5 | Upgrade authority: Squads multisig + timelock at launch, renounce after audit — exact commands | **Documented** (§5 below). Executed by the owner. | — |
| 6 | Reproducible build: `anchor verify` + expected hash | **Documented**; the canonical verifiable hash needs Docker, which this Mac lacks — see §5.4 for what is and isn't produced. | — |
| 7 | Machine-readable Powers Register from the IDL | **Met:** `scripts/powers-register.mjs` → `powers-register.json` + `.md`; fails if the IDL gains an undescribed instruction or signer. | TS `burnReceiptsClient` "Powers Register is up to date" |
| 8 | Events for every state change, indexer-rebuildable | **Met:** every state change emits via `emit_cpi!` (inner-instruction data, not truncatable logs): TokenInitialized (with admin, governance hash, cluster genesis), PoolRegistered, ReadingSubmitted, ReadingReset, ReadingProcessed, SpendCapBound, SpendCarried, BurnPoolCapBound, BuybackQueueUnblocked, PoolUntradeableFlagged (every observation), PoolUntradeableCleared, PoolReplaced, LaunchLabCreatorFeeClaimed, AttesterChangeProposed (with added/removed), AttesterChangeCancelled, AttesterChangeApplied and AdminRenounced (with the new governance hash), PlatformInitialized, CapRaiseProposed, CapRaiseCancelled, CapRaised, PlatformAuthorityRenounced. No pause ⇒ no pause event. Readings are also permanent accounts. | `governance.rs::every_state_change_emits_an_event`, `platform.rs` (cap events), `review2.rs` (F7/F11/F15 events) |

Owner decisions of the same evening:

| Decision | Status | Test(s) |
|---|---|---|
| Per-token burn-pool cap, default 25 SOL, a PlatformConfig-level parameter only the timelocked authority can raise; excess stays in the fee PDA; event when it binds; in the register with a sunset | **Met** (+ an automatic on-chain sunset ≤ 365 days, and raise-only). | `platform.rs::platform_config_only_by_the_upgrade_authority…`, `the_cap_binds_spend_on_min_pool_cap…`, `the_cap_only_rises_through_the_48h_timelock_and_sunsets_by_itself`; register `temporary_powers` |
| 48 h timelock for every privileged change | **Met:** attester changes and cap raises are both 48 h; there is no fee and no other privileged change. | as above |
| Squads 2-of-3 as the upgrade / config authority, exact setup commands | **Documented** in §5.2 (commands verified against the `squads-multisig-cli` 0.1.7 source). `initialize_token` takes an explicit `admin` (the Squads vault); `initialize_platform` takes the platform authority (the Squads vault). | — |
| No team allocation / no mint authority; init never mints or sends tokens to an operator | **Met:** the program has no mint path at all; `initialize_token` takes no token program or token account; through a vault cycle and a buyback the program's only token instructions are Burn and SyncNative. | `platform.rs::init_never_mints_or_moves_tokens_and_no_flow_ever_mints`, `buyback_token_calls_are_only_sync_native_and_burn_from_the_program` |

---

## 3. How the launchpad's create flow calls it

The launchpad builds ONE transaction (or two back-to-back) with:

1. `initialize_token` — signed by the payer, the creator and **the new mint keypair** (the mint need not exist yet; requiring its
   signature means only the launcher can create the config for that mint, and only once). This funds the fee PDA with the reserve.
2. LaunchLab's create, with the **fee PDA** (`feePda(programId, mint)`) as the creator-fee recipient.

Then, after graduation, anyone calls `register_pool` with the migrated CPMM pool, and the keeper runs `crankAll`.

**The fee path is pinned (review H-2): the fee PDA is the LaunchLab creator.** LaunchLab's `initializeV2` takes `creator` as a
non-signer (Raydium SDK 0.2.74-alpha `instrument.ts`), so the launchpad passes `feePda(programId, mint)` there. Then:

- *Bonding-curve phase:* LaunchLab accrues the creator fee in its vault `[fee PDA, WSOL]`, claimable only by the creator's
  signature. **`claim_launchlab_creator_fee`** (permissionless) CPIs LaunchLab `claim_creator_fee` with the fee PDA signing by seeds
  and the recipient pinned to the fee PDA's own WSOL ATA (which must already exist, so the fee PDA never pays rent). Afterwards the
  program re-checks that the fee PDA lost no lamports and its WSOL account lost no tokens. Accounts and discriminator are the SDK's
  `claimCreatorFee` byte for byte (`tests/launchlab.rs` vs `fixtures/launchlab-claim-sdk.json`, generated from the SDK by
  `scripts/launchlab-sdk-fixture.mjs`), and the LiteSVM suite runs it end to end against a test-only LaunchLab stand-in
  (`mocks/launchlab_mock` — LaunchLab's own source is not public, so it cannot be a fixture). Account names match the keeper's
  `burnPool.ts`: payer, config, fee_vault, fee_wsol, launchlab_creator_fee_vault, launchlab_vault_authority, wsol_mint,
  launchlab_program, token_program, associated_token_program, system_program (+ event_authority, program) — plus `fee_tokens`
  (review-2 F13: the fee PDA's token ATA, read-only and balance-checked; it is not passed to LaunchLab and need not exist).
- *After graduation:* a CPMM pool created through `initialize_with_permission` records `pool_creator = creator` (verified in
  raydium-cp-swap source); `collect_creator_fee_permissionless` pays that creator — the fee PDA — into its WSOL / token ATAs, and
  anyone can call it. But `creator` there is an unchecked account any holder of a Raydium permission PDA may set (review-2 F5), so
  **`register_pool` accepts only LaunchLab's own migration pool**: (1) the token's LaunchLab pool (`["pool", mint, WSOL]` under
  LaunchLab — only LaunchLab can create an account at its PDA) records the fee PDA as creator and CPMM as its migration target;
  (2) the CPMM pool is the deterministic PDA `["pool", cpConfigId, token0, token1]` of the AmmConfig that the token's LaunchLab
  platform names for migrations — **as PINNED at `initialize_token`** (review-3 M-3: the launchpad passes its LaunchLab PlatformConfig;
  the program records the platform, its `cpConfigId` and its LP lock/burn scales, and refuses a platform whose `platformCpCreator` is
  someone other than the fee PDA or whose lock + burn scales cover < 50 %, so a later `updateCpConfigId` cannot redirect or strand
  the registration); (3) its `pool_creator` is the fee PDA; (4) ≥ 50 % of its live LP is burned (`lp_supply − LP mint supply`) or held
  by Raydium's LP lock (`ATA(LOCK_CPMM_AUTH, lp_mint)`) — a FLOOR under the provenance proof (review-3 M-2, see "LP-ratio griefing"
  below). LaunchLab's migration splits the LP between the platform's and the creator's lock NFTs and a burn
  (`migrateCpLockNftScale {platformScale, creatorScale, burnScale}`), i.e. 100 %. The client's `registerPool` reads the LP mint from
  chain. **Still to confirm on devnet before mainnet (a launch gate):** that LaunchLab's migration passes the launch creator through
  as `pool_creator`, creates the pool at the cpConfigId PDA (not a random keypair) and locks/burns the LP as the SDK's platform config
  says — if any of these differ, `register_pool` refuses the real pool and the readings wait (the 30-day unblock does not apply to an
  unregistered pool) until the **stranding-recovery switch** below is used.
- *Fixed pool (`pool_policy = 1`, review-2 F14):* a creator-trust mode — the creator names the pool at init. It must still pass
  `register_pool` (fee-PDA `pool_creator`, ≥ 50 % LP burned/locked) before the first buyback (`pool_verified`); it can never be replaced.
- *Stranding recovery (review-3 M-3):* `set_registration_policy` (the token's admin, 48 h timelock, `apply_registration_policy` by
  anyone) switches the token to a fixed pool that passes the same creator + LP checks, or back to policy 0. It is available only while
  no pool works (none verified, or the registered one continuously untradeable ≥ 7 days) and only until the pre-audit cap's sunset; it is
  in the Powers Register as a temporary power. The rule itself stays immutable (`TokenConfig.registration_policy` is the policy in force).
  Re-check R3-2 narrows it further: the fallback pool must have **≥ 90 % of its live LP burned or locked**, or be **the CPMM pool PDA of a
  LaunchLab-known AmmConfig** (the cpConfigId pinned at init, or the pinned platform's current one — pass `launchlab_platform`), so a
  compromised admin and a Raydium permission holder cannot route buybacks into a pool on an arbitrary AmmConfig where the colluder holds
  the unlocked half; a proposal **expires 14 days** after it was made (`PolicyProposalExpired`; the event carries `expires_at`); and
  **any one current attester can veto** a pending proposal (`veto_registration_policy`, one signature, `RegistrationPolicyCancelled
  { vetoed: true }`) — the veto only forces a fresh public proposal, it never changes the policy.

**LP-ratio griefing (review-3 M-2).** CPMM deposits are permissionless, so any condition on the share of LP that is locked can be
diluted by a third party depositing before `register_pool`. Measured against the LIVE supply, the round-2 threshold (90 %) could be
blocked by a deposit of ~11 % of the pool's liquidity — held for as long as the block should last, while earning fees. The LP minted at
pool creation (which a later depositor cannot dilute) is not derivable on chain: CPMM's PoolState keeps only the live `lp_supply`, the
LP mint's supply moves with every deposit, and the LaunchLab pool records curve totals (`supply`, `totalSellA`, `realB`, fees), not the
amounts it migrated. So under policy 0 the provenance proof is the primary check and the LP condition is a floor of **50 % of the live
supply**: to block registration a griefer must deposit MORE than the entire migrated liquidity (≈ the 85 SOL + the migrated tokens of a
graduated $DEFICIT pool) and leave it in; a squatter on the pinned AmmConfig PDA must lock or burn at least half its own liquidity. The
block is temporary, costs the griefer the capital and the impermanent loss, and the stranding switch (48 h) routes around it.

**Hostile callees (review-3 M-1).** Two instructions lend the fee PDA's signature to external upgradeable programs: the LaunchLab
claim (signer + writable) and the CPMM swap (signer; the fee PDA's WSOL and token accounts writable). After each, the program requires
the fee PDA to still be System-owned with no data and the expected lamports, and each fee-PDA token account to keep its owner, mint, no
delegate and no close authority; the swap's output vault must pay exactly what the fee PDA received. Any violation reverts
(`FeeAccountTampered` / `SwapOutputMismatch`). Tested against a hostile stand-in (`mocks/evil_callee`) loaded at LaunchLab's and at
CPMM's program id.
- *Dead pool (review M-4, review-2 F6/F7):* `check_pool_health` (permissionless) records each observation of the registered pool
  being untradeable (swaps disabled, pool account gone, or < 0.01 SOL WSOL reserve) and clears the record whenever it is tradeable
  again (a successful buyback clears it too). A spell starts on the second of two observations ≥ 1 h apart (dated from the first —
  review-3 L-3) and is **continuous** only while observations are ≤ 24 h apart; a longer gap starts over. `check_pool_health` and
  `replace_pool` must be **top-level instructions** (stack height 1 — re-check R3-1: a wrapper program can no longer CPI `[swap, check]`
  inside one instruction) and refuse to share a transaction with any instruction touching the pool (a CPMM instruction, or one listing
  the pool, **either of its vaults or its observation account** — so a donation into the WSOL vault counts), so `sell → check → buy
  back` and `donate → check` cannot forge or clear an observation. **Bundle residual (accepted):** a Jito bundle of separate
  transactions (move the reserve / observe / move it back) is atomic for the bundler but invisible to the instructions sysvar. It costs a
  bundle tip plus both legs; forging a spell still needs two observations ≥ 1 h apart; and the only reach is `replace_pool`'s 7-day
  clock (the 30-day queue unblock relies on the crank's own blocked test, which runs inside the crank). When the pool account itself is gone, the client builds
  the health check and the crank from the config alone (review-3 L-5). After 7 continuous days, `replace_pool` (permissionless) moves to a different, tradeable pool that passes every
  `register_pool` check (for the platform's current cpConfigId); after 30, cranks process readings below-floor with the target
  carried. The keeper's `crankNext` records an observation on every untradeable deferral. Events: `PoolUntradeableFlagged`
  (`since`, `observed_at`, `restarted`), `PoolUntradeableCleared`, `PoolReplaced`, `BuybackQueueUnblocked`.

Launch-day order (confirmed with the keeper): deploy → `initialize_token` (mint keypair signs; the mint need not exist yet — tested) →
rules sha published → **`verify-platform-pins --mint` (launch gate, §5)** → LaunchLab create with creator = fee PDA (seeds exactly
`["fee", mint]`) → keeper runs `claim_launchlab_creator_fee` + cranks → `register_pool` after graduation.

---

## 4. The keeper's side (`src/lib/burnReceipts/crank.ts`)

```ts
import { submitAttestedReading, crankAll, registerPool } from "@/lib/burnReceipts";
const ctx = { connection, programId, mint, cluster: "devnet" as const };        // mainnet refused unless allowMainnet (genesis-checked)
await submitAttestedReading(ctx, { payer, recordDate: 20261008, value: 4030531621082972n, sourceUrl: treasuryQueryUrl, attesters: [{ publicKey, secretKey }] });
const results = await crankAll(ctx, cranker);   // processed | deferred (TWAP / pool closed: retry later) | waiting-for-pool | idle
```

Every send is simulated first; confirmation polls (no websocket). The data key only signs readings; the cranker only pays fees.

Client behaviour the keeper relies on (review 2):

- **Signed message v3** binds the TokenConfig's `cluster_genesis`; `submitAttestedReading` refuses to sign when it differs from the
  RPC's genesis (devnet/mainnet). `attestationMessage(genesisHash, programId, mint, …)` and `attestReading({ genesisHash, … })` take it
  explicitly.
- **Shared-message ed25519 instruction** (`ed25519SharedMessageInstruction(message, signatures)`; `attestReading` and
  `ed25519VerifyInstruction` use it): quorum 1–3 fit a legacy transaction (966 / 1,076 / 1,186 B).
- **Sized transactions:** `buildSizedTransaction` sends legacy when it fits 1,232 B, otherwise v0 through `ctx.lookupTable`
  (`createReadingLookupTable(ctx, payer)` creates one with the config, instructions sysvar, System program and event authority),
  otherwise throws.
- **Buyback cranks** prepend `SyncNative(fee WSOL)`; `WsolBalanceMismatch` is deferrable; `PoolNotTradable` / `EmptyReserves`
  deferrals also send `check_pool_health` (result field `healthCheck`).
- **Memo** comes from the burn program's own Memo CPI (`memoFromTransaction`), not from log text.
- `registerPoolIx` takes `lpMint`, `cluster` and (policy 0) `launchlabPlatform`; `replacePoolIx` takes `newLpMint`,
  `launchlabPlatform`, `cluster`; `claimLaunchlabCreatorFeeIx` adds `fee_tokens`.

**The keepers' integration (2026-10-10):** both keepers drive this program through a thin adapter (`src/lib/burnKeeper/programAdapter.ts`
over this client) — the $DEFICIT keeper with `BURNKEEPER_EXECUTION=program`, the Burnticker keeper with its unit-counter TokenConfigs.
The exact per-day sequence, what the keeper signs and what is left for devnet: `docs/burnkeeper/README-execution.md`.

---

## 5. Deployment runbook (owner)

All commands assume the Solana CLI (Agave 4.3), Anchor 1.2.1 and this repo at the commit to deploy. **Devnet first; mainnet only
after the reviews** (LAUNCHPAD-PATH §19: AI reviews + public bounty, no paid audit).

**Which binary to deploy.** The launch gate (§5.3) compares the deployed program with the **verifiable** hash (§5.4), and the plain
`anchor build` output (`target/deploy/burn_receipts.so`) does not reproduce that hash. So whenever Docker is available, build with
`anchor build --verifiable` and deploy `target/verifiable/burn_receipts.so`. Docker is **required** for the hash: the dev Mac has none,
so the verifiable build runs on the Linux VPS (owner's plan, 2026-10-10) and the `.so` plus its `solana-verify get-executable-hash`
output are copied back for the deploy. A devnet rehearsal may deploy the plain build (its hash is never a launch gate); **mainnet
must deploy the verifiable build**.

**Launch gate: platform pins (re-check R3-3).** `initialize_token` pins the LaunchLab platform, its `cpConfigId` and its LP lock/burn
scales, and refuses a `platformCpCreator` other than unset / the fee PDA. But the platform's admin is an untimelocked key that cannot be
moved under Squads (D-3, §7), and it can change `platformCpCreator` or the scales AFTER `initialize_token` and BEFORE migration — a
change that strands the token beyond either registration policy (both require a fee-PDA creator and the LP floor). So, **immediately
before LaunchLab's create** (same session, no pause in between), re-read the platform and refuse on any difference:

```bash
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/alias-hook.mjs scripts/burnreceipts-admin.mts \
  verify-platform-pins --cluster mainnet --program <PROGRAM_ID> --mint <MINT>
# exit 0 + "platform pins hold" → run LaunchLab's create now; exit 1 → do NOT create (the JSON lists each mismatch:
# platformCpCreator not default/fee PDA, lock+burn scales ≠ the pinned sum, cpConfigId ≠ the pinned one, platform missing / not LaunchLab's)
```

It is read-only (no payer, no transaction). The window between this check and the create is the residual; launching on a platform whose
admin key the launcher controls (or one created by a Squads vault transaction) closes it. The devnet rehearsal runs the same check.

### 5.1 Devnet

```bash
cd programs/burn-receipts
solana config set --url devnet
solana-keygen new -o ~/burn-receipts-deployer.json            # the owner's deployer key (fund it from the devnet faucet)
solana-keygen new -o target/deploy/burn_receipts-keypair.json --force   # the REAL program id (replaces the localnet test key)
anchor keys sync                                              # writes the new id into declare_id! and Anchor.toml
anchor build -- --features devnet                             # Raydium devnet CPMM program id (plain build: fine for devnet)
node scripts/sync-idl.mjs && node scripts/powers-register.mjs # refresh the TS client's IDL and the register; commit them
solana program deploy target/deploy/burn_receipts.so \
  --program-id target/deploy/burn_receipts-keypair.json \
  --upgrade-authority ~/burn-receipts-deployer.json --keypair ~/burn-receipts-deployer.json
solana program show <PROGRAM_ID>
# MAINNET (same program id, default features): build verifiably on a Docker host, then deploy THAT file
anchor build --verifiable && solana-verify get-executable-hash target/verifiable/burn_receipts.so   # record the hash (§5.4)
solana program deploy target/verifiable/burn_receipts.so --url mainnet-beta \
  --program-id target/deploy/burn_receipts-keypair.json \
  --upgrade-authority ~/burn-receipts-deployer.json --keypair ~/burn-receipts-deployer.json
solana-verify get-program-hash -u mainnet-beta <PROGRAM_ID>   # must equal the recorded hash
```

Dry run on devnet: create a test mint, `initialize_token` with the keeper's devnet data key as the only attester, submit replayed
historical Treasury readings with `submitAttestedReading`, and crank (vault mode works on devnet as-is; buyback needs a devnet CPMM
pool whose creator is the fee PDA — Raydium's devnet LaunchLab migration, or `pool_policy = 1` with a pool you create).

### 5.2 Squads 2-of-3 with a 48 h time lock — the upgrade, platform and config authority

Commands below are from the `squads-multisig-cli` 0.1.7 source (crates.io; `src/command/*.rs`). Three members, each on their own
machine / hardware wallet (`--keypair usb://ledger` works); add `--rpc-url https://api.devnet.solana.com` on devnet.

```bash
cargo install squads-multisig-cli --version 0.1.7 --locked
# 1. Create the multisig: 3 members with all permissions (7 = initiate + vote + execute), threshold 2.
#    The CLI creates it with time_lock = 0 and no config authority (changes go through member proposals).
squads-multisig-cli multisig-create --keypair ~/member-a.json \
  --members "<MEMBER_A_PUBKEY>,7" "<MEMBER_B_PUBKEY>,7" "<MEMBER_C_PUBKEY>,7" --threshold 2
#    → "✅ Created Multisig: <MULTISIG>"
# 2. Set the 48 h time lock (a config proposal, transaction index 1): propose, two approvals, execute.
squads-multisig-cli config-transaction-create --keypair ~/member-a.json --multisig-pubkey <MULTISIG> --action "SetTimeLock 172800"
squads-multisig-cli proposal-vote --keypair ~/member-a.json --multisig-pubkey <MULTISIG> --transaction-index 1 --action approve
squads-multisig-cli proposal-vote --keypair ~/member-b.json --multisig-pubkey <MULTISIG> --transaction-index 1 --action approve
squads-multisig-cli config-transaction-execute --keypair ~/member-a.json --multisig-pubkey <MULTISIG> --transaction-index 1
# 3. The vault PDA (index 0) is the authority address used everywhere below.
squads-multisig-cli display-vault --multisig-address <MULTISIG> --vault-index 0
```

That vault address becomes: the program's **upgrade authority** (next step), the **platform authority** (`initialize_platform`'s
`authority` argument) and each token's **config authority** (`initialize_token`'s `admin` argument). Every action it takes is a Squads
proposal that needs 2 of 3 approvals and waits 48 h; the program's own 48 h timelocks (attester changes, cap raises) come on top.

Platform config (optional since review M-1 — without one the default 25 SOL cap applies until 2027-10-01; create it to pick an
earlier sunset or to be able to raise the cap; once, signed by the deployer while it is still the upgrade authority):
`initializePlatformIx({ programId, payer, upgradeAuthority: deployer, authority: <SQUADS_VAULT_PDA>, burnPoolCapLamports:
25_000_000_000n, capSunsetTs: <unix time ≤ 365 days out> })`.

Transfer the upgrade authority to the vault:

1. (see the commands above for the multisig)
2. Transfer the authority (the new authority is a PDA and cannot sign, hence the skip flag):
   ```bash
   solana program set-upgrade-authority <PROGRAM_ID> \
     --new-upgrade-authority <SQUADS_VAULT_PDA> --skip-new-upgrade-authority-signer-check \
     --upgrade-authority ~/burn-receipts-deployer.json
   solana program show <PROGRAM_ID>        # "Authority: <SQUADS_VAULT_PDA>"
   ```
3. Upgrades from then on: `solana program write-buffer target/deploy/burn_receipts.so`, `solana program set-buffer-authority
   <BUFFER> --new-buffer-authority <SQUADS_VAULT_PDA>`, then
   `squads-multisig-cli initiate-program-upgrade --keypair ~/member-a.json --multisig-pubkey <MULTISIG> --vault-index 0
   --program-to-upgrade-id <PROGRAM_ID> --buffer-address <BUFFER> --spill-address <MEMBER_A_PUBKEY>`, two approvals
   (`proposal-vote … --action approve`), and `vault-transaction-execute` once the 48 h time lock has passed.

### 5.3 Renounce (freeze) after the audit

**Launch gate (review-2 F16):** until this section has run, the upgrade authority can replace the code and every "no extraction"
property is void. The mainnet launch is announced only after `solana program show <PROGRAM_ID>` prints `Authority: none` and the
deployed hash equals the published verifiable hash (§5.4); the status page states the authority and the hash it checked.

**Pre-finalisation assertions (review M-1 / I-5)** — run all of these first; finalising is irreversible:

```bash
solana program show <PROGRAM_ID>                         # the authority is the Squads vault; note the slot
solana account <PLATFORM_PDA>                            # PlatformConfig exists with the intended cap/sunset — or accept the default
# crank one real reading on this cluster first: proves the compiled CPMM / LaunchLab program ids match the cluster (devnet build ≠ mainnet)
solana-verify get-program-hash <PROGRAM_ID>              # equals the recorded verifiable hash (§5.4)
```


Make the program immutable with the loader's SetAuthority instruction (BPF Upgradeable Loader instruction 4) with **no** new
authority, executed as a Squads vault transaction (the vault PDA is the current authority, so the plain CLI `--final` cannot sign
for it). The instruction, built with web3.js:

```ts
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
const LOADER = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const programData = PublicKey.findProgramAddressSync([PROGRAM_ID.toBuffer()], LOADER)[0];
const finalize = new TransactionInstruction({
  programId: LOADER,
  keys: [{ pubkey: programData, isSigner: false, isWritable: true }, { pubkey: SQUADS_VAULT_PDA, isSigner: true, isWritable: false }],
  data: Buffer.from([4, 0, 0, 0]),   // UpgradeableLoaderInstruction::SetAuthority, no new-authority account ⇒ immutable
});
```

Propose it as a Squads vault transaction (the Squads app's transaction builder, or `squads-multisig-cli vault-transaction-create
--multisig-pubkey <MULTISIG> --vault-index 0 --transaction-message <serialized message>`), approve 2 of 3, wait out the time lock,
execute; then
`solana program show <PROGRAM_ID>` must print `Authority: none`. (While the deployer still holds the authority, the equivalent is
`solana program set-upgrade-authority <PROGRAM_ID> --final --upgrade-authority ~/burn-receipts-deployer.json`.)

### 5.4 Reproducible build and the expected hash

```bash
# verifiable (Docker) build — the hash every verifier should get for a given commit and program id
anchor build --verifiable                          # or: solana-verify build --library-name burn_receipts
solana-verify get-executable-hash target/verifiable/burn_receipts.so
# compare with what is deployed
solana-verify get-program-hash -u devnet <PROGRAM_ID>
anchor verify -p burn_receipts <PROGRAM_ID> --provider.cluster devnet
# public attestation of the source (OtterSec verify registry), after pushing the commit:
solana-verify verify-from-repo -u devnet --program-id <PROGRAM_ID> <GIT_URL> --commit-hash <SHA> \
  --library-name burn_receipts --mount-path programs/burn-receipts
```

**Expected hash — what exists and what does not.** This Mac has no Docker, so the canonical *verifiable* hash was not produced. The
hash also depends on the program id compiled in by `declare_id!`, so it can only be fixed after `anchor keys sync` with the real key.
For the record, the non-verifiable local build of this commit (localnet id `GV9CMj…SuF8`, Agave 4.4 `cargo-build-sbf`, platform tools
v1.57, SBPF v3) has `sha256(target/deploy/burn_receipts.so) = 348b367e7c95d547ccde51bcafc587b75d22bb37c65130070882b92f6cab90b8`
(680,920 bytes) — useful to confirm a rebuild on the same toolchain, **not** a verification target. The owner records the verifiable
hash here after 5.1 + the verifiable build, before announcing.

---

## 6. Audit checklist (what an auditor should look at)

1. **No outflow except burn** — grep every `invoke`, `invoke_signed`, `transfer`, lamport mutation: the fee PDA signs only in
   `crank_buyback` (system transfer to its own WSOL ATA; CPMM swap with its own ATAs; token burn). Config PDA signs only `token::burn`.
2. **CPMM CPI** (`src/cpmm.rs`, `crank_buyback.rs`): program id hard-coded; pool = registered address; vaults, amm_config and
   observation checked against the pool; mints = {WSOL, mint}; SPL Token only; byte offsets vs raydium-cp-swap@b3187ae5; WSOL
   accounting re-checked after the swap; `got ≥ min_out`.
3. **Pool registration** (`register_pool.rs::verify_pool_provenance`): LaunchLab pool PDA + owner, platform key = pool's platformId,
   CPMM pool = PDA of the PINNED cpConfigId, fee-PDA `pool_creator`, LP burned/locked ≥ 50 % of the live supply (lock account address,
   mint and owner checked); `initialize_token::pin_launchlab_platform`. LaunchLab layout offsets vs the SDK
   (`fixtures/launchlab-accounts-sdk.json`); who holds Raydium Permission PDAs; the LaunchLab platform admin (untransferable, register
   "Powers outside the program").
4. **TWAP guard and min-out** (`cpmm::twap_sol_price_x32`, `cpmm::effective_obs_time`, `math::buyback_min_out`): ring indexing,
   wrapping cumulative sums, the bucket bound `t_eff = min(t + 14, t_next − 1)`, the extension to now at the current price,
   behaviour with no history (`TwapUnavailable` defers), the max(spot, TWAP) quote.
5. **ed25519 introspection** (`attest.rs`): offsets must reference the Ed25519 instruction itself; duplicate signers counted once;
   message is the exact canonical string.
6. **Signed message** (`attest::canonical_message`): `BURNRECEIPTS-v3|genesis|program|mint|feed|prev=…|date|value|src|proof` — every
   field a verifier relies on is inside it, including the cluster genesis (no cross-cluster replay), the program id and mint (no
   cross-token replay) and the previous reading's date (no reordering); kind tags are informational and never change verification.
6a. **LaunchLab CPI** (`claim_launchlab.rs`) and **CPMM CPI** (`crank_buyback.rs`): the post-CPI integrity checks (`guards.rs`) — fee PDA
   owner/data/lamports, fee-PDA token accounts' owner/mint/delegate/close authority, the swap's vault delta.
6b. **Pool replacement / dead pool** (`pool_health.rs`, `crank_buyback.rs`): the untradeable definition, the 24 h continuity rule, the
   clearing paths, the 7-day replacement and the 30-day queue unblock.
7. **Math** (`math.rs`): overflow (u128, checked), rounding direction (spend ≤ pool), carry invariant `carry < unit`, i64 delta bound.
8. **Ordering & idempotency**: `prev_date == crank_cursor`, `processed` flag, `init_if_needed` reading path cannot re-initialise.
9. **Timelock / governance**: quorum floor, re-check at apply, renounce clears pending, no other admin path.
10. **Rent**: fee PDA reserve ≥ rent-exempt minimum; nothing ever closed.
11. **Upgrade authority** at the time of review (`solana program show`), and the verifiable-build hash.
12. **Compute and size**: `crank_buyback` ≈ 110k CU typical, 137,009 CU worst case (full oracle ring, 9.2e18 units, 1,200 s window,
   PlatformConfig present), incl. the CPMM swap, the post-CPI checks and its event CPIs (LiteSVM); the TS client requests 400k. Every LiteSVM transaction is
   asserted ≤ 1,232 bytes; the client's buyback crank is 907 B, a quorum-3 reading 1,186 B.

---

## 7. Toolchain, and how to run everything

Installed on the dev Mac for this build (user-local, no sudo): rustup + Rust 1.99.0 (`~/.cargo`), Agave/Solana CLI 4.3.0 with
`cargo-build-sbf` 4.4 / platform tools v1.57 (`~/.local/share/solana`, needed Homebrew `libusb`), `anchor-cli` 1.2.1
(`cargo install anchor-cli --version 1.2.1 --locked`). No Docker.

```bash
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"
cd programs/burn-receipts
anchor build                          # program + IDL
anchor test                           # scripts/test.sh: builds any missing fixture (raydium-cp-swap@b3187ae5 from source, the
                                      # LaunchLab stand-in, the hostile callee), the --features localnet build for the local
                                      # validator (target/deploy-localnet), then cargo test: unit + LiteSVM suites (integration,
                                      # governance, platform, launchlab, review_fixes, review2, review3,
                                      # recheck3); also the multicall wrapper mock (mocks/multicall)
node scripts/sync-idl.mjs && node scripts/powers-register.mjs
cd ../.. && npm test                  # includes test/burnReceipts{Math,Memo,Client}.test.ts
BURN_RECEIPTS_LOCALNET=1 node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/alias-hook.mjs \
  --test --test-timeout=300000 test/burnReceiptsLocalnet.test.ts   # starts solana-test-validator on 127.0.0.1 (localnet build);
                                      # needs target/deploy-localnet from `anchor test` first (the skip message says so)
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/alias-hook.mjs scripts/burnreceipts-admin.mts   # admin CLI help
```

**Builds and clusters (review-3 I-1).** The default build binds mainnet's genesis in every signed message, `--features devnet`
devnet's, and `--features localnet` its own tag (sha256 of `BURNRECEIPTS-LOCALNET-GENESIS`). The client refuses to sign a message bound
to mainnet's genesis unless the context is mainnet, so a localnet rehearsal of the default build can never produce mainnet-valid
signatures; local-validator runs use the localnet build.

**Admin CLI.** `scripts/burnreceipts-admin.mts` covers `initialize-token` (prints the rules sha it pins), `register-pool`,
`claim-launchlab-creator-fee`, `check-pool-health`, `initialize-platform`, `set-/cancel-/apply-registration-policy`,
`veto-registration-policy` (any current attester) and the read-only launch gate `verify-platform-pins` (§5): dry run by default
(decoded instruction, simulation, the resulting accounts decoded), `--send` only with key files (keyfile.ts), and on mainnet only with
`--i-understand-this-spends-real-sol`. The RPC is printed as scheme + host only (re-check R3-5), so a provider key in a custom `--rpc`
URL never reaches the terminal or logs. The run-sheets (docs/burnticker/runbook.md, docs/burnkeeper/devnet-run.md) call it.

**LaunchLab platform admin (D-3).** Checked in the Raydium SDK 0.2.74-alpha: `updatePlatformConfig` has no admin-change variant and the
PlatformConfig account is the PDA `["platform_config", admin]` — the admin cannot be transferred to a Squads vault after creation. It
stays an untimelocked key (Powers Register, "Powers outside the program"); `initialize_token` pins what matters from it, and the
stranding switch covers a change between a token's init and its migration. (A platform created by a Squads vault transaction would have
the vault as admin from the start — a different platform id.)

**Program-id warning on a fresh checkout (review-2 F17d).** `target/` is gitignored, so the first `anchor build` in a new checkout
generates a random `target/deploy/burn_receipts-keypair.json` and warns that it does not match `declare_id!` (`GV9CMj…SuF8`, the
localnet test id). That is expected and harmless for the tests (LiteSVM and the local validator load the `.so` at the `declare_id!`
address). Do not "fix" it by syncing to the random key; before a real deployment the owner creates the real key and runs
`anchor keys sync` (§5.1), which updates `declare_id!`, `Anchor.toml` and — after `node scripts/sync-idl.mjs` — the TS client.

---

## 8. Known limitations and next steps

- LaunchLab: `claim_launchlab_creator_fee` is pinned to the SDK's builder and tested against a stand-in, not the real LaunchLab
  program; confirm on devnet (launch → curve trades → claim → graduation → `register_pool`) before mainnet.
- Vault mode with a LaunchLab *vesting* allocation: the beneficiary must sign `claim_vested_token`, so a program-owned vault needs a
  claim wrapper (same CPI pattern as above). Anyone can deposit into the vault today.
- In vault mode the fee PDA has no spend path at all — do **not** route creator fees to a vault-mode token's fee PDA (they would be
  locked forever, which is a burn of SOL, not of the token).
- A missed Treasury date cannot be inserted later (dates are strictly increasing, and each signature names the previous reading's
  date); the next reading's delta absorbs it.
- `Reading.signers_mask` is a slot mask: after an attester rotation the same bit means a different key — indexers join it with the
  `AttesterChangeApplied` history (review I-6).
- Until §5.3 runs, the upgrade authority (the Squads vault) can change everything; the cap protects against bugs, not the operator
  (review I-5). Full list of review findings and how each was closed: `CHANGELOG.md`.
- zkTLS: the program stores and signs `proof_hash` but does not verify proofs; choosing a zkTLS provider and publishing a verifier
  script for the status page is open (attestation.md).
- A Switchboard On-Demand attester was built and then removed on 2026-10-09 after the coordinator reported that Switchboard ended
  its oracle services on 2026-09-25 — the code (PullFeed reader checked against Switchboard's own struct, tests) is in commit
  f94089c5 if it is ever wanted again.
- The Squads CLI commands are taken from its 0.1.7 source; `vault-transaction-create` wants a serialized transaction message, so
  the finalize step is easier in the Squads app's transaction builder.
- The platform cap is enforced only in `crank_buyback` (vault mode burns tokens, not SOL, and is not capped).
- Review 3 informational items: **I-3** the minimum TWAP/slippage tolerances (150,000 bps·s) clear the worst-case bucket margin by only
  ~17 bps at 600 s and ~7 bps at 1,200 s — a liveness edge, not a safety one (use 300/300 at 1,200 s); **I-4** `replace_pool` can only
  reach a pool on a different AmmConfig, i.e. after the LaunchLab platform admin changes cpConfigId — that admin picks the replacement's
  fee tier; **I-5** the claim event reports the WSOL gained only — if the real LaunchLab pays native SOL, `claimed_lamports` reads 0
  while the fee PDA's lamports grow; **I-6** tokens donated to the fee PDA's token account are burned and counted in the memo's `burn=`
  (so `burn ≥ got`; `burn` is not "bought").
- Pool provenance (review-2 F5) rests on LaunchLab behaving as its SDK describes (migration pool at the cpConfigId PDA, LP locked /
  burned per the platform's scales, launch creator passed through as `pool_creator`) — closed source, to be confirmed on devnet — and
  on the set of Raydium Permission-PDA holders (trust assumption: Raydium's admin grants them).
- In a quiet pool the conservative oracle read costs up to 14/window of the deviation and slippage budgets (review-2 F1); a 1,200 s
  window halves that cost. A rising token price defers burns until the TWAP catches up.
- Quorum is capped at 3 (review-2 F4). A larger committee would need a new program version (or on-chain aggregation of signatures).
- Pool-health observations (re-check R3-1) are isolated within their transaction (top-level only; no other instruction may touch the
  pool, its vaults or its observation account) but not across a Jito bundle of separate transactions — accepted: clearing a spell that
  way costs a tip and both legs, forging one still needs two observations ≥ 1 h apart, and the reach is `replace_pool`'s 7-day clock.
  Judging reserves on oracle data instead would remove it at the cost of another dependency.
- Cranker allowlist (review-3 L-4, re-check R3-4): applies only while the cap is in force AND for at most 90 days after
  `initialize_platform`; the platform authority or any listed key can clear it. After that, the multi-block TWAP-hold timing (L-4) is
  open to any cranker again — the one-window hold cost (L-1) is the remaining protection.
