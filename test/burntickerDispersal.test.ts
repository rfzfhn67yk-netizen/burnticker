// BURN DISPERSAL — THE PURE STEP (owner decision 2026-10-13 night, simplified by the owner decision of 2026-10-25;
// src/lib/burnticker/dispersal.ts). With no per-run bound and no carried budget the step is one piece for the whole carried amount as
// soon as the queue is empty; the per-reading debts and the 24-hour alert are unchanged; a state saved with an old six-hour window still
// loads (the window is ignored) — all with fake clocks.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { addReading, behind, debtLine, dispersalEnabled, dispersalLine, priceMovePct, QUEUE_WAIT_MS, reconcile, stateFromJson, stateToJson, step, EMPTY_STATE } from "@/lib/burnticker/dispersal";
import * as dispersal from "@/lib/burnticker/dispersal";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";

const SOL = BigInt(1_000_000_000);
const sol = (x: number) => BigInt(Math.round(x * 1e9));
const T0 = Date.parse("2026-10-14T00:00:00Z");
const H = 3_600_000;

describe("the step: the whole carried amount in one piece", () => {
  test("nothing carried is idle; a waiting reading waits a minute; otherwise one crank of everything carried", () => {
    assert.deepEqual(step({ now: T0, carriedLamports: BigInt(0), queueEmpty: true }), { kind: "idle", why: "nothing carried" });
    const w = step({ now: T0, carriedLamports: sol(5), queueEmpty: false });
    assert.equal(w.kind, "wait"); assert.equal(w.kind === "wait" && w.untilMs, T0 + QUEUE_WAIT_MS);
    assert.match(w.kind === "wait" ? w.why : "", /a reading is waiting for its own crank/);
    assert.deepEqual(step({ now: T0, carriedLamports: sol(5), queueEmpty: true }), { kind: "crank", lamports: sol(5) });
  });
  test("a carry far above 2 % of any reserve (50 SOL) still goes in ONE piece: there is no per-run bound any more", () => {
    assert.deepEqual(step({ now: T0, carriedLamports: sol(50), queueEmpty: true }), { kind: "crank", lamports: sol(50) });
    // the old small-pool cases (THUVSPURS 114M, CHIVASOK 51M on 0.613 SOL pools) are one whole-remainder piece each, never stuck
    for (const c of [BigInt(114_000_000), BigInt(51_000_000), BigInt(1)]) assert.deepEqual(step({ now: T0, carriedLamports: c, queueEmpty: true }), { kind: "crank", lamports: c });
  });
  test("the window, gap, depth and budget planners are gone from the module (owner decision 2026-10-25)", () => {
    for (const name of ["planWindow", "chunkCeiling", "pieceSize", "stuckWhy", "budgetGapMs", "markChunk", "nextDueAt", "rng", "seedOf", "PROGRAM_BUDGET_WINDOW_MS"]) assert.equal(name in dispersal, false, name);
  });
  test("priceMovePct is still the constant-product move of a buy (for pages that explain a large burn)", () => {
    assert.ok(Math.abs(priceMovePct(sol(1), sol(99)) - (1 / 0.99 ** 2 - 1) * 100) < 1e-9);
  });
});

