import fs from "node:fs";
import path from "node:path";
import type { Registry } from "@/lib/burnticker/registry";
import type { FeedHealth } from "@/lib/burnticker/ops/feedHealth";
import type { RoleDecision, KeeperRole, TakeoverNote } from "@/lib/burnticker/ops/leaderLock";
import type { SnapshotRecord } from "@/lib/burnticker/ops/snapshot";
import type { VerifiedBuild } from "@/lib/burnticker/trustpack/verifiedBuild";
import { sideLaunched } from "@/lib/burnticker/publicPairs";

/**
 * THE PUBLIC STATUS DOCUMENT (owner-approved 2026-10-10 night, trust-ops item 2): `status/status.json` in the keeper's publish dir,
 * rewritten every cycle (about once a minute), served by Caddy at https://status.burnticker.com/status.json and
 * https://burnticker.com/status/status.json, rendered by the static page site/burnticker/status/index.html. It is also the
 * heartbeat the standby keeper reads (leaderLock.ts). NOTHING SECRET: no alert text (kinds and counts only), no RPC URL, no host
 * name (a hash), no key material (the takeover note carries a public key and a signature). No prices.
 *
 * Schema `burnticker.ops-status/v1` (additive only):
 *   generatedAt                ISO time of this write
 *   keeper                     { role, active, reason, hostIdHash, cluster, startedAt, lastCycleAt, lastCycle {fetched, planned,
 *                                executed, errors}, paused, heartbeatEverySec, missed, missedLimit, takeover (signed note | null),
 *                                peer { url, reachable, role, active, lastCycleAt, hostIdHash, takeoverValid, error, checkedAt } }
 *   feeds[]                    { selectorKey, tickers[], state ok|down|disagree|withheld|stale|never-read, why, lastOkAt, lastFetchAt, failures,
 *                                crossRead { agreement true|false|null, basis, lastDisagreeAt }, staleness { lastReadingId,
 *                                lastReadingAt, ageMs, limitMs, stale } }
 *   alerts                     { windowHours: 24, open (count; the daily summary line excluded), kinds { kind: count } }
 *   retired                    { count, coins[] { ticker, retiredAt, lastSweepDate, sweepThresholdLamports } }
 *   windDowns                  { pending (count), coins[] { ticker, mode drain|winddown, reason, endedAt, daysDone, windDownDays, receiptsPending } }
 *   snapshot                   { date, sha256, arweaveTxId, url, rowCounts, capturedAt } | null — the latest pinned registry snapshot
 *   programs[]                 { name, programId, cluster, deployedHash, buildHash, verified "matches"|"upgrade-pending"|"differs"|"not-deployed" (upgrade-pending: a newer build is recorded and its upgrade is not deployed, B-17 2026-10-21), buildKind, readAt }
 *   fence                      { held[] { ticker, why }, adopted (count this cycle) } — the foreign-reading fence (readingFence.ts)
 *   pairs[]                    (since 2026-10-11, winner takes the burn) { pairId, a, b (tickers), winnerTakesBurn, forwards (count),
 *                                lastForward { recordDate, from, to, lamports, signature, at } | null, unpaired (reason; after unlink_pair) }
 */

export const OPS_STATUS_SCHEMA = "burnticker.ops-status/v1";
export const OPS_STATUS_DIR = "status";
export const OPS_STATUS_FILE = "status.json";

export interface ProgramStatus { name: string; programId: string; cluster: "devnet" | "mainnet"; deployedHash: string | null; buildHash: string | null; verified: "matches" | "upgrade-pending" | "differs" | "not-deployed"; buildKind: string; readAt: string | null }
export interface OpsStatusJson {
  schema: typeof OPS_STATUS_SCHEMA; generatedAt: string;
  keeper: {
    role: KeeperRole; active: boolean; reason: string; hostIdHash: string; cluster: string; startedAt: string; lastCycleAt: number | null;
    lastCycle: { fetched: number; planned: number; executed: number; errors: number } | null; paused: boolean; heartbeatEverySec: number;
    missed: number; missedLimit: number; takeover: TakeoverNote | null;
    peer: { url: string | null; reachable: boolean; role: string | null; active: boolean | null; lastCycleAt: number | null; hostIdHash: string | null; takeoverValid: boolean; error: string | null; checkedAt: number | null };
  };
  feeds: FeedHealth[];
  alerts: { windowHours: 24; open: number; kinds: Record<string, number> };
  retired: { count: number; coins: { ticker: string; retiredAt: string | null; lastSweepDate: string | null; sweepThresholdLamports: number | null }[] };
  windDowns: { pending: number; coins: { ticker: string; mode: "drain" | "winddown"; reason: string; endedAt: string; daysDone: number; windDownDays: number | null; receiptsPending: number }[] };
  snapshot: { date: string; sha256: string; arweaveTxId: string; url: string; rowCounts: Record<string, number>; capturedAt: string } | null;
  programs: ProgramStatus[];
  fence: { held: { ticker: string; why: string }[]; adopted: number };
  /** Rivalry pairs (winner takes the burn): the latest forward_to_winner per pair. Absent on documents written before 2026-10-11. */
  pairs?: { pairId: string; a: string; b: string; winnerTakesBurn: boolean; forwards: number; lastForward: { recordDate: string; from: string; to: string; lamports: string; signature: string; at: string } | null; unpaired?: string | null }[];
}

