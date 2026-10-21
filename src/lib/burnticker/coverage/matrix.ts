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
  { id: "scalar", label: "a settled number each period, read from a primary feed. Kalshi's strike ladders, such as index closes and daily highs, used to count here too.", wizard: "Advanced, with our own feed", appliesTo: "all" },
  { id: "series-binary", label: "every yes-or-no market under a tag or an event, again and again", wizard: "Any market, using a Polymarket tag or event", appliesTo: "all" },
  { id: "one-shot", label: "one market that resolves once", wizard: "Any market, using one market", appliesTo: "all" },
  { id: "team-coin", label: "every game of one team", wizard: "Team coin", appliesTo: ["sports"] },
  { id: "matchup-game", label: "two coins on one game, using one market with the opposite result for side B", wizard: "Matchup pair, for this game only", appliesTo: ["sports"] },
  { id: "matchup-season", label: "two coins, each on its own team's games", wizard: "Matchup pair, for every game this season", appliesTo: ["sports"] },
];

/** The per-game result fact the sports sources and their league cross-reads share (config/burnticker/sources.json, kind native). */
export const SPORTS_FACT = "sports.game.final-score";

export const SETTLEMENT_RULE = "A coin settles on a primary source, checked by an independent second source for the same fact. The second source must be run by another operator on another domain. A coin can also settle on an adjudicated Polymarket market, read from its on-chain payout on Polygon. Prediction markets help people find events, and they can serve as an extra check where their terms allow it. Kalshi's terms allow neither use, so Kalshi is never an input.";

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
      if (pairs.length) { const seen = new Set<string>(); const shown = pairs.filter((x) => { const k = [x.primary, x.crossRead].sort().join("|"); return seen.has(k) ? false : (seen.add(k), true); }); return row("settleable", `A primary source is checked by an independent second source. The pairs are ${shown.map((x) => `${x.primary} with ${x.crossRead}`).join(", ")}.`, true); }
      // the owner's single-publisher exception (singleSource.ts, 2026-10-12): the natural-disaster feeds settle on their own publisher
      const single = primaries.filter((p) => p.singleSource);
      if (single.length) return { ...row("settleable", `By the owner's decision of 2026-10-12, these settle on their publisher's own published data, a single official source, with no second source: ${single.map((p) => p.id).join(", ")}. A day the feed is unavailable is held, not counted.`), primaries: single.map((p) => p.id) };
      if (primaries.length) return { ...row("uncovered", `${prim.length === 1 ? "This primary source has" : "These primary sources have"} no independent second source for the same fact: ${prim.join(", ")}. Polymarket has only yes-or-no markets, so it cannot settle a number either.`), primaries: prim };
      return row("uncovered", "No primary source fits this category. Polymarket has only yes-or-no markets, so it cannot settle a number either.");
    }
    case "series-binary":
    case "one-shot":
      return polyOk ? row("adjudicated-only", `The result comes from the on-chain payout on Polygon for the Polymarket ${tags.length === 1 ? "tag" : "tags"} ${tags.join(", ")}. No primary source here gives a yes-or-no result.`) : row("uncovered", poly ? "No Polymarket tag fits this category, and no primary source here gives a yes-or-no result." : "Polymarket is not available on this site, and no primary source here gives a yes-or-no result.");
    case "matchup-game":
      if (pairs.some((x) => x.fact === SPORTS_FACT)) return row("settleable", "Two coins follow one game, one for each team. The game settles on the first final score read (TheSportsDB, or the league's own feed or API-Sports), and on its on-chain settlement where Polymarket lists a moneyline market and no score source answers. Both coins burn once the official feed has marked the game final and a second check five minutes later agrees. Every source that reads the game must agree, and a disagreement holds the burn until they do.", true);
      return polyOk ? row("adjudicated-only", "Both coins follow one Polymarket moneyline market, with side B taking the opposite result. Every result burns exactly one side.") : row("uncovered", "This site has no Polymarket game markets.");
    case "team-coin":
      if (pairs.some((x) => x.fact === SPORTS_FACT)) return row("settleable", `Nothing is read from ESPN. The schedule comes from the league's own feed for MLB and NHL, from the NBA's feed when it answers and otherwise TheSportsDB for the NBA, and from TheSportsDB with a licensed key for other leagues. Each game settles on its on-chain payout where a Polymarket moneyline market exists, and on TheSportsDB's final score otherwise. Every source that reads it must agree, and a game only TheSportsDB can read counts once its final score has stood for 12 hours. The on-chain payout and TheSportsDB confirm each other, the league's official feed is read where it is free and answers, and API-Sports is optional. Each league is listed below.`, true);
      return row("uncovered", "The only way was the team's own market in a Kalshi game series. Polymarket moneylines have no fixed YES or NO for each team, because the team order changes from game to game. The ESPN NFL feed counts only final scores and is not allowed.");
    case "matchup-season":
      if (pairs.some((x) => x.fact === SPORTS_FACT)) return row("settleable", "Two team coins follow their own teams. Each game settles on its on-chain payout or on TheSportsDB's final score. Every source that reads it must agree, and a game only TheSportsDB can read counts once its final score has stood for 12 hours.", true);
      return row("uncovered", "Two team coins, each following its own team's games, cannot settle today for the same reason as team coins.");
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
      : verdict === "adjudicated-only" ? `${primaries.length ? `${primaries.length === 1 ? "The primary source" : "The primary sources"} ${primaries.map((p) => p.id).join(", ")} ${primaries.length === 1 ? "has" : "have"} no independent second source.` : "No primary source fits here."} Polymarket covers yes-or-no markets under ${tags.join(", ")}.`
      : `${primaries.length ? `${primaries.length === 1 ? "The primary source" : "The primary sources"} ${primaries.map((p) => p.id).join(", ")} ${primaries.length === 1 ? "has" : "have"} no independent second source.` : "No primary source fits here."} No Polymarket tag fits either.`;
    return { id: c.id, label: c.label, verdict, why, primaries: primaries.map((s) => ref(s, dryRuns)), crossReads, notPrimary, unknownFeeds, polymarket: { tags, available: poly }, kalshiDiscoveryOnly: [...c.kalshi], kinds };
  });
  const uncovered = cats.flatMap((c) => c.kinds.filter((k) => k.verdict === "uncovered").map((k) => ({ category: c.id, kind: k.kind, why: k.why })));
  const notes = [...(opts.notes ?? [])];
  if (missingTags.size) notes.push(`Gamma did not recognise these Polymarket tags, so they were left out: ${[...missingTags].join(", ")}.`);
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
