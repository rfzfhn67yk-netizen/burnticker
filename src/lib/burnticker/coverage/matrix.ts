import type { CategoryCoverage, CategoryDef, CoverageMatrix, CrossReadPair, DryRunSummary, KindCoverage, SelectorKind, SourceDescriptor, SourceRef, Verdict } from "@/lib/burnticker/coverage/types";
import { crossReadsOf, isKalshi, pairOf, primaryEligibility } from "@/lib/burnticker/coverage/sources";

/**
 * THE SETTLEMENT-COVERAGE MATRIX (2026-10-10). Pure: sources + the category taxonomy (config/burnticker/categories.json) → for each
 * category and each selector kind the wizard can emit, the primary adapters, their independent cross-reads, and a verdict:
 *
 *   settleable        ≥ 1 primary AND ≥ 1 independent cross-read of the same fact (different operator, different domain)
 *   adjudicated-only  no such pair, but Polymarket covers the kind (binary markets; the result is the CTF payout vector on Polygon)
 *   uncovered         neither
 *
 * Kalshi is excluded everywhere — as a primary, as a cross-read, and as a venue — even when sources.json or the taxonomy names it:
 * its Developer Agreement and Data Terms forbid settling products on its data (owner decision 2026-10-10). The taxonomy's Kalshi
 * categories are carried as "discovery only".
 *
 * A category's verdict: settleable when its scalar kind is (a primary with a cross-read), else adjudicated-only when any kind is,
 * else uncovered. Kinds that apply to one category only (team coins, matchups: "sports") are evaluated there only.
 */

export const SELECTOR_KINDS: SelectorKind[] = [
  { id: "scalar", label: "a settled number each period (a primary feed's reading; was also Kalshi's strike ladders: index closes, daily highs)", wizard: "Advanced: first-party feed", appliesTo: "all" },
  { id: "series-binary", label: "every market of a tag or an event, yes/no (recurring)", wizard: "Any market → a Polymarket tag or event", appliesTo: "all" },
  { id: "one-shot", label: "one market that resolves once", wizard: "Any market → one market", appliesTo: "all" },
  { id: "team-coin", label: "every game of one team", wizard: "Team coin", appliesTo: ["sports"] },
  { id: "matchup-game", label: "two coins on one game (one market, inverted)", wizard: "Matchup pair → this game only", appliesTo: ["sports"] },
  { id: "matchup-season", label: "two coins, each on its own team's games", wizard: "Matchup pair → every game this season", appliesTo: ["sports"] },
];

/** The per-game result fact the ESPN scoreboard and its league cross-reads share (config/burnticker/sources.json, kind native). */
export const SPORTS_FACT = "sports.game.final-score";

export const SETTLEMENT_RULE = "A coin settles on a primary source with an independent cross-read of the same fact (another operator on another domain), or on Polymarket's Conditional Tokens payout vector on Polygon for an adjudicated market. Prediction markets are discovery and optional cross-checks where their terms permit; Kalshi's terms do not permit either use, so Kalshi is never an input.";

export interface MatrixOptions {
  dryRuns?: Record<string, DryRunSummary>;
  /** Whether the Polymarket adapter is live on this host (default true). */
  polymarketAvailable?: boolean;
  /** Live mode: tags Gamma did NOT resolve (dropped from the category's adjudicated coverage, with a note). */
  polymarketTagsMissing?: string[];
  mode?: "offline" | "live";
  generatedAt?: string;
  taxonomyFile?: string;
  notes?: string[];
}

const baseId = (id: string) => id.split(":")[0];

const ref = (s: SourceDescriptor, dryRuns: Record<string, DryRunSummary>): SourceRef => ({ id: s.id, title: s.title, operator: s.operator, domain: s.domain, tier: s.tier, fact: s.fact?.id ?? null, dryRun: dryRuns[s.id] ?? null });

function kindRow(kind: SelectorKind, primaries: SourceDescriptor[], pairs: CrossReadPair[], tags: string[], poly: boolean): KindCoverage {
  const polyOk = poly && tags.length > 0;
  const prim = primaries.map((p) => p.id);
  const row = (verdict: Verdict, why: string, withPairs = false): KindCoverage => ({ kind: kind.id, verdict, why, primaries: withPairs ? prim : [], crossReads: withPairs ? pairs : [], polymarketTags: verdict === "adjudicated-only" ? tags : [] });
  switch (kind.id) {
    case "scalar": {
      if (pairs.length) { const seen = new Set<string>(); const shown = pairs.filter((x) => { const k = [x.primary, x.crossRead].sort().join("|"); return seen.has(k) ? false : (seen.add(k), true); }); return row("settleable", `primary with an independent cross-read: ${shown.map((x) => `${x.primary} ↔ ${x.crossRead}`).join(", ")}`, true); }
      if (primaries.length) return { ...row("uncovered", `primary source(s) without an independent cross-read of the same fact: ${prim.join(", ")}; Polymarket is binary-only, so no adjudicated scalar either`), primaries: prim };
      return row("uncovered", "no primary source maps to this category, and Polymarket is binary-only (no adjudicated settled number)");
    }
    case "series-binary":
    case "one-shot":
      return polyOk ? row("adjudicated-only", `Polymarket tag(s) ${tags.join(", ")}: the result is the CTF payout vector on Polygon; no primary source here is binary`) : row("uncovered", poly ? "no Polymarket tag maps to this category and no primary source is binary" : "Polymarket is not available on this host and no primary source is binary");
    case "matchup-game":
      if (pairs.some((x) => x.fact === SPORTS_FACT)) return row("settleable", "two coins on one game, one per team (espn.game:…-loss), settled on the ESPN final score confirmed by the league's cross-read", true);
      return polyOk ? row("adjudicated-only", "one Polymarket game market (the moneyline), side B inverted: a partition, like a Kalshi one-shot") : row("uncovered", "no Polymarket game markets on this host");
    case "team-coin":
      if (pairs.some((x) => x.fact === SPORTS_FACT)) return row("settleable", `ESPN scoreboard game results in every team-sport league it serves (baseball, basketball, hockey, soccer, football, college), each confirmed by the league's own feed (MLB, NHL) or TheSportsDB (every other league) before it counts (src/lib/burnticker/sources/espn.ts; per league below)`, true);
      return row("uncovered", "the team's own leg of a Kalshi game series was the only route; Polymarket moneylines have no fixed per-team YES/NO (the team order changes per game); espn.nfl counts finals only and is not admitted");
    case "matchup-season":
      if (pairs.some((x) => x.fact === SPORTS_FACT)) return row("settleable", "two team coins on the ESPN scoreboard, each game confirmed by its league's cross-read", true);
      return row("uncovered", "two team coins (one per team's games): uncovered for the same reason as team coins");
  }
}

