import crypto from "node:crypto";
import fs from "node:fs";

/**
 * THE BURN RULE FILE (event-indexed burn keeper, 2026-10-09 — the owner's first launch, ticker $DEFICIT ("reads DeFi-cit", the
 * owner, 10-09 evening; the working ticker that morning was $PENNY), the "$DEBT" rule of
 * mct-runner-study/launch-debt-egg-2026-10-09/SPEC.md §2). Pure apart from `loadRules`, which reads one file.
 *
 * THE RULE KEY IS "DEBT", NOT THE TICKER. Every memo opens `DEBT|…` whatever the coin is called, so the on-chain format never changes
 * if the ticker does (the owner, 10-09). The file is config/burnkeeper/deficit.rules.json.
 *
 * WHY A FILE WITH A HASH. The spec's one idea (§0) is a supply that shrinks by a PUBLIC number nobody involved controls, every burn
 * reproducible by a stranger from the source data and the published rule. So the rule is data, not code: config/burnkeeper/
 * debt.rules.json, fixed at launch, published byte-for-byte with its sha256 (in the token metadata and in every on-chain memo as
 * `rules=sha256:<first 12 hex>`). The hash is of the FILE'S EXACT BYTES — not of a re-serialisation — so anyone can `shasum -a 256`
 * the published file and get the same answer. A rule change is a new file, a new hash and (the spec's words) "a new token".
 *
 * THE $DEBT RULE (SPEC §2, verbatim in effect):
 *   · unit = every full $1,000,000,000 added to tot_pub_debt_out_amt since the previous reading (floor; the remainder carries)
 *   · burn = 0.01% of total supply = 100,000 tokens per unit
 *   · a down day burns nothing, banks no credit, and RESETS the carried remainder to 0 ("the counter only ever moves on increases" —
 *     the simplest honest rule). A flat day (delta exactly 0) is not an increase either, so it breaks the run the same way.
 *   · never un-burn; burns come only from the vault; when the vault's allocation is used up the token is simply fixed-supply.
 *
 * BUYBACK IS THE PRIMARY MECHANIC (the owner, 10-09 later that evening): the same units, but a burn day spends a rule-fixed share of
 * the keeper's fee pool — spend = pool × (1 − (1 − f)^units), f = fractionPerUnit, 1% in the committed file while the owner decides
 * between 1% and 5% (the file carries the note; 10-09) — buying the token at market and burning everything received (mode
 * "buyback", memo v2). The vesting vault below stays implemented as the alternative (mode "vault", memo v1).
 *
 * THE VAULT VESTS (the owner, 10-09 evening: the venue is Raydium LaunchLab, and the burn vault is a LaunchLab VESTING allocation to
 * the keeper's token account, locked at launch and released linearly). So the vault can hold LESS than a day's burn even though the
 * allocation is far from used up. The keeper then burns what is there — min(units × 100,000 + shortfall carried, vault balance) — and
 * the unburned remainder is a PUBLIC SHORTFALL: on the ledger, in the memo (`short=…`), on the status page, carried forward and burned
 * as soon as the vault refills. A day is never failed silently: with an empty (but not exhausted) vault the keeper still posts the
 * day's memo, `burn=0|short=…`, in a memo-only transaction. The shortfall is capped at what is left of the allocation, so once the
 * allocation is fully burned nothing more is owed and the keeper stops, as the spec says.
 *
 * MONEY IS INTEGER CENTS (BigInt). Treasury publishes the figure with two decimals ("40305316210829.72"); a float carries ~15–16
 * significant digits and a $40T figure in cents needs 16, so `Number` arithmetic would round the carried remainder and a stranger's
 * exact recomputation would disagree with the keeper by a cent now and a unit eventually. Strings in, BigInt cents through, strings out.
 */

/** The only schema this keeper reads. A future rule format is a new schema string, never a silent reinterpretation of this one. */
export const RULES_SCHEMA = "burnkeeper.rules/v1";

