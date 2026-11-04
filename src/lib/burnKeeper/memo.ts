/**
 * THE CANONICAL BURN MEMO (SPEC §4, 2026-10-09). Pure.
 *
 *   DEBT|2026-10-08|src=fiscaldata.treasury.gov debt_to_penny|prev=40284036147367.19|now=40305316210829.72|delta=21280063462.53|units=21|burn=2100000|rules=sha256:<12>|v1
 *
 * and, only on a day the vesting vault could not cover (the owner, 10-09 evening — Raydium LaunchLab vests the vault linearly):
 *
 *   DEBT|…|units=21|burn=1500000|short=600000|rules=sha256:<12>|v1
 *
 * "The memo IS the audit trail": it rides in the same transaction as the SPL burn (Memo program v2), so the chain itself carries the
 * source row, the arithmetic and the rule hash beside the tokens destroyed. The field ORDER and spelling are part of the format —
 * a stranger's parser is written against the spec's example, so this module formats exactly that and parses exactly that, and a
 * memo that does not round-trip is refused before it is signed. The prefix is the RULE KEY ("DEBT"), never the ticker ($DEFICIT
 * since 10-09), so a ticker change never changes the format.
 *
 * `short=` (tokens owed but not in the vault, carried to the next burn day) appears ONLY when it is above zero, so every ordinary
 * memo is byte-for-byte the spec's example shape. `burn=` is what was actually destroyed; units × 100,000 + the shortfall carried in
 * = burn + short, unless the vault's whole allocation is used up (then the owed amount is capped at what was left).
 *
 * LIMIT 566 BYTES: the Memo program accepts more, but a transaction is 1,232 bytes and the burn instruction, signature, keys and
 * blockhash take the rest; the spec fixes 566 as the ceiling so the transaction can never be refused for size. A real memo is ~170.
 *
 * WHAT THE MEMO DOES NOT CARRY (by the spec's format): the dollar remainder carried in from earlier consecutive increases. `units` is
 * floor((delta + carry_in) / $1B), so on a day with carry a stranger who reads only this memo sees e.g. delta=$0.7B, units=1. The
 * carry is reproducible from the source series (the run of increases since the last non-increase), and the status page shows it with
 * its derivation beside every burn. Adding it to the memo is a format change — a v2, decided before launch, not by the keeper.
 */

export const MEMO_MAX_BYTES = 566;

