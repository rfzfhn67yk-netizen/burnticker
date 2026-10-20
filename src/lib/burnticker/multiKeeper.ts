import { backoffMs } from "@/lib/burnKeeper/schedule";
import type { ResolvedSelector } from "@/lib/burnticker/oracle/types";
import { rawToTokens } from "@/lib/burnKeeper/rules";
import { formatDate, utcDate } from "@/lib/burnReceipts/math";
import { WAIT_REASONS, WAIT_RETRY_MS, type ProgramConfigView, type ProgramPort, type ProgramReadingView } from "@/lib/burnKeeper/programChain";
import type { OracleAdapter } from "@/lib/burnticker/oracle/types";
import { feedById } from "@/lib/burnticker/catalogue";
import { nativeSourceById } from "@/lib/burnticker/sources/native";
import { isFirstSnowSeries, snowSeasonEnd, snowSeasonVoidFromMs } from "@/lib/burnticker/sources/nws";
import { readingMatches, RevisedReadingError, selectorKeyOf, wideRule, type PairRole, type ReceiptRow, type Registry, type TokenRow } from "@/lib/burnticker/registry";
import { DECIMALS, endSinkOf, isSettledPairRule, isOneShot, settledPairShape, pairClause, pairMirrorRule, ruleMappings, SWEEP_EVERY_DAYS, type BurnRule, type LockedRule } from "@/lib/burnticker/rules";
import { endStep, firstWindDownDay, fullSpendUnits, gatedStatus, unitStep, unitSteps, voidByEndMs, windDownUnits, type CarryPolicy, type EndReceiptKind, type PairGate, type SettledEvent } from "@/lib/burnticker/units";
import { rulesSha256 } from "@/lib/burnKeeper/rules";
import { solToLamports } from "@/lib/burnKeeper/rules";
import { derbyProofHash } from "@/lib/burnticker/derby/adapter";
import { expectedConfigFor, viewMismatch, type ExpectedHost } from "@/lib/burnticker/admission";
import { COUNTER_BASE, counterRule, counterSourceUrl, programExpressible, type BurnProgramClient } from "@/lib/burnticker/program";
import { claimLockFeesFor, type LockFeesOutcome } from "@/lib/burnticker/lockFeesKeeper";
import { parseForwardMemo, type ForwardFacts } from "@/lib/burnticker/pairForward";
import { pairForwardNote } from "@/lib/burnticker/pairReceiptNote";
import { ensurePairResult, forwardLoss, forwardMissingAlert, pairCtxFor, pairUnlinkStep, pairUnmatchedAlerts, raceVerdict, recordForward, sidePayout, type PairCtx } from "@/lib/burnticker/pairForwardKeeper";
import { fenceToken, type FenceReport } from "@/lib/burnticker/ops/readingFence";
import { championVerdict, endOutcomeOf, endSinkStep } from "@/lib/burnticker/endSinkKeeper";
import { burnTargetHold } from "@/lib/burnticker/admissionAccounts";
import { championPathRule } from "@/lib/burnticker/describe";
import { askCosigner, type Cosigner } from "@/lib/burnticker/attesters/cosign";
import type { Cosignature, ReadingInput } from "@/lib/burnKeeper/programPort";
import { parseTargetMemo } from "@/lib/burnReceipts/memo";
import { DISPERSAL_STATE_KEY, runDispersal, type DispersalReport } from "@/lib/burnticker/dispersalKeeper";
import { budgetPhase, isBudgetHold } from "@/lib/burnticker/apiBudget";
import { FilterUnsupportedError, storedFilterProblem } from "@/lib/burnticker/safeRegex";
import { dueNextAt, hasSettlementReceipt, selectorIdle, windowNextAt, type ReadWindow } from "@/lib/burnticker/readPlan";

/**
 * THE MULTI-TOKEN KEEPER (LAUNCHPAD-PATH §2; 2026-10-09): one loop over every registered token. Each cycle:
 *
 *   1. FETCH every selector key in use that is due (a Kalshi series+kind, one market, a Polymarket tag/event/market, or a feed),
 *      through its oracle adapter, with the filter cleared so the whole series is stored once (a Polymarket reading also carries its
 *      on-chain proof: the CTF payout vector's condition id and block, and is written only once the chain has the payout); write the settled readings (an oracle that changes a recorded result holds
 *      the key — the registry refuses the write). Finality is the adapter's job; the keeper never sees a price.
 *   2. PLAN every live token: its readings after its baseline that its filter admits and that it has not yet seen, through the shared
 *      unit engine (the catalogue's carry policy where the feed says so), one receipt row per event — planned (something to crank),
 *      nothing (a NO without onNo, under one unit, wrong direction), or void.
 *   3. EXECUTE through the burn_receipts program (2026-10-10; program.ts explains the UNIT COUNTER): once a UTC day is over, attest
 *      the token's counter (1 + every unit its receipts carried through that day) with submit_reading — write-ahead, quorum from the
 *      TokenConfig — then claim creator fees and check pool health (best-effort), adopt anything already cranked, and crank in order
 *      (crank_buyback / crank_vault). The receipts take the program's facts from its Reading account: the LEAD receipt of a reading
 *      carries the pool, rule spend, carried spend, spent, got, burned and the memo the program wrote; the others the same signature
 *      and memo with zero amounts. The keeper computes no amount. TWAP / pool / day-not-over / quorum-short are WAITS; refusals back
 *      off (15 s doubling to 1 h); an event is late, never lost; one crank per reading across restarts.
 *   4. PUBLISH is the caller's (scripts/burnticker-keeper.mts): status.json + page per token and the platform index, via tokenPage.ts.
 *
 * Everything that touches a chain goes through BurnProgramClient (its per-token ProgramPort); the tests run the FakeBurnProgram (the
 * program in memory). Dry run plans and signs nothing.
 */

export interface KeeperDeps {
  registry: Registry;
  program: BurnProgramClient;
  /**
   * Called before a coin's fence check and before each of its executePending passes when that coin has something the keeper could SEND
   * this cycle (sendableWork: a reading date assigned, or a closed day to attest), never on a dry run (2026-10-15 re-review N1). The keeper
   * re-reads that coin's TokenConfig, fee PDA, mint and the reading PDAs it names in one call (cycleAccountCache.ts refresh), so the fence
   * and the first crank step read the chain as of that moment. `dates`: the reading dates (YYYYMMDD) worth re-reading. Absent: nothing.
   */
  freshReads?: (t: TokenRow, dates: readonly number[]) => Promise<unknown> | unknown;
  /** Polymarket (2026-10-10) is optional so a keeper without it holds Polymarket keys with an error instead of misreading them. */
  oracles: { kalshi: OracleAdapter; catalogue: OracleAdapter; polymarket?: OracleAdapter; /** Burn Derby (2026-10-10; derby/adapter.ts). */ derby?: OracleAdapter };
  /**
   * BURN DERBY'S KEEPER HOOKS (2026-10-10; DerbyAdapter): `sample` runs before the fetch (boundary snapshots: cross-reads, supplies,
   * pool vault balances), `plan` after the cycle (the planning pass: retire coins whose season ended, whose flippening settled or
   * whose bracket slot lost; log the bracket schedule). Optional: a keeper without them simply has no derby coins to serve.
   */
  derby?: { sample(tokens: readonly TokenRow[]): Promise<unknown>; plan(): string[]; /** Why and when a derby token's rule ended (season over, flippening settled, knocked out, voided). */ ended?(t: TokenRow): { reason: string; atMs: number } | null };
  /** The keeper's data key (attester v1); recorded on every reading. */
  attester: string;
  /**
   * Second audit 2026-10-19 I-15: what this host encodes into every launch, for the fence of a coin with no stored expectation
   * (admission.ts fallbackExpectedConfig). The keeper script always passes it (admission.ts expectedHostOf: its signing key, the program
   * client's config authority and platform). Absent (test rigs): those fields are not compared, as before.
   */
  expectedHost?: ExpectedHost;
  /**
   * THE SECOND SIGNER (signer-2, 2026-10-12; attesters/cosign.ts). When set, every reading is first sent to the signer host, which
   * recomputes it and co-signs the exact message only when it agrees. A listed key's signature joins the reading; a disagreement is an
   * alert and no reading; "cannot check" is a wait only when the quorum needs the signer. Unset: the keeper behaves exactly as before.
   */
  cosigner?: Cosigner;
  log: (line: string) => void;
  now: () => number;
  dryRun: boolean;
  /** Re-read this far back each fetch to catch late finalisations (the registry dedupes). */
  overlapMs?: number;
  kalshiPollMs?: number;
  /** After a UTC day ends, wait this long (and for a fetch after it) before reading the day into the program (READING_GRACE_MS). */
  readingGraceMs?: number;
  /** BURNTICKER_KALSHI_ENABLED (venues.ts). false: Kalshi is never read; coins with a Kalshi rule are held with a venue-disabled alert (C1, 2026-10-10). Undefined = on. */
  kalshiEnabled?: boolean;
  /**
   * Send unlink_pair when the program's TERMINAL evidence holds (round 3: a voided pair curve, a refunding side, or a LaunchLab pair's
   * void-by date passed with a coin unverified — pairForwardKeeper.pairUnlinkStep). On by default; false only observes (records an unlink
   * someone else made, alerts when the registry and the chain disagree).
   */
  pairUnlink?: boolean;
  /**
   * THE FOREIGN-READING FENCE (ops/readingFence.ts) runs inside runCycle, after planning and before the first attestation (review 2 F1).
   * On unless explicitly false — false exists only so a test can show the double count the fence prevents.
   */
  fence?: boolean;
  /**
   * BURN DISPERSAL (owner decision 2026-10-13; dispersal.ts / dispersalKeeper.ts): BURNTICKER_DISPERSAL=1. After each coin's cranks, the
   * carried spend is bought in small crank_carried pieces at random times over 6-hour windows until it is zero; a reading not fully
   * spent 24 h after it landed raises bt-burn-behind. Off (undefined/false) until crank_carried is deployed.
   */
  dispersal?: boolean;
}

export interface FetchReport { key: string; written: number; refusals: string[]; awaitingFinal: number; error: string | null; skipped: boolean }
export type ExecOutcome =
  | { mint: string; eventId: string; outcome: "confirmed"; signature: string; burnRaw: bigint; adopted: boolean }
  | { mint: string; eventId: string; outcome: "skipped" | "exhausted" | "waiting" | "error" | "dry-run"; why: string };
export interface CycleReport { /** burn dispersal per coin this cycle (absent when off) */ dispersal?: (DispersalReport & { mint: string })[]; fetched: FetchReport[]; planned: { mint: string; eventId: string; status: string }[]; executed: ExecOutcome[]; errors: string[]; /** claim_lock_fees per coin this cycle (LP locked forever, 2026-10-10); absent on a keeper without the client. */ lpFees?: LockFeesOutcome[]; /** The foreign-reading fence this cycle (absent with `fence: false`); any hold ran the rest of the cycle as a dry run. */ fence?: FenceReport }

const oracleFor = (d: KeeperDeps, key: string): OracleAdapter => {
  if (key.startsWith("catalogue:")) return d.oracles.catalogue;
  if (key.startsWith("polymarket:")) { if (!d.oracles.polymarket) throw new Error("no Polymarket adapter configured on this keeper"); return d.oracles.polymarket; }
  if (key.startsWith("derby:")) { if (!d.oracles.derby) throw new Error("no Burn Derby adapter configured on this keeper"); return d.oracles.derby; }
  return d.oracles.kalshi;
};
const carryFor = (rule: BurnRule): CarryPolicy => (rule.oracle === "catalogue" && rule.series ? feedById(rule.series)?.carry ?? "none" : "none");
/** A selector's read cadence: the feed's pollEverySec, or the market poll (5 min; Kalshi and Polymarket alike). Exported for the ops alerts (a stall = 2× this with no fetch). */
export const pollMsFor = (d: Pick<KeeperDeps, "kalshiPollMs">, rule: BurnRule): number => (rule.oracle === "catalogue" && rule.series ? (feedById(rule.series)?.pollEverySec ?? nativeSourceById(rule.series)?.pollEverySec ?? 3600) * 1000 : d.kalshiPollMs ?? 5 * 60_000);

/**
 * AN EVENT COIN'S CADENCE (owner, 2026-10-14: "do we need to constantly be rechecking?"). A one-market Polymarket coin (oracle polymarket,
 * kind binary, a condition id) was read every 5 minutes from launch, about 288 Polygon payout reads a day for a market that closes months
 * later. It is now read HOURLY until 24 hours before the market's end date, then at the market poll (5 minutes) until the payout is final;
 * with no end date, or one already past, the 5-minute poll stays. Every read still settles at once: a market that resolves early is seen
 * on the next hourly read and its reading is written in that same cycle. The end date comes from Gamma (GammaMarket.endDate, else
 * umaEndDate) once per selector and is cached in the registry's status table (POLY_END_STATUS_PREFIX + the selector key; no schema change).
 */
export const POLY_FAR_POLL_MS = 3_600_000;
export const POLY_NEAR_WINDOW_MS = 24 * 3_600_000;
export const POLY_END_STATUS_PREFIX = "polymarket.endAt.";
export function polymarketPollMs(endAt: number | null, now: number, base = 5 * 60_000): number {
  if (endAt === null || !Number.isFinite(endAt)) return base;
  const nearAt = endAt - POLY_NEAR_WINDOW_MS;
  if (now >= nearAt) return base;
  // hourly, but never past the start of the last day (the first read inside it lands on time)
  return Math.max(base, Math.min(POLY_FAR_POLL_MS, nearAt - now));
}
const isEventCoin = (rule: BurnRule): boolean => rule.oracle === "polymarket" && rule.kind === "binary" && !!rule.market;
/** The cached end date for a selector (undefined: never read; null: Gamma gives none). */
function cachedEndAt(reg: Pick<Registry, "getStatus">, key: string): number | null | undefined {
  const raw = reg.getStatus(POLY_END_STATUS_PREFIX + key);
  if (!raw) return undefined;
  try { const v = JSON.parse(raw) as { endAt?: string | null }; const t = v.endAt ? Date.parse(v.endAt) : NaN; return Number.isFinite(t) ? t : null; } catch { return undefined; }
}
/** The market's end date: the cache, else one Gamma read (a failed or empty read is not cached, so the next poll asks again). */
export async function marketEndAt(d: Pick<KeeperDeps, "registry" | "oracles">, rule: BurnRule, key: string, now: number): Promise<number | null> {
  if (!isEventCoin(rule)) return null;
  const c = cachedEndAt(d.registry, key);
  if (c !== undefined) return c;
  const pm = d.oracles.polymarket as unknown as { marketByCondition?: (id: string) => Promise<{ endDate: string | null; umaEndDate: string | null } | null> } | undefined;
  if (!pm?.marketByCondition) return null;
  let m: { endDate: string | null; umaEndDate: string | null } | null;
  try { m = await pm.marketByCondition(rule.market!); } catch { return null; }
  if (!m) return null;
  const endIso = m.endDate ?? m.umaEndDate ?? null;
  d.registry.setStatus(POLY_END_STATUS_PREFIX + key, { endAt: endIso, readAt: now }, now);
  const t = endIso ? Date.parse(endIso) : NaN;
  return Number.isFinite(t) ? t : null;
}
/** The next read's delay for a selector after a good read (pollMsFor, with an event coin's hourly cadence far from its close). */
export async function nextPollMs(d: Pick<KeeperDeps, "registry" | "oracles" | "kalshiPollMs">, rule: BurnRule, key: string, now: number): Promise<number> {
  const base = pollMsFor(d, rule);
  return isEventCoin(rule) ? polymarketPollMs(await marketEndAt(d, rule, key, now), now, base) : base;
}
/**
 * The moment an idle selector still needs one read (readPlan.ts NEVER): the earliest end of a UTC day, plus READING_GRACE_MS, that holds a
 * result receipt with no program reading yet while the selector's last good read is before that day's end; null when none waits.
 */
