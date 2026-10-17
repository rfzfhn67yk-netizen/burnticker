import type { FinalAfter, StatedSource } from "@/lib/burnticker/sources/polyStated";
import type { BurnRule } from "@/lib/burnticker/rules";
import type { SettledEvent } from "@/lib/burnticker/units";

/**
 * AN ORACLE ADAPTER (2026-10-09): where settled outcomes come from. v1 ships Kalshi in full and a Polymarket stub (interface + parser
 * + fixture); the first-party feed catalogue is wrapped by the same shape in catalogue/index.ts so the keeper loops over one list.
 *
 * The contract every adapter keeps: SETTLED RESULTS ONLY. `settledSince` returns only outcomes the venue has finalised; prices are
 * exposed separately (`impliedChance`) for display and are never an input to a rule.
 */

export interface SeriesSummary {
  /** The adapter that answers for it: "kalshi", "polymarket", "catalogue" (any configured source id), "solana.blockHeight", … */
  oracle: string;
  ticker: string;
  title: string;
  category: string | null;
  frequency: string | null;
  /** The venue's named settlement source (name + URL), when it publishes one. */
  settlementSource: { name: string; url: string } | null;
  tags: string[];
  /** sources-2: a one-market Polymarket selector's stated source and dispute window (oracle/polymarket.ts polyStated). Display only. */
  stated?: { resolutionSource: StatedSource; finalAfter: FinalAfter };
  /** QA pass 9 #17: a one-market selector's end date (Gamma endDate), for the review's due-soon warning. Display only. */
  endsAt?: string | null;
}

export interface OpenMarketSummary { ticker: string; title: string; closeTime: string | null; yesPrice: number | null; strikeType: string | null; floorStrike: number | null; capStrike: number | null }

export interface ResolvedSelector {
  events: SettledEvent[];
  /** Markets settled but inside the venue's finalisation window: read next cycle, never now. */
  awaitingFinal: number;
  refusals: string[];
  /** The settlement-source URL recorded with every reading (the series' first settlement source, else the venue's market URL). */
  settlementSourceUrl: string | null;
  /** A first-party series with a window (ESPN team coins): where the window stands — open, ended, its end. The rules-core wind-down
   *  (onEnd) reads `ended`; a perpetual window never ends. */
  /** A game coin waiting for its scheduled burn (gameSettle.ts gameSchedule): the earliest time a waiting reading falls due, so the keeper
   *  reads again then rather than up to a poll later. */
  dueAt?: number | null;
  window?: { perpetual: boolean; ended: boolean; endsAt: string | null; reason: string; lastGame?: unknown; /** website-18: an ended season window's champion verdict (espn.ts championOf) and the day it was read from */ champion?: boolean | null; championDate?: string | null; /** a rivalry series (espn.ts window `meetings`) that ended: its season-end reading's day (null when level) */ series?: { endDay: string | null } | null };
}

export interface ImpliedChance { chance: number | null; marketTicker: string | null; closeTime: string | null; basis: string }

export type FetchLike = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text?(): Promise<string> }>;

export interface OracleAdapter {
  /** "kalshi", "polymarket", "catalogue", or a source id (the sources layer implements this same shape per source). */
  id: string;
  searchSeries(query: string, opts?: { category?: string; limit?: number }): Promise<SeriesSummary[]>;
  seriesInfo(ticker: string): Promise<SeriesSummary | null>;
  /** Every settled outcome the rule's selector binds to, settled strictly after `sinceIso` (null = all the venue returns). */
  settledSince(rule: BurnRule, sinceIso: string | null, opts?: { limitPages?: number }): Promise<ResolvedSelector>;
  /** The next unsettled market(s) the selector will bind to, with their current YES price — DISPLAY ONLY. */
  impliedChance(rule: BurnRule, prevValue: string | null): Promise<ImpliedChance>;
}
