import type { Registry } from "@/lib/burnticker/registry";
import type { CycleReport, KeeperDeps } from "@/lib/burnticker/multiKeeper";
import type { AlertSink } from "@/lib/burnticker/alerts";
import type { PinUploader } from "@/lib/burnticker/pin";
import { loadVerifiedBuild, type VerifiedBuild } from "@/lib/burnticker/trustpack/verifiedBuild";
import { computeFeedHealth, observeCycle, raiseFeedAlerts, type FeedHealth } from "@/lib/burnticker/ops/feedHealth";
import { hostIdHash, LeaderLock, roleConfigFromEnv, type FetchJson, type RoleDecision } from "@/lib/burnticker/ops/leaderLock";
import { readingFence, type FenceReport } from "@/lib/burnticker/ops/readingFence";
import { latestSnapshot, snapshotIfDue } from "@/lib/burnticker/ops/snapshot";
import { buildOpsStatus, programStatuses, writeOpsStatus, type OpsStatusJson } from "@/lib/burnticker/ops/status";

/**
 * THE KEEPER'S TRUST-OPS HOOKS (2026-10-10 night), so scripts/burnticker-keeper.mts needs four lines:
 *
 *   beforeCycle   the role decision (leaderLock.ts) and the foreign-reading fence (readingFence.ts) → may this cycle send?
 *   afterCycle    fold the cycle's fetch reports into the feed observations, take the day's registry snapshot when due (active
 *                 keeper only), write status/status.json
 *   alerts        the feed alerts (down / disagree / stale) and the fence's hold, through the keeper's sink (every 5 minutes)
 *
 * Nothing here holds a key except the optional takeover signer the keeper passes in (its own data key, for the signed takeover note).
 */
