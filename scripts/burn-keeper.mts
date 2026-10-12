// THE EVENT-INDEXED BURN KEEPER (2026-10-09) — the service behind the owner's first launch, $DEFICIT, whose supply burns are indexed
// to the U.S. national debt (rule key DEBT; mct-runner-study/launch-debt-egg-2026-10-09/SPEC.md §1, §2, §4, §5). THIS FILE HOLDS NO
// KEY; the keeper's own encrypted key is read once at start from BURNKEEPER_SIGNER_PATH (default
// ~/.config/meme-coin-trader/signer-burnkeeper.enc.json, made by scripts/burnkeeper-keygen.mjs) — never the treasury's.
//
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/alias-hook.mjs scripts/burn-keeper.mts [flags]
//
//   --print-rules         print the rule file's path and sha256 (what BURNKEEPER_RULES_SHA must equal on mainnet) and exit
//   --replay=<from>       the real Treasury history from <from> through the planner: every unit day printed, then the BUYBACK
//                         scenarios (fee inflow $20/$100/$500 a day — --scenarios=, at a constant --price-usd=0.001) and the VAULT
//                         mode table (--to=YYYY-MM-DD, --fixture=<json> for a frozen copy instead of the API, --markdown=<file>)
//   --vault-pace          for vault shares of 20/25/30% and a 12-month linear vest: months each lasts at the replay pace and how
//                         often a shortfall would have occurred (--from=, --fixture=, --shares=20,25,30, --vest-days=365, --cliff-days=0)
//   --dry-run             poll, plan and log; no transaction is signed (the chain is read only if BURNKEEPER_RPC_URL/MINT/VAULT are set)
//   --devnet              the cluster must be devnet (or a local validator); BURNKEEPER_RPC_URL defaults to api.devnet.solana.com
//   --once                one cycle, then exit
//   --announce-rules      post the rule file's full sha256 as a memo from the keeper (once, at launch) and exit
//
// EXECUTION (2026-10-10, docs/burnkeeper/README-execution.md): BURNKEEPER_EXECUTION=program (the default whenever BURNTICKER_PROGRAM_ID
// is set) drives the on-chain burn_receipts program — the keeper attests each Treasury reading (submit_reading, its key as the
// attester), claims creator fees into the fee PDA best-effort, cranks (crank_buyback / crank_vault / crank_no_units) and records
// what the program did from its Reading account. BURNKEEPER_EXECUTION=legacy keeps the keeper's own legs below — DEPRECATED, for
// vault-mode-only / dev tokens; it refuses to run for a mint with a TokenConfig or a LaunchLab creator that is a program address.
//
// THE LOOP (SPEC §4): poll the feed at 16:30 and 20:00 America/New_York and on start → validate → plan each new record_date → then,
// in LEGACY execution, by the rule file's mode:
//   buyback (DEPRECATED since 10-10 — superseded by the program's crank_buyback): claim LaunchLab creator fees into the fee pool (BURNKEEPER_CLAIM_CREATOR_FEES=1, keeper = the
//            launch's creator; curve vault + CPMM counters after graduation) → spend = pool × (1 − (1 − f)^units) → ONE market swap
//            SOL → token (validated, simulated, write-ahead)
//            → burn EVERY token held immediately after, with the v2 memo → ledger → status site. Never sells; never holds overnight.
//   vault:   claim vested LaunchLab tokens into the vault (BURNKEEPER_LAUNCHLAB_POOL) → ONE transaction per record_date: BurnChecked
//            from the vault + the v1 memo (a shortfall carried when the vesting vault is short) → ledger → status site.
// Feed down: retry hourly, burn when it returns, never skip a date. RPC down: back off (15 s doubling to 1 h); a date is late, never
// lost. data/PAUSE-burnkeeper stops sends (polling and publishing go on); SIGTERM finishes the cycle and exits.
//
// MAINNET IS REFUSED unless BOTH BURNKEEPER_MAINNET=1 AND BURNKEEPER_RULES_SHA = the loaded rule file's sha256 (the two-key safety) —
// and, in buyback mode, the rule file's "mint" equals BURNKEEPER_MINT (a third key: the keeper can never buy any other coin). The
// cluster is read from the RPC's genesis hash, not from the URL. The ledger is bound to one cluster/mint/vault/keeper/rules hash.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Connection, PublicKey, type Keypair } from "@solana/web3.js";
import { readCpmmMarket, readKeeperCurve, type CpmmReader } from "../src/lib/burnticker/market.ts";
import { loadRules, solToLamports, tokensToRaw, rawToTokens, type LoadedRules } from "../src/lib/burnKeeper/rules.ts";
import { fetchDebtHistoryRows, fetchDebtToPenny, validateDebtResponse, type FeedValidation } from "../src/lib/burnKeeper/feeds/treasury.ts";
import { openLedger, type Ledger } from "../src/lib/burnKeeper/ledger.ts";
import { executePending, feedKey, ingest, tokenKey, type BuybackPort, type ChainPort, type KeeperCtx } from "../src/lib/burnKeeper/cycle.ts";
import { cosignerFromEnv } from "../src/lib/burnticker/attesters/cosign.ts";
import { associatedTokenAddress, clusterOfGenesis, clusterRefusal, explorerUrl, type Cluster } from "../src/lib/burnKeeper/solana.ts";
import { solanaBuyback, solanaChain, type SolanaChain } from "../src/lib/burnKeeper/solanaChain.ts";
import { cpmmProgramFor, launchLabProgramFor } from "../src/lib/burnKeeper/launchlab.ts";
import { burnProgramIdFromEnv, burnPoolFor } from "../src/lib/burnKeeper/burnPool.ts";
import { executeProgramPending, executionModeFromEnv, legacyRefusal, type ProgramCycleReport, type ProgramPort } from "../src/lib/burnKeeper/programChain.ts";
import { solanaProgramPort } from "../src/lib/burnKeeper/programAdapter.ts";
import { fetchTokenConfig } from "../src/lib/burnReceipts/accounts.ts";
import { launchLabPoolId, WSOL_MINT } from "../src/lib/burnKeeper/launchlab.ts";
import { LaunchpadPool } from "@raydium-io/raydium-sdk-v2";
import { backoffMs, nextPollAt } from "../src/lib/burnKeeper/schedule.ts";
import { buildBurnsJson, buildStatus, publishSite, renderIndexHtml, toJson } from "../src/lib/burnKeeper/statusPage.ts";
import { buybackScenariosMarkdown, paceTable, replay, replayMarkdown, vaultPace } from "../src/lib/burnKeeper/replay.ts";
import { attesterGate } from "../src/lib/burnKeeper/attesters/gate.ts";
import { attesterConfigFromEnv, parseAttesterEnv, switchboardAttester } from "../src/lib/burnKeeper/attesters/switchboard.ts";

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const opt = (n: string): string | undefined => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const log = (s: string) => console.log(`[${new Date().toISOString().replace("T", " ").slice(0, 19)}Z] ${s}`);

