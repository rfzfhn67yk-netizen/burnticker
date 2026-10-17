import { BURN_RECEIPTS_IDL } from "@/lib/burnReceipts/idl";
import { b58decode, base64ToBytes, sha256Hex, toHex } from "@/lib/burnticker/trustpack/base58";
import { isAccount, readAccount } from "@/lib/burnticker/trustpack/idlReader";
import { takeRpc } from "@/lib/burnticker/apiBudget";

/**
 * THE BROWSER RECEIPT VERIFIER (trust pack, 2026-10-10; /burnticker/check). Paste a receipt's transaction signature and this module,
 * running in YOUR browser, asks the public Solana RPC and the original data source — never our server — and checks, one named line at
 * a time:
 *
 *   tx       the transaction exists on the cluster and succeeded
 *   program  it ran the pinned burn_receipts program's crank_buyback
 *   memo     the program's memo (v2) parses: ticker, reading date, prev/now/delta, units, pool, spent, got, burn, rules hash
 *   reading  the program-owned Reading account in that transaction says the same date, values, units, pool, spend and burn
 *   config   the program-owned TokenConfig is the one the Reading belongs to, with the memo's ticker and mint
 *   rules    the published rules file hashes (sha256) to the hash the TokenConfig stores and the memo cites
 *   source   the Reading's source_url_hash is sha256 of the Treasury URL this page builds for that date; the Treasury API, fetched
 *            from here, returns the same two values (previous and current business day)
 *   units    the unit rule re-run on those values (the program's integer arithmetic) gives the Reading's units and carry
 *   spend    rule spend = pool × (1 − (1 − f)^units) in the program's fixed point; spent + carried out = rule spend + carried in
 *   burn     the transaction's token Burn instruction(s) burned exactly what the swap bought
 *
 * Pure apart from the injected `rpc` and `fetchSource`, so the tests replay frozen devnet bytes and a frozen Treasury series, and the
 * API route (GET /v1/check/receipts/{signature}) runs the very same code on the server for curl users. The arithmetic mirrors
 * src/lib/burnReceipts/math.ts (step, buybackSpend, formatFixed, rawToTokens); the tests prove the mirror equal on the devnet data and
 * on random vectors. No Buffer, no web3.js: it must bundle into a client page.
 */

export type CheckId = "tx" | "program" | "memo" | "reading" | "config" | "rules" | "source" | "units" | "spend" | "burn";
export interface ReceiptCheck { id: CheckId; label: string; ok: boolean | null; detail: string }
export interface ReceiptFacts {
  signature: string; cluster: string; slot: number | null; blockTime: string | null; memo: string | null;
  ticker: string | null; recordDate: string | null; prevDate: string | null; units: string | null;
  readingAddress: string | null; configAddress: string | null; mint: string | null; rulesSha256: string | null;
  /** null when the input is not a valid signature: no explorer link is ever built from a malformed value (audit 4 BT-07) */
  sourceUrl: string | null; prevSourceUrl: string | null; explorerUrl: string | null;
}
/** inputError: the input is missing or malformed — a field error, NOT a verdict on any receipt (no checks run, no explorer link). */
export interface ReceiptCheckResult { verified: boolean; checks: ReceiptCheck[]; facts: ReceiptFacts; inputError?: { state: "missing" | "malformed"; reason: string } | null }

/**
 * What the visitor typed, before any check (audit 4 BT-07): missing (empty), malformed (not base58, or not 64 bytes once decoded) or a
 * well-formed signature. Missing transaction (valid but not on chain), dependency unavailable and evidence mismatch are decided later, by
 * the checks themselves, and never confused with a typing error.
 */
export function classifySignatureInput(raw: string): { state: "missing" | "malformed" | "valid"; reason: string | null } {
  const s = raw.trim();
  // QA 11 L8: each reason is one plain sentence, shown as it is; nothing is sent to an RPC for a malformed signature
  if (!s) return { state: "missing", reason: "Paste a transaction signature to check it." };
  if (!/^[1-9A-HJ-NP-Za-km-z]+$/.test(s)) return { state: "malformed", reason: "That is not a Solana transaction signature. A signature uses only base58 letters and digits, with no 0, O, I or l, and no spaces or punctuation." };
  const bytes = b58decode(s);
  if (!bytes || bytes.length !== 64) return { state: "malformed", reason: `That is not a Solana transaction signature. A signature is 64 bytes, about 88 characters, and this one decodes to ${bytes ? bytes.length : 0} bytes.` };
  return { state: "valid", reason: null };
}

