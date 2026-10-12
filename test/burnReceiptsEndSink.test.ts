// LAUNCHPAD-PATH §45 — end sinks: the low-level client (src/lib/burnReceipts/endSink.ts) against the program's IDL.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey } from "@solana/web3.js";
import { BURN_RECEIPTS_IDL } from "../src/lib/burnReceipts/idl.ts";
import { accountDiscriminator, encodeType } from "../src/lib/burnReceipts/idlCoder.ts";
import { GENESIS_HASH } from "../src/lib/burnReceipts/constants.ts";
import { initializeTokenIx, operatorAttester } from "../src/lib/burnReceipts/instructions.ts";
import { configPda, feePda } from "../src/lib/burnReceipts/pda.ts";
import { ruleParamsFromKeeperRules } from "../src/lib/burnReceipts/math.ts";
import {
  attestRuleEnd, decodeEndSink, decodeRuleEnd, END_ATTESTATION_DOMAIN, END_FORWARD_MIN_LAMPORTS_CEIL, END_FORWARD_MIN_LAMPORTS_FLOOR, END_SINK_FLAGSHIP,
  END_SINK_LEAGUE_SET, END_SINK_MINT, END_SINK_PAIR_WINNER, END_STATE_LIVE, END_STATE_RESOLVED, END_STATE_VOID, endSinkPda, FLAGSHIP_MINT, forwardOnEndIx,
  parseEndForwardMemo, ruleEndMessage, ruleEndPda, SEED_END_SINK, SEED_RULE_END, submitRuleEndIx,
} from "../src/lib/burnReceipts/endSink.ts";

const PID = new PublicKey(BURN_RECEIPTS_IDL.address);
const order = (n: string) => BURN_RECEIPTS_IDL.instructions.find((i) => i.name === n)!.accounts.map((a) => a.name);

