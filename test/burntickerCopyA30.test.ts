// PRELAUNCH AUDIT 2026-10-18 A-30, the trust items: the bounty page read "5 to 10 SOL for each valid report" while 5 SOL was funded in
// all; the whitepaper said the pair program's upgrade authority was "to be finalised before the first public pair"; "verify this mint →".
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { BOUNTY_COPY } from "@/lib/burnticker/historyCopy";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");

describe("A-30 trust copy", () => {
  test("the bounty range says what is funded, and the page passes the funded amount", () => {
    const t = BOUNTY_COPY.range(5, 10, 5);
    assert.match(t, /The draft terms set aside 5 to 10 SOL for each valid report/);
    assert.match(t, /funded with 5 SOL in all, so today it can pay one report at the low end/);
    assert.ok(!/→|\bwill\b|payout/i.test(t));
    assert.ok(lintCopy(t, loadCopyLintConfig()).ok, JSON.stringify(lintCopy(t, loadCopyLintConfig()).hits));
    assert.match(read("src/app/burnticker/bounty/page.tsx"), /BOUNTY_COPY\.range\(range\[0\], range\[1\], funded\)/);
  });
  test("the whitepaper names who holds the pair program's upgrade authority today; no arrow on the lookalike page", () => {
    for (const f of ["docs/burnticker/WHITEPAPER.md", "site/burnticker/whitepaper.html"]) assert.ok(!/to be finalised before the first public pair/.test(read(f)), f);
    assert.ok(!/verify this mint →/.test(read("src/app/burnticker/not-burnticker/page.tsx")));
  });
});
