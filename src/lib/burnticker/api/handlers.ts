import type { Platform } from "@/lib/burnticker/server";
import { catalogue, fixtureReadings, previewFromFixture, feedById, feedRuleProblems } from "@/lib/burnticker/catalogue";
import { ONCHAIN_FACTS, onchainSource } from "@/lib/burnticker/sources/onchain";
import { driftBetStub, hedgehogStub, polymarketCard, umaStub } from "@/lib/burnticker/sources/stubs";
import { TIER_LABEL } from "@/lib/burnticker/sources/types";
import type { HttpSourceConfig } from "@/lib/burnticker/sources/attestedHttp";
import { validateRule, lockRule, ruleStatement, BURNTICKER_RULES_SCHEMA, defaultOnEndFor, type LockedRule } from "@/lib/burnticker/rules";
import { summariseOpen } from "@/lib/burnticker/oracle/kalshi";
import { gameSides, legFilterCollisions, ownLegFilter, type EventHit } from "@/lib/burnticker/oracle/events";
import { POLYMARKET_TAG_FOR, type BrowseSeries } from "@/lib/burnticker/oracle/browse";
import { categoryCards, categoryList, loadCategories, type FeedCardInput } from "@/lib/burnticker/browse";
import { KALSHI_UNAVAILABLE, POLYMARKET_UNAVAILABLE, scrubMarketData, type VenueFlags } from "@/lib/burnticker/venues";
import { espnClient, fecClient, nativeRuleProblems, nativeSourceById } from "@/lib/burnticker/sources/native";
import { electionPairTemplate } from "@/lib/burnticker/electionPair";
import { publicOrigin } from "@/lib/burnticker/coinArt";
import { CROSS_LABEL, officialOf } from "@/lib/burnticker/sources/gameSettle";
import { scheduleProblem } from "@/lib/burnticker/sources/provenance";
import { creatorTextProblems, generatedParagraph, metadataDescription, NOTE_MAX, registeredDescription, serverDescribeCtx } from "@/lib/burnticker/coinText";
import { pinCoin, type PinnedCoin } from "@/lib/burnticker/pin";
import { describeRule } from "@/lib/burnticker/describe";
import { universalSearch, dedupeTickers, derbyHrefFrom, polyRule, type FeedLike } from "@/lib/burnticker/search";
import { BALLOT_NOTE, RACE_TYPES, loadRaces, outcomeCardTitle, outcomeSettlesNote, stateName } from "@/lib/burnticker/elections";
import { LEAGUES, SCHEDULE_NEEDS_KEY, SPORTS, ScheduleUnavailable, gameSeries, isLeague, findTeams, seasonYearAt, teamSeries, teamsOf, type Game, type LeagueId } from "@/lib/burnticker/sources/espn";
import type { PolyEventHit } from "@/lib/burnticker/oracle/polymarket";
import { backtest, backtestSentence } from "@/lib/burnticker/oracle/backtest";
import { isBinary, POLYGONSCAN_CTF } from "@/lib/burnticker/oracle/polymarket";
import { wideRule } from "@/lib/burnticker/registry";
import { loadRefuseList, nameRefusals, refusalsFor, type Refusal } from "@/lib/burnticker/oracle/refuse";
import { existingCoinsFor } from "@/lib/burnticker/duplicateRuleMatch";
import { buildLaunchBundle, buildPairBundles, launchProblems, raiseProblem, type LaunchBundle, type LaunchInput } from "@/lib/burnticker/launchBundle";
import { MAINNET_OFF_SENTENCE, NO_OPENING_PURCHASE_SENTENCE, VAULT_HIDDEN_SENTENCE, requestedOpeningPurchase } from "@/lib/burnticker/hostedLaunch";
import { launchVenueOf } from "@/lib/burnticker/launchVerify";
import { buildPairCurveLaunch, pairCurveEnabled, type PairCurveLaunchBundle } from "@/lib/burnticker/pairCurveLaunch";
import type { PairRow, TokenRow } from "@/lib/burnticker/registry";
import { fail, ok, type ApiResult } from "@/lib/burnticker/api/http";
import { derbyAdmission } from "@/lib/burnticker/derby/admission";
import { seasonEndMs, isoDate } from "@/lib/burnticker/derby/spec";
import type { FetchLike } from "@/lib/burnticker/oracle/types";

/** A derby rule's title for the review screen ("WIF vs SHIB · daily % change"; "bracket <id> · slot 3 (WIF)"). */
export function derbyTitle(rule: LockedRule["rule"]): string {
  const d = rule.derby;
  if (!d) return rule.series ?? "derby";
  if (d.selector === "bracket") return `Burn Derby bracket ${d.tournamentId}, slot ${d.slot}, for ${d.underlying.symbol}`;
  if (d.selector === "price") return `Burn Derby on the ${d.window} % change of ${d.u.symbol}`;
  return `Burn Derby, ${d.a.symbol} vs ${d.b.symbol}, on the ${d.window} ${d.flip ? "flippening" : d.measure === "mcap" ? "market-cap change" : "% change"}`;
}

/**
 * Both or neither: a ONE-SHOT pair's voidBy is its first settlement date — a Kalshi market's close date, a Polymarket market's end date,
 * a derby flippening's last season day. Null (→ 30 days after launch) for recurring selectors or when the venue does not say.
 */
export async function oneShotVoidBy(p: Platform, locked: LockedRule): Promise<string | null> {
  const r = locked.rule;
  try {
    if (r.oracle === "derby" && r.derby?.selector === "coinvs" && r.derby.flip) return isoDate(seasonEndMs(r.derby) - 86_400_000);
    if (r.oracle === "kalshi" && r.market) { const m = (await p.kalshi.openMarkets(r.market.split("-")[0])).find((x) => x.ticker === r.market); return m?.closeTime ? m.closeTime.slice(0, 10) : null; }
    if (r.oracle === "polymarket" && r.market) { const m = await p.polymarket.marketByCondition(r.market) as { endDate?: string | null } | null; return m?.endDate ? String(m.endDate).slice(0, 10) : null; }
  } catch { return null; }
  return null;
}
import { preflightSelector, preflightStrict, type PreflightDeps } from "@/lib/burnticker/coverage/preflight";
import { launchGuardRefusal } from "@/lib/burnticker/launchGuards";
import type { PreflightResult } from "@/lib/burnticker/coverage/types";

/**
 * THE BURNTICKER ROUTES' SHARED LOGIC (2026-10-09). The wizard's routes (/api/burnticker/{catalogue,oracle/*,launch}) and the public
 * v1 API call the same functions, so the two can never disagree about a refusal, a hash or a fee. Each returns an ApiResult
 * ({ status, body }); the routes only wrap it in a Response. Moved verbatim from the original route files.
 */

export const ADMISSION = {
  all: ["official or primary source", "machine-readable", "timestamped", "unambiguous units", "not controlled by anyone who can hold the token", "not a disaster", "not an election or vote, except Kalshi election series, which the operator allows", "never the token's own price"],
  byTier: { 1: "An adjudicated market. Only settled results count, and the venue's window for making a result final is respected.", 2: "An optimistic assertion. It counts only once it is settled and nobody disputes it.", 3: "A primary API whose reading is attested by a secure enclave or a zero-knowledge proof, using the same address and selection as tier 4. Prices of outside assets are allowed from this tier up.", 4: "A primary API read by our keeper. No asset prices are allowed. Each source has one real saved sample and limits on what a believable reading looks like.", 5: "A value read from a web page. The operator approves each source, the pattern is fixed to the page's markup, and it is never a price." },
};

/** A source config for publication: header VALUES withheld (they may carry a contact address or a key template), names kept. */
export function publicConfig(cfg: HttpSourceConfig): Record<string, unknown> {
  const { headers, ...request } = cfg.request;
  return { id: cfg.id, title: cfg.title, sourceUrl: cfg.sourceUrl, request: { ...request, headerNames: headers ? Object.keys(headers) : [] }, select: cfg.select, period: cfg.period, unit: cfg.unit, direction: cfg.direction, baseline: cfg.baseline, carry: cfg.carry, plausibility: cfg.plausibility, memoSource: cfg.memoSource, needsKey: cfg.needsKey ?? null };
}

