// BURN KEEPER (2026-10-09) — the Solana pieces: the two-key mainnet guard, the hand-written instruction bytes (BurnChecked, Memo, the
// devnet demo's mint instructions, LaunchLab's ClaimVestedToken as the SDK encodes it), the vault check, base58 for signatures, and
// the poll clock (16:30 / 20:00 America/New_York across DST).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { Keypair, PublicKey } from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID, associatedTokenAddress, base58Encode, burnCheckedIx, clusterOfGenesis, clusterRefusal, explorerUrl, GENESIS, initializeMint2Ix, MEMO_PROGRAM_ID, memoIx, mintToIx, revokeMintAuthorityIx, TOKEN_PROGRAM_ID, vaultRefusal } from "@/lib/burnKeeper/solana";
import { CLAIM_CREATOR_FEE_DISCRIMINATOR, CLAIM_VESTED_TOKEN_DISCRIMINATOR, claimCreatorFeeIxs, claimVestedTokenIx, LAUNCHLAB_PROGRAM, launchLabAuth, launchLabCreatorFeeVault, launchLabVestingRecord, parseVestingRecord, WSOL_MINT } from "@/lib/burnKeeper/launchlab";
import { backoffMs, dateIn, nextPollAt, wallTime } from "@/lib/burnKeeper/schedule";

const SHA = "d".repeat(64);

describe("the mainnet guard (two keys)", () => {
  test("cluster from the genesis hash", () => {
    assert.equal(clusterOfGenesis(GENESIS.mainnet), "mainnet");
    assert.equal(clusterOfGenesis(GENESIS.devnet), "devnet");
    assert.equal(clusterOfGenesis("somethingLocal"), "localnet");
  });
  test("devnet/localnet need nothing; --devnet refuses anything else", () => {
    assert.equal(clusterRefusal({ cluster: "devnet", devnetFlag: true, env: {}, rulesSha256: SHA }), null);
    assert.equal(clusterRefusal({ cluster: "localnet", devnetFlag: false, env: {}, rulesSha256: SHA }), null);
    assert.match(clusterRefusal({ cluster: "mainnet", devnetFlag: true, env: { BURNKEEPER_MAINNET: "1", BURNKEEPER_RULES_SHA: SHA }, rulesSha256: SHA })!, /--devnet/);
    assert.match(clusterRefusal({ cluster: "testnet", devnetFlag: true, env: {}, rulesSha256: SHA })!, /--devnet/);
  });
  test("mainnet: refused with no key, with one key, with a wrong hash; allowed with both", () => {
    assert.match(clusterRefusal({ cluster: "mainnet", devnetFlag: false, env: {}, rulesSha256: SHA })!, /both are required/);
    assert.match(clusterRefusal({ cluster: "mainnet", devnetFlag: false, env: { BURNKEEPER_MAINNET: "1" }, rulesSha256: SHA })!, /BURNKEEPER_RULES_SHA is not set/);
    assert.match(clusterRefusal({ cluster: "mainnet", devnetFlag: false, env: { BURNKEEPER_RULES_SHA: SHA }, rulesSha256: SHA })!, /BURNKEEPER_MAINNET=1 is not set/);
    assert.match(clusterRefusal({ cluster: "mainnet", devnetFlag: false, env: { BURNKEEPER_MAINNET: "true", BURNKEEPER_RULES_SHA: SHA }, rulesSha256: SHA })!, /BURNKEEPER_MAINNET=1/, "only the literal 1 arms it");
    assert.match(clusterRefusal({ cluster: "mainnet", devnetFlag: false, env: { BURNKEEPER_MAINNET: "1", BURNKEEPER_RULES_SHA: "e".repeat(64) }, rulesSha256: SHA })!, /does not match/);
    assert.equal(clusterRefusal({ cluster: "mainnet", devnetFlag: false, env: { BURNKEEPER_MAINNET: "1", BURNKEEPER_RULES_SHA: SHA.toUpperCase() }, rulesSha256: SHA }), null);
  });
  test("explorer links per cluster", () => {
    assert.equal(explorerUrl("mainnet", "S"), "https://explorer.solana.com/tx/S");
    assert.equal(explorerUrl("devnet", "S"), "https://explorer.solana.com/tx/S?cluster=devnet");
    assert.equal(explorerUrl("devnet", "A", "address"), "https://explorer.solana.com/address/A?cluster=devnet");
  });
});

