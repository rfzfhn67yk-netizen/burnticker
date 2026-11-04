// FOURTH PRELAUNCH AUDIT F10 (2026-10-18, medium): a carried piece reconciled after a restart, while its transaction's memo cannot be
// read, used to be recorded with the WHOLE change in the coin's carried balance as its own spend (audit repro: a 20,000,000-lamport
// piece recorded as 60,000,000 because another cranker drained the other 40,000,000 in between). The fix keeps two things apart:
//   · the debts and the plan reconcile to the chain's carried balance (an aggregate; any account change may move them);
//   · a piece's receipt says only what its own transaction's memo says (clamped to the piece's requested maximum). Until that memo is
//     read the receipt is pending with no amount, and the keeper reads it again on later wakes.
// The fixture: one coin with 0.1 SOL carried, ONE piece for all of it (owner decision 2026-10-25: no per-run bound, so a piece asks for the
// whole carry) signed and sent but its confirmation lost (a restart), then the chain changes.
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { openRegistry, type Registry } from "@/lib/burnticker/registry";
import { FakeBurnProgram } from "@/lib/burnticker/program";
import { buildLaunchBundle, FakeLaunchLab } from "@/lib/burnticker/launchBundle";
import { KalshiClient, fixtureFetch, settledMarketsUrl, seriesApiUrl, openMarketsUrl } from "@/lib/burnticker/oracle/kalshi";
import { CatalogueAdapter, feedById, loadFixture } from "@/lib/burnticker/catalogue";
import { runCycle, type KeeperDeps } from "@/lib/burnticker/multiKeeper";
import { PENDING_GIVE_UP_MS, runDispersal, type DispersalAlert, type DispersalDeps } from "@/lib/burnticker/dispersalKeeper";
import { keepReceipts, RECEIPTS_KEPT, stateFromJson, stateToJson, type DispersalReceipt, type DispersalState } from "@/lib/burnticker/dispersal";
import { PUSH_KIND_OF_ALERT } from "@/lib/burnticker/push";
import type { ProgramPort, SignedTx } from "@/lib/burnKeeper/programPort";
import type { FakeProgram } from "@/lib/burnKeeper/fakeProgram";
import { BRONCOS, NOW, fx, treasuryAndCrossFetch } from "./burntickerHelpers.ts";

const CREATOR = "CreatorWa11et111111111111111111111111111111";
const ATTESTER = "KeeperDataKey1111111111111111111111111111111";
const SOL = BigInt(1_000_000_000);
const Z = BigInt(0);
const table = {
  [settledMarketsUrl("KXNFLGAME")]: fx("kalshi/KXNFLGAME.settled.json"), [seriesApiUrl("KXNFLGAME")]: fx("kalshi/series.KXNFLGAME.json"), [openMarketsUrl("KXNFLGAME")]: { cursor: "", markets: [] },
};
const treasuryBody = loadFixture(feedById("treasury.debt")!).body;

let reg: Registry, program: FakeBurnProgram, deps: KeeperDeps, clock: number;
beforeEach(() => {
  reg = openRegistry(":memory:"); program = new FakeBurnProgram("devnet"); program.now = () => clock; clock = NOW;
  deps = { registry: reg, program, oracles: { kalshi: new KalshiClient({ fetchImpl: fixtureFetch(table), now: () => clock, minIntervalMs: 0 }), catalogue: new CatalogueAdapter({ fetchImpl: treasuryAndCrossFetch(treasuryBody), now: () => clock }) }, attester: ATTESTER, log: () => {}, now: () => clock, dryRun: false, dispersal: false };
});

/** Forwards everything to the fake except the named overrides (`this` stays the fake). */
const port = (f: FakeProgram, over: Partial<Record<keyof ProgramPort, unknown>>): ProgramPort =>
  new Proxy(f, { get(t, k) { if (k in over) return over[k as keyof ProgramPort]; const v = Reflect.get(t, k, t); return typeof v === "function" ? v.bind(t) : v; } }) as unknown as ProgramPort;
const sec = (ms: number) => Math.floor(ms / 1000);