export interface DebtRuleFile {
  schema: typeof RULES_SCHEMA;
  /** The feed tag that opens every memo ("DEBT"). Not the ticker: the ticker can change before launch, the feed's name cannot. */
  token: string;
  /** The coin's ticker (2026-10-09 evening: "DEFICIT") — display only, never part of the arithmetic or the memo. */
  ticker: string;
  chain: "solana";
  /**
   * HOW A BURN IS FUNDED. "buyback" (the PRIMARY mechanic, the owner 2026-10-09 evening): each burn day the keeper spends a rule-fixed
   * share of its fee pool (the creator-fee SOL it claims, plus a disclosed seed) buying the token on the public pool, and burns every
   * token received. "vault" (the alternative, kept implemented): burns come from a vesting vault allocation (`vault`, below).
   */
  mode: "buyback" | "vault";
  /** The mint, once known (a LaunchLab mint can be generated before launch). Mainnet buyback requires it to equal BURNKEEPER_MINT. */
  mint: string | null;
  /**
   * BUYBACK PARAMETERS (mode "buyback"). Per burn day: spend = pool × (1 − (1 − fractionPerUnit)^units), pool = the keeper's SOL
   * minus reserveSol (kept for fees). Below floorUsd nothing is bought that day (the pool keeps it). Program execution (the launch
   * path since 2026-10-10): burn_receipts' crank_buyback swaps on the token's CPMM pool at slippageBps and burns what it receives in the
   * same instruction. `router` is optional and legacy-only: the deprecated keeper leg always swaps through Jupiter. Never sells.
   */
  buyback: { feeAsset: "SOL"; fractionPerUnit: string; floorUsd: string; reserveSol: string; slippageBps: number; router?: "jupiter"; burnShare: "all-received" };
  /** Whole tokens, as a decimal string (1,000,000,000). */
  totalSupply: string;
  /** SPL decimals of the mint (Pump.fun mints use 6). Raw amount = tokens × 10^decimals. */
  decimals: number;
  /**
   * Whole tokens allocated to the burn vault over its vest (the LaunchLab vesting share; 20–30% of supply is the owner's range on
   * 10-09 — `burn-keeper --vault-pace` prints what each lasts). Caps the total the rule can ever burn and the shortfall it can owe.
   */
  vaultAllocation: string;
  /** How the vault is funded. "vesting": released linearly by the venue (LaunchLab), so a shortfall is possible and is carried. */
  vault: { kind: "vesting" | "upfront"; cliffDays: number; vestDays: number; shortfall: "carry-until-vault-refills" };
  feed: {
    id: string;
    name: string;
    url: string;
    dateField: "record_date";
    field: "tot_pub_debt_out_amt";
    /** The `src=` text of the memo, exactly. */
    memoSource: string;
  };
  rule: {
    kind: "increase-units";
    /** Dollars per unit (decimal string, whole dollars): "1000000000". */
    unitUsd: string;
    /** Whole tokens burned per unit: "100000". */
    burnPerUnitTokens: string;
    carry: "consecutive-increases";
    onNonIncrease: "burn-nothing-reset-carry";
    /** Plausibility bound (SPEC brief: refuse > $2T/day): a |delta| above this is refused, never burned. Whole dollars. */
    maxAbsDeltaUsd: string;
  };
  /** Must agree with `mode`: "fee-pool-buyback" for buyback, "vault-only" for vault. */
  source: "vault-only" | "fee-pool-buyback";
  schedule: { timeZone: "America/New_York"; polls: string[] };
  /** v1 = the vault memo (SPEC §4); v2 = the buyback memo (pool/spent/got/burn/swap). The version follows the mode. */
  memo: { prefix: string; version: "v1" | "v2"; maxBytes: number };
  /** The rule in one plain sentence, for the status page. States the rule; says nothing about price (SPEC §9.2). */
  statement: string;
}

export interface LoadedRules {
  rules: DebtRuleFile;
  /** sha256 of the file's exact bytes, 64 hex. */
  sha256: string;
  /** The memo's `rules=sha256:<12>`. */
  sha12: string;
  /** The exact bytes, for publishing beside the status page. */
  text: string;
}

const DEC = /^[0-9]+$/;

