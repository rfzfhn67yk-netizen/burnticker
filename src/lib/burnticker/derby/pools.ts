import { PublicKey } from "@solana/web3.js";
import { decodeCpmmPool, POOL_STATE_DISCRIMINATOR } from "@/lib/burnReceipts/cpmm";
import { NATIVE_MINT } from "@/lib/burnReceipts/constants";
import { fromScaled } from "@/lib/burnticker/units";

/**
 * THE TWAP FALLBACK (2026-10-10): for a coin with no Pyth feed (e.g. GIGA), its value at a window boundary is the time-weighted average
 * of its deepest SOL pool's spot ratio over the hour before the boundary, read from the pool's two VAULT BALANCES — the same quantity the
 * Receipts program's buyback guard reads — and priced in USD with Pyth SOL/USD at the boundary. Public chain state only, no indexer:
 * the keeper's sampler reads the pool every cycle in that hour and records each sample's slot and both raw balances (derby_samples), so
 * the proof material is the pool address plus every (slot, token vault, SOL vault) used.
 *
 * Pools read:
 *   Raydium CPMM  (CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C)  — decoded by src/lib/burnReceipts/cpmm.ts (the program's own offsets).
 *                 Spot = (SOL vault − SOL-side fees owed) / (token vault − token-side fees owed): the vaults hold accrued protocol, fund and
 *                 creator fees that are not liquidity, and the CPMM swap math excludes them.
 *   PumpSwap      (pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA)   — Anchor `Pool`: base_mint@43, quote_mint@75, pool_base_token_account@139,
 *                 pool_quote_token_account@171, and a signed i128 quote-reserve offset at byte 245 that the program adds to the quote
 *                 vault when pricing (+2–3% in small pools; the trading arms' measured layout, restated here because the public tree
 *                 carries none of their code).
 * Meteora DAMM v1/v2 and DLMM are NOT read (dynamic / scheduled fees and bin liquidity: vault balances are not the price); a coin whose
 * deepest pool is one is refused at launch with that reason.
 */

export const CPMM_PROGRAM = "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C";
export const PUMPSWAP_PROGRAM = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA";
const PUMPSWAP_DISCRIMINATOR = Buffer.from("f19a6d0411b16dbc", "hex");
const PUMPSWAP = { minSize: 211, baseMint: 43, quoteMint: 75, baseVault: 139, quoteVault: 171, offset: 245, offsetMinSize: 261 } as const;
const WSOL = NATIVE_MINT.toBase58();

/** A read-only account port (a web3 Connection fits through `connectionPoolPort`). */
export interface PoolPort {
  accounts(addresses: readonly string[]): Promise<({ owner: string; data: Buffer } | null)[]>;
  slot(): Promise<number>;
}

export function connectionPoolPort(c: { getMultipleAccountsInfo(keys: PublicKey[], commitment?: "confirmed"): Promise<({ owner: PublicKey; data: Buffer } | null)[]>; getSlot(commitment?: "confirmed"): Promise<number> }): PoolPort {
  return {
    accounts: async (a) => (await c.getMultipleAccountsInfo(a.map((x) => new PublicKey(x)), "confirmed")).map((x) => (x ? { owner: x.owner.toBase58(), data: Buffer.from(x.data) } : null)),
    slot: () => c.getSlot("confirmed"),
  };
}

export interface PoolLayout { dex: "raydium-cpmm" | "pumpswap"; tokenMint: string; tokenVault: string; solVault: string; tokenFeesOwed: bigint; solFeesOwed: bigint; solOffset: bigint }

/** The pool's vaults oriented token / SOL for `mint`. Throws with a reason for anything else (other programs, meme/meme pools). */
export function decodePoolFor(pool: string, owner: string, data: Buffer, mint: string): PoolLayout {
  if (owner === CPMM_PROGRAM) {
    if (!data.subarray(0, 8).equals(POOL_STATE_DISCRIMINATOR)) throw new Error(`${pool} is not a CPMM PoolState`);
    const p = decodeCpmmPool(new PublicKey(pool), data);
    const m0 = p.token0Mint.toBase58(), m1 = p.token1Mint.toBase58();
    if (m0 === WSOL && m1 === mint) return { dex: "raydium-cpmm", tokenMint: mint, tokenVault: p.token1Vault.toBase58(), solVault: p.token0Vault.toBase58(), tokenFeesOwed: p.fees1, solFeesOwed: p.fees0, solOffset: BigInt(0) };
    if (m1 === WSOL && m0 === mint) return { dex: "raydium-cpmm", tokenMint: mint, tokenVault: p.token0Vault.toBase58(), solVault: p.token1Vault.toBase58(), tokenFeesOwed: p.fees0, solFeesOwed: p.fees1, solOffset: BigInt(0) };
    throw new Error(`pool ${pool} is not WSOL/${mint} (${m0} / ${m1})`);
  }
  if (owner === PUMPSWAP_PROGRAM) {
    if (data.length < PUMPSWAP.minSize || !data.subarray(0, 8).equals(PUMPSWAP_DISCRIMINATOR)) throw new Error(`${pool} is not a PumpSwap Pool`);
    const pk = (o: number) => new PublicKey(data.subarray(o, o + 32)).toBase58();
    const base = pk(PUMPSWAP.baseMint), quote = pk(PUMPSWAP.quoteMint);
    const offset = data.length >= PUMPSWAP.offsetMinSize ? data.readBigUInt64LE(PUMPSWAP.offset) + (data.readBigInt64LE(PUMPSWAP.offset + 8) << BigInt(64)) : BigInt(0);
    if (base === mint && quote === WSOL) return { dex: "pumpswap", tokenMint: mint, tokenVault: pk(PUMPSWAP.baseVault), solVault: pk(PUMPSWAP.quoteVault), tokenFeesOwed: BigInt(0), solFeesOwed: BigInt(0), solOffset: offset };
    throw new Error(`PumpSwap pool ${pool} is not ${mint}/WSOL (${base} / ${quote})`);
  }
  throw new Error(`pool ${pool} is owned by ${owner}: Burn Derby reads Raydium CPMM and PumpSwap pools only (vault balances are their price; Meteora pools are not)`);
}

