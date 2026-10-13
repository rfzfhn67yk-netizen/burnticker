import type { PairRow, Registry, TokenRow } from "@/lib/burnticker/registry";
import type { ReceiptJson } from "@/lib/burnticker/pageTypes";
import { addDays, isoDate, seasonEndMs, seasonWindows, type CoinVsSpec, type DerbySpec, type PriceSpec } from "@/lib/burnticker/derby/spec";
import { derbyStore, type DerbyStore, type WindowRow } from "@/lib/burnticker/derby/store";
import { bracketState, finalBurnText, finalUnits, matchKey, roundCount, slotSelectorKey, tournamentEnd, type Tournament } from "@/lib/burnticker/derby/bracket";
import { matchDayOf } from "@/lib/burnticker/derby/adapter";
import { pythFeedAccount } from "@/lib/burnticker/derby/pyth";

/**
 * BURN DERBY ON THE PAGES (2026-10-10). Pure over the registry and the derby store:
 *   derbyPairJson        the pair page's additions — the running score (a receipt tally: A's burn days : B's, ties, withheld), the
 *                        day-by-day strip with both readings, the season end date, and the proof links of every window (the Hermes
 *                        update URL and its sha256, Pyth's Solana account and slot, or the pool and its sample slots).
 *   derbyTournamentJson  the bracket page — rounds, matches, each match's day strip, who advanced and why, retired fan coins, the final's
 *                        doubled burn, the champion.
 */

export interface ProofLink { label: string; url: string | null; detail: string }
export interface DerbySideReading { symbol: string; changePct: string | null; start: string | null; end: string | null; source: string | null }
export interface DerbyDayJson {
  day: number; windowId: string; at: string; status: "decided" | "withheld";
  /** A = side A's coin won (it burns), B = side B's, tie = void; null for a withheld window or a single-asset reading. */
  winner: "A" | "B" | "tie" | null;
  a: DerbySideReading; b: DerbySideReading | null;
  margin: string | null; crossMargin: string | null; reason: string | null; eventId: string | null; proofSha256: string | null; proof: ProofLink[];
  receipts: { a: { status: string; burned: string | null; signature: string | null; txUrl: string | null } | null; b: { status: string; burned: string | null; signature: string | null; txUrl: string | null } | null };
}
export interface DerbyPairJson {
  pairId: string; selector: "coinvs" | "price"; series: string; window: string; measure: string; flip: boolean;
  symbols: { a: string; b: string | null };
  season: { start: string; days: number; endsOn: string; over: boolean; windows: number; windowsDone: number };
  score: { a: number; b: number; ties: number; withheld: number; dayNumber: number };
  /** Winner takes the burn (2026-10-11): the fuel each side's lost windows moved to the other side's burn pool (SOL, from the forwarded receipts). */
  forwarded: { aToB: string; bToA: string; windows: number };
  days: DerbyDayJson[];
  retired: { a: string | null; b: string | null };
  note: string;
}

/** Why a coin retired: the derby pass's note (rules without onEnd) or the keeper's end-of-rule record (after the wind-down). */
export function retiredReasonOf(reg: Pick<Registry, "getStatus">, mint: string): string | null {
  const d = reg.getStatus(`derby.retired.${mint}`);
  if (d) return d;
  const r = reg.getStatus(`rule.retired.${mint}`);
  if (!r) return null;
  try { const j = JSON.parse(r) as { reason?: string; mode?: string }; return `${j.reason ?? "ended"}, and then ${j.mode === "drain" ? "the pool drained" : "the pool wound down"}`; } catch { return r; }
}

const short = (h: string | null | undefined) => (h ? `${h.slice(0, 12)}…` : "—");

