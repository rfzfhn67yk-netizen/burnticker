// BURNTICKER (2026-10-09) — the registry, the launch bundle (on the fakes), and the multi-token keeper against the FakeBurnProgram:
// one crank per (mint, event) across restarts, the write-ahead signature surviving a dropped send, the chain as the final word,
// buyback spend = the keeper's exact formula, the floor, voids, vault-mode shortfalls, a binary and a scalar token sharing a cycle,
// dry run, feed backoff, and the token page recomputing every receipt green (and red when tampered).
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openRegistry, selectorKeyOf, wideRule, readingMatches, type Registry } from "@/lib/burnticker/registry";
import { FakeBurnProgram, programPageBlock } from "@/lib/burnticker/program";
import { buildLaunchBundle, FakeLaunchLab, allocationFor, launchProblems } from "@/lib/burnticker/launchBundle";
import { lockRule, validateRule } from "@/lib/burnticker/rules";
import { KalshiClient, fixtureFetch, settledMarketsUrl, seriesApiUrl, openMarketsUrl, marketApiUrl } from "@/lib/burnticker/oracle/kalshi";
import { CatalogueAdapter, feedById, loadFixture } from "@/lib/burnticker/catalogue";
import { executePending, fetchDue, planToken, runCycle, type KeeperDeps } from "@/lib/burnticker/multiKeeper";
import { buildReceiptsJson, buildTokenStatus, buildPlatformIndex, publishTokenSite, publishPlatformIndex, renderTokenHtml, renderPlatformIndexHtml } from "@/lib/burnticker/tokenPage";
import { parseBuybackMemo as parseProgramMemo } from "@/lib/burnReceipts/memo";
import { buybackSpend as programSpend } from "@/lib/burnReceipts/math";
import { programExpressible, counterRule } from "@/lib/burnticker/program";
import { MAX_SLIPPAGE_BPS, MAX_TWAP_DEVIATION_BPS, MAX_TWAP_WINDOW_SECS, MIN_TWAP_WINDOW_SECS, TWAP_BUCKET_TOLERANCE_BPS_SECS } from "@/lib/burnReceipts/constants";
import { BRONCOS, DEBT_RULE, DENVER_HIGH, NOW, ONE_SHOT, SPX, VAULT_RULE, fx, treasuryAndCrossFetch } from "./burntickerHelpers.ts";

const VAULT_EQUAL = { ...BRONCOS, binary: { onYes: { tokens: 1000000 }, onNo: { tokens: 1000000 } }, vault: { share: 0.25, vestDays: 365, cliffDays: 0 } };

const CREATOR = "CreatorWa11et111111111111111111111111111111";
const ATTESTER = "KeeperDataKey1111111111111111111111111111111";
const table = {
  [settledMarketsUrl("KXNFLGAME")]: fx("kalshi/KXNFLGAME.settled.json"), [seriesApiUrl("KXNFLGAME")]: fx("kalshi/series.KXNFLGAME.json"), [openMarketsUrl("KXNFLGAME")]: { cursor: "", markets: [] },
  [settledMarketsUrl("KXHIGHDEN")]: fx("kalshi/KXHIGHDEN.settled.json"), [seriesApiUrl("KXHIGHDEN")]: fx("kalshi/series.KXHIGHDEN.json"), [openMarketsUrl("KXHIGHDEN")]: fx("kalshi/KXHIGHDEN.open.json"),
  [settledMarketsUrl("KXINX")]: fx("kalshi/KXINX.settled.json"), [seriesApiUrl("KXINX")]: fx("kalshi/series.KXINX.json"),
  [marketApiUrl("KXNFLGAME-26OCT04DENSF-DEN")]: { market: (fx("kalshi/KXNFLGAME.settled.json") as { markets: { ticker: string }[] }).markets.find((m) => m.ticker === "KXNFLGAME-26OCT04DENSF-DEN") },
};
const treasuryBody = loadFixture(feedById("treasury.debt")!).body;

let reg: Registry, program: FakeBurnProgram, deps: KeeperDeps, lines: string[], clock: number;
async function launch(rule: unknown, ticker: string, baselineAt = "2026-09-01T00:00:00Z") {
  const b = await buildLaunchBundle({ creator: CREATOR, ticker, name: `${ticker} coin`, description: "a test", imageUrl: null, links: [], rule, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true }, cluster: "devnet" }, { program, launchLab: new FakeLaunchLab(), devFeeWallet: null, attesters: [ATTESTER], quorum: 1, metadataUri: (m) => `https://x/${m}.json` });
  const t = reg.register({ mint: b.mint, ticker, name: b.name, creator: CREATOR, description: b.description, imageUrl: null, links: [], rulesText: b.rules.text, feePda: b.addresses.feePda, vault: b.addresses.vault, tokenConfig: b.addresses.tokenConfig, poolId: b.addresses.poolId, launchTx: null, cluster: "devnet", platformId: b.addresses.platformId, baselineAt, status: "draft" }, clock);
  reg.markLaunched(t.mint, `launch${ticker}`, b.addresses.poolId, baselineAt);
  reg.addAttester({ mint: t.mint, pubkey: ATTESTER, role: "data-key", addedAt: clock, timelockUntil: null });
  if (program.tokens.has(t.mint)) program.supplies.set(t.mint, BigInt("1000000000000000"));
  return reg.token(t.mint)!;
}
beforeEach(() => {
  reg = openRegistry(":memory:"); program = new FakeBurnProgram("devnet"); program.now = () => clock; lines = []; clock = NOW;
  deps = { registry: reg, program, oracles: { kalshi: new KalshiClient({ fetchImpl: fixtureFetch(table), now: () => clock, minIntervalMs: 0 }), catalogue: new CatalogueAdapter({ fetchImpl: treasuryAndCrossFetch(treasuryBody), now: () => clock }) }, attester: ATTESTER, log: (s) => lines.push(s), now: () => clock, dryRun: false };
});

