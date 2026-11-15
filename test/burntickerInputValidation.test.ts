// WEBSITE AUDIT 4 (2026-10-11), BT-06 + BT-07: the burn calculator validates every field and never substitutes a value (101 % and "abc"
// are errors, not 100 % and 0.01 %), and the receipt verifier tells a typing error apart from evidence: a malformed or missing signature
// is a field error with no checks run, no failed verdict and no explorer link; missing transaction / RPC unavailable / mismatch are
// decided by the checks.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parseCalcInputs, parseDecimal, type CalcRaw } from "@/lib/burnticker/burnMath";
import { checkReceiptTx, classifySignatureInput, type Rpc } from "@/lib/burnticker/trustpack/receiptCheck";
import { verdictOf } from "@/lib/burnticker/verificationStatus";
import { PROGRAM_IDS } from "@/lib/burnticker/networks";
import { b58encode } from "@/lib/burnticker/trustpack/base58";

// a well-formed signature built at run time (the public leak scan keeps literal signatures in evidence files)
const VALID_SIG = b58encode(Uint8Array.from({ length: 64 }, (_, i) => (i * 37 + 11) % 256));

const ROOT = path.join(import.meta.dirname, "..");
const DEFAULTS: CalcRaw = { riseB: "23.92014814069", pct: "1", pool: "0.505583582", reserve: "1.0066192", tokRes: "" };
const calc = (o: Partial<CalcRaw>) => parseCalcInputs({ ...DEFAULTS, ...o });

describe("calculator input validation (BT-06)", () => {
  test("the defaults parse exactly (the real 2026-10-06 devnet receipt)", () => {
    const r = calc({}); assert.ok(r.ok);
    assert.deepEqual(r.values, { riseCents: BigInt("2392014814069"), bps: 100, poolLamports: BigInt(505583582), reserveLamports: BigInt(1006619200), tokenReserveRaw: null });
  });
  const bad: [string, Partial<CalcRaw>, keyof CalcRaw, RegExp][] = [
    ["101 %", { pct: "101" }, "pct", /between 0\.01 and 100/],
    ["abc", { pct: "abc" }, "pct", /not a number/],
    ["empty %", { pct: "" }, "pct", /required/],
    ["0 %", { pct: "0" }, "pct", /between 0\.01 and 100/],
    ["negative %", { pct: "-1" }, "pct", /0 or more/],
    ["three decimals of a percent", { pct: "1.005" }, "pct", /at most 2 decimal places/],
    ["exponent notation", { pct: "1e2" }, "pct", /not a number/],
    ["a lone dot", { riseB: "." }, "riseB", /not a number/],
    ["negative rise", { riseB: "-5" }, "riseB", /0 or more/],
    ["very large rise", { riseB: "99999999999" }, "riseB", /too large/],
    ["very large pool", { pool: "1e30" }, "pool", /not a number/],
    ["huge pool digits", { pool: "100000000000000" }, "pool", /too large/],
    ["empty reserve", { reserve: " " }, "reserve", /required/],
    ["zero token reserve", { tokRes: "0" }, "tokRes", /more than 0/],
  ];
  for (const [what, o, field, re] of bad) test(`${what} → an error on ${field}, no values`, () => {
    const r = calc(o); assert.equal(r.ok, false); assert.equal(r.values, null); assert.match(r.errors[field]!, re);
  });
  test("edges that are valid stay exactly as typed (no clamp)", () => {
    const a = calc({ pct: "100" }); assert.ok(a.ok); assert.equal(a.values.bps, 10_000);
    const b = calc({ pct: "0.01" }); assert.ok(b.ok); assert.equal(b.values.bps, 1);
    const c = calc({ pct: "2", riseB: "0", tokRes: "1000000" }); assert.ok(c.ok); assert.equal(c.values.bps, 200); assert.equal(c.values.riseCents, BigInt(0)); assert.equal(c.values.tokenReserveRaw, BigInt(1_000_000_000_000));
    assert.deepEqual(parseDecimal("1.5", 2, BigInt(1000)), { value: BigInt(150) });
  });
  test("the component shows field errors, suppresses the result and no longer clamps", () => {
    const c = fs.readFileSync(path.join(ROOT, "src/app/burnticker/_components/BurnMath.tsx"), "utf8");
    assert.match(c, /parseCalcInputs\(/); assert.match(c, /data-field-error=\{id\}/); assert.match(c, /aria-invalid/); assert.match(c, /data-burn-math-invalid/);
    assert.doesNotMatch(c, /Math\.min\(10_000|Math\.max\(1,|Number\(pct\) \|\| 0|Number\(riseB\) \|\| 0/, "no silent clamp or substitution");
  });
});

describe("receipt signature input (BT-07)", () => {
  const never: Rpc = { call: async () => { throw new Error("the RPC must not be called for a malformed signature"); } };
  const base = { cluster: "devnet" as const, programId: PROGRAM_IDS.devnet.burn_receipts, rulesText: null, fetchSource: null };
  test("classify: missing, malformed (characters, length), valid", () => {
    assert.equal(classifySignatureInput("  ").state, "missing");
    assert.equal(classifySignatureInput("not-a-signature").state, "malformed");
    assert.equal(classifySignatureInput("0OIl").state, "malformed");
    assert.match(classifySignatureInput("5xuhSqtdzUj5H6ue").reason!, /64 bytes/);
    assert.equal(classifySignatureInput(VALID_SIG).state, "valid");
  });
  test("a malformed signature: no checks, no verdict, no explorer link, no RPC call", async () => {
    for (const sig of ["not-a-signature", "", "abc def"]) {
      const r = await checkReceiptTx({ ...base, signature: sig, rpc: never });
      assert.ok(r.inputError, sig); assert.deepEqual(r.checks, []); assert.equal(r.facts.explorerUrl, null); assert.equal(r.verified, false);
    }
  });
  test("a valid signature the RPC cannot reach is 'could not check' (unavailable), one not on chain is a failed tx check — both with a real explorer link", async () => {
    const sig = VALID_SIG;
    const down = await checkReceiptTx({ ...base, signature: sig, rpc: { call: async () => { throw new Error("503"); } } });
    assert.equal(down.inputError ?? null, null); assert.equal(down.checks[0].ok, null); assert.equal(verdictOf(down.checks).verdict, "could not check");
    assert.equal(down.facts.explorerUrl, `https://explorer.solana.com/tx/${sig}?cluster=devnet`);
    const missing = await checkReceiptTx({ ...base, signature: sig, rpc: { call: async <T,>() => null as T } });
    assert.equal(missing.checks[0].ok, false); assert.match(missing.checks[0].detail, /no confirmed transaction/);
  });
  test("the verifier page validates before running and shows a field-level error", () => {
    const c = fs.readFileSync(path.join(ROOT, "src/app/burnticker/check/ReceiptVerifier.tsx"), "utf8");
    assert.match(c, /classifySignatureInput\(sig\)/); assert.match(c, /data-field-error="signature"/); assert.match(c, /\{res\.facts\.explorerUrl && <a/);
  });
});
