// BURN KEEPER (2026-10-09) — the Treasury "Debt to the Penny" feed: the frozen real series validates clean; every refusal the brief
// names (schema, NaN, monotone record_date, > $2T/day) refuses and keeps only the readings before the bad one.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fetchDebtToPenny, latestUrl, pairUrl, rowUrl, sinceUrl, validateDebtResponse } from "@/lib/burnKeeper/feeds/treasury";
import { usdToCents } from "@/lib/burnKeeper/rules";

const root = path.resolve(import.meta.dirname, "..");
const FIXTURE = JSON.parse(fs.readFileSync(path.join(root, "test/fixtures/treasury-debt-to-penny-2024-12-to-2026-10-08.json"), "utf8")) as { data: { record_date: string; tot_pub_debt_out_amt: string }[] };
const row = (d: string, a: string) => ({ record_date: d, tot_pub_debt_out_amt: a });

describe("the frozen real series", () => {
  test("466 rows 2024-12-02 → 2026-10-08 validate with no refusal, strictly increasing dates", () => {
    const v = validateDebtResponse(FIXTURE);
    assert.deepEqual(v.refusals, []);
    assert.equal(v.readings.length, 466);
    assert.equal(v.readings[0].recordDate, "2024-12-02");
    assert.equal(v.readings[v.readings.length - 1].recordDate, "2026-10-08");
    for (let i = 1; i < v.readings.length; i++) assert.ok(v.readings[i].recordDate > v.readings[i - 1].recordDate);
  });
  test("the spec's readings: 10-06 $40.273T → 10-07 $40.284T → 10-08 $40.305T", () => {
    const v = validateDebtResponse(FIXTURE);
    const at = (d: string) => v.readings.find((r) => r.recordDate === d)!.amount;
    assert.equal(at("2026-10-07"), "40284036147367.19");
    assert.equal(at("2026-10-08"), "40305316210829.72");
    assert.equal(at("2026-10-06"), "40273024579219.17");
  });
  test("order of the response does not matter (newest-first, as the keeper polls)", () => {
    const v = validateDebtResponse({ data: [...FIXTURE.data].reverse().slice(0, 30) });
    assert.deepEqual(v.refusals, []);
    assert.equal(v.readings[v.readings.length - 1].recordDate, "2026-10-08");
  });
  test("the largest real day 2025-01 → 2026-10 is +$366B (2025-07-07) — far inside the $2T bound", () => {
    const v = validateDebtResponse(FIXTURE);
    let max = BigInt(0), at = "";
    for (let i = 1; i < v.readings.length; i++) { const d = v.readings[i].cents - v.readings[i - 1].cents; if (d > max) { max = d; at = v.readings[i].recordDate; } }
    assert.equal(at, "2025-07-07");
    assert.ok(max < usdToCents("400000000000"));
  });
});

describe("refusals", () => {
  test("no data[] → refused, nothing read", () => {
    assert.deepEqual(validateDebtResponse({ error: "x" }).readings, []);
    assert.match(validateDebtResponse(null).refusals[0], /schema/);
  });
  test("NaN / null / empty / exponent amounts are refused and cut the series at that date", () => {
    for (const bad of ["NaN", null, "", "4.03e13", "40305316210829.723", "-1.00"]) {
      const v = validateDebtResponse({ data: [row("2026-10-05", "40249104431078.48"), row("2026-10-06", bad as string), row("2026-10-07", "40284036147367.19")] });
      assert.equal(v.readings.length, 1, `amount ${String(bad)}`);
      assert.equal(v.readings[0].recordDate, "2026-10-05");
      assert.match(v.refusals[0], /schema/);
    }
  });
  test("an unreadable date refuses everything (we cannot know which date is missing)", () => {
    const v = validateDebtResponse({ data: [row("2026-10-05", "40249104431078.48"), row("2026-13-01", "40284036147367.19")] });
    assert.deepEqual(v.readings, []);
    assert.match(v.refusals[0], /not a real YYYY-MM-DD/);
  });
  test("a level outside $1T–$1,000T (a units bug upstream) is refused", () => {
    const v = validateDebtResponse({ data: [row("2026-10-05", "40249104431078.48"), row("2026-10-06", "40249104431.07")] });
    assert.equal(v.readings.length, 1);
    assert.match(v.refusals[0], /level/);
  });
  test("a duplicated record_date is refused (monotone record_date)", () => {
    const v = validateDebtResponse({ data: [row("2026-10-05", "40249104431078.48"), row("2026-10-06", "40273024579219.17"), row("2026-10-06", "40273024579219.18")] });
    assert.equal(v.readings.length, 2);
    assert.match(v.refusals[0], /appears twice/);
  });
  test("a move beyond ±$2T in one reading is refused, and nothing after it is kept", () => {
    const v = validateDebtResponse({ data: [row("2026-10-05", "40249104431078.48"), row("2026-10-06", "42349104431078.48"), row("2026-10-07", "42350104431078.48")] });
    assert.equal(v.readings.length, 1);
    assert.match(v.refusals[0], /delta/);
  });
  test("against the keeper's last reading: its echo is fine, older rows are ignored, a REVISION holds", () => {
    const prev = { recordDate: "2026-10-06", cents: usdToCents("40273024579219.17") };
    const ok = validateDebtResponse({ data: [row("2026-10-05", "40249104431078.48"), row("2026-10-06", "40273024579219.17"), row("2026-10-07", "40284036147367.19")] }, { prev });
    assert.deepEqual(ok.refusals, []);
    assert.deepEqual(ok.readings.map((r) => r.recordDate), ["2026-10-07"]);
    const rev = validateDebtResponse({ data: [row("2026-10-06", "40273024579219.99"), row("2026-10-07", "40284036147367.19")] }, { prev });
    assert.deepEqual(rev.readings, []);
    assert.match(rev.refusals[0], /revision/);
    const jump = validateDebtResponse({ data: [row("2026-10-07", "45000000000000.00")] }, { prev });
    assert.match(jump.refusals[0], /delta/, "the first new row is checked against the keeper's own last reading");
  });
});

describe("URLs and the fetch", () => {
  test("the URLs carry the fields, the order and the filters the brief names", () => {
    assert.equal(latestUrl(5), "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/debt_to_penny?fields=record_date,tot_pub_debt_out_amt&sort=-record_date&page[size]=5");
    assert.match(sinceUrl("2025-01-01"), /filter=record_date:gte:2025-01-01&sort=record_date/);
    assert.match(rowUrl("2026-10-08"), /filter=record_date:eq:2026-10-08$/);
    assert.match(pairUrl("2026-10-07", "2026-10-08"), /filter=record_date:in:\(2026-10-07,2026-10-08\)/);
  });
  test("fetchDebtToPenny uses the injected fetch and validates; an HTTP error throws (the keeper retries hourly)", async () => {
    let asked = "";
    const v = await fetchDebtToPenny({ pageSize: 3, fetchImpl: async (u) => { asked = u; return { ok: true, status: 200, json: async () => ({ data: FIXTURE.data.slice(-3).reverse() }) }; } });
    assert.match(asked, /page\[size\]=3/);
    assert.equal(v.readings.length, 3);
    await assert.rejects(fetchDebtToPenny({ fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }) }), /HTTP 503/);
  });
});
