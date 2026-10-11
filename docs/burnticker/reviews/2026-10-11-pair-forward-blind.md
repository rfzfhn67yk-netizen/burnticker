# Winner takes the burn (LAUNCHPAD-PATH §40) — blind adversarial review (2026-10-11)

Reviewed commit: **ea65a7f0** (`fix/price-integrity-and-engine-correctness`; the program sources are those of **c1834074**, the devnet
pair-6 upgrade — `git diff 40e13bf5 ea65a7f0 -- programs/` is the whole release). Scope: the new release only — burn_receipts
`TokenConfig.pair_state` and the provisional pairing on `initialize_token` (7-day window), `PairLink`, `link_pair`, `PairResult` and
`submit_pair_result`, `forward_to_winner`, the crank gate in `crank_buyback`, the wind-down forward, errors 6077–6089; pair_curve where
`link_pair` / `register_pair_pool` read its Pair; and the keeper-side assumptions in `src/lib/burnticker/pairForwardChain.ts`,
`pairForwardKeeper.ts`, `multiKeeper.ts` (pair steps), `src/lib/burnReceipts/pairs.ts` and `crank.ts` `planCrank`.

Method. I read LAUNCHPAD-PATH §40 and the devnet pair-forward run log first (intended behaviour), then the program code, then the
whitepaper §5.5 and the keeper. Tests run in LiteSVM against the real burn_receipts build (`--features test-pins`, as
`scripts/test.sh` builds it) and the source-built Raydium CPMM fixture. Nothing was sent to any cluster; no `.env*` file or key was
opened. (`anchor build` in the fresh worktree generates throwaway program keypairs under the git-ignored `target/deploy/`; they were
not read or used.)

Baseline at ea65a7f0: `scripts/test.sh` green — burn_receipts and pair_curve LiteSVM suites all pass (the IDL test needs `anchor build`
first in a fresh worktree).

**One High, two Mediums, four Lows, Infos below. No Critical.** No path was found by which anyone moves SOL out of a fee PDA anywhere
except into the partner's fee PDA, forwards in the wrong direction, forwards twice, or forwards a period that is not next in line.

## Findings table (most severe first)

