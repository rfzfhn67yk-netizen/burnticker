import { test } from "node:test";
import assert from "node:assert/strict";
import { anyReadLate, ReadLateError, type BoundedRead } from "@/lib/burnticker/boundedReads";

// publish 106 gate (2026-10-20): a read cut off at its 200 ms deadline measured 199 ms, so the chain stage was not named over its budget.
// The list builds now name it from the reads themselves.
test("a late read, served earlier or failed late, marks the chain stage over; fresh reads and ordinary failures do not", () => {
  const fresh: BoundedRead<number> = { state: "fresh", value: 1, at: 0 };
  assert.equal(anyReadLate([fresh]), false);
  assert.equal(anyReadLate([fresh, { state: "earlier", value: 1, at: 0, why: "failed", error: new Error("rpc") }]), false);
  assert.equal(anyReadLate([fresh, { state: "failed", error: new Error("rpc") }]), false);
  assert.equal(anyReadLate([fresh, { state: "earlier", value: 1, at: 0, why: "late" }]), true);
  assert.equal(anyReadLate([fresh, { state: "failed", error: new ReadLateError(200) }]), true);
  assert.equal(anyReadLate([]), false);
});