export interface Rpc { call<T>(method: string, params: unknown[]): Promise<T> }
export type SourceFetch = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export const LABELS: Record<CheckId, string> = {
  tx: "Transaction exists and succeeded",
  program: "Ran the pinned burn program's crank",
  memo: "Program memo parses",
  reading: "On-chain Reading account agrees with the memo",
  config: "Token config is the Reading's own",
  rules: "Published rules file hashes to the on-chain rules hash",
  source: "Source data re-fetched and matches",
  units: "Units recomputed from the source values",
  spend: "Spend recomputed (program fixed point)",
  burn: "Every token bought was burned in this transaction",
};

/**
 * A JSON-RPC client over fetch (the public devnet endpoint answers browsers: it sends Access-Control-Allow-Origin). `minIntervalMs`
 * paces calls (the public endpoints rate-limit bursts); a 429 backs off and retries up to `attempts` times.
 */
export function jsonRpc(url: string, fetchImpl: typeof fetch = fetch, o: { attempts?: number; baseMs?: number; minIntervalMs?: number } = {}): Rpc {
  const attempts = o.attempts ?? 5, base = o.baseMs ?? 700, gap = o.minIntervalMs ?? 0;
  let last = 0;
  return {
    async call<T>(method: string, params: unknown[]): Promise<T> {
      for (let attempt = 0; attempt < attempts; attempt++) {
        const wait = last + gap - Date.now();
        if (wait > 0) await new Promise((ok) => setTimeout(ok, wait));
        last = Date.now();
        await takeRpc(url, { method });   // the request budget (apiBudget.ts): a hold throws, it is not retried here
        const r = await fetchImpl(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(15_000) });   // prelaunch audit H1
        // 429 and 5xx are retried; any other non-OK status is a failed read. A failed read THROWS — it is never an empty result
        // (ChatGPT re-check 2026-10-11 F1: a 503 JSON body or a bodyless 200 used to come back as `undefined` and read as "no account").
        if (r.status === 429 || r.status >= 500) { if (attempt + 1 < attempts) { await new Promise((ok) => setTimeout(ok, base * 2 ** attempt)); continue; } throw new Error(`${method}: the RPC answered HTTP ${r.status}`); }
        if (!r.ok) throw new Error(`${method}: the RPC answered HTTP ${r.status}`);
        let j: { jsonrpc?: string; result?: T; error?: { message: string } };
        try { j = (await r.json()) as typeof j; } catch { throw new Error(`${method}: the RPC answered HTTP ${r.status} with a body that is not JSON`); }
        if (j === null || typeof j !== "object") throw new Error(`${method}: the RPC answer is not a JSON-RPC envelope`);
        if (j.error) throw new Error(`${method}: ${j.error.message}`);
        // a JSON-RPC success carries a `result` member (null is a real answer for getTransaction); a body without one is not an answer
        if (!("result" in j)) throw new Error(`${method}: the RPC answer has no result (not a JSON-RPC envelope)`);
        return j.result as T;
      }
      throw new Error(`${method}: rate-limited by the RPC`);
    },
  };
}

/** "1 unit", "3 units": a count in words, never "unit(s)". */
const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

export const PUBLIC_RPC: Record<"devnet" | "mainnet", string> = { devnet: "https://api.devnet.solana.com", mainnet: "https://api.mainnet-beta.solana.com" };
export const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TREASURY_FEED_ID = "treasury.debt_to_penny";
/** The exact request the keeper reads and the attester hashes into source_url_hash (one business day per request). */
export const treasuryUrl = (date: string): string => `https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/debt_to_penny?fields=record_date,tot_pub_debt_out_amt&filter=record_date:eq:${date}`;

// ---- the program's arithmetic (mirror of src/lib/burnReceipts/math.ts; the tests hold them equal) ----

