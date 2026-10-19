// HOLDER COUNT AND TOP-10 CONCENTRATION (indexer-1, 2026-10-12; PLATFORM-NEXT-2 item 3). A fake RPC replays real answers captured
// read-only from the public endpoints (config/burnticker/fixtures/holders: the mainnet $REHEARSAL coin and the devnet LaunchLab
// lock-rehearsal coin): the DAS-style index first (Helius's `mint` parameter, then the public endpoint's `mintAddress`), the
// getProgramAccounts fallback when the RPC has no index, and "unavailable" with a reason for every answer that is not an answer. A count
// is never a guess and never a zero standing in for "not read".
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { clearHoldersCache, HOLDERS_CACHE_MS, HOLDERS_FAIL_CACHE_MS, MAX_TOKEN_ACCOUNTS, poolOwnerLabels, readHolders, summarizeHolders, UNAVAILABLE_NO_INDEX } from "@/lib/burnticker/holders";
import type { Rpc } from "@/lib/burnticker/trustpack/receiptCheck";
import { jsonRpc } from "@/lib/burnticker/trustpack/receiptCheck";
import { fx } from "./burntickerHelpers.ts";

type Fx = { mint: string; getAccountInfo: unknown; getTokenAccounts: { result: { token_accounts: unknown[]; cursor?: string } }; getProgramAccounts: unknown[] };
const MAIN = fx("holders/rehearsal.mainnet.json") as Fx, DEV = fx("holders/lockcoin.devnet.json") as Fx;
const NOW = Date.parse("2026-10-12T19:00:00Z");
const METHOD_NOT_FOUND = new Error("getTokenAccounts: Method not found");
const UNKNOWN_FIELD_MINT = new Error("getTokenAccounts: unknown field `mint`, expected one of `ownerAddress`, `mintAddress`, `limit`, `page`, `before`, `after`, `displayOptions`, `options`, `cursor` at line 1 column 7");

/** A fake RPC: `das` decides how getTokenAccounts answers ("helius" = the fixture under `mint`, "public" = only under `mintAddress`, "none" = method not found). */
function fakeRpc(f: Fx, o: { das: "helius" | "public" | "none"; gpa?: "ok" | Error; over?: Partial<Record<string, (params: unknown) => unknown>> }): Rpc & { log: string[] } {
  const log: string[] = [];
  return {
    log,
    async call<T>(method: string, params: unknown): Promise<T> {
      log.push(method);
      const fn = o.over?.[method];
      if (fn) return fn(params) as T;
      if (method === "getAccountInfo") return f.getAccountInfo as T;
      if (method === "getTokenAccounts") {
        const p = params as Record<string, unknown>;
        if (o.das === "none") throw METHOD_NOT_FOUND;
        if (o.das === "public" && "mint" in p) throw UNKNOWN_FIELD_MINT;
        if (o.das === "helius" && !("mint" in p)) throw new Error("getTokenAccounts: invalid params");
        return f.getTokenAccounts.result as T;
      }
      if (method === "getProgramAccounts") { if (o.gpa instanceof Error) throw o.gpa; return f.getProgramAccounts as T; }
      throw new Error(`unexpected ${method}`);
    },
  };
}

