// ROUND 5 — A COIN THAT BURNS ANOTHER TOKEN, the client half (src/lib/burnReceipts/burnTarget.ts + memo v3 + the planner + the fake): the
// instruction account lists come from the IDL in the program's order, admission is judged exactly as the program judges it (Token-2022,
// freeze and mint authorities, the pool's mints and token programs, swaps off, the 1 % fee tier, the SOL floor per cluster), the
// per-crank cap is 2 % of the TARGET pool's SOL reserve, memo v3 round-trips and is rebuilt from the accounts, the in-memory program
// cranks a target coin (kind "target", never waiting for a pool of its own; crank_buyback refused; a held pool; the 30-day unblock), and
// the single-coin keeper refuses a target config.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey } from "@solana/web3.js";
import { AMM_V4_PROGRAM_ID, applyTargetPoolIx, BURN_TARGET_EXTERNAL, burnTargetPda, crankTargetBurnIx, judgeTargetAdmission, pinBurnTargetIx, PRICE_UPDATE_V2_DISCRIMINATOR, proposeTargetPoolIx, PYTH_RECEIVER_PROGRAM_ID, PYTH_SOL_USD_FEED_ID, quoteTargetCrank, sponsoredPriceAccount, TARGET_MIN_WSOL_RESERVE_LAMPORTS, TARGET_POOL_AMM_V4, TARGET_POOL_HELD_ERRORS, vetoTargetPoolIx, type BurnTargetAccount } from "@/lib/burnReceipts/burnTarget";
import { MEMO_V3_MAX_BYTES } from "@/lib/burnReceipts/memoV3";
import { MEMO_MAX_BYTES, CPMM_PROGRAM_ID, MAX_SPEND_RESERVE_BPS, NATIVE_MINT, QUEUE_UNBLOCK_SECS, TOKEN_PROGRAM_ID } from "@/lib/burnReceipts/constants";
import { BURN_RECEIPTS_IDL } from "@/lib/burnReceipts/idl";
import { burnedMintOf, formatTargetMemo, memoFromChain, parseBuybackMemo, parseTargetMemo, type TargetMemo } from "@/lib/burnReceipts/memo";
import { reserveSpendCap } from "@/lib/burnReceipts/math";
import { configPda, feePda } from "@/lib/burnReceipts/pda";
import { DEFERRABLE_ERRORS } from "@/lib/burnReceipts/crank";
import { FakeProgram } from "@/lib/burnKeeper/fakeProgram";
import { configRefusal, WAIT_REASONS } from "@/lib/burnKeeper/programChain";
import type { TokenConfigAccount, ReadingAccount } from "@/lib/burnReceipts/accounts";

const PID = new PublicKey(BURN_RECEIPTS_IDL.address);
const k = () => Keypair.generate().publicKey;
const COIN = k(), TARGET = k(), POOL = k(), AMM = k(), V0 = k(), V1 = k(), OBS = k(), LP = k();
const SOL = BigInt(1_000_000_000);
const FEED = "4ca4beeca86f0d164160323817a4e42b10010a724c2217c6ee41b54cd4cc61fc";

