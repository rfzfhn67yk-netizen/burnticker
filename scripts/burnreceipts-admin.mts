// THE burn_receipts ADMIN CLI (2026-10-10) — the program's one-off instructions from the command line, DRY-RUN BY DEFAULT. THIS FILE
// PRINTS NO KEY. Every instruction is built by the TypeScript client (src/lib/burnReceipts, account order and flags from the IDL);
// the dry run prints it decoded, simulates it on the cluster and shows the accounts it would leave behind, and signs nothing.
//
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/alias-hook.mjs scripts/burnreceipts-admin.mts <command> [flags]
//
// Commands:
//   initialize-token           --mint <keypath|pubkey> --creator <keypath|pubkey> --admin <pubkey> [--rules config/burnkeeper/deficit.rules.json]
//                              (--mint-keypair <path> is the same as --mint <keypath>; a new coin's mint ends in burn or BURN since
//                              2026-10-14: grind it with scripts/burnticker-grind-mint.mts; a plain one is warned, never refused, so the
//                              coins made before then keep working)
//                              [--attester <pubkey>]... [--quorum 1] [--launchlab-platform <pubkey>] [--floor-lamports 1000000]
//                              [--twap-window 1200] [--twap-deviation-bps 300] [--fixed-pool <pubkey>]
//                              [--end-sink flagship:<min lamports> | incinerator:<min> (round 5) | mint:<mint>:<min> | pair-winner:<partner>:<min>]   (§45: pins the
//                              coin's EndSink; omitted = none, the hashed wind-down. The flagship itself never takes one.)
//                              [--program-round 3|4|5]   the deployed program's initialize_token layout: default from
//                              BURNTICKER_INITIALIZE_TOKEN_LAYOUT (r3 | r4 | r5), else 3; --end-sink implies 4; 5 sends round 4's bytes
//                              (round 5: a coin that burns another token runs pin-burn-target next, before the mint exists)
//                              Prints the rules file's sha256 it will PIN on chain (publish it) and the RuleParams derived from the file.
//                              Buyback + pool policy 0 needs --launchlab-platform (its cpConfigId / LP scales / platformCpCreator are pinned).
//   register-pool              --mint <pubkey> --pool <pubkey> [--fixed]       (policy 0 passes the token's LaunchLab pool automatically)
//   claim-launchlab-creator-fee --mint <pubkey>
//   register-fee-key           --mint <pubkey> [--nft <Fee Key mint>]   LAUNCHPAD-PATH §35: records the coin's permanent LP lock (Raydium's
//                              CPMM lock position whose Fee Key the FEE_KEYS PDA holds). Policy 0: run it BEFORE register-pool, on the
//                              migration pool (PDA of the pinned cpConfigId), position locked by LaunchLab's vault authority (r2 RL-2/RL-3).
//                              Without --nft it scans the lock program for the pool's positions and takes the eligible one with the most LP.
//   claim-lock-fees            --mint <pubkey>  collects the locked LP's fees: SOL 80 % to the fee PDA, 20 % to
//                              the compiled operator treasury; the coin side burned (default: everything accrued)
//   check-pool-health          --mint <pubkey>
//   submit-reading             --mint <pubkey> --date YYYYMMDD --value <raw integer> --attester <keypath>... [--source-url <url>]
//                              (what the keeper does: the quorum signs the canonical message; Ed25519SigVerify + submit_reading)
//   crank                      --mint <pubkey>   the next reading in line (keeper plan: no-units / buyback / for a paired coin that
//                              lost the period, forward_to_winner; a paired coin's buyback passes its PairLink + PairResult)
//   LAUNCHPAD-PATH §40 — winner takes the burn:
//   link-pair                  --pair <pair_curve Pair pubkey>   (link_pair: the Pair witnesses both mints; before register_pair_pool)
//   submit-pair-result         --mint-a <pubkey> --mint-b <pubkey> --date YYYYMMDD --winner <mint|draw> --attester <keypath>...
//                              [--source-url <url>]   (a quorum of EACH coin's attesters signs BURNRECEIPTS-PAIR-v1|…)
//   forward-to-winner          --loser <mint> --winner <mint> --date YYYYMMDD   (the loser's fuel for the period → the winner's fee PDA)
//   unlink-pair                --mint-a <pubkey> --mint-b <pubkey> [--pair <pair_curve Pair>]   (r3: terminal evidence only — the Pair
//                              Voided / a side refunding (required for policy 2), or a LaunchLab pair's voidBy ended without both pools)
//   pair-status                --mint <pubkey> [--date YYYYMMDD]   READ-ONLY: pair_state, the PairLink, the period's PairResult
//   LAUNCHPAD-PATH §45 — end sinks:
//   submit-rule-end            --mint <pubkey> --date YYYYMMDD --outcome resolved|void --attester <keypath>... [--source-url <url>]
//   forward-on-end             --mint <pubkey>   (after a RESOLVED end: the program's destination, computed by planForwardOnEnd)
//   end-status                 --mint <pubkey>   READ-ONLY: end_state, the EndSink, the RuleEnd and what forward_on_end would do
//   Round 5 — burn targets (a coin that burns another token; crank above runs crank_target_burn for such a coin):
//   check-target               --target-mint <pubkey> --pool <pubkey> --feed <hex> [--mint <coin>] [--max-dev-bps 300]   READ-ONLY: the
//                              program's admission (CPMM or AMM v4 pool, Pyth sponsored feeds), from chain
//   pin-burn-target            --mint <keypath> --target-mint <pubkey> --pool <pubkey> --feed <hex>   (mint-signed, after initialize-token,
//                              before the coin's mint exists; refused in plain words when the admission fails)
//   target-status              --mint <pubkey>   READ-ONLY: burn_target_kind, the BurnTarget, and the pinned pool's admission now
//   propose-target-pool        --mint <pubkey> --admin <keypath|pubkey> --pool <pubkey>   (48 h; the target token never changes)
//   cancel-target-pool         --mint <pubkey> --admin <keypath|pubkey>
//   veto-target-pool           --mint <pubkey> --attester <keypath|pubkey>   (any current attester)
//   apply-target-pool          --mint <pubkey>   (after 48 h, within 14 days; the proposed pool passes the same admission)
//   release-target             --mint <pubkey> [--flagship <mint>]   (round-5 review R5-6, permissionless: a stalled target coin's carried
//                              spend to the flagship's fee PDA; the program refuses it while the target still burns)
//   initialize-platform        --upgrade-authority <keypath|pubkey> --authority <pubkey> --sunset <unix seconds|ISO date> [--cranker <pubkey>]...
//                              (the cap is always the 25 SOL default at creation; ≤ 3 crankers, enforced only while the cap is in force)
//   set-registration-policy    --mint <pubkey> --admin <keypath|pubkey> --policy 0|1 [--pool <pubkey>]   (48 h timelock; stranding recovery)
//   cancel-registration-policy --mint <pubkey> --admin <keypath|pubkey>
//   apply-registration-policy  --mint <pubkey> [--pool <pubkey>] [--launchlab-platform]
//                              (after the timelock, before the 14-day expiry; --pool for a fixed-pool switch; --launchlab-platform passes
//                              the PINNED platform so its current cpConfigId counts as LaunchLab-known for a < 90 %-locked pool)
//   veto-registration-policy   --mint <pubkey> --attester <keypath|pubkey>    (any current attester kills a pending proposal)
//   verify-platform-pins       --mint <pubkey>    READ-ONLY LAUNCH GATE (README §5): re-reads the pinned LaunchLab platform and
//                              exits 1 if platformCpCreator, the LP lock/burn scales or cpConfigId differ from initialize_token's pins,
//                              or if the platform does not lock 100 % of the LP to the fee-keys PDA (LP locked forever, 2026-10-10).
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

