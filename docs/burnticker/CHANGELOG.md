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