export function attestReadAt(d: Pick<KeeperDeps, "registry" | "readingGraceMs">, tokens: readonly TokenRow[], lastOkAt: number | null): number | null {
  let need: number | null = null;
  for (const t of tokens) {
    const pending = (d.registry as Partial<Pick<Registry, "pending">>).pending?.(t.mint) ?? [];
    for (const b of pending) {
      if (b.readingDate !== null || END_KINDS.has(b.kind)) continue;
      const endMs = dayStartMs(receiptDay(b.settledAt)) + DAY_MS;
      if ((lastOkAt ?? 0) >= endMs) continue;
      const at = endMs + (d.readingGraceMs ?? READING_GRACE_MS);
      if (need === null || at < need) need = at;
    }
  }
  return need;
}

/** A catalogue feed's publish window (sources.json readWindow; readPlan.ts), or null. */
export const readWindowFor = (rule: BurnRule): ReadWindow | null => (rule.oracle === "catalogue" && rule.series ? feedById(rule.series)?.readWindow ?? null : null);

/**
 * THE NEXT READ after a good read (readPlan.ts, owner 2026-10-19): the adapter's dueAt when it gives one (the earliest moment a new result
 * can exist, sooner or later than the poll, bounded); else a windowed feed's window; else the poll (an event coin's hourly cadence far
 * from its close included).
 */
export async function nextReadAt(d: Pick<KeeperDeps, "registry" | "oracles" | "kalshiPollMs">, rule: BurnRule, key: string, r: Pick<ResolvedSelector, "dueAt">, now: number, written: number): Promise<number> {
  const due = dueNextAt(r.dueAt, now);
  if (due !== null) return due;
  const w = readWindowFor(rule);
  if (w) return windowNextAt(w, now, written > 0, pollMsFor(d, rule));
  return now + await nextPollMs(d, rule, key, now);
}

/** The cadence the ops alerts expect (no network: the cached end date only), so an hourly event coin is not called stalled. */
export function cadenceMsFor(reg: Pick<Registry, "getStatus">, d: Pick<KeeperDeps, "kalshiPollMs">, rule: BurnRule, key: string, now: number): number {
  const base = pollMsFor(d, rule);
  if (!isEventCoin(rule)) return base;
  const c = cachedEndAt(reg, key);
  return polymarketPollMs(c === undefined ? null : c, now, base);
}

/**
 * A WINDOWED SERIES THAT ENDED (an ESPN team coin's season, postseason or next-N games; sources/espn.ts windowStatus): the source says so
 * in `window`, and every live coin on that selector gets its rule end recorded once (registry.markRuleEnded, mode winddown) — the
 * wind-down starts the day after (detectRuleEnd / the end receipts). A perpetual window never ends; a rule made before the onEnd clause
 * has no wind-down and is left alone. Returns the mints marked.
 */
export function recordWindowEnd(d: Pick<KeeperDeps, "registry" | "dryRun" | "log">, tokens: readonly TokenRow[], r: Pick<ResolvedSelector, "window">): string[] {
  const w = r.window;
  if (!w || w.perpetual || !w.ended || !w.endsAt) return [];
  const at = Date.parse(w.endsAt);
  const out: string[] = [];
  for (const t of tokens) {
    if (t.status !== "live" || d.registry.ruleEnd(t.mint)) continue;
    const rule = d.registry.lockedRule(t).rule;
    if (!rule.onEnd) continue;
    // QA pass 9 #3 (owner decision 2026-10-12): a single game is a one-shot. Its end comes from its own result receipt (detectRuleEnd: a
    // drain when the result fired the rule at 100 %, else the end without a burn), so the window end is recorded here only for a game the
    // schedule lists as cancelled (void). A postponed game keeps the window open, and the coin waits.
    if (rule.oracle === "catalogue" && /^espn\.game:/.test(rule.series ?? "") && !/^void\b/.test(w.reason)) continue;
    let reason = `the coin's window ended: ${w.reason}`;
    // THE RIVALRY SERIES (espn.ts window `meetings`): the season-end reading (+1 to the side that won more meetings, −1 to the other) is
    // planned BEFORE the end is recorded (planToken skips a coin whose rule ended), so the end is dated at that reading and the pair's
    // season-end result exists for the program's pair-winner end sink (end.rs partner_won). A level series has no such reading.
    // Every reading of the series (each meeting too) is planned first, so a level series' end never skips its last meetings.
    if (w.series !== undefined && d.registry.readings(t.selectorKey, t.baselineAt).some((x) => !d.registry.receipt(t.mint, x.id))) { d.log(`  [end] $${t.ticker}: the season series is over; its last results${w.series?.endDay ? `, the season-end result (${w.series.endDay}) included,` : ""} are planned first, then the end is recorded`); continue; }
    // website-18 THE CHAMPION PATH (describe.ts championPathRule): the end waits until the source and the coin's own receipt agree on
    // whether the team won the championship; a champion's coin winds down on itself, any other end forwards the rest to the sink pinned at launch ($DEFICIT unless the coin named another)
    if (championPathRule(rule)) {
      const v = championVerdict(d.registry, t, w, rule);
      if ("hold" in v) { d.log(`  [end] $${t.ticker}: the season is over, but ${v.hold}; the end waits and nothing moves`); continue; }
      reason = v.reason;
    }
    if (!d.dryRun) d.registry.markRuleEnded(t.mint, "winddown", reason, Number.isFinite(at) ? at : Date.now());
    d.log(`  [end] $${t.ticker}: the window ended (${reason})${championPathRule(rule) ? "" : " — the pool winds down from the next day"}`);
    out.push(t.mint);
  }
  return out;
}

/** Readings for the live tokens' keys, each key once per schedule. */
export async function fetchDue(d: KeeperDeps, tokens: readonly TokenRow[]): Promise<FetchReport[]> {
  const now = d.now();
  const byKey = new Map<string, TokenRow>();
  for (const t of tokens) if (!byKey.has(t.selectorKey)) byKey.set(t.selectorKey, t);
  const out: FetchReport[] = [];
  for (const [key, t] of byKey) {
    const st = d.registry.feedState(key);
    // THE READ PLAN (readPlan.ts). NEVER: a selector no live coin needs any more is not read at all (every rule on it ended, or a
    // one-shot's result is in). THE PROGRAM'S READ: the program reads a UTC day only once the selector was read after that day ended
    // (executePending), so a result still waiting for its program reading brings the next read forward to that day's end plus the grace
    // (attestReadAt), for an idle selector too: one read, then nothing. A failing read keeps its backoff.
    const onKey = tokens.filter((x) => x.selectorKey === key);
    const idle = selectorIdle(d.registry, key, onKey);
    const need = attestReadAt(d, onKey, st.lastOkAt);
    if (idle && need === null) {
      // HB-28: an idle selector has no next read, so none is left in feed_state for a page to print (a failing read keeps its backoff)
      // HB-48: unless a coin on it whose rule has not ended holds no settlement receipt (the plan's verdict and the coin's receipts
      // disagree): then the planned time stays in feed_state for the overdue alert (alerts.ts bt-feed-overdue), and the pages still print
      // none (plannedNextCheckAt)
      let disputed = false;
      try { disputed = onKey.some((x) => !d.registry.ruleEnd(x.mint) && !hasSettlementReceipt(d.registry.receipts(x.mint))); } catch { disputed = false; }
      if (!disputed && st.nextFetchAt !== null && st.failures === 0) d.registry.setFeedState({ ...st, nextFetchAt: null });
      out.push({ key, written: 0, refusals: [], awaitingFinal: 0, error: null, skipped: true }); continue;
    }
    const dueAt = st.failures > 0 && st.nextFetchAt !== null ? st.nextFetchAt
      : idle ? need
      : st.nextFetchAt === null ? null : need !== null && need < st.nextFetchAt ? need : st.nextFetchAt;
    if (dueAt !== null && now < dueAt) {
      if (dueAt !== st.nextFetchAt) d.registry.setFeedState({ ...st, nextFetchAt: dueAt });
      out.push({ key, written: 0, refusals: [], awaitingFinal: 0, error: null, skipped: true }); continue;
    }
    const locked = d.registry.lockedRule(t);
    const rule = wideRule(locked.rule);
    const last = d.registry.lastReading(key);
    const since = last ? new Date(Math.max(0, Date.parse(/^\d{4}-\d{2}(-\d{2})?$/.test(last.at) ? `${last.at.length === 7 ? `${last.at}-01` : last.at}T00:00:00Z` : last.at) - (d.overlapMs ?? 7 * 86_400_000))).toISOString() : null;
    // Feeds key readings by period strings ("2026-10-08"); compare in that space. Kalshi keys by ISO times.
    const sinceKey0 = since && key.startsWith("catalogue:") ? (last!.at.length === 7 ? since.slice(0, 7) : since.slice(0, 10)) : since;
    // THE AWAITING ANCHOR (review N7): while the adapter reports events that closed but are not final yet, the read window does not move
    // past where it stood when they were first seen — a market that resolves weeks after a later one settled is still read when it does.
    const anchorKey = `fetch.awaiting-anchor.${key}`;
    const anchorRaw = d.registry.getStatus(anchorKey);
    const anchorObj = anchorRaw ? (JSON.parse(anchorRaw) as { since: string | null } | null) : null;
    const anchor = anchorObj ? anchorObj.since : undefined;
    const sinceKey = anchor === undefined ? sinceKey0 : anchor === null || sinceKey0 === null ? null : anchor < sinceKey0 ? anchor : sinceKey0;
    // KALSHI FAILS CLOSED (owner decision 2026-10-10, after the ChatGPT/Codex review's C1): with BURNTICKER_KALSHI_ENABLED off, Kalshi is
    // not read at all — not even for coins registered with a Kalshi rule. Those coins are HELD (no readings, nothing planned or attested)
    // with a "venue disabled" alert; they resume when the venue is turned back on with written consent.
    if (locked.rule.oracle === "kalshi" && d.kalshiEnabled === false) {
      const msg = "venue disabled: BURNTICKER_KALSHI_ENABLED is off, so Kalshi is not read (the coin is held)";
      const names = tokens.filter((x) => x.selectorKey === key).map((x) => `$${x.ticker}`).join(", ");
      if (d.registry.recordAlert({ kind: "venue-disabled", key: `venue-disabled:${key}`, text: `${names}: ${msg}`, meta: { selectorKey: key } }, now)) d.log(`  [held] ${key} (${names}): ${msg}`);
      d.registry.setFeedState({ selectorKey: key, lastFetchAt: st.lastFetchAt, lastOkAt: st.lastOkAt, failures: st.failures, lastError: msg, nextFetchAt: now + pollMsFor(d, locked.rule) });
      out.push({ key, written: 0, refusals: [], awaitingFinal: 0, error: msg, skipped: false });
      continue;
    }
    try {
      const r = await oracleFor(d, key).settledSince(rule, sinceKey);
      const written = d.registry.putReadings(locked.rule.oracle, key, r.events, { settlementSourceUrl: r.settlementSourceUrl, attestedBy: [d.attester] }, now);
      recordWindowEnd(d, tokens.filter((x) => x.selectorKey === key), r);
      if (r.awaitingFinal > 0 && anchor === undefined) d.registry.setStatus(anchorKey, { since: sinceKey }, now);
      else if (r.awaitingFinal === 0 && anchor !== undefined) d.registry.setStatus(anchorKey, "", now);
      // THE NEXT READ (readPlan.ts, owner 2026-10-19): the earliest moment a new result can exist, as the adapter says (a game's start plus
      // the settle gap, then minutes until its final is confirmed; a market's close; a team's next game), else the feed's publish window,
      // else the poll
      d.registry.setFeedState({ selectorKey: key, lastFetchAt: now, lastOkAt: now, failures: 0, lastError: null, nextFetchAt: await nextReadAt(d, locked.rule, key, r, now, written) });
      if (written || r.refusals.length) d.log(`  [feed] ${key}: ${written} new ${written === 1 ? "reading" : "readings"}${r.awaitingFinal ? `, ${r.awaitingFinal} awaiting finality` : ""}${r.refusals.length ? ` · refused: ${r.refusals.slice(0, 3).join("; ")}` : ""}`);
      out.push({ key, written, refusals: r.refusals, awaitingFinal: r.awaitingFinal, error: null, skipped: false });
    } catch (e) {
      const msg = (e as Error).message.slice(0, 200);
      if (e instanceof RevisedReadingError) {
        const text = `${key}: the source revised ${e.eventId} from ${e.recorded} to ${e.now} after it was recorded. The recorded value stands, nothing is counted twice, and this source is held until the operator acts.`;
        if (d.registry.recordAlert({ kind: "revised-reading", key: `revised-reading:${key}:${e.eventId}:${e.now}`, text, meta: { selectorKey: key, eventId: e.eventId, recorded: e.recorded, revised: e.now } }, now)) d.log(`  [held] ${text}`);
      }
      const failures = st.failures + 1;
      d.registry.setFeedState({ selectorKey: key, lastFetchAt: now, lastOkAt: st.lastOkAt, failures, lastError: msg, nextFetchAt: now + backoffMs(failures - 1) });
      d.log(`  [feed] ${key}: ${msg} — retrying in ${Math.round(backoffMs(failures - 1) / 1000)} s`);
      out.push({ key, written: 0, refusals: [], awaitingFinal: 0, error: msg, skipped: false });
    }
  }
  return out;
}

