# Security policy and bug bounty

Burnticker is **not audited by a security firm** (owner decision, 2026-10-09). It is reviewed by two independent AI adversarial
reviews and by this public bounty; the reports are published in full under `docs/burnticker/reviews/` as they arrive. Until then
that folder's README says what will appear. The program runs behind a 25 SOL per-burn-pool cap (with a dated sunset) for exactly
this reason.

## Bounty — PLACEHOLDER TERMS (the owner finalises every TODO before launch)

| | |
|---|---|
| Pool | **5–10 SOL**, paid from the developer fee (25 bps of curve volume), per the owner's decision of 2026-10-09. Exact tiers: TODO. |
| Status | **not published** — these terms are a draft until the owner removes this line |
| Contact | security@burnticker.com (the operator contact on the trust page is contact@burnticker.com; both reach the operator directly) |
| Response | acknowledge within 72 h; a fix or a published decision within 14 days; the report and the payment transaction published with the review reports |

### In scope

- `programs/burn-receipts/` — anything that lets SOL or tokens leave a fee PDA, a vault or a pool other than through `crank_buyback`'s
  swap-and-burn; a reading written without a valid quorum; a rule, reading or receipt changed after the fact; a cap raise or
  attester change applied before its 48 h timelock; a quorum lowered; any instruction the Powers Register does not describe.
- `src/lib/burnReceipts/`, `src/lib/burnKeeper/`, `src/lib/burnticker/` — the keeper signing a transaction the validator should
  have refused; a market price reaching a rule; a void or unsettled market burning; the registry accepting an update or a delete;
  the audit passing on a tampered receipt; the pre-audit cap not binding.
- `src/app/api/burnticker/` — a cross-site request mutating anything; a route leaking a value it says it never reads.
- `scripts/ops/publish-public-repo.sh` — a way to make the public tree carry a file the allowlist does not name, or to pass the
  leak scan with a pattern it should catch.

### Out of scope

- Raydium LaunchLab / CPMM, Jupiter, Polymarket's contracts, Pyth, RedStone, Reclaim and Solana themselves (report to them; tell us too).
- Denial of service against the keeper or the site; social engineering; findings that need a compromised operator key (the
  Powers Register already states what that key can do).
- Market behaviour of any coin.

### Severity (draft)

- **Critical** — funds leave a program account other than by swap-and-burn; a burn happens with no settled reading. Top of the pool.
- **High** — a reading or receipt can be forged or altered; the timelock or quorum can be bypassed.
- **Medium** — the audit or the trust page can be made to show green on a false state.
- **Low** — everything else that is a real defect.

Please report privately first. We do not take legal action against good-faith research that respects users' funds and data.
