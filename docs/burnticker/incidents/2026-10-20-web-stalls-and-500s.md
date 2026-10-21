# Postmortem: a five-minute web outage, short stalls on publishes 102 and 103, and unknown coin pages answering 500

| | |
|---|---|
| Incident date (UTC) | 2026-10-20 07:13 |
| Known since (UTC / Denver) | 2026-10-20 07:13 / 2026-10-20 01:13 |
| Postmortem published | 2026-10-21 |
| Category (INCIDENTS.md) | 8 false statement (pages did not answer, and unknown coin pages answered a server error) |
| Status | closed |
| Coins affected | none |

## What happened

In the night and morning of 2026-10-20, under publish 102, some requests waited more than 20 seconds and got the "the app is catching up" page instead of
an answer, and from 05:13 to 05:18 Denver the web did not answer at all. In the first minutes of publish 103 the web process was held
for about 13 seconds at a time, three times. From publish 103 until publish 104, the page for a coin the site does not know answered
with a server error (500) instead of "not found" (404).

## Impact

- Receipts affected: none. No burn, reading or receipt was affected.
- Visitors: at 01:13 and 02:14 Denver some requests got the "catching up" page and worked on retry. From 05:13 to 05:18 Denver the site
  was down, about five minutes in all; the outside web check timed out at 05:13 and passed again at 05:18. From 06:30 to 06:39 Denver
  six searches and launch reviews took more than 20 seconds and got the "catching up" page.
- An unknown coin page answered 500 from publish 103 until publish 104 went live at 06:46 Denver (the log entry's first text said
  06:58; a correction entry fixed it).
- What was NOT affected: no burn pool lost SOL, no rule changed, no launch was registered wrongly.

## Timeline (UTC, Denver in brackets)

- 2026-10-20 07:13 (01:13) and 08:14 (02:14): requests on publish 102 wait more than 20 seconds; the "catching up" page answers.
- 2026-10-20 11:13 to 11:18 (05:13 to 05:18): the web does not answer; the outside check marks the site down, then up.
- 2026-10-20 12:30 to 12:39 (06:30 to 06:39): publish 103's first minutes; the web process is held about 13 seconds at a time, three
  times. Unknown coin pages answer 500.
- 2026-10-20 12:46 (06:46): publish 104 is live; unknown coin pages answer 404 again.
- 2026-10-20 13:40 (07:40): publish 105 is live with the last of the fixes below.

## Root cause

Page builds waited on chain reads that had no time limit. The home and coin-list builds took up to about 17 seconds, waiting on reads
queued behind the web's share of the RPC provider; the database queries themselves were fast. The launch review also redid slow
team-name matching for every game it read, which held the web process. Publish 102 kept no slow-request log, so the exact cause of
the 05:13 outage is not known; it matches the same stall.

The 500 answers came from a new route for unknown coin pages in publish 103.

## What we changed

- Commits 63c34cf8 and 2b5c7536 (publish 103): time limits on those chain reads, coin reads under a deadline with the last good read
  kept and marked with its age, a background refresher for page data, a warm-up when the web starts, and a slow-request log.
- Commit 9aa893e6: page data is not rebuilt when nobody asked for it.
- Commit cafdd563 (publish 105, live 07:40 Denver): the repeated team-name matching is gone.
- Commit 68c7e450 (publish 104): unknown coin pages answer 404 again.

## What we did not change, and why

- A worker thread for page builds was considered and not built. The cost was waiting on the network, not the processor, and a second
  thread would double the web's share of the RPC provider and start cold.

## Check it yourself

- The incident log entries: [LOG.md](LOG.md), "2026-10-20, a five-minute web outage, short stalls on publishes 102 and 103, and
  unknown coin pages answering 500", and the correction entry after it.
- The fixes: commits 63c34cf8, 2b5c7536, 9aa893e6, cafdd563 and 68c7e450 in the public repository.
- The release record: [../CHANGELOG.md](../CHANGELOG.md), publishes 102 to 105.

## Signed

The operator, 2026-10-21.
This file is not yet signed with the developer fee wallet. Until the operator adds that signature here, the git commit that adds this
file is its only record.