/**
 * A Broncos coin with 0.1 SOL carried (its pool was untradeable for 30 days, so the reading was processed with its whole target carried;
 * the pool trades again); the keeper's piece for the whole carry is signed and sent but the send is dropped, so the piece is on record in
 * flight (the write-ahead), exactly as a restart finds it. Returns the harness and the piece's signature and size.
 */
async function inFlight() {
  const b = await buildLaunchBundle({ creator: CREATOR, ticker: "BRONCO", name: "BRONCO coin", description: "a test", imageUrl: null, links: [], rule: BRONCOS, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true }, cluster: "devnet" }, { program, launchLab: new FakeLaunchLab(), devFeeWallet: null, attesters: [ATTESTER], quorum: 1, metadataUri: (m) => `https://x/${m}.json` });
  const t = reg.register({ mint: b.mint, ticker: "BRONCO", name: b.name, creator: CREATOR, description: b.description, imageUrl: null, links: [], rulesText: b.rules.text, feePda: b.addresses.feePda, vault: b.addresses.vault, tokenConfig: b.addresses.tokenConfig, poolId: b.addresses.poolId, launchTx: null, cluster: "devnet", platformId: b.addresses.platformId, baselineAt: "2026-09-01T00:00:00Z", status: "draft" }, clock);
  reg.markLaunched(t.mint, "launchBRONCO", b.addresses.poolId, "2026-09-01T00:00:00Z");
  reg.addAttester({ mint: t.mint, pubkey: ATTESTER, role: "data-key", addedAt: clock, timelockUntil: null });
  if (program.tokens.has(t.mint)) program.supplies.set(t.mint, BigInt("1000000000000000"));
  program.deposit(t.mint, BigInt(5) * SOL);
  const f = program.fake(t.mint);
  f.poolReserveWsol = BigInt(2) * SOL;
  const s0 = sec(clock);
  f.poolTradable = false;
  f.cfg = { ...f.cfg, poolUntradeableSince: s0 - 31 * 86_400, poolUntradeableLastSeen: s0 - 3_600 };
  await runCycle(deps);                                   // the reading is processed with its whole 0.1 SOL target carried
  f.poolTradable = true;
  const carried = f.cfg.carriedSpendLamports;
  assert.equal(carried, SOL / BigInt(10));
  let json: string | null = null;
  const log: string[] = [];
  const alerts: DispersalAlert[] = [];
  const run = (p: ProgramPort = f, dryRun = false) => runDispersal({ port: p, mint: f.mint, ticker: "BRONCO", load: () => json, save: (j) => { json = j; }, log: (l) => log.push(l), now: () => clock, dryRun, alert: (a) => { alerts.push(a); } } satisfies DispersalDeps);
  const state = (): DispersalState => stateFromJson(json);
  f.dropSends = true;
  const sent = await run();
  assert.equal(sent.action, "sent", sent.why);
  const fl = state().inflight!;
  assert.ok(fl, "the piece is on record in flight");
  assert.equal(fl.lamports, carried, "one piece asks for the whole carry");
  f.dropSends = false;
  return { t, f, run, state, log, alerts, carried, sig: fl.signature, lamports: fl.lamports, setState: (s: DispersalState) => { json = stateToJson(s); } };
}

/** Someone else's crank_carried piece of at most `maxSpend` (permissionless), in an earlier second than the last piece. */
function foreignPiece(f: FakeProgram, maxSpend: bigint): string {
  f.lastCarriedAt = sec(clock) - 100;
  const before = f.cfg.carriedSpendLamports;
  const tx = (f as unknown as { mk(p: unknown): SignedTx }).mk({ kind: "carried", maxSpend });
  f.land(tx.signature);
  assert.ok(f.cfg.carriedSpendLamports < before, "the foreign piece landed");
  clock += 1_000;   // the program takes one piece per coin per second
  return tx.signature;
}

/** The part of the 0.1 SOL carry another cranker spends first. */
const PART = BigInt(40_000_000);
const noMemo = (f: FakeProgram) => port(f, { memoOf: async () => null });
const debtLeft = (s: DispersalState) => s.debts.reduce((a, d) => a + d.remainingLamports, Z);

