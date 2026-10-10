# Launchpad UI conventions → Burnticker (2026-10-10)

The owner asked (2026-10-10) for Burnticker to look like the launchpads people already use: *"analyze other successful meme coin
launchpads like Pons, pump.fun, or anything else to try to get close to presenting how those present so it's easier for new users who
may be used to other platforms."* This file has two parts. Part 1 records what each platform shows, with a source for every claim and
the claims we could not check. Part 2 maps each pattern to Burnticker as adopt, adapt or reject, with the reason. The last section lists
what was built.

**How this was checked (2026-10-10).** We read public docs, help centres, App Store listings and articles. We also opened the public
pages read-only, reading their text and accessibility tree, with no account, no wallet and no terms accepted. pump.fun's "Welcome to
Pump.fun!" modal and Raydium's "Disclaimer / Agree to terms" modal were left closed. That hid the coin cards on pump.fun and the grid on
raydium.io. "Observed" below means we saw the element on the live site that day.

## Part 1 — what each platform shows a new user

### pump.fun (Solana)

| Pattern | Finding | Source |
|---|---|---|
| Home | The classic card grid has been replaced by a "Feed" of draggable columns: Trending (Memes / Stocks, 1h–24h; each row shows image, ticker, HOT badge, market cap and % change), Hot callouts (users' P&L posts) and a Leaderboard. | observed, pump.fun |
| Explore | Tabs: Movers, New, Custom pairs, Charities, Market cap, Oldest, Last trade. There is a chain filter, a Filters menu and a grid/table toggle. | observed, pump.fun/explore |
| Search + create | The header has "Search for coins and users… ⌘K" and a **Create** button. Create appears again in the left sidebar. | observed |
| King of the hill | Not found on today's home page. Older guides describe it. | [CoinGecko guide](https://www.coingecko.com/learn/pump-fun-guide-how-to-create-your-own-memecoins) |
| Create, field order | Name → Symbol ("ALL CAPS, 3–6") → Description → Image ("square, ideally 512×512") → Socials (X, Telegram, website; optional). One signature. "No fee to create a coin". Name, symbol and image are fixed after launch. | [pump.fun/docs/create-coin](https://pump.fun/docs/create-coin) |
| Create, extras | "Add social links ↓" toggle, images up to 15 MB, an optional banner, and an optional first buy. | [help centre](https://intercom.help/pumpfun-web/en/articles/11002205-create-a-coin-on-pump-fun) |
| Coin page | Mint with a copy button under the name. Holders ranked by % of supply, with an audit tab flagging dev and top-holder concentration. A trades tab streams buys and sells. Bonding-curve % with "market cap needed to graduate". Socials (with a "You're leaving Pump" warning), similar coins, a chart. | [BloFin academy, 2026-09-23](https://blofin.com/en/academy/education/pumpfun/reading-a-pump-fun-coin-page) |
| Buy panel | Buy / sell with slippage and amount presets. | [CoinGecko guide](https://www.coingecko.com/learn/pump-fun-guide-how-to-create-your-own-memecoins) |
| Mobile | Native app "pump.fun – speculate on trends", tagline "Scroll to win!". The web shows a "Pump is better on mobile" banner. The compact nav in the markup reads Home · Explore · Create · Go. | [App Store](https://apps.apple.com/us/app/pump-fun-speculate-on-trends/id6717572591), observed |
| Graduation | The docs give no number ("the graduation threshold"); the coin migrates to PumpSwap. Fees: create free, curve trades 1.25%, graduation 0.015 SOL. Third parties put graduation at about $69K market cap / about 85 SOL. | [bonding-curve doc](https://pump.fun/docs/bonding-curve), [fees](https://pump.fun/docs/fees), [soltokencreator](https://www.soltokencreator.io/blog/pump-fun-graduation-explained) |

**Could not verify:** the exact preset values (0.1 / 0.5 / 1 SOL), whether the chart is TradingView, the "SOL in the bonding curve"
wording, a live preview on the create page, or the app's tab bar.

### LetsBonk (bonk.fun) and Raydium LaunchLab

| Pattern | Finding | Source |
|---|---|---|
| Home | A "Hot Projects · LIVE" carousel (name, ticker, market cap, progress bar), then a "Featured Coins" grid. Each card: large image, name, `CA: 28FE…bonk` with a copy icon, age ("22d ago"), market cap, "Progress 0.9%" bar, quote badge. | observed, bonk.fun |
| Filters | Sort: Last Trade, Creation Time, Heating Up, Watchlist. Also All / Classic / Bonkers, a "graduated" toggle, a USD1-only toggle, and a search box. | observed |
| Create | bonk.fun/create needs a connected wallet before it shows any fields. A secondary source gives the order name/symbol/description → logo → curve settings → Launch (low confidence). | observed; [BingX](https://bingx.com/en/learn/article/what-is-lets-bonk-fun-launchpad-and-how-to-launch-your-meme-token) |
| Coin page | TradingView chart on the left. Right panel: "Market Cap Progress" bar with current / target, Buy / Sell, slippage (default 5%), amount with Half / Max presets. Below the chart, tabs: Coin Info, Activity, Bubblemap, Top Holders. "About" lists curve and post-migration fees, contract and developer address. | observed |
| Raydium LaunchLab grid | Hot sort, search, Watch list, Graduated, a platforms filter (letsbonk.fun, Bankr, …), and a **"Launch token"** button at the top right. Cards in 3 columns: ticker, name, age, platform icon, description, MC, progress bar. | observed (accessibility tree behind the modal) |
| LaunchLab create | JustSendit (fixed 85 SOL) or LaunchLab (custom raise, at least 24 SOL, vesting). Then name + ticker, optional description and socials, logo, optional initial buy, review, Create. The token page shows % of the curve sold and SOL raised against the target. | [Raydium docs](https://docs.raydium.io/user-flows/creating-a-launchlab-token) |
| Mobile | Responsive web with a hamburger menu; no bottom tab bar. | observed at 375 px |
| Graduation | 85 SOL by default, then a Raydium CPMM pool. We confirmed this on chain: of the LaunchLab pools GeckoTerminal listed on 10-10, the default ones have `total_fund_raising_b` = 85 SOL, and some platforms use 24, 40 or 200 SOL. | Raydium docs; our fixture `config/burnticker/fixtures/launchlab/pools.mainnet.json` |

### Pons (Robinhood Chain) — ponsfamily.com

| Pattern | Finding | Source |
|---|---|---|
| Home | A left icon sidebar (Create a token, Launches, PLP, Analytics). A "Launches" title with a green **"Launch a token"** button at the top right. A Trending carousel. | observed |
| Filters | Tabs: Market cap · New · Active · **Near graduation** · **Graduated** ("Near graduation" = `?stage=curve&sort=progress`). There is a pair filter and a list / grid toggle. Rows show icon, name + ticker, creator, age, pair, a sparkline and market cap, with a Graduation % bar on the near-graduation tab. | observed |
| Create | "Two steps": 1 Identity → 2 Economics. Step 1 runs **Image (square, ≤ 5 MB) → Name (0/32) → Ticker (0/10) → Description (0/256, "No links.") → X / Telegram / Website** → Continue. A **live preview card, "On the board"**, shows supply, "Graduates at 4.20 ETH", creator fee and launch fee. | observed; [docs v2](https://docs.ponsfamily.com/v2) |
| Coin page | Header: name, ticker, creator, age, pair, address with copy, socials. Chart with intervals. "Curve 66% of 4.20 ETH". Stats: market cap, holders, trades, supply. Trades / Holders tabs. Right panel: Market / Limit, Buy / Sell, presets 25 / 50 / 75 / Max, slippage. A graduated coin says "Trades on the Uniswap v4 pool since graduation." | observed |
| Mobile | Responsive web with a top bar; no bottom tab bar. | observed |
| Graduation | 4.2 ETH. | [v1 docs](https://docs.ponsfamily.com/docs) |

### Believe (believe.app)

The site is paused: "This deployment is temporarily paused", and /faqs returned HTTP 402. Until 2025-05-22 a coin launched from a
reply on X ("@launchacoin +name"); after that, launches were reviewed by hand on the site. Graduation was at $100K market cap into a
Meteora pool. Sources: [CoinGecko](https://www.coingecko.com/learn/what-is-believe-token-launchpad),
[The Defiant](https://thedefiant.io/news/defi/believe-launchpad-pauses-some-on-chain-payouts-asks-creators-to-switch-to-paypal).
**Could not verify:** any of its UI.

### Bags (bags.fm)

| Pattern | Finding | Source |
|---|---|---|
| Home | Sidebar: Home, Earn, Trade, Launch, Docs. Header: search, a network selector, **"+ Launch"**. A Trending carousel (ticker, MC, %, volume, holders). The **Pulse** tab has three columns, **New · Soon · Bonded**, each card showing age, TX, volume, MC, "0% bonded" and a quick-buy "⚡1" button. | observed |
| Create | One page. Chain toggle, then **image → name / ticker → description**, fee sharing, custom links, paired asset, dev-buy presets 1 / 3 / 5 / 10 SOL. A **live preview card** shows "Graduates at 100 SOL". | observed |
| Coin page | A stats strip, chart, about + socials, a creator-earnings box, **HOLDERS** (pool labelled), **LIVE TRADES**. Right panel: Buy / Sell, presets 0.01 / 0.1 / 1 / 10, slippage "20% Extra high". | observed |
| Mobile | **A bottom tab bar on mobile web: Home · Search · + (Launch) · Trade · Profile.** There is also a native app. | observed; [App Store](https://apps.apple.com/us/app/bags-trade-coins/id6473196333) |

### Heaven (heaven.xyz)

The site was unreachable on 10-10 (browser failure, SSL error), so **none of its UI could be verified.** Its docs describe no bonding
curve: each pool trades "as though it was seeded with 35 SOL" with a $100K "virtual migration" cap, and a launch tax that falls over 6 s.
Sources: [docs: curve](https://docs.heaven.xyz/curve.md), [docs: fees](https://docs.heaven.xyz/fees.md),
[Smithii](https://smithii.io/en/heaven-new-solana-launchpad/).

### What a new user expects anywhere

1. **Discovery is a grid or list of coin cards** showing image, name / $TICKER, age, market cap and a **graduation progress bar**, with
   tabs that split **new / near graduation / graduated** (bonk.fun, Raydium, Pons, Bags' New/Soon/Bonded, pump.fun's tabs) and a search
   box.
2. **A high-contrast Create / Launch button** in the header or at the top right of the grid. It leads to a short form in the order
   **image → name → ticker → description → socials**. Pons and Bags show a **live preview card**; Bags, Raydium and pump.fun offer an
   optional first buy.
3. **The coin page puts the chart on the left and Buy / Sell on the right**, with amount presets and a visible slippage, the **contract
   address with a copy button**, and **holders + trades tabs** under the chart. Graduated coins say where they trade now.

## Part 2 — the map to Burnticker

The trust rules decide every row. We never talk about price. Market data is shown as data and never feeds a rule. The copy lint
(`config/launch/copy-lint.json`) bans "market cap", "price", "moon", "target", urgency words and calls to buy.

| # | Pattern (who) | Verdict | Burnticker's version, and why |
|---|---|---|---|
| 1 | Coin grid as the home (all) | **adopt** | `/burnticker` is a grid of coin cards: 1 column on a phone, 2 on a tablet, 3 on desktop. |
| 2 | Card: image, name, $TICKER, age (all) | **adopt** | Shown as on bonk.fun. A coin without an image gets a **receipt-paper thumbnail** with its ticker printed on it (our twist, B1 identity). |
| 3 | Card: market cap (all) | **reject** | A price in disguise; the copy lint refuses it. The card shows the **rule's one-liner** in its place ("burns when the Eagles lose"), derived from the locked rule (`coinCard.ts`) so a card can never say more than the rule. |
| 4 | Bonding-curve progress bar (bonk.fun, Raydium, Pons, Bags) | **adapt** | Shown as **SOL raised / graduation threshold** from the LaunchLab pool account, plus a "graduated · trades on Raydium" badge. When the pool is not read on this host the bar is empty and reads "—", with the reason on hover. |
| 5 | Replies / comments count, threads (pump.fun) | **reject** | Comment threads invite price talk; we cannot moderate them under the "no price talk from us" rule. |
| 6 | Holders count (Bags, Pons) | **adapt** | "—" with a tooltip: an exact count needs an indexer over every token account. The **top-20 distribution** (one cheap RPC call) is on the coin page, labelled bonding curve / burn pool / creator. |
| 7 | King of the hill, Trending, Movers, Hot, Heating Up (pump.fun, bonk.fun, Raydium, Pons) | **reject** | Rankings by price or volume are hype devices. The tabs Burnticker keeps are **New · Next to settle · About to graduate · Graduated · Pairs**. "Next to settle" is our twist: it sorts by the next result, not by money. |
| 8 | Near graduation / Graduated tabs (Pons, bonk.fun, Bags) | **adopt** | "About to graduate" lists coins past 50% of the curve; "Graduated" lists coins whose pool status is 2. |
| 9 | Search box (all) | **adopt** | Searches name, $TICKER, the one-liner, the event title and the mint. |
| 10 | Create button top right (Raydium, Pons, Bags, pump.fun) | **adopt** | A violet "Launch a coin" stamp on the Coins page, plus Launch in the header and in the phone tab bar. |
| 11 | Create form order image → name → ticker → description → socials (pump.fun, Pons) | **adopt** | The wizard's create screen uses this order, after the event choice (Team coin / Browse / Matchup / Any market come first: the rule is the coin). Socials are Website / X / Telegram behind "Add social links". |
| 12 | Image upload (pump.fun, Pons, Bags) | **adapt** | An **https link** with a live preview. Burnticker stores no uploads in v1, and a broken image falls back to the receipt thumbnail. |
| 13 | Live preview card (Pons "On the board", Bags) | **adopt** | The right column shows the real `CoinCard`, exactly as it will appear on Coins, starting at 0% of its curve. |
| 14 | Optional first buy (pump.fun, Raydium, Bags) | **adapt** | Kept as a collapsed "Optional first buy" on the review step, with no preset chips. |
| 15 | Dev-buy presets 1 / 3 / 5 / 10 SOL (Bags) | **reject** | Preset buy amounts read as encouragement to buy. |
| 16 | Chart left, trade panel right (bonk.fun, Pons, Bags) | **adopt** (layout) | The two-column coin page. The left side holds the chart: **GeckoTerminal's embed** of the pool that trades now. GeckoTerminal indexes `raydium-launchlab` curves and their CPMM pools, which we checked against its public dex list on 10-10. Mainnet only. Otherwise the chart is **our own chart of settled readings with burn markers**. The **receipts tape** (paper, dashed rules) sits under it (twist). |
| 17 | Buy / sell box with amount presets and slippage (all) | **reject** (as hosted) → **adapt** | Burnticker hosts no swap. The **Trade** panel deep-links to Raydium LaunchLab (on the curve) or the Raydium swap (after graduation), and to Jupiter, for the mint. It has no amounts and no presets. On devnet and for drafts it says why there is no link. |
| 18 | Contract address with copy (all) | **adopt** | Shown in the header ("CA abcd…wxyz" + copy) and again in the Trade panel. |
| 19 | Socials row (all) | **adopt** | The creator's links appear under the name, marked `rel="nofollow noopener ugc"`. |
| 20 | Trades tape (pump.fun, Bags) | **adapt** | The tape is **receipts**, not trades: each burn with its result, units, amount burned, tx, source and a ✓ verified mark. |
| 21 | Holder / trade tabs under the chart | **adapt** | Top holders are a collapsible list in the right panel. There is no trades list (we do not index trades). |
| 22 | Coin info / About (bonk.fun) | **adapt** | The **rule card**: the locked rule in one sentence, the next result (countdown), the last burn, the pool balance, rules.json + sha256, and what the operator can and cannot do. Fees, attesters and addresses follow below. |
| 23 | Graduated note "trades on … since graduation" (Pons) | **adopt** | "The curve completed; the LP was burned 100% at graduation and $X trades on Raydium CPMM." |
| 24 | Bottom tab bar on phones (Bags mobile web, pump.fun app) | **adopt** | **Coins · Launch · Rivalries · Trust** under 900 px, with Launch stamped violet. |
| 25 | Category navigation (Kalshi, Polymarket) | **adapt** | The wizard's **Browse everything**: Burnticker's own taxonomy (`config/burnticker/categories.json`) on a left rail, or chips on a phone. Each category lists source cards from **every venue**: first-party feeds first, then Polymarket, then Kalshi when it is enabled. Each card shows venue, tier, cadence, next event and the "burns when …" example. |
| 26 | Watchlist / favourites, quick-buy ⚡ (bonk.fun, Bags) | **reject** (for now) | Quick-buy is a call to buy. A watchlist needs accounts or local storage and is not a convention new users depend on. |

## Venues — what settles, what only helps you find (10-10)

**Settlement inputs.** A coin settles on a primary source with an independent cross-read of the same fact — another operator on
another domain — or on Polymarket's Conditional Tokens payout vector on Polygon for an adjudicated market. Prediction markets are for
discovery. The coverage gate (`src/lib/burnticker/coverage/`) refuses creation otherwise.

**Kalshi — `BURNTICKER_KALSHI_ENABLED`, default OFF.** Kalshi's Developer Agreement limits API use to a member's own trading and
forbids caching or sharing its data with third parties without written authorization. Its Data Terms forbid using Kalshi Data to
settle products. So Kalshi is never a settlement input and stays behind the flag for an eventual written consent.

Off (the default):
- The `/kalshi/*` routes answer 503.
- Kalshi back-tests and launch bundles are refused.
- The app and the keeper's page publish make no Kalshi display reads (series titles, implied chance).
- The keeper reads Kalshi only for coins already registered with a Kalshi rule, logging a warning per read.
- No default copy names Kalshi.

**Polymarket discovery — `BURNTICKER_POLYMARKET_DISCOVERY_ENABLED`, default ON, NO MARKET DATA.** Polymarket's terms restrict "market
data distributors". Burnticker shows only:
- the question text
- the outcomes (with the outcome's name, Gamma `groupItemTitle`)
- the end date
- the resolution rules
- the condition id

It never shows a price, odds, volume or liquidity, anywhere. `scrubMarketData` drops any such key from every discovery payload as
defence in depth, and `test/burntickerSearch.test.ts` scans the search, elections, browse and Polymarket-search payloads for them.
Off: the Polymarket search, back-test, Browse group, elections flow and search suggestions are withheld. Settlement reads the on-chain
payout regardless.

**Team coins and matchups never depend on a market.** They run on the ESPN scoreboard (`sources/espn.ts`). Each final counts only once
a second read from another operator agrees on the score:
- NHL: the league's own score feed
- MLB: the league's own StatsAPI
- NFL and NBA: TheSportsDB, a second public scoreboard (no keyless league feed exists for either)

The venue badge reads "ESPN scoreboard · first-party".

### FEC — the smallest gate change to propose

The FEC adapter (`sources/fec.ts`) reads receipts per filed report from OpenFEC. Its only second read is the FEC's own `/filings`
endpoint: the same operator, the same domain. The coverage gate's cross-read rule rightly refuses it, so `fec.beats` rules fail
preflight with `no-cross-read`, and the election-pair template lists that as pending rather than weakening the gate.

Proposed change, for the owner: admit a same-operator cross-read only when all of the following hold:
- the primary is a federal or state government agency (`operator` on an allowlist of agencies)
- the cross-read is a different publication channel of the same filing (a different endpoint or the bulk file)
- the cross-read reports the same filing id

Recorded as `sameOperator: true` and named on the card. Nothing in the gate is changed by this branch.

## The 60-second path (the owner's usability test, 10-10)

"If I wanted to add a coin for Abdul El-Sayed to win the Michigan Senate seat…" The launch page now opens on **Describe the event**.

Typing "El-Sayed wins Michigan Senate" answers the card: "Abdul El-Sayed (D) wins the Michigan Senate race · settles 2026-11-04 ·
Polymarket on-chain payout + Michigan SoS certified results". The card shows "How this settles": the party-nominee note plus the event's
resolution rules, including the nominee-replacement clause. One click opens the create screen with the rule filled in (one-shot, 5%
of the pool) and the name and ticker suggested.

The same path, guided: Browse → Elections & Politics → US Senate → Michigan → the race's named outcomes. Unnamed placeholder markets
("Person A…J", `active: false`) are hidden, and the card says how many. Ticking two candidates opens the election-pair template.

The other test cases:
- "Eagles win" → an ESPN team card, plus the next game
- "US debt rises $1B" → the Treasury feed
- "Detroit high above 90" → `nws.high:DTW-90`
- "WIF vs SHIB" → the Coin vs Coin tile (its page when present, else "not built yet" — the copy lint forbids "coming soon")

## What was built (this branch)

**Coins page and coin card** (`src/app/burnticker/page.tsx`, `_components/CoinCard.tsx`):
- The coin card grid with five tabs and search.
- Curve progress from `src/lib/burnticker/market.ts`. It decodes the LaunchLab PoolState account; the decoder is pinned against the SDK
  layout and three real mainnet accounts.

**Coin page** (`t/[ticker]/page.tsx`):
- Two columns: chart and receipts tape on the left; trade links, curve, holders and rule card on the right.

**Wizard** (`launch/page.tsx`):
- The Browse path.
- The pump.fun-order create screen with a live preview, and Website / X / Telegram links.
- Plain-words review for any rule (`coinCard.ts` `plainSentence`).
- Big YES / NO buttons.
- Kalshi-off states.

**Phone tab bar** (`_components/TabBar.tsx`, mounted by the public tree's layout; CSS in `config/public-repo/overlay/src/app/globals.css`).

**Data and API:**
- `status.json` gains `profile` (image, description, links, one-liner), `market` (phase, curve, holders, trade links, chart embed, read
  time and errors) and `burned.lastAt`.
- The index card carries image, one-liner, curve, last burn and next result.
- `GET /api/burnticker/v1/tokens` gains `imageUrl` and `lastBurnAt`.
- New routes: `GET /api/burnticker/v1/browse` and `GET /api/burnticker/v1/kalshi/categories` (OpenAPI 1.2.0).
- New SDK methods: `bt.browse()` and `bt.kalshi.categories()`.

**Later the same day (second commit set):** Kalshi off by default, Polymarket discovery without market data, the ESPN / NWS / FEC
native sources with their cross-reads, the elections flow and the election-pair template, the universal search — see § Venues and
§ The 60-second path above.

**Live vs "—":**
- Curve progress and top holders are read only where the host has `BURNTICKER_RPC_URL`; the app and the keeper both read them. Without
  it they show "—" with "not read on this host".
- Holder **count** is always "—", because it needs an indexer.
- Chart embed and trade links: mainnet only.
- Image, links and one-liner: live from the registry.
