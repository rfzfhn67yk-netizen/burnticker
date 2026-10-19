import type { ReadWindow } from "@/lib/burnticker/readPlan";
import fs from "node:fs";
import path from "node:path";
import type { BurnRule } from "@/lib/burnticker/rules";
import type { SettledEvent } from "@/lib/burnticker/units";
import type { FetchLike, ImpliedChance, OracleAdapter, ResolvedSelector, SeriesSummary } from "@/lib/burnticker/oracle/types";
import { backtest, type Backtest } from "@/lib/burnticker/oracle/backtest";
import { expandUrl, fetchBody, httpSource, parseBody, type HttpSourceConfig } from "@/lib/burnticker/sources/attestedHttp";
import { corroborate } from "@/lib/burnticker/catalogue/corroborate";
import type { PriceFeedSourceConfig, ResolutionSource } from "@/lib/burnticker/sources/types";
import { copycatSource, type CopycatSourceConfig, type CopycatSourceOptions } from "@/lib/burnticker/sources/copycats";
import { nativeRuleProblems, nativeSourceById } from "@/lib/burnticker/sources/native";
import { applyLl2Launch, applyLl2Provider } from "@/lib/burnticker/sources/launchLibrary";
import { applyUsgsQuakeNext, applyUsgsQuakes } from "@/lib/burnticker/sources/usgs";
import { applyNhc } from "@/lib/burnticker/sources/nhc";
import { applySpc } from "@/lib/burnticker/sources/spc";
import { applyNifcFireSize } from "@/lib/burnticker/sources/nifc";
import { applyVolcanoWarning } from "@/lib/burnticker/sources/volcano";
import { applyGithubMilestone, applyGithubReleases } from "@/lib/burnticker/sources/github";
import { applyYoutubeMilestone } from "@/lib/burnticker/sources/youtube";

/**
 * THE FIRST-PARTY CATALOGUE (tier 3–5) — config/burnticker/sources.json read through the generic attested-http adapter (2026-10-09:
 * "adding a source is config, not code"). A `Feed` here is the config entry plus the parser; the hand-written feed classes are gone.
 * Parameterised sources take their parameter after a colon: wiki.views:<Article>, github.stars:<owner>/<repo>, steam.players:<appid>,
 * defillama.tvl:<slug>, edgar.8k:<CIK>; the parameter is substituted into the URL and is part of the locked rule (series id).
 */

export const SOURCES_FILE = path.join("config", "burnticker", "sources.json");

export interface Feed extends ResolutionSource { config: HttpSourceConfig; parse(body: unknown, nowMs: number): { readings: SettledEvent[]; refusals: string[] }; pollEverySec: number; /** when the publisher's new period can appear (readPlan.ts); null: the poll alone */ readWindow: ReadWindow | null; fixturePath: string | null; memoSource: string; param: string | null }

let cachedConfig: { entries: SourceEntry[] } | null = null;
/**
 * A NATIVE source's descriptor in sources.json (2026-10-10): the first-party sources with their own code (sources/native.ts — the ESPN
 * scoreboard, the NWS climate report, FEC reports) and their cross-reads. No request template: the entry carries what the settlement-
 * coverage audit needs (operator, domain via sourceUrl, fact, launchable, readable). The catalogue's feed list skips them.
 */
export interface NativeSourceConfig { id: string; kind: "native"; tier: 4; title: string; sourceName: string; operator: string; sourceUrl: string; fact: { id: string }; launchable: boolean; readable: boolean; flags: string[]; leagues?: string[]; sameOperator?: boolean; note?: string }
/** Any entry of sources.json: the attested-http feeds (HttpSourceConfig), the other kinds (onchain.copycats, CopycatSourceConfig), the native descriptors and Burn Derby's price feeds (PriceFeedSourceConfig). */
export type SourceEntry = HttpSourceConfig | CopycatSourceConfig | NativeSourceConfig | PriceFeedSourceConfig;
/** Every entry of sources.json, whatever its kind. */
export function loadSourceEntries(root = process.cwd()): SourceEntry[] {
  if (cachedConfig && root === process.cwd()) return cachedConfig.entries;
  const j = JSON.parse(fs.readFileSync(path.join(root, SOURCES_FILE), "utf8")) as { schema?: string; sources?: SourceEntry[] };
  if (j.schema !== "burnticker.sources/v1" || !Array.isArray(j.sources)) throw new Error("sources.json: not a burnticker.sources/v1 file");
  if (root === process.cwd()) cachedConfig = { entries: j.sources };
  return j.sources;
}
/** The attested-http feeds only (the generic adapter's input; the wizard's tier-2 cards). */
export function loadSourcesConfig(root = process.cwd()): HttpSourceConfig[] {
  return loadSourceEntries(root).filter((e): e is HttpSourceConfig => e.kind === "attested-http");
}
/** The copycat-count source (kind onchain, indexer-dependent), built from its config entry; null when sources.json has none. */
export function copycatSourceFromConfig(o: CopycatSourceOptions = {}, root = process.cwd()): ReturnType<typeof copycatSource> | null {
  const cfg = loadSourceEntries(root).find((e): e is CopycatSourceConfig => e.kind === "onchain" && (e as CopycatSourceConfig).id === "onchain.copycats");
  return cfg ? copycatSource(cfg, o) : null;
}

