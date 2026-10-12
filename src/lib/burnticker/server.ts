import "server-only";
import { lpLockBlock } from "@/lib/burnticker/lpLockPage";
import { connectionLaunchVerifier, type LaunchVerifier, type TxReader } from "@/lib/burnticker/launchVerify";
import { LAUNCHLAB_PROGRAM_ID, PAIR_CURVE_PROGRAM_ID } from "@/lib/burnReceipts/constants";
import { envGameDeps, polymarketGameReaders } from "@/lib/burnticker/sources/gameSettle";
import { allowHostedMetadata, customImagesEnabled, uploaderFromEnv, type PinUploader } from "@/lib/burnticker/pin";
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
import type { LaunchLabClient } from "@/lib/burnticker/launchBundle";
import { launchLabFromEnv, type LaunchLabAccountReader } from "@/lib/burnticker/launchLabChain";
import { mainnetLaunchesAllowed } from "@/lib/burnticker/hostedLaunch";
import { pairUnlinked } from "@/lib/burnticker/pairForwardKeeper";
import { buildReceiptsJson, buildTokenStatus, lifecycleFrom, pairChainFields, pairClauseState, pairForwardsJson, type PairCounterpart, type TokenPageInput, type TokenStatusJson, type ReceiptJson } from "@/lib/burnticker/tokenPage";
import { DECIMALS, TOTAL_SUPPLY, pairWinnerTakesBurn } from "@/lib/burnticker/rules";
import { rawToTokens, tokensToRaw } from "@/lib/burnKeeper/rules";
import { loadPowersRegister, operatorPowersSummary } from "@/lib/burnticker/trust";
import { devFeeWallet } from "@/lib/burnticker/fees";
import type { FetchLike, OracleAdapter } from "@/lib/burnticker/oracle/types";
import { connectionPoolPort, type PoolPort } from "@/lib/burnticker/derby/pools";
import { HermesClient } from "@/lib/burnticker/derby/pyth";
import { DerbyAdapter } from "@/lib/burnticker/derby/adapter";
import { readMarket, type MarketReader } from "@/lib/burnticker/market";
import { kalshiEnabled, polymarketDiscoveryEnabled } from "@/lib/burnticker/venues";
import { nativeSourceById, setNativeClients } from "@/lib/burnticker/sources/native";
import { derbyTitle } from "@/lib/burnticker/api/handlers";

/**
 * THE APP'S WIRING (2026-10-09): one place that opens the registry, builds the oracle clients, and chooses the program / LaunchLab
 * clients — the FAKES until BURNTICKER_PROGRAM_ID (the deployed Receipts program), BURNTICKER_PLATFORM_ID and an RPC exist; the pages say so. Nothing here
 * reads a key or sends a transaction. Routes import `platform()`; scripts build their own with the same pieces.
 */

export interface Platform {
  registry: Registry; oracles: { kalshi: OracleAdapter; catalogue: OracleAdapter; polymarket: OracleAdapter; /** Burn Derby (derby/adapter.ts). */ derby?: OracleAdapter }; kalshi: KalshiClient; polymarket: PolymarketClient; program: BurnProgramClient; launchLab: LaunchLabClient;
  cluster: "devnet" | "mainnet" | "localnet"; publishDir: string; devFeeWallet: string | null; keeperPubkey: string | null; platformId: string | null; stubs: string[];
  /** Reads each coin's LaunchLab curve and top holders (market.ts) — present only with BURNTICKER_RPC_URL; without it the cards show "—". */
  market?: MarketReader | null;
  /** BURNTICKER_KALSHI_ENABLED (venues.ts): false turns off every Kalshi-facing surface; undefined = on. */
  kalshiEnabled?: boolean;
  /** Burn Derby (2026-10-10): the fetch for cross-reads / Jupiter search (tests inject fixtures; production = global fetch). */
  derbyFetch?: FetchLike;
  /** Burn Derby: a read-only MAINNET account port (Pyth's Solana accounts, pools, mint supplies) — BURNTICKER_DERBY_RPC_URL, else the public RPC. */
  derbyPools?: PoolPort | null;
  /** Burn Derby: Hermes, only when BURNTICKER_PYTH_API_KEY is set (keyless price paths answer 401). */
  derbyHermes?: HermesClient | null;
  /** BURNTICKER_POLYMARKET_DISCOVERY_ENABLED (venues.ts): false withholds Polymarket discovery (search, Browse, elections); undefined = on. Settlement unaffected. */
  polymarketDiscovery?: boolean;
  /** The Arweave uploader (pin.ts; Irys with BURNTICKER_UPLOAD_PAYER). Null/absent: every launch is refused unless hosted metadata is allowed. */
  uploader?: PinUploader | null;
  /** BURNTICKER_CUSTOM_IMAGES_ENABLED (default off): a creator's own image link instead of the generated receipt art. */
  customImages?: boolean;
  /** BURNTICKER_ALLOW_HOSTED_METADATA (default off; devnet scripts): a failed pin falls back to the hosted JSON, marked `hosted`. */
  allowHostedMetadata?: boolean;
  /** BURNTICKER_PIN_DAILY_CAP: coins pinned on Arweave (paid by the platform) per UTC day on this host (review N4); absent = DEFAULT_PIN_DAILY_CAP. */
  pinDailyCap?: number;
  /** BURNTICKER_ALLOW_MAINNET_LAUNCHES on a mainnet host (hostedLaunch.ts): the owner's explicit allowance; absent/false = mainnet launches refused. */
  allowMainnet?: boolean;
  /** Reads a launch transaction from the chain before a draft goes live (launchVerify.ts; review N1). Null/absent (no RPC): confirmations are refused. */
  launchVerifier?: LaunchVerifier | null;
}

