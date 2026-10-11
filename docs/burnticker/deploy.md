# Burnticker — deployment: ONE DEDICATED VPS behind Caddy (the owner, 2026-10-09)

Burnticker and the $DEFICIT keeper run on **their own small cloud VPS** (2 vCPU / 4 GB class, Ubuntu, Tailscale name `mct-burnticker`), **not**
on the trading VPS. The trading VPS stays Tailscale-only and never serves the public web; the Burnticker host serves burnticker.com and the
$DEFICIT host and holds no trading anything. Everything below is prepared in the repo and run by the operator — nothing here touches a
remote host by itself.

## The rule for this host (mirrors the research-box rule)

**Never on the Burnticker VPS:** a trading arm, collector, panel or funding unit (`mct-x*`, `mct-*collector`, `mct-panel*`, `mct-xwallet`,
`mct-server`); the trading app's local env file or any line from it; any of the trading app's signer files (every chain)
or their passphrases; the trading app's on/off switches; a copy of its trade database. **The only secrets on it:** the two keeper keys (`signer-burnkeeper.enc.json`
for $DEFICIT, `signer-burnticker.enc.json` for the platform keeper) and their passphrase, `BURNTICKER_RPC_URL` / `BURNKEEPER_RPC_URL`, the alert
webhook token, and — optionally, for the zkTLS second signer — Reclaim credentials (`RECLAIM_APP_ID` / `RECLAIM_APP_SECRET`). A key that
can only crank burns is the whole blast radius of this box. `scripts/ops/install-burnticker-units.sh` installs only the Burnticker set and
`deploy/install-vps.sh` must never be run there.

## What runs where

| Piece | Host | Unit | Writes / serves |
|---|---|---|---|
| Caddy | Burnticker | system `caddy` | `deploy/caddy/Caddyfile`: static `/var/www/burnticker` at `/`, `/var/www/deficit` at `/deficit/` and at the $DEFICIT host's root, proxies ONLY `/burnticker`, `/burnticker/*`, `/api/burnticker/*`, `/_next/*` to the app; the status page at `status.burnticker.com` and `/status/`; the static fallback (`/var/www/burnticker/fallback/`, 503) when the app is down or answers a page with 5xx (trust ops, 2026-10-10 night; docs/burnticker/LOADTEST.md) |
| Next app | Burnticker | `mct-burnticker-web` (`run-burnticker-web.sh`, `127.0.0.1:3000`, production) | the PUBLIC tree's app (below): the wizard, in-app token, rivalry, docs and trust pages, `/api/burnticker/*`; reads `data/burnticker.db` (the launch route writes drafts) |
| `scripts/burnticker-keeper.mts` | Burnticker | `mct-burnticker-keeper` (loop) | reads selectors, plans and cranks receipts, publishes `data/burnticker-site` every cycle, writes `data/own-tokens.generated.json`, runs the ops alert check every 5 min and publishes `ops.json` |
| `scripts/burn-keeper.mts` | Burnticker | `mct-burnkeeper` (loop) | the $DEFICIT keeper; publishes `data/burnkeeper-site` |
| `scripts/burnticker-audit.mts` | Burnticker | `mct-burnticker-audit.timer` → `.service`, hourly | recomputes every receipt; writes `audit.json`; exits 1 on a mismatch (unit failed + `bt-audit-mismatch`) |
| `scripts/ops/deploy-sites.sh --publish-only` | Burnticker | `mct-burnticker-publish.timer` → `.service`, every minute | syncs both publish dirs into `/var/www/*` (the brand pages ship by hand with the same script) |
| alert intake | trading VPS | the existing `mct-server` | its alert-intake route (new; private app, not in this repo) → the operator's alert table + Telegram, over Tailscale |
| morning check | Mac / trading VPS | the existing check-in | `## Burnticker` block reads `BURNTICKER_OPS_URL` (= `https://burnticker.com/ops.json`) when no local registry exists |

The trading VPS's `mct-server` is **not** proxied anywhere: the Burnticker host runs its own app (`mct-burnticker-web`), bound to loopback,
built from the public tree — which has no trading routes, components or keys in it at all (see "The host runs the public tree").

## Environment (names only — no value is ever committed or printed)

the local env file in `~/meme-coin-trader` (user `mct`) on the Burnticker host, read by the run scripts (never by the units):

