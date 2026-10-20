import { withoutDenials } from "@/lib/burnticker/denials";
import type { BurnRule, LockedRule } from "@/lib/burnticker/rules";
import { descriptionFooter } from "@/lib/burnticker/rules";
import { badgeFromText, describeRule, type DescribeCtx } from "@/lib/burnticker/describe";
import { creatorFieldSentence } from "@/lib/burnticker/creatorWording";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import { findTeams, parseEspnSeries, teamByAbbr } from "@/lib/burnticker/sources/espn";

/**
 * THE DESCRIPTION IS GENERATED AND LOCKED (owner decision 2026-10-10, anti-misrepresentation): the launch route ignores any free-text
 * description and writes describe.ts's paragraph for the locked rule — the only description a coin has: the token metadata, the coin
 * page, the card and the first post. The few words a template takes from outside the rule (a market's event phrase, its cross-read,
 * the end date, a game's opponent) are checked here before they reach it. A creator may add a NOTE (≤ 140 characters), stored apart,
 * shown in its own box ("creator's note — not part of the rule"), immutable after launch. The note, the name and the ticker pass the
 * copy lint with the creator scope (config/launch/copy-lint.json: every platform rule plus no-affiliation — official, endorsed,
 * partner…, links and handles); a hit refuses the draft with the category named, nothing is silently stripped.
 */

export const NOTE_MAX = 140;
export interface CreatorTextProblem { field: "name" | "ticker" | "note" | "description" | "link label"; category: string; rule: string; phrase: string; reason: string; /** sources-7 round 2: every category and rule the field's hits fall under (the first are `category` and `rule`) */ categories: string[]; rules: string[] }

/** The copy lint over what the creator typed. Empty → clean. */
export function creatorTextProblems(o: { name: string; ticker: string; note: string; /** website-15 item 13 */ description?: string; linkLabels?: readonly string[] }): CreatorTextProblem[] {
  const cfg = loadCopyLintConfig();
  const out: CreatorTextProblem[] = [];
  const fields: [string, string][] = [["name", o.name], ["ticker", o.ticker], ["note", o.note], ["description", o.description ?? ""], ...(o.linkLabels ?? []).map((l) => ["link label", l] as [string, string])];
  for (const [field, text] of fields as [CreatorTextProblem["field"], string][]) {
    if (!text.trim()) continue;
    // sources-7 round 2 (WIRING-WEBSITE25-REQUESTS H5): ONE plain sentence per field (creatorWording.ts), the one the name step says, never
    // a line per hit with the rule id and a cut quote
    // audit 12 item 9: an explicit denial ("Not affiliated with any team.") is not a claim (denials.ts)
    const hits = lintCopy(withoutDenials(text), cfg, { scope: "creator" }).hits;
    const reason = creatorFieldSentence(field, text, hits);
    if (reason) out.push({ field, category: hits[0].category, rule: hits[0].rule, phrase: [...new Set(hits.map((h) => h.phrase.trim()))].join(", "), reason, categories: [...new Set(hits.map((h) => h.category))], rules: [...new Set(hits.map((h) => h.rule))] });
  }
  return out;
}

const ISO = /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/;
const CROSS_OK = /^(MLB's official results|the NBA's official results|the NHL's official results|the league's official results|the official result|the [A-Z][A-Za-z .]{1,30} certified result)$/;
/**
 * The describe context from the request, checked: an event phrase linted (creator scope, no links) and ≤ 120 characters; a cross-read
 * only from the platform's own phrases; an end date only as an ISO date; a game opponent only a known team nickname. Anything else is
 * dropped and the template's neutral words are used. A feed's title and unit always come from the server's catalogue.
 */
