// Public API v1 (1.14.0): the read-only pre-wallet review (src/lib/burnticker/launchReview.ts; launch audit 5 L02 / L06).
import { fail, ok, readJson, runV1 } from "@/lib/burnticker/api/http";
import { buildLaunchReview } from "@/lib/burnticker/launchReview";
import { statedCtx } from "@/lib/burnticker/coinText";
import { existingCoinsFor } from "@/lib/burnticker/duplicateRuleMatch";
import { tickerChecks, type TickerCheck } from "@/lib/burnticker/tickerCheck";
import { loadReserved } from "@/lib/burnticker/reservedNames";
import { platform } from "@/lib/burnticker/server";
import { lookalikeRows } from "@/lib/burnticker/launchGuards";
import { SEASON_OVER_LINE, seasonStatus } from "@/lib/burnticker/api/handlers";
import { espnClient } from "@/lib/burnticker/sources/native";
import { parseEspnSeries } from "@/lib/burnticker/sources/espn";
import { globalRefusal, hostCluster, launchModeFromEnv } from "@/lib/burnticker/launchAvailability";
import { cachedTimeLockSecs, currentStatusLive } from "@/lib/burnticker/currentStatus";

export const dynamic = "force-dynamic";

/** The season-over warning for a season rule on an ESPN team (handlers.ts seasonStatus), or null (any other rule, or no read in time). */
async function seasonWarningFor(rule: unknown): Promise<string | null> {
  const series = rule && typeof rule === "object" ? (rule as { oracle?: unknown; series?: unknown }) : null;
  const e = series && series.oracle === "catalogue" && typeof series.series === "string" ? parseEspnSeries(series.series) : null;
  if (!e || e.kind !== "team" || (e.window.kind !== "season" && e.window.kind !== "post")) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const games = await Promise.race([espnClient().upcoming(e.league, 8).catch(() => null), new Promise<null>((res) => { timer = setTimeout(() => res(null), 3_000); })]);
  clearTimeout(timer);
  return games ? seasonStatus(e.abbr, games, true).status === "over" ? SEASON_OVER_LINE : null : null;
}

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

/** Builds nothing, pins nothing, registers nothing, reads no chain (one Gamma read for a one-market Polymarket rule): works in preview and open modes; a closed host refuses. */
export async function POST(req: Request) {
  return runV1("reviewLaunch", req, async () => {
    if (launchModeFromEnv(process.env) === "closed") { const r = globalRefusal(process.env)!; return fail(r.status, r.body.error, { code: r.body.code, preview: false }); }
    const body = await readJson(req);
    if (!body) return fail(400, "invalid JSON body");
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
      stated = statedCtx(await Promise.race([read, new Promise<null>((res) => { timer = setTimeout(() => res(null), 4_000); })]));
      clearTimeout(timer);
    }
    // audit 6 items 8 and 2: the platform's Kalshi flag and its registered coins (the lookalike refusal the bundle makes); a season rule
    // for a team with no games left carries the season-over warning (one schedule read, at most 3 seconds, never required)
    let existingRows: ReturnType<typeof lookalikeRows> | null = null;
    try { existingRows = lookalikeRows(platform().registry); } catch { existingRows = null; }
    const seasonWarning = await seasonWarningFor((body as { rule?: unknown }).rule);
    const game = await gameFor((body as { rule?: unknown }).rule);
    const r = buildLaunchReview(body, { timeLockSecs: cachedTimeLockSecs(cluster), stated, kalshiEnabled: platform().kalshiEnabled !== false, existing: existingRows, seasonWarning, game });
    if ("problems" in r) return fail(400, r.problems.join("; "), { problems: r.problems });
    // website-14 (product idea 6): the registered coins that share this rule's canonical selector, for "View existing coins"
    let existing: ReturnType<typeof existingCoinsFor> = [];
    try { existing = existingCoinsFor((body as { rule?: unknown }).rule, platform().registry.tokens()); } catch { existing = []; }
    // website-19 (owner, 2026-10-12: tickers are not enforced unique): the coins already holding each side's ticker, as a warning with two
    // free suggestions; the creator may keep the ticker. A registry that cannot be read leaves the list empty.
    let tickers: TickerCheck[] = [];
    try {
      const reg = platform().registry, reserved = loadReserved();
      tickers = tickerChecks(r.review.coins.map((c) => ({ side: c.side, ticker: c.ticker })), { inUse: (t) => reg.tokensByTicker(t).map((x) => ({ mint: x.mint, name: x.name, ticker: x.ticker, rulesJson: x.rulesJson })), reserved });
    } catch { tickers = []; }
    return ok({ ...r.review, existing, tickers });
  });
}
