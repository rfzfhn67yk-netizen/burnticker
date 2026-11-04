// THE PER-CYCLE ACCOUNT CACHE AND THE PAIR SCAN CACHE (2026-10-15; src/lib/burnticker/cycleAccountCache.ts, src/lib/burnKeeper/pairCurveCrank.ts
// PairScanCache, keeperReadCache.ts holders/lpSettled). Measured before: ~110 Helius credits a steady cycle with six coins, ~100 of them
// getAccountInfo of the same few dozen accounts and 30 the three getProgramAccounts. These tests pin what the caches serve, that they
// serve the same answers the RPC gives, that a send drops every value, and the call counts a steady cycle now makes.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey } from "@solana/web3.js";
import { CycleAccountCache } from "@/lib/burnticker/cycleAccountCache";
import { PairScanCache, CRANK_STATUSES } from "@/lib/burnKeeper/pairCurveCrank";
import { STATUS_GRADUATED, STATUS_GRADUATING, STATUS_OPEN } from "@/lib/pairCurve/accounts";
import { KeeperReadCache, READ_TTL_MS, cachedMarketReader, lockSettled } from "@/lib/burnticker/keeperReadCache";

const TOKEN = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const OTHER = new PublicKey("11111111111111111111111111111111");

function mintData(supply: bigint, decimals = 6): Buffer { const b = Buffer.alloc(82); b.writeBigUInt64LE(supply, 36); b[44] = decimals; b[45] = 1; return b; }
function tokenAccData(mint: PublicKey, amount: bigint): Buffer { const b = Buffer.alloc(165); mint.toBuffer().copy(b, 0); b.writeBigUInt64LE(amount, 64); return b; }

/** A fake RPC: accounts by address, every call counted by method. */
function fakeConn(accounts: Map<string, { data: Buffer; owner: PublicKey; lamports: number } | null>) {
  const calls: string[] = [];
  const acc = (k: string) => { const a = accounts.get(k); return a ? { ...a, executable: false, rentEpoch: 0 } : null; };
  const conn = {
    calls,
    async getAccountInfo(pk: PublicKey, _c?: unknown) { calls.push("getAccountInfo"); return acc(pk.toBase58()); },
    async getMultipleAccountsInfo(pks: PublicKey[], _c?: unknown) { calls.push("getMultipleAccountsInfo"); return pks.map((p) => acc(p.toBase58())); },
    async getBalance(pk: PublicKey, _c?: unknown) { calls.push("getBalance"); return acc(pk.toBase58())?.lamports ?? 0; },
    async getTokenSupply(pk: PublicKey, _c?: unknown) { calls.push("getTokenSupply"); const a = acc(pk.toBase58()); if (!a) throw new Error("not a mint"); return { context: { slot: 9 }, value: { amount: a.data.readBigUInt64LE(36).toString(), decimals: a.data[44], uiAmount: 0, uiAmountString: "" } }; },
    async getTokenAccountBalance(pk: PublicKey, _c?: unknown) { calls.push("getTokenAccountBalance"); const a = acc(pk.toBase58())!; return { context: { slot: 9 }, value: { amount: a.data.readBigUInt64LE(64).toString(), decimals: 6, uiAmount: 0, uiAmountString: "" } }; },
    async getGenesisHash() { calls.push("getGenesisHash"); return "genesis"; },
    async sendRawTransaction() { calls.push("sendRawTransaction"); return "sig"; },
    async getSignatureStatuses() { calls.push("getSignatureStatuses"); return { value: [] }; },
    rpcEndpoint: "http://fake",
  };
  return conn;
}

