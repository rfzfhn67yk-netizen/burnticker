// The whitepaper page is a rendering of docs/burnticker/WHITEPAPER.md (scripts/whitepaper-html.mjs). This keeps the committed
// HTML byte-identical to a fresh render, so the page can never drift from the paper; and keeps the paper inside the copy lint.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { renderWhitepaper, WHITEPAPER_HTML, WHITEPAPER_MD } from "../scripts/whitepaper-html.mjs";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";

const ROOT = process.cwd();
const md = fs.readFileSync(path.join(ROOT, WHITEPAPER_MD), "utf8");

test("site/burnticker/whitepaper.html equals a fresh render of WHITEPAPER.md (run node scripts/whitepaper-html.mjs after editing the paper)", () => {
  const committed = fs.readFileSync(path.join(ROOT, WHITEPAPER_HTML), "utf8");
  assert.equal(committed, renderWhitepaper(md));
});

test("the whitepaper passes the copy lint (no price talk, no promises)", () => {
  const r = lintCopy(md, loadCopyLintConfig());
  assert.ok(r.ok, JSON.stringify(r).slice(0, 600));
});

test("the landing page links the whitepaper", () => {
  assert.match(fs.readFileSync(path.join(ROOT, "site/burnticker/index.html"), "utf8"), /href="whitepaper\.html"/);
});
