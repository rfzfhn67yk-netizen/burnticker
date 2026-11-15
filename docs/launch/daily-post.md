# The daily post — $DEFICIT and @burnticker (canonical formats, 2026-10-09)

The owner's brief: "come up with a daily post for updates we can post on the website and twitter" and "make sure posts don't violate
that rule". The rule: **every post is a report.** No price talk, no promises, no calls to buy, no "coming soon", no hype
punctuation. Nothing freehand: every post is printed by `scripts/burnkeeper-post-draft.mts` from the keeper's own published files,
linted against `config/launch/copy-lint.json`, and approved by the owner before it goes anywhere. Nothing posts itself.

```
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/alias-hook.mjs scripts/burnkeeper-post-draft.mts --auto --site=https://<site>
```

`--auto` picks the format from the day's state (below). `--template=daily|noburn|weekly|platform|incident|receipt|scoreboard` forces
one (`receipt` and `scoreboard` are the two @BurnTicker formats, §(g) and §(h); they replace the old B1 cross-post). The website's
§2 "Today" card (`site/deficit/index.html#today`) renders the burn-day / no-burn text from the same `status.json` + `burns.json` with a
JavaScript mirror of the same function; `test/dailyPost.test.ts` pins the two outputs equal, so the page and the post are the same words.

## Where the numbers come from

