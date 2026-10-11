// THE burn_receipts ADMIN CLI (2026-10-10) — the program's one-off instructions from the command line, DRY-RUN BY DEFAULT. THIS FILE
// PRINTS NO KEY. Every instruction is built by the TypeScript client (src/lib/burnReceipts, account order and flags from the IDL);
// the dry run prints it decoded, simulates it on the cluster and shows the accounts it would leave behind, and signs nothing.
//
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/alias-hook.mjs scripts/burnreceipts-admin.mts <command> [flags]
//
// Commands:
//   initialize-token           --mint <keypath|pubkey> --creator <keypath|pubkey> --admin <pubkey> [--rules config/burnkeeper/deficit.rules.json]
//                              [--attester <pubkey>]... [--quorum 1] [--launchlab-platform <pubkey>] [--floor-lamports 1000000]
//                              [--twap-window 1200] [--twap-deviation-bps 300] [--fixed-pool <pubkey>]
//                              Prints the rules file's sha256 it will PIN on chain (publish it) and the RuleParams derived from the file.
//                              Buyback + pool policy 0 needs --launchlab-platform (its cpConfigId / LP scales / platformCpCreator are pinned).
//   register-pool              --mint <pubkey> --pool <pubkey> [--fixed]       (policy 0 passes the token's LaunchLab pool automatically)
//   claim-launchlab-creator-fee --mint <pubkey>
//   check-pool-health          --mint <pubkey>
//   initialize-platform        --upgrade-authority <keypath|pubkey> --authority <pubkey> --sunset <unix seconds|ISO date> [--cranker <pubkey>]...
//                              (the cap is always the 25 SOL default at creation; ≤ 3 crankers, enforced only while the cap is in force)
//   set-registration-policy    --mint <pubkey> --admin <keypath|pubkey> --policy 0|1 [--pool <pubkey>]   (48 h timelock; stranding recovery)
//   cancel-registration-policy --mint <pubkey> --admin <keypath|pubkey>
//   apply-registration-policy  --mint <pubkey> [--pool <pubkey>] [--launchlab-platform]
//                              (after the timelock, before the 14-day expiry; --pool for a fixed-pool switch; --launchlab-platform passes
//                              the PINNED platform so its current cpConfigId counts as LaunchLab-known for a < 90 %-locked pool)
//   veto-registration-policy   --mint <pubkey> --attester <keypath|pubkey>    (any current attester kills a pending proposal)
//   verify-platform-pins       --mint <pubkey>    READ-ONLY LAUNCH GATE (README §5): re-reads the pinned LaunchLab platform and
//                              exits 1 if platformCpCreator, the LP lock/burn scales or cpConfigId differ from initialize_token's pins.
//                              Run it IMMEDIATELY before LaunchLab's create; never create on a non-zero exit.
//
// Common flags:
//   --cluster devnet|mainnet|localnet   required; checked against the RPC's genesis hash (--rpc <url> overrides the default endpoint)
//   --program <pubkey>                  the deployed burn_receipts id (default env BURNTICKER_PROGRAM_ID, else the IDL's localnet test id)
//   --payer <keypath|pubkey>            pays fees / rent. A pubkey is enough for a dry run (simulated without signatures).
//   --dry-run (default) | --send        --send needs every signer as a KEY FILE (keyfile.ts: solana-keygen JSON or an encrypted .enc.json,
//                                       never inside the repository); on mainnet it also needs --i-understand-this-spends-real-sol.
//
// The RPC appears in the output and in errors as scheme + host only (re-check R3-5: a key in the URL's path, query or userinfo is
// never printed).
//
// Output: one JSON document on stdout — the instruction decoded (program, accounts with names / signer / writable, args), the
// simulation (error, logs, compute units), the resulting accounts decoded (TokenConfig / PlatformConfig / balances), and the signature
// if sent. Progress lines go to stderr.