/**
 * Parameter placeholders a source's URL may carry, keyed by the series-id syntax ("github.stars:<owner>/<repo>"). A source with its own
 * parameter rules (sources-2: Launch Library providers and launches, USGS magnitude and region, GitHub releases and milestones, YouTube
 * milestones) names an `apply` hook in its module that validates the parameter and returns the whole configured entry.
 */
const PARAMS: Record<string, { placeholders: string[]; split?: string; re: RegExp; apply?: (cfg: HttpSourceConfig, param: string) => HttpSourceConfig }> = {
  "wiki.views": { placeholders: ["{article}"], re: /^[A-Za-z0-9_.-]{1,48}$/ },
  "github.stars": { placeholders: ["{owner}", "{repo}"], split: "/", re: /^[A-Za-z0-9_.-]{1,39}\/[A-Za-z0-9_.-]{1,100}$/ },
  "steam.players": { placeholders: ["{appid}"], re: /^\d{1,10}$/ },
  "defillama.tvl": { placeholders: ["{protocol}"], re: /^[a-z0-9-]{1,48}$/ },
  "edgar.8k": { placeholders: ["{cik}"], re: /^\d{1,10}$/ },
  // sources-4 (2026-10-12): record TVL days (built, off until DefiLlama consents) and the refused CoinGecko milestones
  "defillama.tvlrecord": { placeholders: ["{protocol}"], re: /^[a-z0-9-]{1,48}$/ },
  "defillama.tvlnext": { placeholders: ["{protocol}"], re: /^[a-z0-9-]{1,48}$/ },
  "coingecko.mcap": { placeholders: ["{coin}"], re: /^[a-z0-9-]{1,64}$/ },
  "coingecko.rank": { placeholders: ["{coin}"], re: /^[a-z0-9-]{1,64}$/ },
  "ll2.provider": { placeholders: ["{provider}"], re: /^\d{1,5}$/, apply: applyLl2Provider },
  "ll2.launch": { placeholders: ["{launch}"], re: /^[0-9a-f-]{36}$/, apply: applyLl2Launch },
  "usgs.quakes": { placeholders: ["{magnitude}", "{bbox}"], re: /^\d(\.5)?(\/[a-z]+)?$/, apply: applyUsgsQuakes },
  "github.releases": { placeholders: ["{owner}", "{repo}"], re: /^[A-Za-z0-9_.-]{1,39}\/[A-Za-z0-9_.-]{1,100}$/, apply: applyGithubReleases },
  "github.milestone": { placeholders: ["{owner}", "{repo}", "N"], re: /^[A-Za-z0-9_.-]{1,39}\/[A-Za-z0-9_.-]{1,100}\.\d{3,8}$/, apply: applyGithubMilestone },
  "youtube.milestone": { placeholders: ["{channel}", "subscribers|views", "N"], re: /^UC[A-Za-z0-9_-]{22}\/(subscribers|views)\.\d{4,12}$/, apply: applyYoutubeMilestone },
  // sources-3 (2026-10-12): natural disasters, each with a recurring and a one-shot form
  "usgs.quakenext": { placeholders: ["{magnitude}", "{bbox}"], re: /^\d(\.5)?(\/[a-z]+)?$/, apply: applyUsgsQuakeNext },
  "nhc.storms": { placeholders: ["basin"], re: /^(al|ep|cp)$/, apply: applyNhc },
  "nhc.hurricanes": { placeholders: ["basin", "category"], re: /^(al|ep|cp)\.[1-5]$/, apply: applyNhc },
  "nhc.next": { placeholders: ["basin", "category", "year"], re: /^(al|ep|cp)\.[1-5]\.20\d\d$/, apply: applyNhc },
  "spc.tornadoes": { placeholders: ["US|state"], re: /^(US|[A-Z]{2})$/, apply: applySpc },
  "spc.tornadoday": { placeholders: ["N", "US|state"], re: /^\d{1,3}\/(US|[A-Z]{2})$/, apply: applySpc },
  "nifc.firesize": { placeholders: ["{acres}"], re: /^\d{5,6}$/, apply: applyNifcFireSize },
  "usgs.volcanowarning": { placeholders: ["vnum"], re: /^\d{6}$/, apply: applyVolcanoWarning },
};

