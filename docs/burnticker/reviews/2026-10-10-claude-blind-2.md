# burn_receipts — independent security review #2 (blind)

Date: 2026-10-10 · Reviewer: Claude (no prior exposure; prior report and CHANGELOG read only AFTER the findings below were written)
Scope: `programs/burn-receipts/programs/burn_receipts/src/**`, `tests/**`, `mocks/launchlab_mock`, and the TS client `src/lib/burnReceipts/**`.
Reference sources used: the pinned Raydium CPMM source in `fixtures/raydium-cp-swap` (commit b3187ae5) and the LaunchLab SDK fixture.
Mode: read-only on the repository. All builds and proof-of-concept tests ran in an APFS clone in the session scratchpad.

## Summary

No path was found by which any key extracts SOL or tokens from the fee PDA, its ATAs or the vault other than swap→burn / burn,
**given** the program is finalised (non-upgradeable) and Raydium's CPMM/LaunchLab behave as their SDK/source say. Account
validation on all 18 instructions is sound. The material problems are in **value leakage on the swap, governance, liveness and the
client**:

* every buyback can be sandwiched by its own cranker, atomically and risk-free, for up to the TWAP tolerance (~5 %, effectively up
  to ~7 % with the oracle's 15 s bucket bias) of the spend, because `min_out` is derived from the same (manipulable) spot reserves;
* the "a proposal must keep ≥ quorum current keys" rule does not stop one proposal from giving the NEW keys a quorum (PoC);
* a 1-lamport transfer to the fee PDA's WSOL ATA reverts every wrapping crank (PoC); the shipped client has no workaround;
* the shipped client cannot submit a quorum-≥2 reading on a real cluster (1,344-byte transaction, limit 1,232); quorum 4–5 does not
  fit a legacy transaction in any layout, and the quorum can never be lowered (LiteSVM does not enforce the size limit, so the
  suite is green);
* `register_pool` is first-come and trusts that only LaunchLab can create a CPMM pool with `pool_creator = fee PDA`; in the CPMM
  source any holder of a Raydium permission PDA can do so (`creator` is an unchecked account), and a registered squatter pool is
  effectively permanent.

## Findings (severity-ranked)

| # | Sev | Where (file:line) | Exploit / failure scenario | Fix |
|---|-----|-------------------|---------------------------|-----|
| F1 | Medium | `src/instructions/crank_buyback.rs:129-148`, `src/math.rs:108-120`, `src/cpmm.rs:177-199`, `src/constants.rs:23` | The cranker (or a Jito searcher bundling around any cranker) runs `[buy token, crank_buyback, sell token]` in one transaction. The TWAP guard only bounds how far spot may sit above the oracle TWAP (≤ `max_twap_deviation_bps`, up to 500). `min_out` is computed from the spot reserves AFTER the front leg, so `slippage_bps` adds no protection. Expected leak per crank ≈ deviation × spend (≈5 % of every buyback at the 500 bps maximum), minus ~0.7 % fees on the push size. Additionally the oracle's older observations keep accumulating for ≤14 s after their `block_timestamp` (CPMM `oracle.rs:117-125`), so `dt` is overstated and the TWAP is biased LOW by up to 14/600 ≈ 2.3 %, which loosens the guard to ≈7.3 % at a 600 s window. | Derive a second min-out from the TWAP price (expected output at TWAP with the trade's own impact, less fee and `slippage_bps`) and require `got ≥ max(spot_min_out, twap_min_out)`; this caps the sandwich at `slippage_bps`. Lower the maximum deviation (e.g. 100–200 bps). Correct the TWAP bias by using `dt = t_end − (t_old + 15)` or the next observation's timestamp as the old endpoint. |
| F2 | Medium | `src/instructions/admin.rs:39-42` | Quorum 2, 3 keys. Admin proposes `{K1, K2, E1, E2, E3}` (keeps 2 ≥ quorum). After 48 h anyone applies; **E1+E2 alone now sign readings**. PoC `poc_single_proposal_gives_new_keys_quorum`: reading with units = 5 accepted with mask `0b1100` (new keys only). A compromised admin (Squads) takes over readings in 48 h, not "never in one proposal". Impact is bounded (readings ≤ `max_abs_delta`/day → accelerated buybacks inside F1's leak; burns can also be halted), no direct theft. | Require `added_keys < new_quorum` (every quorum-sized subset of the new set must contain a current key), or `kept ≥ new_quorum` AND `added ≤ quorum − 1`. |
| F3 | Medium | `src/instructions/crank_buyback.rs:152-163,190`; client `src/lib/burnReceipts/crank.ts:141,163-171` | Anyone sends 1 lamport by system transfer straight to the fee PDA's WSOL ATA (no `SyncNative`). On the next crank that wraps (`from_lamports > 0`), `sync_native` folds the stray lamport into `amount`, and the post-swap check `wsol_after + spend == wsol_balance + from_lamports` fails → `InvalidCpmmAccount`. PoC `poc_stray_lamport_on_fee_wsol_blocks_crank` confirms; prepending `SyncNative` in the same transaction fixes it. The shipped client does not prepend it and treats `InvalidCpmmAccount` as fatal (not deferrable), so the keeper throws on every run until a human intervenes; the griefer can repeat for 1 lamport + fee. | Call `sync_native` on `fee_wsol` (and `reload`) BEFORE reading `wsol_balance`, or assert on deltas measured after the sync; in the client, prepend `SyncNative(fee_wsol)` to every buyback crank. |
| F4 | Medium | client `src/lib/burnReceipts/attestation.ts:75-100`; `src/instructions/initialize_token.rs:90-98`; `src/instructions/admin.rs:37` | Canonical message is 313 bytes (DEBT feed). The client copies the message once per signature: legacy tx size = 921 B (q1), **1,344 B (q2)**, 1,767 (q3), 2,190 (q4), 2,613 (q5) — limit 1,232. A shared-message layout gives 921 / 1,031 / 1,141 / **1,251 / 1,361**. So the shipped client cannot post the planned quorum-2 readings, and quorum 4–5 configurations cannot post a reading in any legacy transaction (only v0 + address lookup table might fit q4/q5). Because the quorum can never be lowered, raising it to 4–5 is an irreversible reading halt. LiteSVM accepted the 2,613-byte transaction, so the test suite does not catch this (PoC `poc_submit_tx_size_by_quorum`). | Client: one message, N (pubkey, signature) entries pointing at it; send v0 transactions with a lookup table for config/reading/sysvar/system/event-authority. Program: cap quorum at 3, or document and test the q4/q5 v0+ALT path. Add a serialized-size assertion to the test harness's `send`. |
| F5 | Medium (trust-dependent) | `src/instructions/register_pool.rs:31-44`; `src/instructions/pool_health.rs:104-123`; CPMM `initialize_with_permission.rs:26-27,74-82` | `register_pool` is permissionless and once only. In the CPMM source, `initialize_with_permission` takes `creator` as an **UncheckedAccount** set by any payer holding a `Permission` PDA (granted by Raydium's admin). Any permission holder (not only LaunchLab's migrator) can create a WSOL/<mint> pool (PDA on any AmmConfig, or a random-keypair pool) at an arbitrary price with `pool_creator = fee PDA`, own 100 % of its LP, and register it before the real migration (the mint must already have no mint authority). Every buyback then buys from the squatter's pool at the squatter's price; the TWAP guard is relative to that same pool, so it does not help. `replace_pool` needs 7 days of untradeability, which the squatter never allows → permanent capture of the fee pool. | Do not register by `pool_creator` alone: also require that the pool's LP is burned/locked (e.g. `lp_supply` held by a known lock or burned), or that the pool address equals LaunchLab's deterministic migration pool (PDA of LaunchLab's AmmConfig + mints), or register only from a LaunchLab-migrated state proven on chain. At minimum, publish the list of permission holders as a trust assumption. |
| F6 | Low | `src/instructions/pool_health.rs:70-78,110-114` | The "untradeable for 7 days" clock is "first seen", not "continuous": flag once, pool trades normally for a week with nobody calling `check_pool_health` (successful third-party swaps do not clear it; only a BURNED crank or a check does), one moment of untradeability later → `replace_pool` succeeds. PoC `poc_replace_after_intermittent_untradeability`. Exploitable only together with a second fee-PDA pool (F5) and a way to make the real pool briefly untradeable (Raydium status flip; driving net WSOL reserve under 0.01 SOL is impractical on a real pool). | Require a minimum number of observations spread over the 7 days (e.g. at least one flag per day), or store `last_seen_untradeable` and require `now − last_seen ≤ 1 day` plus `last − first ≥ 7 days`. |
| F7 | Low | `src/instructions/crank_buyback.rs:128-131,149`; `initialize_token.rs:65-73`; `pool_health.rs:108` | The buyback queue has no exit when the pool is permanently untradeable: `PoolNotTradable` / `EmptyReserves` revert (they are not converted to `BELOW_FLOOR` + carry), and `replace_pool` needs another fee-PDA pool, which normally can never exist after the single LaunchLab migration (and never exists under `POOL_POLICY_FIXED`). Readings keep being recorded but no burn or later zero-unit reading is ever processed. Also `floor_lamports = 0` is allowed, in which case a tiny spend gives `min_out == 0` → `ZeroOutput` revert instead of below-floor. | After N days of recorded untradeability with no replacement, let the crank process the reading as `BELOW_FLOOR` (spend carried) so the queue advances. Require `floor_lamports > 0`, and treat `min_out == 0` as below-floor. |
| F8 | Low | `src/instructions/platform.rs:44-45` | `initialize_platform` accepts any cap in `1..=25 SOL` and a sunset up to 365 days from **creation**. A 1-lamport cap makes every token's spend ≤ 1 lamport (< floor) → all burns stall program-wide until the sunset; creating the PlatformConfig late (e.g. 2027-09) extends the cap regime past the hard-coded default sunset (2027-10-01). Only the upgrade authority can do this, and before finalisation it can do anything anyway, so this matters only as a mis-click guard. | Require `cap ≥` a sensible floor (e.g. 1 SOL) and `cap_sunset_ts ≤ DEFAULT_CAP_SUNSET_TS`. |
| F9 | Low | client `src/lib/burnReceipts/memo.ts:135` | `memoFromChain` builds `swap=` from the config's CURRENT `cpmm_pool`. After `replace_pool`, every older buyback reading is reconstructed with the new pool's prefix and no longer matches the memo the program wrote, so the "verify it yourself" check reports false mismatches. | Store the pool used in the Reading (spare bytes exist) or read it from the transaction; reconstruct from that. |
| F10 | Info | client `src/lib/burnReceipts/crank.ts:53-59` | `memoFromLogs` returns the first `Memo (len N)` log line. Any transaction that carries a top-level Memo instruction before the crank (for example a spoof crafted for an indexer) shows that memo instead of the program's. | Read the memo from the burn program's inner Memo CPI (inner instructions), not from log text. |
| F11 | Info | `src/events.rs:11-25`; `src/instructions/initialize_token.rs:121-132` | `TokenInitialized` omits `admin`, the only governance key; `params_hash` covers neither the attesters, the quorum nor the admin. Indexers reconstructing governance from events alone miss the initial admin. | Add `admin` to the event; consider hashing attesters/quorum/admin into a separate governance hash. |
| F12 | Info | `src/attest.rs:28-52`; `Anchor.toml` (same id for localnet and devnet) | The signed message binds program and mint but not the cluster. If one program id and one mint keypair are reused across clusters (e.g. a devnet rehearsal with the production mint key), devnet attestations replay on mainnet. | Add the genesis hash (or a cluster tag) to the message, or forbid mint-key reuse operationally. |
| F13 | Info | `src/instructions/claim_launchlab.rs:106-109` | The LaunchLab CPI receives the fee PDA as a writable signer; the post-checks cover only fee-PDA lamports and the WSOL ATA, not the fee PDA's token ATA (CPMM creator fees in the token) or any other fee-PDA-owned account. Safe only if the real LaunchLab `claim_creator_fee` does nothing else with that signature (cannot be verified: closed source; the mock enforces only the SDK's account shape). | Also snapshot and re-check `fee_tokens.amount` (and fail if any other fee-PDA token account is passed writable). |
| F14 | Info | `src/instructions/register_pool.rs`, `crank_buyback.rs:95-103` (policy FIXED) | Under `POOL_POLICY_FIXED` the program checks owner, mints and token programs of the fixed pool but not its creator or LP ownership; a creator who fixes a pool whose LP they hold captures buyback value as in F5, and a dead fixed pool can never be replaced (F7). | Document as a creator-trust mode, or apply the same LP-lock requirement as F5. |
| F15 | Info | `crank_buyback.rs:143-144,254-263`; `events.rs` `ReadingProcessed` | When the 2 % reserve cap pushes the spend under the floor, the whole target is carried, but `SpendCapBound` is emitted only when `spent > 0`, and `ReadingProcessed` has no carry fields; the carry grows with no event (it is visible in the Reading account). | Emit `SpendCapBound` whenever `carried_out > 0`, or add `carried_in`/`carried_out` to `ReadingProcessed`. |
| F16 | Info | trust model | Until the upgrade authority is finalised, it can replace the code and every "no extraction" claim is void (README §5 documents Squads + timelock, then `--final`). | Keep, and make finalisation a launch gate. |
| F17 | Info | tests / build | (a) `fixtures/launchlab_mock.so` is missing from the tree: 2 of 3 LaunchLab tests fail as checked out (they pass after building the mock). (b) The WSOL-is-token_1 TWAP path (`cum_off = 24`) runs only when a random test mint sorts below WSOL (≈2.4 % of runs) — no deterministic test. (c) `platform.rs::buyback_needs_the_platform_config` is stale: it asserts only a generic failure that now has unrelated causes. (d) `anchor build` reports a program-id mismatch (`target/deploy` keypair 9DSt… vs `declare_id!` GV9C…). (e) The test harness never checks serialized transaction size (masks F4). (f) Stale comments: `state.rs:34` ("0 disables the guard"), `constants.rs:34` (v1 message shape), `submit_reading.rs:11`. | Commit or build the mock in CI, add a fixed-orientation TWAP test, rename/fix the stale test, add a size assertion to `Env::send`. |

## Per-item verdicts (checklist)

**1. Signer / owner / PDA / discriminator / mutability on every instruction — PASS.**
Every config/reading/platform account is `Account<…>` with seeds+bump (owner and discriminator by Anchor). `fee_vault` is
`SystemAccount` with seeds `["fee", mint]` + stored bump. ATAs carry `associated_token::{mint,authority,token_program}`, so the
WSOL/token accounts cannot be substituted. External programs are address-pinned (CPMM, LaunchLab, Memo, Token via `Program<Token>`,
the instructions sysvar). CPMM accounts (`pool_state`, `amm_config`, `observation_state`) are owner + discriminator + length checked
(`cpmm.rs:65-70`) and cross-checked against the registered pool (`crank_buyback.rs:100-103`); vaults are classic token accounts
equal to the pool's vault keys. Admin/platform instructions check the stored authority (`admin.rs:26-30`, `platform.rs:69-73`);
`initialize_platform` checks ProgramData's upgrade authority. `initialize_token` requires the mint keypair, creator and payer
signatures. Writable flags are minimal (fee PDA is read-only in the swap CPI; writable only in claim, post-checked).

**2. Outflow paths other than swap→burn/burn — PASS with caveats (F5, F13, F14, F16).**
Program-signed fee-PDA actions: system transfer fee PDA → its own WSOL ATA (`crank_buyback.rs:152-163`, reserve re-checked); CPMM
`swap_base_input` with the fee PDA as read-only authority of the input ATA, output to the fee PDA's token ATA, exact WSOL
consumption asserted (`:190`); SPL burn from the fee PDA's token ATA; LaunchLab claim with recipient pinned to the WSOL ATA and
lamport/WSOL non-decrease asserted. Config-PDA signs only `burn` from the vault. No close/approve/set_authority/transfer anywhere;
no instruction closes Reading/Config accounts (rent is permanently locked, by design). `replace_pool` moves no funds. The value-loss
routes are economic (F1, F5, F14), not unauthorised transfers.

**3. CPMM swap — PASS on substitution; FINDINGS on economics (F1, F3, F7).**
Pool/vault/config/observation/program substitution is closed (registered address, owner/discriminator, key equality, pinned
program; the CPMM authority PDA is seed-checked by CPMM itself). Byte offsets match the pinned source (PoolState 637 B: creator 40,
vaults 72/104, mints 168/200, programs 232/264, observation 296, status 329, fees 341–405, open_time 373, enable_creator_fee 390;
AmmConfig trade fee 12, creator fee 108; ObservationState index 9, ring 43 + 40·i, `last_update_timestamp` 4043). Price
orientation is right (`token_0_price = token_1/token_0`, so WSOL-as-token_0 uses `cum_off 8`). `min_out` is always achievable
(fee applied to the no-fee output is conservative for both creator-fee-on-input and -on-output), so it never blocks a fair swap, but
it gives no MEV protection (F1). TWAP: newest-observation endpoint uses `max(last_update_timestamp, t_new)` correctly; old endpoint
bias as in F1; stale pools give a TWAP that ends at the last trade (conservative). Window always fits the ring (100 × ≥15 s ≥ 1,485 s
> 1,200 s). 2 % cap arithmetic is correct (u128, floor), net of owed pool fees; `spend ≤ min(target, 2 % reserve, capped pool)`;
reserve preserved. Griefing: front-running to trip `TwapDeviation` costs the griefer fees and is deferrable; the 1-lamport WSOL grief
(F3) is cheap and not deferrable.

**4. LaunchLab CPI — PASS against the SDK; UNVERIFIABLE against the real program.**
Account order, signer/writable flags and the discriminator match the SDK builder byte for byte (test `the_cpi_is_the_sdk_instruction_byte_for_byte`,
and the e2e mock tests pass once the mock is built). The program pins the vault-auth PDA and the creator vault PDA under the
LaunchLab id, the WSOL ATA as recipient, and post-checks lamports/WSOL. The mock does NOT enforce what the real program may: (a) that
`creator` matches a LaunchLab pool's recorded creator (no pool account in the SDK list), (b) `init_if_needed` on the recipient paid by
the creator (avoided because the ATA must pre-exist), (c) any extra event-CPI accounts, (d) any other side effects of the creator
signature (F13), (e) whether the claim pays WSOL or native SOL (both pass the post-checks). Also unverified: that LaunchLab
`initializeV2` accepts a non-signer creator, that migration sets the CPMM `pool_creator` to that creator (if not, `register_pool` can
never succeed and every units reading waits forever), and that the mint authority is revoked at creation.

**5. ed25519 introspection — PASS.**
Offsets are parsed with bounds checks; every triple must reference the ed25519 instruction itself (`u16::MAX` or its own index), so
the bytes read are the bytes the precompile verified. All instructions in the transaction are scanned; a key counts once (bitmask);
attesters are distinct and non-default at init/proposal. Replay across mints/programs is closed (both in the message); prev-date
binding fixes ordering (test `l1_presigned_readings_cannot_be_reordered`); cross-cluster replay is open only under key reuse (F12).
Quorum arithmetic: `mask.count_ones() ≥ quorum`, quorum ≤ count ≤ 5. No instruction-index assumption beyond "same transaction".
The precompile result is atomic with the transaction, so ordering of ed25519 vs submit does not matter. Size limits: F4.

**6. Reading math — PASS.**
`step`: delta computed in i128 then i64 (values ≤ i64::MAX, so it always fits); carry < unit invariant holds (carry only from
`total % unit`); CARRY_NONE keeps carry 0. Out-of-bound delta → `KIND_RESET`, 0 units, carry 0, new baseline (verified
`m2_out_of_bound_reading_resets_loudly`; a return trip is also out of bound, so a bad print cannot earn units on the way back).
`buyback_spend`: keep factor exact; floors make spend ≥ the exact rational by ≤ 1e-15·pool and never > pool; `units` up to
9.2e18 costs 63 squarings (worst-case PoC fine). `min_amount_out`, `reserve_spend_cap`, `sol_price_x32`, `twap_ok` cannot overflow
for u64 inputs. Vault `settle_vault` saturates. Dates validated; FutureDate uses the UTC date of the cluster clock.

**7. Governance — FINDING F2; otherwise PASS.**
Timelock: `eta = now + 48 h`, overwrite restarts it, apply checks `now ≥ eta` and re-checks the quorum; no bypass found. Quorum
can never be lowered; the set never smaller than the quorum. Renounce clears pending and is final; consequence: if attester keys are
lost below quorum after renounce, readings stop forever (design). PlatformConfig: creation only by the upgrade authority, once;
raise-only via 48 h; permissionless apply; sunset fixed at init; default applies when absent (`m1_…_never_a_wedge`). Cap/sunset
bounds: F8. Events: all state changes emit (`every_state_change_emits_an_event`), gaps F11/F15.

**8. Pool health / replace — FINDINGS F5, F6, F7.**
Griefer cannot force a replacement without a second fee-PDA pool; it can keep a thin pool "tradeable" (≥ 0.01 SOL net WSOL) for
the cost of one small swap and clear the flag, so a near-dead pool is never replaced (burns then trickle at 2 % of a tiny reserve).
The untradeable oracle reads the pool's own status/owner/vault; the vault account must be the pool's (`require_keys_eq`), and a
non-token-program vault reads as 0 (only possible if the pool is corrupt). 7-day clock: F6.

**9. Init — PASS.**
Mint keypair must sign → one config per mint, only by the key holder; `init` forbids re-init (test). Admin mandatory and non-default;
attesters/quorum validated; rule validated per mode (TWAP mandatory 1–500 bps, 600–1,200 s; reserve ≥ rent-exempt minimum for a
0-byte account; vault mode has no reserve and a u64-safe max day). Fee PDA top-up handles pre-funded PDAs. Token-2022 is excluded
(`Account<Mint>`/`Program<Token>`, and both pool token programs must be classic SPL). Mint/freeze authority must be none
(checked at register and every crank). `floor_lamports` may be 0 (F7).

**10. Client — FINDINGS F3, F4, F9, F10; otherwise PASS.**
Every send is simulated first; genesis hash is fetched and must match the label; mainnet needs `allowMainnet`. Unknown genesis
(e.g. testnet) is treated as "localnet" — harmless. Secret handling: `signAttestation` takes raw key bytes, builds a PKCS#8 key in
memory, never logs or reads files. Instruction builders take account order/flags from the IDL. Signature packing is correct but
oversized (F4). `fetchNextReadingInLine` depends on `getProgramAccounts` (some RPC providers disable it — operational).

**11. Liveness / DoS — FINDINGS F3, F4, F7; reading path PASS.**
Readings: no wedge (resets instead of refusals; idempotent resubmission). Crank queue: permanent wedge on a dead/fixed pool (F7);
cheap repeatable grief (F3); quorum 4–5 cannot post readings (F4). TWAP-unavailable is self-healing (anyone can trade twice 600 s
apart).

**12. Compute and sizes — PASS (claim slightly low).**
Measured in LiteSVM: `submit_reading` quorum 1 = 67,735 CU, quorum 5 = 73,057 CU; `crank_buyback` worst case (100-entry ring scanned,
9.22e18 units, 1,200 s window, platform cap present) = **124,680 CU** (above the stated ~108k, well under the client's 400k limit and
the 200k default). Buyback crank transaction in client shape (CU limit + 2 ATA creates + crank) = 902 bytes. Memo worst case ≈ 350 B
< 566. Account sizes are small and fixed. Transaction size is the binding limit for submissions (F4).

## What I ran

| Command (scratch clone) | Result |
|---|---|
| `anchor build` | up to date; warns program-id mismatch (keypair 9DSt… vs declare_id GV9C…) |
| `cargo test -p burn_receipts -- --test-threads=1` (tree as checked out) | unit 9/9, governance 6/6, integration 21/21, then **launchlab 1/3** (mock `.so` missing) and cargo stops |
| `cargo-build-sbf` mock, then the full suite again | unit 9, governance 6, integration 21, launchlab 3, platform 6, review_fixes 7: all 52 pass |
| `cargo clippy -p burn_receipts --lib` | clean; tests: only `result_large_err` / `too_many_arguments` style warnings |
| node test runner: `burnReceiptsClient`, `burnReceiptsMath`, `burnReceiptsMemo` | 35/35 pass |
| PoC suite `tests/review2_poc.rs` (scratch only, 6 tests) | all confirm: F3 (InvalidCpmmAccount at crank_buyback.rs:190; fixed by SyncNative), F2 (new keys alone accepted), F6 (replace after intermittent flag), F4 (sizes above), CU worst case 124,680, crank tx 902 B |

## Could not verify

* Real LaunchLab behaviour (closed source): non-signer creator at `initializeV2`, claim side effects, migration's CPMM `pool_creator`,
  migration pool address/AmmConfig, mint-authority revocation, and which keys hold Raydium CPMM `Permission` PDAs (F5).
* Raydium mainnet CPMM binary equals the pinned source b3187ae5 (offsets, oracle semantics).
* Real-network transaction-size behaviour of v0 + ALT for quorum 4–5.
* Devnet/mainnet deployment state, upgrade authority and verifiable-build hash.

## Prior findings: closed / still open / regressed

Written after the findings above, from `review-claude-blind-2026-10-09.md` and `docs/burn-receipts/CHANGELOG.md`.

| Prior | Status | Evidence |
|---|---|---|
| H-1 sandwich budget = TWAP tolerance; guard optional | **Partly closed, residual open (= F1)** | Guard now mandatory 1–500 bps / 600–1,200 s (`initialize_token.rs:69-70`); 2 % reserve cap + carry (`crank_buyback.rs:141-144`, `math.rs:123-125`); tests pass. Still: `min_out` comes from post-front-run spot, so the sandwich budget per crank is up to the deviation (≤5 %) plus the oracle bucket bias (≈2.3 % at 600 s). The 2 % cap shrinks the absolute amount, not the percentage. |
| H-2 fee inflow not wired | **Closed in code, conditional on LaunchLab** | `claim_launchlab.rs` pins the program, PDAs and recipient and post-checks lamports/WSOL; SDK byte-for-byte test passes. The two e2e tests need `fixtures/launchlab_mock.so`, which is not in the tree (they fail as checked out; they pass after building the mock). LaunchLab's real behaviour remains unverifiable (non-signer creator, migration `pool_creator`, claim side effects: F13). |
| M-1 PlatformConfig hard dependency | **Closed** | `crank_common.rs:40-47` falls back to the hard-coded default; `review_fixes.rs::m1_…` passes. Minor residual F8 (no cap floor; late creation extends the cap regime past 2027-10-01). The test `platform.rs::buyback_needs_the_platform_config` is now stale (F17c). |
| M-2 `max_abs_delta` wedge | **Closed** | `submit_reading.rs:81-87` → `KIND_RESET`; `m2_…` passes; a return trip is also out of bound, so no units can be earned from a bad print. |
| M-3 no program/mint domain separation | **Closed; side effect regressed submission size (see below)** | `attest.rs:28-52`; `m3_…` passes. Cluster still unbound (F12, info). |
| M-4 no rescue for a dead pool | **Closed as designed, with new weaknesses** | `pool_health.rs` exists and `m4_…` passes; but the 7-day clock is not continuous (F6, PoC), replacement trusts `pool_creator` alone (F5), and with no second fee-PDA pool the queue is still wedged (F7). |
| L-1 submission order | **Closed** | `prev=` bound in the message; `l1_…` passes. |
| L-2 full set replacement; implicit admin | **Admin part closed; replacement part still open (= F2)** | `AdminRequired` at `initialize_token.rs:118`. The "keep ≥ quorum current keys" check (`admin.rs:41-42`) lets one proposal give the NEW keys a quorum whenever `5 − q ≥ q` (q ≤ 2): PoC `poc_single_proposal_gives_new_keys_quorum`. |
| L-3 mint authorities unchecked | **Closed** | `require_fixed_supply` at `register_pool.rs:36`, `pool_health.rs:116`, `crank_buyback.rs:92`, `crank_vault.rs:45`; `l3_…` passes. |
| L-4 vault overflow wedge | **Closed** | `initialize_token.rs:82-84`; `settle_vault` saturates (`math.rs:156`). |
| L-5 memo decimals | **Closed** | `memo.ts:38,53` parameterised; TS tests pass (35/35). New client memo issue F9 (pool used for `swap=` after a replacement). |
| L-6 genesis check | **Closed** | `crank.ts:36-41`. |
| L-7 TWAP window liveness | **Closed** | 600–1,200 s enforced; 100 × ≥15 s ring always covers it. |
| I-1 cap semantics / 25 SOL constant | **Closed** (upper bound) | `platform.rs:44`; no lower bound (F8). |
| I-2 overwritten proposals | **Closed** | `admin.rs:53-56`, `platform.rs:85-87`; `i2_…` passes. |
| I-3 error codes / clippy | **Closed** | `ReserveBreached`, `InvalidMemoProgram`; `cargo clippy --lib` clean. |
| I-4 vault fee PDA funded | **Closed** | `initialize_token.rs:81` (`reserve_lamports == 0` in vault mode). |
| I-5 deployment caveats | **Still applies (documented)** | README §5.3 assertions exist; upgrade authority remains the trust root until finalisation (F16). New: `anchor build` reports a program-id/keypair mismatch in this tree (F17d). |
| I-6 slot mask after rotation | **Open by design, documented** | README line 366. |

**Regressions introduced by the fixes**

1. **Quorum-2 submission broke (M-3 + L-1 → F4).** The v2 message grew from ≈204 to 313 bytes (program id, mint, `prev=`). With the
   client's one-message-copy-per-signature layout, a quorum-2 `submit_reading` went from ≈1,126 bytes (fits) to 1,344 bytes (over
   the 1,232-byte limit). The suite did not notice because LiteSVM does not check transaction size.
2. **Test reproducibility.** The H-2 tests depend on an untracked build artefact (`fixtures/launchlab_mock.so`); a clean checkout
   fails 2 of 3 LaunchLab tests and cargo stops before `platform.rs` / `review_fixes.rs`.
3. **Compute claim understated.** CHANGELOG says ≈108k CU for `crank_buyback`; the worst case measured here is 124,680 CU (full
   oracle ring, 9.2e18 units). That is still safe under the client's 400k limit.

**Not regressions, but missed by the first review:** F3 (the 1-lamport WSOL grief: the equality check predates the fixes), F5 (any
CPMM permission holder can create a fee-PDA-creator pool; the first review read `initialize_with_permission` as LaunchLab-only),
and F1's oracle bucket bias.
