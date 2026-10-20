import { badgeDay, coinStatusFactsOf, type ReceiptInput, type StatusInput } from "@/lib/burnticker/coinStatus";
import { utcDay } from "@/lib/burnticker/utcWords";

/**
 * THE DECIDED-COIN LINE ABOVE THE SWAP PANEL (third prelaunch audit 2026-10-19, B-7). $DENWIN and $SEAWIN had their one result recorded
 * on 2026-10-16, yet their pages showed an open swap panel with no word about it, while their event burn happens only if both curves
 * reach their raise and register a pool by the pair's void date. On a coin whose one result is in (the status JSON's next.result is
 * "decided" or "void"), the coin page prints this plain line above the panel: the result, that no further result is read for the coin,
 * and what its burn depends on (graduation by the void date for the winning side; nothing for the losing side). Pure and client-safe.
 */

export interface DecidedWarningInput extends StatusInput {
  next: { result?: "recurring" | "pending" | "decided" | "void" };
  market?: { phase: "curve" | "migrating" | "graduated" | null; curve?: { threshold: string; quote: string } | null } | null;
  pair?: (NonNullable<StatusInput["pair"]> & { counterpart: { name: string; ticker: string; sideName?: string | null }; clause?: { state: "live" | "waiting" | "voided"; voidBy: string; decidedAt?: string | null } | null }) | null;
  lifecycle?: { ended: { mode: "drain" | "winddown" } | null; windDown?: { days: number; done: number } | null } | null;
  /** the rule's onEnd.windDownDays when the caller has it (HB-50) */
  windDownDays?: number | null;
}

/**
 * PROD-05 (external audit 2026-10-19): a voided one-shot is not "nothing burns". The void stops the burn for the RESULT, but the keeper
 * then ends the rule (multiKeeper.ts voids a pending pair and ends both coins in winddown), and the end-of-rule burns run on the coin. So
 * the void line says two things apart: no burn for the result, and what the burn pool does at the end. It is dated by the void itself
 * (a pair's clause decidedAt; a single market's void receipt), never by the game's day, and carries no date when none is recorded.
 */
export const VOID_TAILS = {
  winddown: "Its burn pool now winds down on this coin.",
  drain: "Its burn pool is now being spent down on this coin.",
  woundDown: "Its burn pool has wound down on this coin.",
  pending: "Its burn pool winds down on this coin once the rule ends.",
} as const;
/** "over four weeks" for the default 28 days, else "over N days" (rule.onEnd.windDownDays, HB-50: never a hard-coded four weeks). */
export const windDownOver = (days: number | null | undefined): string => {
  const d = typeof days === "number" && days > 0 ? days : 28;
  return d === 28 ? "over four weeks" : `over ${d} ${d === 1 ? "day" : "days"}`;
};
const END_RECEIPT_KINDS = new Set(["winddown", "drain", "sweep"]);
export function voidedLine(s: Pick<DecidedWarningInput, "pair" | "lifecycle" | "selectorKey"> & { market?: DecidedWarningInput["market"] }, receipts: readonly ReceiptInput[]): string {
  const pair = s.pair && !s.pair.unpaired ? s.pair : null;
  const ends = receipts.filter((r) => END_RECEIPT_KINDS.has(r.kind ?? ""));
  const mode = s.lifecycle?.ended?.mode ?? (ends.some((r) => r.kind === "drain") ? "drain" : ends.length ? "winddown" : null);
  const wd = s.lifecycle?.windDown;
  // continuous audit run 4, HB-50: a voided single coin is not "Nothing burns on it" before its wind-down starts; like a pair, its pool
  // winds down once the rule ends
  const tail = mode === "drain" ? VOID_TAILS.drain
    : mode === "winddown" ? (wd && wd.days > 0 && wd.done >= wd.days ? VOID_TAILS.woundDown : VOID_TAILS.winddown)
    : VOID_TAILS.pending;
  // the void's own date: a pair's clause records when it voided; a single coin's void receipt is the void reading
  const voidRow = [...receipts].filter((r) => !END_RECEIPT_KINDS.has(r.kind ?? "") && (r.status === "void" || r.status === "voided")).sort((a, b) => b.settledAt.localeCompare(a.settledAt))[0] ?? null;
  // the pair itself voided (its clause): dated only by the clause's own void time; otherwise the result was voided (a cancelled game, a
  // voided market), dated by its void receipt
  const pairVoided = pair?.clause?.state === "voided";
  const at = pairVoided ? pair!.clause!.decidedAt ?? null : voidRow?.settledAt ?? null;
  const on = at ? ` on ${utcDay(at)}` : "";
  const what = /(?:^|:)espn\.game:/.test(s.selectorKey ?? "") ? "the game result" : "the result";
  if (pairVoided) return `The pair was voided${on}. No burn happens for ${what}. ${tail}`;
  return `This coin's one result was voided${on}. ${!pair && tail === VOID_TAILS.pending ? `${NO_FURTHER_RESULT} ` : ""}No burn happens for ${what}. ${tail}`;
}