| Variable | Meaning |
|---|---|
| `BURNTICKER_DB` | sqlite registry, `data/burnticker.db` (the units set it) |
| `BURNTICKER_PUBLISH_DIR` / `BURNKEEPER_PUBLISH_DIR` | `data/burnticker-site` / `data/burnkeeper-site` (the units set them; the publish timer syncs them to `/var/www`) |
| `BURNTICKER_CLUSTER` | `devnet` (default) or `mainnet` |
| `BURNTICKER_KEEPER_PUBKEY` | the platform keeper's data key, PUBLIC KEY (`signer-burnticker.enc.json.address`); its SOL balance is watched (< 0.05 alerts) |
| `BURNTICKER_SIGNER_PATH` | the platform keeper's encrypted key (`ProgramBurnClient`, when `BURNTICKER_PROGRAM_ID` + `BURNTICKER_RPC_URL` are set); `~/.config/meme-coin-trader/signer-burnticker.enc.json` |
| `BURNKEEPER_SIGNER_PATH`, `BURNKEEPER_SIGNER_PASSPHRASE` | the $DEFICIT keeper's key and the passphrase both keygens used. **The passphrase lives only here, in this host env file** (mode 600, typed in by the owner; Linux has no Keychain) — never in the repo, never in a unit file, never on a command line; `deploy-burnticker-host.sh` excludes `.env*` |
| `BURNKEEPER_EXECUTION` (`program`), `BURNTICKER_PROGRAM_ID`, `BURNKEEPER_RPC_URL`, `BURNKEEPER_MINT`, `BURNKEEPER_MAINNET`, `BURNKEEPER_RULES_SHA`, `BURNKEEPER_CREATOR_FEE_SOURCE`, `BURNKEEPER_SEED_TX`, `BURNKEEPER_SEED_SOL` | the $DEFICIT keeper (`scripts/service/run-burnkeeper.sh` documents each). **Not** `BURNKEEPER_CLAIM_CREATOR_FEES`: a legacy-execution flag only (program execution claims by itself, and the legacy leg refuses it for a fee-PDA token) |
| `BURNTICKER_FEE_WALLET` | the developer wallet, PUBLIC KEY (platform claim-fee wallet); its balance feeds the daily summary and the morning delta |
| `BURNTICKER_PLATFORM_ADMIN`, `BURNTICKER_PLATFORM_ID` | the LaunchLab platform admin pubkey; the PlatformConfig PDA once created |
| `BURNTICKER_PROGRAM_ID` / `BURNTICKER_PROGRAM_HASH` / `BURNTICKER_UPGRADE_AUTHORITY` | the Receipts program, once deployed |
| `BURNTICKER_RPC_URL`, `NEXT_PUBLIC_BURNTICKER_RPC_URL` | an RPC for balance reads, the trust page's live reads and the on-chain source kind; the wizard's public endpoint. REQUIRED to take a draft live: a launch confirmation is read from the chain first (review N1); without it every confirmation answers 503 |
| `BURNTICKER_ALERT_WEBHOOK`, `BURNTICKER_ALERT_WEBHOOK_TOKEN` | where ops alerts are POSTed (the trading VPS's alert-intake route over Tailscale: `http://<trading-host-tailnet-ip>:3001/<intake path>`) and its bearer token |
| `OWN_TOKENS_GENERATED_PATH` | optional override of `data/own-tokens.generated.json` |
| `BURNTICKER_KEEPER_ROLE` | `leader` (default) or `standby` — keeper redundancy (runbook "Keeper redundancy"; `src/lib/burnticker/ops/leaderLock.ts`) |
| `BURNTICKER_LEADER_STATUS_URL` / `BURNTICKER_PEER_STATUS_URL` | on a standby: the leader's public `status.json` (its heartbeat); on the leader (and its web app, for the trust page): the standby's. https only (or a loopback / tailnet address) |
| `BURNTICKER_TAKEOVER_MISSED`, `BURNTICKER_HEARTBEAT_STALE_SEC` | a standby's takeover after N missed heartbeats (default 5) of a leader whose last cycle is older than S seconds (default 180) |
| `BURNTICKER_STATUS_URL` | optional: where the trust page links the status page (default `/status/`) |

On the **trading host's** environment file: `MCT_ALERT_INTAKE_TOKEN` (16+ characters, the same string as the webhook token) opens the intake route;
`TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` stay there (the Burnticker host does not get them: one Telegram sender, one place to look). On
the **Mac / wherever the check-in runs**: `BURNTICKER_OPS_URL=https://burnticker.com/ops.json`.

Keys: both keeper keys are made **on this host** by `scripts/burnkeeper-keygen.mjs --new` (AES-256-GCM + scrypt, mode 600, under
`~/.config/meme-coin-trader`, outside the repo), by the provision script's step 9 or by hand; the key files are never in the repo or in an
env file. Their one passphrase lives **only in the host env file** `~/meme-coin-trader/.env.local` as `BURNKEEPER_SIGNER_PASSPHRASE`
(mode 600; the platform keeper falls back to it when `BURNTICKER_SIGNER_PASSPHRASE` is unset) — never in the repo. Nothing in
`src/lib/burnticker` reads a secret.

## Alerts — how they reach the owner

The operator's one alert channel (in the private trading app): a row in its alert table + one Telegram message per key per day,
listed by the wallet page and the check-in. That table lives in the trading VPS's book, so on the Burnticker host the keeper's sink
(`sinkFromEnv` + `registryAlertSink`) records each alert in the registry's append-only `alerts` table (one per key per Denver day) and
then POSTs each **new** one to `BURNTICKER_ALERT_WEBHOOK`; the trading app's intake route records it in that channel (trusted Host +
bearer token; only `bt-` kinds; bounded sizes; that route is private-app code, outside this repository). Result: a Burnticker alarm shows up exactly where an
arm's does. If the webhook fails, the alert stays on the Burnticker host (its log says so, `ops.json` carries `webhook.lastError`, the
morning block prints "alert webhook: FAILING") — the fallback for the phone is the public `https://burnticker.com/ops.json` (the same block
the check-in prints; nothing secret in it), and the iCloud/phone status page on the trading side will show the intake's rows only. Any other
HTTPS endpoint that takes the JSON (ntfy, a worker) works as the webhook too.

