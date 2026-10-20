import { burnTargetShapeProblems, type BurnTargetField } from "@/lib/burnticker/burnTarget";
import { burnRealFromEnv, burnSolEnabledFromEnv, launchModeFromEnv } from "@/lib/burnticker/launchAvailability";
import { alertLaunchAdmittedAfterClosure, alertLaunchAfterClosure, alertLaunchLate, recordedClosure } from "@/lib/burnticker/draftReconciler";
import { admitAfterClosure, planGateOf } from "@/lib/burnticker/launchGateAdmission";
import { webDispersalOn } from "@/lib/burnticker/programHash";
import type { Platform } from "@/lib/burnticker/server";
import { Keypair, PublicKey } from "@solana/web3.js";
import { launchLabCostLamports, solText } from "@/lib/burnticker/launchCost";
import { EVENT_LEVEL_REFUSAL, eventLevelRule, meetingsPairNames, MEETINGS_NONE_LEFT_LINE, MEETINGS_NONE_LINE, RIVALRY_GAME_LABEL, oneGameSearchLine, FBS_DEFAULT_LINE, RIVALRY_SERIES_LABEL, RIVALRY_SERIES_LINE } from "@/lib/burnticker/guidedLaunch";
import { catalogue, fixtureReadings, previewFromFixture, feedById, feedRuleProblems, loadFixture, verifyUrl, type Feed } from "@/lib/burnticker/catalogue";

import { liveSinks } from "@/lib/burnticker/endSinks";
import { REAL_BURN_FAMILY_CODE, realBurnFamilyProblem } from "@/lib/burnticker/burnRealEligibility";
import { burnRealRefusal, identityRefusals, ruleRefusals, sampleEligibility, settledPairInput, settledPairSinkProblems } from "@/lib/burnticker/launchPreflight";
import { teamTicker } from "@/lib/burnticker/tickers";
import { knownLookalike } from "@/lib/burnticker/ops/cloneServe";
export { sampleEligibility };
import { ONCHAIN_FACTS, onchainSource } from "@/lib/burnticker/sources/onchain";
import { driftBetStub, hedgehogStub, polymarketCard, umaStub } from "@/lib/burnticker/sources/stubs";
import { TIER_LABEL, sourceTypeLabel } from "@/lib/burnticker/sources/types";
import type { HttpSourceConfig } from "@/lib/burnticker/sources/attestedHttp";
import { validateRule, lockRule, ruleStatement, isMeetingsRule, BURNTICKER_RULES_SCHEMA, defaultOnEndFor, type LockedRule } from "@/lib/burnticker/rules";
import { summariseOpen } from "@/lib/burnticker/oracle/kalshi";
import { gameSides, legFilterCollisions, ownLegFilter, type EventHit } from "@/lib/burnticker/oracle/events";
import { POLYMARKET_TAG_FOR, type BrowseSeries } from "@/lib/burnticker/oracle/browse";
import { categoryCards, categoryList, formatReading, loadCategories, type FeedCardInput, publishedDataCategories } from "@/lib/burnticker/browse";
import { KALSHI_UNAVAILABLE, POLYMARKET_UNAVAILABLE, scrubMarketData, type VenueFlags } from "@/lib/burnticker/venues";
import { espnClient, fecClient, nativeRuleProblems, nativeSourceById } from "@/lib/burnticker/sources/native";
import { electionPairTemplate } from "@/lib/burnticker/electionPair";
import { publicOrigin } from "@/lib/burnticker/coinArt";
import { CROSS_LABEL, countedOfficialOf } from "@/lib/burnticker/sources/gameSettle";
import { scheduleProblem } from "@/lib/burnticker/sources/provenance";
import { badgeCreatorImage, checkCreatorImage } from "@/lib/burnticker/creatorBadge";
import { DESCRIPTION_MAX, RIGHTS_LINE, decodeCreatorImage, withCreatorText } from "@/lib/burnticker/creatorProfile";
import { IMAGE_URL_REFUSED, imageUrlSent } from "@/lib/burnticker/imagePin";
import { seasonOverFor, seasonStatus } from "@/lib/burnticker/seasonOver";
import { creatorTextProblems, generatedParagraph, metadataDescription, NOTE_MAX, registeredDescription, serverDescribeCtx, sideBDescribeCtx, statedCtx } from "@/lib/burnticker/coinText";
import { pinCoin, sha256Hex, uploadMayHaveCompleted, type PinHooks, type PinnedCoin } from "@/lib/burnticker/pin";
import { checkWalletProof, provenReviewCreator, spendProof } from "@/lib/burnticker/walletProofCheck";
import { safeErrorText } from "@/lib/burnticker/api/errorText";
import { describeRule } from "@/lib/burnticker/describe";
import { CLOSING_SOON_HOURS, universalSearch, dedupeTickers, derbyHrefFrom, polyRule, type FeedLike } from "@/lib/burnticker/search";
import { BALLOT_NOTE, RACE_TYPES, candidateMappingLine, loadRaces, outcomeCardTitle, outcomeSettlesNote, stateName } from "@/lib/burnticker/elections";
import { LEAGUES, LIVE_NOW, noPlayoffs, isLive, pickerTeams, teamCodeOf, NBA_FEED_WORDING, SCHEDULE_NEEDS_KEY, SPORTS, ScheduleUnavailable, gameSeries, isLeague, findTeams, seasonYearAt, teamSeries, teamsOf, teamByAbbr, meetingsPairSeries, meetingOutcome, tallyMeetings, seasonLabel, within, type Game, type LeagueId, isFallbackGame, FALLBACK_ONLY_LINE } from "@/lib/burnticker/sources/espn";
import type { PolyEventHit } from "@/lib/burnticker/oracle/polymarket";
import { backtest, backtestSentence } from "@/lib/burnticker/oracle/backtest";
import { isBinary, POLYGONSCAN_CTF } from "@/lib/burnticker/oracle/polymarket";
import { inDraftWindow, RegistrySchemaNewerError, RevivalTickerHeldError, TickerAlreadyLiveError, TickerTakenError, wideRule } from "@/lib/burnticker/registry";
import { loadRefuseList, nameRefusals, refusalMessage, refusalsFor, type Refusal } from "@/lib/burnticker/oracle/refuse";
import { existingCoinsFor } from "@/lib/burnticker/duplicateRuleMatch";
import { buildLaunchBundle, buildPairBundles, defaultVoidBy, launchProblems, raiseProblem, type LaunchBundle, type LaunchInput } from "@/lib/burnticker/launchBundle";
import { MAINNET_OFF_SENTENCE, NO_OPENING_PURCHASE_SENTENCE, VAULT_HIDDEN_SENTENCE, requestedOpeningPurchase } from "@/lib/burnticker/hostedLaunch";
import { launchVenueOf } from "@/lib/burnticker/launchVerify";
import { expectedCreateFromBundle } from "@/lib/burnticker/launchCreateArgs";
import { expectedConfigFor, expectedConfigKey, expectedHostOf, loadExpectedConfig, mergeExpected, pairCurveExpected } from "@/lib/burnticker/admission";
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
  if (d.selector === "high") return `${d.u.symbol}'s record daily close${d.span === "all" ? "" : ` over ${d.span} days`}${d.once ? ", once" : ""}`;
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
import { launchGuardRefusal, tickerTakenRefusal } from "@/lib/burnticker/launchGuards";
import { CREATE_SEND_PENDING_MS, LAUNCH_PENDING_CODE, createdOnChainBy, launchPendingRefusal, launchPendingSentence, ownLiveTickerSentence, verifySentCreate } from "@/lib/burnticker/launchPending";
import type { PreflightResult } from "@/lib/burnticker/coverage/types";
import { isSingleOfficialSource, singleSourceSentence } from "@/lib/burnticker/singleSource";
import { catalogueSettleRefusal } from "@/lib/burnticker/coverage/settleable";

/**
 * THE BURNTICKER ROUTES' SHARED LOGIC (2026-10-09). The wizard's routes (/api/burnticker/{catalogue,oracle/*,launch}) and the public
 * v1 API call the same functions, so the two can never disagree about a refusal, a hash or a fee. Each returns an ApiResult
 * ({ status, body }); the routes only wrap it in a Response. Moved verbatim from the original route files.
 */

export const ADMISSION = {
  all: ["official or primary source", "machine-readable", "timestamped", "unambiguous units", "not controlled by anyone who can hold the token", "a natural disaster only as a count or size from the agency that measures it (USGS, NHC, SPC, NIFC), never on deaths, injuries or damage", "elections only as one candidate's outcome of a Polymarket market, settled on its on-chain payout (Kalshi election series only on a host that turns Kalshi on); never a first-party election or vote feed", "never the token's own price"],
  byTier: { 1: "An adjudicated market. Only settled results count, and the venue's window for making a result final is respected.", 2: "An optimistic assertion. It counts only once it is settled and nobody disputes it.", 3: "A primary API whose reading is attested by a secure enclave or a zero-knowledge proof, using the same address and selection as tier 4. Prices of outside assets are allowed from this tier up.", 4: "A primary API read by our keeper. No asset prices are allowed. Each source has one real saved sample and limits on what a believable reading looks like.", 5: "A value read from a web page. The operator approves each source, the pattern is fixed to the page's markup, and it is never a price." },
};

/** A source config for publication: header VALUES withheld (they may carry a contact address or a key template), names kept. */
export function publicConfig(cfg: HttpSourceConfig): Record<string, unknown> {
  const { headers, ...request } = cfg.request;
  return { id: cfg.id, title: cfg.title, sourceUrl: cfg.sourceUrl, request: { ...request, headerNames: headers ? Object.keys(headers) : [] }, select: cfg.select, period: cfg.period, unit: cfg.unit, direction: cfg.direction, baseline: cfg.baseline, carry: cfg.carry, plausibility: cfg.plausibility, memoSource: cfg.memoSource, needsKey: cfg.needsKey ?? null };
}

/** Every source the wizard can show, with kind and tier (+ the public selection config when `includeConfig`). */
// owner, 2026-10-12 ("it takes over a second for the launch page to load"): building this list reads every source's fixture from disk
// and runs its preview, about a second of CPU per request, and the launch page asks for it on every load. The result depends only on the
// minute (sample eligibility) and includeConfig, so it is memoised per minute; a deploy restarts the process and empties it.
const CATALOGUE_MEMO_MS = 60_000;
const catalogueMemo = new Map<string, { sources: Record<string, unknown>[]; tiers: typeof TIER_LABEL; admission: typeof ADMISSION }>();
export function catalogueSources(now: number, o: { includeConfig?: boolean } = {}): { sources: Record<string, unknown>[]; tiers: typeof TIER_LABEL; admission: typeof ADMISSION } {
  const key = `${Math.floor(now / CATALOGUE_MEMO_MS)}:${o.includeConfig ? 1 : 0}`;
  const hit = catalogueMemo.get(key);
  if (hit) return hit;
  const value = catalogueSourcesUncached(now, o);
  if (catalogueMemo.size >= 8) catalogueMemo.delete(catalogueMemo.keys().next().value!);
  catalogueMemo.set(key, value);
  return value;
}
/** Test seam: forget the memo (a test that rewrites a fixture between two calls in the same minute). */
export function forgetCatalogueMemo(): void { catalogueMemo.clear(); }
function catalogueSourcesUncached(now: number, o: { includeConfig?: boolean } = {}): { sources: Record<string, unknown>[]; tiers: typeof TIER_LABEL; admission: typeof ADMISSION } {
  const http = catalogue().map((f) => {
    let last: { id: string; value: string | null; at: string; display: string | null } | null = null, readings: { id: string; value: string | null }[] = [], preview: unknown = null, fixtureFetchedAt: string | null = null, refusals: string[] = [];
    try {
      const fr = fixtureReadings(f, now); fixtureFetchedAt = fr.fetchedAt; refusals = fr.refusals;
      const l = fr.readings[fr.readings.length - 1] ?? null; last = l ? { id: l.id, value: l.value, at: l.at, display: l.value === null ? null : formatReading(l.value, f.valueLabel ?? null) } : null; readings = fr.readings.map((r) => ({ id: r.id, value: r.value }));
      const rule = validateRule({ schema: BURNTICKER_RULES_SCHEMA, oracle: "catalogue", series: f.id, market: null, filter: {}, kind: "scalar", scalar: { unit: f.unit!.size, perUnit: { fractionOfPool: 0.02 }, baseline: f.baseline!, direction: f.direction! }, binary: null, onVoid: "skip", floorUsd: "1", reserveSol: "0.02", vault: null });
      const pv = previewFromFixture(f, rule, now); preview = { window: pv.window, units: pv.totals.units, burnEvents: pv.totals.burnEvents, poolFractionSpent: pv.totals.poolFractionSpent };
    } catch { /* no fixture: the card says so */ }
    // intent audit 2 item 2: a one-time event that already has its result is listed, not offered; a named launch shows its mission,
    // provider, time, status, page and id (never a bare id)
    const elig = sampleEligibility(f, now);
    const title = elig.subject ? `${elig.subject.name} succeeds (Launch Library 2)` : f.title;
    return { id: f.id, kind: f.kind, tier: f.tier, tierLabel: sourceTypeLabel(f), title, sourceName: f.sourceName, settlement: isSingleOfficialSource(f.config) ? singleSourceSentence(f.id) : null, sourceUrl: elig.subject?.url ?? verifyUrl(f, now), cadence: f.cadence, unit: f.unit, direction: f.direction, baseline: f.baseline, carry: f.carry, valueLabel: f.valueLabel, flags: f.flags, launchable: elig.decided ? { ok: false, why: elig.reason } : f.launchable, resolved: elig.decided, eligibility: { decided: elig.decided, reason: elig.reason }, subject: elig.subject, param: f.param, needsKey: f.config.needsKey ?? null, fixtureFetchedAt, refusals, lastReading: last, readings, preview, ...(o.includeConfig ? { config: publicConfig(f.config) } : {}) };
  });
  const onchain = (Object.keys(ONCHAIN_FACTS) as (keyof typeof ONCHAIN_FACTS)[]).map((id) => { const s = onchainSource(id, null); return { id, kind: s.kind, tier: s.tier, tierLabel: sourceTypeLabel(s), title: s.title, sourceName: s.sourceName, sourceUrl: s.sourceUrl, cadence: s.cadence, unit: s.unit, direction: s.direction, baseline: s.baseline, carry: s.carry, valueLabel: s.valueLabel, flags: s.flags, launchable: s.launchable, param: null, needsKey: null, fixtureFetchedAt: null, refusals: [], lastReading: null, readings: [], preview: null, ...(o.includeConfig ? { config: null } : {}) }; });
  const stubs = [polymarketCard(), umaStub(), driftBetStub(), hedgehogStub()].map((s) => ({ id: s.id, kind: s.kind, tier: s.tier, tierLabel: sourceTypeLabel(s), title: s.title, sourceName: s.sourceName, sourceUrl: s.sourceUrl, cadence: s.cadence, unit: null, direction: null, baseline: null, carry: s.carry, valueLabel: null, flags: s.flags, launchable: s.launchable, param: null, needsKey: null, fixtureFetchedAt: null, refusals: [], lastReading: null, readings: [], preview: null, ...(o.includeConfig ? { config: null } : {}) }));
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
    return fail(502, `Kalshi could not be reached just now. The reason given was: ${safeErrorText(e, 160)}`);
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
    return fail(502, `Kalshi could not be reached just now. The reason given was: ${safeErrorText(e, 160)}`);
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
    return fail(502, `Kalshi could not be reached just now. The reason given was: ${safeErrorText(e, 160)}`);
  }
}

const refuseTitlesList = (titles: string[]): string[] => [...new Set(refusalsFor(loadRefuseList(), { titles }).map((r) => r.reason))];
const catalogueFeeds = (now: number): FeedLike[] => (catalogueSources(now).sources as unknown as (FeedLike & { kind: string })[]).filter((f) => f.kind !== "market" && f.kind !== "assertion");