export function coverageMatrix(sources: readonly SourceDescriptor[], categories: readonly CategoryDef[], opts: MatrixOptions = {}): CoverageMatrix {
  const dryRuns = opts.dryRuns ?? {};
  const poly = opts.polymarketAvailable ?? true;
  const missingTags = new Set(opts.polymarketTagsMissing ?? []);
  const byId = new Map(sources.map((s) => [s.id, s]));
  const excluded = sources.filter((s) => isKalshi(s)).map((s) => ({ id: s.id, why: primaryEligibility(s).why! }));
  const cats: CategoryCoverage[] = categories.map((c) => {
    const mapped = [...new Set(c.feeds.map(baseId))];
    const unknownFeeds = mapped.filter((id) => !byId.has(id));
    const present = mapped.map((id) => byId.get(id)).filter((s): s is SourceDescriptor => !!s);
    const notPrimary: { id: string; why: string }[] = [];
    const primaries = present.filter((s) => { const e = primaryEligibility(s); if (!e.ok) notPrimary.push({ id: s.id, why: e.why! }); return e.ok; });
    const crossReads: (SourceRef & { of: string })[] = [];
    const pairs: CrossReadPair[] = [];
    for (const p of primaries) for (const x of crossReadsOf(p, sources)) { pairs.push(pairOf(p, x)); crossReads.push({ ...ref(x, dryRuns), of: p.id }); }
    const tags = c.polymarket.filter((t) => !missingTags.has(t));
    const kinds = SELECTOR_KINDS.filter((k) => k.appliesTo === "all" || k.appliesTo.includes(c.id)).map((k) => kindRow(k, primaries, pairs, tags, poly));
    const scalar = kinds.find((k) => k.kind === "scalar")!;
    const verdict: Verdict = scalar.verdict === "settleable" ? "settleable" : kinds.some((k) => k.verdict === "adjudicated-only") ? "adjudicated-only" : "uncovered";
    const why = verdict === "settleable" ? scalar.why
      : verdict === "adjudicated-only" ? `${primaries.length ? `primary source(s) ${primaries.map((p) => p.id).join(", ")} lack an independent cross-read` : "no primary source maps here"}; Polymarket covers yes/no markets (${tags.join(", ")})`
      : `${primaries.length ? `primary source(s) ${primaries.map((p) => p.id).join(", ")} lack an independent cross-read` : "no primary source maps here"}, and no Polymarket tag does`;
    return { id: c.id, label: c.label, verdict, why, primaries: primaries.map((s) => ref(s, dryRuns)), crossReads, notPrimary, unknownFeeds, polymarket: { tags, available: poly }, kalshiDiscoveryOnly: [...c.kalshi], kinds };
  });
  const uncovered = cats.flatMap((c) => c.kinds.filter((k) => k.verdict === "uncovered").map((k) => ({ category: c.id, kind: k.kind, why: k.why })));
  const notes = [...(opts.notes ?? [])];
  if (missingTags.size) notes.push(`Polymarket tags Gamma did not resolve (dropped): ${[...missingTags].join(", ")}`);
  return {
    schema: "burnticker.coverage/v1", generatedAt: opts.generatedAt ?? new Date().toISOString(), mode: opts.mode ?? "offline",
    taxonomy: { file: opts.taxonomyFile ?? "config/burnticker/categories.json", categories: categories.length }, rule: SETTLEMENT_RULE, kinds: SELECTOR_KINDS, categories: cats, uncovered, excluded,
    summary: { settleable: cats.filter((c) => c.verdict === "settleable").length, adjudicatedOnly: cats.filter((c) => c.verdict === "adjudicated-only").length, uncovered: cats.filter((c) => c.verdict === "uncovered").length, withoutPrimary: cats.filter((c) => c.primaries.length === 0).map((c) => c.id) },
    notes,
  };
}

/** The CLI's and the CI gate's exit rule: non-zero when a category of the taxonomy is uncovered (or, with requirePrimary, has no primary). */
export function coverageExitCode(m: CoverageMatrix, o: { requirePrimary?: boolean } = {}): number {
  if (m.summary.uncovered > 0) return 1;
  if (o.requirePrimary && m.summary.withoutPrimary.length > 0) return 1;
  return 0;
}
