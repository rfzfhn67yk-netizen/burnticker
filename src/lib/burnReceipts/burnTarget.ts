import { type Connection, PublicKey, SystemProgram, type TransactionInstruction } from "@solana/web3.js";
import { type Cluster, CPMM_PROGRAM_ID, MAX_SPEND_RESERVE_BPS, MEMO_PROGRAM_ID, NATIVE_MINT, TOKEN_PROGRAM_ID } from "@/lib/burnReceipts/constants";
import { type BuybackPoolAccounts, type CpmmPool, decodeCpmmPool } from "@/lib/burnReceipts/cpmm";
import { BURN_RECEIPTS_IDL } from "@/lib/burnReceipts/idl";
import { decodeAccount } from "@/lib/burnReceipts/idlCoder";
import { buildIx } from "@/lib/burnReceipts/instructions";
import { buybackMinOut, minAmountOut, reserveSpendCap } from "@/lib/burnReceipts/math";
import { associatedTokenAddress, configPda, cpmmAuthority, feePda, feeTokenAddress, feeWsolAddress, pairLinkPda, pairResultPda, readingPda } from "@/lib/burnReceipts/pda";

/**
 * ROUND 5 (owner, 2026-10-13): A COIN THAT BURNS ANOTHER TOKEN — the client half of programs/burn-receipts/.../instructions/burn_target.rs
 * (docs/burnticker/EXTERNAL-BURN.md). A coin pins a BURN TARGET before it exists (pin_burn_target, mint-signed, while the coin's mint
 * account is still empty): a plain SPL token, its Pyth feed, and ONE pool against WSOL — a Raydium CPMM pool or a Raydium AMM v4 pool
 * (swap-only). Its cranks (crank_target_burn) swap the burn pool's SOL for the target on that pinned pool and burn it; crank_buyback
 * refuses such a coin. The price guard is Pyth's target/SOL ratio for both pool kinds (and a CPMM pool's own TWAP as well).
 *
 * Everything here mirrors the program exactly: the admission checks (so the launch review can refuse what the program would refuse,
 * read from chain), the Pyth check, the per-crank cap (2 % of the pinned pool's SOL reserve), the minimum output, the account lists.
 */

/** TokenConfig.burn_target_kind (the byte that was `reserved`; 0 on every config created before round 5). */
export const BURN_TARGET_SELF = 0;
export const BURN_TARGET_EXTERNAL = 1;
/** BurnTarget.pool_kind. */
export const TARGET_POOL_CPMM = 0;
export const TARGET_POOL_AMM_V4 = 1;
export const SEED_BURN_TARGET = Buffer.from("burn_target", "utf8");
/** A target pool's fee (CPMM: trade fee + the creator fee when charged; AMM v4: the swap fee), ppm of volume: at most 1 %. */
export const TARGET_MAX_FEE_PPM = 10_000;
/** The target pool's SOL floor (its WSOL reserve net of owed fees / PnL), per program build: 50 SOL on mainnet / localnet, 2 SOL on devnet. */
export const TARGET_MIN_WSOL_RESERVE_LAMPORTS: Record<Cluster, bigint> = { mainnet: BigInt(50_000_000_000), devnet: BigInt(2_000_000_000), localnet: BigInt(50_000_000_000) };
/** Raydium AMM v4, per cluster (the program's AMM_V4_PROGRAM_ID). */
export const AMM_V4_PROGRAM_ID: Record<Cluster, PublicKey> = {
  mainnet: new PublicKey("675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8"), localnet: new PublicKey("675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8"), devnet: new PublicKey("DRaya7Kj3aMWQSy19kSjvmuwq9docCHofyP9kanQGaav"),
};
/** Pyth: the receiver program that owns every PriceUpdateV2 account, the push-oracle program of the sponsored feeds, the SOL/USD feed. */
export const PYTH_RECEIVER_PROGRAM_ID = new PublicKey("rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ");
export const PYTH_PUSH_ORACLE_PROGRAM_ID = new PublicKey("pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT");
export const PYTH_SOL_USD_FEED_ID = "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";
export const PYTH_MAX_AGE_SECS = 60;
export const PYTH_MAX_CONF_BPS = 100;
export const PRICE_UPDATE_V2_DISCRIMINATOR = Buffer.from([34, 241, 35, 99, 157, 126, 244, 205]);
/**
 * Refusals that mean "not now": the crank is held (the SOL stays), the keeper alerts and retries; 30 days after the reading the program
 * processes it below-floor with its spend carried.
 */