/** Every source the wizard can show, with kind and tier (+ the public selection config when `includeConfig`). */
export function catalogueSources(now: number, o: { includeConfig?: boolean } = {}): { sources: Record<string, unknown>[]; tiers: typeof TIER_LABEL; admission: typeof ADMISSION } {
  const http = catalogue().map((f) => {
    let last: { id: string; value: string | null; at: string } | null = null, readings: { id: string; value: string | null }[] = [], preview: unknown = null, fixtureFetchedAt: string | null = null, refusals: string[] = [];
    try {
      const fr = fixtureReadings(f, now); fixtureFetchedAt = fr.fetchedAt; refusals = fr.refusals;
      const l = fr.readings[fr.readings.length - 1] ?? null; last = l ? { id: l.id, value: l.value, at: l.at } : null; readings = fr.readings.map((r) => ({ id: r.id, value: r.value }));
      const rule = validateRule({ schema: BURNTICKER_RULES_SCHEMA, oracle: "catalogue", series: f.id, market: null, filter: {}, kind: "scalar", scalar: { unit: f.unit!.size, perUnit: { fractionOfPool: 0.02 }, baseline: f.baseline!, direction: f.direction! }, binary: null, onVoid: "skip", floorUsd: "1", reserveSol: "0.02", vault: null });
      const pv = previewFromFixture(f, rule, now); preview = { window: pv.window, units: pv.totals.units, burnEvents: pv.totals.burnEvents, poolFractionSpent: pv.totals.poolFractionSpent };
    } catch { /* no fixture: the card says so */ }
    return { id: f.id, kind: f.kind, tier: f.tier, tierLabel: TIER_LABEL[f.tier], title: f.title, sourceName: f.sourceName, sourceUrl: f.sourceUrl, cadence: f.cadence, unit: f.unit, direction: f.direction, baseline: f.baseline, carry: f.carry, valueLabel: f.valueLabel, flags: f.flags, launchable: f.launchable, param: f.param, needsKey: f.config.needsKey ?? null, fixtureFetchedAt, refusals, lastReading: last, readings, preview, ...(o.includeConfig ? { config: publicConfig(f.config) } : {}) };
  });
  const onchain = (Object.keys(ONCHAIN_FACTS) as (keyof typeof ONCHAIN_FACTS)[]).map((id) => { const s = onchainSource(id, null); return { id, kind: s.kind, tier: s.tier, tierLabel: TIER_LABEL[s.tier], title: s.title, sourceName: s.sourceName, sourceUrl: s.sourceUrl, cadence: s.cadence, unit: s.unit, direction: s.direction, baseline: s.baseline, carry: s.carry, valueLabel: s.valueLabel, flags: s.flags, launchable: s.launchable, param: null, needsKey: null, fixtureFetchedAt: null, refusals: [], lastReading: null, readings: [], preview: null, ...(o.includeConfig ? { config: null } : {}) }; });
  const stubs = [polymarketCard(), umaStub(), driftBetStub(), hedgehogStub()].map((s) => ({ id: s.id, kind: s.kind, tier: s.tier, tierLabel: TIER_LABEL[s.tier], title: s.title, sourceName: s.sourceName, sourceUrl: s.sourceUrl, cadence: s.cadence, unit: null, direction: null, baseline: null, carry: s.carry, valueLabel: null, flags: s.flags, launchable: s.launchable, param: null, needsKey: null, fixtureFetchedAt: null, refusals: [], lastReading: null, readings: [], preview: null, ...(o.includeConfig ? { config: null } : {}) }));
  return { sources: [...http, ...onchain, ...stubs], tiers: TIER_LABEL, admission: ADMISSION };
}

/** Live Kalshi series search, or one series with its next open markets (`series`). */
export async function kalshiSearch(p: Platform, q: { q?: string | null; category?: string | null; series?: string | null }): Promise<ApiResult> {
  if (p.kalshiEnabled === false) return fail(503, KALSHI_UNAVAILABLE);
  const series = q.series?.trim().toUpperCase();
  try {
    if (series) {
      // Kalshi answers 404 for an unknown series: that is "not found" here too, not an upstream failure.
      const info = await p.kalshi.seriesInfo(series).catch((e: Error) => { if (/HTTP 404/.test(e.message)) return null; throw e; });
      if (!info) return fail(404, `Kalshi has no series called ${series}.`);
      const open = await p.kalshi.openMarkets(series).catch(() => []);
      const probe = validateRule({ schema: BURNTICKER_RULES_SCHEMA, oracle: "kalshi", series, market: null, filter: {}, kind: "binary", binary: { onYes: { fractionOfPool: 0.02 }, onNo: null }, scalar: null, onVoid: "skip", floorUsd: "1", reserveSol: "0.02", vault: null });
      const refusals = refusalsFor(loadRefuseList(), { titles: [info.title, ...open.slice(0, 20).map((m) => m.title)], categories: info.category ? [info.category] : [] });
      return ok({ series: info, open: summariseOpen(open, probe, 20), openCount: open.length, refusals, note: "Prices are shown for display only. The rule reads settled results." });
    }
    const query = q.q ?? "";
    const hits = await p.kalshi.searchSeries(query, { category: q.category ?? undefined, limit: 30 });
    const list = loadRefuseList();
    const results = hits.map((s) => ({ ...s, refused: refusalsFor(list, { titles: [s.title], categories: s.category ? [s.category] : [] }).map((r) => r.reason) }));
    // EVENT-LEVEL hits merged in (2026-10-10): a team / person / contest lives on an event, not in a series title. Ranked above the
    // series when the query names a team (the alias table) or an event matched a market (a side) by name. An event-search failure
    // never fails the series search.
    let events: ReturnType<typeof eventHitJson>[] = [], teams: { league: string; abbr: string; city: string; nickname: string }[] = [];
    if (query.trim().length >= 2 && !q.category) {
      try { const r = await p.kalshi.searchEvents(query, { limit: 20 }); events = r.events.map((e) => eventHitJson(e, list)); teams = r.teams; } catch { events = []; }
    }
    const ranking = teams.length > 0 || events.some((e) => e.matchedSides.length > 0) ? "events" : "series";
    return ok({ query, results, events, ranking, teams });
  } catch (e) {
    return fail(502, `Kalshi could not be reached just now. The reason given was: ${(e as Error).message.slice(0, 160)}`);
  }
}

/** One event hit for the API: the event, its markets (ticker + label, no prices), the two sides of a game with pre-filled names and both selector modes, the refuse-list verdict. */
export function eventHitJson(e: EventHit, list = loadRefuseList()) {
  const g = gameSides(e);
  const pair = g ? {
    a: g.a, b: g.b, tieMarket: g.tie?.ticker ?? null,
    thisGameOnly: { selector: { oracle: "kalshi", series: null, market: g.a.marketTicker }, sideA: `Burns when ${g.a.marketTicker} settles NO, which means ${g.a.label} does not win.`, sideB: `Burns when ${g.a.marketTicker} settles YES, which means ${g.a.label} wins.${g.tie ? " A draw settles it NO, so a draw burns side A." : ""}`, partition: true },
    everyGame: { a: { series: e.seriesTicker, filter: { tickerIncludes: ownLegFilter(g.a.abbr) }, collisions: legFilterCollisions(g.a.abbr, e.seriesTicker) }, b: { series: e.seriesTicker, filter: { tickerIncludes: ownLegFilter(g.b.abbr) }, collisions: legFilterCollisions(g.b.abbr, e.seriesTicker) }, partition: false, note: "Each side follows its own team's games. The two sides split only the games where the teams play each other. Every other game counts for one side alone." },
  } : null;
  return { eventTicker: e.eventTicker, seriesTicker: e.seriesTicker, title: e.title, subTitle: e.subTitle, category: e.category, competition: e.competition, expectedAt: e.expectedAt, closeTime: e.closeTime,
    markets: e.markets.map((m) => ({ ticker: m.ticker, suffix: m.suffix, label: m.label, status: m.status, closeTime: m.closeTime })), score: e.score, matchedSides: e.matchedSides, matched: e.matched, pair,
    refused: refusalsFor(list, { titles: [e.title], categories: e.category ? [e.category] : [] }).map((r) => r.reason) };
}

/** Event-level search (teams, people, contests) — `q` matched against event title / ticker / market labels with the team-alias table; `series` scans one series; neither → the league chooser. */
export async function kalshiEvents(p: Platform, q: { q?: string | null; series?: string | null; status?: string | null }): Promise<ApiResult> {
  if (p.kalshiEnabled === false) return fail(503, KALSHI_UNAVAILABLE);
  const query = (q.q ?? "").trim(), series = q.series?.trim().toUpperCase() || null;
  const status = q.status && ["open", "closed", "settled"].includes(q.status) ? q.status : "open";
  try {
    if (!query && !series) return ok({ query: "", series: null, leagues: await p.kalshi.leagues(), events: [], scanned: [], teams: [] });
    const list = loadRefuseList();
    if (!query && series) {
      const evs = await p.kalshi.eventsForSeries(series, status);
      const hits: EventHit[] = evs.map((e) => ({ ...e, score: 0, matchedSides: [], matched: [] })).sort((a, b) => (a.expectedAt ?? "9").localeCompare(b.expectedAt ?? "9"));
      return ok({ query: "", series, events: hits.slice(0, 100).map((e) => eventHitJson(e, list)), scanned: [series], teams: [], count: evs.length });
    }
    const r = await p.kalshi.searchEvents(query, { series, status, limit: 40 });
    return ok({ query, series, events: r.events.map((e) => eventHitJson(e, list)), scanned: r.scanned, teams: r.teams });
  } catch (e) {
    return fail(502, `Kalshi could not be reached just now. The reason given was: ${(e as Error).message.slice(0, 160)}`);
  }
}