describe("burnReceipts end sinks (LAUNCHPAD-PATH §45)", () => {
  test("the constants come from the program's IDL; the flagship per cluster", () => {
    assert.deepEqual([END_STATE_LIVE, END_STATE_RESOLVED, END_STATE_VOID], [0, 1, 2]);
    assert.deepEqual([END_SINK_FLAGSHIP, END_SINK_MINT, END_SINK_LEAGUE_SET, END_SINK_PAIR_WINNER], [0, 1, 2, 3]);
    assert.deepEqual([END_FORWARD_MIN_LAMPORTS_FLOOR, END_FORWARD_MIN_LAMPORTS_CEIL], [BigInt(1_000_000), BigInt(10_000_000_000)]);
    assert.equal(END_ATTESTATION_DOMAIN, "BURNRECEIPTS-END-v1");
    assert.deepEqual([SEED_END_SINK.toString(), SEED_RULE_END.toString()], ["end_sink", "rule_end"]);
    assert.equal(FLAGSHIP_MINT.mainnet.toBase58(), "AJJ4XxCUYr8zzMWm8FYg3xh638LYAAApdNqWBqCK4oqj", "the owner's mainnet $DEFICIT");
    assert.equal(FLAGSHIP_MINT.devnet.toBase58(), "4QnwyiBMm2Caz5tJr9hNGzT2wqZcMipZjFHiSBu7AM4F");
    assert.equal(FLAGSHIP_MINT.localnet.toBase58(), Keypair.fromSeed(new Uint8Array(32).fill(0x46)).publicKey.toBase58());
    const m = Keypair.generate().publicKey;
    assert.ok(endSinkPda(PID, m).equals(PublicKey.findProgramAddressSync([SEED_END_SINK, m.toBuffer()], PID)[0]));
    assert.ok(ruleEndPda(PID, m).equals(PublicKey.findProgramAddressSync([SEED_RULE_END, m.toBuffer()], PID)[0]));
  });
  test("the end message is the program's text and the attestation verifies", () => {
    const mint = Keypair.generate().publicKey, k = Keypair.generate();
    const src = new Uint8Array(32).fill(0xab);
    const m = ruleEndMessage(GENESIS_HASH.mainnet, PID, mint, 20261012, END_STATE_RESOLVED, src).toString();
    assert.equal(m, `BURNRECEIPTS-END-v1|${GENESIS_HASH.mainnet}|${PID.toBase58()}|${mint.toBase58()}|2026-10-12|outcome=resolved|src=${"ab".repeat(32)}|proof=${"0".repeat(64)}`);
    assert.ok(ruleEndMessage(GENESIS_HASH.mainnet, PID, mint, 20261012, END_STATE_VOID, src).toString().includes("|outcome=void|"));
    assert.throws(() => ruleEndMessage(GENESIS_HASH.mainnet, PID, mint, 20261012, 3, src));
    assert.throws(() => ruleEndMessage(GENESIS_HASH.mainnet, PID, mint, 20261032, END_STATE_VOID, src));
    const { message, instruction } = attestRuleEnd({ genesisHash: GENESIS_HASH.devnet, programId: PID, mint, recordDate: 20261012, outcome: END_STATE_RESOLVED, sourceUrlHash: src, signers: [{ publicKey: k.publicKey, secretKey: k.secretKey }] });
    assert.ok(instruction.data.length > 0 && message.toString().startsWith("BURNRECEIPTS-END-v1|"));
    assert.ok(instruction.data.includes(k.publicKey.toBuffer()) && instruction.data.includes(message), "one Ed25519SigVerify over the message by the key");
  });
  test("the instructions follow the IDL account order", () => {
    const mint = Keypair.generate().publicKey, target = Keypair.generate().publicKey, sink = Keypair.generate().publicKey, c = Keypair.generate().publicKey;
    const s = submitRuleEndIx({ programId: PID, payer: c, mint, recordDate: 20261012, outcome: END_STATE_RESOLVED, sourceUrlHash: new Uint8Array(32).fill(1) });
    assert.equal(s.keys.length, order("submit_rule_end").length);
    assert.ok(s.keys[1].pubkey.equals(configPda(PID, mint)) && s.keys[2].pubkey.equals(endSinkPda(PID, mint)) && s.keys[3].pubkey.equals(ruleEndPda(PID, mint)));
    const f = forwardOnEndIx({ programId: PID, cranker: c, mint, target, sinkMint: sink, pair: { partner: sink, endDate: 20261012 } });
    assert.equal(f.keys.length, order("forward_on_end").length);
    const names = order("forward_on_end");
    assert.ok(f.keys[names.indexOf("target_config")].pubkey.equals(configPda(PID, target)));
    assert.ok(f.keys[names.indexOf("target_fee_vault")].pubkey.equals(feePda(PID, target)));
    assert.ok(f.keys[names.indexOf("sink_config")].pubkey.equals(configPda(PID, sink)));
    const plain = forwardOnEndIx({ programId: PID, cranker: c, mint, target });
    assert.ok(plain.keys[names.indexOf("sink_config")].pubkey.equals(PID), "omitted optional accounts are the program id");
  });
  test("initializeTokenIx pins an end sink: the account and the three trailing args", () => {
    const a = Keypair.generate(), sink = Keypair.generate().publicKey;
    const rule = ruleParamsFromKeeperRules(
      { mode: "buyback", decimals: 6, vaultAllocation: "0", buyback: { fractionPerUnit: "0.05", reserveSol: "0.02", slippageBps: 300 }, rule: { unitUsd: "1000000000", burnPerUnitTokens: "0", maxAbsDeltaUsd: "2000000000000", carry: "consecutive-increases", onNonIncrease: "burn-nothing-reset-carry" } },
      { floorLamports: BigInt(1), maxTwapDeviationBps: 1500, twapWindowSecs: 600 },
    );
    const args = { feed_id: "x", memo_prefix: "X", memo_source: "x", rules_sha256: new Uint8Array(32), rule, attesters: [operatorAttester(a.publicKey)], quorum: 1, fixed_pool: PublicKey.default, admin: a.publicKey };
    const plain = initializeTokenIx({ programId: PID, payer: a.publicKey, creator: a.publicKey, mint: a.publicKey, args, layout: "r4" });
    const pinned = initializeTokenIx({ programId: PID, payer: a.publicKey, creator: a.publicKey, mint: a.publicKey, args, endSink: { kind: END_SINK_MINT, sinkMint: sink, minForwardLamports: 50_000_000 } });
    const at = order("initialize_token").indexOf("end_sink");
    assert.ok(plain.keys[at].pubkey.equals(PID) && pinned.keys[at].pubkey.equals(endSinkPda(PID, a.publicKey)));
    const d = pinned.data;
    assert.equal(d.readBigUInt64LE(d.length - 8), BigInt(50_000_000));
    // end_sink_mint is an Option<Pubkey>: Some = 1 + 32 bytes; None (flagship, or a LaunchLab pair's partner) = 1 byte
    assert.ok(new PublicKey(d.subarray(d.length - 40, d.length - 8)).equals(sink));
    assert.equal(d[d.length - 41], 1);
    assert.equal(d[d.length - 42], END_SINK_MINT);
    assert.equal(plain.data.readBigUInt64LE(plain.data.length - 8), BigInt(0));
  });
  test("EndSink / RuleEnd round-trip through the IDL coder; the memo parses", () => {
    const mint = Keypair.generate().publicKey, sink = Keypair.generate().publicKey;
    const es = { version: 1, bump: 250, mint, sink_kind: END_SINK_PAIR_WINNER, sink_mint: sink, min_forward_lamports: BigInt(50_000_000), created_at: BigInt(9), reserved: new Uint8Array(32) };
    const e = decodeEndSink(Buffer.concat([accountDiscriminator(BURN_RECEIPTS_IDL, "EndSink"), encodeType(BURN_RECEIPTS_IDL, { defined: { name: "EndSink" } }, es)]));
    assert.ok(e.sink_mint.equals(sink) && e.sink_kind === END_SINK_PAIR_WINNER && e.min_forward_lamports === BigInt(50_000_000));
    const re = { version: 1, bump: 251, mint, record_date: 20261012, outcome: END_STATE_RESOLVED, signers_mask: 1, source_url_hash: new Uint8Array(32).fill(3), proof_hash: new Uint8Array(32), submitted_at: BigInt(5), forwarded_lamports: BigInt(7), forwards: 2, last_forward_at: BigInt(6), reserved: new Uint8Array(32) };
    const r = decodeRuleEnd(Buffer.concat([accountDiscriminator(BURN_RECEIPTS_IDL, "RuleEnd"), encodeType(BURN_RECEIPTS_IDL, { defined: { name: "RuleEnd" } }, re)]));
    assert.deepEqual([r.record_date, r.outcome, r.forwards, r.forwarded_lamports], [20261012, END_STATE_RESOLVED, 2, BigInt(7)]);
    assert.deepEqual(parseEndForwardMemo(`DEBT|endfwd|to=${sink.toBase58().slice(0, 12)}|lamports=42|v1`), { prefix: "DEBT", to12: sink.toBase58().slice(0, 12), lamports: BigInt(42) });
    assert.equal(parseEndForwardMemo("DEBT|forward|from=x|to=y|period=2026-10-12|lamports=1|v1"), null);
  });
});
