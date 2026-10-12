import fs from "node:fs";
import crypto from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { PublicKey } from "@solana/web3.js";
import { attestationMessage, sourceUrlHash, ZERO_HASH } from "@/lib/burnReceipts/attestation";
import { formatDate } from "@/lib/burnReceipts/math";
import { rowUrl, type DebtReading } from "@/lib/burnKeeper/feeds/treasury";
import { rulesFromText } from "@/lib/burnKeeper/rules";
import { counterAt, parseDay, readingMessage, signReading } from "@/lib/burnticker/attesters/byo";
import { requestProblem, type CosignAnswer, type CosignRequest, type ReadingCosignRequest } from "@/lib/burnticker/attesters/cosign";
import { receiptDay } from "@/lib/burnticker/multiKeeper";
import { lockRule, type BurnRule } from "@/lib/burnticker/rules";
import type { SettledEvent } from "@/lib/burnticker/units";

/**
 * THE SECOND SIGNER'S DECISION (signer-2, 2026-10-12): runs on the separate host (scripts/burnticker-signer.mts). The wire format and
 * the keeper side are in cosign.ts. Everything in a request is only a claim to compare; the signer reads the rules and the primary
 * source itself and signs its OWN bytes only when they equal the keeper's.
 */

/**
 * A coin the signer serves. `units`: a Burnticker coin whose reading is its unit counter (multiKeeper; rules.json from the registry).
 * `debt`: a coin on the $DEFICIT keeper (mct-burnkeeper, programChain.ts) whose reading is Treasury's debt to the penny for the day in
 * cents (its rules file is the burnkeeper's DebtRuleFile). `baselineAt` is the launch time (ISO), pinned by the operator from the launch
 * transaction when the coin is added to the signer.
 */
export interface SignerCoin { mint: string; ticker: string; kind: "units" | "debt"; rulesText: string; baselineAt: string }
/** What the signer reads from the chain for a coin (read-only RPC; optional so tests and offline checks run without one). */
export interface SignerChainView { genesis: string; programId: string; rulesSha256: string; feedId: string; valueDecimals: number; hasBaseline: boolean; lastRecordDate: number; attesters: string[] }

/** Every message the signer ever signed, per coin and day: it never signs a second, different one. */
export interface SignJournal { get(key: string): string | null; put(key: string, message: string, signature: string, at: number): void }

export function memoryJournal(): SignJournal {
  const m = new Map<string, string>();
  return { get: (k) => m.get(k) ?? null, put: (k, msg) => { m.set(k, msg); } };
}
/** Append-only JSON lines (one per signature), read back at start. Written mode 600 outside any repository is the operator's choice. */
export function fileJournal(file: string): SignJournal {
  const m = new Map<string, string>();
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try { const j = JSON.parse(line) as { key: string; message: string }; if (!m.has(j.key)) m.set(j.key, j.message); } catch { throw new Error(`${file}: a journal line is not JSON — refusing to start rather than forget what was signed`); }
    }
  } else fs.mkdirSync(path.dirname(file), { recursive: true });
  return {
    get: (k) => m.get(k) ?? null,
    put: (k, message, signature, at) => { fs.appendFileSync(file, `${JSON.stringify({ key: k, message, signature, at: new Date(at).toISOString() })}\n`, { mode: 0o600 }); m.set(k, message); },
  };
}

export interface SignerDeps {
  /** The burn_receipts program id and cluster genesis THIS host signs for (never taken from a request). */
  programId: string; genesis: string;
  secretKey: Uint8Array;
  coin(mint: string): Promise<SignerCoin | null>;
  /** A units coin's settled source readings, read by this host from the primary source (CatalogueAdapter / Polymarket's payout). */
  readings(rule: BurnRule): Promise<SettledEvent[]>;
  /** Treasury's debt-to-the-penny rows on or after `from` (YYYY-MM-DD), validated, oldest first — read by this host from fiscaldata. */
  debtRows(from: string): Promise<DebtReading[]>;
  chain?(mint: string): Promise<SignerChainView | null>;
  journal: SignJournal;
  now(): number;
  log(line: string): void;
}

