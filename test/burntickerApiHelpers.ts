// Shared pieces for the Burnticker public API + SDK tests (2026-10-09): a platform on the fakes (in-memory registry, FakeBurnProgram,
// FakeLaunchLab, Kalshi from frozen fixtures) with two live tokens and real receipts from one keeper cycle; an in-process router that
// sends a URL to the v1 route modules (so the SDK's fetch exercises the real handlers); a fake Solana connection; and a small JSON
// Schema validator for checking responses against the OpenAPI document. Not a test file itself.
import os from "node:os";
import path from "node:path";
import { PublicKey } from "@solana/web3.js";
import { openRegistry, type Registry, type TokenRow } from "@/lib/burnticker/registry";
import { FakeBurnProgram } from "@/lib/burnticker/program";
import { buildLaunchBundle, FakeLaunchLab } from "@/lib/burnticker/launchBundle";
import { KalshiClient, fixtureFetch, settledMarketsUrl, seriesApiUrl, openMarketsUrl, marketApiUrl, seriesListUrl, eventsUrl, KALSHI_API } from "@/lib/burnticker/oracle/kalshi";
import { CatalogueAdapter, feedById, loadFixture } from "@/lib/burnticker/catalogue";
import { runCycle } from "@/lib/burnticker/multiKeeper";
import { setPlatformForTests, type Platform } from "@/lib/burnticker/server";
import { limiter } from "@/lib/burnticker/api/http";
import { BURN_RECEIPTS_IDL } from "@/lib/burnReceipts/idl";
import { encodeType } from "@/lib/burnReceipts/idlCoder";
import type { IdlType } from "@/lib/burnReceipts/idlTypes";
import { base58Decode } from "../packages/burnticker-sdk/src/events.ts";
import type { Fetch } from "../packages/burnticker-sdk/src/http.ts";
import { BRONCOS, DEBT_RULE, NOW, fx } from "./burntickerHelpers.ts";
import { polyClient } from "./burntickerPolyHelpers.ts";

export const CREATOR = "CreatorWa11et111111111111111111111111111111";
export const ATTESTER = "KeeperDataKey1111111111111111111111111111111";
export const HOST = "bt.test";
export const API = `http://${HOST}/api/burnticker/v1`;

const nfl = fx("kalshi/KXNFLGAME.settled.json") as { markets: { ticker: string }[] };
export const KALSHI_TABLE: Record<string, unknown> = {
  [settledMarketsUrl("KXNFLGAME")]: nfl, [seriesApiUrl("KXNFLGAME")]: fx("kalshi/series.KXNFLGAME.json"), [openMarketsUrl("KXNFLGAME")]: { cursor: "", markets: [] },
  [settledMarketsUrl("KXHIGHDEN")]: fx("kalshi/KXHIGHDEN.settled.json"), [seriesApiUrl("KXHIGHDEN")]: fx("kalshi/series.KXHIGHDEN.json"), [openMarketsUrl("KXHIGHDEN")]: fx("kalshi/KXHIGHDEN.open.json"),
  [marketApiUrl("KXNFLGAME-26SEP27LARDEN-DEN")]: { market: nfl.markets.find((m) => m.ticker === "KXNFLGAME-26SEP27LARDEN-DEN") },
  [marketApiUrl("KXNFLGAME-26OCT04DENSF-DEN")]: { market: nfl.markets.find((m) => m.ticker === "KXNFLGAME-26OCT04DENSF-DEN") },
  [seriesListUrl("Sports")]: { series: [(fx("kalshi/series.KXNFLGAME.json") as { series: unknown }).series] },
  [seriesListUrl("Climate and Weather")]: { series: [(fx("kalshi/series.KXHIGHDEN.json") as { series: unknown }).series] },
  [eventsUrl("KXNFLGAME")]: fx("kalshi/KXNFLGAME.events.open.json"),
};
export const TREASURY_BODY = loadFixture(feedById("treasury.debt")!).body;
const kalshiFetch = fixtureFetch(KALSHI_TABLE);

