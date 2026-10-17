// NO BURN POOL IS EVER LEFT BEHIND (owner decisions, 2026-10-10): the onEnd wind-down (≥ 99 % in 28 days on a daily clock), a one-shot
// YES at 100 % draining the pool across cranks under the program's 2 %-of-reserve cap, the start day after an end, the retired-coin
// sweep (threshold, once a week), the outcome-set opt-in in the schema, the clock days' proof=, and the sentences under the copy lint.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_ON_END, WIND_DOWN_ON_END, lockRule, onEndText, ruleStatement, validateRule } from "@/lib/burnticker/rules";
import { firstWindDownDay, fullSpendUnits, windDownSchedule, windDownUnits } from "@/lib/burnticker/units";
import { runCycle, clockProofHex } from "@/lib/burnticker/multiKeeper";
import { oneShotAllLiner, plainSentence, ruleOneLiner } from "@/lib/burnticker/coinCard";
import { lifecycleFrom } from "@/lib/burnticker/tokenPage";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import type { CoinVsSpec } from "@/lib/burnticker/derby/spec";
import { B, BONK, BONK_FEED, BONK_MINT, SHIB, WIF, WIF_FEED, WIF_MINT, coinvsRule, derbyWorld, seedCross } from "./burntickerDerbyHelpers.ts";

const lint = (t: string) => lintCopy(t, loadCopyLintConfig()).hits.map((h) => `${h.phrase}:${h.rule}`);
const KALSHI_ONE_SHOT = { schema: "burnticker.rules/v1", oracle: "polymarket", series: null, market: `0x${"ab".repeat(32)}`, filter: {}, kind: "binary", binary: { onYes: { fractionOfPool: 1 }, onNo: null }, scalar: null, onVoid: "skip", floorUsd: "1", reserveSol: "0.02", vault: null, pair: null, onEnd: WIND_DOWN_ON_END };

