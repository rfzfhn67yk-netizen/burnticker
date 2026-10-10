import type { BurnRule } from "@/lib/burnticker/rules";
import type { Registry, TokenRow } from "@/lib/burnticker/registry";
import { selectorKeyOf } from "@/lib/burnticker/registry";
import type { SettledEvent } from "@/lib/burnticker/units";
import type { FetchLike, ImpliedChance, OracleAdapter, ResolvedSelector, SeriesSummary } from "@/lib/burnticker/oracle/types";
import { canonical, DERBY_DISAGREEMENT_PP, DERBY_SNAPSHOT_TOLERANCE_SEC, dayMs, isoDate, seasonEndMs, seasonWindows, underlyingKey, windowAt, windowSpan, type CoinVsSpec, type DerbySpec, type DerbyUnderlying, type DerbyWindowSpan, type PriceSpec } from "@/lib/burnticker/derby/spec";
import { absDec, cmpDec, crossSide, decideFlip, decideWindow, mulDec, proof16, proofDocument, sideChange, subDec, truncDec, type CrossSide, type Decision, type SideReading } from "@/lib/burnticker/derby/measure";
import { canonicalDecimal } from "@/lib/burnticker/units";
import { hermesBoundaryUrl, HERMES_URL, loadPythCatalogue, PYTH_ONCHAIN_TOLERANCE_SEC, PYTH_SOL_USD, pythFeedAccount, pythSnapshotFromAccount, sha256Hex, type PythRead } from "@/lib/burnticker/derby/pyth";
import { crossQuote } from "@/lib/burnticker/derby/cross";
import { readSupply, samplePool, twap, TWAP_WINDOW_MS, type PoolPort } from "@/lib/burnticker/derby/pools";
import { redstonePrimary } from "@/lib/burnticker/derby/redstone";
import { REDSTONE_LATEST_URL } from "@/lib/burnticker/derby/cross";
import { bracketState, matchKey, roundCount, slotMatchOn, slotPoints, tournamentEnd, type BracketState, type MatchDayResult, type Tournament } from "@/lib/burnticker/derby/bracket";
import { derbyStore, type DerbyStore, type WindowRow } from "@/lib/burnticker/derby/store";

/**
 * THE DERBY ORACLE ADAPTER + THE KEEPER'S DERBY PASS (2026-10-10). The multi-token keeper treats `derby:` selector keys like any other:
 * `settledSince` returns settled windows as SettledEvents (YES = coin A won, NO = coin B won, void = a tie; bracket fan coins: the
 * day's points). Behind it:
 *
 *   SAMPLER (every keeper cycle, before the fetch): spot reads that have no history anywhere — the cross-read quotes and the mint
 *   supplies within DERBY_SNAPSHOT_TOLERANCE_SEC of each 00:00 UTC boundary, and the TWAP coins' pool vault balances through the
 *   hour before it — written to derby_samples with their slots.
 *   DECISION (once a window has ended + the grace): each coin's boundary values (Pyth's signed update at the boundary, kept in
 *   derby_points; or the pool TWAP × Pyth SOL/USD), the % changes, the margin, the cross-check → derby_windows, decided or withheld,
 *   ONCE. The proof JSON's sha256 is the reading's proof (`derby:sha256:<hex>`), its first 16 hex are in the event id, and the keeper
 *   puts the full hash in the counter attestation's proof= field (multiKeeper.ts), so the quorum signs it.
 *   PLANNING PASS (after the cycle): retires coins whose season is over, whose flippening settled, or whose bracket slot lost —
 *   once nothing of theirs is pending — and logs the bracket's schedule.
 *
 * Transport failures (Hermes down, a missing API key) throw so the keeper backs the key off and retries; a bad or missing VALUE
 * (no Pyth update within 60 s of the boundary, a wide confidence interval, too few pool samples, a missing cross-read) withholds the
 * window for good: no reading, no burn.
 */

export interface HermesLike { atBoundary(feed: string, ts: number): Promise<PythRead>; baseUrl?: string }
export interface DerbyDeps {
  registry: Registry;
  /** Hermes with an API key (signed update bytes at the boundary); null = the keyless on-chain route only (Pyth's Solana accounts). */
  hermes: HermesLike | null;
  /** Read-only account port for pool samples and mint supplies (null on a host without an RPC: TWAP coins and mcap then withhold). */
  pools: PoolPort | null;
  /** Cross-read fetch (Jupiter / DexScreener). */
  fetchImpl: FetchLike;
  now: () => number;
  log?: (line: string) => void;
  alert?: (key: string, text: string) => void;
  /** Wait this long after a window ends before deciding it (cross snapshots are taken up to DERBY_SNAPSHOT_TOLERANCE_SEC after it). */
  graceMs?: number;
  /** Minimum spacing between two samples of the same key (default 4 min). */
  sampleSpacingMs?: number;
}

const TOL_MS = DERBY_SNAPSHOT_TOLERANCE_SEC * 1000;
const DAY_MS = 86_400_000;
export const DERBY_GRACE_MS = TOL_MS;
const crossKey = (u: DerbyUnderlying) => `cross:${u.cross}`;
const supplyKey = (u: DerbyUnderlying) => `supply:${u.mint}`;
const poolKey = (u: DerbyUnderlying) => `pool:${u.pool}`;
const pythKey = (feed: string) => `pyth:${feed}`;
const redstoneKey = (feed: string) => `redstone:${feed}`;
/** Market-hours feeds (anything that is not a crypto feed) read the last published value at a boundary. Unknown ids count as crypto. */
export function marketHours(feed: string): boolean {
  try { const r = loadPythCatalogue().find((x) => x.id === feed); return !!r && r.asset_type !== "Crypto"; } catch { return false; }
}
const STALE_MARKET_SEC = 4 * 86_400;
export const DERBY_PROOF_PREFIX = "derby:sha256:";

