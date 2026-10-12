/**
 * THE TWELVE CANONICAL RULE SHAPES (2026-10-10, "launch one like this"): the /burnticker/templates gallery, and where "Start from this"
 * lands in the launch flow. Each shape has an example sentence (lint-clean; test/burntickerProduct.test.ts), what settles it, and the
 * launch link. The coin and pair pages' "Launch one like this" uses `likeHref` instead: same shape, the team / race / feed re-pickable,
 * the dials copied. Client-safe.
 */
import { PAIR_BURN_SENTENCE, describeRule } from "@/lib/burnticker/describe";
import type { BurnRule } from "@/lib/burnticker/rules";
import { firstPartyRule } from "@/lib/burnticker/wizard";
import { nwsSeries, stationByCode } from "@/lib/burnticker/sources/nws";
import { DEFAULT_SHARE, pctLabel, presetRowLabel } from "@/lib/burnticker/launchPresets";
import type { LaunchType } from "@/lib/burnticker/launchAvailability";
export type TemplateId = "team-season" | "team-oneshot" | "matchup" | "election-oneshot" | "election-pair" | "number-feed" | "weather" | "launch-count" | "polymarket-oneshot" | "coin-vs-coin" | "bracket" | "flippening";
/**
 * `pairLine` (review 2 F6): a template that launches a REGISTERED rivalry pair carries describe.ts PAIR_BURN_SENTENCE — the one factual
 * sentence every pair surface shares — so no example can say the losing coin burns. Two separate coins (a matchup on two separate
 * results, a bracket's fan coins) carry no pair line: nothing moves between them.
 */
export interface Template {
  id: TemplateId; title: string; example: string; settles: string; shape: "recurring" | "one-shot" | "pair"; href: string; pairLine?: string;
  /**
   * Launch audit 5 L10: where "Start from this" lands. "review" = the advertised draft exactly (the review card opens with the example's
   * rule, name and share); "choices" = a starting point, and `choices` says what is still to pick. Never "one click to the review card"
   * for a template that is not.
   */
  lands: "review" | "choices"; choices: string | null;
  /** The launch type it creates (launchAvailability.ts): the gallery and the page grey out a type this host cannot take. */
  type: LaunchType;
  /** The share the example names — the default preset of the rule's row (launchPresets.ts); test/burntickerLaunchDraft.test.ts pins it. */
  share: number;
  /** A shape only the operator can set up (a bracket is registered by the operator): the link opens the nearest creator flow. */
  operatorOnly?: string;
}

/**
 * THE WEATHER TEMPLATE'S DRAFT, EXACTLY (L10: the gallery advertised Detroit / 1%, the station flow defaulted to Denver / 90 °F / 2%).
 * The example sentence below is generated from this rule, and "Start from this" opens the review card with this rule.
 */
export const WEATHER_TEMPLATE = { station: "DTW", metric: "high" as const, threshold: 90, share: DEFAULT_SHARE.recurring, ticker: "DTWHOT" };
export function weatherTemplateRule(): BurnRule { return firstPartyRule(nwsSeries(WEATHER_TEMPLATE.metric, WEATHER_TEMPLATE.station, WEATHER_TEMPLATE.threshold), WEATHER_TEMPLATE.share); }
const weatherText = () => describeRule(weatherTemplateRule(), { ticker: WEATHER_TEMPLATE.ticker });
/** The weather template as the wizard's draft: the rule, its pick title, the generated name and ticker, the settlement line. */
export function weatherTemplateDraft(): { rule: BurnRule; title: string; name: string; ticker: string; settlement: string } {
  const st = stationByCode(WEATHER_TEMPLATE.station)!, t = weatherText();
  return { rule: weatherTemplateRule(), title: `${st.city} daily high ≥ ${WEATHER_TEMPLATE.threshold} °F (NWS)`, name: t.name, ticker: t.ticker, settlement: "the National Weather Service's daily climate report, cross-checked against the Iowa Environmental Mesonet" };
}
const R = pctLabel(DEFAULT_SHARE.recurring), O = pctLabel(DEFAULT_SHARE.oneShot), RROW = presetRowLabel("recurring");

