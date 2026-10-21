# Postmortem: the daily registry snapshot was not pinned on time

| | |
|---|---|
| Incident date (UTC) | 2026-10-20 00:15 |
| Known since (UTC / Denver) | 2026-10-20 00:15 / 2026-10-19 18:15 |
| Postmortem published | 2026-10-21 |
| Category (INCIDENTS.md) | 5 ledger (a snapshot day missed; the copy was pinned about one hour later) |
| Status | closed |
| Coins affected | none |

## What happened

The daily job that pins a copy of the coin registry to Arweave through Irys failed at 18:15 Denver on 2026-10-19 with "402: not enough
balance for transaction". The upload account's prefunded Irys balance was 0, so that day's public copy of the registry was not pinned
at its usual time. The operator funded the balance, and the keeper's next retry pinned the copy about one hour later.

## Impact

- Receipts affected: none. No burn, reading or receipt was affected. Each coin's own receipts and pinned descriptions are separate.
- The registry copy for 2026-10-20 was pinned at 19:16 Denver instead of 18:15, about one hour late.
- While the balance was 0, a launch that needed an upload would have been refused.
- What was NOT affected: no burn pool lost SOL, no rule changed, no registry row was lost.

## Timeline (UTC, Denver in brackets)

- 2026-10-20 00:15 (2026-10-19 18:15): the daily pin fails with "402"; the bt-snapshot-failed alert goes to the operator's phone.
- 2026-10-20 00:55 (18:55): the operator funds the Irys balance with 0.02 SOL from the upload account (enough for about 7,400 uploads
  of a snapshot's size).
- 2026-10-20 01:16 (19:16): the keeper's retry pins the 2026-10-20 copy.
- 2026-10-20: the incident log entry is added after the eighth review found it missing.

## Root cause

The Irys balance that pays for uploads ran down to 0, and nothing warned before it did. The failure alert went only to the phone and
was not seen in time.

## What we changed

- A low-balance alert when the Irys balance covers less than 7 days of uploads, a retry for a missed snapshot day, and a status line
  for the snapshot (commit 86767d2f, publish 100).
- The Irys balance is read at most once an hour, so the keeper's daily share of Irys requests no longer runs out (commits 67c0fc06 and
  b4efdf79, publish 101).

## What we did not change, and why

- The snapshot still depends on the Irys balance. Since publish 100 the keeper's top-up step refills that balance from the upload
  account (commit 137b47e2), and the low-balance alert stays as a second check.

## Check it yourself

- The incident log entry: [LOG.md](LOG.md), "2026-10-19, the daily registry snapshot was not pinned".
- The snapshots: [/api/burnticker/v1/snapshots](https://burnticker.com/api/burnticker/v1/snapshots) lists the 2026-10-20 copy.

## Signed

The operator, 2026-10-21.
This file is not yet signed with the developer fee wallet. Until the operator adds that signature here, the git commit that adds this
file is its only record.
