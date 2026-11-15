import crypto from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import fs from "node:fs";
import path from "node:path";
import { fromScaled } from "@/lib/burnticker/units";
import { DERBY_BOUNDARY_TOLERANCE_SEC, DERBY_MAX_CONF_RATIO, INDEX_PROXY_SYMBOLS, indexProxiesEnabled, PYTH_ID_RE } from "@/lib/burnticker/derby/spec";
import type { FetchLike } from "@/lib/burnticker/oracle/types";
import { sourceForUrl, takeOrThrow } from "@/lib/burnticker/apiBudget";
import { LruMap, jsonBytes } from "@/lib/burnticker/lru";

/**
 * PYTH — Burn Derby's PRIMARY source (2026-10-10). Pyth publishes signed price updates (accumulator updates whose Merkle root is signed by
 * the Wormhole guardians — the bytes Pyth's on-chain receiver program verifies); Hermes is Pyth's designed pull path for them. For a
 * window boundary t the keeper asks Hermes for the update at t:
 *
 *   GET {HERMES}/v2/updates/price/<t>?ids[]=<feed id>&encoding=base64&parsed=true
 *
 * and keeps the update BYTES: their sha256 is the reading's proof hash (it goes into the quorum-signed BURNRECEIPTS-v3 message as
 * proof=), the bytes themselves are stored so anyone can re-submit them to Pyth's receiver program or re-parse them. The parsed block
 * gives price, conf, expo and publish_time; the boundary rule is: the first update published AT OR AFTER t and within
 * DERBY_BOUNDARY_TOLERANCE_SEC of it, with conf ≤ DERBY_MAX_CONF_RATIO of the value — anything else withholds the window.
 *
 * KEYS (measured 2026-10-10): `v2/price_feeds` (the catalogue) answers keyless; every price-update path (`v2/updates/price/latest`,
 * `v2/updates/price/<t>`, the stream, `benchmarks.pyth.network/v1/updates/price/<t>`) answered 401 "unauthorized" to a keyless client.
 * So the host sets BURNTICKER_PYTH_API_KEY (sent as `Authorization: Bearer …`, never logged) and optionally BURNTICKER_PYTH_HERMES_URL.
 * The query parameter is `ids[]` (a bare `ids=` is rejected with HTTP 400 "missing field `ids[]`").
 *
 * The catalogue (1,883 feeds on 2026-10-10) is cached in config/burnticker/fixtures/pyth/feeds.json (symbol, id, asset_type) for the
 * wizard's search and the offline tests.
 */

export const HERMES_URL = "https://hermes.pyth.network";
/**
 * WIRING-AUDIT12 item 11: whether this host has a Pyth access key, so past daily closes can be read (a record close needs them). Only the
 * yes or no leaves the server (the catalogue's derby.recordCloseKeyed); the key itself never does.
 */
export const pythKeyed = (env: Readonly<Record<string, string | undefined>> = process.env): boolean => !!(env.BURNTICKER_PYTH_API_KEY ?? "").trim();
export const PYTH_FEEDS_FIXTURE = path.join("config", "burnticker", "fixtures", "pyth", "feeds.json");
/** Pyth SOL/USD — converts a pool TWAP (in SOL) to USD. */
export const PYTH_SOL_USD = "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";

export interface PythPoint {
  feed: string;
  /** Pyth's raw integer price and confidence, and the exponent: value = price × 10^expo. */
  price: string; conf: string; expo: number;
  /** The value as an exact decimal string. */
  value: string;
  publishTime: number;
  slot: number | null;
  /** sha256 (hex) of the update bytes Hermes returned (the accumulator update) — the proof hash. */
  updateSha256: string;
  /** The update bytes, base64, as returned (kept so the reading can be re-verified without Hermes). */
  updateBase64: string;
  /** The exact request URL (no key in it). */
  url: string;
}

export type PythRead = { ok: true; point: PythPoint } | { ok: false; reason: string };

/** price × 10^expo as a canonical decimal string (exact). */
export function pythValue(price: string, expo: number): string {
  const p = BigInt(price);
  return expo >= 0 ? (p * BigInt(10) ** BigInt(expo)).toString() : fromScaled(p, -expo);
}

export const sha256Hex = (b: Uint8Array | string): string => crypto.createHash("sha256").update(b).digest("hex");

interface HermesParsed { id: string; price: { price: string; conf: string; expo: number; publish_time: number }; metadata?: { slot?: number } }
interface HermesBody { binary?: { encoding?: string; data?: string[] }; parsed?: HermesParsed[] }

/**
 * Checks one Hermes body for a boundary: the feed is present, published at/after `ts` within the tolerance, a positive value, a
 * confidence interval inside the bound. Pure (the client and the tests share it).
 */
