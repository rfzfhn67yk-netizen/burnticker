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
| `bt-keeper-balance-low` | keeper key < 0.05 SOL | Send 0.1–0.2 SOL to `BURNTICKER_KEEPER_PUBKEY` (crank fees only; it is never the treasury). |
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

Five states reach the owner's phone directly, so they are seen even when nobody opens the check-in. The rest stay in the registry, the
log and the morning block.

| Push title | Raised by | Do |
|---|---|---|
| Burnticker keeper refused to start | `bt-keeper-refused`: the keeper threw before its first cycle (mainnet without `BURNTICKER_MAINNET=1`, the treasury's key file named, a key that does not match `BURNTICKER_KEEPER_PUBKEY`, testnet). The push carries the reason. | Read the reason, fix the setting in the host's environment file, `systemctl --user restart mct-burnticker-keeper`, then `tail -n 30 logs/burnticker-keeper.log`. |
| Burnticker keeper is not publishing | `scripts/ops/keeper-status-check.sh` (the publish timer, every minute): `status/status.json` stale or missing for more than two hours. Repeats every two hours while it lasts; "Burnticker keeper is back" when it is fresh again. | `sh scripts/ops/probe-burnticker.sh --box` says which link of the status chain broke; then the `bt-keeper-stale` row above. |
| Burnticker reading held | `cosigner-disagree`: the second signer did not agree with the keeper's reading, so nothing was sent for that date | Read the source for that date by hand and both signers' logs. Nothing burns until they agree; a disagreement you settle by hand is an incident (INCIDENTS.md §7). |
| Burnticker upload failed | `bt-pin-failed` (a launch refused because its details could not be pinned on Arweave) or `bt-snapshot-failed` (the daily snapshot) | Check the upload payer's balance and `BURNTICKER_UPLOAD_PAYER`; the `bt-snapshot-failed` row above. |
| Burnticker burn run failing | `bt-crank-failed`: one receipt failed three times in a row | The `bt-crank-failed` row above. |
| Burnticker all quiet (or daily line) | once per Denver day after 08:00 | Nothing, when it says quiet. **A missing daily line means the keeper is not running its alert check**: treat it like the not-publishing push. |

How it works: the keeper reads the registry's `alerts` table on its five-minute alert check (`src/lib/burnticker/push.ts`
`runPushCheck`) and sends a plain-text POST to `BURNTICKER_PUSH_URL` with `Title` and `Priority` headers and
`Authorization: Bearer <BURNTICKER_PUSH_TOKEN>`. Rate limit: one push per kind per hour and six per hour in all; what is held back is
counted in the next push and in the daily line, and every alert stays in the registry. Its state is the registry status row
`push.state`. A failed send is logged as `[push] … not delivered` and never stops the keeper. Unset `BURNTICKER_PUSH_URL`: nothing is
sent, nothing else changes.

Owner setup (once): create a push topic or app on a phone push service that accepts a plain-text POST with a bearer token, then put
`BURNTICKER_PUSH_URL=<its https publish address>` and `BURNTICKER_PUSH_TOKEN=<its token>` in the host's environment file (the keeper and
the publish timer both read it), restart the keeper between cycles, and check the banner line says `+ phone push`. To test without
waiting for trouble, from `~/meme-coin-trader` as mct:

```sh
sqlite3 data/burnticker.db "UPDATE status SET value=json_set(value,'$.lastDaily',NULL) WHERE key='push.state'"   # the next check after 08:00 Denver sends the daily line
```

Every alert that changed anything gets a line in `docs/burnticker/incidents/LOG.md` (append-only, rendered on the trust page) — and, when it is an incident under [INCIDENTS.md](INCIDENTS.md), a public postmortem within 48 hours from [incidents/TEMPLATE.md](incidents/TEMPLATE.md).

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

## Back up data/burnticker.db

The registry is WAL-mode SQLite and append-only. **Never copy the live file or its `-wal`/`-shm`** (a torn copy, and a reader that looks
whole). Always the online backup API:

```sh
mkdir -p ~/backups && sqlite3 data/burnticker.db ".backup ~/backups/burnticker-$(date +%Y%m%d-%H%M).db" && sqlite3 ~/backups/burnticker-$(date +%Y%m%d-%H%M).db "PRAGMA quick_check"
sqlite3 data/burnkeeper.db ".backup ~/backups/burnkeeper-$(date +%Y%m%d-%H%M).db"       # the $DEFICIT ledger too
```

Schedule it (as mct): `crontab -e` → `17 */6 * * * cd $HOME/meme-coin-trader && sqlite3 data/burnticker.db ".backup $HOME/backups/burnticker-$(date +\%Y\%m\%d-\%H).db" && find $HOME/backups -name 'burnticker-*.db' -mtime +14 -delete`
(cron is fine here; nothing else on this box uses it). Copy a backup off the box over the tailnet from the Mac:
`rsync -aW mct-burnticker:backups/ ~/mct-backups/burnticker/` (whole files, never `-az` on SQLite). A backup is also what an auditor runs
`scripts/burnticker-audit.mts` against (`BURNTICKER_DB=<copy> BURNTICKER_PUBLISH_DIR=/tmp/x`). Restore = stop the keeper, move the live file
aside, `cp` the backup into place, start — and an incident entry, because the triggers' promise is "no history edits".

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
| 11 | Backups: sqlite `.backup` of `data/burnticker.db` (and `burnkeeper.db`) scheduled | `crontab -l` shows the §backup line; one file in `~/backups/` newer than 6 h with `PRAGMA quick_check` = ok |
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

`solana-keygen pubkey 'usb://ledger?key=0'` shows which index is the fee wallet. A wrong key or a signature over other text is refused
and nothing is written. After the ship, GET /api/burnticker/v1/operator verifies it with ed25519 and the operator page shows ✓ (or ✗ with
the reason). Anyone can check it without trusting this site's code: `node scripts/burnticker-verify-statement.mjs https://burnticker.com`
(the trust page lists the command). Then item 5 in `docs/burnticker/TODO-OWNER.md` moves to "Already resolved".
