import { describe, test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { AddressLookupTableAccount, Ed25519Program, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { BURN_RECEIPTS_IDL } from "../src/lib/burnReceipts/idl.ts";
import { accountDiscriminator, encodeInstruction, encodeType } from "../src/lib/burnReceipts/idlCoder.ts";
import { attestationMessage, attestReading, ed25519SharedMessageInstruction, ed25519VerifyInstruction, signAttestation, sourceUrlHash, verifyAttestation } from "../src/lib/burnReceipts/attestation.ts";
import { bs58, decodeReading, decodeTokenConfig, READING_OFFSET_CONFIG, READING_OFFSET_PREV_DATE, READING_OFFSET_RECORD_DATE } from "../src/lib/burnReceipts/accounts.ts";
import { configPda, feePda, feeTokenAddress, feeWsolAddress, launchlabCreatorFeeVault, launchlabPoolPda, launchlabVaultAuthority, lpLockVault, platformPda, programDataAddress, readingPda, vaultAddress, associatedTokenAddress } from "../src/lib/burnReceipts/pda.ts";
import { applyRegistrationPolicyIx, cancelRegistrationPolicyIx, checkPoolHealthIx, claimLaunchlabCreatorFeeIx, clearCrankerAllowlistIx, crankBuybackIx, crankVaultIx, eventAuthority, initializePlatformIx, initializeTokenIx, operatorAttester, registerPoolIx, setRegistrationPolicyIx, submitReadingIx, vetoRegistrationPolicyIx, syncNativeIx, zktlsRelayerAttester } from "../src/lib/burnReceipts/instructions.ts";
import { buybackPoolAccounts, decodeCpmmPool, POOL_STATE_DISCRIMINATOR } from "../src/lib/burnReceipts/cpmm.ts";
import { anchorErrorName, assertClusterAllowed, buildSizedTransaction, DEFERRABLE_ERRORS, memoFromLogs, memoFromTransaction, readingLookupTableAddresses, redactRpcUrl } from "../src/lib/burnReceipts/crank.ts";
import { checkPlatformPins } from "../src/lib/burnReceipts/platformPins.ts";
import { assertSignableGenesis, BURN_RECEIPTS_LOCALNET_PROGRAM_ID, CPMM_PROGRAM_ID, DEFAULT_BURN_POOL_CAP_LAMPORTS, GENESIS_HASH, LOCALNET_GENESIS_TAG, LAUNCHLAB_PROGRAM_ID, LOCK_CPMM_AUTHORITY, MAX_QUORUM, MEMO_PROGRAM_ID, MODE_BUYBACK, NATIVE_MINT, PACKET_DATA_SIZE, TOKEN_PROGRAM_ID } from "../src/lib/burnReceipts/constants.ts";
import { ruleParamsFromKeeperRules } from "../src/lib/burnReceipts/math.ts";

const PID = BURN_RECEIPTS_LOCALNET_PROGRAM_ID;
const G = GENESIS_HASH.mainnet;
const MINT = new PublicKey(Buffer.alloc(32, 7));
const anchorDisc = (kind: "global" | "account", name: string) => crypto.createHash("sha256").update(`${kind}:${name}`).digest().subarray(0, 8);

describe("burnReceipts client — IDL", () => {
  test("the committed IDL matches a fresh `anchor build` when one is present", () => {
    const built = path.join(import.meta.dirname, "..", "programs", "burn-receipts", "target", "idl", "burn_receipts.json");
    if (!fs.existsSync(built)) return; // no local build: nothing to compare against
    assert.deepEqual(JSON.parse(fs.readFileSync(built, "utf8")), JSON.parse(JSON.stringify(BURN_RECEIPTS_IDL)), "run: (cd programs/burn-receipts && anchor build && node scripts/sync-idl.mjs)");
  });
  test("discriminators are Anchor's sha256('global:<ix>') / sha256('account:<Name>')", () => {
    for (const ix of BURN_RECEIPTS_IDL.instructions) assert.deepEqual(Buffer.from(ix.discriminator), anchorDisc("global", ix.name), ix.name);
    for (const a of BURN_RECEIPTS_IDL.accounts) assert.deepEqual(accountDiscriminator(BURN_RECEIPTS_IDL, a.name), anchorDisc("account", a.name));
  });
  test("the Powers Register is generated from this IDL and up to date", () => {
    const r = spawnSync(process.execPath, [path.join(import.meta.dirname, "..", "programs", "burn-receipts", "scripts", "powers-register.mjs"), "--check"], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    const reg = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "..", "docs", "burn-receipts", "powers-register.json"), "utf8"));
    assert.deepEqual(reg.privileged_powers.sort(), ["cancel_attester_change", "cancel_cap_raise", "cancel_registration_policy", "clear_cranker_allowlist", "propose_attesters", "propose_cap_raise", "renounce_admin", "renounce_platform_authority", "set_registration_policy", "veto_registration_policy"]);
    const privilegedRoles = ["config_authority", "platform_authority", "attester_key", "platform_authority_or_listed_cranker"];
    for (const i of reg.instructions) if (i.class === "privileged") assert.ok(i.signers.every((s: { role: string }) => privilegedRoles.includes(s.role)));
    // Re-check R3-2 / R3-4: the attester's only transaction power is the veto; the allowlist can be cleared by a listed key.
    assert.deepEqual(reg.instructions.filter((i: { signers: { role: string }[] }) => i.signers.some((s) => s.role === "attester_key")).map((i: { name: string }) => i.name), ["veto_registration_policy"]);
    assert.ok(reg.temporary_powers.every((t: { sunset: string }) => t.sunset.length > 0), "every temporary power names its sunset");
  });
  test("no instruction can withdraw, close or sweep", () => {
    const names = BURN_RECEIPTS_IDL.instructions.map((i) => i.name).sort();
    assert.deepEqual(names, ["apply_attester_change", "apply_cap_raise", "apply_registration_policy", "cancel_attester_change", "cancel_cap_raise", "cancel_registration_policy", "check_pool_health", "claim_launchlab_creator_fee", "clear_cranker_allowlist", "crank_buyback", "crank_no_units", "crank_vault", "initialize_platform", "initialize_token", "propose_attesters", "propose_cap_raise", "register_pair_pool", "register_pool", "renounce_admin", "renounce_platform_authority", "replace_pool", "set_registration_policy", "submit_reading", "veto_registration_policy"]);
  });
});