const RULES_FILE = process.env.BURNKEEPER_RULES?.trim() || "config/burnkeeper/deficit.rules.json";
export const BURNKEEPER_SIGNER_DEFAULT = path.join(os.homedir(), ".config", "meme-coin-trader", "signer-burnkeeper.enc.json");

function readFixture(file: string): { data: unknown[] } {
  const j = JSON.parse(fs.readFileSync(file, "utf8")) as { data?: unknown[] };
  if (!Array.isArray(j.data)) throw new Error(`${file}: no data[]`);
  return { data: j.data };
}

async function historyReadings(from: string, fixture: string | undefined): Promise<{ v: FeedValidation; source: string }> {
  // Fetch from a little before `from` so the replay has a baseline reading.
  const start = new Date(Date.parse(`${from}T00:00:00Z`) - 21 * 86_400_000).toISOString().slice(0, 10);
  const body = fixture ? readFixture(fixture) : await fetchDebtHistoryRows(start);
  const v = validateDebtResponse(body);
  return { v, source: fixture ? `the frozen fixture ${fixture}` : `the live Treasury API (record_date ≥ ${start}, fetched ${new Date().toISOString().slice(0, 10)})` };
}

// ------------------------------------------------------------------------------------------------------------------------------
// One-shot modes
// ------------------------------------------------------------------------------------------------------------------------------

if (flag("print-rules")) {
  const l = loadRules(RULES_FILE);
  console.log(`rules file   ${path.resolve(RULES_FILE)}`);
  console.log(`ticker       $${l.rules.ticker} (rule key ${l.rules.token})`);
  console.log(`sha256       ${l.sha256}`);
  console.log(`memo field   rules=sha256:${l.sha12}`);
  console.log(`mainnet      BURNKEEPER_RULES_SHA=${l.sha256}  (and BURNKEEPER_MAINNET=1)`);
  process.exit(0);
}

