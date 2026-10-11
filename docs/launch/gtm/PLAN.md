# Burnticker — pre-launch marketing plan (saved 2026-10-10, evening Denver)

Owner: "come up with a plan to market before launch and save it, we'll need it later." This is the plan of record; the GTM builder's
pack (`docs/launch/gtm/PITCHES.md`, `OUTREACH.md`, `CALENDAR.md`, the post generator, the cold-read report) fills in names, handles
and drafts under it. Decisions it rests on: LAUNCHPAD-PATH.md §13–§30.

## 0. What we are selling, in one breath
**Coins that burn on real-world results — with receipts.** Launch one. Follow the season.
Two layers shown by example, never by claim: the engine (a launchpad where the rule is enforced by a program, not a promise) and the
show (seasons, rivalries, derbies — scoreboards of burns). Nothing is ever won; things are only burned.

## 1. Rules of the campaign (non-negotiable; most are published platform policy)
- No price talk, no promises, no prizes/payouts/odds/bets, no "coming soon" — the copy lint enforces it on every post and page.
- **No paid promotion of any kind**: no KOLs, no boosts, no trending-bar ads, no "partnerships" that are payments. The one paid item is
  DexScreener Enhanced Token Info ($299) for $DEFICIT on launch morning — listing hygiene, not promotion.
- Never call the reviews an audit. Say: three blind AI reviews, an adversarial ChatGPT review, a public bounty, open source.
- Never name Kalshi (its terms forbid public mention without written approval). Polymarket only as "an on-chain payout".
- All leagues, always: rotate Rays / Lakers / Oilers / Arsenal / Inter Miami / Eagles; never lead with the NFL.
- Operator reachable (contact@burnticker.com; identity held privately until an LLC exists — owner 2026-10-10 "too much exposure"). Creators earn nothing. No team buy. The platform never buys any coin. LP locked forever; its fees fund the burn (80 % burned, 20 % operator, fixed in code).
- Every claim in every message must be true of the code on main that day. If a feature is not live, it is not mentioned.

## 2. Who we talk to, and what we say (one proof link each)
| Audience | The pitch | Proof |
|---|---|---|
| Memecoin traders & communities | Coins that burn on real-world results. Every burn has a receipt you can recompute. No team wallet, no creator cash, LP locked forever — its fees fund the burn. | a live receipt + the verifier |
| Sports communities (every league) | A coin for your team's season that burns every time they win — settled on the final score, ended with the season, nothing left behind. | Launch → Team coin, the window sentence |
| Prediction-market users | Any resolved outcome can have a coin that reacts on-chain, the payout read from the chain. Not odds, not a bet — a burn with a receipt. | Elections flow, El-Sayed/Rogers pair page |
| Fiscal / debt-clock audience | Every $1B the national debt rises, 2 % of $DEFICIT's pool buys and burns it. Treasury's own number. Receipts daily. | deficit.burnticker.com, the Treasury feed |
| Builders & bots | The only launchpad where the rule is enforced by a program, not a promise. Open source, API, SDK. | GitHub, /api/burnticker/v1/openapi.json |
| Sceptics, press, security | Here is the program, the reviews, the devnet receipts, the coverage table, the whitepaper, the bounty. Check it. | /burnticker/trust |

## 3. Channels (owned first; earned second; nothing bought)
- **X**: @BurnTicker (platform; two visible formats: receipts and scoreboards) and @USA_DEFICIT (one coin, one number, daily).
  Posts come from the generator → queue → owner approves and posts by hand. Nothing auto-posts.
- **Site**: burnticker.com (two doors: Launch / Seasons; the guardrail strip; trust page), deficit.burnticker.com, whitepaper.
- **GitHub**: public repo; README is the builder pitch; SECURITY.md is the bounty; reviews folder is the sceptic pitch.
- **Aggregators**: DexScreener (Enhanced Token Info paid on launch morning), Jupiter verification request, Solscan/Birdeye metadata
  (handled by the Arweave-pinned metadata, nothing to buy).
- **Earned**: Raydium (we are a LaunchLab platform — their ecosystem/partner channel), Jupiter ecosystem posts, Solana builder media
  and pods (Lightspeed, Blockworks, Solana Weekly, Superteam, Colosseum), open-source/security people (bounty), fiscal/debt accounts,
  team communities willing to launch the first season coins. Asks are specific and cost nothing (a listing, a mention, a launch).
- **Direct**: DMs/emails from the OUTREACH list; one message per target, drafted by the generator, sent by the owner.

