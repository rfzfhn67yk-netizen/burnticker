import { rulesSha256 } from "@/lib/burnKeeper/rules";

/**
 * BURNTICKER RULES (2026-10-09; the owner's redesign the same evening: the event space is OPEN). A rule is a SELECTOR plus an
 * outcome → burn mapping, locked at launch and applied to markets that do not exist yet ("every Broncos game from now on", "every
 * daily Denver high", "this one election"). Pure.
 *
 * TWO ORACLES, ONE ENGINE.
 *   · "kalshi" (DISCOVERY ONLY — refused by the launch preflight; Kalshi's terms do not permit settlement on its data): the selector names a Kalshi series, or one market, or a series + filter; `kind` says how the settled result is
 *     read — "binary" (result yes/no → onYes / onNo) or "scalar" (the settled value → units of `unit` from a baseline, in a direction).
 *   · "catalogue" (tier 2, for things no market covers): `series` is a first-party feed id (treasury.debt, bls.eggs, noaa.flares,
 *     ll2.launches, jpl.neo, wiki.views). The feed FIXES unit, direction, baseline and carry; the creator chooses only the mapping.
 *
 * THE MAPPING. Each outcome (or each unit) burns either `fractionOfPool` of the fee pool (buyback: swap SOL → token at market, burn all
 * received; the keeper's spend = pool × (1 − (1 − f)^units), compounding) or `tokens` from a vesting vault (vault mode: units ×
 * tokens, shortfall carried and published). A rule uses one or the other everywhere — hybrid is v2 and refused here.
 *
 * LOCKED BY HASH. The rule is serialised canonically (keys sorted at every level, two-space indent, trailing newline) and that exact
 * text is what the registry stores, the token page publishes as rules.json and the receipts cite as rules=sha256:<12>: the hash is of
 * the bytes, with the keeper's `rulesSha256`, so `shasum -a 256 rules.json` reproduces it. A different rule is a different token.
 */

export const BURNTICKER_RULES_SCHEMA = "burnticker.rules/v1";

/**
 * Where a rule's facts come from. "kalshi" = adjudicated markets (tier 1, live); "polymarket" = adjudicated markets (tier 1, live since
 * 2026-10-10: binary only, the result read from the Conditional Tokens payout vector on Polygon — oracle/polymarket.ts); "catalogue" =
 * a configured primary source (config/burnticker/sources.json: attested-http tiers 3–5) or an on-chain fact; "uma" / "drift-bet" /
 * "hedgehog" are accepted by the schema so the format is forward-compatible, but their adapters are stubs and the launch route refuses them.
 */
export type OracleId = "kalshi" | "catalogue" | "polymarket" | "uma" | "drift-bet" | "hedgehog";
export const ORACLE_IDS: readonly OracleId[] = ["kalshi", "catalogue", "polymarket", "uma", "drift-bet", "hedgehog"];
export const LIVE_ORACLES: readonly OracleId[] = ["kalshi", "catalogue", "polymarket"];
/** Tier-1 adjudicated market oracles: the ones a rivalry pair may use. */
export const PAIR_ORACLES: readonly OracleId[] = ["kalshi", "polymarket"];

/**
 * POLYMARKET SELECTORS (2026-10-10). One market = its CTF condition id, lowercase hex (`market: "0x…64"`), a one-shot. Recurring =
 * `series` in one of two forms:
 *   tag:<tag slug>[/<sports market type>][:<event slug glob>]   every binary market Gamma lists under the tag (e.g. "tag:nfl/moneyline",
 *                                                               "tag:fed-rates", "tag:nfl/moneyline:nfl-*den-*"); the type narrows the
 *                                                               scan on Gamma's side, the glob (`*` = any run) is matched on the event slug
 *   event:<event slug>                                           every binary market of one event (an election night, a Fed meeting)
 * Filters: `titleRegex` over the market question only (`tickerIncludes` is Kalshi's). Binary only in v1 (no scalar).
 */
