// BURN DISPERSAL — THE PURE SCHEDULER (owner decision 2026-10-13 night; src/lib/burnticker/dispersal.ts). Chunk sizing against the
// program's per-crank cap and the pool's depth, random intervals inside a 6-hour window from a seeded generator, rollover into further
// windows until the carried amount is zero, a second reading added mid-window, the per-reading debts and the 24-hour alert — all with
// fake clocks.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  addReading, behind, chunkCeiling, debtLine, DEPTH_PPM, DISPERSAL_MIN_GAP_MS, DISPERSAL_WINDOW_MS, dispersalEnabled, markChunk, nextDueAt, planWindow,
  priceMovePct, reconcile, rng, seedOf, stateFromJson, stateToJson, step, EMPTY_STATE, type DispersalWindow, type Observation,
} from "@/lib/burnticker/dispersal";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";

const SOL = BigInt(1_000_000_000);
const sol = (x: number) => BigInt(Math.round(x * 1e9));
const T0 = Date.parse("2026-10-14T00:00:00Z");
const H = 3_600_000;

/** Drives step() to zero with the chain modelled as: each piece lands in full, the reserve grows by each piece. */
function drain(carried0: bigint, reserve0: bigint, seed = 7, maxWakes = 10_000) {
  let carried = carried0, reserve = reserve0, w: DispersalWindow | null = null, now = T0;
  const pieces: { at: number; lamports: bigint; window: number; reserveBefore: bigint }[] = [];
  const windows: number[] = [];
  for (let i = 0; i < maxWakes && carried > BigInt(0); i++) {
    const r = step(w, { now, carriedLamports: carried, reserveLamports: reserve, queueEmpty: true, seed: seed + i });
    w = r.window;
    if (w && !windows.includes(w.startMs)) windows.push(w.startMs);
    if (r.action.kind === "crank") {
      pieces.push({ at: now, lamports: r.action.lamports, window: w!.startMs, reserveBefore: reserve });
      carried -= r.action.lamports; reserve += r.action.lamports;
      w = markChunk(w!, r.action.lamports);
      continue;
    }
    if (r.action.kind === "wait") now = r.action.untilMs; else break;
  }
  return { pieces, windows, carried };
}

describe("chunk sizing", () => {
  test("the ceiling is the smaller of the program's 2 % cap and the 1.227 % depth limit; a ceiling piece moves the pool under 2.5 %", () => {
    const r = sol(85);
    assert.equal(chunkCeiling(r), (r * BigInt(DEPTH_PPM)) / BigInt(1_000_000));
    assert.ok(chunkCeiling(r) < (r * BigInt(200)) / BigInt(10_000), "always under the per-crank cap");
    assert.equal(chunkCeiling(r, 100), r / BigInt(100), "a tighter cap wins");
    assert.ok(priceMovePct(chunkCeiling(r), r) < 2.5);
    assert.ok(priceMovePct((r * BigInt(200)) / BigInt(10_000), r) > 4, "a full 2 % piece moves about 4 %");
    assert.equal(chunkCeiling(BigInt(0)), BigInt(0));
  });
  test("a window's pieces are an even split, each at or under the ceiling, summing to what fits", () => {
    const w = planWindow({ carriedLamports: sol(5), reserveLamports: sol(85), now: T0, seed: 1 });
    const c = chunkCeiling(sol(85));
    assert.equal(w.chunks.length, 5);
    assert.equal(w.chunks.reduce((a, x) => a + x.lamports, BigInt(0)), sol(5));
    for (const x of w.chunks) assert.ok(x.lamports <= c);
    const spread = w.chunks.map((x) => x.lamports);
    assert.ok(spread.every((x) => x - spread[spread.length - 1] <= BigInt(1)), "even split, no dust tail");
  });
  test("a piece is never under the floor unless it is the whole remainder", () => {
    const w = planWindow({ carriedLamports: sol(0.003), reserveLamports: sol(0.2), now: T0, seed: 3, floorLamports: sol(0.002) });
    assert.equal(w.chunks.length, 1, "two 0.0015 pieces would be under the 0.002 floor: one piece of 0.0024 (the ceiling) instead");
  });
});