describe("registry", () => {
  test("register stores the canonical rule text + hash, refuses a taken ticker and a non-canonical text; readings dedupe and refuse a changed result", async () => {
    const t = await launch(BRONCOS, "BRONCO");
    assert.equal(t.rulesSha, lockRule(BRONCOS).sha256);
    assert.equal(t.selectorKey, "kalshi:KXNFLGAME:binary");
    assert.equal(t.status, "live");
    await assert.rejects(launch(BRONCOS, "BRONCO"), /ticker BRONCO is taken/);
    assert.throws(() => reg.register({ mint: "M2", ticker: "X2", name: "x", creator: CREATOR, description: "", imageUrl: null, links: [], rulesText: JSON.stringify(BRONCOS), feePda: "F", vault: null, tokenConfig: null, poolId: null, launchTx: null, cluster: "devnet", platformId: null, baselineAt: "2026-01-01T00:00:00Z", status: "draft" }), /not canonical/);
    const ev = { id: "A", at: "2026-10-01T00:00:00Z", result: "yes" as const, value: null, title: "x", sourceUrl: "https://x" };
    assert.equal(reg.putReadings("kalshi", "k", [ev], { settlementSourceUrl: null, attestedBy: [ATTESTER] }), 1);
    assert.equal(reg.putReadings("kalshi", "k", [ev], { settlementSourceUrl: null, attestedBy: [ATTESTER] }), 0);
    assert.throws(() => reg.putReadings("kalshi", "k", [{ ...ev, result: "no" }], { settlementSourceUrl: null, attestedBy: [] }), /already recorded as yes/);
    assert.equal(selectorKeyOf(validateRule(SPX)), "kalshi:KXINX:scalar");
    assert.equal(selectorKeyOf(validateRule(ONE_SHOT)), "kalshi:market:KXNFLGAME-26OCT04DENSF-DEN");
    assert.deepEqual(wideRule(validateRule(BRONCOS)).filter, {});
    assert.equal(readingMatches(validateRule(BRONCOS), { id: "KXNFLGAME-26OCT04DENSF-SF", title: null }), false);
  });
  test("a file registry persists (data/burnticker.db shape)", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bt-")); const file = path.join(dir, "burnticker.db");
    const a = openRegistry(file); reg = a; const t = await launch(BRONCOS, "BRONCO"); a.close();
    const b = openRegistry(file); assert.equal(b.token(t.mint)!.ticker, "BRONCO"); assert.equal(b.tokens("live").length, 1); b.close();
  });
});

describe("launch bundle (on the fakes)", () => {
  test("composes initialize_token + LaunchLab create, the fee PDA as creator-fee recipient, the rule hash, the footer, ready:false with what is pending", async () => {
    const b = await buildLaunchBundle({ creator: CREATOR, ticker: "BRONCO", name: "Bronco Burn", description: "Burns when Denver wins.", imageUrl: null, links: [{ label: "x", url: "https://x.com/b" }], rule: BRONCOS, firstBuySol: "0.5", acknowledgements: { ruleLocked: true, noReturns: true }, cluster: "devnet" }, { program, launchLab: new FakeLaunchLab(), devFeeWallet: "DevFeeWa11et111111111111111111111111111111", attesters: [ATTESTER], quorum: 1, metadataUri: (m) => `https://x/${m}.json` });
    assert.equal(b.ready, false); assert.equal(b.pending.length, 2);
    assert.equal(b.rules.sha256, lockRule(BRONCOS).sha256);
    assert.match(b.description, /^Burns when Denver wins\. — Kalshi series KXNFLGAME \(ticker ∋ -DEN\) · rule sha256:/);
    assert.equal(b.transactions.length, 1); assert.deepEqual(b.transactions[0].signers, ["creator", "mint"]);
    const create = JSON.parse(Buffer.from(b.transactions[0].instructions[1].dataBase64, "base64").toString());
    assert.equal(create.creatorFeeRecipient, b.addresses.feePda, "the LaunchLab creator is the burn program's fee PDA (H-2), never a key");
    assert.equal(b.burnPoolAuthority, b.addresses.feePda);
    assert.match(b.addresses.feeWsol, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/); assert.notEqual(b.addresses.feeWsol, b.addresses.feePda);
    assert.equal(create.migrateType, "cpmm"); assert.equal(create.totalLockedAmount, "0");
    assert.equal(b.fees.creatorSliceBps, 0); assert.equal(b.fees.curve.legs.find((l) => l.label === "Burnticker (developer)")!.bps, 25);
    assert.equal(b.allocation.curve, "793100000"); assert.equal(program.initialised.length, 1);
    assert.ok(/^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(b.mintSecretKey ?? ""));
  });
  test("vault mode locks the share, keeps LaunchLab's 15% reserve; mainnet and missing acknowledgements are refused", async () => {
    const a = allocationFor(lockRule(VAULT_RULE));
    assert.equal(a.locked, BigInt(250_000_000)); assert.equal(a.reserve, BigInt(150_000_000)); assert.equal(a.curve, BigInt(600_000_000)); assert.equal(a.vestDays, 365);
    const base = { creator: CREATOR, ticker: "BRONCO", name: "x y", description: "", imageUrl: null, links: [], rule: BRONCOS, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: false }, cluster: "devnet" as const };
    assert.deepEqual(launchProblems(base), ["you must acknowledge that you are not promising anyone anything"]);
    await assert.rejects(buildLaunchBundle({ ...base, acknowledgements: { ruleLocked: true, noReturns: true }, cluster: "mainnet" }, { program, launchLab: new FakeLaunchLab(), devFeeWallet: null, attesters: [], quorum: 1, metadataUri: () => "u" }), /mainnet is refused/);
    assert.ok(launchProblems({ ...base, ticker: "toolongticker", creator: "nope" }).length >= 3);
  });
});

