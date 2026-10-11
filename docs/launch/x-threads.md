# X threads and post templates — $DEFICIT and Burnticker (drafts, 2026-10-09; Burnticker re-cut 2026-10-10 night)

Drafts only. Nothing posts itself. Each post is written to fit 280 characters without links counted (X counts a link as 23);
the character count is noted where it is close. Placeholders are in `ALL_CAPS_BRACES`. The memecoin disclaimer sits on every post
that describes the mechanic and on the last post of every thread.

Words that do not appear anywhere below, by rule: guaranteed, moon, pump, 100x, early, target, "will go", "don't miss" — and, since
2026-10-10, nothing that reads as a prize: nothing is ever won, things are only burned (the `no-prizes` lint category).

Burnticker's one sentence, everywhere: **"Coins that burn on real-world results — with receipts."** Sub-line: **"Launch one. Follow
the season."** Sports examples rotate across leagues (Rays, Lakers, Oilers, Eagles) and no list of leagues starts with the NFL.

---

## 1. $DEFICIT launch thread (@USA_DEFICIT, 8 posts)

**1/8 — the rule**
> $DEFICIT is a Solana memecoin with one rule: every full $1,000,000,000 the U.S. national debt rises, the token buys itself back with its own trading fees and burns what it bought.
>
> The source is Treasury's "Debt to the Penny". Every burn has a receipt on chain. 🧵

**2/8 — why debt**
> Why the debt? Because it is the one number everyone argues about and nobody can touch. Treasury posts it every business day; it is public, timestamped, official, and no holder of this coin can move it.
>
> A rule should be indexed to something nobody in the room controls.

**3/8 — how a burn day works**
> Each business day the keeper reads Treasury's figure, subtracts yesterday's, and counts full $1B steps — the units. Sub-$1B remainders carry across consecutive rises; a flat or down day counts nothing and resets them.
>
> 21 units on 2026-10-08: the debt rose $21.28B.

**4/8 — who pays for it**
> Nobody mints, nobody donates. Every trade pays the venue's creator fee into the keeper's fee pool. On a day with units the pool spends 1 − 0.98^units buying $DEFICIT at market and burns every token received.
>
> No trading, small burns. Fees fund burns, nothing else.

**5/8 — how a burn is verified**
> The burn transaction carries a memo: date, source, prev, now, delta, units, pool, spent, got, burned, the swap signature, the rule hash.
>
> Fetch the two Treasury rows with one curl, do the subtraction, compare. If chain, memo and Treasury agree, the receipt is good. {VERIFY_URL}

**6/8 — what it is NOT**
> What $DEFICIT is not: not a product, not a share of anything, not a promise. Burning supply does not make a price go up and nobody here says it will.
>
> A memecoin: the rule says what supply does, not what price does.

**7/8 — what the rule would have done**
> Replayed over the real Treasury series, 2025-01 → 2026-10: 235 burn days, 6,490 units. Biggest: 2025-07-07, +$366B in one day, the day after the ceiling rose.
>
> A replay of what the rule counts — not a forecast of anything.

**8/8 — links**
> Rules, receipts, the live debt curve and the verify-it-yourself block: {SITE_URL}
> Rule file + sha256: {SITE_URL}/rules.json
> Launched on @BurnTicker — coins that burn on real-world results, with receipts.
>
> A memecoin. The rule says what supply does, not what price does. Not advice.

---

## 2. Burnticker announcement thread (@BurnTicker, 6 posts; re-cut 2026-10-10 night)

Every post below passes the copy lint (test/burntickerCopy.test.ts lints this section post by post).

**1/6 — the sentence**
> Coins that burn on real-world results — with receipts.
>
> Launch one. Follow the season. 🧵