/** The team picker for one head-to-head game series (team coins): every team, its next game, its record so far this season. */
export async function kalshiTeams(p: Platform, q: { series?: string | null }): Promise<ApiResult> {
  if (p.kalshiEnabled === false) return fail(503, KALSHI_UNAVAILABLE);
  const series = q.series?.trim().toUpperCase();
  if (!series) return fail(400, "Name a head-to-head game series, such as KXNFLGAME.");
  if (!/^[A-Z0-9]+GAME$/.test(series)) return fail(400, `${series} is not a head-to-head game series. Those names end in GAME.`);
  try {
    const t = await p.kalshi.teams(series);
    return ok({ ...t, note: "A team's record counts its own market. YES is a win and NO is a loss. A YES on the game's tie market is a draw. Voided games are not counted." });
  } catch (e) {
    return fail(502, `Kalshi could not be reached just now. The reason given was: ${(e as Error).message.slice(0, 160)}`);
  }
}

const refuseTitlesList = (titles: string[]): string[] => [...new Set(refusalsFor(loadRefuseList(), { titles }).map((r) => r.reason))];
const catalogueFeeds = (now: number): FeedLike[] => (catalogueSources(now).sources as unknown as (FeedLike & { kind: string })[]).filter((f) => f.kind !== "market" && f.kind !== "assertion");

/** GET /v1/search?q= — the universal search (src/lib/burnticker/search.ts): ready-made rules from every enabled venue and feed; the category list when nothing matches. */
export async function search(p: Platform, q: { q?: string | null }, now = Date.now()): Promise<ApiResult> {
  const venues = venueFlags(p);
  const r = await universalSearch(q.q ?? "", { venues, feeds: catalogueFeeds(now), espn: espnClient(), polyGet: venues.polymarket ? (u) => p.polymarket.get(u) : null, refuse: refuseTitlesList, kalshiSearch: venues.kalshi ? (x) => p.kalshi.searchSeries(x, { limit: 5 }) : null, derbyHref: derbyHrefFrom(), nowMs: now });
  let categories: { id: string; label: string; blurb: string }[] = [];
  if (r.empty) { try { categories = loadCategories().map((c) => ({ id: c.id, label: c.label, blurb: c.blurb })); } catch { categories = []; } }
  // suggested tickers: unique against the registry and clear of the refuse list's name patterns (RAYS26 → RAYS262 when taken)
  const list = loadRefuseList();
  const cards = dedupeTickers(r.cards, (t) => { try { return p.registry.tokenByTicker(t) !== null; } catch { return false; } }, (t) => nameRefusals(list, "", t).length > 0);
  // website-14 (product idea 6): a card whose rule's canonical selector is already registered names those coins (duplicateRule.ts)
  let tokens: Parameters<typeof existingCoinsFor>[1] = [];
  try { tokens = p.registry.tokens(); } catch { tokens = []; }
  const withExisting = cards.map((c) => { const rule = (c as { rule?: unknown }).rule; const existing = rule ? existingCoinsFor(rule, tokens) : []; return existing.length ? { ...c, existing } : c; });
  return ok({ ...r, cards: withExisting, venues, categories, note: "These are ready-made rules. No prices, odds, volume or liquidity are returned." });
}

/** GET /v1/elections?type=&state= — the guided Elections & Politics flow (src/lib/burnticker/elections.ts), from Polymarket's open midterm races. */
export async function elections(p: Platform, q: { type?: string | null; state?: string | null }): Promise<ApiResult> {
  if (p.polymarketDiscovery === false) return fail(503, POLYMARKET_UNAVAILABLE);
  try {
    const races = await loadRaces((u) => p.polymarket.get(u), refuseTitlesList);
    const type = RACE_TYPES.some((t) => t.id === q.type) ? q.type! : null;
    const st = q.state?.trim().toUpperCase() || null;
    const ofType = type ? races.filter((r) => r.type === type) : [];
    const states = [...new Set(ofType.map((r) => r.state).filter((x): x is string => !!x))].sort().map((a) => ({ abbr: a, name: stateName(a) ?? a, races: ofType.filter((r) => r.state === a).length }));
    const shown = type ? ofType.filter((r) => type === "control" || !st || r.state === st) : [];
    return ok(scrubMarketData({
      types: RACE_TYPES.map((t) => ({ ...t, races: races.filter((r) => r.type === t.id).length })), ballot: BALLOT_NOTE, type, state: st, states,
      races: (type === "control" || st ? shown : []).slice(0, 60).map((r) => ({ ...r, outcomes: r.outcomes.map((o) => ({ ...o, title: outcomeCardTitle(r, o), settles: outcomeSettlesNote(r, o), rule: polyRule(o.conditionId) })) })),
      note: "These are Polymarket's open midterm races. Placeholder outcomes with no name are hidden. Settlement reads the on-chain payout, and the state's certified results are the second source that checks it.",
    }));
  } catch (e) { return fail(502, `Polymarket could not be reached just now. The reason given was: ${(e as Error).message.slice(0, 160)}`); }
}

/** GET /v1/elections/pair?slug=&a=&b= — the election-pair template (electionPair.ts): candidate A vs B for one race → two coins. */
export async function electionPair(p: Platform, q: { slug?: string | null; a?: string | null; b?: string | null }): Promise<ApiResult> {
  if (p.polymarketDiscovery === false) return fail(503, POLYMARKET_UNAVAILABLE);
  if (!q.slug || !q.a || !q.b || q.a === q.b) return fail(400, "Send the race slug and two different outcomes of that race, as a and b.");
  try {
    const races = await loadRaces((u) => p.polymarket.get(u), refuseTitlesList);
    const race = races.find((r) => r.slug === q.slug);
    if (!race) return fail(404, `There is no open race called ${q.slug}.`);
    const oa = race.outcomes.find((o) => o.conditionId === q.a!.toLowerCase()), ob = race.outcomes.find((o) => o.conditionId === q.b!.toLowerCase());
    if (!oa || !ob) return fail(404, "Both outcomes must be named outcomes of this race.");
    const office = race.type === "senate" ? "S" : race.type === "house" ? "H" : null;
    const fecId = async (label: string): Promise<string | null> => {
      if (!office || !race.state) return null;
      const party = /\(D\)$/.test(label) ? "DEM" : /\(R\)$/.test(label) ? "REP" : null;
      const surname = label.replace(/\s*\([A-Z]\)$/, "").trim().split(/\s+/).pop() ?? label;
      try { const hits = await fecClient().searchCandidates(surname, office, race.state); return (hits.find((h) => !party || h.party === party) ?? hits[0])?.id ?? null; } catch { return null; }
    };
    const [fa, fb] = [await fecId(oa.label), await fecId(ob.label)];
    return ok(scrubMarketData({ ...electionPairTemplate(race, oa, ob, { a: fa, b: fb }), note: "This makes two coins, one for each candidate. Until combined rules exist, each coin follows its own candidate's winner market. The pending list has the details." }));
  } catch (e) { return fail(502, `Polymarket could not be reached just now. The reason given was: ${(e as Error).message.slice(0, 160)}`); }
}

const sideOf = (league: LeagueId, s: Game["home"]) => { const t = teamsOf(league).find((x) => x.abbr === s.abbr); return { abbr: s.abbr, name: s.name || t?.name || s.abbr, nickname: s.nickname || t?.nickname || s.abbr, ticker: t?.ticker ?? s.abbr, record: s.record }; };

