import { PublicKey } from "@solana/web3.js";
import { rawToTokens } from "@/lib/burnKeeper/rules";
import { launchLabPoolId, launchLabProgramFor, launchLabVault } from "@/lib/burnKeeper/launchlab";
import type { ChartJson, CurveJson, CurvePhase, HolderRow, MarketJson, TradeLinks } from "@/lib/burnticker/pageTypes";

export type { ChartJson, CurveJson, CurvePhase, HolderRow, MarketJson, TradeLinks } from "@/lib/burnticker/pageTypes";

/**
 * MARKET DATA FOR THE COIN CARD AND THE COIN PAGE (2026-10-10, the owner: "present like the launchpads new users already know"). What a
 * launchpad card shows — bonding-curve progress, "graduated", holders, a chart, where to trade — read as DATA from public chain state,
 * never as a claim about price:
 *
 *   · the LaunchLab PoolState account (one getAccountInfo): status (0 curve · 1 migrating · 2 graduated), real_b (quote raised on the
 *     curve) and total_fund_raising_b (the raise that completes the curve). Offsets are the SDK's own layout (raydium-sdk-V2 0.2.74-alpha
 *     src/raydium/launchpad/layout.ts LaunchpadPool), pinned in test/burntickerMarket.test.ts against the SDK's encoder AND three real
 *     mainnet accounts (config/burnticker/fixtures/launchlab/pools.mainnet.json). The status meaning (0 Fund, 1 Migrate, 2 Trade) is
 *     Raydium's program enum; the fixtures show status 2 exactly where real_b reached the raise.
 *   · the top token accounts (getTokenLargestAccounts + one getMultipleParsedAccounts for their owners): the holder distribution, with the
 *     bonding-curve vault, the burn pool and the creator labelled. A holder COUNT needs an indexer (every token account of the mint);
 *     it is not read, and the page shows "—" with that reason, never an estimate.
 *   · links out: the chart is GeckoTerminal's embed (it indexes both raydium-launchlab curve pools and the CPMM pools they migrate to —
 *     checked against its public dex list on 10-10) and the trade buttons deep-link to Raydium and Jupiter for the mint. Burnticker hosts
 *     no swap. Devnet coins get no links (those pages serve mainnet only) and say so.
 *
 * Pure apart from `readMarket`, which takes a minimal connection-shaped reader so tests can pass a fake. Nothing here signs or sends.
 */

export const LAUNCHLAB_POOL_STATUS: Record<number, CurvePhase> = { 0: "curve", 1: "migrating", 2: "graduated" };
/** Quote mints a LaunchLab pool may raise in, by symbol (Burnticker coins raise SOL; the decoder reads any pool). */
export const QUOTE_SYMBOLS: Record<string, string> = {
  So11111111111111111111111111111111111111112: "SOL",
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: "USDC",
};

/** The fields of a LaunchLab PoolState the card needs (amounts raw, as on chain). */
export interface LaunchLabPoolView {
  status: number; decimalsA: number; decimalsB: number; migrateType: number;
  supplyRaw: bigint; totalSellRaw: bigint; virtualARaw: bigint; virtualBRaw: bigint; realARaw: bigint; realBRaw: bigint; totalFundRaisingRaw: bigint;
  configId: string; platformId: string; mintA: string; mintB: string; vaultA: string; vaultB: string; creator: string;
}

/** PoolState is 429 bytes: 8-byte discriminator, then the SDK's LaunchpadPool struct. Byte offsets below. */
export const LAUNCHLAB_POOL_SIZE = 429;
const OFF = { status: 17, decimalsA: 18, decimalsB: 19, migrateType: 20, supply: 21, totalSellA: 29, virtualA: 37, virtualB: 45, realA: 53, realB: 61, totalFundRaisingB: 69, configId: 141, platformId: 173, mintA: 205, mintB: 237, vaultA: 269, vaultB: 301, creator: 333 } as const;

const u64 = (b: Uint8Array, o: number): bigint => { let v = BigInt(0); for (let i = 7; i >= 0; i--) v = (v << BigInt(8)) | BigInt(b[o + i]); return v; };
const key = (b: Uint8Array, o: number): string => new PublicKey(b.subarray(o, o + 32)).toBase58();

