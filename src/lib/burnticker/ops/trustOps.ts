import type { Registry } from "@/lib/burnticker/registry";
import { readOpsStatus, type OpsStatusJson } from "@/lib/burnticker/ops/status";
import { readPeer, type FetchJson, type PeerView } from "@/lib/burnticker/ops/leaderLock";
import { latestSnapshot, type SnapshotRecord } from "@/lib/burnticker/ops/snapshot";

/**
 * THE TRUST PAGE'S TRUST-OPS SECTION (2026-10-10 night): which keeper is active (this host's status.json and, when configured, the
 * peer's — both keepers publish one), an attesters line per coin (count, the first characters of each key, when it joined and when
 * it is senior enough to vouch for a new key — the program's 7-day rule), the latest registry snapshot, and where the incident
 * policy, its template and the status page live. Read from this host's files and one HTTPS read of the peer; never a secret.
 */

export const ATTESTER_SENIORITY_MS = 7 * 86_400_000;
export const INCIDENT_DOCS = { policy: "docs/burnticker/INCIDENTS.md", template: "docs/burnticker/incidents/TEMPLATE.md", log: "docs/burnticker/incidents/LOG.md" } as const;

export interface AttesterLine { ticker: string; status: string; count: number; keys: { prefix: string; role: string; active: boolean; addedAt: string; seniorFrom: string; senior: boolean }[]; line: string }
export interface KeeperView { source: "this host" | "peer"; url: string | null; reachable: boolean; role: string | null; active: boolean | null; reason: string | null; hostIdHash: string | null; lastCycleAt: string | null; takeoverAt: string | null; takeoverValid: boolean | null; error: string | null }
export interface TrustOps {
  generatedAt: string;
  keepers: KeeperView[]; activeSummary: string;
  attesters: AttesterLine[];
  snapshot: (Omit<SnapshotRecord, "capturedAt"> & { capturedAt: string }) | null; snapshotsApi: string;
  incidents: typeof INCIDENT_DOCS; statusPage: string;
}

const iso = (ms: number | null | undefined): string | null => (ms === null || ms === undefined ? null : new Date(ms).toISOString());
const day = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** One coin's attesters line: "2 attesters · KeepAb… data-key since 2026-10-09 (senior from 2026-10-16) · Comm12… independent since …". */
export function attesterLines(reg: Pick<Registry, "tokens" | "attesters">, now: number): AttesterLine[] {
  return reg.tokens().filter((t) => t.status !== "expired" && t.status !== "draft").map((t) => {
    const keys = reg.attesters(t.mint).map((a) => ({ prefix: `${a.pubkey.slice(0, 6)}…`, role: a.role, active: a.active, addedAt: day(a.addedAt), seniorFrom: day(a.addedAt + ATTESTER_SENIORITY_MS), senior: now - a.addedAt >= ATTESTER_SENIORITY_MS }));
    const active = keys.filter((k) => k.active);
    const line = `${active.length} attester${active.length === 1 ? "" : "s"}${active.length ? ` · ${active.map((k) => `${k.prefix} ${k.role} since ${k.addedAt} (${k.senior ? "senior" : `senior from ${k.seniorFrom}`})`).join(" · ")}` : ""}${keys.length > active.length ? ` · ${keys.length - active.length} retired` : ""}`;
    return { ticker: t.ticker, status: t.status, count: active.length, keys, line };
  });
}

function fromStatus(s: OpsStatusJson | null): KeeperView {
  if (!s) return { source: "this host", url: null, reachable: false, role: null, active: null, reason: "this host has not published status/status.json (no keeper here, or it has not completed a cycle)", hostIdHash: null, lastCycleAt: null, takeoverAt: null, takeoverValid: null, error: null };
  const k = s.keeper;
  return { source: "this host", url: null, reachable: true, role: k.role, active: k.active, reason: k.reason, hostIdHash: k.hostIdHash, lastCycleAt: iso(k.lastCycleAt), takeoverAt: k.takeover?.at ?? null, takeoverValid: k.takeover ? true : null, error: null };
}
function fromPeer(p: PeerView): KeeperView {
  return { source: "peer", url: p.url, reachable: p.reachable, role: p.role, active: p.active, reason: null, hostIdHash: p.hostIdHash, lastCycleAt: iso(p.lastCycleAt), takeoverAt: p.takeover?.at ?? null, takeoverValid: p.takeover ? p.takeoverValid : null, error: p.error };
}

export async function buildTrustOps(o: { registry: Pick<Registry, "tokens" | "attesters" | "db">; publishDir: string; env?: Readonly<Record<string, string | undefined>>; now?: number; fetchImpl?: FetchJson }): Promise<TrustOps> {
  const env = o.env ?? process.env, now = o.now ?? Date.now();
  const local = fromStatus(readOpsStatus(o.publishDir));
  const keepers: KeeperView[] = [local];
  const peerUrl = (env.BURNTICKER_PEER_STATUS_URL ?? "").trim();
  if (/^https?:\/\//.test(peerUrl)) keepers.push(fromPeer(await readPeer(peerUrl, o.fetchImpl ?? (globalThis.fetch as unknown as FetchJson), now, 5000)));
  const actives = keepers.filter((k) => k.active === true);
  const activeSummary = actives.length === 0 ? (keepers.some((k) => k.reachable) ? "no keeper is active right now (both passive or yielded) — readings wait; nothing is lost" : "no keeper status is published on this host")
    : actives.length === 1 ? `active: ${actives[0].source} (${actives[0].role}, host ${actives[0].hostIdHash ?? "?"})${keepers.length === 1 ? " — no standby configured" : ""}`
    : "BOTH keepers report active — the program refuses a duplicate reading and the fence holds a keeper that sees a reading it did not write; the operator resolves it (runbook \"Keeper redundancy\")";
  let snap: SnapshotRecord | null = null;
  try { snap = latestSnapshot(o.registry); } catch { snap = null; }
  return {
    generatedAt: new Date(now).toISOString(), keepers, activeSummary,
    attesters: attesterLines(o.registry, now),
    snapshot: snap ? { ...snap, capturedAt: new Date(snap.capturedAt).toISOString() } : null, snapshotsApi: "/api/burnticker/v1/snapshots",
    incidents: INCIDENT_DOCS, statusPage: (env.BURNTICKER_STATUS_URL ?? "").trim() || "/status/",
  };
}
