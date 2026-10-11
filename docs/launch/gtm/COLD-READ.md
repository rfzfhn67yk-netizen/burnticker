# Cold-read test of the live site (GTM pack, 2026-10-10)

PLAN.md §4 gate: "a stranger can say what it is, what a burn is, what is promised". Method: fetch the live pages with a plain browser
user agent, strip markup, read top to bottom as someone who has never heard of the project, write the three sentences, then list every
place the reader had to guess or could read a promise. Pages: https://burnticker.com , https://burnticker.com/burnticker ,
https://burnticker.com/whitepaper.html (`/whitepaper` and `/burnticker/whitepaper` are 404 — the nav links `whitepaper.html`, fine),
plus https://deficit.burnticker.com/ because two pitches point at it.

Every suggested replacement in the `text edit` blocks below passes the copy lint (`test/gtmDocs.test.ts`).

## Round 1 — live at 2026-10-10 15:45 UTC (before the copy re-cut) — FAIL

The landing then said, in its first paragraph, that coins burn on a settlement of the event-contract venue this pack never names;
listed 14,934 of its series; drew both example rivalries on its tickers; led every sports example with the NFL; said $DEFICIT spends **5 %** per unit (the rule says 2 %);
offered creators "optionally a disclosed slice (≤ 20 %)" of fees (contradicting "creators earn nothing"); promised a "v2" second
attester and an upgrade authority "renounced once audited". A stranger could state what it was, but would have been told three things
that are not true of the code and one future promise. Main had already fixed part of this; the live host lagged main.

## Round 2 — live at 2026-10-10 23:34 UTC (= main `dc804777`, after merging the copy re-cut) — PASS WITH EDITS

`curl` of https://burnticker.com/ is byte-identical to `site/burnticker/index.html` on main; line numbers below are that file's.

**The three sentences a stranger writes after one read:**

> Burnticker is a Solana memecoin launchpad where each coin carries one locked rule tying it to a real-world result — a team's game,
> a city's high temperature, the U.S. national debt. A burn is what happens when that result settles: the coin's own trading fees buy
> the coin back on its own pool and a program destroys what they bought, leaving an on-chain receipt with the source, the numbers and
> the rule hash. Nothing is promised beyond the rule running as written — nobody wins anything, creators earn nothing, the platform
> never buys, and the page says it is not audited by a security firm.

All three are correct against the code. The reader got there, but had to work for "what a burn is": the hero never says Solana,
memecoin, or what "burn" means — that comes from the receipt section 50 lines down and the disclaimer at the bottom.

### Where the reader guessed, or could read a promise

| # | Where | What the reader thinks | Why it matters |
|---|---|---|---|
| G1 | index.html 242–243 (hero) | "coins that burn" — burn how? which chain? | the one definition the page exists to give is not in the hero |
| G2 | index.html 291–309 (the $RAYS receipt) | $RAYS is a live coin; receipt #5 happened; "RECOMPUTED ✓ CHAIN = SOURCE" | it is an illustration with no "example" label — the scoreboard (340) and rivalry (368) carry one, this does not. No platform coin is live (`/api/burnticker/v1/tokens` → 0, devnet) |
| G3 | index.html 256 (Seasons door) | $OILERS 6 · $RAYS 5 · … are live counts | unlabelled example numbers |
| G4 | index.html 266 ("reviewed" chip) | "reviewed" = audited? | the page says "not audited" only at line 473 |
| G5 | index.html 465 ("the platform's share of post-graduation LP fees") | the platform takes a cut after graduation | false: LP is 100 % burned and the developer's post-graduation take is 0 (decisions.md 2026-10-09 "LP"; `fees.ts` `PLATFORM_SCALE_PPM = 0`); it also contradicts "all LP burned" in the same sentence |
| G6 | index.html 435 ("If we disappear, the public readings and the program keep working") | burns continue without the operator | false at quorum 1: every reading needs the operator's attester key, so if the operator stops, readings stop and burns stop (`transparency.json` `quorum-1`). This is the one sentence that reads as a promise the code does not keep |
| G7 | index.html 395, 413, 435 ("anyone can crank") | always permissionless | true after the pre-audit window; during it a PlatformConfig may carry a cranker list of up to 3 keys for at most 90 days (Powers Register "Cranker allowlist") |
| G8 | index.html 436 ("the plan is a 2-of-3 multisig … set to none after review") | a commitment about the future | policy `nothing-coming-soon`: state who holds it today; plans live on the trust page |
| G9 | index.html 434 ("not built yet") | it is on its way | policy wording is "not built" |
| G10 | /burnticker (app chrome) `SiteFooter.tsx` 21 | "BURNS ON THE NEWS" | the retired tagline was on every app page — fixed on main by round 3 |
| G11 | /burnticker "DEV FEE" line (`fees.ts` 81 `USE_OF_FEES`) | the fee "funds … the audit": there is or will be an audit | the decision is no paid audit; the fee funds reviews and the bounty |
| G12 | deficit.burnticker.com (`site/deficit/index.html` 329, 345) | 1 % per unit (0.99^units) in the arithmetic, 2 % in the rule sentence (238) | the page contradicts itself; the rule file is 2 % (sha `78f4c327…`) |
| G13 | whitepaper.html status table and §11 (from `docs/burnticker/WHITEPAPER.md` 6, 12, 15, 137, 543, 559) | nothing deployed, no devnet rehearsal, no public repo, no contact, 2 of 11 categories settleable | all stale since 2026-10-10: devnet rehearsal done (`docs/burnkeeper/devnet-run.md` §4), repo public, contact set, coverage 5 settleable · 6 adjudicated-only · 0 uncovered |
| G15 | index.html 262 (guardrail chip, round 3) | a second attester arrives within 14 days | a dated promise about something not built; see Round 3 |
| G14 | whitepaper.html §3 (rules example, finality, the settlement section) | the venue the pack never names, by name, 14 times in the markdown | owner call (OUTREACH "Risks" 2): its terms ask for written approval before public mention |