export const TARGET_POOL_HELD_ERRORS = new Set(["TargetPoolUnhealthy", "TargetPoolBelowFloor", "TargetFeeTier", "PythStale", "PythUnusable", "TargetPriceDeviation"]);

/** BurnTarget ["burn_target", mint]. */
export const burnTargetPda = (programId: PublicKey, mint: PublicKey): PublicKey => PublicKey.findProgramAddressSync([SEED_BURN_TARGET, mint.toBuffer()], programId)[0];

/** Pyth's sponsored (push) price-feed account for a feed id: PDA [shard u16 LE = 0, feed id] under the push oracle (Full verification). */
export const sponsoredPriceAccount = (feedIdHex: string, shard = 0): PublicKey => {
  const s = Buffer.alloc(2);
  s.writeUInt16LE(shard);
  return PublicKey.findProgramAddressSync([s, Buffer.from(feedIdHex, "hex")], PYTH_PUSH_ORACLE_PROGRAM_ID)[0];
};

export interface BurnTargetAccount {
  version: number; bump: number; mint: PublicKey; target_mint: PublicKey; target_decimals: number; pool_kind: number; target_feed_id: Uint8Array;
  pool: PublicKey; amm_config: PublicKey; wsol_vault: PublicKey; target_vault: PublicKey; observation: PublicKey; wsol_is_token_0: boolean;
  pinned_at: bigint; total_target_burned: bigint; total_spent_lamports: bigint; burns: number; repins: number;
  pending_pool: PublicKey; pending_eta: bigint;
}

export const decodeBurnTarget = (data: Buffer | Uint8Array): BurnTargetAccount => decodeAccount<BurnTargetAccount>(BURN_RECEIPTS_IDL, "BurnTarget", data);

export async function fetchBurnTarget(connection: Connection, programId: PublicKey, mint: PublicKey): Promise<{ address: PublicKey; target: BurnTargetAccount } | null> {
  const address = burnTargetPda(programId, mint);
  const info = await connection.getAccountInfo(address, "confirmed");
  if (!info || !info.owner.equals(programId)) return null;
  return { address, target: decodeBurnTarget(info.data) };
}