describe("instruction bytes", () => {
  const vault = Keypair.generate().publicKey, mint = Keypair.generate().publicKey, keeper = Keypair.generate().publicKey;
  test("BurnChecked = [15, u64 LE amount, decimals]; vault and mint writable, keeper the only signer", () => {
    const ix = burnCheckedIx({ account: vault, mint, authority: keeper, amount: BigInt(2_100_000_000_000), decimals: 6 });
    assert.ok(ix.programId.equals(TOKEN_PROGRAM_ID));
    assert.equal(ix.data.length, 10);
    assert.equal(ix.data[0], 15);
    assert.equal(Buffer.from(ix.data).readBigUInt64LE(1), BigInt(2_100_000_000_000));
    assert.equal(ix.data[9], 6);
    assert.deepEqual(ix.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable]), [[vault.toBase58(), false, true], [mint.toBase58(), false, true], [keeper.toBase58(), true, false]]);
    assert.throws(() => burnCheckedIx({ account: vault, mint, authority: keeper, amount: BigInt(0), decimals: 6 }), /positive/);
  });
  test("Memo v2 carries the UTF-8 memo and lists the keeper as signer", () => {
    const ix = memoIx("DEBT|x", keeper);
    assert.ok(ix.programId.equals(MEMO_PROGRAM_ID));
    assert.equal(Buffer.from(ix.data).toString("utf8"), "DEBT|x");
    assert.equal(ix.keys[0].isSigner, true);
  });
  test("the devnet demo's mint instructions: InitializeMint2, MintTo, SetAuthority(None), ATA create-idempotent", () => {
    assert.deepEqual([...initializeMint2Ix(mint, 6, keeper).data.subarray(0, 2)], [20, 6]);
    assert.equal(initializeMint2Ix(mint, 6, keeper).data.length, 35);
    assert.equal(mintToIx(mint, vault, keeper, BigInt(5)).data[0], 7);
    assert.deepEqual([...revokeMintAuthorityIx(mint, keeper).data], [6, 0, 0]);
    const ata = associatedTokenAddress(keeper, mint);
    assert.ok(PublicKey.isOnCurve(keeper.toBytes()));
    assert.equal(PublicKey.isOnCurve(ata.toBytes()), false, "an ATA is a PDA");
    assert.ok(ASSOCIATED_TOKEN_PROGRAM_ID.toBase58().startsWith("ATokenGP"));
  });
  test("LaunchLab ClaimVestedToken: Anchor discriminator sha256('global:claim_vested_token')[0..8], ten accounts in the SDK's order", () => {
    assert.deepEqual([...CLAIM_VESTED_TOKEN_DISCRIMINATOR], [...crypto.createHash("sha256").update("global:claim_vested_token").digest().subarray(0, 8)]);
    const pool = Keypair.generate().publicKey;
    const ix = claimVestedTokenIx({ programId: LAUNCHLAB_PROGRAM.devnet, beneficiary: keeper, poolId: pool, mintA: mint, beneficiaryTokenAccount: vault });
    assert.equal(ix.keys.length, 10);
    assert.ok(ix.keys[0].pubkey.equals(keeper) && ix.keys[0].isSigner);
    assert.ok(ix.keys[1].pubkey.equals(launchLabAuth(LAUNCHLAB_PROGRAM.devnet)));
    assert.ok(ix.keys[3].pubkey.equals(launchLabVestingRecord(LAUNCHLAB_PROGRAM.devnet, pool, keeper)));
    assert.ok(ix.keys[5].pubkey.equals(vault));
    assert.equal(LAUNCHLAB_PROGRAM.devnet.toBase58(), "DRay6fNdQ5J82H7xV6uq2aV3mNrUZ1J4PgSKsWgptcm6");
  });
  test("the vesting record parses claimedAmount @80 and tokenShareAmount @88", () => {
    const b = Buffer.alloc(160); const pool = Keypair.generate().publicKey;
    pool.toBuffer().copy(b, 16); keeper.toBuffer().copy(b, 48); b.writeBigUInt64LE(BigInt(7), 80); b.writeBigUInt64LE(BigInt(250), 88);
    assert.deepEqual(parseVestingRecord(b), { poolId: pool.toBase58(), beneficiary: keeper.toBase58(), claimedRaw: BigInt(7), shareRaw: BigInt(250) });
    assert.equal(parseVestingRecord(new Uint8Array(10)), null);
  });
  test("base58 of 32 bytes matches PublicKey's; leading zero bytes become 1s", () => {
    const k = Keypair.generate().publicKey;
    assert.equal(base58Encode(k.toBytes()), k.toBase58());
    assert.equal(base58Encode(new Uint8Array(32)), "11111111111111111111111111111111");
  });
});

describe("the vault check (vault-only)", () => {
  const ok = { parsed: { type: "account", info: { mint: "M", owner: "K", state: "initialized" } } };
  test("accepts the keeper's own token account of this mint", () => assert.equal(vaultRefusal(ok, TOKEN_PROGRAM_ID.toBase58(), { mint: "M", keeper: "K" }), null));
  test("refuses: missing, wrong program, wrong mint, someone else's account, frozen, a delegate", () => {
    assert.match(vaultRefusal(null, null, { mint: "M", keeper: "K" })!, /does not exist/);
    assert.match(vaultRefusal(ok, "Other", { mint: "M", keeper: "K" })!, /not the SPL token program/);
    assert.match(vaultRefusal(ok, TOKEN_PROGRAM_ID.toBase58(), { mint: "X", keeper: "K" })!, /holds mint/);
    assert.match(vaultRefusal(ok, TOKEN_PROGRAM_ID.toBase58(), { mint: "M", keeper: "Treasury" })!, /owner is K, not the keeper/);
    assert.match(vaultRefusal({ parsed: { type: "account", info: { ...ok.parsed.info, state: "frozen" } } }, TOKEN_PROGRAM_ID.toBase58(), { mint: "M", keeper: "K" })!, /frozen/);
    assert.match(vaultRefusal({ parsed: { type: "account", info: { ...ok.parsed.info, delegate: "D" } } }, TOKEN_PROGRAM_ID.toBase58(), { mint: "M", keeper: "K" })!, /delegate/);
  });
});

