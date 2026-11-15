import { burnTargetPda } from "../src/lib/burnReceipts/burnTarget.ts";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { BURN_RECEIPTS_IDL } from "../src/lib/burnReceipts/idl.ts";
import { accountDiscriminator, encodeType } from "../src/lib/burnReceipts/idlCoder.ts";
import { verifyAttestation } from "../src/lib/burnReceipts/attestation.ts";
import { GENESIS_HASH, NATIVE_MINT } from "../src/lib/burnReceipts/constants.ts";
import { crankBuybackIx, initializeTokenIx, operatorAttester } from "../src/lib/burnReceipts/instructions.ts";
import { configPda, feePda, associatedTokenAddress, readingPda } from "../src/lib/burnReceipts/pda.ts";
import { ruleParamsFromKeeperRules } from "../src/lib/burnReceipts/math.ts";
import {
  attestPairResult, decodePairLink, decodePairResult, forwardToWinnerIx, linkPairIx, OUTCOME_FORWARDED, PAIR_ATTESTATION_DOMAIN, PAIR_RESULT_DRAW, PAIR_RESULT_GRACE_SECS, PAIR_RESULT_LOST,
  PAIR_RESULT_NONE, PAIR_RESULT_WON, PAIR_STATE_NONE, PAIR_STATE_PAIRED, PAIR_STATE_PROVISIONAL, PAIR_WITNESS_INITIALIZE, PAIR_WITNESS_PAIR_CURVE, PAIRING_WINDOW_SECS, pairLinkPda, pairOrder,
  pairResultFor, pairResultMessage, pairResultPda, parseForwardMemo, SEED_PAIR_LINK, SEED_PAIR_RESULT, submitPairResultIx, unlinkPairIx,
  applyPairedAttesterChangeIx, attesterSetHash, pairAttesterChangeMessage, pairSetHash, PAIR_ATTESTER_CHANGE_DOMAIN, PAIR_STATE_UNLINKED,
  UNLINK_PAIR_VOIDED, UNLINK_SIDE_REFUNDING, UNLINK_VOID_BY_PASSED,
} from "../src/lib/burnReceipts/pairs.ts";

const PID = new PublicKey(BURN_RECEIPTS_IDL.address);
const order = (n: string) => BURN_RECEIPTS_IDL.instructions.find((i) => i.name === n)!.accounts.map((a) => a.name);

describe("burnReceipts pairs (LAUNCHPAD-PATH §40) — constants and addresses", () => {
  test("the constants come from the program's IDL", () => {
    assert.deepEqual([PAIR_STATE_NONE, PAIR_STATE_PROVISIONAL, PAIR_STATE_PAIRED, PAIR_STATE_UNLINKED], [0, 1, 2, 3]);
    // r3 RN-1/RN-2: terminal evidence only (r2's reason 2, "no verified pool 30 days after pairing", is gone from the program)
    assert.deepEqual([UNLINK_PAIR_VOIDED, UNLINK_SIDE_REFUNDING, UNLINK_VOID_BY_PASSED], [0, 1, 3]);
    assert.equal((BURN_RECEIPTS_IDL as { constants?: { name: string }[] }).constants?.some((c) => c.name === "UNLINK_NOT_LIVE" || c.name === "PAIR_UNLINK_NOT_LIVE_SECS"), false);
    assert.equal(PAIR_ATTESTER_CHANGE_DOMAIN, "BURNRECEIPTS-PAIR-ATTESTER-CHANGE-v1");
    assert.deepEqual([PAIR_WITNESS_INITIALIZE, PAIR_WITNESS_PAIR_CURVE], [0, 1]);
    assert.deepEqual([PAIR_RESULT_NONE, PAIR_RESULT_WON, PAIR_RESULT_LOST, PAIR_RESULT_DRAW], [0, 1, 2, 3]);
    assert.equal(PAIRING_WINDOW_SECS, 7 * 86_400);
    assert.equal(PAIR_RESULT_GRACE_SECS, 72 * 3_600);
    assert.equal(OUTCOME_FORWARDED, 6);
    assert.equal(PAIR_ATTESTATION_DOMAIN, "BURNRECEIPTS-PAIR-v1");
    assert.equal(SEED_PAIR_LINK.toString(), "pair_link");
    assert.equal(SEED_PAIR_RESULT.toString(), "pair_result");
  });
  test("PairResult addresses do not depend on the mints' order; PairLinks are per mint", () => {
    const a = Keypair.generate().publicKey, b = Keypair.generate().publicKey;
    assert.ok(pairResultPda(PID, a, b, 20261006).equals(pairResultPda(PID, b, a, 20261006)));
    assert.ok(!pairResultPda(PID, a, b, 20261006).equals(pairResultPda(PID, a, b, 20261007)));
    const [lo, hi] = pairOrder(a, b);
    assert.ok(Buffer.compare(lo.toBuffer(), hi.toBuffer()) < 0);
    const d = Buffer.alloc(4);
    d.writeUInt32LE(20261006);
    assert.ok(pairResultPda(PID, a, b, 20261006).equals(PublicKey.findProgramAddressSync([SEED_PAIR_RESULT, lo.toBuffer(), hi.toBuffer(), d], PID)[0]));
    assert.ok(pairLinkPda(PID, a).equals(PublicKey.findProgramAddressSync([SEED_PAIR_LINK, a.toBuffer()], PID)[0]));
  });
});

