# Burnticker changelog — every publish and every deploy

Append-only. `scripts/ops/publish-public-repo.sh --tag` appends one entry per publish of the public repository: the date, the
monorepo commit the tree was cut from, the burn_receipts program hash (sha256 of the built `.so` when it exists on the publishing
host, else "not built here"), the IDL sha256, and the allowlist's sha256. A deploy of the program or the keeper is a further
entry written by hand with the deployed program id and the transaction. Rendered verbatim on /burnticker/trust. This file is
copied to the public repository's root as `CHANGELOG.md`.

## 2026-10-09 — no publish and no deploy yet

The public repository does not exist yet. The program is not deployed on any public cluster. Entries start when the owner runs the
publish script.

## 2026-10-10 — publish from 3d952cb3466c

- monorepo commit: `3d952cb3466cb5c754e12067231b7264f5678eb7` (the working tree had uncommitted changes when this tag was written)
- program hash: `7a61f00bb38394a6ec57341836e2a261caa9b4befe67082a3ff9e0e9026f5739` — sha256 of programs/burn-receipts/target/deploy/burn_receipts.so on the publishing host
- IDL sha256 (src/lib/burnReceipts/idl.ts): `1c3fda17a66eba4855c53439e2b186c795f2d9e8fe6ba627c9b13a4057c1f516`
- allowlist sha256 (config/public-repo.allowlist): `bb08241ed6570d363924fe7452e6acb85b5bbcf68c1c9fe22778312acb335b4b`
- files published: 483

## 2026-10-10 — publish from 57316382f293

- monorepo commit: `57316382f2936d821e4847c8b92718dff4f0124f` (the working tree had uncommitted changes when this tag was written)
- program hash: `7a61f00bb38394a6ec57341836e2a261caa9b4befe67082a3ff9e0e9026f5739` — sha256 of programs/burn-receipts/target/deploy/burn_receipts.so on the publishing host
- IDL sha256 (src/lib/burnReceipts/idl.ts): `1c3fda17a66eba4855c53439e2b186c795f2d9e8fe6ba627c9b13a4057c1f516`
- allowlist sha256 (config/public-repo.allowlist): `bb08241ed6570d363924fe7452e6acb85b5bbcf68c1c9fe22778312acb335b4b`
- files published: 492

## 2026-10-10 — publish from ee6007154134

- monorepo commit: `ee6007154134f929f201760b1869239dab297543` (the working tree had uncommitted changes when this tag was written)
- program hash: `7a61f00bb38394a6ec57341836e2a261caa9b4befe67082a3ff9e0e9026f5739` — sha256 of programs/burn-receipts/target/deploy/burn_receipts.so on the publishing host
- IDL sha256 (src/lib/burnReceipts/idl.ts): `1c3fda17a66eba4855c53439e2b186c795f2d9e8fe6ba627c9b13a4057c1f516`
- allowlist sha256 (config/public-repo.allowlist): `bb08241ed6570d363924fe7452e6acb85b5bbcf68c1c9fe22778312acb335b4b`
- files published: 512

## 2026-10-10 — settlement-coverage audit (no publish, no deploy)

- Owner decision of 10-10: Kalshi's Developer Agreement and Data Terms forbid using its API or data to settle products or to cache or
  redistribute it, so Kalshi is not a settlement input. A coin settles on a primary source with an independent cross-read, or on
  Polymarket's payout vector on Polygon.
- `src/lib/burnticker/coverage/`: the coverage matrix (per category of `config/burnticker/categories.json` and per selector kind:
  settleable / adjudicated-only / uncovered), the 90-day dry run per source (hit rate, latency, disagreement with the cross-read), the
  creation preflight wired into the launch pipeline (`BURNTICKER_PREFLIGHT_STRICT`, default on; every Kalshi rule refused).
- `scripts/burnticker-coverage-audit.mts` (`--offline` / `--live`, `--write` → `docs/burnticker/SETTLEMENT-COVERAGE.md`; exit 1 on an
  uncovered category), `GET /api/burnticker/v1/coverage` (OpenAPI 1.3.0), the trust page's "Settlement coverage" section.
- `config/burnticker/sources.json`: `operator` on every entry, `fact` on the paired ones, four cross-read-only sources with fixtures
  fetched 2026-10-10 21:37 UTC (`fred.APU0000708111`, `bls.LNS14000000`, `bls.CUSR0000SA0`, `bitcoin.blockHeight.blockstream`).
- Found by the first live dry run: FRED's keyless CSV now serves the whole history, the 2020-04 unemployment jump trips the
  plausibility delta and nothing after it was read, so `fred.UNRATE` read no reading after 2020-03. The four FRED requests now ask for
  three years (`cosd={from:1100}`), and the preflight refuses a stale read (`stale-primary`: the next reading was due over a week ago).
- Offline result: Economics and Crypto & On-chain settleable; nine categories adjudicated-only; none uncovered. Team coins, season
  matchups and every settled number outside those two categories cannot be settled today.

## 2026-10-10 — first-party team coins, weather, elections flow, universal search (no publish, no deploy)

- `BURNTICKER_KALSHI_ENABLED` now defaults OFF: Kalshi's routes, back-tests and launch bundles answer 503; the app and the keeper make no
  Kalshi display reads; the keeper reads Kalshi only for coins already registered with a Kalshi rule, with a warning per read. No
  default copy names Kalshi (landing page, wizard, footer, pair page).
- `BURNTICKER_POLYMARKET_DISCOVERY_ENABLED` (default on): creators find Polymarket markets by question, outcomes, end date, resolution
  rules and condition id; no price, odds, volume or liquidity is returned anywhere (`impliedYes` removed; payloads scrubbed and tested).
  Settlement keeps reading the on-chain payout either way.
- Team coins and matchups run on the ESPN scoreboard (`src/lib/burnticker/sources/espn.ts`; NFL, NBA, MLB, NHL), each final confirmed
  by a second read from another operator (the NHL's and MLB's own feeds; TheSportsDB for NFL and NBA) before it counts.
- Weather: the NWS daily climate report (`sources/nws.ts`; 22 stations; daily high ≥ X, rain ≥ X, first snow), cross-read by the Iowa
  Environmental Mesonet. FEC receipts per report (`sources/fec.ts`) for the election-pair template — its same-operator cross-read does
  not pass the coverage gate (proposal in docs/burnticker/ui-conventions.md § FEC).
- sources.json gains kind `native` descriptors (operator, domain, fact) for those sources and their cross-reads; the coverage gate's
  preflight reads them live. Offline coverage: Sports and Weather & Climate move to settleable (4 settleable, 7 adjudicated-only, 0
  uncovered).
- The launch page opens on a universal search ("Describe the event") answering ready-made rules from every enabled source
  (`GET /api/burnticker/v1/search`); Browse → Elections & Politics is a guided race-type → state → race → outcome flow
  (`GET /v1/elections`, `GET /v1/elections/pair`); team and game pickers on the scoreboard (`GET /v1/sports/teams`, `/v1/sports/games`).
  OpenAPI 1.4.0. World is marked adjudicated-only (no first-party source qualifies).

## 2026-10-10 — publish from 24169e899c75

- monorepo commit: `24169e899c75674ad249372da233ce52546ff637` (the working tree had uncommitted changes when this tag was written)
- program hash: `7a61f00bb38394a6ec57341836e2a261caa9b4befe67082a3ff9e0e9026f5739` — sha256 of programs/burn-receipts/target/deploy/burn_receipts.so on the publishing host
- IDL sha256 (src/lib/burnReceipts/idl.ts): `1c3fda17a66eba4855c53439e2b186c795f2d9e8fe6ba627c9b13a4057c1f516`
- allowlist sha256 (config/public-repo.allowlist): `bb08241ed6570d363924fe7452e6acb85b5bbcf68c1c9fe22778312acb335b4b`
- files published: 556

## 2026-10-10 — Burn Derby + both-or-neither pairs (no publish, no deploy)

- **Burn Derby** (owner-approved 10-10, "build it all"; design note docs/burnticker/DERBY.md): `oracle: "derby"` rules with a locked
  `derby` block — coin vs coin (the winner's coin burns each UTC day or week; ties void; a one-shot flippening), single assets (Pyth's
  crypto, equity/fund, FX, metal and commodity feeds, counted in percentage points), and brackets of 8 or 16 coins (losers' fan coins
  retire; the final burns two units). Values from Pyth — keyless from its Solana `PriceUpdateV2` accounts, or Hermes boundary updates
  with `BURNTICKER_PYTH_API_KEY` (keyless Hermes price paths answered 401 on 10-10) — or a pool TWAP for coins without a feed;
  cross-read by Jupiter (price v3), DexScreener or RedStone; a gap above 2 points withholds the window. The window's proof hash is the
  counter attestation's signed `proof=`.
- **Both or neither** (owner decision 10-10): every new rivalry pair locks `clause`, `voidBy` and a weekly fallback clock in both rules;
  `pending-pair` → planned when both pools register; `voided` + the clock when `voidBy` ends without both (registry `pair_outcomes`).
- The wizard's "Coin vs Coin" tile; the pair page's derby block (score, day strip, season end, proof links) and the clause state with both
  curves; `/burnticker/derby/<tournamentId>`; the derby day post and the pair state lines (lint-clean). OpenAPI 1.4.0 adds
  `GET /derby`, `/derby/{id}`, `/derby/search`; SDK `bt.derby.*`.
- Coverage: sources.json gains kind `price-feed` descriptors (Pyth crypto/equity/FX/metal/commodity/rates, the Raydium pool TWAP,
  Jupiter, DexScreener, RedStone); the creation preflight reads each derby coin's primary and cross-read live. Financial markets
  becomes settleable for equities, FX, metals and oil (RedStone cross-reads); rates have no keyless cross-read and are listed as such.
- Copy lint: two narrow allowances for a derby's input ("WIF out-gains SHIB", "WIF's market cap passes SHIB's"), never a `$TICKER`.
- **No burn pool is ever left behind** (owner decisions 10-10): every new rule carries `onEnd` (28-day wind-down + retired-coin sweep
  threshold) in its hash — the API adds the default to a rule sent without it, the SDK does the same; a rule's end (one-shot NO / void,
  pair voided, derby season over, bracket loser, an adapter's mark) starts a daily clock reading (proof = sha256 of date + rules sha)
  that spends ≥ 99 % in 28 days; a one-shot may spend 100 % and drains across cranks (the program already allows 10,000 bps); retired
  coins are swept above 0.05 SOL at most weekly; the pair clause's weekly fallback clock is replaced by the wind-down; outcome sets
  (`set`) are in the schema. PROGRAM-UPGRADE-QUEUE.md: `sweep_retired`, `forward_to_winner`, per-outcome fractions.
- **RedStone as a keyless primary** for derby coins with no Pyth Solana account, no Hermes key and no pool (SHIB): signed packages from the
  public gateway, each secp256k1 signature verified against RedStone's five published redstone-primary-prod signers, median of ≥ 3;
  cross-read DexScreener on the home chain (curated contracts) or Jupiter. `redstone.crypto` becomes a launchable primary in the coverage
  audit. A WIF-vs-SHIB pair passes the creation preflight with no Pyth key. New page `/burnticker/derby` (open pairs, brackets, ended ones).


## 2026-10-10 — publish from 7bc68e5d324c

- monorepo commit: `7bc68e5d324c09a87390565f8e388246427e4914` (the working tree had uncommitted changes when this tag was written)
- program hash: `7a61f00bb38394a6ec57341836e2a261caa9b4befe67082a3ff9e0e9026f5739` — sha256 of programs/burn-receipts/target/deploy/burn_receipts.so on the publishing host
- IDL sha256 (src/lib/burnReceipts/idl.ts): `1c3fda17a66eba4855c53439e2b186c795f2d9e8fe6ba627c9b13a4057c1f516`
- allowlist sha256 (config/public-repo.allowlist): `bb08241ed6570d363924fe7452e6acb85b5bbcf68c1c9fe22778312acb335b4b`
- files published: 591

## 2026-10-10 — publish from 33da9b7ea6a6

- monorepo commit: `33da9b7ea6a6a6e9377ffcfb355c745ab2527426` (the working tree had uncommitted changes when this tag was written)
- program hash: `7a61f00bb38394a6ec57341836e2a261caa9b4befe67082a3ff9e0e9026f5739` — sha256 of programs/burn-receipts/target/deploy/burn_receipts.so on the publishing host
- IDL sha256 (src/lib/burnReceipts/idl.ts): `1c3fda17a66eba4855c53439e2b186c795f2d9e8fe6ba627c9b13a4057c1f516`
- allowlist sha256 (config/public-repo.allowlist): `bb08241ed6570d363924fe7452e6acb85b5bbcf68c1c9fe22778312acb335b4b`
- files published: 595

## 2026-10-10 — receipts-first copy re-cut (no publish, no deploy)

- Owner-approved positioning (10-10 night): "Coins that burn on real-world results — with receipts." / "Launch one. Follow the season." The
  receipt is the product; a season is a scoreboard of burns; nothing is ever won — things are only burned; a champion is the coin with
  the most receipts.
- Landing page (`site/burnticker/index.html`) re-cut: the sentence as the hero, two doors above the fold (Launch → the wizard,
  Seasons → the rivalries page), the eleven-item guardrail strip, sports examples rotated across MLB, NBA, NHL and NFL with no list led
  by the NFL, a "receipt is the product" section, a Seasons section (an example scoreboard by receipts, an Oilers–Flames rivalry and the Burn Derby, linked
  to `/burnticker/derby` now that its index is on main),
  the engine and the show as two layers. Corrections made on the way: $DEFICIT spends 2% per unit (was 5%), the creator's slice is
  fixed at 0 (the page offered an optional ≤ 20% slice that does not exist), the crank is `crank_buyback`, the upgrade authority is
  described as planned (multisig, then none), and the quorum is stated as one key at launch. No Kalshi on the page; Polymarket only as
  the on-chain payout.
- Whitepaper: new title line and abstract (§1); technical sections unchanged; `site/burnticker/whitepaper.html` regenerated.
- X kit: @BurnTicker profile (bio, pinned post, voice rules), the announcement thread re-cut, the rivalry thread without Kalshi
  series, and the two @BurnTicker formats — receipts (`receiptPostText`) and scoreboards (`scoreboardText`) in
  `src/lib/launch/dailyPost.ts`, with filled examples in docs/launch/x-threads.md §2c.
- Copy lint: new `no-prizes` category (prize, payout, jackpot, winnings, pot, reward, stake, bet, wager, odds, "win money", "get paid",
  holders earning), with allowed spans for the on-chain payout, saying what does not exist, "no team buy" and the Drift BET parser name.
  `test/burntickerCopy.test.ts` lints the landing page, the X kit, the thread templates, the public README opening and the abstract.
- Public README opening (`config/public-repo/overlay/README.md`) and `docs/burnticker/README.md` opening re-cut to the same sentence.

## 2026-10-10 — publish from 429bcd736105

- monorepo commit: `429bcd736105d8a29c1f14f280321e4be2937509` (the working tree had uncommitted changes when this tag was written)
- program hash: `7a61f00bb38394a6ec57341836e2a261caa9b4befe67082a3ff9e0e9026f5739` — sha256 of programs/burn-receipts/target/deploy/burn_receipts.so on the publishing host
- IDL sha256 (src/lib/burnReceipts/idl.ts): `1c3fda17a66eba4855c53439e2b186c795f2d9e8fe6ba627c9b13a4057c1f516`
- allowlist sha256 (config/public-repo.allowlist): `bb08241ed6570d363924fe7452e6acb85b5bbcf68c1c9fe22778312acb335b4b`
- files published: 597

## 2026-10-10 — devnet deploy: burn_receipts upgraded (register_pair_pool) and pair_curve deployed (no mainnet change)

- burn_receipts `AuQjoSgq7upmyPBv2itwy2TSZ1VjoVipyy4z9wd7zhMM` on **devnet** upgraded through the Squads 2-of-3 vault (60 s time lock):
  vault transaction 2, executed `3ARtrz75uBvA…`; deployed bytes
  (devnet build, 721,096 B) sha1 `4f6307f34ebfc22b7d2403f2922846f2a7a7c093`
- pair_curve `2jQotwSG8WKNYr5pccxuVmNa314qcnnwmrhqbuakELkN` deployed on **devnet** `jX24ZrjbmW7q…`,
  upgrade authority → the vault `36V5B8wPZ4wS…`; devnet build
  344,688 B, sha1 `e31f2ade7bd37fcc9489c300926850cd252835f1`
- rehearsal record: `docs/burnkeeper/devnet-paircurve-run-log-2026-10-10.md`; mainnet: nothing deployed (the owner's step)

## 2026-10-10 — brand header, shell labels, signed-readings guardrail, draft-script formats (no publish, no deploy)

- B1 header and OG re-rendered (`site/brand-concepts/b1-thermal-receipt/{header,og}.html` → `node site/brand-concepts/render.mjs b1` →
  `node site/burnticker/brand/render.mjs`): tagline "Coins that burn on real-world results — with receipts.", receipts for
  TREASURY.DEBT / ESPN.NHL / NWS.DEN, a ticker tape across leagues with the on-chain payout and no Kalshi line. The public overlay's
  `og.png` is the same file. The retired `brand/header.svg` loses its Kalshi line too.
- `SiteFooter.tsx` slip line and the public layout's Open Graph / Twitter title and description carry the sentence; the nav and phone
  tab bar label the rivalries page "Seasons" (the route stays `/burnticker/rivalries`).
- Guardrail strip (landing, public README, announcement thread): "quorum-signed readings" → "signed readings (one attester at launch,
  a second within 14 days)" — the schedule in docs/burnticker/decisions.md.
- `scripts/burnkeeper-post-draft.mts --template=receipt|scoreboard` prints the two @BurnTicker formats from a platform publish dir
  (sample: `test/fixtures/burnticker-season`); `--template=B1` is retired and says so. docs/launch/daily-post.md §(g), §(h) carry the
  examples, pinned equal to the script's output.


## 2026-10-10 — publish from 547558fafa4b

- monorepo commit: `547558fafa4baeca807bf8f4e0a8f549ff8cc2b7` (the working tree had uncommitted changes when this tag was written)
- program hash: `f3812ce47ff86e8c0bc8dcaae856e0e2c8523850afb19bda9de05ce559c775d0` — sha256 of programs/burn-receipts/target/deploy/burn_receipts.so on the publishing host
- IDL sha256 (src/lib/burnReceipts/idl.ts): `f4a0d6afa0f499c614145477ebd58642250da0503b6ee75f658141cc8a7e1112`
- allowlist sha256 (config/public-repo.allowlist): `f7a1767e8ba1732d7463fdb4e582f34c5865756d72673b6a8b7337be3313b82b`
- files published: 674

## 2026-10-10 — publish from 84ca648cd21f

- monorepo commit: `84ca648cd21f88553b650cf10bcd8b36b8eb121a` (the working tree had uncommitted changes when this tag was written)
- program hash: `f3812ce47ff86e8c0bc8dcaae856e0e2c8523850afb19bda9de05ce559c775d0` — sha256 of programs/burn-receipts/target/deploy/burn_receipts.so on the publishing host
- IDL sha256 (src/lib/burnReceipts/idl.ts): `f4a0d6afa0f499c614145477ebd58642250da0503b6ee75f658141cc8a7e1112`
- allowlist sha256 (config/public-repo.allowlist): `7add0488a2ba7070d08f39d8bd2409dc5b5a3a3027df97b0134fedf8e2d80276`
- files published: 688

## 2026-10-10 — go-to-market pack (no publish, no deploy)

