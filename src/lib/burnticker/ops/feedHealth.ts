import type { Registry, FeedState } from "@/lib/burnticker/registry";
import type { CycleReport } from "@/lib/burnticker/multiKeeper";
import { feedById } from "@/lib/burnticker/catalogue";
import type { AlertSink } from "@/lib/burnticker/alerts";

/**
 * FEED HEALTH FOR THE STATUS PAGE AND THE OUTAGE DRILL (trust-ops items 2 + 6, 2026-10-10 night). Three ways a source can fail
 * without the keeper ever burning on a wrong number — each one WITHHOLDS the reading (no reading, no receipt, no crank) and is shown:
 *
 *   down      the read itself fails (HTTP error, parse error, timeout): feed_state.failures counts it and the keeper backs off.
 *   disagree  the read worked but the adapter's independent cross-read disagreed on the same fact (NWS vs the Iowa Mesonet, a game's
 *             payout vs the licensed final, …): the adapter refuses the reading with a "disagree" / "≠" refusal and holds the day.
 *   stale     the read works but the source has published nothing new for longer than its cadence allows (a feed whose newest
 *             complete period is far behind). Event-driven selectors (markets, games) have no expected cadence and are never "stale".
 *
 * The keeper does not store adapter refusals (the alert check sees only the last cycle's), so this module keeps a small per-key
 * observation in the registry's status table (`ops.feedObservations`, key/value — not part of the append-only ledger): when the
 * last disagreement was seen and the last read that came back clean. Alerts: `bt-feed-down` (≥ FEED_DOWN_FAILURES failures in a
 * row), `bt-feed-disagree`, `bt-feed-stale` — once per key per Denver day through the keeper's sink. The existing `bt-feed-stall`
 * (a key the keeper is not even trying) stays in alerts.ts.
 */

export const FEED_OBS_KEY = "ops.feedObservations";
export const FEED_DOWN_FAILURES = 3;
const DAY = 86_400_000;

/** withheld: the read worked but the adapter held the readings for another reason (its cross-read could not be read, a value is not final). */
export type FeedHealthState = "ok" | "down" | "disagree" | "withheld" | "stale" | "never-read";
export interface FeedObservation { lastCleanAt: number | null; lastDisagreeAt: number | null; lastDisagreeText: string | null; lastWithheldAt: number | null; lastWithheldText: string | null }
export interface FeedHealth {
  selectorKey: string; tickers: string[]; state: FeedHealthState; why: string;
  lastOkAt: number | null; lastFetchAt: number | null; failures: number; lastError: string | null;
  crossRead: { agreement: boolean | null; basis: string; lastDisagreeAt: number | null };
  staleness: { lastReadingId: string | null; lastReadingAt: string | null; ageMs: number | null; limitMs: number | null; stale: boolean };
}

/** A refusal that says the primary and its cross-read disagreed (the adapters' wording: "disagree", "≠", "… apart"). */
export const isDisagreement = (s: string): boolean => /disagree|≠|\bapart\)/i.test(s);
/** A refusal that withheld a reading for another reason ("held": one operator only, not final, implausible). */
export const isWithheld = (s: string): boolean => /\bheld\b|withheld|awaiting/i.test(s);

