// THE PLATFORM KEEPER'S READ CACHE (2026-10-13, src/lib/burnticker/keeperReadCache.ts, docs/burnticker/API-BUDGETS.md): the publish
// loop's chain reads go through a per-coin TTL cache and one batched getMultipleAccounts per cycle. On the keeper fakes: the cache serves
// within its TTL, a crank drops the coin, the batch covers every live coin, and status.json is byte-for-byte the same as the uncached path.
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey, type Connection } from "@solana/web3.js";
import { openRegistry, type Registry, type TokenRow } from "@/lib/burnticker/registry";
import { FakeBurnProgram, type BurnProgramClient } from "@/lib/burnticker/program";
import { ProgramBurnClient } from "@/lib/burnticker/programClient";
import { buildLaunchBundle, FakeLaunchLab } from "@/lib/burnticker/launchBundle";
import { KalshiClient, fixtureFetch, settledMarketsUrl, seriesApiUrl, openMarketsUrl } from "@/lib/burnticker/oracle/kalshi";
import { CatalogueAdapter, feedById, loadFixture } from "@/lib/burnticker/catalogue";
import { runCycle, type KeeperDeps } from "@/lib/burnticker/multiKeeper";
import { buildReceiptsJson, buildTokenStatus } from "@/lib/burnticker/tokenPage";
import { configPda, feePda, vaultAddress } from "@/lib/burnReceipts/pda";
import { BURN_RECEIPTS_IDL } from "@/lib/burnReceipts/idl";
import { discriminatorOf } from "@/lib/burnticker/trustpack/idlReader";
import { BATCH_MAX_ACCOUNTS, cachedLockFees, cachedPublishProgram, coinChainReads, connectionBatchReader, KeeperReadCache, READ_TTL_MS, signatureFingerprints, withLockFees, type BatchItem, type BatchReader } from "@/lib/burnticker/keeperReadCache";
import { BRONCOS, NOW, fx, treasuryAndCrossFetch } from "./burntickerHelpers.ts";

const CREATOR = "CreatorWa11et111111111111111111111111111111";
const ATTESTER = "KeeperDataKey1111111111111111111111111111111";
const SOL = BigInt(1_000_000_000);
const table = {
  [settledMarketsUrl("KXNFLGAME")]: fx("kalshi/KXNFLGAME.settled.json"), [seriesApiUrl("KXNFLGAME")]: fx("kalshi/series.KXNFLGAME.json"), [openMarketsUrl("KXNFLGAME")]: { cursor: "", markets: [] },
};
const treasuryBody = loadFixture(feedById("treasury.debt")!).body;

let reg: Registry, program: FakeBurnProgram, deps: KeeperDeps, clock: number;
async function launch(ticker: string): Promise<TokenRow> {
  const b = await buildLaunchBundle({ creator: CREATOR, ticker, name: `${ticker} coin`, description: "a test", imageUrl: null, links: [], rule: BRONCOS, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true }, cluster: "devnet" }, { program, launchLab: new FakeLaunchLab(), devFeeWallet: null, attesters: [ATTESTER], quorum: 1, metadataUri: (m) => `https://x/${m}.json` });
  const t = reg.register({ mint: b.mint, ticker, name: b.name, creator: CREATOR, description: b.description, imageUrl: null, links: [], rulesText: b.rules.text, feePda: b.addresses.feePda, vault: b.addresses.vault, tokenConfig: b.addresses.tokenConfig, poolId: b.addresses.poolId, launchTx: null, cluster: "devnet", platformId: b.addresses.platformId, baselineAt: "2026-09-01T00:00:00Z", status: "draft" }, clock);
  reg.markLaunched(t.mint, `launch${ticker}`, b.addresses.poolId, "2026-09-01T00:00:00Z");
  reg.addAttester({ mint: t.mint, pubkey: ATTESTER, role: "data-key", addedAt: clock, timelockUntil: null });
  if (program.tokens.has(t.mint)) program.supplies.set(t.mint, BigInt("1000000000000000"));
  return reg.token(t.mint)!;
}

