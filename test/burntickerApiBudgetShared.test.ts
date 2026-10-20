// HB-45 (continuous audit 2026-10-19, hourly run 4): ops.json said the site used "600 of 600" Polygon public RPC requests at 16:31Z while
// the keeper's log said "210 / 600" at 22:09Z, read as one count reset by a restart. On the host both counts are rows in the registry's
// status table (apiBudget.day.web.polygon-rpc and apiBudget.day.keeper.polygon-rpc): each process spends its own share (0.5 each of the
// 60% of 2,000), counted per role and UTC day, persisted, and continued after a restart. These tests prove that on one registry file
// and check the status line now prints the other share beside its own, so the two numbers are read side by side.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ApiBudget, budgetFor, budgetStatusLines, specOf, statusTableStore, type BudgetAlert } from "@/lib/burnticker/apiBudget";
import { openRegistry } from "@/lib/burnticker/registry";
import { lintCopy } from "@/lib/launch/copyLint";

function clock(start: number) {
  let t = start;
  return { now: () => t, sleep: async (ms: number) => { t += ms; }, set: (ms: number) => { t = ms; }, advance: (ms: number) => { t += ms; } };
}
const scratch = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apibudget-hb45-")); return { dir, file: path.join(dir, "burnticker.db") }; };
const take = async (b: ApiBudget, n: number) => { for (let i = 0; i < n; i++) await b.take("polygon-rpc"); b.flush(); };

describe("HB-45: one persisted daily count per source and role, shared by every process on the registry", () => {
  test("two instances of one role on one registry file share the count", async () => {
    const { dir, file } = scratch();
    const c = clock(Date.parse("2026-10-19T12:00:00Z"));
    const r1 = openRegistry(file), r2 = openRegistry(file);
    try {
      const a = new ApiBudget({ role: "keeper", store: statusTableStore(r1.db), now: c.now, sleep: c.sleep, flushMs: 0 });
      const b = new ApiBudget({ role: "keeper", store: statusTableStore(r2.db), now: c.now, sleep: c.sleep, flushMs: 0 });
      await take(a, 5);
      assert.equal(b.used("polygon-rpc"), 5, "the second instance starts from the first one's count");
      await take(b, 3);
      await take(a, 1);
      assert.equal(a.used("polygon-rpc"), 9);
      assert.equal(JSON.parse(r1.getStatus("apiBudget.day.keeper.polygon-rpc")!).used, 9);
    } finally { r1.close(); r2.close(); fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test("a restart continues from the pre-restart count, and a spent share stays on hold after the restart", async () => {
    const { dir, file } = scratch();
    const c = clock(Date.parse("2026-10-19T16:00:00Z"));
    const budget = budgetFor(specOf("polygon-rpc"), "web").perDay;
    assert.equal(budget, 600, "the site's share: 2,000 × 60% × 0.5");
    let reg = openRegistry(file);
    try {
      const alerts: BudgetAlert[] = [];
      const web = new ApiBudget({ role: "web", store: statusTableStore(reg.db), now: c.now, sleep: async () => { c.advance(60_000); }, alert: (a) => alerts.push(a), flushMs: 0, maxWaitMs: 1e12 });
      for (let i = 0; i < budget; i++) await web.take("polygon-rpc");
      assert.equal((await web.take("polygon-rpc")).state, "hold");
      web.flush(); reg.close();
      reg = openRegistry(file);   // the deploy restarts the web
      const again = new ApiBudget({ role: "web", store: statusTableStore(reg.db), now: c.now, sleep: c.sleep });
      assert.equal(again.used("polygon-rpc"), 600, "continues from the pre-restart count");
      assert.equal((await again.take("polygon-rpc")).state, "hold", "the spent share is not spent twice");
      assert.match(alerts.find((a) => a.level === "hold")!.text, /^The Burnticker site used all of its own share of today's budget for Polygon public RPC \(600 of 600 requests\)/);
    } finally { reg.close(); fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test("the day rolls at 00:00 UTC, not before", async () => {
    const { dir, file } = scratch();
    const c = clock(Date.parse("2026-10-19T23:59:59Z"));
    const reg = openRegistry(file);
    try {
      const b = new ApiBudget({ role: "keeper", store: statusTableStore(reg.db), now: c.now, sleep: async () => {}, flushMs: 0 });
      await take(b, 4);
      assert.equal(b.used("polygon-rpc"), 4);
      c.set(Date.parse("2026-10-20T00:00:00Z"));
      assert.equal(b.used("polygon-rpc"), 0, "a new UTC day starts from zero");
      await take(b, 1);
      assert.equal(JSON.parse(reg.getStatus("apiBudget.day.keeper.polygon-rpc")!).day, "2026-10-20");
      const restarted = new ApiBudget({ role: "keeper", store: statusTableStore(reg.db), now: c.now, sleep: c.sleep });
      assert.equal(restarted.used("polygon-rpc"), 1);
    } finally { reg.close(); fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test("the keeper's status line names its share and prints the site's persisted count beside it (the audit's two numbers)", async () => {
    const { dir, file } = scratch();
    const c = clock(Date.parse("2026-10-19T22:09:00Z"));
    const reg = openRegistry(file);
    try {
      reg.setStatus("apiBudget.day.web.polygon-rpc", { day: "2026-10-19", used: 600 }, c.now());
      const keeper = new ApiBudget({ role: "keeper", store: statusTableStore(reg.db), now: c.now, sleep: async () => { c.advance(60_000); }, flushMs: 0, maxWaitMs: 1e12 });
      await take(keeper, 210);
      const line = budgetStatusLines(keeper.lines()).find((l) => l.includes(" polygon-rpc:"))!;
      assert.equal(line, "api budget polygon-rpc: 210 / 600 requests today (35%) · ok · keeper share; site 600 / 600");
      // a source only one process reads has no share tail
      await keeper.take("fred"); keeper.flush();
      assert.match(budgetStatusLines(keeper.lines()).find((l) => l.includes(" fred:"))!, /· ok · keeper share; site 0 \/ /);
      const lone = new ApiBudget({ role: "keeper", now: c.now, sleep: c.sleep });
      await lone.take("polygon-rpc");
      assert.doesNotMatch(budgetStatusLines(lone.lines())[0], /share/, "no store: nothing to read beside it");
    } finally { reg.close(); fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test("the reworded alert passes the copy lint", () => {
    const s = "The Burnticker site used all of its own share of today's budget for Polygon public RPC (600 of 600 requests), so it stopped reading from it until midnight UTC.";
    const r = lintCopy(s);
    assert.equal(r.ok, true, r.hits.map((h) => h.phrase).join(", "));
  });
});
