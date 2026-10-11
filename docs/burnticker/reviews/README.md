# Security reviews of Burnticker — what appears here

Burnticker is **not audited by a security firm** (owner decision, 2026-10-09: no paid audit). In its place: independent adversarial
AI reviews, free tooling and a public bounty, all published here in full. This folder is rendered from the trust page
(/burnticker/trust → "How this was built"); `config/burnticker/transparency.json` carries each review's status and report path.

## Status

**Latest disposition:** the third ChatGPT/Codex code review and its live UX review (2026-10-11, scoped `782e31ec..191d3b3b`) —
[response](2026-10-11-chatgpt-review-3-response.md): F1 (P2, an unreadable ProgramData account shown as "no upgrade authority") fixed
with regression tests; nine of the ten UX changes done, the pre-wallet launch summary deferred while creator launches stay closed.
Before it: the second ChatGPT/Codex review (public commit `07b7b4f5`) — [response](2026-10-11-chatgpt-pr-review-2-response.md): F1, F2,
F3, F4 and F6 fixed with regression tests; F5 (= pair-forward re-check RN-1/RN-2) is fixed in pair round 3 (`burnticker/pair-forward-r3`).

The folder holds **thirteen review reports** (ten before 2026-10-11, as review 2 counted them; the third blind Claude review carries
its own re-check as its last section; the third ChatGPT round is two reports, code and UX, with one response). Three responses, this README and the pre-registered checklist are documents about the reviews, not
reviews. "Blind" is each report's own description of how it was run, not an independent check of the reviewer's independence. Latest
first:

