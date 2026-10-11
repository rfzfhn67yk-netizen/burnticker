// SQUADS v4 PROGRAM UPGRADE — the proposal step (2026-10-10). squads-multisig-cli 0.1.7's `initiate-program-upgrade` serialises
// the inner message as a Solana legacy Message, which the Squads v4 program cannot deserialise ("Failed to serialize or deserialize
// account data", seen on devnet 2026-10-10 — docs/burnkeeper/devnet-paircurve-run-log-2026-10-10.md). This script builds the same
// two instructions with the program's own TransactionMessage layout (squads-multisig-program 2.0.0, vault_transaction_create.rs:
// u8 counts, SmallVec<u8> keys / instructions, SmallVec<u16> data) and leaves voting and execution to the CLI
// (`proposal-vote`, `vault-transaction-execute`, which work). DRY-RUN BY DEFAULT; it SENDS only on devnet/localnet — on mainnet it
// prints the vault-transaction bytes for the owner's own signing tool and sends nothing. Prints no key.
//
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/squads-program-upgrade.mts --cluster devnet --multisig <pubkey>
//     --program <pubkey> --buffer <pubkey> --spill <pubkey> --member <keypath> [--expect-file <local .so>] [--table <verified-build.json>]
//     [--vault-index 0] [--memo <text>] [--send]
//
// Blind review 2 M-2: before proposing, the script REFUSES unless all four hold, and prints each for the voters:
//   1. the buffer's code is the published build: its EXECUTABLE HASH (sha256 of the program bytes with trailing zero bytes removed —
//      solana-verify's definition, the number `scripts/ops/verified-build.sh` publishes) equals the hash for this program id and
//      cluster in config/burnticker/verified-build.json (`builds.<cluster>.hash`; re-check of M-2: mandatory, never a plain-file
//      sha256 the operator types). --expect-file adds a check that a local .so has the same executable hash; on localnet (no table
//      row) --expect-file is required instead;
//   2. the buffer's authority is the Squads vault (`solana program set-buffer-authority <BUFFER> --new-buffer-authority <VAULT>`);
//   3. the program's CURRENT upgrade authority (its ProgramData) is the same vault;
//   4. the spill address (which receives the buffer's rent) is the vault or a multisig member.
// --vault-index must be 0–255. The program data must be at least the buffer's length (`solana program extend`).

import crypto from "node:crypto";
import fs from "node:fs";
import { ComputeBudgetProgram, Connection, Keypair, PublicKey, SystemProgram, SYSVAR_CLOCK_PUBKEY, SYSVAR_RENT_PUBKEY, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";

const args = process.argv.slice(2);
const opt = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const die = (s: string): never => { console.error(`refusing: ${s}`); process.exit(2); };
const SQUADS = new PublicKey("SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf");
const LOADER = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const GENESIS = { mainnet: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d", devnet: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG" };

const cluster = opt("cluster") ?? die("--cluster devnet|mainnet|localnet");
const rpc = opt("rpc") ?? (cluster === "devnet" ? "https://api.devnet.solana.com" : cluster === "mainnet" ? "https://api.mainnet-beta.solana.com" : "http://127.0.0.1:8899");
const connection = new Connection(rpc, "confirmed");
const genesis = await connection.getGenesisHash();
if ((cluster === "mainnet") !== (genesis === GENESIS.mainnet)) die(`--cluster ${cluster} does not match the RPC's genesis ${genesis}`);
const SEND = args.includes("--send");
if (SEND && cluster === "mainnet") die("this script never sends on mainnet — use the printed bytes with the owner's signing tool");
const pk = (n: string) => { const v = opt(n) ?? die(`--${n} <pubkey> is required`); try { return new PublicKey(v); } catch { return die(`--${n}: ${v} is not a pubkey`); } };
const multisig = pk("multisig"), program = pk("program"), buffer = pk("buffer"), spill = pk("spill");
const vaultIndexRaw = opt("vault-index") ?? "0";
if (!/^\d{1,3}$/.test(vaultIndexRaw) || Number(vaultIndexRaw) > 255) die(`--vault-index ${vaultIndexRaw} must be an integer 0–255`);
const vaultIndex = Number(vaultIndexRaw);
const sha256 = (b: Uint8Array) => crypto.createHash("sha256").update(b).digest("hex");
const trimZeros = (b: Uint8Array) => { let n = b.length; while (n > 0 && b[n - 1] === 0) n--; return b.subarray(0, n); };
const execHash = (b: Uint8Array) => sha256(trimZeros(b));
if (opt("expect-sha256")) die("--expect-sha256 is gone: the script reads the executable hash from config/burnticker/verified-build.json");
const tablePath = opt("table") ?? "config/burnticker/verified-build.json";
type BuildTable = { programs: { library: string; programId: string; builds: Record<string, { hash: string; bytes: number }> }[] };
const table = JSON.parse(fs.readFileSync(tablePath, "utf8")) as BuildTable;
const row = table.programs.find((r) => r.programId === program.toBase58());
const tableHash = row?.builds?.[cluster]?.hash?.toLowerCase();
const expectFile = opt("expect-file");
if (!tableHash && !(cluster === "localnet" && expectFile)) die(`${tablePath} has no ${cluster} build for ${program.toBase58()} — run scripts/ops/verified-build.sh --write and commit the table first`);
const localSo = expectFile ? fs.readFileSync(expectFile) : null;
const localExec = localSo ? execHash(localSo) : null;
if (tableHash && localExec && localExec !== tableHash) die(`--expect-file executable hash ${localExec} ≠ the table's ${cluster} hash ${tableHash} (${row!.library})`);
const wantHash = (tableHash ?? localExec)!;
const memberPath = opt("member") ?? die("--member <keypath> is required (a multisig member with Initiate permission)");
const member = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(memberPath, "utf8"))));

