// The pair-curve launch path (2026-10-10): BURNTICKER_PAIR_CURVE_ENABLED (default OFF) turns a rivalry pair's two LaunchLab bundles into
// one pair_curve bundle — two mint+TokenConfig transactions (registration policy 2) and init_pair — plus the badge the wizard shows.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey } from "@solana/web3.js";
import { FakeBurnProgram } from "@/lib/burnticker/program";
import { buildPairBundles, FakeLaunchLab } from "@/lib/burnticker/launchBundle";
import { buildPairCurveLaunch, pairCurveEnabled, PAIR_CURVE_BADGE, toPairCurvePolicy } from "@/lib/burnticker/pairCurveLaunch";
import { BURN_RECEIPTS_IDL } from "@/lib/burnReceipts/idl";
import { decodeType } from "@/lib/burnReceipts/idlCoder";
import { initializeTokenIx, operatorAttester } from "@/lib/burnReceipts/instructions";
import { PAIR_CURVE_IDL } from "@/lib/pairCurve/idl";
import { pairPda, vaultPda } from "@/lib/pairCurve/accounts";
import { BRONCOS } from "./burntickerHelpers.ts";

const CREATOR = "CreatorWa11et111111111111111111111111111111", ATTESTER = "KeeperDataKey1111111111111111111111111111111";
const BRONCOS_LOSE = { ...BRONCOS, binary: { onYes: null, onNo: { fractionOfPool: 0.02 } }, pair: null };

async function pairBundles() {
  const program = new FakeBurnProgram("devnet");
  const inputA = { creator: CREATOR, ticker: "BRONCOS", name: "Broncos", description: "burns when Denver loses", imageUrl: null, links: [], rule: BRONCOS_LOSE, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true }, cluster: "devnet" as const };
  const pr = await buildPairBundles({ a: inputA, b: { ticker: "CHIEFS", name: "Chiefs", description: "burns when Denver wins", imageUrl: null, links: [] } }, { program, launchLab: new FakeLaunchLab(), devFeeWallet: null, attesters: [ATTESTER], quorum: 1, metadataUri: (m) => `https://x/${m}.json` });
  return { pr, program };
}