describe("the multi-token keeper, on the burn_receipts program (the unit counter)", () => {
  const YES = "KXNFLGAME-26SEP27LARDEN-DEN", NO = "KXNFLGAME-26OCT04DENSF-DEN";
  test("Broncos: fetch → plan → attest baseline + the YES day as a unit counter → crank; the receipt takes the program's facts; NO is a receipt with no burn; a re-run cranks nothing", async () => {
    const t = await launch(BRONCOS, "BRONCO");
    program.deposit(t.mint, BigInt(5_000_000_000));
    const f = program.fake(t.mint);
    const r = await runCycle(deps);
    assert.equal(r.fetched[0].written, (fx("kalshi/KXNFLGAME.settled.json") as { markets: unknown[] }).markets.length, "the whole series is stored once (filter cleared)");
    assert.deepEqual(r.planned.map((p) => [p.eventId, p.status]), [[YES, "planned"], [NO, "nothing"]]);
    assert.equal(r.executed.length, 1); assert.equal(r.executed[0].outcome, "confirmed");
    // The program's readings: the baseline (the day before launch, counter 1) and 2026-09-28 (counter 2 = one unit).
    assert.deepEqual([...f.readings.values()].map((x) => [x.recordDate, x.value, x.units]), [[20260831, BigInt(1), 0], [20260928, BigInt(2), 1]]);
    assert.equal(f.cfg.feedId, "bt.units:BRONCO"); assert.equal(f.cfg.fractionPerUnitBps, 200);
    const rule = programSpend(BigInt(5_000_000_000), BigInt(1), 200);
    const rec = reg.receipt(t.mint, YES)!;
    assert.equal(rec.status, "confirmed"); assert.equal(rec.execution, "program"); assert.equal(rec.readingDate, 20260928); assert.equal(rec.lead, true);
    assert.equal(rec.ruleSpendLamports, rule); assert.equal(rec.spendLamports, rule); assert.equal(rec.chainOutcome, "burned");
    assert.equal(f.feeLamports, BigInt(5_000_000_000) + BigInt(20_000_000) - rule);
    const m = parseProgramMemo(rec.memo!)!;
    assert.ok(m, "the memo the program wrote (v2, counter values)");
    assert.equal(m.prefix, "BRONCO"); assert.equal(m.recordDate, "2026-09-28"); assert.equal(m.units, 1); assert.equal(m.spent, rule.toString()); assert.notEqual(m.burn, "0");
    assert.equal(m.rulesSha12, lockRule(BRONCOS).sha12);
    assert.match(JSON.parse(reg.signatures(t.mint, "reading:2026-09-28")[0].memo).message, /^BURNRECEIPTS-v3\|.*\|bt\.units:BRONCO\|prev=2026-08-31\|2026-09-28\|2\|/);
    assert.deepEqual(JSON.parse(reg.signatures(t.mint, "reading:2026-09-28")[0].memo).events, [YES]);
    const again = await runCycle(deps);
    assert.deepEqual(again.planned, []); assert.deepEqual(again.executed, []);
    assert.equal(f.signed.filter((x) => x.payload.kind === "crank").length, 1);
    assert.deepEqual(reg.readings(t.selectorKey)[0].attestedBy, [ATTESTER]);
    assert.equal(reg.lastProgramTx(t.mint, "reading")!.date, "2026-09-28");
  });
  test("two settlements on one UTC day are ONE reading (one crank): the first receipt carries the amounts, the other the same signature and memo with zeros", async () => {
    const t = await launch({ ...BRONCOS, filter: {} }, "NFLYES");
    program.deposit(t.mint, BigInt(5_000_000_000));
    const day = (id: string, at: string) => ({ id, at, result: "yes" as const, value: null, title: id, sourceUrl: `https://x/${id}` });
    reg.putReadings("kalshi", t.selectorKey, [day("GAME-A", "2026-10-05T01:00:00Z"), day("GAME-B", "2026-10-05T04:00:00Z")], { settlementSourceUrl: null, attestedBy: [ATTESTER] }, clock);
    reg.setFeedState({ selectorKey: t.selectorKey, lastFetchAt: clock, lastOkAt: clock, failures: 0, lastError: null, nextFetchAt: clock + 3_600_000 });
    const r = await runCycle(deps);
    assert.deepEqual(r.executed.map((x) => [x.eventId, x.outcome]), [["GAME-A", "confirmed"], ["GAME-B", "confirmed"]]);
    const a = reg.receipt(t.mint, "GAME-A")!, b = reg.receipt(t.mint, "GAME-B")!;
    assert.equal(a.readingDate, 20261005); assert.equal(b.readingDate, 20261005);
    assert.equal(a.signature, b.signature); assert.equal(a.memo, b.memo); assert.equal(parseProgramMemo(a.memo!)!.units, 2);
    assert.equal(a.lead, true); assert.equal(b.lead, false); assert.equal(b.spendLamports, BigInt(0)); assert.equal(b.burnRaw, BigInt(0));
    assert.equal(a.ruleSpendLamports, programSpend(BigInt(5_000_000_000), BigInt(2), 200));
    assert.equal(reg.totalBurnedRaw(t.mint), a.burnRaw, "the burn is counted once");
    assert.equal(program.fake(t.mint).signed.filter((x) => x.payload.kind === "crank").length, 1);
  });
  test("a Kalshi day is read into the program only after it is over (UTC + grace) and the selector was read after it", async () => {
    const t = await launch({ ...BRONCOS, filter: {} }, "NFLDAY");
    program.deposit(t.mint, BigInt(5_000_000_000));
    reg.putReadings("kalshi", t.selectorKey, [{ id: "GAME-T", at: "2026-10-10T01:30:00Z", result: "yes", value: null, title: "t", sourceUrl: "https://x" }], { settlementSourceUrl: null, attestedBy: [ATTESTER] }, clock);
    reg.setFeedState({ selectorKey: t.selectorKey, lastFetchAt: clock, lastOkAt: clock, failures: 0, lastError: null, nextFetchAt: clock + 3_600_000 });
    const r = await runCycle(deps);
    assert.equal(r.executed[0].outcome, "waiting"); if (r.executed[0].outcome === "waiting") assert.match(r.executed[0].why, /once that UTC day is over/);
    assert.equal(program.fake(t.mint).cfg.lastRecordDate, 20260831, "only the baseline");
    clock = Date.parse("2026-10-11T01:30:00Z");
    reg.setFeedState({ selectorKey: t.selectorKey, lastFetchAt: clock, lastOkAt: clock, failures: 0, lastError: null, nextFetchAt: clock + 3_600_000 });
    const r2 = await runCycle(deps);
    assert.equal(r2.executed[0].outcome, "confirmed");
  });
  test("TWAP UNAVAILABLE / NO POOL: the crank waits (wait reason, no error, no attempt) — the CRANK FAILURE streak does not count waits", async () => {
    program.autoRegisterPool = false;
    const t = await launch(BRONCOS, "BRONCO"); program.deposit(t.mint, BigInt(5_000_000_000));
    const f = program.fake(t.mint);
    const r = await runCycle(deps);
    assert.equal(r.executed[0].outcome, "waiting"); if (r.executed[0].outcome === "waiting") assert.match(r.executed[0].why, /waiting for the CPMM pool/);
    let rec = reg.receipt(t.mint, YES)!;
    assert.equal(rec.status, "planned"); assert.equal(rec.lastError, null); assert.equal(rec.attempts, 0); assert.match(rec.waitReason!, /CPMM pool/);
    assert.equal(r.errors.length, 0);
    f.registerPool(); f.twap = "unavailable"; clock += 10 * 60_000 + 1;
    const r2 = await runCycle(deps);
    assert.equal(r2.executed[0].outcome, "waiting"); rec = reg.receipt(t.mint, YES)!;
    assert.match(rec.waitReason!, /^TwapUnavailable: waiting for TWAP history/); assert.equal(rec.attempts, 0);
    f.twap = "ok"; clock += 10 * 60_000 + 1;
    assert.equal((await runCycle(deps)).executed[0].outcome, "confirmed");
  });
  test("QUORUM SHORT: a 2-of-2 token whose second attester this keeper does not hold — nothing is signed, the receipt waits", async () => {
    program.heldKeys = [ATTESTER];
    const b = await buildLaunchBundle({ creator: CREATOR, ticker: "QUORUM", name: "quorum two", description: "", imageUrl: null, links: [], rule: BRONCOS, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true }, cluster: "devnet" }, { program, launchLab: new FakeLaunchLab(), devFeeWallet: null, attesters: [ATTESTER, "SecondOperator11111111111111111111111111111"], quorum: 2, metadataUri: (m) => `https://x/${m}.json` });
    reg.register({ mint: b.mint, ticker: "QUORUM", name: "q", creator: CREATOR, description: b.description, imageUrl: null, links: [], rulesText: b.rules.text, feePda: b.addresses.feePda, vault: null, tokenConfig: b.addresses.tokenConfig, poolId: null, launchTx: null, cluster: "devnet", platformId: null, baselineAt: "2026-09-01T00:00:00Z", status: "draft" }, clock);
    reg.markLaunched(b.mint, "launchQ", null, "2026-09-01T00:00:00Z");
    const r = await runCycle(deps);
    assert.equal(r.executed[0].outcome, "waiting"); if (r.executed[0].outcome === "waiting") assert.match(r.executed[0].why, /Waiting for signatures\. The program needs 2 signer signatures/);
    assert.equal(program.fake(b.mint).signed.length, 0);
  });
  test("CRASH AFTER SEND: the crank's signature was written first; the next cycle waits while it may land, adopts it when it does — one crank", async () => {
    const t = await launch(BRONCOS, "BRONCO"); program.deposit(t.mint, BigInt(5_000_000_000));
    const f = program.fake(t.mint);
    f.twap = "unavailable"; await runCycle(deps);                     // readings land; the crank waits on TWAP
    f.twap = "ok"; f.dropSends = true; clock += 10 * 60_000 + 1;
    const first = await runCycle(deps);
    assert.equal(first.executed[0].outcome, "waiting");
    assert.equal(reg.receipt(t.mint, YES)!.status, "sending");
    assert.equal((await runCycle(deps)).executed[0].outcome, "waiting", "inside the blockhash life: no second crank signed");
    const cranks = () => f.sent.filter((x) => x.startsWith("fakecrank"));
    assert.equal(cranks().length, 1, "one crank sent; the TWAP-refused one was only simulated");
    f.land(cranks()[0]); f.dropSends = false;
    const third = await runCycle(deps);
    assert.equal(third.executed[0].outcome, "confirmed"); assert.equal(cranks().length, 1);
    assert.equal(reg.receipt(t.mint, YES)!.signature, cranks()[0]);
  });
  test("an expired, never-landed crank is re-signed; the amounts are the program's, not a plan fixed by the keeper", async () => {
    const t = await launch(BRONCOS, "BRONCO"); program.deposit(t.mint, BigInt(5_000_000_000));
    const f = program.fake(t.mint);
    f.twap = "unavailable"; await runCycle(deps);
    f.twap = "ok"; f.dropSends = true; clock += 10 * 60_000 + 1; await runCycle(deps);
    program.deposit(t.mint, BigInt(9_000_000_000)); f.height += 1_000; f.dropSends = false;
    const r = await runCycle(deps);
    assert.equal(r.executed[0].outcome, "confirmed");
    assert.deepEqual(reg.signatures(t.mint, "crank:2026-09-28").map((x) => x.status), ["expired", "confirmed"]);
    assert.equal(reg.receipt(t.mint, YES)!.poolLamports, BigInt(14_000_000_000), "the program priced the pool at crank time");
  });
  test("the chain is the final word: a reading someone else cranked (permissionless) is adopted from its own transaction, nothing re-sent", async () => {
    const t = await launch(BRONCOS, "BRONCO"); program.deposit(t.mint, BigInt(5_000_000_000));
    const f = program.fake(t.mint);
    f.twap = "unavailable"; await runCycle(deps);
    f.twap = "ok";
    const sig = f.strangerCrank()!;
    const out = await executePending(deps, t, reg.lockedRule(t));
    assert.equal(out[0].outcome, "confirmed"); if (out[0].outcome === "confirmed") assert.equal(out[0].adopted, true);
    assert.equal(reg.receipt(t.mint, YES)!.signature, sig);
    assert.equal(f.sent.filter((x) => x.startsWith("fakecrank")).length, 0, "the keeper sent no crank");
  });
  test("under the program's floor the receipt is SKIPPED with the program's reason; a void market is a VOID receipt (never reaches the program)", async () => {
    const t = await launch(BRONCOS, "BRONCO"); program.deposit(t.mint, BigInt(100_000));   // 0.0001 SOL
    const r = await runCycle(deps);
    assert.equal(r.executed[0].outcome, "skipped");
    const rec = reg.receipt(t.mint, YES)!;
    assert.equal(rec.status, "skipped"); assert.equal(rec.chainOutcome, "below-floor"); assert.match(rec.skippedReason!, /under its floor/);
    const voided = JSON.parse(JSON.stringify(fx("kalshi/KXNFLGAME.settled.json"))) as { markets: { ticker: string; status: string; result: string }[] };
    for (const m of voided.markets) if (m.ticker === NO) { m.status = "voided"; m.result = ""; }
    reg = openRegistry(":memory:"); program = new FakeBurnProgram("devnet");
    deps = { ...deps, registry: reg, program, oracles: { ...deps.oracles, kalshi: new KalshiClient({ fetchImpl: fixtureFetch({ ...table, [settledMarketsUrl("KXNFLGAME")]: voided }), now: () => clock, minIntervalMs: 0 }) } };
    const t2 = await launch(BRONCOS, "BRONCO2"); program.deposit(t2.mint, BigInt(5_000_000_000));
    await runCycle(deps);
    assert.equal(reg.receipt(t2.mint, NO)!.status, "void");
  });
  test("a crank refusal (not a wait) backs off (late, never lost); a feed outage backs off and retries", async () => {
    const t = await launch(BRONCOS, "BRONCO"); program.deposit(t.mint, BigInt(5_000_000_000));
    const f = program.fake(t.mint);
    const realSim = f.simulate.bind(f);
    f.simulate = async (raw) => (new TextDecoder().decode(raw).startsWith("fakecrank") ? { err: "Custom(1)", logs: ["Program log: refused"] } : realSim(raw));
    const r = await runCycle(deps);
    assert.equal(r.executed[0].outcome, "error"); assert.ok(r.errors.length);
    const b = reg.receipt(t.mint, YES)!; assert.equal(b.status, "planned"); assert.ok(b.nextAttemptAt! > clock); assert.match(b.lastError!, /Custom\(1\)/);
    f.simulate = realSim; clock = b.nextAttemptAt! + 1;
    assert.equal((await runCycle(deps)).executed[0].outcome, "confirmed");
    const d2 = { ...deps, oracles: { ...deps.oracles, kalshi: new KalshiClient({ fetchImpl: fixtureFetch({}), now: () => clock, minIntervalMs: 0 }) } };
    reg.setFeedState({ selectorKey: t.selectorKey, lastFetchAt: null, lastOkAt: null, failures: 0, lastError: null, nextFetchAt: null });
    const fd = await fetchDue(d2, [t]);
    assert.match(fd[0].error!, /Kalshi HTTP 404/); assert.equal(reg.feedState(t.selectorKey).failures, 1); assert.ok(reg.feedState(t.selectorKey).nextFetchAt! > clock);
    assert.equal((await fetchDue(d2, [t]))[0].skipped, true, "inside the backoff");
  });
  test("three tokens in one cycle: a scalar vs-previous (S&P), a fixed-baseline scalar (Denver high) and a one-shot market; keys shared per series+kind", async () => {
    const spx = await launch(SPX, "SPX"), den = await launch(DENVER_HIGH, "DENHI"), one = await launch(ONE_SHOT, "ONESHOT");
    for (const t of [spx, den, one]) program.deposit(t.mint, BigInt(10_000_000_000));
    const r = await runCycle(deps);
    assert.equal(r.fetched.length, 3);
    const spxR = reg.receipts(spx.mint); assert.ok(spxR.length >= 2); assert.equal(spxR[0].kind, "flat"); assert.equal(spxR[0].status, "nothing", "the first close is the baseline");
    const denR = reg.receipts(den.mint); assert.ok(denR.some((x) => x.status === "confirmed" && x.units >= 1));
    const d8 = denR.find((x) => x.eventId === "KXHIGHDEN-26OCT08")!; assert.equal(d8.units, 4); assert.equal(d8.value, "84");
    assert.equal(d8.execution, "program"); assert.ok(d8.readingDate);
    const oneR = reg.receipts(one.mint); assert.equal(oneR.length, 1); assert.equal(oneR[0].status, "nothing", "settled NO without onNo");
    assert.equal(reg.state(spx.mint).lastValue, spxR[spxR.length - 1].value);
    // The program's counter equals 1 + every unit the token's counted receipts carried.
    const f = program.fake(den.mint);
    assert.equal(f.cfg.lastValue, BigInt(1) + BigInt(denR.filter((x) => x.readingDate !== null).reduce((a, x) => a + x.units, 0)));
  });
  test("tier 2: the Treasury feed with carry — one program reading per period (no day-close wait for a feed); units = the keeper's carry arithmetic", async () => {
    const t = await launch(DEBT_RULE, "DEFICIT2", "2026-09-30"); program.deposit(t.mint, BigInt(3_000_000_000));
    const r = await runCycle(deps);
    assert.ok(r.fetched[0].written >= 5);
    const recs = reg.receipts(t.mint);
    const oct8 = recs.find((x) => x.eventId === "2026-10-08")!;
    assert.equal(oct8.units, 21); assert.notEqual(oct8.carryIn, "0", "carry threaded from 10-07");
    assert.equal(oct8.status, "confirmed"); assert.equal(oct8.readingDate, 20261008);
    assert.equal(parseProgramMemo(oct8.memo!)!.units, 21);
    assert.equal(program.fake(t.mint).cfg.fractionPerUnitBps, 500);
  });
  test("vault mode (one token count per unit): crank_vault burns units × tokens from the program's vault; a short vault carries the shortfall", async () => {
    const t = await launch(VAULT_EQUAL, "VBRONCO");
    program.fund(t.mint, BigInt(400_000) * BigInt(1_000_000));   // 400,000 tokens vested so far; each unit asks 1,000,000
    const r = await runCycle(deps);
    assert.deepEqual(r.executed.map((x) => x.outcome), ["confirmed", "confirmed"]);
    const yes = reg.receipt(t.mint, YES)!;
    assert.equal(yes.burnRaw, BigInt(400_000) * BigInt(1_000_000)); assert.equal(yes.shortOutRaw, BigInt(600_000) * BigInt(1_000_000)); assert.equal(yes.chainOutcome, "short");
    const no = reg.receipt(t.mint, NO)!;
    assert.equal(no.status, "confirmed", "onNo burns too in this rule"); assert.equal(no.burnRaw, BigInt(0), "the vault was empty: shortfall carried");
    assert.equal(no.shortOutRaw, BigInt(1_600_000) * BigInt(1_000_000), "600,000 carried + 1,000,000 owed");
    assert.match(yes.memo!, /^VBRONCO\|2026-09-28\|.*\|units=1\|burn=400000\|short=600000\|/);
  });
  test("NOT EXPRESSIBLE: a rule with different burns per outcome (onYes 1,000,000 / onNo 250,000) is held with the reason — never faked", async () => {
    assert.match(programExpressible(validateRule(VAULT_RULE), "VBRONCO")!, /different token counts/);
    const t = await launch(VAULT_RULE, "VBRONCO");
    const r = await runCycle(deps);
    assert.equal(r.executed[0].outcome, "waiting"); if (r.executed[0].outcome === "waiting") assert.match(r.executed[0].why, /not expressible on the program/);
    assert.equal(program.tokens.has(t.mint), false, "no on-chain config was ever built for it");
    const b = await buildLaunchBundle({ creator: CREATOR, ticker: "VB2", name: "v b", description: "", imageUrl: null, links: [], rule: VAULT_RULE, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true }, cluster: "devnet" }, { program, launchLab: new FakeLaunchLab(), devFeeWallet: "DevFeeWa11et111111111111111111111111111111", attesters: [ATTESTER], quorum: 1, metadataUri: (m) => `https://x/${m}.json` });
    assert.ok(b.pending.some((p) => /cannot run on the current burn_receipts program/.test(p)), "the launch bundle says so before launch");
  });
  test("dry run plans and signs nothing", async () => {
    const t = await launch(BRONCOS, "BRONCO"); program.deposit(t.mint, BigInt(5_000_000_000));
    const r = await runCycle({ ...deps, dryRun: true });
    assert.equal(r.executed[0].outcome, "dry-run"); assert.equal(program.fake(t.mint).signed.length, 0);
    assert.equal(reg.receipt(t.mint, YES)!.memo, null);
    assert.match(lines.join("\n"), /would attest the unit counter 1/);
  });
});

