# End-sink (§45) blind security review, 2026-10-12

Branch `burnticker/endsink2`, HEAD 9abd9436, diffed against 109e3ae7. Scope: the changed instructions of the burn_receipts program only
(`end.rs`, the end-sink pinning in `initialize_token.rs`, the end gates in `submit_reading.rs` and `crank_buyback.rs`, and the supporting
state, constants, attest, memo, events and error additions). Other program files were read only to understand how the new code meets
them. No network was used. The program was built with `--features test-pins` and the `end_sink` suite was run: 8 of 8 tests pass.

Summary: no path lets a caller choose where fuel goes or how much, and nothing can leave to anything but a program-chosen fee PDA.
The real problems are stranding and ordering: a named-coin sink can strand all fuel forever, the creator's minimum can strand a small
coin's whole remainder, and the pair-winner and result-reading outcomes depend on who calls what first.

## Findings

### High

**H-1. A named-coin sink (END_SINK_MINT) whose coin has no TokenConfig strands the fuel permanently.**
`end.rs:74-78` accepts any non-default, non-self pubkey as the named coin at `initialize_token`, and nothing checks that a TokenConfig
exists for it. In `forward_on_end`, `end.rs:276` requires `sink_config` whenever the intended sink is not the flagship
(`ok_or(EndSinkMismatch)`), and `sink_config` is a seeds-checked `Account<TokenConfig>` (`end.rs:212`), so it cannot be passed if the
config was never created. Result: every call fails with EndSinkMismatch (account omitted) or AccountNotInitialized (empty account
passed). The coin cannot self-burn either, because after a RESOLVED end `submit_reading` refuses later dates and `crank_buyback` refuses
them too. Everything above the reserve, plus all later fee income, is stuck for good.
Scenario: a creator or the launch tool names the devnet mint of a coin on mainnet, mistypes a mint, names a coin that never launches,
or names a mint created under a different program. The doc comment says "MINT: the named coin if live, else the flagship", but a
missing config is not handled as "not live".
Fix: make `sink_config` an `UncheckedAccount`, check its address against `["config", sink_mint]` in the handler, and treat an account
that is empty or not program-owned as "not live", so the fuel goes to the flagship. Another option is to require the named coin's
TokenConfig at `initialize_token` and refuse unless it exists and is in buyback mode. That helps but does not cover every case. The
handler-side fallback is the robust fix.

### Medium

