import { explorerUrl } from "@/lib/burnKeeper/solana";
import { buybackSpend, rawToTokens, solToLamports, spendablePool, tokensToRaw } from "@/lib/burnKeeper/rules";
import { STATUS_CSS, seriesChartSvg, toJson, publishSite } from "@/lib/burnKeeper/statusPage";
import { CURVE_FEES, POST_GRADUATION_FEES, LP_BURNED_PCT, LP_LOCKED_PCT, PRE_AUDIT_POOL_CAP_SOL, OPERATOR_LINE, USE_OF_FEES, bpsPerSol, burnPoolAddresses, capPool, feeSplitSentence, type FeeSplit } from "@/lib/burnticker/fees";
import { DECIMALS, DISCLAIMER_FOOTER, TOTAL_SUPPLY, descriptionFooter, oracleDisclosure, pairClause, pairMirrorRule, pairWinnerTakesBurn, ruleMappings, ruleStatement, type LockedRule } from "@/lib/burnticker/rules";
import { badgeFromText, PAIR_BURN_SENTENCE } from "@/lib/burnticker/describe";
import { auditBadgeView } from "@/lib/burnticker/auditBadge";
import { NO_WALLET_LINE, termLine } from "@/lib/burnticker/glossary";
import type { TokenMeta } from "@/lib/burnticker/registry";
/** The standing line on every coin page and card (owner decision 2026-10-10, anti-misrepresentation). */
export const AFFILIATION_LINE = "Not affiliated with any team, league, candidate, agency or market.";
import { parseReceiptMemo } from "@/lib/burnticker/receipt";
import { fullSpendUnits, unitStep, windDownUnits, type SettledEvent } from "@/lib/burnticker/units";
import { feedById } from "@/lib/burnticker/catalogue";
import type { ImpliedChance } from "@/lib/burnticker/oracle/types";
import type { AttesterRow, FeedState, ReadingRow, ReceiptRow, Registry, TokenRow, TokenState } from "@/lib/burnticker/registry";
import type { LifecycleJson, PairClauseJson, PairCounterpart, PairForwardJson, PairSideSummary, ReceiptJson, TokenProgramJson, TokenStatusJson } from "@/lib/burnticker/pageTypes";
import { pairDailyText, platformDailyText, tokenDayText } from "@/lib/launch/dailyPost";
import { parseBuybackMemo as parseProgramBuybackMemo, parseDebtMemo as parseProgramVaultMemo } from "@/lib/burnReceipts/memo";
import { buybackSpend as programBuybackSpend, formatDate as formatU32 } from "@/lib/burnReceipts/math";
import type { ProgramConfigView } from "@/lib/burnKeeper/programPort";
import { buildMarketJson, type MarketInput } from "@/lib/burnticker/market";
import { ruleOneLiner } from "@/lib/burnticker/coinCard";
import { PAIR_STATE_NAMES, parseForwardMemo, type PairLinks } from "@/lib/burnticker/pairForward";
import { pairUnlinked } from "@/lib/burnticker/pairForwardKeeper";
import { LP_POLICY_BADGE, buildLpLockJson, feeKeysPda, operatorTreasuryFor, solscanUrl, type LpLockJson } from "@/lib/burnticker/lockFees";

/**
 * THE TOKEN PAGE (LAUNCHPAD-PATH §6; 2026-10-09), generalised from the $DEFICIT status page to N tokens: supply and burned, the feed
 * chart with burn markers, the pool balance and the next-burn clock, the receipts table (oracle, market, result, settled time, source
 * URL, units, spent, bought, burned, tx, verify-it-yourself curl + formula), the rule and its hash, attesters and quorum, the creator,
 * the fee split (bps per 1 SOL, pre/post graduation, from fees.ts), the curve embed placeholder, the fixed disclaimer — and for
 * oracle-backed tokens the next scheduled market (its ticker and close time, never a price or odds) and the event-contract disclosure line.
 *
 * Every number is recomputed from the recorded readings and the rule at render time; a receipt whose recomputation disagrees with its
 * on-chain memo renders red (verify.verified = false) and counts in health.unverified. Pure apart from `publishTokenSite`.
 */

export const TOKEN_STATUS_SCHEMA = "burnticker.status/v1";

export interface TokenPageInput {
  token: TokenRow; locked: LockedRule; readings: readonly ReadingRow[]; receipts: readonly ReceiptRow[]; attesters: readonly AttesterRow[]; state: TokenState; feedState: FeedState;
  chain: { cluster: string; programId: string; supplyRaw: bigint | null; feePdaLamports: bigint | null; vaultRaw: bigint | null;
    /** PROGRAM EXECUTION (2026-10-10): the TokenConfig as read this cycle, the keeper's attester keys, the last reading's transaction. */
    program?: { config: ProgramConfigView | null; keeperKeys: readonly string[]; lastReading: { date: string; signature: string } | null } | null };
  now: number; nextCheckAt: number | null; implied: ImpliedChance | null; seriesTitle: string | null; selectorPending: number;
  /** What the operator can and cannot do, derived from the Powers Register (trust.ts), never free text. */
  operator: { can: string[]; cannot: string[]; placeholder: boolean };
  /** Rivalry pair: the other side's summary, when this token is one half of a pair. */
  pair: PairCounterpart | null;
  /** The launch pins (registry.token_meta): the creator's note and the Arweave copies. */
  meta?: TokenMeta | null;
  /** No burn pool is ever left behind: the end of the rule and the sweep, from the registry (lifecycleFrom). */
  lifecycle?: LifecycleJson | null;
  /** The LaunchLab pool and top holders as read this cycle (market.ts readMarket); absent/null on a host without an RPC → the page shows "—". */
  market?: MarketInput | null;
  /** LP locked forever (2026-10-10): the lock as read + recorded claims (lpLockPage.ts lpLockBlock); absent → the policy alone. */
  lp?: LpLockJson | null;
}

// PairSideSummary / PairCounterpart live in pageTypes.ts with the JSON shapes that carry them.
export type { PairSideSummary, PairCounterpart } from "@/lib/burnticker/pageTypes";
export interface PairTally {
  pairId: string; a: PairSideSummary; b: PairSideSummary; burnsA: number; burnsB: number; burnedA: string; burnedB: string; supplyA: string; supplyB: string;
  /** Supply left as a percentage of each side's initial supply (100 − burned %). */
  supplyPctA: number; supplyPctB: number;
  settlements: number; voids: number;
  /** The latest settlement: its market ticker, the settled result (or value), which side it burned and how much. */
  lastSettlement: { eventId: string; settledAt: string; burnedSide: "A" | "B" | null; result: string | null; value: string | null; burned: string | null } | null;
  /** The next scheduled market (ticker, close time). chanceA/chanceB are always null: no odds for any coin (owner decision 2026-10-10). */
  next: { market: string | null; closeTime: string | null; chanceA: number | null; chanceB: number | null };
  /** Both or neither (2026-10-10): the pair's state, void date and who it waits on (null for a pair made before the clause). */
  clause: PairClauseJson | null;
  /** Each side's LaunchLab curve as status.json carries it (null without an RPC read) — the pair page draws them side by side. */
  curveA: TokenStatusJson["market"]["curve"]; curveB: TokenStatusJson["market"]["curve"];
  /**
   * WINNER TAKES THE BURN (since API 1.10.0): whether the pair runs it, the SOL each side's lost periods moved to the other's burn pool
   * (from the forwarded receipts), and every forward (oldest first). "burned on A / burned on B / forwarded A→B / B→A" on the pair page.
   */
  winnerTakesBurn?: boolean; forwardedAtoB?: string; forwardedBtoA?: string; forwards?: PairForwardJson[];
  /** The attester fact, stated plainly while one key attests both coins (pair-forward re-check): see PAIR_SOLE_ATTESTER_LINE. */
  attesterLine?: string | null;
  /** Round 2: the pair was unlinked on chain (reason in words); "unpaired (reason)" on the page. */
  unpaired?: { reason: string; at: string; signature: string | null } | null;
}

/** One side's summary from its status (and receipts, for the last burn time). */
export function sideSummary(s: Pick<TokenStatusJson, "ticker" | "name" | "mint" | "burned" | "supply">, receipts: readonly Pick<ReceiptJson, "status" | "settledAt" | "burned">[] = []): PairSideSummary {
  const last = [...receipts].filter((r) => r.status === "confirmed" && r.burned && r.burned !== "0").sort((x, y) => (x.settledAt < y.settledAt ? 1 : -1))[0];
  return { ticker: s.ticker, name: s.name, mint: s.mint, burns: s.burned.count, burned: s.burned.total, supply: s.supply.current, lastBurnAt: last?.settledAt ?? null };
}

export const FEE_FLOW_LINE = "creator fees → burn pool → burned; LP locked forever, its fees → 80% burn pool / 20% operator (fixed in code).";

/** The lifecycle block from the registry (pure over its reads): ended, wind-down progress, the last sweep, the page's one line. */
export function lifecycleFrom(reg: Pick<Registry, "ruleEnd" | "receipts" | "getStatus">, t: Pick<TokenRow, "mint" | "status">, rule: Pick<LockedRule["rule"], "onEnd" | "binary" | "scalar" | "kind">, poolLamports: bigint | null = null): LifecycleJson {
  const end = reg.ruleEnd(t.mint);
  const rs = reg.receipts(t.mint);
  const wd = rs.filter((b) => b.kind === "winddown"), dr = rs.filter((b) => b.kind === "drain");
  const lastSweep = reg.getStatus(`rule.swept.${t.mint}`);
  const f = (rule.kind === "binary" ? rule.binary?.onYes ?? rule.binary?.onNo : rule.scalar?.perUnit)?.fractionOfPool ?? 0;
  const days = rule.onEnd?.windDownDays ?? null;
  const done = wd.filter((b) => b.status === "confirmed" || b.status === "skipped").length;
  const poolNote = poolLamports !== null ? (poolLamports < BigInt(10_000_000) ? "pool ≈ 0" : `pool ${rawToTokens(poolLamports, 9)} SOL`) : "pool ≈ 0";
  const line = t.status === "retired" ? `retired${lastSweep ? ` · swept ${lastSweep}` : ""} · ${poolNote}`
    : end?.mode === "drain" ? `draining · ${dr.length} drain day(s) so far (100 % of the pool, under the per-crank cap)`
    : end ? `winding down · day ${Math.max(1, wd.length)} of ${days ?? "?"}`
    : "live";
  return { ended: end ? { reason: end.reason, at: new Date(end.at).toISOString(), mode: end.mode } : null, windDown: end?.mode === "winddown" && days ? { days, done, unitsPerDay: f > 0 ? windDownUnits(f, days) : null } : null, lastSweep, line, fees: FEE_FLOW_LINE };
}

