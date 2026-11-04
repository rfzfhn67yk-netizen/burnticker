// Shared pieces for the Burn Derby tests (2026-10-10): the fixture-backed Hermes, cross-read fetch and Solana port; the coins; a derby
// world (in-memory registry, FakeBurnProgram, a derby pair through buildPairBundles); helpers to seed boundary snapshots. Not a test file.
import fs from "node:fs";
import path from "node:path";
import { PublicKey } from "@solana/web3.js";
import { openRegistry, type Registry, type TokenRow } from "@/lib/burnticker/registry";
import { FakeBurnProgram } from "@/lib/burnticker/program";
import { buildPairBundles, buildLaunchBundle, FakeLaunchLab } from "@/lib/burnticker/launchBundle";
import { lockRule, isOneShot, withFullFraction, type BurnRule } from "@/lib/burnticker/rules";
import { rulesSha256 } from "@/lib/burnKeeper/rules";
import { derbySeriesId, type CoinVsSpec, type DerbySpec, type DerbyUnderlying } from "@/lib/burnticker/derby/spec";
import { hermesBoundaryUrl, HERMES_URL, pointFromHermes, type PythRead } from "@/lib/burnticker/derby/pyth";
import { DerbyAdapter, type HermesLike } from "@/lib/burnticker/derby/adapter";
import type { PoolPort } from "@/lib/burnticker/derby/pools";
import type { FetchLike, OracleAdapter } from "@/lib/burnticker/oracle/types";
import type { KeeperDeps } from "@/lib/burnticker/multiKeeper";

export const FIX = path.resolve(import.meta.dirname, "../config/burnticker/fixtures");
export const fjson = (f: string): any => JSON.parse(fs.readFileSync(path.join(FIX, f), "utf8")); // eslint-disable-line @typescript-eslint/no-explicit-any

export const WIF_FEED = "4ca4beeca86f0d164160323817a4e42b10010a724c2217c6ee41b54cd4cc61fc";
export const SHIB_FEED = "f0d57deca57b3da2fe63a493f4c25925fdfd8edf834b20f93e1f84dbd1504d4a";
export const SOL_FEED = "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";
export const BONK_FEED = "72b021217ca3fe68922a19aaf990109cb9d84e9ad004b4d2025ad6f529314419";
export const WIF_MINT = "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm";
export const BONK_MINT = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
export const GIGA_MINT = "63LfDmNb3MQ8mw9MtZ2To9bEA2M71kZUUGq5tiJxcqj9";
export const GIGA_POOL = new PublicKey(Buffer.alloc(32, 7)).toBase58();
export const CREATOR = "CreatorWa11et111111111111111111111111111111";
export const ATTESTER = "KeeperDataKey1111111111111111111111111111111";

export const WIF: DerbyUnderlying = { symbol: "WIF", pyth: WIF_FEED, mint: WIF_MINT, pool: null, cross: `jup:${WIF_MINT}` };
export const SHIB: DerbyUnderlying = { symbol: "SHIB", pyth: SHIB_FEED, mint: null, pool: null, cross: "redstone:SHIB" };
export const BONK: DerbyUnderlying = { symbol: "BONK", pyth: BONK_FEED, mint: BONK_MINT, pool: null, cross: `jup:${BONK_MINT}` };
export const GIGA: DerbyUnderlying = { symbol: "GIGA", pyth: null, mint: GIGA_MINT, pool: GIGA_POOL, cross: `jup:${GIGA_MINT}` };

export const DAY = 86_400_000;
export const B = (d: number) => Date.UTC(2026, 9, d);   // 00:00 UTC on 2026-10-<d>

/** Hermes from the synthetic fixture (keyless Hermes answered 401 on 2026-10-10 — see the fixture's note). */
const HERMES_FX = fjson("derby/hermes.synthetic.json").updates as Record<string, unknown>;
export const fixtureHermes: HermesLike & { latest(feed: string): Promise<PythRead> } = {
  baseUrl: HERMES_URL,
  atBoundary: async (feed, ts) => { const b = HERMES_FX[`${feed}@${ts}`]; return b ? pointFromHermes(b, feed, ts, hermesBoundaryUrl(HERMES_URL, feed, ts)) : { ok: false, reason: `no fixture update for ${feed.slice(0, 8)} at ${ts}` }; },
  latest: async (feed) => { const key = Object.keys(HERMES_FX).filter((k) => k.startsWith(`${feed}@`)).sort().slice(-2)[0]; const ts = Number(key.split("@")[1]); return pointFromHermes(HERMES_FX[key], feed, ts, hermesBoundaryUrl(HERMES_URL, feed, ts), Number.MAX_SAFE_INTEGER); },
};

