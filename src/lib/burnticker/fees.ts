import { PublicKey } from "@solana/web3.js";
import { feeSplit as liveFeeSplit, PPM, ppmToBps, type AmmConfigView, type GlobalConfigView, type PlatformView } from "@/lib/burnKeeper/launch";
import { burnPoolFor } from "@/lib/burnKeeper/burnPool";
import { LOCK_FEE_BURN_BPS, LOCK_FEE_OPERATOR_BPS, LP_LOCKED_PCT, LP_POLICY_LINE, feeKeysPda, operatorTreasuryRecord } from "@/lib/burnticker/lockFees";
import { CPMM_CONFIG_ID, CPMM_PLATFORM_TIERS, CPMM_TIER, cpmmTierLabel, newCoinTierAccepted, cpmmTierOf, postGraduationBps, tierForPin, type CpmmCluster } from "@/lib/burnticker/cpmmTier";
import { EARLIER_COINS_LINE, PAIR_OPERATOR_SHARE_LINE, footerFeeLine, postGraduationShareLine } from "@/lib/burnticker/feeShareLine";

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
 *     (lockFees.ts operatorTreasuryRecord: mainnet = the developer fee wallet, devnet = the rehearsal Squads vault); the coin side is burned.
 *   · CPMM FEE TIER 9 (owner decision 2026-10-12, superseding tier 0; cpmmTier.ts holds the ids and rates): per swap after graduation the
 *     trade fee is 25 bps (21 bps LP → 16.8 burn pool + 4.2 operator; 3 bps RAY buyback + 1 bp Raydium treasury) and Raydium's creator
 *     fee is 75 bps (71.25 bps to the burn pool, 3.75 bps to Raydium at collection). Traders pay 100 bps; ≈ 88.05 bps go to the burn pool,
 *     4.2 bps to the operator, 7.75 bps to Raydium (tier 0 was 30 / 21.55 / 4.2 / 4.25). Every number in code derives from cpmmTier.ts.
 *     A coin keeps the tier it pinned at initialize_token; devnet stays on its index 0 (creator fee 25 bps, no protocol share).
 *   · CPMM FEE TIER 14 FOR NEW COINS (owner decision 2026-10-19): coins initialised after the platform's cpConfigId moves to index 14
 *     pay a 75 bps trade fee (63 bps LP → 50.4 burn pool + 12.6 operator; 9 + 3 Raydium) and a 50 bps creator fee (47.5 burn pool,
 *     2.5 Raydium): traders pay 125 bps; 97.90 burn pool, 12.6 operator, 14.50 Raydium. Every function below that describes ONE coin
 *     takes that coin's pinned AmmConfig (TokenConfig.ll_cp_config) and reads its tier (cpmmTier.ts tierForPin); without a pin it
 *     describes the tier new coins get (CPMM_TIER).
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
/** The CPMM tier each cluster's platform points at (cpmmTier.ts) and its per-swap breakdown; every post-graduation number below derives from it. */
export { CPMM_CONFIG_ID, CPMM_TIER, cpmmTierLabel };
const clusterOf = (cluster: string): CpmmCluster => (cluster === "devnet" ? "devnet" : cluster === "localnet" ? "localnet" : "mainnet");
/** The tier a coin pinned (its TokenConfig.ll_cp_config), else the tier new coins get on the cluster. */
export const tierFor = (cluster: string, cpConfig?: string | null) => tierForPin(clusterOf(cluster), cpConfig);
export const postGraduationBpsFor = (cluster: string, cpConfig?: string | null) => postGraduationBps(tierFor(cluster, cpConfig), LOCK_FEE_BURN_BPS);
const MAINNET_POST = postGraduationBpsFor("mainnet");
/** Post-graduation on mainnet for new coins (CPMM AmmConfig index 14): trade fee 75 bps, creator fee 50 bps fixed per tier, 5% of it to the protocol at collection. */
export const CPMM_TIER_INDEX = CPMM_TIER.mainnet.index;
export const CPMM_TRADE_BPS = MAINNET_POST.tradeFee;
export const CPMM_CREATOR_BPS = MAINNET_POST.creatorFee;
export const CPMM_CREATOR_SHARE_TO_PROTOCOL = CPMM_TIER.mainnet.creatorFeeShareRate / 1_000_000;
/** The locked LP's share of the CPMM trade fee: 84% = 63 bps on tier 14, split by claim_lock_fees. */
export const CPMM_LP_BPS = MAINNET_POST.lpFees;
export const LP_FEES_TO_BURN_POOL_BPS = MAINNET_POST.lpToBurnPool;      // 50.4 (16.8 on tier 9)
export const LP_FEES_TO_OPERATOR_BPS = MAINNET_POST.lpToOperator;       // 12.6 (4.2 on tier 9)
/** The creator fee net of Raydium's share (47.5 bps) and the burn pool's whole per-swap take after graduation (97.90 bps; 88.05 on tier 9). */
export const CREATOR_FEE_TO_BURN_POOL_BPS = MAINNET_POST.creatorToBurnPool;
export const BURN_POOL_POST_GRADUATION_BPS = MAINNET_POST.burnPoolTotal;

