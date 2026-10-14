import { PublicKey, type TransactionInstruction } from "@solana/web3.js";
import type { CpmmPool } from "@/lib/burnReceipts/cpmm";
import { CURVE_TRADING, type CpmmConfig, type CurveConfig, type CurvePlatform, type CurvePool } from "@/lib/burnticker/swap/layouts";
import { cpmmCreatorFeeOnInput, cpmmSwapIn, curveRates, curveSolIn, curveTokensIn, minOut, PPM } from "@/lib/burnticker/swap/math";
import { associatedTokenAddress, cpmmSwapBaseInputIx, curveBuyExactInIx, curveSellExactInIx, TOKEN_PROGRAM_ID, WSOL_MINT, wrapSwap } from "@/lib/burnticker/swap/instructions";
import { REFUSAL, SLIPPAGE_CHOICES_BPS } from "@/lib/burnticker/swap/copy";

/**
 * THE SWAP PLAN (swap-1, 2026-10-14): the panel's decisions as pure functions, so the page, the devnet proof
 * (scripts/burnticker-swap-proof.mts) and the tests run the same code.
 *   coinRefusal     whether the panel appears at all (live, this host's network, not a test coin)
 *   walletRefusal   the operator's own wallets never swap (the trust page's rule)
 *   marketRefusal   a curve that is migrating, a pool that is paused or not open, a setup the panel does not handle
 *   quoteSwap       the quote from the pool's state read just now
 *   balanceRefusal  the wallet holds enough SOL (and tokens) for the swap, the rent and the fees
 *   buildSwap       the instructions, with the minimum out from the quote and the slippage setting
 *   requoteRefusal  right before signing: a fresh read whose quote is below the minimum is refused, nothing is sent
 * A refusal is a plain sentence (copy.ts); null means go on.
 */

export type Side = "sol-in" | "tokens-in";
export type Network = "mainnet" | "devnet";

export interface CurveMarket {
  kind: "curve"; program: PublicKey; poolId: PublicKey; pool: CurvePool; config: CurveConfig; platform: CurvePlatform;
}
export interface CpmmMarket {
  kind: "cpmm"; program: PublicKey; pool: CpmmPool; config: CpmmConfig; solIsToken0: boolean; reserveSol: bigint; reserveToken: bigint;
  creatorFeeOn: number; enableCreatorFee: boolean; swapDisabled: boolean;
}
export type Market = CurveMarket | CpmmMarket;

export interface CoinFacts { mint: string; status: string; cluster: string; hostCluster: string | null; testMints: readonly string[] }

/** The panel shows only for a live coin on this host's own network (mainnet; devnet only on a devnet host), never for a test coin. */
export function coinRefusal(c: CoinFacts): string | null {
  if (c.status === "draft") return REFUSAL.draft;
  if (c.status !== "live") return REFUSAL.notLive;
  if (!c.hostCluster || c.cluster !== c.hostCluster) return REFUSAL.otherCluster;
  if (c.cluster !== "mainnet" && c.cluster !== "devnet") return REFUSAL.otherCluster;
  if (c.cluster === "devnet" && c.hostCluster !== "devnet") return REFUSAL.devnetCoin;
  if (c.testMints.includes(c.mint)) return REFUSAL.testCoin;
  return null;
}

/** The operator's wallets (the trust page's team wallets and the transparency record) never use the panel. */
export function walletRefusal(wallet: string, operatorWallets: readonly string[] | null): string | null {
  if (operatorWallets === null) return REFUSAL.guardUnavailable;
  return operatorWallets.includes(wallet) ? REFUSAL.operatorWallet : null;
}

