// THE BURN-POOL CAP RAISE (owner, 2026-10-12: 25 SOL → 1,000 SOL) — DRY RUN BY DEFAULT. THIS FILE PRINTS NO KEY.
// docs/burnticker/CAP-RAISE.md explains the three steps in plain English.
//
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/alias-hook.mjs scripts/burnreceipts-cap.mts <command> [flags]
//
// Commands:
//   propose-vault  --multisig <pubkey> --member <keypath|pubkey> [--sunset <ISO date|unix s>] [--cranker <pubkey>]... [--new-cap-sol 1000]
//                  [--memo <text>] [--replace-pending] [--send]
//                  ONE Squads v4 vault transaction (vault index 0; the vault PDA signs both instructions):
//                    1. initialize_platform(authority = the vault, cap = 25 SOL exactly, sunset = --sunset or the program's hard-coded
//                       2027-10-01, crankers = the --cranker keys, 0–3) — the VAULT pays the PlatformConfig rent (≈ 0.0026 SOL) from its
//                       own balance; a member's key is not part of a vault transaction's inner message, so it cannot be the payer;
//                    2. propose_cap_raise(--new-cap-sol, default 1000) — starts the program's 48 h timelock at execution.
//                  If a PlatformConfig already exists, only propose_cap_raise is built (and the output says so).
//                  It simulates the INNER message as the vault (no signatures) and prints the PlatformConfig the program would write,
//                  then builds vault_transaction_create + proposal_create (the member pays their rent and the fee). Voting and
//                  execution stay with squads-multisig-cli (`proposal-vote`, `vault-transaction-execute`), as for program upgrades.
//                  --send only on devnet/localnet; on mainnet it prints the bytes for the owner's own signing tool and sends nothing.
//   apply          --payer <keypath|pubkey> [--send --i-understand-this-raises-the-cap]
//                  apply_cap_raise from any key once the 48 h have passed; refuses with the time left before that. --send on mainnet
//                  also needs BURNKEEPER_MAINNET=1 in the environment.
//   show           READ-ONLY: the PlatformConfig (cap, sunset, pending raise and eta in America/Denver and UTC, authority, crankers),
//                  or "none: default 25 SOL cap until <sunset>".
//
// Common flags: --cluster devnet|mainnet|localnet (checked against the RPC's genesis), --rpc <url> (printed as scheme + host only),
// --program <pubkey> (default: the IDL's AuQjoSgq…zhMM).

import fs from "node:fs";
import { ComputeBudgetProgram, Connection, Keypair, PublicKey, SYSVAR_CLOCK_PUBKEY, SystemProgram, Transaction, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { BURN_RECEIPTS_LOCALNET_PROGRAM_ID, DEFAULT_CAP_SUNSET_TS, GENESIS_HASH } from "../src/lib/burnReceipts/constants.ts";
import { bs58, decodePlatformConfig, type PlatformConfigAccount } from "../src/lib/burnReceipts/accounts.ts";
import { applyCapRaiseIx } from "../src/lib/burnReceipts/instructions.ts";
import { platformPda, programDataAddress } from "../src/lib/burnReceipts/pda.ts";
import { confirmByPolling, redactRpcUrl } from "../src/lib/burnReceipts/crank.ts";
import { CapRefusal, capRaiseInstructions, checkApplyCapRaise, checkApplySend, checkInitializePlatform, checkProposeCapRaise, checkProposeSend, compileVaultMessage, describePlatform, parseSunset, PLATFORM_CONFIG_SPACE, proposalCreateData, solString, solToLamports, squadsProposalPda, squadsTransactionPda, SQUADS_V4_PROGRAM_ID, vaultPda, vaultTransactionCreateData, whenBoth } from "../src/lib/burnReceipts/capRaise.ts";

const args = process.argv.slice(2);
const CMD = args[0];
const flag = (n: string) => args.includes(`--${n}`);
const opts = (n: string): string[] => args.flatMap((a, i) => (a === `--${n}` && args[i + 1] !== undefined && !args[i + 1].startsWith("--") ? [args[i + 1]] : []));
const opt = (n: string): string | undefined => opts(n)[0];
const say = (s: string) => console.error(s);
const die = (s: string, code = 2): never => { console.error(`refusing: ${s}`); process.exit(code); };
const guard = <T,>(f: () => T): T => { try { return f(); } catch (e) { if (e instanceof CapRefusal) return die(e.message); throw e; } };
const jsonSafe = (v: unknown): unknown => JSON.parse(JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x instanceof PublicKey ? x.toBase58() : x)));
const print = (o: unknown) => console.log(JSON.stringify(jsonSafe(o), null, 2));