const B = (n: number | bigint | string): bigint => BigInt(n);
const SCALE = B(10) ** B(18);
export const CARRY_CONSECUTIVE = 0;
export const CARRY_NONE = 1;
/** Reading.outcome (programs/burn-receipts/programs/burn_receipts/src/constants.rs OUTCOME_*). */
export const OUTCOME_BELOW_FLOOR = 3;

export function stepUnits(prev: bigint, now: bigint, carryIn: bigint, unit: bigint, carryRule: number): { units: bigint; carryOut: bigint } {
  const delta = now - prev;
  if (delta <= B(0)) return { units: B(0), carryOut: B(0) };
  const total = carryRule === CARRY_CONSECUTIVE ? delta + carryIn : delta;
  return { units: total / unit, carryOut: carryRule === CARRY_CONSECUTIVE ? total % unit : B(0) };
}

export function ruleSpend(pool: bigint, units: bigint, bps: number): bigint {
  if (units <= B(0) || pool <= B(0)) return B(0);
  const keepFactor = (SCALE / B(10_000)) * (B(10_000) - B(bps));
  let result = SCALE, b = keepFactor, e = units;
  while (e > B(0)) {
    if ((e & B(1)) === B(1)) result = (result * b) / SCALE;
    e >>= B(1);
    if (e > B(0)) b = (b * b) / SCALE;
  }
  return pool - (pool * result) / SCALE;
}

export function fixed(value: bigint, decimals: number): string {
  const neg = value < B(0), v = neg ? -value : value;
  if (decimals === 0) return `${neg ? "-" : ""}${v}`;
  const s = B(10) ** B(decimals);
  return `${neg ? "-" : ""}${v / s}.${(v % s).toString().padStart(decimals, "0")}`;
}

export function tokens(raw: bigint, decimals: number): string {
  if (decimals === 0) return raw.toString();
  const s = B(10) ** B(decimals), w = raw / s, f = raw % s;
  return f === B(0) ? w.toString() : `${w}.${f.toString().padStart(decimals, "0").replace(/0+$/, "")}`;
}

export const dateText = (d: number): string => `${String(Math.floor(d / 10_000)).padStart(4, "0")}-${String(Math.floor(d / 100) % 100).padStart(2, "0")}-${String(d % 100).padStart(2, "0")}`;

// ---- the memo (v2 buyback, the program's format; src/lib/burnReceipts/memo.ts parseBuybackMemo is the reference) ----

export interface ProgramMemo { prefix: string; recordDate: string; source: string; prev: string; now: string; delta: string; units: number; pool: string; spent: string; got: string; burn: string; swap: string; rulesSha12: string }

export function parseProgramMemo(s: string): ProgramMemo | null {
  const p = s.split("|");
  if (p.length !== 14 || p[13] !== "v2" || !/^[A-Z0-9]{2,12}$/.test(p[0]) || !/^\d{4}-\d{2}-\d{2}$/.test(p[1])) return null;
  const keys = ["src", "prev", "now", "delta", "units", "pool", "spent", "got", "burn", "swap", "rules"];
  const v: Record<string, string> = {};
  for (let i = 0; i < keys.length; i++) { const part = p[i + 2]; if (!part.startsWith(`${keys[i]}=`)) return null; v[keys[i]] = part.slice(keys[i].length + 1); }
  if (!/^\d+$/.test(v.units) || !/^sha256:[0-9a-f]{12}$/.test(v.rules) || !/^(0|[1-9]\d*)$/.test(v.pool) || !/^(0|[1-9]\d*)$/.test(v.spent)) return null;
  return { prefix: p[0], recordDate: p[1], source: v.src, prev: v.prev, now: v.now, delta: v.delta, units: Number(v.units), pool: v.pool, spent: v.spent, got: v.got, burn: v.burn, swap: v.swap, rulesSha12: v.rules.slice(7) };
}

/** The memo text the Memo program logged inside the burn program's instruction. */
export function memoFromLogs(logs: string[] | null | undefined): string | null {
  const line = (logs ?? []).find((l) => l.startsWith("Program log: Memo (len "));
  if (!line) return null;
  const m = /^Program log: Memo \(len \d+\): "(.*)"$/.exec(line);
  return m ? m[1].replace(/\\"/g, "\"") : null;
}

// ---- the check ----

