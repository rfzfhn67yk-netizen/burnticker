// REVIEW OF BLOCK M (MEDIUM): each Launch press signs its request with a new nonce. The prepare's idempotency fingerprint included that
// signature, so a second press on the same draft was a "reused key with different details" (409), and the page then rotated its key and
// started a SECOND draft (a second bank key and a second paid upload). The signature is now left out of the fingerprint.
import { test } from "node:test";
import assert from "node:assert/strict";
import { bodyFingerprint, IdempotentRuns } from "@/lib/burnticker/api/idempotency";

test("two presses on one draft (each with its own signed request) get the same answer from one run", async () => {
  const runs = new IdempotentRuns();
  const draft = { creator: "W", ticker: "ABC", idempotencyKey: "k".repeat(20) };
  const first = { ...draft, walletProof: { message: "Nonce: aaaa", signature: "s1" } }, second = { ...draft, walletProof: { message: "Nonce: bbbb", signature: "s2" } };
  assert.equal(bodyFingerprint(first), bodyFingerprint(second));
  let made = 0;
  const make = async () => { made++; return new Response(JSON.stringify({ ok: true, mint: `M${made}` }), { status: 200 }); };
  const a = await runs.run("key", bodyFingerprint(first), make);
  const b = await runs.run("key", bodyFingerprint(second), make);
  assert.equal(a.status, 200); assert.equal(b.status, 200, "not a 409 reused key");
  assert.deepEqual(await a.json(), await b.json());
  assert.equal(made, 1, "one draft, one bank key, one upload");
  assert.notEqual(bodyFingerprint(first), bodyFingerprint({ ...first, ticker: "ABD" }), "a changed draft is still a different request");
});
