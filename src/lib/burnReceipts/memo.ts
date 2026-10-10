import { PublicKey } from "@solana/web3.js";
import { MEMO_MAX_BYTES, MODE_BUYBACK } from "@/lib/burnReceipts/constants";
import { formatDate, formatFixed, formatSignedFixed, hex12, rawToTokens } from "@/lib/burnReceipts/math";
import type { ReadingAccount, TokenConfigAccount } from "@/lib/burnReceipts/accounts";

/**
 * THE CANONICAL BURN MEMO — v1 (vault) and v2 (buyback), byte-for-byte the keeper's format:
 *
 *   DEBT|2026-10-08|src=…|prev=…|now=…|delta=…|units=21|burn=2100000[|short=600000]|rules=sha256:<12>|v1
 *   DEBT|2026-10-08|src=…|prev=…|now=…|delta=…|units=21|pool=…|spent=…|got=…|burn=…|swap=…|rules=sha256:<12>|v2
 *
 * SHARING WITH THE KEEPER. The keeper's src/lib/burnKeeper/memo.ts (formatDebtMemo / formatBuybackMemo / parse*) was not on this
 * branch when this client was written (it lives on the keeper's unmerged worktree), so the formatter is defined here with the SAME
 * exported names, field order, validation and 566-byte ceiling. When the keeper lands, replace the format/parse section of this
 * file with `export { formatDebtMemo, parseDebtMemo, formatBuybackMemo, parseBuybackMemo, MEMO_MAX_BYTES } from
 * "@/lib/burnKeeper/memo"` and keep `memoFromChain` (the part only the on-chain program needs). test/burnReceiptsMemo.test.ts pins
 * both to the spec's example.
 *
 * ON-CHAIN v2 `swap=`: the program swaps and burns in ONE instruction and cannot know its own signature, so `swap=` is the first 12
 * base58 characters of the CPMM pool the swap executed on (same shape the keeper's parser accepts), or "none" when nothing was bought.
 */