interface TxJson {
  slot: number; blockTime: number | null;
  meta: { err: unknown; logMessages: string[] | null; loadedAddresses?: { writable: string[]; readonly: string[] }; innerInstructions?: { index: number; instructions: { programIdIndex: number; accounts: number[]; data: string }[] }[]; postTokenBalances?: { mint: string; uiTokenAmount: { decimals: number } }[] } | null;
  transaction: { message: { accountKeys: string[]; instructions: { programIdIndex: number; accounts: number[]; data: string }[] } };
}
interface AccountJson { owner: string; data: [string, string] }
type Reading = { config: string; record_date: number; prev_date: number; value: bigint; prev_value: bigint; delta: bigint; carry_in: bigint; carry_out: bigint; units: bigint; source_url_hash: Uint8Array; processed: boolean; pool_lamports: bigint; spent_lamports: bigint; got: bigint; burned: bigint; rule_spend_lamports: bigint; carried_in_lamports: bigint; carried_out_lamports: bigint; outcome: number };
type TokenConfig = { mint: string; rule: { mode: number; carry_rule: number; value_decimals: number; unit_value: bigint; fraction_per_unit_bps: number; floor_lamports: bigint }; rules_sha256: Uint8Array; feed_id: Uint8Array; feed_id_len: number; memo_prefix: Uint8Array; memo_prefix_len: number };

const txt = (b: Uint8Array, n: number) => new TextDecoder().decode(b.subarray(0, n));

export interface CheckOptions {
  signature: string; cluster: "devnet" | "mainnet"; programId: string; rpc: Rpc;
  /** The token's published rules file, byte for byte (from the sample list, the token page, or pasted). Null skips "rules" (ok: null). */
  rulesText: string | null;
  /** Fetches the source (window.fetch in the browser). Null skips "source" and makes "units" use the on-chain values. */
  fetchSource: SourceFetch | null;
}

