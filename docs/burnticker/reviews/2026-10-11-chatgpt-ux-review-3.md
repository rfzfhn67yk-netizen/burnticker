# ChatGPT live UX + feature review, round 3 — delivered 2026-10-11 (inspection 15:43–15:54 MDT against public commit 191d3b3b), published here unedited. Response/disposition: 2026-10-11-chatgpt-review-3-response.md.

Note: the body below is the text as it was saved when the owner pasted it; the language glossary table and the pinned route-inventory tables were condensed to one-paragraph summaries at that point, and are reproduced here as saved.

# Burnticker: fresh live UX and feature report

**The useful experience today is a verifiable devnet receipt, but the main journey leads visitors into empty seasons and coins before showing that evidence.** Shorten the pre-launch journey around three available tasks: understand the rule, inspect the real rehearsal receipt, and read current operating limits. Keep unavailable launch and trading actions plainly closed.

## Observation boundary

Fresh read-only browser inspection on **October 11, 2026, America/Denver**, with evidence timestamps approximately **15:43–15:54 MDT (21:43–21:54 UTC)**. Some navigation began earlier in the same session. The live host said creator launches were closed, the host read devnet, and neither program was deployed on mainnet. These are observed statements, not independently verified deployments. The live API documentation displayed **1.13.0**. I could not establish a web deployment commit; the displayed verified program-build commit is not a web release identifier.

Code references below are pinned to `191d3b3b25286e799f9678c18ed319d3c8c5cec8`. A route inventory is not a security audit of its unchanged implementation. The separate code report restricts defects to `782e31ec9b4d64ac4161293a64bb2d4ac6abb6c2..191d3b3b25286e799f9678c18ed319d3c8c5cec8`. UX observations may concern older copy and are **not** relabeled as new code findings.

Desktop inspection plus an actual **390 × 844 browser viewport** inspection of the homepage and receipt verifier. No physical phone, wallet connection, signature, transaction, launch, production mutation or outage injection. Gated signing screens are described from pinned code only. No interviews or measured conversion study: the personas below are simulated judgments.

## Three simulated visitors

| Persona and goal | Observed entry and click path | First likely confusion; stopping point |
|---|---|---|
| Trader, 60 seconds to understand and inspect a coin | Home → Coins → coin index; then Launch → closed launcher → "Explore a verified burn" → verifier. | Home promises "COINS THAT BURN ON REAL-WORLD RESULTS — WITH RECEIPTS." Coins says "No coin is launched on this host yet." Raw `FakeBurnProgram` diagnostics obscure whether this is a demonstration or failed system. A likely first-minute stop is the empty index. Continuing to the supplied receipt gives "Verified: all 10 checks passed." Put that route first; do not invent an active market. |
| Sports fan, no wallet | Home → "Follow the season." → Leagues → MLB 2026. | Directory says "every league page is empty for now"; MLB says "This page tracks processed coin receipts, not every game." "Settled games" resembles a general results service until that caveat is read. Stop: no team-coin receipts and no games settled for the date window. No wallet prompt blocked reading. Offer the explanation and clearly labeled example before 25 empty league links. |
| Sceptic, wants control, money and evidence | Home → Trust → Operator → Fee ledger, plus Check and Status. | Shared status usefully says "One operator attester signs every reading (quorum 1)" and no firm audit, but lower legacy paragraphs and wallet placeholders compete with it. Stop with unresolved operating evidence: status reports "status.json could not be read (HTTP 404). Current automation status is unavailable." The receipt proves one rehearsal transaction, not current automation or source independence. |

## Evidence-led cuts and corrections