**M-1. An end dated after the last reading opens an immediate sweep that starves the result reading (and the pair winner).**
`submit_rule_end` accepts any date from the last reading up to today (`end.rs:132-133`). If the end is dated E later than the
last reading D (for example the season's last day, before the final result reading is posted), then `crank_cursor == last_record_date`
already holds, so `forward_on_end` (`end.rs:253`) can run straight away. Anyone can call it, because it is permissionless once the
cranker allowlist lapses, and the end signatures are public once broadcast. It moves all fuel to the sink. The result reading dated
on or before E, which the design says "cranks normally", then lands on an empty fee PDA and processes below floor. For PAIR_WINNER,
`PairResult(E)` does not exist yet, so the remainder goes to the flagship and never reaches the partner.
Fix: either require `record_date == last_record_date` in `submit_rule_end`, so the result reading must be on chain first (allow any
date only when there are no readings), or have `forward_on_end` refuse while `last_record_date < end_date` until a grace period after
`rule_end.submitted_at` has passed (for example PAIR_RESULT_GRACE_SECS).

**M-2. The pair-winner destination depends on call order, and the natural order sends it to the flagship.**
`end.rs:278` forwards to the partner only while the partner is `live`, and that includes `end_state == END_STATE_LIVE`
(`end.rs:221`). When a season ends, both sides of a pair end. If the winner's `submit_rule_end` lands before the loser's
`forward_on_end`, the loser's whole remainder goes to the flagship. After the winner has ended, so does every later trickle from the
loser. Both instructions are permissionless (the end only needs the public signatures), so any observer can decide the outcome by
ordering transactions. The test `a_pair_sides_remainder_goes_to_the_partner_...` passes only because it forwards B before ending A.
The underlying tension: a winner that has ended RESOLVED has no burn path of its own, so fuel sent to it would just forward again to
its own sink.
Fix (a product decision is needed): either (a) enforce the order on chain. Refuse a RESOLVED `submit_rule_end` for a PAIRED coin
whose partner lost the final period until the partner has ended and run at least one `forward_on_end` (or holds less than its
minimum). Or (b) state plainly that PAIR_WINNER means "the winner, only while it is still live", and have the keeper always forward
the loser before ending the winner. Option (a) is the only one that does not depend on keeper discipline.

**M-3. A creator-chosen minimum of up to 10 SOL can strand a small coin's entire remainder.**
`min_forward_lamports` may be as high as 10 SOL (`constants.rs` END_FORWARD_MIN_LAMPORTS_CEIL; checked at `end.rs:68`), and
`forward_on_end` refuses anything below it (`end.rs:306`). After a RESOLVED end there is no other exit: no self-burn and no readings.
A coin that ends with 3 SOL of fuel and a 5 SOL minimum keeps that 3 SOL forever unless fee trickle happens to lift it over the bar.
This contradicts "never stranded".
Fix: let the first forward (`rule_end.forwards == 0`) move any amount above a small dust floor. Or let any amount of at least
END_FORWARD_MIN_LAMPORTS_FLOOR move once N days have passed since `last_forward_at` (or `submitted_at`). Lowering the ceiling also helps.

**M-4. The attester quorum can now send any end-sink coin's fuel to the flagship at any time.**
`submit_rule_end` checks only the quorum and that the date is no earlier than the last reading and no later than today
(`end.rs:128-139`). There is no pinned earliest end date, no delay before the first forward, and no veto. On Burnticker the quorum is
the operator keeper alone (pair.rs notes quorum 1). Before this change, a stolen or misused keeper key could only distort a coin's
burns on its own supply. Now it can end every coin that has an end sink as RESOLVED today and, in the same block, move all of their
fuel into $DEFICIT, the operator's own coin. Legitimate attesters can also end a contest early by mistake. That cannot be undone,
because the end is one-shot.
Fix: pin an earliest end date in EndSink at `initialize_token` (the rules' season end or resolution date, already hashed in
`rules_sha256`) and refuse an earlier end. Optionally add a delay of 24 to 72 hours between `submit_rule_end` and the first
`forward_on_end`, with an admin or creator veto that turns the end into VOID.

### Low

**L-1. Ending one side of a pair leaves the partner waiting 72 hours on every later reading.**
After A ends, A has no more readings, so no PairResult can be recorded for later periods (a win needs both readings). The partner B
stays PAIRED. Every later reading of B fails `crank_pair_gate` with PairResultPending until PAIR_RESULT_GRACE_SECS has passed.
`unlink_pair` does not accept an end as evidence, and its comment at `pair.rs:641-642` ("no wind-down flag exists in TokenConfig")
is now out of date. B is not wedged, only delayed, but the delay never ends.
Fix: let `unlink_pair` accept `end_state != END_STATE_LIVE` on either side as terminal evidence, and update the comment.

**L-2. A pair_curve coin's PAIR_WINNER sink is never checked against the partner it actually pairs with.**
For `pool_policy == POOL_POLICY_PAIR_CURVE` with no `pair_mint` at init, `end.rs:81-87` accepts any pubkey as the sink. `link_pair`
later pairs the coin with the Pair's other mint and never looks at the EndSink. If they differ, `partner_won` (`end.rs:232`)
always returns false and the remainder always goes to the flagship.
Fix: for PAIR_WINNER, ignore the stored mint and use `PairLink.pair_mint` (the coin is PAIRED already), or have `link_pair` require
`EndSink.sink_mint` to equal the partner when an EndSink exists.

**L-3. The `!pool_verified` bypass can be raced while a pool is about to be registered.**
`end.rs:253` skips the pending-readings check whenever `pool_verified` is false. That is meant for a one-shot that never graduated,
but `pool_verified` is also false in passing states: after `apply_registration_policy` to a non-fixed policy (`admin.rs:359`), and for
a curve that has graduated but whose `register_pool` has not landed yet. In those windows anyone can sweep the fuel to the sink before
the result reading can burn. The fuel is still burned, but on the wrong coin.
Fix: bypass only when the coin can never get a pool (for example a pair_curve Pair that is Voided or refunding, or no pool after a
pinned deadline), or after a time-out counted from `rule_end.submitted_at`.

**L-4. A pair loser whose final reading has zero units can never route its remainder to the winner.**
A zero-unit reading that is next in line is processed when it is submitted (`submit_reading.rs:120`). `submit_pair_result` refuses a
win whose loser reading is already processed (`pair.rs:376`). So `PairResult(end_date)` can never name the partner as winner, and
`partner_won` sends the remainder to the flagship. Whether this matters depends on the rules (does a losing final period ever earn
zero units?). Note it, or record the result some other way.

### Info

- **I-1. TokenConfig layout.** `reserved: [u8; 6]` became `end_state: u8`, `end_date: u32` and `reserved: [u8; 1]`, still 6 bytes
  under Borsh with no padding, so account size and later offsets are unchanged. `initialize_token` has always written zeros there, and
  nothing else writes `reserved`, so existing configs read as LIVE with date 0. Sound.
- **I-2. InitializeTokenArgs grew three fields.** A client still on the old layout fails at argument decoding against the upgraded
  program. The commit history shows this is intended (round 3 and round 4 layouts). Make sure the round-4 client switches over at the
  same moment the program is upgraded.
- **I-3. Flagship routing reads the compiled constant, not the EndSink.** `forward_on_end` uses `BURNTICKER_FLAGSHIP` at forward
  time (`end.rs:262`, `end.rs:268`, `end.rs:274`), while `EndSink.sink_mint` stores the flagship that was current at init. A program
  upgrade that changes the constant re-routes every flagship-bound forward. The flagship is also a single point of liveness: if its
  TokenConfig is missing or its pool is unverified, every forward to the flagship waits (FlagshipNotLive). That fails safe (nothing
  moves), but it should be monitored.
- **I-4. A missing target WSOL account blocks only the WSOL part.** If `wsol_part > 0` and the target fee PDA's WSOL ATA does not
  exist, the forward fails. Anyone can create that ATA without permission, so this is not a wedge. The keeper should create it when
  needed.
- **I-5. The reserve stays put.** `reserve_lamports` (at least the rent-exempt minimum, enforced at init) stays in the ended coin's
  fee PDA forever. This is by design.

## Test gaps (tests/end_sink.rs)

- No MINT sink naming a mint that has no TokenConfig (H-1).
- No end dated after the last reading, with a forward before the result reading arrives (M-1).
- No pair case where the winner ends before the loser forwards (M-2). The only pair test hard-codes the order that works.
- No remainder below the minimum when there is no trickle (M-3).
- No forward under the cranker allowlist (allowed and refused cranker), although `forward_on_end` enforces it.
- WSOL edge cases are not covered: unsynced stray lamports in the source WSOL account (the test syncs before forwarding), a missing
  target WSOL ATA, and a source WSOL account with a delegate or close authority.
- No pair_curve PAIR_WINNER coin linked to a different partner (L-2), and no partner-delay case after one side ends (L-1).
- No signature replay test: an end signed for mint X submitted for mint Y. Message binding covers it, but a negative test is cheap.
- No pre-funded EndSink PDA at `initialize_token` (the top-up path in `create_pda`).

## Checked and found sound

- **Destination.** The destination is computed by the program from EndSink, PairLink, PairResult, the sink config and the flagship
  constant. `target_config.mint` must equal it, and the target fee PDA and target WSOL ATA are derived from `target_config`. A caller
  cannot pick a destination (also tested). Omitting `sink_config`, `pair_link` or `pair_result` produces an error, never a silent
  fall-through to the flagship. PairResult and PairLink addresses are re-derived (`pair_result_address` orders the mints), and their
  owner and discriminator are checked.
- **Amount.** The amount is min(SOL above the reserve + synced WSOL, the burn-pool cap). It never exceeds what is there, so repeated
  calls cannot double-forward. `sol_part` and `wsol_part` cannot underflow. The reserve is re-checked after the SOL transfer. The
  minimum (at least 1,000,000 lamports) is above the rent-exempt minimum for an empty target PDA. The cap is always at least 25 SOL,
  which is above the 10 SOL ceiling on the minimum.
- **WSOL handling.** The source WSOL account's address is checked. Its balance is measured synced (lamports minus the native rent
  reserve). Its integrity is checked before use, and `sync_native` runs before the token transfer. The target WSOL account must be an
  intact native account owned by the target fee PDA.
