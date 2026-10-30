import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PublicKey } from "@solana/web3.js";
import { signAttestation, verifyAttestation } from "@/lib/burnReceipts/attestation";
import { canonicalJson } from "@/lib/burnticker/ops/snapshot";

/**
 * KEEPER REDUNDANCY — ONE ACTIVE KEEPER, A WARM STANDBY (owner-approved 2026-10-10 night, trust-ops item 5).
 *
 * There is no shared lock medium between two hosts that we already run (the registry is a local SQLite file on each; a lease file
 * in a publish dir is host-local too), so this is NOT a distributed lock. It is a role + heartbeat protocol, and the exact things
 * it does not guarantee are written down in docs/burnticker/runbook.md ("Keeper redundancy"):
 *
 *   BURNTICKER_KEEPER_ROLE=leader (default)  runs every cycle ACTIVE. Each cycle it reads the peer's public status.json
 *        (BURNTICKER_PEER_STATUS_URL, optional). If the peer is a standby that has TAKEN OVER (its status carries a takeover note
 *        signed by its keeper key, and the signature verifies), the leader YIELDS: it keeps reading and publishing, cranks nothing,
 *        and says so on its own status page. There is no automatic fail-back — the operator fails back by hand (runbook). A peer
 *        that cannot be reached never makes the leader yield (the leader is the primary).
 *   BURNTICKER_KEEPER_ROLE=standby  runs every cycle PASSIVE (reads, plans into its own registry, publishes its own status.json;
 *        signs and sends nothing). Each cycle it reads the leader's status.json over HTTPS (BURNTICKER_LEADER_STATUS_URL). A heartbeat
 *        counts when the document is a leader's and its last cycle is younger than BURNTICKER_HEARTBEAT_STALE_SEC (default 180 s).
 *        After BURNTICKER_TAKEOVER_MISSED (default 5) consecutive missed heartbeats — about five minutes at one cycle a minute — it
 *        writes a TAKEOVER NOTE signed with its keeper key (ed25519 over the note's canonical JSON) to data/burnticker-takeover.json,
 *        publishes it in its status.json and only then goes ACTIVE. Without a key on the host it cannot sign a note and never takes
 *        over. Once active it stays active until the operator deletes the note file and restarts it.
 *
 * Duplicate cranks between two active keepers are refused by the program and adopted by the existing write-ahead + landed-tx path;
 * the attestation double-count case is fenced by readingFence.ts. Both are described with their limits in the runbook.
 */

export type KeeperRole = "leader" | "standby";
export const TAKEOVER_SCHEMA = "burnticker.takeover/v1";
export const TAKEOVER_FILE = path.join("data", "burnticker-takeover.json");
export const DEFAULT_MISSED_LIMIT = 5;
export const DEFAULT_HEARTBEAT_STALE_MS = 180_000;

export interface RoleConfig { role: KeeperRole; peerStatusUrl: string | null; missedLimit: number; heartbeatStaleMs: number; takeoverFile: string }