## Round 3 — live at 2026-10-10 23:52 UTC (= main `f1fff838`, merged into this branch) — PASS WITH EDITS

Live is again byte-identical to main. Two changes since round 2: the app footer now carries the new line (**E11 done**), and the
guardrail chip at line 262 changed from "quorum-signed readings" to "signed readings (one attester at launch, a second within 14 days)".
That chip is new guess **G15**: "a second within 14 days" is a dated promise about something not built (transparency.json
`switchboard-down`: "the 'attester #2 within 14 days' line … is the schedule, not a built thing"; policy `nothing-coming-soon`). The
same wording went into the public README overlay's guardrail line. Line numbers on the landing are unchanged (the edit was in place),
so the edit list below holds; E14 is added. The three sentences stand.

## Edit list for the copy agent (file · line on main `f1fff838` · replacement)

### `site/burnticker/index.html`

**E1 · after line 243** (`<p class="sub">Launch one. Follow the season.</p>`) — add one line under the hero:

```text edit
A Solana memecoin launchpad. Each coin has one locked rule; when its result settles, the coin's own trading fees buy it back on its own pool and a program burns what they bought. The transaction is the receipt.
```

**E2 · line 256** — label the example counts: `<span class="ex">example · $OILERS 6 · $RAYS 5 · $LAKERS 4 · $EAGLES 3 receipts</span>`

**E3 · line 266** — `<li>reviewed</li>` →

```text edit
three blind AI reviews, not a firm audit
```

**E4 · after line 309** (inside the receipt slip wrapper, after the stamp) — add `<p class="mocknote">` with:

```text edit
example receipt · illustrative numbers, not a live coin
```

**E5 · line 395** — "The fee pool has no withdraw instruction, and anyone can crank a burn the rule computes." →

```text edit
The fee pool has no withdraw instruction, and the program computes every burn from the rule and the signed reading: nobody chooses the amount.
```

**E6 · line 413** — "the reading is signed on chain, anyone can crank the burn, and the pool buys…" →

```text edit
the reading is signed on chain, the burn is cranked (a permissionless instruction; the trust page shows any pre-audit cranker list), and the pool buys the coin at market and burns everything received in one transaction whose memo carries the result, the arithmetic and the rule hash.
```

**E7 · line 435** — replace the "Permissionless crank" card text →

```text edit
crank_buyback computes the amount from the rule and the pool, swaps on the coin's own pool and burns in the same instruction; nobody chooses the amount. Anyone may call it, except that a pre-audit list of up to three crankers can apply for at most 90 days (on the Powers Register). Readings need the attester quorum, one key at launch (the operator's), so if the operator stops, burns stop; nothing can be withdrawn and every past receipt stays checkable.
```

**E8 · line 436** — last sentence of "No withdraw instruction" →

```text edit
The program can still be upgraded; who holds the upgrade authority today, and under what time lock, is on the trust page.
```

**E9 · line 465** — the "burnticker" card →