/** The crank's pool accounts from the PINNED fields — never from whatever pool a caller names. AMM v4: the authority is `amm_config`. */
export const targetPoolAccounts = (t: BurnTargetAccount, cluster: Cluster): BuybackPoolAccounts & { swapProgram: PublicKey } => ({
  pool: t.pool, ammConfig: t.amm_config, cpmmAuthority: t.pool_kind === TARGET_POOL_AMM_V4 ? t.amm_config : cpmmAuthority(CPMM_PROGRAM_ID[cluster]), wsolVault: t.wsol_vault, tokenVault: t.target_vault, observation: t.observation, wsolIsToken0: t.wsol_is_token_0,
  swapProgram: t.pool_kind === TARGET_POOL_AMM_V4 ? AMM_V4_PROGRAM_ID[cluster] : CPMM_PROGRAM_ID[cluster],
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Decoders
// ---------------------------------------------------------------------------------------------------------------------------------

/** SPL Token Mint layout: mint_authority COption @0 (tag u32 + 32), supply @36, decimals @44, is_initialized @45, freeze COption @46. */
export interface SplMintView { mintAuthority: PublicKey | null; supply: bigint; decimals: number; initialized: boolean; freezeAuthority: PublicKey | null }
export function decodeSplMint(data: Buffer | Uint8Array): SplMintView {
  const d = Buffer.from(data);
  if (d.length < 82) throw new Error("not an SPL mint");
  const opt = (at: number) => (d.readUInt32LE(at) === 1 ? new PublicKey(d.subarray(at + 4, at + 36)) : null);
  return { mintAuthority: opt(0), supply: d.readBigUInt64LE(36), decimals: d[44], initialized: d[45] === 1, freezeAuthority: opt(46) };
}

/** AmmConfig: trade_fee_rate @12, creator_fee_rate @108 (the program's AmmConfigView). */
export const AMM_CONFIG_DISCRIMINATOR = Buffer.from([218, 244, 33, 104, 203, 203, 43, 111]);
export function decodeAmmConfigFees(data: Buffer | Uint8Array): { tradeFeeRate: bigint; creatorFeeRate: bigint } {
  const d = Buffer.from(data);
  if (d.length < 236 || !d.subarray(0, 8).equals(AMM_CONFIG_DISCRIMINATOR)) throw new Error("not a CPMM AmmConfig");
  return { tradeFeeRate: d.readBigUInt64LE(12), creatorFeeRate: d.readBigUInt64LE(108) };
}

/** AMM v4 AmmInfo (raydium-amm d26944bf, 752 bytes; the program's src/amm_v4.rs offsets). */
export interface AmmV4View { status: bigint; nonce: number; feeNum: bigint; feeDen: bigint; pnlCoin: bigint; pnlPc: bigint; coinVault: PublicKey; pcVault: PublicKey; coinMint: PublicKey; pcMint: PublicKey }
export function decodeAmmV4(data: Buffer | Uint8Array): AmmV4View {
  const d = Buffer.from(data);
  if (d.length !== 752) throw new Error("not an AMM v4 AmmInfo");
  const u = (o: number) => d.readBigUInt64LE(o);
  const k = (o: number) => new PublicKey(d.subarray(o, o + 32));
  return { status: u(0), nonce: Number(u(8)), feeNum: u(176), feeDen: u(184), pnlCoin: u(192), pnlPc: u(200), coinVault: k(336), pcVault: k(368), coinMint: k(400), pcMint: k(432) };
}
export const ammV4FeePpm = (a: AmmV4View): bigint | null => (a.feeDen === BigInt(0) || a.feeNum >= a.feeDen ? null : (a.feeNum * BigInt(1_000_000) + a.feeDen - BigInt(1)) / a.feeDen);
export const ammV4Authority = (cluster: Cluster, nonce: number): PublicKey | null => {
  try { return PublicKey.createProgramAddressSync([Buffer.from("amm authority", "utf8"), Buffer.from([nonce])], AMM_V4_PROGRAM_ID[cluster]); } catch { return null; }
};

/** A Pyth PriceUpdateV2 (Full verification only, as the program reads it), or why it cannot be used. */
export interface PythPriceView { feedId: string; price: bigint; conf: bigint; exponent: number; publishTime: number; full: boolean }
export function decodePriceUpdateV2(data: Buffer | Uint8Array): PythPriceView {
  const d = Buffer.from(data);
  if (d.length < 101 || !d.subarray(0, 8).equals(PRICE_UPDATE_V2_DISCRIMINATOR)) throw new Error("not a Pyth PriceUpdateV2");
  const full = d[40] === 1;
  const m = full ? 41 : 42;
  return { feedId: d.subarray(m, m + 32).toString("hex"), price: d.readBigInt64LE(m + 32), conf: d.readBigUInt64LE(m + 40), exponent: d.readInt32LE(m + 48), publishTime: Number(d.readBigInt64LE(m + 52)), full };
}
/** The program's pyth::sol_price_x32: target raw per lamport × 2^32, or null. */
export function pythSolPriceX32(sol: PythPriceView, target: PythPriceView, targetDecimals: number): bigint | null {
  if (sol.price <= BigInt(0) || target.price <= BigInt(0)) return null;
  let num = sol.price << BigInt(32);
  let den = target.price;
  const e = sol.exponent - target.exponent + targetDecimals - 9;
  if (e < -30 || e > 30) return null;
  const p = BigInt(10) ** BigInt(Math.abs(e));
  if (e >= 0) num *= p; else den *= p;
  const r = num / den;
  return r === BigInt(0) ? null : r;
}
export const pythWithin = (spot: bigint, ref: bigint, maxDevBps: number): boolean => (spot > ref ? spot - ref : ref - spot) * BigInt(10_000) <= ref * BigInt(maxDevBps);

// ---------------------------------------------------------------------------------------------------------------------------------
// Admission (the program's admit_target_mint + admit_target_pool + the Pyth check, read from chain)
// ---------------------------------------------------------------------------------------------------------------------------------

/** What the pin would record, and every reason the program would refuse it (in plain words, empty when admissible). */
export interface TargetAdmission {
  ok: boolean;
  problems: string[];
  targetMint: PublicKey;
  pool: PublicKey;
  /** TARGET_POOL_CPMM / TARGET_POOL_AMM_V4 (null when the pool is neither). */
  poolKind: number | null;
  decimals: number | null;
  /** CPMM: the AmmConfig; AMM v4: the vault authority (what the pin passes as target_amm_config). */
  ammConfig: PublicKey | null;
  wsolVault: PublicKey | null;
  targetVault: PublicKey | null;
  observation: PublicKey | null;
  wsolIsToken0: boolean | null;
  /** The pool's SOL reserve net of owed fees / PnL, lamports. */
  wsolReserve: bigint | null;
  tokenReserve: bigint | null;
  /** The pool's fee, ppm of volume. */
  feePpm: bigint | null;
  /** With a feed: the Pyth reference and the pool's spot (raw target per lamport × 2^32). */
  referenceX32: bigint | null;
  spotX32: bigint | null;
}

export interface PythInput { feedId: string; maxDevBps: number; solOwner: PublicKey | null; solData: Uint8Array | null; targetOwner: PublicKey | null; targetData: Uint8Array | null }

/** The pure half of admission (testable without an RPC): every fact the program reads, judged exactly as it judges them. */
export function judgeTargetAdmission(i: {
  coinMint?: PublicKey; targetMint: PublicKey; pool: PublicKey; cluster: Cluster; now: number;
  mintOwner: PublicKey | null; mintData: Uint8Array | null;
  poolOwner: PublicKey | null; poolData: Uint8Array | null;
  ammConfigData: Uint8Array | null; wsolVaultAmount: bigint | null; targetVaultAmount: bigint | null;
  pyth?: PythInput;
}): TargetAdmission {
  const problems: string[] = [];
  const out: TargetAdmission = { ok: false, problems, targetMint: i.targetMint, pool: i.pool, poolKind: null, decimals: null, ammConfig: null, wsolVault: null, targetVault: null, observation: null, wsolIsToken0: null, wsolReserve: null, tokenReserve: null, feePpm: null, referenceX32: null, spotX32: null };
  if (i.coinMint && i.coinMint.equals(i.targetMint)) problems.push("That token is this coin itself; a coin burns itself unless it names another token.");
  if (i.targetMint.equals(NATIVE_MINT) || i.targetMint.equals(PublicKey.default)) problems.push("SOL itself cannot be the token a coin burns.");
  if (!i.mintOwner || !i.mintData) problems.push("The token to burn does not exist on this network.");
  else if (!i.mintOwner.equals(TOKEN_PROGRAM_ID)) problems.push("The token to burn must be a classic SPL token; Token-2022 tokens are refused.");
  else {
    try {
      const m = decodeSplMint(i.mintData);
      out.decimals = m.decimals;
      if (!m.initialized) problems.push("The token to burn is not set up.");
      if (m.freezeAuthority) problems.push("The token to burn has a freeze authority, which could freeze the burn account and stop every later burn.");
      if (m.mintAuthority) problems.push("The token to burn can still be minted, so burning it would mean little.");
    } catch { problems.push("That address is not a token mint."); }
  }
  const floorCheck = (vault: bigint | null, owed: bigint) => {
    if (vault === null) { problems.push("The pool's SOL vault cannot be read."); return; }
    out.wsolReserve = vault > owed ? vault - owed : BigInt(0);
    const floor = TARGET_MIN_WSOL_RESERVE_LAMPORTS[i.cluster];
    if (out.wsolReserve < floor) problems.push(`The pool holds less than ${Number(floor / BigInt(1_000_000_000))} SOL, the least such a pool must hold.`);
  };
  const isAmm = !!i.poolOwner && i.poolOwner.equals(AMM_V4_PROGRAM_ID[i.cluster]);
  const isCpmm = !!i.poolOwner && i.poolOwner.equals(CPMM_PROGRAM_ID[i.cluster]);
  if (!i.poolData || (!isAmm && !isCpmm)) problems.push("The pool is not a Raydium CPMM or AMM v4 pool on this network.");
  else if (isAmm) {
    let a: AmmV4View | null = null;
    try { a = decodeAmmV4(i.poolData); } catch { problems.push("The pool is not a Raydium CPMM or AMM v4 pool on this network."); }
    if (a) {
      out.poolKind = TARGET_POOL_AMM_V4;
      const wsolCoin = a.coinMint.equals(NATIVE_MINT) && a.pcMint.equals(i.targetMint) ? true : a.pcMint.equals(NATIVE_MINT) && a.coinMint.equals(i.targetMint) ? false : null;
      if (wsolCoin === null) problems.push("The pool does not pair that token with SOL.");
      if (a.status !== BigInt(6)) problems.push("The pool is not in swap-only mode, the only mode a burn can use.");
      out.feePpm = ammV4FeePpm(a);
      if (out.feePpm === null || out.feePpm > BigInt(TARGET_MAX_FEE_PPM)) problems.push("The pool's fee is above 1%.");
      out.ammConfig = ammV4Authority(i.cluster, a.nonce);
      if (!out.ammConfig) problems.push("The pool's vault authority cannot be derived.");
      out.observation = i.pool;
      if (wsolCoin !== null) {
        out.wsolIsToken0 = wsolCoin;
        out.wsolVault = wsolCoin ? a.coinVault : a.pcVault;
        out.targetVault = wsolCoin ? a.pcVault : a.coinVault;
        const [wp, tp] = wsolCoin ? [a.pnlCoin, a.pnlPc] : [a.pnlPc, a.pnlCoin];
        floorCheck(i.wsolVaultAmount, wp);
        if (i.targetVaultAmount !== null) out.tokenReserve = i.targetVaultAmount > tp ? i.targetVaultAmount - tp : BigInt(0);
      }
    }
  } else {
    let pool: CpmmPool | null = null;
    try { pool = decodeCpmmPool(i.pool, i.poolData); } catch { problems.push("The pool is not a Raydium CPMM or AMM v4 pool on this network."); }
    if (pool) {
      out.poolKind = TARGET_POOL_CPMM;
      const wsol0 = pool.token0Mint.equals(NATIVE_MINT) && pool.token1Mint.equals(i.targetMint) ? true : pool.token1Mint.equals(NATIVE_MINT) && pool.token0Mint.equals(i.targetMint) ? false : null;
      if (wsol0 === null) problems.push("The pool does not pair that token with SOL.");
      if (!pool.token0Program.equals(TOKEN_PROGRAM_ID) || !pool.token1Program.equals(TOKEN_PROGRAM_ID)) problems.push("The pool's tokens must both be classic SPL tokens.");
      const disabled = (pool.status & (1 << 2)) !== 0 || BigInt(Math.max(0, Math.floor(i.now))) < pool.openTime;
      if (disabled) problems.push("Swaps on the pool are switched off right now.");
      out.ammConfig = pool.ammConfig;
      out.observation = pool.observationKey;
      if (wsol0 !== null) {
        out.wsolIsToken0 = wsol0;
        out.wsolVault = wsol0 ? pool.token0Vault : pool.token1Vault;
        out.targetVault = wsol0 ? pool.token1Vault : pool.token0Vault;
        floorCheck(i.wsolVaultAmount, wsol0 ? pool.fees0 : pool.fees1);
        const tokFees = wsol0 ? pool.fees1 : pool.fees0;
        if (i.targetVaultAmount !== null) out.tokenReserve = i.targetVaultAmount > tokFees ? i.targetVaultAmount - tokFees : BigInt(0);
      }
      if (!i.ammConfigData) problems.push("The pool's fee settings cannot be read.");
      else {
        try {
          const f = decodeAmmConfigFees(i.ammConfigData);
          out.feePpm = f.tradeFeeRate + (pool.enableCreatorFee ? f.creatorFeeRate : BigInt(0));
          if (out.feePpm > BigInt(TARGET_MAX_FEE_PPM)) problems.push("The pool's fee is above 1%.");
        } catch { problems.push("The pool's fee settings cannot be read."); }
      }
    }
  }
  if (i.pyth) judgePyth(i.pyth, out, problems, i.now);
  out.ok = problems.length === 0;
  return out;
}

/** The pin's Pyth half: both feeds fresh, tight, fully verified, and the pool's spot within the rule's deviation of the ratio. */
function judgePyth(p: PythInput, out: TargetAdmission, problems: string[], now: number): void {
  if (!/^[0-9a-f]{64}$/.test(p.feedId) || p.feedId === PYTH_SOL_USD_FEED_ID || /^0+$/.test(p.feedId)) { problems.push("The price feed id is not a token's Pyth feed."); return; }
  const read = (owner: PublicKey | null, data: Uint8Array | null, feed: string, what: string): PythPriceView | null => {
    if (!owner || !data || !owner.equals(PYTH_RECEIVER_PROGRAM_ID)) { problems.push(`The ${what} price is not on this network yet.`); return null; }
    let v: PythPriceView;
    try { v = decodePriceUpdateV2(data); } catch { problems.push(`The ${what} price account cannot be read.`); return null; }
    if (!v.full || v.feedId !== feed) { problems.push(`The ${what} price account is not a fully checked update of the right feed.`); return null; }
    if (v.price <= BigInt(0) || v.conf * BigInt(10_000) > v.price * BigInt(PYTH_MAX_CONF_BPS) || v.publishTime > now + PYTH_MAX_AGE_SECS) { problems.push(`The ${what} price is too uncertain to use right now.`); return null; }
    if (now - v.publishTime > PYTH_MAX_AGE_SECS) { problems.push(`The ${what} price is more than a minute old.`); return null; }
    return v;
  };
  const sol = read(p.solOwner, p.solData, PYTH_SOL_USD_FEED_ID, "SOL");
  const tgt = read(p.targetOwner, p.targetData, p.feedId, "token's");
  if (!sol || !tgt || out.decimals === null || out.wsolReserve === null || out.tokenReserve === null || out.wsolReserve === BigInt(0)) return;
  out.referenceX32 = pythSolPriceX32(sol, tgt, out.decimals);
  out.spotX32 = (out.tokenReserve << BigInt(32)) / out.wsolReserve;
  if (out.referenceX32 === null) problems.push("The token's price cannot be compared with SOL.");
  else if (!pythWithin(out.spotX32, out.referenceX32, p.maxDevBps)) problems.push("The pool's price is too far from the token's market price.");
}

const splAmount = (data: Uint8Array | null | undefined): bigint | null => (data && data.length >= 72 ? Buffer.from(data).readBigUInt64LE(64) : null);

/**
 * Reads the target mint, the pool (CPMM or AMM v4), its config / authority and vaults, and (with `feedId`) the two sponsored Pyth feeds
 * from chain and judges them (the launch review and the API route). `maxDevBps` = the rule's max_twap_deviation_bps (default 300).
 */
export async function checkTargetAdmission(connection: Connection, o: { cluster: Cluster; targetMint: PublicKey; pool: PublicKey; coinMint?: PublicKey; now?: number; feedId?: string; maxDevBps?: number }): Promise<TargetAdmission> {
  const [mint, pool] = await connection.getMultipleAccountsInfo([o.targetMint, o.pool], "confirmed");
  let ammConfigData: Uint8Array | null = null;
  let wsolVaultAmount: bigint | null = null;
  let targetVaultAmount: bigint | null = null;
  try {
    if (pool && pool.owner.equals(CPMM_PROGRAM_ID[o.cluster])) {
      const p = decodeCpmmPool(o.pool, pool.data);
      const [cfg, v0, v1] = await connection.getMultipleAccountsInfo([p.ammConfig, p.token0Vault, p.token1Vault], "confirmed");
      ammConfigData = cfg && cfg.owner.equals(CPMM_PROGRAM_ID[o.cluster]) ? cfg.data : null;
      const wsol0 = p.token0Mint.equals(NATIVE_MINT);
      wsolVaultAmount = splAmount((wsol0 ? v0 : v1)?.data);
      targetVaultAmount = splAmount((wsol0 ? v1 : v0)?.data);
    } else if (pool && pool.owner.equals(AMM_V4_PROGRAM_ID[o.cluster])) {
      const a = decodeAmmV4(pool.data);
      const [cv, pv] = await connection.getMultipleAccountsInfo([a.coinVault, a.pcVault], "confirmed");
      const wsolCoin = a.coinMint.equals(NATIVE_MINT);
      wsolVaultAmount = splAmount((wsolCoin ? cv : pv)?.data);
      targetVaultAmount = splAmount((wsolCoin ? pv : cv)?.data);
    }
  } catch { /* judged below */ }
  let pyth: PythInput | undefined;
  if (o.feedId !== undefined) {
    const [s, t] = await connection.getMultipleAccountsInfo([sponsoredPriceAccount(PYTH_SOL_USD_FEED_ID), sponsoredPriceAccount(o.feedId)], "confirmed");
    pyth = { feedId: o.feedId, maxDevBps: o.maxDevBps ?? 300, solOwner: s?.owner ?? null, solData: s?.data ?? null, targetOwner: t?.owner ?? null, targetData: t?.data ?? null };
  }
  return judgeTargetAdmission({
    coinMint: o.coinMint, targetMint: o.targetMint, pool: o.pool, cluster: o.cluster, now: o.now ?? Math.floor(Date.now() / 1000),
    mintOwner: mint?.owner ?? null, mintData: mint?.data ?? null, poolOwner: pool?.owner ?? null, poolData: pool?.data ?? null,
    ammConfigData, wsolVaultAmount, targetVaultAmount, ...(pyth ? { pyth } : {}),
  });
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The crank's quote (what crank_target_burn will spend and the least it accepts)
// ---------------------------------------------------------------------------------------------------------------------------------

export interface TargetQuote { spend: bigint; cap: bigint; capBound: boolean; carried: bigint; expectedOut: bigint; minOut: bigint }

/**
 * The program's arithmetic for one target crank: spend = min(target, 2 % of the pinned pool's SOL reserve, the rule's pool); the rest is
 * carried. `minOut` is the larger of the spot quote and the reference quote (Pyth; for CPMM the program also takes the TWAP quote and
 * keeps the larger) less the pool fee and slippage (0 when the spend is under the floor).
 */
export function quoteTargetCrank(o: { target: bigint; poolBefore: bigint; floor: bigint; wsolReserve: bigint; tokenReserve: bigint; twapX32: bigint; feePpm: bigint; slippageBps: number }): TargetQuote {
  const cap = reserveSpendCap(o.wsolReserve, Number(MAX_SPEND_RESERVE_BPS));
  let spend = o.target < cap ? o.target : cap;
  if (spend > o.poolBefore) spend = o.poolBefore;
  const below = spend === BigInt(0) || spend < o.floor;
  const minOut = below ? BigInt(0) : buybackMinOut(spend, o.wsolReserve, o.tokenReserve, o.twapX32, o.feePpm, o.slippageBps);
  if (below || minOut === BigInt(0)) return { spend: BigInt(0), cap, capBound: false, carried: o.target, expectedOut: BigInt(0), minOut: BigInt(0) };
  return { spend, cap, capBound: spend < o.target, carried: o.target - spend, expectedOut: minAmountOut(spend, o.wsolReserve, o.tokenReserve, o.feePpm, 0), minOut };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Instructions
// ---------------------------------------------------------------------------------------------------------------------------------

const feedBytes = (hex: string): number[] => {
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error("pin_burn_target: the feed id must be 64 hex characters (Pyth's Crypto.<X>/USD id)");
  return [...Buffer.from(hex, "hex")];
};

/**
 * pin_burn_target — signed by the payer and the coin's MINT keypair, while the mint account does not exist yet: after initialize_token
 * (its own transaction: the two together can exceed the packet limit), before LaunchLab's create. `a` is the admitted pool
 * (checkTargetAdmission: its ammConfig = CPMM AmmConfig or AMM v4 authority, and its two vaults). The price accounts default to Pyth's
 * sponsored feeds.
 */
export function pinBurnTargetIx(o: { programId: PublicKey; payer: PublicKey; mint: PublicKey; targetMint: PublicKey; pool: PublicKey; ammConfig: PublicKey; wsolVault: PublicKey; targetVault: PublicKey; feedId: string; solPriceUpdate?: PublicKey; targetPriceUpdate?: PublicKey }): TransactionInstruction {
  return buildIx(o.programId, "pin_burn_target", {
    payer: o.payer, mint: o.mint, config: configPda(o.programId, o.mint), burn_target: burnTargetPda(o.programId, o.mint),
    target_mint: o.targetMint, target_pool: o.pool, target_amm_config: o.ammConfig, target_wsol_vault: o.wsolVault, target_token_vault: o.targetVault,
    sol_price_update: o.solPriceUpdate ?? sponsoredPriceAccount(PYTH_SOL_USD_FEED_ID), target_price_update: o.targetPriceUpdate ?? sponsoredPriceAccount(o.feedId), system_program: SystemProgram.programId,
  }, { target_feed_id: feedBytes(o.feedId) });
}

/** The fee PDA's own account for the target (the swap's output; everything in it is burned). */
export const feeTargetAddress = (programId: PublicKey, mint: PublicKey, targetMint: PublicKey): PublicKey => associatedTokenAddress(feePda(programId, mint), targetMint);

/** crank_target_burn — pool accounts from the BurnTarget (targetPoolAccounts); price accounts default to Pyth's sponsored feeds. */
export function crankTargetBurnIx(o: { programId: PublicKey; cranker: PublicKey; mint: PublicKey; recordDate: number; target: BurnTargetAccount; cluster: Cluster; partner?: PublicKey; solPriceUpdate?: PublicKey; targetPriceUpdate?: PublicKey }): TransactionInstruction {
  const config = configPda(o.programId, o.mint);
  const p = targetPoolAccounts(o.target, o.cluster);
  return buildIx(o.programId, "crank_target_burn", {
    cranker: o.cranker, config, reading: readingPda(o.programId, config, o.recordDate), burn_target: burnTargetPda(o.programId, o.mint), mint: o.mint,
    fee_vault: feePda(o.programId, o.mint), fee_wsol: feeWsolAddress(o.programId, o.mint), fee_tokens: feeTokenAddress(o.programId, o.mint),
    target_mint: o.target.target_mint, target_tokens: feeTargetAddress(o.programId, o.mint, o.target.target_mint), wsol_mint: NATIVE_MINT,
    pool_state: p.pool, amm_config: p.ammConfig, cpmm_authority: p.cpmmAuthority, wsol_vault: p.wsolVault, target_vault: p.tokenVault, observation_state: p.observation,
    swap_program: p.swapProgram, token_program: TOKEN_PROGRAM_ID, system_program: SystemProgram.programId, memo_program: MEMO_PROGRAM_ID,
    sol_price_update: o.solPriceUpdate ?? sponsoredPriceAccount(PYTH_SOL_USD_FEED_ID), target_price_update: o.targetPriceUpdate ?? sponsoredPriceAccount(Buffer.from(o.target.target_feed_id).toString("hex")),
    ...(o.partner ? { pair_link: pairLinkPda(o.programId, o.mint), pair_result: pairResultPda(o.programId, o.mint, o.partner, o.recordDate) } : {}),
  }, { record_date: o.recordDate });
}

export function proposeTargetPoolIx(o: { programId: PublicKey; admin: PublicKey; mint: PublicKey; pool: PublicKey }): TransactionInstruction {
  return buildIx(o.programId, "propose_target_pool", { admin: o.admin, config: configPda(o.programId, o.mint), burn_target: burnTargetPda(o.programId, o.mint) }, { pool: o.pool });
}
export function cancelTargetPoolIx(o: { programId: PublicKey; admin: PublicKey; mint: PublicKey }): TransactionInstruction {
  return buildIx(o.programId, "cancel_target_pool", { admin: o.admin, config: configPda(o.programId, o.mint), burn_target: burnTargetPda(o.programId, o.mint) }, {});
}
export function vetoTargetPoolIx(o: { programId: PublicKey; attester: PublicKey; mint: PublicKey }): TransactionInstruction {
  return buildIx(o.programId, "veto_target_pool", { attester: o.attester, config: configPda(o.programId, o.mint), burn_target: burnTargetPda(o.programId, o.mint) }, {});
}
export function applyTargetPoolIx(o: { programId: PublicKey; caller: PublicKey; mint: PublicKey; targetMint: PublicKey; newPool: PublicKey; newAmmConfig: PublicKey; newWsolVault: PublicKey; newTargetVault: PublicKey; feedId: string; solPriceUpdate?: PublicKey; targetPriceUpdate?: PublicKey }): TransactionInstruction {
  return buildIx(o.programId, "apply_target_pool", {
    caller: o.caller, config: configPda(o.programId, o.mint), burn_target: burnTargetPda(o.programId, o.mint), target_mint: o.targetMint, new_pool: o.newPool, new_amm_config: o.newAmmConfig, new_wsol_vault: o.newWsolVault, new_target_vault: o.newTargetVault,
    sol_price_update: o.solPriceUpdate ?? sponsoredPriceAccount(PYTH_SOL_USD_FEED_ID), target_price_update: o.targetPriceUpdate ?? sponsoredPriceAccount(o.feedId),
  }, {});
}
