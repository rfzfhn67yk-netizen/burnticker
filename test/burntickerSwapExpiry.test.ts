// Fourth audit pass 2026-10-16 F-30: a held swap was called expired after ONE empty status read past the block height. A lagging RPC
// could clear the hold on a swap that had landed, and the visitor bought again. Expired now needs a second status read with history AND
// an empty getTransaction, with the height past the expiry plus a margin; anything else stays pending (or settles on what was found).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { EXPIRY_MARGIN_BLOCKS, reconcileSubmitted } from "@/lib/burnticker/swap/chain";

const SIG = "5".repeat(88), LAST = 100;
function rpc(o: { statuses?: ({ err: unknown; confirmationStatus?: string } | null)[]; height: number; tx?: { meta: { err: unknown } | null } | null | "throw" }) {
  let i = 0;
  const c = {
    statusReads: 0, txReads: 0,
    getBlockHeight: async () => o.height,
    getSignatureStatuses: async (_s: string[], cfg?: { searchTransactionHistory: boolean }) => { c.statusReads++; assert.equal(cfg?.searchTransactionHistory, true); const st = o.statuses?.[Math.min(i++, (o.statuses?.length ?? 1) - 1)] ?? null; return { value: [st] }; },
    getTransaction: async () => { c.txReads++; if (o.tx === "throw") throw new Error("503"); return o.tx ?? null; },
  };
  return c;
}
const settle = (c: ReturnType<typeof rpc>) => reconcileSubmitted(c as never, { signature: SIG, lastValidBlockHeight: LAST });

describe("F-30: expired needs two empty reads past a margin", () => {
  test("one empty status read, but the transaction is on chain: confirmed (before: expired, the hold cleared)", async () => {
    const c = rpc({ statuses: [null], height: LAST + EXPIRY_MARGIN_BLOCKS + 1, tx: { meta: { err: null } } });
    assert.equal((await settle(c)).status, "confirmed");
  });
  test("a landed transaction that failed on chain is failed", async () => {
    assert.equal((await settle(rpc({ statuses: [null], height: LAST + EXPIRY_MARGIN_BLOCKS + 1, tx: { meta: { err: { InstructionError: [0, "Custom"] } } } }))).status, "failed");
  });
  test("just past the expiry, inside the margin: pending (before: expired)", async () => {
    const c = rpc({ statuses: [null], height: LAST + 1 });
    assert.equal((await settle(c)).status, "pending");
  });
  test("the second status read finds it: confirmed", async () => {
    const c = rpc({ statuses: [null, { err: null, confirmationStatus: "confirmed" }], height: LAST + EXPIRY_MARGIN_BLOCKS + 1 });
    assert.equal((await settle(c)).status, "confirmed");
    assert.equal(c.statusReads, 2);
  });
  test("both reads empty past the margin: expired; a getTransaction error keeps it pending", async () => {
    const c = rpc({ statuses: [null], height: LAST + EXPIRY_MARGIN_BLOCKS + 1 });
    assert.equal((await settle(c)).status, "expired");
    assert.equal(c.statusReads, 2); assert.equal(c.txReads, 1);
    assert.equal((await settle(rpc({ statuses: [null], height: LAST + EXPIRY_MARGIN_BLOCKS + 1, tx: "throw" }))).status, "pending");
  });
});