const DAY_MS = 86_400_000;
const ymdToMs = (d: number) => Date.UTC(Math.floor(d / 10_000), (Math.floor(d / 100) % 100) - 1, d % 100);
const msToYmd = (ms: number) => { const x = new Date(ms); return x.getUTCFullYear() * 10_000 + (x.getUTCMonth() + 1) * 100 + x.getUTCDate(); };
type Field = { field: string; keeper: string; signer: string };

/** The signer's whole decision for one request. Never throws: every failure is an answer. */
export async function decideCosign(d: SignerDeps, req: unknown): Promise<CosignAnswer> {
  try {
    const problem = requestProblem(req);
    if (problem) return { status: "cannot-check", why: `refused: ${problem}` };
    const r = req as CosignRequest;
    if (r.kind === "pair") return { status: "cannot-check", why: "this signer does not check pair results yet (an independent replay of a pair's pool gate and roles is not built)" };
    return await decideReading(d, r);
  } catch (e) {
    return { status: "cannot-check", why: `the signer failed: ${((e as Error).message || "error").slice(0, 160)}` };
  }
}

async function decideReading(d: SignerDeps, r: ReadingCosignRequest): Promise<CosignAnswer> {
  const fields: Field[] = [];
  if (r.programId !== d.programId) fields.push({ field: "program", keeper: r.programId, signer: d.programId });
  if (r.genesis !== d.genesis) fields.push({ field: "cluster", keeper: r.genesis, signer: d.genesis });
  if (fields.length) return { status: "disagree", why: "the request names another program or cluster than this signer serves", fields };
  const coin = await d.coin(r.mint);
  if (!coin) return { status: "cannot-check", why: `this signer does not serve ${r.mint}` };
  if (coin.ticker !== r.ticker) return { status: "disagree", why: "the ticker differs", fields: [{ field: "ticker", keeper: r.ticker, signer: coin.ticker }] };
  if (r.proofHash !== "0".repeat(64)) return { status: "cannot-check", why: "this signer checks only readings with a zero proof (no Burn Derby or end-of-rule clock days yet)" };
  const rulesSha = coin.kind === "debt" ? rulesFromText(coin.rulesText).sha256 : lockRule(JSON.parse(coin.rulesText)).sha256;
  const recordDate = parseDay(r.recordDate);
  // The previous reading date: the chain's (what the program enforces) when this host has an RPC, else the keeper's claim.
  let prevDate = r.prevDate === null ? 0 : parseDay(r.prevDate);
  const chain = d.chain ? await d.chain(r.mint) : null;
  if (d.chain && !chain) return { status: "cannot-check", why: "the coin's TokenConfig could not be read from this signer's RPC" };
  if (chain) {
    if (chain.rulesSha256 !== rulesSha) return { status: "cannot-check", why: `the rules this signer holds (${rulesSha.slice(0, 12)}…) are not the rules the chain pinned (${chain.rulesSha256.slice(0, 12)}…)` };
    if (chain.genesis !== d.genesis || chain.programId !== d.programId) return { status: "cannot-check", why: "the RPC serves another cluster or program than this signer is set up for" };
    const chainPrev = chain.hasBaseline ? chain.lastRecordDate : 0;
    if (chainPrev !== prevDate) fields.push({ field: "previous reading", keeper: r.prevDate ?? "none", signer: chainPrev ? formatDate(chainPrev) : "none" });
    prevDate = chainPrev;
  }
  const own = coin.kind === "debt" ? await debtReading(d, coin, r, chain, prevDate, recordDate, fields) : await unitsReading(d, coin, r, prevDate, recordDate, fields);
  if ("answer" in own) return own.answer;
  if (own.message !== r.message && !fields.length) fields.push({ field: "message", keeper: r.message, signer: own.message });
  if (fields.length) {
    d.log(`[signer] DISAGREE $${coin.ticker} ${r.recordDate}: ${fields.map((f) => f.field).join(", ")}`);
    return { status: "disagree", why: `the second signer worked out a different reading for $${coin.ticker} on ${r.recordDate}`, fields };
  }
  const key = `${r.mint}|${r.recordDate}`;
  const earlier = d.journal.get(key);
  if (earlier !== null && earlier !== own.message) {
    d.log(`[signer] REFUSED $${coin.ticker} ${r.recordDate}: a different message was signed for this day before`);
    return { status: "disagree", why: `this signer already signed a different message for $${coin.ticker} on ${r.recordDate} and never signs two`, fields: [{ field: "earlier signature", keeper: r.message, signer: earlier }] };
  }
  const signed = signReading(d.secretKey, own.message);
  if (chain && !chain.attesters.includes(signed.publicKey)) d.log(`[signer] note: ${signed.publicKey.slice(0, 8)}… is not yet an attester of $${coin.ticker} (a shadow signature: it agrees, and the program will not count it)`);
  if (earlier === null) d.journal.put(key, own.message, signed.signature, d.now());
  d.log(`[signer] signed $${coin.ticker} ${r.recordDate}: ${own.summary}`);
  return { status: "signed", key: signed.publicKey, signature: signed.signature };
}