1. **Promote the proof already available; cut the long entrance.** Home's only numbered door is "DOOR 2 · THE SHOW SEASONS". Remove the orphan number. Move the real-receipt action directly below the pre-launch status; reduce eleven guardrails and a six-term glossary before it to two sentences plus details. On the inspected mobile viewport, the "Explore a verified burn" link began about **1,588 px** below the document top. There was no horizontal overflow (390 px document and viewport). That is an observed layout distance, not a timed usability result.
2. **Empty states should offer one useful next step.** Coins still shows "NEW", "NEXT TO SETTLE", "ABOUT TO GRADUATE", "MOVED TO TRADING POOL" and "PAIRS 0" above zero coins. Hide empty filtering until records exist. Keep "No wallet is needed to read results or receipts." Move the raw `FakeBurnProgram`, missing environment variable and script-name diagnostics into operator details. Distinguish "this host has no registered coins" from "the program is not deployed"; Trust simultaneously lists devnet programs.
3. **Combine control and fee disclosures once.** Trust's current summary correctly separates one signing operator, 2-of-3 upgrade authority, a current zero time lock, a planned 48-hour lock and seven fixed findings awaiting independent re-check. Keep those limits. Collapse repeated powers, fee and safety prose into one current summary with links to evidence. Do not say "nobody is paid": the live ledger explains 25 bps curve income and 20% of post-graduation LP SOL fees for the operator, with the other 80% to burn pools.
4. **Remove contradictory placeholders rather than filling them with assumptions.** Operator's wallet table has mainnet addresses while nearby text says every mainnet wallet is created on launch week and that the developer fee wallet "does not exist yet." Say "address configured; statement not signed" when that is what the evidence supports. Trust showed bounty "balance 0.0000 SOL (live, mainnet) · funded 2026-10-11"; ledger prose said funded with 5 SOL. Display recorded funding and current balance/read failure separately, with dated transaction evidence. These observations do not establish missing money or dishonesty.
5. **Use the receipt outcome before advanced controls.** The featured `$DEFICIT` October 6 devnet receipt reached "Verified: all 10 checks passed", with source, attestation and execution all "passed". Keep that layered distinction and the caveat that a signature establishes who signed, not truth. Initially the mobile anchor put the heading under the sticky header and foregrounded RPC/signature fields. Show the example outcome and three evidence layers first; place alternate RPC and manual signatures in "Check another receipt". Add anchor scroll margin.
6. **Keep rule winner distinct from team winner.** Templates correctly distinguish two unpaired coins from a registered pair, but a sports example fires when a team loses. "Winner takes the burn" can therefore imply the wrong team. Prefer "When this rule fires, both coins' eligible fees fund this coin's burn; nothing is paid to holders." A season champion is a receipt statistic. On MLB, "A game counts once a second independent operator agrees" conflicts with the current single-attester disclosure; distinguish a second publisher check from an independent signer. Derby also says "checked by an independent operator"; qualify actual operation rather than presenting planned independence as current.
7. **Separate active product from evidence and examples.** Internal $DEFICIT is particularly clear: not launched on this network, no rule account/reading/receipt on this host, launch date not announced, plus a real devnet example whose 1% rule differs from the 2% proposed mainnet rule. Keep that distinction. External $DEFICIT says "Trade: not available" and "Not launched: no reading yet", yet its footer says "Launched on Burnticker". Change the footer and collapse empty Live/Today/Receipts sections into one unavailable-state summary linking the real rehearsal receipt.
8. **Treat missing automation evidence as missing.** The status page's 404 message is useful, but blank Sources/Alerts/Keepers tables underneath could read as zero problems. Replace blank groups with unavailable labels while the feed is missing. Current deployment/config status still loads separately: explain that it does not show whether the keeper is currently processing. Do not promise "nothing burns" solely because this host lacks a status file.

The public fee ledger successfully loaded **16 balance-changing devnet transactions** and a **0.005041618 SOL** balance, generated `2026-10-11T21:51:11.566Z`; it labels rehearsal income and distinguishes chain data, keeper records and operator-entered expenses. Preserve this provenance. The "Not Burnticker" list loaded one hit and one search error and said "not a Burnticker coin (the program is not read on this host)"; soften any definitive classification when the underlying program check is unavailable, while keeping the evidence and no allegation of intent.

## Language encountered on the observed journeys

(Glossary table of 25 terms with plain meanings and actions — memecoin, Solana/SOL, devnet/mainnet, burn/supply, burn pool → "burn budget", receipt → "burn record", reading/units, attester/quorum → "reading signer (1 required)", settled/cross-read → "final result"/"second-source check", locked rule/rule hash, mint/ticker → "token address", LP/locked LP → "locked trading liquidity", FeeKey, graduation/curve/CPMM → "moved to trading pool", keeper/crank → "automation"/"one burn execution", pair-forwarding, wind-down/retired → "rule ended", carry/reserve cap/floor → planned/spent/remaining, bps/operator/creator → percent first, never "no one earns anything", upgrade authority/Squads/time lock, transaction/signature/atomic/memo, RPC → "data source", baseline/one-shot → "starting value"/"one result", Derby/champion/winning, Pyth/TWAP/Arweave.)

