import "server-only";
import path from "node:path";
import { openRegistry, readingMatches, REGISTRY_FILE, type Registry, type TokenRow } from "@/lib/burnticker/registry";
import { KalshiClient } from "@/lib/burnticker/oracle/kalshi";
import { PolymarketClient, type TitleRefuser } from "@/lib/burnticker/oracle/polymarket";
import { loadRefuseList, refusalsFor } from "@/lib/burnticker/oracle/refuse";
import { CatalogueAdapter, feedById } from "@/lib/burnticker/catalogue";
import { Connection, PublicKey } from "@solana/web3.js";
import { SOL_MINT, usdPrice } from "@/lib/burnKeeper/jupiterSwap";
import { FakeBurnProgram, programPageBlock, type BurnProgramClient } from "@/lib/burnticker/program";
import { ProgramBurnClient } from "@/lib/burnticker/programClient";
import { FakeLaunchLab, type LaunchLabClient } from "@/lib/burnticker/launchBundle";
import { buildReceiptsJson, buildTokenStatus, type PairCounterpart, type TokenPageInput, type TokenStatusJson, type ReceiptJson } from "@/lib/burnticker/tokenPage";
import { DECIMALS, TOTAL_SUPPLY } from "@/lib/burnticker/rules";
import { rawToTokens, tokensToRaw } from "@/lib/burnKeeper/rules";
import { loadPowersRegister, operatorPowersSummary } from "@/lib/burnticker/trust";
import { devFeeWallet } from "@/lib/burnticker/fees";
import type { OracleAdapter } from "@/lib/burnticker/oracle/types";
import { readMarket, type MarketReader } from "@/lib/burnticker/market";
import { kalshiEnabled, polymarketDiscoveryEnabled } from "@/lib/burnticker/venues";
import { nativeSourceById } from "@/lib/burnticker/sources/native";

/**
 * THE APP'S WIRING (2026-10-09): one place that opens the registry, builds the oracle clients, and chooses the program / LaunchLab
 * clients — the FAKES until BURNTICKER_PROGRAM_ID (the deployed Receipts program) and an RPC exist; the pages say so. Nothing here
 * reads a key or sends a transaction. Routes import `platform()`; scripts build their own with the same pieces.
 */

export interface Platform {
  registry: Registry; oracles: { kalshi: OracleAdapter; catalogue: OracleAdapter; polymarket: OracleAdapter }; kalshi: KalshiClient; polymarket: PolymarketClient; program: BurnProgramClient; launchLab: LaunchLabClient;
  cluster: "devnet" | "mainnet" | "localnet"; publishDir: string; devFeeWallet: string | null; keeperPubkey: string | null; platformId: string | null; stubs: string[];
  /** Reads each coin's LaunchLab curve and top holders (market.ts) — present only with BURNTICKER_RPC_URL; without it the cards show "—". */
  market?: MarketReader | null;
  /** BURNTICKER_KALSHI_ENABLED (venues.ts): false turns off every Kalshi-facing surface; undefined = on. */
  kalshiEnabled?: boolean;
  /** BURNTICKER_POLYMARKET_DISCOVERY_ENABLED (venues.ts): false withholds Polymarket discovery (search, Browse, elections); undefined = on. Settlement unaffected. */
  polymarketDiscovery?: boolean;
}

let cached: Platform | null = null;

/** The refuse list (config/burnticker/refuse.json) as the Polymarket client's title check: the reasons a title is refused, or []. */
export const refuseTitles: TitleRefuser = (titles) => [...new Set(refusalsFor(loadRefuseList(), { titles }).map((r) => r.reason))];

