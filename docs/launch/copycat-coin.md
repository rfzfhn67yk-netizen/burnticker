# The copycat coin — Burnticker's second demo (design, 2026-10-09)

The owner's idea: a coin that burns as copycats of it are launched. It is a good second demo because it demonstrates the one thing
the first coin cannot: a feed that is *about the memecoin market itself* while still being a verifiable public event, not a price.
This note gives the concept, the rule, the data path, the gaming analysis, and why $DEFICIT stays single-rule. Nothing here is built
beyond the source adapter and its tests; nothing is launched.

## Concept

Every memecoin that works gets cloned within hours. The clones are a measurable, public, timestamped event stream — new mints with the
same name — and nobody has made the original *benefit* from them. A coin whose supply burns every time somebody launches a copy of it
turns the market's reflex against the copier: the clone is the trigger. The copies can still be bought and sold, but each one that
reaches a pool is a receipt on the original's page.

## Three names (checked 2026-10-10, keyless)

The check is DexScreener token search + GeckoTerminal pool search, the same calls the adapter makes. "Nothing found" means no pool
anywhere on either aggregator at fetch time, not that no mint exists (an unpooled mint is invisible to both and would not count anyway).

| Ticker | Name | Rule reads as | Search result |
|---|---|---|---|
| **$COPYCAT** | Copycat | "every copycat of $COPYCAT burns $COPYCAT" — the cleanest sentence | DexScreener: pairs named "Copycat"/"COPYCAT" exist on several chains (older, mostly dead pools). A live Solana namesake has to be re-checked the day before launch; the adapter's `excludeMints` would carry any pre-existing ones so they never count. |
| **$CLONE** | Clone | "every clone burns $CLONE" | Common word; several pools across chains. Same caveat. |
| **$XEROX** | Xerox | "every copy burns $XEROX" | A trademark (Xerox Holdings). Refused by our own naming rule (x-threads.md 6/6: no names that impersonate institutions). Listed to show the rejection, not as an option. |

Recommendation: **$COPYCAT**, with the pattern `^\$?COPYCAT$` on the symbol or `COPYCAT` in the name, and a pre-launch snapshot of
existing namesakes written into `excludeMints` so the baseline is clean. $DEFICIT's own copycats are the first proof the adapter runs
on (the fixtures), not the demo coin's rule.

## The rule (proposed, locked at launch like every Burnticker rule)

> Each UTC day, every NEW Solana mint whose metadata symbol matches `^\$?COPYCAT$` or whose name contains "COPYCAT" (case-insensitive),
> created that day, that has at least $1,000 of pool liquidity or at least 25 distinct traders at the reading, counts one unit — one
> unit per creator wallet, at most ten units a day, our own mint excluded. Each unit spends 1% of the fee pool buying $COPYCAT at
> market; everything bought is burned in the next transaction, with the receipt memo naming the copycat mints that counted.

