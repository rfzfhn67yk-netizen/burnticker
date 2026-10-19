import type { TokenConfigAccount } from "@/lib/burnReceipts/accounts";
import { MODE_BUYBACK, POOL_POLICY_PAIR_CURVE } from "@/lib/burnReceipts/constants";
import type { ProgramConfigView } from "@/lib/burnKeeper/programPort";
import { bundleSelectorKey, counterRule, expectedFromCounter, type ExpectedTokenConfig } from "@/lib/burnticker/program";
import type { LockedRule } from "@/lib/burnticker/rules";
import type { Registry, TokenRow } from "@/lib/burnticker/registry";

export type { ExpectedTokenConfig } from "@/lib/burnticker/program";

/**
 * ADMISSION INTEGRITY (audit F01, 2026-10-19). The burn program stores whatever initialize_token is given, and its params_hash hashes
 * those values, so a creator who edits the unsigned launch transaction (fraction 10,000 bps instead of 200, another reserve, their own
 * attester or admin) would otherwise be admitted live under the advertised rule: the rules sha256 the confirm step checked is only a
 * label. The fix is to remember, at prepare, every value the host encoded (program.ts ExpectedTokenConfig, filled by
 * programClient.ts from exactly what it encodes, floor included: the floor is priced at that moment and cannot be rebuilt later) and to
 * compare the chain against it:
 *
 *   CONFIRM (launchVerify.ts, moments after the create; also the draft reconciler and the operator's revive): every field —
 *     the rule parameters, feed id / memo prefix / memo source, the attester keys in order and the quorum, the admin, the pinned
 *     LaunchLab platform, pair_void_by and burn_target_kind.
 *   KEEPER (multiKeeper.ts executePending, before any reading is signed): the fields ProgramConfigView carries (mode, feed, memo
 *     prefix and source, value decimals, unit value, fraction, floor, reserve, tokens per unit, burn target), and the attesters and
 *     quorum ONLY while the config has no baseline yet. Later governance is legitimate and must not halt a live coin:
 *     propose_attesters + apply_attester_change (timelocked) replace attesters and raise the quorum, and renounce_admin clears the admin.
 *     The view carries no admin key (only adminRenounced), so the keeper does not compare the admin.
 *
 * Not compared: the end sink. initialize_token pins it in the separate EndSink account ["end_sink", mint] (never changed afterwards),
 * not in the TokenConfig, so decodeTokenConfig does not expose it; the expectation keeps it for a later check of that account.
 *
 * A draft prepared before this change has no stored expectation: fallbackExpectedConfig rebuilds what can be rebuilt from the locked
 * rule (the rule parameters except the floor, feed id, memo prefix, memo source, pool policy, pair void day, burn target) and, since
 * the second audit of 2026-10-19 (I-15), fills the rest from what this host itself encodes into every initialize_token (ExpectedHost:
 * the keeper key as the sole attester with quorum 1, the config authority, the LaunchLab platform). Without that, a draft prepared on
 * the old build and confirmed later would be admitted with any attester or admin its creator chose. The floor stays uncompared (it was
 * priced in SOL at prepare and cannot be rebuilt).
 */

/**
 * I-15: what this host encodes into every initialize_token, for a draft with no stored expectation. A field left out (undefined) is not
 * known to the caller and is not compared; the research dry run and older callers pass nothing.
 */
export interface ExpectedHost {
  /** The keeper's data key. The launch bundle encodes `attesters: keeper ? [keeper] : []` with quorum 1 (api/handlers.ts prepare). */
  keeperPubkey?: string | null;
  /** The config authority (BURNTICKER_ADMIN, the Squads vault). Null: this host does not know it, so it is not compared. */
  admin?: string | null;
  /** The LaunchLab platform the program client names (BURNTICKER_PLATFORM_ID or the compiled pin). Null: not compared. */
  llPlatform?: string | null;
}

/** The registry status key that holds a draft's expectation (JSON). */
export const expectedConfigKey = (mint: string): string => `launch.expect.${mint}`;

const big = (x: bigint | number): string => BigInt(x).toString();

/** "the TokenConfig on chain sets X to A; this draft locks B" (numbers and keys only: on-chain text is never echoed). */
const sets = (what: string, chain: string | number, ours: string | number, unit = ""): string => `the TokenConfig on chain sets ${what} to ${chain}${unit}; this draft locks ${ours}${unit}`;
const carries = (what: string, ours: string): string => `the TokenConfig on chain carries another ${what} than this draft's (${ours})`;
const shortKey = (k: string): string => `${k.slice(0, 8)}…`;