/** Decodes a LaunchLab PoolState account; null when the bytes cannot be one (wrong size). */
export function decodeLaunchLabPool(data: Uint8Array): LaunchLabPoolView | null {
  if (data.length !== LAUNCHLAB_POOL_SIZE) return null;
  return {
    status: data[OFF.status], decimalsA: data[OFF.decimalsA], decimalsB: data[OFF.decimalsB], migrateType: data[OFF.migrateType],
    supplyRaw: u64(data, OFF.supply), totalSellRaw: u64(data, OFF.totalSellA), virtualARaw: u64(data, OFF.virtualA), virtualBRaw: u64(data, OFF.virtualB), realARaw: u64(data, OFF.realA), realBRaw: u64(data, OFF.realB), totalFundRaisingRaw: u64(data, OFF.totalFundRaisingB),
    configId: key(data, OFF.configId), platformId: key(data, OFF.platformId), mintA: key(data, OFF.mintA), mintB: key(data, OFF.mintB), vaultA: key(data, OFF.vaultA), vaultB: key(data, OFF.vaultB), creator: key(data, OFF.creator),
  };
}

const trimDec = (s: string) => (s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s);
/** Rounds a decimal string to `dp` places (half up), for display. */
export function roundDec(s: string, dp: number): string {
  const neg = s.startsWith("-"); const [w, f = ""] = (neg ? s.slice(1) : s).split(".");
  if (f.length <= dp) return trimDec(s);
  const scaled = BigInt(w + f.slice(0, dp)) + (Number(f[dp]) >= 5 ? BigInt(1) : BigInt(0));
  const str = scaled.toString().padStart(dp + 1, "0");
  const out = dp ? `${str.slice(0, -dp)}.${str.slice(-dp)}` : str;
  return (neg ? "-" : "") + trimDec(out);
}

export function curveProgress(v: LaunchLabPoolView, poolId: string): CurveJson {
  const phase = LAUNCHLAB_POOL_STATUS[v.status] ?? "curve";
  const raisedRaw = phase === "graduated" && v.realBRaw < v.totalFundRaisingRaw ? v.totalFundRaisingRaw : v.realBRaw;
  const rem = v.totalFundRaisingRaw > raisedRaw ? v.totalFundRaisingRaw - raisedRaw : BigInt(0);
  const pct = v.totalFundRaisingRaw === BigInt(0) ? 0 : Math.min(100, Number((raisedRaw * BigInt(10_000)) / v.totalFundRaisingRaw) / 100);
  return { phase, status: v.status, raised: rawToTokens(raisedRaw, v.decimalsB), threshold: rawToTokens(v.totalFundRaisingRaw, v.decimalsB), remaining: rawToTokens(rem, v.decimalsB), quote: QUOTE_SYMBOLS[v.mintB] ?? "quote", progressPct: phase === "graduated" ? 100 : pct, poolId, marketCap: curveMarketCap(v) };
}

/**
 * THE CURVE'S MARKET CAP (website-13, 2026-10-12; owner decision on Claude site audit 2 item 7: "people like to see the market cap"). A
 * number read from the pool, never a claim: the constant-product curve's current quote per token, (virtualB + realB) / (virtualA − realA)
 * (the Raydium SDK's ConstantProductCurve.getPoolPrice), times the pool's total supply. Raw units cancel, so it is exact integer
 * arithmetic in the quote's smallest unit. Only the constant-product curve (curve type 0) is read this way; Burnticker's launch builder
 * refuses every other curve type (src/lib/burnKeeper/launch.ts). Null once the coin has left the curve (the trading pool is read
 * separately) or when the reserves cannot give a value.
 */
export function curveMarketCap(v: LaunchLabPoolView): string | null {
  if ((LAUNCHLAB_POOL_STATUS[v.status] ?? "curve") === "graduated") return null;
  const a = v.virtualARaw - v.realARaw, b = v.virtualBRaw + v.realBRaw;
  if (a <= BigInt(0) || b <= BigInt(0) || v.supplyRaw <= BigInt(0)) return null;
  return rawToTokens((b * v.supplyRaw) / a, v.decimalsB);
}

/** What a reader brought back for one coin (all optional: a host without an RPC reads nothing). */
export interface MarketInput { pool: LaunchLabPoolView | null; top: HolderRow[] | null; readAt: number | null; error: string | null; /** the pool read's own failure (the curve note names only this) */ poolError?: string | null }

/** An RPC failure in a few words for a page ("rate-limited by the RPC", "fetch failed"), never a raw JSON body. */
export function rpcErrorText(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/\b429\b|too many requests/i.test(m)) return "rate-limited by the RPC";
  return m.split("{")[0].replace(/[:\s]+$/, "").slice(0, 80) || "RPC error";
}

export const HOLDER_COUNT_NOTE = "Counting holders needs an indexer that lists every token account of the coin. This site does not run one.";
const isMainnet = (c: string) => c === "mainnet";

