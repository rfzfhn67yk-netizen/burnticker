import fs from "node:fs";
import { nameMatch } from "@/lib/burnticker/textMatch";
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
export const BALLOT_NOTE = "Polymarket lists no market on a state ballot measure right now.";

export const STATES: [string, string][] = [["AL", "Alabama"], ["AK", "Alaska"], ["AZ", "Arizona"], ["AR", "Arkansas"], ["CA", "California"], ["CO", "Colorado"], ["CT", "Connecticut"], ["DE", "Delaware"], ["DC", "District of Columbia"], ["FL", "Florida"], ["GA", "Georgia"], ["HI", "Hawaii"], ["ID", "Idaho"], ["IL", "Illinois"], ["IN", "Indiana"], ["IA", "Iowa"], ["KS", "Kansas"], ["KY", "Kentucky"], ["LA", "Louisiana"], ["ME", "Maine"], ["MD", "Maryland"], ["MA", "Massachusetts"], ["MI", "Michigan"], ["MN", "Minnesota"], ["MS", "Mississippi"], ["MO", "Missouri"], ["MT", "Montana"], ["NE", "Nebraska"], ["NV", "Nevada"], ["NH", "New Hampshire"], ["NJ", "New Jersey"], ["NM", "New Mexico"], ["NY", "New York"], ["NC", "North Carolina"], ["ND", "North Dakota"], ["OH", "Ohio"], ["OK", "Oklahoma"], ["OR", "Oregon"], ["PA", "Pennsylvania"], ["RI", "Rhode Island"], ["SC", "South Carolina"], ["SD", "South Dakota"], ["TN", "Tennessee"], ["TX", "Texas"], ["UT", "Utah"], ["VT", "Vermont"], ["VA", "Virginia"], ["WA", "Washington"], ["WV", "West Virginia"], ["WI", "Wisconsin"], ["WY", "Wyoming"]];
const byName = new Map(STATES.map(([a, n]) => [n.toLowerCase(), a]));
export const stateName = (abbr: string): string | null => STATES.find(([a]) => a === abbr)?.[1] ?? null;

export interface RaceClass { type: RaceType; state: string | null; district: string | null; /** a "(by individual)" listing of a district race: used only when the district has no party listing */ individual?: true }
/**
 * An event title → its race, or null (not a race this flow offers). QA pass 9 #26 (2026-10-13): Gamma's titles can end in spaces
 * ("Alaska Governor Election Winner  ", "Nebraska Senate Election Winner  "), which dropped those races, and a district may be listed only
 * "by individual" ("CA-40 House Election Winner (Individual)"), which dropped the 435th House race. Titles are trimmed, and the individual
 * listing is read when it is the district's only one (loadRaces).
 */
export function classifyRace(title0: string): RaceClass | null {
  const title = title0.replace(/\s+/g, " ").trim();
  let m = /^(.+?) Senate Election Winner$/.exec(title);
  if (m && byName.has(m[1].toLowerCase())) return { type: "senate", state: byName.get(m[1].toLowerCase())!, district: null };
  m = /^(.+?) Governor Election Winner$/.exec(title);
  if (m && byName.has(m[1].toLowerCase())) return { type: "governor", state: byName.get(m[1].toLowerCase())!, district: null };
  m = /^([A-Z]{2})-(\d{1,2}|AL) House Election Winner( \((?:by )?individual\))?$/i.exec(title);
  if (m && stateName(m[1].toUpperCase())) return { type: "house", state: m[1].toUpperCase(), district: m[2].toUpperCase(), ...(m[3] ? { individual: true as const } : {}) };
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
    slug: e.slug, title: e.title.replace(/\s+/g, " ").trim(), url: `https://polymarket.com/event/${e.slug}`, ...base, settlesOn: e.endDate ? e.endDate.slice(0, 10) : null, description: e.description,
    outcomes, hiddenPlaceholders: live.length - shown.length, sos: ref,
    settlement: `Polymarket's on-chain payout, checked against ${c.state && ref !== sosFor(null) ? `the ${st} Secretary of State's certified results` : st ? `${st}'s certified results from the state election office` : "each state's certified results from its election office"}`,
    refused: refuse([e.title, ...shown.map((m) => m.question)]),
  };
}