if (opt("replay")) {
  const l = loadRules(RULES_FILE);
  const from = opt("replay")!, to = opt("to") ?? "9999-12-31";
  const { v, source } = await historyReadings(from, opt("fixture"));
  if (v.refusals.length) console.error(`feed refusals: ${v.refusals.join("; ")}`);
  const readings = v.readings.filter((r) => r.recordDate <= to);
  const lastDate = readings.length ? readings[readings.length - 1].recordDate : to;
  const startMs = Date.parse(`${from}T00:00:00Z`);
  // 1. THE TRIGGER (both modes): every unit, and what vault mode's 100,000-per-unit burn would ask for with no vault limit at all.
  const appetite = replay(l.rules, readings, from, { kind: "upfront", allocationRaw: tokensToRaw(l.rules.totalSupply, l.rules.decimals), startMs, cliffDays: 0, vestDays: 0 });
  let md = replayMarkdown(l.rules, appetite, { from, to: lastDate, source, sha256: l.sha256,
    vaultLabel: "none — the units the rule counted and the burn VAULT MODE would ask for at 100,000 tokens per unit with no vault limit (the trigger is the same in both modes; buyback mode turns units into a share of the fee pool instead, next section)" });
  // 2. BUYBACK MODE (primary): fee-pool scenarios.
  const inflows = (opt("scenarios") ?? "20,100,500").split(",").map(Number);
  const price = Number(opt("price-usd") ?? "0.001");
  md += `\n${buybackScenariosMarkdown(l.rules, readings, from, lastDate, inflows, price)}`;
  // 3. VAULT MODE (the alternative): the 20/25/30% vesting-vault pace and the rule file's own vault.
  const pace = vaultPace(l.rules, readings, from, [20, 25, 30], l.rules.vault.vestDays, l.rules.vault.cliffDays);
  const own = replay(l.rules, readings, from, { kind: l.rules.vault.kind, allocationRaw: tokensToRaw(l.rules.vaultAllocation, l.rules.decimals), startMs, cliffDays: l.rules.vault.cliffDays, vestDays: l.rules.vault.vestDays });
  const ownLast = own.rows[own.rows.length - 1];
  md += `\n## Vault mode (the alternative) — a vesting vault\n\n${paceTable(pace, { from, to: lastDate, vestDays: l.rules.vault.vestDays, cliffDays: l.rules.vault.cliffDays })}\n\nThe rule file's own vault (${Number(l.rules.vaultAllocation).toLocaleString("en-US")} tokens): ${own.rows.length} burn days, ${ownLast ? `${ownLast.cumPctSupply.toFixed(2)}% of supply burned` : "nothing burned"}, ${own.rows.filter((r) => r.shortOutRaw > BigInt(0)).length} days short${own.exhaustedOn ? `, allocation used up on ${own.exhaustedOn}` : ""}.\n`;
  if (opt("markdown")) { fs.mkdirSync(path.dirname(opt("markdown")!), { recursive: true }); fs.writeFileSync(opt("markdown")!, md); console.log(`wrote ${opt("markdown")}`); }
  console.log(md);
  process.exit(0);
}

if (flag("vault-pace")) {
  const l = loadRules(RULES_FILE);
  const from = opt("from") ?? "2025-01-01";
  const shares = (opt("shares") ?? "20,25,30").split(",").map(Number);
  const vestDays = Number(opt("vest-days") ?? 365), cliffDays = Number(opt("cliff-days") ?? 0);
  const { v } = await historyReadings(from, opt("fixture"));
  const lines = vaultPace(l.rules, v.readings, from, shares, vestDays, cliffDays);
  console.log(paceTable(lines, { from, to: v.readings[v.readings.length - 1]?.recordDate ?? "?", vestDays, cliffDays }));
  process.exit(0);
}

// ------------------------------------------------------------------------------------------------------------------------------
// The service
// ------------------------------------------------------------------------------------------------------------------------------

const DRY = flag("dry-run"), DEVNET = flag("devnet"), ONCE = flag("once");
const loaded: LoadedRules = loadRules(RULES_FILE);
const T = tokenKey(loaded), F = feedKey(loaded);
const DB = process.env.BURNKEEPER_DB?.trim() || path.join("data", DEVNET ? "burnkeeper-devnet.db" : "burnkeeper.db");
const PUBLISH_DIR = process.env.BURNKEEPER_PUBLISH_DIR?.trim() || path.join("data", "burnkeeper-site");
const PAUSE_FILE = path.join("data", "PAUSE-burnkeeper");
const rpcUrl = process.env.BURNKEEPER_RPC_URL?.trim() || (DEVNET ? "https://api.devnet.solana.com" : "");
const mintS = process.env.BURNKEEPER_MINT?.trim(), vaultS = process.env.BURNKEEPER_VAULT?.trim();
const ledger: Ledger = openLedger(DB);

/** Public addresses of every other wallet this machine knows (`<key>.address` files beside the signers) + the treasury default. */
function otherWalletAddresses(selfPath: string): Set<string> {
  const out = new Set<string>(["8sJfoY6Xx6o2zZqmX2Vt6NRwzNPr14Ef6qqRd5YLvGbs"]);   // the treasury's default owner (wallets.ts DEFAULT_SOL_OWNER)
  if (process.env.LIVE_WALLET_ADDRESS?.trim()) out.add(process.env.LIVE_WALLET_ADDRESS.trim());
  const dir = path.join(os.homedir(), ".config", "meme-coin-trader");
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".address") || path.join(dir, f) === `${path.resolve(selfPath)}.address`) continue;
      const a = fs.readFileSync(path.join(dir, f), "utf8").trim();
      if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a)) out.add(a);
    }
  } catch { /* no config dir: nothing to compare against */ }
  return out;
}

async function loadKeeperKey(): Promise<Keypair> {
  const keyPath = process.env.BURNKEEPER_SIGNER_PATH?.trim() || BURNKEEPER_SIGNER_DEFAULT;
  const base = path.basename(keyPath);
  if (base === "signer.enc.json" || base === "signer.json") throw new Error(`BURNKEEPER_SIGNER_PATH points at the treasury's key file (${keyPath}) — refusing`);
  // The keeper's key may carry its own passphrase; otherwise it is encrypted with the shared passphrase (the same encrypted-key format as the other signers on the host).
  if (process.env.BURNKEEPER_SIGNER_PASSPHRASE) process.env.AUTONOMOUS_SIGNER_PASSPHRASE = process.env.BURNKEEPER_SIGNER_PASSPHRASE;
  const { loadKeypair } = await import("@/lib/burnKeeper/keyfile");
  const kp = loadKeypair({ keyPath });
  const addr = kp.publicKey.toBase58();
  if (otherWalletAddresses(keyPath).has(addr)) throw new Error(`the keeper's key ${addr} is the treasury's (or another arm's) address — refusing; create its own with scripts/burnkeeper-keygen.mjs`);
  return kp;
}

