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
  commands in deploy.md "The host runs the public tree". The ship restarts only the web unit: restart the keepers as above.

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
# fund the new address (≥ 0.1 SOL); sweep the old one to the dev fee wallet once its last crank is confirmed; log it in docs/burnticker/incidents.md
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
| `bt-audit-mismatch` | audit.json: a receipt does not recompute | THE PUBLIC ALARM — the index badge is red. `R scripts/burnticker-audit.mts --json` lists the checks per receipt. A mismatch is either a code change in the recompute (revert it) or a tampered/duplicated row (the triggers make that hard; compare with the latest `.backup`). Publish the finding in `docs/burnticker/incidents.md` the same day. |
| `bt-audit-stale` | the hourly audit has not run for 3 h | `systemctl --user list-timers mct-burnticker-audit.timer`; `systemctl --user start mct-burnticker-audit.service` and read `logs/burnticker-audit.log`. |
| `bt-keeper-balance-low` | keeper key < 0.05 SOL | Send 0.1–0.2 SOL to `BURNTICKER_KEEPER_PUBKEY` (crank fees only; it is never the treasury). |
| `bt-cap-binding` | a burn pool holds more than the 25 SOL pre-audit cap | Expected while the cap stands; the excess is queued and shown on the token page. It lifts with the audit decision (fees.ts `PRE_AUDIT_POOL_CAP_SOL`, a reviewed change + a register entry). |
| `bt-keeper-stale` | no cycle for 10 min, not paused | `systemctl --user status mct-burnticker-keeper`; `journalctl --user -u mct-burnticker-keeper -n 50`; restart. |
| `bt-daily-summary` | the one line a day | Read it. "pools X SOL" rising with no burns = check the feed; "dev fees unknown" = `BURNTICKER_RPC_URL`/`BURNTICKER_FEE_WALLET` unset. |
| webhook FAILING (ops.json / morning block) | alerts stay on this host | `curl -s -o /dev/null -w '%{http_code}' -X POST -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"kind":"bt-test","key":"bt-test:'$(date +%s)'","text":"webhook test"}' "$BURNTICKER_ALERT_WEBHOOK"` → 200 expected; 403 = the Host is not trusted (use the tailnet address), 503 = `MCT_ALERT_INTAKE_TOKEN` unset on the trading VPS, 401 = token mismatch. |

Every alert that changed anything gets a line in `docs/burnticker/incidents.md` (append-only, rendered on the trust page).

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
| 2 | MAINNET REHEARSAL COIN: a disclosed throwaway ($REHEARSAL, ~0.1 SOL, LP burned, listed on the trust page as a rehearsal) created under the REAL platform config 1–2 days before | its launch JSON saved (`/tmp/rehearsal.json`: `mint, poolId, creatorFeeVault, platformId`), a `confirmed` burn in `data/burnticker-site/t/REHEARSAL/receipts.json`, `audit.json` `ok: true`, and the rehearsal line in `docs/burnticker/incidents.md` |
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
| P3 | upgrade authority = the Squads vault; every upgrade proposed with `scripts/squads-program-upgrade.mts --expect-file <verifiable .so> --expect-sha256 <hash>` (it refuses a buffer whose code, authority, program authority or spill address is wrong and prints all four for the voters); the authority is finalised (none) before the first public pair — blind review 1 M-2 | `solana program show 2jQo…ELkN` → `Authority: <VAULT>`; the proposal JSON's `checks` block |
| P4 | devnet rehearsal green: a pair graduated to two CPMM pools with LP burned and both registered, one burn per side; a pair voided and sold back to the vault's rent minimum | `docs/burnkeeper/devnet-paircurve-run-log-2026-10-10.md` checkpoints PC1–PC7; `node scripts/ops/verify-evidence-signatures.mjs` PASSED |
| P5 | blind review of `pair_curve` + `register_pair_pool` completed, findings closed or accepted in writing — two reviews done 2026-10-10 (`docs/burnticker/reviews/2026-10-10-pair-curve-blind-{1,2}.md`), all findings fixed or accepted in `docs/burn-receipts/CHANGELOG.md` (late evening) and re-rehearsed on devnet; a re-review of the fixed program (`fa8627a4`) is still owed | `docs/burnticker/reviews/`; `cargo test -p pair_curve --test review_pc1 --test review_pc2` green |
| P6 | the platform's `platformClaimFeeWallet` is the developer wallet and holds ≥ the rent minimum (trades accrue the 25 bps in the pair's vault either way; `claim_developer_fee` and `close_pair` wait until the wallet can receive) | `burnkeeper-launch.mts platform` dry run shows the wallet; `solana balance <wallet>` |
| P7 | the pinned AmmConfig's create-pool fee is what the launch parameters assumed (init_pair refuses a target whose minimum side cannot pay for its pool) | `scripts/paircurve-admin.mts init-pair` dry run prints `createPoolFee` and `sideCosts` |
| P8 | the keeper runs in program mode with the flag on and its crank works on a test pair (graduate/void) | keeper log line `pair curve: N pair(s) scanned, M cranked` |

Turning the flag on changes only how NEW pairs launch; existing LaunchLab pairs keep the rules-level void clause.

## Launch day — $DEFICIT, in order

Preconditions: every gate above ticked; weekday morning 08–09 Denver (Treasury posts ~14:00 Denver); the Burnticker host fully provisioned
(`deploy.md` §First run), both keepers installed and **stopped**, DNS live, `config/own-tokens.json` ready to take the mint. Commands are the
exact ones from `docs/burnkeeper/devnet-run.md` (mainnet section) and `docs/burnkeeper/fees.md`; every send needs `BURNKEEPER_MAINNET=1`
and `--i-understand-this-spends-real-sol`. Keys and the launch wallet are the owner's hands, on the owner's machine; this host only runs
the keepers afterwards.

1. **Platform config** (once per admin key; the fee dials 25 bps dev / 50 bps burn pool / LP 100% burned):
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
9. **After graduation:** anyone registers the migrated CPMM pool —
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
