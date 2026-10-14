// THE COIN PAGE'S SWAP PANEL (swap-1, 2026-10-14; the owner: "make it so you can trade the launched coins on the site").
// Curve and CPMM math against the pinned SDK on saved devnet states, the instruction builders against the SDK's builders (the ones the
// devnet trader and the keeper use), the refusal cases, the copy lint on every label, and the mount point.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import BN from "bn.js";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { buyExactInInstruction, sellExactInInstruction, makeSwapCpmmBaseInInstruction, getPdaLaunchpadAuth, getPdaPlatformVault, getPdaCreatorVault, getPdaLaunchpadPoolId, getPdaPoolAuthority, LaunchpadPool, LaunchpadConfig, PlatformConfig, CpmmConfigInfoLayout, CurveCalculator, Curve } from "@raydium-io/raydium-sdk-v2";
import { decodeCurvePool, decodeCurveConfig, decodeCurvePlatform, decodeCpmmConfig, cpmmPoolExtras } from "@/lib/burnticker/swap/layouts";
import { cpmmCreatorFeeOnInput, cpmmSwapIn, curveRates, curveSolIn, curveTokensIn, formatAmount, minOut, parseAmount } from "@/lib/burnticker/swap/math";
import { associatedTokenAddress, closeAccountIx, CPMM_PROGRAM, createAtaIdempotentIx, LAUNCHLAB_PROGRAM, launchLabPoolId, syncNativeIx, TOKEN_PROGRAM_ID, WSOL_MINT, cpmmAuthority } from "@/lib/burnticker/swap/instructions";
import { balanceRefusal, buildSwap, coinRefusal, marketRefusal, quoteSwap, requoteRefusal, solReserve, walletRefusal, type CpmmMarket, type CurveMarket } from "@/lib/burnticker/swap/plan";
import { REFUSAL, SWAP_COPY, SWAP_NOTICE, NOT_ADVICE_SENTENCE, feeLine, curveSplitLine, capLine, balanceLine, holdsLine, SLIPPAGE_CHOICES_BPS, DEFAULT_SLIPPAGE_BPS } from "@/lib/burnticker/swap/copy";
import { readMarket, readBalances, simulateSignSend, simulationReason, GENESIS_HASH } from "@/lib/burnticker/swap/chain";
import { decodeCpmmPool } from "@/lib/burnReceipts/cpmm";
import { LAUNCHLAB_PROGRAM as KEEPER_LAUNCHLAB, CPMM_PROGRAM_ID as KEEPER_CPMM, WSOL_MINT as KEEPER_WSOL } from "@/lib/burnKeeper/launchlab";
import * as keeperSolana from "@/lib/burnKeeper/solana";
import { lintCopy } from "@/lib/launch/copyLint";
import { RPC_PROXY_METHODS } from "@/lib/burnticker/rpcProxy";
import { FOOTER_COPY } from "@/lib/burnticker/siteNav.mjs";
import { GENESIS_HASH as PROGRAM_GENESIS } from "@/lib/burnReceipts/constants";

type Acc = { address: string; owner: string; data: string };
const FX = JSON.parse(fs.readFileSync("test/fixtures/burnticker-swap-devnet.json", "utf8")) as Record<string, Acc>;
const bytes = (a: Acc) => Buffer.from(a.data, "base64");
const big = (x: { toString(): string }) => BigInt(x.toString());
const bn = (x: bigint) => new BN(x.toString());

const curvePoolId = new PublicKey(FX.curvePool.address);
const sdkPool = LaunchpadPool.decode(bytes(FX.curvePool));
const sdkConfig = LaunchpadConfig.decode(bytes(FX.config));
const sdkPlatform = PlatformConfig.decode(bytes(FX.platform));
const pool = decodeCurvePool(bytes(FX.curvePool)), config = decodeCurveConfig(bytes(FX.config)), platform = decodeCurvePlatform(bytes(FX.platform));
const curveMarket: CurveMarket = { kind: "curve", program: LAUNCHLAB_PROGRAM.devnet, poolId: curvePoolId, pool, config, platform };
const sdkFees = { protocolFeeRate: sdkConfig.tradeFeeRate, platformFeeRate: sdkPlatform.feeRate, creatorFeeRate: sdkPlatform.creatorFeeRate, curveType: sdkConfig.curveType, shareFeeRate: new BN(0), transferFeeConfigA: undefined, transferFeeConfigB: undefined, slot: 0 };

