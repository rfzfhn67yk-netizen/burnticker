import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Keypair, PublicKey, SystemProgram, SYSVAR_CLOCK_PUBKEY, SYSVAR_RENT_PUBKEY, TransactionInstruction } from "@solana/web3.js";
import { BURN_RECEIPTS_IDL } from "@/lib/burnReceipts/idl";
import { BURN_RECEIPTS_LOCALNET_PROGRAM_ID, DEFAULT_CAP_SUNSET_TS } from "@/lib/burnReceipts/constants";
import type { PlatformConfigAccount } from "@/lib/burnReceipts/accounts";
import { applyCapRaiseIx, cancelCapRaiseIx, eventAuthority, initializePlatformIx, proposeCapRaiseIx } from "@/lib/burnReceipts/instructions";
import { platformPda, programDataAddress } from "@/lib/burnReceipts/pda";
import * as capRaise from "@/lib/burnReceipts/capRaise";
import { anchorDisc, CAP_REMOVED_CODE, CAP_REMOVED_MESSAGE, CapRefusal, checkInitializePlatform, compileVaultMessage, describePlatform, parseSunset, PLATFORM_CONFIG_SPACE, proposalCreateData, refuseCapRemoved, solToLamports, squadsProposalPda, squadsTransactionPda, vaultPda, vaultTransactionCreateData } from "@/lib/burnReceipts/capRaise";
import { FakeProgram } from "@/lib/burnKeeper/fakeProgram";