/**
 * INDEPENDENT vs ORDERED readings (ChatGPT/Codex review N7, 2026-10-10). A binary rule, or a scalar rule against a FIXED baseline with no
 * carry, reads every event on its own: each one is identified by its event id, and any reading after the token's launch baseline that
 * has no receipt is planned — however late it became final, whatever the cursor says. An ORDERED scalar rule (baseline =
 * previousSettlement, or a carry across consecutive increases) measures each value against the last processed one, so a period that
 * turns up behind the cursor is NOT re-applied against the newest value (its change is already inside the next processed delta, and
 * re-applying it would corrupt the carry); it is surfaced as a `late-reading` alert instead, never silently.
 */
export function independentReadings(rule: BurnRule, carry: CarryPolicy): boolean {
  return rule.kind === "binary" || (rule.kind === "scalar" && !!rule.scalar && rule.scalar.baseline !== "previousSettlement" && carry === "none");
}

/** New readings for one token through the engine → receipt rows. Pure apart from the registry writes. */
export function planToken(d: KeeperDeps, t: TokenRow, locked: LockedRule, gate: PairGate | null = null, wtb: { otherTicker: string; afterDate?: number; /** the partner coin (a candidates pair reads its market too) */ other?: TokenRow } | null = null): { mint: string; eventId: string; status: string }[] {
  // prelaunch audit H6 re-review: a stored title filter this build refuses never runs, and "no title matches" must not pass for "nothing to
  // burn": the coin is held (nothing planned) and the owner is alerted, once per coin per pattern
  const filterWhy = storedFilterProblem(locked.rule);
  if (filterWhy) {
    const text = `$${t.ticker}: its title filter ${JSON.stringify(locked.rule.filter.titleRegex)} cannot be checked by this build (${filterWhy}), so nothing is planned or burned for this coin until the operator decides what to do with it.`;
    if (d.registry.recordAlert({ kind: "rule-filter-unsupported", key: `rule-filter-unsupported:${t.mint}:${String(locked.rule.filter.titleRegex)}`, text, meta: { mint: t.mint, pattern: locked.rule.filter.titleRegex } }, d.now())) d.log(`  [held] ${text}`);
    throw new FilterUnsupportedError(text);
  }
  const state = d.registry.state(t.mint);
  const after = state.lastSettledAt ?? t.baselineAt;
  const carry = carryFor(locked.rule);
  const independent = independentReadings(locked.rule, carry);
  const ahead = (r: { at: string; id: string }) => r.at > after || (r.at === after && state.lastEventId !== null && r.id > state.lastEventId);
  // the first snow covers the season it was created in (nws.ts snowSeasonEnd): a later season's first snow is never planned
  const snowEnd = locked.rule.oracle === "catalogue" && isFirstSnowSeries(locked.rule.series) ? snowSeasonEnd(t.baselineAt) : null;
  const unseen = d.registry.readings(t.selectorKey, t.baselineAt).filter((r) => readingMatches(locked.rule, r) && !d.registry.receipt(t.mint, r.id) && (snowEnd === null || r.at.slice(0, 10) <= snowEnd));
  const fresh: SettledEvent[] = independent ? unseen : unseen.filter(ahead);
  if (!independent) for (const r of unseen.filter((x) => !ahead(x))) {
    const text = `$${t.ticker} ${r.id} (${r.at}) arrived behind the settlement cursor (${after}); this rule measures each value against the last processed one, so the change through ${r.id} is already inside the next processed delta and is not applied again`;
    if (d.registry.recordAlert({ kind: "late-reading", key: `late-reading:${t.mint}:${r.id}`, text, meta: { mint: t.mint, eventId: r.id, at: r.at, cursor: after } }, d.now())) d.log(`  [late] ${text}`);
  }
  if (!fresh.length) return [];
  // A SETTLED-EVENT PAIR (rules.ts settledPairShape: two candidates in one race, two teams in one game): both sides read at once (planRace)
  if (wtb?.other && isSettledPairRule(locked.rule)) return planRace(d, t, locked, gate, fresh, wtb.other, wtb.afterDate ?? 0);
  const steps = unitSteps(locked.rule, fresh, carry, { value: state.lastValue, carryOut: state.carryOut });
  const out: { mint: string; eventId: string; status: string }[] = [];
  let prev = { value: state.lastValue, carryOut: state.carryOut };
  for (const { event, step: own } of steps) {
    // WINNER TAKES THE BURN (2026-10-11): in a forwarding pair a result has a winner and a loser. The winner keeps its step; the loser
    // gets the units it would have had had it won (the mirrored mapping = its own fraction) — its fuel for the result forwards to the
    // winner's burn pool by forward_to_winner. Nothing on either side (a draw / a void) stays as it is.
    let step = own, role: PairRole | null = null;
    // r3: a result settled on or before pair_after_date belongs to a period read before the pairing — planned as a plain result
    if (wtb && own.kind !== "void" && event.result !== "void" && receiptDay(event.at) > (wtb.afterDate ?? 0)) {
      if (own.units > 0 && own.mapping) role = "won";
      else {
        const m = unitStep(pairMirrorRule(locked.rule), event, prev, carry);
        if (m.units > 0 && m.mapping) { step = { ...own, units: m.units, mapping: m.mapping, note: `${/[.!?]$/.test(own.note) ? own.note : `${own.note}.`} This coin lost to $${wtb.otherTicker}, so its fuel for this result moves to $${wtb.otherTicker}'s burn pool. That is ${m.units} ${m.units === 1 ? "unit" : "units"} at this coin's own fraction. The winner takes the burn.` }; role = "lost"; }
      }
    }
    const wrote = d.registry.applyStep(t.mint, event, step, prev, locked.rule.kind === "scalar", d.now(), gatedStatus(step, gate), role);
    const row = d.registry.receipt(t.mint, event.id)!;
    if (wrote) { out.push({ mint: t.mint, eventId: event.id, status: row.status }); d.log(`  [plan] $${t.ticker} ${event.id}: ${step.note}${row.status === "planned" ? " → receipt planned" : row.status === "pending-pair" ? " → pending-pair (both or neither: waiting for both pools)" : row.status === "voided" ? " → voided (the pair voided: no event burn)" : ""}`); }
    if (locked.rule.kind === "scalar" && event.value !== null && event.result !== "void") prev = { value: event.value, carryOut: step.carryOut };
    else prev = { value: prev.value, carryOut: step.carryOut };
  }
  return out;
}

/** Registry status key: a candidates pair coin's race verdict, once planned (JSON { kind, why, at }). */
export const raceVerdictKey = (mint: string): string => `race.verdict.${mint}`;
/** The race-held alert fires once a coin's own market has been final this long while the other market is not. */
export const RACE_HELD_ALERT_MS = 72 * 3_600_000;

/**
 * A SETTLED-EVENT PAIR COIN'S RESULT (pairForwardKeeper.ts raceVerdict; owner 2026-10-13): two candidates in one race, or two teams in one
 * game. Nothing is planned until BOTH sides' readings are final; then this coin's receipt for its own reading is dated at the event's day
 * (the later of the two), so both coins read that one day and the keeper writes ONE PairResult for the event:
 *   won    the coin's own result at its own fraction (100 % for these one-shots), pair role "won": its pool burns this coin
 *   lost   the units it would have had had it won (one unit at its own fraction), pair role "lost": its fuel forwards to the winner by
 *          forward_to_winner, and its end (dated the same day) sends what is left to the winner (end.rs partner_won)
 *   none   no units and no role, whatever its own reading said: nothing burns or moves, and the end sends the pool to $DEFICIT's burn
 *          (no PairResult names a winner, so the pair-winner sink falls through to the flagship)
 * A period on or before pair_after_date (read before the pairing) is planned as a plain result, as for every pair.
 */
function planRace(d: KeeperDeps, t: TokenRow, locked: LockedRule, gate: PairGate | null, fresh: readonly SettledEvent[], other: TokenRow, afterDate: number): { mint: string; eventId: string; status: string }[] {
  const reg = d.registry, out: { mint: string; eventId: string; status: string }[] = [];
  const shape = settledPairShape(locked.rule) ?? "candidates", what = shape === "game" ? "game" : "race";
  const mine = fresh.find((r) => sidePayout(r) !== null) ?? null;
  if (!mine) return out;
  let otherRule: BurnRule | null = null;
  try { otherRule = reg.lockedRule(other).rule; } catch { otherRule = null; }
  const theirs = reg.readings(other.selectorKey, other.baselineAt).find((r) => sidePayout(r) !== null && (!otherRule || readingMatches(otherRule, r))) ?? null;
  const v = raceVerdict(sidePayout(mine), sidePayout(theirs), { me: t.ticker, other: other.ticker, shape });
  if (v.kind === "held") {
    d.log(`  [${what}] $${t.ticker}: held — ${v.why}`);
    const since = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(mine.at) ? `${mine.at}T00:00:00Z` : mine.at);
    if (Number.isFinite(since) && d.now() - since >= RACE_HELD_ALERT_MS) {
      const text = `$${t.ticker} / $${other.ticker}: $${t.ticker}'s result has been final since ${mine.at} and $${other.ticker}'s is not; neither coin burns or forwards until both are final`;
      if (reg.recordAlert({ kind: "race-held", key: `race-held:${t.mint}`, text, meta: { mint: t.mint, other: other.mint } }, d.now())) d.log(`  [alert] race-held: ${text}`);
    }
    return out;
  }
  const state = reg.state(t.mint), prev = { value: state.lastValue, carryOut: state.carryOut };
  const event: SettledEvent = { ...mine, at: v.at };
  const own = unitStep(locked.rule, event, prev, "none");
  const paired = receiptDay(v.at) > afterDate;
  const end = (x: string) => (/[.!?]$/.test(x) ? x : `${x}.`);
  let step = own, role: PairRole | null = null;
  if (v.kind === "won" && own.units > 0 && own.mapping) {
    role = paired ? "won" : null;
    // CH6-11: while the pair waits on both pools, the forward is said as conditional, with the pair's void date
    const pending = gate?.state === "waiting", voidBy = gate?.state === "waiting" ? gate.voidBy : null;
    step = { ...own, note: `${end(own.note)} ${cap1(v.why)}. ${paired ? pairForwardNote({ role: "won", what, other: other.ticker, voidBy, pending }) : ""}`.trim() };
  } else if (v.kind === "lost" && paired) {
    // the units it would have had had it won: one unit at its own mapping (both shapes burn one unit on their own result)
    const mapping = ruleMappings(locked.rule)[0]?.mapping ?? null;
    // CH6-11: no counter prefix ("no change: no burn; carry reset.") on a pair-loss note, and the forward is conditional while the pair waits
    const pending = gate?.state === "waiting", voidBy = gate?.state === "waiting" ? gate.voidBy : null;
    if (mapping) { step = { ...own, units: 1, mapping, note: `${cap1(v.why)}. ${pairForwardNote({ role: "lost", what, other: other.ticker, voidBy, pending })}` }; role = "lost"; }
  } else if (v.kind === "none") {
    step = { ...own, units: 0, mapping: null, note: `${end(own.note)} ${cap1(v.why)}: this coin burns nothing for the ${what} and nothing moves between the two coins. At the end its pool goes to $DEFICIT's burn.` };
  }
  const wrote = reg.applyStep(t.mint, event, step, prev, locked.rule.kind === "scalar", d.now(), gatedStatus(step, gate), role);
  if (wrote) {
    if (!d.dryRun) reg.setStatus(raceVerdictKey(t.mint), JSON.stringify({ kind: v.kind, why: v.why, at: v.at, other: other.mint }), d.now());
    const row = reg.receipt(t.mint, event.id)!;
    out.push({ mint: t.mint, eventId: event.id, status: row.status });
    d.log(`  [${what}] $${t.ticker} ${event.id}: ${step.note}${row.status === "planned" ? " → receipt planned" : row.status === "pending-pair" ? " → pending-pair (both or neither: waiting for both pools)" : row.status === "voided" ? " → voided (the pair voided: no event burn)" : ""}`);
  }
  return out;
}
const cap1 = (x: string): string => x.charAt(0).toUpperCase() + x.slice(1);

const DAY_MS = 86_400_000;
const ymd = (ms: number): number => utcDate(Math.floor(ms / 1000));
const dayStartMs = (d: number): number => Date.UTC(Math.floor(d / 10_000), (Math.floor(d / 100) % 100) - 1, d % 100);
const nextDay = (d: number): number => ymd(dayStartMs(d) + DAY_MS);
const prevDay = (d: number): number => ymd(dayStartMs(d) - DAY_MS);

/**
 * What a coin could SEND this cycle (2026-10-15 re-review N1): a receipt with a reading date (a crank, an adoption) or one whose UTC day has
 * closed (an attestation). Receipts settled today wait for the day's close and send nothing, so they cost no fresh read. `dates`: the
 * reading dates and closed days worth re-reading (at most 10, oldest first: the oldest cranks first).
 */
export function sendableWork(pending: readonly Pick<ReceiptRow, "readingDate" | "settledAt">[], now: number): { sendable: boolean; dates: number[] } {
  const today = ymd(now), dates = new Set<number>();
  for (const b of pending) {
    if (b.readingDate !== null) { dates.add(b.readingDate); continue; }
    let day: number; try { day = receiptDay(b.settledAt); } catch { continue; }
    if (day < today) dates.add(day);
  }
  return { sendable: dates.size > 0, dates: [...dates].sort((a, b) => a - b).slice(0, 10) };   // the OLDEST ten: the oldest cranks first
}

/** The UTC day (YYYYMMDD) a settlement belongs to: an ISO time's UTC date, a feed period's date ("2026-10-08"), a month's first day ("2026-08"). */
export function receiptDay(settledAt: string): number {
  if (/^\d{4}-\d{2}$/.test(settledAt)) return Number(settledAt.replace("-", "")) * 100 + 1;
  if (/^\d{4}-\d{2}-\d{2}$/.test(settledAt)) return Number(settledAt.replace(/-/g, ""));
  const ms = Date.parse(settledAt);
  if (Number.isNaN(ms)) throw new Error(`not a settlement time: ${settledAt}`);
  return ymd(ms);
}

/** A Kalshi day is read into the program once it is over (UTC) plus this grace AND the selector was fetched after it ended. */
export const READING_GRACE_MS = 60 * 60_000;