export function serverDescribeCtx(rule: BurnRule, raw: unknown, o: { seriesTitle: string | null; feed?: { title: string; sourceName: string; unitLabel: string; crossRead?: string | null } | null; /** the server's own read of the market (statedCtx); the request's `stated` is never used */ stated?: DescribeCtx["stated"] }): Omit<DescribeCtx, "ticker"> {
  const c = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const out: Omit<DescribeCtx, "ticker"> = {};
  const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() && v.length <= max ? v.trim() : null);
  const phrase = str(c.eventPhrase, 120);
  const fromTitle = o.seriesTitle ? o.seriesTitle.replace(/\s*\(resolves once\)$/, "").replace(/\?$/, "").replace(/^will\s+/i, "").trim() : null;
  const clean = (p: string | null) => (p && lintCopy(p, undefined, { scope: "creator" }).ok ? p : null);
  if (rule.oracle === "polymarket") out.eventPhrase = clean(phrase) ?? clean(fromTitle) ?? null;
  const cross = str(c.crossRead, 60);
  if (cross && CROSS_OK.test(cross)) out.crossRead = cross;
  const ends = str(c.endsAt, 40);
  if (ends && ISO.test(ends) && !Number.isNaN(Date.parse(ends))) out.endsAt = ends;
  const g = c.game as { opponent?: unknown; home?: unknown; startsAt?: unknown } | undefined;
  if (g && typeof g === "object") {
    const opp = str(g.opponent, 40), at = str(g.startsAt, 40);
    if (opp && findTeams(opp).some((t) => t.nickname.toLowerCase() === opp.toLowerCase()) && at && ISO.test(at)) out.game = { opponent: opp, home: g.home === true, startsAt: at };
  }
  if (o.feed) out.feed = o.feed;
  // legitimacy pass fix b: a one-market Polymarket coin keeps Polymarket's stated source and dispute window in its pinned text, so it
  // matches the preview; the words come from the server's own market read, never from the request
  if (rule.oracle === "polymarket" && rule.market && o.stated) out.stated = o.stated;
  return out;
}

/**
 * SIDE B OF A SETTLED-EVENT PAIR (two candidates in one race, two teams in one game): its describe context from ITS OWN event words,
 * never side A's (website-23 found "$ROGEVELSA burns if the Democrats win" for Michigan). `rawB` is the body's `pair.descCtx` (candidate
 * B's market phrase, or team B's game); `seriesTitle` / `stated` are the server's own read of side B's market (or its game series). A
 * one-game side B with no context of its own mirrors side A's game: the opponent is side A's team and home is flipped.
 */
export function sideBDescribeCtx(ruleB: BurnRule, rawB: unknown, rawA: unknown, o: { seriesTitle: string | null; stated?: DescribeCtx["stated"] }): Omit<DescribeCtx, "ticker"> {
  let raw = rawB && typeof rawB === "object" && !Array.isArray(rawB) ? rawB as Record<string, unknown> : null;
  const series = ruleB.pair?.game?.series;
  if (!raw?.game && series && rawA && typeof rawA === "object") {
    const ga = (rawA as { game?: { home?: unknown; startsAt?: unknown } }).game;
    const ea = parseEspnSeries(series[0]);
    const nick = ea ? teamByAbbr(ea.league, ea.abbr)?.nickname ?? null : null;
    if (ga && typeof ga === "object" && nick) raw = { ...(raw ?? {}), game: { opponent: nick, home: ga.home !== true, startsAt: ga.startsAt } };
  }
  return serverDescribeCtx(ruleB, raw, { seriesTitle: o.seriesTitle, ...(o.stated ? { stated: o.stated } : {}) });
}

/**
 * The describe context's `stated` from the server's read of one Polymarket market (oracle/polymarket.ts seriesInfo → polyStated), in
 * the same shape the launch page passes to describeRule. Null when the read carried none (a tag or event series, or no read).
 */
export function statedCtx(summary: { stated?: { resolutionSource: { phrase: string | null; crossRead: { text: string } | null }; finalAfter: { text: string } }; endsAt?: string | null } | null | undefined): NonNullable<DescribeCtx["stated"]> | null {
  const s = summary?.stated;
  if (!s) return null;
  return { phrase: s.resolutionSource.phrase, crossRead: s.resolutionSource.crossRead ? { text: s.resolutionSource.crossRead.text } : null, finalAfter: { text: s.finalAfter.text }, ...(summary?.endsAt ? { endsAt: summary.endsAt } : {}) };
}

/** The generated paragraph for a launch (the registry stores it + the rule footer; see metadataDescription). */
export const generatedParagraph = (rule: BurnRule, ticker: string, ctx: Omit<DescribeCtx, "ticker">): string => describeRule(rule, { ticker, ...ctx }).paragraph;

/** The registry's description: the generated paragraph and the rule footer (feed · rule sha256 · disclaimer), as the bundle writes it. */
export const registeredDescription = (locked: LockedRule, paragraph: string): string => `${paragraph.trim()}${paragraph.trim() ? " " : ""}${descriptionFooter(locked)}`;

/**
 * The token metadata `description`, byte-for-byte what is pinned on Arweave and what the hosted fallback serves: the window badge as the
 * first line ("2026 SEASON", "ONE-SHOT · Oct 31, 2026") — a wallet showing only the start of it still shows the window — then the
 * registered description.
 */
export const metadataDescription = (locked: LockedRule, registered: string, retired = false): string => `${badgeFromText(locked.rule, registered, retired)}\n${registered}`;
