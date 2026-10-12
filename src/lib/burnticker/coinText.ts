import type { BurnRule, LockedRule } from "@/lib/burnticker/rules";
import { descriptionFooter } from "@/lib/burnticker/rules";
import { badgeFromText, describeRule, type DescribeCtx } from "@/lib/burnticker/describe";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import { findTeams } from "@/lib/burnticker/sources/espn";

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
export interface CreatorTextProblem { field: "name" | "ticker" | "note"; category: string; rule: string; phrase: string; reason: string }

/** The copy lint over what the creator typed. Empty → clean. */
export function creatorTextProblems(o: { name: string; ticker: string; note: string }): CreatorTextProblem[] {
  const cfg = loadCopyLintConfig();
  const out: CreatorTextProblem[] = [];
  for (const [field, text] of [["name", o.name], ["ticker", o.ticker], ["note", o.note]] as const) {
    if (!text.trim()) continue;
    for (const h of lintCopy(text, cfg, { scope: "creator" }).hits) out.push({ field, category: h.category, rule: h.rule, phrase: h.phrase, reason: `The ${field} "${text.slice(0, 60)}" contains "${h.phrase}", which is not allowed. Rule broken: ${h.category} (${h.why}).` });
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
export function serverDescribeCtx(rule: BurnRule, raw: unknown, o: { seriesTitle: string | null; feed?: { title: string; sourceName: string; unitLabel: string } | null }): Omit<DescribeCtx, "ticker"> {
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
  return out;
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
