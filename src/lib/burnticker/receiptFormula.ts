import type { BurnRule } from "@/lib/burnticker/rules";
import { numToDec, toScaled, unitStep, type CarryPolicy, type SettledEvent } from "@/lib/burnticker/units";
import { CTF_POLYGON } from "@/lib/burnticker/sources/stubs";
import { tsdbV1DayUrl } from "@/lib/burnticker/sources/gameSettle";

/**
 * THE "VERIFY IT YOURSELF" FORMULA AND COMMAND, PER RECEIPT KIND (prelaunch audit 2026-10-18 A-5). One template printed
 * `units = floor((0 − 0) / 1) = 1` for $SEAWIN (the 1 was the losing side's forwarded unit, not the result of that sum) and a curl of a
 * Polymarket HTML page piped into a Kalshi-shaped jq filter. Now:
 *
 *   unitsFormula    a scalar receipt's units as an equation that is true (direction up, down or either; the carried remainder only when
 *                   the rule carries it); a reading with no units says why in words, never as a false sum
 *   pairWords       a pair receipt decided by the other side: the losing coin's forwarded unit, or a side with no result, in words
 *   verifyCommand   the command for the source the reading came from: the catalogue feed, a game's on-chain payout and licensed score,
 *                   a Polymarket payout vector, or Kalshi's market API
 *
 * Every equation this module prints is checked against its own right-hand side in test/burntickerReceiptFormula.test.ts.
 */

export interface FormulaReceipt { value: string | null; prevValue: string | null; carryIn: string; units: number; result: string | null; pairRole?: "won" | "lost" | "draw" | null }

const decimals = (s: string): number => (/\.(\d+)$/.exec(s.trim())?.[1].length ?? 0);
const floorDiv = (a: bigint, b: bigint): bigint => (a >= BigInt(0) ? a / b : -((-a + b - BigInt(1)) / b));

/** The scalar units equation, or a sentence when no unit counted. Null for a binary rule. */
export function unitsFormula(rule: BurnRule, b: FormulaReceipt, carry: CarryPolicy = "none"): string | null {
  if (rule.kind !== "scalar" || !rule.scalar) return null;
  const s = rule.scalar;
  const ev: SettledEvent = { id: "x", at: "x", result: (b.result ?? null) as SettledEvent["result"], value: b.value, title: null, sourceUrl: "" };
  const step = unitStep(rule, ev, { value: b.prevValue, carryOut: b.carryIn }, carry);
  if (b.value === null || b.result === "void") return "The market was void or has no settled value, so no units count.";
  if (step.baseline === null) return "This first reading is the starting point, so no units count for it.";
  const base = step.baseline, value = b.value, unit = numToDec(s.unit);
  const dirWord = s.direction === "up" ? "up" : s.direction === "down" ? "down" : "either way";
  if (rule.inverse) return `The value went from ${base} to ${value}. This rule counts one unit when the value does not move ${dirWord}, so it counts ${step.units === 1 ? "one unit" : "no units"}.`;
  if (step.units === 0) {
    const scale = Math.max(decimals(value), decimals(base));
    const delta = toScaled(value, scale) - toScaled(base, scale);
    const wrongWay = delta === BigInt(0) || (s.direction === "up" && delta < BigInt(0)) || (s.direction === "down" && delta > BigInt(0));
    return wrongWay ? `The value went from ${base} to ${value}, which is not a move ${dirWord}, so no units count.` : `The value went from ${base} to ${value}, which is less than one unit of ${unit}, so no units count.`;
  }
  const cin = carry === "consecutive-increases" && b.carryIn !== "0" ? ` + ${b.carryIn} carried` : "";
  const inner = s.direction === "up" ? `${value} − ${base}` : s.direction === "down" ? `${base} − ${value}` : `|${value} − ${base}|`;
  const eq = `units = floor((${inner}${cin}) / ${unit}) = ${step.units}`;
  // the printed equation must equal its right-hand side; if it ever does not, the sentence says so plainly instead of a false sum
  return evaluateUnitsEquation(eq) === step.units ? `${eq} (the rule counts moves ${dirWord})` : `This reading counts ${step.units === 1 ? "one unit" : `${step.units} units`} under the rule.`;
}

/**
 * Evaluates "units = floor((A − B [+ C carried]) / U) = N" (or "B − A", or "|A − B|") exactly and returns floor(...), or null when the
 * text is not such an equation. Used by the formula itself and by the tests.
 */
export function evaluateUnitsEquation(text: string): number | null {
  const m = /units = floor\(\((\|?)(-?[\d.]+) − (-?[\d.]+)(\|?)(?: \+ ([\d.]+) carried)?\) \/ ([\d.]+)\) = (\d+)/.exec(text);
  if (!m) return null;
  const [, absL, a, bb, absR, c, u] = m;
  const scale = Math.max(decimals(a), decimals(bb), decimals(c ?? "0"), decimals(u));
  let d = toScaled(a, scale) - toScaled(bb, scale);
  if (absL && absR && d < BigInt(0)) d = -d;
  d += toScaled(c ?? "0", scale);
  return Number(floorDiv(d, toScaled(u, scale)));
}