/** The scoreboard: burns A vs B, supply A vs B, the last settlement and which side it burned. Pure over the two sides' pages. */
export function pairTally(a: TokenStatusJson, b: TokenStatusJson, receiptsA: readonly ReceiptJson[] = [], receiptsB: readonly ReceiptJson[] = []): PairTally {
  const sa = sideSummary(a, receiptsA), sb = sideSummary(b, receiptsB);
  const byEvent = new Map<string, { settledAt: string; A?: ReceiptJson; B?: ReceiptJson }>();
  for (const r of receiptsA) byEvent.set(r.eventId, { ...(byEvent.get(r.eventId) ?? { settledAt: r.settledAt }), A: r });
  for (const r of receiptsB) byEvent.set(r.eventId, { ...(byEvent.get(r.eventId) ?? { settledAt: r.settledAt }), B: r });
  const events = [...byEvent.entries()].sort((x, y) => (x[1].settledAt < y[1].settledAt ? -1 : 1));
  const voids = events.filter(([, e]) => (e.A?.status === "void") || (e.B?.status === "void")).length;
  const last = events[events.length - 1] ?? null;
  const burnedSide = (e: { A?: ReceiptJson; B?: ReceiptJson }): "A" | "B" | null => (e.A && e.A.status === "confirmed" && e.A.burned && e.A.burned !== "0" ? "A" : e.B && e.B.status === "confirmed" && e.B.burned && e.B.burned !== "0" ? "B" : null);
  const lastSide = last ? burnedSide(last[1]) : null;
  const lastRow = last ? (lastSide === "B" ? last[1].B : last[1].A ?? last[1].B) ?? null : null;
  const left = (s: TokenStatusJson) => Math.max(0, 100 - s.burned.pctOfSupply);
  return {
    pairId: a.pair?.pairId ?? b.pair?.pairId ?? "", a: sa, b: sb, burnsA: sa.burns, burnsB: sb.burns, burnedA: sa.burned, burnedB: sb.burned, supplyA: sa.supply, supplyB: sb.supply,
    supplyPctA: left(a), supplyPctB: left(b), settlements: events.length, voids,
    lastSettlement: last ? { eventId: last[0], settledAt: last[1].settledAt, burnedSide: lastSide, result: lastRow?.result ?? null, value: lastRow?.value ?? null, burned: lastSide ? lastRow?.burned ?? null : null } : null,
    next: { market: a.next.nextMarket ?? b.next.nextMarket, closeTime: a.next.nextCloseTime ?? b.next.nextCloseTime, chanceA: null, chanceB: b.next.impliedChance },
    clause: a.pair?.clause ?? b.pair?.clause ?? null,
    curveA: a.market?.curve ?? null, curveB: b.market?.curve ?? null,
    winnerTakesBurn: !!(a.pair?.winnerTakesBurn || b.pair?.winnerTakesBurn), forwardedAtoB: forwardedSol(receiptsA), forwardedBtoA: forwardedSol(receiptsB),
    forwards: a.pair?.forwards ?? b.pair?.forwards ?? forwardsFromReceipts(a, b, receiptsA, receiptsB),
    unpaired: a.pair?.unpaired ?? b.pair?.unpaired ?? null,
    attesterLine: soleAttester(a, b) ? PAIR_SOLE_ATTESTER_LINE : (a.pair?.winnerTakesBurn || b.pair?.winnerTakesBurn) ? PAIR_QUORUM_LINE : null,
  };
}

/**
 * The pair page's attester fact (the M-1 residual, stated plainly — pair-forward round 3: both coins share ONE attester set). While one
 * key attests both coins at quorum 1, the full sentence; otherwise its first half.
 */
export const PAIR_QUORUM_LINE = "Whoever holds the common attester quorum decides every result.";
export const PAIR_SOLE_ATTESTER_LINE = "Whoever holds the common attester quorum decides every result; on Burnticker that is the operator's keeper alone at quorum 1.";
/** True when both coins have exactly one active attester, the same key, at quorum 1. */
export function soleAttester(a: Pick<TokenStatusJson, "attesters" | "quorum">, b: Pick<TokenStatusJson, "attesters" | "quorum">): boolean {
  const act = (s: Pick<TokenStatusJson, "attesters">) => (s.attesters ?? []).filter((x) => x.active);
  const [xa, xb] = [act(a), act(b)];
  return a.quorum === 1 && b.quorum === 1 && xa.length === 1 && xb.length === 1 && xa[0].pubkey === xb[0].pubkey;
}

/** The SOL a side's forwarded receipts moved (the lead receipt of each reading carries the program's amount). */
export function forwardedSol(receipts: readonly Pick<ReceiptJson, "status" | "spent">[]): string {
  const l = receipts.filter((r) => r.status === "forwarded" && r.spent).reduce((acc, r) => acc + solToLamports(r.spent!), ZERO);
  return rawToTokens(l, 9);
}
/** Forwards rebuilt from the two sides' forwarded receipts (a page without the registry's pair_forwards rows). */
function forwardsFromReceipts(a: TokenStatusJson, b: TokenStatusJson, receiptsA: readonly ReceiptJson[], receiptsB: readonly ReceiptJson[]): PairForwardJson[] {
  const one = (from: TokenStatusJson, to: TokenStatusJson, rs: readonly ReceiptJson[]) => rs.filter((r) => r.status === "forwarded" && r.spent && r.signature && r.lead !== false)
    .map((r) => ({ recordDate: r.readingDate ?? r.settledAt.slice(0, 10), from: from.ticker, to: to.ticker, fromMint: from.mint, toMint: to.mint, sol: r.spent!, units: r.units, signature: r.signature!, txUrl: r.txUrl }));
  return [...one(a, b, receiptsA), ...one(b, a, receiptsB)].sort((x, y) => (x.recordDate < y.recordDate ? -1 : x.recordDate > y.recordDate ? 1 : 0));
}

/** r3 API fields from the chain's view of the pair (pairState for THIS side, the locked voidBy, the later pair_after_date); {} without a reader. */
export async function pairChainFields(chain: ((a: string, b: string) => Promise<PairLinks | null>) | undefined, mintA: string, mintB: string, side: "A" | "B"): Promise<Pick<PairCounterpart, "pairState" | "pairVoidBy" | "pairAfterDate">> {
  if (!chain) return {};
  let l: PairLinks | null = null;
  try { l = await chain(mintA, mintB); } catch { l = null; }
  if (!l) return { pairState: null, pairVoidBy: null, pairAfterDate: null };
  const ds = (n: number | undefined) => (n ? `${String(n).slice(0, 4)}-${String(n).slice(4, 6)}-${String(n).slice(6, 8)}` : null);
  return { pairState: PAIR_STATE_NAMES[side === "A" ? l.stateA : l.stateB], pairVoidBy: ds(l.pairVoidBy), pairAfterDate: ds(l.pairAfterDate) };
}

/** The registry's forwards for a pair as the public shape (tickers, SOL, explorer links). */
export function pairForwardsJson(reg: Pick<Registry, "pairForwards" | "token">, pairId: string, cluster: string): PairForwardJson[] {
  return reg.pairForwards(pairId).map((f) => ({ recordDate: formatU32(f.recordDate), from: reg.token(f.loserMint)?.ticker ?? f.loserMint.slice(0, 6), to: reg.token(f.winnerMint)?.ticker ?? f.winnerMint.slice(0, 6), fromMint: f.loserMint, toMint: f.winnerMint, sol: rawToTokens(f.lamports, 9), units: f.units, signature: f.signature, txUrl: explorerUrl(cluster as Parameters<typeof explorerUrl>[0], f.signature) }));
}

/**
 * The other side of a rivalry pair as seen from `t`, from the registry and a supply reader (the chain's mint supply, else initial −
 * burned). The keeper uses it so the static pages carry the versus header and the pair cards; the app's server.ts has the same summary.
 */
/**
 * Both or neither: a pair's clause state from the registry (the recorded outcome) and, while it waits, who has no registered pool yet
 * (`poolRegistered` reads each side's TokenConfig; without it `waitingOn` is empty). Null for a pair whose rules carry no clause.
 */
export async function pairClauseState(reg: Pick<Registry, "token" | "lockedRule" | "pairOutcome">, pair: { pairId: string; mintA: string; mintB: string }, poolRegistered?: (mint: string) => Promise<boolean | null>, now = Date.now()): Promise<PairClauseJson | null> {
  const ta = reg.token(pair.mintA);
  if (!ta) return null;
  let c;
  try { c = pairClause(reg.lockedRule(ta).rule); } catch { return null; }
  if (!c) return null;
  const o = reg.pairOutcome(pair.pairId);
  if (o) return { voidBy: c.voidBy, state: o.state, waitingOn: [], decidedAt: new Date(o.at).toISOString(), detail: o.detail };
  const [ra, rb] = poolRegistered ? [await poolRegistered(pair.mintA).catch(() => null), await poolRegistered(pair.mintB).catch(() => null)] : [null, null];
  const waitingOn = [...(ra === false ? ["A" as const] : []), ...(rb === false ? ["B" as const] : [])];
  return { voidBy: c.voidBy, state: "waiting", waitingOn, decidedAt: null, detail: now >= Date.parse(`${c.voidBy}T00:00:00Z`) + 86_400_000 ? "voidBy has passed: the keeper voids the pair on its next cycle" : null };
}

export async function pairCounterpartFrom(reg: Pick<Registry, "pairOf" | "token" | "receipts" | "totalBurnedRaw"> & Partial<Pick<Registry, "lockedRule" | "pairOutcome" | "pairForwards" | "getStatus">>, supplyRaw: (mint: string) => Promise<bigint | null>, t: Pick<TokenRow, "mint">, poolRegistered?: (mint: string) => Promise<boolean | null>, chain?: (mintA: string, mintB: string) => Promise<PairLinks | null>): Promise<PairCounterpart | null> {
  const pair = reg.pairOf(t.mint);
  if (!pair) return null;
  const side: "A" | "B" = pair.mintA === t.mint ? "A" : "B";
  const other = reg.token(side === "A" ? pair.mintB : pair.mintA);
  if (!other) return null;
  const confirmed = reg.receipts(other.mint).filter((r) => r.status === "confirmed" && (r.burnRaw ?? ZERO) > ZERO);
  const burnedRaw = reg.totalBurnedRaw(other.mint);
  const supply = (await supplyRaw(other.mint).catch(() => null)) ?? tokensToRaw(TOTAL_SUPPLY, DECIMALS) - burnedRaw;
  const last = [...confirmed].sort((x, y) => (x.settledAt < y.settledAt ? 1 : -1))[0];
  const clause = reg.lockedRule && reg.pairOutcome ? await pairClauseState({ token: reg.token.bind(reg), lockedRule: reg.lockedRule.bind(reg), pairOutcome: reg.pairOutcome.bind(reg) }, pair, poolRegistered) : null;
  let winnerTakesBurn = false;
  const me = reg.token(t.mint);
  if (reg.lockedRule && me) { try { winnerTakesBurn = pairWinnerTakesBurn(reg.lockedRule(me).rule); } catch { winnerTakesBurn = false; } }
  const forwards = reg.pairForwards ? pairForwardsJson({ pairForwards: reg.pairForwards.bind(reg), token: reg.token.bind(reg) }, pair.pairId, other.cluster) : [];
  return { pairId: pair.pairId, side, counterpart: { ticker: other.ticker, name: other.name, mint: other.mint, burns: confirmed.length, burned: rawToTokens(burnedRaw, DECIMALS), supply: rawToTokens(supply, DECIMALS), lastBurnAt: last?.settledAt ?? null }, clause, winnerTakesBurn, forwards, unpaired: reg.getStatus ? pairUnlinked({ getStatus: reg.getStatus.bind(reg) }, pair.pairId) : null, ...(await pairChainFields(chain, pair.mintA, pair.mintB, side)) };
}

