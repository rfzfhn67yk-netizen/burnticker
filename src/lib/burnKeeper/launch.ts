import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import BN from "bn.js";
import {
  buyExactInInstruction, createPlatformConfig as sdkCreatePlatformConfig, createVestingAccount as sdkCreateVestingAccount, initializeV2 as sdkInitializeV2,
  getPdaCpiEvent, getPdaCreatorVault, getPdaLaunchpadAuth, getPdaLaunchpadPoolId, getPdaLaunchpadVaultId, getPdaMetadataKey, getPdaPlatformCurveRule, getPdaPlatformId, getPdaPlatformVault, getPdaVestId,
  getCpmmPdaPoolId, Curve, CpmmCreatorFeeOn, LaunchpadConfig, PlatformConfig, CpmmConfigInfoLayout, LAUNCHPAD_PROGRAM, DEVNET_PROGRAM_ID, CREATE_CPMM_POOL_PROGRAM,
} from "@raydium-io/raydium-sdk-v2";
import { ASSOCIATED_TOKEN_PROGRAM_ID, associatedTokenAddress, closeAccountIx, createAtaIdempotentIx, MEMO_PROGRAM_ID, syncNativeIx, TOKEN_PROGRAM_ID, type Cluster } from "@/lib/burnKeeper/solana";
import { WSOL_MINT } from "@/lib/burnKeeper/launchlab";

/**
 * THE LAUNCH BUILDER (2026-10-09, item 2 of the launch plan): everything scripts/burnkeeper-launch.mts needs to create $DEFICIT on Raydium
 * LaunchLab, as pure functions over decoded on-chain accounts — so the dry run, the tests and the real send all build the SAME bytes.
 * The instructions come from the SDK's own low-level builders (@raydium-io/raydium-sdk-v2 0.2.74-alpha, pinned; src/raydium/launchpad/
 * instrument.ts), never from the high-level `raydium.launchpad.createLaunchpad`, which reads defaults from Raydium's API and derives
 * the creator from the wallet it was loaded with. Here every parameter is explicit and the creator is a plain pubkey.
 *
 * THE OWNER'S DECISIONS (10-09): decimals 6 (the program's BASE_MINT_DECIMALS), supply 1,000,000,000, migrateType 'cpmm' (the program
 * rejects 'amm' for new launches), CREATOR = THE BURN PROGRAM'S FEE PDA FOR THE MINT (burnPool.ts; the blind review's H-2 — earlier that
 * day it was the keeper's address) so creator fees belong to the burn pool and the program's register_pool accepts the graduated pool.
 * The creator is recorded, not a signer (docs: initialize_v2 account 2 "Recorded as pool_state.creator; not a signer"; SDK instrument.ts
 * initializeV2 keys: creator isSigner false) — which is what makes a PDA creator possible at all; a funded wallet pays.
 *
 * FEES (docs/burnkeeper/fees.md has the full table with sources). On the curve three independent rates, each out of 1,000,000 of the
 * trade: GlobalConfig.tradeFeeRate → Raydium; PlatformConfig.feeRate (≤ 50,000) → the platform's claim wallet; PlatformConfig.
 * creatorFeeRate (≤ 5,000) → the creator's vault = the burn pool. After graduation the CPMM pool charges AmmConfig.tradeFeeRate (split
 * LP / protocol / fund) plus AmmConfig.creatorFeeRate to pool_creator (= the launch creator while PlatformConfig.platformCpCreator is the
 * default pubkey), less AmmConfig.creatorFeeShareRate to the protocol at collection. The locked-LP fee right goes to the PLATFORM's NFT
 * wallet (platformScale + creatorScale of the LP), the burnScale share to nobody.
 *
 * LP LOCKED FOREVER (owner decision 2026-10-10, supersedes "all LP burned"): the Burnticker platform locks 100 % of the graduation LP
 * (platformScale 1,000,000 / creatorScale 0 / burnScale 0) and its lock-NFT wallet is the burn_receipts program's FEE-KEYS PDA, so the
 * Fee Key NFT is owned by the program and the permissionless claim_lock_fees splits the LP fees 80 % → the coin's burn pool / 20 % →
 * the operator treasury (compiled constants; src/lib/burnticker/lockFees.ts). `lpLockProblems` is the platform-side check.
 */

export const PPM = BigInt(1_000_000);
export const LAMPORTS_PER_SOL_BIG = BigInt(1_000_000_000);
export const DEFAULT_PLATFORM: Record<"mainnet" | "devnet", PublicKey> = {
  mainnet: new PublicKey("4Bu96XjU84XjPDSpveTVf6LYGCkfW5FK7SNkREWcEfV4"),
  devnet: new PublicKey("2Jx4KTDrVSdWNazuGpcA8n3ZLTRGGBDxAWhuKe2Xcj2a"),
};
export const DEFAULT_SOL_CONFIG: Record<"mainnet" | "devnet", PublicKey> = {
  mainnet: new PublicKey("6s1xP3hpbAfFoNtUNF8mfHsjr2Bd97JxFJRWLbL6aHuX"),
  devnet: new PublicKey("7ZR4zD7PYfY2XxoG1Gxcy2EgEeGYrpxrwzPuwdUBssEt"),
};
export const CPMM_PROGRAM: Record<"mainnet" | "devnet", PublicKey> = { mainnet: CREATE_CPMM_POOL_PROGRAM, devnet: DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_PROGRAM };
export const LAUNCHLAB_PROGRAM_SDK: Record<"mainnet" | "devnet", PublicKey> = { mainnet: LAUNCHPAD_PROGRAM, devnet: DEVNET_PROGRAM_ID.LAUNCHPAD_PROGRAM };
/** LaunchLab's standard curve: 793.1M of 1B on the curve, 85 SOL raise (the SDK's LaunchpadPoolInitParam). */
export const STANDARD_TOTAL_SELL_RAW = BigInt("793100000000000");
export const STANDARD_RAISE_LAMPORTS = BigInt(85_000_000_000);

