# burn_receipts — blind security review 3 (2026-10-10)

Reviewer: Claude (independent, no prior exposure; the two earlier reports and `docs/burn-receipts/CHANGELOG.md` were NOT read until
the findings below were written — the comparison is the last section).
Target: `programs/burn-receipts/` (Anchor 1.2.1, commit `7eaee66` on `fix/price-integrity-and-engine-correctness`, working tree
clean), the TS client `src/lib/burnReceipts/`, and the keeper adapter `src/lib/burnKeeper/programAdapter.ts`.
Mode: read-only. Every artefact (clean checkout, proof-of-concept tests, a malicious LaunchLab stand-in) lives in the session
scratchpad; nothing in the repository was edited, committed or deployed.

## Severity-ranked findings

| # | Sev | Where | Exploit / failure scenario | Fix |
|---|-----|-------|----------------------------|-----|
| M-1 | Medium | `instructions/claim_launchlab.rs:108-128`; same class `crank_buyback.rs:223-252` | The fee PDA is passed to LaunchLab as **signer + writable**. The post-checks compare balances only (fee PDA lamports, WSOL amount, token amount). A malicious or compromised LaunchLab (upgradeable by Raydium) can, inside the permissionless claim, `system::assign` the fee PDA to itself and `SetAuthority(AccountOwner)` (or `Approve`) the fee WSOL ATA — balances are unchanged, every check passes, and it then debits the whole fee pool. **PoC B (scratch test) passes**: claim succeeds, fee PDA owner becomes the LaunchLab id, fee WSOL owner becomes a thief key, 40.02 SOL drained in the next instruction. The CPMM CPI in the crank carries the same signer (read-only, so no `assign`) with `fee_wsol` / `fee_tokens` writable, so CPMM could re-authorise those two accounts. The module doc's invariant "the CPI can only ADD to the burn pool" does not hold against the callee. | After each CPI: `fee_vault.owner == system_program::ID && fee_vault.data_is_empty()`; reload `fee_wsol` (and `fee_tokens` in the crank) and require `owner == fee PDA`, `delegate.is_none()`, `close_authority.is_none()`. Cheap, turns theft into a revert. |
| M-2 | Medium | `instructions/register_pool.rs:73-83`, `cpmm.rs:324-331`, `constants.rs:154-158` | The ≥ 90 % burned-or-locked test is a ratio against CPMM's **live** `lp_supply`. CPMM `deposit` is permissionless, so anyone who adds ≥ 11.2 % of the pool's liquidity before `register_pool` makes it fail with `LpNotLocked` for as long as they stay an LP — while earning trading fees. Registration is once-only and there is no other path to a verified pool under policy 0; the same deposit blocks `replace_pool` candidates and policy-1 verification. **PoC A passes**: a 12.5 %-of-supply deposit into a 100 %-locked migrated pool (≈ 10.6 SOL + 100 M tokens) → `register_pool` refused. Fee SOL keeps accruing in a PDA with no withdraw. | Measure against something a later depositor cannot dilute: e.g. the LP that existed at migration (derived from LaunchLab's recorded migration amounts), or only require that non-locked/unburned LP held by the *pool creator side* is small; or, under policy 0 where provenance is already proven by the PDA + LaunchLab record, drop the ratio or lower it to "most of the initial LP is locked". |
| M-3 | Medium (unverifiable dependency, permanent-lock impact) | `register_pool.rs:85-93`, `cpmm.rs:333-370`, `constants.rs:89-96,160-175` | Policy-0 registration assumes LaunchLab behaviour that the program neither pins nor can observe, and that a LaunchLab **platform admin can change before migration**: (a) the SDK's `PlatformConfig` has `platformCpCreator` (`updatePlatformCpCreator`) — if it sets the migrated pool's `pool_creator`, the check `pool_creator == fee PDA` can never pass; (b) `updateCpConfigId` — `register_pool` compares the pool's AmmConfig with the platform's **current** `cpConfigId`, not the one used at migration; (c) `migrateCpLockNftScale` — a platform whose lock+burn share is < 90 % yields `LpNotLocked` forever; (d) raydium-cp-swap accepts a **random-keypair** pool account in `initialize_with_permission` ("Or random account: must be signed by cli"), and nothing public shows LaunchLab migrates to the PDA. Any one of these strands the fee pool for good: `pool_policy` is fixed at init, there is no withdraw, and `replace_pool` requires an already-registered pool. | Pin the platform at `initialize_token` (record `platform_id`, `cpConfigId`; require `platformCpCreator ∈ {default, fee PDA}` and lock+burn scales ≥ 90 %); compare against the recorded `cpConfigId`; add a timelocked, event-logged fallback (e.g. admin may designate a pool that passes the creator + LP checks after N days with no policy-0 registration); rehearse a real LaunchLab migration on devnet and assert the pool address/creator before mainnet. |
| L-1 | Low | `cpmm.rs:219-238` | The TWAP start is "the newest OLDER observation"; the newest observation is never a start even when it is older than the window. After a crank in a quiet pool the crank's own swap is the newest observation, so every later TWAP keeps the pre-crank price weighted by the whole preceding quiet gap until someone else trades. **PoC C**: second crank first succeeds after 1,200 s (quiet gap 600 s), 7,200 s (6 h gap), 27,000 s (24 h gap) — not after the 600 s window. Liveness/throughput only (carry absorbs it); safe direction. | If `last_update ≤ now − window` (no swap inside the window) return the current spot (the newest cumulative is exact at `last_update`, and a same-tx push would move `last_update` to now), or allow the newest entry as a start with time `last_update`. |
| L-2 | Low | `instructions/admin.rs:38-47` | "Keep ≥ quorum current keys, add < new-quorum new keys" bounds ONE proposal only. q = 2, set {A,B,C}: propose {A,B,C,X} (kept 3, new 1) → apply after 48 h → propose {A,X,Y} (kept A,X; new Y) → after 96 h the admin's X,Y alone are a quorum. Current attesters never consent to anything. Separately, at quorum 1 no key can ever be added without raising the quorum (new < 1 ⇒ 0), and the quorum never falls, so recovering from a lost/compromised key ratchets a q1 token to q3 permanently. | Require a co-signature of the current quorum on proposals (ed25519 introspection already exists), or count a key as "kept" only after it has been in the set ≥ 30 days, or rate-limit added keys per rolling window. Document the 96 h bound. |
| L-3 | Low | `instructions/pool_health.rs:35-53, 96-110`, `constants.rs:47` | Untradeable-by-reserve uses the instantaneous vault balance. In a thin pool, `sell → check_pool_health → buy back` in one tx (cost ≈ fees) records an "untradeable" observation on a tradeable pool; the inverse `buy → check → sell` clears a genuine spell, resetting the 7-day replacement clock at will. The 30-day queue unblock is **not** forceable on a tradeable pool (the crank's own blocked test needs status-disabled / gone / reserve ≤ owed fees). | Refuse `check_pool_health` / `replace_pool` when the transaction contains another instruction touching the pool (instructions sysvar), or judge reserves on the oracle's TWAP price, or require observations in distinct slots spread over the day. |
| L-4 | Low (design) | `crank_buyback.rs:177-203`, `constants.rs:23-35` | The TWAP blocks same-transaction pushes (the extension to "now" is sound: a front-run swap moves `last_update` to now). It does not stop a **multi-block** hold: in a memecoin pool with no external arbitrage, a manipulator who keeps the price pumped for one window (600–1,200 s) and then cranks (cranking is permissionless, so they pick the moment) sandwiches the buyback at any price; bounded by ≤ 2 % of the WSOL reserve per crank. | Keeper-only cranking while the pre-audit cap is in force, or a per-crank limit on executed price vs an EMA of earlier cranks, or a longer own-checkpoint TWAP. |
| L-5 | Low (client) | `src/lib/burnReceipts/crank.ts:268, 358-365`; `cpmm.ts:88-93` | `fetchCpmmPool` throws when the pool account is missing or not CPMM-owned, so `planCrank` and `checkPoolHealth` throw: the keeper never produces a blocked crank or an "account gone" observation, so the 24 h-continuity spell and the 7-/30-day paths never start for that cause (the program supports it: `untradeable_reason` returns POOL_ACCOUNT before reading the vault). | Build the crank / health instructions from the config alone when the pool is unreadable (any vault account is accepted on that path). |
| L-6 | Low (client) | `crank.ts:89-102`; `programAdapter.ts:161-169` | `memoFromTransaction` returns the FIRST Memo CPI under any burn-program instruction. Cranks are permissionless; a third party can process readings N and N+1 in one transaction, and `findCrankTx(N+1)` then records reading N's memo. Ledger/status integrity only. | Return the memo of the instruction whose `reading` account is the target, or parse the memo and match its date. |
| I-1 | Info | `programAdapter.ts:121-122`, `crank.ts:209-210` | On `localnet` the adapter signs with the config's genesis, which in the default build is MAINNET's. A localnet rehearsal that reuses the real program id, mint keypair (e.g. a ground vanity mint) and data key produces signatures valid on mainnet. | Add a `localnet` build feature with its own genesis/domain, or refuse to sign mainnet-genesis messages unless `cluster === "mainnet"`. |
| I-2 | Info | `instructions/platform.rs:45` | The default cap (25 SOL) is already in force without a PlatformConfig; `initialize_platform` may set 1–25 SOL, i.e. lower the cap once (to 1/25th) until 2027-10-01. The module doc says the cap is "never lowered". The upgrade authority can upgrade the program anyway. | Require `cap == DEFAULT` at init (raise-only afterwards) or document the one-time lowering. |
| I-3 | Info | `constants.rs:28-32`, `initialize_token.rs:76-80` | The minimum tolerances clear the worst-case bucket bias (14/(W−14)) by only ≈ 17 bps at 600 s and ≈ 7 bps at 1,200 s; any genuine drift then defers cranks. Not a safety issue (bias is HIGH only). | Use ≥ 2× the bias as the floor, or document that the minimum is a liveness edge. |
| I-4 | Info | `pool_health.rs:142-178`, `register_pool.rs:92` | `replace_pool` can only accept a pool on a DIFFERENT AmmConfig (the PDA for the current `cpConfigId` + mints is the registered pool itself), so it is reachable only after the LaunchLab platform admin changes `cpConfigId` — that admin chooses the replacement's fee tier. | Document; consider pinning acceptable AmmConfigs. |
| I-5 | Info | `claim_launchlab.rs:124-131` | The event reports WSOL gained only; if the real LaunchLab pays native SOL to the creator, the claim shows `claimed_lamports = 0` while the pool grows. | Report lamports + WSOL delta. |
| I-6 | Info | `crank_buyback.rs:259-274` | Anyone can donate tokens to the fee PDA's token ATA; they are burned and counted in the memo's `burn=` (≥ `got=`). Harmless, but `burn` is not "bought". | Document. |

No Critical/High finding in the code under review. No instruction or path moves SOL or tokens anywhere but: payer → fee-PDA reserve
(init); fee PDA → its own WSOL ATA → CPMM vault in exchange for tokens → burn (crank_buyback); vault → burn (crank_vault);
LaunchLab creator vault → fee WSOL ATA (claim). The caveat is M-1: two of those paths lend the fee PDA's signature to external,
upgradeable programs whose authority changes are not checked.

## Per-area verdicts with evidence

### crank_buyback.rs
- **min_out = max(spot quote, TWAP quote) − fee − slippage**: correct and conservative. CPMM charges the trade fee on input
  (`(a−f)R/(Rin+a−f) ≥ a·R/(Rin+a)·(1−f)`) and the creator fee on input or output; `fee_ppm = trade + creator` subtracted from
  the no-fee output is never above what CPMM delivers (checked against `curve/calculator.rs swap_base_input` at b3187ae5).
  `twap_token_reserve` saturates; `buyback_min_out` cannot overflow (u128, pinned at extremes). `spot_out ≥ min_out` makes the
  effective sandwich budget `slippage_bps` (≤ 300). The existing test `f1_a_same_transaction_push_cannot_buy_below_the_twap_quote`
  covers 0–300 bps pushes.
- **300 bps caps / minimum tolerances**: `validate_rule` enforces 1–300 bps deviation, ≤ 300 bps slippage, window 600–1,200 s and
  `bps × window ≥ 150,000` (u32: max 360,000, no overflow). Thin margin — I-3.
- **15 s bucket-bias correction (`effective_obs_time`)**: verified against CPMM `oracle.rs update()` at b3187ae5: inside a bucket
  the newest entry's cumulative advances while its timestamp stays; a new entry is written only when ≥ 15 s after the bucket head;
  `last_update_timestamp` moves on every swap. So an older entry's cumulative is exact at `u ≤ min(t+14, t_next−1)`, and dividing by
  `t_end − t_eff` with `t_eff ≥ u` can only bias the TWAP HIGH (more tokens per SOL), which tightens both the guard and the TWAP
  quote. Adversarial timing cannot make `u > t_eff`: a swap at τ ≥ t+15 opens a new entry, a swap at the same second as
  `last_update` is a no-op. Ring-successor logic is right for wrapped and unwrapped rings. Legacy (old-semantics) entries are exact
  at `t`, so they are also biased HIGH. **Holds.**
- **TWAP end point extended to now**: sound. The extension uses the net-of-fee vault ratio, identical to CPMM's
  `token_price_x32` (which the next swap would accumulate); a same-slot front-run is a swap that moves `last_update` to now, so it
  adds zero weight. Only non-swap changes (direct donations into a vault) can move spot without touching the oracle: a WSOL donation
  D shifts the crank's price by ≈ D/R on a spend ≤ 0.02 R, so the donor pays ~50× the damage, with ≥ 90 % of it going to locked
  LP — griefing, not profit. Liveness quirk — L-1.
- **SyncNative / WsolBalanceMismatch**: correct. `wsol_balance = lamports − is_native reserve` is exactly what SyncNative sets;
  sync runs when lamports are wrapped or the stored amount lags; the post-swap equality `after + spend = balance + wrapped` holds
  because CPMM transfers exactly `amount_in` (no transfer fee on SPL Token). Not griefable within a transaction. The client's
  extra SyncNative is harmless.
- **2 %-of-reserve cap with carry**: `spend = min(target, 2 % · r_wsol, pool_before)`, `carried_out = target − spend`,
  `target = min(rule_spend + carried_in, pool_actual)`; saturating add, no overflow, carry bounded by the pool. A same-tx push or
  donation can lift the cap by at most a few percent of itself (bounded by the 3 % guard).
- **30-day below-floor unblock**: cannot be forced early on a tradeable pool — the crank's own blocked test (pool unreadable,
  swaps disabled / not open, vault ≤ owed fees) must hold at crank time in addition to `continuous_untradeable_secs ≥ 30 d`; a
  failed crank records nothing. Spells can be forged/cleared through `check_pool_health` in thin pools (L-3), which shortens the
  wait only for a pool that later becomes genuinely disabled.
- **Compute**: measured worst case 135,485 CU (full 100-entry ring, u64-scale units, PlatformConfig present) vs the client's
  400,000 limit and the 200,000 default; the client-shape crank transaction is 907 bytes.

### register_pool.rs / replace_pool
- PDA / owner / layout checks are correct: LaunchLab pool at `["pool", mint, WSOL]` under LaunchLab (owner + address),
  `mint_a/mint_b`, `migrate_type == CPMM`, `creator == fee PDA`; platform key == pool.platformId and owner LaunchLab; pool PDA from
  `[POOL_SEED, cpConfigId, t0, t1]`; `pool_creator == fee PDA`; both token programs SPL Token. Offsets are pinned against SDK-encoded
  bytes (tests/launchlab.rs, passes).
- **LP-lock check satisfied by an attacker-controlled lock?** Yes, but harmlessly: LP in Raydium's lock vault is principal-locked
  forever (only fee share is harvestable by the NFT holder) and a plain transfer into that ATA is a burn. A permissioned squatter
  (needs a Raydium Permission PDA) could pre-create the PDA pool with dust liquidity and lock 90 % of it; it would pass every check
  (Low likelihood; it would also break LaunchLab's own migration).
- **Fixed 90 % threshold → griefing vector**: yes — M-2 (PoC A).
- **Dependencies on LaunchLab platform state** — M-3. `replace_pool` reachability — I-4.
- Fixed pool (policy 1): creator + LP checks only; no AmmConfig/PDA constraint (creator trust, documented).

### pool_health.rs
- Spell arithmetic correct: restart when no spell or last observation > 24 h old; `continuous_untradeable_secs` counts `now`;
  `clear_untradeable` on tradeable observation or successful swap. 7-day replacement requires the old pool still untradeable and a
  candidate passing full provenance + tradeable. Forge/clear in thin pools — L-3. The crank's "empty" test (reserve ≤ owed fees)
  and health's (reserve < 0.01 SOL) differ; I found no state where the crank errors forever while health keeps clearing (the
  token-side-only-empty case is unreachable on a constant-product SPL pool).

### admin.rs
- `validate_attesters` (1–5 distinct non-default keys, known kind, 1 ≤ quorum ≤ min(count, 3)), quorum never lowered, kept ≥
  current quorum, new < new quorum, 48 h timelock, apply re-checks quorum, renounce clears pending — all implemented as described.
  Iterated proposals and quorum-1 rigidity — L-2.

### submit_reading.rs + attest.rs
- Message v3 binds genesis (build constant), program, mint, feed (no `|`, printable), prev date, date, value, src, proof — matches
  the TS `attestationMessage` byte for byte (tests pass).
- **Shared-message layout abuse**: offsets must reference the Ed25519 instruction itself (`u16::MAX` or its own index), and the
  parser reads exactly the bytes the precompile verified → no cross-instruction offsets (test
  `ed25519_offsets_into_another_instruction_are_refused`). **Signature reuse across readings**: impossible — date, prev date and
  value are signed, reading PDAs are per date, re-submission is a no-op or `ConflictingReading`. **Duplicate pubkeys**: OR-ed into
  one mask bit. **Instruction introspection**: all instructions of the transaction are scanned; runtime precompile verification
  guarantees every listed pair is valid. Holds.
- Quorum 3 fits a legacy transaction (1,186 B measured, 358-byte message with a 22-character feed; a 32-character feed and a
  20-digit value still fit).

### platform.rs
- Optional config with seeds-checked PDA; missing → hard-coded default (no wedge); creation only by the program's upgrade authority
  (ProgramData constraint); cap ∈ [1, 25] SOL; sunset > now, ≤ now + 365 d, ≤ 2027-10-01 (1,822,348,800 checked); raises only,
  48 h timelock, permissionless apply, renounce. One-time lowering at init — I-2.

### claim_launchlab.rs
- Account set and discriminator pinned byte-for-byte to the SDK; LaunchLab id, vault-auth PDA and creator vault PDA seeds-checked;
  recipient = fee WSOL ATA (must pre-exist); `remaining_accounts` refused; `fee_tokens` not passed and re-checked. Post-checks miss
  authority changes — M-1 (PoC B).
- **What the mock does NOT enforce that the real LaunchLab might**: (1) any extra accounts (e.g. an event authority + program for
  `emit_cpi!`) — the real CPI would fail and bonding-curve fees would be unreachable without an upgrade; (2) a revert on a zero
  claim; (3) paying native SOL instead of WSOL (I-5); (4) `recipient` owner/ATA constraints, `init_if_needed` paid by the creator
  (would trip `ClaimOutflow`, by design); (5) mint_b being the pool's quote mint; (6) creator-vault account type/ownership; (7) any
  use of the creator signature beyond the claim — the mock is well-behaved, the real program is trusted (M-1); (8) the platform
  semantics register_pool relies on (M-3) are not modelled at all — tests write LaunchLab pool/platform bytes directly.

### events
- Every state change emits through `emit_cpi!` (event authority PDA); `governance_hash`, `cluster_genesis`, `SpendCarried`,
  `SpendCapBound`, `BurnPoolCapBound`, `BuybackQueueUnblocked` carry what an indexer needs. No issue.

### TS client and keeper adapter
- `buildSizedTransaction`: legacy when ≤ 1,232 B, else v0 via the lookup table, else throws; LUT holds only config, instructions
  sysvar, System program, event authority (append-only, payer-owned). Correct.
- `ed25519SharedMessageInstruction`: header `2 + 14n`, `(pubkey, sig)` pairs, one message; all indices 0xFFFF; size guard. Correct.
- `memoFromTransaction`: fixes the log-spoofing issue but picks the first burn-program memo — L-6.
- Adapter: genesis check (I-1), `maxLocalAttesters ≤ 3`, DEFERRABLE/UNTRADEABLE error sets match the program's names; the
  missing-pool gap — L-5.

### Account sizes
TokenConfig 863 B (8 + 855; 23 reserved bytes), Reading 294 B, PlatformConfig 146 B (64 reserved). No realloc paths; fixed at init.

## Commands run (summaries)

| Command | Result |
|---|---|
| `git archive HEAD programs/burn-receipts` → scratch, `anchor test` (clean checkout: no `target/`, no fixtures) | 1st run: **failed** in the IDL build — `openssl-sys` (vendored OpenSSL, pulled by `litesvm` → `agave-precompiles`) `make` failure; `cargo build --tests` alone then succeeded. 2nd run: **passed** in 2 m 28 s — test.sh cloned/built raydium-cp-swap@b3187ae5 and the LaunchLab stand-in; 71 tests (10 unit, 6 governance, 21 integration, 5 launchlab, 6 platform, 16 review2, 7 review_fixes) all ok. The first failure looks environmental/flaky (parallel vendored OpenSSL build), but a clean checkout also needs network (GitHub clone, crates.io). |
| `cargo clippy --all-targets -- -D warnings` (program workspace, clean copy) | clean |
| same in `mocks/launchlab_mock` | clean |
| `node … --test test/burnReceipts*.test.ts test/burnKeeperProgram.test.ts` (repo root) | 63 pass, 0 fail (the localnet suite is opt-in and was skipped in this run) |
| `BURN_RECEIPTS_LOCALNET=1 node … --test test/burnReceiptsLocalnet.test.ts` (local validator, ledger in tmp) | 5/5 pass (vault, buyback defer, keeper vault, keeper buyback defer, keeper quorum 2) |
| scratch `tests/review3_poc.rs` (clean copy only) | PoC A (LP deposit blocks registration) passes; PoC B (malicious LaunchLab re-assigns fee PDA + WSOL ATA, then drains) passes; PoC C (quiet-pool second-crank wait 1,200 / 7,200 / 27,000 s) passes; sizes printed |
| `cargo test --test review2 -- --nocapture` | worst-case crank 135,485 CU; submit q1 74,474 CU; q3 via v0 74,693 CU, legacy-equivalent 1,186 B; crank tx 907 B |

## What could not be verified
- Raydium **LaunchLab** behaviour (closed source): whether migration creates the CPMM pool at the PDA, which key becomes
  `pool_creator` (and the role of `platformCpCreator`), whether the migrated LP lands in `ATA(LOCK_CPMM_AUTHORITY, lp_mint)`, the
  real `claim_creator_fee` account list / constraints / payout form. The SDK (0.2.74-alpha, in node_modules) has no migration
  builder.
- Raydium **LP lock** program semantics (no principal withdrawal; fee harvest reduces the locked balance) — from public knowledge,
  not source.
- Mainnet/devnet constants (LaunchLab, CPMM, LOCK_CPMM_AUTHORITY, genesis hashes) against live clusters — no network calls made.
- Whether the deployed mainnet CPMM matches commit b3187ae5 (oracle semantics, offsets).
- The upgrade authority / Squads setup and the keeper's off-chain attester key handling.

## Comparison with the two prior reports and the CHANGELOG
Written after everything above was final; read `review-claude-blind-2026-10-09.md` (R1), `review-claude-blind-2-2026-10-10.md`
(R2) and `docs/burn-receipts/CHANGELOG.md` only at this point. No finding above was changed after reading them.

### Closed (verified in code and, where noted, by a passing test or my own run)
| Prior | Status now | Evidence |
|---|---|---|
| R1 H-1 / R2 F1 sandwich budget, optional guard, 15 s bucket bias | **Closed** for same-transaction pushes: guard mandatory, ≤ 300 bps, window 600–1,200 s, 2 % reserve cap with carry, min-out = max(spot, TWAP) quotes, bias now HIGH-only, end point extended to now | code review above; `f1_*`, `buyback_min_out_is_the_larger_quote` pass. Residual multi-block hold → my L-4 (design) |
| R1 H-2 fee inflow / curve creator fee stranded | **Closed** as designed (fee PDA = LaunchLab creator + permissionless claim) | `launchlab.rs` pass; but see M-1 (signer abuse) and M-3 (unpinned LaunchLab semantics) |
| R1 M-1 PlatformConfig hard dependency | **Closed** | `active_cap` default path; `m1_*` pass |
| R1 M-2 plausibility wedge | **Closed** (KIND_RESET) | `m2_*` pass |
| R1 M-3 / R2 F12 domain + cluster separation | **Closed** for devnet↔mainnet | v3 message; `m3_*`, `f11_f12_*` pass. Localnet residual → my I-1 |
| R1 L-1 ordering, L-3 mint authorities, L-4 vault overflow, L-5 memo decimals, L-6 allowMainnet, L-7 window, I-2…I-6 | **Closed** | code + tests |
| R2 F3 stray lamport on fee WSOL | **Closed** | `poc_stray_lamport_*` passes; SyncNative/`WsolBalanceMismatch` reviewed |
| R2 F4 quorum-2 tx size, q4/q5 | **Closed** | q3 legacy 1,186 B measured; quorum ≤ 3; v0 + LUT path reviewed |
| R2 F6 non-continuous 7-day clock | **Closed** (24 h gap restarts) | `poc_replace_after_intermittent_untradeability` passes. New angle → my L-3 |
| R2 F7 permanent queue wedge, floor 0 | **Closed** on chain (30-day unblock, not forceable on a tradeable pool; floor > 0) | `f7_*` passes. Client gap → my L-5 |
| R2 F8 platform cap floor / sunset | **Closed** | `f8_*`. One-time lowering → my I-2 (R1 I-1 lineage) |
| R2 F9, F10, F11, F14, F15 | **Closed** | tests pass; F10 residual → my L-6 |
| R2 F17 tests/build | **Closed**: `anchor test` passes from a clean `git archive` checkout (needs network; first attempt flaked in the vendored-OpenSSL IDL build, second passed) | commands table |

### Still open (or only partly fixed)
| Prior | Status | Mine |
|---|---|---|
| R2 F13 LaunchLab claim post-checks incomplete | **Partly fixed, still open in a stronger form**: the fix added the token-account balance and refused extra accounts, but balance checks cannot see authority changes; a malicious callee can `assign` the fee PDA and re-own the WSOL ATA and then drain (PoC B). Same class in the CPMM CPI for `fee_wsol` / `fee_tokens`. | **M-1** |
| R1 L-2 → R2 F2 attester takeover | **Single-proposal case closed; iterated case open**: two proposals (96 h) give admin keys a quorum; at quorum 1 recovery forces quorum raises (the CHANGELOG notes the q1 consequence itself). | **L-2** |
| R1 H-2 "verify before launch" / R2 checklist 4 (LaunchLab unverifiable) | **Still open**: the claim and registration depend on closed-source LaunchLab behaviour; the F5 fix *added* dependencies (cpConfigId, lock/burn scales, PDA addressing) and the SDK shows platform fields (`platformCpCreator`, `updateCpConfigId`, `migrateCpLockNftScale`) that a platform admin can change. | **M-3** |
| R2 F5 squat by a permission holder | **Mostly closed** (other AmmConfig / random keypair refused). A permissioned squatter can still pre-create the PDA pool with dust and lock 90 % of it before migration (low likelihood; noted in the register_pool verdict). | verdict note |
| R1 M-4 rescue path | **Closed in mechanism, thin in reach**: `replace_pool` can only target a pool on a different AmmConfig, i.e. after the LaunchLab platform admin changes `cpConfigId`. | **I-4** |

### Regressed
None of the previously fixed behaviours regressed. Measured worst-case crank CU is 135,485 vs the CHANGELOG's 132,485 (+3,000,
likely pool orientation/random mint; still far under 200 k).

