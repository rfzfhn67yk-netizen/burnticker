// THE BURNTICKER MULTI-TOKEN KEEPER (2026-10-09) — one loop over every live token in data/burnticker.db: read each selector's settled
// results on its schedule, plan receipts with the published rule, run them through the burn_receipts program (attest each closed
// day's unit counter, claim creator fees best-effort, crank, record the program's facts), publish every token's status.json + page
// and the platform index. THIS FILE HOLDS NO KEY: with BURNTICKER_PROGRAM_ID + BURNTICKER_RPC_URL the keeper's own encrypted key is
// read once from BURNTICKER_SIGNER_PATH (it pays fees and signs readings as the attester; it holds no funds) and the real
// ProgramBurnClient is used; without them the chain is the FakeBurnProgram (nothing is sent; the pages say so). Mainnet is refused
// unless BURNTICKER_MAINNET=1. No environment file is read or printed by this script.
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
import { runCycle, type KeeperDeps } from "../src/lib/burnticker/multiKeeper.ts";
import { buildReceiptsJson, buildTokenStatus, lifecycleFrom, pairCounterpartFrom, publishPlatformIndex, publishTokenSite, type TokenStatusJson } from "../src/lib/burnticker/tokenPage.ts";
import { loadPowersRegister, operatorPowersSummary, readAudit } from "../src/lib/burnticker/trust.ts";
import { CrankFailureTracker, devFeeDelta, recordBalanceSample, registryAlertRows, registryAlertSink, rpcBalanceLamports, runBurntickerAlertCheck, sinkFromEnv } from "../src/lib/burnticker/alerts.ts";
import { buildOpsJson, publishOps } from "../src/lib/burnticker/checkin.ts";
import { writeOwnTokensGenerated } from "../src/lib/burnticker/ownTokensSync.ts";
import { readMarket, type MarketReader } from "../src/lib/burnticker/market.ts";
import { nativeSourceById } from "../src/lib/burnticker/sources/native.ts";
import { kalshiEnabled, polymarketDiscoveryEnabled } from "../src/lib/burnticker/venues.ts";
import { DECIMALS, TOTAL_SUPPLY } from "../src/lib/burnticker/rules.ts";
import { DerbyAdapter } from "../src/lib/burnticker/derby/adapter.ts";
import { HermesClient } from "../src/lib/burnticker/derby/pyth.ts";
import { connectionPoolPort } from "../src/lib/burnticker/derby/pools.ts";
import type { FetchLike } from "../src/lib/burnticker/oracle/types.ts";

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
const PROGRAM_ID = process.env.BURNTICKER_PROGRAM_ID?.trim() || null;

/** The real client when the program id, an RPC and the keeper's key exist; the fake otherwise (nothing sent). */
async function buildProgram(): Promise<{ program: BurnProgramClient; real: boolean; why: string }> {
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
  return { program, real: true, why: `program ${PROGRAM_ID} on ${actual}, keeper ${kp.publicKey.toBase58()}` };
}
const built = await buildProgram();
const program = built.program;
// BURN DERBY (2026-10-10): Pyth on Solana (keyless) / Hermes (BURNTICKER_PYTH_API_KEY), pool TWAPs and mint supplies are MAINNET facts
// (BURNTICKER_DERBY_RPC_URL, else the public RPC), cross-reads from Jupiter / DexScreener / RedStone. Withheld windows raise an alert.
const derbyPools = connectionPoolPort(new Connection(process.env.BURNTICKER_DERBY_RPC_URL?.trim() || "https://api.mainnet-beta.solana.com", { commitment: "confirmed", disableRetryOnRateLimit: true }));
const derby = new DerbyAdapter({ registry, hermes: process.env.BURNTICKER_PYTH_API_KEY?.trim() ? HermesClient.fromEnv(process.env) : null, pools: derbyPools, fetchImpl: globalThis.fetch as unknown as FetchLike, now: () => Date.now(), log,
  alert: (key, text) => { registry.recordAlert({ kind: "derby-withheld", key, text, meta: null }); } });