export class KeeperOps {
  readonly lock: LeaderLock;
  readonly hostId: string;
  private o: { registry: Registry; siteDir: string; cluster: string; log: (s: string) => void; uploader: PinUploader | null; now: () => number; startedAt: number; verifiedBuild: VerifiedBuild | null; snapshots: boolean };
  private role: RoleDecision | null = null;
  private fence: FenceReport | null = null;
  private health: FeedHealth[] = [];
  private pendingSink: AlertSink | null = null;
  /** `snapshots: false` (the keeper's --dry-run) never uploads: a dry run spends nothing. */
  constructor(o: { registry: Registry; siteDir: string; cluster: string; env: Readonly<Record<string, string | undefined>>; log: (s: string) => void; uploader: PinUploader | null; signer?: { publicKey: string; secretKey: Uint8Array } | null; now?: () => number; fetchImpl?: FetchJson; root?: string; hostId?: string; snapshots?: boolean }) {
    const now = o.now ?? (() => Date.now());
    this.hostId = o.hostId ?? hostIdHash();
    let vb: VerifiedBuild | null = null;
    try { vb = loadVerifiedBuild(o.root); } catch { vb = null; }
    this.o = { registry: o.registry, siteDir: o.siteDir, cluster: o.cluster, log: o.log, uploader: o.uploader, now, startedAt: now(), verifiedBuild: vb, snapshots: o.snapshots !== false };
    this.lock = new LeaderLock(roleConfigFromEnv(o.env, o.root), { now, fetchImpl: o.fetchImpl, hostId: this.hostId, signer: o.signer ?? null, log: o.log });
  }
  /** The banner fragment for the keeper's start line. */
  banner(): string {
    const c = this.lock.cfg;
    return `role ${c.role}${c.peerStatusUrl ? ` (peer ${c.peerStatusUrl})` : ""} · host ${this.hostId} · snapshots ${!this.o.snapshots ? "off (dry run)" : this.o.uploader ? `pinned via ${this.o.uploader.name}` : "REFUSED (no BURNTICKER_UPLOAD_PAYER)"}`;
  }
  /** Call at the top of every cycle. `sendsAllowed` false = run the cycle as a dry run (read, plan, publish; sign and send nothing). */
  async beforeCycle(deps: Pick<KeeperDeps, "registry" | "program" | "log" | "dryRun">): Promise<{ active: boolean; sendsAllowed: boolean; role: RoleDecision; fence: FenceReport | null }> {
    const role = await this.lock.tick();
    if (!this.role || this.role.active !== role.active || this.role.reason.split(":")[0] !== role.reason.split(":")[0]) this.o.log(`  [role] ${role.role} ${role.active ? "ACTIVE" : "PASSIVE"} — ${role.reason}`);
    this.role = role;
    let fence: FenceReport | null = null;
    if (role.active) {
      try { fence = await readingFence({ ...deps, dryRun: deps.dryRun }); } catch (e) { this.o.log(`  [fence] check failed: ${(e as Error).message.slice(0, 160)} — sends held this cycle`); fence = { held: [{ mint: "", ticker: "*", why: `fence check failed: ${(e as Error).message.slice(0, 120)}` }], adopted: [], checked: 0 }; }
    }
    this.fence = fence;
    return { active: role.active, sendsAllowed: role.active && !(fence && fence.held.length), role, fence };
  }
  /** Call after the cycle and the publish. Never throws. */
  async afterCycle(report: CycleReport | null, paused: boolean, sink?: AlertSink | null): Promise<OpsStatusJson | null> {
    const now = this.o.now(), reg = this.o.registry;
    try { if (report) observeCycle(reg, report, now); } catch (e) { this.o.log(`  [ops] feed observations not written: ${(e as Error).message.slice(0, 160)}`); }
    try { this.health = computeFeedHealth(reg, now); } catch (e) { this.o.log(`  [ops] feed health failed: ${(e as Error).message.slice(0, 160)}`); }
    if (sink) this.pendingSink = sink;
    if (this.role?.active && this.o.snapshots) {
      await snapshotIfDue({ registry: reg, uploader: this.o.uploader, now, cluster: this.o.cluster, log: this.o.log, alert: (kind, key, text) => this.pendingSink?.(kind, key, text, null, now) ?? reg.recordAlert({ kind, key, text, meta: null }, now) });
    }
    try {
      const s = buildOpsStatus({ now, registry: reg, role: this.role ?? (await this.lock.tick()), hostIdHash: this.hostId, cluster: this.o.cluster, paused, startedAt: this.o.startedAt, feeds: this.health, snapshot: latestSnapshot(reg), programs: programStatuses(this.o.verifiedBuild, this.o.cluster), fence: this.fence ? { held: this.fence.held.map((h) => ({ ticker: h.ticker, why: h.why })), adopted: this.fence.adopted.length } : null });
      writeOpsStatus(this.o.siteDir, s);
      return s;
    } catch (e) { this.o.log(`  [ops] status.json not written: ${(e as Error).message.slice(0, 160)}`); return null; }
  }
  /** The feed alerts and the fence's hold, through the keeper's sink (call from the 5-minute alert check). */
  async alerts(sink: AlertSink, now = this.o.now()): Promise<string[]> {
    this.pendingSink = sink;
    const raised = (await raiseFeedAlerts(this.health, sink, now)).map((a) => `${a.kind}: ${a.text}`);
    for (const h of this.fence?.held ?? []) {
      const text = `Burnticker keeper HOLDS its sends: $${h.ticker} — ${h.why}`;
      try { if (await sink("bt-foreign-reading", `bt-foreign-reading:${h.mint}`, text, { mint: h.mint }, now)) raised.push(`bt-foreign-reading: ${text}`); } catch { /* never stops the keeper */ }
    }
    if (this.role && !this.role.active && this.role.role === "leader") {
      try { if (await sink("bt-keeper-yielded", `bt-keeper-yielded:${this.hostId}`, `Burnticker leader keeper ${this.hostId} is PASSIVE: ${this.role.reason}`, null, now)) raised.push(`bt-keeper-yielded`); } catch { /* never stops the keeper */ }
    }
    if (this.role?.takeover && this.role.role === "standby") {
      try { if (await sink("bt-keeper-takeover", `bt-keeper-takeover:${this.role.takeover.at}`, `Burnticker STANDBY keeper ${this.hostId} TOOK OVER at ${this.role.takeover.at}: ${this.role.takeover.reason}`, null, now)) raised.push(`bt-keeper-takeover`); } catch { /* never stops the keeper */ }
    }
    return raised;
  }
}