const cpmmAddr = new PublicKey(FX.cpmmPool.address);
const cp = decodeCpmmPool(cpmmAddr, bytes(FX.cpmmPool)), cpx = cpmmPoolExtras(bytes(FX.cpmmPool));
const amm = decodeCpmmConfig(bytes(FX.ammConfig)), sdkAmm = CpmmConfigInfoLayout.decode(bytes(FX.ammConfig));
const vaultAmt = (a: Acc) => bytes(a).readBigUInt64LE(64);
const r0 = vaultAmt(FX.vault0) - cp.fees0, r1 = vaultAmt(FX.vault1) - cp.fees1;
const cpmmMarket: CpmmMarket = { kind: "cpmm", program: CPMM_PROGRAM.devnet, pool: cp, config: amm, solIsToken0: true, reserveSol: r0, reserveToken: r1, creatorFeeOn: cpx.creatorFeeOn, enableCreatorFee: cpx.enableCreatorFee, swapDisabled: cpx.swapDisabled };

describe("swap panel: account layouts match the SDK's decoders", () => {
  test("LaunchLab pool, config and platform", () => {
    for (const k of ["supply", "totalSellA", "virtualA", "virtualB", "realA", "realB", "totalFundRaisingB"] as const) assert.equal(pool[k], big(sdkPool[k]), k);
    for (const k of ["configId", "platformId", "mintA", "mintB", "vaultA", "vaultB", "creator"] as const) assert.ok(pool[k].equals(sdkPool[k]), k);
    assert.equal(pool.status, sdkPool.status); assert.equal(pool.decimalsA, sdkPool.mintDecimalsA); assert.equal(pool.mintProgramFlag, sdkPool.mintProgramFlag);
    assert.equal(config.tradeFeeRate, big(sdkConfig.tradeFeeRate)); assert.equal(config.curveType, sdkConfig.curveType); assert.equal(config.index, sdkConfig.index);
    assert.equal(platform.feeRate, big(sdkPlatform.feeRate)); assert.equal(platform.creatorFeeRate, big(sdkPlatform.creatorFeeRate));
    assert.ok(launchLabPoolId(LAUNCHLAB_PROGRAM.devnet, pool.mintA).equals(curvePoolId), "the pool is the PDA of its mint");
  });
  test("CPMM AmmConfig and the pool's creator-fee side", () => {
    for (const k of ["tradeFeeRate", "protocolFeeRate", "fundFeeRate", "creatorFeeRate"] as const) assert.equal(amm[k], big(sdkAmm[k]), k);
    assert.equal(cpx.creatorFeeOn, 1, "the rehearsal coin's pool takes the creator fee on token 0 (WSOL), as LaunchLab's OnlyTokenB asks");
    assert.equal(cpx.enableCreatorFee, true);
    assert.equal(cpx.swapDisabled, false);
  });
  test("program ids and genesis hashes are the keeper's", () => {
    assert.ok(LAUNCHLAB_PROGRAM.mainnet.equals(KEEPER_LAUNCHLAB.mainnet) && LAUNCHLAB_PROGRAM.devnet.equals(KEEPER_LAUNCHLAB.devnet));
    assert.ok(CPMM_PROGRAM.mainnet.equals(KEEPER_CPMM.mainnet) && CPMM_PROGRAM.devnet.equals(KEEPER_CPMM.devnet));
    assert.ok(WSOL_MINT.equals(KEEPER_WSOL)); assert.ok(TOKEN_PROGRAM_ID.equals(keeperSolana.TOKEN_PROGRAM_ID));
    assert.deepEqual(GENESIS_HASH, { mainnet: PROGRAM_GENESIS.mainnet, devnet: PROGRAM_GENESIS.devnet });
    assert.ok(cpmmAuthority(CPMM_PROGRAM.devnet).equals(getPdaPoolAuthority(CPMM_PROGRAM.devnet).publicKey));
  });
});

