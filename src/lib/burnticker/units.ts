import type { BurnMapping, BurnRule, Direction } from "@/lib/burnticker/rules";

/**
 * THE UNIT ENGINE (pure; no node imports, so the wizard's live preview runs the same arithmetic in the browser). Turns one settled
 * event — a Kalshi market's result, a Kalshi event's settled value, or a first-party feed's reading — into UNITS and the mapping that
 * applies, under a locked rule. The keeper then turns units into a spend (buyback: pool × (1 − (1 − f)^units), the keeper's exact
 * integer `buybackSpend`) or a burn (vault: units × tokens).
 *
 * DECIMALS ARE EXACT. Settled values arrive as strings ("7765.36", "84.00", "2.272", "40305316210829.72"); the engine scales them to
 * integers at a common scale and floors in BigInt, so a stranger recomputing a receipt gets the same units to the last digit. No float
 * touches a unit count.
 *
 * CARRY is a property of first-party feeds only (treasury.debt carries the sub-$1B remainder across consecutive increases, as the
 * $DEFICIT keeper does — the catalogue fixes it). Kalshi scalars never carry: each settlement is judged against its baseline alone.
 */

export type EventResult = "yes" | "no" | "void";

/** One settled thing. `value` is the canonical decimal string for scalars (null for binaries); `result` for binaries (null for scalars). */
export interface SettledEvent {
  /** The idempotency id: a Kalshi market ticker (binary), a Kalshi event ticker (scalar), or a feed period ("2026-10-08", "2026-08"). */
  id: string;
  /** ISO settled time (Kalshi settlement_ts) or the period's canonical time (feeds). Ordering key. */
  at: string;
  result: EventResult | null;
  value: string | null;
  title: string | null;
  /** Where a stranger checks it: Kalshi's market page / settlement source, or the feed's exact source row. */
  sourceUrl: string;
  /** How a scalar value was read ("expiration_value", "ladder-between", …), or how a Polymarket result was read ("ctf-payout: …"). */
  method?: string | null;
  /**
   * Where the result can be re-read without trusting us, beyond `sourceUrl`: for Polymarket the on-chain locator of the payout vector
   * ("polygon:137/ctf:<contract>/condition:<id>/payouts:1,0/block:<n>"); null/absent for Kalshi and feeds. Never an input to a rule.
   */
  proof?: string | null;
}

export interface UnitStep {
  units: number;
  /** The mapping that applies (null = nothing burns: NO without onNo, void, flat/wrong-direction scalar). */
  mapping: BurnMapping | null;
  kind: "yes" | "no" | "void" | "up" | "down" | "flat" | "under-unit" | "winddown" | "drain" | "sweep";
  /** Decimal remainder carried out (feeds with carry); "0" otherwise. */
  carryOut: string;
  baseline: string | null;
  note: string;
}

export type CarryPolicy = "none" | "consecutive-increases";

const DEC = /^-?(\d+)(?:\.(\d+))?$/;

/** Decimal string → scaled BigInt at `scale` decimals (throws on anything that is not a plain decimal). */
export function toScaled(s: string | number, scale: number): bigint {
  const str = typeof s === "number" ? numToDec(s) : s.trim();
  const m = DEC.exec(str);
  if (!m) throw new Error(`not a decimal: ${str.slice(0, 40)}`);
  const frac = (m[2] ?? "");
  if (frac.length > scale) throw new Error(`${str} has more than ${scale} decimals`);
  const v = BigInt(m[1]) * BigInt(10) ** BigInt(scale) + BigInt(frac.padEnd(scale, "0") || "0");
  return str.startsWith("-") ? -v : v;
}

/** Scaled BigInt → canonical decimal string (no trailing zeros, no "-0"). */
export function fromScaled(v: bigint, scale: number): string {
  const neg = v < BigInt(0); const a = neg ? -v : v;
  const s = BigInt(10) ** BigInt(scale);
  const whole = (a / s).toString(), frac = scale ? (a % s).toString().padStart(scale, "0").replace(/0+$/, "") : "";
  const out = frac ? `${whole}.${frac}` : whole;
  return neg && out !== "0" ? `-${out}` : out;
}

