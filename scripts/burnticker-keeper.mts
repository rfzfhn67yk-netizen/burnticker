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
import { loadRefuseList, refusalsFor } from "../src/lib/burnticker/oracle/refuse.ts";
import { CatalogueAdapter, feedById } from "../src/lib/burnticker/catalogue/index.ts";
import os from "node:os";
import { Connection, PublicKey } from "@solana/web3.js";
import { FakeBurnProgram, programPageBlock, type BurnProgramClient } from "../src/lib/burnticker/program.ts";
import { ProgramBurnClient } from "../src/lib/burnticker/programClient.ts";
import { clusterOfGenesis } from "../src/lib/burnKeeper/solana.ts";
import { SOL_MINT, usdPrice } from "../src/lib/burnKeeper/jupiterSwap.ts";
import type { KeeperDeps } from "../src/lib/burnticker/multiKeeper.ts";
import { cosignerFromEnv } from "../src/lib/burnticker/attesters/cosign.ts";
import { lpLockBlock } from "../src/lib/burnticker/lpLockPage.ts";
import { buildReceiptsJson, buildTokenStatus, lifecycleFrom, pairCounterpartFrom, publishPlatformIndex, publishTokenSite, type TokenStatusJson } from "../src/lib/burnticker/tokenPage.ts";
import { loadPowersRegister, operatorPowersSummary, readAudit } from "../src/lib/burnticker/trust.ts";
import { CrankFailureTracker, devFeeDelta, recordBalanceSample, registryAlertRows, registryAlertSink, rpcBalanceLamports, runBurntickerAlertCheck, sinkFromEnv } from "../src/lib/burnticker/alerts.ts";
import { buildOpsJson, publishOps } from "../src/lib/burnticker/checkin.ts";
import { writeOwnTokensGenerated } from "../src/lib/burnticker/ownTokensSync.ts";
import { readMarket, type MarketReader } from "../src/lib/burnticker/market.ts";
import { nativeSourceById, setNativeClients } from "../src/lib/burnticker/sources/native.ts";
import { envGameDeps, polymarketGameReaders } from "../src/lib/burnticker/sources/gameSettle.ts";
import { kalshiEnabled, polymarketDiscoveryEnabled } from "../src/lib/burnticker/venues.ts";
import { DECIMALS, TOTAL_SUPPLY } from "../src/lib/burnticker/rules.ts";
import { crankPairCurves, pairCurveEnabled, PAIR_CURVE_FLAG } from "../src/lib/burnKeeper/pairCurveCrank.ts";
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
import { siteKeysOf } from "../src/lib/burnticker/coinKey.ts";

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const log = (s: string) => console.log(`[${new Date().toISOString().replace("T", " ").slice(0, 19)}Z] ${s}`);
const ONCE = flag("once"), DRY = flag("dry-run");
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

