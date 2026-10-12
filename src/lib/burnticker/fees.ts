import { PublicKey } from "@solana/web3.js";
import { feeSplit as liveFeeSplit, PPM, ppmToBps, type AmmConfigView, type GlobalConfigView, type PlatformView } from "@/lib/burnKeeper/launch";
import { burnPoolFor } from "@/lib/burnKeeper/burnPool";
import { LOCK_FEE_BURN_BPS, LOCK_FEE_OPERATOR_BPS, LP_LOCKED_PCT, LP_POLICY_LINE, feeKeysPda, operatorTreasuryRecord } from "@/lib/burnticker/lockFees";

/**
 * BURNTICKER FEE SPLIT — the one place the DESIGNED numbers live (the owner, 2026-10-09; sources: docs/burnkeeper/fees.md, read from
 * the pinned Raydium SDK, Raydium's docs and the live config accounts). Read by the platform-config CLI, the wizard's review step and
 * every token page, so the three can never disagree. The TRUST page shows the LIVE values decoded from the on-chain PlatformConfig
 * (`liveSplit` below, the keeper's `feeSplit` over decoded accounts) next to these, so a drift between design and chain is visible.
 *
 * THE DECISIONS (10-09):
 *   · human creators earn NO cash from trading fees: LaunchLab's "creator fee" slot (PlatformConfig.creatorFeeRate, cap 50 bps) always
 *     pays the token's burn pool, 100%, not configurable by the creator. The LaunchLab CREATOR of every coin is the burn program's FEE
 *     PDA for the mint (`burnPoolFor(programId, mint)`, src/lib/burnKeeper/burnPool.ts — review finding H-2), never a hot key: the
 *     program claims the curve fees into the PDA's WSOL ATA and Raydium's permissionless collect pays it after graduation. The keeper
 *     only pays gas;
 *   · the developer (Burnticker) takes 25 bps of curve volume through the PLATFORM slot (PlatformConfig.feeRate), paid to the wallet
 *     whose PUBKEY is BURNTICKER_FEE_WALLET — never a key;
 *   · LP LOCKED FOREVER (owner decision 2026-10-10, superseding the 10-09 "every coin burns 100% of its graduation LP"): 100% of the
 *     graduation LP is locked with Raydium's LP lock (migrateCpLockNftScale platformScale = 1e6, creatorScale 0, burnScale 0) — never
 *     withdrawable, not creator-configurable — and the Fee Key NFT is owned by the burn program's fee-keys PDA. The permissionless
 *     claim_lock_fees splits the LP fees by compiled constants: SOL side 80% → the coin's burn pool, 20% → the operator treasury
 *     (lockFees.ts operatorTreasuryRecord: mainnet = the developer fee wallet, devnet = the rehearsal Squads vault); the coin side is burned. Per swap after graduation (CPMM tier 0, 25 bps): 21 bps LP → 16.8 burn pool + 4.2 operator;
 *     3 bps RAY buyback + 1 bp Raydium treasury; plus the burn pool's 4.75 bps/SOL from Raydium's FIXED CPMM creator fee (AmmConfig.
 *     creatorFeeRate 5 bps × (1 − creatorFeeShareRate 5%)), which no platform dial can change. So the operator earns 20% of the
 *     post-graduation LP fees (4.2 bps of volume) and ≈ 21.55 bps of every swap goes to the burn.
 *
 * Units: parts per million of volume on chain (100 ppm = 1 bp); bps here; "per 1 SOL of volume" on the pages = bps / 10,000 SOL.
 */

/** Burnticker's developer slice of curve volume — the owner's number (2026-10-09). PlatformConfig.feeRate = 2,500 ppm. */
export const BURNTICKER_DEV_FEE_BPS = 25;
/** The burn pool's slot on the curve: PlatformConfig.creatorFeeRate at the program's cap (MAX_CREATOR_FEE_RATE = 5,000 ppm). */
export const BURN_POOL_CURVE_BPS = 50;
/** Raydium's curve fee: GlobalConfig.tradeFeeRate = 2,500 ppm on the SOL configs of both clusters. */
export const RAYDIUM_CURVE_BPS = 25;
/**
 * LP at graduation (owner decision 2026-10-10): 100% LOCKED to the platform's Fee Key (platformScale 1,000,000, creatorScale 0, burnScale
 * 0) — so 0% is burned. `LP_BURNED_PCT` stays exported (0) for readers of the older field; `LP_LOCKED_PCT` is the policy.
 */
