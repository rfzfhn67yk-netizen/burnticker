// THE TRADING POOL'S MARKET CAP (indexer-1, 2026-10-12; PLATFORM-NEXT-2 item 3): the Raydium CPMM PoolState decoder pinned against the
// SDK's own layout AND two real pools a LaunchLab coin migrated into (config/burnticker/fixtures/cpmm: mainnet with a Token-2022 coin, devnet
// with an SPL Token coin; WSOL sorts first in both, so a swapped copy checks the other order), the reserve arithmetic (vault minus owed fees), the cap from the mint's current
// supply, and every way the read refuses to give a number. The curve path is untouched (test/burntickerMarket.test.ts).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { PublicKey } from "@solana/web3.js";
import { CpmmPoolInfoLayout } from "@raydium-io/raydium-sdk-v2";
import BN from "bn.js";
import { clearCpmmCache, cpmmMarketCap, CPMM_POOL_SIZE, decodeCpmmPool, decodeMintSupply, decodeTokenAccount, readCpmmMarket, type CpmmReader } from "@/lib/burnticker/market";
import { CPMM_PROGRAM_ID } from "@/lib/burnKeeper/launchlab";
import { fx } from "./burntickerHelpers.ts";

type Fx = { poolId: string; mint: string; launchLabPool: string; accounts: Record<string, { owner: string; dataBase64: string }> };
const MAIN = fx("cpmm/pool.mainnet.json") as Fx, DEV = fx("cpmm/pool.devnet.json") as Fx;
const bytes = (f: Fx, id: string) => new Uint8Array(Buffer.from(f.accounts[id].dataBase64, "base64"));
const NOW = Date.parse("2026-10-12T19:00:00Z");

/** A fake connection that serves the fixture's accounts (and counts its round trips). */
function reader(f: Fx, patch: Record<string, { owner: string; data: Uint8Array } | null> = {}): CpmmReader & { calls: number } {
  const r = {
    calls: 0,
    async getMultipleAccountsInfo(pks: PublicKey[]) {
      r.calls++;
      return pks.map((pk) => {
        const k = pk.toBase58();
        if (k in patch) { const p = patch[k]; return p ? { owner: new PublicKey(p.owner), data: p.data } : null; }
        const a = f.accounts[k];
        return a ? { owner: new PublicKey(a.owner), data: Buffer.from(a.dataBase64, "base64") } : null;
      });
    },
  };
  return r;
}

describe("the CPMM PoolState decoder", () => {
  test("matches the Raydium SDK's CpmmPoolInfoLayout field by field on two real pools", () => {
    assert.equal(CpmmPoolInfoLayout.span, CPMM_POOL_SIZE);
    for (const f of [MAIN, DEV]) {
      const raw = bytes(f, f.poolId);
      assert.equal(raw.length, CPMM_POOL_SIZE);
      const sdk = CpmmPoolInfoLayout.decode(Buffer.from(raw)) as unknown as Record<string, BN | number | boolean | PublicKey>;
      const v = decodeCpmmPool(raw)!;
      for (const [mine, theirs] of [["configId", "configId"], ["poolCreator", "poolCreator"], ["vault0", "vaultA"], ["vault1", "vaultB"], ["lpMint", "mintLp"], ["mint0", "mintA"], ["mint1", "mintB"], ["tokenProgram0", "mintProgramA"], ["tokenProgram1", "mintProgramB"]] as const) assert.equal(v[mine], (sdk[theirs] as PublicKey).toBase58(), `${f.poolId} ${theirs}`);
      for (const [mine, theirs] of [["status", "status"], ["decimals0", "mintDecimalA"], ["decimals1", "mintDecimalB"]] as const) assert.equal(v[mine], sdk[theirs]);
      for (const [mine, theirs] of [["protocolFees0Raw", "protocolFeesMintA"], ["protocolFees1Raw", "protocolFeesMintB"], ["fundFees0Raw", "fundFeesMintA"], ["fundFees1Raw", "fundFeesMintB"], ["creatorFees0Raw", "creatorFeesMintA"], ["creatorFees1Raw", "creatorFeesMintB"], ["openTime", "openTime"]] as const) assert.equal(v[mine].toString(), (sdk[theirs] as BN).toString(), `${f.poolId} ${theirs}`);
      assert.equal(v.enableCreatorFee, sdk.enableCreatorFee);
      assert.equal(f.accounts[f.poolId].owner, (f === MAIN ? CPMM_PROGRAM_ID.mainnet : CPMM_PROGRAM_ID.devnet).toBase58());
    }
    assert.equal(decodeCpmmPool(new Uint8Array(100)), null, "wrong size → null");
  });

  test("mint and token-account decoders: SPL Token and Token-2022, and refusals", () => {
    assert.deepEqual(decodeMintSupply(bytes(MAIN, MAIN.mint)), { supplyRaw: BigInt("999999483809598"), decimals: 6 }, "Token-2022 mint with extensions (421 bytes)");
    assert.deepEqual(decodeMintSupply(bytes(DEV, DEV.mint)), { supplyRaw: BigInt("999628342349265"), decimals: 6 }, "SPL Token mint (82 bytes)");
    const vault = decodeCpmmPool(bytes(DEV, DEV.poolId))!.vault1;
    assert.equal(decodeMintSupply(bytes(DEV, vault)), null, "a token account is not a mint");
    assert.equal(decodeMintSupply(new Uint8Array(82)), null, "uninitialized mint");
    const t = decodeTokenAccount(bytes(DEV, vault))!;
    assert.equal(t.mint, DEV.mint); assert.equal(t.amountRaw, BigInt("330983676337186"));
    assert.equal(decodeTokenAccount(bytes(DEV, DEV.mint)), null, "a mint is not a token account");
  });
});