export interface DebtMemo {
  prefix: string;        // "DEBT"
  recordDate: string;    // YYYY-MM-DD
  source: string;        // "fiscaldata.treasury.gov debt_to_penny"
  prev: string;          // dollars, two decimals
  now: string;
  delta: string;
  units: number;
  burn: string;          // tokens actually burned, no trailing zeros ("0" on a memo-only shortfall day)
  /** Tokens owed and not burned (vault short), carried forward; omitted (undefined) when zero. */
  short?: string;
  rulesSha12: string;    // 12 lowercase hex
  version: "v1";
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
// Canonical numbers only (no leading zeros, no trailing fractional zeros), so a memo has exactly one spelling.
const USD = /^-?(0|[1-9]\d*)\.\d{2}$/;
const TOKENS = /^(0|[1-9]\d*)(\.\d*[1-9])?$/;
const HEX12 = /^[0-9a-f]{12}$/;

/** Formats the memo; throws if any field would break the format or the 566-byte ceiling. */
export function formatDebtMemo(m: DebtMemo): string {
  const bad: string[] = [];
  if (!/^[A-Z0-9]{2,12}$/.test(m.prefix)) bad.push("prefix");
  if (!DATE.test(m.recordDate)) bad.push("recordDate");
  if (!m.source || m.source.includes("|")) bad.push("source");
  for (const k of ["prev", "now", "delta"] as const) if (!USD.test(m[k])) bad.push(k);
  if (!Number.isSafeInteger(m.units) || m.units < 0) bad.push("units");
  if (!TOKENS.test(m.burn)) bad.push("burn");
  if (m.short !== undefined && (!TOKENS.test(m.short) || m.short === "0")) bad.push("short");
  if (!HEX12.test(m.rulesSha12)) bad.push("rulesSha12");
  if (m.version !== "v1") bad.push("version");
  if (bad.length) throw new Error(`memo: invalid field(s) ${bad.join(", ")}`);
  const short = m.short !== undefined ? `|short=${m.short}` : "";
  const s = `${m.prefix}|${m.recordDate}|src=${m.source}|prev=${m.prev}|now=${m.now}|delta=${m.delta}|units=${m.units}|burn=${m.burn}${short}|rules=sha256:${m.rulesSha12}|${m.version}`;
  const bytes = Buffer.byteLength(s, "utf8");
  if (bytes > MEMO_MAX_BYTES) throw new Error(`memo is ${bytes} bytes, over the ${MEMO_MAX_BYTES}-byte ceiling`);
  return s;
}

/** Parses a memo of exactly the canonical shape; returns null for anything else (another program's memo, a v2, a typo). */
export function parseDebtMemo(s: string): DebtMemo | null {
  if (Buffer.byteLength(s, "utf8") > MEMO_MAX_BYTES) return null;
  const parts = s.split("|");
  if (parts.length !== 10 && parts.length !== 11) return null;
  const hasShort = parts.length === 11;
  const [prefix, recordDate, src, prev, now, delta, units, burn] = parts;
  const shortP = hasShort ? parts[8] : null;
  const rules = parts[hasShort ? 9 : 8], version = parts[hasShort ? 10 : 9];
  const take = (p: string, k: string): string | null => (p.startsWith(`${k}=`) ? p.slice(k.length + 1) : null);
  const source = take(src, "src"), prevV = take(prev, "prev"), nowV = take(now, "now"), deltaV = take(delta, "delta");
  const unitsS = take(units, "units"), burnV = take(burn, "burn"), rulesV = take(rules, "rules");
  const shortV = shortP === null ? undefined : take(shortP, "short");
  if (source === null || prevV === null || nowV === null || deltaV === null || unitsS === null || burnV === null || rulesV === null || shortV === null) return null;
  if (!/^\d+$/.test(unitsS) || !rulesV.startsWith("sha256:")) return null;
  const memo: DebtMemo = { prefix, recordDate, source, prev: prevV, now: nowV, delta: deltaV, units: Number(unitsS), burn: burnV, ...(shortV !== undefined ? { short: shortV } : {}), rulesSha12: rulesV.slice(7), version: version as "v1" };
  try { return formatDebtMemo(memo) === s ? memo : null; } catch { return null; }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// v2 — the BUYBACK memo (the owner, 2026-10-09 evening: buyback-and-burn is the primary mechanic)
//
//   DEBT|2026-10-08|src=fiscaldata.treasury.gov debt_to_penny|prev=…|now=…|delta=…|units=21|pool=<lamports before>|spent=<lamports>|got=<tokens>|burn=<tokens>|swap=<sig12>|rules=sha256:<12>|v2
//
// It rides on the BURN transaction, which follows the swap: `got` is what the swap actually delivered (read from the swap's own
// transaction meta, not the quote), `burn` is every token the keeper then held (got + any dust a crash left the day before — the keeper
// never holds tokens overnight), `swap` is the first 12 characters of the swap's signature, so the two transactions are linked on chain.
// `pool` and `spent` are lamports; spent = pool × (1 − 0.95^units), recomputable by anyone from those two fields and the rule file.
// ---------------------------------------------------------------------------------------------------------------------------------

export interface BuybackMemo {
  prefix: string; recordDate: string; source: string; prev: string; now: string; delta: string; units: number;
  pool: string; spent: string; got: string; burn: string;
  /** First 12 base58 characters of the swap signature, or "none" (a dust-only burn). */
  swap: string;
  rulesSha12: string; version: "v2";
}

const LAMPORTS = /^(0|[1-9]\d*)$/;
const SIG12 = /^([1-9A-HJ-NP-Za-km-z]{12}|none)$/;

export function formatBuybackMemo(m: BuybackMemo): string {
  const bad: string[] = [];
  if (!/^[A-Z0-9]{2,12}$/.test(m.prefix)) bad.push("prefix");
  if (!DATE.test(m.recordDate)) bad.push("recordDate");
  if (!m.source || m.source.includes("|")) bad.push("source");
  for (const k of ["prev", "now", "delta"] as const) if (!USD.test(m[k])) bad.push(k);
  if (!Number.isSafeInteger(m.units) || m.units < 0) bad.push("units");
  for (const k of ["pool", "spent"] as const) if (!LAMPORTS.test(m[k])) bad.push(k);
  for (const k of ["got", "burn"] as const) if (!TOKENS.test(m[k])) bad.push(k);
  if (!SIG12.test(m.swap)) bad.push("swap");
  if (!HEX12.test(m.rulesSha12)) bad.push("rulesSha12");
  if (m.version !== "v2") bad.push("version");
  if (!bad.length && BigInt(m.spent) > BigInt(m.pool)) bad.push("spent > pool");
  if (bad.length) throw new Error(`memo v2: invalid field(s) ${bad.join(", ")}`);
  const s = `${m.prefix}|${m.recordDate}|src=${m.source}|prev=${m.prev}|now=${m.now}|delta=${m.delta}|units=${m.units}|pool=${m.pool}|spent=${m.spent}|got=${m.got}|burn=${m.burn}|swap=${m.swap}|rules=sha256:${m.rulesSha12}|${m.version}`;
  const bytes = Buffer.byteLength(s, "utf8");
  if (bytes > MEMO_MAX_BYTES) throw new Error(`memo is ${bytes} bytes, over the ${MEMO_MAX_BYTES}-byte ceiling`);
  return s;
}

export function parseBuybackMemo(s: string): BuybackMemo | null {
  if (Buffer.byteLength(s, "utf8") > MEMO_MAX_BYTES) return null;
  const parts = s.split("|");
  if (parts.length !== 14) return null;
  const keys = ["", "", "src", "prev", "now", "delta", "units", "pool", "spent", "got", "burn", "swap", "rules"];
  const v: string[] = [];
  for (let i = 2; i <= 12; i++) { const k = keys[i]; if (!parts[i].startsWith(`${k}=`)) return null; v[i] = parts[i].slice(k.length + 1); }
  if (!/^\d+$/.test(v[6]) || !v[12].startsWith("sha256:")) return null;
  const m: BuybackMemo = { prefix: parts[0], recordDate: parts[1], source: v[2], prev: v[3], now: v[4], delta: v[5], units: Number(v[6]), pool: v[7], spent: v[8], got: v[9], burn: v[10], swap: v[11], rulesSha12: v[12].slice(7), version: parts[13] as "v2" };
  try { return formatBuybackMemo(m) === s ? m : null; } catch { return null; }
}

/**
 * The key the keeper looks for in its own on-chain history before sending a burn for a date ("DEBT|2026-10-08|"): if a confirmed
 * transaction of its key already carries it, the date is done, whatever the local ledger says (a crash between send and write).
 */
export const memoDateKey = (prefix: string, recordDate: string): string => `${prefix}|${recordDate}|`;