// ReceiptJson / TokenStatusJson live in pageTypes.ts (no runtime imports) so the public SDK can type the API without this module.
export type { ReceiptJson, TokenProgramJson, TokenStatusJson } from "@/lib/burnticker/pageTypes";

const ZERO = BigInt(0);
const sumRaw = (xs: readonly (bigint | null)[]) => xs.reduce<bigint>((a, b) => a + (b ?? ZERO), ZERO);
const pct = (part: bigint, whole: bigint) => (whole === ZERO ? 0 : Number((part * BigInt(1_000_000)) / whole) / 10_000);
const sol = (l: bigint | null | undefined) => (l === null || l === undefined ? null : rawToTokens(l, 9));
const fracStr = (f: number) => f.toFixed(6).replace(/0+$/, "").replace(/\.$/, ".0");

/** Recomputes every receipt from the recorded readings and the rule; checks it against the row and its on-chain memo. */
export function buildReceiptsJson(i: TokenPageInput): ReceiptJson[] {
  const { rule, sha12 } = i.locked;
  const byId = new Map(i.readings.map((r) => [r.id, r]));
  const feed = rule.oracle === "catalogue" && rule.series ? feedById(rule.series) : null;
  return i.receipts.map((b) => {
    const rd = byId.get(b.eventId) ?? null;
    const checks: string[] = [];
    const ev: SettledEvent = { id: b.eventId, at: b.settledAt, result: (b.result ?? null) as SettledEvent["result"], value: b.value, title: rd?.title ?? null, sourceUrl: rd?.sourceUrl ?? "" };
    const clock = b.kind === "winddown" || b.kind === "drain" || b.kind === "sweep";
    if (clock) {
      // No burn pool is ever left behind: an end-of-rule receipt has no reading (a date-based clock); its units follow from the rule.
      const f = ruleMappings(rule)[0]?.mapping.fractionOfPool ?? 0;
      const want = b.kind === "drain" ? (f >= 1 ? 1 : null) : !rule.onEnd || !(f > 0) ? null : b.kind === "winddown" ? windDownUnits(f, rule.onEnd.windDownDays) : fullSpendUnits(f);
      if (want === null) checks.push(`a ${b.kind} receipt on a rule without ${b.kind === "drain" ? "a 100 % one-shot mapping" : "the onEnd clause"}`);
      else if (b.units !== want) checks.push(`${b.kind} units: the rule gives ${want}, recorded ${b.units}`);
      if (JSON.stringify(b.mapping) !== JSON.stringify(ruleMappings(rule)[0]?.mapping ?? null)) checks.push(`${b.kind} mapping ≠ the rule's mapping`);
    } else if (!rd) checks.push("no recorded reading for this event");
    else if ((rd.result ?? null) !== (b.result ?? null) || (rd.value ?? null) !== (b.value ?? null)) checks.push("receipt result/value ≠ the recorded reading");
    let recomputedUnits = b.units;
    if (!clock) try {
      // Winner takes the burn: a LOST receipt carries the units this coin would have had had it won — recomputed with the mirrored mapping.
      const s = unitStep(b.pairRole === "lost" ? pairMirrorRule(rule) : rule, ev, { value: b.prevValue, carryOut: b.carryIn }, feed?.carry ?? "none");
      recomputedUnits = s.units;
      if (s.units !== b.units) checks.push(`units: recomputed ${s.units}, recorded ${b.units}`);
      if (JSON.stringify(s.mapping) !== JSON.stringify(b.mapping)) checks.push("mapping: recomputed differs from recorded");
    } catch (e) { checks.push(`recomputation failed: ${(e as Error).message}`); }
    let expectedSpend: bigint | null = null;
    const prog = b.execution === "program";
    const together = prog && b.readingDate !== null ? i.receipts.filter((x) => x.readingDate === b.readingDate) : [];
    const readingUnits = together.reduce((a, x) => a + x.units, 0);
    const bps = b.mapping?.fractionOfPool !== undefined ? Math.round(b.mapping.fractionOfPool * 10_000) : 0;
    const fwd = b.status === "forwarded";
    if (fwd && b.lead && b.poolLamports !== null) {
      // forward_to_winner moves buyback_spend(pool, the reading's units, this coin's fraction) — 0 under the floor.
      expectedSpend = programBuybackSpend(b.poolLamports, BigInt(readingUnits), bps);
      if (b.spendLamports !== null && b.spendLamports !== expectedSpend && b.spendLamports !== ZERO) checks.push(`forwarded: recomputed ${expectedSpend} lamports, the program moved ${b.spendLamports}`);
    } else if (prog && b.lead && i.locked.mode === "buyback" && b.poolLamports !== null && b.ruleSpendLamports !== null) {
      // The program's own fixed-point rule spend over the reading's units; the crank spends ≤ 2 % of the pool's reserve and carries the rest.
      expectedSpend = programBuybackSpend(b.poolLamports, BigInt(readingUnits), bps);
      if (expectedSpend !== b.ruleSpendLamports) checks.push(`rule spend: recomputed ${expectedSpend} lamports, the program recorded ${b.ruleSpendLamports}`);
      if (b.spendLamports !== null && b.carriedInLamports !== null && b.carriedOutLamports !== null && b.spendLamports + b.carriedOutLamports > b.ruleSpendLamports + b.carriedInLamports) checks.push("spent + carried out > rule spend + carried in");
    }
    if (fwd && b.memo) {
      const fm = parseForwardMemo(b.memo);
      if (!fm) checks.push("forward memo does not parse (v1)");
      else {
        if (fm.prefix !== i.token.ticker || fm.from !== i.token.mint.slice(0, 12) || (b.readingDate !== null && fm.period !== formatU32(b.readingDate))) checks.push("forward memo fields ≠ this coin and period");
        if (b.lead && b.spendLamports !== null && fm.lamports !== b.spendLamports) checks.push("forward memo lamports ≠ the recorded amount");
      }
    } else if (prog && b.memo) {
      const pm = i.locked.mode === "buyback" ? parseProgramBuybackMemo(b.memo) : parseProgramVaultMemo(b.memo);
      if (!pm) checks.push(`memo does not parse (program ${i.locked.mode === "buyback" ? "v2" : "v1"})`);
      else {
        if (pm.prefix !== i.token.ticker || (b.readingDate !== null && pm.recordDate !== formatU32(b.readingDate)) || pm.units !== readingUnits || BigInt(pm.now) - BigInt(pm.prev) !== BigInt(readingUnits)) checks.push("memo fields ≠ the receipts counted into this reading");
        if (pm.rulesSha12 !== sha12) checks.push(`memo rules hash ${pm.rulesSha12} ≠ the published rule ${sha12}`);
        if (b.lead && b.burnRaw !== null && pm.burn !== rawToTokens(b.burnRaw, DECIMALS)) checks.push("memo burn ≠ recorded burn");
        if (b.lead && "spent" in pm && b.spendLamports !== null && (pm.spent !== b.spendLamports.toString() || (b.poolLamports !== null && pm.pool !== b.poolLamports.toString()))) checks.push("memo pool/spent ≠ the program's recorded amounts");
        if (b.lead === false && ((b.burnRaw ?? ZERO) > ZERO || (b.spendLamports ?? ZERO) > ZERO)) checks.push("a non-lead receipt carries amounts");
      }
    }
    if (!prog && i.locked.mode === "buyback" && b.poolLamports !== null && b.mapping?.fractionOfPool !== undefined) {
      expectedSpend = buybackSpend(b.poolLamports, b.units, fracStr(b.mapping.fractionOfPool));
      if (b.spendLamports !== null && expectedSpend !== b.spendLamports) checks.push(`spend: recomputed ${expectedSpend} lamports, recorded ${b.spendLamports}`);
    }
    const m = b.memo && !prog ? parseReceiptMemo(b.memo) : null;
    if (b.memo && !prog) {
      if (!m) checks.push("memo does not parse (v3)");
      else {
        if (m.id !== b.eventId || m.ticker !== i.token.ticker || m.units !== b.units || m.result !== (b.result ?? "-") || m.value !== (b.value ?? "-")) checks.push("memo fields ≠ the recorded receipt");
        if (b.status === "confirmed") {
          if (b.poolLamports !== null && m.pool !== b.poolLamports.toString()) checks.push("memo pool ≠ recorded pool");
          if (b.spendLamports !== null && m.spent !== b.spendLamports.toString()) checks.push("memo spent ≠ recorded spend");
          if (b.burnRaw !== null && m.burn !== rawToTokens(b.burnRaw, DECIMALS)) checks.push("memo burn ≠ recorded burn");
          if (b.gotRaw !== null && i.locked.mode === "buyback" && m.got !== rawToTokens(b.gotRaw, DECIMALS)) checks.push("memo got ≠ what the swap delivered");
          if (b.gotRaw !== null && b.burnRaw !== null && b.burnRaw < b.gotRaw) checks.push("burned less than the swap delivered");
        }
        if (m.rulesSha12 !== sha12) checks.push(`memo rules hash ${m.rulesSha12} ≠ the published rule ${sha12}`);
      }
    }
    const verified = (b.status === "confirmed" || b.status === "forwarded" || b.status === "skipped" || b.status === "void" || b.status === "nothing" || b.status === "exhausted" || b.status === "voided") && checks.length === 0;
    const curl = feed
      ? `curl -s '${rd?.sourceUrl ?? feed.sourceUrl}'   # ${feed.sourceName}: the row for ${b.eventId}${b.prevValue !== null ? ` (previous reading ${b.prevValue})` : ""}; selection: ${JSON.stringify(feed.config.select)}`
      : `curl -s '${rd?.sourceUrl ?? `https://api.elections.kalshi.com/trade-api/v2/markets/${b.eventId}`}' | jq '.market // .markets | if type=="array" then map({ticker, result, expiration_value, settlement_ts}) else {ticker, result, expiration_value, settlement_ts} end'`;
    const formula = rule.kind === "binary"
      ? `result = ${b.result ?? "?"} → ${b.mapping ? (b.mapping.fractionOfPool !== undefined ? `spend ${b.mapping.fractionOfPool * 100}% of the pool` : `burn ${b.mapping.tokens} tokens`) : "nothing"}${!prog && i.locked.mode === "buyback" && b.poolLamports !== null ? `; spend = ${b.poolLamports} × ${b.mapping?.fractionOfPool ?? 0} = ${expectedSpend} lamports` : ""}`
      : `units = floor((${b.value ?? "?"} − ${b.prevValue !== null && rule.scalar!.baseline === "previousSettlement" ? b.prevValue : rule.scalar!.baseline}${b.carryIn !== "0" ? ` + ${b.carryIn} carried` : ""}) / ${rule.scalar!.unit}) = ${recomputedUnits} (direction ${rule.scalar!.direction})${prog ? "" : i.locked.mode === "buyback" && b.poolLamports !== null ? `; spend = pool × (1 − (1 − ${b.mapping?.fractionOfPool ?? 0})^${b.units}) = ${b.poolLamports} × … = ${expectedSpend} lamports` : i.locked.mode === "vault" ? `; burn = ${b.units} × ${b.mapping?.tokens ?? 0} tokens` : ""}`;
    const programFormula = prog && b.readingDate ? `; counted into program reading ${formatU32(b.readingDate)} (${readingUnits} unit(s) from ${together.length} receipt(s)) — the program ${i.locked.mode === "buyback" ? `spends min(pool × (1 − (1 − ${bps}/10000)^${readingUnits}) + carried spend, 2% of the pool's SOL reserve)${b.lead && b.poolLamports !== null ? ` = rule spend ${expectedSpend} lamports from a ${b.poolLamports}-lamport pool` : ""} and burns everything the fee PDA holds` : `burns ${readingUnits} × ${b.mapping?.tokens ?? 0} tokens from its vault, shortfall carried`}` : "";
    const expected = fwd ? `forwarded — this coin lost the period: ${sol(b.spendLamports) ?? "its"} SOL of its fuel moved to the winning coin's burn pool by forward_to_winner (winner takes the burn); nothing of $${i.token.ticker} was bought or burned` : b.status === "pending-pair" ? "pending-pair — both or neither: this burn executes, in order, once both coins of the pair have a registered pool (or is voided if the pair voids)" : b.status === "voided" ? `voided — ${b.skippedReason ?? "the pair voided"}: no event burn, ever` : prog && b.waitReason && (b.status === "planned" || b.status === "sending") ? `pending — ${b.waitReason}` : prog && b.lead === false ? `burned together with this reading's first receipt (the same crank${b.signature ? `, ${b.signature.slice(0, 12)}…` : ""})` : b.status === "skipped" ? `nothing bought — ${b.skippedReason ?? "skipped"}` : b.status === "void" ? "void market: no burn (a receipt all the same)" : b.status === "nothing" ? `no burn: ${b.note}` : prog && b.lead ? (i.locked.mode === "buyback" ? `rule spend ${expectedSpend ?? "?"} lamports; spent ${b.spendLamports ?? "pending"} (${sol(b.spendLamports) ?? "?"} SOL) buying $${i.token.ticker}; burned every token the fee PDA held (${b.burnRaw === null ? "pending" : rawToTokens(b.burnRaw, DECIMALS)})` : `burn ${b.burnRaw === null ? "pending" : rawToTokens(b.burnRaw, DECIMALS)} from the program's vault${b.shortOutRaw && b.shortOutRaw > ZERO ? ` (${rawToTokens(b.shortOutRaw, DECIMALS)} short, carried)` : ""}`) : i.locked.mode === "buyback" ? `spend ${expectedSpend ?? "?"} lamports (${sol(expectedSpend) ?? "?"} SOL) buying $${i.token.ticker} at market; burn every token received (${b.gotRaw === null ? "pending" : rawToTokens(b.gotRaw, DECIMALS)})` : `burn ${b.burnRaw === null ? "pending" : rawToTokens(b.burnRaw, DECIMALS)} from the vault${b.shortOutRaw && b.shortOutRaw > ZERO ? ` (${rawToTokens(b.shortOutRaw, DECIMALS)} short, carried)` : ""}`;
    return {
      eventId: b.eventId, settledAt: b.settledAt, oracle: rule.oracle, market: b.eventId, result: b.result, value: b.value, title: rd?.title ?? null, method: rd?.method ?? null, sourceUrl: rd?.sourceUrl ?? null, settlementSourceUrl: rd?.settlementSourceUrl ?? null,
      units: b.units, kind: b.kind, note: b.note, prevValue: b.prevValue, carryIn: b.carryIn, mapping: b.mapping,
      pool: sol(b.poolLamports), spent: sol(b.spendLamports), got: b.gotRaw === null ? null : rawToTokens(b.gotRaw, DECIMALS), burned: b.burnRaw === null ? null : rawToTokens(b.burnRaw, DECIMALS), shortOut: b.shortOutRaw === null ? null : rawToTokens(b.shortOutRaw, DECIMALS),
      status: b.status, skippedReason: b.skippedReason, memo: b.memo, signature: b.signature, txUrl: b.signature ? explorerUrl(i.chain.cluster, b.signature) : null,
      execution: prog ? "program" : null, readingDate: b.readingDate !== null ? formatU32(b.readingDate) : null, lead: b.lead, waitReason: b.waitReason,
      partial: [prog && b.lead && (b.spendLamports ?? ZERO) > ZERO && (b.carriedOutLamports ?? ZERO) > ZERO ? `spend cap bound (2% of the pool's reserve): ${sol(b.carriedOutLamports)} SOL carried into the next crank` : null,
        prog && b.lead && b.poolActualLamports !== null && b.poolLamports !== null && b.poolActualLamports > b.poolLamports ? `burn-pool cap bound: the rule applied to ${sol(b.poolLamports)} of ${sol(b.poolActualLamports)} SOL` : null].filter(Boolean).join("; ") || null,
      verify: { curl, formula: formula + programFormula, expected, checks, verified },
      ...(b.pairRole ? { pairRole: b.pairRole } : {}),
    };
  });
}

export function buildTokenStatus(i: TokenPageInput, receipts: readonly ReceiptJson[] = buildReceiptsJson(i)): TokenStatusJson {
  const { rule } = i.locked;
  const t = i.token;
  const supplyRaw = tokensToRaw(TOTAL_SUPPLY, DECIMALS);
  const confirmed = i.receipts.filter((b) => b.status === "confirmed");
  const totalRaw = sumRaw(confirmed.map((b) => b.burnRaw));
  const last30 = sumRaw(confirmed.filter((b) => (b.confirmedAt ?? 0) > i.now - 30 * 86_400_000).map((b) => b.burnRaw));
  const current = i.chain.supplyRaw ?? supplyRaw - totalRaw;
  const addr = (a: string | null) => (a ? explorerUrl(i.chain.cluster, a, "address") : null);
  const lastFinal = [...i.receipts].reverse().find((b) => b.status === "confirmed" || b.status === "exhausted");
  const allocation = i.locked.mode === "vault" ? (BigInt(TOTAL_SUPPLY) * BigInt(Math.round(rule.vault!.share * 100))) / BigInt(100) : null;
  const activeAtt = i.attesters.filter((a) => a.active);
  const program = buildTokenProgram(i);
  const lastBurn = [...confirmed].filter((b) => (b.burnRaw ?? ZERO) > ZERO).sort((x, y) => (x.settledAt < y.settledAt ? 1 : -1))[0];
  return {
    schema: TOKEN_STATUS_SCHEMA, generatedAt: new Date(i.now).toISOString(), ticker: t.ticker, name: t.name, mint: t.mint, cluster: i.chain.cluster, status: t.status, launchedAt: t.launchTx ? t.baselineAt : null,
    oracle: rule.oracle, selectorKey: t.selectorKey, seriesTitle: i.seriesTitle, mode: i.locked.mode,
    rules: { sha256: i.locked.sha256, sha12: i.locked.sha12, statement: ruleStatement(rule, { seriesTitle: i.seriesTitle }), file: "rules.json", oneShot: !!rule.market },
    addresses: (() => { let feeWsol: string | null = null; try { feeWsol = i.chain.programId ? burnPoolAddresses(i.chain.programId, t.mint).feeWsol : null; } catch { feeWsol = null; } return { mint: t.mint, mintUrl: addr(t.mint)!, feePda: t.feePda, feePdaUrl: addr(t.feePda)!, feeWsol, feeWsolUrl: addr(feeWsol), vault: t.vault, vaultUrl: addr(t.vault), creator: t.creator, creatorUrl: addr(t.creator)!, programId: i.chain.programId, poolId: t.poolId, launchTx: t.launchTx, launchTxUrl: t.launchTx ? explorerUrl(i.chain.cluster, t.launchTx) : null }; })(),
    supply: { initial: TOTAL_SUPPLY, current: rawToTokens(current, DECIMALS), source: i.chain.supplyRaw !== null ? "chain" : "registry" },
    burned: { total: rawToTokens(totalRaw, DECIMALS), pctOfSupply: pct(totalRaw, supplyRaw), count: confirmed.filter((b) => (b.burnRaw ?? ZERO) > ZERO).length, last30d: rawToTokens(last30, DECIMALS), lastAt: lastBurn?.settledAt ?? null },
    pool: (() => { const spendable = i.chain.feePdaLamports === null ? null : spendablePool(i.chain.feePdaLamports, rule.reserveSol); const c = spendable === null ? null : capPool(spendable); return { feePdaSol: sol(i.chain.feePdaLamports), spendableSol: c === null ? null : sol(c.pool), reserveSol: rule.reserveSol, vaultBalance: i.chain.vaultRaw === null ? null : rawToTokens(i.chain.vaultRaw, DECIMALS), vaultAllocation: allocation === null ? null : allocation.toString(), shortfallOutstanding: rawToTokens(lastFinal?.shortOutRaw ?? ZERO, DECIMALS), capSol: PRE_AUDIT_POOL_CAP_SOL, queuedSol: c === null ? null : sol(c.queued), queuedNote: `pre-audit cap: burns spend from at most ${PRE_AUDIT_POOL_CAP_SOL} SOL; fee income above it is queued, released after audit (enforced by the keeper today; by the program once deployed)` }; })(),
    // NO ODDS FOR ANY COIN (owner decision 2026-10-10): impliedChance is always null — the field stays for schema compatibility only.
    next: { nextCheckAt: i.nextCheckAt ? new Date(i.nextCheckAt).toISOString() : null, impliedChance: null, impliedBasis: i.implied?.chance == null ? (i.implied?.basis ?? null) : null, nextMarket: i.implied?.marketTicker ?? null, nextCloseTime: i.implied?.closeTime ?? null, awaitingFinal: i.selectorPending },
    feed: { lastEventId: i.state.lastEventId, lastValue: i.state.lastValue, lastSettledAt: i.state.lastSettledAt, readings: i.readings.length, lastFetchAt: i.feedState.lastFetchAt ? new Date(i.feedState.lastFetchAt).toISOString() : null, lastError: i.feedState.lastError, failures: i.feedState.failures },
    attesters: i.attesters.map((a) => ({ pubkey: a.pubkey, role: a.role, active: a.active })), quorum: i.chain.program?.config?.quorum ?? Math.max(1, Math.min(activeAtt.length, 1)),
    fees: { curve: CURVE_FEES, postGraduation: POST_GRADUATION_FEES, sentence: feeSplitSentence(), creatorSliceBps: 0 },
    health: { pending: i.receipts.filter((b) => b.status === "planned" || b.status === "sending").length, unverified: receipts.filter((r) => r.status === "confirmed" && !r.verify.verified).length, lastError: i.receipts.find((b) => b.lastError)?.lastError ?? i.feedState.lastError },
    disclosure: { disclaimer: DISCLAIMER_FOOTER, eventContract: oracleDisclosure(rule.oracle) },
    trust: { lpBurnedPct: LP_BURNED_PCT, lpLockedPct: LP_LOCKED_PCT, lpPolicy: "locked-forever", creatorCashBps: 0, teamAllocationPct: 0, operator: i.operator, registerUrl: "/burnticker/trust" },
    lp: i.lp ?? defaultLp(i),
    program,
    profile: { imageUrl: t.imageUrl, description: t.description.replace(descriptionFooter(i.locked), "").trim(), links: t.links, oneLiner: ruleOneLiner(rule, i.seriesTitle), badge: badgeFromText(rule, t.description, t.status === "retired"), note: i.meta?.creatorNote ?? "", affiliation: AFFILIATION_LINE },
    pinned: i.meta ? { metadataUri: i.meta.metadataUri, metadataTx: i.meta.metadataTx, metadataSha256: i.meta.metadataSha256, imageUri: i.meta.imageUri, imageTx: i.meta.imageTx, imageSha256: i.meta.imageSha256, hosted: i.meta.hosted, expectedDescription: `${badgeFromText(rule, t.description)}\n${t.description}` } : null,
    market: buildMarketJson({ cluster: i.chain.cluster, mint: t.mint, status: t.status, poolId: t.poolId, graduatedPool: program?.pool.registered && t.status !== "draft" && t.status !== "expired" ? program.pool.address : null, read: i.market }),
    lifecycle: i.lifecycle ?? null,
    pair: i.pair ? { ...i.pair, tally: { burnsThis: confirmed.filter((b) => (b.burnRaw ?? ZERO) > ZERO).length, burnsOther: i.pair.counterpart.burns, burnedThis: rawToTokens(totalRaw, DECIMALS), burnedOther: i.pair.counterpart.burned, supplyThis: rawToTokens(current, DECIMALS), supplyOther: i.pair.counterpart.supply }, pageUrl: `/burnticker/p/${i.pair.pairId}` } : null,
  };
}

/** The policy block without a chain read (no claim recorded, Fee Key unknown until graduation). */
function defaultLp(i: TokenPageInput): LpLockJson {
  let keys: string | null = null;
  try { keys = i.chain.programId ? feeKeysPda(i.chain.programId).toBase58() : null; } catch { keys = null; }
  return buildLpLockJson({ cluster: i.chain.cluster, mint: i.token.mint, programId: i.chain.programId || null, state: null, feeKeysPda: keys, operatorTreasury: operatorTreasuryFor(i.chain.cluster), claims: [], explorer: (id, kind) => solscanUrl(i.chain.cluster, id, kind) });
}

/** The coin page's LP block: "LP locked forever · fees fund the burn", the addresses (Solscan) and the last claim. */
export function lpLockHtml(lp: LpLockJson | null | undefined): string {
  if (!lp) return "";
  const a = (addr: string | null, url: string | null) => (addr ? (url ? `<a href="${esc(url)}"><code>${esc(addr)}</code></a>` : `<code>${esc(addr)}</code>`) : "<em>appears at graduation</em>");
  return `<h2>${esc(LP_POLICY_BADGE)}</h2>
<p>${esc(lp.line)}. ${lp.lockedPct}% of the graduation LP is locked with Raydium's LP lock and can never be withdrawn; the Fee Key is owned by the burn program, and anyone can call claim_lock_fees: ${lp.split.burnBps / 100}% of the SOL side to this coin's burn pool, ${lp.split.operatorBps / 100}% to the operator treasury, the coin side burned.</p>
<p class="muted">Lock program ${a(lp.lockProgram, lp.urls.lockProgram)} · Fee Key ${a(lp.feeKey, lp.urls.feeKey)} · Fee Key owner ${a(lp.feeKeyOwner, lp.urls.feeKeyOwner)}${lp.lockedLiquidity ? ` · locked liquidity ${a(lp.lockedLiquidity, lp.urls.lockedLiquidity)}` : ""} · operator treasury ${lp.operatorTreasury ? a(lp.operatorTreasury, lp.urls.operatorTreasury) : "<em>not pinned on this cluster</em>"}</p>
<p class="muted">${lp.lastClaim ? `Last claim ${esc(lp.lastClaim.at.slice(0, 16).replace("T", " "))}Z: ${lp.lastClaim.txUrl ? `<a href="${esc(lp.lastClaim.txUrl)}">${esc(lp.lastClaim.line)}</a>` : esc(lp.lastClaim.line)} · ${lp.totals.claims} claim(s), ${esc(lp.totals.sol)} SOL in all (${esc(lp.totals.toBurnPool)} to the burn pool, ${esc(lp.totals.toOperator)} to the operator)` : "No LP-fee claim yet."}${lp.note ? ` · ${esc(lp.note)}` : ""}</p>`;
}

const ATTESTER_KIND: Record<number, string> = { 0: "operator", 1: "zkTLS relayer", 2: "oracle" };

/** The program block of status.json, from the TokenConfig read this cycle and the receipts. */
export function buildTokenProgram(i: TokenPageInput): TokenProgramJson | null {
  const p = i.chain.program;
  if (!p) return null;
  const c = p.config, keys = new Set(p.keeperKeys);
  const pending = i.receipts.filter((b) => b.status === "planned" || b.status === "sending");
  const holds = c ? c.attesters.filter((a) => keys.has(a.key)).length : 0;
  return {
    programId: i.chain.programId, config: c?.config ?? null, initialized: !!c,
    attesters: (c?.attesters ?? []).map((a) => ({ key: a.key, kind: ATTESTER_KIND[a.kind] ?? String(a.kind), heldByKeeper: keys.has(a.key) })), quorum: c?.quorum ?? 0, keeperHolds: holds, quorumMet: !!c && holds >= c.quorum, adminRenounced: c?.adminRenounced ?? false,
    lastReading: p.lastReading ? { ...p.lastReading, txUrl: explorerUrl(i.chain.cluster, p.lastReading.signature) } : null,
    queue: {
      lastOnChain: c?.hasBaseline ? formatU32(c.lastRecordDate) : null, crankCursor: c?.crankCursor ? formatU32(c.crankCursor) : null,
      notAttested: pending.filter((b) => b.readingDate === null).length, awaitingCrank: pending.filter((b) => b.readingDate !== null).length,
      carriedSpendSol: sol(c?.carriedSpendLamports ?? ZERO) ?? "0",
      waits: pending.filter((b) => b.waitReason).map((b) => ({ eventId: b.eventId, reason: b.waitReason! })),
      partials: i.receipts.filter((b) => b.execution === "program" && b.lead && (((b.spendLamports ?? ZERO) > ZERO && (b.carriedOutLamports ?? ZERO) > ZERO) || (b.poolActualLamports !== null && b.poolLamports !== null && b.poolActualLamports > b.poolLamports)))
        .map((b) => ({ readingDate: b.readingDate !== null ? formatU32(b.readingDate) : "?", note: [(b.carriedOutLamports ?? ZERO) > ZERO && (b.spendLamports ?? ZERO) > ZERO ? `${sol(b.carriedOutLamports)} SOL carried (2% reserve cap)` : null, b.poolActualLamports !== null && b.poolLamports !== null && b.poolActualLamports > b.poolLamports ? `burn-pool cap: ${sol(b.poolLamports)} of ${sol(b.poolActualLamports)} SOL` : null].filter(Boolean).join("; ") })),
    },
    pool: { registered: !!c?.poolRegistered, address: c?.pool ?? null, untradeableSince: c?.poolUntradeableSince ? new Date(c.poolUntradeableSince * 1000).toISOString() : null },
    totals: { readings: c?.readings ?? 0, burns: c?.burns ?? 0, burned: rawToTokens(c?.totalBurned ?? ZERO, DECIMALS), spentSol: sol(c?.totalSpentLamports ?? ZERO) ?? "0" },
  };
}

function programSection(p: TokenProgramJson | null): string {
  if (!p) return "";
  const q = p.queue;
  return `<h2>The burn program</h2>
<p class="muted">Burns run through the burn_receipts program <code>${esc(p.programId)}</code>${p.config ? ` (token config <code>${esc(p.config)}</code>)` : ""}: the keeper attests each closed day's units (a counter: 1 + every unit the receipts carried), anyone can crank, and the program swaps from the fee PDA and burns in one instruction, writing the memo itself.${p.initialized ? "" : " <strong>No config is readable for this mint yet.</strong>"}</p>
<p>Attestation: quorum <strong>${p.quorum}</strong> of ${p.attesters.length} — ${p.attesters.map((a) => `<code>${esc(a.key)}</code> (${esc(a.kind)}${a.heldByKeeper ? ", this keeper" : ""})`).join(", ") || "—"}.${p.quorumMet ? "" : ` <span class="bad">The keeper holds ${p.keeperHolds}: readings wait for the other attester(s).</span>`}${p.adminRenounced ? " The config authority has renounced." : ""} Last reading: ${p.lastReading ? `${esc(p.lastReading.date)} · <a href="${esc(p.lastReading.txUrl)}">${esc(p.lastReading.signature.slice(0, 12))}…</a>` : "none yet"}.</p>
<p>Queue: last reading on chain ${esc(q.lastOnChain ?? "—")}, processed through ${esc(q.crankCursor ?? "—")} · ${q.notAttested} receipt(s) not yet attested · ${q.awaitingCrank} attested, waiting for a crank · carried spend ${esc(q.carriedSpendSol)} SOL.${q.waits.length ? ` Waiting: ${q.waits.slice(0, 5).map((w) => `${esc(w.eventId)} — ${esc(w.reason)}`).join("; ")}.` : ""}${q.partials.length ? ` Partial days: ${q.partials.map((x) => `${esc(x.readingDate)} (${esc(x.note)})`).join("; ")}.` : ""}</p>
<p>Pool: ${p.pool.registered ? `<code>${esc(p.pool.address)}</code> — ${p.pool.untradeableSince ? `<span class="bad">untradeable since ${esc(p.pool.untradeableSince)}</span>` : "tradeable"}` : "not registered yet (the curve has not graduated, or register_pool has not run)"} · program totals: ${p.totals.readings} readings, ${p.totals.burns} burns, ${fmt(p.totals.burned)} burned, ${esc(p.totals.spentSol)} SOL spent.</p>`;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------------------------------------------------------------

const esc = (s: string | number | null | undefined) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
const fmt = (s: string) => { const [w, f] = s.split("."); return w.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (f ? `.${f}` : ""); };
const feeTable = (f: FeeSplit) => `<table><thead><tr><th>${esc(f.phase)}</th><th>bps</th><th>SOL per 1 SOL traded</th><th>to</th><th>dial</th></tr></thead><tbody>${f.legs.map((l) => `<tr><td>${esc(l.label)}</td><td class="num">${l.bps}</td><td class="num">${esc(bpsPerSol(l.bps))}</td><td>${esc(l.recipient)}</td><td class="muted">${esc(l.dial)}</td></tr>`).join("")}<tr><td>total</td><td class="num">${f.totalBps}</td><td class="num">${esc(bpsPerSol(f.totalBps))}</td><td></td><td></td></tr></tbody></table>`;

export function renderTokenHtml(s: TokenStatusJson, receipts: readonly ReceiptJson[], readings: readonly ReadingRow[]): string {
  const t = esc(s.ticker);
  const rows = [...receipts].reverse();
  const tile = (label: string, value: string, sub = "") => `<div class="tile"><div class="label">${esc(label)}</div><div class="value">${value}</div>${sub ? `<div class="sub">${sub}</div>` : ""}</div>`;
  const check = (b: ReceiptJson) => (b.verify.verified ? `<span class="ok" title="recomputed from the reading and the rule; matches the memo on chain">✓</span>` : b.status === "confirmed" ? `<span class="bad" title="${esc(b.verify.checks.join("; "))}">!</span>` : "…");
  const link = (url: string | null, sig: string | null, fallback: string) => (url && sig ? `<a href="${esc(url)}">${esc(sig.slice(0, 10))}…</a>` : esc(fallback));
  const chartReadings = readings.filter((r) => r.value !== null).map((r) => ({ recordDate: r.at, amount: r.value! }));
  const chart = (s.oracle === "kalshi" || s.oracle === "polymarket") && readings.every((r) => r.value === null)
    ? `<p class="muted">Binary selector: ${readings.length} settled market(s) read — ${readings.filter((r) => r.result === "yes").length} YES, ${readings.filter((r) => r.result === "no").length} NO, ${readings.filter((r) => r.result === "void").length} void.</p>`
    : seriesChartSvg(chartReadings, receipts.map((b) => ({ recordDate: b.settledAt, units: b.units, status: b.status })), { ariaLabel: `${s.seriesTitle ?? s.selectorKey}, with a marker on each burn`, tick: (v) => (Math.abs(v) >= 1e12 ? `$${(v / 1e12).toFixed(2)}T` : Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : String(Number(v.toFixed(2)))) });
  const tiles = [
    tile("Supply", fmt(s.supply.current), `of ${fmt(s.supply.initial)} (${esc(s.supply.source)})`),
    tile("Burned", fmt(s.burned.total), `${s.burned.pctOfSupply.toFixed(2)}% of supply · ${s.burned.count} burn(s) · ${fmt(s.burned.last30d)} in 30 d`),
    s.mode === "buyback" ? tile("Burn pool (fee PDA)", s.pool.feePdaSol === null ? "—" : `${esc(s.pool.feePdaSol)} SOL`, `spendable ${esc(s.pool.spendableSol ?? "—")} SOL after a ${esc(s.pool.reserveSol)} SOL reserve${s.pool.queuedSol && s.pool.queuedSol !== "0" ? ` · ${esc(s.pool.queuedSol)} SOL queued, released after audit (${s.pool.capSol} SOL cap)` : ""}`) : tile("Vault", s.pool.vaultBalance === null ? "—" : fmt(s.pool.vaultBalance), `allocation ${fmt(s.pool.vaultAllocation ?? "0")} · shortfall owed ${fmt(s.pool.shortfallOutstanding)}`),
    tile("Next possible burn", `<span id="next" data-at="${esc(s.next.nextCheckAt ?? "")}">${esc(s.next.nextCheckAt ?? (s.rules.oneShot ? "resolves once" : "—"))}</span>`, s.next.awaitingFinal ? `${s.next.awaitingFinal} settlement(s) awaiting the venue's finalisation` : "the next reading of the selector"),
  ].filter(Boolean).join("\n");
  const table = rows.length === 0 ? `<p class="muted">No receipts yet. The first settlement after launch${s.rules.oneShot ? "" : " (or the baseline, for a vs-previous rule)"} starts the record.</p>` : `<div class="scroll"><table>
<thead><tr><th>Settled</th><th>Market / period</th><th>Result</th><th>Value</th><th>Units</th><th>Spent</th><th>Bought</th><th>Burned</th><th>Tx</th><th>Source</th><th>Check</th></tr></thead><tbody>
${rows.map((b) => `<tr><td>${esc(b.settledAt.slice(0, 19).replace("T", " "))}</td><td title="${esc(b.title)}"><code>${esc(b.market)}</code></td><td>${esc(b.result ?? "—")}</td><td class="num">${esc(b.value ?? "—")}</td><td class="num">${b.units}</td><td class="num">${b.status === "confirmed" ? esc(b.spent ?? "—") : "—"}</td><td class="num">${b.got === null ? "—" : fmt(b.got)}</td><td class="num">${b.status === "confirmed" ? fmt(b.burned ?? "0") : `<span class="muted" title="${esc(b.skippedReason ?? b.note)}">${esc(b.status)}</span>`}</td><td>${link(b.txUrl, b.signature, b.status === "planned" || b.status === "sending" ? (b.waitReason ? "waiting" : "pending") : "—")}</td><td>${b.settlementSourceUrl ? `<a href="${esc(b.settlementSourceUrl)}">source</a>` : ""}${b.sourceUrl ? ` <a href="${esc(b.sourceUrl)}">api</a>` : ""}</td><td>${check(b)}</td></tr>`).join("\n")}
</tbody></table></div>`;
  const verify = rows.slice(0, 60).map((b) => `<details><summary>${esc(b.settledAt.slice(0, 10))} · ${esc(b.market)} — ${esc(b.result ?? b.value ?? "")}, ${b.units} unit(s), ${b.status === "confirmed" ? `${fmt(b.burned ?? "0")} ${t} burned` : esc(b.status)}${b.verify.verified ? " ✓" : ""}</summary>
<p>1. Read the settled result from the source:</p><pre><code>${esc(b.verify.curl)}</code></pre>${b.method ? `<p class="muted">Value read by: ${esc(b.method)}</p>` : ""}
<p>2. Apply the rule:</p><pre><code>${esc(b.verify.formula)}</code></pre>
<p>3. Expected: <strong>${esc(b.verify.expected)}</strong></p>
<p>4. The receipt memo on chain${b.txUrl ? ` (<a href="${esc(b.txUrl)}">transaction</a>)` : ""}:</p><pre><code>${esc(b.memo ?? (b.status === "confirmed" ? "?" : `no transaction — ${b.status}`))}</code></pre>
${b.verify.checks.length ? `<p class="bad">Checks that did not pass: ${esc(b.verify.checks.join("; "))}</p>` : ""}
</details>`).join("\n");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>$${t} burn receipts</title>
<meta name="description" content="Every $${t} burn, indexed to ${esc(s.seriesTitle ?? s.selectorKey)}, with the settled source and the arithmetic to check it.">
<style>
${STATUS_CSS}
.embed{background:var(--card);border:1px dashed var(--line);border-radius:10px;padding:24px;text-align:center;color:var(--muted)}
.today{white-space:pre-wrap;word-break:break-word;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 16px;font:inherit;line-height:1.5}
</style></head><body><main>
<p><a href="../../">← Burnticker</a></p>
${s.pair ? `<div class="rule"><strong>$${t} <span class="muted">vs</span> <a href="../${esc(s.pair.counterpart.ticker)}/">$${esc(s.pair.counterpart.ticker)}</a></strong> — rivalry pair <code>${esc(s.pair.pairId)}</code> (this is side ${esc(s.pair.side)}; one selector, inverted mappings: each settlement burns exactly one side). Burns ${s.pair.tally.burnsThis} : ${s.pair.tally.burnsOther} · burned ${fmt(s.pair.tally.burnedThis)} : ${fmt(s.pair.tally.burnedOther)} · supply ${fmt(s.pair.tally.supplyThis)} : ${fmt(s.pair.tally.supplyOther)}${s.pair.counterpart.lastBurnAt ? ` · the other side last burned ${esc(s.pair.counterpart.lastBurnAt.slice(0, 10))}` : ""}. <a href="../../p/${esc(s.pair.pairId)}/">Pair page</a>.</div>` : ""}
<h1>$${t} <span class="muted" style="font-weight:400">${esc(s.name)}</span></h1>
${s.profile?.badge ? `<p><code>${esc(s.profile.badge)}</code></p>` : ""}${s.profile?.description ? `<p>${esc(s.profile.description)}</p>` : ""}${s.profile?.note ? `<p class="muted"><em>creator's note — not part of the rule:</em> ${esc(s.profile.note)}</p>` : ""}
<p class="muted">${esc(AFFILIATION_LINE)}</p>
${s.pinned?.metadataUri && !s.pinned.hosted ? `<p class="muted">Metadata pinned on Arweave · <a href="${esc(s.pinned.metadataUri)}">${esc(s.pinned.metadataUri)}</a> · sha256 <code>${esc(s.pinned.metadataSha256 ?? "")}</code></p>` : ""}
<p class="muted">${esc(s.oracle === "kalshi" ? "Kalshi" : s.oracle === "polymarket" ? "Polymarket (result read on Polygon)" : "first-party feed")} · <code>${esc(s.selectorKey)}</code>${s.seriesTitle ? ` · ${esc(s.seriesTitle)}` : ""} · ${esc(s.cluster)} · ${esc(s.status)} · updated ${esc(s.generatedAt)}</p>
<div class="rule"><strong>The rule.</strong> ${esc(s.rules.statement)}<br><span class="muted">Rule file: <a href="rules.json">rules.json</a> · sha256 <code>${esc(s.rules.sha256)}</code> · locked at launch; nobody can change it.</span>${s.rules.oneShot ? `<br><span class="muted">This rule resolves once${s.next.nextCloseTime ? `, on ${esc(s.next.nextCloseTime)}` : ""}; after that the supply is fixed.</span>` : ""}</div>
<div class="tiles">
${tiles}
</div>
<h2>Today</h2>
<pre class="today" id="today">${esc(tokenDayText(s, receipts, s.generatedAt.slice(0, 10)))}</pre>
<p class="muted">The same words as the day's post (scripts/burnkeeper-post-draft.mts; docs/launch/daily-post.md): a report of what the rule did today, filled from status.json and receipts.json, never retyped.</p>
<h2>${esc(s.seriesTitle ?? s.selectorKey)}</h2>
<p class="muted">Latest: ${s.feed.lastEventId ? `${esc(s.feed.lastValue ?? "")} · ${esc(s.feed.lastEventId)} (${esc(s.feed.lastSettledAt)})` : "no reading yet"} · ${s.feed.readings} reading(s). Dots mark burns (larger = more units).</p>
${chart}
<h2>Receipts</h2>
${table}
<h2>Verify it yourself</h2>
<p class="muted">Every receipt can be recomputed from the public settled result and the rule file. The keeper recomputes each one from its recorded readings and shows ✓ when that agrees with the memo it put on chain.</p>
${verify || `<p class="muted">Nothing to verify yet.</p>`}
${programSection(s.program)}
<h2>Trade</h2>
<div class="embed">LaunchLab curve embed — pool <code>${esc(s.addresses.poolId ?? "not created yet")}</code> (the embed is added when the LaunchLab adapter lands)</div>
<h2>Fees</h2>
<p>${esc(s.fees.sentence)}</p>
<div class="scroll">${feeTable(s.fees.curve)}</div>
<div class="scroll" style="margin-top:8px">${feeTable(s.fees.postGraduation)}</div>
<p class="muted">Creator fee slice: ${s.fees.creatorSliceBps} bps (creators earn no cash from fees; the creator-fee slot pays the burn pool). LP locked forever at graduation (${s.trust.lpLockedPct ?? LP_LOCKED_PCT}%): its fees fund the burn — 16.8 bps of every swap to the burn pool and 4.2 bps to the operator (80/20, fixed in code) — plus Raydium's fixed 4.75 bps CPMM creator fee to the burn pool. Sources: docs/burnkeeper/fees.md.</p>
${lpLockHtml(s.lp)}
<h2>What the operator can and cannot do</h2>
<p class="muted">Derived from the <a href="${esc(s.trust.registerUrl)}">Powers Register</a>${s.trust.operator.placeholder ? " (the register file is not on this host: rows from its environment)" : ""}. LP locked forever (${s.trust.lpLockedPct ?? LP_LOCKED_PCT}%; fees 80% burn pool / 20% operator) · creator cash from fees ${s.trust.creatorCashBps} bps · team allocation ${s.trust.teamAllocationPct}%.</p>
<div class="rule"><strong>Can:</strong> ${s.trust.operator.can.map(esc).join("; ")}.<br><strong>Cannot:</strong> ${s.trust.operator.cannot.map(esc).join("; ")}.</div>
<p class="muted">${esc(OPERATOR_LINE)} · ${esc(USE_OF_FEES)} · Creator wallet shown above (anonymous creators are allowed; the wallet is always displayed).${s.mode === "buyback" ? ` · ${esc(s.pool.queuedNote)}` : ""}</p>
<h2>Attesters</h2>
<p>Quorum ${s.quorum} of ${s.attesters.length}: ${s.attesters.map((a) => `<code>${esc(a.pubkey)}</code> (${esc(a.role)}${a.active ? "" : ", inactive"})`).join(", ") || "<em>none recorded</em>"}. Level 1: our data key signs each reading. Level 2 adds an independent attester per selector; level 3 is a proof of the API response (zkTLS) or an on-chain settlement where the venue publishes one.</p>
<h2>Addresses</h2>
<ul class="addr"><li><span class="muted">Mint</span> <a href="${esc(s.addresses.mintUrl)}"><code>${esc(s.addresses.mint)}</code></a></li><li><span class="muted">Burn pool = the burn program's fee PDA = the LaunchLab creator (anyone can deposit, nobody can withdraw; the keeper only pays gas)</span> <a href="${esc(s.addresses.feePdaUrl)}"><code>${esc(s.addresses.feePda)}</code></a></li>${s.addresses.feeWsol ? `<li><span class="muted">Fee PDA's WSOL account (claimed curve fees land here)</span> <a href="${esc(s.addresses.feeWsolUrl)}"><code>${esc(s.addresses.feeWsol)}</code></a></li>` : ""}${s.addresses.vault ? `<li><span class="muted">Vault</span> <a href="${esc(s.addresses.vaultUrl)}"><code>${esc(s.addresses.vault)}</code></a></li>` : ""}<li><span class="muted">Creator</span> <a href="${esc(s.addresses.creatorUrl)}"><code>${esc(s.addresses.creator)}</code></a></li><li><span class="muted">Receipts program</span> <code>${esc(s.addresses.programId)}</code></li>${s.addresses.launchTx ? `<li><span class="muted">Launch</span> <a href="${esc(s.addresses.launchTxUrl)}"><code>${esc(s.addresses.launchTx)}</code></a></li>` : ""}</ul>
${s.disclosure.eventContract ? `<p class="rule">${esc(s.disclosure.eventContract)}</p>` : ""}
<p class="rule">${s.lifecycle ? `${esc(s.lifecycle.line)} · ` : ""}${esc(FEE_FLOW_LINE)}</p>
<footer>${esc(s.disclosure.disclaimer)} Health: ${s.health.pending} pending, ${s.health.unverified} unverified${s.health.lastError ? ` · last error: ${esc(s.health.lastError)}` : ""}.</footer>
</main>
<script>
(function(){var el=document.getElementById("next");if(!el)return;var at=Date.parse(el.getAttribute("data-at")||"");if(!at)return;
function tick(){var d=Math.max(0,at-Date.now()),h=Math.floor(d/3.6e6),m=Math.floor(d%3.6e6/6e4),s=Math.floor(d%6e4/1e3);el.textContent=d?("next check in "+h+"h "+m+"m "+s+"s"):"now";}
tick();setInterval(tick,1000);})();
</script>
</body></html>
`;
}

/** One coin on the platform index — the launchpad card's fields (2026-10-10: image, one-liner, curve progress, last burn, next result). */
export interface PlatformIndexToken {
  ticker: string; name: string; mint: string; oracle: string; selectorKey: string; seriesTitle: string | null; mode: string; status: string; launchedAt: string | null; burned: string; burns: number; pctOfSupply: number; impliedChance: number | null; nextCheckAt: string | null; pairId: string | null;
  imageUrl: string | null; oneLiner: string; lastBurnAt: string | null; nextMarket: string | null; nextCloseTime: string | null; oneShot: boolean; badge?: string | null;
  /** null = the curve was not read (no RPC on the host, or not launched): the card shows "—", never a guess. */
  phase: "curve" | "migrating" | "graduated" | null; progressPct: number | null; raised: string | null; threshold: string | null; quote: string | null;
}
export interface AuditBadge { ok: boolean; ranAt: string; receipts: number; mismatches: number; chainChecked: boolean }
export interface PlatformIndexJson { schema: "burnticker.index/v1"; generatedAt: string; tokens: PlatformIndexToken[]; pairs: { pairId: string; selectorKey: string; seriesTitle: string | null; a: PairSideSummary; b: PairSideSummary; winnerTakesBurn?: boolean; forwardedAtoB?: string; forwardedBtoA?: string }[]; totals: { tokens: number; live: number; burns: number; burnedTokens: string; pairs: number }; audit: AuditBadge | null }

/** Pairs listed once (both sides), from the statuses' pair fields. */
export function groupPairs(statuses: readonly TokenStatusJson[]): PlatformIndexJson["pairs"] {
  const by = new Map<string, { a?: TokenStatusJson; b?: TokenStatusJson }>();
  for (const s of statuses) if (s.pair) by.set(s.pair.pairId, { ...(by.get(s.pair.pairId) ?? {}), [s.pair.side === "A" ? "a" : "b"]: s });
  const moved = (fw: readonly PairForwardJson[], from: string) => rawToTokens(fw.filter((f) => f.fromMint === from).reduce((acc, f) => acc + solToLamports(f.sol), ZERO), 9);
  return [...by.entries()].filter(([, p]) => p.a && p.b).map(([pairId, p]) => {
    const wtb = !!(p.a!.pair?.winnerTakesBurn || p.b!.pair?.winnerTakesBurn), fw = p.a!.pair?.forwards ?? p.b!.pair?.forwards ?? [];
    return { pairId, selectorKey: p.a!.selectorKey, seriesTitle: p.a!.seriesTitle, a: sideSummary(p.a!), b: sideSummary(p.b!), ...(wtb ? { winnerTakesBurn: true, forwardedAtoB: moved(fw, p.a!.mint), forwardedBtoA: moved(fw, p.b!.mint) } : {}) };
  });
}

/** A status.json → its index card. Tolerates a status published before the card fields existed (profile/market absent). */
export function indexToken(s: TokenStatusJson): PlatformIndexToken {
  const c = s.market?.curve ?? null;
  return {
    ticker: s.ticker, name: s.name, mint: s.mint, oracle: s.oracle, selectorKey: s.selectorKey, seriesTitle: s.seriesTitle, mode: s.mode, status: s.status, launchedAt: s.launchedAt ?? null, burned: s.burned.total, burns: s.burned.count, pctOfSupply: s.burned.pctOfSupply, impliedChance: null, nextCheckAt: s.next.nextCheckAt, pairId: s.pair?.pairId ?? null,
    imageUrl: s.profile?.imageUrl ?? null, oneLiner: s.profile?.oneLiner ?? (s.seriesTitle ?? s.selectorKey), lastBurnAt: s.burned.lastAt ?? null, nextMarket: s.next.nextMarket, nextCloseTime: s.next.nextCloseTime, oneShot: s.rules.oneShot, badge: s.profile?.badge ?? null,
    phase: s.market?.phase ?? null, progressPct: c ? c.progressPct : s.market?.phase === "graduated" ? 100 : null, raised: c?.raised ?? null, threshold: c?.threshold ?? null, quote: c?.quote ?? null,
  };
}

export function buildPlatformIndex(statuses: readonly TokenStatusJson[], now: number, audit: AuditBadge | null = null): PlatformIndexJson {
  const pairs = groupPairs(statuses);
  return {
    schema: "burnticker.index/v1", generatedAt: new Date(now).toISOString(), audit, pairs,
    tokens: statuses.map((s) => indexToken(s)),
    totals: { tokens: statuses.length, live: statuses.filter((s) => s.status === "live").length, burns: statuses.reduce((a, s) => a + s.burned.count, 0), burnedTokens: statuses.reduce((a, s) => a + BigInt(s.burned.total.split(".")[0]), ZERO).toString(), pairs: pairs.length },
  };
}

export function renderPlatformIndexHtml(ix: PlatformIndexJson, receiptsByTicker: Record<string, readonly ReceiptJson[]> = {}): string {
  const day = ix.generatedAt.slice(0, 10);
  const today = platformDailyText({ index: ix, receiptsByTicker, day, site: null }).replace(/\s*\{SITE_URL\}\s*$/, "");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Burnticker receipts</title>
<meta name="description" content="Tokens whose supply burns when a settled real-world event says so. Every burn has a receipt anyone can recompute.">
<style>
${STATUS_CSS}
.today{white-space:pre-wrap;word-break:break-word;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 16px;font:inherit;line-height:1.5}
</style></head><body><main>
<h1>Burnticker</h1>
<p class="muted">Tokens whose supply burns when a settled, public event says so — settled results only, never prices. Every burn is a receipt: the source, the rule, the arithmetic, the transaction. Updated ${esc(ix.generatedAt)}.</p>
<div class="tiles"><div class="tile"><div class="label">Live tokens</div><div class="value">${ix.totals.live}</div></div><div class="tile"><div class="label">Burns</div><div class="value">${ix.totals.burns}</div></div><div class="tile"><div class="label">Tokens burned</div><div class="value">${esc(fmt(ix.totals.burnedTokens))}</div></div><div class="tile"><div class="label">Public audit</div><div class="value">${(() => { const v = auditBadgeView(ix.audit); return `<span class="${v.tone}">${esc(v.text)}</span>`; })()}</div><div class="sub">${ix.audit ? `${esc(auditBadgeView(ix.audit).sub)} · ${esc(ix.audit.ranAt)}` : "scripts/burnticker-audit.mts"} · <a href="trust/">trust page</a></div></div></div>
<h2>Today</h2>
<pre class="today" id="today">${esc(today)}</pre>
${ix.pairs.length ? `<h2>Rivalry pairs</h2>
<div class="tiles">${ix.pairs.map((p) => `<div class="tile"><div class="label">${esc(p.seriesTitle ?? p.selectorKey)}</div><div class="value"><a href="t/${esc(p.a.ticker)}/">$${esc(p.a.ticker)}</a> ${p.a.burns} : ${p.b.burns} <a href="t/${esc(p.b.ticker)}/">$${esc(p.b.ticker)}</a></div><div class="sub">burned ${fmt(p.a.burned)} : ${fmt(p.b.burned)} · supply ${fmt(p.a.supply)} : ${fmt(p.b.supply)} · <a href="p/${esc(p.pairId)}/">pair page</a></div></div>`).join("")}</div>` : ""}
<h2>Tokens</h2>
${ix.tokens.length ? `<div class="scroll"><table><thead><tr><th>Ticker</th><th>Name</th><th>Event</th><th>Mode</th><th>Burned</th><th>Burns</th><th>Status</th></tr></thead><tbody>
${ix.tokens.filter((t) => !t.pairId).map((t) => `<tr><td><a href="t/${esc(t.ticker)}/">$${esc(t.ticker)}</a></td><td>${esc(t.name)}</td><td title="${esc(t.selectorKey)}">${esc(t.seriesTitle ?? t.selectorKey)}</td><td>${esc(t.mode)}</td><td class="num">${fmt(t.burned)} (${t.pctOfSupply.toFixed(2)}%)</td><td class="num">${t.burns}</td><td>${esc(t.status)}</td></tr>`).join("\n")}
</tbody></table></div>` : `<p class="muted">No tokens yet.</p>`}
<h2>How it works</h2>
<ol><li>A creator picks an event source — a Kalshi series or market, or a first-party feed — and a rule: what each settled outcome burns. The rule is hashed and locked at launch.</li><li>The token launches on Raydium LaunchLab through Burnticker's platform config; its creator-fee slot pays its own burn pool, 100%.</li><li>When the event settles, the keeper reads the settled result (never a price), computes the units with the published rule, and cranks the Receipts program: it spends the rule's share of the pool buying the token at market and burns everything received — or burns from a vesting vault — and writes the receipt memo on chain.</li><li>Anyone can recompute every receipt from the source and the rule. If we stop, anyone can crank with the same public readings.</li></ol>
<footer>${esc(DISCLAIMER_FOOTER)}</footer>
</main></body></html>
`;
}

/**
 * THE PAIR PAGE (static; p/<pairId>/index.html beside pair.json). A scoreboard header — burns A : B, supply A : B, the last settlement
 * with its market ticker and result, the next scheduled market (ticker and close time only, no odds) — the share line
 * (pairDailyText), both receipts tables stacked, both rules with their hashes, the disclaimer. Pure over the two sides' pages.
 */
export function renderPairHtml(tally: PairTally, a: TokenStatusJson, b: TokenStatusJson, receiptsA: readonly ReceiptJson[], receiptsB: readonly ReceiptJson[], site: string | null = null): string {
  const A = esc(a.ticker), B = esc(b.ticker);
  const tile = (label: string, value: string, sub = "") => `<div class="tile"><div class="label">${esc(label)}</div><div class="value">${value}</div>${sub ? `<div class="sub">${sub}</div>` : ""}</div>`;
  const ls = tally.lastSettlement;
  const chance = (c: number | null) => (c === null ? "—" : `${(c * 100).toFixed(0)}%`);
  const sideTicker = (x: "A" | "B" | null) => (x === "A" ? `$${A}` : x === "B" ? `$${B}` : "neither side");
  const table = (s: TokenStatusJson, rs: readonly ReceiptJson[]) => rs.length === 0 ? `<p class="muted">No receipts yet for $${esc(s.ticker)}.</p>` : `<div class="scroll"><table><thead><tr><th>Settled</th><th>Market</th><th>Result</th><th>Units</th><th>Burned</th><th>Tx</th><th>Check</th></tr></thead><tbody>
${[...rs].reverse().map((r) => `<tr><td>${esc(r.settledAt.slice(0, 19).replace("T", " "))}</td><td><code>${esc(r.market)}</code></td><td>${esc(r.result ?? r.value ?? "—")}</td><td class="num">${r.units}</td><td class="num">${r.status === "confirmed" ? fmt(r.burned ?? "0") : r.status === "forwarded" ? `<span class="muted">forwarded ${esc(r.spent ?? "")} SOL</span>` : `<span class="muted">${esc(r.status)}</span>`}</td><td>${r.txUrl && r.signature ? `<a href="${esc(r.txUrl)}">${esc(r.signature.slice(0, 10))}…</a>` : "—"}</td><td>${r.verify.verified ? '<span class="ok">✓</span>' : r.status === "confirmed" ? `<span class="bad" title="${esc(r.verify.checks.join("; "))}">!</span>` : "…"}</td></tr>`).join("\n")}
</tbody></table></div>`;
  const tiles = [
    tile("Burns", `$${A} ${tally.burnsA} <span class="muted">:</span> ${tally.burnsB} $${B}`, `${tally.settlements} settlement(s)${tally.voids ? `, ${tally.voids} void` : ""} · burned ${fmt(tally.burnedA)} : ${fmt(tally.burnedB)}`),
    tile("Supply", `${tally.supplyPctA.toFixed(2)}% <span class="muted">:</span> ${tally.supplyPctB.toFixed(2)}%`, `${fmt(tally.supplyA)} : ${fmt(tally.supplyB)} of ${fmt(a.supply.initial)} each`),
    tile("Last settlement", ls ? `<code>${esc(ls.eventId)}</code>` : "none yet", ls ? `settled ${esc((ls.result ?? ls.value ?? "—").toUpperCase())} · ${esc(ls.settledAt.slice(0, 16).replace("T", " "))}Z → ${sideTicker(ls.burnedSide)} burned${ls.burned ? ` ${fmt(ls.burned)}` : ""}` : "the first settlement after launch burns one side"),
    tile("Next scheduled market", tally.next.market ? `<code>${esc(tally.next.market)}</code>` : "—", `${tally.next.closeTime ? `closes ${esc(tally.next.closeTime)}` : "the next settlement after launch"}`),
    ...(tally.attesterLine ? [tile("Attesters", "1 key, quorum 1", esc(tally.attesterLine))] : []),
    ...(tally.unpaired ? [tile("Pair", "unpaired", `${esc(tally.unpaired.reason)} · ${esc(tally.unpaired.at.slice(0, 10))} — two plain coins now; nothing forwards between them`)] : []),
    ...(tally.winnerTakesBurn ? [tile("Burned and forwarded", `burned on $${A} ${fmt(tally.burnedA)} <span class="muted">/</span> burned on $${B} ${fmt(tally.burnedB)}`, `forwarded $${A}→$${B} ${esc(tally.forwardedAtoB ?? "0")} SOL · $${B}→$${A} ${esc(tally.forwardedBtoA ?? "0")} SOL — ${esc(PAIR_BURN_SENTENCE)}`)] : []),
  ].join("\n");
  const rule = (s: TokenStatusJson, side: "A" | "B") => `<div class="rule"><strong>Side ${side} — <a href="../../t/${esc(s.ticker)}/">$${esc(s.ticker)}</a></strong> ${esc(s.name)}. ${esc(s.rules.statement)}<br><span class="muted">Rule file: <a href="../../t/${esc(s.ticker)}/rules.json">rules.json</a> · sha256 <code>${esc(s.rules.sha256)}</code></span></div>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>$${A} vs $${B} — rivalry pair</title>
<meta name="description" content="$${A} vs $${B}: one settled market, inverted rules, every settlement burns one side. The receipts are the scoreboard.">
<style>
${STATUS_CSS}
.score{font-size:2.2rem;font-weight:700;text-align:center;margin:8px 0 4px;font-variant-numeric:tabular-nums}
.today{white-space:pre-wrap;word-break:break-word;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 16px;font:inherit;line-height:1.5}
</style></head><body><main>
<p><a href="../../">← Burnticker</a></p>
<h1><a href="../../t/${A}/">$${A}</a> <span class="muted" style="font-weight:400">vs</span> <a href="../../t/${B}/">$${B}</a></h1>
<p class="muted">Rivalry pair <code>${esc(tally.pairId)}</code> · one selector <code>${esc(a.selectorKey)}</code>${a.seriesTitle ? ` · ${esc(a.seriesTitle)}` : ""} · inverted mappings: each settlement burns exactly one side (a voided market burns neither). Updated ${esc(a.generatedAt)}.</p>
<div class="score">$${A} ${tally.burnsA} <span class="muted">:</span> ${tally.burnsB} $${B}</div>
<div class="tiles">
${tiles}
</div>
<p class="muted">${esc(NO_WALLET_LINE)} ${esc(termLine(["receipt", "burnPool"]))}</p>
<h2>Share line</h2>
<pre class="today" id="share">${esc(pairDailyText(tally, site, a.profile?.badge ?? null).replace(/\s*\{SITE_URL\}\/p\/[^/]+\/$/m, " this page"))}</pre>
<p class="muted">The same words as the pair post (src/lib/launch/dailyPost.ts pairDailyText): a report of the tally, filled from both sides' status.json and receipts.json, never retyped.</p>
<h2>Receipts — $${A}</h2>
${table(a, receiptsA)}
<h2>Receipts — $${B}</h2>
${table(b, receiptsB)}
<h2>The two rules</h2>
${rule(a, "A")}
${rule(b, "B")}
${a.lp || b.lp ? `<h2>${esc(LP_POLICY_BADGE)}</h2>
${[a, b].map((x) => (x.lp ? `<h3>$${esc(x.ticker)}</h3>${lpLockHtml(x.lp).replace(/^<h2>[^<]*<\/h2>\n/, "")}` : "")).join("\n")}` : ""}
${a.disclosure.eventContract ? `<p class="rule">${esc(a.disclosure.eventContract)}</p>` : ""}
<footer>A memecoin pair. Each rule says what its supply does, not what either price does. Nobody is promised anything. ${esc(a.disclosure.disclaimer)}</footer>
</main></body></html>
`;
}

/** Writes one pair's site: p/<pairId>/{pair.json, index.html}. */
export function publishPairSite(dir: string, tally: PairTally, a: TokenStatusJson, b: TokenStatusJson, receiptsA: readonly ReceiptJson[], receiptsB: readonly ReceiptJson[]): void {
  publishSite(`${dir}/p/${tally.pairId}`, { "pair.json": toJson({ schema: "burnticker.pair/v1", generatedAt: a.generatedAt, tally }), "index.html": renderPairHtml(tally, a, b, receiptsA, receiptsB) });
}

/** Writes one token's site: t/<ticker>/{status.json, receipts.json, rules.json, index.html}. */
export function publishTokenSite(dir: string, s: TokenStatusJson, receipts: readonly ReceiptJson[], readings: readonly ReadingRow[], rulesText: string): void {
  publishSite(`${dir}/t/${s.ticker}`, { "status.json": toJson(s), "receipts.json": toJson(receipts), "rules.json": rulesText, "index.html": renderTokenHtml(s, receipts, readings) });
}

export function publishPlatformIndex(dir: string, statuses: readonly TokenStatusJson[], now: number, audit: AuditBadge | null = null, receiptsByTicker: Record<string, readonly ReceiptJson[]> = {}): PlatformIndexJson {
  const ix = buildPlatformIndex(statuses, now, audit);
  publishSite(dir, { "index.json": toJson(ix), "index.html": renderPlatformIndexHtml(ix, receiptsByTicker) });
  // Each pair's scoreboard page (the index cards and the versus headers link to p/<pairId>/).
  for (const p of ix.pairs) {
    const a = statuses.find((s) => s.ticker === p.a.ticker), b = statuses.find((s) => s.ticker === p.b.ticker);
    if (!a || !b) continue;
    const ra = receiptsByTicker[a.ticker] ?? [], rb = receiptsByTicker[b.ticker] ?? [];
    publishPairSite(dir, pairTally(a, b, ra, rb), a, b, ra, rb);
  }
  return ix;
}