describe("timing", () => {
  test("random times inside the window, at least 20 minutes apart, reproducible from the seed and different across seeds", () => {
    const a = planWindow({ carriedLamports: sol(10), reserveLamports: sol(85), now: T0, seed: 42 });
    const b = planWindow({ carriedLamports: sol(10), reserveLamports: sol(85), now: T0, seed: 42 });
    const c = planWindow({ carriedLamports: sol(10), reserveLamports: sol(85), now: T0, seed: 43 });
    assert.deepEqual(a, b);
    assert.notDeepEqual(a.chunks.map((x) => x.atMs), c.chunks.map((x) => x.atMs));
    assert.equal(a.endMs - a.startMs, DISPERSAL_WINDOW_MS);
    for (const [i, x] of a.chunks.entries()) {
      assert.ok(x.atMs >= a.startMs && x.atMs < a.endMs, "inside the window");
      if (i) assert.ok(x.atMs - a.chunks[i - 1].atMs >= DISPERSAL_MIN_GAP_MS, "at least the minimum gap");
    }
    const gaps = a.chunks.slice(1).map((x, i) => x.atMs - a.chunks[i].atMs);
    assert.ok(new Set(gaps).size > 1, "not a fixed cadence");
  });
  test("at most floor(6 h / 20 min) = 18 pieces fit one window; the rest waits for the next", () => {
    const w = planWindow({ carriedLamports: sol(50), reserveLamports: sol(85), now: T0, seed: 9 });
    assert.equal(w.chunks.length, 18);
    assert.ok(w.chunks.reduce((a, x) => a + x.lamports, BigInt(0)) < sol(50));
  });
  test("the generator is seeded (mulberry32) and the seed of a string is stable", () => {
    const r1 = rng(5), r2 = rng(5);
    assert.deepEqual([r1(), r1(), r1()], [r2(), r2(), r2()]);
    assert.equal(seedOf("abc"), seedOf("abc"));
    assert.notEqual(seedOf("abc"), seedOf("abd"));
  });
  test("step: nothing is due before a piece's time; due → crank; the wake time is the next piece", () => {
    const o: Observation = { now: T0, carriedLamports: sol(2), reserveLamports: sol(85), queueEmpty: true, seed: 11 };
    const r = step(null, o);
    assert.ok(r.window && r.window.chunks.length === 2);
    const first = r.window.chunks[0].atMs;
    if (first > T0) assert.deepEqual(r.action, { kind: "wait", untilMs: first, why: "the next piece is not due yet" });
    const r2 = step(r.window, { ...o, now: first });
    assert.equal(r2.action.kind, "crank");
    assert.equal(nextDueAt(r.window), first);
  });
  test("a waiting reading holds the pieces (its own crank carries the owed spend in its target)", () => {
    const r = step(null, { now: T0, carriedLamports: sol(2), reserveLamports: sol(85), queueEmpty: false, seed: 1 });
    assert.equal(r.action.kind, "wait");
    assert.match((r.action as { why: string }).why, /waiting for its own crank/);
  });
  test("the live reserve re-clamps a due piece (the pool shrank since the plan)", () => {
    const r = step(null, { now: T0, carriedLamports: sol(1), reserveLamports: sol(85), queueEmpty: true, seed: 2 });
    const at = r.window!.chunks[0].atMs;
    const r2 = step(r.window, { now: at, carriedLamports: sol(1), reserveLamports: sol(20), queueEmpty: true, seed: 2 });
    assert.equal(r2.action.kind, "crank");
    assert.equal((r2.action as { lamports: bigint }).lamports, chunkCeiling(sol(20)));
  });
});

describe("rollover and changes", () => {
  test("window after window until the carried amount is zero (50 SOL on an 85 SOL pool)", () => {
    const { pieces, windows, carried } = drain(sol(50), sol(85));
    assert.equal(carried, BigInt(0));
    assert.ok(windows.length >= 3, `${windows.length} windows`);
    for (let i = 1; i < windows.length; i++) assert.ok(windows[i] - windows[i - 1] >= DISPERSAL_WINDOW_MS, "a new window opens only when the last one ended");
    for (const p of pieces) { assert.ok(p.lamports <= chunkCeiling(p.reserveBefore), "every piece within the live ceiling"); assert.ok(priceMovePct(p.lamports, p.reserveBefore) < 2.5); }
    for (let i = 1; i < pieces.length; i++) assert.ok(pieces[i].at - pieces[i - 1].at >= DISPERSAL_MIN_GAP_MS, "the 20-minute gap holds across window boundaries too");
  });
  test("a second reading added mid-window: the rest of the window is re-planned from now with the larger amount, same end", () => {
    let w = step(null, { now: T0, carriedLamports: sol(2), reserveLamports: sol(85), queueEmpty: true, seed: 4 }).window!;
    const end = w.endMs;
    const at = w.chunks[0].atMs;
    const r = step(w, { now: at, carriedLamports: sol(2), reserveLamports: sol(85), queueEmpty: true, seed: 4 });
    w = markChunk(r.window!, (r.action as { lamports: bigint }).lamports);
    const left = sol(2) - (r.action as { lamports: bigint }).lamports;
    // a new reading's crank carried 3 SOL more
    const r2 = step(w, { now: at + H, carriedLamports: left + sol(3), reserveLamports: sol(86), queueEmpty: true, seed: 4 });
    assert.equal(r2.window!.endMs, end, "same window end");
    assert.equal(r2.window!.startMs, w.startMs);
    assert.equal(r2.window!.expectedCarried, left + sol(3));
    assert.ok(r2.window!.chunks.every((c) => c.atMs >= at + H && c.atMs < end));
    assert.ok(r2.window!.chunks.length >= 4);
  });
  test("someone else's crank (carried lower than expected) re-plans too; carried zero ends the plan", () => {
    const w = step(null, { now: T0, carriedLamports: sol(3), reserveLamports: sol(85), queueEmpty: true, seed: 8 }).window!;
    const r = step(w, { now: T0 + 1000, carriedLamports: sol(1), reserveLamports: sol(85), queueEmpty: true, seed: 8 });
    assert.equal(r.window!.expectedCarried, sol(1));
    assert.deepEqual(step(r.window, { now: T0 + 2000, carriedLamports: BigInt(0), reserveLamports: sol(85), queueEmpty: true, seed: 8 }), { window: null, action: { kind: "idle", why: "nothing carried" } });
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
    const para = "The carried spending is bought in small pieces at random times over six-hour windows, so no single purchase moves the pool much.";
    assert.ok(lintCopy(para, cfg).ok, JSON.stringify(lintCopy(para, cfg).hits));
  });
});