/** GET /v1/search?q= — the universal search (src/lib/burnticker/search.ts): ready-made rules from every enabled venue and feed; the category list when nothing matches. */
export async function search(p: Platform, q: { q?: string | null; closingSoon?: string | null }, now = Date.now()): Promise<ApiResult> {
  const venues = venueFlags(p);
  const r = await universalSearch(q.q ?? "", { closingSoon: /^(1|true|yes)$/i.test(q.closingSoon ?? ""), venues, feeds: catalogueFeeds(now), espn: espnClient(), polyGet: venues.polymarket ? (u) => p.polymarket.get(u) : null, refuse: refuseTitlesList, kalshiSearch: venues.kalshi ? (x) => p.kalshi.searchSeries(x, { limit: 5 }) : null, derbyHref: derbyHrefFrom(), nowMs: now });
  let categories: { id: string; label: string; blurb: string }[] = [];
  // continuous audit run 4, HB-42: the hint's buttons open the Published data step, so it lists only the categories that step has a tab for
  if (r.empty) { try { categories = publishedDataCategories(loadCategories()).map((c) => ({ id: c.id, label: c.label, blurb: c.blurb })); } catch { categories = []; } }
  // suggested tickers: unique against the registry and clear of the refuse list's name patterns (RAYS26 → RAYS262 when taken)
  const list = loadRefuseList();
  const cards = dedupeTickers(r.cards, (t) => { try { return p.registry.tokenByTicker(t) !== null; } catch { return false; } }, (t) => nameRefusals(list, "", t).length > 0);
  // website-14 (product idea 6): a card whose rule's canonical selector is already registered names those coins (duplicateRule.ts)
  let tokens: Parameters<typeof existingCoinsFor>[1] = [];
  try { tokens = p.registry.tokens(); } catch { tokens = []; }
  const withExisting = cards.map((c) => { const rule = (c as { rule?: unknown }).rule; const existing = rule ? existingCoinsFor(rule, tokens) : []; return existing.length ? { ...c, existing } : c; });
  // ChatGPT audit 7 item 2: a pasted mint that is on the Not Burnticker list answers "known lookalike", never "no coin matches"
  const lookalike = knownLookalike(p, q.q ?? "");
  const answer = ok({ ...r, ...(lookalike ? { empty: false, lookalike } : {}), cards: withExisting, venues, categories, note: "These are ready-made rules. No prices, odds, volume or liquidity are returned." });
  // review of A-22 item 8: search is no-store (spec.ts cacheSec 0), so a team card built without its schedule needs no shorter cache line
  return answer;
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
      races: (type === "control" || st ? shown : []).slice(0, 60).map((r) => ({ ...r, outcomes: r.outcomes.map((o) => ({ ...o, title: outcomeCardTitle(r, o), settles: outcomeSettlesNote(r, o), mapping: candidateMappingLine(r, o), rule: polyRule(o.conditionId) })) })),
      note: "These are Polymarket's open midterm races. Placeholder outcomes with no name are hidden. Settlement reads the on-chain payout, and the state's certified results are the second source that checks it.",
    }));
  } catch (e) { return fail(502, `Polymarket could not be reached just now. The reason given was: ${safeErrorText(e, 160)}`); }
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
    return ok(scrubMarketData({ ...electionPairTemplate(race, oa, ob, { a: fa, b: fb }), note: "This makes one linked pair of two coins, one for each candidate. Two markets, one race: the winner's coin burns its own pool on the result and takes the loser's pool at the end. If neither candidate wins, both pools go to $DEFICIT's burn. Post linked.body to the launch route. The pending list has the details." }));
  } catch (e) { return fail(502, `Polymarket could not be reached just now. The reason given was: ${safeErrorText(e, 160)}`); }
}

const sideOf = (league: LeagueId, s: Game["home"]) => { const t = teamsOf(league).find((x) => x.abbr === s.abbr); return { abbr: s.abbr, code: t ? teamCodeOf(t) : s.abbr, name: s.name || t?.name || s.abbr, nickname: s.nickname || t?.nickname || s.abbr, ticker: t?.ticker ?? s.abbr, record: s.record, home: s.homeAway === "home" }; };

/** Where a league's schedule on the pickers comes from, in one sentence (the NBA's feed answers 403 since 2026-10-12: espn.ts probe note). */
const NBA_SCHEDULE_SOURCE = NBA_FEED_WORDING;
const scheduleSource = (league: LeagueId): string => (league === "mlb" || league === "nhl" ? "The schedule comes from the league's official feed." : league === "nba" ? "The schedule comes from the NBA's feed when it answers, otherwise from TheSportsDB under licence." : "The schedule comes from TheSportsDB, with a licensed key.");
/** The cache line of an answer served without a schedule that is still being read or failed (H1 re-review): seconds, never minutes. */
export const DEGRADED_CACHE = "public, max-age=5";
/** How long the team picker waits for a league's schedule before it serves the table without next games (H1). */
export const TEAMS_SCHEDULE_WAIT_MS = 3_000;
/** GET /v1/sports/teams?league= — the team picker for team coins (the league's own schedule or TheSportsDB; no ESPN reads): the static team table with each team's next game and record. No league → the leagues. */
export async function sportsTeams(_p: Platform, q: { league?: string | null; q?: string | null; division?: string | null }, nowMs = Date.now()): Promise<ApiResult> {
  const league = q.league?.trim().toLowerCase() ?? "";
  if (!league) return ok({ leagues: Object.values(LEAGUES).map((l) => { const off = countedOfficialOf(l.id); return { id: l.id, label: l.label, sport: l.sport, crossRead: off ? CROSS_LABEL[off] : "The on-chain payout and the licensed final score confirm each other.", crossReadMissing: false, schedule: off ? `${CROSS_LABEL[off]}, which is free` : l.id === "nba" ? NBA_SCHEDULE_SOURCE : "TheSportsDB, with a licensed key", scheduleAvailable: espnClient().scheduleAvailable(l.id), draws: l.draws, teams: teamsOf(l.id).length }; }), sports: SPORTS, source: "Schedules come from the league's official feed for MLB and NHL, from the NBA's feed when it answers and otherwise TheSportsDB for the NBA, and from TheSportsDB with a licensed key for every other league." });
  if (!isLeague(league)) return fail(400, `Pick a league from this list: ${Object.keys(LEAGUES).join(", ")}.`);
  // schedules: MLB and NHL from their free official feeds, the NBA from its feed when it answers else TheSportsDB, every other league
  // from TheSportsDB (licensed key) — never ESPN
  // launch audit 5 L05: a schedule that cannot be read is a display problem only — the sentence says so; the technical reason is apart
  let scheduleNote: string | null = null, scheduleDetail: string | null = null;
  // prelaunch audit H1 (2026-10-15): the team table never waits on a slow schedule; past TEAMS_SCHEDULE_WAIT_MS it is served without the
  // next games (the read goes on and is kept for the next request)
  const sched = await within(espnClient().upcoming(league, 8), TEAMS_SCHEDULE_WAIT_MS);
  // re-review: a degraded answer (the schedule still being read, or unreadable) is kept by caches for seconds, not the endpoint's 5 minutes
  const degraded = !sched.done || "error" in sched;
  const games = !sched.done ? (() => { scheduleNote = `${LEAGUES[league].label}'s next games are still being read, so teams are shown without them for now. Reload in a few seconds to see them.`; scheduleDetail = null; return [] as Game[]; })()
    : "error" in sched ? (() => { const e = sched.error; console.error(`[burnticker/sports] ${league} schedule could not be read:`, e); const sp = e instanceof ScheduleUnavailable ? scheduleProblem(league, "needs-licence", SCHEDULE_NEEDS_KEY) : scheduleProblem(league, "unreadable", safeErrorText(e, 160)); scheduleNote = sp.line; scheduleDetail = sp.detail; return [] as Game[]; })()
    : sched.value;
  const year = seasonYearAt(league, Date.now());
  const needle = (q.q ?? "").trim();
  const named = needle ? new Set(findTeams(needle).filter((t) => t.league === league).map((t) => t.abbr)) : null;
  // ChatGPT audit 6 item 2: whether the team has games left this season, from the same schedule read (seasonStatus)
  const readable = scheduleNote === null;
  // QA pass 9 #28 and #29: alphabetical by name; college football lists the FBS unless division=all
  const division = q.division === "all" ? "all" : "fbs";
  const listed = pickerTeams(league, { division });
  const teams = listed.filter((t) => !named || named.has(t.abbr) || t.name.toLowerCase().includes(needle.toLowerCase())).slice(0, needle ? 200 : 400).map((t) => {
    // a game being played comes first, then the next one (a live game is "Live now", QA pass 9 #35)
    const g = games.filter((x) => (x.home.abbr === t.abbr || x.away.abbr === t.abbr) && !x.completed).sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0] ?? null;
    const opp = g ? (g.home.abbr === t.abbr ? g.away : g.home) : null;
    const me = g ? (g.home.abbr === t.abbr ? g.home : g.away) : null;
    const win = teamSeries(league, t.abbr, "win", { kind: "season", year });
    // audit 6 item 10: a record only when the schedule carries one; the field is left out otherwise (never null, never a bare dash)
    const record = me?.record ?? null;
    const live = !!g && isLive(g, nowMs);
    return { abbr: t.abbr, code: teamCodeOf(t), city: t.city, nickname: t.nickname, name: t.name, ticker: teamTicker(t.abbr, { league, window: "season", outcome: "win" }), league, series: { win, loss: teamSeries(league, t.abbr, "loss", { kind: "season", year }), ...(LEAGUES[league].draws ? { draw: teamSeries(league, t.abbr, "draw", { kind: "season", year }) } : {}), seasonYear: year, perpetual: { win: teamSeries(league, t.abbr, "win", { kind: "perpetual" }), loss: teamSeries(league, t.abbr, "loss", { kind: "perpetual" }) } }, ...(record ? { record } : {}), next: g && opp ? { eventId: g.eventId, title: g.name, startsAt: g.startsAt, detail: g.detail, opponent: opp.nickname || opp.abbr, home: g.home.abbr === t.abbr, live, when: live ? LIVE_NOW : null } : null, season: seasonStatus(t.abbr, games, readable) };
  });
  const divisionInfo = league === "cfb" ? { division: { shown: division, line: division === "fbs" ? FBS_DEFAULT_LINE(listed.length, teamsOf("cfb").length - listed.length) : null, all: "/api/burnticker/v1/sports/teams?league=cfb&division=all" } } : {};
  const body = ok({ league, label: LEAGUES[league].label, source: scheduleSource(league), scheduleNote, scheduleDetail, ...divisionInfo, order: "alphabetical", teams });
  return degraded ? { ...body, headers: { ...(body.headers ?? {}), "cache-control": DEGRADED_CACHE } } : body;
}

/**
 * ChatGPT audit 6 item 2 (26 of 30 MLB teams had next: null while the season rule was offered): a team's season state from the league's
 * schedule for the next days. `over` = the league is in its postseason (every listed game is a postseason game) and the team has no
 * game in it: a season coin would end at once and its pool would go to $DEFICIT. `none-listed` = no game for the team in the window
 * (a bye, the off-season or a schedule that lists only part of the league). `unknown` = the schedule could not be read.
 */
export { SEASON_OVER_LINE, seasonStatus } from "@/lib/burnticker/seasonOver";

/** GET /v1/sports/games?league=&q= — upcoming games for matchups (the league's own schedule or TheSportsDB, the next 8 days; no ESPN reads): both sides and each side's one-game loss selector. */
export async function sportsGames(_p: Platform, q: { league?: string | null; q?: string | null }, nowMs = Date.now()): Promise<ApiResult> {
  const league = q.league?.trim().toLowerCase() ?? "";
  if (!isLeague(league)) return fail(400, `Pick a league from this list: ${Object.keys(LEAGUES).join(", ")}.`);
  try {
    let games: Game[];
    try { games = await espnClient().upcoming(league, 8); } catch (e) { console.error(`[burnticker/sports] ${league} schedule could not be read:`, e); const sp = e instanceof ScheduleUnavailable ? scheduleProblem(league, "needs-licence", SCHEDULE_NEEDS_KEY) : scheduleProblem(league, "unreadable", safeErrorText(e, 160)); return ok({ league, label: LEAGUES[league].label, source: scheduleSource(league), scheduleNote: sp.line, scheduleDetail: sp.detail, games: [], count: 0 }); }
    const needle = (q.q ?? "").trim();
    const named = needle ? new Set(findTeams(needle).filter((t) => t.league === league).map((t) => t.abbr)) : null;
    // audit 2026-10-16 F-4 review: a fallback (API-Sports) game has no TheSportsDB id, so no game coin can be made from it: not offered
    const rows = games.filter((g) => !isFallbackGame(g) && !g.completed && g.home.abbr !== "TBD" && g.away.abbr !== "TBD" && (!named || named.has(g.home.abbr) || named.has(g.away.abbr))).sort((a, b) => a.startsAt.localeCompare(b.startsAt)).map((g) => ({
      eventId: g.eventId, league, title: g.name, startsAt: g.startsAt, detail: g.detail, live: isLive(g, nowMs), when: isLive(g, nowMs) ? LIVE_NOW : null, a: sideOf(league, g.away), b: sideOf(league, g.home),
      series: { aLoss: gameSeries(league, g.eventId, g.away.abbr, "loss"), bLoss: gameSeries(league, g.eventId, g.home.abbr, "loss") },
    }));
    // F-4 re-review: only the partial fallback listing could be read, so nothing is offered: say so plainly instead of an empty list
    const fallbackOnly = !rows.length && games.some(isFallbackGame);
    return ok({ league, label: LEAGUES[league].label, source: scheduleSource(league), scheduleNote: fallbackOnly ? FALLBACK_ONLY_LINE : null, scheduleDetail: null, games: rows, count: rows.length });
  } catch (e) { return fail(502, `The schedule could not be read just now. The reason given was: ${safeErrorText(e, 160)}`); }
}

/**
 * THE RIVALRY SERIES PICKER (RIVALRY-SERIES-BRIEF item 4): every game between two teams this season, regular season and postseason, from
 * the league's own schedule (MLB StatsAPI, the NHL feed, the NBA feed when it answers) or TheSportsDB with its licensed key — never ESPN. Each game with its
 * date, whether it is a playoff game, and where it stands from team `a`'s side (win, loss, draw, void, pending); the head-to-head count so
 * far; both series ids (sources/espn.ts window `meetings`) and the pair's names and tickers. `offered` is false when the schedule lists no
 * game between them (the option is then not offered for that pair).
 */
export async function sportsRivalry(_p: Platform, q: { league?: string | null; a?: string | null; b?: string | null }, nowMs = Date.now()): Promise<ApiResult> {
  const league = q.league?.trim().toLowerCase() ?? "";
  if (!isLeague(league)) return fail(400, `Pick a league from this list: ${Object.keys(LEAGUES).join(", ")}.`);
  const ta = teamByAbbr(league, q.a?.trim() ?? ""), tb = teamByAbbr(league, q.b?.trim() ?? "");
  if (!ta || !tb) return fail(400, `Name two teams of the ${LEAGUES[league].label} by their abbreviation, as /sports/teams lists them.`);
  if (ta.abbr === tb.abbr) return fail(400, "Pick two different teams.");
  const source = scheduleSource(league);
  const names = meetingsPairNames(ta, tb);
  const base = { league, label: LEAGUES[league].label, source, option: { label: RIVALRY_SERIES_LABEL, line: RIVALRY_SERIES_LINE }, a: { abbr: ta.abbr, code: teamCodeOf(ta), team: ta.name, nickname: ta.nickname, ...names.a }, b: { abbr: tb.abbr, code: teamCodeOf(tb), team: tb.name, nickname: tb.nickname, ...names.b } };
  let games: Game[];
  try { games = await espnClient().season(league, ta.abbr); } catch (e) {
    const sp = e instanceof ScheduleUnavailable ? scheduleProblem(league, "needs-licence", SCHEDULE_NEEDS_KEY) : scheduleProblem(league, "unreadable", safeErrorText(e, 160));
    return ok({ ...base, year: null, season: null, series: null, scheduleNote: sp.line, scheduleDetail: sp.detail, offered: false, offeredLine: sp.line, meetings: [], count: 0, tally: null });
  }
  const year = games.find((g) => g.seasonYear)?.seasonYear ?? seasonYearAt(league, Date.now());
  const isB = (x: Game["home"]) => x.abbr === tb.abbr;
  const rows = games.filter((g) => isB(g.home) || isB(g.away)).sort((x, y) => x.startsAt.localeCompare(y.startsAt)).map((g) => {
    const result = meetingOutcome(g, ta.abbr);
    const live = result === "pending" && isLive(g, nowMs);
    // QA pass 9 #4: every listed game still to be played can be the one-game pair (each side's one-game loss selector, and which side is at home, from the fixture itself: #2)
    const open = result === "pending" && !live && Date.parse(g.startsAt) > nowMs;
    return { eventId: g.eventId, startsAt: g.startsAt, date: g.date, playoff: g.seasonType === 3, home: g.home.abbr, away: g.away.abbr, title: g.name, live, when: live ? LIVE_NOW : null, oneGame: open ? { aHome: g.home.abbr === ta.abbr, series: { aLoss: gameSeries(league, g.eventId, ta.abbr, "loss"), bLoss: gameSeries(league, g.eventId, tb.abbr, "loss") } } : null, status: result === "pending" ? (live || g.state === "in" ? "in progress" : "scheduled") : result === "void" ? "postponed or cancelled" : "final", result, score: g.completed && g.home.score !== null && g.away.score !== null ? { home: g.home.score, away: g.away.score } : null };
  });
  const tally = tallyMeetings(rows.map((r) => r.result));
  return ok({ ...base, year, season: seasonLabel(league, year), series: meetingsPairSeries(league, ta.abbr, tb.abbr, year), scheduleNote: null, scheduleDetail: null, offered: rows.some((r) => r.result === "pending"), offeredLine: !rows.length ? MEETINGS_NONE_LINE : rows.some((r) => r.result === "pending") ? null : MEETINGS_NONE_LEFT_LINE, meetings: rows, count: rows.length, oneGame: { label: RIVALRY_GAME_LABEL, searched: oneGameSearchLine(seasonLabel(league, year), rows.filter((r) => r.oneGame).length, !noPlayoffs(league)), count: rows.filter((r) => r.oneGame).length }, tally: { [ta.abbr]: tally.wins, [tb.abbr]: tally.losses, draws: tally.draws, voids: tally.voids, note: "From the schedule's own scores. The coins count only results that two independent sources agree on." } });
}