/** sha256 of the exact bytes. */
export function rulesSha256(text: string | Uint8Array): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

/**
 * Validates a parsed rule file; throws one message listing EVERY problem (a file fixed for one complaint should not fail on the
 * next). Strict on purpose: an unknown rule kind, a missing carry policy or a non-integer amount is a file this keeper does not
 * understand, and a keeper that guesses is a keeper whose burns a stranger cannot reproduce.
 */
export function parseRules(raw: unknown): DebtRuleFile {
  const problems: string[] = [];
  const r = raw as Partial<DebtRuleFile> | null;
  if (!r || typeof r !== "object") throw new Error("rules: not a JSON object");
  if (r.schema !== RULES_SCHEMA) problems.push(`schema must be "${RULES_SCHEMA}" (got ${JSON.stringify(r.schema)})`);
  if (typeof r.token !== "string" || !/^[A-Z0-9]{2,12}$/.test(r.token)) problems.push("token must be 2–12 capitals/digits (the memo prefix)");
  if (typeof r.ticker !== "string" || !/^[A-Z0-9]{2,12}$/.test(r.ticker)) problems.push("ticker must be 2–12 capitals/digits");
  if (!r.vault || (r.vault.kind !== "vesting" && r.vault.kind !== "upfront") || !Number.isInteger(r.vault.cliffDays) || r.vault.cliffDays < 0 || !Number.isInteger(r.vault.vestDays) || r.vault.vestDays < 0 || r.vault.shortfall !== "carry-until-vault-refills") problems.push('vault must be { kind: "vesting"|"upfront", cliffDays ≥ 0, vestDays ≥ 0, shortfall: "carry-until-vault-refills" }');
  if (r.chain !== "solana") problems.push('chain must be "solana"');
  for (const k of ["totalSupply", "vaultAllocation"] as const) if (typeof r[k] !== "string" || !DEC.test(r[k] as string) || BigInt(r[k] as string) <= BigInt(0)) problems.push(`${k} must be a positive whole-number string`);
  if (!Number.isInteger(r.decimals) || (r.decimals as number) < 0 || (r.decimals as number) > 9) problems.push("decimals must be an integer 0–9");
  const f = r.feed;
  if (!f || typeof f !== "object") problems.push("feed missing");
  else {
    if (f.dateField !== "record_date") problems.push('feed.dateField must be "record_date"');
    if (f.field !== "tot_pub_debt_out_amt") problems.push('feed.field must be "tot_pub_debt_out_amt"');
    if (typeof f.url !== "string" || !f.url.startsWith("https://api.fiscaldata.treasury.gov/")) problems.push("feed.url must be the fiscaldata.treasury.gov API");
    if (typeof f.memoSource !== "string" || !f.memoSource || f.memoSource.includes("|")) problems.push("feed.memoSource must be non-empty and contain no '|'");
    if (typeof f.id !== "string" || !f.id) problems.push("feed.id missing");
  }
  const u = r.rule;
  if (!u || typeof u !== "object") problems.push("rule missing");
  else {
    if (u.kind !== "increase-units") problems.push('rule.kind must be "increase-units"');
    for (const k of ["unitUsd", "burnPerUnitTokens", "maxAbsDeltaUsd"] as const) if (typeof u[k] !== "string" || !DEC.test(u[k]) || BigInt(u[k]) <= BigInt(0)) problems.push(`rule.${k} must be a positive whole-number string`);
    if (u.carry !== "consecutive-increases") problems.push('rule.carry must be "consecutive-increases"');
    if (u.onNonIncrease !== "burn-nothing-reset-carry") problems.push('rule.onNonIncrease must be "burn-nothing-reset-carry"');
  }
  if (r.mode !== "buyback" && r.mode !== "vault") problems.push('mode must be "buyback" or "vault"');
  if (r.mint !== null && (typeof r.mint !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(r.mint))) problems.push("mint must be null or a Solana address");
  const bb = r.buyback;
  if (!bb || bb.feeAsset !== "SOL" || (bb.router !== undefined && bb.router !== "jupiter") || bb.burnShare !== "all-received" || typeof bb.fractionPerUnit !== "string" || !/^0\.\d{1,6}$/.test(bb.fractionPerUnit) || Number(bb.fractionPerUnit) <= 0
    || typeof bb.floorUsd !== "string" || !/^\d+(\.\d{1,2})?$/.test(bb.floorUsd) || typeof bb.reserveSol !== "string" || !/^\d+(\.\d{1,9})?$/.test(bb.reserveSol)
    || !Number.isInteger(bb.slippageBps) || bb.slippageBps < 1 || bb.slippageBps > 5000) problems.push('buyback must be { feeAsset: "SOL", fractionPerUnit: "0.xx" (0 < f < 1), floorUsd, reserveSol, slippageBps 1–5000, router: "jupiter" (optional, legacy only), burnShare: "all-received" }');
  const wantSource = r.mode === "buyback" ? "fee-pool-buyback" : "vault-only";
  if (r.source !== wantSource) problems.push(`source must be "${wantSource}" in ${String(r.mode)} mode`);
  if (!r.schedule || r.schedule.timeZone !== "America/New_York" || !Array.isArray(r.schedule.polls) || !r.schedule.polls.every((p) => /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(p))) problems.push("schedule must be America/New_York with HH:MM polls");
  const wantMemo = r.mode === "buyback" ? "v2" : "v1";
  if (!r.memo || typeof r.memo.prefix !== "string" || r.memo.version !== wantMemo || !Number.isInteger(r.memo.maxBytes) || r.memo.maxBytes > 566) problems.push(`memo must be { prefix, version: ${wantMemo} (${String(r.mode)} mode), maxBytes ≤ 566 }`);
  else if (typeof r.token === "string" && r.memo.prefix !== r.token) problems.push("memo.prefix must equal token");
  if (typeof r.statement !== "string" || !r.statement) problems.push("statement missing");
  if (problems.length === 0) {
    const supply = BigInt(r.totalSupply as string), vault = BigInt(r.vaultAllocation as string);
    if (vault > supply) problems.push("vaultAllocation exceeds totalSupply");
  }
  if (problems.length) throw new Error(`rules: ${problems.join("; ")}`);
  return r as DebtRuleFile;
}

