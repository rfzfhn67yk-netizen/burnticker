import type { EspnTeam, LeagueId } from "@/lib/burnticker/sources/espn";
import { meaningful, queryTokens } from "@/lib/burnticker/textMatch";

/**
 * WHAT A TEAM QUERY ASKS FOR BEYOND "EVERY WIN" (ChatGPT launch-intent audit, items 6 to 9, 2026-10-12). A team coin follows one
 * condition: every win (or loss, or draw) of one team in a window. Four kinds of query ask for something else, and each used to come back
 * as a plain per-win card with no word about it:
 *
 *   6  two conditions joined by "and", "but", "while", "plus" or "&" ("Lakers win and Celtics lose"): the cards follow the first clause
 *      that names a team, and every card is labelled a partial alternative with a sentence that names the part left out
 *   7  a number of wins or games ("Lakers win 10 games this season"): no rule waits for a count, so the per-win cards are alternatives
 *   8  the regular season only ("exclude playoffs"): no team window leaves the playoffs out, so the cards are alternatives (leagues with no
 *      playoffs, such as the European soccer leagues, already count only league games, and nothing is said)
 *   9  a women's team ("Arsenal Women"): a women's league team is preferred when one is covered; otherwise the men's team's cards are
 *      alternatives with a sentence saying the women's team is not covered
 *
 * Pure; the sentences are page copy (test/burntickerPlainCopy.test.ts) and are exported so the launch page can show them as given.
 */

const CONJ = /\s*(?:\band also\b|\bas well as\b|\band\b|\bbut\b|\bwhile\b|\bplus\b|&)\s*/i;
/** A query split at its conjunctions, with any team name that itself holds one ("Brighton & Hove Albion") kept whole. */
export function clausesOf(q: string, teams: readonly EspnTeam[]): string[] {
  const keep: string[] = [];
  let masked = q;
  for (const t of teams) for (const k of [t.name, ...t.alt]) {
    if (!k || !CONJ.test(` ${k} `)) continue;
    const i = masked.toLowerCase().indexOf(k.toLowerCase());
    if (i < 0) continue;
    const orig = masked.slice(i, i + k.length);
    masked = `${masked.slice(0, i)}\u0000${keep.length}\u0000${masked.slice(i + k.length)}`;
    keep.push(orig);
  }
  return masked.split(CONJ).map((p) => p.replace(/\u0000(\d+)\u0000/g, (_m, n) => keep[Number(n)]).trim().replace(/^[,;.]+|[,;.]+$/g, "").trim()).filter(Boolean);
}

export interface Compound { kept: string; dropped: string[] }
/**
 * Item 6: the clause the cards follow and the clauses left out, or null when the query holds one condition. `names(clause)` says whether
 * a clause names a team. A clause with no word of three letters or more ("a", "to") is not a condition.
 */
export function compoundOf(q: string, teams: readonly EspnTeam[], names: (clause: string) => boolean): Compound | null {
  const parts = clausesOf(q, teams).filter((p) => meaningful(queryTokens(p)).length > 0);
  if (parts.length < 2) return null;
  const k = parts.findIndex(names);
  if (k < 0) return null;
  return { kept: parts[k], dropped: parts.filter((_p, i) => i !== k) };
}
const quoteList = (xs: readonly string[]): string => { const q = xs.map((x) => `“${x}”`); return q.length <= 2 ? q.join(" and ") : `${q.slice(0, -1).join(", ")} and ${q[q.length - 1]}`; };
export const compoundSentence = (c: Compound): string =>
  `A coin follows one condition, so ${quoteList(c.dropped)} ${c.dropped.length === 1 ? "is" : "are"} left out. These cards follow only “${c.kept}”, so each is a partial alternative.`;

/** Item 7: the count a query asks a team to reach ("win 10 games", "50 wins"), or null. "The next 5 games" is a window, not a count. */
export function milestoneOf(q: string): number | null {
  const m = /\b(?<!next\s)(?<!last\s)(?<!first\s)(\d{1,3})\s*\+?\s*(?:more\s+)?(?:games?|wins|win|victories|matches|losses|times)\b/i.exec(q);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 2 ? n : null;
}
export const milestoneSentence = (n: number, outcome: "win" | "loss" | "draw"): string => {
  const noun = outcome === "loss" ? "losses" : outcome === "draw" ? "draws" : "wins", one = outcome === "loss" ? "loss" : outcome === "draw" ? "draw" : "win";
  return `There is no rule that waits for a team to reach a number of ${noun}, such as ${n} ${noun}. This card burns on every ${one} instead, so it is an alternative.`;
};

/** Item 8: the query asks for the regular season only. */
export const regularSeasonOnly = (q: string): boolean => /\bregular[- ]season\b/i.test(q) || /\b(?:exclud\w*|without|no|not|skip\w*|leave out|leaving out)\s+(?:the\s+|any\s+)?(?:playoffs?|postseason|post-season)\b/i.test(q);
export const REGULAR_SEASON_SENTENCE = "There is no team rule that leaves out the playoffs. This card also counts playoff games, so it is an alternative.";

/** Item 9: the query names a women's team. */
export const asksWomen = (q: string): boolean => /\b(?:women|women's|womens|woman|ladies|wfc|girls)\b/i.test(q);
export const WOMEN_LEAGUES: readonly LeagueId[] = ["wnba", "wcbb", "usa.nwsl"];
export const isWomenLeague = (league: LeagueId): boolean => WOMEN_LEAGUES.includes(league);
export const womenSentence = (club: string): string => `Burnticker does not cover the women's team of ${club}. These cards are for the men's team, so each is an alternative.`;