/** The proof hash (32 bytes) a counter reading commits to for the derby receipts it counts (undefined: none of them is a derby reading). */
export function derbyProofHash(proofs: readonly (string | null | undefined)[]): Uint8Array | undefined {
  const hs = proofs.filter((p): p is string => !!p && p.startsWith(DERBY_PROOF_PREFIX)).map((p) => p.slice(DERBY_PROOF_PREFIX.length)).filter((h) => /^[0-9a-f]{64}$/.test(h));
  if (!hs.length) return undefined;
  return Buffer.from(hs.length === 1 ? hs[0] : sha256Hex(hs.join(",")), "hex");
}

export class DerbyAdapter implements OracleAdapter {
  readonly id = "derby";
  readonly store: DerbyStore;
  readonly d: DerbyDeps;
  constructor(d: DerbyDeps) { this.d = d; this.store = derbyStore(d.registry.db); }
  private log(s: string) { this.d.log?.(`  [derby] ${s}`); }
  private get grace() { return this.d.graceMs ?? DERBY_GRACE_MS; }

  async searchSeries(): Promise<SeriesSummary[]> { return []; }
  async seriesInfo(ticker: string): Promise<SeriesSummary | null> {
    return { oracle: "derby", ticker, title: ticker.startsWith("bracket:") ? `Burn Derby bracket ${ticker.split(":")[1]}` : ticker.startsWith("price:") ? `Burn Derby ${ticker.split(":")[1]} % change` : `Burn Derby ${ticker.split(":")[1]?.replace("-", " vs ") ?? ticker}`, category: "Crypto", frequency: ticker.includes(":weekly:") ? "weekly" : "daily", settlementSource: { name: "Pyth (Hermes signed updates)", url: HERMES_URL }, tags: ["derby"] };
  }
  async impliedChance(rule: BurnRule): Promise<ImpliedChance> {
    const now = this.d.now();
    const next = rule.derby && rule.derby.selector !== "bracket" && rule.derby.window === "weekly" ? (() => { let m = dayMs(isoDate(now)) + DAY_MS; while (new Date(m).getUTCDay() !== 1) m += DAY_MS; return m; })() : dayMs(isoDate(now)) + DAY_MS;
    return { chance: null, marketTicker: null, closeTime: new Date(next).toISOString(), basis: "Burn Derby: no market and no odds — the next window closes at this time" };
  }

  // ---------------------------------------------------------------------------------------------------------------------------------
  // Boundary values
  // ---------------------------------------------------------------------------------------------------------------------------------

  /**
   * The on-chain snapshot used for a boundary (the keyless route): crypto — the first snapshot taken after the boundary whose publish time
   * is at/after it, within PYTH_ONCHAIN_TOLERANCE_SEC; market-hours feeds — the first snapshot within the snapshot tolerance after the
   * boundary, carrying the last value published by the boundary (at most 4 days old: a weekend).
   */
  onchainAt(feed: string, boundaryMs: number): { ok: true; value: string; proof: Record<string, unknown> } | { ok: false; reason: string } {
    const b = Math.floor(boundaryMs / 1000);
    const hours = marketHours(feed);
    const xs = this.store.samples(pythKey(feed), "pyth", boundaryMs, boundaryMs + (hours ? TOL_MS : PYTH_ONCHAIN_TOLERANCE_SEC * 1000));
    const pick = hours ? xs.find((x) => Number(x.detail.publishTime) <= b + 60 && Number(x.detail.publishTime) >= b - STALE_MARKET_SEC) : xs.find((x) => Number(x.detail.publishTime) >= b && Number(x.detail.publishTime) <= b + PYTH_ONCHAIN_TOLERANCE_SEC);
    if (!pick) return { ok: false, reason: xs.length ? `no Pyth snapshot on Solana with a ${hours ? "last value published by" : "value published at or after"} the boundary (${xs.length} snapshot(s) checked)` : "no Pyth snapshot on Solana was taken at the boundary" };
    return { ok: true, value: pick.value, proof: { ...pick.detail, boundary: b, sampledAt: pick.ts, feed, route: "pyth-solana" } };
  }

  /** Pyth at a boundary: a stored Hermes update, the on-chain snapshot, else Hermes (when keyed; stored on success). */
  async pythAt(feed: string, boundaryMs: number): Promise<{ ok: true; value: string; proof: Record<string, unknown> } | { ok: false; reason: string }> {
    const ts = Math.floor(boundaryMs / 1000);
    const asProof = (p: { feed: string; price: string; conf: string; expo: number; value: string; publishTime: number; slot: number | null; updateSha256: string; url: string }) => ({ ok: true as const, value: p.value, proof: { source: "pyth", route: "hermes", feed: p.feed, boundary: ts, publishTime: p.publishTime, price: p.price, conf: p.conf, expo: p.expo, slot: p.slot, updateSha256: p.updateSha256, url: p.url } });
    const have = this.store.point(feed, ts);
    if (have) return asProof(have);
    const onchain = this.onchainAt(feed, boundaryMs);
    if (onchain.ok || !this.d.hermes || marketHours(feed)) return onchain;
    const r: PythRead = await this.d.hermes.atBoundary(feed, ts);
    if (!r.ok) return { ok: false, reason: `${r.reason}; on Solana: ${onchain.reason}` };
    this.store.putPoint({ feed, boundary: ts, publishTime: r.point.publishTime, price: r.point.price, conf: r.point.conf, expo: r.point.expo, value: r.point.value, slot: r.point.slot, updateSha256: r.point.updateSha256, updateBase64: r.point.updateBase64, url: r.point.url, fetchedAt: this.d.now() });
    return asProof(r.point);
  }