/** A unit-counter coin: the keeper's own engine over the readings this host fetched (byo.ts counterAt). */
async function unitsReading(d: SignerDeps, coin: SignerCoin, r: ReadingCosignRequest, prevDate: number, recordDate: number, fields: Field[]): Promise<{ message: string; summary: string } | { answer: CosignAnswer }> {
  const locked = lockRule(JSON.parse(coin.rulesText));
  if (locked.rule.pair) return { answer: { status: "cannot-check", why: "this signer does not check rivalry-pair coins yet" } };
  if (prevDate === 0) {
    const baselineDay = msToYmd(ymdToMs(receiptDay(coin.baselineAt)) - DAY_MS);
    if (recordDate !== baselineDay) fields.push({ field: "baseline date", keeper: r.recordDate, signer: formatDate(baselineDay) });
  }
  let readings: SettledEvent[];
  try { readings = await d.readings(locked.rule); } catch (e) { return { answer: { status: "cannot-check", why: `the source could not be read by this signer (${((e as Error).message || "error").slice(0, 120)})` } }; }
  const c = counterAt({ mint: r.mint, ticker: coin.ticker, rulesText: coin.rulesText, baselineAt: coin.baselineAt, readings, recordDate, prevDate });
  const own = readingMessage({ genesis: d.genesis, programId: d.programId, mint: r.mint, c });
  if (c.value.toString() !== r.value) fields.push({ field: "unit counter", keeper: r.value, signer: c.value.toString() });
  if (c.feedId !== r.feedId) fields.push({ field: "feed", keeper: r.feedId, signer: c.feedId });
  if (c.sourceUrl !== r.sourceUrl) fields.push({ field: "receipts counted", keeper: r.eventIds.join(",") || "none", signer: c.eventIds.join(",") || "none" });
  return { message: own.message, summary: `unit counter ${c.value} (${c.eventIds.length} ${c.eventIds.length === 1 ? "receipt" : "receipts"})` };
}

/**
 * A $DEFICIT-style coin (the burnkeeper): the value is Treasury's total public debt outstanding for the record date, in cents, read by
 * this host from fiscaldata. Also checked: no Treasury date between the previous reading and this one was skipped, and a baseline is
 * no older than the last Treasury date published before launch (an old baseline would make the first delta, and its burn, too big).
 */