let cached: Platform | null = null;

/** A derby coin's page on a host whose platform carries no derby adapter: no market, no odds. */
const derbyPageOracle: OracleAdapter = { id: "derby", searchSeries: async () => [], seriesInfo: async () => null, settledSince: async () => ({ events: [], awaitingFinal: 0, refusals: [], settlementSourceUrl: null }), impliedChance: async () => ({ chance: null, marketTicker: null, closeTime: null, basis: "Burn Derby: no market and no odds" }) };

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
    program = new ProgramBurnClient({ connection: new Connection(rpc, "confirmed"), programId: new PublicKey(programId), cluster, payer: null, launchLabPlatform: (env.BURNTICKER_PLATFORM_ID ?? "").trim() ? new PublicKey((env.BURNTICKER_PLATFORM_ID ?? "").trim()) : null, admin: (env.BURNTICKER_ADMIN ?? "").trim() ? new PublicKey((env.BURNTICKER_ADMIN ?? "").trim()) : null, solUsd: async () => { const px = await usdPrice(SOL_MINT); if (px === null) throw new Error("SOL price unavailable (Jupiter price API)"); return px; } });
    stubs.push(`burn_receipts program ${programId}: read-only client (this host holds no key; the keeper signs readings and cranks)`);
  } else {
    program = new FakeBurnProgram(cluster);
    stubs.push(programId ? `burn_receipts program ${programId}: no BURNTICKER_RPC_URL on this host (FakeBurnProgram in use)` : "burn_receipts program: no program id wired on this host (FakeBurnProgram — PDAs are placeholders, nothing is sent); program deployment is on the trust page");
  }
  const platformId = (env.BURNTICKER_PLATFORM_ID ?? "").trim() || null;
  // launch-10 (2026-10-12): the real LaunchLab client on a host with an RPC, the program id and the platform id (launchLabChain.ts);
  // the fake elsewhere (tests, RPC-less hosts, BURNTICKER_LAUNCHLAB_CLIENT=fake). Mainnet launches stay refused unless the host sets
  // BURNTICKER_ALLOW_MAINNET_LAUNCHES (hostedLaunch.ts; prepareLaunch passes it to the builder as allowMainnet).
  const ll = launchLabFromEnv(env, { cluster, reader: rpc ? (new Connection(rpc, "confirmed") as unknown as LaunchLabAccountReader) : null });
  const launchLab = ll.client;
  stubs.push(ll.stub);
  const allowMainnet = cluster === "mainnet" && mainnetLaunchesAllowed(env);
  if (cluster === "mainnet" && !allowMainnet) stubs.push("mainnet launches: refused on this host (BURNTICKER_ALLOW_MAINNET_LAUNCHES is not set)");
  const kalshi = new KalshiClient();
  const polymarket = polymarketClient(env);
  // Bonding curve + top holders for the coin cards: read-only account reads over the same RPC (no key). Without one: "—" and the reason.
  // disableRetryOnRateLimit: a rate-limited RPC fails the read fast ("could not be read") instead of stalling every page on backoff.
  const market: MarketReader | null = rpc ? (new Connection(rpc, { commitment: "confirmed", disableRetryOnRateLimit: true }) as unknown as MarketReader) : null;
  if (!rpc) stubs.push("LaunchLab curve progress and top holders: no BURNTICKER_RPC_URL on this host (cards show —)");
  if (!polymarketDiscoveryEnabled(env)) stubs.push("Polymarket discovery: off on this host (BURNTICKER_POLYMARKET_DISCOVERY_ENABLED=0); settlement reads the on-chain payout regardless");
  const registry = openRegistry((env.BURNTICKER_DB ?? "").trim() || REGISTRY_FILE);
  // Burn Derby (2026-10-10): Pyth / pools / supplies are MAINNET facts whatever cluster the coins live on — a read-only port, no key.
  const derbyPools = connectionPoolPort(new Connection((env.BURNTICKER_DERBY_RPC_URL ?? "").trim() || "https://api.mainnet-beta.solana.com", { commitment: "confirmed", disableRetryOnRateLimit: true }));
  const derbyHermes = (env.BURNTICKER_PYTH_API_KEY ?? "").trim() ? HermesClient.fromEnv(env) : null;
  const derby = new DerbyAdapter({ registry, hermes: derbyHermes, pools: derbyPools, fetchImpl: globalThis.fetch as unknown as FetchLike, now: () => Date.now() });
  // Team coins: games settle on their Polymarket on-chain payout where a moneyline market exists, else TheSportsDB (gameSettle.ts).
  setNativeClients({ games: { ...envGameDeps(env), ...(polymarketDiscoveryEnabled(env) ? polymarketGameReaders(polymarket) : { market: null, payout: null }) } });
  cached = {
    registry, derbyPools, derbyHermes,
    oracles: { kalshi, catalogue: new CatalogueAdapter(), polymarket, derby }, kalshi, polymarket, program, launchLab, cluster,
    publishDir: (env.BURNTICKER_PUBLISH_DIR ?? "").trim() || path.join("data", "burnticker-site"),
    allowMainnet, devFeeWallet: devFeeWallet(env), keeperPubkey: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test((env.BURNTICKER_KEEPER_PUBKEY ?? "").trim()) ? (env.BURNTICKER_KEEPER_PUBKEY ?? "").trim() : null, platformId, stubs, market, kalshiEnabled: kalshiEnabled(env), polymarketDiscovery: polymarketDiscoveryEnabled(env),
    uploader: uploaderFromEnv(env, cluster), customImages: customImagesEnabled(env), allowHostedMetadata: allowHostedMetadata(env),
    pinDailyCap: /^\d+$/.test((env.BURNTICKER_PIN_DAILY_CAP ?? "").trim()) ? Number((env.BURNTICKER_PIN_DAILY_CAP ?? "").trim()) : undefined,
    // Review-2 F3: the verifier decodes initialize_token and reads the TokenConfig (and the Pair) — it needs the program ids it checks
    // against; without BURNTICKER_PROGRAM_ID it refuses every confirmation (fail closed).
    launchVerifier: rpc ? connectionLaunchVerifier(new Connection(rpc, "confirmed") as unknown as TxReader, { burnProgramId: programId || null, launchLabProgramId: LAUNCHLAB_PROGRAM_ID[cluster].toBase58(), pairCurveProgramId: PAIR_CURVE_PROGRAM_ID.toBase58() }) : null,
  };
  if (!rpc) stubs.push("launch confirmation: no BURNTICKER_RPC_URL on this host, so a launch transaction cannot be read and drafts are not taken live");
  else if (!programId) stubs.push("launch confirmation: no BURNTICKER_PROGRAM_ID on this host, so initialize_token and the TokenConfig cannot be checked and drafts are not taken live");
  return cached;
}