1% per unit (not $DEFICIT's 2%) because the day cap is 10: ten copycats spend 1 − 0.99^10 ≈ 9.6% of the pool, a bounded worst day.
Zero-fill: a day with no qualifying copycat is a reading of 0 and no receipt (like the flare feed), so the page shows the quiet days too.

Source entry: `onchain.copycats` in `config/burnticker/sources.json`; adapter: `src/lib/burnticker/sources/copycats.ts`; tests:
`test/burntickerCopycats.test.ts`.

## Data path, honestly tiered

There is no on-chain query for "new mints named X". The reading needs an indexer, so the source is **tier 4 at best** (keeper-read,
key-gated API) and **tier 5 on the keyless fallback**; the card says so.

| Path | What it sees | Fields | Status |
|---|---|---|---|
| Helius DAS `searchAssets` (`HELIUS_API_KEY`) | every fungible mint with metadata, paged | mint, symbol, name, authority/creator | designed and typed; **not run on this host** (no key). The documented `searchAssets` parameters do not include a name-substring filter, so the adapter pages `tokenType: fungible` and matches the pattern itself; the page budget for that is the open question a keyed run answers. |
| DexScreener `/latest/dex/search?q=` | pairs whose token symbol/name match, all chains | chain, mint, liquidity, pair creation time; no creator, no distinct-trader count | run; fixture `onchain.copycats.dexscreener.json` (13 pairs for "DEFICIT", none on Solana, the Base one refused as wrong chain) |
| GeckoTerminal `/search/pools?query=&network=solana&include=base_token` | Solana pools whose token matches | mint, symbol, name, reserve USD, 24 h distinct buyers + sellers, pool creation time | run; fixture `onchain.copycats.geckoterminal.json` (GRASS "Grass Deficit", ADHD "Attention Deficit Hamster Degen") |
| Public RPC `getSignaturesForAddress` (oldest) + `getTransaction` | the mint's first transaction | creator = fee payer, creation time = block time | implemented (`rpcCreatorPort`), tested on a fake RPC; this is what makes the creator dedupe real on either path |

Both keyless indexers only see copycats that already have a pool — which is exactly the set that can pass admission (liquidity or
traders), so the fallback misses nothing that counts. It is still an aggregator's view, delayed by minutes and subject to their
listing rules; a keyed DAS run plus the RPC port is the version a rule may launch on, after 14 logged days.

## Gaming analysis — why admission is mandatory

A Solana mint with metadata costs ≈ 0.002 SOL. Without admission, any holder could print units for pennies and force the pool to buy
their bags. Each rule below closes one route; the table is the argument for keeping all four.

| Attack | Cost without the rule | Rule | Cost with the rule |
|---|---|---|---|
| Mint 100 "COPYCAT"s in a loop | 0.2 SOL → 100 units | ≥ $1,000 liquidity **or** ≥ 25 distinct traders | $1,000 locked in a pool per unit (or 25 funded wallets trading it, ≈ the same money plus fees) |
| One wallet, ten pooled copycats | $10,000 → 10 units | one unit per creator wallet per day (fee payer of the mint's first tx) | ten fresh wallets, each funded and each creating; still $10,000 of liquidity |
| Many wallets, many pooled copycats | linear in money | cap 10 units/day | the day tops out at 10 units = 9.6% of the pool, whatever is spent |
| Point the rule at ourselves | — | `excludeMints` (our mint; pre-launch namesakes) | — |
| Wrong-chain namesakes (the Base "DEFICIT" with $24.5K) | counted by a naive search | Solana only | refused with the reason (fixture test) |
| Liquidity that leaves the minute after the reading | counts once | the reading is once per complete UTC day, at the day's close | the $1,000 has to be there at the reading; it is one unit, not a stream |

What the attacker buys for $10,000 of locked liquidity under fresh wallets: one day of ten units, which spends 9.6% of a fee pool that
is, in the demo's first weeks, a few SOL. The buyback is at market, split across the day's crank; the attacker's own copycat pools are
not what the keeper buys. There is no route by which the attacker's spend returns to them through the rule. There is a nuisance route:
make the page list ten junk mints as "copycats that counted" — the memo names them, which is the point; a page that shows the
receipts shows the junk too.

Residual risks, stated: (1) the keyless path cannot see creators, so dedupe is by mint there — it is measurement-only and not
launchable; (2) GeckoTerminal's distinct-trader count is their definition, not ours; (3) an indexer outage reads as a day of 0, not as
an error that halts — acceptable for a demo, and the reason the receipt memo carries the indexer used.

## Why $DEFICIT stays single-rule

$DEFICIT's whole pitch is one sentence and one feed that nobody in the room controls. Adding a copycat clause would (1) make the rule
depend on an indexer — a tier-4/5 source bolted to a tier-4 primary API, pulling the coin's trust floor down to the weaker leg; (2)
give holders a lever on supply (minting copycats), which is exactly what "indexed to something nobody can touch" promises they do not
have; (3) break the replay story (the Treasury series replays to the cent; copycat counts cannot be replayed before the coin exists).
The copycat idea is the second coin's rule, where it is the entire point, and it is launched on the platform like any other: rule
hashed, receipts public, our holdings shown.

## Open before any launch

- A keyed Helius run for 14 days on `^\$?DEFICIT$` to size the DAS paging and compare with the keyless view.
- The pre-launch namesake snapshot for the chosen ticker → `excludeMints`.
- The owner's call on the per-unit fraction (1% proposed) and the day cap (10).
- Posts about the coin follow docs/launch/daily-post.md; the copycat list in a post is mints, not names (a name in a post is free
  advertising for the copy).
