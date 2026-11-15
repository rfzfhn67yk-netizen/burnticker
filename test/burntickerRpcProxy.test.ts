// THE BROWSER'S RPC PROXY (launch night 2026-10-13: the public RPC answered 403 on the lookup-table read, so a launch could not be sent).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { RPC_PROXY_METHODS, RPC_PROXY_PATH, rpcProxyRefusal } from "@/lib/burnticker/rpcProxy";

describe("the RPC proxy", () => {
  test("allows what a launch needs, refuses everything else and oversized batches", () => {
    for (const m of ["getAddressLookupTable", "getLatestBlockhash", "sendTransaction", "getSignatureStatuses", "simulateTransaction", "getBalance"]) assert.ok(RPC_PROXY_METHODS.has(m), m);
    assert.equal(rpcProxyRefusal({ jsonrpc: "2.0", id: 1, method: "getAddressLookupTable", params: ["8DZaHFo6UnJk5br29BcRQZmdEKRpzKJTCyz1dRsHhJ2T"] }), null);
    assert.equal(rpcProxyRefusal([{ method: "getBalance" }, { method: "getSlot" }]), null);
    assert.equal(rpcProxyRefusal({ method: "requestAirdrop" }), "requestAirdrop");
    assert.equal(rpcProxyRefusal({ method: "getProgramAccounts" }), "getProgramAccounts", "listed but never forwarded");
    assert.equal(rpcProxyRefusal({ params: [] }), "missing method");
    assert.equal(rpcProxyRefusal([]), "batch");
    assert.equal(rpcProxyRefusal(new Array(21).fill({ method: "getSlot" })), "batch");
  });
  test("the deploy builds the page with the proxy as the wallet's RPC", (t) => {
    if (!fs.existsSync("scripts/ops/deploy-burnticker-host.sh")) { t.skip("not in the public tree"); return; }
    assert.ok(fs.readFileSync("scripts/ops/deploy-burnticker-host.sh", "utf8").includes(`NEXT_PUBLIC_BURNTICKER_RPC_URL="${"$"}{NEXT_PUBLIC_BURNTICKER_RPC_URL:-https://burnticker.com${RPC_PROXY_PATH}}"`));
  });
});
