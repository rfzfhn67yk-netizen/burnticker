// Re-check R3-3 — the LAUNCH GATE on the LaunchLab platform pins. initialize_token pins the platform, its cpConfigId and its LP
// lock/burn scales (and refuses a platformCpCreator other than default / the fee PDA), but the platform's admin is an untimelocked key
// (D-3) that can change those fields AFTER initialize_token and BEFORE migration; a changed platformCpCreator or lower scales would
// strand the token beyond either registration policy; and (LAUNCHPAD-PATH §35, policy 0) a changed platformLockNftWallet or scales would
// send the Fee Key, and so the LP fees, outside the program. So immediately before LaunchLab's create the launcher re-reads the platform and
// refuses on any difference (`scripts/burnreceipts-admin.mts verify-platform-pins --mint …`, README §5 "Launch gate: platform pins").
import { type Connection, PublicKey } from "@solana/web3.js";
import { fetchTokenConfig } from "@/lib/burnReceipts/accounts";
import { type Cluster, LAUNCHLAB_PROGRAM_ID, LL_PLATFORM_CP_CONFIG_ID, LL_PLATFORM_CP_CREATOR, LL_PLATFORM_LOCK_NFT_WALLET, LL_PLATFORM_SCALES, REQUIRED_LL_PLATFORM_SCALES_PPM } from "@/lib/burnReceipts/constants";
import { feeKeysPda, feePda } from "@/lib/burnReceipts/pda";

/** initialize_token reads the platform only up to platformCpCreator (byte 800 + 32). */
const LL_PLATFORM_MIN_LEN = LL_PLATFORM_CP_CREATOR + 32;

export interface PlatformPinsPinned {
  platform: PublicKey; cpConfig: PublicKey; lockScalePpm: bigint; feePda: PublicKey;
  /** LAUNCHPAD-PATH §35 (policy 0): the FEE_KEYS PDA the platform's platformLockNftWallet must name, with scales exactly [1e6, 0, 0]. */
  feeKeys?: PublicKey;
}
export interface PlatformPinsCurrent { owner: string | null; cpConfig: string | null; platformCpCreator: string | null; scalesPpm: [string, string, string] | null; lockScalePpm: string | null; lockNftWallet: string | null }
export interface PlatformPinsResult { ok: boolean; mismatches: string[]; pinned: { platform: string; cpConfig: string; lockScalePpm: string; platformCpCreatorAllowed: string[]; lockNftWallet: string | null }; current: PlatformPinsCurrent }

