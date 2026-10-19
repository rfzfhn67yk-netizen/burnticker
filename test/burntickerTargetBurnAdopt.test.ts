// AUDIT 7 · F05 (2026-10-19): the keeper's chain search for an already executed processing transaction knew CrankBuyback / CrankVault /
// CrankNoUnits / ForwardToWinner but not CrankTargetBurn, so a target burn cranked by someone else, or one whose write-ahead signature
// was lost, was never adopted and the keeper kept waiting. The search now uses one list (burnReceipts/processing.ts) bound to the
// program, the reading's date and its Reading account. These tests run the REAL discovery (findProcessingTx over parsed transactions
// built from the fake chain) through the full keeper and ledger path, then the independent audit.
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Keypair, type ParsedTransactionWithMeta, PublicKey } from "@solana/web3.js";
import { openRegistry, type Registry } from "@/lib/burnticker/registry";
import { FakeBurnProgram } from "@/lib/burnticker/program";
import { buildLaunchBundle, FakeLaunchLab } from "@/lib/burnticker/launchBundle";
import { KalshiClient, fixtureFetch, settledMarketsUrl, seriesApiUrl, openMarketsUrl } from "@/lib/burnticker/oracle/kalshi";
import { CatalogueAdapter, feedById, loadFixture } from "@/lib/burnticker/catalogue";
import { executePending, runCycle, type KeeperDeps } from "@/lib/burnticker/multiKeeper";
import { auditRegistry } from "@/lib/burnticker/audit";
import { fakeInstructionName, type FakeProgram } from "@/lib/burnKeeper/fakeProgram";
import { BURN_RECEIPTS_IDL } from "@/lib/burnReceipts/idl";
import { encodeInstruction } from "@/lib/burnReceipts/idlCoder";
import { bs58 } from "@/lib/burnReceipts/accounts";
import { memoFromTransaction } from "@/lib/burnReceipts/crank";
import { MEMO_PROGRAM_ID } from "@/lib/burnReceipts/constants";
import { readingPda } from "@/lib/burnReceipts/pda";
import { findProcessingTx, isProcessingLog, PROCESSING_INSTRUCTIONS, PROCESSING_LOG_NAMES, type ProcessingRpc } from "@/lib/burnReceipts/processing";
import { formatDate } from "@/lib/burnReceipts/math";
import { BRONCOS, NOW, fx, treasuryAndCrossFetch } from "./burntickerHelpers.ts";

const CREATOR = "CreatorWa11et111111111111111111111111111111";
const ATTESTER = "KeeperDataKey1111111111111111111111111111111";
const YES = "KXNFLGAME-26SEP27LARDEN-DEN";
const D = 20260928;
const BONK = { mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", pool: "HVNwzt7Pxfu76KHCMQPTLuTCLTm6WnQ1esLv4eizseSv", symbol: "BONK", feedId: "72b021217ca3fe68922a19aaf990109cb9d84e9ad004b4d2025ad6f529314419" };
const TARGET_RULE = { ...BRONCOS, burnTarget: BONK };
const table = { [settledMarketsUrl("KXNFLGAME")]: fx("kalshi/KXNFLGAME.settled.json"), [seriesApiUrl("KXNFLGAME")]: fx("kalshi/series.KXNFLGAME.json"), [openMarketsUrl("KXNFLGAME")]: { cursor: "", markets: [] } };
const treasuryBody = loadFixture(feedById("treasury.debt")!).body;

let reg: Registry, program: FakeBurnProgram, clock: number;
const mkDeps = (lines: string[] = []): KeeperDeps => ({ registry: reg, program, oracles: { kalshi: new KalshiClient({ fetchImpl: fixtureFetch(table), now: () => clock, minIntervalMs: 0 }), catalogue: new CatalogueAdapter({ fetchImpl: treasuryAndCrossFetch(treasuryBody), now: () => clock }) }, attester: ATTESTER, log: (s) => lines.push(s), now: () => clock, dryRun: false });
beforeEach(() => { reg = openRegistry(":memory:"); program = new FakeBurnProgram("devnet"); clock = NOW; program.now = () => clock; });

async function launchTargetCoin() {
  const b = await buildLaunchBundle({ creator: CREATOR, ticker: "TEAMBONK", name: "Team Bonk", description: "a test", imageUrl: null, links: [], rule: TARGET_RULE, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true }, cluster: "devnet" }, { program, launchLab: new FakeLaunchLab(), devFeeWallet: null, attesters: [ATTESTER], quorum: 1, metadataUri: (m) => `https://x/${m}.json` });
  const t = reg.register({ mint: b.mint, ticker: "TEAMBONK", name: b.name, creator: CREATOR, description: b.description, imageUrl: null, links: [], rulesText: b.rules.text, feePda: b.addresses.feePda, vault: b.addresses.vault, tokenConfig: b.addresses.tokenConfig, poolId: b.addresses.poolId, launchTx: null, cluster: "devnet", platformId: b.addresses.platformId, baselineAt: "2026-09-01T00:00:00Z", status: "draft" }, clock);
  reg.markLaunched(t.mint, "launchTEAMBONK", b.addresses.poolId, "2026-09-01T00:00:00Z");
  reg.addAttester({ mint: t.mint, pubkey: ATTESTER, role: "data-key", addedAt: clock, timelockUntil: null });
  program.supplies.set(t.mint, BigInt("1000000000000000"));
  program.deposit(t.mint, BigInt(5_000_000_000));
  const f = program.fake(t.mint);
  // round 5: the coin burns a pinned target (its cranks are crank_target_burn)
  f.burnTarget = { mint: BONK.mint, pool: BONK.pool, decimals: 5 }; f.cfg = { ...f.cfg, burnsTarget: true };
  return { t: reg.token(t.mint)!, f };
}