describe("debts and the 24-hour alert", () => {
  test("a reading's own spend is tracked; earlier carried amounts are paid first; the chain's carried amount is the record", () => {
    let d = addReading([], { readingDate: 20261014, landedAt: T0, spentLamports: sol(1.7), carriedInLamports: BigInt(0), carriedOutLamports: sol(3.3) });
    assert.deepEqual(d, [{ readingDate: 20261014, landedAt: T0, totalLamports: sol(5), remainingLamports: sol(3.3) }]);
    assert.equal(debtLine(d[0]), "spent 1.7 of 5 SOL for the reading of 2026-10-14; remainder being spent");
    d = reconcile(d, sol(2.3), 20261014, T0 + H);   // a 1 SOL piece landed
    assert.equal(d[0].remainingLamports, sol(2.3));
    // a second reading: its crank spends 1.75 (paying the older 1.75 first) and carries the rest
    d = addReading(d, { readingDate: 20261015, landedAt: T0 + 24 * H, spentLamports: sol(1.75), carriedInLamports: sol(2.3), carriedOutLamports: sol(2.3 - 1.75 + 4) });
    assert.deepEqual(d.map((x) => [x.readingDate, x.remainingLamports]), [[20261014, sol(0.55)], [20261015, sol(4)]]);
    assert.equal(d[1].totalLamports, sol(4));
    d = reconcile(d, sol(4), 20261015, T0 + 25 * H);
    assert.deepEqual(d.map((x) => x.readingDate), [20261015], "fully paid readings drop off");
  });
  test("a reading that spent its whole share in one run (carried out 0) leaves no debt", () => {
    assert.deepEqual(addReading([], { readingDate: 20261014, landedAt: T0, spentLamports: sol(5), carriedInLamports: BigInt(0), carriedOutLamports: BigInt(0) }), []);
  });
  test("an amount the debts do not explain becomes a debt of the cursor's date", () => {
    const d = reconcile([], sol(2), 20261010, T0);
    assert.deepEqual(d, [{ readingDate: 20261010, landedAt: T0, totalLamports: sol(2), remainingLamports: sol(2) }]);
  });
  test("behind: the oldest reading not fully spent 24 hours after it landed", () => {
    const d = addReading([], { readingDate: 20261014, landedAt: T0, spentLamports: sol(1), carriedInLamports: BigInt(0), carriedOutLamports: sol(20) });
    assert.equal(behind(d, T0 + 23 * H), null);
    assert.equal(behind(d, T0 + 24 * H)?.readingDate, 20261014);
    assert.equal(behind(reconcile(d, BigInt(0), 20261014, T0 + 24 * H), T0 + 25 * H), null);
  });
  test("the page line passes the copy lint (no price talk, no promises)", () => {
    const cfg = loadCopyLintConfig();
    const d = addReading([], { readingDate: 20261014, landedAt: T0, spentLamports: sol(1.7), carriedInLamports: BigInt(0), carriedOutLamports: sol(3.3) });
    const line = debtLine(d[0]);
    assert.ok(lintCopy(line, cfg).ok, JSON.stringify(lintCopy(line, cfg).hits));
    assert.doesNotMatch(line, /\bprice\b|\bwill\b/i);
  });
});

describe("state and flag", () => {
  test("the state survives a JSON round trip with its bigints", () => {
    const st = { ...EMPTY_STATE, retryAt: T0, debts: [{ readingDate: 1, landedAt: 2, totalLamports: SOL, remainingLamports: SOL }] };
    assert.deepEqual(stateFromJson(stateToJson(st)), st);
    assert.deepEqual(stateFromJson(null), EMPTY_STATE);
    assert.deepEqual(stateFromJson("{not json"), EMPTY_STATE);
  });
  test("a state saved before 2026-10-25 (a six-hour window, an inflight chunk index) loads; the window is dropped, the rest kept", () => {
    const old = JSON.stringify({
      window: { startMs: T0, endMs: T0 + 6 * H, seed: 7, chunks: [{ atMs: T0 + H, lamports: "24540000n" }], done: 0, expectedCarried: "51000000n", lastAtMs: null, stuck: null },
      debts: [{ readingDate: 20261014, landedAt: T0, totalLamports: "51000000n", remainingLamports: "51000000n" }],
      cursor: 20261014, alerted: null, retryAt: null,
      inflight: { signature: "sigOld", lastValidBlockHeight: 99, lamports: "24540000n", carriedBefore: "51000000n", sentAt: T0, chunkIndex: 3 },
      receipts: [{ signature: "s1", at: T0, spentLamports: "1n", throughDate: 20261014, memo: null, slot: 5 }],
    });
    const s = stateFromJson(old);
    assert.equal("window" in s, false);
    assert.deepEqual(s.inflight, { signature: "sigOld", lastValidBlockHeight: 99, lamports: BigInt(24_540_000), carriedBefore: BigInt(51_000_000), sentAt: T0 });
    assert.equal(s.debts[0].remainingLamports, BigInt(51_000_000));
    assert.equal(s.receipts[0].status, "landed");
    assert.equal(stateToJson(s).includes("window"), false, "the old window is not written back");
  });
  test("BURNTICKER_DISPERSAL=1 turns it on; anything else is off", () => {
    assert.equal(dispersalEnabled({ BURNTICKER_DISPERSAL: "1" }), true);
    assert.equal(dispersalEnabled({}), false);
    assert.equal(dispersalEnabled({ BURNTICKER_DISPERSAL: "true" }), false);
  });
  test("the ops line says one piece, not six-hour windows", () => {
    const line = dispersalLine({ on: true, source: "flag-on", crankCarried: true });
    assert.equal(line, "burn dispersal: on (BURNTICKER_DISPERSAL=1): a carried amount is spent in one crank_carried piece");
    assert.doesNotMatch(line, /window|6-hour/);
  });
});
