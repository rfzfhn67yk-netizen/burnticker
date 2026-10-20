/**
 * THE LAUNCH FLOW'S HOVER HELP (2026-10-10, the owner: "every input in the launch flow gets a hover help"). One entry per input or
 * toggle group, two lines each: WHAT TO ENTER and WHAT IT DOES to the rule or the coin. Rendered by _components/FieldHelp.tsx (the "?"
 * after a label: hover, keyboard focus, tap on a phone; aria-describedby; Escape or an outside tap closes it). Every string passes the
 * copy lint (test/burntickerFieldHelp.test.ts) and every input in the wizard carries one (data-help="<id>").
 */
export interface Help { what: string; does: string }

export const FIELD_HELP = {
  // ---- finding the event
  search: { what: "A few words about the event: a team, a candidate, a city and a threshold, or a public number.", does: "It shows ready-made rules from every source that can settle the event. One click opens the create screen with the rule filled in." },
  "outcome-search": { what: "Part of a name in this market's list, such as a film, a person or a team.", does: "It filters the list. Picking a name opens the create screen for that name's own yes-or-no market." },
  "market-search": { what: "A team, a person, a show, a city or an election, in plain words.", does: "It lists settled markets that can settle a rule. Nothing is chosen until you pick one." },
  "browse-filter": { what: "A word to narrow this category's sources.", does: "It filters the cards below. It does not change any rule." },
  "outcome-filter": { what: "A name or a word to narrow this event's outcomes.", does: "It filters the list of outcomes below. It does not change any rule." },
  "league-search": { what: "Part of a league's name, such as MLB, Premier League, WNBA or college.", does: "It filters the league list. Picking a league loads its teams." },
  "league-pick": { what: "The league your team plays in.", does: "It sets where the schedule comes from and which teams you can pick. The schedule comes from the league's official feed, or from TheSportsDB with its licensed key." },
  "team-search": { what: "A team's name, city or short name.", does: "It filters the team list. Picking a team sets the coin's team. The team is pinned by its id, so a rename keeps working." },
  "team-pick": { what: "The team the coin follows.", does: "Every game this team plays in the chosen window can burn. Nothing else does." },
  "game-search": { what: "A team name, to find its next games.", does: "It filters the next games. Picking one creates two coins on that game, one for each team." },
  "pair-window": { what: "This game only, this season, or with no end.", does: "For this game only, each coin burns once if its team loses. For a season or with no end, each coin follows its own team's games." },
  "pair-name": { what: "A name for this side's coin, up to 32 characters.", does: "It is shown on the card and the coin page. It can't claim an affiliation, and it can't change after launch." },
  "pair-ticker": { what: "2 to 10 letters or digits for this side.", does: "This is the coin's symbol on chain. It must differ from the other side and from every coin already registered." },
  "pair-burn": { what: "There is nothing to set. Every rivalry pair works this way, and both rules fix it.", does: "At each result, the coin whose rule fires burns with fees from both coins. The other coin's fuel for that result moves to its burn pool. Nothing is paid to holders, and a draw or a void moves nothing." },
  "pair-image": { what: "Only on sites that allow custom images: an https link to a square picture.", does: "It replaces the generated receipt art for this side. By default every coin uses the art made from its rule." },
  // ---- the rule
  side: { what: "Win, loss or draw for a team. YES or NO for a market.", does: "This is the outcome that burns. The other outcomes burn nothing." },
  yesno: { what: "YES if the thing happens, or NO if it does not.", does: "This is the settled answer that burns. A void or a 50-50 result burns nothing." },
  "share-recurring": { what: "1 to 25 percent. 2 percent is suggested.", does: "This share of the burn pool is spent on each event. The pool is fees, not supply. 2 percent is close to the Fed's inflation goal." },
  "share-oneshot": { what: "50 or 100 percent on this site; the API takes 1 to 100 percent.", does: "It is spent once, when the event resolves. The rest of the pool then goes to $DEFICIT's burn, or burns down on this coin over four weeks if the result is voided." },
  "share-binary": { what: "The share of the burn pool, or of the vault tokens, that each settlement spends.", does: "It is fixed in the rule hash at launch. Each settlement spends this much and burns the tokens it gets." },
  window: { what: "This season, this postseason only, the next few games, or with no end.", does: "It sets which games count. When a season, postseason or next-games window ends, the rest of the pool goes to $DEFICIT's burn and the coin retires. A rule without an end date keeps running." },
  "card-window": { what: "Pick the window right on the card.", does: "It changes the rule the card opens with. You can change it again with the dials on the create screen before launch." },
  "next-games": { what: "How many games, from 1 to 20, counted from today.", does: "The coin covers exactly that many of the team's games. Then the rest of the pool goes to $DEFICIT's burn and the coin retires." },
  "nws-station": { what: "The official weather station for the city.", does: "Readings come from that station's daily climate report from the National Weather Service, checked against the Iowa Environmental Mesonet." },
  "nws-threshold": { what: "The temperature in °F, or the inches of rain, that a day must reach.", does: "Every day at or above it counts once. A day below it burns nothing." },
  "team-results": { what: "Which results of a match burn: a win, a draw or a loss, or any two of them.", does: "Each match whose result is one you picked counts once. A match with any other result burns nothing." },
  // HB-75 (hourly run 5): the area pickers (tornado and quake "Where", the storm basin) say what an area does, not a threshold
  "hazard-area": { what: "The area whose readings count: the whole United States or one state for tornado reports, a region of the world for earthquakes, or an ocean basin for storms.", does: "Only readings from inside that area are counted. Readings from anywhere else burn nothing." },
  "hazard-threshold": { what: "The level a reading has to reach, such as a magnitude, a storm category, a count of reports, a fire size or a volcano.", does: "Only the values the publisher's reading can be checked against are offered. The rule counts readings at or above it." },
  "league-mode": { what: "Opt in, or leave it off. Off is the default.", does: "When it is on, the leftover is meant to go to the set's winning coin when the window ends. The forwarding instruction is not live yet, so nothing is forwarded today. When it is off, the leftover burns down on this coin." },
  "league-forward": { what: "How much of the leftover to forward, from 0 to 100 percent.", does: "The rest burns down on this coin. Nothing is forwarded until the program's forwarding instruction is live." },
  "race-type": { what: "Senate, House, Governor or party control.", does: "It narrows the open races. It does not set a rule by itself." },
  "race-state": { what: "The state the race is in.", does: "It lists that state's races and their named candidates." },
  "race-outcome": { what: "Tick a candidate. Tick two for the election-pair template.", does: "It binds the coin to that candidate's market. The coin settles once, on the on-chain payout, checked against the state's certified result." },
  // ---- advanced
  "kalshi-series-search": { what: "A series name or topic, to help you find an event.", does: "Kalshi never settles anything here. This only helps you find an event to settle with another source." },
  "kalshi-market-paste": { what: "One market ticker, pasted in.", does: "This is for finding events only. Kalshi data cannot settle a coin." },
  "kalshi-filter": { what: "Text that the market tickers must contain. This is optional.", does: "It narrows which markets of the series count. The back-test lists what matched." },
  "poly-filter": { what: "Words that every counted market's question must contain, in plain text. This is optional.", does: "It narrows which markets of the event or tag count toward the rule. The back-test below lists exactly which past markets matched, so check it before launch." },
  "read-as": { what: "A yes-or-no answer, or a settled number.", does: "It sets how the result is read. A yes-or-no rule burns on the chosen answer. A number burns once for each unit it moves." },
  "burn-from": { what: "The fee pool, which funds a buyback, or a vesting vault.", does: "A buyback spends the coin's own fees on its own token and burns it. A vault burns tokens set aside at launch." },
  "vault-share": { what: "10 to 30 percent of supply.", does: "It is locked in a vault at launch, and the rule burns it over time. The rest trades on the curve." },
  "also-burn-other": { what: "Tick this to burn on the other answer too.", does: "Both answers burn, each by its own share. A void still burns nothing." },
  "unit-size": { what: "The size of one unit, in the source's own measure.", does: "Each full step burns once. Smaller moves carry over or burn nothing." },
  baseline: { what: "The previous settlement, or a fixed number.", does: "Units are counted from it at each settlement." },
  direction: { what: "Up, down, or either way.", does: "It sets which moves count as units." },
  "per-unit": { what: "The share of the pool, or of the vault tokens, for each unit.", does: "It is spent once for each unit, compounding across the units of one settlement." },
  // ---- the coin
  name: { what: "Up to 32 characters.", does: "It is shown on the card and the coin page. The copy check refuses claims of affiliation, links and promises, and the name is fixed at launch." },
  ticker: { what: "2 to 10 letters or digits. Season coins carry the year, as in RAYS26.", does: "This is the symbol on chain, and it must be free. If a ticker is taken, a number is added, as in RAYS262." },
  note: { what: "Up to 140 characters, and optional. No links and no claims of affiliation.", does: "It is shown in its own box, marked as not part of the rule. It can't be edited after launch." },
  socials: { what: "Links (https) to your website, X or Telegram. This is optional.", does: "They are written into the coin's metadata and shown on the coin page." },
  image: { what: "You can upload your own image, or keep the art made from the rule.", does: "Without an upload, it is receipt art with the ticker, the one-line rule and the team colors. Either one is pinned at launch and can't be swapped." },
  "own-image-toggle": { what: "Tick this only if this site allows custom images.", does: "It uses your picture instead of the generated receipt art." },
  "own-image-link": { what: "An https link to a square picture.", does: "It is pinned with the metadata at launch, in place of the receipt art." },
  // ---- review and launch
  "review-sha": { what: "There is nothing to enter. This is the hash of the exact rule.", does: "Anyone can work it out again from rules.json. A different rule gives a different hash, and so a different coin." },
  "review-settlement": { what: "There is nothing to enter. This shows who settles the rule and who confirms it.", does: "Each reading counts only when the named sources agree. Receipts say which source settled it." },
  "review-next": { what: "There is nothing to enter. This is the earliest time a burn can happen.", does: "It is a game's start, a market's end or the next report. Nothing burns before it." },
  "review-end": { what: "There is nothing to enter. This is when the coin's window ends.", does: "After it, the rest of the pool goes to $DEFICIT's burn and the coin retires. If the result is voided, the rest burns down on this coin over four weeks instead. Coins with no end never retire." },
  "wallet-paste": { what: "Your wallet's public address, if no wallet is connected.", does: "It is recorded as the creator, and you sign the launch with that wallet. It earns nothing from fees." },
  "ack-locked": { what: "Tick this to confirm.", does: "You accept that the rule, name, ticker and image can never change after launch." },
  "ack-no-returns": { what: "Tick this to confirm.", does: "You confirm you are not promising anyone anything about the coin." },
  "first-buy": { what: "Optional SOL, up to 50, for your own first purchase.", does: "It is swapped in the same transaction as the launch. Zero skips it." },
  // ---- Coin vs Coin
  "derby-coin": { what: "A ticker, a name or a mint address for each side.", does: "It locks what the race reads, either its Pyth feed or its mint. The two sides must differ." },
  "derby-window": { what: "Daily. Weekly comparisons are available through the API only.", does: "In each window, the side that did better by the measure burns the other coin's share." },
  "derby-season": { what: "How many days the season runs. Weekly seasons go in steps of 7.", does: "After the last window, both coins burn down whatever is left over four weeks and retire." },
  "derby-share": { what: "1 to 10 percent for each winning window.", does: "This share of the losing coin's burn pool is spent each time the other side wins a window." },
  "derby-measure": { what: "Tick this for the one-shot flippening instead of daily or weekly windows.", does: "The rule resolves once, when one coin overtakes the other, as the Burn Derby rules define the flippening. Then both coins wind down." },
  "derby-name": { what: "A name for this side, up to 32 characters.", does: "It is shown on the card. The copy check reads it, and it is fixed at launch." },
  "derby-ticker": { what: "2 to 10 letters or digits for this side.", does: "This is the coin's symbol on chain. It must be free and differ from the other side." },
} as const satisfies Record<string, Help>;

export type HelpId = keyof typeof FIELD_HELP;
export const helpFor = (id: string): Help | null => (FIELD_HELP as Record<string, Help>)[id] ?? null;