/** The card line: "Abdul El-Sayed (D) wins the Michigan Senate race, which settles on 2026-11-04." (the settlement source is its own line on the card). */
export function outcomeCardTitle(r: Race, o: RaceOutcome): string {
  const c = controlIdentity(r, o);
  if (c) return `The ${c.party} Party wins control of the ${c.chamber}${r.settlesOn ? `, which settles on ${r.settlesOn}` : ""}.`;
  return `${o.label} wins the ${raceNoun(r)}${r.settlesOn ? `, which settles on ${r.settlesOn}` : ""}.`;
}

/**
 * HB-171 (seventh pass WZ7-2, HS-66): a party-control outcome in plain words. The race title is a question ("Which party will win the
 * Senate in 2026?"), so "<label> wins the <title> race" read "Democratic Party wins the Which party will win the Senate in 2026? race",
 * every card was named "Party Wins" and the tickers came out as $DEMOCRATIC and $DEMOCRATI2. Here the party and the chamber make the
 * event ("the Democratic Party wins control of the Senate in the 2026 election"), the name ("Democrats win the Senate") and the ticker
 * ($DEMSENATE, $REPHOUSE). Null for any other race, or an outcome that names neither party.
 */
export interface ControlIdentity { party: "Democratic" | "Republican"; chamber: "Senate" | "House"; year: string | null; phrase: string; name: string; ticker: string }
export function controlIdentity(r: Pick<Race, "type" | "title" | "settlesOn">, o: Pick<RaceOutcome, "label" | "question">): ControlIdentity | null {
  if (r.type !== "control") return null;
  const chamber = /\bSenate\b/i.test(r.title) ? "Senate" : /\bHouse\b/i.test(r.title) ? "House" : null;
  const partyOf = (s: string) => (/\bDemocrat/i.test(s) ? "Democratic" : /\bRepublican/i.test(s) ? "Republican" : null);
  const party = partyOf(o.label) ?? partyOf(o.question);
  if (!chamber || !party) return null;
  const year = /\b(20\d\d)\b/.exec(r.title)?.[1] ?? r.settlesOn?.slice(0, 4) ?? null;
  return {
    party, chamber, year,
    phrase: `the ${party} Party wins control of the ${chamber}${year ? ` in the ${year} election` : ""}`,
    name: `${party === "Democratic" ? "Democrats" : "Republicans"} win the ${chamber}`,
    ticker: `${party === "Democratic" ? "DEM" : "REP"}${chamber.toUpperCase()}`,
  };
}
/** What the coin settles on, in plain words (a party market labelled with its nominee settles on the party). */
export function outcomeSettlesNote(r: Race, o: RaceOutcome): string {
  if (r.type === "control") return `It settles on "${o.question}" resolving ${o.yes}.`;
  const party = /Democrat/i.test(o.question) ? "Democratic" : /Republican/i.test(o.question) ? "Republican" : null;
  return o.partyMarket && party
    ? `It settles on the ${party} nominee winning the ${raceNoun(r)} ("${o.question}"). ${o.label.replace(/\s*\([A-Z]\)$/, "")} is the name Polymarket shows for that nominee. If the nominee changes, the market follows the party.`
    : `It settles on "${o.question}" resolving ${o.yes}.`;
}

/**
 * THE CANDIDATE AND THE MARKET THE COIN READS (audit 10 #5, 2026-10-13): a candidate's coin names the candidate AND says which market
 * settles it. A party market labelled with its nominee follows the party: if the party replaces the candidate, the coin follows the new
 * nominee. A candidate's own market settles NO if that candidate does not win, withdraws or is replaced, and the coin then burns nothing.
 */
export function candidateMappingLine(r: Pick<Race, "type" | "stateName" | "district" | "state">, o: Pick<RaceOutcome, "label" | "question" | "partyMarket">, ticker: string | null = null): string {
  const who = o.label.replace(/\s*\([A-Z]\)$/, "").trim(), coin = ticker ? `$${ticker}` : "This coin";
  const party = /Democrat/i.test(o.question) ? "Democratic" : /Republican/i.test(o.question) ? "Republican" : null;
  // walkthrough 13: a party-control outcome is labelled with the party itself ("Democratic Party"): there is no nominee to follow
  if (o.partyMarket && party && /\bparty$/i.test(who)) return `${coin} settles on the ${party} Party's market for the ${raceNoun(r)} (“${o.question}”). It burns if that market settles YES.`;
  if (o.partyMarket && party) return `${coin} is named for ${who}, but it settles on the ${party} Party's market for the ${raceNoun(r)} (“${o.question}”). If the party replaces ${who} as its nominee, the coin follows the new nominee.`;
  return `${coin} settles on ${who}'s own market (“${o.question}”). If ${who} does not win, withdraws or is replaced, that market settles NO and the coin burns nothing.`;
}