const deps: KeeperDeps = { registry, program, oracles: { kalshi, catalogue: new CatalogueAdapter(), polymarket, derby }, derby: { sample: (t) => derby.sample(t), plan: () => derby.plan(), ended: (t) => derby.ended(t) }, attester, log, now: () => Date.now(), dryRun: DRY || fs.existsSync(PAUSE), kalshiEnabled: kalshiEnabled(process.env) };
const operator = operatorPowersSummary(loadPowersRegister());
const KALSHI_ON = kalshiEnabled(process.env), POLY_DISCOVERY = polymarketDiscoveryEnabled(process.env);
/** Read-only account reads for the coin cards (curve progress, top holders); the same RPC, no key. */
const marketReader: MarketReader | null = RPC ? (new Connection(RPC, { commitment: "confirmed", disableRetryOnRateLimit: true }) as unknown as MarketReader) : null;

async function publishAll(now: number): Promise<void> {
  const statuses: TokenStatusJson[] = [];
  const receiptsByTicker: Record<string, ReturnType<typeof buildReceiptsJson>> = {};
  for (const t of registry.tokens()) {
    try {
      const locked = registry.lockedRule(t);
      const readings = registry.readings(t.selectorKey, t.baselineAt).filter((r) => readingMatches(locked.rule, r));
      const state = registry.state(t.mint);
      const oracle = locked.rule.oracle === "catalogue" ? deps.oracles.catalogue : locked.rule.oracle === "polymarket" ? polymarket : locked.rule.oracle === "derby" ? derby : kalshi;
      // Display reads on the published pages (venues.ts): Kalshi's only with BURNTICKER_KALSHI_ENABLED on; never a Polymarket odds read;
      // Polymarket titles only with discovery on. Settlement reads (fetchDue) are separate.
      const implied = (locked.rule.oracle === "kalshi" && KALSHI_ON) || locked.rule.oracle === "derby" ? await oracle.impliedChance(locked.rule, state.lastValue).catch(() => null) : null;
      const info = locked.rule.oracle === "kalshi" ? (KALSHI_ON ? await kalshi.seriesInfo(locked.rule.series ?? locked.rule.market!.split("-")[0]).catch(() => null) : null)
        : locked.rule.oracle === "polymarket" ? (POLY_DISCOVERY ? await polymarket.seriesInfo(locked.rule.market ?? locked.rule.series!).catch(() => null) : null) : null;
      const feed = locked.rule.oracle === "catalogue" && locked.rule.series ? feedById(locked.rule.series) : null;
      const feedState = registry.feedState(t.selectorKey);
      const input = { token: t, locked, readings, receipts: registry.receipts(t.mint), attesters: registry.attesters(t.mint), state, feedState,
        chain: { cluster, programId: program.programId, supplyRaw: await program.supplyRaw(t.mint), feePdaLamports: await program.feePdaBalanceLamports(t.mint), vaultRaw: locked.mode === "vault" ? await program.vaultBalanceRaw(t.mint) : null, program: await programPageBlock(program, t.mint, registry.lastProgramTx(t.mint, "reading")) },
        now, nextCheckAt: feedState.nextFetchAt, implied, seriesTitle: info?.title ?? feed?.title ?? (locked.rule.oracle === "catalogue" && locked.rule.series ? nativeSourceById(locked.rule.series)?.title ?? null : null), selectorPending: 0, operator, lifecycle: lifecycleFrom(registry, t, locked.rule, null), pair: await pairCounterpartFrom(registry, (m) => program.supplyRaw(m), t, async (m) => { try { return (await program.port(m).config())?.poolRegistered ?? null; } catch { return null; } }),
        // the coin card's curve progress + top holders (read-only, the same RPC); without an RPC status.json says "not read" and the card shows —
        market: marketReader && t.status !== "draft" && t.status !== "expired" ? await readMarket(marketReader, { cluster, mint: t.mint, poolId: t.poolId, feePda: t.feePda, creator: t.creator, totalSupplyRaw: (await program.supplyRaw(t.mint).catch(() => null)) ?? BigInt(TOTAL_SUPPLY) * BigInt(10) ** BigInt(DECIMALS), decimals: DECIMALS }, now).catch(() => null) : null };
      const receipts = buildReceiptsJson(input);
      const status = buildTokenStatus(input, receipts);
      publishTokenSite(SITE, status, receipts, readings, t.rulesJson);
      statuses.push(status); receiptsByTicker[t.ticker] = receipts;
    } catch (e) { log(`  [publish] $${t.ticker}: ${(e as Error).message.slice(0, 160)}`); }
  }
  const audit = readAudit(SITE);
  publishPlatformIndex(SITE, statuses, now, audit ? { ok: audit.ok, ranAt: audit.ranAt, receipts: audit.receipts, mismatches: audit.mismatches.length, chainChecked: audit.chainChecked } : null, receiptsByTicker);
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
  const launched = registry.tokens("live").map((t) => Date.parse(t.baselineAt)).filter((x) => Number.isFinite(x));
  let alerts: { ts: number; kind: string; text: string; seenAt: number | null; sent: boolean }[] | null = null;
  try { alerts = registryAlertRows(registry, now); } catch { alerts = null; }
  publishOps(SITE, buildOpsJson({ now, snapshot: r.snapshot, delta: devFeeDelta(registry, now), alerts, firstLaunchAt: launched.length ? Math.min(...launched) : null, webhook }));
}

