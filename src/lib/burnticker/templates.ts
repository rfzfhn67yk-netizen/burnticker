/**
 * THE TWELVE CANONICAL RULE SHAPES (2026-10-10, "launch one like this"): the /burnticker/templates gallery, and where "Start from this"
 * lands in the launch flow. Each shape has an example sentence (lint-clean; test/burntickerProduct.test.ts), what settles it, and the
 * launch link. The coin and pair pages' "Launch one like this" uses `likeHref` instead: same shape, the team / race / feed re-pickable,
 * the dials copied. Client-safe.
 */
export type TemplateId = "team-season" | "team-oneshot" | "matchup" | "election-oneshot" | "election-pair" | "number-feed" | "weather" | "launch-count" | "polymarket-oneshot" | "coin-vs-coin" | "bracket" | "flippening";
export interface Template { id: TemplateId; title: string; example: string; settles: string; shape: "recurring" | "one-shot" | "pair"; href: string }

export const TEMPLATES: Template[] = [
  { id: "team-season", title: "Team, this season", shape: "recurring", example: "$RAYS26 burns 2% of its pool every time the Rays win a game this season, then retires.", settles: "each game on its on-chain payout where a market exists, else a licensed final score, confirmed by the league's official feed", href: "/burnticker/launch?template=team-season" },
  { id: "team-oneshot", title: "Team wins the title", shape: "one-shot", example: "$RAYSWS burns 10% once if the Rays win the World Series.", settles: "Polymarket's on-chain payout for the championship market, checked against the league's official results", href: "/burnticker/launch?template=team-oneshot" },
  { id: "matchup", title: "Matchup: two coins, one game", shape: "pair", example: "$LAKERS and $CELTICS: the coin of the team that loses tonight burns.", settles: "the game's on-chain payout or a licensed final score, confirmed by a second independent source", href: "/burnticker/launch?template=matchup" },
  { id: "election-oneshot", title: "A candidate wins a race", shape: "one-shot", example: "$ELSAYED burns 10% once if Abdul El-Sayed wins the Michigan Senate race.", settles: "Polymarket's on-chain payout, checked against the state's certified result", href: "/burnticker/launch?template=election-oneshot" },
  { id: "election-pair", title: "Election pair: candidate A vs B", shape: "pair", example: "$ELSAYED and $ROGERS: the coin of the candidate who loses the race burns, with fees from both coins.", settles: "each side's market on its on-chain payout; both or neither", href: "/burnticker/launch?template=election-pair" },
  { id: "number-feed", title: "A public number (debt, CPI)", shape: "recurring", example: "$DEBT burns 2% of its pool for every $1B the U.S. debt rises.", settles: "the publisher's own feed (Treasury, BLS, FRED), confirmed by a second publisher of the same figure", href: "/burnticker/launch?template=number-feed" },
  { id: "weather", title: "Weather threshold", shape: "recurring", example: "$DTWHOT burns 1% every day Detroit's official high reaches 90 °F.", settles: "the National Weather Service's daily climate report, checked against the Iowa Environmental Mesonet", href: "/burnticker/launch?template=weather" },
  { id: "launch-count", title: "Rocket launches", shape: "recurring", example: "$LAUNCH burns 2% of its pool for every orbital launch that reaches orbit.", settles: "Launch Library 2's records (shown on Polymarket where a market exists)", href: "/burnticker/launch?template=launch-count" },
  { id: "polymarket-oneshot", title: "Any adjudicated market", shape: "one-shot", example: "$OSCAR burns 10% once if the film named in the market wins Best Picture.", settles: "Polymarket's on-chain payout for that market", href: "/burnticker/launch?template=polymarket-oneshot" },
  { id: "coin-vs-coin", title: "Coin vs Coin", shape: "pair", example: "$TEAMWIF and $TEAMSHIB: each day, the side whose coin did worse burns, with fees from both coins.", settles: "Pyth's published feeds, checked against a second feed (RedStone) or the pool TWAP", href: "/burnticker/launch?template=coin-vs-coin" },
  { id: "bracket", title: "Bracket (a Coin vs Coin season)", shape: "pair", example: "Eight coins in a bracket: each round, the losing side of every match burns.", settles: "the same Coin vs Coin readings, round by round; the operator registers the bracket", href: "/burnticker/launch?template=bracket" },
  { id: "flippening", title: "The flippening (one-shot)", shape: "one-shot", example: "$FLIPWIF burns 10% once on the day WIF overtakes SHIB.", settles: "Pyth's feeds and both coins' supplies, read once at the crossing", href: "/burnticker/launch?template=flippening" },
];

/** Where a template lands in the wizard: a flow, a search query, a Browse category, or the Coin vs Coin tile. */
export const TEMPLATE_START: Record<TemplateId, { flow?: "team" | "pair" | "single"; search?: string; browse?: string; derby?: "pair" | "bracket" | "flip" }> = {
  "team-season": { flow: "team" },
  "team-oneshot": { search: "Rays win the World Series" },
  matchup: { flow: "pair" },
  "election-oneshot": { browse: "politics" },
  "election-pair": { browse: "politics" },
  "number-feed": { search: "US debt rises $1B" },
  weather: { browse: "weather" },
  "launch-count": { search: "rocket launches" },
  "polymarket-oneshot": { flow: "single" },
  "coin-vs-coin": { derby: "pair" },
  bracket: { derby: "bracket" },
  flippening: { derby: "flip" },
};

/** "Launch one like this" from a coin or pair page. */
export const likeHref = (ticker: string): string => `/burnticker/launch?like=${encodeURIComponent(ticker)}`;
