import { utcDateTime, utcDay } from "@/lib/burnticker/utcWords";
import { CAP_ENFORCED_SENTENCE, capHeldSentence, capSentenceAway } from "@/lib/burnticker/capInForce";
import { explorerUrl } from "@/lib/burnKeeper/solana";
import { buybackSpend, rawToTokens, solToLamports, spendablePool, tokensToRaw } from "@/lib/burnKeeper/rules";
import { STATUS_CSS, seriesChartSvg, toJson, publishSite } from "@/lib/burnKeeper/statusPage";
import { TIER_UNREAD_LINE, CURVE_FEES, postGraduationFeesFor, LP_BURNED_PCT, LP_LOCKED_PCT, PRE_AUDIT_POOL_CAP_SOL, OPERATOR_LINE, OPERATOR_SHARE_LINE, USE_OF_FEES, bpsPerSol, burnPoolAddresses, capPool, feeSplitSentence, type FeeSplit } from "@/lib/burnticker/fees";
import { pendingPairNoteForDisplay } from "@/lib/burnticker/pairReceiptNote";
import { DECIMALS, DISCLAIMER_FOOTER, TOTAL_SUPPLY, descriptionFooter, oracleDisclosure, pairClause, pairMirrorRule, pairWinnerTakesBurn, ruleMappings, ruleStatement, type LockedRule } from "@/lib/burnticker/rules";
import { isFirstSnowRule, nextTimes, resolvesOnce } from "@/lib/burnticker/nextResult";
import { sourceText } from "@/lib/burnticker/launchPreflight";
import { badgeFromText, CANDIDATES_PAIR_SENTENCE, GAME_PAIR_SENTENCE, PAIR_BURN_SENTENCE } from "@/lib/burnticker/describe";
// website-21 (WIRING-RIVALRY-SERIES gap): a rivalry series pair reads two series, one per team, never one shared market
import { isMeetingsSelector, MEETINGS_PAIR_PAGE_LINE } from "@/lib/burnticker/guidedLaunch";
import { creatorTextOf } from "@/lib/burnticker/creatorProfile";
import { operatorCreatorLine } from "@/lib/burnticker/operatorCreators";
import { auditBadgeView } from "@/lib/burnticker/auditBadge";
import { NO_WALLET_LINE, termLine } from "@/lib/burnticker/glossary";
import type { TokenMeta } from "@/lib/burnticker/registry";
/** The standing line on every coin page and card (owner decision 2026-10-10, anti-misrepresentation). */
export const AFFILIATION_LINE = "This coin is not affiliated with any team, league, candidate, agency or market.";
import { parseReceiptMemo } from "@/lib/burnticker/receipt";
import { fullSpendUnits, unitStep, windDownUnits, type SettledEvent } from "@/lib/burnticker/units";
import { pairWords, unitsFormula, verifyCommand } from "@/lib/burnticker/receiptFormula";
import { nextMarketNone, pairLastSentence, pairLeadSentence, receiptStatusWords, type PairLastFacts } from "@/lib/burnticker/receiptWords";
import { healthLine, isWaitingReading } from "@/lib/burnticker/queuedReading";
import { feedById } from "@/lib/burnticker/catalogue";
import type { ImpliedChance } from "@/lib/burnticker/oracle/types";
import type { AttesterRow, FeedState, ReadingRow, ReceiptRow, Registry, TokenRow, TokenState } from "@/lib/burnticker/registry";
import type { LifecycleJson, PairClauseJson, PairCounterpart, PairForwardJson, PairSideSummary, ReceiptJson, StatedJson, TokenProgramJson, TokenStatusJson } from "@/lib/burnticker/pageTypes";
import { pairDailyText, platformDailyText, tokenDayText } from "@/lib/launch/dailyPost";
import { parseBuybackMemo as parseProgramBuybackMemo, parseDebtMemo as parseProgramVaultMemo } from "@/lib/burnReceipts/memo";
import { parseTargetMemo } from "@/lib/burnReceipts/memoV3";
import { buybackSpend as programBuybackSpend, formatDate as formatU32 } from "@/lib/burnReceipts/math";
import type { ProgramConfigView } from "@/lib/burnKeeper/programPort";
import { buildMarketJson, type CpmmMarket, type MarketInput } from "@/lib/burnticker/market";
import { allLinks, coinLinks } from "@/lib/burnticker/tradeLinks";
import type { HoldersRead } from "@/lib/burnticker/holders";
import { onlyPoolHolders, walletHolders } from "@/lib/burnticker/cardView";
import type { LifecycleDates } from "@/lib/burnticker/lifecycleDates";
import type { FinalAfter, StatedSource } from "@/lib/burnticker/sources/polyStated";
import { ruleOneLinerFor, ruleReadingDirection, ruleSideName } from "@/lib/burnticker/coinCard";
import { PAIR_STATE_NAMES, parseForwardMemo, type PairLinks } from "@/lib/burnticker/pairForward";
import { pairUnlinked } from "@/lib/burnticker/pairForwardKeeper";
import { postGraduationShareLine } from "@/lib/burnticker/feeShareLine";
import { LP_POLICY_BADGE, LP_POLICY_BADGE_BEFORE_GRADUATION, buildLpLockJson, lpPolicyLineFor, feeKeysPda, operatorTreasuryFor, solscanUrl, type LpLockJson } from "@/lib/burnticker/lockFees";
import { LP_ADMIN_KEY_LINE, LP_BEFORE_GRADUATION_LINE, lpLockLine } from "@/lib/burnticker/lpLockCopy";
import { byCoin, siteKeysOf } from "@/lib/burnticker/coinKey";

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
    program?: { config: ProgramConfigView | null; keeperKeys: readonly string[]; lastReading: { date: string; signature: string } | null; /** burn dispersal lines (dispersalKeeper.ts dispersalLines) */ dispersal?: readonly string[]; /** twapEmpty.ts: the pool has never traded */ firstTradeWait?: { since: number } } | null };
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
  /** indexer-1 (WIRING.md step 1): the graduated pool's read, the holder count and the lifecycle dates; absent when not read */
  cpmm?: { market: CpmmMarket | null; error: string | null } | null;
  holders?: HoldersRead | null;
  dates?: LifecycleDates | null;
  /** sources-2: a one-market Polymarket coin's stated source and dispute window (oracle/polymarket.ts polyStated); absent when not read */
  stated?: { resolutionSource: StatedSource; finalAfter: FinalAfter } | null;
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
  lastSettlement: { eventId: string; settledAt: string; burnedSide: "A" | "B" | null; result: string | null; value: string | null; burned: string | null;
    /** prelaunch audit 2026-10-18 A-5: who won and each side's receipt state, for the plain sentence (receiptWords.ts pairLastSentence) */
    facts?: PairLastFacts } | null;
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
  /** Third prelaunch audit F10: what kind of pair this is, so the share text says its own mechanics (pairKindOf). Absent = "inversion". */
  kind?: PairKind;
}

/**
 * The kinds of rivalry pair (third prelaunch audit 2026-10-16 F10), from side A's selector and locked statement: a season's head-to-head
 * series (`meetings`), one game between two teams (`game`), two candidates in one race (`candidates`), a Burn Derby pair (`derby`), or
 * the original pair of one market read with opposite rules (`inversion`).
 */
export type PairKind = "meetings" | "game" | "candidates" | "derby" | "flippening" | "inversion";
export function pairKindOf(a: { selectorKey: string; rules: { statement: string } }): PairKind {
  // a coin's selector carries its oracle prefix (registry.ts selectorKeyOf: catalogue:espn.team:…); the pair row's does not
  if (isMeetingsSelector(a.selectorKey.replace(/^catalogue:/, ""))) return "meetings";
  // review follow-up 4: the one-shot flippening (series "coinvs:<A>-<B>:<window>:<pct|mcap>-flip:<hash>") is its own kind
  if (/^derby:coinvs:[^:]+:[^:]+:[^:]*-flip(:|$)/.test(a.selectorKey)) return "flippening";
  if (/^derby:/.test(a.selectorKey)) return "derby";
  if (/ One-game pair /.test(` ${a.rules.statement} `)) return "game";
  if (/ Candidates pair /.test(` ${a.rules.statement} `)) return "candidates";
  return "inversion";
}

/** One side's summary from its status (and receipts, for the last burn time). */
/** A settled-event pair's one sentence for the pair pages (two candidates in one race, two teams in one game), from the locked statement. */
const settledLineOf = (statement: string): string | null => (/ Candidates pair /.test(statement) ? CANDIDATES_PAIR_SENTENCE : / One-game pair /.test(statement) ? GAME_PAIR_SENTENCE : null);
export function sideSummary(s: Pick<TokenStatusJson, "ticker" | "name" | "mint" | "burned" | "supply">, receipts: readonly Pick<ReceiptJson, "status" | "settledAt" | "burned">[] = []): PairSideSummary {
  const last = [...receipts].filter((r) => r.status === "confirmed" && r.burned && r.burned !== "0").sort((x, y) => (x.settledAt < y.settledAt ? 1 : -1))[0];
  return { ticker: s.ticker, name: s.name, mint: s.mint, burns: s.burned.count, burned: s.burned.total, supply: s.supply.current, lastBurnAt: last?.settledAt ?? null };
}

/** The fee-flow sentence every coin page carries (the app's coin page, t/[ticker]/page.tsx, prints the same words). */
// HB-179: true before graduation too (no pool exists yet)
export const FEE_FLOW_LINE = `Creator fees go to the burn pool and are burned. After graduation, the pool's liquidity is locked forever. ${OPERATOR_SHARE_LINE}`;
/** The same line for one coin, from the post-graduation split its page carries (the tier it pinned; 2026-10-19). */
export const feeFlowLine = (post: Pick<FeeSplit, "legs">, lockedPct: number | null = LP_LOCKED_PCT, tierUnread = false): string => `Creator fees go to the burn pool and are burned. ${lpLockLine(lockedPct)} ${tierUnread ? TIER_UNREAD_LINE : postGraduationShareLine(post)}`;