## First run on the Burnticker host (the order)

```sh
# On the Mac: the code as a tarball, and the provision script beside it
git archive -o /tmp/mct.tar.gz HEAD && scp /tmp/mct.tar.gz scripts/ops/provision-burnticker-host.sh root@<public ip>:   # into root's home
# On the box, as root — idempotent; --check first
sh ~/provision-burnticker-host.sh --check
sh ~/provision-burnticker-host.sh --archive ~/mct.tar.gz              # user mct + linger, node, caddy, tailscale, unattended-upgrades, repo, units, KEYS (asks one passphrase)
tailscale up                                                           # join the owner's tailnet, then rerun the script: it enables ufw only once the tailnet is up
sh ~/provision-burnticker-host.sh                                      # ufw: 22 from the tailnet only, 80/443 public; remove any public 22 rule it reports
# As mct: the local env file (names above), then from the Mac ship the first build
sh scripts/ops/publish-public-repo.sh --verify --link-node-modules    # Mac: cut the public tree into ../burnticker-public (see below)
BURNTICKER_SRC=../burnticker-public sh scripts/ops/deploy-burnticker-host.sh --webpack   # Mac: build → mirror → swap → restart mct-burnticker-web
# On the box as mct
systemctl --user start mct-burnticker-keeper mct-burnkeeper            # the web unit was restarted by the ship; the timers were enabled by the install
sh scripts/ops/deploy-sites.sh --check && sh scripts/ops/deploy-sites.sh   # brand pages + the first publish into /var/www
curl -sI https://burnticker.com/ | head -5 && curl -s https://burnticker.com/ops.json | head -20
```

`data/PAUSE-burnticker` holds cranks (reading, publishing and alerts go on). The registry is append-only (SQL triggers); back it up with
`sqlite3 data/burnticker.db ".backup data/burnticker.backup.db"`, never by copying the live WAL files (runbook §backup).

## Caddy

