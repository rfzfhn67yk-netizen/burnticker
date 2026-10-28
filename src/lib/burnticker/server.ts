import "server-only";
import { readingsAfterLaunch } from "@/lib/burnticker/launchCut";
import { ruleSideName } from "@/lib/burnticker/coinCard";
import { coinLifecycleState } from "@/lib/burnticker/decidedWarning";
import type { MintBankPort } from "@/lib/burnticker/mintBank";
import { lpLockBlock } from "@/lib/burnticker/lpLockPage";
import { plannedNextCheckAt } from "@/lib/burnticker/readPlan";
import { connectionLaunchVerifier, type LaunchVerifier, type TxReader } from "@/lib/burnticker/launchVerify";
import { LAUNCHLAB_PROGRAM_ID, PAIR_CURVE_PROGRAM_ID } from "@/lib/burnReceipts/constants";
import { envGameDeps, polymarketGameReaders } from "@/lib/burnticker/sources/gameSettle";
import { statusPayoutStore } from "@/lib/burnticker/oracle/payoutStore";
import { allowHostedMetadata, customImagesEnabled, uploaderFromEnv, type PinUploader } from "@/lib/burnticker/pin";
import fs from "node:fs";
import path from "node:path";
import { openRegistry, readingMatches, REGISTRY_FILE, type Registry, type TokenMeta, type TokenRow } from "@/lib/burnticker/registry";
import { hasImageCopy, imageCopyHref } from "@/lib/burnticker/imageStore";
import { KalshiClient } from "@/lib/burnticker/oracle/kalshi";
import { PolymarketClient, type TitleRefuser } from "@/lib/burnticker/oracle/polymarket";
import { loadRefuseList, refusalsFor } from "@/lib/burnticker/oracle/refuse";
import { CatalogueAdapter, feedById } from "@/lib/burnticker/catalogue";
import { Connection, PublicKey } from "@solana/web3.js";
import { SOL_MINT, usdPrice } from "@/lib/burnKeeper/jupiterSwap";
import { FakeBurnProgram, programPageBlock, type BurnProgramClient } from "@/lib/burnticker/program";
import { readTwapEmpty } from "@/lib/burnticker/twapEmpty";
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
import { curveProgress, readCpmmMarket, readMarket, type CpmmReader, type MarketReader } from "@/lib/burnticker/market";
import { poolOwnerLabels, readHolders } from "@/lib/burnticker/holders";
import { readLifecycleDates } from "@/lib/burnticker/lifecycleDates";
import { jsonRpc } from "@/lib/burnticker/trustpack/receiptCheck";
import { rpcUrlFor } from "@/lib/burnticker/networks";
import { kalshiEnabled, polymarketDiscoveryEnabled } from "@/lib/burnticker/venues";
import { espnClient, nativeSourceById, setNativeClients } from "@/lib/burnticker/sources/native";
import type { SeasonSchedule } from "@/lib/burnticker/seasonOver";
import type { TeamSeasonReader } from "@/lib/burnticker/lastSeason";
import { coinDerbyScoreboard } from "@/lib/burnticker/derby/page";
import { derbyTitle, pinCreatorDailyCapFromEnv } from "@/lib/burnticker/api/handlers";
import { apiBudget, budgetedRpcConfig, configureApiBudget, rpcSourceFor, statusTableStore, WEB_RPC_READ_TIMEOUT_MS } from "@/lib/burnticker/apiBudget";
import { connectionBatchReader, type BatchReader, type MultipleAccountsReader } from "@/lib/burnticker/keeperReadCache";

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
  /** cheap-features items 2 and 5: one team's games for a season (the coin calendar and last season's count). Absent: nothing is read. */
  teamSeason?: TeamSeasonReader | null;
  /** BURNTICKER_KALSHI_ENABLED (venues.ts): false turns off every Kalshi-facing surface; undefined = on. */
  kalshiEnabled?: boolean;
  /** Burn Derby (2026-10-10): the fetch for cross-reads / Jupiter search (tests inject fixtures; production = global fetch). */
  derbyFetch?: FetchLike;
  /** Burn Derby: a read-only MAINNET account port (Pyth's Solana accounts, pools, mint supplies) — BURNTICKER_DERBY_RPC_URL, else the public RPC. */
  derbyPools?: PoolPort | null;
  /** Burn Derby: Hermes, only when BURNTICKER_PYTH_API_KEY is set (keyless price paths answer 401). */
  derbyHermes?: HermesClient | null;
  /** sources-7 (QA walkthrough 11 H6): a league's games for the next days (the review and the bundle refuse a season rule on a team whose season is over). Absent: nothing is read and nothing is refused. */
  seasonSchedule?: SeasonSchedule | null;
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
  /** audit 2026-10-15 H4: coins one creator wallet may pin per UTC day (BURNTICKER_PIN_CREATOR_DAILY_CAP; handlers.DEFAULT_PIN_CREATOR_DAILY_CAP) */
  pinCreatorDailyCap?: number;
  /** prelaunch audit 2026-10-18 A-3: uploads a day kept for wallet-signed launch requests (BURNTICKER_PIN_SIGNED_RESERVE; default 10) */
  pinSignedReserve?: number;
  /** BURNTICKER_ALLOW_MAINNET_LAUNCHES on a mainnet host (hostedLaunch.ts): the owner's explicit allowance; absent/false = mainnet launches refused. */
  allowMainnet?: boolean;
  /** Reads a launch transaction from the chain before a draft goes live (launchVerify.ts; review N1). Null/absent (no RPC): confirmations are refused. */
  launchVerifier?: LaunchVerifier | null;
  /**
   * 2026-10-14 night: the mint key bank the launch route takes burn-ending keys from (mintBank.ts). Absent (undefined): the route opens
   * the host's own bank from BURNTICKER_MINT_BANK_PATH / _KEY (webMintBank); null: no bank, every launch finds its address in the browser.
   */
  mintBank?: MintBankPort | null;
  /**
   * 2026-10-15 prelaunch audit M7: one getMultipleAccounts per 20 coins for the index and home rebuilds (webReadCache.ts). Null/absent
   * (no RPC or no program id): the per-coin reads run as before.
   */
  batchReader?: BatchReader | null;
}