/** Pure comparison of a LaunchLab PlatformConfig account (owner + data, or null when missing) with the values pinned on the TokenConfig. */
export function checkPlatformPins(account: { owner: PublicKey; data: Uint8Array } | null, pinned: PlatformPinsPinned, cluster: Cluster): PlatformPinsResult {
  const mismatches: string[] = [];
  const out: PlatformPinsResult = {
    ok: false,
    mismatches,
    pinned: { platform: pinned.platform.toBase58(), cpConfig: pinned.cpConfig.toBase58(), lockScalePpm: pinned.lockScalePpm.toString(), platformCpCreatorAllowed: [PublicKey.default.toBase58(), pinned.feePda.toBase58()], lockNftWallet: pinned.feeKeys?.toBase58() ?? null },
    current: { owner: account ? account.owner.toBase58() : null, cpConfig: null, platformCpCreator: null, scalesPpm: null, lockScalePpm: null, lockNftWallet: null },
  };
  if (pinned.platform.equals(PublicKey.default)) {
    mismatches.push("no LaunchLab platform is pinned on this TokenConfig (vault mode or a fixed pool): nothing to launch through LaunchLab against");
    return out;
  }
  if (!account) { mismatches.push(`the pinned platform ${pinned.platform.toBase58()} does not exist`); return out; }
  if (!account.owner.equals(LAUNCHLAB_PROGRAM_ID[cluster])) mismatches.push(`the platform account is owned by ${account.owner.toBase58()}, not LaunchLab (${LAUNCHLAB_PROGRAM_ID[cluster].toBase58()})`);
  if (account.data.length < LL_PLATFORM_MIN_LEN) { mismatches.push(`the platform account is ${account.data.length} bytes (< ${LL_PLATFORM_MIN_LEN})`); return out; }
  const d = Buffer.from(account.data);
  const cpConfig = new PublicKey(d.subarray(LL_PLATFORM_CP_CONFIG_ID, LL_PLATFORM_CP_CONFIG_ID + 32));
  const creator = new PublicKey(d.subarray(LL_PLATFORM_CP_CREATOR, LL_PLATFORM_CP_CREATOR + 32));
  const scales = [0, 1, 2].map((i) => d.readBigUInt64LE(LL_PLATFORM_SCALES + 8 * i)) as [bigint, bigint, bigint];
  const sum = scales[0] + scales[1] + scales[2];
  const nftWallet = new PublicKey(d.subarray(LL_PLATFORM_LOCK_NFT_WALLET, LL_PLATFORM_LOCK_NFT_WALLET + 32));
  out.current = { owner: account.owner.toBase58(), cpConfig: cpConfig.toBase58(), platformCpCreator: creator.toBase58(), scalesPpm: scales.map(String) as [string, string, string], lockScalePpm: sum.toString(), lockNftWallet: nftWallet.toBase58() };
  if (pinned.feeKeys) {
    // LAUNCHPAD-PATH §35: every migrated LP token locked, the Fee Key to burn_receipts' FEE_KEYS PDA (claim_lock_fees splits its fees).
    if (!nftWallet.equals(pinned.feeKeys)) mismatches.push(`platformLockNftWallet is ${nftWallet.toBase58()}, not burn_receipts' FEE_KEYS PDA ${pinned.feeKeys.toBase58()} (the Fee Key would land outside the program)`);
    if (scales.some((v, i) => v !== REQUIRED_LL_PLATFORM_SCALES_PPM[i])) mismatches.push(`LP scales are ${scales.join("/")} ppm (platform/creator/burn), required 1000000/0/0 (all migrated LP locked to the platform's Fee Key)`);
  }
  if (!creator.equals(PublicKey.default) && !creator.equals(pinned.feePda)) mismatches.push(`platformCpCreator is ${creator.toBase58()} — neither default nor the fee PDA ${pinned.feePda.toBase58()} (the migrated pool would fail both registration policies)`);
  if (sum !== pinned.lockScalePpm) mismatches.push(`LP lock+burn scales sum to ${sum} ppm, pinned ${pinned.lockScalePpm} ppm`);
  if (!cpConfig.equals(pinned.cpConfig)) mismatches.push(`cpConfigId is ${cpConfig.toBase58()}, pinned ${pinned.cpConfig.toBase58()} (register_pool would refuse the migration pool)`);
  out.ok = mismatches.length === 0;
  return out;
}

/** Reads the TokenConfig's pins and the LaunchLab platform account now; `ok` only when every pinned value still holds. */
export async function verifyPlatformPins(connection: Connection, programId: PublicKey, mint: PublicKey, cluster: Cluster): Promise<PlatformPinsResult> {
  const cfg = await fetchTokenConfig(connection, programId, mint);
  if (!cfg) throw new Error(`no burn_receipts TokenConfig for mint ${mint.toBase58()} (initialize_token comes first)`);
  const c = cfg.config;
  const pinned: PlatformPinsPinned = { platform: c.ll_platform, cpConfig: c.ll_cp_config, lockScalePpm: BigInt(c.ll_lock_scale_ppm), feePda: feePda(programId, mint), feeKeys: c.registration_policy === 0 ? feeKeysPda(programId) : undefined };
  const info = pinned.platform.equals(PublicKey.default) ? null : await connection.getAccountInfo(pinned.platform, "confirmed");
  return checkPlatformPins(info ? { owner: info.owner, data: info.data } : null, pinned, cluster);
}