import fs from "node:fs";
import path from "node:path";
import { Connection, Keypair, PublicKey, TransactionMessage, VersionedTransaction, type TransactionInstruction, ComputeBudgetProgram } from "@solana/web3.js";
import { BURN_RECEIPTS_IDL } from "../src/lib/burnReceipts/idl.ts";
import { decodeType } from "../src/lib/burnReceipts/idlCoder.ts";
import { decodePlatformConfig, decodeTokenConfig, fetchTokenConfig } from "../src/lib/burnReceipts/accounts.ts";
import { BURN_RECEIPTS_LOCALNET_PROGRAM_ID, BURN_RECEIPTS_TEST_PROGRAM_ID, CPMM_PROGRAM_ID, type Cluster, GENESIS_HASH, MODE_BUYBACK, POOL_POLICY_CREATOR_IS_FEE_PDA, POOL_POLICY_FIXED } from "../src/lib/burnReceipts/constants.ts";
import { applyRegistrationPolicyIx, cancelRegistrationPolicyIx, checkPoolHealthIx, claimLaunchlabCreatorFeeIx, createAtaIdempotentIx, initializePlatformIx, initializeTokenIx, operatorAttester, registerPoolIx, setRegistrationPolicyIx, vetoRegistrationPolicyIx } from "../src/lib/burnReceipts/instructions.ts";
import { verifyPlatformPins } from "../src/lib/burnReceipts/platformPins.ts";
import { configPda, feePda, feeWsolAddress, platformPda } from "../src/lib/burnReceipts/pda.ts";
import { ruleParamsFromKeeperRules } from "../src/lib/burnReceipts/math.ts";
import { fetchCpmmPool } from "../src/lib/burnReceipts/cpmm.ts";
import { confirmByPolling, poolAccountsOrStandIns, redactRpcUrl } from "../src/lib/burnReceipts/crank.ts";
import { loadRules } from "../src/lib/burnKeeper/rules.ts";

const args = process.argv.slice(2);
const COMMANDS = ["initialize-token", "register-pool", "claim-launchlab-creator-fee", "check-pool-health", "initialize-platform", "set-registration-policy", "cancel-registration-policy", "apply-registration-policy", "veto-registration-policy", "verify-platform-pins"] as const;
type Command = (typeof COMMANDS)[number];
const CMD = (COMMANDS as readonly string[]).includes(args[0]) ? (args[0] as Command) : null;
const flag = (n: string) => args.includes(`--${n}`);
const opts = (n: string): string[] => args.flatMap((a, i) => (a === `--${n}` && args[i + 1] && !args[i + 1].startsWith("--") ? [args[i + 1]] : a.startsWith(`--${n}=`) ? [a.slice(n.length + 3)] : []));
const opt = (n: string): string | undefined => opts(n)[0];
const say = (s: string) => console.error(s);
const die = (s: string, code = 2): never => { console.error(`refusing: ${s}`); process.exit(code); };

if (!CMD) { say(fs.readFileSync(new URL(import.meta.url)).toString().split("\n").filter((l) => l.startsWith("//")).map((l) => l.slice(3)).join("\n")); process.exit(args[0] ? 2 : 0); }

const CLUSTER = opt("cluster");
if (CLUSTER !== "devnet" && CLUSTER !== "mainnet" && CLUSTER !== "localnet") die("--cluster devnet|mainnet|localnet is required");
const cluster = CLUSTER as Cluster;
const SEND = flag("send");
if (SEND && cluster === "mainnet" && !flag("i-understand-this-spends-real-sol")) die("--send on mainnet also needs --i-understand-this-spends-real-sol");
const rpc = opt("rpc")?.trim() || (cluster === "devnet" ? "https://api.devnet.solana.com" : cluster === "mainnet" ? "https://api.mainnet-beta.solana.com" : "http://127.0.0.1:8899");
const connection = new Connection(rpc, "confirmed");
// Re-check R3-5: scheme + host[:port] only — an API key in the path, query or userinfo of a custom --rpc never reaches the output.
const rpcShown = redactRpcUrl(rpc);
{
  const genesis = await connection.getGenesisHash();
  const actual = genesis === GENESIS_HASH.mainnet ? "mainnet" : genesis === GENESIS_HASH.devnet ? "devnet" : "localnet";
  if (actual !== cluster) die(`the RPC ${rpcShown} is ${actual} (genesis ${genesis}) but --cluster says ${cluster}`);
}
const programArg = pubkeyOf(opt("program") ?? process.env.BURNTICKER_PROGRAM_ID, "--program");
const programId = programArg ?? BURN_RECEIPTS_LOCALNET_PROGRAM_ID;
if (!programArg && cluster !== "localnet") say(`warning: no --program / BURNTICKER_PROGRAM_ID — using the IDL's address ${programId.toBase58()}`);
if (programId.equals(BURN_RECEIPTS_TEST_PROGRAM_ID) && cluster !== "localnet") say("warning: the program id is the retired LOCALNET test key (GV9CMj…SuF8) — no deployed program");