/**
 * THE CAP RAISE IS RETIRED (owner decision 2026-10-25: the burn_receipts program has no burn-pool cap, no cranker allowlist and no
 * per-run bound; propose_cap_raise / cancel_cap_raise / apply_cap_raise always refuse with CapRemoved, 6144). What is pinned here:
 * scripts/burnreceipts-cap.mts refuses every command before touching any network; the stable IDL builders still encode the unchanged
 * entry points; the Squads vault-message helpers keep their bytes; initialize_platform's remaining client check is the sunset window; the
 * in-memory program refuses the cap-raise entry points with CapRemoved and never emits a cap event.
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
  test("initialize_platform keeps its signature: disc | authority | cap u64 (ignored by the program) | sunset i64 | Vec<Pubkey> crankers (ignored); accounts per the IDL", () => {
    const ix = initializePlatformIx({ programId: PID, payer: MAINNET_VAULT, upgradeAuthority: MAINNET_VAULT, authority: MAINNET_VAULT, burnPoolCapLamports: B(0), capSunsetTs: B(DEFAULT_CAP_SUNSET_TS), crankers: [] });
    assert.equal(Buffer.from(ix.data).toString("hex"), Buffer.concat([idlDisc("initialize_platform"), MAINNET_VAULT.toBuffer(), u64(B(0)), i64(B(1_822_348_800)), u32(0)]).toString("hex"));
    assert.deepEqual(ix.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable]), [
      [MAINNET_VAULT.toBase58(), true, true], [MAINNET_VAULT.toBase58(), true, false], [programDataAddress(PID).toBase58(), false, false],
      [platformPda(PID).toBase58(), false, true], [SystemProgram.programId.toBase58(), false, false], [eventAuthority(PID).toBase58(), false, false], [PID.toBase58(), false, false]]);
    assert.equal(platformPda(PID).toBase58(), "EXz6enAb7mSUfC1bWJstF96uLZiCSdFcLLSQ9cwhhxx6");
  });
  test("propose / cancel / apply_cap_raise builders still match the IDL (the program refuses all three with CapRemoved)", () => {
    const p = proposeCapRaiseIx({ programId: PID, authority: MAINNET_VAULT, newCapLamports: solToLamports("1000") });
    assert.equal(Buffer.from(p.data).toString("hex"), Buffer.concat([idlDisc("propose_cap_raise"), u64(B(1_000_000_000_000))]).toString("hex"));
    assert.equal(Buffer.from(p.data).toString("hex"), "12ca7ab630921d6c0010a5d4e8000000");
    assert.deepEqual(p.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable]), [[MAINNET_VAULT.toBase58(), true, false], [platformPda(PID).toBase58(), false, true], [eventAuthority(PID).toBase58(), false, false], [PID.toBase58(), false, false]]);
    const caller = Keypair.generate().publicKey;
    const a = applyCapRaiseIx({ programId: PID, caller });
    assert.deepEqual(Buffer.from(a.data), idlDisc("apply_cap_raise"));
    assert.deepEqual(a.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable]), [[caller.toBase58(), true, false], [platformPda(PID).toBase58(), false, true], [eventAuthority(PID).toBase58(), false, false], [PID.toBase58(), false, false]]);
    assert.deepEqual(Buffer.from(cancelCapRaiseIx({ programId: PID, authority: MAINNET_VAULT }).data), idlDisc("cancel_cap_raise"));
  });
  test("SOL amounts are exact; sunsets parse ISO or unix seconds", () => {
    assert.equal(solToLamports("1000"), B(1_000_000_000_000));
    assert.equal(solToLamports("0.000000001"), B(1));
    assert.throws(() => solToLamports("1e3"), CapRefusal);
    assert.equal(solToLamports("25"), B(25_000_000_000));
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
  test("the vault-transaction and proposal data keep their layout", () => {
    const vault = vaultPda(MAINNET_MULTISIG);
    assert.equal(vault.toBase58(), MAINNET_VAULT.toBase58(), "vault index 0 of the mainnet multisig");
    const msg = compileVaultMessage(vault, [initializePlatformIx({ programId: PID, payer: vault, upgradeAuthority: vault, authority: vault, burnPoolCapLamports: B(0), capSunsetTs: B(DEFAULT_CAP_SUNSET_TS) })]);
    const memo = "platform config";
    assert.deepEqual(vaultTransactionCreateData(0, msg.bytes, memo), Buffer.concat([anchorDisc("vault_transaction_create"), Buffer.from([0, 0]), u32(msg.bytes.length), msg.bytes, Buffer.from([1]), u32(memo.length), Buffer.from(memo)]));
    assert.deepEqual(vaultTransactionCreateData(0, msg.bytes), Buffer.concat([anchorDisc("vault_transaction_create"), Buffer.from([0, 0]), u32(msg.bytes.length), msg.bytes, Buffer.from([0])]));
    assert.equal(proposalCreateData(B(1)).toString("hex"), "dc3c49e01e6c4f9f010000000000000000");
    assert.equal(squadsTransactionPda(MAINNET_MULTISIG, B(1)).toBase58(), "4pisg6TQZnMVe2Z6bpJA7LqcQXEB1PE5aeHKa2Cjuiwa");
    assert.equal(squadsProposalPda(MAINNET_MULTISIG, B(1)).toBase58(), "FWT9JYP8U7sZVAEJbnvGQhhMdHwiumpQXV1TchDPemRa");
  });
  test("only the vault may sign inside the message", () => {
    const stranger = Keypair.generate().publicKey;
    assert.throws(() => compileVaultMessage(MAINNET_VAULT, [initializePlatformIx({ programId: PID, payer: stranger, upgradeAuthority: MAINNET_VAULT, authority: MAINNET_VAULT, burnPoolCapLamports: B(25_000_000_000), capSunsetTs: B(DEFAULT_CAP_SUNSET_TS) })]), /only the vault can sign/);
  });
});

describe("cap raise: retired (owner decision 2026-10-25)", () => {
  const now = B(1_791_849_600); // 2026-10-13T00:00:00Z
  test("the cap-raise helpers are gone; every retired path refuses with the CapRemoved sentence", () => {
    for (const name of ["capRaiseInstructions", "checkProposeCapRaise", "checkApplyCapRaise", "checkApplySend", "checkProposeSend"]) assert.equal(name in capRaise, false, name);
    refusal(() => refuseCapRemoved(), /the burn-pool cap was removed by owner decision 2026-10-25: there is no cap to raise, cancel or apply/);
    assert.equal(CAP_REMOVED_CODE, 6144);
    assert.match(CAP_REMOVED_MESSAGE, /CapRemoved \(6144\)/);
  });
  test("the script refuses every command (propose-vault, apply, show, anything) with exit 2 before touching any network", () => {
    for (const args of [["propose-vault", "--cluster", "mainnet", "--send", "--multisig", MAINNET_MULTISIG.toBase58(), "--member", MAINNET_VAULT.toBase58()], ["apply", "--cluster", "devnet", "--send", "--i-understand-this-raises-the-cap", "--payer", MAINNET_VAULT.toBase58()], ["show", "--cluster", "mainnet"], ["show"], []]) {
      const r = runScript(args);
      assert.equal(r.status, 2, `${args.join(" ")}: ${r.stderr}`);
      assert.match(r.stderr, /^refusing: .*the burn-pool cap was removed by owner decision 2026-10-25/);
      assert.equal(r.stdout, "", "nothing printed to stdout (no transaction, no bytes)");
    }
    assert.doesNotMatch(fs.readFileSync(path.join(ROOT, "scripts", "burnreceipts-cap.mts"), "utf8"), /new Connection|sendRawTransaction|Keypair/, "the stub cannot reach a network or a key");
  });
  test("initialize_platform: the sunset stays in (now, now + 365 d] and ≤ the hard-coded 2027-10-01; the cap and crankers are not checked", () => {
    checkInitializePlatform({ sunsetTs: B(DEFAULT_CAP_SUNSET_TS), nowTs: now });
    refusal(() => checkInitializePlatform({ sunsetTs: now, nowTs: now }), /not in the future/);
    refusal(() => checkInitializePlatform({ sunsetTs: B(DEFAULT_CAP_SUNSET_TS) + B(1), nowTs: now }), /after the program's hard-coded sunset/);
    refusal(() => checkInitializePlatform({ sunsetTs: B(DEFAULT_CAP_SUNSET_TS), nowTs: B(1_700_000_000) }), /more than 365 days/);
    checkInitializePlatform({ sunsetTs: now + B(1), nowTs: now });
    assert.equal(PLATFORM_CONFIG_SPACE, 243, "the PlatformConfig layout is unchanged");
  });
  test("show text: no cap whether or not a PlatformConfig exists; an old account's cap fields are named as no longer read", () => {
    const none = describePlatform(null, B(0));
    assert.match(String(none.cap), /^none: the burn-pool cap was removed/);
    assert.match(String(none.summary), /^none: no cap; the registration-policy switch closes 09\/30\/2027, 18:00:00 MDT \(America\/Denver\) = 2027-10-01T00:00:00Z$/);
    const fresh = describePlatform(platformFixture({ burn_pool_cap_lamports: B(0) }), now);
    assert.match(String(fresh.cap), /^none:/);
    assert.equal("legacyFields" in fresh, false);
    const old = describePlatform(platformFixture({ pending_cap_lamports: B(1_000_000_000_000), pending_cap_eta: B(1_792_022_400), cranker_count: 1, crankers: [MAINNET_VAULT, PublicKey.default, PublicKey.default] }), now);
    assert.match(String(old.cap), /^none:/);
    assert.deepEqual(old.legacyFields, { burnPoolCapLamports: "25000000000", pendingCapLamports: "1000000000000", pendingCapEta: "1792022400", crankers: [MAINNET_VAULT.toBase58()], note: "written before 2026-10-25; the program no longer reads them" });
  });
  test("the in-memory program refuses the cap-raise entry points with CapRemoved (6144); renounce and clear_cranker_allowlist still succeed", () => {
    const f = new FakeProgram({ mode: "buyback", rulesSha256: "0".repeat(64), memoPrefix: "T", memoSource: "t", unitValue: B(1), attesters: [Keypair.generate().publicKey.toBase58()] });
    for (const n of ["propose_cap_raise", "cancel_cap_raise", "apply_cap_raise"] as const) assert.deepEqual(f.platformInstruction(n), { err: "CapRemoved", code: 6144 }, n);
    for (const n of ["renounce_platform_authority", "clear_cranker_allowlist"] as const) assert.deepEqual(f.platformInstruction(n), { ok: true }, n);
    assert.equal("capLamports" in f, false, "the fake has no burn-pool cap knob");
  });
});