/**
 * Continuous audit run 2, HS-1 and HB-22: the losing side of a decided one-game pair says who lost, who won and on which day, that a swap
 * cannot make it burn, and where its pool goes at the end. Built from the pair record (the other side's name, the void date) and the
 * result; dates through utcWords.ts. "Swapping into", never "buying": the copy lint refuses calls to buy.
 */
const NO_ARTICLE_LEAGUES = new Set(["cfb", "mcbb", "wcbb"]);
/** "the Broncos" for a US pro team; "Arsenal" for a club (a soccer league id has a dot) or a college. */
export function teamRef(name: string, selectorKey: string | null | undefined): string {
  const league = /(?:^|:)espn\.(?:game|team):([a-z0-9.]+)-/.exec(selectorKey ?? "")?.[1] ?? null;
  return league && (league.includes(".") || NO_ARTICLE_LEAGUES.has(league)) ? name : `the ${name}`;
}
const cap1 = (t: string): string => t.charAt(0).toUpperCase() + t.slice(1);
/** The game's day: the date the coin's badge states (the rule's local game day, as the header shows it), else the receipt's day. */
export function gameDayOf(s: Pick<DecidedWarningInput, "profile" | "selectorKey">, settledAt: string | null): string | null {
  const fromBadge = /(?:^|:)espn\.game:/.test(s.selectorKey ?? "") ? badgeDay(s.profile?.badge) : null;
  return fromBadge ?? settledAt;
}
/**
 * HB-50 (run 4): once both coins have graduated (the pair clause is "live"), the graduation condition is past, so the line says only where
 * the pool goes; the wind-down length is the coin's own windDownDays.
 */
/**
 * HB-15 (run 4 leftover): a one-game coin's receipt is dated by the game's own day (the badge's, as the header shows it), and the ESPN link
 * a receipt stored before the Eastern-day fix carries is moved to that day. Null / unchanged for any other coin.
 */
export function receiptGameDay(s: Pick<DecidedWarningInput, "profile" | "selectorKey">): string | null {
  return /(?:^|:)espn\.game:/.test(s.selectorKey ?? "") ? badgeDay(s.profile?.badge) : null;
}
export function espnLinkOnDay(url: string, day: string | null): string {
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return url;
  return url.replace(/\/date\/\d{8}\b/, `/date/${day.replace(/-/g, "")}`);
}
export function losingPairLine(i: { ticker: string; otherTicker: string; sideName: string | null; otherSideName: string | null; selectorKey?: string | null; gameDay: string | null; voidBy: string | null; bothGraduated?: boolean; windDownDays?: number | null }): string {
  const on = i.gameDay ? ` on ${utcDay(i.gameDay)}` : "";
  const beat = i.otherSideName && i.sideName ? `${cap1(teamRef(i.otherSideName, i.selectorKey))} beat ${teamRef(i.sideName, i.selectorKey)}${on}.`
    : i.otherSideName ? `${cap1(teamRef(i.otherSideName, i.selectorKey))} won${on}.`
    : `The other side won${on}.`;
  const by = i.voidBy ? ` by ${utcDay(i.voidBy)}` : "";
  if (i.bothGraduated) return `$${i.ticker} lost. ${beat} Swapping into $${i.ticker} now cannot make it burn. At the end, its burn pool goes to $${i.otherTicker}'s burn.`;
  return `$${i.ticker} lost. ${beat} Swapping into $${i.ticker} now cannot make it burn. At the end, its burn pool goes to $${i.otherTicker}'s burn if both coins graduate${by}. If they do not, the pair is voided and $${i.ticker}'s pool burns down on $${i.ticker} ${windDownOver(i.windDownDays)}.`;
}

