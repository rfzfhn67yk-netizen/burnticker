import { PublicKey, type Connection } from "@solana/web3.js";
import { CPMM_PROGRAM_ID, LAUNCHLAB_PROGRAM_ID, LAUNCHLAB_VAULT_AUTH, LL_PLATFORM_CP_CONFIG_ID, LL_POOL_STATUS, LL_POOL_STATUS_MIGRATED, LOCK_CPMM_PROGRAM_ID, NATIVE_MINT, TOKEN_PROGRAM_ID, type Cluster } from "@/lib/burnReceipts/constants";
import { decodeLockedLiquidity } from "@/lib/burnReceipts/accounts";
import { decodeCpmmPool, type CpmmPool } from "@/lib/burnReceipts/cpmm";
import { cpmmPoolPda, feeKeysPda, feePda, launchlabPoolPda, lockedLiquidityPda } from "@/lib/burnReceipts/pda";

/**
 * WHERE A POLICY-0 COIN'S MIGRATION POOL IS (seventh-pass B-17 / HB-167).
 *
 * LaunchLab's migrate_to_cpswap builds the CPMM pool under the platform's cpConfigId AT MIGRATION: its PoolState stores no CPMM
 * config, and of 469 mainnet MigrateToCpswap read on 2026-10-20 (Raydium's migrate wallet RAYpQbFN…, 10-04 to 10-20, 32 platforms)
 * 468 passed the platform's current cpConfigId as cpswap_config; the one other (B3JTdfj5…, 10-16) is a platform that changed its
 * cpConfigId afterwards. A coin
 * created before a platform tier change (all 9 live coins pinned tier 9; the platform names tier 14 since 2026-10-19 20:17Z)
 * therefore graduates into the NEW tier's pool PDA, not the pinned one. The pool is read from the Fee Key's own lock record
 * (findMigrationPool below); the pinned and current-tier PDAs are only a hint, and any pool is accepted only with the fee PDA as creator.
 *
 * burn_receipts accepts the second only from the B-17 build on (register_fee_key / register_pool take the pool's own AmmConfig once
 * LaunchLab reads migrated); the deployed build before that upgrade refuses it with NotMigrationPool.
 */
export function migrationPoolCandidates(cluster: Cluster, pinnedCpConfig: PublicKey, platformCpConfig: PublicKey | null, mint: PublicKey): PublicKey[] {
  const out: PublicKey[] = [];
  for (const cfg of [pinnedCpConfig, platformCpConfig]) {
    if (!cfg || cfg.equals(PublicKey.default)) continue;
    const pool = cpmmPoolPda(CPMM_PROGRAM_ID[cluster], cfg, NATIVE_MINT, mint);
    if (!out.some((p) => p.equals(pool))) out.push(pool);
  }
  return out;
}

/** The LaunchLab PlatformConfig's current cpConfigId (owner-checked), or null when the account is missing or not LaunchLab's. */
export async function readPlatformCpConfig(connection: Connection, cluster: Cluster, platform: PublicKey): Promise<PublicKey | null> {
  if (platform.equals(PublicKey.default)) return null;
  const a = await connection.getAccountInfo(platform, "confirmed");
  if (!a || !a.owner.equals(LAUNCHLAB_PROGRAM_ID[cluster]) || a.data.length < LL_PLATFORM_CP_CONFIG_ID + 32) return null;
  return new PublicKey(a.data.subarray(LL_PLATFORM_CP_CONFIG_ID, LL_PLATFORM_CP_CONFIG_ID + 32));
}

/**
 * Is this CPMM account a pool LaunchLab could have migrated this coin into? Owned by CPMM, a PoolState, WSOL/mint, at the PDA of its
 * OWN AmmConfig (not a random keypair), and pool_creator = the burn program's fee PDA for the coin (register_pool.rs:86). A plain CPMM
 * initialize by anyone holding some of the coin records the SIGNER as creator, so a squatter pool at the pinned tier's address fails
 * here (seventh-pass B-17 follow-up: the old lookup took the first CPMM-owned candidate and would have picked the squatter).
 */
export function verifiedMigrationPool(cluster: Cluster, programId: PublicKey, mint: PublicKey, address: PublicKey, acc: { owner: PublicKey; data: Buffer | Uint8Array } | null): CpmmPool | null {
  if (!acc || !acc.owner.equals(CPMM_PROGRAM_ID[cluster])) return null;
  let pool: CpmmPool;
  try { pool = decodeCpmmPool(address, acc.data); } catch { return null; }
  const pair = (pool.token0Mint.equals(NATIVE_MINT) && pool.token1Mint.equals(mint)) || (pool.token1Mint.equals(NATIVE_MINT) && pool.token0Mint.equals(mint));
  if (!pair) return null;
  if (!address.equals(cpmmPoolPda(CPMM_PROGRAM_ID[cluster], pool.ammConfig, NATIVE_MINT, mint))) return null;
  if (!pool.poolCreator.equals(feePda(programId, mint))) return null;
  return pool;
}

export type MigrationPoolLookup =
  /** via "fee-key": a lock position (locker = LaunchLab's vault authority) whose Fee Key the fee-keys PDA holds names this pool. */
  | { status: "found"; via: "fee-key"; pool: PublicKey; feeNftMint: PublicKey; lockedLiquidity: PublicKey; lockedLp: bigint; locker: PublicKey }
  /** via "candidate": a verified migration pool at a candidate address, but no Fee Key for it at the fee-keys PDA (the keeper alarms). */
  | { status: "found"; via: "candidate"; pool: PublicKey; feeNftMint: null }
  | { status: "not-migrated" };