  /** One coin's boundary value: Pyth, or the pool TWAP × Pyth SOL/USD. */
  /**
   * One coin's boundary value, in the order of preference: Pyth (a stored Hermes update, the Solana account snapshot, Hermes with a key)
   * → the pool TWAP → RedStone's verified signed packages (the coin's `redstone` feed, snapshotted at the boundary).
   */
  async valueAt(u: DerbyUnderlying, boundaryMs: number): Promise<{ ok: true; value: string; proof: Record<string, unknown> } | { ok: false; reason: string }> {
    const why: string[] = [];
    if (u.pyth) {
      const r = await this.pythAt(u.pyth, boundaryMs);
      if (r.ok) return r;
      why.push(r.reason);
    }
    if (u.pool) {
      const r = await this.twapAt(u, boundaryMs);
      if (r.ok) return r;
      why.push(r.reason);
    }
    if (u.redstone) {
      const x = this.store.samples(redstoneKey(u.redstone), "redstone", boundaryMs, boundaryMs + TOL_MS)[0];
      if (x) return { ok: true, value: x.value, proof: { ...x.detail, boundary: Math.floor(boundaryMs / 1000), sampledAt: x.ts } };
      why.push("no verified RedStone snapshot was taken at the boundary");
    }
    return { ok: false, reason: `${u.symbol}: ${why.join("; ") || "no source"}` };
  }

  /** The pool TWAP × Pyth SOL/USD at a boundary. */
  private async twapAt(u: DerbyUnderlying, boundaryMs: number): Promise<{ ok: true; value: string; proof: Record<string, unknown> } | { ok: false; reason: string }> {
    const samples = this.store.samples(poolKey(u), "pool", boundaryMs - TWAP_WINDOW_MS, boundaryMs);
    const t = twap(samples.map((s) => ({ ts: s.ts, priceSol: s.value })), boundaryMs);
    if (t.value === null) return { ok: false, reason: `${u.symbol}: ${t.reason}` };
    const sol = await this.pythAt(PYTH_SOL_USD, boundaryMs);
    if (!sol.ok) return { ok: false, reason: `${u.symbol}: SOL/USD — ${sol.reason}` };
    return { ok: true, value: truncDec(mulDec(t.value, sol.value), 18), proof: { source: "twap", pool: u.pool, twapSol: t.value, samples: samples.map((s) => ({ ts: s.ts, slot: s.slot, tokenRaw: s.detail.tokenRaw, solRaw: s.detail.solRaw })), solUsd: sol.proof } };
  }

  supplyAt(u: DerbyUnderlying, boundaryMs: number): string | null {
    if (!u.mint) return null;
    return this.store.nearest(supplyKey(u), "supply", boundaryMs, TOL_MS)?.value ?? null;
  }

  /** One coin over a window. */
  async side(u: DerbyUnderlying, measure: CoinVsSpec["measure"], w: DerbyWindowSpan): Promise<{ ok: true; side: SideReading } | { ok: false; reason: string }> {
    const [s, e] = [await this.valueAt(u, w.startMs), await this.valueAt(u, w.endMs)];
    if (!s.ok) return s;
    if (!e.ok) return e;
    const supS = measure === "mcap" ? this.supplyAt(u, w.startMs) : null, supE = measure === "mcap" ? this.supplyAt(u, w.endMs) : null;
    if (measure === "mcap" && (supS === null || supE === null)) return { ok: false, reason: `${u.symbol}: no circulating-supply reading within ${DERBY_SNAPSHOT_TOLERANCE_SEC / 60} min of a boundary` };
    return { ok: true, side: { symbol: u.symbol, key: underlyingKey(u), source: (s.proof.source === "redstone" ? "redstone" : s.proof.source === "twap" ? "twap" : "pyth") as SideReading["source"], start: s.value, end: e.value, supplyStart: supS, supplyEnd: supE, changePct: sideChange(measure, s.value, e.value, supS, supE), proof: { start: s.proof, end: e.proof } } };
  }

  /** The cross-read's boundary quotes for one coin over a window (null when either snapshot is missing). */
  crossFor(u: DerbyUnderlying, measure: CoinVsSpec["measure"], w: DerbyWindowSpan, supS: string | null, supE: string | null): CrossSide | null {
    const a = this.store.nearest(crossKey(u), "cross", w.startMs, TOL_MS), b = this.store.nearest(crossKey(u), "cross", w.endMs, TOL_MS);
    if (!a || !b) return null;
    try { return crossSide(measure, { source: String(a.detail.source ?? "cross"), start: a.value, end: b.value, refs: { start: { ts: a.ts, ...a.detail }, end: { ts: b.ts, ...b.detail } } }, supS, supE); } catch { return null; }
  }

  // ---------------------------------------------------------------------------------------------------------------------------------
  // Decisions
  // ---------------------------------------------------------------------------------------------------------------------------------

  private record(key: string, w: DerbyWindowSpan, d: Decision, doc: Record<string, unknown>, eventPrefix = ""): WindowRow {
    if (d.status === "pending") return this.store.decide({ selectorKey: key, windowId: w.id, status: "withheld", eventId: null, at: windowAt(w), result: null, value: null, reason: `noflip: ${d.reason}`, proofSha256: null, proof: null }, this.d.now());
    const sha = sha256Hex(canonical(doc));
    if (d.status === "withheld") {
      const row = this.store.decide({ selectorKey: key, windowId: w.id, status: "withheld", eventId: null, at: windowAt(w), result: null, value: null, reason: d.reason, proofSha256: sha, proof: doc }, this.d.now());
      this.log(`${key} ${w.id}: WITHHELD — ${d.reason}`);
      this.d.alert?.(`derby-withheld:${key}:${w.id}`, `Burn Derby ${key} window ${w.id} withheld: ${d.reason}`);
      return row;
    }
    const row = this.store.decide({ selectorKey: key, windowId: w.id, status: "decided", eventId: `${eventPrefix}${w.id}:${proof16(sha)}`, at: windowAt(w), result: d.result, value: d.value, reason: d.note, proofSha256: sha, proof: doc }, this.d.now());
    this.log(`${key} ${w.id}: ${(d.result ?? d.value).toUpperCase()} — ${d.note}`);
    return row;
  }