/** The cross-read fetch from fixtures (Jupiter price v3 / search, DexScreener, RedStone) plus per-test overrides. */
export function fixtureFetch(extra: Record<string, unknown> = {}): FetchLike {
  const table: Record<string, unknown> = {
    "https://lite-api.jup.ag/price/v3": fjson("derby/jupiter.price.v3.json").body,
    "https://oracle-gateway-1.a.redstone.finance/data-packages/latest/redstone-primary-prod": fjson("derby/redstone.latest.json").body,
    "https://api.dexscreener.com/latest/dex/tokens/0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE": fjson("derby/dexscreener.shib.json").body,
    "https://lite-api.jup.ag/tokens/v2/search?query=wif": fjson("derby/jupiter.search.wif.json").body,
    ...extra,
  };
  return async (url) => {
    const hit = table[url] ?? table[url.split("?")[0]];
    return hit === undefined ? { ok: false, status: 404, json: async () => ({}) } : { ok: true, status: 200, json: async () => hit };
  };
}

/** A read-only account port over a table of base64 accounts (the Pyth fixture's real WIF/SOL/BONK accounts and any synthetic ones). */
export function fixturePort(extra: Record<string, { owner: string; data: Buffer }> = {}): PoolPort {
  const acc = fjson("derby/pyth.solana.accounts.json").accounts as Record<string, { address: string; owner: string | null; dataBase64: string | null }>;
  const table: Record<string, { owner: string; data: Buffer }> = { ...extra };
  for (const a of Object.values(acc)) if (a.owner && a.dataBase64) table[a.address] = { owner: a.owner, data: Buffer.from(a.dataBase64, "base64") };
  return { accounts: async (xs) => xs.map((x) => table[x] ?? null), slot: async () => 455_416_059 };
}

const stubOracle: OracleAdapter = { id: "stub", searchSeries: async () => [], seriesInfo: async () => null, settledSince: async () => ({ events: [], awaitingFinal: 0, refusals: [], settlementSourceUrl: null }), impliedChance: async () => ({ chance: null, marketTicker: null, closeTime: null, basis: "stub" }) };

/** A coin-vs-coin derby rule for side A (YES = A wins → A burns). */
export function coinvsRule(spec: CoinVsSpec, fraction = 0.01): BurnRule {
  return lockRule({ schema: "burnticker.rules/v1", oracle: "derby", series: derbySeriesId(spec, rulesSha256), market: null, filter: {}, kind: "binary", binary: { onYes: { fractionOfPool: fraction }, onNo: null }, scalar: null, pair: null, onVoid: "skip", floorUsd: "1", reserveSol: "0.02", vault: null, derby: spec }).rule;
}

export interface DerbyWorld { registry: Registry; program: FakeBurnProgram; adapter: DerbyAdapter; deps: KeeperDeps; clock: { now: number }; a: TokenRow; b: TokenRow; pairId: string; logs: string[] }

/** A derby pair launched and live (baseline before the season), with the keeper's deps wired to the derby adapter. */
export async function derbyWorld(spec: DerbySpec, o: { tickers?: [string, string]; voidBy?: string; autoRegisterPool?: boolean; now?: number; pools?: PoolPort | null; fetchImpl?: FetchLike; rule?: BurnRule; hermes?: HermesLike | null; /** §45: the fake pins each rule's EndSink (a round-4 program). */ endSinks?: boolean } = {}): Promise<DerbyWorld> {
  const registry = openRegistry(":memory:");
  const program = new FakeBurnProgram("devnet");
  program.autoRegisterPool = o.autoRegisterPool ?? true;
  program.pinEndSinks = o.endSinks ?? false;
  const clock = { now: o.now ?? B(12) + 3 * 3600_000 };
  program.now = () => clock.now;
  const logs: string[] = [];
  const [ta, tb] = o.tickers ?? ["TEAMWIF", "TEAMSHIB"];
  // audit 12 item 1: a linked one-shot pair (the flippening) is built at 100 % only; the builder refuses any other share
  const rule0 = o.rule ?? coinvsRule(spec as CoinVsSpec), rule = isOneShot(rule0) ? withFullFraction(rule0) : rule0;
  const pr = await buildPairBundles({ a: { creator: CREATOR, ticker: ta, name: ta, description: "a derby side", imageUrl: null, links: [{ label: "X", url: "https://x.com/dogwifcoin" }], rule, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true }, cluster: "devnet" }, b: { ticker: tb, name: tb, description: "the other side", imageUrl: null, links: [] }, voidBy: o.voidBy ?? "2026-11-30" },
    { program, launchLab: new FakeLaunchLab(), devFeeWallet: null, attesters: [ATTESTER], quorum: 1, metadataUri: (m) => `https://x/${m}.json` });
  const reg = (bundle: typeof pr.a, ticker: string, links: { label: string; url: string }[]) => {
    const t = registry.register({ mint: bundle.mint, ticker, name: ticker, creator: CREATOR, description: bundle.description, imageUrl: null, links, rulesText: bundle.rules.text, feePda: bundle.addresses.feePda, vault: bundle.addresses.vault, tokenConfig: bundle.addresses.tokenConfig, poolId: bundle.addresses.poolId, launchTx: null, cluster: "devnet", platformId: null, baselineAt: "2026-10-04T12:00:00Z", status: "draft" }, B(4));
    registry.markLaunched(t.mint, `launch${ticker}`, bundle.addresses.poolId, "2026-10-04T12:00:00Z");
    registry.addAttester({ mint: t.mint, pubkey: ATTESTER, role: "data-key", addedAt: B(4), timelockUntil: null });
    program.supplies.set(t.mint, BigInt("1000000000000000"));
    if (program.tokens.has(t.mint)) program.deposit(t.mint, BigInt(5_000_000_000));
    return registry.token(t.mint)!;
  };
  const a = reg(pr.a, ta, [{ label: "X", url: "https://x.com/dogwifcoin" }]), b = reg(pr.b, tb, [{ label: "X", url: "https://x.com/shibtoken" }]);
  registry.registerPair(pr.pairId, a.mint, b.mint, B(4));
  const adapter = new DerbyAdapter({ registry, hermes: o.hermes === undefined ? fixtureHermes : o.hermes, pools: o.pools ?? null, fetchImpl: o.fetchImpl ?? fixtureFetch(), now: () => clock.now, log: (l) => logs.push(l), alert: (k, t) => logs.push(`ALERT ${k}: ${t}`) });
  const deps: KeeperDeps = { registry, program, oracles: { kalshi: stubOracle, catalogue: stubOracle, derby: adapter }, derby: { sample: (t) => adapter.sample(t), plan: () => adapter.plan(), ended: (t) => adapter.ended(t) }, attester: ATTESTER, log: (l) => logs.push(l), now: () => clock.now, dryRun: false };
  return { registry, program, adapter, deps, clock, a, b, pairId: pr.pairId, logs };
}

