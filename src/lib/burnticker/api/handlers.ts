import type { Platform } from "@/lib/burnticker/server";
import { catalogue, fixtureReadings, previewFromFixture, feedById, feedRuleProblems } from "@/lib/burnticker/catalogue";
import { ONCHAIN_FACTS, onchainSource } from "@/lib/burnticker/sources/onchain";
import { driftBetStub, hedgehogStub, polymarketStub, umaStub } from "@/lib/burnticker/sources/stubs";
import { TIER_LABEL } from "@/lib/burnticker/sources/types";
import type { HttpSourceConfig } from "@/lib/burnticker/sources/attestedHttp";
import { validateRule, lockRule, ruleStatement, BURNTICKER_RULES_SCHEMA, type LockedRule } from "@/lib/burnticker/rules";
import { summariseOpen } from "@/lib/burnticker/oracle/kalshi";
import { gameSides, legFilterCollisions, ownLegFilter, type EventHit } from "@/lib/burnticker/oracle/events";
import { backtest, backtestSentence } from "@/lib/burnticker/oracle/backtest";
import { loadRefuseList, nameRefusals, refusalsFor, type Refusal } from "@/lib/burnticker/oracle/refuse";
import { buildLaunchBundle, buildPairBundles, launchProblems, type LaunchBundle, type LaunchInput } from "@/lib/burnticker/launchBundle";
import type { PairRow, TokenRow } from "@/lib/burnticker/registry";
import { fail, ok, type ApiResult } from "@/lib/burnticker/api/http";

/**
 * THE BURNTICKER ROUTES' SHARED LOGIC (2026-10-09). The wizard's routes (/api/burnticker/{catalogue,oracle/*,launch}) and the public
 * v1 API call the same functions, so the two can never disagree about a refusal, a hash or a fee. Each returns an ApiResult
 * ({ status, body }); the routes only wrap it in a Response. Moved verbatim from the original route files.
 */

export const ADMISSION = {
  all: ["official or primary source", "machine-readable", "timestamped", "unambiguous units", "not controlled by anyone who can hold the token", "not a disaster", "not an election or vote (Kalshi election series are allowed by the owner's decision)", "never the token's own price"],
  byTier: { 1: "adjudicated market: settled results only; the venue's finalisation window respected", 2: "optimistic assertion: counts only once settled and undisputed", 3: "primary API attested by a TEE/zk job (same URL + selection as tier 4); third-party asset prices allowed from here up", 4: "primary API read by our keeper: no prices of any asset; one real fixture; plausibility bounds", 5: "page-scraped: owner's say-so per source; regex pinned to the markup; never a price" },
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
  const stubs = [polymarketStub(), umaStub(), driftBetStub(), hedgehogStub()].map((s) => ({ id: s.id, kind: s.kind, tier: s.tier, tierLabel: TIER_LABEL[s.tier], title: s.title, sourceName: s.sourceName, sourceUrl: s.sourceUrl, cadence: s.cadence, unit: null, direction: null, baseline: null, carry: s.carry, valueLabel: null, flags: s.flags, launchable: s.launchable, param: null, needsKey: null, fixtureFetchedAt: null, refusals: [], lastReading: null, readings: [], preview: null, ...(o.includeConfig ? { config: null } : {}) }));
  return { sources: [...http, ...onchain, ...stubs], tiers: TIER_LABEL, admission: ADMISSION };
}