const disc = (name: string) => crypto.createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
const u64 = (n: bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(n); return b; };
const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const u16 = (n: number) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };

// Multisig account (Anchor): disc 8 | create_key 32 | config_authority 32 | threshold u16 | time_lock u32 | transaction_index u64 | …
const msAcc = (await connection.getAccountInfo(multisig, "confirmed")) ?? die(`no multisig at ${multisig.toBase58()}`);
if (!msAcc.owner.equals(SQUADS)) die("the multisig account is not owned by Squads v4");
const timeLock = msAcc.data.readUInt32LE(8 + 32 + 32 + 2);
const index = msAcc.data.readBigUInt64LE(8 + 32 + 32 + 2 + 4) + BigInt(1);
// … | stale_transaction_index u64 | rent_collector Option<Pubkey> | bump u8 | members Vec<{ key 32, permissions u8 }>
let mo = 8 + 32 + 32 + 2 + 4 + 8 + 8;
mo += 1 + (msAcc.data[mo] ? 32 : 0) + 1;
const members: PublicKey[] = [];
for (let i = 0, n = msAcc.data.readUInt32LE(mo); i < n; i++) members.push(new PublicKey(msAcc.data.subarray(mo + 4 + 33 * i, mo + 36 + 33 * i)));
const vault = PublicKey.findProgramAddressSync([Buffer.from("multisig"), multisig.toBuffer(), Buffer.from("vault"), Buffer.from([vaultIndex])], SQUADS)[0];