/** Counts the per-coin chain reads a client makes (the fake has no RPC; each method call stands for the RPC calls it makes on chain). */
function counting(p: BurnProgramClient) {
  const n = { supply: 0, feePda: 0, vault: 0, config: 0, lp: 0 };
  const wrap = <T extends object>(t: T, over: Record<string, unknown>): T => new Proxy(t, { get: (x, k, r) => (k in over ? over[k as string] : ((v) => (typeof v === "function" ? v.bind(x) : v))(Reflect.get(x, k, r))) });
  const lf = p.lockFees!;
  const client = wrap(p, {
    supplyRaw: (m: string) => { n.supply++; return p.supplyRaw(m); },
    feePdaBalanceLamports: (m: string) => { n.feePda++; return p.feePdaBalanceLamports(m); },
    vaultBalanceRaw: (m: string) => { n.vault++; return p.vaultBalanceRaw(m); },
    port: (m: string) => { const base = p.port(m); return wrap(base, { config: () => { n.config++; return base.config(); } }); },
    lockFees: wrap(lf, { port: (m: string) => { const base = lf.port(m); return wrap(base, { state: (o?: { accrued?: boolean }) => { n.lp++; return base.state(o); } }); } }),
  });
  return { client, n, total: () => n.supply + n.feePda + n.vault + n.config + n.lp };
}

const operator = { can: ["crank a burn the rule computes"], cannot: ["change a rule"], placeholder: true };
/** status.json for one coin, built the way scripts/burnticker-keeper.mts publishAll builds it (chain fields from coinChainReads). */
async function statusJson(t: TokenRow, client: BurnProgramClient): Promise<string> {
  const locked = reg.lockedRule(t);
  const readings = reg.readings(t.selectorKey, t.baselineAt);
  const reads = await coinChainReads({ registry: reg, program: client, cluster: "devnet", t, mode: locked.mode, marketReader: null, now: clock });
  const input = { token: t, locked, readings, receipts: reg.receipts(t.mint), attesters: reg.attesters(t.mint), state: reg.state(t.mint), feedState: reg.feedState(t.selectorKey),
    chain: reads.chain, now: clock, nextCheckAt: null, implied: null, seriesTitle: null, selectorPending: 0, operator, lifecycle: null, pair: reads.pair, lp: reads.lp, market: reads.market } as unknown as Parameters<typeof buildTokenStatus>[0];
  return JSON.stringify(buildTokenStatus(input, buildReceiptsJson(input)), (_k, v) => (typeof v === "bigint" ? v.toString() : v));
}

/** A batch reader over the fake program that records each call (the real one is connectionBatchReader, tested below on a fake Connection). */
function recordingBatch(p: BurnProgramClient) {
  const calls: BatchItem[][] = [];
  const reader: BatchReader = { async readMany(items) { calls.push([...items]); return new Map(await Promise.all(items.map(async (it) => [it.mint, { config: await p.port(it.mint).config(), feePdaLamports: await p.feePdaBalanceLamports(it.mint), supplyRaw: await p.supplyRaw(it.mint), ...(it.vault ? { vaultRaw: await p.vaultBalanceRaw(it.mint) } : {}) }] as const))); } };
  return { reader, calls };
}

beforeEach(() => {
  reg = openRegistry(":memory:"); program = new FakeBurnProgram("devnet"); clock = NOW; program.now = () => clock;
  deps = { registry: reg, program, oracles: { kalshi: new KalshiClient({ fetchImpl: fixtureFetch(table), now: () => clock, minIntervalMs: 0 }), catalogue: new CatalogueAdapter({ fetchImpl: treasuryAndCrossFetch(treasuryBody), now: () => clock }) }, attester: ATTESTER, log: () => {}, now: () => clock, dryRun: false };
});

