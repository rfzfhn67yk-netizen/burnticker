// THE DEVNET TRADER (2026-10-10, devnet rehearsal) — the browser-wallet stand-in from REHEARSAL-RUNSHEET §A (A17 buys to graduate,
// A21 small CPMM trades so the TWAP window fills). DEVNET ONLY: it reads the RPC's genesis hash and refuses anything that is not devnet.
// Dry run by default (simulates, signs nothing); --send signs with --payer. THIS FILE PRINTS NO KEY.
//
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/alias-hook.mjs scripts/burnticker-devnet-trader.mts <command> [flags]
//
//   status     --mint <pubkey> [--pool <cpmm pool>]                 curve state (status, realB / raise) and the CPMM reserves
//   curve-buy  --mint <pubkey> --sol <amount>                       LaunchLab buy_exact_in on the token's curve
//   curve-sell --mint <pubkey> --pct <1..100>                       LaunchLab sell_exact_in of that share of the payer's tokens
//   cpmm-swap  --mint <pubkey> --pool <pubkey> --dir buy --sol <amount> | --dir sell (--pct <1..100> | --tokens <ui amount>)   CPMM swap_base_input
//   common:    --payer <keypath>  [--slippage-bps 500]  [--rpc <devnet url>]  [--send]
//
// Instructions come from the pinned SDK's own low-level builders (@raydium-io/raydium-sdk-v2 0.2.74-alpha), as in launch.ts.

import { ComputeBudgetProgram, Connection, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction, type TransactionInstruction } from "@solana/web3.js";
import BN from "bn.js";
import { buyExactInInstruction, sellExactInInstruction, makeSwapCpmmBaseInInstruction, getPdaLaunchpadAuth, getPdaLaunchpadPoolId, getPdaCreatorVault, getPdaPlatformVault, getPdaPoolAuthority, LaunchpadPool, LaunchpadConfig, PlatformConfig, Curve } from "@raydium-io/raydium-sdk-v2";
import { associatedTokenAddress, base58Encode, closeAccountIx, clusterOfGenesis, createAtaIdempotentIx, explorerUrl, syncNativeIx, TOKEN_PROGRAM_ID } from "../src/lib/burnKeeper/solana.ts";
import { LAUNCHLAB_PROGRAM, WSOL_MINT, CPMM_PROGRAM_ID } from "../src/lib/burnKeeper/launchlab.ts";
import { fetchCpmmPool } from "../src/lib/burnReceipts/cpmm.ts";

const args = process.argv.slice(2);
const CMD = args[0];
const opt = (n: string): string | undefined => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : undefined; };
const die = (s: string): never => { console.error(`refusing: ${s}`); process.exit(2); };
const SEND = args.includes("--send");
const rpc = opt("rpc") ?? "https://api.devnet.solana.com";
const connection = new Connection(rpc, "confirmed");
if (clusterOfGenesis(await connection.getGenesisHash()) !== "devnet") die(`${new URL(rpc).host} is not devnet — this tool is devnet-only`);
if (!["status", "curve-buy", "curve-sell", "cpmm-swap"].includes(CMD ?? "")) die("command: status | curve-buy | curve-sell | cpmm-swap");
const mint = new PublicKey(opt("mint") ?? die("--mint is required"));
const slippageBps = BigInt(opt("slippage-bps") ?? 500);
const LL = LAUNCHLAB_PROGRAM.devnet, CPMM = CPMM_PROGRAM_ID.devnet;
const lamports = (s: string) => BigInt(Math.round(Number(s) * 1e9));
const j = (x: unknown) => JSON.stringify(x, (_k, v) => typeof v === "bigint" ? v.toString() : v instanceof PublicKey ? v.toBase58() : BN.isBN(v) ? v.toString() : v, 2);