/** GET /v1/sports/teams?league= — the team picker for team coins (the league's own schedule or TheSportsDB; no ESPN reads): the static team table with each team's next game and record. No league → the leagues. */
export async function sportsTeams(_p: Platform, q: { league?: string | null; q?: string | null }): Promise<ApiResult> {
  const league = q.league?.trim().toLowerCase() ?? "";
  if (!league) return ok({ leagues: Object.values(LEAGUES).map((l) => { const off = officialOf(l.id); return { id: l.id, label: l.label, sport: l.sport, crossRead: off ? CROSS_LABEL[off] : "The on-chain payout and the licensed final score confirm each other.", crossReadMissing: false, schedule: off ? `${CROSS_LABEL[off]}, which is free` : "TheSportsDB, with a licensed key", scheduleAvailable: espnClient().scheduleAvailable(l.id), draws: l.draws, teams: teamsOf(l.id).length }; }), sports: SPORTS, source: "Schedules come from the league's official feed for MLB, NHL and NBA, and from TheSportsDB with a licensed key for every other league." });
  if (!isLeague(league)) return fail(400, `Pick a league from this list: ${Object.keys(LEAGUES).join(", ")}.`);
  // schedules: MLB / NHL / NBA from their free official feeds, every other league from TheSportsDB (licensed key) — never ESPN
  // launch audit 5 L05: a schedule that cannot be read is a display problem only — the sentence says so; the technical reason is apart
  let scheduleNote: string | null = null, scheduleDetail: string | null = null;
  const games = await espnClient().upcoming(league, 8).catch((e) => { const sp = e instanceof ScheduleUnavailable ? scheduleProblem(league, "needs-licence", SCHEDULE_NEEDS_KEY) : scheduleProblem(league, "unreadable", (e as Error).message.slice(0, 160)); scheduleNote = sp.line; scheduleDetail = sp.detail; return [] as Game[]; });
  const year = seasonYearAt(league, Date.now());
  const needle = (q.q ?? "").trim();
  const named = needle ? new Set(findTeams(needle).filter((t) => t.league === league).map((t) => t.abbr)) : null;
  const teams = teamsOf(league).filter((t) => !named || named.has(t.abbr) || t.name.toLowerCase().includes(needle.toLowerCase())).slice(0, needle ? 200 : 400).map((t) => {
    const g = games.filter((x) => x.home.abbr === t.abbr || x.away.abbr === t.abbr).sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0] ?? null;
    const opp = g ? (g.home.abbr === t.abbr ? g.away : g.home) : null;
    const me = g ? (g.home.abbr === t.abbr ? g.home : g.away) : null;
    return { abbr: t.abbr, city: t.city, nickname: t.nickname, name: t.name, ticker: t.ticker, league, series: { win: teamSeries(league, t.abbr, "win", { kind: "season", year }), loss: teamSeries(league, t.abbr, "loss", { kind: "season", year }), ...(LEAGUES[league].draws ? { draw: teamSeries(league, t.abbr, "draw", { kind: "season", year }) } : {}), seasonYear: year, perpetual: { win: teamSeries(league, t.abbr, "win", { kind: "perpetual" }), loss: teamSeries(league, t.abbr, "loss", { kind: "perpetual" }) } }, record: me?.record ?? null, next: g && opp ? { eventId: g.eventId, title: g.name, startsAt: g.startsAt, detail: g.detail, opponent: opp.nickname || opp.abbr, home: g.home.abbr === t.abbr } : null };
  });
  return ok({ league, label: LEAGUES[league].label, source: league === "mlb" || league === "nhl" || league === "nba" ? "The schedule comes from the league's official feed." : "The schedule comes from TheSportsDB, with a licensed key.", scheduleNote, scheduleDetail, teams });
}

/** GET /v1/sports/games?league=&q= — upcoming games for matchups (the league's own schedule or TheSportsDB, the next 8 days; no ESPN reads): both sides and each side's one-game loss selector. */
export async function sportsGames(_p: Platform, q: { league?: string | null; q?: string | null }): Promise<ApiResult> {
  const league = q.league?.trim().toLowerCase() ?? "";
  if (!isLeague(league)) return fail(400, `Pick a league from this list: ${Object.keys(LEAGUES).join(", ")}.`);
  try {
    let games: Game[];
    try { games = await espnClient().upcoming(league, 8); } catch (e) { const sp = e instanceof ScheduleUnavailable ? scheduleProblem(league, "needs-licence", SCHEDULE_NEEDS_KEY) : scheduleProblem(league, "unreadable", (e as Error).message.slice(0, 160)); return ok({ league, label: LEAGUES[league].label, source: league === "mlb" || league === "nhl" || league === "nba" ? "The schedule comes from the league's official feed." : "The schedule comes from TheSportsDB, with a licensed key.", scheduleNote: sp.line, scheduleDetail: sp.detail, games: [], count: 0 }); }
    const needle = (q.q ?? "").trim();
    const named = needle ? new Set(findTeams(needle).filter((t) => t.league === league).map((t) => t.abbr)) : null;
    const rows = games.filter((g) => !g.completed && g.home.abbr !== "TBD" && g.away.abbr !== "TBD" && (!named || named.has(g.home.abbr) || named.has(g.away.abbr))).sort((a, b) => a.startsAt.localeCompare(b.startsAt)).map((g) => ({
      eventId: g.eventId, league, title: g.name, startsAt: g.startsAt, detail: g.detail, a: sideOf(league, g.away), b: sideOf(league, g.home),
      series: { aLoss: gameSeries(league, g.eventId, g.away.abbr, "loss"), bLoss: gameSeries(league, g.eventId, g.home.abbr, "loss") },
    }));
    return ok({ league, label: LEAGUES[league].label, source: league === "mlb" || league === "nhl" || league === "nba" ? "The schedule comes from the league's official feed." : "The schedule comes from TheSportsDB, with a licensed key.", scheduleNote: null, scheduleDetail: null, games: rows, count: rows.length });
  } catch (e) { return fail(502, `The schedule could not be read just now. The reason given was: ${(e as Error).message.slice(0, 160)}`); }
}

/** Which venues this host serves (venues.ts): Kalshi behind BURNTICKER_KALSHI_ENABLED; Polymarket and the first-party feeds always. */
export const venueFlags = (p: Platform): VenueFlags => ({ kalshi: p.kalshiEnabled !== false, polymarket: p.polymarketDiscovery !== false, feeds: true });

/**
 * BROWSE, VENUE-AGNOSTIC (src/lib/burnticker/browse.ts): no category → Burnticker's categories (config/burnticker/categories.json)
 * with what each venue contributes on this host; `category` → its source cards — first-party feeds first, then Polymarket events of
 * its tags, then (Kalshi enabled) Kalshi series of its categories, the four series soonest-listed with their next event. A venue that
 * fails is named in `errors` and the rest of the page still renders.
 */
export async function browse(p: Platform, q: { category?: string | null; q?: string | null }, now = Date.now()): Promise<ApiResult> {
  const venues = venueFlags(p);
  let cats;
  try { cats = loadCategories(); } catch (e) { return fail(500, (e as Error).message); }
  const feeds = (catalogueSources(now).sources as unknown as (FeedCardInput & { kind: string })[]).filter((f) => f.kind !== "market" && f.kind !== "assertion");
  const id = q.category?.trim() || null;
  if (!id) return ok({ categories: categoryList(cats, feeds, venues), venues, note: "These are Burnticker's categories. Each one lists our own feeds and Polymarket events. It also lists Kalshi series when this site has Kalshi turned on." });
  const c = cats.find((x) => x.id === id);
  if (!c) return fail(404, `There is no category called "${id}". The categories are ${cats.map((x) => x.id).join(", ")}.`);
  const errors: string[] = [];
  const polymarket: PolyEventHit[] = [];
  for (const tag of venues.polymarket ? c.polymarket.slice(0, 2) : []) {
    try { polymarket.push(...(await p.polymarket.eventsByTag(tag, 6)).events); } catch (e) { errors.push(`Polymarket's ${tag} events could not be read. The reason given was: ${(e as Error).message.slice(0, 100)}`); }
  }
  const kalshi: (BrowseSeries & { refused: string[] })[] = [];
  if (venues.kalshi) {
    const list = loadRefuseList();
    const per = Math.max(4, Math.floor(12 / Math.max(1, c.kalshi.length)));
    for (const cat of c.kalshi) {
      try {
        const page = await p.kalshi.seriesByCategory(cat, { q: q.q ?? null, limit: per, withEvents: Math.min(4, per) });
        kalshi.push(...page.series.map((s) => ({ ...s, refused: refusalsFor(list, { titles: [s.title], categories: s.category ? [s.category] : [] }).map((r) => r.reason) })));
      } catch (e) { errors.push(`Kalshi's ${cat} series could not be read. The reason given was: ${(e as Error).message.slice(0, 100)}`); }
    }
  }
  const cards = categoryCards(c, { feeds, polymarket, kalshi }, { q: q.q ?? null });
  return ok({ category: { id: c.id, label: c.label, blurb: c.blurb }, venues, cards, counts: { feeds: cards.filter((x) => x.venue === "feed").length, polymarket: cards.filter((x) => x.venue === "polymarket").length, kalshi: cards.filter((x) => x.venue === "kalshi").length }, errors, note: venues.kalshi ? "Our own feeds come first. Prediction markets come after them." : "Our own feeds come first. Kalshi is not turned on for this site." });
}

/**
 * BROWSE (2026-10-10, the owner: "make it navigate like Kalshi navigates"). No category → Kalshi's categories in its own order, each
 * with its tags and series count, and the Polymarket tag each maps to. `category` → that category's series (most traded first; `tag`
 * and `q` filter; `limit`/`offset` page; the first `events` series carry their upcoming-event summary), each with the refuse-list
 * verdict and a one-line example mapping, plus — where the category maps to a Polymarket tag and `polymarket` is not 0 — that tag's
 * open events as a second venue group. A Polymarket failure never fails the Kalshi page.
 */
