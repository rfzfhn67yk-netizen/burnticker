// THE INCINERATOR END SINK and NO SELF-BURN ON THE LOSING PATH (owner decisions 2026-10-13, program round 5; docs/burnticker/END-SINK.md):
// the rule field (onEnd.endSink "incinerator", single coins only, hashed), the pin it asks for (EndSink kind INCINERATOR, the r5 create),
// the end words on every surface ("sent to Solana's incinerator, which nothing can spend from"), the keeper's port (the fake mirrors
// burn_sol_on_end: WSOL unwrapped, the SOL above the reserve to the incinerator, nothing to any coin), the chain client's instruction
// (only the incinerator as destination), the memo, the preflight on a host without round 5, and the step-4 choice.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey } from "@solana/web3.js";
import { DEFAULT_ON_END, INCINERATOR_ADDRESS, endSinkOf, lockRule, onEndText, validateRule } from "@/lib/burnticker/rules";
import { INCINERATOR_END_RESULT, INCINERATOR_WORDS, describeEndSink, endText } from "@/lib/burnticker/describe";
import { endSinkPin, FakeBurnProgram } from "@/lib/burnticker/program";
import { endBurnLine, INCINERATOR_MIN_LAMPORTS } from "@/lib/burnticker/endSinkClient";
import { burnSolOnEndIx, END_SINK_INCINERATOR, endSinkKindCode, INCINERATOR, parseEndForwardMemo } from "@/lib/burnReceipts/endSink";
import { BURN_RECEIPTS_IDL } from "@/lib/burnReceipts/idl";
import { initializeTokenIx } from "@/lib/burnReceipts/instructions";
import { INCINERATOR_WAITING, ruleRefusals } from "@/lib/burnticker/launchPreflight";
import { endSentences, INCINERATOR_CHOICE_LABEL } from "@/lib/burnticker/guidedLaunch";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import { BRONCOS } from "./burntickerHelpers.ts";

const SOL = BigInt(1_000_000_000);
// a one-market rule (it ends once, so its end sentences are shown)
const INC_RULE = { ...BRONCOS, series: null, filter: {}, market: "KXNFLGAME-26OCT11DENNYJ-DEN", onEnd: { ...DEFAULT_ON_END, endSink: "incinerator" } };
const cfg = loadCopyLintConfig();
const plain = (t: string) => { assert.deepEqual(lintCopy(t, cfg).hits.map((h) => h.rule), [], t); assert.doesNotMatch(t, /\bbuy|\bprice\b|\bwill\b|\bpayouts?\b/i, t); };

describe("the address", () => {
  test("Solana's incinerator, the same in the rules, the client and the IDL (burn_sol_on_end's address-checked account); no key signs for it", () => {
    assert.equal(INCINERATOR_ADDRESS, "1nc1nerator11111111111111111111111111111111");
    assert.equal(INCINERATOR.toBase58(), INCINERATOR_ADDRESS);
    assert.equal(PublicKey.isOnCurve(INCINERATOR.toBytes()), false);
    assert.equal(END_SINK_INCINERATOR, 4);
    assert.equal(endSinkKindCode("incinerator"), 4);
  });
});

describe("the rule field", () => {
  test("onEnd.endSink \"incinerator\" is hashed into the rule; a pair or an outcome set cannot carry it", () => {
    const r = validateRule(INC_RULE);
    assert.equal(r.onEnd?.endSink, "incinerator");
    assert.equal(endSinkOf(r), "incinerator"); assert.equal(describeEndSink(r), "incinerator");
    assert.notEqual(lockRule(INC_RULE).sha256, lockRule({ ...BRONCOS, onEnd: { ...DEFAULT_ON_END } }).sha256);
    assert.throws(() => validateRule({ ...INC_RULE, pair: { pairId: "x-vs-y-z", side: "A", counterpartMint: null } }), /is for a single coin/);
    assert.throws(() => validateRule({ ...INC_RULE, onEnd: { ...DEFAULT_ON_END, endSink: "elsewhere" } }), /onEnd must be/);
  });
  test("the pin: EndSink kind INCINERATOR, under the r5 create (initialize_token_r5)", () => {
    const pin = endSinkPin(validateRule(INC_RULE), null)!;
    assert.equal(pin.kind, "incinerator");
    assert.equal(endSinkKindCode(pin.kind), END_SINK_INCINERATOR);
    assert.equal(pin.minForwardLamports, BigInt(DEFAULT_ON_END.sweepThresholdLamports));
    // the r5 create is its own instruction in the IDL (initialize_token's accounts and arguments; test/burnReceiptsClient.test.ts pins the bytes)
    const r5 = BURN_RECEIPTS_IDL.instructions.find((i) => i.name === "initialize_token_r5")!, r4 = BURN_RECEIPTS_IDL.instructions.find((i) => i.name === "initialize_token")!;
    assert.deepEqual(r5.accounts.map((a) => a.name), r4.accounts.map((a) => a.name));
    assert.equal(typeof initializeTokenIx, "function");
  });
});