### New in this round (introduced by, or adjacent to, the round-2 changes)
| Mine | Origin |
|---|---|
| **M-2** fixed 90 % LP ratio griefable by an ≥ 11.2 % deposit (PoC A) | introduced by the R2 F5 fix (the CHANGELOG's rationale "90 % so dust deposits cannot block registration" holds for dust only) |
| **L-1** newest observation never used as TWAP start → post-crank wait scales with the prior quiet gap (PoC C) | companion of the R2 F1(d) end-point extension, which fixed the frozen-TWAP case only partially |
| **L-3** untradeable spell forge/clear in thin pools | angle not covered by R2 F6 |
| **L-4** multi-block TWAP hold with permissionless crank timing | residual of R1 H-1 ("walk the TWAP") at the new 600–1,200 s window |
| **L-5** client cannot observe/crank a missing pool | the R2 F7 fix's client side |
| **L-6** first-memo selection with two cranks in one tx | residual of the R2 F10 fix |
| **I-1** localnet signs mainnet-genesis messages | residual of the R2 F12 fix |
| **I-2**, **I-3**, **I-5**, **I-6** | informational |

## Re-check after round 3 (2026-10-10)

Scope: `git diff a96f845` over `programs/burn-receipts`, `src/lib/burnReceipts`, `src/lib/burnKeeper/programAdapter.ts`,
`programChain.ts`, `scripts/burnreceipts-admin.mts`, plus the CHANGELOG's round-3 rows (HEAD `fc33077`, merge of `418a294`).
Read-only; all builds and PoCs ran in a fresh `git archive HEAD` copy in the scratchpad.

**Runs.** `anchor test` (anchor build → `scripts/test.sh`: CPMM fixture, LaunchLab stand-in, `evil_callee`, the `--features
localnet` build, then the LiteSVM suite) on the clean copy: **82/82 pass** (unit 10, governance 6, integration 21, launchlab 5,
platform 6, review2 16, review3 11, review_fixes 7), 3 m 15 s. `cargo clippy --all-targets -- -D warnings`: clean. TS
`burnReceipts*` + `burnKeeperProgram`: 65/65 pass. The opt-in localnet suite was not re-run: it now needs
`target/deploy-localnet/`, which exists only after `test.sh` has run in the repo itself. My scratch re-check PoCs
(`recheck3_poc.rs`, `evil_mock/`, `multicall/`): (1) my round-3 malicious LaunchLab now reverts with `FeeAccountTampered`, and the
fee PDA stays System-owned; (2) **a WSOL donation into the pool vault, in the same transaction as `check_pool_health`, clears a
reserve-based spell**; (3) **a wrapper program that CPIs `[CPMM swap, check_pool_health]` inside ONE top-level instruction clears
the spell. The same two instructions at top level are refused with `PoolTouchedInTransaction`.**

| Finding | Verdict | Pinned by | Notes / anything new |
|---|---|---|---|
| M-1 fee-PDA signer abuse by a CPI callee | **Closed** | `review3.rs::poc_b_claim_post_checks_miss_authority_changes` (5 hostile modes + an honest claim), `m1_a_hostile_cpmm_cannot_reauthorise_the_fee_pdas_token_accounts`; my own evil mock also reverts | `guards.rs` after both CPIs: the fee PDA must stay System-owned, data-empty, lamports ≥ before; `fee_wsol`/`fee_tokens` must keep the fee PDA as owner, the same mint, no delegate (amount 0), no close authority, Initialized, and unpack as SPL Token (exact 165 B). Swap: exact WSOL out, and the token vault's decrease must equal `got`, so a callee that skims `fee_tokens` and tops it up from the vault, or skims without refilling, also reverts. **Lamport-only drains:** claim path checks lamports ≥ before; in the swap the fee PDA is read-only. **Close-and-recreate** of `fee_wsol` fails the amount checks. **Reallocation:** SPL Token accounts cannot be reallocated, and the unpack needs the exact layout. **Residual (Info):** lamports sitting unsynced on `fee_wsol` are not guarded on the claim path, but no SPL Token instruction except Close (caught) can move them. Reentrancy into burn_receipts is refused by the runtime. |
| M-2 90 % LP ratio griefable | **Partly closed** | `review3.rs::poc_a_lp_deposit_griefs_registration` (12.5 % no longer blocks; > 100 % still does), `review2.rs::f5_lp_must_be_half_burned_or_locked` | The floor is now 50 % of live supply, so blocking a 100 %-locked migration takes a deposit **larger than the whole migrated liquidity** (≈ 170 SOL of capital on an 85 SOL migration), kept in place while it earns fees. It is still possible for a well-funded griefer, and the same floor also blocks the new fixed-pool fallback. Side effect: a permissioned squatter now only needs to lock half of its own LP (policy 0 still requires the PDA of the pinned config). |
| M-3 unpinned LaunchLab platform state | **Partly closed** | `review3.rs::m3_initialize_token_pins_the_launchlab_platform`, `m3_set_registration_policy_recovers_a_stranded_token` | Pinning at init covers a **later `cpConfigId` change** (recoverable through `set_registration_policy`). Not covered: **the platform admin changing `platformCpCreator` or the lock/burn scales after init and before migration.** The migrated pool's creator ≠ fee PDA, or < 50 % locked, fails BOTH policies (both require a fee-PDA creator and the LP floor), so that strands the token for good. Per D-3 that admin is an untimelocked key that cannot be moved to Squads. The recovery power also ends at the cap sunset (≤ 2027-10-01). Real LaunchLab behaviour is still unverified (devnet-rehearsal gate). |
| L-1 quiet-pool TWAP start | **Closed** | `review3.rs::poc_c_quiet_pool_second_crank_waits_beyond_window` (next crank works after exactly 600 s) | Correct: the newest entry, dated `last_update` (where its cumulative is exact), is eligible only when no swap happened inside the window; older entries can never beat it. Consequence (Info): in a quiet pool the TWAP equals spot once the price has held for one window, so the L-4 hold costs exactly one window. That is the intended semantics, and it matters after the cranker allowlist sunsets. |
| L-2 iterated attester takeover | **Partly closed (by design)** | `review3.rs::l2_iterated_proposals_need_seven_days_of_seniority`; `integration.rs::attester_rotation_*` | Seniority (7 days) for kept keys when a proposal adds keys. The walk {A,B,C}→{A,B,C,X}→{A,X,Y} now takes ≥ 48 h + 7 d + 48 h, all public. Attesters still never consent. Membership dates carry over correctly at apply. Initial keys become senior 7 days after init, so no key can be added in a token's first week. |
| L-3 forge/clear spells in thin pools | **Partly closed — the new check can be bypassed** | `review3.rs::l3_pool_health_cannot_be_forged_inside_a_swap_transaction` (top-level case only) | Two observations ≥ 1 h apart are now needed to START a spell: good, forging needs two transactions. But `require_pool_untouched` only inspects the OTHER top-level instructions. **(a) CPI wrapper:** one top-level instruction of any program CPIs the swap and `check_pool_health`; the current (wrapper) index is skipped, so it passes (my PoC 3: spell cleared). **(b) Vault donation:** a token transfer into the pool's WSOL vault lists neither the pool nor CPMM (PoC 2: spell cleared for the donation). **(c) Bundles:** a Jito bundle of separate transactions (sell / check / buy) is atomic and invisible to the sysvar. Clearing needs one such transaction or bundle; forging needs two, ≥ 1 h apart. Impact is unchanged (Low): only `replace_pool` reach, since the 30-day unblock relies on the crank's own blocked test. **Fix:** require top-level invocation (`get_stack_height() == TRANSACTION_LEVEL_STACK_HEIGHT`) in `check_pool_health` / `replace_pool`, add the pool's two vaults (and the observation account) to the "touched" keys, and document the bundle residual (or judge reserves on oracle data). |
| L-4 multi-block TWAP hold + permissionless crank timing | **Closed while the cap is in force; reverts after the sunset (as designed)** | `review3.rs::l4_cranker_allowlist_applies_only_while_the_cap_does` | ≤ 3 distinct non-default keys, set only at `initialize_platform`, can only be cleared, applies only while the PlatformConfig cap is active; no PlatformConfig means permissionless. **New (Low, liveness):** if the allowlisted keys are lost and the platform authority has renounced, no `crank_buyback` (including below-floor and 30-day processing) can run until the sunset (≤ 1 year). Allowlisted crankers are trusted not to run the hold themselves. Cosmetic: allowlist errors reuse `InvalidAttesters`. |
| L-5 client cannot observe/crank a missing pool | **Closed** | `review3.rs::l5_a_missing_pool_can_be_observed_and_cranked_from_the_config_alone` | Vaults are now `UncheckedAccount`, key-checked and owner/unpack-read once the pool is readable. Client `poolAccountsOrStandIns` reuses the same stand-in PDA for three mutable slots; Anchor 1.2.1's duplicate-mutable check covers only types that serialize on exit, so unchecked duplicates are accepted. No TS unit test covers the stand-ins (Rust test covers the program side). |
| L-6 first memo with two cranks in one tx | **Closed** | TS `burnReceiptsClient` (two readings in one transaction) | Memo chosen by its date field; threaded through `crankNext`, `memoOf`, `findCrankTx` and `programChain`. |
| I-1 localnet signs mainnet-bound messages | **Closed** | `review3.rs::i1_the_default_build_binds_mainnet_and_localnet_has_its_own_tag`; TS "review-3 I-1" | `localnet` feature tag = sha256("BURNRECEIPTS-LOCALNET-GENESIS"); `assertSignableGenesis` refuses mainnet genesis off mainnet and requires config genesis = RPC genesis on devnet/mainnet. Residual (Info): on `localnet` a DEVNET-genesis config is still signed (devnet replay under key reuse). A localnet-tag build deployed on mainnet fails loudly (the client refuses to sign). |
| I-2 one-time cap lowering | **Closed** | `review2.rs::f8_platform_cap_floor_and_sunset_bound`, `platform.rs` | `CapNotDefault`; the old range check is now redundant. |
| I-3 … I-6 | **Accepted / documented** (README §8) | — | No code change, as decided. |

### New in round 3 (beyond the per-finding notes)
| # | Sev | Where | Issue | Fix |
|---|---|---|---|---|
| R3-1 | Low | `pool_health.rs` `require_pool_untouched` | CPI-wrapper, vault-donation and bundle bypasses of the instructions-sysvar check (PoC 2 and PoC 3 pass). Detailed in the L-3 row. | Top-level-only, vaults in the touched set, bundle residual documented. |
| R3-2 | Low | `admin.rs` `set_registration_policy` / `apply_registration_policy` | A new admin power over WHERE buybacks trade. While no pool is verified (the whole bonding-curve phase, or while an M-2 griefer blocks registration), or after 7 days of untradeability, a compromised admin colluding with a Raydium permission-PDA holder can switch to a fixed pool with a fee-PDA creator and ≥ 50 % locked LP, on ANY AmmConfig, where the colluder holds the other ≤ 50 %. There is a 48 h public timelock but no veto, and a pending proposal stays applicable until cancelled. Bounded by the cap sunset and by renouncing the admin. | Require ≥ 90 % locked/burned (or the PDA of a LaunchLab-known config) for the fallback pool, or a co-signature from the current attester quorum; let a proposal expire. |
| R3-3 | Low | `initialize_token.rs` `pin_launchlab_platform` (M-3 residual) | The platform fields are checked only at init. After init the untimelocked LaunchLab platform admin can change `platformCpCreator` or the lock scales before migration, and that strands the token beyond the reach of either policy. | Launch only on a platform whose admin key sits under the same governance; re-check the fields in the devnet rehearsal and at migration time; document this as a launch gate. |
| R3-4 | Low | `crank_common.rs` `crankers_in_force` | Cranker allowlist liveness: lost keys plus a renounced platform authority stop every buyback crank until the sunset. | Keep the platform authority until the sunset, or let anyone clear the list after N days with no successful crank. |
| R3-5 | Info | `scripts/burnreceipts-admin.mts:129` | The JSON output includes the `rpc` URL, so an API key embedded in a custom `--rpc` ends up in terminal and logs. Send gating is otherwise sound: dry run by default, `--send` needs key files (treasury key file refused), mainnet also needs `--i-understand-this-spends-real-sol`, genesis must match `--cluster`, and a failed simulation sends nothing. The program id falls back to the localnet id with only a warning, and that fails simulation off localnet. | Redact the URL's query and userinfo. |
| R3-6 | Info | test plumbing | The opt-in TS localnet suite now depends on `target/deploy-localnet/`, which only `test.sh` builds. | Mention it in the suite's skip message. |

**Bottom line:** M-1, L-1, L-5, L-6, I-1 and I-2 are closed with pinning tests. M-2, M-3, L-2 and L-3 are partly closed; L-4 is closed only while the cap is in force. Round 3 added one Low that can be bypassed (R3-1, proven) and three Low trust/liveness edges (R3-2..R3-4). No path that moves funds was added, and no Critical/High issue was found.