| # | Sev | Title | Where | Status |
|---|---|---|---|---|
| H-1 | **High** | A PairResult the winner cannot serve wedges the loser's crank queue and burn pool **permanently**: `crank_buyback` refuses `ForwardRequired` with no time-out, `forward_to_winner` needs the winner's reading for the same date and both pools verified, and `submit_pair_result` checks neither. Doc and whitepaper say an unregistered / void side "forwards nothing" — the code blocks instead | pair.rs:330, 414-415; pair.rs:258-276; crank_buyback.rs:123-129 | **reproduced** (2 exploit tests fail) |
| M-1 | Medium | Each side's attesters hold a veto over every result (both quorums required): a coin whose attesters never sign its losses never forwards — after 72 h it burns its own fuel — while it still collects its wins; attesters rotate unilaterally (48 h, the coin's admin) after pairing | pair.rs:273-276, 335; admin.rs (attester proposals) | by inspection + existing tests |
| M-2 | Medium | Pairing is permanent with no exit: a live coin whose partner is dead (voided curve side, refunding side of a half-graduated pair, retired, attesters gone) needs a result co-signed by the partner's attesters on **every** buyback period forever, else waits 72 h per period; any result naming the dead partner is H-1 | pair.rs:208-209, 315-337; constants.rs:178-182 | by inspection |
| L-1 | Low | `link_pair` is permissionless and retroactive: anyone can flip an already registered, already trading policy-2 pair (one made before §40, whose rules hash has no `winnerTakesBurn`) to PAIRED; also accepted on an Open pair that later voids | pair.rs:182-214 | by inspection (devnet pair 6 did exactly this, deliberately) |
| L-2 | Low | A result can be recorded for any past date: before the coins were paired, for a period neither coin read, or for a period the loser already burned (a permanent, moot "LOST, forwarded = false" record a receipt reader can misread) | pair.rs:262-276 | reproduced (control test) |
| L-3 | Low | The second `initialize_token` that names the first coin but omits `partner_link` / `partner_config` leaves BOTH coins provisional, naming each other, forever — no instruction can complete the pairing | pair.rs:128-153 | by inspection (pairs.rs:141-143 shows the provisional branch) |
| L-4 | Low | The forward's basis counts the loser's WSOL by its stored `amount`, the crank by its synced balance (lamports − rent): unsynced WSOL lamports are left out of the forward and stay with the loser | pair.rs:390-396, 422; crank_buyback.rs:135-145 | by inspection |
| I-1 | Info | Program invariants enforced only by the keeper (list in §4) — the winner-reading check before a result, the 72 h result deadline, "pair live" before results, the WSOL ATA | pairForwardKeeper.ts:88-97; multiKeeper.ts:626-654, 465-480 | inspection |
| I-2 | Info | `submit_pair_result`'s re-submission path returns Ok before any signature or date check (no state change; an unsigned "successful" submit_pair_result tx exists) | pair.rs:267-270 | inspection |
| I-3 | Info | `PairResultSubmitted` is a plain `emit!` ("Program data:") — spoofable by any program in a naive log parser that does not track the invoke stack; the account is the record (documented) | pair.rs:294-304 | inspection |
| I-4 | Info | Keeper comment is wrong: "a forward under the loser's floor moves nothing; the program writes no forward memo then" — the program always writes the memo (devnet: `lamports=0`); parse still works | pairForwardChain.ts:144-145; pair.rs:463-464 | devnet evidence |
| I-5 | Info | `planCrank`'s `forward` plan (the plain `crank` CLI path) does not create the winner fee PDA's WSOL ATA (only `buildForward` does); a WSOL forward then fails until someone creates it (anyone can) | crank.ts:299-301; pairForwardChain.ts:112-118 | inspection |
| I-6 | Info | `params_hash` / the TokenInitialized event do not cover the pairing; a verifier must read `pair_state` + PairLink | initialize_token.rs:215-226 | inspection |
| I-7 | Info | Compat: `pair_state` is carved from `reserved[23]` → `pair_state + reserved[22]`; every prior writer zeroed the reserved bytes, so old configs read NONE and the account size is unchanged | state.rs:142-145 | git history |

Tests: `programs/burn-receipts/programs/burn_receipts/tests/review_pair.rs` (committed). Every `h*` test asserts the SAFE behaviour and
is `#[ignore]`d so `scripts/test.sh` stays green; run with `cargo test -p burn_receipts --test review_pair -- --include-ignored
--test-threads=1`.

| test | result at ea65a7f0 |
|---|---|
| `ctl_a_result_is_accepted_for_a_period_the_winner_never_read` (control) | pass |
| `h1a_a_result_whose_winner_read_past_the_period_must_not_wedge_the_loser_forever` | **FAIL** — forward `AccountNotInitialized`, crank `ForwardRequired`, B's next reading `OutOfOrder`; identical 60 days later; 3.02 SOL stuck |
| `h1b_a_result_naming_a_winner_without_a_verified_pool_must_not_wedge_the_loser` | **FAIL** — forward `PairSideNotLive`, crank `ForwardRequired`; identical 60 days later; 3.02 SOL stuck |

No pair_curve exploit test: no High+ finding is in pair_curve code (H-1's pair_curve route — a half-graduated pair — is the same
program-side mechanics as `h1b`).

## 1. Blind findings

### H-1 (High) — a result the winner cannot serve wedges the loser forever

Once a PairResult names a loser for period D, the loser's reading D can be processed only by `forward_to_winner`:
`crank_pair_gate` returns `ForwardRequired` on the LOST branch (pair.rs:330) with no time-out (the 72 h grace applies only when no
result exists, pair.rs:334-336), and `crank_no_units` needs `units == 0`. `forward_to_winner` in turn requires

- the winner's Reading for the same date (account constraint, pair.rs:377-379 / 415), and
- `pool_verified` on BOTH configs (pair.rs:414).

