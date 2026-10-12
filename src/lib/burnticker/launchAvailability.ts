import type { BurnRule } from "@/lib/burnticker/rules";
import { CREATOR_LAUNCHES_CLOSED, CREATOR_LAUNCHES_CODE, CREATOR_LAUNCHES_FLAG } from "@/lib/burnticker/creatorLaunches";

/**
 * WHAT A CREATOR CAN LAUNCH ON THIS HOST, DERIVED, NOT WRITTEN (ChatGPT launch audit 5, L02 / audit #4, 2026-10-11: the status said
 * creator launches were closed while the host had them open, and sports, matchup and Derby paths reached a wallet prompt although sports
 * settlement and mainnet pairs were unavailable). One model, three levels:
 *
 *   global       closed   BURNTICKER_CREATOR_LAUNCHES_ENABLED off and no preview: the launch page shows the closed page
 *                preview  BURNTICKER_CREATOR_LAUNCHES_PREVIEW on (ENABLED off): the wizard and the review card render in full under a
 *                         persistent banner; nothing builds or sends a transaction (bundle / confirm answer 403 launches-closed,
 *                         preview: true); the read-only review payload works
 *                open     BURNTICKER_CREATOR_LAUNCHES_ENABLED on (it wins over PREVIEW)
 *   per type     team / matchup (sports), markets, elections, public data, weather, Coin vs Coin, registered pairs — each available or
 *                not, with the plain reason, shown on the first screen before any form is filled
 *   per source   sports settlement needs TheSportsDB's licence key on a mainnet host (devnet hosts are test networks); registered
 *                pairs on a mainnet host need BURNTICKER_PAIR_CURVE_ENABLED (current-status: "pair launches stay off on mainnet")
 *
 * The server enforces the same model: every creator launch route refuses a closed / preview host (globalRefusal) and an unavailable
 * type (typeRefusal) with a plain sentence and a code. Pure and client-safe; the catalogue carries the model to the browser.
 */
export const CREATOR_LAUNCHES_PREVIEW_FLAG = "BURNTICKER_CREATOR_LAUNCHES_PREVIEW";
export type LaunchMode = "closed" | "preview" | "open";
export type LaunchType = "team" | "matchup" | "markets" | "elections" | "feeds" | "weather" | "derby" | "pairs";
export interface TypeAvailability { type: LaunchType; label: string; available: boolean; reason: string | null }
export interface SourceAvailability { id: "sports-settlement" | "sports-schedule" | "polymarket" | "nws" | "feeds" | "pair-curve"; label: string; available: boolean; reason: string | null }
export interface LaunchAvailabilityModel {
  mode: LaunchMode;
  /** True only in `open` mode: the one flag that lets a bundle be built. */
  transactions: boolean;
  cluster: string | null;
  /** The persistent banner in preview mode; the closed sentence in closed mode; null when open. */
  banner: string | null;
  types: Record<LaunchType, TypeAvailability>;
  sources: SourceAvailability[];
}

type Env = Readonly<Record<string, string | undefined>>;
const on = (v: string | undefined) => /^(1|true|yes|on)$/i.test((v ?? "").trim());

/** The preview banner, word for word (lint-clean: a fact, no date, no "soon"). */
export const PREVIEW_BANNER = "This is a preview. Creator launches are closed, so nothing here builds or sends a transaction.";
export const LAUNCHES_CLOSED_CODE = "launches-closed";
export const TYPE_UNAVAILABLE_CODE = "launch-type-unavailable";

export function launchModeFromEnv(env: Env = process.env): LaunchMode {
  if (on(env[CREATOR_LAUNCHES_FLAG])) return "open";
  return on(env[CREATOR_LAUNCHES_PREVIEW_FLAG]) ? "preview" : "closed";
}

const LABEL: Record<LaunchType, string> = { team: "Team coin", matchup: "Matchup", markets: "Prediction market", elections: "Election", feeds: "Public number", weather: "Weather", derby: "Coin vs Coin", pairs: "Paired coin" };

/** The model from the host's environment (the catalogue, the routes and server pages). */
export function availabilityFromEnv(env: Env = process.env, cluster: string | null = null): LaunchAvailabilityModel {
  const mode = launchModeFromEnv(env);
  const mainnet = cluster === "mainnet";
  const tsdb = !!(env.BURNTICKER_THESPORTSDB_KEY ?? "").trim();
  const pairCurve = on(env.BURNTICKER_PAIR_CURVE_ENABLED);
  const polymarket = !/^(0|false|no|off)$/i.test((env.BURNTICKER_POLYMARKET_DISCOVERY_ENABLED ?? "").trim());
  const sportsOk = tsdb || !mainnet;
  const pairsOk = pairCurve || !mainnet;
  const sportsWhy = sportsOk ? null : "Games without an on-chain market settle on TheSportsDB's scores, and that licence is not linked on this site yet.";
  const pairsWhy = pairsOk ? null : "Paired coins are off on mainnet because this site has not turned on the pair curve.";
  const polyWhy = polymarket ? null : "Polymarket search is turned off on this site.";
  const t = (type: LaunchType, ok: boolean, why: string | null): TypeAvailability => ({ type, label: LABEL[type], available: ok, reason: ok ? null : why });
  const types: Record<LaunchType, TypeAvailability> = {
    team: t("team", sportsOk, sportsWhy), matchup: t("matchup", sportsOk, sportsWhy),
    markets: t("markets", polymarket, polyWhy), elections: t("elections", polymarket, polyWhy),
    feeds: t("feeds", true, null), weather: t("weather", true, null),
    derby: t("derby", pairsOk, pairsWhy), pairs: t("pairs", pairsOk, pairsWhy),
  };
  const sources: SourceAvailability[] = [
    { id: "sports-settlement", label: "Sports settlement, from the on-chain payout or else TheSportsDB's licensed final score", available: sportsOk, reason: sportsWhy },
    { id: "sports-schedule", label: "Sports schedules, from the league feeds and TheSportsDB for the rest", available: true, reason: tsdb ? null : "leagues without a free official schedule list their teams without next games" },
    { id: "polymarket", label: "Polymarket discovery", available: polymarket, reason: polyWhy },
    { id: "nws", label: "National Weather Service daily climate reports", available: true, reason: null },
    { id: "feeds", label: "Public data publishers (Treasury, BLS, FRED, …)", available: true, reason: null },
    { id: "pair-curve", label: "Pair curve (registered pairs on mainnet)", available: pairCurve, reason: pairCurve ? null : "the pair curve is turned off on this site" },
  ];
  return { mode, transactions: mode === "open", cluster, banner: mode === "preview" ? PREVIEW_BANNER : mode === "closed" ? CREATOR_LAUNCHES_CLOSED : null, types, sources };
}