describe("instructions (account order from the IDL)", () => {
  const idlAccounts = (name: string) => BURN_RECEIPTS_IDL.instructions.find((i) => i.name === name)!.accounts.map((a) => a.name);
  test("pin_burn_target: the mint signs, the BurnTarget PDA is created, the pool's AmmConfig and WSOL vault ride along", () => {
    const payer = k();
    const ix = pinBurnTargetIx({ programId: PID, payer, mint: COIN, targetMint: TARGET, pool: POOL, ammConfig: AMM, wsolVault: V0, targetVault: V1, feedId: FEED });
    const names = idlAccounts("pin_burn_target");
    assert.deepEqual(names.slice(0, 12), ["payer", "mint", "config", "burn_target", "target_mint", "target_pool", "target_amm_config", "target_wsol_vault", "target_token_vault", "sol_price_update", "target_price_update", "system_program"]);
    assert.ok(ix.keys[8].pubkey.equals(V1) && ix.keys[9].pubkey.equals(sponsoredPriceAccount(PYTH_SOL_USD_FEED_ID)) && ix.keys[10].pubkey.equals(sponsoredPriceAccount(FEED)), "Pyth's sponsored feeds by default");
    // the mainnet sponsored accounts read 2026-10-13 (docs/burnticker/EXTERNAL-BURN-VENUES.md)
    assert.equal(sponsoredPriceAccount(PYTH_SOL_USD_FEED_ID).toBase58(), "7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE");
    assert.equal(sponsoredPriceAccount(FEED).toBase58(), "6B23K3tkb51vLZA14jcEQVCA1pfHptzEHFA93V5dYwbT");
    assert.deepEqual(ix.data.subarray(8, 40), Buffer.from(FEED, "hex"), "the feed id is the instruction's argument");
    assert.throws(() => pinBurnTargetIx({ programId: PID, payer, mint: COIN, targetMint: TARGET, pool: POOL, ammConfig: AMM, wsolVault: V0, targetVault: V1, feedId: "xyz" }), /64 hex/);
    assert.ok(ix.keys[1].pubkey.equals(COIN) && ix.keys[1].isSigner, "the coin's mint signs");
    assert.ok(ix.keys[2].pubkey.equals(configPda(PID, COIN)));
    assert.ok(ix.keys[3].pubkey.equals(burnTargetPda(PID, COIN)) && ix.keys[3].isWritable);
    assert.ok(ix.keys[5].pubkey.equals(POOL) && ix.keys[6].pubkey.equals(AMM) && ix.keys[7].pubkey.equals(V0));
  });
  test("crank_target_burn takes the pool accounts from the BurnTarget, never from the caller", () => {
    const t: BurnTargetAccount = { version: 1, bump: 255, mint: COIN, target_mint: TARGET, target_decimals: 5, pool_kind: 0, target_feed_id: Buffer.from(FEED, "hex"), pool: POOL, amm_config: AMM, wsol_vault: V0, target_vault: V1, observation: OBS, wsol_is_token_0: true, pinned_at: BigInt(0), total_target_burned: BigInt(0), total_spent_lamports: BigInt(0), burns: 0, repins: 0, pending_pool: PublicKey.default, pending_eta: BigInt(0) };
    const ix = crankTargetBurnIx({ programId: PID, cranker: k(), mint: COIN, recordDate: 20261011, target: t, cluster: "devnet" });
    const names = idlAccounts("crank_target_burn");
    const at = (n: string) => ix.keys[names.indexOf(n)].pubkey;
    assert.ok(at("pool_state").equals(POOL) && at("amm_config").equals(AMM) && at("wsol_vault").equals(V0) && at("target_vault").equals(V1) && at("observation_state").equals(OBS));
    assert.ok(at("target_mint").equals(TARGET) && at("burn_target").equals(burnTargetPda(PID, COIN)));
    assert.ok(at("swap_program").equals(CPMM_PROGRAM_ID.devnet), "the cluster's CPMM id, as crank_buyback");
    assert.ok(at("fee_vault").equals(feePda(PID, COIN)));
    assert.ok(at("sol_price_update").equals(sponsoredPriceAccount(PYTH_SOL_USD_FEED_ID)) && at("target_price_update").equals(sponsoredPriceAccount(FEED)));
    // an AMM v4 target: the AMM program, and the vault authority (the pinned amm_config) in the authority slot
    const v4 = crankTargetBurnIx({ programId: PID, cranker: k(), mint: COIN, recordDate: 20261011, target: { ...t, pool_kind: TARGET_POOL_AMM_V4, observation: POOL }, cluster: "mainnet" });
    const at4 = (n: string) => v4.keys[names.indexOf(n)].pubkey;
    assert.ok(at4("swap_program").equals(AMM_V4_PROGRAM_ID.mainnet) && at4("cpmm_authority").equals(AMM) && at4("observation_state").equals(POOL));
  });
  test("re-pin: propose (admin), veto (any attester), apply (anyone, the proposed pool)", () => {
    const admin = k();
    assert.ok(proposeTargetPoolIx({ programId: PID, admin, mint: COIN, pool: POOL }).keys[0].isSigner);
    assert.ok(vetoTargetPoolIx({ programId: PID, attester: admin, mint: COIN }).keys[0].isSigner);
    const ap = applyTargetPoolIx({ programId: PID, caller: admin, mint: COIN, targetMint: TARGET, newPool: POOL, newAmmConfig: AMM, newWsolVault: V0, newTargetVault: V1, feedId: FEED });
    assert.ok(ap.keys[4].pubkey.equals(POOL));
  });
});

