import { buybackSpend } from "@/lib/burnReceipts/math";
import { LAMPORTS } from "@/lib/burnticker/burnMath";
import { outcomeResults, outcomeWords, parseEspnSeries, seriesCannotTie } from "@/lib/burnticker/sources/espn";

import type { BurnRule } from "@/lib/burnticker/rules";
import { windowKindOf } from "@/lib/burnticker/describe";

/** "over four weeks" for the default 28 days, else "over N days": how long a pool winds down (rule.onEnd.windDownDays). */
export const windDownOver = (days: number | null | undefined): string => {
  const d = typeof days === "number" && days > 0 ? days : 28;
  return d === 28 ? "over four weeks" : `over ${d} ${d === 1 ? "day" : "days"}`;
};
/**
 * Continuous audit run 4, HB-39: the rows of "What one result does" per family. A published number (a catalogue reading that is not a team
 * result) has no tie, and its voided row is "No reading is published"; a one-shot's voided row agrees with its end line (the pool winds
 * down on the coin over its windDownDays), never "keeps its SOL for the next result".
 */
export function simFamilyOf(rule: BurnRule): "published" | "one-shot" | "recurring" {
  if (rule.oracle === "catalogue" && rule.kind === "scalar" && !parseEspnSeries(rule.series ?? "")) return "published";
  return windowKindOf(rule) === "one-shot" ? "one-shot" : "recurring";
}
/** HB-81 D1 (hourly run 5): a count or a reading has no tie and no sides, so its tie row says that without market or pair words. */
export const SIM_NO_TIE_COUNT = "A count has no tie. A reading either qualifies or it does not, and one that does not burns nothing.";
export const SIM_NO_READING_LABEL = "No reading is published";
export const SIM_NO_READING_LINE = "A period with no published reading burns nothing, and it is never read as zero. The burn pool keeps its SOL for the next reading.";
export const simOneShotVoidLine = (days: number | null | undefined): string => `A voided or cancelled result burns nothing for the result. The rule then ends, and whatever is in the burn pool burns down on this coin ${windDownOver(days)}.`;

/**
 * THE RESULT SIMULATOR'S MATH (cheap-features pass item 6, owner 2026-10-13). What one result does to a coin's burn pool, for a
 * HYPOTHETICAL amount of SOL in the pool, through the program's own arithmetic (burnReceipts/math buybackSpend: the compounding share;
 * no per-run bound and no platform cap since the owner decision of 2026-10-25: one run spends the rule's full share). Five cases, always in
 * this order:
 *
 *   result          the result the rule burns on (a win for a win coin, YES for a YES coin, one unit for a number source)
 *   tie             a level game (a draw coin burns on it; every other coin does not)
 *   void            the source voids or cancels the event: nothing burns, the pool keeps its SOL (onVoid "skip", the only policy)
 *   no-result       nothing is published: nothing happens until a result is read
 *   no-graduation   the curve has not completed: the result is recorded and nothing can burn yet
 *
 * A pair (both coins) is shown side by side. A winner-takes-the-burn pair (pairFundsFlow.ts) forwards the losing side's rule spend to the
 * winner's pool, so on a result the winner burns its own share plus the forwarded SOL; a tie or a void moves nothing. Two coins that are
 * not linked (a matchup launched together) each burn only from their own pool.
 *
 * Every number is a hypothetical: the pool's SOL is the caller's, and how many tokens a spend burns depends on the trading pool at the
 * moment of the run, so no token amount is given. Pure and client-safe (bigint lamports inside, decimal SOL strings out).
 */

export type SimCase = "result" | "tie" | "void" | "no-result" | "no-graduation";
export const SIM_CASES: readonly SimCase[] = ["result", "tie", "void", "no-result", "no-graduation"];
export const SIM_CASE_LABEL: Record<SimCase, string> = {
  result: "The result the rule burns on",
  tie: "A tie",
  void: "The event is voided or cancelled",
  "no-result": "No result is published",
  "no-graduation": "The curve has not completed",
};
/** The default hypothetical pool (1 SOL) and trading pool (85 SOL, the largest raise preset's starting pool). */
export const SIM_DEFAULT_POOL_SOL = "1";
export const SIM_DEFAULT_TRADING_POOL_SOL = "85";

export interface SimCoin {
  side: "A" | "B"; ticker: string;
  /** SOL spent from this coin's own pool on this case (decimal string, 9 places max) */ spendSol: string;
  /** SOL this coin's pool receives from the other side (winner takes the burn), or "0" */ receivedSol: string;
  /** SOL this coin sends to the other side's pool (winner takes the burn), or "0" */ sentSol: string;
  /** SOL that waits for the next run: always "0" since 2026-10-25 (one run spends the rule's full share); kept for the API shape */ waitsSol: string;
  /** SOL left in this coin's pool afterwards */ poolAfterSol: string;
  burns: boolean; line: string;
}
export interface SimRow { case: SimCase; label: string; coins: SimCoin[]; line: string }
export interface Simulation {
  available: boolean; reason: string | null;
  poolSol: string; tradingPoolSol: string; share: number | null; shareLabel: string | null; firesOn: string | null;
  pair: "winner-takes-the-burn" | "separate" | null;
  rows: SimRow[]; note: string;
}

