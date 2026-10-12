# Status file, monitors, time lock, Cloudflare and cost

ops-2, 2026-10-12. Everything here that touches the Burnticker VPS or a dashboard is an owner step: the
commands are written out (`root@mct-burnticker` is the host's private-network name, as in `deploy-burnticker-host.sh`), nothing has been run against the host, and nothing here changes the keeper, the CLI launch or the programs.
Times are Denver time.

## 1. Why status.burnticker.com says "status.json: HTTP 404"

The status page itself loads, so DNS, Caddy's `status.burnticker.com` block and the page copy step all work. Only the data file is
missing. That file travels through four links:

1. the platform keeper (`mct-burnticker-keeper`) writes `data/burnticker-site/status/status.json` after every cycle, about once a
   minute (`src/lib/burnticker/ops/keeperOps.ts` `afterCycle`, `status.ts` `writeOpsStatus`);
2. the publish timer (`mct-burnticker-publish.timer`, every minute) runs `scripts/ops/deploy-sites.sh --publish-only`, which copies
   the keeper's publish directory into `/var/www/burnticker/`, so the file lands at `/var/www/burnticker/status/status.json`;
3. Caddy serves `/var/www/burnticker/status/` at `https://status.burnticker.com/` and `https://burnticker.com/status/`;
4. the page fetches `status.json` next to itself.

What the repository says about link 1: the handoff of 2026-10-12 lists the units running on the box as the web unit, the hourly
`mct-rehearsal-keeper` timer and a stopped `mct-burnkeeper`. The platform keeper is not among them, and "keeper start" is still open
in LAUNCH-WEEK-TODO item A7. The 10-11 cutover also set `BURNTICKER_CLUSTER=mainnet` and the program id. If `mct-burnticker-keeper` is
enabled, it now refuses at start ("the RPC is mainnet: refused unless BURNTICKER_MAINNET=1") before its first cycle, the same restart
loop `mct-burnkeeper` was in on 10-11, and it never writes the file. **Most likely cause: the platform keeper is not running, or is
refusing at start.** The 404 is then the truth: there is no keeper status to show.

A second cause the repository could hide: `deploy-sites.sh` piped every rsync through `sed`, so a copy that failed (for example a
`/var/www/burnticker/status` directory left owned by root after a hand run as root) printed an error into the log and still exited 0.

Fixed in the repository (commit "burnticker status chain"):

- `deploy-sites.sh` now exits with rsync's code when a copy fails (the unit shows under `systemctl --user --failed`), prints rsync's
  own error with its label, and refuses to run as root.
- `scripts/ops/keeper-status-check.sh` (run by the publish timer) writes one line to `logs/burnticker-publish.log` when the keeper's
  file goes missing or stale and one when it is back, and pings an optional heartbeat URL while the file is fresh (section 2).
- `scripts/ops/probe-burnticker.sh` prints the monitors' checks from anywhere, and with `--box`, on the host, walks the four links.

**Owner, check now (read-only; the log tail hides any API key):**

```sh
ssh root@mct-burnticker 'systemctl --machine=mct@.host --user status mct-burnticker-keeper mct-burnticker-publish.timer --no-pager | head -30; ls -la ~mct/meme-coin-trader/data/burnticker-site/status/ /var/www/burnticker/status/; tail -n 15 ~mct/meme-coin-trader/logs/burnticker-keeper.log | sed -E "s/(api-key=)[^&\" ]+/\1<hidden>/g"; tail -n 10 ~mct/meme-coin-trader/logs/burnticker-publish.log'
```

| What you see | Cause | Fix |
|---|---|---|
| keeper `inactive (dead)` or `disabled` | never started | start it when the run-sheet says (A7/C10). To get the status file without any sends first: `touch ~mct/meme-coin-trader/data/PAUSE-burnticker` (as mct), then start it; a paused keeper reads, publishes and alerts but signs and sends nothing |
| keeper `activating (auto-restart)`, log ends "refused unless BURNTICKER_MAINNET=1" (or a key mismatch) | refusing at start since the cutover | the C10 env names (`BURNTICKER_MAINNET=1` and the keeper key) when the owner chooses; until then `systemctl --machine=mct@.host --user disable --now mct-burnticker-keeper` stops the loop |
| `data/burnticker-site/status/status.json` fresh, `/var/www/burnticker/status/status.json` missing or old | the copy fails | read the publish log; if `/var/www/burnticker/status` is owned by root: `chown -R mct:mct /var/www/burnticker` |
| both files fresh, still 404 | Caddy or DNS | `curl -sI https://status.burnticker.com/status.json` and compare with `https://burnticker.com/status/status.json` |

After the next ship (the public tree carries the new scripts), one command does the walk:
`ssh root@mct-burnticker 'su - mct -c "cd ~/meme-coin-trader && export XDG_RUNTIME_DIR=/run/user/\$(id -u) && sh scripts/ops/probe-burnticker.sh --box"'`.

## 2. Uptime monitors (about five minutes)

From the Mac at any time: `sh scripts/ops/probe-burnticker.sh` runs the same checks and exits 1 if any fails.

**UptimeRobot** (free account on contact@burnticker.com, 5-minute checks, email alerts). Its terms for the free plan may limit
commercial use; Better Stack's free tier is the like-for-like alternative.

1. HTTP(s) monitor, "Burnticker home", `https://burnticker.com/`, every 5 minutes.
2. Keyword monitor, "Burnticker API", `https://burnticker.com/api/burnticker/v1/current-status`, keyword `burnticker.current-status/v1`,
   alert when the keyword does not exist (that also catches a non-200 answer).
3. Keyword monitor, "Keeper status file", `https://status.burnticker.com/status.json`, keyword `burnticker.ops-status/v1`, alert when
   it does not exist. This one is red today, and that is correct until the keeper runs.

**Healthchecks.io** (free account), the check that notices a keeper that stopped while the website still answers:

4. New check "burnticker keeper", period 5 minutes, grace 5 minutes, email integration. Copy its ping URL. On the box add one line,
   `BURNTICKER_STATUS_HEARTBEAT_URL=<the ping URL>`, to the app's local env file in `~mct/meme-coin-trader` (the file the keeper's names
   live in; root edits it, as for every env change). The publish timer then pings it each minute while the keeper's `status.json` is
   younger than 5 minutes, and stops when it is not, so the check goes down. It needs the shipped `deploy-sites.sh` from this branch;
   no restart (the timer reads that file on every run).