/** The floors this expectation accepts (rule.floorLamports and any an earlier prepare of the same draft locked); null = not compared. */
function floors(exp: ExpectedTokenConfig): Set<string> | null {
  if (exp.rule.floorLamports === null) return null;
  return new Set([exp.rule.floorLamports, ...(exp.acceptedFloorLamports ?? [])]);
}

/** Compares the rule parameters both readers carry; `r` is the chain's, in ExpectedTokenConfig["rule"] terms. */
function ruleMismatch(r: Partial<Record<keyof ExpectedTokenConfig["rule"], string | number>>, exp: ExpectedTokenConfig): string | null {
  const e = exp.rule;
  const num: [keyof ExpectedTokenConfig["rule"], string, string][] = [
    ["mode", "the mode", ""], ["fractionPerUnitBps", "the fraction per unit", " bps"], ["reserveLamports", "the reserve", " lamports"],
    ["tokensPerUnit", "the tokens per unit", ""], ["vaultAllocation", "the vault allocation", ""], ["carryRule", "the carry rule", ""],
    ["poolPolicy", "the pool policy", ""], ["valueDecimals", "the value decimals", ""], ["unitValue", "the unit value", ""],
    ["maxAbsDelta", "the largest daily change", ""], ["slippageBps", "the slippage limit", " bps"], ["maxTwapDeviationBps", "the TWAP deviation limit", " bps"],
    ["twapWindowSecs", "the TWAP window", " seconds"],
  ];
  for (const [k, what, unit] of num) {
    if (!(k in r) || r[k] === undefined) continue;
    if (String(r[k]) !== String(e[k])) return sets(what, String(r[k]), String(e[k]), unit);
  }
  const f = floors(exp);
  if (f && r.floorLamports !== undefined && !f.has(String(r.floorLamports))) return sets("the minimum spend", String(r.floorLamports), String(e.floorLamports), " lamports");
  return null;
}

/**
 * The first field where the TokenConfig on chain differs from what this draft encoded, as a short sentence, or null when it matches.
 * The confirm check (moments after the create): every field the expectation knows.
 */
export function configMismatch(cfg: TokenConfigAccount, exp: ExpectedTokenConfig): string | null {
  const r = cfg.rule;
  const rule = ruleMismatch({
    mode: r.mode, carryRule: r.carry_rule, poolPolicy: r.pool_policy, valueDecimals: r.value_decimals, unitValue: big(r.unit_value), maxAbsDelta: big(r.max_abs_delta),
    fractionPerUnitBps: r.fraction_per_unit_bps, slippageBps: r.slippage_bps, maxTwapDeviationBps: r.max_twap_deviation_bps, twapWindowSecs: r.twap_window_secs,
    floorLamports: big(r.floor_lamports), reserveLamports: big(r.reserve_lamports), tokensPerUnit: big(r.tokens_per_unit), vaultAllocation: big(r.vault_allocation),
  }, exp);
  if (rule) return rule;
  if (cfg.feedId !== exp.feedId) return carries("feed id", exp.feedId);
  if (cfg.memoPrefix !== exp.memoPrefix) return carries("memo prefix", exp.memoPrefix);
  if (exp.memoSource !== null && cfg.memoSource !== exp.memoSource) return carries("memo source", exp.memoSource);
  if (exp.attesters !== null) {
    const keys = cfg.activeAttesters.map((a) => a.key.toBase58());
    if (keys.length !== exp.attesters.length || keys.some((k, i) => k !== exp.attesters![i])) return `the TokenConfig on chain names other attesters (${keys.map(shortKey).join(", ") || "none"}) than this draft's (${exp.attesters.map(shortKey).join(", ") || "none"})`;
  }
  if (exp.quorum !== null && cfg.quorum !== exp.quorum) return sets("the quorum", cfg.quorum, exp.quorum);
  if (exp.admin !== null && cfg.admin.toBase58() !== exp.admin) return `the TokenConfig on chain names another config authority (${shortKey(cfg.admin.toBase58())}) than this draft's (${shortKey(exp.admin)})`;
  if (exp.llPlatform !== null && cfg.ll_platform.toBase58() !== exp.llPlatform) return `the TokenConfig on chain pins another LaunchLab platform (${shortKey(cfg.ll_platform.toBase58())}) than this draft's (${shortKey(exp.llPlatform)})`;
  if (exp.pairVoidBy !== null && cfg.pair_void_by !== exp.pairVoidBy) return sets("the pair's void day", cfg.pair_void_by, exp.pairVoidBy);
  // a pinned target starts at 1 and the program moves it to 2 once the target's pool is verified: "self" vs "a target" is what is locked
  const kind = cfg.burn_target_kind ?? 0;
  if ((exp.burnTargetKind === 0) !== (kind === 0)) return sets("the burned token setting", kind, exp.burnTargetKind);
  return null;
}

