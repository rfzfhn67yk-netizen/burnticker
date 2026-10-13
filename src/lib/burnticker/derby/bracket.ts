import { DEFAULT_ON_END, RULE_BOUNDS } from "@/lib/burnticker/rules";
import { addDays, canonical, DERBY_BRACKET_SIZES, DERBY_ROUND_DAYS, derbySpecProblems, TOURNAMENT_ID_RE, underlyingKey, type DerbyUnderlying } from "@/lib/burnticker/derby/spec";
import { cmpDec, mulDec, subDec } from "@/lib/burnticker/derby/measure";
import { fromScaled, toScaled } from "@/lib/burnticker/units";

/**
 * BURN DERBY BRACKET (2026-10-10). A tournament = N underlyings (8 or 16, in bracket order: slot 2k meets slot 2k+1 in round one), a
 * start date and a round length (default 7 days). Every UTC day of a round each live match is one derby window (daily % change, Pyth,
 * cross-read like any derby); a match day's winner is that coin's fan coin's burn day. At a round's end the coin with more winning days
 * advances (tiebreak: the larger compounded % change over the round, then the lower slot); the loser's fan coin RETIRES — it reads
 * nothing more and its page says so. The final's winning days burn TWO units (the program compounds them: pool × (1 − (1 − f)²)),
 * capped so 2 × f never exceeds the rules' 10% maximum (above it the final pays one unit). Scheduling is the keeper's planning pass:
 * this module is the pure bracket arithmetic over recorded match days; nothing on chain changes.
 *
 * Locked by hash: the tournament's canonical JSON (keys sorted) → sha256; every fan coin's rule carries { tournamentId, tournamentSha,
 * slot, underlying }, so the bracket cannot change after the first coin launches.
 */

export const TOURNAMENT_SCHEMA = "burnticker.derby-bracket/v1";

export interface Tournament {
  schema: typeof TOURNAMENT_SCHEMA;
  id: string;
  title: string;
  /** Bracket order (seed slots 0…N−1). */
  underlyings: DerbyUnderlying[];
  /** Round one starts at 00:00 UTC on this date. */
  start: string;
  roundDays: number;
  /** Each fan coin's fraction of its burn pool per winning day (one unit). */
  fractionOfPool: number;
}

export function tournamentProblems(raw: unknown): string[] {
  const p: string[] = [];
  const t = raw as Partial<Tournament> | null;
  if (!t || typeof t !== "object") return ["tournament must be an object"];
  if (t.schema !== TOURNAMENT_SCHEMA) p.push(`schema must be "${TOURNAMENT_SCHEMA}"`);
  if (typeof t.id !== "string" || !TOURNAMENT_ID_RE.test(t.id)) p.push("id must be 3–32 lowercase letters/digits/dashes");
  if (typeof t.title !== "string" || !t.title.trim() || t.title.length > 80) p.push("title must be 1–80 characters");
  if (!Array.isArray(t.underlyings) || !(DERBY_BRACKET_SIZES as readonly number[]).includes(t.underlyings.length)) p.push(`underlyings must list ${DERBY_BRACKET_SIZES.join(" or ")} coins`);
  else {
    t.underlyings.forEach((u, i) => {
      // reuse the derby block's underlying checks through a one-coin bracket spec
      for (const x of derbySpecProblems({ selector: "bracket", tournamentId: "probe", tournamentSha: "0".repeat(64), slot: 0, underlying: u })) p.push(`underlyings[${i}]: ${x.replace(/^derby\.underlying\.?/, "")}`);
    });
    const keys = t.underlyings.map((u) => (u && typeof u === "object" ? underlyingKey(u) : String(u)));
    if (new Set(keys).size !== keys.length) p.push("underlyings must be distinct coins");
    const syms = t.underlyings.map((u) => u?.symbol);
    if (new Set(syms).size !== syms.length) p.push("underlyings need distinct symbols");
  }
  if (typeof t.start !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(t.start) || new Date(`${t.start}T00:00:00Z`).toISOString().slice(0, 10) !== t.start) p.push("start must be a YYYY-MM-DD date");
  if (!Number.isInteger(t.roundDays) || (t.roundDays as number) < DERBY_ROUND_DAYS.min || (t.roundDays as number) > DERBY_ROUND_DAYS.max) p.push(`roundDays must be ${DERBY_ROUND_DAYS.min}–${DERBY_ROUND_DAYS.max}`);
  const f = t.fractionOfPool;
  if (typeof f !== "number" || f < RULE_BOUNDS.fractionOfPool.min || f > RULE_BOUNDS.fractionOfPool.max || Math.round(f * 1e4) !== f * 1e4) p.push(`fractionOfPool must be ${RULE_BOUNDS.fractionOfPool.min}–${RULE_BOUNDS.fractionOfPool.max} in whole basis points`);
  for (const k of Object.keys(t)) if (!["schema", "id", "title", "underlyings", "start", "roundDays", "fractionOfPool"].includes(k)) p.push(`${k} is not a known key`);
  return p;
}