export async function kalshiCategories(p: Platform, q: { category?: string | null; tag?: string | null; q?: string | null; limit?: string | null; offset?: string | null; events?: string | null; polymarket?: string | null }): Promise<ApiResult> {
  if (p.kalshiEnabled === false) return fail(503, KALSHI_UNAVAILABLE);
  const category = q.category?.trim() || null;
  try {
    if (!category) {
      const cats = await p.kalshi.categories({ counts: true });
      return ok({ categories: cats.map((c) => ({ ...c, polymarket: POLYMARKET_TAG_FOR[c.category] ?? null })), note: "These are Kalshi's own categories, each with its tags. Each count is the number of series in that category." });
    }
    const known = (await p.kalshi.categories({ counts: false }).catch(() => [])).map((c) => c.category);
    if (known.length && !known.includes(category)) return fail(404, `Kalshi has no category called "${category}". Its categories are ${known.join(", ")}.`);
    const intOr = (v: string | null | undefined, d: number, lo: number, hi: number) => { const n = Number(v); return v !== null && v !== undefined && v !== "" && Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.floor(n))) : d; };
    const page = await p.kalshi.seriesByCategory(category, { tag: q.tag?.trim() || null, q: q.q ?? null, limit: intOr(q.limit, 24, 1, 100), offset: intOr(q.offset, 0, 0, 100_000), withEvents: intOr(q.events, 0, 0, 24) });
    const list = loadRefuseList();
    // volume orders the page and is never returned (no market data in a discovery payload — venues.ts)
    const series = page.series.map(({ volume: _v, ...s }) => ({ ...s, refused: refusalsFor(list, { titles: [s.title], categories: s.category ? [s.category] : [] }).map((r) => r.reason) }));
    const tag = POLYMARKET_TAG_FOR[category] ?? null;
    let polymarket: { tag: { slug: string; label: string }; events: unknown[]; error: string | null } | null = null;
    if (tag && q.polymarket !== "0" && p.polymarketDiscovery !== false) {
      try { const r = await p.polymarket.eventsByTag(tag.slug, 8); polymarket = { tag, events: r.events, error: null }; } catch (e) { polymarket = { tag, events: [], error: (e as Error).message.slice(0, 120) }; }
    }
    return ok({ ...page, series, polymarket, note: "The series most traded on Kalshi come first. Trading is used only to order the list. Open a series to see whether it settles as yes or no or as a number." });
  } catch (e) {
    return fail(502, `Kalshi could not be reached just now. The reason given was: ${(e as Error).message.slice(0, 160)}`);
  }
}

/**
 * POLYMARKET SEARCH (2026-10-10): Gamma's text search (or a pasted condition id / event slug) → events with their BINARY markets (YES =
 * the first outcome, NO the second; each a one-shot selector), the event as a recurring selector (`event:<slug>`), and the tags seen on
 * the hits as recurring selectors (`tag:<slug>`, `tag:<slug>/moneyline` where the hits are games). The refuse list marks refused events;
 * a refused market is never offered. No prices, odds or volume are returned (venues.ts).
 */
export async function polymarketSearch(p: Platform, q: { q?: string | null; status?: string | null }): Promise<ApiResult> {
  const query = (q.q ?? "").trim();
  const status = q.status === "closed" || q.status === "all" ? q.status : "open";
  if (p.polymarketDiscovery === false) return fail(503, POLYMARKET_UNAVAILABLE);
  if (query.length < 2) return fail(400, "Type at least two characters. You can search for a team, a person, an event, an event slug or a condition id.");
  try {
    const r = scrubMarketData(await p.polymarket.search(query, { status, limit: 10 }));
    return ok({ query, status, venue: "polymarket", events: r.events, markets: r.markets, tags: r.tags, note: "Only yes-or-no markets are listed. YES is a market's first outcome and NO is its second. The result is read from the on-chain payout on Polygon. No prices, odds or volume are returned." });
  } catch (e) {
    return fail(502, `Polymarket could not be reached just now. The reason given was: ${(e as Error).message.slice(0, 160)}`);
  }
}

/** The back-test of a rule from the venue's own settled history (catalogue rules: the source's frozen fixture; Polymarket: Gamma's closed markets). */
export async function runBacktest(p: Platform, body: { rule?: unknown; months?: unknown }, now = Date.now()): Promise<ApiResult> {
  let locked: LockedRule;
  try { locked = lockRule(body.rule); } catch (e) { return fail(400, (e as Error).message); }
  const months = Math.min(24, Math.max(1, Number(body.months ?? 12) || 12));
  try {
    if (locked.rule.oracle === "catalogue" && nativeSourceById(locked.rule.series!)) {
      // native first-party source (ESPN scoreboard, NWS climate): a live read of what it has published — display-grade, no cross-read
      const src = nativeSourceById(locked.rule.series!)!;
      const np = nativeRuleProblems(src, locked.rule);
      if (np.length) return fail(400, np.join("; "), { problems: np });
      const since = new Date(now); since.setUTCMonth(since.getUTCMonth() - months);
      const r = await src.settledSince(locked.rule, since.toISOString().slice(0, 10), { crossRead: false });
      const b = backtest(locked.rule, r.events, now, months);
      const pv = { ...b, window: { from: r.events[0]?.at ?? "", to: r.events[r.events.length - 1]?.at ?? "" }, lastReading: r.events[r.events.length - 1] ?? null };
      return ok({ rule: locked.rule, text: locked.text, sha256: locked.sha256, sha12: locked.sha12, mode: locked.mode, statement: ruleStatement(locked.rule, { feedTitle: src.title }), backtest: pv, sentence: `${backtestSentence(b)} This was read live from ${src.sourceName.split(" · ")[0]} and is for display only.${src.crossRead ? ` The keeper also checks ${src.crossRead}.` : ""}`, refusals: [], seriesTitle: src.title, matched: r.events.length });
    }
    if (locked.rule.oracle === "catalogue") {
      const feed = feedById(locked.rule.series!);
      if (!feed) return fail(400, `There is no feed called ${locked.rule.series}.`);
      const pv = previewFromFixture(feed, locked.rule, now);
      return ok({ rule: locked.rule, text: locked.text, sha256: locked.sha256, sha12: locked.sha12, mode: locked.mode, statement: ruleStatement(locked.rule, { feedTitle: feed.title }), backtest: pv, sentence: `${backtestSentence(pv)} This comes from the feed's saved sample, from ${pv.window.from} to ${pv.window.to}.`, refusals: [], seriesTitle: feed.title, matched: pv.rows.length });
    }
    if (locked.rule.oracle === "polymarket") { if (p.polymarketDiscovery === false) return fail(503, POLYMARKET_UNAVAILABLE); return await polymarketBacktest(p, locked, months); }
    if (locked.rule.oracle !== "kalshi") return fail(400, `The ${locked.rule.oracle} source is not live yet. Kalshi, Polymarket and our own feeds are live.`);
    if (p.kalshiEnabled === false) return fail(503, KALSHI_UNAVAILABLE);
    const since = new Date(now); since.setUTCMonth(since.getUTCMonth() - months);
    const r = await p.kalshi.settledSince(locked.rule, since.toISOString(), { limitPages: 10 });
    const seriesTicker = locked.rule.series ?? locked.rule.market!.split("-")[0];
    const info = await p.kalshi.seriesInfo(seriesTicker).catch(() => null);
    const oneShotClose = locked.rule.market ? (await p.kalshi.openMarkets(seriesTicker).catch(() => [])).find((m) => m.ticker === locked.rule.market)?.closeTime ?? null : null;
    const bt = backtest(locked.rule, r.events, now, months, oneShotClose);
    const refusals = refusalsFor(loadRefuseList(), { titles: [info?.title ?? "", ...r.events.map((e) => e.title ?? "")], categories: info?.category ? [info.category] : [] });
    return ok({ rule: locked.rule, text: locked.text, sha256: locked.sha256, sha12: locked.sha12, mode: locked.mode, statement: ruleStatement(locked.rule, { seriesTitle: info?.title ?? null }), backtest: bt, sentence: backtestSentence(bt), refusals, seriesTitle: info?.title ?? null, settlementSourceUrl: r.settlementSourceUrl, awaitingFinal: r.awaitingFinal, oracleRefusals: r.refusals, matched: r.events.length });
  } catch (e) {
    return fail(502, `The back-test could not run just now. The reason given was: ${(e as Error).message.slice(0, 160)}`);
  }
}

/**
 * A Polymarket back-test: the selector's closed markets as GAMMA reports them resolved, over the window (paged; a dense selector says
 * where the scan stopped), through the same unit engine. Display-grade by design: the keeper reads every result from the Polygon
 * payout vector instead, and holds a market whose vector is not on chain.
 */