/**
 * The keeper's fence (multiKeeper.ts executePending): the fields ProgramConfigView carries. Attesters and quorum are compared only
 * before the baseline reading (governance may change them later); the admin is not in the view.
 */
export function viewMismatch(view: ProgramConfigView, exp: ExpectedTokenConfig): string | null {
  const rule = ruleMismatch({
    mode: view.mode === "buyback" ? MODE_BUYBACK : 1, valueDecimals: view.valueDecimals, unitValue: big(view.unitValue), fractionPerUnitBps: view.fractionPerUnitBps,
    floorLamports: big(view.floorLamports), reserveLamports: big(view.reserveLamports), tokensPerUnit: big(view.tokensPerUnit),
  }, exp);
  if (rule) return rule;
  if (view.feedId !== exp.feedId) return carries("feed id", exp.feedId);
  if (view.memoPrefix !== exp.memoPrefix) return carries("memo prefix", exp.memoPrefix);
  if (exp.memoSource !== null && view.memoSource !== exp.memoSource) return carries("memo source", exp.memoSource);
  if (view.burnsTarget !== undefined && view.burnsTarget !== (exp.burnTargetKind !== 0)) return sets("the burned token setting", view.burnsTarget ? 1 : 0, exp.burnTargetKind);
  if (!view.hasBaseline) {
    if (exp.attesters !== null) {
      const keys = view.attesters.map((a) => a.key);
      if (keys.length !== exp.attesters.length || keys.some((k, i) => k !== exp.attesters![i])) return `the TokenConfig on chain names other attesters (${keys.map(shortKey).join(", ") || "none"}) than this draft's (${exp.attesters.map(shortKey).join(", ") || "none"})`;
    }
    if (exp.quorum !== null && view.quorum !== exp.quorum) return sets("the quorum", view.quorum, exp.quorum);
  }
  return null;
}

/** A stored expectation (registry status launch.expect.<mint>), or null when absent or unreadable. */
export function loadExpectedConfig(registry: Pick<Registry, "getStatus">, mint: string): ExpectedTokenConfig | null {
  let raw: string | null;
  try { raw = registry.getStatus(expectedConfigKey(mint)); } catch { return null; }
  if (!raw) return null;
  try {
    const e = JSON.parse(raw) as ExpectedTokenConfig;
    if (!e || e.version !== 1 || typeof e.feedId !== "string" || typeof e.memoPrefix !== "string" || !e.rule || typeof e.rule.fractionPerUnitBps !== "number") return null;
    return e;
  } catch { return null; }
}

/**
 * For a draft without a stored expectation (prepared before this change): what the locked rule fixes, plus what the host encodes into
 * every launch (`host`, I-15). The floor (priced in SOL at prepare) is never compared. Without `host` the attesters, quorum, admin,
 * platform and memo source are left null (not compared), as before.
 *
 * `o.launchLab`: the draft is a LaunchLab coin (a pool id was recorded); `o.pairCurve`: a pair-curve coin; `o.paired`: the registry links
 * it to a partner (a LaunchLab pair). The pair void day follows launchBundle.ts: the rules' pair.voidBy for a linked LaunchLab pair, 0 for
 * a pair-curve coin (pairCurveExpected) and for a coin with no pair clause.
 */