function withParam(cfg: HttpSourceConfig, param: string | null): HttpSourceConfig {
  const spec = PARAMS[cfg.id];
  if (!spec) return cfg;
  if (param === null || !spec.re.test(param)) throw new Error(`${cfg.id} needs a parameter (${cfg.id}:<${spec.placeholders.join("/")}>)`);
  if (spec.apply) { const c = spec.apply(cfg, param); return { ...c, id: `${cfg.id}:${param}`, memoSource: c.memoSource === cfg.memoSource ? `${cfg.memoSource} ${param}`.slice(0, 80) : c.memoSource }; }
  const parts = spec.split ? param.split(spec.split) : [param];
  let url = cfg.request.url, sourceUrl = cfg.sourceUrl;
  spec.placeholders.forEach((ph, i) => { const v = encodeURIComponent(parts[i]); url = url.split(ph).join(v); sourceUrl = sourceUrl.split(ph).join(v); });
  return { ...cfg, id: `${cfg.id}:${param}`, title: `${cfg.title} — ${param.replace(/_/g, " ")}`, request: { ...cfg.request, url }, sourceUrl, memoSource: `${cfg.memoSource} ${param}`.slice(0, 80) };
}

function toFeed(cfg: HttpSourceConfig, param: string | null, o: { fetchImpl?: FetchLike; now?: () => number } = {}): Feed {
  const c = withParam(cfg, param);
  const s = httpSource(c, o);
  return { ...s, pollEverySec: c.pollEverySec, readWindow: c.readWindow ?? null, fixturePath: c.fixture, memoSource: c.memoSource, param };
}

/** Every configured source (parameterised ones with their fixture's parameter for the card). */
export function catalogue(root = process.cwd()): Feed[] {
  return loadSourcesConfig(root).map((c) => toFeed(c, PARAMS[c.id] ? DEFAULT_PARAMS[c.id] ?? null : null));
}
/** The parameter each parameterised source's catalogue card shows (sources-2: real ids from the 2026-10-12 fixtures; NASA's channel). */
export const DEFAULT_PARAMS: Record<string, string> = { "wiki.views": "Bitcoin", "github.stars": "anza-xyz/agave", "steam.players": "730", "defillama.tvl": "raydium", "edgar.8k": "0000320193",
  "ll2.provider": "121", "ll2.launch": "7d1afb26-6f9c-429b-9ccf-29012fd1e519", "usgs.quakes": "6", "github.releases": "anza-xyz/agave", "github.milestone": "anza-xyz/agave.2000", "youtube.milestone": "UCLA_DiR1FfKNvjuUpBHmylQ/subscribers.15000000",
  "usgs.quakenext": "6.5", "nhc.storms": "al", "nhc.hurricanes": "ep.3", "nhc.next": "ep.3.2026", "spc.tornadoes": "US", "spc.tornadoday": "10/US", "nifc.firesize": "50000", "usgs.volcanowarning": "332010",
  "defillama.tvlrecord": "raydium-amm", "defillama.tvlnext": "raydium-amm", "coingecko.mcap": "solana", "coingecko.rank": "solana" };

/** The six original feeds plus everything else launchable, in config order (the wizard's tier-2 cards). */
export const CATALOGUE: readonly Feed[] = (() => { try { return catalogue(); } catch { return []; } })();

export function feedById(id: string, o: { fetchImpl?: FetchLike; now?: () => number } = {}, root = process.cwd()): Feed | null {
  const [base, ...rest] = id.split(":");
  const param = rest.length ? rest.join(":") : null;
  const cfg = loadSourcesConfig(root).find((c) => c.id === base);
  if (!cfg) return null;
  if (PARAMS[base] && param === null) return null;
  if (!PARAMS[base] && param !== null) return null;
  try { return toFeed(cfg, param, o); } catch { return null; }
}