async function polymarketBacktest(p: Platform, locked: LockedRule, months: number): Promise<ApiResult> {
  const key = locked.rule.market ?? locked.rule.series!;
  const info = await p.polymarket.seriesInfo(key).catch(() => null);
  if (!info) return fail(404, `Polymarket does not know ${key}. Use a condition id, a tag or an event.`);
  const at = p.polymarket.clock();   // the client's clock (Date.now() in production; fixed in the fixture tests)
  const since = new Date(at); since.setUTCMonth(since.getUTCMonth() - months);
  const r = await p.polymarket.gammaSettled(locked.rule, since.toISOString(), 40);
  const bt = backtest(locked.rule, r.events, at, months, r.oneShotCloseTime);
  const refusals = refusalsFor(loadRefuseList(), { titles: [info.title] });
  const names = locked.rule.market ? { marketTitle: info.title } : { seriesTitle: info.title };
  return ok({ rule: locked.rule, text: locked.text, sha256: locked.sha256, sha12: locked.sha12, mode: locked.mode, statement: ruleStatement(locked.rule, names), backtest: bt,
    sentence: `${backtestSentence(bt)} This comes from Gamma's closed markets. The keeper reads each result from the Polygon payout vector.`, refusals, seriesTitle: info.title, settlementSourceUrl: POLYGONSCAN_CTF,
    awaitingFinal: r.awaitingFinal, oracleRefusals: [...r.refusals, ...(r.complete ? [] : [`The scan stopped after ${r.scanned} ${r.scanned === 1 ? "market" : "markets"}, before ${since.toISOString().slice(0, 10)}. Older results are not in this back-test.`])],
    matched: r.events.length, venue: "polymarket", scanComplete: r.complete });
}

export interface PreparedLaunch { bundle: LaunchBundle; token: TokenRow | null; seriesTitle: string | null; locked: LockedRule; preflight: PreflightResult | null }
export interface PreparedPair { pairId: string; selector: string; notes: string[]; row: PairRow | null; bundles: { a: LaunchBundle; b: LaunchBundle }; tokens: { a: TokenRow | null; b: TokenRow | null }; seriesTitle: string | null; preflight: PreflightResult | null; /** BURNTICKER_PAIR_CURVE_ENABLED: the pair launches through pair_curve (sign this instead of the two LaunchLab bundles). */ pairCurve?: PairCurveLaunchBundle }
interface PairSideInput { ticker?: unknown; name?: unknown; description?: unknown; imageUrl?: unknown; links?: unknown }

/**
 * Validation, refusals and the bundle — the launch route's whole pipeline. Refuses: invalid input, rules that do not lock, catalogue
 * rules that disagree with their feed, an unreadable Kalshi series, the refuse list (titles, categories, names), a taken ticker,
 * mainnet without the host's allowance, an opening purchase, vault mode. `register` stores the DRAFT (and the keeper's attester row) as the wizard always has. `mint` = the caller's own mint public
 * key (the public API: the secret never travels); absent = a fresh keypair whose secret rides in the bundle (the wizard).
 *
 * RIVALRY PAIRS: a body with `pair: { ticker, name, … }` launches side B with the derived (inverted) rule alongside side A
 * (buildPairBundles); refusals and the tier rule apply per side, and both drafts plus the pair row are registered together. A rule that
 * carries a `pair` field must come through that flow.
 */
