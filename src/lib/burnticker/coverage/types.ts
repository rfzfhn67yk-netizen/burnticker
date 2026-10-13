import type { FactSpec, SourceKind, Tier } from "@/lib/burnticker/sources/types";
import type { CategoryDef } from "@/lib/burnticker/browse";

/**
 * THE SETTLEMENT-COVERAGE AUDIT — TYPES (2026-10-10). The owner's decision of 10-10: Kalshi's Developer Agreement and Data Terms
 * forbid using its API or data to settle products, or to cache or redistribute it, so Kalshi is NOT a settlement input. A coin settles
 * on (a) a primary source with an independent cross-read of the same fact, or (b) Polymarket's Conditional Tokens payout vector on
 * Polygon (public chain data) for adjudicated markets. This audit says, per category of config/burnticker/categories.json and per
 * selector kind the wizard can emit, which of the two exists today — and what cannot be settled at all.
 *
 * TIER NUMBERING. In sources/types.ts tier 1 is an adjudicated market, 2 an optimistic assertion, 3–4 a primary API (attested / read
 * by our keeper), 5 a page scrape; kind "onchain" facts are tier 1. A PRIMARY here is a primary-source adapter — kind attested-http or
 * onchain, tier ≤ 4, launchable, not an aggregator, not declared cross-read-only, never Kalshi. Adjudicated venues are not primaries:
 * Polymarket is the separate "adjudicated-only" path; Kalshi counts for nothing.
 */

export type { CategoryDef, FactSpec };

/** The three verdicts. */
export type Verdict = "settleable" | "adjudicated-only" | "uncovered";

/** The selector kinds the wizard can emit (src/app/burnticker/launch + src/lib/burnticker/wizard.ts + the rule schema). */
export type SelectorKindId = "scalar" | "series-binary" | "one-shot" | "team-coin" | "matchup-game" | "matchup-season";
export interface SelectorKind { id: SelectorKindId; label: string; wizard: string; appliesTo: "all" | string[] }

/** A source as the audit sees it: normalised from sources.json, the on-chain facts and the market cards. */
export interface SourceDescriptor {
  id: string; kind: SourceKind; tier: Tier; title: string;
  /** Who runs the endpoint; null = not declared (then it can be neither half of an independent pair). */
  operator: string | null;
  /** The registrable domain of the URL read (api.bls.gov → bls.gov); null when there is none. */
  domain: string | null;
  fact: FactSpec | null;
  launchable: boolean; launchableWhy: string | null;
  /** Readable without a key today (a cross-read must be readable; it need not be launchable). */
  readable: boolean;
  /** Whether a single read returns one poll-time value (no publication schedule). */
  snapshot: boolean;
  flags: string[];
  /** The owner's single-publisher exception (singleSource.ts): settles on this source alone, no cross-read. */
  singleSource?: boolean;
  venue: "feed" | "onchain" | "polymarket" | "kalshi" | "stub";
}

export interface Eligibility { ok: boolean; why: string | null }

export interface CrossReadPair { primary: string; crossRead: string; fact: string }

/** One 90-day dry run's summary as the matrix shows it. */
export interface DryRunSummary {
  sourceId: string; windowDays: number; from: string; to: string; mode: "offline" | "live";
  schedule: { kind: ScheduleKind; basis: string };
  expected: number | null; produced: number; hits: number | null; hitRate: number | null; missing: string[];
  latency: { medianHours: number | null; samples: number; basis: string };
  crossRead: { id: string | null; compared: number; disagreements: number; disagreementRate: number | null; basis: string; examples: { period: string; primary: string; crossRead: string }[] };
  refusals: string[]; error: string | null;
}
export type ScheduleKind = "daily" | "business-days" | "weekly" | "monthly" | "quarterly" | "none";

export interface SourceRef { id: string; title: string; operator: string | null; domain: string | null; tier: Tier; fact: string | null; dryRun: DryRunSummary | null }

export interface KindCoverage { kind: SelectorKindId; verdict: Verdict; why: string; primaries: string[]; crossReads: CrossReadPair[]; polymarketTags: string[] }

export interface CategoryCoverage {
  id: string; label: string; verdict: Verdict; why: string;
  /** Primaries mapped to the category (with or without a cross-read). */
  primaries: SourceRef[];
  /** Independent cross-reads of those primaries (may live outside the category: they read the same fact). */
  crossReads: (SourceRef & { of: string })[];
  /** Feeds the taxonomy maps here that are not primaries, with the reason. */
  notPrimary: { id: string; why: string }[];
  /** Feeds the taxonomy names that no source on this host defines. */
  unknownFeeds: string[];
  polymarket: { tags: string[]; available: boolean };
  /** Kalshi categories the taxonomy maps here: discovery only, never a settlement input. */
  kalshiDiscoveryOnly: string[];
  kinds: KindCoverage[];
}

export interface CoverageMatrix {
  schema: "burnticker.coverage/v1";
  generatedAt: string;
  mode: "offline" | "live";
  taxonomy: { file: string; categories: number };
  rule: string;
  kinds: SelectorKind[];
  categories: CategoryCoverage[];
  /** Every (category, kind) row that is uncovered, in one list (the doc's "What we cannot settle today"). */
  uncovered: { category: string; kind: SelectorKindId; why: string }[];
  /** Sources that can never be a primary or a cross-read, and why (Kalshi first). */
  excluded: { id: string; why: string }[];
  summary: { settleable: number; adjudicatedOnly: number; uncovered: number; withoutPrimary: string[] };
  notes: string[];
}

/** The preflight's answer for one selector (src/lib/burnticker/coverage/preflight.ts). */
export type PreflightCode = "kalshi-not-settlement" | "stub-oracle" | "not-primary" | "primary-unreadable" | "no-readings" | "stale-primary" | "no-cross-read" | "cross-read-unreadable" | "disagreement" | "unknown-selector" | "already-decided";
export interface PreflightReading { id: string; value: string | null; result: string | null; at: string }
export interface PreflightResult {
  ok: boolean;
  oracle: string; selector: string;
  primary: { id: string; operator: string | null; lastReading: PreflightReading | null; error: string | null };
  crossRead: { id: string; operator: string | null; lastReading: PreflightReading | null; error: string | null } | null;
  /** When the next reading is expected (ISO), with how that was worked out; null when the source has no schedule. */
  nextExpectedAt: string | null; nextExpectedBasis: string;
  /** true/false on the latest period both reads cover; null when they share none yet (the cross-read compares at the next one). */
  agreement: boolean | null; agreementBasis: string;
  refusal: { code: PreflightCode; reason: string; status: 400 | 502 } | null;
  checkedAt: string;
}
