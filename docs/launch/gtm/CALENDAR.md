# Launch calendar, T-14 → T+7 (GTM pack, 2026-10-10)

Under [PLAN.md](PLAN.md) §4 (timeline), §5 (content), §6 (what "working" means) and §7 (owner checklist). **T = the $DEFICIT launch,
a weekday, the create at 08:00 Denver.** The owner sets T; the dates below are a proposal that fits every gate known today. All times
America/Denver (MDT until 2026-11-01, then MST).

## Proposed dates (owner to confirm or move)

| Event | Proposed | Why this slot |
|---|---|---|
| **T — $DEFICIT launch** | **Mon 2026-10-26, 08:00 MDT (14:00 UTC)** | Treasury posts Friday's figure Monday afternoon: that first reading is the baseline, and Monday's figure (posted Tue afternoon) is the first that can count units. A Friday launch would open on a weekend with nothing to report; Mon 10-12 is Columbus Day (no Treasury post). |
| $REHEARSAL on mainnet (runsheet B) | **Thu 2026-10-22** | midweek, and "1–2 weekdays before launch" (REHEARSAL-RUNSHEET §B). |
| Team coins open to creators + invites | Fri 2026-10-23 (T-3) | PLAN §4 T-3 → T-1. |
| Burn Derby Season 1 announced | Sat 2026-10-24 (T-2) | rules and start time posted two days ahead. |
| Burn Derby Season 1 starts | **Wed 2026-10-28 00:00 UTC** (Tue 18:00 MDT) | a season must start at a future 00:00 UTC (DERBY.md refusals); 30 days → ends 2026-11-27 00:00 UTC. Same week as T. |
| El-Sayed / Rogers pair | launch Wed 2026-10-28 (T+2) | "within days" of T and before Election Day, Tue 2026-11-03. The one-shot race coins only (the composite FEC template is a pending core). |
| Go / no-go | Fri 2026-10-16 (T-10) and Mon 2026-10-19 (T-7) | the T-14 → T-8 facts must be straight before T-7 starts. |

Today, Sat 2026-10-10, is T-16.

## Where the sequence conflicts with the documents (stated, not silently resolved)

1. **"$REHEARSAL receipts posted as the proof" (PLAN §4 T-7 → T-4) cannot happen as written.** A $0.10 first buy does not graduate a
   LaunchLab curve (≥ 24 SOL of buys; REHEARSAL-RUNSHEET D-2), and without a CPMM pool there is no burn. What $REHEARSAL can prove on
   mainnet: the real program and platform config, fee routing into the fee PDA, and an attested reading. The post says that; it does not
   say "burn" or "receipt". The burn proof stays the devnet receipt (`teaser --topic=devnet-receipt`).
