import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, SYSVAR_CLOCK_PUBKEY, SYSVAR_RENT_PUBKEY, Transaction, TransactionInstruction } from "@solana/web3.js";
import { BURN_RECEIPTS_IDL } from "@/lib/burnReceipts/idl";
import { BURN_RECEIPTS_LOCALNET_PROGRAM_ID, DEFAULT_CAP_SUNSET_TS } from "@/lib/burnReceipts/constants";
import { decodePlatformConfig, type PlatformConfigAccount } from "@/lib/burnReceipts/accounts";
import { applyCapRaiseIx, eventAuthority, initializePlatformIx, proposeCapRaiseIx } from "@/lib/burnReceipts/instructions";
import { platformPda, programDataAddress } from "@/lib/burnReceipts/pda";
import { confirmByPolling } from "@/lib/burnReceipts/crank";
import { anchorDisc, CapRefusal, capRaiseInstructions, checkApplyCapRaise, checkApplySend, checkInitializePlatform, checkProposeCapRaise, checkProposeSend, compileVaultMessage, describePlatform, parseSunset, PLATFORM_CONFIG_SPACE, proposalCreateData, solToLamports, squadsProposalPda, squadsTransactionPda, SQUADS_V4_PROGRAM_ID, vaultPda, vaultTransactionCreateData } from "@/lib/burnReceipts/capRaise";

/**
 * THE CAP RAISE (scripts/burnreceipts-cap.mts, docs/burnticker/CAP-RAISE.md). Unit part: instruction data against the IDL
 * discriminators and arg encodings, the Squads inner-message bytes (hand-assembled, and the one-instruction case against the bytes
 * scripts/squads-program-upgrade.mts writes), and every refusal. Localnet part (opt-in, BURN_RECEIPTS_LOCALNET=1 +
 * BURN_RECEIPTS_SQUADS_SO): the real flow through the Squads v4 program on solana-test-validator.
 */

const PID = BURN_RECEIPTS_LOCALNET_PROGRAM_ID; // AuQjoSgq…zhMM
const MAINNET_MULTISIG = new PublicKey("7gYAZ6meH3W4VwEHcqq3cWgmSAL2w7voM91oaQezvDYc");
const MAINNET_VAULT = new PublicKey("8zsHrHjSgunnLmVyPG848GLw5a9xai6u8SZCYaskWrDV");
const B = BigInt;
const u16 = (n: number) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const u64 = (n: bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(n); return b; };
const i64 = (n: bigint) => { const b = Buffer.alloc(8); b.writeBigInt64LE(n); return b; };
const idlDisc = (name: string) => Buffer.from(BURN_RECEIPTS_IDL.instructions.find((i) => i.name === name)!.discriminator);
const refusal = (f: () => unknown, re: RegExp) => assert.throws(f, (e: unknown) => e instanceof CapRefusal && re.test((e as Error).message));
const ROOT = path.join(import.meta.dirname, "..");
const SCRIPT = ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--import", "./test/alias-hook.mjs", "scripts/burnreceipts-cap.mts"];
const runScript = (args: string[], env: Record<string, string | undefined> = {}) => {
  const e = { ...process.env, ...env };
  delete e.BURNKEEPER_MAINNET;
  if (env.BURNKEEPER_MAINNET) e.BURNKEEPER_MAINNET = env.BURNKEEPER_MAINNET;
  return spawnSync(process.execPath, [...SCRIPT, ...args], { cwd: ROOT, encoding: "utf8", env: e, timeout: 120_000 });
};
const platformFixture = (o: Partial<PlatformConfigAccount> = {}): PlatformConfigAccount => ({ version: 1, bump: 255, authority: MAINNET_VAULT, burn_pool_cap_lamports: B(25_000_000_000), cap_sunset_ts: B(DEFAULT_CAP_SUNSET_TS), pending_cap_lamports: B(0), pending_cap_eta: B(0), created_at: B(1_790_000_000), crankers: [PublicKey.default, PublicKey.default, PublicKey.default], cranker_count: 0, ...o });