import { matchesSuffix } from "@/lib/burnticker/vanityMint";
import fs from "node:fs";
import path from "node:path";
import { Connection, Keypair, PublicKey, TransactionMessage, VersionedTransaction, type TransactionInstruction, ComputeBudgetProgram } from "@solana/web3.js";
import { BURN_RECEIPTS_IDL } from "../src/lib/burnReceipts/idl.ts";
import { decodeType } from "../src/lib/burnReceipts/idlCoder.ts";
import { decodeLockedLiquidity, decodePlatformConfig, decodeTokenConfig, fetchFeeKeyRecord, fetchTokenConfig } from "../src/lib/burnReceipts/accounts.ts";
import { BURN_RECEIPTS_LOCALNET_PROGRAM_ID, BURN_RECEIPTS_TEST_PROGRAM_ID, CPMM_PROGRAM_ID, type Cluster, assertSignableGenesis, GENESIS_HASH, LAUNCHLAB_PROGRAM_ID, LOCK_CPMM_PROGRAM_ID, NATIVE_MINT, MODE_BUYBACK, OPERATOR_TREASURY, POOL_POLICY_CREATOR_IS_FEE_PDA, POOL_POLICY_FIXED } from "../src/lib/burnReceipts/constants.ts";
import { applyRegistrationPolicyIx, cancelRegistrationPolicyIx, checkPoolHealthIx, claimLaunchlabCreatorFeeIx, claimLockFeesIx, registerFeeKeyIx, createAtaIdempotentIx, initializePlatformIx, initializeTokenIx, initializeTokenLayoutFromEnv, operatorAttester, registerPoolIx, setRegistrationPolicyIx, submitReadingIx, vetoRegistrationPolicyIx } from "../src/lib/burnReceipts/instructions.ts";
import { verifyPlatformPins } from "../src/lib/burnReceipts/platformPins.ts";
import { checkLpLockPins } from "../src/lib/burnticker/lpLockPins.ts";
import { associatedTokenAddress, configPda, cpmmPoolPda, feeKeyRecordPda, launchlabMigrationLocker, feeKeysPda, feePda, feeWsolAddress, platformPda, readingPda } from "../src/lib/burnReceipts/pda.ts";
import { ruleParamsFromKeeperRules } from "../src/lib/burnReceipts/math.ts";
import { attestPairResult, fetchPairLink, fetchPairResult, forwardToWinnerIx, linkPairIx, PAIR_STATE_PAIRED, pairLinkPda, pairResultFor, pairResultPda, submitPairResultIx, unlinkPairIx } from "../src/lib/burnReceipts/pairs.ts";
import { attestRuleEnd, END_SINK_FLAGSHIP, END_SINK_INCINERATOR, FLAGSHIP_MINT, END_SINK_MINT, END_SINK_PAIR_WINNER, END_STATE_RESOLVED, END_STATE_VOID, fetchEndSink, fetchRuleEnd, endSinkPda, planForwardOnEnd, ruleEndPda, submitRuleEndIx } from "../src/lib/burnReceipts/endSink.ts";
import { attestReading, sourceUrlHash } from "../src/lib/burnReceipts/attestation.ts";
import { fetchCpmmPool } from "../src/lib/burnReceipts/cpmm.ts";
import { confirmByPolling, planCrank, poolAccountsOrStandIns, redactRpcUrl } from "../src/lib/burnReceipts/crank.ts";
import { loadRules } from "../src/lib/burnKeeper/rules.ts";
import { applyTargetPoolIx, BURN_TARGET_EXTERNAL, burnTargetPda, cancelTargetPoolIx, checkTargetAdmission, fetchBurnTarget, pinBurnTargetIx, proposeTargetPoolIx, vetoTargetPoolIx, releaseTargetIx } from "../src/lib/burnReceipts/burnTarget.ts";

