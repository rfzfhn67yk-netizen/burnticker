import { catalogue, loadSourceEntries, type Feed, type SourceEntry } from "@/lib/burnticker/catalogue";
import { CATEGORIES_FILE, loadCategories } from "@/lib/burnticker/browse";
import { ONCHAIN_FACTS } from "@/lib/burnticker/sources/onchain";
import { driftBetStub, hedgehogStub, polymarketCard, umaStub } from "@/lib/burnticker/sources/stubs";
import type { FetchLike } from "@/lib/burnticker/oracle/types";
import type { CategoryDef, CoverageMatrix, DryRunSummary, SourceDescriptor } from "@/lib/burnticker/coverage/types";
import { coverageMatrix } from "@/lib/burnticker/coverage/matrix";
import { leagueCoverage, renderLeagueCoverage, type LeagueCoverage } from "@/lib/burnticker/coverage/leagues";
import { crossReadsOf, describeCard, describeEntry, describeOnchain, primaryEligibility } from "@/lib/burnticker/coverage/sources";
import { historicalDryRun } from "@/lib/burnticker/coverage/dryRun";

/**
 * THE COVERAGE REPORT (2026-10-10): the glue the CLI (scripts/burnticker-coverage-audit.mts), the API (GET /v1/coverage) and the CI
 * gate share — load every source and the taxonomy, run the 90-day dry run of every primary (with its cross-read) and every cross-read,
 * build the matrix, and render docs/burnticker/SETTLEMENT-COVERAGE.md from the same object. Offline reads frozen fixtures only (no
 * network); live fetches each source once, serially and spaced, through one per-run cache (a source that is both a cross-read and a
 * primary is fetched once).
 */

export interface CoverageBuildOptions {
  mode?: "offline" | "live";
  root?: string;
  windowDays?: number;
  fetchImpl?: FetchLike;
  now?: number;
  /** Where first sightings come from (the registry's readings table), for latency. */
  observations?: (sourceId: string) => { id: string; firstSeenAt: number }[];
  /** Live: Gamma tag lookups (the platform's Polymarket client); a tag that resolves to null is dropped. */
  polymarketTag?: ((slug: string) => Promise<unknown | null>) | null;
  /** Overrides (tests). */
  entries?: SourceEntry[];
  categories?: CategoryDef[];
  /** Live: ms between network requests (default 1200). */
  spacingMs?: number;
}

const baseId = (id: string) => id.split(":")[0];

/** Every source the audit knows: sources.json, the on-chain facts, and the market / assertion cards. */
export function allDescriptors(entries: readonly SourceEntry[]): SourceDescriptor[] {
  return [
    ...entries.map(describeEntry),
    ...(Object.keys(ONCHAIN_FACTS) as (keyof typeof ONCHAIN_FACTS)[]).map((id) => describeOnchain(id, ONCHAIN_FACTS[id].title)),
    ...[polymarketCard(), umaStub(), driftBetStub(), hedgehogStub()].map(describeCard),
  ];
}

/** A per-run fetch: one network request per URL, spaced; both json() and text() served from the cached body. */
export function runFetch(inner: FetchLike, spacingMs = 1200): FetchLike {
  const memo = new Map<string, Promise<{ ok: boolean; status: number; text: string }>>();
  let last = 0;
  return (url, init) => {
    const key = url;
    if (!memo.has(key)) memo.set(key, (async () => {
      const wait = last + spacingMs - Date.now();
      if (last && wait > 0) await new Promise((r) => setTimeout(r, wait));
      last = Date.now();
      const res = await inner(url, init);
      const text = res.text ? await res.text() : JSON.stringify(await res.json());
      return { ok: res.ok, status: res.status, text };
    })());
    return memo.get(key)!.then((r) => ({ ok: r.ok, status: r.status, json: async () => JSON.parse(r.text), text: async () => r.text }));
  };
}