describe("reading holders", () => {
  test("Helius-style index: count, top ten and shares of the mint's supply; the curve's vault authority labelled", async () => {
    clearHoldersCache();
    const rpc = fakeRpc(MAIN, { das: "helius" });
    const r = await readHolders(rpc, { cluster: "mainnet", mint: MAIN.mint, labels: poolOwnerLabels("mainnet") }, NOW);
    assert.equal(r.state, "read");
    if (r.state !== "read") return;
    assert.equal(r.source, "das"); assert.equal(r.holders, 4); assert.equal(r.tokenAccounts, 4); assert.equal(r.supply, "1000000000");
    assert.deepEqual(r.top10[0], { owner: "WLHv2UAZm6z4KyaaELi5pjdbJh6RESMva1Rnn8pJVVh", amount: "996470729.833834", pct: 99.647, label: "bonding curve" }, "LaunchLab's vault authority holds the curve's tokens");
    assert.equal(r.top10.length, 4); assert.equal(r.top10Pct, 100);
    assert.equal(r.top10PctUnlabelled, 0.3529, "without the curve vault: the three wallets that bought");
    assert.deepEqual(rpc.log, ["getAccountInfo", "getTokenAccounts"]);
  });

  test("the public endpoint's parameter name (mintAddress) after Helius's is refused", async () => {
    clearHoldersCache();
    const rpc = fakeRpc(DEV, { das: "public" });
    const r = await readHolders(rpc, { cluster: "devnet", mint: DEV.mint, labels: poolOwnerLabels("devnet") }, NOW);
    assert.equal(r.state, "read");
    if (r.state !== "read") return;
    assert.equal(r.holders, 2); assert.equal(r.source, "das");
    assert.equal(r.top10[1].label, "trading pool", "the CPMM vault authority");
    assert.deepEqual(rpc.log, ["getAccountInfo", "getTokenAccounts", "getTokenAccounts"]);
  });

  test("no index: getProgramAccounts on the token program, zero balances left out, the same count as the index", async () => {
    for (const [f, cluster, n] of [[MAIN, "mainnet", 4], [DEV, "devnet", 2]] as const) {
      clearHoldersCache();
      const rpc = fakeRpc(f, { das: "none" });
      const r = await readHolders(rpc, { cluster, mint: f.mint }, NOW);
      assert.equal(r.state, "read"); if (r.state !== "read") return;
      assert.equal(r.source, "program-accounts"); assert.equal(r.holders, n);
      assert.ok(r.tokenAccounts > n, "the raw list includes emptied accounts; they are not holders");
      clearHoldersCache();
      const das = await readHolders(fakeRpc(f, { das: "helius" }), { cluster, mint: f.mint }, NOW);
      assert.deepEqual(das.state === "read" && das.top10, r.top10, "both routes give the same top ten");
    }
  });

  test("neither route: unavailable with the reason, never zero; cached ten minutes", async () => {
    clearHoldersCache();
    const rpc = fakeRpc(MAIN, { das: "none", gpa: new Error("getProgramAccounts: Method not found") });
    const r = await readHolders(rpc, { cluster: "mainnet", mint: MAIN.mint }, NOW);
    assert.deepEqual(r, { state: "unavailable", reason: UNAVAILABLE_NO_INDEX, detail: "getProgramAccounts: Method not found", readAt: new Date(NOW).toISOString() });
    await readHolders(rpc, { cluster: "mainnet", mint: MAIN.mint }, NOW + HOLDERS_CACHE_MS - 1);
    assert.equal(rpc.log.length, 3, "served from the cache");
  });

  test("a passing RPC failure is unavailable for one minute, not ten", async () => {
    clearHoldersCache();
    const rpc = fakeRpc(MAIN, { das: "none", gpa: new Error("getProgramAccounts: the RPC answered HTTP 503") });
    const r = await readHolders(rpc, { cluster: "mainnet", mint: MAIN.mint }, NOW);
    assert.equal(r.state, "unavailable"); assert.match(r.state === "unavailable" ? r.reason : "", /could not be listed just now/);
    await readHolders(rpc, { cluster: "mainnet", mint: MAIN.mint }, NOW + HOLDERS_FAIL_CACHE_MS + 1);
    assert.equal(rpc.log.filter((m) => m === "getAccountInfo").length, 2);
    clearHoldersCache();
    const das = await readHolders(fakeRpc(MAIN, { das: "helius", over: { getTokenAccounts: () => { throw new Error("getTokenAccounts: the RPC answered HTTP 429"); } } }), { cluster: "mainnet", mint: MAIN.mint }, NOW);
    assert.deepEqual(das.state === "unavailable" && [das.reason, das.detail], ["The RPC's token-account index could not be read just now.", "rate-limited by the RPC"]);
  });

  test("cached per mint; a second caller with other labels costs no RPC call", async () => {
    clearHoldersCache();
    const rpc = fakeRpc(MAIN, { das: "helius" });
    await readHolders(rpc, { cluster: "mainnet", mint: MAIN.mint }, NOW);
    const again = await readHolders(rpc, { cluster: "mainnet", mint: MAIN.mint, labels: { "3cfYXpTX5awbaDDPwHEnPVe9DihQoPm1iDuDhaDzDSRj": "creator" } }, NOW + 60_000);
    assert.equal(rpc.log.length, 2);
    assert.equal(again.state === "read" && again.top10.find((t) => t.label === "creator")?.amount, "18.127692");
    await readHolders(rpc, { cluster: "mainnet", mint: MAIN.mint }, NOW + HOLDERS_CACHE_MS + 1);
    assert.equal(rpc.log.length, 4, "re-read after ten minutes");
  });
});

