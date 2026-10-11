// THE GTM PACK DOCS (2026-10-10): every pitch and outreach draft in docs/launch/gtm passes the copy lint; drafts fit 600 characters; the
// pack never names the venue whose terms forbid it and never calls the reviews an audit; PLAN.md stays byte-identical to the owner's
// plan of record (mct-runner-study/launch-debt-egg-2026-10-09/PRE-LAUNCH-MARKETING-PLAN.md, saved 2026-10-10).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { lintCopy, loadCopyLintConfig, formatHits } from "@/lib/launch/copyLint";

const cfg = loadCopyLintConfig();
const DIR = "docs/launch/gtm";
const read = (f: string) => fs.readFileSync(`${DIR}/${f}`, "utf8");
const blocks = (md: string, kind: "pitch" | "draft" | "edit") => [...md.matchAll(new RegExp("```text " + kind + "\\n([\\s\\S]*?)```", "g"))].map((m) => m[1].trim());

describe("docs/launch/gtm", () => {
  test("PLAN.md is the owner's plan of record, byte for byte", () => {
    assert.equal(crypto.createHash("sha256").update(fs.readFileSync(`${DIR}/PLAN.md`)).digest("hex"), "2556dc5f11b105691518444f434cb0e655212bf4d9c46e308d81b3f8ab3f6c40");
  });
  test("PITCHES.md: six audiences × (1-line, 3-line, paragraph), every one lint-clean", () => {
    const p = blocks(read("PITCHES.md"), "pitch");
    assert.equal(p.length, 18);
    for (const t of p) assert.equal(lintCopy(t, cfg).ok, true, `${t}\n${formatHits(lintCopy(t, cfg))}`);
    for (let i = 0; i < 18; i += 3) { assert.equal(p[i].split("\n").length, 1, "1-line"); assert.equal(p[i + 1].split("\n").length, 3, "3-line"); }
  });
  test("OUTREACH.md: every draft ≤ 600 characters and lint-clean", () => {
    const d = blocks(read("OUTREACH.md"), "draft");
    assert.ok(d.length >= 10, `${d.length} drafts`);
    for (const t of d) { assert.ok([...t].length <= 600, `${[...t].length}: ${t}`); assert.equal(lintCopy(t, cfg).ok, true, `${t}\n${formatHits(lintCopy(t, cfg))}`); }
  });
  test("COLD-READ.md: every suggested replacement is lint-clean", () => {
    const e = blocks(read("COLD-READ.md"), "edit");
    assert.ok(e.length >= 10, `${e.length} edits`);
    for (const t of e) assert.equal(lintCopy(t, cfg).ok, true, `${t}\n${formatHits(lintCopy(t, cfg))}`);
  });
  test("the pack (everything but the verbatim plan) never names the unnamed venue and never claims an audit", () => {
    for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith(".md") && x !== "PLAN.md")) {
      const t = read(f);
      assert.doesNotMatch(t, /kalshi/i, f);
      const claims = [...blocks(t, "pitch"), ...blocks(t, "draft"), ...blocks(t, "edit")].join("\n").replace(/not audited by a security firm|no security firm has audited|not a firm audit|pre-audit/gi, "");
      assert.doesNotMatch(claims, /\baudit(ed|s)?\b/i, f);
    }
  });
});
