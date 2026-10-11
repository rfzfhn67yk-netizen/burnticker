import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openRegistry, type Registry, type TokenRow } from "@/lib/burnticker/registry";
import { FakeBurnProgram } from "@/lib/burnticker/program";
import { buildLaunchBundle, FakeLaunchLab } from "@/lib/burnticker/launchBundle";
import { BURNTICKER_RULES_SCHEMA, lockRule } from "@/lib/burnticker/rules";
import { feedById } from "@/lib/burnticker/catalogue";
import { runCycle, type CycleReport, type KeeperDeps } from "@/lib/burnticker/multiKeeper";
import { registryAlertSink } from "@/lib/burnticker/alerts";
import type { OracleAdapter, ResolvedSelector } from "@/lib/burnticker/oracle/types";
import type { SettledEvent } from "@/lib/burnticker/units";
import { computeFeedHealth, observeCycle, periodStartMs, raiseFeedAlerts, staleLimitMs, type FeedHealth } from "@/lib/burnticker/ops/feedHealth";
import { LeaderLock } from "@/lib/burnticker/ops/leaderLock";
import { buildOpsStatus, readOpsStatus, writeOpsStatus } from "@/lib/burnticker/ops/status";

/**
 * THE SOURCE-OUTAGE DRILL (owner-approved 2026-10-10 night, trust-ops item 6). Runs the keeper's real planning pass (multiKeeper
 * runCycle, against the FakeBurnProgram — nothing leaves the machine) in a SCRATCH registry, with the source wrapped so that it
 *
 *   down      throws on every read (a simulated HTTP 503),
 *   disagree  answers, but its cross-read disagrees: every new reading is refused with the adapters' "≠ … held" wording,
 *   stale     answers, but has published nothing for longer than its cadence allows,
 *
 * and asserts, from the outside, the four things the runbook promises: (1) the reading is WITHHELD (no reading after the coin's
 * baseline), (2) an ALERT is raised (bt-feed-<mode> in the scratch registry's alerts table), (3) the STATUS PAGE shows it
 * (status/status.json written to a scratch site, read back, the selector's state = the mode), (4) NO CRANK is planned (no receipt
 * with units, nothing executed or dry-run). A CONTROL run first feeds the same coin a healthy synthetic reading and must plan a
 * receipt — so the drill proves the fault, not a quiet setup. Exit code of the CLI: 0 all checks passed, 1 a check failed.
 */

export type DrillMode = "down" | "disagree" | "stale";
export interface DrillCheck { id: "control" | "withheld" | "alert" | "status" | "no-crank"; ok: boolean; detail: string }
export interface DrillReport { ok: boolean; feed: string; mode: DrillMode; selectorKey: string; ticker: string; ranAt: string; checks: DrillCheck[]; status: FeedHealth | null; alerts: string[]; scratch: { db: string; site: string } }

const DAY = 86_400_000;
const CREATOR = "Dri11CreatorWa11et11111111111111111111111111";
const ATTESTER = "Dri11KeeperDataKey1111111111111111111111111";

const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const ym = (ms: number) => new Date(ms).toISOString().slice(0, 7);

/** Three consecutive complete periods before `now` (oldest first) for a day or month feed. */
function periods(kind: string, now: number): string[] {
  if (kind === "day") return [3, 2, 1].map((n) => ymd(now - n * DAY));
  if (kind === "month") { const d = new Date(now); return [3, 2, 1].map((n) => ym(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - n, 1))); }
  throw new Error(`the drill runs on day and month feeds (this one is a ${kind} feed): pick e.g. treasury.debt or bls.eggs`);
}

/** A healthy synthetic source for the feed: three complete periods, the last one 2 units past the one before (direction-aware). */
function healthyAdapter(feedId: string, now: number, opts: { olderThanMs?: number } = {}): OracleAdapter {
  const feed = feedById(feedId)!;
  const unit = feed.unit!.size, dir = feed.direction ?? "up";
  const base = typeof feed.baseline === "number" ? feed.baseline : 1000 * unit;
  const ps = periods(feed.config.period.kind, opts.olderThanMs ? now - opts.olderThanMs : now);
  const vals = [base, base, dir === "down" ? base - 2 * unit : base + 2 * unit];
  const events: SettledEvent[] = ps.map((p, i) => ({ id: p, at: p, result: null, value: String(vals[i]), title: `${feed.title}: ${p}`, sourceUrl: feed.config.request.url }));
  return {
    id: "catalogue", searchSeries: async () => [], seriesInfo: async () => null, impliedChance: async () => ({ chance: null, marketTicker: null, closeTime: null, basis: "drill" }),
    settledSince: async (_rule, since): Promise<ResolvedSelector> => ({ events: events.filter((e) => since === null || e.at > since), awaitingFinal: 0, refusals: [], settlementSourceUrl: feed.config.request.url }),
  };
}