/** SPL token account → raw amount (u64 at 64). */
export const tokenAccountAmount = (data: Buffer): bigint => { if (data.length < 72) throw new Error("not an SPL token account"); return data.readBigUInt64LE(64); };
/** SPL mint → supply (u64 at 36) and decimals (u8 at 44). */
export const mintInfo = (data: Buffer): { supplyRaw: bigint; decimals: number } => { if (data.length < 45) throw new Error("not an SPL mint"); return { supplyRaw: data.readBigUInt64LE(36), decimals: data[44] }; };

export interface PoolSample { pool: string; dex: PoolLayout["dex"]; slot: number; tokenRaw: string; solRaw: string; decimals: number; /** token value in SOL, exact decimal (18 places, truncated). */ priceSol: string }

const SCALE = 18;
/** (solRaw / 1e9) / (tokenRaw / 10^decimals) at 18 decimals, truncated. */
export function spotSol(tokenRaw: bigint, solRaw: bigint, decimals: number): string {
  if (tokenRaw <= BigInt(0) || solRaw <= BigInt(0)) throw new Error("empty pool reserves");
  const num = solRaw * BigInt(10) ** BigInt(decimals + SCALE);
  const den = tokenRaw * BigInt(10) ** BigInt(9);
  return fromScaled(num / den, SCALE);
}

/** One sample: pool account → vaults → balances (+ the coin's mint for decimals). */
export async function samplePool(port: PoolPort, pool: string, mint: string): Promise<PoolSample> {
  const [acct, mintAcct] = await port.accounts([pool, mint]);
  if (!acct) throw new Error(`pool ${pool} not found`);
  if (!mintAcct) throw new Error(`mint ${mint} not found`);
  const layout = decodePoolFor(pool, acct.owner, acct.data, mint);
  const { decimals } = mintInfo(mintAcct.data);
  const [tv, sv] = await port.accounts([layout.tokenVault, layout.solVault]);
  if (!tv || !sv) throw new Error(`pool ${pool}: a vault account is missing`);
  const slot = await port.slot();
  const tokenRaw = tokenAccountAmount(tv.data) - layout.tokenFeesOwed;
  const solRaw = tokenAccountAmount(sv.data) - layout.solFeesOwed + layout.solOffset;
  return { pool, dex: layout.dex, slot, tokenRaw: tokenRaw.toString(), solRaw: solRaw.toString(), decimals, priceSol: spotSol(tokenRaw, solRaw, decimals) };
}

/** The mint's circulating supply (the mint account's supply: burned tokens are gone from it) in UI units, exact. */
export async function readSupply(port: PoolPort, mint: string): Promise<{ supplyRaw: string; decimals: number; supply: string; slot: number }> {
  const [m] = await port.accounts([mint]);
  if (!m) throw new Error(`mint ${mint} not found`);
  const { supplyRaw, decimals } = mintInfo(m.data);
  return { supplyRaw: supplyRaw.toString(), decimals, supply: fromScaled(supplyRaw, decimals), slot: await port.slot() };
}

/** The TWAP needs at least this many samples in the hour before the boundary (the sampler takes one every keeper cycle, ~5 min). */
export const TWAP_MIN_SAMPLES = 3;
export const TWAP_WINDOW_MS = 60 * 60_000;

/**
 * Time-weighted mean of sampled spot values over [boundary − 1 h, boundary]: each sample holds until the next (the last until the
 * boundary). Exact decimals (18 places, truncated). Returns null with a reason when there are too few samples.
 */
export function twap(samples: readonly { ts: number; priceSol: string }[], boundaryMs: number, windowMs = TWAP_WINDOW_MS): { value: string; used: number } | { value: null; reason: string } {
  const xs = samples.filter((x) => x.ts >= boundaryMs - windowMs && x.ts <= boundaryMs).sort((a, b) => a.ts - b.ts);
  if (xs.length < TWAP_MIN_SAMPLES) return { value: null, reason: `The pool average needs ${TWAP_MIN_SAMPLES} pool samples in the hour before the boundary, and there ${xs.length === 1 ? "was 1" : `were ${xs.length}`}.` };
  const toS = (v: string) => { const [w, f = ""] = v.split("."); return BigInt(w) * BigInt(10) ** BigInt(SCALE) + BigInt((f + "0".repeat(SCALE)).slice(0, SCALE) || "0"); };
  let acc = BigInt(0), span = BigInt(0);
  for (let i = 0; i < xs.length; i++) {
    const until = i + 1 < xs.length ? xs[i + 1].ts : boundaryMs;
    const dt = BigInt(Math.max(0, until - xs[i].ts));
    acc += toS(xs[i].priceSol) * dt; span += dt;
  }
  if (span === BigInt(0)) return { value: xs[xs.length - 1].priceSol, used: xs.length };
  return { value: fromScaled(acc / span, SCALE), used: xs.length };
}
