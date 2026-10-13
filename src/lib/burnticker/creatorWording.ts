/**
 * ONE SENTENCE PER FIELD FOR THE CREATOR'S OWN TEXT (sources-7 round 2, WIRING-WEBSITE25-REQUESTS H5). The copy lint's creator-scope hits
 * for one field (src/lib/launch/copyLint.ts lintCopy, or the launch page's in-browser copy of it) said as one plain sentence: no rule ids,
 * each word once in the order typed, the reasons once each, and a link or @handle said as a link problem. Client-safe and pure: the server
 * (coinText.ts creatorTextProblems, so the review, the bundle and the API) and the name step (website-25 fieldChecks.ts fieldRuleSentence,
 * which this mirrors word for word) say the same sentence, so the page can drop the server's copy of a sentence it already showed.
 */
export interface WordingHit { phrase: string; category: string; rule: string; index: number }
export type WordingField = "name" | "ticker" | "note" | "description" | "link label";

/** What each kind of word does wrong, in plain words (each clause passes the copy lint itself). */
export const CATEGORY_WHY: Record<string, string> = {
  "price-returns": "talk about what the coin is worth",
  promises: "make promises",
  "calls-to-buy": "urge people to trade it",
  urgency: "rush anyone",
  "hype-punctuation": "use hype symbols or rows of exclamation marks",
  "no-prizes": "suggest that anyone is paid",
  "no-affiliation": "claim a tie to anyone",
};

const list = (xs: string[], last: string): string => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} ${last} ${xs[xs.length - 1]}`);
const shown = (h: WordingHit): string => (h.rule === "exclamation" ? "three exclamation marks" : `“${h.phrase.trim()}”`);

/** The one sentence for one field, or null when the field is clean. */
export function creatorFieldSentence(field: WordingField, text: string, hits0: readonly WordingHit[]): string | null {
  if (!text.trim() || !hits0.length) return null;
  const hits = [...hits0].sort((a, b) => a.index - b.index || a.rule.localeCompare(b.rule));
  const links = hits.filter((h) => h.rule === "link");
  const keyOf = (h: WordingHit) => (h.rule === "exclamation" ? "!" : h.phrase.trim().toLowerCase());
  const words: WordingHit[] = [], seen = new Set<string>();
  for (const h of hits) {
    if (h.rule === "link") continue;
    const k = keyOf(h);
    if (seen.has(k)) continue;
    // a phrase inside a link already said (".com" inside a URL) is not said again
    if (links.some((l) => h.index >= l.index && h.index < l.index + l.phrase.length)) continue;
    seen.add(k); words.push(h);
  }
  const whys = [...new Set(hits.filter((h) => h.rule !== "link" && seen.has(keyOf(h))).map((h) => CATEGORY_WHY[h.category] ?? "break the site's wording rules"))];
  const short = field === "name" || field === "ticker" || field === "link label";
  if (!words.length) return short ? `The ${field} cannot have a link or an @handle.` : `The ${field} cannot have links or @handles, which go in the X, Telegram and website fields.`;
  const linkPart = links.length ? (short ? " or have a link" : " or have links") : "";
  const linkWhy = links.length && !short ? ", and links go in the X, Telegram and website fields" : "";
  return `The ${field} cannot use ${list(words.map(shown), "or")}${linkPart}, because a coin's own text cannot ${list(whys, "or")}${linkWhy}.`;
}
