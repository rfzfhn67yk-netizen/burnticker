# Winner takes the burn (§40) — independent re-check of the round-2 fixes (2026-10-11)

Commit reviewed: **`9d81ee5e`** (`fix/price-integrity-and-engine-correctness`, the merge of `burnticker/pair-forward-r2-ts`). Program
sources are those of **`6fc15f00`** (round 2: `bfe3bfd6` → `6fc15f00`; devnet upgrade + verified-build table `15f5b712`);
`git diff 6fc15f00 9d81ee5e -- programs/burn-receipts/programs/*/src` is empty. Worktree `mct-wt-RECHECK-PAIR`, branch
`burnticker/recheck-pair`. Read-only on program source: no key or `.env*` file opened, no RPC call, no transaction sent. (`anchor build`
and `cargo build-sbf` wrote throwaway program keypairs into git-ignored output folders; they were not read and were deleted from the
scratch folder.)

Inputs: the blind review `2026-10-11-pair-forward-blind.md` and its suite `tests/review_pair.rs` (now inverted), the round-2 diff of
`pair.rs` / `crank_buyback.rs` / `initialize_token.rs` / `state.rs` / `pair_curve.rs`, `tests/pairs.rs` (r2 tests),
`programs/pair_curve/tests/review_pc1.rs` (`pf_r2_…`), the WHITEPAPER §5.5 / ATTESTERS / checklist errata, and the keeper files
`src/lib/burnticker/pairForwardChain.ts`, `pairForwardKeeper.ts`, `multiKeeper.ts` (pair steps), `src/lib/burnReceipts/crank.ts`
(`planCrank`), `src/lib/burnKeeper/pairCurveCrank.ts`, `programAdapter.ts`.

New tests (this re-check):