export const POLY_MARKET_RE = /^0x[0-9a-f]{64}$/;
export const POLY_TAG_SERIES_RE = /^tag:([A-Za-z0-9][A-Za-z0-9-]{0,63})(?:\/([a-z0-9_]{1,40}))?(?::([a-z0-9*][a-z0-9*-]{0,99}))?$/;
export const POLY_EVENT_SERIES_RE = /^event:([a-z0-9][a-z0-9-]{0,127})$/;
export const isPolySeries = (s: string): boolean => POLY_TAG_SERIES_RE.test(s) || POLY_EVENT_SERIES_RE.test(s);
export type Direction = "up" | "down" | "abs";
/** One outcome's burn: a fraction of the fee pool (buyback) OR a count of tokens (vault). Exactly one key. */
export interface BurnMapping { fractionOfPool?: number; tokens?: number }

export interface SelectorFilter { tickerIncludes?: string; titleRegex?: string }

export interface BurnRule {
  schema: typeof BURNTICKER_RULES_SCHEMA;
  oracle: OracleId;
  /** Kalshi: the series ticker (null when `market` names one market). Catalogue: the feed id. */
  series: string | null;
  /** Kalshi: one market ticker — a one-shot rule ("resolves once"). */
  market: string | null;
  filter: SelectorFilter;
  kind: "binary" | "scalar";
  /** At least one of onYes / onNo. A rivalry side burns on exactly one outcome (the other side on the other). */
  binary: { onYes: BurnMapping | null; onNo: BurnMapping | null } | null;
  scalar: { unit: number; perUnit: BurnMapping; baseline: "previousSettlement" | number; direction: Direction } | null;
  /**
   * RIVALRY PAIR (the owner, 2026-10-09 night): two coins on the SAME selector with inverted mappings, launched together. The pairId is
   * part of each side's canonical rule (so the link is locked), each side is hashed independently, and side B's rule carries side A's
   * mint as counterpart (A is created first, so A's counterpart is null in the rule and lives in the registry's pairs table).
   */
  pair: { pairId: string; side: "A" | "B"; counterpartMint: string | null } | null;
  /** A voided / cancelled market yields a VOID receipt and no burn. The only policy in v1. */
  onVoid: "skip";
  /** Buyback: below this (USD at execution) nothing is bought that period. Decimal string, ≤ 2 decimals. */
  floorUsd: string;
  /** Buyback: SOL kept back for fees. Decimal string, ≤ 9 decimals. */
  reserveSol: string;
  /** Vault mode only: the LaunchLab vesting share that funds the vault (0.10–0.30), 12-month linear. Null in buyback mode. */
  vault: { share: number; vestDays: number; cliffDays: number } | null;
}

export type RuleMode = "buyback" | "vault";

export const RULE_BOUNDS = {
  fractionOfPool: { min: 0.01, max: 0.10 },
  vaultShare: { min: 0.10, max: 0.30 },
  tokens: { min: 1, max: 100_000_000 },
  unitMinPositive: 1e-9,
} as const;

/** Fixed supply for every Burnticker token (LaunchLab default; decimals must be 6 — the SDK refuses anything else). */
export const TOTAL_SUPPLY = "1000000000";
export const DECIMALS = 6;

/** The footer appended to every token's description, verbatim. States what the rule does; says nothing about price. */
export const DISCLAIMER_FOOTER = "A memecoin. The rule says what the supply does, not what the price does. The rule is locked at launch and cannot be changed by anyone, including the creator. Burns are funded by the token's own trading fees (or a disclosed vault), recomputable by anyone from the public source and the published rule. Nobody is promised anything.";

/** The one extra line on every oracle-backed page (LAUNCHPAD-PATH §11: closer to an event contract than Treasury data is). */
export const EVENT_CONTRACT_DISCLOSURE = "This token's supply rule reads the SETTLED result of a regulated event contract (Kalshi). The token pays nothing on any outcome and holds no position in any market; it only burns its own supply per the published rule. Market prices are shown for information and are never used by the rule.";
/** The Polymarket counterpart (2026-10-10): the result is the market's payout vector as Polygon's Conditional Tokens contract stores it. */
export const POLYMARKET_DISCLOSURE = "This token's supply rule reads the SETTLED result of a Polymarket market: the payout the Conditional Tokens contract on Polygon records once the market is resolved. The token pays nothing on any outcome and holds no position in any market; it only burns its own supply per the published rule. Market prices are shown for information and are never used by the rule.";
/** The one extra disclosure line for a rule's oracle (null for first-party feeds). */
export const oracleDisclosure = (oracle: OracleId): string | null => (oracle === "kalshi" ? EVENT_CONTRACT_DISCLOSURE : oracle === "polymarket" ? POLYMARKET_DISCLOSURE : null);

