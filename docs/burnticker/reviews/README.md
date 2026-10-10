# Security reviews of Burnticker — what appears here

Burnticker is **not audited by a security firm** (owner decision, 2026-10-09: no paid audit). In its place: independent adversarial
AI reviews, free tooling and a public bounty, all published here in full. This folder is rendered from the trust page
(/burnticker/trust → "How this was built"); `config/burnticker/transparency.json` carries each review's status and report path.

## Status

Three independent blind Claude reviews and one re-check of the `burn_receipts` program were completed on 2026-10-09/10. Each
reviewer was a fresh Claude agent given the code, with no prior exposure; each read the earlier reports and the CHANGELOG only after
writing its own findings. Every fix and its closing test is in `docs/burn-receipts/CHANGELOG.md`.

| Review | Reviewer | Status | Report |
|---|---|---|---|
| claude-blind-1 | a fresh Claude agent given the code only | completed 2026-10-09 (2 High, 4 Medium, 7 Low, 6 Info) | [2026-10-09-claude-blind-1.md](2026-10-09-claude-blind-1.md) |
| claude-blind-2 | a fresh Claude agent, no prior exposure | completed 2026-10-10 (5 Medium, 4 Low, 8 Info) | [2026-10-10-claude-blind-2.md](2026-10-10-claude-blind-2.md) |
| claude-blind-3 + re-check | a fresh Claude agent, no prior exposure; its re-check of the round-3 fixes is the last section of the same report | completed 2026-10-10 (3 Medium, 6 Low, 6 Info; re-check 4 Low, 2 Info) | [2026-10-10-claude-blind-3.md](2026-10-10-claude-blind-3.md) |
| chatgpt-adversarial | ChatGPT, the same pre-registered checklist | pending | — |
| tooling | cargo-audit, clippy pedantic, anchor verify / solana-verify, Trident fuzzing where feasible, Sec3 X-ray free tier | partly run: clippy `--all-targets -D warnings` clean (review 3 re-check); the rest not run | — |
| bounty | public, 5–10 SOL from the developer fee (SECURITY.md in the public repository) | not published | — |

`checklist.md` has not been committed to this folder; the checklist verdicts each reviewer gave are inside its report.

## What appears here, and the rules

- `checklist.md` — the pre-registered checklist for the remaining reviews, committed BEFORE the review starts, so the questions
  cannot be tuned to the answers (not committed yet).
- `YYYY-MM-DD-claude-blind-N.md` (three present) and `YYYY-MM-DD-chatgpt-adversarial.md` (pending) — each report **as delivered**, unedited. Every finding
  keeps its original severity and wording. A finding that turns out to be wrong is answered under it, not removed.
- `YYYY-MM-DD-tooling.md` — the raw output of the free tooling run against the tagged commit.
- `findings.md` (not written yet; until then `docs/burn-receipts/CHANGELOG.md` is the per-finding record) — one table across all reviews: id, source, severity, status (open / fixed in `<commit>` / accepted with reason /
  disputed with reason). Nothing is ever deleted from it.
- `bounty/` — every bounty submission that was paid or rejected, with the reason and the transaction of the payment.

From now on each report names the commit it reviewed (and, once the program is built verifiably, the program hash); of the three
reports so far only blind review 3 names its commit (`7eaee66`) (the same values `scripts/ops/publish-public-repo.sh --tag`
records in `CHANGELOG.md`), so a reader can check that the code reviewed is the code deployed.