export function pointFromHermes(body: unknown, feed: string, ts: number, url: string, tol = DERBY_BOUNDARY_TOLERANCE_SEC): PythRead {
  const b = body as HermesBody | null;
  const parsed = b?.parsed?.find((x) => x.id?.replace(/^0x/, "").toLowerCase() === feed);
  if (!parsed) return { ok: false, reason: `Hermes returned no update for feed ${feed.slice(0, 12)}…` };
  const data = b?.binary?.data ?? [];
  if (!data.length || (b?.binary?.encoding ?? "base64") !== "base64") return { ok: false, reason: "Hermes returned no base64 update bytes (the proof)" };
  const pt = parsed.price;
  if (!pt || typeof pt.publish_time !== "number" || !/^-?\d+$/.test(String(pt.price)) || !/^\d+$/.test(String(pt.conf)) || !Number.isInteger(pt.expo)) return { ok: false, reason: "Hermes update is malformed" };
  if (pt.publish_time < ts) return { ok: false, reason: `the update was published at ${pt.publish_time}, before the boundary ${ts}` };
  if (pt.publish_time > ts + tol) return { ok: false, reason: `no Pyth update within ${tol} s after the boundary (first at ${pt.publish_time}, ${pt.publish_time - ts} s late)` };
  if (BigInt(pt.price) <= BigInt(0)) return { ok: false, reason: "Pyth value is not positive" };
  if (Number(pt.conf) > Number(pt.price) * DERBY_MAX_CONF_RATIO) return { ok: false, reason: `Pyth confidence ${pt.conf} exceeds ${DERBY_MAX_CONF_RATIO * 100}% of the value ${pt.price}` };
  const bytes = Buffer.concat(data.map((d) => Buffer.from(d, "base64")));
  return { ok: true, point: { feed, price: String(pt.price), conf: String(pt.conf), expo: pt.expo, value: pythValue(String(pt.price), pt.expo), publishTime: pt.publish_time, slot: parsed.metadata?.slot ?? null, updateSha256: sha256Hex(bytes), updateBase64: data.join(""), url } };
}

export const hermesBoundaryUrl = (base: string, feed: string, ts: number): string => `${base.replace(/\/+$/, "")}/v2/updates/price/${ts}?ids[]=${feed}&encoding=base64&parsed=true`;
export const hermesLatestUrl = (base: string, feed: string): string => `${base.replace(/\/+$/, "")}/v2/updates/price/latest?ids[]=${feed}&encoding=base64&parsed=true`;