/** Write-ahead resolution for one registry key (an event id, `reading:<date>` or `crank:<date>`). */
async function resolveSent(d: KeeperDeps, port: ProgramPort, mint: string, key: string): Promise<{ landed: { signature: string; slot: number | null; memo: string } } | { waiting: string } | { none: true }> {
  const sent = d.registry.signatures(mint, key).filter((s) => s.status === "sent");
  if (!sent.length) return { none: true };
  const st = await port.signatureStatuses(sent.map((s) => s.signature));
  let height: number | null = null;
  for (let i = 0; i < sent.length; i++) {
    const s = sent[i], x = st[i];
    if (x && x.err === null && x.confirmed) return { landed: { signature: s.signature, slot: x.slot, memo: s.memo } };
    if (x && x.err !== null) { d.registry.setSignatureStatus(s.signature, "failed", x.err, x.slot); continue; }
    height ??= await port.blockHeight();
    if (height <= s.lastValidBlockHeight) return { waiting: `${key} ${s.signature.slice(0, 12)}… may still land (block height ${height} ≤ ${s.lastValidBlockHeight})` };
    // AUDIT A review (3): a null status past the blockhash's life is "never landed" only on an RPC that keeps the history. A fallback or
    // a provider gap answers null for a reading that DID land; marking it expired would re-date its receipts to D+1 and count them again
    // (the F1 double burn by another door). The chain's Reading account decides first.
    if (key.startsWith("reading:")) {
      const D = Number(key.slice("reading:".length).replace(/-/g, ""));
      let rd: ProgramReadingView | null;
      try { rd = await port.reading(D); } catch (e) { return { waiting: `${key} ${s.signature.slice(0, 12)}…: its status is unknown and the reading account could not be read (${(e as Error).message.slice(0, 80)})` }; }
      if (rd) {
        let mine: string | null = null;
        try { mine = (JSON.parse(s.memo) as { value?: string }).value ?? null; } catch { mine = null; }
        // the Reading on chain carries this row's exact counter value: the receipts it named are counted (whoever's transaction carried it)
        if (mine !== null && rd.value.toString() === mine) return { landed: { signature: s.signature, slot: null, memo: s.memo } };
        const text = `The reading for ${key.slice(8)} is on chain but does not carry the value this keeper sent (${rd.value} vs ${mine ?? "unknown"}), and the status of ${s.signature} cannot be read. Held until a human reconciles it.`;
        if (d.registry.recordAlert({ kind: "reading-unresolved", key: `reading-unresolved:${mint}:${key}`, text, meta: { mint, key, signature: s.signature } }, d.now())) d.log(`  [alert] reading-unresolved: ${text}`);
        return { waiting: text };
      }
    }
    d.registry.setSignatureStatus(s.signature, "expired", null, null);
  }
  return { none: true };
}

/**
 * Pending receipts of one token through the burn_receipts program (see program.ts for the counter): (1) attest every closed day's
 * units as a counter reading — baseline first, in order, write-ahead; (2) best-effort creator-fee claims and check_pool_health
 * (buyback); (3) adopt readings someone else already cranked; (4) crank in order, recording what the program did from its Reading
 * account. Waits (TWAP, no pool, day not over, quorum short) are outcomes, never errors.
 */
export async function executePending(d: KeeperDeps, t: TokenRow, locked: LockedRule, pairCtx: PairCtx | null = null, opts: { attestOnly?: boolean } = {}): Promise<ExecOutcome[]> {
  const reg = d.registry, mint = t.mint;
  const out: ExecOutcome[] = [];
  const pending = reg.pending(mint);
  if (!pending.length) return out;
  const hold = (why: string, rows: readonly ReceiptRow[] = pending, outcome: "waiting" | "error" = "waiting"): ExecOutcome[] => { for (const b of rows) out.push({ mint, eventId: b.eventId, outcome, why }); return out; };
  const notExpressible = programExpressible(locked.rule, t.ticker);
  if (notExpressible) { d.log(`  [program] $${t.ticker}: held — ${notExpressible}`); return hold(`not expressible on the program: ${notExpressible}`); }
  let port: ProgramPort;
  try { port = d.program.port(mint); } catch (e) { return hold(`no program port: ${(e as Error).message.slice(0, 120)}`); }
  let cfg = await port.config();
  if (!cfg) { d.log(`  [program] $${t.ticker}: no TokenConfig on chain — initialize_token has not run for ${mint}`); return hold("no TokenConfig on chain (initialize_token not run)"); }
  const want = counterRule(locked.rule, t.ticker, t.selectorKey, { floorLamports: BigInt(0) });
  const mismatch = cfg.rulesSha256 !== t.rulesSha ? `the on-chain rules sha256 ${cfg.rulesSha256.slice(0, 12)}… ≠ the registry's ${t.rulesSha.slice(0, 12)}…`
    : cfg.feedId !== want.feedId || cfg.valueDecimals !== 0 || cfg.unitValue !== BigInt(1) ? `the TokenConfig is not this token's unit counter (feed ${cfg.feedId})`
    : cfg.mode !== locked.mode ? `the TokenConfig is in ${cfg.mode} mode, the rule is ${locked.mode}` : null;
  if (mismatch) { d.log(`  [program] $${t.ticker}: REFUSED — ${mismatch}`); return hold(mismatch, pending, "error"); }
  // audit F01: the parameters the program runs are the ones initialize_token stored, whatever the sha says — compared with what the host
  // encoded at prepare (or what the locked rule alone fixes, for a draft prepared before that was stored). Nothing is signed for a coin
  // whose config differs; the owner hears once a day.
  const exp = expectedConfigFor(reg, t, d.expectedHost);
  const off = exp ? viewMismatch(cfg, exp) : null;
  if (off) {
    d.log(`  [program] $${t.ticker}: REFUSED — ${off}`);
    const text = `$${t.ticker}: the coin's TokenConfig on chain differs from the one this site built for it (${off}). Nothing is attested or cranked for it.`;
    try { if (reg.recordAlert({ kind: "config-mismatch", key: `config-mismatch:${mint}`, text, meta: { mint } }, d.now())) d.log(`  [alert] config-mismatch: ${text}`); } catch { /* the alert never changes the hold */ }
    return hold(off, pending, "error");
  }

  // 1. ATTEST the closed days.
  const r = await submitCounterReadings(d, t, port, cfg, out);
  cfg = r.cfg;
  // AUDIT A F1: a reading whose outcome is unknown holds the coin's whole pass (fail closed): nothing is attested or cranked on a guess.
  if (r.held || opts.attestOnly) return out;

  // 2. FEED THE POOL + POOL HEALTH (buyback; best-effort; only when something is waiting for a crank).
  const counted = reg.pending(mint).filter((b) => b.readingDate !== null);
  if (!d.dryRun && cfg.mode === "buyback" && counted.length) {
    try { const c = await port.claimCreatorFees(); for (const s of c.sent) d.log(`  [fees] $${t.ticker}: creator fees moved into the fee PDA: ${s}`); for (const n of c.notes) d.log(`  [fees] $${t.ticker}: ${n}`); }
    catch (e) { d.log(`  [fees] $${t.ticker}: claim failed (best-effort, the crank goes on): ${(e as Error).message.slice(0, 160)}`); }
    if (cfg.poolRegistered) {
      try { const h = await port.checkPoolHealth(); d.log(`  [pool] $${t.ticker}: ${h.note}`); } catch (e) { d.log(`  [pool] $${t.ticker}: check_pool_health failed: ${(e as Error).message.slice(0, 160)}`); }
      cfg = (await port.config()) ?? cfg;
    }
  }

  // 3. ADOPT readings already processed on chain (cranking is permissionless; a lost confirmation). Review RL-1: a reading processed by
  // forward_to_winner (outcome "forwarded") — another cranker's forward, one that won the 72 h race, or the keeper's own whose confirmation
  // was lost — is adopted from its write-ahead `forward:<date>` signature or the chain. Audit 7 F05: the chain search recognises every
  // processing instruction (burnReceipts/processing.ts PROCESSING_INSTRUCTIONS: the cranks, crank_target_burn and forward_to_winner),
  // bound to this program, this reading's date and its Reading account; a found transaction whose kind contradicts the Reading's outcome
  // (a forward for a burned reading, or a crank for a forwarded one), or a burn whose memo for this date is missing, is held, not adopted.
  for (const D of [...new Set(counted.map((b) => b.readingDate!))]) {
    const rd = await port.reading(D);
    if (!rd?.processed) continue;
    const fwd = rd.outcome === "forwarded";
    const res = await resolveSent(d, port, mint, `${fwd ? "forward" : "crank"}:${formatDate(D)}`);
    const found = "landed" in res ? null : await port.findCrankTx(D);
    const tx = "landed" in res ? { signature: res.landed.signature, slot: res.landed.slot, memo: await port.memoOf(res.landed.signature, D) } : found;
    if (!tx) { hold(`processed on chain; its ${fwd ? "forward" : "crank"} transaction is not found yet`, reg.receiptsForReading(mint, D)); continue; }
    if (found && found.forwards !== undefined && found.forwards !== fwd) { hold(`processed on chain as ${rd.outcome}, but the transaction found (${found.signature.slice(0, 12)}…, ${found.instruction ?? "unknown"}) is not a ${fwd ? "forward" : "crank"}`, reg.receiptsForReading(mint, D)); continue; }
    if (found && found.memo === null && (rd.outcome === "burned" || rd.outcome === "short")) { hold(`processed on chain; the transaction found (${found.signature.slice(0, 12)}…) carries no program memo for ${formatDate(D)}`, reg.receiptsForReading(mint, D)); continue; }
    recordCrank(d, t, cfg, D, rd, tx, true, out);
    if (fwd && pairCtx) await adoptForward(d, pairCtx, D, rd, tx);
  }

  // 4. CRANK in order. I-14: a coin that burns a target cranks only while its BurnTarget is the one built at prepare.
  if (cfg.burnsTarget) { const off = await burnTargetHold(d, t); if (off) return hold(off, pending, "error"); }
  for (let i = 0; i < 30; i++) {
    const plan = await port.planCrank();
    if ("status" in plan) {
      if (plan.status === "waiting-for-pool") {
        const why = WAIT_REASONS["waiting-for-pool"];
        if (!d.dryRun) reg.setReadingWait(mint, plan.recordDate, why, d.now() + WAIT_RETRY_MS, d.now());
        hold(why, reg.receiptsForReading(mint, plan.recordDate));
      }
      break;
    }
    const D = plan.recordDate, Ds = formatDate(D), now = d.now();
    const rows = reg.receiptsForReading(mint, D).filter((b) => b.status === "planned" || b.status === "sending");
    const key = `crank:${Ds}`;
    const res = await resolveSent(d, port, mint, key);
    if ("landed" in res) {
      const rd = await port.reading(D);
      if (!rd?.processed) { hold(`crank ${res.landed.signature.slice(0, 12)}… landed; the reading is not processed yet`, rows); break; }
      recordCrank(d, t, cfg, D, rd, { signature: res.landed.signature, slot: res.landed.slot, memo: await port.memoOf(res.landed.signature, D) }, true, out);
      continue;
    }
    if ("waiting" in res) { hold(res.waiting, rows); break; }
    const lead = rows[0];
    if (lead && !d.dryRun && lead.nextAttemptAt && now < lead.nextAttemptAt) { hold(lead.waitReason ? `${lead.waitReason} (next try ${new Date(lead.nextAttemptAt).toISOString()})` : `backing off until ${new Date(lead.nextAttemptAt).toISOString()}`, rows); break; }
    // WINNER TAKES THE BURN: a pair period needs its PairResult before either crank; the LOSER's reading is forwarded, never burned on the
    // losing coin. The chain planner (burnReceipts/crank.ts planCrank) plans the forward for a LOST period until PAIR_RESULT_GRACE_SECS
    // after the reading (chain time), then the paired buyback (the program accepts it and emits PairForwardMissing) — the keeper follows
    // the planner and does not repeat that time-out. A period dated before the pairing day has no PairResult (PairDateBeforePairing).
    // r3: a period on or before pair_after_date was read before the pairing — no PairResult (PairPeriodUnpaired); it cranks as plain.
    if (pairCtx?.active && (plan.kind === "buyback" || plan.kind === "target" || plan.kind === "forward") && (pairCtx.pairedOn == null || D >= pairCtx.pairedOn) && D > (pairCtx.pairAfterDate ?? 0)) {
      const pr = await ensurePairResult(pairCtx, reg, D, { now, dryRun: d.dryRun, log: d.log, winnerReading: () => winnerFlatReading(d, pairCtx, D), ...(d.cosigner ? { cosigner: d.cosigner } : {}) });
      if ("waiting" in pr) {
        if (plan.kind === "forward") { hold(`pair result for ${Ds}: ${pr.waiting}`, rows); break; }
        // no result: the paired buyback's simulation decides — PairResultPending (a wait) until 72 h after the reading, then unpaired
        d.log(`  [pair] $${t.ticker} ${Ds}: no pair result — ${pr.waiting}`);
      } else if (pr.result.winner === pairCtx.other.mint) {
        // this coin LOST D. A result posted just now came after this plan: re-plan (the planner now plans the forward). An existing LOST
        // result with a buyback plan means the planner opened the program's time-out: crank unpaired (recordCrank alerts pair-forward-missing).
        if ((plan.kind === "buyback" || plan.kind === "target") && pr.fresh) continue;
        if (plan.kind === "forward") {
          const fr = await forwardLoss(pairCtx, reg, port, D, { now, dryRun: d.dryRun, log: d.log });
          if ("waiting" in fr) {
            if (fr.error) { reg.noteReadingError(mint, D, fr.waiting, now + backoffMs(lead?.attempts ?? 0), now); hold(fr.waiting, rows, "error"); }
            else hold(fr.waiting, rows);
            break;
          }
          const rd0 = await port.reading(D);
          if (!rd0?.processed) { hold(`forward ${fr.signature.slice(0, 12)}… confirmed; the reading is not processed yet`, rows); break; }
          const rd = fr.facts ? { ...rd0, outcome: "forwarded", poolLamports: fr.facts.poolLamports, poolActualLamports: fr.facts.poolLamports, spentLamports: fr.facts.lamports, ruleSpendLamports: fr.facts.lamports, carriedInLamports: BigInt(0), carriedOutLamports: BigInt(0), got: BigInt(0), burned: BigInt(0) } : rd0;
          recordCrank(d, t, cfg, D, rd, { signature: fr.signature, slot: fr.slot, memo: fr.memo }, false, out);
          if (fr.facts) recordForward(reg, pairCtx, D, fr.facts, fr.signature, fr.slot, now, d.log);
          continue;
        }
      }
    }
    if (d.dryRun) { d.log(`  [dry-run] $${t.ticker} ${Ds}: would crank_${plan.kind} (the program computes the amounts)`); for (const b of rows) out.push({ mint, eventId: b.eventId, outcome: "dry-run", why: `crank_${plan.kind} ${Ds}` }); break; }
    const fail = (why: string) => { reg.noteReadingError(mint, D, why, now + backoffMs(lead?.attempts ?? 0), now); d.log(`  [crank] $${t.ticker} ${Ds}: ${why} — retrying later`); hold(why, rows, "error"); };
    try {
      const tx = await plan.build();
      const sim = await port.simulate(tx.raw);
      if (sim.err) {
        const wait = WAIT_REASONS[sim.err] ?? (port.retryableErrors?.has(sim.err) ? "waiting — the program reported a retryable condition" : undefined);
        if (wait) { reg.setReadingWait(mint, D, `${sim.err}: ${wait}`, now + WAIT_RETRY_MS, now); d.log(`  [crank] $${t.ticker} ${Ds}: deferred by the program (${sim.err}) — ${wait}`); hold(`${sim.err}: ${wait}`, rows); }
        else fail(`crank_${plan.kind} simulation refused: ${sim.err}${sim.logs.length ? ` · ${sim.logs.slice(-2).join(" · ")}` : ""}`);
        break;
      }
      reg.recordSignature({ signature: tx.signature, mint, eventId: key, memo: `crank_${plan.kind} ${Ds}`, burnRaw: BigInt(0), spendLamports: BigInt(0), blockhash: tx.blockhash, lastValidBlockHeight: tx.lastValidBlockHeight, sentAt: now });
      reg.markReadingSending(mint, D, now);
      try { await port.send(tx.raw); } catch (e) { d.log(`  [crank] $${t.ticker} ${Ds}: send raised ${(e as Error).message.slice(0, 120)} — the signature is on the ledger and will be resolved`); }
      const c = await port.confirm(tx);
      if (c.status === "failed") { reg.setSignatureStatus(tx.signature, "failed", c.err, null); fail(`crank_${plan.kind} failed on chain: ${c.err}`); break; }
      if (c.status === "expired") { hold(`crank ${tx.signature.slice(0, 12)}… not confirmed yet`, rows); break; }
      const rd = await port.reading(D);
      if (!rd?.processed) { hold("crank confirmed; the reading is not processed yet", rows); break; }
      recordCrank(d, t, cfg, D, rd, { signature: tx.signature, slot: c.slot, memo: await port.memoOf(tx.signature, D) }, false, out);
    } catch (e) {
      // re-review N4: a spent RPC budget is a wait (no backoff, no error row), not a failure of this reading
      if (isBudgetHold(e)) { const m = (e as Error).message.slice(0, 160); d.log(`  [crank] $${t.ticker} ${Ds}: waiting — ${m}`); hold(`waiting: ${m}`, rows); break; }
      fail(`RPC/program error: ${(e as Error).message.slice(0, 200)}`); break;
    }
  }
  return out;
}

