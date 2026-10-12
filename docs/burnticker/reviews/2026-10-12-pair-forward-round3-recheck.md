# Winner takes the burn (§40): independent re-check of the round-3 fixes (2026-10-12)

Reviewer: paircheck-1, a fresh Claude agent (no part in writing the pair code). Commit reviewed: **`48b28007`** (branch
`burnticker/paircheck`, cut from `fix/price-integrity-and-engine-correctness`). The compiled program sources are those of **`bc056558`**
(`config/burnticker/verified-build.json` `sourceCommit`; round 3 is `a3a968e5` plus the mainnet pins). Worktree `mct-wt-PAIRCHECK`. No
deploy, no transaction, no key file or env file opened. `anchor build` wrote throwaway program keypairs into the git-ignored
`target/deploy`; they were not read. The only network use was the read-only evidence verifier against the public devnet RPC (section 5).

Inputs: the blind review (`2026-10-11-pair-forward-blind.md`) and the round-2 re-check (`2026-10-11-pair-forward-recheck.md`, open items
M-1, RN-1, RN-2 and the Lows/Infos); `programs/burn_receipts/src/instructions/pair.rs`, `register_pair_pool.rs`, `admin.rs` (attester
changes), `crank_buyback.rs`, `pair_curve.rs`, `state.rs`; pair_curve's `void_pair.rs` / `graduate.rs`; the keeper files
`src/lib/burnticker/pairForward.ts`, `pairForwardChain.ts`, `pairForwardKeeper.ts`, `multiKeeper.ts` (pair steps, `planRuleEnd`),
`src/lib/burnKeeper/pairCurveCrank.ts`, `src/lib/burnReceipts/crank.ts` (`planCrank`), `src/lib/burnticker/pairCurveLaunch.ts`; WHITEPAPER
§5.5, ATTESTERS.md, PAIR-CURVE.md. I formed the findings below from the code first and only then read the round-3 commit messages, the
CHANGELOG and the r3 devnet run log, to avoid re-reporting accepted residuals. None of the new items below is answered there.

## Summary

| Item | Severity | Status | Evidence |
|---|---|---|---|
| RN-1 open pair_curve pair unlinked at day 30, both fee PDAs frozen | High | **CLOSED** | `pair.rs:671-680` (policy 2: only Voided / refunding evidence), `register_pair_pool.rs:57` (accepts UNLINKED); `link_pair` accepts readings (`pair.rs:243-266`) |
| RN-2 LaunchLab pair unpaired at day 30 while both coins are on their curves | Medium | **CLOSED** | `pair.rs:681-688` (only after the locked `pair_void_by` day has ended, with a coin unverified); `pair_void_by` equal on both coins (`pair.rs:161, 175`) |
| M-1 a side's attesters veto its own losses | Medium | **CLOSED at pairing; reopened by a rotation (P3-2)** | one set required at `pair.rs:173, 241`; both quorums every result `pair.rs:357-362`; the residual "whoever holds the common quorum decides" is disclosed (WHITEPAPER §5.5, ATTESTERS.md) and not re-reported |
| RL-1 forwards not adopted | Low | **CLOSED** | `multiKeeper.ts:308-315`, `programAdapter.ts:205` matches `ForwardToWinner` |
| RL-2 unlink / re-link drift | Low | **CLOSED** | `pairCurveCrank.ts:80, 137`; `pairForwardKeeper.ts:234-237` reads the chain and alerts drift |
| RI-1 forward after the 72 h time-out | Info | **CLOSED** | `pair.rs:538` (`ForwardWindowClosed`), boundary identical to the gate `pair.rs:443, 449` |
| RI-2 "a lost period never burns the losing coin" | Info | **CLOSED** | `WHITEPAPER.md:533` |
| RI-3 r2 devnet evidence missing | Info | **CLOSED** | `docs/burnkeeper/devnet-pair-forward-r2-run-log.md`, `evidence/devnet-pair-forward-r2/` exist; verifier PASS (section 5) |
| RI-4 one-shot forward takes the loser's carried spend | Info | **CLOSED** | `pair.rs:558-560`; `pairs::ri4_a_forward_never_takes_the_losers_carried_spend` |
| RI-5 `refunding` offset comment | Info | **CLOSED** | `pair_curve.rs:5-8, 29-32` |
| **P3-1** never-linked pair_curve pair + a refunding side: the graduated side can never register | **Low** | NEW, open | `register_pair_pool.rs:57`, `pair.rs:226, 241, 651-654`; `pairCurveCrank.ts:80, 141`; `pairCurveLaunch.ts:120-128` |
| **P3-2** a co-signed attester rotation splits the pair's one set; the new key vetoes every result | **Low** | NEW, open | `admin.rs:186-200`; claims at `pair.rs:279-282`, `WHITEPAPER.md:523`, `tests/pairs.rs:289-291` |
| **P3-I1** forward_to_winner still lands after unlink_pair (0 lamports), so the now-plain loser skips that period's burn | Info | NEW, open | `pair.rs:522-567` (no pair-state check; `live` only zeroes the amount) |
| **P3-I2** stale "30 days after pairing" text in the public API and docs | Info | NEW, open | `api/spec.ts:246`, `pageTypes.ts:29`, `docs/burnticker/api.md:279`, `pairForwardKeeper.ts:219-221`, `pairCurveCrank.ts:75` |
| **P3-I3** after an unlink, a pending "lost" receipt burns its own coin under a misleading alert | Info | NEW, open | `pairForwardKeeper.ts:210-216`, `multiKeeper.ts:347` |