const args = process.argv.slice(2);
const COMMANDS = ["initialize-token", "register-pool", "claim-launchlab-creator-fee", "check-pool-health", "initialize-platform", "set-registration-policy", "cancel-registration-policy", "apply-registration-policy", "veto-registration-policy", "verify-platform-pins", "register-fee-key", "claim-lock-fees", "submit-reading", "crank", "link-pair", "submit-pair-result", "forward-to-winner", "unlink-pair", "pair-status", "submit-rule-end", "forward-on-end", "end-status", "check-target", "pin-burn-target", "target-status", "propose-target-pool", "cancel-target-pool", "veto-target-pool", "apply-target-pool", "release-target"] as const;
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
  // The IDL is the current (round-4) one; a round-3 instruction (INITIALIZE_TOKEN layout "r3", the default until the mainnet upgrade)
  // carries fewer bytes than the IDL's arg list. Decode as far as the bytes go and say so, instead of failing the whole dry run.
  let note: string | null = null;
  for (const a of def.args) {
    try { const r = decodeType(BURN_RECEIPTS_IDL, a.type, Buffer.from(ix.data), off); decoded[a.name] = r.value; off = r.end; }
    catch (e) { note = `the remaining args (${a.name} onward) are not in these bytes: this is an older (round-3) layout of ${def.name}, decoded with the current IDL — ${(e as Error).message}`; break; }
  }
  if (note) decoded.__note = note;
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
  // LP LOCKED FOREVER (2026-10-10): the platform must lock 100 % of the LP (1,000,000 / 0 / 0) to the burn program's fee-keys PDA.
  const platAcc = r.pinned.platform === PublicKey.default.toBase58() ? null : await connection.getAccountInfo(new PublicKey(r.pinned.platform), "confirmed");
  const lp = checkLpLockPins(platAcc?.data ?? null, { programId, cluster, requireTreasury: cluster === "mainnet", platformId: r.pinned.platform === PublicKey.default.toBase58() ? null : r.pinned.platform });
  console.log(JSON.stringify({ command: CMD, cluster, rpc: rpcShown, programId: programId.toBase58(), mint: mint.toBase58(), ...r, lpLock: lp }, null, 2));
  if (!r.ok) die(`the LaunchLab platform no longer matches the pins — do NOT run LaunchLab's create: ${r.mismatches.join("; ")}`, 1);
  if (!lp.ok) die(`the LaunchLab platform does not lock the LP to the program — do NOT run LaunchLab's create: ${lp.problems.join("; ")}`, 1);
  say("platform pins hold: platformCpCreator, LP lock/burn scales and cpConfigId are as pinned at initialize_token; 100 % of the LP is locked and the Fee Key goes to the fee-keys PDA");
  process.exit(0);
}
// READ-ONLY (no payer): LAUNCHPAD-PATH §45 end state.
if (CMD === "end-status") {
  const mint = pubkeyOf(opt("mint"), "--mint") ?? die("--mint <pubkey> is required");
  const cfg = (await fetchTokenConfig(connection, programId, mint)) ?? die(`no TokenConfig for ${mint.toBase58()}`);
  const plan = await planForwardOnEnd(connection, programId, cluster, mint, PublicKey.default);
  const view = "target" in plan ? { status: plan.status, target: plan.target.toBase58(), intended: plan.intended.toBase58(), sinkKind: plan.sinkKind } : plan;
  console.log(JSON.stringify(jsonSafe({ command: CMD, cluster, mint: mint.toBase58(), end_state: cfg.config.end_state, end_date: cfg.config.end_date, crank_cursor: cfg.config.crank_cursor, last_record_date: cfg.config.last_record_date, endSink: await fetchEndSink(connection, programId, mint), ruleEnd: await fetchRuleEnd(connection, programId, mint), forwardOnEnd: view }), null, 2));
  process.exit(0);
}
// READ-ONLY (no payer): round 5 burn targets.
if (CMD === "check-target") {
  const targetMint = pubkeyOf(opt("target-mint"), "--target-mint") ?? die("--target-mint <pubkey> is required");
  const pool = pubkeyOf(opt("pool"), "--pool") ?? die("--pool <pubkey> is required");
  const coin = pubkeyOf(opt("mint"), "--mint") ?? undefined;
  const feed = (opt("feed") ?? die("--feed <Pyth feed id hex> is required")).toLowerCase();
  const a = await checkTargetAdmission(connection, { cluster, targetMint, pool, feedId: feed, maxDevBps: Number(opt("max-dev-bps") ?? 300), ...(coin ? { coinMint: coin } : {}) });
  console.log(JSON.stringify(jsonSafe({ command: CMD, cluster, rpc: rpcShown, ...a }), null, 2));
  process.exit(a.ok ? 0 : 1);
}
if (CMD === "target-status") {
  const mint = pubkeyOf(opt("mint"), "--mint") ?? die("--mint <pubkey> is required");
  const cfg = (await fetchTokenConfig(connection, programId, mint)) ?? die(`no TokenConfig for ${mint.toBase58()}`);
  const bt = await fetchBurnTarget(connection, programId, mint);
  const now = bt ? await checkTargetAdmission(connection, { cluster, targetMint: bt.target.target_mint, pool: bt.target.pool, coinMint: mint, feedId: Buffer.from(bt.target.target_feed_id).toString("hex"), maxDevBps: cfg.config.rule.max_twap_deviation_bps }) : null;
  console.log(JSON.stringify(jsonSafe({ command: CMD, cluster, mint: mint.toBase58(), burn_target_kind: cfg.config.burn_target_kind, burnTarget: bt ? { address: bt.address, ...bt.target } : null, pinnedPoolNow: now }), null, 2));
  process.exit(0);
}
// READ-ONLY (no payer): LAUNCHPAD-PATH §40 pair state.
if (CMD === "pair-status") {
  const mint = pubkeyOf(opt("mint"), "--mint") ?? die("--mint <pubkey> is required");
  const cfg = (await fetchTokenConfig(connection, programId, mint)) ?? die(`no TokenConfig for ${mint.toBase58()}`);
  const link = await fetchPairLink(connection, programId, mint);
  const d = opt("date") ? Number(opt("date")) : null;
  const result = link && d ? await fetchPairResult(connection, programId, mint, link.pair_mint, d) : null;
  console.log(JSON.stringify(jsonSafe({ command: CMD, cluster, mint: mint.toBase58(), pair_state: cfg.config.pair_state, pair_void_by: cfg.config.pair_void_by, pair_after_date: cfg.config.pair_after_date, pair_unlinked_at: cfg.config.pair_unlinked_at, link, date: d, result, view: d ? pairResultFor(result, mint) : null }), null, 2));
  process.exit(0);
}
const payer: Party = (await party("payer", false)) ?? (CMD === "initialize-platform" ? await party("upgrade-authority") : CMD === "set-registration-policy" || CMD === "cancel-registration-policy" ? await party("admin") : CMD === "veto-registration-policy" || CMD === "veto-target-pool" ? await party("attester") : CMD === "propose-target-pool" || CMD === "cancel-target-pool" ? await party("admin") : null) ?? die("--payer <keypath|pubkey> is required");
const mintArg = (): PublicKey => pubkeyOf(opt("mint"), "--mint") ?? die("--mint <pubkey> is required");
const tokenWatch = (mint: PublicKey): Watch[] => [{ address: configPda(programId, mint), kind: "TokenConfig" }, { address: feePda(programId, mint), kind: "lamports" }];

