import { fold, meaningful, nameMatch, queryTokens } from "@/lib/burnticker/textMatch";
import { eventIdentity, titleEntity } from "@/lib/burnticker/eventIdentity";
import type { GammaEvent, GammaMarket } from "@/lib/burnticker/oracle/polymarket";
import { ladderOrder } from "@/lib/burnticker/oracle/outcomeFilter";

/**
 * POLYMARKET IN THE SENTENCE SEARCH (2026-10-10, the owner's $SPIDER case: "spider" landed him on the Any-market regex screen). The old
 * path looked at the FIRST market of each hit event only, so a film that is market 20 of 46 in "Oscars 2027: Best Picture Winner" never
 * surfaced, and "best picture" scored a long event title under the card floor. Now:
 *
 *   phrase / entity   a known event phrase ("best picture", "best director", "oscars", "world series", …) is split off the query; the
 *                     rest is the entity ("spider-man"). Gamma's public search is asked for the whole query, the phrase alone and the
 *                     entity alone (≤ 3 requests, cached by the client), because Gamma itself returns nothing for "spider-man best
 *                     picture" (measured 2026-10-10).
 *   market match      EVERY market of every hit event is read; the entity must name the market's outcome (Gamma groupItemTitle) or its
 *                     question, hyphens / colons / spaces optional ("spiderman" = "Spider-Man"). Best market per event.
 *   event match       an event whose TITLE carries the phrase becomes an event card with an outcome picker (named, active outcomes
 *                     only — placeholders such as "Film E" are never offered); scored off the title, not its first market. When the
 *                     entity names none of its outcomes the card says so in plain words and the nearest entity market ranks next.
 *
 * No prices, odds, volume or liquidity anywhere (venues.ts; the discovery payload scrubber and the renderer lint enforce it).
 */

export interface EventPhrase {
  re: RegExp; search: string; label: string; family: RegExp;
  /** what the picker calls an outcome */ noun: string;
  /** the family's own search word ("oscars"): "spiderman best picture" also asks "spiderman oscars" for the nearest Oscars market */ familySearch?: string;
  /** a family-only query ("oscars") also asks for the flagship category, which Gamma's family search may leave out */ flagshipSearch?: string;
}
const OSCARS = /\b(oscars?|academy awards?)\b/i;
export const EVENT_PHRASES: EventPhrase[] = [
  { re: /\bbest\s+picture\b/i, search: "best picture", label: "Best Picture", family: OSCARS, noun: "film", familySearch: "oscars" },
  { re: /\bbest\s+director\b/i, search: "best director", label: "Best Director", family: OSCARS, noun: "director", familySearch: "oscars" },
  { re: /\bbest\s+(lead\s+)?actress\b/i, search: "best actress", label: "Best Actress", family: OSCARS, noun: "actress", familySearch: "oscars" },
  { re: /\bbest\s+supporting\s+actor\b/i, search: "best supporting actor", label: "Best Supporting Actor", family: OSCARS, noun: "actor", familySearch: "oscars" },
  { re: /\bbest\s+supporting\s+actress\b/i, search: "best supporting actress", label: "Best Supporting Actress", family: OSCARS, noun: "actress", familySearch: "oscars" },
  { re: /\bbest\s+(lead\s+)?actor\b/i, search: "best actor", label: "Best Actor", family: OSCARS, noun: "actor", familySearch: "oscars" },
  { re: /\bbest\s+animated(\s+feature)?\b/i, search: "best animated feature", label: "Best Animated Feature", family: OSCARS, noun: "film", familySearch: "oscars" },
  { re: /\bbest\s+(visual\s+effects|vfx)\b/i, search: "best visual effects", label: "Best Visual Effects", family: OSCARS, noun: "film", familySearch: "oscars" },
  { re: /\bbest\s+(adapted\s+)?screenplay\b/i, search: "best adapted screenplay", label: "Best Adapted Screenplay", family: OSCARS, noun: "film", familySearch: "oscars" },
  { re: OSCARS, search: "oscars", label: "the Oscars", family: OSCARS, noun: "outcome", flagshipSearch: "best picture" },
  { re: /\bgolden\s+globes?\b/i, search: "golden globes", label: "the Golden Globes", family: /\bgolden\s+globes?\b/i, noun: "outcome" },
  { re: /\bemmys?\b/i, search: "emmys", label: "the Emmys", family: /\bemmys?\b/i, noun: "outcome" },
  { re: /\bgrammys?\b/i, search: "grammys", label: "the Grammys", family: /\bgrammys?\b/i, noun: "outcome" },
  { re: /\bballon\s+d.?or\b/i, search: "ballon d'or", label: "the Ballon d'Or", family: /\bballon\s+d.?or\b/i, noun: "player" },
];

