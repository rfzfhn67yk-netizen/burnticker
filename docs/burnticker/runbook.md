# Burnticker runbook (the dedicated Burnticker VPS; 2026-10-09)

Everything here is run **as `mct` on the Burnticker host** unless it says Mac or root. `R` is the repo's node invocation, defined as a
shell function (works in bash and zsh; a `R="node …"` variable used as `$R` fails in zsh with "command not found"):

```sh
cd ~/meme-coin-trader
R() { node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/alias-hook.mjs "$@"; }   # a FUNCTION: zsh (the Mac) does not word-split a R variable
export XDG_RUNTIME_DIR=/run/user/$(id -u)      # systemctl --user needs it in a `su -` shell
```

Units: `mct-burnticker-keeper` (platform keeper, loop), `mct-burnkeeper` ($DEFICIT keeper, loop), `mct-burnticker-web` (the Next app
on 127.0.0.1:3000), `mct-burnticker-audit.timer` (hourly), `mct-burnticker-publish.timer` (every minute). Logs: `logs/burnticker-keeper.log`,
`logs/burnkeeper.log`, `logs/burnticker-web.log`, `logs/burnticker-audit.log`, `logs/burnticker-publish.log`; lifecycle in
`journalctl --user -u <unit>`. Hosting, DNS, firewall and the host rule: `docs/burnticker/deploy.md`. Times quoted to the owner in Denver.

## Start, stop, pause

```sh
systemctl --user status mct-burnticker-keeper mct-burnkeeper mct-burnticker-web --no-pager
systemctl --user list-timers 'mct-burnticker-*' --no-pager
systemctl --user start  mct-burnticker-keeper        # or stop / restart; the same for mct-burnkeeper and mct-burnticker-web
tail -f logs/burnticker-keeper.log
```

- **Pause cranks without stopping:** `touch data/PAUSE-burnticker` (platform keeper) · `touch data/PAUSE-burnkeeper` ($DEFICIT). Reading,
  publishing and alerts go on; the log says "cranks held" every cycle; the morning block says "PAUSE-burnticker PRESENT". `rm` the file to resume.