describe("the per-cycle account cache", () => {
  const mint = Keypair.generate().publicKey, cfg = Keypair.generate().publicKey, fee = Keypair.generate().publicKey, vault = Keypair.generate().publicKey, missing = Keypair.generate().publicKey;
  const accounts = new Map<string, { data: Buffer; owner: PublicKey; lamports: number } | null>([
    [mint.toBase58(), { data: mintData(BigInt(999_000_000), 6), owner: TOKEN, lamports: 1_461_600 }],
    [cfg.toBase58(), { data: Buffer.from([1, 2, 3, 4]), owner: OTHER, lamports: 5 }],
    [fee.toBase58(), { data: Buffer.alloc(0), owner: OTHER, lamports: 123_456 }],
    [vault.toBase58(), { data: tokenAccData(mint, BigInt(42_000_000)), owner: TOKEN, lamports: 2_039_280 }],
  ]);
  const steadyReads = async (c: ReturnType<typeof fakeConn>) => [
    await c.getAccountInfo(cfg, "confirmed" as never), await c.getAccountInfo(cfg, "confirmed" as never), await c.getAccountInfo(missing, "confirmed" as never),
    await c.getBalance(fee, "confirmed" as never), (await c.getTokenSupply(mint, "confirmed" as never)).value.amount,
    (await c.getTokenAccountBalance(vault, "confirmed" as never)).value.amount, await c.getMultipleAccountsInfo([cfg, fee, missing], "confirmed" as never),
  ];

  test("the first cycle reads through and learns; every later cycle is ONE getMultipleAccountsInfo, with the same answers as the RPC", async () => {
    const rpc = fakeConn(accounts), direct = fakeConn(accounts);
    const cache = new CycleAccountCache(rpc as never);
    const c = cache.connection<ReturnType<typeof fakeConn>>();
    await cache.beginCycle();
    const first = await steadyReads(c);
    const firstCalls = rpc.calls.length;
    assert.ok(firstCalls >= 4);
    for (let cycle = 0; cycle < 3; cycle++) {
      rpc.calls.length = 0;
      await cache.beginCycle();
      const again = await steadyReads(c);
      assert.deepEqual(rpc.calls, ["getMultipleAccountsInfo"], `cycle ${cycle}: one prefetch call, everything else served`);
      assert.deepEqual(JSON.stringify(again), JSON.stringify(first));
    }
    // the served answers are the RPC's answers, every one of them (review item 11: compared with a direct, uncached connection)
    const d = await steadyReads(direct as never);
    assert.equal(JSON.stringify(first), JSON.stringify(d));
    assert.equal(d[4], "999000000"); assert.equal(d[5], "42000000");
  });

  test("a send drops every value first: the next read is fresh (one re-prefetch), never from before the send", async () => {
    const accs = new Map(accounts);
    const rpc = fakeConn(accs);
    const cache = new CycleAccountCache(rpc as never);
    const c = cache.connection<ReturnType<typeof fakeConn>>();
    await cache.beginCycle(); await steadyReads(c);
    await cache.beginCycle();
    assert.equal(await c.getBalance(fee), 123_456);
    accs.set(fee.toBase58(), { data: Buffer.alloc(0), owner: OTHER, lamports: 1 });   // our own crank spends the pool
    rpc.calls.length = 0;
    await c.sendRawTransaction();
    assert.equal(await c.getBalance(fee), 1, "read after the send is fresh");
    assert.deepEqual(rpc.calls, ["sendRawTransaction", "getMultipleAccountsInfo"]);
    assert.equal(await c.getBalance(fee), 1);
    assert.deepEqual(rpc.calls, ["sendRawTransaction", "getMultipleAccountsInfo"], "then served again");
  });

  test("anything the cache cannot answer exactly goes to the RPC: another commitment, a dataSlice; confirmation polling is never cached", async () => {
    const rpc = fakeConn(accounts);
    const cache = new CycleAccountCache(rpc as never);
    const c = cache.connection<ReturnType<typeof fakeConn>>();
    await cache.beginCycle(); await steadyReads(c); await cache.beginCycle();
    rpc.calls.length = 0;
    await c.getAccountInfo(cfg, "finalized" as never);
    await c.getAccountInfo(cfg, { commitment: "confirmed", dataSlice: { offset: 0, length: 1 } } as never);
    await c.getSignatureStatuses(); await c.getSignatureStatuses();
    assert.deepEqual(rpc.calls, ["getAccountInfo", "getAccountInfo", "getSignatureStatuses", "getSignatureStatuses"]);
    assert.equal(c.rpcEndpoint, "http://fake");
  });

  test("the genesis hash is read once per process; addresses unused for keepCycles cycles leave the prefetch", async () => {
    const rpc = fakeConn(accounts);
    const cache = new CycleAccountCache(rpc as never, { keepCycles: 2 });
    const c = cache.connection<ReturnType<typeof fakeConn>>();
    assert.equal(await c.getGenesisHash(), "genesis"); assert.equal(await c.getGenesisHash(), "genesis");
    assert.equal(rpc.calls.filter((x) => x === "getGenesisHash").length, 1);
    await cache.beginCycle(); await c.getAccountInfo(cfg);
    assert.deepEqual(cache.addresses(), [cfg.toBase58()]);
    await cache.beginCycle(); await cache.beginCycle(); await cache.beginCycle();
    assert.deepEqual(cache.addresses(), []);
  });
});

describe("the pair scan cache", () => {
  test("one discriminator-only getProgramAccounts every fullEveryMs (statuses filtered here); known pairs by address in between", async () => {
    let t = 0;
    const calls: string[] = [];
    const conn = {
      async getProgramAccounts(_p: PublicKey, o: { filters: unknown[] }) { calls.push(`gpa:${o.filters.length}`); return []; },
      async getMultipleAccountsInfo(pks: PublicKey[], _c?: unknown) { calls.push(`gma:${pks.length}`); return pks.map(() => null); },
    };
    const s = new PairScanCache({ connection: conn as never, fullEveryMs: 600_000, now: () => t });
    await s.scan(); t += 60_000; await s.scan(); t += 60_000; await s.scan();
    assert.deepEqual(calls, ["gpa:1"], "one full scan with the discriminator filter only; no known pairs → no reads between");
    t += 600_000; await s.scan();
    assert.deepEqual(calls, ["gpa:1", "gpa:1"]);
    assert.deepEqual([...CRANK_STATUSES], [STATUS_OPEN, STATUS_GRADUATING, STATUS_GRADUATED], "voided pairs are never cranked");
  });
});