export interface SplitQuery { phrase: EventPhrase | null; entity: string; clean: string }
/** The query's event phrase (most specific first) and the entity left over ("spider-man best picture" → Best Picture + "spider-man"). */
export function splitQuery(q: string): SplitQuery {
  const clean = q.replace(/\b(wins?|will|above|over)\b/gi, " ").replace(/\s+/g, " ").trim();
  const phrase = EVENT_PHRASES.find((p) => p.re.test(clean)) ?? null;
  const entity = phrase ? clean.replace(phrase.re, " ").replace(/\b(at|the|in|for)\b/gi, " ").replace(/\s+/g, " ").trim() : clean;
  return { phrase, entity: meaningful(queryTokens(entity)).length ? entity : "", clean };
}
/** The Gamma searches to make (at most four), deduplicated: the whole query, the phrase, the entity, the entity in the phrase's family. */
export function searchQueries(s: SplitQuery): string[] {
  const p = s.phrase;
  const qs = [s.clean, ...(p ? [p.search] : []), ...(p && s.entity ? [s.entity] : []), ...(p?.familySearch && s.entity ? [`${s.entity} ${p.familySearch}`] : []), ...(p?.flagshipSearch ? [p.flagshipSearch] : [])];
  return [...new Set(qs.map((x) => x.trim()).filter(Boolean))].slice(0, 4);
}

const live = (m: GammaMarket) => m.outcomes.length === 2 && !m.closed && !m.inactive && !/^(film|person|player|team|candidate|option)\s+[a-z]$/i.test(m.groupItemTitle ?? "") && !/^other$/i.test(m.groupItemTitle ?? "");
/** An outcome's display name: the event's name for it, else its question without "Will … ?". */
export const outcomeLabel = (m: GammaMarket): string => m.groupItemTitle?.trim() || m.question.replace(/\?$/, "").replace(/^will\s+/i, "");
/** "Will X win Best Picture at …?" → "X wins Best Picture at …" (the card sentence). */
/** The market question as a plain third-person sentence (eventIdentity.ts: subject + conjugated verb + the rest; L12). */
export const plainQuestion = (q: string): string => {
  const t = q.replace(/\?$/, "");
  const id = eventIdentity(t);
  return id.verb ? id.phrase : t.replace(/^will\s+/i, "");
};

const TICKER_SKIP = new Set(["the", "a", "an", "of", "la", "le", "el", "los", "las", "part", "and", "mr", "mrs", "dr", "st"]);
/** A ticker from an outcome: its first distinctive word, uppercased, at most 8 characters ("Spider-Man: Brand New Day" → SPIDER). */
export function outcomeTicker(label: string): string {
  { const te = titleEntity(label.trim()); if (te) return te.toUpperCase().slice(0, 8); }   // HS-12: "Dune: Part Three" is $DUNE3
  const words = fold(label).split(" ").filter((w) => w && !TICKER_SKIP.has(w) && !/^\d+$/.test(w));
  return (words[0] ?? (fold(label).replace(/ /g, "") || "COIN")).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8) || "COIN";
}

export interface MarketMatch { kind: "market"; event: GammaEvent; market: GammaMarket; score: number; inFamily: boolean }
export interface PickerOutcome { label: string; conditionId: string; question: string; yes: string; no: string; ticker: string; /** audit 10 #21: the parent market and its end, so a long list keeps its context */ parent?: string; endsAt?: string | null }
/**
 * A LONG OUTCOME LIST (audit 10 #21, 2026-10-13): filtered by the words typed (label or question, any case or accent), then shown a page at a
 * time with what is left ("Show 24 more"), each outcome keeping its parent market and end date.
 */
