// AUDIT A · F1 (prelaunch audits, 2026-10-15): one result could consume the burn pool twice. A submit_reading landed on chain but its
// confirmation RPC threw; the next execute pass of the SAME cycle read the already-advanced chain date, allocated D+1, looked up the
// wrong write-ahead key (reading:D+1, nothing there) and counted the same receipts again: counter 2/units 1, then 3/units 1, two burns.
// The keeper now resolves every outstanding `sent` reading signature (and the receipts its write-ahead row names) BEFORE it chooses a
// date, confirms signature + assignment in one transaction, and holds while an outcome is unknown.
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { openRegistry, type Registry, type TokenRow } from "@/lib/burnticker/registry";
import { FakeBurnProgram } from "@/lib/burnticker/program";
import { buildLaunchBundle, FakeLaunchLab } from "@/lib/burnticker/launchBundle";
import { CatalogueAdapter, feedById, loadFixture } from "@/lib/burnticker/catalogue";
import { runCycle, type KeeperDeps } from "@/lib/burnticker/multiKeeper";
import { KalshiClient, fixtureFetch } from "@/lib/burnticker/oracle/kalshi";
import { DEBT_RULE, NOW, treasuryAndCrossFetch } from "./burntickerHelpers.ts";
import { formatDate } from "@/lib/burnReceipts/math";

const CREATOR = "CreatorWa11et111111111111111111111111111111";
const ATTESTER = "KeeperDataKey1111111111111111111111111111111";
const DAY = 86_400_000;
const treasuryBody = loadFixture(feedById("treasury.debt")!).body;
let clock = NOW;
beforeEach(() => { clock = NOW; });

async function launch(reg: Registry, program: FakeBurnProgram): Promise<TokenRow> {
  const b = await buildLaunchBundle({ creator: CREATOR, ticker: "DEBT", name: "DEBT coin", description: "a test", imageUrl: null, links: [], rule: DEBT_RULE, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true }, cluster: "devnet" }, { program, launchLab: new FakeLaunchLab(), devFeeWallet: null, attesters: [ATTESTER], quorum: 1, metadataUri: (m) => `https://x/${m}.json` });
  const t = reg.register({ mint: b.mint, ticker: "DEBT", name: b.name, creator: CREATOR, description: b.description, imageUrl: null, links: [], rulesText: b.rules.text, feePda: b.addresses.feePda, vault: b.addresses.vault, tokenConfig: b.addresses.tokenConfig, poolId: b.addresses.poolId, launchTx: null, cluster: "devnet", platformId: b.addresses.platformId, baselineAt: "2026-10-01T00:00:00Z", status: "draft" }, clock);
  reg.markLaunched(t.mint, "launchDEBT", b.addresses.poolId, "2026-10-01T00:00:00Z");
  reg.addAttester({ mint: t.mint, pubkey: ATTESTER, role: "data-key", addedAt: clock - 10 * DAY, timelockUntil: null });
  program.supplies.set(t.mint, BigInt("1000000000000000")); program.deposit(t.mint, BigInt(10_000_000_000));
  return reg.token(t.mint)!;
}
const deps = (reg: Registry, program: FakeBurnProgram, lines: string[] = []): KeeperDeps => ({ registry: reg, program, oracles: { kalshi: new KalshiClient({ fetchImpl: fixtureFetch({}), now: () => clock, minIntervalMs: 0 }), catalogue: new CatalogueAdapter({ fetchImpl: treasuryAndCrossFetch(treasuryBody), now: () => clock }) }, attester: ATTESTER, log: (s) => lines.push(s), now: () => clock, dryRun: false });
const snap = async (program: FakeBurnProgram, mint: string) => ({ counter: (await program.port(mint).config())!.lastValue, readings: (await program.port(mint).config())!.readings, pool: await program.feePdaBalanceLamports(mint), supply: program.supplies.get(mint) });
const isCountedReading = (program: FakeBurnProgram, mint: string, sig: string) => { const l = program.fake(mint).landed.get(sig); return !!l && l.payload.kind === "reading" && l.payload.prevDate !== 0; };
/** Every receipt with units sits in exactly one reading, and the ledger has no `sent` reading row left. */
function ledgerClean(reg: Registry, mint: string): void {
  const stale = reg.db.prepare("SELECT event_id FROM signatures WHERE mint=? AND event_id LIKE 'reading:%' AND status='sent'").all(mint);
  assert.deepEqual(stale, [], "no stale `sent` reading row");
  const confirmed = reg.db.prepare("SELECT event_id, memo FROM signatures WHERE mint=? AND event_id LIKE 'reading:%' AND status='confirmed'").all(mint) as { event_id: string; memo: string }[];
  const named = confirmed.flatMap((r) => (JSON.parse(r.memo) as { events: string[] }).events);
  assert.equal(new Set(named).size, named.length, "no event is named by two confirmed readings");
}

async function control() {
  const program = new FakeBurnProgram("devnet"); program.now = () => clock;
  const reg = openRegistry(":memory:");
  const t = await launch(reg, program);
  await runCycle(deps(reg, program));
  return { program, reg, t, after: await snap(program, t.mint) };
}

