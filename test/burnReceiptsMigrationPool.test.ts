// SEVENTH-PASS B-17 / HB-167: LaunchLab's migrate_to_cpswap builds a coin's CPMM pool under the platform's cpConfigId AT MIGRATION, so a
// coin that pinned tier 9 at initialize_token graduates into the tier-14 pool PDA once the platform names tier 14. These tests pin: the
// candidate order (pinned first, then the platform's current AmmConfig), dedupe, the lookup picking the pool that exists as a CPMM
// account (now: the Fee Key's lock record first, a candidate only with the fee PDA as creator, never a squatter's pool), the platform read being owner-checked, and the LaunchLab PoolState status offset the program now reads (SDK layout).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey, type Connection } from "@solana/web3.js";
import { LaunchpadPool } from "@raydium-io/raydium-sdk-v2";
import { CPMM_PROGRAM_ID, LAUNCHLAB_PROGRAM_ID, LAUNCHLAB_VAULT_AUTH, LL_PLATFORM_CP_CONFIG_ID, LL_POOL_STATUS, LL_POOL_STATUS_MIGRATED, LOCK_CPMM_PROGRAM_ID, NATIVE_MINT, TOKEN_PROGRAM_ID } from "@/lib/burnReceipts/constants";
import { POOL_STATE_DISCRIMINATOR } from "@/lib/burnReceipts/cpmm";
import { cpmmPoolPda, feeKeysPda, feePda, launchlabPoolPda, lockedLiquidityPda } from "@/lib/burnReceipts/pda";
import { findMigrationPool, migrationPoolCandidates, readPlatformCpConfig, verifiedMigrationPool } from "@/lib/burnReceipts/migrationPool";
import { BURN_RECEIPTS_IDL } from "@/lib/burnReceipts/idl";
import { accountDiscriminator, encodeType } from "@/lib/burnReceipts/idlCoder";
import { operatorAttester } from "@/lib/burnReceipts/instructions";
import { ruleParamsFromKeeperRules } from "@/lib/burnReceipts/math";
import { GENESIS_HASH } from "@/lib/burnReceipts/constants";
import { configPda } from "@/lib/burnReceipts/pda";
import { ChainLockFees } from "@/lib/burnticker/lockFeesChain";
import { CPMM_MAINNET_TIER_9, CPMM_MAINNET_TIER_14 } from "@/lib/burnticker/cpmmTier";

const T9 = new PublicKey(CPMM_MAINNET_TIER_9.id);
const T14 = new PublicKey(CPMM_MAINNET_TIER_14.id);
const PLATFORM = new PublicKey("94x5qDDJP4UCkeMWppnmvqTmMgo971h3d6MDRnjEfYy9");
const DEFICIT = new PublicKey("AJJ4XxCUYr8zzMWm8FYg3xh638LYAAApdNqWBqCK4oqj");
const pda = (cfg: PublicKey, mint = DEFICIT) => cpmmPoolPda(CPMM_PROGRAM_ID.mainnet, cfg, NATIVE_MINT, mint);

type Acc = { owner: PublicKey; data: Buffer; lamports: number; executable: boolean };
function fakeConnection(accounts: Map<string, Acc>): Connection {
  return {
    getAccountInfo: async (k: PublicKey) => accounts.get(k.toBase58()) ?? null,
    getMultipleAccountsInfo: async (ks: PublicKey[]) => ks.map((k) => accounts.get(k.toBase58()) ?? null),
  } as unknown as Connection;
}
function platformAccount(cp: PublicKey, owner = LAUNCHLAB_PROGRAM_ID.mainnet): Acc {
  const data = Buffer.alloc(944);
  cp.toBuffer().copy(data, LL_PLATFORM_CP_CONFIG_ID);
  return { owner, data, lamports: 1, executable: false };
}
const cpmmAccount = (): Acc => ({ owner: CPMM_PROGRAM_ID.mainnet, data: Buffer.alloc(637), lamports: 1, executable: false });