No Critical, High or Medium is open. Rust: burn_receipts 140/140, pair_curve 62/62 (202, 0 ignored), plus this review's
`review_pair_r3.rs` (2 pass = today's behaviour, 3 `#[ignore]`d that fail today). Keeper pair tests 126/126. Evidence verifier: PASSED.
The local default build reproduces both mainnet hashes in the verified-build table byte for byte.

## 1. Prior items, one by one

**RN-1 (High) CLOSED.** For a pair with a policy-2 coin, `unlink_pair` now requires the Pair account and accepts only `Voided` or a
refunding side (`pair.rs:671-680`); no time-based evidence remains, so an Open or Graduating pair is refused `PairStillLive` at any age.
Both routes to the freeze are closed: (1) an unlinked coin still registers (`register_pair_pool.rs:57` accepts `PAIR_STATE_UNLINKED`,
proved by `review_pc1::pf_r2_half_graduated…` which registers side A after the unlink), and (2) `link_pair` no longer refuses a coin
with readings: the periods already read become unpaired history via `pair_after_date` (`pair.rs:243-266`), with the gate
(`pair.rs:438`) and `submit_pair_result` (`pair.rs:349-352`) using the same boundary. Inverted tests pass:
`pair_curve::review_pair_r2::rn1_an_open_pair_is_never_unlinked_and_both_pools_register`,
`rn1_a_coin_read_before_link_pair_still_links_and_registers`. The keeper mirrors it (`pairForwardChain.ts:109-129`). One adjacent route
remains for a pair that was never linked at all: P3-1.

**RN-2 (Medium) CLOSED.** LaunchLab pairs unlink only when the locked `pair_void_by` day has ended (UTC, `utc_date(now) > void_by`) and
a coin is still unverified (`pair.rs:681-688`). Both coins must name the same date (`pair.rs:175`). The keeper computes the same rule
(`pairForwardChain.ts:126-128`). A pair whose two pools are verified by `voidBy` is permanent. Test:
`burn_receipts::review_pair_r2::rn2_a_launchlab_pair_with_both_coins_on_their_curves_stays_paired_until_its_void_by`. Pre-r3 LaunchLab
links read `pair_void_by = 0` and therefore can never be unlinked (devnet pair 6 only; consistent with "pairs made before keep their
bytes").

**M-1 (Medium) CLOSED at pairing, reopened by rotation.** Pairing now requires one attester set and quorum on both coins
(`pair.rs:173` at the second `initialize_token`, `pair.rs:241` at `link_pair`), every result needs both quorums (`pair.rs:357-362`), and
`apply_attester_change` refuses a paired coin (`admin.rs:135`). With one set, the exact M-1 scenario (a side that signs its wins and
withholds its losses) cannot be played by one side against the other: `review_pair_r2::m1_a_side_cannot_veto_its_losses_while_collecting_its_wins`
passes. The disclosed residual (whoever holds the common quorum decides every result; the operator's keeper at quorum 1 on Burnticker)
is accepted and not re-reported. But the "one set" holds only until the first rotation: P3-2.

**RL-1, RL-2, RI-1 to RI-5: CLOSED** as in the table. RI-1: the forward's window (`now < submitted_at + 72 h`, `pair.rs:538`) and the
gate's time-out (`now >= submitted_at + 72 h`, `pair.rs:443`) meet exactly, with no gap and no overlap; `planCrank` switches on the same
chain-time test (`crank.ts:301-306`) and `forwardLoss` treats `ForwardWindowClosed` as a wait (`pairForwardKeeper.ts:173`).

## 2. New findings

### P3-1 (Low): a pair_curve pair that was never linked freezes its graduated side once the other side refunds

`register_pair_pool` requires `PAIRED` or `UNLINKED` (`register_pair_pool.rs:57`). A policy-2 coin reaches either state only through
`link_pair`, which refuses once the Pair has a refunding side (`pair.rs:226`, `PairTerminal`) and also whenever the two coins' attester
sets differ (`pair.rs:241`, `PairAttestersDiffer`). `unlink_pair` cannot help: it takes both `PairLink` accounts as `Account<PairLink>`
(`pair.rs:651-654`), which do not exist for a never-linked pair. So if `link_pair` has not landed by the time `void_pair` marks side B
refunding (30 days after the commit at the latest, or 3 days when Raydium blocks the pool), side A's graduated pool can never be
registered and the graduation burn escrow in A's fee PDA has no spending instruction. Measured in the test: **0.395 SOL** stuck on a 90
SOL raise.

How it happens in practice: `link_pair` is not in the creator's launch bundle (`pairCurveLaunch.ts:120-128`: mint A + config, mint B +
config, `init_pair`); the keeper sends it later, each cycle, from `crankPairCurves`. The keeper alerts only on `PairTerminal`
(`pairCurveCrank.ts:141`); any other refusal (for example `PairAttestersDiffer` after one coin's set was changed before the link, or a
keeper outage) is a log line, and once a side is refunding `linkPairDue` returns false (`pairCurveCrank.ts:80`), so nothing is even
logged. Who can trigger it: no outsider can stop `link_pair` (it is permissionless), so this is an operational failure mode rather than
an attack; the Low rating reflects that. Who loses: side A's holders (no burns ever) and the escrow.

Fix (any one closes it; the first two are cheap and keeper-only):

1. Put `link_pair` in the launch bundle, in the `init_pair` transaction right after `init_pair` (the Pair exists inside the same
   transaction), so no pair is ever unlinked by construction.
2. `pairCurveCrank.ts:141`: alert on **every** `link_pair` refusal, not only `PairTerminal`, and keep alerting while any side is not
   linked.
3. Program: `register_pair_pool` also accepts `PAIR_STATE_NONE` when the Pair shows the **other** side refunding (the same terminal
   evidence `unlink_pair` accepts), and sets the coin `UNLINKED`.

Failing test (`programs/pair_curve/tests/review_pair_r3.rs`, `#[ignore]`d, fails today with `PairNotLinked`; its twin
`p3_1_still_…` passes and pins today's behaviour):

```rust
#[test]
#[ignore = "P3-1: FAILS today (PairNotLinked); un-ignore with the fix"]
fn p3_1_a_never_linked_pair_with_a_refunding_side_still_registers_the_graduated_side() {
    let mut env = new_env();
    let (p, c, pa, _) = never_linked_half_graduated(&mut env); // init_pair, no link_pair, A graduates, B refunding (void_pair)
    env.ok(&[ix_register_pair(&c.pubkey(), &p.mint(0), &pa.pool, &pa.lp_mint, &p.pair)], &[&c]);
    assert!(env.config(&config_pda(&p.mint(0))).pool_verified);
}
```

### P3-2 (Low): a co-signed attester rotation leaves the pair on two sets, and the new key vetoes every result

`apply_paired_attester_change` (`admin.rs:186-200`) applies **one** coin's pending set once a quorum of the **partner's** current
attesters signs it. Afterwards the two coins hold different sets, and `submit_pair_result` needs both quorums (`pair.rs:357-362`). Any key
that is in only one coin's new quorum therefore holds a veto over every result, including that coin's own losses: it can sign the
periods its coin wins and withhold the ones it loses, which is the M-1 shape again. The code and docs state the opposite: `pair.rs:279-282`
("one set of signatures meets both: no side's attesters can sign its wins and withhold its losses"), `WHITEPAPER.md:523` ("The two coins
share one attester set") and the test comment `tests/pairs.rs:289-291`. ATTESTERS.md:48 tells the operator to "propose the same set on
both and apply each with the other's co-signature", which leaves a window between the two applies, and nothing on chain makes the second
apply happen at all.

Concrete scenario (the test): pair on `[att]` quorum 1. B's admin proposes `[att, rotated]` quorum 2; A's attester `att` co-signs; the
apply lands. A stays on `[att]`, B is on `[att, rotated]`. A draw signed by `att` alone is now refused `QuorumNotMet`; only `att` +
`rotated` together pass. The holder of `rotated`, chosen by B's side alone, now decides whether any result is recorded. Consent came from
A's attesters, not from A's config authority or holders. On Burnticker today every coin uses the operator's one set and rotations are
manual (Squads), so this is Low; it matters as soon as a pair has distinct sets or a second signer is added to one coin only.

Fix: make a paired rotation atomic. `apply_paired_attester_change` takes the partner's config mutably, requires the partner's pending
set and quorum to hash to the same value (and its timelock to have elapsed), and applies both in one instruction, updating both
PairLinks; the partner co-signature can then be dropped (both admins proposed it). Until then: a runbook rule that a paired coin's set
is changed only together with its partner's, and correct the three statements above.

Failing test (`review_pair_r3.rs`, `#[ignore]`d, fails today; `p3_2_still_…` passes and shows the veto):

```rust
#[test]
#[ignore = "P3-2: FAILS today (two sets); un-ignore with the fix"]
fn p3_2_a_co_signed_rotation_keeps_both_coins_on_one_set() {
    let mut env = new_env();
    let (p, _k, _rotated) = rotated_pair(&mut env); // linked pair; B's pending [att, rotated] q2 applied with att's co-signature
    let ha = burn_receipts::instructions::pair::attester_set_hash(&env.config(&config_pda(&p.mint(0))));
    let hb = burn_receipts::instructions::pair::attester_set_hash(&env.config(&config_pda(&p.mint(1))));
    assert_eq!(ha, hb);
}
```

### P3-I1 (Info): a LOST result recorded before an unlink still forwards afterwards

`forward_to_winner` checks no pair state; `live` (`pair.rs:542-545`) only turns the amount to 0. So after `unlink_pair`, anyone holding a
LOST `PairResult` from before the unlink (inside its 72 h window, the loser's reading next in line) can still call it: the now-plain
loser's reading is marked FORWARDED with 0 lamports and that period never burns. Nothing leaves the fee PDA (the fuel serves later
periods), hence Info. Fix: refuse `NotPaired` unless both configs are `PAIRED`; the crank gate already passes UNLINKED coins
(`pair.rs:430`), so nothing can wedge. Failing test `p3_i1_a_result_from_before_an_unlink_no_longer_forwards` in `review_pair_r3.rs`
(`#[ignore]`d; today the forward succeeds with memo `lamports=0`).

### P3-I2 (Info): the removed 30-day evidence is still described to readers

`src/lib/burnticker/api/spec.ts:246` (the public API description of `unpaired`), `src/lib/burnticker/pageTypes.ts:29`,
`docs/burnticker/api.md:279` and the doc comment `pairForwardKeeper.ts:219-221` still list "one coin without a verified pool 30 days after
pairing" as unlink evidence; `pairCurveCrank.ts:75` still says link_pair is refused once either coin has a reading. Fix: the round-3
wording (voided pair curve, a refunding side, or a LaunchLab pair's voidBy ended with a coin unverified).

### P3-I3 (Info): after an unlink, a pending "lost" receipt burns its own coin under a misleading alert

Receipts planned before an unlink keep `pairRole: "lost"` and the note "its fuel for this result moves to $X's burn pool". After the
unlink `pairCtxFor` is inactive, the gate passes the coin, and the keeper cranks the period as a plain buyback (`multiKeeper.ts:347` is
skipped); `forwardMissingAlert` (`pairForwardKeeper.ts:210-216`) then says "no forward landed within 72 hours … PairForwardMissing",
which is not what happened. Funds are correct; the receipt line and alert are not. Fix: when the pair is recorded unlinked, write the
receipt as "burned as a plain coin (the pair was unlinked on <date>)" and skip that alert.

## 3. What I tried that held

- `set_hash` (`pair.rs:81-89`): fixed-width entries (kind byte plus 32-byte key) after the quorum byte, domain-separated; no two distinct
  (quorum, set) pairs collide. Order matters, as documented.
- Rotation while provisional: a pending change queued before pairing must go through `apply_paired_attester_change` once paired
  (`admin.rs:135`); the second coin compares against the first coin's **current** set (`pair.rs:173`).
- `pair_after_date` consistency: gate (`pair.rs:438`, own coin's value and own link's `paired_at`) versus submit (`pair.rs:349-352`, the
  maximum of both): both coins carry the same `pair_after_date` and `paired_at` from `link_pair` / the second `initialize_token`, so the
  two tests select exactly the same periods.
- Forward basis and caps: basis = SOL above the reserve + synced WSOL − `carried_spend_lamports`, then the platform cap (`pair.rs:556-565`).
  The crank's basis differs only in subtracting the carried spend before the cap, which is the RI-4 fix by design.
- `link_pair` after an unlink: refused by the terminal evidence itself (`pair.rs:226`); the keeper never retries an UNLINKED coin.
- End-sink branch (`burnticker/endsink2`, read only): it touches `crank_buyback.rs` (a new end check before the pair gate), `pair.rs`
  (visibility only), `submit_reading.rs`, `initialize_token.rs`, `state.rs` and `multiKeeper.ts` (`planRuleEnd`). Its `PAIR_WINNER` sink
  reads the end date's `PairResult` and requires the partner still paired; I found no conflict with the pair gate, but the pair suites
  must be re-run on the merged tree.

## 4. Tests run

```
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"
cd programs/burn-receipts && anchor build && bash scripts/test.sh
#   burn_receipts 140/140 (11 unit + 13 suites: pairs 24, review_pair 3, review_pair_r2 3, …), pair_curve 62/62 (11 unit, lifecycle 17,
#   review_lock 5, review_pair_r2 2, review_pc1 11, review_pc2 9, review_pc3 7); 0 ignored. (Without `anchor build` first,
#   integration::the_idl_has_no_withdraw_close_or_sweep_instruction fails on a fresh checkout: target/idl is missing. Not a finding.)
cargo test -p pair_curve --test review_pair_r3 -- --include-ignored --test-threads=1
#   p3_1_still_… ok · p3_2_still_… ok · p3_1_a_never_linked_… FAILED (PairNotLinked) · p3_2_a_co_signed_… FAILED (hashes differ)
#   · p3_i2_a_result_from_before_an_unlink_… FAILED (the forward lands, memo lamports=0)
node --import ./test/alias-hook.mjs --test test/burnReceiptsPairs.test.ts test/burntickerPairForward.test.ts \
  test/burntickerPairLaunch.test.ts test/burntickerPairs.test.ts test/pairCurveClient.test.ts test/pairCurveLaunch.test.ts   # 81/81
node --import ./test/alias-hook.mjs --test test/burntickerKeeper.test.ts test/burnKeeperProgram.test.ts                    # 45/45
```

Verified build: the default (mainnet) build here gives burn_receipts `e64a2759…dc19` (763,536 bytes) and pair_curve `50bf5732…b3ef`
(411,296 bytes), equal to `config/burnticker/verified-build.json`. Mainnet already runs the round-3 pair code, so every program fix
above needs a program upgrade.

## 5. Devnet evidence verifier (read-only)

```
node scripts/ops/verify-evidence-signatures.mjs \
  docs/burnkeeper/devnet-pair-forward-run-log-2026-10-11.md docs/burnkeeper/evidence/devnet-pair-forward-2026-10-11 \
  docs/burnkeeper/devnet-pair-forward-r2-run-log.md docs/burnkeeper/evidence/devnet-pair-forward-r2 \
  docs/burnkeeper/devnet-pair-forward-r3-run-log.md docs/burnkeeper/evidence/devnet-pair-forward-r3
```

Result: 90 files, 72 distinct 86-88 character base58 tokens (148 occurrences); 72/72 decode to 64 bytes and are confirmed devnet
transactions (0 via getTransaction, 0 with a program error); 87 evidence files, 66 JSON parsed, 0 key-shaped values. **PASSED.** The r3
`onchain-verify.log` hashes (`90bd47e6…`, `ae947d59…`) equal the table's devnet rows.

## 6. Go / no-go for `BURNTICKER_PAIR_CURVE_ENABLED=1` on mainnet (after `burnticker/endsink2` lands)

**Conditional GO.** No Critical, High or Medium finding is open in the pair-forward code: RN-1, RN-2 and the round-2 Lows and Infos are
closed with passing tests, and M-1 is closed at pairing with its disclosed residual. The flag turns on the keeper's pair-curve crank
(link, graduate, register, lock, void for every Pair) and makes paired launch types available once creator launches open. What must
happen first: (1) merge `burnticker/endsink2`, run `anchor build && scripts/test.sh` plus the keeper pair tests on the merged tree (all
green, `review_pair_r3` still showing only its three ignored failures), and confirm the upgraded mainnet bytes match the new
verified-build table as read back from chain; (2) close P3-1 operationally before the first mainnet pair: put `link_pair` in the launch
bundle's `init_pair` transaction and alert on every `link_pair` refusal (`pairCurveCrank.ts:141`), and check after each new mainnet pair
that both coins read `pair_state = 2` before the curve fills; (3) adopt the P3-2 runbook rule (a paired coin's attesters change only
together with its partner's) and correct the three "one set" statements. Strongly recommended, not blocking: ship the P3-1 program fix
(register on the partner's refunding evidence), the atomic paired rotation (P3-2) and the P3-I1 `NotPaired` check in the same program
upgrade as the end sinks, so the mainnet program never needs a pair-only upgrade later, and fix the stale API text (P3-I2) before the
API describes pairs to the public.

## 6. Responses (branch burnticker/endsink2, program round 4; ships in the same Squads upgrade as the end sinks)

- **P3-1 fixed.** Program: `register_pair_pool` also admits a coin in `PAIR_STATE_NONE` when the Pair it already loads shows the OTHER
  side refunding (the terminal evidence `unlink_pair` accepts), and records it `UNLINKED` (`pair_unlinked_at` = now): it registers and
  burns as a plain coin. Chosen over an unlink without PairLinks because it adds no accounts, closes nothing, and reads the evidence
  where the Pair is already owner-, PDA- and mint-checked. Keeper: `link_pair` rides in the `init_pair` transaction
  (`pairCurveLaunch.ts`; the bundle's tx 3 is now init_pair + link_pair, 683 B as v0 with the table), and every `link_pair` refusal
  raises `pair-link-refused` (`pairCurveCrank.ts`). `p3_1_a_never_linked_pair_with_a_refunding_side_still_registers_the_graduated_side`
  passes; the "still" twin was replaced by `p3_1_a_never_linked_coin_registers_only_on_terminal_evidence_and_becomes_unlinked`.
- **P3-2 fixed.** `apply_paired_attester_change` applies the one pending set to BOTH coins in the same instruction (kept keys keep their
  membership date on each coin; the partner's own pending proposal is replaced; the partner's quorum may not drop) and writes it to both
  PairLinks; it now takes the partner's PairLink. `p3_2_a_co_signed_rotation_keeps_both_coins_on_one_set` passes; the "still" twin now
  pins the fixed behaviour (both coins need the new common quorum). The "one set" statements (pair.rs, WHITEPAPER §5.5, ATTESTERS.md)
  now say how a rotation lands on both.
- **P3-I1 fixed.** `forward_to_winner` refuses `NotPaired` unless both coins are PAIRED; the crank gate already passes UNLINKED coins.
  `p3_i1_a_result_from_before_an_unlink_no_longer_forwards` passes; the keeper's fake refuses the same way.
- **P3-I2 fixed.** The round-3 unlink evidence wording in `api/spec.ts`, `pageTypes.ts`, `docs/burnticker/api.md`,
  `pairForwardKeeper.ts` and the `pairCurveCrank.ts` comment.
- **P3-I3 fixed (the alert).** `forwardMissingAlert` raises nothing for a pair recorded unlinked and logs "burned as a plain coin (the pair
  was unlinked on <date>)". The planned receipt's note still names the forward (open, cosmetic).
- Rust: `scripts/test.sh` green with the three tests un-ignored.