// ------------------------------------------------------------------------------------------------------------------------------------
// admission
// ------------------------------------------------------------------------------------------------------------------------------------

function mintData(o: { mintAuthority?: PublicKey | null; freeze?: PublicKey | null; decimals?: number } = {}): Buffer {
  const d = Buffer.alloc(82);
  if (o.mintAuthority) { d.writeUInt32LE(1, 0); o.mintAuthority.toBuffer().copy(d, 4); }
  d.writeBigUInt64LE(BigInt(1e15), 36); d[44] = o.decimals ?? 5; d[45] = 1;
  if (o.freeze) { d.writeUInt32LE(1, 46); o.freeze.toBuffer().copy(d, 50); }
  return d;
}
function poolData(o: { t0?: PublicKey; t1?: PublicKey; prog0?: PublicKey; prog1?: PublicKey; status?: number; openTime?: bigint; creatorFee?: boolean } = {}): Buffer {
  const d = Buffer.alloc(637);
  Buffer.from([247, 237, 227, 245, 215, 195, 222, 70]).copy(d, 0);
  AMM.toBuffer().copy(d, 8); V0.toBuffer().copy(d, 72); V1.toBuffer().copy(d, 104); LP.toBuffer().copy(d, 136);
  (o.t0 ?? NATIVE_MINT).toBuffer().copy(d, 168); (o.t1 ?? TARGET).toBuffer().copy(d, 200);
  (o.prog0 ?? TOKEN_PROGRAM_ID).toBuffer().copy(d, 232); (o.prog1 ?? TOKEN_PROGRAM_ID).toBuffer().copy(d, 264);
  OBS.toBuffer().copy(d, 296); d[329] = o.status ?? 0; d.writeBigUInt64LE(o.openTime ?? BigInt(0), 373); d[390] = o.creatorFee === false ? 0 : 1;
  return d;
}
function ammData(trade: number, creator: number): Buffer {
  const d = Buffer.alloc(236);
  Buffer.from([218, 244, 33, 104, 203, 203, 43, 111]).copy(d, 0);
  d.writeBigUInt64LE(BigInt(trade), 12); d.writeBigUInt64LE(BigInt(creator), 108);
  return d;
}
const TOKEN_2022 = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
const base = { coinMint: COIN, targetMint: TARGET, pool: POOL, cluster: "mainnet" as const, now: 1_800_000_000, mintOwner: TOKEN_PROGRAM_ID, mintData: mintData(), poolOwner: CPMM_PROGRAM_ID.mainnet, poolData: poolData(), ammConfigData: ammData(2_500, 7_500), wsolVaultAmount: BigInt(85) * SOL, targetVaultAmount: BigInt(1e14) };