/** Upstream sources for the SDK's own verification: Kalshi from fixtures, Treasury from its fixture. */
export const upstreamFetch: Fetch = async (url) => {
  if (url.startsWith(KALSHI_API)) return kalshiFetch(url) as ReturnType<Fetch>;
  if (url.startsWith("https://api.fiscaldata.treasury.gov/")) return { ok: true, status: 200, json: async () => TREASURY_BODY };
  return { ok: false, status: 404, json: async () => ({}) };
};

export interface World { p: Platform; program: FakeBurnProgram; registry: Registry; bronco: TokenRow; deficit: TokenRow }

/** A platform on the fakes with $BRONCO (Kalshi binary) and $DEFICIT2 (Treasury feed), each with receipts from one keeper cycle. */
export async function makeWorld(): Promise<World> {
  limiter.reset();
  const registry = openRegistry(":memory:");
  const program = new FakeBurnProgram("devnet");
  const kalshi = new KalshiClient({ fetchImpl: kalshiFetch, now: () => NOW, minIntervalMs: 0 });
  const catalogue = new CatalogueAdapter({ fetchImpl: async () => ({ ok: true, status: 200, json: async () => TREASURY_BODY }), now: () => NOW });
  const launch = async (rule: unknown, ticker: string, baselineAt: string) => {
    const b = await buildLaunchBundle({ creator: CREATOR, ticker, name: `${ticker} coin`, description: "a test", imageUrl: null, links: [], rule, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true }, cluster: "devnet" }, { program, launchLab: new FakeLaunchLab(), devFeeWallet: null, attesters: [ATTESTER], quorum: 1, metadataUri: (m) => `https://x/${m}.json` });
    const t = registry.register({ mint: b.mint, ticker, name: b.name, creator: CREATOR, description: b.description, imageUrl: null, links: [], rulesText: b.rules.text, feePda: b.addresses.feePda, vault: b.addresses.vault, tokenConfig: b.addresses.tokenConfig, poolId: b.addresses.poolId, launchTx: null, cluster: "devnet", platformId: b.addresses.platformId, baselineAt, status: "draft" }, NOW);
    registry.markLaunched(t.mint, `launch${ticker}`, b.addresses.poolId, baselineAt);
    registry.addAttester({ mint: t.mint, pubkey: ATTESTER, role: "data-key", addedAt: NOW, timelockUntil: null });
    program.supplies.set(t.mint, BigInt("1000000000000000"));
    return registry.token(t.mint)!;
  };
  const bronco = await launch(BRONCOS, "BRONCO", "2026-09-01T00:00:00Z");
  const deficit = await launch(DEBT_RULE, "DEFICIT2", "2026-09-30");
  program.deposit(bronco.mint, BigInt(5_000_000_000));
  program.deposit(deficit.mint, BigInt(3_000_000_000));
  await runCycle({ registry, program, oracles: { kalshi, catalogue }, attester: ATTESTER, log: () => {}, now: () => NOW, dryRun: false });
  const polymarket = polyClient();
  const p: Platform = {
    registry, oracles: { kalshi, catalogue, polymarket }, kalshi, polymarket, program, launchLab: new FakeLaunchLab(), cluster: "devnet", publishDir: path.join(os.tmpdir(), `bt-api-${process.pid}`),
    devFeeWallet: null, keeperPubkey: ATTESTER, platformId: null, stubs: ["burn_receipts program: not deployed (FakeBurnProgram — test)"],
  };
  setPlatformForTests(p);
  return { p, program, registry, bronco: registry.token(bronco.mint)!, deficit: registry.token(deficit.mint)! };
}

// ---- the in-process router: URL → the v1 route module ----

const ROUTES: [RegExp, string, string[]][] = [
  [/^\/catalogue$/, "catalogue", []],
  [/^\/sources\/([^/]+)\/preview$/, "sources/[id]/preview", ["id"]],
  [/^\/kalshi\/search$/, "kalshi/search", []],
  [/^\/kalshi\/events$/, "kalshi/events", []],
  [/^\/kalshi\/teams$/, "kalshi/teams", []],
  [/^\/kalshi\/categories$/, "kalshi/categories", []],
  [/^\/browse$/, "browse", []],
  [/^\/kalshi\/backtest$/, "kalshi/backtest", []],
  [/^\/polymarket\/search$/, "polymarket/search", []],
  [/^\/polymarket\/backtest$/, "polymarket/backtest", []],
  [/^\/rules\/validate$/, "rules/validate", []],
  [/^\/launch\/bundle$/, "launch/bundle", []],
  [/^\/launch\/confirm$/, "launch/confirm", []],
  [/^\/tokens$/, "tokens", []],
  [/^\/tokens\/([^/]+)$/, "tokens/[ticker]", ["ticker"]],
  [/^\/tokens\/([^/]+)\/receipts$/, "tokens/[ticker]/receipts", ["ticker"]],
  [/^\/tokens\/([^/]+)\/verify\/([^/]+)$/, "tokens/[ticker]/verify/[id]", ["ticker", "id"]],
  [/^\/trust$/, "trust", []],
  [/^\/openapi\.json$/, "openapi.json", []],
];
export const ROUTE_MODULES = ROUTES.map((r) => r[1]);

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