export function marketRefusal(m: Market, mint: PublicKey, nowSec: number): string | null {
  if (m.kind === "curve") {
    if (!m.pool.mintA.equals(mint) || !m.pool.mintB.equals(WSOL_MINT) || m.pool.mintProgramFlag !== 0 || m.config.curveType !== 0) return REFUSAL.unsupported;
    if (m.pool.status === 1) return REFUSAL.migrating;
    if (m.pool.status !== CURVE_TRADING) return REFUSAL.graduatedNoPool;
    return null;
  }
  const p = m.pool;
  const pair = m.solIsToken0 ? p.token0Mint.equals(WSOL_MINT) && p.token1Mint.equals(mint) : p.token1Mint.equals(WSOL_MINT) && p.token0Mint.equals(mint);
  if (!pair || !p.token0Program.equals(TOKEN_PROGRAM_ID) || !p.token1Program.equals(TOKEN_PROGRAM_ID)) return REFUSAL.unsupported;
  if (m.swapDisabled) return REFUSAL.poolPaused;
  if (p.openTime > BigInt(nowSec)) return REFUSAL.poolNotOpen;
  if (m.reserveSol <= BigInt(0) || m.reserveToken <= BigInt(0)) return REFUSAL.noPool;
  return null;
}

export interface Quote {
  side: Side;
  /** what actually goes in (a curve swap from SOL that fills the curve uses less than offered) */
  amountIn: bigint;
  amountOut: bigint;
  /** the whole fee and the burn pool's part of it, in the unit it is charged in */
  feeRaw: bigint;
  burnPoolRaw: bigint;
  /** "SOL" or "tokens": the curve charges in SOL; the CPMM trade fee is in the input token */
  feeUnit: "SOL" | "tokens";
  capped: boolean;
}

/**
 * The quote. On the curve the burn pool's part is LaunchLab's creator fee (the creator is the coin's burn pool). In the CPMM pool the
 * burn pool's share of each swap (its creator fee, less Raydium's share, plus 80% of the locked LP's fees, claimed later) is given in
 * basis points by the page's fee table; `poolBurnBps` passes it so the quote can show it in the input unit.
 */
export function quoteSwap(m: Market, side: Side, amount: bigint, poolBurnBps = 0): Quote {
  if (m.kind === "curve") {
    const r = curveRates(m.config, m.platform);
    const q = side === "sol-in" ? curveSolIn(m.pool, r, amount) : curveTokensIn(m.pool, r, amount);
    return { side, amountIn: q.amountIn, amountOut: q.amountOut, feeRaw: q.fee.total, burnPoolRaw: q.fee.creator, feeUnit: "SOL", capped: q.capped };
  }
  const solIn = side === "sol-in";
  const inputIsToken0 = solIn === m.solIsToken0;
  const q = cpmmSwapIn(amount, solIn ? m.reserveSol : m.reserveToken, solIn ? m.reserveToken : m.reserveSol, m.config, cpmmCreatorFeeOnInput(m.creatorFeeOn, inputIsToken0), m.enableCreatorFee);
  const fee = q.tradeFee + (q.creatorFeeOnInput ? q.creatorFee : BigInt(0));
  return { side, amountIn: amount, amountOut: q.amountOut, feeRaw: fee, burnPoolRaw: (amount * BigInt(Math.round(poolBurnBps * 100))) / PPM, feeUnit: solIn ? "SOL" : "tokens", capped: false };
}

/** The fee rates in basis points for the fee line: the curve's from its two config accounts, the CPMM's from its AmmConfig. */
export function feeBps(m: Market): { totalBps: number; burnPoolBps: number | null; raydiumBps: number; platformBps: number } {
  if (m.kind === "curve") {
    const raydium = Number(m.config.tradeFeeRate) / 100, platform = Number(m.platform.feeRate) / 100, burn = Number(m.platform.creatorFeeRate) / 100;
    return { totalBps: raydium + platform + burn, burnPoolBps: burn, raydiumBps: raydium, platformBps: platform };
  }
  const t = Number(m.config.tradeFeeRate) / 100, c = m.enableCreatorFee ? Number(m.config.creatorFeeRate) / 100 : 0;
  return { totalBps: t + c, burnPoolBps: null, raydiumBps: t, platformBps: 0 };
}

