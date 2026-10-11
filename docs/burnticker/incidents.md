# Burnticker incident policy

Owner-approved 2026-10-10 (night). This page says what counts as an incident, how fast it is told, where it is published and who
signs it. The log itself is [incidents/LOG.md](incidents/LOG.md) (append-only, rendered on `/burnticker/trust`); each postmortem is
a file in [incidents/](incidents/) written from [incidents/TEMPLATE.md](incidents/TEMPLATE.md). Security reports go to
security@burnticker.com first ([SECURITY.md](../../config/public-repo/overlay/SECURITY.md)); a confirmed one becomes an incident
under this policy once it is safe to publish.

## What counts as an incident

Any one of these, whether or not anyone noticed, whether or not money moved:

1. **A wrong burn** — a receipt whose units, spend or burned amount differ from what the published rule and the settled source give;
   a burn on a void, unsettled or refused market; a burn for a reading that should have been withheld.
2. **A missed or doubled burn** — a reading counted twice (two keepers, a replayed reading), or a settled result that should have
   burned and never did once the source posted (late is not an incident; *lost* is).
3. **The public audit red** — `audit.json` `ok: false` for any reason, including a code change in the recompute.
4. **A key event** — any keeper, upload, platform-admin or upgrade key exposed, lost or used outside the runbook; a rotation that
   was not planned.
5. **A ledger event** — a registry restored from a backup, a write the append-only triggers refused that came from our own code, a
   snapshot that does not verify, a snapshot day missed for more than 48 hours.
6. **Two active keepers** — both the leader and the standby active at the same time (status pages, the `bt-keeper-yielded` /
   `bt-keeper-takeover` alerts), or a foreign-reading hold (`bt-foreign-reading`) that needed a human to reconcile.
7. **A source failure that changed an outcome** — a cross-read disagreement resolved by hand, a venue re-settling a result we had
   recorded (`bt-reading-conflict`), a source withdrawn while coins depend on it.
8. **The site said something false** — a page, post or API answer that stated a wrong fact about a coin, a fee or a power, for
   longer than one publish cycle.
9. **A program event** — any upgrade, any instruction failing in a way the Powers Register does not describe, any finding in a
   review or the bounty rated medium or above.

Not incidents (recorded in the changelog instead): a planned deploy, a source that is late and posts later, a keeper restart
between cycles, a feed outage that withheld readings and burned nothing (the status page shows those live).

## The 48-hour rule

| When | What |
|---|---|
| the day it is known | a one-line entry in [incidents/LOG.md](incidents/LOG.md) (date, what, status "open") and, if it is user-facing, a post from the incident template (`scripts/burnkeeper-post-draft.mts --template=incident`, copy-linted). Nothing is deleted on X; corrections go in-thread with the receipt. |
| within 48 hours | the full postmortem, `incidents/YYYY-MM-DD-<slug>.md` from the template: timeline in UTC and Denver time, impact in receipts and lamports, root cause, what was changed, what was not, and how anyone can check it themselves. If the cause is not known yet, the postmortem says so and gives the date of its next update. |
| after | each update is a new dated section in the same file; the log line gets a new line, never an edit. |

A postmortem never names a person outside the operator, never includes a secret, and never promises an outcome. Copy lint applies.

## Where it is published

- The monorepo: `docs/burnticker/incidents/` (the log and every postmortem).
- The public repository, same paths, at the next publish (`sh scripts/ops/publish-public-repo.sh --tag --verify`), which also tags
  the changelog. A postmortem is published with the next publish even if nothing else changed.
- The trust page renders the log; its "Incident policy" line links this page, the template and the log.
- For incidents 1–3: a pinned post on @BurnTicker linking the postmortem, and the affected coins' status pages carry the incident's
  date until it is closed.

## Who signs it

The operator, the Burnticker operator, signs every postmortem: by name at the end of the document, and with an ed25519 signature over the
document's sha256 from the operator's developer fee wallet — the same key that signs the operator statement
(`config/burnticker/operator.json` → `signedMessage`, verified on `/burnticker/operator`). Until that mainnet wallet exists, the
name and the signed git commit that adds the file are the signature, and the postmortem says so. A correction to a postmortem is
signed the same way.

How to sign (the operator, on the operator's machine):

```sh
shasum -a 256 docs/burnticker/incidents/2026-10-12-example.md          # the hash to sign
# sign the line "Burnticker postmortem <file> sha256 <hash>" as an off-chain message with the developer fee wallet
# paste the base58 signature into the postmortem's "Signed" section
```

## Drills

The monthly source-outage drill (`scripts/burnticker-drill.mts`, runbook "Monthly drills") is not an incident; a drill that FAILS
is one (category 3 or 7), because it means a real outage would not be withheld or not be shown.