/** Calls the v1 route for a URL under API, as Next would (params decoded the way Next passes them: still URL-encoded segments). */
export async function callRoute(url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<Response> {
  const u = new URL(url);
  const rest = u.pathname.replace(/^\/api\/burnticker\/v1/, "");
  for (const [re, mod, names] of ROUTES) {
    const m = re.exec(rest);
    if (!m) continue;
    const route = await import(`../src/app/api/burnticker/v1/${mod}/route.ts`) as Record<string, Handler>;
    const method = (init.method ?? "GET").toUpperCase();
    const h = route[method];
    if (!h) return new Response(JSON.stringify({ error: "method not allowed" }), { status: 405 });
    const params = Object.fromEntries(names.map((n, i) => [n, m[i + 1]]));
    return h(new Request(url, { method, headers: { host: HOST, ...(init.headers ?? {}) }, body: init.body }), { params: Promise.resolve(params) });
  }
  return new Response(JSON.stringify({ error: "no route" }), { status: 404 });
}

/** A fetch for the SDK: API URLs go to the route modules, everything else to the upstream fixtures. */
export const routeFetch: Fetch = async (url, init) => {
  if (!url.startsWith(API)) return upstreamFetch(url, init);
  const res = await callRoute(url, { method: init?.method, headers: init?.headers, body: init?.body });
  return { ok: res.ok, status: res.status, headers: res.headers, json: () => res.json() };
};

/** Same-origin POST headers a bot sends. */
export const POST_HEADERS = { "content-type": "application/json", origin: `http://${HOST}` };

// ---- a tiny JSON Schema validator (the subset spec.ts uses) ----

type S = Record<string, unknown>;
export function validateSchema(schema: S, value: unknown, root: S, at = "$"): string[] {
  if (typeof schema.$ref === "string") {
    const target = (schema.$ref as string).replace(/^#\//, "").split("/").reduce<unknown>((o, k) => (o as S)?.[k], root) as S | undefined;
    if (!target) return [`${at}: unresolved $ref ${schema.$ref}`];
    return validateSchema(target, value, root, at);
  }
  const errs: string[] = [];
  if (Array.isArray(schema.anyOf) && !(schema.anyOf as S[]).some((s) => validateSchema(s, value, root, at).length === 0)) errs.push(`${at}: matches none of anyOf`);
  if ("const" in schema && value !== schema.const) errs.push(`${at}: expected const ${JSON.stringify(schema.const)}, got ${JSON.stringify(value)}`);
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) errs.push(`${at}: ${JSON.stringify(value)} not in enum`);
  const ok = (t: string) => (t === "integer" ? Number.isInteger(value) : t === "number" ? typeof value === "number" : t === "null" ? value === null : t === "array" ? Array.isArray(value) : t === "object" ? !!value && typeof value === "object" && !Array.isArray(value) : typeof value === t);
  if (schema.type !== undefined) { const types = Array.isArray(schema.type) ? schema.type as string[] : [schema.type as string]; if (!types.some(ok)) { errs.push(`${at}: expected ${types.join("|")}, got ${value === null ? "null" : Array.isArray(value) ? "array" : typeof value}`); return errs; } }
  if (typeof value === "string" && typeof schema.pattern === "string" && !new RegExp(schema.pattern).test(value)) errs.push(`${at}: "${value}" does not match ${schema.pattern}`);
  if (typeof value === "number") { if (typeof schema.minimum === "number" && value < schema.minimum) errs.push(`${at}: < minimum`); if (typeof schema.maximum === "number" && value > schema.maximum) errs.push(`${at}: > maximum`); }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const o = value as S;
    for (const r of (schema.required as string[] | undefined) ?? []) if (!(r in o)) errs.push(`${at}: missing required ${r}`);
    for (const [k, s] of Object.entries((schema.properties as Record<string, S> | undefined) ?? {})) if (k in o && o[k] !== undefined) errs.push(...validateSchema(s, o[k], root, `${at}.${k}`));
  }
  if (Array.isArray(value) && schema.items) value.forEach((v, i) => errs.push(...validateSchema(schema.items as S, v, root, `${at}[${i}]`)));
  return errs;
}