export const electionsIndexUrl =(offset: number, tag: string = ELECTION_TAGS[0]): string => `https://gamma-api.polymarket.com/events?tag_slug=${tag}&closed=false&active=true&limit=100&offset=${offset}`;
/**
 * QA pass 9 #26 (2026-10-13, read live from Gamma): the `midterms` tag lists 1,215 open events, more than the 12 pages of 100 read before,
 * so the last 15 were dropped; and the California governor's race is tagged `governor-midterms`, not `midterms`. The index reads up to 30
 * pages of the main tag, then the per-office tags, merged by slug. A per-office tag that cannot be read leaves the main tag's races as they are.
 * Gamma can answer fewer than 100 events on a page that is not the last (94 and 96 in the saved index), so only an empty page ends a tag.
 */
export const ELECTION_TAGS = ["midterms", "governor-midterms", "senate-midterms"] as const;
export const MAX_INDEX_PAGES = 30;

/** The open election races (each tag paged until an empty page or MAX_INDEX_PAGES). `get` is the Polymarket client's cached getter. */
export async function loadRaces(get: (url: string) => Promise<unknown>, refuse: (titles: string[]) => string[] = () => []): Promise<Race[]> {
  const out: Race[] = []; const seen = new Set<string>(); const individual: Race[] = [];
  for (const [ti, tag] of ELECTION_TAGS.entries()) {
    for (let i = 0; i < MAX_INDEX_PAGES; i++) {
      let body: unknown;
      try { body = await get(electionsIndexUrl(i * 100, tag)); } catch (e) { if (ti === 0) throw e; break; }
      const evs = parseEventsBody(body);
      if (!evs.length) break;
      for (const e of evs) {
        if (seen.has(e.slug)) continue; seen.add(e.slug);
        const r = raceFromEvent(e, refuse);
        if (!r || !r.outcomes.length) continue;
        (classifyRace(e.title)?.individual ? individual : out).push(r);
      }
    }
  }
  // a district listed only "by individual" is still a race; one with a party listing keeps that one
  const key = (r: Race) => `${r.type}:${r.state}:${r.district}`, have = new Set(out.map(key));
  for (const r of individual) if (!have.has(key(r))) { have.add(key(r)); out.push(r); }
  return out;
}

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const STOP = new Set(["will", "win", "wins", "won", "the", "a", "an", "to", "of", "in", "for", "race", "seat", "election", "2026", "be", "beat", "beats", "takes", "take"]);
export const tokens = (q: string): string[] => norm(q).split(" ").filter((w) => w.length >= 2 && !STOP.has(w));

/** Race outcomes a free-text query names, best first (candidate name, state, office, party). */
export function searchRaces(races: readonly Race[], q: string): { race: Race; outcome: RaceOutcome; score: number }[] {
  // every meaningful query token must match: the candidate's name (groupItemTitle) first, then the race's state / office / title
  // (textMatch.ts: "el sayed" ≡ "El-Sayed" ≡ "elsayed"; a two-letter token never surfaces a card on its own)
  const OFFICE: Record<RaceType, string[]> = { senate: ["senate", "senator"], governor: ["governor", "gubernatorial"], house: ["house", "congress", "district"], control: ["control", "majority", "party", "senate", "house"] };
  const hits: { race: Race; outcome: RaceOutcome; score: number }[] = [];
  for (const r of races) for (const o of r.outcomes) {
    const m = nameMatch(q, [o.label.replace(/\s*\([A-Z]\)$/, "")], [o.question, r.title, r.stateName ?? "", r.state ?? "", ...OFFICE[r.type]]);
    const ctx = nameMatch(q, [r.title, r.stateName ?? "", ...OFFICE[r.type]], []);
    if (m.all) hits.push({ race: r, outcome: o, score: 1 + m.nameHits * 0.5 });
    else if (ctx.all && !m.nameHits) hits.push({ race: r, outcome: o, score: 0.6 });   // "michigan senate": the race's outcomes, below any name hit
  }
  return hits.sort((a, b) => b.score - a.score).filter((h, _i, a) => h.score >= Math.min(1, a[0]?.score ?? 0));
}