interface Runtime { chain: (ChainPort & Partial<SolanaChain>) | null; buyback: BuybackPort | null; program: ProgramPort | null; cluster: Cluster | "none"; keeper: string | null; vault: string | null; connection?: Connection | null }
const BUYBACK = loaded.rules.mode === "buyback";
const EXECUTION = executionModeFromEnv(process.env);
const PROGRAM_ID = burnProgramIdFromEnv(process.env);

/** Program execution: the port over burn_receipts, after checking the TokenConfig exists and belongs to this rule file. */
async function connectProgram(connection: Connection, cluster: Cluster, mint: PublicKey, kp: Keypair): Promise<Runtime> {
  if (!PROGRAM_ID) throw new Error("BURNKEEPER_EXECUTION=program needs BURNTICKER_PROGRAM_ID (the deployed burn_receipts program id)");
  const env = (k: string) => (process.env[k]?.trim() ? new PublicKey(process.env[k]!.trim()) : null);
  const port = solanaProgramPort({ connection, programId: PROGRAM_ID, mint, cluster, payer: kp, attesters: [kp], allowMainnet: process.env.BURNKEEPER_MAINNET === "1",
    launchLabProgram: env("BURNKEEPER_LAUNCHLAB_PROGRAM"), launchLabPool: env("BURNKEEPER_LAUNCHLAB_POOL"), cpmmProgram: env("BURNKEEPER_CPMM_PROGRAM"), log });
  const cfg = await port.config();
  if (!cfg) throw new Error(`no burn_receipts TokenConfig for ${mint.toBase58()} under ${PROGRAM_ID.toBase58()} — initialize_token must run first (docs/burnticker/runbook.md)`);
  if (!cfg.attesters.some((a) => a.key === kp.publicKey.toBase58())) log(`  [attest] WARNING: the keeper key ${kp.publicKey.toBase58()} is not one of the config's attesters (${cfg.attesters.map((a) => a.key).join(", ")}) — readings will be held as quorum-short`);
  const fee = burnPoolFor(PROGRAM_ID, mint).feePda.toBase58();
  ledger.bindIdentity({ cluster: await connection.getGenesisHash(), mint: mint.toBase58(), vault: `program:${PROGRAM_ID.toBase58()}:${fee}`, keeper: kp.publicKey.toBase58(), rulesSha256: loaded.sha256 });
  log(`cluster ${cluster} · EXECUTION program ${PROGRAM_ID.toBase58()} · mode ${cfg.mode} · mint ${mint.toBase58()} · fee PDA ${fee} · attesters ${cfg.attesters.length} (quorum ${cfg.quorum}) · pool ${cfg.pool ?? "not registered"} · keeper ${kp.publicKey.toBase58()} (pays fees, signs readings) · rules sha256:${loaded.sha12}`);
  return { chain: null, buyback: null, program: port, cluster, keeper: kp.publicKey.toBase58(), vault: fee, connection };
}

/** Legacy execution may not run where the program owns the fees (programChain.ts legacyRefusal). */
async function legacyCheck(connection: Connection, cluster: Cluster, mint: PublicKey): Promise<void> {
  const tokenConfigExists = PROGRAM_ID ? !!(await fetchTokenConfig(connection, PROGRAM_ID, mint).catch(() => null)) : false;
  let launchCreator: string | null = null, offCurve = false;
  const llProgram = process.env.BURNKEEPER_LAUNCHLAB_PROGRAM?.trim() ? new PublicKey(process.env.BURNKEEPER_LAUNCHLAB_PROGRAM.trim()) : launchLabProgramFor(cluster);
  if (llProgram) {
    const pool = process.env.BURNKEEPER_LAUNCHLAB_POOL?.trim() ? new PublicKey(process.env.BURNKEEPER_LAUNCHLAB_POOL.trim()) : launchLabPoolId(llProgram, mint, WSOL_MINT);
    const acc = await connection.getAccountInfo(pool, "confirmed").catch(() => null);
    if (acc && acc.owner.equals(llProgram)) { const creator = LaunchpadPool.decode(Buffer.from(acc.data)).creator as PublicKey; launchCreator = creator.toBase58(); offCurve = !PublicKey.isOnCurve(creator.toBuffer()); }
  }
  const refusal = legacyRefusal({ mode: loaded.rules.mode, programId: PROGRAM_ID?.toBase58() ?? null, feePda: PROGRAM_ID ? burnPoolFor(PROGRAM_ID, mint).feePda.toBase58() : null, launchCreator, launchCreatorOffCurve: offCurve, tokenConfigExists, claimCreatorFees: process.env.BURNKEEPER_CLAIM_CREATOR_FEES === "1" });
  if (refusal) throw new Error(refusal);
  if (BUYBACK) log("DEPRECATED: BURNKEEPER_EXECUTION=legacy runs the keeper's own Jupiter buyback leg (its own SOL, its own burn). The program path (crank_buyback) supersedes it; legacy is for vault-mode-only / dev tokens — docs/burnkeeper/README-execution.md");
}