describe("state and flag", () => {
  test("the state survives a JSON round trip with its bigints", () => {
    const w = planWindow({ carriedLamports: sol(3), reserveLamports: sol(85), now: T0, seed: 1 });
    const st = { ...EMPTY_STATE, window: w, debts: [{ readingDate: 1, landedAt: 2, totalLamports: SOL, remainingLamports: SOL }] };
    assert.deepEqual(stateFromJson(stateToJson(st)), st);
    assert.deepEqual(stateFromJson(null), EMPTY_STATE);
    assert.deepEqual(stateFromJson("{not json"), EMPTY_STATE);
  });
  test("BURNTICKER_DISPERSAL=1 turns it on; anything else is off", () => {
    assert.equal(dispersalEnabled({ BURNTICKER_DISPERSAL: "1" }), true);
    assert.equal(dispersalEnabled({}), false);
    assert.equal(dispersalEnabled({ BURNTICKER_DISPERSAL: "true" }), false);
  });
});

describe("the three example plans (the owner's numbers)", () => {
  const plan = (spend: number, reserve: number) => {
    const first = planWindow({ carriedLamports: sol(spend), reserveLamports: sol(reserve), now: T0, seed: 1 });
    const all = drain(sol(spend), sol(reserve), 1);
    return { firstChunk: first.chunks[0]?.lamports ?? BigInt(0), pieces: all.pieces.length, windows: all.windows.length };
  };
  test("5 SOL on 85: five ~1.0 SOL pieces, one window", () => {
    const p = plan(5, 85);
    assert.equal(p.firstChunk, sol(1));
    assert.deepEqual([p.pieces, p.windows], [5, 1]);
  });
  test("50 SOL on 85: ~1.04–1.3 SOL pieces, 18 a window, three windows", () => {
    const p = plan(50, 85);
    assert.equal(p.windows, 3);
    assert.ok(p.pieces >= 40 && p.pieces <= 48, `${p.pieces}`);
  });
  test("0.3 SOL on 20: two 0.15 SOL pieces, one window", () => {
    const p = plan(0.3, 20);
    assert.equal(p.firstChunk, sol(0.15));
    assert.deepEqual([p.pieces, p.windows], [2, 1]);
  });
});

describe("the window's end and a coarse wake", () => {
  test("a piece planned just before the window ends goes out at a wake just after it, not in a new random window", () => {
    const w = planWindow({ carriedLamports: sol(0.06), reserveLamports: sol(2), now: T0, seed: 5 });
    const last = { ...w, chunks: w.chunks.map((c, i) => (i === w.chunks.length - 1 ? { ...c, atMs: w.endMs - 60_000 } : c)), done: w.chunks.length - 1, expectedCarried: w.chunks[w.chunks.length - 1].lamports };
    const r = step(last, { now: w.endMs + 4 * 60_000, carriedLamports: last.expectedCarried, reserveLamports: sol(2), queueEmpty: true, seed: 9 });
    assert.equal(r.action.kind, "crank");
    assert.equal(r.window!.startMs, w.startMs, "the same window");
    // beyond one gap after the end, the remainder opens a new window instead
    const late = step(last, { now: w.endMs + DISPERSAL_MIN_GAP_MS, carriedLamports: last.expectedCarried, reserveLamports: sol(2), queueEmpty: true, seed: 9 });
    assert.notEqual(late.window!.startMs, w.startMs);
  });
});