/**
 * Review RL-1: a forward the keeper did not itself just confirm, adopted from the chain — the append-only pair_forwards row (the program's
 * facts from the transaction when readable, else the reading and the memo) and the receipt line. Idempotent (keyed by signature).
 */
async function adoptForward(d: KeeperDeps, ctx: PairCtx, D: number, rd: ProgramReadingView, tx: { signature: string; slot: number | null; memo: string | null }): Promise<void> {
  if (d.registry.pairForwards(ctx.pair.pairId).some((f) => f.signature === tx.signature)) return;
  let facts: ForwardFacts | null = null;
  try { const f = await ctx.port.forwardFacts(tx.signature); facts = f && f !== "none" ? f : null; } catch { facts = null; }
  if (!facts) {
    const m = tx.memo ? parseForwardMemo(tx.memo) : null;
    const lamports = m ? m.lamports : rd.spentLamports;
    facts = { loserMint: ctx.me.mint, winnerMint: ctx.other.mint, recordDate: D, units: rd.units, poolLamports: rd.poolLamports, lamports, solLamports: lamports, wsolLamports: BigInt(0) };
  }
  d.log(`  [pair] $${ctx.me.ticker} ${formatDate(D)}: a forward already on chain (${tx.signature.slice(0, 12)}…) — adopted`);
  recordForward(d.registry, ctx, D, facts, tx.signature, tx.slot, d.now(), d.log);
}

/**
 * signer-2: ask the second signer (when one is configured) to co-sign this reading's exact message. Returns the co-signatures to carry
 * (only a key the TokenConfig lists), a HOLD when the signer disagrees (an alert is raised; no reading is sent), or a note on why there
 * is no usable signature (the caller waits only when the quorum needs one).
 */
export async function cosignReading(d: Pick<KeeperDeps, "cosigner" | "registry" | "log" | "now">, t: Pick<TokenRow, "mint" | "ticker">, port: ProgramPort, cfg: ProgramConfigView, input: ReadingInput, eventIds: readonly string[]): Promise<{ cosignatures: Cosignature[]; hold: string | null; note: string | null }> {
  const r = await askCosigner(d.cosigner, port, cfg, input, { ticker: t.ticker, eventIds }, d.log);
  if (r.disagree) {
    const Ds = formatDate(input.recordDate);
    const text = `$${t.ticker} ${Ds}: the second signer did not agree with the keeper's reading, so no reading was sent. ${r.disagree}`;
    if (d.registry.recordAlert({ kind: "cosigner-disagree", key: `cosigner-disagree:${t.mint}:${Ds}`, text, meta: { mint: t.mint, recordDate: Ds } }, d.now())) d.log(`  [alert] cosigner-disagree: ${text}`);
    return { cosignatures: [], hold: "Held. The second signer worked out a different reading for this day, so no reading is sent until the two agree.", note: null };
  }
  return { cosignatures: r.cosignatures, hold: null, note: r.note };
}

/** The receipts a reading's write-ahead row named (its memo's `events`), or [] when the memo is not one of ours. */
export function readingEventsOf(memo: string): string[] {
  try { const e = (JSON.parse(memo) as { events?: unknown }).events; return Array.isArray(e) ? e.filter((x): x is string => typeof x === "string") : []; } catch { return []; }
}
const readingKeyDate = (key: string): number => Number(key.slice("reading:".length).replace(/-/g, ""));

/**
 * AUDIT A F1 (2026-10-15): settle what earlier submit_readings did BEFORE a reading date is chosen. The date is max(oldest unassigned
 * receipt's day, the day after the chain's last reading); a reading that LANDED but whose confirmation was lost has already moved the
 * chain's date, so choosing first and resolving the chosen date's key afterwards looked up the wrong key and counted the same receipts
 * into the next day (two burns for one result). In order:
 *   1. repair: a CONFIRMED reading whose named receipts are still unassigned (a crash between the two journal writes the old path made)
 *      gets them now — the chain counted them;
 *   2. resolve every `sent` reading row of the mint, oldest date first: landed → signature and receipts confirmed together
 *      (Registry.confirmReading); failed / expired → nothing was counted; may still land, or the status cannot be read → HOLD.
 * Returns "held" with a waiting outcome per pending receipt while any outcome is unknown.
 */
async function settleOutstandingReadings(d: KeeperDeps, t: TokenRow, port: ProgramPort, out: ExecOutcome[]): Promise<"held" | "settled"> {
  const reg = d.registry, mint = t.mint, now = d.now();
  const unassigned = new Set(reg.pending(mint).filter((b) => b.readingDate === null).map((b) => b.eventId));
  for (const s of unassigned.size ? reg.readingSignatures(mint, "confirmed") : []) {
    const loose = readingEventsOf(s.memo).filter((id) => unassigned.has(id));
    if (!loose.length) continue;
    for (const id of loose) unassigned.delete(id);
    reg.confirmReading(mint, s.signature, s.slot, loose, readingKeyDate(s.eventId), now);
    d.log(`  [attest] $${t.ticker} ${s.eventId.slice(8)}: repaired — the confirmed reading ${s.signature.slice(0, 12)}… named ${loose.length} ${loose.length === 1 ? "receipt" : "receipts"} the registry had not counted into it (${loose.join(", ")})`);
  }
  const keys = [...new Set(reg.readingSignatures(mint, "sent").map((s) => s.eventId))];
  for (const key of keys) {
    const holdAll = (why: string): "held" => { for (const b of reg.pending(mint)) out.push({ mint, eventId: b.eventId, outcome: "waiting", why }); d.log(`  [attest] $${t.ticker} ${key.slice(8)}: HOLD — ${why}`); return "held"; };
    let res: Awaited<ReturnType<typeof resolveSent>>;
    try { res = await resolveSent(d, port, mint, key); }
    catch (e) { if (isBudgetHold(e)) throw e; return holdAll(`the outcome of an earlier reading transaction is unknown (${(e as Error).message.slice(0, 120)}), so nothing new is attested or cranked until it is resolved`); }
    if ("waiting" in res) return holdAll(res.waiting);
    if ("landed" in res) {
      const named = readingEventsOf(res.landed.memo);
      reg.confirmReading(mint, res.landed.signature, res.landed.slot, named, readingKeyDate(key), now);
      d.log(`  [attest] $${t.ticker} ${key.slice(8)}: an earlier submit_reading landed (${res.landed.signature.slice(0, 12)}…) — ${named.length} ${named.length === 1 ? "receipt" : "receipts"} counted into it`);
    }
  }
  return "settled";
}

/** Attests every closed day's units (baseline first). Returns the refreshed config, and held when an earlier reading's outcome is unknown. */
async function submitCounterReadings(d: KeeperDeps, t: TokenRow, port: ProgramPort, cfg0: ProgramConfigView, out: ExecOutcome[]): Promise<{ cfg: ProgramConfigView; held?: boolean }> {
  const reg = d.registry, mint = t.mint;
  let cfg = cfg0;
  const now = d.now(), today = ymd(now);
  // AUDIT A F1: every outstanding reading is resolved BEFORE a date is allocated (the chain's date may already include it).
  if (reg.readingSignatures(mint, "sent").length || reg.readingSignatures(mint, "confirmed").length) {
    const before = reg.readingSignatures(mint, "confirmed").length;
    if ((await settleOutstandingReadings(d, t, port, out)) === "held") return { cfg, held: true };
    if (reg.readingSignatures(mint, "confirmed").length !== before) cfg = (await port.config()) ?? cfg;
  }
  const isFeed = t.selectorKey.startsWith("catalogue:");
  let heldUnknown = false;
  const submit = async (D: number, value: bigint, counted: readonly ReceiptRow[], report: readonly ReceiptRow[] = counted): Promise<boolean> => {
    const Ds = formatDate(D), key = `reading:${Ds}`, ids = counted.map((b) => b.eventId);
    const rows = report;
    const wait = (why: string) => { for (const b of rows) out.push({ mint, eventId: b.eventId, outcome: "waiting", why }); d.log(`  [attest] $${t.ticker} ${Ds}: ${why}`); return false; };
    const res = await resolveSent(d, port, mint, key);
    if ("waiting" in res) return wait(res.waiting);
    if ("landed" in res) {
      // An earlier submit landed: count exactly the receipts IT named (its write-ahead row), not today's selection — signature and
      // assignment in one transaction (AUDIT A F1).
      const named = readingEventsOf(res.landed.memo);
      reg.confirmReading(mint, res.landed.signature, res.landed.slot, named, D, now);
      d.log(`  [attest] $${t.ticker} ${Ds}: an earlier submit_reading landed (${res.landed.signature.slice(0, 12)}…) — ${named.length} ${named.length === 1 ? "receipt" : "receipts"} counted into it`);
      cfg = (await port.config()) ?? cfg;
      return true;
    }
    const mine = port.attesterKeys().filter((k) => cfg.attesters.some((a) => a.key === k));
    // With a second signer configured its listed key may make up the quorum (it is asked below, never in a dry run).
    if (mine.length + (d.cosigner ? 1 : 0) < cfg.quorum) return wait(`Waiting for signatures. The program needs ${cfg.quorum} signer ${cfg.quorum === 1 ? "signature" : "signatures"}, and this keeper holds ${mine.length}.`);
    if (d.dryRun) { d.log(`  [dry-run] $${t.ticker} ${Ds}: would attest the unit counter ${value} (${ids.length} ${ids.length === 1 ? "receipt" : "receipts"}: ${ids.join(", ") || "baseline"})`); for (const b of rows) out.push({ mint, eventId: b.eventId, outcome: "dry-run", why: `reading ${Ds} = ${value}` }); return false; }
    // Burn Derby: the counted readings' proof hash (the Pyth update digests behind the window) goes into the signed message's proof=.
    // End-of-rule clock days: proof = sha256("clock|<date>|<rules sha256>") — date-based and deterministic, anyone recomputes it.
    const derbyProof = t.selectorKey.startsWith("derby:") ? derbyProofHash(ids.map((id) => reg.readings(t.selectorKey).find((r) => r.id === id)?.proof ?? null)) : undefined;
    const clockProof = counted.some((b) => END_KINDS.has(b.kind)) ? Buffer.from(clockProofHex(Ds, t.rulesSha), "hex") : undefined;
    const proofHash = derbyProof && clockProof ? Buffer.from(rulesSha256(`${Buffer.from(derbyProof).toString("hex")},${clockProof.toString("hex")}`), "hex") : derbyProof ?? clockProof;
    const input: ReadingInput = { recordDate: D, prevDate: cfg.hasBaseline ? cfg.lastRecordDate : 0, value, sourceUrl: counterSourceUrl(t.ticker, Ds, ids), feedId: cfg.feedId, valueDecimals: 0, ...(proofHash ? { proofHash } : {}) };
    const co = await cosignReading(d, t, port, cfg, input, ids);
    if (co.hold) return wait(co.hold);
    if (mine.length + co.cosignatures.length < cfg.quorum) return wait(`Waiting for signatures. The program needs ${cfg.quorum} signer ${cfg.quorum === 1 ? "signature" : "signatures"}, and this keeper holds ${mine.length}.${co.note ? ` ${co.note}` : ""}`);
    const tx = await port.buildReading({ ...input, ...(co.cosignatures.length ? { cosignatures: co.cosignatures } : {}) });
    const sim = await port.simulate(tx.raw);
    if (sim.err) {
      if (sim.err === "QuorumNotMet") return wait("Waiting for signatures. The program did not count enough signer signatures.");
      const why = `submit_reading refused: ${sim.err}`;
      for (const b of counted) reg.noteError(mint, b.eventId, why, now + backoffMs(b.attempts), now);
      d.log(`  [attest] $${t.ticker} ${Ds}: ${why}`);
      for (const b of rows) out.push({ mint, eventId: b.eventId, outcome: "error", why });
      return false;
    }
    reg.recordSignature({ signature: tx.signature, mint, eventId: key, memo: JSON.stringify({ message: tx.message, events: ids, value: value.toString() }), burnRaw: BigInt(0), spendLamports: BigInt(0), blockhash: tx.blockhash, lastValidBlockHeight: tx.lastValidBlockHeight, sentAt: now });
    try { await port.send(tx.raw); } catch (e) { d.log(`  [attest] $${t.ticker} ${Ds}: send raised ${(e as Error).message.slice(0, 120)} — the signature is on the ledger and will be resolved`); }
    // AUDIT A F1: a confirmation that cannot be read is an UNKNOWN outcome, not an error: the write-ahead row stays `sent` and the next
    // pass resolves it (settleOutstandingReadings) before it chooses any date.
    let c: Awaited<ReturnType<ProgramPort["confirm"]>>;
    try { c = await port.confirm(tx); }
    catch (e) { if (isBudgetHold(e)) throw e; heldUnknown = true; return wait(`The reading transaction ${tx.signature.slice(0, 12)}… was sent and its confirmation could not be read (${(e as Error).message.slice(0, 100)}); it is resolved before anything else is attested.`); }
    if (c.status === "failed") { reg.setSignatureStatus(tx.signature, "failed", c.err, null); for (const b of rows) out.push({ mint, eventId: b.eventId, outcome: "error", why: `submit_reading failed: ${c.err}` }); return false; }
    if (c.status === "expired") { heldUnknown = true; return wait(`The reading transaction ${tx.signature.slice(0, 12)}… is not confirmed yet.`); }
    reg.confirmReading(mint, tx.signature, c.slot, ids, D, now);
    d.log(`  [attest] $${t.ticker} ${Ds}: unit counter ${value} attested (${ids.length ? `${ids.length} ${ids.length === 1 ? "receipt" : "receipts"}: ${ids.join(", ")}` : "baseline"}) — ${tx.signature}`);
    cfg = (await port.config()) ?? cfg;
    return true;
  };
  if (!cfg.hasBaseline) {
    if (!(await submit(prevDay(receiptDay(t.baselineAt)), COUNTER_BASE, [], reg.pending(mint)))) return { cfg, held: heldUnknown };
  }
  let unassigned = reg.pending(mint).filter((b) => b.readingDate === null);
  while (unassigned.length) {
    const D = Math.max(receiptDay(unassigned[0].settledAt), nextDay(cfg.lastRecordDate));
    const endMs = dayStartMs(D) + DAY_MS;
    // End-of-rule receipts (wind-down, drain, sweep) read no selector: a date-based clock — like a feed, the day only has to be over.
    const clockOnly = unassigned.filter((b) => receiptDay(b.settledAt) <= D).every((b) => END_KINDS.has(b.kind));
    if (D > today || (!isFeed && !clockOnly && (now < endMs + (d.readingGraceMs ?? READING_GRACE_MS) || (reg.feedState(t.selectorKey).lastOkAt ?? 0) < endMs))) {
      const why = `the program reads ${formatDate(D)} once that UTC day is over${isFeed ? "" : " and the selector has been read after it"} (settlements may still arrive)`;
      for (const b of unassigned) out.push({ mint, eventId: b.eventId, outcome: "waiting", why });
      break;
    }
    const group = unassigned.filter((b) => receiptDay(b.settledAt) <= D);
    const units = group.reduce((a, b) => a + BigInt(b.units), BigInt(0));
    if (!(await submit(D, cfg.lastValue + units, group))) break;
    unassigned = reg.pending(mint).filter((b) => b.readingDate === null);
  }
  return { cfg, held: heldUnknown };
}