/** Strip anything that looks like a credential or a query string from text shown on a public page. */
export function publicText(s: string | null, max = 160): string | null {
  if (s === null) return null;
  return s.replace(/https?:\/\/[^\s"')]+/g, (u) => { try { const x = new URL(u); return `${x.protocol}//${x.host}${x.pathname}`; } catch { return "<url>"; } })
    .replace(/\b(api[_-]?key|token|secret|apikey|key)=\S+/gi, "$1=<redacted>").slice(0, max);
}

export function readObservations(reg: Pick<Registry, "getStatus">): Record<string, FeedObservation> {
  try { const s = reg.getStatus(FEED_OBS_KEY); return s ? (JSON.parse(s) as Record<string, FeedObservation>) : {}; } catch { return {}; }
}

/** Folds one cycle's fetch reports into the observations (call after every runCycle). */
export function observeCycle(reg: Pick<Registry, "getStatus" | "setStatus">, report: Pick<CycleReport, "fetched">, now: number): Record<string, FeedObservation> {
  const obs = readObservations(reg);
  for (const f of report.fetched) {
    if (f.skipped || f.error) continue;
    const o: FeedObservation = obs[f.key] ?? { lastCleanAt: null, lastDisagreeAt: null, lastDisagreeText: null, lastWithheldAt: null, lastWithheldText: null };
    const dis = f.refusals.filter(isDisagreement);
    const held = f.refusals.filter((r) => !isDisagreement(r) && isWithheld(r));
    if (dis.length) { o.lastDisagreeAt = now; o.lastDisagreeText = publicText(dis[0]); }
    else if (held.length) { o.lastWithheldAt = now; o.lastWithheldText = publicText(held[0]); }
    else o.lastCleanAt = now;
    obs[f.key] = o;
  }
  reg.setStatus(FEED_OBS_KEY, obs, now);
  return obs;
}

/** The start of a period string ("2026-10-08", "2026-08", "2026-W41", "2026-Q3") in ms, or of an ISO time; null when unreadable. */
export function periodStartMs(p: string): number | null {
  let m: RegExpExecArray | null;
  if ((m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(p))) return Date.UTC(+m[1], +m[2] - 1, +m[3]);
  if ((m = /^(\d{4})-(\d{2})$/.exec(p))) return Date.UTC(+m[1], +m[2] - 1, 1);
  if ((m = /^(\d{4})-Q([1-4])$/.exec(p))) return Date.UTC(+m[1], (+m[2] - 1) * 3, 1);
  if ((m = /^(\d{4})-W(\d{2})$/.exec(p))) { const jan4 = Date.UTC(+m[1], 0, 4); const dow = (new Date(jan4).getUTCDay() + 6) % 7; return jan4 - dow * DAY + (+m[2] - 1) * 7 * DAY; }
  const t = Date.parse(p);
  return Number.isNaN(t) ? null : t;
}

/**
 * How old a selector's newest reading may get before the source counts as STALE, or null when the selector is event-driven (a
 * market, a game, a derby window — nothing is expected on a schedule). Catalogue feeds: by period kind, generous enough for release
 * lags (a monthly CPI-style series reads a month ~6 weeks late), plus the feed's completeAfterDays; an irregular day feed (zeroFill
 * false) has no schedule. NWS daily climate: 4 days.
 */
export function staleLimitMs(selectorKey: string, root = process.cwd()): number | null {
  if (!selectorKey.startsWith("catalogue:")) return null;
  const id = selectorKey.slice("catalogue:".length);
  if (/^nws\./.test(id)) return 4 * DAY;
  let feed: ReturnType<typeof feedById> = null;
  try { feed = feedById(id, {}, root); } catch { feed = null; }
  const p = feed?.config?.period;
  if (!p) return null;
  if (p.kind === "day" && p.zeroFill === false) return null;
  const base = p.kind === "day" ? 5 : p.kind === "week" ? 21 : p.kind === "month" ? 100 : 200;
  return (base + (p.completeAfterDays ?? 0)) * DAY;
}

/** Every selector key in use (live tokens, and coins still winding down) with its health. */
export function computeFeedHealth(reg: Pick<Registry, "tokens" | "feedState" | "lastReading" | "getStatus" | "ruleEnd">, now: number, o: { staleLimit?: (key: string) => number | null } = {}): FeedHealth[] {
  const obs = readObservations(reg);
  const byKey = new Map<string, { tickers: string[]; liveSince: number }>();
  for (const t of reg.tokens()) {
    if (t.status !== "live" || reg.ruleEnd(t.mint)) continue;
    const e = byKey.get(t.selectorKey) ?? { tickers: [], liveSince: Infinity };
    e.tickers.push(t.ticker); e.liveSince = Math.min(e.liveSince, Math.max(t.createdAt, Date.parse(t.baselineAt) || 0));
    byKey.set(t.selectorKey, e);
  }
  const out: FeedHealth[] = [];
  for (const [key, e] of [...byKey].sort((a, b) => a[0].localeCompare(b[0]))) {
    const fs: FeedState = reg.feedState(key);
    const ob = obs[key] ?? null;
    const last = reg.lastReading(key);
    const limit = (o.staleLimit ?? staleLimitMs)(key);
    const lastAt = last ? periodStartMs(last.at) : null;
    const age = lastAt !== null ? now - lastAt : null;
    const stale = limit !== null && (age !== null ? age > limit : now - e.liveSince > limit);
    const newer = (a: number | null | undefined, ...bs: (number | null | undefined)[]) => !!a && bs.every((b) => !b || a > b);
    const disagreeing = newer(ob?.lastDisagreeAt, ob?.lastCleanAt, ob?.lastWithheldAt);
    const withheld = !disagreeing && newer(ob?.lastWithheldAt, ob?.lastCleanAt);
    const agreement = fs.lastOkAt === null || withheld ? null : disagreeing ? false : ob?.lastCleanAt ? true : null;
    let state: FeedHealthState, why: string;
    if (fs.failures > 0 && (fs.lastOkAt === null || (fs.lastFetchAt ?? 0) > fs.lastOkAt)) { state = "down"; why = `The last ${fs.failures === 1 ? "read" : `${fs.failures} reads`} failed.${fs.lastError ? ` The error was: ${publicText(fs.lastError, 120)}` : ""}`; }
    else if (fs.lastOkAt === null && fs.lastFetchAt === null) { state = "never-read"; why = "It has not been read yet."; }
    else if (disagreeing) { state = "disagree"; why = ob?.lastDisagreeText ?? "The second source disagreed, so the reading is held back."; }
    else if (withheld) { state = "withheld"; why = ob?.lastWithheldText ?? "The readings are held because the second source gave no result."; }
    else if (stale) { state = "stale"; const days = (n: number): string => `${n} ${n === 1 ? "day" : "days"}`;
      why = last ? `The newest reading, ${last.id}, is ${days(Math.round((age ?? 0) / DAY))} old. The limit is ${days(Math.round(limit! / DAY))}.` : `There has been no reading in ${days(Math.round((now - e.liveSince) / DAY))}. The limit is ${days(Math.round(limit! / DAY))}.`; }
    else { state = "ok"; why = fs.lastOkAt ? "It was read cleanly." : "No reading yet."; }
    out.push({
      selectorKey: key, tickers: e.tickers.sort(), state, why, lastOkAt: fs.lastOkAt, lastFetchAt: fs.lastFetchAt, failures: fs.failures, lastError: publicText(fs.lastError, 120),
      crossRead: { agreement, basis: agreement === null ? (fs.lastOkAt === null ? "No read has worked yet." : withheld ? "The last read was held back because the second source could not be read or was not final." : "No result from a second source is recorded for this feed.") : agreement ? "The second source did not disagree with the last read." : "The second source disagreed with the last read, so it was held back.", lastDisagreeAt: ob?.lastDisagreeAt ?? null },
      staleness: { lastReadingId: last?.id ?? null, lastReadingAt: last?.at ?? null, ageMs: age, limitMs: limit, stale },
    });
  }
  return out;
}

export interface FeedAlert { kind: "bt-feed-down" | "bt-feed-disagree" | "bt-feed-stale"; key: string; text: string; meta: Record<string, unknown> }

/** PURE: the alerts the feed health warrants (the sink dedupes per key per Denver day). Paused keepers still alert: a source outage is not a keeper choice. */
export function feedAlerts(health: readonly FeedHealth[]): FeedAlert[] {
  const out: FeedAlert[] = [];
  for (const h of health) {
    const who = `${h.selectorKey} (${h.tickers.map((t) => `$${t}`).join(", ")})`;
    if (h.state === "down" && h.failures >= FEED_DOWN_FAILURES) out.push({ kind: "bt-feed-down", key: `bt-feed-down:${h.selectorKey}`, text: `Burnticker source ${who} is DOWN. ${h.why} Readings are held back until it answers, and nothing burns on a guess.`, meta: { selectorKey: h.selectorKey, failures: h.failures } });
    if (h.state === "disagree") out.push({ kind: "bt-feed-disagree", key: `bt-feed-disagree:${h.selectorKey}`, text: `The second source for Burnticker feed ${who} DISAGREES. ${h.why} The reading is held back, and nothing burns until the two sources agree.`, meta: { selectorKey: h.selectorKey } });
    if (h.state === "stale") out.push({ kind: "bt-feed-stale", key: `bt-feed-stale:${h.selectorKey}`, text: `Burnticker source ${who} is STALE. ${h.why} No new reading means no burn. Check the source by hand.`, meta: { selectorKey: h.selectorKey, ageMs: h.staleness.ageMs, limitMs: h.staleness.limitMs } });
  }
  return out;
}

/** Raises the feed alerts through the keeper's sink; returns those that were new (not deduped). Never throws. */
export async function raiseFeedAlerts(health: readonly FeedHealth[], sink: AlertSink, now: number): Promise<FeedAlert[]> {
  const raised: FeedAlert[] = [];
  for (const a of feedAlerts(health)) { try { if (await sink(a.kind, a.key, a.text, a.meta, now)) raised.push(a); } catch { /* the channel failing never stops the keeper */ } }
  return raised;
}

/**
 * HB-29 follow-up (hourly run 6): THE OUTAGE'S END IS RECORDED TOO. bt-feed-down said a source went down and nothing said it came back,
 * so ops.json showed the outage with no end. While a source is down this keeps its outage in the status table (`ops.feedOutages`: when
 * the last clean read before it was, and the most failures seen in a row); on the first health check that finds it answering again it
 * returns one recovery, with the failure count and how long it was out (from the last clean read before the outage to the first one
 * after), and forgets the outage. The caller records it as `bt-feed-recovered` in the same alert table; that kind has no push mapping
 * (push.ts PUSH_KIND_OF_ALERT), so it is information on ops.json, never an alarm. Never throws.
 */
export const FEED_OUTAGE_KEY = "ops.feedOutages";
export const FEED_RECOVERED_KIND = "bt-feed-recovered";
export interface FeedOutage { since: number; failures: number }
export interface FeedRecovery { kind: typeof FEED_RECOVERED_KIND; key: string; selectorKey: string; text: string; meta: { selectorKey: string; failures: number; since: number; recoveredAt: number; durationMs: number } }

/** "2 h 31 min", "45 min", "under a minute". */
export function outageDuration(ms: number): string {
  const min = Math.floor(Math.max(0, ms) / 60_000);
  if (min < 1) return "under a minute";
  const h = Math.floor(min / 60), m = min % 60;
  return h === 0 ? `${m} min` : m === 0 ? `${h} h` : `${h} h ${m} min`;
}

export function noteFeedRecoveries(reg: Pick<Registry, "getStatus" | "setStatus">, health: readonly FeedHealth[], now: number): FeedRecovery[] {
  let outages: Record<string, FeedOutage> = {};
  try { const s = reg.getStatus(FEED_OUTAGE_KEY); outages = s ? (JSON.parse(s) as Record<string, FeedOutage>) : {}; } catch { outages = {}; }
  const out: FeedRecovery[] = [];
  let changed = false;
  for (const h of health) {
    const o = outages[h.selectorKey];
    if (h.state === "down" && h.failures >= FEED_DOWN_FAILURES) {
      const since = o?.since ?? h.lastOkAt ?? h.lastFetchAt ?? now;
      const failures = Math.max(o?.failures ?? 0, h.failures);
      if (!o || o.since !== since || o.failures !== failures) { outages[h.selectorKey] = { since, failures }; changed = true; }
      continue;
    }
    if (!o || h.state === "down") continue;
    // answering again: a clean read after the outage began (a source that only left the live set is forgotten without a row)
    if (h.lastOkAt !== null && h.lastOkAt > o.since) {
      const who = `${h.selectorKey} (${h.tickers.map((t) => `$${t}`).join(", ")})`;
      const durationMs = h.lastOkAt - o.since;
      out.push({
        kind: FEED_RECOVERED_KIND, key: `${FEED_RECOVERED_KIND}:${h.selectorKey}:${h.lastOkAt}`, selectorKey: h.selectorKey,
        text: `Burnticker source ${who} answers again after ${o.failures} failed reads in a row. It was out for ${outageDuration(durationMs)}, from the last clean read before the failures to the first one after them.`,
        meta: { selectorKey: h.selectorKey, failures: o.failures, since: o.since, recoveredAt: h.lastOkAt, durationMs },
      });
    }
    delete outages[h.selectorKey]; changed = true;
  }
  // a source no longer in the health list (its coin ended) drops its outage too
  const keys = new Set(health.map((h) => h.selectorKey));
  for (const k of Object.keys(outages)) if (!keys.has(k)) { delete outages[k]; changed = true; }
  if (changed) { try { reg.setStatus(FEED_OUTAGE_KEY, outages, now); } catch { /* the next check tries again */ } }
  return out;
}
