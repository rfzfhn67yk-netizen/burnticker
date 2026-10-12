import type { BurnRule } from "@/lib/burnticker/rules";
import { eventIdentity } from "@/lib/burnticker/eventIdentity";
import { championSeries, LEAGUES, noPlayoffs, parseEspnSeries, seasonLabel, seasonStartYear, teamByAbbr, type EspnSeries, type LeagueId, type Window } from "@/lib/burnticker/sources/espn";
import { parseNwsSeries, stationByCode } from "@/lib/burnticker/sources/nws";
import { fedregEoText, isFedregEo } from "@/lib/burnticker/sources/fedreg";
import { ll2Text, parseLl2Series } from "@/lib/burnticker/sources/launchLibrary";
import { parseUsgsSeries, usgsText } from "@/lib/burnticker/sources/usgs";
import { githubText, parseGithubSeries } from "@/lib/burnticker/sources/github";
import { parseYoutubeSeries, youtubeText } from "@/lib/burnticker/sources/youtube";
import { statedSentences } from "@/lib/burnticker/sources/polyStated";
import { CATALOGUE_ONE_SHOT_RE } from "@/lib/burnticker/inverse";

/**
 * THE AUTO-GENERATED COIN TEXT (2026-10-10, the owner thinks in sentences): from the LOCKED RULE, by deterministic templates — no model —
 * a name, a ticker, a one-liner ("burns when the Rays win") and a 3–4 sentence paragraph: what it tracks, exactly when and how much it
 * burns, the settlement source and its cross-read, what happens on the other outcome, the end, and "The creator earns nothing. The
 * liquidity pool is locked forever, and its fees fund the burn." (LP policy: owner decision 2026-10-10; plain-English pass 2026-10-11) Every template is built from words the copy lint (config/launch/copy-lint.json) allows; test/burntickerDescribe.test.ts
 * generates the text for every fixture rule and lints it.
 *
 *   flavour   "$RAYS26 burns when the Rays win."           editable on the create screen
 *   ruleBlock the remaining sentences                       locked: re-rendered from the rule and the ticker, never typed; it always
 *             carries exactly ONE WINDOW SENTENCE (the owner: "the coin's window must be unmissable") — a season coin's "This coin
 *             covers the 2026 Eagles season only, including the playoffs. After the Eagles' last game, it burns down whatever is left
 *             over four weeks and then retires. It does not continue into 2027.", a perpetual coin's "This coin has no end date and does
 *             not retire.", a one-shot's "This coin resolves once, on <date>. Then it burns down over four weeks and retires."
 *   badge     "2026 SEASON" / "POSTSEASON 2026" / "NEXT 5 GAMES" / "PERPETUAL" / "ONE-SHOT · Oct 31, 2026" — the coin card, the coin
 *             page header, the pair page, the token metadata's first description line and the footer of every post
 *   paragraph flavour + " " + ruleBlock                     the registry draft's description, the token metadata `description`,
 *                                                           the coin page header, the first daily post
 *
 * Client-safe (the wizard re-renders it as the ticker changes): no node imports.
 */

export interface DescribeCtx {
  ticker: string;
  /** What a market rule is about, in words ("the Rays win the 2026 World Series", "Abdul El-Sayed (D) wins the Michigan Senate race"). */
  eventPhrase?: string | null;
  /** The cross-read named in the text ("MLB's official results", "the Michigan certified result"). */
  crossRead?: string | null;
  /** ISO date the rule ends by (a market's end date; a game's start; a window's last game once known). */
  endsAt?: string | null;
  /** True once the window has ended (windowStatus): the badge then carries the end date. */
  ended?: boolean | null;
  /** A first-party feed rule: the feed's title, source and unit label. */
  feed?: { title: string; sourceName: string; unitLabel: string; crossRead?: string | null } | null;
  /** A name and ticker to suggest instead of the template's (the intent cards know "Rays WS"). */
  suggest?: { name: string; ticker: string } | null;
  /** For a one-game rule: the opponent and the date. */
  game?: { opponent: string; home: boolean; startsAt: string } | null;
  /**
   * A Polymarket-settled coin (sources-2): Polymarket's stated source as coin text, the cross-read when an adapter reads that publisher's
   * fact, and the dispute window (oracle/polymarket.ts polyStated → sources/polyStated.ts). Absent: the text keeps its older wording.
   */
  stated?: { phrase: string | null; crossRead: { text: string } | null; finalAfter: { text: string } } | null;
  /** A named launch's name (ll2.launch) or a channel's name (youtube.milestone), when the picker knows it. */
  subjectName?: string | null;
}
/** The window kinds a coin can have; every description carries exactly one sentence of its kind (WINDOW_SENTENCE). */
export type WindowKind = "season" | "post" | "next" | "perpetual" | "one-shot";
/** `lead`: the rule block's first sentence, whole (leadSentence), for the cards and the review that show one sentence. */
export interface CoinText { name: string; ticker: string; oneLiner: string; flavour: string; ruleBlock: string; lead: string; windowSentence: string; windowKind: WindowKind; badge: string; paragraph: string; shape: "recurring" | "one-shot" }

const CLOSER = "The creator earns nothing. The liquidity pool is locked forever, and its fees fund the burn.";
/**
 * WINNER TAKES THE BURN (owner decision 2026-10-11, LAUNCHPAD-PATH §40): the locked description of a rivalry-pair coin carries this
 * sentence (its rule's pair.winnerTakesBurn). The words match rules.ts WINNER_TAKES_BURN_LINE; the copy lint's no-prizes check keeps
 * prize / reward / payout / "win fees" out of every pair sentence.
 */