- **Stop or restart only between cycles.** A crank in flight finishes its confirmation wait on SIGTERM (`TimeoutStopSec=150`) and its
  signature is write-ahead on the ledger, so a restart cannot crank twice — but the clean way is: pause → watch one quiet cycle in the log
  (`cycle: 0 fetch(es), 0 planned, 0 executed`) → restart → unpause. (The platform's live-restart lesson, memory `live-restart-double-buy`.)
- **Kill everything:** `systemctl --user stop mct-burnticker-keeper mct-burnkeeper` — the web and the static site keep serving the last
  published truth; the audit timer keeps running and will say `bt-audit-stale` nothing. To take the site down too: `systemctl --user stop
  mct-burnticker-web` (Caddy answers 502 on `/burnticker/*`; static pages stay).
- **Smoke a cycle by hand (no sends, no alerts):** `R scripts/burnticker-keeper.mts --once --dry-run`.
- **Ship a code change** — the host runs the PUBLIC tree: `sh scripts/ops/publish-public-repo.sh --verify --link-node-modules`, then
  `BURNTICKER_SRC=../burnticker-public sh scripts/ops/deploy-burnticker-host.sh --webpack` from the Mac, then the two checks — exact
  commands in deploy.md "The host runs the public tree". The ship restarts the web unit, and (2026-10-15) asks the Burnticker keeper and
  the mint bank to restart themselves: it runs `scripts/ops/request-keeper-restart.sh`, which drops `data/restart-requested.keeper` and
  `data/restart-requested.mintbank` with the build id. Each loop checks for its own file at the END of a cycle (never mid-crank), logs
  `restart requested by deploy <build id>`, removes the file and exits 0; systemd (`Restart=always`) starts it on the new code within
  30 s (the mint bank 60 s). The deploy waits up to 300 s for both logs to show the request taken and a new start (`burnticker keeper
  starting`, or the keeper's `startup (the genesis read) waits` line; the mint bank's `mint key bank:`), and prints `keeper restarted on
  build …` / `mint bank restarted on build …` or `KEEPER DID NOT RESTART …` / `MINT BANK DID NOT RESTART …: <why>` (the deploy goes on).
  A request already on disk when a keeper starts is stale (that process already runs the new code): it is removed and logged, never
  honoured. A `--dry-run` keeper neither takes nor removes a request. To ask by hand: `sh scripts/ops/request-keeper-restart.sh --wait 300`.
  `--no-keeper-restart` skips it; `--restart-keepers` now restarts only mct-burnkeeper (the $DEFICIT keeper), which does not read these
  files, and says so when used.
- **The keeper starts on a spent Helius day** (2026-10-15): it no longer crash-loops. The genesis is read on the keyed RPC (one credit
  past the hold); reads then move to the public RPC of that cluster (its own `solana-public` budget) once its genesis matched, and every
  cycle until 00:00 UTC runs with its sends held (`helius on hold: every cycle until 00:00 UTC runs with its sends held`). Nothing is
  settled from the fallback: readings, cranks and claims resume at midnight. `BURNTICKER_RPC_FALLBACK_URL=off` disables the fallback.

## Rotate the keeper key

The keeper key is the data key (the program's attester for every token it launched) and the fee payer of every crank. Rotation = a new key, the registry
told, the old one drained. For the **platform keeper** (`signer-burnticker.enc.json`):

```sh
touch data/PAUSE-burnticker && sleep 70                                                      # hold cranks through the swap
mv ~/.config/meme-coin-trader/signer-burnticker.enc.json{,.retired-$(date +%Y%m%d)}; mv ~/.config/meme-coin-trader/signer-burnticker.enc.json.address{,.retired-$(date +%Y%m%d)}
read -rs BURNKEEPER_SIGNER_PASSPHRASE && export BURNKEEPER_SIGNER_PASSPHRASE && BURNKEEPER_SIGNER_PATH=~/.config/meme-coin-trader/signer-burnticker.enc.json node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/burnkeeper-keygen.mjs --new; unset BURNKEEPER_SIGNER_PASSPHRASE   # typed, not echoed; the same passphrase as .env.local
cat ~/.config/meme-coin-trader/signer-burnticker.enc.json.address                            # the new PUBLIC key
# the host's env file: BURNTICKER_KEEPER_PUBKEY=<new address>  (edit by hand; never echo the passphrase)
# ON CHAIN: the config authority (the Squads vault) proposes the new key on every TokenConfig (`propose_attesters`, 48 h timelock; a proposal
# must keep ≥ quorum of the current keys, so rotate in two steps: add new → after apply, remove old); anyone applies after 48 h.
# Until the new key is applied the keeper holds the old key — readings signed by a key the config does not list are held as quorum-short.
# the registry: add the new key as an attester on every live token and retire the old one (append-only: a new row + active=0 on the old)
NEW_KEY=<new> OLD_KEY=<old> R --input-type=module -e 'import { openRegistry } from "./src/lib/burnticker/registry.ts"; const r = openRegistry("data/burnticker.db"); const NEW = process.env.NEW_KEY, OLD = process.env.OLD_KEY, now = Date.now(); for (const t of r.tokens()) { r.addAttester({ mint: t.mint, pubkey: NEW, role: "data-key", addedAt: now, timelockUntil: null }); if (OLD) r.addAttester({ mint: t.mint, pubkey: OLD, role: "data-key", addedAt: now, active: false, timelockUntil: null }); } r.close(); console.log("attesters updated on", r.tokens().length, "tokens")'
systemctl --user restart mct-burnticker-keeper && rm data/PAUSE-burnticker
# fund the new address (≥ 0.1 SOL); sweep the old one to the dev fee wallet once its last crank is confirmed; log it in docs/burnticker/incidents/LOG.md
```

For the **$DEFICIT keeper** (`signer-burnkeeper.enc.json`) the same applies since program execution (2026-10-10): the key is the TokenConfig's
attester and a fee payer, **not** the LaunchLab creator (the creator is the program's fee PDA, which holds the fees) — so it rotates like the
platform keeper's: `propose_attesters` (48 h, two steps), a fresh key file, `BURNKEEPER_SIGNER_PATH`, restart between cycles. A compromised key
can sign false readings (bounded by the plausibility RESET and visible forever on chain) but can move no funds: pause, propose its removal,
publish the incident.

## On each alert

Alerts arrive as `bt-*` rows (wallet page / check-in / Telegram, via the webhook to the trading VPS) and in `logs/burnticker-keeper.log`
as `[alert] …`. The morning block (`## Burnticker` in the check-in, `https://burnticker.com/ops.json`) shows "conditions now".

| Alert | Means | Do |
|---|---|---|
| `bt-feed-stall` | a selector not fetched for > 2× its cadence | `tail logs/burnticker-keeper.log`: is the keeper cycling? (`bt-keeper-stale` too → restart it). A `[feed] … retrying in` line = the source is failing (HTTP 5xx, 403, parse): check the source by hand with the `curl` in any receipt's verify block; the keeper backs off up to 1 h and resumes by itself. Nothing to invent: a late source means no burn until it posts. |
| `bt-reading-conflict` | the oracle changed a recorded result; the registry refused and the key is HELD | Stop. Read the source and the stored reading (`sqlite3 data/burnticker.db "SELECT * FROM readings WHERE selector_key='…' AND event_id='…'"`). If the venue re-settled (rare, documented by them): the rule's `onVoid`/finality policy decides; the fix is an incident entry + a new reading row under a new event id if the rule allows — never an edit (the triggers refuse it). |
| `bt-reading-implausible` | the adapter refused a reading (bounds, period, parse) | Look at the source row; if the bounds are wrong, that is a `config/burnticker/sources.json` change with a test — a rule change is impossible, the reading simply waits. |
| `bt-crank-failed` | 3 failures in a row on one receipt | The log line says why: `simulation refused` (program/pool state — read the logs it quotes), `RPC/program error` (RPC down: check `BURNTICKER_RPC_URL`), `crank failed on chain`. The receipt retries with backoff forever; it is late, never lost. Fix the cause; do not touch the row. |
| `bt-audit-mismatch` | audit.json: a receipt does not recompute | THE PUBLIC ALARM — the index badge is red. `R scripts/burnticker-audit.mts --json` lists the checks per receipt. A mismatch is either a code change in the recompute (revert it) or a tampered/duplicated row (the triggers make that hard; compare with the latest `.backup`). Publish the finding in `docs/burnticker/incidents/LOG.md` the same day. |
| `bt-audit-stale` | the hourly audit has not run for 3 h | `systemctl --user list-timers mct-burnticker-audit.timer`; `systemctl --user start mct-burnticker-audit.service` and read `logs/burnticker-audit.log`. |
| `bt-keeper-balance-low` | keeper key < 0.1 SOL, or too little to refill the other operations wallets without breaking its own reserve | Send the amount the alert names to `BURNTICKER_KEEPER_PUBKEY` (it pays the burn fees and refills the upload wallet, its Irys balance and the $DEFICIT keeper key; it is never the treasury). Until then no other wallet is refilled. |
| `bt-top-up` | information: the keeper refilled an operations wallet (amount, wallet, transaction) | Nothing. ops.json shows "Top-ups: N today, X SOL; signer covers about D days." |
| `bt-top-up-failed` | a top-up of one wallet failed twice in a row | Read the error in the alert and `grep top-up logs/burnticker-keeper.log`. See the plan with `scripts/ops/top-up.mts --plan --env .env.local` (reads only). Kill switch: `BURNTICKER_TOP_UP=off` and a keeper restart between cycles. deploy.md "Which wallets hold SOL and who refills them". |
| `bt-top-up-draining` | one wallet needed a top-up 3 times in 6 hours, so the keeper stopped refilling it (HB-108) | Find why it loses SOL (a leaked key, a bug) before anything else: check its transactions on an explorer. The stop lifts by itself 6 hours after the last top-up; to lift it sooner run `scripts/ops/top-up.mts --clear-drain <target> --env .env.local`. |
| `bt-cap-binding` | a burn pool holds more than the 25 SOL pre-audit cap | Expected while the cap stands; the excess is queued and shown on the token page. It lifts with the audit decision (fees.ts `PRE_AUDIT_POOL_CAP_SOL`, a reviewed change + a register entry). |
| `bt-keeper-stale` | no cycle for 10 min, not paused | `systemctl --user status mct-burnticker-keeper`; `journalctl --user -u mct-burnticker-keeper -n 50`; restart. |
| `bt-daily-summary` | the one line a day | Read it. "pools X SOL" rising with no burns = check the feed; "dev fees unknown" = `BURNTICKER_RPC_URL`/`BURNTICKER_FEE_WALLET` unset. |
| `bt-feed-down` | a source failed ≥ 3 reads in a row (trust ops; `src/lib/burnticker/ops/feedHealth.ts`) | The reading is withheld, nothing burns; the status page shows the selector "down". Check the source by hand; it resumes by itself. Over a day: an incident only if it changed an outcome (INCIDENTS.md §7). |
| `bt-feed-disagree` | the source's independent cross-read disagreed on a reading | Withheld, never burned. Read both sources for that period by hand. If the primary re-publishes or the cross-read catches up, the next read agrees and the reading lands; a disagreement you resolve by hand is an incident (INCIDENTS.md §7). |
| `bt-feed-stale` | a scheduled source has published nothing new for longer than its cadence allows (day feeds 5 days, monthly 100) | Check the publisher's release calendar (holidays, a shutdown). Nothing to invent: no new reading, no burn. |
| `bt-snapshot-failed` | today's registry snapshot was not pinned (no `BURNTICKER_UPLOAD_PAYER`, an empty Irys balance, an upload error) | Retried every 30 min. Fund the upload payer / set it; or `R scripts/burnticker-snapshot.mts --now` by hand. Missed > 48 h = an incident (INCIDENTS.md §5). |
| `bt-foreign-reading` | the fence found a reading on chain this keeper did not write and could not match it (two registries disagree on units) — **this keeper's sends are held** | Stop and reconcile: section "Keeper redundancy" below. An incident (INCIDENTS.md §6). |
| `reading-unresolved` | a `submit_reading` the keeper sent has no readable status past its blockhash (an RPC without history), and the Reading account for that date on chain carries a different counter value than the one the keeper sent — **that coin's attestations and cranks are held** | Read the date's Reading account (`R scripts/burnticker-audit.mts --json`, or the program's Reading PDA for the coin and date) and the write-ahead row (`sqlite3 data/burnticker.db "SELECT signature, memo, status FROM signatures WHERE mint='<mint>' AND event_id='reading:<YYYY-MM-DD>'"`). Look the signature up on an archival RPC/explorer. If it landed, the chain value is what it wrote: a second keeper or a hand-sent reading wrote the date first, so reconcile the registries as for `bt-foreign-reading`. If it did not land and another keeper's reading is there, the fence adopts that reading once this row is resolved: mark the row `expired` by hand (`UPDATE signatures SET status='expired' WHERE signature='<sig>'`) only after the explorer shows it never landed. Never mark it expired on a null status alone. |
| `draft-reconciled` | the keeper's draft reconciler found a coin created on chain inside its draft's 24 h window that the browser never confirmed, verified its create and took it live | Nothing to do; open the coin page. A create AFTER the window is never taken live automatically: `R scripts/burnticker-draft-revive.mts --mint <mint> --tx <create> --note "why" --late` (dry run first, then `--apply`), recorded in `draft_revivals`. |
| `bt-keeper-yielded` | the leader sees a standby that took over (a signed note) and stopped cranking | Decide which host keeps running; fail back by hand (below). |
| `bt-keeper-takeover` | the standby took over after N missed leader heartbeats | Find out why the leader stopped (host down, Caddy down, network); then fail back by hand (below). An incident if both were active (INCIDENTS.md §6). |
| webhook FAILING (ops.json / morning block) | alerts stay on this host | `curl -s -o /dev/null -w '%{http_code}' -X POST -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"kind":"bt-test","key":"bt-test:'$(date +%s)'","text":"webhook test"}' "$BURNTICKER_ALERT_WEBHOOK"` → 200 expected; 403 = the Host is not trusted (use the tailnet address), 503 = `MCT_ALERT_INTAKE_TOKEN` unset on the trading VPS, 401 = token mismatch. |

### Phone push (polish-1, 2026-10-12)

These states reach the owner's phone directly, so they are seen even when nobody opens the check-in. The rest stay in the registry, the
log and the morning block.

| Push title | Raised by | Do |
|---|---|---|
| Burnticker keeper refused to start | `bt-keeper-refused`: the keeper threw before its first cycle (mainnet without `BURNTICKER_MAINNET=1`, the treasury's key file named, a key that does not match `BURNTICKER_KEEPER_PUBKEY`, testnet). The push carries the reason. | Read the reason, fix the setting in the host's environment file, `systemctl --user restart mct-burnticker-keeper`, then `tail -n 30 logs/burnticker-keeper.log`. |
| Burnticker keeper is not publishing | `scripts/ops/keeper-status-check.sh` (the publish timer, every minute): `status/status.json` stale or missing for more than two hours. Repeats every two hours while it lasts; "Burnticker keeper is back" when it is fresh again. | `sh scripts/ops/probe-burnticker.sh --box` says which link of the status chain broke; then the `bt-keeper-stale` row above. |
| Burnticker reading held | `cosigner-disagree`: the second signer did not agree with the keeper's reading, so nothing was sent for that date | Read the source for that date by hand and both signers' logs. Nothing burns until they agree; a disagreement you settle by hand is an incident (INCIDENTS.md §7). |
| Burnticker upload failed | `bt-pin-failed` (a launch refused because its details could not be pinned on Arweave) or `bt-snapshot-failed` (the daily snapshot) | Check the upload payer's balance and `BURNTICKER_UPLOAD_PAYER`; the `bt-snapshot-failed` row above. |
| Burnticker burn run failing | `bt-crank-failed`: one receipt failed three times in a row | The `bt-crank-failed` row above. |
| Burnticker source down | `bt-feed-down` (audit 2026-10-16 F-5): a source failed three reads in a row; one push per selector per Denver day | The `bt-feed-down` row above. A schedule source (TheSportsDB) down for hours: `grep -i "thesportsdb\|api-sports" logs/burnticker-keeper.log | tail`; the NFL day listing falls back to API-Sports by itself when its key is set. |
| Burnticker service failed | `bt-unit-failed` (F-5 / F-9, `src/lib/burnticker/ops/unitHealth.ts`, every five minutes): any `mct-*` user unit in the failed state, or the mint bank, the synthetic creator's timer or the backup timer not running or not installed | `journalctl --user -u <unit> -n 50` and its `logs/*.log`; fix it, or remove a unit that does not belong (below), then `systemctl --user reset-failed <unit>`. A unit not installed: `sh scripts/ops/install-burnticker-units.sh`. |
| Burnticker service restarted on its own | `bt-unit-restarted` (HB-1, 2026-10-19, `src/lib/burnticker/ops/unitHealth.ts`, every five minutes): a service's systemd restart counter (`NRestarts`) rose by one or two since the last check, so it stopped by itself and `Restart=` started it again. The keeper and the mint bank (they exit on purpose after a deploy) and oneshot jobs are left out; three or more is the crash-loop line of `bt-unit-failed`. The line names the unit, the restart count and the memory peak of the run now going | `journalctl --user -u <unit> -n 80` for the reason and `systemctl --user show <unit> -p NRestarts -p MemoryPeak`. For the web, `grep -n "heap out of memory" logs/burnticker-web.log`: an out-of-memory stop means something holds more than the 1,536 MB heap the unit sets (`deploy/systemd/mct-burnticker-web.service`); the 2026-10-19 cause was the Polymarket answer cache (`docs/burnticker/incidents/LOG.md`). |
| Burnticker backup failed | `bt-backup-failed` (F-5 / F-7): `data/backups/last-backup.json` says the last run failed, or no backup finished for 13 hours, or (audit 2026-10-18) the file is missing or unreadable 8 hours after the keeper started ("No backup status was found") | `tail logs/burnticker-backup.log`; run it by hand (`sh scripts/service/run-burnticker-backup.sh`). An off-box copy that fails: check `BURNTICKER_BACKUP_DEST` and the key it uses. |
| Burnticker backup not copied off the box (low priority) | `bt-backup-offbox-stale`: `BURNTICKER_BACKUP_DEST` is set but no copy has left the box for 24 hours (`lastOffBoxAt` in `data/backups/last-backup.json`), or the off-box pull's receipt (`data/offbox-pull.json`) is more than 12 hours old ("The off-box backup pull has not reported for more than 12 hours"); silent while there is neither a destination nor a receipt, and the destination's own line is not raised while the receipt is fresh | `tail logs/burnticker-backup.log`; check the destination and the key it uses. For the pull, check the backup agent on the operator's machine and its log. |
| Burnticker all quiet (or daily line) | once per Denver day after 08:00 | Nothing, when it says quiet. **A missing daily line means the keeper is not running its alert check**: treat it like the not-publishing push. |

How it works: the keeper reads the registry's `alerts` table on its five-minute alert check (`src/lib/burnticker/push.ts`
`runPushCheck`) and sends a plain-text POST to `BURNTICKER_PUSH_URL` with `Title` and `Priority` headers and
`Authorization: Bearer <BURNTICKER_PUSH_TOKEN>`. Rate limit: one push per kind per hour and six per hour in all; what is held back is
counted in the next push and in the daily line, and every alert stays in the registry. Its state is the registry status row
`push.state`. A failed send is logged as `[push] … not delivered` and never stops the keeper. Only a push the service acknowledged
counts as sent. A failed one stays in `push.state` as pending and is tried again at the next check, then 5, 15 and 60 minutes apart,
for up to 24 hours; several pending alerts go out as one "Burnticker alerts not delivered earlier" push. The daily line counts delivered
alerts only and says how many could not be delivered. Unset `BURNTICKER_PUSH_URL`: nothing is sent, nothing else changes.

Heartbeat (second audit 2026-10-18 A-7): every push above is sent by this host, so a dead host or network is seen by nobody. Set
`BURNTICKER_STATUS_HEARTBEAT_URL` to an off-box monitor's ping URL (any https endpoint that takes a GET) and have the monitor alarm
when pings stop. The keeper GETs it after each completed cycle whose errors, if any, are about single coins or fence holds (those have their own alerts; no body, 10-second limit); when the cycle itself failed or every live coin errored it sends a Healthchecks (hc-ping.com) URL plus `/fail`, and nothing to any other monitor. The URL is never logged or published. ops.json and the
morning block print `- heartbeat: configured, ...` or `- heartbeat: not configured`.

Owner setup (once): create a push topic or app on a phone push service that accepts a plain-text POST with a bearer token, then put
`BURNTICKER_PUSH_URL=<its https publish address>` and `BURNTICKER_PUSH_TOKEN=<its token>` in the host's environment file (the keeper and
the publish timer both read it), restart the keeper between cycles, and check the banner line says `+ phone push`. To test without
waiting for trouble, from `~/meme-coin-trader` as mct:

```sh
sqlite3 data/burnticker.db "UPDATE status SET value=json_set(value,'$.lastDaily',NULL) WHERE key='push.state'"   # the next check after 08:00 Denver sends the daily line
```

**Units that are not in the repo** (audit 2026-10-16 F-9). Every unit on the Burnticker host comes from `deploy/systemd/` through
`scripts/ops/install-burnticker-units.sh`; a unit installed by hand is not reviewed, not redeployed and not documented. The one found
on 2026-10-16, `mct-rehearsal-keeper.service/.timer` (the $REHEARSAL keeper on MAINNET, one cycle an hour,
`BURNKEEPER_RULES=config/burnkeeper/rehearsal.rules.json`, its own ledger `data/burnkeeper-rehearsal.db`), failed every hour for two and
a half days unseen; its timer was disabled that morning. Why it failed: the unit sets the $REHEARSAL values with `Environment=` lines AND
loads `.env.local` with `EnvironmentFile=`, and systemd lets the file win, so the $DEFICIT keeper's `BURNKEEPER_RULES_SHA` (and its
`BURNKEEPER_MINT` and ledger, had the check not stopped it) replaced the rehearsal's; the keeper refused with "BURNKEEPER_RULES_SHA does
not match the loaded rule file". The refusal is the safety check working. Whether $REHEARSAL keeps a keeper is the owner's call
(TODO-OWNER.md #31). To bring it back it must come into `deploy/systemd/` with its values in a file of its own that is loaded AFTER
`.env.local` (or with no `.env.local` at all), and a test; to retire it, as mct:

```sh
systemctl --user disable --now mct-rehearsal-keeper.timer; systemctl --user stop mct-rehearsal-keeper.service
rm ~/.config/systemd/user/mct-rehearsal-keeper.service ~/.config/systemd/user/mct-rehearsal-keeper.timer
systemctl --user daemon-reload; systemctl --user reset-failed mct-rehearsal-keeper.service
systemctl --user list-units 'mct-*' --all --no-pager      # nothing but the units in deploy/systemd/
```

Keep `data/burnkeeper-rehearsal.db` either way (its receipts are the rehearsal's evidence). Until the failed state is cleared, the
keeper's unit check names it in its one combined `bt-unit-failed` alert (keyed by the set of units, so a new failure is still a new alert).

Every alert that changed anything gets a line in `docs/burnticker/incidents/LOG.md` (append-only, rendered on the trust page) — and, when it is an incident under [INCIDENTS.md](INCIDENTS.md), a public postmortem within 48 hours from [incidents/TEMPLATE.md](incidents/TEMPLATE.md).

## A game coin held by a disagreement

A single-game coin (one team in one game, both coins of two teams in one game, or a one-market Polymarket coin on a game moneyline)
burns as soon as two independent sources agree on its final (each of TheSportsDB, the market's settlement on chain, the league's feed
and API-Sports counts once), or once one source has shown the same final on two keeper reads at least 4 minutes apart (owner
decisions 2026-10-16 and 2026-10-18 evening, which dropped the 12-hour wait; `src/lib/burnticker/sources/gameSettle.ts` `gameSchedule`). A tie read on chain (a split, or a soccer draw leg) never counts toward
the two, so a draw burns early only when two score sources agree on it. A game that has been held by a disagreement or a contradiction, released by
hand, or has an ignored source never takes the two-source path: it burns once one source has shown the agreed final twice after the
hold ends. The reading's title says which rule settled it: "burned when two sources had confirmed it" or "burned when one source had
confirmed the final twice" (readings written before 2026-10-18 say "burned 12 hours after the final was first read"). The keeper keeps one record per game in the status table key `games.firstReads`, keyed `league:eventId`: when the final
was first read, by which source, the agreed result, and each source's latest read. When two sources disagree, the record's `disputed`
list is set and the game is held (`bt-feed-disagree`). It stays held while any source in that list is quiet, and it is released only when
every one of them reads again and they all agree; after a dispute a source has to show the agreed final twice again.

What to read:
- `R scripts/burnticker-game-hold.mts --show` lists every record: `HELD (disagreement)`, the first read, the due time, and each source's
  remembered read with its time.
- Read each source for that game by hand: TheSportsDB's event (`https://www.thesportsdb.com/`), the league's own feed where it has one,
  and the market's payout on Polygon (the condition id is in the keeper log line).

How to resolve: if the sources will catch up (a provider fixing its final, a market still in its dispute window), wait; the next read
that agrees clears the hold. A record can also be `HELD (contradiction)`: one source contradicted itself or the others before a result
could be compared (two legs of a soccer three-way settlement paying out, a settlement naming neither team, a TheSportsDB row whose team
order cannot be told, a 90-minute winner on chain while a score read says extra time). It is cleared only when that source reads the game
again cleanly, and then a source has to show the agreed final twice again.

If one source will never agree (a feed that keeps a wrong final, or a market settled the wrong way on chain, which can never change),
release it with the guarded script, never by editing the table, and name that source with `--ignore` (the name exactly as `--show`
prints it under `reads`). Without `--ignore` the source reads the other result again on the next cycle and the game is held again:

```bash
systemctl --user stop mct-burnticker-keeper   # data/PAUSE-burnticker holds cranks only; reads (and this record) go on, so stop the keeper
R scripts/burnticker-game-hold.mts --release nfl:2475453 --side home --ignore "on-chain payout" --note "TheSportsDB and NFL.com both show DEN 17-14; the market settled on chain for SEA and cannot change"
R scripts/burnticker-game-hold.mts --release nfl:2475453 --side home --ignore "on-chain payout" --note "…" --apply
systemctl --user start mct-burnticker-keeper
```

The release drops the remembered reads that name another winner and every read of an ignored source, clears the dispute or
contradiction, and the game then burns once one source has shown that result twice after the release, with the note kept on the record. An ignored source is saved on the record
(`ignored`) and its reads are not counted for that game while the record lasts; the game goes on the remaining sources. A source that
still reads the other result and was not ignored disputes it again on the next cycle. The keeper drops records more than 60 days old,
but never one that is held or carries an ignore list. A release you make by hand is an incident (INCIDENTS.md §7).

The second signer (`scripts/burnticker-signer.mts`) and the attester script read without a first-read store, so they never produce a
game coin's reading on their own: they fail safe (no cosignature, the reading waits). With today's quorum of 1 that changes nothing; give
the signer its own persistent store before a game coin needs two signatures. The season rehearsal (`scripts/burnticker-season-rehearsal.mts`)
settles every game as a game coin too, on a memory store with the clock moved to its due time.

## Closing creator launches

Set BOTH `BURNTICKER_CREATOR_LAUNCHES_ENABLED` off (or `BURNTICKER_CREATOR_LAUNCHES_PREVIEW=1`) AND `BURNTICKER_CREATOR_LAUNCHES_CLOSED_AT=<ISO time of the closure>` in the web host's env and in the keeper's env, then restart both. While closed, a confirmation is still taken (the coin is already on chain), but only for a create whose block time is before that moment; the keeper's draft reconciler reads the same variable. Without it, the closure is the first time the web host handles a launch request while closed (registry status `launches.closedAt`), which is later than the real closure. Reopening clears that status on the next launch request.

## Add a token by hand

The wizard (`/burnticker/launch`) is the path; by hand is for a rehearsal coin or a recovery. The rule text must be CANONICAL (the registry
re-locks it and refuses otherwise), the ticker unique, the mint real (the LaunchLab create's mint), the baseline the launch time.

```sh
RULE_FILE=/path/rules.json MINT=<mint> TICKER=<TICKER> NAME="<name>" CREATOR=<creator pubkey> FEE_PDA=<fee pda> LAUNCH_TX=<sig> POOL_ID=<pool> PLATFORM_ID=$BURNTICKER_PLATFORM_ID KEEPER_PUBKEY=$BURNTICKER_KEEPER_PUBKEY \
R --input-type=module -e '
import fs from "node:fs"; import { openRegistry } from "./src/lib/burnticker/registry.ts"; import { lockRule } from "./src/lib/burnticker/rules.ts";
const rule = JSON.parse(fs.readFileSync(process.env.RULE_FILE, "utf8")); const locked = lockRule(rule);     // validates + canonical text + sha256
const r = openRegistry("data/burnticker.db");
const t = r.register({ mint: process.env.MINT, ticker: process.env.TICKER, name: process.env.NAME, creator: process.env.CREATOR, description: process.env.DESC ?? "", imageUrl: null, links: [],
  rulesText: locked.text, feePda: process.env.FEE_PDA, vault: null, tokenConfig: null, poolId: process.env.POOL_ID ?? null, launchTx: null, cluster: process.env.CLUSTER ?? "mainnet", platformId: process.env.PLATFORM_ID ?? null,
  baselineAt: new Date().toISOString(), status: "draft" });
r.markLaunched(t.mint, process.env.LAUNCH_TX, process.env.POOL_ID ?? null, process.env.BASELINE_AT ?? new Date().toISOString());
r.addAttester({ mint: t.mint, pubkey: process.env.KEEPER_PUBKEY, role: "data-key", addedAt: Date.now(), timelockUntil: null });
console.log(JSON.stringify({ mint: t.mint, ticker: t.ticker, rulesSha: t.rulesSha, selectorKey: t.selectorKey }, null, 2)); r.close();'
```

Within a minute the keeper publishes `t/<TICKER>/` and rewrites `data/own-tokens.generated.json` (`[refuse-list] … rewritten` in the log) — the
arms on the trading VPS do **not** read this host's file: copy the entry into the trading VPS's `data/own-tokens.generated.json` (or the static
`config/own-tokens.json`) if a platform coin must be refused there too (`$DEFICIT` is already in the static file). `rules.json` for a rule:
see README §2 and `test/burntickerHelpers.ts` for the four shapes. Refuse-list topics (`config/burnticker/refuse.json`) are applied by the
wizard; by hand, you are the check.

## Replay / verify a receipt

Every receipt carries its own proof: `t/<TICKER>/receipts.json` → `verify` (the source `curl`, the formula, the expected memo fields) and the
transaction. To verify one by hand:

```sh
R scripts/burnticker-audit.mts --json | jq '.mismatches'                      # all receipts, all tokens, from readings + rule (exit 1 on any mismatch)
jq '.[] | select(.eventId=="<event id>") | {status, units, spent, burned, memo, verify}' data/burnticker-site/t/<TICKER>/receipts.json
curl -s "<verify.sourceUrl>"                                                   # the settled result the reading came from (Kalshi / the feed)
sqlite3 data/burnticker.db "SELECT * FROM readings WHERE event_id='<event id>'; SELECT * FROM burns WHERE event_id='<event id>'; SELECT * FROM signatures WHERE event_id='<event id>';"
solana confirm -v <signature> --url mainnet-beta | grep -A1 'Memo'             # the memo on chain must equal burns.memo (the audit does this when BURNTICKER_PROGRAM_ID is wired)
```

A receipt is correct when: the reading equals the source, `units` follow from the rule (`BT|…|units=`), the spend equals
`pool × (1 − (1 − f)^units)` on the recorded pool (the keeper's `buybackSpend`), and the memo on chain equals the row's. For $DEFICIT the
same with `scripts/burn-keeper.mts --print-rules` (the rules sha) and `data/burnkeeper-site/burns.json`'s verify blocks.

## Back up data/burnticker.db (and restore)

The registry is WAL-mode SQLite and append-only. **Never copy the live file or its `-wal`/`-shm`** (a torn copy, and a reader that looks
whole). Always the online backup API. Since 2026-10-16 (prelaunch audit F-7) a timer does it:

- **`mct-burnticker-backup.timer`**, every 6 hours (00:17, 06:17, 12:17, 18:17 UTC), runs `scripts/service/run-burnticker-backup.sh`:
  `sqlite3 <db> ".backup …"` of `data/burnticker.db` (the registry), `data/burnkeeper.db` (the $DEFICIT ledger),
  `data/burnticker-mintbank.db` (the mint key bank) and `data/burnticker-swap-pending.db` (the held-swap records) into `data/backups/<name>-<UTC stamp>-000.db` (mode 0600), `PRAGMA quick_check` on
  each copy, the newest 14 of each kept. Never an env file or a key file (the script refuses such a path).
- **Off the box**: this run's copies go to `BURNTICKER_BACKUP_DEST` (`user@host:path` over scp with a key, a local path, or
  `rclone:<remote>:<path>`), set in the environment or on its own line of `.env.local` (the script reads only that line). Unset, the log
  says `off-box copy SKIPPED` and the copies stay on the box: the owner names the destination (TODO-OWNER.md #29). This push never sends
  the mint key bank; the pull described next takes every file in `data/backups/`, the mint key bank's copy included (its keys are
  sealed, and opening them needs the key in the host's settings file).
- **Off the box, the way this host does it**: the destination is left unset on purpose. Instead, a copy is pulled to separate storage
  every six hours: the operator's own machine fetches the backups over ssh, checks each database copy with `PRAGMA quick_check`, keeps
  it for 30 days in the operator's own storage, and then records the pull on the host in `data/offbox-pull.json` (schema
  `burnticker.offbox-pull/v1`: the time of the pull, a method name, how many database copies, whether the encrypted settings bundle
  was written, the check result and the retention; no secret and no path). A receipt that is not exactly that shape is ignored. The
  keeper reads it: `offBox` is `pulled` while the receipt is under 12 hours old, `stale` after that (and `bt-backup-offbox-stale` is
  pushed), `none` when there is no receipt. ops.json carries `offBox`, `lastOffBoxAt`, `offBoxMethod` and `offBoxPulledAt` in
  `hostFacts`, and a line "off-box backup pull: ...". `backupDestConfigured` stays a separate fact and reads false here.
- **Evidence**: `logs/burnticker-backup.log`; `data/backups/last-backup.json` (`ok`, `at`, `files`, `offBox`, `error`). A failed run
  leaves the unit failed; the keeper's unit check pushes `bt-unit-failed` and, from the status file, `bt-backup-failed` (see "On each alert").
- Install: `sh scripts/ops/install-burnticker-units.sh` (copies, enables and starts the timer; needs `apt install sqlite3`).
  By hand: `sh scripts/service/run-burnticker-backup.sh`; list: `sh scripts/service/run-burnticker-backup.sh --list`. The one-off
  equivalent for a single file: `sqlite3 data/burnticker.db ".backup data/backups/manual.db" && sqlite3 data/backups/manual.db "PRAGMA quick_check"`.

**Restore** (an incident entry too, because the triggers' promise is "no history edits"):

```sh
systemctl --user stop mct-burnticker-keeper mct-burnticker-web          # whatever writes the file
mv data/burnticker.db data/burnticker.db.before-restore
for x in wal shm journal; do [ -e data/burnticker.db-$x ] && mv data/burnticker.db-$x data/burnticker.db-$x.before-restore; done   # kept, never deleted
sh scripts/service/run-burnticker-backup.sh --restore data/backups/burnticker-<stamp>-000.db --to data/burnticker.db
systemctl --user start mct-burnticker-web mct-burnticker-keeper
```

The restore checks the backup (quick_check), copies it with the backup API into a temporary file, checks that, moves it into place and
prints the seconds taken; it refuses a target that exists, or one whose `-wal` or `-journal` is still beside it. The restore drill (`test/burntickerBackup.test.ts`) times it on a fixture.
A backup is also what an auditor runs `scripts/burnticker-audit.mts` against (`BURNTICKER_DB=<copy> BURNTICKER_PUBLISH_DIR=/tmp/x`).

### Where the backups are, and a restore from scratch

What is where, in plain words (no secret is written here):

- **On the host**: the timer's copies of the four databases in `data/backups/`, the newest 14 of each.
- **Off the host**: the operator's own machine pulls `data/backups/` every six hours and keeps 30 days of copies in two places on its own storage. The newest copy of each database is checked with `PRAGMA quick_check` before it counts.
- **The host's settings file and the two signer files** travel as one encrypted bundle in the operator's storage. One passphrase opens it, and that passphrase is kept in one place today: the keychain of the operator's machine. A second copy kept offline is an owner step (TODO-OWNER.md #33). The databases alone cannot sign anything.
- **The pull script and the restore drill** are kept in the private repository and installed on the operator's machine. The installed copy is the one that runs, and a test fails when the two differ.

**The restore drill.** On the operator's machine, `sh restore-drill.sh` (installed beside the pull script) restores the newest copy of each database into a new temporary directory, runs `PRAGMA quick_check` and `PRAGMA integrity_check` on each one, counts the coins, receipts and readings, opens the registry with the site's own reader, and checks that the encrypted bundle opens without writing any of it to disk. It prints one paragraph and saves the same result as `last-restore-drill.json` beside the pull's own record. It never touches the host, and it refuses a scratch directory inside live data or inside the backups.

**Rebuilding a host from the backups**, in order:

1. Provision a new host and install the release (`docs/burnticker/deploy.md`). Leave the keeper and the web stopped.
2. Copy the newest database copies to the new host and restore each one with the step above, under the names the services use: `--restore <copy> --to data/burnticker.db`, then the same for `burnkeeper.db`, `burnticker-mintbank.db` and `burnticker-swap-pending.db`.
3. On the operator's machine, open the encrypted bundle with the passphrase, put the settings file and the two signer files back where the settings file says (mode 0600, owned by the service user), and delete the opened copies from the operator's machine.
4. Start the web, then the keeper, and check ops.json, the status page and one token page. Write the restore up in `docs/burnticker/incidents/LOG.md` with the time it took.

## Go / no-go gates — ticked, with proof, before `--send` on $DEFICIT

| # | Gate (one line) | Proof |
|---|---|---|
| 1 | Devnet rehearsal complete on the PROGRAM path: deploy → initialize_token → create (creator = fee PDA) → buy → keeper attests → claim into the fee PDA → register_pool → crank_buyback burns → receipt page green | `docs/burnkeeper/devnet-run.md` §4 table filled with explorer links; `data/burnkeeper-devnet-site/burns.json` shows one `confirmed` day with `execution: "program"` whose verify block recomputes; `status.json` `.program.attestation.lastReading` set |
| 2 | MAINNET REHEARSAL COIN: a disclosed throwaway ($REHEARSAL, ~0.1 SOL, LP locked forever, listed on the trust page as a rehearsal) created under the REAL platform config 1–2 days before | its launch JSON saved (`/tmp/rehearsal.json`: `mint, poolId, creatorFeeVault, platformId`), a `confirmed` burn in `data/burnticker-site/t/REHEARSAL/receipts.json`, `audit.json` `ok: true`, and the rehearsal line in `docs/burnticker/incidents/LOG.md` |
| 3 | Fee routing on the rehearsal coin's first real trades: creator == the program's fee PDA, platform fee vault accrues 25 bps | `jq '.creator, .burnPool.feePda, .burnPool.creatorIsFeePda' /tmp/rehearsal.json` → the same address twice and `true`; `spl-token balance --address <creatorFeeVault>` grew by 0.5% of a test buy; the platform vault (`platformFeeVault` in the JSON) grew by 0.25% |
| 4 | Two-person pre-send read of the launch JSON (mint, decimals 6, supply, creator, platform id, rules sha, metadata URI/image) against this checklist | the dry-run JSON (`/tmp/deficit-dry.json`) initialled by the owner next to each field; `jq '.rules.sha256' /tmp/deficit-dry.json` equals `R scripts/burn-keeper.mts --print-rules` and `BURNKEEPER_RULES_SHA` |
| 5 | Mint-first announcement: the mint address is in both X bios and on the site BEFORE any other post ("the only $DEFICIT is mint …") | screenshots of both bios with the mint; `grep -c <mint> /var/www/deficit/index.html` ≥ 1 and `curl -s https://<deficit host>/status.json | jq .addresses.mint` |
| 6 | Feed-late paragraph published on the site (nothing burns when Treasury is late; the next reading absorbs the delta; no human invents a number) | `grep -i "late" /var/www/deficit/index.html` finds the paragraph; the same sentence in `config/burnkeeper/deficit.rules.json` `statement` context |
| 7 | No Telegram/Discord at launch — X + public repo only (policy line on the trust page) | the line is in `statements` in `src/lib/burnticker/trust.ts` and renders at `https://burnticker.com/burnticker/trust`; no invite link anywhere in `site/` (`grep -ri "t.me\|discord" site/ src/app/burnticker` → nothing) |
| 8 | Failure definition on the trust page: if the coin trades at any price, nothing changes — no relaunch, no v2, no rebrand | the sentence in `statements` in `src/lib/burnticker/trust.ts`, visible on `/burnticker/trust` and quoted in the launch thread |
| 9 | Copy lint: every post produced by `scripts/burnkeeper-post-draft.mts` (forbidden-word refusal) and approved by the owner — no freehand posts | each post's draft file saved from `R scripts/burnkeeper-post-draft.mts …` (exit 0; exit 3 = refused) with the owner's OK; the launch thread text equals a draft byte for byte |
| 10 | Alerts verified end to end (a test alert reached the phone) | the webhook `curl` from §On each alert returned 200, the row shows on the trading VPS's wallet page / check-in (`bt-test`) and the Telegram message arrived; `https://burnticker.com/ops.json` `.webhook.lastOkAt` set |
| 11 | Backups: sqlite `.backup` of `data/burnticker.db` (and `burnkeeper.db`) scheduled, copied off the box | `systemctl --user list-timers mct-burnticker-backup.timer` shows the next run; `data/backups/last-backup.json` has `"ok":true` newer than 6 h and `"offBox":"copied"` (BURNTICKER_BACKUP_DEST set), or `data/offbox-pull.json` is under 12 hours old (the six-hourly pull; ops.json `hostFacts.offBox` is `pulled`) |
| 12 | Keys: keeper key generated ON THE HOST, ops/deployer wallets fresh, dev fee wallet = hardware, Squads 2-of-3 created and holding upgrade + platform authority, deployer drained | `ls -la ~/.config/meme-coin-trader/` (two `.enc.json`, mode 600, created on this box); `solana program show <program id>` → upgrade authority = the Squads vault; the PlatformConfig admin = the Squads vault (trust page "live PlatformConfig" row); `solana balance <deployer>` ≈ 0 |
| 13 | The public repo published at the tagged commit with the program hash | the tag exists (`git tag --contains` on the Mac), the repository link + `BURNTICKER_PROGRAM_HASH` on the trust page's program section, and `sha256sum program.so` of `solana program dump` equals it |

No gate, no `--send`. A gate that cannot be proven with its artefact is a no-go, not a judgement call.

## Pair program gates — `pair_curve` (2026-10-10; before `BURNTICKER_PAIR_CURVE_ENABLED=1` on mainnet)

`pair_curve` is deployed and governed exactly like `burn_receipts`: the deployer deploys once, the upgrade authority moves to the same
Squads 2-of-3 vault with its time lock, every later change is a Squads vault transaction (`scripts/squads-program-upgrade.mts` creates
the proposal — `squads-multisig-cli` 0.1.7 cannot; the CLI votes and executes), and the authority is finalised on the same plan as
`burn_receipts` (README §5.3). Design and threat model: `docs/burnticker/PAIR-CURVE.md`.

| # | Gate | Proof |
|---|---|---|
| P0 | the mainnet build pins Burnticker's mainnet LaunchLab platform: `BURNTICKER_PLATFORM` in `programs/burn-receipts/programs/pair_curve/src/constants.rs` (default feature) set to the owner's platform key in a reviewed commit — the shipped default is all zeros, and that build refuses every `init_pair` with `PlatformNotPinned` | the constant in the tagged commit = the platform the launch wallet created; a dry-run `init-pair` against a local validator with that platform passes and with any other platform fails `InvalidLaunchlabPlatform` |
| P1 | `burn_receipts` on the cluster includes `register_pair_pool` (upgraded through the vault) | `solana program dump AuQj…zhMM` sha256 = the tagged build; the IDL lists `register_pair_pool` |
| P2 | `pair_curve` deployed from the tagged commit at `2jQotwSG8WKNYr5pccxuVmNa314qcnnwmrhqbuakELkN` (keypair `~/.config/meme-coin-trader/mainnet-keys/pair_curve-program.json`, never committed), DEFAULT-feature build (mainnet CPMM/LaunchLab ids), verifiable hash recorded | `solana program dump` sha256 = the verifiable build; a byte scan finds the mainnet CPMM id and not the devnet one |
| P3 | upgrade authority = the Squads vault; every upgrade proposed with `scripts/squads-program-upgrade.mts` (it refuses unless the buffer's executable hash equals `config/burnticker/verified-build.json` for the program and cluster, the buffer and program authorities are the vault and the spill is the vault or a member, and prints all four for the voters); **while any pair is live, an upgrade keeps the `Pair` layout byte-for-byte (new fields only inside `reserved`) or ships and runs a migration first** — a layout change makes every live Pair unloadable, exits included (devnet pair 1, PAIR-CURVE.md §7); the authority is finalised (none) before the first public pair — blind review 1 M-2 | `solana program show 2jQo…ELkN` → `Authority: <VAULT>`; the proposal JSON's `checks` block |
| P4 | devnet rehearsal green: a pair graduated to two CPMM pools with LP locked forever (lock_lp, Fee Keys at the fee-keys PDA) and both registered, one burn per side; a pair voided and sold back to the vault's rent minimum | `docs/burnkeeper/devnet-paircurve-run-log-2026-10-10.md` checkpoints PC1–PC7; `node scripts/ops/verify-evidence-signatures.mjs` PASSED |
| P5 | blind review of `pair_curve` + `register_pair_pool` completed, findings closed or accepted in writing — two reviews done 2026-10-10 (`docs/burnticker/reviews/2026-10-10-pair-curve-blind-{1,2}.md`), all findings fixed or accepted in `docs/burn-receipts/CHANGELOG.md` (late evening) and re-rehearsed on devnet; a re-review of the fixed program (`fa8627a4`) is still owed | `docs/burnticker/reviews/`; `cargo test -p pair_curve --test review_pc1 --test review_pc2` green |
| P6 | the platform's `platformClaimFeeWallet` is the developer wallet and holds ≥ the rent minimum (trades accrue the 25 bps in the pair's vault either way; `claim_developer_fee` and `close_pair` wait until the wallet can receive) | `burnkeeper-launch.mts platform` dry run shows the wallet; `solana balance <wallet>` |
| P7 | the pinned AmmConfig's create-pool fee is what the launch parameters assumed (init_pair refuses a target whose minimum side cannot pay for its pool) | `scripts/paircurve-admin.mts init-pair` dry run prints `createPoolFee` and `sideCosts` |
| P8 | the keeper runs in program mode with the flag on and its crank works on a test pair (graduate/void) | keeper log line `pair curve: N pair(s) scanned, M cranked` |

Turning the flag on changes only how NEW pairs launch; existing LaunchLab pairs keep the rules-level void clause.

## Winner takes the burn — before the first public pair (El-Sayed / Rogers; 2026-10-11)

Pairs ship flag-off; a single coin's path does not change. Every pair made since 2026-10-11 runs winner takes the burn (decisions.md):
at each result the losing coin's fuel forwards to the winning coin's burn pool. Before the El-Sayed / Rogers pair (or any first public
pair) goes out, in order:

| # | Step | Proof |
|---|---|---|
| W1 | burn_receipts on the cluster is the §40 build: 29 entrypoints (`link_pair`, `submit_pair_result`, `forward_to_winner`) | `solana program dump AuQj…zhMM` sha256 = `config/burnticker/verified-build.json`; the IDL lists the three |
| W2 | both coins are built in ONE pair request (`buildPairBundles`): side B's draft and mint exist before side A's bundle, A's `initialize_token` names B (`pair_mint`), B's names A back (`partnerFirst`) — sign A, then B, the same session (the pairing window is 7 days; after it both are plain coins for good) | the bundles' review lines say "pair_mint … (provisional for 7 days)" / "(completes the pairing)"; after both land, `burnreceipts-admin pair-status` shows `paired` on both |
| W3 | both rules carry `pair.winnerTakesBurn: true` and both locked descriptions the sentence "Paired with a rival coin: fees from both coins burn the winner's supply (the coin whose rule a result fires)." | the two `rules.json` files; the coin pages |
| W4 | the keeper holds an attester key of BOTH coins (it signs one PairResult for both quorums); quorum ≤ 2 per coin, or a v0 transaction with a lookup table (ATTESTERS.md) | `status` on each coin: the keeper key in both attester sets |
| W5 | on the race's settlement day: the keeper attests both coins, posts the PairResult naming the winner, the loser's forward lands, then the winner's crank burns | keeper log: "result recorded — $X takes the burn", "forwarded from $LOSER: N SOL → $WINNER burn pool", then "$WINNER … CRANKED"; the pair page tallies the forward |
| W6 | alerts to act on: `pair-unmatched` (a coin has not named the other back), `pair-result-missing` (12 h after a reading; the program burns the period unpaired at 72 h), `pair-forward-pending` (1 h; the loser's fuel did not move — the plain sentence names the program refusal), `pair-forward-missing` (72 h passed: the lost period burned its own coin), `pair-result-unservable` (a win could not be recorded: a reading for the day is missing or the loser's is already processed — no draw is substituted; the period times out at 72 h), `pair-forward-impossible`, `pair-link-refused` (`PairHasReadings`: a pair_curve coin read before `link_pair`) | `status/status.json` `alerts.kinds`; `pairs[].lastForward` |
| W7 | (round 3; sending on, `KeeperDeps.pairUnlink: false` only observes) a pair that can never be live is unlinked by the keeper on TERMINAL evidence only — a voided pair curve, a refunding side, or a LaunchLab pair whose locked voidBy day ended with a coin unverified (never an Open pair; no time-based rule) — and both become plain coins (pair state "unlinked"); `pair-unlinked` names the reason | `status/status.json` `pairs[].unpaired`; the pair page "unpaired (reason)" |

## Launch day — $DEFICIT, in order

**Creator launches stay closed** (`BURNTICKER_CREATOR_LAUNCHES_ENABLED` unset — deploy.md): the web wizard and the launch API refuse with "Creator
launches are not open yet. $DEFICIT is the first coin." The operator's coins ($REHEARSAL, then $DEFICIT) go out ONLY through the CLI steps below
and "Add a token by hand"; check `curl -s https://burnticker.com/api/burnticker/v1/catalogue | jq .launches` → `{"creators": false, …}` before
announcing anything.

Preconditions: every gate above ticked; weekday morning 08–09 Denver (Treasury posts ~14:00 Denver); the Burnticker host fully provisioned
(`deploy.md` §First run), both keepers installed and **stopped**, DNS live, `config/own-tokens.json` ready to take the mint. Commands are the
exact ones from `docs/burnkeeper/devnet-run.md` (mainnet section) and `docs/burnkeeper/fees.md`; every send needs `BURNKEEPER_MAINNET=1`
and `--i-understand-this-spends-real-sol`. Keys and the launch wallet are the owner's hands, on the owner's machine; this host only runs
the keepers afterwards.

1. **Platform config** (once per admin key; the fee dials 25 bps dev / 50 bps burn pool / LP 100% locked, the Fee Key to the burn program's fee-keys PDA — LP locked forever, owner decision 2026-10-10):
   `BURNTICKER_FEE_WALLET=<dev fee pubkey> R scripts/burnkeeper-launch.mts platform --cluster mainnet --admin <platform-admin.enc.json> --dry-run > /tmp/platform-dry.json`
   — read it (`jq '.feeSplit, .instructions'`); then the same with `--send --i-understand-this-spends-real-sol` and `BURNKEEPER_MAINNET=1`.
   Note `platformId` → the host's env file `BURNTICKER_PLATFORM_ID=…` on the Burnticker host. (`scripts/burnticker-platform-config.mts --admin <pubkey>` prints the same dry run without a key.)
2. **Deploy burn_receipts** (`docs/burn-receipts/README.md` §5: the mainnet build, `anchor keys sync` with the real key, deploy, the
   verifiable hash recorded, upgrade authority → the Squads 2-of-3 vault). `BURNTICKER_PROGRAM_ID=<program id>` in the host's env file.
3. **Mint** (pre-generated, never printed, outside any repo): `solana-keygen new --no-bip39-passphrase -o ~/.config/meme-coin-trader/mint-deficit.json && chmod 600 ~/.config/meme-coin-trader/mint-deficit.json && solana-keygen pubkey ~/.config/meme-coin-trader/mint-deficit.json`
   → write `"mint": "<pubkey>"` into `config/burnkeeper/deficit.rules.json` AND `"address": "<pubkey>", "status": "launched"` into `config/own-tokens.json` (commit both; ship to the trading VPS — the arms re-read the file by mtime, no restart).
4. **Rules sha**: decide `fractionPerUnit` (0.01 per the 10-09 batch) BEFORE hashing; `R scripts/burn-keeper.mts --print-rules` → publish the sha (site, metadata description, first post) and set `BURNKEEPER_RULES_SHA=<sha>` in the host's env file. Gate 4's read happens here.
5. **`initialize_token`** for the mint, signed by the payer, the creator and the mint keypair — `scripts/burnreceipts-admin.mts`
   (dry run first; it prints the rules sha it PINS, the decoded instruction and the TokenConfig the simulation leaves behind):
   `R scripts/burnreceipts-admin.mts initialize-token --cluster mainnet --program $BURNTICKER_PROGRAM_ID --payer <launch-wallet.enc.json> --mint ~/.config/meme-coin-trader/mint-deficit.json --creator <creator key> --admin <Squads vault PDA> --attester <the $DEFICIT keeper's address> --quorum 1 --launchlab-platform $BURNTICKER_PLATFORM_ID --rules config/burnkeeper/deficit.rules.json --twap-window 1200 --twap-deviation-bps 300 > /tmp/init-dry.json`
   — check `jq '.rulesSha256, .simulation.err, (.resultingAccounts[] | select(.kind=="TokenConfig").state | {rules_sha256, ll_platform, ll_cp_config, cluster_genesis, quorum})' /tmp/init-dry.json`
   (`rulesSha256` = step 4's sha; `ll_cp_config` = the platform's cpConfigId; `cluster_genesis` = mainnet's); then the same line with
   `--send --i-understand-this-spends-real-sol`. It funds the fee PDA's reserve and PINS the LaunchLab platform (review-3 M-3: the
   platform's platformCpCreator must be unset and its LP lock+burn scales ≥ 50 %). The keeper refuses to run if the config's sha, mode,
   prefix or decimals differ from the rule file.
6. **Launch gate, immediately before the create (re-check R3-3):** `R scripts/burnreceipts-admin.mts verify-platform-pins --cluster mainnet --program $BURNTICKER_PROGRAM_ID --mint <MINT>`
   must exit 0 ("platform pins hold"); exit 1 means the LaunchLab platform's platformCpCreator, LP lock/burn scales or cpConfigId
   changed since step 5 — **do not create** (README §5 "Launch gate: platform pins"). Read-only; run it in the same sitting as the create.
   **LaunchLab create with creator = the fee PDA** (`["fee", mint]` under `BURNTICKER_PROGRAM_ID`; `--creator` omitted = the fee PDA):
   `R scripts/burnkeeper-launch.mts launch --cluster mainnet --payer <launch-wallet.enc.json> --mint-keypair ~/.config/meme-coin-trader/mint-deficit.json --name DEFICIT --symbol DEFICIT --uri <metadata JSON URL> --raise-sol 85 --dry-run > /tmp/deficit-dry.json`
   — `jq '.burnPool.creatorIsFeePda, .burnPool.programIdIsLocalnetPlaceholder'` must print `true` and `false`; read every decoded instruction and the simulation;
   then the same line with `--send --i-understand-this-spends-real-sol` under `BURNKEEPER_MAINNET=1` `> /tmp/deficit.json`;
   `jq '{mint, poolId, creatorFeeVault, platformFeeVault, cpmmAfterGraduation, rules, sent}' /tmp/deficit.json`. NO team buy (`--first-buy-sol 0`).
7. **Seed 3 SOL into the fee PDA** (a gift to the burn pool, disclosed): one plain transfer of 3 SOL from the owner's wallet to the fee PDA
   (`jq -r .burnPool.feePda /tmp/deficit.json` — NOT the keeper: in program execution the fee PDA is the pool, and nothing can withdraw
   it); record the signature → `BURNKEEPER_SEED_TX=<sig>` `BURNKEEPER_SEED_SOL=3` in the host's env file (the status page discloses both). Also
   ≥ 0.1 SOL to each keeper's own address for transaction fees.
8. **Keeper units** on the Burnticker host (the host's env file now carries `BURNKEEPER_EXECUTION=program`, `BURNTICKER_PROGRAM_ID`, `BURNKEEPER_MINT=<mint>`, `BURNKEEPER_MAINNET=1`, `BURNKEEPER_RULES_SHA`, `BURNKEEPER_CREATOR_FEE_SOURCE=<creatorFeeVault>`, `BURNKEEPER_SEED_TX/_SOL`, `BURNKEEPER_RPC_URL`, `BURNKEEPER_SIGNER_PASSPHRASE`; `BURNTICKER_CLUSTER=mainnet`, `BURNTICKER_PLATFORM_ID`, `BURNTICKER_KEEPER_PUBKEY`, `BURNTICKER_FEE_WALLET`, `BURNTICKER_RPC_URL`, `BURNTICKER_MAINNET=1`, `BURNTICKER_ADMIN=<Squads vault>`, `BURNTICKER_ALERT_WEBHOOK(_TOKEN)`; **no** `BURNKEEPER_CLAIM_CREATOR_FEES` — that is a legacy flag and the legacy leg refuses it):
   `systemctl --user start mct-burnkeeper && tail -n 20 logs/burnkeeper.log` (banner: `execution program`, mainnet, the mint, the fee PDA, attesters/quorum, the rules sha; then `[attest] … attested and submitted` for the baseline, `[fees] curve: …`, and `waiting for the CPMM pool` until graduation) ·
   `systemctl --user start mct-burnticker-keeper && tail -n 20 logs/burnticker-keeper.log` (banner: `program … (REAL: …)`) ·
   `sh scripts/ops/deploy-sites.sh` · `curl -s https://<deficit host>/status.json | jq '.execution, .rules.sha256, .addresses.mint, .program.attestation, .program.queue'`.
9. **After graduation** (LP-lock round 2, 2026-10-11: the Fee Key FIRST, then the pool — `register_pool` takes the FeeKeyRecord and refuses
   `FeeKeyNotRegistered` without it; the keeper does both steps itself on its next cycle, `src/lib/burnticker/lockFeesKeeper.ts`; by hand:)
   `$R scripts/burnreceipts-admin.mts register-fee-key --cluster mainnet --program $BURNTICKER_PROGRAM_ID --payer <keeper key> --mint <mint>` (finds the
   migration pool PDA and the lock position whose locker is LaunchLab's vault_auth and whose Fee Key the fee-keys PDA holds), then
   `$R scripts/burnreceipts-admin.mts register-pool --cluster mainnet --program $BURNTICKER_PROGRAM_ID --payer <keeper key> --mint <mint> --pool <cpmmAfterGraduation.expectedPoolId>`
   (dry run shows `lpSupply`, `poolCreator` and the simulation: it must be the PDA of the PINNED cpConfigId with the fee PDA as creator and
   ≥ 50 % of the LP burned/locked; then `--send --i-understand-this-spends-real-sol`). If LaunchLab migrated elsewhere (simulation:
   `NotMigrationPool`), the Squads vault can switch the token to that pool: `set-registration-policy --admin <vault> --policy 1 --pool <pool>`
   (a Squads proposal; 48 h), then `apply-registration-policy --pool <pool>` (anyone). The keeper's next cycle checks pool health and
   cranks; the first crank defers (`TwapUnavailable`, shown as a wait) until the pool's oracle has 10–20 min of history. A one-off
   `check-pool-health` / `claim-launchlab-creator-fee` is the same CLI (`--mint <mint>`).
10. **Then:** the mint-first posts (gate 5, drafts from `scripts/burnkeeper-post-draft.mts`); the arms' logs on the trading VPS show `own token`
   refusals if any candidate carries the mint or ticker; the 14-day clock for signer two starts (trust page shows the due date; signer two is
   added on chain by `propose_attesters` together with the quorum raise to 2 — the shared-message submission is in place, and since
   review 3 a kept key must be ≥ 7 days in the set before it can vouch for a new one, which the 14-day clock satisfies); nothing else changes.
11. **Anti-impersonation, the same morning** (growth batch, owner-approved 2026-10-10). Copycats appear within the first hour of any
   launch. Do these in order:
   - **First post, then pin it.** The first post names the canonical mint and the burn_receipts program id in full, not shortened, and
     links `https://burnticker.com/burnticker/verify?mint=<MINT>`, which must answer "Burnticker coin: yes". Pin that post on @BurnTicker
     (and on @USA_DEFICIT for $DEFICIT). Every later post links the coin page, which shows "verified by program · mint …" above the fold.
   - **Verification requests, launch morning:**
     - DexScreener Enhanced Token Info for the mint (the paid form). Give the site, the X account and the logo, which is the generated
       receipt art.
     - Solscan token-info update for the mint (site, socials, logo).
     - Jupiter: the token verification request for the mint, through whatever form Jupiter currently uses (check its docs that morning).
     Record each request's date and reference in `docs/burnticker/incidents.md`, under "verification requests". None of them is a
     launch gate.
   - **Clone watch on:** `systemctl --user enable --now mct-burnticker-clonewatch.timer` (installed by `install-burnticker-units.sh`).
     Then `tail -n 20 logs/burnticker-clonewatch.log` after the first scan. `/burnticker/not-burnticker` and
     `GET /api/burnticker/v1/clones` list each lookalike with evidence only. The launch handler already refuses lookalike tickers and
     names (`src/lib/burnticker/lookalike.ts`) and any mint that already exists.
   - **Impersonator accounts, the same day:** report any X / Telegram account that impersonates @BurnTicker, @USA_DEFICIT or the
     platform. Use the platform's own impersonation form, from the owner's account. Note the handle, the time and the report reference
     in `docs/burnticker/incidents.md`. Never name a person in public; the "Not Burnticker" page lists tokens and evidence, not people.

## Trust ops (owner-approved 2026-10-10 night)

### Registry snapshots on Arweave

Once per UTC day (first cycle after 00:15 UTC) the ACTIVE keeper exports the append-only ledger — rules, readings, receipts, pairs,
pair outcomes, rule ends, launch pins — as canonical JSONL, uploads it through Irys and records `{date, sha256, arweaveTxId,
rowCounts}` in the registry's write-once `snapshots` table (`src/lib/burnticker/ops/snapshot.ts`). Needs `BURNTICKER_UPLOAD_PAYER` in the
host's env file (the same ops wallet that pins coin metadata; never the keeper signer) and a funded Irys balance; without it the job
refuses and alerts (`bt-snapshot-failed`) — there is never a server-hosted copy in its place.

```sh
R scripts/burnticker-snapshot.mts --list                        # every recorded snapshot
R scripts/burnticker-snapshot.mts --now                         # today's now, if not taken (exit 3 = refused: no payer)
R scripts/burnticker-snapshot.mts --export /tmp/ledger.jsonl    # the canonical bytes locally (no upload, nothing recorded)
R scripts/burnticker-verify-snapshot.mts <txid> --cluster mainnet --api https://burnticker.com             # anyone: re-download, recompute, compare
R scripts/burnticker-verify-snapshot.mts <txid> --cluster mainnet --db ~/backups/burnticker-<stamp>.db      # + every row still present, unchanged
```

The latest hash is on the status page, in `GET /api/burnticker/v1/snapshots`, on the trust page and in the platform daily post's footer
(`scripts/burnkeeper-post-draft.mts --template=platform` reads it from `status/status.json`).

### The public status page

`status/status.json` is rewritten every cycle into the publish dir (`src/lib/burnticker/ops/status.ts`; schema in that file's header):
keeper heartbeat and role, every selector's last good read, cross-read agreement and staleness, open alert kinds and counts (no text),
wind-downs and retired coins with their last sweep, the latest snapshot, program ids with the verified-build status, the fence. The
page that renders it is `site/burnticker/status/index.html` (shipped by `sh scripts/ops/deploy-sites.sh --pages-only`, and by every
`--publish-only` run of the timer). Served at `https://status.burnticker.com/` (Caddy site block; **owner: add the DNS record `A status
→ the Burnticker VPS`, grey cloud until the certificate is issued**) and at `https://burnticker.com/status/`.
When it shows "status.json: HTTP 404", the keeper has not written the file or the copy failed: `docs/burnticker/OPS-EDGE.md`
section 1 walks the chain (`sh scripts/ops/probe-burnticker.sh --box` on the host), and section 2 sets up the uptime monitors.

### Keeper redundancy (leader / standby)

`BURNTICKER_KEEPER_ROLE=leader` (default) on the primary host; on a second host `BURNTICKER_KEEPER_ROLE=standby` with
`BURNTICKER_LEADER_STATUS_URL=https://burnticker.com/status/status.json`, and on the leader `BURNTICKER_PEER_STATUS_URL=<the standby's
public status.json>`. Tunables: `BURNTICKER_TAKEOVER_MISSED` (default 5), `BURNTICKER_HEARTBEAT_STALE_SEC` (default 180). Code:
`src/lib/burnticker/ops/leaderLock.ts`, `readingFence.ts`, hooked into the keeper by `keeperOps.ts`.

- The standby runs every cycle PASSIVE: it reads every source, plans into its own registry, publishes its own status.json — and
  signs and sends nothing. It counts a heartbeat when the leader's status.json says `role: leader` and its last cycle is younger than
  180 s. After 5 consecutive misses (≈ 3 min of staleness + 5 one-minute cycles ≈ 8 minutes) it writes a takeover note signed with its
  keeper key (`data/burnticker-takeover.json`, published in its status.json) and goes ACTIVE. Without a key on the host it never
  takes over.
- The leader reads the standby's status.json each cycle and YIELDS (reads and publishes, cranks nothing) while the standby is active
  with a takeover note whose signature verifies. An unreachable standby never makes the leader yield.
- **Fail back by hand:** on the standby `systemctl --user stop mct-burnticker-keeper && mv data/burnticker-takeover.json
  data/burnticker-takeover.$(date +%Y%m%d-%H%M).json && systemctl --user start mct-burnticker-keeper` — it is passive again on its
  next cycle; the leader sees an inactive peer and resumes. Log it in incidents/LOG.md.
- **Keys:** to attest, a keeper needs a key in each coin's attester set. The program adds a key only with a quorum raise (fewer new
  keys than the new quorum — ATTESTERS.md §4), and then BOTH keys must sign every reading, which defeats redundancy. So the choice is:
  (A) the standby holds a copy of the same keeper key (full takeover; the key now lives on two hosts — twice the exposure), or (B) the
  standby holds only its own fee-payer key: after a takeover it publishes, runs the pair-curve cranks and cranks readings the leader
  already attested (cranking is permissionless — while the pre-audit cap is in force its key must be on the platform's cranker
  allowlist), and NEW readings wait (quorum-short) until the leader's key is back. Today's default is (B); (A) is the owner's call.

**What this design does NOT guarantee (said plainly):**

1. **It is not a lock.** Nothing shared decides who is active; each host decides from what it can see. In a symmetric partition
   (neither host can read the other's status page — e.g. the leader's outbound HTTPS is down while it still reaches its RPC) **both
   keepers are active for as long as the partition lasts**, not for a bounded number of minutes. With a one-way partition the leader
   yields within one cycle of seeing the note.
2. **Two active keepers cannot double-burn one reading:** the program stores one reading per date — a second `submit_reading` for the
   same date with the same counter is a no-op (it lands, changes nothing), with a different counter it is refused
   (`ConflictingReading`), and a date at or before the config's last one is refused (`StaleReading`) — and it processes each reading
   once (`AlreadyProcessed`). They **can double-pay fees**: every duplicate or losing `submit_reading`, crank, creator-fee claim or
   health check that reaches the chain costs its base and priority fee (a few thousand lamports each).
3. **Counting the same receipt into two readings** (a keeper whose registry missed the other's landed reading would add the same units
   to the next day) is prevented by the fence, not by the program: inside every cycle, after planning and before the first
   attestation (and again before a coin's freshly planned end-of-rule receipts are attested), a keeper adopts any on-chain reading it
   did not write whose units equal its own unassigned receipts through that day, and HOLDS all sends (`bt-foreign-reading`) when they
   differ or when the coin's TokenConfig cannot be read. (Until review 2 F1, 2026-10-11, the fence ran before planning, so a standby
   with an empty pending set checked nothing and counted the leader's receipts again.)
   The match is on unit totals per reading, not on event ids (the program stores only the hash of the source URL that names them); a
   coincidental equal total is adopted. A cycle that is already past its fence when the other keeper's reading lands loses its
   `submit_reading` in simulation (point 2) and is fenced next cycle.
4. **Takeover is slow on purpose** (≈ 8 minutes) and readings are late, never lost, in between. A leader that is alive but whose public
   status page is unreachable (Caddy or Cloudflare down) looks dead to the standby; that is a takeover, and the leader yields only if it
   can read the standby's page.
5. **Both hosts alert** (each dedupes per key per day on its own), and both snapshot on a day both were active (two records, two
   registries; the public API shows the host DNS points at). The public pages always show the DNS host's view.
6. A standby's registry is its own (fed from the same sources, seeded from a `.backup` of the leader's); after a takeover the two
   registries are reconciled by hand before failing back if the fence held anything.

### Monthly drills

- **Source-outage drill, first Monday of each month** (≈ 1 minute, no network, scratch registry): `R scripts/burnticker-drill.mts --feed
  treasury.debt --all` and one feed per category in rotation (`bls.eggs`, `noaa.flares`, `fred.UNRATE`). Every mode must print `DRILL
  PASSED` with five ✓ (control, withheld, alert, status, no-crank). A failure is an incident (INCIDENTS.md §3/§7). Note the date in
  incidents/LOG.md only when it fails.
- **Snapshot verify, same day:** `R scripts/burnticker-verify-snapshot.mts <latest txid> --cluster mainnet --db <latest .backup>` → `SNAPSHOT VERIFIED`.
- **Standby check, same day:** the standby's status page says `standby · passive` with a heartbeat under 3 minutes, and the leader's
  status page shows the peer reachable.

## Claiming the platform fee

(2026-10-16.) The LaunchLab platform's 0.25% curve fee collects in its wrapped-SOL fee vault (`getPdaPlatformVault(LaunchLab, platform,
WSOL)`, EcXnhWsJmc6vcart32M5ZXMmmCzXE3fiUz9qxqrWQKSn on mainnet) until the platform's claim wallet (PlatformConfig.platformClaimFeeWallet,
8cwwy895BENMJTueXfQovWD4mvuoJ4kgyR52UMrqSbo5, the operator treasury) claims it. Raydium's site does not offer the claim for a platform it
does not run, so `/burnticker/operator/claim-fees` builds it: open the wallet's wrapped-SOL account, `claim_platform_fee_from_vault`,
close the account into the wallet, so the fee lands as plain SOL. The page answers only on the operator's own network with the ops PIN
(the post queue's gate, `GET /api/burnticker/v1/ops/platform-fees`). Steps: make sure the claim wallet holds about 0.002 SOL (the network
fee plus the account rent, which comes back in the same transaction); open the page, enter the PIN, connect the claim wallet in Phantom,
press Claim. The page dry-runs the transaction before Phantom is asked, refuses any other wallet, checks what Phantom hands back, sends,
confirms, shows the signature and reads the vault again. The claim then appears in the fee ledger (`/burnticker/fees/ledger`) by itself,
since the ledger reads the claim wallet's history from chain.

## Signing the operator statement

(Moved here from the public operator page on 2026-10-11, review 2 §2: visitors see the "not signed yet" fact and the text; the steps are
for the operator. Rewritten 2026-10-12, ops-2.) The text is `config/burnticker/operator.json` → `signedMessage.message` (line 87): it
names the two program ids, the Squads vault and who holds its keys, the keeper key, the contact address and the never-acquire rule, and
no name. The signer is the mainnet developer fee wallet `8cwwy895…bo5` (`signerRole: dev-fee`). The script fills `{PUBKEY}` and `{DATE}`,
checks the signature exactly as the site does, and writes the three single-line edits (status, text, signature). Run it on the Mac from
the repository; it sends nothing anywhere.

```sh
R="node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/alias-hook.mjs"
# The developer fee wallet is a hardware wallet: it can sign only Solana off-chain messages, which the site accepts.
MSG="$($R scripts/burnticker-sign-statement.mts --date 2026-10-14 --print-text)"
solana sign-offchain-message -k 'usb://ledger?key=0' "$MSG"      # pick the ?key= index whose address is 8cwwy895…; prints the signature
$R scripts/burnticker-sign-statement.mts --date 2026-10-14 --signature <the printed signature> --write
# Or, with a key in a Solana CLI keypair file (it must be the signer wallet, or name another role with --role):
$R scripts/burnticker-sign-statement.mts --date 2026-10-14 --keypair <path to keypair.json> --write
# Then:
$R scripts/burnticker-trustpack.mts well-known --write && npm test
```

With a browser wallet such as Phantom (2026-10-18; the fee wallet is a plain Phantom wallet, so `solana sign-offchain-message` does not
apply): open `/burnticker/operator/sign-statement` on the operator's own network, enter the ops PIN (the claim page's gate, `GET
/api/burnticker/v1/ops/statement-text`), pick the day, connect the fee wallet and press "Sign with this wallet". The page shows the same
text `--print-text` prints (both build it with `src/lib/burnticker/trustpack/statement.ts`), refuses any wallet but the signer, signs the
raw text with Phantom's signMessage, checks the signature in the browser and shows it with the two commands to run from the repository
(`--signature <it> --write`, then the well-known regeneration). The page sends nothing anywhere and keeps nothing. Once the statement is
signed, its day stands where `{DATE}` was; the page and the script rebuild the template by putting that day back, so signing again for
a new day needs no hand edit.

`solana-keygen pubkey 'usb://ledger?key=0'` shows which index is the fee wallet. A wrong key or a signature over other text is refused
and nothing is written. After the ship, GET /api/burnticker/v1/operator verifies it with ed25519 and the operator page shows ✓ (or ✗ with
the reason). Anyone can check it without trusting this site's code: `node scripts/burnticker-verify-statement.mjs https://burnticker.com`
(the trust page lists the command). Then item 5 in `docs/burnticker/TODO-OWNER.md` moves to "Already resolved".

## Release directories

Since 2026-10-19 (audit L-5) every deploy is a release directory of its own, and the path every unit names is a link:

```
~mct/burnticker/releases/<utc stamp>-<build id>/   one complete tree per deploy: source, node_modules, .next
~mct/burnticker/releases/legacy-<stamp>/           the in-place tree from before the migration, kept as a rollback target
~mct/burnticker/shared/                            data/, logs/ and the .env files; every release links to them
~mct/meme-coin-trader  ->  releases/<current>      the link (units, logs and the database path are unchanged)
```

`scripts/ops/deploy-burnticker-host.sh` copies the source and the build into a new release, hard-links node_modules from the serving
release (npm ci runs there only when package-lock.json changed), and then `swap-web-build.sh` switches the link in one rename, restarts
the web unit and smokes it. A failed smoke switches the link back, so the previous source, node_modules and build serve again together.
The running keepers keep the tree they started in until their requested restart between cycles. The five newest releases are kept,
plus the previous one; older ones are pruned at the end of each deploy. The web stops within about 11 s on SIGTERM
(`scripts/service/web-graceful.cjs`; the unit's stop timeout is 15 s), so the fallback page shows for seconds, not 95.

**The one-time migration (the owner, once).** A host that still has one in-place tree refuses the release deploy. Pick a quiet minute
(no keeper crank in flight; `tail logs/burnticker-keeper.log`) and run the normal ship with the flag:

```sh
BURNTICKER_SRC=../burnticker-public sh scripts/ops/deploy-burnticker-host.sh --webpack --migrate-releases
```

It moves data/, logs/ and the env files to shared/ (each move is followed at once by a link in the old place), renames the old directory
to releases/legacy-<stamp> (running processes keep it; a rename keeps the inode) and points the link at it, then ships the first release.
Check afterwards: `readlink ~mct/meme-coin-trader`, `ls -l ~mct/burnticker/shared`, and that the keeper log keeps growing.
`sh release-host.sh list` (the deploy sends the script to /tmp; a copy is in scripts/ops/) shows every release and its build.

**Rollback by link.** `sh scripts/ops/rollback-burnticker.sh --previous-release` switches the link back to the release that served
before the last deploy, with the same smoke and automatic switch back; nothing is built or copied, so it takes about as long as one web
restart. Run it again to roll forward. A rollback to an older public commit (`rollback-burnticker.sh <commit>`) ships that commit as a
new release the normal way. Neither touches the chain, the database or the keepers' running code.

## Admit only Cloudflare at the origin

The audit of 2026-10-19 (I-6) reached the app on the box's public IPv4 directly (`curl --resolve burnticker.com:443:<public IPv4>
https://burnticker.com/burnticker` answered 200 with the app's headers). Every rate limit lives in the Node process, and Caddy has none, so
a direct caller skips Cloudflare's protection. Two ways to close it; the first is enough, the second is stronger. Nothing here was applied
by the code; the owner applies it on the box as root.

**1. ufw: admit only Cloudflare's ranges to 80 and 443.**

1. Print the rules (on the box, from the release link, or on the Mac; it only prints):
   `sh scripts/ops/cloudflare-ufw-rules.sh > ~/cf-ufw.txt && cat ~/cf-ufw.txt`.
   It fetches https://www.cloudflare.com/ips-v4 and https://www.cloudflare.com/ips-v6, refuses a list with any line that is not a range,
   and warns when the list differs from `CLOUDFLARE_RANGES` in `src/lib/burnticker/api/clientIp.ts` (update that list and
   `deploy/caddy/cloudflare.proposed.caddy` together if it does).
2. Check that SSH and the tailnet stay as they are before changing anything: `ufw status numbered` must show `22/tcp` allowed from
   the tailnet's address range and the rule for the tailnet's network interface (provision step 5 added both). The printed rules never
   touch either, and never touch the defaults. Keep an SSH session over the tailnet open while you apply, and the provider's web
   console at hand as break-glass.
3. Apply the printed lines in order: every Cloudflare `allow` first, then `ufw delete allow 80/tcp` and `ufw delete allow 443/tcp`.
   `sh ~/cf-ufw.txt` runs them as printed. If the provider's cloud firewall is attached, restrict 80 and 443 there the same way.
4. Caddy check: `caddy validate --config /etc/caddy/Caddyfile` and `systemctl status caddy` stay clean (nothing in Caddy changes).
   Certificates: with the records proxied, Let's Encrypt's HTTP-01 check reaches the box through Cloudflare, so renewal keeps working;
   the TLS-ALPN check cannot (it needs a direct connection). If `journalctl -u caddy` ever shows a failed renewal, switch Caddy to a
   Cloudflare Origin CA certificate or the DNS challenge rather than reopening the port.
5. Verify from outside the tailnet (a phone hotspot or another host):
   `curl -m 10 -sS -o /dev/null -w '%{http_code}\n' --resolve burnticker.com:443:<public IPv4> https://burnticker.com/burnticker`
   must time out or be refused, and `curl -sI https://burnticker.com/burnticker | grep -i cf-ray` must still show a cf-ray header.
   Do the same for IPv6 if the box has a public IPv6 address.
6. Refresh: Cloudflare changes its ranges rarely and announces it. Re-run the script monthly with the drills; a WARNING or a new range
   means adding the new `allow` lines (and removing a withdrawn one with `ufw delete allow proto tcp from <range> to any port 80,443`).
   Undo everything: `sh scripts/ops/cloudflare-ufw-rules.sh --remove-only` prints the deletions; add `ufw allow 80/tcp` and
   `ufw allow 443/tcp` first if the origin should be open again.

**2. The alternative: authenticated origin pulls (mutual TLS).** Cloudflare presents a client certificate on every connection to the
origin, and Caddy refuses any TLS connection without it, so a direct caller fails even when the port is open. In Cloudflare: SSL/TLS,
Origin Server, turn on Authenticated Origin Pulls (zone level uses Cloudflare's shared certificate; a per-hostname certificate of your own
is stronger, because the shared one is presented for every Cloudflare customer). On the box, save Cloudflare's origin-pull CA certificate
(published in Cloudflare's documentation for Authenticated Origin Pulls) as `/etc/caddy/cloudflare-origin-pull-ca.crt` and add to each
site block that Cloudflare proxies:

```
tls {
	client_auth {
		mode require_and_verify
		trust_pool file /etc/caddy/cloudflare-origin-pull-ca.crt
	}
}
```

Then `caddy validate --config /etc/caddy/Caddyfile && systemctl reload caddy`, and check with step 5 above (the direct request must now
fail the TLS handshake). Turn the Cloudflare setting on before reloading Caddy, or every visitor is refused. Certificate renewal over
HTTP-01 on port 80 is unaffected (client_auth applies to TLS only). The two layers combine well: ufw keeps strangers off the port, and
origin pulls keep a Cloudflare customer who points their own zone at this address from reaching the app.

## External web check

The keeper's heartbeat (above, "Heartbeat") says the keeper runs. It says nothing about the site: a hung web process, a dead Caddy, a
broken origin certificate or a Cloudflare misroute were caught by nobody (audit 2026-10-19 I-11 / B-4). Monitoring stays on
Healthchecks.io (owner decision 2026-10-19), which cannot poll a URL, so the box probes itself through the public path and pings.

What runs: `mct-burnticker-web-probe.timer` fires `mct-burnticker-web-probe.service` every 5 minutes, which runs
`scripts/service/burnticker-web-probe.sh`. It makes one GET of `https://burnticker.com/api/burnticker/v1/current-status` (the host is
`BURNTICKER_WEB_PROBE_HOST`, default `burnticker.com`), so the request goes DNS, Cloudflare, the origin, Caddy, Next. A 20-second limit,
no retry. Good means HTTP 200 and a JSON body whose `schema` is `burnticker.current-status/v1`; then it GETs the check's ping URL.
Anything else (another status, a timeout, a TLS or DNS failure, a body that is not that JSON) POSTs `<ping URL>/fail` with a short body
such as `code=503 HTTP 503`. Each run appends one line to `logs/burnticker-web-probe.log` and writes `data/web-probe-last.json`; the
keeper reads that file, and ops.json prints `- external web check: configured, last ok <time>` (or FAILING with the code, or not
configured). The ping URL carries the check's token: it is never logged, written or published. Until the URL is set the probe makes no
request and logs `skipped` once a day. `sh scripts/service/burnticker-web-probe.sh --check` prints what a run would do and the last
outcome, and sends nothing.

Owner setup (once):

1. In Healthchecks.io, create a check named **Burnticker web**: period 10 minutes, grace 10 minutes (two missed 5-minute runs before it
   counts as late). Attach email and the existing push integration (the same one the keeper heartbeat's check uses).
2. Copy its ping URL and put it on its own line of the shared env file on the box: `BURNTICKER_WEB_HEARTBEAT_URL=<the ping URL>` in
   `.env.local` (shared/ under release directories). The probe reads only that one line of the file.
3. Reinstall the units as mct: `sh scripts/ops/install-burnticker-units.sh` (each deploy does this too). It copies both units and enables
   and starts the timer; `systemctl --user list-timers mct-burnticker-web-probe.timer` shows the next run.
4. Verify: within 10 minutes the check turns green in Healthchecks, `tail -n 3 logs/burnticker-web-probe.log` shows `ok: HTTP 200`,
   and the next ops.json says `external web check: configured, last ok ...`. To see a red once on purpose, pause the check's
   integrations, run `systemctl --user stop mct-burnticker-web` for one probe, then start it again.

What a red check means: either the probe reached the site and the answer was wrong (a `/fail` ping; the Healthchecks event body has
the code), or the pings stopped (the box, its network or the timer is down; the keeper heartbeat's check usually goes red with it). The
first three things to look at:

1. `tail -n 20 logs/burnticker-web-probe.log`: the code and reason of each run. `code=000 timed out` or `could not connect` is the
   network, Cloudflare or Caddy; `HTTP 502`/`504` is Caddy up with Next down or hung; `HTTP 5xx` from Cloudflare with a cf-ray and no
   origin answer is the origin; `HTTP 200 but ...` is a wrong page in front of the app (a Cloudflare challenge or a stale build).
2. The web process: `systemctl --user status mct-burnticker-web`, `tail -n 50 logs/burnticker-web.log`, and from the box
   `curl -sS -m 10 -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/api/burnticker/v1/current-status` (the port the web unit
   listens on). Good here and bad through the public name means Caddy or Cloudflare. Hung: `systemctl --user restart mct-burnticker-web`.
3. Caddy and the edge: as root `systemctl status caddy` and `journalctl -u caddy -n 50`, then `curl -sI https://burnticker.com/burnticker`
   from off the box (a cf-ray header and the status) and the Cloudflare dashboard's status for the zone. No pings at all (not `/fail`):
   `systemctl --user list-timers 'mct-burnticker-*'` and whether the box is up.