export async function prepareLaunch(p: Platform, body: Record<string, unknown>, o: { register: boolean; mint?: string | null; preflight?: { strict?: boolean; deps?: PreflightDeps } }): Promise<{ error: ApiResult } | { ok: PreparedLaunch } | { pair: PreparedPair }> {
  const b = body as Partial<LaunchInput> & { acknowledgements?: { ruleLocked?: unknown; noReturns?: unknown }; pair?: PairSideInput | null };
  const input: LaunchInput = { creator: String(b.creator ?? ""), ticker: String(b.ticker ?? "").toUpperCase(), name: String(b.name ?? ""), description: String(b.description ?? ""), imageUrl: b.imageUrl ? String(b.imageUrl) : null, links: Array.isArray(b.links) ? b.links : [], rule: b.rule, firstBuySol: String(b.firstBuySol ?? "0"), acknowledgements: { ruleLocked: !!b.acknowledgements?.ruleLocked, noReturns: !!b.acknowledgements?.noReturns }, cluster: p.cluster, ...(b.raiseSol === undefined || b.raiseSol === null ? {} : { raiseSol: String(b.raiseSol) }) };
  // NO BURN POOL IS EVER LEFT BEHIND (owner, 2026-10-10): every new launch carries the onEnd clause unless the rule names its own —
  // since §45 with the end sink (rules.ts DEFAULT_ON_END / defaultOnEndFor; it is part of the canonical rule, so the hash locks it).
  if (input.rule && typeof input.rule === "object" && !Array.isArray(input.rule) && (input.rule as { onEnd?: unknown }).onEnd === undefined) input.rule = { ...(input.rule as object), onEnd: defaultOnEndFor(input.rule) };
  const problems = launchProblems(input);
  if (o.mint !== undefined && o.mint !== null && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(o.mint)) problems.push("The mint must be the public key of a new mint keypair that you made.");
  // website-14 (LAUNCHPAD-PATH §75): on mainnet the graduation raise is 40, 60 or 85 SOL, nothing else (launchBundle.ts raiseProblem)
  const raiseOff = raiseProblem(input.raiseSol, p.cluster);
  if (raiseOff) return { error: fail(400, raiseOff, { code: "raise-not-preset", problems }) };
  if (problems.length) return { error: fail(400, problems.join("; "), { problems }) };
  // launch-10 (2026-10-12; hostedLaunch.ts): what a launch built by this site never carries, refused before anything is read, pinned or
  // registered. Mainnet only with the host's explicit allowance (passed to the builder below as allowMainnet); no opening purchase (a
  // create with one does not fit one transaction; the CLI keeps --first-buy-sol); no vault mode (it needs a signature no wallet can give).
  if (p.cluster === "mainnet" && p.allowMainnet !== true) return { error: fail(403, MAINNET_OFF_SENTENCE, { code: "mainnet-launches-off" }) };
  if (requestedOpeningPurchase(b.firstBuySol) !== 0) return { error: fail(400, NO_OPENING_PURCHASE_SENTENCE, { code: "opening-purchase-off" }) };
  let locked: LockedRule;
  try { locked = lockRule(input.rule); } catch (e) { return { error: fail(400, (e as Error).message) }; }
  if (locked.mode === "vault") return { error: fail(400, VAULT_HIDDEN_SENTENCE, { code: "vault-off" }) };
  if (locked.rule.oracle === "kalshi" && p.kalshiEnabled === false) return { error: fail(503, KALSHI_UNAVAILABLE) };
  const list = loadRefuseList();
  const refusals: Refusal[] = nameRefusals(list, input.name, input.ticker);
  let seriesTitle: string | null = null;
  let feedText: { title: string; sourceName: string; unitLabel: string } | null = null;
  // THE CREATOR'S TEXT (owner decision 2026-10-10): the name, the ticker and the optional note pass the copy lint with the creator scope
  // (every platform rule + no-affiliation: official, endorsed, partner…, links, handles) — a hit refuses with the category named.
  const note = typeof (body as { note?: unknown }).note === "string" ? String((body as { note: string }).note).trim() : "";
  if (note.length > NOTE_MAX) return { error: fail(400, `The creator's note can be at most ${NOTE_MAX} characters.`) };
  const textProblems = creatorTextProblems({ name: input.name, ticker: input.ticker, note });
  if (textProblems.length) return { error: fail(403, `This launch is refused: ${textProblems.map((x) => x.reason).join("; ")}`, { code: "copy-lint", categories: [...new Set(textProblems.map((x) => x.category))], problems: textProblems.map((x) => x.reason) }) };
  // THE IMAGE IS THE GENERATED RECEIPT ART (owner decision 2026-10-10); a creator's own image only with BURNTICKER_CUSTOM_IMAGES_ENABLED.
  if (input.imageUrl && !p.customImages) return { error: fail(400, "This site does not take custom images. Every coin's image is its generated receipt art.", { code: "custom-image-off" }) };
  const native = locked.rule.oracle === "catalogue" ? nativeSourceById(locked.rule.series!) : null;
  if (native) {
    const np = nativeRuleProblems(native, locked.rule);
    if (np.length) return { error: fail(400, np.join("; "), { problems: np }) };
    seriesTitle = native.title;
  } else if (locked.rule.oracle === "catalogue") {
    const feed = feedById(locked.rule.series!);
    if (!feed) return { error: fail(400, `unknown feed ${locked.rule.series}`) };
    feedText = feed.unit ? { title: feed.title, sourceName: feed.sourceName, unitLabel: feed.unit.label } : null;
    const fp = feedRuleProblems(feed, locked.rule);
    if (fp.length) return { error: fail(400, fp.join("; "), { problems: fp }) };
    seriesTitle = feed.title;
  } else if (locked.rule.oracle === "kalshi") {
    const info = await p.kalshi.seriesInfo(locked.rule.series ?? locked.rule.market!.split("-")[0]).catch(() => null);
    if (!info) return { error: fail(502, "The Kalshi series could not be read. Please try again.") };
    seriesTitle = info.title;
    refusals.push(...refusalsFor(list, { titles: [info.title], categories: info.category ? [info.category] : [] }));
  } else if (locked.rule.oracle === "polymarket") {
    const key = locked.rule.market ?? locked.rule.series!;
    const info = await p.polymarket.seriesInfo(key).catch(() => null);
    if (!info) return { error: fail(502, `${key} could not be read from Polymarket. The condition id, tag or event may be unknown, or Gamma did not answer. Please try again.`) };
    seriesTitle = info.title;
    refusals.push(...refusalsFor(list, { titles: [info.title] }));
    if (locked.rule.market) {
      const m = await p.polymarket.marketByCondition(locked.rule.market).catch(() => null);
      if (m && !isBinary(m)) return { error: fail(400, `Polymarket market ${key} has ${m.outcomes.length} outcomes. Only yes-or-no markets can be used for now.`) };
    } else {
      // One keeper cycle must cover a week of the selector's closed markets (the scan cap): a denser tag is narrowed or refused.
      let scan;
      try { scan = await p.polymarket.candidates(wideRule(locked.rule), { closed: true, sinceIso: new Date(p.polymarket.clock() - 7 * 86_400_000).toISOString() }); }
      catch (e) { return { error: fail(502, `A week of ${key} could not be read from Polymarket to check how many markets it settles. The reason given was: ${(e as Error).message.slice(0, 120)}`) }; }
      if (!scan.complete) return { error: fail(400, `${key} settles more than ${p.polymarket.pageCap * p.polymarket.pageSize} Polymarket markets a week. Narrow it to one market type, such as moneyline, or to one event pattern.`) };
    }
  } else if (locked.rule.oracle === "derby") {
    // BURN DERBY (2026-10-10): platform coins never sit on the input side; the refuse list over the coins; a Pyth feed or ≥ $250K of
    // liquidity; distinct coins; a season that starts after launch; a bracket slot that matches its registered tournament.
    let dr;
    try { dr = await derbyAdmission(locked.rule, { registry: p.registry, fetchImpl: p.derbyFetch ?? (globalThis.fetch as unknown as FetchLike), now: Date.now(), refuse: list }); }
    catch (e) { return { error: fail(502, `A second source for the Burn Derby could not be read, so liquidity could not be checked. The reason given was: ${(e as Error).message.slice(0, 120)}`) }; }
    if (dr.length) return { error: fail(403, `This launch is refused: ${dr.map((r) => r.reason).join("; ")}`, { code: "refused", refusals: dr }) };
    seriesTitle = derbyTitle(locked.rule);
  } else return { error: fail(400, `Coins cannot launch on the ${locked.rule.oracle} source yet. Kalshi, Polymarket, our own feeds and the Burn Derby are live.`) };
  if (refusals.length) return { error: fail(403, `This launch is refused: ${refusals.map((r) => r.reason).join("; ")}`, { code: "refused", refusals }) };
  if (p.registry.tickerTaken(input.ticker)) return { error: fail(409, `The ticker ${input.ticker} is taken.`, { code: "ticker-taken" }) };
  if (o.mint && p.registry.token(o.mint)) return { error: fail(409, `The mint ${o.mint} is already registered.`, { code: "mint-taken" }) };
  { const g = await launchGuardRefusal(p, { ticker: input.ticker, name: input.name, rule: locked.rule, mint: o.mint ?? null }); if (g) return { error: fail(g.status, g.error, g.extra) }; }   // lookalike + no adoption (growth batch; lookalike.ts)
  // THE CREATION PREFLIGHT (2026-10-10, the settlement-coverage audit): the selector run live once — primary + independent cross-read
  // (Polymarket: the payout vector + Gamma) — and creation refused if anything fails. Kalshi is always refused here: its terms forbid
  // settling products on its data. BURNTICKER_PREFLIGHT_STRICT=0 skips it (the test hook does, for the suite).
  let preflight: PreflightResult | null = null;
  if (o.preflight?.strict ?? preflightStrict()) {
    preflight = await preflightSelector(locked.rule, { polymarket: p.polymarket, derby: { pools: p.derbyPools ?? null, fetchImpl: p.derbyFetch, hermes: p.derbyHermes ?? null }, ...(o.preflight?.deps ?? {}) });
    if (preflight.refusal) return { error: fail(preflight.refusal.status, `The check run before launch refused this coin: ${preflight.refusal.reason}`, { code: "preflight", problems: [preflight.refusal.reason], preflight }) };
  }
  // THE DESCRIPTION IS GENERATED (coinText.ts): whatever `description` the request carried, the coin's is describe.ts's paragraph for
  // the locked rule (+ the rule footer the bundle appends); the request's descCtx is checked word by word before it reaches a template.
  const ctxA = serverDescribeCtx(locked.rule, (body as { descCtx?: unknown }).descCtx, { seriesTitle, feed: feedText });
  input.description = generatedParagraph(locked.rule, input.ticker, ctxA);
  // NOTHING ABOUT A COIN CAN CHANGE AFTER LAUNCH (pin.ts): the metadata JSON and the receipt art are pinned on Arweave before the
  // bundle is built, and the token URI is the arweave URL. An upload failure refuses the launch; the hosted JSON only behind
  // BURNTICKER_ALLOW_HOSTED_METADATA (devnet scripts). A preview bundle (register: false) pins nothing and says so.
  const pins = new Map<string, PinnedCoin | null>();
  const pinFor = async (sideRule: LockedRule, ticker: string, name: string, description: string, links: { label: string; url: string }[], imageUrl: string | null): Promise<{ error: ApiResult } | { pin: PinnedCoin | null }> => {
    if (!o.register) return { pin: null };
    const registered = registeredDescription(sideRule, description);
    const uploader = p.uploader ?? null;
    // THE HOST'S DAILY UPLOAD BUDGET (ChatGPT/Codex review N4, 2026-10-10): pins are paid by the platform before any wallet signs, so
    // however the request arrives (the legacy wizard route or /v1, any number of clients) at most BURNTICKER_PIN_DAILY_CAP coins are
    // pinned per UTC day on this host; past it the launch is refused before anything is uploaded or registered.
    const budgetKey = `pin.budget.${new Date().toISOString().slice(0, 10)}`;
    const used = Number(p.registry.getStatus(budgetKey) ?? 0) || 0;
    const cap = p.pinDailyCap ?? DEFAULT_PIN_DAILY_CAP;
    if (uploader && used >= cap) return { error: fail(429, `This site has used up its daily upload limit of ${cap} coins. Please try again after midnight UTC.`, { code: "upload-budget" }) };
    try {
      if (!uploader) throw new Error("this site has no Arweave uploader set up");
      p.registry.setStatus(budgetKey, String(used + 1));
      const pin = await pinCoin(uploader, { ticker, name, description: metadataDescription(sideRule, registered), oneLiner: describeRule(sideRule.rule, { ticker }).oneLiner, rule: sideRule.rule, rulesSha256: sideRule.sha256, origin: publicOrigin(), links, imageUrl });
      pins.set(ticker, pin);
      return { pin };
    } catch (e) {
      if (p.allowHostedMetadata) { pins.set(ticker, null); return { pin: null }; }
      // polish-1: the owner's phone hears about a refused pin (push.ts reads the alerts table; one row per ticker per Denver day)
      try { p.registry.recordAlert({ kind: "bt-pin-failed", key: `bt-pin-failed:${ticker}`, text: `$${ticker}: the coin's details could not be saved on Arweave, so its launch was refused. ${(e as Error).message.slice(0, 160)}`, meta: { ticker } }); } catch { /* the alert never changes the answer */ }
      return { error: fail(502, `The coin's details could not be saved on Arweave, so the launch is refused. A coin's details are never kept on a server that could change them. The reason given was: ${(e as Error).message.slice(0, 160)}`, { code: "pin-failed" }) };
    }
  };
  const uriFor = (ticker: string) => (m: string) => { const pin = pins.get(ticker); return pin ? pin.metadataUri : o.register ? `${publicOrigin()}/api/burnticker/metadata/${m}` : "ar://pending-upload-at-launch"; };
  const deps = { program: p.program, launchLab: p.launchLab, devFeeWallet: p.devFeeWallet, attesters: p.keeperPubkey ? [p.keeperPubkey] : [], quorum: 1, metadataUri: uriFor(input.ticker), keeperPubkey: p.keeperPubkey, allowMainnet: p.allowMainnet === true };
  const register = (bundle: LaunchBundle, ticker: string, imageUrl: string | null, links: { label: string; url: string }[], creatorNote = "", poolId: string | null = bundle.addresses.poolId): TokenRow => {
    const token = p.registry.register({ mint: bundle.mint, ticker, name: bundle.name, creator: input.creator, description: bundle.description, imageUrl, links, rulesText: bundle.rules.text, feePda: bundle.addresses.feePda, vault: bundle.addresses.vault, tokenConfig: bundle.addresses.tokenConfig, poolId, launchTx: null, cluster: p.cluster, platformId: bundle.addresses.platformId, baselineAt: new Date().toISOString(), status: "draft" });
    if (p.keeperPubkey) p.registry.addAttester({ mint: token.mint, pubkey: p.keeperPubkey, role: "data-key", addedAt: Date.now(), timelockUntil: null });
    const pin = pins.get(ticker) ?? null;
    p.registry.putTokenMeta({ mint: token.mint, creatorNote, metadataUri: pin?.metadataUri ?? null, metadataTx: pin?.metadataTx ?? null, metadataSha256: pin?.metadataSha256 ?? null, imageUri: pin?.imageUri ?? null, imageTx: pin?.imageTx || null, imageSha256: pin?.imageSha256 || null, hosted: !pin });
    return token;
  };
  if (b.pair) {
    if (o.mint) return { error: fail(400, "A rivalry pair is launched through the pair steps on the launch page, with two new mints. The public API takes one coin at a time.") };
    const side = { ticker: String(b.pair.ticker ?? "").toUpperCase(), name: String(b.pair.name ?? ""), description: String(b.pair.description ?? ""), imageUrl: b.pair.imageUrl ? String(b.pair.imageUrl) : null, links: Array.isArray(b.pair.links) ? b.pair.links as { label: string; url: string }[] : [] };
    const sideText = creatorTextProblems({ name: side.name, ticker: side.ticker, note: "" });
    if (sideText.length) return { error: fail(403, `Side B is refused: ${sideText.map((x) => x.reason).join("; ")}`, { code: "copy-lint", categories: [...new Set(sideText.map((x) => x.category))], problems: sideText.map((x) => x.reason) }) };
    if (side.imageUrl && !p.customImages) return { error: fail(400, "Side B cannot use a custom image. This site does not take custom images. Every coin's image is its generated receipt art.", { code: "custom-image-off" }) };
    const bProblems = launchProblems({ ...input, ...side });
    if (bProblems.length) return { error: fail(400, `Side B has a problem: ${bProblems.join("; ")}`, { problems: bProblems }) };
    const bRefusals = nameRefusals(list, side.name, side.ticker);
    if (bRefusals.length) return { error: fail(403, `Side B is refused: ${bRefusals.map((r) => r.reason).join("; ")}`, { code: "refused", refusals: bRefusals }) };
    if (p.registry.tickerTaken(side.ticker)) return { error: fail(409, `The ticker ${side.ticker} is taken.`, { code: "ticker-taken" }) };
    { const g = await launchGuardRefusal(p, { ticker: side.ticker, name: side.name, rule: null }); if (g) return { error: fail(g.status, `Side B is refused. ${g.error}`, g.extra) }; }
    try {
      // Side B's rule is side A's inverted (buildPairBundles); its description is generated from that rule after the bundle locks it.
      const probe = await buildPairBundles({ a: input, b: { ...side, description: "" }, voidBy: await oneShotVoidBy(p, locked) ?? undefined }, { ...deps, metadataUri: () => "ar://pending-upload-at-launch" });
      const lockedB = lockRule(JSON.parse(probe.b.rules.text)), lockedA = lockRule(JSON.parse(probe.a.rules.text));
      side.description = generatedParagraph(lockedB.rule, side.ticker, serverDescribeCtx(lockedB.rule, null, { seriesTitle, feed: feedText }));
      input.description = generatedParagraph(lockedA.rule, input.ticker, ctxA);
      for (const [lk, tk, nm, desc, links, img] of [[lockedA, input.ticker, input.name, input.description, input.links, input.imageUrl], [lockedB, side.ticker, side.name, side.description, side.links, side.imageUrl]] as const) {
        const r = await pinFor(lk, tk, nm.trim(), desc, links, img);
        if ("error" in r) return r;
      }
      const pair = await buildPairBundles({ a: input, b: side, voidBy: await oneShotVoidBy(p, locked) ?? undefined }, { ...deps, metadataUri: uriFor(input.ticker), metadataUriB: uriFor(side.ticker) } as typeof deps);
      // 2026-10-10: behind BURNTICKER_PAIR_CURVE_ENABLED (default off) the pair launches through pair_curve (both graduate or neither).
      // Review N6: built BEFORE the drafts (a refused parameter set leaves no orphan draft), and the drafts then carry no LaunchLab
      // pool — under the pair curve the pool is the CPMM pool its graduation creates, registered later (policy 2).
      const pairCurve = pairCurveEnabled(process.env) ? await buildPairCurveLaunch(pair, input.creator, { cluster: p.cluster, burnReceiptsProgramId: p.program.programId, cpConfigId: process.env.BURNTICKER_CP_CONFIG_ID?.trim() || undefined }) : undefined;
      const tokenA = o.register ? register(pair.a, input.ticker, input.imageUrl, input.links, note, pairCurve ? null : pair.a.addresses.poolId) : null;
      const tokenB = o.register ? register(pair.b, side.ticker, side.imageUrl, side.links, "", pairCurve ? null : pair.b.addresses.poolId) : null;
      const row = tokenA && tokenB ? p.registry.registerPair(pair.pairId, tokenA.mint, tokenB.mint) : null;
      return { pair: { pairId: pair.pairId, selector: pair.selector, notes: pair.notes, row, bundles: { a: pair.a, b: pair.b }, tokens: { a: tokenA, b: tokenB }, seriesTitle, preflight, ...(pairCurve ? { pairCurve } : {}) } };
    } catch (e) {
      return { error: fail(400, (e as Error).message) };
    }
  }
  if (locked.rule.pair) return { error: fail(400, "A rule that names a pair is launched through the pair steps. Send side B as a pair with its own ticker and name.") };
  try {
    const pr = await pinFor(locked, input.ticker, input.name.trim(), input.description, input.links, input.imageUrl);
    if ("error" in pr) return pr;
    const bundle = await buildLaunchBundle(input, { ...deps, ...(o.mint ? { mint: o.mint } : {}) });
    const token = o.register ? register(bundle, input.ticker, input.imageUrl, input.links, note) : null;
    return { ok: { bundle, token, seriesTitle, locked, preflight } };
  } catch (e) {
    return { error: fail(400, (e as Error).message) };
  }
}