describe("cap raise: instruction data", () => {
  test("discriminators are the IDL's (= sha256('global:<name>')[0..8])", () => {
    for (const n of ["initialize_platform", "propose_cap_raise", "apply_cap_raise"]) assert.deepEqual(idlDisc(n), anchorDisc(n), n);
  });
  test("initialize_platform: disc | authority | cap u64 | sunset i64 | Vec<Pubkey> crankers; accounts per the IDL", () => {
    const c1 = new PublicKey(new Uint8Array(32).fill(7)), c2 = new PublicKey(new Uint8Array(32).fill(9));
    const ix = initializePlatformIx({ programId: PID, payer: MAINNET_VAULT, upgradeAuthority: MAINNET_VAULT, authority: MAINNET_VAULT, burnPoolCapLamports: B(25_000_000_000), capSunsetTs: B(DEFAULT_CAP_SUNSET_TS), crankers: [c1, c2] });
    assert.equal(Buffer.from(ix.data).toString("hex"), Buffer.concat([idlDisc("initialize_platform"), MAINNET_VAULT.toBuffer(), u64(B(25_000_000_000)), i64(B(1_822_348_800)), u32(2), c1.toBuffer(), c2.toBuffer()]).toString("hex"));
    assert.equal(Buffer.from(ix.data).subarray(40, 48).toString("hex"), "00ba1dd205000000", "25 SOL little-endian");
    assert.deepEqual(ix.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable]), [
      [MAINNET_VAULT.toBase58(), true, true], [MAINNET_VAULT.toBase58(), true, false], [programDataAddress(PID).toBase58(), false, false],
      [platformPda(PID).toBase58(), false, true], [SystemProgram.programId.toBase58(), false, false], [eventAuthority(PID).toBase58(), false, false], [PID.toBase58(), false, false]]);
    assert.equal(platformPda(PID).toBase58(), "EXz6enAb7mSUfC1bWJstF96uLZiCSdFcLLSQ9cwhhxx6");
  });
  test("propose_cap_raise(1000 SOL) and apply_cap_raise", () => {
    const p = proposeCapRaiseIx({ programId: PID, authority: MAINNET_VAULT, newCapLamports: solToLamports("1000") });
    assert.equal(Buffer.from(p.data).toString("hex"), Buffer.concat([idlDisc("propose_cap_raise"), u64(B(1_000_000_000_000))]).toString("hex"));
    assert.equal(Buffer.from(p.data).toString("hex"), "12ca7ab630921d6c0010a5d4e8000000");
    assert.deepEqual(p.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable]), [[MAINNET_VAULT.toBase58(), true, false], [platformPda(PID).toBase58(), false, true], [eventAuthority(PID).toBase58(), false, false], [PID.toBase58(), false, false]]);
    const caller = Keypair.generate().publicKey;
    const a = applyCapRaiseIx({ programId: PID, caller });
    assert.deepEqual(Buffer.from(a.data), idlDisc("apply_cap_raise"));
    assert.deepEqual(a.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable]), [[caller.toBase58(), true, false], [platformPda(PID).toBase58(), false, true], [eventAuthority(PID).toBase58(), false, false], [PID.toBase58(), false, false]]);
  });
  test("SOL amounts are exact; sunsets parse ISO or unix seconds", () => {
    assert.equal(solToLamports("1000"), B(1_000_000_000_000));
    assert.equal(solToLamports("0.000000001"), B(1));
    assert.throws(() => solToLamports("1e3"), CapRefusal);
    assert.equal(parseSunset("2027-10-01"), B(DEFAULT_CAP_SUNSET_TS));
    assert.equal(parseSunset("1822348800"), B(DEFAULT_CAP_SUNSET_TS));
    assert.throws(() => parseSunset("next year"), CapRefusal);
    assert.equal(PLATFORM_CONFIG_SPACE, 243);
  });
});

