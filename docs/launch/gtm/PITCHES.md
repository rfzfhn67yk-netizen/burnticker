# Pitches — one per audience (GTM pack, 2026-10-10)

Under [PLAN.md](PLAN.md) §2 (audiences and proofs) and §1 (rules). Every fenced `text pitch` block below is linted by
`test/gtmDocs.test.ts` with `config/launch/copy-lint.json` (no price talk, no promises, no prizes, no "coming soon") and checked for
the words this pack never uses (the venue we do not name; "audit" as a claim). Each claim was checked against the code on
`fix/price-integrity-and-engine-correctness` at the merge recorded in the CHANGELOG entry; the **Checked against** line under each
pitch names the files. If a claim stops being true, the pitch changes, not the code's description of itself.

Shared facts every pitch may use (and nothing else):

| Fact | True because |
|---|---|
| Coins that burn on real-world results — with receipts. | the brand line (LAUNCHPAD-PATH §29; `site/burnticker/index.html`) |
| A coin's own trading fees buy it back on its own pool and the `burn_receipts` program burns everything bought, in one instruction, with a memo | Powers Register `crank_buyback` (`docs/burn-receipts/powers-register.md`) |
| Settled on a primary source with an independent cross-read, or on the on-chain payout of an adjudicated Polymarket market | `docs/burnticker/SETTLEMENT-COVERAGE.md` (5 settleable · 6 adjudicated-only · 0 uncovered) |
| Creators earn nothing; the creator-fee slot pays the burn pool, 100 % | `src/lib/burnticker/fees.ts` (`CREATOR_FEE_SLICE_BPS = 0`, `BURN_POOL_CURVE_BPS = 50`) |
| Zero team allocation; the platform never buys any coin, including its own | `config/burnticker/transparency.json` policies `no-creator-cash`, `platform-never-buys` |
| LP locked forever at graduation; its fees fund the burn (80 % burned, 20 % operator, fixed in code) | `src/lib/burnticker/lockFees.ts` (`LP_LOCKED_PCT = 100`, `LOCK_FEE_BURN_BPS = 8000`, `LOCK_FEE_OPERATOR_BPS = 2000`); decisions.md 2026-10-10 "LP locked forever" |
| The operator earns 20 % of post-graduation LP fees (4.2 bps of volume), besides the 25 bps curve fee — say it when the fee comes up | `fees.ts` `POST_GRADUATION_FEES`; the trust page and `/fees/ledger` show it |
| Rules locked at launch (hash in the on-chain config and in every receipt) | Powers Register `initialize_token` ("change anything afterwards" is listed under cannot) |
| Open source | https://github.com/rfzfhn67yk-netizen/burnticker (public, checked 2026-10-10) |
| Three blind AI reviews published in full; the adversarial ChatGPT review pending; the bounty not published; not audited by a security firm | `transparency.json` → `howBuilt` (the generator's `reviewLine()` reads the same file) |
| Operated by one independent operator (United States) — contact@burnticker.com | `fees.ts` `OPERATOR_LINE` |
| Quorum 1 at launch: the operator's keeper key is the only attester | `transparency.json` limitation `quorum-1` |

**Words never used:** price targets, "audit"/"audited" as a claim (always "not audited by a security firm"), the event-contract venue
whose terms forbid naming it, prize / payout (except "on-chain payout") / odds / bet, "coming", "soon", "will".

---

## 1. Memecoin traders and communities

```text pitch
Coins that burn on real-world results, and every burn has a receipt you can recompute: no team wallet, no creator cash, LP locked forever.
```

```text pitch
A Solana launchpad where a coin burns when a real result settles: a game, a Treasury figure, a weather reading.
The coin's own fees buy it back and a program burns all of it, with the numbers in the memo.
Creators earn nothing, zero team allocation, LP locked forever (its fees fund the burn), and the platform never buys any coin.
```

```text pitch
Burnticker is a Solana memecoin launchpad built on Raydium LaunchLab. Each coin carries one locked rule: which settled result burns it and what share of its own fee pool each burn spends. When the result settles on its primary source and a second publisher agrees, the burn_receipts program buys the coin on its own pool and burns everything it bought, in one instruction, and the memo on that transaction is the receipt — source, reading, units, spent, burned, rule hash. Creators earn nothing from fees (the creator slot pays the burn pool, 100%), there is no team allocation, the LP is locked forever at graduation with its fees split by code (80% to the burn pool, 20% to the operator), and the platform never buys any coin. A memecoin: the rule says what supply does, not what price does.
```

**Proof:** a real program burn with its memo — devnet rehearsal, 2026-10-06, 23 units → 4,010,874.87 test $DEFICIT burned, transaction
`3gBYyBbz5U…` on the devnet explorer: the full link is in https://github.com/rfzfhn67yk-netizen/burnticker/blob/main/docs/burnkeeper/devnet-run.md
§4 (and `teaser --topic=devnet-receipt` prints it from the evidence file; signatures stay out of this doc for the public-repo leak scan). Swap for the first mainnet $DEFICIT receipt and its verify link
(`/api/burnticker/v1/tokens/DEFICIT/verify/<id>`) the day it exists — the plan's "a live receipt + the verifier".
**Checked against:** `docs/burn-receipts/powers-register.md`, `src/lib/burnticker/fees.ts`, `docs/burnkeeper/devnet-run.md`.

## 2. Sports communities — every league

```text pitch
A coin for your team that burns every time they lose (or win), settled on the final score and checked against a second scoreboard.
```

```text pitch
Rays, Lakers, Oilers, Eagles: pick your team, pick "burn when we lose" or "burn when we win", lock it.
Each game settles on its on-chain payout or a licensed final score, and counts only when a second independent source agrees.
The season is a scoreboard of receipts. Nothing is won here; coins only burn.
```

```text pitch
On Burnticker a fan community can launch a team coin in a few screens: league, team, one toggle — burn when we win, or when we lose — and the share of the coin's fee pool each burn spends. Every game settles on its on-chain payout where a market exists, else a licensed final score, and counts only when a second independent source agrees (the league's official feed for MLB, the NHL and the NBA); a tie burns nothing. Each burn is a receipt anyone can check, and the season is scored the only way Burnticker scores anything: in receipts. The creator earns nothing from fees and the rule cannot change after launch. A memecoin: the rule says what supply does, not what price does.
```

**Proof:** https://burnticker.com/burnticker/launch → Team coin (and `GET /api/burnticker/v1/sports/teams?league=mlb`, live).
**Checked against (2026-10-11):** `src/lib/burnticker/sources/espn.ts` (`LEAGUES`: 25 leagues incl. 17 soccer competitions; schedules
from MLB's, the NHL's and the NBA's official feeds, every other league from TheSportsDB), `src/lib/burnticker/sources/gameSettle.ts`
(each game read by two independent operators: the on-chain payout and TheSportsDB, with the league's official feed as a further read),
`docs/burnticker/SETTLEMENT-COVERAGE.md`. **No ESPN read anywhere:** ESPN appears only as a plain "see this game on ESPN" link for
people. **Gap, so not claimed:** soccer schedules need the TheSportsDB key on the host; a non-premium key lists only each league's next
fixture (v1), so a pitch names a soccer club only once the commercial key is set.

## 3. Prediction-market users

```text pitch
Any resolved race can have a coin that burns on the on-chain payout. Not odds, not a bet: a burn with a receipt.
```

```text pitch
Pick a race in the Elections flow; the coin burns when the adjudicated Polymarket market resolves.
The result is read from the payout vector of the Conditional Tokens contract on Polygon, with the state's certified result as the cross-check.
No market data is shown and nothing is won: the receipt is the product.
```

```text pitch
Burnticker reads settled outcomes, never a market's odds. A one-shot coin bound to a race resolves once, on the on-chain payout of the adjudicated Polymarket market (the payout vector on Polygon), cross-checked against the state's certified result; a 50-50 payout is a void and burns nothing. A pair of coins can take the two sides of one race, so exactly one side burns. The Elections flow lists open Senate, House and governor races; Burnticker shows each question and its resolution rules, never a market's numbers. A coin pays nothing on any result: the rule says what supply does, not what price does.
```

**Proof:** https://burnticker.com/api/burnticker/v1/elections (live: 34 Senate races) and the Elections flow on
https://burnticker.com/burnticker/launch; the El-Sayed / Rogers pair page once launched.
**Checked against:** `src/lib/burnticker/oracle/polymarket.ts`, `src/lib/burnticker/elections.ts`, `config/burnticker/sos.json`.
**Gap:** the election-pair template's composite rule (FEC beats + one-shot winner) and its both-or-neither clause are listed as
pending cores (`docs/burnticker/README.md` "Elections"); pitch the one-shot race coin, not the composite.

## 4. Fiscal / debt-clock audience ($DEFICIT)

```text pitch
Every $1B the U.S. national debt rises, 2% of $DEFICIT's burn pool buys it back and burns it. Treasury's own number, a receipt every burn day.
```

```text pitch
$DEFICIT reads Treasury's Debt to the Penny each business day.
Every full $1,000,000,000 added since the previous reading is one unit; each unit spends 2% of the burn pool buying $DEFICIT on its own pool, and the program burns it all.
The receipt carries the two Treasury rows, the arithmetic and the rule hash.
```

```text pitch
$DEFICIT is a memecoin whose supply follows one public number: Treasury's Debt to the Penny. Each business day Treasury posts the previous day's total; every full $1,000,000,000 it rose is one unit, and each unit spends 2% of the coin's burn pool buying $DEFICIT on its own pool, with everything bought burned in the same instruction (spend = pool × (1 − 0.98^units)). The figure is cross-read against FRED's quarterly copy of the same debt. Each burn day gets one post with the Treasury figure, the change, the units, the tokens burned and the transaction. A memecoin: the rule says what supply does, not what price does.
```

**Proof:** https://deficit.burnticker.com/ and the Treasury feed it reads
(`https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/debt_to_penny`). Rule file sha256
`8e3e8b66748a…be58` (`config/burnkeeper/deficit.rules.json`, 2 %).
**Do not send this pitch until** the $DEFICIT page stops saying 0.99 in two places (COLD-READ.md edit D-1, D-2): today the pitch
says 2 % and the page's arithmetic block says 1 %.

## 5. Builders and bots (SDK / API)

```text pitch
The launchpad where the rule is enforced by a program, not a promise: open source, a keyless API, an SDK, unsigned transactions only.
```

```text pitch
Every Burnticker coin's rule, readings and receipts are public JSON; every launch is an unsigned transaction you sign yourself.
Keyless HTTP API (OpenAPI 1.15.0) for search, back-tests, launch bundles and receipt verification.
The program, keeper, pages and tests are open source.
```

```text pitch
Everything the Burnticker wizard does is available to a bot: search every settleable result, back-test a rule, build an unsigned launch bundle, read any coin's status and receipts, and verify one receipt against its source and the chain — through a keyless HTTP API under /api/burnticker/v1 (OpenAPI 1.15.0) or the TypeScript SDK in the repository. The wizard and the API share one pipeline, so a refusal, a hash or a fee can never differ between them. The on-chain program, the keeper, the pages and the tests are open source, with the Powers Register generated from the program's IDL.
```

**Proof:** https://github.com/rfzfhn67yk-netizen/burnticker and https://burnticker.com/api/burnticker/v1/openapi.json (live, 1.15.0).
**Checked against:** `docs/burnticker/api.md`, `docs/burnticker/sdk.md`, `src/lib/burnticker/api/spec.ts`. **Gap:** `@burnticker/sdk` is
not on npm (`npm view` → 404; licence `UNLICENSED` until the owner decides), so the pitch says "the SDK in the repository", never
"npm install".

## 6. Sceptics, press and security

```text pitch
Here is the program, the reviews, the devnet receipts, the coverage table and the bounty terms. Check it.
```

```text pitch
Burnticker is open source and not audited by a security firm.
Three blind AI reviews are published in full with every finding and its fix; the adversarial ChatGPT review is pending; the bounty terms are drafted, not published.
Every power the operator holds is on the Powers Register, generated from the program's IDL.
```

```text pitch
Burnticker is run by one independent operator who also runs trading bots — and those bots refuse every Burnticker coin in code that is public. The program, keeper and pages are open source. Three blind AI reviews are published in full, every finding with its fix; the adversarial ChatGPT review is pending and the bounty terms are drafted, not published; no security firm has audited any of it. Quorum is one key at launch, the operator's, and the trust page says so. The trust page lists every wallet, every power, the decision log, the incident log, the settlement coverage table and the known limitations.
```

**Proof:** https://burnticker.com/burnticker/trust (live) and https://github.com/rfzfhn67yk-netizen/burnticker/tree/main/docs/burnticker/reviews.
**Checked against:** `config/burnticker/transparency.json`, `config/public-repo/overlay/SECURITY.md`, `docs/burn-receipts/powers-register.md`.
When the ChatGPT report lands and the bounty is published, edit the two status phrases here and in OUTREACH.md; the generator's
posts follow `transparency.json` on their own.

---

## The six one-liners (for the report and the pinned doc)

1. Coins that burn on real-world results, and every burn has a receipt you can recompute: no team wallet, no creator cash, LP locked forever.
2. A coin for your team that burns every time they lose (or win), settled on the final score and checked against a second scoreboard.
3. Any resolved race can have a coin that burns on the on-chain payout. Not odds, not a bet: a burn with a receipt.
4. Every $1B the U.S. national debt rises, 2% of $DEFICIT's burn pool buys it back and burns it. Treasury's own number, a receipt every burn day.
5. The launchpad where the rule is enforced by a program, not a promise: open source, a keyless API, an SDK, unsigned transactions only.
6. Here is the program, the reviews, the devnet receipts, the coverage table and the bounty terms. Check it.

## Where this differs from PLAN.md §2 (stated, not silently changed)

- **Prediction-market pitch:** the plan's wording "the payout read from the chain" fails the `no-prizes` lint (only "on-chain payout"
  and "payout vector" are allowed spans); the pitch says "burns on the on-chain payout".
- **Sports pitch:** the plan's "ended with the season, nothing left behind" depends on the season window, which is not on main
  (`agent/UI-2026-10-10`, WIP). The pitch leaves it out until it merges.
- **Sports proof:** "the window sentence" does not exist on main; the proof is the Team coin path itself.
- **Traders proof:** "a live receipt + the verifier" — no mainnet receipt exists yet; the devnet receipt stands in, labelled devnet.
- **Builders pitch:** "the only launchpad where…" is a superlative this pack cannot verify; the pitch says "the launchpad where…".