/** Deep links for a mint. Mainnet only: Raydium's and Jupiter's swap pages do not serve devnet. */
export function tradeLinks(cluster: string, mint: string, phase: CurvePhase | null, status: string): TradeLinks {
  if (status === "draft" || status === "expired") return { links: [], note: "This coin is not launched. There is nothing to trade until the launch transaction lands." };
  if (!isMainnet(cluster)) return { links: [], note: `This is a ${cluster} coin. Raydium's and Jupiter's swap pages only serve mainnet.` };
  const m = encodeURIComponent(mint);
  const jupiter = { id: "jupiter" as const, label: "Open in Jupiter", url: `https://jup.ag/swap/SOL-${m}` };
  if (phase === "graduated") return { links: [{ id: "raydium", label: "Trade on Raydium", url: `https://raydium.io/swap/?inputMint=sol&outputMint=${m}` }, jupiter], note: null };
  return { links: [{ id: "launchlab", label: "Trade on Raydium", url: `https://raydium.io/launchpad/token/?mint=${m}` }, jupiter], note: null };
}

/** GeckoTerminal's chart embed for the pool that trades now: the CPMM pool after graduation, the LaunchLab curve pool before (only a pool read on chain this cycle — never an unverified id). */
export function chartFor(cluster: string, curvePool: string | null, graduatedPool: string | null, phase: CurvePhase | null): ChartJson {
  const pool = phase === "graduated" && graduatedPool ? graduatedPool : curvePool;
  if (!isMainnet(cluster)) return { provider: null, embedUrl: null, pageUrl: null, note: `No public chart covers ${cluster}, so the burn chart below is drawn from the receipts.` };
  if (!pool) return { provider: null, embedUrl: null, pageUrl: null, note: "No pool was read this cycle." };
  const p = encodeURIComponent(pool);
  return { provider: "geckoterminal", embedUrl: `https://www.geckoterminal.com/solana/pools/${p}?embed=1&info=0&swaps=0&grayscale=0&light_chart=0`, pageUrl: `https://www.geckoterminal.com/solana/pools/${p}`, note: "This market data comes from GeckoTerminal. It is shown for information, and no rule ever reads it." };
}

