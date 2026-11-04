/**
 * THE OPERATOR'S TOP-UP TOOL (2026-10-19, src/lib/burnticker/ops/topUp.ts). The keeper refills the operations wallets by itself every
 * cycle (on unless BURNTICKER_TOP_UP=off); this script shows the same plan from the live configuration, or runs one pass by hand.
 *
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/alias-hook.mjs scripts/ops/top-up.mts --plan  [--env <file>]
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/alias-hook.mjs scripts/ops/top-up.mts --apply [--env <file>]
 *
 *   --plan    reads only: the keeper key, the upload wallet, its Irys balance and the $DEFICIT keeper key, the floors and fill levels,
 *             and the transfers a pass would make (and the ones it would refuse, with the reason). Opens the registry read-only. Needs
 *             BURNTICKER_KEEPER_PUBKEY (or the signer's .address file), BURNTICKER_RPC_URL and, for the payer targets,
 *             BURNTICKER_UPLOAD_PAYER.
 *   --apply   one pass of the executor: loads the keeper key (BURNTICKER_SIGNER_PATH and its passphrase, as the keeper does), sends the
 *             planned transfers (each simulated first) and records each one in the registry's top_ups table, exactly as the keeper
 *             does. HB-108: it REFUSES while a keeper leads on this host (the leading keeper holds data/burnticker-top-up.lock and
 *             refreshes it every cycle; stop the keeper, or wait KEEPER_LOCK_TTL_MS after a stop, first) and while data/PAUSE-burnticker
 *             exists; for its one pass it holds the same lock, so a keeper that starts leading meanwhile skips its own step.
 *   --clear-drain <target>  clears the drain stop for one target (upload-payer-wallet, irys-balance or deficit-keeper) after the
 *             operator has found why it drained: the top-ups so far stop counting toward the stop. Writes one registry status row.
 *             HB-180: a drain stop is latched and never resumes on its own; this is the only way to release it. The daily ceiling
 *             (BURNTICKER_TOP_UP_MAX_SOL_PER_DAY, default 0.5 SOL) is not cleared here: it lapses at 00:00 UTC.
 *
 * The env file is parsed here, not sourced. No key material or env value is printed: public keys, balances and signatures only.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Connection, PublicKey } from "@solana/web3.js";
import { CLI_LOCK_TTL_MS, clearDrainStop, withCeilingFromEnv, connectionTransfer, deficitKeeperAddress, describeStep, irysPayerAccount, topUpPaths, loadTopUpConfig, planTopUps, readTopUpInput, releaseTopUpLock, runTopUps, solText, takeTopUpLock, topUpModeFromEnv, uploadPayerAddress, TARGET_LABEL, TOP_UP_TARGETS, type TopUpDeps, type TopUpTarget } from "@/lib/burnticker/ops/topUp";

const args = process.argv.slice(2);
const has = (f: string) => args.includes(f);
const flag = (name: string): string | null => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] ?? null : null; };
const envFile = flag("--env");
if (envFile) {
  for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
    const m = /^\s*(?:export\s+)?([A-Z0-9_]+)=(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}
const apply = has("--apply");
// reviewer finding A: the lock and PAUSE files from the same root the keeper uses (its working directory, the repository root); run from
// anywhere else, the guards would look at the wrong files, so the tool refuses
const ROOT = process.cwd();
if (!fs.existsSync(path.join(ROOT, "config", "burnticker"))) { console.error(`run this from the repository root (no config/burnticker under ${ROOT}): the top-up lock and PAUSE files are resolved from it`); process.exit(2); }
const { lock: LOCK_FILE, pause: PAUSE_FILE } = topUpPaths(ROOT);
const clearTarget = flag("--clear-drain");
if (has("--clear-drain")) {
  if (!clearTarget || !TOP_UP_TARGETS.includes(clearTarget as TopUpTarget)) { console.error(`--clear-drain takes one of ${TOP_UP_TARGETS.join(", ")}`); process.exit(2); }
  const { openRegistry } = await import("@/lib/burnticker/registry");
  const reg = openRegistry(process.env.BURNTICKER_DB?.trim() || path.join("data", "burnticker.db"));
  try { clearDrainStop(reg, clearTarget as TopUpTarget, Date.now()); console.log(`the drain stop for ${TARGET_LABEL[clearTarget as TopUpTarget]} is cleared; the next keeper cycle refills it if it is below its floor`); }
  finally { reg.close(); }
  process.exit(0);
}
if (!apply && !has("--plan")) { console.error("pass --plan (reads only), --apply (one pass of the executor) or --clear-drain <target>"); process.exit(2); }
if (apply && fs.existsSync(PAUSE_FILE)) { console.error(`${PAUSE_FILE} is present: PAUSE holds every SOL move, so --apply is refused. Remove the file first if the pause is over.`); process.exit(2); }
const env = process.env;
const rpc = env.BURNTICKER_RPC_URL?.trim();
if (!rpc) { console.error("BURNTICKER_RPC_URL is not set (pass --env <file> or export it)"); process.exit(2); }
const cluster = env.BURNTICKER_CLUSTER?.trim() === "mainnet" ? "mainnet" : "devnet";
const keyPath = env.BURNTICKER_SIGNER_PATH?.trim() || path.join(os.homedir(), ".config", "meme-coin-trader", "signer-burnticker.enc.json");
if (/^signer(\.enc)?\.json$/.test(path.basename(keyPath))) { console.error(`BURNTICKER_SIGNER_PATH points at the treasury's key file (${keyPath}): refused`); process.exit(2); }
let signerAddress = env.BURNTICKER_KEEPER_PUBKEY?.trim() || "";
if (!signerAddress) try { signerAddress = fs.readFileSync(`${keyPath}.address`, "utf8").trim(); } catch { signerAddress = ""; }
if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(signerAddress)) { console.error("the keeper key's public key is unknown: set BURNTICKER_KEEPER_PUBKEY"); process.exit(2); }
const payer = uploadPayerAddress(env);
if (cluster !== "mainnet" && !payer) { console.log(`${cluster} without an upload payer: the keeper skips top-ups here, nothing to plan`); process.exit(0); }

const ceil = withCeilingFromEnv(loadTopUpConfig(), env);
if (ceil.note) console.log(ceil.note);
const config = ceil.config;
const conn = new Connection(rpc, { commitment: "confirmed" });
let irys: TopUpDeps["irys"] = null;
if (payer) { try { irys = await irysPayerAccount(env, cluster); } catch (e) { console.log(`the Irys client did not load (${(e as Error).message.slice(0, 120)}); the payer targets are left out`); } }
const deficit = config.deficitKeeper.enabled ? deficitKeeperAddress(cluster, config.deficitKeeper.operatorRole) : null;
const now = Date.now();
const log = (s: string) => console.log(s);
const dbFile = env.BURNTICKER_DB?.trim() || path.join("data", "burnticker.db");

console.log(`cluster ${cluster} · keeper key ${signerAddress} · upload wallet ${payer ?? "not configured"} · $DEFICIT keeper ${deficit ?? "not resolved"} · BURNTICKER_TOP_UP ${topUpModeFromEnv(env)}`);

if (!apply) {
  if (!fs.existsSync(dbFile)) { console.error(`the registry ${dbFile} does not exist (set BURNTICKER_DB)`); process.exit(2); }
  const db = new DatabaseSync(dbFile, { readOnly: true });
  const liveCoins = Number((db.prepare("SELECT COUNT(*) AS n FROM tokens WHERE status='live'").get() as { n: number }).n);
  const deps: TopUpDeps = { signerAddress, readLamports: async (a) => BigInt(await conn.getBalance(new PublicKey(a), "confirmed")), transfer: async () => ({ status: "failed", signature: null, error: "--plan sends nothing" }), irys, deficitKeeper: deficit };
  const plan = planTopUps(await readTopUpInput({ db, liveCoins, config, deps, now, log }));
  db.close();
  console.log(`\nkeeper key   ${solText(plan.signer.lamports)} SOL · floor ${solText(plan.signer.floor)} · reserve today ${solText(plan.signer.reserve)} (floor + ${solText(plan.signer.expectedFeesPerDay)} expected fees) · covers ${plan.signerDays === null ? "unknown" : `about ${Math.floor(plan.signerDays)} days`}`);
  for (const l of plan.levels) console.log(`${TARGET_LABEL[l.target].padEnd(28)} ${l.balance === null ? "unread" : `${solText(l.balance)} SOL`} · floor ${solText(l.floor)} · fill ${solText(l.fill)}${l.address ? ` · ${l.address}` : ""}`);
  console.log(`ceiling      ${solText(plan.ceiling.spentLamports)} of ${solText(plan.ceiling.limitLamports)} SOL sent this UTC day (${plan.ceiling.day})${plan.ceiling.stopped ? ": STOPPED until 00:00 UTC" : ""}`);
  console.log(`today        ${plan.today.count} top-up(s), ${solText(plan.today.signerLamports)} SOL from the keeper key · 50-launch mark ${solText(plan.noticeMarkLamports)} SOL${plan.overNotice ? " (ABOVE it)" : ""}`);
  console.log(plan.steps.length ? `\na pass would:` : `\na pass would do nothing: every wallet is at or above its floor`);
  for (const s of plan.steps) console.log(`  ${describeStep(s)}`);
  for (const r of plan.refused) console.log(`  refused ${r.target}: ${r.reason}`);
  if (plan.signerShort) console.log(`\n${plan.signerShort.text}`);
  process.exit(0);
}

const { loadKeypair } = await import("@/lib/burnKeeper/keyfile");
const kp = loadKeypair({ keyPath, passphrase: env.BURNTICKER_SIGNER_PASSPHRASE?.trim() || undefined });
if (kp.publicKey.toBase58() !== signerAddress) { console.error(`the key at ${keyPath} (${kp.publicKey.toBase58()}) is not BURNTICKER_KEEPER_PUBKEY ${signerAddress}: refused`); process.exit(2); }
// HB-108: one sender at a time. The leading keeper holds this lock (refreshed every cycle); while it does, --apply is refused.
const lock = takeTopUpLock(LOCK_FILE, "cli", Date.now(), CLI_LOCK_TTL_MS);
if (!lock.ok) {
  console.error(lock.held.holder === "keeper"
    ? `a keeper leads on this host and holds ${LOCK_FILE} (until ${new Date(lock.held.expiresAt).toISOString()} unless it runs another cycle): refused. The keeper refills the wallets itself; to run a pass by hand, stop the keeper first.`
    : `another --apply pass (pid ${lock.held.pid}) holds ${LOCK_FILE}: refused`);
  process.exit(2);
}
process.on("exit", () => { try { releaseTopUpLock(LOCK_FILE, "cli", Date.now()); } catch { /* lapses on its own */ } });
const { openRegistry } = await import("@/lib/burnticker/registry");
const reg = openRegistry(dbFile);
try {

  // reviewer finding A: the pass re-takes its lock before every step (as the keeper does); a lost lock stops the pass before a send
  const refreshLock = (): boolean => takeTopUpLock(LOCK_FILE, "cli", Date.now(), CLI_LOCK_TTL_MS).ok;
  const r = await runTopUps({ registry: reg, config, mode: topUpModeFromEnv(env), now, log, refreshLock, alert: (kind, key, text, meta) => reg.recordAlert({ kind, key, text, meta }, now),
    deps: { signerAddress, readLamports: async (a) => BigInt(await conn.getBalance(new PublicKey(a), "confirmed")), transfer: connectionTransfer(conn, kp), irys, deficitKeeper: deficit } });
  if (!r) process.exit(1);
  console.log(r.done.length ? `\n${r.done.length} step(s) recorded: ${r.done.map((d) => `${d.target} ${d.kind} ${solText(d.lamports)} SOL ${d.status}${d.signature ? ` ${d.signature}` : ""}`).join("; ")}` : r.skipped.length ? `\nnothing sent: ${r.skipped.join("; ")}` : "\nnothing to do: every wallet is at or above its floor");
} finally { reg.close(); }