/** The wrapped adapter for a fault mode. */
export function faultyAdapter(feedId: string, mode: DrillMode, now: number): OracleAdapter {
  const feed = feedById(feedId)!;
  // stale: the source answers, but its newest complete period is older than the coin itself (the baseline is limit + 10 days back)
  if (mode === "stale") return healthyAdapter(feedId, now, { olderThanMs: (staleLimitMs(`catalogue:${feedId}`) ?? 30 * DAY) + 15 * DAY });
  const inner = healthyAdapter(feedId, now);
  return {
    ...inner,
    settledSince: async (rule, since) => {
      if (mode === "down") throw new Error(`drill: ${feed.config.request.url.replace(/\?.*$/, "")} answered HTTP 503 (simulated outage)`);
      const r = await inner.settledSince(rule, since);
      return { ...r, events: [], refusals: r.events.map((e) => `${e.id}: drill: the cross-read disagrees (primary ${e.value} ≠ cross-read ${Number(e.value) + feed.unit!.size}) — held`) };
    },
  };
}

async function scratchCoin(reg: Registry, program: FakeBurnProgram, feedId: string, ticker: string, baselineAt: string, now: number): Promise<TokenRow> {
  const feed = feedById(feedId);
  if (!feed) throw new Error(`no catalogue feed ${feedId}`);
  if (!feed.unit || feed.baseline === undefined || feed.baseline === null || !feed.direction) throw new Error(`${feedId} is not a fixed-unit feed (no unit / baseline / direction)`);
  const rule = { schema: BURNTICKER_RULES_SCHEMA, oracle: "catalogue", series: feed.id, market: null, filter: {}, kind: "scalar", scalar: { unit: feed.unit.size, perUnit: { fractionOfPool: 0.02 }, baseline: feed.baseline, direction: feed.direction }, binary: null, onVoid: "skip", floorUsd: "1", reserveSol: "0.02", vault: null };
  lockRule(rule);
  const b = await buildLaunchBundle({ creator: CREATOR, ticker, name: `${ticker} drill`, description: "outage drill (scratch)", imageUrl: null, links: [], rule, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true }, cluster: "devnet" }, { program, launchLab: new FakeLaunchLab(), devFeeWallet: null, attesters: [ATTESTER], quorum: 1, metadataUri: (m) => `https://drill.invalid/${m}.json` });
  const t = reg.register({ mint: b.mint, ticker, name: b.name, creator: CREATOR, description: b.description, imageUrl: null, links: [], rulesText: b.rules.text, feePda: b.addresses.feePda, vault: b.addresses.vault, tokenConfig: b.addresses.tokenConfig, poolId: b.addresses.poolId, launchTx: null, cluster: "devnet", platformId: b.addresses.platformId, baselineAt, status: "draft" }, now);
  reg.markLaunched(t.mint, `drill-launch-${ticker}`, b.addresses.poolId, baselineAt);
  reg.addAttester({ mint: t.mint, pubkey: ATTESTER, role: "data-key", addedAt: now, timelockUntil: null });
  if (program.tokens.has(t.mint)) { program.supplies.set(t.mint, BigInt("1000000000000000")); program.deposit(t.mint, BigInt(5_000_000_000)); }
  return reg.token(t.mint)!;
}

function depsFor(reg: Registry, program: FakeBurnProgram, adapter: OracleAdapter, clock: { t: number }, log: (s: string) => void): KeeperDeps {
  const none: OracleAdapter = { id: "none", searchSeries: async () => [], seriesInfo: async () => null, impliedChance: async () => ({ chance: null, marketTicker: null, closeTime: null, basis: "" }), settledSince: async () => { throw new Error("drill: only the catalogue source is wired"); } };
  return { registry: reg, program, oracles: { kalshi: none, catalogue: adapter }, attester: ATTESTER, log, now: () => clock.t, dryRun: false, kalshiEnabled: false };
}

