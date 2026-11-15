import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { PublicKey } from "@solana/web3.js";
import { formatBuybackMemo, formatDebtMemo, memoFromChain, parseBuybackMemo, parseDebtMemo } from "../src/lib/burnReceipts/memo.ts";
import type { ReadingAccount, TokenConfigAccount } from "../src/lib/burnReceipts/accounts.ts";
import { MODE_BUYBACK, MODE_VAULT } from "../src/lib/burnReceipts/constants.ts";

/** The canonical memo: byte-for-byte the SPEC §4 example and the program's own output (Rust memo::tests use the same strings). */
const SPEC_V1 = "DEBT|2026-10-08|src=fiscaldata.treasury.gov debt_to_penny|prev=40284036147367.19|now=40305316210829.72|delta=21280063462.53|units=21|burn=2100000|rules=sha256:123456789abc|v1";
const SPEC_V1_SHORT = "DEBT|2026-10-08|src=fiscaldata.treasury.gov debt_to_penny|prev=40284036147367.19|now=40305316210829.72|delta=21280063462.53|units=21|burn=1500000|short=600000|rules=sha256:123456789abc|v1";
const V2 = "DEBT|2026-10-08|src=fiscaldata.treasury.gov debt_to_penny|prev=40284036147367.19|now=40305316210829.72|delta=21280063462.53|units=21|pool=1000000000|spent=659438374|got=123.45|burn=123.45|swap=CPMMoo8L3F4N|rules=sha256:ffffffffffff|v2";

const head = { prefix: "DEBT", recordDate: "2026-10-08", source: "fiscaldata.treasury.gov debt_to_penny", prev: "40284036147367.19", now: "40305316210829.72", delta: "21280063462.53", units: 21 };

describe("burnReceipts memo", () => {
  test("v1 formats the spec example exactly, with and without a shortfall, and round-trips", () => {
    assert.equal(formatDebtMemo({ ...head, burn: "2100000", rulesSha12: "123456789abc", version: "v1" }), SPEC_V1);
    assert.equal(formatDebtMemo({ ...head, burn: "1500000", short: "600000", rulesSha12: "123456789abc", version: "v1" }), SPEC_V1_SHORT);
    assert.deepEqual(parseDebtMemo(SPEC_V1)?.burn, "2100000");
    assert.equal(parseDebtMemo(SPEC_V1_SHORT)?.short, "600000");
    assert.equal(parseDebtMemo(SPEC_V1.replace("units=21", "units=021")), null);
  });
  test("v2 (buyback) formats and round-trips; spent > pool is refused", () => {
    const m = { ...head, pool: "1000000000", spent: "659438374", got: "123.45", burn: "123.45", swap: "CPMMoo8L3F4N", rulesSha12: "ffffffffffff", version: "v2" as const };
    assert.equal(formatBuybackMemo(m), V2);
    assert.deepEqual(parseBuybackMemo(V2), m);
    assert.throws(() => formatBuybackMemo({ ...m, spent: "1000000001" }), /spent > pool/);
    assert.equal(parseBuybackMemo(V2.replace("swap=CPMMoo8L3F4N", "swap=0OIl")), null);
    assert.ok(Buffer.byteLength(V2) <= 566);
  });

  const cfg = (mode: number): TokenConfigAccount => ({
    memoPrefix: "DEBT", memoSource: "fiscaldata.treasury.gov debt_to_penny", rules_sha256: Uint8Array.from([0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, ...new Array(26).fill(0)]),
    rule: { mode, value_decimals: 2 }, cpmm_pool: new PublicKey("CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C"),
  } as unknown as TokenConfigAccount);
  const reading = (o: Partial<ReadingAccount>): ReadingAccount => ({
    processed: true, units: BigInt(21), record_date: 20261008, prev_value: BigInt("4028403614736719"), value: BigInt("4030531621082972"), delta: BigInt("2128006346253"),
    outcome: 2, burned: BigInt(0), shortfall: BigInt(0), pool_lamports: BigInt(0), spent_lamports: BigInt(0), got: BigInt(0), ...o,
  } as ReadingAccount);

  test("memoFromChain rebuilds what the program wrote, from the accounts alone", () => {
    assert.equal(memoFromChain(cfg(MODE_VAULT), reading({ burned: BigInt("1500000000000"), shortfall: BigInt("600000000000"), outcome: 4 }), 6), SPEC_V1_SHORT);
    const v2 = memoFromChain(cfg(MODE_BUYBACK), reading({ pool_lamports: BigInt(1_000_000_000), spent_lamports: BigInt(659_438_374), got: BigInt(123_450_000), burned: BigInt(123_450_000) }), 6);
    assert.equal(v2, V2.replace("ffffffffffff", "123456789abc"));
    assert.match(memoFromChain(cfg(MODE_BUYBACK), reading({ pool_lamports: BigInt(5), burned: BigInt(7_000_000) }), 6) ?? "", /\|spent=0\|got=0\|burn=7\|swap=none\|/);
    assert.equal(memoFromChain(cfg(MODE_VAULT), reading({ units: BigInt(0) }), 6), null);
    assert.equal(memoFromChain(cfg(MODE_VAULT), reading({ outcome: 5 }), 6), null);
    // Review L-5: a 3-decimal feed formats and round-trips (no hard-coded cents).
    const c3 = { ...cfg(MODE_VAULT), rule: { mode: MODE_VAULT, value_decimals: 3 } } as unknown as TokenConfigAccount;
    const m3 = memoFromChain(c3, reading({ prev_value: BigInt(2189), value: BigInt(2272), delta: BigInt(83), units: BigInt(8), burned: BigInt(8_000_000_000_000) }), 6);
    assert.match(m3 ?? "", /\|prev=2\.189\|now=2\.272\|delta=0\.083\|units=8\|burn=8000000\|/);
    assert.equal(parseDebtMemo(m3!)?.valueDecimals, 3);
  });
});