## 4. Timeline (T = $DEFICIT launch, a weekday 08:00 Denver; $REHEARSAL on mainnet two to three days before)
**T-14 → T-8 — get the facts straight.** ChatGPT review published; every finding fixed or answered. Cold-read test of the site passes
(a stranger can say what it is, what a burn is, what is promised). Coverage table live. X email/avatar done. Operator contact address
set. Pitches and outreach list final. Post queue seeded with teasers that are TRUE now (devnet receipts, the rule, the reviews).
**T-7 → T-4 — the engine in public.** First X thread: "how a burn happens" with a real devnet receipt and the verifier. GitHub README
pitch. Raydium / Jupiter / builder-media outreach sent (ask: listing, mention, a look). Security/bounty outreach. Whitepaper shared with
the sceptic list. $REHEARSAL on mainnet; its receipts posted as the proof ("this is the real program, real chain, $0.10 coin").
**T-3 → T-1 — the show, framed.** Seasons page shows the leagues the gate passes; team-coin creation open to communities with a
hand-written invite to 5–10 of them (across leagues). Derby Season 1 bracket announced with its rules and start time. El-Sayed/Rogers
pair announced with its FEC dates and certification date. $DEFICIT pre-launch page live: the rule, the 2 %, the Treasury feed, the
launch time. Post queue for launch day written and approved the night before.
**T — launch morning (08:00 Denver).** $DEFICIT launch tx → receipts page live → DexScreener Enhanced Info paid → launch thread
(the rule, the sentence, the receipt format, "nothing happens until the debt rises") → first reading that evening → first receipt post.
Operator posts nothing about price, ever, and answers every "wen moon" with the rule.
**T+1 → T+7 — cadence.** Daily receipt posts (both accounts), daily scoreboard once Derby has days, first team coins celebrated as
creators launch them (never ours), Election pair goes live, a "week one receipts" thread with the verifier. Any incident is posted first
by us, with the transaction.

## 5. Content system (what gets written, by whom)
Fixed formats from the generator, lint-refused if they drift: `receipt` (one per burn), `scoreboard` (daily, all leagues), `season-card`
(a coin's window and rule), `explainer` (how a burn happens; what a receipt is; why LP is locked and its fees burn; why creators earn nothing),
`launch-thread`, `teaser`. Humans write only: outreach messages (from drafts) and replies. Visuals: receipt art generated per coin;
screenshots of real receipts; the bracket page.

## 6. What "working" means (none of these is price)
Creators launching coins we did not launch; receipts posted every day a rule fires; verifier runs from strangers (API hits on
`/v1/receipts/*/verify`); outreach replies that turn into a listing, a mention or a launch; zero copy-lint violations in anything we
post; zero claims we had to retract.

## 7. Owner-side checklist before T-7
ChatGPT report handed over · X email attached and avatar set · operator contact address (hello@burnticker.com suggested) · Phantom
address + third Squads signer + ~15 SOL · DexScreener $299 ready · decide licence split and trademark filing (optional) · decide whether
the GitHub repo moves to a `burnticker` org · Kalshi consent email: optional, nothing waits on it.

## 8. Not doing (and why, so nobody re-litigates it on launch week)
Paid KOLs/boosts/ads (policy; clones can't say it) · Kalshi mentions (terms) · "audited" (false) · a platform token (decided: not before
10 launches) · league-mode forwarding as a headline (reads as a prize; stays an opt-in for a later cycle) · AI-generated coin images
(IP and consistency) · auto-posting to X (approval queue only).

## 9. The 30-day scorecard (written before launch, so failure has a definition — the PHI lesson)
Read at T+30 (≈ 2026-11-25). Each line has the bar we set in advance; results are published on the trust page whatever they say.
| Measure | Bar at T+30 | Why this one |
|---|---|---|
| Coins launched by people who are not the operator | ≥ 10 (≥ 3 leagues or categories) | the platform exists only if others use it |
| Receipts posted per day (7-day mean) | ≥ 3 | the engine is running, not idling |
| Verifier runs by strangers (API + /check, unique anonymised sessions) | ≥ 100 | people check, not just look |
| Outreach replies turned into a listing, mention or launch | ≥ 3 | earned channels work without paying |
| Copy-lint violations in anything we posted | 0 | discipline held |
| Claims retracted | 0 | nothing said that wasn't true |
| Days the keeper missed a scheduled reading without a public incident note | 0 | status page is honest |
If the first line is under 5, say so publicly in the T+30 post and change course (product, outreach or both) rather than seeding activity.