export const TEMPLATES: Template[] = [
  { id: "team-season", title: "Team, this season", shape: "recurring", example: `$RAYS26 burns ${R} of its pool every time the Rays win a game this season, then retires.`, settles: "each game on its on-chain payout where a market exists, else a licensed final score, confirmed by the league's official feed", href: "/burnticker/launch?template=team-season", lands: "choices", choices: "pick the league and the team", type: "team", share: DEFAULT_SHARE.recurring },
  { id: "team-oneshot", title: "Team wins the title", shape: "one-shot", example: `$RAYSWS burns ${O} once if the Rays win the World Series.`, settles: "Polymarket's on-chain payout for the championship market, checked against the league's official results", href: "/burnticker/launch?template=team-oneshot", lands: "choices", choices: "pick the championship card from a search for the example", type: "markets", share: DEFAULT_SHARE.oneShot },
  { id: "matchup", title: "Matchup: two coins, one game", shape: "pair", example: "$LAKERS and $CELTICS on tonight's game: each coin's rule fires when its own team loses. Launched on two separate results they are two separate coins, each burning its own pool.", settles: "the game's on-chain payout or a licensed final score, confirmed by a second independent source", href: "/burnticker/launch?template=matchup", pairLine: `On one shared settled market they launch as a registered pair instead. ${PAIR_BURN_SENTENCE}`, lands: "choices", choices: "pick the league and the game", type: "matchup", share: DEFAULT_SHARE.oneShot },
  { id: "election-oneshot", title: "A candidate wins a race", shape: "one-shot", example: `$ELSAYED burns ${O} once if Abdul El-Sayed wins the Michigan Senate race.`, settles: "Polymarket's on-chain payout, checked against the state's certified result", href: "/burnticker/launch?template=election-oneshot", lands: "choices", choices: "pick the race and the candidate", type: "elections", share: DEFAULT_SHARE.oneShot },
  { id: "election-pair", title: "Election pair: candidate A vs B", shape: "pair", example: "$ELSAYED and $ROGERS: each coin's rule fires when its own candidate wins the race.", settles: "each side's market on its on-chain payout; both or neither", href: "/burnticker/launch?template=election-pair", pairLine: PAIR_BURN_SENTENCE, lands: "choices", choices: "pick the race and two candidates", type: "pairs", share: DEFAULT_SHARE.oneShot },
  { id: "number-feed", title: "A public number (debt, CPI)", shape: "recurring", example: `$DEBT burns ${R} of its pool for every $1B the U.S. debt rises.`, settles: "the publisher's own feed (Treasury, BLS, FRED), confirmed by a second publisher of the same figure", href: "/burnticker/launch?template=number-feed", lands: "choices", choices: "pick the Treasury card from a search for the example", type: "feeds", share: DEFAULT_SHARE.recurring },
  { id: "weather", title: "Weather threshold", shape: "recurring", example: weatherText().ruleBlock.split(/(?<=\.)\s/)[0], settles: "the National Weather Service's daily climate report, checked against the Iowa Environmental Mesonet", href: "/burnticker/launch?template=weather", lands: "review", choices: null, type: "weather", share: WEATHER_TEMPLATE.share },
  { id: "launch-count", title: "Rocket launches", shape: "recurring", example: `$LAUNCH burns ${R} of its pool for every orbital launch that reaches orbit.`, settles: "Launch Library 2's records (shown on Polymarket where a market exists)", href: "/burnticker/launch?template=launch-count", lands: "choices", choices: "pick the Launch Library card from a search for the example", type: "feeds", share: DEFAULT_SHARE.recurring },
  { id: "polymarket-oneshot", title: "Any adjudicated market", shape: "one-shot", example: `$OSCAR burns ${O} once if the film named in the market wins Best Picture.`, settles: "Polymarket's on-chain payout for that market", href: "/burnticker/launch?template=polymarket-oneshot", lands: "choices", choices: "search for the market and pick it", type: "markets", share: DEFAULT_SHARE.oneShot },
  { id: "coin-vs-coin", title: "Coin vs Coin", shape: "pair", example: `$TEAMWIF and $TEAMSHIB: each day, the rule of the side whose coin did better fires. Each burn spends ${R} of the pool by default, and you can choose ${RROW}.`, settles: "Pyth's published feeds, checked against a second feed (RedStone) or the pool TWAP", href: "/burnticker/launch?template=coin-vs-coin", pairLine: PAIR_BURN_SENTENCE, lands: "choices", choices: "pick the two reference coins", type: "derby", share: DEFAULT_SHARE.recurring },
  { id: "bracket", title: "Bracket (a Coin vs Coin season)", shape: "pair", example: "Eight coins in a bracket: each day, the coin whose side wins its match burns from its own pool; a round's loser retires.", settles: "the same Coin vs Coin readings, round by round; the operator registers the bracket", href: "/burnticker/launch?template=bracket", lands: "choices", choices: "pick one pairing in Coin vs Coin, because the operator sets up the bracket itself", type: "derby", share: DEFAULT_SHARE.recurring, operatorOnly: "Only the operator can set up a bracket. Creators launch single pairings through Coin vs Coin." },
  { id: "flippening", title: "The flippening (one-shot)", shape: "one-shot", example: `$FLIPWIF burns ${R} of its pool once, on the day WIF overtakes SHIB. You can choose ${RROW}.`, settles: "Pyth's feeds and both coins' supplies, read once at the crossing", href: "/burnticker/launch?template=flippening", lands: "choices", choices: "pick the two reference coins", type: "derby", share: DEFAULT_SHARE.recurring },
];

/** Where a template lands in the wizard: a flow, a search query, a Browse category, or the Coin vs Coin tile. */
export const TEMPLATE_START: Record<TemplateId, { flow?: "team" | "pair" | "single"; search?: string; browse?: string; derby?: "pair" | "bracket" | "flip"; draft?: "weather" }> = {
  "team-season": { flow: "team" },
  "team-oneshot": { search: "Rays win the World Series" },
  matchup: { flow: "pair" },
  "election-oneshot": { browse: "politics" },
  "election-pair": { browse: "politics" },
  "number-feed": { search: "US debt rises $1B" },
  weather: { draft: "weather" },
  "launch-count": { search: "rocket launches" },
  "polymarket-oneshot": { flow: "single" },
  "coin-vs-coin": { derby: "pair" },
  bracket: { derby: "bracket" },
  flippening: { derby: "flip" },
};

/** "Launch one like this" from a coin or pair page. */
export const likeHref = (ticker: string): string => `/burnticker/launch?like=${encodeURIComponent(ticker)}`;
