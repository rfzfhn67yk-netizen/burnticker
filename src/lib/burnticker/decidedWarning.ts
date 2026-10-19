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
  pair?: (NonNullable<StatusInput["pair"]> & { counterpart: { name: string; ticker: string; sideName?: string | null }; clause?: { state: "live" | "waiting" | "voided"; voidBy: string } | null }) | null;
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
export function losingPairLine(i: { ticker: string; otherTicker: string; sideName: string | null; otherSideName: string | null; selectorKey?: string | null; gameDay: string | null; voidBy: string | null }): string {
  const on = i.gameDay ? ` on ${utcDay(i.gameDay)}` : "";
  const beat = i.otherSideName && i.sideName ? `${cap1(teamRef(i.otherSideName, i.selectorKey))} beat ${teamRef(i.sideName, i.selectorKey)}${on}.`
    : i.otherSideName ? `${cap1(teamRef(i.otherSideName, i.selectorKey))} won${on}.`
    : `The other side won${on}.`;
  const by = i.voidBy ? ` by ${utcDay(i.voidBy)}` : "";
  return `$${i.ticker} lost. ${beat} Swapping into $${i.ticker} now cannot make it burn. At the end, its burn pool goes to $${i.otherTicker}'s burn if both coins graduate${by}. If they do not, the pair is voided and $${i.ticker}'s pool burns down on $${i.ticker} over four weeks.`;
}

export const NO_FURTHER_RESULT = "No further result is read for it.";
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
  if (s.next.result === "void" || d?.outcome === "void") return `This coin's one result was voided${on}. ${NO_FURTHER_RESULT} Nothing burns on it.`;
  const side = f.sideName;
  const pair = f.pair && s.pair ? s.pair : null;
  const winnerName = d?.outcome === "this" ? side : d?.outcome === "other" ? otherSideName : null;
  const head = d?.outcome === "this" ? `This coin's one result is in: ${side ? `${side} won` : "its side won"}${on}.`
    : d?.outcome === "other" ? `This coin's one result is in: ${winnerName ? `${winnerName} won` : "the other side won"}${on}, so this coin is on the losing side.`
    : d?.outcome === "draw" ? `This coin's one result is in: a draw${on}.`
    : d?.result && /^(yes|no)$/i.test(d.result) ? `This coin's one result is in: the market settled ${d.result.charAt(0).toUpperCase()}${d.result.slice(1).toLowerCase()}${on}.`
    : `This coin's one result is in${on}.`;
  if (!d) return `${head} ${NO_FURTHER_RESULT}`;
  if (d.outcome === "other" && pair) return losingPairLine({ ticker: s.ticker, otherTicker: pair.counterpart.ticker, sideName: side, otherSideName, selectorKey: s.selectorKey, gameDay: day, voidBy: pair.clause?.voidBy ?? null });
  if (!d.burnsThis || d.outcome === "other") return `${head} ${NO_FURTHER_RESULT} ${d.outcome === "other" ? "The losing side burns nothing of its own." : "This coin burns nothing on it."}`;
  if (d.hold === null) return `${head} ${NO_FURTHER_RESULT} Its burn is done.`;
  if (pair) {
    const by = pair.clause?.voidBy ? ` by ${utcDay(pair.clause.voidBy)} (UTC)` : "";
    return `${head} ${NO_FURTHER_RESULT} Its burn happens only if both $${s.ticker} and $${pair.counterpart.ticker} reach ${raiseWords(s.market)} and register a pool${by}. If not, the pair is voided and no burn for this result happens.`;
  }
  if (s.market?.phase === "curve" || s.market?.phase === "migrating") return `${head} ${NO_FURTHER_RESULT} Its burn happens only after the curve reaches ${raiseWords(s.market).replace(/^their/, "its")} and the coin graduates.`;
  return `${head} ${NO_FURTHER_RESULT} Its burn waits for its trading pool.`;
}