let cached: Platform | null = null;
/** How long after the platform is built (the web's first request, the start-up warm call) the race index is read (audit 7 OP7-4). */
export const RACE_WARM_DELAY_MS = 30_000;
/** How long after the platform is built every live coin's page is read into the shared coin-page memo (audit 7 B-10). */
export const COIN_WARM_DELAY_MS = 15_000;

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
    program = new ProgramBurnClient({ connection: new Connection(rpc, budgetedRpcConfig({ commitment: "confirmed" }, { timeoutMs: WEB_RPC_READ_TIMEOUT_MS })), programId: new PublicKey(programId), cluster, payer: null, launchLabPlatform: (env.BURNTICKER_PLATFORM_ID ?? "").trim() ? new PublicKey((env.BURNTICKER_PLATFORM_ID ?? "").trim()) : null, admin: (env.BURNTICKER_ADMIN ?? "").trim() ? new PublicKey((env.BURNTICKER_ADMIN ?? "").trim()) : null, solUsd: async () => { const px = await usdPrice(SOL_MINT); if (px === null) throw new Error("SOL price unavailable (Jupiter price API)"); return px; } });
    stubs.push(`burn_receipts program ${programId}: read-only client (this host holds no key; the keeper signs readings and cranks)`);
  } else {
    program = new FakeBurnProgram(cluster);
    stubs.push(programId ? `burn_receipts program ${programId}: no BURNTICKER_RPC_URL on this host (FakeBurnProgram in use)` : "burn_receipts program: no program id wired on this host (FakeBurnProgram — PDAs are placeholders, nothing is sent); program deployment is on the trust page");
  }
  const platformId = (env.BURNTICKER_PLATFORM_ID ?? "").trim() || null;
  // launch-10 (2026-10-12): the real LaunchLab client on a host with an RPC, the program id and the platform id (launchLabChain.ts);
  // the fake elsewhere (tests, RPC-less hosts, BURNTICKER_LAUNCHLAB_CLIENT=fake). Mainnet launches stay refused unless the host sets
  // BURNTICKER_ALLOW_MAINNET_LAUNCHES (hostedLaunch.ts; prepareLaunch passes it to the builder as allowMainnet).
  const ll = launchLabFromEnv(env, { cluster, reader: rpc ? (new Connection(rpc, budgetedRpcConfig({ commitment: "confirmed" })) as unknown as LaunchLabAccountReader) : null });
  const launchLab = ll.client;
  stubs.push(ll.stub);
  const allowMainnet = cluster === "mainnet" && mainnetLaunchesAllowed(env);
  if (cluster === "mainnet" && !allowMainnet) stubs.push("mainnet launches: refused on this host (BURNTICKER_ALLOW_MAINNET_LAUNCHES is not set)");
  const kalshi = new KalshiClient();
  const polymarket = polymarketClient(env);
  // Bonding curve + top holders for the coin cards: read-only account reads over the same RPC (no key). Without one: "—" and the reason.
  // disableRetryOnRateLimit: a rate-limited RPC fails the read fast ("could not be read") instead of stalling every page on backoff.
  const market: MarketReader | null = rpc ? (new Connection(rpc, budgetedRpcConfig({ commitment: "confirmed" as const, disableRetryOnRateLimit: true }, { timeoutMs: WEB_RPC_READ_TIMEOUT_MS })) as unknown as MarketReader) : null;
  if (!rpc) stubs.push("LaunchLab curve progress and top holders: no BURNTICKER_RPC_URL on this host (cards show —)");
  if (!polymarketDiscoveryEnabled(env)) stubs.push("Polymarket discovery: off on this host (BURNTICKER_POLYMARKET_DISCOVERY_ENABLED=0); settlement reads the on-chain payout regardless");
  const registry = openRegistry((env.BURNTICKER_DB ?? "").trim() || REGISTRY_FILE);
  // THE REQUEST BUDGET (apiBudget.ts, 2026-10-13): the site's share of every provider's limit, its day counts in the registry's status
  // table (a restart keeps them), a bt-api-budget alert at 80% and at a hold. Enforced in production; counting only elsewhere (tests).
  configureApiBudget({ role: "web", store: statusTableStore(registry.db), enforce: process.env.NODE_ENV === "production", log: (s) => console.log(s),
    alert: (a) => { try { registry.recordAlert({ kind: a.kind, key: a.key, text: a.text, meta: a.meta }); } catch { /* an alert never stops a read */ } } });
  // Burn Derby (2026-10-10): Pyth / pools / supplies are MAINNET facts whatever cluster the coins live on — a read-only port, no key.
  const derbyPools = connectionPoolPort(new Connection((env.BURNTICKER_DERBY_RPC_URL ?? "").trim() || "https://api.mainnet-beta.solana.com", budgetedRpcConfig({ commitment: "confirmed" as const, disableRetryOnRateLimit: true })));
  const derbyHermes = (env.BURNTICKER_PYTH_API_KEY ?? "").trim() ? HermesClient.fromEnv(env) : null;
  const derby = new DerbyAdapter({ registry, hermes: derbyHermes, pools: derbyPools, fetchImpl: globalThis.fetch as unknown as FetchLike, now: () => Date.now() });
  // Team coins: games settle on their Polymarket on-chain payout where a moneyline market exists, else TheSportsDB (gameSettle.ts).
  // 2026-10-19 (the web's Polygon share held at 09:19 Denver): a reported payout vector is stored in the registry the first time any role
  // reads it and served from there; a game read on this host never waits on Polygon (nonBlocking: stored or held now, else "not read yet")
  polymarket.payoutStore = statusPayoutStore(registry, "web");
  setNativeClients({ games: { ...envGameDeps(env), ...(polymarketDiscoveryEnabled(env) ? polymarketGameReaders(polymarket, { nonBlocking: true }) : { market: null, payout: null }) } });
  cached = {
    registry, derbyPools, derbyHermes, seasonSchedule: (league, days) => espnClient().upcoming(league, days), teamSeason: (league, team, year) => espnClient().season(league, team, year),
    oracles: { kalshi, catalogue: new CatalogueAdapter(), polymarket, derby }, kalshi, polymarket, program, launchLab, cluster,
    publishDir: (env.BURNTICKER_PUBLISH_DIR ?? "").trim() || path.join("data", "burnticker-site"),
    allowMainnet, devFeeWallet: devFeeWallet(env), keeperPubkey: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test((env.BURNTICKER_KEEPER_PUBKEY ?? "").trim()) ? (env.BURNTICKER_KEEPER_PUBKEY ?? "").trim() : null, platformId, stubs, market, kalshiEnabled: kalshiEnabled(env), polymarketDiscovery: polymarketDiscoveryEnabled(env),
    uploader: uploaderFromEnv(env, cluster), customImages: customImagesEnabled(env), allowHostedMetadata: allowHostedMetadata(env),
    pinDailyCap: /^\d+$/.test((env.BURNTICKER_PIN_DAILY_CAP ?? "").trim()) ? Number((env.BURNTICKER_PIN_DAILY_CAP ?? "").trim()) : undefined,
    // the synthetic creator's devnet instance may raise this (BURNTICKER_DEVNET_PIN_CREATOR_DAILY_CAP); ignored on mainnet
    pinCreatorDailyCap: pinCreatorDailyCapFromEnv(env),
    pinSignedReserve: /^\d+$/.test((env.BURNTICKER_PIN_SIGNED_RESERVE ?? "").trim()) ? Number((env.BURNTICKER_PIN_SIGNED_RESERVE ?? "").trim()) : undefined,
    // Review-2 F3: the verifier decodes initialize_token and reads the TokenConfig (and the Pair) — it needs the program ids it checks
    // against; without BURNTICKER_PROGRAM_ID it refuses every confirmation (fail closed).
    // C2 (2026-10-15 prelaunch audit): the verifier reads in the "confirm" lane, so anonymous traffic cannot spend what a confirmation needs
    batchReader: rpc && programId && program instanceof ProgramBurnClient ? connectionBatchReader(new Connection(rpc, budgetedRpcConfig({ commitment: "confirmed" as const, disableRetryOnRateLimit: true }, { timeoutMs: WEB_RPC_READ_TIMEOUT_MS })) as unknown as MultipleAccountsReader, new PublicKey(programId), (m) => program.vaultFor(m)) : null,
    launchVerifier: rpc ? connectionLaunchVerifier(new Connection(rpc, budgetedRpcConfig({ commitment: "confirmed" }, { lane: "confirm" })) as unknown as TxReader, { burnProgramId: programId || null, launchLabProgramId: LAUNCHLAB_PROGRAM_ID[cluster].toBase58(), pairCurveProgramId: PAIR_CURVE_PROGRAM_ID.toBase58(), busy: () => apiBudget().laneBusy(rpcSourceFor(rpc), "confirm") }) : null,
  };
  if (!rpc) stubs.push("launch confirmation: no BURNTICKER_RPC_URL on this host, so a launch transaction cannot be read and drafts are not taken live");
  else if (!programId) stubs.push("launch confirmation: no BURNTICKER_PROGRAM_ID on this host, so initialize_token and the TokenConfig cannot be checked and drafts are not taken live");
  // HB-97 (hourly run 7): the sample receipts' verdicts are checked once when the web server builds its platform (its first request after
  // start), in the background, so the apex page's "Inspect the devnet receipt" answers from the kept verdict
  if (env.NODE_ENV === "production" && env.BURNTICKER_WARM_RECEIPTS !== "0") setTimeout(() => { void import("@/lib/burnticker/trustpack/api").then((m) => m.warmSampleReceipts()).catch(() => null); }, 0).unref?.();
  // audit 7 OP7-4 (2026-10-20): the search's race index (19 Gamma pages, about 5 s through the client's one request queue) is read once
  // RACE_WARM_DELAY_MS after the platform is built, so the first wizard search after a deploy does not wait for it. The delay keeps it
  // behind the home and coins warm builds, whose polymarket coins share that queue.
  // audit 7 B-10: every live coin's full page read into the shared coin-page memo (coinPageMemo.ts warmCoinPages), so the first creator
  // page after a deploy lists each coin with its details instead of "Still loading this coin"
  if (env.NODE_ENV === "production" && env.BURNTICKER_WARM_COIN_PAGES !== "0") { const p = cached; setTimeout(() => { void import("@/lib/burnticker/coinPageMemo").then((m) => m.warmCoinPages(p)).catch(() => null); }, COIN_WARM_DELAY_MS).unref?.(); }
  if (env.NODE_ENV === "production" && env.BURNTICKER_WARM_RACES !== "0") { const p = cached; setTimeout(() => { void import("@/lib/burnticker/api/handlers").then((m) => m.warmRaces(p)).catch(() => null); }, RACE_WARM_DELAY_MS).unref?.(); }
  return cached;
}

