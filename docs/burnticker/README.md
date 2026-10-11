# Burnticker — coins that burn on real-world results, with receipts

**Positioning (owner-approved 2026-10-10 night).** One sentence everywhere: **"Coins that burn on real-world results — with
receipts."** Sub-line: **"Launch one. Follow the season."** The receipt is the product; a season is a scoreboard of burns; nothing is
ever won — things are only burned, and scoreboards are per league and per season — when a season ends, the coin with the most receipts is its league's champion,
never a recipient of anything. Four surfaces
with plain names: **Coins** (the grid), **Launch** (the sentence box and the dials), **Seasons** (scoreboards: team coins and
rivalries, every number a receipt count or a burned share — today the rivalries page, `/burnticker/rivalries`) and **Trust**
(sources, the coverage table, reviews, the receipts audit). Two layers, shown by example: the engine (a launchpad with locked rules;
the rule is enforced by a program, not a promise) and the show (seasons and rivalries). Sports copy rotates across leagues and never
leads with the NFL. Copy rules: `config/launch/copy-lint.json`, including the `no-prizes` category (no prize, pot, payout, jackpot,
reward, stake, bet, wager or odds; nobody wins money, gets paid or earns). Voice: `docs/launch/x-burnticker-profile.md`.

**Go-to-market (10-10 night):** [`docs/launch/gtm/`](../launch/gtm/) — the plan of record (`PLAN.md`), pitches per audience,
the outreach list, the T-14 → T+7 calendar and the cold-read edit list. Posts come from `scripts/burnticker-posts.mts` (six fixed
formats, copy-lint refused) into `data/launch/post-queue.jsonl`, which the owner reads and posts by hand; nothing auto-posts.

**Settlement (owner decision, 10-10): settled on primary sources; prediction markets are discovery and optional cross-checks where
their terms permit.** Kalshi's Developer Agreement and Data Terms forbid using its API or data to settle products or to cache or
redistribute it, so Kalshi is NOT a settlement input (the earlier customer line "burns on a Kalshi settlement" is withdrawn). A coin
settles on a primary source with an independent cross-read of the same fact (another operator on another domain), or on Polymarket's
Conditional Tokens payout vector on Polygon for an adjudicated market. What that covers today, category by category, is the
[settlement coverage audit](#settlement-coverage-audit) and [SETTLEMENT-COVERAGE.md](SETTLEMENT-COVERAGE.md). $DEFICIT runs on
Treasury data directly, cross-read against FRED's quarterly copy of the same figure.

Built 2026-10-09 on top of the $DEFICIT burn keeper (`src/lib/burnKeeper/`). Spec: `mct-runner-study/launch-debt-egg-2026-10-09/LAUNCHPAD-PATH.md`
(§1 creator flow, §2 under the hood, §3 feeds, §4 rules, §5 economics, §6 token page, §7 refusals, §9 acceptance, §11 Kalshi). Owner
decisions of 10-09 are baked in and listed in §9 below. Everything here runs with no real funds, no keys, no mainnet sends.

## Rivalry pairs — two coins, one matchup (owner-approved 10-09 night; the headline since 10-10)

Two coins launched together on the SAME selector with inverted mappings — $BRONCOS burns when Denver loses and $CHIEFS when Denver
wins (one KXNFLGAME leg), $BULLS/$BEARS on the S&P close direction (scalar up vs down), two sides of a settled series. Each settlement
burns exactly one side; the receipts are the scoreboard.

- **Both or neither (owner, 10-10; every pair created since).** `pair.clause: "both-or-neither"`, `pair.voidBy` and
  `pair.fallback: { everyDays: 7, units: 1 }` are in both sides' canonical rules. Event burns apply only once BOTH coins have a registered
  pool: earlier settlements wait as `pending-pair` receipts and execute in settlement order the cycle the second pool registers
  (`multiKeeper.pairGates`). If either side is unregistered when the `voidBy` UTC date ends, the pair voids (`pair_outcomes`, append-only):
  pending receipts become `voided`, no event burns ever again, and the rule has ended: both pools wind down (below). `voidBy` defaults to
  a one-shot's first settlement date, else 30 days after launch. The pair page shows the state (`live` / `waiting-on:A|B` / `voided`), the
  void date and both curves side by side; the pair post adds "Pair live …" / "Pair voided — both pools wind down over four weeks …". A
  voided Burn Derby pair is a no-contest.
- **No burn pool is ever left behind (owner, 10-10).** Every new rule carries `onEnd: { windDownDays: 28, sweepThresholdLamports }` in
  its hash. When a rule ends for any reason (one-shot NO / void, pair voided, derby season over, bracket loser, an adapter's
  `markRuleEnded`), the keeper attests a daily `clock` reading of `windDownUnits(f, 28)` units (≥ 99 % of the pool in 28 days; proof =
  sha256("clock|date|rules sha")) until the pool is spent, then retires the coin; a one-shot may spend 100 % (the program allows 10,000
  bps) and DRAINS across daily cranks under the 2 %-of-reserve cap; a retired coin's later fee income is swept above the threshold, at
  most weekly. Outcome sets (`set: { id, outcome, forwardBps }`, opt-in) are in the schema; their `forward_to_winner` instruction and a
  permissionless `sweep_retired` are queued (PROGRAM-UPGRADE-QUEUE.md). Design: DERBY.md §6a.

- Rule: `pair: { pairId, side: "A"|"B", counterpartMint }` is part of each side's canonical JSON, so the link is locked; the two rules
  are hashed independently. `invertMapping(ruleA, mintA, pairId)` derives side B (binary: swap onYes/onNo — a side burns on exactly
  one outcome; scalar: flip up↔down; `abs` cannot pair). v1 pairs must use a tier-1 adjudicated market source (kalshi); the refuse list
  and the tier rules apply per side.
- `buildPairBundles({ a: LaunchInput, b: { ticker, name, description, imageUrl, links }, pairId? }, deps)` (exported from
  `src/lib/burnticker/launchBundle.ts`, the seam the SDK and `/api/burnticker/v1` can call) returns `{ pairId, a, b, selector, notes }`:
  two bundles signed in sequence — A first (its fresh mint), then B whose rule names A's mint as counterpart. A's counterpart lives in
  the registry's `pairs` table (A exists before B's mint). The LaunchLab creator of each side is the burn program's fee PDA for that
  mint (`burnPoolFor`, review finding H-2), never a key; the keeper only pays gas. **Program seam:** if `burn_receipts`' TokenConfig carries no counterpart
  field, nothing else is needed — the link is in both rules.json files and the pairs table.
- Registry: `pairs (pair_id, mint_a, mint_b, selector_key, created_at)`, append-only; `registerPair` checks both rules carry the
  pairId/side/counterpart and share the selector key.
- Pages: each side's page opens with a "versus" header (burns A : B, burned, supply, the other side's last burn, link to the pair
  page). The pair page — `/burnticker/p/<pairId>` in the app (`/api/burnticker/pairs/<pairId>`) and `p/<pairId>/index.html` +
  `pair.json` in the static site (`renderPairHtml` / `publishPairSite`, written by `publishPlatformIndex` for every pair) — is the
  scoreboard: burns A : B, supply A : B (and % of the start left), the last settlement with its market ticker and result and the side
  it burned, the next scheduled market with each side's Kalshi-implied chance (display only), the share line, both receipts tables
  stacked, both rules with their hashes. `pairTally()` builds it from both sides' status.json + receipts.json. The platform index
  lists a pair as one card. `GET /api/burnticker/tokens/<ticker>` carries `status.pair`. The keeper fills `pair` on every token page
  through `pairCounterpartFrom()` (registry + supply reader), so the static versus headers, index cards and pair pages appear.
- Share line / pair post: `pairDailyText(tally, site)` in `src/lib/launch/dailyPost.ts` — "$A 3 : 1 $B — every loss burns", supply both
  sides, the last settlement (market, result, side), the next market (no odds in the post), the scoreboard link, the pair disclaimer.
  Lint-clean under config/launch/copy-lint.json (tested). The 5-post announcement thread is docs/launch/x-threads.md §2b.