## "Three decisions" and the launch boundary

The live launcher is closed. The three useful stages are choose a result → review the rule and coin → approve the launch; they are not three clicks or three signatures. Pinned `ReviewCard.tsx:53`, `SignCard.tsx:20`, `signPlan.ts:91` and `signPlan.ts:191`: a plan contains steps; multi-step plans need more than one prompt; the pair-curve path uses separate mint A, mint B and pair initialization steps. A reload can reconcile a stored pending transaction; it cannot reconstruct unsent steps that need the original in-memory mint keys.

**Smallest change:** rename the promise to "Three stages" and, before opening the wallet, show the selected network, actual transaction/signature count, fees/rent estimate when calculable, any additional selected amount, and what happens after a rejected or uncertain send. Do not say "retry the launch" when the app only needs to check an already sent transaction.

## Complete pinned route inventory

19 page files, 43 versioned API handlers under /api/burnticker/v1, 11 app-internal handlers under /api/burnticker, 5 other handlers, plus the Caddy/static families (status, fallback, deficit site, keeper-published index/audit/ops/status JSON, www redirect). Coverage legend L/G/D/C/E per row. (Full tables in the owner's pasted copy; the dispositions all reduce to the ten changes below.)

## Ten practical changes, in order

| Priority | Change / surface | Why / acceptance | Effort |
|---|---|---|---|
| 1 | Fix **F1**, shared current-status model/renderers | Partial ProgramData failure, absent data and malformed data say unavailable; only decoded None says no authority. Include focused regression tests. | 2–4 h |
| 2 | Shorten Home; primary action "Inspect the devnet receipt"; remove "Door 2" | At 390×844, status and receipt action appear in the first view; examples remain marked; no launch implication. | 1–2 h |
| 3 | Hide zero-result filters on Coins and combine empty Rivalries/Seasons navigation | Zero-data visitor gets one explanation and one evidence link; populated states retain their navigation. | 1–2 h |
| 4 | Move raw host diagnostics to details; label missing status groups | Consumer sees network/availability; operator can still inspect precise cause. Status 404 produces no apparently clean empty tables. | 1–2 h |
| 5 | Consolidate Trust/Operator status and remove conflicting wallet/bounty placeholders | Current authority, time lock, income, funding record and unknown reads use dated evidence; no "wallet does not exist" beside a configured wallet. | 2–4 h |
| 6 | Correct sports/Derby independence and rule-winner wording | One signer versus two publishers is explicit; paired money funds a burn and never a holder; champion remains statistical. | 1–2 h |
| 7 | Reorder verifier and fix anchored mobile heading | Example result visible before RPC controls; anchor clears sticky header; rejected/unavailable checks retain separate states. | 2–3 h |
| 8 | Collapse external DEFICIT empty sections; link internal rehearsal proof | No "Launched" footer while not launched; no new buy action or launch-date promise; rehearsal 1% and proposed 2% stay distinct. | 1–2 h |
| 9 | Add concise plan-specific launch summary before wallet, while gate remains closed | Network, actual signature count, cost estimate or unavailable cost, selected extras and recovery limits are visible before signing. | 3–5 h |
| 10 | Replace front-loaded glossary with context help | First use of budget, signer, token address and execution is understandable; advanced identifiers remain accessible under evidence. | 2–3 h |

**Realistic one-day subset:** items 1–4. Only item 1 is a confirmed scoped code finding.

Suggested compact homepage copy:

> Coins whose rules burn tokens when public results settle. Creator launches are closed; this site currently shows devnet rehearsal evidence. Inspect one real receipt to see the source result, the signed reading and what the transaction burned. No wallet is needed.

Suggested paired-result copy:

> This result fires this coin's rule. Under the registered pair's conditions, eligible funds from the other coin join its burn budget. The program buys and burns tokens; nothing is paid to holders.

Suggested unknown-state copy:

> Current automation data could not be read. The program/deployment summary below is separate and does not establish whether burns are being processed now.

Copy changes should continue through the repository's copy tests/lint. They should not introduce Burnticker-token price, market-cap, return or odds claims, prize/reward/staking language, urgency, endorsements or promised launch dates.
