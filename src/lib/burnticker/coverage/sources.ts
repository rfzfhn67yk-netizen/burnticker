import type { HttpSourceConfig } from "@/lib/burnticker/sources/attestedHttp";
import type { CopycatSourceConfig } from "@/lib/burnticker/sources/copycats";
import type { PriceFeedSourceConfig } from "@/lib/burnticker/sources/types";
import type { NativeSourceConfig } from "@/lib/burnticker/catalogue";
import type { SettledEvent } from "@/lib/burnticker/units";
import type { CrossReadPair, Eligibility, FactSpec, SourceDescriptor } from "@/lib/burnticker/coverage/types";
import { isSingleOfficialSource } from "@/lib/burnticker/singleSource";

/**
 * SOURCES FOR THE SETTLEMENT-COVERAGE AUDIT (2026-10-10): normalising every source into one descriptor, the PRIMARY and CROSS-READ
 * eligibility rules, and the fact alignment that compares a primary's readings with a cross-read's. Pure.
 *
 *   primary     kind attested-http or onchain · tier ≤ 4 · launchable · not an aggregator · not declared cross-read-only · never Kalshi
 *   cross-read  the same `fact` id · a different operator AND a different registrable domain · readable without a key · tier ≤ 4 ·
 *               never Kalshi (its terms forbid settlement use and redistribution; a cross-check is part of settling)
 */

/** Kalshi in any guise: id, operator or domain. Never a primary, never a cross-read — whatever sources.json says. */
export function isKalshi(s: Pick<SourceDescriptor, "id" | "operator" | "domain" | "venue">): boolean {
  return s.venue === "kalshi" || /^kalshi\b/i.test(s.id) || /kalshi/i.test(s.operator ?? "") || /(^|\.)kalshi\.com$/i.test(s.domain ?? "");
}