- Wizard (`/burnticker/launch`, rebuilt 10-10 after the owner: "I am still having a hard time setting up an nfl team coin"): the first
  screen is four plain choices, no jargon — **Team coin** (league → team picker → one toggle "burn when we WIN / LOSE" → name and
  ticker prefilled → review in plain words → launch), **Matchup pair** (league → upcoming game, or search a team → both sides
  prefilled → "this game only" (default) or "every game this season" → back-tests side by side → review → bundles), **Any market**
  (one search box: teams, people, shows, elections — Kalshi event-level hits merged with series, and Polymarket events, markets and
  tags since 10-10, each result with a venue chip), and a small "Advanced: first-party feed / custom selector" link. `?pair=1` (the landing page's "Launch a pair") opens the matchup flow. Progress ("Step 2 of 4"), back
  buttons, state kept across a refresh (sessionStorage `burnticker.launch.v2`; "start over" clears it), a Devnet badge from
  `BURNTICKER_CLUSTER` (the wizard's catalogue route returns `cluster`). The simple paths generate the rule (`src/lib/burnticker/wizard.ts`):
  - team coin = `series` + the team's own-leg filter (`-PHI`), binary, onYes (win) or onNo (loss), 1% of the pool per game, $1 floor,
    0.02 SOL reserve; "Edit the rule" holds the slider and the generated selector. On a league with draws a draw settles the team's
    leg NO, so a loss coin also burns on a draw.
  - pair, this game only = one market (side A's own leg, `KXNFLGAME-26OCT11PHIJAC-PHI`) burning on NO; the server derives side B by
    inversion (YES on the same market) — a partition, a registered pair (a draw burns side A; "swap sides" moves it).
  - pair, every game this season = each side's OWN team's games (`-PHI`, `-JAC`), each burning on its own loss: the two selectors are
    not a partition in general — they meet only on head-to-head games (where exactly one burns) — so the wizard shows two independent
    records with the head-to-head count and launches two coins (two `POST /api/burnticker/launch` calls without `pair`); they are not a
    registered pair, because the pairs table requires one shared selector (a server change would be needed for a two-selector pair).
  The request body and the launch route are unchanged.
- Event-level search (10-10; the owner searched "eagles" and got nothing — series titles say "Professional Football Game", the game is an
  EVENT): `src/lib/burnticker/oracle/events.ts` (parsing, a team-alias table for NFL/NBA/NHL/MLB with Kalshi's spellings — JAC not JAX,
  LAR/LAC, NOP, GSW, VGK …, matching, a game's two sides, the league chooser derived from the Sports "…GAME" series, the team picker with
  next game and season record) and `KalshiClient.searchEvents / eventsForSeries / teams / leagues` (events cached 10 min per series).
  Public API: `GET /api/burnticker/v1/kalshi/events?q=&series=&status=` (no parameters → the league chooser), `GET /kalshi/teams?series=`,
  and `/kalshi/search` now also returns `events` + `ranking` (events first when the query names a team or matched a market). A person
  who appears only in the market labels of a series whose title does not name them is found by passing that series (`?series=KXNEWPOPE&q=parolin`);
  the global index of ~15,700 open events (79 pages) is too slow to scan per request. SDK: `kalshi.events()`, `kalshi.teams()`.
- Landing page (`site/burnticker/index.html`): the "Rivalries" section right after the ticker tape — two example matchups drawn as
  receipts ($BRONCOS vs $CHIEFS on KXNFLGAME, $BULLS vs $BEARS on the KXINX close, illustrative tallies), how a pair works in three
  steps, and the "Launch a pair" button.

## Pair curve — both coins graduate together, or neither does (owner 10-10; behind a flag)

`pair_curve` (`programs/burn-receipts/programs/pair_curve`, program id `2jQotwSG8WKNYr5pccxuVmNa314qcnnwmrhqbuakELkN`, design and threat
model in `docs/burnticker/PAIR-CURVE.md`) is the launch program for rivalry pairs: one `Pair` account, two path-independent
virtual-reserve curves, one SOL vault, 100 bps per trade (25 developer, 75 the traded coin's burn pool), graduation only when the
combined raise hits the target with each side at its minimum share (default 25 %), both CPMM pools created at pair_curve addresses with
all LP burned, or a void at the deadline after which every holder sells back. No admin, no withdraw.

- **Flag:** `BURNTICKER_PAIR_CURVE_ENABLED=1` (default off) makes the wizard's matchup / election pair launch through pair_curve:
  `src/lib/burnticker/pairCurveLaunch.ts` turns `buildPairBundles`' two LaunchLab bundles into three transactions (mint A + its
  TokenConfig with registration policy 2, the same for B, `init_pair`) and exports the badge (`PAIR_CURVE_BADGE`); the launch API returns
  it as `pair.pairCurve`. `BURNTICKER_CP_CONFIG_ID` overrides the AmmConfig (default: CPMM index 0 per cluster). Off = the LaunchLab
  path with the rules-level "both or neither" clause.
- **Client:** `src/lib/pairCurve/{pricing,accounts,client,idl}.ts` — the curve math mirrored in bigint, PDAs and Pair decoding, IDL-driven
  builders, the crank planner.
- **Keeper:** with the flag and the program client real, every cycle of `scripts/burnticker-keeper.mts` scans the program's Pair
  accounts and cranks `graduate` (per side, with `register_pair_pool`), `register_pair_pool` or `void_pair`
  (`src/lib/burnKeeper/pairCurveCrank.ts`). The registered pools then run through the ordinary `crank_buyback`.
- **Admin CLI:** `scripts/paircurve-admin.mts` (devnet/localnet only; init-pair, buy, sell, crank, graduate, register, void, close,
  status). Devnet rehearsal: `docs/burnkeeper/devnet-paircurve-run-log-2026-10-10.md`.
- **burn_receipts** gained registration policy 2 and `register_pair_pool` (the LaunchLab path is untouched); Powers Registers:
  `docs/burn-receipts/powers-register.md`, `docs/burn-receipts/pair-curve-powers-register.md`.
## Trust ops — snapshots, status, redundancy, drills, attesters, incidents (owner-approved 2026-10-10 night: "build them all")

New modules only (`src/lib/burnticker/ops/`, `src/lib/burnticker/attesters/`), four hook lines in `scripts/burnticker-keeper.mts`.

- **Daily registry snapshot on Arweave** (`ops/snapshot.ts`): once per UTC day the active keeper exports the append-only ledger (rules,
  readings, receipts, pairs, pair outcomes, rule ends, launch pins) as canonical JSONL, pins it through Irys (`BURNTICKER_UPLOAD_PAYER`;
  refused without it, never a hosted copy) and records `{date, sha256, arweaveTxId, rowCounts}` in a write-once `snapshots` table.
  `GET /api/burnticker/v1/snapshots` (API 1.7.0), the status page, the trust page and the platform daily post's footer (`snapshotLine()`)
  show the latest. Verify any of them: `scripts/burnticker-verify-snapshot.mts <txid> [--cluster mainnet] [--db <registry copy>]` (re-download,
  recompute, canonical-form checks; `--db` = every row still present, unchanged). By hand: `scripts/burnticker-snapshot.mts --now|--list|--export`.
- **Public status page** (`ops/status.ts`, `ops/feedHealth.ts`): `status/status.json` every cycle — heartbeat, role, each selector's last
  good read, cross-read agreement and staleness (down / disagree / withheld / stale, each withholding the reading), open alert kinds,
  wind-downs, retired coins and sweeps, the latest snapshot, program ids with the verified-build status — rendered by the static
  `site/burnticker/status/` page (the landing's CSS tokens, B1 receipt) at `status.burnticker.com` and `/status/`.
- **Keeper redundancy** (`ops/leaderLock.ts`, `ops/readingFence.ts`): `BURNTICKER_KEEPER_ROLE=leader|standby`; a standby takes over only
  after N missed heartbeats AND a takeover note signed with its key; the leader yields to a verified note; no automatic fail-back. The
  foreign-reading fence stops a second keeper from counting a receipt the other already attested (the program cannot catch that case).
  What it does not guarantee: runbook "Keeper redundancy".
- **Source-outage drill** (`ops/drill.ts`, `scripts/burnticker-drill.mts --feed <id> --mode down|disagree|stale|--all`): the keeper's
  planning pass in a scratch registry against a wrapped source asserts withheld / alerted / shown / no crank, after a control run that
  cranks. Monthly (runbook "Monthly drills").
- **Bring your own attester** ([ATTESTERS.md](ATTESTERS.md), `attesters/byo.ts`, `scripts/burnticker-attester.mts keygen|read|status|propose|apply`):
  run the reader from the public tree, compute and sign the exact reading message, compare it with the chain; proposals checked against
  the program's quorum and 7-day seniority rules before the vault is asked. The trust page lists each coin's attesters.
- **Incident policy** ([INCIDENTS.md](INCIDENTS.md), [incidents/TEMPLATE.md](incidents/TEMPLATE.md), the log moved to
  [incidents/LOG.md](incidents/LOG.md)): what counts, a public postmortem within 48 hours, where, signed by the operator.
- **Launch-day load test + fallback** ([LOADTEST.md](LOADTEST.md), `scripts/ops/loadtest.sh`): 50 RPS mixed passed on 2026-10-11 (p95 198 ms,
  0 5xx) with the limiter answering most API calls; Cloudflare cache rules to apply; Caddy now caps app page shells at 60 s at the edge and
  serves `site/burnticker/fallback/` (503) when the app is down.

## Burn Derby — coin vs coin, single assets, brackets (owner-approved 10-10: "build it all")

A new selector kind: the **relative performance of two existing coins** over a UTC day (00:00 → 00:00) or week. `oracle: "derby"` with a
locked `derby` block (`src/lib/burnticker/derby/spec.ts`); design note: [DERBY.md](DERBY.md).

- **Coin vs coin** (`selector: "coinvs"`): side A's coin burns on a window A out-gains B (% change, or market-cap change with
  `measure: "mcap"`), side B's on a window B wins; a tie posts void receipts and burns nothing. The one-shot **flippening** (`flip: true`)
  settles YES on the first window A's size passes B's, NO when the season ends without it; the pair then retires. **Single assets**
  (`selector: "price"`): one Pyth feed — a coin, a stock or fund, FX, a metal, a commodity — counted in units of percentage points of its
  window change (the coverage audit's Financial-markets primaries). **Brackets** (`selector: "bracket"`): 8 or 16 coins, one derby per
  match per round (default 7 days); more winning days advances (tiebreak: compounded change, then the lower seed); the loser's fan coin
  retires; the final burns two units. Page `/burnticker/derby/<tournamentId>`; `scripts/burnticker-derby.mts create|show|fan-rule`.
- **Values:** Pyth — keyless from Pyth's sponsored `PriceUpdateV2` accounts on Solana (snapshotted at each boundary), or Hermes
  `v2/updates/price/<t>?ids[]=…&encoding=base64&parsed=true` with `BURNTICKER_PYTH_API_KEY` (keyless Hermes price paths answered 401 on
  10-10; the update bytes' sha256 is the proof). Coins without a feed (GIGA): the TWAP of the deepest SOL pool's vault balances (Raydium
  CPMM / PumpSwap) × Pyth SOL/USD. Coins with no Pyth account, no key and no pool (SHIB): RedStone's signed packages, each signature verified
  against RedStone's published primary-prod signers (`derby/redstone.ts`). **Cross-read:** Jupiter price v3, DexScreener, RedStone's gateway — snapshotted at each boundary; a
  gap above 2 points on the margin withholds the window (no reading, no burn, an alert).
- **Keeper:** a sampler before each fetch, decisions once per window (`derby_windows`, append-only), readings with
  `proof: derby:sha256:<hex>`, the counter attestation's signed `proof=` carries it, a planning pass retires finished coins.
- **Index:** `/burnticker/derby` — open pairs (score, last days, season end), active brackets, ended ones below, and the "Coin vs Coin"
  button (`/burnticker/launch?derby=1&a=&b=` opens the tile with both searches filled in); the universal search's "WIF vs SHIB" card links
  to it.
- **Wizard:** the "Coin vs Coin" tile (`src/app/burnticker/launch/CoinVsCoinTile.tsx`): pick two coins (Pyth catalogue + Jupiter token
  list), window, season (30 days), optional flippening; live cards; the review sentence — "$TEAMWIF burns 1% every day WIF out-gains SHIB
  (Pyth, 00:00 UTC). $TEAMSHIB burns when SHIB wins. 30 days."
- **Pair page:** running score (receipt tally), day strip with both readings, season end, proof links; the day post
  `Day 12 · WIF 7 – SHIB 5 · $TEAMWIF burned 1% · receipt …` with both communities' @handles.
- **API 1.4.0:** `GET /v1/derby`, `GET /v1/derby/{id}`, `GET /v1/derby/search?q=&assets=`; SDK `bt.derby.list() / get(id) / search(q)`.
- **Refused:** a platform coin as an underlying, the refuse list, no Pyth feed and < $250K liquidity, the same coin twice, a season that
  starts before the next 00:00 UTC; Pyth's US index proxies stay behind `BURNTICKER_INDEX_PROXIES_ENABLED`. The coverage preflight runs
  each coin's primary and cross-read live. Not built: communities burning their own tokens into a score (attack surface; DERBY.md §9).

## Templates, the creator dashboard, search misses and time-to-launch (10-10, the owner: "build them all")

- **Templates.** `/burnticker/templates` lists the twelve canonical rule shapes (`src/lib/burnticker/templates.ts`), each with an
  example sentence and "Start from this". Every coin and pair page has **Launch one like this**, which opens the create screen on the
  same shape with the dials copied; the team, race or feed is picked again.
- **Creator dashboard.** `/burnticker/me` is read-only (wallet connect or a pasted address; nothing is signed) and reads
  `GET /api/burnticker/v1/creators/{wallet}`. It shows each coin's state, queued units, next settlement, last reading with how many
  independent reads confirmed it, receipts and wind-down, and has a button to copy today's lint-checked post.
- **Search misses and time-to-launch.** These are anonymous first-party records (`src/lib/burnticker/productStore.ts`;
  transparency.md § 4). The admin summary is `GET /api/burnticker/v1/ops/search-misses`; the weekly markdown rollup is
  `scripts/burnticker-search-misses.mts`.

## Growth batch — badges, league pages, the bot starter kit, mint verification and clone watch (10-10, the owner: "build them all")

- **Embeddable receipt badge.** `GET /api/burnticker/v1/badge/<TICKER>.svg|.png|.json` and `/badge/pairs/<pairId>.*` serve a small
  receipt-slip card (`src/lib/burnticker/badge.ts`). It shows the ticker, the rule's one-liner, the last burn (date and units), the
  receipts this season (a team coin's own season, otherwise the calendar year) and **verify →**, which links to the coin page's
  `#verify` section. The card is built from the coin page's own status and receipts, cached for 60 s. It carries no price, market
  cap, odds, implied chance or volume: `badgePayloadProblems` guards every payload.
- **Embed page.** `/burnticker/embed/<TICKER>` (and `/embed/pairs/<pairId>`) is a route handler, not an app page, so no header,
  footer, fonts or cookies load. It shows the same SVG and a live "next settlement" countdown. CSP is `frame-ancestors *` with hashed
  style and script. Caddy serves it through `security_embed`, which drops `X-Frame-Options`.
- **Embed box.** Every coin page and pair page has an "Embed this coin" box (`_components/EmbedSnippet.tsx`) with a copy-paste
  iframe and a Markdown badge.
- **League and season pages.** `/burnticker/leagues` lists the leagues by sport, alphabetically, with counts only.
  `/burnticker/leagues/<league>/<season>` (for example `nhl/2026-27` or `mlb/2026`) has:
  - the scoreboard cards from `seasons.ts`, imported rather than copied. A coin is ranked only inside its own league, and
    "champion" appears only after the season has ended;
  - the team list, with "launch a coin for this team" links (`/burnticker/launch?q=<team>`);
  - the games the league's coins settled in the last seven days, each with its recorded source line ("settled on the game's
    on-chain payout · confirmed by NHL's official scores") and a plain "see on ESPN →" link;
  - JSON-LD (BreadcrumbList, and a SportsEvent with only the recorded facts), OpenGraph metadata and a generated OG image at
    `…/og`.

  `src/lib/burnticker/leagues.ts` builds all of this, and `leaguesServe.ts` keeps a 60 s registry memo.
- **Sitemap.** `/burnticker/sitemap.xml` (Caddy serves it at `/sitemap.xml`) lists the app pages, the docs, every launched coin
  (never a draft), the pairs and the league seasons.
- **Bot starter kit.** `packages/burnticker-bot-starter/` holds three scripts:
  - `follow.ts` prints each new receipt with its verifier call;
  - `launch.ts` previews a launch bundle for a catalogue rule. It prints the unsigned transactions and the rules sha, and never
    signs;
  - `post.ts` renders lint-clean receipt, season-card or scoreboard posts through the platform's generator into a queue file. It
    has no X API.

  The SDK is imported through one line (`src/sdk.ts`). The package README covers setup, the keyless API and the rules.
- **Verify a mint.** `/burnticker/verify` and `GET /api/burnticker/v1/verify-mint/<mint>` compare the burn_receipts program's
  TokenConfig with the registry (`verifyMint.ts`). The answer is either "Burnticker coin: yes", with the rule sha, creator, launch
  date, receipts and page link, or "NOT registered with the burn_receipts program". It is phrased plainly and never accuses anyone.
  The fake program client never counts as a program read. Every coin page shows "verified by program · mint …" beside the address
  copy button, and the receipt verifier links to this page.
- **Lookalike refusal and no adoption.** The launch handler calls `launchGuards.ts` once per side.
  - `lookalike.ts` reduces tickers and names to skeletons (homoglyphs, 0 → O, 1 / l → I, accents, rn → m). It refuses an exact
    skeleton match, one edit (on four letters or more), copycat suffixes and prefixes (DEFICIT2, REALDEFICIT) and the platform's
    name, with a reason (409 `lookalike`). Two windows of the same team are exempt, and a draft reserves its ticker.
  - `mintAdoptionRefusal` refuses a mint that is already registered or already exists on chain (409 `mint-exists`).
- **Clone watch and "Not Burnticker".** `src/lib/burnticker/ops/cloneWatch.ts` is run every 15 minutes by
  `scripts/burnticker-clone-watch.mts` and `mct-burnticker-clonewatch.timer`. It uses DexScreener's keyless search for DEFICIT,
  Burnticker and every launched ticker, Solana only, with lookalike matching. For each match it records:
  - whether the program knows the mint;
  - the holder-stack signal (5 or more top holders with identical shares);
  - the LP state, and when the LP was pulled.

  Rows are append-only. `/burnticker/not-burnticker` and `GET /api/burnticker/v1/clones` list evidence only. They name no one, and
  every line passes the copy lint. The launch-day anti-impersonation steps are in runbook.md, step 11.

## First-party settlement for team coins and weather; elections; the universal search (10-10, later the same day)

- **Venues** (`src/lib/burnticker/venues.ts`): `BURNTICKER_KALSHI_ENABLED` defaults **off** — Kalshi routes, back-tests and launch bundles
  answer 503; no Kalshi display reads by the app or the keeper's page publish; the keeper reads Kalshi only for coins already registered
  with a Kalshi rule (a warning per read). `BURNTICKER_POLYMARKET_DISCOVERY_ENABLED` defaults **on**, with **no market data**: question,
  outcomes, end date, resolution rules and condition id only (`scrubMarketData`, tested on every discovery payload). Settlement always
  reads the Polymarket payout on chain.
- **Native first-party sources** (`src/lib/burnticker/sources/native.ts`): catalogue series with their own reader — `espn.team:<league>-<ABBR>-win|loss`,
  `espn.game:<league>-<event>-<ABBR>-win|loss` (no ESPN reads: the schedule from MLB StatsAPI, the NHL feed, the NBA feed, else TheSportsDB v2 with
  `BURNTICKER_THESPORTSDB_KEY`; each game settles on its on-chain payout where a Polymarket moneyline market exists, else on
  TheSportsDB's final, and counts only when a second independent operator agrees — the payout and TheSportsDB confirm each other,
  the league's official feed is a further read where free, API-Sports (`BURNTICKER_APISPORTS_KEY`) optional; a game is read ≥ 6 h
  after its start; src/lib/burnticker/sources/gameSettle.ts), `nws.high:<ST>-<°F>`, `nws.rain:<ST>-<in>`, `nws.snow:<ST>` (NWS CLI final reports;
  the Iowa Environmental Mesonet as the cross-read), `fec.beats:<A>-<B>` (OpenFEC receipts per report; same-operator cross-read, refused
  by the coverage gate). Scalar, unit 1, baseline 0, direction up. Their descriptors (kind `native`) in `config/burnticker/sources.json`
  feed the coverage matrix and the creation preflight.
- **Team coin / Matchup** run on the scoreboard with Kalshi off (`/v1/sports/teams`, `/v1/sports/games`); a matchup is two coins, one per
  team. **Elections** (`src/lib/burnticker/elections.ts`): Polymarket's open midterm races, named outcomes (`groupItemTitle`), unnamed
  placeholders hidden, the state's certified-results publisher as the cross-read (`config/burnticker/sos.json`); the **election-pair
  template** (`electionPair.ts`, `/v1/elections/pair`) — FEC beats + a one-shot winner burn per side; composite rules and the
  both-or-neither void clause are pending cores, listed on the template.
- **Universal search** (`src/lib/burnticker/search.ts`, `GET /v1/search`): one box on the launch page → ready-made rules (venue badge,
  who settles it, when, how) → the create screen pre-filled. Owner test cases in `test/burntickerSearch.test.ts`.

## Launchpad look + Browse + the Kalshi switch (10-10)

The owner asked for Burnticker to present like the launchpads new users know (pump.fun, LetsBonk/LaunchLab, Pons, Bags). The study,
with a source per pattern and the adopt / adapt / reject table, is [ui-conventions.md](ui-conventions.md).

- **Coins page** (`/burnticker`): a coin card grid. Each card shows image (or a receipt-paper thumbnail), name / $TICKER and the rule's
  one-liner (`coinCard.ts`; there is no market cap). It also shows the bonding curve as SOL raised of the graduation threshold, a
  "graduated" badge, burns, last burn, next result and a venue chip. Tabs are New · Next to settle · About to graduate · Graduated ·
  Pairs, with search and "Launch a coin" next to them.
- **Coin page**: chart on the left (GeckoTerminal embed of the pool that trades now on mainnet, else the readings chart), receipts tape
  below it. On the right are Trade deep links to Raydium / Jupiter (no hosted swap, no presets), the curve, holders and the rule card.
- **Phone**: a bottom tab bar (Coins · Launch · Rivalries · Trust) under 900 px.
- **Market data** (`src/lib/burnticker/market.ts`): the LaunchLab PoolState decoder, pinned against the SDK layout and three real
  mainnet pools. It also reads the top-20 holders, and builds the trade links and chart embed. These land in `status.json` `market`,
  next to a new `profile` block and `burned.lastAt`. They are read by the app and the keeper only with `BURNTICKER_RPC_URL`;
  otherwise they show "—" with the reason. Holder count is always "—" (it needs an indexer).
- **Wizard**: a **Browse everything** path over Burnticker's own taxonomy (`config/burnticker/categories.json`), listing first-party
  feeds first, then Polymarket tags, then Kalshi series (`src/lib/burnticker/browse.ts`, `GET /api/burnticker/v1/browse`). The create
  screen follows pump.fun's order (image → name → ticker → description → socials) with a live card preview. Review shows a plain
  sentence for any rule. Kalshi's own category tree is also exposed: `GET /api/burnticker/v1/kalshi/categories`
  (`oracle/browse.ts`, `KalshiClient.categories()` / `seriesByCategory()`, cached 1 h).
- **`BURNTICKER_KALSHI_ENABLED`** (`src/lib/burnticker/venues.ts`): off by default since the later 10-10 change (see the section above).

## Polymarket — the second adjudicated oracle (owner, 10-10: "do both")

`oracle: "polymarket"` rules are tier 1 and launchable beside Kalshi's. `src/lib/burnticker/oracle/polymarket.ts`:

- **Discovery** is Gamma, keyless (`public-search`, `events?slug=`, `tags/slug/`, `markets?tag_id=…&closed=…&order=…`,
  `markets?condition_ids=…&closed=true|false`), every response cached 10 minutes, requests serial and spaced.
- **The result is read from the chain.** A reading is written only when the Conditional Tokens contract on Polygon
  (`0x4D97DCd97eC945f40cF65F87097ACe5EA0476045`) has the market's payout vector (`payoutDenominator > 0`, three `eth_call`s through
  `src/lib/burnKeeper/attesters/polymarketOnchain.ts`; RPCs from `BURNTICKER_POLYGON_RPC_URLS` or the public list). Slot 0 = YES (the
  market's first outcome: "Yes", or the first-listed team), slot 1 = NO, a split (50-50) = VOID. Gamma's own report (closed +
  `umaResolutionStatus: resolved` + `outcomePrices` exactly 1/0) is a cross-check; on disagreement the chain is the record and the
  keeper logs it. Each reading carries `sourceUrl` = the Gamma market URL and `proof` =
  `polygon:137/ctf:<contract>/condition:<id>/payouts:1,0/block:<n>` (a new `readings.proof` column). A resolved vector is cached for
  good (immutable on chain).
- **Selectors:** `market: <condition id>` (one-shot), `series: "tag:<tag>[/<sports market type>][:<event slug glob>]"`
  (`tag:nfl/moneyline` = every NFL game's moneyline) or `series: "event:<slug>"`; `filter.titleRegex` over the question. Binary only.
  Selector keys `polymarket:market:<id>` / `polymarket:<series>:binary`. A tag series must fit one keeper scan per week (600 closed
  markets at the defaults); a denser one is refused at launch with a hint to add a type or an event glob.
- **Refuse list** applies to every market question at read time (a refused market is never read) and to the selector's title at
  launch, the same file as Kalshi's.
- **Back-test** (`POST /api/burnticker/v1/polymarket/backtest`, and the shared `/kalshi/backtest` dispatches on the oracle) reads
  Gamma's closed markets — display-grade by design; the keeper reads the chain.
- **Pairs:** a Polymarket binary market pairs exactly like a Kalshi one-shot (side A burns on YES, side B on NO).
- **Why team coins and matchups stay Kalshi-only (v1):** a Polymarket game is an EVENT of ~300 markets whose moneyline is ONE binary
  market with the two nicknames as outcomes in title order ("Broncos vs. 49ers" → Broncos is YES; "Rams vs. Broncos" → Broncos is
  NO — the 10-10 fixture shows both). There is no per-team leg and no team-abbreviation field (teams appear only in the slug convention,
  with Polymarket's own abbreviations, e.g. JAX where Kalshi says JAC), so "every Broncos loss" has no fixed YES/NO.
- **Wizard:** "Any market" searches Kalshi and Polymarket at once; each hit carries a venue chip. **API:** `GET /polymarket/search`,
  `POST /polymarket/backtest` (OpenAPI 1.1.0). **SDK:** `bt.polymarket.search()` / `backtest()`; `verifyReceipt` re-reads the payout
  vector on the caller's machine. **Fixtures** (fetched 10-10): `config/burnticker/fixtures/polymarket/{resolved,open}.market.json`,
  `tag.nfl.{closed,open}.json`, `search.eagles.json`. Tests: `test/burntickerPolymarket.test.ts`.

## Settlement coverage audit

`src/lib/burnticker/coverage/` + `scripts/burnticker-coverage-audit.mts` (10-10, after the Kalshi decision). For every category of
`config/burnticker/categories.json` and every selector kind the wizard can emit (a settled number, a recurring yes/no series, a
one-shot market, a team coin, a matchup game, a matchup season) it lists the primary sources, their independent cross-reads and a
verdict:

- **settleable** — at least one primary source AND an independent cross-read of the same fact. A primary is a first-party adapter
  (attested-http or on-chain, tier 4 or better, launchable, not an aggregator, not cross-read-only); a cross-read shares the primary's
  `fact` in `sources.json` and has another `operator` on another registrable domain. Kalshi is neither, whatever any file says.
- **adjudicated-only** — no such pair, but Polymarket's binary markets cover the kind (the result is the CTF payout vector on Polygon).
- **uncovered** — neither.

Each primary and cross-read also gets a **90-day dry run** (`historicalDryRun`): readings its schedule expected vs produced (hit rate;
schedules from the period kind and cadence, U.S. federal holidays for business-day series, n/a for snapshots and event-driven counts),
median latency from the keeper's first sightings (n/a until the keeper has read the source), and the disagreement rate with its
cross-read. Offline it reads the frozen fixtures, so the result is reproducible; `--live` fetches each source once, serially and spaced.

- CLI: `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/alias-hook.mjs scripts/burnticker-coverage-audit.mts
  [--offline|--live] [--write] [--json] [--require-primary]`. `--write` regenerates [SETTLEMENT-COVERAGE.md](SETTLEMENT-COVERAGE.md)
  (per-category tables and "What we cannot settle today"). Exit 1 when a category is uncovered (`--require-primary`: also when one has
  no primary source at all).
- API: `GET /api/burnticker/v1/coverage` (OpenAPI 1.3.0), the same matrix, offline and cached 10 minutes; the trust page's
  "Settlement coverage" section reads it.
- **Creation preflight** (`preflightSelector`, wired into `prepareLaunch`, so the wizard and `POST /v1/launch/bundle` share it): the
  selector is run live once — primary + cross-read (Polymarket: the payout vector + Gamma's report) — and creation is refused on any
  failure: a Kalshi rule, a stub oracle, a source that is not a primary, no cross-read, an unreadable read, or a disagreement on the
  latest shared period. The answer (last reading, next expected date, agreement) rides in the bundle's `preflight`.
  `BURNTICKER_PREFLIGHT_STRICT` defaults on; the test hook turns it off for the suite.
- Cross-reads added on 10-10 (cross-read-only, not launchable): `fred.APU0000708111` (of `bls.eggs`), `bls.LNS14000000` (of
  `fred.UNRATE`), `bls.CUSR0000SA0` (of `fred.CPIAUCSL`), `bitcoin.blockHeight.blockstream` (of `bitcoin.blockHeight`); `fred.GFDEBTN`
  and `treasury.debt` cross-read each other at quarter ends.
- The first live dry run found a real fault: FRED's keyless CSV serves the whole history, the 2020-04 jump trips `fred.UNRATE`'s
  plausibility delta and nothing after 2020-03 was read. The FRED requests now ask for three years (`cosd={from:1100}`), and the
  preflight refuses a stale read (`stale-primary`).
- Today (offline, 10-10): Economics and Crypto & On-chain are settleable; the other nine categories are adjudicated-only; none is
  uncovered. Team coins and season matchups are uncovered (no Kalshi, and Polymarket's game markets have no fixed per-team YES/NO).

## 1. Architecture

```
src/lib/burnticker/
  rules.ts            a rule = SELECTOR + outcome→burn mapping; canonical JSON; sha256 (the keeper's rulesSha256); disclaimer
  units.ts            the unit engine (binary / scalar, exact decimals, carry only where a source says) — pure, runs in the browser too
  receipt.ts          the v3 receipt line, OFF-CHAIN only (the program writes v1/v2 on chain) (BT|TICKER|id|oracle=|market=|result=|settled=|src=|value=|units=|pool=|spent=|got=|burn=|swap=|rules=sha256:|v3)
  oracle/kalshi.ts    the Kalshi adapter (since 10-10 not a settlement input: discovery behind BURNTICKER_KALSHI_ENABLED; the keeper still reads coins already launched on it): settled results only, finality timer, ladder derivation, voids, implied chance (display only), polite client
  coverage/           the settlement-coverage audit: matrix (verdict per category × selector kind), 90-day dry run, creation preflight, the report/doc glue
  oracle/backtest.ts  "this selector settled N times in 12 months and would have burned X"
  oracle/refuse.ts    the refuse list (config/burnticker/refuse.json)
  oracle/polymarket.ts the SECOND tier-1 source (10-10): Gamma discovery/search, the CTF payout vector on Polygon as the final read, back-test from Gamma's closed markets
  sources/stubs.ts    the Polymarket catalogue card (launchable), UMA decoder, Drift/Hedgehog placeholders (not launchable)
  sources/types.ts    ResolutionSource: four kinds (market / assertion / attested-http / onchain) + tier 1–5
  sources/attestedHttp.ts  the generic config-driven adapter (JSON path / CSV / regex → rows → periods → values or counts; snapshots)
  sources/onchain.ts  Solana block height / slot through an RPC port (account/consensus data only, never an indexer)
  catalogue/index.ts  config/burnticker/sources.json read through the generic adapter (tier 3–5 cards, fixtures, previews)
  registry.ts         data/burnticker.db: tokens, readings, burns (receipts), signatures, token_state, feed_state, attesters — APPEND-ONLY (SQL triggers)
  program.ts          BurnProgramClient (the Receipts program from the keeper's side) + FakeBurnProgram
  launchBundle.ts     buildLaunchBundle(): initialize_token + LaunchLab create (FakeLaunchLab now; SdkLaunchLab over src/lib/burnKeeper/launch.ts)
  multiKeeper.ts      one loop over every token: fetch due selectors → plan → crank (write-ahead, chain-is-final-word) → publish
  tokenPage.ts        status.json / receipts.json / index.html per token (§6) + the platform index; shares the $DEFICIT CSS and chart
  fees.ts             the fee split (designed numbers from docs/burnkeeper/fees.md), the 25 SOL pre-audit cap, operator lines
  trust.ts            the Powers Register, live PlatformConfig vs designed, fee ledger from chain, team wallets, incidents, audit
  audit.ts            recompute every receipt of every token (source + rule, and the memo on chain when a client exists)
  server.ts           the app's wiring (registry, oracles, program/LaunchLab clients — fakes until the program and RPC exist)
  verify.ts           one receipt's checks (rules / memo / source / units / spend / chain) — shared by the API's /verify and the SDK
  transactions.ts     launch-bundle instructions → unsigned wire-format transactions (never signs; placeholder blockhash flagged)
  pageTypes.ts        status.json / receipts.json shapes (types only, so the SDK can import them)
  ops/                trust ops (2026-10-10 night): snapshot (daily Arweave ledger snapshot + verifier), feedHealth, status (status.json),
                      leaderLock + readingFence (keeper redundancy), drill (source-outage drill), keeperOps (the keeper's hooks), trustOps, spec/api (/v1/snapshots)
  attesters/byo.ts    bring your own attester: keygen, the counter + signed reading message, chain comparison, proposal checks
  api/                the public API: spec.ts (the ONE schema source → openapi.json, cache, rate limits), http.ts (rate limit, CORS,
                      cross-site refusal), handlers.ts (logic shared with the wizard's routes), v1.ts (one function per operation)
packages/burnticker-sdk/   @burnticker/sdk — the public SDK for bots (docs/burnticker/sdk.md); public-closure.json = the repo files it needs
src/app/api/burnticker/v1/*   the public HTTP API (docs/burnticker/api.md)
scripts/burnticker-keeper.mts · burnticker-platform-config.mts (dry run, never sends) · burnticker-audit.mts (exit 1 on any mismatch)
src/app/burnticker/{page,launch,t/[ticker],trust} · src/app/api/burnticker/{catalogue,oracle/search,oracle/backtest,tokens,tokens/[ticker],launch,trust}
config/burnticker/{sources.json,refuse.json,fixtures/**} · deploy/caddy/Caddyfile · docs/burnticker/{README,deploy,INCIDENTS,ATTESTERS,LOADTEST}.md, incidents/{LOG,TEMPLATE}.md
```

Reused from the keeper, not forked: `rulesSha256`, `buybackSpend`, `spendablePool`, `belowFloor`, `settleBurn`, `rawToTokens`,
`tokensToRaw`, `backoffMs`, `publishSite`/`toJson`, `explorerUrl`, the memo byte ceiling, and (new small exports) `STATUS_CSS` and
`seriesChartSvg`; the LaunchLab builders `planLaunch`/`buildCreateTx`/`buildVestingTx`/`buildPlatformTx`/`feeSplit` from the merged
`launch.ts`. The keeper's `cycle.ts` stays the single-token $DEFICIT path: it is bound to Treasury cents and the two-leg swap+burn; the
Receipts program's one-instruction `crank_burn` is what the multi-keeper drives, with the same write-ahead discipline.

## 2. The selector model — how a creator binds to "all future X"

A rule names an oracle and a selector, and maps outcomes to burns. It is locked by its canonical bytes' sha256 and applied to markets
that do not exist yet.

```json
{ "schema": "burnticker.rules/v1", "oracle": "kalshi", "series": "KXNFLGAME", "market": null, "filter": { "tickerIncludes": "-DEN" },
  "kind": "binary", "binary": { "onYes": { "fractionOfPool": 0.02 }, "onNo": null }, "scalar": null,
  "onVoid": "skip", "floorUsd": "1", "reserveSol": "0.02", "vault": null }
```

- `series` + `filter` = every future market of the series whose ticker contains the text (and/or whose title matches a regex).
  The back-test lists exactly which past markets matched, so a creator sees that a bare "DEN" also matches the opponent's leg.
- `market` = one ticker: a one-shot rule; the page says "resolves once on <close time>", then the supply is fixed.
- `kind: "scalar"` reads the settled number (Kalshi's `expiration_value`, else the strike ladder: the YES `between` band's floor, else the
  highest `greater` YES, else the lowest `less` YES, else void) and counts `unit`s from a baseline ("previousSettlement" or a number) in a
  direction (up / down / abs). `kind: "binary"` reads `result` yes/no.
- `fractionOfPool` = buyback (spend = pool × (1 − (1 − f)^units), the keeper's exact integer formula; floor and reserve from the rule);
  `tokens` = vault mode (units × tokens from a 10–30 % vesting allocation; shortfalls carried and published). One mode per rule.
- `oracle: "catalogue"` + `series: "<source id>"` binds to a first-party source; the source fixes unit, direction, baseline and carry.
- Voids never burn. Finality: a Kalshi market counts when `finalized`, or `settled` once `settlement_ts + settlement_timer_seconds` has
  passed. Prices are never read into a rule; the page's "market-implied chance of the next burn" is labelled display-only.

Examples under test (`test/burntickerHelpers.ts`, real fixtures): Broncos games (binary, filter), Denver daily high (scalar, fixed
baseline 80 °F), a one-shot market, the S&P 4 pm close (scalar vs previous settlement, 10 points per unit), the $DEFICIT Treasury rule
(tier 2 with the keeper's carry, reproduced to the cent).

### Rivalry pairs

See [Rivalry pairs](#rivalry-pairs--two-coins-one-matchup-owner-approved-10-09-night-the-headline-since-10-10) at the top: a pair is two rules on the same selector with inverted mappings.

## 3. How a creator launches (§1)

`/burnticker/launch`: connect a wallet (wallet-adapter, already a dependency; Wallet Standard discovery, nothing added) or paste a
pubkey → pick an event (live Kalshi search, or a first-party card with its tier and fixture preview) → define the mapping with sliders
and run the back-test → name it → review the rule text and hash, the receipt format, the fee split per 1 SOL (pre/post graduation),
"LP burned at graduation: 100 %", "creator cash from fees: 0", "team allocation: 0 %", what the operator can and cannot do; tick the
two boxes → the API builds the unsigned bundle (`initialize_token` + LaunchLab create under our platform config with the burn pool as
the creator-fee recipient, optional first buy) and registers a DRAFT. The bundle says `ready: false` until the Receipts program and the
LaunchLab adapter are live; nothing is sent until it says `ready`. `action: "launched"` with the landed tx takes the draft live and
sets the baseline (settlements after that moment count). Anonymous creators are allowed; the creator wallet is always displayed.

### Bots: the SDK and the public API (owner, 10-09: "no tokens will be adopted into the platform, provide the sdk/api so people can incorporate into bots")

Everything the wizard does and everything the pages show is available to bots — trading bots, launch bots, Telegram bots, agents —
through `@burnticker/sdk` (`packages/burnticker-sdk/`, guide: [sdk.md](sdk.md)) and the keyless HTTP API under
`/api/burnticker/v1` ([api.md](api.md), OpenAPI at `/api/burnticker/v1/openapi.json`). Public data and unsigned transactions only.
There is no adopt-an-existing-token path: `initialize_token` must be signed by the new mint keypair and the burn pool (the fee PDA)
must be LaunchLab's creator from the first trade. The wizard's routes and the v1 routes share one pipeline
(`src/lib/burnticker/api/handlers.ts`), so a refusal, a hash or a fee can never differ between them.

## 4. How to add a source

Append an entry to `config/burnticker/sources.json` (see the 34 there; four are cross-read-only): id, kind `attested-http`, tier, title, source name/URL,
cadence, `pollEverySec`, `request` (url with `{today}` / `{from:N}` / `{yyyymmdd:…}` templates, method, headers, format json|csv|text),
`select` (rows path + `value`, or `count` with weight rules, or a `regex` with named groups, or a `snapshot` path), `period` (kind
day|week|month|quarter, path, format, `dropFirst`, `completeAfterDays`, `zeroFill`), unit/direction/baseline/carry, plausibility
bounds, `memoSource`, a `fixture` fetched once and saved under `config/burnticker/fixtures/http/`, flags, `needsKey`, `launchable`,
`operator` (who runs the endpoint; required, tested) and, when another operator publishes the same number, a shared `fact` (id, scale,
alignment, tolerance) on both entries so each is the other's independent cross-read.
Then add the fixture's expectations to `test/burntickerCatalogue.test.ts`. No code changes. Parameterised sources (wiki.views,
github.stars, steam.players, defillama.tvl, edgar.8k) take the parameter after a colon in the series id.

## 5. How to run the keeper

See `docs/burnticker/deploy.md` (the dedicated Burnticker VPS: units, Caddy, DNS, the host rule) and `docs/burnticker/runbook.md`
(start/stop/pause, key rotation, what to do on each alert, adding a token by hand, verifying a receipt, backups, the go/no-go gates and
the $DEFICIT launch-day sequence). `scripts/burnticker-keeper.mts [--once] [--dry-run] [--alerts]`; `data/PAUSE-burnticker` holds
cranks. The keeper publishes `index.html`, `index.json`, `ops.json` (the morning check's block, for other hosts),
`t/<ticker>/{index.html,status.json,receipts.json,rules.json}`, rewrites `data/own-tokens.generated.json` (the arms' refuse list for
platform coins, merged by `src/lib/ownTokens.ts`) and runs the ops alert check every 5 minutes (`src/lib/burnticker/alerts.ts` → the
registry's `alerts` table, forwarded to the operator's alert channel by `BURNTICKER_ALERT_WEBHOOK`); the audit script publishes `audit.json` and exits
non-zero on any mismatch (the index badge and the trust page show it; the hourly timer runs it).

## 6. Admission rules per tier (§3, extended)

All tiers: official or primary source; machine-readable; timestamped; unambiguous units; not controlled by anyone who can hold the
token; not a disaster; never the token's own price. Elections are allowed (owner, 10-09).

| Tier | What | Admission |
|---|---|---|
| 1 | adjudicated market (Polymarket live; Kalshi not a settlement input since 10-10; Drift BET, Hedgehog stubs) | settled results only; the venue's finalisation window respected (Polymarket: the payout vector on chain); voids = no burn |
| 2 | optimistic assertion (UMA OO v3 stub) | counts only once settled and not disputed-and-lost |
| 3 | primary API attested by a TEE/zk job (Switchboard On-Demand: same URL + selection as tier 4) | third-party asset prices allowed from here up; not wired yet |
| 4 | primary API read by our keeper | no prices of any asset; one real fixture; plausibility bounds; complete periods only |
| 5 | page-scraped | the owner's say-so per source; regex pinned to the markup; never a price; zkTLS candidates |

`usgs.quakes6` is present but flagged disaster-adjacent and not launchable until the owner confirms. Key-required sources (BEA, EIA,
USDA MARS, Census, Congress.gov, YouTube) are present, not launchable, with the key named. ESPN's public scoreboard answered 403 to a
plain client and 200 to a browser UA; it stays not launchable until its terms are checked and an independent cross-read of the same results is configured; until then NFL
results settle only on Polymarket game markets.

## 7. What we refuse (§7 + the owner's list)

Markets about deaths, violence, terror, casualty counts, disasters, named private individuals (`config/burnticker/refuse.json`, applied
to series/market/event titles and categories at create time, whatever the oracle); names that claim to be official; feeds outside
the catalogue; rule changes after launch (impossible by design); mainnet until the program and the adapter are live; third-party price
feeds below tier 3; the token's own price anywhere. Creators who market returns using our pages lose the embed, not the rule. Our bots
refuse every platform coin (`config/own-tokens.json`, enforced in the arms).

## 8. Trust ladder and the operator

Level 1 (now): our data key signs each reading (quorum 1 — operator only; Switchboard On-Demand attester #2 scheduled within 14 days
of the first launch; the trust page shows the due date). Level 2: an independent attester per selector, quorum 2, creator-added
attesters under a 48 h timelock. Level 3: a proof of the API response (zkTLS) or an on-chain settlement the venue publishes.

`/burnticker/trust` renders the Powers Register (a typed placeholder until `docs/burn-receipts/powers-register.json` ships with the
program), the LIVE LaunchLab PlatformConfig decoded from chain next to the designed dials, the developer wallet and its fee ledger from
chain, team wallets and the refuse rule, attesters and quorum, the program id/hash/verify steps, the public audit and the append-only
incident log. Every token page carries "what the operator can and cannot do", derived from the register. The registry is append-only
at the SQL level (triggers refuse rule/identity changes, reading updates and deletes, receipt-fact changes, and any change to a final
receipt). There are no referral codes, fee discounts or hidden parameters in the wizard.

Operated by one independent operator (United States) — contact: contact@burnticker.com (security reports: security@burnticker.com). Use of fees:
"Burnticker's 25 bps funds attesters, hosting, the security reviews and bounty, and the operator. The platform never buys back any
coin, including its own."

**The trust pack (2026-10-10)** — three pages that read only public files and the chain, linked from the trust page:
`/burnticker/check` (where money can go per instruction, who can do what, what is locked, what is not done, the build hashes, and a
receipt verifier that runs in the visitor's browser against the public RPC and the Treasury API — docs/burnticker/CHECK-THIS-YOURSELF.md),
`/burnticker/fees/ledger` (the developer fee wallet from chain by month, and what the fee pays) and `/burnticker/operator` (the
operator, every operator wallet, the signed-statement slot, the never-buys monitor). The verified build is docs/burnticker/VERIFIED-BUILD.md
(interim: a local build that matches the devnet deployment byte for byte; the Docker build is an owner step), the cross-links are
`/.well-known/burnticker.json`, and every placeholder the pack left is on docs/burnticker/TODO-OWNER.md.

### Kalshi on Solana — the level-3 path for Kalshi selectors (research, 10-09; not confirmed from primary sources)

Secondary sources (CNBC, Unchained, Blockhead, Solana Foundation news, QuickNode's guide) report that since 2025-12-02 Kalshi markets
are tokenised on Solana through DFlow's Prediction Markets API: positions are SPL "outcome tokens" minted when liquidity providers fill
intents through DFlow's Concurrent Liquidity Programs, Jupiter was the first DEX integration, and "when markets resolve, winning tokens
can be redeemed for stablecoins" with DFlow "monitoring Kalshi oracle resolution mechanisms and enabling on-chain redemption". What
this build could NOT confirm from a primary source: a program id, an account layout carrying a per-market resolved outcome, or a
redemption instruction a third party can read — DFlow's documentation host (`docs.dflow.net`) did not resolve and `pond.dflow.net`'s
page returned 404 at the time of writing. So: no on-chain Kalshi adapter is claimed. The sketch, if it exists as described: a
`ResolutionSource` of kind `market`, tier 1, whose `settledSince` reads the market's resolution account (program id + PDA seeds from
DFlow's docs), and whose on-chain settlement the Receipts program could verify by CPI/account read instead of trusting our API reading.
Open item: read DFlow's docs when reachable and the program on an explorer; until then Kalshi stays an API-read tier-1 source. (Moot since 10-10: Kalshi is not a settlement input at all.)

Sources: [Unchained](https://unchainedcrypto.com/kalshi-powered-tokenized-prediction-markets-go-live-on-solana/),
[CNBC](https://www.cnbc.com/2025/12/01/kalshi-makes-move-to-court-crypto-traders-with-tokenized-betting-contracts.html),
[Blockhead](https://www.blockhead.co/2025/12/02/kalshi-launches-tokenized-prediction-markets-on-solana-through-dflow-integration/),
[Solana news](https://solana.com/news/dflow-prediction-markets-api), [QuickNode guide](https://www.quicknode.com/guides/solana-development/3rd-party-integrations/kalshi-prediction-markets-with-dflow).

## 9. Owner decisions baked in (2026-10-09)

Developer slice 25 bps of curve volume via the platform slot to `BURNTICKER_FEE_WALLET`; creators earn no cash from fees (creator-fee
slot → burn pool, 100 %, 50 bps cap); LP burned 100 % at graduation (developer post-graduation take 0; burn pool gets Raydium's fixed
4.75 bps/SOL CPMM creator fee); no team allocation; pre-audit cap 25 SOL per burn pool with the excess queued ("released after audit";
keeper-enforced today, program-enforced later — that seam is open); refuse list as above with elections allowed; anonymous creators
allowed, wallet always shown; one-shot markets allowed; hosting on one VPS behind Caddy.

## 10. Open items / stubbed pending other work

- The Receipts program (`burn_receipts`): `BurnProgramClient` has the real `ProgramBurnClient` (`programClient.ts`, over the keeper
  adapter) and `FakeBurnProgram` for tests and pages before a deployment; the program is not deployed on any public cluster.
  **Memos:** the program itself writes the v1 (vault) / v2 (buyback) memo on chain, in the same instruction as the burn (Memo program
  CPI; prefix = the ticker, `src=burnticker <selector>`, `prev`/`now` = the unit counter). The platform's v3 `BT|…` receipt format
  (`receipt.ts`) is off-chain only: built, published and parsed by the platform and the SDK, never written on chain by the program.
- LaunchLab: `FakeLaunchLab` in the app; `SdkLaunchLab` wraps the merged builders but needs decoded configs from an RPC (not wired in
  the route). Mainnet launch refused outright.
- Kalshi terms reviewed (10-10): the Developer Agreement and Data Terms forbid settling products on Kalshi data and caching or
  redistributing it, so Kalshi is not a settlement input; the creation preflight refuses every Kalshi rule. Coins already launched on a
  Kalshi rule keep their disclosure (`EVENT_CONTRACT_DISCLOSURE`); whether the keeper keeps reading them is the owner's call
  (`docs/burnticker/ui-conventions.md`).
- One-shot election fixture: Kalshi's public `/markets` returned no settled markets for the one-off election events probed on 10-09
  (the Portugal event record is saved; the one-shot path is tested on a real settled NFL market).
- Polymarket is live (10-10, see "Polymarket" below). UMA, Drift BET, Hedgehog: interfaces, decoders and fixtures only; `launchable: false`.
- Polymarket open items: the reportPayouts transaction hash is not recorded (no keyless Polygon RPC reachable on 10-10 serves
  eth_getLogs; the proof is the condition id + payout vector + the block of the read); Gamma's terms of use on redistribution are
  unchecked; scalar Polymarket markets and Polymarket team coins / matchups are v2.
- Tier 3 (Switchboard On-Demand) and zkTLS: not wired; the config carries the same URL + selection a job would attest.
- String-valued charts (Billboard, Spotify) need a "changed vs previous" binary mode (v2).
- Fee ledger and live platform config need `BURNTICKER_RPC_URL` on the host; without it the trust page says so.

- Public API / SDK (10-09): the rate limiter is in memory (one app process); a launch bundle's DRAFT reserves its ticker for 24 h
  (registry `DRAFT_TTL_MS`; then `expired`, final by SQL trigger, ticker released — closes the squatting risk); `@burnticker/sdk` is built
  (`packages/burnticker-sdk/scripts/build.mjs`) but not published, and its license is the owner's call (`UNLICENSED` until then);
  the API's host name is the Caddyfile's `burnticker.com` placeholder.

## 11. Acceptance criteria (§9) — checklist

- [ ] every receipt on $DEFICIT green for 14 days
- [ ] program tests green on localnet; deployed and exercised on devnet with 3 tokens
- [ ] crank from a second, unrelated machine works
- [ ] no withdraw path (reviewed by someone other than the author)
- [ ] multisig holds the upgrade authority
- [ ] the create wizard produces a working token end to end on devnet in under 10 minutes (the wizard runs end to end on the fakes today)
- [x] the token page recomputes every burn from source (buildReceiptsJson; the audit script does it for every token and exits non-zero on a mismatch)
- [ ] refuse-list live in all arms (`config/own-tokens.json` is referenced; the arms' entry filters must read it)
- [x] rules, readings and receipts append-only (SQL triggers; tests)
- [x] settled results only, prices display-only (tests on real fixtures)
- [ ] Switchboard attester #2 within 14 days of first launch
- [x] Kalshi terms of use reviewed (10-10: no settlement use, no caching or redistribution → Kalshi is not a settlement input)
- [x] **17 — settlement coverage** (the review question is item 17 of [reviews/checklist.md](reviews/checklist.md), pre-registered and
  not edited here): no category of `config/burnticker/categories.json` is uncovered under the offline fixtures (the CI
  gate in `test/burntickerCoverage.test.ts`; `scripts/burnticker-coverage-audit.mts` exits non-zero otherwise), and creation is refused
  when the selector's preflight fails (`BURNTICKER_PREFLIGHT_STRICT`, default on)
  - [ ] every category settleable on a primary pair (`--require-primary`): 2 of 11 today (Economics, Crypto & On-chain); Sports,
    Financial markets, Weather & Climate and World have no first-party source at all ([SETTLEMENT-COVERAGE.md](SETTLEMENT-COVERAGE.md))