/** Live Kalshi series search, or one series with its next open markets (`series`). */
export async function kalshiSearch(p: Platform, q: { q?: string | null; category?: string | null; series?: string | null }): Promise<ApiResult> {
  const series = q.series?.trim().toUpperCase();
  try {
    if (series) {
      // Kalshi answers 404 for an unknown series: that is "not found" here too, not an upstream failure.
      const info = await p.kalshi.seriesInfo(series).catch((e: Error) => { if (/HTTP 404/.test(e.message)) return null; throw e; });
      if (!info) return fail(404, `no Kalshi series ${series}`);
      const open = await p.kalshi.openMarkets(series).catch(() => []);
      const probe = validateRule({ schema: BURNTICKER_RULES_SCHEMA, oracle: "kalshi", series, market: null, filter: {}, kind: "binary", binary: { onYes: { fractionOfPool: 0.02 }, onNo: null }, scalar: null, onVoid: "skip", floorUsd: "1", reserveSol: "0.02", vault: null });
      const refusals = refusalsFor(loadRefuseList(), { titles: [info.title, ...open.slice(0, 20).map((m) => m.title)], categories: info.category ? [info.category] : [] });
      return ok({ series: info, open: summariseOpen(open, probe, 20), openCount: open.length, refusals, note: "prices are display only; the rule reads settled results" });
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
    return fail(502, `Kalshi unavailable: ${(e as Error).message.slice(0, 160)}`);
  }
}

/** One event hit for the API: the event, its markets (ticker + label, no prices), the two sides of a game with pre-filled names and both selector modes, the refuse-list verdict. */
export function eventHitJson(e: EventHit, list = loadRefuseList()) {
  const g = gameSides(e);
  const pair = g ? {
    a: g.a, b: g.b, tieMarket: g.tie?.ticker ?? null,
    thisGameOnly: { selector: { oracle: "kalshi", series: null, market: g.a.marketTicker }, sideA: `burns when ${g.a.marketTicker} settles NO (${g.a.label} does not win)`, sideB: `burns when ${g.a.marketTicker} settles YES (${g.a.label} wins)${g.tie ? "; a draw settles it NO, so a draw burns side A" : ""}`, partition: true },
    everyGame: { a: { series: e.seriesTicker, filter: { tickerIncludes: ownLegFilter(g.a.abbr) }, collisions: legFilterCollisions(g.a.abbr, e.seriesTicker) }, b: { series: e.seriesTicker, filter: { tickerIncludes: ownLegFilter(g.b.abbr) }, collisions: legFilterCollisions(g.b.abbr, e.seriesTicker) }, partition: false, note: "each side's selector is its own team's games: they partition only the games the two play each other; otherwise each is an independent record" },
  } : null;
  return { eventTicker: e.eventTicker, seriesTicker: e.seriesTicker, title: e.title, subTitle: e.subTitle, category: e.category, competition: e.competition, expectedAt: e.expectedAt, closeTime: e.closeTime,
    markets: e.markets.map((m) => ({ ticker: m.ticker, suffix: m.suffix, label: m.label, status: m.status, closeTime: m.closeTime })), score: e.score, matchedSides: e.matchedSides, matched: e.matched, pair,
    refused: refusalsFor(list, { titles: [e.title], categories: e.category ? [e.category] : [] }).map((r) => r.reason) };
}

/** Event-level search (teams, people, contests) — `q` matched against event title / ticker / market labels with the team-alias table; `series` scans one series; neither → the league chooser. */
export async function kalshiEvents(p: Platform, q: { q?: string | null; series?: string | null; status?: string | null }): Promise<ApiResult> {
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
    return fail(502, `Kalshi unavailable: ${(e as Error).message.slice(0, 160)}`);
  }
}

/** The team picker for one head-to-head game series (team coins): every team, its next game, its record so far this season. */
export async function kalshiTeams(p: Platform, q: { series?: string | null }): Promise<ApiResult> {
  const series = q.series?.trim().toUpperCase();
  if (!series) return fail(400, "series is required (a head-to-head game series, e.g. KXNFLGAME)");
  if (!/^[A-Z0-9]+GAME$/.test(series)) return fail(400, `${series} is not a head-to-head game series (…GAME)`);
  try {
    const t = await p.kalshi.teams(series);
    return ok({ ...t, note: "a team's record counts its own leg: settled YES = win, NO = loss, a YES on the event's TIE market = draw; voided games are not counted" });
  } catch (e) {
    return fail(502, `Kalshi unavailable: ${(e as Error).message.slice(0, 160)}`);
  }
}

/** The back-test of a rule from the venue's own settled history (catalogue rules: the source's frozen fixture). */
export async function runBacktest(p: Platform, body: { rule?: unknown; months?: unknown }, now = Date.now()): Promise<ApiResult> {
  let locked: LockedRule;
  try { locked = lockRule(body.rule); } catch (e) { return fail(400, (e as Error).message); }
  const months = Math.min(24, Math.max(1, Number(body.months ?? 12) || 12));
  try {
    if (locked.rule.oracle === "catalogue") {
      const feed = feedById(locked.rule.series!);
      if (!feed) return fail(400, `unknown feed ${locked.rule.series}`);
      const pv = previewFromFixture(feed, locked.rule, now);
      return ok({ rule: locked.rule, text: locked.text, sha256: locked.sha256, sha12: locked.sha12, mode: locked.mode, statement: ruleStatement(locked.rule, { feedTitle: feed.title }), backtest: pv, sentence: `${backtestSentence(pv)} (from the feed's frozen fixture, ${pv.window.from} → ${pv.window.to})`, refusals: [], seriesTitle: feed.title, matched: pv.rows.length });
    }
    if (locked.rule.oracle !== "kalshi") return fail(400, `oracle ${locked.rule.oracle} is not live (kalshi and catalogue are)`);
    const since = new Date(now); since.setUTCMonth(since.getUTCMonth() - months);
    const r = await p.kalshi.settledSince(locked.rule, since.toISOString(), { limitPages: 10 });
    const seriesTicker = locked.rule.series ?? locked.rule.market!.split("-")[0];
    const info = await p.kalshi.seriesInfo(seriesTicker).catch(() => null);
    const oneShotClose = locked.rule.market ? (await p.kalshi.openMarkets(seriesTicker).catch(() => [])).find((m) => m.ticker === locked.rule.market)?.closeTime ?? null : null;
    const bt = backtest(locked.rule, r.events, now, months, oneShotClose);
    const refusals = refusalsFor(loadRefuseList(), { titles: [info?.title ?? "", ...r.events.map((e) => e.title ?? "")], categories: info?.category ? [info.category] : [] });
    return ok({ rule: locked.rule, text: locked.text, sha256: locked.sha256, sha12: locked.sha12, mode: locked.mode, statement: ruleStatement(locked.rule, { seriesTitle: info?.title ?? null }), backtest: bt, sentence: backtestSentence(bt), refusals, seriesTitle: info?.title ?? null, settlementSourceUrl: r.settlementSourceUrl, awaitingFinal: r.awaitingFinal, oracleRefusals: r.refusals, matched: r.events.length });
  } catch (e) {
    return fail(502, `back-test unavailable: ${(e as Error).message.slice(0, 160)}`);
  }
}

