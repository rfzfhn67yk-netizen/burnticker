import type { BurnRule } from "@/lib/burnticker/rules";
import type { CoinStatusFacts } from "@/lib/burnticker/coinStatus";
import type { CoinListing, ListGroup, ListNext, ListResult, ResultNext } from "@/lib/burnticker/coinsList";
import { isOneShot, resolvesOnce } from "@/lib/burnticker/nextResult";
import { championPathRule, describeEndSink, sinkTickerOf } from "@/lib/burnticker/describe";
import { parseEspnSeries } from "@/lib/burnticker/sources/espn";
import { nativeSourceById } from "@/lib/burnticker/sources/native";
import { feedById } from "@/lib/burnticker/catalogue";
import { lintCopy } from "@/lib/launch/copyLint";

/**
 * EACH COIN'S PLACE ON THE COINS PAGE (owner decisions 2026-10-19; coinsList.ts holds the order and the lines). Built in the list route
 * from what it already has: the coin's status as read for its card, its receipts, its status facts (coinStatus.ts) and the registry's
 * locked rule. No chain read and no source read is added: the keeper's next planned read (status next.nextSourceCheckAt, the read
 * plan's dueAt) stands for when a game's result is read, and a feed's cadence comes from the catalogue's own words.
 */

export interface ListingStatus {
  status: string;
  next: { nextCheckAt: string | null; nextCloseTime: string | null; result?: "recurring" | "pending" | "decided" | "void"; nextResultAt?: string | null; nextSourceCheckAt?: string | null };
  profile?: { badge?: string | null } | null;
  market?: { phase: "curve" | "migrating" | "graduated" | null } | null;
  lifecycle?: { ended: { at: string } | null } | null;
  pair?: { unpaired?: unknown } | null;
}
export interface ListingReceipt { status: string; settledAt: string; kind?: string | null; result?: string | null }

const END_KINDS = new Set(["winddown", "drain", "sweep"]);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The window end a one-shot badge states ("ONE-SHOT · Oct 31, 2026" → "2026-10-31"); null when it states none. */
export function badgeWindowEnd(badge: string | null | undefined): string | null {
  const m = /ONE-SHOT\s*·\s*([A-Z][a-z]{2}) (\d{1,2}), (\d{4})/.exec(badge ?? "");
  if (!m) return null;
  const mo = MONTHS.indexOf(m[1]);
  return mo < 0 ? null : `${m[3]}-${String(mo + 1).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

/** A feed's cadence in the catalogue's own words, when they pass the copy lint; null otherwise. */
export function cadenceOf(rule: Pick<BurnRule, "oracle" | "series">): string | null {
  if (rule.oracle !== "catalogue" || !rule.series) return null;
  let words: string | null = null;
  try { words = nativeSourceById(rule.series)?.cadence ?? feedById(rule.series)?.cadence ?? null; } catch { words = null; }
  if (!words || !words.trim()) return null;
  try { return lintCopy(`Result read ${words}.`).ok ? words.trim() : null; } catch { return null; }
}

/** The end sink in words, by the coin's outcome. */
export function sinkWords(rule: BurnRule, outcome: ListResult["outcome"]): string {
  const sink = describeEndSink(rule);
  if (championPathRule(rule) && outcome === "won") return "the rest burns down on this coin";
  if (sink === "incinerator") return "the rest goes to Solana's incinerator";
  if (sink === "flagship" || sink === "mint") return `the rest goes to ${sinkTickerOf(rule)}'s burn`;
  if (sink === "pair-winner") return outcome === "won" ? "the rest burns down on this coin" : outcome === "lost" ? "the rest goes to the winning coin's burn" : "the rest goes to $DEFICIT's burn";
  return "the rest burns down on this coin";
}