/**
 * A catalogue series id: "<source>.<name>" with an optional ":<parameter>" (wiki.views:Bitcoin, github.stars:anza-xyz/agave,
 * edgar.8k:0000320193). Kept to characters the receipt memo's id field accepts (the parameter may carry one "/"). Whether the id
 * names a CONFIGURED source is checked by the catalogue (feedById) at launch and registration, not here — the schema stays static.
 */
export const CATALOGUE_SERIES_RE = /^[a-z][a-z0-9]*\.[A-Za-z0-9_.-]{1,40}(:[A-Za-z0-9_.-]{1,48}(\/[A-Za-z0-9_.-]{1,100})?)?$/;
/** Kept for callers: wiki.views:<Article>. */
export const WIKI_SERIES_RE = /^wiki\.views:[A-Za-z0-9_.-]{1,48}$/;
export const isCatalogueSeries = (s: string): boolean => CATALOGUE_SERIES_RE.test(s);
const TICKER_RE = /^[A-Z0-9][A-Z0-9._-]{1,63}$/;

const isMapping = (m: unknown): m is BurnMapping => !!m && typeof m === "object" && !Array.isArray(m);

/** Which mode a mapping is in; null when it is neither or both. */
export function mappingMode(m: BurnMapping): RuleMode | null {
  const f = m.fractionOfPool !== undefined, t = m.tokens !== undefined;
  if (f && !t) return "buyback";
  if (t && !f) return "vault";
  return null;
}

/** Every mapping the rule carries, labelled. */
export function ruleMappings(r: Pick<BurnRule, "kind" | "binary" | "scalar">): { label: string; mapping: BurnMapping }[] {
  const out: { label: string; mapping: BurnMapping }[] = [];
  if (r.kind === "binary" && r.binary) { if (r.binary.onYes) out.push({ label: "onYes", mapping: r.binary.onYes }); if (r.binary.onNo) out.push({ label: "onNo", mapping: r.binary.onNo }); }
  if (r.kind === "scalar" && r.scalar) out.push({ label: "perUnit", mapping: r.scalar.perUnit });
  return out;
}

/** The rule's mode, from its mappings (all must agree). Throws on a rule that has not been validated. */
export function ruleMode(r: BurnRule): RuleMode {
  const modes = new Set(ruleMappings(r).map((x) => mappingMode(x.mapping)));
  if (modes.size !== 1 || modes.has(null)) throw new Error("rule: mappings do not agree on one mode");
  return [...modes][0] as RuleMode;
}

/**
 * Validates a parsed rule; throws one message listing EVERY problem. Strict: an unknown oracle, a selector that names nothing, a
 * mapping with both keys, a fraction outside the template's bounds — each is a rule a stranger could not reproduce, so it never
 * launches. Returns the rule with its optional fields normalised (null, not undefined), ready for canonical serialisation.
 */