export const LP_BURNED_PCT = 0;
export { LP_LOCKED_PCT, LOCK_FEE_BURN_BPS, LOCK_FEE_OPERATOR_BPS, LP_POLICY_LINE };
export const PLATFORM_SCALE_PPM = BigInt(1_000_000);
/** The locked LP's share of the 25 bps CPMM trade fee: 84% = 21 bps, split by claim_lock_fees. */
export const CPMM_LP_BPS = 21;
export const LP_FEES_TO_BURN_POOL_BPS = (CPMM_LP_BPS * LOCK_FEE_BURN_BPS) / 10_000;      // 16.8
export const LP_FEES_TO_OPERATOR_BPS = (CPMM_LP_BPS * LOCK_FEE_OPERATOR_BPS) / 10_000;  // 4.2
/** Post-graduation (CPMM AmmConfig index 0, 25 bps tier): creator fee 5 bps fixed per tier, 5% of it to the protocol at collection. */
export const CPMM_TIER_INDEX = 0;
export const CPMM_TRADE_BPS = 25;
export const CPMM_CREATOR_BPS = 5;
export const CPMM_CREATOR_SHARE_TO_PROTOCOL = 0.05;

export interface FeeLeg { label: "Raydium protocol" | "Burnticker (developer)" | "Burnticker (operator, LP fees)" | "burn pool" | "burn pool (LP fees)" | "nobody (burned LP)"; bps: number; recipient: string; dial: string; note: string }
export interface FeeSplit { phase: "curve" | "post-graduation"; legs: FeeLeg[]; totalBps: number }

/** The split on the bonding curve (pre-graduation): three independent, additive rates on the SOL amount of every trade. */
export const CURVE_FEES: FeeSplit = {
  phase: "curve",
  legs: [
    { label: "Raydium protocol", bps: RAYDIUM_CURVE_BPS, recipient: "Raydium (GlobalConfig.protocolFeeOwner)", dial: "GlobalConfig.tradeFeeRate = 2,500 ppm — fixed by Raydium", note: "" },
    { label: "Burnticker (developer)", bps: BURNTICKER_DEV_FEE_BPS, recipient: "BURNTICKER_FEE_WALLET (PlatformConfig.platformClaimFeeWallet)", dial: "PlatformConfig.feeRate = 2,500 ppm (0..50,000 allowed)", note: "owner's decision 2026-10-09" },
    { label: "burn pool", bps: BURN_POOL_CURVE_BPS, recipient: "the burn program's fee PDA for the mint (= the LaunchLab creator; claimed by the program's permissionless claim_launchlab_creator_fee into the fee PDA's WSOL ATA), 100%", dial: "PlatformConfig.creatorFeeRate = 5,000 ppm — the program's cap", note: "creators receive none of it; the keeper only pays gas" },
  ],
  totalBps: RAYDIUM_CURVE_BPS + BURNTICKER_DEV_FEE_BPS + BURN_POOL_CURVE_BPS,
};

/**
 * After graduation (Raydium CPMM pool, tier 0): the LP is 100% locked and the Fee Key is owned by the burn program, so the LP's 21 bps
 * are split by claim_lock_fees — 16.8 bps to the burn pool, 4.2 bps to the operator (20%, fixed in code) — and the burn pool also gets
 * Raydium's fixed creator fee (4.75 bps). The operator's line is stated as plainly as the developer's curve slice.
 */
export const POST_GRADUATION_FEES: FeeSplit = {
  phase: "post-graduation",
  legs: [
    { label: "Raydium protocol", bps: 4.25, recipient: "Raydium (protocol 3 bps + fund 1 bp of the trade fee; 0.25 bp = 5% of the creator fee at collection)", dial: "AmmConfig.protocolFeeRate 12% + fundFeeRate 4% of the 25 bps trade fee; creatorFeeShareRate 5%", note: "fixed per tier" },
    { label: "Burnticker (operator, LP fees)", bps: LP_FEES_TO_OPERATOR_BPS, recipient: operatorTreasuryRecord("mainnet").text, dial: "84% of the 25 bps trade fee × LOCK_FEE_OPERATOR_BPS 2,000 — compiled into the program; no admin key, no config field", note: "owner decision 2026-10-10: the operator earns 20% of the post-graduation LP fees" },
    { label: "burn pool", bps: 4.75, recipient: "the burn program's fee PDA via CPMM collect_creator_fee_permissionless (pool_creator = the fee PDA, copied from the LaunchLab creator at migration)", dial: "AmmConfig.creatorFeeRate = 500 ppm (5 bps) × (1 − 5%) — fixed per tier; no platform dial changes it", note: "" },
    { label: "burn pool (LP fees)", bps: LP_FEES_TO_BURN_POOL_BPS, recipient: "the burn program's fee PDA: 80% of the locked LP's SOL-side fees via claim_lock_fees (the Fee Key is owned by the program's fee-keys PDA); the coin side is burned outright", dial: "84% of the 25 bps trade fee × LOCK_FEE_BURN_BPS 8,000 — compiled into the program", note: "LP locked forever (owner decision 2026-10-10)" },
  ],
  totalBps: CPMM_TRADE_BPS + CPMM_CREATOR_BPS,
};