/** A pair receipt whose units the other side decided: words, never an equation. Null when the receipt is the coin's own result. */
export function pairWords(ticker: string, b: FormulaReceipt, settledPair: boolean): string | null {
  if (b.pairRole === "lost") {
    return settledPair
      ? `This coin's side lost this result, so its own reading counts no units. In a pair on one result the losing coin hands its burn to the winner: this receipt counts one unit, and that unit's share of the $${ticker} burn pool moves to the winning coin's burn pool. No $${ticker} is bought or burned.`
      : `This coin lost this period. The ${b.units === 1 ? "unit" : `${b.units} units`} it counts ${b.units === 1 ? "is" : "are"} the winner's, and ${b.units === 1 ? "its" : "their"} share of the $${ticker} burn pool moves to the winning coin's burn pool. No $${ticker} is bought or burned.`;
  }
  if (settledPair && b.pairRole !== "won" && b.units === 0) return "Neither side of the pair is credited with this result, so this coin counts no units for it.";
  return null;
}

/** The method names a game coin's sources ("onchain-payout+thesportsdb+…", "thesportsdb-only-12h-hold"). */
export const isGameMethod = (method: string | null | undefined): boolean => /(^|\+)(onchain-payout|thesportsdb)/.test(method ?? "");
const POLYGON_RPC = "https://polygon-rpc.com";
const conditionOf = (proof: string | null | undefined): string | null => /condition:(0x[0-9a-fA-F]{64})/.exec(proof ?? "")?.[1] ?? null;
const ctfLines = (condition: string): string[] => [
  `cast call ${CTF_POLYGON} 'payoutDenominator(bytes32)(uint256)' ${condition} --rpc-url ${POLYGON_RPC}   # above 0 once the result is on chain`,
  `cast call ${CTF_POLYGON} 'payoutNumerators(bytes32,uint256)(uint256)' ${condition} 0 --rpc-url ${POLYGON_RPC}   # 1 when the first outcome won; use 1 for the second outcome`,
];

/**
 * The command(s) that read the settled result from its source. `feedLine` is the catalogue feed's own line when the rule reads one.
 * A game coin reads the game's on-chain payout (Polymarket's Conditional Tokens contract on Polygon) and a licensed final score
 * (TheSportsDB); a Polymarket coin reads the payout vector; a Kalshi coin reads Kalshi's market API.
 */
export function verifyCommand(i: { oracle: string; eventId: string; settledAt: string; sourceUrl: string | null; method: string | null; proof?: string | null; feedLine: string | null; pairRole?: FormulaReceipt["pairRole"]; ticker: string }): string {
  if (i.feedLine) return i.feedLine;
  if (isGameMethod(i.method)) {
    const day = /^\d{4}-\d{2}-\d{2}$/.test(i.eventId) ? i.eventId : i.settledAt.slice(0, 10);
    const slug = /polymarket\.com\/event\/([a-z0-9-]+)/.exec(i.sourceUrl ?? "")?.[1] ?? null;
    const cond = conditionOf(i.proof);
    const out: string[] = [];
    if (/onchain-payout/.test(i.method ?? "")) {
      out.push("# 1. The game's on-chain payout on Polygon (Polymarket's Conditional Tokens contract).");
      if (!cond) out.push(slug ? `curl -s 'https://gamma-api.polymarket.com/events?slug=${slug}' | jq '.[0].markets[] | {question, conditionId, outcomes}'   # the market's condition id and its outcome order` : "# Find the game's market on polymarket.com; its condition id is in the market's details.");
      out.push(...ctfLines(cond ?? "<conditionId>"));
    }
    out.push(`# ${/onchain-payout/.test(i.method ?? "") ? "2" : "1"}. The licensed final score from TheSportsDB (123 is its free test key).`);
    out.push(`curl -s '${tsdbV1DayUrl("123", day)}' | jq '.events[]? | {strEvent, intHomeScore, intAwayScore, strStatus}'`);
    if (i.pairRole === "lost") out.push(`# $${i.ticker}'s side lost this game, so its unit moved to the winning coin.`);
    return out.join("\n");
  }
  if (i.oracle === "polymarket") {
    const cond = conditionOf(i.proof) ?? (/^0x[0-9a-fA-F]{64}$/.test(i.eventId) ? i.eventId : null);
    return [`curl -s '${i.sourceUrl ?? `https://gamma-api.polymarket.com/markets?condition_ids=${i.eventId}`}' | jq '.[0]? // . | {question, conditionId, outcomes, closed}'   # Polymarket's market record (used only to find the market)`, ...ctfLines(cond ?? "<conditionId>")].join("\n");
  }
  if (i.oracle === "kalshi") return `curl -s '${i.sourceUrl ?? `https://api.elections.kalshi.com/trade-api/v2/markets/${i.eventId}`}' | jq '.market // .markets | if type=="array" then map({ticker, result, expiration_value, settlement_ts}) else {ticker, result, expiration_value, settlement_ts} end'`;
  return i.sourceUrl ? `curl -s '${i.sourceUrl}'   # the source's record for ${i.eventId}` : `# The reading for ${i.eventId} names no source address.`;
}