export const PAIR_DESCRIPTION_SENTENCE = "This coin is paired with a rival coin, and fees from both coins burn the winner's supply. The winner is the coin whose rule a result fires.";
/**
 * THE ONE FACTUAL PAIR SENTENCE (review 2 F6, 2026-10-11): every surface that explains a registered rivalry pair — the templates gallery,
 * the landing page (site/burnticker/index.html, pinned by test/burntickerTemplates.test.ts), the review card, the Burn Derby page and the
 * pair pages — carries exactly this sentence, so no page can say the losing coin burns or that one pool cannot pay the other. It is the
 * rule semantics the keeper runs (multiKeeper.planToken: the coin whose rule maps the result to a burn is "won", the other "lost" and
 * forward_to_winner moves its share to the winner's fee PDA); `pairWinnerOf` computes the winner from the two rules and a result so a
 * named fixture can check the sentence against the engine.
 */
// UX report 3 item 6: "winner" is the coin whose RULE fires, not the team that won (a team coin often burns when its team loses)
export const PAIR_BURN_SENTENCE = "Winner takes the burn (the coin whose rule fires, not the team that won): when a result fires one coin's rule, eligible fees from both coins fund that coin's burn, and the other coin's share for that result moves to its burn pool. Nothing is paid to holders.";
/** The review card's line for a registered rivalry pair (Coin vs Coin, a shared-selector matchup, an election pair). */
export const PAIR_REVIEW_LINE = `${PAIR_BURN_SENTENCE} A draw or a void moves nothing.`;
/**
 * PAIR ECONOMICS IN ONE VOICE (ChatGPT chat audit 6, A3, 2026-10-12). Two kinds of two-coin launch, each explained by the same four facts,
 * with the real tickers in a worked example: (a) which outcome fires, (b) which token is bought and burned, (c) whose pool pays, (d)
 * whether SOL moves between the pools. A REGISTERED pair is winner-takes-the-burn (pairForward.ts header, LAUNCHPAD-PATH §40): the
 * loser's fuel for that result moves to the winner's burn pool and burns the winner's coin; the loser's supply is untouched; a draw or a
 * void moves nothing. A MATCHUP made of two separate launches is two independent coins: each burns itself from its own pool, and no SOL
 * moves. The review card, the Coin vs Coin tile, the templates and About read these; nothing else describes pair money.
 */
export interface PairFacts { kind: "winner-takes-the-burn" | "independent"; trigger: string; burned: string; pays: string; moves: string; example: string }
export function winnerTakesBurnFacts(a: string, b: string): PairFacts {
  return {
    kind: "winner-takes-the-burn",
    // walkthrough snag 14: no sports words inside a crypto pair's facts
    trigger: `A result decides a winner by firing one coin's rule. The winner is the coin whose rule fires, whichever side that is.`,
    burned: "Only the winner's tokens are bought and burned. The loser's supply is untouched.",
    pays: "The winner's burn pool pays its own share. The loser's burn pool pays the share it would have spent if it had won.",
    moves: "SOL does move between the two pools. The loser's share for that result moves to the winner's burn pool. Nothing is paid to holders, and a draw or a void moves nothing.",
    example: `For example, if a result fires $${a}'s rule, $${a} is bought and burned with its own share, and $${b}'s share for that result moves to $${a}'s burn pool and burns $${a} too. $${b}'s supply does not change.`,
  };
}
export function independentPairFacts(a: string, b: string, teams: { a: string; b: string } | null = null): PairFacts {
  const A = teams?.a ?? `$${a}'s side`, B = teams?.b ?? `$${b}'s side`;
  return {
    kind: "independent",
    trigger: `These are two separate coins with their own rules. $${a}'s rule fires when ${A} lose, and $${b}'s rule fires when ${B} lose.`,
    burned: "The coin whose rule fires is bought and burned. The other coin is not touched.",
    pays: "Each coin pays from its own burn pool.",
    moves: "No SOL moves between the two coins, because they are separate launches. A tie burns neither.",
    example: `For example, if ${A} lose, $${a} spends its share of its own burn budget, the $${a} tokens bought are burned, and $${b} does nothing.`,
  };
}
/** The four facts and the example as plain sentences, in order. */
export const pairFactLines = (f: PairFacts): string[] => [f.trigger, f.burned, f.pays, f.moves, f.example];
/** Does this binary rule map the result to a burn? (A scalar or a rule without a mapping for it: no.) */
const firesOn = (r: Pick<BurnRule, "kind" | "binary">, result: "yes" | "no"): boolean => r.kind === "binary" && !!r.binary && ((result === "yes" ? r.binary.onYes : r.binary.onNo)?.fractionOfPool ?? 0) > 0;
/**
 * The winner of one result in a registered pair, from the two LOCKED RULES: the coin whose rule the result fires. null when neither or
 * both fire (a draw: nothing moves). Binary rules only (every registered pair today: one shared selector, inverted mappings).
 */
export function pairWinnerOf<T extends { ticker: string; rule: Pick<BurnRule, "kind" | "binary"> }>(a: T, b: T, result: "yes" | "no"): { winner: T; loser: T } | null {
  const fa = firesOn(a.rule, result), fb = firesOn(b.rule, result);
  if (fa === fb) return null;
  return fa ? { winner: a, loser: b } : { winner: b, loser: a };
}
/** PAIR_BURN_SENTENCE with the two coins named, for one result ("… burn $CHIEFS …; $BRONCOS's share goes to $CHIEFS's burn pool …"). */
export function pairResultSentence(a: { ticker: string; rule: Pick<BurnRule, "kind" | "binary"> }, b: { ticker: string; rule: Pick<BurnRule, "kind" | "binary"> }, result: "yes" | "no"): string {
  const w = pairWinnerOf(a, b, result);
  if (!w) return `A ${result.toUpperCase()} result fires both rules or neither. That is a draw, and nothing moves between $${a.ticker} and $${b.ticker}.`;
  return `This result fires $${w.winner.ticker}'s rule: eligible fees from both coins fund $${w.winner.ticker}'s burn, and $${w.loser.ticker}'s share for it moves to $${w.winner.ticker}'s burn pool. Nothing is paid to holders.`;
}
const pairSentence = (r: BurnRule): string => (r.pair && (r.pair as { winnerTakesBurn?: boolean }).winnerTakesBurn ? ` ${PAIR_DESCRIPTION_SENTENCE}` : "");
const BURN_DOWN = "it burns down whatever is left over four weeks and then retires";
/**
 * END SINKS (LAUNCHPAD-PATH §45; rules.ts endSinkOf, copied here because rules.ts is not client-safe): a rule with `onEnd.endSink` sends
 * whatever is left at a resolved end to its sink's burn pool, so its window sentence says where the leftover burns, and one more sentence
 * says what a void end does instead. A test pins this copy equal to rules.ts endSinkOf.
 */
