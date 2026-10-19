// THE BURNTICKER MULTI-TOKEN KEEPER (2026-10-09) — one loop over every live token in data/burnticker.db: read each selector's settled
// results on its schedule, plan receipts with the published rule, run them through the burn_receipts program (attest each closed
// day's unit counter, claim creator fees best-effort, crank, record the program's facts), publish every token's status.json + page
// and the platform index. THIS FILE HOLDS NO KEY: with BURNTICKER_PROGRAM_ID + BURNTICKER_RPC_URL the keeper's own encrypted key is
// read once from BURNTICKER_SIGNER_PATH (it pays fees and signs readings as the attester; it holds no funds) and the real
// ProgramBurnClient is used; without them the chain is the FakeBurnProgram (nothing is sent; the pages say so). Mainnet is refused
// unless BURNTICKER_MAINNET=1. No environment file is read or printed by this script.
//
// LP LOCKED FOREVER (owner decision 2026-10-10): every cycle, per coin and AHEAD of the buyback cranks, the keeper runs the permissionless
// register_fee_key (once per mint) and claim_lock_fees (when the locked LP has accrued fees) — src/lib/burnticker/lockFeesKeeper.ts over
// the program client's lockFees port (lockFeesChain.ts; the FakeBurnProgram's in-memory lock without a deployment). Each claim is a receipt
// line "LP fees claimed: X SOL → 80% burn pool / 20% operator; coin side burned" in the registry (lock_fee_claims), the coin's
// status.json (lp.lastClaim) and the daily post; a refusal, a Fee Key held elsewhere, an unpinned operator treasury or a split that is
// not the compiled 80/20 raises an alert.
//
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/alias-hook.mjs scripts/burnticker-keeper.mts [--once] [--dry-run]
//
//   BURNTICKER_DB (data/burnticker.db) · BURNTICKER_PUBLISH_DIR (data/burnticker-site) · BURNTICKER_KEEPER_PUBKEY (the attester's
//   public key, recorded on readings) · BURNTICKER_CLUSTER (devnet) · data/PAUSE-burnticker holds cranks (reading and publishing go on)
//
// OPERATIONS (2026-10-09, the ops layer; docs/burnticker/runbook.md): every cycle the keeper also (a) rewrites
// data/own-tokens.generated.json when the registry's token set changed — the arms' refuse list for platform coins (src/lib/ownTokens.ts
// merges it with config/own-tokens.json; the arms never open this database), and (b) every ALERT_EVERY_MS runs the ops alert check
// (src/lib/burnticker/alerts.ts → the registry's alerts table, then the operator's alert webhook): feed stalls, refused readings, cranks failing
// 3× in a row, audit mismatches, the keeper key under 0.05 SOL, the pre-audit cap binding, a daily one-line summary. Balances come
// from BURNTICKER_RPC_URL (plain getBalance on BURNTICKER_KEEPER_PUBKEY and BURNTICKER_FEE_WALLET, public keys); without it they
// are "unknown", never a false alarm. --once skips the alert check unless --alerts is given (a smoke run must not page the owner).
import fs from "node:fs";
import path from "node:path";
import { openRegistry, REGISTRY_FILE, readingMatches } from "../src/lib/burnticker/registry.ts";
import { KalshiClient } from "../src/lib/burnticker/oracle/kalshi.ts";
import { PolymarketClient } from "../src/lib/burnticker/oracle/polymarket.ts";
import { statusPayoutStore } from "../src/lib/burnticker/oracle/payoutStore.ts";
import { loadRefuseList, refusalsFor } from "../src/lib/burnticker/oracle/refuse.ts";
import { CatalogueAdapter, feedById } from "../src/lib/burnticker/catalogue/index.ts";
import os from "node:os";
import { Connection, PublicKey } from "@solana/web3.js";
import { FakeBurnProgram, type BurnProgramClient } from "../src/lib/burnticker/program.ts";
import { ProgramBurnClient } from "../src/lib/burnticker/programClient.ts";
import { clusterOfGenesis } from "../src/lib/burnKeeper/solana.ts";
import { SOL_MINT, usdPrice } from "../src/lib/burnKeeper/jupiterSwap.ts";
import type { KeeperDeps } from "../src/lib/burnticker/multiKeeper.ts";
import { expectedHostOf } from "../src/lib/burnticker/admission.ts";
import { cosignerFromEnv } from "../src/lib/burnticker/attesters/cosign.ts";
import { buildReceiptsJson, buildTokenStatus, lifecycleFrom, publishPlatformIndex, publishTokenSite, type TokenStatusJson } from "../src/lib/burnticker/tokenPage.ts";
import { testCoinKeys } from "../src/lib/burnticker/testCoins.ts";
import { loadPowersRegister, operatorPowersSummary, readAudit } from "../src/lib/burnticker/trust.ts";
import { CrankFailureTracker, devFeeDelta, recordBalanceSample, registryAlertRows, registryAlertSink, rpcBalanceLamports, runBurntickerAlertCheck, sinkFromEnv } from "../src/lib/burnticker/alerts.ts";
import { buildOpsJson, publishOps } from "../src/lib/burnticker/checkin.ts";
import { activeConditions, CONDITIONS_KEY, foldConditions, readConditionMemory } from "../src/lib/burnticker/ops/conditions.ts";
import { writeOwnTokensGenerated } from "../src/lib/burnticker/ownTokensSync.ts";
import type { MarketReader } from "../src/lib/burnticker/market.ts";
import { espnClient, gameDeps, nativeSourceById, setNativeClients } from "../src/lib/burnticker/sources/native.ts";
import { polyGameGate } from "../src/lib/burnticker/sources/polyGame.ts";
import { envGameDeps, polymarketGameReaders, singleSourceAlert, statusFirstReadStore, statusHoldStore } from "../src/lib/burnticker/sources/gameSettle.ts";
import { kalshiEnabled, polymarketDiscoveryEnabled } from "../src/lib/burnticker/venues.ts";
import { crankPairCurves, pairCurveEnabled, PAIR_CURVE_FLAG, PairScanCache } from "../src/lib/burnKeeper/pairCurveCrank.ts";
import { CycleAccountCache } from "../src/lib/burnticker/cycleAccountCache.ts";
import { reconcileDrafts, withSignerReads, type DraftChainReader } from "../src/lib/burnticker/draftReconciler.ts";
import { connectionLaunchVerifier, type TxReader } from "../src/lib/burnticker/launchVerify.ts";
import { LAUNCHLAB_PROGRAM_ID, PAIR_CURVE_PROGRAM_ID } from "../src/lib/burnReceipts/constants.ts";
import { onPrivateSend } from "../src/lib/burnKeeper/privateSend.ts";
import { freshReadKeys } from "../src/lib/burnticker/cycleAccountCache.ts";
import type { Keypair } from "@solana/web3.js";
import { DerbyAdapter } from "../src/lib/burnticker/derby/adapter.ts";
import { HermesClient } from "../src/lib/burnticker/derby/pyth.ts";
import { connectionPoolPort } from "../src/lib/burnticker/derby/pools.ts";
import type { FetchLike } from "../src/lib/burnticker/oracle/types.ts";
// TRUST OPS (2026-10-10 night): leader/standby role + the foreign-reading fence, feed health, the daily Arweave snapshot, status/status.json.
import { KeeperOps } from "../src/lib/burnticker/ops/keeperOps.ts";
import { uploaderFromEnv } from "../src/lib/burnticker/pin.ts";
// PHONE PUSH (polish-1, 2026-10-12): the five states that matter, rate-limited, plus a daily line (BURNTICKER_PUSH_URL / _TOKEN; unset = off).
import { pushConfigFromEnv, pushKeeperRefused, runPushCheck } from "../src/lib/burnticker/push.ts";
import { Heartbeat, heartbeatUrlFromEnv, heartbeatVerdict } from "../src/lib/burnticker/ops/heartbeat.ts";
import { offboxPullFact, readBackupStatus, readOffboxPull, readWebProbeStatus, runUnitCheck, webProbeFact } from "../src/lib/burnticker/ops/unitHealth.ts";
import { siteKeysOf } from "../src/lib/burnticker/coinKey.ts";
// PROGRAM HASH CHECK (prelaunch audit 2026-10-18 A-4): once a Denver day, the burn program's bytes on chain against verified-build.json
import { compareProgramToRecord, hostProgramRound, programHashFact, programHashSourceLine, readProgramDataHash, webDispersal, writeKeeperDispersal } from "../src/lib/burnticker/programHash.ts";
import { denverDate } from "../src/lib/burnticker/alerts.ts";
// NEVER-BUYS MONITOR (prelaunch audit 2026-10-18 A-6): the keeper runs it once a day
import { evidenceSignatures, NEVER_BUYS_FILE, neverBuysExceptions, neverBuysMints, runNeverBuys } from "../src/lib/burnticker/trustpack/neverBuys.ts";
import { loadOperator } from "../src/lib/burnticker/trustpack/operator.ts";
import { jsonRpc } from "../src/lib/burnticker/trustpack/receiptCheck.ts";
import { publishSite, toJson } from "../src/lib/burnKeeper/statusPage.ts";
// BURN DISPERSAL (owner decision 2026-10-13): carried amounts are spent in crank_carried pieces. Round 5 (crank_carried) is deployed, so
// on a real program with crank_carried the keeper refuses to start unless BURNTICKER_DISPERSAL is 1 (the unit sets it) or 0 on purpose
// (prelaunch audit 2026-10-18 A-1; dispersal.ts keeperDispersalStart).
import { DEFICIT_DISPERSAL_NAME, dispersalHostLine, keeperDispersalStart, type DispersalDecision } from "../src/lib/burnticker/dispersal.ts";
import { cachedMarketReader, cachedPublishProgram, coinChainReads, connectionBatchReader, KeeperReadCache, signatureFingerprints, withLockFees, type BatchReader, type MultipleAccountsReader } from "../src/lib/burnticker/keeperReadCache.ts";
import { clearStaleRestartRequest, takeRestartRequest } from "../src/lib/burnticker/restartRequest.ts";
import { writeKeeperRelease } from "../src/lib/burnticker/releaseManifest.ts";
import { budgetStatusLines, budgetTopMethodLines, budgetedRpcConfig, configureApiBudget, publicRpcFor, retryThroughBudgetHold, setDescribeFallback, statusTableStore, verifyRpcFallback, withEssential } from "../src/lib/burnticker/apiBudget.ts";

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const log = (s: string) => console.log(`[${new Date().toISOString().replace("T", " ").slice(0, 19)}Z] ${s}`);
const ONCE = flag("once"), DRY = flag("dry-run");
// review 6 of A-1: a run by hand (--once or --dry-run) never pushes a start refusal to the owner's phone; it prints it and exits 1
const HAND_RUN = ONCE || DRY;
const ALERTS = !ONCE || flag("alerts");
const ALERT_EVERY_MS = 5 * 60_000;
const DB = process.env.BURNTICKER_DB?.trim() || REGISTRY_FILE;
const SITE = process.env.BURNTICKER_PUBLISH_DIR?.trim() || path.join("data", "burnticker-site");
const PAUSE = path.join("data", "PAUSE-burnticker");
const cluster = process.env.BURNTICKER_CLUSTER?.trim() === "mainnet" ? "mainnet" : "devnet";
const attester = process.env.BURNTICKER_KEEPER_PUBKEY?.trim() || "unset";
const RPC = process.env.BURNTICKER_RPC_URL?.trim() || null;
const FEE_WALLET = process.env.BURNTICKER_FEE_WALLET?.trim() || null;
const isPubkey = (s: string | null): s is string => !!s && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
// HOLD FALLBACK (2026-10-15): while the keyed RPC's day budget is spent, reads go to the public RPC of the cluster the KEYED RPC's genesis
// names (its own small budget), and only after that endpoint's genesis matched the keyed one at startup (review item 1). Calls that build
// or confirm a send never move (apiBudget.ts NO_FALLBACK), and a cycle that starts on a held day runs with its sends held (review item 2):
// the fallback keeps the pages and the plan current; it settles nothing. BURNTICKER_RPC_FALLBACK_URL overrides the endpoint; "off" disables.
const FALLBACK_ENV = process.env.BURNTICKER_RPC_FALLBACK_URL?.trim() || "";
let fallbackUrl: string | null = null;
// re-review N3: the endpoint to verify, the keyed genesis to verify it against, and when it was last tried (retried on the first hold and
// hourly while unverified, so a 429 or a timeout at startup does not leave a held day without its fallback)
let fallbackCandidate: string | null = null, keyedGenesis: string | null = null, fallbackTriedAt = 0;
async function verifyFallbackNow(why: string): Promise<void> {
  if (!fallbackCandidate || !keyedGenesis) return;
  fallbackTriedAt = Date.now();
  fallbackUrl = await verifyRpcFallback(fallbackCandidate, keyedGenesis, { log });
  budget.setFallback("helius", fallbackUrl ? `the public Solana RPC (${new URL(fallbackUrl).hostname})` : null);
  if (fallbackUrl && why !== "startup") log(`  [api-budget] hold fallback ${new URL(fallbackUrl).hostname} verified (${why}): a held day's reads go there`);
}
const RPC_FALLBACK = { fallbackUrl: () => fallbackUrl };
let stopping = false;
const KEEPER_STARTED_AT = Date.now();
for (const s of ["SIGTERM", "SIGINT"] as const) process.on(s, () => { stopping = true; log(`${s}: finishing the current cycle`); });
// DEPLOY-REQUESTED RESTART (restartRequest.ts): a request already on disk was written before this process started, i.e. after the deploy
// swapped the code in, so this process already runs it: removed, never honoured. A dry run never takes or removes a request.
if (!DRY) { const stale = clearStaleRestartRequest("keeper"); if (stale) log(`  stale restart request (build ${stale.build}) removed: this process started after it and already runs the deployed code`); }
// I-13 (audit 2026-10-19): the release this process runs (its tree's release.json), for GET /api/burnticker/build; never blocks a start
if (!DRY) { try { const r = writeKeeperRelease(SITE, process.cwd(), KEEPER_STARTED_AT); log(`  release: public tree ${r.publicTreeSha256 ? `${r.publicTreeSha256.slice(0, 16)}…` : "not recorded"}${r.publicCommit ? `, public commit ${r.publicCommit.slice(0, 12)}` : ""}`); } catch (e) { log(`  release record not written: ${(e as Error).message.slice(0, 120)}`); } }
/** A new request during the startup wait ends the wait (exit 0, systemd starts the newer code). */
const restartAskedDuringStartup = (): boolean => {
  if (DRY) return false;
  const r = takeRestartRequest("keeper", { startedAt: KEEPER_STARTED_AT });
  if (r) { log(`restart requested by deploy ${r.build} during the startup wait: exiting; systemd starts the new code`); stopping = true; }
  return !!r;
};