## 3. The 48-hour time lock (owner, around 2026-10-23)

Mainnet multisig `7gYAZ6meH3W4VwEHcqq3cWgmSAL2w7voM91oaQezvDYc`, vault `8zsHrHjSgunnLmVyPG848GLw5a9xai6u8SZCYaskWrDV`, 2 of 3, time
lock 0 today. The time lock is a multisig setting, so it changes through a config proposal that two members approve.

1. Open https://app.squads.so, connect member A (`DLxTkuqM…6ZCJ`), and select the multisig `7gYAZ6me…vDYc`.
2. Settings: find **Time lock**, choose Edit, enter **48 hours** (172,800 seconds), and create the proposal. It shows under
   Transactions as a configuration transaction.
3. Approve it with member A. Disconnect, connect member B (`57ugkFkT…4crt`), approve it again. With 2 of 3 approved, press Execute
   (the current lock is 0, so it executes at once). Check before pressing that the proposal says "time lock 172800" and nothing else.
4. From now on every proposal, including any later change to the time lock, waits 48 hours between approval and execution. An urgent
   program fix then takes two days. That is the point, and it is the reason it was left at 0 for launch week.

CLI equivalent (the run-sheet's B3 line; `<N>` is the multisig's transaction index plus one):
`squads-multisig-cli config-transaction-create --keypair usb://ledger --multisig-pubkey 7gYAZ6meH3W4VwEHcqq3cWgmSAL2w7voM91oaQezvDYc --action "SetTimeLock 172800"`, then `proposal-vote … --transaction-index <N> --action approve` with each of A and B, then execute.

**Read-back (what the trust page already does).** `GET https://burnticker.com/api/burnticker/v1/current-status` reads the multisig
account from chain on every request (cached 60 s) and decodes `time_lock` (u32 at byte 74, `src/lib/burnticker/currentStatus.ts`):

```sh
curl -s https://burnticker.com/api/burnticker/v1/current-status | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);const m=j.upgradeAuthority.find(u=>u.cluster==="mainnet");console.log(m.timeLockSecs,m.timeLockSource,"|",m.line)})'
```

Expect `172800 chain | The mainnet Squads time lock is 48 h, read from chain.` The release gate "Raise the mainnet Squads time lock"
turns done by itself (`derivedFromChain: mainnet-time-lock`), and the trust and status pages say the same. Straight from the chain:
`solana account 7gYAZ6meH3W4VwEHcqq3cWgmSAL2w7voM91oaQezvDYc -um --output json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(Buffer.from(JSON.parse(s).account.data[0],"base64").readUInt32LE(74)))'`.
Then the static sentences that still say "0 now" are edited (single lines): `config/burnticker/operator.json` mainnet `squads.timeLock`,
and the checklist source of `docs/burnticker/CHECK-THIS-YOURSELF.md` (regenerated with `scripts/burnticker-trustpack.mts check-doc --write`).