export const describeEndSink = (r: Pick<BurnRule, "onEnd" | "pair" | "kind" | "binary" | "scalar">): "flagship" | "pair-winner" | null => {
  if (r.onEnd?.endSink !== true) return null;
  const m = (r.kind === "binary" ? (r.binary?.onYes ?? r.binary?.onNo) : r.scalar?.perUnit) as { tokens?: number } | null | undefined;
  if (m?.tokens !== undefined) return null;
  return (r.pair as { winnerTakesBurn?: boolean } | null | undefined)?.winnerTakesBurn ? "pair-winner" : "flagship";
};
const sinkPhrase = (k: "flagship" | "pair-winner"): string => (k === "pair-winner" ? "whatever is left burns the winning coin, or $DEFICIT if there isn't one," : "whatever is left burns $DEFICIT,");
/** The window sentence's ending: the four-week burn-down, or (end sinks) where the leftover burns. */
const burnDown = (r: BurnRule): string => { const k = describeEndSink(r); return k ? `${sinkPhrase(k)} and the coin retires` : BURN_DOWN; };
/** The void sentence that follows the window sentence of a rule with an end sink ("" otherwise). */
export const END_SINK_VOID_SENTENCE = "If the result is voided or the season is cancelled, whatever is left burns down on this coin over four weeks instead.";
const voidSentence = (r: BurnRule): string => (describeEndSink(r) && windowKindOf(r) !== "perpetual" ? ` ${END_SINK_VOID_SENTENCE}` : "");
/**
 * THE CHAMPION PATH (website-18, the owner on 2026-10-12: "say I want to pick the Dodgers to win the World Series: it should burn every
 * game they win until the last game of the World Series, then burn the remaining balance after they win. If they lose, it should ... burn
 * $DEFICIT"). A team coin on a team's wins for the whole season, in a league whose schedule can tell a champion (espn.ts CHAMPION_KNOWN),
 * whose end sink is $DEFICIT and that is not the fade side. The keeper (multiKeeper.recordWindowEnd, endSinkKeeper) reads this same test:
 * a champion's coin ends on the ordinary wind-down on itself, any other end forwards the rest to $DEFICIT. The program can pin only
 * $DEFICIT, a named existing coin or a pair partner when a coin is created, so "the champion's coin" is not offered.
 */
export const championPathRule = (r: BurnRule): boolean => r.oracle === "catalogue" && !r.inverse && !r.set && describeEndSink(r) === "flagship" && championSeries(r.series) !== null;
/** The champion path's two end sentences, one per outcome (the review card and the locked description say both). */
export const championEndSentences = (ref: string): [string, string] => [`If ${ref} win the championship, the rest of the pool burns here.`, "If they do not, the rest goes to $DEFICIT's burn."];
export const PERPETUAL_SENTENCE = "This coin has no end date and does not retire.";
/**
 * The first-snow season in the coin's own text (intent audit item 11; weatherIntent.ts FIRST_SNOW_SEASON has the long form): the report's
 * season-to-date total starts each July 1, and only readings after the launch are planned (multiKeeper.ts planToken).
 */
export const SNOW_SEASON_SENTENCE = "The season runs July 1 to June 30, and only a first snow after launch day counts. With no snow by June 30, the coin ends without a burn.";

/**
 * THE LEAD SENTENCE (intent audit item 7: the fade side of "U.S. unemployment rate" showed only "For every reading of U.S."). The first
 * sentence of a text, where a period ends a sentence only when it is followed by a space and a capital letter, a "$" or a digit, and it
 * does not close an abbreviation: a run of single letters with periods ("U.S.", "D.C.", "e.g."), or a short title or place word ("St.",
 * "Mt.", "No.", "vs.", "Inc."). A decimal ("0.1") never has a space after its period. CoinText.lead carries it, so no page splits text.
 */
/**
 * A generated coin name, at most `max` characters, cut at a word boundary and never mid-word (intent audit 4 item 19: "Wikipedia daily
 * views of an arti"). A trailing small word ("of", "the", "a", "an", "and") is dropped with the cut.
 */
export function capName(name: string, max = 32): string {
  const s = name.replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  const words = s.slice(0, max + 1).split(" ");
  if (words.length > 1) words.pop();
  while (words.length > 1 && /^(of|the|a|an|and|for|on|in|by|to|—|-)$/i.test(words[words.length - 1])) words.pop();
  const out = words.join(" ").replace(/[,:;—-]+$/, "").trim();
  return out.length ? out.slice(0, max) : s.slice(0, max);
}

/**
 * The selected subject of a parameterized series, its short name and what each reading measures, read from the series id itself (the same
 * on the page and on the server). The window words follow each adapter (config/burnticker/sources.json): a per-day total, or a once-a-day
 * snapshot measured against the previous reading.
 */
