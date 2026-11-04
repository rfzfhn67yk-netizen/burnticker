import type { TickerCheck } from "@/lib/burnticker/tickerCheck";
import { lookalikeHits, type LookalikeExisting } from "@/lib/burnticker/lookalike";
import { pairTickers } from "@/lib/burnticker/guidedLaunch";
import { hazardAlternateName } from "@/lib/burnticker/hazards";
import type { BurnRule } from "@/lib/burnticker/rules";

// Client-safe (no node imports): the launch page reads it. tickerCheck.ts itself reads the reserved list from disk.

/** HB-30: the side's check refuses its ticker (held, reserved or a lookalike of another coin's). */
export const tickerRefused = (t: Pick<TickerCheck, "taken" | "reserved" | "lookalike">): boolean => t.taken || t.reserved || !!t.lookalike;

/**
 * HB-30 (continuous audit run 3): the wizard never leaves a GENERATED ticker on screen that its own check refuses. For every side whose
 * shown ticker is still the generated one (`auto`) and is refused, the first free ticker the check offers (the server's own suggestion
 * from the rule, else the next free variant). A side the creator typed is left alone: its refusal and free tickers are shown instead.
 */
export function autoTickerSwaps(checks: readonly TickerCheck[] | null | undefined, shown: { a: string; b: string }, auto: boolean): { a?: string; b?: string } {
  const out: { a?: string; b?: string } = {};
  if (!auto) return out;
  for (const t of checks ?? []) {
    const key = t.side === "A" ? "a" : "b", now = shown[key].toUpperCase();
    if (now && t.ticker === now && tickerRefused(t) && t.suggestions[0] && t.suggestions[0] !== now) out[key] = t.suggestions[0];
  }
  return out;
}

/** HB-30: the lead of a field's free-ticker row; on a two-coin draft it names the field, so each row belongs to one coin. */
export const freeRowLead = (side: "A" | "B", ticker: string, many: boolean): string =>
  many ? `Free tickers for Coin ${side} in place of $${ticker.toUpperCase()}:` : "Free tickers:";

/**
 * B-12 (sixth-pass audit, WZ6-1): what the page knows about the tickers already in use before it fills in a generated pair. `existing`
 * holds every launched coin's ticker (the rows the review's check reads); `reserved` is the platform's reserved-name test when the caller
 * has it (reservedNames.ts reads a file, so the page passes its own copy or leaves it out and the review's swap catches a reserved one).
 */
export interface TickerGuard { existing: readonly LookalikeExisting[]; reserved?: ((ticker: string) => boolean) | null; creator?: string | null }

/** B-12: whether the review's check would refuse this ticker (held by another coin, one letter from one, the platform's name, or reserved). */
export const guardRefuses = (ticker: string, g: TickerGuard): boolean =>
  !/^[A-Z0-9]{2,10}$/.test(ticker) || !!g.reserved?.(ticker) || lookalikeHits({ ticker, name: "", creator: g.creator ?? null }, g.existing).some((h) => h.field === "ticker");

const TEAM_WORDS = ["FANS", "CLUB", "CREW", "HQ", "SQUAD", "GANG"] as const;
type TeamCode = { abbr: string; code?: string | null };
const tcode = (t: TeamCode): string => (t.code ?? t.abbr).toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * B-12: the generated tickers one side of a two-team pair may take, best first: the matchup ticker the server generates ($DENVLAL, as
 * meetingsPairNames gives it), the matchup from shorter codes, the team words on the side's own code ($DENFANS) and on the matchup
 * ($DENLALFANS), then digit endings on the matchup ($DENVLAL2). Every one is 2 to 10 letters or digits.
 */
export function pairTickerCandidates(x: TeamCode, y: TeamCode): string[] {
  const cx = tcode(x) || "TEAM", cy = tcode(y) || "TEAM", main = pairTickers(cx, cy).a, out: string[] = [];
  const add = (t: string) => { if (/^[A-Z0-9]{2,10}$/.test(t) && !out.includes(t)) out.push(t); };
  add(main);
  add(`${cx.slice(0, 3)}V${cy.slice(0, 3)}`);
  add(`${cx.slice(0, 4)}V${cy.slice(0, 2)}`);
  for (const w of TEAM_WORDS) add(`${cx.slice(0, 10 - w.length)}${w}`);
  for (const w of TEAM_WORDS) add(`${cx.slice(0, 3)}${cy.slice(0, 3)}${w}`.slice(0, 10));
  for (let k = 2; k <= 9; k++) add(`${main.slice(0, 9)}${k}`);
  return out;
}

/**
 * B-12: the two GENERATED tickers of a two-team pair, checked before the page fills them in. Each side keeps its matchup ticker when no
 * coin holds it or one like it; otherwise it takes the first free candidate (pairTickerCandidates), never the other side's ticker.
 * `swapped` says which sides moved, so the name step can say so. A ticker the creator typed never comes here: the page calls this only
 * while its tickers are still the generated ones. With no guard, the matchup tickers as they are (the review's swap still applies).
 */