// ---- a fake Solana connection (accounts, program accounts, signatures, transactions) ----

export const BLOCKHASH = "GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi";
export const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";

export class FakeConnection {
  genesis = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";   // devnet
  accounts = new Map<string, { owner: PublicKey; data: Buffer; lamports: number }>();
  /** Newest first, per address. */
  signatures = new Map<string, { signature: string; slot: number; err: unknown; blockTime: number | null }[]>();
  txs = new Map<string, unknown>();
  calls: string[] = [];
  async getGenesisHash() { this.calls.push("getGenesisHash"); return this.genesis; }
  async getLatestBlockhash() { return { blockhash: BLOCKHASH, lastValidBlockHeight: 1000 }; }
  async getAccountInfo(pk: PublicKey) { const a = this.accounts.get(pk.toBase58()); return a ? { owner: a.owner, data: a.data, lamports: a.lamports, executable: false } : null; }
  async getProgramAccounts(programId: PublicKey, cfg: { filters?: { memcmp: { offset: number; bytes: string } }[] }) {
    const out: { pubkey: PublicKey; account: { owner: PublicKey; data: Buffer } }[] = [];
    for (const [k, a] of this.accounts) {
      if (!a.owner.equals(programId)) continue;
      const pass = (cfg.filters ?? []).every((f) => { const b = Buffer.from(base58Decode(f.memcmp.bytes)); return a.data.subarray(f.memcmp.offset, f.memcmp.offset + b.length).equals(b); });
      if (pass) out.push({ pubkey: new PublicKey(k), account: { owner: a.owner, data: a.data } });
    }
    return out;
  }
  async getSignaturesForAddress(addr: PublicKey, o: { limit?: number; until?: string } = {}) {
    const all = this.signatures.get(addr.toBase58()) ?? [];
    const out = [];
    for (const s of all) { if (o.until && s.signature === o.until) break; out.push(s); }
    return out.slice(0, o.limit ?? 1000);
  }
  async getTransaction(sig: string) { return this.txs.get(sig) ?? null; }
  onLogs() { return 7; }
  async removeOnLogsListener() {}
}

/** Zero value of any IDL type (for building program accounts and events in tests). */
export function zeroOf(t: IdlType): unknown {
  if (typeof t === "string") return ["u64", "i64", "u128", "i128"].includes(t) ? BigInt(0) : t === "bool" ? false : t === "pubkey" ? PublicKey.default : t === "string" ? "" : t === "bytes" ? new Uint8Array(0) : 0;
  if ("vec" in t) return [];
  if ("option" in t) return null;
  if ("array" in t) return t.array[0] === "u8" ? new Uint8Array(t.array[1]) : Array.from({ length: t.array[1] }, () => zeroOf(t.array[0]));
  const d = BURN_RECEIPTS_IDL.types.find((x) => x.name === t.defined.name)!;
  if (d.type.kind !== "struct") throw new Error("enum");
  return Object.fromEntries(d.type.fields.map((f) => [f.name, zeroOf(f.type)]));
}

/** An encoded program account: the IDL discriminator + borsh of `value` (zero-filled, then overridden). */
export function encodeAccount(name: string, overrides: (v: Record<string, unknown>) => void): Buffer {
  const v = zeroOf({ defined: { name } }) as Record<string, unknown>;
  overrides(v);
  const disc = Buffer.from(BURN_RECEIPTS_IDL.accounts.find((a) => a.name === name)!.discriminator);
  return Buffer.concat([disc, encodeType(BURN_RECEIPTS_IDL, { defined: { name } }, v)]);
}
