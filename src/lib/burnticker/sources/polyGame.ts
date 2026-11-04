import type { BurnRule } from "@/lib/burnticker/rules";
import type { SettledEvent } from "@/lib/burnticker/units";
import { ourTeam, type EspnClient, type EspnTeam, type Game, type GameSide, type LeagueId } from "@/lib/burnticker/sources/espn";
import { isGameMoneyline } from "@/lib/burnticker/gameCoin";
import { GAME_CONFIRM_GAP_MS, POLY_LEAGUE_TAG, confirmingRead, gameKeyOf, gameSchedule, settleGame, type GameDeps, type GamePayout, type ScheduleRead } from "@/lib/burnticker/sources/gameSettle";

/**
 * A POLYMARKET-ORACLE COIN ON ONE GAME (owner, 2026-10-16: ONE burn schedule for every single-game coin; review of b3249737 item 4). A
 * one-market rule (`market`: a condition id) whose market is a sports game moneyline (Gamma sportsMarketType "moneyline", a game start,
 * two team outcomes) used to settle the moment its payout was on chain. It now runs on the game-coin schedule (gameSettle.ts gameSchedule):
 * the resolved payout is a read like any other, TheSportsDB and the league's feed are read for the same game and must agree, and the
 * reading is released once one of them has shown the same final on two reads at least five minutes apart (owner, 2026-10-18 evening:
 * the 12-hour wait is gone; owner, 2026-10-20: a second check five minutes later, even when two sources agree; gameSettle.ts
 * GAME_CONFIRM_GAP_MS). Recurring tag
 * and event series (every game of a team, a whole night) keep their own cadence, like team coins.
 *
 * A soccer yes/no leg of a game's three-way moneyline ("Will Coventry City FC win on 2026-10-12?", gameCoin.ts isGameMoneyline) is one
 * game too. Its outcomes are Yes and No, not two teams, so polyGameOf finds no game and its settlement on chain is the only read: it is
 * released once that settlement has been read the same way twice, GAME_CONFIRM_GAP_MS apart, on the same record.
 *
 * The keeper sets PolymarketClient.gameGate to polyGameGate(...) (scripts/burnticker-keeper.mts); without it (the web, a test) nothing
 * changes. A VOID payout (a split: a postponed or cancelled game) burns nothing; it too is released only when read void again
 * GAME_CONFIRM_GAP_MS or more after it was first read, and it never anchors a tie that a score read has not seen.
 */
export interface PolyGameMarket { conditionId: string; question: string; outcomes: string[]; sportsMarketType: string | null; gameStartTime?: string | null; eventSlug: string | null; tags: string[] }

export { isGameMoneyline } from "@/lib/burnticker/gameCoin";

/** The league a game market belongs to, from its event slug ("nfl-sea-den-2026-10-15") or its tags. */
export function leagueOfMarket(m: PolyGameMarket): LeagueId | null {
  for (const [lg, tag] of Object.entries(POLY_LEAGUE_TAG) as [LeagueId, string][]) if ((m.eventSlug ?? "").startsWith(`${tag}-`) || m.tags.includes(tag)) return lg;
  return null;
}
const side = (t: EspnTeam, homeAway: "home" | "away"): GameSide => ({ abbr: t.abbr, name: t.name, nickname: t.nickname, score: null, homeAway, record: null, ...(t.id ? { id: t.id } : {}) });
/**
 * The game a moneyline names, for the score reads: outcome 0 (the market's YES slot) is put on the away side and outcome 1 on the home
 * side. TheSportsDB's reader matches either way round (rowOrientation), so the winner is the same team whichever side Polymarket lists
 * first. Null when the league or either team is not in our team table.
 */
export function polyGameOf(m: PolyGameMarket): Game | null {
  const league = leagueOfMarket(m);
  if (!league || !m.gameStartTime) return null;
  const a = ourTeam(league, m.outcomes[0]), h = ourTeam(league, m.outcomes[1]);
  if (!a || !h || a.abbr === h.abbr) return null;
  const startsAt = m.gameStartTime;
  return { eventId: `poly-${m.conditionId}`, league, startsAt, date: startsAt.slice(0, 10), name: `${a.name} at ${h.name}`, completed: true, state: "post", detail: "Final", home: side(h, "home"), away: side(a, "away") };
}

export type GateVerdict = { release: true } | { release: false; why: string; dueAt: number | null; held: boolean };
export type PolyGameGate = (rule: BurnRule, m: PolyGameMarket, ev: SettledEvent) => Promise<GateVerdict>;

