import fs from "node:fs";
import path from "node:path";
import { parseEventsBody, type GammaEvent, type GammaMarket } from "@/lib/burnticker/oracle/polymarket";

/**
 * ELECTIONS & POLITICS (2026-10-10, the owner's usability test: "If I wanted to add a coin for Abdul El-Sayed to win the Michigan Senate
 * seat, I'm still having a hard time getting there"). The guided flow — race type → state → race → outcome — and the universal search
 * read the same index: Polymarket's open events tagged `midterms` (Gamma, paged 100 at a time, cached), classified by title:
 *
 *   "<State> Senate Election Winner"      → senate      "<State> Governor Election Winner" → governor
 *   "<ST>-<n> House Election Winner"      → house       "Which party will win the Senate/House …" → party control
 *   (margin-of-victory and other derivative events are not races and are skipped)
 *
 * OUTCOMES are the event's binary markets that Gamma lists as active; the outcome's NAME is Gamma's `groupItemTitle` ("Abdul El-Sayed
 * (D)"); unnamed placeholders ("Person A…J", `active: false`) are hidden and counted. A party market labelled with its nominee settles
 * on the PARTY (the event description's nominee-replacement clause), and the card says so. NO price, odds, volume or liquidity is read
 * into this index (venues.ts). Settlement: the Conditional Tokens payout vector on Polygon (oracle/polymarket.ts); the cross-read named
 * on every card: the state's certified results (config/burnticker/sos.json).
 */

export type RaceType = "senate" | "house" | "governor" | "control";
export const RACE_TYPES: { id: RaceType; label: string }[] = [
  { id: "senate", label: "US Senate" }, { id: "house", label: "US House" }, { id: "governor", label: "Governor" }, { id: "control", label: "Party control" },
];
export const BALLOT_NOTE = "state ballot measures: no ballot-measure market is listed on Polymarket right now";

export const STATES: [string, string][] = [["AL", "Alabama"], ["AK", "Alaska"], ["AZ", "Arizona"], ["AR", "Arkansas"], ["CA", "California"], ["CO", "Colorado"], ["CT", "Connecticut"], ["DE", "Delaware"], ["DC", "District of Columbia"], ["FL", "Florida"], ["GA", "Georgia"], ["HI", "Hawaii"], ["ID", "Idaho"], ["IL", "Illinois"], ["IN", "Indiana"], ["IA", "Iowa"], ["KS", "Kansas"], ["KY", "Kentucky"], ["LA", "Louisiana"], ["ME", "Maine"], ["MD", "Maryland"], ["MA", "Massachusetts"], ["MI", "Michigan"], ["MN", "Minnesota"], ["MS", "Mississippi"], ["MO", "Missouri"], ["MT", "Montana"], ["NE", "Nebraska"], ["NV", "Nevada"], ["NH", "New Hampshire"], ["NJ", "New Jersey"], ["NM", "New Mexico"], ["NY", "New York"], ["NC", "North Carolina"], ["ND", "North Dakota"], ["OH", "Ohio"], ["OK", "Oklahoma"], ["OR", "Oregon"], ["PA", "Pennsylvania"], ["RI", "Rhode Island"], ["SC", "South Carolina"], ["SD", "South Dakota"], ["TN", "Tennessee"], ["TX", "Texas"], ["UT", "Utah"], ["VT", "Vermont"], ["VA", "Virginia"], ["WA", "Washington"], ["WV", "West Virginia"], ["WI", "Wisconsin"], ["WY", "Wyoming"]];
const byName = new Map(STATES.map(([a, n]) => [n.toLowerCase(), a]));
export const stateName = (abbr: string): string | null => STATES.find(([a]) => a === abbr)?.[1] ?? null;

export interface RaceClass { type: RaceType; state: string | null; district: string | null }
/** An event title → its race, or null (not a race this flow offers). */
export function classifyRace(title: string): RaceClass | null {
  let m = /^(.+?) Senate Election Winner$/.exec(title);
  if (m && byName.has(m[1].toLowerCase())) return { type: "senate", state: byName.get(m[1].toLowerCase())!, district: null };
  m = /^(.+?) Governor Election Winner$/.exec(title);
  if (m && byName.has(m[1].toLowerCase())) return { type: "governor", state: byName.get(m[1].toLowerCase())!, district: null };
  m = /^([A-Z]{2})-(\d{1,2}|AL) House Election Winner$/.exec(title);
  if (m && stateName(m[1])) return { type: "house", state: m[1], district: m[2] };
  if (/^Which party will (win|hold|control) the (Senate|House)/i.test(title)) return { type: "control", state: null, district: null };
  return null;
}

export interface SosRef { name: string; url: string; check: string }
let sos: { fallback: SosRef; states: Record<string, SosRef> } | null = null;
export function sosFor(state: string | null, root = process.cwd()): SosRef {
  sos ??= JSON.parse(fs.readFileSync(path.join(root, "config", "burnticker", "sos.json"), "utf8")) as { fallback: SosRef; states: Record<string, SosRef> };
  return (state && sos.states[state]) || sos.fallback;
}

export interface RaceOutcome { conditionId: string; label: string; question: string; yes: string; no: string; partyMarket: boolean }
export interface Race {
  slug: string; title: string; url: string; type: RaceType; state: string | null; stateName: string | null; district: string | null;
  settlesOn: string | null; description: string | null; outcomes: RaceOutcome[]; hiddenPlaceholders: number;
  sos: SosRef; settlement: string; refused: string[];
}