/** For tests: a platform over an in-memory registry and injected clients. */
export function setPlatformForTests(p: Platform | null): void { cached = p; }

/** Everything the token page needs, from the registry and the (fake or real) program. No odds are read (owner decision 2026-10-10). */
export async function tokenPageInput(p: Platform, t: TokenRow, now = Date.now(), opts: { live?: boolean } = {}): Promise<TokenPageInput> {
  const locked = p.registry.lockedRule(t);
  const readings = p.registry.readings(t.selectorKey, t.baselineAt).filter((r) => readingMatches(locked.rule, r));
  const state = p.registry.state(t.mint);
  const oracle = locked.rule.oracle === "catalogue" ? p.oracles.catalogue : locked.rule.oracle === "polymarket" ? p.oracles.polymarket : locked.rule.oracle === "derby" ? p.oracles.derby ?? derbyPageOracle : p.oracles.kalshi;
  // live: false (the receipts-only API route) skips the two oracle calls; the receipts do not depend on them. Venue display reads
  // (venues.ts): no market-implied chance for any coin (owner decision 2026-10-10); series titles from Kalshi only when enabled, from Polymarket only with discovery on.
  const isK = locked.rule.oracle === "kalshi", isP = locked.rule.oracle === "polymarket";
  const kOk = p.kalshiEnabled !== false, pOk = p.polymarketDiscovery !== false;
  const [implied, info] = opts.live === false ? ([null, null] as const) : await Promise.all([
    // No odds for any coin (owner decision 2026-10-10): no market-implied chance is read for Kalshi or Polymarket; Burn Derby's call only
    // gives the next window's close time (its chance is always null).
    locked.rule.oracle !== "derby" ? Promise.resolve(null) : oracle.impliedChance(locked.rule, state.lastValue).catch(() => null),
    locked.rule.oracle === "derby" ? Promise.resolve({ title: derbyTitle(locked.rule) }) : locked.rule.oracle === "catalogue" || (isK && !kOk) || (isP && !pOk) ? Promise.resolve(null) : oracle.seriesInfo(locked.rule.oracle === "polymarket" ? (locked.rule.market ?? locked.rule.series!) : locked.rule.series ?? locked.rule.market!.split("-")[0]).catch(() => null),
  ]);
  const feedState = p.registry.feedState(t.selectorKey);
  const feed = locked.rule.oracle === "catalogue" && locked.rule.series ? feedById(locked.rule.series) : null;
  const [supplyRaw, feePdaLamports, vaultRaw] = await Promise.all([p.program.supplyRaw(t.mint).catch(() => null), p.program.feePdaBalanceLamports(t.mint).catch(() => null), locked.mode === "vault" ? p.program.vaultBalanceRaw(t.mint).catch(() => null) : Promise.resolve(null)]);
  const market = p.market && opts.live !== false && t.status !== "draft" && t.status !== "expired"
    ? await readMarket(p.market, { cluster: p.cluster, mint: t.mint, poolId: t.poolId, feePda: t.feePda, creator: t.creator, totalSupplyRaw: supplyRaw ?? tokensToRaw(TOTAL_SUPPLY, DECIMALS), decimals: DECIMALS }, now).catch(() => null)
    : null;
  return {
    market,
    lp: await lpLockBlock(p.registry, p.program, p.cluster, t.mint),
    pair: await pairCounterpart(p, t),
    lifecycle: lifecycleFrom(p.registry, t, locked.rule, feePdaLamports),
    meta: p.registry.tokenMeta(t.mint),
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
  const clause = await pairClauseState(p.registry, pair, async (mint) => { try { return (await p.program.port(mint).config())?.poolRegistered ?? null; } catch { return null; } });
  // Winner takes the burn (API 1.10.0): the flag from this coin's locked rule, and every forward between the two coins.
  let winnerTakesBurn = false;
  try { winnerTakesBurn = pairWinnerTakesBurn(p.registry.lockedRule(t).rule); } catch { winnerTakesBurn = false; }
  return { pairId: pair.pairId, side, counterpart: { ticker: other.ticker, name: other.name, mint: other.mint, burns: confirmed.length, burned: rawToTokens(burnedRaw, DECIMALS), supply: rawToTokens(supplyRaw, DECIMALS), lastBurnAt: last?.settledAt ?? null }, clause, winnerTakesBurn, forwards: pairForwardsJson(p.registry, pair.pairId, other.cluster), unpaired: pairUnlinked(p.registry, pair.pairId), ...(await pairChainFields(p.program.pairForward ? (a, b) => p.program.pairForward!.port(a, b).links() : undefined, pair.mintA, pair.mintB, side)) };
}

export async function tokenPageData(p: Platform, t: TokenRow, now = Date.now(), opts: { live?: boolean } = {}): Promise<{ status: TokenStatusJson; receipts: ReceiptJson[]; readings: TokenPageInput["readings"]; rulesText: string; stubs: string[] }> {
  const input = await tokenPageInput(p, t, now, opts);
  const receipts = buildReceiptsJson(input);
  return { status: buildTokenStatus(input, receipts), receipts, readings: input.readings, rulesText: t.rulesJson, stubs: p.stubs };
}