// B-17 follow-up fixtures: CPMM PoolStates (decodeCpmmPool offsets), Raydium lock positions (decodeLockedLiquidity offsets) and the
// fee-keys PDA's token accounts (SPL layout: mint @0, owner @32, amount @64).
const PROGRAM = Keypair.generate().publicKey;
const FEE = feePda(PROGRAM, DEFICIT);
const T12 = Keypair.generate().publicKey;
const PIN = { ll_cp_config: T9, ll_platform: PLATFORM };
function poolAccount(o: { cfg: PublicKey; creator: PublicKey; lpMint?: PublicKey; other?: PublicKey }): Acc {
  const d = Buffer.alloc(637);
  POOL_STATE_DISCRIMINATOR.copy(d, 0);
  o.cfg.toBuffer().copy(d, 8);
  o.creator.toBuffer().copy(d, 40);
  (o.lpMint ?? lpMintOf(o.cfg)).toBuffer().copy(d, 136);
  const [a, b] = [NATIVE_MINT, o.other ?? DEFICIT].sort((x, y) => Buffer.compare(x.toBuffer(), y.toBuffer()));
  a.toBuffer().copy(d, 168); b.toBuffer().copy(d, 200);
  return { owner: CPMM_PROGRAM_ID.mainnet, data: d, lamports: 1, executable: false };
}
const lpMints = new Map<string, PublicKey>();
function lpMintOf(cfg: PublicKey): PublicKey { const k = cfg.toBase58(); if (!lpMints.has(k)) lpMints.set(k, Keypair.generate().publicKey); return lpMints.get(k)!; }
/** A policy-0 TokenConfig pinned to tier 9 on the platform, pool not registered yet (layout as burnReceiptsClient.test.ts). */
function tokenConfigAccount(): Acc {
  const rule = ruleParamsFromKeeperRules(
    { mode: "buyback", decimals: 6, vaultAllocation: "1", buyback: { fractionPerUnit: "0.05", reserveSol: "0.02", slippageBps: 300 }, rule: { unitUsd: "1000000000", burnPerUnitTokens: "100000", maxAbsDeltaUsd: "2000000000000", carry: "consecutive-increases", onNonIncrease: "burn-nothing-reset-carry" } },
    { floorLamports: BigInt(1), maxTwapDeviationBps: 1500, twapWindowSecs: 600 },
  );
  const pad = (t: string, n: number) => { const b = new Uint8Array(n); b.set(Buffer.from(t)); return b; };
  const a1 = Keypair.generate().publicKey;
  const cfg = {
    version: 1, bump: 255, fee_bump: 254, has_baseline: false, mint: DEFICIT, creator: a1, admin: PublicKey.default, rule,
    rules_sha256: new Uint8Array(32), params_hash: new Uint8Array(32),
    feed_id: pad("x", 32), feed_id_len: 1, memo_prefix: pad("X", 12), memo_prefix_len: 1, memo_source: pad("x", 64), memo_source_len: 1,
    attesters: [operatorAttester(a1), ...Array.from({ length: 4 }, () => operatorAttester(PublicKey.default))], attester_count: 1, quorum: 1,
    pending_attesters: Array.from({ length: 5 }, () => operatorAttester(PublicKey.default)), pending_count: 0, pending_quorum: 0, pending_eta: BigInt(0),
    cpmm_pool: PublicKey.default, last_record_date: 0, last_value: BigInt(0), carry: BigInt(0), crank_cursor: 0,
    readings: 0, burns: 0, total_burned: BigInt(0), total_spent_lamports: BigInt(0), shortfall: BigInt(0), created_at: BigInt(0), carried_spend_lamports: BigInt(0), pool_untradeable_since: BigInt(0), pool_untradeable_last_seen: BigInt(0), pool_verified: false, cluster_genesis: new PublicKey(GENESIS_HASH.mainnet), registration_policy: 0, ll_platform: PLATFORM, ll_cp_config: T9, ll_lock_scale_ppm: BigInt(1_000_000), pool_untradeable_candidate_at: BigInt(0), attester_added_at: [BigInt(0), BigInt(0), BigInt(0), BigInt(0), BigInt(0)], pending_policy: 0, pending_policy_pool: PublicKey.default, pending_policy_eta: BigInt(0), pair_state: 0, pair_void_by: 0, pair_after_date: 0, pair_unlinked_at: BigInt(0), end_state: 0, end_date: 0, burn_target_kind: 0,
  };
  const data = Buffer.concat([accountDiscriminator(BURN_RECEIPTS_IDL, "TokenConfig"), encodeType(BURN_RECEIPTS_IDL, { defined: { name: "TokenConfig" } }, cfg)]);
  return { owner: PROGRAM, data, lamports: 1, executable: false };
}
function launchlabPool(status: number): Acc {
  const d = Buffer.alloc(400);
  d[LL_POOL_STATUS] = status;
  return { owner: LAUNCHLAB_PROGRAM_ID.mainnet, data: d, lamports: 1, executable: false };
}
function world() {
  const accounts = new Map<string, Acc>([[PLATFORM.toBase58(), platformAccount(T14)], [configPda(PROGRAM, DEFICIT).toBase58(), tokenConfigAccount()], [launchlabPoolPda(LAUNCHLAB_PROGRAM_ID.mainnet, DEFICIT).toBase58(), launchlabPool(LL_POOL_STATUS_MIGRATED)]]);
  const held: { pubkey: PublicKey; account: Acc }[] = [];
  return {
    /** LaunchLab's pool for the coin reads this status (2 = migrated) */
    curve(status: number) { accounts.set(launchlabPoolPda(LAUNCHLAB_PROGRAM_ID.mainnet, DEFICIT).toBase58(), launchlabPool(status)); },
    realPool(cfg: PublicKey) { accounts.set(pda(cfg).toBase58(), poolAccount({ cfg, creator: FEE })); },
    /** a plain CPMM initialize by a holder of the coin: creator = the signer, at the same deterministic address */
    squatterPool(cfg: PublicKey) { accounts.set(pda(cfg).toBase58(), poolAccount({ cfg, creator: Keypair.generate().publicKey })); },
    feeKey(pool: PublicKey, locker = LAUNCHLAB_VAULT_AUTH.mainnet) {
      const nft = Keypair.generate().publicKey;
      const poolAcc = accounts.get(pool.toBase58());
      const lpMint = poolAcc ? new PublicKey(poolAcc.data.subarray(136, 168)) : Keypair.generate().publicKey;
      const l = Buffer.alloc(256);
      l.writeBigUInt64LE(BigInt(1_000_000), 8);
      pool.toBuffer().copy(l, 64); nft.toBuffer().copy(l, 96); locker.toBuffer().copy(l, 128); lpMint.toBuffer().copy(l, 160);
      accounts.set(lockedLiquidityPda("mainnet", nft).toBase58(), { owner: LOCK_CPMM_PROGRAM_ID.mainnet, data: l, lamports: 1, executable: false });
      const t = Buffer.alloc(165);
      nft.toBuffer().copy(t, 0); feeKeysPda(PROGRAM).toBuffer().copy(t, 32); t.writeBigUInt64LE(BigInt(1), 64);
      held.push({ pubkey: Keypair.generate().publicKey, account: { owner: TOKEN_PROGRAM_ID, data: t, lamports: 1, executable: false } });
      return nft;
    },
    conn(): Connection {
      return {
        getAccountInfo: async (k: PublicKey) => accounts.get(k.toBase58()) ?? null,
        getMultipleAccountsInfo: async (ks: PublicKey[]) => ks.map((k) => accounts.get(k.toBase58()) ?? null),
        getTokenAccountsByOwner: async (owner: PublicKey) => ({ context: { slot: 1 }, value: owner.equals(feeKeysPda(PROGRAM)) ? held : [] }),
      } as unknown as Connection;
    },
  };
}