/** Runs the drill. `now` defaults to the wall clock; `dir` (default a fresh temp dir) holds the scratch registry and site. */
export async function runDrill(o: { feed: string; mode: DrillMode; now?: number; dir?: string; log?: (s: string) => void }): Promise<DrillReport> {
  const now = o.now ?? Date.now(), log = o.log ?? (() => {});
  const feed = feedById(o.feed);
  if (!feed) throw new Error(`no catalogue feed ${o.feed} (config/burnticker/sources.json)`);
  periods(feed.config.period.kind, now);   // refuses week/quarter feeds up front
  const dir = o.dir ?? fs.mkdtempSync(path.join(os.tmpdir(), "bt-drill-"));
  const site = path.join(dir, "site"), dbFile = path.join(dir, "drill.db");
  fs.mkdirSync(site, { recursive: true });
  const limit = staleLimitMs(`catalogue:${o.feed}`) ?? 30 * DAY;
  const baselineAt = new Date(now - limit - 10 * DAY).toISOString();
  const ticker = "DRILL";
  const checks: DrillCheck[] = [];

  // CONTROL — the same coin on a healthy source must plan a receipt (in its own scratch registry).
  {
    const reg = openRegistry(":memory:"), program = new FakeBurnProgram("devnet"), clock = { t: now };
    program.now = () => clock.t;
    const first = periodStartMs(periods(feed.config.period.kind, now)[0]) ?? now - 120 * DAY;
    const t = await scratchCoin(reg, program, o.feed, ticker, new Date(first - DAY).toISOString(), now);
    const r = await runCycle(depsFor(reg, program, healthyAdapter(o.feed, now), clock, log));
    const planned = reg.receipts(t.mint).filter((b) => b.units > 0);
    checks.push({ id: "control", ok: planned.length > 0, detail: planned.length ? `a healthy source planned ${planned.length} receipt(s) (${planned.map((b) => `${b.eventId} ${b.units} unit(s)`).join(", ")}) and the cycle executed ${r.executed.filter((x) => x.outcome === "confirmed").length} — the setup cranks when the source is right` : "a healthy source planned nothing: the drill's setup is broken, the fault checks below prove nothing" });
    reg.close();
  }

  // FAULT — a fresh scratch registry, the wrapped adapter, three cycles (each past the backoff), the keeper's ops hooks.
  const reg = openRegistry(dbFile), program = new FakeBurnProgram("devnet"), clock = { t: now };
  program.now = () => clock.t;
  try {
    const t = await scratchCoin(reg, program, o.feed, ticker, baselineAt, now);
    const deps = depsFor(reg, program, faultyAdapter(o.feed, o.mode, now), clock, log);
    const reports: CycleReport[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await runCycle(deps);
      reports.push(r); observeCycle(reg, r, clock.t);
      reg.setStatus("lastCycle", { at: clock.t, fetched: r.fetched.filter((x) => !x.skipped).length, planned: r.planned.length, executed: r.executed.length, errors: r.errors.slice(0, 5), refusals: r.fetched.flatMap((x) => x.refusals).slice(0, 10) }, clock.t);
      const next = reg.feedState(t.selectorKey).nextFetchAt;
      clock.t = Math.max(clock.t + 60_000, (next ?? clock.t) + 1000);
    }
    const health = computeFeedHealth(reg, clock.t);
    const raised = await raiseFeedAlerts(health, registryAlertSink(reg), clock.t);
    const role = await new LeaderLock({ role: "leader", peerStatusUrl: null, missedLimit: 5, heartbeatStaleMs: 180_000, takeoverFile: path.join(dir, "takeover.json") }, { now: () => clock.t, hostId: "drill" }).tick();
    writeOpsStatus(site, buildOpsStatus({ now: clock.t, registry: reg, role, hostIdHash: "drill", cluster: "devnet", paused: false, startedAt: now, feeds: health, snapshot: null, programs: [] }));
    const published = readOpsStatus(site);
    const feedRow = published?.feeds.find((f) => f.selectorKey === t.selectorKey) ?? null;

    const readings = reg.readings(t.selectorKey, t.baselineAt);
    checks.push({ id: "withheld", ok: readings.length === 0, detail: readings.length ? `${readings.length} reading(s) were written: ${readings.map((r) => `${r.id}=${r.value}`).join(", ")}` : `no reading written for ${t.selectorKey} after the baseline (${o.mode === "down" ? `${reg.feedState(t.selectorKey).failures} failed read(s), backing off` : o.mode === "disagree" ? `${reports.flatMap((r) => r.fetched.flatMap((f) => f.refusals)).length} refusal(s) from the cross-read` : "the source had nothing newer than its cadence allows"})` });
    const kind = `bt-feed-${o.mode}`;
    const alerts = reg.alertsSince(0).map((a) => `${a.kind}: ${a.text}`);
    checks.push({ id: "alert", ok: alerts.some((a) => a.startsWith(`${kind}:`)), detail: alerts.some((a) => a.startsWith(`${kind}:`)) ? `${kind} raised (${raised.length} new this check)` : `no ${kind} alert (raised: ${alerts.map((a) => a.split(":")[0]).join(", ") || "none"})` });
    checks.push({ id: "status", ok: feedRow?.state === o.mode, detail: feedRow ? `status/status.json shows ${t.selectorKey} as "${feedRow.state}" — ${feedRow.why}` : "status/status.json has no row for the selector" });
    const units = reg.receipts(t.mint).filter((b) => b.units > 0);
    const executed = reports.flatMap((r) => r.executed).filter((x) => x.outcome === "confirmed" || x.outcome === "dry-run");
    checks.push({ id: "no-crank", ok: units.length === 0 && executed.length === 0 && reg.pending(t.mint).length === 0, detail: units.length || executed.length ? `${units.length} receipt(s) with units, ${executed.length} crank(s) executed` : "no receipt with units, nothing pending, nothing executed" });
    return { ok: checks.every((c) => c.ok), feed: o.feed, mode: o.mode, selectorKey: t.selectorKey, ticker, ranAt: new Date(now).toISOString(), checks, status: feedRow, alerts, scratch: { db: dbFile, site } };
  } finally { reg.close(); }
}