if (CMD === "initialize-token") {
  if (opt("mint-keypair") && !opt("mint")) args.push("--mint", opt("mint-keypair")!);
  const mint = (await party("mint"))!;
  if (!matchesSuffix(mint.publicKey.toBase58())) console.error(`note: the mint ${mint.publicKey.toBase58()} does not end in burn or BURN. Coins made since 2026-10-14 should (scripts/burnticker-grind-mint.mts).`);
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
  // LAUNCHPAD-PATH §45: an optional EndSink (a LaunchLab pair coin names its partner here; this command passes no pair_mint)
  const es = opt("end-sink");
  const endSink = !es ? undefined : (() => {
    const parts = es.split(":"), min = BigInt(parts[parts.length - 1] ?? "0");
    if (parts[0] === "flagship" && parts.length === 2) return { kind: END_SINK_FLAGSHIP, minForwardLamports: min };
    if (parts[0] === "incinerator" && parts.length === 2) return { kind: END_SINK_INCINERATOR, minForwardLamports: min };   // round 5 (initialize_token_r5 only)
    if (parts[0] === "mint" && parts.length === 3) return { kind: END_SINK_MINT, sinkMint: pubkeyOf(parts[1], "--end-sink")!, minForwardLamports: min };
    if (parts[0] === "pair-winner" && parts.length === 3) return { kind: END_SINK_PAIR_WINNER, sinkMint: pubkeyOf(parts[1], "--end-sink")!, minForwardLamports: min };
    return die("--end-sink flagship:<min> | incinerator:<min> | mint:<mint>:<min> | pair-winner:<partner>:<min>");
  })();
  // r4 and r5 send the same initialize_token bytes (round 5 pins a burn target in a separate instruction)
  const envLayout = initializeTokenLayoutFromEnv();
  const round = opt("program-round") ?? (envLayout === "r5" ? "5" : endSink || envLayout === "r4" ? "4" : "3");
  if (round !== "3" && round !== "4" && round !== "5") die("--program-round 3|4|5");
  if (endSink && round === "3") die("--end-sink needs --program-round 4 or 5");
  if (endSink?.kind === END_SINK_INCINERATOR && round !== "5") die("--end-sink incinerator needs --program-round 5 (initialize_token_r5)");
  const ix = initializeTokenIx({ programId, payer: payer.publicKey, creator: creator.publicKey, mint: mint.publicKey, launchlabPlatform, layout: round === "5" ? "r5" : round === "4" ? "r4" : "r3", ...(endSink ? { endSink } : {}), args: {
    feed_id: loaded.rules.feed.id, memo_prefix: loaded.rules.memo.prefix, memo_source: loaded.rules.feed.memoSource, rules_sha256: Buffer.from(loaded.sha256, "hex"), rule,
    attesters, quorum: Number(opt("quorum") ?? 1), fixed_pool: fixedPool ?? PublicKey.default, admin,
  } });
  say(`rules ${rulesFile}: sha256 ${loaded.sha256} — this is the hash the program PINS; publish it`);
  await run([ix], payer, [creator, mint], [...tokenWatch(mint.publicKey), ...(endSink ? [{ address: endSinkPda(programId, mint.publicKey), kind: "lamports" as const }] : [])], { rulesFile, rulesSha256: loaded.sha256, ruleParams: rule, ...(endSink ? { endSink: endSinkPda(programId, mint.publicKey).toBase58() } : {}), feePda: feePda(programId, mint.publicKey).toBase58(), config: configPda(programId, mint.publicKey).toBase58() });
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
if (CMD === "register-fee-key") {
  const mint = mintArg();
  const cfg = (await fetchTokenConfig(connection, programId, mint)) ?? die(`no TokenConfig for ${mint.toBase58()}`);
  // lp-lock blind review r2: policy 0 registers the Fee Key BEFORE register_pool, on the token's migration pool (the PDA of the pinned
  // cpConfigId), and the position must have been locked by LaunchLab's vault authority; pairs (policy 2) after register_pair_pool.
  const policy0 = cfg.config.registration_policy === POOL_POLICY_CREATOR_IS_FEE_PDA;
  if (!policy0 && !cfg.config.poolRegistered) die("no verified pool registered (register_pair_pool / register-pool first)");
  const pool = policy0 ? cpmmPoolPda(CPMM_PROGRAM_ID[cluster], cfg.config.ll_cp_config, NATIVE_MINT, mint) : cfg.config.cpmm_pool;
  const wantLocker = policy0 ? launchlabMigrationLocker(LAUNCHLAB_PROGRAM_ID[cluster]) : null;
  let nft = pubkeyOf(opt("nft"), "--nft");
  const positions: Record<string, unknown>[] = [];
  if (!nft) {
    // the pool's lock positions (LockedCpLiquidityState, 256 B, pool @64) whose Fee Key FEE_KEYS holds; the largest wins
    const accs = await connection.getProgramAccounts(LOCK_CPMM_PROGRAM_ID[cluster], { filters: [{ dataSize: 256 }, { memcmp: { offset: 64, bytes: pool.toBase58() } }] });
    let best: { nft: PublicKey; lp: bigint } | null = null;
    for (const a of accs) {
      const v = decodeLockedLiquidity(a.account.data);
      const held = await connection.getAccountInfo(associatedTokenAddress(feeKeysPda(programId), v.feeNftMint), "confirmed");
      const heldByFeeKeys = !!held && held.data.length >= 72 && held.data.readBigUInt64LE(64) === BigInt(1);
      const lockerOk = !wantLocker || v.locker.equals(wantLocker);
      positions.push({ lockedLiquidity: a.pubkey.toBase58(), feeNftMint: v.feeNftMint.toBase58(), lockedLp: v.lockedLp, locker: v.locker.toBase58(), heldByFeeKeys, lockerOk });
      if (heldByFeeKeys && lockerOk && (!best || v.lockedLp > best.lp)) best = { nft: v.feeNftMint, lp: v.lockedLp };
    }
    nft = best?.nft ?? die(`no lock position on pool ${pool.toBase58()} whose Fee Key FEE_KEYS holds (${accs.length} positions found)`);
  }
  const lpMintFk = (await fetchCpmmPool(connection, pool, CPMM_PROGRAM_ID[cluster])).lpMint;
  await run([registerFeeKeyIx({ programId, payer: payer.publicKey, mint, pool, feeNftMint: nft, cluster, lpMint: lpMintFk })], payer, [], [{ address: feeKeyRecordPda(programId, mint), kind: "lamports" }], { pool: pool.toBase58(), feeNftMint: nft.toBase58(), feeKeys: feeKeysPda(programId).toBase58(), positions });
}
if (CMD === "claim-lock-fees") {
  const mint = mintArg();
  const rec = (await fetchFeeKeyRecord(connection, programId, mint)) ?? die(`no FeeKeyRecord for ${mint.toBase58()} (register-fee-key first)`);
  const p = await fetchCpmmPool(connection, rec.record.pool, CPMM_PROGRAM_ID[cluster]);
  const ix = claimLockFeesIx({ programId, cranker: payer.publicKey, mint, feeNftMint: rec.record.fee_nft_mint, pool: { pool: p.address, lpMint: p.lpMint, token0Vault: p.token0Vault, token1Vault: p.token1Vault }, cluster });
  await run([ix], payer, [], [{ address: feePda(programId, mint), kind: "lamports" }, { address: OPERATOR_TREASURY[cluster], kind: "lamports" }, { address: feeKeyRecordPda(programId, mint), kind: "lamports" }], { feeNftMint: rec.record.fee_nft_mint.toBase58(), lockedLiquidity: rec.record.locked_liquidity.toBase58(), treasury: OPERATOR_TREASURY[cluster].toBase58() });
}
// ---------------------------------------------------------------------------------------------------------------------------------
// Readings, cranks and LAUNCHPAD-PATH §40 pairs
// ---------------------------------------------------------------------------------------------------------------------------------
async function attesterKeys(): Promise<{ publicKey: PublicKey; secretKey: Uint8Array }[]> {
  const files = opts("attester");
  if (files.length === 0) die("--attester <keypath> is required (one per signing attester)");
  const { loadKeypair } = await import("../src/lib/burnKeeper/keyfile.ts");
  return files.map((f) => {
    if (!fs.existsSync(f)) die(`--attester ${f}: not a key file`);
    const k = loadKeypair({ keyPath: f });
    return { publicKey: k.publicKey, secretKey: k.secretKey };
  });
}
const dateArg = (): number => {
  const d = Number(opt("date") ?? die("--date YYYYMMDD is required"));
  if (!Number.isInteger(d) || d < 19700101 || d > 29991231) die("--date must be YYYYMMDD");
  return d;
};
async function signableGenesis(mint: PublicKey): Promise<string> {
  const cfg = (await fetchTokenConfig(connection, programId, mint)) ?? die(`no TokenConfig for ${mint.toBase58()}`);
  const genesis = cfg.config.cluster_genesis.toBase58();
  assertSignableGenesis(genesis, cluster, await connection.getGenesisHash());
  return genesis;
}
if (CMD === "submit-reading") {
  const mint = mintArg();
  const recordDate = dateArg();
  const value = BigInt(opt("value") ?? die("--value <raw integer> is required"));
  const cfg = (await fetchTokenConfig(connection, programId, mint)) ?? die(`no TokenConfig for ${mint.toBase58()}`);
  const genesis = await signableGenesis(mint);
  const src = sourceUrlHash(opt("source-url") ?? `burnticker:${cfg.config.feedId}:${recordDate}`);
  const att = attestReading({ genesisHash: genesis, programId, mint, feedId: cfg.config.feedId, prevDate: cfg.config.has_baseline ? cfg.config.last_record_date : 0, recordDate, value, valueDecimals: cfg.config.rule.value_decimals, sourceUrlHash: src, signers: await attesterKeys() });
  await run([att.instruction, submitReadingIx({ programId, payer: payer.publicKey, mint, recordDate, value, sourceUrlHash: src })], payer, [], [...tokenWatch(mint), { address: readingPda(programId, configPda(programId, mint), recordDate), kind: "lamports" }], { message: att.message.toString("utf8") });
}
if (CMD === "crank") {
  const mint = mintArg();
  const plan = await planCrank({ connection, programId, mint, cluster }, payer.publicKey);
  if ("status" in plan) { console.log(JSON.stringify(jsonSafe({ command: CMD, cluster, mint: mint.toBase58(), plan }), null, 2)); process.exit(0); }
  const cfg = (await fetchTokenConfig(connection, programId, mint))!;
  const watch: Watch[] = [...tokenWatch(mint), { address: feePda(programId, mint), kind: "lamports" }];
  if (cfg.config.pair_state === PAIR_STATE_PAIRED) {
    const link = (await fetchPairLink(connection, programId, mint))!;
    watch.push({ address: feePda(programId, link.pair_mint), kind: "lamports" });
  }
  await run(plan.instructions, payer, [], watch, { kind: plan.kind, recordDate: plan.recordDate });
}
if (CMD === "link-pair") {
  const pair = pubkeyOf(opt("pair"), "--pair") ?? die("--pair <pubkey> is required");
  const info = (await connection.getAccountInfo(pair, "confirmed")) ?? die(`no account at ${pair.toBase58()}`);
  const d = Buffer.from(info.data);
  if (d.length < 76) die("not a pair_curve Pair");
  const [mintA, mintB] = [new PublicKey(d.subarray(12, 44)), new PublicKey(d.subarray(44, 76))];
  await run([linkPairIx({ programId, payer: payer.publicKey, pair, mintA, mintB })], payer, [], [...tokenWatch(mintA), ...tokenWatch(mintB), { address: pairLinkPda(programId, mintA), kind: "lamports" }, { address: pairLinkPda(programId, mintB), kind: "lamports" }], { mintA: mintA.toBase58(), mintB: mintB.toBase58(), linkA: pairLinkPda(programId, mintA).toBase58(), linkB: pairLinkPda(programId, mintB).toBase58() });
}
if (CMD === "submit-pair-result") {
  const mintA = pubkeyOf(opt("mint-a"), "--mint-a") ?? die("--mint-a is required");
  const mintB = pubkeyOf(opt("mint-b"), "--mint-b") ?? die("--mint-b is required");
  const recordDate = dateArg();
  const w = opt("winner") ?? die("--winner <mint|draw> is required");
  const winner = w === "draw" ? null : (pubkeyOf(w, "--winner") as PublicKey);
  const genesis = await signableGenesis(mintA);
  if ((await signableGenesis(mintB)) !== genesis) die("the two coins bind different genesis hashes");
  const src = sourceUrlHash(opt("source-url") ?? `burnticker:pair:${mintA.toBase58()}:${mintB.toBase58()}:${recordDate}`);
  const att = attestPairResult({ genesisHash: genesis, programId, mintA, mintB, recordDate, winner, sourceUrlHash: src, signers: await attesterKeys() });
  const address = pairResultPda(programId, mintA, mintB, recordDate);
  await run([att.instruction, submitPairResultIx({ programId, payer: payer.publicKey, mintA, mintB, recordDate, winner, sourceUrlHash: src })], payer, [], [{ address, kind: "lamports" }], { pairResult: address.toBase58(), message: att.message.toString("utf8") });
}
if (CMD === "unlink-pair") {
  const mintA = pubkeyOf(opt("mint-a"), "--mint-a") ?? die("--mint-a is required");
  const mintB = pubkeyOf(opt("mint-b"), "--mint-b") ?? die("--mint-b is required");
  const pair = pubkeyOf(opt("pair"), "--pair") ?? undefined;
  await run([unlinkPairIx({ programId, cranker: payer.publicKey, mintA, mintB, pair })], payer, [], [...tokenWatch(mintA), ...tokenWatch(mintB), { address: pairLinkPda(programId, mintA), kind: "lamports" }, { address: pairLinkPda(programId, mintB), kind: "lamports" }]);
}
if (CMD === "submit-rule-end") {
  const mint = mintArg();
  const recordDate = dateArg();
  const o = opt("outcome") ?? die("--outcome resolved|void is required");
  const outcome = o === "resolved" ? END_STATE_RESOLVED : o === "void" ? END_STATE_VOID : die("--outcome resolved|void");
  const genesis = await signableGenesis(mint);
  const src = sourceUrlHash(opt("source-url") ?? `burnticker:end:${mint.toBase58()}:${recordDate}:${o}`);
  const att = attestRuleEnd({ genesisHash: genesis, programId, mint, recordDate, outcome, sourceUrlHash: src, signers: await attesterKeys() });
  await run([att.instruction, submitRuleEndIx({ programId, payer: payer.publicKey, mint, recordDate, outcome, sourceUrlHash: src })], payer, [], [...tokenWatch(mint), { address: ruleEndPda(programId, mint), kind: "lamports" }], { ruleEnd: ruleEndPda(programId, mint).toBase58(), message: att.message.toString("utf8") });
}
if (CMD === "forward-on-end") {
  const mint = mintArg();
  const plan = await planForwardOnEnd(connection, programId, cluster, mint, payer.publicKey);
  if (plan.status !== "ready") { console.log(JSON.stringify({ command: CMD, cluster, mint: mint.toBase58(), plan }, null, 2)); process.exit(plan.status === "not-ended" || plan.status === "void" ? 0 : 1); }
  await run(plan.instructions, payer, [], [...tokenWatch(mint), { address: feePda(programId, plan.target), kind: "lamports" }], { target: plan.target.toBase58(), intended: plan.intended.toBase58(), sinkKind: plan.sinkKind });
}
if (CMD === "release-target") {
  // round-5 review R5-6: permissionless; a stalled target coin's carried spend goes to the flagship's fee PDA (refused unless stalled)
  const mint = mintArg();
  const flagship = pubkeyOf(opt("flagship"), "--flagship") ?? FLAGSHIP_MINT[cluster];
  await run([releaseTargetIx({ programId, cranker: payer.publicKey, mint, flagship })], payer, [], [...tokenWatch(mint), { address: feePda(programId, flagship), kind: "lamports" }], { flagship: flagship.toBase58() });
}
if (CMD === "forward-to-winner") {
  const loser = pubkeyOf(opt("loser"), "--loser") ?? die("--loser <mint> is required");
  const winner = pubkeyOf(opt("winner"), "--winner") ?? die("--winner <mint> is required");
  const recordDate = dateArg();
  await run([forwardToWinnerIx({ programId, cranker: payer.publicKey, loserMint: loser, winnerMint: winner, recordDate })], payer, [], [{ address: feePda(programId, loser), kind: "lamports" }, { address: feePda(programId, winner), kind: "lamports" }, { address: pairResultPda(programId, loser, winner, recordDate), kind: "lamports" }], { pairResult: pairResultPda(programId, loser, winner, recordDate).toBase58() });
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
// Round 5: re-pinning a burn target's POOL (the target token never changes).
if (CMD === "propose-target-pool") {
  const mint = mintArg();
  const admin = (await party("admin"))!;
  const pool = pubkeyOf(opt("pool"), "--pool") ?? die("--pool <pubkey> is required");
  const cfg = (await fetchTokenConfig(connection, programId, mint)) ?? die(`no TokenConfig for ${mint.toBase58()}`);
  if (cfg.config.burn_target_kind !== BURN_TARGET_EXTERNAL) die("this coin has no burn target");
  const bt = (await fetchBurnTarget(connection, programId, mint))!;
  const a = await checkTargetAdmission(connection, { cluster, targetMint: bt.target.target_mint, pool, coinMint: mint, feedId: Buffer.from(bt.target.target_feed_id).toString("hex"), maxDevBps: cfg.config.rule.max_twap_deviation_bps });
  if (!a.ok) say(`warning: the proposed pool fails admission today (apply_target_pool would refuse it): ${a.problems.join(" ")}`);
  await run([proposeTargetPoolIx({ programId, admin: admin.publicKey, mint, pool })], payer, [admin], [...tokenWatch(mint), { address: burnTargetPda(programId, mint), kind: "lamports" }]);
}
if (CMD === "cancel-target-pool") {
  const mint = mintArg();
  const admin = (await party("admin"))!;
  await run([cancelTargetPoolIx({ programId, admin: admin.publicKey, mint })], payer, [admin], tokenWatch(mint));
}
if (CMD === "veto-target-pool") {
  const mint = mintArg();
  const attester = (await party("attester"))!;
  await run([vetoTargetPoolIx({ programId, attester: attester.publicKey, mint })], payer, [attester], tokenWatch(mint));
}
if (CMD === "apply-target-pool") {
  const mint = mintArg();
  const bt = (await fetchBurnTarget(connection, programId, mint)) ?? die("this coin has no burn target");
  if (bt.target.pending_eta === BigInt(0)) die("no target-pool proposal is pending");
  const feedHex = Buffer.from(bt.target.target_feed_id).toString("hex");
  const a = await checkTargetAdmission(connection, { cluster, targetMint: bt.target.target_mint, pool: bt.target.pending_pool, coinMint: mint, feedId: feedHex });
  if (!a.ammConfig || !a.wsolVault || !a.targetVault) die(`the proposed pool cannot be read: ${a.problems.join(" ")}`);
  await run([applyTargetPoolIx({ programId, caller: payer.publicKey, mint, targetMint: bt.target.target_mint, newPool: bt.target.pending_pool, newAmmConfig: a.ammConfig!, newWsolVault: a.wsolVault!, newTargetVault: a.targetVault!, feedId: feedHex })], payer, [], [...tokenWatch(mint), { address: burnTargetPda(programId, mint), kind: "lamports" }], { admission: a });
}
if (CMD === "pin-burn-target") {
  const mint = (await party("mint"))!;
  const targetMint = pubkeyOf(opt("target-mint"), "--target-mint") ?? die("--target-mint <pubkey> is required");
  const pool = pubkeyOf(opt("pool"), "--pool") ?? die("--pool <pubkey> is required");
  const feed = (opt("feed") ?? die("--feed <Pyth feed id hex> is required")).toLowerCase();
  const cfg = (await fetchTokenConfig(connection, programId, mint.publicKey)) ?? die("run initialize-token first (no TokenConfig for this mint)");
  const a = await checkTargetAdmission(connection, { cluster, targetMint, pool, coinMint: mint.publicKey, feedId: feed, maxDevBps: cfg.config.rule.max_twap_deviation_bps });
  if (!a.ok || !a.ammConfig || !a.wsolVault || !a.targetVault) die(`the program would refuse this target: ${a.problems.join(" ")}`);
  say(`burn target ${targetMint.toBase58()} on ${a.poolKind === 1 ? "AMM v4" : "CPMM"} pool ${pool.toBase58()}: admission passes (SOL reserve ${a.wsolReserve} lamports, fee ${a.feePpm} ppm)`);
  await run([pinBurnTargetIx({ programId, payer: payer.publicKey, mint: mint.publicKey, targetMint, pool, ammConfig: a.ammConfig!, wsolVault: a.wsolVault!, targetVault: a.targetVault!, feedId: feed })], payer, [mint], [...tokenWatch(mint.publicKey), { address: burnTargetPda(programId, mint.publicKey), kind: "lamports" }], { admission: a });
}