export function validateRule(raw: unknown): BurnRule {
  const p: string[] = [];
  const r = raw as Partial<BurnRule> | null;
  if (!r || typeof r !== "object") throw new Error("rule: not a JSON object");
  if (r.schema !== BURNTICKER_RULES_SCHEMA) p.push(`schema must be "${BURNTICKER_RULES_SCHEMA}"`);
  if (!ORACLE_IDS.includes(r.oracle as OracleId)) p.push(`oracle must be one of ${ORACLE_IDS.join(", ")}`);
  const marketLike = r.oracle === "kalshi" || r.oracle === "polymarket" || r.oracle === "uma" || r.oracle === "drift-bet" || r.oracle === "hedgehog";
  const series = r.series ?? null, market = r.market ?? null;
  if (r.oracle === "polymarket") {
    if (series !== null && (typeof series !== "string" || !isPolySeries(series))) p.push('polymarket: series must be "tag:<tag slug>[/<market type>][:<event slug glob>]" or "event:<event slug>"');
    if (market !== null && (typeof market !== "string" || !POLY_MARKET_RE.test(market))) p.push("polymarket: market must be a condition id (0x + 64 lowercase hex)");
    if (r.kind !== "binary") p.push('polymarket: kind must be "binary" (scalar Polymarket markets are not supported in v1)');
    if (r.filter && typeof r.filter === "object" && (r.filter as SelectorFilter).tickerIncludes !== undefined) p.push("polymarket: filter with titleRegex over the market question (tickerIncludes is for Kalshi tickers)");
  } else {
    if (series !== null && (typeof series !== "string" || !TICKER_RE.test(series) && !isCatalogueSeries(series))) p.push("series must be a ticker (A–Z, 0–9, . _ -) or null");
    if (market !== null && (typeof market !== "string" || !TICKER_RE.test(market))) p.push("market must be a market ticker or null");
  }
  if (marketLike) {
    if (series === null && market === null) p.push(`${r.oracle}: name a series or a market`);
    if (series !== null && market !== null) p.push(`${r.oracle}: a series OR one market, not both`);
  }
  if (r.oracle === "catalogue") {
    if (!series || !isCatalogueSeries(series)) p.push("catalogue: series must be a source id like treasury.debt or wiki.views:<Article> (config/burnticker/sources.json)");
    if (market !== null) p.push("catalogue: market must be null");
    if (r.kind !== "scalar") p.push('catalogue: kind must be "scalar" (the feed fixes the unit)');
  }
  const filter = (r.filter ?? {}) as SelectorFilter;
  if (typeof filter !== "object" || Array.isArray(filter)) p.push("filter must be an object");
  else {
    if (filter.tickerIncludes !== undefined && (typeof filter.tickerIncludes !== "string" || !/^[A-Z0-9._-]{1,32}$/.test(filter.tickerIncludes))) p.push("filter.tickerIncludes must be 1–32 ticker characters");
    if (filter.titleRegex !== undefined) {
      if (typeof filter.titleRegex !== "string" || filter.titleRegex.length > 120) p.push("filter.titleRegex must be a string ≤ 120 chars");
      else try { new RegExp(filter.titleRegex); } catch { p.push("filter.titleRegex is not a valid regular expression"); }
    }
    if (market !== null && (filter.tickerIncludes !== undefined || filter.titleRegex !== undefined)) p.push("a one-market rule takes no filter");
    for (const k of Object.keys(filter)) if (k !== "tickerIncludes" && k !== "titleRegex") p.push(`filter.${k} is not a known key`);
  }
  if (r.kind !== "binary" && r.kind !== "scalar") p.push('kind must be "binary" or "scalar"');
  const checkMapping = (label: string, m: unknown): void => {
    if (!isMapping(m)) { p.push(`${label} must be { fractionOfPool } or { tokens }`); return; }
    const mode = mappingMode(m);
    if (!mode) { p.push(`${label} must set exactly one of fractionOfPool, tokens`); return; }
    for (const k of Object.keys(m)) if (k !== "fractionOfPool" && k !== "tokens") p.push(`${label}.${k} is not a known key`);
    if (mode === "buyback") {
      const f = m.fractionOfPool as number;
      if (typeof f !== "number" || !Number.isFinite(f) || f < RULE_BOUNDS.fractionOfPool.min || f > RULE_BOUNDS.fractionOfPool.max || Math.round(f * 1e6) !== f * 1e6) p.push(`${label}.fractionOfPool must be a number in [${RULE_BOUNDS.fractionOfPool.min}, ${RULE_BOUNDS.fractionOfPool.max}] with ≤ 6 decimals`);
    } else {
      const t = m.tokens as number;
      if (!Number.isInteger(t) || t < RULE_BOUNDS.tokens.min || t > RULE_BOUNDS.tokens.max) p.push(`${label}.tokens must be a whole number in [${RULE_BOUNDS.tokens.min}, ${RULE_BOUNDS.tokens.max}]`);
    }
  };
  if (r.kind === "binary") {
    if (!r.binary || typeof r.binary !== "object") p.push("binary: { onYes, onNo } required");
    else {
      const hasYes = r.binary.onYes !== null && r.binary.onYes !== undefined, hasNo = r.binary.onNo !== null && r.binary.onNo !== undefined;
      if (!hasYes && !hasNo) p.push("binary: at least one of onYes, onNo");
      if (hasYes) checkMapping("binary.onYes", r.binary.onYes);
      if (hasNo) checkMapping("binary.onNo", r.binary.onNo);
    }
    if (r.scalar) p.push("binary rule: scalar must be null");
  }
  // Rivalry pair: tier-1 (adjudicated market) sources only in v1; a scalar side needs a direction that can be flipped (not abs).
  const pair = r.pair ?? null;
  if (pair !== null) {
    if (typeof pair !== "object") p.push("pair must be { pairId, side, counterpartMint } or null");
    else {
      if (typeof pair.pairId !== "string" || !/^[a-z0-9][a-z0-9-]{3,39}$/.test(pair.pairId)) p.push("pair.pairId must be 4–40 lowercase letters/digits/dashes");
      if (pair.side !== "A" && pair.side !== "B") p.push('pair.side must be "A" or "B"');
      if (pair.counterpartMint !== null && (typeof pair.counterpartMint !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(pair.counterpartMint))) p.push("pair.counterpartMint must be a Solana address or null");
      if (pair.side === "B" && pair.counterpartMint === null) p.push("pair side B must name side A's mint as counterpartMint");
      if (!PAIR_ORACLES.includes(r.oracle as OracleId)) p.push("pair: v1 pairs must use a tier-1 adjudicated market source (kalshi or polymarket)");
      if (r.kind === "scalar" && r.scalar && r.scalar.direction === "abs") p.push('pair: a scalar side needs direction "up" or "down" (abs cannot be inverted)');
      if (r.kind === "binary" && r.binary && r.binary.onYes && r.binary.onNo) p.push("pair: a binary side burns on exactly one outcome (onYes or onNo, not both)");
      for (const k of Object.keys(pair)) if (!["pairId", "side", "counterpartMint"].includes(k)) p.push(`pair.${k} is not a known key`);
    }
  }
  if (r.kind === "scalar") {
    const s = r.scalar;
    if (!s || typeof s !== "object") p.push("scalar: { unit, perUnit, baseline, direction } required");
    else {
      if (typeof s.unit !== "number" || !Number.isFinite(s.unit) || s.unit < RULE_BOUNDS.unitMinPositive) p.push("scalar.unit must be a positive number");
      checkMapping("scalar.perUnit", s.perUnit);
      if (s.baseline !== "previousSettlement" && (typeof s.baseline !== "number" || !Number.isFinite(s.baseline))) p.push('scalar.baseline must be "previousSettlement" or a number');
      if (s.direction !== "up" && s.direction !== "down" && s.direction !== "abs") p.push('scalar.direction must be "up", "down" or "abs"');
    }
    if (r.binary) p.push("scalar rule: binary must be null");
  }
  if (r.onVoid !== "skip") p.push('onVoid must be "skip"');
  if (typeof r.floorUsd !== "string" || !/^\d+(\.\d{1,2})?$/.test(r.floorUsd)) p.push("floorUsd must be a decimal string with ≤ 2 decimals");
  if (typeof r.reserveSol !== "string" || !/^\d+(\.\d{1,9})?$/.test(r.reserveSol)) p.push("reserveSol must be a decimal string with ≤ 9 decimals");
  // Mode agreement and the vault block.
  const modes = new Set(ruleMappings({ kind: r.kind as BurnRule["kind"], binary: (r.binary ?? null) as BurnRule["binary"], scalar: (r.scalar ?? null) as BurnRule["scalar"] }).map((x) => (isMapping(x.mapping) ? mappingMode(x.mapping) : null)));
  if (modes.size > 1) p.push("all mappings must use the same mode (fractionOfPool everywhere, or tokens everywhere) — hybrid is v2");
  const mode = modes.size === 1 ? [...modes][0] : null;
  const vault = r.vault ?? null;
  if (mode === "vault") {
    if (!vault || typeof vault !== "object") p.push("vault mode: vault { share, vestDays, cliffDays } required");
    else {
      if (typeof vault.share !== "number" || vault.share < RULE_BOUNDS.vaultShare.min || vault.share > RULE_BOUNDS.vaultShare.max || Math.round(vault.share * 100) !== vault.share * 100) p.push(`vault.share must be in [${RULE_BOUNDS.vaultShare.min}, ${RULE_BOUNDS.vaultShare.max}] with ≤ 2 decimals`);
      if (!Number.isInteger(vault.vestDays) || vault.vestDays < 30 || vault.vestDays > 1460) p.push("vault.vestDays must be a whole number 30–1460");
      if (!Number.isInteger(vault.cliffDays) || vault.cliffDays < 0 || vault.cliffDays > 365) p.push("vault.cliffDays must be a whole number 0–365");
    }
  } else if (vault !== null) p.push("buyback mode: vault must be null");
  for (const k of Object.keys(r)) if (!["schema", "oracle", "series", "market", "filter", "kind", "binary", "scalar", "onVoid", "floorUsd", "reserveSol", "vault", "pair"].includes(k)) p.push(`${k} is not a known key`);
  if (p.length) throw new Error(`rule: ${p.join("; ")}`);
  return {
    schema: BURNTICKER_RULES_SCHEMA, oracle: r.oracle as OracleId, series, market, filter,
    kind: r.kind as BurnRule["kind"],
    binary: r.kind === "binary" ? { onYes: r.binary!.onYes ?? null, onNo: r.binary!.onNo ?? null } : null,
    scalar: r.kind === "scalar" ? { unit: r.scalar!.unit, perUnit: r.scalar!.perUnit, baseline: r.scalar!.baseline, direction: r.scalar!.direction } : null,
    onVoid: "skip", floorUsd: r.floorUsd as string, reserveSol: r.reserveSol as string, vault: mode === "vault" ? vault : null,
    pair: pair === null ? null : { pairId: pair.pairId, side: pair.side, counterpartMint: pair.counterpartMint ?? null },
  };
}