/** Lamports kept back beside the SOL in: the wrapped-SOL account's rent (returned in the same transaction), a new token account's rent, fees. */
export const RENT_TOKEN_ACCOUNT = BigInt(2_039_280);
export const NETWORK_FEE_ALLOWANCE = BigInt(20_000);
export function solReserve(tokenAccountExists: boolean): bigint {
  return RENT_TOKEN_ACCOUNT + (tokenAccountExists ? BigInt(0) : RENT_TOKEN_ACCOUNT) + NETWORK_FEE_ALLOWANCE;
}

export interface Balances { lamports: bigint; tokens: bigint; tokenAccountExists: boolean }
export function balanceRefusal(side: Side, amountIn: bigint, b: Balances, fmt: { sol: (x: bigint) => string; tokens: (x: bigint) => string; ticker: string }): string | null {
  const reserve = solReserve(b.tokenAccountExists);
  if (side === "sol-in") return b.lamports < amountIn + reserve ? REFUSAL.shortSol(fmt.sol(b.lamports), fmt.sol(amountIn + reserve), fmt.sol(reserve)) : null;
  if (b.tokens < amountIn) return REFUSAL.shortTokens(fmt.tokens(b.tokens), fmt.tokens(amountIn), fmt.ticker);
  return b.lamports < reserve ? REFUSAL.shortSol(fmt.sol(b.lamports), fmt.sol(reserve), fmt.sol(reserve)) : null;
}

export const validSlippage = (bps: number): boolean => (SLIPPAGE_CHOICES_BPS as readonly number[]).includes(bps);

/** The instructions: the wallet's own accounts around one swap whose minimum out is the quote less the slippage setting. */
export function buildSwap(m: Market, i: { owner: PublicKey; mint: PublicKey; side: Side; amount: bigint; quotedOut: bigint; slippageBps: number }): { ixs: TransactionInstruction[]; minOut: bigint } {
  if (!validSlippage(i.slippageBps)) throw new Error(`slippage ${i.slippageBps} bps is not one of the panel's settings`);
  if (i.amount <= BigInt(0)) throw new Error(REFUSAL.amount);
  const min = minOut(i.quotedOut, i.slippageBps);
  if (min <= BigInt(0)) throw new Error(REFUSAL.noOutput);
  const wsol = associatedTokenAddress(i.owner, WSOL_MINT), ata = associatedTokenAddress(i.owner, i.mint);
  if (m.kind === "curve") {
    const a = { program: m.program, owner: i.owner, configId: m.pool.configId, platformId: m.pool.platformId, poolId: m.poolId, userTokenAccount: ata, userWsolAccount: wsol, vaultA: m.pool.vaultA, vaultB: m.pool.vaultB, mintA: i.mint, creator: m.pool.creator };
    const swap = i.side === "sol-in" ? curveBuyExactInIx(a, i.amount, min) : curveSellExactInIx(a, i.amount, min);
    return { ixs: wrapSwap(i.owner, i.mint, swap, i.side === "sol-in" ? i.amount : null), minOut: min };
  }
  const p = m.pool, solVault = m.solIsToken0 ? p.token0Vault : p.token1Vault, tokVault = m.solIsToken0 ? p.token1Vault : p.token0Vault;
  const solIn = i.side === "sol-in";
  const swap = cpmmSwapBaseInputIx({ program: m.program, owner: i.owner, ammConfig: p.ammConfig, poolId: p.address, userInput: solIn ? wsol : ata, userOutput: solIn ? ata : wsol, inputVault: solIn ? solVault : tokVault, outputVault: solIn ? tokVault : solVault, inputMint: solIn ? WSOL_MINT : i.mint, outputMint: solIn ? i.mint : WSOL_MINT, observation: p.observationKey }, i.amount, min);
  return { ixs: wrapSwap(i.owner, i.mint, swap, solIn ? i.amount : null), minOut: min };
}

/** Right before signing: the pool read again; if its quote for the same amount is now below the minimum, the swap is refused. */
export function requoteRefusal(fresh: Quote, min: bigint, fmt: (x: bigint) => string, slippageBps: number): string | null {
  return fresh.amountOut < min ? REFUSAL.slippage(fmt(fresh.amountOut), fmt(min), `${slippageBps / 100}%`) : null;
}
