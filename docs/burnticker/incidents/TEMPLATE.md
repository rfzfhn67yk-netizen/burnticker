# Postmortem: <one line, what happened — no adjectives>

<!-- Copy this file to docs/burnticker/incidents/YYYY-MM-DD-<slug>.md. Policy: ../INCIDENTS.md. Publish within 48 hours of knowing.
     Facts only; copy lint applies (config/launch/copy-lint.json). No secrets, no private names, no promises. -->

| | |
|---|---|
| Incident date (UTC) | YYYY-MM-DD HH:MM |
| Known since (UTC / Denver) | YYYY-MM-DD HH:MM / YYYY-MM-DD HH:MM |
| Postmortem published | YYYY-MM-DD (≤ 48 h after "known since") |
| Category (INCIDENTS.md) | 1 wrong burn · 2 missed/doubled · 3 audit red · 4 key · 5 ledger · 6 two keepers · 7 source · 8 false statement · 9 program |
| Status | open / mitigated / closed |
| Coins affected | $TICKER (mint …), or "none" |

## What happened

Two to five sentences a holder can read: what the system did, what it should have done.

## Impact

- Receipts affected: event ids, reading dates, signatures (explorer links).
- Lamports / tokens: what was spent or burned that should not have been, or was not that should have been — computed, with the
  formula.
- What was NOT affected (say it explicitly: "no burn pool lost SOL", "no rule changed").

## Timeline (UTC, Denver in brackets)

- YYYY-MM-DD HH:MM (HH:MM) — …

## Root cause

The cause, with the file and line or the transaction. If not known yet: "not known yet; next update by YYYY-MM-DD."

## What we changed

Commits, deploys, config changes, alerts added. Link each.

## What we did not change, and why

## Check it yourself

The commands a stranger runs to confirm every number above: `scripts/burnticker-audit.mts`, `scripts/burnticker-verify-snapshot.mts
<txid> --db <copy>`, the receipt verifier, `solana confirm -v <signature>`.

## Signed

The operator — YYYY-MM-DD.
Document sha256: `<shasum -a 256 of this file before this section was filled>`.
Signature (developer fee wallet, ed25519, base58) over "Burnticker postmortem <file> sha256 <hash>": `<signature>` — or, until that
wallet exists: "signed by the git commit that adds this file".
