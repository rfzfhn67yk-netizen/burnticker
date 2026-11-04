// THE REVIEW OF THE A-1/A-4/A-5/A-6 FIXES (2026-10-18): the audit's chain leg, the daily program check, the never-buys monitor, the
// dispersal lines, a hand run's refusal, the changelog comment and the green badge.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chainCheck } from "@/lib/burnticker/audit";
import type { BurnProgramClient } from "@/lib/burnticker/program";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");

describe("review 1: the audit reads a receipt's own transaction; what the chain cannot show is not a mismatch", () => {
  const MEMO = "DENWIN|20261016|x";
  const prog = (o: { tx?: { memo: string | null; slot: number | null; failed: boolean } | null; found?: { signature: string; slot: number | null; memo: string } | null }) => {
    let scans = 0, reads = 0;
    const p = { memoOfTransaction: async () => { reads++; return o.tx ?? null; }, findReceiptOnChain: async () => { scans++; return o.found ?? null; } } as unknown as BurnProgramClient;
    return { p, calls: () => ({ scans, reads }) };
  };
  const r = (signature: string | null, memo = MEMO) => ({ signature, memo, execution: "program", eventId: "2026-10-16" });
  test("a signature: one read of that transaction, no scan; equal memo verifies, a different one or a failed transaction is a mismatch", async () => {
    const a = prog({ tx: { memo: MEMO, slot: 1, failed: false } });
    assert.deepEqual(await chainCheck(a.p, "M", "DENWIN", r("S".repeat(88))), { kind: "verified" });
    assert.deepEqual(a.calls(), { scans: 0, reads: 1 });
    assert.equal((await chainCheck(prog({ tx: { memo: "other", slot: 1, failed: false } }).p, "M", "DENWIN", r("S".repeat(88)))).kind, "mismatch");
    assert.equal((await chainCheck(prog({ tx: { memo: MEMO, slot: 1, failed: true } }).p, "M", "DENWIN", r("S".repeat(88)))).kind, "mismatch");
  });
  test("a transaction the node does not serve, or an old receipt outside the scan window, is not checked, never a mismatch", async () => {
    assert.equal((await chainCheck(prog({ tx: null }).p, "M", "DENWIN", r("S".repeat(88)))).kind, "unchecked");
    assert.equal((await chainCheck(prog({ found: null }).p, "M", "DENWIN", r(null))).kind, "unchecked");
  });
  test("the audit script counts its chain reads in the API budget", () => {
    const s = read("scripts/burnticker-audit.mts");
    assert.match(s, /configureApiBudget\(\{ role: "keeper", store: statusTableStore\(registry\.db\)/);
    assert.match(s, /new Connection\(rpc, budgetedRpcConfig\(/);
  });
});

describe("review 7: the badge counts what the chain verified; the changelog comment says where monorepo commits still are", () => {
  test("'checked on chain' counts only verified receipts, never forwards or receipts the chain could not show", async () => {
    const { auditBadgeView } = await import("@/lib/burnticker/auditBadge");
    const v = auditBadgeView({ ok: true, receipts: 6, executed: 4, chainVerified: 2, mismatches: 0, chainChecked: true });
    assert.equal(v.text, "All 4 completed receipts recompute; 2 checked on chain");
    assert.match(v.sub ?? "", /4 receipts checked against the source, 2 of them against the chain too; 2 more are waiting to run/);
    assert.equal(auditBadgeView({ ok: true, receipts: 4, executed: 4, chainVerified: 3, mismatches: 0, chainChecked: false }).text, "All 4 completed receipts recompute", "no chain claim without a chain check");
    assert.match(read("scripts/burnticker-keeper.mts"), /chainVerified: audit\.chainVerified/);
  });
  test("the comment no longer says the monorepo commit never leaves the server", () => {
    const h = read("src/lib/burnticker/history.ts");
    assert.ok(!/never leaves the server/.test(h));
    assert.match(h, /verified-build\.json's sourceCommit/);
  });
});