`submit_pair_result` (pair.rs:258-276) checks neither, nor that they can ever become true. Because readings are processed strictly in
order (`require_next_in_line`), every later reading of the loser is `OutOfOrder` behind D. The fee PDA has no withdraw path, so the
loser's whole burn pool — and every later LP-fee claim and creator fee that lands in it — is frozen for good. The 30-day
untradeable unblock in `crank_buyback` never runs: the gate fires first.

Ways the forward becomes impossible after a valid result:

1. **The winner has no reading for D and has read past it** (`submit_reading` requires `record_date > last_record_date`,
   submit_reading.rs:54-56). Reproduced: `h1a`.
2. **The winner's pool is not verified**: a LaunchLab partner still on its curve; a pair_curve side that refunds while the other side
   graduated (status stays `Graduating`, so `link_pair` accepts it and its pool is never registered — void_pair.rs:52-78); a side whose
   `lock_lp` has not run (30 days to `burn_lp`); a winner after `apply_registration_policy` (admin.rs:314 sets `pool_verified = false`
   for policy 0). Reproduced: `h1b`.
3. The winner's WSOL ATA missing on a WSOL forward — recoverable (anyone can create the ATA), listed for completeness.

Who can trigger it. The result needs both coins' attester quorums, so it is not a free-for-all. It is reached by (a) the operator's
own keeper or admin CLI on any path that skips the off-chain checks — `scripts/burnreceipts-admin.mts submit-pair-result` checks
nothing; the keeper's `ensurePairResult` checks the winner's reading only when it runs for the loser coin and never checks the
winner's `pool_verified`; (b) any pair whose two attester sets are not the operator's (the program is permissionless; policy-1 coins
pin no platform) — e.g. the winner side's attesters co-sign the result and then post D+1 without D; (c) a `pool_verified` flip after
the result (route 2, last case). The program's own doc (pair.rs:351-352, "a voided / unregistered side forwards nothing") and the
whitepaper §5.5 ("a draw or a void forwards nothing") describe the safe behaviour; the code does the opposite.

Exploit scenario (h1a). Pair (A, B), one attester each side (the devnet setup). B reads D2 (+5 units, 3 SOL in its pool); a result for
D2 naming A is posted before A's D2 reading; A's next reading is D3. B: `forward_to_winner` → `AccountNotInitialized`
(winner_reading), `crank_buyback` → `ForwardRequired`, B's D3 → `OutOfOrder`. Sixty days later: unchanged.

Fix (any one closes it; the first two together are best):

- `submit_pair_result` takes both coins' Reading accounts for `record_date` and requires both to exist; when there is a winner, it
  requires the loser's reading to be unprocessed and both configs `pool_verified` (else refuse — the keeper posts a draw, as it already
  does for "winner read past D").
- `forward_to_winner` does what the doc says when the winner is not live: process the loser's reading with `OUTCOME_FORWARDED` and 0
  lamports (or let the loser crank), instead of `PairSideNotLive`; drop the winner-reading requirement (the winner's fee PDA always
  exists; the reading is not used for any amount).
- Belt and braces: a time-out on the LOST branch (e.g. if `forward_to_winner` has not landed `PAIR_RESULT_GRACE_SECS` after
  `pr.submitted_at`, the loser may crank as unpaired, emitting an event), so no future precondition can wedge a queue.

### M-1 (Medium) — each side's attesters can veto its own losses

`submit_pair_result` needs a quorum of BOTH coins' attesters over the same message (pair.rs:273-276). The side that lost simply does
not sign; 72 h after its reading anyone may crank it as unpaired (pair.rs:335; after the 90-day cranker allowlist, permissionlessly),
and its fuel burns its own coin. The same coin still collects its WINS, because the partner's honest attesters sign those. Attester
sets change unilaterally by the coin's admin (48 h timelock), so a partner that looked symmetric at pairing can turn asymmetric later.
In Burnticker's own flow both coins share the operator's attesters and admin, so the risk is to pairs made directly on the program
(any policy-1 coin can pair) and to any future per-creator attester set. `pairs.rs::a_pair_result_needs_both_quorums...` and
`...waits_72_hours_then_burns_as_unpaired...` already show both halves.

