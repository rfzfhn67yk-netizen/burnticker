import { MEMO_MAX_BYTES } from "@/lib/burnKeeper/memo";

/**
 * THE BURNTICKER RECEIPT MEMO — version "v3" of the keeper's memo family (2026-10-09). The keeper's memo.ts owns v1 (vault) and v2
 * (buyback) for $DEFICIT and is not changed; v3 extends the family for oracle-backed tokens and is told apart by its version token and
 * its "BT" prefix, so the three parsers are disjoint (a v3 memo returns null from parseBuybackMemo and vice versa). Same ceiling
 * (MEMO_MAX_BYTES, imported), same field discipline (fixed order, one spelling per number, format ∘ parse = identity before signing).
 *
 *   BT|<TICKER>|<id>|oracle=kalshi|market=KXNFLGAME-26OCT04DENSF-DEN|result=no|settled=2026-10-04T23:41:27Z|src=kalshi.com/markets/kxnflgame
 *     |value=-|units=0|pool=<lamports>|spent=<lamports>|got=<tokens>|burn=<tokens>|swap=<sig12|none>|rules=sha256:<12>|v3
 *
 * `id` is the idempotency key (market ticker, event ticker or feed period); `result` is yes/no/void/- ; `settled` is the oracle's
 * settlement time to the second (or the feed period); `src` is the settlement source (host + path, no scheme, ≤ 96 bytes, never a
 * '|'); `value` is the settled scalar or '-'. The rest is the keeper's buyback vocabulary unchanged: pool/spent lamports, got/burn
 * tokens, the swap signature's first 12 characters, the rule hash. Vault-mode receipts carry pool=0|spent=0|got=0|swap=none.
 */

export const RECEIPT_VERSION = "v3";
export const RECEIPT_PREFIX = "BT";

export interface ReceiptMemo {
  ticker: string; id: string; oracle: string; market: string; result: "yes" | "no" | "void" | "-"; settled: string; src: string; value: string;
  units: number; pool: string; spent: string; got: string; burn: string; swap: string; rulesSha12: string; version: "v3";
}

const TICKER = /^[A-Z0-9]{2,12}$/;
const ID = /^[A-Za-z0-9._:\/-]{1,96}$/;
const ORACLE = /^[a-z][a-z-]{1,15}$/;
const TIME = /^(\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}Z)?|\d{4}-\d{2})$/;
const DECIMAL = /^(-|-?(0|[1-9]\d*)(\.\d*[1-9])?)$/;
const LAMPORTS = /^(0|[1-9]\d*)$/;
const TOKENS = /^(0|[1-9]\d*)(\.\d*[1-9])?$/;
const SIG12 = /^([1-9A-HJ-NP-Za-km-z]{12}|none)$/;
const HEX12 = /^[0-9a-f]{12}$/;