describe("market cap from the pool", () => {
  test("mainnet (WSOL is token 0): reserves are vault minus protocol, fund and creator fees; cap = SOL reserve × supply ÷ token reserve", async () => {
    clearCpmmCache();
    const r = reader(MAIN);
    const { market, error } = await readCpmmMarket(r, { cluster: "mainnet", mint: MAIN.mint, poolId: MAIN.poolId }, NOW);
    assert.equal(error, null);
    assert.equal(r.calls, 1, "the vaults are Raydium's PDAs, so one round trip reads everything");
    // computed independently from the raw fixture bytes: vault0 79,512,997,686 − 1,005,230 − 20,997,140 − 256,574,296 lamports;
    // vault1 224,311,747,100,386 − 11,678,418,535 − 52,581,633,832 − 0; supply 999,999,483,809,598 (burns already off the mint)
    assert.deepEqual(market, {
      poolId: MAIN.poolId, mint: MAIN.mint, quote: "SOL", tokenReserve: "224247487.048019", solReserve: "79.23442102",
      supply: "999999483.809598", marketCap: "353.334528573", status: 0, readAt: new Date(NOW).toISOString(),
    });
  });

  test("devnet (SPL Token coin)", async () => {
    clearCpmmCache();
    const { market, error } = await readCpmmMarket(reader(DEV), { cluster: "devnet", mint: DEV.mint, poolId: DEV.poolId }, NOW);
    assert.equal(error, null);
    assert.equal(market?.marketCap, "1.888953738"); assert.equal(market?.solReserve, "0.625275808"); assert.equal(market?.tokenReserve, "330893979.328482");
  });

  test("the same pool with its two sides swapped gives the same numbers (the coin as token 0)", () => {
    const p = decodeCpmmPool(bytes(DEV, DEV.poolId))!;
    const vSol = decodeTokenAccount(bytes(DEV, p.vault0))!.amountRaw, vTok = decodeTokenAccount(bytes(DEV, p.vault1))!.amountRaw;
    const swapped = { ...p, mint0: p.mint1, mint1: p.mint0, decimals0: p.decimals1, decimals1: p.decimals0, protocolFees0Raw: p.protocolFees1Raw, protocolFees1Raw: p.protocolFees0Raw, fundFees0Raw: p.fundFees1Raw, fundFees1Raw: p.fundFees0Raw, creatorFees0Raw: p.creatorFees1Raw, creatorFees1Raw: p.creatorFees0Raw };
    const a = cpmmMarketCap(p, vSol, vTok, DEV.mint, BigInt("999628342349265"), 6), b = cpmmMarketCap(swapped, vTok, vSol, DEV.mint, BigInt("999628342349265"), 6);
    assert.ok(a); assert.deepEqual(b, a);
  });

  test("cpmmMarketCap: a pool that does not pair the mint with SOL, or an empty reserve, has no number", () => {
    const pool = decodeCpmmPool(bytes(DEV, DEV.poolId))!;
    assert.equal(cpmmMarketCap(pool, BigInt(1), BigInt(1), MAIN.mint, BigInt(1), 6), null, "another mint");
    assert.equal(cpmmMarketCap(pool, BigInt(10) ** BigInt(12), pool.protocolFees1Raw + pool.fundFees1Raw + pool.creatorFees1Raw, DEV.mint, BigInt(1), 6), null, "token reserve fully owed as fees");
    assert.equal(cpmmMarketCap(pool, BigInt(10) ** BigInt(12), BigInt(10) ** BigInt(12), DEV.mint, BigInt(1), 9), null, "decimals disagree with the mint");
    assert.equal(cpmmMarketCap(pool, BigInt(10) ** BigInt(12), BigInt(10) ** BigInt(12), DEV.mint, BigInt(0), 6)?.marketCap, "0", "everything burned: a real zero, read from the mint");
  });
});

