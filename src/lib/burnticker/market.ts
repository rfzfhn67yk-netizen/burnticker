import { PublicKey } from "@solana/web3.js";
import { rawToTokens } from "@/lib/burnKeeper/rules";
import { CPMM_PROGRAM_ID as CPMM_PROGRAM, launchLabPoolId, launchLabProgramFor, launchLabVault } from "@/lib/burnKeeper/launchlab";
import type { ChartJson, CurveJson, CurvePhase, HolderRow, LifecycleDatesJson, MarketJson, TradeLinks } from "@/lib/burnticker/pageTypes";
import type { HoldersRead } from "@/lib/burnticker/holders";
import { NOT_READ, MCAP_POOL_MEANING } from "@/lib/burnticker/cardView";
import { coinLinks } from "@/lib/burnticker/tradeLinks";

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

/** Deep links for a mint, from the one builder (tradeLinks.ts coinLinks). Mainnet only: Raydium's and Jupiter's swap pages do not serve devnet. */
export function tradeLinks(cluster: string, mint: string, phase: CurvePhase | null, status: string): TradeLinks {
  const l = coinLinks({ cluster, mint, phase, status });
  return { links: l.trade.map((x) => ({ id: x.id as TradeLinks["links"][number]["id"], label: x.label, url: x.url, ...(x.href ? { href: x.href } : {}) })), note: l.note };
}

/** GeckoTerminal's chart embed for the pool that trades now: the CPMM pool after graduation, the LaunchLab curve pool before (only a pool read on chain this cycle — never an unverified id). */
export function chartFor(cluster: string, curvePool: string | null, graduatedPool: string | null, phase: CurvePhase | null): ChartJson {
  const pool = phase === "graduated" && graduatedPool ? graduatedPool : curvePool;
  if (!isMainnet(cluster)) return { provider: null, embedUrl: null, pageUrl: null, note: `No public chart covers ${cluster}, so the burn chart below is drawn from the receipts.` };
  if (!pool) return { provider: null, embedUrl: null, pageUrl: null, note: "No pool was read this cycle." };
  const p = encodeURIComponent(pool);
  return { provider: "geckoterminal", embedUrl: `https://www.geckoterminal.com/solana/pools/${p}?embed=1&info=0&swaps=0&grayscale=0&light_chart=0`, pageUrl: `https://www.geckoterminal.com/solana/pools/${p}`, note: "This market data comes from GeckoTerminal. It is shown for information, and no rule ever reads it." };
}

/** Why the graduated pool's figure is missing: the card's sentence, then the read's own error as a sentence. */
const poolNotRead = (error: string | null) => (error ? `${NOT_READ.mcapPool} ${error.charAt(0).toUpperCase()}${error.slice(1)}.` : NOT_READ.mcapPool);

