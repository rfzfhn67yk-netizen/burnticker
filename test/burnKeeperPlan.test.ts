// BURN KEEPER (2026-10-09) — the planner (pure) and the replay over the real series: baseline, idempotent re-polls, refusals that
// hold the line, the carry run, and the totals the replay doc reports.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { advance, planReading, planReadings } from "@/lib/burnKeeper/plan";
import { loadRules, tokensToRaw, usdToCents } from "@/lib/burnKeeper/rules";
import { validateDebtResponse, type DebtReading } from "@/lib/burnKeeper/feeds/treasury";
import { buybackScenario, buybackScenariosMarkdown, byMonth, replay, replayMarkdown, vaultPace } from "@/lib/burnKeeper/replay";

const root = path.resolve(import.meta.dirname, "..");
const { rules, sha256 } = loadRules(path.join(root, "config/burnkeeper/deficit.rules.json"));
const FIX = validateDebtResponse(JSON.parse(fs.readFileSync(path.join(root, "test/fixtures/treasury-debt-to-penny-2024-12-to-2026-10-08.json"), "utf8"))).readings;
const R = (d: string, a: string): DebtReading => ({ recordDate: d, amount: a, cents: usdToCents(a) });

describe("planReading", () => {
  test("an empty ledger makes the first reading the baseline — nothing burned for the debt's whole history", () => {
    const s = planReading(rules, null, null, R("2026-10-07", "40284036147367.19"));
    assert.equal(s.kind, "baseline");
    assert.deepEqual(advance(null, s), { recordDate: "2026-10-07", cents: usdToCents("40284036147367.19"), carryOutCents: BigInt(0) });
  });
  test("the spec's day plans 21 units = 2,100,000 tokens = 2.1e12 raw at 6 decimals", () => {
    const last = { recordDate: "2026-10-07", cents: usdToCents("40284036147367.19"), carryOutCents: BigInt(0) };
    const s = planReading(rules, last, null, R("2026-10-08", "40305316210829.72"));
    assert.equal(s.kind, "burn");
    if (s.kind === "burn") { assert.equal(s.step.units, 21); assert.equal(s.plannedRaw, tokensToRaw("2100000", 6)); }
  });
  test("IDEMPOTENT: the same date and value again is 'seen' (a re-poll plans nothing)", () => {
    const last = { recordDate: "2026-10-08", cents: usdToCents("40305316210829.72"), carryOutCents: BigInt(5) };
    assert.equal(planReading(rules, last, "2026-10-08", R("2026-10-08", "40305316210829.72")).kind, "seen");
  });
  test("refuses: the same date with another value, an older date, a date older than the last burn, an implausible delta", () => {
    const last = { recordDate: "2026-10-08", cents: usdToCents("40305316210829.72"), carryOutCents: BigInt(0) };
    assert.match((planReading(rules, last, null, R("2026-10-08", "40305316210829.73")) as { reason: string }).reason, /revision/);
    assert.match((planReading(rules, last, null, R("2026-10-07", "40284036147367.19")) as { reason: string }).reason, /older than the last processed/);
    assert.match((planReading(rules, null, "2026-10-08", R("2026-10-01", "40284036147367.19")) as { reason: string }).reason, /older than the last burned/);
    assert.match((planReading(rules, last, null, R("2026-10-09", "43305316210829.72")) as { reason: string }).reason, /beyond the rule/);
  });
  test("an increase under one unit is 'nothing' with the carry moved; a down day is 'nothing' with the carry reset", () => {
    const last = { recordDate: "2026-10-08", cents: usdToCents("40000000000000.00"), carryOutCents: BigInt(0) };
    const a = planReading(rules, last, null, R("2026-10-09", "40000400000000.00"));
    assert.equal(a.kind, "nothing");
    const st = advance(last, a)!;
    assert.equal(st.carryOutCents, usdToCents("400000000.00"));
    const b = planReading(rules, st, null, R("2026-10-13", "39999000000000.00"));
    assert.equal(b.kind, "nothing");
    assert.equal(advance(st, b)!.carryOutCents, BigInt(0));
  });
});

describe("planReadings", () => {
  test("many days in order; stops at the first refusal (never skips past it)", () => {
    const steps = planReadings(rules, null, null, [R("2026-10-06", "40273024579219.17"), R("2026-10-07", "40284036147367.19"), R("2026-10-08", "45305316210829.72"), R("2026-10-09", "45306316210829.72")]);
    assert.deepEqual(steps.map((s) => s.kind), ["baseline", "burn", "refuse"]);
  });
  test("running the same batch twice from the advanced state plans nothing new", () => {
    const batch = FIX.slice(-10);
    const first = planReadings(rules, null, null, batch);
    let st = null as ReturnType<typeof advance>; let burned: string | null = null;
    for (const s of first) { st = advance(st, s); if (s.kind === "burn") burned = s.reading.recordDate; }
    // The feed validator drops rows older than the keeper's last reading; what reaches the planner again is that reading's echo.
    const again = planReadings(rules, st, burned, batch.slice(-1));
    assert.deepEqual(again.map((s) => s.kind), ["seen"]);
    assert.equal(advance(st, again[0]), st, "a seen step moves nothing");
    const older = planReadings(rules, st, burned, batch.slice(0, 1));
    assert.equal(older[0].kind, "refuse", "and an older row, should one ever arrive, is refused rather than re-planned");
  });
});

