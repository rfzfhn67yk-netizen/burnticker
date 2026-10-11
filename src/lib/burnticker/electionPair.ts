import type { BurnRule } from "@/lib/burnticker/rules";
import { BURNTICKER_RULES_SCHEMA } from "@/lib/burnticker/rules";
import type { Race, RaceOutcome } from "@/lib/burnticker/elections";
import { fecSeries } from "@/lib/burnticker/sources/fec";
import { nativeRule } from "@/lib/burnticker/sources/native";
import { defaultVoidBy } from "@/lib/burnticker/launchBundle";

/**
 * THE ELECTION-PAIR TEMPLATE (owner-approved 2026-10-10): candidate A vs candidate B for one race → two coins, one per candidate, each
 * with two components applied symmetrically:
 *
 *   FEC beats   fec.beats:<own>-<other>  burns 1 % on each FEC reporting period in which the coin's own candidate reports more receipts
 *   winner      the race outcome's Polymarket market (one-shot)  burns 10 % when the coin's candidate wins, settled on the Conditional
 *               Tokens payout on Polygon; the state's certified result is the published cross-read (config/burnticker/sos.json)
 *
 * TWO GATES ARE NOT IN CORE YET, and the template says so instead of pretending:
 *   · composite rules — one coin with two selectors. The rules core locks ONE selector per coin, so `launchable` covers the winner
 *     component only; the FEC component is carried, hashed and shown, and launches with the composite core.
 *   · the FEC component's cross-read is the FEC's own filings endpoint (same operator); the settlement-coverage gate refuses a
 *     same-operator cross-read, so its preflight fails until the gate admits government primaries with a second publication channel
 *     (proposal: docs/burnticker/ui-conventions.md § FEC).
 *   · the pair's "both or neither" void clause is in the pairs core (rules.ts PairField, 2026-10-10): `voidClause.voidBy` = the race's
 *     settlement date (a one-shot's first settlement), passed to buildPairBundles so both sides' rules.json lock it; readings before both
 *     pools register wait as pending-pair; a void ends the rule and both pools wind down over 28 days (rules.ts onEnd).
 */

export interface ElectionPairSide {
  outcome: RaceOutcome; candidate: string; fecCandidateId: string | null; name: string; ticker: string;
  components: { fecBeats: BurnRule | null; winner: BurnRule };
  sentences: { fecBeats: string | null; winner: string };
}
export interface ElectionPair {
  race: { slug: string; title: string; settlesOn: string | null; state: string | null };
  a: ElectionPairSide; b: ElectionPairSide;
  crossRead: { name: string; url: string };
  voidClause: { kind: "both-or-neither"; voidBy: string | null; pendingPair: boolean; fallbackClock: "wind-down-28d"; status: string };
  launchable: { component: "winner"; why: string };
  pending: string[];
}

const candidateOf = (o: RaceOutcome) => o.label.replace(/\s*\([A-Z]\)$/, "").trim();
const surnameOf = (o: RaceOutcome) => candidateOf(o).split(/\s+/).pop() ?? candidateOf(o);
const tickerOf = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
const winnerRule = (conditionId: string, fraction: number): BurnRule => ({ schema: BURNTICKER_RULES_SCHEMA, oracle: "polymarket", series: null, market: conditionId, filter: {}, kind: "binary", binary: { onYes: { fractionOfPool: fraction }, onNo: null }, scalar: null, onVoid: "skip", floorUsd: "1", reserveSol: "0.02", vault: null } as BurnRule);
const pct = (f: number) => `${Math.round(f * 1000) / 10}%`;

export function electionPairTemplate(race: Race, a: RaceOutcome, b: RaceOutcome, fec: { a: string | null; b: string | null }, o: { winnerFraction?: number; fecFraction?: number } = {}): ElectionPair {
  const wf = o.winnerFraction ?? 0.10, ff = o.fecFraction ?? 0.01;
  const side = (me: RaceOutcome, them: RaceOutcome, meFec: string | null, themFec: string | null): ElectionPairSide => {
    const sur = surnameOf(me), other = surnameOf(them);
    const fecRule = meFec && themFec ? nativeRule(fecSeries(meFec, themFec), { fractionOfPool: ff }) : null;
    return {
      outcome: me, candidate: candidateOf(me), fecCandidateId: meFec, name: `${sur} ${race.state ?? ""}`.trim(), ticker: tickerOf(sur),
      components: { fecBeats: fecRule, winner: winnerRule(me.conditionId, wf) },
      sentences: {
        fecBeats: fecRule ? `Burns ${pct(ff)} of the burn pool on each FEC reporting period in which ${sur}'s campaign reports more receipts than ${other}'s.` : null,
        winner: `Burns ${pct(wf)} of the burn pool once, when the ${me.label} outcome of the ${race.title.replace(/ Election Winner$/, "")} race resolves YES on Polymarket's on-chain payout; the ${race.stateName ?? "state"} certified result is the cross-check.`,
      },
    };
  };
  return {
    race: { slug: race.slug, title: race.title, settlesOn: race.settlesOn, state: race.state },
    a: side(a, b, fec.a, fec.b), b: side(b, a, fec.b, fec.a),
    crossRead: { name: race.sos.name, url: race.sos.url },
    voidClause: { kind: "both-or-neither", voidBy: race.settlesOn ? race.settlesOn.slice(0, 10) : defaultVoidBy(), pendingPair: true, fallbackClock: "wind-down-28d", status: `locked in both rules at launch (pairs core): event burns apply once both coins have a registered pool; the pair voids if ${race.settlesOn ? race.settlesOn.slice(0, 10) : "its void date"} ends without both, and each coin's pool then winds down over 28 days (onEnd)` },
    launchable: { component: "winner", why: "the rules core locks one selector per coin; each side launches on its winner component until composite rules land" },
    pending: [
      "composite rules (one coin, two selectors): the FEC-beats component is shown and hashed, not launched",
      "the FEC component's only cross-read is the FEC itself (same operator): the coverage gate refuses it until government primaries may use a second publication channel",
      ...(fec.a && fec.b ? [] : ["an FEC candidate id was not found for one side"]),
    ],
  };
}
