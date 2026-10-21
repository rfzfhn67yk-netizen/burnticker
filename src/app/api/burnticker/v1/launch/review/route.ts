// Public API v1 (1.14.0): the read-only pre-wallet review (src/lib/burnticker/launchReview.ts; launch audit 5 L02 / L06).
import { fail, ok, readJsonLimited, runV1, type ApiResult } from "@/lib/burnticker/api/http";
import { reviewSlowLine, stageClock, type StageClock } from "@/lib/burnticker/buildStages";
import { withLaunchFailureAlert } from "@/lib/burnticker/api/launchFailAlert";
import { buildLaunchReview } from "@/lib/burnticker/launchReview";
import { oneShotVoidBy } from "@/lib/burnticker/api/handlers";
import { settledPairInput } from "@/lib/burnticker/launchPreflight";
import type { BurnRule, LockedRule } from "@/lib/burnticker/rules";
import { statedCtx } from "@/lib/burnticker/coinText";
import { existingCoinsFor } from "@/lib/burnticker/duplicateRuleMatch";
import { reviewTickerChecks, type TickerCheck } from "@/lib/burnticker/tickerCheck";
import { loadReserved } from "@/lib/burnticker/reservedNames";
import { platform } from "@/lib/burnticker/server";
import { liveSinks, type SinkCoin } from "@/lib/burnticker/endSinks";
import { lookalikeRows } from "@/lib/burnticker/launchGuards";
import { provenReviewCreator } from "@/lib/burnticker/walletProofCheck";
import { publicOrigin } from "@/lib/burnticker/coinArt";
import { seasonNotStartedLine, seasonOverFor } from "@/lib/burnticker/seasonOver";
import { espnClient, nativeSourceById } from "@/lib/burnticker/sources/native";
import { lastSeasonBacktest } from "@/lib/burnticker/lastSeason";
import { parseEspnSeries } from "@/lib/burnticker/sources/espn";
import { meetingsVerdictFor } from "@/lib/burnticker/meetingsLeft";
import { globalRefusal, hostCluster, launchModeFromEnv } from "@/lib/burnticker/launchAvailability";
import { cachedTimeLockSecs, currentStatusLive } from "@/lib/burnticker/currentStatus";
import { derbyStore } from "@/lib/burnticker/derby/store";

export const dynamic = "force-dynamic";

/** Audit 7 item 7: the game a one-game rule names, from the league's schedule (at most 3 seconds; null when not listed or not read). */
async function gameFor(rule: unknown): Promise<{ eventId: string; startsAt: string; name: string; detail: string } | null> {
  const r = rule && typeof rule === "object" ? (rule as { oracle?: unknown; series?: unknown }) : null;
  const e = r && r.oracle === "catalogue" && typeof r.series === "string" ? parseEspnSeries(r.series) : null;
  if (!e || e.kind !== "game") return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const games = await Promise.race([espnClient().upcoming(e.league, 30).catch(() => null), new Promise<null>((res) => { timer = setTimeout(() => res(null), 3_000); })]);
  clearTimeout(timer);
  const g = games?.find((x) => x.eventId === e.eventId) ?? null;
  return g ? { eventId: g.eventId, startsAt: g.startsAt, name: g.name, detail: g.detail } : null;
}

/**
 * HB-72 (hourly run 5) and its consistency fix (hourly run 7): a rivalry series rule (window `meetings`) with no meeting left carries the
 * playoff warning while a playoff meeting is still possible, and is refused (a problem) when none is: the one rule the rivalry picker and
 * the prepare use (meetingsLeft.ts; at most 3 seconds per read; nothing said when not read).
 */
async function meetingsVerdictOf(rule: unknown): Promise<{ note: string | null; refusal: string | null }> {
  const v = await meetingsVerdictFor(rule, { season: (league, abbr, year) => espnClient().season(league, abbr, year), schedule: platform().seasonSchedule });
  return { note: v?.state === "playoffs" ? v.warning : null, refusal: v?.state === "none" ? v.line : null };
}

/**
 * Owner 2026-10-14: a team or game rule's next-game note (native.ts preflight `note`: Polymarket has not listed the next game yet, so it
 * would settle on TheSportsDB alone after a 12-hour hold). At most 4 seconds; null when not a sports rule, not read, or nothing to say.
 */