describe("the keeper read cache's new TTLs", () => {
  test("the coin card's top holders are read once per 10 minutes per mint, not every cycle", async () => {
    let t = 0, n = 0;
    const cache = new KeeperReadCache({ now: () => t });
    const mint = Keypair.generate().publicKey;
    const m = cachedMarketReader({ getAccountInfo: async () => null, getTokenLargestAccounts: async () => { n++; return { value: [] }; }, getMultipleParsedAccounts: async () => ({ value: [] }) }, cache, () => null);
    for (let i = 0; i < 9; i++) { await m.getTokenLargestAccounts(mint); t += 60_000; }
    assert.equal(n, 1);
    t += READ_TTL_MS.holders; await m.getTokenLargestAccounts(mint);
    assert.equal(n, 2);
  });
  test("a lock is 'settled' (30-minute claim checks) only once graduated with the Fee Key and the pool registered", () => {
    const base = { graduated: true, pool: "p", lpMint: "l", feeKey: "f", feeKeyOwner: "o", lockedLiquidity: "x", feeKeyRegistered: true, poolRegistered: true, lockedPct: 100, accruedSolLamports: BigInt(0), accruedTokenRaw: BigInt(0) };
    assert.equal(lockSettled(base as never), true);
    assert.equal(lockSettled({ ...base, feeKeyRegistered: false } as never), false);
    assert.equal(lockSettled({ ...base, poolRegistered: false } as never), false);
    assert.equal(lockSettled({ ...base, graduated: false } as never), false);
    assert.equal(READ_TTL_MS.lpSettled, 30 * 60_000);
  });
});

/** A Pair account as the program stores it (the IDL coder), with `status`. */
async function pairData(status: number): Promise<Buffer> {
  const { PAIR_CURVE_IDL } = await import("@/lib/pairCurve/idl");
  const { accountDiscriminator, encodeType } = await import("@/lib/burnReceipts/idlCoder");
  const k = () => Keypair.generate().publicKey, B = (n: number) => BigInt(n), two = <T,>(x: T): T[] => [x, x];
  const pair = {
    version: 1, bump: 255, vault_bump: 254, status, mints: [k(), k()], pools: two(PublicKey.default), lp_supply_at_creation: two(B(0)), lp_locked: two(B(0)),
    cp_config: k(), vault: k(), creator: k(), dev_wallet: k(), ll_platform: k(), fee_vaults: [k(), k()], token_vaults: [k(), k()], vault_wsol: k(), pool_bumps: Uint8Array.from([253, 252]),
    pair_id: new Uint8Array(32).fill(7), rules_sha256_a: new Uint8Array(32).fill(1), rules_sha256_b: new Uint8Array(32).fill(2),
    virtual_sol_lamports: B(30_000_000_000), virtual_token_amount: B(1_000_000), curve_supply: B(1_000), reserve_supply: B(1_000), target_raise_lamports: B(85_000_000_000),
    min_side_share_bps: 2_500, deadline: B(2_000_000_000), created_at: B(1_900_000_000),
    sold: two(B(0)), sol: two(B(0)), volume_lamports: two(B(0)), burn_fees_lamports: two(B(0)), dev_fees_lamports: two(B(0)), trades: [0, 0],
    graduated_at: B(0), voided_at: B(0), pool_sol: two(B(0)), pool_tokens: two(B(0)), tokens_burned: two(B(0)), graduation_started_at: B(0), raise_at_graduation: two(B(0)),
    burn_escrow: two(B(0)), dev_accrued: B(0), redeem_pool: two(B(0)), redeem_supply: two(B(0)), refunding: [false, false], reserved: new Uint8Array(64),
  };
  return Buffer.concat([accountDiscriminator(PAIR_CURVE_IDL, "Pair"), encodeType(PAIR_CURVE_IDL, { defined: { name: "Pair" } }, pair)]);
}