`/etc/caddy/Caddyfile` is `deploy/caddy/Caddyfile` (the provision script installs it; later changes: copy, `caddy validate --config
/etc/caddy/Caddyfile`, `systemctl reload caddy`). Hostnames and the upstream are `{$VAR:default}` placeholders at the top of the file; set
them with `systemctl edit caddy` → `[Service]` `Environment=BURNTICKER_DOMAIN=burnticker.com` `Environment=DEFICIT_DOMAIN=<the $DEFICIT host>`
or edit the defaults. Security headers (nosniff, DENY framing, referrer policy, HSTS, permissions policy, `-Server`) apply everywhere; static
responses carry `Cache-Control: no-store` so a stale receipts page is never cached. **No access log is configured** (Caddy's default): client
IPs are not recorded; enabling `log` would record `remote_ip`. **The proxy matcher and the pass-through Host header are security
controls** (see the file's header): never widen `@app`, never rewrite `Host`.

`/var/www/burnticker` and `/var/www/deficit` are owned by `mct` (provision step 3) so the publish timer can write them; Caddy (user `caddy`)
reads them (755/644).

## DNS at Cloudflare + the firewall (owner steps)

The site must answer on the **Burnticker VPS's public IPv4** (the provider's console → the new server → public network). The trading VPS's
address is never used: its web listens on the Tailscale address only and its firewall admits nothing public — that does not change.

1. Cloudflare → the `burnticker.com` zone → DNS → Records:
   - `A  @    <Burnticker VPS public IPv4>`  — **DNS only (grey cloud) for the first hour**
   - `A  www  <Burnticker VPS public IPv4>`  — same
   - the $DEFICIT host: `A  deficit  <same IPv4>` (or whatever name the owner picks; set `DEFICIT_DOMAIN` to match), same
   - the public status page: `A  status  <same IPv4>` (set `BURNTICKER_STATUS_DOMAIN` if the name differs), same
   - (if the box has IPv6 and Caddy should answer on it: matching `AAAA` records)
2. Firewall on the box (provision step 5): `ufw` default deny; `80/tcp` and `443/tcp` from anywhere; `22/tcp` only from the tailnet's CGNAT range (`ufw allow from <tailnet range>`, see the provision script)
   and `tailscale0`. If the provider's **cloud firewall** is attached to the server, add inbound TCP 80 and 443 there too (and remove public 22).
3. Wait for Caddy's certificate: `journalctl -u caddy -n 50 | grep -i certificate` (ACME HTTP-01 needs port 80 reachable **directly**, which
   is why the records start grey). `curl -sI https://burnticker.com/` must return 200 with the security headers.
4. Then, per record, switch to **Proxied (orange cloud)** and set the zone's SSL/TLS mode to **Full (strict)** (Caddy's certificate is a real
   one). Keep "Always Use HTTPS" on; Cloudflare's cache follows the origin's `no-store`. Behind the proxy Caddy sees Cloudflare's addresses as
   the client — fine, nothing logs them. Leave the orange cloud OFF for any record that should expose the origin (none today).
5. SSH to the box only over Tailscale (`ssh root@mct-burnticker`); break-glass is the provider's web console.

## The host runs the public tree (2026-10-10)

The owner, 2026-10-10: *"keep it with the Burnticker branding … make sure none of the meme coin trader stuff carries over."* Until this
date the host ran a copy of the whole monorepo, so `/burnticker/launch` rendered inside the trading app's root layout (its sidebar, ticker,
sync engines and tabs). Now the host runs **only the public carve-out** — the same tree the public repository is cut from:

- `scripts/ops/publish-public-repo.sh` writes it to `../burnticker-public` from `config/public-repo.allowlist` plus
  `config/public-repo/overlay/` (the Burnticker root layout, `globals.css`, `next.config.ts`, `tsconfig.json`, the brand PNGs under
  `public/burnticker/brand/`), runs the import check and the leak scan on every file, generates `package.json`, and prunes the monorepo's
  `package-lock.json` to it (so the host's `npm ci` installs exactly the versions the monorepo tests; `--no-lockfile` skips it).
- The root layout mounts `src/app/burnticker/_components/` (header: Launch · Coins · Rivalries · Trust · $DEFICIT · Docs/API, light/dark
  switch, phone menu; footer: the receipt slip with the memecoin disclaimer and `OPERATOR_LINE` from `src/lib/burnticker/fees.ts`) and
  nothing else. `/` redirects to `/burnticker` (Caddy serves the static landing page at `/` anyway). Brand assets are served under
  `/burnticker/brand/` because Caddy proxies only `/burnticker*`, `/api/burnticker/*` and `/_next/*` to the app.
- Everything the host's units run is in the tree: `deploy/systemd/mct-burnticker-*`, `mct-burnkeeper.service`, `scripts/load-env.sh`,
  `scripts/service/run-burnticker-web.sh` (the web unit's own `next start` entrypoint; the trading app's `run-server.sh` is not used here),
  `run-burnticker-keeper.sh`, `run-burnkeeper.sh`, `run-burnticker-audit.sh`, `scripts/ops/deploy-sites.sh`, `install-burnticker-units.sh`.

The exact commands, from the monorepo on the Mac (the worktree you ship from):

```sh
sh scripts/ops/publish-public-repo.sh --check                               # dry run: both gates; the last line must be CHECK PASSED
sh scripts/ops/publish-public-repo.sh --verify --link-node-modules          # write ../burnticker-public + package-lock.json; tsc + tests IN the tree
BURNTICKER_SRC=../burnticker-public sh scripts/ops/deploy-burnticker-host.sh --webpack
#   builds ../burnticker-public/.next-burnticker with webpack (Turbopack builds are killed on the Mac after ~2 min), MIRRORS the tree to the
#   host's repo directory (~mct/meme-coin-trader) with rsync --delete, swaps the build in, runs npm ci when the lockfile is newer than
#   node_modules, re-installs changed units and restarts mct-burnticker-web. Add --restart-keepers to bounce the keepers between cycles.
#   BURNTICKER_HOST=root@<host> and BURNTICKER_SSH="ssh -i <key>" when ~/.ssh/config has no entry for the box.
```

What the mirror never deletes or overwrites on the host: `.env.local` (any `.env*`), `data/`, `logs/`, `node_modules/`, `.next*`, and the
program's local build products (`programs/*/target`, `.anchor`, fixture `.so` files and checkouts). Everything else that is not in the public
tree is removed — that is the point. The ship refuses a source that still carries one of the trading app's private directories
(the script names them) or that has no `package-lock.json`. The first public ship over a monorepo copy leaves a root-only rollback tarball of
the old source in root's home directory on the host (`burnticker-pre-public-<stamp>.tgz`, mode 600); delete it once the public tree is settled.

Check after a ship (each line must hold):

```sh
for p in /burnticker /burnticker/launch /burnticker/trust /api/burnticker/v1/catalogue; do curl -s -o /dev/null -w "%{http_code} $p\n" "https://burnticker.com$p"; done   # all 200
curl -s https://burnticker.com/burnticker/launch | grep -ci "robinhood\|portfolio\|watchlist\|AutoTrade\|MarketTicker"                                                # 0
```

Without `BURNTICKER_SRC` the script still builds and copies the monorepo (no `--delete`) and says so — that ships the trading app's shell
again; do not.

## Shipping a change

The ship step is "The host runs the public tree" above: publish, then `BURNTICKER_SRC=../burnticker-public sh scripts/ops/deploy-burnticker-host.sh --webpack`
(Mac; builds, mirrors, swaps, restarts the web unit; `--no-build` for keeper-only changes,
`--restart-keepers` to bounce the two keepers between cycles). Units changed in `deploy/systemd/` are re-installed by the ship through
`install-burnticker-units.sh`. The keepers run from source and pick a change up on their next restart — restart them deliberately, between
cycles, never mid-crank (runbook §start/stop).

## Owner TODO — keys the launch and the sports settlement wait for (2026-10-10)

None of these are in the repository. Each one goes into the host's environment file:

- **`BURNTICKER_UPLOAD_PAYER`**: the ops wallet that pays Irys to pin each coin's metadata JSON and receipt-art PNG on Arweave
  (about $0.01–0.05 per coin). It is a base58 Solana secret key, used only for uploads, and it is never the keeper's signer. Fund it
  with a small balance and top it up. The Irys client (`@irys/upload`, `@irys/upload-solana`) is in `package.json`, so `npm ci` installs it.
  **Until this key is set, every launch is refused**, because a coin's metadata is never hosted on a server that could change it. The same
  payer pins the keeper's daily registry snapshot (`src/lib/burnticker/ops/snapshot.ts`); without it the snapshot job refuses and alerts.
  Devnet scripts may set `BURNTICKER_ALLOW_HOSTED_METADATA=1` instead.
- **`BURNTICKER_PIN_DAILY_CAP`** (optional, default 50): the most coins this host pins on Arweave per UTC day. Pins are paid before
  any wallet signs, so this caps the upload spend however requests arrive (ChatGPT/Codex review N4); past it a launch answers 429
  `upload-budget`. Both launch routes (`/api/burnticker/launch` and `/v1/launch/*`) also share one per-client write bucket (10/hour).
- **`BURNTICKER_THESPORTSDB_KEY`**: TheSportsDB under a commercial licence (the v2 API). It is primary B for every game that has no
  Polymarket moneyline market. Until it is set, such games are held and the coin is refused at creation. Pages that show its data
  carry the attribution "data: TheSportsDB" (the sources table and the trust page).
- **`BURNTICKER_APISPORTS_KEY`**: API-Sports, the second licensed provider. It is the cross-read for every league without an official
  feed of its own: WNBA, NFL, college, and all the soccer leagues. Until it is set, those leagues' cross-read is missing and their coins
  are refused. MLB, the NHL and the NBA are cross-read by their own official feeds and need no key.