/** A coin that is trading and still reading its source. */
export const LIVE_LINE = "This coin is live.";
/** Continuous audit run 2, HB-25: a one-shot whose one result is in (or was voided) is not "live" in the reading sense; it says so. */
export const DECIDED_LINE = "This coin's one result is in, so no further result is read for it.";
export const VOIDED_LINE = "This coin's result was voided, so no further result is read for it.";
/** The lifecycle line once the next block is known: a decided or voided one-shot never reads "This coin is live.". */
export const lifecycleLineFor = (line: string, result: string): string => (line !== LIVE_LINE ? line : result === "decided" ? DECIDED_LINE : result === "void" ? VOIDED_LINE : line);

/** A draft's lifecycle line: the launch was prepared but never signed, so nothing exists on chain (never "This coin is live."). */
export const NOT_CREATED_LINE = "This coin is not created yet. Nothing is on chain.";
/** An expired draft's lifecycle line. */
export const EXPIRED_DRAFT_LINE = "This draft expired before it was created. Nothing is on chain.";

/** The lifecycle block from the registry (pure over its reads): ended, wind-down progress, the last sweep, the page's one line. */
export function lifecycleFrom(reg: Pick<Registry, "ruleEnd" | "receipts" | "getStatus">, t: Pick<TokenRow, "mint" | "status">, rule: Pick<LockedRule["rule"], "onEnd" | "binary" | "scalar" | "kind">, poolLamports: bigint | null = null): LifecycleJson {
  const end = reg.ruleEnd(t.mint);
  const rs = reg.receipts(t.mint);
  const wd = rs.filter((b) => b.kind === "winddown"), dr = rs.filter((b) => b.kind === "drain");
  const lastSweep = reg.getStatus(`rule.swept.${t.mint}`);
  const f = (rule.kind === "binary" ? rule.binary?.onYes ?? rule.binary?.onNo : rule.scalar?.perUnit)?.fractionOfPool ?? 0;
  const days = rule.onEnd?.windDownDays ?? null;
  const done = wd.filter((b) => b.status === "confirmed" || b.status === "skipped").length;
  const poolNote = poolLamports !== null && poolLamports >= BigInt(10_000_000) ? `Its burn pool holds ${rawToTokens(poolLamports, 9)} SOL.` : "Its burn pool is close to empty.";
  // launch night 2026-10-13: a draft (a prepared launch that was never signed) or an expired draft is not a coin yet, never "live"
  const line = t.status === "draft" ? NOT_CREATED_LINE
    : t.status === "expired" ? EXPIRED_DRAFT_LINE
    : t.status === "retired" ?`This coin is retired.${lastSweep ? ` Its pool was last swept on ${lastSweep}.` : ""} ${poolNote}`
    : end?.mode === "drain" ? `This coin is spending its whole burn pool, one day at a time, up to the cap for each run. It has done so on ${dr.length === 1 ? "one day" : `${dr.length} days`} so far.`
    : end ? `This coin is winding down. It is on day ${Math.max(1, wd.length)} of ${days ?? "an unknown number"}.`
    : LIVE_LINE;
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
  // A-5: the winner by pair role (a burn can still be waiting); null when the receipts carry no role (the sentence then names who burned)
  const wonSide: "A" | "B" | null = !last ? null : last[1].A?.pairRole === "won" ? "A" : last[1].B?.pairRole === "won" ? "B" : null;
  const sideRow = (x: "A" | "B" | null) => (!last || !x ? null : x === "A" ? last[1].A ?? null : last[1].B ?? null);
  const lastFacts: PairLastFacts | undefined = last ? { wonSide, burnedSide: lastSide, burned: lastSide ? lastRow?.burned ?? null : null, winnerStatus: sideRow(wonSide)?.status ?? null, loserStatus: sideRow(wonSide === "A" ? "B" : wonSide === "B" ? "A" : null)?.status ?? null,
    void: last[1].A?.status === "void" || last[1].B?.status === "void" || (lastRow?.result ?? null) === "void" } : undefined;
  const left = (s: TokenStatusJson) => Math.max(0, 100 - s.burned.pctOfSupply);
  return {
    pairId: a.pair?.pairId ?? b.pair?.pairId ?? "", a: sa, b: sb, burnsA: sa.burns, burnsB: sb.burns, burnedA: sa.burned, burnedB: sb.burned, supplyA: sa.supply, supplyB: sb.supply,
    supplyPctA: left(a), supplyPctB: left(b), settlements: events.length, voids,
    lastSettlement: last ? { eventId: last[0], settledAt: last[1].settledAt, burnedSide: lastSide, result: lastRow?.result ?? null, value: lastRow?.value ?? null, burned: lastSide ? lastRow?.burned ?? null : null, facts: lastFacts } : null,
    next: { market: a.next.nextMarket ?? b.next.nextMarket, closeTime: a.next.nextCloseTime ?? b.next.nextCloseTime, chanceA: null, chanceB: b.next.impliedChance },
    clause: a.pair?.clause ?? b.pair?.clause ?? null,
    curveA: a.market?.curve ?? null, curveB: b.market?.curve ?? null,
    winnerTakesBurn: !!(a.pair?.winnerTakesBurn || b.pair?.winnerTakesBurn), forwardedAtoB: forwardedSol(receiptsA), forwardedBtoA: forwardedSol(receiptsB),
    forwards: a.pair?.forwards ?? b.pair?.forwards ?? forwardsFromReceipts(a, b, receiptsA, receiptsB),
    unpaired: a.pair?.unpaired ?? b.pair?.unpaired ?? null,
    kind: pairKindOf(a),
    attesterLine: soleAttester(a, b) ? PAIR_SOLE_ATTESTER_LINE : (a.pair?.winnerTakesBurn || b.pair?.winnerTakesBurn) ? PAIR_QUORUM_LINE : null,
  };
}

/**
 * The pair page's attester fact (the M-1 residual, stated plainly — pair-forward round 3: both coins share ONE attester set). While one
 * key attests both coins at quorum 1, the full sentence; otherwise its first half.
 */