const WON = /^(win|won)$/i, LOST = /^(loss|lose|lost)$/i;
function outcomeOf(d: NonNullable<CoinStatusFacts["decision"]>): { outcome: ListResult["outcome"]; words: string | null } {
  if (d.outcome === "void") return { outcome: "void", words: null };
  if (d.outcome === "this") return { outcome: "won", words: null };
  if (d.outcome === "other") return { outcome: "lost", words: null };
  if (d.outcome === "draw") return { outcome: "draw", words: null };
  const r = d.result;
  if (r && WON.test(r)) return { outcome: "won", words: null };
  if (r && LOST.test(r)) return { outcome: "lost", words: null };
  if (r && /^yes$/i.test(r)) return { outcome: "settled", words: "Yes" };
  if (r && /^no$/i.test(r)) return { outcome: "settled", words: "No" };
  return { outcome: "settled", words: r && /^[\p{L}][\p{L}\p{N} .'&-]{0,39}$/u.test(r) ? r.replace(/\.$/, "") : null };
}

/** What happens after a decided one-shot, from what its burn waits for. */
function nextAfter(d: NonNullable<CoinStatusFacts["decision"]>, outcome: ListResult["outcome"], phase: CoinStatusFacts["phase"]): ResultNext {
  if (outcome === "void") return "no-burn";
  if (d.outcome === "other") return "no-burn-losing";
  if (!d.burnsThis) return "no-burn";
  if (d.hold === null) return "burned";
  if (phase === "curve" || phase === "migrating" || d.hold === "curve" || d.hold === "opening") return "burn-after-graduation";
  return "burn-waiting";
}

/** The next-result facts of an open coin. */
export function listNextOf(s: ListingStatus, rule: BurnRule): ListNext | null {
  const read = s.next.nextSourceCheckAt ?? s.next.nextCheckAt ?? null;
  const espn = rule.oracle === "catalogue" && rule.series ? parseEspnSeries(rule.series) : null;
  const pairGame = !!(rule.pair as { game?: unknown } | null | undefined)?.game;
  if (espn?.kind === "game" || pairGame) return { shape: "game", at: s.next.nextResultAt ?? read, cadence: null, windowEnd: null };
  const market = rule.market !== null || rule.oracle === "polymarket" || rule.oracle === "kalshi";
  if (market) return { shape: "market", at: s.next.nextCloseTime ?? null, cadence: null, windowEnd: isOneShot(rule) ? badgeWindowEnd(s.profile?.badge) : null };
  if (resolvesOnce(rule)) return { shape: "one-shot", at: null, cadence: null, windowEnd: badgeWindowEnd(s.profile?.badge) };
  if (espn?.kind === "team") return { shape: "season", at: read, cadence: null, windowEnd: null };
  return { shape: "feed", at: null, cadence: cadenceOf(rule), windowEnd: null };
}

/** One coin's group, result and next-result facts. `facts` may be null (the route could not build them): the coin is then open. */
export function coinListingOf(i: { status: ListingStatus; receipts: readonly ListingReceipt[]; facts: CoinStatusFacts | null; rule: BurnRule }): CoinListing {
  const s = i.status;
  const latest = [...i.receipts].filter((r) => !END_KINDS.has(r.kind ?? "")).sort((a, b) => b.settledAt.localeCompare(a.settledAt))[0] ?? null;
  if (s.status === "retired") return { group: "retired", result: null, next: null };
  const d = i.facts?.decision ?? null;
  const ended = s.lifecycle?.ended ?? null;
  const phase = i.facts?.phase ?? s.market?.phase ?? null;
  if (d?.outcome === "void" || s.next.result === "void") {
    return { group: "void", result: { outcome: "void", words: null, settledAt: latest?.settledAt ?? null, next: ended ? "end-sink" : "no-burn", sink: ended ? sinkWords(i.rule, "void") : null }, next: null };
  }
  if (d) {
    const { outcome, words } = outcomeOf(d);
    const after = nextAfter(d, outcome, phase);
    const inPair = !!s.pair && !s.pair.unpaired;
    const waiting = !ended && (after === "burn-after-graduation" || after === "burn-waiting" || (inPair && outcome === "lost" && phase !== "graduated"));
    const group: ListGroup = waiting ? "decided-waiting" : "decided-ended";
    const next: ResultNext = group === "decided-ended" ? "end-sink" : after;
    return { group, result: { outcome, words, settledAt: latest?.settledAt ?? null, next, sink: next === "end-sink" ? sinkWords(i.rule, outcome) : null }, next: null };
  }
  if (s.next.result === "decided") {
    // a decided one-shot whose facts were not built: the result is in, its words were not read
    return { group: ended ? "decided-ended" : "decided-waiting", result: { outcome: "settled", words: null, settledAt: latest?.settledAt ?? null, next: ended ? "end-sink" : "nothing", sink: ended ? sinkWords(i.rule, "settled") : null }, next: null };
  }
  if (ended) return { group: "decided-ended", result: { outcome: "ended", words: null, settledAt: ended.at, next: "end-sink", sink: sinkWords(i.rule, "ended") }, next: null };
  return { group: "open", result: null, next: listNextOf(s, i.rule) };
}