/** The market block of status.json from what the reader brought back (or nothing). */
export function buildMarketJson(i: { cluster: string; mint: string; status: string; poolId: string | null; graduatedPool: string | null; read: MarketInput | null | undefined;
  /** indexer-1 (WIRING.md step 3): the graduated pool, the holder count and the lifecycle dates as read this cycle */
  cpmm?: { market: CpmmMarket | null; error: string | null } | null; holders?: HoldersRead | null; dates?: LifecycleDatesJson | null }): MarketJson {
  const pool = i.read?.pool ?? null;
  const curve = pool && i.poolId ? curveProgress(pool, i.poolId) : null;
  const phase: CurvePhase | null = curve?.phase ?? (i.graduatedPool ? "graduated" : null);
  const h = i.holders ?? null;
  const curveNote = curve ? "" : i.status === "draft" || i.status === "expired" ? "This coin is not launched, so there is no curve yet." : !i.read ? "This site has not read the LaunchLab pool, because no RPC is set up." : i.read.poolError ? `The LaunchLab pool could not be read (${i.read.poolError}).` : "The LaunchLab pool account was not found.";
  return {
    phase, curve, curveNote, graduatedPool: i.graduatedPool,
    holders: { count: h?.state === "read" ? h.holders : null, wallets: h?.state === "read" && typeof h.wallets === "number" ? h.wallets : null, countNote: !h ? HOLDER_COUNT_NOTE : h.state === "read" ? "" : h.reason, top: i.read?.top ?? null, topNote: i.read?.top ? "These are the 20 largest token accounts, with their owners looked up on chain." : !i.read ? "This site has not read the holders, because no RPC is set up." : "The holders were not read.",
      top10: h?.state === "read" ? h.top10 : null, top10Pct: h?.state === "read" ? h.top10Pct : null, top10PctUnlabelled: h?.state === "read" ? h.top10PctUnlabelled : null },
    trade: tradeLinks(i.cluster, i.mint, phase, i.status), chart: chartFor(i.cluster, curve ? i.poolId : null, i.graduatedPool, phase),
    readAt: i.read?.readAt ? new Date(i.read.readAt).toISOString() : null, error: i.read?.error ?? null,
    pool: i.cpmm?.market ?? null,
    poolNote: i.cpmm?.market ? MCAP_POOL_MEANING : poolNotRead(i.cpmm?.error ?? null),
    dates: i.dates ?? null,
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
export async function readKeeperCurve(conn: Pick<MarketReader, "getAccountInfo">, i: { cluster: string; mint: string; poolId?: string | null }, now = Date.now()): Promise<{ phase: CurvePhase; raised: string; threshold: string; quote: string; progressPct: number; poolId: string; readAt: string; marketCap?: string | null } | null> {
  try {
    const program = launchLabProgramFor(i.cluster as "mainnet" | "devnet");
    if (!program) return null;
    const pool = i.poolId ? new PublicKey(i.poolId) : launchLabPoolId(program, new PublicKey(i.mint), new PublicKey(WSOL_MINT));
    const acc = await conn.getAccountInfo(pool);
    if (!acc || !acc.owner.equals(program)) return null;
    const v = decodeLaunchLabPool(new Uint8Array(acc.data));
    if (!v || v.mintA !== i.mint) return null;
    const c = curveProgress(v, pool.toBase58());
    // website-15 item 9: the curve's market cap too (the $REHEARSAL card reads its pool with this; additive for the keeper's file)
    return { phase: c.phase, raised: c.raised, threshold: c.threshold, quote: c.quote, progressPct: c.progressPct, poolId: c.poolId, readAt: new Date(now).toISOString(), marketCap: curveMarketCap(v) };
  } catch { return null; }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// After graduation: the Raydium CPMM pool (indexer-1, 2026-10-12; PLATFORM-NEXT-2 item 3)
// ---------------------------------------------------------------------------------------------------------------------------------

/**
 * THE TRADING POOL'S MARKET CAP. Once a coin leaves its curve it trades in a Raydium CPMM pool (constant product), and the card's market
 * cap comes from that pool instead:
 *
 *   reserve = vault balance − protocol fees − fund fees − creator fees owed     (the Raydium SDK's own reserve, cpmm/cpmm.ts)
 *   price   = SOL reserve / token reserve                                         (SOL per whole token)
 *   cap     = price × the mint's current supply                                    (burns already subtracted: an SPL burn lowers supply)
 *
 * Raw units cancel, so the cap is exact integer arithmetic in lamports: solReserveRaw × supplyRaw ÷ tokenReserveRaw. Like the curve read,
 * it returns the cap as a bare number and names no per-token figure (test/burntickerReviewErrata.test.ts holds market.ts to that). The supply is the
 * whole mint supply as the chain reports it (tokens still on vesting or in the burn pool count; burned tokens do not). Layout: the SDK's
 * CpmmPoolInfoLayout (raydium-sdk-V2 src/raydium/cpmm/layout.ts, 637 bytes), pinned in test/burntickerCpmmMarket.test.ts against the
 * SDK decoder and two real pools (config/burnticker/fixtures/cpmm). Only a pool owned by the cluster's CPMM program, pairing this mint
 * with wrapped SOL, with vaults that hold those mints, gives a number. Anything else is an error string, never a guess.
 */
export const CPMM_POOL_SIZE = 637;
export interface CpmmPoolView {
  configId: string; poolCreator: string; vault0: string; vault1: string; lpMint: string; mint0: string; mint1: string; tokenProgram0: string; tokenProgram1: string;
  status: number; decimals0: number; decimals1: number;
  protocolFees0Raw: bigint; protocolFees1Raw: bigint; fundFees0Raw: bigint; fundFees1Raw: bigint; openTime: bigint; enableCreatorFee: boolean; creatorFees0Raw: bigint; creatorFees1Raw: bigint;
}
const CPMM_OFF = { configId: 8, poolCreator: 40, vault0: 72, vault1: 104, lpMint: 136, mint0: 168, mint1: 200, tokenProgram0: 232, tokenProgram1: 264, status: 329, decimals0: 331, decimals1: 332, protocolFees0: 341, protocolFees1: 349, fundFees0: 357, fundFees1: 365, openTime: 373, enableCreatorFee: 390, creatorFees0: 397, creatorFees1: 405 } as const;

/** Decodes a Raydium CPMM PoolState; null when the bytes cannot be one (wrong size). */
export function decodeCpmmPool(data: Uint8Array): CpmmPoolView | null {
  if (data.length !== CPMM_POOL_SIZE) return null;
  const o = CPMM_OFF;
  return {
    configId: key(data, o.configId), poolCreator: key(data, o.poolCreator), vault0: key(data, o.vault0), vault1: key(data, o.vault1), lpMint: key(data, o.lpMint),
    mint0: key(data, o.mint0), mint1: key(data, o.mint1), tokenProgram0: key(data, o.tokenProgram0), tokenProgram1: key(data, o.tokenProgram1),
    status: data[o.status], decimals0: data[o.decimals0], decimals1: data[o.decimals1],
    protocolFees0Raw: u64(data, o.protocolFees0), protocolFees1Raw: u64(data, o.protocolFees1), fundFees0Raw: u64(data, o.fundFees0), fundFees1Raw: u64(data, o.fundFees1),
    openTime: u64(data, o.openTime), enableCreatorFee: data[o.enableCreatorFee] === 1, creatorFees0Raw: u64(data, o.creatorFees0), creatorFees1Raw: u64(data, o.creatorFees1),
  };
}

const TOKEN_PROGRAMS = new Set(["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"]);
/** An SPL Token or Token-2022 mint's supply and decimals (the 82-byte base layout both share); null when the bytes are not an initialized mint. */
export function decodeMintSupply(data: Uint8Array): { supplyRaw: bigint; decimals: number } | null {
  if (data.length < 82 || data[45] !== 1) return null;
  // a Token-2022 mint with extensions is padded to 165 bytes and marks itself account type 1 (Mint) at byte 165
  if (data.length > 82 && (data.length <= 165 || data[165] !== 1)) return null;
  return { supplyRaw: u64(data, 36), decimals: data[44] };
}
/** A token account's mint and raw amount (the 165-byte base layout both token programs share); null when the bytes are not one. */
export function decodeTokenAccount(data: Uint8Array): { mint: string; owner: string; amountRaw: bigint } | null {
  if (data.length < 165 || (data[108] !== 1 && data[108] !== 2)) return null; // state: 1 initialized, 2 frozen
  if (data.length > 165 && data[165] !== 2) return null; // Token-2022 account type 2 (Account)
  return { mint: key(data, 0), owner: key(data, 32), amountRaw: u64(data, 64) };
}

/** What a CPMM read brings back for the card and the coin page. Amounts are decimal strings; `marketCap` is in SOL. */
export interface CpmmMarket {
  poolId: string; mint: string; quote: "SOL";
  /** the reserves the price is taken from (vault balance minus the fees the pool owes), whole tokens and SOL */
  tokenReserve: string; solReserve: string;
  /** the mint's supply as read (burns already subtracted), whole tokens */
  supply: string;
  marketCap: string;
  /** the pool's status bits as on chain (Raydium: 1 deposit off, 2 withdraw off, 4 swap off) */
  status: number;
  readAt: string;
}

/**
 * The pool's market cap from the decoded pool, the two vault balances and the mint's supply. Null when the pool does not pair
 * `mint` with wrapped SOL or a reserve is not positive (an empty or fully owed pool has no price).
 */
export function cpmmMarketCap(pool: CpmmPoolView, vault0Raw: bigint, vault1Raw: bigint, mint: string, supplyRaw: bigint, tokenDecimals: number): Omit<CpmmMarket, "poolId" | "readAt" | "status"> | null {
  const r0 = vault0Raw - pool.protocolFees0Raw - pool.fundFees0Raw - pool.creatorFees0Raw;
  const r1 = vault1Raw - pool.protocolFees1Raw - pool.fundFees1Raw - pool.creatorFees1Raw;
  const tokenIs0 = pool.mint0 === mint && pool.mint1 === WSOL_MINT, tokenIs1 = pool.mint1 === mint && pool.mint0 === WSOL_MINT;
  if (!tokenIs0 && !tokenIs1) return null;
  const tokenRes = tokenIs0 ? r0 : r1, solRes = tokenIs0 ? r1 : r0, solDec = tokenIs0 ? pool.decimals1 : pool.decimals0;
  if ((tokenIs0 ? pool.decimals0 : pool.decimals1) !== tokenDecimals) return null;
  if (tokenRes <= BigInt(0) || solRes <= BigInt(0) || supplyRaw < BigInt(0)) return null;
  return { mint, quote: "SOL", tokenReserve: rawToTokens(tokenRes, tokenDecimals), solReserve: rawToTokens(solRes, solDec), supply: rawToTokens(supplyRaw, tokenDecimals), marketCap: rawToTokens((solRes * supplyRaw) / tokenRes, solDec) };
}

/** The slice of @solana/web3.js Connection the CPMM read uses (one round trip in the usual case). */
export interface CpmmReader { getMultipleAccountsInfo(pks: PublicKey[]): Promise<({ data: Uint8Array | Buffer; owner: PublicKey } | null)[]> }

const cpmmCache = new Map<string, { at: number; v: { market: CpmmMarket | null; error: string | null } }>();
export const CPMM_CACHE_MS = 30_000;
/** For tests. */
export function clearCpmmCache(): void { cpmmCache.clear(); }
const CPMM_VAULT_SEED = Buffer.from("pool_vault", "utf8");
const cpmmVault = (program: PublicKey, pool: PublicKey, mint: PublicKey) => PublicKey.findProgramAddressSync([CPMM_VAULT_SEED, pool.toBuffer(), mint.toBuffer()], program)[0];

/**
 * Reads a graduated coin's CPMM pool: one getMultipleAccountsInfo of [pool, its two vaults (Raydium's PDAs), the mint], and a second
 * only when the pool names vaults other than those PDAs. `poolId` is the pool the burn program registered (status.json
 * market.graduatedPool), never a guess. Returns `{ market, error }`; a failure is the error in a few words, never thrown, and never a
 * number. Cached 30 seconds per pool, like the curve read.
 */
export async function readCpmmMarket(conn: CpmmReader, i: { cluster: string; mint: string; poolId: string }, now = Date.now()): Promise<{ market: CpmmMarket | null; error: string | null }> {
  const ck = `${i.cluster}:${i.mint}:${i.poolId}`;
  const hit = cpmmCache.get(ck);
  if (hit && now - hit.at < CPMM_CACHE_MS) return hit.v;
  const v = await readCpmmUncached(conn, i, now);
  cpmmCache.set(ck, { at: now, v });
  return v;
}

async function readCpmmUncached(conn: CpmmReader, i: { cluster: string; mint: string; poolId: string }, now: number): Promise<{ market: CpmmMarket | null; error: string | null }> {
  const fail = (error: string) => ({ market: null, error });
  const program = i.cluster === "mainnet" ? CPMM_PROGRAM.mainnet : i.cluster === "devnet" ? CPMM_PROGRAM.devnet : null;
  if (!program) return fail(`no Raydium CPMM program on ${i.cluster}`);
  let poolPk: PublicKey, mintPk: PublicKey;
  try { poolPk = new PublicKey(i.poolId); mintPk = new PublicKey(i.mint); } catch { return fail("the pool or mint is not a public key"); }
  try {
    const vToken = cpmmVault(program, poolPk, mintPk), vSol = cpmmVault(program, poolPk, new PublicKey(WSOL_MINT));
    const [poolAcc, aTok, aSol, mintAcc] = await conn.getMultipleAccountsInfo([poolPk, vToken, vSol, mintPk]);
    if (!poolAcc) return fail("the pool account was not found");
    if (!poolAcc.owner.equals(program)) return fail("the pool is not owned by the Raydium CPMM program");
    const pool = decodeCpmmPool(new Uint8Array(poolAcc.data));
    if (!pool) return fail("the pool account has an unexpected size");
    if (!mintAcc || !TOKEN_PROGRAMS.has(mintAcc.owner.toBase58())) return fail("the mint account was not found");
    const supply = decodeMintSupply(new Uint8Array(mintAcc.data));
    if (!supply) return fail("the mint account is not a token mint");
    // the vault accounts, by the addresses the pool itself names (the PDAs fetched above in the usual case)
    if (pool.mint0 !== i.mint && pool.mint1 !== i.mint) return fail("the pool is for another mint");
    if (pool.mint0 !== WSOL_MINT && pool.mint1 !== WSOL_MINT) return fail("the pool does not trade against SOL");
    const want0 = pool.vault0, want1 = pool.vault1;
    const derived: Record<string, { data: Uint8Array | Buffer; owner: PublicKey } | null> = { [vToken.toBase58()]: aTok, [vSol.toBase58()]: aSol };
    let acc0 = derived[want0], acc1 = derived[want1];
    if (acc0 === undefined || acc1 === undefined) [acc0, acc1] = await conn.getMultipleAccountsInfo([new PublicKey(want0), new PublicKey(want1)]);
    const d0 = acc0 && TOKEN_PROGRAMS.has(acc0.owner.toBase58()) ? decodeTokenAccount(new Uint8Array(acc0.data)) : null;
    const d1 = acc1 && TOKEN_PROGRAMS.has(acc1.owner.toBase58()) ? decodeTokenAccount(new Uint8Array(acc1.data)) : null;
    if (!d0 || !d1) return fail("a pool vault could not be read");
    if (d0.mint !== pool.mint0 || d1.mint !== pool.mint1) return fail("a pool vault holds a different mint than the pool names");
    const m = cpmmMarketCap(pool, d0.amountRaw, d1.amountRaw, i.mint, supply.supplyRaw, supply.decimals);
    if (!m) return fail("the pool reserves give no market cap (an empty reserve, or decimals that disagree with the mint)");
    return { market: { ...m, poolId: i.poolId, status: pool.status, readAt: new Date(now).toISOString() }, error: null };
  } catch (e) { return fail(rpcErrorText(e)); }
}