Fix: a pair-level attester set fixed at pairing (recorded in both PairLinks — e.g. the intersection, or the set both initializers
name), used for results and immune to one side's rotation; or require attester-set changes on a paired coin to be co-approved by the
partner's admin. At minimum, disclose that "winner takes the burn" holds only while both sides' attesters sign losses.

### M-2 (Medium) — pairing is forever, even with a dead partner

`pair_state = PAIRED` and the PairLink never change (no unpair instruction). Every buyback period of a paired coin then needs a
PairResult co-signed by the partner's attesters, or waits `PAIR_RESULT_GRACE_SECS` (72 h) and burns as unpaired. A partner that died
— a voided LaunchLab curve, the refunding side of a half-graduated pair_curve pair, a retired coin, an admin that renounced with
attester keys later lost — makes every one of the live coin's burns either depend on the dead side's attesters (they must keep signing
draws forever) or lag 72 h, permanently. And any result that ever names the dead side is H-1. The keeper posts draws for these
periods (`multiKeeper.ts:316-322`), so today this is operational load, not a wedge.

Fix: an unpair path when the partner cannot be live — permissionless when the partner's Pair is Voided, or its side is refunding, or
(LaunchLab) its pool is not verified N days after the other side's; plus the H-1 fix.

### L-1 (Low) — `link_pair` changes a live coin's economics retroactively, permissionlessly

`link_pair` checks only that the Pair is not Voided and that both configs are policy 2 (pair.rs:182-189). It does not require the
pool to be unregistered (`cpmm_pool == default`), the Pair to be pre-graduation, or any party's consent. A policy-2 pair registered
before §40 (rules hash without `winnerTakesBurn`) can be flipped to winner-takes-the-burn by anyone; the whitepaper says "pairs made
before keep their bytes". Devnet pair 6 was flipped this way on purpose. No mainnet pair exists yet, so the practical exposure is nil.
Fix: require `!pool_verified` (link before registration — `register_pair_pool` already requires the link), or the creator's signature
for already registered pairs.

### L-2 (Low) — results for periods that cannot mean anything

`submit_pair_result` accepts any valid past date (pair.rs:262-264): before the coins were paired (`paired_at`), for a date neither
coin read, or for a period the loser already processed (burned after the grace). The last leaves a permanent PairResult saying LOST
with `forwarded = false` beside a reading that BURNED; a receipt reader joining the two can misreport. The control test
`ctl_a_result_is_accepted_for_a_period_the_winner_never_read` shows a result with no winner reading. Fix: the H-1 reading checks, plus
`record_date >= utc_date(max(paired_at of both links))`.

### L-3 (Low) — mutual naming without the partner accounts can never pair

`pair_at_initialize` takes the "partner initialized first" branch only when `partner_link` is passed (pair.rs:128-134). If the second
coin names the first but omits `partner_link` / `partner_config`, it is written provisional too: two coins naming each other, both
PROVISIONAL, and no instruction can ever complete the pairing (the rules hash says `winnerTakesBurn`; on chain they are plain coins).
Burnticker's `buildPairBundles` passes the accounts. Fix: make `partner_link` mandatory with `pair_mint` and branch on whether the
account holds a link naming this mint.

### L-4 (Low) — WSOL basis differs between forward and crank

`forward_to_winner` reads the loser WSOL account's stored `amount` (pair.rs:390-396, 422); `crank_buyback` uses lamports − rent, the
synced balance (crank_buyback.rs:135-145). Lamports sent straight to the WSOL ATA without a SyncNative are excluded from the forward's
basis (they stay with the loser; the transfer itself is consistent because it moves only `amount`). Small and donation-only. Fix:
sync first, or measure the same way as the crank.

### Info

- **I-2.** The same-result re-submission returns Ok before any check (pair.rs:267-270). Harmless (no write); a verifier must not treat
  a successful `submit_pair_result` transaction as evidence of signatures — read the account.
