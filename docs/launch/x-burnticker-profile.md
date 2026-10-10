# X profile kit — @BurnTicker (draft, re-cut 2026-10-10 night)

Nothing here is posted or created by automation. The owner creates the handle and pastes these in. Where a value is not decided
yet it is marked `TODO`. Every value in the profile fields, the pinned post and the two post formats passes the copy lint
(`config/launch/copy-lint.json`, including the `no-prizes` category); `test/burntickerCopy.test.ts` lints them from this file.

**Positioning (owner-approved 2026-10-10 night).** The receipt is the product; a season is a scoreboard of burns; nothing is ever
won — things are only burned. One sentence everywhere: **"Coins that burn on real-world results — with receipts."** Sub-line:
**"Launch one. Follow the season."**

## Profile fields

| Field | Value | Notes |
|---|---|---|
| Display name | **Burnticker** | one word, capital B; the wordmark on the avatar is all caps |
| Handle | **@BurnTicker** | X handles are case-insensitive; written with the capital T so the two words read. Fallbacks if taken: @burnticker_xyz, @burn_ticker, @burntickerhq |
| Bio (≤160 chars) | `Coins that burn on real-world results — with receipts. Launch one. Follow the season. Rules locked at launch. Nothing is won; coins only burn.` | 142 characters. The sentence, the sub-line, two guardrails. |
| Location | `on-chain (Solana)` | or leave blank |
| Website | `TODO — https://burnticker.com/` | set once the domain is bought |
| Birth date | leave blank | |
| Category (Professional) | Software company / Technology | avoids "Financial services" categorisation |
| Avatar | `site/burnticker/brand/avatar.png` (800×800) | the B1 thermal receipt with the burned amount scorched out |
| Header | `site/burnticker/brand/header.png` (1500×500) | TODO before upload: the committed header still carries the retired tagline "Burns on the news." and a KALSHI line in its tape; re-render it from `brand/render.mjs` with the sentence above and a tape without Kalshi |

Shorter bio if the guardrails do not fit a layout (85 characters):
`Coins that burn on real-world results — with receipts. Launch one. Follow the season.`

## Pinned post (draft)

> Coins that burn on real-world results — with receipts.
>
> Launch one: write the result in one sentence ("Rays lose", "Denver high above 90", "US debt rises $1B"), set the dial, lock the rule.
>
> Follow the season: team coins across MLB, NBA, NHL and NFL, scored in receipts.
>
> Settled on primary sources. Burned by a program, not a promise. Every burn is a receipt anyone can recompute. Nothing is ever won; things are only burned.
>
> Memecoins: the rule says what supply does, not what price does.
> {SITE_URL}

(≈ 470 characters; fits a Premium long post. For a 280-character account, pin the first post of the announcement thread in
docs/launch/x-threads.md §2 instead.)

## The two formats

@BurnTicker posts exactly two kinds of post, and they look different on the timeline:

- **Receipts** — plain and numeric, one per burn: receipt number, ticker, day, the reading, units → tokens burned, supply, the
  transaction and the coin's page. `receiptPostText()` in `src/lib/launch/dailyPost.ts`; template and a filled example in
  docs/launch/x-threads.md §2c.
- **Scoreboards** — the season as receipt counts: "Week 6 · 14 team coins across 4 leagues · 9 burned yesterday", then the team
  coins ranked by receipts with the champion marked. `scoreboardText()` in the same file; template and example in §2c.

## Voice rules for the account

- Report, do not promote. Every post about a burn states the reading, the units and the receipt. Nothing about price, ever.
- Nothing is ever won — things are only burned. No prize, pot, payout, jackpot, reward, stake, bet, wager or odds; nobody "wins
  money" or "gets paid", and holders never "earn". A champion is the coin with the most receipts: a stat on a scoreboard, never a
  recipient of anything.
- Never: "guaranteed", "moon", "100x", "early", "don't miss", "pump", "buy now", price targets, countdowns to a listing.
- Never a call to buy. "Trade" links appear on the pages, not in posts.
- Every league, no league first. Examples rotate across sports — Rays, Lakers, Oilers, Eagles — and a list of leagues never starts
  with the NFL. Only leagues the platform reads are named (MLB, NBA, NHL, NFL on the ESPN scoreboard today).
- Sources: primary sources by name. Polymarket appears only as the "on-chain payout" of an adjudicated market; prediction markets
  are for discovery. Kalshi is not named as a source anywhere (its terms do not allow it).
- Mechanics posts carry the disclaimer line where it fits: "a memecoin — the rule says what supply does, not what price does".
- Correct mistakes in public, in the same thread, with the receipt that shows the correction.
- Do not reply to or quote accounts that market returns using our pages; remove the embed, say so once.