describe("the read refuses rather than guesses", () => {
  const read = (patch: Parameters<typeof reader>[1], over: Partial<{ cluster: string; mint: string; poolId: string }> = {}) => { clearCpmmCache(); return readCpmmMarket(reader(DEV, patch), { cluster: "devnet", mint: DEV.mint, poolId: DEV.poolId, ...over }, NOW); };
  const pool = decodeCpmmPool(bytes(DEV, DEV.poolId))!;
  test("missing pool, wrong owner, wrong size, wrong mint, missing mint, foreign vault, unknown cluster, RPC failure", async () => {
    assert.deepEqual(await read({ [DEV.poolId]: null }), { market: null, error: "the pool account was not found" });
    assert.match((await read({ [DEV.poolId]: { owner: "11111111111111111111111111111111", data: bytes(DEV, DEV.poolId) } })).error!, /not owned by the Raydium CPMM program/);
    assert.match((await read({ [DEV.poolId]: { owner: CPMM_PROGRAM_ID.devnet.toBase58(), data: new Uint8Array(300) } })).error!, /unexpected size/);
    assert.match((await read({}, { mint: MAIN.mint })).error!, /another mint|mint account was not found/);
    assert.match((await read({ [DEV.mint]: null })).error!, /mint account was not found/);
    const wrongVault = Uint8Array.from(bytes(DEV, pool.vault1)); wrongVault.set(new PublicKey(MAIN.mint).toBytes(), 0);
    assert.match((await read({ [pool.vault1]: { owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", data: wrongVault } })).error!, /holds a different mint/);
    assert.match((await read({ [pool.vault1]: null })).error!, /vault could not be read/);
    assert.match((await read({}, { cluster: "testnet" })).error!, /no Raydium CPMM program/);
    clearCpmmCache();
    const boom: CpmmReader = { async getMultipleAccountsInfo() { throw new Error("429 Too Many Requests: {\"jsonrpc\"..."); } };
    assert.deepEqual(await readCpmmMarket(boom, { cluster: "devnet", mint: DEV.mint, poolId: DEV.poolId }, NOW), { market: null, error: "rate-limited by the RPC" });
  });

  test("cached 30 seconds per pool", async () => {
    clearCpmmCache();
    const r = reader(DEV);
    await readCpmmMarket(r, { cluster: "devnet", mint: DEV.mint, poolId: DEV.poolId }, NOW);
    await readCpmmMarket(r, { cluster: "devnet", mint: DEV.mint, poolId: DEV.poolId }, NOW + 29_000);
    assert.equal(r.calls, 1);
    await readCpmmMarket(r, { cluster: "devnet", mint: DEV.mint, poolId: DEV.poolId }, NOW + 31_000);
    assert.equal(r.calls, 2);
  });
});
