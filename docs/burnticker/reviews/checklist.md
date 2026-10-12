# Pre-registered review checklist (committed before the ChatGPT adversarial review starts)

This file is committed BEFORE the review it governs, so the questions cannot be tuned to the answers. It is the checklist handed to
the ChatGPT reviewer on 2026-10-10 (the same twelve program items the three blind Claude reviews answered, plus the platform items
added after the devnet rehearsal and one added after the venue-terms decision of 2026-10-10).

Treat every statement in the whitepaper, README and this list as a CLAIM to test, not a fact to confirm.

## Claims under test

A per-token fee PDA (seeds `["fee", mint]`) is the Raydium LaunchLab creator and receives creator fees; permissionless
`claim_launchlab_creator_fee` (destination = the fee PDA's WSOL ATA only) and `crank_buyback` (CPMM `swap_base_input`, min_out from
max(spot, TWAP) with ≤ 300 bps tolerances, spend ≤ 2 % of the pool's WSOL reserve and ≤ a platform cap, remainder carried, burn
everything received, memo in the same instruction); readings append-only with monotone dates, signed message
`BURNRECEIPTS-v3|<genesis>|<program>|<mint>|<feed>|prev=…|<date>|<value>|src=…|proof=…`, shared-message Ed25519 layout, quorum ≤ 3;
out-of-bound readings become resets; rules immutable; attester proposals 48-h timelocked, retain ≥ quorum current keys and add < quorum
new keys; PlatformConfig optional (default cap 25 SOL, sunset 2027-10-01), cap ≥ 1 SOL; `register_pool` requires LaunchLab's
deterministic migration pool, pool_creator == fee PDA, ≥ 90 % LP burned/locked; pool health with ≤ 24 h observation gaps, replace after
7 days, below-floor unblock after 30 days; mint and freeze authority must be none; NO withdraw/sweep/close/mint/pause/rule-update
instruction; no path moves SOL or tokens out of the fee PDA or vault except swap→burn / burn. All graduation LP is burned (platform
config `burnScale` 1,000,000, `platformScale` 0); creators earn no cash; the developer's take is 25 bps of curve volume and nothing
after graduation.

## Program (`programs/burn_receipts`, client `src/lib/burnReceipts`)

1. Signer / owner / PDA / discriminator / mutability checks on every instruction (23).
2. Any outflow other than swap→burn / burn (rent, close, CPI destinations, ATA tricks, claim destination, replace_pool).
3. CPMM swap: pool / vault / program substitution; min_out derivation; TWAP guard (observation ring, staleness, bucket-bias fix,
   adversarial timing); the 2 % cap arithmetic; griefing the crank (SyncNative path).
4. LaunchLab CPI: account constraints vs the SDK builder; what the test mock does not enforce.
5. Ed25519 introspection: offsets, duplicate attesters, replay across mints / programs / clusters, prev-date binding, quorum
   arithmetic, shared-message abuse.
6. Reading math: carry / reset, overflow, fixed point (1 − (1 − f)^units), rounding direction.
7. Governance: timelock bypass, quorum floor / cap, admin renounce, platform cap / sunset, registration-policy switch (48 h, 14-day
   expiry, attester veto), event completeness.
8. Pool health / replace: forcing or blocking replacement, the "untradeable" oracle, clock manipulation, the 90 % LP threshold.
9. Init: mint keypair signer, re-init, admin, reserve funding, token-2022.
10. Client: simulation, genesis check, signature packing, v0 / lookup-table path, memo parsing, secret handling.
11. Liveness / DoS: any permanent wedge.
12. Compute budget and account sizes under worst-case inputs.

## Keeper, platform, ops, evidence

13. Keeper (`src/lib/burnKeeper`): signing discipline (write-ahead, adoption of landed txs, never inventing numbers), the quorum
    gate, genesis checks, legacy-leg refusals, program-mode execution path.
14. Platform (`src/lib/burnticker`, `src/app/burnticker`, `src/app/api/burnticker`): rule canonicalisation and hashing,
    selector / mapping validation, oracle adapters' finality rules (Polymarket: on-chain CTF payout as the final word; Kalshi:
    settled / finalized only, behind a flag), append-only registry triggers, draft expiry, the public API's cross-site refusal and
    rate limits, the SDK's import-graph leak test, the wizard's refuse list (`config/burnticker/refuse.json`).