| Review | Reviewer | Status | Report |
|---|---|---|---|
| chatgpt-adversarial-3 | ChatGPT/Codex: third code review, scoped 782e31ec..191d3b3b (public commit 191d3b3b) | completed 2026-10-11 (one P2, F1; disposition in [2026-10-11-chatgpt-review-3-response.md](2026-10-11-chatgpt-review-3-response.md)) | [2026-10-11-chatgpt-pr-review-3.md](2026-10-11-chatgpt-pr-review-3.md) |
| chatgpt-ux-3 | ChatGPT: third live UX + feature review of the public site (against public commit 191d3b3b) | completed 2026-10-11 (ten changes: nine done, one deferred; same response file) | [2026-10-11-chatgpt-ux-review-3.md](2026-10-11-chatgpt-ux-review-3.md) |
| chatgpt-adversarial-2 | ChatGPT/Codex: second adversarial code review + live-site UX audit, the same checklist (reviewed public commit 07b7b4f5) | completed 2026-10-11 (3 P1, 3 P2, UX cuts, ten explanation mismatches; per-finding disposition in [2026-10-11-chatgpt-pr-review-2-response.md](2026-10-11-chatgpt-pr-review-2-response.md)) | [2026-10-11-chatgpt-pr-review-2.md](2026-10-11-chatgpt-pr-review-2.md) |
| pair-forward-recheck | a fresh Claude agent re-checking the pair-forward round-2 fixes | completed 2026-10-11 (H-1 + Lows closed; M-1 residual; RN-1 High: 30-day unlink evidence could unlink a healthy open pair; RN-2 Medium; tests #[ignore]d under tests/review_pair_r2.rs; round 3 on burnticker/pair-forward-r3) | [2026-10-11-pair-forward-recheck.md](2026-10-11-pair-forward-recheck.md) |
| pair-forward-blind | a fresh Claude agent reviewing the winner-takes-the-burn release blind (link_pair, submit_pair_result, forward_to_winner, the paired crank gate) | completed 2026-10-11 (1 High, 2 Medium, 4 Low, 7 Info; exploit tests #[ignore]d under tests/review_pair.rs) | [2026-10-11-pair-forward-blind.md](2026-10-11-pair-forward-blind.md) |
| lp-lock-blind | a fresh Claude agent reviewing the LP-lock release blind (register_fee_key, claim_lock_fees, lock_lp), the real Raydium lock binary loaded in place of the test mock | completed 2026-10-11 (0 Critical/High, 2 Medium, 3 Low, 8 Info; exploit tests #[ignore]d under tests/review_lock.rs) | [2026-10-11-lp-lock-blind.md](2026-10-11-lp-lock-blind.md) |
| chatgpt-adversarial | ChatGPT/Codex adversarial PR review, the same pre-registered checklist (reviewed public commit 58d43eae) | completed 2026-10-10 (2 High, 5 Medium; response in [2026-10-10-chatgpt-pr-review-response.md](2026-10-10-chatgpt-pr-review-response.md)) | [2026-10-10-chatgpt-pr-review.md](2026-10-10-chatgpt-pr-review.md) |
| paircurve-recheck | a fresh Claude agent re-checking the pair_curve blind-review fixes (commit 4eda2e3d) | completed 2026-10-10 (every High fixed; R2 M-1 partly fixed; one new Low; residual tests in review_pc3.rs) | [2026-10-10-pair-curve-recheck.md](2026-10-10-pair-curve-recheck.md) |
| paircurve-blind-2 | a second fresh Claude agent reviewing pair_curve blind (economics, griefing, liveness) | completed 2026-10-10 (3 High, 2 Medium, 4 Low, 5 Info) | [2026-10-10-pair-curve-blind-2.md](2026-10-10-pair-curve-blind-2.md) |
| paircurve-blind-1 | a fresh Claude agent reviewing the pair_curve program blind, the pre-registered checklist | completed 2026-10-10 (2 High, 2 Medium, 3 Low, 3 Info) | [2026-10-10-pair-curve-blind-1.md](2026-10-10-pair-curve-blind-1.md) |
| claude-blind-3 + re-check | a fresh Claude agent, no prior exposure; its re-check of the round-3 fixes is the last section of the same report (embedded, not a separate file) | completed 2026-10-10 (3 Medium, 6 Low, 6 Info; re-check 4 Low, 2 Info) | [2026-10-10-claude-blind-3.md](2026-10-10-claude-blind-3.md) |
| claude-blind-2 | a fresh Claude agent, no prior exposure | completed 2026-10-10 (5 Medium, 4 Low, 8 Info) | [2026-10-10-claude-blind-2.md](2026-10-10-claude-blind-2.md) |
| claude-blind-1 | a fresh Claude agent given the code only | completed 2026-10-09 (2 High, 4 Medium, 7 Low, 6 Info) | [2026-10-09-claude-blind-1.md](2026-10-09-claude-blind-1.md) |
| tooling | cargo-audit, clippy pedantic, anchor verify / solana-verify, Trident fuzzing where feasible, Sec3 X-ray free tier | partly run: clippy `--all-targets -D warnings` clean (review 3 re-check); the rest not run | — |
| bounty | public, 5–10 SOL from the developer fee (SECURITY.md in the public repository) | wallet funded 2026-10-11 (5 SOL); terms' exact tiers still open | — |

Every fix and its closing test for the program reviews is in `docs/burn-receipts/CHANGELOG.md`; the ChatGPT/Codex reviews are
answered finding by finding in their response files (the third round, code and UX, shares one response).

`checklist.md` (items 1–17 + UI trust rules) was committed on 2026-10-10 before the ChatGPT review started; the three Claude reviews answered items 1–12 inside their reports.

## What appears here, and the rules

- `checklist.md` — the pre-registered checklist for the remaining reviews, committed BEFORE the review starts, so the questions
  cannot be tuned to the answers (committed 2026-10-10).
- every report listed above (thirteen present; three response files) — each report **as delivered**, unedited. Every finding
  keeps its original severity and wording. A finding that turns out to be wrong is answered under it, not removed.
- `YYYY-MM-DD-tooling.md` — the raw output of the free tooling run against the tagged commit.
- `findings.md` (not written yet; until then `docs/burn-receipts/CHANGELOG.md` is the per-finding record) — one table across all reviews: id, source, severity, status (open / fixed in `<commit>` / accepted with reason /
  disputed with reason). Nothing is ever deleted from it.
- `bounty/` — every bounty submission that was paid or rejected, with the reason and the transaction of the payment.

From now on each report names the commit it reviewed (and, once the program is built verifiably, the program hash); of the three
reports so far only blind review 3 names its commit (`7eaee66`) (the same values `scripts/ops/publish-public-repo.sh --tag`
records in `CHANGELOG.md`), so a reader can check that the code reviewed is the code deployed.
