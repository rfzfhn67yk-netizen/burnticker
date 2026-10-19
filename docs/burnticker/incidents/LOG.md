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