export function paramSubject(series: string): { name: string; ticker: string; what: string; window: string } | null {
  const i = series.indexOf(":");
  if (i < 0) return null;
  const fam = series.slice(0, i), p = series.slice(i + 1);
  const snap = "a snapshot of the count taken once a day and measured against the previous reading";
  if (fam === "wiki.views") { const a = decodeURIComponent(p).replace(/_/g, " "); return { name: `${a} Wiki Views`, ticker: a, what: `on the English Wikipedia article “${a}”`, window: "the total views of one UTC day, read once the day is over" }; }
  if (fam === "steam.players") return { name: `Steam App ${p} Players`, ticker: `STEAM${p}`, what: `in the concurrent player count of Steam app ${p}`, window: snap };
  if (fam === "github.stars") { const repo = p.split("/")[1] ?? p; return { name: `${repo} Stars`, ticker: `${repo}STAR`, what: `on the ${p} GitHub repository`, window: snap }; }
  if (fam === "defillama.tvl") return { name: `${p} TVL`, ticker: `${p}TVL`, what: `of total value locked in ${p}, as DefiLlama reports it`, window: snap };
  if (fam === "edgar.8k") return { name: `CIK ${p} 8-K Filings`, ticker: `EDGAR${p.replace(/^0+/, "")}`, what: `on Form 8-K by SEC filer CIK ${p}`, window: "the number of filings on one UTC day" };
  return null;
}

/** "the Lakers win the 2027 NBA championship" → "the Lakers did NOT win the 2027 NBA championship"; anything else → "NO on “…”". */
export function negatePhrase(phrase: string): string {
  const m = /^(.+?) (?:win|wins|will win) (.+)$/.exec(phrase.trim());
  return m ? `${m[1]} did NOT win ${m[2]}` : `NO on “${phrase.trim()}”`;
}