describe("the schema", () => {
  test("a one-shot may spend 100 %; a recurring rule stays ≤ 25 %; onEnd and the outcome set are locked by the hash", () => {
    assert.equal(lockRule(KALSHI_ONE_SHOT).rule.binary!.onYes!.fractionOfPool, 1);
    assert.throws(() => lockRule({ ...KALSHI_ONE_SHOT, market: null, series: "tag:nfl/moneyline" }), /\[0\.01, 0\.25\].*one-shot may go to 1\.00/);
    assert.throws(() => lockRule({ ...KALSHI_ONE_SHOT, onEnd: { windDownDays: 3, sweepThresholdLamports: 50_000_000 } }), /onEnd must be/);
    const withSet = lockRule({ ...KALSHI_ONE_SHOT, set: { id: "nfl-2026", outcome: "PHI", forwardBps: 10_000 } });
    assert.notEqual(withSet.sha256, lockRule(KALSHI_ONE_SHOT).sha256);
    assert.throws(() => validateRule({ ...KALSHI_ONE_SHOT, onEnd: undefined, set: { id: "nfl-2026", outcome: "PHI", forwardBps: 10_000 } }), /needs the onEnd clause/);
    assert.throws(() => validateRule({ schema: "burnticker.rules/v1", oracle: "catalogue", series: "treasury.debt", market: null, filter: {}, kind: "scalar", scalar: { unit: 1e9, perUnit: { fractionOfPool: 0.05 }, baseline: "previousSettlement", direction: "up" }, binary: null, onVoid: "skip", floorUsd: "1", reserveSol: "0.02", vault: null, onEnd: WIND_DOWN_ON_END, set: { id: "x-set", outcome: "a", forwardBps: 1 } }), /outcome list/);
    // A rule without onEnd keeps its bytes (rules made before the clause are unchanged).
    assert.ok(!lockRule({ ...KALSHI_ONE_SHOT, onEnd: undefined }).text.includes("onEnd"));
  });

  test("the sentences say it, lint-clean: one-liner, plain sentence, statement, the outcome-set conditional", () => {
    const r = lockRule(KALSHI_ONE_SHOT).rule;
    assert.equal(oneShotAllLiner(r, "the Eagles win the Super Bowl", "2027-02-14"), "burns everything if the Eagles win the Super Bowl. If not, the pool burns down over four weeks after 2027-02-14");
    assert.match(ruleOneLiner(r, "the Eagles win the Super Bowl"), /^burns everything if the Eagles win the Super Bowl\. If not, the pool burns down over four weeks after it settles$/);
    const texts = [oneShotAllLiner(r, "X happens", "2027-02-14")!, plainSentence(r, "EAGLES", "the Eagles win the Super Bowl"), onEndText({ onEnd: WIND_DOWN_ON_END, set: { id: "nfl-2026", outcome: "PHI", forwardBps: 2500 }, pair: null, kind: "binary", binary: { onYes: { fractionOfPool: 1 }, onNo: null }, scalar: null }), plainSentence(coinvsRule({ selector: "coinvs", a: WIF, b: SHIB, window: "daily", measure: "pct", season: { start: "2026-10-05", days: 7 }, flip: false }), "TEAMWIF")];
    for (const t of texts) assert.deepEqual(lint(t), [], t);
    assert.match(ruleStatement(r), /spends the whole fee pool \(100%\).*burns down on a daily clock over four weeks/);
    assert.match(texts[2], /25% of the leftover burns the winning coin of set nfl-2026 .*all of it stays here/);
  });

  test("END SINKS (LAUNCHPAD-PATH §45): new launches carry onEnd.endSink; the hash locks it; league mode cannot carry it yet; the sentences say where the leftover burns", () => {
    const sink = lockRule({ ...KALSHI_ONE_SHOT, onEnd: DEFAULT_ON_END });
    assert.deepEqual(sink.rule.onEnd, { windDownDays: 28, sweepThresholdLamports: 50_000_000, endSink: true });
    assert.notEqual(sink.sha256, lockRule(KALSHI_ONE_SHOT).sha256, "the end sink is part of the hashed rule");
    assert.ok(!lockRule(KALSHI_ONE_SHOT).text.includes("endSink"), "a rule without the field keeps its bytes");
    assert.throws(() => lockRule({ ...KALSHI_ONE_SHOT, onEnd: { ...DEFAULT_ON_END, endSink: false } }), /onEnd must be/);
    assert.throws(() => lockRule({ ...KALSHI_ONE_SHOT, onEnd: DEFAULT_ON_END, set: { id: "nfl-2026", outcome: "PHI", forwardBps: 10_000 } }), /cannot be combined with an outcome set/);
    const r = sink.rule;
    assert.equal(oneShotAllLiner(r, "the Eagles win the Super Bowl", "2027-02-14"), "burns everything if the Eagles win the Super Bowl. If not, whatever is left burns $DEFICIT after 2027-02-14");
    const pair = lockRule({ ...KALSHI_ONE_SHOT, onEnd: DEFAULT_ON_END, pair: { pairId: "pair-1", side: "A", counterpartMint: null, winnerTakesBurn: true } }).rule;
    assert.equal(oneShotAllLiner(pair, "X happens", null), "burns everything if X happens. If not, whatever is left burns the winning coin, or $DEFICIT if there isn't one after it settles");
    const texts = [oneShotAllLiner(r, "X happens", "2027-02-14")!, plainSentence(r, "EAGLES", "the Eagles win the Super Bowl"), onEndText(r), onEndText(pair)];
    for (const t of texts) assert.deepEqual(lint(t), [], t);
    assert.match(onEndText(r), /ends with a result.*moves to \$DEFICIT's burn pool.*ends void.*burns down on this coin on a daily clock over four weeks/);
    assert.match(onEndText(pair), /the winning coin's burn pool when the partner coin won the last result and is still live, and \$DEFICIT's burn pool otherwise/);
  });
});

describe("the schedules", () => {
  test("NO / void / season over → the 28-day schedule spends ≥ 99 %; 100 % spends in one unit; the sweep's full-spend units", () => {
    for (const f of [0.01, 0.02, 0.05, 0.1]) {
      const s = windDownSchedule(f, 28);
      assert.ok(s[27].spent >= 0.99, `f=${f}: ${s[27].spent}`);
      assert.ok(windDownUnits(f, 28) === 1 || 1 - Math.pow(1 - f, (windDownUnits(f, 28) - 1) * 28) < 0.99, `f=${f}: the smallest n`);
    }
    assert.equal(windDownUnits(0.01, 28), 17); assert.equal(windDownUnits(0.1, 28), 2); assert.equal(windDownUnits(1, 28), 1);
    assert.equal(fullSpendUnits(0.01), 459); assert.ok(1 - Math.pow(0.99, 459) >= 0.99);
    // The wind-down starts on the day after the end; a season ending at 00:00 UTC starts that day.
    assert.equal(firstWindDownDay(Date.parse("2026-10-05T23:41:00Z")), "2026-10-06");
    assert.equal(firstWindDownDay(B(12)), "2026-10-12");
    assert.match(clockProofHex("2026-10-12", "ab".repeat(32)), /^[0-9a-f]{64}$/);
  });
});

describe("through the keeper and the program", () => {
  test("a one-shot YES at 100 %: the pool drains across daily cranks under the 2 %-of-reserve cap, then the coin retires; the clock days' proof= is the date + rules sha", async () => {
    const spec: CoinVsSpec = { selector: "coinvs", a: WIF, b: BONK, window: "daily", measure: "mcap", season: { start: "2026-10-05", days: 5 }, flip: true };
    const rule = lockRule({ ...coinvsRule(spec, 1), onEnd: WIND_DOWN_ON_END }).rule;
    const w = await derbyWorld(spec, { rule, tickers: ["TEAMWIF", "TEAMBONK"], hermes: null });
    // 50 SOL of WSOL reserve → one crank spends at most 1 SOL; the pool holds 5 SOL.
    w.program.fake(w.a.mint).poolReserveWsol = BigInt(50) * BigInt(1_000_000_000);
    const snap = (feed: string, b: number, value: string) => w.adapter.store.putSample({ key: `pyth:${feed}`, kind: "pyth", ts: b + 60_000, slot: 1, value, detail: { source: "pyth-solana", publishTime: b / 1000 + 5 } });
    const sup = (mint: string, b: number, v: string) => w.adapter.store.putSample({ key: `supply:${mint}`, kind: "supply", ts: b + 60_000, slot: 1, value: v, detail: {} });
    for (const b of [B(5), B(6)]) { snap(WIF_FEED, b, "0.25"); snap(BONK_FEED, b, "0.0000025"); sup(WIF_MINT, b, "999000000"); sup(BONK_MINT, b, "88000000000000"); seedCross(w, WIF, b, "0.25"); seedCross(w, BONK, b, "0.0000025"); }
    w.clock.now = B(6) + 3 * 3600_000;
    await runCycle(w.deps); await runCycle(w.deps);
    const yes = w.registry.receipts(w.a.mint)[0];
    assert.equal(yes.status, "confirmed"); assert.equal(yes.spendLamports, BigInt(1_000_000_000), "capped at 2 % of the reserve");
    assert.ok((yes.carriedOutLamports ?? BigInt(0)) > BigInt(0), "the rest is carried");
    assert.equal(w.registry.ruleEnd(w.a.mint)!.mode, "drain");
    for (let d = 7; d <= 14; d++) { w.clock.now = B(d) + 3 * 3600_000; await runCycle(w.deps); await runCycle(w.deps); }
    const drains = w.registry.receipts(w.a.mint).filter((r) => r.kind === "drain");
    assert.ok(drains.length >= 4, `${drains.length} drain days`);
    assert.ok(drains.every((r) => r.units === 1 && (r.status === "confirmed" || r.status === "skipped")));
    const spent = w.registry.receipts(w.a.mint).reduce((a, r) => a + (r.spendLamports ?? BigInt(0)), BigInt(0));
    const feeLeft = w.program.fake(w.a.mint).feeLamports;
    assert.ok(spent >= BigInt(4_900_000_000), `spent ${spent}`); assert.ok(feeLeft <= BigInt(100_000_000), `left ${feeLeft}`);
    assert.equal(w.registry.token(w.a.mint)!.status, "retired");
    assert.match(lifecycleFrom(w.registry, w.registry.token(w.a.mint)!, rule).line, /^This coin is retired\./);
    // A drain day's attestation commits to sha256("clock|<date>|<rules sha256>").
    const sig = w.registry.signatures(w.a.mint, `reading:${drains[0].eventId.slice(6)}`)[0];
    assert.ok(JSON.parse(sig.memo).message.endsWith(`proof=${clockProofHex(drains[0].eventId.slice(6), w.a.rulesSha)}`));
  });

  test("the retired-coin sweep: fee income above the threshold is swept and burned; below it, nothing; at most one sweep a week", async () => {
    const spec: CoinVsSpec = { selector: "coinvs", a: WIF, b: SHIB, window: "daily", measure: "pct", season: { start: "2026-10-05", days: 1 }, flip: false };
    const w = await derbyWorld(spec);
    seedCross(w, WIF, B(5), "0.2"); seedCross(w, WIF, B(6), "0.21"); seedCross(w, SHIB, B(5), "0.0000055"); seedCross(w, SHIB, B(6), "0.00000561");
    w.clock.now = B(6) + 3 * 3600_000;
    await runCycle(w.deps);
    w.clock.now = B(6) + 31 * 86_400_000;
    for (let i = 0; i < 3; i++) await runCycle(w.deps);
    assert.equal(w.registry.token(w.a.mint)!.status, "retired");
    const sweeps = () => w.registry.receipts(w.a.mint).filter((r) => r.kind === "sweep");
    // The wind-down left ~1 % of the 5 SOL (≈ 0.042 SOL); 0.001 SOL arrives: still under the 0.05 SOL threshold → no sweep.
    w.program.deposit(w.a.mint, BigInt(1_000_000));
    await runCycle(w.deps);
    assert.equal(sweeps().length, 0);
    // 0.2 SOL more: swept today, full-spend units, cranked and burned.
    w.program.deposit(w.a.mint, BigInt(200_000_000));
    await runCycle(w.deps); await runCycle(w.deps);
    assert.equal(sweeps().length, 1); assert.equal(sweeps()[0].units, 459); assert.equal(sweeps()[0].status, "confirmed");
    assert.match(lifecycleFrom(w.registry, w.registry.token(w.a.mint)!, w.registry.lockedRule(w.a).rule).line, /^This coin is retired\. Its pool was last swept on \d{4}-\d{2}-\d{2}/);
    // Another refill the next day: no second sweep within the week…
    w.clock.now += 86_400_000;
    w.program.deposit(w.a.mint, BigInt(300_000_000));
    await runCycle(w.deps);
    assert.equal(sweeps().length, 1);
    // …and a week later it is swept again.
    w.clock.now += 7 * 86_400_000;
    await runCycle(w.deps); await runCycle(w.deps);
    assert.equal(sweeps().length, 2);
  });
});