- **submit_rule_end.** The message carries a distinct domain (`BURNRECEIPTS-END-v1`) and binds the cluster genesis, program id,
  mint, date, outcome and both hashes, so it cannot be replayed across mints, clusters, deployments or outcomes, or confused with a
  reading or pair message. It needs a quorum of the coin's current attesters through the existing `attested_mask`. It runs once:
  RuleEnd is `init` and `end_state` must be LIVE. Dates must be valid, not in the future, and not before the last reading. Only a coin
  with an EndSink can end, so coins launched before this change cannot end and keep their old behaviour.
- **End gates.** After a RESOLVED end, `submit_reading` refuses any date later than the end, and `crank_buyback` refuses such
  readings (defence in depth; tested). A VOID end changes nothing (tested). `crank_no_units` is not gated, but it moves no funds.
- **forward_on_end preconditions.** The cranker allowlist is applied while the pre-audit cap is in force. The carried spend is
  cleared. The RuleEnd counters use saturating adds.
- **initialize_token.** The `end_sink` account must be the `["end_sink", mint]` PDA. It is created with `create_pda`, which handles a
  pre-funded address. If the account is absent, the end-sink arguments must all be zero. Vault mode, the flagship itself, league sets,
  self or default sinks, and a PAIR_WINNER without a partner are all refused (tested). A LaunchLab PAIR_WINNER sink must equal the
  `pair_mint` named in the same instruction. A build with the all-zero placeholder refuses to pin.