describe("the poll clock (America/New_York)", () => {
  const polls = ["16:30", "20:00"];
  test("summer (EDT, UTC−4): from 15:00 ET the next poll is 16:30 ET = 20:30Z; from 17:00 it is 20:00 ET = 00:00Z next day", () => {
    assert.equal(new Date(nextPollAt(Date.parse("2026-10-09T19:00:00Z"), polls)).toISOString(), "2026-10-09T20:30:00.000Z");
    assert.equal(new Date(nextPollAt(Date.parse("2026-10-09T21:00:00Z"), polls)).toISOString(), "2026-10-10T00:00:00.000Z");
    assert.equal(new Date(nextPollAt(Date.parse("2026-10-10T00:00:00Z"), polls)).toISOString(), "2026-10-10T20:30:00.000Z", "strictly after now");
  });
  test("winter (EST, UTC−5): 16:30 ET = 21:30Z", () => {
    assert.equal(new Date(nextPollAt(Date.parse("2026-12-15T12:00:00Z"), polls)).toISOString(), "2026-12-15T21:30:00.000Z");
  });
  test("across the DST change (2026-11-01)", () => {
    assert.equal(new Date(nextPollAt(Date.parse("2026-10-31T23:59:00Z"), polls)).toISOString(), "2026-11-01T00:00:00.000Z");
    assert.equal(new Date(nextPollAt(Date.parse("2026-11-01T01:00:00Z"), polls)).toISOString(), "2026-11-01T21:30:00.000Z");
  });
  test("ET dates and wall time; backoff doubles to an hour", () => {
    assert.equal(dateIn(Date.parse("2026-10-10T02:00:00Z")), "2026-10-09");
    assert.deepEqual(wallTime(Date.parse("2026-10-09T20:30:00Z"), "America/New_York"), { y: 2026, m: 10, d: 9, hh: 16, mm: 30 });
    assert.equal(backoffMs(0), 15_000); assert.equal(backoffMs(2), 60_000); assert.equal(backoffMs(30), 3_600_000);
  });
});

describe("buyback mode on mainnet: the third key is the mint", () => {
  const MINT = "So11111111111111111111111111111111111111112";
  const env = { BURNKEEPER_MAINNET: "1", BURNKEEPER_RULES_SHA: SHA };
  test("refused when the rule file has no mint, or BURNKEEPER_MINT differs; allowed when all three keys agree", () => {
    assert.match(clusterRefusal({ cluster: "mainnet", devnetFlag: false, env: { ...env, BURNKEEPER_MINT: MINT }, rulesSha256: SHA, mode: "buyback", rulesMint: null })!, /mint written into the rule file/);
    assert.match(clusterRefusal({ cluster: "mainnet", devnetFlag: false, env: { ...env, BURNKEEPER_MINT: "Other1111111111111111111111111111111111111" }, rulesSha256: SHA, mode: "buyback", rulesMint: MINT })!, /is not the rule file's mint/);
    assert.equal(clusterRefusal({ cluster: "mainnet", devnetFlag: false, env: { ...env, BURNKEEPER_MINT: MINT }, rulesSha256: SHA, mode: "buyback", rulesMint: MINT }), null);
    assert.equal(clusterRefusal({ cluster: "devnet", devnetFlag: true, env: {}, rulesSha256: SHA, mode: "buyback", rulesMint: null }), null, "devnet needs no keys");
  });
  test("LaunchLab claimCreatorFee: discriminator sha256('global:claim_creator_fee')[0..8]; WSOL ATA create → claim → close (unwrap to the fee pool)", () => {
    assert.deepEqual([...CLAIM_CREATOR_FEE_DISCRIMINATOR], [...crypto.createHash("sha256").update("global:claim_creator_fee").digest().subarray(0, 8)]);
    const creator = Keypair.generate().publicKey;
    const ixs = claimCreatorFeeIxs(LAUNCHLAB_PROGRAM.mainnet, creator);
    assert.equal(ixs.length, 3);
    assert.ok(ixs[1].keys[2].pubkey.equals(launchLabCreatorFeeVault(LAUNCHLAB_PROGRAM.mainnet, creator, WSOL_MINT)));
    assert.deepEqual([...ixs[2].data], [9], "CloseAccount");
    assert.ok(ixs[2].keys[1].pubkey.equals(creator), "the unwrapped SOL goes to the keeper");
  });
});