- **I-3.** `PairResultSubmitted` via `emit!` (pair.rs:294). Another program can log identical "Program data:" bytes in its own
  instruction; only parsers that attribute logs by invoke depth are safe. The keeper reads the account (pairForwardChain.ts:94-98).
- **I-4.** pairForwardChain.ts:144 says no memo under the floor; pair.rs:463 always writes it (devnet `period=2026-10-10|lamports=0`).
- **I-5.** `planCrank`'s forward plan omits the winner WSOL ATA creation (crank.ts:300); `buildForward` includes it.
- **I-6.** Pairing is outside `params_hash`; the rules file's `winnerTakesBurn` and the chain's `pair_state` can disagree (L-3, a
  window that closed) — the keeper treats the chain as authoritative (`pairCtxFor`), which is right.
- **I-7.** Layout claim checked: `reserved: [u8; 23]` became `pair_state: u8, reserved: [u8; 22]`; every initialize_token version
  zeroed `reserved`, so pre-§40 configs read `PAIR_STATE_NONE`.
- The forward moves `rule_spend` in one step, outside the 2 %-of-reserve per-crank cap and without the loser's
  `carried_spend_lamports` (that stays owed to the loser's own coin). By design ("its rule's spend for this reading alone"); the winner
  then spends it under its own caps.

## 2. Passes (with evidence)

- **Direction / double forward / wrong period.** `pair_result` address is re-derived from (loser, winner, date) and its fields checked;
  `winner == winner_config.mint` and not a draw (pair.rs:403-406) — `pairs.rs` shows `NotWinner` both ways on a draw and on A→B. The
  loser reading is seeds-bound to the date and must be next in line; a second call returns before any transfer (pair.rs:408). The
  loser's own crank after a forward is `AlreadyProcessed`.
- **Amount.** `buyback_spend(min(SOL above reserve + WSOL, cap), units, f)`, 0 under the floor, SOL first then WSOL, reserve re-checked
  after the SOL transfer (pair.rs:426-449). Exactly the crank's formula on the same basis (apart from L-4). Cap and one-shot covered in
  `pairs.rs`; the devnet figure checks: 504,956,626 × (1 − 0.99¹⁷) = 79,306,875.16 in floating point, 79,306,876 from the
  program's integer math (the remainder is floored, so the spend rounds up by under one lamport).
- **Signatures.** One message binds domain, cluster genesis, program id, both mints in byte order, date, winner (or "draw"), source and
  proof hashes (attest.rs:65-79); `PairOrder` refuses swapped configs; replay across dates / pairs / clusters / deployments changes the
  bytes. Domain-separated from readings (`BURNRECEIPTS-v3|` vs `BURNRECEIPTS-PAIR-v1|`). Offsets must point inside the Ed25519
  instruction itself (attest.rs:124-125). Overlapping attester sets count for both coins — intended (devnet runs on it).
- **Conflicts.** Append-only: a different winner (or a draw after a winner) is `ConflictingPairResult`.
- **Pairing abuse.** Self-pairing, default partner, vault mode and policy 2 at initialize are refused (pair.rs:126-127); a partner that
  named someone else, a partner already paired, a partner past its window are refused (pair.rs:138-141); `partner_config` is
  seeds-checked and must be the named mint's and PROVISIONAL. A third coin naming a paired coin only gets a dead provisional link. A
  PairLink ["pair_link", M] can be written only by M's own `initialize_token` (mint signs) or by `link_pair` with the one pair_curve
  Pair that can hold M (pair_curve mints must be fresh with the pair vault as authority, init_pair.rs:95-99, so a mint is in at most one
  Pair). Pre-funding a PairLink or PairResult address does not block creation (`create_pda` / `init_if_needed` top up).
- **Policy confusion.** Policy 0/1 pair only at initialize; policy 2 only through `link_pair`; `register_pair_pool` refuses unpaired
  policy-2 coins; the switch to policy 1 cannot dodge pairing (link_pair checks `rule.pool_policy`, immutable).
- **Gate.** The PairResult address is derived from the coin's own mint, its PairLink's partner and the reading's date, so a stale result
  of another period is `InvalidPairResult`; an empty or system-owned (pre-funded) address takes the grace path; `PairResultMissing`
  fires once, with the reading's processing. Unpaired / provisional coins pass straight through.
- **Allowlist.** `forward_to_winner` applies the same cranker allowlist as `crank_buyback` while the cap is in force.
- **pair_curve reads.** PairView offsets (status 11, mints 12, pools 76, …) match `pair_curve::state::Pair` (8-byte discriminator +
  version, bump, vault_bump, status); owner, discriminator, length and PDA are checked.

## 3. Attempts that failed (and what stopped them)

- Forward to a third coin W' via a PairResult of another pair: the address is derived from (loser, winner) and only exists if those two
  were paired and both quorums signed.
- Make the loser burn after LOST via `crank_no_units` / the 30-day untradeable unblock / omitted pair accounts: `HasUnits`, the gate
  runs first, `PairMismatch`.
- Block a pairing by pre-creating the partner's PairLink: needs the partner mint's signature or a Pair holding that mint.
- Grief the WSOL leg by tampering with the winner's WSOL ATA: its address is fixed and only the winner fee PDA can change delegate /
  close authority (`require_fee_token_account_intact`).
- Reuse a draw signature as a win, or a pair signature as a reading: the bytes differ.

## 4. Keeper-side assumptions (invariants enforced only off-chain)

| Program would wedge or misbehave if… | Where the keeper prevents it | Gap |
|---|---|---|
| a result names a winner with no (and no possible) reading for D | `ensurePairResult` + `winnerFlatReading` post a draw when the winner read past D (pairForwardKeeper.ts:88-97, multiKeeper.ts:626-654) | only when the loser coin drives `ensurePairResult`; the admin CLI `submit-pair-result` checks nothing → H-1 |
| a result names a winner whose pool is not verified | the pair gate holds receipts until both pools are registered (multiKeeper.ts:465-480) | not re-checked at result time; a later `pool_verified = false` (policy switch) is not considered → H-1 |
| no result within 72 h (the period then burns unpaired, unforwardable) | alert `pair-result-missing` (pairForwardKeeper.ts:86-87) | alert only |
| the second LaunchLab coin omits partner accounts | `buildPairBundles` passes `partnerFirst` (launchBundle.ts:265-267) | L-3 |
| a WSOL forward to a winner without a WSOL ATA | `buildForward` adds an idempotent ATA create | `planCrank` path does not (I-5) |
| winner-reading race: the result lands before the winner's flat reading | flat reading is submitted and confirmed before the result | — |

## 5. What I did not check

- Mainnet / devnet bytes: no RPC call, no cluster comparison of the deployed hash (`b23df8fa…`) with this source.
- The real Raydium lock program (`REVIEW_LOCK_SO`): no lock code changed in this release; the lock suites ran with the stand-in only.
- The TypeScript side beyond reading the files named in scope: no `npm test`, no typecheck; the keeper's receipt bookkeeping
  (`recordForward`, `pair_forwards`, the Derby scoreboard) and the pages/API were not reviewed.
- How results are computed off-chain (derby windows, season games, one-shot certification, `periodWinner` semantics) — trusted to the
  attesters by design and out of the program's reach.
- `math::buyback_spend` rounding and the Ed25519 parser were not re-derived (unchanged, covered by earlier reviews).
- No pair_curve LiteSVM test of `link_pair` on a half-graduated (`Graduating` + refunding side) pair; H-1(b)'s mechanics were shown with
  a policy-0 partner that never registered.
- `apply_registration_policy` flipping a winner's `pool_verified` after a result was not built as a test (inspection only).
- Compute units / transaction size of a quorum-3 + quorum-3 pair result (only the documented quorum-1 path is exercised).

## 6. Reproduction

```
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"
cd programs/burn-receipts
anchor build                 # fresh worktree only: target/idl for the IDL test
bash scripts/test.sh         # green; builds target/deploy-test (test-pins) that the LiteSVM suites load
cargo test -p burn_receipts --test review_pair -- --include-ignored --test-threads=1 --nocapture
```