async function connect(): Promise<Runtime> {
  if (!rpcUrl) {
    if (!DRY) throw new Error("BURNKEEPER_RPC_URL is not set (or pass --devnet, or --dry-run)");
    const alloc = tokensToRaw(loaded.rules.vaultAllocation, loaded.rules.decimals);
    const assumePool = solToLamports(process.env.BURNKEEPER_ASSUME_POOL_SOL?.trim() || "1"), assumeSolUsd = Number(process.env.BURNKEEPER_ASSUME_SOL_USD ?? 150);
    log(BUYBACK ? `dry run with no RPC: the fee pool is assumed to hold ${rawToTokens(assumePool, 9)} SOL at $${assumeSolUsd}` : "dry run with no RPC: the vault is assumed to hold its whole allocation");
    const none = async () => { throw new Error("no chain in this dry run"); };
    if (EXECUTION === "program") { log("dry run with no RPC, program execution: readings are planned; nothing is read from or sent to the program"); return { cluster: "none", keeper: null, vault: null, chain: null, buyback: null, program: null }; }
    return { cluster: "none", keeper: null, vault: null, program: null,
      chain: { vaultBalanceRaw: async () => (BUYBACK ? BigInt(0) : alloc), findMemoOnChain: async () => null, signatureStatuses: async (s) => s.map(() => null), blockHeight: async () => 0, buildSigned: none, simulate: none, send: none, confirm: none },
      buyback: BUYBACK ? { feeBalanceLamports: async () => assumePool, solUsd: async () => assumeSolUsd, buildSwap: none, swapReceivedRaw: none } : null };
  }
  const connection = new Connection(rpcUrl, "confirmed");
  const cluster = clusterOfGenesis(await connection.getGenesisHash());
  const refusal = clusterRefusal({ cluster, devnetFlag: DEVNET, env: process.env, rulesSha256: loaded.sha256, mode: loaded.rules.mode, rulesMint: loaded.rules.mint });
  if (refusal) throw new Error(refusal);
  if (!mintS) throw new Error("BURNKEEPER_MINT must be set");
  if (loaded.rules.mint && loaded.rules.mint !== mintS) throw new Error(`BURNKEEPER_MINT ${mintS} is not the rule file's mint ${loaded.rules.mint} — refusing`);
  const mint = new PublicKey(mintS);
  const kp = await loadKeeperKey();
  if (EXECUTION === "program") return connectProgram(connection, cluster, mint, kp);
  await legacyCheck(connection, cluster, mint);
  // Buyback mode burns from the keeper's OWN associated token account (where the router delivers); vault mode from BURNKEEPER_VAULT.
  const ata = associatedTokenAddress(kp.publicKey, mint);
  if (BUYBACK && vaultS && vaultS !== ata.toBase58()) throw new Error(`buyback mode burns from the keeper's own token account ${ata.toBase58()}; BURNKEEPER_VAULT is ${vaultS} — unset it or fix it`);
  if (!BUYBACK && !vaultS) throw new Error("BURNKEEPER_VAULT must be set in vault mode");
  const vault = BUYBACK ? ata : new PublicKey(vaultS!);
  const pool = process.env.BURNKEEPER_LAUNCHLAB_POOL?.trim();
  const program = process.env.BURNKEEPER_LAUNCHLAB_PROGRAM?.trim() ? new PublicKey(process.env.BURNKEEPER_LAUNCHLAB_PROGRAM.trim()) : launchLabProgramFor(cluster);
  const chain = solanaChain({ connection, keeper: kp, mint, vault, decimals: loaded.rules.decimals, cluster, log,
    priorityMicroLamports: Number(process.env.BURNKEEPER_PRIORITY_MICROLAMPORTS ?? 0) || 0,
    launchLab: !BUYBACK && pool && program ? { programId: program, poolId: new PublicKey(pool) } : null,
    // BURNKEEPER_CLAIM_CREATOR_FEES=1: before a burn day the keeper moves the creator fees into THE BURN POOL — the burn program's fee
    // PDA for the mint (BURNTICKER_PROGRAM_ID = the deployed burn_receipts id; burnPool.ts, review H-2): the bonding-curve vault through
    // the program's permissionless claim (once its IDL carries it) and, once graduated, the CPMM counters through Raydium's
    // permissionless collect (creatorFees.ts). The keeper only pays. BURNKEEPER_CPMM_PROGRAM overrides the cluster's CPMM program.
    creatorFees: BUYBACK && process.env.BURNKEEPER_CLAIM_CREATOR_FEES === "1" && program
      ? { programId: program, burnProgram: burnProgramIdFromEnv(process.env) ?? (() => { throw new Error("BURNKEEPER_CLAIM_CREATOR_FEES=1 needs BURNTICKER_PROGRAM_ID (the deployed burn_receipts program): the creator fees belong to its fee PDA, not to this key"); })(),
          cpmmProgram: process.env.BURNKEEPER_CPMM_PROGRAM?.trim() ? new PublicKey(process.env.BURNKEEPER_CPMM_PROGRAM.trim()) : cpmmProgramFor(cluster), launchLabPool: pool ? new PublicKey(pool) : undefined }
      : null });
  // The vault check: vault mode needs the vault to exist and be the keeper's; buyback mode's account appears with the first swap.
  const exists = !!(await connection.getAccountInfo(vault, "confirmed"));
  if (!BUYBACK || exists) { const vr = await chain.checkVault(); if (vr) throw new Error(`vault check: ${vr}`); }
  const buyback = BUYBACK ? solanaBuyback({ connection, keeper: kp, mint, slippageBps: loaded.rules.buyback.slippageBps }) : null;
  ledger.bindIdentity({ cluster: await connection.getGenesisHash(), mint: mint.toBase58(), vault: vault.toBase58(), keeper: kp.publicKey.toBase58(), rulesSha256: loaded.sha256 });
  log(`cluster ${cluster} · mode ${loaded.rules.mode} · mint ${mint.toBase58()} · ${BUYBACK ? "token account" : "vault"} ${vault.toBase58()} · keeper ${kp.publicKey.toBase58()} · rules sha256:${loaded.sha12}${pool && !BUYBACK ? ` · LaunchLab pool ${pool}` : ""}`);
  return { chain, buyback, program: null, cluster, keeper: kp.publicKey.toBase58(), vault: vault.toBase58(), connection };
}