/**
 * RIVALRY: side B's rule from side A's — the same selector, the mapping inverted (binary: swap onYes/onNo; scalar: flip up↔down),
 * the same pairId, side "B", side A's mint as counterpart. Validated, so an un-invertible side A (abs, or a binary that burns on
 * both outcomes) throws. Each side is then hashed on its own (lockRule): two rules, two hashes, one pairId in both.
 */
export function invertMapping(a: BurnRule, counterpartMint: string | null, pairId: string = a.pair?.pairId ?? ""): BurnRule {
  const base = { ...a, pair: { pairId, side: "B" as const, counterpartMint } };
  if (a.kind === "binary" && a.binary) return validateRule({ ...base, binary: { onYes: a.binary.onNo, onNo: a.binary.onYes } });
  if (a.kind === "scalar" && a.scalar) return validateRule({ ...base, scalar: { ...a.scalar, direction: a.scalar.direction === "up" ? "down" : a.scalar.direction === "down" ? "up" : "abs" } });
  throw new Error("invertMapping: not a binary or scalar rule");
}

/** A pair id from the two tickers and the selector (lowercase, dashed; deterministic so a retry does not mint a second pair). */
export function pairIdFor(tickerA: string, tickerB: string, selector: string): string {
  return `${tickerA}-vs-${tickerB}-${selector}`.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 40).replace(/-$/, "");
}