describe("swap panel: quote math equals the SDK on the saved states", () => {
  const solAmounts = [BigInt(1), BigInt(999), BigInt(10_000_000), BigInt(123_456_789), BigInt(1_000_000_000), BigInt(25_000_000_000), BigInt(500_000_000_000)];
  test("curve: SOL in → tokens out (Curve.buyExactIn), including the capped fill", () => {
    for (const a of solAmounts) {
      const sdk = Curve.buyExactIn({ poolInfo: sdkPool, amountB: bn(a), ...sdkFees });
      const q = curveSolIn(pool, curveRates(config, platform), a);
      assert.equal(q.amountOut, big(sdk.amountA.amount), `out at ${a}`);
      assert.equal(q.amountIn, big(sdk.amountB), `in at ${a}`);
      assert.equal(q.fee.creator, big(sdk.splitFee.creatorFee), `burn pool fee at ${a}`);
      assert.equal(q.fee.platform, big(sdk.splitFee.platformFee)); assert.equal(q.fee.protocol, big(sdk.splitFee.protocolFee));
    }
    assert.equal(curveSolIn(pool, curveRates(config, platform), BigInt(500_000_000_000)).capped, true, "500 SOL fills an 85 SOL curve");
  });
  test("curve: tokens in → SOL out (Curve.sellExactIn)", () => {
    for (const a of [BigInt(1), BigInt(1_000_000), BigInt(123_456_789_012), BigInt(50_000_000_000_000)]) {
      const sdk = Curve.sellExactIn({ poolInfo: sdkPool, amountA: bn(a), ...sdkFees });
      const q = curveTokensIn(pool, curveRates(config, platform), a);
      assert.equal(q.amountOut, big(sdk.amountB), `out at ${a}`);
      assert.equal(q.fee.creator, big(sdk.splitFee.creatorFee));
    }
  });
  test("CPMM: swap_base_input both ways, creator fee on either side (CurveCalculator.swapBaseInput)", () => {
    for (const onInput of [true, false]) for (const enabled of [true, false]) for (const a of [BigInt(1_000), BigInt(10_000_000), BigInt(777_777_777)]) for (const [ri, ro] of [[r0, r1], [r1, r0]]) {
      const sdk = CurveCalculator.swapBaseInput(bn(a), bn(ri), bn(ro), sdkAmm.tradeFeeRate, enabled ? sdkAmm.creatorFeeRate : new BN(0), sdkAmm.protocolFeeRate, sdkAmm.fundFeeRate, onInput);
      const q = cpmmSwapIn(a, ri, ro, amm, onInput, enabled);
      assert.equal(q.amountOut, big(sdk.outputAmount)); assert.equal(q.tradeFee, big(sdk.tradeFee)); assert.equal(q.creatorFee, big(sdk.creatorFee));
    }
  });
  test("CPMM creator-fee side follows creator_fee_on and the direction", () => {
    assert.deepEqual([cpmmCreatorFeeOnInput(0, true), cpmmCreatorFeeOnInput(0, false)], [true, true]);
    assert.deepEqual([cpmmCreatorFeeOnInput(1, true), cpmmCreatorFeeOnInput(1, false)], [true, false]);
    assert.deepEqual([cpmmCreatorFeeOnInput(2, true), cpmmCreatorFeeOnInput(2, false)], [false, true]);
    assert.throws(() => cpmmCreatorFeeOnInput(3, true));
    // the rehearsal pool (WSOL is token 0, fee on token 0): SOL in pays it on the way in, tokens in pay it on the SOL out
    assert.equal(quoteSwap(cpmmMarket, "sol-in", BigInt(10_000_000)).feeRaw > BigInt(0), true);
  });
  test("slippage minimum, amount parsing and formatting", () => {
    assert.equal(minOut(BigInt(10_000), 200), BigInt(9_800)); assert.equal(minOut(BigInt(10_001), 100), BigInt(9_900));
    assert.equal(parseAmount("0.01", 9), BigInt(10_000_000)); assert.equal(parseAmount("1", 6), BigInt(1_000_000)); assert.equal(parseAmount(".5", 9), BigInt(500_000_000));
    assert.equal(parseAmount("1.0000001", 6), null); assert.equal(parseAmount("-1", 9), null); assert.equal(parseAmount("1e3", 9), null); assert.equal(parseAmount("", 9), null);
    assert.equal(formatAmount(BigInt(1_234_567_890_123), 6), "1,234,567.890123"); assert.equal(formatAmount(BigInt(10_000_000), 9, 6), "0.01");
  });
});