export function freePairTickers(x: TeamCode, y: TeamCode, guard?: TickerGuard | null): { a: string; b: string; swapped: { a: boolean; b: boolean } } {
  const m = pairTickers(tcode(x) || "TEAM", tcode(y) || "TEAM");
  // the full candidate list only when the matchup ticker cannot stay (most pairs keep it)
  const side = (main: string, p: TeamCode, q: TeamCode, not: string | null): string => {
    if (main !== not && (!guard || !guardRefuses(main, guard))) return main;
    const cands = pairTickerCandidates(p, q);
    return cands.find((t) => t !== not && (!guard || !guardRefuses(t, guard))) ?? cands.find((t) => t !== not) ?? main;
  };
  const a = side(m.a, x, y, null), b = side(m.b, y, x, a);
  return { a, b, swapped: { a: a !== m.a, b: b !== m.b } };
}

/** B-12: said on the name step when a generated ticker was replaced before it was shown; the creator can still type their own. */
export const pairTickerSwapLine = (from: string, to: string): string =>
  `$${from.toUpperCase()} is taken or too close to another coin's ticker, so this coin starts as $${to.toUpperCase()}. You can change it.`;

/**
 * HB-117 (run 10): said on the name step when a single coin's generated ticker was refused by the review and swapped for a free one (a
 * natural-disaster coin's hazard word: $NEXTM6 to $QUAKENXTM6). When the generated name moved with it, the line names the new name too.
 */
export const hazardSwapLine = (from: string, to: string, name: string | null): string =>
  name
    ? `$${from.toUpperCase()} is taken or too close to another coin's ticker, so this coin starts as $${to.toUpperCase()}, named "${name}". You can change both.`
    : pairTickerSwapLine(from, to);

const TEAM_WORD_TEXT: Record<(typeof TEAM_WORDS)[number], string> = { FANS: "Fans", CLUB: "Club", CREW: "Crew", HQ: "HQ", SQUAD: "Squad", GANG: "Gang" };

/**
 * HB-170 (seventh pass B-21, HB-86 reopened): when a team coin's generated ticker is taken and swapped for a team-word ticker
 * ($PHINFLWIN to $PHINFLFANS), the generated name moves with it, so the copy does not keep the live coin's name: "Eagles 2026 Wins"
 * becomes "Eagles Fans 2026 Wins". The word goes before the year when the name has one, else before a closing Win, Wins, Loss, Losses
 * or Lose, else at the end. Null when the new ticker adds no team word (a digit ending keeps the name, and the review says so).
 */
export function teamWordName(name: string, from: string, to: string): string | null {
  const f = from.toUpperCase(), t = to.toUpperCase(), n = name.trim();
  if (!n || f === t) return null;
  const word = TEAM_WORDS.find((w) => t.endsWith(w) && !f.endsWith(w));
  if (!word) return null;
  const text = TEAM_WORD_TEXT[word];
  if (new RegExp(`\\b${text}\\b`, "i").test(n)) return null;
  const parts = n.split(/\s+/);
  let at = parts.findIndex((p) => /^(19|20)\d\d([–-]\d\d)?$/.test(p));   // WZ8-3: a split season ("2026–27") is a year too
  if (at < 1 && parts.length > 1 && /^(win|wins|loss|losses|lose)$/i.test(parts[parts.length - 1])) at = parts.length - 1;
  if (at < 1) at = parts.length;
  return [...parts.slice(0, at), text, ...parts.slice(at)].join(" ");
}

/** Continuous audit HB-6: a coin on a team's games (the team words fit it), read from its rule. Client-safe; tickerCheck.ts re-exports it. */
export function isTeamRule(rule: unknown): boolean {
  const r = rule && typeof rule === "object" ? (rule as Partial<BurnRule>) : null;
  if (!r) return false;
  if (r.oracle === "catalogue" && typeof r.series === "string" && /^espn\./.test(r.series)) return true;
  return r.oracle === "kalshi" && /^-[A-Z0-9]{2,5}$/.test(r.filter?.tickerIncludes ?? "");
}

/**
 * HB-207 / HS-102 (ninth pre-launch audit, B-21): the name that goes with a swapped ticker, the same on the server's review and on the
 * launch page. A hazard coin takes the hazard word's own name ("Next Magnitude 6 Quake" for $QUAKENXTM6); a team coin takes the team word
 * into its name ("Eagles Fans 2026 Wins" for $PHINFLFANS); any other coin keeps its own event name, so null is returned and the caller
 * keeps the name it has. The held coin's name is never the answer for a team or hazard swap.
 */
export function pairedSwapName(rule: Pick<BurnRule, "oracle" | "series"> | null | undefined, from: { ticker: string; name: string }, to: string): string | null {
  if (!to || !from.name || to.toUpperCase() === from.ticker.toUpperCase()) return null;
  const hz = hazardAlternateName(rule?.series, from, to);
  if (hz) return hz;
  return isTeamRule(rule) ? teamWordName(from.name, from.ticker, to) : null;
}