/** The program rows from config/burnticker/verified-build.json for the keeper's cluster (localnet shows devnet's). */
export function programStatuses(vb: VerifiedBuild | null, cluster: string): ProgramStatus[] {
  if (!vb) return [];
  const c: "devnet" | "mainnet" = cluster === "mainnet" ? "mainnet" : "devnet";
  return vb.programs.map((p) => {
    const dep = p.deployed?.[c] ?? null, build = p.builds?.[c] ?? null;
    return { name: p.library, programId: p.programId, cluster: c, deployedHash: dep?.hash ?? null, buildHash: build?.hash ?? null, verified: !dep ? "not-deployed" : dep.matchesBuild && dep.hash === build?.hash ? "matches" : dep.pendingUpgrade ? "upgrade-pending" : "differs", buildKind: vb.kind, readAt: dep?.readAt ?? null };
  });
}

const iso = (ms: number | null | undefined): string | null => (ms === null || ms === undefined || !Number.isFinite(ms) ? null : new Date(ms).toISOString());

export interface OpsStatusInput {
  now: number; registry: Pick<Registry, "tokens" | "getStatus" | "alertsSince" | "ruleEnd" | "receipts" | "lockedRule" | "pending"> & Partial<Pick<Registry, "pairs" | "pairForwards" | "token">>;
  role: RoleDecision; hostIdHash: string; cluster: string; paused: boolean; startedAt: number;
  feeds: FeedHealth[]; snapshot: SnapshotRecord | null; programs: ProgramStatus[]; fence?: { held: { ticker: string; why: string }[]; adopted: number } | null;
  heartbeatEverySec?: number;
}