describe("F1 · a landed reading whose confirmation was lost is counted once", () => {
  test("lost confirmation, then the second execute pass of the SAME cycle: one event assignment, one burn, same spend as the control", async () => {
    const c = await control();
    assert.ok(c.after.counter > BigInt(1), "the control run attested a counted reading");
    const program = new FakeBurnProgram("devnet"); program.now = () => clock;
    const reg = openRegistry(":memory:");
    const t = await launch(reg, program);
    const fk = program.fake(t.mint), realConfirm = fk.confirm.bind(fk);
    let thrown = 0;
    fk.confirm = async (tx) => { if (!thrown && isCountedReading(program, t.mint, tx.signature)) { thrown++; throw new Error("getSignatureStatuses: 503 Service Unavailable"); } return realConfirm(tx); };
    await runCycle(deps(reg, program));
    assert.equal(thrown, 1, "the fault was injected after a counted reading landed");
    const fault = await snap(program, t.mint);
    assert.equal(fault.counter, c.after.counter, `counter: fault ${fault.counter} vs control ${c.after.counter}`);
    assert.equal(fault.readings, c.after.readings, "no extra reading on chain");
    assert.equal(fault.pool, c.after.pool, "the burn pool is spent once");
    assert.equal(fault.supply, c.after.supply, "the same tokens burned");
    ledgerClean(reg, t.mint);
    const dates = reg.receipts(t.mint).filter((b) => b.units > 0).map((b) => b.readingDate);
    assert.deepEqual(dates, c.reg.receipts(c.t.mint).filter((b) => b.units > 0).map((b) => b.readingDate), "each event assigned to the same reading as the control");
  });

  test("outcome unknown (signature status RPC down for the rest of the cycle): the keeper holds, sends no new reading, then resolves next cycle", async () => {
    const c = await control();
    const program = new FakeBurnProgram("devnet"); program.now = () => clock;
    const reg = openRegistry(":memory:");
    const t = await launch(reg, program);
    const fk = program.fake(t.mint), realConfirm = fk.confirm.bind(fk), realStatuses = fk.signatureStatuses.bind(fk);
    let down = false;
    fk.confirm = async (tx) => { if (!down && isCountedReading(program, t.mint, tx.signature)) { down = true; throw new Error("RPC 503"); } return realConfirm(tx); };
    fk.signatureStatuses = async (s) => { if (down) throw new Error("RPC 503"); return realStatuses(s); };
    const realSend = fk.send.bind(fk);
    let sentWhileUnknown = 0;
    fk.send = async (raw) => { if (down) sentWhileUnknown++; return realSend(raw); };
    const r1 = await runCycle(deps(reg, program));
    assert.equal(sentWhileUnknown, 0, "no transaction (no second reading, no crank) is sent while the first one's outcome is unknown");
    assert.ok(r1.executed.some((e) => e.outcome === "waiting"), "held as a wait");
    assert.equal(reg.db.prepare("SELECT COUNT(*) n FROM signatures WHERE mint=? AND event_id LIKE 'reading:%' AND status='sent'").get(t.mint)!.n, 1, "the landed reading is still unresolved");
    down = false;
    fk.signatureStatuses = realStatuses;
    await runCycle(deps(reg, program));
    await runCycle(deps(c.reg, c.program));
    const fault = await snap(program, t.mint), ctl = await snap(c.program, c.t.mint);
    assert.deepEqual(fault, ctl, "fault and control end equal");
    ledgerClean(reg, t.mint);
  });

  test("restart between journal writes (signature marked confirmed, receipts not yet assigned): the keeper repairs the assignment and counts nothing twice", async () => {
    const c = await control();
    const program = new FakeBurnProgram("devnet"); program.now = () => clock;
    const reg = openRegistry(":memory:");
    const t = await launch(reg, program);
    const fk = program.fake(t.mint), realConfirm = fk.confirm.bind(fk), realStatuses = fk.signatureStatuses.bind(fk);
    let down = false;
    fk.confirm = async (tx) => { if (!down && isCountedReading(program, t.mint, tx.signature)) { down = true; throw new Error("process killed"); } return realConfirm(tx); };
    fk.signatureStatuses = async (s) => { if (down) throw new Error("process killed"); return realStatuses(s); };
    await runCycle(deps(reg, program));
    // the crash state the old two-write path could leave: the first journal write (status) landed, the second (assignment) did not
    const sig = reg.db.prepare("SELECT signature FROM signatures WHERE mint=? AND event_id LIKE 'reading:%' AND status='sent'").get(t.mint) as { signature: string };
    reg.setSignatureStatus(sig.signature, "confirmed", null, 1);
    down = false; fk.signatureStatuses = realStatuses;
    // a restarted keeper (a fresh registry handle on the same rows is the same process state for :memory:)
    await runCycle(deps(reg, program));
    await runCycle(deps(c.reg, c.program));
    assert.deepEqual(await snap(program, t.mint), await snap(c.program, c.t.mint), "fault and control end equal");
    ledgerClean(reg, t.mint);
    assert.equal(reg.pending(t.mint).filter((b) => b.readingDate === null && b.units > 0).length, 0);
  });

  test("the signature and the receipt assignment are written in one transaction (confirmReading): a failed assignment leaves the row `sent`", async () => {
    const program = new FakeBurnProgram("devnet"); program.now = () => clock;
    const reg = openRegistry(":memory:");
    const t = await launch(reg, program);
    await runCycle({ ...deps(reg, program), dryRun: true });   // plans receipts, sends nothing
    const ids = reg.pending(t.mint).filter((b) => b.units > 0).map((b) => b.eventId);
    assert.ok(ids.length > 0);
    reg.recordSignature({ signature: "sigX", mint: t.mint, eventId: "reading:2026-10-02", memo: JSON.stringify({ events: ids }), burnRaw: BigInt(0), spendLamports: BigInt(0), blockhash: "h", lastValidBlockHeight: 10, sentAt: clock });
    reg.db.exec("CREATE TEMP TRIGGER crash_mid BEFORE UPDATE OF reading_date ON burns BEGIN SELECT RAISE(ABORT, 'crash'); END;");
    assert.throws(() => reg.confirmReading(t.mint, "sigX", 5, ids, 20261002, clock), /crash/);
    assert.equal(reg.signatures(t.mint, "reading:2026-10-02")[0].status, "sent", "the signature is not confirmed without its assignment");
    reg.db.exec("DROP TRIGGER crash_mid");
    reg.confirmReading(t.mint, "sigX", 5, ids, 20261002, clock);
    assert.equal(reg.signatures(t.mint, "reading:2026-10-02")[0].status, "confirmed");
    assert.ok(ids.every((id) => reg.receipts(t.mint).find((b) => b.eventId === id)!.readingDate === 20261002));
  });
  test("review (3): an RPC with no history answers null for the landed reading past its blockhash: the Reading account decides, nothing is counted twice", async () => {
    const c = await control();
    const program = new FakeBurnProgram("devnet"); program.now = () => clock;
    const reg = openRegistry(":memory:");
    const t = await launch(reg, program);
    const fk = program.fake(t.mint), realConfirm = fk.confirm.bind(fk), realStatuses = fk.signatureStatuses.bind(fk);
    let lost: string | null = null;
    fk.confirm = async (tx) => { if (!lost && isCountedReading(program, t.mint, tx.signature)) { lost = tx.signature; fk.height = 1_000_000_000; throw new Error("RPC 503"); } return realConfirm(tx); };
    // a non-archival fallback: the lost reading's status is null (no history); everything else is answered
    fk.signatureStatuses = async (sigs) => (await realStatuses(sigs)).map((x, k) => (sigs[k] === lost ? null : x));
    await runCycle(deps(reg, program));
    assert.ok(lost, "the fault was injected");
    const fault = await snap(program, t.mint);
    assert.equal(fault.counter, c.after.counter, `counter: fault ${fault.counter} vs control ${c.after.counter}`);
    assert.equal(fault.pool, c.after.pool, "the burn pool is spent once");
    assert.equal(reg.signatures(t.mint, reg.db.prepare("SELECT event_id FROM signatures WHERE signature=?").get(lost!)!.event_id as string)[0].status, "confirmed");
    ledgerClean(reg, t.mint);
  });

  test("review (3): a Reading on chain with ANOTHER value and an unreadable status holds and alerts, it never re-dates", async () => {
    const program = new FakeBurnProgram("devnet"); program.now = () => clock;
    const reg = openRegistry(":memory:");
    const t = await launch(reg, program);
    await runCycle({ ...deps(reg, program), dryRun: true });
    const pend = reg.pending(t.mint).filter((b) => b.units > 0);
    const D = Number(pend[0].settledAt.slice(0, 10).replace(/-/g, ""));
    const port = program.port(t.mint);
    const fakeReading = port.reading.bind(port);
    program.fake(t.mint).reading = async (d: number) => (d === D ? { ...(await fakeReading(d)), recordDate: D, prevDate: 0, value: BigInt(999), processed: false } as never : fakeReading(d));
    reg.recordSignature({ signature: "sigQ", mint: t.mint, eventId: `reading:${formatDate(D)}`, memo: JSON.stringify({ events: [pend[0].eventId], value: "2" }), burnRaw: BigInt(0), spendLamports: BigInt(0), blockhash: "h", lastValidBlockHeight: 0, sentAt: clock });
    program.fake(t.mint).height = 10;
    const before = (await program.port(t.mint).config())!.readings;
    const r = await runCycle(deps(reg, program));
    assert.equal((await program.port(t.mint).config())!.readings, before, "nothing attested");
    assert.equal(reg.signatures(t.mint, `reading:${formatDate(D)}`)[0].status, "sent", "not marked expired");
    assert.ok(r.executed.some((e) => e.outcome === "waiting" && /does not carry the value/.test(e.why)));
    assert.ok(reg.alertsSince(0).some((a) => a.kind === "reading-unresolved"));
  });
});
