# burn_receipts — program upgrade queue

Design items for the next program review cycle (to be built with the pair_curve review, not now). Nothing here is deployed; every
item names what the keeper does today instead, so no coin waits on it.

## Done — `claim_lock_fees` + `register_fee_key` (LP-lock release, 2026-10-10, LAUNCHPAD-PATH §35)

No longer a candidate: shipped in burn_receipts `d54664ed` / `3d82b6b5` and deployed on devnet through the Squads vault (vault
transactions 6 and 8; `docs/burnkeeper/devnet-lock-run-log-2026-10-10.md`). Graduation LP is locked forever in Raydium's CPMM lock, the
Fee Key NFT is held by the FEE_KEYS PDA (LaunchLab's platformLockNftWallet; pair_curve's lock_lp), and the permissionless claim splits
the LP fees by compiled constants — SOL 80 % to the coin's burn pool, 20 % to the operator treasury (parked in the FeeKeyRecord while
the treasury cannot receive it) — and burns the coin side. Design and threat notes: `docs/burnticker/PAIR-CURVE.md` §5.1–§5.2 and §8,
Powers Register entries `register_fee_key` / `claim_lock_fees`.

## 1. `sweep_retired` — a permissionless instruction

**Status 2026-10-12 (end-sink round 4, `burnticker/endsink2`): not built in that round.** The round added the on-chain end flag this item
waited for (RuleEnd, `TokenConfig.end_state`), and a RESOLVED coin's later fee income already moves permissionlessly through
`forward_on_end` to its end sink. What remains is a VOID coin's trickle, which the keeper still sweeps on the coin itself; building it
needs the swap-and-burn core of `crank_buyback` factored out, so it waits for a round of its own (docs/burnticker/END-SINK.md).

**Why.** A retired coin's fee PDA keeps receiving the 4.75 bps post-graduation creator fee from Raydium trading, so its burn pool
refills slowly. Today the keeper sweeps it (`src/lib/burnticker/multiKeeper.ts` planRuleEnd: when the spendable balance minus the reserve
passes `onEnd.sweepThresholdLamports`, one quorum-signed `clock` reading of full-spend units, cranked across days under the per-crank cap,
at most once a week; receipt kind `sweep`). That still needs the keeper and its attester signature.

**Design.** Once a token's rule has ENDED on chain (a recorded end reading / end flag in the TokenConfig), anyone may call
`sweep_retired(mint)`: a 100 % spend of the fee PDA's spendable balance, under the SAME guards as `crank_buyback` — the TWAP guard, the
2 %-of-reserve per-crank cap (the rest carried to the next call), the floor, the platform's pre-audit cap — and NO attester signature
(the end is already attested). The memo and event are those of a buyback crank with outcome `sweep`. Retired coins then stay burnable
without the keeper.

**Constraints for reviewers.** Only after the end flag; no new authority; no destination other than the coin's own pool and the burn;
idempotent per slot (the cap and the carry bound each call).

## 2. Outcome sets — an `outcome_set` account + permissionless `forward_to_winner`

(Generalises the "league mode" item; "league mode" stays the wizard's word for a league-season set.)

**Model.** An `outcome_set` account = ONE selector with an outcome list (any venue: an ESPN league-season champion, a Polymarket
multi-outcome event via its outcome list / `groupItemTitle`, a Burn Derby bracket) + the member mints, each bound to ONE outcome of that
selector (a team id, a conditionId / outcome, a bracket slot). Rivalry pairs are the 2-member case; a league is the 32-member case; a
derby bracket forwards round by round (each loser → that round's winner, compounding to the final). Scalar feeds (debt, CPI, weather)
have no winner and are excluded: the primitive is offered only where the selector has an outcome list.

**Rule field (in the rules hash today).** `set: { id, outcome, forwardBps }` — opt-in, absent by default, `forwardBps` 0–10,000 (10,000
when the creator does not dial it); requires `onEnd`; refused on scalar rules (`src/lib/burnticker/rules.ts`). The description's window
sentence carries the conditional: "…and X % of the leftover burns the winning coin of set <id> once the program's forward_to_winner
instruction is live (queued, not deployed); when it is not — or there is no winning coin, or it is not graduated — all of it stays here."

**Instruction.** After the set's quorum-signed **winner** reading, anyone may call `forward_to_winner(mint)` on an ended member: it
moves `forwardBps` of the member's fee-PDA balance (minus the reserve) to the winning member's fee PDA. The destination is fixed by the
reading; both mints must be members of the same set account; only after the winner reading; idempotent; an event is emitted. The
remainder — and the whole amount when forwarding is impossible (no winning coin, the winner not graduated / no registered pool, or the
instruction not live by the set's end) — takes the normal 28-day wind-down on the member's own coin.

**Note for reviewers.** This is the first SOL movement between fee PDAs. Constrain it to set members and reading-chosen destinations;
no admin input anywhere (no setter for the destination, no override of the reading, no allowlist the operator edits).

## 3. Per-outcome fractions (carried from the counter design)

A rule paying different fractions per outcome (onYes 2 %, onNo 1 %) is not expressible on the current program (one fraction per unit;
`counterRule`). It would also let a pair's wind-down use an exact 1 % clock regardless of the event fraction. Needs per-outcome readings.
