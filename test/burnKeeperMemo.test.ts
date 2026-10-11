// BURN KEEPER (2026-10-09) — the canonical memo (SPEC §4): the spec's example byte for byte, the round trip, the `short=` field
// (vesting vault, 10-09 evening) only when above zero, the 566-byte ceiling, and the parser refusing anything not canonical.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { formatBuybackMemo, formatDebtMemo, memoDateKey, MEMO_MAX_BYTES, parseBuybackMemo, parseDebtMemo, type BuybackMemo, type DebtMemo } from "@/lib/burnKeeper/memo";
import { burnMemo } from "@/lib/burnKeeper/plan";
import { loadRules, usdToCents } from "@/lib/burnKeeper/rules";
import path from "node:path";

const SPEC: DebtMemo = { prefix: "DEBT", recordDate: "2026-10-08", source: "fiscaldata.treasury.gov debt_to_penny", prev: "40284036147367.19", now: "40305316210829.72", delta: "21280063462.53", units: 21, burn: "2100000", rulesSha12: "0123456789ab", version: "v1" };
const SPEC_TEXT = "DEBT|2026-10-08|src=fiscaldata.treasury.gov debt_to_penny|prev=40284036147367.19|now=40305316210829.72|delta=21280063462.53|units=21|burn=2100000|rules=sha256:0123456789ab|v1";

describe("format", () => {
  test("the spec's example, exactly", () => assert.equal(formatDebtMemo(SPEC), SPEC_TEXT));
  test("short= sits between burn= and rules=, only when given", () => {
    assert.equal(formatDebtMemo({ ...SPEC, burn: "1500000", short: "600000" }), SPEC_TEXT.replace("burn=2100000", "burn=1500000|short=600000"));
    assert.throws(() => formatDebtMemo({ ...SPEC, short: "0" }), /short/, "a zero shortfall is omitted, never written");
  });
  test("burnMemo builds it from the ledger's cents and raw units, with the real rule file's prefix and source", () => {
    const { rules } = loadRules(path.resolve(import.meta.dirname, "../config/burnkeeper/deficit.rules.json"));
    const m = burnMemo(rules, "0123456789ab", { recordDate: "2026-10-08", prevCents: usdToCents("40284036147367.19"), nowCents: usdToCents("40305316210829.72"), deltaCents: usdToCents("21280063462.53"), units: 21 }, BigInt(2_100_000_000_000));
    assert.equal(m, SPEC_TEXT);
    const s = burnMemo(rules, "0123456789ab", { recordDate: "2026-10-08", prevCents: usdToCents("40284036147367.19"), nowCents: usdToCents("40305316210829.72"), deltaCents: usdToCents("21280063462.53"), units: 21 }, BigInt(0), BigInt(2_100_000_000_000));
    assert.match(s, /\|burn=0\|short=2100000\|/, "a memo-only shortfall day");
  });
  test("bad fields refuse; a negative delta (never burned) still formats", () => {
    assert.throws(() => formatDebtMemo({ ...SPEC, prev: "40284036147367.1" }), /prev/);
    assert.throws(() => formatDebtMemo({ ...SPEC, source: "a|b" }), /source/);
    assert.throws(() => formatDebtMemo({ ...SPEC, rulesSha12: "XYZ" }), /rulesSha12/);
    assert.throws(() => formatDebtMemo({ ...SPEC, units: -1 }), /units/);
    assert.match(formatDebtMemo({ ...SPEC, delta: "-5.00", units: 0, burn: "0" }), /delta=-5\.00/);
  });
  test("≤ 566 bytes: a real memo is ~170; an oversize one throws", () => {
    assert.ok(Buffer.byteLength(SPEC_TEXT) < 200);
    assert.throws(() => formatDebtMemo({ ...SPEC, source: "x".repeat(MEMO_MAX_BYTES) }), /566-byte/);
  });
});

describe("parse", () => {
  test("round trip, with and without short=", () => {
    assert.deepEqual(parseDebtMemo(SPEC_TEXT), SPEC);
    const withShort = formatDebtMemo({ ...SPEC, burn: "1.5", short: "2099998.5" });
    assert.deepEqual(parseDebtMemo(withShort), { ...SPEC, burn: "1.5", short: "2099998.5" });
  });
  test("anything not canonical is null: reordered fields, a v2, extra spaces, another program's memo", () => {
    assert.equal(parseDebtMemo(SPEC_TEXT.replace("|v1", "|v2")), null);
    assert.equal(parseDebtMemo(SPEC_TEXT.replace("units=21|burn=2100000", "burn=2100000|units=21")), null);
    assert.equal(parseDebtMemo(SPEC_TEXT.replace("prev=", "prev= ")), null);
    assert.equal(parseDebtMemo("gm"), null);
    assert.equal(parseDebtMemo(SPEC_TEXT.replace("burn=2100000", "burn=02100000")), null, "a non-canonical number does not round-trip");
  });
  test("the date key the keeper searches its own history for", () => {
    assert.equal(memoDateKey("DEBT", "2026-10-08"), "DEBT|2026-10-08|");
    assert.ok(SPEC_TEXT.startsWith(memoDateKey("DEBT", "2026-10-08")));
  });
});

describe("v2 — the buyback memo", () => {
  const V2: BuybackMemo = { prefix: "DEBT", recordDate: "2026-10-08", source: "fiscaldata.treasury.gov debt_to_penny", prev: "40284036147367.19", now: "40305316210829.72", delta: "21280063462.53", units: 21, pool: "4980000000", spent: "3291573291", got: "3291573.291573", burn: "3291573.291573", swap: "5KJp7xYzAbCd", rulesSha12: "0123456789ab", version: "v2" };
  const TEXT = "DEBT|2026-10-08|src=fiscaldata.treasury.gov debt_to_penny|prev=40284036147367.19|now=40305316210829.72|delta=21280063462.53|units=21|pool=4980000000|spent=3291573291|got=3291573.291573|burn=3291573.291573|swap=5KJp7xYzAbCd|rules=sha256:0123456789ab|v2";
  test("the brief's field order exactly, and a round trip", () => {
    assert.equal(formatBuybackMemo(V2), TEXT);
    assert.deepEqual(parseBuybackMemo(TEXT), V2);
    assert.ok(Buffer.byteLength(TEXT) <= MEMO_MAX_BYTES);
  });
  test("refuses spent > pool, a malformed swap id, a v1 tail; v1 and v2 never parse as each other", () => {
    assert.throws(() => formatBuybackMemo({ ...V2, spent: "4980000001" }), /spent > pool/);
    assert.throws(() => formatBuybackMemo({ ...V2, swap: "short" }), /swap/);
    assert.equal(parseBuybackMemo(TEXT.replace("|v2", "|v1")), null);
    assert.equal(parseDebtMemo(TEXT), null);
    assert.equal(parseBuybackMemo(SPEC_TEXT), null);
    assert.ok(formatBuybackMemo({ ...V2, swap: "none", got: "0", burn: "7" }).includes("|swap=none|"), "a dust-only burn says so");
  });
});
