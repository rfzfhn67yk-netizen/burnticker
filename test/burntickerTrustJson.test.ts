import { test } from "node:test";
import assert from "node:assert/strict";
import { PublicKey } from "@solana/web3.js";
import { jsonSafe } from "@/lib/burnticker/trust";

// Site audit 2026-10-11 R01: the legacy trust route threw "Do not know how to serialize a BigInt" on the mainnet host (the live
// LaunchLab platform view carries bigint fee rates and scales) → HTTP 500 with an empty body → the Trust page read "data unavailable".
test("jsonSafe: bigints become decimal strings, PublicKeys base58, bytes hex, nested and in arrays; JSON.stringify never throws", () => {
  const k = PublicKey.default;
  const v = { feeRate: BigInt(2500), scales: [BigInt(1_000_000), BigInt(0)], who: k, nested: { bytes: new Uint8Array([1, 255]), ok: true, n: 3, s: "x", none: null } };
  const out = jsonSafe(v) as Record<string, unknown>;
  assert.equal(out.feeRate, "2500");
  assert.deepEqual(out.scales, ["1000000", "0"]);
  assert.equal(out.who, k.toBase58());
  assert.deepEqual(out.nested, { bytes: "01ff", ok: true, n: 3, s: "x", none: null });
  assert.doesNotThrow(() => JSON.stringify(out));
  assert.throws(() => JSON.stringify(v), /BigInt/);
});