/** Whether the operator took a creator's image down (config/burnticker/image-takedowns.json `mints`); false when the file is unreadable. */
/**
 * 2026-10-27: the coin's launch pins and, when the registry's recorded image hash has a file in this host's image directory
 * (imageStore.ts), the same-origin address of that copy. One cheap existence check per coin read, memoised in the store.
 */
function metaAndMirror(registry: Pick<Registry, "tokenMeta">, mint: string): { meta: TokenMeta | null; imageMirror: string | null } {
  const meta = registry.tokenMeta(mint);
  return { meta, imageMirror: meta?.imageSha256 && hasImageCopy(meta.imageSha256) ? imageCopyHref(mint) : null };
}

export function imageTakenDown(mint: string, root = process.cwd()): boolean {
  try { return ((JSON.parse(fs.readFileSync(path.join(root, "config", "burnticker", "image-takedowns.json"), "utf8")) as { mints?: unknown[] }).mints ?? []).includes(mint); }
  catch { return false; }
}

/** For tests: a platform over an in-memory registry and injected clients. */
export function setPlatformForTests(p: Platform | null): void { cached = p; }

/**
 * `lite` (2026-10-15, the home's coin list): the reads the home renders, and only those, run at once instead of one phase after another.
 * Skipped, because no home consumer reads them (homeRow.ts homeRowOf: homeCoinOf, eventsFromStatus, upcomingFromStatus, readinessFromStatus and the
 * featured-slot input; homeData takes only the index's totals and audit): the graduated pool's market cap (cpmm; the home's market cap is
 * the curve's), the burn-pool and vault balances (status.pool and the lifecycle line), the LP lock block (status.lp falls back to the
 * policy alone) and the pair counterpart (status.pair). Kept, because the home renders them: the series title (the next-result row), the
 * supply and the curve (progress, raised, market cap, phase), the program block (last reading, pool registration), the holder count and
 * the lifecycle dates (the created date and the dated graduation and pool rows). The coin page never passes `lite`.
 */