/**
 * The coin's migration pool (policy 0, before register_fee_key / register_pool).
 *
 * 1. THE FEE KEY FIRST. LaunchLab's migration locks the LP with Raydium's LP lock (locker = LaunchLab's vault authority) and the Fee Key
 *    NFT lands at the burn program's fee-keys PDA. Each Fee Key's own LockedCpLiquidityState names its pool, so the pool is read from
 *    there, whatever AmmConfig LaunchLab used (pinned tier, the platform's current tier, or one in between after two tier changes).
 *    The named pool must still pass verifiedMigrationPool. Several matches (should not happen) → the largest locked_lp.
 * 2. THE CANDIDATES ONLY AS A HINT. When no Fee Key names a pool for this coin, the pinned and the platform's current AmmConfig PDAs are
 *    tried, and only a verified one is returned (feeNftMint null: graduated but the Fee Key is not at the fee-keys PDA).
 * 3. Otherwise not migrated yet — never a pool somebody else created at the expected address.
 * 0. FIRST, ONE CHEAP READ: LaunchLab's own pool for the coin (["pool", mint, WSOL], LaunchLab-owned) must read migrated (status 2 at
 *    byte 17; migrate_to_cpswap sets it). Before that nothing has migrated, so the fee-keys scan (every coin's Fee Keys) is not run for
 *    the many coins still on their curve, and a squatter pool can never be taken for a graduation. register_fee_key checks the same
 *    status on chain for a pool off the pinned tier (eighth-pass CH8-4 gap 1).
 */
export async function launchlabMigrated(connection: Connection, cluster: Cluster, mint: PublicKey): Promise<boolean> {
  const a = await connection.getAccountInfo(launchlabPoolPda(LAUNCHLAB_PROGRAM_ID[cluster], mint), "confirmed");
  return !!a && a.owner.equals(LAUNCHLAB_PROGRAM_ID[cluster]) && a.data.length > LL_POOL_STATUS && a.data[LL_POOL_STATUS] === LL_POOL_STATUS_MIGRATED;
}
export async function findMigrationPool(connection: Connection, cluster: Cluster, programId: PublicKey, pin: { ll_cp_config: PublicKey; ll_platform: PublicKey }, mint: PublicKey): Promise<MigrationPoolLookup> {
  if (!(await launchlabMigrated(connection, cluster, mint))) return { status: "not-migrated" };
  const wantLocker = LAUNCHLAB_VAULT_AUTH[cluster];
  const keys = feeKeysPda(programId);
  const held = await connection.getTokenAccountsByOwner(keys, { programId: TOKEN_PROGRAM_ID }, "confirmed");
  const nfts = held.value
    .filter((a) => a.account.data.length >= 72)
    .map((a) => ({ mint: new PublicKey(a.account.data.subarray(0, 32)), amount: Buffer.from(a.account.data).readBigUInt64LE(64) }))
    .filter((x) => x.amount === BigInt(1));
  let best: Extract<MigrationPoolLookup, { via: "fee-key" }> | null = null;
  for (let i = 0; i < nfts.length; i += 100) {
    const batch = nfts.slice(i, i + 100);
    const lockKeys = batch.map((n) => lockedLiquidityPda(cluster, n.mint));
    const locks = await connection.getMultipleAccountsInfo(lockKeys, "confirmed");
    const mine: { nft: PublicKey; lockKey: PublicKey; pool: PublicKey; lockedLp: bigint; locker: PublicKey; lpMint: PublicKey }[] = [];
    for (let j = 0; j < batch.length; j++) {
      const a = locks[j];
      if (!a || !a.owner.equals(LOCK_CPMM_PROGRAM_ID[cluster])) continue;
      let lock;
      try { lock = decodeLockedLiquidity(a.data); } catch { continue; }
      if (!lock.feeNftMint.equals(batch[j].mint) || !lock.locker.equals(wantLocker)) continue;
      mine.push({ nft: batch[j].mint, lockKey: lockKeys[j], pool: lock.pool, lockedLp: lock.lockedLp, locker: lock.locker, lpMint: lock.lpMint });
    }
    if (!mine.length) continue;
    const pools = await connection.getMultipleAccountsInfo(mine.map((m) => m.pool), "confirmed");
    for (let j = 0; j < mine.length; j++) {
      const p = verifiedMigrationPool(cluster, programId, mint, mine[j].pool, pools[j]);
      if (!p || !p.lpMint.equals(mine[j].lpMint)) continue;
      if (!best || mine[j].lockedLp > best.lockedLp) best = { status: "found", via: "fee-key", pool: mine[j].pool, feeNftMint: mine[j].nft, lockedLiquidity: mine[j].lockKey, lockedLp: mine[j].lockedLp, locker: mine[j].locker };
    }
  }
  if (best) return best;
  const platformCp = await readPlatformCpConfig(connection, cluster, pin.ll_platform).catch(() => null);
  const cands = migrationPoolCandidates(cluster, pin.ll_cp_config, platformCp, mint);
  const accs = await connection.getMultipleAccountsInfo(cands, "confirmed");
  for (let i = 0; i < cands.length; i++) if (verifiedMigrationPool(cluster, programId, mint, cands[i], accs[i])) return { status: "found", via: "candidate", pool: cands[i], feeNftMint: null };
  return { status: "not-migrated" };
}