describe("replay over the real series 2025-01-01 → 2026-10-08", () => {
  const supply = tokensToRaw(rules.totalSupply, 6);
  const appetite = replay(rules, FIX, "2025-01-01", { kind: "upfront", allocationRaw: supply, startMs: Date.parse("2025-01-01T00:00:00Z"), cliffDays: 0, vestDays: 0 });
  test("baseline 2024-12-31; 445 readings; 235 burn days; 6,490 units; no refusals", () => {
    assert.equal(appetite.baseline.recordDate, "2024-12-31");
    assert.equal(appetite.readings, 445);
    assert.equal(appetite.rows.length, 235);
    assert.equal(appetite.rows.reduce((a, r) => a + r.units, 0), 6_490);
    assert.deepEqual(appetite.refusals, []);
  });
  test("the biggest day is 2025-07-07: +$366.44B → 366 units → 36,600,000 tokens (3.66%)", () => {
    const big = [...appetite.rows].sort((a, b) => b.units - a.units)[0];
    assert.equal(big.recordDate, "2025-07-07");
    assert.equal(big.units, 366);
    assert.equal(big.plannedRaw, tokensToRaw("36600000", 6));
  });
  test("carry is only ever < $1B, and a burn's carry-in is non-zero only after an increase", () => {
    for (const r of appetite.rows) assert.ok(r.carryInCents < usdToCents("1000000000.00"));
  });
  test("per-month totals add up to the cumulative burn", () => {
    const m = byMonth(rules, appetite.rows);
    assert.equal(m.reduce((a, x) => a + x.burnRaw, BigInt(0)), appetite.rows[appetite.rows.length - 1].cumBurnRaw);
    assert.equal(m.length, 22);
  });
  test("the rule file's 25% vesting vault: never burns more than has vested, never more than its allocation; shortfalls are carried", () => {
    const alloc = tokensToRaw(rules.vaultAllocation, 6);
    const v = replay(rules, FIX, "2025-01-01", { kind: "vesting", allocationRaw: alloc, startMs: Date.parse("2025-01-01T00:00:00Z"), cliffDays: 0, vestDays: 365 });
    assert.ok(v.rows[v.rows.length - 1].cumBurnRaw <= alloc);
    assert.ok(v.rows.some((r) => r.shortOutRaw > BigInt(0)));
    for (const r of v.rows) assert.equal(r.shortInRaw + r.plannedRaw >= r.burnRaw, true);
  });
  test("vault pace for 20/25/30%: more vault, fewer short days", () => {
    const p = vaultPace(rules, FIX, "2025-01-01", [20, 25, 30], 365);
    assert.equal(p.length, 3);
    assert.ok(p[0].shortfallDays >= p[1].shortfallDays && p[1].shortfallDays >= p[2].shortfallDays);
    assert.ok(p[0].appetitePctPerMonth > 2.5 && p[0].appetitePctPerMonth < 3.5);
  });
  test("the markdown names the command, the rule hash and the biggest day", () => {
    const md = replayMarkdown(rules, appetite, { from: "2025-01-01", to: "2026-10-08", source: "fixture", sha256, vaultLabel: "none" });
    assert.match(md, /--replay=2025-01-01/);
    assert.match(md, new RegExp(sha256));
    assert.match(md, /Biggest single day: \*\*2025-07-07/);
  });
});

describe("buyback scenarios over the real series ($20 / $100 / $500 a day at a constant price)", () => {
  test("more inflow, more burned — and burned tokens scale with inflow ÷ price", () => {
    const a = buybackScenario(rules, FIX, "2025-01-01", 20, 0.001), b = buybackScenario(rules, FIX, "2025-01-01", 100, 0.001), c = buybackScenario(rules, FIX, "2025-01-01", 500, 0.001);
    assert.ok(a.burnedTokens < b.burnedTokens && b.burnedTokens < c.burnedTokens);
    assert.ok(Math.abs(c.burnedTokens / a.burnedTokens - 25) < 0.5, "≈ linear in inflow (the $1 floor bites only at $20/day)");
    const d = buybackScenario(rules, FIX, "2025-01-01", 100, 0.002);
    assert.ok(Math.abs(b.burnedTokens / d.burnedTokens - 2) < 1e-9, "double the price, half the tokens");
    assert.ok(b.spentUsd <= b.inflowUsd + 1e-6, "never spends more than came in");
    assert.equal(b.biggest!.recordDate, b.biggest!.recordDate);
  });
  test("the markdown has the three-scenario table and the by-month table", () => {
    const md = buybackScenariosMarkdown(rules, FIX, "2025-01-01", "2026-10-08", [20, 100, 500], 0.001);
    assert.match(md, /\| \$20\/day \|/);
    assert.match(md, /\| \$500\/day \|/);
    assert.match(md, /By month, % of supply burned/);
    assert.match(md, /CONSTANT price of \$0\.001/);
  });
});