export const PICKER_PAGE = 12;
export function pickerPage<T extends Pick<PickerOutcome, "label" | "question">>(outcomes: readonly T[], filter: string | null, shown = PICKER_PAGE): { outcomes: T[]; total: number; more: number; moreLabel: string | null } {
  const f = fold(filter ?? "");
  const hits = f ? outcomes.filter((o) => fold(`${o.label} ${o.question}`).includes(f)) : [...outcomes];
  const list = hits.slice(0, Math.max(1, shown)), more = hits.length - list.length;
  return { outcomes: list, total: hits.length, more, moreLabel: more > 0 ? `Show ${Math.min(more, PICKER_PAGE)} more of ${more}` : null };
}
export interface EventMatch { kind: "event"; event: GammaEvent; outcomes: PickerOutcome[]; score: number; noun: string; note: string | null; phrase: EventPhrase }

const overlapTitle = (tokens: string[], title: string): number => { if (!tokens.length) return 0; const t = new Set(fold(title).split(" ")); return tokens.filter((w) => t.has(w)).length / tokens.length; };

/**
 * Pure: hit events → market matches (entity names an outcome) and event matches (the phrase is in the event title). Scores sit on the
 * universal search's scale (MIN_SCORE 1; elections and teams reach 1.5–3).
 */
export function matchPolymarket(s: SplitQuery, events: readonly GammaEvent[], refuse?: ((titles: string[]) => string[]) | null): { markets: MarketMatch[]; events: EventMatch[] } {
  const seen = new Set<string>();
  const evs = events.filter((e) => !e.closed && !seen.has(e.slug) && (seen.add(e.slug), true) && !(refuse?.([e.title]) ?? []).length);
  const entityTokens = meaningful(queryTokens(s.entity));
  const phraseTokens = s.phrase ? meaningful(queryTokens(s.phrase.search)) : [];
  const titleHasPhrase = (e: GammaEvent) => !!s.phrase && s.phrase.re.test(e.title);
  const inFamily = (e: GammaEvent) => !!s.phrase && s.phrase.family.test(e.title);
  const markets: MarketMatch[] = [];
  if (entityTokens.length) for (const e of evs) {
    let best: MarketMatch | null = null;
    for (const m of e.markets.filter(live)) {
      if (!nameMatch(s.entity, [outcomeLabel(m)], [m.question]).all) continue;
      if ((refuse?.([m.question]) ?? []).length) continue;
      // entity alone 1.6; in the phrase's family (an Oscars event for "oscar") +0.8; the phrase in the title too (the exact ask) +1.2
      const sc = 1.6 + (inFamily(e) ? 0.8 : 0) + (titleHasPhrase(e) ? 1.2 : 0) + (nameMatch(s.entity, [outcomeLabel(m)]).all ? 0.2 : 0);
      if (!best || sc > best.score) best = { kind: "market", event: e, market: m, score: sc, inFamily: inFamily(e) };
    }
    if (best) markets.push(best);
  }
  const eventsOut: EventMatch[] = [];
  if (s.phrase) for (const e of evs) {
    if (!titleHasPhrase(e)) continue;
    const outs = ladderOrder(e.markets.filter(live), outcomeLabel);   // walkthrough 13: a ladder lists by its rung
    if (outs.length < 3) continue;   // a yes/no event is a market card, not a picker
    const entityHere = entityTokens.length > 0 && markets.some((x) => x.event.slug === e.slug);
    if (entityHere) continue;        // the market card already is the exact answer
    // scored off the title: the phrase's words in it, a winner market above nominations, a named category above the family word
    const specific = s.phrase.re !== s.phrase.family;   // a named category ("best picture"), not the family word ("oscars")
    const flagship = !specific && /best picture/i.test(e.title) ? 0.4 : 0;
    const sc = 1.4 + overlapTitle(phraseTokens, e.title) * 0.6 + (/\bwinner\b/i.test(e.title) ? 0.3 : 0) + (specific ? 0.9 : 0) + flagship + (entityTokens.length && specific ? 0.3 : 0);
    const noun = specific ? s.phrase.noun : "outcome";
    const note = entityTokens.length ? `"${s.entity}" is not one of this market's ${noun}s — pick a listed ${noun}, or use the nearest "${s.entity}" market.` : null;
    eventsOut.push({ kind: "event", event: e, outcomes: outs.map((m) => ({ label: outcomeLabel(m), conditionId: m.conditionId, question: m.question, yes: m.outcomes[0] ?? "Yes", no: m.outcomes[1] ?? "No", ticker: outcomeTicker(outcomeLabel(m)), parent: e.title.trim(), endsAt: m.endDate ?? e.endDate ?? null })), score: sc, noun, note, phrase: s.phrase });
  }
  return { markets, events: eventsOut };
}