/** The Polymarket client the app and the keeper use: Gamma for discovery, the Polygon CTF for results, the refuse list over every question. */
export function polymarketClient(env: Readonly<Record<string, string | undefined>> = process.env): PolymarketClient {
  const rpcUrls = (env.BURNTICKER_POLYGON_RPC_URLS ?? "").split(",").map((x) => x.trim()).filter((x) => /^https:\/\//.test(x));
  return new PolymarketClient({ refuse: refuseTitles, ...(rpcUrls.length ? { rpcUrls } : {}) });
}

export function platform(env: Readonly<Record<string, string | undefined>> = process.env): Platform {
  if (cached) return cached;
  const cluster = (env.BURNTICKER_CLUSTER === "mainnet" ? "mainnet" : env.BURNTICKER_CLUSTER === "localnet" ? "localnet" : "devnet") as Platform["cluster"];
  const stubs: string[] = [];
  const programId = (env.BURNTICKER_PROGRAM_ID ?? "").trim();
  // With a deployed program id and an RPC the app reads the program through a READ-ONLY ProgramBurnClient (no key on this host:
  // it can display, never sign); without them the fake keeps every page honest about it.
  const rpc = (env.BURNTICKER_RPC_URL ?? "").trim();
  let program: BurnProgramClient;
  if (programId && rpc) {
    program = new ProgramBurnClient({ connection: new Connection(rpc, "confirmed"), programId: new PublicKey(programId), cluster, payer: null, admin: (env.BURNTICKER_ADMIN ?? "").trim() ? new PublicKey((env.BURNTICKER_ADMIN ?? "").trim()) : null, solUsd: async () => { const px = await usdPrice(SOL_MINT); if (px === null) throw new Error("SOL price unavailable (Jupiter price API)"); return px; } });
    stubs.push(`burn_receipts program ${programId}: read-only client (this host holds no key; the keeper signs readings and cranks)`);
  } else {
    program = new FakeBurnProgram(cluster);
    stubs.push(programId ? `burn_receipts program ${programId}: no BURNTICKER_RPC_URL on this host (FakeBurnProgram in use)` : "burn_receipts program: not deployed (FakeBurnProgram — PDAs are placeholders, nothing is sent)");
  }
  const platformId = (env.BURNTICKER_PLATFORM_ID ?? "").trim() || null;
  const launchLab = new FakeLaunchLab(platformId ?? undefined);
  stubs.push(platformId ? `LaunchLab platform ${platformId}: the SDK adapter needs an RPC to decode the configs (FakeLaunchLab in use on this host)` : "LaunchLab platform config: not created (scripts/burnticker-platform-config.mts prints the dry run)");
  const kalshi = new KalshiClient();
  const polymarket = polymarketClient(env);
  // Bonding curve + top holders for the coin cards: read-only account reads over the same RPC (no key). Without one: "—" and the reason.
  // disableRetryOnRateLimit: a rate-limited RPC fails the read fast ("could not be read") instead of stalling every page on backoff.
  const market: MarketReader | null = rpc ? (new Connection(rpc, { commitment: "confirmed", disableRetryOnRateLimit: true }) as unknown as MarketReader) : null;
  if (!rpc) stubs.push("LaunchLab curve progress and top holders: no BURNTICKER_RPC_URL on this host (cards show —)");
  if (!polymarketDiscoveryEnabled(env)) stubs.push("Polymarket discovery: off on this host (BURNTICKER_POLYMARKET_DISCOVERY_ENABLED=0); settlement reads the on-chain payout regardless");
  cached = {
    registry: openRegistry((env.BURNTICKER_DB ?? "").trim() || REGISTRY_FILE),
    oracles: { kalshi, catalogue: new CatalogueAdapter(), polymarket }, kalshi, polymarket, program, launchLab, cluster,
    publishDir: (env.BURNTICKER_PUBLISH_DIR ?? "").trim() || path.join("data", "burnticker-site"),
    devFeeWallet: devFeeWallet(env), keeperPubkey: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test((env.BURNTICKER_KEEPER_PUBKEY ?? "").trim()) ? (env.BURNTICKER_KEEPER_PUBKEY ?? "").trim() : null, platformId, stubs, market, kalshiEnabled: kalshiEnabled(env), polymarketDiscovery: polymarketDiscoveryEnabled(env),
  };
  return cached;
}

/** For tests: a platform over an in-memory registry and injected clients. */
export function setPlatformForTests(p: Platform | null): void { cached = p; }

/** Everything the token page needs, from the registry and the (fake or real) program, plus the display-only implied chance. */
export async function tokenPageInput(p: Platform, t: TokenRow, now = Date.now(), opts: { live?: boolean } = {}): Promise<TokenPageInput> {
  const locked = p.registry.lockedRule(t);
  const readings = p.registry.readings(t.selectorKey, t.baselineAt).filter((r) => readingMatches(locked.rule, r));
  const state = p.registry.state(t.mint);
  const oracle = locked.rule.oracle === "catalogue" ? p.oracles.catalogue : locked.rule.oracle === "polymarket" ? p.oracles.polymarket : p.oracles.kalshi;
  // live: false (the receipts-only API route) skips the two oracle calls; the receipts do not depend on them. Venue display reads
  // (venues.ts): no market-implied chance from Polymarket ever (no odds rendered), Kalshi's only with BURNTICKER_KALSHI_ENABLED on;
  // series titles from Kalshi only when enabled, from Polymarket only with discovery on.
  const isK = locked.rule.oracle === "kalshi", isP = locked.rule.oracle === "polymarket";
  const kOk = p.kalshiEnabled !== false, pOk = p.polymarketDiscovery !== false;
  const [implied, info] = opts.live === false ? ([null, null] as const) : await Promise.all([
    !isK || !kOk ? Promise.resolve(null) : oracle.impliedChance(locked.rule, state.lastValue).catch((e: Error) => ({ chance: null, marketTicker: null, closeTime: null, basis: `unavailable: ${e.message.slice(0, 80)}` })),
    locked.rule.oracle === "catalogue" || (isK && !kOk) || (isP && !pOk) ? Promise.resolve(null) : oracle.seriesInfo(locked.rule.oracle === "polymarket" ? (locked.rule.market ?? locked.rule.series!) : locked.rule.series ?? locked.rule.market!.split("-")[0]).catch(() => null),
  ]);
  const feedState = p.registry.feedState(t.selectorKey);
  const feed = locked.rule.oracle === "catalogue" && locked.rule.series ? feedById(locked.rule.series) : null;
  const [supplyRaw, feePdaLamports, vaultRaw] = await Promise.all([p.program.supplyRaw(t.mint).catch(() => null), p.program.feePdaBalanceLamports(t.mint).catch(() => null), locked.mode === "vault" ? p.program.vaultBalanceRaw(t.mint).catch(() => null) : Promise.resolve(null)]);
  const market = p.market && opts.live !== false && t.status !== "draft" && t.status !== "expired"
    ? await readMarket(p.market, { cluster: p.cluster, mint: t.mint, poolId: t.poolId, feePda: t.feePda, creator: t.creator, totalSupplyRaw: supplyRaw ?? tokensToRaw(TOTAL_SUPPLY, DECIMALS), decimals: DECIMALS }, now).catch(() => null)
    : null;
  return {
    market,
    pair: await pairCounterpart(p, t),
    token: t, locked, readings, receipts: p.registry.receipts(t.mint), attesters: p.registry.attesters(t.mint), state, feedState,
    chain: { cluster: p.cluster, programId: p.program.programId, supplyRaw, feePdaLamports, vaultRaw, program: await programPageBlock(p.program, t.mint, p.registry.lastProgramTx(t.mint, "reading")) },
    now, nextCheckAt: feedState.nextFetchAt, implied, seriesTitle: info?.title ?? feed?.title ?? (locked.rule.oracle === "catalogue" && locked.rule.series ? nativeSourceById(locked.rule.series)?.title ?? null : null), selectorPending: 0,
    operator: operatorPowersSummary(loadPowersRegister()),
  };
}

/** The other side of a rivalry pair, summarised from the registry and the program (no page build needed). */
export async function pairCounterpart(p: Platform, t: TokenRow): Promise<PairCounterpart | null> {
  const pair = p.registry.pairOf(t.mint);
  if (!pair) return null;
  const side: "A" | "B" = pair.mintA === t.mint ? "A" : "B";
  const other = p.registry.token(side === "A" ? pair.mintB : pair.mintA);
  if (!other) return null;
  const receipts = p.registry.receipts(other.mint);
  const confirmed = receipts.filter((r) => r.status === "confirmed" && (r.burnRaw ?? BigInt(0)) > BigInt(0));
  const burnedRaw = p.registry.totalBurnedRaw(other.mint);
  const supplyRaw = (await p.program.supplyRaw(other.mint).catch(() => null)) ?? tokensToRaw(TOTAL_SUPPLY, DECIMALS) - burnedRaw;
  const last = [...confirmed].sort((x, y) => (x.settledAt < y.settledAt ? 1 : -1))[0];
  return { pairId: pair.pairId, side, counterpart: { ticker: other.ticker, name: other.name, mint: other.mint, burns: confirmed.length, burned: rawToTokens(burnedRaw, DECIMALS), supply: rawToTokens(supplyRaw, DECIMALS), lastBurnAt: last?.settledAt ?? null } };
}

export async function tokenPageData(p: Platform, t: TokenRow, now = Date.now(), opts: { live?: boolean } = {}): Promise<{ status: TokenStatusJson; receipts: ReceiptJson[]; readings: TokenPageInput["readings"]; rulesText: string; stubs: string[] }> {
  const input = await tokenPageInput(p, t, now, opts);
  const receipts = buildReceiptsJson(input);
  return { status: buildTokenStatus(input, receipts), receipts, readings: input.readings, rulesText: t.rulesJson, stubs: p.stubs };
}