export const NO_FURTHER_RESULT = "No further result is read for it.";

/**
 * ONE DECIDED LINE FOR A PAIR COIN (hourly run 5, HB-80 and HS-27): the losing $SEAWIN read "Decided, waiting for graduation" on the
 * creator card and "waits until both coins of the pair have a registered pool" in the home row, while its token page said it lost. The
 * creator card, the home row, the embed and the badge print this one line for a decided one-game pair coin whose burn has not run:
 *   winner  "Won on 15 October 2026. Burn runs once both coins graduate (by 14 November 2026)."
 *   loser   "Lost on 15 October 2026. This result cannot make $SEAWIN burn."
 * Dates through utcWords.ts. A surface that has no void date (the home's light read) leaves the "(by ...)" out. Pure and client-safe.
 */
export interface DecidedPair { role: "won" | "lost"; day: string | null; voidBy: string | null; bothGraduated: boolean }
export function decidedPairLine(ticker: string, d: DecidedPair): string {
  const on = d.day ? ` on ${utcDay(d.day)}` : "";
  if (d.role === "lost") return `Lost${on}. This result cannot make $${ticker} burn.`;
  if (d.bothGraduated) return `Won${on}. Burn runs on its trading pool.`;
  return `Won${on}. Burn runs once both coins graduate${d.voidBy ? ` (by ${utcDay(d.voidBy)})` : ""}.`;
}
/** The input decidedPairOf reads: a status JSON's few fields (any of them may be missing on an older or light read). */
export interface DecidedPairStatus {
  rules?: { oneShot?: boolean } | null;
  next?: { result?: string | null } | null;
  selectorKey?: string | null;
  profile?: { badge?: string | null } | null;
  pair?: { clause?: { state?: string | null; voidBy?: string | null } | null } | null;
}
/**
 * A decided pair coin's role, day and void date, or null: the latest result receipt (end receipts aside) names this coin's pair role
 * ("won" or "lost") and the coin's one result is decided; a burn that already ran (a confirmed receipt) is not this line's case.
 */
export function decidedPairOf(s: DecidedPairStatus, receipts: readonly { status: string; settledAt: string; kind?: string | null; pairRole?: string | null }[]): DecidedPair | null {
  if (s.rules?.oneShot === false || (s.next?.result !== undefined && s.next?.result !== null && s.next.result !== "decided")) return null;
  const latest = [...receipts].filter((r) => !END_RECEIPT_KINDS.has(r.kind ?? "")).sort((a, b) => b.settledAt.localeCompare(a.settledAt))[0] ?? null;
  if (!latest || (latest.pairRole !== "won" && latest.pairRole !== "lost")) return null;
  if (latest.status === "confirmed" || latest.status === "void" || latest.status === "voided") return null;
  const day = gameDayOf({ profile: s.profile ? { badge: s.profile.badge ?? undefined } : null, selectorKey: s.selectorKey ?? null } as Pick<DecidedWarningInput, "profile" | "selectorKey">, latest.settledAt);
  return { role: latest.pairRole, day, voidBy: s.pair?.clause?.voidBy ?? null, bothGraduated: s.pair?.clause?.state === "live" };
}
const raiseWords = (m: DecidedWarningInput["market"]): string => {
  const t = m?.curve?.threshold ? Number(m.curve.threshold) : NaN;
  return Number.isFinite(t) ? `their ${Math.round(t * 100) / 100} ${m?.curve?.quote ?? "SOL"} raise` : "their raise";
};

