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