const toLamports = (sol: string): bigint => {
  const m = /^(\d{1,9})(?:\.(\d{1,9}))?$/.exec(sol.trim());
  if (!m) throw new Error(`not an amount of SOL: ${sol}`);
  return BigInt(m[1]) * LAMPORTS + BigInt((m[2] ?? "").padEnd(9, "0") || "0");
};
export const lamportsToSol = (l: bigint): string => {
  const neg = l < BigInt(0), a = neg ? -l : l;
  const whole = a / LAMPORTS, frac = (a % LAMPORTS).toString().padStart(9, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
};
const pctLabel = (f: number): string => `${Math.round(f * 1000) / 10}%`;

/** The share of the pool one firing result spends, and what the rule fires on, in words. Null share: a vault rule (fixed tokens). */
export function firingOf(rule: BurnRule): { share: number | null; firesOn: string; drawFires: boolean } {
  const b = rule.binary;
  const m = rule.kind === "scalar" ? rule.scalar?.perUnit : (b?.onYes ?? b?.onNo);
  const share = m && typeof (m as { fractionOfPool?: unknown }).fractionOfPool === "number" ? (m as { fractionOfPool: number }).fractionOfPool : null;
  const e = rule.oracle === "catalogue" && rule.series ? parseEspnSeries(rule.series) : null;
  if (e) {
    const o = e.outcome;
    if (rule.inverse) return { share, firesOn: o === "win" ? "each game without a win" : `each game without a ${o}`, drawFires: o !== "draw" };
    return { share, firesOn: o === "win" ? "a win" : o === "loss" ? "a loss" : o === "draw" ? "a draw" : `a ${outcomeWords(o).noun}`, drawFires: outcomeResults(o).includes("draw") };
  }
  if (rule.kind === "scalar") return { share, firesOn: rule.inverse ? "a period when the condition does not happen" : "each unit the number moves", drawFires: false };
  return { share, firesOn: b?.onYes ? "a YES result" : "a NO result", drawFires: false };
}

export interface SimOptions {
  /** hypothetical SOL in each coin's burn pool (default 1) */ poolSol?: string;
  /** hypothetical SOL in the trading pool (default 85); echoed back, no longer bounds a run (2026-10-25) */ tradingPoolSol?: string;
  /** a second coin: its ticker, and whether the two are a winner-takes-the-burn pair */ pair?: { tickerA: string; tickerB: string; winnerTakesBurn: boolean } | null;
  ticker?: string;
}

/** The five cases for a locked rule. */
export function simulateResults(rule: BurnRule, o: SimOptions = {}): Simulation {
  const poolSol = o.poolSol ?? SIM_DEFAULT_POOL_SOL, tradingPoolSol = o.tradingPoolSol ?? SIM_DEFAULT_TRADING_POOL_SOL;
  const pairKind: Simulation["pair"] = o.pair ? (o.pair.winnerTakesBurn ? "winner-takes-the-burn" : "separate") : null;
  const base = { poolSol, tradingPoolSol, pair: pairKind, note: "These are hypothetical amounts of SOL. How many tokens a spend burns depends on the trading pool at the moment of the run, so no token amount is shown." };
  let pool: bigint;
  try { pool = toLamports(poolSol); toLamports(tradingPoolSol); } catch (e) { return { ...base, available: false, reason: `${(e as Error).message}. Use a plain number such as 1 or 0.5.`, share: null, shareLabel: null, firesOn: null, rows: [] }; }
  const f = firingOf(rule);
  if (f.share === null) return { ...base, available: false, reason: "This rule moves a fixed number of tokens from a vault, so there is no share of a pool to work out.", share: null, shareLabel: null, firesOn: f.firesOn, rows: [] };
  const bps = Math.round(f.share * 10_000);
  const budget = pool;
  const ruleSpend = buybackSpend(budget, BigInt(1), bps);
  const zero = BigInt(0);
  /** One coin's own run: the whole planned spend in one run (no per-run bound, no platform cap). */
  const run = (planned: bigint) => ({ spend: planned, waits: zero });
  const tA = o.pair?.tickerA ?? o.ticker ?? "A", tB = o.pair?.tickerB ?? "B";
  const idle = (side: "A" | "B", ticker: string, line: string): SimCoin => ({ side, ticker, spendSol: "0", receivedSol: "0", sentSol: "0", waitsSol: "0", poolAfterSol: lamportsToSol(pool), burns: false, line });
  const burning = (side: "A" | "B", ticker: string, received: bigint): SimCoin => {
    const r = run(ruleSpend + received);
    const line = received > zero
      ? `$${ticker} spends ${lamportsToSol(r.spend)} SOL, its own ${pctLabel(f.share!)} plus the ${lamportsToSol(received)} SOL sent by the other coin, and burns the tokens that SOL gets.`
      : `$${ticker} spends ${lamportsToSol(r.spend)} SOL (${pctLabel(f.share!)} of ${lamportsToSol(budget)} SOL) and burns the tokens that SOL gets.`;
    return { side, ticker, spendSol: lamportsToSol(r.spend), receivedSol: lamportsToSol(received), sentSol: "0", waitsSol: lamportsToSol(r.waits), poolAfterSol: lamportsToSol(pool + received - r.spend), burns: true, line };
  };
  const rows: SimRow[] = [];
  const family = simFamilyOf(rule);
  for (const c of SIM_CASES) {
    if (c === "tie" && family === "published" && !o.pair) continue;
    // HB-146 (hourly run 13): a published number's voided row is already "No reading is published"; a second "No result is published"
    // row said the same situation in other words
    if (c === "no-result" && family === "published" && !o.pair) continue;
    // HB-39 residue (hourly run 14): one yes/no market has no tie, so its table has no tie row (a row that only said it does not apply);
    // a recurring series of games keeps it
    if (c === "tie" && rule.kind === "binary" && (rule.oracle === "polymarket" || (rule.oracle === "kalshi" && !!rule.market)) && !o.pair && !f.drawFires) continue;
    // HS-42 (hourly run 8): no tie row for a league whose games cannot end tied (NHL, NBA, MLB), on a team coin or a one-game pair
    if (c === "tie" && (seriesCannotTie(rule.oracle === "catalogue" ? rule.series ?? null : null) || seriesCannotTie(rule.pair?.game?.series?.[0] ?? null))) continue;
    let coins: SimCoin[];
    let line: string;
    if (c === "result") {
      if (!o.pair) { coins = [burning("A", tA, zero)]; line = coins[0].line; }
      else if (o.pair.winnerTakesBurn) {
        const sent = ruleSpend;
        const loser: SimCoin = { side: "B", ticker: tB, spendSol: "0", receivedSol: "0", sentSol: lamportsToSol(sent), waitsSol: "0", poolAfterSol: lamportsToSol(pool - sent), burns: false, line: `$${tB} burns nothing of its own and sends ${lamportsToSol(sent)} SOL, its rule's share, to $${tA}'s burn pool.` };
        coins = [burning("A", tA, sent), loser];
        line = `When $${tA}'s side takes the result: ${coins[0].line} ${loser.line} The same happens the other way round when $${tB}'s side takes it.`;
      } else { coins = [burning("A", tA, zero), idle("B", tB, `$${tB} burns only on its own result, from its own pool.`)]; line = `${coins[0].line} $${tB} burns only on its own result, from its own pool.`; }
    } else if (c === "tie") {
      if (f.drawFires && !o.pair) { coins = [burning("A", tA, zero)]; line = `This coin burns on a tie. ${coins[0].line}`; }
      else { line = rule.series && parseEspnSeries(rule.series) ? "A tie is not the result this rule burns on, so nothing burns and the pool keeps its SOL." : family === "one-shot" ? (rule.oracle === "catalogue" ? SIM_NO_TIE_COUNT : "This kind of event has no tie. A result that is neither side counts as voided, as the next row says.") : rule.oracle === "catalogue" ? SIM_NO_TIE_COUNT : "This kind of event has no tie. A result that is neither side counts as voided, so nothing burns."; if (o.pair) line = `A tie moves nothing between the two coins and nothing burns. Each pool keeps its SOL.`; coins = [idle("A", tA, line), ...(o.pair ? [idle("B", tB, line)] : [])]; }
    } else if (c === "void") {
      line = family === "published" ? SIM_NO_READING_LINE : family === "one-shot" ? simOneShotVoidLine(rule.onEnd?.windDownDays) : "A voided or cancelled event burns nothing. The burn pool keeps its SOL for the next result.";
      if (o.pair) line = "A voided or cancelled event moves nothing between the two coins and nothing burns. Each pool keeps its SOL.";
      coins = [idle("A", tA, line), ...(o.pair ? [idle("B", tB, line)] : [])];
    } else if (c === "no-result") {
      line = "Nothing happens until the source publishes a result. Trading fees keep adding to the burn pool in the meantime.";
      if (o.pair?.winnerTakesBurn) line = "Nothing moves until a result is read. If one coin's result is read and the other's is still missing 72 hours later, that coin burns as if it had no pair.";
      coins = [idle("A", tA, line), ...(o.pair ? [idle("B", tB, line)] : [])];
    } else {
      line = "Before the curve completes and the pool is registered, nothing can burn. The result is still recorded, and trading fees collect in the burn pool.";
      coins = [idle("A", tA, line), ...(o.pair ? [idle("B", tB, line)] : [])];
    }
    rows.push({ case: c, label: c === "void" && family === "published" && !o.pair ? SIM_NO_READING_LABEL : SIM_CASE_LABEL[c], coins, line });
  }
  return { ...base, available: true, reason: null, share: f.share, shareLabel: pctLabel(f.share), firesOn: f.firesOn, rows };
}
