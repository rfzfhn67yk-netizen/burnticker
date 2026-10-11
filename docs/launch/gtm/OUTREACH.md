# Pre-launch outreach list (GTM pack, 2026-10-10)

Under [PLAN.md](PLAN.md) §3 (channels: owned first, earned second, nothing bought) and §1 (rules). Ranked by **fit × zero cost**.
Research by web search and page fetches on 2026-10-10; every row says **verified** (the page was fetched that day, URL given) or
**UNVERIFIED** (search snippet only, or the site blocked the fetch) — check those by hand before sending.

How to use it: the owner sends every message by hand, from the account named, one message per target; nothing here is sent by any
script. Every fenced `text draft` block is ≤ 600 characters and passes the copy lint (`test/gtmDocs.test.ts`). `{ALL_CAPS}` fields are
filled at send time. **Never offered to anyone, in any message:** money, tokens, allocations, a team buy, paid placement, "express" or
"fast pass" reviews, referral codes, or a mention in exchange for a mention. (Published policy `no-paid-promotion`; PLAN §1.)

The one paid item stays the plan's: DexScreener Enhanced Token Info for $DEFICIT on launch morning (listing hygiene, not promotion).

---

## Ranked list

| # | Target | Fit | Cost | Ask | When |
|---|---|---|---|---|---|
| 1 | Raydium — `#partnerships` | ★★★ | free | how a new LaunchLab platform gets listed (platforms-v2 / LaunchLab UI); a look at our PlatformConfig | T-7, once the mainnet PlatformConfig exists |
| 2 | Jupiter — Verify (standard queue) + @jup_vrfd | ★★★ | free | standard verification for $DEFICIT; link our org as a launchpad | T (submit), T-7 (DM) |
| 3 | Solscan — token update form | ★★★ | free | logo, socials, description for $DEFICIT | T |
| 4 | CoinGecko / GeckoTerminal — standard update | ★★☆ | free (UNVERIFIED) | token info for $DEFICIT; Birdeye reads CoinGecko | T to T+2 |
| 5 | Solana ecosystem directory | ★★★ | free | list Burnticker | T-7 |
| 6 | Helius — guest blog | ★★★ | free | a technical post: recomputable burn receipts on LaunchLab | T-7 |
| 7 | SolanaFloor — editorial | ★★☆ | free | a look at the open-source launchpad and its receipts | T-5 |
| 8 | Superteam Earn (+ Superteam USA) | ★★☆ | free to list; the bounty itself is the owner's 5–10 SOL | list the security bounty; tell Superteam USA | T-5, after SECURITY.md is final |
| 9 | Solana security people (security.txt, sec3 X-ray, Trident) | ★★☆ | free | read the program; the bounty terms | T-5 |
| 10 | Colosseum — Crypto World's Fair / Eternal | ★★☆ | free | submit the open-source program (World's Fair closes 2026-10-12) | now, or Eternal in November |
| 11 | Treasury Fiscal Data — data question only | ★☆☆ | free | confirm how revisions to Debt to the Penny are published | T-10 |
| 12 | Breakpoint 2026 (London) — side-event calendar / Hacker House | ★☆☆ | free to apply; travel is not | an application, only if the owner travels | optional |
| 13 | Team communities across leagues (subreddits, fan accounts) | ★★☆ | free | launch a season coin themselves | T-3, only where rules allow |
| 14 | Blockworks / Lightspeed | ★☆☆ | free | none now (no pitch route) | skip |