describe("burnReceipts client — PDAs and accounts", () => {
  test("PDAs are deterministic and distinct", () => {
    const c = configPda(PID, MINT), f = feePda(PID, MINT);
    assert.ok(!c.equals(f));
    assert.ok(readingPda(PID, c, 20261008).equals(readingPda(PID, c, 20261008)));
    assert.ok(!readingPda(PID, c, 20261008).equals(readingPda(PID, c, 20261009)));
    assert.ok(vaultAddress(PID, MINT).equals(associatedTokenAddress(c, MINT)));
    assert.ok(feeWsolAddress(PID, MINT).equals(associatedTokenAddress(f, NATIVE_MINT)));
    assert.ok(feeTokenAddress(PID, MINT).equals(associatedTokenAddress(f, MINT)));
    assert.throws(() => readingPda(PID, c, -1));
  });
  test("TokenConfig and Reading round-trip through the IDL coder; filter offsets point at the right fields", () => {
    const rule = ruleParamsFromKeeperRules(
      { mode: "buyback", decimals: 6, vaultAllocation: "1", buyback: { fractionPerUnit: "0.05", reserveSol: "0.02", slippageBps: 300 }, rule: { unitUsd: "1000000000", burnPerUnitTokens: "100000", maxAbsDeltaUsd: "2000000000000", carry: "consecutive-increases", onNonIncrease: "burn-nothing-reset-carry" } },
      { floorLamports: BigInt(1), maxTwapDeviationBps: 1500, twapWindowSecs: 600 },
    );
    const pad = (s: string, n: number) => { const b = new Uint8Array(n); b.set(Buffer.from(s)); return b; };
    const a1 = Keypair.generate().publicKey;
    const cfg = {
      version: 1, bump: 255, fee_bump: 254, has_baseline: true, mint: MINT, creator: a1, admin: PublicKey.default, rule,
      rules_sha256: new Uint8Array(32).fill(7), params_hash: new Uint8Array(32).fill(9),
      feed_id: pad("treasury.debt_to_penny", 32), feed_id_len: 22, memo_prefix: pad("DEBT", 12), memo_prefix_len: 4, memo_source: pad("fiscaldata.treasury.gov debt_to_penny", 64), memo_source_len: 37,
      attesters: [operatorAttester(a1), ...Array.from({ length: 4 }, () => operatorAttester(PublicKey.default))], attester_count: 1, quorum: 1,
      pending_attesters: Array.from({ length: 5 }, () => operatorAttester(PublicKey.default)), pending_count: 0, pending_quorum: 0, pending_eta: BigInt(0),
      cpmm_pool: PublicKey.default, last_record_date: 20261008, last_value: BigInt("4030531621082972"), carry: BigInt(28006346253), crank_cursor: 20261007,
      readings: 3, burns: 1, total_burned: BigInt(5), total_spent_lamports: BigInt(6), shortfall: BigInt(0), created_at: BigInt(1791547200), carried_spend_lamports: BigInt(11), pool_untradeable_since: BigInt(0), pool_untradeable_last_seen: BigInt(0), pool_verified: false, cluster_genesis: new PublicKey(G), registration_policy: 0, ll_platform: a1, ll_cp_config: PublicKey.default, ll_lock_scale_ppm: BigInt(1_000_000), pool_untradeable_candidate_at: BigInt(0), attester_added_at: [BigInt(1791547200), BigInt(0), BigInt(0), BigInt(0), BigInt(0)], pending_policy: 0, pending_policy_pool: PublicKey.default, pending_policy_eta: BigInt(0), reserved: new Uint8Array(23),
    };
    const data = Buffer.concat([accountDiscriminator(BURN_RECEIPTS_IDL, "TokenConfig"), encodeType(BURN_RECEIPTS_IDL, { defined: { name: "TokenConfig" } }, cfg)]);
    const back = decodeTokenConfig(data);
    assert.equal(back.feedId, "treasury.debt_to_penny");
    assert.equal(back.memoSource, "fiscaldata.treasury.gov debt_to_penny");
    assert.equal(back.rule.fraction_per_unit_bps, 500);
    assert.equal(back.rule.mode, MODE_BUYBACK);
    assert.equal(back.carry, BigInt(28006346253));
    assert.equal(back.adminRenounced, true);
    assert.equal(back.poolRegistered, false);
    assert.equal(back.activeAttesters.length, 1);
    assert.ok(back.activeAttesters[0].key.equals(a1));
    assert.equal(back.activeAttesters[0].kind, 0);
    assert.equal(back.cluster_genesis.toBase58(), G);
    assert.equal(data.length, 8 + 1017, "TokenConfig::INIT_SPACE + 8");
    assert.ok(back.ll_platform.equals(a1)); assert.equal(back.attester_added_at[0], BigInt(1791547200));

    const cfgKey = configPda(PID, MINT);
    const r = {
      version: 1, bump: 250, kind: 1, processed: false, config: cfgKey, record_date: 20261008, prev_date: 20261007, value: BigInt(2), prev_value: BigInt(1), delta: BigInt(-3),
      carry_in: BigInt(0), carry_out: BigInt(0), units: BigInt(21), signers_mask: 1, source_url_hash: new Uint8Array(32).fill(3), proof_hash: new Uint8Array(32), submitted_at: BigInt(9), outcome: 0, processed_at: BigInt(0),
      pool_lamports: BigInt(0), spent_lamports: BigInt(0), got: BigInt(0), burned: BigInt(0), owed: BigInt(0), shortfall: BigInt(0), pool_actual_lamports: BigInt(7), rule_spend_lamports: BigInt(0), carried_in_lamports: BigInt(0), carried_out_lamports: BigInt(0), pool: MINT,
    };
    const rd = Buffer.concat([accountDiscriminator(BURN_RECEIPTS_IDL, "Reading"), encodeType(BURN_RECEIPTS_IDL, { defined: { name: "Reading" } }, r)]);
    assert.equal(decodeReading(rd).delta, BigInt(-3));
    assert.equal(decodeReading(rd).pool_actual_lamports, BigInt(7));
    assert.ok(decodeReading(rd).pool.equals(MINT));
    assert.ok(new PublicKey(rd.subarray(READING_OFFSET_CONFIG, READING_OFFSET_CONFIG + 32)).equals(cfgKey));
    assert.equal(rd.readUInt32LE(READING_OFFSET_RECORD_DATE), 20261008);
    assert.equal(rd.readUInt32LE(READING_OFFSET_PREV_DATE), 20261007);
    assert.throws(() => decodeReading(data), /discriminator/);
  });
  test("bs58 matches PublicKey's encoding and keeps leading zeros", () => {
    const k = Keypair.generate().publicKey;
    assert.equal(bs58(k.toBuffer()), k.toBase58());
    assert.equal(bs58(new Uint8Array(32)), "11111111111111111111111111111111");
    assert.equal(bs58(Buffer.from([0, 0, 1])), "112");
  });
});