/** Validates and locks: the canonical JSON and its sha256 (sha256Hex injected: the keeper's rulesSha256). */
export function lockTournament(raw: unknown, sha256Hex: (s: string) => string): { tournament: Tournament; json: string; sha256: string } {
  const p = tournamentProblems(raw);
  if (p.length) throw new Error(`tournament: ${p.join("; ")}`);
  const json = canonical(raw);
  return { tournament: JSON.parse(json) as Tournament, json, sha256: sha256Hex(json) };
}

export const roundCount = (t: Pick<Tournament, "underlyings">): number => Math.log2(t.underlyings.length);
/** Units a winning day burns: 1, or 2 in the final while 2 × f stays within the rules' maximum. */
// a final counts double while twice the share stays within 10 % (the bound when brackets were defined; kept when the recurring cap rose to 25 %,
// so a bracket registered before keeps its finals)
export const BRACKET_FINAL_MAX = 0.1;
export const finalUnits = (f: number): number => (Math.round(f * 2 * 1e6) <= Math.round(BRACKET_FINAL_MAX * 1e6) ? 2 : 1);
export const roundDates = (t: Pick<Tournament, "start" | "roundDays">, r: number): string[] => Array.from({ length: t.roundDays }, (_, i) => addDays(t.start, r * t.roundDays + i));
export const tournamentEnd = (t: Tournament): string => addDays(t.start, roundCount(t) * t.roundDays);
/** The derby_windows key a match's days are decided under (shared by both slots, so both fan coins see the same decision). */
export const matchKey = (tournamentId: string, round: number, match: number): string => `derby:bracketmatch:${tournamentId}:r${round}m${match}`;
export const slotSelectorKey = (tournamentId: string, slot: number): string => `derby:bracket:${tournamentId}:${slot}`;

export type MatchDayResult = { status: "decided"; winner: "a" | "b" | "tie"; changeA: string; changeB: string; eventId: string; proofSha256: string | null } | { status: "withheld"; reason: string } | null;

export interface MatchState {
  round: number; index: number; a: number; b: number; final: boolean; key: string;
  days: { date: string; result: MatchDayResult }[];
  winsA: number; winsB: number; ties: number; withheld: number;
  /** Compounded % change over the round's decided days (6 decimals), the tiebreak. */
  cumA: string; cumB: string;
  /** The advancing slot once every day of the round is decided or withheld; null while the round runs. */
  winner: number | null; loser: number | null; tiebreak: "wins" | "cumulative" | "lower-slot" | null;
}
export interface RoundState { index: number; start: string; end: string; final: boolean; matches: MatchState[] }
export interface BracketState { rounds: RoundState[]; champion: number | null; eliminatedIn: Map<number, number>; alive: number[]; current: number | null }

const SC = 18;
/** Π(1 + c/100) − 1, in % with 6 decimals (truncated at each step to 18 places). */
export function compound(changes: readonly string[]): string {
  let acc = BigInt(10) ** BigInt(SC);
  for (const c of changes) {
    const f = toScaled(subDec("100", subDec("0", c)), 6) * BigInt(10) ** BigInt(SC - 6) / BigInt(100);   // (100 + c) / 100 at SC
    acc = (acc * f) / BigInt(10) ** BigInt(SC);
  }
  return fromScaled(((acc - BigInt(10) ** BigInt(SC)) * BigInt(100)) / BigInt(10) ** BigInt(SC - 6), 6);
}

/**
 * The whole bracket from recorded match days. `dayResult(round, match, slotA, slotB, date)` returns the recorded decision of that match
 * day (or null while the day is open / not yet read). A match's slots exist only once both feeder matches have winners.
 */