/** The post-graduation split with the operator leg's recipient for a given cluster (audit R03: one record, lockFees.ts). */
export function postGraduationFeesFor(cluster: string): FeeSplit {
  return { ...POST_GRADUATION_FEES, legs: POST_GRADUATION_FEES.legs.map((l) => (l.label === "Burnticker (operator, LP fees)" ? { ...l, recipient: operatorTreasuryRecord(cluster).text } : l)) };
}

/**
 * PRE-AUDIT CAP (the owner, 2026-10-09): until the program is audited, a burn pool spends from at most 25 SOL; fee income above the cap
 * QUEUES and is shown on the token page as "queued, released after audit". The keeper models it when it fixes a spend (pool = min(
 * spendable, cap)); the on-chain enforcement is the Receipts program's — that seam is noted in the README and on the trust page.
 */
export const PRE_AUDIT_POOL_CAP_SOL = 25;
export const PRE_AUDIT_POOL_CAP_LAMPORTS = BigInt(PRE_AUDIT_POOL_CAP_SOL) * BigInt(1_000_000_000);
export function capPool(spendableLamports: bigint, capLamports: bigint = PRE_AUDIT_POOL_CAP_LAMPORTS): { pool: bigint; queued: bigint } {
  return spendableLamports > capLamports ? { pool: capLamports, queued: spendableLamports - capLamports } : { pool: spendableLamports, queued: BigInt(0) };
}

/** Operator identity and the use of the developer fee (the owner, 2026-10-09). The contact address is a TODO the owner fills in. */
// the line itself lives in the client-safe copy module so the operator page can render it without this file's chain imports
export { OPERATOR_LINE } from "@/lib/burnticker/trustpack/copy";
export const OPERATOR_CONTACT_TODO = "TODO_CONTACT_ADDRESS";
export const USE_OF_FEES = "Burnticker's 25 bps of curve volume and the operator's 20% of post-graduation LP SOL fees (fixed in code; the other 80% and the token side go to each coin's burn pool) fund attesters, hosting, the security reviews and bounty, and the operator. The operator and its wallets never trade any coin, including the platform's own; the only buybacks are each coin's program-run burn-pool purchases, and everything they buy is burned.";
/**
 * The attester line on the trust page (review 2 §2, 2026-10-11): the present fact, not a schedule — Switchboard ended its services and no
 * independent second attester exists. `dueBy` (14 days after the first launch) stays as the owner's internal check-in date only.
 */
export const ATTESTER_STATUS_LINE = "One operator attester is configured; no independent second attester is live.";
export const ATTESTER2_DAYS_AFTER_FIRST_LAUNCH = 14;
export function attesterStatusLine(firstLaunchAtMs: number | null): { line: string; dueBy: string | null } {
  const dueBy = firstLaunchAtMs === null ? null : new Date(firstLaunchAtMs + ATTESTER2_DAYS_AFTER_FIRST_LAUNCH * 86_400_000).toISOString().slice(0, 10);
  return { line: `${ATTESTER_STATUS_LINE} Quorum 1.`, dueBy };
}

/** Creators keep nothing from fees in v1: a constant, not a setting. No referral codes, no discounts, no per-launch dials. */
export const CREATOR_FEE_SLICE_BPS = 0 as const;
export const REFERRAL_SHARE_FEE_PPM = BigInt(0);

/** bps → SOL per 1 SOL of volume, as a plain string ("0.0025"). */
export function bpsPerSol(bps: number): string {
  const s = (bps / 10_000).toFixed(6).replace(/0+$/, "");
  return s.endsWith(".") ? `${s}0` : s;
}

/** The developer wallet's PUBKEY from the environment (never a key). Null when unset — the CLI and the launch route refuse then. */
export function devFeeWallet(env: Readonly<Record<string, string | undefined>> = process.env): string | null {
  const v = (env.BURNTICKER_FEE_WALLET ?? "").trim();
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v) ? v : null;
}