export interface PreparedLaunch { bundle: LaunchBundle; token: TokenRow | null; seriesTitle: string | null; locked: LockedRule }
export interface PreparedPair { pairId: string; selector: string; notes: string[]; row: PairRow | null; bundles: { a: LaunchBundle; b: LaunchBundle }; tokens: { a: TokenRow | null; b: TokenRow | null }; seriesTitle: string | null }
interface PairSideInput { ticker?: unknown; name?: unknown; description?: unknown; imageUrl?: unknown; links?: unknown }

/**
 * Validation, refusals and the bundle — the launch route's whole pipeline. Refuses: invalid input, rules that do not lock, catalogue
 * rules that disagree with their feed, an unreadable Kalshi series, the refuse list (titles, categories, names), a taken ticker,
 * mainnet. `register` stores the DRAFT (and the keeper's attester row) as the wizard always has. `mint` = the caller's own mint public
 * key (the public API: the secret never travels); absent = a fresh keypair whose secret rides in the bundle (the wizard).
 *
 * RIVALRY PAIRS: a body with `pair: { ticker, name, … }` launches side B with the derived (inverted) rule alongside side A
 * (buildPairBundles); refusals and the tier rule apply per side, and both drafts plus the pair row are registered together. A rule that
 * carries a `pair` field must come through that flow.
 */