export type TokenPageOpts = { live?: boolean; lite?: boolean };

/** Everything the token page needs, from the registry and the (fake or real) program. No odds are read (owner decision 2026-10-10). */
export async function tokenPageInput(p: Platform, t: TokenRow, now = Date.now(), opts: TokenPageOpts = {}): Promise<TokenPageInput> {
  const locked = p.registry.lockedRule(t);
  const readings = readingsAfterLaunch(p.registry, t.selectorKey, t.baselineAt).filter((r) => readingMatches(locked.rule, r));
  const state = p.registry.state(t.mint);
  const oracle = locked.rule.oracle === "catalogue" ? p.oracles.catalogue : locked.rule.oracle === "polymarket" ? p.oracles.polymarket : locked.rule.oracle === "derby" ? p.oracles.derby ?? derbyPageOracle : p.oracles.kalshi;
  // live: false (the receipts-only API route) skips the two oracle calls; the receipts do not depend on them. Venue display reads
  // (venues.ts): no market-implied chance for any coin (owner decision 2026-10-10); series titles from Kalshi only when enabled, from Polymarket only with discovery on.
  const isK = locked.rule.oracle === "kalshi", isP = locked.rule.oracle === "polymarket";
  const kOk = p.kalshiEnabled !== false, pOk = p.polymarketDiscovery !== false;
  const lite = opts.lite === true;
  const impliedInfo = () => opts.live === false ? Promise.resolve([null, null] as const) : Promise.all([
    // No odds for any coin (owner decision 2026-10-10): no market-implied chance is read for Kalshi or Polymarket; Burn Derby's call only
    // gives the next window's close time (its chance is always null).
    locked.rule.oracle !== "derby" ? Promise.resolve(null) : oracle.impliedChance(locked.rule, state.lastValue).catch(() => null),
    locked.rule.oracle === "derby" ? Promise.resolve({ title: derbyTitle(locked.rule) }) : locked.rule.oracle === "catalogue" || (isK && !kOk) || (isP && !pOk) ? Promise.resolve(null) : oracle.seriesInfo(locked.rule.oracle === "polymarket" ? (locked.rule.market ?? locked.rule.series!) : locked.rule.series ?? locked.rule.market!.split("-")[0]).catch(() => null),
  ]);
  const feedState = p.registry.feedState(t.selectorKey);
  // HB-28 / HB-29: the next read the page prints is one the keeper plans for THIS coin: none once its rule ended or its own one-shot
  // result is recorded (readPlan.ts selectorIdle on the coin alone; a stale next_fetch_at is not a next read), else the stored one
  const nextCheckAt = plannedNextCheckAt(p.registry, t.selectorKey, [t], feedState.nextFetchAt);
  const feed = locked.rule.oracle === "catalogue" && locked.rule.series ? feedById(locked.rule.series) : null;
  const live = !!p.market && opts.live !== false && t.status !== "draft" && t.status !== "expired";
  const network = p.cluster === "localnet" ? null : p.cluster;
  const rpc = live && network ? jsonRpc(rpcUrlFor(network)) : null;
  const supplyRead = () => p.program.supplyRaw(t.mint).catch(() => null);
  const marketRead = (supplyRaw: bigint | null) => live && p.market
    ? readMarket(p.market, { cluster: p.cluster, mint: t.mint, poolId: t.poolId, feePda: t.feePda, creator: t.creator, totalSupplyRaw: supplyRaw ?? tokensToRaw(TOTAL_SUPPLY, DECIMALS), decimals: DECIMALS }, now).catch(() => null)
    : Promise.resolve(null);
  const programRead = () => programPageBlock(p.program, t.mint, p.registry.lastProgramTx(t.mint, "reading"), undefined, readTwapEmpty(p.registry, t.mint));
  const holdersRead = () => rpc ? readHolders(rpc, { cluster: p.cluster, mint: t.mint, labels: { ...poolOwnerLabels(p.cluster), [t.feePda]: "burn pool", [t.creator]: "creator" } }, now) : Promise.resolve(null);
  const datesRead = (market: Awaited<ReturnType<typeof marketRead>>, poolRegistered: boolean | null) => rpc && network ? readLifecycleDates(rpc, { network, mint: t.mint, launchTx: t.launchTx, curvePool: t.poolId, phase: market?.pool && t.poolId ? curveProgress(market.pool, t.poolId).phase : null, poolRegistered }, now) : Promise.resolve(null);
  const registeredOf = (b: Awaited<ReturnType<typeof programRead>>) => (b?.config ? !!b.config.poolRegistered : null);
  // 2026-10-15 prelaunch audit M7: a draft (never signed) or an expired draft has nothing on chain worth reading: no supply, no fee pool,
  // no TokenConfig, no LP lock, no pair side. The index and the home rebuild every 15 s and read each such row from the chain anyway
  // (12 drafts + 5 expired against 6 live coins that day, and the set only grows). Its page is built from the registry alone.
  if (t.status === "draft" || t.status === "expired") {
    const [implied, info] = await impliedInfo();
    return {
      market: null, cpmm: null, holders: null, dates: null, stated: info && "stated" in info && info.stated ? info.stated : null, pair: null,
      lifecycle: lifecycleFrom(p.registry, t, locked.rule, null), ...metaAndMirror(p.registry, t.mint),
      token: t, locked, readings, receipts: p.registry.receipts(t.mint), attesters: p.registry.attesters(t.mint), state, feedState,
      chain: { cluster: p.cluster, programId: p.program.programId, supplyRaw: null, feePdaLamports: null, vaultRaw: null, program: null },
      now, nextCheckAt, implied, seriesTitle: info?.title ?? feed?.title ?? (locked.rule.oracle === "catalogue" && locked.rule.series ? nativeSourceById(locked.rule.series)?.title ?? null : null), selectorPending: 0,
      operator: operatorPowersSummary(loadPowersRegister()),
    };
  }
  if (lite) {
    // the home's reads at once: supply then curve then dates on one path, the program block, the holders and the series title beside it
    const programP = programRead();
    const marketP = supplyRead().then(async (supplyRaw) => ({ supplyRaw, market: await marketRead(supplyRaw) }));
    const [[implied, info], { supplyRaw, market }, programBlock, holders] = await Promise.all([impliedInfo(), marketP, programP, holdersRead()]);
    const dates = await datesRead(market, registeredOf(programBlock));
    return {
      market, cpmm: null, holders, dates, stated: info && "stated" in info && info.stated ? info.stated : null, pair: null,
      lifecycle: lifecycleFrom(p.registry, t, locked.rule, null), ...metaAndMirror(p.registry, t.mint),
      token: t, locked, readings, receipts: p.registry.receipts(t.mint), attesters: p.registry.attesters(t.mint), state, feedState,
      chain: { cluster: p.cluster, programId: p.program.programId, supplyRaw, feePdaLamports: null, vaultRaw: null, program: programBlock },
      now, nextCheckAt, implied, seriesTitle: info?.title ?? feed?.title ?? (locked.rule.oracle === "catalogue" && locked.rule.series ? nativeSourceById(locked.rule.series)?.title ?? null : null), selectorPending: 0,
      operator: operatorPowersSummary(loadPowersRegister()),
    };
  }
  // continuous audit HB-35 (pair page "Loading" for 8 s, pair badge 5 s): the reads that do not depend on one another start together. The
  // oracle info, the supply and pool balances, the program block, the LP lock and the pair counterpart were five phases one after another.
  const programP = programRead(), lpP = lpLockBlock(p.registry, p.program, p.cluster, t.mint), pairP = pairCounterpart(p, t);
  // an early failure is still thrown where it was awaited before; these handlers only keep it from being reported as unhandled meanwhile
  for (const x of [programP, lpP, pairP] as Promise<unknown>[]) x.catch(() => {});
  const [[implied, info], [supplyRaw, feePdaLamports, vaultRaw]] = await Promise.all([impliedInfo(), Promise.all([supplyRead(), p.program.feePdaBalanceLamports(t.mint).catch(() => null), locked.mode === "vault" ? p.program.vaultBalanceRaw(t.mint).catch(() => null) : Promise.resolve(null)])]);
  const [market, programBlock] = await Promise.all([marketRead(supplyRaw), programP]);
  // indexer-1 (WIRING.md step 1): the graduated pool's market cap, the holder count and the lifecycle dates, read on chain; each read
  // returns its own "unavailable" reason, never a guess
  const poolRegistered = registeredOf(programBlock);
  const poolAddress = programBlock?.config?.pool ?? null;
  const [cpmm, holders, dates] = await Promise.all([
    live && p.market && poolRegistered && poolAddress ? readCpmmMarket(p.market as unknown as CpmmReader, { cluster: p.cluster, mint: t.mint, poolId: poolAddress }, now) : Promise.resolve(null),
    holdersRead(),
    datesRead(market, poolRegistered),
  ]);
  return {
    market, cpmm, holders, dates,
    // sources-2 (WIRING-SOURCES.md section 2): a one-market Polymarket coin's stated source and dispute window, from the same Gamma read
    stated: info && "stated" in info && info.stated ? info.stated : null,
    lp: await lpP,
    pair: await pairP,
    lifecycle: lifecycleFrom(p.registry, t, locked.rule, feePdaLamports),
    ...metaAndMirror(p.registry, t.mint),
    token: t, locked, readings, receipts: p.registry.receipts(t.mint), attesters: p.registry.attesters(t.mint), state, feedState,
    chain: { cluster: p.cluster, programId: p.program.programId, supplyRaw, feePdaLamports, vaultRaw, program: programBlock },
    now, nextCheckAt, implied, seriesTitle: info?.title ?? feed?.title ?? (locked.rule.oracle === "catalogue" && locked.rule.series ? nativeSourceById(locked.rule.series)?.title ?? null : null), selectorPending: 0,
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
  // continuous audit run 2, HB-22 / HS-1: the other side's name from its own locked rule, so the losing side's warning can name the winner
  let otherSideName: string | null = null;
  try { otherSideName = ruleSideName(p.registry.lockedRule(other).rule); } catch { otherSideName = null; }
  return { pairId: pair.pairId, side, counterpart: { ticker: other.ticker, name: other.name, mint: other.mint, burns: confirmed.length, burned: rawToTokens(burnedRaw, DECIMALS), supply: rawToTokens(supplyRaw, DECIMALS), lastBurnAt: last?.settledAt ?? null, sideName: otherSideName }, clause, winnerTakesBurn, forwards: pairForwardsJson(p.registry, pair.pairId, other.cluster), unpaired: pairUnlinked(p.registry, pair.pairId), ...(await pairChainFields(p.program.pairForward ? (a, b) => p.program.pairForward!.port(a, b).links() : undefined, pair.mintA, pair.mintB, side)) };
}

export async function tokenPageData(p: Platform, t: TokenRow, now = Date.now(), opts: TokenPageOpts = {}): Promise<{ status: TokenStatusJson; receipts: ReceiptJson[]; readings: TokenPageInput["readings"]; rulesText: string; stubs: string[] }> {
  const input = await tokenPageInput(p, t, now, opts);
  const receipts = buildReceiptsJson(input);
  const status = buildTokenStatus(input, receipts);
  // HB-25 residue (hourly run 8): beside the registry row state, what the coin is doing now (the decided line the cards use)
  status.lifecycleState = coinLifecycleState(status, receipts);
  // cheap-features item 12: a Coin vs Coin coin carries its pair's live scoreboard (registry only, no chain read)
  if (t.selectorKey.startsWith("derby:")) status.derbyScoreboard = coinDerbyScoreboard(p.registry, t.mint, now);
  // website-15 item 13: an image taken down on request (config/burnticker/image-takedowns.json) is no longer shown; the receipt art is
  if (status.profile && imageTakenDown(t.mint)) status.profile = { ...status.profile, imageUrl: null };
  return { status, receipts, readings: input.readings, rulesText: t.rulesJson, stubs: p.stubs };
}

/** The web server's request budget, configured with its registry store (platform() does it once); routes that read a provider call this first. */
export function ensureWebApiBudget(): void { try { platform(); } catch { /* the default budget (enforcing in production, in memory) still applies */ } }
