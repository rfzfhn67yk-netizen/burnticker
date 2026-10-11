import { PublicKey } from "@solana/web3.js";
import { LP_SCALES_PPM, feeKeysPda, operatorTreasuryFor } from "@/lib/burnticker/lockFees";

/**
 * THE LP-LOCK LAUNCH GATE (owner decision 2026-10-10: LP locked forever, its fees fund the burn). Before LaunchLab's create, the
 * launcher re-reads the Burnticker LaunchLab PlatformConfig and refuses unless
 *   platformScale (@80) = 1,000,000, creatorScale (@88) = 0, burnScale (@96) = 0   — 100 % of the graduation LP locked, nothing burned
 *   platformLockNftWallet (@48) = the burn_receipts fee-keys PDA ["fee_keys"]     — the Fee Key NFT is owned by the program
 * (the program's initialize_token and buyback cranks assert the same two pins on chain; this is the client-side copy that names the
 * difference before anything is signed). The operator treasury compiled for the cluster is reported too: on mainnet it is not pinned
 * yet, so claim_lock_fees would refuse TreasuryNotPinned and the LP fees would stay in the lock — a launch-gate PROBLEM until the owner
 * compiles the Squads vault in (docs/burnticker/TODO-OWNER.md). Offsets: the SDK's PlatformConfig layout (8-byte discriminator, epoch,
 * platformClaimFeeWallet @16, platformLockNftWallet @48, platformScale/creatorScale/burnScale @80/88/96).
 */

export const LL_PLATFORM_LOCK_NFT_WALLET = 48;
export const LL_PLATFORM_SCALES_AT = 80;

export interface LpLockPinsResult {
  ok: boolean;
  problems: string[];
  current: { lockNftWallet: string | null; scalesPpm: [string, string, string] | null };
  pinned: { lockNftWallet: string; scalesPpm: [string, string, string]; operatorTreasury: string | null };
}

/** Pure check of a LaunchLab PlatformConfig's data against the LP-lock pins. `requireTreasury` adds the TreasuryNotPinned problem. */
export function checkLpLockPins(data: Uint8Array | null, o: { programId: string | PublicKey; cluster: string; requireTreasury?: boolean }): LpLockPinsResult {
  const want = feeKeysPda(o.programId).toBase58();
  const treasury = operatorTreasuryFor(o.cluster);
  const out: LpLockPinsResult = { ok: false, problems: [], current: { lockNftWallet: null, scalesPpm: null }, pinned: { lockNftWallet: want, scalesPpm: [LP_SCALES_PPM.platform.toString(), LP_SCALES_PPM.creator.toString(), LP_SCALES_PPM.burn.toString()], operatorTreasury: treasury } };
  if (!data) { out.problems.push("the platform config does not exist"); return out; }
  if (data.length < LL_PLATFORM_SCALES_AT + 24) { out.problems.push(`the platform config is ${data.length} bytes (< ${LL_PLATFORM_SCALES_AT + 24})`); return out; }
  const d = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  const wallet = new PublicKey(d.subarray(LL_PLATFORM_LOCK_NFT_WALLET, LL_PLATFORM_LOCK_NFT_WALLET + 32)).toBase58();
  const scales = [0, 1, 2].map((i) => d.readBigUInt64LE(LL_PLATFORM_SCALES_AT + 8 * i)) as [bigint, bigint, bigint];
  out.current = { lockNftWallet: wallet, scalesPpm: scales.map(String) as [string, string, string] };
  if (scales[0] !== LP_SCALES_PPM.platform || scales[1] !== LP_SCALES_PPM.creator || scales[2] !== LP_SCALES_PPM.burn) out.problems.push(`LP scales are platform ${scales[0]} / creator ${scales[1]} / burn ${scales[2]} ppm — the policy is 1,000,000 / 0 / 0 (100 % locked, nothing burned)`);
  if (wallet !== want) out.problems.push(`platformLockNftWallet is ${wallet}, not the burn program's fee-keys PDA ${want} — the Fee Key would not be owned by the program`);
  if (o.requireTreasury && !treasury) out.problems.push(`the operator treasury is not pinned in the ${o.cluster} program build: claim_lock_fees would refuse (TreasuryNotPinned) and the LP fees would stay in the lock — the owner compiles the Squads vault in first (TODO-OWNER)`);
  out.ok = out.problems.length === 0;
  return out;
}