/** Keys sorted at every level, two-space indent, trailing newline — one spelling per rule. */
export function canonicalJson(v: unknown): string {
  const sort = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(sort);
    if (x && typeof x === "object") return Object.fromEntries(Object.keys(x as object).sort().map((k) => [k, sort((x as Record<string, unknown>)[k])]));
    return x;
  };
  return `${JSON.stringify(sort(v), null, 2)}\n`;
}

export interface LockedRule { rule: BurnRule; text: string; sha256: string; sha12: string; mode: RuleMode }

/** Validate → canonical text → hash. The text is what gets stored and published; the hash is of exactly those bytes. */
export function lockRule(raw: unknown): LockedRule {
  const rule = validateRule(raw);
  const text = canonicalJson(rule);
  const sha256 = rulesSha256(text);
  return { rule, text, sha256, sha12: sha256.slice(0, 12), mode: ruleMode(rule) };
}

/** Parse a stored canonical text back; refuses text whose bytes do not re-serialise to themselves (an edited rules.json). */
export function rulesFromText(text: string): LockedRule {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new Error("rule: not valid JSON"); }
  const locked = lockRule(raw);
  if (locked.text !== text) throw new Error("rule: the text is not in canonical form (re-serialising it changes the bytes, so its hash would not be the published one)");
  return locked;
}

const pctOf = (f: number) => `${(f * 100).toFixed(f * 100 % 1 === 0 ? 0 : 2)}%`;
const mapText = (m: BurnMapping, what: string) => (m.fractionOfPool !== undefined ? `spends ${pctOf(m.fractionOfPool)} of the fee pool buying the token at market and burns everything received ${what}` : `burns ${m.tokens!.toLocaleString("en-US")} tokens from the vault ${what}`);