describe("burnReceipts client — attestation", () => {
  const SRC = sourceUrlHash("https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/debt_to_penny?sort=-record_date&page[size]=1");
  test("canonical message: feed, period, value, source-URL hash, proof locator", () => {
    const m = attestationMessage(G, PID, MINT, "treasury.debt_to_penny", 20261007, 20261008, BigInt("4030531621082972"), 2, SRC).toString();
    assert.equal(m, `BURNRECEIPTS-v3|${G}|${PID.toBase58()}|${MINT.toBase58()}|treasury.debt_to_penny|prev=2026-10-07|2026-10-08|40305316210829.72|src=${SRC.toString("hex")}|proof=${"0".repeat(64)}`);
    assert.match(attestationMessage(G, PID, MINT, "x", 0, 20261008, BigInt(1), 2, SRC, new Uint8Array(32).fill(0xab)).toString(), /\|prev=none\|2026-10-08\|0\.01\|src=[0-9a-f]{64}\|proof=(ab){32}$/);
    assert.throws(() => attestationMessage(G, PID, MINT, "a|b", 0, 20261008, BigInt(1), 2, SRC));
    assert.throws(() => attestationMessage(G, PID, MINT, "x", 0, 20261332, BigInt(1), 2, SRC));
    assert.throws(() => attestationMessage(G, PID, MINT, "x", 20261399, 20261008, BigInt(1), 2, SRC));
    assert.throws(() => attestationMessage(G, PID, MINT, "x", 0, 20261008, BigInt(0), 2, SRC));
    assert.throws(() => attestationMessage(G, PID, MINT, "x", 0, 20261008, BigInt(1), 2, new Uint8Array(32)), /non-zero/);
  });
  test("signatures verify, and a single-signature instruction is byte-identical to web3.js's Ed25519Program", () => {
    const k = Keypair.generate();
    const msg = attestationMessage(G, PID, MINT, "treasury.debt_to_penny", 0, 20261008, BigInt("4030531621082972"), 2, SRC);
    const sig = signAttestation(k.secretKey, msg);
    assert.ok(verifyAttestation(k.publicKey, msg, sig));
    assert.ok(!verifyAttestation(Keypair.generate().publicKey, msg, sig));
    const mine = ed25519VerifyInstruction([{ publicKey: k.publicKey, signature: sig, message: msg }]);
    const theirs = Ed25519Program.createInstructionWithPublicKey({ publicKey: k.publicKey.toBytes(), message: msg, signature: sig });
    assert.deepEqual(Buffer.from(mine.data), Buffer.from(theirs.data));
    assert.ok(mine.programId.equals(theirs.programId));
  });
  test("multi-signature instruction: every entry's offsets resolve to its own (pubkey, signature, message)", () => {
    const ks = [Keypair.generate(), Keypair.generate(), Keypair.generate()];
    const { instruction, message } = attestReading({ genesisHash: G, programId: PID, mint: MINT, feedId: "treasury.debt_to_penny", prevDate: 20261007, recordDate: 20261008, value: BigInt(42), valueDecimals: 2, sourceUrlHash: SRC, signers: ks.map((k) => ({ publicKey: k.publicKey, secretKey: k.secretKey })) });
    const d = Buffer.from(instruction.data);
    assert.equal(d[0], 3);
    for (let i = 0; i < 3; i++) {
      const o = 2 + i * 14;
      const sigOff = d.readUInt16LE(o), pkOff = d.readUInt16LE(o + 4), msgOff = d.readUInt16LE(o + 8), len = d.readUInt16LE(o + 10);
      for (const idx of [o + 2, o + 6, o + 12]) assert.equal(d.readUInt16LE(idx), 0xffff);
      const pk = new PublicKey(d.subarray(pkOff, pkOff + 32));
      assert.ok(pk.equals(ks[i].publicKey));
      assert.deepEqual(d.subarray(msgOff, msgOff + len), message);
      assert.ok(verifyAttestation(pk, message, d.subarray(sigOff, sigOff + 64)));
    }
  });
});

