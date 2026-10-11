/**
 * THE LAUNCH FLOW'S HOVER HELP (2026-10-10, the owner: "every input in the launch flow gets a hover help"). One entry per input or
 * toggle group, two lines each: WHAT TO ENTER and WHAT IT DOES to the rule or the coin. Rendered by _components/FieldHelp.tsx (the "?"
 * after a label: hover, keyboard focus, tap on a phone; aria-describedby; Escape or an outside tap closes it). Every string passes the
 * copy lint (test/burntickerFieldHelp.test.ts) and every input in the wizard carries one (data-help="<id>").
 */
export interface Help { what: string; does: string }

export const FIELD_HELP = {
  // ---- finding the event
  search: { what: "Describe the event in a few words: a team, a candidate, a city and a threshold, a public number.", does: "Shows ready-made rules from every source that can settle it; one click opens the create screen with the rule filled in." },
  "market-search": { what: "A team, a person, a show, a city or an election, in plain words.", does: "Lists adjudicated markets that can settle a rule; nothing is chosen until you pick one." },
  "browse-filter": { what: "A word to narrow this category's sources.", does: "Filters the cards below; it changes no rule." },
  "league-search": { what: "Part of a league's name: MLB, Premier League, WNBA, college…", does: "Filters the league list; picking a league loads its teams." },
  "league-pick": { what: "The league your team plays in.", does: "Sets where the schedule comes from (the league's official feed, or TheSportsDB with its licensed key) and which teams you can pick." },
  "team-search": { what: "A team's name, city or abbreviation.", does: "Filters the team list; picking a team sets the coin's team, pinned by its id so a rename keeps working." },
  "team-pick": { what: "The team the coin follows.", does: "Every game of this team in the chosen window can burn; nothing else does." },
  "game-search": { what: "A team name, to find its next games.", does: "Filters the next games; picking one creates two coins on that game, one per team." },
  "pair-window": { what: "This game only, this season, or perpetual.", does: "This game: each coin burns once if its team loses it. Season or perpetual: each coin follows its own team's games." },
  "pair-name": { what: "A name for this side's coin, up to 32 characters.", does: "Shown on the card and the coin page; it can't claim an affiliation and can't change after launch." },
  "pair-ticker": { what: "2 to 10 letters or digits for this side.", does: "The coin's symbol on chain; it must differ from the other side and from every coin already registered." },
  "pair-image": { what: "Only on hosts that allow custom images: an https link to a square picture.", does: "Replaces the generated receipt art for this side; by default every coin uses the art made from its rule." },
  // ---- the rule
  side: { what: "Win, loss or draw for a team; YES or NO for a market.", does: "The outcome that burns. The other outcomes burn nothing." },
  yesno: { what: "YES (the thing happens) or NO (it does not).", does: "The settled answer that burns; a void or 50-50 resolution burns nothing." },
  "share-recurring": { what: "1 to 10 % (2 % suggested).", does: "Share of the burn pool spent on each event; the pool is fees, not supply; 2 % ≈ the Fed's inflation goal." },
  "share-oneshot": { what: "1 to 100 % (10 % suggested).", does: "Spent once when it resolves; the rest of the pool burns down over four weeks either way." },
  "share-binary": { what: "The share of the burn pool (or the vault tokens) each settlement spends.", does: "Fixed in the rule hash at launch; each settlement spends this much and burns the tokens it gets." },
  window: { what: "This season, this postseason only, the next N games, or perpetual.", does: "Which games count. A season, postseason or next-N coin retires and burns down over four weeks when the window ends; perpetual never retires." },
  "card-window": { what: "Pick the window right on the card.", does: "Swaps the rule the card opens with; the dials on the create screen can change it again before launch." },
  "next-games": { what: "How many games, 1 to 20, counted from today.", does: "The coin covers exactly that many of the team's games, then retires and burns down over four weeks." },
  "nws-station": { what: "The official weather station for the city.", does: "Readings come from that station's National Weather Service daily climate report, checked against the Iowa Environmental Mesonet." },
  "nws-threshold": { what: "The °F (or inches of rain) a day must reach.", does: "Every day at or above it counts once; a day below it burns nothing." },
  "league-mode": { what: "Opt in, or leave it off (the default).", does: "On: when the window ends, the leftover goes to the set's winning coin, once the forwarding instruction ships (it is not live yet). Off: the leftover burns down on this coin." },
  "league-forward": { what: "How much of the leftover to forward, 0 to 100 %.", does: "The rest burns down on this coin; nothing is forwarded until the program's forwarding instruction is live." },
  "race-type": { what: "Senate, House, Governor or party control.", does: "Narrows the open races; it sets no rule by itself." },
  "race-state": { what: "The state the race is in.", does: "Lists that state's races and their named candidates." },
  "race-outcome": { what: "Tick a candidate (tick two for the election-pair template).", does: "Binds the coin to that candidate's market; it settles once, on the on-chain payout, checked against the state's certified result." },
  // ---- advanced
  "kalshi-series-search": { what: "A series name or topic (discovery only).", does: "Kalshi is never a settlement input; this only helps you find an event to settle elsewhere." },
  "kalshi-market-paste": { what: "One market ticker, pasted.", does: "Discovery only; Kalshi data cannot settle a coin." },
  "kalshi-filter": { what: "Text the market tickers must contain (optional).", does: "Narrows which markets of the series count; the back-test lists what matched." },
  "poly-filter": { what: "A pattern the market questions must match (optional).", does: "Narrows which markets of the event or tag count; the back-test lists what matched." },
  "read-as": { what: "Yes/no, or a settled number.", does: "How the result is read: a yes/no burns on the chosen answer; a number burns once per unit it moves." },
  "burn-from": { what: "The fee pool (buyback) or a vesting vault.", does: "Buyback spends the coin's own fees on its own token and burns it; vault burns tokens set aside at launch." },
  "vault-share": { what: "10 to 30 % of supply.", does: "Locked in a vault at launch and burned by the rule over time; the rest trades on the curve." },
  "also-burn-other": { what: "Tick to burn on the other answer too.", does: "Both answers burn, each by its own share; a void still burns nothing." },
  "unit-size": { what: "The step one unit counts, in the source's own unit.", does: "Each full step moved burns once; smaller moves carry over or burn nothing." },
  baseline: { what: "The previous settlement, or a fixed number.", does: "Units are counted from it on each settlement." },
  direction: { what: "Up (above), down (below) or either way.", does: "Which moves count as units." },
  "per-unit": { what: "The share of the pool (or vault tokens) per unit.", does: "Spent once per unit, compounding across the units of one settlement." },
  // ---- the coin
  name: { what: "Up to 32 characters.", does: "Shown on the card and the coin page; checked by the copy lint (no claims of affiliation, no links, no promises) and fixed at launch." },
  ticker: { what: "2 to 10 letters or digits; season coins carry the year (RAYS26).", does: "The symbol on chain. It must be free: a taken ticker gets a number added (RAYS262)." },
  note: { what: "Up to 140 characters, optional; no links, no claims of affiliation.", does: "Shown in its own box marked as not part of the rule; it can't be edited after launch." },
  socials: { what: "https links to your website, X or Telegram (optional).", does: "Written into the coin's metadata extensions and shown on the coin page." },
  image: { what: "Nothing to enter: the image is generated from the rule.", does: "Receipt art with the ticker, the one-liner and team colours; it is pinned at launch and can't be swapped." },
  "own-image-toggle": { what: "Tick only if this host allows custom images.", does: "Uses your picture instead of the generated receipt art." },
  "own-image-link": { what: "An https link to a square picture.", does: "Pinned with the metadata at launch instead of the receipt art." },
  // ---- review and launch
  "review-sha": { what: "Nothing to enter: the hash of the exact rule.", does: "Anyone can recompute it from rules.json; a different rule is a different hash, so a different coin." },
  "review-settlement": { what: "Nothing to enter: who settles the rule and who confirms it.", does: "Each reading counts only when the named sources agree; receipts say which settled it." },
  "review-next": { what: "Nothing to enter: the earliest a burn can happen.", does: "A game's start, a market's end or the next report; nothing burns before it." },
  "review-end": { what: "Nothing to enter: when the coin's window ends.", does: "After it the coin burns down whatever is left over four weeks and retires; perpetual coins have no end." },
  "wallet-paste": { what: "Your wallet's public address, if no wallet is connected.", does: "Recorded as the creator; you sign the launch with that wallet. It earns nothing from fees." },
  "ack-locked": { what: "Tick to confirm.", does: "You accept that the rule, name, ticker and image can never change after launch." },
  "ack-no-returns": { what: "Tick to confirm.", does: "You confirm you are not promising anyone anything about the coin." },
  "first-buy": { what: "Optional SOL, up to 50, for your own first purchase.", does: "Swapped in the same transaction as the launch; zero skips it." },
  // ---- Coin vs Coin
  "derby-coin": { what: "A ticker, a name or a mint for each side.", does: "Locks the underlying the race reads (its Pyth feed or its mint); the two sides must differ." },
  "derby-window": { what: "Daily or weekly.", does: "Each window, the side that did better by the measure burns the other's coin's share." },
  "derby-season": { what: "How many days the season runs (weekly seasons in steps of 7).", does: "After the last window both coins burn down whatever is left over four weeks and retire." },
  "derby-share": { what: "1 to 10 % per winning window.", does: "The share of the losing coin's burn pool spent each time the other side wins a window." },
  "derby-measure": { what: "Tick for the one-shot flippening instead of daily or weekly windows.", does: "The rule resolves once, when one coin overtakes the other (the flippening, as the Burn Derby rules define it); then both wind down." },
  "derby-name": { what: "A name for this side, up to 32 characters.", does: "Shown on the card; checked by the copy lint and fixed at launch." },
  "derby-ticker": { what: "2 to 10 letters or digits for this side.", does: "The coin's symbol on chain; it must be free and differ from the other side." },
} as const satisfies Record<string, Help>;

export type HelpId = keyof typeof FIELD_HELP;
export const helpFor = (id: string): Help | null => (FIELD_HELP as Record<string, Help>)[id] ?? null;
