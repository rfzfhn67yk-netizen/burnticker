import { fixtureReadings, type Feed } from "@/lib/burnticker/catalogue";
import { fetchBody, isoDay, parseBody, type HttpSourceConfig } from "@/lib/burnticker/sources/attestedHttp";
import type { FetchLike } from "@/lib/burnticker/oracle/types";
import type { ResolutionSource } from "@/lib/burnticker/sources/types";
import type { SettledEvent } from "@/lib/burnticker/units";
import type { DryRunSummary } from "@/lib/burnticker/coverage/types";
import { expectedPeriods, periodEndMs, scheduleOf } from "@/lib/burnticker/coverage/schedule";
import { compareFact } from "@/lib/burnticker/coverage/sources";

/**
 * THE 90-DAY DRY RUN (2026-10-10, the settlement-coverage audit). For one adapter: how many readings its schedule expected in the
 * window and how many the read produced (hit rate), the median latency between a period ending and its first sighting, and how often
 * the primary and an independent cross-read of the same fact disagreed. Through the same parser the keeper runs (parseBody).
 *
 *   offline  the source's frozen fixture (config/burnticker/fixtures); the window ends at the fixture's fetch time, so the result does
 *            not move with the wall clock; a fixture holds what ONE read returns (NOAA: 7 days), and expected periods before the first
 *            observable one are not counted as misses (the summary says so)
 *   live     one polite fetch per source (fetchBody: the source's own headers, a 20 s timeout, keys refused) at the wall clock
 *
 * Latency needs first-sighting times, which no single read carries: pass `observations` (the registry's readings rows: event id +
 * fetchedAt) or the summary reports n/a with the reason. Adapters without a schedule (snapshots, event-driven counts, on-chain facts,
 * market venues) report n/a honestly rather than a made-up rate.
 */

export interface DryRunOptions {
  mode?: "offline" | "live";
  /** The wall clock for live reads (default Date.now()); offline windows end at the fixture's fetch time. */
  now?: number;
  root?: string;
  fetchImpl?: FetchLike;
  /** Independent cross-reads of the same fact (the matrix supplies them); the first that reads is compared. */
  crossReads?: Feed[];
  /** First sightings of this source's readings (registry readings: { id, fetchedAt }). */
  observations?: { id: string; firstSeenAt: number }[];
}

interface Read { readings: SettledEvent[]; refusals: string[]; readAt: number }

/** One read of a feed in the chosen mode. Throws on a failed fetch or a missing fixture. */
export async function readFeed(feed: Feed, o: Pick<DryRunOptions, "mode" | "now" | "root" | "fetchImpl"> = {}): Promise<Read> {
  if ((o.mode ?? "offline") === "offline") {
    if (!feed.fixturePath) throw new Error(`${feed.id}: no fixture`);
    const r = fixtureReadings(feed, o.now ?? Date.now(), o.root);
    const at = r.fetchedAt ? Date.parse(r.fetchedAt) : (o.now ?? Date.now());
    return { readings: r.readings, refusals: r.refusals, readAt: at };
  }
  const now = o.now ?? Date.now();
  const body = await fetchBody(feed.config, now, o.fetchImpl ?? (fetch as unknown as FetchLike));
  const r = parseBody(feed.config, body, now);
  return { readings: r.readings, refusals: r.refusals, readAt: now };
}

const median = (xs: number[]): number | null => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const round = (x: number | null, d = 3): number | null => (x === null ? null : Math.round(x * 10 ** d) / 10 ** d);

function naSummary(id: string, windowDays: number, mode: "offline" | "live", basis: string, error: string | null = null, at = Date.now()): DryRunSummary {
  return { sourceId: id, windowDays, from: isoDay(at - windowDays * 86_400_000), to: isoDay(at), mode, schedule: { kind: "none", basis }, expected: null, produced: 0, hits: null, hitRate: null, missing: [],
    latency: { medianHours: null, samples: 0, basis: "n/a" }, crossRead: { id: null, compared: 0, disagreements: 0, disagreementRate: null, basis: "n/a", examples: [] }, refusals: [], error };
}

