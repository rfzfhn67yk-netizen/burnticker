// Audit F01 (2026-10-19): a TokenConfig fixture that holds what the draft encoded (program.ts ExpectedTokenConfig), so a verifier fixture
// is an honest launch field by field. Fields the expectation leaves null keep the decoded defaults.
import { PublicKey } from "@solana/web3.js";
import type { ExpectedTokenConfig } from "@/lib/burnticker/program";

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
