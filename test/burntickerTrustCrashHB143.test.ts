// HB-143 (hourly audit run 12, 2026-10-20): /burnticker/trust crashed on every load from publish 98 to publish 101 with
// "Cannot read properties of undefined (reading 'matchAll')". The public current-status answer drops whole-path fields
// (withoutRepoPaths, HB-46), so reviews[i].report and historical[i].path were missing, and RepoText passed them to splitRepoPaths.
// The splitter and RepoText now tolerate a missing text, and the summary's history sentence does without the path and the source.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { splitRepoPaths } from "@/lib/burnticker/currentStatusLinks";
import { withoutRepoPaths } from "@/lib/burnticker/publicPaths";

const ROOT = path.resolve(import.meta.dirname, "..");

describe("HB-143: the trust page survives the public current-status answer", () => {
  test("splitRepoPaths and RepoText take a missing text", () => {
    assert.deepEqual(splitRepoPaths(undefined), []);
    assert.deepEqual(splitRepoPaths(null), []);
    assert.deepEqual(splitRepoPaths(""), []);
    assert.deepEqual(splitRepoPaths("see docs/burnticker/API.md now").map((p) => p.path), [null, "docs/burnticker/API.md", null]);
  });
  test("the public answer really drops the fields the summary reads, so the summary must not assume them", () => {
    const raw = JSON.parse(fs.readFileSync(path.join(ROOT, "config/burnticker/current-status.json"), "utf8")) as { reviews?: { report?: string }[]; historical?: { path?: string }[]; source?: string };
    const pub = withoutRepoPaths(raw);
    // owner decision 2026-10-22: the file lists no reviews; the historical log paths are the repository paths the answer drops
    assert.ok(raw.reviews === undefined, "the file lists no reviews"); assert.ok((raw.historical ?? []).some((h) => typeof h.path === "string"), "the file names a log path");
    assert.ok((pub.reviews ?? []).every((r) => r.report === undefined || !/^(docs|config|src)\//.test(r.report)), "the public answer has no repo path in report");
    assert.ok((pub.historical ?? []).every((h) => h.path === undefined || !/^(docs|config|src)\//.test(h.path)), "the public answer has no repo path in historical");
  });
  test("the summary guards the path, the source and the report (source pattern)", () => {
    const src = fs.readFileSync(path.join(ROOT, "src/app/burnticker/_components/CurrentStatusSummary.tsx"), "utf8");
    assert.match(src, /key=\{h\.path \?\? h\.label\}/);
    assert.match(src, /\{h\.path \? <> in <RepoText text=\{h\.path\} \/><\/> : null\}/);
    assert.match(src, /\{s\.source \? <> This summary comes from <RepoText text=\{s\.source\} \/>\.<\/> : null\}/);
    const repo = fs.readFileSync(path.join(ROOT, "src/app/burnticker/_components/RepoText.tsx"), "utf8");
    assert.match(repo, /if \(!text\) return null;/);
  });
});