describe("review 2026-10-15: the cycle cache", () => {
  const mint = Keypair.generate().publicKey, cfg = Keypair.generate().publicKey;
  const base = () => new Map<string, { data: Buffer; owner: PublicKey; lamports: number } | null>([
    [mint.toBase58(), { data: mintData(BigInt(5_000), 6), owner: TOKEN, lamports: 1 }], [cfg.toBase58(), { data: Buffer.from([1]), owner: OTHER, lamports: 7 }]]);

  test("item 3: a send through the private route (privateSend.ts) drops every cached value, like a Connection send", async () => {
    const { onPrivateSend, privateSender } = await import("@/lib/burnKeeper/privateSend");
    const accs = base(), rpc = fakeConn(accs);
    const cache = new CycleAccountCache(rpc as never);
    const c = cache.connection<ReturnType<typeof fakeConn>>();
    const off = onPrivateSend(() => cache.invalidateAll());
    try {
      await cache.beginCycle(); await c.getBalance(cfg); await cache.beginCycle();
      assert.equal(await c.getBalance(cfg), 7);
      accs.set(cfg.toBase58(), { data: Buffer.from([1]), owner: OTHER, lamports: 3 });
      const sender = privateSender("https://block-engine.example.com", (async () => ({ ok: true, status: 200, json: async () => ({ result: "sig" }) })) as never);
      await sender.send(new Uint8Array([1, 2, 3]));
      assert.equal(await c.getBalance(cfg), 3, "read after the private send is fresh");
    } finally { off(); }
  });

  test("item 5: the re-prefetch after a send asks for at least the newest confirmed slot (minContextSlot); context slots are the prefetch's", async () => {
    const accs = base(), seenCfg: unknown[] = [];
    const rpc = Object.assign(fakeConn(accs), {
      async getMultipleAccountsInfoAndContext(pks: PublicKey[], c?: unknown) { seenCfg.push(c); return { context: { slot: 1234 }, value: pks.map((p) => { const a = accs.get(p.toBase58()); return a ? { ...a, executable: false, rentEpoch: 0 } : null; }) }; },
      async getSignatureStatuses() { return { context: { slot: 0 }, value: [{ slot: 999, confirmationStatus: "confirmed" }] }; },
    });
    const cache = new CycleAccountCache(rpc as never);
    const c = cache.connection<ReturnType<typeof fakeConn>>();
    await cache.beginCycle(); await c.getTokenSupply(mint); await cache.beginCycle();
    assert.deepEqual(seenCfg.at(-1), { commitment: "confirmed" });
    assert.equal((await c.getTokenSupply(mint)).context.slot, 1234, "the served answer carries the prefetch's slot, not 0");
    await c.sendRawTransaction(); await c.getSignatureStatuses();
    assert.equal(cache.confirmedSlot(), 999);
    await c.getTokenSupply(mint);
    assert.deepEqual(seenCfg.at(-1), { commitment: "confirmed", minContextSlot: 999 });
  });

  test("item 6: an answer that was in flight when the values were dropped is never written back", async () => {
    const accs = base();
    let release: (() => void) | null = null;
    const rpc = Object.assign(fakeConn(accs), {
      async getAccountInfo(pk: PublicKey) { await new Promise<void>((r) => { release = r; }); const a = accs.get(pk.toBase58()); return a ? { ...a, executable: false, rentEpoch: 0 } : null; },
    });
    const cache = new CycleAccountCache(rpc as never);
    const c = cache.connection<ReturnType<typeof fakeConn>>();
    await cache.beginCycle();
    const slow = c.getAccountInfo(cfg);   // reads lamports 7 …
    await new Promise((r) => setTimeout(r, 5));
    accs.set(cfg.toBase58(), { data: Buffer.from([1]), owner: OTHER, lamports: 8 });
    cache.invalidateAll();                // … our send lands meanwhile
    release!(); await slow;
    rpc.calls.length = 0;
    assert.equal((await c.getMultipleAccountsInfo([cfg]))[0]?.lamports, 8, "not the pre-send 7");
  });

  test("item 7: a Token-2022 account longer than 165 bytes is a token account only when its AccountType byte says so", async () => {
    const T22 = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
    const m22 = Keypair.generate().publicKey, acct = Keypair.generate().publicKey, other = Keypair.generate().publicKey;
    const mintExt = Buffer.alloc(200); mintExt.writeBigUInt64LE(BigInt(77), 36); mintExt[44] = 6; mintExt[165] = 1;
    const acctExt = Buffer.alloc(200); m22.toBuffer().copy(acctExt, 0); acctExt.writeBigUInt64LE(BigInt(55), 64); acctExt[165] = 2;
    const notAcct = Buffer.alloc(200); m22.toBuffer().copy(notAcct, 0); notAcct[165] = 1;
    const accs = new Map([[m22.toBase58(), { data: mintExt, owner: T22, lamports: 1 }], [acct.toBase58(), { data: acctExt, owner: T22, lamports: 1 }], [other.toBase58(), { data: notAcct, owner: T22, lamports: 1 }]]);
    const rpc = fakeConn(accs as never);
    const cache = new CycleAccountCache(rpc as never);
    const c = cache.connection<ReturnType<typeof fakeConn>>();
    await cache.beginCycle(); await c.getAccountInfo(m22); await c.getAccountInfo(acct); await c.getAccountInfo(other); await cache.beginCycle();
    rpc.calls.length = 0;
    assert.equal((await c.getTokenSupply(m22)).value.amount, "77");
    assert.equal((await c.getTokenAccountBalance(acct)).value.amount, "55");
    assert.deepEqual(rpc.calls, [], "both served");
    await c.getTokenAccountBalance(other).catch(() => null);
    assert.deepEqual(rpc.calls, ["getTokenAccountBalance"], "a mint-typed account is not served as a token balance");
  });

  test("N1: refresh re-reads ONLY the named keys in one call (at the slot floor) and keeps every other value", async () => {
    const accs = base(), other = Keypair.generate().publicKey;
    accs.set(other.toBase58(), { data: Buffer.from([9]), owner: OTHER, lamports: 1 });
    const seen: string[][] = [];
    const rpc = Object.assign(fakeConn(accs), {
      async getMultipleAccountsInfoAndContext(pks: PublicKey[]) { seen.push(pks.map((p) => p.toBase58())); return { context: { slot: 50 }, value: pks.map((p) => { const a = accs.get(p.toBase58()); return a ? { ...a, executable: false, rentEpoch: 0 } : null; }) }; },
    });
    const cache = new CycleAccountCache(rpc as never);
    const c = cache.connection<ReturnType<typeof fakeConn>>();
    await cache.beginCycle(); await c.getAccountInfo(cfg); await c.getAccountInfo(other); await c.getAccountInfo(mint);
    await cache.beginCycle();
    seen.length = 0; rpc.calls.length = 0;
    accs.set(cfg.toBase58(), { data: Buffer.from([1]), owner: OTHER, lamports: 70 });
    accs.set(other.toBase58(), { data: Buffer.from([9]), owner: OTHER, lamports: 2 });
    await cache.refresh([cfg.toBase58(), mint.toBase58()]);
    assert.deepEqual(seen, [[cfg.toBase58(), mint.toBase58()]], "one call, this coin's keys only");
    assert.equal((await c.getAccountInfo(cfg))?.lamports, 70, "fresh");
    assert.equal((await c.getAccountInfo(other))?.lamports, 1, "another coin's value stays from the cycle's prefetch (no re-read)");
    assert.deepEqual(rpc.calls, []);
  });

  test("N1: sendableWork: only a reading date or a CLOSED day is work; today's settlements wait for the close and cost nothing", async () => {
    const { sendableWork } = await import("@/lib/burnticker/multiKeeper");
    const now = Date.parse("2026-10-15T18:00:00Z");
    assert.deepEqual(sendableWork([{ readingDate: null, settledAt: "2026-10-15T03:00:00Z" }], now), { sendable: false, dates: [] });
    assert.deepEqual(sendableWork([{ readingDate: null, settledAt: "2026-10-14T23:00:00Z" }], now), { sendable: true, dates: [20261014] });
    assert.deepEqual(sendableWork([{ readingDate: 20261012, settledAt: "2026-10-12T01:00:00Z" }, { readingDate: null, settledAt: "2026-10-15T01:00:00Z" }], now), { sendable: true, dates: [20261012] });
  });

  test("N1: the keeper wires freshReads to refresh this coin's TokenConfig, fee PDA, mint and reading PDAs; runCycle skips it on a dry run", async () => {
    const fs = await import("node:fs");
    const keeper = fs.readFileSync("scripts/burnticker-keeper.mts", "utf8");
    assert.match(keeper, /deps\.freshReads = \(t, dates\) => cc\.refresh\(freshReadKeys\(pid, t\.mint, dates, registry\.pairOf\(t\.mint\)\), log\)/);
    const mk = fs.readFileSync("src/lib/burnticker/multiKeeper.ts", "utf8");
    assert.match(mk, /if \(!d\.freshReads \|\| d\.dryRun\) return;\n\s+const w = sendableWork\(d\.registry\.pending\(t\.mint\), d\.now\(\)\);\n\s+if \(!w\.sendable\) return;/);
  });

  test("N2: -32016 (minimum context slot not reached) is retried 400 ms apart; past the retries the read passes through and an answer older than the floor is never cached", async () => {
    const accs = base(); let refuse = 2; const slept: number[] = [];
    let passSlot = 100;
    const rpc = Object.assign(fakeConn(accs), {
      async getMultipleAccountsInfoAndContext(pks: PublicKey[], c?: { minContextSlot?: number }) {
        if (c?.minContextSlot && refuse-- > 0) throw Object.assign(new Error("failed to get info: Minimum context slot has not been reached"), { code: -32016 });
        return { context: { slot: 1000 }, value: pks.map((p) => { const a = accs.get(p.toBase58()); return a ? { ...a, executable: false, rentEpoch: 0 } : null; }) };
      },
      async getAccountInfoAndContext(pk: PublicKey) { rpc.calls.push("getAccountInfoAndContext"); const a = accs.get(pk.toBase58()); return { context: { slot: passSlot }, value: a ? { ...a, executable: false, rentEpoch: 0 } : null }; },
      async getSignatureStatuses() { return { value: [{ slot: 900, confirmationStatus: "confirmed" }] }; },
    });
    const cache = new CycleAccountCache(rpc as never, { sleep: async (ms) => { slept.push(ms); } });
    const c = cache.connection<ReturnType<typeof fakeConn>>();
    await cache.beginCycle(); await c.getAccountInfo(cfg); await cache.beginCycle();
    await c.sendRawTransaction(); await c.getSignatureStatuses();
    assert.equal((await c.getAccountInfo(cfg))?.lamports, 7);
    assert.deepEqual(slept, [400, 400], "two refusals, then the floored read succeeded");
    // a floor the backend never reaches: retries run out, the read passes through, and its older answer is not cached
    refuse = 99; slept.length = 0; rpc.calls.length = 0;
    await c.sendRawTransaction(); await c.getSignatureStatuses();
    await c.getAccountInfo(cfg); await c.getAccountInfo(cfg);
    assert.equal(slept.length, 3);
    assert.deepEqual(rpc.calls.filter((x) => x === "getAccountInfoAndContext").length, 2, "slot 100 < floor 900: served to the caller, never cached");
    passSlot = 950; rpc.calls.length = 0;
    await c.getAccountInfo(cfg); await c.getAccountInfo(cfg);
    assert.equal(rpc.calls.filter((x) => x === "getAccountInfoAndContext").length, 1, "an answer at or past the floor is cached");
    // the floor is per cycle
    refuse = 0; await cache.beginCycle();
    assert.equal(cache.confirmedSlot(), 0);
  });

  test("item 7: a pass-through read caches its own context slot; a partial getMultipleAccountsInfo hit reads the whole batch fresh at one slot", async () => {
    const accs = base(), other = Keypair.generate().publicKey;
    accs.set(other.toBase58(), { data: Buffer.from([2]), owner: OTHER, lamports: 4 });
    const batches: number[] = [];
    const rpc = Object.assign(fakeConn(accs), {
      async getMultipleAccountsInfoAndContext(pks: PublicKey[]) { batches.push(pks.length); return { context: { slot: 321 }, value: pks.map((p) => { const a = accs.get(p.toBase58()); return a ? { ...a, executable: false, rentEpoch: 0 } : null; }) }; },
      async getAccountInfoAndContext(pk: PublicKey) { const a = accs.get(pk.toBase58()); return { context: { slot: 77 }, value: a ? { ...a, executable: false, rentEpoch: 0 } : null }; },
    });
    const cache = new CycleAccountCache(rpc as never);
    const c = cache.connection<ReturnType<typeof fakeConn>>();
    await cache.beginCycle();
    await c.getAccountInfo(mint);
    assert.equal((await c.getTokenSupply(mint)).context.slot, 77, "the pass-through read's own slot, not 0");
    batches.length = 0;
    const r = await c.getMultipleAccountsInfo([mint, other]);
    assert.deepEqual(batches, [2], "partial hit (mint cached, other not): the whole batch, one call");
    assert.equal(r[1]?.lamports, 4);
    assert.equal((await c.getTokenSupply(mint)).context.slot, 321);
  });
});