| Field | Source | Never |
|---|---|---|
| Receipt # | the row's 1-based position in `burns.json` (skipped days are receipts too) | a counter kept by hand |
| Debt to the Penny | `row.now`, whole dollars; change `row.delta`; `row.carryIn` when > 0 | a number read off a chart |
| units → burned | `row.units`, `row.burned` (what the swap delivered and the burn destroyed), `row.spent` | the planned figure |
| Supply | `status.supply.initial` − every `burned` through that row | a chain read at post time |
| Receipt / verify | `row.txUrl`; `<site>/#r-<n>` (the row's anchor on the receipts table) | an explorer search |
| Pool, spent, fees | `status.buyback.*`; creator fees into the burn pool ≈ pool-before-spend differences between receipts; platform fee (developer) from `status.platformFeeSol` or "not published" | the wallet's balance typed in |
| Platform | `index.json` (coins, totals, audit) + `t/<ticker>/receipts.json` (today's lines) | a tally kept elsewhere |

## The day's state (`--auto`)

On Treasury's clock (America/New_York), business day B's figure is posted the next business day P in the afternoon. The picker:

| Day | State | Format |
|---|---|---|
| Sunday (owner's clock, America/Denver) | — | **weekly** |
| Saturday / Sunday / federal holiday (observed) | `weekend` / `holiday` | **noburn**, with the next posting day |
| business day, `burns.json` has the row for B = previous business day | `burn` | **daily** |
| business day, `status.feed.lastRecordDate` ≥ B but no row | `no-unit` | **noburn**: the figure did not add a full $1B |
| business day before 20:30 ET, no figure for B yet | `pending` | **noburn**: not posted yet, keeper checks at 16:30 and 20:00 ET |
| business day after 20:30 ET, no figure for B | `late` | **noburn**: not posted by 20:30; the keeper keeps checking hourly |

The incident format is never auto-picked; the owner fills it (`--what --affects --action --status`) and the lint still runs on the result.

## (a) BURN DAY — `daily`

Six lines: receipt number and record date · the Treasury figure with its change (and the carried remainder when there is one) · units
→ tokens bought back and burned (SOL spent) · supply after the burn · the receipt link and the verify anchor · the disclaimer.
Filled from the sample (`--dir=site/deficit/sample --date=2026-10-08`):

```text
Receipt #235 · 2026-10-08
Debt to the Penny: $40,305,316,210,829 (+$21.28B · +$0.59B carried)
21 units → 146,702 $DEFICIT bought back and burned (0.7335 SOL)
Supply now 935,479,891
Receipt: {TX} · verify: {SITE_URL}/#r-235
a memecoin — the rule says what supply does, not what price does
```

The first receipt of the series, for contrast (`--date=2025-01-06`):

```text
Receipt #1 · 2025-01-06
Debt to the Penny: $36,171,792,705,159 (+$7.65B)
7 units → 179,790 $DEFICIT bought back and burned (0.8990 SOL)
Supply now 999,820,210
Receipt: {TX} · verify: {SITE_URL}/#r-1
a memecoin — the rule says what supply does, not what price does
```

A day with units whose spend fell under the $1 floor (`status: "skipped"`) keeps the frame and says so:

```text
Receipt #235 · 2026-10-08
Debt to the Penny: $40,305,316,210,829 (+$21.28B · +$0.59B carried)
21 units, but the day's spend would have been under $1 — nothing bought; the pool keeps it for the next burn day
Supply unchanged at 935,626,593
verify: {SITE_URL}/#r-235
a memecoin — the rule says what supply does, not what price does
```

Length: ≈ 290–315 characters with two links (X counts each as 23). That is a Premium long post or a two-post thread; the 280-fitting
one-liner remains `--template=T1` (docs/launch/x-threads.md §3). The script prints the X length on every draft.

## (b) NO-BURN DAY — `noburn`

Why there is no receipt, factually, then the last receipt so the post still reports something checkable, then supply and pool.

Weekend (`--reason=weekend`, Saturday 2026-10-10; Monday 10-12 is Columbus Day, so Friday's figure posts Tuesday):

```text
No burn today, 2026-10-10 (Saturday)
Treasury does not post Debt to the Penny on a Saturday. The next figure is 2026-10-09's, posted Tuesday afternoon ET.
Last receipt: #235 · 2026-10-08 · +$21.28B → 21 units → 146,702 $DEFICIT burned
Supply 935,479,891 · fee pool 0.3788 SOL
verify: {SITE_URL}/#receipts
a memecoin — the rule says what supply does, not what price does
```

Federal holiday (`--reason=holiday`):

```text
No burn today, 2026-10-12 (Columbus Day)
Treasury does not post Debt to the Penny on Columbus Day. The next figure is 2026-10-09's, posted Tuesday afternoon ET.
Last receipt: #235 · 2026-10-08 · +$21.28B → 21 units → 146,702 $DEFICIT burned
Supply 935,479,891 · fee pool 0.3788 SOL
verify: {SITE_URL}/#receipts
a memecoin — the rule says what supply does, not what price does
```

The debt did not add a full $1B (`--reason=no-unit`; the feed read the day, the rule counted nothing — a fall, a flat day, or a rise
under $1B whose remainder carries):

```text
No burn today, 2026-10-13 (figure for 2026-10-09)
Treasury's figure for 2026-10-09 did not add a full $1,000,000,000 over the previous reading, so the rule counted nothing. A rise under $1B carries into the next consecutive rise; a flat or down day resets the remainder to zero.
Last receipt: #235 · 2026-10-08 · +$21.28B → 21 units → 146,702 $DEFICIT burned
Supply 935,479,891 · fee pool 0.3788 SOL
verify: {SITE_URL}/#receipts
a memecoin — the rule says what supply does, not what price does
```

Feed not posted yet (`--reason=pending`, before 20:30 ET) — and `late` after 20:30 ET with "was not posted by 20:30 ET; the keeper
keeps checking hourly and reads it, with the day's units, when it appears":

```text
No burn today, 2026-10-13 (figure for 2026-10-09)
Treasury's figure for 2026-10-09 is not posted yet (it usually appears mid-afternoon ET); the keeper reads the feed at 16:30 and 20:00 ET. Last reading on file: 2026-10-08.
Last receipt: #235 · 2026-10-08 · +$21.28B → 21 units → 146,702 $DEFICIT burned
Supply 935,479,891 · fee pool 0.3788 SOL
verify: {SITE_URL}/#receipts
a memecoin — the rule says what supply does, not what price does
```

The no-burn post is optional on X (a weekend post every weekend is noise); the website shows it every day regardless.

## (c) WEEKLY ROLL-UP — `weekly` (Sunday)

The week Mon → Sun of record dates: one line per burn day, totals, the biggest day, supply, the pool, SOL spent, and two fee figures
reported **separately**, because they are two different slots (docs/burnkeeper/fees.md: on the curve Raydium 25 / Burnticker 25 /
burn pool 50 bps; after graduation the developer takes 0):

- **creator fees into the burn pool** — the creator slot (50 bps) pays the token's burn pool; derived from the receipts (each row
  records the pool before its spend, so inflow between receipts is `pool_i − (pool_{i−1} − spent_{i−1})`), marked ≈ and pointed at
  the fee wallet for the exact record;
- **platform fee, to the developer** — the LaunchLab platform slot (25 bps of curve volume) goes to the platform fee vault, claimed by
  `BURNTICKER_FEE_WALLET`; printed from `status.platformFeeSol.week` (and `.total`) when the keeper publishes it (it reads the vault's
  balance and claims when `BURNTICKER_RPC_URL` is set), otherwise the line says `not published`. The developer's fee is never folded
  into the burn-pool figure and never left unsaid.

```text
Week 2026-10-05 → 2026-10-11 on the debt tape
2026-10-05 +$6.66B → 6u → 106,273 burned
2026-10-06 +$23.92B → 24u → 279,592 burned
2026-10-07 +$11.01B → 11u → 92,839 burned
2026-10-08 +$21.28B → 21u → 146,702 burned
Burn days 4 · units 62 · bought back and burned 625,406 $DEFICIT
Biggest day: 2026-10-06, +$23.92B → 24 units → 279,592 burned
Supply now 935,479,891 (6.45% burned since launch, 235 receipts)
Fee pool 0.3788 SOL · spent this week 3.1270 SOL · creator fees into the burn pool this week ≈ 3.5000 SOL (from the receipts' pool-before-spend; the fee wallet's transfers are the exact record)
Platform fee (25 bps of curve volume, to the developer) this week: not published
Every line has a receipt: {SITE_URL}/#receipts
a memecoin — the rule says what supply does, not what price does
```

A week with no burn day says `No burn day this week: no business-day figure added a full $1B.` in place of the lines. With the
platform fee published the line reads `Platform fee (25 bps of curve volume, to the developer) this week: 0.4100 SOL · 2.1000 SOL in all`.

## (d) PLATFORM DAILY — `platform` (@burnticker)

From the platform's `index.json` and each token's `receipts.json` (`--platform-dir`, default `BURNTICKER_PUBLISH_DIR` or
`data/burnticker-site`): coins live, burns on the tape today and all-time, today's lines (one per receipt: ticker — event + period,
units → burned, or "nothing bought" with the reason), new launches by `launchedAt` with ticker + event + source id, the public audit
badge, the platform disclaimer. Example with two coins (the test's fixture; the second launched that day and read one flare point
whose spend was under the floor):

```text
Burnticker · 2026-10-09
Coins live: 2 · burns on the tape today: 1 (all-time 235) · tokens burned all-time: 64,520,109
Today:
$DEFICIT — U.S. national debt (Debt to the Penny) 2026-10-08, 21 units → 146,702 burned
$FLARE — Solar flares (NOAA SWPC, GOES X-ray) 2026-10-09, 1 unit, nothing bought (spend 0.0002 SOL < $1)
New launches: $FLARE — Solar flares (NOAA SWPC, GOES X-ray) (noaa.flares)
Audit: all 236 receipts recompute (source + chain) · ran 2026-10-09 21:00Z
Memecoins: the rule says what supply does, not what price does. {SITE_URL}
```

The same text is the "Today" block on the platform index page; each token page carries its own one-token version (`tokenDayText`).

## (e) INCIDENT — `incident`

Never auto-picked. The frame is fixed; the owner supplies the facts, and the lint runs on them like any other draft (so "we will fix
it soon" is refused — write what was done and what the state is).

```
--template=incident --what="the keeper's RPC timed out for 40 minutes" --affects="receipt 2026-10-08 confirmed 41 minutes late" \
  --action="switched to the backup RPC; the receipt confirmed and verified" --status="fixed at 15:12 Denver" [--not-affected=…] [--at=ISO]
```

```text
Incident · 2026-10-09 15:12 Denver (2026-10-09 21:12 UTC)
What happened: the keeper's RPC timed out for 40 minutes
Affected: receipt 2026-10-08 confirmed 41 minutes late
Not affected: holders' balances, the rule and its hash, every receipt already confirmed
What we did: switched to the backup RPC; the receipt confirmed and verified
Status: fixed at 15:12 Denver
Any correction posts in this thread with the receipt that shows it.
```

Rules for incidents (x-burnticker-profile.md § Voice rules): correct in public, in the same thread, with the receipt. If a receipt's
check on the page is `!`, nothing about that receipt posts until the page is green; then the correction posts with the receipt.

## (g) RECEIPT — `receipt` (@BurnTicker, one post per burn)

The receipt is the product, so the account posts one per confirmed burn: plain and numeric, nothing else. From the token's own
`t/<ticker>/status.json` + `receipts.json` under `--platform-dir`; the latest confirmed burn, or `--event=<eventId>`, or every burn
settled on `--date`. A skipped, void or planned row has no receipt post (the script refuses). `receiptPostText` in
`src/lib/launch/dailyPost.ts`.

```
--template=receipt --platform-dir=test/fixtures/burnticker-season --ticker=RAYS --site=https://burnticker.com
```

```text
Receipt #5 · $RAYS · 2026-10-09
NYY 5 @ TB 2 · reading 1 (espn-final+mlb)
1 unit → 40,973 $RAYS burned · 0.0041 SOL spent
Supply 975,900,000 (2.41% burned · 5 receipts)
tx https://solscan.io/tx/5QmRays · page https://burnticker.com/t/RAYS/
a memecoin — supply, not price.
```

## (h) SCOREBOARD — `scoreboard` (@BurnTicker, one league, one season)

A season is a scoreboard of burns — one per league, never a ranking across leagues. From `index.json` and each token's
`receipts.json`: the league's live team coins (an ESPN team or game selector), how many burned on `--date` (default: the day before
`--now`, UTC — "yesterday" for a morning post), and the top `--top` (default 3) ranked by receipts, then by share of supply burned.
During a season the leader is marked "most receipts so far"; "champion" appears only with `--season-over`, inside its league
(a tie says so). The season label defaults to the league's calendar (`seasonLabel`: NHL/NBA "2026–27", NFL "2026", MLB "2026" or
"2026 postseason" in October and November); `--season=…` overrides it. A league whose coins have no receipt yet says "No receipts this
season so far." Without `--league` the script prints one post per league (NHL, MLB, NBA, NFL order), then the only cross-league line
allowed — a count: `Yesterday (Oct 9) across all leagues: 4 team coins burned.` `--site` appends the link (24 of the 280 characters).
`scoreboardText` / `allLeaguesLine` in `src/lib/launch/dailyPost.ts`.

```
--template=scoreboard --platform-dir=test/fixtures/burnticker-season --league=NHL --now=2026-10-10T14:00:00Z
```

```text
NHL 2026–27 · Oct 9 · 4 team coins · 2 burned yesterday
1. $OILERS 2 receipts, 0.98% burned · most receipts so far
2. $BRUINS 1 receipt, 0.51% burned
3. $FLAMES 1 receipt, 0.49% burned
Receipt counts — nothing is won. Memecoins — supply, not price.
```

`test/copyLint.test.ts` runs both commands above and requires the two examples to equal the script's output.

## Lint

`config/launch/copy-lint.json` holds the forbidden list by category, each with the reference it enforces, and the allowed exceptions.
`scripts/burnkeeper-post-draft.mts lint "<text>" | lint <file> | lint -` prints every hit as `line N: "<phrase>" — <category> (rule
<id>) · <reference>` and exits 3; every template output is linted before it is printed and a hit refuses the print.

| Category | Catches | Reference |
|---|---|---|
| price-returns | the token's price in any form, multipliers, highs, valuation words, direction words, "to the …", return and yield words, "will go" | x-burnticker-profile.md § Voice rules; SPEC §9.2 |
| promises | the future tense aimed at outcomes, "soon" / "coming" / "stay tuned" / announcements, guarantees, absolutes | x-burnticker-profile.md § Voice rules; x-threads.md header |
| calls-to-buy | any verb that tells the reader to acquire the coin | x-burnticker-profile.md § Voice rules |
| urgency | deadlines, "last chance", countdown language | x-burnticker-profile.md § Voice rules |
| hype-punctuation | three or more exclamation marks on a line; the rocket / fire / moon / money / chart / gem emoji | this file |

Allowed, because they are mechanics or data: the disclaimer sentences (they say "price" to say we never talk about it); "Debt to the
Penny"; the rule's $1 spend floor and the `floor()` function; dollar figures; "buyback" / "bought back" / "buys itself back"; venue
names such as pump.fun; "Treasury posts …" as a statement of Treasury's schedule. The masking hides only the allowed span: a forbidden
word beside it is still caught (`test/copyLint.test.ts`).

What the lint does not do: judge tone. A post can pass the lint and still be a bad post; the owner reads every draft.

## Checklist before any post goes out (owner)

1. The draft came out of the script (`# draft · …` header present). Numbers are never retyped.
2. The receipt's check on the page is ✓. If `!`, post nothing about it until the page is green.
3. The lint passed (the script refused otherwise). The X length note is read: over 280 means Premium or a thread.
4. Links point at our pages, explorers or Treasury — never at a third-party "call".
5. The website's Today card shows the same words (it does, by construction; look anyway).