2. **"First reading that evening → first receipt post" (PLAN §4 T).** The first reading after launch is the baseline (no units), and no
   burn happens before $DEFICIT's curve graduates (runsheet C11, "no burn is expected before graduation"; ≈ 40 SOL proposed, LAUNCHPAD
   §26). Launch evening posts the no-burn daily (`scripts/burnkeeper-post-draft.mts --auto`), and the launch thread says burns wait for
   the pool (the generator's $DEFICIT thread, post 4).
3. **Announcement before finalisation.** REHEARSAL-RUNSHEET D-1 cites README §5.3 (review-2 F16): no mainnet launch announcement until
   the upgrade authority is `none` and the verified hash is published. PLAN §4 announces at T. The owner decides D-1 before T-7; until
   then the platform thread's guardrails do not claim finalisation (they do not today).
4. **"$REHEARSAL two to three days before" (PLAN §4) vs "1–2 weekdays before" (runsheet §B) vs "midweek" (brief).** Thu → Mon meets the
   runsheet and "midweek"; it is four calendar days, not two to three.
5. **Seasons page.** PLAN §4 T-3 says "Seasons page shows the leagues the gate passes". The landing's Seasons door links to
   `/burnticker/rivalries`; there is no `/burnticker/seasons` route on main, and the season window (this season / postseason) is on
   `agent/UI-2026-10-10`, not merged.
6. **Verifier route.** PLAN §6 counts hits on `/v1/receipts/*/verify`; the route is `/api/burnticker/v1/tokens/{ticker}/verify/{id}`
   (OpenAPI 1.10.0). Measure that one.

---

## T-14 → T-8 (Mon 10-12 → Sun 10-18) — get the facts straight

| Day | Work (engine / show) | Outreach | Posts (generator → queue → owner posts by hand) | Owner-side |
|---|---|---|---|---|
| T-14 Mon 10-12 | COLD-READ.md edits applied (copy agent): the unlabelled $RAYS receipt, the "If we disappear" line, the post-graduation LP line, the $DEFICIT page's 0.99 | — | none (no account yet) | X account: email attached, avatar, header re-rendered without the retired tagline and the venue line (x-burnticker-profile.md TODO) |
| T-13 Tue 10-13 | transparency.json stale rows fixed (devnet rehearsal done; public repo exists; contact set) | Treasury Fiscal Data data question (OUTREACH §11) | — | ChatGPT review handed over (PLAN §7) |
| T-12 Wed 10-14 | ChatGPT review report committed in `docs/burnticker/reviews/`; findings fixed or answered | — | — | decide licence split; GitHub org move (optional) |
| T-11 Thu 10-15 | Sports sources settled (OUTREACH "Risks" 1: no ESPN reads; league feeds + TheSportsDB): set the commercial TheSportsDB key before soccer outreach | — | first teasers queued: `teaser --topic=open-source`, `--topic=devnet-receipt` | SECURITY.md out of draft (tiers, remove the placeholder line) |
| T-10 Fri 10-16 | **go / no-go 1:** cold read passes; reviews published; coverage table live on trust page | — | `teaser --topic=reviews` (re-run after the ChatGPT report: its wording follows transparency.json) | Phantom address, third Squads signer named, ~15 SOL ready (PLAN §7) |
| T-9 Sat 10-17 | pitches and outreach final (this folder) | — | `teaser --topic=coverage` | — |
| T-8 Sun 10-18 | queue seeded with teasers true today | — | `teaser --topic=the-rule` (@USA_DEFICIT) | decide D-1 (finalise before announcing?) |

## T-7 → T-4 (Mon 10-19 → Thu 10-22) — the engine in public

| Day | Work | Outreach | Posts | Owner-side |
|---|---|---|---|---|
| T-7 Mon 10-19 | **go / no-go 2.** Mainnet setup B0–B9 (program deploy, Squads, platform config) | Raydium `#partnerships` (needs the mainnet PlatformConfig id) · Solana ecosystem directory · Helius guest-blog pitch · @jup_vrfd launchpad DM | thread: `explainer --topic=how-a-burn-happens` with the devnet receipt | B0 keys + funding; B3 Squads |
| T-6 Tue 10-20 | GitHub README is the builder pitch (overlay README) | security people (OUTREACH §9) | `explainer --topic=what-a-receipt-is` | B9 platform config sent |
| T-5 Wed 10-21 | security.txt + sec3 X-ray output published with the reviews (if done) | SolanaFloor editorial · Superteam Earn bounty listing (after SECURITY.md is final) · Superteam USA | `explainer --topic=why-lp-is-burned` | — |
| T-4 Thu 10-22 | **$REHEARSAL on mainnet** (runsheet B10–B20) | whitepaper to the sceptic list | one post: "the real program and platform config on mainnet; fee routing checked; a reading attested" with the transactions — hand-written from the B15/B17 records and linted with `scripts/burnkeeper-post-draft.mts lint` (the generator has no $REHEARSAL format, by design: it is not a coin anyone should trade) | B13/B14 signatures |

## T-3 → T-1 (Fri 10-23 → Sun 10-25) — the show, framed

| Day | Work | Outreach | Posts | Owner-side |
|---|---|---|---|---|
| T-3 Fri 10-23 | team-coin creation open to communities | hand-written invites to 5–10 communities across leagues, only where rules allow (OUTREACH §13): Rays, Lakers, Oilers, Eagles order | `explainer --topic=why-creators-earn-nothing` | — |
| T-2 Sat 10-24 | Derby Season 1 bracket and rules published | — | Derby announcement (hand-written from the bracket page; lint it) | — |
| T-1 Sun 10-25 | $DEFICIT pre-launch page live: the rule, 2 %, the Treasury feed, the launch time stated as a time (no countdown) | — | launch-day queue written and approved tonight: `launch-thread --kind=deficit` (fill `--launch-tx` in the morning), `launch-thread --kind=platform` | C1 day-before state check; DexScreener $299 payment ready |

## T — Mon 10-26, launch morning

| Time (MDT) | Step | Post |
|---|---|---|
| 07:30 | C1–C6 checks, the two-person read of the rule (gate 4) | — |
| 08:00 | C7 create, no team buy; C8 seed 3 SOL (disclosed) | — |
| 08:15 | receipts page live (deficit.burnticker.com) | `launch-thread --kind=deficit --launch-tx=<url>` (@USA_DEFICIT) |
| 08:30 | **DexScreener Enhanced Token Info ($299)** — owner pays; Solscan form; Jupiter standard submission | `launch-thread --kind=platform` (@BurnTicker) |
| afternoon ET | Treasury posts Friday's figure → the baseline reading | — |
| evening | no-burn daily for @USA_DEFICIT: `scripts/burnkeeper-post-draft.mts --auto` (baseline day) | one post |

Operator rule for the day: nothing about price, ever; every "wen" reply is the rule sentence.

## T+1 → T+7 (Tue 10-27 → Mon 11-02) — cadence

| Day | What happens | Posts |
|---|---|---|
| T+1 Tue 10-27 | Monday's figure posts: units counted; burns wait for graduation (they queue) | @USA_DEFICIT daily (`burnkeeper-post-draft.mts --auto`); after graduation, each burn: `receipt --deficit` |
| T+2 Wed 10-28 | Derby Season 1 day 1 (00:00 UTC); El-Sayed / Rogers pair launched | `launch-thread --kind=coin --ticker=ELSAYED` and `ROGERS` only if a creator launched them; `scoreboard --pair=<id>` |
| T+3 Thu 10-29 | first team coins by creators (never ours) | `launch-thread --kind=coin --ticker=<T>` per creator coin; `season-card --ticker=<T>` |
| T+4 Fri 10-30 | daily scoreboard once there are days | `scoreboard --day=<yesterday>` |
| T+5 Sat 10-31 | weekend: Treasury does not post | @USA_DEFICIT no-burn daily (weekend reason) |
| T+6 Sun 11-01 | weekly roll-up (Denver Sunday) | `burnkeeper-post-draft.mts --auto` (weekly) |
| T+7 Mon 11-02 | "week one receipts" thread with the verifier | hand-assembled from the queue's receipt posts + one `explainer --topic=what-a-receipt-is`; any incident is posted first by us, with the transaction (`burnkeeper-post-draft.mts --template=incident`) |

Every day: `receipt` for each confirmed burn on any coin (`receipt --ticker=<T> --day=<yesterday>`), both accounts; nothing else is
automatic.

## Owner-side list (PLAN §7, with status today)

| Item | Status 2026-10-10 |
|---|---|
| ChatGPT report handed over | pending (transparency.json `chatgpt-adversarial: pending`) |
| X email attached, avatar set, header re-rendered | header still carries the retired tagline and a venue line (x-burnticker-profile.md) |
| Operator contact address | **done**: contact@burnticker.com (`OPERATOR_LINE`), security@burnticker.com (SECURITY.md) |
| Phantom address + third Squads signer + ~15 SOL | open (runsheet §0.1: mainnet ≈ 12 SOL moved) |
| DexScreener $299 ready for launch morning | open; verified price $299 (marked down from $499) on marketplace.dexscreener.com, 2026-10-10 |
| Licence split, trademark (optional) | open; SDK `UNLICENSED` |
| GitHub repo → a `burnticker` org (optional) | open; today `rfzfhn67yk-netizen/burnticker` |
| Optional consent email to the event-contract venue | optional; nothing waits on it (PLAN §7) |
| Decide D-1 (finalise before announcing) | open (REHEARSAL-RUNSHEET) |
| Decide: ESPN terms for team coins | resolved 2026-10-10: no ESPN reads (league feeds + TheSportsDB; ESPN a human link only) |
| Decide: publish `docs/launch/gtm/` in the public repo, or exclude it | open (OUTREACH "Risks" 3) |

## How "working" is measured (PLAN §6; none is price)

| Measure | Where to read it |
|---|---|
| Creators launching coins we did not launch | `index.json` tokens whose creator wallet is not on transparency.json's wallet list |
| Receipts posted every day a rule fires | the queue (`data/launch/post-queue.jsonl`, format `receipt`) against each coin's `receipts.json` confirmed rows |
| Verifier runs from strangers | access log hits on `/api/burnticker/v1/tokens/*/verify/*` (not `/v1/receipts/*/verify`) |
| Outreach that turns into a listing, a mention or a launch | OUTREACH.md, one line per reply, dated |
| Zero copy-lint violations in anything posted | everything posted came through the queue (refusals never queue); hand-written posts go through `burnkeeper-post-draft.mts lint` |
| Zero claims retracted | `docs/burnticker/incidents/LOG.md` and in-thread corrections |