/** The links a stranger follows to re-read one window's values. */
export function proofLinks(row: WindowRow): ProofLink[] {
  const out: ProofLink[] = [];
  const doc = row.proof as { a?: { symbol?: string; proof?: { start?: Record<string, unknown>; end?: Record<string, unknown> } } | null; b?: { symbol?: string; proof?: { start?: Record<string, unknown>; end?: Record<string, unknown> } } | null } | null;
  for (const side of [doc?.a, doc?.b]) {
    if (!side?.proof) continue;
    for (const [which, p] of [["start", side.proof.start], ["end", side.proof.end]] as const) {
      if (!p) continue;
      const sym = side.symbol ?? "?";
      if (p.route === "hermes" || p.source === "pyth") out.push({ label: `${sym} ${which}: Pyth update`, url: String(p.url ?? ""), detail: `published ${p.publishTime}, update sha256 ${short(String(p.updateSha256 ?? ""))}` });
      else if (p.route === "pyth-solana" || p.source === "pyth-solana") out.push({ label: `${sym} ${which}: Pyth account on Solana`, url: `https://solscan.io/account/${p.account ?? pythFeedAccount(String(p.feed))}`, detail: `slot ${p.slot ?? "?"}, published ${p.publishTime}, account sha256 ${short(String(p.accountSha256 ?? ""))}` });
      else if (p.source === "twap") out.push({ label: `${sym} ${which}: pool TWAP`, url: `https://solscan.io/account/${p.pool}`, detail: `${Array.isArray(p.samples) ? p.samples.length : 0} vault samples, slots ${Array.isArray(p.samples) ? (p.samples as { slot: number | null }[]).map((x) => x.slot).filter(Boolean).slice(0, 3).join(", ") : "—"}…` });
    }
  }
  if (row.proofSha256) out.push({ label: "proof document", url: null, detail: `sha256 ${row.proofSha256}. The same hash is in the reading (as derby:sha256:…) and in the signed attestation (as proof=).` });
  return out;
}

type RJ = Pick<ReceiptJson, "eventId" | "status" | "burned" | "signature" | "txUrl" | "units"> & Partial<Pick<ReceiptJson, "spent">>;
const rcpt = (r: RJ | undefined) => (r ? { status: r.status, burned: r.burned, signature: r.signature, txUrl: r.txUrl } : null);