/**
 * BURNKEEPER_ATTESTER=switchboard:<feedPubkey> (attesters/switchboard.ts, docs/burnkeeper/attestation.md): a second, independent
 * reading of the same Treasury row; the cycle signs nothing new for a date until it agrees with the keeper's figure (quorum 2).
 */
function buildAttester(rt: Runtime) {
  const spec = parseAttesterEnv(process.env);
  if (!spec) return null;
  if (!rt.connection) throw new Error("BURNKEEPER_ATTESTER needs an RPC (set BURNKEEPER_RPC_URL or --devnet)");
  const cfg = attesterConfigFromEnv(process.env);
  const conn = rt.connection;
  const gate = attesterGate({ attester: switchboardAttester({ connection: conn, feedPubkey: spec.feedPubkey, expectedFeedHash: cfg.expectedFeedHash }), ledger, token: T, feed: F,
    toleranceBps: cfg.toleranceBps, maxAgeMs: cfg.maxAgeMs, maxStalenessSlots: cfg.maxStalenessSlots, currentSlot: () => conn.getSlot("confirmed"), log, now: () => Date.now() });
  log(`second attester ${gate.id} · tolerance ${cfg.toleranceBps} bps · max age ${cfg.maxAgeMs / 60_000} min${cfg.maxStalenessSlots != null ? ` · max ${cfg.maxStalenessSlots} slots` : ""}${cfg.expectedFeedHash ? ` · feed hash ${cfg.expectedFeedHash.slice(0, 12)}…` : ""} — quorum 2: no burn without its agreement`);
  return gate;
}

const state = { feedRetryAt: 0, feedFailures: 0, lastPoll: null as { at: number; outcome: string } | null, lastError: null as string | null, stopping: false, lastProgram: null as ProgramCycleReport | null };

async function pollFeed(now: number): Promise<void> {
  const last = ledger.lastReading(T, F);
  try {
    let v: FeedValidation;
    if (!last) {
      const baselineDate = process.env.BURNKEEPER_BASELINE_DATE?.trim();
      if (baselineDate) {
        // The owner names the baseline (the last reading before launch): history from it, and the planner starts there.
        const rows = await fetchDebtHistoryRows(baselineDate);
        v = validateDebtResponse(rows);
        if (!v.readings.length || v.readings[0].recordDate !== baselineDate) throw new Error(`BURNKEEPER_BASELINE_DATE ${baselineDate} is not a Treasury record_date`);
      } else {
        const latest = await fetchDebtToPenny({ pageSize: 1 });
        v = latest;   // the newest reading becomes the baseline; nothing is burned for it
      }
    } else {
      v = await fetchDebtToPenny({ pageSize: 30, prev: { recordDate: last.recordDate, cents: last.cents } });
      const oldestNew = v.readings[0]?.recordDate;
      if (oldestNew && v.readings.length >= 29) {
        // The keeper was away long enough that the page may not reach back to its last reading: read the history instead.
        v = validateDebtResponse(await fetchDebtHistoryRows(last.recordDate), { prev: { recordDate: last.recordDate, cents: last.cents } });
      }
    }
    const r = ingest(ctx, v);
    state.feedFailures = 0; state.feedRetryAt = 0;
    state.lastPoll = { at: now, outcome: r.refusals.length ? `held: ${r.refusals[0]}` : `${r.written} new reading(s)` };
    if (r.refusals.length) state.feedRetryAt = now + 3_600_000;   // a refused feed is re-read hourly, like an outage
  } catch (e) {
    state.feedFailures++;
    state.feedRetryAt = now + Math.min(3_600_000, backoffMs(state.feedFailures - 1, 3_600_000));
    state.lastPoll = { at: now, outcome: `feed unreachable: ${(e as Error).message.slice(0, 120)}` };
    log(`  [feed] unreachable (${(e as Error).message.slice(0, 120)}) — retrying at ${new Date(state.feedRetryAt).toISOString()}`);
  }
  ledger.setStatus("lastPoll", state.lastPoll ?? {}, now);
}