describe("the keeper's read cache", () => {
  test("serves within its TTL: a second publish 30 s later makes no chain read; the fee PDA re-reads after 60 s, the rest after 5 min", async () => {
    const t = await launch("BRONCO");
    program.deposit(t.mint, BigInt(2) * SOL);
    const c = counting(program);
    const cache = new KeeperReadCache({ now: () => clock });
    const cached = cachedPublishProgram(c.client, cache);
    await statusJson(t, cached);
    const first = { ...c.n };
    assert.ok(c.total() >= 4, JSON.stringify(c.n));
    clock += 30_000;
    await statusJson(t, cached);
    assert.deepEqual(c.n, first, "nothing re-read inside the TTL");
    clock += READ_TTL_MS.feePda;
    await statusJson(t, cached);
    assert.equal(c.n.feePda, first.feePda + 1, "the fee PDA re-reads after 60 s");
    assert.equal(c.n.supply, first.supply); assert.equal(c.n.config, first.config); assert.equal(c.n.lp, first.lp);
    clock += READ_TTL_MS.supply;
    await statusJson(t, cached);
    assert.equal(c.n.supply, first.supply + 1); assert.equal(c.n.config, first.config + 1); assert.equal(c.n.lp, first.lp + 1);
  });

  test("a crank drops the coin: the fee PDA a burn spent shows on the next publish, not 60 s later", async () => {
    const t = await launch("BRONCO");
    program.deposit(t.mint, BigInt(5) * SOL);
    program.fake(t.mint).poolReserveWsol = BigInt(2) * SOL;
    const cache = new KeeperReadCache({ now: () => clock });
    const cached = cachedPublishProgram(program, cache);
    cache.afterCycle(null, signatureFingerprints(reg.db));
    const before = await cached.feePdaBalanceLamports(t.mint);
    const supplyBefore = await cached.supplyRaw(t.mint);
    assert.equal(before, await program.feePdaBalanceLamports(t.mint));
    // the cycle cranks with the lock-fee client through the cache, as the keeper wires it
    const r = await runCycle({ ...deps, program: withLockFees(program, cached.lockFees!) });
    assert.equal(r.executed[0]?.outcome, "confirmed", JSON.stringify(r, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
    const fresh = await program.feePdaBalanceLamports(t.mint);
    assert.ok(fresh < before, "the crank spent from the pool");
    assert.equal(await cached.feePdaBalanceLamports(t.mint), before, "still the cached value until the keeper drops it");
    const dropped = cache.afterCycle(r, signatureFingerprints(reg.db));
    assert.deepEqual(dropped, [t.mint]);
    assert.equal(await cached.feePdaBalanceLamports(t.mint), fresh, "re-read at once after the crank");
    assert.ok((await cached.supplyRaw(t.mint))! <= supplyBefore!, "supply re-read too");
    // the signature fingerprint alone (a reading or crank recorded in the registry) drops the coin, without a report
    const before2 = await cached.feePdaBalanceLamports(t.mint);
    reg.recordSignature({ signature: "sigX", mint: t.mint, eventId: "reading:20261010", memo: "m", burnRaw: BigInt(0), spendLamports: BigInt(0), blockhash: "b", lastValidBlockHeight: 1, sentAt: clock });
    program.deposit(t.mint, SOL);
    assert.equal(await cached.feePdaBalanceLamports(t.mint), before2);
    assert.deepEqual(cache.afterCycle(null, signatureFingerprints(reg.db)), [t.mint]);
    assert.equal(await cached.feePdaBalanceLamports(t.mint), before2 + SOL);
  });

  test("a lock-fee claim or registration drops the coin before it is built; a state read with the accrual serves the page's read", async () => {
    const t = await launch("BRONCO");
    const cache = new KeeperReadCache({ now: () => clock });
    const c = counting(program);
    const lf = cachedLockFees(c.client.lockFees!, cache);
    await lf.port(t.mint).state();              // the cycle's claim step (with the accrual)
    await lf.port(t.mint).state({ accrued: false });   // the page (lpLockBlock)
    assert.equal(c.n.lp, 1, "the page reuses the claim step's read");
    cache.set(t.mint, "feePda", BigInt(1));
    await lf.port(t.mint).buildClaim().catch(() => null);
    assert.equal(cache.peek(t.mint, "feePda"), undefined, "a claim build drops the coin's entries");
    await lf.port(t.mint).state({ accrued: false });
    assert.equal(c.n.lp, 2);
  });

  test("the batch covers every published coin in one call, and the publish then makes no per-coin supply / fee PDA / TokenConfig read", async () => {
    const coins = [await launch("BRONCO"), await launch("BRONCOB"), await launch("BRONCOC")];
    const c = counting(program);
    const cache = new KeeperReadCache({ now: () => clock });
    const b = recordingBatch(program);
    const items = coins.map((t) => ({ mint: t.mint, vault: reg.lockedRule(t).mode === "vault", poolId: null }));
    assert.equal(await cache.prefetch(b.reader, items), 3);
    assert.equal(b.calls.length, 1);
    assert.deepEqual(b.calls[0].map((x) => x.mint).sort(), coins.map((t) => t.mint).sort());
    const cached = cachedPublishProgram(c.client, cache);
    for (const t of coins) await statusJson(t, cached);
    assert.equal(c.n.supply + c.n.feePda + c.n.config, 0, JSON.stringify(c.n));
    // a second prefetch inside the TTL reads nothing; after 60 s it reads every coin again, still in one call
    assert.equal(await cache.prefetch(b.reader, items), 0);
    clock += READ_TTL_MS.feePda;
    assert.equal(await cache.prefetch(b.reader, items), 3);
    assert.equal(b.calls.length, 2);
  });

  test("status.json is byte-for-byte the same through the cache (cold, batched and warm) as the uncached reads, for an unchanged chain", async () => {
    const coins = [await launch("BRONCO"), await launch("BRONCOB")];
    program.deposit(coins[0].mint, BigInt(3) * SOL);
    const raw = await Promise.all(coins.map((t) => statusJson(t, program)));
    const cache = new KeeperReadCache({ now: () => clock });
    const cached = cachedPublishProgram(program, cache);
    for (let i = 0; i < coins.length; i++) assert.equal(await statusJson(coins[i], cached), raw[i], "cold cache");
    for (let i = 0; i < coins.length; i++) assert.equal(await statusJson(coins[i], cached), raw[i], "warm cache");
    const cache2 = new KeeperReadCache({ now: () => clock });
    await cache2.prefetch(recordingBatch(program).reader, coins.map((t) => ({ mint: t.mint, vault: false, poolId: null })));
    const batched = cachedPublishProgram(program, cache2);
    for (let i = 0; i < coins.length; i++) assert.equal(await statusJson(coins[i], batched), raw[i], "filled by the batch");
  });
});

describe("the real batch reader (connectionBatchReader) on a fake Connection", () => {
  const TOKEN = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
  function world(nCoins: number, given: string[] = []) {
    const programId = Keypair.generate().publicKey;
    const accounts = new Map<string, { data: Buffer; owner: PublicKey; lamports: number }>();
    const mints: string[] = [];
    for (let i = 0; i < nCoins; i++) {
      const mint = given[i] ? new PublicKey(given[i]) : Keypair.generate().publicKey;
      mints.push(mint.toBase58());
      const m = Buffer.alloc(82); m.writeBigUInt64LE(BigInt(1_000_000_000_000_000) - BigInt(i * 7), 36);
      accounts.set(mint.toBase58(), { data: m, owner: TOKEN, lamports: 1_461_600 });
      if (i % 3 !== 2) { const cfg = Buffer.alloc(1368); cfg.set(discriminatorOf(BURN_RECEIPTS_IDL, "TokenConfig"), 0); accounts.set(configPda(programId, mint).toBase58(), { data: cfg, owner: programId, lamports: 1 }); }
      if (i % 2 === 0) accounts.set(feePda(programId, mint).toBase58(), { data: Buffer.alloc(0), owner: PublicKey.default, lamports: 1_000_000 + i });
      if (i % 4 === 1) { const v = Buffer.alloc(165); v.writeBigUInt64LE(BigInt(500 + i), 64); accounts.set(vaultAddress(programId, mint).toBase58(), { data: v, owner: TOKEN, lamports: 2_039_280 }); }
    }
    const calls: Record<string, number> = {};
    const hit = (k: string) => { calls[k] = (calls[k] ?? 0) + 1; };
    const get = (pk: PublicKey) => accounts.get(pk.toBase58()) ?? null;
    const conn = {
      async getAccountInfo(pk: PublicKey) { hit("getAccountInfo"); return get(pk); },
      async getMultipleAccountsInfo(pks: PublicKey[]) { hit("getMultipleAccounts"); assert.ok(pks.length <= BATCH_MAX_ACCOUNTS); return pks.map(get); },
      async getBalance(pk: PublicKey) { hit("getBalance"); return get(pk)?.lamports ?? 0; },
      async getTokenSupply(pk: PublicKey) { hit("getTokenSupply"); const a = get(pk); if (!a) throw new Error("could not find mint"); return { value: { amount: a.data.readBigUInt64LE(36).toString() } }; },
      async getTokenLargestAccounts(mint: PublicKey) { hit("getTokenLargestAccounts"); return { value: [{ address: feePda(programId, mint), amount: "1000", decimals: 6, uiAmountString: "0.001" }] }; },
      async getMultipleParsedAccounts(pks: PublicKey[]) { hit("getMultipleParsedAccounts"); return { value: pks.map(() => ({ data: { parsed: { info: { owner: CREATOR } } } })) }; },
      async getTokenAccountBalance(pk: PublicKey) { hit("getTokenAccountBalance"); const a = get(pk); if (!a) throw new Error("could not find account"); return { value: { amount: a.data.readBigUInt64LE(64).toString() } }; },
    };
    const client = new ProgramBurnClient({ connection: conn as unknown as Connection, programId, cluster: "devnet", payer: null, admin: null, solUsd: async () => 150 });
    return { programId, mints, conn, client, calls };
  }

  test("30 coins (about 104 accounts) read in two getMultipleAccounts calls, decoded exactly as the per-coin reads decode them", async () => {
    const w = world(30);
    const reader = connectionBatchReader(w.conn, w.programId, (m) => w.client.vaultFor(m));
    const items = w.mints.map((mint, i) => ({ mint, vault: i % 4 === 1, poolId: i % 5 === 0 ? w.mints[(i + 1) % 30] : null }));
    const got = await reader.readMany(items);
    assert.equal(w.calls.getMultipleAccounts, Math.ceil((30 * 3 + items.filter((x) => x.vault).length + items.filter((x) => x.poolId).length) / BATCH_MAX_ACCOUNTS));
    assert.equal(w.calls.getMultipleAccounts, 2);
    for (const [i, mint] of w.mints.entries()) {
      const f = got.get(mint)!;
      assert.equal(f.supplyRaw, await w.client.supplyRaw(mint));
      assert.equal(f.feePdaLamports, await w.client.feePdaBalanceLamports(mint));
      assert.deepEqual(f.config, await w.client.port(mint).config().catch(() => null));
      if (items[i].vault) assert.equal(f.vaultRaw, await w.client.vaultBalanceRaw(mint));
    }
  });

  test("through the cache, a quiet publish of every coin makes one batch call and no per-coin call for these fields", async () => {
    const w = world(10);
    const cache = new KeeperReadCache({ now: () => clock });
    const items = w.mints.map((mint, i) => ({ mint, vault: i % 4 === 1, poolId: null }));
    await cache.prefetch(connectionBatchReader(w.conn, w.programId, (m) => w.client.vaultFor(m)), items);
    const cached = cachedPublishProgram(w.client, cache);
    for (const [i, mint] of w.mints.entries()) {
      await cached.supplyRaw(mint); await cached.feePdaBalanceLamports(mint); await cached.port(mint).config().catch(() => null);
      if (items[i].vault) await cached.vaultBalanceRaw(mint);
    }
    assert.deepEqual(w.calls, { getMultipleAccounts: 1 });
  });

  test("measured on the real client: one coin's publish reads before the cache, and on a quiet cycle after it", async () => {
    const coins = [await launch("BRONCO"), await launch("BRONCOB")];
    const w = world(2, coins.map((t) => t.mint));
    const publish = async (client: BurnProgramClient, market: import("@/lib/burnticker/market").MarketReader) => { for (const t of coins) await coinChainReads({ registry: reg, program: client, cluster: "devnet", t, mode: "buyback", marketReader: market, now: clock }); };
    const { clearMarketCache } = await import("@/lib/burnticker/market");
    const { cachedMarketReader } = await import("@/lib/burnticker/keeperReadCache");
    const per = () => Object.values(w.calls).reduce((a, b) => a + b, 0) / coins.length;
    // BEFORE: the raw client and reader, as publishAll read them
    clearMarketCache();
    await publish(w.client, w.conn);
    const before = per();
    // a coin before graduation: getTokenSupply ×2, getBalance, the TokenConfig, the lock lookup ×3 (TokenConfig, FeeKeyRecord, CPMM pool), the
    // LaunchLab pool, getTokenLargestAccounts, the owners (a graduated coin adds 2 more to the lock lookup; a vault coin 2 more)
    assert.equal(before, 10, JSON.stringify(w.calls));
    // AFTER: the cache + the batch; first a cold cycle, then a quiet one 61 s later (the batch and the holders re-read, nothing else)
    const cache = new KeeperReadCache({ now: () => clock });
    const cached = cachedPublishProgram(w.client, cache), market = cachedMarketReader(w.conn, cache, (id) => coins.find((t) => t.poolId === id)?.mint ?? null);
    const items = coins.map((t) => ({ mint: t.mint, vault: false, poolId: t.poolId }));
    const batch = connectionBatchReader(w.conn, w.programId, (m) => w.client.vaultFor(m));
    for (const k of Object.keys(w.calls)) delete w.calls[k];
    clearMarketCache(); await cache.prefetch(batch, items); await publish(cached, market);
    for (const k of Object.keys(w.calls)) delete w.calls[k];
    clock += 61_000;
    clearMarketCache(); await cache.prefetch(batch, items); await publish(cached, market);
    assert.deepEqual(w.calls, { getMultipleAccounts: 1 }, "a quiet cycle: one batch for every coin (the holders are kept 10 minutes since 2026-10-15)");
    const calls = w.calls as Record<string, number>;
    for (const k of Object.keys(calls)) delete calls[k];
    clock += READ_TTL_MS.holders;
    clearMarketCache(); await cache.prefetch(batch, items); await publish(cached, market);
    assert.equal(calls.getTokenLargestAccounts, 2, "every 10 minutes: one holders read per coin");
  });
});
