/**
 * ROUND 5 target burn (crank_target_burn), memo v3, in a module the browser can load: no web3, no Buffer, no constants.ts (which calls
 * Node's Buffer at load). memo.ts re-exports everything here, so server code keeps importing from memo.ts; the coin page imports this file.
 *
 *   DEBT|2026-10-08|src=…|prev=…|now=…|delta=…|units=21|pool=…|spent=…|got=…|burn=…|target=<target mint>|own=…|swap=…|rules=sha256:<12>|v3
 *
 * `got` / `burn` are in the TARGET's units (its decimals), `target` is the target mint in full, `own` the coin's own fee tokens burned in
 * the same instruction (the coin's decimals; "0" when none). The field checks are memo.ts's own (v1 / v2 share them there).
 */

/** The program's memo ceiling (constants.ts MEMO_MAX_BYTES; test/burnReceiptsBurnTarget.test.ts checks the two agree). */
export const MEMO_V3_MAX_BYTES = 566;

export interface TargetMemo {
  prefix: string; recordDate: string; source: string; prev: string; now: string; delta: string; units: number;
  pool: string; spent: string; got: string; burn: string; target: string; own: string; swap: string; rulesSha12: string; version: "v3";
  valueDecimals?: number;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const fixedRe = (decimals: number): RegExp => (decimals === 0 ? /^-?(0|[1-9]\d*)$/ : new RegExp(`^-?(0|[1-9]\\d*)\\.\\d{${decimals}}$`));
const decimalsOf = (s: string): number => (s.includes(".") ? s.length - s.indexOf(".") - 1 : 0);
const TOKENS = /^(0|[1-9]\d*)(\.\d*[1-9])?$/;
const HEX12 = /^[0-9a-f]{12}$/;
const LAMPORTS = /^(0|[1-9]\d*)$/;
const SIG12 = /^([1-9A-HJ-NP-Za-km-z]{12}|none)$/;
const BASE58_KEY = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const utf8Bytes = (s: string): number => new TextEncoder().encode(s).length;

export function formatTargetMemo(m: TargetMemo): string {
  const bad: string[] = [];
  if (!/^[A-Z0-9]{2,12}$/.test(m.prefix)) bad.push("prefix");
  if (!DATE.test(m.recordDate)) bad.push("recordDate");
  if (!m.source || m.source.includes("|")) bad.push("source");
  const re = fixedRe(m.valueDecimals ?? 2);
  for (const k of ["prev", "now", "delta"] as const) if (!re.test(m[k])) bad.push(k);
  if (!Number.isSafeInteger(m.units) || m.units < 0) bad.push("units");
  for (const k of ["pool", "spent"] as const) if (!LAMPORTS.test(m[k])) bad.push(k);
  for (const k of ["got", "burn", "own"] as const) if (!TOKENS.test(m[k])) bad.push(k);
  if (!BASE58_KEY.test(m.target)) bad.push("target");
  if (!SIG12.test(m.swap)) bad.push("swap");
  if (!HEX12.test(m.rulesSha12)) bad.push("rulesSha12");
  if (m.version !== "v3") bad.push("version");
  if (!bad.length && BigInt(m.spent) > BigInt(m.pool)) bad.push("spent > pool");
  if (bad.length) throw new Error(`memo v3: invalid field(s) ${bad.join(", ")}`);
  const s = `${m.prefix}|${m.recordDate}|src=${m.source}|prev=${m.prev}|now=${m.now}|delta=${m.delta}|units=${m.units}|pool=${m.pool}|spent=${m.spent}|got=${m.got}|burn=${m.burn}|target=${m.target}|own=${m.own}|swap=${m.swap}|rules=sha256:${m.rulesSha12}|${m.version}`;
  const bytes = utf8Bytes(s);
  if (bytes > MEMO_V3_MAX_BYTES) throw new Error(`memo is ${bytes} bytes, over the ${MEMO_V3_MAX_BYTES}-byte ceiling`);
  return s;
}

/** A v3 memo parsed field for field, or null (anything that does not re-format to exactly the same string). */
export function parseTargetMemo(s: string): TargetMemo | null {
  if (typeof s !== "string" || utf8Bytes(s) > MEMO_V3_MAX_BYTES) return null;
  const parts = s.split("|");
  if (parts.length !== 16) return null;
  const keys = ["", "", "src", "prev", "now", "delta", "units", "pool", "spent", "got", "burn", "target", "own", "swap", "rules"];
  const v: string[] = [];
  for (let i = 2; i <= 14; i++) { const k = keys[i]; if (!parts[i].startsWith(`${k}=`)) return null; v[i] = parts[i].slice(k.length + 1); }
  if (!/^\d+$/.test(v[6]) || !v[14].startsWith("sha256:")) return null;
  const m: TargetMemo = { prefix: parts[0], recordDate: parts[1], source: v[2], prev: v[3], now: v[4], delta: v[5], units: Number(v[6]), pool: v[7], spent: v[8], got: v[9], burn: v[10], target: v[11], own: v[12], swap: v[13], rulesSha12: v[14].slice(7), version: parts[15] as "v3", ...(decimalsOf(v[3]) !== 2 ? { valueDecimals: decimalsOf(v[3]) } : {}) };
  try { return formatTargetMemo(m) === s ? m : null; } catch { return null; }
}

/** The burned mint a memo names: the target for v3, else the coin itself (`coinMint`). */
export function burnedMintOf(memo: string, coinMint: string): { mint: string; isTarget: boolean } {
  const t = parseTargetMemo(memo);
  return t ? { mint: t.target, isTarget: true } : { mint: coinMint, isTarget: false };
}