describe("review 2026-10-15: the pair scan cache", () => {
  test("item 8: the full scan skips voided pairs by the raw status byte (no 'skipped' noise); known pairs are re-read by address in chunks of 100; transitions drop out", async () => {
    let t = 0;
    const open = await pairData(STATUS_OPEN), voided = await pairData(2), graduated = await pairData(STATUS_GRADUATED);
    const addrs = Array.from({ length: 130 }, () => Keypair.generate().publicKey);
    const data = new Map<string, Buffer>(addrs.map((a, i) => [a.toBase58(), i === 0 ? voided : open]));
    const undecodable = Keypair.generate().publicKey, oldVoided = Keypair.generate().publicKey;
    const bad = Buffer.concat([open.subarray(0, 12), Buffer.alloc(20)]);   // a crankable status byte but a truncated layout
    const oldLayoutVoided = Buffer.concat([voided.subarray(0, 12), Buffer.alloc(20)]);
    const calls: string[] = [];
    const conn = {
      async getProgramAccounts() { calls.push("gpa"); return [...data.entries(), [undecodable.toBase58(), bad] as const, [oldVoided.toBase58(), oldLayoutVoided] as const].map(([k, d]) => ({ pubkey: new PublicKey(k), account: { data: d } })); },
      async getMultipleAccountsInfo(pks: PublicKey[]) { calls.push(`gma:${pks.length}`); return pks.map((p) => { const d = data.get(p.toBase58()); return d ? { data: d } : null; }); },
    };
    const skipped: string[] = [];
    const s = new PairScanCache({ connection: conn as never, fullEveryMs: 600_000, now: () => t });
    const first = await s.scan((a) => skipped.push(a.toBase58()));
    assert.equal(first.length, 129, "the voided pair is not returned");
    assert.deepEqual(skipped, [undecodable.toBase58()], "only a crankable-status account that does not decode is reported; an old voided one is silent");
    data.set(addrs[1].toBase58(), voided);       // a pair voids …
    data.set(addrs[2].toBase58(), graduated);    // … another graduates
    t += 60_000;
    const second = await s.scan();
    assert.deepEqual(calls, ["gpa", "gma:100", "gma:29"], "by address, chunked at 100");
    assert.equal(second.length, 128);
    assert.equal(second.find((x) => x.address.equals(addrs[2]))?.pair.status, STATUS_GRADUATED);
    assert.ok(!second.some((x) => x.address.equals(addrs[1])));
    t += 600_000; await s.scan();
    assert.equal(calls.at(-1), "gpa", "a full scan again after fullEveryMs");
  });
});