describe("cap raise: the Squads vault message", () => {
  test("one instruction: the same bytes scripts/squads-program-upgrade.mts writes by hand for a program upgrade", () => {
    const LOADER = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
    const vault = vaultPda(MAINNET_MULTISIG);
    const [programData, program, buffer, spill] = [programDataAddress(PID), PID, Keypair.generate().publicKey, Keypair.generate().publicKey];
    // squads-program-upgrade.mts, verbatim layout:
    const keys = [vault, programData, program, buffer, spill, SYSVAR_RENT_PUBKEY, SYSVAR_CLOCK_PUBKEY, LOADER];
    const theirs = Buffer.concat([Buffer.from([1, 0, 4, keys.length]), ...keys.map((k) => k.toBuffer()), Buffer.from([1, 7, 7, 1, 2, 3, 4, 5, 6, 0]), u16(4), u32(3), Buffer.from([0])]);
    const upgrade = new TransactionInstruction({ programId: LOADER, data: u32(3), keys: [
      { pubkey: programData, isSigner: false, isWritable: true }, { pubkey: program, isSigner: false, isWritable: true }, { pubkey: buffer, isSigner: false, isWritable: true },
      { pubkey: spill, isSigner: false, isWritable: true }, { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false }, { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: vault, isSigner: true, isWritable: false }] });
    assert.equal(compileVaultMessage(vault, [upgrade]).bytes.toString("hex"), theirs.toString("hex"));
  });
  test("two instructions: initialize_platform + propose_cap_raise, hand-assembled byte for byte (mainnet vault, default sunset, no crankers)", () => {
    const vault = vaultPda(MAINNET_MULTISIG);
    assert.equal(vault.toBase58(), MAINNET_VAULT.toBase58(), "vault index 0 of the mainnet multisig");
    const ixs = capRaiseInstructions({ programId: PID, vault, platformExists: false, sunsetTs: B(DEFAULT_CAP_SUNSET_TS), crankers: [], newCapLamports: solToLamports("1000") });
    const initData = Buffer.concat([idlDisc("initialize_platform"), vault.toBuffer(), u64(B(25_000_000_000)), i64(B(DEFAULT_CAP_SUNSET_TS)), u32(0)]);
    const proposeData = Buffer.concat([idlDisc("propose_cap_raise"), u64(B(1_000_000_000_000))]);
    // keys: [vault (writable signer)] [platform (writable)] [program_data, system, event_authority, burn_receipts (read-only)]
    const keys = [vault, platformPda(PID), programDataAddress(PID), SystemProgram.programId, eventAuthority(PID), PID];
    const expected = Buffer.concat([
      Buffer.from([1, 1, 1, keys.length]), ...keys.map((k) => k.toBuffer()),
      Buffer.from([2]),
      Buffer.from([5, 7, 0, 0, 2, 1, 3, 4, 5]), u16(initData.length), initData, // payer, upgrade_authority, program_data, platform, system, event_authority, program
      Buffer.from([5, 4, 0, 1, 4, 5]), u16(proposeData.length), proposeData, //     authority, platform, event_authority, program
      Buffer.from([0]), //                                                          no address lookup tables
    ]);
    const msg = compileVaultMessage(vault, ixs);
    assert.equal(msg.bytes.toString("hex"), expected.toString("hex"));
    assert.equal(msg.bytes.length, 293);
    assert.equal(crypto.createHash("sha256").update(msg.bytes).digest("hex"), "1aed60ec80384af050316bc6259b7e72847a5ceb791ad2f1802a5390c3d7f82d", "the mainnet message the owner will vote on (default sunset, no crankers)");
    // vault_transaction_create: disc | vault_index 0 | ephemeral_signers 0 | Vec<u8> message | Option<String> memo
    const memo = "burn pool cap 25 -> 1000 SOL";
    assert.deepEqual(vaultTransactionCreateData(0, msg.bytes, memo), Buffer.concat([anchorDisc("vault_transaction_create"), Buffer.from([0, 0]), u32(293), msg.bytes, Buffer.from([1]), u32(memo.length), Buffer.from(memo)]));
    assert.deepEqual(vaultTransactionCreateData(0, msg.bytes), Buffer.concat([anchorDisc("vault_transaction_create"), Buffer.from([0, 0]), u32(293), msg.bytes, Buffer.from([0])]));
    assert.equal(proposalCreateData(B(1)).toString("hex"), "dc3c49e01e6c4f9f010000000000000000");
    assert.equal(squadsTransactionPda(MAINNET_MULTISIG, B(1)).toBase58(), "4pisg6TQZnMVe2Z6bpJA7LqcQXEB1PE5aeHKa2Cjuiwa");
    assert.equal(squadsProposalPda(MAINNET_MULTISIG, B(1)).toBase58(), "FWT9JYP8U7sZVAEJbnvGQhhMdHwiumpQXV1TchDPemRa");
  });
  test("an existing PlatformConfig: propose_cap_raise only (vault a read-only signer)", () => {
    const ixs = capRaiseInstructions({ programId: PID, vault: MAINNET_VAULT, platformExists: true, sunsetTs: B(0), crankers: [], newCapLamports: solToLamports("1000") });
    assert.equal(ixs.length, 1);
    const msg = compileVaultMessage(MAINNET_VAULT, ixs);
    assert.deepEqual([...msg.bytes.subarray(0, 4)], [1, 0, 1, 4]);
  });
  test("only the vault may sign inside the message", () => {
    const stranger = Keypair.generate().publicKey;
    assert.throws(() => compileVaultMessage(MAINNET_VAULT, [initializePlatformIx({ programId: PID, payer: stranger, upgradeAuthority: MAINNET_VAULT, authority: MAINNET_VAULT, burnPoolCapLamports: B(25_000_000_000), capSunsetTs: B(DEFAULT_CAP_SUNSET_TS) })]), /only the vault can sign/);
  });
});