/**
 * THE LINK A VISITOR OPENS TO CHECK A SOURCE (intent audit 4 item 20: the Steam link had no appid; the Wikipedia link showed
 * "{yyyymmdd:from:40}"). The source page with the selected parameter and the dates resolved (UTC), or, when that page does not carry the
 * parameter, the exact keyless URL the keeper reads. A keyed request is never linked (no credential in a link): the publisher's terms or
 * documentation page instead. Display only: the settlement source URL on readings is unchanged.
 */
export function verifyUrl(feed: Feed, nowMs: number): string {
  const c = feed.config;
  const token = feed.param ? feed.param.split(/[/.]/)[0] : null;
  const carries = (u: string) => !u.includes("{") && (token === null || u.includes(token) || u.includes(encodeURIComponent(token)));
  const page = expandUrl(feed.sourceUrl, nowMs);
  if (carries(page)) return page;
  const keyed = !!c.keyEnv || /\{key\}/.test(c.request.url);
  const req = keyed ? null : expandUrl(c.request.url, nowMs);
  if (req && carries(req)) return req;
  return c.terms?.url ?? new URL(page.replace(/\{[^}]*\}/g, "")).origin;
}

export const isCatalogueId = (id: string): boolean => feedById(id) !== null;

/** The frozen real fixture a source ships with: { fetchedAt, url, body } (the older six keep their original shape, handled here). */
export function loadFixture(feed: Feed, root = process.cwd()): { fetchedAt: string | null; url: string | null; body: unknown } {
  if (!feed.fixturePath) throw new Error(`${feed.id}: no fixture`);
  const j = JSON.parse(fs.readFileSync(path.join(root, feed.fixturePath), "utf8")) as Record<string, unknown>;
  const { fetchedAt, url, ...rest } = j;
  const body = "body" in rest ? rest.body : feed.config.id === "noaa.flares" ? rest.data : rest;
  return { fetchedAt: typeof fetchedAt === "string" ? fetchedAt : null, url: typeof url === "string" ? url : null, body };
}

export function fixtureReadings(feed: Feed, nowMs: number, root = process.cwd()): { readings: SettledEvent[]; refusals: string[]; fetchedAt: string | null } {
  const f = loadFixture(feed, root);
  const at = f.fetchedAt ? Date.parse(f.fetchedAt) : nowMs;
  if (f.body === null || f.body === undefined) return { readings: [], refusals: ["fixture: no body was obtained (see the fixture's note)"], fetchedAt: f.fetchedAt };
  return { ...parseBody(feed.config, f.body, at), fetchedAt: f.fetchedAt };
}

/** "What would have burned" over the fixture's window under a rule (the same engine as the keeper and the oracle back-test). */
export function previewFromFixture(feed: Feed, rule: BurnRule, nowMs: number, root = process.cwd()): Backtest & { window: { from: string; to: string }; lastReading: SettledEvent | null } {
  const { readings } = fixtureReadings(feed, nowMs, root);
  const b = backtest(rule, readings, nowMs, 24);
  return { ...b, window: { from: readings[0]?.at ?? "", to: readings[readings.length - 1]?.at ?? "" }, lastReading: readings[readings.length - 1] ?? null };
}

/** A tier-2 rule must agree with the source's fixed unit, direction and baseline; the source's carry policy rides along. */
export function feedRuleProblems(feed: Feed, rule: BurnRule): string[] {
  const p: string[] = [];
  if (rule.oracle !== "catalogue" || rule.series !== feed.id) p.push(`This rule is not for the source "${feed.title}".`);
  if (rule.kind !== "scalar" || !rule.scalar) { p.push("A catalogue rule must settle on a number."); return p; }
  if (rule.scalar.unit !== feed.unit!.size) p.push(`The unit must be ${feed.unit!.size} (${feed.unit!.label}) for "${feed.title}".`);
  if (rule.scalar.direction !== feed.direction) p.push(`The direction must be "${feed.direction}" for "${feed.title}".`);
  if (rule.scalar.baseline !== feed.baseline) p.push(`The baseline must be ${JSON.stringify(feed.baseline)} for "${feed.title}".`);
  if (!feed.launchable.ok) p.push(`Coins cannot launch on "${feed.title}" yet, because ${plainLaunchableWhy(feed.launchable.why)}.`);
  return p;
}