describe("review 2026-10-15: the settled lock's 30-minute claim check (item 11)", () => {
  test("a settled lock is re-read every 30 minutes, an unsettled one every 5; a build or send for the coin drops it at once", async () => {
    const { cachedLockFees } = await import("@/lib/burnticker/keeperReadCache");
    let t = 0, reads = 0, settled = true;
    const st = () => ({ graduated: true, pool: "p", lpMint: "l", feeKey: "f", feeKeyOwner: "o", lockedLiquidity: "x", feeKeyRegistered: settled, poolRegistered: true, lockedPct: 100, accruedSolLamports: BigInt(0), accruedTokenRaw: BigInt(0) });
    const port = { mint: "M", feeKeysPda: "o", async state() { reads++; return st(); }, async buildClaim() { return { signature: "s", raw: new Uint8Array(), blockhash: "b", lastValidBlockHeight: 1 }; } };
    const client = { programId: "P", cluster: "mainnet", feeKeysPda: () => "o", operatorTreasury: () => "T", port: () => port };
    const cache = new KeeperReadCache({ now: () => t });
    const lf = cachedLockFees(client as never, cache);
    await lf.port("M").state();
    t += 6 * 60_000; await lf.port("M").state();
    t += 20 * 60_000; await lf.port("M").state();
    assert.equal(reads, 1, "settled: one read in 26 minutes");
    t += 5 * 60_000; await lf.port("M").state();
    assert.equal(reads, 2, "past 30 minutes: read again");
    await lf.port("M").buildClaim();
    await lf.port("M").state();
    assert.equal(reads, 3, "a claim build drops the entry");
    settled = false; t += 31 * 60_000; await lf.port("M").state();
    t += 6 * 60_000; await lf.port("M").state();
    assert.equal(reads, 5, "unsettled: the 5-minute TTL");
  });
});