describe("cap raise: refusals", () => {
  const now = B(1_791_849_600); // 2026-10-13T00:00:00Z
  const ok = { capLamports: B(25_000_000_000), sunsetTs: B(DEFAULT_CAP_SUNSET_TS), nowTs: now, crankers: [] as PublicKey[] };
  test("initialize_platform: cap must be exactly 25 SOL", () => {
    checkInitializePlatform(ok);
    refusal(() => checkInitializePlatform({ ...ok, capLamports: B(24_000_000_000) }), /must equal the program's default/);
    refusal(() => checkInitializePlatform({ ...ok, capLamports: B(1_000_000_000_000) }), /must equal the program's default/);
  });
  test("initialize_platform: sunset in (now, now + 365 d] and ≤ the hard-coded 2027-10-01", () => {
    refusal(() => checkInitializePlatform({ ...ok, sunsetTs: now }), /not in the future/);
    refusal(() => checkInitializePlatform({ ...ok, sunsetTs: B(DEFAULT_CAP_SUNSET_TS) + B(1) }), /after the program's hard-coded sunset/);
    refusal(() => checkInitializePlatform({ ...ok, nowTs: B(1_700_000_000) }), /more than 365 days/);
    checkInitializePlatform({ ...ok, sunsetTs: now + B(1) });
  });
  test("initialize_platform: at most 3 distinct, non-zero crankers", () => {
    const k = () => Keypair.generate().publicKey;
    checkInitializePlatform({ ...ok, crankers: [k(), k(), k()] });
    refusal(() => checkInitializePlatform({ ...ok, crankers: [k(), k(), k(), k()] }), /at most 3 crankers/);
    const d = k();
    refusal(() => checkInitializePlatform({ ...ok, crankers: [d, d] }), /listed twice/);
    refusal(() => checkInitializePlatform({ ...ok, crankers: [PublicKey.default] }), /all-zero/);
  });
  test("propose_cap_raise on an existing config: vault must be the authority, the cap must rise, a pending raise is not silently replaced", () => {
    const cap = B(1_000_000_000_000);
    checkProposeCapRaise({ platform: platformFixture(), vault: MAINNET_VAULT, newCapLamports: cap, replacePending: false });
    refusal(() => checkProposeCapRaise({ platform: platformFixture({ authority: Keypair.generate().publicKey }), vault: MAINNET_VAULT, newCapLamports: cap, replacePending: false }), /not the vault/);
    refusal(() => checkProposeCapRaise({ platform: platformFixture({ authority: PublicKey.default }), vault: MAINNET_VAULT, newCapLamports: cap, replacePending: false }), /renounced/);
    refusal(() => checkProposeCapRaise({ platform: platformFixture(), vault: MAINNET_VAULT, newCapLamports: B(25_000_000_000), replacePending: false }), /only be raised/);
    const pending = platformFixture({ pending_cap_lamports: cap, pending_cap_eta: now });
    refusal(() => checkProposeCapRaise({ platform: pending, vault: MAINNET_VAULT, newCapLamports: cap, replacePending: false }), /already pending.*--replace-pending/);
    checkProposeCapRaise({ platform: pending, vault: MAINNET_VAULT, newCapLamports: cap, replacePending: true });
  });
  test("apply: refuses before the 48 h with the time left, without a pending raise, without a config", () => {
    const eta = now + B(47 * 3600 + 59 * 60 + 30);
    const p = platformFixture({ pending_cap_lamports: B(1_000_000_000_000), pending_cap_eta: eta });
    refusal(() => checkApplyCapRaise(p, now), /timelock has not elapsed: 1d 23h 59m 30s left \(eta .*America\/Denver.* = 2026-10-14T23:59:30Z\)/);
    refusal(() => checkApplyCapRaise(p, eta - B(1)), /0h 0m 1s left/);
    checkApplyCapRaise(p, eta);
    refusal(() => checkApplyCapRaise(platformFixture(), now), /no raise is pending/);
    refusal(() => checkApplyCapRaise(null, now), /no PlatformConfig/);
  });
  test("send gates: propose-vault never sends on mainnet; apply --send needs the flag everywhere and BURNKEEPER_MAINNET=1 on mainnet", () => {
    refusal(() => checkProposeSend({ cluster: "mainnet", send: true }), /never sends on mainnet/);
    checkProposeSend({ cluster: "devnet", send: true });
    checkProposeSend({ cluster: "mainnet", send: false });
    refusal(() => checkApplySend({ cluster: "devnet", send: true, understood: false, mainnetEnv: undefined }), /--i-understand-this-raises-the-cap/);
    refusal(() => checkApplySend({ cluster: "mainnet", send: true, understood: true, mainnetEnv: undefined }), /BURNKEEPER_MAINNET=1/);
    checkApplySend({ cluster: "mainnet", send: true, understood: true, mainnetEnv: "1" });
    checkApplySend({ cluster: "mainnet", send: false, understood: false, mainnetEnv: undefined });
  });
  test("the script itself refuses those sends before touching any network (exit 2)", () => {
    const a = runScript(["propose-vault", "--cluster", "mainnet", "--send", "--multisig", MAINNET_MULTISIG.toBase58(), "--member", MAINNET_VAULT.toBase58()]);
    assert.equal(a.status, 2, a.stderr); assert.match(a.stderr, /refusing: propose-vault never sends on mainnet/);
    const b = runScript(["apply", "--cluster", "mainnet", "--send", "--i-understand-this-raises-the-cap", "--payer", MAINNET_VAULT.toBase58()]);
    assert.equal(b.status, 2, b.stderr); assert.match(b.stderr, /BURNKEEPER_MAINNET=1/);
    const c = runScript(["apply", "--cluster", "devnet", "--send", "--payer", MAINNET_VAULT.toBase58()]);
    assert.equal(c.status, 2, c.stderr); assert.match(c.stderr, /--i-understand-this-raises-the-cap/);
    const d = runScript(["show"]);
    assert.equal(d.status, 2); assert.match(d.stderr, /--cluster/);
  });
  test("show text: none → the default cap until the sunset; a pending raise in Denver time and UTC", () => {
    assert.match(String(describePlatform(null, B(0)).summary), /^none: default 25 SOL cap until 09\/30\/2027, 18:00:00 MDT \(America\/Denver\) = 2027-10-01T00:00:00Z$/);
    const d = describePlatform(platformFixture({ pending_cap_lamports: B(1_000_000_000_000), pending_cap_eta: B(1_792_022_400) }), B(1_791_849_600));
    assert.deepEqual(d.pending, { cap: "1000 SOL (1000000000000 lamports)", eta: "10/14/2026, 18:00:00 MDT (America/Denver) = 2026-10-15T00:00:00Z", appliable: "in 2d 0h 0m 0s" });
    assert.equal(d.cap, "25 SOL (25000000000 lamports)");
    assert.equal(d.crankers, "none (anyone may crank)");
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// LOCALNET: the real flow through the Squads v4 program.
//   BURN_RECEIPTS_LOCALNET=1 BURN_RECEIPTS_SQUADS_SO=<squads v4 .so> [BURN_RECEIPTS_LOCALNET_SO=<burn_receipts --features localnet .so>]
// The Squads .so is the mainnet program's bytes (`solana program dump SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf`, read-only).
// A 1-of-1 multisig with time lock 0 is preloaded (Squads v4 Multisig layout); the burn program's upgrade authority is its vault.
// The Clock cannot be moved 48 h on a test validator (--warp-slot moves it only hours, and a warped ledger cannot be warped again), so
// the apply step runs on a SECOND validator preloaded with the PlatformConfig the first one wrote, pending_cap_eta moved to the past.
// ---------------------------------------------------------------------------------------------------------------------------------
const RUN = process.env.BURN_RECEIPTS_LOCALNET === "1";
const SO = process.env.BURN_RECEIPTS_LOCALNET_SO ?? path.join(ROOT, "programs", "burn-receipts", "target", "deploy-localnet", "burn_receipts.so");
const SQUADS_SO = process.env.BURN_RECEIPTS_SQUADS_SO ?? "";
const SKIP: string | false = !RUN ? "set BURN_RECEIPTS_LOCALNET=1 and BURN_RECEIPTS_SQUADS_SO to run (starts solana-test-validator)" : !fs.existsSync(SO) ? `missing ${SO}` : !fs.existsSync(SQUADS_SO) ? "BURN_RECEIPTS_SQUADS_SO is missing" : false;

function findBin(name: string): string {
  const local = path.join(os.homedir(), ".local", "share", "solana", "install", "active_release", "bin", name);
  return fs.existsSync(local) ? local : name;
}
const accountJson = (dir: string, name: string, pubkey: PublicKey, data: Buffer, owner: PublicKey, lamports = 10_000_000) => {
  const f = path.join(dir, `${name}.json`);
  fs.writeFileSync(f, JSON.stringify({ pubkey: pubkey.toBase58(), account: { lamports, data: [data.toString("base64"), "base64"], owner: owner.toBase58(), executable: false, rentEpoch: 0, space: data.length } }));
  return f;
};

describe("cap raise on localnet (Squads v4 + burn_receipts)", { skip: SKIP }, () => {
  let validator: ChildProcess | null = null;
  let connection: Connection;
  let rpc = "";
  const dir = RUN ? fs.mkdtempSync(path.join(os.tmpdir(), "cap-raise-")) : "";
  const member = Keypair.generate();
  const createKey = Keypair.generate().publicKey;
  const [multisig, msBump] = PublicKey.findProgramAddressSync([Buffer.from("multisig"), Buffer.from("multisig"), createKey.toBuffer()], SQUADS_V4_PROGRAM_ID);
  const vault = vaultPda(multisig);
  const cranker = Keypair.generate().publicKey;
  const memberPath = path.join(dir, "member.json");
  const log: string[] = [];
  const note = (s: string) => { log.push(s); };

  async function startValidator(extra: string[]) {
    const ledger = fs.mkdtempSync(path.join(dir, "ledger-"));
    const port = 20_000 + Math.floor(Math.random() * 2_000) * 4;
    validator = spawn(findBin("solana-test-validator"), ["--reset", "--quiet", "--ledger", ledger, "--bind-address", "127.0.0.1", "--rpc-port", String(port), "--faucet-port", String(port + 2), "--gossip-port", String(port + 3), "--dynamic-port-range", `${port + 10}-${port + 40}`,
      "--upgradeable-program", PID.toBase58(), SO, vault.toBase58(), "--bpf-program", SQUADS_V4_PROGRAM_ID.toBase58(), SQUADS_SO, ...extra], { stdio: "ignore" });
    rpc = `http://127.0.0.1:${port}`;
    connection = new Connection(rpc, { commitment: "confirmed" });
    const t0 = Date.now();
    for (;;) {
      try { await connection.getSlot(); break; } catch { /* starting */ }
      if (Date.now() - t0 > 90_000) throw new Error("validator did not start");
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  async function stopValidator() {
    if (!validator) return;
    const v = validator;
    validator = null;
    await new Promise<void>((r) => { v.once("exit", () => r()); v.kill("SIGINT"); });
  }
  async function airdrop(to: PublicKey, lamports: number) {
    const { lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    await confirmByPolling(connection, await connection.requestAirdrop(to, lamports), lastValidBlockHeight + 300, 200);
  }
  async function send(ixs: TransactionInstruction[]) {
    const tx = new Transaction().add(...ixs);
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash; tx.feePayer = member.publicKey; tx.sign(member);
    const sig = await connection.sendRawTransaction(tx.serialize());
    const err = await confirmByPolling(connection, sig, lastValidBlockHeight);
    assert.equal(err, null, `${sig}: ${JSON.stringify(err)}`);
    return sig;
  }
  const cap = (args: string[], env: Record<string, string> = {}) => {
    const r = runScript([args[0], "--cluster", "localnet", "--rpc", rpc, ...args.slice(1)], env);
    let json: Record<string, unknown> | null = null;
    try { json = JSON.parse(r.stdout); } catch { /* refusal */ }
    return { status: r.status, stderr: r.stderr, json };
  };
  const platform = async () => { const a = await connection.getAccountInfo(platformPda(PID), "confirmed"); return a ? decodePlatformConfig(a.data) : null; };
  const chainNow = async () => (await connection.getAccountInfo(SYSVAR_CLOCK_PUBKEY, "confirmed"))!.data.readBigInt64LE(32);

  before(async () => {
    fs.writeFileSync(memberPath, JSON.stringify([...member.secretKey]), { mode: 0o600 });
    // Squads v4 Multisig: disc | create_key | config_authority (default = autonomous) | threshold 1 | time_lock 0 | transaction_index 0 |
    // stale 0 | rent_collector None (space for Some) | bump | members [{ member, Initiate|Vote|Execute }]
    const space = 8 + 32 + 32 + 2 + 4 + 8 + 8 + 33 + 1 + 4 + 33;
    const ms = Buffer.alloc(space);
    let o = 0;
    crypto.createHash("sha256").update("account:Multisig").digest().subarray(0, 8).copy(ms, o); o += 8;
    createKey.toBuffer().copy(ms, o); o += 32;
    o += 32;
    ms.writeUInt16LE(1, o); o += 2;
    ms.writeUInt32LE(0, o); o += 4;
    o += 16;
    ms[o++] = 0;
    ms[o++] = msBump;
    ms.writeUInt32LE(1, o); o += 4;
    member.publicKey.toBuffer().copy(ms, o); o += 32;
    ms[o] = 7;
    await startValidator(["--account", multisig.toBase58(), accountJson(dir, "multisig", multisig, ms, SQUADS_V4_PROGRAM_ID)]);
    await airdrop(member.publicKey, 10 * LAMPORTS_PER_SOL);
  });
  after(async () => {
    await stopValidator();
    if (process.env.BURN_RECEIPTS_CAP_LOG) fs.writeFileSync(process.env.BURN_RECEIPTS_CAP_LOG, log.join("\n") + "\n");
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  test("propose-vault → approve → execute writes the PlatformConfig and the pending 1,000 SOL raise; apply refuses before 48 h; apply after the eta raises the cap", async () => {
    const base = ["--multisig", multisig.toBase58(), "--member", memberPath, "--cranker", cranker.toBase58(), "--memo", "burn pool cap 25 -> 1000 SOL"];
    // 0. nothing yet
    const s0 = cap(["show"]);
    assert.equal(s0.status, 0, s0.stderr); assert.equal(s0.json!.platformConfig, "none");
    // 1. the vault holds no SOL yet: the dry run says who pays the rent and that the vault cannot yet
    const d0 = cap(["propose-vault", ...base]);
    assert.equal(d0.status, 1, d0.stderr);
    const rent = d0.json!.rent as { payer: string; enough: boolean; rentLamports: string };
    assert.deepEqual([rent.payer, rent.enough], ["the vault", false]);
    note(`dry run, vault unfunded: exit 1, rent ${rent.rentLamports} lamports payable by the vault — ${(d0.json!.innerSimulation as { err: string }).err}`);
    await airdrop(vault, 10_000_000);
    // 2. dry run: the inner message simulated as the vault, the PlatformConfig it would write
    const d1 = cap(["propose-vault", ...base]);
    assert.equal(d1.status, 0, d1.stderr);
    const would = d1.json!.platformConfigTheProgramWouldWrite as { raw: Record<string, unknown>; pending: { cap: string } };
    assert.equal(would.raw.authority, vault.toBase58());
    assert.equal(would.raw.burn_pool_cap_lamports, "25000000000");
    assert.equal(would.raw.pending_cap_lamports, "1000000000000");
    assert.equal(would.raw.cap_sunset_ts, String(DEFAULT_CAP_SUNSET_TS));
    assert.equal(would.pending.cap, "1000 SOL (1000000000000 lamports)");
    assert.equal(await platform(), null, "a dry run writes nothing");
    // 3. --send: vault_transaction_create + proposal_create by the member
    const p = cap(["propose-vault", ...base, "--send"]);
    assert.equal(p.status, 0, p.stderr);
    const sent = p.json!.sent as { signature: string; err: string | null };
    assert.equal(sent.err, null);
    assert.equal(p.json!.innerMessageHex, d1.json!.innerMessageHex);
    note(`proposal (vault transaction 1): ${sent.signature}; inner message ${(p.json!.innerMessageHex as string).length / 2} bytes`);
    // 4. approve + execute (what squads-multisig-cli proposal-vote / vault-transaction-execute send)
    const index = B(1);
    const proposal = squadsProposalPda(multisig, index), transaction = squadsTransactionPda(multisig, index);
    const approve = new TransactionInstruction({ programId: SQUADS_V4_PROGRAM_ID, data: Buffer.concat([anchorDisc("proposal_approve"), Buffer.from([0])]), keys: [
      { pubkey: multisig, isSigner: false, isWritable: false }, { pubkey: member.publicKey, isSigner: true, isWritable: true }, { pubkey: proposal, isSigner: false, isWritable: true }] });
    note(`approve: ${await send([approve])}`);
    const keys = p.json!.innerMessageKeys as { pubkey: string; signer: boolean; writable: boolean }[];
    const execute = new TransactionInstruction({ programId: SQUADS_V4_PROGRAM_ID, data: anchorDisc("vault_transaction_execute"), keys: [
      { pubkey: multisig, isSigner: false, isWritable: false }, { pubkey: proposal, isSigner: false, isWritable: true }, { pubkey: transaction, isSigner: false, isWritable: false },
      { pubkey: member.publicKey, isSigner: true, isWritable: false }, ...keys.map((k) => ({ pubkey: new PublicKey(k.pubkey), isSigner: false, isWritable: k.writable }))] });
    const vaultBefore = await connection.getBalance(vault);
    const t0 = await chainNow();
    note(`execute: ${await send([execute])}`);
    const pc = (await platform())!;
    assert.equal(pc.authority.toBase58(), vault.toBase58());
    assert.equal(pc.burn_pool_cap_lamports, B(25_000_000_000));
    assert.equal(pc.cap_sunset_ts, B(DEFAULT_CAP_SUNSET_TS));
    assert.equal(pc.pending_cap_lamports, B(1_000_000_000_000));
    assert.ok(pc.pending_cap_eta >= t0 + B(48 * 3600) && pc.pending_cap_eta <= t0 + B(48 * 3600 + 60), "eta = execution time + 48 h");
    assert.deepEqual([pc.cranker_count, pc.crankers[0].toBase58()], [1, cranker.toBase58()]);
    const rentPaid = vaultBefore - (await connection.getBalance(vault));
    assert.equal(rentPaid, await connection.getMinimumBalanceForRentExemption(PLATFORM_CONFIG_SPACE), "the vault paid exactly the PlatformConfig rent");
    note(`PlatformConfig written: authority = vault, cap 25 SOL, pending 1000 SOL, eta ${pc.pending_cap_eta}, 1 cranker; the vault paid ${rentPaid} lamports`);
    // 5. show
    const s1 = cap(["show"]);
    assert.equal(s1.status, 0);
    assert.match(String((s1.json!.pending as { eta: string }).eta), /America\/Denver\) = \d{4}-\d\d-\d\dT/);
    // 6. apply before the eta: the script refuses with the time left; the program itself refuses too (TimelockNotElapsed 6034)
    const a0 = cap(["apply", "--payer", memberPath]);
    assert.equal(a0.status, 2); assert.match(a0.stderr, /timelock has not elapsed: (1d 23h|2d 0h) \d+m \d+s left/);
    note(`apply before the eta: ${a0.stderr.trim()}`);
    const direct = new Transaction().add(applyCapRaiseIx({ programId: PID, caller: member.publicKey }));
    direct.feePayer = member.publicKey; direct.recentBlockhash = (await connection.getLatestBlockhash()).blockhash; direct.sign(member);
    const sim = await connection.simulateTransaction(direct);
    assert.deepEqual(sim.value.err, { InstructionError: [0, { Custom: 6034 }] });
    // 7. propose again on the existing config: propose_cap_raise only, refused while one is pending unless --replace-pending
    const r0 = cap(["propose-vault", "--multisig", multisig.toBase58(), "--member", memberPath]);
    assert.equal(r0.status, 2); assert.match(r0.stderr, /already pending/);
    const r1 = cap(["propose-vault", "--multisig", multisig.toBase58(), "--member", memberPath, "--replace-pending", "--new-cap-sol", "2000"]);
    assert.equal(r1.status, 0, r1.stderr);
    assert.match(String((r1.json!.contains as string[])[0]), /propose_cap_raise only/);
    assert.equal((r1.json!.innerInstructions as unknown[]).length, 1);
    assert.equal((r1.json!.platformConfigTheProgramWouldWrite as { raw: { pending_cap_lamports: string } }).raw.pending_cap_lamports, "2000000000000");

    // 8. a second validator with this PlatformConfig, pending_cap_eta moved 48 h back (offset 66), so the timelock has elapsed
    const acc = (await connection.getAccountInfo(platformPda(PID), "confirmed"))!;
    const moved = Buffer.from(acc.data);
    moved.writeBigInt64LE(pc.pending_cap_eta - B(48 * 3600 + 120), 66);
    await stopValidator();
    await startValidator(["--account", platformPda(PID).toBase58(), accountJson(dir, "platform", platformPda(PID), moved, PID, acc.lamports)]);
    await airdrop(member.publicKey, LAMPORTS_PER_SOL);
    const a1 = cap(["apply", "--payer", memberPath]);
    assert.equal(a1.status, 0, a1.stderr);
    assert.equal(((a1.json!.wouldWrite as { cap: string }).cap), "1000 SOL (1000000000000 lamports)");
    const a2 = cap(["apply", "--payer", memberPath, "--send"]);
    assert.equal(a2.status, 2); assert.match(a2.stderr, /--i-understand-this-raises-the-cap/);
    const a3 = cap(["apply", "--payer", memberPath, "--send", "--i-understand-this-raises-the-cap"]);
    assert.equal(a3.status, 0, a3.stderr);
    const after = (await platform())!;
    assert.deepEqual([after.burn_pool_cap_lamports, after.pending_cap_lamports, after.pending_cap_eta], [B(1_000_000_000_000), B(0), B(0)]);
    note(`apply after the eta (second validator, eta moved back): ${(a3.json!.sent as { signature: string }).signature}; cap now 1000 SOL, nothing pending`);
    const s2 = cap(["show"]);
    assert.equal(s2.json!.cap, "1000 SOL (1000000000000 lamports)");
    assert.equal(s2.json!.pending, "none");
  });
});