- `programs/burn-receipts/programs/pair_curve/tests/review_pair_r2.rs` — the High (it needs a pair_curve Pair, so it lives with the
  pair_curve harness, copied verbatim from `review_pc1.rs`): `rn1_an_open_pair_unlinked_after_30_days_must_still_register_both_pools`
  (**`#[ignore]`d, FAILS today**, asserts the safe behaviour) and `rn1_still_…_freezes_both_fee_pdas` (passes, today's behaviour).
- `programs/burn-receipts/programs/burn_receipts/tests/review_pair_r2.rs` — three tests that assert today's behaviour (pass): the M-1
  residual, RN-2, RI-1. Names containing `still` must be inverted when the residual is fixed.

**Baseline at `9d81ee5e`:** `anchor build` then `bash scripts/test.sh` — green. burn_receipts 132/132 (11 unit + 13 suites, incl.
`review_pair` 3/3 and `pairs` 19/19); pair_curve 60/60 (11 unit, `lifecycle` 17, `review_lock` 5, `review_pc1` 11, `review_pc2` 9,
`review_pc3` 7). `REVIEW_LOCK_SO` was **not** set (getting Raydium's lock binary needs an RPC dump; not done).

## Verdict

Every blind-review scenario I was asked to re-run is closed except **M-1**, whose exact scenario still reproduces (round 2 moved the veto
to the losing side on purpose and pinned the attester set against rotation, but a side whose attesters never sign its losses still
burns its own fuel after 72 h while collecting its wins; this is not disclosed). **H-1 is closed** three ways (refused at submit,
0-lamport forward, 72 h LOST time-out) and I found no remaining wedge of a loser's queue.

The fixes opened **one High**: `unlink_pair`'s "no verified pool 30 days after pairing" evidence counts from the **pairing**, which for a
pair_curve pair is `link_pair` right after `init_pair` — but a curve may stay open up to 90 days. Thirty days into a healthy open curve
anyone (and the keeper's own `pairUnlinkStep`) can unlink; `link_pair` then refuses to re-pair once either coin has a reading, and
`register_pair_pool` requires `PAIRED`, so **neither side can ever register its pool**: both burn engines never start and both fee PDAs
(already holding the graduation burn escrow) are frozen with no withdraw path. Same root cause, Medium for LaunchLab pairs: a pair whose
two coins are simply still on their curves is unpaired for good at day 30, contradicting rules whose `voidBy` is later. Two keeper Lows
and five Infos below. Devnet: the verified-build table reproduces exactly from source on this toolchain; the round-2 devnet upgrade itself
has **no committed evidence** (the run log the table cites does not exist).

## 1. Finding-by-finding

| Finding | Status | Evidence (file:line at `9d81ee5e`) | Proving test |
|---|---|---|---|
| **H-1** a result the winner cannot serve wedges the loser forever | **CLOSED** | (a) a WIN needs both readings for the date and the loser's unprocessed (`pair.rs:337-347`); (b) `forward_to_winner` takes no winner reading and moves 0 lamports when either side is not live, still processing the loser's reading (`pair.rs:504-507, 526, 558-568`); (c) LOST times out 72 h after the loser's reading (`pair.rs:408, 414`), `PairForwardMissing` emitted (`crank_buyback.rs:392-396`). No other non-timing-out refusal remains in `crank_pair_gate` for a well-formed paired coin; `forward_to_winner`'s other preconditions are recoverable (winner WSOL ATA: anyone creates it) or covered by (c) | `review_pair::h1a_…`, `h1b_…` (inverted, pass); `pairs::h1a_a_win_is_recorded_only_when…`, `h1b_a_dead_side…`, `h1c_a_lost_period…`; `review_pc1::pf_r2_half_graduated…` |
| **M-1** each side's attesters veto their own losses | **OPEN** (by design since r2; undisclosed) | A WIN needs the **loser's** quorum (`pair.rs:325-331`), so the exact scenario — the losing side never signs, burns its own fuel at 72 h (`pair.rs:419-421`), still collects wins signed by the partner — is unchanged. What r2 did fix: the winner's (pointless) veto is gone, and a loser that rotated its set since pairing needs the partner's co-signature (`PairLink.attester_set_hash`, `pair.rs:79-87, 329-331`; zero on pre-r2 links → always co-sign). The whitepaper/ATTESTERS describe the rule but not the consequence ("winner takes the burn holds only while the losing side's attesters sign") | `review_pair_r2::m1_still_the_losing_sides_attesters_veto_its_losses_while_it_collects_its_wins` (passes = residual); `pairs::m1_a_loser_that_rotated…` (pin) |
| **M-2** pairing forever, even with a dead partner | **CLOSED for dead pools; residual accepted** | `unlink_pair` on Voided / refunding / not-verified-30-days evidence (`pair.rs:618-645`). A partner whose pool stays verified but whose rule ended or whose attesters are gone has no on-chain end state: each period then waits 72 h (written in the doc comment, `pair.rs:597`). The H-1(a) reading requirement means such a partner can never *receive* fuel (no winner reading → no win), so no fuel is lost. **But the new evidence over-reaches — RN-1 / RN-2** | `pairs::m2_unlink_pair_on_evidence…`; `review_pc1::pf_r2_…` |
| **L-1** `link_pair` retroactive and permissionless | **CLOSED** | refused once either coin has a reading (`pair.rs:209`), after the idempotent early return (`pair.rs:202-208`), so already-linked devnet pair 6 is unaffected. Residual (devnet only): a pre-§40 pair registered but not yet read could still be flipped | `review_pc1::pf_r2_…` (PairHasReadings) |
| **L-2** results for meaningless periods | **CLOSED** | date ≥ the later `paired_at` (`pair.rs:312-313`); a WIN needs both readings and an unprocessed loser reading (`pair.rs:337-347`). A draw may still name a date neither coin read (needs both quorums; harmless). Note: the LOST time-out now produces by design the state L-2 wanted to avoid — a LOST PairResult with `forwarded = false` beside a BURNED reading — flagged by the `PairForwardMissing` event | `pairs::h1a_…` (PairDateBeforePairing, NotServable), `pairs::without_a_result…` |
| **L-3** mutual naming without partner accounts | **CLOSED** | `partner_link` mandatory with `pair_mint` and address-checked; a link naming this mint requires `partner_config` (`pair.rs:143-151`) | `pairs::l3_the_second_coin_must_complete_the_pairing` |
| **L-4** WSOL basis differs from the crank's | **CLOSED** | basis = lamports − rent of the native account (`pair.rs:475-484, 514`); `sync_native` before the WSOL transfer (`pair.rs:544`) | `pairs::l4_unsynced_wsol_counts_in_the_forward_basis` |
| **I-2** re-submission returns before any signature check | **CLOSED** | signatures counted before the idempotent return (`pair.rs:315-336`) | `pairs::a_win_needs_the_losers_quorum…` (repeat with the winner's key alone → QuorumNotMet) |
| **I-4** keeper comment "no memo under the floor" | **CLOSED** | `pairForwardChain.ts:174`; the program writes the memo every time (`pair.rs:555-556`) | `pairs::h1b_a_dead_side…` (`lamports=0` memo) |
| **I-5** `planCrank`'s forward plan omits the winner WSOL ATA | **CLOSED** | `crank.ts:306-317` adds `createAtaIdempotentIx` for the winner fee PDA before `forward_to_winner` | inspection |
| I-1 / I-3 / I-6 / I-7 | unchanged / as documented | I-1 superseded by §3 below; I-3 still a plain `emit!` (documented); I-6 now stated in the whitepaper ("pairing is deliberately not part of a coin's rules hash"); I-7: `PairLink.reserved[32]` → `attester_set_hash[32]`, size unchanged, pre-r2 links read zero (fail-safe) | — |

## 2. New findings

| # | Sev | Title | Where |
|---|---|---|---|
| RN-1 | **High** | An open pair_curve pair can be unlinked 30 days after `link_pair`; after any reading it can never re-link, and `register_pair_pool` needs `PAIRED` → both pools unregistrable, both fee PDAs frozen | `pair.rs:633-639`, `pair.rs:209`, `register_pair_pool.rs:56`; keeper `pairForwardKeeper.ts:202-237`, `pairForwardChain.ts:102-118` |
| RN-2 | Medium | Same evidence on LaunchLab pairs: a pair whose coins are both still on their curves is unpaired for good at day 30 (no re-link path), by anyone and by the keeper itself, even when its locked `voidBy` is later | `pair.rs:633-639`; `launchBundle.ts:240`, `electionPair.ts:65`; `pairForwardKeeper.ts:202-237` |
| RL-1 | Low | The keeper never adopts a `forward_to_winner` it did not just confirm (another cranker's forward, a forward that won the 72 h race, or its own forward with a lost confirmation): that period's receipts stay "processed on chain; its crank transaction is not found yet" forever | `programAdapter.ts:166-174`, `multiKeeper.ts:283-290`, `programChain.ts:153-156` |
| RL-2 | Low | `pairCurveCrank.linkPairDue` re-links a pair unlinked on refunding / not-live evidence (only Voided is excluded) whenever neither coin has a reading, while `pairUnlinkStep` has recorded the pair unlinked and never looks at it again → chain PAIRED, pages "unpaired (reason)"; a third party can then flip it back and forth | `pairCurveCrank.ts:69-74`, `pairForwardKeeper.ts:206` |
| RI-1 | Info | The 72 h time-out does not end the forward window: `forward_to_winner` has no time check, so after the time-out it races the paired buyback; the docs and alerts say the period "can no longer forward" | `pair.rs:486-507`; `WHITEPAPER.md:481`, `pairForwardKeeper.ts:93` |
| RI-2 | Info | WHITEPAPER: "a lost period never burns the losing coin" — `PairForwardMissing` does exactly that, and against a dead winner the kept fuel later burns the losing coin on its own readings | `WHITEPAPER.md:476` |
| RI-3 | Info | The round-2 devnet upgrade (vault tx 13–16, current table rows) has no committed evidence: `VERIFIED-BUILD.md` cites `docs/burnkeeper/devnet-pair-forward-r2-run-log.md` and the pair-7 rules cite `docs/burnkeeper/evidence/devnet-pair-forward-r2/`; neither exists on any branch | `VERIFIED-BUILD.md:36`, `config/burnkeeper/paircurve-devnet-7{a,b}.rules.json` |
| RI-4 | Info | A forward's basis is the whole spendable pool, so on a one-shot (f = 100 %) it also takes lamports the loser still owes its own earlier periods (`carried_spend_lamports`), which then stay owed but unfunded | `pair.rs:518-526` vs `crank_buyback.rs:155-156` |
| RI-5 | Info | `pair_curve.rs:5, 27` say the `refunding` offset 880 is pinned by `lifecycle.rs`; it is pinned only by `review_pc1::pf_r2_…` (and pair_curve's `state::offsets` does not list it). Value checked: 880 is correct for the 946-byte layout | `src/pair_curve.rs:27`, `pair_curve/src/state.rs:117-127` |

### RN-1 (High) — an open pair_curve pair unlinked at day 30 freezes both coins

`unlink_pair`'s third evidence is "one coin has no verified pool `PAIR_UNLINK_NOT_LIVE_SECS` after the pairing"
(`since = max(paired_at, created_at)`, `one_dead = !a.pool_verified || !b.pool_verified`, `pair.rs:633-639`). For a pair_curve pair the
pairing is `link_pair`, which the keeper runs right after `init_pair` (`pairCurveCrank.ts` header) — before the curve opens. pair_curve
accepts a deadline up to `MAX_DURATION_SECS` = 90 days (`pair_curve/src/constants.rs:82`; the client's `pricing.ts:34` too), and both
pools are unverified until the pair commits and graduates. So from day 30 of any curve longer than 30 days, anyone can unlink a healthy,
open pair with no evidence account. The keeper does it itself: `pairUnlinkStep` → `unlinkEvidence` computes the same rule
(`pairForwardChain.ts:116-118`) and sends `unlink_pair` every cycle it holds.

After the unlink both configs are `PAIR_STATE_NONE` and both PairLinks are closed. Recovery needs `link_pair`, which since L-1 refuses
if **either** coin has a reading (`pair.rs:209`). `register_pair_pool` requires `pair_state == PAIRED` (`register_pair_pool.rs:56`).
So if either coin has any reading — the baseline the keeper attests when a coin's first receipt settles is enough; nothing on chain ties
readings to a registered pool (`submit_reading.rs` has no pool check) — then when the pair later commits and graduates:

- `graduate` still runs (pair_curve does not read burn_receipts' pairing) and pays each side's burn escrow into its fee PDA;
- `register_pair_pool` refuses both sides forever (`PairNotLinked`); `crank_buyback` refuses an unverified pool (`crank_buyback.rs:115`);
  `forward_to_winner` needs a PairResult, which needs PairLinks; the admin's stranding switch cannot use the pair's pools (policy 0
  needs a LaunchLab-migrated pool, policy 1 a pool whose `pool_creator` is the fee PDA, `admin.rs:296`, `register_pool.rs:80`; the pair's
  pools are created by the pair vault) — its only theoretical exit is a brand-new pool with the fee PDA as creator, which only a Raydium
  Permission-PDA holder can make, and only while the pre-audit cap is in force. No withdraw path exists. The locked LP's
  fees are unclaimable too (`claim_lock_fees` needs `pool_verified`, `lock_fees.rs:143-147`).

Reproduced (`rn1_still_…`): 60-day curve, coin A reads once (baseline), `unlink_pair` at link + 30 days is accepted (`UNLINK_NOT_LIVE`)
while the Pair is Open and before its deadline; `link_pair` → `PairHasReadings`; after commit + graduation + `lock_lp`,
`register_pair_pool` → `PairNotLinked` for both sides with **0.375 SOL and 0.301 SOL** of escrow (a 90 SOL raise) frozen in the two fee
PDAs. The `#[ignore]`d `rn1_an_open_pair_unlinked_after_30_days_must_still_register_both_pools` fails at `PairNotLinked`.

Second route, same root (no unlink needed): a policy-2 coin that is read before `link_pair` ever lands can never be linked, so neither
coin can ever register. Today only keeper ordering prevents it (§3).

Who triggers it: anyone after day 30 of a longer curve, or the operator's own keeper; no signature, no cost beyond a fee. Who loses: both
coins' holders (no burn ever) and the fuel in both fee PDAs.

Fix (either closes it; the first is smallest):

- `unlink_pair` NOT_LIVE for a policy-2 coin: require pair_curve evidence instead of time — never while the Pair is Open (Voided and
  refunding already cover the dead cases; pair_curve's own `GRADUATION_FALLBACK_SECS` / `LP_LOCK_FALLBACK_SECS` resolve the rest); for all
  policies measure the 30 days from the **other** side's `pool_verified` (record a `pool_verified_at`), not from the pairing, and require
  that side to be verified.
- `register_pair_pool`: accept a coin whose pairing was undone (e.g. keep a closed-pair marker, or accept `PAIR_STATE_NONE` when the
  config never had a PairLink re-created), so an unlinked policy-2 coin can still register and burn as a plain coin. And/or let `link_pair`
  re-link a pair whose two coins have no **processed** burn yet.

### RN-2 (Medium) — LaunchLab pairs unpaired for good while both coins are still on their curves

Same rule, policy 0/1. The pairing is at `initialize_token`, i.e. at launch; LaunchLab curves have no deadline. At day 30, if either coin
has not graduated — including when **neither** has — anyone may unlink (`rn2_still_…`: both coins unverified, a stranger unlinks, both
later graduate and register normally, `pair_state` stays NONE, no result can be recorded, the loser burns its own supply). For policy 0/1
there is no re-link path (`initialize_token` runs once; `link_pair` is policy-2 only, `pair.rs:199-201`).

This contradicts locked rules: the both-or-neither clause keeps a pair alive until its `voidBy` ends, and `voidBy` is not 30 days in
general — an election pair's is the race's settlement date (`electionPair.ts:65`), a one-shot's its first settlement date; even the
default (`launchBundle.ts:240`, the UTC date 30 days after launch, ending at that date's midnight) ends up to ~24 h **after**
`paired_at + 30 d`. The keeper's `pairUnlinkStep` sends the unlink regardless of `voidBy`, so in those windows the operator itself turns a
pair that the rules (and the keeper's own pair gate, `multiKeeper.ts:478-499`) consider live into two plain coins; the winner's holders
lose every forward the rules promise. No SOL leaves a fee PDA (each coin burns its own), hence Medium.

Fix: the RN-1 evidence change (require the other side verified, and count from its verification); keeper: never unlink before the rules'
`voidBy` has ended, and treat UNLINK_NOT_LIVE as a rules-level void, not a 30-day timer.

### RL-1 (Low) — forwards the keeper did not just confirm are never adopted

The adopt step re-reads processed readings and looks for the transaction with `resolveSent(…, "crank:<date>")` then `findCrankTx`
(`multiKeeper.ts:283-290`); `findCrankTx` matches only `Instruction: Crank(Buyback|Vault|NoUnits)` (`programAdapter.ts:170`), and the
keeper's forwards are write-ahead under `forward:<date>`, which only `forwardLoss` re-checks — and `forwardLoss` is reached only while
`planCrank` still plans that reading, i.e. never once it is processed. So a forward sent by another cranker (permissionless once the
allowlist lapses; more likely now that 0-lamport forwards and the post-time-out race exist) or the keeper's own forward whose confirmation
expired leaves the period's receipts held forever. Funds are unaffected. Fix: adopt `forward:<date>` signatures and match
`Instruction: ForwardToWinner` (memo `|forward|`) in `findCrankTx` (and the fake program's).

### RL-2 (Low) — unlink / re-link drift in the keeper

`linkPairDue` returns true for any non-Voided Pair whose links do not name each other (`pairCurveCrank.ts:69-74`). After an unlink on
refunding or not-live evidence, if neither coin has read yet, the next pair-curve crank re-links the pair; `pairUnlinkStep` skips any pair
it has recorded as unlinked (`pairForwardKeeper.ts:206`), so the registry, pages and API say "unpaired (reason)" while the chain is PAIRED,
and a third party can unlink again (the evidence still holds) — a tug of war with no funds at stake. Fix: `linkPairDue` false when a side
is refunding or the registry records an unlink; `pairUnlinkStep` re-reads the chain instead of trusting its record.

## 3. Attacks on the fixes (what I tried, and what stopped it)

**No-pool win + 0-lamport forward.**
- *Marked FORWARDED but the fuel then burns elsewhere?* Yes, by design, in one case: against a non-live side the reading is FORWARDED with
  `rule_spend_lamports = 0` and the fuel stays in the loser's pool, where the loser's later cranks spend it on the loser's own coin
  (RI-2 wording). Nothing is lost: the lamports never leave the loser's fee PDA. `live` is computed at forward time from `pool_verified` +
  `pair_state` of both configs (`pair.rs:504-507`); no outsider can flip either (only `apply_registration_policy` clears `pool_verified`,
  and only for a pool untradeable ≥ 7 days while the cap is in force, `admin.rs:174-177`; `pair_state` only by `unlink_pair`, whose
  evidence already implies `!live`).
- *A win for a period the loser's rule did not fire?* Recordable (the loser's reading may have 0 units if it was not next in line, or be a
  RESET); the forward then moves `buyback_spend(pool, 0, f) = 0`. A 0-unit reading that is next in line is auto-processed at submit
  (`submit_reading.rs:118-126`), so no win can even be recorded for it. Harmless either way.
- *`units` on a FORWARDED reading:* informational. `config.carry` (sub-unit remainder) was settled at submit; `carried_spend_lamports` is
  untouched; the cursor advances (`pair.rs:568`). The amount actually moved is `rule_spend_lamports` (0 when not live — the counterfactual
  is not kept; receipts read "forwarded 0 SOL"). On one-shots see RI-4.
- *The winner must have read the date.* A winner whose attesters never read can never receive fuel (H-1(a)); the loser then times out
  and burns its own — the winner only hurts itself.

**LOST time-out.**
- *Can an attacker delay a forward 72 h and make the loser burn itself?* The cheap way is the loser's own attesters withholding the
  result (M-1 residual) — no time-out needed. Delaying a recorded forward requires blocking `require_next_in_line`: an earlier reading of
  the loser that cannot crank (e.g. sustained TWAP deviation on the loser's own pool) holds the forward and, once processed, leaves the
  LOST period past its time-out; costly and only the loser's holders benefit. During the cranker allowlist (≤ 90 days) only listed
  crankers can forward or crank at all.
- *Whose timestamp?* `Reading.submitted_at` of the **loser's** reading (the program clock when it was submitted, `submit_reading.rs:108`).
  The loser's submitter can only make it later (more time), never earlier. The 72 h is shared by the result and the forward (the result's
  own time is not used), so a late result leaves a short forward window.
- After the time-out the forward is still accepted (RI-1); the keeper's `planCrank` deliberately switches to the buyback
  (`crank.ts:301-305`), so the operator itself never forwards late.

**Loser's quorum only.**
- *Forward fuel to a winner that did not win?* Yes — the losing side's attesters are the authority; the program cannot know who won. It
  can only hurt the loser's own holders.
- *A winner that is not the partner?* `winner ∈ {mint_lo, mint_hi}` (`pair.rs:309`), the two configs paired to each other
  (`pair.rs:283-286, 305`), the PairResult PDA derived from both mints; `forward_to_winner` re-derives it from (loser, winner, date)
  (`pair.rs:491-494`). No route found.
- *Rotation.* Any change of the set (key, kind, order or quorum) changes the hash and requires the winner's quorum
  (`pair.rs:329-331`) — I checked rotations through `apply_attester_change`'s constraints (quorum never lowered, ≥ quorum keys kept). A
  rotation **back** to the exact pinned set restores loser-only signing; that is the set both sides accepted at pairing, so I do not count
  it as a hole. A coin whose set changed before its partner answered (provisional window, 7 days ≥ the 48 h timelock) starts with a
  mismatched hash and always needs the co-signature (fail-safe). Where both coins share the operator's keys (Burnticker's own flow) the
  pin adds no independence; it matters only for distinct sets. A two-key win needs a v0 transaction; the keeper supports it only when a
  lookup table is configured (`buildSizedTransaction`, `crank.ts:182`).

**`unlink_pair`.**
- *False evidence / someone else's Pair?* `PairView::load` checks owner, discriminator, length and PDA; both mints must be the Pair's
  (`pair.rs:624-626`); LaunchLab mints cannot be inside a pair_curve Pair. `refunding` is read at offset 880 only when the account is
  ≥ 882 bytes (pre-946-byte Pairs read false) — correct for the current layout. Voided and refunding are terminal in pair_curve.
- *"No verified pool 30 days after pairing" when the coin simply has not graduated:* **RN-1 / RN-2.**
- *Strands fuel / breaks `register_pair_pool`?* Policy 2 with any reading: yes (RN-1). Policy 0/1: `register_pool` does not read the
  pairing, so no stranding — the pairing is just gone (RN-2).
- *Re-linking?* Policy 2 only, and only with zero readings on both coins (then the 30 days restart from the new `paired_at`). Old
  PairResults stay; new ones need dates on/after the re-link day.
- Link rent goes to each coin's own fee PDA (burn fuel), never back to whoever paid it.

**`link_pair` "no readings" vs devnet.** Pair 6 (linked under r1 with readings) hits the idempotent early return and is unaffected; its
links carry a zero `attester_set_hash`, so every win there needs both quorums — on devnet one keeper key sits in both sets and one
signature counts for both. Pair 3 (pair_curve, registered before §40) can never be linked now; the keeper's `linkPairDue` will try and
alert `pair-link-refused` (deduplicated) every cycle. Consistent with "pairs made before keep their bytes".

**Mandatory `partner_link`.** A program-owned PairLink at `["pair_link", mintB]` can only be written by B's own `initialize_token` (B's
mint signs) or by `link_pair` with a pair_curve Pair holding B; a system-owned pre-funding is absorbed by `create_pda` (`pair.rs:42-60`).
Another coin naming B creates *its own* link, not B's, so B's launch cannot be griefed. Rent is paid by the initializer's payer and is
only ever released by `unlink_pair`, into the coin's fee PDA. Operational note: if the partner's link names B but its 7-day window has
closed, B's `initialize_token` naming it reverts (`PairingClosed`) — a launch bundle built that way fails as a whole.

### Keeper-side invariants enforced only off-chain (updated)

| The program would misbehave if… | Where the keeper prevents it | Gap |
|---|---|---|
| a policy-2 coin is read before `link_pair` (it can then never link nor register) | `link_pair` "right after init_pair, first" (`pairCurveCrank.ts`) | ordering only; same freeze as RN-1 |
| a pair is unlinked while its curve(s) are still running | — | the keeper's own `pairUnlinkStep` does it (RN-1/RN-2) |
| a forward lands that the keeper did not just confirm | — | RL-1 |
| an unlinked pair is re-linked | `linkPairDue` excludes Voided only | RL-2 |
| the 72 h window is spent before the result is posted | results and forwards in the same cycle; `pair-forward-pending` at 1 h | alert only |
| the winner's reading for D is missing | flat 0-unit winner reading before the result (`multiKeeper.ts:641-660`) | the result is refused on chain otherwise (no longer a wedge) |

## 4. Devnet evidence and the verified build (no RPC)

- **Verified-build table vs source.** I rebuilt both programs from this commit with `cargo-build-sbf` 4.4.0 / Solana CLI 4.3.0 /
  platform-tools v1.57 on macOS arm64 — the table's stated toolchain — default features (mainnet) and `--features devnet`, and computed
  the table's executable hash (sha256 of the `.so` with trailing zero bytes removed, as `scripts/ops/verified-build.sh` and solana-verify
  define it). All four equal the table byte for byte: burn_receipts mainnet `2eb83584…` (749,552 B), devnet `5a2d1600…` (749,736 B);
  pair_curve mainnet `82310a2d…` (410,008 B), devnet `96b8d79c…` (410,064 B). `sourceCommit 6fc15f00` is right: no compiled source
  changed after it. Feature sets match the table (`[]` / `["devnet"]`). I did **not** read the deployed programs back, so
  `deployed.devnet.matchesBuild` is taken on trust.
- **The round-2 upgrade has no evidence in the repo (RI-3).** `docs/burnkeeper/evidence/devnet-pair-forward-2026-10-11/` documents the
  **r1** upgrade (vault tx 11/12, buffer executable hashes `b23df8fa…` / `f8c515cd…`, which are the table's "previous builds" rows) and the
  pair-6 forward. The r2 upgrade (vault tx 13/14 intermediate, 15/16 current) is asserted in `VERIFIED-BUILD.md` and the commit message
  only; the cited run log and evidence folder do not exist on any branch or worktree I checked.
- **r1 evidence consistency.** `squads-upgrade-burn_receipts.json`: buffer executable hash = table hash = `b23df8fa…`, buffer authority =
  program upgrade authority = vault `A8VV…MqffD`, spill a member, `codeBytes` 729,217 vs table 729,232 B (the 15 stripped trailing zeros);
  pair_curve likewise `f8c515cd…`. The run log's §U lists the same hashes. Signatures were not checked on chain.
- The CHANGELOG "publish" tags' `program hash 869a6b9c…` are plain file sha256s of pre-r2 builds (`701655de`, `a348eef0` predate
  `6fc15f00`) — a different definition from the table's executable hash; worth one sentence where both appear.

## 5. Tests run

```
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"
cd programs/burn-receipts && anchor build && bash scripts/test.sh            # green: burn_receipts 132/132, pair_curve 60/60
cargo test -p burn_receipts --test review_pair -- --include-ignored --test-threads=1     # 3/3 (inverted blind-review suite)
cargo test -p burn_receipts --test review_pair_r2 -- --test-threads=1 --nocapture        # 3/3 (current behaviour)
cargo test -p pair_curve --test review_pair_r2 -- --include-ignored --test-threads=1 --nocapture
#   rn1_still_an_open_pair_unlinked_after_30_days_freezes_both_fee_pdas ... ok
#   rn1_an_open_pair_unlinked_after_30_days_must_still_register_both_pools ... FAILED (PairNotLinked) — #[ignore]d, the High
```

## 6. What I did not check

- Anything on chain: no RPC, so the deployed devnet bytes, the r1 signatures and the pair-6/7 state are taken from the files.
- The real Raydium lock program (`REVIEW_LOCK_SO` unset); lock code did not change in this round.
- TypeScript beyond the files named above: no `npm test`, no typecheck; the API/pages for `unpaired`, the Derby scoreboard and
  `recordForward` bookkeeping were not reviewed. Whether the keeper actually attests a pair_curve coin's baseline before its pool
  registers (the reading RN-1 needs) was inferred from `executePending` (attest runs before any pool check) and the absence of a
  both-or-neither clause on the pair_curve rules files — not run end to end.
- Off-chain result computation (who won) — trusted to the attesters by design.
- `math::buyback_spend`, the Ed25519 parser, compute units of a quorum-3 + quorum-3 draw.
- pair_curve's own code (unchanged in source this round).

## 7. Recommendations, in order

1. **RN-1 before any mainnet pair_curve pair:** do not accept UNLINK_NOT_LIVE for an Open pair_curve Pair (or count from the other side's
   verification), and let an unlinked / never-linked policy-2 coin still register its pool. Until then, cap pair_curve deadlines at
   < 30 days and keep `pairUnlinkStep` off for witness-1 pairs.
2. **RN-2:** same evidence change; keeper unlinks only after the rules' `voidBy` has ended.
3. **M-1:** disclose the loser veto in WHITEPAPER §5.5 / ATTESTERS ("forwards happen only while the losing side's attesters sign its
   losses"), or move results to a pair-level attester set fixed at pairing.
4. RL-1 / RL-2 in the keeper; RI-1 / RI-2 wording; commit the r2 devnet run log and Squads evidence (RI-3); fix the RI-5 comment.