// ---------------------------------------------------------------------------------------------------------------------------------
// Keys and parties: a KEY FILE (loaded through keyfile.ts, never printed) or, for a dry run, just a pubkey.
// ---------------------------------------------------------------------------------------------------------------------------------
function pubkeyOf(v: string | undefined, what: string): PublicKey | null {
  if (!v) return null;
  try { return new PublicKey(v.trim()); } catch { return die(`${what}: ${v} is not a pubkey`); }
}
interface Party { publicKey: PublicKey; key: Keypair | null }
async function party(name: string, required = true): Promise<Party | null> {
  const v = opt(name);
  if (!v) return required ? die(`--${name} <keypath|pubkey> is required`) : null;
  if (fs.existsSync(v) && fs.statSync(v).isFile()) {
    if (["signer.enc.json", "signer.json"].includes(path.basename(v))) die(`--${name}: ${v} is the treasury's key file`);
    if (process.env.BURNKEEPER_SIGNER_PASSPHRASE && !process.env.AUTONOMOUS_SIGNER_PASSPHRASE) process.env.AUTONOMOUS_SIGNER_PASSPHRASE = process.env.BURNKEEPER_SIGNER_PASSPHRASE;
    const { loadKeypair } = await import("../src/lib/burnKeeper/keyfile.ts");
    const key = loadKeypair({ keyPath: v });
    return { publicKey: key.publicKey, key };
  }
  const pk = pubkeyOf(v, `--${name}`)!;
  if (SEND) die(`--send needs --${name} as a key file, not a pubkey`);
  return { publicKey: pk, key: null };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Describe / simulate / send
// ---------------------------------------------------------------------------------------------------------------------------------
function describe(ix: TransactionInstruction): Record<string, unknown> {
  if (!ix.programId.equals(programId)) return { program: ix.programId.toBase58(), accounts: ix.keys.map((k) => ({ pubkey: k.pubkey.toBase58(), signer: k.isSigner, writable: k.isWritable })), dataHex: Buffer.from(ix.data).toString("hex") };
  const def = BURN_RECEIPTS_IDL.instructions.find((i) => Buffer.from(i.discriminator).equals(Buffer.from(ix.data.subarray(0, 8))));
  if (!def) return { program: programId.toBase58(), dataHex: Buffer.from(ix.data).toString("hex") };
  let off = 8;
  const decoded: Record<string, unknown> = {};
  for (const a of def.args) { const r = decodeType(BURN_RECEIPTS_IDL, a.type, Buffer.from(ix.data), off); decoded[a.name] = r.value; off = r.end; }
  return { program: programId.toBase58(), instruction: def.name, accounts: ix.keys.map((k, i) => ({ name: def.accounts[i]?.name ?? `remaining_${i}`, pubkey: k.pubkey.toBase58(), signer: k.isSigner, writable: k.isWritable })), args: decoded };
}
const jsonSafe = (v: unknown): unknown => JSON.parse(JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x instanceof PublicKey ? x.toBase58() : x instanceof Uint8Array ? Buffer.from(x).toString("hex") : x?.type === "Buffer" && Array.isArray(x.data) ? Buffer.from(x.data).toString("hex") : x)));