/** Parse + hash the exact text. */
export function rulesFromText(text: string): LoadedRules {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new Error("rules: not valid JSON"); }
  const rules = parseRules(raw);
  const sha256 = rulesSha256(text);
  return { rules, sha256, sha12: sha256.slice(0, 12), text };
}

/** Reads and validates the rule file (BURNKEEPER_RULES, default config/burnkeeper/debt.rules.json). */
export function loadRules(file: string): LoadedRules {
  return rulesFromText(fs.readFileSync(file, "utf8"));
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Money: decimal strings ⇄ BigInt cents
// ---------------------------------------------------------------------------------------------------------------------------------

const ZERO = BigInt(0);
const HUNDRED = BigInt(100);

/** "40305316210829.72" → 4030531621082972n. Accepts 0–2 decimals and an optional leading "-"; anything else throws. */
export function usdToCents(s: string): bigint {
  const m = /^(-?)([0-9]+)(?:\.([0-9]{1,2}))?$/.exec(s.trim());
  if (!m) throw new Error(`not a dollar amount with at most two decimals: ${JSON.stringify(s).slice(0, 40)}`);
  const cents = BigInt(m[2]) * HUNDRED + BigInt((m[3] ?? "").padEnd(2, "0") || "0");
  return m[1] === "-" ? -cents : cents;
}

/** 4030531621082972n → "40305316210829.72" (always two decimals; "-" for negatives). */
export function centsToUsd(c: bigint): string {
  const neg = c < ZERO; const a = neg ? -c : c;
  return `${neg ? "-" : ""}${(a / HUNDRED).toString()}.${(a % HUNDRED).toString().padStart(2, "0")}`;
}

/** Raw base units → a token string with no trailing zeros ("2100000", "12.5"). */
export function rawToTokens(raw: bigint, decimals: number): string {
  const scale = BigInt(10) ** BigInt(decimals);
  const whole = raw / scale, frac = raw % scale;
  if (frac === ZERO) return whole.toString();
  return `${whole.toString()}.${frac.toString().padStart(decimals, "0").replace(/0+$/, "")}`;
}

/** A token string as rawToTokens writes it ("2100000", "12.5") → raw base units. Throws on more decimals than the mint has. */
export function tokenStringToRaw(s: string, decimals: number): bigint {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m || (m[2] ?? "").length > decimals) throw new Error(`not a token amount with at most ${decimals} decimals: ${s.slice(0, 40)}`);
  return BigInt(m[1]) * BigInt(10) ** BigInt(decimals) + BigInt((m[2] ?? "").padEnd(decimals, "0") || "0");
}