const ABBREV =/(?:\b(?:[A-Za-z]\.){2,}|\b(?:St|Mt|Ft|Dr|Mr|Mrs|Ms|Jr|Sr|No|vs|Inc|Co|Corp|Ltd|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|approx|est)\.)$/;
export function leadSentence(text: string): string {
  const t = text.trim();
  for (const m of t.matchAll(/[.!?](?=\s+[A-Z$0-9“"(])/g)) {
    const head = t.slice(0, m.index + 1);
    if (m[0] === "." && ABBREV.test(head)) continue;
    return head;
  }
  return t;
}
/** One pattern per window kind; a description matches exactly one of them, exactly once (test/burntickerDescribe.test.ts). */
export const WINDOW_SENTENCE: Record<WindowKind, RegExp> = {
  season: /This coin covers the [^.]*? season only(?:, including (?:the playoffs|every match of the competition)\. After [^.]*? last game, (?:it burns down whatever is left over four weeks and then retires|whatever is left burns [^.]*?, and the coin retires)\.(?: It does not continue into [^.]+\.)?|\. If [^.]*? win the championship, the rest of the pool burns here\. If they do not, the rest goes to \$DEFICIT's burn\.)/g,
  post: /This coin covers [^.]*? postseason only\. After [^.]*? last playoff game, (?:it burns down whatever is left over four weeks and then retires|whatever is left burns [^.]*?, and the coin retires)\.(?: It does not continue into [^.]+\.)?/g,
  next: /This coin covers [^.]*? next \d+ games? only, from [^.]*?\d{4}\. After game \d+, (?:it burns down whatever is left over four weeks and then retires|whatever is left burns [^.]*?, and the coin retires)\./g,
  perpetual: /This coin has no end date and does not retire\./g,
  "one-shot": /This coin resolves once(?:, on [A-Z][a-z]{2} \d{1,2}, \d{4}|, on [^.]+?)?\. Then (?:it burns down over four weeks and retires|whatever is left burns [^.]*?, and the coin retires)\./g,
};
const fractionText = (r: BurnRule): string => {
  const m = (r.kind === "binary" ? (r.binary?.onYes ?? r.binary?.onNo) : r.scalar?.perUnit) as { fractionOfPool?: number; tokens?: number } | null | undefined;
  return m?.tokens !== undefined ? `${m.tokens.toLocaleString("en-US")} tokens from its vault` : `${Math.round((m?.fractionOfPool ?? 0) * 1000) / 10}%`;
};
const spends = (r: BurnRule, t: string) => { const p = fractionText(r); return p.endsWith("vault") ? `the coin burns ${p}` : `the burn pool spends ${p} buying $${t} on Raydium and burns it`; };
/** "The result comes from X, cross-checked against Y." / "MLB's official feed confirms it." — the settlement sentences. */
const cap = (x: string) => x[0].toUpperCase() + x.slice(1);
const SPORTS_RESULT = "its market's on-chain payout if it has one, or else from a licensed final score";
const possessive = (n: string) => (n.endsWith("s") ? `${n}'` : `${n}'s`);
/** "Oct 31, 2026" (America/Denver). */
export const shortDate = (iso: string | null | undefined): string | null => (iso ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00Z` : iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Denver" }) : null);
const day = shortDate;
export const tickerFrom = (s: string, suffix = ""): string => { const base = s.toUpperCase().replace(/[^A-Z0-9]/g, ""); return (base.slice(0, Math.max(2, 10 - suffix.length)) + suffix).slice(0, 10); };
const CROSS: Record<string, string> = { nhl: "NHL's official scores", mlb: "MLB's official feed", nba: "NBA's official feed" };
const CHAMP_CODE: Record<string, string> = { mlb: "WS", nfl: "SB", nba: "TITLE", nhl: "CUP" };
const yy = (league: LeagueId, year: number) => String(seasonStartYear(league, year) % 100).padStart(2, "0");
const nextSeason = (league: LeagueId, year: number) => seasonLabel(league, year + 1);
/** League mode (rules.ts `set`): the conditional forward, in the description whenever the rule carries it. */
export const leagueSentence = (r: BurnRule): string => (r.set && r.set.forwardBps > 0 ? ` In league mode, ${Math.round(r.set.forwardBps) / 100}% of the leftover goes to the winning coin of set ${r.set.id} if the forwarding instruction is live by season end. Otherwise it burns down on this coin.` : "");
const oneShotSentence = (r: BurnRule, iso: string | null | undefined, onWhat: string | null = null) => {
  const k = describeEndSink(r), then = k ? `${sinkPhrase(k)} and the coin retires` : "it burns down over four weeks and retires";
  return onWhat ? `This coin resolves once, on ${onWhat}. Then ${then}.` : `This coin resolves once${iso ? `, on ${day(iso)}` : ""}. Then ${then}.`;
};

/** The coin's window kind from its rule alone. */
export function windowKindOf(r: BurnRule): WindowKind {
  const series = r.oracle === "catalogue" ? r.series ?? "" : "";
  const e = series ? parseEspnSeries(series) : null;
  if (e) return e.kind === "game" ? "one-shot" : e.window.kind === "legacy" ? (e.window.scope === "post" ? "post" : "season") : e.window.kind;
  if (CATALOGUE_ONE_SHOT_RE.test(series)) return "one-shot";
  if (r.oracle === "polymarket" || r.market) return "one-shot";
  return "perpetual";
}

/** The window badge: "2026 SEASON", "POSTSEASON 2026", "NEXT 5 GAMES", "PERPETUAL", "ONE-SHOT · Oct 31, 2026" (+ the end once known). */
export function windowBadge(r: BurnRule, ctx: Pick<DescribeCtx, "endsAt" | "ended"> = {}): string {
  const series = r.oracle === "catalogue" ? r.series ?? "" : "";
  const e = series ? parseEspnSeries(series) : null;
  const end = ctx.endsAt ? day(ctx.endsAt) : null;
  const ended = ctx.ended && end ? ` · ENDED ${end}` : "";
  if (e?.kind === "team") {
    const w = e.window;
    if (w.kind === "season") return `${seasonLabel(e.league, w.year)} SEASON${ended}`;
    if (w.kind === "post") return `POSTSEASON ${seasonLabel(e.league, w.year)}${ended}`;
    if (w.kind === "next") return `NEXT ${w.n} GAME${w.n === 1 ? "" : "S"}${end ? ` · ENDS ${end}` : ""}`;
    if (w.kind === "perpetual") return "PERPETUAL";
    return `${w.scope === "post" ? "POSTSEASON" : "THIS SEASON"}${ended}`;
  }
  if (windowKindOf(r) === "one-shot") return `ONE-SHOT${end ? ` · ${end}` : ""}`;
  return "PERPETUAL";
}

function espnText(r: BurnRule, s: EspnSeries, c: DescribeCtx): CoinText {
  const team = teamByAbbr(s.league, s.abbr)!, nick = team.nickname, t = c.ticker, o = s.outcome, L0 = LEAGUES[s.league];
  // "the Rays", "the Lakers" — but "Arsenal", "Inter Miami", "Georgia": clubs and colleges go without the article
  const ref = L0.sport === "soccer" || s.league === "cfb" || s.league === "mcbb" || s.league === "wcbb" ? nick : `the ${nick}`;
  const Ref = ref[0].toUpperCase() + ref.slice(1), poss = possessive(ref);
  const tie = L0.draws ? "draw" : "tie";
  const verb = o === "win" ? "win" : o === "draw" ? "draw" : "lose", noun = o === "win" ? "win" : o === "draw" ? "draw" : "loss";
  const other = o === "win" ? `a loss or a ${tie}` : o === "draw" ? "a win or a loss" : `a win or a ${tie}`;
  // THE FADE SIDE (rules.ts inverse): a team coin that burns on every game day WITHOUT its outcome
  const inv = !!r.inverse && s.kind === "team";
  const sfx = (inv ? "N" : "") + (o === "win" ? (inv ? "W" : "") : o === "draw" ? "D" : "L"), Noun = (inv ? "No " : "") + (o === "win" ? "Wins" : o === "draw" ? "Draws" : "Losses");
  const cross = CROSS[s.league] ?? "a second independent source";
  const badge = windowBadge(r, c);
  const mk = (name: string, ticker: string, oneLiner: string, rules: string, windowSentence: string, windowKind: WindowKind, shape: CoinText["shape"]): CoinText => {
    const ruleBlock = `${rules} ${windowSentence}${voidSentence(r)}${leagueSentence(r)}${pairSentence(r)} ${CLOSER}`;
    return { name: capName(name), ticker, oneLiner, flavour: `$${t} ${oneLiner}.`, ruleBlock, lead: leadSentence(ruleBlock), windowSentence, windowKind, badge, paragraph: `$${t} ${oneLiner}. ${ruleBlock}`, shape };
  };
  if (s.kind === "team") {
    const w: Window = s.window;
    const settle = inv ? `Each game's result comes from ${SPORTS_RESULT}. ${cap(cross)} confirms it. A day with two games counts once, and a game day with a ${noun} burns nothing.` : `Each game's result comes from ${SPORTS_RESULT}. ${cap(cross)} confirms it. Nothing happens on ${other}.`;
    const oneLiner = inv ? `burns on every game day ${ref} do not ${verb}` : `burns when ${ref} ${verb}`;
    const every = (scope: string) => inv ? `For every ${nick} game day without a ${noun} ${scope}, ${spends(r, t)}, with a receipt on chain. ${settle}` : `For every ${nick} ${noun} ${scope}, ${spends(r, t)}, with a receipt on chain. ${settle}`;
    if (w.kind === "season" && championPathRule(r)) {
      // the champion path: every win through the postseason, then the rest burns here (champion) or goes to $DEFICIT's burn
      const L = seasonLabel(s.league, w.year);
      return mk(`${nick} ${L} ${Noun}`, tickerFrom(nick, `${sfx}${yy(s.league, w.year)}`), oneLiner,
        `This coin burns ${fractionText(r)} of its pool every game ${ref} win, through the last game of the postseason. Each burn buys $${t} on Raydium, with a receipt on chain. ${settle}`,
        `This coin covers the ${L} season only. ${championEndSentences(ref).join(" ")}`, "season", "recurring");
    }
    if (w.kind === "season") {
      const L = seasonLabel(s.league, w.year);
      return mk(`${nick} ${L} ${Noun}`, tickerFrom(nick, `${sfx}${yy(s.league, w.year)}`), oneLiner, every(`in the ${L} season`),
        `This coin covers the ${L} ${nick} season only, including ${noPlayoffs(s.league) ? "every match of the competition" : "the playoffs"}. After ${poss} last game, ${burnDown(r)}. It does not continue into ${nextSeason(s.league, w.year)}.`, "season", "recurring");
    }
    if (w.kind === "post") {
      const L = seasonLabel(s.league, w.year);
      return mk(`${nick} ${L} Playoffs`, tickerFrom(nick, `${sfx}P${yy(s.league, w.year)}`), `${oneLiner} in the postseason`, every(`in the ${L} postseason`),
        `This coin covers ${poss} ${L} postseason only. After ${poss} last playoff game, ${burnDown(r)}. It does not continue into ${nextSeason(s.league, w.year)}.`, "post", "recurring");
    }
    if (w.kind === "next") {
      const from = `${w.from.slice(0, 4)}-${w.from.slice(4, 6)}-${w.from.slice(6)}`;
      return mk(`${nick} Next ${w.n}`, tickerFrom(nick, `${sfx}${w.n}G`), `${oneLiner} in their next ${w.n === 1 ? "game" : `${w.n} games`}`, every(`in their next ${w.n === 1 ? "game" : `${w.n} games`}`),
        `This coin covers ${poss} next ${w.n} game${w.n === 1 ? "" : "s"} only, from ${day(from)}. After game ${w.n}, ${burnDown(r)}.`, "next", "recurring");
    }
    if (w.kind === "perpetual") {
      return mk(`${nick} ${Noun}`, o === "win" ? tickerFrom(nick) : tickerFrom(nick, o === "draw" ? "DRAW" : "LOSE"), oneLiner, `${every("in any game, every season")} Nothing is read in the off-season. The pool keeps filling, and readings start again with the next season's first game.`,
        PERPETUAL_SENTENCE, "perpetual", "recurring");
    }
    const scope = w.scope === "post" ? "this postseason" : w.scope === "reg" ? "for the rest of the regular season" : "this season";
    return mk(`${nick} ${Noun}`, tickerFrom(nick, o === "win" ? "WIN" : o === "draw" ? "DRAW" : "LOSE"), oneLiner, every(scope),
      w.scope === "post" ? `This coin covers ${poss} current postseason only. After ${poss} last playoff game, ${burnDown(r)}.` : `This coin covers the current ${nick} season only, including the playoffs. After ${poss} last game, ${burnDown(r)}.`, w.scope === "post" ? "post" : "season", "recurring");
  }
  const opp = c.game ? (L0.sport === "soccer" || s.league === "cfb" || s.league === "mcbb" || s.league === "wcbb" ? c.game.opponent : `the ${c.game.opponent}`) : null;
  const vs = c.game ? ` ${c.game.home ? "against" : "at"} ${opp}${c.game.startsAt ? ` on ${day(c.game.startsAt)}` : ""}` : ` in game ${s.eventId}`;
  const oneLiner = `burns if ${ref} ${verb}${c.game ? ` ${c.game.home ? "against" : "at"} ${opp}` : " that game"}`;
  return mk(`${nick} ${o === "win" ? "Win" : o === "draw" ? "Draw" : "Lose"}`, tickerFrom(nick, o === "win" ? "WIN" : o === "draw" ? "DRAW" : "LOSE"), oneLiner, `If ${ref} ${verb}${vs}, ${spends(r, t)} once, with a receipt on chain. The game's result comes from ${SPORTS_RESULT}. ${cap(cross)} confirms it. Nothing happens otherwise${o === "draw" ? "" : `, and a ${tie} burns nothing`}.`,
    oneShotSentence(r, c.game?.startsAt ?? c.endsAt), "one-shot", "one-shot");
}

/** The coin's name, ticker, one-liner and paragraph from its rule. `ctx.ticker` is the ticker the text names (the suggestion when empty). */
export function describeRule(r: BurnRule, ctx: DescribeCtx): CoinText {
  const series = r.oracle === "catalogue" ? r.series ?? "" : "";
  const e = series ? parseEspnSeries(series) : null;
  if (e) { const t0 = espnText(r, e, { ...ctx, ticker: ctx.ticker || "TICKER" }); return ctx.ticker ? t0 : espnText(r, e, { ...ctx, ticker: t0.ticker }); }
  const n = series ? parseNwsSeries(series) : null;
  const badge = windowBadge(r, ctx);
  const build = (name0: string, tk0: string, oneLiner: string, block: (t: string) => string, windowSentence: string, shape: CoinText["shape"]): CoinText => {
    const name = ctx.suggest?.name ?? name0, tk = ctx.suggest?.ticker ?? tk0;
    const t = ctx.ticker || tk, ruleBlock = `${block(t)} ${windowSentence}${voidSentence(r)}${leagueSentence(r)}${pairSentence(r)} ${CLOSER}`;
    return { name: capName(name), ticker: tk, oneLiner, flavour: `$${t} ${oneLiner}.`, ruleBlock, lead: leadSentence(ruleBlock), windowSentence, windowKind: windowKindOf(r), badge, paragraph: `$${t} ${oneLiner}. ${ruleBlock}`, shape };
  };
  if (n && r.inverse && n.metric !== "snow") {
    // THE FADE SIDE: the days the threshold is NOT reached
    // intent audit item 1: the report gives whole °F, so "below T" is said as the inclusive "T − 1 °F or colder" (the same form as the
    // plain side's "T °F or hotter"), and a day with no reading counts as nothing, never as a cold day
    const st = stationByCode(n.station)!, hot = n.metric === "high";
    const what = hot ? `every day ${possessive(st.city)} official high is ${n.threshold - 1} °F or colder` : `every day ${st.city} gets less than ${n.threshold.toFixed(2)} in of rain`;
    return build(`${st.city} ${hot ? "Cold" : "Dry"}`, tickerFrom(st.code, hot ? "COLD" : "DRY"), hot ? `burns on every ${st.city} day at ${n.threshold - 1} °F or colder` : `burns on every ${st.city} day with less than ${n.threshold.toFixed(2)} in of rain`,
      (t) => `For ${what}, ${spends(r, t)}, with a receipt on chain. The result comes from the National Weather Service's daily climate report, cross-checked against the Iowa Environmental Mesonet. Nothing happens on ${hot ? `a day at ${n.threshold} °F or hotter` : `a day with ${n.threshold.toFixed(2)} in of rain or more`}, or on a day with no reading.`,
      PERPETUAL_SENTENCE, "recurring");
  }
  if (n) {
    const st = stationByCode(n.station)!;
    const what = n.metric === "high" ? `every day ${possessive(st.city)} official high reaches ${n.threshold} °F` : n.metric === "rain" ? `every day ${st.city} gets ${n.threshold.toFixed(2)} in of rain or more` : `on ${possessive(st.city)} first measurable snow of the season`;
    const other = n.metric === "high" ? "a cooler day" : n.metric === "rain" ? "a drier day" : "a day without snow";
    const oneLiner = n.metric === "high" ? `burns on every ${st.city} day at ${n.threshold} °F or hotter` : n.metric === "rain" ? `burns on every ${st.city} day with ${n.threshold.toFixed(2)} in of rain` : `burns on ${possessive(st.city)} first snow`;
    return build(`${st.city} ${n.metric === "high" ? "Heat" : n.metric === "rain" ? "Rain" : "Snow"}`, tickerFrom(st.code, n.metric === "high" ? "HOT" : n.metric === "rain" ? "RAIN" : "SNOW"), oneLiner,
      (t) => `${what[0].toUpperCase()}${what.slice(1)}, ${spends(r, t)}${n.metric === "snow" ? " once" : ""}, with a receipt on chain. The result comes from the National Weather Service's daily climate report, cross-checked against the Iowa Environmental Mesonet. Nothing happens on ${other}.${n.metric === "snow" ? ` ${SNOW_SEASON_SENTENCE}` : ""}`,
      n.metric === "snow" ? oneShotSentence(r, null, `the first snow`) : PERPETUAL_SENTENCE, n.metric === "snow" ? "one-shot" : "recurring");
  }
  // sources-2 (2026-10-12): the publishers with their own text — executive orders, launches, earthquake counts, GitHub, YouTube
  const own = r.oracle === "catalogue" ? sourceText(r, series, ctx) : null;
  if (own) return build(own.name, own.ticker, own.oneLiner, own.block, own.oneShot ? oneShotSentence(r, null) : PERPETUAL_SENTENCE, own.oneShot ? "one-shot" : "recurring");
  if (r.oracle === "catalogue" && ctx.feed && r.inverse) {
    // THE FADE SIDE for any other first-party feed: the readings that do not move the rule's way
    const f = ctx.feed, title = f.title.split(/[(—,]/)[0].trim(), dir = r.scalar?.direction ?? "up";
    if (series === "treasury.debt") return build("Flat Debt Days", "FLATDEBT", "burns on every business day the national debt stays flat or falls",
      (t) => `This coin burns on the days the debt stays flat or falls. For every business day the national debt stays flat or falls, ${spends(r, t)}, with a receipt on chain. The result comes from ${f.sourceName}, cross-checked against ${f.crossRead ?? "a second publisher"}. A day the debt rises, by any amount, burns nothing.`, PERPETUAL_SENTENCE, "recurring");
    const not = r.scalar?.baseline === 0 ? "reads zero" : dir === "up" ? "does not rise" : dir === "down" ? "does not fall" : "does not move";
    const did = r.scalar?.baseline === 0 ? "is above zero" : dir === "up" ? "rises" : dir === "down" ? "falls" : "moves";
    const sub = paramSubject(series), what = sub ? sub.name : title;
    return build(sub ? `No Move ${sub.name}` : `No Move ${title}`, tickerFrom(`NO${sub ? sub.ticker : title.replace(/^U\.?S\.?\s+/i, "")}`), `burns on every reading of ${what} that ${not}`,
      (t) => `For every reading of ${what} that ${not}, ${spends(r, t)}, with a receipt on chain. The result comes from ${f.sourceName}.${sub ? ` Each reading is ${sub.window}.` : ""} A reading that ${did}, by any amount, burns nothing.`, PERPETUAL_SENTENCE, "recurring");
  }
  if (r.oracle === "catalogue" && ctx.feed) {
    const f = ctx.feed, sub = paramSubject(series);
    // intent audit 4 item 19: a parameterized source names its subject, its source and what each reading measures, never "an article"
    if (sub) return build(sub.name, tickerFrom(sub.ticker), `burns for every ${f.unitLabel} ${sub.what}`,
      (t) => `For every ${f.unitLabel} ${sub.what}, ${spends(r, t)}, with a receipt on chain. The result comes from ${f.sourceName}, cross-checked against ${f.crossRead ?? "a second publisher"}. Each reading is ${sub.window}. Nothing happens on a move smaller than one unit.`, PERPETUAL_SENTENCE, "recurring");
    return build(f.title.split(/[(—,]/)[0].trim(), tickerFrom(f.title.replace(/^U\.?S\.?\s+/i, "").split(/[\s(,—-]/)[0]), `burns for every ${f.unitLabel} (${f.title.split(/[(—,]/)[0].trim()})`,
      (t) => `For every ${f.unitLabel}, ${spends(r, t)}, with a receipt on chain. The result comes from ${f.sourceName}, cross-checked against ${f.crossRead ?? "a second publisher"}. Nothing happens on a move smaller than one unit.`, PERPETUAL_SENTENCE, "recurring");
  }
  if (r.oracle === "polymarket" && r.market && r.binary && !r.binary.onYes && r.binary.onNo) {
    // intent audit 3 item 4: the NO side ("the Lakers do not win the 2027 NBA championship") burns on a NO payout only. The keeper reads
    // a voided or unsettled market as no burn (units.ts unitStep, onVoid "skip"), and the one-shot then ends void: never a NO.
    const phrase0 = (ctx.eventPhrase ?? "the market's event happens").replace(/\s*\(resolves once\)$/, "");
    const id = eventIdentity(phrase0), phrase = id.verb ? id.phrase : phrase0, not = negatePhrase(phrase);
    const settle = ctx.stated ? statedSentences(ctx.stated, ctx.stated.finalAfter) : `The result comes from Polymarket's on-chain payout, cross-checked against ${ctx.crossRead ?? "the official result"}.`;
    return build(`${id.verb && id.confident ? id.name : "Event"} No`.slice(0, 32), `NO${tickerFrom(id.ticker)}`.slice(0, 10), `burns if the Polymarket market settles NO, meaning ${not}`,
      (t) => `If the Polymarket market settles NO, meaning ${not}, ${spends(r, t)} once, with a receipt on chain. ${settle} If it settles YES, nothing burns. A voided or cancelled market never counts as a NO, and nothing burns for it.`, oneShotSentence(r, ctx.endsAt), "one-shot");
  }
  if (r.oracle === "polymarket" && r.market) {
    const phrase0 = (ctx.eventPhrase ?? "the market resolves YES").replace(/\s*\(resolves once\)$/, "");
    // L12 (launch audit 5): the name and ticker come from the event's subject and outcome (eventIdentity.ts), never its last word
    const id = eventIdentity(phrase0), phrase = id.verb ? id.phrase : phrase0;
    return build(id.verb && id.confident ? id.name : "Event Coin", id.verb && id.confident ? id.ticker : tickerFrom(id.ticker), `burns if ${phrase}`,
      (t) => ctx.stated ? `If it happens, ${spends(r, t)} once, with a receipt on chain. ${statedSentences(ctx.stated, ctx.stated.finalAfter)} Nothing happens otherwise.` : `If it happens, ${spends(r, t)} once, with a receipt on chain. The result comes from Polymarket's on-chain payout, cross-checked against ${ctx.crossRead ?? "the official result"}. Nothing happens otherwise.`, oneShotSentence(r, ctx.endsAt), "one-shot");
  }
  const what = ctx.eventPhrase ?? r.series ?? r.market ?? "the source";
  const yes = r.kind !== "binary" || !!r.binary?.onYes;
  const once = windowKindOf(r) === "one-shot";
  return build("Event Coin", tickerFrom(what), r.kind === "binary" ? `burns when ${what} settles ${yes ? "YES" : "NO"}` : `burns on each settled reading of ${what}`,
    (t) => `${r.kind === "binary" ? `Each time ${what} settles ${yes ? "YES" : "NO"}` : `Each time ${what} settles`}, ${spends(r, t)}, with a receipt on chain. The result comes from ${r.oracle === "polymarket" ? "Polymarket's on-chain payout" : "its published source"}${ctx.crossRead ? `, cross-checked against ${ctx.crossRead}` : ""}. Nothing happens otherwise.`,
    once ? oneShotSentence(r, ctx.endsAt) : PERPETUAL_SENTENCE, once ? "one-shot" : "recurring");
}

/** The text pieces of a sources-2 publisher's series (null: not one of theirs). */
function sourceText(r: BurnRule, series: string, ctx: DescribeCtx): { name: string; ticker: string; oneLiner: string; block: (t: string) => string; oneShot: boolean } | null {
  const inv = !!r.inverse;
  const wrap = (f: (sp: string) => { name: string; ticker: string; oneLiner: string; block: string; oneShot?: boolean }) => {
    const probe = f("SPENDS");
    return { name: probe.name, ticker: probe.ticker, oneLiner: probe.oneLiner, oneShot: !!probe.oneShot, block: (t: string) => f(spends(r, t)).block };
  };
  if (isFedregEo(series)) return wrap((sp) => fedregEoText(sp, inv));
  const l = parseLl2Series(series); if (l) return wrap((sp) => ll2Text(l, sp, inv, ctx.subjectName ?? null));
  const u = parseUsgsSeries(series); if (u) return wrap((sp) => usgsText(u, sp, inv));
  const g = parseGithubSeries(series); if (g) return wrap((sp) => githubText(g, sp, inv));
  const y = parseYoutubeSeries(series); if (y) return wrap((sp) => youtubeText(y, sp, ctx.subjectName ?? null));
  return null;
}

/**
 * The badge for a registered coin: from its locked rule, with a one-shot's date read back from its own description's window sentence
 * ("Resolves once on Oct 31, 2026") and the end marked once the coin is retired.
 */
export function badgeFromText(r: BurnRule, description: string, retired = false): string {
  // both wordings: "Resolves once on Oct 31, 2026" (coins registered before 2026-10-11) and "This coin resolves once, on Oct 31, 2026"
  const m = /[Rr]esolves once,? on ([A-Z][a-z]{2} \d{1,2}, \d{4})/.exec(description);
  const endsAt = m && !Number.isNaN(Date.parse(`${m[1]} 12:00 UTC`)) ? new Date(Date.parse(`${m[1]} 12:00 UTC`)).toISOString() : null;
  const b = windowBadge(r, { endsAt });
  return retired && !/ENDED/.test(b) ? `${b} · ENDED` : b;
}

/** The championship short code for a league ("WS" for MLB) — the one-shot coin's ticker suffix. */
export const championshipCode = (league: string): string => CHAMP_CODE[league] ?? "CHAMP";
export { LEAGUES };

/** The launch route's description limit (launchBundle.launchProblems; raised from 400 on 10-10 for the window sentence). Every template
 *  stays inside it; the wizard keeps the editable flavour inside what is left. */
export const DESCRIPTION_MAX = 800;