log(`burnticker keeper starting — ${registry.tokens("live").length} live token(s) · ledger ${DB} · site ${SITE} · ${cluster}${DRY ? " · DRY RUN" : ""} · program ${program.programId} (${built.real ? `REAL: ${built.why}` : `FAKE — ${built.why}; nothing is sent`}) · alerts ${ALERTS ? `every ${ALERT_EVERY_MS / 60_000} min${RPC ? " with balances" : " (no BURNTICKER_RPC_URL: balances unknown)"}${webhook.configured ? " → webhook" : " (no BURNTICKER_ALERT_WEBHOOK: local only)"}` : "off (--once)"}`);
while (!stopping) {
  const paused = fs.existsSync(PAUSE);
  if (paused && !DRY) log(`  ${PAUSE} present — cranks held, reading and publishing go on`);
  deps.dryRun = DRY || paused;
  try {
    const r = await runCycle(deps);
    tracker.note(r);
    const f = r.fetched.filter((x) => !x.skipped);
    if (f.length || r.planned.length || r.executed.length) log(`cycle: ${f.length} fetch(es), ${r.planned.length} planned, ${r.executed.length} executed${r.errors.length ? ` · errors: ${r.errors.slice(0, 3).join(" | ")}` : ""}`);
    registry.setStatus("lastCycle", { at: Date.now(), fetched: f.length, planned: r.planned.length, executed: r.executed.length, errors: r.errors.slice(0, 5), refusals: r.fetched.flatMap((x) => x.refusals).slice(0, 10) });
  } catch (e) { log(`cycle failed: ${(e as Error).message.slice(0, 200)}`); }
  try { await publishAll(Date.now()); } catch (e) { log(`publish failed: ${(e as Error).message.slice(0, 200)}`); }
  try { const w = writeOwnTokensGenerated(registry, process.env.OWN_TOKENS_GENERATED_PATH?.trim() || undefined); if (w.changed) log(`  [refuse-list] ${w.file} rewritten: ${w.count} platform token(s) — the arms re-read it on their next candidate`); } catch (e) { log(`  [refuse-list] not written: ${(e as Error).message.slice(0, 160)}`); }
  if (ALERTS && Date.now() - lastAlertAt >= ALERT_EVERY_MS) { lastAlertAt = Date.now(); try { await opsCheck(lastAlertAt, paused); } catch (e) { log(`  [alert] check failed: ${(e as Error).message.slice(0, 160)}`); } }
  if (ONCE) break;
  await new Promise((r) => setTimeout(r, 60_000));
}
registry.close();
log("burnticker keeper stopped");
