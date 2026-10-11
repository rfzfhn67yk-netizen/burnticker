# Security policy and bug bounty

Burnticker is **not audited by a security firm** (owner decision, 2026-10-09). It is reviewed by three blind AI reviews of the
burn_receipts program and one re-check (published), two blind AI reviews of the pair_curve program (in progress), an adversarial
ChatGPT/Codex PR review (published 2026-10-10 with a per-finding response) and this public bounty. Every report is published in full under `docs/burnticker/reviews/` as it is
delivered. The program runs behind a 25 SOL per-burn-pool cap (with a dated sunset) for exactly this reason.

## Bounty — PLACEHOLDER TERMS (the owner finalises every TODO before launch)

| | |
|---|---|
| Bounty wallet | `HATDNP3MsmsxGcbKKjnoXXPBb46aLaMTdzLG3TfHJv2u` (mainnet, held by the operator; funding of 5–10 SOL pending); its balance is shown live on the trust page (`/burnticker/trust`) |
| Amount | **5–10 SOL**, set aside from the developer fee (25 bps of curve volume), per the owner's decision of 2026-10-09. Exact tiers: TODO. |
| Status | **not published** — these terms are a draft until the owner removes this line |
| Contact | security@burnticker.com (the operator contact on the trust page is contact@burnticker.com; both reach the operator directly) |
| Response | acknowledge within 72 h; a fix or a published decision within 14 days |

### How a valid report is paid

1. The report is acknowledged and reproduced; the reporter is told the severity we assign and why.
2. The fix (or the decision not to fix, with the reason) is published, with the report, under `docs/burnticker/reviews/`.
3. The amount for the severity is sent by the operator from the bounty wallet to the address the reporter names, with the transaction signature posted in the report thread.
4. Duplicates: the first complete report is the one paid. A report about something the Powers Register or the known-limitations list
   already states as a power or a gap is acknowledged and not paid.

### Published list of reports

Paid and rejected reports are listed here and in `config/burnticker/transparency.json` → `howBuilt.bounty.reports` (shown on the
trust page), each with the date, the severity, the decision and the transaction or the reason.

| Date | Report | Severity | Decision | Transaction / reason |
|---|---|---|---|---|
| — | none yet | — | — | — |

### In scope

- `programs/burn-receipts/` — anything that lets SOL or tokens leave a fee PDA, a vault or a pool other than through `crank_buyback`'s
  swap-and-burn; a reading written without a valid quorum; a rule, reading or receipt changed after the fact; a cap raise or
  attester change applied before its 48 h timelock; a quorum lowered; any instruction the Powers Register does not describe.
- `programs/burn-receipts/programs/pair_curve/` — any way to move a pair's SOL or tokens other than by the curve formula to the
  recorded recipients; a privileged signer after `init_pair`; LP not burned at graduation.
- `src/lib/burnReceipts/`, `src/lib/burnKeeper/`, `src/lib/burnticker/` — the keeper signing a transaction the validator should
  have refused; a market price reaching a rule; a void or unsettled market burning; the registry accepting an update or a delete;
  the audit passing on a tampered receipt; the pre-audit cap not binding; the receipt verifier on `/burnticker/check` showing ✓ for
  a receipt that does not match the chain or the source.
- `src/app/api/burnticker/` — a cross-site request mutating anything; a route leaking a value it says it never reads.
- `scripts/ops/publish-public-repo.sh` — a way to make the public tree carry a file the allowlist does not name, or to pass the
  leak scan with a pattern it should catch.
- `scripts/ops/verified-build.sh` — a way for the published hash table to disagree with the build it describes.

### Out of scope

- Raydium LaunchLab / CPMM, Jupiter, Polymarket's contracts, Pyth, RedStone, Reclaim and Solana themselves (report to them; tell us too).
- Denial of service against the keeper or the site; social engineering; findings that need a compromised operator key (the
  Powers Register already states what that key can do).
- Market behaviour of any coin.

### Severity (draft)

- **Critical** — funds leave a program account other than by swap-and-burn; a burn happens with no settled reading. Top of the range.
- **High** — a reading or receipt can be forged or altered; the timelock or quorum can be bypassed.
- **Medium** — the audit, the trust page or the receipt verifier can be made to show green on a false state.
- **Low** — everything else that is a real defect.

Please report privately first. We do not take legal action against good-faith research that respects users' funds and data.

## Incidents and postmortems

A confirmed report, and anything else that went wrong in production (a wrong or doubled burn, the public audit red, a key event, two
keepers active at once, a snapshot that does not verify …), is an incident under the incident policy:
[`docs/burnticker/INCIDENTS.md`](docs/burnticker/INCIDENTS.md). The short version: a log line as soon as it is known, a full public
postmortem within 48 hours (template: [`docs/burnticker/incidents/TEMPLATE.md`](docs/burnticker/incidents/TEMPLATE.md)), published in
`docs/burnticker/incidents/` and on the trust page, signed by the operator. A security report is published once it is safe to do so.