export function roleConfigFromEnv(env: Readonly<Record<string, string | undefined>>, root = process.cwd()): RoleConfig {
  const raw = (env.BURNTICKER_KEEPER_ROLE ?? "").trim().toLowerCase();
  if (raw && raw !== "leader" && raw !== "standby") throw new Error(`BURNTICKER_KEEPER_ROLE must be leader or standby (got ${raw})`);
  const role: KeeperRole = raw === "standby" ? "standby" : "leader";
  const url = ((role === "standby" ? env.BURNTICKER_LEADER_STATUS_URL : env.BURNTICKER_PEER_STATUS_URL) ?? "").trim() || null;
  if (url && !/^https:\/\//.test(url) && !/^http:\/\/(127\.0\.0\.1|localhost|100\.\d+\.\d+\.\d+)(:\d+)?\//.test(url)) throw new Error("the peer status URL must be https:// (or a loopback / tailnet http:// address)");
  if (role === "standby" && !url) throw new Error("a standby keeper needs BURNTICKER_LEADER_STATUS_URL (the leader's public status.json)");
  const n = (v: string | undefined, d: number, min: number) => { const x = Number((v ?? "").trim()); return Number.isFinite(x) && x >= min ? Math.floor(x) : d; };
  return { role, peerStatusUrl: url, missedLimit: n(env.BURNTICKER_TAKEOVER_MISSED, DEFAULT_MISSED_LIMIT, 2), heartbeatStaleMs: n(env.BURNTICKER_HEARTBEAT_STALE_SEC, DEFAULT_HEARTBEAT_STALE_MS / 1000, 60) * 1000, takeoverFile: path.join(root, TAKEOVER_FILE) };
}

/** A host's public identity: sha256 of its hostname and machine id, first 16 hex — names the host without revealing it. */
export function hostIdHash(o: { hostname?: string; machineId?: string | null } = {}): string {
  let mid = o.machineId ?? null;
  if (mid === null && o.hostname === undefined) { try { mid = fs.readFileSync("/etc/machine-id", "utf8").trim(); } catch { mid = ""; } }
  return crypto.createHash("sha256").update(`burnticker-keeper-host|${o.hostname ?? os.hostname()}|${mid ?? ""}`).digest("hex").slice(0, 16);
}

export interface TakeoverNote { schema: typeof TAKEOVER_SCHEMA; by: string; signer: string; at: string; leaderUrl: string; leaderLastCycleAt: string | null; missed: number; reason: string; signature: string }
const noteBody = (n: Omit<TakeoverNote, "signature"> | TakeoverNote): string => { const { signature: _s, ...rest } = n as TakeoverNote; return canonicalJson(rest); };

export function signTakeover(n: Omit<TakeoverNote, "signature">, secretKey: Uint8Array): TakeoverNote {
  return { ...n, signature: Buffer.from(signAttestation(secretKey, Buffer.from(noteBody(n), "utf8"))).toString("base64") };
}
/** A note is valid when its schema is right and its signature verifies against its own signer key. */
export function verifyTakeover(n: unknown): n is TakeoverNote {
  const x = n as TakeoverNote | null;
  if (!x || x.schema !== TAKEOVER_SCHEMA || typeof x.signer !== "string" || typeof x.signature !== "string") return false;
  try { return verifyAttestation(new PublicKey(x.signer), Buffer.from(noteBody(x), "utf8"), Buffer.from(x.signature, "base64")); } catch { return false; }
}

/** What a keeper publishes about itself in status.json (`keeper`), and what its peer reads back. */
export interface PeerView { url: string | null; reachable: boolean; role: KeeperRole | null; active: boolean | null; lastCycleAt: number | null; hostIdHash: string | null; takeover: TakeoverNote | null; takeoverValid: boolean; error: string | null; checkedAt: number | null }
export interface RoleDecision { role: KeeperRole; active: boolean; reason: string; missed: number; missedLimit: number; takeover: TakeoverNote | null; peer: PeerView }

export type FetchJson = (url: string, init: { signal: AbortSignal; headers: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** Reads a peer's public status.json (the ops status document: `keeper.{role,active,lastCycleAt,hostIdHash,takeover}`). */
export async function readPeer(url: string, fetchImpl: FetchJson, now: number, timeoutMs = 8000): Promise<PeerView> {
  const base: PeerView = { url, reachable: false, role: null, active: null, lastCycleAt: null, hostIdHash: null, takeover: null, takeoverValid: false, error: null, checkedAt: now };
  try {
    const r = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: "application/json", "user-agent": "burnticker-keeper/1 (heartbeat)" } });
    if (!r.ok) return { ...base, error: `HTTP ${r.status}` };
    const j = (await r.json()) as { schema?: string; keeper?: { role?: string; active?: boolean; lastCycleAt?: number | null; hostIdHash?: string; takeover?: unknown } };
    if (j?.schema !== "burnticker.ops-status/v1" || !j.keeper) return { ...base, reachable: true, error: "not a Burnticker ops status document" };
    const k = j.keeper;
    const takeover = k.takeover && typeof k.takeover === "object" ? (k.takeover as TakeoverNote) : null;
    return { ...base, reachable: true, role: k.role === "standby" ? "standby" : k.role === "leader" ? "leader" : null, active: typeof k.active === "boolean" ? k.active : null, lastCycleAt: typeof k.lastCycleAt === "number" ? k.lastCycleAt : null, hostIdHash: typeof k.hostIdHash === "string" ? k.hostIdHash : null, takeover, takeoverValid: takeover ? verifyTakeover(takeover) : false };
  } catch (e) { return { ...base, error: (e as Error).message.slice(0, 120) }; }
}

/**
 * The per-cycle role decision. Construct once per process; call tick() at the top of every cycle and set the keeper's dryRun to
 * `!decision.active` (on top of --dry-run and the PAUSE file).
 */