describe("burnReceipts client — instructions", () => {
  test("account order, flags and args follow the IDL", () => {
    const payer = Keypair.generate().publicKey;
    const rule = ruleParamsFromKeeperRules(
      { mode: "vault", decimals: 6, vaultAllocation: "0", buyback: { fractionPerUnit: "0.05", reserveSol: "0.02", slippageBps: 300 }, rule: { unitUsd: "1000000000", burnPerUnitTokens: "100000", maxAbsDeltaUsd: "2000000000000", carry: "consecutive-increases", onNonIncrease: "burn-nothing-reset-carry" } },
      { floorLamports: BigInt(0), maxTwapDeviationBps: 0, twapWindowSecs: 0 },
    );
    const init = initializeTokenIx({ programId: PID, payer, creator: payer, mint: MINT, args: { feed_id: "treasury.debt_to_penny", memo_prefix: "DEBT", memo_source: "src", rules_sha256: new Uint8Array(32), rule, attesters: [operatorAttester(payer)], quorum: 1, fixed_pool: PublicKey.default, admin: payer } });
    assert.deepEqual(init.keys.map((k) => [k.isSigner, k.isWritable]), [[true, true], [true, false], [true, false], [false, true], [false, true], [false, false], [false, false], [false, false], [false, false]]);
    assert.ok(init.keys[6].pubkey.equals(PID), "the omitted optional LaunchLab platform (vault mode)");
    assert.ok(init.keys[7].pubkey.equals(eventAuthority(PID)), "event-CPI authority");
    assert.ok(init.keys[8].pubkey.equals(PID), "the program itself (event self-CPI)");
    assert.ok(init.keys[2].pubkey.equals(MINT));
    assert.ok(init.keys[3].pubkey.equals(configPda(PID, MINT)));
    assert.deepEqual(init.data.subarray(0, 8), anchorDisc("global", "initialize_token"));

    const src = new Uint8Array(32).fill(5), proof = new Uint8Array(32).fill(6);
    const sub = submitReadingIx({ programId: PID, payer, mint: MINT, recordDate: 20261008, value: BigInt("4030531621082972"), sourceUrlHash: src, proofHash: proof });
    assert.deepEqual(sub.data.subarray(0, 8), anchorDisc("global", "submit_reading"));
    assert.equal(sub.data.length, 8 + 4 + 8 + 32 + 32);
    assert.deepEqual(sub.data.subarray(20, 52), Buffer.from(src));
    assert.deepEqual(sub.data.subarray(52, 84), Buffer.from(proof));
    assert.equal(sub.data.readUInt32LE(8), 20261008);
    assert.equal(sub.data.readBigUInt64LE(12), BigInt("4030531621082972"));

    const cv = crankVaultIx({ programId: PID, cranker: payer, mint: MINT, recordDate: 20261008 });
    assert.ok(cv.keys[4].pubkey.equals(vaultAddress(PID, MINT)));
    assert.ok(cv.keys[5].pubkey.equals(TOKEN_PROGRAM_ID));
    assert.deepEqual(encodeInstruction(BURN_RECEIPTS_IDL, "crank_vault", { record_date: 20261008 }), cv.data);
  });
  test("crank_buyback resolves the pool's accounts WSOL → token and pins the cluster's CPMM id", () => {
    const pool = Keypair.generate().publicKey;
    const d = Buffer.alloc(637);
    POOL_STATE_DISCRIMINATOR.copy(d, 0);
    const keys = Array.from({ length: 10 }, () => Keypair.generate().publicKey);
    keys.forEach((k, i) => k.toBuffer().copy(d, 8 + i * 32));
    // token_0 = the mint, token_1 = WSOL (mint > WSOL ordering case)
    MINT.toBuffer().copy(d, 168);
    NATIVE_MINT.toBuffer().copy(d, 200);
    const view = decodeCpmmPool(pool, d);
    const acc = buybackPoolAccounts(view, MINT, CPMM_PROGRAM_ID.mainnet);
    assert.equal(acc.wsolIsToken0, false);
    assert.ok(acc.wsolVault.equals(view.token1Vault) && acc.tokenVault.equals(view.token0Vault));
    assert.throws(() => buybackPoolAccounts(view, Keypair.generate().publicKey, CPMM_PROGRAM_ID.mainnet));
    const ix = crankBuybackIx({ programId: PID, cranker: MINT, mint: MINT, recordDate: 20261008, pool: acc, cluster: "devnet" });
    assert.equal(ix.keys.length, 21);
    assert.ok(ix.keys.some((k) => k.pubkey.equals(platformPda(PID))), "the platform config (burn-pool cap) rides along");
    assert.ok(ix.keys[15].pubkey.equals(CPMM_PROGRAM_ID.devnet));
    assert.ok(ix.keys[9].pubkey.equals(pool) && ix.keys[9].isWritable);
  });
});

describe("burnReceipts client — attesters", () => {
  test("attester entries are (kind, key); kinds are informational", () => {
    const k = Keypair.generate().publicKey;
    assert.deepEqual(operatorAttester(k), { kind: 0, key: k });
    assert.deepEqual(zktlsRelayerAttester(k), { kind: 1, key: k });
  });
});