```text edit
A platform fee of 25 bps of curve volume, set in the LaunchLab platform config and read live on the trust page. Nothing after graduation: all LP is burned, so there is no platform share of LP fees. Nothing from burn pools, ever. The platform never buys any coin launched here.
```

**E10 · line 434** — "a second, independent attester is not built yet." → "a second, independent attester is not built."

**E14 · line 262** (and the same words in `config/public-repo/overlay/README.md`'s guardrail line) — "signed readings (one attester at
launch, a second within 14 days)" →

```text edit
signed readings (one attester at launch; a second is not built)
```

### `src/app/burnticker/_components/SiteFooter.tsx`

**E11 · line 21** — done on main (`941892e7`): the footer now reads "COINS THAT BURN ON REAL-WORLD RESULTS · WITH RECEIPTS".

**E12 · line 35** — `X · @burnticker` → `X · @BurnTicker` (cosmetic; handles are case-insensitive).

### `src/lib/burnticker/fees.ts`

**E13 · line 81** `USE_OF_FEES` (also quoted in WHITEPAPER.md 426) — owner wording, so the owner decides:

```text edit
Burnticker's 25 bps funds attesters, hosting, the reviews and the bounty, and the operator. The platform never buys back any coin, including its own.
```

### `site/deficit/index.html`

**D1 · line 329** — `spend = pool × (1 − 0.99^units)` → `spend = pool × (1 − 0.98^units)`
**D2 · line 345** — `1 − 0.99<sup>units</sup>` → `1 − 0.98<sup>units</sup>` (the rule file is 2 %; line 238 already says so).

### `docs/burnticker/WHITEPAPER.md` (then regenerate `site/burnticker/whitepaper.html`)

**W1 · line 6** →

```text edit
Status at the time of writing. The program is deployed on devnet (the 2026-10-10 rehearsal, docs/burnkeeper/devnet-run.md); nothing is deployed on mainnet.
```

**W2 · line 12** → two rows: `Devnet rehearsal | done 2026-10-10 | docs/burnkeeper/devnet-run.md §4` and `Mainnet rehearsal coin | not done | docs/burnticker/REHEARSAL-RUNSHEET.md`.
**W3 · line 15** → `Public repository | public | https://github.com/rfzfhn67yk-netizen/burnticker`.
**W4 · lines 137 and 543** — "two of eleven categories are settleable" → "five of eleven categories are settleable (Sports, Economics,
Financial markets, Weather & Climate, Crypto & On-chain)", per `docs/burnticker/SETTLEMENT-COVERAGE.md`.
**W5 · line 559** — drop "devnet rehearsal", "the public repository" and "the operator contact address" from the not-built list.
**W6 · the 14 lines naming the unnamed venue** — owner call (G14); if scrubbed, "a regulated event-contract venue" reads the same.

### `config/burnticker/transparency.json` (feeds the trust page and the generator's review line)

**T1** `limitations[id=devnet-rehearsal]` → status `done 2026-10-10`, text pointing at `docs/burnkeeper/devnet-run.md`.
**T2** `limitations[id=public-repo-not-created]` → status `done`, the URL; remove `publicRepo.todo`.
**T3** `limitations[id=contact-todo]` → status `done` (contact@burnticker.com); `howBuilt.bounty.contact` → `security@burnticker.com`.
**T4** `limitations[id=program-not-deployed]` → "deployed on devnet (program `AuQjoSgq…`); not on mainnet".
**T5** `rehearsals[REHEARSAL]` stays "not done" until runsheet B; then mint, date and what it proved (fee routing, an attested reading —
not a burn; see CALENDAR.md conflict 1).

### `config/public-repo/overlay/README.md` and `SECURITY.md`

**R1 · README line 60** — "Every burn writes a memo: `BT|TICKER|…|v3`" → the program writes the v1 (vault) / v2 (buyback) memo on chain;
`BT|…|v3` is the platform's off-chain receipt (`docs/burnticker/README.md` §10, "Memos").
**R2 · README line 41** — the directory map names the unnamed venue's oracle → "prediction-market discovery adapters".
**R3 · SECURITY.md line 3** — "reviewed by two independent AI adversarial reviews" → "three blind AI reviews (published) and an
adversarial ChatGPT review (pending)".

## Re-test

Re-run after the edits deploy: `curl -sL -A "Mozilla/5.0" https://burnticker.com/ | diff - site/burnticker/index.html` (live = main),
then this read. Pass condition: G1–G9 and G15 gone; the three sentences unchanged.