/** The registrable domain of a URL ("https://api.fiscaldata.treasury.gov/…" → "treasury.gov"); templates in the path are fine. */
export function domainOf(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = /^[a-z]+:\/\/([^/?#:]+)/i.exec(url.trim());
  if (!m) return null;
  const host = m[1].toLowerCase().replace(/\.$/, "");
  const parts = host.split(".");
  if (parts.length <= 2) return host;
  // Two-label public suffixes we could meet (none in the config today; kept so a .co.uk source is not merged with every other one).
  const twoLabel = /^(co|com|gov|ac|org|net)\.[a-z]{2}$/.test(parts.slice(-2).join("."));
  return parts.slice(twoLabel ? -3 : -2).join(".");
}

const norm = (s: string | null): string => (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export const CROSS_READ_ONLY_FLAG = /^cross-read only/i;
const AGGREGATOR_FLAG = /\baggregator\b/i;

/** One sources.json entry → a descriptor. */
export function describeEntry(e: HttpSourceConfig | CopycatSourceConfig | NativeSourceConfig | PriceFeedSourceConfig): SourceDescriptor {
  if (e.kind === "price-feed") {
    // Burn Derby's price sources (2026-10-10): read by the derby adapter; snapshot facts at each 00:00 UTC boundary.
    const needsKey = e.needsKey ?? null;
    return { id: e.id, kind: e.kind, tier: e.tier, title: e.title, operator: e.operator, domain: domainOf(e.sourceUrl), fact: e.fact ?? null,
      launchable: e.launchable && !needsKey, launchableWhy: needsKey ? `needs a key: ${needsKey}` : e.launchable ? null : (e.note ?? "not launchable"),
      readable: !needsKey, snapshot: true, flags: e.flags, venue: "feed" };
  }
  // native sources (sources/native.ts: ESPN scoreboard, NWS climate, FEC) are keeper-read primary APIs with their own reader; their
  // descriptor comes straight from the entry (2026-10-10)
  if (e.kind === "native") return { id: e.id, kind: "attested-http", tier: e.tier, title: e.title, operator: e.operator, domain: domainOf(e.sourceUrl), fact: e.fact, launchable: e.launchable, launchableWhy: e.launchable ? null : (e.note ?? "cross-read only"), readable: e.readable, snapshot: false, flags: e.flags, venue: "feed" };
  const http = e.kind === "attested-http" ? (e as HttpSourceConfig) : null;
  const needsKey = http?.needsKey ?? null;
  const operator = (e as { operator?: string }).operator ?? null;
  const url = http ? http.request.url : e.sourceUrl;
  return {
    id: e.id, kind: e.kind, tier: e.tier, title: e.title, operator, domain: domainOf(url), fact: http?.fact ?? null,
    launchable: e.launchable && !needsKey, launchableWhy: needsKey ? `needs a key: ${needsKey}` : e.launchable ? null : (e.note ?? "not launchable"),
    readable: !needsKey && (http ? true : false), snapshot: !!http?.select.snapshot, flags: e.flags, singleSource: http ? isSingleOfficialSource(http) : false, venue: /^kalshi\b/i.test(e.id) ? "kalshi" : e.kind === "onchain" ? "onchain" : "feed",
  };
}

/** A market or stub card (Polymarket, UMA, Drift, Hedgehog; Kalshi) → a descriptor: never a primary. */
export function describeCard(c: { id: string; kind: SourceDescriptor["kind"]; tier: SourceDescriptor["tier"]; title: string; sourceUrl: string; launchable: { ok: boolean; why: string | null }; flags: string[] }): SourceDescriptor {
  const venue: SourceDescriptor["venue"] = c.id === "polymarket" ? "polymarket" : /^kalshi\b/i.test(c.id) ? "kalshi" : "stub";
  return { id: c.id, kind: c.kind, tier: c.tier, title: c.title, operator: venue === "polymarket" ? "Polymarket (Conditional Tokens on Polygon)" : venue === "kalshi" ? "Kalshi" : null, domain: domainOf(c.sourceUrl), fact: null, launchable: c.launchable.ok, launchableWhy: c.launchable.why, readable: false, snapshot: false, flags: c.flags, venue };
}

/** An on-chain fact (sources/onchain.ts) → a descriptor. Read through the host's own RPC; not routable through the launch route yet. */
export function describeOnchain(id: string, title: string): SourceDescriptor {
  return { id, kind: "onchain", tier: 1, title, operator: "the host's Solana RPC provider (BURNTICKER_RPC_URL)", domain: null, fact: null, launchable: false, launchableWhy: "on-chain facts are shown in the catalogue but the launch route does not take them yet (feedById knows attested-http sources only)", readable: false, snapshot: true, flags: ["onchain"], venue: "onchain" };
}

/** Can this source settle a coin on its own reading (given an independent cross-read)? */
export function primaryEligibility(s: SourceDescriptor): Eligibility {
  if (isKalshi(s)) return { ok: false, why: "Kalshi: its Developer Agreement and Data Terms forbid using its API or data to settle products (owner decision 2026-10-10)" };
  if (s.kind === "market" || s.kind === "assertion") return { ok: false, why: s.venue === "polymarket" ? "an adjudicated market: counted as the adjudicated-only path, not as a primary" : "an adjudicated venue or assertion stub, not a primary source" };
  if (s.tier >= 5) return { ok: false, why: "page-scraped (tier 5): never a primary" };
  if (s.flags.some((f) => CROSS_READ_ONLY_FLAG.test(f))) return { ok: false, why: "declared cross-read only" };
  if (s.flags.some((f) => AGGREGATOR_FLAG.test(f))) return { ok: false, why: "an aggregator, not a primary source" };
  if (!s.launchable) return { ok: false, why: `not launchable: ${s.launchableWhy ?? "no reason recorded"}` };
  if (!s.operator) return { ok: false, why: "no operator declared in sources.json" };
  return { ok: true, why: null };
}

/** Can `c` cross-read primary `p`? Same fact, independent operator and domain, readable, never Kalshi. */
export function crossReadEligibility(c: SourceDescriptor, p: SourceDescriptor): Eligibility {
  if (c.id === p.id) return { ok: false, why: "the same source" };
  if (isKalshi(c)) return { ok: false, why: "Kalshi: its terms forbid settlement use and redistribution of its data" };
  if (!c.fact || !p.fact || c.fact.id !== p.fact.id) return { ok: false, why: "reads a different fact" };
  if (!c.readable) return { ok: false, why: "not readable without a key on this host" };
  if (c.tier >= 5) return { ok: false, why: "page-scraped (tier 5)" };
  if (!c.operator || !p.operator) return { ok: false, why: "an operator is not declared" };
  if (norm(c.operator) === norm(p.operator)) return { ok: false, why: `same operator (${c.operator})` };
  if (!c.domain || !p.domain || c.domain === p.domain) return { ok: false, why: `same or unknown domain (${c.domain ?? "?"})` };
  return { ok: true, why: null };
}

/** Every independent cross-read of `p` among `all`. */
export function crossReadsOf(p: SourceDescriptor, all: readonly SourceDescriptor[]): SourceDescriptor[] {
  return all.filter((c) => crossReadEligibility(c, p).ok);
}

export const pairOf = (p: SourceDescriptor, c: SourceDescriptor): CrossReadPair => ({ primary: p.id, crossRead: c.id, fact: p.fact!.id });

// ---- comparing readings of one fact ----

export interface Comparison { period: string; primary: string; crossRead: string; agree: boolean }

const quarterOf = (day: string): string => `${day.slice(0, 4)}-Q${Math.floor((Number(day.slice(5, 7)) - 1) / 3) + 1}`;
const quarterEnd = (q: string): string => { const y = Number(q.slice(0, 4)), n = Number(q.slice(6)); return new Date(Date.UTC(y, n * 3, 0)).toISOString().slice(0, 10); };
const isDay = (p: string) => /^\d{4}-\d{2}-\d{2}$/.test(p);
const isQuarter = (p: string) => /^\d{4}-Q[1-4]$/.test(p);

function within(a: number, b: number, fa: FactSpec, fb: FactSpec): boolean {
  const rel = Math.max(fa.tolerance?.rel ?? 0, fb.tolerance?.rel ?? 0), abs = Math.max(fa.tolerance?.abs ?? 0, fb.tolerance?.abs ?? 0);
  const d = Math.abs(a - b);
  return d <= abs || d <= rel * Math.max(Math.abs(a), Math.abs(b)) || d < 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
}

/**
 * Pairs a primary's readings with a cross-read's on the fact's alignment and says whether each pair agrees. Snapshot facts pair only
 * when both reads happened within `maxSkewMinutes` (`readAt` ms of each side); a quarter-end fact pairs a quarterly reading with the
 * other side's last daily reading of that quarter, and only when the daily series reaches the quarter's last day or beyond.
 */
export function compareFact(pf: FactSpec, pr: readonly SettledEvent[], cf: FactSpec, cr: readonly SettledEvent[], o: { primaryReadAt?: number | null; crossReadAt?: number | null } = {}): { comparisons: Comparison[]; basis: string } {
  const val = (e: SettledEvent, f: FactSpec): number | null => (e.value === null || !Number.isFinite(Number(e.value)) ? null : Number(e.value) * (f.scale ?? 1));
  const out: Comparison[] = [];
  const mk = (period: string, a: SettledEvent, fa: FactSpec, b: SettledEvent, fb: FactSpec, aIsPrimary: boolean): void => {
    const x = val(a, fa), y = val(b, fb);
    if (x === null || y === null) return;
    const [p, c] = aIsPrimary ? [x, y] : [y, x];
    out.push({ period, primary: String(p), crossRead: String(c), agree: within(x, y, fa, fb) });
  };
  const align = pf.align === "snapshot" || cf.align === "snapshot" ? "snapshot" : pf.align === "quarter-end" || cf.align === "quarter-end" ? "quarter-end" : "period";
  if (align === "snapshot") {
    const skew = Math.min(pf.maxSkewMinutes ?? 10, cf.maxSkewMinutes ?? 10);
    if (o.primaryReadAt == null || o.crossReadAt == null) return { comparisons: [], basis: "snapshot fact: the read times are unknown, so the two values cannot be paired" };
    const gapMin = Math.abs(o.primaryReadAt - o.crossReadAt) / 60_000;
    if (gapMin > skew) return { comparisons: [], basis: `snapshot fact: the two reads are ${gapMin >= 120 ? `${(gapMin / 60).toFixed(1)} h` : `${Math.round(gapMin)} min`} apart (pairs only within ${skew} min; the live preflight reads both in the same minute)` };
    const a = pr[pr.length - 1], b = cr[cr.length - 1];
    if (a && b) mk(a.id, a, pf, b, cf, true);
    return { comparisons: out, basis: `snapshot fact: the two latest values, read ${Math.round(gapMin)} min apart, tolerance ${JSON.stringify({ ...cf.tolerance, ...pf.tolerance })}` };
  }
  if (align === "quarter-end") {
    const [q, qf, d, df, qIsPrimary] = pf.align === "quarter-end" ? [pr, pf, cr, cf, true] as const : [cr, cf, pr, pf, false] as const;
    const days = d.filter((e) => isDay(e.id)).sort((a, b) => (a.id < b.id ? -1 : 1));
    for (const r of q.filter((e) => isQuarter(e.id))) {
      const end = quarterEnd(r.id);
      const inQ = days.filter((e) => quarterOf(e.id) === r.id && e.id >= addDaysIso(end, -6));
      const reachesEnd = days.some((e) => e.id >= end);
      if (!inQ.length || !reachesEnd) continue;
      const last = inQ[inQ.length - 1];
      mk(r.id, r, qf, last, df, qIsPrimary);
    }
    return { comparisons: out, basis: "quarter-end: each quarterly reading against the other source's last daily reading of that quarter" };
  }
  const byId = new Map(cr.map((e) => [e.id, e]));
  for (const a of pr) { const b = byId.get(a.id); if (b) mk(a.id, a, pf, b, cf, true); }
  return { comparisons: out, basis: "the same period on both sides" };
}

const addDaysIso = (day: string, n: number): string => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