## 4. Cloudflare cut-over

Measurements in `deploy/caddy/csp-and-cache.proposed.caddy` (2026-10-11) already show `cf-cache-status` headers on the apex, so some
records may be proxied today. Check each record's cloud colour first; the steps below are the same either way.

1. Ship the limiter fix first (`src/lib/burnticker/api/clientIp.ts`): `sh scripts/ops/publish-public-repo.sh --verify --link-node-modules && BURNTICKER_SRC=../burnticker-public sh scripts/ops/deploy-burnticker-host.sh --webpack`. Not on launch night.
2. Certificates: Caddy must hold one for each name before the proxy goes on:
   `ssh root@mct-burnticker 'ls /var/lib/caddy/.local/share/caddy/certificates/*/'` lists burnticker.com, www, status and deficit.
3. Cloudflare, zone burnticker.com. SSL/TLS: mode **Full (strict)**. Edge Certificates: Always Use HTTPS on, minimum TLS 1.2.
   Turn **off** Rocket Loader (Speed), Email Address Obfuscation (Scrape Shield) and automatic Web Analytics injection: each injects or
   rewrites scripts, which the content security policy reports and, once enforced, blocks. Security, Bots: **Bot Fight Mode off**
   (the public API serves bots, and the free plan cannot exempt a path). Cache rules: the five in `docs/burnticker/LOADTEST.md`.
4. DNS: set Proxied (orange cloud) on the A and AAAA records `@`, `www`, `status` and `deficit`.
5. Caddy: paste the block in `deploy/caddy/cloudflare.proposed.caddy` at the top of `/etc/caddy/Caddyfile`, then
   `caddy validate --config /etc/caddy/Caddyfile && systemctl reload caddy`.
6. Check: `sh scripts/ops/probe-burnticker.sh` says "the site answers through Cloudflare". Per-visitor limits: run
   `curl -s -o /dev/null -D - "https://burnticker.com/api/burnticker/v1/current-status?probe=$RANDOM" | grep -i ratelimit-remaining`
   twice from the Mac (the number drops by one), then once from a phone hotspot (it starts near 119 again). A different query string
   each time keeps Cloudflare's cache out of the way.
7. Optional, a week later: the provider's cloud firewall, admitting 80 and 443 only from Cloudflare's ranges (the list in
   `cloudflare.proposed.caddy`); SSH stays on the private network. The limiter is safe without it (it trusts `CF-Connecting-IP` only from those
   ranges); the firewall stops anyone reaching the origin around Cloudflare. Certificate renewals still work through the proxy (HTTP
   challenge); look for "certificate obtained" in `journalctl -u caddy` after the next renewal.
8. Undo: grey cloud on the records (a few minutes), remove the Caddy block, reload.

## 5. Monthly cost (estimate, nothing changed)

From the handoff (2026-10-12), `config/burnticker/expenses.json` and the deploy docs. Prices not written in the repository are marked
"check": read the invoice.

| Item | Launch month | After launch | Source |
|---|---|---|---|
| Burnticker VPS (4 vCPU, 8 GB) with its IPv4 | about $17 (check) | about $17; about 20 % more with the provider's backups | HANDOFF §2 |
| Helius RPC, Developer plan (two keys: keeper, site) | $49 | $49; Business is $499 and only needed past the plan's monthly credits, which a one-minute keeper on a handful of coins does not approach (estimate, not measured) | HANDOFF §5 |
| TheSportsDB key (team coins) | about $9 (check) | same | key on the box; price not in the repo |
| Cloudflare (Free plan), UptimeRobot, Healthchecks.io | $0 | $0 | free tiers |
| Domain burnticker.com | about $1 (renewal spread over 12 months; check) | same | expenses.json placeholder |
| Mail for contact@ and security@ | check | check | expenses.json placeholder |
| Arweave through Irys (metadata pins, daily registry snapshot) | about $0 (uploads under 100 KB are free) | cents, once snapshots pass 100 KB | runbook, HANDOFF §5 |
| Keeper transaction fees (SOL) | a few dollars | grows with coins and readings | keeper keys funded 0.33 and 0.12 SOL |
| **Recurring total** | **about $75–80 a month** plus mail | **about $75–80 a month** plus mail | |
| One-off: DexScreener Enhanced Token Info | $299 | | expenses.json |
| One-off: reproducible-build server (smallest x86 type, about 1 hour) | under $0.10 | | VERIFIED-BUILD.md, "Throwaway Linux host" |

The trading VPS and its services are not part of this bill. The step that would change the total is Helius Business ($499) if visitor
traffic were moved onto the site key; today the browser uses the public RPC and no key ships to visitors.