describe("burnReceipts client — platform cap", () => {
  test("initialize_platform carries the ProgramData account so only the upgrade authority can sign it", () => {
    const ua = Keypair.generate().publicKey;
    const ix = initializePlatformIx({ programId: PID, payer: ua, upgradeAuthority: ua, authority: ua, burnPoolCapLamports: DEFAULT_BURN_POOL_CAP_LAMPORTS, capSunsetTs: BigInt(1_800_000_000) });
    assert.ok(ix.keys.some((k) => k.pubkey.equals(programDataAddress(PID))));
    assert.ok(ix.keys.some((k) => k.pubkey.equals(platformPda(PID)) && k.isWritable));
    assert.equal(ix.data.readBigUInt64LE(8 + 32), BigInt(25_000_000_000));
  });
});

describe("burnReceipts client — LaunchLab claim (review H-2)", () => {
  test("LaunchLab PDAs match the Raydium SDK, and the account names match the keeper's burnPool.ts", async () => {
    const sdk = await import("@raydium-io/raydium-sdk-v2");
    const ll = LAUNCHLAB_PROGRAM_ID.mainnet;
    assert.ok(ll.equals(sdk.LAUNCHPAD_PROGRAM));
    const fee = feePda(PID, MINT);
    assert.ok(launchlabVaultAuthority(ll).equals(sdk.getPdaCreatorFeeVaultAuth(ll).publicKey));
    assert.ok(launchlabCreatorFeeVault(ll, fee).equals(sdk.getPdaCreatorVault(ll, fee, NATIVE_MINT).publicKey));
    const names = BURN_RECEIPTS_IDL.instructions.find((i) => i.name === "claim_launchlab_creator_fee")!.accounts.map((a) => a.name);
    assert.deepEqual(names.sort(), ["associated_token_program", "config", "event_authority", "fee_tokens", "fee_vault", "fee_wsol", "launchlab_creator_fee_vault", "launchlab_program", "launchlab_vault_authority", "payer", "program", "system_program", "token_program", "wsol_mint"]);
    const ix = claimLaunchlabCreatorFeeIx({ programId: PID, payer: MINT, mint: MINT, cluster: "mainnet" });
    assert.ok(ix.keys.some((k) => k.pubkey.equals(launchlabCreatorFeeVault(ll, fee)) && k.isWritable));
    assert.ok(ix.keys.some((k) => k.pubkey.equals(feeWsolAddress(PID, MINT)) && k.isWritable));
    // Review-2 F13: the fee PDA's token ATA rides along READ-ONLY (balance re-checked; never passed to LaunchLab).
    assert.ok(ix.keys.some((k) => k.pubkey.equals(feeTokenAddress(PID, MINT)) && !k.isWritable));
  });
});