/** Which venues this host serves (venues.ts): Kalshi behind BURNTICKER_KALSHI_ENABLED; Polymarket and the first-party feeds always. */
export const venueFlags = (p: Platform): VenueFlags => ({ kalshi: p.kalshiEnabled !== false, polymarket: p.polymarketDiscovery !== false, feeds: true });

/**
 * BROWSE, VENUE-AGNOSTIC (src/lib/burnticker/browse.ts): no category → Burnticker's categories (config/burnticker/categories.json)
 * with what each venue contributes on this host; `category` → its source cards — first-party feeds first, then Polymarket events of
 * its tags, then (Kalshi enabled) Kalshi series of its categories, the four series soonest-listed with their next event. A venue that
 * fails is named in `errors` and the rest of the page still renders.
 */
export async function browse(p: Platform, q: { category?: string | null; q?: string | null; venue?: string | null }, now = Date.now()): Promise<ApiResult> {
  // continuous audit run 2, HB-21: `venue=feed` (the Published data step) lists public-data feeds only, never markets
  const feedsOnly = q.venue === "feed";
  const venues = feedsOnly ? { ...venueFlags(p), polymarket: false, kalshi: false } : venueFlags(p);
  let cats;
  try { cats = loadCategories(); } catch (e) { return fail(500, safeErrorText(e, 600)); }
  const feeds = (catalogueSources(now).sources as unknown as (FeedCardInput & { kind: string })[]).filter((f) => f.kind !== "market" && f.kind !== "assertion");
  // sources-3 (2026-10-12): the weather tile folded into Science, Space & Weather; an old link or a saved draft asking for it lands there
  const asked = q.category?.trim() || null;
  const id = asked === "weather" ? "science" : asked;
  if (!id) return ok({ categories: categoryList(cats, feeds, venues, { feedsOnly }), venues, note: "These are Burnticker's categories. Each one lists our own feeds and Polymarket events. It also lists Kalshi series when this site has Kalshi turned on." });
  const c = cats.find((x) => x.id === id);
  if (!c) return fail(404, `There is no category called "${id}". The categories are ${cats.map((x) => x.id).join(", ")}.`);
  const errors: string[] = [];
  const polymarket: PolyEventHit[] = [];
  for (const tag of venues.polymarket ? c.polymarket.slice(0, 2) : []) {
    try { polymarket.push(...(await p.polymarket.eventsByTag(tag, 6)).events); } catch (e) { errors.push(`Polymarket's ${tag} events could not be read. The reason given was: ${safeErrorText(e, 100)}`); }
  }
  const kalshi: (BrowseSeries & { refused: string[] })[] = [];
  if (venues.kalshi) {
    const list = loadRefuseList();
    const per = Math.max(4, Math.floor(12 / Math.max(1, c.kalshi.length)));
    for (const cat of c.kalshi) {
      try {
        const page = await p.kalshi.seriesByCategory(cat, { q: q.q ?? null, limit: per, withEvents: Math.min(4, per) });
        kalshi.push(...page.series.map((s) => ({ ...s, refused: refusalsFor(list, { titles: [s.title], categories: s.category ? [s.category] : [] }).map((r) => r.reason) })));
      } catch (e) { errors.push(`Kalshi's ${cat} series could not be read. The reason given was: ${safeErrorText(e, 100)}`); }
    }
  }
  // continuous audit run 4, HB-37: a feed the creation preflight can never pass (not a primary, no second publisher) is not launchable
  // on any browse, so its card shows the unavailable line instead of "use this source" (it was offered under Event outcome, then refused
  // at the review)
  const cards = categoryCards(c, { feeds, polymarket, kalshi }, { q: q.q ?? null, feedsOnly }).map((card) => {
    if (card.venue !== "feed" || !card.launchable.ok || card.pick.oracle !== "catalogue" || !card.pick.series) return card;
    let refusal: ReturnType<typeof catalogueSettleRefusal> = null;
    try { refusal = catalogueSettleRefusal(card.pick.series); } catch { refusal = null; }
    return refusal ? { ...card, launchable: { ok: false, why: refusal.message } } : card;
  });
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
      try { const r = await p.polymarket.eventsByTag(tag.slug, 8); polymarket = { tag, events: r.events, error: null }; } catch (e) { polymarket = { tag, events: [], error: safeErrorText(e, 120) }; }
    }
    return ok({ ...page, series, polymarket, note: "The series most traded on Kalshi come first. Trading is used only to order the list. Open a series to see whether it settles as yes or no or as a number." });
  } catch (e) {
    return fail(502, `Kalshi could not be reached just now. The reason given was: ${safeErrorText(e, 160)}`);
  }
}

/**
 * POLYMARKET SEARCH (2026-10-10): Gamma's text search (or a pasted condition id / event slug) → events with their BINARY markets (YES =
 * the first outcome, NO the second; each a one-shot selector), the event as a recurring selector (`event:<slug>`), and the tags seen on
 * the hits as recurring selectors (`tag:<slug>`, `tag:<slug>/moneyline` where the hits are games). The refuse list marks refused events;
 * a refused market is never offered. No prices, odds or volume are returned (venues.ts).
 */
/** Audit 12 item 8: beside the search's closing-soon filter, what a market marked closePassed is (not hidden: it may still be open). */
export const CLOSE_PASSED_SEARCH_NOTE = "A market marked as past its scheduled close is still listed by Polymarket and waiting for its result. It is not hidden by the 48-hour filter, because it may still take a coin; its result may come before a new coin graduates.";
export async function polymarketSearch(p: Platform, q: { q?: string | null; status?: string | null; closingSoon?: string | null }, now = Date.now()): Promise<ApiResult> {
  const query = (q.q ?? "").trim();
  const status = q.status === "closed" || q.status === "all" ? q.status : "open";
  if (p.polymarketDiscovery === false) return fail(503, POLYMARKET_UNAVAILABLE);
  if (query.length < 2) return fail(400, "Type at least two characters. You can search for a team, a person, an event, an event slug or a condition id.");
  try {
    const r = scrubMarketData(await p.polymarket.search(query, { status, limit: 10 }));
    // QA pass 9 #17: the event-outcome path hides a market closing within CLOSING_SOON_HOURS, as the universal search does (a coin made now
    // would not graduate before the result); closingSoon=1 lists them, each marked. A market past its end date and not yet resolved is left to the market's own state
    const soon = (endDate: string | null) => status === "open" && !!endDate && Number.isFinite(Date.parse(endDate)) && Date.parse(endDate) >= now && Date.parse(endDate) - now < CLOSING_SOON_HOURS * 3_600_000;
    const show = /^(1|true|yes)$/i.test(q.closingSoon ?? "");
    // audit 12 item 8: a scheduled close already past (still listed by the source, so not settled yet) is marked as its own state, never
    // shown as an upcoming close; the source's state decides whether it is open, this only labels it
    const passed = (endDate: string | null) => status === "open" && !!endDate && Number.isFinite(Date.parse(endDate)) && Date.parse(endDate) < now;
    const markets = r.markets.map((m) => ({ ...m, closingSoon: soon(m.endDate), closePassed: passed(m.endDate) })), events = r.events.map((e) => ({ ...e, closingSoon: soon(e.endDate), closePassed: passed(e.endDate), markets: e.markets.map((m) => ({ ...m, closingSoon: soon(m.endDate), closePassed: passed(m.endDate) })) }));
    const keptM = show ? markets : markets.filter((m) => !m.closingSoon), keptE = show ? events : events.filter((e) => !e.closingSoon);
    return ok({ query, status, venue: "polymarket", events: keptE, markets: keptM, hiddenClosingSoon: markets.length - keptM.length + events.length - keptE.length, closePassedNote: CLOSE_PASSED_SEARCH_NOTE, tags: r.tags, note: "Only yes-or-no markets are listed. YES is a market's first outcome and NO is its second. The result is read from the on-chain payout on Polygon. No prices, odds or volume are returned." });
  } catch (e) {
    return fail(502, `Polymarket could not be reached just now. The reason given was: ${safeErrorText(e, 160)}`);
  }
}