const PARTY_Q = /\b(Democrats?|Republicans?|Democratic|Republican|party)\b/i;
const raceNoun = (r: Pick<Race, "type" | "stateName" | "district" | "state">) => r.type === "senate" ? `${r.stateName} Senate race` : r.type === "governor" ? `${r.stateName} governor's race` : r.type === "house" ? `${r.state}-${r.district} House race` : "party-control race";

export function raceFromEvent(e: GammaEvent, refuse: (titles: string[]) => string[] = () => []): Race | null {
  const c = classifyRace(e.title);
  if (!c || e.closed) return null;
  const live = e.markets.filter((m) => m.outcomes.length === 2 && !m.closed);
  const shown = live.filter((m) => !m.inactive);
  const outcomes: RaceOutcome[] = shown.map((m: GammaMarket) => ({ conditionId: m.conditionId, label: m.groupItemTitle ?? m.question, question: m.question, yes: m.outcomes[0] ?? "Yes", no: m.outcomes[1] ?? "No", partyMarket: PARTY_Q.test(m.question) }));
  const st = c.state ? stateName(c.state) : null;
  const ref = sosFor(c.state);
  const base = { type: c.type, state: c.state, stateName: st, district: c.district };
  return {
    slug: e.slug, title: e.title, url: `https://polymarket.com/event/${e.slug}`, ...base, settlesOn: e.endDate ? e.endDate.slice(0, 10) : null, description: e.description,
    outcomes, hiddenPlaceholders: live.length - shown.length, sos: ref,
    settlement: `Polymarket on-chain payout + ${st ? `${st} ` : ""}${c.state && ref !== sosFor(null) ? "SoS certified results" : "certified results (state election office)"}`,
    refused: refuse([e.title, ...shown.map((m) => m.question)]),
  };
}

/** The card line: "Abdul El-Sayed (D) wins the Michigan Senate race · settles 2026-11-04 · Polymarket on-chain payout + Michigan SoS certified results". */
export function outcomeCardTitle(r: Race, o: RaceOutcome): string {
  return `${o.label} wins the ${raceNoun(r)}${r.settlesOn ? ` · settles ${r.settlesOn}` : ""} · ${r.settlement}`;
}
/** What the coin settles on, in plain words (a party market labelled with its nominee settles on the party). */
export function outcomeSettlesNote(r: Race, o: RaceOutcome): string {
  const party = /Democrat/i.test(o.question) ? "Democratic" : /Republican/i.test(o.question) ? "Republican" : null;
  return o.partyMarket && party
    ? `Settles on the ${party} nominee winning the ${raceNoun(r)} ("${o.question}"); ${o.label.replace(/\s*\([A-Z]\)$/, "")} is the name Polymarket shows for that nominee. If the nominee changes, the market follows the party.`
    : `Settles on "${o.question}" resolving ${o.yes}.`;
}

export const electionsIndexUrl = (offset: number): string => `https://gamma-api.polymarket.com/events?tag_slug=midterms&closed=false&active=true&limit=100&offset=${offset}`;
export const MAX_INDEX_PAGES = 12;

/** The open election races (paged until an empty page or MAX_INDEX_PAGES). `get` is the Polymarket client's cached getter. */
export async function loadRaces(get: (url: string) => Promise<unknown>, refuse: (titles: string[]) => string[] = () => []): Promise<Race[]> {
  const out: Race[] = []; const seen = new Set<string>();
  for (let i = 0; i < MAX_INDEX_PAGES; i++) {
    const evs = parseEventsBody(await get(electionsIndexUrl(i * 100)));
    if (!evs.length) break;
    for (const e of evs) { if (seen.has(e.slug)) continue; seen.add(e.slug); const r = raceFromEvent(e, refuse); if (r && r.outcomes.length) out.push(r); }
  }
  return out;
}

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const STOP = new Set(["will", "win", "wins", "won", "the", "a", "an", "to", "of", "in", "for", "race", "seat", "election", "2026", "be", "beat", "beats", "takes", "take"]);
export const tokens = (q: string): string[] => norm(q).split(" ").filter((w) => w.length >= 2 && !STOP.has(w));

/** Race outcomes a free-text query names, best first (candidate name, state, office, party). */
export function searchRaces(races: readonly Race[], q: string): { race: Race; outcome: RaceOutcome; score: number }[] {
  const qt = tokens(q);
  if (!qt.length) return [];
  const OFFICE: Record<RaceType, string[]> = { senate: ["senate", "senator"], governor: ["governor", "gubernatorial"], house: ["house", "congress", "district"], control: ["control", "majority", "party", "senate", "house"] };
  const hits: { race: Race; outcome: RaceOutcome; score: number }[] = [];
  for (const r of races) for (const o of r.outcomes) {
    const hay = new Set(tokens(`${o.label} ${o.question} ${r.title} ${r.stateName ?? ""} ${r.state ?? ""} ${OFFICE[r.type].join(" ")}`));
    const matched = qt.filter((w) => hay.has(w)).length;
    if (!matched) continue;
    const nameHit = tokens(o.label).some((w) => qt.includes(w) && !["d", "r"].includes(w));
    hits.push({ race: r, outcome: o, score: matched / qt.length + (nameHit ? 0.5 : 0) });
  }
  return hits.sort((a, b) => b.score - a.score).filter((h, _i, a) => h.score >= Math.min(0.6, a[0]?.score ?? 0));
}
