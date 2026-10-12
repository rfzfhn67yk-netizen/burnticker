import type { BurnRule } from "@/lib/burnticker/rules";
import { TEAM_ALIASES, type TeamAlias } from "@/lib/burnticker/oracle/events";
import { describeRule } from "@/lib/burnticker/describe";

/**
 * THE COIN CARD'S ONE-LINER (2026-10-10): the few words a launchpad card has room for — "burns when the Eagles lose" — derived from
 * the locked rule, never typed by the creator, so the card cannot say more than the rule does. The full statement (ruleStatement) stays
 * on the coin page's rule card. Pure; runs on the server (tokenPage.ts) and in tests.
 *
 *   team coin   Kalshi "…GAME" series + the team's own-leg filter "-PHI"      → burns when the Eagles lose / win
 *   one game    a Kalshi game leg "KXNFLGAME-26OCT11PHIJAC-PHI"                → burns if the Eagles lose / win this game
 *   binary      any other Kalshi / Polymarket binary selector                  → burns when <title> settles YES / NO
 *   scalar      a settled number counted in units                              → burns for every <unit> above / below <baseline> (<title>)
 *   feed        a first-party catalogue feed                                   → burns on the <title> feed
 */

const teamOf = (series: string | null, abbr: string, aliases: readonly TeamAlias[]): TeamAlias | null => aliases.find((a) => a.series === series && a.abbr === abbr) ?? null;
const sideWord = (b: NonNullable<BurnRule["binary"]>): "win" | "lose" | "both" => (b.onYes && b.onNo ? "both" : b.onYes ? "win" : "lose");

/**
 * NO BURN POOL IS EVER LEFT BEHIND (2026-10-10; rules.ts onEnd): a one-shot at 100 % reads "burns everything if X. If not, the pool
 * burns down over four weeks after <end date>". `endDate` is the one-shot's settlement / void date when known.
 */
export function oneShotAllLiner(rule: BurnRule, event: string, endDate: string | null = null): string | null {
  const m = rule.kind === "binary" && rule.binary ? rule.binary.onYes ?? rule.binary.onNo : null;
  if (!m || (m.fractionOfPool ?? 0) < 1 || !(rule.market !== null || (rule.derby?.selector === "coinvs" && rule.derby.flip))) return null;
  const weeks = rule.onEnd ? (rule.onEnd.windDownDays === 28 ? "four weeks" : `${rule.onEnd.windDownDays} days`) : null;
  return `burns everything if ${event}${weeks ? `. If not, the pool burns down over ${weeks} after ${endDate ?? "it settles"}` : ""}`;
}

export function ruleOneLiner(rule: BurnRule, seriesTitle: string | null = null, aliases: readonly TeamAlias[] = TEAM_ALIASES, endDate: string | null = null): string {
  const title = (seriesTitle ?? "").trim();
  const all = oneShotAllLiner(rule, title || rule.market || rule.series || "the event", endDate ?? rule.pair?.voidBy ?? null);
  if (all) return all;
  if (rule.oracle === "catalogue" && rule.series && /^(espn|nws)\./.test(rule.series)) { try { return describeRule(rule, { ticker: "COIN" }).oneLiner; } catch { /* an unknown team or station: the generic line */ } }
  if (rule.oracle === "catalogue") return `burns on the ${title || rule.series} feed`;
  // Burn Derby (2026-10-10): the input is another coin's (or asset's) move — named as the rule's input, never this coin's.
  if (rule.oracle === "derby" && rule.derby) {
    const d = rule.derby, every = (w: string) => (w === "weekly" ? "week" : "day");
    if (d.selector === "coinvs") {
      const [win, lose] = rule.binary?.onNo && !rule.binary.onYes ? [d.b.symbol, d.a.symbol] : [d.a.symbol, d.b.symbol];
      return d.flip ? (win === d.a.symbol ? `burns once if ${d.a.symbol}'s market cap passes ${d.b.symbol}'s` : `burns once if ${d.a.symbol}'s market cap never passes ${d.b.symbol}'s`) : `burns every ${every(d.window)} ${win} out-gains ${lose}`;
    }
    if (d.selector === "price") return `burns per ${rule.scalar?.unit ?? "?"}% ${d.u.symbol} ${rule.scalar?.direction === "down" ? "falls" : "rises"} each ${every(d.window)}`;
    return `burns on ${d.underlying.symbol}'s winning days in bracket ${d.tournamentId}`;
  }
  if (rule.kind === "binary" && rule.binary) {
    const side = sideWord(rule.binary);
    if (rule.oracle === "kalshi") {
      // team coin: every game of a team in a head-to-head series
      const leg = /^-([A-Z0-9]{2,5})$/.exec(rule.filter?.tickerIncludes ?? "");
      if (!rule.market && leg) {
        const t = teamOf(rule.series, leg[1], aliases);
        if (t) return side === "both" ? `burns on every ${t.nickname} game` : `burns when the ${t.nickname} ${side}`;
      }
      // one game: a team's own leg of one game market
      if (rule.market) {
        const parts = rule.market.split("-");
        const t = parts.length >= 3 ? teamOf(parts[0], parts[parts.length - 1], aliases) : null;
        if (t) return side === "both" ? `burns on the ${t.nickname} game` : `burns if the ${t.nickname} ${side} this game`;
      }
    }
    const what = title || rule.market || rule.series || "the market";
    if (side === "both") return `burns when ${what} settles`;
    return `burns when ${what} settles ${side === "win" ? "YES" : "NO"}`;
  }
  if (rule.kind === "scalar" && rule.scalar) {
    const s = rule.scalar;
    const dir = s.direction === "up" ? "above" : s.direction === "down" ? "below" : "away from";
    const base = s.baseline === "previousSettlement" ? "the last settlement" : String(s.baseline);
    return `burns for every ${s.unit} ${dir} ${base}${title ? ` (${title})` : ""}`;
  }
  return "burns on a settled result";
}