interface Watch { address: PublicKey; kind: "TokenConfig" | "PlatformConfig" | "lamports" | "token" }
function decodeWatch(w: Watch, data: Buffer | null, lamports: number | null): unknown {
  if (!data && lamports === null) return null;
  if (w.kind === "lamports") return { lamports };
  if (!data || data.length === 0) return { lamports, data: "empty" };
  try {
    if (w.kind === "TokenConfig") { const c = decodeTokenConfig(data); return { ...c, feed_id: c.feedId, memo_prefix: c.memoPrefix, memo_source: c.memoSource }; }
    if (w.kind === "PlatformConfig") return decodePlatformConfig(data);
    return { amount: data.readBigUInt64LE(64) };
  } catch (e) { return { undecodable: (e as Error).message }; }
}

async function run(ixs: TransactionInstruction[], payer: Party, signers: Party[], watch: Watch[], extra: Record<string, unknown> = {}): Promise<never> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const all = [ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), ...ixs];
  const tx = new VersionedTransaction(new TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: blockhash, instructions: all }).compileToLegacyMessage());
  const sim = await connection.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed", accounts: { encoding: "base64", addresses: watch.map((w) => w.address.toBase58()) } });
  const after = (sim.value.accounts ?? []).map((a, i) => ({ address: watch[i].address.toBase58(), kind: watch[i].kind, state: decodeWatch(watch[i], a ? Buffer.from(a.data[0], "base64") : null, a ? a.lamports : null) }));
  const out: Record<string, unknown> = { command: CMD, cluster, rpc: rpcShown, programId: programId.toBase58(), dryRun: !SEND, ...extra,
    instructions: ixs.map(describe), simulation: { err: sim.value.err ? JSON.stringify(sim.value.err) : null, unitsConsumed: sim.value.unitsConsumed ?? null, logs: sim.value.logs ?? [] }, resultingAccounts: after };
  if (SEND) {
    if (sim.value.err) { console.log(JSON.stringify(jsonSafe(out), null, 2)); die("the simulation failed — nothing sent", 1); }
    const keys = [payer, ...signers].map((p) => p.key ?? die("a signer is a pubkey, not a key file"));
    const unique = keys.filter((k, i) => keys.findIndex((x) => x.publicKey.equals(k.publicKey)) === i);
    const real = new VersionedTransaction(new TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: blockhash, instructions: all }).compileToLegacyMessage());
    real.sign(unique);
    const signature = await connection.sendRawTransaction(real.serialize(), { skipPreflight: true, maxRetries: 5 });
    const err = await confirmByPolling(connection, signature, lastValidBlockHeight);
    out.sent = { signature, err: err ? JSON.stringify(err) : null };
    const now = await Promise.all(watch.map(async (w) => { const a = await connection.getAccountInfo(w.address, "confirmed"); return { address: w.address.toBase58(), kind: w.kind, state: decodeWatch(w, a ? Buffer.from(a.data) : null, a ? a.lamports : null) }; }));
    out.accountsAfterSend = now;
  }
  console.log(JSON.stringify(jsonSafe(out), null, 2));
  process.exit(sim.value.err ? 1 : 0);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------------------------------------------------------------
if (CMD === "verify-platform-pins") {
  // READ-ONLY (no payer, no transaction): the R3-3 launch gate.
  const mint = pubkeyOf(opt("mint"), "--mint") ?? die("--mint <pubkey> is required");
  const r = await verifyPlatformPins(connection, programId, mint, cluster);
  console.log(JSON.stringify({ command: CMD, cluster, rpc: rpcShown, programId: programId.toBase58(), mint: mint.toBase58(), ...r }, null, 2));
  if (!r.ok) die(`the LaunchLab platform no longer matches the pins — do NOT run LaunchLab's create: ${r.mismatches.join("; ")}`, 1);
  say("platform pins hold: platformCpCreator, LP lock/burn scales and cpConfigId are as pinned at initialize_token");
  process.exit(0);
}
const payer: Party = (await party("payer", false)) ?? (CMD === "initialize-platform" ? await party("upgrade-authority") : CMD === "set-registration-policy" || CMD === "cancel-registration-policy" ? await party("admin") : CMD === "veto-registration-policy" ? await party("attester") : null) ?? die("--payer <keypath|pubkey> is required");
const mintArg = (): PublicKey => pubkeyOf(opt("mint"), "--mint") ?? die("--mint <pubkey> is required");
const tokenWatch = (mint: PublicKey): Watch[] => [{ address: configPda(programId, mint), kind: "TokenConfig" }, { address: feePda(programId, mint), kind: "lamports" }];