export function fallbackExpectedConfig(locked: LockedRule, ticker: string, selectorKey: string = bundleSelectorKey(locked.rule), o: { pairCurve?: boolean; launchLab?: boolean; paired?: boolean; host?: ExpectedHost } = {}): ExpectedTokenConfig {
  const c = counterRule(locked.rule, ticker, selectorKey, { floorLamports: BigInt(0) });
  const h = o.host;
  const pair = (locked.rule as { pair?: { voidBy?: unknown } | null }).pair;
  const voidBy = typeof pair?.voidBy === "string" && /^\d{4}-\d{2}-\d{2}$/.test(pair.voidBy) ? Number(pair.voidBy.replace(/-/g, "")) : null;
  const pairVoidBy = !h ? null : o.pairCurve ? 0 : o.paired ? voidBy : !pair ? 0 : null;
  const attesters = !h || h.keeperPubkey === undefined ? null : h.keeperPubkey ? [h.keeperPubkey] : [];
  const llPlatform = h?.llPlatform && c.rule.mode === MODE_BUYBACK && (o.launchLab || o.pairCurve) ? h.llPlatform : null;
  const e = expectedFromCounter(c, { rulesSha256: locked.sha256, attesters, quorum: attesters ? 1 : null, admin: h?.admin ?? null, llPlatform, endSink: null, pairVoidBy,
    burnTargetKind: (locked.rule as { burnTarget?: unknown }).burnTarget ? 1 : 0, floorKnown: false });
  return { ...e, fallback: true, memoSource: h ? c.memoSource : null, rule: { ...e.rule, ...(o.pairCurve ? { poolPolicy: POOL_POLICY_PAIR_CURVE } : {}) } };
}

/**
 * A pair-curve coin's create is the LaunchLab bundle's initialize_token re-encoded (pairCurveLaunch.ts toPairCurvePolicy): pool policy
 * 2, pair_void_by 0, the LaunchLab platform in its slot. The expectation follows the same edits.
 */
export function pairCurveExpected(exp: ExpectedTokenConfig, platformId: string | null): ExpectedTokenConfig {
  return { ...exp, rule: { ...exp.rule, poolPolicy: POOL_POLICY_PAIR_CURVE }, pairVoidBy: 0, llPlatform: exp.rule.mode === MODE_BUYBACK && platformId ? platformId : exp.llPlatform };
}

/**
 * The expectation to store for a draft when one may already be stored (a retry of the same draft prices the floor again): the new one,
 * keeping the earlier floors as accepted when every other field is the same; otherwise the new one alone.
 */
export function mergeExpected(prev: ExpectedTokenConfig | null, next: ExpectedTokenConfig): ExpectedTokenConfig {
  if (!prev) return next;
  const strip = (e: ExpectedTokenConfig) => JSON.stringify({ ...e, acceptedFloorLamports: undefined, rule: { ...e.rule, floorLamports: undefined } });
  if (strip(prev) !== strip(next)) return next;
  // oldest first; the newest eight kept
  const all = [...new Set([...(prev.acceptedFloorLamports ?? []), ...(prev.rule.floorLamports !== null ? [prev.rule.floorLamports] : [])])].filter((f) => f !== next.rule.floorLamports);
  return all.length ? { ...next, acceptedFloorLamports: all.slice(-8) } : next;
}

/**
 * The expectation every verify and the keeper use: the stored one, else the fallback from the locked rule and the host's own launch
 * facts (I-15; `host` omitted = those fields not compared). Null when neither can be made.
 */
export function expectedConfigFor(registry: Pick<Registry, "getStatus" | "lockedRule" | "pairOf">, t: TokenRow, host?: ExpectedHost): ExpectedTokenConfig | null {
  const stored = loadExpectedConfig(registry, t.mint);
  if (stored) return stored;
  try {
    const paired = !!registry.pairOf(t.mint);
    const pairCurve = t.poolId === null && paired;
    return fallbackExpectedConfig(registry.lockedRule(t), t.ticker, undefined, { pairCurve, launchLab: t.poolId !== null, paired, ...(host ? { host } : {}) });
  } catch { return null; }
}

/** I-15: the host facts of an app or keeper process: its keeper key and what its program client encodes. */
export function expectedHostOf(o: { keeperPubkey?: string | null; program?: { adminKey?: string | null; launchLabPlatformKey?: string | null } | null; platformId?: string | null }): ExpectedHost {
  return { ...(o.keeperPubkey === undefined ? {} : { keeperPubkey: o.keeperPubkey }), admin: o.program?.adminKey ?? null, llPlatform: o.platformId ?? o.program?.launchLabPlatformKey ?? null };
}