export async function buildCoverage(o: CoverageBuildOptions = {}): Promise<{ matrix: CoverageMatrix; dryRuns: Record<string, DryRunSummary> }> {
  const mode = o.mode ?? "offline";
  const entries = o.entries ?? loadSourceEntries(o.root);
  let categories = o.categories;
  if (!categories) {
    try { categories = loadCategories(o.root); } catch (e) { throw new Error(`coverage: the taxonomy ${CATEGORIES_FILE} could not be read (${(e as Error).message}); the audit is driven by it`); }
  }
  const descriptors = allDescriptors(entries);
  const feeds = catalogue(o.root);
  const feedOf = (id: string): Feed | undefined => feeds.find((f) => baseId(f.id) === id);
  const fetchImpl = mode === "live" ? runFetch(o.fetchImpl ?? (fetch as unknown as FetchLike), o.spacingMs) : undefined;
  const dryRuns: Record<string, DryRunSummary> = {};
  const primaries = descriptors.filter((s) => primaryEligibility(s).ok && s.kind === "attested-http");
  const crossIds = new Set<string>();
  for (const p of primaries) {
    const crosses = crossReadsOf(p, descriptors);
    crosses.forEach((c) => crossIds.add(c.id));
    const feed = feedOf(p.id);
    if (!feed) continue;
    dryRuns[p.id] = await historicalDryRun(feed, o.windowDays ?? 90, { mode, now: o.now, root: o.root, fetchImpl, crossReads: crosses.map((c) => feedOf(c.id)).filter((f): f is Feed => !!f), observations: o.observations?.(feed.id) });
  }
  for (const id of crossIds) {
    const feed = feedOf(id);
    if (feed && !dryRuns[id]) dryRuns[id] = await historicalDryRun(feed, o.windowDays ?? 90, { mode, now: o.now, root: o.root, fetchImpl, observations: o.observations?.(feed.id) });
  }
  const missing: string[] = [];
  const notes: string[] = [];
  if (mode === "live" && o.polymarketTag) {
    for (const t of [...new Set(categories.flatMap((c) => c.polymarket))]) {
      try { if ((await o.polymarketTag(t)) === null) missing.push(t); } catch (e) { notes.push(`Polymarket tag ${t} could not be checked: ${(e as Error).message.slice(0, 80)}`); }
    }
  }
  if (mode === "offline") notes.push("offline: every dry run reads the source's frozen fixture and its window ends at that fixture's fetch time; Polymarket tags are taken from the taxonomy as written (the live run checks each on Gamma)");
  const asOf = Object.values(dryRuns).map((d) => d.to).sort().pop() ?? null;
  const matrix = coverageMatrix(descriptors, categories, { dryRuns, polymarketAvailable: polymarketCard().launchable.ok, polymarketTagsMissing: missing, mode, generatedAt: mode === "offline" && asOf ? `${asOf}T00:00:00.000Z` : new Date(o.now ?? Date.now()).toISOString(), taxonomyFile: CATEGORIES_FILE, notes });
  return { matrix, dryRuns };
}

// ---- the document ----

const pct = (x: number | null): string => (x === null ? "n/a" : `${(x * 100).toFixed(x === 1 || x === 0 ? 0 : 1)}%`);
const hours = (x: number | null): string => (x === null ? "n/a" : x < 48 ? `${x.toFixed(1)} h` : `${(x / 24).toFixed(1)} d`);
const VERDICT: Record<string, string> = { settleable: "**settleable**", "adjudicated-only": "adjudicated-only (Polymarket)", uncovered: "**uncovered**" };
const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
type SourceRefRow = CoverageMatrix["categories"][number]["primaries"][number] & { roles: string[] };

function dryCells(d: DryRunSummary | null): string[] {
  if (!d) return ["n/a", "n/a", "n/a"];
  if (d.error) return [`n/a (${cell(d.error.slice(0, 60))})`, "n/a", "n/a"];
  const hit = d.hitRate === null ? `n/a (${d.schedule.kind === "none" ? "no schedule" : "nothing due"})` : `${pct(d.hitRate)} (${d.hits}/${d.expected})`;
  const lat = d.latency.medianHours === null ? "n/a" : `${hours(d.latency.medianHours)} (${d.latency.samples})`;
  const dis = d.crossRead.id === null ? "n/a"
    : d.crossRead.disagreementRate === null ? (/^snapshot/.test(d.crossRead.basis) ? `n/a (the two snapshots were not read together; the creation preflight reads both at once)` : /unreadable/.test(d.crossRead.basis) ? `n/a (${cell(d.crossRead.basis.slice(0, 80))})` : `n/a (no period shared with ${d.crossRead.id} in the window)`)
    : `${pct(d.crossRead.disagreementRate)} (${d.crossRead.disagreements} of ${d.crossRead.compared} shared periods vs ${d.crossRead.id})`;
  return [hit, lat, dis];
}