/** One sentence for the review step and the token page. States the split; says nothing about price. */
export function feeSplitSentence(): string {
  const c = CURVE_FEES.legs;
  return `On every 1 SOL traded on the curve: ${c.map((l) => `${bpsPerSol(l.bps)} SOL to ${l.label}`).join(", ")} (${CURVE_FEES.totalBps} bps in all). After graduation the LP is ${LP_LOCKED_PCT}% locked forever and its fees fund the burn: of the LP's ${bpsPerSol(CPMM_LP_BPS)} SOL per 1 SOL, ${bpsPerSol(LP_FEES_TO_BURN_POOL_BPS)} goes to the burn pool and ${bpsPerSol(LP_FEES_TO_OPERATOR_BPS)} to the operator (80/20, fixed in code), the coin side is burned, and the burn pool also receives Raydium's fixed CPMM creator fee (${bpsPerSol(4.75)} SOL per 1 SOL). The LaunchLab creator is the burn program's fee PDA, so the creator-fee slot can only ever pay the burn pool; the human creator receives no cash from fees and the keeper only pays gas.`;
}

/** The platform-config dials these constants translate to (what scripts/burnticker-platform-config.mts builds). */
export const PLATFORM_DIALS = { feeRatePpm: BigInt(BURNTICKER_DEV_FEE_BPS * 100), creatorFeeRatePpm: BigInt(BURN_POOL_CURVE_BPS * 100), platformScalePpm: PLATFORM_SCALE_PPM, creatorScalePpm: BigInt(0), burnScalePpm: PPM - PLATFORM_SCALE_PPM, lockNftWallet: "the burn program's fee-keys PDA [\"fee_keys\"]", cpmmTierIndex: CPMM_TIER_INDEX } as const;

export interface LiveVsDesigned { field: string; designed: string; live: string; matches: boolean }

/** The LIVE platform config decoded from chain, compared field by field with the design (the trust page's table). */
export function compareLivePlatform(p: PlatformView, devWallet: string | null, burnProgramId: string | null = null): LiveVsDesigned[] {
  const row = (field: string, designed: string, live: string): LiveVsDesigned => ({ field, designed, live, matches: designed === live });
  return [
    row("platform fee (developer), bps", String(BURNTICKER_DEV_FEE_BPS), String(ppmToBps(p.feeRate))),
    row("creator fee (burn pool), bps", String(BURN_POOL_CURVE_BPS), String(ppmToBps(p.creatorFeeRate))),
    row("LP to platform at graduation, ppm", PLATFORM_SCALE_PPM.toString(), p.platformScale.toString()),
    row("LP to creator at graduation, ppm", "0", p.creatorScale.toString()),
    row("burnScale at graduation, ppm (0: nothing is burned, the LP is locked)", (PPM - PLATFORM_SCALE_PPM).toString(), p.burnScale.toString()),
    row("Fee Key owner (platform lock-NFT wallet)", burnProgramId ? feeKeysPdaOrNull(burnProgramId) : "the burn program's fee-keys PDA (program id not set)", p.platformLockNftWallet.toBase58()),
    row("platform vesting slice, ppm", "0", p.platformVestingScale.toString()),
    row("CPMM pool creator override", "default (launch creator = the keeper)", p.platformCpCreator.equals(PublicKey.default) ? "default (launch creator = the keeper)" : p.platformCpCreator.toBase58()),
    row("platform claim-fee wallet", devWallet ?? "BURNTICKER_FEE_WALLET unset", p.platformClaimFeeWallet.toBase58()),
  ];
}

const feeKeysPdaOrNull = (programId: string): string => { try { return feeKeysPda(programId).toBase58(); } catch { return "invalid program id"; } };

/** The keeper's live split over decoded accounts (re-exported so the trust page and the CLI compute it the same way). The creator is the burn pool's fee PDA. */
export function liveSplit(i: { global: GlobalConfigView; platform: PlatformView; amm: AmmConfigView; burnProgramId?: string | null; operatorTreasury?: string | null }) {
  let keys: PublicKey | undefined;
  try { keys = i.burnProgramId ? feeKeysPda(i.burnProgramId) : undefined; } catch { keys = undefined; }
  return liveFeeSplit({ global: i.global, platform: i.platform, amm: i.amm, creatorIsBurnPool: true, feeKeysPda: keys, operatorTreasury: i.operatorTreasury ? new PublicKey(i.operatorTreasury) : null });
}

/** The burn pool's on-chain addresses for a mint: the fee PDA (= LaunchLab creator) and its WSOL ATA (where claimed curve fees land). */
export function burnPoolAddresses(programId: string, mint: string): { feePda: string; feeWsol: string; feeToken: string; config: string } {
  const p = burnPoolFor(new PublicKey(programId), new PublicKey(mint));
  return { feePda: p.feePda.toBase58(), feeWsol: p.feeWsol.toBase58(), feeToken: p.feeToken.toBase58(), config: p.config.toBase58() };
}