  /** Decides one coin-vs-coin window (not a flippening) and records it. */
  async decideCoinvs(key: string, spec: CoinVsSpec, w: DerbyWindowSpan): Promise<WindowRow> {
    const [a, b] = [await this.side(spec.a, spec.measure, w), await this.side(spec.b, spec.measure, w)];
    if (!a.ok || !b.ok) {
      const d: Decision = { status: "withheld", reason: !a.ok ? a.reason : (b as { reason: string }).reason, margin: null, crossMargin: null, disagreement: null };
      return this.record(key, w, d, proofDocument(key, w, { a: a.ok ? a.side : null, b: b.ok ? b.side : null }, { a: null, b: null }, d));
    }
    const cross = { a: this.crossFor(spec.a, spec.measure, w, a.side.supplyStart, a.side.supplyEnd), b: this.crossFor(spec.b, spec.measure, w, b.side.supplyStart, b.side.supplyEnd) };
    const d = decideWindow(a.side, b.side, cross);
    return this.record(key, w, d, proofDocument(key, w, { a: a.side, b: b.side }, cross, d));
  }

  /** One single-asset window: its % change, cross-checked (withheld above the bound or without a cross-read). */
  async decidePrice(key: string, spec: PriceSpec, w: DerbyWindowSpan): Promise<WindowRow> {
    const a = await this.side(spec.u, "pct", w);
    if (!a.ok) { const d: Decision = { status: "withheld", reason: a.reason, margin: null, crossMargin: null, disagreement: null }; return this.record(key, w, d, proofDocument(key, w, { a: null, b: null }, { a: null, b: null }, d)); }
    const cross = this.crossFor(spec.u, "pct", w, null, null);
    let d: Decision;
    if (!cross) d = { status: "withheld", reason: `cross-read unavailable for ${spec.u.symbol} at a boundary (no reading, no burn)`, margin: a.side.changePct, crossMargin: null, disagreement: null };
    else {
      const disagreement = absDec(subDec(a.side.changePct, cross.changePct));
      d = cmpDec(disagreement, String(DERBY_DISAGREEMENT_PP)) > 0
        ? { status: "withheld", reason: `the cross-read disagrees by ${disagreement} points on the change (primary ${a.side.changePct}%, cross ${cross.changePct}%) — no reading, no burn`, margin: a.side.changePct, crossMargin: cross.changePct, disagreement }
        : { status: "decided", result: null, value: canonicalDecimal(a.side.changePct), margin: a.side.changePct, crossMargin: cross.changePct, disagreement, note: `${spec.u.symbol} ${a.side.changePct}% (cross ${cross.changePct}%)` };
    }
    return this.record(key, w, d, proofDocument(key, w, { a: a.side, b: null }, { a: cross, b: null }, d));
  }

  /** One flippening window: sizes at the end boundary. */
  async decideFlipWindow(key: string, spec: CoinVsSpec, w: DerbyWindowSpan, last: boolean): Promise<WindowRow> {
    const end = { startMs: w.endMs, endMs: w.endMs, id: w.id };
    const [va, vb] = [await this.valueAt(spec.a, w.endMs), await this.valueAt(spec.b, w.endMs)];
    const sa = this.supplyAt(spec.a, w.endMs), sb = this.supplyAt(spec.b, w.endMs);
    if (!va.ok || !vb.ok || sa === null || sb === null) {
      const d: Decision = { status: "withheld", reason: !va.ok ? va.reason : !vb.ok ? vb.reason : "no circulating-supply reading at the boundary", margin: null, crossMargin: null, disagreement: null };
      return this.record(key, w, d, proofDocument(key, w, { a: null, b: null }, { a: null, b: null }, d), "flip-");
    }
    const ca = this.store.nearest(crossKey(spec.a), "cross", end.endMs, TOL_MS), cb = this.store.nearest(crossKey(spec.b), "cross", end.endMs, TOL_MS);
    const sizeA = mulDec(va.value, sa), sizeB = mulDec(vb.value, sb);
    const d = decideFlip(sizeA, sizeB, ca && cb ? { a: mulDec(ca.value, sa), b: mulDec(cb.value, sb) } : null, last);
    const sides = { a: { symbol: spec.a.symbol, key: underlyingKey(spec.a), source: (spec.a.pyth ? "pyth" : "twap") as SideReading["source"], start: va.value, end: va.value, supplyStart: sa, supplyEnd: sa, changePct: "0", proof: { end: va.proof } }, b: { symbol: spec.b.symbol, key: underlyingKey(spec.b), source: (spec.b.pyth ? "pyth" : "twap") as SideReading["source"], start: vb.value, end: vb.value, supplyStart: sb, supplyEnd: sb, changePct: "0", proof: { end: vb.proof } } };
    return this.record(key, w, d, proofDocument(key, w, sides, { a: ca ? { source: String(ca.detail.source), start: ca.value, end: ca.value, changePct: "0", refs: { ts: ca.ts } } : null, b: cb ? { source: String(cb.detail.source), start: cb.value, end: cb.value, changePct: "0", refs: { ts: cb.ts } } : null }, d, { sizeA, sizeB }), "flip-");
  }