export function bracketState(t: Tournament, dayResult: (round: number, match: number, a: number, b: number, date: string) => MatchDayResult): BracketState {
  const R = roundCount(t);
  const rounds: RoundState[] = [];
  const eliminatedIn = new Map<number, number>();
  let entrants: (number | null)[] = t.underlyings.map((_, i) => i);
  let current: number | null = null;
  for (let r = 0; r < R; r++) {
    const dates = roundDates(t, r);
    const matches: MatchState[] = [];
    const next: (number | null)[] = [];
    for (let m = 0; m < entrants.length / 2; m++) {
      const a = entrants[2 * m], b = entrants[2 * m + 1];
      const st: MatchState = { round: r, index: m, a: a ?? -1, b: b ?? -1, final: r === R - 1, key: matchKey(t.id, r, m), days: [], winsA: 0, winsB: 0, ties: 0, withheld: 0, cumA: "0", cumB: "0", winner: null, loser: null, tiebreak: null };
      if (a === null || b === null) { matches.push(st); next.push(null); continue; }
      const chA: string[] = [], chB: string[] = [];
      let open = 0;
      for (const date of dates) {
        const res = dayResult(r, m, a, b, date);
        st.days.push({ date, result: res });
        if (!res) { open++; continue; }
        if (res.status === "withheld") { st.withheld++; continue; }
        chA.push(res.changeA); chB.push(res.changeB);
        if (res.winner === "a") st.winsA++; else if (res.winner === "b") st.winsB++; else st.ties++;
      }
      st.cumA = compound(chA); st.cumB = compound(chB);
      if (open === 0) {
        if (st.winsA !== st.winsB) { st.winner = st.winsA > st.winsB ? a : b; st.tiebreak = "wins"; }
        else if (cmpDec(st.cumA, st.cumB) !== 0) { st.winner = cmpDec(st.cumA, st.cumB) > 0 ? a : b; st.tiebreak = "cumulative"; }
        else { st.winner = Math.min(a, b); st.tiebreak = "lower-slot"; }
        st.loser = st.winner === a ? b : a;
        eliminatedIn.set(st.loser, r);
      } else if (current === null) current = r;
      matches.push(st); next.push(st.winner);
    }
    rounds.push({ index: r, start: dates[0], end: addDays(dates[dates.length - 1], 1), final: r === R - 1, matches });
    entrants = next;
  }
  const champion = rounds[R - 1]?.matches[0]?.winner ?? null;
  const alive = t.underlyings.map((_, i) => i).filter((i) => !eliminatedIn.has(i));
  return { rounds, champion, eliminatedIn, alive, current };
}

/** Where a slot plays on `date` (its match, side and whether it is the final), or null (eliminated, not yet seeded, or no match that day). */
export function slotMatchOn(state: BracketState, slot: number, date: string): { round: number; match: MatchState; side: "a" | "b" } | null {
  for (const r of state.rounds) for (const m of r.matches) {
    if (m.a !== slot && m.b !== slot) continue;
    if (m.days.some((d) => d.date === date)) return { round: r.index, match: m, side: m.a === slot ? "a" : "b" };
  }
  return null;
}

/** A slot's points for a decided day: units for a win, "0" for a loss, null (void) for a tie. */
export function slotPoints(res: Extract<MatchDayResult, { status: "decided" }>, side: "a" | "b", final: boolean, f: number): string | null {
  if (res.winner === "tie") return null;
  return res.winner === side ? String(final ? finalUnits(f) : 1) : "0";
}

/** The fan coin's bracket rule fraction doubled in words (display): "2 units (≈ 1.99%)". */
export const finalBurnText = (f: number): string => { const u = finalUnits(f); const share = 1 - (1 - f) ** u; return u === 2 ? `2 units (${(share * 100).toFixed(2)}% of the pool)` : `1 unit, because 2 × ${(f * 100).toFixed(2)}% would pass the 10% maximum`; };

export { mulDec };

/**
 * A fan coin's rule for slot `slot` of a locked tournament: scalar points (1 per winning day, 2 in the final while 2 × f fits the
 * rules' maximum, 0 for a loss; a tie is a void), fixed baseline 0, one unit = the tournament's fraction of the burn pool. The fan coin
 * launches through the normal launch pipeline (prepareLaunch → admission + the creation preflight), so every gate applies.
 */
export function bracketFanRule(t: Tournament, tournamentSha: string, slot: number): import("@/lib/burnticker/rules").BurnRule {
  const u = t.underlyings[slot];
  if (!u) throw new Error(`tournament ${t.id} has no slot ${slot}`);
  return {
    schema: "burnticker.rules/v1", oracle: "derby", series: `bracket:${t.id}:${slot}`, market: null, filter: {}, kind: "scalar", binary: null,
    scalar: { unit: 1, perUnit: { fractionOfPool: t.fractionOfPool }, baseline: 0, direction: "up" }, pair: null, onVoid: "skip", floorUsd: "1", reserveSol: "0.02", vault: null,
    // a knocked-out fan coin's pool winds down (no burn pool is ever left behind)
    onEnd: { ...DEFAULT_ON_END },
    derby: { selector: "bracket", tournamentId: t.id, tournamentSha, slot, underlying: u },
  };
}

/** Registers a tournament in the registry's derby store (locked by hash; the same id with a different bracket is refused). */
export function registerTournament(store: { putTournament(t: { id: string; json: string; sha256: string }, now?: number): { id: string; sha256: string } }, raw: unknown, sha256Hex: (s: string) => string, now = Date.now()): { tournament: Tournament; sha256: string } {
  const locked = lockTournament(raw, sha256Hex);
  const row = store.putTournament({ id: locked.tournament.id, json: locked.json, sha256: locked.sha256 }, now);
  return { tournament: locked.tournament, sha256: row.sha256 };
}