/** A settlement source URL as the memo carries it: host + path, no scheme or query, ≤ 96 bytes, no '|'. Deterministic. */
export function sourceForMemo(url: string): string {
  let s = url.replace(/^https?:\/\//, "").split(/[?#]/)[0].replace(/\|/g, "").replace(/\/+$/, "");
  if (Buffer.byteLength(s, "utf8") > 96) s = s.slice(0, 96).replace(/[^A-Za-z0-9._~\/-]+$/, "");
  return s || "-";
}

/** ISO time to the second ("2026-10-04T23:41:27.463206Z" → "2026-10-04T23:41:27Z"); a period ("2026-10-08", "2026-08") passes through. */
export function settledForMemo(at: string): string {
  if (/^\d{4}-\d{2}(-\d{2})?$/.test(at)) return at;
  const ms = Date.parse(at);
  if (Number.isNaN(ms)) throw new Error(`not a time: ${at}`);
  return `${new Date(ms).toISOString().slice(0, 19)}Z`;
}

export function formatReceiptMemo(m: ReceiptMemo): string {
  const bad: string[] = [];
  if (!TICKER.test(m.ticker)) bad.push("ticker");
  if (!ID.test(m.id)) bad.push("id");
  if (!ORACLE.test(m.oracle)) bad.push("oracle");
  if (!ID.test(m.market)) bad.push("market");
  if (!["yes", "no", "void", "-"].includes(m.result)) bad.push("result");
  if (!TIME.test(m.settled)) bad.push("settled");
  if (!m.src || m.src.includes("|") || /\s/.test(m.src) || Buffer.byteLength(m.src, "utf8") > 96) bad.push("src");
  if (!DECIMAL.test(m.value)) bad.push("value");
  if (!Number.isSafeInteger(m.units) || m.units < 0) bad.push("units");
  for (const k of ["pool", "spent"] as const) if (!LAMPORTS.test(m[k])) bad.push(k);
  for (const k of ["got", "burn"] as const) if (!TOKENS.test(m[k])) bad.push(k);
  if (!SIG12.test(m.swap)) bad.push("swap");
  if (!HEX12.test(m.rulesSha12)) bad.push("rulesSha12");
  if (m.version !== RECEIPT_VERSION) bad.push("version");
  if (!bad.length && BigInt(m.spent) > BigInt(m.pool)) bad.push("spent > pool");
  if (bad.length) throw new Error(`The receipt memo has ${bad.length === 1 ? "an invalid field" : "invalid fields"}: ${bad.join(", ")}.`);
  const s = `${RECEIPT_PREFIX}|${m.ticker}|${m.id}|oracle=${m.oracle}|market=${m.market}|result=${m.result}|settled=${m.settled}|src=${m.src}|value=${m.value}|units=${m.units}|pool=${m.pool}|spent=${m.spent}|got=${m.got}|burn=${m.burn}|swap=${m.swap}|rules=sha256:${m.rulesSha12}|${m.version}`;
  const bytes = Buffer.byteLength(s, "utf8");
  if (bytes > MEMO_MAX_BYTES) throw new Error(`receipt memo is ${bytes} bytes, over the ${MEMO_MAX_BYTES}-byte ceiling`);
  return s;
}

export function parseReceiptMemo(s: string): ReceiptMemo | null {
  if (Buffer.byteLength(s, "utf8") > MEMO_MAX_BYTES) return null;
  const parts = s.split("|");
  if (parts.length !== 17 || parts[0] !== RECEIPT_PREFIX || parts[16] !== RECEIPT_VERSION) return null;
  const keys = ["oracle", "market", "result", "settled", "src", "value", "units", "pool", "spent", "got", "burn", "swap", "rules"];
  const v: Record<string, string> = {};
  for (let i = 0; i < keys.length; i++) { const p = parts[3 + i], k = keys[i]; if (!p.startsWith(`${k}=`)) return null; v[k] = p.slice(k.length + 1); }
  if (!/^\d+$/.test(v.units) || !v.rules.startsWith("sha256:")) return null;
  const m: ReceiptMemo = { ticker: parts[1], id: parts[2], oracle: v.oracle, market: v.market, result: v.result as ReceiptMemo["result"], settled: v.settled, src: v.src, value: v.value,
    units: Number(v.units), pool: v.pool, spent: v.spent, got: v.got, burn: v.burn, swap: v.swap, rulesSha12: v.rules.slice(7), version: "v3" };
  try { return formatReceiptMemo(m) === s ? m : null; } catch { return null; }
}

/** The key the keeper looks for in its own on-chain history before cranking an event ("BT|BRONCO|KXNFLGAME-26OCT04DENSF-DEN|"). */
export const receiptKey = (ticker: string, id: string): string => `${RECEIPT_PREFIX}|${ticker}|${id}|`;

/**
 * The receipt format a creator commits to, as the wizard's review step shows it: every field name and its order, with this token's
 * ticker, oracle and rule hash filled in and the per-event fields as <placeholders>. The same text goes in the public API's launch
 * review payload, so a bot shows its user exactly what the wizard would.
 */
export function receiptFormatTemplate(ticker: string, oracle: string, rulesSha12: string): string {
  return `${RECEIPT_PREFIX}|${ticker || "TICKER"}|<market or period>|oracle=${oracle}|market=<ticker>|result=<yes|no|void|->|settled=<time>|src=<settlement source>|value=<n|->|units=<n>|pool=<lamports>|spent=<lamports>|got=<tokens>|burn=<tokens>|swap=<sig12|none>|rules=sha256:${rulesSha12}|${RECEIPT_VERSION}`;
}