- **Pair interplay.** `forward_to_winner` still works after an end for periods dated on or before the end, and fuel sent to an ended
  winner is forwarded on rather than stranded. A coin with no pool forwards zero through `forward_to_winner` and its fuel leaves through
  `forward_on_end` instead, with no double count.

## Responses (endsink-2, 2026-10-12; fixes in 7e356edd)

- **H-1 fixed.** `sink_config` is now an address-checked unchecked account (`["config", sink_mint]`); a named coin with no TokenConfig
  (or not owned by the program) is "not live", so the fuel goes to the flagship. Test: `a_named_sink_that_never_launched_falls_to_the_flagship_and_the_first_forward_ignores_the_minimum`.
- **M-1 fixed.** `submit_rule_end` requires `record_date == last_record_date` (and at least one reading). A forward can then never
  run before the final result reading is processed, and no reading can arrive after the fuel left. The keeper dates the end at the last
  reading; a coin that never read gets one flat baseline reading (0 units, clock proof) first. Test updated (`D3` refused, `D2` lands).
- **M-2 handled in the keeper; on-chain ordering not enforced (owner decision noted).** The keeper never records an end for the pair
  coin that won the final result: it stays live, the loser's forward lands in its pool, and its own leftover burns it through the
  wind-down (the description's "burns the winning coin"). The race needs the coins' attester quorum to end the winner, which on
  Burnticker is the same keeper. A program-level rule (e.g. the winner's own end cannot precede the loser's forward) is listed for the
  next round.
- **M-3 fixed.** The first forward moves whatever is there (amount > 0); the minimum gates only the later trickle.
- **M-4 accepted as a trust statement, not fixed.** Whoever holds a coin's quorum could already sign false readings; the end adds a
  faster path to the flagship. It is disclosed (ATTESTERS.md, the program README). An earliest-end date pinned at init, a delay and a
  veto are listed for the owner as the next round's option; a second signer (signer-2) narrows it.
- **L-1 open (documented).** A partner whose pair-mate ended waits up to 72 h per later reading before it cranks unpaired; the winner's
  wind-down days therefore crank late. unlink_pair evidence for an ended partner is queued with M-2.
- **L-2 open.** A pair-curve coin's PAIR_WINNER sink is checked only against the partner named in the create; a mismatch falls to the
  flagship (no stranding). Queued.
- **L-3 fixed.** The pending-readings exception is now "never registered a pool" (`cpmm_pool == default`), not "pool not verified".
- **L-4 open.** A zero-unit final reading cannot carry a win, so that loser's remainder goes to the flagship. Accepted (a zero-unit day
  is not a result).
- **Info: layouts.** Handled in the client: `initializeTokenIx` defaults to the round-3 bytes until both deployments run round 4
  (`INITIALIZE_TOKEN_DEFAULT_LAYOUT`), shown landing on a validator running the deployed round-3 source.
- **Test gaps.** Added H-1, M-1 and M-3 tests in `tests/end_sink.rs` and a localnet end-sink test through the chain client (RuleEnd once,
  RuleEnded after it, FlagshipNotLive / EndSinkMismatch). Still untested: the cranker allowlist on forward_on_end, the WSOL edge cases,
  cross-mint replay of an end signature, a pre-funded EndSink address.