/** The client's read of the catalogue's `launches` block; anything unreadable is CLOSED (fail closed). */
export function availabilityFromCatalogue(j: unknown): LaunchAvailabilityModel {
  const c = (j ?? {}) as { launches?: { creators?: unknown; mode?: unknown; types?: unknown; sources?: unknown; banner?: unknown }; cluster?: unknown };
  const cluster = typeof c.cluster === "string" ? c.cluster : null;
  const l = c.launches ?? {};
  const mode: LaunchMode = l.creators === true ? "open" : l.mode === "preview" ? "preview" : "closed";
  const base = availabilityFromEnv({}, cluster);
  const types = { ...base.types } as Record<LaunchType, TypeAvailability>;
  if (l.types && typeof l.types === "object") for (const k of Object.keys(types) as LaunchType[]) { const v = (l.types as Record<string, TypeAvailability | undefined>)[k]; if (v && typeof v.available === "boolean") types[k] = { type: k, label: typeof v.label === "string" ? v.label : LABEL[k], available: v.available, reason: typeof v.reason === "string" ? v.reason : null }; }
  return { mode, transactions: mode === "open", cluster, banner: mode === "preview" ? PREVIEW_BANNER : mode === "closed" ? CREATOR_LAUNCHES_CLOSED : null, types, sources: Array.isArray(l.sources) ? l.sources as SourceAvailability[] : base.sources };
}

/** The launch type a rule (and an optional side-B pair body) belongs to. */
export function launchTypeOf(rule: Pick<BurnRule, "oracle" | "series" | "market"> | null | undefined, o: { pair?: boolean } = {}): LaunchType | null {
  if (!rule) return null;
  if (rule.oracle === "derby") return "derby";
  if (o.pair) return "pairs";
  if (rule.oracle === "catalogue") {
    const s = rule.series ?? "";
    if (s.startsWith("espn.game:")) return "matchup";
    if (s.startsWith("espn.")) return "team";
    if (s.startsWith("nws.")) return "weather";
    return "feeds";
  }
  if (rule.oracle === "polymarket" || rule.oracle === "kalshi") return "markets";
  return null;
}

/** 403 for a closed or preview host (preview: true marks the preview); null when open. */
export function globalRefusal(env: Env = process.env): { status: 403; body: { error: string; code: string; preview: boolean } } | null {
  const mode = launchModeFromEnv(env);
  if (mode === "open") return null;
  return mode === "preview"
    ? { status: 403, body: { error: `${PREVIEW_BANNER} You can still read the review with POST /v1/launch/review. Building and confirming launches is refused.`, code: LAUNCHES_CLOSED_CODE, preview: true } }
    : { status: 403, body: { error: CREATOR_LAUNCHES_CLOSED, code: CREATOR_LAUNCHES_CODE, preview: false } };
}

/** 403 for a launch type this host cannot take (read from the request body: its rule and whether it carries a side-B pair). */
export function typeRefusal(body: unknown, env: Env = process.env, cluster: string | null = null): { status: 403; body: { error: string; code: string; type: LaunchType } } | null {
  const b = (body ?? {}) as { rule?: unknown; pair?: unknown };
  const rule = b.rule && typeof b.rule === "object" ? b.rule as BurnRule : null;
  const type = launchTypeOf(rule, { pair: !!b.pair });
  if (!type) return null;
  const a = availabilityFromEnv(env, cluster).types[type];
  return a.available ? null : { status: 403, body: { error: `${a.label} launches are not available on this site. ${a.reason}`, code: TYPE_UNAVAILABLE_CODE, type } };
}

/** The host's cluster as the catalogue names it (the same reading of BURNTICKER_CLUSTER as the catalogue route). */
export const hostCluster = (env: Env = process.env): "mainnet" | "devnet" | "localnet" => { const c = (env.BURNTICKER_CLUSTER ?? "").trim(); return c === "mainnet" ? "mainnet" : c === "localnet" ? "localnet" : "devnet"; };

/**
 * The catalogue's `launches` block (the app's /api/burnticker/catalogue and /v1/catalogue): `creators` (true only when open — older
 * readers keep working), `note`, and since API 1.14.0 `mode`, `banner`, `types` and `sources`.
 */
export function catalogueLaunches(env: Env = process.env): { creators: boolean; note: string; mode: LaunchMode; banner: string | null; types: Record<LaunchType, TypeAvailability>; sources: SourceAvailability[] } {
  const m = availabilityFromEnv(env, hostCluster(env));
  return { creators: m.mode === "open", note: m.mode === "open" ? "creator launches are open on this site" : m.mode === "preview" ? PREVIEW_BANNER : CREATOR_LAUNCHES_CLOSED, mode: m.mode, banner: m.banner, types: m.types, sources: m.sources };
}