**2/6 — the engine**
> Launch: write the result in one sentence — "Rays lose", "Denver high above 90", "US debt rises $1B" — set the dial (1–10% of the coin's fee pool per burn) and lock the rule.
>
> The rule is hashed at launch. It is enforced by a program, not a promise.

**3/6 — the receipt**
> When the result settles on a primary source and a second publisher agrees, the reading is signed on chain and the program spends the coin's own fees buying it at market and burning what it bought.
>
> The memo on that transaction is the receipt: reading, units, spent, burned, rule hash.

**4/6 — the show**
> Follow the season: team coins across MLB, NBA, NHL and NFL, scored in receipts. Rivalries keep a running tally of burns.
>
> Nothing is ever won here. Things are only burned. One scoreboard per league; when its season ends, the coin with the most receipts is its champion: a stat, not a prize.

**5/6 — the guardrails**
> Settled on primary sources · signed readings (one attester at launch; second attester scheduled, not live) · program-run burns · receipts anyone can recompute · open source · three blind AI reviews, not a firm audit · creators earn nothing · no team buy · the platform never buys any coin · LP locked forever, its fees fund the burn · rules locked at launch.

**6/6 — the first coin, and the line**
> First coin: $DEFICIT (@USA_DEFICIT) — every $1B the U.S. national debt rises, it buys itself back with its own fees and burns it.
>
> Memecoins: the rule says what supply does, not what price does. Not advice. {SITE_URL}

---

## 2b. Rivalry pair announcement thread (@burnticker, 5 posts; added 2026-10-10)

One thread per pair, posted after both bundles have landed. Placeholders: `{TICKER_A}`, `{TICKER_B}`, `{SERIES}` (the source, e.g.
ESPN scoreboard), `{MATCHUP}` (e.g. Oilers–Flames, one game), `{OUTCOME_A}` / `{OUTCOME_B}` (e.g. an Edmonton loss / a Calgary loss;
for a scalar pair, e.g. each full 10 points down / up), `{PCT}` (the fraction of the pool per burn), `{PAIR_ID}`, `{SITE_URL}`. The running
score after launch is `pairDailyText()` (src/lib/launch/dailyPost.ts: "$A 3 : 1 $B — every loss burns"), never retyped. Every post
below passes the copy lint (test/dailyPost.test.ts lints this section).

**1/5 — the matchup**
> ${TICKER_A} vs ${TICKER_B}: two memecoins on one event, {SERIES} ({MATCHUP}) — settled on the primary source.
>
> When a side loses, its coin burns. Every settlement burns exactly one side, and the receipts keep score. 🧵

**2/5 — the two rules**
> ${TICKER_A} burns on {OUTCOME_A}. ${TICKER_B} burns on {OUTCOME_B}.
>
> Each burn spends {PCT}% of that coin's own fee pool buying it at market and burns everything bought. A void or a tie burns neither.

**3/5 — locked**
> Two rules, two hashes, one pair id in both. Side B's rule is side A's inverted and names side A's mint. Both are locked at launch; nobody can change either.
>
> Rule files: {SITE_URL}/t/{TICKER_A}/rules.json and {SITE_URL}/t/{TICKER_B}/rules.json

**4/5 — same terms**
> Same terms on both sides: one fee split, each coin with its own burn pool, LP locked forever at graduation (its fees fund the burn), no creator cash from fees, no team allocation.
>
> Neither pool can pay the other side. Anyone can deposit into either; nobody can withdraw.

**5/5 — the scoreboard**
> The pair page is the scoreboard: burns A : B, supply A : B, the last settlement with its result, the next scheduled result, both receipts tables.
>
> {SITE_URL}/p/{PAIR_ID}/
> Two memecoins: each rule says what its supply does, not what price does. Not advice.

---

## 2c. The two @BurnTicker formats — receipts and scoreboards (added 2026-10-10 night)

@BurnTicker posts two visibly different formats and nothing else of its own. Both are filled from the platform's published files
(each coin's status.json + receipts.json; the platform's index.json), never retyped, and both pass the copy lint.
`test/burntickerCopy.test.ts` renders them on the sample in `test/burntickerCopyFixture.ts` and requires the filled examples below
to equal the output, character for character.

**Receipts** — `receiptPostText(status, receipts, receipt, site)` in `src/lib/launch/dailyPost.ts`. One post per confirmed burn
(anything else throws). Plain and numeric:

| Line | Source |
|---|---|
| `Receipt #{N} · ${TICKER} · {DAY}` | the receipt's position in receipts.json, the ticker, the settled day |
| `{EVENT} · reading {VALUE}` or `· settled {RESULT}` `({METHOD})` | the receipt's title, value or result, and the source + cross-read method |
| `{UNITS} unit(s) → {BURNED} ${TICKER} burned · {SPENT} SOL spent` | units, burned, spent |
| `Supply {SUPPLY} ({PCT}% burned · {COUNT} receipts)` | status.json supply and burned |
| `tx {TX} · page {SITE}/t/{TICKER}/` | the burn transaction and the coin's page |
| `a memecoin — supply, not price.` | the short disclaimer |

```text
Receipt #5 · $RAYS · 2026-10-09
NYY 5 @ TB 2 · reading 1 (espn-final+mlb)
1 unit → 40,973 $RAYS burned · 0.0041 SOL spent
Supply 975,900,000 (2.41% burned · 5 receipts)
tx https://solscan.io/tx/5QmRays · page https://burnticker.com/t/RAYS/
a memecoin — supply, not price.
```

**Scoreboards** — `scoreboardText({ index, receiptsByTicker, league, season, day, seasonOver, top, site })`. One league, one season
per post — never a ranking across leagues. The header names the league and season, the day, the league's live team coins and how many
burned yesterday; the ranked lines (default 3) order them by receipts, then by share of supply burned. During the season the leader is
"most receipts so far"; "champion" appears only after the season ends (`seasonOver`). Across leagues only a count is posted
(`allLeaguesLine`: "Yesterday (Oct 9) across all leagues: 4 team coins burned."). The link is optional (24 of the 280 characters).

```text
NHL 2026–27 · Oct 9 · 4 team coins · 2 burned yesterday
1. $OILERS 2 receipts, 0.98% burned · most receipts so far
2. $BRUINS 1 receipt, 0.51% burned
3. $FLAMES 1 receipt, 0.49% burned
Receipt counts — nothing is won. Memecoins — supply, not price.
```

The receipt format replaces B1 (§3) for @BurnTicker; the draft script prints both formats (`--template=receipt`, `--template=scoreboard`; docs/launch/daily-post.md §(g), §(h)). The rivalry post (`pairDailyText`, §2b) stays the format for a pair's own
running score.

---

## 3. Evergreen post templates (auto-fillable from a receipt row)

Fields come from one `BurnJson` row in the keeper's `burns.json` (schema `burnkeeper.status/v1`) and from `status.json`.
`scripts/burnkeeper-post-draft.mts` fills them and prints the text; it never posts. Field map:

| Placeholder | Source |
|---|---|
| `{DATE}` | `recordDate` |
| `{PREV_DATE}` | `prevDate` |
| `{DELTA_B}` | `delta` formatted `+$X.XB` |
| `{NOW_T}` | `now` formatted `$XX.XXXT` |
| `{UNITS}` | `units` |
| `{BURNED}` | `burned` with thousands separators |
| `{SPENT_SOL}` | `spent` (SOL, 4 dp) |
| `{POOL_SOL}` | `pool` (SOL, 4 dp) |
| `{TX}` | `txUrl` (burn transaction) |
| `{SWAP_TX}` | `swapUrl` |
| `{SOURCE}` | `sourceUrl` (the Treasury row) |
| `{TOTAL_BURNED}`, `{PCT}` | `status.burned.total`, `status.burned.pctOfSupply` |
| `{CARRY_B}` | `carryIn` formatted `$X.XXB` (only when > 0) |
| `{SKIPPED_REASON}` | `skippedReason` |

Disclaimer line, abbreviated for space: `a memecoin — supply, not price.` Full form where it fits: `A memecoin: the rule says what
supply does, not what price does.`

**T1 — the daily receipt (default)**
> $DEFICIT burned {BURNED} tokens today: debt {DELTA_B} on {DATE} → {UNITS} units → receipt {TX}
>
> Source row: {SOURCE}
> a memecoin — supply, not price.

**T2 — the daily receipt, with the pool**
> {DATE}: U.S. debt {NOW_T}, {DELTA_B} vs {PREV_DATE} → {UNITS} units.
> Spent {SPENT_SOL} SOL of a {POOL_SOL} SOL fee pool, bought and burned {BURNED} $DEFICIT.
> Burn: {TX}
> Swap: {SWAP_TX}
> a memecoin — supply, not price.

**T3 — a big day (units ≥ 100)**
> Big reading. Treasury posted {DELTA_B} of new debt for {DATE} — {UNITS} units in one day.
> $DEFICIT bought back and burned {BURNED} tokens. Receipt: {TX}
>
> Check it: fetch the {PREV_DATE} and {DATE} rows, subtract, divide by $1B. {SOURCE}
> a memecoin — supply, not price.

**T4 — a quiet day (units 1–3)**
> Small step: {DELTA_B} on {DATE} → {UNITS} unit(s). $DEFICIT burned {BURNED} tokens. Receipt: {TX}
> Same rule on a quiet day as on a loud one. a memecoin — supply, not price.

**T5 — a down or flat day (no burn)**
> No burn for {DATE}: the debt did not rise (change {DELTA_B}). The rule counts nothing on a down day and resets the sub-$1B remainder to zero.
> Source row: {SOURCE}
> That is the whole rule working as written.

**T6 — a carried remainder**
> {DATE}: {DELTA_B} of new debt plus {CARRY_B} carried from the run of rises since {PREV_DATE} → {UNITS} units. $DEFICIT burned {BURNED} tokens.
> Receipt {TX} — the carry is on the page beside the burn. a memecoin — supply, not price.

**T7 — under the floor (skipped)**
> {DATE}: {UNITS} unit(s), but the day's spend would have been under $1 ({SKIPPED_REASON}). Nothing bought; the pool keeps it for the next burn day.
> Rule as written: {SOURCE}

**T8 — running total**
> $DEFICIT so far: {TOTAL_BURNED} tokens bought back and burned, {PCT}% of supply, every one with a receipt.
> Latest: {DATE}, {DELTA_B} → {UNITS} units → {TX}
> a memecoin — supply, not price.

**T9 — verify-it-yourself**
> Verify today's $DEFICIT burn in three steps:
> 1. curl the Treasury rows for {PREV_DATE} and {DATE}: {SOURCE}
> 2. units = floor(({NOW_T} − prev + carry) / $1B) = {UNITS}
> 3. open {TX} and read the memo.
> If they agree, the receipt is good. No trust required.

**T10 — the weekly roll-up** (filled from the week's rows; the script prints one line per burn day)
> This week on the debt tape:
> {DATE} {DELTA_B} → {UNITS}u → {BURNED} burned
> {DATE} {DELTA_B} → {UNITS}u → {BURNED} burned
> …
> Every line has a receipt: {SITE_URL}/#receipts
> a memecoin — supply, not price.

### Burnticker-side evergreen (for @burnticker, one template per coin)

**B1 — retired 2026-10-10.** The cross-post is replaced by the receipt format (§2c): `scripts/burnkeeper-post-draft.mts
--template=receipt --ticker=…` (the script refuses `--template=B1` and says so).

---

## 3b. The daily post and the lint (added 2026-10-09)

The canonical daily formats — burn day, no-burn day, Sunday roll-up, @burnticker platform daily, incident — live in
docs/launch/daily-post.md with filled examples; `scripts/burnkeeper-post-draft.mts --auto` picks today's. Every draft, these and the
T-set above, is linted against config/launch/copy-lint.json before it prints (`… lint "<text>"` lints anything else).

## 4. Checklist before any post goes out (owner)

- Numbers match `burns.json` (the script reads them; do not retype).
- The receipt's check is ✓ on the page. If it is !, post nothing until the page is green; then post the correction with the receipt.
- No price word, no return word, no urgency word. Disclaimer present on mechanics posts.
- Links point at our pages or at explorers / Treasury; never at a third-party "call".
