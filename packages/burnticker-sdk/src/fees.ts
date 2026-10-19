import { BURNTICKER_DEV_FEE_BPS, BURN_POOL_CURVE_BPS, CREATOR_FEE_SLICE_BPS, CURVE_FEES, LP_BURNED_PCT, LP_LOCKED_PCT, LOCK_FEE_BURN_BPS, LOCK_FEE_OPERATOR_BPS, LP_FEES_TO_BURN_POOL_BPS, LP_FEES_TO_OPERATOR_BPS, POST_GRADUATION_FEES, PRE_AUDIT_POOL_CAP_SOL, bpsPerSol, feeSplitSentence, postGraduationFeesFor, type FeeSplit } from "@/lib/burnticker/fees";
import { splitLockFees } from "@/lib/burnticker/lockFees";

/**
 * THE FEE SPLIT. The DESIGNED numbers (src/lib/burnticker/fees.ts — the same constants the wizard, the token pages and the
 * platform-config CLI read). The LIVE numbers decoded from the on-chain LaunchLab PlatformConfig come from the API's /trust
 * (`client.trust()`), so a bot can compare the two. Creators receive no cash from fees; the burn pool gets the creator slot, 100%.
 * LP locked forever (2026-10-10): after graduation the locked LP's 21 bps split 16.8 burn pool / 4.2 operator (80/20, compiled);
 * `fees.splitLockFees(lamports)` is the program's exact integer split of one claim (the odd lamport goes to the burn pool).
 */

export interface FeeAmount { label: string; bps: number; recipient: string; lamports: string; sol: string }
export interface SplitResult {
  phase: FeeSplit["phase"]; totalBps: number; legs: FeeSplit["legs"];
  /** Present when `volumeSol` was given: each leg's take of that volume (floored to the lamport). */
  amounts: FeeAmount[] | null;
  sentence: string; creatorSliceBps: 0; lpBurnedPct: number; preAuditPoolCapSol: number;
  /** LP locked forever (since 2026-10-10): 100 % of the graduation LP locked; its fees split by claim_lock_fees, fixed in code. */
  lpLockedPct: number; lpFeeSplit: { burnBps: number; operatorBps: number; toBurnPoolBpsOfVolume: number; toOperatorBpsOfVolume: number };
}

const LAMPORTS = BigInt(1_000_000_000);
const toLamports = (sol: string): bigint => {
  if (!/^\d+(\.\d{1,9})?$/.test(sol)) throw new Error("volumeSol must be a decimal SOL amount with ≤ 9 decimals");
  const [w, f = ""] = sol.split(".");
  return BigInt(w) * LAMPORTS + BigInt((f + "000000000").slice(0, 9));
};
const toSol = (l: bigint): string => { const w = l / LAMPORTS, f = (l % LAMPORTS).toString().padStart(9, "0").replace(/0+$/, ""); return f ? `${w}.${f}` : w.toString(); };

/**
 * The split for a phase ("curve" before graduation, "post-graduation" after), optionally applied to a volume:
 * `split({ volumeSol: "1" })` → every leg's lamports per 1 SOL traded. bps may be fractional (14.5, 47.5): computed in ppm, exact.
 * Post-graduation describes new coins (mainnet CPMM tier 14) unless `cpConfig` names the AmmConfig a coin pinned (its TokenConfig's
 * ll_cp_config; a coin created before the 2026-10-19 tier change keeps tier 9 or tier 0).
 */
export function split(o: { phase?: FeeSplit["phase"]; volumeSol?: string; cpConfig?: string } = {}): SplitResult {
  const s = (o.phase ?? "curve") === "curve" ? CURVE_FEES : o.cpConfig ? postGraduationFeesFor("mainnet", o.cpConfig) : POST_GRADUATION_FEES;
  const vol = o.volumeSol !== undefined ? toLamports(o.volumeSol) : null;
  const amounts = vol === null ? null : s.legs.map((l) => { const lamports = (vol * BigInt(Math.round(l.bps * 100))) / BigInt(1_000_000); return { label: l.label, bps: l.bps, recipient: l.recipient, lamports: lamports.toString(), sol: toSol(lamports) }; });
  return { phase: s.phase, totalBps: s.totalBps, legs: s.legs, amounts, sentence: feeSplitSentence("mainnet", o.cpConfig), creatorSliceBps: CREATOR_FEE_SLICE_BPS, lpBurnedPct: LP_BURNED_PCT, preAuditPoolCapSol: PRE_AUDIT_POOL_CAP_SOL, lpLockedPct: LP_LOCKED_PCT, lpFeeSplit: { burnBps: LOCK_FEE_BURN_BPS, operatorBps: LOCK_FEE_OPERATOR_BPS, toBurnPoolBpsOfVolume: LP_FEES_TO_BURN_POOL_BPS, toOperatorBpsOfVolume: LP_FEES_TO_OPERATOR_BPS } };
}

export const fees = { split, bpsPerSol, splitLockFees, DEV_FEE_BPS: BURNTICKER_DEV_FEE_BPS, BURN_POOL_CURVE_BPS, LP_LOCKED_PCT, LOCK_FEE_BURN_BPS, LOCK_FEE_OPERATOR_BPS, CURVE: CURVE_FEES, POST_GRADUATION: POST_GRADUATION_FEES };