export interface FeeLeg { label: "Raydium protocol" | "Burnticker (developer)" | "Burnticker (operator, LP fees)" | "burn pool" | "burn pool (LP fees)" | "nobody (burned LP)"; bps: number; recipient: string; dial: string; note: string }
export interface FeeSplit { phase: "curve" | "post-graduation"; legs: FeeLeg[]; totalBps: number }

/** The split on the bonding curve (pre-graduation): three independent, additive rates on the SOL amount of every trade. */
export const CURVE_FEES: FeeSplit = {
  phase: "curve",
  legs: [
    { label: "Raydium protocol", bps: RAYDIUM_CURVE_BPS, recipient: "Raydium (GlobalConfig.protocolFeeOwner)", dial: "Fixed by Raydium at 2,500 ppm (GlobalConfig.tradeFeeRate)", note: "" },
    { label: "Burnticker (developer)", bps: BURNTICKER_DEV_FEE_BPS, recipient: "Burnticker's developer fee wallet (PlatformConfig.platformClaimFeeWallet)", dial: "Set to 2,500 ppm in the platform config (PlatformConfig.feeRate). Anything from 0 to 50,000 is allowed.", note: "owner's decision 2026-10-09" },
    { label: "burn pool", bps: BURN_POOL_CURVE_BPS, recipient: "This coin's burn pool gets all of it. The burn pool is the burn program's fee account, which is also the coin's creator on LaunchLab. Anyone can run the claim (claim_launchlab_creator_fee) that moves these fees into it.", dial: "Set to 5,000 ppm in the platform config (PlatformConfig.creatorFeeRate), the program's cap", note: "Creators receive none of it. The keeper only pays network fees." },
  ],
  totalBps: RAYDIUM_CURVE_BPS + BURNTICKER_DEV_FEE_BPS + BURN_POOL_CURVE_BPS,
};

const pct = (n: number): string => `${Math.round(n * 10_000) / 10_000}%`;
const ppmPct = (ppm: number): string => pct(ppm / 10_000);
const ppmText = (ppm: number): string => ppm.toLocaleString("en-US");

/**
 * After graduation (Raydium CPMM pool on the cluster's tier, cpmmTier.ts): the LP is 100% locked and the Fee Key is owned by the burn
 * program, so the LP's share of the trade fee is split by claim_lock_fees (80% burn pool, 20% operator, fixed in code), and the burn pool
 * also gets Raydium's creator fee less Raydium's share. The operator's line is stated as plainly as the developer's curve slice. The
 * operator leg's recipient is the cluster's record (audit R03: one record, lockFees.ts).
 */