if (!["propose-vault", "apply", "show"].includes(CMD ?? "")) {
  say(fs.readFileSync(new URL(import.meta.url)).toString().split("\n").filter((l) => l.startsWith("//")).map((l) => l.slice(3)).join("\n"));
  process.exit(CMD ? 2 : 0);
}

const cluster = opt("cluster") ?? die("--cluster devnet|mainnet|localnet is required");
if (!["devnet", "mainnet", "localnet"].includes(cluster)) die(`--cluster ${cluster}: devnet, mainnet or localnet`);
const SEND = flag("send");
guard(() => (CMD === "propose-vault" ? checkProposeSend({ cluster, send: SEND }) : checkApplySend({ cluster, send: SEND && CMD === "apply", understood: flag("i-understand-this-raises-the-cap"), mainnetEnv: process.env.BURNKEEPER_MAINNET })));
const rpc = opt("rpc")?.trim() || (cluster === "devnet" ? "https://api.devnet.solana.com" : cluster === "mainnet" ? "https://api.mainnet-beta.solana.com" : "http://127.0.0.1:8899");
const rpcShown = redactRpcUrl(rpc);
const connection = new Connection(rpc, "confirmed");
{
  const genesis = await connection.getGenesisHash();
  const actual = genesis === GENESIS_HASH.mainnet ? "mainnet" : genesis === GENESIS_HASH.devnet ? "devnet" : "localnet";
  if (actual !== cluster) die(`the RPC ${rpcShown} is ${actual} (genesis ${genesis}) but --cluster says ${cluster}`);
}
const pubkeyOf = (v: string | undefined, what: string): PublicKey | null => { if (!v) return null; try { return new PublicKey(v.trim()); } catch { return die(`${what}: ${v} is not a pubkey`); } };
const programId = pubkeyOf(opt("program"), "--program") ?? BURN_RECEIPTS_LOCALNET_PROGRAM_ID;
const platform = platformPda(programId);

/** Chain time (the Clock sysvar's unix_timestamp) — what the program compares against, not this machine's clock. */
async function chainNow(): Promise<bigint> {
  const c = (await connection.getAccountInfo(SYSVAR_CLOCK_PUBKEY, "confirmed")) ?? die("no Clock sysvar");
  return c.data.readBigInt64LE(32);
}
async function fetchPlatform(): Promise<PlatformConfigAccount | null> {
  const a = await connection.getAccountInfo(platform, "confirmed");
  if (!a || a.data.length === 0) return null;
  if (!a.owner.equals(programId)) die(`${platform.toBase58()} is not owned by the program`);
  return decodePlatformConfig(a.data);
}
interface Party { publicKey: PublicKey; key: Keypair | null }
async function party(name: string): Promise<Party> {
  const v = opt(name) ?? die(`--${name} <keypath|pubkey> is required`);
  if (fs.existsSync(v) && fs.statSync(v).isFile()) {
    const { loadKeypair } = await import("../src/lib/burnKeeper/keyfile.ts");
    const key = loadKeypair({ keyPath: v });
    return { publicKey: key.publicKey, key };
  }
  const publicKey = pubkeyOf(v, `--${name}`)!;
  if (SEND) die(`--send needs --${name} as a key file, not a pubkey`);
  return { publicKey, key: null };
}
const simulate = async (ixs: TransactionInstruction[], payer: PublicKey, watch: PublicKey[]) => {
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  const tx = new VersionedTransaction(new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions: ixs }).compileToLegacyMessage());
  const sim = await connection.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed", accounts: { encoding: "base64", addresses: watch.map((w) => w.toBase58()) } });
  return { err: sim.value.err ? JSON.stringify(sim.value.err) : null, unitsConsumed: sim.value.unitsConsumed ?? null, logs: sim.value.logs ?? [], accounts: sim.value.accounts ?? [] };
};