15. Ops: the public-tree carve-out (`config/public-repo.allowlist`, `config/public-repo.denypatterns`) — can private code or
    secrets leak? Host units, firewall, the deploy script, the Caddy config.
16. Evidence: do the devnet receipts (`docs/burnkeeper/evidence/devnet-2026-10-10/`) recompute (units, spend, memo) from the
    Treasury fixture and the on-chain data? Does `scripts/ops/verify-evidence-signatures.mjs` prove what it claims?
17. Settlement coverage: for every category the wizard can offer, is there a primary source the keeper can actually read plus an
    independent cross-read, and does the program's "no reading → no burn" fail-safe hold on every path (missing source, disagreeing
    cross-read, venue switched off)? Is anything settled on data whose terms forbid it (Kalshi API / Data Terms, Polymarket Site
    data vs on-chain payout, index-provider licences)?

## UI trust rules (the launchpad surfaces)

- No market cap, price, odds, prediction or promise appears anywhere a creator or buyer reads (copy lint `config/launch/copy-lint.json`).
- Every coin page states the locked rule, the settlement source, the next settlement date, what the operator can and cannot do,
  and links each burn to its receipt and transaction.
- The trust page's numbers (fees, caps, LP, reviews) match the program constants and the live platform config.

## Report format

For each item: PASS with evidence (file:line, test name) or a finding (severity, file:line, exploit scenario, fix). Write your own
findings BEFORE reading the prior reports; then read `2026-10-09-claude-blind-1.md`, `2026-10-10-claude-blind-2.md`,
`2026-10-10-claude-blind-3.md` and `docs/burn-receipts/CHANGELOG.md`, and finish with four lists: closed / still open / regressed /
new. Name the commit you reviewed.

## Erratum 2026-10-10 (after the ChatGPT/Codex review)

The text above is pre-registered and stays as written. The review (`2026-10-10-chatgpt-pr-review.md`, checklist items 1 and 8, and
"Claims and UI trust boundaries") found three statements in it that do not match the source; the correct facts are:

- **LP threshold (scope line and item 8).** `register_pool`'s general floor is **50 %** of the pool's live LP burned or locked
  (`MIN_LOCKED_LP_BPS = 5_000`, `programs/burn-receipts/programs/burn_receipts/src/constants.rs`); **90 %** applies only to a
  stranding-recovery fallback pool chosen through `set_registration_policy` (`FALLBACK_MIN_LOCKED_LP_BPS = 9_000`), and
  `register_pair_pool` requires 90 % of the pair pool's creation LP burned (`PAIR_MIN_BURNED_LP_BPS`). Public copy now reads: "≥ 50 % at
  registration (≥ 90 % for the fallback pool); our platform burns 100 % at graduation". A pool's current LP share is not evidence that
  all of its initial graduation LP was burned.
- **Instruction count (item 1).** burn_receipts has **24 entrypoints** in its `#[program]` module (`.../burn_receipts/src/lib.rs`),
  not 23; the IDL, the Powers Register and the whitepaper's §13.3 list 24. `test/burntickerReviewErrata.test.ts` pins the count.
- **"No market cap anywhere" (UI trust rules).** Burn Derby's one-shot flippening compares two OTHER coins' market caps as the rule's
  input. The rule is now: no price, market cap or odds for any Burnticker coin; another coin's market cap may be a rule input, shown
  only as the rule sentence. Derby admission refuses any Burnticker platform coin as an input (`src/lib/burnticker/derby/admission.ts`).

## Erratum 2026-10-10 (LP locked forever, owner decision)

The text above stays as written. After it was registered the owner changed the LP policy (LAUNCHPAD-PATH §35, `docs/burnticker/decisions.md`
2026-10-10 "LP locked forever, its fees fund the burn"), so the scope line "All graduation LP is burned (platform …" no longer describes
the platform. The facts a reviewer checks instead:

- **LP at graduation.** 100 % of the graduation LP is **locked** with Raydium's LP lock (LaunchLab `platformScale` 1,000,000 /
  `creatorScale` 0 / `burnScale` 0), never withdrawable; nothing is burned. The Fee Key NFT is owned by the burn_receipts PDA
  `["fee_keys"]` (the platform's `platformLockNftWallet`); `initialize_token` and the buyback cranks refuse a platform whose lock-NFT
  wallet or LP scales differ. pair_curve's `graduate` no longer burns LP; the permissionless `lock_lp` locks it with the same Fee Key owner.
- **LP fees.** The permissionless `claim_lock_fees` collects the lock's fees and splits the SOL side by compiled constants:
  `LOCK_FEE_BURN_BPS = 8000` to the coin's fee PDA (the burn pool), `LOCK_FEE_OPERATOR_BPS = 2000` to `OPERATOR_TREASURY` (the Squads
  vault; the mainnet build is unpinned and refuses `TreasuryNotPinned` until the owner compiles the vault in); the coin side is burned.
  No admin key or config field changes the split.
- **Item 8 floor.** Unchanged: `register_pool` still needs ≥ 50 % of the pool's live LP burned or locked (≥ 90 % for the fallback pool);
  public copy now reads "≥ 50 % at registration (≥ 90 % for the fallback pool); our platform locks 100 % at graduation".
- **Instruction count (item 1).** With `register_fee_key` and `claim_lock_fees` burn_receipts has **26 entrypoints** in its
  `#[program]` module; the IDL, the Powers Register and the whitepaper's §13.3 list 26. pair_curve gains `lock_lp`.
- **Economics a reviewer can recompute.** Per swap after graduation (CPMM tier 0, 25 bps): 21 bps LP fees → 16.8 bps burn pool + 4.2 bps
  operator; 3 bps RAY buyback + 1 bp Raydium treasury; plus the 4.75 bps creator fee to the burn pool. The operator earns 20 % of the
  post-graduation LP fees; this is new income for the operator and is stated on the trust page and in the fee tables.

## Erratum 2026-10-11 (LP lock round 2, after the LP-lock blind review)

The text above and the earlier errata stay as written. Round 2 (the review's RL-2 / RL-3 / L-1..L-3) changes what a reviewer checks:

- **Instruction counts (item 1).** burn_receipts still has **26 entrypoints**; pair_curve has **9 entrypoints** with the new `burn_lp`.
  The IDLs, the Powers Registers and the whitepaper's §13.3 agree.
- **Registration order.** For policy 0, `register_fee_key` runs BEFORE `register_pool`, which takes the FeeKeyRecord
  (`FeeKeyNotRegistered`, `FeeKeyMismatch`); a lock position is identified by its locker (LaunchLab's vault_auth, or the pair vault);
  `claim_lock_fees` takes no arguments and claims against the FeeKeyRecord's pool; memo v2 adds `paid` / `pending`.
- **New pin.** `BURNTICKER_PLATFORM` is compiled into burn_receipts (mainnet zeros → `PlatformNotPinned`); `initialize_token` for
  policies 0 and 2 refuses any other LaunchLab platform.
- **burn_lp.** pair_curve's fallback after 30 days of a refusing lock — the only path that destroys LP; it refuses before then and once
  `lock_lp` ran.

## Erratum 2026-10-11 (winner takes the burn, LAUNCHPAD-PATH §40)

The text above and the earlier errata stay as written. The owner's §40 decision (a pair's loser fuels the winner's burn) adds three
burn_receipts entrypoints and changes what a reviewer checks for paired coins only; a single coin's path is unchanged:

- **Instruction count (item 1).** burn_receipts now has **29 entrypoints**: the 26 above plus `link_pair`, `submit_pair_result` and
  `forward_to_winner`. The IDL, the Powers Register and the whitepaper's §13.3 list 29 (32 event types, 90 error codes).
- **Pairing.** A TokenConfig names its partner (`pair_mint`) at `initialize_token`, and the pair is `paired` once the partner names it
  back inside the 7-day pairing window, or by the permissionless `link_pair` (a pair_curve Pair holds both mints). For policy 2,
  `link_pair` runs before `register_pair_pool` (`PairNotLinked` otherwise).
- **Pair results.** `submit_pair_result` writes `["pair_result", mint_lo, mint_hi, date]`, signed by BOTH coins' attester quorums over
  `BURNRECEIPTS-PAIR-v1|<genesis>|<program>|<lo>|<hi>|<date>|winner=<b58|draw>|src=<hex>|proof=<hex>`. Its event
  `PairResultSubmitted` is a plain `emit!` log (not `emit_cpi!`). Two attester signatures fit a legacy transaction; quorums above
  two need a v0 transaction with an address lookup table.
- **The forward.** For the loser's period, `crank_buyback` refuses with `ForwardRequired`; `forward_to_winner` moves exactly what the
  loser's own rule would have spent (`buyback_spend` of its pool at its units and fraction; a one-shot pair's 100 %) into the winner's
  WSOL account, writes the forward memo and marks the loser's reading outcome 6 (forwarded). The loser's supply is untouched and
  nobody is paid. A draw or a void forwards nothing. With no result the crank waits (`PairResultPending`) for up to 72 h, then burns
  unpaired.

## Erratum 2026-10-11 (winner takes the burn round 2, after the pair-forward blind review)

The text above and the earlier errata stay as written. The pair-forward blind review's fixes (H-1, M-1, M-2, L-1..L-4) change what a
reviewer checks for paired coins only:

- **Instruction count (item 1).** burn_receipts now has **30 entrypoints**: the 29 above plus `unlink_pair`. The IDL, the Powers Register
  and the whitepaper's §13.3 list 30 (34 event types with `PairForwardMissing` and `PairUnlinked`, 94 error codes).
- **No wedge (H-1).** A win is recorded only when both coins read the date and the loser's reading is unprocessed (`PairResultNotServable`
  otherwise; no pool condition, and the keeper never substitutes a draw). `forward_to_winner` takes no winner reading; a side without a
  verified pool forwards 0 lamports and still processes the loser's reading (the memo is always written), so a lost period never burns the
  losing coin. A LOST period whose forward never lands cranks as unpaired 72 h after the reading (`PairForwardMissing`); `planCrank`
  plans the paired buyback from that point.