/** PURE apart from registry reads. */
export function buildOpsStatus(i: OpsStatusInput): OpsStatusJson {
  const reg = i.registry;
  let lastCycle: OpsStatusJson["keeper"]["lastCycle"] = null, lastCycleAt: number | null = null;
  try { const s = reg.getStatus("lastCycle"); if (s) { const j = JSON.parse(s) as { at?: number; fetched?: number; planned?: number; executed?: number; errors?: unknown[] }; lastCycleAt = Number(j.at ?? 0) || null; lastCycle = { fetched: Number(j.fetched ?? 0), planned: Number(j.planned ?? 0), executed: Number(j.executed ?? 0), errors: Array.isArray(j.errors) ? j.errors.length : 0 }; } } catch { lastCycle = null; }
  const kinds: Record<string, number> = {};
  let open = 0;
  for (const a of reg.alertsSince(i.now - 86_400_000, 1000)) { if (a.kind === "bt-daily-summary") continue; kinds[a.kind] = (kinds[a.kind] ?? 0) + 1; open++; }
  const retiredCoins: OpsStatusJson["retired"]["coins"] = [];
  const windDowns: OpsStatusJson["windDowns"]["coins"] = [];
  for (const t of reg.tokens()) {
    const end = reg.ruleEnd(t.mint);
    type OnEnd = { windDownDays: number; sweepThresholdLamports: number };
    let onEnd: OnEnd | null = null;
    try { onEnd = (reg.lockedRule(t).rule.onEnd as OnEnd | undefined) ?? null; } catch { onEnd = null; }
    if (t.status === "retired") {
      let retiredAt: string | null = null;
      try { const r = reg.getStatus(`rule.retired.${t.mint}`); retiredAt = r ? iso(Number((JSON.parse(r) as { at?: number }).at)) : null; } catch { retiredAt = null; }
      retiredCoins.push({ ticker: t.ticker, retiredAt, lastSweepDate: reg.getStatus(`rule.swept.${t.mint}`), sweepThresholdLamports: onEnd?.sweepThresholdLamports ?? null });
    } else if (end && t.status === "live") {
      const rows = reg.receipts(t.mint);
      windDowns.push({ ticker: t.ticker, mode: end.mode, reason: end.reason, endedAt: iso(end.at) ?? "", daysDone: rows.filter((b) => b.kind === end.mode && b.status !== "planned" && b.status !== "sending").length, windDownDays: end.mode === "winddown" ? onEnd?.windDownDays ?? null : null, receiptsPending: reg.pending(t.mint).length });
    }
  }
  // Winner takes the burn: one row per pair, its latest forward (tickers and lamports; no prices).
  const pairs: NonNullable<OpsStatusJson["pairs"]> = [];
  if (reg.pairs && reg.pairForwards && reg.token) for (const pr of reg.pairs()) {
    const ta = reg.token(pr.mintA), tb = reg.token(pr.mintB);
    if (!ta || !tb) continue;
    // prelaunch audit 2026-10-18 A-25: a pair with no launched side (an abandoned draft) is not listed (publicPairs.ts, the pages' rule)
    if (!sideLaunched(ta) && !sideLaunched(tb)) continue;
    let wtb = false;
    try { wtb = !!(reg.lockedRule(ta).rule.pair as { winnerTakesBurn?: boolean } | null | undefined)?.winnerTakesBurn; } catch { wtb = false; }
    const fw = reg.pairForwards(pr.pairId), last = fw[fw.length - 1];
    const tick = (m: string) => (m === ta.mint ? ta.ticker : m === tb.mint ? tb.ticker : m.slice(0, 6));
    const ds = (d: number) => `${String(d).slice(0, 4)}-${String(d).slice(4, 6)}-${String(d).slice(6, 8)}`;
    let unpaired: string | null = null;
    try { const u = reg.getStatus(`pair.unlinked.${pr.pairId}`); unpaired = u ? String((JSON.parse(u) as { reasonText?: string }).reasonText ?? "unlinked") : null; } catch { unpaired = null; }
    pairs.push({ pairId: pr.pairId, a: ta.ticker, b: tb.ticker, winnerTakesBurn: wtb, forwards: fw.length, lastForward: last ? { recordDate: ds(last.recordDate), from: tick(last.loserMint), to: tick(last.winnerMint), lamports: last.lamports.toString(), signature: last.signature, at: new Date(last.at).toISOString() } : null, ...(unpaired ? { unpaired } : {}) });
  }
  const r = i.role;
  return {
    schema: OPS_STATUS_SCHEMA, generatedAt: new Date(i.now).toISOString(),
    keeper: {
      role: r.role, active: r.active, reason: r.reason, hostIdHash: i.hostIdHash, cluster: i.cluster, startedAt: new Date(i.startedAt).toISOString(), lastCycleAt, lastCycle, paused: i.paused,
      heartbeatEverySec: i.heartbeatEverySec ?? 60, missed: r.missed, missedLimit: r.missedLimit, takeover: r.takeover,
      peer: { url: r.peer.url, reachable: r.peer.reachable, role: r.peer.role, active: r.peer.active, lastCycleAt: r.peer.lastCycleAt, hostIdHash: r.peer.hostIdHash, takeoverValid: r.peer.takeoverValid, error: r.peer.error, checkedAt: r.peer.checkedAt },
    },
    feeds: i.feeds,
    alerts: { windowHours: 24, open, kinds },
    retired: { count: retiredCoins.length, coins: retiredCoins },
    windDowns: { pending: windDowns.length, coins: windDowns },
    snapshot: i.snapshot ? { date: i.snapshot.date, sha256: i.snapshot.sha256, arweaveTxId: i.snapshot.arweaveTxId, url: i.snapshot.url, rowCounts: i.snapshot.rowCounts, capturedAt: new Date(i.snapshot.capturedAt).toISOString() } : null,
    programs: i.programs,
    fence: i.fence ?? { held: [], adopted: 0 },
    ...(pairs.length ? { pairs } : {}),
  };
}

/** Writes <site>/status/status.json atomically (tmp + rename; the publish timer skips *.tmp-*). Returns the path. */
export function writeOpsStatus(siteDir: string, s: OpsStatusJson): string {
  const dir = path.join(siteDir, OPS_STATUS_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, OPS_STATUS_FILE), tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(s, null, 1)}\n`);
  fs.renameSync(tmp, file);
  return file;
}

export function readOpsStatus(siteDir: string): OpsStatusJson | null {
  try { const j = JSON.parse(fs.readFileSync(path.join(siteDir, OPS_STATUS_DIR, OPS_STATUS_FILE), "utf8")) as OpsStatusJson; return j.schema === OPS_STATUS_SCHEMA ? j : null; } catch { return null; }
}