describe("swap panel: instructions equal the SDK builders the trader and keeper use", () => {
  const owner = Keypair.generate().publicKey, mint = pool.mintA;
  const sameIx = (a: { programId: PublicKey; keys: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[]; data: Buffer }, b: typeof a, what: string) => {
    assert.ok(a.programId.equals(b.programId), `${what}: program`);
    assert.deepEqual(a.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable]), b.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable]), `${what}: accounts`);
    assert.equal(Buffer.from(a.data).toString("hex"), Buffer.from(b.data).toString("hex"), `${what}: data`);
  };
  test("LaunchLab buy_exact_in and sell_exact_in", () => {
    const LL = LAUNCHLAB_PROGRAM.devnet, wsol = associatedTokenAddress(owner, WSOL_MINT), ata = associatedTokenAddress(owner, mint);
    const auth = getPdaLaunchpadAuth(LL).publicKey, pv = getPdaPlatformVault(LL, pool.platformId, WSOL_MINT).publicKey, cv = getPdaCreatorVault(LL, pool.creator, WSOL_MINT).publicKey;
    assert.ok(getPdaLaunchpadPoolId(LL, mint, WSOL_MINT).publicKey.equals(curvePoolId));
    const q = quoteSwap(curveMarket, "sol-in", BigInt(10_000_000));
    const built = buildSwap(curveMarket, { owner, mint, side: "sol-in", amount: BigInt(10_000_000), quotedOut: q.amountOut, slippageBps: 200 });
    const sdkBuy = buyExactInInstruction(LL, owner, auth, pool.configId, pool.platformId, curvePoolId, ata, wsol, pool.vaultA, pool.vaultB, mint, WSOL_MINT, TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, pv, cv, bn(BigInt(10_000_000)), bn(built.minOut), new BN(0));
    sameIx(built.ixs.find((i) => i.programId.equals(LL))!, sdkBuy, "buy");
    const tq = quoteSwap(curveMarket, "tokens-in", BigInt(5_000_000_000));
    const sold = buildSwap(curveMarket, { owner, mint, side: "tokens-in", amount: BigInt(5_000_000_000), quotedOut: tq.amountOut, slippageBps: 500 });
    const sdkSell = sellExactInInstruction(LL, owner, auth, pool.configId, pool.platformId, curvePoolId, ata, wsol, pool.vaultA, pool.vaultB, mint, WSOL_MINT, TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, pv, cv, bn(BigInt(5_000_000_000)), bn(sold.minOut), new BN(0));
    sameIx(sold.ixs.find((i) => i.programId.equals(LL))!, sdkSell, "sell");
  });
  test("CPMM swap_base_input, both directions", () => {
    const C = CPMM_PROGRAM.devnet, m2 = cp.token1Mint, wsol = associatedTokenAddress(owner, WSOL_MINT), ata = associatedTokenAddress(owner, m2);
    for (const side of ["sol-in", "tokens-in"] as const) {
      const amount = side === "sol-in" ? BigInt(10_000_000) : BigInt(1_000_000_000);
      const q = quoteSwap(cpmmMarket, side, amount);
      const b = buildSwap(cpmmMarket, { owner, mint: m2, side, amount, quotedOut: q.amountOut, slippageBps: 100 });
      const solIn = side === "sol-in";
      const sdk = makeSwapCpmmBaseInInstruction(C, owner, getPdaPoolAuthority(C).publicKey, cp.ammConfig, cp.address, solIn ? wsol : ata, solIn ? ata : wsol, solIn ? cp.token0Vault : cp.token1Vault, solIn ? cp.token1Vault : cp.token0Vault, TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, solIn ? WSOL_MINT : m2, solIn ? m2 : WSOL_MINT, cp.observationKey, bn(amount), bn(b.minOut));
      sameIx(b.ixs.find((i) => i.programId.equals(C))!, sdk, side);
    }
  });
  test("the wrapping steps match the keeper's helpers, and the wallet's own accounts are the only ones it owns", () => {
    const mint = pool.mintA, wsol = associatedTokenAddress(owner, WSOL_MINT);
    assert.ok(wsol.equals(keeperSolana.associatedTokenAddress(owner, WSOL_MINT)));
    sameIx(createAtaIdempotentIx(owner, mint), keeperSolana.createAtaIdempotentIx(owner, owner, mint), "create ata");
    sameIx(syncNativeIx(wsol), keeperSolana.syncNativeIx(wsol), "sync");
    sameIx(closeAccountIx(wsol, owner), keeperSolana.closeAccountIx(wsol, owner, owner), "close");
    const q = quoteSwap(curveMarket, "sol-in", BigInt(10_000_000));
    const { ixs } = buildSwap(curveMarket, { owner, mint, side: "sol-in", amount: BigInt(10_000_000), quotedOut: q.amountOut, slippageBps: 200 });
    const signers = new Set(ixs.flatMap((i) => i.keys.filter((k) => k.isSigner).map((k) => k.pubkey.toBase58())));
    assert.deepEqual([...signers], [owner.toBase58()], "the wallet is the only signer");
    const transfer = ixs.find((i) => i.programId.equals(SystemProgram.programId))!;
    assert.ok(transfer.keys[1].pubkey.equals(wsol), "the SOL in goes only to the wallet's own wrapped-SOL account");
    assert.ok(ixs[ixs.length - 1].data[0] === 9, "the last step closes the wrapped-SOL account back to the wallet");
    const { ixs: sell } = buildSwap(curveMarket, { owner, mint, side: "tokens-in", amount: BigInt(1_000_000), quotedOut: BigInt(1_000), slippageBps: 200 });
    assert.equal(sell.some((i) => i.programId.equals(SystemProgram.programId)), false, "a swap to SOL moves no SOL in");
  });
  test("the builder refuses a slippage the panel does not offer, a zero amount and a zero minimum", () => {
    assert.deepEqual([...SLIPPAGE_CHOICES_BPS], [100, 200, 500]); assert.equal(DEFAULT_SLIPPAGE_BPS, 200);
    assert.throws(() => buildSwap(curveMarket, { owner, mint: pool.mintA, side: "sol-in", amount: BigInt(1), quotedOut: BigInt(100), slippageBps: 300 }), /slippage/);
    assert.throws(() => buildSwap(curveMarket, { owner, mint: pool.mintA, side: "sol-in", amount: BigInt(0), quotedOut: BigInt(100), slippageBps: 200 }));
    assert.throws(() => buildSwap(curveMarket, { owner, mint: pool.mintA, side: "sol-in", amount: BigInt(1), quotedOut: BigInt(0), slippageBps: 200 }));
  });
});