export class LeaderLock {
  readonly cfg: RoleConfig;
  private missed = 0;
  private lastPeer: PeerView;
  private o: { now: () => number; fetchImpl: FetchJson; hostId: string; signer: { publicKey: string; secretKey: Uint8Array } | null; log: (s: string) => void };
  constructor(cfg: RoleConfig, o: { now?: () => number; fetchImpl?: FetchJson; hostId?: string; signer?: { publicKey: string; secretKey: Uint8Array } | null; log?: (s: string) => void } = {}) {
    this.cfg = cfg;
    this.o = { now: o.now ?? (() => Date.now()), fetchImpl: o.fetchImpl ?? (globalThis.fetch as unknown as FetchJson), hostId: o.hostId ?? hostIdHash(), signer: o.signer ?? null, log: o.log ?? (() => {}) };
    this.lastPeer = { url: cfg.peerStatusUrl, reachable: false, role: null, active: null, lastCycleAt: null, hostIdHash: null, takeover: null, takeoverValid: false, error: null, checkedAt: null };
  }
  /** The takeover note this host wrote (standby), if any and valid. */
  ownTakeover(): TakeoverNote | null {
    try { const j = JSON.parse(fs.readFileSync(this.cfg.takeoverFile, "utf8")); return verifyTakeover(j) ? j : null; } catch { return null; }
  }
  async tick(): Promise<RoleDecision> {
    const now = this.o.now(), cfg = this.cfg;
    const peer = cfg.peerStatusUrl ? await readPeer(cfg.peerStatusUrl, this.o.fetchImpl, now) : this.lastPeer;
    this.lastPeer = peer;
    const d = (active: boolean, reason: string, takeover: TakeoverNote | null = null): RoleDecision => ({ role: cfg.role, active, reason, missed: this.missed, missedLimit: cfg.missedLimit, takeover, peer });
    if (cfg.role === "leader") {
      if (peer.reachable && peer.role === "standby" && peer.active && peer.takeover && peer.takeoverValid) return d(false, `yielded: the standby (host ${peer.hostIdHash ?? "?"}) took over at ${peer.takeover.at} — this keeper reads and publishes but cranks nothing; fail back by hand (runbook "Keeper redundancy")`);
      return d(true, cfg.peerStatusUrl ? (peer.reachable ? `leader; the peer is ${peer.role ?? "unknown"} and ${peer.active ? "active" : "passive"}` : `leader; the peer status is unreachable (${peer.error ?? "no answer"}) — the leader stays active`) : "leader (no peer configured)");
    }
    // standby
    const own = this.ownTakeover();
    if (own) return d(true, `ACTIVE since the takeover at ${own.at} (${own.reason}); stays active until the operator removes ${TAKEOVER_FILE} and restarts`, own);
    const fresh = peer.reachable && peer.role === "leader" && peer.lastCycleAt !== null && now - peer.lastCycleAt <= cfg.heartbeatStaleMs;
    if (fresh) { this.missed = 0; return d(false, `standby: the leader's heartbeat is ${Math.round((now - peer.lastCycleAt!) / 1000)} s old`); }
    this.missed++;
    const why = !peer.reachable ? `leader status unreachable (${peer.error ?? "no answer"})` : peer.role !== "leader" ? `the document at the leader URL is not a leader's (${peer.role ?? "no role"})` : peer.lastCycleAt === null ? "the leader has not completed a cycle" : `the leader's last cycle is ${Math.round((now - peer.lastCycleAt) / 1000)} s old`;
    if (this.missed < cfg.missedLimit) return d(false, `standby: missed heartbeat ${this.missed} of ${cfg.missedLimit} — ${why}`);
    if (!this.o.signer) return d(false, `standby: ${this.missed} missed heartbeats (${why}) but no keeper key on this host to sign a takeover note — staying passive`);
    const note = signTakeover({ schema: TAKEOVER_SCHEMA, by: this.o.hostId, signer: this.o.signer.publicKey, at: new Date(now).toISOString(), leaderUrl: cfg.peerStatusUrl ?? "", leaderLastCycleAt: peer.lastCycleAt !== null ? new Date(peer.lastCycleAt).toISOString() : null, missed: this.missed, reason: why }, this.o.signer.secretKey);
    fs.mkdirSync(path.dirname(cfg.takeoverFile), { recursive: true });
    const tmp = `${cfg.takeoverFile}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, `${JSON.stringify(note, null, 2)}\n`, { mode: 0o644 });
    fs.renameSync(tmp, cfg.takeoverFile);
    this.o.log(`  [role] TAKEOVER: ${this.missed} missed heartbeats (${why}) — signed note written to ${cfg.takeoverFile}; this keeper is ACTIVE from this cycle`);
    return d(true, `TOOK OVER at ${note.at}: ${why}`, note);
  }
}