/** Writes what the program did for reading D onto its receipts (lead: the amounts; the others: zeros) and reports one outcome per receipt. */
function recordCrank(d: KeeperDeps, t: TokenRow, cfg: ProgramConfigView, D: number, rd: ProgramReadingView, tx: { signature: string; slot: number | null; memo: string | null }, adopted: boolean, out: ExecOutcome[]): void {
  const reg = d.registry, mint = t.mint;
  const rows = reg.receiptsForReading(mint, D).filter((b) => b.status === "planned" || b.status === "sending");
  const units = rows.reduce((a, b) => a + b.units, 0);
  if (rows.length && units !== rd.units) d.log(`  [program] $${t.ticker} ${formatDate(D)}: the program counted ${rd.units} ${rd.units === 1 ? "unit" : "units"}, the receipts carry ${units} — the chain is the record`);
  const skippedReason = rd.outcome === "below-floor" ? `the program's spend was under its floor (${cfg.floorLamports} lamports) — nothing bought, the pool keeps the SOL` : rd.outcome === "no-units" ? "the program counted no units" : null;
  forwardMissingAlert(reg, t, D, rd.outcome, d.now(), d.log);
  // Round 5: a coin with a burn target burned ANOTHER token — the Reading's got/burned are the target's units (the memo v3 names it) and
  // `owed` holds the coin's own fee tokens burned. The receipt's burnRaw stays in the coin's units; the target burn rides in the memo.
  const target = cfg.burnsTarget ? parseTargetMemo(tx.memo ?? "") : null;
  const coinBurn = cfg.burnsTarget ? rd.owed : rd.burned;
  reg.markProgramOutcome(mint, D, { signature: tx.signature, slot: tx.slot, outcome: rd.outcome, memo: tx.memo, poolLamports: rd.poolLamports, poolActualLamports: rd.poolActualLamports, spentLamports: rd.spentLamports, ruleSpendLamports: rd.ruleSpendLamports, carriedInLamports: rd.carriedInLamports, carriedOutLamports: rd.carriedOutLamports, gotRaw: cfg.burnsTarget ? BigInt(0) : rd.got, burnRaw: coinBurn > BigInt(0) ? coinBurn : BigInt(0), shortfallRaw: rd.shortfall, skippedReason }, d.now());
  const burnedText = cfg.burnsTarget ? `${target ? `${target.burn} of the target ${target.target}` : `${rd.burned} raw units of the target`} (and ${rawToTokens(rd.owed, DECIMALS)} of the coin's own)` : rawToTokens(rd.burned, DECIMALS);
  const partial = [rd.spentLamports > BigInt(0) && rd.carriedOutLamports > BigInt(0) ? `SpendCapBound: ${rd.carriedOutLamports} lamports carried into the next crank` : null, rd.poolActualLamports > rd.poolLamports ? `BurnPoolCapBound: the rule applied to ${rawToTokens(rd.poolLamports, 9)} of ${rawToTokens(rd.poolActualLamports, 9)} SOL` : null].filter(Boolean).join("; ");
  d.log(`  [crank] $${t.ticker} ${formatDate(D)}: ${adopted ? "already processed on chain — adopted" : "CRANKED"} · ${rd.outcome} · ${rd.units} ${rd.units === 1 ? "unit" : "units"} for ${rows.length} ${rows.length === 1 ? "receipt" : "receipts"} · spent ${rd.spentLamports} lamports, burned ${burnedText}${partial ? ` · PARTIAL — ${partial}` : ""} · ${tx.signature}`);
  rows.forEach((b, k) => {
    if (rd.outcome === "exhausted") out.push({ mint, eventId: b.eventId, outcome: "exhausted", why: "allocation used up" });
    else if (rd.outcome === "burned" || rd.outcome === "short") out.push({ mint, eventId: b.eventId, outcome: "confirmed", signature: tx.signature, burnRaw: k === 0 ? coinBurn : BigInt(0), adopted });
    else out.push({ mint, eventId: b.eventId, outcome: "skipped", why: skippedReason ?? rd.outcome });
  });
}

/**
 * BOTH OR NEITHER (2026-10-10): the state of every clause pair, per mint. A pair goes LIVE the first cycle both sides' TokenConfigs name a
 * registered pool before its voidBy date ends — its pending-pair receipts become planned (they execute in settlement order); it VOIDS if
 * either side is still unregistered when voidBy ends — its pending-pair receipts become voided and the rule ends (both coins wind down).
 * Both outcomes are written once (registry pair_outcomes). A dry run computes the state and writes nothing.
 */
export async function pairGates(d: KeeperDeps): Promise<Map<string, { gate: PairGate; pairId: string; side: "A" | "B" }>> {
  const out = new Map<string, { gate: PairGate; pairId: string; side: "A" | "B" }>();
  const now = d.now();
  for (const pr of d.registry.pairs()) {
    const ta = d.registry.token(pr.mintA), tb = d.registry.token(pr.mintB);
    if (!ta || !tb) continue;
    let clause;
    try { clause = pairClause(d.registry.lockedRule(ta).rule); } catch { continue; }
    if (!clause) continue;
    let gate: PairGate;
    const have = d.registry.pairOutcome(pr.pairId);
    if (have) gate = have.state === "live" ? { state: "live" } : { state: "voided", atMs: have.at };
    else {
      const registered = async (mint: string) => { try { return (await d.program.port(mint).config())?.poolRegistered === true; } catch { return false; } };
      const [ra, rb] = [await registered(pr.mintA), await registered(pr.mintB)];
      const voidAt = voidByEndMs(clause.voidBy);
      if (ra && rb && now < voidAt) {
        gate = { state: "live" };
        if (!d.dryRun) {
          d.registry.recordPairOutcome(pr.pairId, "live", now, "both pools registered");
          const n = d.registry.promotePendingPair(pr.mintA, now) + d.registry.promotePendingPair(pr.mintB, now);
          d.log(`  [pair] ${pr.pairId}: LIVE — both pools registered${n ? `; ${n} pending-pair ${n === 1 ? "receipt" : "receipts"} now planned, in settlement order` : ""}`);
        }
      } else if (now >= voidAt) {
        gate = { state: "voided", atMs: voidAt };
        if (!d.dryRun) {
          const why = `pair voided: ${[!ra ? `$${ta.ticker}` : null, !rb ? `$${tb.ticker}` : null].filter(Boolean).join(" and ")} had no registered pool when ${clause.voidBy} ended (UTC)`;
          d.registry.recordPairOutcome(pr.pairId, "voided", voidAt, why);
          const n = d.registry.voidPendingPair(pr.mintA, why, now) + d.registry.voidPendingPair(pr.mintB, why, now);
          d.log(`  [pair] ${pr.pairId}: VOIDED — ${why}${n ? `; ${n} pending-pair ${n === 1 ? "receipt" : "receipts"} voided` : ""}; the rule has ended: both coins wind down (onEnd)`);
        }
      } else gate = { state: "waiting", waitingOn: [...(ra ? [] : ["A" as const]), ...(rb ? [] : ["B" as const])], voidBy: clause.voidBy };
    }
    out.set(pr.mintA, { gate, pairId: pr.pairId, side: "A" });
    out.set(pr.mintB, { gate, pairId: pr.pairId, side: "B" });
  }
  return out;
}

export const END_KINDS: ReadonlySet<string> = new Set(["winddown", "drain", "sweep"]);
/** The proof a clock day's attestation commits to (date-based, deterministic): sha256("clock|<YYYY-MM-DD>|<rules sha256>"). */
export const clockProofHex = (date: string, rulesSha: string): string => rulesSha256(`clock|${date}|${rulesSha}`);
const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const addDay = (date: string, n: number): string => isoDay(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS);

/** The latest crank the program processed for a token (its lead receipt): what it carried out, and whether it fell under the floor. */
function lastCrank(d: KeeperDeps, mint: string): { carriedOut: bigint; skipped: boolean } | null {
  const leads = d.registry.receipts(mint).filter((b) => b.lead === true && b.readingDate !== null).sort((a, b) => (b.readingDate ?? 0) - (a.readingDate ?? 0));
  const l = leads[0];
  return l ? { carriedOut: l.carriedOutLamports ?? BigInt(0), skipped: l.status === "skipped" } : null;
}

/**
 * WHY AND WHEN A RULE ENDED (no burn pool is ever left behind; rules.ts onEnd): a pair voided, a one-shot settled (YES / NO / void), a
 * derby finished (the adapter's hook), or an adapter's explicit mark (registry.markRuleEnded: a team's season over, a nominee replaced).
 * A one-shot YES at 100 % ends in a DRAIN; everything else in a WIND-DOWN. Written once.
 */
