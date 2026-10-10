import fs from "node:fs";
import path from "node:path";
import type { BurnRule } from "@/lib/burnticker/rules";
import type { SettledEvent } from "@/lib/burnticker/units";
import type { FetchLike, ImpliedChance, OracleAdapter, ResolvedSelector, SeriesSummary } from "@/lib/burnticker/oracle/types";
import { backtest, type Backtest } from "@/lib/burnticker/oracle/backtest";
import { httpSource, parseBody, type HttpSourceConfig } from "@/lib/burnticker/sources/attestedHttp";
import type { ResolutionSource } from "@/lib/burnticker/sources/types";
import { copycatSource, type CopycatSourceConfig, type CopycatSourceOptions } from "@/lib/burnticker/sources/copycats";

/**
 * THE FIRST-PARTY CATALOGUE (tier 3–5) — config/burnticker/sources.json read through the generic attested-http adapter (2026-10-09:
 * "adding a source is config, not code"). A `Feed` here is the config entry plus the parser; the hand-written feed classes are gone.
 * Parameterised sources take their parameter after a colon: wiki.views:<Article>, github.stars:<owner>/<repo>, steam.players:<appid>,
 * defillama.tvl:<slug>, edgar.8k:<CIK>; the parameter is substituted into the URL and is part of the locked rule (series id).
 */

export const SOURCES_FILE = path.join("config", "burnticker", "sources.json");

export interface Feed extends ResolutionSource { config: HttpSourceConfig; parse(body: unknown, nowMs: number): { readings: SettledEvent[]; refusals: string[] }; pollEverySec: number; fixturePath: string | null; memoSource: string; param: string | null }

let cachedConfig: { entries: SourceEntry[] } | null = null;
/** Any entry of sources.json: the attested-http feeds (HttpSourceConfig) and the other kinds (onchain.copycats, CopycatSourceConfig). */
export type SourceEntry = HttpSourceConfig | CopycatSourceConfig;
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
  const cfg = loadSourceEntries(root).find((e): e is CopycatSourceConfig => e.kind === "onchain" && e.id === "onchain.copycats");
  return cfg ? copycatSource(cfg, o) : null;
}

/** Parameter placeholders a source's URL may carry, keyed by the series-id syntax ("github.stars:<owner>/<repo>"). */
const PARAMS: Record<string, { placeholders: string[]; split?: string; re: RegExp }> = {
  "wiki.views": { placeholders: ["{article}"], re: /^[A-Za-z0-9_.-]{1,48}$/ },
  "github.stars": { placeholders: ["{owner}", "{repo}"], split: "/", re: /^[A-Za-z0-9_.-]{1,39}\/[A-Za-z0-9_.-]{1,100}$/ },
  "steam.players": { placeholders: ["{appid}"], re: /^\d{1,10}$/ },
  "defillama.tvl": { placeholders: ["{protocol}"], re: /^[a-z0-9-]{1,48}$/ },
  "edgar.8k": { placeholders: ["{cik}"], re: /^\d{1,10}$/ },
};

function withParam(cfg: HttpSourceConfig, param: string | null): HttpSourceConfig {
  const spec = PARAMS[cfg.id];
  if (!spec) return cfg;
  if (param === null || !spec.re.test(param)) throw new Error(`${cfg.id} needs a parameter (${cfg.id}:<${spec.placeholders.join("/")}>)`);
  const parts = spec.split ? param.split(spec.split) : [param];
  let url = cfg.request.url, sourceUrl = cfg.sourceUrl;
  spec.placeholders.forEach((ph, i) => { const v = encodeURIComponent(parts[i]); url = url.split(ph).join(v); sourceUrl = sourceUrl.split(ph).join(v); });
  return { ...cfg, id: `${cfg.id}:${param}`, title: `${cfg.title} — ${param.replace(/_/g, " ")}`, request: { ...cfg.request, url }, sourceUrl, memoSource: `${cfg.memoSource} ${param}`.slice(0, 80) };
}

function toFeed(cfg: HttpSourceConfig, param: string | null, o: { fetchImpl?: FetchLike; now?: () => number } = {}): Feed {
  const c = withParam(cfg, param);
  const s = httpSource(c, o);
  return { ...s, pollEverySec: c.pollEverySec, fixturePath: c.fixture, memoSource: c.memoSource, param };
}

/** Every configured source (parameterised ones with their fixture's parameter for the card). */
export function catalogue(root = process.cwd()): Feed[] {
  return loadSourcesConfig(root).map((c) => toFeed(c, PARAMS[c.id] ? DEFAULT_PARAMS[c.id] ?? null : null));
}
const DEFAULT_PARAMS: Record<string, string> = { "wiki.views": "Bitcoin", "github.stars": "anza-xyz/agave", "steam.players": "730", "defillama.tvl": "raydium", "edgar.8k": "0000320193" };

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
  if (rule.oracle !== "catalogue" || rule.series !== feed.id) p.push(`rule is not for source ${feed.id}`);
  if (rule.kind !== "scalar" || !rule.scalar) { p.push("catalogue rules are scalar"); return p; }
  if (rule.scalar.unit !== feed.unit!.size) p.push(`unit must be ${feed.unit!.size} (${feed.unit!.label}) for ${feed.id}`);
  if (rule.scalar.direction !== feed.direction) p.push(`direction must be "${feed.direction}" for ${feed.id}`);
  if (rule.scalar.baseline !== feed.baseline) p.push(`baseline must be ${JSON.stringify(feed.baseline)} for ${feed.id}`);
  if (!feed.launchable.ok) p.push(`${feed.id} is not launchable: ${feed.launchable.why}`);
  return p;
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
  async seriesInfo(id: string): Promise<SeriesSummary | null> { const f = feedById(id); return f ? feedSummary(f) : null; }
  async settledSince(rule: BurnRule, sinceIso: string | null): Promise<ResolvedSelector> {
    const feed = rule.series ? feedById(rule.series, this.o) : null;
    if (!feed) throw new Error(`catalogue: unknown source ${rule.series}`);
    const problems = feedRuleProblems(feed, rule);
    if (problems.length) throw new Error(`catalogue: ${problems.join("; ")}`);
    return feed.settledSince(rule, sinceIso);
  }
  async impliedChance(): Promise<ImpliedChance> { return { chance: null, marketTicker: null, closeTime: null, basis: "primary source: there is no market to read" }; }
}