describe("burnReceipts pairs — accounts and the result view", () => {
  test("PairLink and PairResult round-trip through the IDL coder; the per-coin view", () => {
    const a = Keypair.generate().publicKey, b = Keypair.generate().publicKey;
    const [lo, hi] = pairOrder(a, b);
    const link = { version: 1, bump: 250, mint: a, pair_mint: b, paired: true, witness: 1, created_at: BigInt(1), pairing_deadline: BigInt(0), paired_at: BigInt(2), attester_set_hash: new Uint8Array(32).fill(9) };
    const l = decodePairLink(Buffer.concat([accountDiscriminator(BURN_RECEIPTS_IDL, "PairLink"), encodeType(BURN_RECEIPTS_IDL, { defined: { name: "PairLink" } }, link)]));
    assert.ok(l.pair_mint.equals(b) && l.paired && l.witness === PAIR_WITNESS_PAIR_CURVE && l.attester_set_hash[0] === 9);
    const res = {
      version: 1, bump: 251, mint_lo: lo, mint_hi: hi, record_date: 20261006, winner: hi, signers_mask_lo: 1, signers_mask_hi: 1,
      source_url_hash: new Uint8Array(32).fill(3), proof_hash: new Uint8Array(32), submitted_at: BigInt(5), forwarded: true, forwarded_lamports: BigInt(146_536_720), forwarded_at: BigInt(6), reserved: new Uint8Array(32),
    };
    const r = decodePairResult(Buffer.concat([accountDiscriminator(BURN_RECEIPTS_IDL, "PairResult"), encodeType(BURN_RECEIPTS_IDL, { defined: { name: "PairResult" } }, res)]));
    assert.equal(r.forwarded_lamports, BigInt(146_536_720));
    assert.deepEqual([pairResultFor(r, hi), pairResultFor(r, lo), pairResultFor(r, Keypair.generate().publicKey), pairResultFor(null, hi)], [PAIR_RESULT_WON, PAIR_RESULT_LOST, PAIR_RESULT_NONE, PAIR_RESULT_NONE]);
    assert.equal(pairResultFor({ ...r, winner: PublicKey.default }, lo), PAIR_RESULT_DRAW);
  });
});