const now = await chainNow();
const before = await fetchPlatform();

if (CMD === "show") {
  print({ command: CMD, cluster, rpc: rpcShown, programId, platform, chainTime: whenBoth(now), ...describePlatform(before, now) });
  process.exit(0);
}

if (CMD === "apply") {
  const payer = await party("payer");
  guard(() => checkApplyCapRaise(before, now));
  const ix = applyCapRaiseIx({ programId, caller: payer.publicKey });
  const all = [ComputeBudgetProgram.setComputeUnitLimit({ units: 100_000 }), ix];
  const sim = await simulate(all, payer.publicKey, [platform]);
  const after = sim.accounts[0] ? decodePlatformConfig(Buffer.from(sim.accounts[0].data[0], "base64")) : null;
  const out: Record<string, unknown> = { command: CMD, cluster, rpc: rpcShown, programId, platform, dryRun: !SEND, payer: payer.publicKey, chainTime: whenBoth(now),
    before: describePlatform(before, now), instructionDataHex: Buffer.from(ix.data).toString("hex"),
    simulation: { err: sim.err, unitsConsumed: sim.unitsConsumed, logs: sim.logs }, wouldWrite: after ? describePlatform(after, now) : null };
  if (SEND && !sim.err) {
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    const tx = new VersionedTransaction(new TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: blockhash, instructions: all }).compileToLegacyMessage());
    tx.sign([payer.key!]);
    const signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 5 });
    const err = await confirmByPolling(connection, signature, lastValidBlockHeight);
    out.sent = { signature, err: err ? JSON.stringify(err) : null };
    out.afterSend = describePlatform(await fetchPlatform(), await chainNow());
  }
  print(out);
  process.exit(sim.err || (out.sent as { err: unknown } | undefined)?.err ? 1 : 0);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// propose-vault
// ---------------------------------------------------------------------------------------------------------------------------------
const multisig = pubkeyOf(opt("multisig"), "--multisig") ?? die("--multisig <pubkey> is required");
const member = await party("member");
const vaultIndex = 0;
const vault = vaultPda(multisig, vaultIndex);
const newCapLamports = guard(() => solToLamports(opt("new-cap-sol") ?? "1000"));
const sunsetTs = guard(() => (opt("sunset") ? parseSunset(opt("sunset")!) : BigInt(DEFAULT_CAP_SUNSET_TS)));
const crankers = opts("cranker").map((c) => pubkeyOf(c, "--cranker")!);
const memo = opt("memo");

// The cluster's published vault (config/burnticker/operator.json) must be the one derived here.
if (cluster !== "localnet") {
  const op = JSON.parse(fs.readFileSync("config/burnticker/operator.json", "utf8")) as { clusters: Record<string, { squads?: { vault?: string; multisig?: string } }> };
  const s = op.clusters[cluster]?.squads;
  if (s?.multisig && s.multisig !== multisig.toBase58()) die(`--multisig ${multisig.toBase58()} is not the ${cluster} multisig in config/burnticker/operator.json (${s.multisig})`);
  if (s?.vault && s.vault !== vault.toBase58()) die(`the derived vault ${vault.toBase58()} is not the ${cluster} vault in config/burnticker/operator.json (${s.vault})`);
}
// Multisig (Anchor): disc 8 | create_key 32 | config_authority 32 | threshold u16 | time_lock u32 | transaction_index u64 |
// stale_transaction_index u64 | rent_collector Option<Pubkey> | bump u8 | members Vec<{ key 32, permissions u8 }>.
const msAcc = (await connection.getAccountInfo(multisig, "confirmed")) ?? die(`no multisig at ${multisig.toBase58()}`);
if (!msAcc.owner.equals(SQUADS_V4_PROGRAM_ID)) die("the multisig account is not owned by Squads v4");
const threshold = msAcc.data.readUInt16LE(72);
const timeLock = msAcc.data.readUInt32LE(74);
const index = msAcc.data.readBigUInt64LE(78) + BigInt(1);
let mo = 94;
mo += 1 + (msAcc.data[mo] ? 32 : 0) + 1;
const members: { key: PublicKey; permissions: number }[] = [];
for (let i = 0, n = msAcc.data.readUInt32LE(mo); i < n; i++) members.push({ key: new PublicKey(msAcc.data.subarray(mo + 4 + 33 * i, mo + 36 + 33 * i)), permissions: msAcc.data[mo + 36 + 33 * i] });
const me = members.find((m) => m.key.equals(member.publicKey)) ?? die(`--member ${member.publicKey.toBase58()} is not a member of the multisig`);
if (!(me.permissions & 1)) die(`--member ${member.publicKey.toBase58()} lacks the Initiate permission`);