/** docs/burnticker/SETTLEMENT-COVERAGE.md from the matrix (the same object GET /v1/coverage serves). Copy-lint clean by test. */
export function renderCoverageMarkdown(m: CoverageMatrix, leagues: readonly LeagueCoverage[] = leagueCoverage(loadSourceEntries())): string {
  const L: string[] = [];
  const asOf = m.generatedAt.slice(0, 10);
  L.push("# Burnticker — settlement coverage", "");
  L.push(`<!-- Generated by \`node --import ./test/alias-hook.mjs scripts/burnticker-coverage-audit.mts --offline --write\`. Do not edit by hand: change the sources, the taxonomy or the audit, then regenerate. -->`, "");
  L.push(`**The rule.** ${m.rule}`, "");
  L.push(`Mode: ${m.mode}${m.mode === "offline" ? ` (frozen fixtures, data as of ${asOf})` : ` (read ${m.generatedAt})`}. Taxonomy: \`${m.taxonomy.file}\` (${m.taxonomy.categories} categories). The same matrix is served as JSON at \`GET /api/burnticker/v1/coverage\` and drawn on the trust page.`, "");
  L.push("A **primary** is a first-party source adapter: kind attested-http or on-chain, tier 4 or better, launchable, not an aggregator, not declared cross-read-only, never Kalshi. An **independent cross-read** reads the same fact (`fact` in `config/burnticker/sources.json`) from another operator on another registrable domain. **Hit rate** = readings the source's schedule expected in the 90-day window that one read produced; **latency** = first sighting by the keeper minus the end of the period; **disagreement** = shared periods where the primary and its cross-read differ beyond the fact's tolerance.", "");
  L.push("## Summary", "");
  L.push(`${m.summary.settleable} settleable · ${m.summary.adjudicatedOnly} adjudicated-only · ${m.summary.uncovered} uncovered. Without any primary source: ${m.summary.withoutPrimary.length ? m.summary.withoutPrimary.join(", ") : "none"}.`, "");
  L.push("| Category | Verdict | Primaries | Independent cross-reads | Polymarket tags |", "|---|---|---|---|---|");
  for (const c of m.categories) L.push(`| ${cell(c.label)} | ${VERDICT[c.verdict]} | ${c.primaries.map((p) => `\`${p.id}\``).join(", ") || "none"} | ${c.crossReads.map((x) => `\`${x.id}\` (of \`${x.of}\`)`).join(", ") || "none"} | ${c.polymarket.tags.join(", ") || "none"} |`);
  L.push("");
  for (const c of m.categories) {
    L.push(`## ${c.label} — ${c.verdict}`, "", cell(c.why) + ".", "");
    const byRow = new Map<string, SourceRefRow>();
    for (const p of c.primaries) byRow.set(p.id, { ...p, roles: ["primary"] });
    for (const x of c.crossReads) { const r = byRow.get(x.id); if (r) r.roles.push(`cross-read of \`${x.of}\``); else byRow.set(x.id, { ...x, roles: [`cross-read of \`${x.of}\``] }); }
    const rows = [...byRow.values()].map((r) => ({ ...r, role: r.roles.join("; ") }));
    if (rows.length) {
      L.push("| Source | Role | Operator | Domain | Tier | Fact | 90-day hit rate | Median latency | Disagreement |", "|---|---|---|---|---|---|---|---|---|");
      for (const r of rows) L.push(`| \`${r.id}\` | ${r.role} | ${cell(r.operator ?? "not declared")} | ${r.domain ?? "—"} | ${r.tier} | ${r.fact ? `\`${r.fact}\`` : "—"} | ${dryCells(r.dryRun).join(" | ")} |`);
      L.push("");
    } else L.push("No primary source maps to this category.", "");
    if (c.notPrimary.length) L.push(`Mapped here but not a primary: ${c.notPrimary.map((n) => `\`${n.id}\` (${cell(n.why)})`).join("; ")}.`, "");
    if (c.unknownFeeds.length) L.push(`Named by the taxonomy but not defined on this host: ${c.unknownFeeds.map((x) => `\`${x}\``).join(", ")}.`, "");
    L.push("| Selector kind | Verdict | Why |", "|---|---|---|");
    for (const k of c.kinds) L.push(`| ${m.kinds.find((x) => x.id === k.kind)!.wizard} (\`${k.kind}\`) | ${VERDICT[k.verdict]} | ${cell(k.why)} |`);
    L.push("");
    if (c.kalshiDiscoveryOnly.length) L.push(`Kalshi categories mapped here (${c.kalshiDiscoveryOnly.join(", ")}) are discovery only: never a settlement input.`, "");
  }
  L.push("## What we cannot settle today", "");
  const byKind = new Map<string, string[]>();
  for (const u of m.uncovered) byKind.set(u.kind, [...(byKind.get(u.kind) ?? []), u.category]);
  const label = (id: string) => m.categories.find((c) => c.id === id)?.label ?? id;
  const noPrimary = m.categories.filter((c) => c.primaries.length === 0);
  if (noPrimary.length) L.push(`- **No first-party source at all:** ${noPrimary.map((c) => c.label).join(", ")}. Nothing in these categories settles on a primary reading; only Polymarket's yes/no markets can, where a tag maps.`);
  const lonely = m.categories.filter((c) => c.primaries.length > 0 && !c.crossReads.length);
  if (lonely.length) L.push(`- **Primary source without an independent cross-read:** ${lonely.map((c) => `${c.label} (${c.primaries.map((p) => `\`${p.id}\``).join(", ")})`).join("; ")}. One operator's number cannot settle a coin on its own, so these feeds are refused at creation until a second operator's read of the same fact is configured.`);
  const scalarGaps = byKind.get("scalar") ?? [];
  if (scalarGaps.length) L.push(`- **Settled numbers (scalar rules) in:** ${scalarGaps.map(label).join(", ")}. Polymarket is binary-only, so where no primary pair exists there is no settled number at all: index closes, rates and commodity settlements (Financial markets), daily temperatures and rainfall (Weather & Climate) and every other Kalshi strike ladder have no replacement today.`);
  if (byKind.has("team-coin")) L.push("- **Team coins (every game of one team) and season matchups:** Kalshi's per-team game legs were the only route. Polymarket's game market lists the two teams in an order that changes from game to game, so \"every Broncos loss\" has no fixed YES/NO; ESPN's scoreboard is not admitted (unofficial endpoint, terms unchecked). A single game as a matchup pair settles on Polymarket.");
  const elections = m.categories.find((c) => c.id === "politics");
  if (elections) L.push(`- **Elections and votes:** ${elections.verdict === "settleable" ? "settleable on a primary pair" : "adjudicated-only. They settle on Polymarket's payout vector or not at all"}; no official results feed is configured.`);
  L.push("- **One-shot markets** (one question that resolves once): Polymarket only. No primary source answers an arbitrary question.");
  for (const [kind, cats] of byKind) if (!["scalar", "team-coin", "matchup-season"].includes(kind)) L.push(`- \`${kind}\` in ${cats.map(label).join(", ")}: no Polymarket tag maps there and no primary source is binary.`);
  L.push("");
  L.push("## How to read this", "");
  L.push("- **Independent operator, not independent measurement.** FRED republishes BLS series; the pair catches a broken endpoint, a parser error or a tampered response, not an error in the BLS release itself. The same holds for any mirror.");
  L.push("- **Latency is n/a until the keeper has run.** One read carries one fetch time, not a publication history; the keeper's readings table records the first sighting of every reading, and the live audit uses it once a token reads the source.");
  L.push("- **Zero-filled counts read 100%.** A day without a flare or a launch is a reading of 0, so their hit rate measures the read, not the publisher.");
  L.push("- **Snapshots** (block heights, stars, players) have no publication schedule; their cross-read pairs only reads taken within minutes of each other, which the creation preflight does.");
  L.push("- **Kalshi** is excluded as a primary, as a cross-read and as a venue, whatever any config file says: its Developer Agreement and Data Terms forbid settling products on its data or redistributing it.");
  for (const n of m.notes) L.push(`- ${n}`);
  L.push("");
  L.push(...renderLeagueCoverage(leagues));
  return L.join("\n");
}