describe("admission (the program's checks, judged from chain bytes)", () => {
  test("an admissible target pins: SPL Token, no authorities, {target, SOL}, 1 % tier, over the floor", () => {
    const a = judgeTargetAdmission(base);
    assert.deepEqual(a.problems, []); assert.equal(a.ok, true);
    assert.equal(a.decimals, 5); assert.ok(a.wsolVault!.equals(V0) && a.targetVault!.equals(V1) && a.ammConfig!.equals(AMM) && a.observation!.equals(OBS));
    assert.equal(a.wsolIsToken0, true); assert.equal(a.feePpm, BigInt(10_000)); assert.equal(a.wsolReserve, BigInt(85) * SOL);
    // the other orientation
    const b = judgeTargetAdmission({ ...base, poolData: poolData({ t0: TARGET, t1: NATIVE_MINT }), wsolVaultAmount: BigInt(1e14), targetVaultAmount: BigInt(85) * SOL });
    assert.equal(b.ok, true); assert.ok(b.wsolVault!.equals(V1)); assert.equal(b.wsolIsToken0, false);
  });
  test("every refusal the program makes, in plain words", () => {
    const one = (over: Partial<Parameters<typeof judgeTargetAdmission>[0]>, re: RegExp) => { const a = judgeTargetAdmission({ ...base, ...over }); assert.equal(a.ok, false); assert.ok(a.problems.some((p) => re.test(p)), `${re} in ${a.problems.join(" | ")}`); };
    one({ mintOwner: TOKEN_2022 }, /Token-2022/);
    one({ mintData: mintData({ freeze: k() }) }, /freeze authority/);
    one({ mintData: mintData({ mintAuthority: k() }) }, /can still be minted/);
    one({ targetMint: COIN }, /this coin itself/);
    one({ targetMint: NATIVE_MINT, poolData: poolData({ t1: NATIVE_MINT }) }, /SOL itself/);
    one({ mintOwner: null, mintData: null }, /does not exist/);
    one({ poolOwner: k() }, /not a Raydium CPMM or AMM v4 pool/);
    one({ poolData: poolData({ t1: k() }) }, /does not pair that token with SOL/);
    one({ poolData: poolData({ prog1: TOKEN_2022 }) }, /classic SPL tokens/);
    one({ poolData: poolData({ status: 4 }) }, /switched off/);
    one({ poolData: poolData({ openTime: BigInt(1_900_000_000) }) }, /switched off/);
    one({ ammConfigData: ammData(20_000, 0) }, /above 1%/);
    one({ ammConfigData: ammData(2_500, 7_501) }, /above 1%/);
    one({ wsolVaultAmount: BigInt(49) * SOL }, /less than 50 SOL/);
    // the creator fee only counts when the pool charges it
    assert.equal(judgeTargetAdmission({ ...base, poolData: poolData({ creatorFee: false }), ammConfigData: ammData(10_000, 50_000) }).ok, true);
    // devnet's floor is 2 SOL
    assert.equal(TARGET_MIN_WSOL_RESERVE_LAMPORTS.devnet, BigInt(2) * SOL);
    assert.equal(judgeTargetAdmission({ ...base, cluster: "devnet", poolOwner: CPMM_PROGRAM_ID.devnet, wsolVaultAmount: BigInt(3) * SOL }).ok, true);
  });
});

function ammV4Data(o: { status?: number; feeNum?: number; feeDen?: number; pnlPc?: bigint; coinMint?: PublicKey; pcMint?: PublicKey } = {}): Buffer {
  const d = Buffer.alloc(752);
  d.writeBigUInt64LE(BigInt(o.status ?? 6), 0); d.writeBigUInt64LE(BigInt(254), 8);
  d.writeBigUInt64LE(BigInt(o.feeNum ?? 25), 176); d.writeBigUInt64LE(BigInt(o.feeDen ?? 10_000), 184); d.writeBigUInt64LE(o.pnlPc ?? BigInt(0), 200);
  V1.toBuffer().copy(d, 336); V0.toBuffer().copy(d, 368); (o.coinMint ?? TARGET).toBuffer().copy(d, 400); (o.pcMint ?? NATIVE_MINT).toBuffer().copy(d, 432);
  return d;
}
function pythData(feedHex: string, price: bigint, expo: number, publish: number, o: { full?: boolean; conf?: bigint } = {}): Buffer {
  const full = o.full ?? true;
  const d = Buffer.alloc(134);
  PRICE_UPDATE_V2_DISCRIMINATOR.copy(d, 0);
  let m = 40;
  if (full) { d[40] = 1; m = 41; } else { d[40] = 0; d[41] = 5; m = 42; }
  Buffer.from(feedHex, "hex").copy(d, m); d.writeBigInt64LE(price, m + 32); d.writeBigUInt64LE(o.conf ?? BigInt(0), m + 40); d.writeInt32LE(expo, m + 48); d.writeBigInt64LE(BigInt(publish), m + 52);
  return d;
}