describe("burnReceipts pairs — the signed message and the instructions", () => {
  const a = Keypair.generate(), b = Keypair.generate();
  const src = new Uint8Array(32).fill(0xab);
  test("the message is the program's canonical_pair_message, byte for byte; the Ed25519 packing verifies", () => {
    const [lo, hi] = pairOrder(a.publicKey, b.publicKey);
    const m = pairResultMessage(GENESIS_HASH.devnet, PID, b.publicKey, a.publicKey, 20261006, hi, src);
    assert.equal(m.toString(), `BURNRECEIPTS-PAIR-v1|${GENESIS_HASH.devnet}|${PID.toBase58()}|${lo.toBase58()}|${hi.toBase58()}|2026-10-06|winner=${hi.toBase58()}|src=${"ab".repeat(32)}|proof=${"00".repeat(32)}`);
    assert.match(pairResultMessage(GENESIS_HASH.devnet, PID, a.publicKey, b.publicKey, 20261006, null, src).toString(), /\|winner=draw\|/);
    assert.throws(() => pairResultMessage(GENESIS_HASH.devnet, PID, a.publicKey, b.publicKey, 20261006, Keypair.generate().publicKey, src));
    assert.throws(() => pairResultMessage(GENESIS_HASH.devnet, PID, a.publicKey, b.publicKey, 20261006, null, new Uint8Array(32)));
    const k1 = Keypair.generate(), k2 = Keypair.generate();
    const att = attestPairResult({ genesisHash: GENESIS_HASH.devnet, programId: PID, mintA: a.publicKey, mintB: b.publicKey, recordDate: 20261006, winner: a.publicKey, sourceUrlHash: src, signers: [k1, k2] });
    const d = att.instruction.data;
    assert.equal(d[0], 2);
    for (let i = 0; i < 2; i++) {
      const sigOff = d.readUInt16LE(2 + i * 14), pkOff = d.readUInt16LE(2 + i * 14 + 4), msgOff = d.readUInt16LE(2 + i * 14 + 8), msgLen = d.readUInt16LE(2 + i * 14 + 10);
      assert.ok(verifyAttestation(new PublicKey(d.subarray(pkOff, pkOff + 32)), d.subarray(msgOff, msgOff + msgLen), d.subarray(sigOff, sigOff + 64)));
    }
    // r2: a win needs only the loser's quorum — one signature + submit_pair_result (with both readings) fits a legacy transaction;
    // a draw (no readings) with two signatures fits too
    const payer = Keypair.generate();
    const one = attestPairResult({ genesisHash: GENESIS_HASH.devnet, programId: PID, mintA: a.publicKey, mintB: b.publicKey, recordDate: 20261006, winner: a.publicKey, sourceUrlHash: src, signers: [k1] });
    const ix = submitPairResultIx({ programId: PID, payer: payer.publicKey, mintA: a.publicKey, mintB: b.publicKey, recordDate: 20261006, winner: a.publicKey, sourceUrlHash: src });
    const tx = new VersionedTransaction(new TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: PublicKey.default.toBase58(), instructions: [one.instruction, ix] }).compileToLegacyMessage());
    assert.ok(tx.serialize().length <= 1232, `${tx.serialize().length} bytes`);
    const draw = attestPairResult({ genesisHash: GENESIS_HASH.devnet, programId: PID, mintA: a.publicKey, mintB: b.publicKey, recordDate: 20261006, winner: null, sourceUrlHash: src, signers: [k1, k2] });
    const dix = submitPairResultIx({ programId: PID, payer: payer.publicKey, mintA: a.publicKey, mintB: b.publicKey, recordDate: 20261006, winner: null, sourceUrlHash: src });
    const dtx = new VersionedTransaction(new TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: PublicKey.default.toBase58(), instructions: [draw.instruction, dix] }).compileToLegacyMessage());
    assert.ok(dtx.serialize().length <= 1232, `${dtx.serialize().length} bytes`);
  });
  test("submit_pair_result, link_pair and forward_to_winner follow the IDL account order", () => {
    const [lo, hi] = pairOrder(a.publicKey, b.publicKey);
    const payer = Keypair.generate().publicKey;
    const s = submitPairResultIx({ programId: PID, payer, mintA: hi, mintB: lo, recordDate: 20261006, winner: null, sourceUrlHash: src });
    const at = (ix: { keys: { pubkey: PublicKey }[] }, n: string, name: string) => ix.keys[order(n).indexOf(name)].pubkey;
    assert.equal(s.keys.length, order("submit_pair_result").length);
    assert.ok(at(s, "submit_pair_result", "config_lo").equals(configPda(PID, lo)) && at(s, "submit_pair_result", "link_hi").equals(pairLinkPda(PID, hi)));
    assert.ok(at(s, "submit_pair_result", "pair_result").equals(pairResultPda(PID, lo, hi, 20261006)));
    assert.equal(s.data.length, 8 + 4 + 32 + 32 + 32);
    assert.ok(new PublicKey(s.data.subarray(12, 44)).equals(PublicKey.default), "a draw is the default pubkey");
    assert.ok(at(s, "submit_pair_result", "reading_lo").equals(PID), "a draw omits the readings");
    const w = submitPairResultIx({ programId: PID, payer, mintA: hi, mintB: lo, recordDate: 20261006, winner: lo, sourceUrlHash: src });
    assert.ok(at(w, "submit_pair_result", "reading_lo").equals(readingPda(PID, configPda(PID, lo), 20261006)) && at(w, "submit_pair_result", "reading_hi").equals(readingPda(PID, configPda(PID, hi), 20261006)), "a win carries both readings");
    const pair = Keypair.generate().publicKey;
    const l = linkPairIx({ programId: PID, payer, pair, mintA: a.publicKey, mintB: b.publicKey });
    assert.ok(at(l, "link_pair", "link_b").equals(pairLinkPda(PID, b.publicKey)) && at(l, "link_pair", "pair").equals(pair));
    const f = forwardToWinnerIx({ programId: PID, cranker: payer, loserMint: b.publicKey, winnerMint: a.publicKey, recordDate: 20261006 });
    assert.equal(f.keys.length, order("forward_to_winner").length);
    assert.ok(at(f, "forward_to_winner", "loser_fee_vault").equals(feePda(PID, b.publicKey)));
    assert.ok(at(f, "forward_to_winner", "winner_fee_wsol").equals(associatedTokenAddress(feePda(PID, a.publicKey), NATIVE_MINT)));
    assert.ok(!order("forward_to_winner").includes("winner_reading"), "r2: forward_to_winner no longer reads the winner's reading");
    // round-5 review R5-9: both sides' BurnTarget accounts ride along (the program reads them for a target coin without its own pool)
    assert.ok(at(f, "forward_to_winner", "loser_burn_target").equals(burnTargetPda(PID, b.publicKey)) && at(f, "forward_to_winner", "winner_burn_target").equals(burnTargetPda(PID, a.publicKey)));
    const u = unlinkPairIx({ programId: PID, cranker: payer, mintA: a.publicKey, mintB: b.publicKey });
    assert.ok(at(u, "unlink_pair", "link_a").equals(pairLinkPda(PID, a.publicKey)) && at(u, "unlink_pair", "fee_b").equals(feePda(PID, b.publicKey)) && at(u, "unlink_pair", "pair").equals(PID));
    assert.ok(at(f, "forward_to_winner", "pair_result").equals(pairResultPda(PID, a.publicKey, b.publicKey, 20261006)));
  });
  test("crank_buyback and initialize_token carry the pair accounts only when asked", () => {
    const pool = { pool: Keypair.generate().publicKey, ammConfig: Keypair.generate().publicKey, cpmmAuthority: Keypair.generate().publicKey, wsolVault: Keypair.generate().publicKey, tokenVault: Keypair.generate().publicKey, observation: Keypair.generate().publicKey, wsolIsToken0: true };
    const plain = crankBuybackIx({ programId: PID, cranker: a.publicKey, mint: a.publicKey, recordDate: 20261006, pool, cluster: "devnet" });
    const paired = crankBuybackIx({ programId: PID, cranker: a.publicKey, mint: a.publicKey, recordDate: 20261006, pool, cluster: "devnet", partner: b.publicKey });
    const i = order("crank_buyback").indexOf("pair_result");
    assert.ok(plain.keys[i].pubkey.equals(PID) && plain.keys[i - 1].pubkey.equals(PID));
    assert.ok(paired.keys[i].pubkey.equals(pairResultPda(PID, a.publicKey, b.publicKey, 20261006)) && paired.keys[i - 1].pubkey.equals(pairLinkPda(PID, a.publicKey)));
    const rule = ruleParamsFromKeeperRules(
      { mode: "buyback", decimals: 6, vaultAllocation: "0", buyback: { fractionPerUnit: "0.05", reserveSol: "0.02", slippageBps: 300 }, rule: { unitUsd: "1000000000", burnPerUnitTokens: "100000", maxAbsDeltaUsd: "2000000000000", carry: "consecutive-increases", onNonIncrease: "burn-nothing-reset-carry" } },
      { floorLamports: BigInt(1), maxTwapDeviationBps: 300, twapWindowSecs: 1200 },
    );
    const args = { feed_id: "f", memo_prefix: "AB", memo_source: "s", rules_sha256: new Uint8Array(32), rule, attesters: [operatorAttester(a.publicKey)], quorum: 1, fixed_pool: PublicKey.default, admin: a.publicKey };
    const second = initializeTokenIx({ programId: PID, payer: a.publicKey, creator: a.publicKey, mint: b.publicKey, args, pairMint: a.publicKey, partnerFirst: true });
    const o = order("initialize_token");
    assert.ok(second.keys[o.indexOf("pair_mint")].pubkey.equals(a.publicKey));
    assert.ok(second.keys[o.indexOf("pair_link")].pubkey.equals(pairLinkPda(PID, b.publicKey)) && second.keys[o.indexOf("pair_link")].isWritable);
    assert.ok(second.keys[o.indexOf("partner_link")].pubkey.equals(pairLinkPda(PID, a.publicKey)));
    assert.ok(second.keys[o.indexOf("partner_config")].pubkey.equals(configPda(PID, a.publicKey)));
    const first = initializeTokenIx({ programId: PID, payer: a.publicKey, creator: a.publicKey, mint: a.publicKey, args, pairMint: b.publicKey });
    assert.ok(first.keys[o.indexOf("partner_link")].pubkey.equals(pairLinkPda(PID, b.publicKey)), "r2 L-3: the partner's PairLink address always rides along");
    assert.ok(first.keys[o.indexOf("partner_config")].pubkey.equals(PID), "the partner's config only when it was first");
  });
  test("the forward memo parses", () => {
    const m = `DEBT|forward|from=${a.publicKey.toBase58().slice(0, 12)}|to=${b.publicKey.toBase58().slice(0, 12)}|period=2026-10-06|lamports=146536720|v1`;
    assert.deepEqual(parseForwardMemo(m), { prefix: "DEBT", from12: a.publicKey.toBase58().slice(0, 12), to12: b.publicKey.toBase58().slice(0, 12), period: "2026-10-06", lamports: BigInt(146536720) });
    assert.equal(parseForwardMemo("DEBT|lockfees|wsol=1"), null);
  });
});