/** A parsed transaction (getParsedTransaction's shape) carrying one burn-program instruction and, inside it, the program's Memo CPI. */
function parsedTx(o: { programId: PublicKey; name: string; recordDate: number; reading: PublicKey; memo: string | null; extraAccount?: PublicKey }): ParsedTransactionWithMeta {
  const ix = BURN_RECEIPTS_IDL.instructions.find((i) => i.name === o.name)!;
  const spec = PROCESSING_INSTRUCTIONS.find((p) => p.name === o.name);
  const at = ix.accounts.findIndex((a) => a.name === (spec?.readingAccount ?? "reading"));
  const accounts = ix.accounts.map((_, k) => (k === at ? o.reading : Keypair.generate().publicKey));
  if (o.extraAccount) accounts[0] = o.extraAccount;
  const logName = spec?.logName ?? o.name;
  return {
    slot: 1, blockTime: 1,
    meta: { err: null, fee: 5000, preBalances: [], postBalances: [], logMessages: [`Program ${o.programId.toBase58()} invoke [1]`, `Program log: Instruction: ${logName}`], innerInstructions: o.memo === null ? [] : [{ index: 0, instructions: [{ programId: MEMO_PROGRAM_ID, program: "spl-memo", parsed: o.memo, stackHeight: 2 }] }] },
    transaction: { signatures: [], message: { accountKeys: [], recentBlockhash: "h", instructions: [{ programId: o.programId, accounts, data: bs58(encodeInstruction(BURN_RECEIPTS_IDL, o.name, { record_date: o.recordDate })), stackHeight: null }] } },
  } as unknown as ParsedTransactionWithMeta;
}

/**
 * The chain as the real RPC shows it, derived from the fake program: every landed crank / forward is a parsed transaction under the
 * Reading account it processed (newest first); `decoys` sit on top of a reading's list; `hidden` signatures are not served.
 */
function chainTape(f: FakeProgram) {
  const programId = new PublicKey(f.programId), config = new PublicKey(f.configAddress);
  const decoys = new Map<string, { address: string; tx: ParsedTransactionWithMeta }>();
  const hidden = new Set<string>();
  const fromLanded = (sig: string): ParsedTransactionWithMeta | null => {
    const l = f.landed.get(sig);
    if (!l || l.err || (l.payload.kind !== "crank" && l.payload.kind !== "forward")) return null;
    return parsedTx({ programId, name: fakeInstructionName(l.payload)!, recordDate: l.payload.recordDate, reading: readingPda(programId, config, l.payload.recordDate), memo: l.memo });
  };
  const rpc: ProcessingRpc = {
    async getSignaturesForAddress(address) {
      const a = address.toBase58();
      const own = [...f.landed.entries()].filter(([s, l]) => !hidden.has(s) && (l.payload.kind === "crank" || l.payload.kind === "forward") && readingPda(programId, config, l.payload.recordDate).toBase58() === a).map(([s, l]) => ({ signature: s, slot: l.slot, err: l.err ? { custom: 1 } : null })).reverse();
      const top = [...decoys.entries()].filter(([, d]) => d.address === a).map(([s]) => ({ signature: s, slot: 9, err: null })).reverse();
      return [...top, ...own];
    },
    async getParsedTransaction(sig) { return hidden.has(sig) ? null : decoys.get(sig)?.tx ?? fromLanded(sig); },
  };
  // the fake port's discovery replaced by the real one over this tape
  f.findCrankTx = (recordDate: number) => findProcessingTx(rpc, { programId, config, recordDate });
  f.memoOf = async (sig: string, recordDate?: number) => memoFromTransaction(await rpc.getParsedTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 1 }), programId, recordDate);
  return { rpc, decoys, hidden, programId, config };
}

