/**
 * NAME MATCHING FOR THE SEARCH BOX (2026-10-10, the owner typed "el sayed" and saw sports cards). Both the query and the indexed names are
 * case-folded, stripped of diacritics, and read with hyphens, apostrophes and periods optional: "el sayed" ≡ "El-Sayed" ≡ "elsayed",
 * "o'neil" ≡ "oneil", "st. louis" ≡ "st louis". A card matches only when EVERY meaningful query token matches one of its name fields —
 * a token of one or two letters ("el", "st") is not meaningful on its own and never surfaces a card by itself; a long token may also
 * match inside a name written as one word ("elsayed" in "Abdul El-Sayed"). Client-safe (no node imports).
 */
const STOP = new Set(["will", "win", "wins", "won", "the", "a", "an", "to", "of", "in", "for", "race", "seat", "election", "be", "beat", "beats", "takes", "take", "vs", "v", "and", "or", "if", "when", "on", "at"]);

/** Case-fold, strip diacritics, drop apostrophes and periods, read hyphens and other punctuation as spaces. */
export const fold = (s: string): string => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/['’.`]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
/** Query tokens (folded, stop words out). */
export const queryTokens = (q: string): string[] => fold(q).split(" ").filter((w) => w && !STOP.has(w));
/** Tokens that may surface a card: three or more characters, or digits (a year, a district, a threshold). */
export const meaningful = (tokens: readonly string[]): string[] => tokens.filter((w) => w.length >= 3 || /^\d+$/.test(w));

/**
 * Does one query token match a field (folded)? A whole-word match; a 2-letter token only next to a matched neighbour (checked by the
 * caller); a long token (≥ 5) also as CONSECUTIVE WHOLE WORDS written as one ("elsayed" = "el sayed", "spiderman" = "spider man") —
 * never a substring that runs across a word boundary ("oscars" is not "John OSCAR Salvesen": the live miss of 2026-10-10).
 */
function tokenIn(t: string, field: string): boolean {
  const words = field.split(" ");
  if (words.includes(t)) return true;
  if (t.length >= 5) for (let i = 0; i < words.length; i++) { let acc = ""; for (let j = i; j < words.length && acc.length < t.length; j++) { acc += words[j]; if (acc === t) return true; } }
  return false;
}

/**
 * How well a query names a card: `all` when every query token (short ones included) is found across the name fields and the context
 * fields together, with at least one MEANINGFUL token in a name field; `nameHits` = meaningful tokens found in the name fields.
 * A query whose tokens are all short ("el", "el s") matches nothing.
 */
export function nameMatch(q: string, nameFields: readonly string[], contextFields: readonly string[] = []): { all: boolean; nameHits: number; tokens: number } {
  const qt = queryTokens(q), mt = meaningful(qt);
  if (!mt.length) return { all: false, nameHits: 0, tokens: qt.length };
  const names = nameFields.map(fold).filter(Boolean), ctx = contextFields.map(fold).filter(Boolean);
  const inName = (t: string) => names.some((f) => tokenIn(t, f));
  const inAny = (t: string) => inName(t) || ctx.some((f) => tokenIn(t, f));
  const nameHits = mt.filter(inName).length;
  // a short token must sit in the same name field as a meaningful token ("el" with "sayed" in "abdul el sayed"), never alone
  const shortOk = qt.filter((t) => !mt.includes(t)).every((t) => names.some((f) => f.split(" ").includes(t) && mt.some((m) => tokenIn(m, f))));
  return { all: nameHits > 0 && mt.every(inAny) && shortOk, nameHits, tokens: qt.length };
}

/** A query that reads like a person's name: two or three word tokens, no digits, no sport / league / weather / economy word. */
export function looksLikePerson(q: string): boolean {
  const t = fold(q).split(" ").filter(Boolean);
  if (t.length < 2 || t.length > 4 || t.some((w) => /\d/.test(w))) return false;
  return !t.some((w) => /^(win|wins|lose|loses|game|games|season|series|world|cup|league|nfl|nba|mlb|nhl|wnba|mls|soccer|football|baseball|basketball|hockey|high|rain|snow|temp|debt|cpi|inflation|launch|vs)$/.test(w));
}
