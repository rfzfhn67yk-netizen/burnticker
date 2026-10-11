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