export interface DebtMemo {
  prefix: string; recordDate: string; source: string; prev: string; now: string; delta: string; units: number; burn: string;
  short?: string; rulesSha12: string; version: "v1";
  /** Decimals of prev/now/delta (default 2). */
  valueDecimals?: number;
}
export interface BuybackMemo {
  prefix: string; recordDate: string; source: string; prev: string; now: string; delta: string; units: number;
  pool: string; spent: string; got: string; burn: string; swap: string; rulesSha12: string; version: "v2";
  /** Decimals of prev/now/delta (default 2). */
  valueDecimals?: number;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Review L-5: the value fields carry exactly the feed's `value_decimals` places (2 for Treasury cents); not printed in the memo. */
const fixedRe = (decimals: number): RegExp => (decimals === 0 ? /^-?(0|[1-9]\d*)$/ : new RegExp(`^-?(0|[1-9]\\d*)\\.\\d{${decimals}}$`));
const decimalsOf = (s: string): number => (s.includes(".") ? s.length - s.indexOf(".") - 1 : 0);
const TOKENS = /^(0|[1-9]\d*)(\.\d*[1-9])?$/;
const HEX12 = /^[0-9a-f]{12}$/;
const LAMPORTS = /^(0|[1-9]\d*)$/;
const SIG12 = /^([1-9A-HJ-NP-Za-km-z]{12}|none)$/;

const head = (m: { prefix: string; recordDate: string; source: string; prev: string; now: string; delta: string; units: number }) =>
  `${m.prefix}|${m.recordDate}|src=${m.source}|prev=${m.prev}|now=${m.now}|delta=${m.delta}|units=${m.units}`;

function commonProblems(m: { prefix: string; recordDate: string; source: string; prev: string; now: string; delta: string; units: number; valueDecimals?: number }): string[] {
  const bad: string[] = [];
  if (!/^[A-Z0-9]{2,12}$/.test(m.prefix)) bad.push("prefix");
  if (!DATE.test(m.recordDate)) bad.push("recordDate");
  if (!m.source || m.source.includes("|")) bad.push("source");
  const re = fixedRe(m.valueDecimals ?? 2);
  for (const k of ["prev", "now", "delta"] as const) if (!re.test(m[k])) bad.push(k);
  if (!Number.isSafeInteger(m.units) || m.units < 0) bad.push("units");
  return bad;
}

const ceiling = (s: string): string => {
  const bytes = Buffer.byteLength(s, "utf8");
  if (bytes > MEMO_MAX_BYTES) throw new Error(`memo is ${bytes} bytes, over the ${MEMO_MAX_BYTES}-byte ceiling`);
  return s;
};

export function formatDebtMemo(m: DebtMemo): string {
  const bad = commonProblems(m);
  if (!TOKENS.test(m.burn)) bad.push("burn");
  if (m.short !== undefined && (!TOKENS.test(m.short) || m.short === "0")) bad.push("short");
  if (!HEX12.test(m.rulesSha12)) bad.push("rulesSha12");
  if (m.version !== "v1") bad.push("version");
  if (bad.length) throw new Error(`memo: invalid field(s) ${bad.join(", ")}`);
  const short = m.short !== undefined ? `|short=${m.short}` : "";
  return ceiling(`${head(m)}|burn=${m.burn}${short}|rules=sha256:${m.rulesSha12}|${m.version}`);
}

export function parseDebtMemo(s: string): DebtMemo | null {
  if (Buffer.byteLength(s, "utf8") > MEMO_MAX_BYTES) return null;
  const parts = s.split("|");
  if (parts.length !== 10 && parts.length !== 11) return null;
  const hasShort = parts.length === 11;
  const take = (p: string, k: string): string | null => (p.startsWith(`${k}=`) ? p.slice(k.length + 1) : null);
  const [prefix, recordDate, src, prev, now, delta, units, burn] = parts;
  const v = { source: take(src, "src"), prev: take(prev, "prev"), now: take(now, "now"), delta: take(delta, "delta"), units: take(units, "units"), burn: take(burn, "burn"), rules: take(parts[hasShort ? 9 : 8], "rules") };
  const short = hasShort ? take(parts[8], "short") : undefined;
  if (Object.values(v).some((x) => x === null) || short === null) return null;
  if (!/^\d+$/.test(v.units!) || !v.rules!.startsWith("sha256:")) return null;
  const m: DebtMemo = { prefix, recordDate, source: v.source!, prev: v.prev!, now: v.now!, delta: v.delta!, units: Number(v.units), burn: v.burn!, ...(short !== undefined ? { short } : {}), rulesSha12: v.rules!.slice(7), version: parts[hasShort ? 10 : 9] as "v1", ...(decimalsOf(v.prev!) !== 2 ? { valueDecimals: decimalsOf(v.prev!) } : {}) };
  try { return formatDebtMemo(m) === s ? m : null; } catch { return null; }
}

export function formatBuybackMemo(m: BuybackMemo): string {
  const bad = commonProblems(m);
  for (const k of ["pool", "spent"] as const) if (!LAMPORTS.test(m[k])) bad.push(k);
  for (const k of ["got", "burn"] as const) if (!TOKENS.test(m[k])) bad.push(k);
  if (!SIG12.test(m.swap)) bad.push("swap");
  if (!HEX12.test(m.rulesSha12)) bad.push("rulesSha12");
  if (m.version !== "v2") bad.push("version");
  if (!bad.length && BigInt(m.spent) > BigInt(m.pool)) bad.push("spent > pool");
  if (bad.length) throw new Error(`memo v2: invalid field(s) ${bad.join(", ")}`);
  return ceiling(`${head(m)}|pool=${m.pool}|spent=${m.spent}|got=${m.got}|burn=${m.burn}|swap=${m.swap}|rules=sha256:${m.rulesSha12}|${m.version}`);
}

export function parseBuybackMemo(s: string): BuybackMemo | null {
  if (Buffer.byteLength(s, "utf8") > MEMO_MAX_BYTES) return null;
  const parts = s.split("|");
  if (parts.length !== 14) return null;
  const keys = ["", "", "src", "prev", "now", "delta", "units", "pool", "spent", "got", "burn", "swap", "rules"];
  const v: string[] = [];
  for (let i = 2; i <= 12; i++) { const k = keys[i]; if (!parts[i].startsWith(`${k}=`)) return null; v[i] = parts[i].slice(k.length + 1); }
  if (!/^\d+$/.test(v[6]) || !v[12].startsWith("sha256:")) return null;
  const m: BuybackMemo = { prefix: parts[0], recordDate: parts[1], source: v[2], prev: v[3], now: v[4], delta: v[5], units: Number(v[6]), pool: v[7], spent: v[8], got: v[9], burn: v[10], swap: v[11], rulesSha12: v[12].slice(7), version: parts[13] as "v2", ...(decimalsOf(v[3]) !== 2 ? { valueDecimals: decimalsOf(v[3]) } : {}) };
  try { return formatBuybackMemo(m) === s ? m : null; } catch { return null; }
}

/**
 * The memo the program wrote for a processed reading, rebuilt from the TokenConfig and Reading accounts alone — the status page's
 * "verify it yourself": the chain's memo, the accounts and the source row must all agree. Returns null for readings that write no
 * memo (baseline / zero units / vault exhausted).
 */
export function memoFromChain(c: TokenConfigAccount, r: ReadingAccount, mintDecimals: number): string | null {
  if (!r.processed || r.units === BigInt(0)) return null;
  const dec = c.rule.value_decimals;
  const h = {
    prefix: c.memoPrefix,
    recordDate: formatDate(r.record_date),
    source: c.memoSource,
    prev: formatFixed(r.prev_value, dec),
    now: formatFixed(r.value, dec),
    delta: formatSignedFixed(r.delta, dec),
    units: Number(r.units),
    rulesSha12: hex12(c.rules_sha256),
    valueDecimals: dec,
  };
  if (c.rule.mode === MODE_BUYBACK) {
    // Review-2 F9: the pool THIS reading traded on (stored on the Reading), so memos stay reproducible after a pool replacement.
    const pool = r.pool && !(r.pool as PublicKey).equals(PublicKey.default) ? (r.pool as PublicKey) : (c.cpmm_pool as PublicKey);
    const swap = r.spent_lamports > BigInt(0) ? pool.toBase58().slice(0, 12) : "none";
    return formatBuybackMemo({ ...h, pool: r.pool_lamports.toString(), spent: r.spent_lamports.toString(), got: rawToTokens(r.got, mintDecimals), burn: rawToTokens(r.burned, mintDecimals), swap, version: "v2" });
  }
  if (r.outcome === 5) return null;
  return formatDebtMemo({ ...h, burn: rawToTokens(r.burned, mintDecimals), ...(r.shortfall > BigInt(0) ? { short: rawToTokens(r.shortfall, mintDecimals) } : {}), version: "v1" });
}
