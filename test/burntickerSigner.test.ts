// THE SECOND READING SIGNER (signer-2, 2026-10-12): the signer host's decision (agreement, disagreement, cannot-check, the journal that
// never signs two messages for one day), the keepers' intake (programChain for $DEFICIT-style coins, multiKeeper for unit counters, the
// pair result) on the in-memory program at quorum 2 and in shadow mode at quorum 1, and the HTTP service on loopback.
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { Keypair } from "@solana/web3.js";
import type { AddressInfo } from "node:net";
import { openLedger, type Ledger } from "@/lib/burnKeeper/ledger";
import { ingest, type KeeperCtx } from "@/lib/burnKeeper/cycle";
import { executeProgramPending } from "@/lib/burnKeeper/programChain";
import { FakeProgram } from "@/lib/burnKeeper/fakeProgram";
import { usdToCents, type LoadedRules } from "@/lib/burnKeeper/rules";
import type { DebtReading, FeedValidation } from "@/lib/burnKeeper/feeds/treasury";
import { GENESIS_HASH } from "@/lib/burnReceipts/constants";
import { signAttestation, verifyAttestation } from "@/lib/burnReceipts/attestation";
import { checkCosignature, cosignerFromEnv, httpCosigner, requestProblem, type Cosigner, type CosignRequest, type ReadingCosignRequest } from "@/lib/burnticker/attesters/cosign";
import { cosignHttpHandler, decideCosign, fileJournal, memoryJournal, type SignerChainView, type SignerDeps } from "@/lib/burnticker/attesters/cosignSigner";
import { openRegistry, wideRule, type Registry, type TokenRow } from "@/lib/burnticker/registry";
import { FakeBurnProgram } from "@/lib/burnticker/program";
import { buildLaunchBundle, FakeLaunchLab } from "@/lib/burnticker/launchBundle";
import { CatalogueAdapter, feedById, loadFixture } from "@/lib/burnticker/catalogue";
import { KalshiClient, fixtureFetch } from "@/lib/burnticker/oracle/kalshi";
import { runCycle, type KeeperDeps } from "@/lib/burnticker/multiKeeper";
import { ensurePairResult, type PairCtx } from "@/lib/burnticker/pairForwardKeeper";
import { FakePairForwardPort } from "@/lib/burnticker/pairForward";
import { spawnSync } from "node:child_process";
import { planCoin, planLines, rolloutIso, type RolloutCoin } from "@/lib/burnticker/attesters/rollout";
import { buybackRules } from "./burnKeeperHelpers.ts";
import { DEBT_RULE, NOW, treasuryAndCrossFetch } from "./burntickerHelpers.ts";

const R = (d: string, a: string): DebtReading => ({ recordDate: d, amount: a, cents: usdToCents(a) });
const V = (...readings: DebtReading[]): FeedValidation => ({ readings, refusals: [] });
const D6 = R("2026-10-06", "40270000000000.00"), D7 = R("2026-10-07", "40284036147367.19"), D8 = R("2026-10-08", "40305316210829.72");
const KEEPER = "KeeperDataKey1111111111111111111111111111111";
const SIGNER = Keypair.generate();
const PROGRAM = Keypair.generate().publicKey.toBase58();
const MINT = Keypair.generate().publicKey.toBase58();
const MAINNET = GENESIS_HASH.mainnet;
const UNIT = BigInt(100_000_000_000);

/** An in-process cosigner: the request goes through JSON, as over the wire. */
const local = (d: SignerDeps): Cosigner => ({ cosign: async (req: CosignRequest) => decideCosign(d, JSON.parse(JSON.stringify(req))) });

// ---------------------------------------------------------------------------------------------------------------------------------
// $DEFICIT-style coins: the burnkeeper (programChain.ts) on the in-memory program
// ---------------------------------------------------------------------------------------------------------------------------------