/**
 * A source's "not launchable" note as the end of a sentence a creator reads (launch walkthrough 2026-10-13: the review answered "The reason
 * is: needs a key: BEA_API_KEY (free registration)" and "the fixture is a 6 KB excerpt of the 3 MB page"). The catalogue keeps the
 * operator's note; the refusal says what it means. An unrecognised note is passed through without its trailing full stop.
 */
export function plainLaunchableWhy(why: string | null | undefined): string {
  const w = (why ?? "").trim();
  if (!w) return "it is not open for new coins on this site";
  if (/^needs a key\b/i.test(w)) return "the publisher requires an access key that this site does not have yet";
  const cross = /^a settlement cross-read, not a launch source: (\S+) is the primary/i.exec(w);
  if (cross) return `it is only used to check another source. Launch on ${cross[1]} instead`;
  if (/owner confirms|owner's say-so/i.test(w)) return "it needs the operator's approval first";
  if (/fixture is a .*excerpt|markup can change/i.test(w)) return "its page cannot be read reliably enough to settle a coin";
  if (/requires a .*login|no public endpoint/i.test(w)) return "it has no public page this site can read";
  if (/no RPC/i.test(w)) return "this site has no connection to that network set up";
  if (/already has its result/i.test(w)) return "this one-time event already has its result, and a coin only counts results that come after its launch";
  if (/terms need its written consent/i.test(w)) return "the publisher's terms need its written consent before a coin settles on its data";
  if (/terms do not cover this use/i.test(w)) return "the publisher's terms do not allow this use";
  return w.replace(/\.$/, "");
}

export function feedSummary(f: Feed): SeriesSummary {
  return { oracle: "catalogue", ticker: f.id, title: f.title, category: `tier ${f.tier}`, frequency: f.cadence, settlementSource: { name: f.sourceName, url: f.sourceUrl }, tags: f.flags };
}

/** The catalogue as an oracle: settled readings since a time, no prices. */
export class CatalogueAdapter implements OracleAdapter {
  readonly id = "catalogue" as const;
  private o: { fetchImpl?: FetchLike; now?: () => number };
  constructor(o: { fetchImpl?: FetchLike; now?: () => number } = {}) { this.o = o; }
  async searchSeries(query: string): Promise<SeriesSummary[]> {
    const q = query.trim().toLowerCase();
    return catalogue().filter((f) => !q || f.id.toLowerCase().includes(q) || f.title.toLowerCase().includes(q)).map(feedSummary);
  }
  async seriesInfo(id: string): Promise<SeriesSummary | null> {
    const f = feedById(id); if (f) return feedSummary(f);
    const n = nativeSourceById(id);
    return n ? { oracle: "catalogue", ticker: n.id, title: n.title, category: "tier 4", frequency: n.cadence, settlementSource: { name: n.sourceName, url: n.sourceUrl }, tags: n.flags } : null;
  }
  async settledSince(rule: BurnRule, sinceIso: string | null): Promise<ResolvedSelector> {
    // native first-party sources (the sports results with their cross-read, NWS daily climate): their own reader, the same fixed-unit check
    const native = rule.series ? nativeSourceById(rule.series) : null;
    if (native) { const np = nativeRuleProblems(native, rule); if (np.length) throw new Error(`catalogue: ${np.join("; ")}`); return native.settledSince(rule, sinceIso); }
    const feed = rule.series ? feedById(rule.series, this.o) : null;
    if (!feed) throw new Error(`catalogue: unknown source ${rule.series}`);
    const problems = feedRuleProblems(feed, rule);
    if (problems.length) throw new Error(`catalogue: ${problems.join("; ")}`);
    // Review N2 (2026-10-10): the primary's readings pass through the independent cross-read of the same fact, read in this cycle
    // (corroborate.ts); a reading that is not confirmed is held, never written, never attested.
    const now = this.o.now ?? (() => Date.now());
    const fetchImpl = this.o.fetchImpl ?? (fetch as unknown as FetchLike);
    const t0 = now();
    const { readings, refusals } = feed.parse(await fetchBody(feed.config, t0, fetchImpl), t0);
    const events = readings.filter((r) => sinceIso === null || r.at > sinceIso);
    return corroborate(feed, readings, events, t0, { entries: loadSourceEntries(), crossFeed: (id) => feedById(id, this.o), fetchImpl, now }, { awaitingFinal: 0, refusals, settlementSourceUrl: feed.config.sourceUrl });
  }
  async impliedChance(): Promise<ImpliedChance> { return { chance: null, marketTicker: null, closeTime: null, basis: "primary source: there is no market to read" }; }
}