export function detectRuleEnd(d: KeeperDeps, t: TokenRow, locked: LockedRule, gate: PairGate | null): { mode: "drain" | "winddown"; reason: string; at: number } | null {
  const have = d.registry.ruleEnd(t.mint);
  if (have) return have;
  // A clause pair that is still waiting for its second pool has not ended: its pending-pair receipts resolve first (live or void).
  if (gate?.state === "waiting" || d.registry.receipts(t.mint).some((b) => b.status === "pending-pair")) return null;
  let end: { mode: "drain" | "winddown"; reason: string; at: number } | null = null;
  if (gate?.state === "voided") end = { mode: "winddown", reason: "the pair voided (both or neither)", at: gate.atMs };
  else if (isOneShot(locked.rule)) {
    const ev = d.registry.receipts(t.mint).filter((b) => !END_KINDS.has(b.kind) && b.status !== "pending-pair")[0];
    if (ev) {
      const all = ev.units > 0 && ev.status !== "voided" && (ev.mapping?.fractionOfPool ?? 0) >= 1;
      // two candidates in one race with no single winner: the end is a result (the pair-winner sink sends the rest to $DEFICIT's burn),
      // even when this coin's own market split its payout — the race, not the market, decides (planRace)
      const race = isSettledPairRule(locked.rule) && !all ? (() => { try { return JSON.parse(d.registry.getStatus(raceVerdictKey(t.mint)) ?? "null") as { kind: string; why: string } | null; } catch { return null; } })() : null;
      end = race?.kind === "none" ? { mode: "winddown", reason: `the ${/in the game/.test(race.why) ? "game" : "race"} ended with ${race.why.replace(/^no single winner in the (race|game)/, "no single winner")}: the rest goes to $DEFICIT's burn`, at: Date.parse(ev.settledAt) || d.now() }
        : { mode: all ? "drain" : "winddown", reason: all ? `the one-shot settled ${(ev.result ?? "YES").toUpperCase()} at 100 % of the pool` : `the one-shot settled ${(ev.result ?? ev.kind).toUpperCase()}`, at: Date.parse(ev.settledAt) || d.now() };
    } else if (d.derby?.ended && t.selectorKey.startsWith("derby:")) {
      // owner decision 2026-10-12 (item 70): a flippening whose last window stayed unreadable after its retries ends VOID, no receipt
      const x = d.derby.ended(t);
      if (x) end = { mode: "winddown", reason: x.reason, at: x.atMs };
    }
  } else if (locked.rule.oracle === "catalogue" && isFirstSnowSeries(locked.rule.series)) {
    // THE FIRST SNOW RESOLVES ONCE (owner intent 2026-10-12; a keeper correction to match the promised rule, not an economics change):
    // the coin ends after its first qualifying snow of the season it was created in, or VOID once that season's June 30 has passed with
    // none. Daily readings of 0 are not the result; only a day that burned (units > 0) is.
    const seasonEnd = snowSeasonEnd(t.baselineAt);
    const ev = d.registry.receipts(t.mint).find((b) => !END_KINDS.has(b.kind) && b.status !== "pending-pair" && b.units > 0);
    if (ev) end = { mode: "winddown", reason: `the first snow of the season fell (${ev.eventId})`, at: Date.parse(ev.settledAt) || d.now() };
    else if (d.now() >= snowSeasonVoidFromMs(seasonEnd)) end = { mode: "winddown", reason: `void: the snow season ended on ${seasonEnd} with no first snow after launch`, at: Date.parse(`${seasonEnd}T23:59:59Z`) };
  } else if (d.derby?.ended && t.selectorKey.startsWith("derby:")) {
    const x = d.derby.ended(t);
    if (x) end = { mode: "winddown", reason: x.reason, at: x.atMs };
  }
  if (!end) return null;
  if (end.mode === "winddown" && !locked.rule.onEnd) return null;   // a rule made before the clause has no wind-down
  if (d.dryRun) return end;
  const rec = d.registry.markRuleEnded(t.mint, end.mode, end.reason, end.at);
  d.log(`  [end] $${t.ticker}: the rule ENDED — ${rec.reason}; ${rec.mode === "drain" ? "the pool drains (one unit a day at 100 %)" : endSinkOf(locked.rule) && d.program.endSink ? "a coin with an end sink records the end; a result forwards what is left to the sink, a void winds down" : `the pool winds down over ${locked.rule.onEnd!.windDownDays} days`}`);
  return rec;
}

/**
 * REVIEW 10 F1 (2026-10-14): A ONE-SHOT UNDER 100 % FINISHES ITS SHARE ON THE COIN BEFORE THE END SINK TAKES THE REST. The result's
 * reading asks for f of the pool; one crank spends at most 2 % of the CPMM pool's SOL reserve and carries the rest
 * (carried_spend_lamports). On the round-4 program, recording a RESOLVED end (submit_rule_end) closed the coin to further spending
 * (crank_carried refused with RuleNotLive) and forward_on_end moved the whole spendable pool and cleared the carried amount. The round-5
 * program (deployed on mainnet 2026-10-15) lifted that (R5-3 / R5-4): crank_carried runs after any end, and for 30 days after a RESOLVED
 * end the end paths leave the carry on the coin. The keeper still waits while the result's own spend is carried (the simplest order:
 * the share is finished before the end is recorded, on either program):
 *   · the owed amount is the chain's carried amount after the result's crank (a one-shot has no other reading that carries);
 *   · with burn dispersal on and a program that has crank_carried (round 5), the dispersal step later in the same cycle spends it in
 *     pieces; once the chain shows nothing carried, the end is recorded and only what is left over moves to the sink;
 *   · on a program without crank_carried (round 4), nothing can spend the carried amount without a new reading, and a new reading on a
 *     one-shot would spend another f of the pool (crank_buyback refuses a reading with 0 units). The end then waits, an alert says so
 *     once a day, and nothing is forwarded. The launch preflight refuses a share under 100 % on such a host (launchPreflight.ts
 *     "one-shot-share-needs-dispersal"), so only a coin made some other way can reach this.
 * Not held: 100 % (the drain path spends the whole pool on the coin first), a VOID end (the wind-down stays on the coin), a pair loser
 * (its fuel forwards to the winner), a result below the floor (the program carries nothing: the share is dropped and stays in the pool,
 * as for every reading), a coin without an EndSink (the hashed wind-down spends the carried amount with its own units), and an end
 * already on chain (third prelaunch audit F01: nothing is held then — the round-5 end paths leave the carry on the coin for 30 days and
 * the dispersal step keeps draining it after the end, runDispersal no longer stops at an ended rule; a retired coin with an end stays
 * in the cycle for that).
 */
export async function owedBeforeEnd(d: KeeperDeps, t: TokenRow, locked: LockedRule, gate: PairGate | null, end: { mode: "drain" | "winddown"; reason: string; at: number }): Promise<{ owedLamports: bigint; canSpend: boolean; readingDate: number | null } | null> {
  const rule = locked.rule;
  if (end.mode !== "winddown" || t.status === "retired" || locked.mode !== "buyback" || !isOneShot(rule) || !endSinkOf(rule) || !d.program.endSink) return null;
  const ev = d.registry.receipts(t.mint).filter((b) => !END_KINDS.has(b.kind) && b.status !== "pending-pair")[0];
  const f = ev?.mapping?.fractionOfPool ?? 0;
  if (!ev || !(ev.units > 0) || ev.status === "voided" || !(f > 0 && f < 1) || ev.pairRole === "lost") return null;
  const sinkPort = d.program.endSink.port(t.mint);
  if (!(await sinkPort.endSink())) return null;
  if (await sinkPort.ruleEnd()) return null;
  if (endOutcomeOf(d.registry, t, locked, gate, end) !== "resolved") return null;
  const port = d.program.port(t.mint);
  const cfg = await port.config();
  if (!cfg || cfg.carriedSpendLamports <= BigInt(0)) return null;
  return { owedLamports: cfg.carriedSpendLamports, canSpend: !!d.dispersal && typeof port.planCarried === "function" && !cfg.burnsTarget, readingDate: ev.readingDate ?? null };
}
/** The hold's log line, its status record (`rule.endowed.<mint>`) and, when nothing on this program can spend it, the daily alert. */
function holdEndForOwed(d: KeeperDeps, t: TokenRow, o: { owedLamports: bigint; canSpend: boolean; readingDate: number | null }): void {
  const sol = rawToTokens(o.owedLamports, 9);
  const line = o.canSpend
    ? `$${t.ticker}: the result's share is not fully spent yet (${sol} SOL still owed on this coin). It is being spent in pieces, and the end is recorded and the rest moves to the end sink after that.`
    : `$${t.ticker}: the result's share is not fully spent yet (${sol} SOL still owed on this coin). It can only be spent in pieces by burn dispersal, which is not running for this coin, so the end waits and nothing moves to the end sink.`;
  d.log(`  [end] ${line}`);
  if (d.dryRun) return;
  d.registry.setStatus(`rule.endowed.${t.mint}`, JSON.stringify({ owedLamports: o.owedLamports.toString(), dispersal: o.canSpend, readingDate: o.readingDate, at: d.now() }), d.now());
  if (!o.canSpend) d.registry.recordAlert({ kind: "bt-burn-behind", key: `${t.mint}:end-owed`, text: line, meta: { mint: t.mint, owedLamports: o.owedLamports.toString(), readingDate: o.readingDate, reason: "end-owed-no-dispersal" } }, d.now());
}

/**
 * The end-of-rule receipts due by now, and the retirement once they are done:
 *   drain     one "drain-<date>" unit a day from the day after the YES (each unit's rule spend is the whole pool) while the program's last
 *             crank carried spend forward and nothing is pending; done when a crank carries nothing more or falls under the floor.
 *   winddown  "winddown-<date>" for each of the `windDownDays` days from the first day after the end, windDownUnits(f, days) units each;
 *             then (cap-bound tail) one more day at a time while the last crank still carried spend; done when it carries nothing.
 *   sweep     a RETIRED coin whose fee PDA (minus the reserve) passed onEnd.sweepThresholdLamports: "sweep-<date>" of full-spend units,
 *             continued day by day while the cap carries spend; at most one sweep START per SWEEP_EVERY_DAYS.
 * Buyback mode only (a vault rule has no pool to spend). Every amount is the program's, on the receipts.
 */
export async function planRuleEnd(d: KeeperDeps, t: TokenRow, locked: LockedRule, gate: PairGate | null, pairCtx: PairCtx | null = null): Promise<{ mint: string; eventId: string; status: string }[]> {
  const reg = d.registry, rule = locked.rule, out: { mint: string; eventId: string; status: string }[] = [];
  if (locked.mode !== "buyback") return out;
  const end = detectRuleEnd(d, t, locked, gate);
  if (!end) return out;
  // END SINKS (LAUNCHPAD-PATH §45, endSinkKeeper.ts): a coin with an EndSink records its end on chain; a RESOLVED end forwards what is
  // left to the sink (no wind-down) and the later trickle follows it; a VOID end falls through to the wind-down below. A one-shot YES at
  // 100 % ("burns everything") drains on its own coin first (the drain below), and only then records the end and forwards the trickle.
  let selfBurn: boolean;
  if (end.mode !== "drain" || t.status === "retired") {
    // REVIEW 10 F1: a one-shot under 100 % finishes its own share on the coin before the end is recorded and the rest is forwarded.
    const owed = await owedBeforeEnd(d, t, locked, gate, end);
    if (owed) { holdEndForOwed(d, t, owed); return out; }
    const es = await endSinkStep({ ...d, cosignReading: (port, cfg, input) => cosignReading(d, t, port, cfg, input, []) }, t, locked, gate, end);
    if (es.note) d.log(`  [end] ${es.note}`);
    if (es.handled) return out;
    selfBurn = es.selfBurn;
  } else {
    // still draining: the sweep waits for the next cycle's end-sink step on an end-sink coin
    selfBurn = !(d.program.endSink && endSinkOf(rule) !== null && (await d.program.endSink.port(t.mint).endSink()) !== null);
  }
  if (d.dryRun) return out;
  const f = ruleMappings(rule)[0]?.mapping.fractionOfPool ?? 0;
  if (!(f > 0)) return out;
  const today = isoDay(d.now());
  // WINNER TAKES THE BURN: a one-shot pair LOSER's end-of-rule days (wind-down, drain, sweep) forward to the winner while the winner is
  // live — the same units at its own fraction, so the forward moves exactly what the wind-down would have burned. A retired winner, a
  // draw or a void: the loser winds down on its own coin, as before.
  const loserOf = (): boolean => !!pairCtx?.active && isOneShot(rule) && pairCtx.other.status === "live"
    && reg.receipts(t.mint).some((b) => !END_KINDS.has(b.kind) && b.pairRole === "lost");
  const add = (kind: EndReceiptKind, date: string, units: number): void => {
    const id = `${kind}-${date}`;
    const base = endStep(rule, kind, units);
    const role = loserOf() && base.units > 0 && base.mapping ? "lost" as const : null;
    const step = role ? { ...base, note: `${/[.!?]$/.test(base.note) ? base.note : `${base.note}.`} This forwards to $${pairCtx!.other.ticker}'s burn pool. The winner takes the burn.` } : base;
    if (reg.addEndReceipt(t.mint, kind, { id, at: `${date}T00:00:00Z` }, step, d.now(), role)) { out.push({ mint: t.mint, eventId: id, status: "planned" }); d.log(`  [plan] $${t.ticker} ${id}: ${step.note} → receipt planned`); }
  };
  const mine = (kind: EndReceiptKind) => reg.receipts(t.mint).filter((b) => b.kind === kind).map((b) => b.eventId.slice(kind.length + 1)).sort();
  const quiet = () => reg.pending(t.mint).length === 0;
  const lc = () => lastCrank(d, t.mint);
  const carrying = () => { const c = lc(); return !!c && !c.skipped && c.carriedOut > BigInt(0); };
  let done = false;
  if (end.mode === "drain") {
    const days = mine("drain");
    const next = days.length ? addDay(days[days.length - 1], 1) : firstWindDownDay(end.at + 1);
    if (quiet()) {
      const c = lc();
      const more = days.length === 0 ? !!c && !c.skipped && c.carriedOut > BigInt(0) : carrying();
      if (more && next <= today && days.length < 365) add("drain", next, 1);
      else if (!more) done = true;
    }
  } else {
    const N = rule.onEnd!.windDownDays, n = windDownUnits(f, N), first = firstWindDownDay(end.at);
    for (let i = 0; i < N; i++) { const day = addDay(first, i); if (day > today) break; add("winddown", day, n); }
    const days = mine("winddown");
    if (days.length >= N && quiet()) {
      if (carrying() && days.length < N + 365) { const next = addDay(days[days.length - 1], 1); if (next <= today) add("winddown", next, n); }
      else if (!carrying()) done = true;
    }
  }
  if (done && t.status !== "retired") {
    reg.setTokenStatus(t.mint, "retired");
    reg.setStatus(`rule.retired.${t.mint}`, JSON.stringify({ reason: end.reason, at: d.now(), mode: end.mode }));
    d.log(`  [end] $${t.ticker} RETIRED — ${end.mode === "drain" ? "the pool is drained" : "the wind-down is done"} (${end.reason})`);
  }
  // The retired-coin sweep (an end-sink coin's trickle follows its sink instead: endSinkStep, from the next cycle).
  if ((done || t.status === "retired") && rule.onEnd && quiet() && selfBurn) {
    const sweeps = mine("sweep");
    const startKey = `sweep.start.${t.mint}`, lastStart = reg.getStatus(startKey);
    const continuing = sweeps.length > 0 && lastStart !== null && carrying();
    if (continuing) { const next = addDay(sweeps[sweeps.length - 1], 1); if (next <= today) add("sweep", next, fullSpendUnits(f)); }
    else if (!lastStart || Date.parse(`${today}T00:00:00Z`) - Date.parse(`${lastStart}T00:00:00Z`) >= SWEEP_EVERY_DAYS * DAY_MS) {
      const bal = await d.program.feePdaBalanceLamports(t.mint).catch(() => BigInt(0));
      const spendable = bal - solToLamports(rule.reserveSol);
      if (spendable > BigInt(rule.onEnd.sweepThresholdLamports) && !sweeps.includes(today)) {
        add("sweep", today, fullSpendUnits(f));
        reg.setStatus(startKey, today);
        reg.setStatus(`rule.swept.${t.mint}`, today);
      }
    }
  }
  return out;
}