/** The line, or null when the coin's one result is not in (a repeating rule, or a one-shot still waiting). */
export function decidedSwapWarning(s: DecidedWarningInput, receipts: readonly ReceiptInput[], otherSideNameArg: string | null = null): string | null {
  if (s.next.result !== "decided" && s.next.result !== "void") return null;
  // HB-22: the other side's name from the caller, else from the pair record the status JSON carries (server.ts pairCounterpart)
  const otherSideName = otherSideNameArg || s.pair?.counterpart?.sideName || null;
  const f = coinStatusFactsOf(s, receipts, otherSideName ? { profile: { sideName: otherSideName } } : null);
  const d = f.decision;
  const latest = [...receipts].filter((r) => !["winddown", "drain", "sweep"].includes(r.kind ?? "")).sort((a, b) => b.settledAt.localeCompare(a.settledAt))[0] ?? null;
  const day = gameDayOf(s, latest?.settledAt ?? null);
  const on = day ? ` on ${utcDay(day)}` : "";
  if (s.next.result === "void" || d?.outcome === "void") return voidedLine(s, receipts);
  const side = f.sideName;
  const pair = f.pair && s.pair ? s.pair : null;
  const winnerName = d?.outcome === "this" ? side : d?.outcome === "other" ? otherSideName : null;
  const head = d?.outcome === "this" ? `This coin's one result is in: ${side ? `${side} won` : "its side won"}${on}.`
    : d?.outcome === "other" ? `This coin's one result is in: ${winnerName ? `${winnerName} won` : "the other side won"}${on}, so this coin is on the losing side.`
    : d?.outcome === "draw" ? `This coin's one result is in: a draw${on}.`
    : d?.result && /^(yes|no)$/i.test(d.result) ? `This coin's one result is in: the market settled ${d.result.charAt(0).toUpperCase()}${d.result.slice(1).toLowerCase()}${on}.`
    : `This coin's one result is in${on}.`;
  if (!d) return `${head} ${NO_FURTHER_RESULT}`;
  if (d.outcome === "other" && pair) return losingPairLine({ ticker: s.ticker, otherTicker: pair.counterpart.ticker, sideName: side, otherSideName, selectorKey: s.selectorKey, gameDay: day, voidBy: pair.clause?.voidBy ?? null, bothGraduated: pair.clause?.state === "live", windDownDays: s.lifecycle?.windDown?.days ?? s.windDownDays ?? null });
  if (!d.burnsThis || d.outcome === "other") return `${head} ${NO_FURTHER_RESULT} ${d.outcome === "other" ? "The losing side burns nothing of its own." : "This coin burns nothing on it."}`;
  if (d.hold === null) return `${head} ${NO_FURTHER_RESULT} Its burn is done.`;
  if (pair) {
    const by = pair.clause?.voidBy ? ` by ${utcDay(pair.clause.voidBy)} (UTC)` : "";
    return `${head} ${NO_FURTHER_RESULT} Its burn happens only if both $${s.ticker} and $${pair.counterpart.ticker} reach ${raiseWords(s.market)} and register a pool${by}. If not, the pair is voided and no burn for this result happens.`;
  }
  if (s.market?.phase === "curve" || s.market?.phase === "migrating") return `${head} ${NO_FURTHER_RESULT} Its burn happens only after the curve reaches ${raiseWords(s.market).replace(/^their/, "its")} and the coin graduates.`;
  return `${head} ${NO_FURTHER_RESULT} Its burn waits for its trading pool.`;
}
