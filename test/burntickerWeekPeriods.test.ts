import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { isoWeekOf, periodLike, periodStartDay, periodStartMs } from "../src/lib/burnticker/periodStart.ts";
import { receiptDay, sendableWork } from "../src/lib/burnticker/multiKeeper.ts";
import { formatReceiptMemo, parseReceiptMemo, settledForMemo } from "../src/lib/burnticker/receipt.ts";
import { countsAfterLaunch, readingsAfterLaunch } from "../src/lib/burnticker/launchCut.ts";

/**
 * WEEKLY AND QUARTERLY RECEIPTS (2026-10-28). $GASCAT's feed is weekly (EIA gas prices, ISO weeks), the first weekly coin to reach the
 * keeper: receiptDay threw "not a settlement time: 2026-W10" on every cycle, which failed the cycle, held every send and pinged the
 * monitor's failure URL (Healthchecks flapped DOWN/UP by email all morning). A week files under its Monday, a quarter under its first
 * day, as a month files under its first day; the memo carries the period itself.
 */
describe("burnticker week and quarter periods", () => {
  test("periodStartDay: day, month, ISO week (its Monday), quarter, ISO time; nothing else", () => {
    assert.equal(periodStartDay("2026-10-08"), "2026-10-08");
    assert.equal(periodStartDay("2026-08"), "2026-08-01");
    assert.equal(periodStartDay("2026-W10"), "2026-03-02");   // 2026-03-02 is a Monday
    assert.equal(periodStartDay("2026-W01"), "2025-12-29");   // ISO week 1 of 2026 starts in 2025
    assert.equal(periodStartDay("2026-W44"), "2026-10-26");
    assert.equal(periodStartDay("2026-Q3"), "2026-07-01");
    assert.equal(periodStartDay("2026-10-04T23:41:27Z"), "2026-10-04");
    assert.equal(periodStartDay("2026-W54"), null);
    assert.equal(periodStartDay("2026-Q5"), null);
    assert.equal(periodStartDay("soon"), null);
    assert.equal(periodStartMs("2026-W10"), Date.UTC(2026, 2, 2));
    assert.ok(Number.isNaN(periodStartMs("soon")));
  });
  test("isoWeekOf round-trips periodStartDay for every week of 2026", () => {
    for (let w = 1; w <= 53; w++) { const p = `2026-W${String(w).padStart(2, "0")}`; assert.equal(isoWeekOf(periodStartDay(p)!), p); }
    assert.equal(periodLike("2026-10-28", "2026-W10"), "2026-W44");
    assert.equal(periodLike("2026-10-28", "2026-Q1"), "2026-Q4");
    assert.equal(periodLike("2026-10-28", "2026-08"), "2026-10");
    assert.equal(periodLike("2026-10-28", "2026-10-08"), "2026-10-28");
  });
  test("receiptDay files a week under its Monday and a quarter under its first day; sendableWork counts closed weeks", () => {
    assert.equal(receiptDay("2026-W10"), 20260302);
    assert.equal(receiptDay("2026-Q3"), 20260701);
    assert.equal(receiptDay("2026-08"), 20260801);
    assert.throws(() => receiptDay("soon"), /not a settlement time: soon/);
    const now = Date.UTC(2026, 9, 28, 12);
    const w = sendableWork([{ readingDate: null, settledAt: "2026-W10" }, { readingDate: null, settledAt: "2026-W44" }, { readingDate: null, settledAt: "2026-W45" }], now);
    assert.deepEqual(w, { sendable: true, dates: [20260302, 20261026] });   // W45 starts 2026-11-02: not yet
  });
  test("the receipt memo carries a week or quarter as its settlement time", () => {
    assert.equal(settledForMemo("2026-W10"), "2026-W10");
    assert.equal(settledForMemo("2026-Q3"), "2026-Q3");
    assert.throws(() => settledForMemo("soon"), /not a time/);
    const m = { ticker: "GASCAT", id: "2026-W10", oracle: "eia", market: "2026-W10", result: "-" as const, settled: "2026-W10", src: "api.eia.gov/v2/petroleum/pri/gnd", value: "2.914", units: 1, pool: "1000", spent: "100", got: "1.5", burn: "1.5", swap: "none", rulesSha12: "0123456789ab", version: "v3" as const };
    const s = formatReceiptMemo(m);
    assert.ok(s.includes("|settled=2026-W10|"));
    assert.deepEqual(parseReceiptMemo(s), m);
    assert.throws(() => formatReceiptMemo({ ...m, settled: "2026-W54" }), /settled/);
  });
  test("the launch cut: a week or quarter counts only when it starts after the launch (text order put every week after it)", () => {
    const launch = "2026-10-28T00:16:37.000Z";   // $GASCAT, a Tuesday
    assert.equal(countsAfterLaunch({ at: "2026-W10" }, launch, false), false);
    assert.equal(countsAfterLaunch({ at: "2026-W44" }, launch, false), false);   // the launch week (Monday 10-26)
    assert.equal(countsAfterLaunch({ at: "2026-W45" }, launch, false), true);    // Monday 11-02
    assert.equal(countsAfterLaunch({ at: "2026-Q4" }, launch, false), false);
    assert.equal(countsAfterLaunch({ at: "2027-Q1" }, launch, false), true);
    assert.equal(countsAfterLaunch({ at: "2026-10" }, launch, false), false);    // unchanged: the launch month
    assert.equal(countsAfterLaunch({ at: "2026-11" }, launch, false), true);
    assert.equal(countsAfterLaunch({ at: "2026-10-28" }, launch, false), false); // unchanged: the launch day
    assert.equal(countsAfterLaunch({ at: "2026-10-29" }, launch, false), true);
    const rows = ["2026-W10", "2026-W43", "2026-W44", "2026-W45", "2026-W46"].map((at) => ({ at }));
    const reg = { readings: (_k: string, since: string | null) => rows.filter((r) => r.at > (since ?? "")) };   // the registry's text order
    assert.deepEqual(readingsAfterLaunch(reg, "catalogue:eia.gas", launch).map((r) => r.at), ["2026-W45", "2026-W46"]);
    assert.equal(readingsAfterLaunch(reg, "catalogue:eia.gas", null).length, 5);
  });
});