async function publish(rt: Runtime, now: number): Promise<void> {
  let supplyRaw: bigint | null = null, vaultRaw: bigint | null = null, feeLamports: bigint | null = null;
  let program = null as Parameters<typeof buildStatus>[0]["program"];
  if (rt.program) {
    const cfg = await rt.program.config().catch(() => null);
    try { feeLamports = await rt.program.feePdaLamports(); } catch { /* unknown */ }
    try { supplyRaw = await rt.program.supplyRaw(); } catch { /* from the ledger */ }
    program = { programId: rt.program.programId, configAddress: rt.program.configAddress, feePda: rt.program.feePda, config: cfg, feePdaLamports: feeLamports, programReadings: ledger.programReadings(T, F), keeperAttesterKeys: rt.program.attesterKeys(), lastHealth: state.lastProgram?.health ?? null, lastClaims: state.lastProgram?.claims ?? null };
  } else if (EXECUTION === "program") program = { programId: PROGRAM_ID?.toBase58() ?? "unset", configAddress: "—", feePda: "—", config: null, feePdaLamports: null, programReadings: ledger.programReadings(T, F), keeperAttesterKeys: [] };
  if (rt.chain && rt.cluster !== "none") {
    try { vaultRaw = await rt.chain.vaultBalanceRaw(); } catch { /* shown as unknown */ }
    try { supplyRaw = rt.chain.supplyRaw ? await rt.chain.supplyRaw() : null; } catch { /* shown from the ledger */ }
    try { feeLamports = rt.buyback ? await rt.buyback.feeBalanceLamports() : null; } catch { /* shown as unknown */ }
  }
  // "Where the money came from" (buyback): public facts the owner sets once — the creator-fee source and the seed deposit.
  const funding = BUYBACK ? { creatorFeeSource: process.env.BURNKEEPER_CREATOR_FEE_SOURCE?.trim() || null, seedTx: process.env.BURNKEEPER_SEED_TX?.trim() || null, seedSol: process.env.BURNKEEPER_SEED_SOL?.trim() || null } : null;
  // website-14 (LAUNCHPAD-PATH §75): the coin's own raise and progress, read from its LaunchLab pool, so no page prints a typed 85
  let curve: Awaited<ReturnType<typeof readKeeperCurve>> = null;
  if (rt.connection && mintS && (rt.cluster === "mainnet" || rt.cluster === "devnet")) curve = await readKeeperCurve(rt.connection, { cluster: rt.cluster, mint: mintS, poolId: process.env.BURNKEEPER_LAUNCHLAB_POOL?.trim() || null }, now);
  // indexer-1 (WIRING.md step 5): after graduation, the registered Raydium pool's figures for status.json
  const poolCfg = program?.config ?? null;
  const poolMarket = rt.connection && mintS && (rt.cluster === "mainnet" || rt.cluster === "devnet") && poolCfg?.poolRegistered && poolCfg.pool
    ? await readCpmmMarket(rt.connection as unknown as CpmmReader, { cluster: rt.cluster, mint: mintS, poolId: poolCfg.pool }, now) : null;
  const input = { loaded, readings: ledger.readings(T, F), burns: ledger.burns(T, F), now, curve, poolMarket, nextPollAt: nextPollAt(now, loaded.rules.schedule.polls, loaded.rules.schedule.timeZone), lastPoll: state.lastPoll, lastError: state.lastError,
    funding, program, chain: { cluster: rt.cluster, mint: mintS ?? null, vault: rt.vault ?? vaultS ?? null, keeper: rt.keeper, supplyRaw, vaultRaw, feeLamports } };
  const burns = buildBurnsJson(input);
  const status = buildStatus(input, burns);
  publishSite(PUBLISH_DIR, { "status.json": toJson(status), "burns.json": toJson(burns), "rules.json": loaded.text, "index.html": renderIndexHtml(status, burns, input.readings.map((r) => ({ recordDate: r.recordDate, amount: r.amount }))) });
}

const ctx: KeeperCtx = { ledger, loaded, log, now: () => Date.now(), dryRun: DRY, attester: null, cosigner: cosignerFromEnv(process.env) };
// signer-2 (2026-10-12): unset BURNTICKER_COSIGNER_URL = no cosigner, nothing changes.
if (ctx.cosigner) log(`second signer: ${process.env.BURNTICKER_COSIGNER_URL?.trim()} (each reading is co-signed there or held)`);