async function sportsNoteFor(rule: unknown): Promise<string | null> {
  const r = rule && typeof rule === "object" ? (rule as { oracle?: unknown; series?: unknown }) : null;
  if (!r || r.oracle !== "catalogue" || typeof r.series !== "string" || !parseEspnSeries(r.series)) return null;
  const src = nativeSourceById(r.series);
  if (!src) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const p = await Promise.race([src.preflight(Date.now()).catch(() => null), new Promise<null>((res) => { timer = setTimeout(() => res(null), 4_000); })]);
  clearTimeout(timer);
  return p && !p.problem ? p.note ?? null : null;
}

/** Builds nothing, pins nothing, registers nothing, reads no chain (one Gamma read for a one-market Polymarket rule): works in preview and open modes; a closed host refuses. */
export async function POST(req: Request) {
  return runV1("reviewLaunch", req, withLaunchFailureAlert(platform().registry, "reviewLaunch", req, async () => {
    // HB-145: every stage is timed; a review slower than REVIEW_SLOW_MS writes one line naming its stages (buildStages.ts reviewSlowLine)
    const clock = stageClock(), t0 = Date.now(), seen: { rule?: unknown } = {};
    try { return await review(req, clock, seen); }
    finally { const line = reviewSlowLine(clock, Date.now() - t0, seen.rule); if (line) console.info(line); }
  }));
}