describe("swap panel: refusals", () => {
  const live = { mint: pool.mintA.toBase58(), status: "live", cluster: "mainnet", hostCluster: "mainnet", testMints: [] as string[] };
  test("the panel appears only for a live coin on this host's network, never for a test coin", () => {
    assert.equal(coinRefusal(live), null);
    assert.equal(coinRefusal({ ...live, status: "draft" }), REFUSAL.draft);
    assert.equal(coinRefusal({ ...live, status: "expired" }), REFUSAL.notLive);
    assert.equal(coinRefusal({ ...live, cluster: "devnet" }), REFUSAL.otherCluster);
    assert.equal(coinRefusal({ ...live, hostCluster: null }), REFUSAL.otherCluster);
    assert.equal(coinRefusal({ ...live, cluster: "localnet", hostCluster: "localnet" }), REFUSAL.otherCluster);
    assert.equal(coinRefusal({ ...live, cluster: "devnet", hostCluster: "devnet" }), null, "a devnet host (local testing) swaps its own devnet coins, with the devnet note");
    assert.equal(coinRefusal({ ...live, testMints: [live.mint] }), REFUSAL.testCoin);
  });
  test("the operator's wallets are refused, and an unread guard list refuses everyone", () => {
    const op = Keypair.generate().publicKey.toBase58(), visitor = Keypair.generate().publicKey.toBase58();
    assert.equal(walletRefusal(op, [op]), REFUSAL.operatorWallet);
    assert.equal(walletRefusal(visitor, [op]), null);
    assert.equal(walletRefusal(visitor, null), REFUSAL.guardUnavailable);
  });
  test("a migrating curve, a graduated curve, a paused or unopened pool, an unsupported setup", () => {
    const now = 2_000_000_000;
    assert.equal(marketRefusal(curveMarket, pool.mintA, now), null);
    assert.equal(marketRefusal({ ...curveMarket, pool: { ...pool, status: 1 } }, pool.mintA, now), REFUSAL.migrating);
    assert.equal(marketRefusal({ ...curveMarket, pool: { ...pool, status: 2 } }, pool.mintA, now), REFUSAL.graduatedNoPool);
    assert.equal(marketRefusal({ ...curveMarket, pool: { ...pool, mintProgramFlag: 1 } }, pool.mintA, now), REFUSAL.unsupported);
    assert.equal(marketRefusal({ ...curveMarket, config: { ...config, curveType: 1 } }, pool.mintA, now), REFUSAL.unsupported);
    assert.equal(marketRefusal(curveMarket, cp.token1Mint, now), REFUSAL.unsupported, "a pool for another mint");
    assert.equal(marketRefusal(cpmmMarket, cp.token1Mint, now), null);
    assert.equal(marketRefusal({ ...cpmmMarket, swapDisabled: true }, cp.token1Mint, now), REFUSAL.poolPaused);
    assert.equal(marketRefusal(cpmmMarket, cp.token1Mint, 1), REFUSAL.poolNotOpen);
    assert.equal(marketRefusal({ ...cpmmMarket, solIsToken0: false }, cp.token1Mint, now), REFUSAL.unsupported);
  });
  test("a short balance, in SOL or in tokens, with the rent and fee reserve named", () => {
    const fmt = { sol: (x: bigint) => formatAmount(x, 9, 6), tokens: (x: bigint) => formatAmount(x, 6), ticker: "TEST" };
    const amount = BigInt(10_000_000);
    assert.equal(balanceRefusal("sol-in", amount, { lamports: amount + solReserve(false), tokens: BigInt(0), tokenAccountExists: false }, fmt), null);
    assert.match(balanceRefusal("sol-in", amount, { lamports: amount, tokens: BigInt(0), tokenAccountExists: false }, fmt)!, /^This wallet holds 0\.01 SOL\. The swap needs 0\.014098 SOL/);
    assert.equal(balanceRefusal("tokens-in", BigInt(5), { lamports: BigInt(1e9), tokens: BigInt(5), tokenAccountExists: true }, fmt), null);
    assert.equal(balanceRefusal("tokens-in", BigInt(6), { lamports: BigInt(1e9), tokens: BigInt(5), tokenAccountExists: true }, fmt), REFUSAL.shortTokens("0.000005", "0.000006", "TEST"));
    assert.match(balanceRefusal("tokens-in", BigInt(5), { lamports: BigInt(1000), tokens: BigInt(5), tokenAccountExists: true }, fmt)!, /network fees/);
  });
  test("a pool that moved past the slippage setting is refused before signing", () => {
    const q = quoteSwap(curveMarket, "sol-in", BigInt(1_000_000_000)), min = minOut(q.amountOut, 200);
    assert.equal(requoteRefusal(q, min, String, 200), null);
    const moved = quoteSwap({ ...curveMarket, pool: { ...pool, realB: pool.realB + BigInt(20_000_000_000), realA: pool.realA + BigInt(150_000_000_000_000) } }, "sol-in", BigInt(1_000_000_000));
    assert.ok(moved.amountOut < min);
    assert.match(requoteRefusal(moved, min, String, 200)!, /^The pool moved since the quote\./);
  });
  test("a failed simulation is refused with the program's reason; a wallet that declines sends nothing", async () => {
    assert.equal(simulationReason({ InstructionError: [4, { Custom: 6005 }] }, ["Program log: AnchorError ... Error Code: ExceededSlippage"]), "The pool would give less than your minimum out.");
    let sent = 0;
    const conn = { getLatestBlockhash: async () => ({ blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 10 }), simulateTransaction: async () => ({ value: { err: { InstructionError: [4, { Custom: 1 }] }, logs: ["Program log: Error: something"] } }), sendRawTransaction: async () => { sent++; return "x"; }, getSignatureStatuses: async () => ({ value: [null] }), getBlockHeight: async () => 0 };
    const owner = Keypair.generate().publicKey;
    await assert.rejects(simulateSignSend(conn, owner, [syncNativeIx(owner)], async (t) => t), /test run of this swap failed/);
    const ok = { ...conn, simulateTransaction: async () => ({ value: { err: null, logs: [] } }) };
    await assert.rejects(simulateSignSend(ok, owner, [syncNativeIx(owner)], async () => { throw new Error("User rejected"); }), new RegExp(REFUSAL.rejected));
    assert.equal(sent, 0);
    const confirmed = await simulateSignSend({ ...ok, getSignatureStatuses: async () => ({ value: [{ err: null, confirmationStatus: "confirmed" }] }) }, owner, [syncNativeIx(owner)], async (t) => t, () => {}, 1);
    assert.deepEqual(confirmed, { signature: "x", status: "confirmed" });
  });
  test("the chain reader refuses an account the Raydium program does not own", async () => {
    const reader = { getMultipleAccountsInfo: async () => [{ owner: SystemProgram.programId, data: bytes(FX.curvePool), executable: false, lamports: 1, rentEpoch: 0 }], getBalance: async () => 0 };
    await assert.rejects(readMarket(reader, "devnet", pool.mintA, null), new RegExp(REFUSAL.noPool));
    const good = { getMultipleAccountsInfo: async (keys: PublicKey[]) => keys.map((k) => { const f = Object.values(FX).find((a) => typeof a === "object" && a.address === k.toBase58()); return f ? { owner: new PublicKey(f.owner), data: bytes(f), executable: false, lamports: 1, rentEpoch: 0 } : null; }), getBalance: async () => 5 };
    const m = await readMarket(good, "devnet", pool.mintA, null);
    assert.equal(m.kind, "curve");
    const c = await readMarket(good, "devnet", cp.token1Mint, cpmmAddr);
    assert.ok(c.kind === "cpmm" && c.reserveSol === r0 && c.reserveToken === r1);
    assert.deepEqual(await readBalances(good, Keypair.generate().publicKey, pool.mintA), { lamports: BigInt(5), tokens: BigInt(0), tokenAccountExists: false });
  });
  test("the RPC proxy forwards every method the panel uses", () => {
    for (const m of ["getMultipleAccounts", "getBalance", "getLatestBlockhash", "simulateTransaction", "sendTransaction", "getSignatureStatuses", "getBlockHeight", "getGenesisHash"]) assert.ok(RPC_PROXY_METHODS.has(m), m);
  });
});