describe("final review follow-ups (2026-10-15)", () => {
  test("F2: sendableWork keeps the OLDEST ten dates (the oldest cranks first)", async () => {
    const { sendableWork } = await import("@/lib/burnticker/multiKeeper");
    const rows = Array.from({ length: 14 }, (_, i) => ({ readingDate: 20261001 + i, settledAt: "2026-10-01T00:00:00Z" }));
    assert.deepEqual(sendableWork(rows, Date.parse("2026-10-20T00:00:00Z")).dates, Array.from({ length: 10 }, (_, i) => 20261001 + i));
  });
  test("refresh keys: a pair coin adds both PairLinks and the PairResult of each date; a single coin does not", async () => {
    const { freshReadKeys } = await import("@/lib/burnticker/cycleAccountCache");
    const { configPda, feePda, pairLinkPda, pairResultPda, readingPda } = await import("@/lib/burnReceipts/pda");
    const pid = Keypair.generate().publicKey, a = Keypair.generate().publicKey, b = Keypair.generate().publicKey;
    const single = freshReadKeys(pid, a.toBase58(), [20261014], null);
    assert.deepEqual(single, [configPda(pid, a), feePda(pid, a), a, readingPda(pid, configPda(pid, a), 20261014)].map((k) => k.toBase58()));
    const paired = freshReadKeys(pid, a.toBase58(), [20261014], { mintA: b.toBase58(), mintB: a.toBase58() });
    assert.deepEqual(paired.slice(4), [pairLinkPda(pid, a), pairLinkPda(pid, b), pairResultPda(pid, a, b, 20261014)].map((k) => k.toBase58()));
  });
  test("N2 leftover: a single-account pass-through asks for the slot floor when one is set, retries -32016, then reads unfloored without caching", async () => {
    const accs = new Map([[Keypair.generate().publicKey.toBase58(), null]]);
    const key = Keypair.generate().publicKey;
    const cfgs: unknown[] = []; let refuse = 99;
    const rpc = Object.assign(fakeConn(new Map([[key.toBase58(), { data: Buffer.from([1]), owner: OTHER, lamports: 5 }]])), {
      async getAccountInfoAndContext(_pk: PublicKey, c?: { minContextSlot?: number }) {
        cfgs.push(c);
        if (typeof c === "object" && c?.minContextSlot && refuse-- > 0) throw Object.assign(new Error("Minimum context slot has not been reached"), { code: -32016 });
        return { context: { slot: 10 }, value: { data: Buffer.from([1]), owner: OTHER, lamports: 5, executable: false, rentEpoch: 0 } };
      },
      async getSignatureStatuses() { return { value: [{ slot: 500, confirmationStatus: "confirmed" }] }; },
      async getMultipleAccountsInfo(_p: PublicKey[], c?: { minContextSlot?: number }) { if (c?.minContextSlot) throw Object.assign(new Error("Minimum context slot has not been reached"), { code: -32016 }); return [null]; },
    });
    void accs;
    const slept: number[] = [];
    const cache = new CycleAccountCache(rpc as never, { sleep: async (ms) => { slept.push(ms); } });
    const c = cache.connection<ReturnType<typeof fakeConn>>();
    await cache.beginCycle();
    await c.getAccountInfo(key);
    assert.deepEqual(cfgs, ["confirmed"], "no floor yet: plain");
    await c.sendRawTransaction(); await c.getSignatureStatuses();
    cfgs.length = 0; slept.length = 0;
    await c.getAccountInfo(key);
    slept.splice(0, 3);   // the re-prefetch's own three retries (it never reaches the floor here)
    assert.deepEqual(cfgs.slice(0, 4), Array(4).fill({ commitment: "confirmed", minContextSlot: 500 }));
    assert.deepEqual(slept, [400, 400, 400]);
    assert.equal(cfgs.at(-1), "confirmed", "past the retries: unfloored");
    cfgs.length = 0; await c.getAccountInfo(key);
    assert.ok(cfgs.length > 0, "the unfloored slot-10 answer was not cached");
    refuse = 0; cfgs.length = 0;
    await c.getAccountInfo(key);
    assert.deepEqual(cfgs, [{ commitment: "confirmed", minContextSlot: 500 }]);
  });
  test("F1: a hold wrapped by web3.js (plain Error, or a cause) is recognised; a lock-fee step on such an error waits without an alert", async () => {
    const { BudgetHoldError, isBudgetHold } = await import("@/lib/burnticker/apiBudget");
    const hold = new BudgetHoldError("helius", { state: "hold", used: 1, budget: 1 });
    assert.equal(isBudgetHold(hold), true);
    assert.equal(isBudgetHold(new Error(`failed to get recent blockhash: ${hold.message}`)), true);
    assert.equal(isBudgetHold(new Error("failed to get balance", { cause: hold })), true);
    assert.equal(isBudgetHold(new Error(`failed: ${new BudgetHoldError("helius", { state: "busy", waitMs: 99_000 }).message}`)), true);
    assert.equal(isBudgetHold(new Error("failed to get recent blockhash: 503")), false);
    const { claimLockFeesFor } = await import("@/lib/burnticker/lockFeesKeeper");
    const { openRegistry } = await import("@/lib/burnticker/registry");
    const reg = openRegistry(":memory:");
    const port = { mint: "M", feeKeysPda: "K", async state() { throw new Error(`failed to get recent blockhash: ${hold.message}`); } };
    const r = await claimLockFeesFor({ registry: reg, lockFees: { programId: "P", cluster: "mainnet", feeKeysPda: () => "K", operatorTreasury: () => "T", port: () => port } as never, log: () => undefined, now: () => Date.now(), dryRun: false }, { mint: "M", ticker: "M" } as never);
    assert.equal(r.outcome, "waiting");
    assert.equal((reg.db.prepare("SELECT COUNT(*) AS n FROM alerts").get() as { n: number }).n, 0);
    reg.close();
  });
  test("F1: the crank and execute catches use isBudgetHold (no instanceof left)", async () => {
    const fs = await import("node:fs");
    const mk = fs.readFileSync("src/lib/burnticker/multiKeeper.ts", "utf8");
    assert.doesNotMatch(mk, /instanceof BudgetHoldError/);
    assert.match(mk, /if \(isBudgetHold\(e\)\) \{ const m = \(e as Error\)\.message\.slice\(0, 160\); d\.log\(`  \[crank\]/);
    assert.equal((mk.match(/if \(!isBudgetHold\(e\)\)/g) ?? []).length, 3);
    assert.doesNotMatch(fs.readFileSync("src/lib/burnticker/lockFeesKeeper.ts", "utf8"), /instanceof BudgetHoldError/);
  });
});