describe("the words", () => {
  test("every surface says the SOL is sent to Solana's incinerator, which nothing can spend from; the void end keeps the wind-down", () => {
    const r = validateRule(INC_RULE);
    const e = endText(r);
    assert.equal(e.kind, "incinerator");
    assert.equal(e.result, INCINERATOR_END_RESULT);
    assert.match(e.result, /sent to Solana's incinerator, which nothing can spend from/);
    assert.match(e.void ?? "", /burns down on this coin/);
    assert.match(onEndText(r), /Solana's incinerator \(1nc1nerator11111111111111111111111111111111\), which nothing can spend from/);
    assert.match(endBurnLine("TEAM", BigInt(1_250_000_000)), /^\$TEAM's rule ended with a result, so 1\.25 SOL left in its burn pool was sent to Solana's incinerator, which nothing can spend from\.$/);
    const s = endSentences(r);
    assert.equal(s.kind, "incinerator");
    const opt = s.options.find((o) => o.kind === "incinerator")!;
    assert.equal(opt.label, INCINERATOR_CHOICE_LABEL); assert.equal(opt.available, true);
    for (const t of [e.result, e.void!, INCINERATOR_WORDS, INCINERATOR_CHOICE_LABEL, endBurnLine("TEAM", SOL), INCINERATOR_WAITING]) plain(t);
  });
});

describe("the keeper's port (the fake mirrors burn_sol_on_end)", () => {
  test("after a RESOLVED end: the WSOL is unwrapped, the SOL above the reserve goes to the incinerator, no coin receives anything, the memo is endburn", async () => {
    const program = new FakeBurnProgram("devnet");
    program.pinEndSinks = true;
    const flagship = Keypair.generate().publicKey.toBase58();
    program.endSink.flagship = flagship;
    const mint = Keypair.generate().publicKey.toBase58();
    await program.initializeToken({ mint, creator: mint, ticker: "TEAM", rulesSha256: "ab".repeat(32), selectorKey: "k", mode: "buyback", attesters: [mint], quorum: 1, vault: null, rule: validateRule(INC_RULE) });
    const port = program.endSink.port(mint);
    assert.deepEqual(await port.endSink(), { kind: "incinerator", sinkMint: INCINERATOR_ADDRESS, minForwardLamports: BigInt(DEFAULT_ON_END.sweepThresholdLamports) });
    const f = program.fake(mint);
    f.deposit(BigInt(2) * SOL); f.wsol = SOL / BigInt(2);
    f.cfg = { ...f.cfg, lastRecordDate: 20261012, crankCursor: 20261012 };
    port.rule = { recordDate: 20261012, outcome: "resolved", forwardedLamports: BigInt(0), forwards: 0, lastForwardAt: 0 };
    assert.deepEqual(await port.planForward(), { status: "ready", target: INCINERATOR_ADDRESS, intended: INCINERATOR_ADDRESS });
    const reserve = f.cfg.reserveLamports;
    const tx = await port.buildForward();
    await port.send(tx.raw);
    assert.equal((await port.confirm(tx)).status, "confirmed");
    assert.equal(port.incinerated, BigInt(2) * SOL + SOL / BigInt(2));
    assert.equal(f.feeLamports, reserve); assert.equal(f.wsol, BigInt(0));
    const facts = await port.forwardFacts(tx.signature);
    assert.equal(facts?.lamports, BigInt(2) * SOL + SOL / BigInt(2));
    assert.equal(parseEndForwardMemo(facts!.memo)?.burned, true);
    // a remainder under an empty account's rent-exempt minimum waits
    f.deposit(INCINERATOR_MIN_LAMPORTS - BigInt(1));
    const t2 = await port.buildForward(); await port.send(t2.raw);
    assert.deepEqual(await port.confirm(t2), { status: "failed", err: "NothingToForward" });
  });
  test("the chain instruction names only the incinerator as destination", () => {
    const pid = new PublicKey(BURN_RECEIPTS_IDL.address), k = Keypair.generate().publicKey;
    const ix = burnSolOnEndIx({ programId: pid, cranker: k, mint: k });
    const names = BURN_RECEIPTS_IDL.instructions.find((i) => i.name === "burn_sol_on_end")!.accounts.map((a) => a.name);
    assert.ok(ix.keys[names.indexOf("incinerator")].pubkey.equals(INCINERATOR));
    assert.equal(ix.keys[names.indexOf("incinerator")].isWritable, true);
  });
});

describe("the preflight", () => {
  test("a host whose program is not round 5 refuses the incinerator end, in plain words", () => {
    const locked = lockRule(INC_RULE);
    assert.ok(ruleRefusals(locked, { programRound5: false }).some((x) => x.code === "incinerator-not-live" && x.message === INCINERATOR_WAITING));
    assert.ok(!ruleRefusals(locked, { programRound5: true }).some((x) => x.code === "incinerator-not-live"));
  });
});