const registry = openRegistry(DB);
// THE REQUEST BUDGET (src/lib/burnticker/apiBudget.ts, docs/burnticker/API-BUDGETS.md; owner 2026-10-13): every provider read waits for
// its bucket and counts against the keeper's share of the day (the count lives in the registry's status table, so a restart keeps it);
// a spent day puts that provider on hold until midnight UTC, logged once, with a bt-api-budget alert (and one at 80%).
const budget = configureApiBudget({ role: "keeper", store: statusTableStore(registry.db), log,
  alert: (a) => { if (registry.recordAlert({ kind: a.kind, key: a.key, text: a.text, meta: a.meta })) log(`  [alert] ${a.kind}: ${a.text.slice(0, 160)}`); } });
process.on("exit", () => { try { budget.flush(); } catch { /* closing */ } });
budget.setPhase("startup");
const kalshi = new KalshiClient();
// Polymarket (2026-10-10): Gamma for discovery, the Polygon CTF payout vector for results; the refuse list over every market question.
const polygonRpcs = (process.env.BURNTICKER_POLYGON_RPC_URLS ?? "").split(",").map((x) => x.trim()).filter((x) => /^https:\/\//.test(x));
const polymarket = new PolymarketClient({ refuse: (titles) => [...new Set(refusalsFor(loadRefuseList(), { titles }).map((r) => r.reason))], ...(polygonRpcs.length ? { rpcUrls: polygonRpcs } : {}) });
// 2026-10-19: a reported payout vector is stored in the registry the first time any role reads it (oracle/payoutStore.ts), so neither the
// keeper nor the site reads a final vector from Polygon twice, across restarts
polymarket.payoutStore = statusPayoutStore(registry, "keeper");
// team coins: each game settles on its on-chain payout where a moneyline market exists, else TheSportsDB (commercial); never ESPN
// ONE SOURCE (owner 2026-10-14): a final game with no Polymarket market and no league feed settles on TheSportsDB alone after its score
// has stood 12 hours. The first-seen score and time persist in the registry's status table (statusHoldStore), so a restart keeps the
// hold. Measure only: each such settlement is logged, and the first one per coin raises bt-single-source (push.ts) for the owner.
// GAME COINS (owner 2026-10-16, 2026-10-18 evening): a single-game coin burns once two sources agree on its final, else once one source
// has shown the same final on two reads a few minutes apart; each source's reads persist in the status table (statusFirstReadStore,
// games.firstReads), so a restart keeps them and a pair's two coins share them.
setNativeClients({ games: { ...envGameDeps(process.env), ...polymarketGameReaders(polymarket), holds: statusHoldStore(registry), firstReads: statusFirstReadStore(registry), now: () => Date.now(),
  onSingleSource: (e) => {
    log(`  [single-source] ${e.seriesId ?? "?"} ${e.game.name} ${e.game.date}: ${e.final.away}–${e.final.home} (away–home), ${e.settledBy}, first seen ${new Date(e.heldSince).toISOString()}`);
    const a = singleSourceAlert(registry, e);
    if (a && registry.recordAlert(a)) log(`  [alert] bt-single-source: ${a.text.slice(0, 160)}`);
  } } });
// a one-market Polymarket coin on a game moneyline runs on the same single-game schedule (sources/polyGame.ts; owner 2026-10-16)
polymarket.gameGate = polyGameGate({ client: () => espnClient(), deps: () => gameDeps() });
const PROGRAM_ID = process.env.BURNTICKER_PROGRAM_ID?.trim() || null;

/** The real client when the program id, an RPC and the keeper's key exist; the fake otherwise (nothing sent). */
// THE PER-CYCLE ACCOUNT CACHE (2026-10-15, cycleAccountCache.ts): every program-side read goes through it; the loop calls beginCycle()
let cycleCache = null as CycleAccountCache | null;
async function buildProgram(): Promise<{ program: BurnProgramClient; real: boolean; why: string; chain?: { connection: Connection; cluster: "mainnet" | "devnet" | "localnet"; payer: Keypair } }> {
  if (!PROGRAM_ID || !RPC) return { program: new FakeBurnProgram(cluster), real: false, why: !PROGRAM_ID ? "no BURNTICKER_PROGRAM_ID" : "no BURNTICKER_RPC_URL" };
  const raw = new Connection(RPC, budgetedRpcConfig({ commitment: "confirmed" }, RPC_FALLBACK));
  cycleCache = new CycleAccountCache(raw as unknown as ConstructorParameters<typeof CycleAccountCache>[0]);
  const connection = cycleCache.connection<Connection>();
  // A budget hold (or a busy bucket) at startup waits, never crashes (2026-10-15: a restart on a spent slice crash-looped every 30 s).
  // the genesis is read on the KEYED RPC only (getGenesisHash is essential and never moves to the fallback; apiBudget.ts)
  const genesis = await retryThroughBudgetHold(() => withEssential(["getGenesisHash"], () => connection.getGenesisHash()), { log, stop: () => stopping || restartAskedDuringStartup(), what: "startup (the genesis read)",
    sleep: async (ms) => { for (let t = 0; t < ms && !stopping; t += 1_000) await new Promise((r) => setTimeout(r, 1_000)); } });
  const actual = clusterOfGenesis(genesis);
  if (actual === "mainnet" && process.env.BURNTICKER_MAINNET !== "1") throw new Error("the RPC is mainnet: refused unless BURNTICKER_MAINNET=1 (after the audit)");
  if (actual === "testnet") throw new Error("burn_receipts has no testnet deployment");
  keyedGenesis = genesis;
  if (FALLBACK_ENV !== "off") {
    fallbackCandidate = /^https?:\/\//.test(FALLBACK_ENV) ? FALLBACK_ENV : publicRpcFor(actual);
    if (fallbackCandidate) await verifyFallbackNow("startup");
    else log(`  [api-budget] no hold fallback: ${actual} has no public RPC (reads wait for the keyed RPC's next day)`);
  }
  const keyPath = process.env.BURNTICKER_SIGNER_PATH?.trim() || path.join(os.homedir(), ".config", "meme-coin-trader", "signer-burnticker.enc.json");
  if (["signer.enc.json", "signer.json"].includes(path.basename(keyPath))) throw new Error(`BURNTICKER_SIGNER_PATH points at the treasury's key file (${keyPath}) — refusing`);
  const { loadKeypair } = await import("../src/lib/burnKeeper/keyfile.ts");
  // Its own passphrase when set; otherwise keyfile.ts's documented fallback chain.
  const kp = loadKeypair({ keyPath, passphrase: process.env.BURNTICKER_SIGNER_PASSPHRASE?.trim() || undefined });
  if (isPubkey(attester) && attester !== kp.publicKey.toBase58()) throw new Error(`BURNTICKER_KEEPER_PUBKEY ${attester} is not the key at ${keyPath} (${kp.publicKey.toBase58()})`);
  const program = new ProgramBurnClient({ connection, programId: new PublicKey(PROGRAM_ID), cluster: actual, payer: kp, admin: process.env.BURNTICKER_ADMIN?.trim() ? new PublicKey(process.env.BURNTICKER_ADMIN.trim()) : null,
    solUsd: async () => { const px = await usdPrice(SOL_MINT); if (px === null) throw new Error("SOL price unavailable"); return px; }, allowMainnet: process.env.BURNTICKER_MAINNET === "1", log });
  return { program, real: true, why: `program ${PROGRAM_ID} on ${actual}, keeper ${kp.publicKey.toBase58()}`, chain: { connection, cluster: actual, payer: kp } };
}
// A startup refusal (mainnet without the flag, the treasury's key file, a key that does not match) reaches the owner's phone before the process exits.
const built = await buildProgram().catch(async (e: unknown) => {
  if (stopping) { log(`stopped during startup: ${(e as Error).message.slice(0, 160)}`); process.exit(0); }
  if (!HAND_RUN) await pushKeeperRefused({ registry, env: process.env, now: Date.now(), reason: (e as Error).message, log }); throw e;
});
const program = built.program;
log(`claim_lock_fees crank: ${program.lockFees ? `on (fee-keys PDA ${program.lockFees.feeKeysPda()}, operator treasury ${program.lockFees.operatorTreasury() ?? "NOT PINNED on this cluster — claims wait, the fees stay in the lock"})` : "off (no lock-fee client)"}`);
// BURN DERBY (2026-10-10): Pyth on Solana (keyless) / Hermes (BURNTICKER_PYTH_API_KEY), pool TWAPs and mint supplies are MAINNET facts
// (BURNTICKER_DERBY_RPC_URL, else the public RPC), cross-reads from Jupiter / DexScreener / RedStone. Withheld windows raise an alert.
const derbyPools = connectionPoolPort(new Connection(process.env.BURNTICKER_DERBY_RPC_URL?.trim() || "https://api.mainnet-beta.solana.com", budgetedRpcConfig({ commitment: "confirmed", disableRetryOnRateLimit: true })));
const derby = new DerbyAdapter({ registry, hermes: process.env.BURNTICKER_PYTH_API_KEY?.trim() ? HermesClient.fromEnv(process.env) : null, pools: derbyPools, fetchImpl: globalThis.fetch as unknown as FetchLike, now: () => Date.now(), log,
  alert: (key, text) => { registry.recordAlert({ kind: "derby-withheld", key, text, meta: null }); } });
// second audit 2026-10-19 I-15: what this host encodes into every launch (the keeper key as sole attester, the config authority, the
// LaunchLab platform), compared for a draft or coin with no stored expectation; the signing key when there is one, else the named key
const expectedHost = expectedHostOf({ keeperPubkey: built.chain?.payer.publicKey.toBase58() ?? (isPubkey(attester) ? attester : null), program, platformId: process.env.BURNTICKER_PLATFORM_ID?.trim() || null });
const deps: KeeperDeps = { registry, program, oracles: { kalshi, catalogue: new CatalogueAdapter(), polymarket, derby }, derby: { sample: (t) => derby.sample(t), plan: () => derby.plan(), ended: (t) => derby.ended(t) }, attester, log, now: () => Date.now(), dryRun: DRY || fs.existsSync(PAUSE), kalshiEnabled: kalshiEnabled(process.env), expectedHost };
// A-1: the round comes from config/burnticker/verified-build.json for this cluster and program id (the fake program has none)
const dispersalStart = keeperDispersalStart(process.env, built.real ? hostProgramRound(process.env) : null);
if (!dispersalStart.ok) {
  log(`refusing to start: ${dispersalStart.reason}`);
  // review 6: a hand run (--once or --dry-run) prints the sentence and exits 1; only the service pushes it to the phone
  if (!HAND_RUN) await pushKeeperRefused({ registry, env: process.env, now: Date.now(), reason: dispersalStart.reason, log });
  else console.error(`keeper refused (hand run, not pushed): ${dispersalStart.reason}`);
  registry.close();
  process.exit(1);
}
const dispersal: DispersalDecision = dispersalStart.decision;
if (dispersal.on) deps.dispersal = true;
const dispersalStartLine = dispersalStart.line;
// review 5 of A-1: the web launcher reads this record, so the two hosts' processes decide alike (a dry run records nothing)
if (!DRY) writeKeeperDispersal(dispersal, { ...process.env, BURNTICKER_DB: DB });
log(dispersalStartLine);
/** An explicit BURNTICKER_DISPERSAL=0 on a program with crank_carried is allowed, and raised once a Denver day (bt-dispersal-off). */
function dispersalOffAlert(now: number): void {
  if (dispersal.source !== "flag-off" || !dispersal.crankCarried) return;
  const a = registry.recordAlert({ kind: "bt-dispersal-off", key: "bt-dispersal-off", text: "Burn dispersal is off on purpose (BURNTICKER_DISPERSAL=0) although the burn program has crank_carried. A finished rule's carried amount goes to its end sink after 30 days instead of burning the coin. Set BURNTICKER_DISPERSAL=1 in the keeper unit to turn it on.", meta: null }, now);
  if (a) log(`  [alert] bt-dispersal-off: burn dispersal is off on purpose`);
}
// signer-2 (2026-10-12): the second reading signer on its own host — unset BURNTICKER_COSIGNER_URL = no cosigner, nothing changes.
const cosigner = cosignerFromEnv(process.env);
if (cosigner) { deps.cosigner = cosigner; log(`second signer: ${process.env.BURNTICKER_COSIGNER_URL?.trim().replace(/\/\/[^/@]*@/, "//")} (each reading is co-signed there or held)`); }
const operator = operatorPowersSummary(loadPowersRegister());
const KALSHI_ON = kalshiEnabled(process.env), POLY_DISCOVERY = polymarketDiscoveryEnabled(process.env);
/** Read-only account reads for the coin cards (curve progress, top holders); the same RPC, no key. */
const ops = new KeeperOps({ registry, siteDir: SITE, cluster, env: process.env, log, uploader: uploaderFromEnv(process.env, cluster), snapshots: !DRY, signer: built.chain ? { publicKey: built.chain.payer.publicKey.toBase58(), secretKey: built.chain.payer.secretKey } : null });
const marketReader: MarketReader | null = RPC ? (new Connection(RPC, budgetedRpcConfig({ commitment: "confirmed" as const, disableRetryOnRateLimit: true }, RPC_FALLBACK)) as unknown as MarketReader) : null;
// THE READ CACHE (2026-10-13, keeperReadCache.ts, docs/burnticker/API-BUDGETS.md): the publish loop reads each coin's chain state through
// a per-coin cache (5 min for supply, the TokenConfig, the LP lock and the vault; 60 s for the fee PDA and the market read) and one batched
// getMultipleAccounts per cycle; the cycle's claim_lock_fees step shares the LP lock entry. The keeper's own sends drop the coin's entries.
const readCache = new KeeperReadCache({ now: () => Date.now() });
// review items 3 and 4: the private send route drops the cycle cache too; a coin with pending receipts reads fresh before its fence and cranks
if (cycleCache && PROGRAM_ID) {
  const cc = cycleCache, pid = new PublicKey(PROGRAM_ID);
  onPrivateSend(() => cc.invalidateAll());
  // re-review N1: one call per pass for THIS coin only: its TokenConfig, fee PDA, mint and the reading PDAs of its sendable dates
  deps.freshReads = (t, dates) => cc.refresh(freshReadKeys(pid, t.mint, dates, registry.pairOf(t.mint)), log);
}
const pairScan = built.chain ? new PairScanCache({ connection: built.chain.connection, programId: undefined }) : null;
const publishProgram = cachedPublishProgram(program, readCache);
if (program.lockFees) deps.program = withLockFees(program, publishProgram.lockFees!);
const batchReader: BatchReader | null = built.chain ? connectionBatchReader(built.chain.connection as unknown as MultipleAccountsReader, new PublicKey(program.programId), (m) => program.vaultFor(m)) : null;
// AUDIT A C1: THE DRAFT RECONCILER (draftReconciler.ts) — a coin created on chain whose browser never confirmed it is taken live from the
// chain (its TokenConfig in one getMultipleAccounts per sweep, then its create verified exactly as the browser's confirm is). Its own
// connection: the reads must not be served from the cycle cache. Read-only; it sends nothing.
// prelaunch audit 2026-10-18 A-18: with batched signer reads, dust sent to a draft's fee PDA costs no verification
const draftConn = built.chain && PROGRAM_ID && RPC ? withSignerReads(new Connection(RPC, budgetedRpcConfig({ commitment: "confirmed" as const, disableRetryOnRateLimit: true }, RPC_FALLBACK))) : null;
const draftVerifier = draftConn ? connectionLaunchVerifier(draftConn as unknown as TxReader, { burnProgramId: PROGRAM_ID, launchLabProgramId: LAUNCHLAB_PROGRAM_ID[cluster].toBase58(), pairCurveProgramId: PAIR_CURVE_PROGRAM_ID.toBase58() }) : null;
const cachedMarket: MarketReader | null = marketReader ? cachedMarketReader(marketReader, readCache, (poolId) => registry.tokens().find((x) => x.poolId === poolId)?.mint ?? null) : null;

async function publishAll(now: number): Promise<void> {
  const statuses: TokenStatusJson[] = [];
  // keyed by mint (tickers are not unique, owner 2026-10-12); each coin's site directories from coinKey.ts siteKeysOf
  const receiptsByTicker: Record<string, ReturnType<typeof buildReceiptsJson>> = {};
  const all = registry.tokens();
  const siteKeys = siteKeysOf(all.map((t) => ({ ticker: t.ticker, mint: t.mint, status: t.status, launchedAt: t.launchTx ? t.baselineAt : null })));
  // 2026-10-13: a draft (never created on chain) or an expired draft gets no public page and no index row; the site keys still see every
  // row, so a ticker a draft shares with a live coin keeps the live coin's keys. (Three launch-probe drafts had reached tokens.html.)
  const published = all.filter((t) => t.status !== "draft" && t.status !== "expired");
  // THE BATCH (keeperReadCache.ts): every published coin's TokenConfig, fee PDA, mint, vault and pool in one getMultipleAccounts call per 20 coins
  await readCache.prefetch(batchReader, published.map((t) => { let vault = false; try { vault = registry.lockedRule(t).mode === "vault"; } catch { vault = false; } return { mint: t.mint, vault, poolId: t.poolId }; }), log);
  for (const t of published) {
    try {
      const locked = registry.lockedRule(t);
      const readings = registry.readings(t.selectorKey, t.baselineAt).filter((r) => readingMatches(locked.rule, r));
      const state = registry.state(t.mint);
      const oracle = locked.rule.oracle === "catalogue" ? deps.oracles.catalogue : locked.rule.oracle === "polymarket" ? polymarket : locked.rule.oracle === "derby" ? derby : kalshi;
      // Display reads on the published pages (venues.ts): Kalshi's only with BURNTICKER_KALSHI_ENABLED on; never a Polymarket odds read;
      // Polymarket titles only with discovery on. Settlement reads (fetchDue) are separate.
      const implied = locked.rule.oracle === "derby" ? await oracle.impliedChance(locked.rule, state.lastValue).catch(() => null) : null;   // derby: the next window's close time only; no odds for any coin (owner decision 2026-10-10)
      const info = locked.rule.oracle === "kalshi" ? (KALSHI_ON ? await kalshi.seriesInfo(locked.rule.series ?? locked.rule.market!.split("-")[0]).catch(() => null) : null)
        : locked.rule.oracle === "polymarket" ? (POLY_DISCOVERY ? await polymarket.seriesInfo(locked.rule.market ?? locked.rule.series!).catch(() => null) : null) : null;
      const feed = locked.rule.oracle === "catalogue" && locked.rule.series ? feedById(locked.rule.series) : null;
      const feedState = registry.feedState(t.selectorKey);
      // the chain fields through the read cache (keeperReadCache.ts): the batch filled supply, the fee PDA, the TokenConfig, the vault
      // and the pool before this loop; the LP lock and the holders' owners are kept for 5 minutes; the keeper's own sends drop a coin
      const reads = await coinChainReads({ registry, program: publishProgram, cluster, t, mode: locked.mode, marketReader: cachedMarket, now });
      const input = { token: t, locked, readings, receipts: registry.receipts(t.mint), attesters: registry.attesters(t.mint), state, feedState,
        chain: reads.chain, now, nextCheckAt: feedState.nextFetchAt, implied, seriesTitle: info?.title ?? feed?.title ?? (locked.rule.oracle === "catalogue" && locked.rule.series ? nativeSourceById(locked.rule.series)?.title ?? null : null), selectorPending: 0, operator, lifecycle: lifecycleFrom(registry, t, locked.rule, null), pair: reads.pair,
        lp: reads.lp, market: reads.market };
      const receipts = buildReceiptsJson(input);
      const status = buildTokenStatus(input, receipts);
      publishTokenSite(SITE, status, receipts, readings, t.rulesJson, siteKeys.get(t.mint) ?? [t.ticker]);
      statuses.push(status); receiptsByTicker[t.mint] = receipts;
    } catch (e) { log(`  [publish] $${t.ticker}: ${(e as Error).message.slice(0, 160)}`); }
  }
  const audit = readAudit(SITE);
  // owner 2026-10-14: a test coin keeps its own page but has no row in the index (testCoins.ts)
  const tests = testCoinKeys(process.cwd(), registry);
  publishPlatformIndex(SITE, statuses.filter((s) => !tests.mints.has(s.mint)), now, audit ? { ok: audit.ok, ranAt: audit.ranAt, receipts: audit.receipts, executed: audit.executed, chainVerified: audit.chainVerified, mismatches: audit.mismatches.length, chainChecked: audit.chainChecked } : null, receiptsByTicker, siteKeys);
}


// Ops: the crank-failure streaks the alert check reads, the balance sampler (one getBalance per key every ALERT_EVERY_MS), the sink
// (the registry's alerts table, then the BURNTICKER_ALERT_WEBHOOK to the operator's intake route — this host is not where the owner looks),
// and ops.json — the morning check's block published into the public site so the check-in on another host can read it.
const tracker = new CrankFailureTracker();
const { sink, state: webhook } = sinkFromEnv(process.env, { log, local: registryAlertSink(registry) });
// second audit 2026-10-18 A-7: an off-box monitor's ping URL, GET once per cycle (ops/heartbeat.ts); the URL itself is never logged
const heartbeat = new Heartbeat(heartbeatUrlFromEnv(process.env), fetch, log);
let lastAlertAt = 0;
let heldNotedDay = "";
// A-6: THE NEVER-BUYS MONITOR, once a Denver day (trustpack/neverBuys.ts): every operator wallet in config/burnticker/operator.json for
// this cluster against every platform coin the registry holds, $DEFICIT and the listed mints; <site>/never-buys.json is what the operator
// and trust pages read. It runs beside the cycle (a few hundred plain reads), never blocking it; an unexplained acquisition is pushed.
let neverBuysDay = "", neverBuysRunning = false;
function neverBuysCheck(now: number): void {
  if (!RPC || DRY || neverBuysRunning || neverBuysDay === denverDate(now)) return;
  neverBuysRunning = true;
  void (async () => {
    try {
      const op = loadOperator(process.cwd()).clusters[cluster];
      let deficit: { symbol: string; mint: string }[] = [];
      try { const st = JSON.parse(fs.readFileSync(path.join("config", "burnticker", "current-status.json"), "utf8")) as { deficit?: { launch?: { mint?: string } } }; if (cluster === "mainnet" && st.deficit?.launch?.mint) deficit = [{ symbol: "DEFICIT", mint: st.deficit.launch.mint }]; } catch { deficit = []; }
      const wallets = op.wallets.filter((w) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(w.pubkey)).map((w) => ({ role: w.role, pubkey: w.pubkey }));
      const mints = neverBuysMints(registry.tokens(), cluster, op.platformMints, deficit);
      // continuous audit 2026-10-19 ACC-02: the disclosed mainnet test coins (transparency.json `rehearsals`) are in scope, as named exceptions
      const exceptions = cluster === "mainnet" ? neverBuysExceptions(process.cwd()) : [];
      const r = await runNeverBuys({ rpc: jsonRpc(RPC, fetch, { attempts: 4, minIntervalMs: 150 }), cluster, wallets, mints, evidence: evidenceSignatures(process.cwd()), now, exceptions });
      publishSite(SITE, { [NEVER_BUYS_FILE]: toJson(r) });
      neverBuysDay = denverDate(now);
      log(`  [never-buys] ${r.status}: ${wallets.length} wallet(s), ${mints.length} coin(s), ${r.scanned.transactions} transaction(s) read${r.errors.length ? `, ${r.errors.length} read error(s)` : ""}`);
      if (r.status === "red") {
        const a = registry.recordAlert({ kind: "bt-never-buys-red", key: "bt-never-buys-red", text: `An operator wallet traded for a platform coin outside any recorded rehearsal: ${r.acquisitions.filter((x) => !x.explainedBy && (x.how ?? "acquired") === "acquired").slice(0, 3).map((x) => `${x.role} +${x.amountRaw} $${x.symbol} (${x.signature.slice(0, 12)}…)`).join("; ")}.`, meta: { acquisitions: r.acquisitions.length } }, now);
        if (a) log(`  [alert] bt-never-buys-red`);
      }
    } catch (e) { log(`  [never-buys] failed, retried at the next check: ${(e as Error).message.slice(0, 160)}`); }
    finally { neverBuysRunning = false; }
  })();
}
// A-4: the day the program check last answered (a failed read is retried at the next alert check, never counted as a mismatch)
let programCheckDay = "";
async function programHashCheck(now: number): Promise<void> {
  if (!RPC || !PROGRAM_ID || !built.real || programCheckDay === denverDate(now)) return;
  const record = programHashFact(process.env, process.cwd(), { log });
  if (!record.hash || record.programId !== PROGRAM_ID) { programCheckDay = denverDate(now); log(`  [program-check] skipped: config/burnticker/verified-build.json has no ${record.cluster} record for ${PROGRAM_ID}`); return; }
  const conn = new Connection(RPC, budgetedRpcConfig({ commitment: "confirmed" as const, disableRetryOnRateLimit: true }, RPC_FALLBACK));
  let chain;
  try { chain = await readProgramDataHash({ accountBytes: async (a) => (await conn.getAccountInfo(new PublicKey(a), "confirmed"))?.data ?? null }, PROGRAM_ID, (b) => new PublicKey(b).toBase58()); }
  catch (e) { log(`  [program-check] read failed, retried at the next check: ${(e as Error).message.slice(0, 160)}`); return; }
  // review 2: an account that is absent, short or not a ProgramData account is a read that did not answer, like a thrown one: retried at
  // the next check, no alert, the day not marked checked
  if (!chain) { log(`  [program-check] the program's ProgramData account did not read back, retried at the next check`); return; }
  programCheckDay = denverDate(now);
  const diff = compareProgramToRecord(record, chain);
  registry.setStatus("programHash.check", { at: now, cluster: record.cluster, recordHash: record.hash, recordSlot: record.slot, chainHash: chain.hash, chainSlot: chain.slot, ok: !diff }, now);
  if (!diff) { log(`  [program-check] the burn program on ${record.cluster} equals verified-build.json (${record.hash.slice(0, 8)}…, slot ${chain.slot})`); return; }
  log(`  [program-check] ${diff}`);
  const a = registry.recordAlert({ kind: "bt-audit-mismatch", key: `bt-program-hash:${record.cluster}`, text: diff, meta: { recordHash: record.hash, recordSlot: record.slot, chainHash: chain.hash, chainSlot: chain.slot } }, now);
  if (a) log(`  [alert] bt-audit-mismatch: ${diff.slice(0, 160)}`);
}
let holdLiftNoted = true;
async function opsCheck(now: number, paused: boolean): Promise<void> {
  let balances: { at: number; keeperLamports: bigint | null; devFeeLamports: bigint | null } | null = null;
  if (RPC && (isPubkey(attester) || isPubkey(FEE_WALLET))) {
    balances = { at: now, keeperLamports: isPubkey(attester) ? await rpcBalanceLamports(RPC, attester) : null, devFeeLamports: isPubkey(FEE_WALLET) ? await rpcBalanceLamports(RPC, FEE_WALLET) : null };
    recordBalanceSample(registry, balances);
  }
  try { await programHashCheck(now); } catch (e) { log(`  [program-check] failed: ${(e as Error).message.slice(0, 160)}`); }
  dispersalOffAlert(now);
  neverBuysCheck(now);
  const r = await runBurntickerAlertCheck({ registry, siteDir: SITE, now, paused, balances, crankStreaks: tracker.snapshot(), sink });
  budget.flush();
  const budgetLines = budgetStatusLines(budget.lines());
  for (const l of budgetLines) log(`  [${l}]`);
  for (const l of budgetTopMethodLines(budget)) log(`  [${l}]`);
  if (cycleCache) { const c = cycleCache.stats; log(`  [cycle-cache] ${cycleCache.addresses().length} account(s) prefetched per cycle in ${Math.ceil(cycleCache.addresses().length / 100)} call(s); since start: ${c.cycles} cycle(s), ${c.served} read(s) served, ${c.passed} sent to the RPC, ${c.invalidations} drop(s) after a send`); }
  for (const a of r.raised) log(`  [alert] ${a.kind}: ${a.text.slice(0, 160)}`);
  for (const a of await ops.alerts(sink, now)) log(`  [alert] ${a.slice(0, 160)}`);
  const unitCheck = await runUnitCheck({ sink, now, log });
  for (const a of unitCheck.raised) log(`  [alert] ${a.kind}: ${a.text.slice(0, 160)}`);   // audit 2026-10-16 F-5: failed units, backups
  try { const p = await runPushCheck({ registry, env: process.env, now, log }); for (const m of p.sent) log(`  [push] ${m.kind}: ${m.title}`); } catch (e) { log(`  [push] check failed: ${(e as Error).message.slice(0, 160)}`); }
  const launched = registry.tokens("live").map((t) => Date.parse(t.baselineAt)).filter((x) => Number.isFinite(x));
  let alerts: { ts: number; kind: string; text: string; seenAt: number | null; sent: boolean }[] | null = null;
  try { alerts = registryAlertRows(registry, now); } catch { alerts = null; }
  // F06: ops.json's conditions come from the one aggregator (keeper-level + per-source health); the memory feeds "recovered"
  const health = ops.feedHealth(), memory = readConditionMemory(registry);
  // second audit 2026-10-18 A-7: failed units, backups and budget holds are conditions too (a keeper refusal is read from the alert rows)
  const signals = { units: unitCheck.active, budget: budget.lines() };
  // A-1: the host facts (names and yes/no only)
  // review 4 and 5: every process's dispersal decision (this keeper, the web launcher's from its own env file, the $DEFICIT keeper's record)
  let deficitDispersal: boolean | null = null;
  try { deficitDispersal = (JSON.parse(fs.readFileSync(path.join(path.dirname(DB), DEFICIT_DISPERSAL_NAME), "utf8")) as { on?: unknown }).on === true; } catch { deficitDispersal = null; }
  const hostFacts = { dispersal: { on: dispersal.on, line: dispersalHostLine(dispersal, webDispersal(process.env), deficitDispersal) }, webhookConfigured: webhook.configured, pushConfigured: !!pushConfigFromEnv(process.env), heartbeatConfigured: !!process.env.BURNTICKER_STATUS_HEARTBEAT_URL?.trim(),
    backupDestConfigured: !!process.env.BURNTICKER_BACKUP_DEST?.trim() || readBackupStatus(process.cwd())?.destConfigured === true, programHashSource: programHashSourceLine(programHashFact(process.env, process.cwd(), { log })),
    // I-11 / B-4 (2026-10-19): the external web check's last outcome (data/web-probe-last.json; never the URL)
    webProbe: webProbeFact(readWebProbeStatus(process.cwd()), process.env),
    // B-3 / OPS-1 (2026-10-19): the off-box pull receipt (data/offbox-pull.json): pulled / stale / none, its time and method only
    ...offboxPullFact(readOffboxPull(process.cwd(), now), now) };
  publishOps(SITE, buildOpsJson({ now, snapshot: r.snapshot, delta: devFeeDelta(registry, now), alerts, firstLaunchAt: launched.length ? Math.min(...launched) : null, webhook, apiBudget: budgetLines, health, conditionMemory: memory, signals, heartbeat: heartbeat.state, hostFacts }));
  try { registry.setStatus(CONDITIONS_KEY, foldConditions(memory, activeConditions(r.snapshot, health, { ...signals, alerts, lastCycleAt: r.snapshot?.lastCycle?.at ?? null }), now), now); } catch (e) { log(`  [ops] condition memory not written: ${(e as Error).message.slice(0, 120)}`); }
}

log(`burnticker keeper starting — ${registry.tokens("live").length} live token(s) · ledger ${DB} · site ${SITE} · ${cluster}${DRY ? " · DRY RUN" : ""} · program ${program.programId} (${built.real ? `REAL: ${built.why}` : `FAKE — ${built.why}; nothing is sent`}) · ${ops.banner()} · alerts ${ALERTS ? `every ${ALERT_EVERY_MS / 60_000} min${RPC ? " with balances" : " (no BURNTICKER_RPC_URL: balances unknown)"}${webhook.configured ? " → webhook" : " (no BURNTICKER_ALERT_WEBHOOK: local only)"}${pushConfigFromEnv(process.env) ? " + phone push" : ""}` : "off (--once)"}`);
while (!stopping) {
  const paused = fs.existsSync(PAUSE);
  if (paused && !DRY) log(`  ${PAUSE} present — cranks held, reading and publishing go on`);
  // The role, then runCycle: fetch, plan, the foreign-reading fence (after planning, before the first attestation — review 2 F1), execute.
  // the phase each credit is counted under (apiBudget.ts setPhase; the 5-minute check prints today's top phase:method lines)
  // a held keyed RPC (review item 2): this cycle reads through the fallback and sends nothing (readings, cranks, claims wait for 00:00 UTC)
  const heliusHeld = !!built.chain && budget.isHeld("helius");
  // re-review N3: verify the fallback on the first held cycle, and hourly while it stays unverified
  if (heliusHeld && !fallbackUrl && fallbackCandidate && (heldNotedDay !== new Date().toISOString().slice(0, 10) || Date.now() - fallbackTriedAt >= 3_600_000)) await verifyFallbackNow("on hold");
  // re-review N4: on a held cycle the reads that describe landed transactions may use the fallback; nothing is built from them
  setDescribeFallback(heliusHeld);
  if (!heliusHeld && heldNotedDay && !holdLiftNoted) { holdLiftNoted = true; log(`  [api-budget] helius hold lifted: sends resume this cycle`); }
  if (heliusHeld) holdLiftNoted = false;
  if (heliusHeld && heldNotedDay !== new Date().toISOString().slice(0, 10)) { heldNotedDay = new Date().toISOString().slice(0, 10); log(`  [api-budget] helius on hold: every cycle until 00:00 UTC runs with its sends held${fallbackUrl ? `; reads go to ${new URL(fallbackUrl).hostname}` : "; no fallback, so chain reads fail until then"}`); }
  budget.setPhase("prefetch");
  if (cycleCache) { try { await cycleCache.beginCycle(log); } catch (e) { log(`  [cycle-cache] ${(e as Error).message.slice(0, 160)}`); } }
  budget.setPhase("cycle");
  const { gate, report: cycleReport, error: cycleError } = await ops.cycle(deps, { dryRun: DRY || paused || heliusHeld });
  if (cycleReport) {
    const r = cycleReport;
    tracker.note(r);
    const f = r.fetched.filter((x) => !x.skipped);
    if (f.length || r.planned.length || r.executed.length) log(`cycle: ${f.length} fetch(es), ${r.planned.length} planned, ${r.executed.length} executed${r.errors.length ? ` · errors: ${r.errors.slice(0, 3).join(" | ")}` : ""}`);
    registry.setStatus("lastCycle", { at: Date.now(), fetched: f.length, planned: r.planned.length, executed: r.executed.length, errors: r.errors.slice(0, 5), refusals: r.fetched.flatMap((x) => x.refusals).slice(0, 10) });
  } else log(`cycle failed: ${(cycleError ?? "").slice(0, 200)}`);
  if (!gate.sendsAllowed) deps.dryRun = true;
  // Rivalry pairs on the pair curve (2026-10-10, docs/burnticker/PAIR-CURVE.md): graduate both sides / register / void — program
  // mode only, behind BURNTICKER_PAIR_CURVE_ENABLED. Permissionless cranks; the keeper key pays transaction fees only.
  if (built.chain && pairCurveEnabled(process.env) && gate.sendsAllowed && !heliusHeld) {
    budget.setPhase("pair-curve");
    try {
      const pc = await crankPairCurves({ scan: (u) => pairScan!.scan(u), ctx: { connection: built.chain.connection, cluster: built.chain.cluster, burnReceiptsProgramId: new PublicKey(PROGRAM_ID!), allowMainnet: process.env.BURNTICKER_MAINNET === "1" }, cranker: built.chain.payer, dryRun: deps.dryRun, log, isUnlinked: (ma, mb) => { const pr = registry.pairOf(ma); return !!pr && (pr.mintA === mb || pr.mintB === mb) && registry.getStatus(`pair.unlinked.${pr.pairId}`) !== null; }, alert: (kind, key, text, meta) => { registry.recordAlert({ kind, key, text, meta }); } });
      if (pc.acted.length) { readCache.invalidateAll(); cycleCache?.invalidateAll(); }   // a pair-curve crank (graduation, registration, void) writes no registry signature: re-read every coin
      if (pc.acted.length || pc.errors.length) log(`pair curve: ${pc.scanned} pair(s) scanned, ${pc.acted.length} cranked${pc.errors.length ? ` · errors: ${pc.errors.slice(0, 3).join(" | ")}` : ""}`);
    } catch (e) { log(`pair curve crank failed: ${(e as Error).message.slice(0, 200)}`); }
  } else if (pairCurveEnabled(process.env) && !built.real) log(`  [pair-curve] ${PAIR_CURVE_FLAG} is set but the program client is the fake — nothing cranked`);
  // the read cache drops every coin this cycle changed (its report, and any new or confirmed signature in the registry)
  try { const dropped = readCache.afterCycle(cycleReport, signatureFingerprints(registry.db)); if (dropped.length) log(`  [read-cache] ${dropped.length} coin(s) re-read after this cycle's sends`); } catch (e) { readCache.invalidateAll(); log(`  [read-cache] invalidation failed, every coin re-read: ${(e as Error).message.slice(0, 160)}`); }
  if (draftConn && draftVerifier && PROGRAM_ID && !heliusHeld) {
    budget.setPhase("drafts");
    try {
      const dr = await reconcileDrafts({ registry, reader: draftConn as unknown as DraftChainReader, verifier: draftVerifier, burnProgramId: PROGRAM_ID, now: () => Date.now(), log, dryRun: DRY, env: process.env, host: expectedHost });
      if (dr.takenLive.length) readCache.invalidateAll();
      if (dr.errors.length) log(`  [drafts] ${dr.errors.slice(0, 3).join(" | ")}`);
    } catch (e) { log(`  [drafts] reconcile failed: ${(e as Error).message.slice(0, 160)}`); }
  }
  budget.setPhase("publish");
  try { await publishAll(Date.now()); } catch (e) { log(`publish failed: ${(e as Error).message.slice(0, 200)}`); }
  budget.setPhase("after-cycle");
  await ops.afterCycle(cycleReport, paused, ALERTS ? sink : null);
  try { const w = writeOwnTokensGenerated(registry, process.env.OWN_TOKENS_GENERATED_PATH?.trim() || undefined); if (w.changed) log(`  [refuse-list] ${w.file} rewritten: ${w.count} platform token(s) — the arms re-read it on their next candidate`); } catch (e) { log(`  [refuse-list] not written: ${(e as Error).message.slice(0, 160)}`); }
  budget.flush();
  // one bounded GET per cycle, never throws (A-7): ok for a completed cycle whose errors are per coin or fence holds, fail when the cycle
  // failed or every live coin errored, nothing otherwise (ops/heartbeat.ts heartbeatVerdict; review and re-review, 2026-10-18)
  await heartbeat.beat(Date.now(), heartbeatVerdict(cycleReport, registry.tokens("live")));
  budget.setPhase("ops");
  if (ALERTS && Date.now() - lastAlertAt >= ALERT_EVERY_MS) { lastAlertAt = Date.now(); try { await opsCheck(lastAlertAt, paused); } catch (e) { log(`  [alert] check failed: ${(e as Error).message.slice(0, 160)}`); } }
  if (ONCE) break;
  // DEPLOY-REQUESTED RESTART (restartRequest.ts): the cycle is finished (nothing in flight), so exit 0 and let systemd start the new code
  const restart = DRY ? null : takeRestartRequest("keeper", { startedAt: KEEPER_STARTED_AT });
  if (restart) { log(`restart requested by deploy ${restart.build}${restart.at ? ` (requested ${restart.at})` : ""}: exiting between cycles; systemd starts the new code`); break; }
  // between cycles (nothing in flight): a SIGTERM ends the wait at once instead of after the full minute
  for (let t = 0; t < 60_000 && !stopping; t += 1_000) await new Promise((r) => setTimeout(r, 1_000));
}
registry.close();
log("burnticker keeper stopped");