- **The loser consents (M-1).** A win needs the loser's attester quorum, the winner's too only after a loser attester rotation since pairing
  (PairLink keeps the attester-set hash); a draw needs both quorums; repeated submissions are signature-checked.
- **Unlink (M-2).** `unlink_pair`, permissionless, on evidence only: the pair_curve Pair Voided, a side refunding, or a coin without a
  verified pool 30 days after pairing (`PairStillLive` otherwise; reasons 0 / 1 / 2 in `PairUnlinked`).
- **Ordering (L-1..L-4).** `link_pair` refuses once either coin has a reading (`PairHasReadings`); no result predates the pairing day
  (`PairDateBeforePairing`); `initialize_token` with `pair_mint` always takes the partner's PairLink address; WSOL is measured as lamports
  minus rent after a sync.

## Erratum 2026-10-11 (pair-forward round-2 re-check, RI-2 wording)

The text above and the earlier errata stay as written; one sentence of the round-2 erratum is corrected here. burn_receipts still has
**30 entrypoints**. Where the round-2 erratum says "so a lost period never burns the losing coin", read: a lost period never burns the losing
coin unless no forward lands within 72 hours, in which case it burns as a plain period and a `PairForwardMissing` event is published.
Against a side without a verified pool the forward moves 0 lamports and the fuel stays in the loser's pool, where the loser's own later burns
spend it. The whitepaper's §5.5, PAIR-CURVE.md and ATTESTERS.md carry the same wording.

## Erratum 2026-10-11 (pair-forward round 3, after the re-check)

The text above and the earlier errata stay as written. Round 3 (re-check RN-1, RN-2, M-1, RI-1, RI-4) changes what a reviewer checks for
paired coins only; a single coin's path is unchanged:

- **Instruction count (item 1).** burn_receipts now has **31 entrypoints**: the 30 above plus `apply_paired_attester_change`. The IDL, the
  Powers Register and the whitepaper's §13.3 list 31 (34 event types, 100 error codes; `PairHasReadings` is no longer raised).
- **Unlink is terminal only (RN-1, RN-2).** `unlink_pair` accepts a voided pair_curve Pair, a refunding side (the Pair is required for a
  pair_curve coin; an Open pair is always refused), or a LaunchLab pair whose locked `pair_void_by` day ended with a coin unverified
  (`UNLINK_VOID_BY_PASSED`). The 30-day not-live evidence is gone. Unlinked coins are `PAIR_STATE_UNLINKED` and still register a pool.
- **Pairing (M-1).** Both coins must have the same attester set and quorum (`PairAttestersDiffer`); every result needs both quorums; a
  paired coin's attester change goes through `apply_paired_attester_change` with the partner's quorum co-signing. `initialize_token` with
  `pair_mint` takes `pair_void_by` (`InvalidPairVoidBy`). `link_pair` accepts coins with readings: those periods stay unpaired
  (`pair_after_date`; `PairPeriodUnpaired` for a result naming them); it refuses only a voided Pair or a refunding side (`PairTerminal`).