const registry = openRegistry(DB);
const kalshi = new KalshiClient();
// Polymarket (2026-10-10): Gamma for discovery, the Polygon CTF payout vector for results; the refuse list over every market question.
const polygonRpcs = (process.env.BURNTICKER_POLYGON_RPC_URLS ?? "").split(",").map((x) => x.trim()).filter((x) => /^https:\/\//.test(x));
const polymarket = new PolymarketClient({ refuse: (titles) => [...new Set(refusalsFor(loadRefuseList(), { titles }).map((r) => r.reason))], ...(polygonRpcs.length ? { rpcUrls: polygonRpcs } : {}) });
// team coins: each game settles on its on-chain payout where a moneyline market exists, else TheSportsDB (commercial); never ESPN
setNativeClients({ games: { ...envGameDeps(process.env), ...polymarketGameReaders(polymarket) } });
const PROGRAM_ID = process.env.BURNTICKER_PROGRAM_ID?.trim() || null;

/** The real client when the program id, an RPC and the keeper's key exist; the fake otherwise (nothing sent). */
async function buildProgram(): Promise<{ program: BurnProgramClient; real: boolean; why: string; chain?: { connection: Connection; cluster: "mainnet" | "devnet" | "localnet"; payer: Keypair } }> {
  if (!PROGRAM_ID || !RPC) return { program: new FakeBurnProgram(cluster), real: false, why: !PROGRAM_ID ? "no BURNTICKER_PROGRAM_ID" : "no BURNTICKER_RPC_URL" };
  const connection = new Connection(RPC, "confirmed");
  const actual = clusterOfGenesis(await connection.getGenesisHash());
  if (actual === "mainnet" && process.env.BURNTICKER_MAINNET !== "1") throw new Error("the RPC is mainnet: refused unless BURNTICKER_MAINNET=1 (after the audit)");
  if (actual === "testnet") throw new Error("burn_receipts has no testnet deployment");
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
const built = await buildProgram().catch(async (e: unknown) => { await pushKeeperRefused({ registry, env: process.env, now: Date.now(), reason: (e as Error).message, log }); throw e; });
const program = built.program;
log(`claim_lock_fees crank: ${program.lockFees ? `on (fee-keys PDA ${program.lockFees.feeKeysPda()}, operator treasury ${program.lockFees.operatorTreasury() ?? "NOT PINNED on this cluster — claims wait, the fees stay in the lock"})` : "off (no lock-fee client)"}`);
// BURN DERBY (2026-10-10): Pyth on Solana (keyless) / Hermes (BURNTICKER_PYTH_API_KEY), pool TWAPs and mint supplies are MAINNET facts
// (BURNTICKER_DERBY_RPC_URL, else the public RPC), cross-reads from Jupiter / DexScreener / RedStone. Withheld windows raise an alert.
const derbyPools = connectionPoolPort(new Connection(process.env.BURNTICKER_DERBY_RPC_URL?.trim() || "https://api.mainnet-beta.solana.com", { commitment: "confirmed", disableRetryOnRateLimit: true }));
const derby = new DerbyAdapter({ registry, hermes: process.env.BURNTICKER_PYTH_API_KEY?.trim() ? HermesClient.fromEnv(process.env) : null, pools: derbyPools, fetchImpl: globalThis.fetch as unknown as FetchLike, now: () => Date.now(), log,
  alert: (key, text) => { registry.recordAlert({ kind: "derby-withheld", key, text, meta: null }); } });
const deps: KeeperDeps = { registry, program, oracles: { kalshi, catalogue: new CatalogueAdapter(), polymarket, derby }, derby: { sample: (t) => derby.sample(t), plan: () => derby.plan(), ended: (t) => derby.ended(t) }, attester, log, now: () => Date.now(), dryRun: DRY || fs.existsSync(PAUSE), kalshiEnabled: kalshiEnabled(process.env) };
// signer-2 (2026-10-12): the second reading signer on its own host — unset BURNTICKER_COSIGNER_URL = no cosigner, nothing changes.
const cosigner = cosignerFromEnv(process.env);
if (cosigner) { deps.cosigner = cosigner; log(`second signer: ${process.env.BURNTICKER_COSIGNER_URL?.trim().replace(/\/\/[^/@]*@/, "//")} (each reading is co-signed there or held)`); }
const operator = operatorPowersSummary(loadPowersRegister());
const KALSHI_ON = kalshiEnabled(process.env), POLY_DISCOVERY = polymarketDiscoveryEnabled(process.env);
/** Read-only account reads for the coin cards (curve progress, top holders); the same RPC, no key. */
const ops = new KeeperOps({ registry, siteDir: SITE, cluster, env: process.env, log, uploader: uploaderFromEnv(process.env, cluster), snapshots: !DRY, signer: built.chain ? { publicKey: built.chain.payer.publicKey.toBase58(), secretKey: built.chain.payer.secretKey } : null });
const marketReader: MarketReader | null = RPC ? (new Connection(RPC, { commitment: "confirmed", disableRetryOnRateLimit: true }) as unknown as MarketReader) : null;

async function publishAll(now: number): Promise<void> {
  const statuses: TokenStatusJson[] = [];
  // keyed by mint (tickers are not unique, owner 2026-10-12); each coin's site directories from coinKey.ts siteKeysOf
  const receiptsByTicker: Record<string, ReturnType<typeof buildReceiptsJson>> = {};
  const all = registry.tokens();
  const siteKeys = siteKeysOf(all.map((t) => ({ ticker: t.ticker, mint: t.mint, status: t.status, launchedAt: t.launchTx ? t.baselineAt : null })));
  for (const t of all) {
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
      const input = { token: t, locked, readings, receipts: registry.receipts(t.mint), attesters: registry.attesters(t.mint), state, feedState,
        chain: { cluster, programId: program.programId, supplyRaw: await program.supplyRaw(t.mint), feePdaLamports: await program.feePdaBalanceLamports(t.mint), vaultRaw: locked.mode === "vault" ? await program.vaultBalanceRaw(t.mint) : null, program: await programPageBlock(program, t.mint, registry.lastProgramTx(t.mint, "reading")) },
        now, nextCheckAt: feedState.nextFetchAt, implied, seriesTitle: info?.title ?? feed?.title ?? (locked.rule.oracle === "catalogue" && locked.rule.series ? nativeSourceById(locked.rule.series)?.title ?? null : null), selectorPending: 0, operator, lifecycle: lifecycleFrom(registry, t, locked.rule, null), pair: await pairCounterpartFrom(registry, (m) => program.supplyRaw(m), t, async (m) => { try { return (await program.port(m).config())?.poolRegistered ?? null; } catch { return null; } }, program.pairForward ? (a, b) => program.pairForward!.port(a, b).links() : undefined),
        // the coin card's curve progress + top holders (read-only, the same RPC); without an RPC status.json says "not read" and the card shows —
        lp: await lpLockBlock(registry, program, cluster, t.mint),
        market: marketReader && t.status !== "draft" && t.status !== "expired" ? await readMarket(marketReader, { cluster, mint: t.mint, poolId: t.poolId, feePda: t.feePda, creator: t.creator, totalSupplyRaw: (await program.supplyRaw(t.mint).catch(() => null)) ?? BigInt(TOTAL_SUPPLY) * BigInt(10) ** BigInt(DECIMALS), decimals: DECIMALS }, now).catch(() => null) : null };
      const receipts = buildReceiptsJson(input);
      const status = buildTokenStatus(input, receipts);
      publishTokenSite(SITE, status, receipts, readings, t.rulesJson, siteKeys.get(t.mint) ?? [t.ticker]);
      statuses.push(status); receiptsByTicker[t.mint] = receipts;
    } catch (e) { log(`  [publish] $${t.ticker}: ${(e as Error).message.slice(0, 160)}`); }
  }
  const audit = readAudit(SITE);
  publishPlatformIndex(SITE, statuses, now, audit ? { ok: audit.ok, ranAt: audit.ranAt, receipts: audit.receipts, mismatches: audit.mismatches.length, chainChecked: audit.chainChecked } : null, receiptsByTicker, siteKeys);
}

let stopping = false;
for (const s of ["SIGTERM", "SIGINT"] as const) process.on(s, () => { stopping = true; log(`${s}: finishing the current cycle`); });

// Ops: the crank-failure streaks the alert check reads, the balance sampler (one getBalance per key every ALERT_EVERY_MS), the sink
// (the registry's alerts table, then the BURNTICKER_ALERT_WEBHOOK to the operator's intake route — this host is not where the owner looks),
// and ops.json — the morning check's block published into the public site so the check-in on another host can read it.
const tracker = new CrankFailureTracker();
const { sink, state: webhook } = sinkFromEnv(process.env, { log, local: registryAlertSink(registry) });
let lastAlertAt = 0;
async function opsCheck(now: number, paused: boolean): Promise<void> {
  let balances: { at: number; keeperLamports: bigint | null; devFeeLamports: bigint | null } | null = null;
  if (RPC && (isPubkey(attester) || isPubkey(FEE_WALLET))) {
    balances = { at: now, keeperLamports: isPubkey(attester) ? await rpcBalanceLamports(RPC, attester) : null, devFeeLamports: isPubkey(FEE_WALLET) ? await rpcBalanceLamports(RPC, FEE_WALLET) : null };
    recordBalanceSample(registry, balances);
  }
  const r = await runBurntickerAlertCheck({ registry, siteDir: SITE, now, paused, balances, crankStreaks: tracker.snapshot(), sink });
  for (const a of r.raised) log(`  [alert] ${a.kind}: ${a.text.slice(0, 160)}`);
  for (const a of await ops.alerts(sink, now)) log(`  [alert] ${a.slice(0, 160)}`);
  try { const p = await runPushCheck({ registry, env: process.env, now, log }); for (const m of p.sent) log(`  [push] ${m.kind}: ${m.title}`); } catch (e) { log(`  [push] check failed: ${(e as Error).message.slice(0, 160)}`); }
  const launched = registry.tokens("live").map((t) => Date.parse(t.baselineAt)).filter((x) => Number.isFinite(x));
  let alerts: { ts: number; kind: string; text: string; seenAt: number | null; sent: boolean }[] | null = null;
  try { alerts = registryAlertRows(registry, now); } catch { alerts = null; }
  publishOps(SITE, buildOpsJson({ now, snapshot: r.snapshot, delta: devFeeDelta(registry, now), alerts, firstLaunchAt: launched.length ? Math.min(...launched) : null, webhook }));
}

log(`burnticker keeper starting — ${registry.tokens("live").length} live token(s) · ledger ${DB} · site ${SITE} · ${cluster}${DRY ? " · DRY RUN" : ""} · program ${program.programId} (${built.real ? `REAL: ${built.why}` : `FAKE — ${built.why}; nothing is sent`}) · ${ops.banner()} · alerts ${ALERTS ? `every ${ALERT_EVERY_MS / 60_000} min${RPC ? " with balances" : " (no BURNTICKER_RPC_URL: balances unknown)"}${webhook.configured ? " → webhook" : " (no BURNTICKER_ALERT_WEBHOOK: local only)"}${pushConfigFromEnv(process.env) ? " + phone push" : ""}` : "off (--once)"}`);
while (!stopping) {
  const paused = fs.existsSync(PAUSE);
  if (paused && !DRY) log(`  ${PAUSE} present — cranks held, reading and publishing go on`);
  // The role, then runCycle: fetch, plan, the foreign-reading fence (after planning, before the first attestation — review 2 F1), execute.
  const { gate, report: cycleReport, error: cycleError } = await ops.cycle(deps, { dryRun: DRY || paused });
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
  if (built.chain && pairCurveEnabled(process.env) && gate.sendsAllowed) {
    try {
      const pc = await crankPairCurves({ ctx: { connection: built.chain.connection, cluster: built.chain.cluster, burnReceiptsProgramId: new PublicKey(PROGRAM_ID!), allowMainnet: process.env.BURNTICKER_MAINNET === "1" }, cranker: built.chain.payer, dryRun: deps.dryRun, log, isUnlinked: (ma, mb) => { const pr = registry.pairOf(ma); return !!pr && (pr.mintA === mb || pr.mintB === mb) && registry.getStatus(`pair.unlinked.${pr.pairId}`) !== null; }, alert: (kind, key, text, meta) => { registry.recordAlert({ kind, key, text, meta }); } });
      if (pc.acted.length || pc.errors.length) log(`pair curve: ${pc.scanned} pair(s) scanned, ${pc.acted.length} cranked${pc.errors.length ? ` · errors: ${pc.errors.slice(0, 3).join(" | ")}` : ""}`);
    } catch (e) { log(`pair curve crank failed: ${(e as Error).message.slice(0, 200)}`); }
  } else if (pairCurveEnabled(process.env) && !built.real) log(`  [pair-curve] ${PAIR_CURVE_FLAG} is set but the program client is the fake — nothing cranked`);
  try { await publishAll(Date.now()); } catch (e) { log(`publish failed: ${(e as Error).message.slice(0, 200)}`); }
  await ops.afterCycle(cycleReport, paused, ALERTS ? sink : null);
  try { const w = writeOwnTokensGenerated(registry, process.env.OWN_TOKENS_GENERATED_PATH?.trim() || undefined); if (w.changed) log(`  [refuse-list] ${w.file} rewritten: ${w.count} platform token(s) — the arms re-read it on their next candidate`); } catch (e) { log(`  [refuse-list] not written: ${(e as Error).message.slice(0, 160)}`); }
  if (ALERTS && Date.now() - lastAlertAt >= ALERT_EVERY_MS) { lastAlertAt = Date.now(); try { await opsCheck(lastAlertAt, paused); } catch (e) { log(`  [alert] check failed: ${(e as Error).message.slice(0, 160)}`); } }
  if (ONCE) break;
  await new Promise((r) => setTimeout(r, 60_000));
}
registry.close();
log("burnticker keeper stopped");
