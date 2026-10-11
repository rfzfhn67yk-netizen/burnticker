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