export function postGraduationFeesFor(cluster: string, cpConfig?: string | null): FeeSplit {
  const t = tierFor(cluster, cpConfig), b = postGraduationBpsFor(cluster, cpConfig);
  const lpShare = ppmPct(1_000_000 - t.protocolFeeRate - t.fundFeeRate);
  const creatorShareText = t.creatorFeeShareRate > 0 ? `, plus ${ppmPct(t.creatorFeeShareRate)} of the creator fee when that fee is collected` : "";
  return {
    phase: "post-graduation",
    legs: [
      { label: "Raydium protocol", bps: b.raydiumTotal, recipient: `Raydium. It takes ${pct(b.protocol / 100)} and ${pct(b.fund / 100)} of each trade${creatorShareText}.`, dial: `AmmConfig.protocolFeeRate ${ppmPct(t.protocolFeeRate)} + fundFeeRate ${ppmPct(t.fundFeeRate)} of the ${b.tradeFee} bps trade fee; creatorFeeShareRate ${ppmPct(t.creatorFeeShareRate)} of the ${b.creatorFee} bps creator fee`, note: "fixed per tier" },
      { label: "Burnticker (operator, LP fees)", bps: b.lpToOperator, recipient: operatorTreasuryRecord(cluster).text, dial: `${lpShare} of the ${b.tradeFee} bps trade fee × LOCK_FEE_OPERATOR_BPS ${ppmText(LOCK_FEE_OPERATOR_BPS)} — compiled into the program; no admin key, no config field`, note: "owner decision 2026-10-10: 20% of the locked pool's liquidity fees" },
      { label: "burn pool", bps: b.creatorToBurnPool, recipient: "This coin's burn pool. The pool lists the burn pool as its creator, copied from LaunchLab at graduation, so anyone can collect this fee into it (collect_creator_fee_permissionless).", dial: `AmmConfig.creatorFeeRate = ${ppmText(t.creatorFeeRate)} ppm (${b.creatorFee} bps) × (1 − ${ppmPct(t.creatorFeeShareRate)}) — fixed per tier (AmmConfig index ${t.index}); no platform dial changes it`, note: "" },
      { label: "burn pool (LP fees)", bps: b.lpToBurnPool, recipient: "This coin's burn pool gets 80% of the SOL fees from the locked liquidity, through the open claim step (claim_lock_fees). The burn program owns the Fee Key. The coin side of those fees is burned outright.", dial: `${lpShare} of the ${b.tradeFee} bps trade fee × LOCK_FEE_BURN_BPS ${ppmText(LOCK_FEE_BURN_BPS)} — compiled into the program`, note: "LP locked forever (owner decision 2026-10-10)" },
    ],
    totalBps: b.tradersPay,
  };
}
/** The mainnet split for new coins (what the generic pages state; a coin's page passes its pin, the trust page the live platform's tier). */
export const POST_GRADUATION_FEES: FeeSplit = postGraduationFeesFor("mainnet");

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
/**
 * The operator's post-graduation share, led by the whole swap (the owner, 2026-10-12: "it's showing I'm getting 20%"). The 20% is of the
 * locked pool's liquidity fees only; feeShareLine.ts states it that way, from the designed split.
 */
export const OPERATOR_SHARE_LINE = postGraduationShareLine(POST_GRADUATION_FEES);
/** The fee disclosure in one line, the footer's DEV FEE row on every page (site-polish-2); USE_OF_FEES below is it plus the use. */
/**
 * Private review 9 (editorial): the footer's fee sentence, qualified by venue. The curve fee is the same on both venues; after graduation a
 * LaunchLab coin's pool and a pair-curve coin's pool split each swap differently (a pair's pool has no creator fee for the burn pool), so
 * the shares are said per venue. One function: `venue` null (the footer, the whitepaper, the static pages) says both.
 */