  /** The seasons of the tokens currently on a key (shared readings: the union of their windows). */
  private windowsFor(key: string, rule: BurnRule): DerbyWindowSpan[] {
    const specs = this.d.registry.tokens().filter((t) => t.selectorKey === key && (t.status === "live" || t.status === "paused" || t.status === "draft")).map((t) => this.d.registry.lockedRule(t).rule.derby).filter((x): x is CoinVsSpec | PriceSpec => x?.selector === "coinvs" || x?.selector === "price");
    if (rule.derby && rule.derby.selector !== "bracket") specs.push(rule.derby);
    const byId = new Map<string, DerbyWindowSpan>();
    for (const s of specs) for (const w of seasonWindows(s)) byId.set(w.id, w);
    return [...byId.values()].sort((a, b) => a.startMs - b.startMs);
  }

  async settledSince(rule: BurnRule, sinceIso: string | null): Promise<ResolvedSelector> {
    const spec = rule.derby;
    if (!spec) throw new Error("derby adapter: the rule has no derby block");
    const key = selectorKeyOf(rule), now = this.d.now();
    const refusals: string[] = [];
    let awaitingFinal = 0;
    if (spec.selector === "coinvs") {
      const windows = this.windowsFor(key, rule);
      if (spec.flip) {
        const settled = this.store.windows(key).some((r) => r.status === "decided");
        for (const [i, w] of windows.entries()) {
          if (settled || this.store.window(key, w.id)) continue;
          if (w.endMs > now) break;
          if (w.endMs + this.grace > now) { awaitingFinal++; break; }
          const row = await this.decideFlipWindow(key, spec, w, i === windows.length - 1);
          if (row.status === "withheld" && !row.reason?.startsWith("noflip")) refusals.push(`${w.id}: ${row.reason}`);
          if (row.status === "decided") break;
        }
      } else {
        for (const w of windows) {
          if (this.store.window(key, w.id)) continue;
          if (w.endMs > now) break;
          if (w.endMs + this.grace > now) { awaitingFinal++; continue; }
          const row = await this.decideCoinvs(key, spec, w);
          if (row.status === "withheld") refusals.push(`${w.id}: ${row.reason}`);
        }
      }
      return { events: this.eventsOf(key, sinceIso, spec), awaitingFinal, refusals, settlementSourceUrl: HERMES_URL };
    }
    if (spec.selector === "price") {
      for (const w of this.windowsFor(key, rule)) {
        if (this.store.window(key, w.id)) continue;
        if (w.endMs > now) break;
        if (w.endMs + this.grace > now) { awaitingFinal++; continue; }
        const row = await this.decidePrice(key, spec, w);
        if (row.status === "withheld") refusals.push(`${w.id}: ${row.reason}`);
      }
      const events = this.store.windows(key).filter((r) => r.status === "decided" && r.eventId && (!sinceIso || r.at > sinceIso)).map((r) => ({ id: r.eventId!, at: r.at, result: null, value: r.value, title: `${spec.u.symbol} ${r.value}% (${r.windowId})`, sourceUrl: this.sourceUrlFor(spec.u, null, windowSpan(spec.window, r.windowId).endMs), method: `derby single-asset % change (cross ${(r.proof as { decision?: { crossMargin?: string } } | null)?.decision?.crossMargin ?? "—"}%)`, proof: r.proofSha256 ? `${DERBY_PROOF_PREFIX}${r.proofSha256}` : null }));
      return { events, awaitingFinal, refusals, settlementSourceUrl: HERMES_URL };
    }
    // bracket fan coin
    const t = this.tournament(spec.tournamentId, spec.tournamentSha);
    const state = await this.advance(t, refusals);
    return { events: this.slotEvents(t, state, spec.slot, sinceIso), awaitingFinal, refusals, settlementSourceUrl: HERMES_URL };
  }

  /** A decided coin-vs-coin window → the registry reading. */
  private eventsOf(key: string, sinceIso: string | null, spec: CoinVsSpec): SettledEvent[] {
    return this.store.windows(key).filter((r) => r.status === "decided" && r.eventId && (!sinceIso || r.at > sinceIso)).map((r) => {
      const doc = r.proof as { a?: { changePct?: string } | null; b?: { changePct?: string } | null; decision?: { margin?: string; crossMargin?: string } } | null;
      const title = spec.flip ? `${spec.a.symbol} vs ${spec.b.symbol} flippening ${r.windowId}: ${r.result === "yes" ? `${spec.a.symbol} passed ${spec.b.symbol}` : "season ended without it"}` : `${spec.a.symbol} ${doc?.a?.changePct ?? "?"}% vs ${spec.b.symbol} ${doc?.b?.changePct ?? "?"}% (${r.windowId})`;
      return { id: r.eventId!, at: r.at, result: r.result, value: r.value, title, sourceUrl: this.sourceUrlFor(spec.a, spec.b, windowSpan(spec.window, r.windowId).endMs), method: `derby ${spec.measure}${spec.flip ? " flippening" : ""}: margin ${doc?.decision?.margin ?? r.value} (cross ${doc?.decision?.crossMargin ?? "—"})`, proof: r.proofSha256 ? `${DERBY_PROOF_PREFIX}${r.proofSha256}` : null };
    });
  }

  /** Where a stranger re-reads the end boundary: Hermes for the feeds (or Pyth's Solana account; a TWAP coin's pool on an explorer). */
  sourceUrlFor(a: DerbyUnderlying, b: DerbyUnderlying | null, endMs: number): string {
    const ids = [a.pyth, b?.pyth].filter(Boolean) as string[];
    if (!ids.length) return `https://solscan.io/account/${a.pool}`;
    if (!this.d.hermes) return `https://solscan.io/account/${pythFeedAccount(ids[0])}`;
    const base = (this.d.hermes.baseUrl ?? HERMES_URL).replace(/\/+$/, "");
    return ids.length === 1 ? hermesBoundaryUrl(base, ids[0], Math.floor(endMs / 1000)) : `${base}/v2/updates/price/${Math.floor(endMs / 1000)}?ids[]=${ids[0]}&ids[]=${ids[1]}&encoding=base64&parsed=true`;
  }