/**
 * WINNER TAKES THE BURN: the WINNER's reading for day D, which a win's submit_pair_result needs (both coins' readings). On an event day
 * both coins read the period, so it exists. On a one-shot loser's wind-down / drain / sweep day the winner may have nothing that day: the
 * keeper attests a FLAT reading for it (the unit counter unchanged — 0 units, processed at once; the clock proof for D). "exists" /
 * "submitted"; "cannot" when the winner has already read past D (no win can be recorded: alert; the loser's period times out after 72 h —
 * never a substitute draw); waiting while the winner still has receipts up to D to attest, or the day is not over.
 */
export async function winnerFlatReading(d: KeeperDeps, ctx: PairCtx, D: number): Promise<"exists" | "submitted" | "cannot" | { waiting: string }> {
  const w = ctx.other, Ds = formatDate(D), now = d.now();
  let port: ProgramPort;
  try { port = d.program.port(w.mint); } catch (e) { return { waiting: `no program port for $${w.ticker}: ${(e as Error).message.slice(0, 80)}` }; }
  if (await port.reading(D)) return "exists";
  if (d.registry.pending(w.mint).some((b) => b.readingDate === null && receiptDay(b.settledAt) <= D)) return { waiting: `$${w.ticker} has receipts up to ${Ds} still to attest` };
  const cfg = await port.config();
  if (!cfg || !cfg.hasBaseline) return "cannot";
  if (cfg.lastRecordDate >= D) return "cannot";
  if (now < dayStartMs(D) + DAY_MS) return { waiting: `the flat reading for $${w.ticker} waits until ${Ds} is over (UTC)` };
  if (d.dryRun) { d.log(`  [dry-run] $${w.ticker} ${Ds}: would attest a flat reading (unit counter ${cfg.lastValue}, 0 units) for the forward`); return { waiting: "dry run" }; }
  const key = `reading:${Ds}`;
  const res = await resolveSent(d, port, w.mint, key);
  if ("waiting" in res) return { waiting: res.waiting };
  if ("landed" in res) { d.registry.setSignatureStatus(res.landed.signature, "confirmed", null, res.landed.slot); return "submitted"; }
  const mine = port.attesterKeys().filter((k) => cfg.attesters.some((a) => a.key === k));
  if (mine.length + (d.cosigner ? 1 : 0) < cfg.quorum) return { waiting: `quorum short for $${w.ticker}'s flat reading` };
  const input: ReadingInput = { recordDate: D, prevDate: cfg.lastRecordDate, value: cfg.lastValue, sourceUrl: counterSourceUrl(w.ticker, Ds, []), feedId: cfg.feedId, valueDecimals: 0, proofHash: Buffer.from(clockProofHex(Ds, w.rulesSha), "hex") };
  const co = await cosignReading(d, w, port, cfg, input, []);
  if (co.hold) return { waiting: co.hold };
  if (mine.length + co.cosignatures.length < cfg.quorum) return { waiting: `quorum short for $${w.ticker}'s flat reading${co.note ? `. ${co.note}` : ""}` };
  const tx = await port.buildReading({ ...input, ...(co.cosignatures.length ? { cosignatures: co.cosignatures } : {}) });
  const sim = await port.simulate(tx.raw);
  if (sim.err) return { waiting: `$${w.ticker}'s flat reading refused: ${sim.err}` };
  d.registry.recordSignature({ signature: tx.signature, mint: w.mint, eventId: key, memo: JSON.stringify({ message: tx.message, events: [], value: cfg.lastValue.toString(), flat: `winner reading for $${ctx.me.ticker}'s forward` }), burnRaw: BigInt(0), spendLamports: BigInt(0), blockhash: tx.blockhash, lastValidBlockHeight: tx.lastValidBlockHeight, sentAt: now });
  try { await port.send(tx.raw); } catch (e) { d.log(`  [pair] $${w.ticker} ${Ds}: flat reading send raised ${(e as Error).message.slice(0, 120)}`); }
  const c = await port.confirm(tx);
  if (c.status === "failed") { d.registry.setSignatureStatus(tx.signature, "failed", c.err, null); return { waiting: `$${w.ticker}'s flat reading failed: ${c.err}` }; }
  if (c.status === "expired") return { waiting: `$${w.ticker}'s flat reading ${tx.signature.slice(0, 12)}… not confirmed yet` };
  d.registry.setSignatureStatus(tx.signature, "confirmed", null, c.slot);
  d.log(`  [pair] $${w.ticker} ${Ds}: flat reading attested (unit counter ${cfg.lastValue}, 0 units) so $${ctx.me.ticker}'s fuel can forward — ${tx.signature}`);
  return "submitted";
}

/** One full cycle over every live token (and, for the fallback clock, every retired coin of a voided pair). */
export async function runCycle(d0: KeeperDeps, opts: { fetch?: boolean } = {}): Promise<CycleReport> {
  // `d` is this cycle's copy: a fence hold turns it into a dry run for everything after it (the caller's deps are not changed).
  const d: KeeperDeps = { ...d0 };
  // the budget's phase per step (apiBudget.ts): the keeper's daily top line names which step spent the credits
  const phase = (p: string) => { budgetPhase(`cycle/${p}`); };
  const live = d.registry.tokens("live");
  const errors: string[] = [];
  if (d.derby) { try { await d.derby.sample(live); } catch (e) { errors.push(`derby sampler: ${(e as Error).message.slice(0, 160)}`); } }
  phase("fetch");
  const fetched = opts.fetch === false ? [] : await fetchDue(d, live);
  phase("pair-gates");
  const gates = await pairGates(d).catch((e: Error) => { errors.push(`pair gates: ${e.message.slice(0, 160)}`); return new Map<string, { gate: PairGate; pairId: string; side: "A" | "B" }>(); });
  // Retired coins stay in the loop when their rule ended under onEnd: the wind-down's last cranks and the retired-coin sweep.
  const tokens = [...live, ...d.registry.tokens("retired").filter((t) => gates.get(t.mint)?.gate.state === "voided" || d.registry.ruleEnd(t.mint) !== null)];
  const planned: CycleReport["planned"] = [], executed: ExecOutcome[] = [], lpFees: LockFeesOutcome[] = [];
  const dispersal: (DispersalReport & { mint: string })[] = [];
  // WINNER TAKES THE BURN (2026-10-11): each pair coin's pair context (its counterpart, the pair port, whether forwards apply).
  const ctxs = new Map<string, PairCtx | null>();
  phase("pair-ctx");
  for (const t of tokens) { try { ctxs.set(t.mint, await pairCtxFor(d.registry, d.program, t, d.now())); } catch (e) { ctxs.set(t.mint, null); errors.push(`$${t.ticker}: pair context: ${(e as Error).message.slice(0, 160)}`); } }
  // Pass 1 — PLAN every token (both coins of a pair get their roles for a result before either executes).
  const ready: { t: TokenRow; locked: LockedRule; gate: PairGate | null }[] = [];
  phase("plan");
  for (const t of tokens) {
    let locked: LockedRule;
    try { locked = d.registry.lockedRule(t); } catch (e) { errors.push(`$${t.ticker}: rule unreadable: ${(e as Error).message}`); continue; }
    if (selectorKeyOf(locked.rule) !== t.selectorKey) { errors.push(`$${t.ticker}: selector key drifted (${t.selectorKey} ≠ ${selectorKeyOf(locked.rule)})`); continue; }
    const gate = gates.get(t.mint)?.gate ?? null;
    if (locked.rule.oracle === "kalshi" && d.kalshiEnabled === false) continue;   // venue disabled: held (fetchDue raised the alert)
    const ctx = ctxs.get(t.mint) ?? null;
    if (ctx?.hold) { d.log(`  [pair] $${t.ticker}: held this cycle — ${ctx.hold}`); continue; }
    try { if (t.status === "live" && !d.registry.ruleEnd(t.mint)) planned.push(...planToken(d, t, locked, gate, ctx?.active ? { otherTicker: ctx.other.ticker, afterDate: ctx.pairAfterDate ?? 0, other: ctx.other } : null)); } catch (e) { errors.push(`$${t.ticker}: plan: ${(e as Error).message.slice(0, 160)}`); continue; }
    // An active pair coin's end-of-rule days are planned BEFORE anything executes too, so a one-shot loser's forwarding day is on its
    // receipts (and attested) when the winner settles the same day's pair result.
    if (ctx?.active) { try { planned.push(...await planRuleEnd(d, t, locked, gate, ctx)); } catch (e) { errors.push(`$${t.ticker}: end of rule: ${(e as Error).message.slice(0, 160)}`); } }
    ready.push({ t, locked, gate });
  }
  // THE FENCE (review 2 F1): after planning, before the first attestation — every receipt this registry is about to count is checked
  // against readings another keeper may already have landed (adopted when the units match; any doubt HOLDS every send this cycle).
  const fenceOn = d.fence !== false;
  const fence: FenceReport = { held: [], adopted: [], checked: 0 };
  const fresh = async (t: TokenRow): Promise<void> => {
    if (!d.freshReads || d.dryRun) return;
    const w = sendableWork(d.registry.pending(t.mint), d.now());
    if (!w.sendable) return;
    try { await d.freshReads(t, w.dates); } catch { /* a fresh read never stops a cycle; the steps read through to the RPC */ }
  };
  const fenceStep = async (t: TokenRow): Promise<void> => {
    if (!fenceOn) return;
    await fresh(t);
    const before = fence.held.length;
    try { await fenceToken(d, t, fence); }
    catch (e) { fence.held.push({ mint: t.mint, ticker: t.ticker, why: `fence check failed: ${(e as Error).message.slice(0, 120)}` }); d.log(`  [fence] $${t.ticker}: check failed — sends held this cycle`); }
    if (fence.held.length > before && !d.dryRun) { d.dryRun = true; d.log(`  [fence] sends HELD for the rest of this cycle (read, plan and publish go on)`); }
  };
  phase("fence");
  for (const { t } of ready) await fenceStep(t);
  // Pass 2 — EXECUTE, the coins with a lost period first: the forward lands before the winner's crank (the winner never waits for it).
  const losing = (m: string) => d.registry.pending(m).some((b) => b.pairRole === "lost");
  ready.sort((x, y) => Number(losing(y.t.mint)) - Number(losing(x.t.mint)));
  // …and before that, every ACTIVE pair coin attests its closed days, so the winner's reading for a period exists when the loser forwards
  // (forward_to_winner takes it). Single coins and inactive pairs skip this: their cycle is unchanged.
  for (const { t, locked } of ready) {
    if (!ctxs.get(t.mint)?.active) continue;
    phase("attest");
    await fresh(t);
    try { executed.push(...await executePending(d, t, locked, ctxs.get(t.mint) ?? null, { attestOnly: true })); } catch (e) { if (!isBudgetHold(e)) errors.push(`$${t.ticker}: attest: ${(e as Error).message.slice(0, 160)}`); }
  }
  for (const { t, locked, gate } of ready) {
    const ctx = ctxs.get(t.mint) ?? null;
    // LP LOCKED FOREVER (2026-10-10): claim the locked LP's fees AHEAD of the buyback cranks, so the 80 % share is in the pool they spend.
    phase("lock-fees");
    if (d.program.lockFees) lpFees.push(await claimLockFeesFor({ registry: d.registry, lockFees: d.program.lockFees, log: d.log, now: d.now, dryRun: d.dryRun }, t));
    phase("execute");
    await fresh(t);
    try { executed.push(...await executePending(d, t, locked, ctx)); } catch (e) { if (!isBudgetHold(e)) errors.push(`$${t.ticker}: execute: ${(e as Error).message.slice(0, 160)}`); else d.log(`  [program] $${t.ticker}: waiting — ${(e as Error).message.slice(0, 160)}`); }
    phase("rule-end");
    // After the day's cranks: the end of the rule (drain / wind-down / retirement / sweep) is planned from what the program just did —
    // and fenced again before they are attested (a cold standby plans the same wind-down days the leader already counted).
    try { planned.push(...await planRuleEnd(d, t, locked, gate, ctx)); } catch (e) { errors.push(`$${t.ticker}: end of rule: ${(e as Error).message.slice(0, 160)}`); }
    phase("fence");
    await fenceStep(t);
    phase("execute");
    await fresh(t);
    try { executed.push(...await executePending(d, t, locked, ctx)); } catch (e) { if (!isBudgetHold(e)) errors.push(`$${t.ticker}: execute: ${(e as Error).message.slice(0, 160)}`); else d.log(`  [program] $${t.ticker}: waiting — ${(e as Error).message.slice(0, 160)}`); }
    // BURN DISPERSAL: after the reading cranks (a waiting reading always cranks first; the program refuses crank_carried until it has).
    if (d.dispersal && locked.mode === "buyback") {
      try {
        const key = DISPERSAL_STATE_KEY(t.mint);
        const r = await runDispersal({ port: d.program.port(t.mint), mint: t.mint, ticker: t.ticker, load: () => d.registry.getStatus(key), save: (j) => d.registry.setStatus(key, j, d.now()), log: d.log, now: d.now, dryRun: !!d.dryRun, alert: (a) => { d.registry.recordAlert(a, d.now()); } });
        dispersal.push({ mint: t.mint, ...r });
      } catch (e) { errors.push(`$${t.ticker}: dispersal: ${(e as Error).message.slice(0, 160)}`); }
    }
  }
  phase("pair-alerts");
  try { await pairUnmatchedAlerts(d.registry, d.program, d.now(), d.log); } catch (e) { errors.push(`pair links: ${(e as Error).message.slice(0, 160)}`); }
  // unlink_pair on the program's terminal evidence (round 3); d.pairUnlink === false only observes.
  phase("pair-unlink");
  try { await pairUnlinkStep(d.registry, d.program, d.now(), !!d.dryRun, d.log, { send: d.pairUnlink !== false }); } catch (e) { errors.push(`pair unlink: ${(e as Error).message.slice(0, 160)}`); }
  for (const r of executed) if (r.outcome === "error") errors.push(`${r.mint.slice(0, 8)} ${r.eventId}: ${r.why}`);
  for (const r of lpFees) if (r.outcome === "error") errors.push(`${r.mint.slice(0, 8)} lock-fees: ${r.why}`);
  if (fence.held.length) for (const h of fence.held) errors.push(`fence: $${h.ticker}: ${h.why}`);
  phase("end");
  if (d.derby && !d.dryRun) { try { d.derby.plan(); } catch (e) { errors.push(`derby planning pass: ${(e as Error).message.slice(0, 160)}`); } }
  return { fetched, planned, executed, errors, ...(d.program.lockFees ? { lpFees } : {}), ...(fenceOn ? { fence } : {}), ...(d.dispersal ? { dispersal } : {}) };
}