export function devFeeLineFor(venue: "launchlab" | "pair-curve" | null = null): string {
  const curve = `Burnticker takes ${BURNTICKER_DEV_FEE_BPS / 100}% of curve volume.`;
  if (venue === "launchlab") return `${curve} ${OPERATOR_SHARE_LINE} ${EARLIER_COINS_LINE}`;
  if (venue === "pair-curve") return `${curve} ${PAIR_OPERATOR_SHARE_LINE}`;
  // HS-26 (hourly run 5): the footer line leads with the split every live coin pays; this constant cannot read the registry, so it leaves
  // "(every coin live today)" out (SiteFooter and the trust page pass the live answer)
  return footerFeeLine(BURNTICKER_DEV_FEE_BPS, { tier14Live: null });
}
export const DEV_FEE_LINE = devFeeLineFor(null);
/**
 * Ninth pass B-26 / HS-95 (AP9-1): "never trade any coin" was false twice over (the $SEAWIN test, and the disclosed wallet owns a bot that
 * trades other memecoins). This module is in the SDK's closure and cannot read config, so the owner's reason for the $SEAWIN test is added
 * where the paragraph is shown (operatorCreators.ts feesUseWithReasons: the trust answers and the coin pages).
 */
export const USE_OF_FEES = `${DEV_FEE_LINE} The operator's part of the liquidity fees is fixed in code, and the coin side of those fees is burned. This income pays for the reading signers, hosting, the security reviews and bounty, and the operator. The operator's wallets never trade a coin launched here, apart from the two disclosed tests on the test-coins page. The only buybacks are each coin's program-run burn-pool purchases, and everything those purchases get is burned.`;
/**
 * The attester line on the trust page (review 2 §2, 2026-10-11): the present fact, not a schedule — Switchboard ended its services and no
 * independent second attester exists. `dueBy` (14 days after the first launch) stays as the owner's internal check-in date only.
 */
export const ATTESTER_STATUS_LINE = "One operator attester is configured; no independent second attester is live.";
/**
 * HB-69 / HS-20 (sixth pass): what the second signer on its own host really does today (attesters/cosign.ts askCosigner and
 * cosignSigner.ts). At quorum 1 its signature is not needed, so it is advisory: a disagreement holds the reading, while "cannot check"
 * or no answer sends the reading on the keeper key alone. Its signer refuses rivalry-pair coins and pair results.
 */
export const SECOND_SIGNER_LINE = "A second signer runs on another host. It is shown each reading before it is sent, and a reading it disagrees with is held. At quorum 1 it is advisory: when it cannot check a reading, or cannot be reached, the reading is sent on the operator's keeper key alone. It does not check pair coins.";
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

/** One sentence for the review step and the token page (pass the coin's pinned AmmConfig). States the split; says nothing about price. */
/**
 * Continuous audit run 4, HB-50: a coin whose pinned tier was not read (a draft or expired row, a failed chain read) never borrows the tier
 * new coins get; its pages say the tier could not be read.
 */
export const TIER_UNREAD_LINE = "This coin's pool fee tier could not be read, so its split after graduation is not shown here.";
/**
 * Hourly run 6 HB-56: the lock sentence follows the coin's own state. `graduated` false (no locked percentage read yet) says the liquidity
 * locks at graduation; true, or left out (the launch review describes the design, not a coin), says it as the rule.
 */
const lpLockedClause = (graduated: boolean | undefined): string => graduated === false
  ? `${LP_LOCKED_PCT}% of the liquidity locks forever at graduation, and its fees fund the burn.`
  : `${LP_LOCKED_PCT}% of the liquidity is locked forever, and its fees fund the burn.`;