  // ---------------------------------------------------------------------------------------------------------------------------------
  // Brackets
  // ---------------------------------------------------------------------------------------------------------------------------------

  tournament(id: string, sha?: string): Tournament {
    const row = this.store.tournament(id);
    if (!row) throw new Error(`derby: no tournament ${id} in the registry`);
    if (sha && row.sha256 !== sha) throw new Error(`derby: tournament ${id} is sha256 ${row.sha256.slice(0, 12)}…, the rule names ${sha.slice(0, 12)}… — holding`);
    return JSON.parse(row.json) as Tournament;
  }

  /** The bracket from recorded match days only (sync; pages and the planning pass). */
  bracket(t: Tournament): BracketState {
    return bracketState(t, (r, m, _a, _b, date) => matchDayOf(this.store.window(matchKey(t.id, r, m), date)));
  }

  /** Decides every closed, unrecorded match day of the matches that exist, round by round, then returns the state. */
  async advance(t: Tournament, refusals: string[] = []): Promise<BracketState> {
    const now = this.d.now();
    for (let pass = 0; pass <= roundCount(t); pass++) {
      const state = this.bracket(t);
      let wrote = 0;
      for (const r of state.rounds) for (const m of r.matches) {
        if (m.a < 0 || m.b < 0) continue;
        for (const day of m.days) {
          if (day.result) continue;
          const w = windowSpan("daily", day.date);
          if (w.endMs + this.grace > now) continue;
          const key = matchKey(t.id, r.index, m.index);
          const spec: CoinVsSpec = { selector: "coinvs", a: t.underlyings[m.a], b: t.underlyings[m.b], window: "daily", measure: "pct", season: { start: t.start, days: 1 }, flip: false };
          const row = await this.decideCoinvs(key, spec, w);
          if (row.status === "withheld") refusals.push(`${key} ${day.date}: ${row.reason}`);
          wrote++;
        }
      }
      if (!wrote) return state;
    }
    return this.bracket(t);
  }

  /** A fan coin's readings: one per decided day of its matches (points: units for a win, 0 for a loss; a tie is a void). */
  slotEvents(t: Tournament, state: BracketState, slot: number, sinceIso: string | null): SettledEvent[] {
    const out: SettledEvent[] = [];
    for (const r of state.rounds) for (const m of r.matches) {
      if (m.a !== slot && m.b !== slot) continue;
      const side = m.a === slot ? "a" : "b";
      for (const day of m.days) {
        const res = day.result;
        if (!res || res.status !== "decided") continue;
        const w = windowSpan("daily", day.date), at = windowAt(w);
        if (sinceIso && at <= sinceIso) continue;
        const pts = slotPoints(res, side, m.final, t.fractionOfPool);
        const me = t.underlyings[slot], them = t.underlyings[side === "a" ? m.b : m.a];
        const [mine, theirs] = side === "a" ? [res.changeA, res.changeB] : [res.changeB, res.changeA];
        out.push({ id: res.eventId, at, result: pts === null ? "void" : null, value: pts, title: `${t.id} round ${r.index + 1}${m.final ? " (final)" : ""}: ${me.symbol} ${mine}% vs ${them.symbol} ${theirs}% (${day.date})`, sourceUrl: this.sourceUrlFor(me, them, w.endMs), method: `derby bracket ${m.key}: ${pts === null ? "tie" : pts === "0" ? "loss" : `win, ${pts} unit(s)`}`, proof: res.proofSha256 ? `${DERBY_PROOF_PREFIX}${res.proofSha256}` : null });
      }
    }
    return out;
  }

  // ---------------------------------------------------------------------------------------------------------------------------------
  // The sampler (before each fetch)
  // ---------------------------------------------------------------------------------------------------------------------------------

  /** Every underlying a live derby token needs, with what to sample for it. */
  underlyingsInUse(tokens: readonly TokenRow[]): { u: DerbyUnderlying; supply: boolean }[] {
    const out = new Map<string, { u: DerbyUnderlying; supply: boolean }>();
    const add = (u: DerbyUnderlying, supply: boolean) => { const k = `${underlyingKey(u)}|${u.cross}`; const have = out.get(k); out.set(k, { u, supply: supply || !!have?.supply }); };
    for (const t of tokens) {
      if (!t.selectorKey.startsWith("derby:")) continue;
      let d: DerbySpec | undefined;
      try { d = this.d.registry.lockedRule(t).rule.derby; } catch { continue; }
      if (!d) continue;
      if (d.selector === "coinvs") { add(d.a, d.measure === "mcap"); add(d.b, d.measure === "mcap"); }
      else if (d.selector === "price") add(d.u, false);
      else { try { for (const u of this.tournament(d.tournamentId).underlyings) add(u, false); } catch { /* no tournament row: the fetch reports it */ } }
    }
    return [...out.values()];
  }

