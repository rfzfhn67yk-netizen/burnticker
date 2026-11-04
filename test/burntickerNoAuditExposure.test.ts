// OWNER DECISION 2026-10-22: the site stops publishing its internal reviews. No press page, no review list, counts or re-check notes;
// one honest line says that no security firm has audited the code (transparency.json howBuilt.firmAuditStatement, on the Trust page).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { LEARN_NAV } from "@/lib/burnticker/siteNav.mjs";
import { STATIC_PAGES } from "@/lib/burnticker/sitemap";
import { GUARDRAILS, GUARDRAIL_DETAIL, GUARDRAIL_SUMMARY } from "@/lib/burnticker/safeguards";
import { HISTORY_COPY, historyCountsLine } from "@/lib/burnticker/historyCopy";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const SENTENCE = "No security firm has audited the code.";
const REVIEW_WORDS = /blind review|AI review|re-check/i;

describe("no audit exposure on the site", () => {
  test("the press page is gone: no route, no nav entry, no sitemap entry", () => {
    assert.ok(!fs.existsSync(path.join(ROOT, "src/app/burnticker/press")));
    assert.ok(!LEARN_NAV.some((l) => l.href === "/burnticker/press" || l.label === "Press"));
    assert.ok(!STATIC_PAGES.some((p) => p.path === "/burnticker/press"));
    assert.ok(!HISTORY_COPY.links.some((l) => l.href === "/burnticker/press"));
  });
  test("the trust page states the firm-audit sentence exactly once, and no review wording", () => {
    const t = JSON.parse(read("config/burnticker/transparency.json")) as { howBuilt: Record<string, unknown> & { statement: string; firmAuditStatement: string } };
    assert.equal(t.howBuilt.firmAuditStatement, SENTENCE);
    const copy = [read("src/app/burnticker/trust/page.tsx"), read("src/app/burnticker/trust/layout.tsx"), t.howBuilt.statement, t.howBuilt.firmAuditStatement,
      GUARDRAIL_SUMMARY, ...GUARDRAILS, ...GUARDRAILS.map((g) => GUARDRAIL_DETAIL[g].text)].join("\n");
    assert.equal(copy.split(SENTENCE).length - 1, 1);
    assert.doesNotMatch(copy, REVIEW_WORDS);
    assert.match(read("src/app/burnticker/trust/page.tsx"), /data-firm-audit>\{x\.howBuilt\.firmAuditStatement\}/);
  });
  test("transparency.json howBuilt has no review list, tooling status or reviews rule", () => {
    const t = JSON.parse(read("config/burnticker/transparency.json")) as { howBuilt: Record<string, unknown> };
    for (const k of ["reviews", "tooling", "toolingStatus", "reviewsDir", "reviewsRule"]) assert.ok(!(k in t.howBuilt), k);
    assert.doesNotMatch(read("config/burnticker/transparency.json"), /blind review|AI review|independent re-check/i);
  });
  test("the current-status file and the home line count no reviews", () => {
    const st = JSON.parse(read("config/burnticker/current-status.json")) as Record<string, unknown>;
    assert.ok(!("reviews" in st));
    assert.doesNotMatch(read("config/burnticker/current-status.json"), /blind|independent re-check|docs\/burnticker\/reviews/i);
    assert.match(read("src/lib/burnticker/currentStatus.ts"), /"No security firm has audited the code\.",/);
    assert.equal(historyCountsLine({ releases: 3 }), "There have been 3 releases since Oct 10.");
  });
  test("the review reports are not in the public docs folder", () => {
    assert.ok(!fs.existsSync(path.join(ROOT, "docs/burnticker/reviews")));
    assert.ok(!fs.existsSync(path.join(ROOT, "docs/burnticker/audits/launch-wizard-audit-2026-10-19.md")));
  });
});