const bn = (v: bigint) => new BN(v.toString());
const big = (v: BN | number | bigint) => BigInt(v.toString());

// ---------------------------------------------------------------------------------------------------------------------------------
// Decoded accounts (bigint views of the SDK layouts, so the rest of the module is plain TypeScript)
// ---------------------------------------------------------------------------------------------------------------------------------

export interface GlobalConfigView { curveType: number; index: number; migrateFee: bigint; tradeFeeRate: bigint; maxShareFeeRate: bigint; minSupplyA: bigint; maxLockRate: bigint; minSellRateA: bigint; minMigrateRateA: bigint; minFundRaisingB: bigint; mintB: PublicKey }
export interface PlatformView { feeRate: bigint; creatorFeeRate: bigint; platformScale: bigint; creatorScale: bigint; burnScale: bigint; cpConfigId: PublicKey; platformCpCreator: PublicKey; platformClaimFeeWallet: PublicKey; platformLockNftWallet: PublicKey; platformVestingScale: bigint; restrictCurveParam: number; name: string }
export interface AmmConfigView { index: number; tradeFeeRate: bigint; protocolFeeRate: bigint; fundFeeRate: bigint; creatorFeeRate: bigint; creatorFeeShareRate: bigint; createPoolFee: bigint }

export function decodeGlobalConfig(data: Uint8Array): GlobalConfigView {
  const c = LaunchpadConfig.decode(Buffer.from(data));
  return { curveType: c.curveType, index: c.index, migrateFee: big(c.migrateFee), tradeFeeRate: big(c.tradeFeeRate), maxShareFeeRate: big(c.maxShareFeeRate), minSupplyA: big(c.minSupplyA), maxLockRate: big(c.maxLockRate), minSellRateA: big(c.minSellRateA), minMigrateRateA: big(c.minMigrateRateA), minFundRaisingB: big(c.minFundRaisingB), mintB: c.mintB };
}
const str = (b: number[] | Uint8Array) => Buffer.from(b as number[]).toString("utf8").replace(/\0+$/, "");
export function decodePlatform(data: Uint8Array): PlatformView {
  const p = PlatformConfig.decode(Buffer.from(data));
  return { feeRate: big(p.feeRate), creatorFeeRate: big(p.creatorFeeRate), platformScale: big(p.platformScale), creatorScale: big(p.creatorScale), burnScale: big(p.burnScale), cpConfigId: p.cpConfigId, platformCpCreator: p.platformCpCreator, platformClaimFeeWallet: p.platformClaimFeeWallet, platformLockNftWallet: p.platformLockNftWallet, platformVestingScale: big(p.platformVestingScale), restrictCurveParam: p.restrictCurveParam, name: str(p.name) };
}
export function decodeAmmConfig(data: Uint8Array): AmmConfigView {
  const c = CpmmConfigInfoLayout.decode(Buffer.from(data));
  return { index: c.index, tradeFeeRate: big(c.tradeFeeRate), protocolFeeRate: big(c.protocolFeeRate), fundFeeRate: big(c.fundFeeRate), creatorFeeRate: big(c.creatorFeeRate), creatorFeeShareRate: big(c.creatorFeeShareRate), createPoolFee: big(c.createPoolFee) };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The fee split, in bps and in lamports per 1 SOL of volume
// ---------------------------------------------------------------------------------------------------------------------------------

export interface FeeLeg { bps: number; lamportsPer1Sol: string; to: string; dial: string }
export interface FeeSplit {
  preGraduation: { totalBps: number; legs: FeeLeg[]; note: string };
  postGraduation: { totalBps: number; legs: FeeLeg[]; note: string };
}

/** A rate out of 1,000,000 of volume → bps (exact to 0.01 bp) and lamports per 1 SOL (exact). */
export const ppmToBps = (ppm: bigint) => Number(ppm) / 100;
export const ppmLamportsPerSol = (ppm: bigint) => ((ppm * LAMPORTS_PER_SOL_BIG) / PPM).toString();
const leg = (ppm: bigint, to: string, dial: string): FeeLeg => ({ bps: ppmToBps(ppm), lamportsPer1Sol: ppmLamportsPerSol(ppm), to, dial });

/**
 * Who gets what per 1 SOL traded, before and after graduation. Pure over the decoded configs. Sources, by leg:
 *   curve:  docs platform-config "Fee mechanics" (trade_fee / platform_fee / creator_fee, each amount_in × rate / 1e6); SDK curve.ts
 *           Curve.totalFeeRate / splitFee (the four rates are summed, the fee split pro rata); referral = per-tx shareFeeRate (we pass 0).
 *   CPMM:   docs cpmm/fees — trade fee split LP (remainder) / protocol (protocol_fee_rate of trade fee) / fund (fund_fee_rate of trade
 *           fee); creator fee a separate rate on volume, creator_fee_share_rate of it to the protocol at collection; LP fees belong to LP
 *           holders — the platform's Fee Key holds (platformScale + creatorScale)/1e6 of the LP, the burnScale share is burned and "no
 *           wallet can claim the fees represented by the burned share" (docs lp-fee-distribution, fee-reference).
 */
export function feeSplit(i: {
  global: GlobalConfigView; platform: PlatformView; amm: AmmConfigView;
  /** The launch creator is the burn program's fee PDA (review H-2) — so the creator legs are the burn pool's. */
  creatorIsBurnPool?: boolean;
  /** @deprecated the pre-H-2 name (the creator was the keeper then); read as creatorIsBurnPool so older callers (src/lib/burnticker) keep working. */
  creatorIsKeeper?: boolean;
  shareFeeRate?: bigint;
  /** LP locked forever (2026-10-10): the burn program's fee-keys PDA; when it is the platform's lock-NFT wallet the locked leg splits 80/20. */
  feeKeysPda?: PublicKey;
  /** Where claim_lock_fees pays the operator's 20 % (the Squads vault), for the leg's label; null/absent = "operator treasury". */
  operatorTreasury?: PublicKey | null;
}): FeeSplit {
  const creatorIsBurnPool = i.creatorIsBurnPool ?? i.creatorIsKeeper ?? false;
  const share = i.shareFeeRate ?? BigInt(0);
  const preTotal = i.global.tradeFeeRate + i.platform.feeRate + i.platform.creatorFeeRate + share;
  const burnPoolCurve = creatorIsBurnPool ? "burn pool (the burn program's fee PDA = launch creator; the program's permissionless claim_launchlab_creator_fee)" : "the launch creator's vault (NOT the burn pool's fee PDA)";
  const pre: FeeLeg[] = [
    leg(i.global.tradeFeeRate, "Raydium protocol (GlobalConfig.protocolFeeOwner)", "GlobalConfig.tradeFeeRate — fixed by Raydium"),
    leg(i.platform.feeRate, `platform claim wallet ${i.platform.platformClaimFeeWallet.toBase58()}`, "PlatformConfig.feeRate — 0..50,000 ppm (0..500 bps)"),
    leg(i.platform.creatorFeeRate, burnPoolCurve, "PlatformConfig.creatorFeeRate — 0..5,000 ppm (0..50 bps)"),
  ];
  if (share > BigInt(0)) pre.push(leg(share, "referrer (per transaction)", `shareFeeRate ≤ GlobalConfig.maxShareFeeRate ${i.global.maxShareFeeRate}`));
  // Post-graduation (CPMM). creator fee on the pool = AmmConfig.creatorFeeRate (enable_creator_fee is set by the LaunchLab migration).
  const lpShare = i.amm.tradeFeeRate * (PPM - i.amm.protocolFeeRate - i.amm.fundFeeRate) / PPM;
  const lockedToPlatform = lpShare * (i.platform.platformScale + i.platform.creatorScale) / PPM;
  const lpBurned = lpShare - lockedToPlatform;
  const protocol = i.amm.tradeFeeRate * i.amm.protocolFeeRate / PPM;
  const fund = i.amm.tradeFeeRate * i.amm.fundFeeRate / PPM;
  const creatorNet = i.amm.creatorFeeRate * (PPM - i.amm.creatorFeeShareRate) / PPM;
  const creatorToProtocol = i.amm.creatorFeeRate - creatorNet;
  const cpCreatorDefault = i.platform.platformCpCreator.equals(PublicKey.default);
  const burnPoolCpmm = cpCreatorDefault ? (creatorIsBurnPool ? "burn pool (pool_creator = the launch creator = the fee PDA; CPMM collect_creator_fee_permissionless)" : "the launch creator (pool_creator; NOT the burn pool's fee PDA)") : `PlatformConfig.platformCpCreator ${i.platform.platformCpCreator.toBase58()} (NOT the launch creator)`;
  const lockedDial = `AmmConfig.tradeFeeRate × (1 − protocol − fund) × (platformScale + creatorScale)/1e6 — cpConfigId + migrateCpLockNftScale`;
  const programHoldsKey = !!i.feeKeysPda && i.platform.platformLockNftWallet.equals(i.feeKeysPda);
  // claim_lock_fees: the operator's 20 % is floor(x × 2,000 / 10,000), the burn pool gets the rest (the odd unit included).
  const lockedOperator = lockedToPlatform * BigInt(2_000) / BigInt(10_000);
  // Leg positions stay stable for readers: [0] locked LP (→ the burn pool's 80 % when the program holds the Fee Key), [1] burned LP,
  // [2] Raydium, [3] creator fee → burn pool, [4] Raydium's creator-fee share, and — only when the program holds the Fee Key — [5] the
  // operator's 20 % of the locked LP's fees.
  const lockedLeg = programHoldsKey
    ? leg(lockedToPlatform - lockedOperator, `burn pool (80 % of the locked LP's fees: the Fee Key is owned by the burn program's fee-keys PDA ${i.feeKeysPda!.toBase58()}; permissionless claim_lock_fees; the coin side is burned)`, `${lockedDial} × 80 % — LOCK_FEE_BURN_BPS 8,000, compiled into the program`)
    : leg(lockedToPlatform, `platform Fee Key holder ${i.platform.platformLockNftWallet.toBase58()} (LP-Lock harvest, not the keeper)`, lockedDial);
  const operatorLeg = programHoldsKey ? [leg(lockedOperator, `operator treasury ${i.operatorTreasury ? i.operatorTreasury.toBase58() : "(the Squads vault)"} (20 % of the locked LP's SOL-side fees via claim_lock_fees)`, `${lockedDial} × 20 % — LOCK_FEE_OPERATOR_BPS 2,000, compiled into the program`)] : [];
  const post: FeeLeg[] = [
    lockedLeg,
    leg(lpBurned, "nobody (burned LP's share of LP fees stays in the pool, unclaimable)", "burnScale/1e6 of the LP share"),
    leg(protocol + fund, "Raydium (protocol + fund shares of the trade fee)", "AmmConfig.protocolFeeRate + fundFeeRate of the trade fee — fixed per tier"),
    leg(creatorNet, burnPoolCpmm, "AmmConfig.creatorFeeRate × (1 − creatorFeeShareRate) — fixed per tier (the platform chooses the tier through its cpConfigId); the platform cannot raise it"),
    leg(creatorToProtocol, "Raydium (protocol share of the creator fee, at collection)", "AmmConfig.creatorFeeShareRate (or a CreatorFeeShare PDA)"),
    ...operatorLeg,
  ];
  const postTotal = i.amm.tradeFeeRate + i.amm.creatorFeeRate;
  return {
    preGraduation: { totalBps: ppmToBps(preTotal), legs: pre, note: "bonding-curve trades; quote-token (SOL) fees; platform and creator fees accrue in vaults and must be claimed" },
    postGraduation: { totalBps: ppmToBps(postTotal), legs: post, note: `CPMM pool on AmmConfig index ${i.amm.index} (trade ${ppmToBps(i.amm.tradeFeeRate)} bps + creator ${ppmToBps(i.amm.creatorFeeRate)} bps); creator fee taken on the SOL side when creatorFeeOn = OnlyTokenB` },
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The launch plan: parameters → checks → derived addresses
// ---------------------------------------------------------------------------------------------------------------------------------

export interface LaunchInput {
  cluster: "mainnet" | "devnet";
  programId: PublicKey;
  platformId: PublicKey;
  configId: PublicKey;
  global: GlobalConfigView;
  platform: PlatformView;
  payer: PublicKey;
  creator: PublicKey;
  mint: PublicKey;
  name: string;
  symbol: string;
  uri: string;
  decimals: number;
  /** Whole tokens (1,000,000,000). */
  supplyTokens: bigint;
  /** The raise target in lamports (default 85 SOL = LaunchLab's standard curve). */
  raiseLamports: bigint;
  /** Vault mode: percent of supply locked for the keeper's vesting (0 = buyback mode, nothing locked). */
  lockedPercent: number;
  cliffSeconds: bigint;
  unlockSeconds: bigint;
  /** Optional first buy by the payer on the fresh curve, lamports (0 = none). */
  firstBuyLamports: bigint;
  slippageBps: number;
  creatorFeeOn: "quote-only" | "both";
}

export interface LaunchPlan {
  supplyRaw: bigint; totalSellRaw: bigint; totalLockedRaw: bigint; migrateReserveRaw: bigint; raiseLamports: bigint;
  poolId: PublicKey; vaultA: PublicKey; vaultB: PublicKey; metadata: PublicKey; auth: PublicKey;
  creatorFeeVault: PublicKey; platformFeeVault: PublicKey; vestingRecord: PublicKey | null;
  cpmm: { programId: PublicKey; ammConfig: PublicKey; expectedPoolId: PublicKey; token0: PublicKey; token1: PublicKey; expectedPoolCreator: PublicKey };
  firstBuy: { lamports: bigint; quotedTokensRaw: bigint; minTokensRaw: bigint; fee: { protocol: bigint; platform: bigint; creator: bigint } } | null;
  problems: string[];
}

/** Lower totalSellA so a locked share fits: sell = supply − locked − reserve, reserve = the config's minimum migrate share (15% on mainnet). */
export function totalSellForLock(supplyRaw: bigint, lockedRaw: bigint, minMigrateRateA: bigint): bigint {
  if (lockedRaw === BigInt(0)) return STANDARD_TOTAL_SELL_RAW <= supplyRaw ? STANDARD_TOTAL_SELL_RAW : (supplyRaw * BigInt(85)) / BigInt(100);
  const reserve = ceilDiv(supplyRaw * minMigrateRateA, PPM);
  return supplyRaw - lockedRaw - reserve;
}
const ceilDiv = (a: bigint, b: bigint) => (a + b - BigInt(1)) / b;

export function planLaunch(i: LaunchInput): LaunchPlan {
  const problems: string[] = [];
  if (i.decimals !== 6) problems.push(`decimals must be 6 (the program's BASE_MINT_DECIMALS; SDK Curve.checkParam) — got ${i.decimals}`);
  if (i.symbol.length > 10) problems.push("symbol must be at most 10 characters (SDK createLaunchpad)");
  if (!i.uri) problems.push("metadata uri is required");
  if (!i.global.mintB.equals(WSOL_MINT)) problems.push(`the config's quote mint is ${i.global.mintB.toBase58()}, not SOL — this builder only supports SOL-quoted launches`);
  if (i.global.curveType !== 0) problems.push(`config curveType ${i.global.curveType} — only the constant-product curve (0) is supported`);
  if (i.lockedPercent < 0 || i.lockedPercent > 100 || !Number.isInteger(i.lockedPercent)) problems.push("locked percent must be a whole number 0..100");
  const scale = BigInt(10) ** BigInt(i.decimals);
  const supplyRaw = i.supplyTokens * scale;
  const totalLockedRaw = (supplyRaw * BigInt(Math.max(0, Math.min(100, Math.trunc(i.lockedPercent))))) / BigInt(100);
  const totalSellRaw = totalSellForLock(supplyRaw, totalLockedRaw, i.global.minMigrateRateA);
  const migrateReserveRaw = supplyRaw - totalSellRaw - totalLockedRaw;
  // The program's bounds (GlobalConfig), as the SDK's Curve.checkParam applies them — spelled out so the refusal names the dial.
  if (supplyRaw < i.global.minSupplyA * scale) problems.push(`supply ${supplyRaw} < config minimum ${i.global.minSupplyA * scale}`);
  if (totalLockedRaw > (supplyRaw * i.global.maxLockRate) / PPM) problems.push(`locked ${totalLockedRaw} > maxLockRate ${i.global.maxLockRate} ppm of supply (VestingRatioTooHigh)`);
  if (totalSellRaw < (supplyRaw * i.global.minSellRateA) / PPM) problems.push(`totalSellA ${totalSellRaw} < minSellRate ${i.global.minSellRateA} ppm of supply — lower the locked share`);
  if (migrateReserveRaw < (supplyRaw * i.global.minMigrateRateA) / PPM) problems.push(`migration reserve ${migrateReserveRaw} < minMigrateRate ${i.global.minMigrateRateA} ppm of supply`);
  if (i.raiseLamports < i.global.minFundRaisingB) problems.push(`raise ${i.raiseLamports} lamports < config minimum ${i.global.minFundRaisingB}`);
  if (totalLockedRaw === BigInt(0) && (i.cliffSeconds !== BigInt(0) || i.unlockSeconds !== BigInt(0))) problems.push("with nothing locked, cliff and unlock periods must both be 0");
  if (totalLockedRaw > BigInt(0) && i.unlockSeconds === BigInt(0) && i.cliffSeconds === BigInt(0)) problems.push("a locked share needs a cliff or an unlock period (0/0 means instant release at graduation — say so explicitly with --unlock-days 0 --cliff-days 0 --allow-instant)");
  if (i.platform.platformVestingScale > BigInt(0) && totalLockedRaw === BigInt(0)) problems.push(`the platform takes a vesting slice (${i.platform.platformVestingScale} ppm) but nothing is locked`);
  if (problems.length === 0) {
    try {
      Curve.checkParam({ supply: bn(supplyRaw), totalFundRaising: bn(i.raiseLamports), totalSell: bn(totalSellRaw), totalLockedAmount: bn(totalLockedRaw), decimals: i.decimals, config: toSdkConfig(i.global), migrateType: "cpmm" });
    } catch (e) { problems.push(`SDK Curve.checkParam: ${(e as Error).message}`); }
  }
  const poolId = getPdaLaunchpadPoolId(i.programId, i.mint, i.global.mintB).publicKey;
  const vaultA = getPdaLaunchpadVaultId(i.programId, poolId, i.mint).publicKey;
  const vaultB = getPdaLaunchpadVaultId(i.programId, poolId, i.global.mintB).publicKey;
  const metadata = getPdaMetadataKey(i.mint).publicKey;
  const auth = getPdaLaunchpadAuth(i.programId).publicKey;
  const creatorFeeVault = getPdaCreatorVault(i.programId, i.creator, i.global.mintB).publicKey;
  const platformFeeVault = getPdaPlatformVault(i.programId, i.platformId, i.global.mintB).publicKey;
  const vestingRecord = totalLockedRaw > BigInt(0) ? getPdaVestId(i.programId, poolId, i.creator).publicKey : null;
  const [token0, token1] = sortMints(i.mint, i.global.mintB);
  const cpmmProgram = CPMM_PROGRAM[i.cluster];
  const cpmm = { programId: cpmmProgram, ammConfig: i.platform.cpConfigId, expectedPoolId: getCpmmPdaPoolId(cpmmProgram, i.platform.cpConfigId, token0, token1).publicKey, token0, token1, expectedPoolCreator: i.platform.platformCpCreator.equals(PublicKey.default) ? i.creator : i.platform.platformCpCreator };
  let firstBuy: LaunchPlan["firstBuy"] = null;
  if (i.firstBuyLamports > BigInt(0) && problems.length === 0) {
    const init = Curve.getCurve(0).getInitParam({ supply: bn(supplyRaw), totalFundRaising: bn(i.raiseLamports), totalSell: bn(totalSellRaw), totalLockedAmount: bn(totalLockedRaw), migrateFee: bn(i.global.migrateFee) });
    const q = Curve.buyExactIn({ poolInfo: { virtualA: init.a, virtualB: init.b, realA: new BN(0), realB: new BN(0), totalSellA: bn(totalSellRaw), totalFundRaisingB: bn(i.raiseLamports) }, amountB: bn(i.firstBuyLamports), protocolFeeRate: bn(i.global.tradeFeeRate), platformFeeRate: bn(i.platform.feeRate), curveType: 0, shareFeeRate: new BN(0), creatorFeeRate: bn(i.platform.creatorFeeRate), transferFeeConfigA: undefined, transferFeeConfigB: undefined, slot: 0 });
    const quoted = big(q.amountA.amount);
    firstBuy = { lamports: big(q.amountB), quotedTokensRaw: quoted, minTokensRaw: (quoted * BigInt(10_000 - i.slippageBps)) / BigInt(10_000), fee: { protocol: big(q.splitFee.protocolFee), platform: big(q.splitFee.platformFee), creator: big(q.splitFee.creatorFee) } };
  }
  return { supplyRaw, totalSellRaw, totalLockedRaw, migrateReserveRaw, raiseLamports: i.raiseLamports, poolId, vaultA, vaultB, metadata, auth, creatorFeeVault, platformFeeVault, vestingRecord, cpmm, firstBuy, problems };
}

export function sortMints(a: PublicKey, b: PublicKey): [PublicKey, PublicKey] { return Buffer.compare(a.toBuffer(), b.toBuffer()) < 0 ? [a, b] : [b, a]; }

function toSdkConfig(g: GlobalConfigView): ReturnType<typeof LaunchpadConfig.decode> {
  return { epoch: new BN(0), curveType: g.curveType, index: g.index, migrateFee: bn(g.migrateFee), tradeFeeRate: bn(g.tradeFeeRate), maxShareFeeRate: bn(g.maxShareFeeRate), minSupplyA: bn(g.minSupplyA), maxLockRate: bn(g.maxLockRate), minSellRateA: bn(g.minSellRateA), minMigrateRateA: bn(g.minMigrateRateA), minFundRaisingB: bn(g.minFundRaisingB), mintB: g.mintB, protocolFeeOwner: PublicKey.default, migrateFeeOwner: PublicKey.default, migrateToAmmWallet: PublicKey.default, migrateToCpmmWallet: PublicKey.default } as unknown as ReturnType<typeof LaunchpadConfig.decode>;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The transactions, with every instruction described (the dry run prints these)
// ---------------------------------------------------------------------------------------------------------------------------------

export interface DescribedIx { name: string; program: string; args: Record<string, string | number | boolean>; accounts: { role: string; pubkey: string; signer: boolean; writable: boolean }[]; dataHex: string; ix: TransactionInstruction }
export interface PlannedTx { label: string; signers: string[]; instructions: DescribedIx[] }

const KNOWN_PROGRAMS = new Map<string, string>([
  [LAUNCHPAD_PROGRAM.toBase58(), "LaunchLab (mainnet)"], [DEVNET_PROGRAM_ID.LAUNCHPAD_PROGRAM.toBase58(), "LaunchLab (devnet)"],
  [TOKEN_PROGRAM_ID.toBase58(), "SPL Token"], [ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(), "Associated Token"], [SystemProgram.programId.toBase58(), "System"], [MEMO_PROGRAM_ID.toBase58(), "Memo"],
  [CREATE_CPMM_POOL_PROGRAM.toBase58(), "Raydium CPMM (mainnet)"], [DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_PROGRAM.toBase58(), "Raydium CPMM (devnet)"],
]);
export const programName = (p: PublicKey) => KNOWN_PROGRAMS.get(p.toBase58()) ?? p.toBase58();

export function describe(name: string, ix: TransactionInstruction, roles: string[], args: Record<string, string | number | boolean> = {}): DescribedIx {
  if (roles.length !== ix.keys.length) throw new Error(`${name}: ${roles.length} role names for ${ix.keys.length} accounts`);
  return { name, program: programName(ix.programId), args, accounts: ix.keys.map((k, n) => ({ role: roles[n], pubkey: k.pubkey.toBase58(), signer: k.isSigner, writable: k.isWritable })), dataHex: Buffer.from(ix.data).toString("hex"), ix };
}

const INIT_V2_ROLES = ["payer", "creator (recorded, not a signer)", "global_config", "platform_config", "authority PDA", "pool_state", "base_mint (the pre-generated mint)", "quote_mint (WSOL)", "base_vault", "quote_vault", "metadata (Metaplex)", "base token program", "quote token program", "Metaplex metadata program", "system program", "rent sysvar", "event authority", "LaunchLab program"];
const BUY_ROLES = ["payer", "authority PDA", "global_config", "platform_config", "pool_state", "payer token account (base)", "payer WSOL account", "base_vault", "quote_vault", "base_mint", "quote_mint", "base token program", "quote token program", "event authority", "LaunchLab program", "system program", "platform fee vault", "creator fee vault"];

/** Transaction 1: initialize_v2 (+ the payer's optional first buy, wrapped and unwrapped in the same transaction, as the SDK does). */
export function buildCreateTx(i: LaunchInput, p: LaunchPlan): PlannedTx {
  const feeOn = i.creatorFeeOn === "both" ? CpmmCreatorFeeOn.BothToken : CpmmCreatorFeeOn.OnlyTokenB;
  const curveRule = i.platform.restrictCurveParam ? getPdaPlatformCurveRule(i.programId, i.platformId, i.configId).publicKey : undefined;
  const init = sdkInitializeV2(i.programId, i.payer, i.creator, i.configId, i.platformId, p.auth, p.poolId, i.mint, i.global.mintB, p.vaultA, p.vaultB, p.metadata, TOKEN_PROGRAM_ID,
    i.decimals, i.name, i.symbol, i.uri, { type: "ConstantCurve", totalSellA: bn(p.totalSellRaw), migrateType: "cpmm", supply: bn(p.supplyRaw), totalFundRaisingB: bn(p.raiseLamports) },
    bn(p.totalLockedRaw), bn(i.cliffSeconds), bn(i.unlockSeconds), feeOn, undefined, curveRule);
  const roles = curveRule ? [...INIT_V2_ROLES, "platform curve rule"] : INIT_V2_ROLES;
  const out: DescribedIx[] = [describe("LaunchLab initialize_v2", init, roles, {
    decimals: i.decimals, name: i.name, symbol: i.symbol, uri: i.uri, curve: "ConstantCurve", migrateType: "cpmm", supply: p.supplyRaw.toString(), totalSellA: p.totalSellRaw.toString(), totalFundRaisingB: p.raiseLamports.toString(),
    totalLockedAmount: p.totalLockedRaw.toString(), cliffPeriod: i.cliffSeconds.toString(), unlockPeriod: i.unlockSeconds.toString(), cpmmCreatorFeeOn: feeOn === CpmmCreatorFeeOn.BothToken ? "BothToken (1)" : "OnlyTokenB (0): creator fee always on the SOL side",
  })];
  if (p.firstBuy) {
    const wsol = associatedTokenAddress(i.payer, WSOL_MINT), ataA = associatedTokenAddress(i.payer, i.mint);
    out.push(describe("create payer WSOL account (idempotent)", createAtaIdempotentIx(i.payer, i.payer, WSOL_MINT), ["payer", "WSOL ATA", "owner", "WSOL mint", "system program", "token program"]));
    out.push(describe("wrap SOL: transfer", SystemProgram.transfer({ fromPubkey: i.payer, toPubkey: wsol, lamports: Number(p.firstBuy.lamports) }), ["payer", "WSOL ATA"], { lamports: p.firstBuy.lamports.toString() }));
    out.push(describe("wrap SOL: sync_native", syncNativeIx(wsol), ["WSOL ATA"]));
    out.push(describe("create payer token account (idempotent)", createAtaIdempotentIx(i.payer, i.payer, i.mint), ["payer", "token ATA", "owner", "mint", "system program", "token program"]));
    const buy = buyExactInInstruction(i.programId, i.payer, p.auth, i.configId, i.platformId, p.poolId, ataA, wsol, p.vaultA, p.vaultB, i.mint, i.global.mintB, TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, p.platformFeeVault, p.creatorFeeVault, bn(p.firstBuy.lamports), bn(p.firstBuy.minTokensRaw), new BN(0));
    out.push(describe("LaunchLab buy_exact_in (the first buy)", buy, BUY_ROLES, { amountB: p.firstBuy.lamports.toString(), minAmountA: p.firstBuy.minTokensRaw.toString(), shareFeeRate: 0, quotedTokensRaw: p.firstBuy.quotedTokensRaw.toString() }));
    out.push(describe("unwrap: close WSOL account", closeAccountIx(wsol, i.payer, i.payer), ["WSOL ATA", "destination (payer)", "owner (payer)"]));
  }
  return { label: "create" + (p.firstBuy ? " + first buy" : ""), signers: ["payer", "mint keypair"], instructions: out };
}

/** Transaction 2 (vault mode only): create_vesting_account for the whole locked amount to the keeper, signed by the CREATOR. */
export function buildVestingTx(i: LaunchInput, p: LaunchPlan, beneficiary: PublicKey): PlannedTx | null {
  if (p.totalLockedRaw === BigInt(0)) return null;
  const record = getPdaVestId(i.programId, p.poolId, beneficiary).publicKey;
  const ix = sdkCreateVestingAccount(i.programId, i.creator, beneficiary, p.poolId, record, bn(p.totalLockedRaw));
  return { label: "assign the locked share (vault mode)", signers: ["creator"], instructions: [describe("LaunchLab create_vesting_account", ix, ["creator (signer, pays rent)", "beneficiary (the keeper)", "pool_state", "vesting_record PDA", "system program"], { shareAmount: p.totalLockedRaw.toString(), beneficiary: beneficiary.toBase58() })] };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Our own platform (Burnticker): the fee dials the owner controls
// ---------------------------------------------------------------------------------------------------------------------------------

export interface PlatformInput {
  programId: PublicKey; admin: PublicKey; claimFeeWallet: PublicKey; lockNftWallet: PublicKey; vestingWallet: PublicKey; cpConfigId: PublicKey;
  /** Platform (developer) trade fee, ppm of curve volume: 0..50,000. The owner's decision 10-09: 25 bps = 2,500. */
  feeRatePpm: bigint;
  /** Creator fee = the burn pool's slot, ppm: 0..5,000 (50 bps is the program's MAX_CREATOR_FEE_RATE). */
  creatorFeeRatePpm: bigint;
  /** LP at graduation: platformScale → the platform's Fee Key, burnScale burned; creatorScale must be 0 (program assert). Sum 1e6. Burnticker: 1,000,000 (LP locked 100 %, 2026-10-10). */
  platformScalePpm: bigint;
  name: string; web: string; img: string;
}

export const PLATFORM_FEE_CAP_PPM = BigInt(50_000);
export const CREATOR_FEE_CAP_PPM = BigInt(5_000);

/** What a dry run writes for an unset --web / --img: never a real-looking URL, and refused for --send. */
export const PLATFORM_SITE_UNSET = "https://unset.invalid";

/**
 * create_platform_config writes the platform's web and image URLs ON CHAIN (2026-10-10 run-sheet fix): a send must name both
 * explicitly as https URLs — no default (the old burnticker.xyz / burnticker.example values were wrong for burnticker.com).
 * Dry runs may omit them (the placeholder above is shown and a warning printed). Returns the refusal, or null.
 */
export function platformSiteRefusal(o: { web?: string | null; img?: string | null; send: boolean }): string | null {
  if (!o.send) return null;
  const bad = (u?: string | null) => !u || !/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}(\/\S*)?$/i.test(u) || /(^|\.)burnticker\.(xyz|example)$|\.invalid$/i.test(new URL(u).hostname);
  const missing = [bad(o.web) ? "--web" : null, bad(o.img) ? "--img" : null].filter(Boolean);
  return missing.length ? `--send needs ${missing.join(" and ")} as an explicit https URL (written on chain by create_platform_config; there is no default)` : null;
}

export function platformProblems(p: PlatformInput): string[] {
  const out: string[] = [];
  if (p.feeRatePpm < BigInt(0) || p.feeRatePpm > PLATFORM_FEE_CAP_PPM) out.push(`platform feeRate ${p.feeRatePpm} ppm is outside 0..${PLATFORM_FEE_CAP_PPM} (500 bps cap; PlatformParams::check → InvalidInput)`);
  if (p.creatorFeeRatePpm < BigInt(0) || p.creatorFeeRatePpm > CREATOR_FEE_CAP_PPM) out.push(`creatorFeeRate ${p.creatorFeeRatePpm} ppm is outside 0..${CREATOR_FEE_CAP_PPM} (MAX_CREATOR_FEE_RATE = 50 bps; → InvalidPlatformInfo)`);
  if (p.platformScalePpm < BigInt(0) || p.platformScalePpm > PPM) out.push("platformScale must be 0..1,000,000 ppm");
  if (Buffer.byteLength(p.name) > 64 || Buffer.byteLength(p.web) > 256 || Buffer.byteLength(p.img) > 256) out.push("name ≤ 64 bytes, web/img ≤ 256 bytes");
  if (p.claimFeeWallet.equals(PublicKey.default)) out.push("the platform claim-fee wallet is unset (BURNTICKER_FEE_WALLET)");
  return out;
}

/** The Burnticker LP policy (owner decision 2026-10-10): 100 % of the graduation LP locked to the platform's Fee Key, nothing burned. */
export const LP_LOCK_PLATFORM_SCALE_PPM = PPM;

/**
 * LP LOCKED FOREVER — the platform-side check (2026-10-10): platformScale must be 1,000,000 (creatorScale 0 / burnScale 0 follow from
 * buildPlatformTx) and the lock-NFT wallet must be the burn program's fee-keys PDA, so the Fee Key is owned by the program and only
 * the permissionless claim_lock_fees (80 % burn pool / 20 % operator, compiled) can collect the LP fees. Empty = the policy holds.
 */
export function lpLockProblems(p: Pick<PlatformInput, "platformScalePpm" | "lockNftWallet">, feeKeysPda: PublicKey): string[] {
  const out: string[] = [];
  if (p.platformScalePpm !== LP_LOCK_PLATFORM_SCALE_PPM) out.push(`LP to the platform's Fee Key is ${p.platformScalePpm} ppm — the Burnticker policy locks 100 % (1,000,000 ppm; creator 0, burn 0)`);
  if (!p.lockNftWallet.equals(feeKeysPda)) out.push(`the platform lock-NFT wallet is ${p.lockNftWallet.toBase58()}, not the burn program's fee-keys PDA ${feeKeysPda.toBase58()} — the Fee Key must be owned by the program`);
  return out;
}

export function buildPlatformTx(p: PlatformInput): { platformId: PublicKey; tx: PlannedTx } {
  const platformId = getPdaPlatformId(p.programId, p.admin).publicKey;
  const ix = sdkCreatePlatformConfig(p.programId, p.admin, p.claimFeeWallet, p.lockNftWallet, p.vestingWallet, platformId, p.cpConfigId, PublicKey.default,
    { platformScale: bn(p.platformScalePpm), creatorScale: new BN(0), burnScale: bn(PPM - p.platformScalePpm) }, bn(p.feeRatePpm), bn(p.creatorFeeRatePpm), p.name, p.web, p.img, new BN(0));
  const d = describe("LaunchLab create_platform_config", ix, ["platform admin (signer)", "platform claim-fee wallet (BURNTICKER_FEE_WALLET)", "platform lock-NFT wallet (the Fee Key owner: the burn program's fee-keys PDA)", "platform_config PDA", "cpmm AmmConfig (cpConfigId)", "system program", "transfer-fee extension authority (unused: default)", "platform vesting wallet"],
    { feeRate: p.feeRatePpm.toString(), creatorFeeRate: p.creatorFeeRatePpm.toString(), platformScale: p.platformScalePpm.toString(), creatorScale: 0, burnScale: (PPM - p.platformScalePpm).toString(), platformVestingScale: 0, name: p.name, web: p.web, img: p.img, platformCpCreator: "default (left unset → the launch creator is the CPMM pool creator)" });
  return { platformId, tx: { label: "create the Burnticker platform config", signers: ["platform admin"], instructions: [d] } };
}

/** A PlatformView for a platform that does not exist yet (the dry run's fee table before the config is created). */
export function platformViewOf(p: PlatformInput): PlatformView {
  return { feeRate: p.feeRatePpm, creatorFeeRate: p.creatorFeeRatePpm, platformScale: p.platformScalePpm, creatorScale: BigInt(0), burnScale: PPM - p.platformScalePpm, cpConfigId: p.cpConfigId, platformCpCreator: PublicKey.default, platformClaimFeeWallet: p.claimFeeWallet, platformLockNftWallet: p.lockNftWallet, platformVestingScale: BigInt(0), restrictCurveParam: 0, name: p.name };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The guard: nothing is sent to mainnet without two keys
// ---------------------------------------------------------------------------------------------------------------------------------

/**
 * The cluster is read from the RPC's genesis hash. Sending to mainnet needs BOTH `--i-understand-this-spends-real-sol` AND
 * BURNKEEPER_MAINNET=1; a dry run never signs or sends, so it may read mainnet (to quote the real curve) with neither.
 */
export function launchRefusal(i: { cluster: Cluster; flagCluster: "mainnet" | "devnet"; dryRun: boolean; iUnderstand: boolean; env: Readonly<Record<string, string | undefined>> }): string | null {
  if (i.flagCluster === "devnet" && i.cluster !== "devnet" && i.cluster !== "localnet") return `--cluster devnet but the RPC is ${i.cluster} — refusing`;
  if (i.flagCluster === "mainnet" && i.cluster !== "mainnet") return `--cluster mainnet but the RPC is ${i.cluster} — refusing`;
  if (i.cluster !== "mainnet" || i.dryRun) return null;
  const armed = i.env.BURNKEEPER_MAINNET === "1";
  if (!armed && !i.iUnderstand) return "MAINNET SEND refused: both --i-understand-this-spends-real-sol and BURNKEEPER_MAINNET=1 are required (neither is set)";
  if (!armed) return "MAINNET SEND refused: BURNKEEPER_MAINNET=1 is not set (the flag alone is not enough)";
  if (!i.iUnderstand) return "MAINNET SEND refused: --i-understand-this-spends-real-sol is not given (the env alone is not enough)";
  return null;
}

export const cpiEventAuthority = (programId: PublicKey) => getPdaCpiEvent(programId).publicKey;