describe("burnReceipts client — review 2", () => {
  const SRC = sourceUrlHash("https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/debt_to_penny?sort=-record_date&page[size]=1");
  const FEED = "treasury.debt_to_penny";
  const keys = Array.from({ length: 5 }, () => Keypair.generate());
  const payer = Keypair.generate();
  const submitIxs = (n: number) => {
    const { instruction } = attestReading({ genesisHash: G, programId: PID, mint: MINT, feedId: FEED, prevDate: 20261008, recordDate: 20261009, value: BigInt("4030531621082972"), valueDecimals: 2, sourceUrlHash: SRC, signers: keys.slice(0, n).map((k) => ({ publicKey: k.publicKey, secretKey: k.secretKey })) });
    return [instruction, submitReadingIx({ programId: PID, payer: payer.publicKey, mint: MINT, recordDate: 20261009, value: BigInt("4030531621082972"), sourceUrlHash: SRC })];
  };
  const blockhash = Keypair.generate().publicKey.toBase58();
  const lut = new AddressLookupTableAccount({ key: Keypair.generate().publicKey, state: { deactivationSlot: BigInt("18446744073709551615"), lastExtendedSlot: 0, lastExtendedSlotStartIndex: 0, authority: undefined, addresses: readingLookupTableAddresses(PID, MINT) } });

  test("F4: the shared-message layout — one message copy, every signature pointing at it; one signature = web3.js's layout", () => {
    const msg = attestationMessage(G, PID, MINT, FEED, 0, 20261008, BigInt(1), 2, SRC);
    const sigs = keys.slice(0, 3).map((k) => ({ publicKey: k.publicKey, signature: signAttestation(k.secretKey, msg) }));
    const ix = ed25519SharedMessageInstruction(msg, sigs);
    const d = Buffer.from(ix.data);
    assert.equal(d.length, 2 + 3 * 14 + 3 * 96 + msg.length, "exactly one copy of the message");
    const msgOffs = new Set([0, 1, 2].map((i) => d.readUInt16LE(2 + i * 14 + 8)));
    assert.equal(msgOffs.size, 1);
    for (let i = 0; i < 3; i++) {
      const o = 2 + i * 14;
      assert.ok(verifyAttestation(new PublicKey(d.subarray(d.readUInt16LE(o + 4), d.readUInt16LE(o + 4) + 32)), msg, d.subarray(d.readUInt16LE(o), d.readUInt16LE(o) + 64)));
    }
    // ed25519VerifyInstruction picks the shared layout automatically when every entry signs the same bytes.
    assert.deepEqual(Buffer.from(ed25519VerifyInstruction(sigs.map((x) => ({ ...x, message: msg }))).data), d);
  });
  test("F4: transaction size — quorum 1–3 fit a LEGACY transaction; beyond, a v0 transaction through the lookup table or an explicit error", () => {
    for (let n = 1; n <= MAX_QUORUM; n++) {
      const t = buildSizedTransaction({ instructions: submitIxs(n), signers: [payer], recentBlockhash: blockhash });
      assert.equal(t.version, "legacy", `quorum ${n}`);
      assert.ok(t.size <= PACKET_DATA_SIZE, `quorum ${n}: ${t.size} B`);
      assert.equal(t.size, t.tx.serialize().length);
    }
    assert.throws(() => buildSizedTransaction({ instructions: submitIxs(4), signers: [payer], recentBlockhash: blockhash }), /bytes \(limit 1232\); pass a lookup table/);
    const v0 = buildSizedTransaction({ instructions: submitIxs(4), signers: [payer], recentBlockhash: blockhash, lookupTable: lut });
    assert.equal(v0.version, 0);
    assert.ok(v0.size <= PACKET_DATA_SIZE, `${v0.size} B`);
    assert.deepEqual(readingLookupTableAddresses(PID, MINT).map((k) => k.toBase58()), [configPda(PID, MINT), new PublicKey("Sysvar1nstructions1111111111111111111111111"), SystemProgram.programId, eventAuthority(PID)].map((k) => k.toBase58()));
  });
  test("F3: SyncNative for the fee PDA's WSOL account; a stale-balance refusal is retryable", () => {
    const ix = syncNativeIx(feeWsolAddress(PID, MINT));
    assert.ok(ix.programId.equals(TOKEN_PROGRAM_ID));
    assert.deepEqual([...ix.data], [17]);
    assert.ok(ix.keys[0].pubkey.equals(feeWsolAddress(PID, MINT)) && ix.keys[0].isWritable);
    for (const e of ["WsolBalanceMismatch", "TwapDeviation", "TwapUnavailable", "PoolNotTradable", "EmptyReserves"]) assert.ok(DEFERRABLE_ERRORS.has(e), e);
  });
  test("F5 / review-3 M-3: register_pool carries the LP mint, Raydium's LP-lock account and (policy 0) the LaunchLab pool — the platform is pinned at init", () => {
    const lpMint = Keypair.generate().publicKey, pool = Keypair.generate().publicKey;
    const ix = registerPoolIx({ programId: PID, registrar: payer.publicKey, mint: MINT, pool, lpMint, cluster: "devnet" });
    const ll = LAUNCHLAB_PROGRAM_ID.devnet;
    for (const k of [lpMint, lpLockVault("devnet", lpMint), launchlabPoolPda(ll, MINT)]) assert.ok(ix.keys.some((x) => x.pubkey.equals(k)), k.toBase58());
    assert.ok(lpLockVault("devnet", lpMint).equals(associatedTokenAddress(LOCK_CPMM_AUTHORITY.devnet, lpMint)));
    // Fixed pool: the optional LaunchLab pool is omitted (Anchor: the program id in its slot).
    const fixed = registerPoolIx({ programId: PID, registrar: payer.publicKey, mint: MINT, pool, lpMint, cluster: "devnet", fixedPool: true });
    assert.equal(fixed.keys.length, ix.keys.length);
    assert.equal(fixed.keys.filter((k) => k.pubkey.equals(PID)).length, 2, "the omitted optional + the program itself");
    // initialize_token takes the LaunchLab platform to pin (optional account; omitted → the program id).
    const rule = ruleParamsFromKeeperRules(
      { mode: "buyback", decimals: 6, vaultAllocation: "0", buyback: { fractionPerUnit: "0.05", reserveSol: "0.02", slippageBps: 300 }, rule: { unitUsd: "1000000000", burnPerUnitTokens: "100000", maxAbsDeltaUsd: "2000000000000", carry: "consecutive-increases", onNonIncrease: "burn-nothing-reset-carry" } },
      { floorLamports: BigInt(1), maxTwapDeviationBps: 300, twapWindowSecs: 1200 },
    );
    const platform = Keypair.generate().publicKey;
    const args = { feed_id: "f", memo_prefix: "DEBT", memo_source: "s", rules_sha256: new Uint8Array(32), rule, attesters: [operatorAttester(payer.publicKey)], quorum: 1, fixed_pool: PublicKey.default, admin: payer.publicKey };
    assert.ok(initializeTokenIx({ programId: PID, payer: payer.publicKey, creator: payer.publicKey, mint: MINT, args, launchlabPlatform: platform }).keys.some((k) => k.pubkey.equals(platform)));
  });
  test("review-3: the new instructions follow the IDL (registration-policy switch, cranker allowlist, sysvar on health checks)", () => {
    const pool = Keypair.generate().publicKey, lpMint = Keypair.generate().publicKey;
    const set = setRegistrationPolicyIx({ programId: PID, admin: payer.publicKey, mint: MINT, policy: 1, pool });
    assert.ok(set.keys[0].isSigner && set.keys.some((k) => k.pubkey.equals(platformPda(PID))));
    assert.deepEqual(set.data.subarray(0, 8), anchorDisc("global", "set_registration_policy"));
    assert.ok(new PublicKey(set.data.subarray(9, 41)).equals(pool));
    const apply = applyRegistrationPolicyIx({ programId: PID, caller: payer.publicKey, mint: MINT, cluster: "mainnet", pool, lpMint });
    assert.ok(apply.keys.some((k) => k.pubkey.equals(lpLockVault("mainnet", lpMint))));
    const back = applyRegistrationPolicyIx({ programId: PID, caller: payer.publicKey, mint: MINT, cluster: "mainnet" });
    assert.equal(back.keys.filter((k) => k.pubkey.equals(PID)).length, 5, "four omitted optionals (pool, LP mint, lock vault, LaunchLab platform) + the program itself");
    assert.ok(cancelRegistrationPolicyIx({ programId: PID, admin: payer.publicKey, mint: MINT }).keys[0].isSigner);
    assert.deepEqual(clearCrankerAllowlistIx({ programId: PID, caller: payer.publicKey }).data.subarray(0, 8), anchorDisc("global", "clear_cranker_allowlist"));
    const health = checkPoolHealthIx({ programId: PID, caller: payer.publicKey, mint: MINT, pool, wsolVault: pool });
    assert.ok(health.keys.some((k) => k.pubkey.equals(new PublicKey("Sysvar1nstructions1111111111111111111111111"))));
    const plat = initializePlatformIx({ programId: PID, payer: payer.publicKey, upgradeAuthority: payer.publicKey, authority: payer.publicKey, burnPoolCapLamports: DEFAULT_BURN_POOL_CAP_LAMPORTS, capSunsetTs: BigInt(1_800_000_000), crankers: [pool] });
    assert.equal(plat.data.readUInt32LE(8 + 32 + 8 + 8), 1, "one cranker");
  });
  test("review-3 I-1: a mainnet-bound message is never signed off mainnet; devnet/mainnet need the RPC's genesis", () => {
    assert.throws(() => assertSignableGenesis(GENESIS_HASH.mainnet, "localnet", "x"), /refusing to sign a mainnet-bound message on localnet/);
    assert.throws(() => assertSignableGenesis(GENESIS_HASH.mainnet, "devnet", GENESIS_HASH.devnet), /mainnet-bound/);
    assert.throws(() => assertSignableGenesis(GENESIS_HASH.devnet, "devnet", "other"), /RPC's is other/);
    assertSignableGenesis(LOCALNET_GENESIS_TAG, "localnet", "any-local-genesis");
    assertSignableGenesis(GENESIS_HASH.devnet, "devnet", GENESIS_HASH.devnet);
    assertSignableGenesis(GENESIS_HASH.mainnet, "mainnet", GENESIS_HASH.mainnet);
  });
  test("F5: LaunchLab's pool PDA is the SDK's getPdaLaunchpadPoolId", async () => {
    const sdk = await import("@raydium-io/raydium-sdk-v2");
    assert.ok(launchlabPoolPda(LAUNCHLAB_PROGRAM_ID.mainnet, MINT).equals(sdk.getPdaLaunchpadPoolId(LAUNCHLAB_PROGRAM_ID.mainnet, MINT, NATIVE_MINT).publicKey));
  });
  test("F10: the memo is read from the burn program's own Memo CPI, never from another Memo instruction", () => {
    const other = Keypair.generate().publicKey;
    const tx = {
      transaction: { message: { instructions: [{ programId: MEMO_PROGRAM_ID, parsed: "SPOOF|v2" }, { programId: other, data: "" }, { programId: PID, data: "" }] } },
      meta: { innerInstructions: [
        { index: 1, instructions: [{ programId: MEMO_PROGRAM_ID, parsed: "NOT-OURS|v2" }] },
        { index: 2, instructions: [{ programId: TOKEN_PROGRAM_ID, parsed: { type: "burn" } }, { programId: MEMO_PROGRAM_ID, parsed: "DEBT|2026-10-08|v2" }] },
      ] },
    } as never;
    assert.equal(memoFromTransaction(tx, PID), "DEBT|2026-10-08|v2");
    assert.equal(memoFromTransaction(null, PID), null);
    // Review-3 L-6: two readings cranked in one transaction — the memo of the reading asked for.
    const two = {
      transaction: { message: { instructions: [{ programId: PID, data: "" }, { programId: PID, data: "" }] } },
      meta: { innerInstructions: [
        { index: 0, instructions: [{ programId: MEMO_PROGRAM_ID, parsed: "DEBT|2026-10-08|units=1|v2" }] },
        { index: 1, instructions: [{ programId: MEMO_PROGRAM_ID, parsed: "DEBT|2026-10-09|units=2|v2" }] },
      ] },
    } as never;
    assert.equal(memoFromTransaction(two, PID, 20261009), "DEBT|2026-10-09|units=2|v2");
    assert.equal(memoFromTransaction(two, PID, 20261008), "DEBT|2026-10-08|units=1|v2");
    assert.equal(memoFromTransaction(two, PID, 20261010), null);
    // Unparsed (base58 data) works too.
    const raw = { transaction: { message: { instructions: [{ programId: PID, data: "" }] } }, meta: { innerInstructions: [{ index: 0, instructions: [{ programId: MEMO_PROGRAM_ID, data: "3yZe7d" }] }] } } as never;
    assert.equal(memoFromTransaction(raw, PID), "test");
  });
});

describe("burnReceipts crank helpers", () => {
  test("log parsing", () => {
    assert.equal(anchorErrorName(["Program log: AnchorError occurred. Error Code: TwapDeviation. Error Number: 6027."]), "TwapDeviation");
    assert.equal(memoFromLogs(['Program log: Memo (len 12): "DEBT|x|y|v2"']), "DEBT|x|y|v2");
    assert.equal(memoFromLogs(["nothing"]), null);
  });
  test("mainnet is refused without allowMainnet — by label and by genesis hash", async () => {
    const fake = (genesis: string) => ({ getGenesisHash: async () => genesis }) as never;
    await assert.rejects(assertClusterAllowed({ connection: fake("x"), programId: PID, mint: MINT, cluster: "mainnet" }), /mainnet refused/);
    await assert.rejects(assertClusterAllowed({ connection: fake("5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d"), programId: PID, mint: MINT, cluster: "devnet" }), /RPC is mainnet/);
    await assertClusterAllowed({ connection: fake("EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG"), programId: PID, mint: MINT, cluster: "devnet" });
    // Review L-6: allowMainnet lifts only the refusal, never the consistency check.
    await assert.rejects(assertClusterAllowed({ connection: fake("5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d"), programId: PID, mint: MINT, cluster: "devnet", allowMainnet: true }), /RPC is mainnet/);
    await assert.rejects(assertClusterAllowed({ connection: fake("localgenesis"), programId: PID, mint: MINT, cluster: "devnet" }), /RPC is localnet/);
    await assertClusterAllowed({ connection: fake("5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d"), programId: PID, mint: MINT, cluster: "mainnet", allowMainnet: true });
  });
});

describe("burnReceipts client — re-check after round 3", () => {
  const payer = Keypair.generate().publicKey;
  test("R3-2: veto_registration_policy is signed by the attester; apply passes the pinned LaunchLab platform when asked", () => {
    const veto = vetoRegistrationPolicyIx({ programId: PID, attester: payer, mint: MINT });
    assert.deepEqual(veto.data.subarray(0, 8), anchorDisc("global", "veto_registration_policy"));
    assert.ok(veto.keys[0].pubkey.equals(payer) && veto.keys[0].isSigner && !veto.keys[0].isWritable);
    assert.ok(veto.keys[1].pubkey.equals(configPda(PID, MINT)) && veto.keys[1].isWritable);
    const platform = Keypair.generate().publicKey, pool = Keypair.generate().publicKey, lpMint = Keypair.generate().publicKey;
    const apply = applyRegistrationPolicyIx({ programId: PID, caller: payer, mint: MINT, cluster: "mainnet", pool, lpMint, launchlabPlatform: platform });
    const names = BURN_RECEIPTS_IDL.instructions.find((i) => i.name === "apply_registration_policy")!.accounts.map((a) => a.name);
    assert.ok(apply.keys[names.indexOf("launchlab_platform")].pubkey.equals(platform));
    const clear = clearCrankerAllowlistIx({ programId: PID, caller: payer });
    assert.equal(BURN_RECEIPTS_IDL.instructions.find((i) => i.name === "clear_cranker_allowlist")!.accounts[0].name, "caller");
    assert.ok(clear.keys[0].isSigner);
  });
  test("R3-3: checkPlatformPins refuses a changed platformCpCreator, scales or cpConfigId and a missing / foreign platform", () => {
    const fee = feePda(PID, MINT), cp = Keypair.generate().publicKey, platform = Keypair.generate().publicKey;
    const data = (cpConfig: PublicKey, creator: PublicKey, scales: [number, number, number]) => {
      const d = Buffer.alloc(944);
      cpConfig.toBuffer().copy(d, 688);
      creator.toBuffer().copy(d, 800);
      scales.forEach((v, i) => d.writeBigUInt64LE(BigInt(v), 80 + 8 * i));
      return d;
    };
    const pinned = { platform, cpConfig: cp, lockScalePpm: BigInt(1_000_000), feePda: fee };
    const ll = LAUNCHLAB_PROGRAM_ID.mainnet;
    assert.equal(checkPlatformPins({ owner: ll, data: data(cp, PublicKey.default, [500_000, 400_000, 100_000]) }, pinned, "mainnet").ok, true);
    assert.equal(checkPlatformPins({ owner: ll, data: data(cp, fee, [1_000_000, 0, 0]) }, pinned, "mainnet").ok, true, "the fee PDA as platformCpCreator is allowed");
    const bad = (r: ReturnType<typeof checkPlatformPins>, re: RegExp) => { assert.equal(r.ok, false); assert.match(r.mismatches.join("\n"), re); };
    bad(checkPlatformPins({ owner: ll, data: data(cp, Keypair.generate().publicKey, [500_000, 400_000, 100_000]) }, pinned, "mainnet"), /platformCpCreator/);
    bad(checkPlatformPins({ owner: ll, data: data(cp, PublicKey.default, [500_000, 400_000, 0]) }, pinned, "mainnet"), /scales sum to 900000 ppm, pinned 1000000/);
    bad(checkPlatformPins({ owner: ll, data: data(Keypair.generate().publicKey, PublicKey.default, [500_000, 400_000, 100_000]) }, pinned, "mainnet"), /cpConfigId/);
    bad(checkPlatformPins({ owner: Keypair.generate().publicKey, data: data(cp, PublicKey.default, [500_000, 400_000, 100_000]) }, pinned, "mainnet"), /not LaunchLab/);
    bad(checkPlatformPins(null, pinned, "mainnet"), /does not exist/);
    bad(checkPlatformPins({ owner: ll, data: Buffer.alloc(100) }, pinned, "mainnet"), /bytes/);
    bad(checkPlatformPins(null, { ...pinned, platform: PublicKey.default }, "mainnet"), /no LaunchLab platform is pinned/);
  });
  test("R3-5: the admin CLI prints the RPC as scheme + host only", () => {
    assert.equal(redactRpcUrl("https://mainnet.helius-rpc.com/?api-key=SECRET"), "https://mainnet.helius-rpc.com");
    assert.equal(redactRpcUrl("https://user:pass@rpc.example.com:8443/v1/SECRETPATH?x=1#f"), "https://rpc.example.com:8443");
    assert.equal(redactRpcUrl("http://127.0.0.1:8899"), "http://127.0.0.1:8899");
    assert.equal(redactRpcUrl("not a url SECRET"), "<unparseable rpc url>");
    const cli = fs.readFileSync(path.join(import.meta.dirname, "..", "scripts", "burnreceipts-admin.mts"), "utf8");
    assert.doesNotMatch(cli, /[{,]\s*rpc\s*[,}]/, "the raw rpc variable is never put into printed JSON");
    assert.doesNotMatch(cli, /\$\{rpc\}/, "nor interpolated into a message");
  });
});