/** The keeper's gate over a game moneyline's settled event (see above). */
export function polyGameGate(o: { client: () => EspnClient; deps: () => GameDeps }): PolyGameGate {
  return async (rule, m, ev) => {
    if (!rule.market || !isGameMoneyline(m)) return { release: true };
    const d = o.deps(), store = d.firstReads ?? null, now = (d.now ?? Date.now)();
    if (!store) return { release: false, why: "a game market's result is released once it has been read twice, and this process keeps no record of the first read", dueAt: null, held: false };
    const g = polyGameOf(m);
    const key = g ?? { league: "polymarket" as LeagueId, eventId: m.conditionId, startsAt: m.gameStartTime ?? "" };
    if (ev.result === "void") {
      // nothing burns on a void; it is released when read void again GAME_CONFIRM_GAP_MS or more after its first read (the record's
      // anchor; a void on chain does not change), never anchoring a tie for the score reads
      const k = `${key.league}:${key.eventId}:void`, mk = store.get(k), why = "the game's market settled void; it is released once that is read again at least five minutes later";
      if (!mk) { store.set(k, { firstReadAt: now, by: "on-chain payout", winner: "tie", home: null, away: null, ops: ["on-chain payout"] }); return { release: false, why, dueAt: now + GAME_CONFIRM_GAP_MS, held: false }; }
      if (now < mk.firstReadAt + GAME_CONFIRM_GAP_MS) return { release: false, why, dueAt: mk.firstReadAt + GAME_CONFIRM_GAP_MS, held: false };
      // 2026-10-18 review: the confirming read goes to the RPC again (the client caches a resolved vector for good)
      const again = d.payout ? await d.payout(m.conditionId, { fresh: true }).catch(() => null) : { resolved: true, outcome: null };
      if (again && again.resolved && again.outcome === null) return { release: true };
      store.set(k, { ...mk, firstReadAt: now });
      return { release: false, why: again ? "the game's market read void once and then read otherwise, so it is read again" : "the game's market read void once, and the second read of it failed; it is read again", dueAt: now + GAME_CONFIRM_GAP_MS, held: false };
    }
    const want: "home" | "away" = ev.result === "yes" ? "away" : "home";   // outcome 0 (YES) is the away side in polyGameOf
    // 2026-10-18 review: the payout's confirming read goes to the RPC again (a resolved vector is otherwise cached for good)
    const sideOf = (p: GamePayout | null): "home" | "away" | "tie" | null => (!p || !p.resolved ? null : p.outcome === 0 ? "away" : p.outcome === 1 ? "home" : "tie");
    if (!g) {
      // a league or team our table does not know: the payout alone, on the same rule (read the same way twice)
      let read: ScheduleRead | null = { op: "on-chain payout", winner: want, final: null, detail: ev.method ?? "on-chain payout", url: ev.sourceUrl ?? "" };
      if (d.payout && confirmingRead(store.get(gameKeyOf(key)), "on-chain payout", now)) {
        const p = await d.payout(m.conditionId, { fresh: true }).catch(() => null), side = sideOf(p);
        read = side ? { ...read, winner: side, ...(p?.fetchedAt !== undefined ? { fetchedAt: p.fetchedAt } : {}) } : null;
      }
      const h = gameSchedule(store, key, read ? [read] : [], now);
      return h.kind === "ready" ? { release: true } : h.kind === "held" ? { release: false, why: h.why, dueAt: null, held: true } : { release: false, why: h.why, dueAt: h.dueAt, held: false };
    }
    const v = await settleGame(o.client(), g, { ...d, market: async () => ({ conditionId: m.conditionId, question: m.question, outcomes: [m.outcomes[0], m.outcomes[1]], url: ev.sourceUrl ?? "" }), payout: async (_id, po) => (po?.fresh && d.payout ? d.payout(m.conditionId, po) : { resolved: true, outcome: ev.result === "yes" ? 0 : 1 }) }, { schedule: "game" });
    if (v.kind === "awaiting") return { release: false, why: v.why, dueAt: v.dueAt ?? null, held: false };
    if (v.kind === "held") return { release: false, why: v.why, dueAt: null, held: true };
    if (v.winner !== want) return { release: false, why: `the game's market says ${want === "away" ? m.outcomes[0] : m.outcomes[1]} won ≠ the game's reads say ${v.winner === "tie" ? "a tie" : v.winner === "away" ? m.outcomes[0] : m.outcomes[1]} — held`, dueAt: null, held: true };
    return { release: true };
  };
}