/** The back-test of a rule from the venue's own settled history (catalogue rules: the source's frozen fixture; Polymarket: Gamma's closed markets). */
export async function runBacktest(p: Platform, body: { rule?: unknown; months?: unknown }, now = Date.now()): Promise<ApiResult> {
  let locked: LockedRule;
  try { locked = lockRule(body.rule); } catch (e) { return fail(400, safeErrorText(e, 600)); }
  const months = Math.min(24, Math.max(1, Number(body.months ?? 12) || 12));
  try {
    if (locked.rule.oracle === "catalogue" && nativeSourceById(locked.rule.series!)) {
      // native first-party source (the sports schedules, NWS climate; never ESPN): a live read of what it has published — display-grade, no cross-read
      const src = nativeSourceById(locked.rule.series!)!;
      const np = nativeRuleProblems(src, locked.rule);
      if (np.length) return fail(400, np.join("; "), { problems: np });
      const since = new Date(now); since.setUTCMonth(since.getUTCMonth() - months);
      // the intent audit: a single game already final is refused in the review with the shared sentence (oneShotEligibility.ts)
      const gameElig = src.eligibility ? await src.eligibility().catch(() => null) : null;
      const r = await src.settledSince(locked.rule, since.toISOString().slice(0, 10), { crossRead: false });
      const b = backtest(locked.rule, r.events, now, months);
      const pv = { ...b, window: { from: r.events[0]?.at ?? "", to: r.events[r.events.length - 1]?.at ?? "" }, lastReading: r.events[r.events.length - 1] ?? null };
      return ok({ rule: locked.rule, text: locked.text, sha256: locked.sha256, sha12: locked.sha12, mode: locked.mode, statement: ruleStatement(locked.rule, { feedTitle: src.title }), backtest: pv, sentence: `${backtestSentence(b)} This was read live from ${src.sourceName.split(" · ")[0]} and is for display only.${src.crossRead ? ` The keeper also checks ${src.crossRead}.` : ""}${gameElig ? ` ${gameElig.line}` : ""}`, refusals: gameElig?.decided ? [{ reason: gameElig.reason! }] : [], seriesTitle: src.title, matched: r.events.length });
    }
    if (locked.rule.oracle === "catalogue") {
      const feed = feedById(locked.rule.series!);
      if (!feed) return fail(400, `There is no feed called ${locked.rule.series}.`);
      const pv = previewFromFixture(feed, locked.rule, now);
      const elig = sampleEligibility(feed, now);
      return ok({ rule: locked.rule, text: locked.text, sha256: locked.sha256, sha12: locked.sha12, mode: locked.mode, statement: ruleStatement(locked.rule, { feedTitle: feed.title }), backtest: pv, sentence: `${backtestSentence(pv)} This comes from the feed's saved sample, from ${pv.window.from} to ${pv.window.to}.`, refusals: elig.decided ? [{ reason: elig.reason! }] : [], seriesTitle: elig.subject ? `${elig.subject.name} succeeds (Launch Library 2)` : feed.title, subject: elig.subject, matched: pv.rows.length });
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
    console.error("[burnticker/backtest] the back-test failed:", e);
    return fail(502, `The back-test could not run just now. The reason given was: ${safeErrorText(e, 160)}`);
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
/** 2026-10-14: a retry that reuses an earlier draft's address must carry the same rule and ticker; otherwise a fresh address is needed. */
const OWN_DRAFT_CHANGED = "Your earlier draft for this address had a different rule or ticker. Press Start over to get a fresh address, then launch again.";
/**
 * Audit 2026-10-15 F4: one draft has one metadata file. A retry of the same address with a different name, description, links or image
 * is refused before anything is uploaded (the first file is the one the registry keeps, so the coin would be created naming another).
 */
const OWN_DRAFT_DETAILS_CHANGED = "Your earlier draft for this address had a different name, description, links or image, and its details are already saved. Press Start over to get a fresh address, then launch again.";
/** The registry status key holding a draft's metadata identity (the fingerprint of everything its metadata file says). */
export const draftIdentityKey = (mint: string): string => `draft.identity.${mint}`;
/**
 * Prelaunch audit 2026-10-18 F08: every file this site paid to save on Arweave, by the sha256 of its bytes (registry status key). A
 * retry with the same bytes reuses it instead of paying again. `unused`: the slot it was charged against is held for the attempt that
 * uses it (its own attempt failed after saving it); false once a prepare used it.
 */
export const pinUploadKey = (sha256: string): string => `pin.upload.${sha256}`;
export type PinUploadRecord = { id: string; url: string; contentType: string; unused: boolean; at: number; /** review fix: whose held slot it is ("client|creator"); only the same requester takes it over */ holder?: string };
/** What a coin's metadata file is made from, as one fingerprint: a retry with the same fingerprint may reuse the file. */
/**
 * Review 2026-10-15 (7): only what the creator supplied plus the locked rule's hash. The generated paragraph is left out: it can carry a
 * live source title (a Polymarket market's) that changes between two attempts while nothing the creator chose has changed.
 */
export const draftIdentity = (i: { ticker: string; name: string; creatorText: string; rulesSha256: string; links: { label: string; url: string }[]; imageUrl: string | null; imageSha: string | null; badge: boolean | null }): string =>
  sha256Hex(JSON.stringify({ v: 2, t: i.ticker, n: i.name, c: i.creatorText, r: i.rulesSha256, l: i.links.map((l) => [String(l?.label ?? ""), String(l?.url ?? "")]), u: i.imageUrl, i: i.imageSha, b: i.badge }));
interface PairSideInput { /** round 5: side B's own pinned token (burnTarget.ts BurnTargetField); side A's rides in its rule */ burnTarget?: unknown; /** two candidates in one race: candidate B's market and the race slug; two teams in one game: the other team; side B's own describe context */ market?: unknown; race?: unknown; opp?: unknown; descCtx?: unknown; ticker?: unknown; name?: unknown; description?: unknown; imageUrl?: unknown; links?: unknown; /** website-18: side B's own creator text and uploaded image */ creatorDescription?: unknown; image?: unknown; imageRights?: unknown; imageBadge?: unknown }

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
/** The options a prepare takes (both launch routes pass their client; scripts and tests may leave it out). */
export type PrepareOptions = { register: boolean; mint?: string | null; /** 2026-10-14: a pair's side B mint public key (the launch page grinds both); only with `mint` */ mintB?: string | null; /** 2026-10-14 night: keypairs taken from the host's mint key bank (mintBank.ts; side A / the one coin, and a pair's side B), whose secrets ride in the bundles */ mintKeypair?: Keypair | null; mintKeypairB?: Keypair | null; /** 2026-10-15 (deploy smoke): every check a launch runs (the preflight, the pin budget, the uploader), with `register: false`: nothing is pinned, registered or taken */ dryRun?: boolean; preflight?: { strict?: boolean; deps?: PreflightDeps }; /** audit 2026-10-15 H4: the bank keys, taken only once every check has passed (a refusal never takes a key); the route discards them if the launch is refused later */ takeMintKeys?: (tickers: string[]) => { keys: Keypair[] } | { error: ApiResult }; /** review 2026-10-15 (2): the request's client key (http.ts clientKey), which the pin budget is counted by */ client?: string };
type PrepareResult = { error: ApiResult } | { ok: PreparedLaunch } | { pair: PreparedPair };

/**
 * Third prelaunch audit 2026-10-16 F03: prepares that register a draft for the same mint run one at a time in this process, whichever
 * route they came through (the launch page or /v1/launch/bundle), so the second sees the first's draft and its metadata identity. The
 * registry is still the arbiter: just before a draft is written the identity recorded for its mint is read again (draftRaceRefusal).
 * F04: the pin slots a prepare reserved are released when it ends, whatever it answered (a successful upload has already been charged).
 */
export async function prepareLaunch(p: Platform, body: Record<string, unknown>, o: PrepareOptions): Promise<PrepareResult> {
  const held: (() => void)[] = [], onOk: (() => void)[] = [];
  const mints = o.register && !o.dryRun ? [o.mint, o.mintB].filter((m): m is string => typeof m === "string" && m.length > 0) : [];
  const unlock = await lockMints(mints);
  try {
    const r = await prepareLaunchUnlocked(p, body, o, held, onOk);
    // review of block M: what runs only when the prepare succeeded (the wallet's signed request is spent)
    if (!("error" in r) && o.register && !o.dryRun) for (const f of onOk) { try { f(); } catch { /* never changes the answer */ } }
    return r;
  }
  finally { for (const f of held.splice(0)) { try { f(); } catch { /* a release never changes the answer */ } } unlock(); }
}

/** F03: one prepare per mint at a time in this process (keys taken in sorted order, so a pair and a single coin never wait on each other in a cycle). */
const mintQueues = new Map<string, Promise<void>>();
async function lockMints(mints: string[]): Promise<() => void> {
  const releases: (() => void)[] = [];
  for (const m of [...new Set(mints)].sort()) {
    const prev = mintQueues.get(m) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((r) => { release = r; });
    const tail = prev.then(() => mine);
    mintQueues.set(m, tail);
    await prev;
    releases.push(() => { release(); if (mintQueues.get(m) === tail) mintQueues.delete(m); });
  }
  return () => { for (const r of releases.reverse()) r(); };
}

/** F04: pin slots reserved by prepares still running in this process, per budget key; they count toward every cap like a charged pin. */
const reservedPins = new Map<string, number>();
const reservedOf = (k: string): number => reservedPins.get(k) ?? 0;
function adjustReserved(k: string, d: number): void { const n = reservedOf(k) + d; if (n > 0) reservedPins.set(k, n); else reservedPins.delete(k); }

/** Second audit 2026-10-19 I-17: the answer to a launch while an older build runs on a newer registry file. */
const REGISTRY_NEWER_REFUSAL = "New coins cannot be launched on this site for the moment. Everything already launched keeps working. Please try again later.";

async function prepareLaunchUnlocked(p: Platform, body: Record<string, unknown>, o: PrepareOptions, held: (() => void)[], onOk: (() => void)[] = []): Promise<PrepareResult> {
  if (o.dryRun) o = { ...o, register: false, mint: null, mintB: null, mintKeypair: null, mintKeypairB: null };   // a dry run never registers and holds no key
  const b = body as Partial<LaunchInput> & { acknowledgements?: { ruleLocked?: unknown; noReturns?: unknown }; pair?: PairSideInput | null };
  const input: LaunchInput = { creator: String(b.creator ?? ""), ticker: String(b.ticker ?? "").toUpperCase(), name: String(b.name ?? ""), description: String(b.description ?? ""), imageUrl: null, links: Array.isArray(b.links) ? b.links : [], rule: b.rule, firstBuySol: String(b.firstBuySol ?? "0"), acknowledgements: { ruleLocked: !!b.acknowledgements?.ruleLocked, noReturns: !!b.acknowledgements?.noReturns }, cluster: p.cluster, ...(b.raiseSol === undefined || b.raiseSol === null ? {} : { raiseSol: String(b.raiseSol) }) };
  // NO IMAGE BY WEB ADDRESS (owner decision 2026-10-19; imagePin.ts IMAGE_URL_REFUSED): the image is uploaded bytes (`image`) or the
  // generated receipt art. Any imageUrl, on either side, is refused before anything else is read, for the dry run too.
  if (imageUrlSent(b.imageUrl)) return { error: fail(400, IMAGE_URL_REFUSED, { code: "image-url-refused" }) };
  if (b.pair && typeof b.pair === "object" && imageUrlSent((b.pair as { imageUrl?: unknown }).imageUrl)) return { error: fail(400, `Side B: ${IMAGE_URL_REFUSED}`, { code: "image-url-refused" }) };
  // NO BURN POOL IS EVER LEFT BEHIND (owner, 2026-10-10): every new launch carries the onEnd clause unless the rule names its own —
  // since §45 with the end sink (rules.ts DEFAULT_ON_END / defaultOnEndFor; it is part of the canonical rule, so the hash locks it).
  if (input.rule && typeof input.rule === "object" && !Array.isArray(input.rule) && (input.rule as { onEnd?: unknown }).onEnd === undefined) input.rule = { ...(input.rule as object), onEnd: defaultOnEndFor(input.rule) };
  const problems = launchProblems(input);
  if (o.mint !== undefined && o.mint !== null && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(o.mint)) problems.push("The mint must be the public key of a new mint keypair that you made.");
  if (o.mintB !== undefined && o.mintB !== null && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(o.mintB)) problems.push("Side B's mint must be the public key of a new mint keypair that you made.");
  if (o.mint && o.mintB && o.mint === o.mintB) problems.push("The two coins need two different mints.");
  if ((o.mintKeypair || o.mintKeypairB) && (o.mint || o.mintB)) problems.push("A launch takes its mints from the request or from this site's prepared keys, not both.");
  const bankA = o.mintKeypair?.publicKey.toBase58() ?? null, bankB = o.mintKeypairB?.publicKey.toBase58() ?? null;
  // website-14 (LAUNCHPAD-PATH §75): on mainnet the graduation raise is 40, 60 or 85 SOL, nothing else (launchBundle.ts raiseProblem)
  const raiseOff = raiseProblem(input.raiseSol, p.cluster);
  if (raiseOff) return { error: fail(400, raiseOff, { code: "raise-not-preset", problems }) };
  if (problems.length) return { error: fail(400, problems.join("; "), { problems }) };
  // launch-10 (2026-10-12; hostedLaunch.ts): what a launch built by this site never carries, refused before anything is read, pinned or
  // registered. Mainnet only with the host's explicit allowance (passed to the builder below as allowMainnet); no opening purchase (a
  // create with one leaves too little room for a wallet's own appended checks; the CLI keeps --first-buy-sol); no vault mode (it needs a signature no wallet can give).
  if (p.cluster === "mainnet" && p.allowMainnet !== true) return { error: fail(403, MAINNET_OFF_SENTENCE, { code: "mainnet-launches-off" }) };
  if (requestedOpeningPurchase(b.firstBuySol) !== 0) return { error: fail(400, NO_OPENING_PURCHASE_SENTENCE, { code: "opening-purchase-off" }) };
  // website-19 (ChatGPT launch-intent audit 2, item 1): a set of outcomes is never one coin's rule; the creator picks one outcome's market
  if (input.rule && typeof input.rule === "object" && eventLevelRule(input.rule as Parameters<typeof eventLevelRule>[0])) return { error: fail(400, EVENT_LEVEL_REFUSAL, { code: "pick-one-outcome" }) };
  let locked: LockedRule;
  try { locked = lockRule(input.rule); } catch (e) { return { error: fail(400, safeErrorText(e, 600)) }; }
  // owner decision 2026-10-19: a rule that pins a real token is refused while BURNTICKER_BURN_REAL_ENABLED is off (the page hides it)
  { const br = burnRealRefusal(locked.rule.burnTarget); if (br) return { error: fail(br.status, br.message, { code: br.code, problems: [br.message] }) }; }
  // HB-12 + PROD-01 (2026-10-19): only a Coin comparison side may name a token to burn, and only its own pitted coin
  // (burnRealEligibility.ts), so the API cannot do what the page never offers
  { const fp = realBurnFamilyProblem(locked.rule, locked.rule.burnTarget, "A"); if (fp) return { error: fail(400, fp, { code: REAL_BURN_FAMILY_CODE, problems: [fp] }) }; }
  // THE ONE LAUNCH PREFLIGHT (launchPreflight.ts; ChatGPT audit 6 item 8): the same rule refusals the read-only review lists, in order:
  // vault mode, a venue this host has off, an oracle no coin launches on yet, a source's fixed unit / launchability / decided result, the
  // reserve bounds and an unsafe title regex. The first one answers; every one is in `problems`.
  // SETTLED-EVENT PAIRS (owner 2026-10-13): two candidates in one race (pair.market + pair.race) or two teams in one game (pair.opp) are
  // registered LaunchLab pairs, winner takes the burn, both end sinks pair-winner naming each other (launchPreflight.ts settledPairInput)
  const settled = settledPairInput(b.pair);
  // the end-sink picker: a rule naming a coin to take the rest is checked against the live coins on this network (endSinks.ts); an
  // unreadable registry leaves the list empty, so the named coin is refused (fail closed)
  const sinks = locked.rule.onEnd?.mint ? (() => { try { return liveSinks(p.registry, p.cluster); } catch { return []; } })() : null;
  { const rr = ruleRefusals(locked, { programRound5: burnRealFromEnv(process.env), burnSol: burnSolEnabledFromEnv(process.env), dispersal: webDispersalOn(process.env), kalshiEnabled: p.kalshiEnabled !== false, now: Date.now(), pair: !!b.pair, candidates: settled?.candidates ?? null, game: settled?.game ?? null, sinks, own: [o.mint, o.mintB, bankA, bankB].filter((x): x is string => !!x), partners: locked.rule.pair?.counterpartMint ? [locked.rule.pair.counterpartMint] : [] }); if (rr.length) return { error: fail(rr[0].status, rr.length === 1 ? rr[0].message : rr.map((x) => x.message).join("; "), { code: rr[0].code, problems: rr.map((x) => x.message) }) }; }
  // sources-7 (QA walkthrough 11 H6): a season rule on a team whose season is over, from the platform's schedule port (one bounded read)
  { const so = await seasonOverFor(locked.rule, p.seasonSchedule); if (so) return { error: fail(so.status, so.message, { code: so.code, next: so.next, problems: [so.message] }) }; }
  const list = loadRefuseList();
  const refusals: Refusal[] = nameRefusals(list, input.name, input.ticker);
  // website-19 (owner, 2026-10-12): the platform's reserved names (config/burnticker/reserved-tickers.json), for the ticker and the name;
  // audit 6 item 9: major coins' tickers and control characters in the creator's texts (the review runs the same identityRefusals)
  { const ir = identityRefusals({ ticker: input.ticker, name: input.name, description: typeof (body as { creatorDescription?: unknown }).creatorDescription === "string" ? String((body as { creatorDescription: string }).creatorDescription) : "", note: typeof (body as { note?: unknown }).note === "string" ? String((body as { note: string }).note) : "" }, { refuseList: false, rule: locked.rule }); if (ir.length) return { error: fail(ir[0].status, ir[0].message, { code: ir[0].code, problems: ir.map((x) => x.message) }) }; }
  let seriesTitle: string | null = null;
  let feedText: { title: string; sourceName: string; unitLabel: string } | null = null;
  let statedText: ReturnType<typeof statedCtx> = null;
  // audit 6 item 26: a named launch's own name from the saved sample, so the description never falls back to the raw id
  let subjectName: string | null = null;
  // THE CREATOR'S TEXT (owner decision 2026-10-10): the name, the ticker and the optional note pass the copy lint with the creator scope
  // (every platform rule + no-affiliation: official, endorsed, partner…, links, handles) — a hit refuses with the category named.
  const note = typeof (body as { note?: unknown }).note === "string" ? String((body as { note: string }).note).trim() : "";
  if (note.length > NOTE_MAX) return { error: fail(400, `The creator's note can be at most ${NOTE_MAX} characters.`) };
  // website-15 item 13 (owner decisions 2026-10-12): the creator's own description (≤ 280), links and uploaded image. The description and
  // every link label pass the same creator lint; the image is checked again here (type by its bytes, ≤ 2 MB) and needs the rights line.
  const creatorText = typeof (body as { creatorDescription?: unknown }).creatorDescription === "string" ? String((body as { creatorDescription: string }).creatorDescription).trim() : "";
  if (creatorText.length > DESCRIPTION_MAX) return { error: fail(400, `The description can be at most ${DESCRIPTION_MAX} characters.`, { code: "description-too-long" }) };
  // website-18: the same checks for side A (the body) and, in a rivalry pair, side B (`pair.image`, `pair.imageRights`, `pair.imageBadge`)
  const uploadOf = async (src: { image?: unknown; imageRights?: unknown; imageBadge?: unknown }, who: string): Promise<{ error: ApiResult } | { up: { bytes: Uint8Array; contentType: string; badge: boolean; rawSha: string } | null }> => {
    if (src.image === undefined || src.image === null) return { up: null };
    if (!p.customImages) return { error: fail(400, `${who}This site does not take custom images right now. The coin uses its generated receipt art.`, { code: "custom-image-off" }) };
    if (src.imageRights !== true) return { error: fail(400, `${who}Confirm the image line first: "${RIGHTS_LINE}"`, { code: "image-rights" }) };
    const d = decodeCreatorImage(src.image);
    if ("error" in d) return { error: fail(400, `${who}${d.error}`, { code: "image-refused" }) };
    // owner, 2026-10-12: the receipt mark is optional and on by default; when on it is composited before anything is pinned
    // WIRING-MEDIA-RECOVERY item 221: a plain image (mark off) passes the same decode and 16-pixel checks as the badge path
    // F4: the creator's own bytes (before the mark is drawn) are the image's identity across a retry
    const rawSha = sha256Hex(d.ok.bytes);
    if (src.imageBadge === false) { const c = await checkCreatorImage(d.ok.bytes); if ("error" in c) return { error: fail(400, `${who}${c.error}`, { code: "image-refused" }) }; return { up: { bytes: d.ok.bytes, contentType: d.ok.contentType, badge: false, rawSha } }; }
    const badged = await badgeCreatorImage(d.ok.bytes, d.ok.contentType);
    if ("error" in badged) return { error: fail(400, `${who}${badged.error}`, { code: "image-refused" }) };
    return { up: { bytes: badged.ok.bytes, contentType: badged.ok.contentType, badge: true, rawSha } };
  };
  const upA = await uploadOf(body as { image?: unknown; imageRights?: unknown; imageBadge?: unknown }, "");
  if ("error" in upA) return upA;
  const uploaded = upA.up;
  const textProblems = creatorTextProblems({ name: input.name, ticker: input.ticker, note, description: creatorText, linkLabels: input.links.map((l) => String(l?.label ?? "")) });
  if (textProblems.length) return { error: fail(403, `This launch is refused: ${textProblems.map((x) => x.reason).join("; ")}`, { code: "copy-lint", categories: [...new Set(textProblems.flatMap((x) => x.categories))], problems: textProblems.map((x) => x.reason) }) };
  const native = locked.rule.oracle === "catalogue" ? nativeSourceById(locked.rule.series!) : null;
  if (native) {
    // the source's fixed-unit check ran in ruleRefusals above
    seriesTitle = native.title;
  } else if (locked.rule.oracle === "catalogue") {
    // an unknown feed, the feed's fixed unit / launchability and an already-decided one-time result were refused by ruleRefusals above
    const feed = feedById(locked.rule.series!)!;
    feedText = feed.unit ? { title: feed.title, sourceName: feed.sourceName, unitLabel: feed.unit.label } : null;
    const elig = sampleEligibility(feed, Date.now());
    seriesTitle = elig.subject ? `${elig.subject.name} succeeds (Launch Library 2)` : feed.title;
    subjectName = elig.subject?.name ?? null;
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
    statedText = statedCtx(info);
    refusals.push(...refusalsFor(list, { titles: [info.title] }));
    if (locked.rule.market) {
      const m = await p.polymarket.marketByCondition(locked.rule.market).catch(() => null);
      if (m && !isBinary(m)) return { error: fail(400, `Polymarket market ${key} has ${m.outcomes.length} outcomes. Only yes-or-no markets can be used for now.`) };
    } else {
      // One keeper cycle must cover a week of the selector's closed markets (the scan cap): a denser tag is narrowed or refused.
      let scan;
      try { scan = await p.polymarket.candidates(wideRule(locked.rule), { closed: true, sinceIso: new Date(p.polymarket.clock() - 7 * 86_400_000).toISOString() }); }
      catch (e) { return { error: fail(502, `A week of ${key} could not be read from Polymarket to check how many markets it settles. The reason given was: ${safeErrorText(e, 120)}`) }; }
      if (!scan.complete) return { error: fail(400, `${key} settles more than ${p.polymarket.pageCap * p.polymarket.pageSize} Polymarket markets a week. Narrow it to one market type, such as moneyline, or to one event pattern.`) };
    }
  } else if (locked.rule.oracle === "derby") {
    // BURN DERBY (2026-10-10): platform coins never sit on the input side; the refuse list over the coins; a Pyth feed or ≥ $250K of
    // liquidity; distinct coins; a season that starts after launch; a bracket slot that matches its registered tournament.
    let dr;
    try { dr = await derbyAdmission(locked.rule, { registry: p.registry, fetchImpl: p.derbyFetch ?? (globalThis.fetch as unknown as FetchLike), now: Date.now(), refuse: list }); }
    catch (e) { return { error: fail(502, `A second source for the Burn Derby could not be read, so liquidity could not be checked. The reason given was: ${safeErrorText(e, 120)}`) }; }
    if (dr.length) return { error: fail(403, `This launch is refused: ${dr.map((r) => r.reason).join("; ")}`, { code: "refused", refusals: dr }) };
    seriesTitle = derbyTitle(locked.rule);
  } else return { error: fail(400, `Coins cannot launch on the ${locked.rule.oracle} source yet. Kalshi, Polymarket, our own feeds and the Burn Derby are live.`, { code: "oracle-off" }) };   // ruleRefusals refused it already
  if (refusals.length) return { error: fail(403, refusalMessage(refusals), { code: "refused", refusals }) };
  // 2026-10-14: a retry of the creator's own unfinished draft (same mint, same rule, same ticker) is not a clash — its row is reused
  if (o.mint && p.registry.token(o.mint)) {
    const own = p.registry.ownDraft(o.mint, input.creator);
    if (!own) return { error: fail(409, `The mint ${o.mint} is already registered.`, { code: "mint-taken" }) };
    // audit 2026-10-15 F3: a pair's stored side-A rule carries the pair clause (pair id, side, void date, winner takes the burn) that
    // the request's rule does not; the pair branch expands the request with the recorded pair id and void date and compares there
    if (own.ticker !== input.ticker || (!b.pair && own.rulesJson !== locked.text)) return { error: fail(409, OWN_DRAFT_CHANGED, { code: "own-draft-changed" }) };
  }
  // review of block M: a prepare that registers nothing (a dry run, register: false) is a free question, so the own-draft ticker exemption
  // applies there only when the request carries that wallet's own signed request (else "not taken" would tell anyone who owns a draft)
  const registers = o.register && !o.dryRun;
  // second audit 2026-10-19 I-17: an older build running on a registry file a newer build migrated (a rollback) does not know the newer
  // file's guards, so it takes no new launch; reads and dry runs go on (the registry alerted the owner when it opened the file)
  if (registers && typeof p.registry.newerSchemaVersion === "number") return { error: fail(503, REGISTRY_NEWER_REFUSAL, { code: "registry-newer", retryAfterSec: 600 }) };
  const tickerOwner = registers ? input.creator : provenReviewCreator({ creator: input.creator, walletProof: (body as { walletProof?: unknown }).walletProof, ticker: input.ticker, pair: b.pair ?? null }, [publicOrigin()]);
  { const g = await launchGuardRefusal(p, { ticker: input.ticker, name: input.name, rule: locked.rule, mint: o.mint ?? null, creator: input.creator, tickerOwner }); if (g) return { error: fail(g.status, g.error, g.extra) }; }   // lookalike + no adoption (growth batch; lookalike.ts)
  /**
   * Third prelaunch audit 2026-10-19 F04: the mint lock above is per mint, so two creators' prepares for one unused ticker (different
   * mints) both passed the guard. The registry is the arbiter: a prepare that registers holds the ticker in the registry right after its
   * guard passes, so the second creator is refused here, before anything is uploaded. The hold is given back when the prepare ends
   * (its draft holds the ticker from then on), and lapses on its own after 15 minutes. A dry run holds nothing.
   */
  const holdTicker = (ticker: string, mint: string | null, sideB: boolean): { error: ApiResult } | null => {
    const r = p.registry.reserveTicker(ticker, input.creator, mint);
    if (!r.ok) { const g = tickerTakenRefusal(p, ticker, input.creator); return { error: fail(g.status, sideB ? sideBRefusal(g.error) : g.error, g.extra) }; }
    held.push(() => p.registry.releaseTicker(ticker, input.creator));
    return null;
  };
  // B-2 (third audit 2026-10-19): the same creator's earlier draft of this ticker whose create was sent and may still land (or has
  // landed) refuses a second coin: the creator finishes that launch from the page's recovery notice (launchPending.ts)
  const pendingRefusal = async (ticker: string, mint: string | null, sideB: boolean): Promise<{ error: ApiResult } | null> => {
    const lp = await launchPendingRefusal(p, { creator: input.creator, ticker, exceptMint: mint });
    return lp ? { error: fail(lp.status, sideB ? sideBRefusal(lp.error) : lp.error, lp.extra) } : null;
  };
  if (registers) { const lp = await pendingRefusal(input.ticker, o.mint ?? null, false); if (lp) return lp; }
  if (registers) { const h = holdTicker(input.ticker, o.mint ?? null, false); if (h) return h; }
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
  const ctxA = { ...serverDescribeCtx(locked.rule, (body as { descCtx?: unknown }).descCtx, { seriesTitle, feed: feedText, stated: statedText }), ...(subjectName ? { subjectName } : {}) };
  // website-15 item 13: the generated paragraph (its first sentence is the rule) always comes first; the creator's text follows it
  input.description = withCreatorText(generatedParagraph(locked.rule, input.ticker, ctxA), creatorText);
  // NOTHING ABOUT A COIN CAN CHANGE AFTER LAUNCH (pin.ts): the metadata JSON and the receipt art are pinned on Arweave before the
  // bundle is built, and the token URI is the arweave URL. An upload failure refuses the launch; the hosted JSON only behind
  // BURNTICKER_ALLOW_HOSTED_METADATA (devnet scripts). A preview bundle (register: false) pins nothing and says so.
  const pins = new Map<string, PinnedCoin | null>();
  // audit 2026-10-15 F4: the metadata identity each side was prepared with, written with its draft (register below)
  const identities = new Map<string, string>();
  // THE PIN BUDGET (review N4; audit H4; review 2026-10-15 items 2 and 5). The host's daily cap, and a per-requester cap: the `creator`
  // field is not authenticated, so it is always counted per CLIENT (http.ts clientKey), and also per (client, creator) for a creator who
  // already has a launch confirmed on chain here (fourth audit pass F-20: an extra limit, never a replacement for the client's; rotating
  // creators, made up or real, never escapes the client count). Checked for every side a launch will
  // pin BEFORE a bank key is taken or anything is uploaded; only an upload that succeeded is counted.
  const day = new Date().toISOString().slice(0, 10), client = o.client ?? "unknown";
  const budgetKeys = { wallet: `pin.budget.${day}.wallet.${input.creator}`, global: `pin.budget.${day}`, client: `pin.budget.${day}.client.${client}`, clientReal: `pin.budget.${day}.client.${client}.real`, clientCreator: `pin.budget.${day}.client.${client}.creator.${input.creator}` };
  // third prelaunch audit F04: a slot reserved by a prepare still uploading counts like a charged one (the cap was checked before the
  // awaited upload and charged after it, so three prepares at once with a cap of one all pinned)
  const chargedOf = (k: string) => Number(p.registry.getStatus(k) ?? 0) || 0;
  const countOf = (k: string) => chargedOf(k) + reservedOf(k);
  const realCreator = (() => { try { return p.registry.tokens().some((t) => t.creator === input.creator && !!t.launchTx); } catch { return false; } })();
  // an in-process caller with no client (scripts, tests) is held by the host's cap only; both launch routes always pass their client
  const perRequester = o.client !== undefined;
  /**
   * The buckets this prepare draws from. Fourth audit pass F-20 and its review: a creator with a confirmed launch here draws from its own
   * (client, creator) bucket AND the connection's bucket for such creators (`client.<key>.real`, capped like the client bucket), so naming
   * several wallets that launched cannot pass the connection's cap, and strangers with made-up creators (the plain client bucket) cannot
   * use up what a real creator on the same connection draws from.
   */
  // review of block M: a wallet that proved control is also counted by itself, across every connection, so one funded wallet behind many
  // addresses cannot spend the reserve kept for signed requests
  const myKeys = (): string[] => [budgetKeys.global, ...(!perRequester ? [] : realCreator ? [budgetKeys.clientCreator, budgetKeys.clientReal] : [budgetKeys.client]), ...(perRequester && signed ? [budgetKeys.wallet] : [])];
  /**
   * Prelaunch audit 2026-10-18 A-3: whether the creator's wallet signed this request (walletProof.ts), checked before anything is
   * counted, uploaded or taken from the mint bank. No proof: an unsigned request (it may still use the unsigned part of the day's
   * uploads). A proof that does not hold: refused, with the reason. In-process callers (scripts, the operator's tools) count as signed.
   */
  let signed = false, funded = true, costLamports = 0;
  // A-3 follow-up: a signature costs nothing to make, so a signed request reaches the reserve only when its wallet already holds the
  // launch's own cost (the review's quoted total); a signed wallet below that shares the unsigned part like an unsigned request
  const trusted = () => (signed && funded) || !perRequester;
  // at most a fifth of the day's cap, so a small cap (a test host, a cautious owner) is not all kept back
  const signedReserve = () => { const cap = p.pinDailyCap ?? DEFAULT_PIN_DAILY_CAP; return Math.max(0, Math.min(p.pinSignedReserve ?? DEFAULT_PIN_SIGNED_RESERVE, Math.floor(cap / 5))); };
  const proveWallet = async (tickers: string[], mints: (string | null | undefined)[], coins: number): Promise<{ error: ApiResult } | null> => {
    const raw = (body as { walletProof?: unknown }).walletProof;
    if (raw === undefined || raw === null) { signed = false; return null; }
    const want = { creator: input.creator, tickers, mints: mints.filter((m): m is string => !!m) };
    // review of block M: the text names this site (its public origin), and is spent once its prepare succeeds (walletProofCheck.ts)
    const c = checkWalletProof(raw, { ...want, origins: [publicOrigin()] });
    if (c.ok) onOk.push(() => spendProof(raw, want));
    if (!c.ok) return { error: fail(401, `${WALLET_PROOF_REFUSED} The reason was: ${c.reason}.`, { code: "wallet-proof-invalid" }) };
    signed = true;
    if (perRequester) {
      try { costLamports = launchLabCostLamports(locked.rule.reserveSol, coins); } catch { costLamports = launchLabCostLamports("0.02", coins); }
      funded = await walletCovers(p, input.creator, costLamports);
    }
    return null;
  };
  const budgetRefusal = (n: number): { error: ApiResult } | null => {
    if (n <= 0 || !p.uploader) return null;
    const cap = p.pinDailyCap ?? DEFAULT_PIN_DAILY_CAP, mine = p.pinCreatorDailyCap ?? DEFAULT_PIN_CREATOR_DAILY_CAP;
    // review follow-up 8: a cap reached only because other prepares hold slots while they upload is "busy", not "used up"
    const over = (k: string, limit: number, usedUp: string, code: string): { error: ApiResult } | null =>
      countOf(k) + n <= limit ? null : chargedOf(k) + n <= limit ? { error: fail(429, UPLOAD_BUSY_SENTENCE, { code: "upload-busy", retryAfterSec: 60 }) } : { error: fail(429, usedUp, { code }) };
    // prelaunch audit 2026-10-18 A-3: a request the creator's wallet did not sign may use the daily limit less the part kept for signed
    // requests, so strangers with made-up wallets can never use up what a real creator needs
    const g = over(budgetKeys.global, cap, `This site has used up its daily upload limit of ${cap} coins. Please try again after midnight UTC.`, "upload-budget")
      ?? (trusted() ? null : signed ? over(budgetKeys.global, Math.max(0, cap - signedReserve()), unfundedUploadsSentence(costLamports), "upload-budget-unfunded") : over(budgetKeys.global, Math.max(0, cap - signedReserve()), UNSIGNED_UPLOADS_SENTENCE, "upload-budget-unsigned"));
    if (g || !perRequester) return g;
    { const w = signed ? over(budgetKeys.wallet, mine, `This wallet has saved the details of ${mine} coins on this site today, which is the daily limit for one wallet. Please try again after midnight UTC.`, "upload-budget-wallet") : null; if (w) return w; }
    if (realCreator) return over(budgetKeys.clientCreator, mine, `This wallet has saved the details of ${mine} coins on this site today, which is the daily limit for one wallet. Please try again after midnight UTC.`, "upload-budget-creator")
      ?? over(budgetKeys.clientReal, mine, `This connection has saved the details of ${mine} coins on this site today, which is the daily limit. Please try again after midnight UTC.`, "upload-budget-client");
    return over(budgetKeys.client, mine, `This connection has saved the details of ${mine} coins on this site today, which is the daily limit. Please try again after midnight UTC.`, "upload-budget-client");
  };
  let reserved = 0, charged = 0;
  /** F04: checks the caps for `n` pins and, in the same step, reserves them against every cap; the slots go back when the prepare ends. */
  const reservePins = (n: number): { error: ApiResult } | null => {
    const refused = budgetRefusal(n);
    if (refused || n <= 0 || !p.uploader) return refused;
    for (const k of myKeys()) adjustReserved(k, n);
    reserved += n;
    held.push(() => { if (reserved > 0) { for (const k of myKeys()) adjustReserved(k, -reserved); reserved = 0; } });
    return null;
  };
  /** F08: a counter in the registry's status table (the orphan and unknown file counts); a count never changes the answer. */
  const bumpStatus = (k: string, n: number) => { try { p.registry.setStatus(k, String(chargedOf(k) + n)); } catch { /* the count never changes the answer */ } };
  /** A paid upload this site recorded by its content hash (pinUploadKey). An unreadable record reads as none. */
  const readUpload = (sha: string): PinUploadRecord | null => { try { const v = p.registry.getStatus(pinUploadKey(sha)); return v ? JSON.parse(v) as PinUploadRecord : null; } catch { return null; } };
  const writeUpload = (sha: string, r: PinUploadRecord) => p.registry.setStatus(pinUploadKey(sha), JSON.stringify(r));
  /** A pin that worked (F08: a side's first paid upload): its reserved slot (if any) becomes a charged one. */
  const chargePin = () => {
    charged++;
    if (reserved > 0) { reserved--; for (const k of myKeys()) adjustReserved(k, -1); }
    for (const k of myKeys()) p.registry.setStatus(k, String(chargedOf(k) + 1));
    // A-3: the owner's phone hears once a day when half of the day's uploads are used (push.ts bt-pin-budget)
    try {
      const cap = p.pinDailyCap ?? DEFAULT_PIN_DAILY_CAP, used = chargedOf(budgetKeys.global);
      if (cap > 0 && used >= Math.ceil(cap / 2)) p.registry.recordAlert({ kind: "bt-pin-budget", key: `bt-pin-budget:${day}`, text: pinBudgetAlertText(used, cap, signedReserve()), meta: { day, used, cap, reserve: signedReserve() } });
    } catch { /* the alert never changes the answer */ }
  };
  /** Whether a side pins a new file: not when it retries the creator's own draft that already has its metadata (F4 reuses it). */
  const pinsNew = (knownMint: string | null): number => {
    if (!o.register && !o.dryRun) return 0;
    // review follow-up 9: the same condition pinFor reuses a file on (a hosted draft, or a pinned file with its id and hash)
    if (knownMint && p.registry.ownDraft(knownMint, input.creator)) { const meta = p.registry.tokenMeta(knownMint); if (meta && (meta.hosted || (meta.metadataUri && meta.metadataTx && meta.metadataSha256))) return 0; }
    return 1;
  };
  /**
   * Prelaunch audit 2026-10-18 F09: `knownMint` is the side's chosen mint (the caller's, a bank key or a fresh keypair), always picked
   * BEFORE this runs, so the pinned metadata's link names this coin's own mint page, never a ticker another coin may share.
   */
  const pinFor = async (sideRule: LockedRule, ticker: string, name: string, description: string, links: { label: string; url: string }[], imageUrl: string | null, image: { bytes: Uint8Array; contentType: string; badge?: boolean; rawSha?: string } | null, knownMint: string, creatorText = ""): Promise<{ error: ApiResult } | { pin: PinnedCoin | null }> => {
    // the deploy smoke's dry run (2026-10-15): the budget and the uploader are checked as a launch would, and nothing is uploaded or counted
    if (o.dryRun) {
      { const ob = budgetRefusal(1); if (ob) return ob; }
      if (!p.uploader && !p.allowHostedMetadata) return { error: fail(502, "The coin's details could not be saved on Arweave, so the launch is refused. The reason given was: this site has no Arweave uploader set up", { code: "pin-failed" }) };
      return { pin: null };
    }
    if (!o.register) return { pin: null };
    const registered = registeredDescription(sideRule, description);
    const identity = draftIdentity({ ticker, name, creatorText: creatorText.trim(), rulesSha256: sideRule.sha256, links, imageUrl, imageSha: image?.rawSha ?? (image ? sha256Hex(image.bytes) : null), badge: image ? image.badge ?? null : null });
    // F4: a retry of the creator's own draft reuses its metadata file, and only when every detail is the same; a change is refused here,
    // before anything is uploaded or counted
    const prior = p.registry.ownDraft(knownMint, input.creator);
    if (prior) {
      const stored = p.registry.getStatus(draftIdentityKey(knownMint));
      // a draft made before identities were recorded: the same name, description and links as its row, and no uploaded image (its bytes cannot be compared)
      const same = stored ? stored === identity : prior.name === name && prior.description === registered && JSON.stringify(prior.links.map((l) => [l.label, l.url])) === JSON.stringify(links.map((l) => [String(l?.label ?? ""), String(l?.url ?? "")])) && (prior.imageUrl ?? null) === (imageUrl ?? null) && !image;
      if (!same) return { error: fail(409, OWN_DRAFT_DETAILS_CHANGED, { code: "own-draft-changed" }) };
      identities.set(ticker, identity);
      const meta = p.registry.tokenMeta(knownMint);
      if (meta && !meta.hosted && meta.metadataUri && meta.metadataTx && meta.metadataSha256) {
        const pin: PinnedCoin = { metadataUri: meta.metadataUri, metadataTx: meta.metadataTx, metadataSha256: meta.metadataSha256, metadataJson: "", imageUri: meta.imageUri ?? "", imageTx: meta.imageTx ?? "", imageSha256: meta.imageSha256 ?? "", hosted: false };
        pins.set(ticker, pin);
        return { pin };
      }
      if (meta?.hosted) { pins.set(ticker, null); return { pin: null }; }
    }
    identities.set(ticker, identity);
    const uploader = p.uploader ?? null;
    // the budget was checked for every side before any key was taken (budgetRefusal above). Prelaunch audit 2026-10-18 F08: the slot is
    // charged the moment this side's FIRST paid upload succeeds (the image, before its metadata), not once the whole pin worked, so an
    // image saved before a failed metadata upload is never outside the caps. Each saved file is recorded durably by its content hash and
    // reused by a retry with the same bytes. A slot charged by an attempt that then failed is held by its file: the first later attempt
    // that reuses that file draws on it instead of a new slot. A timeout may have saved the file anyway: it is charged and counted unknown.
    let sideCharged = false, rideHeld: string | null = null;
    const holderKey = `${client}|${input.creator}`;
    const fresh: string[] = [];
    const chargeSide = () => { if (!sideCharged) { sideCharged = true; chargePin(); } };
    const hooks: PinHooks = {
      recall: (sha, contentType) => {
        const r = readUpload(sha);
        if (!r || r.contentType !== contentType) return null;
        // a file whose slot was charged by an attempt that failed: this attempt takes that slot over (claimed now, given back on failure)
        // review fix: only by the same requester (client AND creator) that was charged for it; anyone else may reuse the file (it is public)
        // but pays its own slot, so a stranger presenting a victim's orphaned image cannot take over the victim's charge
        if (r.unused && r.holder === holderKey && !rideHeld && !sideCharged) { rideHeld = sha; writeUpload(sha, { ...r, unused: false }); }
        return { id: r.id, url: r.url };
      },
      uploaded: (_kind, up, sha, contentType) => {
        // recorded first: the file exists and is paid for, whatever happens next. Review fix: written as NOT holding a slot, so a
        // concurrent prepare with the same bytes (bank-key prepares are not serialised) reuses the file but pays its own slot; the slot is
        // handed to the file only once this attempt has failed (the catch below)
        writeUpload(sha, { id: up.id, url: up.url, contentType, unused: false, at: Date.now() });
        fresh.push(sha);
        if (!rideHeld) chargeSide();
      },
      failed: (_kind, e) => { if (uploadMayHaveCompleted(e)) { chargeSide(); bumpStatus(`pin.unknown.${day}`, 1); } },
    };
    try {
      if (!uploader) throw new Error("this site has no Arweave uploader set up");
      const pin = await pinCoin(uploader, { ticker, mint: knownMint, name, description: metadataDescription(sideRule, registered), oneLiner: describeRule(sideRule.rule, { ticker }).oneLiner, rule: sideRule.rule, rulesSha256: sideRule.sha256, origin: publicOrigin(), links, image }, hooks);
      pins.set(ticker, pin);
      return { pin };
    } catch (e) {
      // the files this attempt saved stay recorded for a retry; until one uses them they are counted as orphans of the day
      if (fresh.length) bumpStatus(`pin.orphans.${day}`, fresh.length);
      // the slot this attempt was charged is held by its first saved file (one file, so one later attempt can take it over)
      if (sideCharged && fresh.length) { const r = readUpload(fresh[0]); if (r) writeUpload(fresh[0], { ...r, unused: true, holder: holderKey }); }
      if (rideHeld) { const r = readUpload(rideHeld); if (r) writeUpload(rideHeld, { ...r, unused: true }); }
      if (p.allowHostedMetadata) { pins.set(ticker, null); return { pin: null }; }
      // polish-1: the owner's phone hears about a refused pin (push.ts reads the alerts table; one row per ticker per Denver day)
      try { p.registry.recordAlert({ kind: "bt-pin-failed", key: `bt-pin-failed:${ticker}`, text: `$${ticker}: the coin's details could not be saved on Arweave, so its launch was refused. ${safeErrorText(e, 160)}`, meta: { ticker } }); } catch { /* the alert never changes the answer */ }
      return { error: fail(502, `The coin's details could not be saved on Arweave, so the launch is refused. A coin's details are never kept on a server that could change them. The reason given was: ${safeErrorText(e, 160)}`, { code: "pin-failed" }) };
    }
  };
  /**
   * F03, the registry as the arbiter: read again right before the drafts are written (nothing awaited in between, so no other prepare in
   * this process runs in the gap). A draft that appeared for the mint while this prepare was uploading (another process, or a path
   * that skipped the lock) wins if its identity differs: this prepare is refused. Review follow-up 1: its files really were uploaded, so
   * they stay charged; they are counted as orphans for the day (`pin.orphans.<day>`) and the owner's phone hears of it.
   */
  const draftRaceRefusal = (sides: [string, string][]): { error: ApiResult } | null => {
    for (const [mint, ticker] of sides) {
      if (!p.registry.token(mint)) continue;
      if (!p.registry.ownDraft(mint, input.creator)) return raceRefusal(fail(409, `The mint ${mint} is already registered.`, { code: "mint-taken" }));
      const stored = p.registry.getStatus(draftIdentityKey(mint)), mine = identities.get(ticker);
      if (stored && mine && stored !== mine) return raceRefusal(fail(409, OWN_DRAFT_DETAILS_CHANGED, { code: "own-draft-changed" }));
    }
    return null;
  };
  const raceRefusal = (r: ApiResult): { error: ApiResult } => {
    if (charged > 0) {
      const k = `pin.orphans.${day}`;
      try { p.registry.setStatus(k, String((Number(p.registry.getStatus(k) ?? 0) || 0) + charged)); } catch { /* the count never changes the answer */ }
      try { p.registry.recordAlert({ kind: "bt-pin-orphan", key: `bt-pin-orphan:${input.ticker}`, text: `$${input.ticker}: ${charged === 1 ? "one file was" : `${charged} files were`} saved on Arweave for a draft that another prepare registered first. The files stay on Arweave and are not used.`, meta: { ticker: input.ticker, mint: o.mint ?? null, files: charged } }); } catch { /* the alert never changes the answer */ }
      charged = 0;
    }
    return { error: r };
  };
  /** F04: register() refused a draft whose ticker another creator holds (the hold lapsed, or a path that took none): 409, files counted as orphans. */
  const tickerTakenAnswer = (e: unknown, sideBTicker: string | null): { error: ApiResult } | null => {
    if (e instanceof RegistrySchemaNewerError) return { error: fail(503, REGISTRY_NEWER_REFUSAL, { code: "registry-newer", retryAfterSec: 600 }) };   // I-17 backstop
    if (!(e instanceof TickerTakenError)) return null;
    const g = tickerTakenRefusal(p, e.ticker, input.creator);
    return raceRefusal(fail(g.status, sideBTicker !== null && e.ticker === sideBTicker.toUpperCase() ? sideBRefusal(g.error) : g.error, g.extra));
  };
  const uriFor = (ticker: string) => (m: string) => { const pin = pins.get(ticker); return pin ? pin.metadataUri : o.register ? `${publicOrigin()}/api/burnticker/metadata/${m}` : "ar://pending-upload-at-launch"; };
  const deps = { program: p.program, launchLab: p.launchLab, devFeeWallet: p.devFeeWallet, attesters: p.keeperPubkey ? [p.keeperPubkey] : [], quorum: 1, metadataUri: uriFor(input.ticker), keeperPubkey: p.keeperPubkey, allowMainnet: p.allowMainnet === true };
  const register = (bundle: LaunchBundle, ticker: string, imageUrl: string | null, links: { label: string; url: string }[], creatorNote = "", poolId: string | null = bundle.addresses.poolId): TokenRow => {
    const reused = p.registry.ownDraft(bundle.mint, input.creator);   // 2026-10-14: the retry of an unfinished draft (checked above: same rule)
    const token = reused && reused.rulesJson === bundle.rules.text ? reused : p.registry.register({ mint: bundle.mint, ticker, name: bundle.name, creator: input.creator, description: bundle.description, imageUrl, links, rulesText: bundle.rules.text, feePda: bundle.addresses.feePda, vault: bundle.addresses.vault, tokenConfig: bundle.addresses.tokenConfig, poolId, launchTx: null, cluster: p.cluster, platformId: bundle.addresses.platformId, baselineAt: new Date().toISOString(), status: "draft" });
    if (p.keeperPubkey) p.registry.addAttester({ mint: token.mint, pubkey: p.keeperPubkey, role: "data-key", addedAt: Date.now(), timelockUntil: null });
    const pin = pins.get(ticker) ?? null;
    // F4: the identity the metadata file was made from, recorded once with the draft (a retry is compared against it)
    { const id = identities.get(ticker); if (id && !p.registry.getStatus(draftIdentityKey(token.mint))) p.registry.setStatus(draftIdentityKey(token.mint), id); }
    // audit F01: every value initialize_token was built with, so the confirm step and the keeper can compare the chain field by field (a
    // pair-curve side's create is the same instruction re-encoded with policy 2; a retry of this draft keeps its earlier floors accepted)
    if (bundle.expectedConfig && token.mint === bundle.mint) {
      const config = poolId === null ? pairCurveExpected(bundle.expectedConfig, bundle.addresses.platformId) : bundle.expectedConfig;
      // B-1 (third audit 2026-10-19): and every argument of the LaunchLab create the bundle encodes (its own initialize_v2, decoded)
      const create = poolId === null ? null : expectedCreateFromBundle(bundle.transactions, bundle.mint);
      const next = create ? { ...config, launchCreate: create } : config;
      p.registry.setStatus(expectedConfigKey(token.mint), JSON.stringify(mergeExpected(loadExpectedConfig(p.registry, token.mint), next)));
    }
    p.registry.putTokenMeta({ mint: token.mint, creatorNote, metadataUri: pin?.metadataUri ?? null, metadataTx: pin?.metadataTx ?? null, metadataSha256: pin?.metadataSha256 ?? null, imageUri: pin?.imageUri ?? null, imageTx: pin?.imageTx || null, imageSha256: pin?.imageSha256 || null, hosted: !pin });
    return token;
  };
  if (b.pair) {
    // 2026-10-14: the launch page sends both mints' public keys (side A in `mint`, side B in `pair.mint`); one without the other is the
    // public API's single-coin call, which never takes a pair
    if (!!o.mintKeypair !== !!o.mintKeypairB) return { error: fail(400, "A rivalry pair takes two prepared addresses, one for each coin.") };
    if (!!o.mint !== !!o.mintB) return { error: fail(400, "A rivalry pair is launched through the pair steps on the launch page, with two new mints. The public API takes one coin at a time.") };
    if (o.mintB && p.registry.token(o.mintB) && !p.registry.ownDraft(o.mintB, input.creator)) return { error: fail(409, `The mint ${o.mintB} is already registered.`, { code: "mint-taken" }) };
    // WIRING-MEDIA-RECOVERY item 235: a restart after side A's create landed on chain must not make a second A. A draft this creator
    // registered for the same side-A ticker and name whose mint exists on chain is that A: the new plan is refused, naming the mint.
    { const prior = await createdSideA(p, input); if (prior) return { error: fail(409, `Side A, $${input.ticker}, was already created on chain from an earlier plan as mint ${prior}. A new plan would create a second $${input.ticker}. Finish that pair from the launch history, or pick a different ticker and name.`, { code: "pair-side-a-created", mint: prior }) }; }
    const side = { ticker: String(b.pair.ticker ?? "").toUpperCase(), name: String(b.pair.name ?? ""), description: String(b.pair.description ?? ""), imageUrl: null as string | null, links: Array.isArray(b.pair.links) ? b.pair.links as { label: string; url: string }[] : [] };
    // website-18 (the owner: "I also don't see the ability to change the thumbnail pic"): side B carries its own creator description,
    // links and uploaded image, checked like side A's and pinned in its own metadata file
    const pb = b.pair as PairSideInput;
    const creatorTextB = typeof pb.creatorDescription === "string" ? pb.creatorDescription.trim() : "";
    if (creatorTextB.length > DESCRIPTION_MAX) return { error: fail(400, `Side B: the description can be at most ${DESCRIPTION_MAX} characters.`, { code: "description-too-long" }) };
    const upB = await uploadOf(pb, "Side B: ");
    if ("error" in upB) return upB;
    const sideText = creatorTextProblems({ name: side.name, ticker: side.ticker, note: "", description: creatorTextB, linkLabels: side.links.map((l) => String(l?.label ?? "")) });
    if (sideText.length) return { error: fail(403, `Side B is refused: ${sideText.map((x) => x.reason).join("; ")}`, { code: "copy-lint", categories: [...new Set(sideText.map((x) => x.category))], problems: sideText.map((x) => x.reason) }) };
    const bProblems = launchProblems({ ...input, ...side });
    if (bProblems.length) return { error: fail(400, `Side B has a problem: ${bProblems.join("; ")}`, { problems: bProblems }) };
    const bRefusals = nameRefusals(list, side.name, side.ticker);
    { const ir = identityRefusals({ ticker: side.ticker, name: side.name, description: creatorTextB }, { refuseList: false }); if (ir.length) return { error: fail(ir[0].status, `Side B: ${ir[0].message}`, { code: ir[0].code, problems: ir.map((x) => `Side B: ${x.message}`) }) }; }
    if (bRefusals.length) return { error: fail(403, `Side B is refused: ${bRefusals.map((r) => r.reason).join("; ")}`, { code: "refused", refusals: bRefusals }) };
    { const g = await launchGuardRefusal(p, { ticker: side.ticker, name: side.name, rule: null, ...(o.mintB ? { mint: o.mintB } : {}), creator: input.creator, tickerOwner }); if (g) return { error: fail(g.status, sideBRefusal(g.error), g.extra) }; }
    if (registers && side.ticker !== input.ticker) { const lp = await pendingRefusal(side.ticker, o.mintB ?? null, true); if (lp) return lp; }   // B-2: side B's ticker too
    if (registers && side.ticker !== input.ticker) { const h = holdTicker(side.ticker, o.mintB ?? null, true); if (h) return h; }   // F04: side B's ticker too
    // two candidates: both markets must be named outcomes of the one race the body names (Polymarket's own index of open races)
    if (settled?.shape === "candidates" && settled.bundle.race) {
      if (p.polymarketDiscovery === false) return { error: fail(503, POLYMARKET_UNAVAILABLE) };
      try {
        const race = (await loadRaces((u) => p.polymarket.get(u), refuseTitlesList)).find((r) => r.slug === settled.bundle.race!.slug);
        const ids = new Set(race?.outcomes.map((o) => o.conditionId) ?? []);
        if (!race || !ids.has(locked.rule.market ?? "") || !ids.has(settled.bundle.race.marketB)) return { error: fail(400, "Both candidates must be named outcomes of the same open race. Pick the race again, then two of its candidates.", { code: "candidates-not-one-race" }) };
      } catch (e) { return { error: fail(502, `Polymarket could not be reached just now. The reason given was: ${safeErrorText(e, 160)}`) }; }
    }
    // Round 5 (WIRING-ROUND5 item 1): side B's own pinned token, checked like side A's field (rules.ts validateRule runs again when
    // buildPairBundles locks side B's rule; a vault rule or a bad shape is refused there too)
    const btRaw = pb.burnTarget;
    if (btRaw !== undefined && btRaw !== null) { const bp = burnTargetShapeProblems(btRaw); if (bp.length) return { error: fail(400, `Side B: ${bp.join("; ")}`, { code: "burn-target", problems: bp }) }; }
    const btB = btRaw === undefined || btRaw === null ? null : (btRaw as BurnTargetField);
    { const br = burnRealRefusal(btB); if (br) return { error: fail(br.status, `Side B: ${br.message}`, { code: br.code, problems: [br.message] }) }; }
    { const fp = realBurnFamilyProblem(locked.rule, btB, "B"); if (fp) return { error: fail(400, `Side B: ${fp}`, { code: REAL_BURN_FAMILY_CODE, problems: [fp] }) }; }
    // audit 2026-10-15 F3: a retry of the creator's own unfinished pair (same side-A address) keeps the pair id and the void date its
    // side-A draft recorded; a fresh pair id or a new 30-day date would make the same request a different rule
    const ownA = o.mint ? p.registry.ownDraft(o.mint, input.creator) : null;
    const recorded = ownA ? (() => { try { return lockRule(JSON.parse(ownA.rulesJson)).rule.pair ?? null; } catch { return null; } })() : null;
    if (ownA && !recorded) return { error: fail(409, OWN_DRAFT_CHANGED, { code: "own-draft-changed" }) };
    // a settled-event pair has the 30-day both-or-neither date (its graduation deadline), not the market's own end date
    const pairVoidBy = recorded?.voidBy ?? (settled ? defaultVoidBy() : await oneShotVoidBy(p, locked) ?? undefined);
    const pairIdChoice = recorded ? { pairId: recorded.pairId } : { pairIdPick: (base: string) => p.registry.freePairId(base) };
    // audit 2026-10-15 H4: every check above has passed; only now are the bank keys taken (a refusal before this point takes none)
    // review 2026-10-15 (5): both sides' pins are checked against the caps before a key is taken or side A is pinned
    { const pf = await proveWallet([input.ticker, side.ticker], [o.mint, o.mintB], 2); if (pf) return pf; }   // A-3: before the budget, the keys and the uploads
    { const ob = reservePins(pinsNew(o.mint ?? null) + pinsNew(o.mintB ?? null)); if (ob) return ob; }
    if (o.takeMintKeys) { const t = o.takeMintKeys([input.ticker, side.ticker]); if ("error" in t) return t; if (t.keys.length < 2) return { error: fail(503, "This site could not prepare two addresses for the pair.", { code: "mint-bank-empty" }) }; o = { ...o, mintKeypair: t.keys[0], mintKeypairB: t.keys[1] }; }
    // F09 (prelaunch audit 2026-10-18): both mints are chosen here, before anything is pinned, so each side's metadata names its own mint
    if (!o.mint && !o.mintKeypair) o = { ...o, mintKeypair: Keypair.generate(), mintKeypairB: Keypair.generate() };
    try {
      // Side B's rule is side A's inverted (buildPairBundles); its description is generated from that rule after the bundle locks it.
      const ownMints: { mint?: string; mintB?: string; mintKeypair?: Keypair; mintKeypairB?: Keypair } = o.mint && o.mintB ? { mint: o.mint, mintB: o.mintB } : o.mintKeypair && o.mintKeypairB ? { mintKeypair: o.mintKeypair, mintKeypairB: o.mintKeypairB } : {};
      const probe = await buildPairBundles({ ...(recorded ? pairIdChoice : { pairIdPick: (base) => p.registry.freePairId(base) }), a: input, b: { ...side, description: "", burnTarget: btB }, voidBy: pairVoidBy, ...(settled?.bundle ?? {}) }, { ...deps, ...ownMints, metadataUri: () => "ar://pending-upload-at-launch" });
      const lockedB = lockRule(JSON.parse(probe.b.rules.text)), lockedA = lockRule(JSON.parse(probe.a.rules.text));
      // F3: side A's earlier draft is reused only with the same rule once the request is expanded with the recorded pair id and date
      if (ownA && ownA.rulesJson !== lockedA.text) return { error: fail(409, OWN_DRAFT_CHANGED, { code: "own-draft-changed" }) };
      // the pair row: a retry finds its own row (same two addresses); a row naming another address is a different pair
      { const row = p.registry.pair(probe.pairId); if (row && (row.mintA !== probe.a.mint || row.mintB !== probe.b.mint)) return { error: fail(409, OWN_DRAFT_CHANGED, { code: "own-draft-changed" }) }; }
      // 2026-10-14: side B's own earlier draft is reused only with the same rule (the registry row must match what the chain gets)
      if (o.mintB) { const ownB = p.registry.ownDraft(o.mintB, input.creator); if (ownB && ownB.rulesJson !== lockedB.text) return { error: fail(409, OWN_DRAFT_CHANGED, { code: "own-draft-changed" }) }; }
      // a settled-event pair's side B is described from ITS OWN event (candidate B's market, read here; team B's win in the game), never
      // side A's words (website-23: "$ROGEVELSA burns if the Democrats win"); its context is the body's pair.descCtx
      let ctxB = serverDescribeCtx(lockedB.rule, null, { seriesTitle, feed: feedText });
      if (settled) {
        let titleB: string | null = null, statedB: ReturnType<typeof statedCtx> = null;
        if (lockedB.rule.oracle === "polymarket" && lockedB.rule.market) { const info = await p.polymarket.seriesInfo(lockedB.rule.market).catch(() => null); titleB = info?.title ?? null; statedB = info ? statedCtx(info) : null; }
        else if (lockedB.rule.oracle === "catalogue") titleB = nativeSourceById(lockedB.rule.series!)?.title ?? null;
        ctxB = sideBDescribeCtx(lockedB.rule, (pb as { descCtx?: unknown }).descCtx, (body as { descCtx?: unknown }).descCtx, { seriesTitle: titleB, stated: statedB });
      }
      side.description = withCreatorText(generatedParagraph(lockedB.rule, side.ticker, ctxB), creatorTextB);
      input.description = withCreatorText(generatedParagraph(lockedA.rule, input.ticker, ctxA), creatorText);
      for (const [lk, tk, nm, desc, links, img, up] of [[lockedA, input.ticker, input.name, input.description, input.links, input.imageUrl, uploaded], [lockedB, side.ticker, side.name, side.description, side.links, side.imageUrl, upB.up]] as const) {
        const r = await pinFor(lk, tk, nm.trim(), desc, links, img, up, tk === input.ticker ? probe.a.mint : probe.b.mint, tk === input.ticker ? creatorText : creatorTextB);
        if ("error" in r) return r;
      }
      // an uploaded image is shown from its pinned Arweave copy, per side
      const shownImage = (tk: string, url: string | null, up: unknown) => (up ? pins.get(tk)?.imageUri ?? url : url);
      input.imageUrl = shownImage(input.ticker, input.imageUrl, uploaded); side.imageUrl = shownImage(side.ticker, side.imageUrl, upB.up);
      const pair = await buildPairBundles({ ...(recorded ? pairIdChoice : { pairIdPick: (base) => p.registry.freePairId(base) }), a: input, b: { ...side, burnTarget: btB }, voidBy: pairVoidBy, ...(settled?.bundle ?? {}) }, { ...deps, ...ownMints, metadataUri: uriFor(input.ticker), metadataUriB: uriFor(side.ticker) } as typeof deps);
      if (pair.a.mint !== probe.a.mint || pair.b.mint !== probe.b.mint) throw new Error("the pair's mints changed between the pin and the build; please try again");
      // 2026-10-10: behind BURNTICKER_PAIR_CURVE_ENABLED (default off) the pair launches through pair_curve (both graduate or neither).
      // Review N6: built BEFORE the drafts (a refused parameter set leaves no orphan draft), and the drafts then carry no LaunchLab
      // pool — under the pair curve the pool is the CPMM pool its graduation creates, registered later (policy 2).
      // a head-to-head season pair (rules.ts isMeetingsRule) is two LaunchLab coins linked at creation: the pair curve is for crypto references
      // …and so are two candidates in one race and two teams in one game: a LaunchLab pair linked at creation, both sinks naming each other
      if (settled) { const sp = settledPairSinkProblems({ rule: lockRule(JSON.parse(pair.a.rules.text)).rule, mint: pair.a.mint }, { rule: lockRule(JSON.parse(pair.b.rules.text)).rule, mint: pair.b.mint }); if (sp.length) return { error: fail(400, sp.join(" "), { code: "settled-pair-sinks", problems: sp }) }; }
      const pairCurve = pairCurveEnabled(process.env) && !isMeetingsRule(locked.rule) && !settled ? await buildPairCurveLaunch(pair, input.creator, { cluster: p.cluster, burnReceiptsProgramId: p.program.programId, cpConfigId: process.env.BURNTICKER_CP_CONFIG_ID?.trim() || undefined }) : undefined;
      if (o.register) { const race = draftRaceRefusal([[pair.a.mint, input.ticker], [pair.b.mint, side.ticker]]); if (race) return race; }
      let tokenA: TokenRow | null = null, tokenB: TokenRow | null = null;
      try {
        tokenA = o.register ? register(pair.a, input.ticker, input.imageUrl, input.links, note, pairCurve ? null : pair.a.addresses.poolId) : null;
        tokenB = o.register ? register(pair.b, side.ticker, side.imageUrl, side.links, "", pairCurve ? null : pair.b.addresses.poolId) : null;
      } catch (e) { const t = tickerTakenAnswer(e, side.ticker); if (t) return t; throw e; }   // F04: another creator's draft took a ticker first
      const row = tokenA && tokenB ? (() => { const had = p.registry.pair(pair.pairId); return had && had.mintA === tokenA.mint && had.mintB === tokenB.mint ? had : p.registry.registerPair(pair.pairId, tokenA.mint, tokenB.mint); })() : null;
      return { pair: { pairId: pair.pairId, selector: pair.selector, notes: pair.notes, row, bundles: { a: pair.a, b: pair.b }, tokens: { a: tokenA, b: tokenB }, seriesTitle, preflight, ...(pairCurve ? { pairCurve } : {}) } };
    } catch (e) {
      return { error: fail(400, safeErrorText(e, 600)) };
    }
  }
  if (locked.rule.pair) return { error: fail(400, "A rule that names a pair is launched through the pair steps. Send side B as a pair with its own ticker and name.") };
  // audit 2026-10-15 H4: every check has passed; only now is the bank key taken
  { const pf = await proveWallet([input.ticker], [o.mint], 1); if (pf) return pf; }   // A-3: before the budget, the key and the upload
  { const ob = reservePins(pinsNew(o.mint ?? null)); if (ob) return ob; }   // review 2026-10-15 (5): before the key
  if (o.takeMintKeys) { const t = o.takeMintKeys([input.ticker]); if ("error" in t) return t; o = { ...o, mintKeypair: t.keys[0] }; }
  // F09 (prelaunch audit 2026-10-18): the mint is chosen here, before anything is pinned, so the metadata names this coin's own mint
  if (!o.mint && !o.mintKeypair) o = { ...o, mintKeypair: Keypair.generate() };
  const chosenMint = o.mint ?? o.mintKeypair!.publicKey.toBase58();
  try {
    const pr = await pinFor(locked, input.ticker, input.name.trim(), input.description, input.links, input.imageUrl, uploaded, chosenMint, creatorText);
    if ("error" in pr) return pr;
    const bundle = await buildLaunchBundle(input, { ...deps, ...(o.mint ? { mint: o.mint } : { mintKeypair: o.mintKeypair! }) });
    if (bundle.mint !== chosenMint) throw new Error("the coin's mint changed between the pin and the build; please try again");
    // an uploaded image is shown from its pinned Arweave copy (the card and the coin page read the registry's image)
    if (o.register) { const race = draftRaceRefusal([[bundle.mint, input.ticker]]); if (race) return race; }
    let token: TokenRow | null = null;
    try { token = o.register ? register(bundle, input.ticker, uploaded && pr.pin ? pr.pin.imageUri : null, input.links, note) : null; }
    catch (e) { const t = tickerTakenAnswer(e, null); if (t) return t; throw e; }   // F04: another creator's draft took the ticker first
    return { ok: { bundle, token, seriesTitle, locked, preflight } };
  } catch (e) {
    return { error: fail(400, safeErrorText(e, 600)) };
  }
}

/** Review of block M (copy): a side B guard refusal in one sentence ("Side B is refused. This launch is refused." said it twice). */
export const sideBRefusal = (error: string): string => (/^This launch is refused\. /.test(error) ? error.replace(/^This launch is refused\. /, "Side B is refused. ") : `Side B is refused. ${error}`);
/** Review follow-up 8: a cap reached only by slots other prepares are holding while they upload. */
export const UPLOAD_BUSY_SENTENCE = "This site is busy saving other coins' details right now. Please try again in a minute.";
/** Coins pinned on Arweave per UTC day per host when BURNTICKER_PIN_DAILY_CAP is not set (review N4). */
export const DEFAULT_PIN_DAILY_CAP = 50;
/**
 * Audit 2026-10-15 H4 / review item 2: coins one requester may pin per UTC day when BURNTICKER_PIN_CREATOR_DAILY_CAP is not set (a pair
 * is two): per client, or per (client, creator) once that creator has a confirmed launch here.
 */
export const DEFAULT_PIN_CREATOR_DAILY_CAP = 6;
/**
 * The per-requester pin cap from the environment: BURNTICKER_PIN_CREATOR_DAILY_CAP when set, else the default (undefined). On a DEVNET
 * host only, BURNTICKER_DEVNET_PIN_CREATOR_DAILY_CAP may raise it, never lower it, to at most 1000 (2026-10-18: the nightly synthetic
 * creator launches a dozen devnet coins from one wallet on one loopback client, and the cap of 6 refused every scenario after the sixth
 * pin). Ignored on mainnet, localnet and a host with no cluster set: the live host's cap is untouched whatever its env says.
 */
export function pinCreatorDailyCapFromEnv(env: Readonly<Record<string, string | undefined>>): number | undefined {
  const set = (env.BURNTICKER_PIN_CREATOR_DAILY_CAP ?? "").trim();
  const base = /^\d+$/.test(set) ? Number(set) : undefined;
  const n = Number((env.BURNTICKER_DEVNET_PIN_CREATOR_DAILY_CAP ?? "").trim());
  if ((env.BURNTICKER_CLUSTER ?? "").trim() !== "devnet" || !Number.isInteger(n) || n <= (base ?? DEFAULT_PIN_CREATOR_DAILY_CAP) || n > 1000) return base;
  return n;
}
/**
 * Prelaunch audit 2026-10-18 A-3: of the host's daily uploads, this many are kept for requests the creator's wallet signed (the launch
 * page always asks for the signature) when BURNTICKER_PIN_SIGNED_RESERVE is not set, and never more than a fifth of the daily cap.
 * Unsigned requests share the rest.
 */
export const DEFAULT_PIN_SIGNED_RESERVE = 10;
export const UNSIGNED_UPLOADS_SENTENCE = "This site has used up today's uploads for launch requests that a wallet did not sign. The launch page asks your wallet to sign the request, which costs nothing; a signed request can use the part of the daily limit kept for signed requests. Or try again after midnight UTC.";
/** A-3 follow-up: a signed wallet that does not hold the launch's cost shares the unsigned uploads; this is said when those are used up. */
export const unfundedUploadsSentence = (costLamports: number): string => `This wallet signed the request, but it holds less than this launch costs (about ${solText(costLamports)} SOL), so it shares today's uploads for unsigned requests, and those are used up. Put the launch cost in the wallet first, then press Launch again.`;
/** How long a wallet's balance read is kept (per wallet, this process). */
export const WALLET_BALANCE_CACHE_MS = 60_000;
/** The balance cache's size bound (review of block M). */
export const WALLET_BALANCE_CACHE_MAX = 1_000;
/** For tests: the wallets whose balance is cached, oldest first. */
export const cachedBalanceWallets = (): string[] => [...balances.keys()];
const balances = new Map<string, { at: number; lamports: number | null }>();
export function resetWalletBalances(): void { balances.clear(); }
/**
 * A-3 follow-up: whether `wallet` holds at least `lamports`, read once per prepare through the host's budgeted connection (p.market) and
 * kept 60 s per wallet. A read that fails, or a malformed wallet, counts as not covered (the request shares the unsigned uploads). A
 * host with no chain connection cannot check and does not hold signed creators back.
 */
export async function walletCovers(p: Pick<Platform, "market">, wallet: string, lamports: number, now = Date.now()): Promise<boolean> {
  const m = p.market as (Platform["market"] & { getBalance?(pk: PublicKey, c?: "confirmed"): Promise<number> }) | null | undefined;
  if (!m || typeof m.getBalance !== "function") return true;
  let hit = balances.get(wallet);
  if (!hit || now - hit.at >= WALLET_BALANCE_CACHE_MS) {
    let v: number | null;
    try { v = await m.getBalance(new PublicKey(wallet), "confirmed"); } catch { v = null; }
    hit = { at: now, lamports: typeof v === "number" && Number.isFinite(v) ? v : null };
  }
  // review of block M: least recently used first out, at most WALLET_BALANCE_CACHE_MAX wallets
  balances.delete(wallet); balances.set(wallet, hit);
  while (balances.size > WALLET_BALANCE_CACHE_MAX) { const oldest = balances.keys().next().value; if (oldest === undefined) break; balances.delete(oldest); }
  return hit.lamports !== null && hit.lamports >= lamports;
}
export const WALLET_PROOF_REFUSED = "This launch request carries a wallet signature that does not check out, so nothing was saved or prepared. Press Launch again to sign a new one.";
/** The bt-pin-budget alert's line. */
export const pinBudgetAlertText = (used: number, cap: number, reserve: number): string => `Half of today's uploads are used: ${used} of ${cap} coins have been saved on Arweave since midnight UTC. Unsigned launch requests stop at ${Math.max(0, cap - reserve)}; the last ${reserve} are kept for requests a wallet signed.`;

/**
 * AUDIT A C1 review (8; re-review 1, 3): confirmations are metered on the heavy bucket, and expired drafts' mints are listed publicly, so
 * the verifier (an RPC transaction read and an account read per call) is guarded. Only DISTINCT signatures count (the same (mint,
 * signature) retried after a 404 counts once): at most CONFIRM_VERIFY_PER_CLIENT_MINT_HOUR per client and mint, and a ceiling of
 * CONFIRM_VERIFY_PER_MINT_HOUR per mint across clients, so one client cannot lock a creator out. A (mint, signature) refused for its
 * CONTENT (422, not an account not found yet) is answered from memory for REFUSAL_MEMORY_MS. The maps evict expired entries.
 */
export const CONFIRM_VERIFY_PER_CLIENT_MINT_HOUR = 12;
export const CONFIRM_VERIFY_PER_MINT_HOUR = 60;
export const REFUSAL_MEMORY_MS = 5 * 60_000;
const HOUR_MS = 3_600_000;
const GUARD_MAX_KEYS = 20_000;
const sigsByMint = new Map<string, Map<string, number>>();
const sigsByClientMint = new Map<string, Map<string, number>>();
const refusedConfirms = new Map<string, { at: number; status: number; reason: string }>();
/**
 * Prelaunch audit C2 re-review 4: a transaction the chain does not hold (404) is not a final refusal (an RPC can lag), so it is not kept
 * for REFUSAL_MEMORY_MS; but a repeated press with the same (mint, signature) is answered from memory for MISSING_MEMORY_MS, so a fake
 * signature costs the confirm lane one getTransaction a minute, not one per press. An account not shown yet (`missing`, AUDIT A
 * re-review 3) is still never remembered: its transaction exists, and the creator's retry must reach the chain.
 */
export const MISSING_MEMORY_MS = 60_000;
/**
 * Second prelaunch audit 2026-10-18 A-20: the client that first sent a signature is not held to that minute. The card retries a 404
 * every 4 seconds, and a server RPC a few seconds behind the browser used to answer every retry from memory until the card gave up on a
 * launch that had landed. That client may have the chain read again once this long has passed since its last read; others keep the minute.
 */
export const MISSING_RECHECK_MS = 3_000;
const missingConfirms = new Map<string, { at: number; checkedAt: number; status: number; reason: string; client: string }>();
export function resetConfirmGuards(): void { sigsByMint.clear(); sigsByClientMint.clear(); refusedConfirms.clear(); missingConfirms.clear(); }
/** Drops entries older than `ttl` (and the oldest keys beyond GUARD_MAX_KEYS); returns the live distinct signatures for `key`. */
function liveSigs(m: Map<string, Map<string, number>>, key: string, now: number): Map<string, number> {
  if (m.size > GUARD_MAX_KEYS) { for (const [k, v] of m) { for (const [s, at] of v) if (now - at >= HOUR_MS) v.delete(s); if (!v.size) m.delete(k); } while (m.size > GUARD_MAX_KEYS) m.delete(m.keys().next().value as string); }
  const v = m.get(key) ?? new Map<string, number>();
  for (const [s, at] of v) if (now - at >= HOUR_MS) v.delete(s);
  m.set(key, v);
  return v;
}
function rememberRefusal(key: string, r: { status: number; reason: string }, now: number): void {
  if (refusedConfirms.size > GUARD_MAX_KEYS) { for (const [k, v] of refusedConfirms) if (now - v.at >= REFUSAL_MEMORY_MS) refusedConfirms.delete(k); while (refusedConfirms.size > GUARD_MAX_KEYS) refusedConfirms.delete(refusedConfirms.keys().next().value as string); }
  refusedConfirms.set(key, { at: now, ...r });
}
/**
 * AUDIT A C1 review (1): the closure moment while launches are closed or in preview: the explicit flag, else the first time this host saw
 * them closed (recorded in registry status launches.closedAt, which the keeper's reconciler reads too); open clears it and returns null.
 */
export function launchesClosedAt(p: Pick<Platform, "registry">, env: Record<string, string | undefined> = process.env, now = Date.now()): number | null {
  if (launchModeFromEnv(env) === "open") { if (p.registry.getStatus("launches.closedAt")) p.registry.setStatus("launches.closedAt", "", now); return null; }
  const known = recordedClosure(p.registry, env);
  if (known !== null) return known;
  p.registry.setStatus("launches.closedAt", String(now), now);
  return now;
}

/**
 * `launched`: the landed launch transaction takes the draft live. ChatGPT/Codex review N1 (2026-10-10): the transaction is verified on
 * chain first (launchVerify.ts: successful, signed by the coin's mint and its creator, landed after the draft, carrying burn_receipts
 * initialize_token for this mint, the on-chain TokenConfig locking the draft's rules hash, and the venue completed — review-2 F3) and
 * the baseline is its BLOCK TIME; the same signature again is a no-op that leaves the baseline alone; a host without an RPC refuses.
 * AUDIT A C1: an EXPIRED draft is judged on the chain too, and both draft and expired rows are judged on the create's block time: in the
 * draft's window (24 h + DRAFT_GRACE_MS) it goes live whether or not a sweep ran; after it, only the operator script (--late) takes it
 * live. While launches are closed or in preview, only a create that landed before the closure is recorded.
 */
export async function markLaunched(p: Platform, mint: string, launchTx: string, now = Date.now(), client = "unknown", gate: unknown = null): Promise<ApiResult> {
  const t = p.registry.token(mint);
  if (!t) return fail(404, "There is no draft for this mint.");
  if (!/^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(launchTx)) return fail(400, "The launch transaction must be a transaction signature.");
  if (t.launchTx === launchTx) return ok({ ok: true, token: t, replay: true, note: `This launch was already confirmed in this transaction. The start time stays ${t.baselineAt}, which was fixed at launch.` });
  if (t.launchTx) return fail(409, `${mint} already launched in transaction ${t.launchTx}.`, { code: "already-launched" });
  if (t.status !== "draft" && t.status !== "expired") return fail(409, `${mint} is ${t.status}, so it is not a draft.`, { code: "not-a-draft" });
  if (!p.launchVerifier) return fail(503, "This site cannot check a launch transaction right now. A draft goes live only after its launch is read from the chain.", { code: "launch-unverifiable" });
  const key = `${mint}:${launchTx}`;
  const known = refusedConfirms.get(key);
  if (known && now - known.at < REFUSAL_MEMORY_MS) return fail(known.status, known.reason, { code: "launch-unverified" });
  const missing = missingConfirms.get(key);
  // A-20. Accepted limit: a third party that posts the creator's signature first becomes its "first client", and the creator then waits
  // out the minute (or the reconciler takes the coin live); bounded delay, never a loss
  const recheck = !!missing && missing.client === client && now - missing.checkedAt >= MISSING_RECHECK_MS;
  if (missing && now - missing.at < MISSING_MEMORY_MS && !recheck) return fail(missing.status, missing.reason, { code: "launch-unverified", retryAfterSec: Math.max(1, Math.ceil((missing.at + MISSING_MEMORY_MS - now) / 1000)) });
  // F-16 (prelaunch audit 2026-10-16): the per-CLIENT limit is the first gate and counts every distinct signature. The per-MINT ceiling
  // counts only signatures the chain holds that were signed by this coin's mint and creator: a made-up signature (not on chain) or a
  // stranger's real transaction copied off the chain never counts, so strangers cannot block the creator's confirm.
  const perMint = liveSigs(sigsByMint, mint, now), perClient = liveSigs(sigsByClientMint, `${client}|${mint}`, now);
  const limited = (m: Map<string, number>, cap: number) => !m.has(launchTx) && m.size >= cap;
  const tooMany = (m: Map<string, number>) => fail(429, "This coin's launch was checked with too many different transactions in the last hour. Please try again later.", { code: "rate-limited", retryAfterSec: Math.max(1, Math.ceil((Math.min(...m.values()) + HOUR_MS - now) / 1000)) });
  if (limited(perClient, CONFIRM_VERIFY_PER_CLIENT_MINT_HOUR)) return tooMany(perClient);
  if (!perClient.has(launchTx)) perClient.set(launchTx, now);
  const notOnChain = (reason: string) => {
    if (missingConfirms.size > GUARD_MAX_KEYS) { for (const [k, x] of missingConfirms) if (now - x.at >= MISSING_MEMORY_MS) missingConfirms.delete(k); while (missingConfirms.size > GUARD_MAX_KEYS) missingConfirms.delete(missingConfirms.keys().next().value as string); }
    // A-20: the first sender's re-check keeps the minute's start and its owner; only the time of its last read moves
    const prev = missingConfirms.get(key);
    missingConfirms.set(key, prev && prev.client === client && now - prev.at < MISSING_MEMORY_MS ? { ...prev, checkedAt: now, reason } : { at: now, checkedAt: now, status: 404, reason, client });
    return fail(404, reason, { code: "launch-unverified" });
  };
  // a signature the chain does not hold costs one status lookup, never a transaction read, and never a per-mint slot
  if (!perMint.has(launchTx) && p.launchVerifier.seen && (await p.launchVerifier.seen(launchTx)) === false) return notOnChain("No confirmed transaction with this signature on this cluster (yet). Send the launch, wait for it to confirm, then confirm again.");
  if (limited(perMint, CONFIRM_VERIFY_PER_MINT_HOUR)) return tooMany(perMint);
  // Review-2 F3: the verifier checks the launch's CONTENT (initialize_token for this mint, the on-chain TokenConfig's rules hash, the
  // venue) — and nothing is written to the registry unless it passes: a refused confirmation leaves status, baseline and launch_tx alone.
  // audit F01: and every rule parameter, key and pin initialize_token was built with (the stored expectation, else the locked rule's)
  const v = await p.launchVerifier.verify(launchTx, { mint, creator: t.creator, draftCreatedAtMs: t.createdAt, rulesSha: t.rulesSha, venue: launchVenueOf(t, p.registry.pairOf(mint)), config: expectedConfigFor(p.registry, t, expectedHostOf(p)) });
  // review L1: a slot is taken only by an answer about the transaction itself: it passed, or it was refused for its content or state
  // (422 / 409). RPC trouble (502, 503) and a throw (budget hold) never take one. F05 (prelaunch audit 2026-10-18): a refusal takes one
  // only when the verifier says affirmatively that this coin's mint and creator signed it; a missing answer is not proof, so a stranger's
  // failed transaction (refused before its content was read) never fills the creator's ceiling.
  if (!perMint.has(launchTx) && (v.ok || ((v.status === 422 || v.status === 409) && v.belongsToExpectedSigners === true))) perMint.set(launchTx, now);
  if (!v.ok) {
    if (v.status === 422 && !v.missing) rememberRefusal(key, v, now);
    else if (v.status === 404) return notOnChain(v.reason);
    // second audit 2026-10-18 A-19: an account not shown yet is said as such, so the card asks again instead of reading it as final
    return fail(v.status, v.reason, { code: "launch-unverified", ...(v.missing ? { missing: true } : {}) });
  }
  const baselineAt = new Date(v.blockTimeMs).toISOString();
  // F-3: the owner hears once per coin (draftReconciler.alertLaunchLate), with the operator's command that can still take it live
  if (!inDraftWindow(t.createdAt, v.blockTimeMs)) { alertLaunchLate(p.registry, t, launchTx, v.blockTimeMs, now); return fail(409, `This launch landed at ${baselineAt}, more than 24 hours after its draft was made, so it is not recorded here. Please build a new launch.`, { code: "launch-late" }); }
  const closedAt = launchesClosedAt(p, process.env, now);
  // prelaunch audit 2026-10-18 A-11: the owner hears once per coin, with the operator's command (draftReconciler.alertLaunchAfterClosure)
  // continuous audit 2026-10-19 SEC-03: a create after the closure whose plan record shows its first step was sent while launches were
  // open is admitted (launchGateAdmission.ts, bounded) and the owner told; without a consistent gate record it stays refused, as before
  const admit = admitAfterClosure({ closedAt, blockTimeMs: v.blockTimeMs, draftCreatedAt: t.createdAt, gate });
  if (!admit.admit) { try { alertLaunchAfterClosure(p.registry, t, launchTx, v.blockTimeMs, closedAt!, now); } catch { /* the alert never changes the answer */ } return fail(403, `This launch landed at ${baselineAt}, after creator launches closed, so it is not recorded.`, { code: "launch-after-closure" }); }
  if (admit.reason === "open-gate-record") { try { alertLaunchAdmittedAfterClosure(p.registry, t, launchTx, v.blockTimeMs, closedAt!, planGateOf(gate)!.at, now); } catch { /* the alert never changes the answer */ } }
  let r: ReturnType<Platform["registry"]["takeLiveFromChain"]>;
  try { r = p.registry.takeLiveFromChain(mint, launchTx, t.poolId, v.blockTimeMs, { source: "confirm" }, now); }
  catch (e) {
    // second audit 2026-10-19 I-16: the expired draft's ticker went to another creator's draft or coin, so it is not revived (the
    // registry recorded the owner's alert in the same step)
    if (e instanceof RevivalTickerHeldError) return fail(409, `This draft had expired, and its ticker $${e.ticker} now belongs to another Burnticker coin, so it is not taken live here. The site's operator has been told.`, { code: "revival-ticker-held" });
    // B-2 (third audit 2026-10-19): a ticker is one live coin; the registry recorded the owner's alert in the same step
    if (e instanceof TickerAlreadyLiveError) return fail(409, `${e.sameCreator ? "You already have a live" : "There is already a live"} $${e.ticker} on this site (mint ${e.liveMint}), and a ticker is one coin here, so this second $${e.ticker} is not taken live. The site's operator has been told.`, { code: "ticker-live", liveMint: e.liveMint });
    return fail(409, safeErrorText(e, 600), { code: "launch-race" });
  }
  return ok({ ok: true, token: p.registry.token(mint), ...(r.revived ? { revived: true } : {}), note: `The launch transaction was read from the chain. The start time is its block time, ${baselineAt}. Results settled after this moment count.${r.revived ? " This draft had been marked expired, and the chain shows its coin was created in time, so it is live now." : ""}` });
}

/**
 * B-2 (third audit 2026-10-19): the launch page reports a create it is about to send (POST /api/burnticker/launch { action: "sent", mint,
 * sentTx }: the signed transaction, base64). Recorded only for an unlaunched draft, when the transaction is that draft's create signed by
 * its creator and its mint (launchPending.ts verifySentCreate), so nobody else can mark a draft. From then until the send can no longer
 * land, the creator's next prepare of the same ticker is refused as launch-pending. Re-sending the same report is a no-op.
 *
 * SEC-05 (continuous audit 2026-10-19): the answer is the acknowledgement the page waits for before it sends the create, so it is
 * authoritative. 200 only once the draft_sends row is written, naming it: `{ ok: true, recorded: { mint, sentAt }, fresh, signature }`.
 * 409 launch-pending (or ticker-taken) when another attempt of this creator's ticker on a different mint is recorded and can still land,
 * has landed, or is live (launchPendingRefusal, then the same judgement again inside the transaction that writes the row, so two racing
 * reports for two mints cannot both be recorded). 503 when the row cannot be written. Anything but the named row: the page does not send.
 */
export async function markCreateSent(p: Pick<Platform, "registry" | "market"> & { program?: { programId: string } | null }, mint: string, sentTx: unknown, now = Date.now()): Promise<ApiResult> {
  const t = p.registry.token(mint);
  if (!t) return fail(404, "There is no draft for this mint.");
  if (t.launchTx || (t.status !== "draft" && t.status !== "expired")) return ok({ ok: true, recorded: false, note: "This coin is already launched." });
  const v = verifySentCreate(t, sentTx);
  if (!v.ok) return fail(v.status, v.reason, { code: "sent-refused" });
  const ticker = t.ticker.trim().replace(/^\$/, "").toUpperCase();
  const lp = await launchPendingRefusal(p, { creator: t.creator, ticker, exceptMint: mint }, now);
  if (lp) return fail(lp.status, lp.error, lp.extra);
  let r: ReturnType<Platform["registry"]["recordCreateSentExclusive"]>;
  try { r = p.registry.recordCreateSentExclusive(mint, v.signature, CREATE_SEND_PENDING_MS, now); }
  catch { return fail(503, "This site could not record the launch just now, so it was not sent. Wait a moment, then try again.", { code: "sent-unrecorded" }); }
  if (!r.ok) return r.live ? fail(409, r.sameCreator ? ownLiveTickerSentence(ticker, r.otherMint) : `There is already a live $${ticker} on this site (mint ${r.otherMint}), and a ticker is one coin here, so this $${ticker} was not sent.`, { code: "ticker-taken", mint: r.otherMint }) :fail(409, launchPendingSentence(ticker, r.otherMint, false), { code: LAUNCH_PENDING_CODE, mint: r.otherMint });
  return ok({ ok: true, recorded: { mint, sentAt: r.sentAt }, fresh: r.fresh, signature: v.signature });
}

/**
 * WIRING-MEDIA-RECOVERY item 235: the mint of a side A this creator already created on chain from an earlier pair plan (a draft with the
 * same ticker and name, whose creator's TokenConfig is on chain), or null. A host without a chain reader (p.market) cannot tell and
 * answers null. B-15 (sixth pass): a bare account at the mint is not proof (anyone can send it dust after registering an unsigned plan
 * in the creator's name); only the burn program's TokenConfig naming this creator counts (launchPending.ts createdOnChainBy).
 */
export async function createdSideA(p: Pick<Platform, "registry" | "market"> & { program?: { programId: string } | null }, a: { creator: string; ticker: string; name: string }): Promise<string | null> {
  if (!p.market) return null;
  let drafts: TokenRow[] = [];
  try { drafts = p.registry.tokens().filter((t) => t.creator === a.creator && t.status === "draft" && t.ticker.toUpperCase() === a.ticker.toUpperCase() && t.name === a.name); } catch { return null; }
  for (const t of drafts) { if ((await createdOnChainBy(p, t)) === true) return t.mint; }
  return null;
}