- **Forward window and basis (RI-1, RI-4).** `forward_to_winner` is refused 72 h after the loser's reading (`ForwardWindowClosed`); its
  basis leaves the loser's carried spend.

## Erratum 2026-10-12 (market cap on coin cards, owner decision)

The text above and the earlier errata stay as written. On 2026-10-12 the owner decided, on Claude site audit 2 item 7, that coin cards show
the market cap ("people like to see the market cap"). The UI rule is now: no price or odds for any Burnticker coin and no commentary on
any number; a coin's card and page may show its market cap as a bare number read from its curve or pool (owner decision 2026-10-12); another
coin's market cap may be a rule input, shown only as the rule sentence. What a reviewer checks:

- **Instruction count (item 1).** Unchanged: burn_receipts has **31 entrypoints**. Nothing on chain changed; this is a display rule.
- **Where it appears.** Only as the "Market cap" row of a coin card (`src/lib/burnticker/cardView.ts`) and of the coin page's facts
  (`src/lib/burnticker/coinPage.ts` `marketFacts`), never in a sentence, a post or a headline. The copy lint is unchanged and still refuses "market cap" in prose.
- **Where the number comes from.** Before graduation, the LaunchLab curve's own reserves: (virtualB + realB) / (virtualA − realA) times
  the pool's total supply (`src/lib/burnticker/market.ts` `curveMarketCap`, pinned against the Raydium SDK on real mainnet pools). After
  graduation the Raydium pool's reserves; until this site reads them the row shows a dash with that reason. Never an estimate.

## Erratum 2026-10-12 (end sinks, LAUNCHPAD-PATH §45, program round 4)

The text above and the earlier errata stay as written. Round 4 adds the end-of-rule sink; a coin launched without an EndSink (every coin
before this round) is unchanged:

- **Instruction count (item 1).** burn_receipts now has **33 entrypoints**: the 31 above plus `submit_rule_end` and `forward_on_end`. The
  IDL, the Powers Register and the whitepaper's §13.3 list 33 (37 event types, 110 error codes).
- **EndSink.** `initialize_token` may pin an EndSink (["end_sink", mint], never changed): the flagship ($DEFICIT, compiled per cluster as
  `BURNTICKER_FLAGSHIP`), a named coin, or the pair winner (the partner named in the same create). League sets are refused for now. The
  flagship itself cannot have one.
- **RuleEnd.** `submit_rule_end` records a quorum-signed end (`BURNRECEIPTS-END-v1`, outcome resolved or void) once per coin with an
  EndSink. After a RESOLVED end no reading dated later than the end is accepted (`RuleEnded`) or cranked (`ForwardOnEndRequired`); the
  reading that ended the rule still cranks. A VOID end changes nothing on chain: the coin's wind-down applies.
- **forward_on_end.** Permissionless (the cranker allowlist applies while the pre-audit cap is in force). After a resolved end, once every
  reading inside the window is processed, it moves the fee PDA's spendable SOL and WSOL (under the burn-pool cap, at least the EndSink's
  minimum) to the destination the program picks: the named coin while it is live, the partner only when the end date's PairResult names
  it and the pair is still paired, otherwise the flagship. The caller chooses no amount and no destination. Callable again for the later
  fee trickle. The coin's carried spend is cleared by the first forward.
- **What a reviewer checks.** SOL leaves a fee PDA in three places now: `crank_buyback`, `forward_to_winner`, and `forward_on_end`; the
  last only to another coin's fee PDA chosen by the program, and never as a refund or a payout.
- **Pair-forward round-3 re-check, fixed in the same upgrade.** P3-1: `register_pair_pool` also admits a coin whose `link_pair` never
  landed when the Pair shows the OTHER side refunding, and records it unlinked (a plain coin); the launch bundle sends `link_pair` in the
  `init_pair` transaction. P3-2: `apply_paired_attester_change` sets the one new set on BOTH coins and both PairLinks in one instruction
  (it now takes the partner's PairLink). P3-I1: `forward_to_winner` refuses `NotPaired` after an unlink, so the plain loser burns its own
  period. The entrypoint, event and error counts above are unchanged.