/** Seeds one cross-read snapshot a minute after a boundary. */
export function seedCross(w: { adapter: DerbyAdapter }, u: DerbyUnderlying, boundaryMs: number, usd: string, source = "fixture"): void {
  w.adapter.store.putSample({ key: `cross:${u.cross}`, kind: "cross", ts: boundaryMs + 60_000, slot: null, value: usd, detail: { source } });
}

/** A single launched coin (no pair), e.g. a bracket fan coin. */
export async function launchSingle(registry: Registry, program: FakeBurnProgram, rule: BurnRule, ticker: string, baselineAt = "2026-10-04T12:00:00Z"): Promise<TokenRow> {
  const b = await buildLaunchBundle({ creator: CREATOR, ticker, name: ticker, description: "a fan coin", imageUrl: null, links: [], rule, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true }, cluster: "devnet" }, { program, launchLab: new FakeLaunchLab(), devFeeWallet: null, attesters: [ATTESTER], quorum: 1, metadataUri: (m) => `https://x/${m}.json` });
  const t = registry.register({ mint: b.mint, ticker, name: ticker, creator: CREATOR, description: b.description, imageUrl: null, links: [], rulesText: b.rules.text, feePda: b.addresses.feePda, vault: b.addresses.vault, tokenConfig: b.addresses.tokenConfig, poolId: b.addresses.poolId, launchTx: null, cluster: "devnet", platformId: null, baselineAt, status: "draft" }, B(4));
  registry.markLaunched(t.mint, `launch${ticker}`, b.addresses.poolId, baselineAt);
  registry.addAttester({ mint: t.mint, pubkey: ATTESTER, role: "data-key", addedAt: B(4), timelockUntil: null });
  program.supplies.set(t.mint, BigInt("1000000000000000"));
  if (program.tokens.has(t.mint)) program.deposit(t.mint, BigInt(5_000_000_000));
  return registry.token(t.mint)!;
}

/** Synthetic Raydium CPMM pool + vault + mint accounts (the program's own offsets; src/lib/burnReceipts/cpmm.ts). */
export function cpmmAccounts(o: { pool: string; mint: string; tokenRaw: bigint; solRaw: bigint; decimals: number; supplyRaw?: bigint }): Record<string, { owner: string; data: Buffer }> {
  const POOL_DISC = Buffer.from([247, 237, 227, 245, 215, 195, 222, 70]);
  const d = Buffer.alloc(637);
  POOL_DISC.copy(d, 0);
  const v0 = new PublicKey(Buffer.alloc(32, 21)), v1 = new PublicKey(Buffer.alloc(32, 22));
  new PublicKey("So11111111111111111111111111111111111111112").toBuffer().copy(d, 168);
  new PublicKey(o.mint).toBuffer().copy(d, 200);
  v0.toBuffer().copy(d, 72); v1.toBuffer().copy(d, 104);
  d[331] = 9; d[332] = o.decimals;
  const tokAcct = (amount: bigint) => { const b = Buffer.alloc(165); b.writeBigUInt64LE(amount, 64); return b; };
  const mint = Buffer.alloc(82); mint.writeBigUInt64LE(o.supplyRaw ?? BigInt(9_600_000_000) * BigInt(10) ** BigInt(o.decimals), 36); mint[44] = o.decimals;
  const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
  return { [o.pool]: { owner: "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C", data: d }, [v0.toBase58()]: { owner: TOKEN, data: tokAcct(o.solRaw) }, [v1.toBase58()]: { owner: TOKEN, data: tokAcct(o.tokenRaw) }, [o.mint]: { owner: TOKEN, data: mint } };
}