export function feeSplitSentence(cluster = "mainnet", cpConfig?: string | null, o: { tierUnread?: boolean; graduated?: boolean } = {}): string {
  const c = CURVE_FEES.legs;
  const to = (label: string) => (label === "burn pool" ? "the burn pool" : label === "Raydium protocol" ? "Raydium" : label);
  const legs = c.map((l) => `${bpsPerSol(l.bps)} SOL to ${to(l.label)}`);
  const t = tierFor(cluster, cpConfig), b = postGraduationBpsFor(cluster, cpConfig);
  const creatorLine = t.creatorFeeShareRate > 0
    ? `Most of the burn pool's share, ${bpsPerSol(b.creatorToBurnPool)} SOL per 1 SOL, comes from Raydium's fixed CPMM creator fee of ${bpsPerSol(b.creatorFee)} SOL per 1 SOL, after Raydium's ${ppmPct(t.creatorFeeShareRate)} share.`
    : `Of the burn pool's share, ${bpsPerSol(b.creatorToBurnPool)} SOL per 1 SOL comes from Raydium's fixed CPMM creator fee.`;
  if (o.tierUnread) return `On every 1 SOL traded on the curve, ${legs.slice(0, -1).join(", ")} and ${legs[legs.length - 1]} (${CURVE_FEES.totalBps / 100}% in all). ${TIER_UNREAD_LINE} ${lpLockedClause(o.graduated)} The human creator receives no cash from fees, and the keeper only pays network fees.`;
  return `On every 1 SOL traded on the curve, ${legs.slice(0, -1).join(", ")} and ${legs[legs.length - 1]} (${CURVE_FEES.totalBps / 100}% in all). ${postGraduationShareLine(postGraduationFeesFor(cluster, cpConfig))} In all, each trade in the Raydium pool pays ${b.tradersPay / 100}% in fees. ${lpLockedClause(o.graduated)} The operator's part of those liquidity fees is fixed in code, and the coin side of them is burned. ${creatorLine} The coin's creator on LaunchLab is the burn program's fee account, so the creator-fee slot can only pay the burn pool. The human creator receives no cash from fees, and the keeper only pays network fees.`;
}

/** The platform-config dials these constants translate to (what scripts/burnticker-platform-config.mts builds). */
export const PLATFORM_DIALS = { feeRatePpm: BigInt(BURNTICKER_DEV_FEE_BPS * 100), creatorFeeRatePpm: BigInt(BURN_POOL_CURVE_BPS * 100), platformScalePpm: PLATFORM_SCALE_PPM, creatorScalePpm: BigInt(0), burnScalePpm: PPM - PLATFORM_SCALE_PPM, lockNftWallet: "the burn program's fee-keys PDA [\"fee_keys\"]", cpmmTierIndex: CPMM_TIER_INDEX } as const;

export interface LiveVsDesigned { field: string; designed: string; live: string; matches: boolean }

/** The LIVE platform config decoded from chain, compared field by field with the design (the trust page's table). */
export function compareLivePlatform(p: PlatformView, devWallet: string | null, burnProgramId: string | null = null, cluster = "mainnet"): LiveVsDesigned[] {
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
    platformTierRow(p.cpConfigId.toBase58(), cluster),
  ];
}

/**
 * The trust row for the tier new coins get (owner decision 2026-10-19). The LIVE platform's cpConfigId is the truth for new coins; it
 * matches only when it is a tier new coins may be created on (CPMM_PLATFORM_TIERS: tier 14 on mainnet since 2026-10-19; tier 9 is
 * flagged now that the platform update is done). A coin keeps the tier it pinned at
 * initialize_token, and its page reads that pin, so this row speaks only for coins created from now on.
 */
export function platformTierRow(liveCpConfigId: string, cluster = "mainnet"): LiveVsDesigned {
  const accepted = CPMM_PLATFORM_TIERS[clusterOf(cluster)], target = accepted[0];
  const designed = accepted.length > 1 ? `${cpmmTierLabel(target.id)}; ${accepted.slice(1).map((t) => cpmmTierLabel(t.id)).join(", ")} until the platform is updated` : cpmmTierLabel(target.id);
  return { field: "Raydium pool fee tier for new coins (cpConfigId)", designed, live: cpmmTierLabel(liveCpConfigId), matches: newCoinTierAccepted(clusterOf(cluster), liveCpConfigId) };
}

/** The tier the live platform gives new coins, when it is a listed tier (null: unlisted or not read). */
export const liveNewCoinTier = (liveCpConfigId: string | null | undefined) => (liveCpConfigId ? cpmmTierOf(liveCpConfigId) : null);

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