export async function checkReceiptTx(o: CheckOptions): Promise<ReceiptCheckResult> {
  const checks: ReceiptCheck[] = [];
  const add = (id: CheckId, ok: boolean | null, detail: string) => checks.push({ id, label: LABELS[id], ok, detail });
  const facts: ReceiptFacts = { signature: o.signature, cluster: o.cluster, slot: null, blockTime: null, memo: null, ticker: null, recordDate: null, prevDate: null, units: null, readingAddress: null, configAddress: null, mint: null, rulesSha256: null, sourceUrl: null, prevSourceUrl: null, explorerUrl: `https://explorer.solana.com/tx/${o.signature}${o.cluster === "devnet" ? "?cluster=devnet" : ""}` };
  const done = (): ReceiptCheckResult => {
    const failed = checks.some((c) => c.ok === false);
    const core = (["tx", "program", "memo", "reading", "units"] as CheckId[]).every((id) => checks.find((c) => c.id === id)?.ok === true);
    return { verified: !failed && core, checks, facts };
  };
  const input = classifySignatureInput(o.signature);
  if (input.state !== "valid") return { verified: false, checks: [], facts: { ...facts, explorerUrl: null }, inputError: { state: input.state, reason: input.reason! } };

  // tx + program
  let tx: TxJson | null;
  try { tx = await o.rpc.call<TxJson | null>("getTransaction", [o.signature, { encoding: "json", maxSupportedTransactionVersion: 0, commitment: "confirmed" }]); }
  catch (e) { add("tx", null, `the RPC did not answer: ${(e as Error).message.slice(0, 160)}`); return done(); }
  if (!tx || !tx.meta) { add("tx", false, `no confirmed transaction ${o.signature.slice(0, 12)}… on ${o.cluster}`); return done(); }
  facts.slot = tx.slot; facts.blockTime = tx.blockTime ? new Date(tx.blockTime * 1000).toISOString() : null;
  if (tx.meta.err) { add("tx", false, `the transaction failed on chain: ${JSON.stringify(tx.meta.err).slice(0, 120)}`); return done(); }
  add("tx", true, `confirmed in slot ${tx.slot}${facts.blockTime ? ` at ${facts.blockTime}` : ""}, no error`);
  const keys = [...tx.transaction.message.accountKeys, ...(tx.meta.loadedAddresses?.writable ?? []), ...(tx.meta.loadedAddresses?.readonly ?? [])];
  const logs = tx.meta.logMessages ?? [];
  const pidIx = logs.findIndex((l) => l === `Program ${o.programId} invoke [1]`);
  const ixName = pidIx >= 0 ? logs[pidIx + 1] ?? "" : "";
  if (pidIx < 0) { add("program", false, `the transaction never invokes the burn program ${o.programId}`); return done(); }
  if (ixName !== "Program log: Instruction: CrankBuyback") { add("program", false, `the burn program ran "${ixName.replace("Program log: Instruction: ", "")}", not CrankBuyback (this page checks buyback receipts)`); return done(); }
  add("program", true, `burn program ${o.programId.slice(0, 8)}… ran CrankBuyback (top level)`);

  // memo
  const memo = memoFromLogs(logs);
  facts.memo = memo;
  const m = memo ? parseProgramMemo(memo) : null;
  if (!m) { add("memo", false, memo ? "the memo does not parse as the program's v2 buyback memo" : "no memo in the transaction logs"); return done(); }
  facts.ticker = m.prefix; facts.recordDate = m.recordDate; facts.units = String(m.units);
  add("memo", true, `${m.prefix} · reading ${m.recordDate} · ${plural(Number(m.units), "unit")} · pool ${m.pool} · spent ${m.spent} lamports · burn ${m.burn} · rules sha256:${m.rulesSha12}`);

  // accounts
  let accounts: (AccountJson | null)[];
  try { accounts = (await o.rpc.call<{ value: (AccountJson | null)[] }>("getMultipleAccounts", [keys, { encoding: "base64", commitment: "confirmed" }])).value; }
  catch (e) { add("reading", null, `the RPC did not return the accounts: ${(e as Error).message.slice(0, 160)}`); return done(); }
  let reading: Reading | null = null, readingAt = -1, cfg: TokenConfig | null = null, cfgAt = -1;
  accounts.forEach((a, i) => {
    if (!a || a.owner !== o.programId) return;
    const d = base64ToBytes(a.data[0]);
    if (isAccount(BURN_RECEIPTS_IDL, "Reading", d)) { const r = readAccount<Reading>(BURN_RECEIPTS_IDL, "Reading", d); if (dateText(r.record_date) === m.recordDate) { reading = r; readingAt = i; } }
    else if (isAccount(BURN_RECEIPTS_IDL, "TokenConfig", d)) { cfg = readAccount<TokenConfig>(BURN_RECEIPTS_IDL, "TokenConfig", d); cfgAt = i; }
  });
  const R = reading as Reading | null, C = cfg as TokenConfig | null;
  if (!R) { add("reading", false, `no account owned by the burn program in this transaction is the Reading for ${m.recordDate}`); return done(); }
  if (!C) { add("config", false, "no TokenConfig owned by the burn program in this transaction"); return done(); }
  facts.readingAddress = keys[readingAt]; facts.configAddress = keys[cfgAt]; facts.mint = C.mint; facts.prevDate = dateText(R.prev_date);
  const dec = C.rule.value_decimals;
  const mintDecimals = tx.meta.postTokenBalances?.find((b) => b.mint === C.mint)?.uiTokenAmount.decimals ?? 6;
  const rBad: string[] = [];
  if (!R.processed) rBad.push("the Reading is not marked processed");
  if (fixed(R.prev_value, dec) !== m.prev) rBad.push(`prev ${fixed(R.prev_value, dec)} ≠ memo ${m.prev}`);
  if (fixed(R.value, dec) !== m.now) rBad.push(`now ${fixed(R.value, dec)} ≠ memo ${m.now}`);
  if (fixed(R.delta, dec) !== m.delta) rBad.push(`delta ${fixed(R.delta, dec)} ≠ memo ${m.delta}`);
  if (R.units.toString() !== String(m.units)) rBad.push(`units ${R.units} ≠ memo ${m.units}`);
  if (R.pool_lamports.toString() !== m.pool) rBad.push(`pool ${R.pool_lamports} ≠ memo ${m.pool}`);
  if (R.spent_lamports.toString() !== m.spent) rBad.push(`spent ${R.spent_lamports} ≠ memo ${m.spent}`);
  if (tokens(R.got, mintDecimals) !== m.got) rBad.push(`got ${tokens(R.got, mintDecimals)} ≠ memo ${m.got}`);
  if (tokens(R.burned, mintDecimals) !== m.burn) rBad.push(`burned ${tokens(R.burned, mintDecimals)} ≠ memo ${m.burn}`);
  add("reading", rBad.length ? false : true, rBad.length ? rBad.join("; ") : `Reading ${keys[readingAt].slice(0, 8)}… (owned by the program): ${m.prev} → ${m.now}, ${plural(Number(R.units), "unit")}, pool ${R.pool_lamports}, spent ${R.spent_lamports}, burned ${tokens(R.burned, mintDecimals)} — all as the memo says`);

  const prefix = txt(C.memo_prefix, C.memo_prefix_len);
  const cBad: string[] = [];
  if (R.config !== keys[cfgAt]) cBad.push(`the Reading belongs to config ${R.config.slice(0, 8)}…, not ${keys[cfgAt].slice(0, 8)}…`);
  if (prefix !== m.prefix) cBad.push(`config memo prefix ${prefix} ≠ memo ${m.prefix}`);
  const shaHex = toHex(C.rules_sha256);
  facts.rulesSha256 = shaHex;
  if (!shaHex.startsWith(m.rulesSha12)) cBad.push(`config rules hash ${shaHex.slice(0, 12)} ≠ memo ${m.rulesSha12}`);
  add("config", cBad.length ? false : true, cBad.length ? cBad.join("; ") : `TokenConfig ${keys[cfgAt].slice(0, 8)}… · mint ${C.mint.slice(0, 8)}… · prefix ${prefix} · rules sha256 ${shaHex.slice(0, 16)}…`);

  // rules
  if (o.rulesText === null) add("rules", null, `no rules file given; the on-chain hash is ${shaHex}`);
  else {
    const h = await sha256Hex(o.rulesText);
    add("rules", h === shaHex, h === shaHex ? `sha256 of the rules file = ${h.slice(0, 16)}… = the TokenConfig's rules_sha256 (and the memo's ${m.rulesSha12})` : `sha256 of the given file is ${h.slice(0, 16)}…, the TokenConfig stores ${shaHex.slice(0, 16)}…`);
  }

  // source
  const feed = txt(C.feed_id, C.feed_id_len);
  let prevV = R.prev_value, nowV = R.value, fromSource = false;
  if (feed !== TREASURY_FEED_ID) add("source", null, `feed ${feed}: this page re-fetches the Treasury feed only; use GET /api/burnticker/v1/tokens/{ticker}/verify/{id} for this one`);
  else {
    const url = treasuryUrl(facts.recordDate!), prevUrl = treasuryUrl(facts.prevDate!);
    facts.sourceUrl = url; facts.prevSourceUrl = prevUrl;
    const urlHash = await sha256Hex(url);
    if (urlHash !== toHex(R.source_url_hash)) add("source", false, `sha256 of ${url} is ${urlHash.slice(0, 16)}…; the Reading's source_url_hash is ${toHex(R.source_url_hash).slice(0, 16)}…`);
    else if (!o.fetchSource) add("source", null, "the Reading's source_url_hash = sha256 of the Treasury URL for that date; the source was not fetched here");
    else {
      try {
        const get = async (u: string, date: string): Promise<string | null> => {
          const res = await o.fetchSource!(u);
          if (!res.ok) throw new Error(`Treasury HTTP ${res.status}`);
          const j = (await res.json()) as { data?: { record_date: string; tot_pub_debt_out_amt: string }[] };
          return j.data?.find((row) => row.record_date === date)?.tot_pub_debt_out_amt ?? null;
        };
        const [a, b] = await Promise.all([get(prevUrl, facts.prevDate!), get(url, facts.recordDate!)]);
        if (a === null || b === null) add("source", null, `the Treasury API did not return both dates (${facts.prevDate}: ${a ?? "none"}, ${facts.recordDate}: ${b ?? "none"})`);
        else if (a === fixed(R.prev_value, dec) && b === fixed(R.value, dec)) { add("source", true, `Treasury says ${facts.prevDate} ${a} and ${facts.recordDate} ${b} — the Reading's values; and sha256(URL) = the Reading's source_url_hash`); prevV = R.prev_value; nowV = R.value; fromSource = true; }
        else add("source", false, `Treasury says ${facts.prevDate} ${a}, ${facts.recordDate} ${b}; the Reading says ${fixed(R.prev_value, dec)} → ${fixed(R.value, dec)}`);
      } catch (e) { add("source", null, `the source could not be fetched from here: ${(e as Error).message.slice(0, 120)}`); }
    }
  }

  // units
  const s = stepUnits(prevV, nowV, R.carry_in, C.rule.unit_value, C.rule.carry_rule);
  const uOk = s.units === R.units && s.carryOut === R.carry_out && s.units.toString() === String(m.units);
  add("units", uOk, `${fromSource ? "from the source values" : "from the on-chain values (source not confirmed here)"}: (${fixed(nowV, dec)} − ${fixed(prevV, dec)}${C.rule.carry_rule === CARRY_CONSECUTIVE ? ` + carry ${fixed(R.carry_in, dec)}` : ""}) ÷ ${fixed(C.rule.unit_value, dec)} = ${plural(Number(s.units), "unit")}, carry ${fixed(s.carryOut, dec)}${uOk ? "" : ` — the Reading says ${R.units} unit(s), carry ${fixed(R.carry_out, dec)}`}`);

  // spend
  const rs = ruleSpend(R.pool_lamports, R.units, C.rule.fraction_per_unit_bps);
  const formula = `rule spend = ${R.pool_lamports} × (1 − (1 − ${C.rule.fraction_per_unit_bps}/10000)^${R.units}) = ${rs} lamports${rs === R.rule_spend_lamports ? " (= the Reading's)" : ` ≠ the Reading's ${R.rule_spend_lamports}`}`;
  const belowFloor = R.outcome === OUTCOME_BELOW_FLOOR;
  if (belowFloor) {
    const ok = rs === R.rule_spend_lamports && rs + R.carried_in_lamports < C.rule.floor_lamports && R.spent_lamports === B(0) && R.got === B(0) && R.burned === B(0);
    add("spend", ok, `${formula}; under the spend floor fixed at launch (${C.rule.floor_lamports} lamports): nothing bought, the pool keeps the SOL${ok ? "" : " — but the Reading does not show that"}`);
  } else {
    const balanced = R.spent_lamports + R.carried_out_lamports === rs + R.carried_in_lamports;
    const spOk = rs === R.rule_spend_lamports && balanced && R.spent_lamports <= R.pool_lamports;
    add("spend", spOk, `${formula}; spent ${R.spent_lamports} + carried out ${R.carried_out_lamports} ${balanced ? "=" : "≠"} rule ${rs} + carried in ${R.carried_in_lamports}${R.carried_out_lamports > B(0) ? " (one crank spends at most 2% of the pool's SOL reserve and carries the rest)" : ""}`);
  }

  // burn: the token program's Burn (8) / BurnChecked (15) inner instructions under the burn program, summed
  let burned = B(0), burns = 0;
  for (const g of tx.meta.innerInstructions ?? []) for (const ix of g.instructions) {
    if (keys[ix.programIdIndex] !== TOKEN_PROGRAM) continue;
    const d = b58decode(ix.data);
    if (!d || (d[0] !== 8 && d[0] !== 15) || d.length < 9 || keys[ix.accounts[1]] !== C.mint) continue;
    let amt = B(0);
    for (let i = 8; i >= 1; i--) amt = (amt << B(8)) | B(d[i]);
    burned += amt; burns++;
  }
  if (belowFloor && burns === 0 && R.got === B(0)) { add("burn", true, "nothing was bought (under the spend floor), so there was nothing to burn; no Burn instruction, as expected"); return done(); }
  const bOk = burns > 0 && burned === R.burned && R.burned === R.got;
  add("burn", bOk, burns === 0 ? "no token Burn instruction for this mint in the transaction" : `${plural(burns, "Burn instruction")} for mint ${C.mint.slice(0, 8)}… burned ${tokens(burned, mintDecimals)}; the swap bought ${tokens(R.got, mintDecimals)}`);
  return done();
}