export async function historicalDryRun(adapter: ResolutionSource & { config?: HttpSourceConfig; fixturePath?: string | null }, windowDays = 90, opts: DryRunOptions = {}): Promise<DryRunSummary> {
  const mode = opts.mode ?? "offline";
  const cfg = adapter.config;
  if (!cfg || adapter.kind !== "attested-http") {
    const basis = adapter.kind === "onchain" ? "on-chain fact: one consensus value per UTC day, no publication schedule" : adapter.kind === "market" ? "a market venue: each market settles on its own date, no source schedule" : "no schedule concept for this adapter";
    return naSummary(adapter.id, windowDays, mode, basis);
  }
  const feed = adapter as Feed;
  let primary: Read;
  try { primary = await readFeed(feed, opts); } catch (e) { return naSummary(adapter.id, windowDays, mode, scheduleOf(cfg).basis, (e as Error).message.slice(0, 200)); }
  const asOf = primary.readAt, from = asOf - windowDays * 86_400_000;
  const sched = scheduleOf(cfg);
  const inWindow = (p: string) => { const end = periodEndMs(p); return end !== null && end > from && end <= asOf + 86_400_000; };
  const readingsIn = primary.readings.filter((r) => inWindow(r.id));
  const ids = new Set(primary.readings.map((r) => r.id));
  const firstObservable = primary.readings[0]?.id ?? null;
  let expected: string[] | null = null, basis = sched.basis;
  if (sched.kind !== "none") {
    const all = expectedPeriods(cfg, from, asOf);
    expected = expectedPeriods(cfg, from, asOf, firstObservable);
    if (expected.length < all.length) basis += `; one read starts at ${firstObservable}, so ${all.length - expected.length} earlier expected period(s) are not observable here (the keeper's readings table holds the history)`;
  }
  const hits = expected ? expected.filter((p) => ids.has(p)).length : null;
  // Latency: first sighting − period end, from the observations given.
  const lat = (opts.observations ?? []).filter((o) => inWindow(o.id)).map((o) => { const end = periodEndMs(o.id); return end === null ? null : (o.firstSeenAt - end) / 3_600_000; }).filter((x): x is number => x !== null && x >= 0);
  const latency = sched.kind === "none" && cfg.select.snapshot
    ? { medianHours: null, samples: 0, basis: "snapshot: the value is read at poll time, there is no publication to be late" }
    : lat.length ? { medianHours: round(median(lat), 2), samples: lat.length, basis: "first sighting by the keeper (registry readings.fetchedAt) minus the end of the period" }
    : { medianHours: null, samples: 0, basis: "no first-sighting log for this source on this host: one read carries one fetch time, not a history (the keeper's readings table records it once a token reads this source)" };
  // Cross-read.
  let crossRead: DryRunSummary["crossRead"] = { id: null, compared: 0, disagreements: 0, disagreementRate: null, basis: cfg.fact ? "no independent cross-read of this fact" : "no fact declared, so no cross-read can be paired", examples: [] };
  for (const c of opts.crossReads ?? []) {
    let cr: Read;
    try { cr = await readFeed(c, opts); } catch (e) { crossRead = { ...crossRead, id: c.id, basis: `cross-read ${c.id} unreadable: ${(e as Error).message.slice(0, 120)}` }; continue; }
    const cmp = compareFact(cfg.fact!, primary.readings, c.config.fact!, cr.readings, { primaryReadAt: primary.readAt, crossReadAt: cr.readAt });
    const inW = cmp.comparisons.filter((x) => inWindow(x.period));
    const bad = inW.filter((x) => !x.agree);
    crossRead = { id: c.id, compared: inW.length, disagreements: bad.length, disagreementRate: inW.length ? round(bad.length / inW.length, 4) : null, basis: inW.length ? `${cmp.basis}; ${inW.length} period(s) in the window` : `${cmp.basis}; 0 comparable periods in the window`, examples: [...bad, ...inW.filter((x) => x.agree).slice(-1)].slice(0, 3).map(({ period, primary: p, crossRead: q }) => ({ period, primary: p, crossRead: q })) };
    break;
  }
  return {
    sourceId: adapter.id, windowDays, from: isoDay(from), to: isoDay(asOf), mode, schedule: { kind: sched.kind, basis },
    expected: expected ? expected.length : null, produced: readingsIn.length, hits, hitRate: expected && expected.length ? round(hits! / expected.length, 4) : null,
    missing: expected ? expected.filter((p) => !ids.has(p)).slice(0, 10) : [], latency, crossRead, refusals: primary.refusals.slice(0, 5), error: null,
  };
}