describe("admission of an AMM v4 pool and the Pyth check (the program's checks)", () => {
  const amm = { ...base, poolOwner: AMM_V4_PROGRAM_ID.mainnet, poolData: ammV4Data(), ammConfigData: null, wsolVaultAmount: BigInt(85) * SOL, targetVaultAmount: BigInt(8e14) };
  // 85 SOL / 8e14 raw (6 decimals): spot = 9,411.76 raw per lamport; SOL $100 and the target $1.0625e-5 agree with it
  const pyth = (tgtPrice: bigint, publish = base.now, opts: { full?: boolean; conf?: bigint } = {}) => ({ feedId: FEED, maxDevBps: 300, solOwner: PYTH_RECEIVER_PROGRAM_ID, solData: pythData(PYTH_SOL_USD_FEED_ID, BigInt(10_000_000_000), -8, base.now), targetOwner: PYTH_RECEIVER_PROGRAM_ID, targetData: pythData(FEED, tgtPrice, -12, publish, opts) });
  const dec6 = mintData({ decimals: 6 });
  test("a swap-only AMM v4 pool of {target, SOL} with a fresh Pyth price it agrees with is admitted; the authority is derived", () => {
    const a = judgeTargetAdmission({ ...amm, mintData: dec6, pyth: pyth(BigInt(10_625_000)) });
    assert.deepEqual(a.problems, []);
    assert.equal(a.poolKind, TARGET_POOL_AMM_V4); assert.ok(a.wsolVault!.equals(V0) && a.targetVault!.equals(V1) && a.observation!.equals(POOL));
    assert.equal(a.feePpm, BigInt(2_500)); assert.ok(a.ammConfig !== null);
    assert.equal(a.referenceX32! >> BigInt(32), BigInt(9_411)); assert.equal(a.spotX32! >> BigInt(32), BigInt(9_411));
  });
  test("AMM v4 refusals: not swap-only, fee over 1 %, owed PnL under the floor, another token", () => {
    const one = (over: Partial<Parameters<typeof judgeTargetAdmission>[0]>, re: RegExp) => { const a = judgeTargetAdmission({ ...amm, mintData: dec6, ...over }); assert.ok(a.problems.some((p) => re.test(p)), `${re} in ${a.problems.join(" | ")}`); };
    one({ poolData: ammV4Data({ status: 1 }) }, /swap-only/);
    one({ poolData: ammV4Data({ feeNum: 200 }) }, /above 1%/);
    one({ poolData: ammV4Data({ pnlPc: BigInt(40) * SOL }) }, /less than 50 SOL/);
    one({ poolData: ammV4Data({ coinMint: k() }) }, /does not pair that token with SOL/);
  });
  test("Pyth refusals: a price 10 % off the pool, stale, wide, partially verified, the wrong feed, not the receiver's", () => {
    const one = (p: ReturnType<typeof pyth>, re: RegExp) => { const a = judgeTargetAdmission({ ...amm, mintData: dec6, pyth: p }); assert.equal(a.ok, false); assert.ok(a.problems.some((x) => re.test(x)), `${re} in ${a.problems.join(" | ")}`); };
    one(pyth(BigInt(11_700_000)), /too far from the token's market price/);
    one(pyth(BigInt(10_625_000), base.now - 61), /more than a minute old/);
    one(pyth(BigInt(10_625_000), base.now, { conf: BigInt(212_500) }), /too uncertain/);
    one(pyth(BigInt(10_625_000), base.now, { full: false }), /fully checked/);
    one({ ...pyth(BigInt(10_625_000)), targetData: pythData("11".repeat(32), BigInt(10_625_000), -12, base.now) }, /fully checked/);
    one({ ...pyth(BigInt(10_625_000)), targetOwner: k() }, /not on this network/);
    one({ ...pyth(BigInt(10_625_000)), feedId: PYTH_SOL_USD_FEED_ID }, /not a token's Pyth feed/);
  });
});

describe("the crank's arithmetic", () => {
  test("the spend is capped at 2 % of the TARGET pool's SOL reserve; the rest is carried", () => {
    const twap = (BigInt(1e14) << BigInt(32)) / (BigInt(85) * SOL);
    const q = quoteTargetCrank({ target: BigInt(10) * SOL, poolBefore: BigInt(25) * SOL, floor: BigInt(1_000_000), wsolReserve: BigInt(85) * SOL, tokenReserve: BigInt(1e14), twapX32: twap, feePpm: BigInt(10_000), slippageBps: 300 });
    assert.equal(q.cap, reserveSpendCap(BigInt(85) * SOL, Number(MAX_SPEND_RESERVE_BPS)));
    assert.equal(q.spend, q.cap); assert.equal(q.capBound, true); assert.equal(q.carried, BigInt(10) * SOL - q.cap);
    assert.ok(q.minOut > BigInt(0) && q.minOut <= q.expectedOut);
    const small = quoteTargetCrank({ target: BigInt(500_000), poolBefore: SOL, floor: BigInt(1_000_000), wsolReserve: BigInt(85) * SOL, tokenReserve: BigInt(1e14), twapX32: twap, feePpm: BigInt(10_000), slippageBps: 300 });
    assert.deepEqual([small.spend, small.carried], [BigInt(0), BigInt(500_000)], "under the floor: nothing spent");
  });
  test("a held target pool is a wait, never a failure", () => {
    for (const e of TARGET_POOL_HELD_ERRORS) { assert.ok(DEFERRABLE_ERRORS.has(e)); assert.match(WAIT_REASONS[e], /^target pool unhealthy/); }
  });
});

// ------------------------------------------------------------------------------------------------------------------------------------
// memo v3
// ------------------------------------------------------------------------------------------------------------------------------------

describe("memo v3 (a target burn)", () => {
  const m: TargetMemo = { prefix: "TEAMBONK", recordDate: "2026-10-11", source: "espn nfl", prev: "0", now: "1", delta: "1", units: 1, pool: "1000000000", spent: "20000000", got: "1234.5", burn: "1234.5", target: TARGET.toBase58(), own: "0", swap: POOL.toBase58().slice(0, 12), rulesSha12: "0123456789ab", version: "v3", valueDecimals: 0 };
  test("formats exactly like the program and parses back; v2 and v3 never confuse each other", () => {
    const s = formatTargetMemo(m);
    assert.equal(s, `TEAMBONK|2026-10-11|src=espn nfl|prev=0|now=1|delta=1|units=1|pool=1000000000|spent=20000000|got=1234.5|burn=1234.5|target=${TARGET.toBase58()}|own=0|swap=${POOL.toBase58().slice(0, 12)}|rules=sha256:0123456789ab|v3`);
    assert.deepEqual(parseTargetMemo(s), m);
    assert.equal(parseBuybackMemo(s), null);
    assert.equal(parseTargetMemo(s.replace("|v3", "|v2")), null);
    assert.deepEqual(burnedMintOf(s, COIN.toBase58()), { mint: TARGET.toBase58(), isTarget: true });
    assert.throws(() => formatTargetMemo({ ...m, target: "not-a-key" }), /target/);
  });
  test("the browser-safe module's ceiling is the program's; an over-long memo is refused, never truncated", () => {
    assert.equal(MEMO_V3_MAX_BYTES, MEMO_MAX_BYTES);
    assert.throws(() => formatTargetMemo({ ...m, source: "é".repeat(300) }), /over the 566-byte ceiling/);
  });
  test("memoFromChain rebuilds it from the TokenConfig, the Reading and the BurnTarget (own tokens in `owed`)", () => {
    const cfg = { rule: { mode: 0, value_decimals: 0 }, burn_target_kind: BURN_TARGET_EXTERNAL, memoPrefix: "TEAMBONK", memoSource: "espn nfl", rules_sha256: Buffer.from("0123456789ab" + "0".repeat(52), "hex"), cpmm_pool: PublicKey.default } as unknown as TokenConfigAccount;
    const rd = { processed: true, units: BigInt(1), record_date: 20261011, prev_value: BigInt(0), value: BigInt(1), delta: BigInt(1), pool_lamports: BigInt(1e9), spent_lamports: BigInt(2e7), got: BigInt(123_450_000), burned: BigInt(123_450_000), owed: BigInt(0), pool: POOL, outcome: 2 } as unknown as ReadingAccount;
    assert.equal(memoFromChain(cfg, rd, 6, { mint: TARGET, decimals: 5 }), formatTargetMemo(m));
    assert.throws(() => memoFromChain(cfg, rd, 6), /burns a target/);
  });
});

// ------------------------------------------------------------------------------------------------------------------------------------
// the in-memory program and the keeper
// ------------------------------------------------------------------------------------------------------------------------------------

describe("the in-memory program cranks a target coin", () => {
  const ATT = "KeeperDataKey1111111111111111111111111111111";
  let clock = Date.parse("2026-10-12T12:00:00Z");
  const mk = () => new FakeProgram({ mode: "buyback", rulesSha256: "ab".repeat(32), memoPrefix: "TEAMBONK", memoSource: "espn nfl", unitValue: BigInt(1), valueDecimals: 0, fractionPerUnitBps: 500, floorLamports: BigInt(1_000_000), reserveLamports: BigInt(20_000_000), attesters: [ATT], now: () => clock, burnTarget: { mint: TARGET.toBase58(), pool: POOL.toBase58(), decimals: 5 } });
  async function read(p: FakeProgram, recordDate: number, prevDate: number, value: bigint) {
    const tx = await p.buildReading({ recordDate, prevDate, value, sourceUrl: "https://example.test/x", feedId: "treasury.debt_to_penny", valueDecimals: 0 });
    await p.send(tx.raw);
  }
  test("plans kind target without a pool of its own, swaps on the pinned pool, burns the target, writes memo v3", async () => {
    const p = mk();
    assert.equal((await p.config()).burnsTarget, true);
    await read(p, 20261010, 0, BigInt(10)); await read(p, 20261011, 20261010, BigInt(13));
    p.deposit(BigInt(10) * SOL);
    p.feeTokens = BigInt(1_000_000);
    const plan = await p.planCrank();
    assert.ok("kind" in plan && plan.kind === "target", "no waiting-for-pool: the target pool is pinned");
    const supply0 = p.targetSupply, coin0 = p.supply;
    const tx = await plan.build(); await p.send(tx.raw);
    const memo = (await p.memoOf(tx.signature))!;
    const t = parseTargetMemo(memo)!;
    assert.equal(t.target, TARGET.toBase58()); assert.equal(t.own, "1");
    const rd = (await p.reading(20261011))!;
    assert.equal(rd.outcome, "burned"); assert.equal(rd.pool, POOL.toBase58()); assert.equal(rd.owed, BigInt(1_000_000));
    assert.equal(p.targetSupply, supply0 - rd.burned); assert.equal(p.supply, coin0 - BigInt(1_000_000));
  });
  test("a held pool refuses with the program's name, then the 30-day unblock carries the spend", async () => {
    const p = mk();
    await read(p, 20261010, 0, BigInt(10)); await read(p, 20261011, 20261010, BigInt(13));
    p.deposit(BigInt(10) * SOL);
    p.targetPool = "below-floor";
    const plan = await p.planCrank();
    assert.ok("kind" in plan);
    const tx = await plan.build();
    assert.equal((await p.simulate(tx.raw)).err, "TargetPoolBelowFloor");
    clock += QUEUE_UNBLOCK_SECS * 1000;
    const tx2 = await plan.build(); await p.send(tx2.raw);
    const rd = (await p.reading(20261011))!;
    assert.equal(rd.outcome, "below-floor"); assert.equal(rd.spentLamports, BigInt(0)); assert.ok(rd.carriedOutLamports > BigInt(0));
  });
  test("a stranger's crank of a target coin is the target crank too; the single-coin keeper refuses a target config", async () => {
    const p = mk();
    await read(p, 20261010, 0, BigInt(10)); await read(p, 20261011, 20261010, BigInt(13));
    p.deposit(BigInt(5) * SOL);
    assert.ok(p.strangerCrank());
    assert.equal((await p.reading(20261011))!.processed, true);
    const cfg = await p.config();
    assert.match(configRefusal({ ...cfg, valueDecimals: 2 }, { rules: { mode: "buyback", memo: { prefix: "TEAMBONK" } }, sha256: cfg.rulesSha256 } as never) ?? "", /burns a target token/);
  });
});