describe("pair curve launch path", () => {
  test("the flag is off unless set", () => {
    assert.equal(pairCurveEnabled({}), false);
    assert.equal(pairCurveEnabled({ BURNTICKER_PAIR_CURVE_ENABLED: "0" }), false);
    assert.equal(pairCurveEnabled({ BURNTICKER_PAIR_CURVE_ENABLED: "1" }), true);
    assert.equal(PAIR_CURVE_BADGE.label, "Pair curve");
  });

  test("bundle: the pair's PDAs, three transactions (mint A + config, mint B + config, init_pair), signers, defaults and the both-or-neither note", async () => {
    const { pr, program } = await pairBundles();
    const now = 1_800_000_000;
    const b = await buildPairCurveLaunch(pr, CREATOR, { cluster: "devnet", burnReceiptsProgramId: program.programId, now });
    const pair = pairPda(new PublicKey(pr.a.mint), new PublicKey(pr.b.mint));
    assert.equal(b.pair, pair.toBase58());
    assert.equal(b.vault, vaultPda(pair).toBase58());
    assert.deepEqual(b.transactions.map((t) => t.signers), [["creator", "mintA"], ["creator", "mintB"], ["creator"]]);
    const initMint = b.transactions[0].instructions[1];
    assert.equal(Buffer.from(initMint.dataBase64, "base64").subarray(2, 34).toString("hex"), vaultPda(pair).toBuffer().toString("hex"), "mint authority = the pair's SOL vault");
    const initPair = b.transactions[2].instructions[0];
    assert.equal(initPair.programId, PAIR_CURVE_IDL.address);
    // re-check P3-1: link_pair rides in the same transaction, right after init_pair (no pair is left unlinked by a keeper outage)
    const link = b.transactions[2].instructions[1];
    assert.equal(b.transactions[2].instructions.length, 2);
    assert.equal(link.programId, program.programId); assert.match(link.label, /^burn_receipts\.link_pair/);
    assert.ok(link.keys.some((k) => k.pubkey === pair.toBase58()), "the Pair is the witness");
    assert.equal(b.params.targetRaiseLamports, "85000000000");
    assert.equal(b.params.deadline, now + 30 * 86_400);
    assert.match(b.notes[0], /both or neither/);
    // the fake program's initialize_token is a placeholder: the bundle says so
    assert.equal(b.ready, false);
    assert.ok(b.pending.some((x) => /placeholder/.test(x)));
    await assert.rejects(buildPairCurveLaunch(pr, CREATOR, { cluster: "devnet", burnReceiptsProgramId: program.programId, now, params: { minSideShareBps: 100 } }), /share/);
  });

  test("toPairCurvePolicy re-encodes a real initialize_token with policy 2 and the pinned platform; refuses a placeholder", () => {
    const programId = new PublicKey("AuQjoSgq7upmyPBv2itwy2TSZ1VjoVipyy4z9wd7zhMM");
    const mint = Keypair.generate().publicKey, creator = Keypair.generate().publicKey, platform = Keypair.generate().publicKey;
    const rule = { mode: 0, carry_rule: 1, pool_policy: 0, value_decimals: 0, unit_value: BigInt(1), max_abs_delta: BigInt(1000), fraction_per_unit_bps: 200, slippage_bps: 300, max_twap_deviation_bps: 300, twap_window_secs: 600, floor_lamports: BigInt(1_000_000), reserve_lamports: BigInt(20_000_000), tokens_per_unit: BigInt(0), vault_allocation: BigInt(0) };
    const initArgs = { feed_id: "burnticker.counter", memo_prefix: "BT", memo_source: "burnticker counter", rules_sha256: new Uint8Array(32).fill(3), rule, attesters: [operatorAttester(creator)], quorum: 1, fixed_pool: PublicKey.default, admin: creator };
    const ix = initializeTokenIx({ programId, payer: creator, creator, mint, args: initArgs, layout: "r4" });
    // §45: a round-3 create (the default layout) comes back round 3 — one account fewer and the end-sink args cut — same policy rewrite
    const ix3 = initializeTokenIx({ programId, payer: creator, creator, mint, args: initArgs });
    const out3 = toPairCurvePolicy({ programId: programId.toBase58(), label: "x", keys: ix3.keys.map((k) => ({ pubkey: k.pubkey.toBase58(), isSigner: k.isSigner, isWritable: k.isWritable })), dataBase64: Buffer.from(ix3.data).toString("base64") }, programId.toBase58(), platform.toBase58())!;
    assert.equal(out3.keys.length, ix3.keys.length);
    const ser = { programId: programId.toBase58(), label: "burn_receipts.initialize_token", keys: ix.keys.map((k) => ({ pubkey: k.pubkey.toBase58(), isSigner: k.isSigner, isWritable: k.isWritable })), dataBase64: Buffer.from(ix.data).toString("base64") };
    const out = toPairCurvePolicy(ser, programId.toBase58(), platform.toBase58())!;
    const def = BURN_RECEIPTS_IDL.instructions.find((i) => i.name === "initialize_token")!;
    const args = decodeType(BURN_RECEIPTS_IDL, def.args[0].type, Buffer.from(out.dataBase64, "base64"), 8).value as { rule: { pool_policy: number; fraction_per_unit_bps: number }; feed_id: string };
    assert.equal(args.rule.pool_policy, 2);
    assert.equal(args.rule.fraction_per_unit_bps, 200, "nothing else changed");
    assert.equal(args.feed_id, "burnticker.counter");
    assert.equal(out.keys[def.accounts.findIndex((a) => a.name === "launchlab_platform")].pubkey, platform.toBase58());
    assert.deepEqual(Buffer.from(out3.dataBase64, "base64"), Buffer.from(out.dataBase64, "base64").subarray(0, Buffer.from(out.dataBase64, "base64").length - 10));
    assert.deepEqual(out3.keys, out.keys.filter((_, i) => i !== def.accounts.findIndex((a) => a.name === "end_sink")));
    assert.equal(toPairCurvePolicy({ ...ser, dataBase64: Buffer.from("{}").toString("base64") }, programId.toBase58(), platform.toBase58()), null);
  });

  test("a LaunchLab pair bundle's pair_mint accounts are dropped for the pair curve (policy 2 pairs through link_pair; the program refuses InvalidPairMint)", () => {
    const programId = new PublicKey("AuQjoSgq7upmyPBv2itwy2TSZ1VjoVipyy4z9wd7zhMM");
    const mint = Keypair.generate().publicKey, partner = Keypair.generate().publicKey, creator = Keypair.generate().publicKey, platform = Keypair.generate().publicKey;
    const rule = { mode: 0, carry_rule: 1, pool_policy: 0, value_decimals: 0, unit_value: BigInt(1), max_abs_delta: BigInt(1000), fraction_per_unit_bps: 200, slippage_bps: 300, max_twap_deviation_bps: 300, twap_window_secs: 600, floor_lamports: BigInt(1_000_000), reserve_lamports: BigInt(20_000_000), tokens_per_unit: BigInt(0), vault_allocation: BigInt(0) };
    const args = { feed_id: "burnticker.counter", memo_prefix: "BT", memo_source: "burnticker counter", rules_sha256: new Uint8Array(32).fill(3), rule, attesters: [operatorAttester(creator)], quorum: 1, fixed_pool: PublicKey.default, admin: creator };
    const ix = initializeTokenIx({ programId, payer: creator, creator, mint, args: args as never, pairMint: partner, partnerFirst: true });
    const def = BURN_RECEIPTS_IDL.instructions.find((i) => i.name === "initialize_token")!;
    const at = (name: string) => def.accounts.findIndex((a) => a.name === name);
    assert.equal(ix.keys[at("pair_mint")].pubkey.toBase58(), partner.toBase58(), "the LaunchLab bundle names the partner");
    const ser = { programId: programId.toBase58(), label: "burn_receipts.initialize_token", keys: ix.keys.map((k) => ({ pubkey: k.pubkey.toBase58(), isSigner: k.isSigner, isWritable: k.isWritable })), dataBase64: Buffer.from(ix.data).toString("base64") };
    const out = toPairCurvePolicy(ser, programId.toBase58(), platform.toBase58())!;
    for (const n of ["pair_mint", "pair_link", "partner_link", "partner_config"]) assert.deepEqual(out.keys[at(n)], { pubkey: programId.toBase58(), isSigner: false, isWritable: false }, n);
  });
});