/** The keeper's own crank attempts this run (stranger cranks are not the keeper's). */
const keeperCranks = (f: FakeProgram) => f.sent.filter((s) => s.startsWith("fakecrank"));

describe("F05 · the shared processing list", () => {
  test("crank_target_burn is a processing instruction; crank_carried is not (it processes no reading)", () => {
    assert.ok(PROCESSING_LOG_NAMES.includes("CrankTargetBurn"));
    assert.ok(isProcessingLog("Program log: Instruction: CrankTargetBurn"));
    assert.ok(!isProcessingLog("Program log: Instruction: CrankCarried"));
    assert.ok(!isProcessingLog("Program log: Instruction: SubmitReading"));
    assert.deepEqual(PROCESSING_INSTRUCTIONS.map((p) => p.name), ["crank_buyback", "crank_vault", "crank_no_units", "crank_target_burn", "forward_to_winner"]);
  });
});

describe("F05 · a target burn processed on chain is adopted through the keeper", () => {
  test("cranked by someone else: adopted once, the receipt persisted once, a restart adds nothing, the audit agrees", async () => {
    const { t, f } = await launchTargetCoin();
    const tape = chainTape(f);
    f.targetPool = "unhealthy";              // the keeper's own crank is held: the reading is attested, not processed
    await runCycle(mkDeps());
    assert.equal(f.readings.get(D)?.processed, false, "attested, waiting");
    f.targetPool = "ok";
    const sig = f.strangerCrank()!;
    assert.ok(sig && f.landed.get(sig)!.memo, "the stranger's crank_target_burn landed with the program's memo");
    const found = await findProcessingTx(tape.rpc, { programId: tape.programId, config: tape.config, recordDate: D });
    assert.equal(found?.instruction, "crank_target_burn");

    const out = await executePending(mkDeps(), t, reg.lockedRule(t));
    const yes = out.find((o) => o.eventId === YES)!;
    assert.equal(yes.outcome, "confirmed"); if (yes.outcome === "confirmed") assert.equal(yes.adopted, true);
    const rec = reg.receipt(t.mint, YES)!;
    assert.equal(rec.signature, sig); assert.equal(rec.status, "confirmed"); assert.equal(rec.memo, f.landed.get(sig)!.memo);
    assert.equal(reg.receipts(t.mint).filter((r) => r.signature === sig).length, 1, "one receipt row carries the crank");
    assert.equal(keeperCranks(f).length, 0, "the keeper sent no crank of its own");

    // a keeper restart (fresh deps on the same ledger): nothing re-adopted, nothing re-sent, the row unchanged
    const again = await runCycle(mkDeps());
    assert.equal(again.executed.filter((e) => e.eventId === YES).length, 0);
    assert.equal(keeperCranks(f).length, 0);
    assert.deepEqual(reg.receipt(t.mint, YES), rec);

    const audit = await auditRegistry(reg, { program, now: clock });
    assert.deepEqual(audit.mismatches, []);
    assert.equal(audit.ok, true); assert.ok((audit.chainVerified ?? 0) >= 1, "the receipt's memo matches the chain");
  });

  test("the keeper's own target burn whose write-ahead signature was lost is reconstructed from the chain", async () => {
    const { t, f } = await launchTargetCoin();
    chainTape(f);
    const realConfirm = f.confirm.bind(f), realStatuses = f.signatureStatuses.bind(f);
    let lost: string | null = null;
    // the crank lands, the keeper dies before recording it, and its write-ahead signature is lost to it: a non-archival RPC answers null
    // for that signature past its blockhash, so the ledger marks it expired and only the chain search can name the processing transaction
    f.signatureStatuses = async (sigs) => (await realStatuses(sigs)).map((x, k) => (sigs[k] === lost ? null : x));
    f.confirm = async (tx) => { if (!lost && f.payloads.get(tx.signature)?.kind === "crank") { lost = tx.signature; f.height += 1_000; throw new Error("process killed"); } return realConfirm(tx); };
    const executed = [...(await runCycle(mkDeps())).executed];
    assert.ok(lost, "the fault was injected after the crank landed");
    assert.equal(f.readings.get(D)?.processed, true);
    const landedSig = lost as string;
    executed.push(...(await runCycle(mkDeps())).executed);   // a restart
    const yes = executed.filter((e) => e.eventId === YES && e.outcome === "confirmed");
    assert.equal(yes.length, 1, "adopted exactly once across the cycle and the restart");
    if (yes[0].outcome === "confirmed") assert.equal(yes[0].adopted, true);
    assert.equal(reg.receipt(t.mint, YES)!.signature, landedSig);
    // the write-ahead row (expired by the null status) is confirmed again only because the chain search named the same signature
    assert.deepEqual(reg.signatures(t.mint, `crank:${formatDate(D)}`).map((x) => [x.signature, x.status]), [[landedSig, "confirmed"]]);
    assert.equal(keeperCranks(f).length, 1, "no second crank sent");
    const audit = await auditRegistry(reg, { program, now: clock });
    assert.deepEqual(audit.mismatches, []);
  });

  test("negative: a buyback for another reading, or another program's crank for this one, is never adopted as this reading", async () => {
    const { t, f } = await launchTargetCoin();
    const tape = chainTape(f);
    f.targetPool = "unhealthy";
    await runCycle(mkDeps());
    f.targetPool = "ok";
    const sig = f.strangerCrank()!;
    const here = readingPda(tape.programId, tape.config, D).toBase58();
    const other = 20260927;
    // newest on this Reading's list: a crank_buyback of ANOTHER reading that also touches this Reading account (its log says CrankBuyback)
    tape.decoys.set("decoyOtherReading1111111111111111", { address: here, tx: parsedTx({ programId: tape.programId, name: "crank_buyback", recordDate: other, reading: readingPda(tape.programId, tape.config, other), memo: `TEAMBONK|${formatDate(other)}|decoy`, extraAccount: new PublicKey(here) }) });
    // and a lookalike from another program: same instruction bytes, this date, this Reading in the slot
    tape.decoys.set("decoyOtherProgram111111111111111", { address: here, tx: parsedTx({ programId: Keypair.generate().publicKey, name: "crank_target_burn", recordDate: D, reading: new PublicKey(here), memo: `TEAMBONK|${formatDate(D)}|decoy` }) });
    // the real one hidden first: neither decoy is adopted; the receipts wait
    tape.hidden.add(sig);
    const held = await executePending(mkDeps(), t, reg.lockedRule(t));
    assert.ok(held.some((o) => o.eventId === YES && o.outcome === "waiting" && /not found yet/.test(o.why)), JSON.stringify(held));
    assert.equal(reg.receipt(t.mint, YES)!.status === "confirmed", false);
    // served again: the real one is found beneath the decoys
    tape.hidden.delete(sig);
    const out = await executePending(mkDeps(), t, reg.lockedRule(t));
    assert.equal(out.find((o) => o.eventId === YES)?.outcome, "confirmed");
    assert.equal(reg.receipt(t.mint, YES)!.signature, sig);
  });

  test("negative: a found transaction whose kind contradicts the reading's outcome is held, not adopted", async () => {
    const { t, f } = await launchTargetCoin();
    f.targetPool = "unhealthy";
    await runCycle(mkDeps());
    f.targetPool = "ok";
    const sig = f.strangerCrank()!;
    f.findCrankTx = async () => ({ signature: sig, slot: 1, memo: f.landed.get(sig)!.memo, instruction: "forward_to_winner", forwards: true });
    const out = await executePending(mkDeps(), t, reg.lockedRule(t));
    assert.ok(out.some((o) => o.eventId === YES && o.outcome === "waiting" && /is not a crank/.test(o.why)), JSON.stringify(out));
    assert.notEqual(reg.receipt(t.mint, YES)!.status, "confirmed");
  });
});