/** A JS number as a plain decimal string (no exponent), ≤ 12 decimals. */
export function numToDec(n: number): string {
  if (!Number.isFinite(n)) throw new Error("not a finite number");
  let s = n.toFixed(12);
  s = s.replace(/0+$/, "").replace(/\.$/, "");
  return s === "-0" ? "0" : s;
}

const decimalsOf = (s: string): number => { const m = DEC.exec(s.trim()); return m?.[2]?.length ?? 0; };

/** Canonical form of a decimal string ("84.00" → "84", "007.50" → "7.5"). */
export function canonicalDecimal(s: string): string {
  const scale = decimalsOf(s);
  return fromScaled(toScaled(s, scale), scale);
}

/**
 * One event through the rule. `prev` is the previous settled event's value and carried remainder (null for the first event after the
 * token's baseline — a "previousSettlement" rule then records the baseline and burns nothing for it).
 */
export function unitStep(rule: BurnRule, ev: SettledEvent, prev: { value: string | null; carryOut: string } | null, carry: CarryPolicy = "none"): UnitStep {
  if (rule.kind === "binary") {
    const b = rule.binary!;
    if (ev.result === "void" || ev.result === null) return { units: 0, mapping: null, kind: "void", carryOut: "0", baseline: null, note: "voided or unsettled market: no burn (onVoid = skip)" };
    if (ev.result === "yes") return b.onYes ? { units: 1, mapping: b.onYes, kind: "yes", carryOut: "0", baseline: null, note: "settled YES" } : { units: 0, mapping: null, kind: "yes", carryOut: "0", baseline: null, note: "settled YES: no burn (the rule has no onYes)" };
    return b.onNo ? { units: 1, mapping: b.onNo, kind: "no", carryOut: "0", baseline: null, note: "settled NO (onNo applies)" } : { units: 0, mapping: null, kind: "no", carryOut: "0", baseline: null, note: "settled NO: no burn (the rule has no onNo)" };
  }
  const s = rule.scalar!;
  if (ev.result === "void" || ev.value === null) return { units: 0, mapping: null, kind: "void", carryOut: "0", baseline: null, note: "voided market or no settled value: no burn" };
  const baselineStr: string | null = s.baseline === "previousSettlement" ? (prev?.value ?? null) : numToDec(s.baseline);
  if (baselineStr === null) return { units: 0, mapping: null, kind: "flat", carryOut: "0", baseline: null, note: "baseline: the first settlement is recorded; nothing is burned for it" };
  const unitStr = numToDec(s.unit);
  const carryIn = prev?.carryOut ?? "0";
  const scale = Math.max(decimalsOf(ev.value), decimalsOf(baselineStr), decimalsOf(unitStr), decimalsOf(carryIn));
  const now = toScaled(ev.value, scale), base = toScaled(baselineStr, scale), unit = toScaled(unitStr, scale), cin = toScaled(carryIn, scale);
  if (unit <= BigInt(0)) throw new Error("unit must be positive");
  if (cin < BigInt(0) || cin >= unit) throw new Error(`carried remainder ${carryIn} is outside [0, unit) — the record is corrupt`);
  const delta = now - base;
  const dir: Direction = s.direction;
  const moved = dir === "up" ? delta : dir === "down" ? -delta : (delta < BigInt(0) ? -delta : delta);
  if (moved <= BigInt(0)) {
    const kind = delta === BigInt(0) ? "flat" : dir === "up" ? "down" : "up";
    return { units: 0, mapping: null, kind, carryOut: "0", baseline: baselineStr, note: delta === BigInt(0) ? "no change: no burn; carry reset" : `moved ${fromScaled(delta, scale)} (the wrong way for a "${dir}" rule): no burn; carry reset` };
  }
  const total = moved + (carry === "consecutive-increases" ? cin : BigInt(0));
  const units = total / unit;
  const rem = carry === "consecutive-increases" ? total % unit : BigInt(0);
  if (units === BigInt(0)) return { units: 0, mapping: null, kind: "under-unit", carryOut: fromScaled(rem, scale), baseline: baselineStr, note: `moved ${fromScaled(moved, scale)}${carry === "consecutive-increases" && cin > BigInt(0) ? ` (+ ${carryIn} carried)` : ""}: under one unit of ${unitStr}${carry === "consecutive-increases" ? `; ${fromScaled(rem, scale)} carried` : ""}` };
  if (units > BigInt(1_000_000)) throw new Error(`units ${units} exceed the 1,000,000 sanity cap — refused`);
  return { units: Number(units), mapping: s.perUnit, kind: dir === "down" ? "down" : "up", carryOut: fromScaled(rem, scale), baseline: baselineStr, note: `moved ${fromScaled(moved, scale)}${carry === "consecutive-increases" && cin > BigInt(0) ? ` (+ ${carryIn} carried)` : ""} = ${units} unit(s) of ${unitStr}${rem > BigInt(0) ? `; ${fromScaled(rem, scale)} carried` : ""}` };
}

