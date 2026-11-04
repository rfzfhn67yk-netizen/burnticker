# Snipers on LaunchLab — what they key on, what we can do, what we cannot (2026-10-09)

The owner asked whether avoiding keywords in our announcements helps against snipers. Short answer: barely. Snipers find targets
from the chain, not from our tweets; keywords matter mainly for a smaller class of name-based copy-traders and for copycats. This page
is the factual version. "Sniper" here means an automated buyer that enters a new pool within the first seconds to minutes.

## How targets are acquired, in order of volume

1. **New-pool events.** The bulk of sniper flow subscribes to the chain itself — a Geyser / Yellowstone gRPC stream or `logsSubscribe`
   on the launch program — and reacts to the pool-creation instruction. For Raydium LaunchLab that is the `initialize` of a new curve
   on the LaunchLab program; the same bots watch pump.fun's `create`, Meteora's pool creation and Raydium's CPMM/AMM. They see the
   mint, the creator, the quote, the curve parameters and the metadata URI in the same slot the pool exists. A name is a string they
   read after they already have the event.
2. **Filters on the event.** Common ones: platform id / curve config, creator wallet history (prior rugs, prior winners), initial buy
   size and bundling in the create transaction, whether the metadata URI resolves and has socials, mint/freeze authority, supply
   share held by the top wallets a few blocks in, early buyer count and volume (the "momentum" snipers enter at second 30–120, not
   second 0). Keywords appear here as a positive or negative filter on the metadata name — "contains the day's trending word" or
   "looks like a known rug name".
3. **Social triggers.** A second class watches X / Telegram for a posted contract address and buys when a tracked account posts one
   ("auto-snipe on tweet" in the retail terminals). They key on the **address**, not on words; the keyword variant ("buy whatever is
   named like the trending topic") exists but is a minority of flow and is mostly copy-trading of narratives, not of launches.
4. **Copy-trading of wallets.** Bots that mirror a tracked wallet's buys. Unrelated to names; relevant to us only in that our keeper
   wallet is public and its buybacks are scheduled by the rule, so a copier can front-run a known burn day (they are buying what
   the pool is about to buy; that is a cost to the pool measured in slippage, not a risk to holders).

What follows from this: a sniper that wants our launch gets it from the event in §1 whatever we call the coin or how we announce it.
Keyword hygiene does not change their targeting. It does change two smaller things — name-based narrative bots (§2/§3) and copycats,
both of which key on the *word* — and it changes what can be front-run (§3: a posted address).

## What we do (and why sniping costs us nothing)

- **No exact-minute pre-announcement.** The threads say "launching on @burnticker" and the rule; the create time is not posted ahead.
  A pre-announced minute is a free alarm clock for §1 and §3 alike. The pinned launch post goes out *after* the create lands.
- **Mint posted a few minutes after create.** The address appears on the site and the thread once the pool exists and the first
  readings are on the page. Nothing to front-run from our side: by the time we post, the event-driven snipers have already seen it on
  chain, and the social-trigger class is late to them anyway.
- **No pre-sale, no allowlist, no team bag.** There is nothing for a sniper to get ahead of except other buyers. The project holds no
  allocation whose value a sniper could capture or dump against (the trust page shows our holdings: 0 at launch), the creator-fee
  slot pays the burn pool 100%, and the rule is indexed to Treasury's figure, which no buyer's timing moves. A sniper buying at second
  one and selling at minute ten is a trade between buyers; the pool collects its fee on both legs and the burn rule is untouched.
- **Fees are the only thing sniping changes for us — upward.** Every sniper round-trip pays the curve's fees: the creator slot (50 bps)
  into the token's burn pool and the platform slot (25 bps) to the developer (docs/burnkeeper/fees.md). We neither invite it nor fight
  it; the receipts page shows what the burn pool received and the weekly post reports both figures separately.
- **Copycats are handled as events, not as a threat** (docs/launch/copycat-coin.md): a copy of $DEFICIT is a copy; the second demo
  coin turns copies into receipts.
- **No "anti-bot" claims in copy.** We do not promise fair launches, sniper protection or first-block caps we do not control; the copy
  lint refuses the promise words anyway.

## What we cannot do

- **Prevent first-block buys.** On a public curve anyone can send a buy in the slot the pool exists. LaunchLab exposes no per-wallet
  cap or allowlist at the curve level that we have confirmed from primary documentation as of 2026-10-09 (`to confirm before launch`:
  the platform config's `curve_param`, `vesting_param` and `migrate_type` are the knobs we know; none gates buyers). If the owner wants
  a buyer gate, that is a different venue, and it brings its own trust questions (who holds the allowlist).
- **Hide the metadata.** The name and symbol are on chain in the create transaction; a "stealth" name followed by a rename is not
  available on a fixed mint without a metadata authority, which we do not keep (the trust page says the metadata is immutable).
- **Stop name-based bots from reading the name.** Avoiding the word in *our* posts does nothing to the string in the metadata; the
  only way to be invisible to a keyword bot is a name that matches nothing, which is a name nobody searches for either.
- **Control where the first buyers come from.** Whether the first ten wallets are humans from the thread or bots from a gRPC stream
  is not ours to decide and not something we report on; the receipts page reports supply and burns.

## Does avoiding keywords help? — the answer for the owner

| Audience | Keys on | Keyword avoidance in our posts |
|---|---|---|
| event snipers (most of the flow) | the pool-creation instruction | no effect |
| filter snipers | creator, bundle, socials, early volume; the metadata name as one filter | no effect on our posts; the on-chain name is what they read |
| social-trigger bots | a posted contract address | **posting the address after create** is what matters, not the words |
| narrative / keyword bots | trending words in the name | small effect; they read the metadata, not the tweet |
| copycats | the word, anywhere | none — copies follow attention, and attention is the goal |

So: post the mint after it exists, never pre-announce the minute, keep no bag, and let the rest be what a public curve is. The copy
rule already forbids the one thing that would make sniping *our* problem — telling anyone to buy at a particular moment.