Skipped on purpose (paid, or wrong ask): DexScreener (paid except the plan's one item), Birdeye token form ($200 / $300 fast track,
UNVERIFIED), Jupiter Express and Jupiter metadata updates (1,000 JUP each, verified), every Fast Pass (GeckoTerminal $199, CoinGecko
$1,000), Solana Compass (requires staking 20 SOL, verified), SolanaFloor ads, Immunefi / Cantina / Sherlock (fees or sales calls),
Code4rena (shutting down, verified), Peter G. Peterson Foundation (@pgpfoundation), CRFB (@BudgetHawks), the Bipartisan Policy Center
and usdebtclock.org (nonpartisan or private: a memecoin ask is inappropriate), Validated and The Index podcasts (no pitch route; "not
trading tips"), any KOL, any boost, any trending-bar ad.

---

## 1. Raydium — the LaunchLab platform channel

- **Where:** Discord `discord.gg/raydium`, channel `#partnerships`; X **@Raydium**. Verified: https://docs.raydium.io/resources/brand-kit
  (Discord answers faster than social DMs) and https://docs.raydium.io/products/launchlab/platforms ,
  https://docs.raydium.io/products/launchlab/platform-config (2026-10-10). A platform is created by calling `create_platform`
  ourselves; the docs show no approval form and no public list. `GET /campaign/platforms-v2` exists in the API reference; whether a new
  platform appears there automatically is not documented (`api-v3.raydium.io/launchlab/platforms` returned 404). UNVERIFIED: a
  2025-04 Raydium X post says LaunchLab platforms "appear on the LaunchLab UI" (search snippet).
- **Why them:** Burnticker *is* a LaunchLab platform (its own PlatformConfig: 25 bps to the developer, 50 bps to each coin's burn
  pool, LP 100 % locked with Raydium's LP lock, its Fee Key owned by our burn program: 80 % of the LP fees to the coin's burn pool, 20 % to
  the operator, fixed in code). Every coin graduates to a Raydium CPMM pool.
- **Ask:** how a platform gets onto platforms-v2 / the LaunchLab UI, and a look at our PlatformConfig for anything wrong.
- **When:** after the mainnet PlatformConfig exists (T-7). Today only the devnet platform exists (`GvSKpe5p…`, devnet-run.md §4).
- **Do NOT offer:** fees, tokens, a revenue share, a co-marketing swap.
- **Policy note:** Burnticker has no Discord of its own (policy `no-telegram-discord`). The owner posting once in Raydium's server is
  outreach, not a Burnticker channel; if that reads wrong to the owner, use the X DM instead.

```text draft
Hi Raydium team. I run Burnticker, a LaunchLab platform: PlatformConfig {PLATFORM_ID} on mainnet. Each coin's creator-fee slot pays that coin's burn pool, 100%; the platform takes 25 bps; LP is 100% burned at graduation. A coin burns when a real-world result settles, with an on-chain receipt. Two questions: how does a platform get listed on platforms-v2 and the LaunchLab UI, and would someone look over our config? Code: https://github.com/rfzfhn67yk-netizen/burnticker — Burnticker (contact@burnticker.com)
```

## 2. Jupiter — Verify (standard) and the launchpad DM

- **Where:** https://verified.jup.ag/tokens/submit (anyone may submit; **standard review is free**, no timeline, ordered by wait time,
  volume and "Smart Likes"); **@jup_vrfd** on X for a launchpad's org link. Verified: https://docs.jup.ag/user-docs/launch/vrfd/token-verification ,
  https://verified.jup.ag/faq , https://developers.jup.ag/docs/tokens/verification (2026-10-10). Express (1,000 JUP, burned) and
  metadata updates (1,000 JUP) are paid — skip both. Criteria include organic activity, holders, ticker uniqueness and X support;
  verification can be removed if activity fades. UNVERIFIED: an ecosystem `#portfolio` channel in Jupiter's Discord.
- **Why them:** Raydium routes most swaps through Jupiter; the coin page's trade links go to Jupiter.
- **Ask:** standard verification for $DEFICIT after launch; the org link so later Burnticker coins are seen as one launchpad's.
- **Do NOT offer:** JUP, Express fees, tokens, likes campaigns ("Smart Likes" must be organic).

```text draft
Hi Jupiter Verify. Burnticker is a new Raydium LaunchLab platform (Solana): coins that burn on real-world results, with receipts. We would like our org linked as a launchpad so the standard queue can see our launches; we are not using Express. First coin: $DEFICIT, mint {DEFICIT_MINT}, which burns when Treasury's Debt to the Penny rises $1B. Open source: https://github.com/rfzfhn67yk-netizen/burnticker — Burnticker (contact@burnticker.com)
```

## 3. Solscan — token info update

- **Where:** https://solscan.io/token-update (use only this form). Verified: https://docs.solscan.io/integration/update-token-details
  (2026-10-10): free; only expedited processing costs money; needs an email on the project's own domain (contact@burnticker.com
  qualifies), live links, a neutral description, full social URLs; no edits after submitting. The form page itself returned 403 to the
  fetcher — open it in a browser.
- **Ask:** logo, X link, site, description for $DEFICIT. **Do NOT offer / pay for:** expedited processing.