describe("B-17 migration pool lookup", () => {
  test("candidates: the pinned tier's PDA first, then the platform's current tier; deduped; default skipped", () => {
    assert.deepEqual(migrationPoolCandidates("mainnet", T9, T14, DEFICIT).map(String), [pda(T9), pda(T14)].map(String));
    assert.deepEqual(migrationPoolCandidates("mainnet", T9, T9, DEFICIT).map(String), [pda(T9)].map(String));
    assert.deepEqual(migrationPoolCandidates("mainnet", T9, null, DEFICIT).map(String), [pda(T9)].map(String));
    assert.deepEqual(migrationPoolCandidates("mainnet", T9, PublicKey.default, DEFICIT).map(String), [pda(T9)].map(String));
    assert.notEqual(pda(T9).toBase58(), pda(T14).toBase58(), "a tier change moves the pool PDA");
  });

  test("findMigrationPool: a tier-9 coin LaunchLab migrated under tier 14 is found from its Fee Key's lock record", async () => {
    const w = world();
    w.realPool(T14); w.feeKey(pda(T14));
    const got = await findMigrationPool(w.conn(), "mainnet", PROGRAM, PIN, DEFICIT);
    assert.equal(got.status, "found");
    assert.equal(got.status === "found" && got.via, "fee-key");
    assert.equal(got.status === "found" && got.pool.toBase58(), pda(T14).toBase58());
  });

  test("findMigrationPool: a squatter's pool at the pinned tier-9 address is never chosen; the real tier-14 pool is", async () => {
    const w = world();
    w.squatterPool(T9); w.realPool(T14); w.feeKey(pda(T14));
    const got = await findMigrationPool(w.conn(), "mainnet", PROGRAM, PIN, DEFICIT);
    assert.equal(got.status === "found" && got.pool.toBase58(), pda(T14).toBase58());
    // and with no Fee Key yet the real pool is still found as a candidate (graduated, Fee Key not held → the keeper alarms)
    const w2 = world();
    w2.squatterPool(T9); w2.realPool(T14);
    const got2 = await findMigrationPool(w2.conn(), "mainnet", PROGRAM, PIN, DEFICIT);
    assert.equal(got2.status === "found" && got2.via, "candidate");
    assert.equal(got2.status === "found" && got2.pool.toBase58(), pda(T14).toBase58());
  });

  test("findMigrationPool: no Fee Key and only a squatter pool → not migrated yet, never the squatter", async () => {
    const w = world();
    w.squatterPool(T9);
    assert.deepEqual(await findMigrationPool(w.conn(), "mainnet", PROGRAM, PIN, DEFICIT), { status: "not-migrated" });
    // nothing at all: not migrated
    assert.deepEqual(await findMigrationPool(world().conn(), "mainnet", PROGRAM, PIN, DEFICIT), { status: "not-migrated" });
  });

  test("findMigrationPool: a Fee Key naming a squatter's pool, or locked by someone other than LaunchLab, is ignored", async () => {
    const w = world();
    w.squatterPool(T9); w.feeKey(pda(T9));
    w.realPool(T14); w.feeKey(pda(T14), Keypair.generate().publicKey);
    assert.deepEqual(await findMigrationPool(w.conn(), "mainnet", PROGRAM, PIN, DEFICIT), { status: "found", via: "candidate", pool: pda(T14), feeNftMint: null });
  });

  test("findMigrationPool: the platform changed tier twice (9 → 12 → 14); the tier-12 pool is still found via the Fee Key", async () => {
    const w = world();
    w.realPool(T12); w.feeKey(pda(T12));
    const got = await findMigrationPool(w.conn(), "mainnet", PROGRAM, PIN, DEFICIT);
    assert.equal(got.status === "found" && got.via, "fee-key");
    assert.equal(got.status === "found" && got.pool.toBase58(), pda(T12).toBase58());
    // without the Fee Key the candidate hint (tier 9 and tier 14) cannot see it
    const w2 = world();
    w2.realPool(T12);
    assert.deepEqual(await findMigrationPool(w2.conn(), "mainnet", PROGRAM, PIN, DEFICIT), { status: "not-migrated" });
  });

  test("findMigrationPool: before LaunchLab reads the coin migrated, nothing is a migration pool (and the fee-keys scan is not run)", async () => {
    for (const status of [0, 1]) {
      const w = world();
      w.curve(status); w.realPool(T14); w.feeKey(pda(T14)); w.squatterPool(T9);
      assert.deepEqual(await findMigrationPool(w.conn(), "mainnet", PROGRAM, PIN, DEFICIT), { status: "not-migrated" }, `status ${status}`);
    }
    const w = world();
    w.realPool(T14); w.feeKey(pda(T14));
    let scanned = 0;
    const c = w.conn(), conn = { ...c, getTokenAccountsByOwner: async (...a: unknown[]) => { scanned++; return (c.getTokenAccountsByOwner as (...x: unknown[]) => unknown)(...a); } } as unknown as Connection;
    w.curve(0);
    await findMigrationPool(conn, "mainnet", PROGRAM, PIN, DEFICIT);
    assert.equal(scanned, 0);
    w.curve(LL_POOL_STATUS_MIGRATED);
    assert.equal((await findMigrationPool(conn, "mainnet", PROGRAM, PIN, DEFICIT)).status, "found");
    assert.equal(scanned, 1);
  });

  test("verifiedMigrationPool: owner, pair, own-AmmConfig PDA and creator are all checked", () => {
    const ok = (o: Partial<Parameters<typeof poolAccount>[0]> = {}, at = pda(T14)) => verifiedMigrationPool("mainnet", PROGRAM, DEFICIT, at, poolAccount({ cfg: T14, creator: FEE, ...o }));
    assert.ok(ok());
    assert.equal(ok({ creator: Keypair.generate().publicKey }), null, "creator not the fee PDA");
    assert.equal(ok({}, pda(T9)), null, "address is not the PDA of the pool's own AmmConfig");
    assert.equal(ok({ other: Keypair.generate().publicKey }), null, "not WSOL/mint");
    assert.equal(verifiedMigrationPool("mainnet", PROGRAM, DEFICIT, pda(T14), { ...poolAccount({ cfg: T14, creator: FEE }), owner: Keypair.generate().publicKey }), null, "not CPMM-owned");
    assert.equal(verifiedMigrationPool("mainnet", PROGRAM, DEFICIT, pda(T14), cpmmAccount()), null, "not a PoolState");
  });

  test("ChainLockFees (the keeper's locate): squatter at tier 9, real pool + Fee Key at tier 14 → the tier-14 pool and its Fee Key", async () => {
    const w = world();
    w.squatterPool(T9); w.realPool(T14); const nft = w.feeKey(pda(T14));
    const st = await new ChainLockFees({ connection: w.conn(), programId: PROGRAM, cluster: "mainnet", payer: null }).port(DEFICIT.toBase58()).state({ accrued: false });
    assert.equal(st.graduated, true);
    assert.equal(st.pool, pda(T14).toBase58());
    assert.equal(st.feeKey, nft.toBase58());
    assert.equal(st.feeKeyOwner, feeKeysPda(PROGRAM).toBase58());
    // squatter only, no Fee Key: not graduated (never the squatter)
    const w2 = world();
    w2.squatterPool(T9);
    const st2 = await new ChainLockFees({ connection: w2.conn(), programId: PROGRAM, cluster: "mainnet", payer: null }).port(DEFICIT.toBase58()).state({ accrued: false });
    assert.equal(st2.graduated, false);
    assert.equal(st2.pool, null);
  });

  test("readPlatformCpConfig is owner-checked", async () => {
    const good = new Map<string, Acc>([[PLATFORM.toBase58(), platformAccount(T14)]]);
    assert.equal((await readPlatformCpConfig(fakeConnection(good), "mainnet", PLATFORM))?.toBase58(), T14.toBase58());
    const foreign = new Map<string, Acc>([[PLATFORM.toBase58(), platformAccount(T14, Keypair.generate().publicKey)]]);
    assert.equal(await readPlatformCpConfig(fakeConnection(foreign), "mainnet", PLATFORM), null);
    assert.equal(await readPlatformCpConfig(fakeConnection(new Map()), "mainnet", PLATFORM), null);
  });

  test("the program's LL_POOL_STATUS (17) is the SDK LaunchpadPool status offset; LL_POOL_PLATFORM_ID (173) still matches", () => {
    assert.equal(LaunchpadPool.offsetOf("status"), 17);
    assert.equal(LL_POOL_STATUS, LaunchpadPool.offsetOf("status"), "the client's migrated gate reads the same byte");
    assert.equal(LaunchpadPool.offsetOf("platformId"), 173);
  });
});