/** Coins pinned on Arweave per UTC day per host when BURNTICKER_PIN_DAILY_CAP is not set (review N4). */
export const DEFAULT_PIN_DAILY_CAP = 50;

/**
 * `launched`: the landed launch transaction takes the draft live. ChatGPT/Codex review N1 (2026-10-10): the transaction is verified on
 * chain first (launchVerify.ts: successful, signed by the coin's mint and its creator, landed after the draft, carrying burn_receipts
 * initialize_token for this mint, the on-chain TokenConfig locking the draft's rules hash, and the venue completed — review-2 F3) and
 * the baseline is its BLOCK TIME; the same signature again is a no-op that leaves the baseline alone; a host without an RPC refuses.
 */
export async function markLaunched(p: Platform, mint: string, launchTx: string): Promise<ApiResult> {
  const t = p.registry.token(mint);
  if (!t) return fail(404, "There is no draft for this mint.");
  if (!/^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(launchTx)) return fail(400, "The launch transaction must be a transaction signature.");
  if (t.launchTx === launchTx) return ok({ ok: true, token: t, replay: true, note: `This launch was already confirmed in this transaction. The start time stays ${t.baselineAt}, which was fixed at launch.` });
  if (t.launchTx) return fail(409, `${mint} already launched in transaction ${t.launchTx}.`);
  if (t.status !== "draft") return fail(409, t.status === "expired" ? `The draft ${mint} expired because it did not launch within 24 hours. Please build a new launch.` : `${mint} is ${t.status}, so it is not a draft.`);
  if (!p.launchVerifier) return fail(503, "This site cannot check a launch transaction right now. A draft goes live only after its launch is read from the chain.", { code: "launch-unverifiable" });
  // Review-2 F3: the verifier checks the launch's CONTENT (initialize_token for this mint, the on-chain TokenConfig's rules hash, the
  // venue) — and nothing is written to the registry unless it passes: a refused confirmation leaves status, baseline and launch_tx alone.
  const v = await p.launchVerifier.verify(launchTx, { mint, creator: t.creator, draftCreatedAtMs: t.createdAt, rulesSha: t.rulesSha, venue: launchVenueOf(t, p.registry.pairOf(mint)) });
  if (!v.ok) return fail(v.status, v.reason, { code: "launch-unverified" });
  const baselineAt = new Date(v.blockTimeMs).toISOString();
  try { p.registry.markLaunched(mint, launchTx, t.poolId, baselineAt); } catch (e) { return fail(409, (e as Error).message); }
  return ok({ ok: true, token: p.registry.token(mint), note: `The launch transaction was read from the chain. The start time is its block time, ${baselineAt}. Results settled after this moment count.` });
}