/** The rule in one plain paragraph for the review step and the token page. States the rule; says nothing about price. */
/** A Polymarket selector in words ("every binary Polymarket market tagged nfl of type moneyline whose event slug matches nfl-*den-*"). */
export function polySelectorText(r: Pick<BurnRule, "series" | "market" | "filter">, names: { seriesTitle?: string | null; marketTitle?: string | null } = {}): string {
  const re = r.filter.titleRegex ? ` whose question matches /${r.filter.titleRegex}/` : "";
  if (r.market) { const t = names.marketTitle ?? names.seriesTitle; return `the Polymarket market ${r.market}${t ? ` ("${t}")` : ""}`; }
  const t = POLY_TAG_SERIES_RE.exec(r.series ?? "");
  if (t) return `every binary Polymarket market tagged "${t[1]}"${names.seriesTitle && names.seriesTitle !== t[1] ? ` (${names.seriesTitle})` : ""}${t[2] ? ` of type ${t[2]}` : ""}${t[3] ? ` whose event slug matches ${t[3]}` : ""}${re}`;
  const e = POLY_EVENT_SERIES_RE.exec(r.series ?? "");
  return `every binary market of the Polymarket event ${e ? e[1] : r.series}${names.seriesTitle ? ` ("${names.seriesTitle}")` : ""}${re}`;
}

export function ruleStatement(r: BurnRule, names: { seriesTitle?: string | null; marketTitle?: string | null; feedTitle?: string | null } = {}): string {
  const what = r.oracle === "catalogue" ? `the ${names.feedTitle ?? r.series} feed`
    : r.oracle === "polymarket" ? polySelectorText(r, names)
    : r.market ? `the Kalshi market ${r.market}${names.marketTitle ? ` ("${names.marketTitle}")` : ""}`
    : `every market in the Kalshi series ${r.series}${names.seriesTitle ? ` ("${names.seriesTitle}")` : ""}${r.filter.tickerIncludes ? ` whose ticker contains "${r.filter.tickerIncludes}"` : ""}${r.filter.titleRegex ? ` whose title matches /${r.filter.titleRegex}/` : ""}`;
  if (r.kind === "binary" && r.binary) {
    const yes = r.binary.onYes ? `When ${what} settles YES, the keeper ${mapText(r.binary.onYes, "for that market")}.` : `A YES settlement of ${what} burns nothing.`;
    const no = r.binary.onNo ? ` When it settles NO, ${r.binary.onYes ? "it" : "the keeper"} ${mapText(r.binary.onNo, "for that market")}.` : " A NO settlement burns nothing.";
    const pair = r.pair ? ` Rivalry pair ${r.pair.pairId}, side ${r.pair.side}: the other side burns on the opposite outcome, so each settlement burns exactly one of the two.` : "";
    const poly = r.oracle === "polymarket" ? " YES is the market's first outcome and NO its second; the result is the payout the Conditional Tokens contract on Polygon records, and a 50-50 resolution is a void." : "";
    return `${yes}${no}${pair}${poly} A voided market burns nothing. Settled results only; prices are never read.`;
  }
  const s = r.scalar!;
  const base = s.baseline === "previousSettlement" ? "the previous settlement" : `a fixed baseline of ${s.baseline}`;
  const dir = s.direction === "up" ? "above" : s.direction === "down" ? "below" : "away from (either direction)";
  const pair = r.pair ? ` Rivalry pair ${r.pair.pairId}, side ${r.pair.side}: the other side counts the opposite direction.` : "";
  return `Each time ${what} settles, every full ${s.unit} ${dir} ${base} is one unit, and the keeper ${mapText(s.perUnit, "per unit")} (buyback spend compounds: pool × (1 − (1 − f)^units)).${pair} A voided market burns nothing. Settled results only; prices are never read.`;
}

/** The description footer: feed/selector, the rule hash and the fixed disclaimer. */
export function descriptionFooter(locked: LockedRule): string {
  const r = locked.rule;
  const src = r.oracle === "catalogue" ? `feed ${r.series}` : r.oracle === "polymarket" ? (r.market ? `Polymarket market ${r.market}` : `Polymarket ${r.series}`) : r.market ? `Kalshi market ${r.market}` : `Kalshi series ${r.series}${r.filter.tickerIncludes ? ` (ticker ∋ ${r.filter.tickerIncludes})` : ""}`;
  return `— ${src} · rule sha256:${locked.sha12} · ${DISCLAIMER_FOOTER}`;
}
