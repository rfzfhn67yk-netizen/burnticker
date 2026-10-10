import { BURNTICKER_RULES_SCHEMA, canonicalJson, lockRule, rulesFromText, ruleStatement, validateRule, RULE_BOUNDS, type BurnMapping, type BurnRule, type LockedRule, type OracleId, type SelectorFilter } from "@/lib/burnticker/rules";
import { receiptFormatTemplate } from "@/lib/burnticker/receipt";

/**
 * RULES, LOCALLY. A Burnticker rule is a SELECTOR (which settled events count) plus a MAPPING (what each burns), locked at launch by
 * the sha256 of its canonical JSON. These functions are the platform's own (src/lib/burnticker/rules.ts), not a re-implementation:
 * a hash computed here is byte-for-byte the hash the launch bundle, the registry, the token page and every receipt memo carry.
 */

/** Which settled events count. Kalshi: a series (+ optional filter) or one market. Polymarket: a condition id as `market`, or `series` "tag:<slug>[/<type>][:<event glob>]" / "event:<slug>" (+ titleRegex). Catalogue: a source id as `series`. */
export interface Selector { oracle?: OracleId; series?: string | null; market?: string | null; filter?: SelectorFilter }

/** What each settled event burns, and the buyback guards. Exactly one of `binary` / `scalar` for the rule's `kind`. */
export interface Mapping {
  kind: "binary" | "scalar";
  binary?: { onYes: BurnMapping; onNo?: BurnMapping | null } | null;
  scalar?: { unit: number; perUnit: BurnMapping; baseline: "previousSettlement" | number; direction: "up" | "down" | "abs" } | null;
  /** Buyback: below this USD amount at execution nothing is bought that period. Default "1". */
  floorUsd?: string;
  /** Buyback: SOL kept back for fees. Default "0.02". */
  reserveSol?: string;
  /** Vault mode only (tokens mappings): the vesting share 0.10–0.30. */
  vault?: { share: number; vestDays: number; cliffDays: number } | null;
}

export type Validation = { ok: true; rule: BurnRule } | { ok: false; problems: string[] };

/**
 * Selector + mapping → a full rule object (defaults filled: schema, oracle "kalshi", empty filter, onVoid "skip", floor $1, reserve
 * 0.02 SOL). Not validated — pass the result to validate()/lock().
 */
export function compose(selector: Selector, mapping: Mapping): Record<string, unknown> {
  return {
    schema: BURNTICKER_RULES_SCHEMA, oracle: selector.oracle ?? "kalshi", series: selector.series ?? null, market: selector.market ?? null, filter: selector.filter ?? {},
    kind: mapping.kind,
    binary: mapping.kind === "binary" && mapping.binary ? { onYes: mapping.binary.onYes, onNo: mapping.binary.onNo ?? null } : null,
    scalar: mapping.kind === "scalar" ? mapping.scalar ?? null : null,
    onVoid: "skip", floorUsd: mapping.floorUsd ?? "1", reserveSol: mapping.reserveSol ?? "0.02", vault: mapping.vault ?? null,
  };
}

/** Accepts a full rule, or (selector, mapping). */
const asRule = (a: unknown, b?: Mapping): unknown => (b ? compose(a as Selector, b) : a);

/** Every problem with a rule, or the normalised rule. Never throws. */
export function validate(rule: unknown, mapping?: Mapping): Validation {
  try { return { ok: true, rule: validateRule(asRule(rule, mapping)) }; } catch (e) { return { ok: false, problems: (e as Error).message.replace(/^rule: /, "").split("; ") }; }
}

/** The canonical JSON text (the exact bytes rules.json holds). Throws on an invalid rule. */
export function canonical(rule: unknown, mapping?: Mapping): string { return lockRule(asRule(rule, mapping)).text; }

/** sha256 (hex) of the canonical text — what `shasum -a 256 rules.json` prints and what receipts cite (first 12 hex). */
export function sha256(rule: unknown, mapping?: Mapping): string { return lockRule(asRule(rule, mapping)).sha256; }

/** Validate → canonical text → hash → mode, in one object. Throws listing every problem. */
export function lock(rule: unknown, mapping?: Mapping): LockedRule { return lockRule(asRule(rule, mapping)); }

/** Parse a published rules.json; refuses text that is not in canonical form (its hash would not be the published one). */
export function fromText(text: string): LockedRule { return rulesFromText(text); }

/** The rule in one plain paragraph (states the rule; says nothing about price). */
export function statement(rule: unknown, names: { seriesTitle?: string | null; feedTitle?: string | null } = {}): string { return ruleStatement(validateRule(rule), names); }

/** The receipt format every burn of a coin with this rule writes on chain (the wizard's review shows the same text). */
export function receiptFormat(ticker: string, rule: unknown): string { const l = lockRule(rule); return receiptFormatTemplate(ticker.toUpperCase(), l.rule.oracle, l.sha12); }

export const rules = { compose, validate, canonical, sha256, lock, fromText, statement, receiptFormat, canonicalJson, BOUNDS: RULE_BOUNDS, SCHEMA: BURNTICKER_RULES_SCHEMA };