async function curveState() {
  const poolId = getPdaLaunchpadPoolId(LL, mint, WSOL_MINT).publicKey;
  const acc = await connection.getAccountInfo(poolId, "confirmed");
  if (!acc) die(`no LaunchLab pool for ${mint.toBase58()}`);
  const pool = LaunchpadPool.decode(acc!.data);
  const config = LaunchpadConfig.decode((await connection.getAccountInfo(pool.configId, "confirmed"))!.data);
  const platform = PlatformConfig.decode((await connection.getAccountInfo(pool.platformId, "confirmed"))!.data);
  return { poolId, pool, config, platform };
}
async function tokenBalance(owner: PublicKey, m: PublicKey): Promise<bigint> {
  return BigInt((await connection.getTokenAccountBalance(associatedTokenAddress(owner, m), "confirmed").catch(() => null))?.value.amount ?? "0");
}
async function payerKey() {
  const p = opt("payer") ?? die("--payer <keypath> is required");
  const { loadKeypair } = await import("@/lib/burnKeeper/keyfile");
  return loadKeypair({ keyPath: p });
}
async function run(payer: Awaited<ReturnType<typeof payerKey>>, ixs: TransactionInstruction[], summary: Record<string, unknown>) {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const msg = new TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: blockhash, instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 20_000 }), ...ixs] }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  const sim = await connection.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" });
  const out: Record<string, unknown> = { command: CMD, dryRun: !SEND, payer: payer.publicKey, ...summary, simulation: { err: sim.value.err, unitsConsumed: sim.value.unitsConsumed, tail: (sim.value.logs ?? []).slice(-4) } };
  if (SEND && !sim.value.err) {
    tx.sign([payer]);
    const sig = base58Encode(tx.signatures[0]);
    await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 5 });
    const res = await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
    out.sent = { signature: sig, err: res.value.err, explorer: explorerUrl("devnet", sig) };
  }
  console.log(j(out));
  if (sim.value.err || (out.sent as { err?: unknown } | undefined)?.err) process.exit(1);
}