async function debtReading(d: SignerDeps, coin: SignerCoin, r: ReadingCosignRequest, chain: SignerChainView | null, prevDate: number, recordDate: number, fields: Field[]): Promise<{ message: string; summary: string } | { answer: CosignAnswer }> {
  const rules = rulesFromText(coin.rulesText).rules;
  const D = formatDate(recordDate);
  const launchDay = new Date(Date.parse(coin.baselineAt)).toISOString().slice(0, 10);
  const from = prevDate ? formatDate(prevDate) : new Date(Math.min(Date.parse(`${D}T00:00:00Z`), Date.parse(`${launchDay}T00:00:00Z`)) - 14 * DAY_MS).toISOString().slice(0, 10);
  let rows: DebtReading[];
  try { rows = await d.debtRows(from); } catch (e) { return { answer: { status: "cannot-check", why: `Treasury could not be read by this signer (${((e as Error).message || "error").slice(0, 120)})` } }; }
  const row = rows.find((x) => x.recordDate === D);
  if (!row) {
    if (rows.some((x) => x.recordDate > D)) fields.push({ field: "record date", keeper: D, signer: "Treasury published later dates but none for this one" });
    else return { answer: { status: "cannot-check", why: `Treasury shows no row for ${D} to this signer yet` } };
  }
  if (row && row.cents.toString() !== r.value) fields.push({ field: "debt in cents", keeper: r.value, signer: row.cents.toString() });
  if (prevDate) {
    const skipped = rows.filter((x) => x.recordDate > formatDate(prevDate) && x.recordDate < D).map((x) => x.recordDate);
    if (skipped.length) fields.push({ field: "skipped dates", keeper: "none", signer: skipped.join(",") });
  } else {
    // Treasury publishes a day's row a business day or more later, so only a row dated more than three days before launch counts.
    const cutoff = new Date(Date.parse(`${launchDay}T00:00:00Z`) - 3 * DAY_MS).toISOString().slice(0, 10);
    const later = rows.filter((x) => x.recordDate > D && x.recordDate < cutoff).map((x) => x.recordDate);
    if (later.length) fields.push({ field: "baseline date", keeper: D, signer: `Treasury had ${later[later.length - 1]} well before launch` });
  }
  const feedId = chain?.feedId ?? rules.feed.id;
  const decimals = chain?.valueDecimals ?? 2;
  if (feedId !== r.feedId) fields.push({ field: "feed", keeper: r.feedId, signer: feedId });
  const src = rowUrl(D);
  if (src !== r.sourceUrl) fields.push({ field: "source address", keeper: r.sourceUrl, signer: src });
  const cents = row ? row.cents : BigInt(r.value);
  const message = attestationMessage(d.genesis, new PublicKey(d.programId), new PublicKey(r.mint), feedId, prevDate, recordDate, cents, decimals, sourceUrlHash(src), ZERO_HASH).toString("utf8");
  return { message, summary: `Treasury debt $${row?.amount ?? "?"} (prev ${prevDate ? formatDate(prevDate) : "none"})` };
}

/**
 * The signer's HTTP face: POST /v1/cosign (JSON request → JSON answer, always HTTP 200 with a decision, 401 without the token, 413 over
 * 16 KB) and GET /v1/health (the public key, program, cluster and the coins served; no secrets). Requests are decided ONE AT A TIME, so
 * the journal never races. The token keeps strangers from making this host read sources; it is not what makes a signature safe.
 */
export function cosignHttpHandler(d: SignerDeps, o: { token: string | null; info: () => Record<string, unknown> }): (req: IncomingMessage, res: ServerResponse) => void {
  let queue: Promise<unknown> = Promise.resolve();
  const send = (res: ServerResponse, code: number, body: unknown) => { res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(body)); };
  const authed = (req: IncomingMessage): boolean => {
    if (!o.token) return true;
    const got = Buffer.from(String(req.headers.authorization ?? ""), "utf8"), want = Buffer.from(`Bearer ${o.token}`, "utf8");
    return got.length === want.length && crypto.timingSafeEqual(got, want);
  };
  return (req, res) => {
    const url = (req.url ?? "/").split("?")[0];
    if (req.method === "GET" && url === "/v1/health") return send(res, 200, o.info());
    if (req.method !== "POST" || url !== "/v1/cosign") return send(res, 404, { error: "not found" });
    if (!authed(req)) return send(res, 401, { error: "a bearer token is required" });
    const chunks: Buffer[] = []; let size = 0, over = false;
    req.on("data", (c: Buffer) => { if (over) return; size += c.length; if (size > 16_384) { over = true; send(res, 413, { error: "the request is too large" }); } else chunks.push(c); });
    req.on("end", () => {
      if (over) return;
      let body: unknown;
      try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return send(res, 200, { status: "cannot-check", why: "refused: the request is not JSON" } satisfies CosignAnswer); }
      const job = queue.then(() => decideCosign(d, body));
      queue = job.catch(() => undefined);
      job.then((a) => send(res, 200, a), (e: Error) => send(res, 200, { status: "cannot-check", why: `the signer failed: ${e.message.slice(0, 120)}` } satisfies CosignAnswer));
    });
    req.on("error", () => { if (!res.headersSent) send(res, 400, { error: "bad request" }); });
  };
}