```text draft
Project: $DEFICIT (Burnticker). Mint: {DEFICIT_MINT}. Website: https://deficit.burnticker.com — X: @USA_DEFICIT — contact: contact@burnticker.com. Description: A Solana memecoin whose supply burns when the U.S. national debt rises: every full $1B added to Treasury's Debt to the Penny is one unit, and each unit spends 2% of the coin's burn pool buying it on its own pool and burning it, with a receipt on chain. The rule says what supply does, not what price does.
```

## 4. CoinGecko / GeckoTerminal — standard update

- **Where:** CoinGecko's request form (support centre) and GeckoTerminal token info. Verified only the paid page:
  https://www.geckoterminal.com/update-token-info is the **Fast Pass, $199 — skip**. UNVERIFIED (support pages returned 403): the
  standard update is free; a CoinGecko listing is free but needs trading on a tracked venue; CoinGecko's Fast Pass is $1,000 — skip.
- **Why:** UNVERIFIED but reported: Birdeye pulls token info from CoinGecko, so this covers Birdeye without its $200 form.
- **Ask:** standard (free) token info for $DEFICIT after launch. Same description as §3.

## 5. Solana ecosystem directory

- **Where:** https://solana.com/ecosystem → "Submit Project" (log in with X). Verified: https://solana.com/news/new-solana-ecosystem-directory
  (2026-10-10): name, tagline, website, description, a 1:1 logo, at least 3 screenshots, up to 3 categories, live/dev status, an X
  account; review up to 3 business days. The `/ecosystem/submit-project` page renders as a directory hub — find the button live.
- **Ask:** a listing. **Status field:** "in development" until $DEFICIT is live on mainnet; then "live".

```text draft
Burnticker — coins that burn on real-world results, with receipts. A Raydium LaunchLab platform on Solana: each coin carries one locked rule (a settled result, a unit, a share of its fee pool), and the open-source burn_receipts program buys the coin on its own pool and burns everything bought, with a memo anyone can recompute. Creators earn nothing from fees; the LP is locked forever and its fees fund the burn (80% burned, 20% operator, fixed in code); the platform never buys any coin. Keyless API and open source: https://github.com/rfzfhn67yk-netizen/burnticker
```

## 6. Helius — guest blog

- **Where:** https://form.typeform.com/to/bXlO6voS from https://www.helius.dev/blog/guest-blog (verified 2026-10-10): unique, expert,
  deep, accurate articles; payment is not mentioned.
- **Why:** the strongest builder angle: an Anchor program that CPIs LaunchLab's creator-fee claim into a PDA, a TWAP-guarded
  swap-and-burn with a fixed memo, append-only readings, a Powers Register generated from the IDL. Educational, no coin pitch.
- **Ask:** a guest article, "Recomputable burn receipts on Raydium LaunchLab". **Do NOT offer:** payment, tokens, a placement swap.

```text draft
Pitch: "Recomputable burn receipts on Raydium LaunchLab." How an Anchor program makes a token's buyback-and-burn checkable by strangers: a fee PDA as LaunchLab's creator, the creator-fee claim by CPI, a TWAP-guarded swap that burns every token received in one instruction, a fixed memo (reading, units, spent, burned, rule hash), quorum-signed readings and a Powers Register generated from the IDL. All open source, with three published blind AI reviews. Author: the Burnticker operator, contact@burnticker.com
```

## 7. SolanaFloor — editorial

- **Where:** editorial **awais@solanafloor.com** (partnerships mia@, advertising robert@ — paid, skip). Verified:
  https://solanafloor.com/pages/contact (2026-10-10). SolanaFloor is owned by Jito since 2026-03 (reported) and runs the "Solana
  Weekly News" newsletter/podcast (solanafloor.substack.com; contents did not render). The old "Solana Weekly" domain solananews.org is
  parked — that channel is gone.
- **Ask:** a look; nothing else. **Do NOT offer:** an ad buy, an exclusive in exchange for coverage, tokens.

```text draft
Hi Awais. Burnticker is an open-source Raydium LaunchLab platform: coins that burn on real-world results, with receipts. A coin's own fees buy it back on its own pool and a program burns all of it when a settled result says so; the memo on that transaction is the receipt. First coin, $DEFICIT, burns when Treasury's Debt to the Penny rises $1B. Not audited by a security firm; three blind AI reviews are published in full. Trust page: https://burnticker.com/burnticker/trust — Burnticker (contact@burnticker.com)
```