const platformExists = before !== null;
if (before) guard(() => checkProposeCapRaise({ platform: before, vault, newCapLamports, replacePending: flag("replace-pending") }));
else {
  guard(() => checkInitializePlatform({ capLamports: BigInt(25_000_000_000), sunsetTs, nowTs: now, crankers }));
  if (newCapLamports <= BigInt(25_000_000_000)) die(`--new-cap-sol must be above the 25 SOL default (got ${solString(newCapLamports)})`);
  // initialize_platform is signed by the program's upgrade authority: it must be this vault.
  const pd = (await connection.getAccountInfo(programDataAddress(programId), "confirmed")) ?? die(`no ProgramData for ${programId.toBase58()}`);
  const ua = pd.data[12] === 1 ? new PublicKey(pd.data.subarray(13, 45)) : null;
  if (!ua?.equals(vault)) die(`the program's upgrade authority is ${ua?.toBase58() ?? "none (immutable)"}, not the vault ${vault.toBase58()}`);
}
if (opt("sunset") && platformExists) say(`note: a PlatformConfig exists, so --sunset is ignored (the sunset was fixed at creation: ${whenBoth(before!.cap_sunset_ts)})`);
if (crankers.length && platformExists) say("note: a PlatformConfig exists, so --cranker is ignored (crankers are set only at creation)");

const inner = capRaiseInstructions({ programId, vault, platformExists, sunsetTs, crankers, newCapLamports });
const message = guard(() => compileVaultMessage(vault, inner));

// The inner message as Squads would execute it: the vault signs (not checked here) and the executing member pays the fee.
const vaultLamports = BigInt((await connection.getBalance(vault, "confirmed")) ?? 0);
const rentLamports = BigInt(await connection.getMinimumBalanceForRentExemption(PLATFORM_CONFIG_SPACE));
const innerSim = await simulate(inner, member.publicKey, [platform]);
const wouldWrite = innerSim.accounts[0]?.data ? decodePlatformConfig(Buffer.from(innerSim.accounts[0].data[0], "base64")) : null;

const transaction = squadsTransactionPda(multisig, index);
const proposal = squadsProposalPda(multisig, index);
const create = new TransactionInstruction({ programId: SQUADS_V4_PROGRAM_ID, data: vaultTransactionCreateData(vaultIndex, message.bytes, memo), keys: [
  { pubkey: multisig, isSigner: false, isWritable: true }, { pubkey: transaction, isSigner: false, isWritable: true },
  { pubkey: member.publicKey, isSigner: true, isWritable: false }, { pubkey: member.publicKey, isSigner: true, isWritable: true }, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
] });
const propose = new TransactionInstruction({ programId: SQUADS_V4_PROGRAM_ID, data: proposalCreateData(index), keys: [
  { pubkey: multisig, isSigner: false, isWritable: false }, { pubkey: proposal, isSigner: false, isWritable: true },
  { pubkey: member.publicKey, isSigner: true, isWritable: false }, { pubkey: member.publicKey, isSigner: true, isWritable: true }, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
] });
const outerIxs = [ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }), create, propose];
const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
const outerMsg = new TransactionMessage({ payerKey: member.publicKey, recentBlockhash: blockhash, instructions: outerIxs }).compileToLegacyMessage();
const outerTx = new VersionedTransaction(outerMsg);
if (outerTx.serialize().length > 1232) die(`the proposal transaction is ${outerTx.serialize().length} bytes > 1232 (shorten --memo)`);
const outerSim = await simulate(outerIxs, member.publicKey, []);
// For the Squads app's "import a transaction" (base58 of an unsigned legacy transaction whose fee payer is the vault) — not tested here.
const importTx = new Transaction({ feePayer: vault, recentBlockhash: blockhash }).add(...inner);