describe("audit F10: a piece's receipt never takes the whole carried-balance change as its own spend", () => {
  test("missing memo + a foreign crank in between: the receipt is pending with no amount; the debts still reconcile to the chain", async () => {
    const h = await inFlight();
    foreignPiece(h.f, PART);                               // another cranker spends part of the carry first
    h.f.land(h.sig);                                       // our piece lands after all: it spends what was left
    assert.equal(h.f.cfg.carriedSpendLamports, Z);
    clock += 5 * 60_000;
    await h.run(noMemo(h.f));                              // the restart's resolve, with the transaction not readable yet
    const st = h.state();
    assert.equal(st.inflight, null, "the piece is final: no second piece waits on it");
    const r = st.receipts.find((x) => x.signature === h.sig)!;
    assert.ok(r, "the landed piece has its own receipt");
    assert.equal(r.status, "pending");
    assert.equal(r.spentLamports, null, `not the account delta ${h.carried} (asked at most ${h.lamports})`);
    assert.equal(r.requestedLamports, h.lamports);
    assert.equal(debtLeft(st), h.f.cfg.carriedSpendLamports, "the aggregate debt is the chain's carried amount");
    assert.equal(st.debts.length, 0);
    assert.ok(h.log.some((l) => /landed after a restart: spend not yet read/.test(l)), h.log.join("\n"));
    assert.ok(!h.log.some((l) => /landed after a restart: \d/.test(l)), "no inferred number in the log");
  });

  test("the memo arrives on a later wake: the same receipt is completed with the transaction's exact amount", async () => {
    const h = await inFlight();
    foreignPiece(h.f, PART);
    h.f.land(h.sig);
    clock += 5 * 60_000;
    await h.run(noMemo(h.f));
    assert.equal(h.state().receipts.find((x) => x.signature === h.sig)!.status, "pending");
    clock += 5 * 60_000;
    await h.run(noMemo(h.f));                              // still unreadable: still pending, read again later
    assert.equal(h.state().receipts.find((x) => x.signature === h.sig)!.spentLamports, null);
    clock += 5 * 60_000;
    await h.run();                                         // the RPC has the parsed transaction now
    const r = h.state().receipts.find((x) => x.signature === h.sig)!;
    assert.equal(r.status, "landed");
    const own = h.carried - PART;
    assert.equal(r.spentLamports, own, "exactly the piece's own spend, from its memo (not the request, not the balance change)");
    assert.notEqual(own, h.lamports);
    assert.match(r.memo!, new RegExp(`\\|carried\\|.*\\|spent=${own}\\|`));
    assert.equal(h.state().receipts.filter((x) => x.signature === h.sig).length, 1, "one receipt per signature");
    assert.ok(h.log.some((l) => /spend is now read: 0\.\d{4} SOL/.test(l)), h.log.join("\n"));
  });

  test("a new reading adds carry between the write-ahead snapshot and the reconcile: the receipt is pending, never zero or the delta", async () => {
    const h = await inFlight();
    h.f.land(h.sig);
    // a stranger submits and cranks a further unit day on a pool that is untradeable again: the carried balance moves up from zero
    const s1 = sec(clock);
    h.f.poolTradable = false;
    h.f.cfg = { ...h.f.cfg, poolUntradeableSince: s1 - 31 * 86_400, poolUntradeableLastSeen: s1 - 3_600 };
    const prev = h.f.cfg.lastRecordDate, value = h.f.cfg.lastValue;
    const tx = await h.f.buildReading({ recordDate: 20260929, prevDate: prev, value: value + BigInt(1), sourceUrl: "burnticker://BRONCO/units/2026-09-29", feedId: h.f.cfg.feedId, valueDecimals: h.f.cfg.valueDecimals });
    await h.f.send(tx.raw);
    assert.ok(h.f.strangerCrank());
    assert.ok(h.f.cfg.carriedSpendLamports > Z, "carried again after our piece emptied it");
    assert.notEqual(h.carried - h.f.cfg.carriedSpendLamports, h.lamports, "the balance change is not the piece's spend");
    clock += 5 * 60_000;
    await h.run(noMemo(h.f));
    const st = h.state();
    const r = st.receipts.find((x) => x.signature === h.sig)!;
    assert.equal(r.status, "pending");
    assert.equal(r.spentLamports, null);
    assert.equal(debtLeft(st), h.f.cfg.carriedSpendLamports, "the debts follow the chain's carried amount, the new reading included");
    clock += 5 * 60_000;
    await h.run();
    assert.equal(h.state().receipts.find((x) => x.signature === h.sig)!.spentLamports, h.lamports);
  });

  test("the end path disposes of the carry in between: the receipt is pending, the debts clear to the chain's zero", async () => {
    const h = await inFlight();
    h.f.land(h.sig);
    h.f.cfg = { ...h.f.cfg, carriedSpendLamports: Z };     // the rule's end path (after the grace) cleared what was left
    clock += 5 * 60_000;
    await h.run(noMemo(h.f));
    const st = h.state();
    const r = st.receipts.find((x) => x.signature === h.sig)!;
    assert.equal(r.status, "pending");
    assert.equal(r.spentLamports, null, `not the whole ${h.carried - Z} the carried balance moved`);
    assert.equal(st.debts.length, 0, "nothing is owed: the chain says nothing is carried");
    clock += 5 * 60_000;
    await h.run();
    assert.equal(h.state().receipts.find((x) => x.signature === h.sig)!.spentLamports, h.lamports);
  });

  test("a memo that names more than the piece asked for is clamped to the requested maximum", async () => {
    const h = await inFlight();
    h.f.land(h.sig);
    const memo = (await h.f.memoOf(h.sig))!.replace(/\|spent=\d+\|/, `|spent=${h.lamports * BigInt(3)}|`);
    clock += 5 * 60_000;
    await h.run(port(h.f, { memoOf: async () => memo }));
    const r = h.state().receipts.find((x) => x.signature === h.sig)!;
    assert.equal(r.status, "landed");
    assert.equal(r.spentLamports, h.lamports);
    assert.equal(r.clamped, true, "the receipt is marked, not silently corrected");
    assert.ok(h.log.some((l) => /more than the piece asked for/.test(l)), h.log.join("\n"));
    const a = h.alerts.filter((x) => x.kind === "bt-dispersal-receipt");
    assert.equal(a.length, 1);
    assert.equal(a[0].key, `${h.f.mint}:${h.sig}:clamped`);
    assert.ok(a[0].text.includes("$BRONCO") && a[0].text.includes(h.sig) && /more than the piece asked for/.test(a[0].text), a[0].text);
    assert.equal(PUSH_KIND_OF_ALERT[a[0].kind], "dispersal-receipt", "it reaches the phone");
  });

  test("a pending receipt completed later from a memo over the request is clamped, marked and alerted too", async () => {
    const h = await inFlight();
    h.f.land(h.sig);
    clock += 5 * 60_000;
    await h.run(noMemo(h.f));
    const memo = (await h.f.memoOf(h.sig))!.replace(/\|spent=\d+\|/, `|spent=${h.lamports + BigInt(1)}|`);
    clock += 5 * 60_000;
    await h.run(port(h.f, { memoOf: async () => memo }));
    const r = h.state().receipts.find((x) => x.signature === h.sig)!;
    assert.deepEqual([r.status, r.spentLamports, r.clamped], ["landed", h.lamports, true]);
    assert.equal(h.alerts.filter((x) => x.key === `${h.f.mint}:${h.sig}:clamped`).length, 1);
  });

  test("an unreadable memo is looked up a bounded number of times over three days, then given up with one alert", async () => {
    const h = await inFlight();
    h.f.land(h.sig);
    let lookups = 0;
    const counting = port(h.f, { memoOf: async (s: string) => { if (s === h.sig) lookups++; return null; } });
    const start = clock + 5 * 60_000;
    for (clock = start; clock <= start + PENDING_GIVE_UP_MS + 24 * 3_600_000; clock += 5 * 60_000) await h.run(counting);
    const r = h.state().receipts.find((x) => x.signature === h.sig)!;
    assert.equal(r.status, "pending");
    assert.equal(r.spentLamports, null);
    assert.ok(r.gaveUpAt, "given up");
    assert.equal(r.tries, lookups, "every lookup counted");
    assert.ok(lookups >= 10 && lookups <= 25, `backoff: ${lookups} lookups in four days of five-minute wakes, not ${(PENDING_GIVE_UP_MS + 24 * 3_600_000) / 300_000}`);
    const mine = h.alerts.filter((x) => x.kind === "bt-dispersal-receipt" && x.key === `${h.f.mint}:${h.sig}:unread`);
    assert.equal(mine.length, 1, "one alert");
    assert.ok(mine[0].text.includes("$BRONCO") && mine[0].text.includes(h.sig) && /spend not read/.test(mine[0].text), mine[0].text);
    // after giving up: no more lookups
    const after = lookups;
    for (let i = 0; i < 100; i++) { clock += 3_600_000; await h.run(counting); }
    assert.equal(lookups, after);
  });

  test("a dry run does not look up pending memos", async () => {
    const h = await inFlight();
    h.f.land(h.sig);
    clock += 5 * 60_000;
    await h.run(noMemo(h.f));
    assert.equal(h.state().receipts.find((x) => x.signature === h.sig)!.status, "pending");
    let lookups = 0;
    const counting = port(h.f, { memoOf: async () => { lookups++; return null; } });
    clock += 3_600_000;
    await h.run(counting, true);
    assert.equal(lookups, 0);
    assert.equal(h.state().receipts.find((x) => x.signature === h.sig)!.tries, 1, "the dry run left the receipt as it was");
    await h.run(counting);
    assert.ok(lookups >= 1, "the live wake reads it");
    assert.equal(h.state().receipts.find((x) => x.signature === h.sig)!.tries, 2, "the live wake counted one more try on the pending receipt");
  });

  test("the piece confirmed in the same wake with its memo unreadable: pending too, not the delta and not the request", async () => {
    const h = await inFlight();
    // a fresh piece: drop the in-flight one by expiring it, then let the next one confirm while its memo is unreadable
    h.f.height = h.state().inflight!.lastValidBlockHeight + 1;
    clock += 5 * 60_000;
    // the same wake releases the expired piece and sends a fresh one for the whole carry, which confirms at once
    const r = await h.run(noMemo(h.f));
    assert.equal(h.state().inflight, null);
    assert.equal(r.action, "landed", r.why);
    assert.equal(r.spentLamports, undefined, "the report names no amount it has not read");
    const rc = h.state().receipts.find((x) => x.signature === r.signature)!;
    assert.equal(rc.status, "pending");
    assert.equal(rc.spentLamports, null);
    assert.ok(h.log.some((l) => /spend not yet read/.test(l)), h.log.join("\n"));
  });
});