describe("swap panel: copy", () => {
  const filled: string[] = [
    ...Object.values(SWAP_COPY), SWAP_NOTICE,
    ...Object.values(REFUSAL).map((v) => (typeof v === "function" ? (v as (...a: string[]) => string)("1.5", "2.25", "TEST") : v)),
    REFUSAL.amountFormat(9), feeLine({ totalBps: 100, burnPoolBps: 50, feeText: "0.01", burnPoolText: "0.005", unit: "SOL" }), curveSplitLine(25, 25), capLine("1.2"), balanceLine("1,000", "TEST"), holdsLine("1.5", "1,000", "TEST"),
  ];
  test("every label and sentence passes the copy lint", () => {
    for (const s of filled) { const r = lintCopy(s); assert.ok(r.ok, `${s}\n${r.hits.map((h) => h.phrase).join(", ")}`); }
  });
  test("the notice is the site's standing not-advice sentence, then the pool sentence; the fee line names the burn pool", () => {
    assert.equal(NOT_ADVICE_SENTENCE, "Nothing on this site is investment advice.");
    assert.ok(FOOTER_COPY.notAdvice.endsWith(NOT_ADVICE_SENTENCE));
    assert.equal(SWAP_NOTICE, "Nothing on this site is investment advice. This swap goes straight to the coin's own Raydium curve or pool; the site holds nothing.");
    assert.equal(feeLine({ totalBps: 100, burnPoolBps: 50, feeText: "0.01", burnPoolText: "0.005", unit: "SOL" }), "1% of the swap (0.01 SOL). Of that, 0.5% (0.005 SOL) goes to this coin's burn pool, which pays for its burns.");
  });
  test("the panel is its own component, mounted once on the coin page, with no key handling", () => {
    const page = fs.readFileSync("src/app/burnticker/t/[ticker]/page.tsx", "utf8"), panel = fs.readFileSync("src/app/burnticker/t/[ticker]/TradePanel.tsx", "utf8");
    assert.equal(page.match(/<TradePanel /g)?.length, 1);
    assert.ok(panel.includes("signTransaction") && !/secretKey|Keypair|localStorage|sessionStorage/.test(panel), "the wallet signs; the panel never touches a key or stores anything");
    for (const f of fs.readdirSync("src/lib/burnticker/swap")) {
      const src = fs.readFileSync(`src/lib/burnticker/swap/${f}`, "utf8");
      assert.ok(!/raydium-sdk/.test(src.replace(/^\s*(\*|\/\/).*$/gm, "")), `${f} does not load the SDK (the browser bundle)`);
      assert.ok(!/secretKey|Keypair\.|fromSecretKey/.test(src), `${f} holds no key`);
    }
  });
});