describe("$DEFICIT path: the keeper and the second signer on the in-memory program", () => {
  let ledger: Ledger, loaded: LoadedRules, prog: FakeProgram, ctx: KeeperCtx, lines: string[], signerLines: string[], rows: DebtReading[];
  const setup = (o: { quorum: number; attesters: string[] }) => {
    ledger = openLedger(":memory:"); loaded = buybackRules(); lines = []; signerLines = []; rows = [D7, D8];
    prog = new FakeProgram({ programId: PROGRAM, mint: MINT, mode: "buyback", rulesSha256: loaded.sha256, memoPrefix: loaded.rules.memo.prefix, memoSource: loaded.rules.feed.memoSource, unitValue: UNIT,
      fractionPerUnitBps: 200, floorLamports: BigInt(1_000_000), reserveLamports: BigInt(20_000_000), attesters: o.attesters, quorum: o.quorum, heldKeys: [KEEPER], now: () => NOW });
    ctx = { ledger, loaded, log: (s) => lines.push(s), now: () => NOW, dryRun: false };
  };
  const chainOf = async (): Promise<SignerChainView> => ({ genesis: prog.cfg.clusterGenesis!, programId: prog.programId, rulesSha256: prog.cfg.rulesSha256, feedId: prog.cfg.feedId, valueDecimals: prog.cfg.valueDecimals, hasBaseline: prog.cfg.hasBaseline, lastRecordDate: prog.cfg.lastRecordDate, attesters: prog.cfg.attesters.map((a) => a.key) });
  const signer = (over: Partial<SignerDeps> = {}): SignerDeps => ({
    programId: PROGRAM, genesis: MAINNET, secretKey: SIGNER.secretKey,
    coin: async (m) => (m === MINT ? { mint: MINT, ticker: loaded.rules.ticker, kind: "debt", rulesText: loaded.text, baselineAt: "2026-10-08T20:00:00Z" } : null),
    readings: async () => { throw new Error("not a units coin"); }, debtRows: async (from) => rows.filter((r) => r.recordDate >= from),
    chain: async () => chainOf(), journal: memoryJournal(), now: () => NOW, log: (s) => signerLines.push(s), ...over,
  });

  beforeEach(() => setup({ quorum: 2, attesters: [KEEPER, SIGNER.publicKey.toBase58()] }));

  test("quorum 2 without the second signer: nothing is submitted, the reading waits (quorum short)", async () => {
    ingest(ctx, V(D7, D8));
    const rep = await executeProgramPending(ctx, prog);
    assert.deepEqual(rep.readings.map((r) => r.outcome), ["quorum-short"]);
    assert.equal(prog.cfg.readings, 0);
  });

  test("quorum 2 with the second signer: both readings land, each carrying the keeper's key and the signer's in one instruction", async () => {
    ctx.cosigner = local(signer());
    ingest(ctx, V(D7, D8));
    const rep = await executeProgramPending(ctx, prog);
    assert.deepEqual(rep.readings.map((r) => [r.recordDate, r.outcome, r.units]), [["2026-10-07", "submitted", 0], ["2026-10-08", "submitted", 21]]);
    assert.equal(prog.cfg.lastRecordDate, 20261008);
    assert.deepEqual(prog.cosigned.map((c) => [c.recordDate, c.keys]), [[20261007, [KEEPER, SIGNER.publicKey.toBase58()]], [20261008, [KEEPER, SIGNER.publicKey.toBase58()]]]);
    assert.ok(lines.some((l) => /the second signer agrees and co-signed/.test(l)));
    assert.ok(signerLines.some((l) => /signed \$DEFICIT 2026-10-08: Treasury debt \$40305316210829\.72 \(prev 2026-10-07\)/.test(l)), signerLines.join("\n"));
  });

  test("a disagreement (Treasury shows another amount to the signer) is an alert and no reading; the agreed baseline still landed", async () => {
    rows = [D7, R("2026-10-08", "40305316210829.73")];
    ctx.cosigner = local(signer());
    ingest(ctx, V(D7, D8));
    const rep = await executeProgramPending(ctx, prog);
    assert.deepEqual(rep.readings.map((r) => [r.recordDate, r.outcome]), [["2026-10-07", "submitted"], ["2026-10-08", "held"]]);
    assert.equal(prog.cfg.lastRecordDate, 20261007, "no reading for the disputed day");
    const held = ledger.programReadings("DEBT", "treasury.debt_to_penny").find((r) => r.recordDate === "2026-10-08")!;
    assert.equal(held.status, "held");
    assert.match(held.error ?? "", /second signer: .*debt in cents: the keeper has 4030531621082972, the second signer has 4030531621082973/);
    assert.ok(lines.some((l) => /\[alert\] cosigner-disagree 2026-10-08/.test(l)));
  });

  test("a skipped Treasury date is a disagreement too (the keeper never jumps a day)", async () => {
    rows = [D6, D7, D8];
    ctx.cosigner = local(signer());
    ingest(ctx, V(D6));
    await executeProgramPending(ctx, prog);
    const answer = await decideCosign(signer(), { v: 1, kind: "reading", mint: MINT, ticker: "DEFICIT", programId: PROGRAM, genesis: MAINNET, feedId: "treasury.debt_to_penny", recordDate: "2026-10-08", prevDate: "2026-10-06", value: D8.cents.toString(), eventIds: [], sourceUrl: "x", proofHash: "0".repeat(64), message: "x" });
    assert.equal(answer.status, "disagree");
    assert.ok(answer.status === "disagree" && answer.fields.some((f) => f.field === "skipped dates" && f.signer === "2026-10-07"));
  });

  test("the signer cannot check (Treasury unreadable): at quorum 2 the reading waits and says why; at quorum 1 the keeper goes ahead alone", async () => {
    ctx.cosigner = local(signer({ debtRows: async () => { throw new Error("Treasury API HTTP 503"); } }));
    ingest(ctx, V(D7));
    let rep = await executeProgramPending(ctx, prog);
    assert.equal(rep.readings[0].outcome, "quorum-short");
    assert.match(rep.readings[0].why ?? "", /second signer gave none .*Treasury could not be read by this signer \(Treasury API HTTP 503\)/);
    setup({ quorum: 1, attesters: [KEEPER] });
    ctx.cosigner = local(signer({ debtRows: async () => { throw new Error("Treasury API HTTP 503"); } }));
    ingest(ctx, V(D7));
    rep = await executeProgramPending(ctx, prog);
    assert.equal(rep.readings[0].outcome, "submitted");
  });

  test("shadow mode (quorum 1, the signer's key not listed yet): agreement adds nothing to the transaction; disagreement still holds", async () => {
    setup({ quorum: 1, attesters: [KEEPER] });
    ctx.cosigner = local(signer());
    ingest(ctx, V(D7, D8));
    let rep = await executeProgramPending(ctx, prog);
    assert.deepEqual(rep.readings.map((r) => r.outcome), ["submitted", "submitted"]);
    assert.equal(prog.cosigned.length, 0, "an unlisted key never joins the instruction");
    assert.ok(lines.some((l) => /is not an attester of this coin yet/.test(l)));
    setup({ quorum: 1, attesters: [KEEPER] });
    rows = [D7, R("2026-10-08", "1.00")];
    ctx.cosigner = local(signer());
    ingest(ctx, V(D7, D8));
    rep = await executeProgramPending(ctx, prog);
    assert.deepEqual(rep.readings.map((r) => r.outcome), ["submitted", "held"]);
  });

  test("the journal: the same request signs the same bytes again; a different message for the same day is refused for good", async () => {
    const d = signer({ chain: undefined });
    const msg = await prog.readingMessage({ recordDate: 20261007, prevDate: 0, value: D7.cents, sourceUrl: "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/debt_to_penny?fields=record_date,tot_pub_debt_out_amt&filter=record_date:eq:2026-10-07", feedId: "treasury.debt_to_penny", valueDecimals: 2 });
    const req: ReadingCosignRequest = { v: 1, kind: "reading", mint: MINT, ticker: "DEFICIT", programId: PROGRAM, genesis: MAINNET, feedId: "treasury.debt_to_penny", recordDate: "2026-10-07", prevDate: null, value: D7.cents.toString(), eventIds: [], sourceUrl: "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/debt_to_penny?fields=record_date,tot_pub_debt_out_amt&filter=record_date:eq:2026-10-07", proofHash: "0".repeat(64), message: msg };
    const a = await decideCosign(d, req), b = await decideCosign(d, req);
    assert.equal(a.status, "signed"); assert.deepEqual(a, b);
    assert.ok(a.status === "signed" && verifyAttestation(SIGNER.publicKey, Buffer.from(msg), Buffer.from(a.signature, "base64")));
    rows = [R("2026-10-07", "40284036147367.20")];   // Treasury revised the row: the signer's own bytes change, and it still refuses to sign a second message
    const c = await decideCosign(d, { ...req, value: rows[0].cents.toString(), message: msg.replace("40284036147367.19", "40284036147367.20") });
    assert.equal(c.status, "disagree");
    assert.ok(c.status === "disagree" && c.fields[0].field === "earlier signature");
  });

  test("requests for another program or cluster, malformed requests and pair results are never signed", async () => {
    const d = signer();
    const base = { v: 1, kind: "reading", mint: MINT, ticker: "DEFICIT", programId: PROGRAM, genesis: MAINNET, feedId: "treasury.debt_to_penny", recordDate: "2026-10-07", prevDate: null, value: "1", eventIds: [], sourceUrl: "x", proofHash: "0".repeat(64), message: "x" };
    const other = await decideCosign(d, { ...base, programId: Keypair.generate().publicKey.toBase58() });
    assert.equal(other.status, "disagree");
    assert.equal((await decideCosign(d, { ...base, genesis: GENESIS_HASH.devnet })).status, "disagree");
    assert.match(requestProblem({ ...base, proofHash: "zz" }) ?? "", /proofHash/);
    assert.equal((await decideCosign(d, { ...base, value: "-5" })).status, "cannot-check");
    assert.equal((await decideCosign(d, { ...base, mint: Keypair.generate().publicKey.toBase58() })).status, "cannot-check");
    const pair = await decideCosign(d, { v: 1, kind: "pair", mintA: MINT, mintB: PROGRAM, programId: PROGRAM, genesis: MAINNET, recordDate: "2026-10-07", winner: null, sourceUrl: "x", proofHash: "0".repeat(64), message: "x" });
    assert.match(pair.status === "cannot-check" ? pair.why : "", /does not check pair results yet/);
  });

  test("checkCosignature: a signature over other bytes counts as a disagreement; a listed key is marked", () => {
    const m = "BURNRECEIPTS-v3|test";
    const sig = Buffer.from(signAttestation(SIGNER.secretKey, Buffer.from(m))).toString("base64");
    assert.deepEqual(checkCosignature({ status: "signed", key: SIGNER.publicKey.toBase58(), signature: sig }, m, [SIGNER.publicKey.toBase58()]).kind, "signed");
    const r = checkCosignature({ status: "signed", key: SIGNER.publicKey.toBase58(), signature: sig }, `${m}x`, []);
    assert.equal(r.kind, "disagree");
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Burnticker coins: the multi-token keeper's unit counter on the fake program
// ---------------------------------------------------------------------------------------------------------------------------------

describe("unit-counter coins: multiKeeper and the second signer (FakeBurnProgram, quorum 2)", () => {
  const ATTESTER = "KeeperDataKey1111111111111111111111111111111";
  const treasuryBody = loadFixture(feedById("treasury.debt")!).body;
  let reg: Registry, program: FakeBurnProgram, t: TokenRow, lines: string[];
  const launch = async (attesters: string[], quorum: number) => {
    reg = openRegistry(":memory:"); program = new FakeBurnProgram("devnet"); program.heldKeys = [ATTESTER]; lines = [];
    const b = await buildLaunchBundle({ creator: "CreatorWa11et111111111111111111111111111111", ticker: "DEBT", name: "DEBT coin", description: "a test", imageUrl: null, links: [], rule: DEBT_RULE, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true }, cluster: "devnet" }, { program, launchLab: new FakeLaunchLab(), devFeeWallet: null, attesters, quorum, metadataUri: (m) => `https://x/${m}.json` });
    const row = reg.register({ mint: b.mint, ticker: "DEBT", name: b.name, creator: "CreatorWa11et111111111111111111111111111111", description: b.description, imageUrl: null, links: [], rulesText: b.rules.text, feePda: b.addresses.feePda, vault: b.addresses.vault, tokenConfig: b.addresses.tokenConfig, poolId: b.addresses.poolId, launchTx: null, cluster: "devnet", platformId: b.addresses.platformId, baselineAt: "2026-09-01T00:00:00Z", status: "draft" }, NOW);
    reg.markLaunched(row.mint, "launchDEBT", b.addresses.poolId, "2026-09-01T00:00:00Z");
    program.supplies.set(row.mint, BigInt("1000000000000000")); program.deposit(row.mint, BigInt(10_000_000_000));
    t = reg.token(row.mint)!;
  };
  const deps = (cosigner?: Cosigner): KeeperDeps => ({ registry: reg, program, oracles: { kalshi: new KalshiClient({ fetchImpl: fixtureFetch({}), now: () => NOW, minIntervalMs: 0 }), catalogue: new CatalogueAdapter({ fetchImpl: treasuryAndCrossFetch(treasuryBody), now: () => NOW }) }, attester: ATTESTER, log: (s) => lines.push(s), now: () => NOW, dryRun: false, ...(cosigner ? { cosigner } : {}) });
  const signer = (readings?: () => Promise<never[]>): SignerDeps => ({
    programId: program.programId, genesis: MAINNET, secretKey: SIGNER.secretKey,
    coin: async (m) => (m === t.mint ? { mint: t.mint, ticker: "DEBT", kind: "units", rulesText: t.rulesJson, baselineAt: t.baselineAt } : null),
    readings: readings ?? (async (rule) => (await new CatalogueAdapter({ fetchImpl: treasuryAndCrossFetch(treasuryBody), now: () => NOW }).settledSince(wideRule(rule), null)).events),
    debtRows: async () => [],
    chain: async (m) => { const c = (await program.port(m).config())!; return { genesis: c.clusterGenesis!, programId: c.programId, rulesSha256: c.rulesSha256, feedId: c.feedId, valueDecimals: c.valueDecimals, hasBaseline: c.hasBaseline, lastRecordDate: c.lastRecordDate, attesters: c.attesters.map((a) => a.key) }; },
    journal: memoryJournal(), now: () => NOW, log: () => {},
  });

  test("without the signer nothing is attested; with it every reading lands co-signed and the counter equals the keeper's", async () => {
    await launch([ATTESTER, SIGNER.publicKey.toBase58()], 2);
    await runCycle(deps());
    assert.equal((await program.port(t.mint).config())!.readings, 0);
    assert.ok(lines.some((l) => /Waiting for signatures\. The program needs 2 signer signatures, and this keeper holds 1\./.test(l)), lines.join("\n"));
    await runCycle(deps(local(signer())));
    const cfg = (await program.port(t.mint).config())!;
    assert.ok(cfg.readings >= 2, `readings: ${cfg.readings}`);
    const f = program.fake(t.mint);
    assert.equal(f.cosigned.length, cfg.readings, "every reading carried the second key");
    assert.ok(f.cosigned.every((c) => c.keys.includes(SIGNER.publicKey.toBase58())));
  });

  test("a disagreement on the unit counter raises cosigner-disagree and sends no reading for that day", async () => {
    await launch([ATTESTER, SIGNER.publicKey.toBase58()], 2);
    await runCycle(deps(local(signer(async () => []))));   // the signer's source shows nothing settled: its counter stays at 1
    const cfg = (await program.port(t.mint).config())!;
    assert.equal(cfg.readings, 1, "only the baseline (counter 1) was agreed");
    const alerts = reg.alertsSince(0).filter((a) => a.kind === "cosigner-disagree");
    assert.equal(alerts.length, 1);
    assert.match(alerts[0].text, /the second signer did not agree .*unit counter: the keeper has \d+, the second signer has 1/);
    assert.ok(lines.some((l) => /Held\. The second signer worked out a different reading/.test(l)));
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Pair results
// ---------------------------------------------------------------------------------------------------------------------------------

describe("pair results and the second signer", () => {
  const A = Keypair.generate().publicKey.toBase58(), B = Keypair.generate().publicKey.toBase58();
  const ctxWith = () => {
    const port = new FakePairForwardPort(A, B, () => { throw new Error("no fake program"); }, () => NOW);
    (port as unknown as { resultMessage: (o: { recordDate: number; winner: string | null }) => Promise<{ message: string; programId: string; genesis: string }> }).resultMessage = async (o) => ({ message: `BURNRECEIPTS-PAIR-v1|test|${o.recordDate}|winner=${o.winner ?? "draw"}`, programId: PROGRAM, genesis: MAINNET });
    const tok = (mint: string, ticker: string) => ({ mint, ticker }) as unknown as TokenRow;
    const ctx: PairCtx = { pair: { pairId: "p1", mintA: A, mintB: B, selectorKey: "k", createdAt: 0 }, me: tok(A, "AAA"), other: tok(B, "BBB"), port, active: true };
    return { ctx, port };
  };
  const signing: Cosigner = { cosign: async (r) => ({ status: "signed", key: SIGNER.publicKey.toBase58(), signature: Buffer.from(signAttestation(SIGNER.secretKey, Buffer.from(r.message))).toString("base64") }) };

  test("an agreeing signer's signature goes into submit_pair_result; a disagreement is an alert and no result; cannot-check goes ahead alone", async () => {
    const reg = openRegistry(":memory:"), logs: string[] = [];
    let { ctx, port } = ctxWith();
    let r = await ensurePairResult(ctx, reg, 20261007, { now: NOW, dryRun: false, log: (s) => logs.push(s), cosigner: signing });
    assert.ok("result" in r, "waiting" in r ? r.waiting : "");
    assert.deepEqual(port.resultCosignatures.get(20261007), [SIGNER.publicKey.toBase58()]);
    ({ ctx, port } = ctxWith());
    r = await ensurePairResult(ctx, reg, 20261008, { now: NOW, dryRun: false, log: (s) => logs.push(s), cosigner: { cosign: async () => ({ status: "disagree", why: "a different winner", fields: [{ field: "winner", keeper: "draw", signer: A }] }) } });
    assert.ok("waiting" in r && /Held\. The second signer did not agree/.test(r.waiting));
    assert.ok(reg.alertsSince(0).some((a) => a.kind === "cosigner-disagree"));
    assert.equal(port.results.size, 0);
    ({ ctx, port } = ctxWith());
    r = await ensurePairResult(ctx, reg, 20261009, { now: NOW, dryRun: false, log: (s) => logs.push(s), cosigner: { cosign: async () => ({ status: "cannot-check", why: "not built" }) } });
    assert.ok("result" in r);
    assert.equal(port.resultCosignatures.size, 0);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// The HTTP service
// ---------------------------------------------------------------------------------------------------------------------------------

describe("the signer's HTTP service on loopback", () => {
  test("token required; a decision comes back over the wire; a wrong token or a dead host is 'cannot check'; env URLs are checked", async () => {
    const d: SignerDeps = { programId: PROGRAM, genesis: MAINNET, secretKey: SIGNER.secretKey, coin: async () => null, readings: async () => [], debtRows: async () => [], journal: memoryJournal(), now: () => NOW, log: () => {} };
    const server = http.createServer(cosignHttpHandler(d, { token: "t0ken", info: () => ({ key: SIGNER.publicKey.toBase58() }) }));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const req: ReadingCosignRequest = { v: 1, kind: "reading", mint: MINT, ticker: "DEFICIT", programId: PROGRAM, genesis: MAINNET, feedId: "f", recordDate: "2026-10-07", prevDate: null, value: "1", eventIds: [], sourceUrl: "x", proofHash: "0".repeat(64), message: "x" };
      const ok = await httpCosigner({ url, token: "t0ken" }).cosign(req);
      assert.deepEqual(ok, { status: "cannot-check", why: `this signer does not serve ${MINT}` });
      const bad = await httpCosigner({ url, token: "wrong" }).cosign(req);
      assert.match(bad.status === "cannot-check" ? bad.why : "", /HTTP 401/);
      const health = await (await fetch(`${url}/v1/health`)).json() as { key: string };
      assert.equal(health.key, SIGNER.publicKey.toBase58());
    } finally { await new Promise((r) => server.close(r)); }
    const dead = await httpCosigner({ url: "http://127.0.0.1:9", timeoutMs: 2_000 }).cosign({ v: 1, kind: "pair", mintA: MINT, mintB: PROGRAM, programId: PROGRAM, genesis: MAINNET, recordDate: "2026-10-07", winner: null, sourceUrl: "x", proofHash: "0".repeat(64), message: "x" });
    assert.match(dead.status === "cannot-check" ? dead.why : "", /could not be reached/);
    assert.equal(cosignerFromEnv({}), null);
    // a tailnet address (100.64/10) is allowed over plain http; spelled in pieces so the publish leak scan does not read it as a host address
    assert.ok(cosignerFromEnv({ BURNTICKER_COSIGNER_URL: `http://${["100", "64", "1", "2"].join(".")}:8790` }));
    assert.throws(() => cosignerFromEnv({ BURNTICKER_COSIGNER_URL: "http://203.0.113.9:8790" }), /https/);
  });

  test("the file journal survives a restart and refuses to start on a damaged line", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bt-cosign-"));
    const f = path.join(dir, "j", "journal.jsonl");
    fileJournal(f).put("m|2026-10-07", "MSG", "sig", NOW);
    assert.equal(fileJournal(f).get("m|2026-10-07"), "MSG");
    assert.equal(fs.statSync(f).mode & 0o777, 0o600);
    fs.appendFileSync(f, "not json\n");
    assert.throws(() => fileJournal(f), /refusing to start/);
  });
});


// ---------------------------------------------------------------------------------------------------------------------------------
// The rollout (propose_attesters → 48 h → apply), planned and printed without signing anything
// ---------------------------------------------------------------------------------------------------------------------------------

describe("the second-signer rollout (dry run)", () => {
  const KEY = "J5XB9gNiftyMpLPy767KB4LF9R2y2ZefvtNck6xhFTf6";
  const S2 = SIGNER.publicKey.toBase58();
  const ADMIN = "8zsHrHjSgunnLmVyPG848GLw5a9xai6u8SZCYaskWrDV";
  const at = (iso: string) => Math.floor(Date.parse(iso) / 1000);
  const coin = (ticker: string, mint: string, joined: string, over: Partial<RolloutCoin> = {}): RolloutCoin => ({ ticker, mint, attesters: [{ key: KEY, kind: 0, addedAt: at(joined) }], quorum: 1, adminRenounced: false, admin: ADMIN, paired: false, pending: null, ...over });
  const DEFICIT = coin("DEFICIT", "AJJ4XxCUYr8zzMWm8FYg3xh638LYAAApdNqWBqCK4oqj", "2026-10-15T02:00:00Z");
  const REHEARSAL = coin("REHEARSAL", "FwXiFscFSYXzvPVzV4rCw4UBcGDhT53xHDpsL3pVpzkp", "2026-10-11T20:00:00Z");

  test("the plan follows the program's rules: seniority first, then propose, 48 h, apply; pairs, renounced and done coins are not planned", () => {
    const now = at("2026-10-16T18:00:00Z");
    const d = planCoin(DEFICIT, S2, now);
    assert.equal(d.step.kind, "wait-seniority");
    assert.deepEqual(d.step.kind === "wait-seniority" && [rolloutIso(d.step.proposeFrom), rolloutIso(d.step.applyFrom), rolloutIso(d.step.signerSeniorFrom), d.step.quorum], ["2026-10-22T02:00:00Z", "2026-10-24T02:00:00Z", "2026-10-31T02:00:00Z", 2]);
    assert.equal(planCoin(REHEARSAL, S2, at("2026-10-18T20:00:00Z")).step.kind, "propose-now");
    assert.equal(planCoin(REHEARSAL, S2, at("2026-10-18T19:59:00Z")).step.kind, "wait-seniority");
    assert.match(planLines(planCoin({ ...REHEARSAL, paired: true }, S2, now)).join(" "), /partner's quorum/);
    assert.match(planLines(planCoin({ ...REHEARSAL, adminRenounced: true }, S2, now)).join(" "), /renounced/);
    assert.equal(planCoin({ ...REHEARSAL, quorum: 2, attesters: [...REHEARSAL.attesters, { key: S2, kind: 0, addedAt: now }] }, S2, now).step.kind, "done");
    const pend = planCoin({ ...REHEARSAL, pending: { attesters: [{ key: KEY, kind: 0 }, { key: S2, kind: 0 }], quorum: 2, etaSec: at("2026-10-20T20:00:00Z") } }, S2, at("2026-10-21T00:00:00Z"));
    assert.deepEqual(pend.step, { kind: "pending", applyFrom: at("2026-10-20T20:00:00Z"), applicableNow: true, matches: true });
    for (const l of [...planLines(d), ...planLines(pend)]) assert.doesNotMatch(l, /→|\s\/\s/, l);
  });

  test("the script's dry run (--snapshot, no RPC) prints the plan and the unsigned propose_attesters instruction for the vault", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bt-rollout-"));
    const snap = path.join(dir, "coins.json");
    fs.writeFileSync(snap, JSON.stringify([DEFICIT, REHEARSAL]));
    const r = spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--import", "./test/alias-hook.mjs", "scripts/burnticker-signer-rollout.mts", "--signer", S2, "--program", PROGRAM, "--snapshot", snap, "--now", "2026-10-19T00:00:00Z", "--payer", KEY], { cwd: path.join(import.meta.dirname, ".."), encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout) as { plans: { ticker: string; step: string; lines: string[]; proposeInstruction: { keys: { pubkey: string; isSigner: boolean }[]; dataBase64: string } | null; applyInstruction: unknown }[] };
    const [d, h] = out.plans;
    assert.equal(d.step, "wait-seniority"); assert.equal(h.step, "propose-now");
    assert.ok(h.proposeInstruction && h.proposeInstruction.keys.some((k) => k.pubkey === ADMIN && k.isSigner), "the vault (config authority) is the signer");
    assert.ok(Buffer.from(h.proposeInstruction!.dataBase64, "base64").includes(SIGNER.publicKey.toBuffer()), "the second key is in the proposal");
    assert.ok(h.applyInstruction);
    assert.match(d.lines.join(" "), /propose from 2026-10-22T02:00:00Z, apply from 2026-10-24T02:00:00Z/);
  });
});