/** Many events in `at` order, threading the previous value and carry. */
export function unitSteps(rule: BurnRule, events: readonly SettledEvent[], carry: CarryPolicy = "none", start: { value: string | null; carryOut: string } | null = null): { event: SettledEvent; step: UnitStep }[] {
  const out: { event: SettledEvent; step: UnitStep }[] = [];
  let prev = start;
  for (const ev of [...events].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : 1))) {
    const step = unitStep(rule, ev, prev, carry);
    out.push({ event: ev, step });
    if (rule.kind === "scalar" && ev.value !== null && ev.result !== "void") prev = { value: ev.value, carryOut: step.carryOut };
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Display-grade totals for previews and back-tests (floating point; the keeper's receipts use the exact integer math in
// @/lib/burnKeeper/rules buybackSpend — these numbers are for the slider, never for a transaction).
// ---------------------------------------------------------------------------------------------------------------------------------

export interface PreviewTotals {
  events: number;
  burnEvents: number;
  voids: number;
  units: number;
  /** Buyback: the share of the pool the whole run would have spent, compounding across events (1 − Π(1 − f)^units). */
  poolFractionSpent: number | null;
  /** Vault: tokens burned over the run. */
  tokens: number | null;
}

export function previewTotals(steps: readonly { step: UnitStep }[]): PreviewTotals {
  let keep = 1, tokens = 0, units = 0, burnEvents = 0, voids = 0, anyFraction = false, anyTokens = false;
  for (const { step } of steps) {
    if (step.kind === "void") voids++;
    if (!step.mapping || step.units === 0) continue;
    burnEvents++; units += step.units;
    if (step.mapping.fractionOfPool !== undefined) { anyFraction = true; keep *= (1 - step.mapping.fractionOfPool) ** step.units; }
    if (step.mapping.tokens !== undefined) { anyTokens = true; tokens += step.mapping.tokens * step.units; }
  }
  return { events: steps.length, burnEvents, voids, units, poolFractionSpent: anyFraction ? 1 - keep : null, tokens: anyTokens ? tokens : null };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// BOTH OR NEITHER (rivalry pairs, owner decision 2026-10-10; rules.ts PairField). Pure: what a step becomes under a pair's clause, and
// the fallback clock a voided pair's coins run on.
// ---------------------------------------------------------------------------------------------------------------------------------

/** A clause pair's state: live (both pools registered before voidBy ended), waiting (on side A, B or both), or voided. */
export type PairGate = { state: "live" } | { state: "waiting"; waitingOn: ("A" | "B")[]; voidBy: string } | { state: "voided"; atMs: number };

/**
 * The receipt status a step gets under a pair's clause: a step that would burn (units > 0 with a mapping) waits as "pending-pair" while
 * the pair is waiting, and is "voided" once the pair voided; a void / nothing step is unchanged (null), as is everything on a live pair.
 */
export function gatedStatus(step: Pick<UnitStep, "units" | "mapping" | "kind">, gate: PairGate | null): "pending-pair" | "voided" | null {
  if (!gate || gate.state === "live" || step.kind === "void" || !step.mapping || step.units <= 0) return null;
  return gate.state === "waiting" ? "pending-pair" : "voided";
}

/** The moment a clause pair voids if either side is still unregistered: the END of its voidBy UTC date. */
export const voidByEndMs = (voidBy: string): number => Date.parse(`${voidBy}T00:00:00Z`) + 86_400_000;

// ---------------------------------------------------------------------------------------------------------------------------------
// NO BURN POOL IS EVER LEFT BEHIND (owner decision 2026-10-10; rules.ts onEnd). Pure: the wind-down schedule, the drain after a one-shot
// YES at 100 %, and the retired-coin sweep — each a daily synthetic receipt the keeper attests like any reading.
// ---------------------------------------------------------------------------------------------------------------------------------

/** The share of the pool a wind-down spends by its last day (≥ 99 %). */
export const WIND_DOWN_TARGET = 0.99;

/**
 * Units per wind-down day for a rule's fraction f: the smallest n with (1 − f)^(n × days) ≤ 1 − WIND_DOWN_TARGET — the geometric daily
 * fraction 1 − (1 − f)^n spends ≥ 99 % within `days` (f = 1 → one unit spends everything).
 */
export function windDownUnits(f: number, days: number): number {
  if (!(f > 0 && f <= 1)) throw new Error(`fraction ${f} is outside (0, 1]`);
  if (f >= 1) return 1;
  const keepPerDay = Math.pow(1 - WIND_DOWN_TARGET, 1 / days);
  return Math.max(1, Math.ceil(Math.log(keepPerDay) / Math.log(1 - f) - 1e-12));
}

/** The schedule: per day its units and the cumulative share spent (before the per-crank cap and the floor). */
export function windDownSchedule(f: number, days: number): { day: number; units: number; spent: number }[] {
  const n = windDownUnits(f, days);
  return Array.from({ length: days }, (_, i) => ({ day: i + 1, units: n, spent: 1 - Math.pow(1 - f, n * (i + 1)) }));
}

/** Units that spend ≥ 99 % of the pool in ONE reading (the sweep's day): (1 − f)^n ≤ 0.01. */
export const fullSpendUnits = (f: number): number => windDownUnits(f, 1);

export type EndReceiptKind = "winddown" | "drain" | "sweep";

/** One synthetic end-of-rule step: `units` of the rule's own mapping (its one fraction per unit, or token count). */
export function endStep(rule: Pick<BurnRule, "kind" | "binary" | "scalar">, kind: EndReceiptKind, units: number): UnitStep {
  const mapping = (rule.kind === "binary" ? rule.binary?.onYes ?? rule.binary?.onNo : rule.scalar?.perUnit) ?? null;
  const note = kind === "drain" ? "one-shot settled YES at 100 % of the pool: one drain unit (its rule spend is the whole pool) until the program carries nothing more"
    : kind === "winddown" ? `the rule ended: the wind-down clock, ${units} unit${units === 1 ? "" : "s"} of the rule's fraction today`
    : `retired coin sweep: ${units} unit${units === 1 ? "" : "s"} — the fee income that arrived after retirement, spent and burned`;
  return { units: mapping ? units : 0, mapping, kind, carryOut: "0", baseline: null, note };
}

/** The first wind-down day for a rule that ended at `endMs`: that UTC date when the end is exactly midnight, else the next one. */
export const firstWindDownDay = (endMs: number): string => new Date(Math.ceil(endMs / 86_400_000) * 86_400_000).toISOString().slice(0, 10);