async function cycle(rt: Runtime, pollNow: boolean): Promise<void> {
  const now = Date.now();
  if (pollNow) await pollFeed(now);
  const pending = ledger.pendingBurns(T, F);
  if (EXECUTION === "program") {
    // The program path runs every cycle (not only with pending burns): baseline and zero-unit readings are attested too.
    if (!rt.program) { if (pending.length) log(`  [program] ${pending.length} burn day(s) planned; no RPC in this dry run — nothing read from or sent to the program`); }
    else if (fs.existsSync(PAUSE_FILE) && !DRY) log(`  [program] ${PAUSE_FILE} present — readings and cranks held, nothing sent`);
    else {
      try {
        const rep = await executeProgramPending({ ...ctx, now: () => Date.now() }, rt.program);
        state.lastProgram = rep;
        const err = rep.cranks.find((r) => r.outcome === "error") ?? null;
        const refused = rep.readings.find((r) => r.outcome === "refused") ?? null;
        state.lastError = err && err.outcome === "error" ? `${err.recordDate}: ${err.why}` : refused ? `${refused.recordDate}: ${refused.why}` : null;
        for (const r of rep.cranks) if (r.outcome === "confirmed" && rt.cluster !== "none") log(`  [burn] ${r.recordDate}: ${rawToTokens(r.burnRaw, loaded.rules.decimals)} burned by the program · ${explorerUrl(rt.cluster, r.signature)}`);
      } catch (e) { state.lastError = (e as Error).message.slice(0, 300); log(`  [program] ${state.lastError}`); }
    }
  } else if (pending.length && rt.chain) {
    if (fs.existsSync(PAUSE_FILE) && !DRY) log(`  [burn] ${PAUSE_FILE} present — ${pending.length} burn(s) held, nothing sent`);
    else {
      if (!DRY && !BUYBACK && rt.chain.tryClaim) { try { await rt.chain.tryClaim(); } catch (e) { log(`  [claim] ${(e as Error).message.slice(0, 120)}`); } }
      if (!DRY && BUYBACK && rt.chain.tryClaimCreatorFees) { try { await rt.chain.tryClaimCreatorFees(); } catch (e) { log(`  [fees] ${(e as Error).message.slice(0, 120)}`); } }
      if (!DRY && BUYBACK && rt.chain.claimGraduatedCreatorFees) { try { await rt.chain.claimGraduatedCreatorFees(); } catch (e) { log(`  [fees/cpmm] ${(e as Error).message.slice(0, 120)}`); } }
      const res = await executePending({ ...ctx, now: () => Date.now() }, rt.chain, rt.buyback ?? undefined);
      const err = res.find((r) => r.outcome === "error");
      state.lastError = err && err.outcome === "error" ? `${err.recordDate}: ${err.why}` : null;
      for (const r of res) if (r.outcome === "confirmed" && rt.cluster !== "none") log(`  [burn] ${r.recordDate}: ${rawToTokens(r.burnRaw, loaded.rules.decimals)} burned · ${explorerUrl(rt.cluster, r.signature)}`);
    }
  }
  try { await publish(rt, Date.now()); } catch (e) { log(`  [publish] failed: ${(e as Error).message.slice(0, 160)}`); }
}

async function main(): Promise<void> {
  log(`burn keeper starting — $${loaded.rules.ticker} (rule ${loaded.rules.token}, sha256:${loaded.sha12}) · execution ${EXECUTION}${EXECUTION === "legacy" ? " (DEPRECATED)" : ""}${DRY ? " · DRY RUN" : ""}${DEVNET ? " · devnet" : ""} · ledger ${DB} · site ${PUBLISH_DIR}`);
  const rt = await connect();
  ctx.attester = buildAttester(rt);
  if (flag("announce-rules")) {
    if (EXECUTION === "program") throw new Error("--announce-rules is a legacy step: in program execution the rule file's sha256 is in the TokenConfig (rules_sha256, set by initialize_token) and in every memo the program writes");
    if (DRY || !rt.chain?.sendMemoOnly) throw new Error("--announce-rules needs a live (not dry-run) keeper with an RPC");
    const sig = await rt.chain.sendMemoOnly(`${loaded.rules.token}|RULES|ticker=${loaded.rules.ticker}|sha256=${loaded.sha256}|v1`);
    log(`rules announced on chain: ${explorerUrl(rt.cluster, sig)}`);
    return;
  }
  for (const s of ["SIGTERM", "SIGINT"] as const) process.on(s, () => { state.stopping = true; log(`${s}: finishing the current cycle`); });
  let nextPoll = Date.now();   // poll on start
  while (!state.stopping) {
    const now = Date.now();
    const due = now >= nextPoll || (state.feedRetryAt > 0 && now >= state.feedRetryAt);
    await cycle(rt, due);
    if (due) nextPoll = nextPollAt(Date.now(), loaded.rules.schedule.polls, loaded.rules.schedule.timeZone);
    if (ONCE) break;
    const first = ledger.pendingBurns(T, F)[0];
    const wakes = [nextPoll, state.feedRetryAt || Infinity, first ? Math.max(Date.now() + 15_000, first.nextAttemptAt ?? Date.now() + 60_000) : Infinity, Date.now() + 15 * 60_000];
    const until = Math.min(...wakes);
    while (!state.stopping && Date.now() < until) await new Promise((r) => setTimeout(r, Math.min(5_000, Math.max(0, until - Date.now()))));
  }
  ledger.close();
  log("burn keeper stopped");
}

main().catch((e) => { log(`FATAL: ${(e as Error).message}`); process.exit(1); });