const out: Record<string, unknown> = {
  command: CMD, cluster, rpc: rpcShown, programId, dryRun: !SEND, chainTime: whenBoth(now),
  multisig, threshold, timeLockSecs: timeLock, member: member.publicKey, vaultIndex, vault, transactionIndex: index, transaction, proposal,
  platform, platformBefore: describePlatform(before, now),
  contains: platformExists
    ? ["propose_cap_raise only — a PlatformConfig already exists (initialize_platform is not built)"]
    : ["initialize_platform(authority = the vault, cap = 25 SOL, sunset, crankers) — payer = the vault", "propose_cap_raise"],
  newCap: `${solString(newCapLamports)} (${newCapLamports} lamports)`,
  sunset: platformExists ? whenBoth(before!.cap_sunset_ts) : whenBoth(sunsetTs),
  crankers: platformExists ? null : crankers,
  rent: platformExists ? null : { payer: "the vault", platformConfigBytes: PLATFORM_CONFIG_SPACE, rentLamports, vaultLamports, enough: vaultLamports >= rentLamports,
    note: vaultLamports >= rentLamports ? "the vault can pay the PlatformConfig rent" : `send at least ${rentLamports - vaultLamports} lamports to the vault before execution, or the execute transaction fails` },
  innerInstructions: inner.map((ix) => ({ program: ix.programId, accounts: ix.keys.map((k) => ({ pubkey: k.pubkey, signer: k.isSigner, writable: k.isWritable })), dataHex: Buffer.from(ix.data).toString("hex") })),
  innerMessageKeys: message.keys,
  innerMessageHex: message.bytes.toString("hex"),
  innerSimulation: { as: "the two instructions signed by the vault, fee paid by the member, sigVerify false", err: innerSim.err,
    hint: innerSim.err && !platformExists && vaultLamports < rentLamports ? "the vault cannot pay the PlatformConfig rent yet (Custom 1 = insufficient lamports): fund it, then re-run the dry run" : undefined, unitsConsumed: innerSim.unitsConsumed, logs: innerSim.logs },
  platformConfigTheProgramWouldWrite: wouldWrite ? { ...describePlatform(wouldWrite, now), raw: wouldWrite } : null,
  vaultTransactionCreateDataHex: create.data.toString("hex"),
  proposalCreateDataHex: propose.data.toString("hex"),
  proposalSimulation: { err: outerSim.err, unitsConsumed: outerSim.unitsConsumed, logs: outerSim.logs },
};
if (cluster === "mainnet") {
  out.mainnet = {
    sent: "nothing — sign these with the owner's own tool",
    unsignedProposalTransactionBase64: Buffer.from(outerTx.serialize()).toString("base64"),
    unsignedProposalMessageBase64: Buffer.from(outerMsg.serialize()).toString("base64"),
    squadsAppImportBase58: bs58(importTx.serialize({ requireAllSignatures: false, verifySignatures: false })),
  };
}
const failed = !!innerSim.err || !!outerSim.err;
if (SEND && !failed) {
  outerTx.sign([member.key!]);
  const signature = await connection.sendRawTransaction(outerTx.serialize(), { skipPreflight: true, maxRetries: 5 });
  const err = await confirmByPolling(connection, signature, lastValidBlockHeight);
  out.sent = { signature, err: err ? JSON.stringify(err) : null };
  out.next = [
    `squads-multisig-cli proposal-vote --rpc-url <rpc> --keypair <member> --multisig-pubkey ${multisig.toBase58()} --transaction-index ${index} --action Approve   (${threshold} members)`,
    `after ${timeLock} s: squads-multisig-cli vault-transaction-execute --rpc-url <rpc> --keypair <member> --multisig-pubkey ${multisig.toBase58()} --transaction-index ${index}`,
    "48 h after execution: scripts/burnreceipts-cap.mts apply --payer <any key> --send --i-understand-this-raises-the-cap",
  ];
} else if (SEND) say("a simulation failed — nothing sent");
print(out);
process.exit(failed || (out.sent as { err: unknown } | undefined)?.err ? 1 : 0);