if (CMD === "initialize-token") {
  const mint = (await party("mint"))!;
  const creator = (await party("creator"))!;
  const admin = pubkeyOf(opt("admin"), "--admin") ?? die("--admin <pubkey> is required (the Squads vault PDA — the config authority)");
  const rulesFile = opt("rules") ?? "config/burnkeeper/deficit.rules.json";
  const loaded = loadRules(rulesFile);
  if (loaded.rules.mint && loaded.rules.mint !== mint.publicKey.toBase58()) die(`${rulesFile} names mint ${loaded.rules.mint}, not ${mint.publicKey.toBase58()}`);
  const fixedPool = pubkeyOf(opt("fixed-pool"), "--fixed-pool");
  const buyback = loaded.rules.mode === "buyback";
  const rule = ruleParamsFromKeeperRules(loaded.rules, {
    floorLamports: buyback ? BigInt(opt("floor-lamports") ?? 1_000_000) : BigInt(0),
    maxTwapDeviationBps: buyback ? Number(opt("twap-deviation-bps") ?? 300) : 0,
    twapWindowSecs: buyback ? Number(opt("twap-window") ?? 1_200) : 0,
  });
  if (fixedPool) rule.pool_policy = POOL_POLICY_FIXED;
  const attesters = opts("attester").map((a) => operatorAttester(pubkeyOf(a, "--attester")!));
  if (!attesters.length) die("--attester <pubkey> (the keeper's data key) is required, up to 5");
  const launchlabPlatform = pubkeyOf(opt("launchlab-platform"), "--launchlab-platform") ?? undefined;
  if (rule.mode === MODE_BUYBACK && rule.pool_policy === POOL_POLICY_CREATOR_IS_FEE_PDA && !launchlabPlatform) die("buyback with pool policy 0 needs --launchlab-platform <pubkey> (pinned at init)");
  const ix = initializeTokenIx({ programId, payer: payer.publicKey, creator: creator.publicKey, mint: mint.publicKey, launchlabPlatform, args: {
    feed_id: loaded.rules.feed.id, memo_prefix: loaded.rules.memo.prefix, memo_source: loaded.rules.feed.memoSource, rules_sha256: Buffer.from(loaded.sha256, "hex"), rule,
    attesters, quorum: Number(opt("quorum") ?? 1), fixed_pool: fixedPool ?? PublicKey.default, admin,
  } });
  say(`rules ${rulesFile}: sha256 ${loaded.sha256} — this is the hash the program PINS; publish it`);
  await run([ix], payer, [creator, mint], tokenWatch(mint.publicKey), { rulesFile, rulesSha256: loaded.sha256, ruleParams: rule, feePda: feePda(programId, mint.publicKey).toBase58(), config: configPda(programId, mint.publicKey).toBase58() });
}
if (CMD === "register-pool") {
  const mint = mintArg();
  const pool = pubkeyOf(opt("pool"), "--pool") ?? die("--pool <pubkey> is required");
  const p = await fetchCpmmPool(connection, pool, CPMM_PROGRAM_ID[cluster]);
  const ix = registerPoolIx({ programId, registrar: payer.publicKey, mint, pool, lpMint: p.lpMint, cluster, fixedPool: flag("fixed") });
  await run([ix], payer, [], tokenWatch(mint), { pool: pool.toBase58(), lpMint: p.lpMint.toBase58(), poolCreator: p.poolCreator.toBase58(), lpSupply: p.lpSupply });
}
if (CMD === "claim-launchlab-creator-fee") {
  const mint = mintArg();
  const fee = feePda(programId, mint);
  const ixs = [createAtaIdempotentIx({ payer: payer.publicKey, owner: fee, mint: new PublicKey("So11111111111111111111111111111111111111112"), ata: feeWsolAddress(programId, mint) }), claimLaunchlabCreatorFeeIx({ programId, payer: payer.publicKey, mint, cluster })];
  await run(ixs, payer, [], [{ address: feeWsolAddress(programId, mint), kind: "token" }, { address: fee, kind: "lamports" }]);
}
if (CMD === "check-pool-health") {
  const mint = mintArg();
  const cfg = (await fetchTokenConfig(connection, programId, mint)) ?? die(`no TokenConfig for ${mint.toBase58()}`);
  if (!cfg.config.poolRegistered) die("no pool registered");
  const pool = await poolAccountsOrStandIns({ connection, programId, mint, cluster }, cfg.config.cpmm_pool);
  await run([checkPoolHealthIx({ programId, caller: payer.publicKey, mint, pool: pool.pool, wsolVault: pool.wsolVault })], payer, [], tokenWatch(mint), { poolAccountMissing: pool.missing });
}
if (CMD === "initialize-platform") {
  const ua = (await party("upgrade-authority"))!;
  const authority = pubkeyOf(opt("authority"), "--authority") ?? die("--authority <pubkey> is required (the Squads vault PDA)");
  const s = opt("sunset") ?? die("--sunset <unix seconds|ISO date> is required (≤ 365 days out and ≤ 2027-10-01)");
  const sunset = /^\d+$/.test(s) ? BigInt(s) : BigInt(Math.floor(Date.parse(s) / 1000));
  const crankers = opts("cranker").map((c) => pubkeyOf(c, "--cranker")!);
  const ix = initializePlatformIx({ programId, payer: payer.publicKey, upgradeAuthority: ua.publicKey, authority, burnPoolCapLamports: BigInt(25_000_000_000), capSunsetTs: sunset, crankers });
  await run([ix], payer, [ua], [{ address: platformPda(programId), kind: "PlatformConfig" }]);
}
if (CMD === "set-registration-policy" || CMD === "cancel-registration-policy") {
  const mint = mintArg();
  const admin = (await party("admin"))!;
  if (CMD === "cancel-registration-policy") await run([cancelRegistrationPolicyIx({ programId, admin: admin.publicKey, mint })], payer, [admin], tokenWatch(mint));
  const policy = Number(opt("policy") ?? die("--policy 0|1 is required"));
  const pool = pubkeyOf(opt("pool"), "--pool") ?? PublicKey.default;
  if (policy === POOL_POLICY_FIXED && pool.equals(PublicKey.default)) die("--policy 1 needs --pool <pubkey>");
  await run([setRegistrationPolicyIx({ programId, admin: admin.publicKey, mint, policy, pool })], payer, [admin], tokenWatch(mint));
}
if (CMD === "apply-registration-policy") {
  const mint = mintArg();
  const pool = pubkeyOf(opt("pool"), "--pool");
  const lpMint = pool ? (await fetchCpmmPool(connection, pool, CPMM_PROGRAM_ID[cluster])).lpMint : undefined;
  let launchlabPlatform: PublicKey | undefined;
  if (flag("launchlab-platform")) {
    const cfg = (await fetchTokenConfig(connection, programId, mint)) ?? die(`no TokenConfig for ${mint.toBase58()}`);
    if (cfg.config.ll_platform.equals(PublicKey.default)) die("--launchlab-platform: this token has no pinned LaunchLab platform");
    launchlabPlatform = cfg.config.ll_platform;
  }
  await run([applyRegistrationPolicyIx({ programId, caller: payer.publicKey, mint, cluster, pool: pool ?? undefined, lpMint, launchlabPlatform })], payer, [], tokenWatch(mint));
}
if (CMD === "veto-registration-policy") {
  const mint = mintArg();
  const attester = (await party("attester"))!;
  await run([vetoRegistrationPolicyIx({ programId, attester: attester.publicKey, mint })], payer, [attester], tokenWatch(mint));
}