/** The market block of status.json from what the reader brought back (or nothing). */
export function buildMarketJson(i: { cluster: string; mint: string; status: string; poolId: string | null; graduatedPool: string | null; read: MarketInput | null | undefined }): MarketJson {
  const pool = i.read?.pool ?? null;
  const curve = pool && i.poolId ? curveProgress(pool, i.poolId) : null;
  const phase: CurvePhase | null = curve?.phase ?? (i.graduatedPool ? "graduated" : null);
  const curveNote = curve ? "" : i.status === "draft" || i.status === "expired" ? "This coin is not launched, so there is no curve yet." : !i.read ? "This site has not read the LaunchLab pool, because no RPC is set up." : i.read.poolError ? `The LaunchLab pool could not be read (${i.read.poolError}).` : "The LaunchLab pool account was not found.";
  return {
    phase, curve, curveNote, graduatedPool: i.graduatedPool,
    holders: { count: null, countNote: HOLDER_COUNT_NOTE, top: i.read?.top ?? null, topNote: i.read?.top ? "These are the 20 largest token accounts, with their owners looked up on chain." : !i.read ? "This site has not read the holders, because no RPC is set up." : "The holders were not read." },
    trade: tradeLinks(i.cluster, i.mint, phase, i.status), chart: chartFor(i.cluster, curve ? i.poolId : null, i.graduatedPool, phase),
    readAt: i.read?.readAt ? new Date(i.read.readAt).toISOString() : null, error: i.read?.error ?? null,
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The reader (one RPC round per coin, cached)
// ---------------------------------------------------------------------------------------------------------------------------------

/** The slice of @solana/web3.js Connection the reader uses. */
export interface MarketReader {
  getAccountInfo(pk: PublicKey): Promise<{ data: Uint8Array | Buffer; owner: PublicKey } | null>;
  getTokenLargestAccounts(mint: PublicKey): Promise<{ value: { address: PublicKey; amount: string; uiAmountString?: string; decimals: number }[] }>;
  getMultipleParsedAccounts(pks: PublicKey[]): Promise<{ value: ({ data: unknown } | null)[] }>;
}

const cache = new Map<string, { at: number; v: MarketInput }>();
export const MARKET_CACHE_MS = 30_000;
/** For tests. */
export function clearMarketCache(): void { cache.clear(); }

/**
 * Reads one coin's curve and top holders. Labels: the curve's base vault ("bonding curve"), the burn pool (fee PDA) and the creator.
 * `totalSupplyRaw` is the supply the percentages are of (the chain's current supply when known). Failures come back as `error`, never thrown.
 */
export async function readMarket(conn: MarketReader, i: { cluster: string; mint: string; poolId: string | null; feePda: string; creator: string; totalSupplyRaw: bigint; decimals: number }, now = Date.now()): Promise<MarketInput> {
  const ck = `${i.cluster}:${i.mint}:${i.poolId ?? ""}`;
  const hit = cache.get(ck);
  if (hit && now - hit.at < MARKET_CACHE_MS) return hit.v;
  const errors: string[] = [];
  let pool: LaunchLabPoolView | null = null, poolError: string | null = null;
  if (i.poolId) {
    try {
      const acc = await conn.getAccountInfo(new PublicKey(i.poolId));
      const program = launchLabProgramFor(i.cluster as "mainnet" | "devnet");
      if (acc && program && !acc.owner.equals(program)) poolError = `pool ${i.poolId} is not owned by the LaunchLab program`;
      else if (acc) { pool = decodeLaunchLabPool(new Uint8Array(acc.data)); if (!pool) poolError = "pool account has an unexpected size"; else if (pool.mintA !== i.mint) { poolError = "pool account is for another mint"; pool = null; } }
    } catch (e) { poolError = rpcErrorText(e); }
    if (poolError) errors.push(`pool: ${poolError}`);
  }
  let top: HolderRow[] | null = null;
  try {
    const largest = (await conn.getTokenLargestAccounts(new PublicKey(i.mint))).value;
    const owners = largest.length ? (await conn.getMultipleParsedAccounts(largest.map((a) => a.address))).value.map((a) => {
      const info = (a?.data as { parsed?: { info?: { owner?: string } } } | undefined)?.parsed?.info;
      return typeof info?.owner === "string" ? info.owner : null;
    }) : [];
    const program = launchLabProgramFor(i.cluster as "mainnet" | "devnet");
    const curveVault = program && i.poolId ? launchLabVault(program, new PublicKey(i.poolId), new PublicKey(i.mint)).toBase58() : null;
    top = largest.filter((a) => a.amount !== "0").map((a, k) => {
      const account = a.address.toBase58(), owner = owners[k] ?? null, raw = BigInt(a.amount);
      const label = account === curveVault || account === pool?.vaultA ? "bonding curve" : owner === i.feePda ? "burn pool" : owner === i.creator ? "creator" : null;
      return { account, owner, amount: rawToTokens(raw, a.decimals), pct: i.totalSupplyRaw > BigInt(0) ? Number((raw * BigInt(1_000_000)) / i.totalSupplyRaw) / 10_000 : 0, label };
    });
  } catch (e) { errors.push(`holders: ${rpcErrorText(e)}`); }
  const v: MarketInput = { pool, top, readAt: now, error: errors.length ? errors.join("; ") : null, poolError };
  cache.set(ck, { at: now, v });
  return v;
}

const WSOL_MINT = "So11111111111111111111111111111111111111112";
/**
 * THE $DEFICIT KEEPER'S CURVE READ (website-14, LAUNCHPAD-PATH §75: every "85 SOL" reads the coin's own raise from its pool). One
 * getAccountInfo of the coin's LaunchLab pool (the SOL-quoted PDA unless `poolId` names it), decoded with the same layout as the coin
 * cards. Null when the cluster has no LaunchLab program, the account is missing or is not this mint's pool. Never throws.
 */
export async function readKeeperCurve(conn: Pick<MarketReader, "getAccountInfo">, i: { cluster: string; mint: string; poolId?: string | null }, now = Date.now()): Promise<{ phase: CurvePhase; raised: string; threshold: string; quote: string; progressPct: number; poolId: string; readAt: string } | null> {
  try {
    const program = launchLabProgramFor(i.cluster as "mainnet" | "devnet");
    if (!program) return null;
    const pool = i.poolId ? new PublicKey(i.poolId) : launchLabPoolId(program, new PublicKey(i.mint), new PublicKey(WSOL_MINT));
    const acc = await conn.getAccountInfo(pool);
    if (!acc || !acc.owner.equals(program)) return null;
    const v = decodeLaunchLabPool(new Uint8Array(acc.data));
    if (!v || v.mintA !== i.mint) return null;
    const c = curveProgress(v, pool.toBase58());
    return { phase: c.phase, raised: c.raised, threshold: c.threshold, quote: c.quote, progressPct: c.progressPct, poolId: c.poolId, readAt: new Date(now).toISOString() };
  } catch { return null; }
}