async function review(req: Request, clock: StageClock, seen: { rule?: unknown }): Promise<ApiResult> {
  {
    if (launchModeFromEnv(process.env) === "closed") { const r = globalRefusal(process.env)!; return fail(r.status, r.body.error, { code: r.body.code, preview: false }); }
    // HB-172 (LA7-3): the review carries no image, so its body is read up to SMALL_JSON_BODY (256 KB); larger answers 413
    const read = await clock.run("body", () => readJsonLimited(req));
    if ("tooLarge" in read) return read.tooLarge;
    const body = read.body;
    if (!body) return fail(400, "invalid JSON body");
    seen.rule = (body as { rule?: unknown }).rule;
    // review of block M: the creator's own drafts count as theirs only when the request carries that wallet's signed request over these
    // tickers; a claimed wallet alone is dropped, so asking with someone else's wallet never reveals who owns a draft
    clock.run("proof", () => { const proven = provenReviewCreator(body, [publicOrigin()]); if (proven) (body as Record<string, unknown>).creator = proven; else delete (body as Record<string, unknown>).creator; });
    // A9: the time lock beside the review is the one last read from chain (the trust page's cache); a production host refreshes it in
    // the background so the next review has it. Never awaited here: the review reads no chain.
    const cluster = hostCluster(process.env) === "mainnet" ? "mainnet" : "devnet";
    if (process.env.NODE_ENV === "production" && cachedTimeLockSecs(cluster) === null) void currentStatusLive().catch(() => null);
    // legitimacy pass fix b: a one-market Polymarket rule's stated source and dispute window come from this server's own read of the
    // market (the same read the launch route makes), never from the request; no read within 4 seconds leaves the older wording
    const rule = (body as { rule?: { oracle?: unknown; market?: unknown } }).rule;
    let stated: ReturnType<typeof statedCtx> = null;
    if (rule && rule.oracle === "polymarket" && typeof rule.market === "string" && rule.market) {
      const read = platform().polymarket.seriesInfo(rule.market).catch(() => null);
      let timer: ReturnType<typeof setTimeout> | undefined;
      stated = statedCtx(await clock.run("market", () => Promise.race([read, new Promise<null>((res) => { timer = setTimeout(() => res(null), 4_000); })])));
      clearTimeout(timer);
    }
    // audit 6 items 8 and 2: the platform's Kalshi flag and its registered coins (the lookalike refusal the bundle makes); a season rule
    // for a team with no games left carries the season-over warning (one schedule read, at most 3 seconds, never required)
    let existingRows: ReturnType<typeof lookalikeRows> | null = null;
    try { existingRows = clock.run("registry", () => lookalikeRows(platform().registry)); } catch { existingRows = null; }
    // sources-7 H6: a season rule on a team whose season is over is refused (seasonOver.ts), from the platform's schedule port
    const seasonOver = await clock.run("season", () => seasonOverFor((body as { rule?: unknown }).rule, platform().seasonSchedule));
    const game = await clock.run("game", () => gameFor((body as { rule?: unknown }).rule));
    const sourceNote = await clock.run("note", () => sportsNoteFor((body as { rule?: unknown }).rule));
    const { note: meetingsNote, refusal: meetingsRefusal } = await clock.run("meetings", () => meetingsVerdictOf((body as { rule?: unknown }).rule));
    // audit 12 item 2: a one-market pair's void date is the market's own end date, read as the bundle route reads it (handlers.ts
    // oneShotVoidBy, at most 4 seconds), so the review's side A rule is the exact one; no read leaves it labelled a draft
    let pairVoidBy: string | null = null;
    const pairSide = (body as { pair?: unknown }).pair;
    if (pairSide && typeof pairSide === "object" && !settledPairInput(pairSide) && rule && (rule.oracle === "polymarket" || rule.oracle === "kalshi") && typeof rule.market === "string" && rule.market) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      pairVoidBy = await clock.run("voidBy", () => Promise.race([oneShotVoidBy(platform(), { rule } as unknown as LockedRule), new Promise<null>((res) => { timer = setTimeout(() => res(null), 4_000); })]));
      clearTimeout(timer);
    }
    // cheap-features item 5: a team rule counted over the team's previous season (one schedule read, at most 3 seconds, never required)
    const lastSeason = await clock.run("lastSeason", () => lastSeasonBacktest((body as { rule?: unknown }).rule, platform().teamSeason));
    // the end-sink picker: the live coins on this network a rule may name to take the rest (endSinks.ts); unreadable = none
    let sinks: SinkCoin[] = [];
    try { const p = platform(); sinks = clock.run("sinks", () => liveSinks(p.registry, p.cluster)); } catch { sinks = []; }
    // HS-48 (hourly run 9): whether a coin comparison's coins have any stored daily reading (unreadable = not said either way)
    let derbyHistory: ((feed: string) => boolean) | undefined;
    try { const ds = derbyStore(platform().registry.db); derbyHistory = (feed) => ds.hasPoints(feed); } catch { derbyHistory = undefined; }
    // HB-41 widened (hourly run 14): the keeper's newest stored reading of the rule's feed, so the back-test says when the catalogue sample is behind
    const storedReading = (k: string) => { const x = platform().registry.lastReading(k); return x ? { at: x.at, fetchedAt: x.fetchedAt } : null; };
    const build = () => buildLaunchReview(body, { timeLockSecs: cachedTimeLockSecs(cluster), stated, pairVoidBy, pairIdPick: (base) => platform().registry.freePairId(base), kalshiEnabled: platform().kalshiEnabled !== false, existing: existingRows, seasonOver, seasonWarning: seasonNotStartedLine((body as { rule?: unknown }).rule), game, sinks, lastSeason, derbyHistory, storedReading, sourceNote, meetingsNote, meetingsRefusal });
    const r = clock.run("build", build);
    if ("problems" in r) return fail(400, r.problems.join("; "), { problems: r.problems });
    // website-14 (product idea 6): the registered coins that share this rule's canonical selector, for "View existing coins"
    let existing: ReturnType<typeof existingCoinsFor> = [];
    try { existing = clock.run("existing", () => existingCoinsFor((body as { rule?: unknown }).rule, platform().registry.tokens())); } catch { existing = []; }
    // prelaunch audit 2026-10-18 A-2 / A-40: a ticker another creator's coin holds is refused (the ticker field carries the sentence, from
    // identityRefusals above) with two free tickers that pass the launch's own check; only launched coins are described, never a draft.
    // A registry that cannot be read leaves the list empty.
    let tickers: TickerCheck[] = [], coins = r.review.coins;
    try {
      const reg = platform().registry, reserved = loadReserved();
      const creator = typeof (body as { creator?: unknown }).creator === "string" ? String((body as { creator: string }).creator) : null;
      const ruleA = (body as { rule?: unknown }).rule as Pick<BurnRule, "oracle" | "series"> | null | undefined;
      // HB-117: the suggested ticker is never one another coin holds (or one like it); a hazard coin is offered its own word first
      clock.run("tickers", () => { ({ tickers, coins } = reviewTickerChecks(r.review.coins, ruleA, { inUse: (t) => reg.tokensByTicker(t).map((x) => ({ mint: x.mint, name: x.name, ticker: x.ticker, rulesJson: x.rulesJson, status: x.status, creator: x.creator })), reserved, existing: existingRows, creator })); });
    } catch { tickers = []; coins = r.review.coins; }
    return ok({ ...r.review, coins, existing, tickers });
  }
}