const pctText = (f: number) => `${Math.round(f * 1000) / 10}%`;
const mapWords = (m: { fractionOfPool?: number; tokens?: number } | null | undefined, ticker: string): string =>
  !m ? "burns nothing" : m.tokens !== undefined ? `burns ${m.tokens.toLocaleString("en-US")} $${ticker} from its vesting vault` : `spends ${pctText(m.fractionOfPool ?? 0)} of its burn pool buying $${ticker} back with its own trading fees and burns it`;

/**
 * The review screen's plain sentence for ANY rule (the team flow has its own, wizard.ts teamCoinSentence): what settles, which outcome,
 * what one burn does. Our words around the venue's title; the exact statement and hash stay under "details".
 */
export function plainSentence(rule: BurnRule, ticker: string, title: string | null = null, endDate: string | null = null): string {
  const t = ticker || "TICKER";
  const what = (title ?? "").trim() || rule.market || rule.series || "the source";
  const all = oneShotAllLiner(rule, what.replace(/\s*\(resolves once\)$/, ""), endDate ?? rule.pair?.voidBy ?? null);
  const tail = rule.onEnd ? ` When the rule ends, whatever is left in $${t}'s burn pool burns down over ${rule.onEnd.windDownDays === 28 ? "four weeks" : `${rule.onEnd.windDownDays} days`}.` : "";
  if (all) return `$${t} ${all}.`;
  return plainCore(rule, t, what) + tail;
}

function plainCore(rule: BurnRule, t: string, what: string): string {
  if (rule.oracle === "catalogue" && rule.scalar) return `Each time ${what} publishes a complete reading, $${t} ${mapWords(rule.scalar.perUnit, t)} once for every unit the source counts (compounding).`;
  if (rule.oracle === "polymarket" && rule.market && rule.kind === "binary" && rule.binary?.onYes && !rule.binary.onNo) {
    const event = what.replace(/\s*\(resolves once\)$/, "");
    return `If ${event}, $${t} ${mapWords(rule.binary.onYes, t)}. This happens once, when Polymarket's on-chain payout resolves the market YES. Otherwise nothing burns.`;
  }
  if (rule.kind === "binary" && rule.binary) {
    const yes = rule.binary.onYes ? `When ${what} settles YES, $${t} ${mapWords(rule.binary.onYes, t)}.` : "";
    const no = rule.binary.onNo ? ` When it settles NO, $${t} ${mapWords(rule.binary.onNo, t)}.` : "";
    return `${yes}${no}`.trim() + " A voided market burns nothing.";
  }
  if (rule.kind === "scalar" && rule.scalar) {
    const s = rule.scalar;
    const dir = s.direction === "up" ? "above" : s.direction === "down" ? "below" : "away from";
    const base = s.baseline === "previousSettlement" ? "the previous settlement" : String(s.baseline);
    return `Each time ${what} settles, every full ${s.unit} ${dir} ${base} is one step, and each step $${t} ${mapWords(s.perUnit, t)}.`;
  }
  return `$${t} burns on each settled result of ${what}.`;
}