describe("burnReceipts pairs — round 3 (one attester set, voidBy, paired attester changes)", () => {
  test("pairSetHash: domain ‖ quorum ‖ (kind ‖ key)…, order- and quorum-sensitive; attesterSetHash reads the active slots", () => {
    const k1 = Keypair.generate().publicKey, k2 = Keypair.generate().publicKey;
    const h = pairSetHash(1, [operatorAttester(k1), operatorAttester(k2)]);
    assert.equal(h.length, 32);
    assert.ok(!h.equals(pairSetHash(2, [operatorAttester(k1), operatorAttester(k2)])));
    assert.ok(!h.equals(pairSetHash(1, [operatorAttester(k2), operatorAttester(k1)])));
    const cfg = { quorum: 1, attester_count: 2, attesters: [operatorAttester(k1), operatorAttester(k2), operatorAttester(PublicKey.default)] };
    assert.ok(attesterSetHash(cfg).equals(h));
  });
  test("pairAttesterChangeMessage is the program's text; applyPairedAttesterChangeIx follows the IDL account order", () => {
    const mint = Keypair.generate().publicKey, partner = Keypair.generate().publicKey, caller = Keypair.generate().publicKey;
    const set = new Uint8Array(32).fill(0xab);
    const m = pairAttesterChangeMessage(GENESIS_HASH.mainnet, PID, mint, partner, set, BigInt(1791720000)).toString();
    assert.equal(m, `BURNRECEIPTS-PAIR-ATTESTER-CHANGE-v1|${GENESIS_HASH.mainnet}|${PID.toBase58()}|${mint.toBase58()}|${partner.toBase58()}|set=${"ab".repeat(32)}|eta=1791720000`);
    const ix = applyPairedAttesterChangeIx({ programId: PID, caller, mint, partnerMint: partner });
    assert.equal(ix.keys.length, order("apply_paired_attester_change").length);
    assert.ok(ix.keys[1].pubkey.equals(configPda(PID, mint)) && ix.keys[2].pubkey.equals(pairLinkPda(PID, mint)) && ix.keys[3].pubkey.equals(configPda(PID, partner)));
  });
  test("initializeTokenIx carries pair_void_by (pairVoidBy; 0 by default)", () => {
    const a = Keypair.generate(), b = Keypair.generate();
    const rule = ruleParamsFromKeeperRules(
      { mode: "buyback", decimals: 6, vaultAllocation: "0", buyback: { fractionPerUnit: "0.05", reserveSol: "0.02", slippageBps: 300 }, rule: { unitUsd: "1000000000", burnPerUnitTokens: "0", maxAbsDeltaUsd: "2000000000000", carry: "consecutive-increases", onNonIncrease: "burn-nothing-reset-carry" } },
      { floorLamports: BigInt(1), maxTwapDeviationBps: 1500, twapWindowSecs: 600 },
    );
    const args = { feed_id: "x", memo_prefix: "X", memo_source: "x", rules_sha256: new Uint8Array(32), rule, attesters: [operatorAttester(a.publicKey)], quorum: 1, fixed_pool: PublicKey.default, admin: a.publicKey };
    const plain = initializeTokenIx({ programId: PID, payer: a.publicKey, creator: a.publicKey, mint: a.publicKey, args });
    const paired = initializeTokenIx({ programId: PID, payer: a.publicKey, creator: a.publicKey, mint: a.publicKey, args, pairMint: b.publicKey, pairVoidBy: 20261120 });
    assert.equal(paired.data.length, plain.data.length);
    // the default layout is round 3 (the deployed programs): pair_void_by is the last field
    assert.equal(plain.data.readUInt32LE(plain.data.length - 4), 0);
    assert.equal(paired.data.readUInt32LE(paired.data.length - 4), 20261120);
    // round 4: pair_void_by sits before the three end-sink args (u8 kind, Option<Pubkey> mint — 1 byte when none —, u64 minimum: 10 bytes)
    const paired4 = initializeTokenIx({ programId: PID, payer: a.publicKey, creator: a.publicKey, mint: a.publicKey, args, pairMint: b.publicKey, pairVoidBy: 20261120, layout: "r4" });
    assert.equal(paired4.data.length, paired.data.length + 10); assert.equal(paired4.keys.length, paired.keys.length + 1);
    assert.equal(paired4.data.readUInt32LE(paired4.data.length - 14), 20261120);
  });
});