  /**
   * One sampling pass. Cross quotes and supplies: when `now` is within the snapshot tolerance of a 00:00 UTC boundary and none was taken
   * for it yet. Pool vault balances (TWAP coins): through the hour before the next boundary, one per `sampleSpacingMs`. Failures are
   * logged, never thrown (a missing sample withholds a window later; it never stops the keeper).
   */
  async sample(tokens: readonly TokenRow[]): Promise<{ taken: number; errors: string[] }> {
    const now = this.d.now(), spacing = this.d.sampleSpacingMs ?? 4 * 60_000;
    const nearest = Math.round(now / DAY_MS) * DAY_MS, nextB = Math.ceil(now / DAY_MS) * DAY_MS;
    const atBoundary = Math.abs(now - nearest) <= TOL_MS;
    let taken = 0;
    const errors: string[] = [];
    const recent = (key: string, kind: "pool" | "cross" | "supply" | "pyth") => { const l = this.store.lastSample(key, kind); return !!l && now - l.ts < spacing; };
    const cache = new Map<string, unknown>();
    const lastB = Math.floor(now / DAY_MS) * DAY_MS;
    const pythFeeds = new Set<string>();
    for (const { u } of this.underlyingsInUse(tokens)) { if (u.pyth) pythFeeds.add(u.pyth); else if (u.pool) pythFeeds.add(PYTH_SOL_USD); }
    // Pyth on Solana (keyless): after each boundary until a qualifying snapshot is in (crypto: published at/after it; market hours: one).
    if (this.d.pools) for (const feed of pythFeeds) {
      if (now - lastB > PYTH_ONCHAIN_TOLERANCE_SEC * 1000 || this.onchainAt(feed, lastB).ok || recent(pythKey(feed), "pyth")) continue;
      try {
        const address = pythFeedAccount(feed);
        const [acct] = await this.d.pools.accounts([address]);
        if (!acct) { errors.push(`Pyth ${feed.slice(0, 12)}…: no sponsored account on Solana (${address}) — Hermes with a key is the route for this feed`); continue; }
        const snap = pythSnapshotFromAccount(feed, acct, await this.d.pools.slot(), address);
        if (this.store.putSample({ key: pythKey(feed), kind: "pyth", ts: now, slot: (snap.detail.slot as number | null) ?? null, value: snap.value, detail: snap.detail })) taken++;
      } catch (e) { errors.push(`Pyth ${feed.slice(0, 12)}… on Solana: ${(e as Error).message.slice(0, 120)}`); }
    }
    // RedStone as a primary: a verified snapshot after each boundary for coins that carry a RedStone feed (the SHIB case).
    for (const { u } of this.underlyingsInUse(tokens)) {
      if (!u.redstone || now < lastB || now - lastB > TOL_MS || this.store.samples(redstoneKey(u.redstone), "redstone", lastB, lastB + TOL_MS).length) continue;
      try {
        let body = cache.get(REDSTONE_LATEST_URL);
        if (body === undefined) { const res = await this.d.fetchImpl(REDSTONE_LATEST_URL, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(20_000) }); if (!res.ok) throw new Error(`RedStone HTTP ${res.status}`); body = await res.json(); cache.set(REDSTONE_LATEST_URL, body); }
        const r = await redstonePrimary(body, u.redstone, REDSTONE_LATEST_URL);
        if (!r.ok) { errors.push(`${u.symbol}: ${r.reason}`); continue; }
        // The packages must be from this boundary (signed at most 5 minutes before it), never a stale gateway answer.
        if (r.timestampMs < lastB - 5 * 60_000 || r.timestampMs > now + 60_000) { errors.push(`${u.symbol}: RedStone's packages were signed at ${new Date(r.timestampMs).toISOString()}, not at the ${new Date(lastB).toISOString()} boundary`); continue; }
        if (this.store.putSample({ key: redstoneKey(u.redstone), kind: "redstone", ts: now, slot: null, value: r.value, detail: r.proof })) taken++;
      } catch (e) { errors.push(`${u.symbol} RedStone: ${(e as Error).message.slice(0, 120)}`); }
    }
    for (const { u, supply } of this.underlyingsInUse(tokens)) {
      if (atBoundary && !this.store.nearest(crossKey(u), "cross", nearest, TOL_MS)) {
        try {
          const q = await crossQuote(this.d.fetchImpl, u.cross, cache);
          if (q && this.store.putSample({ key: crossKey(u), kind: "cross", ts: now, slot: null, value: q.usd, detail: { source: q.source, url: q.url, ref: q.ref, liquidityUsd: q.liquidityUsd } })) taken++;
          if (!q) errors.push(`${u.symbol}: the cross-read (${u.cross}) knows no such coin`);
        } catch (e) { errors.push(`${u.symbol} cross-read: ${(e as Error).message.slice(0, 120)}`); }
      }
      if (supply && u.mint && this.d.pools && atBoundary && !this.store.nearest(supplyKey(u), "supply", nearest, TOL_MS)) {
        try { const s = await readSupply(this.d.pools, u.mint); if (this.store.putSample({ key: supplyKey(u), kind: "supply", ts: now, slot: s.slot, value: s.supply, detail: { supplyRaw: s.supplyRaw, decimals: s.decimals } })) taken++; }
        catch (e) { errors.push(`${u.symbol} supply: ${(e as Error).message.slice(0, 120)}`); }
      }
      if (!u.pyth && u.pool && u.mint && this.d.pools && nextB - now <= TWAP_WINDOW_MS && !recent(poolKey(u), "pool")) {
        try { const s = await samplePool(this.d.pools, u.pool, u.mint); if (this.store.putSample({ key: poolKey(u), kind: "pool", ts: now, slot: s.slot, value: s.priceSol, detail: { dex: s.dex, tokenRaw: s.tokenRaw, solRaw: s.solRaw, decimals: s.decimals } })) taken++; }
        catch (e) { errors.push(`${u.symbol} pool: ${(e as Error).message.slice(0, 120)}`); }
      }
    }
    for (const e of errors) this.log(`sampler: ${e}`);
    return { taken, errors };
  }

  // ---------------------------------------------------------------------------------------------------------------------------------
  // The planning pass (after each cycle)
  // ---------------------------------------------------------------------------------------------------------------------------------

  /** Why a live derby token is finished (null = it still reads). Pure over the store. */
  finished(t: TokenRow, now = this.d.now()): string | null {
    let d: DerbySpec | undefined;
    try { d = this.d.registry.lockedRule(t).rule.derby; } catch { return null; }
    if (!d) return null;
    // Both or neither: a voided pair is a no-contest — both coins' derby ends (their pools wind down under onEnd).
    const pr = this.d.registry.pairOf(t.mint);
    if (pr && this.d.registry.pairOutcome(pr.pairId)?.state === "voided") return `pair ${pr.pairId} voided (both or neither): no contest`;
    if (d.selector === "price") {
      if (now < seasonEndMs(d) + this.grace) return null;
      return seasonWindows(d).some((w) => !this.store.window(t.selectorKey, w.id)) ? null : `season over (${d.season.days} days from ${d.season.start})`;
    }
    if (d.selector === "coinvs") {
      if (d.flip) { const w = this.store.windows(t.selectorKey).find((r) => r.status === "decided"); return w ? `the flippening settled ${w.result === "yes" ? "YES" : "NO"} (${w.windowId}): the pair retires` : null; }
      if (now < seasonEndMs(d) + this.grace) return null;
      const missing = seasonWindows(d).filter((w) => !this.store.window(t.selectorKey, w.id));
      return missing.length ? null : `season over (${d.season.days} days from ${d.season.start})`;
    }
    let tt: Tournament;
    try { tt = this.tournament(d.tournamentId); } catch { return null; }
    const state = this.bracket(tt);
    const out = state.eliminatedIn.get(d.slot);
    if (out !== undefined) return `knocked out in round ${out + 1} of bracket ${tt.id}`;
    return null;
  }

  /**
   * The keeper's end hook (multiKeeper detectRuleEnd): why and when a derby token's rule ended — the season's end, the flippening's
   * window, the round its bracket slot lost, or the pair's void. Its pool then winds down under onEnd (multiKeeper planRuleEnd).
   */
  ended(t: TokenRow): { reason: string; atMs: number } | null {
    const why = this.finished(t);
    if (!why) return null;
    let d: DerbySpec | undefined;
    try { d = this.d.registry.lockedRule(t).rule.derby; } catch { return null; }
    const pr = this.d.registry.pairOf(t.mint), o = pr ? this.d.registry.pairOutcome(pr.pairId) : null;
    if (o?.state === "voided") return { reason: why, atMs: o.at };
    if (d?.selector === "coinvs" && d.flip) { const w = this.store.windows(t.selectorKey).find((r) => r.status === "decided"); return { reason: why, atMs: w ? Date.parse(w.at) + 1000 : this.d.now() }; }
    if (d && d.selector !== "bracket") return { reason: why, atMs: seasonEndMs(d) };
    if (d?.selector === "bracket") {
      const tt = this.tournament(d.tournamentId), st = this.bracket(tt), r = st.eliminatedIn.get(d.slot);
      if (r !== undefined) return { reason: why, atMs: dayMs(st.rounds[r].end) };
    }
    return { reason: why, atMs: this.d.now() };
  }

  /** Retires finished derby coins once nothing of theirs is pending; logs the bracket schedule. Returns what it did. */
  plan(): string[] {
    const reg = this.d.registry, done: string[] = [];
    for (const t of reg.tokens("live")) {
      if (!t.selectorKey.startsWith("derby:")) continue;
      // A rule with the onEnd clause retires through the keeper's wind-down (multiKeeper planRuleEnd), not here.
      try { if (reg.lockedRule(t).rule.onEnd) continue; } catch { continue; }
      const why = this.finished(t);
      if (!why) continue;
      const voided = why.includes("no contest");
      // Never retire over receipts still to execute — planned, sending, or waiting on the pair's second pool (pending-pair).
      if (!voided && (reg.pending(t.mint).length || reg.receipts(t.mint).some((r) => r.status === "pending-pair"))) { this.log(`$${t.ticker}: ${why} — retiring once its pending receipts are cranked`); continue; }
      reg.setTokenStatus(t.mint, "retired");
      reg.setStatus(`derby.retired.${t.mint}`, why);
      done.push(`$${t.ticker} retired: ${why}`);
      this.log(`$${t.ticker} RETIRED — ${why} (no further readings)`);
    }
    for (const row of this.store.tournaments()) {
      const tt = JSON.parse(row.json) as Tournament;
      if (isoDate(this.d.now()) >= tournamentEnd(tt)) continue;
      const st = this.bracket(tt);
      if (st.current !== null) this.log(`bracket ${tt.id}: round ${st.current + 1} — ${st.rounds[st.current].matches.map((m) => `${tt.underlyings[m.a]?.symbol ?? "?"} v ${tt.underlyings[m.b]?.symbol ?? "?"} ${m.winsA}-${m.winsB}`).join(" · ")}`);
    }
    return done;
  }

  /** The reason recorded when a coin retired (pages). */
  retiredReason(mint: string): string | null { return this.d.registry.getStatus(`derby.retired.${mint}`); }

  /** Where a slot plays today (pages). */
  slotToday(t: Tournament, slot: number): ReturnType<typeof slotMatchOn> { return slotMatchOn(this.bracket(t), slot, isoDate(this.d.now())); }
}

/** A stored match-day window → the bracket's day result. */
export function matchDayOf(row: WindowRow | null): MatchDayResult {
  if (!row) return null;
  if (row.status === "withheld") return { status: "withheld", reason: row.reason ?? "withheld" };
  const doc = row.proof as { a?: { changePct?: string } | null; b?: { changePct?: string } | null } | null;
  return { status: "decided", winner: row.result === "yes" ? "a" : row.result === "no" ? "b" : "tie", changeA: doc?.a?.changePct ?? "0", changeB: doc?.b?.changePct ?? "0", eventId: row.eventId!, proofSha256: row.proofSha256 };
}
