# Postmortem: the every-minute static publish failed for 16 minutes after publish 99

| | |
|---|---|
| Incident date (UTC) | 2026-10-20 01:39 |
| Known since (UTC / Denver) | 2026-10-20 01:39 / 2026-10-19 19:39 |
| Postmortem published | 2026-10-21 |
| Category (INCIDENTS.md) | 5 ledger (the host ran a file outside its release record until publish 100) |
| Status | closed |
| Coins affected | none |

## What happened

Publish 99 added a step to the unit that publishes the keeper's static files every minute. That step runs
scripts/ops/deficit-first-paint.mts, a file that lived only in the private repository and was not in the public release the host runs.
From 19:39 to 19:55 Denver on 2026-10-19 the unit exited with an error on every run.

## Impact

- Receipts affected: none. No burn, reading or receipt was affected.
- Visitors: none. The page sync runs before the new step, so the static pages stayed current. The visible damage was the failed exit
  on each run and one bt-unit-failed alert to the operator's phone.
- Until publish 100, the served release held one file placed by hand outside its release record: the record's public tree did not list
  it. Publish 100 carries the file in its own tree, so the host again matches its record.
- What was NOT affected: no burn pool lost SOL, no rule changed, no page served stale data.

## Timeline (UTC, Denver in brackets)

- 2026-10-20 01:39 (2026-10-19 19:39): the first failed run after publish 99; the bt-unit-failed alert reaches the operator.
- 2026-10-20 01:55 (19:55): the operator places the released script on the host by hand; the next run passes.
- 2026-10-20 02:47 (20:47): publish 100 is live with the script in its public tree.

## Root cause

Releases on the host are cut from the public tree, and the new step ran a file that was only in the private repository. No check
compared the files a deploy-time script runs with the files the public tree holds.

## What we changed

- Commit 9b25e3b4 (publish 100): the script is in the public tree, and the step writes a skip line in the publish log when a release
  lacks it, instead of failing the unit.
- Commit 043cb434 (publish 101): a gate test reads scripts/ops/deploy-sites.sh, collects every scripts/ path it runs, and fails unless
  each one is in config/public-repo.allowlist and present.

## What we did not change, and why

- The step itself stays. It writes the first view of the $DEFICIT page, and it now skips with a note when its file is absent.

## Check it yourself

- The incident log entry: [LOG.md](LOG.md), "2026-10-19, the every-minute static publish failed for 16 minutes after publish 99".
- The fixes: commits 9b25e3b4 and 043cb434 in the public repository.
- The release record: [../CHANGELOG.md](../CHANGELOG.md), publishes 99 to 101.

## Signed

The operator, 2026-10-21.
Document sha256 (of this file above the Signed heading): `e1f5ef97c451f8e19736773854aba461074f83ba54101c9ccf4fed2d6fa38c08`.
Signature (developer fee wallet 8cwwy895BENMJTueXfQovWD4mvuoJ4kgyR52UMrqSbo5, ed25519, base58) over
"Burnticker postmortem 2026-10-19-static-publish-failed.md sha256 e1f5ef97c451f8e19736773854aba461074f83ba54101c9ccf4fed2d6fa38c08": `2UFi6Q81PHknH8Zm45KbGXBn3NpEyreQJQDfPMd2epBLXXNuP7cMREakRTPfBHKw4vRm1y8zv3D7kw2M9oPdFVny`.
Signed in Phantom on 2026-10-21 and verified with ed25519 before this line was written.
