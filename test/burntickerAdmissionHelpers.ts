// Audit F01 (2026-10-19): a TokenConfig fixture that holds what the draft encoded (program.ts ExpectedTokenConfig), so a verifier fixture
// is an honest launch field by field. Fields the expectation leaves null keep the decoded defaults.
import BN from "bn.js";
import { Keypair, PublicKey } from "@solana/web3.js";
import { initializeV2 } from "@raydium-io/raydium-sdk-v2";
import type { ExpectedTokenConfig } from "@/lib/burnticker/program";

// B-1 (third audit 2026-10-19): the confirm step decodes the LaunchLab create's arguments, so a verifier fixture carries real ones. These
// are encoded by the Raydium SDK's own initializeV2 (not this repo's decoder), with what an honest Burnticker bundle builds.
export interface CreateArgs { decimals: number; name: string; symbol: string; uri: string; supply: string; totalSellA: string; raise: string; locked: string; cliff: string; unlock: string; migrate: "cpmm" | "amm"; feeOn: number; curve: "ConstantCurve" | "FixedCurve" }
export const HONEST_CREATE: CreateArgs = { decimals: 6, name: "Honest", symbol: "HONEST", uri: "https://example.invalid/honest.json", supply: "1000000000000000", totalSellA: "793100000000000", raise: "85000000000", locked: "0", cliff: "0", unlock: "0", migrate: "cpmm", feeOn: 0, curve: "ConstantCurve" };
/** initialize_v2's data for `over` applied to the honest arguments (the accounts are throwaway: only the data is used). */
export function createData(over: Partial<CreateArgs> = {}): Uint8Array {
  const a = { ...HONEST_CREATE, ...over };
  const r = () => Keypair.generate().publicKey;
  const curve = a.curve === "ConstantCurve" ? { type: "ConstantCurve" as const, totalSellA: new BN(a.totalSellA), migrateType: a.migrate, supply: new BN(a.supply), totalFundRaisingB: new BN(a.raise) } : { type: "FixedCurve" as const, migrateType: a.migrate, supply: new BN(a.supply), totalFundRaisingB: new BN(a.raise) };
  const ix = initializeV2(r(), r(), r(), r(), r(), r(), r(), r(), r(), r(), r(), r(), r(), a.decimals, a.name, a.symbol, a.uri, curve, new BN(a.locked), new BN(a.cliff), new BN(a.unlock), a.feeOn as never);
  return new Uint8Array(ix.data);
}
/** SOL's mint, the quote of every coin (initialize_v2 account 7). */
export const WSOL = "So11111111111111111111111111111111111111112";

const bytes = (s: string, n: number): Buffer => { const b = Buffer.alloc(n); Buffer.from(s, "utf8").copy(b); return b; };

/** Writes `exp` into a decoded TokenConfig value `v` (the IDL's field names), before it is encoded. */
export function applyExpected(v: Record<string, unknown>, exp: ExpectedTokenConfig): void {
  const r = v.rule as Record<string, unknown>, e = exp.rule;
  Object.assign(r, {
    mode: e.mode, carry_rule: e.carryRule, pool_policy: e.poolPolicy, value_decimals: e.valueDecimals, unit_value: BigInt(e.unitValue), max_abs_delta: BigInt(e.maxAbsDelta),
    fraction_per_unit_bps: e.fractionPerUnitBps, slippage_bps: e.slippageBps, max_twap_deviation_bps: e.maxTwapDeviationBps, twap_window_secs: e.twapWindowSecs,
    floor_lamports: BigInt(e.floorLamports ?? "0"), reserve_lamports: BigInt(e.reserveLamports), tokens_per_unit: BigInt(e.tokensPerUnit), vault_allocation: BigInt(e.vaultAllocation),
  });
  v.feed_id = bytes(exp.feedId, 32); v.feed_id_len = Buffer.byteLength(exp.feedId);
  v.memo_prefix = bytes(exp.memoPrefix, 12); v.memo_prefix_len = Buffer.byteLength(exp.memoPrefix);
  if (exp.memoSource !== null) { v.memo_source = bytes(exp.memoSource, 64); v.memo_source_len = Buffer.byteLength(exp.memoSource); }
  if (exp.attesters !== null) {
    const slots = v.attesters as { kind: number; key: PublicKey }[];
    v.attesters = slots.map((s, i) => (i < exp.attesters!.length ? { kind: 0, key: new PublicKey(exp.attesters![i]) } : s));
    v.attester_count = exp.attesters.length;
  }
  if (exp.quorum !== null) v.quorum = exp.quorum;
  if (exp.admin !== null) v.admin = new PublicKey(exp.admin);
  if (exp.llPlatform !== null) v.ll_platform = new PublicKey(exp.llPlatform);
  if (exp.pairVoidBy !== null) v.pair_void_by = exp.pairVoidBy;
  v.burn_target_kind = exp.burnTargetKind;
}