/** A polite Hermes client: one request per (feed, boundary), spaced, every answer cached for good (a boundary update is immutable). */
export class HermesClient {
  readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly apiKey: string | null;
  private readonly minIntervalMs: number;
  private last = 0;
  // HB-1 (2026-10-19): kept for good, it gained one answer per (feed, boundary) for the life of the web process; now the newest 5,000
  // and at most 8 MB of JSON (an evicted boundary is read again: the answer is immutable, so the read gives the same price)
  private cache = new LruMap<string, unknown>(5_000, { maxWeight: 8 * 1024 * 1024, weigh: jsonBytes });
  constructor(o: { fetchImpl?: FetchLike; baseUrl?: string; apiKey?: string | null; minIntervalMs?: number } = {}) {
    this.fetchImpl = o.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
    this.baseUrl = o.baseUrl ?? HERMES_URL;
    this.apiKey = o.apiKey ?? null;
    this.minIntervalMs = o.minIntervalMs ?? 250;
  }
  static fromEnv(env: Readonly<Record<string, string | undefined>> = process.env, fetchImpl?: FetchLike): HermesClient {
    return new HermesClient({ fetchImpl, baseUrl: (env.BURNTICKER_PYTH_HERMES_URL ?? "").trim() || HERMES_URL, apiKey: (env.BURNTICKER_PYTH_API_KEY ?? "").trim() || null });
  }
  private async get(url: string): Promise<unknown> {
    if (this.cache.has(url)) return this.cache.get(url);
    const wait = this.last + this.minIntervalMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.last = Date.now();
    const headers: Record<string, string> = { accept: "application/json" };
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;
    await takeOrThrow(sourceForUrl(url));   // the request budget (apiBudget.ts)
    const res = await this.fetchImpl(url, { headers, signal: AbortSignal.timeout(15_000) });
    if (res.status === 401 || res.status === 403) throw new Error(`Hermes HTTP ${res.status}: price updates need a Pyth API key on this host (BURNTICKER_PYTH_API_KEY)`);
    if (!res.ok) throw new Error(`Hermes HTTP ${res.status}`);
    const body = await res.json();
    this.cache.set(url, body);
    return body;
  }
  /** The boundary update for one feed (`ts` = the boundary, unix seconds). Transport errors throw (retried); bad updates return a reason. */
  async atBoundary(feed: string, ts: number): Promise<PythRead> {
    if (!PYTH_ID_RE.test(feed)) throw new Error(`not a Pyth feed id: ${feed}`);
    const url = hermesBoundaryUrl(this.baseUrl, feed, ts);
    return pointFromHermes(await this.get(url), feed, ts, url);
  }
  /** The latest update (the wizard's live card; display only). */
  async latest(feed: string): Promise<PythRead> {
    const url = hermesLatestUrl(this.baseUrl, feed);
    this.cache.delete(url);
    const body = await this.get(url);
    this.cache.delete(url);
    const pt = (body as HermesBody).parsed?.[0]?.price;
    return pointFromHermes(body, feed, pt?.publish_time ?? 0, url, Number.MAX_SAFE_INTEGER);
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The catalogue (fixture) and the wizard's search over it
// ---------------------------------------------------------------------------------------------------------------------------------

export interface PythFeedRow { symbol: string; id: string; asset_type: string }
let catalogue: PythFeedRow[] | null = null;
export function loadPythCatalogue(file = PYTH_FEEDS_FIXTURE): PythFeedRow[] {
  if (catalogue && file === PYTH_FEEDS_FIXTURE) return catalogue;
  const j = JSON.parse(fs.readFileSync(file, "utf8")) as { feeds: PythFeedRow[] };
  if (!Array.isArray(j.feeds)) throw new Error(`${file}: no feeds`);
  if (file === PYTH_FEEDS_FIXTURE) catalogue = j.feeds;
  return j.feeds;
}

/** "Crypto.WIF/USD" → "WIF"; null for anything that is not a crypto feed quoted in USD (derby coins are crypto). */
export function cryptoBase(symbol: string): string | null {
  const m = /^Crypto\.([A-Z0-9]{1,12})\/USD$/.exec(symbol);
  return m ? m[1] : null;
}

export interface PythHit { symbol: string; base: string; id: string; assetType: string }
/** Pyth's asset classes a single-asset rule may read (Financial markets + crypto); rates have no keyless cross-read (shown, refused at preflight). */
export const PRICE_ASSET_TYPES = ["Crypto", "Equity", "FX", "Metal", "Commodities"] as const;
/** The display base of any feed symbol: "Crypto.WIF/USD" → "WIF", "Equity.US.AAPL/USD" → "AAPL", "FX.EUR/USD" → "EURUSD", "Metal.XAU/USD" → "XAU". */
export function feedBase(symbol: string): string | null {
  const c = cryptoBase(symbol);
  if (c) return c;
  const m = /^(?:Equity\.(?:[A-Z]{2}|Index)|Metal|Commodities(?:\.Index)?)\.([A-Z0-9]{1,12})\/USD$/.exec(symbol);
  if (m) return m[1];
  const fx = /^FX\.([A-Z]{3})\/([A-Z]{3})$/.exec(symbol);
  return fx ? `${fx[1]}${fx[2]}` : null;
}
/**
 * Feeds whose base matches the query (exact base first, then prefix, then contains). Crypto/USD only by default (a coin-vs-coin derby);
 * `assetTypes` widens it for single-asset rules. Pyth's US index feeds (Equity.Index.US500/US30/US100) are never offered unless
 * BURNTICKER_INDEX_PROXIES_ENABLED is on.
 */
export function searchPyth(q: string, limit = 20, rows: readonly PythFeedRow[] = loadPythCatalogue(), o: { assetTypes?: readonly string[]; env?: Readonly<Record<string, string | undefined>> } = {}): PythHit[] {
  const s = q.trim().toUpperCase().replace(/^\$/, "");
  if (!s) return [];
  const types = o.assetTypes ?? ["Crypto"];
  const proxies = indexProxiesEnabled(o.env);
  const hits: (PythHit & { rank: number })[] = [];
  for (const r of rows) {
    if (!types.includes(r.asset_type)) continue;
    if (!proxies && (INDEX_PROXY_SYMBOLS as readonly string[]).includes(r.symbol)) continue;
    const base = feedBase(r.symbol);
    if (!base) continue;
    const rank = base === s ? 0 : base.startsWith(s) ? 1 : base.includes(s) ? 2 : -1;
    // an index wrapper of the same name ("Equity.Index.AAPL") ranks after the listing itself ("Equity.US.AAPL")
    if (rank >= 0) hits.push({ symbol: r.symbol, base, id: r.id, assetType: r.asset_type, rank: rank + (r.symbol.includes(".Index.") ? 0.5 : 0) });
  }
  return hits.sort((a, b) => a.rank - b.rank || a.base.length - b.base.length || a.base.localeCompare(b.base)).slice(0, limit).map(({ rank: _r, ...h }) => h);
}

/** The feed for a crypto base symbol ("WIF" → Crypto.WIF/USD's id), or null. */
export const pythFeedFor = (base: string, rows: readonly PythFeedRow[] = loadPythCatalogue()): PythFeedRow | null => rows.find((r) => r.asset_type === "Crypto" && cryptoBase(r.symbol) === base.toUpperCase()) ?? null;

// ---------------------------------------------------------------------------------------------------------------------------------
// The keyless path: Pyth's price feed accounts on Solana
// ---------------------------------------------------------------------------------------------------------------------------------

/**
 * PYTH ON SOLANA, KEYLESS (measured 2026-10-10). Pyth's push oracle keeps a sponsored `PriceUpdateV2` account per major feed at the PDA
 * ["\0\0" (shard 0), feed id] of program pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT, owned by the receiver program
 * rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ, which VERIFIED the Wormhole-signed update before writing it — any Solana RPC reads it
 * without a key (WIF and SOL/USD exist; SHIB/USD does not, so an EVM-native coin needs Hermes). The account holds the LATEST value only,
 * so the keeper snapshots it at each boundary (derby_samples kind "pyth"), recording slot, the account bytes' sha256 and the decoded
 * message; a boundary uses the first snapshot whose publish_time is at or after the boundary (crypto) within the on-chain tolerance.
 *
 * Layout (Anchor, 133–134 bytes): discriminator 8 · write_authority 32 · verification_level (0 = Partial{num_signatures u8}, 1 = Full)
 * · feed_id 32 · price i64 · conf u64 · exponent i32 · publish_time i64 · prev_publish_time i64 · ema_price i64 · ema_conf u64 ·
 * posted_slot u64. Only Full verification is accepted.
 */
export const PYTH_PUSH_ORACLE = "pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT";
export const PYTH_RECEIVER = "rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ";
/** An on-chain snapshot is used for a boundary when published within this long after it (sponsored feeds update on a heartbeat). */
export const PYTH_ONCHAIN_TOLERANCE_SEC = 60 * 60;

export interface PythAccountMessage { feed: string; price: string; conf: string; expo: number; publishTime: number; postedSlot: string; verification: "full" | "partial" }

export function decodePriceUpdateV2(data: Buffer): PythAccountMessage {
  if (data.length < 133) throw new Error(`not a PriceUpdateV2 account (${data.length} bytes)`);
  const level = data[40];
  if (level !== 0 && level !== 1) throw new Error(`unknown verification level ${level}`);
  const o = level === 1 ? 41 : 42;
  if (data.length < o + 92) throw new Error("PriceUpdateV2 account is truncated");
  return {
    feed: data.subarray(o, o + 32).toString("hex"), price: data.readBigInt64LE(o + 32).toString(), conf: data.readBigUInt64LE(o + 40).toString(), expo: data.readInt32LE(o + 48),
    publishTime: Number(data.readBigInt64LE(o + 52)), postedSlot: data.readBigUInt64LE(o + 84).toString(), verification: level === 1 ? "full" : "partial",
  };
}

/** One snapshot from an on-chain account (the sampler's input). Throws on a foreign owner, a partial verification or the wrong feed. */
export function pythSnapshotFromAccount(feed: string, account: { owner: string; data: Buffer }, slot: number | null, address: string): { value: string; publishTime: number; detail: Record<string, unknown> } {
  if (account.owner !== PYTH_RECEIVER) throw new Error(`${address} is owned by ${account.owner}, not Pyth's receiver program`);
  const m = decodePriceUpdateV2(account.data);
  if (m.verification !== "full") throw new Error(`${address}: the update is only partially verified`);
  if (m.feed !== feed) throw new Error(`${address} carries feed ${m.feed.slice(0, 12)}…, not ${feed.slice(0, 12)}…`);
  if (BigInt(m.price) <= BigInt(0)) throw new Error(`${address}: value is not positive`);
  if (Number(m.conf) > Number(m.price) * DERBY_MAX_CONF_RATIO) throw new Error(`${address}: confidence ${m.conf} exceeds ${DERBY_MAX_CONF_RATIO * 100}% of ${m.price}`);
  return { value: pythValue(m.price, m.expo), publishTime: m.publishTime, detail: { source: "pyth-solana", account: address, slot, accountSha256: sha256Hex(account.data), price: m.price, conf: m.conf, expo: m.expo, publishTime: m.publishTime, postedSlot: m.postedSlot } };
}

/** The sponsored price-feed account for a feed id (shard 0). */
export const pythFeedAccount = (feed: string): string => PublicKey.findProgramAddressSync([Buffer.from([0, 0]), Buffer.from(feed, "hex")], new PublicKey(PYTH_PUSH_ORACLE))[0].toBase58();
