/**
 * HS-57 (hourly run 14): the market search said nothing when nothing matched. "zzqxv nothing here" listed eight tennis and Costa Rican
 * soccer events because "here" matched "Herediano", and "2024 presidential election" listed the 2027 elections with no word that the
 * 2024 market is closed. The page now matches on the query's CONTENT words (stop words such as "here", "nothing", "the", "will" never
 * count): a hit that contains none of them is dropped, and when no hit contains every one, a line above the list says so. HB-165 (hourly
 * run 15): a pasted id, slug or ticker that names a hit always lists it; a one-word query also matches with spaces taken out and on
 * initials; the list is no longer dimmed, and "closed" is said only when the server marked the matching markets closed. Pure and
 * client-safe.
 */
export const SEARCH_STOP_WORDS: ReadonlySet<string> = new Set([
  "a", "an", "the", "of", "in", "on", "at", "to", "for", "from", "by", "with", "and", "or", "but", "is", "are", "was", "be", "been", "will",
  "would", "can", "could", "does", "do", "did", "it", "its", "this", "that", "these", "those", "there", "here", "nothing", "anything",
  "something", "any", "some", "who", "what", "which", "when", "where", "how", "why", "vs", "v", "me", "my", "i", "we", "you", "your",
  "about", "into", "than", "then", "next", "coin", "coins", "market", "markets",
]);
import { outcomeText } from "@/lib/burnticker/oracle/outcomeFilter";

const norm = (s: string): string => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[’']/g, "");
/** The query's content words: lowercased, accents and apostrophes dropped, stop words and one-letter words left out, each once. */
export function contentWords(query: string): string[] {
  const out: string[] = [];
  for (const w of norm(query).split(/[^a-z0-9]+/)) if (w.length >= 2 && !SEARCH_STOP_WORDS.has(w) && !out.includes(w)) out.push(w);
  return out;
}
/**
 * HB-165 (hourly run 15): a hit as the page hands it over: the texts a reader sees (title, subtitle, outcome names), the ids a pasted
 * query can name exactly (a Polymarket condition id or event slug, a Kalshi ticker), and whether the server marked it closed. A plain
 * array is texts only (the run-14 shape).
 */
export interface SearchHit { texts: readonly (string | null | undefined)[]; ids?: readonly (string | null | undefined)[]; closed?: boolean }
type HitIn = SearchHit | readonly (string | null | undefined)[];
const asHit = (h: HitIn): SearchHit => (Array.isArray(h) ? { texts: h as readonly (string | null | undefined)[] } : h as SearchHit);
const squash = (s: string): string => norm(s).replace(/[^a-z0-9]+/g, "");
/** The first letters of a text's words ("Alexandria Ocasio-Cortez" gives "aoc"). */
const acronym = (s: string): string => norm(s).split(/[^a-z0-9]+/).filter(Boolean).map((w) => w[0]).join("");
const strs = (xs: readonly (string | null | undefined)[]): string[] => xs.filter((t): t is string => typeof t === "string" && !!t);
/** Whether the query names one of the hit's ids exactly (a pasted condition id, an event slug, a ticker). */
export function exactHit(query: string, h: HitIn): boolean {
  const q = query.trim().toLowerCase();
  return !!q && strs(asHit(h).ids ?? []).some((id) => id.trim().toLowerCase() === q);
}
/**
 * How many of `words` a hit contains: a word counts when one of the texts contains it. A query of one content word also matches inside
 * the texts and ids with spaces and dashes taken out ("superbowl" finds "Super Bowl" or a slug "super-bowl-lx") and, from three letters,
 * the first letters of a text's words ("aoc" finds "Alexandria Ocasio-Cortez").
 */
export function wordsMatched(words: readonly string[], texts: readonly (string | null | undefined)[], ids: readonly (string | null | undefined)[] = []): number {
  const ts = strs(texts);
  const hay = ts.map(norm).join(" \u0000 ");
  const plainHits = words.filter((w) => hay.includes(w)).length;
  if (words.length !== 1 || plainHits === 1) return plainHits;
  const w = words[0];
  if ([...ts, ...strs(ids)].some((t) => squash(t).includes(w))) return 1;
  if (w.length >= 3 && ts.some((t) => acronym(t).includes(w))) return 1;
  return 0;
}
export interface SearchMatch {
  /** the query's content words (empty: the query is all stop words, and nothing is filtered or said) */ words: string[];
  /** an open hit contains every content word, or the query names a hit exactly */ full: boolean;
  /** at least one hit contains a content word, or the query names a hit exactly */ any: boolean;
  /** the line above the results, or null when an open hit matches every word */ line: string | null;
  /** dim the whole list: never since HB-165 (only a hit that shares no content word would be dimmed, and such a hit is not listed) */ dim: boolean;
}
/** The server marked every hit that matches every word closed. */
export const closedMatchLine = (query: string): string => `The markets that match “${query.trim()}” are closed, and closed markets are not listed. Here are the closest open ones:`;
/** Some hits share words with the query, none shares all of them: say only that nothing open matched. */
export const noFullMatchLine = (query: string): string => `No open market matches “${query.trim()}”. Here are the closest open ones:`;
export const noMatchLine = (query: string): string => `No open market matches “${query.trim()}”. Try a team, a candidate, a film or a city.`;
/** The search's verdict over every hit (its texts, its ids and whether the server marked it closed). */
export function searchMatch(query: string, hitsIn: readonly HitIn[]): SearchMatch {
  const words = contentWords(query);
  const hits = hitsIn.map(asHit);
  if (!hits.length) return { words, full: true, any: false, line: null, dim: false };
  // HB-165: a pasted condition id, an event slug or a ticker that names a hit lists it as it is, with nothing said above it
  if (!words.length || hits.some((h) => exactHit(query, h))) return { words, full: true, any: true, line: null, dim: false };
  const counts = hits.map((h) => wordsMatched(words, h.texts, h.ids));
  const fullHits = hits.filter((_, i) => counts[i] === words.length), any = counts.some((n) => n > 0);
  const openFull = fullHits.some((h) => !h.closed);
  // HB-165: the "closed" sentence only when the server marked every full match closed; otherwise only that nothing open matched
  const line = openFull ? null : fullHits.length ? closedMatchLine(query) : any ? noFullMatchLine(query) : noMatchLine(query);
  return { words, full: openFull, any, line, dim: false };
}
/** Whether one hit stays listed: the query names it exactly, it contains at least one content word, or the query has none. */
export const keepHit = (words: readonly string[], texts: readonly (string | null | undefined)[], o: { query?: string; ids?: readonly (string | null | undefined)[] } = {}): boolean =>
  !words.length || (o.query !== undefined && exactHit(o.query, { texts, ids: o.ids })) || wordsMatched(words, texts, o.ids ?? []) > 0;

/**
 * HB-111 widened (hourly run 14): each outcome button of a market search result is named by its outcome and its action ("Lando Norris:
 * burn if this resolves YES"), so a screen reader hears which outcome a button picks; the visible text is unchanged.
 */
export function outcomeButtonLabel(m: { outcome?: string | null; question?: string | null; closed?: boolean | null }): string {
  // HB-160 (hourly run 15): a ladder outcome is named in words ("Dips to $5,000"), never by Gamma's arrow label
  const name = outcomeText(m) || "This market";
  if (m.closed) return `${name}: closed`;
  const action = m.outcome ? (/\bwins?\b|winner/i.test(m.question ?? "") ? "burn if this one wins" : "burn if this resolves YES") : "burn on this market";
  return `${name}: ${action}`;
}