export async function prepareLaunch(p: Platform, body: Record<string, unknown>, o: { register: boolean; mint?: string | null }): Promise<{ error: ApiResult } | { ok: PreparedLaunch } | { pair: PreparedPair }> {
  const b = body as Partial<LaunchInput> & { acknowledgements?: { ruleLocked?: unknown; noReturns?: unknown }; pair?: PairSideInput | null };
  const input: LaunchInput = { creator: String(b.creator ?? ""), ticker: String(b.ticker ?? "").toUpperCase(), name: String(b.name ?? ""), description: String(b.description ?? ""), imageUrl: b.imageUrl ? String(b.imageUrl) : null, links: Array.isArray(b.links) ? b.links : [], rule: b.rule, firstBuySol: String(b.firstBuySol ?? "0"), acknowledgements: { ruleLocked: !!b.acknowledgements?.ruleLocked, noReturns: !!b.acknowledgements?.noReturns }, cluster: p.cluster };
  const problems = launchProblems(input);
  if (o.mint !== undefined && o.mint !== null && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(o.mint)) problems.push("mint must be the public key of a fresh mint keypair you generated");
  if (problems.length) return { error: fail(400, problems.join("; "), { problems }) };
  let locked: LockedRule;
  try { locked = lockRule(input.rule); } catch (e) { return { error: fail(400, (e as Error).message) }; }
  const list = loadRefuseList();
  const refusals: Refusal[] = nameRefusals(list, input.name, input.ticker);
  let seriesTitle: string | null = null;
  if (locked.rule.oracle === "catalogue") {
    const feed = feedById(locked.rule.series!);
    if (!feed) return { error: fail(400, `unknown feed ${locked.rule.series}`) };
    const fp = feedRuleProblems(feed, locked.rule);
    if (fp.length) return { error: fail(400, fp.join("; "), { problems: fp }) };
    seriesTitle = feed.title;
  } else if (locked.rule.oracle === "kalshi") {
    const info = await p.kalshi.seriesInfo(locked.rule.series ?? locked.rule.market!.split("-")[0]).catch(() => null);
    if (!info) return { error: fail(502, "the Kalshi series could not be read; try again") };
    seriesTitle = info.title;
    refusals.push(...refusalsFor(list, { titles: [info.title], categories: info.category ? [info.category] : [] }));
  } else return { error: fail(400, `oracle ${locked.rule.oracle} is not launchable (its adapter is a stub); kalshi and catalogue are live`) };
  if (refusals.length) return { error: fail(403, `refused: ${refusals.map((r) => r.reason).join("; ")}`, { code: "refused", refusals }) };
  if (p.registry.tickerTaken(input.ticker)) return { error: fail(409, `ticker ${input.ticker} is taken`, { code: "ticker-taken" }) };
  if (o.mint && p.registry.token(o.mint)) return { error: fail(409, `mint ${o.mint} is already registered`, { code: "mint-taken" }) };
  const deps = { program: p.program, launchLab: p.launchLab, devFeeWallet: p.devFeeWallet, attesters: p.keeperPubkey ? [p.keeperPubkey] : [], quorum: 1, metadataUri: (m: string) => `/api/burnticker/metadata/${m}`, keeperPubkey: p.keeperPubkey };
  const register = (bundle: LaunchBundle, ticker: string, imageUrl: string | null, links: { label: string; url: string }[]): TokenRow => {
    const token = p.registry.register({ mint: bundle.mint, ticker, name: bundle.name, creator: input.creator, description: bundle.description, imageUrl, links, rulesText: bundle.rules.text, feePda: bundle.addresses.feePda, vault: bundle.addresses.vault, tokenConfig: bundle.addresses.tokenConfig, poolId: bundle.addresses.poolId, launchTx: null, cluster: p.cluster, platformId: bundle.addresses.platformId, baselineAt: new Date().toISOString(), status: "draft" });
    if (p.keeperPubkey) p.registry.addAttester({ mint: token.mint, pubkey: p.keeperPubkey, role: "data-key", addedAt: Date.now(), timelockUntil: null });
    return token;
  };
  if (b.pair) {
    if (o.mint) return { error: fail(400, "a rivalry pair is launched through the wizard's pair flow (two fresh mints); the public API takes single coins") };
    const side = { ticker: String(b.pair.ticker ?? "").toUpperCase(), name: String(b.pair.name ?? ""), description: String(b.pair.description ?? ""), imageUrl: b.pair.imageUrl ? String(b.pair.imageUrl) : null, links: Array.isArray(b.pair.links) ? b.pair.links as { label: string; url: string }[] : [] };
    const bProblems = launchProblems({ ...input, ...side });
    if (bProblems.length) return { error: fail(400, `side B: ${bProblems.join("; ")}`, { problems: bProblems }) };
    const bRefusals = nameRefusals(list, side.name, side.ticker);
    if (bRefusals.length) return { error: fail(403, `side B refused: ${bRefusals.map((r) => r.reason).join("; ")}`, { code: "refused", refusals: bRefusals }) };
    if (p.registry.tickerTaken(side.ticker)) return { error: fail(409, `ticker ${side.ticker} is taken`, { code: "ticker-taken" }) };
    try {
      const pair = await buildPairBundles({ a: input, b: side }, deps);
      const tokenA = o.register ? register(pair.a, input.ticker, input.imageUrl, input.links) : null;
      const tokenB = o.register ? register(pair.b, side.ticker, side.imageUrl, side.links) : null;
      const row = tokenA && tokenB ? p.registry.registerPair(pair.pairId, tokenA.mint, tokenB.mint) : null;
      return { pair: { pairId: pair.pairId, selector: pair.selector, notes: pair.notes, row, bundles: { a: pair.a, b: pair.b }, tokens: { a: tokenA, b: tokenB }, seriesTitle } };
    } catch (e) {
      return { error: fail(400, (e as Error).message) };
    }
  }
  if (locked.rule.pair) return { error: fail(400, "a rule with a pair field is launched through the pair flow (send `pair: { ticker, name, … }` for side B)") };
  try {
    const bundle = await buildLaunchBundle(input, { ...deps, ...(o.mint ? { mint: o.mint } : {}) });
    const token = o.register ? register(bundle, input.ticker, input.imageUrl, input.links) : null;
    return { ok: { bundle, token, seriesTitle, locked } };
  } catch (e) {
    return { error: fail(400, (e as Error).message) };
  }
}

/** `launched`: the landed launch transaction takes the draft live; the baseline is now. */
export function markLaunched(p: Platform, mint: string, launchTx: string): ApiResult {
  const t = p.registry.token(mint);
  if (!t) return fail(404, "no such draft");
  if (!/^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(launchTx)) return fail(400, "launchTx must be a transaction signature");
  try { p.registry.markLaunched(mint, launchTx, t.poolId, new Date().toISOString()); } catch (e) { return fail(409, (e as Error).message); }
  return ok({ ok: true, token: p.registry.token(mint), note: "the keeper verifies the launch transaction on its next cycle; the baseline is now — settlements after this moment count" });
}
