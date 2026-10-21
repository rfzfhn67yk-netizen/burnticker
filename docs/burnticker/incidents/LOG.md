# Burnticker incident log

Append-only. One `## ` heading per incident, newest at the bottom, never edited after the fact; a correction is a new entry that
names the one it corrects. Rendered verbatim on /burnticker/trust.

The policy — what counts as an incident, the 48-hour public postmortem, where it is published and who signs it — is
[../INCIDENTS.md](../INCIDENTS.md). Each entry here is one line per event plus a link to its postmortem in this folder
(`YYYY-MM-DD-<slug>.md`, written from [TEMPLATE.md](TEMPLATE.md)). Moved here from `docs/burnticker/incidents.md` on 2026-10-10 with
its content unchanged (it held no entries).

(No incidents were recorded before the first entry below.)

- 2026-10-11 ~17:00 Denver — $REHEARSAL created on mainnet (mint FwXiFscF…pzkp, pool AAT9VJAh…hRgG): a disclosed throwaway under the real platform config; the operator's one 0.1 SOL buy at creation; unrelated wallets bought within seconds; baseline Treasury reading attested by the host key. Proves deploy/config/create/fee routing/signed reading on mainnet; does not prove a burn. Evidence: docs/burnkeeper/evidence/mainnet-rehearsal-2026-10-11/rehearsal.json

## 2026-10-19 — two web restarts after running out of memory, and a release that switched back

- 11:47 and 12:19 Denver: the web process ran out of memory and restarted, twice. Pages did not answer while it came back up. No alert was raised for either restart.
- 13:39 Denver: the third run of publish 92 started its new build. Its smoke check reported a failure that was not real, and at 13:41 the host switched back to the previous build.
- 13:41 to 14:02 Denver: the previous build found that the newer build had already opened the registry file, so it refused new creator launches, as designed. Pages and the keeper kept reading. At 14:02 the newer build was serving again and launches resumed.
- 13:41 to 14:01 Denver: the new web check ran four times before its script was on the host and failed each time. This was alert noise, not an outage.
- Changed since: the deploy starts a newly added timer only after the release switch, and the alert for an older build on a newer registry says that it is expected while a deploy switches back.
- Cause of the two restarts: the server kept up to 1,000 whole answers from Polymarket's search in memory, about 1.9 MB each, and searches in the launch wizard filled the process's 2 GB limit. No burn, reading or receipt was affected. Fix in the same release: the answer caches are limited by size, the server's memory limit is set on purpose, and a restart like this now reaches the operator's phone. Evidence: the web unit's journal on the host (two stops with status 6, ABRT) and logs/burnticker-web.log ("JavaScript heap out of memory").
- Postmortem: due under the 48-hour rule in [../INCIDENTS.md](../INCIDENTS.md).
- 2026-10-21: postmortem published, [2026-10-19-web-out-of-memory.md](2026-10-19-web-out-of-memory.md).

## 2026-10-19 — the every-minute static publish failed for 16 minutes after publish 99

- 19:39 to 19:55 Denver (01:39 to 01:55 UTC): the unit that publishes the keeper's static files every minute exited with an error on every run. Publish 99 had added a step to it that runs scripts/ops/deficit-first-paint.mts, a file that lived only in the private monorepo and was not in the public release the host runs.
- Effect: the page sync runs before that step, so the static pages stayed current and no visitor saw an outage. The visible damage was the failed exit on each run and one bt-unit-failed alert pushed to the operator's phone at 19:39 Denver.
- Fix: at 19:55 Denver the operator placed the released script on the host by hand, and the next run passed. Commit 9b25e3b4 ships the script in the public tree, and the step now writes a skip line in the publish log when a release lacks it instead of failing the unit.
- Until publish 100, the served release held that one hand-placed file outside its release record (the record's public tree did not list it). Publish 100 carries the file in its own tree, so the host again matches its record.
- Gate rule from now on: a deploy-time script may only run files that are in the public tree. A test reads scripts/ops/deploy-sites.sh, collects every scripts/ path it runs, and fails unless each one is in config/public-repo.allowlist.
- Postmortem: due under the 48-hour rule in [../INCIDENTS.md](../INCIDENTS.md).
- 2026-10-21: postmortem published, [2026-10-19-static-publish-failed.md](2026-10-19-static-publish-failed.md).

## 2026-10-20 — a five-minute web outage, short stalls on publishes 102 and 103, and unknown coin pages answering 500

- 01:13 and 02:14 Denver, publish 102: some requests waited more than 20 seconds and got the "the app is catching up" page instead of an answer. They worked again on retry.
- 05:13 to 05:18 Denver, publish 102: the web did not answer. The outside web check timed out at 05:13, and Healthchecks marked the site down at 05:13 and up again at 05:18, about five minutes in all. Publish 102 kept no slow-request log, so the exact cause of this one is not known.
- 06:30 to 06:39 Denver, the first minutes of publish 103: the web process was held for about 13 seconds at a time, three times. Six searches and launch reviews took more than 20 seconds, so those visitors got the "catching up" page.
- From publish 103 until publish 104 went live at 06:58 Denver: the page for a coin the site does not know answered with a server error (500) instead of "not found" (404). The release's own check caught it, and publish 104 restored the 404.
- No burn, reading or receipt was affected.
- Cause of the stalls: page builds waited on chain reads that had no time limit, and the launch review redid slow team-name matching for every game it read, which held the web process. Changes: 63c34cf8 and 2b5c7536 put time limits on those reads and log slow requests, 9aa893e6 stops page data being rebuilt when nobody asked for it, and cafdd563 (publish 105, live 07:52 Denver) removes the repeated matching. The 500s came from a new route for unknown coin pages and were fixed by 68c7e450 in publish 104.
- Postmortem: due under the 48-hour rule in [../INCIDENTS.md](../INCIDENTS.md).
- 2026-10-21: postmortem published, [2026-10-20-web-stalls-and-500s.md](2026-10-20-web-stalls-and-500s.md).

## 2026-10-19 — the daily registry snapshot was not pinned

- 18:15 Denver (00:15 UTC on 10-20): the daily job that pins a copy of the coin registry to Arweave through Irys failed with "402: not enough balance for transaction". The upload account had run out of funds, so that day's public copy of the registry was not pinned.
- No burn, reading or receipt was affected. Each coin's own receipts and pinned descriptions are separate and were not touched.
- An alert (bt-snapshot-failed) was raised to the operator at the time. This entry was added on 2026-10-20 after the eighth review found it missing.
- Postmortem: due under the 48-hour rule in [../INCIDENTS.md](../INCIDENTS.md).
- 2026-10-21: postmortem published, [2026-10-19-registry-snapshot-not-pinned.md](2026-10-19-registry-snapshot-not-pinned.md).

## 2026-10-20 — correction to the entry "a five-minute web outage, short stalls on publishes 102 and 103, and unknown coin pages answering 500"

- That entry gave two release times about 12 minutes late. Publish 104 went live at 06:46 Denver, not 06:58, so the unknown-coin 500 answers ended 12 minutes earlier than it says. Publish 105 went live at 07:40 Denver, not 07:52. The times come from the web unit's start in the host journal.
- The rest of that entry stands. It is left as written, because this log is append-only.
