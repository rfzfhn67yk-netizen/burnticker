# Postmortem: the web process ran out of memory twice, and a release switched back

| | |
|---|---|
| Incident date (UTC) | 2026-10-19 17:47 |
| Known since (UTC / Denver) | 2026-10-19 17:47 / 2026-10-19 11:47 |
| Postmortem published | 2026-10-21 |
| Category (INCIDENTS.md) | 8 false statement (pages did not answer while the process restarted; no alert was raised) |
| Status | closed |
| Coins affected | none |

## What happened

On 2026-10-19 the web process that serves burnticker.com ran out of memory and restarted twice, at 11:47 and 12:19 Denver. While it came
back up, pages did not answer. No alert reached the operator for either restart. Later that day, the third run of publish 92 started
its new build, its smoke check reported a failure that was not real, and the host switched back to the previous build for about 21
minutes.

## Impact

- Receipts affected: none. No burn, reading or receipt was affected. The keeper is a separate process and kept running.
- Visitors: pages did not answer while the web process restarted, twice, for the time a restart takes.
- From 13:41 to 14:02 Denver the previous build refused new creator launches, because the newer build had already opened the registry
  file. This is the designed refusal. Pages and the keeper kept reading.
- What was NOT affected: no burn pool lost SOL, no rule changed, no registry row was lost.

## Timeline (UTC, Denver in brackets)

- 2026-10-19 17:47 (11:47): the web process stops with status 6 (ABRT) and restarts. Its log says "JavaScript heap out of memory".
- 2026-10-19 18:19 (12:19): the same again.
- 2026-10-19 19:39 (13:39): the third run of publish 92 starts its new build. Its smoke check reports a failure that was not real.
- 2026-10-19 19:41 (13:41): the host switches back to the previous build, which refuses new creator launches on the newer registry.
- 2026-10-19 19:41 to 20:01 (13:41 to 14:01): the new web check runs four times before its script is on the host and fails each time.
  This was alert noise, not an outage.
- 2026-10-19 20:02 (14:02): the newer build serves again, and launches resume.

## Root cause

The server kept up to 1,000 whole answers from Polymarket's search in memory, about 1.9 MB each, with no limit on their total size.
Searches in the launch wizard filled the process's 2 GB memory limit, and the process stopped. The restart raised no alert because no
alert watched for a web restart.

The switch back came from a smoke check that failed for a reason outside the release itself. The previous build then found a newer
registry and refused launches, as it is designed to.

## What we changed

- Commit bd21c000 (publish 94): every cache of answers from an outside service is limited by size; the server's memory limit is set
  on purpose (a 1.5 GB heap inside a fixed unit memory cap); a self-restart of the web process now sends an alert to the operator's
  phone.
- The deploy starts a newly added timer only after the release switch, so a new check no longer runs before its script is on the host.
- The alert for an older build on a newer registry now says that this is expected while a deploy switches back.
- A three-hour run with no deploy followed publish 100. The web process ran 181 minutes with no restart, no crash and no open alert.

## What we did not change, and why

- The previous build's refusal of new launches on a newer registry stays. Serving launches from an older build against a newer
  registry is the riskier choice.

## Check it yourself

- The incident log entry: [LOG.md](LOG.md), "2026-10-19, two web restarts after running out of memory, and a release that switched back".
- The fix: commit bd21c000 in the public repository. The cache limits are in the files it changes.
- The release record: [../CHANGELOG.md](../CHANGELOG.md), publish 94.

## Signed

The operator, 2026-10-21.
This file is not yet signed with the developer fee wallet. Until the operator adds that signature here, the git commit that adds this
file is its only record.
