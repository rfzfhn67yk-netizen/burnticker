// 2026-10-15 prelaunch audit H6: a creator's title filter ran on JavaScript's backtracking engine on the one Node process; the star-height
// check let "a{1,100}a{1,100}a{1,100}a{1,100}b" through, validateRule did not call the check, and the back-test route had no limiter.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { compileLinear, LinearRegexUnsupported } from "@/lib/burnticker/linearRegex";
import { regexProblem, safeRegexTest } from "@/lib/burnticker/safeRegex";
import { validateRule } from "@/lib/burnticker/rules";
import { BRONCOS } from "./burntickerHelpers.ts";
import { makeWorld } from "./burntickerApiHelpers.ts";

const POLY = "a{1,100}a{1,100}a{1,100}a{1,100}b";

describe("title filters (H6)", () => {
  test("a pattern that passed the old check but backtracks for seconds runs in milliseconds", () => {
    assert.equal(regexProblem(POLY), null, "it is a plain-looking pattern");
    const t0 = performance.now();
    assert.equal(safeRegexTest(POLY, "a".repeat(299)), false);
    assert.equal(safeRegexTest(POLY, "a".repeat(150) + "b"), true);
    assert.ok(performance.now() - t0 < 200, `took ${Math.round(performance.now() - t0)} ms`);
  });

  test("the matcher agrees with JavaScript's own engine (randomised patterns and titles)", () => {
    const atoms = ["a", "b", "c", ".", "\\d", "\\w", "\\s", "\\W", "[ab]", "[^a]", "[a-c]", "(a|b)", "(?:ab|c)", "\\.", "x", " ", "\\bD", "^", "$", "\\B"];
    const quants = ["", "", "", "*", "+", "?", "{2}", "{1,3}", "{0,2}", "*?", "+?"];
    let seed = 12345;
    const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
    const alphabet = "abcx D.1 \n";
    let checked = 0;
    for (let k = 0; k < 3000; k++) {
      let p = "";
      for (let j = 0, n = 1 + rnd(5); j < n; j++) { const a = atoms[rnd(atoms.length)]; p += a + (a === "^" || a === "$" || a === "\\B" || a === "\\bD" ? "" : quants[rnd(quants.length)]); }
      if (rnd(4) === 0) p = `(${p})${quants[rnd(quants.length)]}`;
      if (rnd(5) === 0) p += `|${atoms[rnd(atoms.length)]}`;
      let native: RegExp;
      try { native = new RegExp(p); } catch { continue; }
      let lin;
      try { lin = compileLinear(p); } catch (e) { assert.ok(e instanceof LinearRegexUnsupported, `${p}: ${(e as Error).message}`); continue; }
      for (let t = 0; t < 8; t++) {
        let s = ""; for (let j = 0, n = rnd(9); j < n; j++) s += alphabet[rnd(alphabet.length)];
        assert.equal(lin.test(s), native.test(s), `/${p}/ on ${JSON.stringify(s)}`);
        checked++;
      }
    }
    assert.ok(checked > 10_000, `checked ${checked}`);
    // the patterns the wizard and the fixtures write
    for (const [p, s, want] of [["^[^:]+ vs\\. [^:]+$", "Broncos vs. Chiefs", true], ["^[^:]+ vs\\. [^:]+$", "Broncos vs. Chiefs: O/U", false], ["Denver Broncos", "Will the Denver Broncos win?", true], ["\\d{2,4}", "in 2026", true], ["(Win|Loss)", "a Loss", true], ["\\u0041\\x42", "AB", true], ["[\\d-x]", "-", true], ["(?<n>ab)+", "abab", true], ["[]a", "a", false], ["a{,2}", "a{,2}", true]] as const) assert.equal(compileLinear(p).test(s), want, `${p} on ${s}`);
  });

  test("case-insensitive matching canonicalises both sides the JavaScript way (σ/ς/Σ, μ/µ, ſ, ß/ẞ, the Kelvin sign, ı/İ)", () => {
    const chars = ["σ", "ς", "Σ", "μ", "µ", "Μ", "ſ", "s", "S", "ß", "ẞ", "\u212A", "k", "K", "ı", "I", "i", "İ", "ǅ", "ǆ", "Ǆ", "a", "A", "_", "1", "\n"];
    const pats = [...chars.filter((c) => c !== "\n"), "[a-z]", "[A-Z]", "[^a-z]", "[^A-Z]", "\\w", "\\W", "[σ-ω]", "[^σ]", "[k]", "[ſ]", "[\\w]", "[^\\W]", ".", "[ı-ı]", "\\s", "[ß]", "[Ά-ώ]"];
    let n = 0;
    for (const p of pats) {
      const lin = compileLinear(p, "i"), nat = new RegExp(`^(?:${p})$`, "i"), linA = compileLinear(`^(?:${p})$`, "i");
      for (const c of chars) { assert.equal(linA.test(c), nat.test(c), `/${p}/i on ${JSON.stringify(c)}`); assert.equal(lin.test(c), new RegExp(p, "i").test(c), `/${p}/i search on ${JSON.stringify(c)}`); n++; }
    }
    assert.ok(n > 1000);
  });

  test("lookarounds and backreferences are refused (they are what makes matching slow)", () => {
    for (const p of ["(?=a)a", "(?!a)b", "(?<=a)b", "(a)\\1", "(?<x>a)\\k<x>"]) assert.ok(regexProblem(p), p);
    assert.throws(() => compileLinear("(?=a)"), LinearRegexUnsupported);
  });

  test("validateRule runs the check, so the back-test and the API refuse an unsafe filter; a stored rule stays readable", () => {
    assert.throws(() => validateRule({ ...BRONCOS, filter: { titleRegex: "(a+)+$" } }), /titleRegex/);
    assert.throws(() => validateRule({ ...BRONCOS, filter: { titleRegex: "(?=x)y" } }), /lookahead/);
    assert.doesNotThrow(() => validateRule({ ...BRONCOS, filter: { titleRegex: "(a+)+$" } }, { stored: true }));
    assert.doesNotThrow(() => validateRule({ ...BRONCOS, filter: { titleRegex: "^Denver" } }));
  });

  test("a STORED rule whose filter this build refuses fails loud: the keeper holds the coin and raises rule-filter-unsupported, once", async () => {
    const w = await makeWorld();
    const { planToken } = await import("@/lib/burnticker/multiKeeper");
    const { FilterUnsupportedError } = await import("@/lib/burnticker/safeRegex");
    const { lockRule } = await import("@/lib/burnticker/rules");
    const { PUSH_KIND_OF_ALERT } = await import("@/lib/burnticker/push");
    const stored = lockRule({ ...(JSON.parse(w.bronco.rulesJson) as object), filter: { titleRegex: "(?=Denver)Denver" } }, { stored: true });
    const logs: string[] = [];
    const d = { registry: w.registry, log: (x: string) => logs.push(x), now: () => Date.now() } as never;
    assert.throws(() => planToken(d, w.bronco, stored), FilterUnsupportedError);
    assert.throws(() => planToken(d, w.bronco, stored), FilterUnsupportedError);
    const alerts = w.registry.alertsSince(0).filter((a) => a.kind === "rule-filter-unsupported");
    assert.equal(alerts.length, 1, "alerted once");
    assert.match(alerts[0].text, /lookahead/);
    assert.equal(logs.filter((l) => l.includes("[held]")).length, 1);
    assert.ok(PUSH_KIND_OF_ALERT["rule-filter-unsupported"], "it reaches the phone");
    // a stored rule with a filter this build runs is planned as before
    assert.doesNotThrow(() => planToken(d, w.bronco, w.registry.lockedRule(w.bronco)));
  });

  test("the back-test route is rate limited as a heavy read and caps its body", async () => {
    await makeWorld();
    const { POST } = await import("@/app/api/burnticker/oracle/backtest/route");
    const req = (body: string) => new Request("https://burnticker.com/api/burnticker/oracle/backtest", { method: "POST", headers: { "content-type": "application/json", "sec-fetch-site": "same-origin", "x-forwarded-for": "198.51.100.200" }, body });
    const big = await POST(req(JSON.stringify({ rule: { pad: "x".repeat(70_000) } })));
    assert.equal(big.status, 413);
    const statuses: number[] = [];
    for (let i = 0; i < 25; i++) statuses.push((await POST(req("not json"))).status);
    assert.ok(statuses.includes(429), "a client past the heavy bucket is refused");
  });
});