describe("the token page", () => {
  async function page() {
    const t = await launch(BRONCOS, "BRONCO"); program.deposit(t.mint, BigInt(5_000_000_000));
    await runCycle(deps);
    const locked = reg.lockedRule(t);
    const readings = reg.readings(t.selectorKey, t.baselineAt).filter((r) => readingMatches(locked.rule, r));
    const implied = await deps.oracles.kalshi.impliedChance(locked.rule, null);
    return { t, input: { token: reg.token(t.mint)!, locked, readings, receipts: reg.receipts(t.mint), attesters: reg.attesters(t.mint), state: reg.state(t.mint), feedState: reg.feedState(t.selectorKey), chain: { cluster: "devnet", programId: program.programId, supplyRaw: await program.supplyRaw(t.mint), feePdaLamports: await program.feePdaBalanceLamports(t.mint), vaultRaw: null }, now: clock, nextCheckAt: clock + 300_000, implied, seriesTitle: "NFL game winner", selectorPending: 0, operator: { can: ["crank a burn the rule computes"], cannot: ["change a rule"], placeholder: true }, pair: null } };
  }
  test("status.json: supply from the chain, burned, pool, fees (25 bps dev), attesters, disclosure; receipts.json verifies green; tampering turns it red", async () => {
    const { input } = await page();
    const receipts = buildReceiptsJson(input);
    const s = buildTokenStatus(input, receipts);
    assert.equal(s.supply.source, "chain"); assert.equal(s.burned.count, 1); assert.ok(Number(s.supply.current) < 1e9);
    assert.equal(s.fees.curve.legs[1].bps, 25); assert.equal(s.fees.creatorSliceBps, 0);
    assert.equal(s.attesters.length, 1); assert.equal(s.quorum, 1);
    assert.ok(s.disclosure.eventContract);
    assert.equal(receipts.length, 2);
    for (const r of receipts) assert.equal(r.verify.verified, true, `${r.eventId}: ${r.verify.checks.join("; ")}`);
    assert.match(receipts[0].verify.curl, /^curl -s 'https:\/\/api\.elections\.kalshi\.com\/trade-api\/v2\/markets\/KXNFLGAME-26SEP27LARDEN-DEN'/);
    assert.match(receipts[0].verify.formula, /result = yes, so spend 2% of the pool; counted into program reading 2026-09-28 \(1 unit from 1 receipt\)\. The program spends min\(pool × \(1 − \(1 − 200\/10000\)\^1\) \+ carried spend, 2% of the pool's SOL reserve\) = rule spend \d+ lamports/);
    assert.equal(s.health.unverified, 0);
    const tampered = buildReceiptsJson({ ...input, receipts: input.receipts.map((x, k) => (k === 0 ? { ...x, ruleSpendLamports: x.ruleSpendLamports! + BigInt(1) } : x)) });
    assert.equal(tampered[0].verify.verified, false); assert.ok(tampered[0].verify.checks.some((c) => /^rule spend: recomputed/.test(c)));
    const tampered2 = buildReceiptsJson({ ...input, receipts: input.receipts.map((x, k) => (k === 0 ? { ...x, spendLamports: x.spendLamports! + BigInt(1) } : x)) });
    assert.ok(tampered2[0].verify.checks.some((c) => /memo pool\/spent/.test(c)));
    // The program block: attestation (keys, quorum, last reading tx), queue, pool.
    const withProgram = { ...input, chain: { ...input.chain, program: await programPageBlock(program, input.token.mint, reg.lastProgramTx(input.token.mint, "reading")) } };
    const sp = buildTokenStatus(withProgram, buildReceiptsJson(withProgram));
    assert.equal(sp.program!.quorum, 1); assert.equal(sp.program!.quorumMet, true); assert.equal(sp.program!.attesters[0].key, ATTESTER);
    assert.equal(sp.program!.lastReading!.date, "2026-09-28"); assert.equal(sp.program!.pool.registered, true); assert.equal(sp.program!.queue.awaitingCrank, 0);
    assert.match(renderTokenHtml(sp, buildReceiptsJson(withProgram), input.readings), /The burn program/);
    JSON.parse(JSON.stringify(s)); JSON.parse(JSON.stringify(receipts));
  });
  test("the HTML: receipts table with oracle fields, verify blocks, the fee split per 1 SOL, the event-contract line, no price talk; the platform index lists it; publish writes the files", async () => {
    const { input, t } = await page();
    const receipts = buildReceiptsJson(input); const s = buildTokenStatus(input, receipts);
    const html = renderTokenHtml(s, receipts, input.readings);
    assert.match(html, /<title>\$BRONCO burn receipts<\/title>/);
    assert.match(html, /<th>Settled<\/th><th>Market \/ period<\/th><th>Result<\/th>/);
    assert.match(html, /KXNFLGAME-26SEP27LARDEN-DEN/);
    assert.match(html, /0\.0025 SOL to Burnticker \(developer\)/);
    assert.match(html, /regulated event contract/);
    assert.match(html, /This coin reads yes-or-no results\. 2 settled markets have been read: 1 YES, 1 NO and 0 void\./);
    assert.match(html, /prefers-color-scheme: dark/);
    const copy = html.replace(/<script>[\s\S]*?<\/script>/g, "");
    for (const bad of [/to the moon/i, /\bguarantee/i, /\breturns?\b/i, /price will (rise|go up|increase)/i, /\bprofit/i, /\binvest/i]) assert.doesNotMatch(copy, bad);
    const ix = buildPlatformIndex([s], clock);
    assert.equal(ix.totals.live, 1); assert.equal(ix.tokens[0].ticker, "BRONCO");
    const ixHtml = renderPlatformIndexHtml(ix);
    assert.match(ixHtml, /href="t\/BRONCO\/"/); assert.match(ixHtml, /settled results only, never prices/);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bt-site-"));
    publishTokenSite(dir, s, receipts, input.readings, t.rulesJson); publishPlatformIndex(dir, [s], clock);
    assert.deepEqual(fs.readdirSync(path.join(dir, "t", "BRONCO")).sort(), ["index.html", "receipts.json", "rules.json", "status.json"]);
    assert.equal(fs.readFileSync(path.join(dir, "t", "BRONCO", "rules.json"), "utf8"), t.rulesJson);
    assert.ok(fs.existsSync(path.join(dir, "index.html")));
  });
});

describe("counterRule defaults pass the program's swap-safety bounds (initialize_token validate_rule)", () => {
  test("a default buyback counter rule is accepted: deviation ≤ MAX_TWAP_DEVIATION_BPS, window in range, both tolerances cover the bucket margin", () => {
    const c = counterRule(validateRule(BRONCOS), "BRONCOS", "kalshi:KXNFLGAME:-DEN", { floorLamports: BigInt(1_000_000) });
    const r = c.rule;
    assert.ok(r.max_twap_deviation_bps >= 1 && r.max_twap_deviation_bps <= MAX_TWAP_DEVIATION_BPS, `deviation ${r.max_twap_deviation_bps}`);
    assert.ok(r.slippage_bps <= MAX_SLIPPAGE_BPS, `slippage ${r.slippage_bps}`);
    assert.ok(r.twap_window_secs >= MIN_TWAP_WINDOW_SECS && r.twap_window_secs <= MAX_TWAP_WINDOW_SECS, `window ${r.twap_window_secs}`);
    assert.ok(r.max_twap_deviation_bps * r.twap_window_secs >= TWAP_BUCKET_TOLERANCE_BPS_SECS);
    assert.ok(r.slippage_bps * r.twap_window_secs >= TWAP_BUCKET_TOLERANCE_BPS_SECS);
    assert.equal(r.twap_window_secs, 1_200, "the README's recommended window");
  });
  test("a vault counter rule carries no swap parameters (the program requires zeros)", () => {
    const c = counterRule(validateRule({ ...BRONCOS, binary: { onYes: { tokens: 1000000 }, onNo: null }, vault: { share: 0.25, vestDays: 365, cliffDays: 0 } }), "BRONCOS", "k", { floorLamports: BigInt(0) });
    assert.equal(c.rule.max_twap_deviation_bps, 0);
    assert.equal(c.rule.slippage_bps, 0);
    assert.equal(c.rule.twap_window_secs, 0);
  });
});