// The four upgrade checks (M-2).
const optKey = (d: Buffer, at: number) => (d[at] === 1 ? new PublicKey(d.subarray(at + 1, at + 33)) : null);
const bufAcc = (await connection.getAccountInfo(buffer, "confirmed")) ?? die(`no buffer at ${buffer.toBase58()}`);
if (!bufAcc.owner.equals(LOADER) || bufAcc.data.length < 37 || bufAcc.data.readUInt32LE(0) !== 1) die("the --buffer account is not an upgradeable-loader Buffer");
const bufCode = bufAcc.data.subarray(37);
const bufExec = execHash(bufCode);
if (bufExec !== wantHash) die(`buffer executable hash ${bufExec} ≠ ${tableHash ? `the verified-build table's ${cluster} hash` : "the --expect-file build"} ${wantHash}`);
const codeLen = trimZeros(bufCode).length;
const bufAuthority = optKey(bufAcc.data, 4);
if (!bufAuthority?.equals(vault)) die(`buffer authority ${bufAuthority?.toBase58() ?? "none (immutable)"} ≠ the vault ${vault.toBase58()}`);
const programDataAddr = PublicKey.findProgramAddressSync([program.toBuffer()], LOADER)[0];
const pdAcc = (await connection.getAccountInfo(programDataAddr, "confirmed")) ?? die(`no program data for ${program.toBase58()} (not an upgradeable program?)`);
if (!pdAcc.owner.equals(LOADER) || pdAcc.data.readUInt32LE(0) !== 3) die("the program's ProgramData account is malformed");
const programAuthority = optKey(pdAcc.data, 12);
if (!programAuthority?.equals(vault)) die(`program upgrade authority ${programAuthority?.toBase58() ?? "none (immutable)"} ≠ the vault ${vault.toBase58()}`);
if (pdAcc.data.length - 45 < codeLen) die(`program data holds ${pdAcc.data.length - 45} bytes < the build's ${codeLen}: run \`solana program extend\` first`);
if (!spill.equals(vault) && !members.some((m) => m.equals(spill))) die(`spill ${spill.toBase58()} is neither the vault nor a multisig member`);
const transaction = PublicKey.findProgramAddressSync([Buffer.from("multisig"), multisig.toBuffer(), Buffer.from("transaction"), u64(index)], SQUADS)[0];
const proposal = PublicKey.findProgramAddressSync([Buffer.from("multisig"), multisig.toBuffer(), Buffer.from("transaction"), u64(index), Buffer.from("proposal")], SQUADS)[0];
const programData = PublicKey.findProgramAddressSync([program.toBuffer()], LOADER)[0];

// The inner message: BPF Upgradeable Loader `Upgrade` (enum index 3), signed by the vault.
//   keys: [vault (signer, read-only)] [programData, program, buffer, spill (writable)] [rent, clock, loader (read-only)]
const keys = [vault, programData, program, buffer, spill, SYSVAR_RENT_PUBKEY, SYSVAR_CLOCK_PUBKEY, LOADER];
const message = Buffer.concat([
  Buffer.from([1, 0, 4, keys.length]), ...keys.map((k) => k.toBuffer()),
  Buffer.from([1, 7, 7, 1, 2, 3, 4, 5, 6, 0]), u16(4), u32(3),
  Buffer.from([0]),
]);
const memo = opt("memo");
const createData = Buffer.concat([disc("vault_transaction_create"), Buffer.from([vaultIndex, 0]), u32(message.length), message, memo ? Buffer.concat([Buffer.from([1]), u32(Buffer.byteLength(memo)), Buffer.from(memo)]) : Buffer.from([0])]);
const create = new TransactionInstruction({ programId: SQUADS, data: createData, keys: [
  { pubkey: multisig, isSigner: false, isWritable: true }, { pubkey: transaction, isSigner: false, isWritable: true },
  { pubkey: member.publicKey, isSigner: true, isWritable: false }, { pubkey: member.publicKey, isSigner: true, isWritable: true }, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
] });
const propose = new TransactionInstruction({ programId: SQUADS, data: Buffer.concat([disc("proposal_create"), u64(index), Buffer.from([0])]), keys: [
  { pubkey: multisig, isSigner: false, isWritable: false }, { pubkey: proposal, isSigner: false, isWritable: true },
  { pubkey: member.publicKey, isSigner: true, isWritable: false }, { pubkey: member.publicKey, isSigner: true, isWritable: true }, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
] });
const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
const tx = new VersionedTransaction(new TransactionMessage({ payerKey: member.publicKey, recentBlockhash: blockhash, instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }), create, propose] }).compileToLegacyMessage());
tx.sign([member]);
const sim = await connection.simulateTransaction(tx, { commitment: "confirmed" });
const out: Record<string, unknown> = { cluster, multisig: multisig.toBase58(), vault: vault.toBase58(), timeLockSecs: timeLock, transactionIndex: index.toString(), transaction: transaction.toBase58(), proposal: proposal.toBase58(),
  upgrade: { program: program.toBase58(), programData: programData.toBase58(), buffer: buffer.toBase58(), spill: spill.toBase58() },
  checks: {
    bufferExecutableHash: bufExec, verifiedBuildTable: tablePath, tableHash: tableHash ?? null, tableLibrary: row?.library ?? null,
    localBuildFile: expectFile ?? null, localBuildExecutableHash: localExec, codeBytes: codeLen,
    bufferAuthority: bufAuthority!.toBase58(), programUpgradeAuthority: programAuthority!.toBase58(), vault: vault.toBase58(),
    spill: spill.toBase58(), spillIs: spill.equals(vault) ? "the vault" : "a multisig member",
  },
  innerMessageHex: message.toString("hex"),
  simulation: { err: sim.value.err ? JSON.stringify(sim.value.err) : null, unitsConsumed: sim.value.unitsConsumed ?? null, logs: sim.value.logs ?? [] } };
if (SEND && !sim.value.err) {
  const signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 5 });
  await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
  out.signature = signature;
  out.next = [`squads-multisig-cli proposal-vote --rpc-url ${rpc} --keypair <member> --multisig-pubkey ${multisig.toBase58()} --transaction-index ${index} --action Approve   (threshold members)`, `after ${timeLock} s: squads-multisig-cli vault-transaction-execute --rpc-url ${rpc} --keypair <member> --multisig-pubkey ${multisig.toBase58()} --transaction-index ${index}`];
}
console.log(JSON.stringify(out, null, 2));
process.exit(sim.value.err ? 1 : 0);