if (CMD === "status") {
  const { poolId, pool } = await curveState();
  const out: Record<string, unknown> = { mint, launchlabPool: poolId, status: pool.status, realB: pool.realB.toString(), totalFundRaisingB: pool.totalFundRaisingB.toString(), realA: pool.realA.toString(), totalSellA: pool.totalSellA.toString(), creator: pool.creator, platformId: pool.platformId };
  if (opt("pool")) {
    const p = await fetchCpmmPool(connection, new PublicKey(opt("pool")!), CPMM);
    const [v0, v1] = await Promise.all([p.token0Vault, p.token1Vault].map((v) => connection.getTokenAccountBalance(v, "confirmed").then((r) => BigInt(r.value.amount))));
    out.cpmm = { pool: p.address, token0: p.token0Mint, token1: p.token1Mint, vault0: v0, vault1: v1, fees0: p.fees0, fees1: p.fees1, status: p.status, openTime: p.openTime };
  }
  console.log(j(out));
} else if (CMD === "curve-buy" || CMD === "curve-sell") {
  const payer = await payerKey();
  const { poolId, pool, config, platform } = await curveState();
  if (pool.status !== 0) die(`the curve is not trading (status ${pool.status}: 1 = migrating, 2 = migrated)`);
  const auth = getPdaLaunchpadAuth(LL).publicKey;
  const platformVault = getPdaPlatformVault(LL, pool.platformId, WSOL_MINT).publicKey;
  const creatorVault = getPdaCreatorVault(LL, pool.creator, WSOL_MINT).publicKey;
  const wsol = associatedTokenAddress(payer.publicKey, WSOL_MINT), ata = associatedTokenAddress(payer.publicKey, mint);
  const poolInfo = { virtualA: pool.virtualA, virtualB: pool.virtualB, realA: pool.realA, realB: pool.realB, totalSellA: pool.totalSellA, totalFundRaisingB: pool.totalFundRaisingB };
  const fees = { protocolFeeRate: config.tradeFeeRate, platformFeeRate: platform.feeRate, creatorFeeRate: platform.creatorFeeRate, curveType: config.curveType, shareFeeRate: new BN(0), transferFeeConfigA: undefined, transferFeeConfigB: undefined, slot: 0 };
  const ixs: TransactionInstruction[] = [createAtaIdempotentIx(payer.publicKey, payer.publicKey, WSOL_MINT), createAtaIdempotentIx(payer.publicKey, payer.publicKey, mint)];
  let summary: Record<string, unknown>;
  if (CMD === "curve-buy") {
    const amountB = lamports(opt("sol") ?? die("--sol is required"));
    const q = Curve.buyExactIn({ poolInfo, amountB: new BN(amountB.toString()), ...fees } as Parameters<typeof Curve.buyExactIn>[0]);
    const minA = (BigInt(q.amountA.amount.toString()) * (BigInt(10000) - slippageBps)) / BigInt(10000);
    ixs.push(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: wsol, lamports: Number(amountB) }), syncNativeIx(wsol));
    ixs.push(buyExactInInstruction(LL, payer.publicKey, auth, pool.configId, pool.platformId, poolId, ata, wsol, pool.vaultA, pool.vaultB, mint, WSOL_MINT, TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, platformVault, creatorVault, new BN(amountB.toString()), new BN(minA.toString()), new BN(0)));
    summary = { launchlabPool: poolId, amountBLamports: amountB, quotedTokensRaw: q.amountA.amount.toString(), minTokensRaw: minA, quotedAmountBUsed: q.amountB.toString(), realBBefore: pool.realB.toString(), raise: pool.totalFundRaisingB.toString() };
  } else {
    const pct = BigInt(opt("pct") ?? die("--pct is required"));
    const amountA = (await tokenBalance(payer.publicKey, mint)) * pct / BigInt(100);
    if (amountA === BigInt(0)) die("the payer holds no tokens");
    const q = Curve.sellExactIn({ poolInfo, amountA: new BN(amountA.toString()), ...fees } as Parameters<typeof Curve.sellExactIn>[0]);
    const minB = (BigInt(q.amountB.toString()) * (BigInt(10000) - slippageBps)) / BigInt(10000);
    ixs.push(sellExactInInstruction(LL, payer.publicKey, auth, pool.configId, pool.platformId, poolId, ata, wsol, pool.vaultA, pool.vaultB, mint, WSOL_MINT, TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, platformVault, creatorVault, new BN(amountA.toString()), new BN(minB.toString()), new BN(0)));
    summary = { launchlabPool: poolId, amountATokensRaw: amountA, quotedLamports: q.amountB.toString(), minLamports: minB };
  }
  ixs.push(closeAccountIx(wsol, payer.publicKey, payer.publicKey));
  await run(payer, ixs, summary);
} else {
  const payer = await payerKey();
  const p = await fetchCpmmPool(connection, new PublicKey(opt("pool") ?? die("--pool is required")), CPMM);
  const mintIs0 = p.token0Mint.equals(mint);
  if (!mintIs0 && !p.token1Mint.equals(mint)) die("the pool does not hold this mint");
  const dir = opt("dir");
  if (dir !== "buy" && dir !== "sell") die("--dir buy|sell");
  const wsol = associatedTokenAddress(payer.publicKey, WSOL_MINT), ata = associatedTokenAddress(payer.publicKey, mint);
  const solVault = mintIs0 ? p.token1Vault : p.token0Vault, tokVault = mintIs0 ? p.token0Vault : p.token1Vault;
  const [solRes, tokRes] = await Promise.all([solVault, tokVault].map((v) => connection.getTokenAccountBalance(v, "confirmed").then((r) => BigInt(r.value.amount))));
  const fSol = mintIs0 ? p.fees1 : p.fees0, fTok = mintIs0 ? p.fees0 : p.fees1;
  const rIn = dir === "buy" ? solRes - fSol : tokRes - fTok, rOut = dir === "buy" ? tokRes - fTok : solRes - fSol;
  const amountIn = dir === "buy" ? lamports(opt("sol") ?? die("--sol is required"))
    : opt("tokens") ? BigInt(Math.round(Number(opt("tokens")) * 1e6))   // $DEFICIT has 6 decimals
    : (await tokenBalance(payer.publicKey, mint)) * BigInt(opt("pct") ?? die("--pct or --tokens is required")) / BigInt(100);
  if (amountIn === BigInt(0)) die("nothing to swap");
  const inNet = (amountIn * BigInt(9900)) / BigInt(10000);   // ≥ the 25 bps trade fee + 25 bps creator fee, with margin
  const quoted = (rOut * inNet) / (rIn + inNet);
  const minOut = (quoted * (BigInt(10000) - slippageBps)) / BigInt(10000);
  const ixs: TransactionInstruction[] = [createAtaIdempotentIx(payer.publicKey, payer.publicKey, WSOL_MINT), createAtaIdempotentIx(payer.publicKey, payer.publicKey, mint)];
  if (dir === "buy") ixs.push(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: wsol, lamports: Number(amountIn) }), syncNativeIx(wsol));
  const [inAcc, outAcc, inVault, outVault, inMint, outMint] = dir === "buy" ? [wsol, ata, solVault, tokVault, WSOL_MINT, mint] : [ata, wsol, tokVault, solVault, mint, WSOL_MINT];
  ixs.push(makeSwapCpmmBaseInInstruction(CPMM, payer.publicKey, getPdaPoolAuthority(CPMM).publicKey, p.ammConfig, p.address, inAcc, outAcc, inVault, outVault, TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, inMint, outMint, p.observationKey, new BN(amountIn.toString()), new BN(minOut.toString())));
  ixs.push(closeAccountIx(wsol, payer.publicKey, payer.publicKey));
  await run(payer, ixs, { pool: p.address, dir, amountIn, quotedOut: quoted, minOut, reserveSolBefore: solRes, reserveTokBefore: tokRes });
}