/** Whole tokens (decimal string or bigint) → raw base units. */
export function tokensToRaw(tokens: string | bigint, decimals: number): bigint {
  return BigInt(tokens) * BigInt(10) ** BigInt(decimals);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The rule itself
// ---------------------------------------------------------------------------------------------------------------------------------

export interface DebtStep {
  /** now − prev, cents (negative on a down day). */
  deltaCents: bigint;
  /** The remainder carried INTO this reading (0 after any non-increase). */
  carryInCents: bigint;
  /** Full units: floor((delta + carryIn) / unit) on an increase, else 0. */
  units: number;
  /** The remainder carried OUT (0 on a non-increase). Always 0 ≤ carryOut < unit. */
  carryOutCents: bigint;
  /** Whole tokens the rule asks for: units × burnPerUnit. (The vault may hold less — see capBurn.) */
  burnTokens: bigint;
  kind: "increase" | "down" | "flat";
}

/**
 * ONE READING THROUGH THE RULE. Pure. `carryInCents` is the previous step's carryOut (0 for the first reading after the baseline).
 * Throws on a negative or ≥-unit carry (a corrupted ledger, not a market event) — the keeper stops rather than burning a number
 * nobody can reproduce.
 */
export function debtStep(rules: DebtRuleFile, prevCents: bigint, nowCents: bigint, carryInCents: bigint): DebtStep {
  const unit = BigInt(rules.rule.unitUsd) * HUNDRED;
  if (carryInCents < ZERO || carryInCents >= unit) throw new Error(`carry ${centsToUsd(carryInCents)} is outside [0, unit) — the ledger is corrupt`);
  const deltaCents = nowCents - prevCents;
  if (deltaCents <= ZERO) {
    return { deltaCents, carryInCents, units: 0, carryOutCents: ZERO, burnTokens: ZERO, kind: deltaCents === ZERO ? "flat" : "down" };
  }
  const total = deltaCents + carryInCents;
  const unitsBig = total / unit;
  return { deltaCents, carryInCents, units: Number(unitsBig), carryOutCents: total % unit, burnTokens: unitsBig * BigInt(rules.rule.burnPerUnitTokens), kind: "increase" };
}

/** Plausibility: a |delta| above the rule's bound (default $2T/day) is refused. */
export function deltaImplausible(rules: DebtRuleFile, deltaCents: bigint): boolean {
  const max = BigInt(rules.rule.maxAbsDeltaUsd) * HUNDRED;
  return deltaCents > max || -deltaCents > max;
}

/**
 * VAULT-ONLY, WITH A PUBLIC SHORTFALL (pure). What one burn day actually burns:
 *
 *   owed      = min(planned + shortfallIn, allocationLeft)   — never more than the vault's allocation has left to give
 *   burn      = min(owed, vaultBalance)                       — never more than is actually in the vault (vested and claimed)
 *   shortfall = owed − burn                                   — carried to the next burn day; in the memo as `short=` when > 0
 *   exhausted = allocationLeft ≤ 0                            — the allocation is used up: nothing is owed, ever again (SPEC §2)
 *
 * `allocationLeft` = vaultAllocation − everything already burned. All amounts in raw base units.
 */
export function settleBurn(i: { plannedRaw: bigint; shortfallInRaw: bigint; vaultRaw: bigint; allocationLeftRaw: bigint }): { owedRaw: bigint; burnRaw: bigint; shortfallRaw: bigint; exhausted: boolean } {
  const left = i.allocationLeftRaw > ZERO ? i.allocationLeftRaw : ZERO;
  if (left === ZERO) return { owedRaw: ZERO, burnRaw: ZERO, shortfallRaw: ZERO, exhausted: true };
  const want = i.plannedRaw + (i.shortfallInRaw > ZERO ? i.shortfallInRaw : ZERO);
  const owed = want < left ? want : left;
  const vault = i.vaultRaw > ZERO ? i.vaultRaw : ZERO;
  const burn = owed < vault ? owed : vault;
  return { owedRaw: owed, burnRaw: burn, shortfallRaw: owed - burn, exhausted: false };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Buyback mode (the PRIMARY mechanic since 2026-10-09 evening)
// ---------------------------------------------------------------------------------------------------------------------------------

/** "0.05" → 5/100, exactly (no float). */
export function parseFraction(s: string): { p: bigint; q: bigint } {
  const m = /^0\.(\d{1,6})$/.exec(s);
  if (!m) throw new Error(`not a fraction 0 < f < 1 with ≤ 6 decimals: ${s}`);
  const p = BigInt(m[1]), q = BigInt(10) ** BigInt(m[1].length);
  if (p <= ZERO) throw new Error("fraction must be above 0");
  return { p, q };
}

/** SOL as a decimal string → lamports, exactly. */
export function solToLamports(s: string): bigint {
  const m = /^(\d+)(?:\.(\d{1,9}))?$/.exec(s);
  if (!m) throw new Error(`not a SOL amount: ${s}`);
  return BigInt(m[1]) * BigInt(1_000_000_000) + BigInt((m[2] ?? "").padEnd(9, "0") || "0");
}

/** The spendable pool: the keeper's SOL balance minus the fee reserve, never negative. */
export function spendablePool(balanceLamports: bigint, reserveSol: string): bigint {
  const p = balanceLamports - solToLamports(reserveSol);
  return p > ZERO ? p : ZERO;
}

/**
 * THE BUYBACK RULE (pure, exact): spend = pool × (1 − (1 − f)^units), f = fractionPerUnit (1% per unit in the committed file, 5% the
 * owner's other candidate; compounding across a day's units — at 5% a 366-unit day like 2025-07-07 spends 1 − 0.95^366 ≈ 100% of the
 * pool and a 1-unit day 5%; at 1% the same day spends ≈ 97.5% and a 1-unit day 1%). Integer
 * arithmetic on the exact rational: keep = floor(pool × (q−p)^u / q^u), spend = pool − keep — at most the pool, reproducible to the
 * lamport by anyone with the pool balance (in the memo) and the units.
 */
export function buybackSpend(poolLamports: bigint, units: number, fractionPerUnit: string): bigint {
  if (units <= 0 || poolLamports <= ZERO) return ZERO;
  const { p, q } = parseFraction(fractionPerUnit);
  const u = BigInt(units);
  const keep = (poolLamports * (q - p) ** u) / q ** u;
  return poolLamports - keep;
}

/** Below the floor (USD, at the SOL price read at execution) nothing is bought that day. */
export function belowFloor(spendLamports: bigint, solUsd: number, floorUsd: string): boolean {
  return (Number(spendLamports) / 1e9) * solUsd < Number(floorUsd);
}

/**
 * The vault's vested amount at `ms` under a linear vest (cliff, then linear over vestDays from the vest start) — for --vault-pace
 * and the status page's projection. The venue's own schedule is the truth on chain; this is the model of it. Raw units.
 */
export function vestedRaw(allocationRaw: bigint, startMs: number, ms: number, cliffDays: number, vestDays: number): bigint {
  if (vestDays <= 0) return ms >= startMs + cliffDays * 86_400_000 ? allocationRaw : ZERO;
  const t = ms - startMs - cliffDays * 86_400_000;
  if (t <= 0) return ZERO;
  const span = vestDays * 86_400_000;
  if (t >= span) return allocationRaw;
  return (allocationRaw * BigInt(Math.floor(t))) / BigInt(span);
}