/** The derby block of a pair page; null when the pair is not a derby pair. */
export function derbyPairJson(reg: Pick<Registry, "token" | "lockedRule" | "getStatus" | "db">, pair: PairRow, receiptsA: readonly RJ[], receiptsB: readonly RJ[], now = Date.now(), store: DerbyStore = derbyStore(reg.db)): DerbyPairJson | null {
  const ta = reg.token(pair.mintA), tb = reg.token(pair.mintB);
  if (!ta || !tb) return null;
  const d = reg.lockedRule(ta).rule.derby;
  if (!d || d.selector === "bracket" || d.selector === "high") return null;
  const rows = store.windows(pair.selectorKey);
  const inSeason = (r: WindowRow) => { const at = Date.parse(r.at); return at >= Date.parse(`${d.season.start}T00:00:00Z`) && at < seasonEndMs(d); };
  const ra = new Map(receiptsA.map((r) => [r.eventId, r])), rb = new Map(receiptsB.map((r) => [r.eventId, r]));
  const windows = seasonWindows(d);
  const days: DerbyDayJson[] = rows.filter(inSeason).filter((r) => r.status === "decided" || !r.reason?.startsWith("noflip")).map((r) => {
    const doc = r.proof as { a?: { symbol?: string; changePct?: string; start?: string; end?: string; source?: string } | null; b?: { symbol?: string; changePct?: string; start?: string; end?: string; source?: string } | null; decision?: { margin?: string | null; crossMargin?: string | null } } | null;
    const day = windows.findIndex((w) => w.id === r.windowId) + 1;
    const a = rcpt(r.eventId ? ra.get(r.eventId) : undefined), b = rcpt(r.eventId ? rb.get(r.eventId) : undefined);
    const winner: DerbyDayJson["winner"] = r.status !== "decided" || d.selector === "price" ? null : r.result === "yes" ? "A" : r.result === "no" ? "B" : "tie";
    return {
      day, windowId: r.windowId, at: r.at, status: r.status, winner,
      a: { symbol: d.selector === "coinvs" ? d.a.symbol : d.u.symbol, changePct: doc?.a?.changePct ?? null, start: doc?.a?.start ?? null, end: doc?.a?.end ?? null, source: doc?.a?.source ?? null },
      b: d.selector === "coinvs" ? { symbol: d.b.symbol, changePct: doc?.b?.changePct ?? null, start: doc?.b?.start ?? null, end: doc?.b?.end ?? null, source: doc?.b?.source ?? null } : null,
      margin: doc?.decision?.margin ?? null, crossMargin: doc?.decision?.crossMargin ?? null, reason: r.reason, eventId: r.eventId, proofSha256: r.proofSha256, proof: proofLinks(r), receipts: { a, b },
    };
  });
  // The running score is the receipts' tally: a burn day per side (a receipt with units), ties (void receipts), withheld windows.
  // a forwarded receipt is a LOST window (its fuel moved to the winner) — not a burn day for that side
  const burnDay = (r: RJ | undefined) => !!r && r.units > 0 && r.status !== "voided" && r.status !== "pending-pair" && r.status !== "forwarded";
  const fwdSum = (m: Map<string, RJ>) => { let l = 0, n = 0; for (const r of m.values()) if (r.status === "forwarded") { n++; l += Math.round(Number(r.spent ?? "0") * 1e9); } return { sol: (l / 1e9).toString(), n }; };
  const fa = fwdSum(ra), fb = fwdSum(rb);
  const score = { a: days.filter((x) => x.eventId && burnDay(ra.get(x.eventId))).length, b: days.filter((x) => x.eventId && burnDay(rb.get(x.eventId))).length, ties: days.filter((x) => x.winner === "tie").length, withheld: days.filter((x) => x.status === "withheld").length, dayNumber: Math.max(0, ...days.map((x) => x.day)) };
  const endsOn = addDays(d.season.start, d.season.days);
  return {
    pairId: pair.pairId, selector: d.selector, series: pair.selectorKey.replace(/^derby:/, ""), window: d.window, measure: d.selector === "coinvs" ? d.measure : "pct", flip: d.selector === "coinvs" && d.flip,
    symbols: { a: d.selector === "coinvs" ? d.a.symbol : d.u.symbol, b: d.selector === "coinvs" ? d.b.symbol : null },
    season: { start: d.season.start, days: d.season.days, endsOn, over: now >= seasonEndMs(d), windows: windows.length, windowsDone: days.length },
    score, forwarded: { aToB: fa.sol, bToA: fb.sol, windows: fa.n + fb.n }, days: days.sort((x, y) => (x.at < y.at ? -1 : 1)),
    retired: { a: ta.status === "retired" ? retiredReasonOf(reg, ta.mint) ?? "retired" : null, b: tb.status === "retired" ? retiredReasonOf(reg, tb.mint) ?? "retired" : null },
    note: d.selector === "coinvs" && d.flip ? `$${ta.ticker} burns once on the first window ${d.a.symbol} passes ${d.b.symbol}, and $${tb.ticker} once if the run ends without it; ${d.a.symbol} and ${d.b.symbol} are only read, never traded or burned; a withheld window (the cross-read disagreed or a value was missing) settles nothing` : d.selector === "coinvs" ? `$${ta.ticker} burns on a window ${d.a.symbol} wins and $${tb.ticker} on a window ${d.b.symbol} wins, each taking the other new coin's share for that window; ${d.a.symbol} and ${d.b.symbol} are only read, never traded or burned; a tie burns neither (a void receipt still posts); a withheld window (the cross-read disagreed or a value was missing) burns nothing` : "each side counts its own direction of the move; a withheld window burns nothing",
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The bracket page
// ---------------------------------------------------------------------------------------------------------------------------------

export interface BracketMatchJson {
  round: number; index: number; final: boolean;
  a: { slot: number; symbol: string; ticker: string | null; status: string | null } | null;
  b: { slot: number; symbol: string; ticker: string | null; status: string | null } | null;
  winsA: number; winsB: number; ties: number; withheld: number; cumA: string; cumB: string;
  winner: number | null; tiebreak: string | null;
  days: { date: string; result: "A" | "B" | "tie" | "withheld" | "open"; changeA: string | null; changeB: string | null }[];
}
export interface DerbyTournamentJson {
  id: string; title: string; sha256: string; size: number; start: string; end: string; roundDays: number; fractionOfPool: number; finalBurn: string; finalUnits: number;
  status: "upcoming" | "running" | "complete"; currentRound: number | null; champion: { slot: number; symbol: string; ticker: string | null } | null;
  rounds: { index: number; start: string; end: string; final: boolean; matches: BracketMatchJson[] }[];
  coins: { slot: number; symbol: string; ticker: string | null; mint: string | null; status: string | null; retiredReason: string | null; eliminatedInRound: number | null }[];
}

/** Every fan coin of a tournament by slot (the newest non-expired token on each slot's selector key). */
export function fanCoins(tokens: readonly TokenRow[], tournamentId: string): Map<number, TokenRow> {
  const out = new Map<number, TokenRow>();
  for (const t of tokens) {
    const m = /^derby:bracket:([a-z0-9-]+):(\d+)$/.exec(t.selectorKey);
    if (!m || m[1] !== tournamentId || t.status === "expired") continue;
    out.set(Number(m[2]), t);
  }
  return out;
}

export function derbyTournamentJson(reg: Pick<Registry, "tokens" | "getStatus" | "db">, t: Tournament, sha256: string, now = Date.now(), store: DerbyStore = derbyStore(reg.db)): DerbyTournamentJson {
  const state = bracketState(t, (r, m, _a, _b, date) => matchDayOf(store.window(matchKey(t.id, r, m), date)));
  const coins = fanCoins(reg.tokens(), t.id);
  const side = (slot: number) => (slot < 0 ? null : { slot, symbol: t.underlyings[slot].symbol, ticker: coins.get(slot)?.ticker ?? null, status: coins.get(slot)?.status ?? null });
  const today = isoDate(now);
  const end = tournamentEnd(t);
  return {
    id: t.id, title: t.title, sha256, size: t.underlyings.length, start: t.start, end, roundDays: t.roundDays, fractionOfPool: t.fractionOfPool, finalBurn: finalBurnText(t.fractionOfPool), finalUnits: finalUnits(t.fractionOfPool),
    status: today < t.start ? "upcoming" : state.champion !== null ? "complete" : "running", currentRound: state.current,
    champion: state.champion !== null ? { slot: state.champion, symbol: t.underlyings[state.champion].symbol, ticker: coins.get(state.champion)?.ticker ?? null } : null,
    rounds: state.rounds.map((r) => ({ index: r.index, start: r.start, end: r.end, final: r.final, matches: r.matches.map((m) => ({
      round: r.index, index: m.index, final: m.final, a: side(m.a), b: side(m.b), winsA: m.winsA, winsB: m.winsB, ties: m.ties, withheld: m.withheld, cumA: m.cumA, cumB: m.cumB, winner: m.winner, tiebreak: m.tiebreak,
      days: m.days.map((x) => ({ date: x.date, result: !x.result ? "open" as const : x.result.status === "withheld" ? "withheld" as const : x.result.winner === "a" ? "A" as const : x.result.winner === "b" ? "B" as const : "tie" as const, changeA: x.result?.status === "decided" ? x.result.changeA : null, changeB: x.result?.status === "decided" ? x.result.changeB : null })),
    })) })),
    coins: t.underlyings.map((u, slot) => { const c = coins.get(slot) ?? null; return { slot, symbol: u.symbol, ticker: c?.ticker ?? null, mint: c?.mint ?? null, status: c?.status ?? null, retiredReason: c && c.status === "retired" ? retiredReasonOf(reg, c.mint) : null, eliminatedInRound: state.eliminatedIn.has(slot) ? state.eliminatedIn.get(slot)! + 1 : null }; }),
  };
}

/** The tournaments list for GET /v1/derby. */
export function tournamentSummaries(reg: Pick<Registry, "tokens" | "getStatus" | "db">, now = Date.now(), store: DerbyStore = derbyStore(reg.db)): Pick<DerbyTournamentJson, "id" | "title" | "size" | "start" | "end" | "roundDays" | "status" | "currentRound" | "champion">[] {
  return store.tournaments().map((row) => { const j = derbyTournamentJson(reg, JSON.parse(row.json) as Tournament, row.sha256, now, store); return { id: j.id, title: j.title, size: j.size, start: j.start, end: j.end, roundDays: j.roundDays, status: j.status, currentRound: j.currentRound, champion: j.champion }; });
}

export const isDerbySpec = (d: DerbySpec | undefined): d is CoinVsSpec | PriceSpec => !!d && d.selector !== "bracket" && d.selector !== "high";
export { roundCount, slotSelectorKey };