describe("audit F10: stored receipts", () => {
  test("receipts stored before F10 (no status, bigint as a string) load as landed with their amount", () => {
    const old = JSON.stringify({ window: null, debts: [], cursor: 20260928, inflight: null, alerted: null, retryAt: null,
      receipts: [{ signature: "oldSig1", at: 1, spentLamports: "20000000n", throughDate: 20260928, memo: "BRONCO|carried|through=2026-09-28|spent=20000000|", slot: 5 }] });
    const r = stateFromJson(old).receipts[0];
    assert.equal(r.status, "landed");
    assert.equal(r.spentLamports, BigInt(20_000_000));
    assert.equal(r.requestedLamports, undefined);
  });

  test("keepReceipts drops the oldest landed receipts first and keeps a pending one, however old", () => {
    const mk = (i: number, status: DispersalReceipt["status"]): DispersalReceipt => ({ signature: `s${i}`, at: i, spentLamports: status === "landed" ? BigInt(i) : null, status, throughDate: 0, memo: null, slot: null });
    const rs = [mk(0, "pending"), ...Array.from({ length: RECEIPTS_KEPT + 4 }, (_, i) => mk(i + 1, "landed"))];
    const kept = keepReceipts(rs);
    assert.equal(kept.length, RECEIPTS_KEPT);
    assert.equal(kept[0].signature, "s0", "the pending receipt stays");
    assert.ok(!kept.some((r) => ["s1", "s2", "s3", "s4", "s5"].includes(r.signature)), "the five oldest landed went");
    assert.equal(kept[kept.length - 1].signature, `s${RECEIPTS_KEPT + 4}`);
    assert.deepEqual(keepReceipts(rs.slice(0, 3)), rs.slice(0, 3), "under the cap nothing changes");
  });
});