describe("answers that are not answers", () => {
  const read = (over: Partial<Record<string, (p: unknown) => unknown>>, das: "helius" | "none" = "helius") => { clearHoldersCache(); return readHolders(fakeRpc(MAIN, { das, over }), { cluster: "mainnet", mint: MAIN.mint }, NOW); };
  const reason = (r: Awaited<ReturnType<typeof readHolders>>) => (r.state === "unavailable" ? r.reason : `read ${r.holders}`);
  test("the mint", async () => {
    assert.match(reason(await read({ getAccountInfo: () => ({ value: null }) })), /mint account was not found/);
    assert.match(reason(await read({ getAccountInfo: () => ({}) })), /not account data/);
    assert.match(reason(await read({ getAccountInfo: () => ({ value: { owner: "11111111111111111111111111111111", data: ["", "base64"] } }) })), /not a token mint/);
    assert.match(reason(await read({ getAccountInfo: () => { throw new Error("getAccountInfo: fetch failed"); } })), /mint could not be read just now/);
    clearHoldersCache();
    assert.match(reason(await readHolders(fakeRpc(MAIN, { das: "helius" }), { cluster: "mainnet", mint: "not-a-key" }, NOW)), /not a mint address/);
  });
  test("the index", async () => {
    assert.match(reason(await read({ getTokenAccounts: () => ({ total: 0 }) })), /not a list of token accounts/);
    assert.match(reason(await read({ getTokenAccounts: () => ({ token_accounts: [{ address: "a", owner: "b", amount: -1 }] }) })), /not a whole number/);
    assert.match(reason(await read({ getTokenAccounts: () => ({ token_accounts: [{ address: "a", owner: "b", mint: "other", amount: 1 }] }) })), /not a token account of this coin/);
    const full = (from: number) => ({ token_accounts: Array.from({ length: 1000 }, (_, k) => ({ address: `acct${from + k}`, owner: `w${from + k}`, amount: 1 })), cursor: `acct${from + 999}` });
    let page = 0;
    assert.match(reason(await read({ getTokenAccounts: () => full(1000 * page++) })), new RegExp(`more than ${MAX_TOKEN_ACCOUNTS.toLocaleString("en-US")} token accounts`));
    assert.match(reason(await read({ getTokenAccounts: () => full(0) })), /same token accounts/);
  });
  test("paging by cursor collects every page", async () => {
    const pages = [{ token_accounts: Array.from({ length: 1000 }, (_, k) => ({ address: `a${k}`, owner: `w${k % 700}`, amount: 1 })), cursor: "a999" }, { token_accounts: [{ address: "z", owner: "w0", amount: "5" }] }];
    const seen: unknown[] = [];
    const r = await read({ getTokenAccounts: (p) => { seen.push(p); return pages[seen.length - 1]; } });
    assert.equal(reason(r), "read 700");
    assert.equal((seen[1] as { cursor: string }).cursor, "a999");
  });
  test("the fallback list", async () => {
    assert.match(reason(await read({ getProgramAccounts: () => ({}) }, "none")), /not a list of accounts/);
    assert.match(reason(await read({ getProgramAccounts: () => [{ pubkey: "x", account: { owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", data: ["AAAA", "base64"] } }] }, "none")), /not a token account/);
  });
  test("through the real JSON-RPC client: a 200 without a result is unavailable, not zero holders", async () => {
    clearHoldersCache();
    const fetchImpl = (async () => ({ ok: true, status: 200, json: async () => ({ jsonrpc: "2.0", id: 1 }) })) as unknown as typeof fetch;
    const r = await readHolders(jsonRpc("http://rpc.invalid", fetchImpl, { attempts: 1 }), { cluster: "mainnet", mint: MAIN.mint }, NOW);
    assert.equal(r.state, "unavailable");
  });
});

describe("summarizeHolders", () => {
  test("wallets with several accounts count once; ties sort by address; an all-burned supply has no share", () => {
    const s = summarizeHolders([{ owner: "b", amountRaw: BigInt(5) }, { owner: "a", amountRaw: BigInt(5) }, { owner: "b", amountRaw: BigInt(5) }, { owner: "c", amountRaw: BigInt(0) }], BigInt(20), 0);
    assert.equal(s.holders, 2); assert.deepEqual(s.top10.map((t) => [t.owner, t.amount, t.pct]), [["b", "10", 50], ["a", "5", 25]]); assert.equal(s.top10Pct, 75);
    assert.equal(summarizeHolders([{ owner: "a", amountRaw: BigInt(1) }], BigInt(0), 0).top10Pct, null);
    assert.deepEqual(summarizeHolders([], BigInt(10), 0), { holders: 0, wallets: 0, top10: [], top10Pct: null, top10PctUnlabelled: null }, "a real zero: the chain listed no holder");
  });
});