## 8. Superteam Earn (+ Superteam USA) — the bounty

- **Where:** https://superteam.fun/earn/sponsor (verified 2026-10-10: free to post, "0% No commission"; the sponsor funds the bounty);
  Superteam USA https://superteam.fun/earn/s/superteamusa/ (verified, active; Miami-based). X @SuperteamUSA UNVERIFIED (search).
  Superteam Blog contact via https://blog.superteam.fun/about (activity not confirmed). The Areta audit-subsidy cohort found closed
  2026-03-07; none open.
- **Ask:** host the security bounty listing (the owner's decided 5–10 SOL from the developer fee) once SECURITY.md is final; tell
  Superteam USA it exists. **Prerequisite:** SECURITY.md out of draft (today: "PLACEHOLDER TERMS", status not published).
- **Do NOT offer:** anything beyond the published bounty terms; no tokens; no "listing fee".

```text draft
Hi Superteam USA. Burnticker is an open-source Solana launchpad (Raydium LaunchLab) whose Anchor program, burn_receipts, buys a coin on its own pool and burns everything bought when a settled result says so. It is not audited by a security firm; three blind AI reviews are published in full. The bug bounty terms are in SECURITY.md and listed on Superteam Earn: {EARN_URL}. Could you share it with Solana security people? Code: https://github.com/rfzfhn67yk-netizen/burnticker
```

## 9. Solana security people — read the program

- **Where / what:** `solana-security-txt` (Neodyme) — verified https://github.com/neodyme-labs/solana-security-txt (2026-10-10):
  the `security_txt!` macro (name, project_url, contacts, policy) lets researchers find the contact from the binary
  (`query-security-txt`, Solana Explorer). **Action for us, before mainnet deploy:** embed it in `burn_receipts` (a program change → the
  review queue). sec3 X-ray — verified https://github.com/sec3-product/x-ray (open source, AGPL-3.0): run it and publish the output
  with the reviews (it is in transparency.json's tooling list, "not run yet"). Trident (Ackee) — UNVERIFIED fetch; free fuzzer.
  OtterSec / Neodyme: no free public review route found — do not ask a firm for free work.
- **Ask (to individual researchers who post about Solana security):** read the program; the bounty terms are public.
- **Do NOT offer:** anything outside the bounty terms; never "an audit", never "exposure".

```text draft
Hi {NAME}. Burnticker's Anchor program (burn_receipts) is open source and not audited by a security firm. It holds each coin's fee pool in a PDA with no withdraw instruction; the only way out is a TWAP-guarded swap that burns every token received. Three blind AI reviews are published with every finding and fix; the bounty terms are in SECURITY.md (security@burnticker.com). If you have an hour, the Powers Register is the place to start: https://github.com/rfzfhn67yk-netizen/burnticker
```

## 10. Colosseum — World's Fair now, Eternal in November

- **Where:** https://colosseum.com/worldsfair (verified 2026-10-10): Crypto World's Fair hackathon, 2026-09-14/15 → **2026-10-12**
  (two days from this writing), Solana track, free to enter; whether an existing project may enter is in the linked rules PDF — read it.
  https://colosseum.com/eternal (verified): new sprints closed; the next window opens in November. Accelerator entry is via a hackathon
  or Eternal win only.
- **Ask:** a submission of the open-source program and launchpad. **Owner call:** a hackathon carries cash awards; entering is a
  business decision, not promotion, and nothing in our copy may present it as a prize we won or offer.
- **Do NOT offer:** tokens or allocations to judges or the program.

## 11. Treasury Fiscal Data — data question only

- **Where:** fiscaldata@fiscal.treasury.gov; X **@FiscalService** (verified on https://fiscal.treasury.gov/ , 2026-10-10). Verified
  https://fiscaldata.treasury.gov/api-documentation/ : data "offered free, without restriction… for non-commercial or commercial
  purposes", no key, no attribution clause, no rule on the Treasury name or seal stated.
- **Ask:** a data question only (how and when revised Debt to the Penny figures appear). Never mention the coin; never imply
  endorsement; never tag them in a coin post.

```text draft
Hello. I read Debt to the Penny (tot_pub_debt_out_amt) through the Fiscal Data API each business day. When a published figure for a past record date is revised, does the API replace that row in place, and is there a field or notice that marks the revision? Thank you. — Burnticker (contact@burnticker.com)
```

## 12. Breakpoint 2026 (London, Nov 15–17) — optional

- Verified https://solana.com/breakpoint and https://solana.com/news/breakpoint-guide-part1 (2026-10-10): tickets are paid ($250
  developer); speaker / press / creator applications exist with no deadlines shown; **free:** Solana Hacker House London, Nov 1–12,
  approval required (https://luma.com/london-hh-26), and the community side-event calendar (https://luma.com/BP-SideEvents, admin
  approval). "Founder x VC Demo Day" costs $149 — skip. Zero-cost only if the owner is in London anyway.

## 13. Team communities across leagues — season coins launched by fans

- **Status: UNVERIFIED.** reddit blocked every fetch and search on 2026-10-10, so the rules of r/tampabayrays, r/lakers,
  r/EdmontonOilers, r/eagles (and r/Gunners, r/InterMiami — soccer is not readable by the platform today) were not checked. Most large
  team subreddits ban self-promotion, gambling and crypto posts; expect to skip each unless a moderator gives a written OK. No
  crypto-friendly fan community could be verified.
- **Order:** rotate MLB → NBA → NHL → NFL (Rays, Lakers, Oilers, Eagles); never lead with the NFL. Soccer clubs (Arsenal, Inter Miami)
  only once the platform reads those leagues.
- **Ask (to a moderator, never a post):** may we tell the community that a fan can launch a team coin, with these rules? We never
  launch a team coin ourselves (PLAN §4 T+1: "never ours").
- **Do NOT offer:** anything to a moderator or a community; never a team buy; never a coin "for" the team. **Risk:** team names in
  coin names carry trademark risk; the refuse list blocks names that impersonate institutions — a fan coin says "Rays losses", never
  "official".

```text draft
Hi mods. Before posting anything I wanted to ask. I run Burnticker, an open-source Solana launchpad where a fan can launch a coin that burns on each {TEAM} loss (or win), read from the final score and checked against MLB StatsAPI. Nothing is won; the creator earns nothing; it is a memecoin, and nobody here promises anything about it. Is a post explaining it allowed here? If not, no problem, thanks for reading. — Burnticker (contact@burnticker.com)
```

## 14. Blockworks / Lightspeed — skip for now

- Verified https://blockworks.com/tips (2026-10-10): "do not use this form to submit pitches, press releases"; pitches go to
  https://blockworks.com/contact. Lightspeed podcast: verified https://solana.com/podcasts/lightspeed — latest episode listed 2026-07-07,
  host @defi_kay_, show @Lightspeedpodhq, no guest form; the Lightspeed newsletter (beehiiv) returned 404 and its writer left
  (search). No zero-cost route with a real chance; revisit after week-one receipts exist.

---

## Risks found while researching (for the owner, not for any message)

1. **ESPN's terms.** Verified https://disneytermsofuse.com/english/ (2026-10-10; covers ESPN by name): no automated extraction "by
   robot, spider, script", no commercial use. Team coins read the ESPN scoreboard as their primary source (cross-read by MLB StatsAPI,
   the NHL feed, TheSportsDB). `docs/burnticker/README.md` §6 already says ESPN "stays not launchable until its terms are checked";
   the coverage audit and the wizard treat it as live. This is the largest open question behind every sports pitch and the Seasons door.
2. **The unnamed venue in published files.** The plan of record and the decision log name the event-contract venue whose terms ask for
   written approval before public mention; `docs/launch` (including this folder and PLAN.md) and `docs/burnticker` are on the
   public-repo allowlist, so they publish. Owner call: keep (transparency) or scrub/exclude.
3. **This folder publishes.** `docs/launch/gtm/` (outreach targets, named editorial addresses, the plan) is inside `docs/launch` on
   `config/public-repo.allowlist`. Owner call: publish it as part of "nothing hidden", or exclude `docs/launch/gtm` before the next
   public sync.
4. **Paid listing creep.** Every aggregator now sells a faster path (Birdeye $200/$300, Jupiter 1,000 JUP, GeckoTerminal $199,
   CoinGecko $1,000). The plan allows exactly one ($299 DexScreener). Anything else is a policy change.