export const PAIR_QUORUM_LINE = "Whoever controls the signing keys the two coins share decides every result.";
export const PAIR_SOLE_ATTESTER_LINE = "Whoever controls the signing keys the two coins share decides every result. On Burnticker, that is one key, run by the operator's keeper, and no second signature is needed.";
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
  return { voidBy: c.voidBy, state: "waiting", waitingOn, decidedAt: null, detail: now >= Date.parse(`${c.voidBy}T00:00:00Z`) + 86_400_000 ? "The void date has passed, so the keeper voids the pair on its next run." : null };
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
    if (!clock) try {
      // Winner takes the burn: a LOST receipt carries the units this coin would have had had it won — recomputed with the mirrored mapping.
      // a settled-event pair (two candidates in one race, two teams in one game; multiKeeper.planRace): the event decides, not the coin's
      // own reading alone — a won receipt is its own result, a lost one is one unit at its own mapping, a receipt with no role is nothing
      const settledPair = !!rule.pair?.race || !!rule.pair?.game;
      const own = unitStep(rule, ev, { value: b.prevValue, carryOut: b.carryIn }, feed?.carry ?? "none");
      const map0 = ruleMappings(rule)[0]?.mapping ?? null;
      const s = settledPair ? (b.pairRole === "lost" ? { ...own, units: 1, mapping: map0 } : b.pairRole === "won" ? own : { ...own, units: 0, mapping: null })
        : unitStep(b.pairRole === "lost" ? pairMirrorRule(rule) : rule, ev, { value: b.prevValue, carryOut: b.carryIn }, feed?.carry ?? "none");
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
      // audit 7 F05: a coin with a burn target (round 5) writes the v3 target memo (crank_target_burn); its `own` field is the coin's own
      // fee tokens burned (the receipt's burnRaw), `burn` the target's, and `target` must be the rule's pinned mint
      const pinned = rule.burnTarget?.mint ?? null;
      const tm = i.locked.mode === "buyback" && pinned ? parseTargetMemo(b.memo) : null;
      const pm = tm ?? (i.locked.mode === "buyback" ? parseProgramBuybackMemo(b.memo) : parseProgramVaultMemo(b.memo));
      if (!pm) checks.push(`memo does not parse (program ${pinned ? "v3 target or v2" : i.locked.mode === "buyback" ? "v2" : "v1"})`);
      else {
        if (pm.prefix !== i.token.ticker || (b.readingDate !== null && pm.recordDate !== formatU32(b.readingDate)) || pm.units !== readingUnits || BigInt(pm.now) - BigInt(pm.prev) !== BigInt(readingUnits)) checks.push("memo fields ≠ the receipts counted into this reading");
        if (pm.rulesSha12 !== sha12) checks.push(`memo rules hash ${pm.rulesSha12} ≠ the published rule ${sha12}`);
        if (tm && tm.target !== pinned) checks.push(`memo target ${tm.target} ≠ the rule's pinned token ${pinned}`);
        if (b.lead && b.burnRaw !== null && (tm ? tm.own : pm.burn) !== rawToTokens(b.burnRaw, DECIMALS)) checks.push("memo burn ≠ recorded burn");
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
    // prelaunch audit 2026-10-18 A-5: the command for the source this reading came from (receiptFormula.ts), never one template for all
    const curl = verifyCommand({ oracle: rule.oracle, eventId: b.eventId, settledAt: b.settledAt, sourceUrl: rd?.sourceUrl ?? null, method: rd?.method ?? null, proof: rd?.proof ?? null, pairRole: b.pairRole ?? null, ticker: i.token.ticker,
      feedLine: feed ? `curl -s '${rd?.sourceUrl ?? feed.sourceUrl}'   # ${feed.sourceName}: the row for ${b.eventId}${b.prevValue !== null ? ` (previous reading ${b.prevValue})` : ""}; selection: ${JSON.stringify(feed.config.select)}` : null });
    // a pair receipt the other side decided is told in words; a scalar receipt's units are an equation that is true (unitsFormula)
    const fr = { value: b.value, prevValue: b.prevValue, carryIn: b.carryIn, units: b.units, result: b.result, pairRole: b.pairRole ?? null };
    const words = clock ? null : pairWords(i.token.ticker, fr, !!rule.pair?.race || !!rule.pair?.game);
    const unitsText = rule.kind === "binary" ? null : clock ? `units = ${b.units} (a ${b.kind} day of the rule's end)` : unitsFormula(rule, fr, feed?.carry ?? "none");
    const formula = words ? words : rule.kind === "binary"
      ? `result = ${b.result ?? "?"}, so ${b.mapping ? (b.mapping.fractionOfPool !== undefined ? `spend ${b.mapping.fractionOfPool * 100}% of the pool` : `burn ${b.mapping.tokens} tokens`) : "nothing"}${!prog && i.locked.mode === "buyback" && b.poolLamports !== null ? `; spend = ${b.poolLamports} × ${b.mapping?.fractionOfPool ?? 0} = ${expectedSpend} lamports` : ""}`
      : `${unitsText ?? ""}${prog ? "" : i.locked.mode === "buyback" && b.poolLamports !== null ? `; spend = pool × (1 − (1 − ${b.mapping?.fractionOfPool ?? 0})^${b.units}) = ${b.poolLamports} × … = ${expectedSpend} lamports` : i.locked.mode === "vault" ? `; burn = ${b.units} × ${b.mapping?.tokens ?? 0} tokens` : ""}`;
    const programFormula = prog && b.readingDate ? `; counted into program reading ${formatU32(b.readingDate)} (${readingUnits} ${readingUnits === 1 ? "unit" : "units"} from ${together.length} ${together.length === 1 ? "receipt" : "receipts"}). The program ${i.locked.mode === "buyback" ? `spends min(pool × (1 − (1 − ${bps}/10000)^${readingUnits}) + carried spend, 2% of the pool's SOL reserve)${b.lead && b.poolLamports !== null ? ` = rule spend ${expectedSpend} lamports from a ${b.poolLamports}-lamport pool` : ""} and burns everything the fee PDA holds` : `burns ${readingUnits} × ${b.mapping?.tokens ?? 0} tokens from its vault, shortfall carried`}` : "";
    const pend = (x: string | null, what: string) => (x === null ? `${what} is still pending` : x);
    const shortNote = b.shortOutRaw && b.shortOutRaw > ZERO ? ` ${rawToTokens(b.shortOutRaw, DECIMALS)} tokens were short and carry over to the next burn.` : "";
    const expected = fwd ? `Forwarded. This coin lost the period, so ${sol(b.spendLamports) ? `${sol(b.spendLamports)} SOL` : "its share"} from its burn pool moved to the winning coin's burn pool (winner takes the burn). No $${i.token.ticker} was bought or burned.` : b.status === "pending-pair" ? "Pending. This coin is in a pair, and both coins need a registered pool. This burn runs, in order, once both have one. If the pair voids, this burn is voided too." : b.status === "voided" ? `Voided (${b.skippedReason ?? "the pair voided"}). This result never burns.` : prog && b.waitReason && (b.status === "planned" || b.status === "sending") ? `Pending (${b.waitReason}).` : prog && b.lead === false ? `Burned together with the first receipt for this reading, in the same transaction${b.signature ? ` (${b.signature.slice(0, 12)}…)` : ""}.` : b.status === "skipped" ? `Nothing was bought (${b.skippedReason ?? "skipped"}).` : b.status === "void" ? "The market was voided, so nothing burns. A receipt is still recorded." : b.status === "nothing" ? `No burn (${b.note}).` : prog && b.lead ? (i.locked.mode === "buyback" ? `The rule spends ${expectedSpend ?? "?"} lamports. ${b.spendLamports === null ? "The spend is still pending." : `The program spent ${b.spendLamports} lamports (${sol(b.spendLamports) ?? "?"} SOL) buying $${i.token.ticker}.`} It burns every token the burn pool holds (${pend(b.burnRaw === null ? null : rawToTokens(b.burnRaw, DECIMALS), "the amount")}).` : `${b.burnRaw === null ? "The burn from the program's vault is still pending." : `Burn ${rawToTokens(b.burnRaw, DECIMALS)} tokens from the program's vault.`}${shortNote}`) : i.locked.mode === "buyback" ? `Spend ${expectedSpend ?? "?"} lamports (${sol(expectedSpend) ?? "?"} SOL) buying $${i.token.ticker} at market, then burn every token received (${pend(b.gotRaw === null ? null : rawToTokens(b.gotRaw, DECIMALS), "the amount")}).` : `${b.burnRaw === null ? "The burn from the vault is still pending." : `Burn ${rawToTokens(b.burnRaw, DECIMALS)} tokens from the vault.`}${shortNote}`;
    return {
      eventId: b.eventId, settledAt: b.settledAt, oracle: rule.oracle, market: b.eventId, result: b.result, value: b.value, title: rd?.title ?? null, method: rd?.method ?? null, sourceUrl: rd?.sourceUrl ?? null, settlementSourceUrl: rd?.settlementSourceUrl ?? null,
      units: b.units, kind: b.kind, note: pendingPairNoteForDisplay(b.note, { status: b.status, pairRole: b.pairRole, voidBy: pairClause(rule)?.voidBy ?? null }) ?? b.note, prevValue: b.prevValue, carryIn: b.carryIn, mapping: b.mapping,
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
  // audit 7 F08: one-shot-ness is rules.ts isOneShot (a one-game catalogue coin has no market and is one-shot), never re-derived here;
  // launch wizard audit 2026-10-19 F14: plus the first snow, which the keeper ends after its one burning day (nextResult.ts resolvesOnce)
  const oneShot = resolvesOnce(rule);
  // F11: the statement names the source and its unit in words, as the review does (launchPreflight.ts sourceText)
  const src = (() => { try { return sourceText(rule, i.now); } catch { return null; } })();
  const nextCheckAt = i.nextCheckAt ? new Date(i.nextCheckAt).toISOString() : null, nextCloseTime = i.implied?.closeTime ?? null;
  const times = nextTimes({ oneShot, receipts: i.receipts, nextCloseTime, nextCheckAt, burnedOnly: isFirstSnowRule(rule) });
  // eighth pass B-23 / HB-184 (owner B-17 decision, 2026-10-20): LaunchLab moves a graduating coin into a pool on the platform's CURRENT
  // fee tier, whatever tier the coin recorded at creation, so the split is the platform's tier (cpmmTier.ts CPMM_TIER), never the pin.
  // The pin is no longer needed for the numbers, so an unread pin no longer hides them (HB-50 is moot).
  const postGraduation = postGraduationFeesFor(i.chain.cluster);
  const tierUnread = false;
  // sixth pass B-16a / HB-56: the liquidity is locked at graduation; before it (no lock read, no registered pool) no percentage is claimed
  const lp = i.lp ?? defaultLp(i);
  const lpLockedPct = lp.lockedPct ?? (program?.pool.registered ? LP_LOCKED_PCT : null);
  return {
    schema: TOKEN_STATUS_SCHEMA, generatedAt: new Date(i.now).toISOString(), ticker: t.ticker, name: t.name, mint: t.mint, cluster: i.chain.cluster, status: t.status, launchedAt: i.dates?.created.state === "read" ? i.dates.created.at : t.launchTx ? t.baselineAt : null,
    oracle: rule.oracle, selectorKey: t.selectorKey, seriesTitle: i.seriesTitle, mode: i.locked.mode,
    rules: { sha256: i.locked.sha256, sha12: i.locked.sha12, statement: ruleStatement(rule, { seriesTitle: i.seriesTitle, feedTitle: src?.title ?? null, unitLabel: src?.unitLabel ?? null }), file: "rules.json", oneShot },
    addresses: (() => { let feeWsol: string | null = null; try { feeWsol = i.chain.programId ? burnPoolAddresses(i.chain.programId, t.mint).feeWsol : null; } catch { feeWsol = null; } return { mint: t.mint, mintUrl: addr(t.mint)!, feePda: t.feePda, feePdaUrl: addr(t.feePda)!, feeWsol, feeWsolUrl: addr(feeWsol), vault: t.vault, vaultUrl: addr(t.vault), creator: t.creator, creatorUrl: addr(t.creator)!, creatorNote: operatorCreatorLine(t.creator), programId: i.chain.programId, poolId: t.poolId, launchTx: t.launchTx, launchTxUrl: t.launchTx ? explorerUrl(i.chain.cluster, t.launchTx) : null }; })(),
    supply: { initial: TOTAL_SUPPLY, current: rawToTokens(current, DECIMALS), source: i.chain.supplyRaw !== null ? "chain" : "registry" },
    burned: { total: rawToTokens(totalRaw, DECIMALS), pctOfSupply: pct(totalRaw, supplyRaw), count: confirmed.filter((b) => (b.burnRaw ?? ZERO) > ZERO).length, last30d: rawToTokens(last30, DECIMALS), lastAt: lastBurn?.settledAt ?? null },
    pool: (() => { const spendable = i.chain.feePdaLamports === null ? null : spendablePool(i.chain.feePdaLamports, rule.reserveSol); const c = spendable === null ? null : capPool(spendable); return { feePdaSol: sol(i.chain.feePdaLamports), spendableSol: c === null ? null : sol(c.pool), reserveSol: rule.reserveSol, vaultBalance: i.chain.vaultRaw === null ? null : rawToTokens(i.chain.vaultRaw, DECIMALS), vaultAllocation: allocation === null ? null : allocation.toString(), shortfallOutstanding: rawToTokens(lastFinal?.shortOutRaw ?? ZERO, DECIMALS), capSol: PRE_AUDIT_POOL_CAP_SOL, queuedSol: c === null ? null : sol(c.queued), queuedNote: `${capSentenceAway(null)} ${CAP_ENFORCED_SENTENCE}` }; })(),
    // NO ODDS FOR ANY COIN (owner decision 2026-10-10): impliedChance is always null — the field stays for schema compatibility only.
    // audit 7 F08: the next RESULT (none for a decided or voided one-shot) and the keeper's next SOURCE CHECK are different times
    next: { nextCheckAt, impliedChance: null, impliedBasis: i.implied?.chance == null ? (i.implied?.basis ?? null) : null, nextMarket: i.implied?.marketTicker ?? null, nextCloseTime, awaitingFinal: i.selectorPending, ...times },
    feed: { lastEventId: i.state.lastEventId, lastValue: i.state.lastValue, lastSettledAt: i.state.lastSettledAt, readings: i.readings.length, lastFetchAt: i.feedState.lastFetchAt ? new Date(i.feedState.lastFetchAt).toISOString() : null, lastError: i.feedState.lastError, failures: i.feedState.failures },
    attesters: i.attesters.map((a) => ({ pubkey: a.pubkey, role: a.role, active: a.active })), quorum: i.chain.program?.config?.quorum ?? Math.max(1, Math.min(activeAtt.length, 1)),
    // owner decision 2026-10-19: a coin's post-graduation numbers come from the tier IT pinned (TokenConfig.ll_cp_config), not the new-coin tier
    fees: { curve: CURVE_FEES, postGraduation, sentence: feeSplitSentence(i.chain.cluster, null, { tierUnread, graduated: lpLockedPct !== null }), creatorSliceBps: 0, ...(tierUnread ? { tierUnread: true } : {}) },
    // HB-96 (hourly run 7): a reading waiting for both coins to graduate counts as waiting too (queuedReading.ts isWaitingReading)
    health: { pending: i.receipts.filter((b) => isWaitingReading(b.status)).length, unverified: receipts.filter((r) => r.status === "confirmed" && !r.verify.verified).length, lastError: i.receipts.find((b) => b.lastError)?.lastError ?? i.feedState.lastError },
    disclosure: { disclaimer: DISCLAIMER_FOOTER, eventContract: oracleDisclosure(rule.oracle) },
    trust: { lpBurnedPct: LP_BURNED_PCT, lpLockedPct, lpPolicy: "locked-forever", creatorCashBps: 0, teamAllocationPct: 0, operator: i.operator, registerUrl: "/burnticker/trust" },
    // HB-56 (hourly run 6): the policy line says "locks at graduation" until the coin's lock is known, from the same lpLockedPct
    lp: { ...lp, line: lpPolicyLineFor(lpLockedPct) },
    program,
    profile: { imageUrl: t.imageUrl, description: t.description.replace(descriptionFooter(i.locked), "").trim(), creatorText: creatorTextOf(t.description.replace(descriptionFooter(i.locked), "").trim()), links: t.links, oneLiner: ruleOneLinerFor(rule, i.seriesTitle, t.description, t.ticker), sideName: ruleSideName(rule), readingDirection: ruleReadingDirection(rule), badge: badgeFromText(rule, t.description, t.status === "retired"), note: i.meta?.creatorNote ?? "", affiliation: AFFILIATION_LINE },
    pinned: i.meta ? { metadataUri: i.meta.metadataUri, metadataTx: i.meta.metadataTx, metadataSha256: i.meta.metadataSha256, imageUri: i.meta.imageUri, imageTx: i.meta.imageTx, imageSha256: i.meta.imageSha256, hosted: i.meta.hosted, expectedDescription: `${badgeFromText(rule, t.description)}\n${t.description}` } : null,
    market: buildMarketJson({ cluster: i.chain.cluster, mint: t.mint, status: t.status, poolId: t.poolId, graduatedPool: program?.pool.registered && t.status !== "draft" && t.status !== "expired" ? program.pool.address : null, read: i.market, cpmm: i.cpmm, holders: i.holders, dates: i.dates }),
    lifecycle: i.lifecycle ? { ...i.lifecycle, line: lifecycleLineFor(i.lifecycle.line, times.result), fees: feeFlowLine(postGraduation, lpLockedPct, tierUnread) } : null,
    stated: i.stated && rule.oracle === "polymarket" && rule.market ? { phrase: i.stated.resolutionSource.phrase, text: i.stated.resolutionSource.text, crossRead: i.stated.resolutionSource.crossRead ? { text: i.stated.resolutionSource.crossRead.text } : null, finalAfter: { text: i.stated.finalAfter.text, ifDisputed: i.stated.finalAfter.ifDisputed } } : null,
    pair: i.pair ? { ...i.pair, tally: { burnsThis: confirmed.filter((b) => (b.burnRaw ?? ZERO) > ZERO).length, burnsOther: i.pair.counterpart.burns, burnedThis: rawToTokens(totalRaw, DECIMALS), burnedOther: i.pair.counterpart.burned, supplyThis: rawToTokens(current, DECIMALS), supplyOther: i.pair.counterpart.supply }, pageUrl: `/burnticker/p/${i.pair.pairId}` } : null,
  };
}

/** The policy block without a chain read (no claim recorded, Fee Key unknown until graduation). */
function defaultLp(i: TokenPageInput): LpLockJson {
  let keys: string | null = null;
  try { keys = i.chain.programId ? feeKeysPda(i.chain.programId).toBase58() : null; } catch { keys = null; }
  return buildLpLockJson({ cluster: i.chain.cluster, mint: i.token.mint, programId: i.chain.programId || null, state: null, feeKeysPda: keys, operatorTreasury: operatorTreasuryFor(i.chain.cluster), claims: [], explorer: (id, kind) => solscanUrl(i.chain.cluster, id, kind) });
}

/** The coin page's LP block: "Liquidity locked forever, and its fees fund the burn", the addresses (Solscan) and the last claim. */
export function lpLockHtml(lp: LpLockJson | null | undefined): string {
  if (!lp) return "";
  const a = (addr: string | null, url: string | null) => (addr ? (url ? `<a href="${esc(url)}"><code>${esc(addr)}</code></a>` : `<code>${esc(addr)}</code>`) : "<em>shown at graduation</em>");
  return `<h2>${esc(lp.lockedPct === null ? LP_POLICY_BADGE_BEFORE_GRADUATION : LP_POLICY_BADGE)}</h2>
<p>${esc(lp.line)}. ${lp.lockedPct === null ? esc(LP_BEFORE_GRADUATION_LINE) : `${lp.lockedPct}% of the liquidity from graduation is locked with Raydium's lock and can never be withdrawn.`} The burn program owns the Fee Key, which collects the locked liquidity's share of the pool's trading fees, and anyone can claim those fees (claim_lock_fees). ${lp.split.burnBps / 100}% of the SOL goes to this coin's burn pool and ${lp.split.operatorBps / 100}% goes to the operator treasury. The coin's own tokens from the fees are burned.</p>
<p class="muted">The lock program is ${a(lp.lockProgram, lp.urls.lockProgram)}. The Fee Key is ${a(lp.feeKey, lp.urls.feeKey)}, and its owner is ${a(lp.feeKeyOwner, lp.urls.feeKeyOwner)}.${lp.lockedLiquidity ? ` The locked liquidity is ${a(lp.lockedLiquidity, lp.urls.lockedLiquidity)}.` : ""} The operator treasury is ${lp.operatorTreasury ? a(lp.operatorTreasury, lp.urls.operatorTreasury) : "<em>not set on this network</em>"}.</p>
<p class="muted">${lp.lastClaim ? `The last claim was on ${esc(utcDateTime(lp.lastClaim.at))}: ${lp.lastClaim.txUrl ? `<a href="${esc(lp.lastClaim.txUrl)}">${esc(lp.lastClaim.line)}</a>` : esc(lp.lastClaim.line)} ${lp.totals.claims === 1 ? "There has been one claim" : `There have been ${lp.totals.claims} claims`}, ${esc(lp.totals.sol)} SOL in all: ${esc(lp.totals.toBurnPool)} SOL to the burn pool and ${esc(lp.totals.toOperator)} SOL to the operator.` : "Nobody has claimed the pool's fees yet."}${lp.note ? ` ${esc(lp.note)}` : ""}</p>`;
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
      ...(p.dispersal && p.dispersal.length ? { dispersal: [...p.dispersal] } : {}),
    },
    pool: { registered: !!c?.poolRegistered, address: c?.pool ?? null, untradeableSince: c?.poolUntradeableSince ? new Date(c.poolUntradeableSince * 1000).toISOString() : null, ...(p.firstTradeWait ? { firstTradeWait: { since: new Date(p.firstTradeWait.since).toISOString() } } : {}) },
    totals: { readings: c?.readings ?? 0, burns: c?.burns ?? 0, burned: rawToTokens(c?.totalBurned ?? ZERO, DECIMALS), spentSol: sol(c?.totalSpentLamports ?? ZERO) ?? "0" },
  };
}

function programSection(p: TokenProgramJson | null): string {
  if (!p) return "";
  const q = p.queue;
  return `<h2>The burn program</h2>
<p class="muted">Burns run through the burn program (<code>${esc(p.programId)}</code>)${p.config ? `, which keeps a record for this coin (<code>${esc(p.config)}</code>)` : ""}. Each day, the keeper signs a count of the units that day's receipts carried. Anyone can then run the burn. The program swaps from the burn pool and burns in one step, and it writes the receipt memo itself.${p.initialized ? "" : " <strong>The program's record for this coin cannot be read yet.</strong>"}</p>
<p>Each reading needs <strong>${p.quorum}</strong> of ${p.attesters.length} ${p.attesters.length === 1 ? "signature" : "signatures"}${p.attesters.length ? ` from these keys: ${p.attesters.map((a) => `<code>${esc(a.key)}</code> (${esc(a.kind)}${a.heldByKeeper ? ", this keeper" : ""})`).join(", ")}` : ""}.${p.quorumMet ? "" : ` <span class="bad">The keeper holds ${p.keeperHolds}, so readings wait for the other ${p.quorum - p.keeperHolds === 1 ? "signer" : "signers"}.</span>`}${p.adminRenounced ? " The config authority has given up its control." : ""} ${p.lastReading ? `The last reading was on ${esc(p.lastReading.date)} (<a href="${esc(p.lastReading.txUrl)}">${esc(p.lastReading.signature.slice(0, 12))}…</a>).` : "There is no reading yet."}</p>
<p>The last reading on chain is ${esc(q.lastOnChain ?? "not recorded")}, and burns have run through ${esc(q.crankCursor ?? "no date yet")}. ${q.notAttested === 1 ? "One receipt is" : `${q.notAttested} receipts are`} not signed yet, and ${q.awaitingCrank === 1 ? "one signed receipt is" : `${q.awaitingCrank} signed receipts are`} waiting for a burn run. ${esc(q.carriedSpendSol)} SOL of spending carries over.${q.waits.length ? ` Still waiting: ${q.waits.slice(0, 5).map((w) => `${esc(w.eventId)} (${esc(w.reason)})`).join("; ")}.` : ""}${q.partials.length ? ` Days only partly spent: ${q.partials.map((x) => `${esc(x.readingDate)} (${esc(x.note)})`).join("; ")}.` : ""}</p>${q.dispersal?.length ? `\n<p>The carried spending is bought in small pieces at random times over six-hour windows, so no single purchase moves the pool much. ${q.dispersal.map((l) => `${esc(l.charAt(0).toUpperCase() + l.slice(1))}.`).join(" ")}</p>` : ""}
<p>${p.pool.registered ? `The trading pool is <code>${esc(p.pool.address)}</code>. ${p.pool.untradeableSince ? `<span class="bad">It has not been tradeable since ${esc(p.pool.untradeableSince)}.</span>` : "It is tradeable."}` : "No trading pool is registered yet. Either the curve has not graduated, or the step that registers the pool has not run."} So far the program has recorded ${p.totals.readings} readings and ${p.totals.burns} burns, burned ${fmt(p.totals.burned)} tokens and spent ${esc(p.totals.spentSol)} SOL.</p>`;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------------------------------------------------------------

const esc = (s: string | number | null | undefined) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
const fmt = (s: string) => { const [w, f] = s.split("."); return w.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (f ? `.${f}` : ""); };
/** One post-graduation leg as a percent of every swap ("0.7125%"), read from the split the page carries. */
const postLegPct = (f: FeeSplit, label: FeeSplit["legs"][number]["label"]): string => `${(f.legs.find((l) => l.label === label)?.bps ?? 0) / 100}%`;
const feeTable = (f: FeeSplit) => `<table><thead><tr><th>${esc(f.phase)}</th><th>Basis points</th><th>SOL per 1 SOL traded</th><th>Paid to</th><th>Setting</th></tr></thead><tbody>${f.legs.map((l) => `<tr><td>${esc(l.label)}</td><td class="num">${l.bps}</td><td class="num">${esc(bpsPerSol(l.bps))}</td><td>${esc(l.recipient)}</td><td class="muted">${esc(l.dial)}</td></tr>`).join("")}<tr><td>total</td><td class="num">${f.totalBps}</td><td class="num">${esc(bpsPerSol(f.totalBps))}</td><td></td><td></td></tr></tbody></table>`;

/**
 * owner 2026-10-14: where to trade the coin, on its static page (tradeLinks.ts coinLinks, the same builder as the app). Burnticker never
 * takes an order; each link opens Raydium, Jupiter, DexScreener or Solscan.
 */
export function tradeLinksHtml(s: Pick<TokenStatusJson, "cluster" | "mint" | "status"> & { market?: TokenStatusJson["market"] | null }): string {
  const l = coinLinks({ cluster: s.cluster, mint: s.mint, phase: s.market?.phase ?? null, status: s.status });
  const all = allLinks(l);
  if (!all.length) return l.note ? `<p class="muted" data-trade-links>${esc(l.note)}</p>` : "";
  return `<p data-trade-links>${all.map((x, i) => `<a ${i === 0 && l.primary ? 'style="font-weight:600" ' : ""}href="${esc(x.url)}" rel="noopener" target="_blank">${esc(x.label)}</a>`).join(" · ")}</p>${l.note ? `<p class="muted">${esc(l.note)}</p>` : ""}`;
}

/** The index row's trade cell: the primary trade link, or a dash. */
function indexTradeCell(t: Pick<PlatformIndexToken, "mint" | "status" | "phase">, cluster: string | undefined): string {
  const p = coinLinks({ cluster: cluster ?? "mainnet", mint: t.mint, phase: t.phase, status: t.status }).primary;
  return p ? `<a href="${esc(p.url)}" rel="noopener" target="_blank">${esc(p.label)}</a>` : "—";
}

export function renderTokenHtml(s: TokenStatusJson, receipts: readonly ReceiptJson[], readings: readonly ReadingRow[]): string {
  const t = esc(s.ticker);
  const rows = [...receipts].reverse();
  const tile = (label: string, value: string, sub = "") => `<div class="tile"><div class="label">${esc(label)}</div><div class="value">${value}</div>${sub ? `<div class="sub">${sub}</div>` : ""}</div>`;
  const check = (b: ReceiptJson) => (b.verify.verified ? `<span class="ok" title="recomputed from the reading and the rule; matches the memo on chain">✓</span>` : b.status === "confirmed" ? `<span class="bad" title="${esc(b.verify.checks.join("; "))}">!</span>` : "…");
  const link = (url: string | null, sig: string | null, fallback: string) => (url && sig ? `<a href="${esc(url)}">${esc(sig.slice(0, 10))}…</a>` : esc(fallback));
  const chartReadings = readings.filter((r) => r.value !== null).map((r) => ({ recordDate: r.at, amount: r.value! }));
  const chart = (s.oracle === "kalshi" || s.oracle === "polymarket") && readings.every((r) => r.value === null)
    ? `<p class="muted">This coin reads yes-or-no results. ${readings.length === 1 ? "One settled market has" : `${readings.length} settled markets have`} been read: ${readings.filter((r) => r.result === "yes").length} YES, ${readings.filter((r) => r.result === "no").length} NO and ${readings.filter((r) => r.result === "void").length} void.</p>`
    : seriesChartSvg(chartReadings, receipts.map((b) => ({ recordDate: b.settledAt, units: b.units, status: b.status })), { ariaLabel: `${s.seriesTitle ?? s.selectorKey}, with a marker on each burn`, tick: (v) => (Math.abs(v) >= 1e12 ? `$${(v / 1e12).toFixed(2)}T` : Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : String(Number(v.toFixed(2)))) });
  const tiles = [
    tile("Supply", fmt(s.supply.current), `of ${fmt(s.supply.initial)}, read from the ${s.supply.source === "chain" ? "chain" : "registry"}`),
    tile("Burned", fmt(s.burned.total), `${s.burned.pctOfSupply.toFixed(2)}% of supply, in ${s.burned.count} ${s.burned.count === 1 ? "burn" : "burns"}. ${fmt(s.burned.last30d)} in the last 30 days.`),
    s.mode === "buyback" ? tile("Burn pool", s.pool.feePdaSol === null ? "—" : `${esc(s.pool.feePdaSol)} SOL`, `${esc(s.pool.spendableSol ?? "An unknown amount of")} SOL can be spent after a ${esc(s.pool.reserveSol)} SOL reserve.${s.pool.queuedSol && s.pool.queuedSol !== "0" ? ` ${esc(capHeldSentence(s.pool.queuedSol, null))}` : ""}`) : tile("Vault", s.pool.vaultBalance === null ? "—" : fmt(s.pool.vaultBalance), `The allocation is ${fmt(s.pool.vaultAllocation ?? "0")}. The vault still owes ${fmt(s.pool.shortfallOutstanding)}.`),
    tile("Next possible burn", `<span id="next" data-at="${esc(s.next.nextCheckAt ?? "")}">${esc(s.next.nextCheckAt ?? (s.rules.oneShot ? "resolves once" : "—"))}</span>`, s.next.awaitingFinal ? `${s.next.awaitingFinal === 1 ? "One result is" : `${s.next.awaitingFinal} results are`} waiting for the market to make it final.` : "This is the next time the source is read."),
  ].filter(Boolean).join("\n");
  const table = rows.length === 0 ? `<p class="muted">No receipts yet. The first result after launch starts the record.${s.rules.oneShot ? "" : " For a rule that compares with the previous reading, the first reading sets the starting point."}</p>` : `<div class="scroll"><table>
<thead><tr><th>Settled</th><th>Market / period</th><th>Result</th><th>Value</th><th>Units</th><th>Spent</th><th>Bought</th><th>Burned</th><th>Tx</th><th>Source</th><th>Check</th></tr></thead><tbody>
${rows.map((b) => `<tr><td>${esc(b.settledAt.slice(0, 19).replace("T", " "))}</td><td title="${esc(b.title)}"><code>${esc(b.market)}</code></td><td>${esc(b.result ?? "—")}</td><td class="num">${esc(b.value ?? "—")}</td><td class="num">${b.units}</td><td class="num">${b.status === "confirmed" ? esc(b.spent ?? "—") : "—"}</td><td class="num">${b.got === null ? "—" : fmt(b.got)}</td><td class="num">${b.status === "confirmed" ? fmt(b.burned ?? "0") : `<span class="muted" title="${esc(b.skippedReason ?? b.note)}">${esc(receiptStatusWords(b.status))}</span>`}</td><td>${link(b.txUrl, b.signature, b.status === "planned" || b.status === "sending" ? (b.waitReason ? "waiting" : "pending") : "—")}</td><td>${b.settlementSourceUrl ? `<a href="${esc(b.settlementSourceUrl)}">source</a>` : ""}${b.sourceUrl ? ` <a href="${esc(b.sourceUrl)}">api</a>` : ""}</td><td>${check(b)}</td></tr>`).join("\n")}
</tbody></table></div>`;
  const verify = rows.slice(0, 60).map((b) => `<details><summary>${esc(utcDay(b.settledAt))}, ${esc(b.market)}: ${esc(b.result ?? b.value ?? "")}, ${b.units} ${b.units === 1 ? "unit" : "units"}, ${b.status === "confirmed" ? `${fmt(b.burned ?? "0")} ${t} burned` : esc(receiptStatusWords(b.status))}${b.verify.verified ? " ✓" : ""}</summary>
<p>1. Read the settled result from the source:</p><pre><code>${esc(b.verify.curl)}</code></pre>${b.method ? `<p class="muted">The value was read by ${esc(b.method)}.</p>` : ""}
<p>2. Apply the rule:</p><pre><code>${esc(b.verify.formula)}</code></pre>
<p>3. Check that you get this: <strong>${esc(b.verify.expected)}</strong></p>
<p>4. The receipt memo on chain${b.txUrl ? ` (<a href="${esc(b.txUrl)}">transaction</a>)` : ""}:</p><pre><code>${esc(b.memo ?? (b.status === "confirmed" ? "?" : `No transaction yet: ${receiptStatusWords(b.status)}.`))}</code></pre>
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
${s.pair ? `<div class="rule"><strong>$${t} <span class="muted">vs</span> <a href="../${esc(s.pair.counterpart.ticker)}/">$${esc(s.pair.counterpart.ticker)}</a></strong>. This coin is side ${esc(s.pair.side)} of the rivalry pair <code>${esc(s.pair.pairId)}</code>. ${esc(settledLineOf(s.rules.statement) ?? "Both coins read the same market with opposite rules, so each result burns exactly one side.")} Burns ${s.pair.tally.burnsThis} : ${s.pair.tally.burnsOther}. Tokens burned ${fmt(s.pair.tally.burnedThis)} : ${fmt(s.pair.tally.burnedOther)}. Supply ${fmt(s.pair.tally.supplyThis)} : ${fmt(s.pair.tally.supplyOther)}.${s.pair.counterpart.lastBurnAt ? ` The other side last burned on ${esc(utcDay(s.pair.counterpart.lastBurnAt))}.` : ""} <a href="../../p/${esc(s.pair.pairId)}/">Open the pair page</a>.</div>` : ""}
<h1>$${t} <span class="muted" style="font-weight:400">${esc(s.name)}</span></h1>
${tradeLinksHtml(s)}
${s.profile?.badge ? `<p><code>${esc(s.profile.badge)}</code></p>` : ""}${s.profile?.description ? `<p>${esc(s.profile.description)}</p>` : ""}${s.profile?.note ? `<p class="muted"><em>Creator's note (not part of the rule):</em> ${esc(s.profile.note)}</p>` : ""}
<p class="muted">${esc(AFFILIATION_LINE)}</p>
${s.pinned?.metadataUri && !s.pinned.hosted ? `<p class="muted">The coin's metadata is pinned on Arweave at <a href="${esc(s.pinned.metadataUri)}">${esc(s.pinned.metadataUri)}</a>. Its sha256 hash is <code>${esc(s.pinned.metadataSha256 ?? "")}</code>.</p>` : ""}
<p class="muted">Source: ${esc(s.oracle === "kalshi" ? "Kalshi" : s.oracle === "polymarket" ? "Polymarket, with each result read on Polygon" : "the source's own published data")}${s.seriesTitle ? `, ${esc(s.seriesTitle)}` : ""} (<code>${esc(s.selectorKey)}</code>). This coin is ${esc(s.status)} on ${esc(s.cluster)}. Updated ${esc(s.generatedAt)}.</p>
<div class="rule"><strong>The rule.</strong> ${esc(s.rules.statement)}<br><span class="muted">The rule file is <a href="rules.json">rules.json</a>, and its sha256 hash is <code>${esc(s.rules.sha256)}</code>. It was locked at launch, and nobody can change it.</span>${s.rules.oneShot ? `<br><span class="muted">This rule resolves once${s.next.nextCloseTime ? `, on ${esc(s.next.nextCloseTime)}` : ""}. After that, the supply is fixed.</span>` : ""}</div>
<div class="tiles">
${tiles}
</div>
<h2>Today</h2>
<pre class="today" id="today">${esc(tokenDayText(s, receipts, s.generatedAt.slice(0, 10)))}</pre>
<p class="muted">These are the same words as the day's post. They report what the rule did today, filled in from this coin's published data and never retyped.</p>
<h2>${esc(s.seriesTitle ?? s.selectorKey)}</h2>
<p class="muted">${s.feed.lastEventId ? `The latest reading is ${s.feed.lastValue ? `${esc(s.feed.lastValue)} for ` : ""}${esc(s.feed.lastEventId)}, settled ${esc(s.feed.lastSettledAt)}.` : "There is no reading yet."} ${s.feed.readings === 1 ? "One reading has" : `${s.feed.readings} readings have`} been taken. Dots mark burns, and a larger dot means more units.</p>
${chart}
<h2>Receipts</h2>
${table}
<h2>Verify it yourself</h2>
<p class="muted">Every receipt can be recomputed from the public settled result and the rule file. The keeper recomputes each one from its recorded readings and shows ✓ when that agrees with the memo it put on chain.</p>
${verify || `<p class="muted">There is nothing to check yet.</p>`}
${programSection(s.program)}
<h2>Trade</h2>
<div class="embed">${s.addresses.poolId ? `The LaunchLab pool is <code>${esc(s.addresses.poolId)}</code>.` : "The LaunchLab pool is not created yet."} This page does not show the curve yet.</div>
${tradeLinksHtml(s)}
<h2>Fees</h2>
<p>${esc(s.fees.sentence)}</p>
<div class="scroll">${feeTable(s.fees.curve)}</div>
<div class="scroll" style="margin-top:8px">${feeTable(s.fees.postGraduation)}</div>
<p class="muted">The creator's share of fees is ${s.fees.creatorSliceBps / 100}%. Creators earn no cash from fees, because the creator-fee slot pays the burn pool. At graduation, ${LP_LOCKED_PCT}% of the liquidity is locked forever, and its fees fund the burn.${s.trust.lpLockedPct == null ? ` ${esc(LP_ADMIN_KEY_LINE)}` : ""} ${esc(postGraduationShareLine(s.fees.postGraduation))} The operator's part of the liquidity fees is fixed in code. Of the burn pool's share, ${postLegPct(s.fees.postGraduation, "burn pool")} of every swap comes from Raydium's fixed CPMM creator fee.</p>
${lpLockHtml(s.lp)}
<h2>What the operator can and cannot do</h2>
<p class="muted">These lists come from the <a href="${esc(s.trust.registerUrl)}">Powers Register</a>.${s.trust.operator.placeholder ? " The register file is not on this site, so these rows come from its settings." : ""} ${s.trust.lpLockedPct == null ? esc(LP_BEFORE_GRADUATION_LINE) : `${s.trust.lpLockedPct}% of the liquidity is locked forever.`} ${esc(postGraduationShareLine(s.fees.postGraduation))} ${s.trust.creatorCashBps === 0 ? "Creators get no cash from fees." : `Creators get ${s.trust.creatorCashBps / 100}% of fees in cash.`} The team allocation is ${s.trust.teamAllocationPct}%.</p>
<div class="rule"><strong>Can:</strong> ${s.trust.operator.can.map(esc).join("; ")}.<br><strong>Cannot:</strong> ${s.trust.operator.cannot.map(esc).join("; ")}.</div>
<p class="muted">${esc(OPERATOR_LINE)}</p><p class="muted">${esc(USE_OF_FEES)} Creators may stay anonymous, but the creator's wallet is shown below.${s.mode === "buyback" ? ` ${esc(s.pool.queuedNote)}` : ""}</p>
<h2>Reading signers</h2>
<p>${s.attesters.length ? `Each reading needs ${s.quorum} of ${s.attesters.length} ${s.attesters.length === 1 ? "signature" : "signatures"} from these keys: ${s.attesters.map((a) => `<code>${esc(a.pubkey)}</code> (${esc(a.role)}${a.active ? "" : ", inactive"})`).join(", ")}.` : "<em>No signers are recorded.</em>"} At level 1, our data key signs each reading. Level 2 adds an independent signer for each source. Level 3 adds a proof of the source's response (zkTLS), or an on-chain result where the market publishes one.</p>
<h2>Addresses</h2>
<ul class="addr"><li><span class="muted">Mint</span> <a href="${esc(s.addresses.mintUrl)}"><code>${esc(s.addresses.mint)}</code></a></li><li><span class="muted">Burn pool. This is the burn program's fee account, and it is also the coin's creator on LaunchLab. Anyone can deposit and nobody can withdraw. The keeper only pays network fees.</span> <a href="${esc(s.addresses.feePdaUrl)}"><code>${esc(s.addresses.feePda)}</code></a></li>${s.addresses.feeWsol ? `<li><span class="muted">The burn pool's wrapped SOL account, where claimed curve fees land</span> <a href="${esc(s.addresses.feeWsolUrl)}"><code>${esc(s.addresses.feeWsol)}</code></a></li>` : ""}${s.addresses.vault ? `<li><span class="muted">Vault</span> <a href="${esc(s.addresses.vaultUrl)}"><code>${esc(s.addresses.vault)}</code></a></li>` : ""}<li><span class="muted">Creator</span> <a href="${esc(s.addresses.creatorUrl)}"><code>${esc(s.addresses.creator)}</code></a>${s.addresses.creatorNote ? ` <span class="muted" data-operator-creator>${esc(s.addresses.creatorNote)}</span>` : ""}</li><li><span class="muted">Burn program</span> <code>${esc(s.addresses.programId)}</code></li>${s.addresses.launchTx ? `<li><span class="muted">Launch</span> <a href="${esc(s.addresses.launchTxUrl)}"><code>${esc(s.addresses.launchTx)}</code></a></li>` : ""}</ul>
${s.disclosure.eventContract ? `<p class="rule">${esc(s.disclosure.eventContract)}</p>` : ""}
<p class="rule">${s.lifecycle ? `${esc(s.lifecycle.line)} ` : ""}${esc(feeFlowLine(s.fees.postGraduation, s.trust.lpLockedPct ?? null, !!s.fees.tierUnread))}</p>
<footer>${esc(s.disclosure.disclaimer)} ${esc(healthLine(s.health.pending, s.health.unverified))}${s.health.lastError ? ` The last error was: ${esc(s.health.lastError)}` : ""}</footer>
</main>
<script>
(function(){var el=document.getElementById("next");if(!el)return;var at=Date.parse(el.getAttribute("data-at")||"");if(!at)return;
function tick(){var d=Math.max(0,at-Date.now()),h=Math.floor(d/3.6e6),m=Math.floor(d%3.6e6/6e4),s=Math.floor(d%6e4/1e3);el.textContent=d?("next check in "+h+"h "+m+"m "+s+"s"):"due now";}
tick();setInterval(tick,1000);})();
</script>
</body></html>
`;
}

/** One coin on the platform index — the launchpad card's fields (2026-10-10: image, one-liner, curve progress, last burn, next result). */
export interface PlatformIndexToken {
  ticker: string; name: string; mint: string; oracle: string; selectorKey: string; seriesTitle: string | null; mode: string; status: string; launchedAt: string | null; burned: string; burns: number; pctOfSupply: number; impliedChance: number | null; nextCheckAt: string | null; pairId: string | null;
  imageUrl: string | null; oneLiner: string; lastBurnAt: string | null; nextMarket: string | null; nextCloseTime: string | null; oneShot: boolean; badge?: string | null;
  /** website-15 item 13: the creator's own text and links, shown on the card under the rule */
  creatorText?: string | null; links?: { label: string; url: string }[];
  /** null = the curve was not read (no RPC on the host, or not launched): the card shows "—", never a guess. */
  phase: "curve" | "migrating" | "graduated" | null; progressPct: number | null; raised: string | null; threshold: string | null; quote: string | null;
  /** website-13: the curve's market cap in the quote, read from the pool (market.ts curveMarketCap); null when not read or after graduation. */
  marketCap?: string | null;
  /** the holder count when one was read (indexer-1: holders.ts readHolders); null when not read, with holdersNote saying why */
  holders?: number | null;
  /** indexer-1: why the holder count or the graduated pool was not read */
  holdersNote?: string | null; poolNote?: string | null;
  /** coin card status 2026-10-18: every holder counted is the coin's own curve or pool (cardView.ts onlyPoolHolders) */
  holdersOnlyPools?: boolean;
  /** sources-2: a one-market Polymarket coin's stated source and dispute window */
  stated?: StatedJson | null;
  /**
   * The coin's directory under t/ when it is not its ticker (owner 2026-10-12: tickers are not unique; coinKey.ts siteKeysOf): a coin
   * that shares its ticker with an earlier launched coin publishes at t/<MINT>. Absent means t/<TICKER>.
   */
  siteKey?: string;
}
export interface AuditBadge { ok: boolean; ranAt: string; receipts: number; /** A-6: receipts that moved something on chain; absent in older documents */ executed?: number; /** review 7: confirmed receipts the chain check verified */ chainVerified?: number; mismatches: number; chainChecked: boolean }
export interface PlatformIndexJson { schema: "burnticker.index/v1"; generatedAt: string; tokens: PlatformIndexToken[]; pairs: { pairId: string; selectorKey: string; seriesTitle: string | null; a: PairSideSummary; b: PairSideSummary; winnerTakesBurn?: boolean; forwardedAtoB?: string; forwardedBtoA?: string }[]; totals: { tokens: number; live: number; burns: number; burnedTokens: string; pairs: number }; audit: AuditBadge | null;
  /** owner 2026-10-14: the network the coins are on, for the index's trade links (absent on an older index) */
  cluster?: string }

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
    imageUrl: s.profile?.imageUrl ?? null, creatorText: s.profile?.creatorText ?? null, links: s.profile?.links ?? [], oneLiner: s.profile?.oneLiner ?? (s.seriesTitle ?? s.selectorKey), lastBurnAt: s.burned.lastAt ?? null, nextMarket: s.next.nextMarket, nextCloseTime: s.next.nextCloseTime, oneShot: s.rules.oneShot, badge: s.profile?.badge ?? null,
    phase: s.market?.phase ?? null, progressPct: c ? c.progressPct : s.market?.phase === "graduated" ? 100 : null, raised: c?.raised ?? null, threshold: c?.threshold ?? null, quote: c?.quote ?? null,
    marketCap: c?.marketCap ?? s.market?.pool?.marketCap ?? null, holders: walletHolders(s.market?.holders),
    holdersNote: s.market && s.market.holders.count === null ? s.market.holders.countNote || null : null, poolNote: s.market?.poolNote ?? null,
    holdersOnlyPools: s.market?.holders.wallets === 0 || onlyPoolHolders(s.market?.holders.count ?? null, s.market?.holders.top10 ?? null),
    stated: s.stated ?? null,
  };
}

/** `siteKeys`: each coin's site directories by mint (coinKey.ts siteKeysOf); the keeper passes its own, else they are worked out from the statuses. */
export function buildPlatformIndex(statuses: readonly TokenStatusJson[], now: number, audit: AuditBadge | null = null, siteKeys: ReadonlyMap<string, readonly string[]> = statusSiteKeys(statuses)): PlatformIndexJson {
  const pairs = groupPairs(statuses);
  return {
    schema: "burnticker.index/v1", generatedAt: new Date(now).toISOString(), audit, pairs, ...(statuses[0]?.cluster ? { cluster: statuses[0].cluster } : {}),
    tokens: statuses.map((s) => { const k = siteKeys.get(s.mint)?.[0]; return k && k !== s.ticker ? { ...indexToken(s), siteKey: k } : indexToken(s); }),
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
<p class="muted">These are tokens whose supply burns when a settled, public event says so. They use settled results only, never prices. Every burn has a receipt with the source, the rule, the arithmetic and the transaction. Updated ${esc(ix.generatedAt)}.</p>
<div class="tiles"><div class="tile"><div class="label">Live tokens</div><div class="value">${ix.totals.live}</div></div><div class="tile"><div class="label">Burns</div><div class="value">${ix.totals.burns}</div></div><div class="tile"><div class="label">Tokens burned</div><div class="value">${esc(fmt(ix.totals.burnedTokens))}</div></div><div class="tile"><div class="label">Public audit</div><div class="value">${(() => { const v = auditBadgeView(ix.audit); return `<span class="${v.tone}">${esc(v.text)}</span>`; })()}</div><div class="sub">${ix.audit ? `${esc(auditBadgeView(ix.audit).sub)}. Last run ${esc(ix.audit.ranAt)}.` : "The public audit has not run yet."} <a href="trust/">See the trust page.</a></div></div></div>
<h2>Today</h2>
<pre class="today" id="today">${esc(today)}</pre>
${ix.pairs.length ? `<h2>Rivalry pairs</h2>
<div class="tiles">${ix.pairs.map((p) => `<div class="tile"><div class="label">${esc(p.seriesTitle ?? p.selectorKey)}</div><div class="value"><a href="t/${esc(p.a.ticker)}/">$${esc(p.a.ticker)}</a> ${p.a.burns} : ${p.b.burns} <a href="t/${esc(p.b.ticker)}/">$${esc(p.b.ticker)}</a></div><div class="sub">Tokens burned ${fmt(p.a.burned)} : ${fmt(p.b.burned)}. Supply ${fmt(p.a.supply)} : ${fmt(p.b.supply)}. <a href="p/${esc(p.pairId)}/">Open the pair page</a>.</div></div>`).join("")}</div>` : ""}
<h2>Tokens</h2>
${ix.tokens.length ? `<div class="scroll"><table><thead><tr><th>Ticker</th><th>Name</th><th>Event</th><th>Mode</th><th>Burned</th><th>Burns</th><th>Status</th><th>Trade</th></tr></thead><tbody>
${ix.tokens.filter((t) => !t.pairId).map((t) => `<tr><td><a href="t/${esc(t.siteKey ?? t.ticker)}/">$${esc(t.ticker)}</a></td><td>${esc(t.name)}</td><td title="${esc(t.selectorKey)}">${esc(t.seriesTitle ?? t.selectorKey)}</td><td>${esc(t.mode)}</td><td class="num">${fmt(t.burned)} (${t.pctOfSupply.toFixed(2)}%)</td><td class="num">${t.burns}</td><td>${esc(t.status)}</td><td>${indexTradeCell(t, ix.cluster)}</td></tr>`).join("\n")}
</tbody></table></div>` : `<p class="muted">There are no tokens yet.</p>`}
<h2>How it works</h2>
<ol><li>A creator picks an event source, such as a Kalshi series or market or a source's own published data. Then the creator picks a rule that says what each settled outcome burns. The rule is hashed and locked at launch.</li><li>The token launches on Raydium LaunchLab through Burnticker's platform settings. Its creator-fee slot pays all of its fees to its own burn pool.</li><li>When the event settles, the keeper reads the settled result, never a price. It works out the units with the published rule and runs the burn program. The program spends the rule's share of the pool buying the token at market and burns everything it gets, or it burns tokens from a vesting vault. It also writes the receipt memo on chain.</li><li>Anyone can recompute every receipt from the source and the rule. If we stop, anyone can run the burn with the same public readings.</li></ol>
<footer>${esc(DISCLAIMER_FOOTER)}</footer>
</main></body></html>
`;
}

/**
 * THE PAIR PAGE (static; p/<pairId>/index.html beside pair.json). A scoreboard header — burns A : B, supply A : B, the last settlement
 * with its market ticker and result, the next scheduled market (ticker and close time only, no odds) — the share line
 * (pairDailyText), both receipts tables stacked, both rules with their hashes, the disclaimer. Pure over the two sides' pages.
 */
/**
 * `keys` (review follow-up 3): the keeper's site directories per mint (coinKey.ts siteKeysOf); a side links to its own first directory, so
 * a coin whose ticker another coin also holds links by its mint. Without keys, by ticker as before.
 */
export function renderPairHtml(tally: PairTally, a: TokenStatusJson, b: TokenStatusJson, receiptsA: readonly ReceiptJson[], receiptsB: readonly ReceiptJson[], site: string | null = null, keys: ReadonlyMap<string, readonly string[]> | null = null): string {
  const dirOf = (s: TokenStatusJson): string => encodeURIComponent(keys?.get(s.mint)?.[0] ?? s.ticker);
  const A = esc(a.ticker), B = esc(b.ticker);
  const tile = (label: string, value: string, sub = "") => `<div class="tile"><div class="label">${esc(label)}</div><div class="value">${value}</div>${sub ? `<div class="sub">${sub}</div>` : ""}</div>`;
  const ls = tally.lastSettlement;
  const chance = (c: number | null) => (c === null ? "—" : `${(c * 100).toFixed(0)}%`);
  const sideTicker = (x: "A" | "B" | null) => (x === "A" ? `$${A}` : x === "B" ? `$${B}` : "neither side");
  const table = (s: TokenStatusJson, rs: readonly ReceiptJson[]) => rs.length === 0 ? `<p class="muted">No receipts yet for $${esc(s.ticker)}.</p>` : `<div class="scroll"><table><thead><tr><th>Settled</th><th>Market</th><th>Result</th><th>Units</th><th>Burned</th><th>Tx</th><th>Check</th></tr></thead><tbody>
${[...rs].reverse().map((r) => `<tr><td>${esc(r.settledAt.slice(0, 19).replace("T", " "))}</td><td><code>${esc(r.market)}</code></td><td>${esc(r.result ?? r.value ?? "—")}</td><td class="num">${r.units}</td><td class="num">${r.status === "confirmed" ? fmt(r.burned ?? "0") : r.status === "forwarded" ? `<span class="muted">forwarded ${esc(r.spent ?? "")} SOL</span>` : `<span class="muted">${esc(receiptStatusWords(r.status))}</span>`}</td><td>${r.txUrl && r.signature ? `<a href="${esc(r.txUrl)}">${esc(r.signature.slice(0, 10))}…</a>` : "—"}</td><td>${r.verify.verified ? '<span class="ok">✓</span>' : r.status === "confirmed" ? `<span class="bad" title="${esc(r.verify.checks.join("; "))}">!</span>` : "…"}</td></tr>`).join("\n")}
</tbody></table></div>`;
  const tiles = [
    tile("Burns", `$${A} ${tally.burnsA} <span class="muted">:</span> ${tally.burnsB} $${B}`, `${tally.settlements === 1 ? "One result" : `${tally.settlements} results`} so far${tally.voids ? `, ${tally.voids} of them void` : ""}. Tokens burned ${fmt(tally.burnedA)} : ${fmt(tally.burnedB)}.`),
    tile("Supply", `${tally.supplyPctA.toFixed(2)}% <span class="muted">:</span> ${tally.supplyPctB.toFixed(2)}%`, `${fmt(tally.supplyA)} : ${fmt(tally.supplyB)}, out of ${fmt(a.supply.initial)} each`),
    // A-5: the sentence by pair role and pending state (receiptWords.ts), never "settled 0, neither side burned" for a waiting burn
    tile("Last settlement", ls ? `<code>${esc(ls.eventId)}</code>` : "none yet", ls ? esc(pairLastSentence(ls.facts ?? { wonSide: null, burnedSide: ls.burnedSide, burned: ls.burned, winnerStatus: null, loserStatus: null, void: ls.result === "void" }, sideTicker("A"), sideTicker("B"), fmt) ?? "") : "The first result after launch burns one side."),
    // HB-135 (hourly run 11): a one-result pair whose result is in has no next market, said in words
    tile("Next scheduled market", tally.next.market ? `<code>${esc(tally.next.market)}</code>` : esc(nextMarketNone({ oneShot: !!a.rules.oneShot, settlements: tally.settlements })), `${tally.next.closeTime ? `closes ${esc(tally.next.closeTime)}` : a.rules.oneShot && tally.settlements > 0 ? "Nothing more is scheduled." : "The next result after launch."}`),
    ...(tally.attesterLine ? [tile("Reading signers", "1 key", esc(tally.attesterLine))] : []),
    ...(tally.unpaired ? [tile("Pair", "unpaired", `The pair was unlinked on ${esc(utcDay(tally.unpaired.at))} (${esc(tally.unpaired.reason)}). They are two separate coins now, and nothing moves between them.`)] : []),
    ...(tally.winnerTakesBurn ? [tile("Burned and forwarded", `$${A} burned ${fmt(tally.burnedA)}. $${B} burned ${fmt(tally.burnedB)}.`, `$${A} has forwarded ${esc(tally.forwardedAtoB ?? "0")} SOL to $${B}, and $${B} has forwarded ${esc(tally.forwardedBtoA ?? "0")} SOL to $${A}. ${esc(PAIR_BURN_SENTENCE)}`)] : []),
  ].join("\n");
  const rule = (s: TokenStatusJson, side: "A" | "B") => `<div class="rule"><strong>Side ${side}: <a href="../../t/${dirOf(s)}/">$${esc(s.ticker)}</a></strong> ${esc(s.name)}. ${esc(s.rules.statement)}<br><span class="muted">The rule file is <a href="../../t/${dirOf(s)}/rules.json">rules.json</a>, and its sha256 hash is <code>${esc(s.rules.sha256)}</code>.</span></div>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>$${A} vs $${B}, a rivalry pair</title>
<meta name="description" content="${pairKindOf(a) === "inversion" ? `$${A} and $${B} read one settled market with opposite rules, so every result burns one side.` : `$${A} and $${B} are a rivalry pair. Each result burns the coin its rule names, and some results burn neither.`} The receipts are the scoreboard.">
<style>
${STATUS_CSS}
.score{font-size:2.2rem;font-weight:700;text-align:center;margin:8px 0 4px;font-variant-numeric:tabular-nums}
.today{white-space:pre-wrap;word-break:break-word;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 16px;font:inherit;line-height:1.5}
</style></head><body><main>
<p><a href="../../">← Burnticker</a></p>
<h1><a href="../../t/${dirOf(a)}/">$${A}</a> <span class="muted" style="font-weight:400">vs</span> <a href="../../t/${dirOf(b)}/">$${B}</a></h1>
<p class="muted">${esc(pairLeadSentence(a.ticker, b.ticker))} ${pairKindOf(a) === "meetings" ? `${esc(MEETINGS_PAIR_PAGE_LINE)} A draw, a postponed or a cancelled game moves nothing.` : settledLineOf(a.rules.statement) ? esc(settledLineOf(a.rules.statement)!) : `Both coins read the same market${a.seriesTitle ? ` (${esc(a.seriesTitle)})` : ""} with opposite rules, so each result burns exactly one side. A voided market burns neither.`} Updated ${esc(a.generatedAt)}.</p>
<div class="score">$${A} ${tally.burnsA} <span class="muted">:</span> ${tally.burnsB} $${B}</div>
<div class="tiles">
${tiles}
</div>
<p class="muted">${esc(NO_WALLET_LINE)} ${esc(termLine(["receipt", "burnPool"]))}</p>
<h2>Share line</h2>
<pre class="today" id="share">${esc(pairDailyText(tally, site, a.profile?.badge ?? null).replace(/\s*\{SITE_URL\}\/p\/[^/]+\/$/m, " this page"))}</pre>
<p class="muted">These are the same words as the pair's post. They report the tally, filled in from both coins' published data and never retyped.</p>
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
<footer>This is a memecoin pair. Each rule says what its coin's supply does, not what the price does. Nobody is promised anything. ${esc(a.disclosure.disclaimer)}</footer>
</main></body></html>
`;
}

/** Writes one pair's site: p/<pairId>/{pair.json, index.html}. */
export function publishPairSite(dir: string, tally: PairTally, a: TokenStatusJson, b: TokenStatusJson, receiptsA: readonly ReceiptJson[], receiptsB: readonly ReceiptJson[], keys: ReadonlyMap<string, readonly string[]> | null = null): void {
  publishSite(`${dir}/p/${tally.pairId}`, { "pair.json": toJson({ schema: "burnticker.pair/v1", generatedAt: a.generatedAt, tally }), "index.html": renderPairHtml(tally, a, b, receiptsA, receiptsB, null, keys) });
}

/**
 * Writes one token's site: t/<key>/{status.json, receipts.json, rules.json, index.html} for each of its keys (coinKey.ts siteKeysOf: the
 * ticker, the mint, or both when the ticker is shared). Without keys, t/<ticker> as before.
 */
export function publishTokenSite(dir: string, s: TokenStatusJson, receipts: readonly ReceiptJson[], readings: readonly ReadingRow[], rulesText: string, keys: readonly string[] = [s.ticker]): void {
  const files = { "status.json": toJson(s), "receipts.json": toJson(receipts), "rules.json": rulesText, "index.html": renderTokenHtml(s, receipts, readings) };
  for (const k of keys) publishSite(`${dir}/t/${k}`, files);
}

/** The site keys worked out from published statuses (registry order; launch time from status.json). */
export function statusSiteKeys(statuses: readonly TokenStatusJson[]): Map<string, string[]> {
  return siteKeysOf(statuses.map((s) => ({ ticker: s.ticker, mint: s.mint, status: s.status, launchedAt: s.launchedAt ?? null })));
}

/** `receiptsByTicker` is read by mint first, then by ticker (coinKey.ts byCoin); the keeper keys it by mint. */
export function publishPlatformIndex(dir: string, statuses: readonly TokenStatusJson[], now: number, audit: AuditBadge | null = null, receiptsByTicker: Record<string, readonly ReceiptJson[]> = {}, siteKeys?: ReadonlyMap<string, readonly string[]>): PlatformIndexJson {
  const keys = siteKeys ?? statusSiteKeys(statuses);
  const ix = buildPlatformIndex(statuses, now, audit, keys);
  publishSite(dir, { "index.json": toJson(ix), "index.html": renderPlatformIndexHtml(ix, receiptsByTicker) });
  // Each pair's scoreboard page (the index cards and the versus headers link to p/<pairId>/).
  for (const p of ix.pairs) {
    const a = statuses.find((s) => s.mint === p.a.mint), b = statuses.find((s) => s.mint === p.b.mint);
    if (!a || !b) continue;
    const ra = byCoin(receiptsByTicker, a) ?? [], rb = byCoin(receiptsByTicker, b) ?? [];
    publishPairSite(dir, pairTally(a, b, ra, rb), a, b, ra, rb, keys);
  }
  return ix;
}