- `docs/launch/gtm/`: `PLAN.md` (the owner's plan of record, byte-identical, sha256 `2556dc5f…6c40`, pinned by `test/gtmDocs.test.ts`),
  `PITCHES.md` (six audiences × one line, three lines, one paragraph, each with its proof link and the files it was checked against),
  `OUTREACH.md` (14 targets ranked by fit and zero cost, verified or marked UNVERIFIED on 2026-10-10, a ≤ 600-character draft per
  target, what is never offered; paid routes listed as skipped), `CALENDAR.md` (T-14 → T+7 with proposed dates — T = Mon 2026-10-26
  08:00 MDT — the owner-side list and six stated conflicts with the plan and the run-sheet), `COLD-READ.md` (two cold reads of the live
  site; an edit list by file and line).
- Post generator: `scripts/burnticker-posts.mts` + `src/lib/launch/postQueue.ts`. Six fixed formats — `receipt` (the copy agent's
  `receiptPostText`; `dailyText` for @USA_DEFICIT), `scoreboard` (`scoreboardText`; `pairDailyText` for a pair), `season-card`,
  `explainer`, `launch-thread`, `teaser` — built from the keepers' published files or `--fixtures`. Every post runs through the copy
  lint and is refused on a hit, an unfilled placeholder, > 280 X-characters or a thread over 8 posts. Clean posts append to
  `data/launch/post-queue.jsonl` (append-only, content-addressed, never rewritten); the owner posts by hand. No network, no X API.
  State-dependent claims (reviews, bounty, leagues read, coverage counts, the $DEFICIT fraction and hash) are read from
  `transparency.json`, `sources/espn.ts`, `SETTLEMENT-COVERAGE.md` and the rule file. Tests: `test/postQueue.test.ts`,
  `test/gtmDocs.test.ts`.

## 2026-10-10 — publish from f045ff7445d6

- monorepo commit: `f045ff7445d629eb318b4b0ea43237e574ca6af9` (the working tree had uncommitted changes when this tag was written)
- program hash: `f3812ce47ff86e8c0bc8dcaae856e0e2c8523850afb19bda9de05ce559c775d0` — sha256 of programs/burn-receipts/target/deploy/burn_receipts.so on the publishing host
- IDL sha256 (src/lib/burnReceipts/idl.ts): `f4a0d6afa0f499c614145477ebd58642250da0503b6ee75f658141cc8a7e1112`
- allowlist sha256 (config/public-repo.allowlist): `4846d807d7f41728915e06d9dfb2d938c4df44f6d33d725cff0507506cc2b701`
- files published: 698

## 2026-10-10 — scoreboards per league and season (no publish, no deploy)

- Owner feedback on the landing page: the example scoreboard ranked NHL, MLB, NBA and NFL coins in one table with a "champion" badge
  glued to the ticker. Scoreboards are now one per league and season ("NHL 2026–27", "MLB 2026 postseason", "NBA 2026–27", "NFL
  2026"), dated ("Oct 3 – 9") instead of numbered by week, each ranking only its league's coins by receipts and burned share. During a
  season the leader is "most receipts so far"; "champion" appears only after a season ends, inside its league. Across leagues only a
  count ("Yesterday (Oct 9) across all leagues: 5 team coins burned."). The landing sample carries an "example data" tag; the marker is
  its own element with a real space.
- `scoreboardText` takes a required `league` (plus `season`, `seasonOver`); `allLeaguesLine` is the count line; `seasonLabel`,
  `fmtDay`, `fmtRange`. `burnkeeper-post-draft --template=scoreboard` takes `--league` (or prints one post per league, then the count),
  `--season`, `--season-over`. The copy lint lets a month date ("Apr 20") past the APR rule.
- The sample season (`test/fixtures/burnticker-season`) now has realistic early-season counts; docs/launch/daily-post.md §(h), x-threads
  §2c, the X profile, the whitepaper abstract and both README openings say per league, per season.

## 2026-10-10 — cold-read edits (docs/launch/gtm/COLD-READ.md; no publish, no deploy)

- Landing: a one-line definition under the hero (E1); the $RAYS receipt labelled as an example (E4); the "reviewed" chip reads
  "three blind AI reviews, not a firm audit" (E3); "anyone can crank" replaced by the permissionless instruction with its pre-audit
  cranker list (up to three keys, at most 90 days, until the cap lifts) (E5/E6); the crank card says honestly that at quorum 1 burns stop
  if the operator stops, holders keep their coins and the retired-coin sweep is queued (E7); the upgrade-authority plan sentence is
  replaced by "who holds it today is on the trust page" (E8); the "burnticker" fee card no longer claims a post-graduation LP share — LP
  is 100 % burned (E9); "not built yet" → "not built" (E10); "nothing to trust" dropped.
- Guardrail strip (landing, public README, announcement thread): "signed readings (one attester at launch; second attester scheduled,
  not live)" (E14) and "three blind AI reviews, not a firm audit".
- Whitepaper status table: devnet deployed and rehearsed, public repository, operator contact; §3.4 five of eleven categories settleable;
  §11's not-built list updated (W1–W5). html regenerated.
- Public README: the on-chain memo is v1/v2 from the program; `BT|…|v3` is the platform's published receipt line (R1); the remaining
  named venue is "a US prediction exchange (not used; its terms do not permit it)" (R2). App footer: @BurnTicker (E12).

## 2026-10-10 — publish from 30dc7997d73d

- monorepo commit: `30dc7997d73dc8c321190ba7fd289356bf39526e` (the working tree had uncommitted changes when this tag was written)
- program hash: `f3812ce47ff86e8c0bc8dcaae856e0e2c8523850afb19bda9de05ce559c775d0` — sha256 of programs/burn-receipts/target/deploy/burn_receipts.so on the publishing host
- IDL sha256 (src/lib/burnReceipts/idl.ts): `f4a0d6afa0f499c614145477ebd58642250da0503b6ee75f658141cc8a7e1112`
- allowlist sha256 (config/public-repo.allowlist): `4846d807d7f41728915e06d9dfb2d938c4df44f6d33d725cff0507506cc2b701`
- files published: 699

## 2026-10-10 — publish from 729b7a363513

- monorepo commit: `729b7a363513e045c614c4ede1b0173b69b19836` (the working tree had uncommitted changes when this tag was written)
- program hash: `f3812ce47ff86e8c0bc8dcaae856e0e2c8523850afb19bda9de05ce559c775d0` — sha256 of programs/burn-receipts/target/deploy/burn_receipts.so on the publishing host
- IDL sha256 (src/lib/burnReceipts/idl.ts): `f4a0d6afa0f499c614145477ebd58642250da0503b6ee75f658141cc8a7e1112`
- allowlist sha256 (config/public-repo.allowlist): `4846d807d7f41728915e06d9dfb2d938c4df44f6d33d725cff0507506cc2b701`
- files published: 727

## 2026-10-10 — publish from e76983a318bb

- monorepo commit: `e76983a318bb4e74d6e25c16fc9c890ab4986f1d` (the working tree had uncommitted changes when this tag was written)
- program hash: `f3812ce47ff86e8c0bc8dcaae856e0e2c8523850afb19bda9de05ce559c775d0` — sha256 of programs/burn-receipts/target/deploy/burn_receipts.so on the publishing host
- IDL sha256 (src/lib/burnReceipts/idl.ts): `f4a0d6afa0f499c614145477ebd58642250da0503b6ee75f658141cc8a7e1112`
- allowlist sha256 (config/public-repo.allowlist): `4846d807d7f41728915e06d9dfb2d938c4df44f6d33d725cff0507506cc2b701`
- files published: 731

## 2026-10-10 — trust pack (no publish, no deploy)

- `/burnticker/check` + `docs/burnticker/CHECK-THIS-YOURSELF.md` (generated): every instruction of burn_receipts and pair_curve with
  its outflow (swap → burn, burn, into the burn pool, the trader's own funds, rent, or none), every privileged power (none over funds
  in either program), what is locked, what is not done; and a receipt verifier that runs in the browser — it fetches the transaction and
  the program's Reading and TokenConfig accounts from the public devnet RPC and both Treasury values, and recomputes units, spend and
  the burn. All seven devnet receipts ($DEFICIT ×2, $PCA ×2, $PCB ×3) verify, the two below-the-spend-floor ones included.
- Verified build (`scripts/ops/verified-build.sh`, `config/burnticker/verified-build.json`, `docs/burnticker/VERIFIED-BUILD.md`):
  INTERIM — a local `cargo build-sbf` (no Docker on the operator's Mac); the devnet builds equal the deployed devnet bytes of both
  programs. Executable hashes (trailing zeros stripped, solana-verify's definition): burn_receipts mainnet `3ecae91b…`, devnet
  `5ad3dd54…`; pair_curve mainnet `9b20156f…`, devnet `2fa91c04…`. (The publish entries above record the plain sha256 of the same
  default build, `f3812ce4…`.) The Docker build and the OtterSec registry entry are owner steps.
- `/burnticker/fees/ledger` (developer fee wallet from chain, by month; `config/burnticker/expenses.json`), `/burnticker/operator`
  (`config/burnticker/operator.json`: operator, entity TODO, devnet wallets from the rehearsal records, mainnet TODO, signed-statement
  slot with a live ed25519 check, the never-buys monitor — devnet: rehearsal trades only, each matched to its evidence file),
  `/.well-known/burnticker.json`, the trust page's "Check it yourself" section with the bounty wallet (TODO until the mainnet vault).
- API 1.5.0: `GET /check`, `/check/receipts`, `/check/receipts/{signature}`, `/fees/ledger`, `/operator`, `/bounty`.
- SECURITY.md: the bounty wallet line (TODO), how a valid report is paid, the published list of reports; three blind reviews + re-check,
  two pair_curve reviews, ChatGPT pending (cold read R3). transparency.json: the cold-read corrections T1–T4, the two pair_curve
  reviews with their open High findings, the new not-done items. Every placeholder: `docs/burnticker/TODO-OWNER.md`.

## 2026-10-10 — publish from 5e6f20bdcfca

- monorepo commit: `5e6f20bdcfcacf279e2d1bd88669648eb5d4c756` (the working tree had uncommitted changes when this tag was written)
- program hash: `f3812ce47ff86e8c0bc8dcaae856e0e2c8523850afb19bda9de05ce559c775d0` — sha256 of programs/burn-receipts/target/deploy/burn_receipts.so on the publishing host
- IDL sha256 (src/lib/burnReceipts/idl.ts): `f4a0d6afa0f499c614145477ebd58642250da0503b6ee75f658141cc8a7e1112`
- allowlist sha256 (config/public-repo.allowlist): `8c2075b16cd7e8e2c171b97662c26bfc1ebc94d99ef0da553bdde9a1c33efd8d`
- files published: 769

## 2026-10-10 — publish from 76481fdc8b2c

- monorepo commit: `76481fdc8b2ce88039bfb4e3a9433e397fb06646` (the working tree had uncommitted changes when this tag was written)
- program hash: `f3812ce47ff86e8c0bc8dcaae856e0e2c8523850afb19bda9de05ce559c775d0` — sha256 of programs/burn-receipts/target/deploy/burn_receipts.so on the publishing host
- IDL sha256 (src/lib/burnReceipts/idl.ts): `f4a0d6afa0f499c614145477ebd58642250da0503b6ee75f658141cc8a7e1112`
- allowlist sha256 (config/public-repo.allowlist): `8c2075b16cd7e8e2c171b97662c26bfc1ebc94d99ef0da553bdde9a1c33efd8d`
- files published: 774

## 2026-10-10 — publish from afb90fc93276

- monorepo commit: `afb90fc93276403cd7a034ea41f3b4d0bb2c8095` (the working tree had uncommitted changes when this tag was written)
- program hash: `f3812ce47ff86e8c0bc8dcaae856e0e2c8523850afb19bda9de05ce559c775d0` — sha256 of programs/burn-receipts/target/deploy/burn_receipts.so on the publishing host
- IDL sha256 (src/lib/burnReceipts/idl.ts): `f4a0d6afa0f499c614145477ebd58642250da0503b6ee75f658141cc8a7e1112`
- allowlist sha256 (config/public-repo.allowlist): `346810d696d2b14b4c7c3f69c89b86580d105a7ebbb8a700e99dfe564e2d6818`
- files published: 775

## 2026-10-10 — publish from 1f717cb65fc0

- monorepo commit: `1f717cb65fc013a015b6bf39f3c23e3e91c17ae4` (the working tree had uncommitted changes when this tag was written)
- program hash: `f3812ce47ff86e8c0bc8dcaae856e0e2c8523850afb19bda9de05ce559c775d0` — sha256 of programs/burn-receipts/target/deploy/burn_receipts.so on the publishing host
- IDL sha256 (src/lib/burnReceipts/idl.ts): `f4a0d6afa0f499c614145477ebd58642250da0503b6ee75f658141cc8a7e1112`
- allowlist sha256 (config/public-repo.allowlist): `346810d696d2b14b4c7c3f69c89b86580d105a7ebbb8a700e99dfe564e2d6818`
- files published: 824

## 2026-10-10 — publish from 91148ab93f5b

- monorepo commit: `91148ab93f5b504aaf5c238406605165f71d842d` (the working tree had uncommitted changes when this tag was written)
- program hash: `f3812ce47ff86e8c0bc8dcaae856e0e2c8523850afb19bda9de05ce559c775d0` — sha256 of programs/burn-receipts/target/deploy/burn_receipts.so on the publishing host
- IDL sha256 (src/lib/burnReceipts/idl.ts): `f4a0d6afa0f499c614145477ebd58642250da0503b6ee75f658141cc8a7e1112`
- allowlist sha256 (config/public-repo.allowlist): `346810d696d2b14b4c7c3f69c89b86580d105a7ebbb8a700e99dfe564e2d6818`
- files published: 827

## 2026-10-10 — publish from 0fccd14e37f8

- monorepo commit: `0fccd14e37f851b433911bd2154445ca19bbff2b` (the working tree had uncommitted changes when this tag was written)
- program hash: `f3812ce47ff86e8c0bc8dcaae856e0e2c8523850afb19bda9de05ce559c775d0` — sha256 of programs/burn-receipts/target/deploy/burn_receipts.so on the publishing host
- IDL sha256 (src/lib/burnReceipts/idl.ts): `f4a0d6afa0f499c614145477ebd58642250da0503b6ee75f658141cc8a7e1112`
- allowlist sha256 (config/public-repo.allowlist): `346810d696d2b14b4c7c3f69c89b86580d105a7ebbb8a700e99dfe564e2d6818`
- files published: 829

## 2026-10-10 — publish from 2044a9956bd0

- monorepo commit: `2044a9956bd06c0b1c2250a80ee00bf063ee1048` (the working tree had uncommitted changes when this tag was written)
- program hash: `f3812ce47ff86e8c0bc8dcaae856e0e2c8523850afb19bda9de05ce559c775d0` — sha256 of programs/burn-receipts/target/deploy/burn_receipts.so on the publishing host
- IDL sha256 (src/lib/burnReceipts/idl.ts): `f4a0d6afa0f499c614145477ebd58642250da0503b6ee75f658141cc8a7e1112`
- allowlist sha256 (config/public-repo.allowlist): `346810d696d2b14b4c7c3f69c89b86580d105a7ebbb8a700e99dfe564e2d6818`
- files published: 843

## 2026-10-10 — publish from de568b0312e9

- monorepo commit: `de568b0312e92a9536f22c0fc5654f99f692e0e0` (the working tree had uncommitted changes when this tag was written)
- program hash: `f3812ce47ff86e8c0bc8dcaae856e0e2c8523850afb19bda9de05ce559c775d0` — sha256 of programs/burn-receipts/target/deploy/burn_receipts.so on the publishing host
- IDL sha256 (src/lib/burnReceipts/idl.ts): `f4a0d6afa0f499c614145477ebd58642250da0503b6ee75f658141cc8a7e1112`
- allowlist sha256 (config/public-repo.allowlist): `346810d696d2b14b4c7c3f69c89b86580d105a7ebbb8a700e99dfe564e2d6818`
- files published: 857

## 2026-10-10 — ChatGPT/Codex adversarial PR review: published, answered, fixed (no publish, no deploy)

- The report is published verbatim: `docs/burnticker/reviews/2026-10-10-chatgpt-pr-review.md` (reviewed public commit `58d43eae`).
  The response, one row per finding, is `…-response.md`. In transparency.json the review is marked completed.
- N1: a launch confirmation is now read from the chain. The transaction must have succeeded, the mint and the creator must have
  signed it, it must call burn_receipts, and it must have landed after the draft was registered. The baseline is the transaction's
  block time. The same signature again is a no-op, and the SQL trigger `tokens_baseline_fixed` locks the baseline. A host without
  an RPC refuses to confirm (503).
- N2: a generic catalogue feed's readings reach the registry only after the same-fact independent cross-read, read in the same
  cycle, agrees. Each period is checked one by one, a snapshot fact on its latest value only, and a quarter-end pair at series level
  ($DEFICIT; the limitation is stated on each receipt). A missing, unreadable or disagreeing cross-read holds the reading.
- N3: SDK verification requires burn-program provenance: the program's own Memo CPI and burn on the mint, plus a processed,
  program-owned Reading. A Memo-only transaction fails. Without `programId` and `mint` the chain check is "not checked".
- N4: `/api/burnticker/launch` shares the public API's per-client write bucket. `BURNTICKER_PIN_DAILY_CAP` (default 50) caps the
  coins pinned on Arweave per UTC day on a host.
- N5: the public-repo export refuses symlinks and sources outside the allowed root. It re-checks at copy time with O_NOFOLLOW and
  rescans the staged output.
- N6: with the pair curve enabled, a pair launch must ask for `venue: "pair-curve"`. The response carries the pair-curve transaction
  set and never two independent LaunchLab bundles. A request without that venue is refused before anything is pinned or registered.
  The wizard UI's side of this is not done yet.
- N7: a late-final event behind the settlement cursor is planned for binary rules and for fixed-baseline rules with no carry. For
  ordered scalar rules it raises a `late-reading` alert and is not applied again. The cursor never rewinds. The fetch window stays
  anchored while events await finality.
- Owner decisions on the checklist mismatches:
  - Kalshi fails closed: with the flag off it is never read, and existing Kalshi coins are held with an alert.
  - LP floor copy: "≥ 50 % at registration (≥ 90 % for the fallback pool); our platform burns 100 % at graduation".
  - Entrypoint count: 24.
  - The pre-registered checklist is unchanged; both corrections are in a dated erratum.
  - UI rule: "no price, market cap or odds for any Burnticker coin; another coin's market cap may be a rule input, shown only as the
    rule sentence".
  - The devnet 10-08 row is planned, not executed, and not counted.
- The two pair_curve residuals (deadline-to-void, unsynced WSOL) were already fixed in pair_curve round 2 (`fcda14eb`).
- Follow-ups after the review:
  - The pair-curve launch response carries both mint secrets (`mintSecretKeys`).
  - A pair-curve coin is confirmed with tx 1 (side A) or tx 2 (side B).
  - The market-implied chance is removed from every coin page, the index and the pair page, flag on or off. No odds or prices are
    shown for any coin, and `impliedChance` stays in `status.json` as an always-null field.
  - The $DEFICIT series-level cross-check is accepted for now; "daily independent debt source" is a TODO-OWNER row.

## 2026-10-10 (night) — trust ops (no publish, no deploy)

Owner-approved batch ("build them all"), branch `burnticker/trust-ops`. New modules under `src/lib/burnticker/ops/` and
`src/lib/burnticker/attesters/`; four hook lines in `scripts/burnticker-keeper.mts`. Nothing is deployed by this entry: the keeper picks it
up on its next restart after a ship; the Caddyfile and the two static pages ship with the next deploy (`deploy-sites.sh --pages-only`).

- **Daily registry snapshot pinned to Arweave**: canonical JSONL of rules, readings, receipts, pairs, pair outcomes, rule ends and launch
  pins; sha256; Irys upload with `BURNTICKER_UPLOAD_PAYER` (refused without it — no hosted fallback); a write-once `snapshots` table in the
  registry (SQL triggers refuse updates and deletes). `GET /api/burnticker/v1/snapshots` — **API 1.7.0**. Verifier:
  `scripts/burnticker-verify-snapshot.mts <txid>` (re-download, recompute, canonical checks; `--db` append-only check against a later copy).
  The platform daily post's footer carries the latest hash (`snapshotLine()` in `src/lib/launch/dailyPost.ts`).
- **Public status page**: `status/status.json` every cycle (schema `burnticker.ops-status/v1`), `site/burnticker/status/index.html`, Caddy
  site block for `status.burnticker.com` (DNS record: owner) and `/status/` on the apex.
- **Feed health**: down / disagree / stale per selector, each withholding the reading; alerts `bt-feed-down`, `bt-feed-disagree`,
  `bt-feed-stale`.
- **Keeper redundancy**: `BURNTICKER_KEEPER_ROLE=leader|standby`, heartbeat over HTTPS, takeover only after N missed heartbeats and a
  takeover note signed by the standby's key, the leader yields to a verified note, no automatic fail-back; the **foreign-reading fence**
  (a keeper adopts on-chain readings it did not write when the units match and holds its sends when they do not) closes a double-count a
  second keeper would otherwise cause. Alerts `bt-foreign-reading`, `bt-keeper-yielded`, `bt-keeper-takeover`, `bt-snapshot-failed`.
  Failure modes written down in the runbook ("Keeper redundancy").
- **Source-outage drill**: `scripts/burnticker-drill.mts --feed <id> --mode down|disagree|stale|--all`; monthly checklist in the runbook.
- **Bring your own attester**: `docs/burnticker/ATTESTERS.md`, `scripts/burnticker-attester.mts keygen|read|status|propose|apply`; the
  trust page lists every coin's attesters with key prefixes and seniority dates. No program change.
- **Incident policy**: `docs/burnticker/INCIDENTS.md` + `incidents/TEMPLATE.md`; the append-only log moved from `incidents.md` to
  `incidents/LOG.md` (it held no entries); linked from the trust page and SECURITY.md.
- **Launch-day load test + static fallback**: `scripts/ops/loadtest.sh` (dependency-free), the first run against the box (50 RPS mixed:
  p95 198 ms, 0 5xx; most API calls answered by the per-client limiter, which keys on the Cloudflare edge — a launch-day risk written up
  in `docs/burnticker/LOADTEST.md` with the fix), Cloudflare cache rules for the owner to apply, Caddy capping app page shells at 60 s at the
  edge (Next sends one year), and `site/burnticker/fallback/` served with 503 when the app is down or a page answers 5xx.

## 2026-10-10 — growth batch: badges, league pages, bot starter kit, mint verification, clone watch (no publish, no deploy)

Owner-approved ("build them all"). Public API **1.7.0**, which adds to the product batch's 1.6.0.

- **Receipt badge.** `GET /api/burnticker/v1/badge/{TICKER}.svg|.png|.json` and `/badge/pairs/{pairId}.*`: a receipt-slip card with
  the ticker, the one-liner, the last burn, the receipts this season and "verify →". It is cached 60 s and carries no market data.
  `/burnticker/embed/{TICKER}` and `/embed/pairs/{pairId}` serve the same card with a live next-settlement line. Each is a route
  handler with CSP `frame-ancestors *`, hashed inline style and script, and no cookies; Caddy serves it through `security_embed`,
  without X-Frame-Options. Every coin and pair page has an "Embed this coin" box.
- **League pages.** `/burnticker/leagues` and `/burnticker/leagues/{league}/{season}`:
  - the scoreboard cards from `seasons.ts`, with champion only after the season ends;
  - the teams, with launch links;
  - the games the league's coins settled in the last seven days, with the recorded source line and the ESPN link only;
  - JSON-LD, OpenGraph and a generated OG image.

  `/burnticker/sitemap.xml` is served at `/sitemap.xml`.
- **Bot starter kit.** `packages/burnticker-bot-starter/` (follow, launch preview that never signs, post queue with no X API) is in
  the public-repo allowlist.
- **Verify a mint.** `/burnticker/verify` and `GET /v1/verify-mint/{mint}` compare the program's TokenConfig with the registry. Coin
  pages show "verified by program · mint …".
- **Lookalike refusal and no adoption.** The launch handler refuses a ticker or name that reads as an existing coin (409
  `lookalike`) and a mint that already exists (409 `mint-exists`). Two tests changed their second ticker because of this: `$BUCS2`
  became `$TAMPA`, and `$BRONCOS` became `$DENVER`. Both old tickers are lookalikes of a coin in their own fixture.
- **Clone watch.** `scripts/burnticker-clone-watch.mts` runs every 15 minutes from `mct-burnticker-clonewatch.timer`. It searches
  DexScreener (keyless), checks the program, reads the holder-stack signal and tracks LP pulls, and writes append-only
  `clone_observations` and `clone_scans` rows. `/burnticker/not-burnticker` and `GET /v1/clones` show the evidence only.
- **Runbook.** Launch day step 11: the canonical mint and program id in the pinned first post; the DexScreener, Solscan and Jupiter
  verification requests; the clone watch turned on; impersonator accounts reported the same day.

## 2026-10-10 — publish from 27f02976211e

- monorepo commit: `27f02976211e0c9516beffd9804faa5fca357a29` (the working tree had uncommitted changes when this tag was written)
- program hash: `f3812ce47ff86e8c0bc8dcaae856e0e2c8523850afb19bda9de05ce559c775d0` — sha256 of programs/burn-receipts/target/deploy/burn_receipts.so on the publishing host
- IDL sha256 (src/lib/burnReceipts/idl.ts): `f4a0d6afa0f499c614145477ebd58642250da0503b6ee75f658141cc8a7e1112`
- allowlist sha256 (config/public-repo.allowlist): `346810d696d2b14b4c7c3f69c89b86580d105a7ebbb8a700e99dfe564e2d6818`
- files published: 864

## 2026-10-10 — publish from e294d37b3d4e

- monorepo commit: `e294d37b3d4e5ea0ff642b6803925ccbfce3491f` (the working tree had uncommitted changes when this tag was written)
- program hash: `f3812ce47ff86e8c0bc8dcaae856e0e2c8523850afb19bda9de05ce559c775d0` — sha256 of programs/burn-receipts/target/deploy/burn_receipts.so on the publishing host
- IDL sha256 (src/lib/burnReceipts/idl.ts): `f4a0d6afa0f499c614145477ebd58642250da0503b6ee75f658141cc8a7e1112`
- allowlist sha256 (config/public-repo.allowlist): `7012a98e1aabc0504bbf3d8e828cd2a3cbb202d5005d4bc508d2aa0823eb27ef`
- files published: 939

## 2026-10-10 — LP locked forever, its fees fund the burn (client side; no publish, no deploy)

- Owner decision (decisions.md 2026-10-10): graduation LP is 100 % locked with Raydium's LP lock, the Fee Key is owned by burn_receipts'
  `["fee_keys"]` PDA, and the permissionless `claim_lock_fees` pays 80 % of the SOL side to the coin's burn pool and 20 % to the operator
  treasury (compiled constants); the coin side is burned. The program change, its IDL and the verified build are a separate entry.
- Keeper: a `register_fee_key` / `claim_lock_fees` crank per coin ahead of the buyback cranks (`src/lib/burnticker/lockFeesKeeper.ts`),
  append-only `lock_fee_claims` rows, alerts on refusal, a Fee Key held elsewhere, an unpinned treasury or a skewed split.
- Platform config and launch gate: `platformScale` 1,000,000 / creator 0 / burn 0 and the lock-NFT wallet = the fee-keys PDA are pinned
  (`src/lib/burnticker/lpLockPins.ts`; `verify-platform-pins`); a mainnet launch also needs the operator treasury compiled in.
- API 1.8.0 (additive): `status.lp`, `/trust` `lpLock`, `/fees/ledger` `lpFees`; `trust.lpBurnedPct` is 0 from now on. SDK: the lock
  helpers and types. Pages: the coin and pair pages show "LP locked forever · fees fund the burn" with the addresses; the trust page
  section and the fee ledger's operator LP-fee line.
- `config/burnkeeper/deficit.rules.json` is unchanged (the LP policy is not in the rules hash): sha256
  `78f4c327552e42080ffe18830785fada399a882d0347793f881c7a8d35d2be58`.

## 2026-10-10 — publish from 372bca22ce73

- monorepo commit: `372bca22ce7318493d735a0b516560d5a65bee86` (the working tree had uncommitted changes when this tag was written)
- program hash: `f3812ce47ff86e8c0bc8dcaae856e0e2c8523850afb19bda9de05ce559c775d0` — sha256 of programs/burn-receipts/target/deploy/burn_receipts.so on the publishing host
- IDL sha256 (src/lib/burnReceipts/idl.ts): `f4a0d6afa0f499c614145477ebd58642250da0503b6ee75f658141cc8a7e1112`
- allowlist sha256 (config/public-repo.allowlist): `7012a98e1aabc0504bbf3d8e828cd2a3cbb202d5005d4bc508d2aa0823eb27ef`
- files published: 944

## 2026-10-10 — publish from 985b3ea4eee5

- monorepo commit: `985b3ea4eee51f1fcced7ea9fffc9401a11dae9d` (the working tree had uncommitted changes when this tag was written)
- program hash: `f3812ce47ff86e8c0bc8dcaae856e0e2c8523850afb19bda9de05ce559c775d0` — sha256 of programs/burn-receipts/target/deploy/burn_receipts.so on the publishing host
- IDL sha256 (src/lib/burnReceipts/idl.ts): `f4a0d6afa0f499c614145477ebd58642250da0503b6ee75f658141cc8a7e1112`
- allowlist sha256 (config/public-repo.allowlist): `7012a98e1aabc0504bbf3d8e828cd2a3cbb202d5005d4bc508d2aa0823eb27ef`
- files published: 944

## 2026-10-10 — publish from 296f2d429111

- monorepo commit: `296f2d429111e54c9ba22eb14e37ff660bb19ef3` (the working tree had uncommitted changes when this tag was written)
- program hash: `0b5180e3bde9d5e9d3f56061b63898a7ac58fa92da735eaf91a8208297fed5f6` — sha256 of programs/burn-receipts/target/deploy/burn_receipts.so on the publishing host
- IDL sha256 (src/lib/burnReceipts/idl.ts): `c60141372d28924c7f49c9436afccab883ee99093dbf2021e0331ea750d12501`
- allowlist sha256 (config/public-repo.allowlist): `7012a98e1aabc0504bbf3d8e828cd2a3cbb202d5005d4bc508d2aa0823eb27ef`
- files published: 997

## 2026-10-11 — Pair-forward round 3 (re-check RN-1 / RN-2 / M-1 / RI-1 / RI-4), client side; no publish, no deploy

- burn_receipts gains `apply_paired_attester_change` (31 entrypoints, 100 error codes; `PairHasReadings` no longer raised).
- Launch: `initialize_token` with `pair_mint` carries `pair_void_by` (the rules' locked voidBy, both coins) and both coins one attester set;
  a pair-curve coin's `pair_void_by` is 0 (it pairs through `link_pair`).
- Keeper: unlink sending back ON under terminal evidence only (voided Pair, refunding side, a LaunchLab voidBy day ended with a coin
  unverified; the 30-day rule is deleted); unlinked coins show pair state 3 and are never re-linked; `link_pair` refused only on
  `PairTerminal` (`pair-link-refused`); results never posted for periods on or before `pair_after_date` and such results plan without pair
  roles; a closed forward window (`ForwardWindowClosed`) is a wait — the planner's buyback takes the period.
- Pages / API 1.12.0 (additive): `status.pair.pairState` (none / provisional / paired / unlinked), `pairVoidBy`, `pairAfterDate`; the pair
  page states "Whoever holds the common attester quorum decides every result; on Burnticker that is the operator's keeper alone at quorum 1."
- Docs: whitepaper §5.5 and §13.3, ATTESTERS.md (one set; rotating a paired coin through `apply_paired_attester_change`), a dated checklist
  erratum, runbook W7, api.md.

## 2026-10-11 — Pair-forward round-2 re-check, keeper items (RL-1, RL-2, RI-2); no publish, no deploy

- RL-1: a `forward_to_winner` the keeper did not itself just confirm (another cranker's, one that won the 72 h race, or its own with a
  lost confirmation) is adopted from the chain: the loser's FORWARDED reading, its `forward:<date>` write-ahead signature or the chain
  (`findCrankTx` matches ForwardToWinner) — receipts recorded, the `pair_forwards` row written; nothing is held forever.
- RL-2: the pair-curve crank never re-links a pair with a refunding side or one the registry records as unlinked; the unlink step re-reads
  the chain every cycle and alerts `pair-unlink-drift` when the record and the chain disagree. Sending `unlink_pair` is OFF by default
  (KeeperDeps.pairUnlink) until the round-3 evidence set is bound — the round-2 30-day not-live rule would unlink healthy open pairs (RN-1/RN-2).
- RI-2: "a lost period never burns the losing coin unless no forward lands within 72 hours, in which case it burns as a plain period and a
  PairForwardMissing event is published" — whitepaper §5.5, PAIR-CURVE.md, ATTESTERS.md and a dated checklist erratum.
- Pair pages state the attester fact: "On this platform the operator's keeper is the sole attester (quorum 1) for both coins of a pair."

## 2026-10-11 — Pair-forward round 2 (the blind review's H-1 / M-1 / M-2 / L-1..L-4), client side; no publish, no mainnet deploy

- burn_receipts gains `unlink_pair` (30 entrypoints, 34 event types with PairForwardMissing / PairUnlinked, 94 error codes).
- Keeper: a win is posted only when it can be recorded (both readings, the loser's unprocessed; a flat winner reading first when needed),
  never a substitute draw (`pair-result-unservable`); against a dead winner the forward moves 0 lamports and the loser keeps its fuel; no
  result before the pairing day; past 72 h without a forward the planner's paired buyback cranks the period unpaired
  (`pair-forward-missing`; `pair-forward-pending` fires at 1 h); `unlink_pair` on
  evidence, recorded and shown as "unpaired (reason)"; `link_pair` right after `init_pair` (it refuses once a coin has a reading); a
  forward against a dead side records 0 SOL.
- Launch: `initialize_token` with `pair_mint` carries the partner's PairLink address every time (the builder's `initializeTokenIx`).
- API 1.11.0 (additive): `status.pair.unpaired`, ops `pairs[].unpaired`; errors 6090–6093 in plain sentences.

## 2026-10-11 — Winner takes the burn (LAUNCHPAD-PATH §40), client side; no publish, no mainnet deploy

- burn_receipts gains `link_pair`, `submit_pair_result` and `forward_to_winner` (29 entrypoints, 32 event types, 90 error codes); the
  program builder's devnet upgrade, verified hash and pair-6 run are under `docs/burnkeeper/evidence/devnet-pair-forward-2026-10-11/`.
- Rules: every new pair carries `pair.winnerTakesBurn: true` (a one-shot pair maps 100 %); the locked description adds "Paired with a rival
  coin: fees from both coins burn the winner's supply (the coin whose rule a result fires)."; the copy lint gains `win-fees` (no-prizes).
- Keeper: attest both coins, post the PairResult (both quorums), forward the loser's fuel before the winner's crank; `link_pair` before
  `register_pair_pool`; alerts `pair-result-missing` (12 h after a reading), `pair-forward-pending`, `pair-forward-impossible`,
  `pair-unmatched` (daily); a flagged pair inside its pairing window is held; append-only `pair_forwards`; `status/status.json`
  `pairs[].lastForward`; the receipt line "forwarded from $LOSER: N SOL → $WINNER burn pool".
- Pages and API 1.10.0 (additive): receipt status `forwarded` and `pairRole`; `status.pair.winnerTakesBurn` / `forwards[]`; the pair
  page's "burned on A / burned on B / forwarded A→B / B→A"; the Burn Derby scoreboard's forwarded fuel; SDK types and the
  `PairResultSubmitted` log event.

## 2026-10-11 — LP lock round 2: the blind review's RL-2 / RL-3 / L-1..L-3 fixes (client side; no publish, no deploy)

- `register_fee_key` gains `lp_lock_vault` and identifies the position by its LOCKER (LaunchLab's vault_auth for policy 0, the pair vault for
  policy 2); for policy 0 it now runs BEFORE `register_pool`, which takes the FeeKeyRecord as its last account (`FeeKeyNotRegistered`,
  `FeeKeyMismatch`). The keeper runs register_fee_key → register_pool → claims; the admin CLI's register-fee-key works on the migration pool.
- `claim_lock_fees` takes no arguments; memo v2 adds `paid` / `pending` (the parsers read v1 and v2); a claim that moves nothing writes no
  memo and records no receipt; a coin-token donation alone is still burned and counted.
- New compiled pin `BURNTICKER_PLATFORM` (devnet `GvSKpe5p…xv3tf`, mainnet zeros → `PlatformNotPinned`): in the launch gate,
  `verify-platform-pins`, `/trust` `lpLock.platformPinned` and TODO-OWNER row 27. `lpLock.feeKeysPda` is derived from the program id and is
  never null.
- pair_curve `burn_lp(side)`: the fallback after 30 days of a refusing lock — the only path that destroys LP; the keeper cranks it when due and
  alerts `pair-side-unlocked` for every graduated side still unlocked. Program errors map to plain sentences in alerts and `lp.lastError`.

## 2026-10-10 — publish from 359a3490985a

- monorepo commit: `359a3490985a46c27687d099dd878a8a6eebecf6` (the working tree had uncommitted changes when this tag was written)
- program hash: `0b5180e3bde9d5e9d3f56061b63898a7ac58fa92da735eaf91a8208297fed5f6` — sha256 of programs/burn-receipts/target/deploy/burn_receipts.so on the publishing host
- IDL sha256 (src/lib/burnReceipts/idl.ts): `c60141372d28924c7f49c9436afccab883ee99093dbf2021e0331ea750d12501`
- allowlist sha256 (config/public-repo.allowlist): `7012a98e1aabc0504bbf3d8e828cd2a3cbb202d5005d4bc508d2aa0823eb27ef`
- files published: 1000

## 2026-10-11 — publish from 9fc0e7d32aff

- monorepo commit: `9fc0e7d32affeae723652285f5346fcafb8634fa` (the working tree had uncommitted changes when this tag was written)
- program hash: `d4f39b47f6135bebe316f0c6cf11f40eaebfa236832187798282b6ff3dce5bf2` — sha256 of programs/burn-receipts/target/deploy/burn_receipts.so on the publishing host
- IDL sha256 (src/lib/burnReceipts/idl.ts): `5ef0c6a3e43df0c7ebd061bf577e82821a6a5a32bb1c3e1316e273d075c7741d`
- allowlist sha256 (config/public-repo.allowlist): `7012a98e1aabc0504bbf3d8e828cd2a3cbb202d5005d4bc508d2aa0823eb27ef`
- files published: 1012

## 2026-10-11 — publish from 46501d7e5d82

- monorepo commit: `46501d7e5d8285572035b608a40913899b98847a` (the working tree had uncommitted changes when this tag was written)
- program hash: `d4f39b47f6135bebe316f0c6cf11f40eaebfa236832187798282b6ff3dce5bf2` — sha256 of programs/burn-receipts/target/deploy/burn_receipts.so on the publishing host
- IDL sha256 (src/lib/burnReceipts/idl.ts): `5ef0c6a3e43df0c7ebd061bf577e82821a6a5a32bb1c3e1316e273d075c7741d`
- allowlist sha256 (config/public-repo.allowlist): `7012a98e1aabc0504bbf3d8e828cd2a3cbb202d5005d4bc508d2aa0823eb27ef`
- files published: 1030

## 2026-10-11 — publish from c9e812da196e

- monorepo commit: `c9e812da196e62946d78035ad3c98c02dff7cf70` (the working tree had uncommitted changes when this tag was written)
- program hash: `d4f39b47f6135bebe316f0c6cf11f40eaebfa236832187798282b6ff3dce5bf2` — sha256 of programs/burn-receipts/target/deploy/burn_receipts.so on the publishing host
- IDL sha256 (src/lib/burnReceipts/idl.ts): `5ef0c6a3e43df0c7ebd061bf577e82821a6a5a32bb1c3e1316e273d075c7741d`
- allowlist sha256 (config/public-repo.allowlist): `7012a98e1aabc0504bbf3d8e828cd2a3cbb202d5005d4bc508d2aa0823eb27ef`
- files published: 1032

## 2026-10-11 — publish from 701655de6906

- monorepo commit: `701655de69065d5f780bf90a49d5bbb24164b5a4` (the working tree had uncommitted changes when this tag was written)
- program hash: `869a6b9ca9df52233e7a62c7cd998a2ed1607f020fcc93bf62f2def222ec5c22` — sha256 of programs/burn-receipts/target/deploy/burn_receipts.so on the publishing host
- IDL sha256 (src/lib/burnReceipts/idl.ts): `f7a4eb92e5f00596226823f071a76c47f4fabfaa9cd95f2d7a230564f14ea12d`
- allowlist sha256 (config/public-repo.allowlist): `7012a98e1aabc0504bbf3d8e828cd2a3cbb202d5005d4bc508d2aa0823eb27ef`
- files published: 1067

## 2026-10-11 — publish from a348eef0c02d

- monorepo commit: `a348eef0c02d91b45a3f6ad4d4ca0d4ccfae64bd` (the working tree had uncommitted changes when this tag was written)
- program hash: `869a6b9ca9df52233e7a62c7cd998a2ed1607f020fcc93bf62f2def222ec5c22` — sha256 of programs/burn-receipts/target/deploy/burn_receipts.so on the publishing host
- IDL sha256 (src/lib/burnReceipts/idl.ts): `f7a4eb92e5f00596226823f071a76c47f4fabfaa9cd95f2d7a230564f14ea12d`
- allowlist sha256 (config/public-repo.allowlist): `7012a98e1aabc0504bbf3d8e828cd2a3cbb202d5005d4bc508d2aa0823eb27ef`
- files published: 1069

## 2026-10-11 — publish from 9d81ee5e1eff

- monorepo commit: `9d81ee5e1eff7b5495ba0020717e152439051ba1` (the working tree had uncommitted changes when this tag was written)
- program hash: `ac00ae8ef9c7791e73511413f3a53710d1275b242d25f4b91c2970d41562b316` — sha256 of programs/burn-receipts/target/deploy/burn_receipts.so on the publishing host
- IDL sha256 (src/lib/burnReceipts/idl.ts): `8f0fed930369e67f3c0d172159dd86311836304f5da7cc87a160075b95863574`
- allowlist sha256 (config/public-repo.allowlist): `7012a98e1aabc0504bbf3d8e828cd2a3cbb202d5005d4bc508d2aa0823eb27ef`
- files published: 1071

## 2026-10-11 — publish from 354d363855fe

- monorepo commit: `354d363855fec4732af8545c9472a94b7b3624ec` (the working tree had uncommitted changes when this tag was written)
- program hash: `ac00ae8ef9c7791e73511413f3a53710d1275b242d25f4b91c2970d41562b316` — sha256 of programs/burn-receipts/target/deploy/burn_receipts.so on the publishing host
- IDL sha256 (src/lib/burnReceipts/idl.ts): `8f0fed930369e67f3c0d172159dd86311836304f5da7cc87a160075b95863574`
- allowlist sha256 (config/public-repo.allowlist): `7012a98e1aabc0504bbf3d8e828cd2a3cbb202d5005d4bc508d2aa0823eb27ef`
- files published: 1074

## 2026-10-11 — publish from 9a337d448d68

- monorepo commit: `9a337d448d688ba495076bd97f6855dca4488204` (the working tree had uncommitted changes when this tag was written)
- program hash: `ac00ae8ef9c7791e73511413f3a53710d1275b242d25f4b91c2970d41562b316` — sha256 of programs/burn-receipts/target/deploy/burn_receipts.so on the publishing host
- IDL sha256 (src/lib/burnReceipts/idl.ts): `8f0fed930369e67f3c0d172159dd86311836304f5da7cc87a160075b95863574`
- allowlist sha256 (config/public-repo.allowlist): `7012a98e1aabc0504bbf3d8e828cd2a3cbb202d5005d4bc508d2aa0823eb27ef`
- files published: 1074

## 2026-10-11 — publish from d9dd0bd0bab4

- monorepo commit: `d9dd0bd0bab42d1e1df99496cfbfef81cb868400` (the working tree had uncommitted changes when this tag was written)
- program hash: `ac00ae8ef9c7791e73511413f3a53710d1275b242d25f4b91c2970d41562b316` — sha256 of programs/burn-receipts/target/deploy/burn_receipts.so on the publishing host
- IDL sha256 (src/lib/burnReceipts/idl.ts): `8f0fed930369e67f3c0d172159dd86311836304f5da7cc87a160075b95863574`
- allowlist sha256 (config/public-repo.allowlist): `7012a98e1aabc0504bbf3d8e828cd2a3cbb202d5005d4bc508d2aa0823eb27ef`
- files published: 1076

## 2026-10-11 — publish from 924ea66e25fb

- monorepo commit: `924ea66e25fbf187cca5cdcd2cd5cf616f05265d` (the working tree had uncommitted changes when this tag was written)
- program hash: `ac00ae8ef9c7791e73511413f3a53710d1275b242d25f4b91c2970d41562b316` — sha256 of programs/burn-receipts/target/deploy/burn_receipts.so on the publishing host
- IDL sha256 (src/lib/burnReceipts/idl.ts): `8f0fed930369e67f3c0d172159dd86311836304f5da7cc87a160075b95863574`
- allowlist sha256 (config/public-repo.allowlist): `7012a98e1aabc0504bbf3d8e828cd2a3cbb202d5005d4bc508d2aa0823eb27ef`
- files published: 1076

## 2026-10-11 — publish from 73a657ae0baa

- monorepo commit: `73a657ae0baa7ce4599a5dbe986921593671c043` (the working tree had uncommitted changes when this tag was written)
- program hash: `ac00ae8ef9c7791e73511413f3a53710d1275b242d25f4b91c2970d41562b316` — sha256 of programs/burn-receipts/target/deploy/burn_receipts.so on the publishing host
- IDL sha256 (src/lib/burnReceipts/idl.ts): `8f0fed930369e67f3c0d172159dd86311836304f5da7cc87a160075b95863574`
- allowlist sha256 (config/public-repo.allowlist): `7012a98e1aabc0504bbf3d8e828cd2a3cbb202d5005d4bc508d2aa0823eb27ef`
- files published: 1076

## 2026-10-11 — publish from d9c54e61b600

- monorepo commit: `d9c54e61b600fd5cfaf72943efbea087f47b9521` (the working tree had uncommitted changes when this tag was written)
- program hash: `7f26a83adf1f6bc6ea9a495fe6cc47fa78b3e45e78ab9919025fc5f1f4f25a9a` — sha256 of programs/burn-receipts/target/deploy/burn_receipts.so on the publishing host
- IDL sha256 (src/lib/burnReceipts/idl.ts): `209308d514373bdf45d920ff0724cbf27e1812f4ff2e49c84dc8c1aae9c02d55`
- allowlist sha256 (config/public-repo.allowlist): `7012a98e1aabc0504bbf3d8e828cd2a3cbb202d5005d4bc508d2aa0823eb27ef`
- files published: 1107

## 2026-10-11 — publish from 7ece3694d471

- monorepo commit: `7ece3694d471878910a5016166c209e0c3c1331b` (the working tree had uncommitted changes when this tag was written)
- program hash: `7f26a83adf1f6bc6ea9a495fe6cc47fa78b3e45e78ab9919025fc5f1f4f25a9a` — sha256 of programs/burn-receipts/target/deploy/burn_receipts.so on the publishing host
- IDL sha256 (src/lib/burnReceipts/idl.ts): `209308d514373bdf45d920ff0724cbf27e1812f4ff2e49c84dc8c1aae9c02d55`
- allowlist sha256 (config/public-repo.allowlist): `7012a98e1aabc0504bbf3d8e828cd2a3cbb202d5005d4bc508d2aa0823eb27ef`
- files published: 1117

## 2026-10-11 — publish from 54fdf4772247

- monorepo commit: `54fdf4772247bf0b84237a3a680ab8f3a08ece4b` (the working tree had uncommitted changes when this tag was written)
- program hash: `7f26a83adf1f6bc6ea9a495fe6cc47fa78b3e45e78ab9919025fc5f1f4f25a9a` — sha256 of programs/burn-receipts/target/deploy/burn_receipts.so on the publishing host
- IDL sha256 (src/lib/burnReceipts/idl.ts): `209308d514373bdf45d920ff0724cbf27e1812f4ff2e49c84dc8c1aae9c02d55`
- allowlist sha256 (config/public-repo.allowlist): `7012a98e1aabc0504bbf3d8e828cd2a3cbb202d5005d4bc508d2aa0823eb27ef`
- files published: 1139

## 2026-10-11 — publish from 8441ce5f88df

- monorepo commit: `8441ce5f88df0a60c220e7f4c0c027b1ed80604b` (the working tree had uncommitted changes when this tag was written)
- program hash: `7f26a83adf1f6bc6ea9a495fe6cc47fa78b3e45e78ab9919025fc5f1f4f25a9a` — sha256 of programs/burn-receipts/target/deploy/burn_receipts.so on the publishing host
- IDL sha256 (src/lib/burnReceipts/idl.ts): `209308d514373bdf45d920ff0724cbf27e1812f4ff2e49c84dc8c1aae9c02d55`
- allowlist sha256 (config/public-repo.allowlist): `7012a98e1aabc0504bbf3d8e828cd2a3cbb202d5005d4bc508d2aa0823eb27ef`
- files published: 1143

## 2026-10-11 — publish from 0f840262ff5e

- monorepo commit: `0f840262ff5ec381c1f944c1c13aea6334d7267c` (the working tree had uncommitted changes when this tag was written)
- program hash: `7f26a83adf1f6bc6ea9a495fe6cc47fa78b3e45e78ab9919025fc5f1f4f25a9a` — sha256 of programs/burn-receipts/target/deploy/burn_receipts.so on the publishing host
- IDL sha256 (src/lib/burnReceipts/idl.ts): `209308d514373bdf45d920ff0724cbf27e1812f4ff2e49c84dc8c1aae9c02d55`
- allowlist sha256 (config/public-repo.allowlist): `7012a98e1aabc0504bbf3d8e828cd2a3cbb202d5005d4bc508d2aa0823eb27ef`
- files published: 1149

## 2026-10-11 — publish from 38a839bcb801

- monorepo commit: `38a839bcb80170fcd5664454830d3f1fa2a340dd` (the working tree had uncommitted changes when this tag was written)
- program hash: `7f26a83adf1f6bc6ea9a495fe6cc47fa78b3e45e78ab9919025fc5f1f4f25a9a` — sha256 of programs/burn-receipts/target/deploy/burn_receipts.so on the publishing host
- IDL sha256 (src/lib/burnReceipts/idl.ts): `209308d514373bdf45d920ff0724cbf27e1812f4ff2e49c84dc8c1aae9c02d55`
- allowlist sha256 (config/public-repo.allowlist): `7012a98e1aabc0504bbf3d8e828cd2a3cbb202d5005d4bc508d2aa0823eb27ef`
- files published: 1152

## 2026-10-11 — publish from 4bb149575034

- monorepo commit: `4bb149575034191ce24f5583148da96eb5377b7e` (the working tree had uncommitted changes when this tag was written)
- program hash: `7f26a83adf1f6bc6ea9a495fe6cc47fa78b3e45e78ab9919025fc5f1f4f25a9a` — sha256 of programs/burn-receipts/target/deploy/burn_receipts.so on the publishing host
- IDL sha256 (src/lib/burnReceipts/idl.ts): `209308d514373bdf45d920ff0724cbf27e1812f4ff2e49c84dc8c1aae9c02d55`
- allowlist sha256 (config/public-repo.allowlist): `7012a98e1aabc0504bbf3d8e828cd2a3cbb202d5005d4bc508d2aa0823eb27ef`
- files published: 1152

## 2026-10-11 — publish from 4bb149575034

- monorepo commit: `4bb149575034191ce24f5583148da96eb5377b7e` (the working tree had uncommitted changes when this tag was written)
- program hash: `7f26a83adf1f6bc6ea9a495fe6cc47fa78b3e45e78ab9919025fc5f1f4f25a9a` — sha256 of programs/burn-receipts/target/deploy/burn_receipts.so on the publishing host
- IDL sha256 (src/lib/burnReceipts/idl.ts): `209308d514373bdf45d920ff0724cbf27e1812f4ff2e49c84dc8c1aae9c02d55`
- allowlist sha256 (config/public-repo.allowlist): `7012a98e1aabc0504bbf3d8e828cd2a3cbb202d5005d4bc508d2aa0823eb27ef`
- files published: 1152

## 2026-10-11 — publish from 4bb149575034

- monorepo commit: `4bb149575034191ce24f5583148da96eb5377b7e` (the working tree had uncommitted changes when this tag was written)
- program hash: `7f26a83adf1f6bc6ea9a495fe6cc47fa78b3e45e78ab9919025fc5f1f4f25a9a` — sha256 of programs/burn-receipts/target/deploy/burn_receipts.so on the publishing host
- IDL sha256 (src/lib/burnReceipts/idl.ts): `209308d514373bdf45d920ff0724cbf27e1812f4ff2e49c84dc8c1aae9c02d55`
- allowlist sha256 (config/public-repo.allowlist): `7012a98e1aabc0504bbf3d8e828cd2a3cbb202d5005d4bc508d2aa0823eb27ef`
- files published: 1152

## 2026-10-11 — publish from 5c6d1f4f25d0

- monorepo commit: `5c6d1f4f25d06995874fe5c8f96d3e4380663a2b` (the working tree had uncommitted changes when this tag was written)
- program hash: `7f26a83adf1f6bc6ea9a495fe6cc47fa78b3e45e78ab9919025fc5f1f4f25a9a` — sha256 of programs/burn-receipts/target/deploy/burn_receipts.so on the publishing host
- IDL sha256 (src/lib/burnReceipts/idl.ts): `209308d514373bdf45d920ff0724cbf27e1812f4ff2e49c84dc8c1aae9c02d55`
- allowlist sha256 (config/public-repo.allowlist): `7012a98e1aabc0504bbf3d8e828cd2a3cbb202d5005d4bc508d2aa0823eb27ef`
- files published: 1153

## 2026-10-11 — publish from f3d1702cffcb

- monorepo commit: `f3d1702cffcbcf0e5c6248aa26ed8d485f9b751b` (the working tree had uncommitted changes when this tag was written)
- program hash: `7f26a83adf1f6bc6ea9a495fe6cc47fa78b3e45e78ab9919025fc5f1f4f25a9a` — sha256 of programs/burn-receipts/target/deploy/burn_receipts.so on the publishing host
- IDL sha256 (src/lib/burnReceipts/idl.ts): `209308d514373bdf45d920ff0724cbf27e1812f4ff2e49c84dc8c1aae9c02d55`
- allowlist sha256 (config/public-repo.allowlist): `7012a98e1aabc0504bbf3d8e828cd2a3cbb202d5005d4bc508d2aa0823eb27ef`
- files published: 1168

## 2026-10-11 — publish from f89ecf49ca2e

- monorepo commit: `f89ecf49ca2ec99c3d21e5dadff1b544e1153785` (the working tree had uncommitted changes when this tag was written)
- program hash: `7f26a83adf1f6bc6ea9a495fe6cc47fa78b3e45e78ab9919025fc5f1f4f25a9a` — sha256 of programs/burn-receipts/target/deploy/burn_receipts.so on the publishing host
- IDL sha256 (src/lib/burnReceipts/idl.ts): `209308d514373bdf45d920ff0724cbf27e1812f4ff2e49c84dc8c1aae9c02d55`
- allowlist sha256 (config/public-repo.allowlist): `7012a98e1aabc0504bbf3d8e828cd2a3cbb202d5005d4bc508d2aa0823eb27ef`
- files published: 1168

## 2026-10-11 — publish from ade1fc894885

- monorepo commit: `ade1fc89488546f07000c10aa1e28d11fb072b0c` (the working tree had uncommitted changes when this tag was written)
- program hash: `7f26a83adf1f6bc6ea9a495fe6cc47fa78b3e45e78ab9919025fc5f1f4f25a9a` — sha256 of programs/burn-receipts/target/deploy/burn_receipts.so on the publishing host
- IDL sha256 (src/lib/burnReceipts/idl.ts): `209308d514373bdf45d920ff0724cbf27e1812f4ff2e49c84dc8c1aae9c02d55`
- allowlist sha256 (config/public-repo.allowlist): `7012a98e1aabc0504bbf3d8e828cd2a3cbb202d5005d4bc508d2aa0823eb27ef`
- files published: 1202

## 2026-10-11 — publish from 7a80f7eafd33

- monorepo commit: `7a80f7eafd333cab2b223a7fd9f024805e9963da` (the working tree had uncommitted changes when this tag was written)
- program hash: `7f26a83adf1f6bc6ea9a495fe6cc47fa78b3e45e78ab9919025fc5f1f4f25a9a` — sha256 of programs/burn-receipts/target/deploy/burn_receipts.so on the publishing host
- IDL sha256 (src/lib/burnReceipts/idl.ts): `209308d514373bdf45d920ff0724cbf27e1812f4ff2e49c84dc8c1aae9c02d55`
- allowlist sha256 (config/public-repo.allowlist): `7012a98e1aabc0504bbf3d8e828cd2a3cbb202d5005d4bc508d2aa0823eb27ef`
- files published: 1205

## 2026-10-11 — publish from f9d30e4e65cf

- monorepo commit: `f9d30e4e65cf4b7cbbfee2cb29343411f16644c9` (the working tree had uncommitted changes when this tag was written)
- program hash: `7f26a83adf1f6bc6ea9a495fe6cc47fa78b3e45e78ab9919025fc5f1f4f25a9a` — sha256 of programs/burn-receipts/target/deploy/burn_receipts.so on the publishing host
- IDL sha256 (src/lib/burnReceipts/idl.ts): `209308d514373bdf45d920ff0724cbf27e1812f4ff2e49c84dc8c1aae9c02d55`
- allowlist sha256 (config/public-repo.allowlist): `7012a98e1aabc0504bbf3d8e828cd2a3cbb202d5005d4bc508d2aa0823eb27ef`
- files published: 1204

## 2026-10-11 — launch: v0 transactions + per-network lookup table (re-check 2026-10-11)

- launch: v0 transactions + per-network lookup table (re-check 2026-10-11). Every launch step the site signs is a version-0
  transaction compiled against the network's address lookup table, verified in the browser before signing; a real single coin is
  988 bytes (1,262 as legacy). The table address is pinned per network in `src/lib/burnticker/networks.ts` once created
  (`scripts/burnticker-lut.mts`); until then the launch page does not sign.
- launch: a plan whose mint key was lost on reload is shown as abandoned, step by step, with the fee already spent; its only action is
  a new plan (review-2 F4 residual).

## 2026-10-11 — publish from ab0a5a1c4d27

- monorepo commit: `ab0a5a1c4d2712baecb53a62082c5b78b3d0a046` (the working tree had uncommitted changes when this tag was written)
- program hash: `7f26a83adf1f6bc6ea9a495fe6cc47fa78b3e45e78ab9919025fc5f1f4f25a9a` — sha256 of programs/burn-receipts/target/deploy/burn_receipts.so on the publishing host
- IDL sha256 (src/lib/burnReceipts/idl.ts): `209308d514373bdf45d920ff0724cbf27e1812f4ff2e49c84dc8c1aae9c02d55`
- allowlist sha256 (config/public-repo.allowlist): `7012a98e1aabc0504bbf3d8e828cd2a3cbb202d5005d4bc508d2aa0823eb27ef`
- files published: 1241

## 2026-10-11 — publish from c9baa75b9c11

- monorepo commit: `c9baa75b9c11898b4b05c38156ff6c21cdb7adb2` (the working tree had uncommitted changes when this tag was written)
- program hash: `7f26a83adf1f6bc6ea9a495fe6cc47fa78b3e45e78ab9919025fc5f1f4f25a9a` — sha256 of programs/burn-receipts/target/deploy/burn_receipts.so on the publishing host
- IDL sha256 (src/lib/burnReceipts/idl.ts): `209308d514373bdf45d920ff0724cbf27e1812f4ff2e49c84dc8c1aae9c02d55`
- allowlist sha256 (config/public-repo.allowlist): `7012a98e1aabc0504bbf3d8e828cd2a3cbb202d5005d4bc508d2aa0823eb27ef`
- files published: 1242

## 2026-10-12 — publish from 44a23725ad75

- monorepo commit: `44a23725ad7528606d16ccaacea3d1a8d786899e` (the working tree had uncommitted changes when this tag was written)
- program hash: `7f26a83adf1f6bc6ea9a495fe6cc47fa78b3e45e78ab9919025fc5f1f4f25a9a` — sha256 of programs/burn-receipts/target/deploy/burn_receipts.so on the publishing host
- IDL sha256 (src/lib/burnReceipts/idl.ts): `209308d514373bdf45d920ff0724cbf27e1812f4ff2e49c84dc8c1aae9c02d55`
- allowlist sha256 (config/public-repo.allowlist): `7012a98e1aabc0504bbf3d8e828cd2a3cbb202d5005d4bc508d2aa0823eb27ef`
- files published: 1242

## 2026-10-12 — publish from 1c942b12087b

- monorepo commit: `1c942b12087b8efb8f509e13c2512bafb3f21aa7` (the working tree had uncommitted changes when this tag was written)
- program hash: `7f26a83adf1f6bc6ea9a495fe6cc47fa78b3e45e78ab9919025fc5f1f4f25a9a` — sha256 of programs/burn-receipts/target/deploy/burn_receipts.so on the publishing host
- IDL sha256 (src/lib/burnReceipts/idl.ts): `209308d514373bdf45d920ff0724cbf27e1812f4ff2e49c84dc8c1aae9c02d55`
- allowlist sha256 (config/public-repo.allowlist): `7012a98e1aabc0504bbf3d8e828cd2a3cbb202d5005d4bc508d2aa0823eb27ef`
- files published: 1255

## 2026-10-12 — publish from e1915d7d6649

- monorepo commit: `e1915d7d664921aa553620eaf9134090f2a42744` (the working tree had uncommitted changes when this tag was written)
- program hash: `7f26a83adf1f6bc6ea9a495fe6cc47fa78b3e45e78ab9919025fc5f1f4f25a9a` — sha256 of programs/burn-receipts/target/deploy/burn_receipts.so on the publishing host
- IDL sha256 (src/lib/burnReceipts/idl.ts): `209308d514373bdf45d920ff0724cbf27e1812f4ff2e49c84dc8c1aae9c02d55`
- allowlist sha256 (config/public-repo.allowlist): `7012a98e1aabc0504bbf3d8e828cd2a3cbb202d5005d4bc508d2aa0823eb27ef`
- files published: 1271

## 2026-10-12 — publish from 79ba47fdb5b8

- monorepo commit: `79ba47fdb5b8fc5161f24026e85a718d6585468e` (the working tree had uncommitted changes when this tag was written)
- program hash: `7f26a83adf1f6bc6ea9a495fe6cc47fa78b3e45e78ab9919025fc5f1f4f25a9a` — sha256 of programs/burn-receipts/target/deploy/burn_receipts.so on the publishing host
- IDL sha256 (src/lib/burnReceipts/idl.ts): `209308d514373bdf45d920ff0724cbf27e1812f4ff2e49c84dc8c1aae9c02d55`
- allowlist sha256 (config/public-repo.allowlist): `7012a98e1aabc0504bbf3d8e828cd2a3cbb202d5005d4bc508d2aa0823eb27ef`
- files published: 1271

## 2026-10-12 — publish from 743846d54a69

- monorepo commit: `743846d54a69b325ee56b9baf6555d0da8178c4f` (the working tree had uncommitted changes when this tag was written)
- program hash: `7f26a83adf1f6bc6ea9a495fe6cc47fa78b3e45e78ab9919025fc5f1f4f25a9a` — sha256 of programs/burn-receipts/target/deploy/burn_receipts.so on the publishing host
- IDL sha256 (src/lib/burnReceipts/idl.ts): `209308d514373bdf45d920ff0724cbf27e1812f4ff2e49c84dc8c1aae9c02d55`
- allowlist sha256 (config/public-repo.allowlist): `f2b9bec2accd99971553d6804d08c38e6ee256dfa7fb2a1d3704cc2366625214`
- files published: 1291

## 2026-10-12 — publish from a69fc30307b9

- monorepo commit: `a69fc30307b9b643f563b90ada0044a9890f596a` (the working tree had uncommitted changes when this tag was written)
- program hash: `7f26a83adf1f6bc6ea9a495fe6cc47fa78b3e45e78ab9919025fc5f1f4f25a9a` — sha256 of programs/burn-receipts/target/deploy/burn_receipts.so on the publishing host
- IDL sha256 (src/lib/burnReceipts/idl.ts): `209308d514373bdf45d920ff0724cbf27e1812f4ff2e49c84dc8c1aae9c02d55`
- allowlist sha256 (config/public-repo.allowlist): `f2b9bec2accd99971553d6804d08c38e6ee256dfa7fb2a1d3704cc2366625214`
- files published: 1291

## 2026-10-12 — publish from e9e8d0e772cf

- monorepo commit: `e9e8d0e772cf8e5ea357243acfd313b6e9b80527` (the working tree had uncommitted changes when this tag was written)
- program hash: `7f26a83adf1f6bc6ea9a495fe6cc47fa78b3e45e78ab9919025fc5f1f4f25a9a` — sha256 of programs/burn-receipts/target/deploy/burn_receipts.so on the publishing host
- IDL sha256 (src/lib/burnReceipts/idl.ts): `209308d514373bdf45d920ff0724cbf27e1812f4ff2e49c84dc8c1aae9c02d55`
- allowlist sha256 (config/public-repo.allowlist): `f2b9bec2accd99971553d6804d08c38e6ee256dfa7fb2a1d3704cc2366625214`
- files published: 1319

## 2026-10-12 — publish from 37cabb9c48f8

- monorepo commit: `37cabb9c48f8fd285a06d947b8450940a2458de5` (the working tree had uncommitted changes when this tag was written)
- program hash: `7f26a83adf1f6bc6ea9a495fe6cc47fa78b3e45e78ab9919025fc5f1f4f25a9a` — sha256 of programs/burn-receipts/target/deploy/burn_receipts.so on the publishing host
- IDL sha256 (src/lib/burnReceipts/idl.ts): `209308d514373bdf45d920ff0724cbf27e1812f4ff2e49c84dc8c1aae9c02d55`
- allowlist sha256 (config/public-repo.allowlist): `f2b9bec2accd99971553d6804d08c38e6ee256dfa7fb2a1d3704cc2366625214`
- files published: 1319

## 2026-10-12 — publish from 15d6baf7e9bf

- monorepo commit: `15d6baf7e9bfcad41a082cf2dc3b6fb6b231b648` (the working tree had uncommitted changes when this tag was written)
- program hash: `7f26a83adf1f6bc6ea9a495fe6cc47fa78b3e45e78ab9919025fc5f1f4f25a9a` — sha256 of programs/burn-receipts/target/deploy/burn_receipts.so on the publishing host
- IDL sha256 (src/lib/burnReceipts/idl.ts): `decc3a1e20d516b664feb5929f69c4995225f3d01c5caaadffb9c43bdcfc0322`
- allowlist sha256 (config/public-repo.allowlist): `f2b9bec2accd99971553d6804d08c38e6ee256dfa7fb2a1d3704cc2366625214`
- files published: 1368

## 2026-10-12 — publish from 92c0ffba20af

- monorepo commit: `92c0ffba20af77308249a598828aaa9ca9e3e253` (the working tree had uncommitted changes when this tag was written)
- program hash: `7f26a83adf1f6bc6ea9a495fe6cc47fa78b3e45e78ab9919025fc5f1f4f25a9a` — sha256 of programs/burn-receipts/target/deploy/burn_receipts.so on the publishing host
- IDL sha256 (src/lib/burnReceipts/idl.ts): `decc3a1e20d516b664feb5929f69c4995225f3d01c5caaadffb9c43bdcfc0322`
- allowlist sha256 (config/public-repo.allowlist): `f2b9bec2accd99971553d6804d08c38e6ee256dfa7fb2a1d3704cc2366625214`
- files published: 1401

## 2026-10-12 — publish from 56d9b636e741

- monorepo commit: `56d9b636e7415d2a32bd7071d0da7b16021fd1d4` (the working tree had uncommitted changes when this tag was written)
- program hash: `7f26a83adf1f6bc6ea9a495fe6cc47fa78b3e45e78ab9919025fc5f1f4f25a9a` — sha256 of programs/burn-receipts/target/deploy/burn_receipts.so on the publishing host
- IDL sha256 (src/lib/burnReceipts/idl.ts): `decc3a1e20d516b664feb5929f69c4995225f3d01c5caaadffb9c43bdcfc0322`
- allowlist sha256 (config/public-repo.allowlist): `f2b9bec2accd99971553d6804d08c38e6ee256dfa7fb2a1d3704cc2366625214`
- files published: 1403

## 2026-10-12 — publish from 716ffd3be061

- monorepo commit: `716ffd3be06116b844bbcf316e29945d9aa442a6` (the working tree had uncommitted changes when this tag was written)
- program hash: `7f26a83adf1f6bc6ea9a495fe6cc47fa78b3e45e78ab9919025fc5f1f4f25a9a` — sha256 of programs/burn-receipts/target/deploy/burn_receipts.so on the publishing host
- IDL sha256 (src/lib/burnReceipts/idl.ts): `decc3a1e20d516b664feb5929f69c4995225f3d01c5caaadffb9c43bdcfc0322`
- allowlist sha256 (config/public-repo.allowlist): `f2b9bec2accd99971553d6804d08c38e6ee256dfa7fb2a1d3704cc2366625214`
- files published: 1403

## 2026-10-12 — publish from 7f8064b0a49a

- monorepo commit: `7f8064b0a49a0094e8543f5548b4cacdf3934c41` (the working tree had uncommitted changes when this tag was written)
- program hash: `7f26a83adf1f6bc6ea9a495fe6cc47fa78b3e45e78ab9919025fc5f1f4f25a9a` — sha256 of programs/burn-receipts/target/deploy/burn_receipts.so on the publishing host
- IDL sha256 (src/lib/burnReceipts/idl.ts): `decc3a1e20d516b664feb5929f69c4995225f3d01c5caaadffb9c43bdcfc0322`
- allowlist sha256 (config/public-repo.allowlist): `f2b9bec2accd99971553d6804d08c38e6ee256dfa7fb2a1d3704cc2366625214`
- files published: 1404

## 2026-10-12 — public commits recorded after the fact (no publish, no deploy)

The publish entries above name the monorepo commit each public tree was cut from. The public repository's own commit for each one was
named only in the monorepo commit that wrote the tag. These lines record it here so /burnticker/changelog can link each release to the
public repository at that commit. A release whose tag commit did not name exactly one public commit stays unlinked. When two tags were
written before one public commit, the commit is recorded against the later tag. From now on a publish entry may carry its own
`- public commit:` line.

- publish from 24169e899c75: public commit `af233100bfa1c0493800eb942aa8fcd9936cb0fe`
- publish from 359a3490985a: public commit `15c5c131c7002fa862ba05aef508ebfb270668b3`
- publish from 9fc0e7d32aff: public commit `ac1759131966f9e6adc2986bfe737a55b6cf35a1`
- publish from 46501d7e5d82: public commit `203f5bd07765b4e1708332f69b3f4b899f6bc6e7`
- publish from c9e812da196e: public commit `e7992c9fd8734bd2ed6585113f9c9111a486d420`
- publish from a348eef0c02d: public commit `d9f60f67737a6d0b6aa1031d609304272d03333c`
- publish from 354d363855fe: public commit `9634d473d5e312fb86505913b75917fc0c963ead`
- publish from 9a337d448d68: public commit `b728aa1ce00c27cd6f9b52695118e476f7376205`
- publish from 73a657ae0baa: public commit `4bf8e0dfc5e7f8c6c46f7c35ffb7e1eb6c91b189`
- publish from ab0a5a1c4d27: public commit `f5d179fa8cbca599fd040c5bd2dedde457d9fd1d`
- publish from c9baa75b9c11: public commit `f7c2ada2803aed2695b57293d0c8a494323efa21`
- publish from 44a23725ad75: public commit `d9e5a151692f04dca5e3613beed318e9c3aa1514`
- publish from 1c942b12087b: public commit `af52b4a4ea0b80168a4c2e0f47a32045d1035c91`
- publish from 79ba47fdb5b8: public commit `0304267b345ce56110ee3503904097687a011837`
- publish from a69fc30307b9: public commit `c2bbcd9c1167510ef2a148e09e611ea4b14b91be`
- publish from e9e8d0e772cf: public commit `8a519590a0d34940936e8fe64ab1989d073e4457`
- publish from 37cabb9c48f8: public commit `4f01c4687ae91a72027b5dd4362e3998dbf747e9`
- publish from 15d6baf7e9bf: public commit `7e7bab5804f9e3dee070ebbc2bd3ba1de1c6b999`
- publish from 92c0ffba20af: public commit `b139dbf64e066bb3b6ac32c28c234e7ec9855e69`
- publish from 716ffd3be061: public commit `4a0b7203dfe0e6a973472e1c06de87b659237ef6`
- publish from 7f8064b0a49a: public commit `1f22d4ac38a218bc9afcf31e0c52628fda8fac9f`

## 2026-10-12 — publish from 86e4bfa95667

- monorepo commit: `86e4bfa9566718eb8025d887ca11d7abdffc54a3` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `decc3a1e20d516b664feb5929f69c4995225f3d01c5caaadffb9c43bdcfc0322`
- allowlist sha256 (config/public-repo.allowlist): `f2b9bec2accd99971553d6804d08c38e6ee256dfa7fb2a1d3704cc2366625214`
- files published: 1699

## 2026-10-12 — publish from 86e4bfa95667

- monorepo commit: `86e4bfa9566718eb8025d887ca11d7abdffc54a3` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `decc3a1e20d516b664feb5929f69c4995225f3d01c5caaadffb9c43bdcfc0322`
- allowlist sha256 (config/public-repo.allowlist): `f2b9bec2accd99971553d6804d08c38e6ee256dfa7fb2a1d3704cc2366625214`
- files published: 1699

## 2026-10-12 — publish from af2a8442ee68

- monorepo commit: `af2a8442ee6843fca56c0fba69d9031f0549c412` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `decc3a1e20d516b664feb5929f69c4995225f3d01c5caaadffb9c43bdcfc0322`
- allowlist sha256 (config/public-repo.allowlist): `f2b9bec2accd99971553d6804d08c38e6ee256dfa7fb2a1d3704cc2366625214`
- files published: 1701

## 2026-10-12 — publish from f1e6afd44995

- monorepo commit: `f1e6afd449955bf8d395243700f180879f787521` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `decc3a1e20d516b664feb5929f69c4995225f3d01c5caaadffb9c43bdcfc0322`
- allowlist sha256 (config/public-repo.allowlist): `f2b9bec2accd99971553d6804d08c38e6ee256dfa7fb2a1d3704cc2366625214`
- files published: 1718

## 2026-10-12 — publish from b6c0e3eccbba

- monorepo commit: `b6c0e3eccbba5adcc58eeaaf5d482943473b93ec` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `decc3a1e20d516b664feb5929f69c4995225f3d01c5caaadffb9c43bdcfc0322`
- allowlist sha256 (config/public-repo.allowlist): `f2b9bec2accd99971553d6804d08c38e6ee256dfa7fb2a1d3704cc2366625214`
- files published: 1731

## 2026-10-12 — publish from 72af9c36c122

- monorepo commit: `72af9c36c1227e6b86d91ae7af35a4605413dd08` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `decc3a1e20d516b664feb5929f69c4995225f3d01c5caaadffb9c43bdcfc0322`
- allowlist sha256 (config/public-repo.allowlist): `f2b9bec2accd99971553d6804d08c38e6ee256dfa7fb2a1d3704cc2366625214`
- files published: 1783

## 2026-10-12 — publish from 03b36a5f055c

- monorepo commit: `03b36a5f055c43e1826bc754a05cf039bc997498` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `decc3a1e20d516b664feb5929f69c4995225f3d01c5caaadffb9c43bdcfc0322`
- allowlist sha256 (config/public-repo.allowlist): `f2b9bec2accd99971553d6804d08c38e6ee256dfa7fb2a1d3704cc2366625214`
- files published: 1783

## 2026-10-12 — publish from 39ba2fa12ab3

- monorepo commit: `39ba2fa12ab34bf107dfd5e789d938af7e09a48f` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `decc3a1e20d516b664feb5929f69c4995225f3d01c5caaadffb9c43bdcfc0322`
- allowlist sha256 (config/public-repo.allowlist): `f2b9bec2accd99971553d6804d08c38e6ee256dfa7fb2a1d3704cc2366625214`
- files published: 1783

## 2026-10-12 — publish from 16cbda77dedb

- monorepo commit: `16cbda77dedbab33fc454d3091b44def70e4bd25` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `decc3a1e20d516b664feb5929f69c4995225f3d01c5caaadffb9c43bdcfc0322`
- allowlist sha256 (config/public-repo.allowlist): `2113c2e4d31ce9a07eb17e5e32cf5eea6ecdea8ad3d6c214a8c2ee641dd69949`
- files published: 1785

## 2026-10-12 — publish from 13f85aabc19a

- monorepo commit: `13f85aabc19af588386b3bac711188be333b80f5` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `decc3a1e20d516b664feb5929f69c4995225f3d01c5caaadffb9c43bdcfc0322`
- allowlist sha256 (config/public-repo.allowlist): `2113c2e4d31ce9a07eb17e5e32cf5eea6ecdea8ad3d6c214a8c2ee641dd69949`
- files published: 1785

## 2026-10-12 — publish from 501496455f6f

- monorepo commit: `501496455f6fe9f0c634bf9b7f4c5deaecd5beaf` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `decc3a1e20d516b664feb5929f69c4995225f3d01c5caaadffb9c43bdcfc0322`
- allowlist sha256 (config/public-repo.allowlist): `2113c2e4d31ce9a07eb17e5e32cf5eea6ecdea8ad3d6c214a8c2ee641dd69949`
- files published: 1793

## 2026-10-12 — publish from 501496455f6f

- monorepo commit: `501496455f6fe9f0c634bf9b7f4c5deaecd5beaf` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `decc3a1e20d516b664feb5929f69c4995225f3d01c5caaadffb9c43bdcfc0322`
- allowlist sha256 (config/public-repo.allowlist): `2113c2e4d31ce9a07eb17e5e32cf5eea6ecdea8ad3d6c214a8c2ee641dd69949`
- files published: 1793

## 2026-10-12 — publish from e7d86a10584a

- monorepo commit: `e7d86a10584a39982391909d7b3dbbe4a0af7117` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `decc3a1e20d516b664feb5929f69c4995225f3d01c5caaadffb9c43bdcfc0322`
- allowlist sha256 (config/public-repo.allowlist): `2113c2e4d31ce9a07eb17e5e32cf5eea6ecdea8ad3d6c214a8c2ee641dd69949`
- files published: 1795

## 2026-10-12 — publish from e96dec284202

- monorepo commit: `e96dec28420271afc5fa3f2de401a926a7127626` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `decc3a1e20d516b664feb5929f69c4995225f3d01c5caaadffb9c43bdcfc0322`
- allowlist sha256 (config/public-repo.allowlist): `2113c2e4d31ce9a07eb17e5e32cf5eea6ecdea8ad3d6c214a8c2ee641dd69949`
- files published: 1795

## 2026-10-12 — publish from 42d0d50171dc

- monorepo commit: `42d0d50171dcf1216fe643d683f5fa8c11b83acb` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `decc3a1e20d516b664feb5929f69c4995225f3d01c5caaadffb9c43bdcfc0322`
- allowlist sha256 (config/public-repo.allowlist): `2113c2e4d31ce9a07eb17e5e32cf5eea6ecdea8ad3d6c214a8c2ee641dd69949`
- files published: 1797

## 2026-10-13 — publish from 389014667cf2

- monorepo commit: `389014667cf28eec12e2c3cf816be247135afac1` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `decc3a1e20d516b664feb5929f69c4995225f3d01c5caaadffb9c43bdcfc0322`
- allowlist sha256 (config/public-repo.allowlist): `2113c2e4d31ce9a07eb17e5e32cf5eea6ecdea8ad3d6c214a8c2ee641dd69949`
- files published: 1809

## 2026-10-13 — publish from 788e8854fab6

- monorepo commit: `788e8854fab6f1f3175d102cd213cf9c295ed286` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `decc3a1e20d516b664feb5929f69c4995225f3d01c5caaadffb9c43bdcfc0322`
- allowlist sha256 (config/public-repo.allowlist): `2113c2e4d31ce9a07eb17e5e32cf5eea6ecdea8ad3d6c214a8c2ee641dd69949`
- files published: 1809

## 2026-10-13 — publish from a47a11321dae

- monorepo commit: `a47a11321dae7056605c17ebfa0174805660d477` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `decc3a1e20d516b664feb5929f69c4995225f3d01c5caaadffb9c43bdcfc0322`
- allowlist sha256 (config/public-repo.allowlist): `2113c2e4d31ce9a07eb17e5e32cf5eea6ecdea8ad3d6c214a8c2ee641dd69949`
- files published: 1819

## 2026-10-13 — publish from 3983a396a61c

- monorepo commit: `3983a396a61cc926022e634b45c790aef0888137` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `decc3a1e20d516b664feb5929f69c4995225f3d01c5caaadffb9c43bdcfc0322`
- allowlist sha256 (config/public-repo.allowlist): `2113c2e4d31ce9a07eb17e5e32cf5eea6ecdea8ad3d6c214a8c2ee641dd69949`
- files published: 1819

## 2026-10-13 — publish from 5bf5d4c201b3

- monorepo commit: `5bf5d4c201b35e76e8949d8efd9233e0a11f0377` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `995e53462fd461be9053d15c38876d8a5694ebe4a6169cb5a1ea1a39050c90c1`
- allowlist sha256 (config/public-repo.allowlist): `2113c2e4d31ce9a07eb17e5e32cf5eea6ecdea8ad3d6c214a8c2ee641dd69949`
- files published: 1840

## 2026-10-13 — publish from a4a9daeac22c

- monorepo commit: `a4a9daeac22cec219d112768a141397998b26cd3` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `995e53462fd461be9053d15c38876d8a5694ebe4a6169cb5a1ea1a39050c90c1`
- allowlist sha256 (config/public-repo.allowlist): `2113c2e4d31ce9a07eb17e5e32cf5eea6ecdea8ad3d6c214a8c2ee641dd69949`
- files published: 1855

## 2026-10-13 — publish from 4a49f8d5a442

- monorepo commit: `4a49f8d5a4428a36a01f27aa6cf98abbd5f72bdf` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `995e53462fd461be9053d15c38876d8a5694ebe4a6169cb5a1ea1a39050c90c1`
- allowlist sha256 (config/public-repo.allowlist): `2113c2e4d31ce9a07eb17e5e32cf5eea6ecdea8ad3d6c214a8c2ee641dd69949`
- files published: 1857

## 2026-10-13 — publish from 8be3d70411d0

- monorepo commit: `8be3d70411d08dedd3d7028edcc282524c2c8ee2` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `995e53462fd461be9053d15c38876d8a5694ebe4a6169cb5a1ea1a39050c90c1`
- allowlist sha256 (config/public-repo.allowlist): `5f2e35cdb9f5e584a4bde31d8bb9152f2bda5180c0132231189ded58060f5a0d`
- files published: 1859

## 2026-10-13 — publish from a313df08fd3f

- monorepo commit: `a313df08fd3f9a12315e6ef0147816d3ae9c5da1` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `c4bf144f73da1ad624c620d7c8f4a11db268bf32c02e8b3102ea9646894fcc32`
- allowlist sha256 (config/public-repo.allowlist): `5f2e35cdb9f5e584a4bde31d8bb9152f2bda5180c0132231189ded58060f5a0d`
- files published: 1864

## 2026-10-13 — publish from ea7527829e92

- monorepo commit: `ea7527829e920c466157cc3599961980dc880675` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `c4bf144f73da1ad624c620d7c8f4a11db268bf32c02e8b3102ea9646894fcc32`
- allowlist sha256 (config/public-repo.allowlist): `5f2e35cdb9f5e584a4bde31d8bb9152f2bda5180c0132231189ded58060f5a0d`
- files published: 1887

## 2026-10-13 — publish from 36e008780251

- monorepo commit: `36e0087802514042bbaf3e5de806895c36f37bf9` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `c4bf144f73da1ad624c620d7c8f4a11db268bf32c02e8b3102ea9646894fcc32`
- allowlist sha256 (config/public-repo.allowlist): `5f2e35cdb9f5e584a4bde31d8bb9152f2bda5180c0132231189ded58060f5a0d`
- files published: 1900

## 2026-10-13 — publish from 3ff396161e0f

- monorepo commit: `3ff396161e0ff92cec1fe9fb47a9615ba5b8bb2a` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `c4bf144f73da1ad624c620d7c8f4a11db268bf32c02e8b3102ea9646894fcc32`
- allowlist sha256 (config/public-repo.allowlist): `5f2e35cdb9f5e584a4bde31d8bb9152f2bda5180c0132231189ded58060f5a0d`
- files published: 1900

## 2026-10-13 — publish from cd23e91399de

- monorepo commit: `cd23e91399de30603a93c024092855d5f2598a4e` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `c4bf144f73da1ad624c620d7c8f4a11db268bf32c02e8b3102ea9646894fcc32`
- allowlist sha256 (config/public-repo.allowlist): `5f2e35cdb9f5e584a4bde31d8bb9152f2bda5180c0132231189ded58060f5a0d`
- files published: 1905

## 2026-10-13 — publish from 3559dca546b9

- monorepo commit: `3559dca546b99133034c4891367644246ddf66cf` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `c4bf144f73da1ad624c620d7c8f4a11db268bf32c02e8b3102ea9646894fcc32`
- allowlist sha256 (config/public-repo.allowlist): `5f2e35cdb9f5e584a4bde31d8bb9152f2bda5180c0132231189ded58060f5a0d`
- files published: 1905

## 2026-10-13 — publish from 51032098f12e

- monorepo commit: `51032098f12e6a8383b92cb880eb4bb563610d9e` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `c4bf144f73da1ad624c620d7c8f4a11db268bf32c02e8b3102ea9646894fcc32`
- allowlist sha256 (config/public-repo.allowlist): `5f2e35cdb9f5e584a4bde31d8bb9152f2bda5180c0132231189ded58060f5a0d`
- files published: 1906

## 2026-10-13 — publish from 7118476d29dc

- monorepo commit: `7118476d29dc42deac70835c1b46a7bfd5e05e97` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `c4bf144f73da1ad624c620d7c8f4a11db268bf32c02e8b3102ea9646894fcc32`
- allowlist sha256 (config/public-repo.allowlist): `5f2e35cdb9f5e584a4bde31d8bb9152f2bda5180c0132231189ded58060f5a0d`
- files published: 1908

## 2026-10-13 — publish from 90b7ac1465f7

- monorepo commit: `90b7ac1465f74ee2760e6d37da65c414434ad7a2` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `c4bf144f73da1ad624c620d7c8f4a11db268bf32c02e8b3102ea9646894fcc32`
- allowlist sha256 (config/public-repo.allowlist): `5f2e35cdb9f5e584a4bde31d8bb9152f2bda5180c0132231189ded58060f5a0d`
- files published: 1910

## 2026-10-13 — publish from d55ba81412cd

- monorepo commit: `d55ba81412cd4deb2545ca9d02e2c0fd66b0290d` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `c4bf144f73da1ad624c620d7c8f4a11db268bf32c02e8b3102ea9646894fcc32`
- allowlist sha256 (config/public-repo.allowlist): `5f2e35cdb9f5e584a4bde31d8bb9152f2bda5180c0132231189ded58060f5a0d`
- files published: 1915

## 2026-10-13 — publish from 88609032112a

- monorepo commit: `88609032112ae06ba57604214d1db67e204a298a` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `0ca0b7047784e35a4f968a31cbb39fbe7d4b62c1ddb4518ff23ae045994a3f5b`
- allowlist sha256 (config/public-repo.allowlist): `5f2e35cdb9f5e584a4bde31d8bb9152f2bda5180c0132231189ded58060f5a0d`
- files published: 1925

## 2026-10-13 — publish from 692f81de8c03

- monorepo commit: `692f81de8c0387c2291d1deeed31177386a15246` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `0ca0b7047784e35a4f968a31cbb39fbe7d4b62c1ddb4518ff23ae045994a3f5b`
- allowlist sha256 (config/public-repo.allowlist): `5f2e35cdb9f5e584a4bde31d8bb9152f2bda5180c0132231189ded58060f5a0d`
- files published: 1932

## 2026-10-13 — publish from 51e83d82b5ce

- monorepo commit: `51e83d82b5ce11ca7df369cceae66fec2a8113f6` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `0ca0b7047784e35a4f968a31cbb39fbe7d4b62c1ddb4518ff23ae045994a3f5b`
- allowlist sha256 (config/public-repo.allowlist): `5f2e35cdb9f5e584a4bde31d8bb9152f2bda5180c0132231189ded58060f5a0d`
- files published: 1934

## 2026-10-13 — publish from d7657fe07454

- monorepo commit: `d7657fe0745455ff07eb17ae03f69686de8a6d8f` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `0ca0b7047784e35a4f968a31cbb39fbe7d4b62c1ddb4518ff23ae045994a3f5b`
- allowlist sha256 (config/public-repo.allowlist): `5f2e35cdb9f5e584a4bde31d8bb9152f2bda5180c0132231189ded58060f5a0d`
- files published: 1938

## 2026-10-13 — publish from 77e96808a081

- monorepo commit: `77e96808a08127c03ac9ccd633e71694b6d27098` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `0ca0b7047784e35a4f968a31cbb39fbe7d4b62c1ddb4518ff23ae045994a3f5b`
- allowlist sha256 (config/public-repo.allowlist): `5f2e35cdb9f5e584a4bde31d8bb9152f2bda5180c0132231189ded58060f5a0d`
- files published: 1941

## 2026-10-14 — publish from 91bc62f07511

- monorepo commit: `91bc62f0751142a9a5d3696c0195b13612a5c3be` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `0ca0b7047784e35a4f968a31cbb39fbe7d4b62c1ddb4518ff23ae045994a3f5b`
- allowlist sha256 (config/public-repo.allowlist): `5f2e35cdb9f5e584a4bde31d8bb9152f2bda5180c0132231189ded58060f5a0d`
- files published: 1948

## 2026-10-14 — publish from 17e55c75ada1

- monorepo commit: `17e55c75ada1af28f08fb2644b4a9b2781d384fd` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `0ca0b7047784e35a4f968a31cbb39fbe7d4b62c1ddb4518ff23ae045994a3f5b`
- allowlist sha256 (config/public-repo.allowlist): `2243e4c0eaef62ef91bb18411c06de4f81c3ce254f616c62cde947fd0686781c`
- files published: 1967

## 2026-10-14 — publish from 22d96b3e3468

- monorepo commit: `22d96b3e3468ae392288df99b77aa08dd562ea23` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `0ca0b7047784e35a4f968a31cbb39fbe7d4b62c1ddb4518ff23ae045994a3f5b`
- allowlist sha256 (config/public-repo.allowlist): `2243e4c0eaef62ef91bb18411c06de4f81c3ce254f616c62cde947fd0686781c`
- files published: 1973

## 2026-10-14 — publish from f535462884dd

- monorepo commit: `f535462884ddbb56b5d9ebb9e67b0857deb7bbee` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `0ca0b7047784e35a4f968a31cbb39fbe7d4b62c1ddb4518ff23ae045994a3f5b`
- allowlist sha256 (config/public-repo.allowlist): `2243e4c0eaef62ef91bb18411c06de4f81c3ce254f616c62cde947fd0686781c`
- files published: 1974

## 2026-10-14 — publish from ded81d0e6d43

- monorepo commit: `ded81d0e6d435315214796677524360e99034dc4` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `0ca0b7047784e35a4f968a31cbb39fbe7d4b62c1ddb4518ff23ae045994a3f5b`
- allowlist sha256 (config/public-repo.allowlist): `2243e4c0eaef62ef91bb18411c06de4f81c3ce254f616c62cde947fd0686781c`
- files published: 1974

## 2026-10-14 — publish from 2cc94a922f4f

- monorepo commit: `2cc94a922f4f48f22978b003ed866fb97a9c4cfe` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `0ca0b7047784e35a4f968a31cbb39fbe7d4b62c1ddb4518ff23ae045994a3f5b`
- allowlist sha256 (config/public-repo.allowlist): `2243e4c0eaef62ef91bb18411c06de4f81c3ce254f616c62cde947fd0686781c`
- files published: 1975

## 2026-10-14 — publish from bf2d13b80f00

- monorepo commit: `bf2d13b80f00e3bc1d248c2f44ae5ac5d2e6325a` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `0ca0b7047784e35a4f968a31cbb39fbe7d4b62c1ddb4518ff23ae045994a3f5b`
- allowlist sha256 (config/public-repo.allowlist): `2243e4c0eaef62ef91bb18411c06de4f81c3ce254f616c62cde947fd0686781c`
- files published: 1975

## 2026-10-14 — publish from 88b0c5344f80

- monorepo commit: `88b0c5344f80dcf56032adcc9f607e70b654bb42` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `0ca0b7047784e35a4f968a31cbb39fbe7d4b62c1ddb4518ff23ae045994a3f5b`
- allowlist sha256 (config/public-repo.allowlist): `2243e4c0eaef62ef91bb18411c06de4f81c3ce254f616c62cde947fd0686781c`
- files published: 1975

## 2026-10-14 — publish from 13cab4c6e9b5

- monorepo commit: `13cab4c6e9b560db11a49584e7fddd700eb0bc84` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `0ca0b7047784e35a4f968a31cbb39fbe7d4b62c1ddb4518ff23ae045994a3f5b`
- allowlist sha256 (config/public-repo.allowlist): `2243e4c0eaef62ef91bb18411c06de4f81c3ce254f616c62cde947fd0686781c`
- files published: 1975

## 2026-10-14 — publish from 2306859c6a43

- monorepo commit: `2306859c6a430dac578a866846b16a3eaae1c7c4` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `0ca0b7047784e35a4f968a31cbb39fbe7d4b62c1ddb4518ff23ae045994a3f5b`
- allowlist sha256 (config/public-repo.allowlist): `2243e4c0eaef62ef91bb18411c06de4f81c3ce254f616c62cde947fd0686781c`
- files published: 1978

## 2026-10-14 — publish from ce6b1e12c6a1

- monorepo commit: `ce6b1e12c6a169e8a2097998667d858dad78d17c` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `0ca0b7047784e35a4f968a31cbb39fbe7d4b62c1ddb4518ff23ae045994a3f5b`
- allowlist sha256 (config/public-repo.allowlist): `2243e4c0eaef62ef91bb18411c06de4f81c3ce254f616c62cde947fd0686781c`
- files published: 1978

## 2026-10-14 — publish from ba488d44dd4d

- monorepo commit: `ba488d44dd4d7d891ff7429eb5e28e57fdd99e5b` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `0ca0b7047784e35a4f968a31cbb39fbe7d4b62c1ddb4518ff23ae045994a3f5b`
- allowlist sha256 (config/public-repo.allowlist): `2243e4c0eaef62ef91bb18411c06de4f81c3ce254f616c62cde947fd0686781c`
- files published: 1978

## 2026-10-14 — publish from 2e9bb2ad2491

- monorepo commit: `2e9bb2ad2491ae94f2e4a6fd28fa36bda3a64236` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `0ca0b7047784e35a4f968a31cbb39fbe7d4b62c1ddb4518ff23ae045994a3f5b`
- allowlist sha256 (config/public-repo.allowlist): `2243e4c0eaef62ef91bb18411c06de4f81c3ce254f616c62cde947fd0686781c`
- files published: 1978

## 2026-10-14 — publish from 37271c63dbd5

- monorepo commit: `37271c63dbd5610054a9275e3c446cfde7838df1` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `0ca0b7047784e35a4f968a31cbb39fbe7d4b62c1ddb4518ff23ae045994a3f5b`
- allowlist sha256 (config/public-repo.allowlist): `2243e4c0eaef62ef91bb18411c06de4f81c3ce254f616c62cde947fd0686781c`
- files published: 1979

## 2026-10-14 — publish from 169979f84c32

- monorepo commit: `169979f84c3272f4fcb7a2f057531a047542a327` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `0ca0b7047784e35a4f968a31cbb39fbe7d4b62c1ddb4518ff23ae045994a3f5b`
- allowlist sha256 (config/public-repo.allowlist): `2243e4c0eaef62ef91bb18411c06de4f81c3ce254f616c62cde947fd0686781c`
- files published: 1979

## 2026-10-14 — publish from 01815cf87b01

- monorepo commit: `01815cf87b0148a6338090e31622b04013b9d7c8` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `0ca0b7047784e35a4f968a31cbb39fbe7d4b62c1ddb4518ff23ae045994a3f5b`
- allowlist sha256 (config/public-repo.allowlist): `2243e4c0eaef62ef91bb18411c06de4f81c3ce254f616c62cde947fd0686781c`
- files published: 1979

## 2026-10-14 — publish from 7e18cf8ccfc6

- monorepo commit: `7e18cf8ccfc695d783e31fb52ec80a6d4b3b3d72` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `0ca0b7047784e35a4f968a31cbb39fbe7d4b62c1ddb4518ff23ae045994a3f5b`
- allowlist sha256 (config/public-repo.allowlist): `c264cf950a5499b0aff6e2e87db405f6df39507d574fea4f7a7ba20b826e7ede`
- files published: 1984

## 2026-10-14 — publish from c56186d0a2df

- monorepo commit: `c56186d0a2df1309b0d9d8496737274b14036415` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `0ca0b7047784e35a4f968a31cbb39fbe7d4b62c1ddb4518ff23ae045994a3f5b`
- allowlist sha256 (config/public-repo.allowlist): `c264cf950a5499b0aff6e2e87db405f6df39507d574fea4f7a7ba20b826e7ede`
- files published: 1985

## 2026-10-14 — publish from bc2f774e6ffd

- monorepo commit: `bc2f774e6ffdd4fa3fed7e5390bf33dae0fd2f57` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `0ca0b7047784e35a4f968a31cbb39fbe7d4b62c1ddb4518ff23ae045994a3f5b`
- allowlist sha256 (config/public-repo.allowlist): `c264cf950a5499b0aff6e2e87db405f6df39507d574fea4f7a7ba20b826e7ede`
- files published: 1985

## 2026-10-14 — publish from 562d0ae7294a

- monorepo commit: `562d0ae7294afd6cdeb4369ca47b45ce2ee80ae4` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `0ca0b7047784e35a4f968a31cbb39fbe7d4b62c1ddb4518ff23ae045994a3f5b`
- allowlist sha256 (config/public-repo.allowlist): `a664dbd01bdf16af5180aa60fee0bcc72325a3f82c1aefabac66b7e0035ac172`
- files published: 1993

## 2026-10-15 — publish from 9d09423cb81f

- monorepo commit: `9d09423cb81fa90470a016d024bf5cf5ba082f5b` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `0ca0b7047784e35a4f968a31cbb39fbe7d4b62c1ddb4518ff23ae045994a3f5b`
- allowlist sha256 (config/public-repo.allowlist): `a664dbd01bdf16af5180aa60fee0bcc72325a3f82c1aefabac66b7e0035ac172`
- files published: 1993

## 2026-10-15 — publish from 59f06bddb555

- monorepo commit: `59f06bddb55570efbc3f3216a6fb0dfcd85c64a1` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `0ca0b7047784e35a4f968a31cbb39fbe7d4b62c1ddb4518ff23ae045994a3f5b`
- allowlist sha256 (config/public-repo.allowlist): `a664dbd01bdf16af5180aa60fee0bcc72325a3f82c1aefabac66b7e0035ac172`
- files published: 1993

## 2026-10-15 — publish from 74269b31326a

- monorepo commit: `74269b31326ad788601d42ae9a32593abe12b963` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `0ca0b7047784e35a4f968a31cbb39fbe7d4b62c1ddb4518ff23ae045994a3f5b`
- allowlist sha256 (config/public-repo.allowlist): `a664dbd01bdf16af5180aa60fee0bcc72325a3f82c1aefabac66b7e0035ac172`
- files published: 1996

## 2026-10-15 — publish from c5f1f4f09d9b

- monorepo commit: `c5f1f4f09d9bf5d89a673869cd17593d358b795c` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `0ca0b7047784e35a4f968a31cbb39fbe7d4b62c1ddb4518ff23ae045994a3f5b`
- allowlist sha256 (config/public-repo.allowlist): `a664dbd01bdf16af5180aa60fee0bcc72325a3f82c1aefabac66b7e0035ac172`
- files published: 1996

## 2026-10-15 — publish from a29dbad8c27f

- monorepo commit: `a29dbad8c27f2874d4f82e322b65209b71732bd7` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `0ca0b7047784e35a4f968a31cbb39fbe7d4b62c1ddb4518ff23ae045994a3f5b`
- allowlist sha256 (config/public-repo.allowlist): `ecb2bda8fd38182a999d7e6d89e62286c39baf2fe30940125bb6ac364df847da`
- files published: 2002

## 2026-10-15 — publish from 9152548adc17

- monorepo commit: `9152548adc1760515b3640636aaf43ef783b5410` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `0ca0b7047784e35a4f968a31cbb39fbe7d4b62c1ddb4518ff23ae045994a3f5b`
- allowlist sha256 (config/public-repo.allowlist): `ecb2bda8fd38182a999d7e6d89e62286c39baf2fe30940125bb6ac364df847da`
- files published: 2002

## 2026-10-15 — publish from ccf33e515391

- monorepo commit: `ccf33e515391fbe535fef1852c056e7fb81b9a90` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `0ca0b7047784e35a4f968a31cbb39fbe7d4b62c1ddb4518ff23ae045994a3f5b`
- allowlist sha256 (config/public-repo.allowlist): `ecb2bda8fd38182a999d7e6d89e62286c39baf2fe30940125bb6ac364df847da`
- files published: 2002

## 2026-10-15 — publish from 71197526511d

- monorepo commit: `71197526511d810e4a55849d3e0d4d155f5bc6c5` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `0ca0b7047784e35a4f968a31cbb39fbe7d4b62c1ddb4518ff23ae045994a3f5b`
- allowlist sha256 (config/public-repo.allowlist): `ecb2bda8fd38182a999d7e6d89e62286c39baf2fe30940125bb6ac364df847da`
- files published: 2002

## 2026-10-15 — publish from 5607faf0bc93

- monorepo commit: `5607faf0bc935a021a92bc945ace2988cf18a0e4` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `0ca0b7047784e35a4f968a31cbb39fbe7d4b62c1ddb4518ff23ae045994a3f5b`
- allowlist sha256 (config/public-repo.allowlist): `ecb2bda8fd38182a999d7e6d89e62286c39baf2fe30940125bb6ac364df847da`
- files published: 2006

## 2026-10-15 — publish from 4c5b2e1262bd

- monorepo commit: `4c5b2e1262bd491cf6ad55f510d84387bbe46985` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `c62c29fdfa430c45f97e8d5b6cccb726ee1d74293a5266e29968394cad0d5178`
- allowlist sha256 (config/public-repo.allowlist): `ecb2bda8fd38182a999d7e6d89e62286c39baf2fe30940125bb6ac364df847da`
- files published: 2184

## 2026-10-15 — publish from 2866d02e8db8

- monorepo commit: `2866d02e8db8b252a751addb7e1f27d6ad54d914` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `c62c29fdfa430c45f97e8d5b6cccb726ee1d74293a5266e29968394cad0d5178`
- allowlist sha256 (config/public-repo.allowlist): `ecb2bda8fd38182a999d7e6d89e62286c39baf2fe30940125bb6ac364df847da`
- files published: 2188

## 2026-10-15 — publish from fcc8ef5f2d0e

- monorepo commit: `fcc8ef5f2d0e4dbcda21c7a457972356e125f551` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `c62c29fdfa430c45f97e8d5b6cccb726ee1d74293a5266e29968394cad0d5178`
- allowlist sha256 (config/public-repo.allowlist): `ecb2bda8fd38182a999d7e6d89e62286c39baf2fe30940125bb6ac364df847da`
- files published: 2202

## 2026-10-15 — publish from e14e4e2ff5d4

- monorepo commit: `e14e4e2ff5d408d110fe2eba43c968dd53a5491c` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `c62c29fdfa430c45f97e8d5b6cccb726ee1d74293a5266e29968394cad0d5178`
- allowlist sha256 (config/public-repo.allowlist): `ecb2bda8fd38182a999d7e6d89e62286c39baf2fe30940125bb6ac364df847da`
- files published: 2202

## 2026-10-15 — publish from 5becd849bb50

- monorepo commit: `5becd849bb509ca6e1d0689a5ac4272e2796fcb0` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `c62c29fdfa430c45f97e8d5b6cccb726ee1d74293a5266e29968394cad0d5178`
- allowlist sha256 (config/public-repo.allowlist): `ecb2bda8fd38182a999d7e6d89e62286c39baf2fe30940125bb6ac364df847da`
- files published: 2214

## 2026-10-16 — publish from 581f74143e28

- monorepo commit: `581f74143e28fdf86aa0f44d520b15427d1c8c6a` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `c62c29fdfa430c45f97e8d5b6cccb726ee1d74293a5266e29968394cad0d5178`
- allowlist sha256 (config/public-repo.allowlist): `ecb2bda8fd38182a999d7e6d89e62286c39baf2fe30940125bb6ac364df847da`
- files published: 2214

## 2026-10-16 — publish from 3bfeff788e79

- monorepo commit: `3bfeff788e7970ada674bfd0bddf043e5e10b6ba` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `c62c29fdfa430c45f97e8d5b6cccb726ee1d74293a5266e29968394cad0d5178`
- allowlist sha256 (config/public-repo.allowlist): `ecb2bda8fd38182a999d7e6d89e62286c39baf2fe30940125bb6ac364df847da`
- files published: 2220

## 2026-10-16 — publish from 123b3650e179

- monorepo commit: `123b3650e179e87fd8916a041a2049830cb138c1` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `c62c29fdfa430c45f97e8d5b6cccb726ee1d74293a5266e29968394cad0d5178`
- allowlist sha256 (config/public-repo.allowlist): `ecb2bda8fd38182a999d7e6d89e62286c39baf2fe30940125bb6ac364df847da`
- files published: 2221

## 2026-10-16 — publish from 509cf95a3704

- monorepo commit: `509cf95a37046f454b98c28f4424306f298940b5` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `c62c29fdfa430c45f97e8d5b6cccb726ee1d74293a5266e29968394cad0d5178`
- allowlist sha256 (config/public-repo.allowlist): `ecb2bda8fd38182a999d7e6d89e62286c39baf2fe30940125bb6ac364df847da`
- files published: 2228

## 2026-10-16 — publish from cdcff99dca18

- monorepo commit: `cdcff99dca189e899b3011e3a0c9d38f8a655e24` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `c62c29fdfa430c45f97e8d5b6cccb726ee1d74293a5266e29968394cad0d5178`
- allowlist sha256 (config/public-repo.allowlist): `ab47a2a02f9830a9fb819ade3ebc1040ba00a285e1830f3950726cd0ec3c8f22`
- files published: 2235

## 2026-10-16 — publish from 5bed488aeaa4

- monorepo commit: `5bed488aeaa46e99519fed96a4d858ce8a326db2` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `c62c29fdfa430c45f97e8d5b6cccb726ee1d74293a5266e29968394cad0d5178`
- allowlist sha256 (config/public-repo.allowlist): `956f975164e26c33252972f5a314161e87cfa16c587dac6bd92a76ee5df9add3`
- files published: 2253

## 2026-10-16 — publish from cdbbbbc8deec

- monorepo commit: `cdbbbbc8deeca5c41092da41e0524415a3582f59` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `c62c29fdfa430c45f97e8d5b6cccb726ee1d74293a5266e29968394cad0d5178`
- allowlist sha256 (config/public-repo.allowlist): `956f975164e26c33252972f5a314161e87cfa16c587dac6bd92a76ee5df9add3`
- files published: 2259

## 2026-10-16 — publish from b0611ab7049c

- monorepo commit: `b0611ab7049c9e687e98fe15aabd9f387b0d9b52` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `c62c29fdfa430c45f97e8d5b6cccb726ee1d74293a5266e29968394cad0d5178`
- allowlist sha256 (config/public-repo.allowlist): `9bbe29a6cf5638f3ba424ad55ae5217f7fcc24f5dd8f91c54cf6e34976a1601e`
- files published: 2260

## 2026-10-17 — publish from 133468e10225

- monorepo commit: `133468e102259d50cfb629daf2aa180f4ce34ac8` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `c62c29fdfa430c45f97e8d5b6cccb726ee1d74293a5266e29968394cad0d5178`
- allowlist sha256 (config/public-repo.allowlist): `64ed38d8c5ec1679c34df4153f1b256ca84f450bb155d28bacf98a032e2f79de`
- files published: 2272

## 2026-10-18 — publish from 8ed97cbeeffc

- monorepo commit: `8ed97cbeeffcc27c32ead6a664c46ea93a3741bd` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `c62c29fdfa430c45f97e8d5b6cccb726ee1d74293a5266e29968394cad0d5178`
- allowlist sha256 (config/public-repo.allowlist): `64ed38d8c5ec1679c34df4153f1b256ca84f450bb155d28bacf98a032e2f79de`
- files published: 2272

## 2026-10-18 — publish from 8c843ca1c8bc

- monorepo commit: `8c843ca1c8bc2a499c5729f06081763a13f32fa3` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `c62c29fdfa430c45f97e8d5b6cccb726ee1d74293a5266e29968394cad0d5178`
- allowlist sha256 (config/public-repo.allowlist): `64ed38d8c5ec1679c34df4153f1b256ca84f450bb155d28bacf98a032e2f79de`
- files published: 2274

## 2026-10-18 — publish from 5c9e7f1da4b1

- monorepo commit: `5c9e7f1da4b16a59aad34b7ab710e7ce97fe8aa7` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `c62c29fdfa430c45f97e8d5b6cccb726ee1d74293a5266e29968394cad0d5178`
- allowlist sha256 (config/public-repo.allowlist): `c36e2d2b710a001b0fe24d30b17b5a56292e7f6f5d6790c71723ed0c3366ecdd`
- files published: 2311

## 2026-10-18 — publish from 4de9c312064a

- monorepo commit: `4de9c312064a3a74e37bf6a4a4186e688b7e5cda` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `c62c29fdfa430c45f97e8d5b6cccb726ee1d74293a5266e29968394cad0d5178`
- allowlist sha256 (config/public-repo.allowlist): `c36e2d2b710a001b0fe24d30b17b5a56292e7f6f5d6790c71723ed0c3366ecdd`
- files published: 2311

## 2026-10-18 — publish from 12367f51bed4

- monorepo commit: `12367f51bed4e502c33e408b2d29749eade200a8` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `c62c29fdfa430c45f97e8d5b6cccb726ee1d74293a5266e29968394cad0d5178`
- allowlist sha256 (config/public-repo.allowlist): `c36e2d2b710a001b0fe24d30b17b5a56292e7f6f5d6790c71723ed0c3366ecdd`
- files published: 2339

## 2026-10-18 — publish from 01e20a06d45c

- monorepo commit: `01e20a06d45c68c95bd30daea327f9d61a0e791d` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `c62c29fdfa430c45f97e8d5b6cccb726ee1d74293a5266e29968394cad0d5178`
- allowlist sha256 (config/public-repo.allowlist): `c36e2d2b710a001b0fe24d30b17b5a56292e7f6f5d6790c71723ed0c3366ecdd`
- files published: 2339
## 2026-10-18 — more public commits recorded after the fact (no publish, no deploy)

The public commit of each publish below was named only in the monorepo commit that pinned it (the publish script's "pins" step).
These lines record it here, under the same rule as the 2026-10-12 section: when two tags were written before one public commit, the
commit is recorded against the later tag, and a release with no pins commit stays unlinked. From this date the pins step writes a
`- public commit:` line into the entry it pins.

- publish from 01815cf87b01: public commit `98d6d92c23242874746e7256f4da75f9b95da714`
- publish from 123b3650e179: public commit `d064add32951ad162fe1d8d3f89301884bb82787`
- publish from 133468e10225: public commit `7bcc6a5b6d25a79a3b7dd3ca82041a54b5f3d4ec`
- publish from 13cab4c6e9b5: public commit `0fcbfa6859917495d743f4f9ec21148459f7c29a`
- publish from 13f85aabc19a: public commit `7729f6d69b80cf136300f8bd9f6cb2df2a6109eb`
- publish from 169979f84c32: public commit `f7459b8e6d1b125b4c4bc5a13a2e28e77e0d3057`
- publish from 16cbda77dedb: public commit `2b6adfafe4b2a6d3f1fdb7ce48c313bd90136412`
- publish from 17e55c75ada1: public commit `795030db1dcf537d20c777722a30dda3b23019f1`
- publish from 22d96b3e3468: public commit `4321c9e9af6872214a33dea2acb953f7d3b8f5c5`
- publish from 2306859c6a43: public commit `002bbddad91d509fd32d594b1e2dc399b4b6938f`
- publish from 2866d02e8db8: public commit `354c7cce26fc125d9bfbc9d2a2753f76150bb299`
- publish from 2cc94a922f4f: public commit `0d1a26cb54be0892286980a495676b4aea7e8eb4`
- publish from 2e9bb2ad2491: public commit `8dd2d5f42c92006e910b5318e8bd2680eed7f3dc`
- publish from 3559dca546b9: public commit `d0ecec7353b9b7580f25929806ef6543f7c8f936`
- publish from 36e008780251: public commit `c7c68d872da64ac113837c7741db57c060cefa69`
- publish from 37271c63dbd5: public commit `29dac25ceeddc4a5d834fb7b16340a0fdd4a0431`
- publish from 3983a396a61c: public commit `913ce3091cd03daaf9a96ce74dad3397f9523df0`
- publish from 3bfeff788e79: public commit `2c5547c2306940c28ad494d0cec7c53953f1e06e`
- publish from 3ff396161e0f: public commit `9c65999abbe3a7b0712759afaaf22745f3f31e9b`
- publish from 42d0d50171dc: public commit `6fcc3aa525995a8c076f70d7dcf95b14640d18ab`
- publish from 4a49f8d5a442: public commit `c5b606399727e5d0771c7f06f213c5f2b89f264e`
- publish from 4c5b2e1262bd: public commit `5c775f8f682655c2995f1abc0ba09e45bcb71bc5`
- publish from 501496455f6f: public commit `0cddd0d1c55837b96620ac471c1efa8b843a29a7`
- publish from 509cf95a3704: public commit `74156660eb4baaa97224f4c02a8eba599a2598e2`
- publish from 51032098f12e: public commit `66a4e805758c765901cad62fa4fde803a4460680`
- publish from 51e83d82b5ce: public commit `0b37dc9074355c9f3205fab75eab4ba4cdc92f7e`
- publish from 5607faf0bc93: public commit `d27e1d02e9590b561ac30b88fe4079e73ef86b9b`
- publish from 562d0ae7294a: public commit `4de2c1a71838e9ffe6887db916a3376e53bd7bf6`
- publish from 581f74143e28: public commit `a147a6f79126c7a9450f2d4a44ac33398a0d704b`
- publish from 59f06bddb555: public commit `bc4194d4140307cf8f47a79b877ead8bf3a9131c`
- publish from 5becd849bb50: public commit `0cfd60761872bab2c11f5132122a70c645fe37c7`
- publish from 5bed488aeaa4: public commit `d3081aa6e887228552ba7747d4553e6882f2057f`
- publish from 5bf5d4c201b3: public commit `85e7c31b1d8fa79176a8e061334b98ab7e81b629`
- publish from 692f81de8c03: public commit `bf5b3a45afc49153474a9ee1c2a44977388df36c`
- publish from 7118476d29dc: public commit `e0307e3f656523ba37f8fc3a7deb697d9f1a9168`
- publish from 71197526511d: public commit `2f2f94f9d252eceea84dd249f3e67f94ab381a29`
- publish from 74269b31326a: public commit `7277ed4c176bf7396a07ebfeedafcb06ce2e16b3`
- publish from 77e96808a081: public commit `a05f8f721af64b43adfcf12c80d0e6c0d0a58dbf`
- publish from 788e8854fab6: public commit `67ea2e2f05b9a4d81f8e8b2229a50228d8682533`
- publish from 86e4bfa95667: public commit `c1e5e97d15b72f0eb3c3d53dddddc485be2a54d4`
- publish from 88609032112a: public commit `97814709a37d98308d70615b72d6867da3e9975a`
- publish from 88b0c5344f80: public commit `0c206f57352e4a9e12e5cc6fd885e899f39bcda3`
- publish from 8be3d70411d0: public commit `7522ce5c41a50175e63af73831e0ba270af4598a`
- publish from 90b7ac1465f7: public commit `81180868b32d2b70debfecfed254a10e802fd0bc`
- publish from 9152548adc17: public commit `bf277c996915631525f39a149ab9f62bf56f97e1`
- publish from 91bc62f07511: public commit `9949250484e98d3754e0cde934d8ea6e94e51246`
- publish from 9d09423cb81f: public commit `e158ab95d24086da63754bc22ecd3402f63a421c`
- publish from a313df08fd3f: public commit `a1140178503818a36404346088fa86a14138c71d`
- publish from a4a9daeac22c: public commit `b9470d4418e4ab6014b2277db5048e1676c4cc36`
- publish from af2a8442ee68: public commit `80b21e6bbbd7f03d502b33ffe471e6ffaefb3b63`
- publish from b0611ab7049c: public commit `b71bff67e40eef79ffdcf0d4b5878a9c1adbca19`
- publish from b6c0e3eccbba: public commit `7fc1ad7a43229bc297321294a1deaa28c1886411`
- publish from ba488d44dd4d: public commit `9231928caf5189109c1a82897e25b0dc04855e07`
- publish from bc2f774e6ffd: public commit `c959d4802a2978e811744b12fb7a6d39e2701ee5`
- publish from bf2d13b80f00: public commit `aa350321fbbcb71b91654a25d6c4cc6a3b9f361a`
- publish from c56186d0a2df: public commit `6a32f087bc32894d7ecbce9090f5a1d5a90d211b`
- publish from c5f1f4f09d9b: public commit `f7019a50b38ed6c7c850f771cb96434cc5dc3664`
- publish from cdcff99dca18: public commit `938e75cc2adc6d6e597c0e573b306fb5cfed11cc`
- publish from ce6b1e12c6a1: public commit `a8b0a065745dfad0de74dd879b43c747649596b1`
- publish from d55ba81412cd: public commit `f95f667de11ebbb38ab6b0f8228bee538e4a9d49`
- publish from d7657fe07454: public commit `99b76e5dcbd34ed9f68a57fc61430661341b285d`
- publish from e14e4e2ff5d4: public commit `bade3215ba599b600ea0a9fa486cce9a6288e8b1`
- publish from e96dec284202: public commit `dba062a7115b0ede1479e264d97f23158cfb7282`
- publish from ea7527829e92: public commit `9735326815d6cce49d01f02479125bd0c5c61e48`
- publish from f1e6afd44995: public commit `a441321356fe4a2d56848a6a3ecbc7172cc8e6c4`
- publish from f535462884dd: public commit `bc9914371d1830574ae9610cecf8104ba67d7889`
- publish from 8ed97cbeeffc: public commit `a8b095fb45e35adf5a4d17763e3417c6cfca248a`

## 2026-10-18 — publish from 7caf1eb4c062

- monorepo commit: `7caf1eb4c06251610609daac234c04091b170b71` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `c62c29fdfa430c45f97e8d5b6cccb726ee1d74293a5266e29968394cad0d5178`
- allowlist sha256 (config/public-repo.allowlist): `c36e2d2b710a001b0fe24d30b17b5a56292e7f6f5d6790c71723ed0c3366ecdd`
- files published: 2365

## 2026-10-18 — publish from d7c1ddb5a7ba

- monorepo commit: `d7c1ddb5a7bad08f0a8b1687be0a0ec4c66213e2` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `c62c29fdfa430c45f97e8d5b6cccb726ee1d74293a5266e29968394cad0d5178`
- allowlist sha256 (config/public-repo.allowlist): `c36e2d2b710a001b0fe24d30b17b5a56292e7f6f5d6790c71723ed0c3366ecdd`
- files published: 2365
- public commit: `fa624089e9f2689112f3e9576e2c7969fc73a0ff`

## 2026-10-18 — publish from 11402df1f141

- monorepo commit: `11402df1f141f807beb44942b5c3905964d8ee0f` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `c62c29fdfa430c45f97e8d5b6cccb726ee1d74293a5266e29968394cad0d5178`
- allowlist sha256 (config/public-repo.allowlist): `c36e2d2b710a001b0fe24d30b17b5a56292e7f6f5d6790c71723ed0c3366ecdd`
- files published: 2371
- public commit: `39865ebc59ec708464f48e5eaefeacb8a7012bf8`

## 2026-10-19 — publish from f34342d76095

- monorepo commit: `f34342d760952c70bfc8fc04e78966bd5344f834` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `c62c29fdfa430c45f97e8d5b6cccb726ee1d74293a5266e29968394cad0d5178`
- allowlist sha256 (config/public-repo.allowlist): `017b2af250b04814ce52fb298ddb4ad460e552e8dc296ff4f8fbf7b7d5d6330e`
- files published: 2378
- public commit: `5f40394fd55a11baaf58ebff4e6705c344d126c8`

## 2026-10-19 — publish from 2aba0d623f6e

- monorepo commit: `2aba0d623f6e7c09b6cc5adb764596d512d0b2d0` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `c62c29fdfa430c45f97e8d5b6cccb726ee1d74293a5266e29968394cad0d5178`
- allowlist sha256 (config/public-repo.allowlist): `017b2af250b04814ce52fb298ddb4ad460e552e8dc296ff4f8fbf7b7d5d6330e`
- files published: 2394
- public commit: `b978eef8dfc4cf97d05dc654ce184817f23fb29c`

## 2026-10-19 — publish from db3b07dba3f9

- monorepo commit: `db3b07dba3f982cd8add2aa2162da84d9db795af` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `c62c29fdfa430c45f97e8d5b6cccb726ee1d74293a5266e29968394cad0d5178`
- allowlist sha256 (config/public-repo.allowlist): `ba75de0310da1a6e37add425fa6db1f05fdcbed048ff9a06c550c3b803c9f0c7`
- files published: 2411
- public commit: `df511e405697f5800072323568bcb18f76631cd3`

## 2026-10-19 — Raydium CPMM fee tier 14 for new coins (client side; no publish, no deploy)

- Owner decision (decisions.md): coins created after the platform change graduate into Raydium CPMM tier 14 (`52MZUkNsRYzP4gn2mCaLTVtJQy2tpoF79hp5K1HhAxxX`). Traders pay 1.25 % per swap; 97.90 bps go to the burn pool, 12.6 bps to the operator and 14.50 bps to Raydium. Coins created before the change keep the tier they pinned (tier 9 for most, tier 0 for the earliest).
- Each coin's page states the split of the tier that coin pinned (TokenConfig.ll_cp_config); the trust page states the tier the live platform gives new coins and accepts tier 9 there until the platform update lands.
- The mainnet lookup table definition keeps tier 9 at index 10 and adds tier 14 at index 21; the frozen table cannot be extended, so a new table is created, frozen and pinned before this code is published.

## 2026-10-19 — publish from de9305a587ec

- monorepo commit: `de9305a587eca613bc96e76734fec12250588bc9` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `c62c29fdfa430c45f97e8d5b6cccb726ee1d74293a5266e29968394cad0d5178`
- allowlist sha256 (config/public-repo.allowlist): `cae0acbae59d464d3fddea5258afe06fbadff3caf9061e69a93416b30ec448a5`
- files published: 2431
- public commit: `22bf79b6d0c00f0c5b5fd728f0e533c5b456e8ac`

## 2026-10-19 — publish from 33114efbda0d

- monorepo commit: `33114efbda0d2c773b456495ef7b05814f7bb4a4` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `c62c29fdfa430c45f97e8d5b6cccb726ee1d74293a5266e29968394cad0d5178`
- allowlist sha256 (config/public-repo.allowlist): `cae0acbae59d464d3fddea5258afe06fbadff3caf9061e69a93416b30ec448a5`
- files published: 2435
- public commit: `a0cb2632db60e70efa393877caa73f47a577dc27`

## 2026-10-19 — what publish 92 changed for visitors (written by hand; the publish entry above lists its files)

- A new coin's create step is checked against the arguments LaunchLab expects before anything is sent.
- A second coin on a ticker that already has a live coin is refused, even when it comes from the same creator.
- The home page's public audit strip counts only completed burns, and says so when there are none yet.
- A coin with no trades says "No trades yet" and "No holders yet" instead of showing zero figures.
- A coin whose one result is in shows a plain warning above the swap panel.
- A web check reads the public status page every five minutes. The first rollout of publish 92 switched back once; the incident log has the details.

## 2026-10-19 — publish from 810d9bc32af6

- monorepo commit: `810d9bc32af60ff74e4957750eaf9964201a99a6` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `c62c29fdfa430c45f97e8d5b6cccb726ee1d74293a5266e29968394cad0d5178`
- allowlist sha256 (config/public-repo.allowlist): `cae0acbae59d464d3fddea5258afe06fbadff3caf9061e69a93416b30ec448a5`
- files published: 2440
- public commit: `0230d30eb9841c5bfd7c1f2aa0af2320ec825c6e`

## 2026-10-19 — publish from e9e4e0df1c64

- monorepo commit: `e9e4e0df1c64f391137fd01a7703d5300437ab17` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `c62c29fdfa430c45f97e8d5b6cccb726ee1d74293a5266e29968394cad0d5178`
- allowlist sha256 (config/public-repo.allowlist): `cae0acbae59d464d3fddea5258afe06fbadff3caf9061e69a93416b30ec448a5`
- files published: 2442

## 2026-10-19 — publish from ab8cde0209d3

- monorepo commit: `ab8cde0209d3219b97a6d5a8aba25461b0a8578b` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `c62c29fdfa430c45f97e8d5b6cccb726ee1d74293a5266e29968394cad0d5178`
- allowlist sha256 (config/public-repo.allowlist): `cae0acbae59d464d3fddea5258afe06fbadff3caf9061e69a93416b30ec448a5`
- files published: 2442
- public commit: `28f79a1ecca230e8e97a189307e0b0480540ad1e`

## 2026-10-19 — publish from c80cc3873c13

- monorepo commit: `c80cc3873c1388d35b3b4dcd98a2113261c88da9` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `c62c29fdfa430c45f97e8d5b6cccb726ee1d74293a5266e29968394cad0d5178`
- allowlist sha256 (config/public-repo.allowlist): `cae0acbae59d464d3fddea5258afe06fbadff3caf9061e69a93416b30ec448a5`
- files published: 2443
- public commit: `9477cbdc39db549956ae0d2268314c35fcc04fa2`

## 2026-10-19 — publish from 5098ac84820e

- monorepo commit: `5098ac84820e18dbbe27c376e3591f280f23c555` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `c62c29fdfa430c45f97e8d5b6cccb726ee1d74293a5266e29968394cad0d5178`
- allowlist sha256 (config/public-repo.allowlist): `cae0acbae59d464d3fddea5258afe06fbadff3caf9061e69a93416b30ec448a5`
- files published: 2443
- public commit: `1fa5e6e89b6fe91d43fc784b38a92914c310afcc`

## 2026-10-19 — publish from 04e65900dbb7

- monorepo commit: `04e65900dbb77fac46a3822a3e65e04b690016b0` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `c62c29fdfa430c45f97e8d5b6cccb726ee1d74293a5266e29968394cad0d5178`
- allowlist sha256 (config/public-repo.allowlist): `cae0acbae59d464d3fddea5258afe06fbadff3caf9061e69a93416b30ec448a5`
- files published: 2444
- public commit: `bc9e5a21250e5b934b416f0199dff663ec0d8ffe`

## 2026-10-19 — publish from e639f6d69986

- monorepo commit: `e639f6d699861251a8c4ff60516cc1b6854a4c01` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `c62c29fdfa430c45f97e8d5b6cccb726ee1d74293a5266e29968394cad0d5178`
- allowlist sha256 (config/public-repo.allowlist): `cae0acbae59d464d3fddea5258afe06fbadff3caf9061e69a93416b30ec448a5`
- files published: 2448
- public commit: `039edf0b51af13f6e706fb9b4b0ba0028329b8c0`

## 2026-10-19 — publish from e66a063f60d4

- monorepo commit: `e66a063f60d44bc6188a9a993cbf268d9988a9f1` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `c62c29fdfa430c45f97e8d5b6cccb726ee1d74293a5266e29968394cad0d5178`
- allowlist sha256 (config/public-repo.allowlist): `f962de4b8e3cf7efd42b5ef475eb4560c63a93f7a270d97b82c93babca7a9589`
- files published: 2462
- public commit: `3d4add2805c9303aca37a056875aa97053c5fcca`

## 2026-10-19 — publish from f5c7f6be435d

- monorepo commit: `f5c7f6be435d97f0786e9d0741e82338b76e3a62` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `c62c29fdfa430c45f97e8d5b6cccb726ee1d74293a5266e29968394cad0d5178`
- allowlist sha256 (config/public-repo.allowlist): `38b86d35e851754568cecac01dd68f0e2dfa84e0a5ea09fde324880db7382d23`
- files published: 2486
- public commit: `660c4441046393a16a9a839483ae13a6062dd6cf`

## 2026-10-19 — publish from f2d6caa24cfa

- monorepo commit: `f2d6caa24cfa87c3b5129427489b2e041af5c8e1` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `c62c29fdfa430c45f97e8d5b6cccb726ee1d74293a5266e29968394cad0d5178`
- allowlist sha256 (config/public-repo.allowlist): `65339115458b59d88c28d17a7ee8d25c6eefae8d82eb2bb99bd587e73ecf090b`
- files published: 2497
- public commit: `349c86e946787c5a7049064c21c0df8899aef3bd`

## 2026-10-20 — publish from e700023b7461

- monorepo commit: `e700023b7461aa57fa079f41519f3f323bf47f9a` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `c62c29fdfa430c45f97e8d5b6cccb726ee1d74293a5266e29968394cad0d5178`
- allowlist sha256 (config/public-repo.allowlist): `65339115458b59d88c28d17a7ee8d25c6eefae8d82eb2bb99bd587e73ecf090b`
- files published: 2507
- public commit: `2aa4d6b00313e2e13588d4e15b2bfdb1c1491018`

## 2026-10-20 — publish from e3d970b5ae5d

- monorepo commit: `e3d970b5ae5dfa7a652b098ad56a22bedff3b01f` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `c62c29fdfa430c45f97e8d5b6cccb726ee1d74293a5266e29968394cad0d5178`
- allowlist sha256 (config/public-repo.allowlist): `65339115458b59d88c28d17a7ee8d25c6eefae8d82eb2bb99bd587e73ecf090b`
- files published: 2508
- public commit: `747ec1fdf202f2e994430b11b627bbfacafd6918`

## 2026-10-20 — publish from fa087498f21a

- monorepo commit: `fa087498f21a15e7d0bb31d0dbba362b9fc787d5` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `c62c29fdfa430c45f97e8d5b6cccb726ee1d74293a5266e29968394cad0d5178`
- allowlist sha256 (config/public-repo.allowlist): `2cf1eb7be18d7a378c8bd2175e8526939f01886408afd7701ae125d01bbedf17`
- files published: 2534
- public commit: `16789ba06215f2911bcb96ebb695c09c09d20a5b`

## 2026-10-20 — publish from 68c7e450b27e

- monorepo commit: `68c7e450b27e724fb1eea79bb2df889614401c1a` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `c62c29fdfa430c45f97e8d5b6cccb726ee1d74293a5266e29968394cad0d5178`
- allowlist sha256 (config/public-repo.allowlist): `2cf1eb7be18d7a378c8bd2175e8526939f01886408afd7701ae125d01bbedf17`
- files published: 2534
- public commit: `20be5d53ff3cecbfe610b7f5f8997147bb58b6dd`

## 2026-10-20 — publish from 4902eb2a355e

- monorepo commit: `4902eb2a355effd6cfb0df69f9343ae1b6b63ced` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `c62c29fdfa430c45f97e8d5b6cccb726ee1d74293a5266e29968394cad0d5178`
- allowlist sha256 (config/public-repo.allowlist): `2cf1eb7be18d7a378c8bd2175e8526939f01886408afd7701ae125d01bbedf17`
- files published: 2535
- public commit: `c880631bbe72be6cd581f338887227becd7e0a4f`

## 2026-10-20 — publish from 55f4f5b17c64

- monorepo commit: `55f4f5b17c647ca6a086b11b908f61813af0a0d4` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `c62c29fdfa430c45f97e8d5b6cccb726ee1d74293a5266e29968394cad0d5178`
- allowlist sha256 (config/public-repo.allowlist): `2cf1eb7be18d7a378c8bd2175e8526939f01886408afd7701ae125d01bbedf17`
- files published: 2541
- public commit: `aafc756fc34b14925df790f8cfbec572efd3e28b`

## 2026-10-20 — publish from f750d8ef267e

- monorepo commit: `f750d8ef267ec86b72866476182911ed49432393` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `c62c29fdfa430c45f97e8d5b6cccb726ee1d74293a5266e29968394cad0d5178`
- allowlist sha256 (config/public-repo.allowlist): `2cf1eb7be18d7a378c8bd2175e8526939f01886408afd7701ae125d01bbedf17`
- files published: 2545
- public commit: `daa49e8ffc28122977f57dfe2792708288e2ce17`

## 2026-10-20 — publish from ed8d44272cff

- monorepo commit: `ed8d44272cff43b3de242d32078180ca4fdfc51c` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `c62c29fdfa430c45f97e8d5b6cccb726ee1d74293a5266e29968394cad0d5178`
- allowlist sha256 (config/public-repo.allowlist): `2cf1eb7be18d7a378c8bd2175e8526939f01886408afd7701ae125d01bbedf17`
- files published: 2548
- public commit: `fa037e3bb2e897d0af2588837ba0e5de461cf543`

## 2026-10-20 — publish from 3b7743c0a95c

- monorepo commit: `3b7743c0a95c387c3bf855e7be2829cb56985145` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `c62c29fdfa430c45f97e8d5b6cccb726ee1d74293a5266e29968394cad0d5178`
- allowlist sha256 (config/public-repo.allowlist): `2cf1eb7be18d7a378c8bd2175e8526939f01886408afd7701ae125d01bbedf17`
- files published: 2567

## 2026-10-20 — publish from 4e72dc31c58c

- monorepo commit: `4e72dc31c58c1aed4dc10c02145c7a9ae262554f` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `c62c29fdfa430c45f97e8d5b6cccb726ee1d74293a5266e29968394cad0d5178`
- allowlist sha256 (config/public-repo.allowlist): `2cf1eb7be18d7a378c8bd2175e8526939f01886408afd7701ae125d01bbedf17`
- files published: 2567
- public commit: `a4e8790bf966aa0f4af5eaf6c0e2f4f0df30fe47`

## 2026-10-21 — publish from df61dc4e7300

- monorepo commit: `df61dc4e7300ed7586e1b1cd4ac81a8cc0ebaf74` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `c62c29fdfa430c45f97e8d5b6cccb726ee1d74293a5266e29968394cad0d5178`
- allowlist sha256 (config/public-repo.allowlist): `2cf1eb7be18d7a378c8bd2175e8526939f01886408afd7701ae125d01bbedf17`
- files published: 2569
- public commit: `77cabf377a072037d02435ee33ada36e1b57679e`

## 2026-10-21 — publish from bc744a853511

- monorepo commit: `bc744a8535112c8d6c4a615d935dfa61228bfb92` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `c62c29fdfa430c45f97e8d5b6cccb726ee1d74293a5266e29968394cad0d5178`
- allowlist sha256 (config/public-repo.allowlist): `2cf1eb7be18d7a378c8bd2175e8526939f01886408afd7701ae125d01bbedf17`
- files published: 2572
- public commit: `2b20cf7b8219a8d801d2f08ef05319847b0453f5`

## 2026-10-21 — publish from 7b00e8231e52

- monorepo commit: `7b00e8231e52509c35d68493fbd43b5f91737f00` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `9fb580067b4701a21abf0fb07ffd64e1f215a77454eb155070cafae21e781834`
- allowlist sha256 (config/public-repo.allowlist): `2cf1eb7be18d7a378c8bd2175e8526939f01886408afd7701ae125d01bbedf17`
- files published: 2588

## 2026-10-21 — publish from f2809f473146

- monorepo commit: `f2809f473146c6d89a53b42f7b1af72137f390af` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `9fb580067b4701a21abf0fb07ffd64e1f215a77454eb155070cafae21e781834`
- allowlist sha256 (config/public-repo.allowlist): `2cf1eb7be18d7a378c8bd2175e8526939f01886408afd7701ae125d01bbedf17`
- files published: 2588
- public commit: `55a1818868aeba75ede7acc84cb204b2da24a1e3`

## 2026-10-21 — publish from e73c13dfebc7

- monorepo commit: `e73c13dfebc7614428d5013cd3b30eac82598a0f` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `9fb580067b4701a21abf0fb07ffd64e1f215a77454eb155070cafae21e781834`
- allowlist sha256 (config/public-repo.allowlist): `2cf1eb7be18d7a378c8bd2175e8526939f01886408afd7701ae125d01bbedf17`
- files published: 2588
- public commit: `de4d54432b9c7c873e72d11686a014172305d5f8`

## 2026-10-21 — publish from db1e725b1084

- monorepo commit: `db1e725b1084c6c5adece3994eef3ef51bf99549` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `9fb580067b4701a21abf0fb07ffd64e1f215a77454eb155070cafae21e781834`
- allowlist sha256 (config/public-repo.allowlist): `2cf1eb7be18d7a378c8bd2175e8526939f01886408afd7701ae125d01bbedf17`
- files published: 2591
- public commit: `0f9571487f4974fe3a6037371033ac2fe3748bd4`

## 2026-10-21 — publish from ce2c179fda18

- monorepo commit: `ce2c179fda18019be243f8520cc09251c04484ba` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `9fb580067b4701a21abf0fb07ffd64e1f215a77454eb155070cafae21e781834`
- allowlist sha256 (config/public-repo.allowlist): `2cf1eb7be18d7a378c8bd2175e8526939f01886408afd7701ae125d01bbedf17`
- files published: 2591
- public commit: `7764cbda58dbbe989eb60ebd2870d2d734902d9f`

## 2026-10-21 — publish from 8ef6c04fcf93

- monorepo commit: `8ef6c04fcf93b84bef4adb1e48dd949ae89e5d26` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `9fb580067b4701a21abf0fb07ffd64e1f215a77454eb155070cafae21e781834`
- allowlist sha256 (config/public-repo.allowlist): `2cf1eb7be18d7a378c8bd2175e8526939f01886408afd7701ae125d01bbedf17`
- files published: 2593
- public commit: `340ab980ca65ff86fec9da1c849cc51f6b87730c`

## 2026-10-21 — publish from 3c9599dd7890

- monorepo commit: `3c9599dd789096fbb546c4a864e400ffc4f58ee6` (the working tree had uncommitted changes when this tag was written)
- program hash: none — program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry
- IDL sha256 (src/lib/burnReceipts/idl.ts): `9fb580067b4701a21abf0fb07ffd64e1f215a77454eb155070cafae21e781834`
- allowlist sha256 (config/public-repo.allowlist): `2cf1eb7be18d7a378c8bd2175e8526939f01886408afd7701ae125d01bbedf17`
- files published: 2593
