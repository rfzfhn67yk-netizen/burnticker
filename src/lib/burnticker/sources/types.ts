import type { OracleAdapter } from "@/lib/burnticker/oracle/types";
import type { Direction } from "@/lib/burnticker/rules";
import type { CarryPolicy } from "@/lib/burnticker/units";

/**
 * ONE INTERFACE FOR EVERY WAY A FACT CAN BE RESOLVED (the owner, 2026-10-09: the event net as broad as possible; adding a source is
 * config, not code). Four KINDS:
 *   market         adjudicated prediction markets (Kalshi; Polymarket via Gamma + the CTF payout vector; Solana venues as stubs)
 *   assertion      optimistic oracles (UMA OO v3 assertion status; read-only stub)
 *   attested-http  a primary API or page defined ENTIRELY by config — url, method, selection (JSON path / CSV / regex), period, unit,
 *                  plausibility, carry, schedule — read by our keeper today, by a Switchboard On-Demand job (same URL + path) later
 *   onchain        facts read directly from Solana accounts / RPC (block height); never an indexer
 *
 * TIER (shown on every card and token page; admission rules per tier in the README):
 *   1 adjudicated market · 2 optimistic assertion · 3 TEE-or-zk-attested primary API · 4 keeper-read primary API · 5 page-scraped.
 * The token's own price is excluded everywhere; third-party asset prices are admitted only through tiers 1–3.
 */

export type SourceKind = "market" | "assertion" | "attested-http" | "onchain";
export type Tier = 1 | 2 | 3 | 4 | 5;
export const TIER_LABEL: Record<Tier, string> = { 1: "adjudicated market", 2: "optimistic assertion", 3: "attested primary API (TEE/zk)", 4: "keeper-read primary API", 5: "page-scraped" };

export interface SourceFacts {
  id: string; kind: SourceKind; tier: Tier; title: string; sourceName: string; sourceUrl: string; cadence: string;
  /** Fixed by the source for scalar readings (attested-http / onchain); null for market/assertion sources whose rules pick their own. */
  unit: { size: number; label: string; definition: string } | null; direction: Direction | null; baseline: "previousSettlement" | number | null; carry: CarryPolicy;
  valueLabel: string | null;
  /** "needs-key", "page-scraped", "disaster-adjacent", "unverified", "rate-limited", "economy-indexed" … shown on the card. */
  flags: string[];
  /** Whether a rule may be launched on it today (stubs and key-less-only sources say no, and why). */
  launchable: { ok: boolean; why: string | null };
}

export interface ResolutionSource extends OracleAdapter, SourceFacts {}

/**
 * THE FACT A SOURCE READS (2026-10-10, the settlement-coverage audit). Two sources with the same `id` read the same number; when their
 * operators and domains differ, each is the other's independent CROSS-READ (src/lib/burnticker/coverage). `scale` turns the source's
 * value into the fact's unit (FRED GFDEBTN is in $ millions: 1e6); `align` says how readings meet: "period" (default: the same period
 * id), "quarter-end" (a quarterly reading meets the other source's last daily reading of that quarter), "snapshot" (two poll-time
 * values, comparable only when read within `maxSkewMinutes` of each other). `tolerance`: the larger of the two sides' bounds applies.
 */
export interface FactSpec { id: string; scale?: number; align?: "period" | "quarter-end" | "snapshot"; tolerance?: { rel?: number; abs?: number }; maxSkewMinutes?: number }
