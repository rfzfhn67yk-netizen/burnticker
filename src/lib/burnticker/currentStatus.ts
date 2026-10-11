import fs from "node:fs";
import path from "node:path";
import { b58encode, base64ToBytes } from "@/lib/burnticker/trustpack/base58";
import { jsonRpc, PUBLIC_RPC, type Rpc } from "@/lib/burnticker/trustpack/receiptCheck";
import { CURRENT_STATUS_FILE, readStatusFile } from "@/lib/burnticker/deficitPrelaunch";

/**
 * ONE AUTHORITATIVE CURRENT STATUS (website brief 2026-10-11 §4). Every repeated "what is true now" claim on the homepage, the trust,
 * operator and status pages comes from this one object, served by GET /api/burnticker/v1/current-status:
 *
 *   human-maintained  config/burnticker/current-status.json — phase, network roles, program version labels, attesters + quorum,
 *                     settlement providers, per-finding review status (fix / re-check / deployed), release requirements, the
 *                     intended design and the append-only historical logs
 *   files             config/burnticker/verified-build.json (program ids, build and deployed hashes) and operator.json (Squads addresses)
 *   environment       this host's wiring: BURNTICKER_CLUSTER, BURNTICKER_PROGRAM_ID, BURNTICKER_CREATOR_LAUNCHES_ENABLED
 *   chain (live)      each cluster's Squads multisig (threshold, members, the ACTUAL time lock) and each program's upgrade authority,
 *                     read through the public RPCs (or BURNTICKER_RPC_URL for the host's cluster), cached five minutes; a failed read
 *                     says "unavailable", never a guessed value
 *
 * Design (intended), deployed (read from chain / verified-build) and historical (log links) are separate fields. Copy rules apply.
 */

export const SQUADS_PROGRAM = "SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf";
export const UPGRADEABLE_LOADER = "BPFLoaderUpgradeab1e11111111111111111111111";
export type Cluster = "devnet" | "mainnet";

export interface SquadsRead { threshold: number; timeLockSecs: number; members: number }
/** Squads v4 Multisig (8-byte discriminator, create_key, config_authority, threshold u16 @72, time_lock u32 @74, …, members vec). */
export function decodeSquadsMultisig(d: Uint8Array): SquadsRead | null {
  if (d.length < 100) return null;
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const threshold = v.getUint16(72, true), timeLockSecs = v.getUint32(74, true);
  const membersAt = 95 + (d[94] === 1 ? 32 : 0) + 1;
  if (d.length < membersAt + 4) return null;
  return { threshold, timeLockSecs, members: v.getUint32(membersAt, true) };
}
/** Upgradeable-loader Program account → its ProgramData address; ProgramData → the upgrade authority (null = none). */
export const programDataOf = (d: Uint8Array): string | null => (d.length >= 36 && d[0] === 2 ? b58encode(d.subarray(4, 36)) : null);
export const upgradeAuthorityOf = (d: Uint8Array): string | null | undefined => (d.length >= 13 && d[0] === 3 ? (d[12] === 1 && d.length >= 45 ? b58encode(d.subarray(13, 45)) : null) : undefined);

export const fmtSecs = (s: number): string => (s === 0 ? "0 (none)" : s % 3600 === 0 ? `${s / 3600} h` : s % 60 === 0 ? `${s / 60} min` : `${s} s`);

interface Acct { owner: string; data: [string, string] }
async function accounts(rpc: Rpc, keys: string[]): Promise<(Acct | null)[]> {
  return (await rpc.call<{ value: (Acct | null)[] }>("getMultipleAccounts", [keys, { encoding: "base64", commitment: "confirmed" }])).value;
}

export interface ChainFacts { cluster: Cluster; readAt: string; error: string | null; squads: SquadsRead | null; programs: Record<string, { deployed: boolean; upgradeAuthority: string | null }> }

export async function readChainFacts(cluster: Cluster, rpc: Rpc, multisig: string | null, programIds: string[], now = Date.now()): Promise<ChainFacts> {
  const out: ChainFacts = { cluster, readAt: new Date(now).toISOString(), error: null, squads: null, programs: {} };
  try {
    const keys = [...(multisig ? [multisig] : []), ...programIds];
    const a = await accounts(rpc, keys);
    if (multisig) { const m = a[0]; out.squads = m && m.owner === SQUADS_PROGRAM ? decodeSquadsMultisig(base64ToBytes(m.data[0])) : null; }
    const progs = a.slice(multisig ? 1 : 0);
    const pd: { id: string; pd: string }[] = [];
    programIds.forEach((id, i) => { const p = progs[i]; const x = p && p.owner === UPGRADEABLE_LOADER ? programDataOf(base64ToBytes(p.data[0])) : null; out.programs[id] = { deployed: !!x, upgradeAuthority: null }; if (x) pd.push({ id, pd: x }); });
    if (pd.length) {
      const b = await accounts(rpc, pd.map((x) => x.pd));
      pd.forEach((x, i) => { const acc = b[i]; const auth = acc ? upgradeAuthorityOf(base64ToBytes(acc.data[0])) : undefined; out.programs[x.id].upgradeAuthority = auth ?? null; });
    }
  } catch (e) { out.error = (e as Error).message.slice(0, 200); }
  return out;
}

// ---- the joined status ----

interface Finding { id: string; severity: string; title: string; fix: string; recheck: string; deployed: string }
interface StatusFileFull {
  checkedAt: string; phase: { label: string; line: string };
  networks: Record<Cluster, { role: string; deployment: string; since: string | null; evidence: string | null }>;
  programs: { name: string; version: string; note: string }[];
  squads: Record<Cluster, { plannedTimeLockSecs: number; plannedFrom: string | null; why: string }>;
  attesters: { quorum: number; active: { label: string; independent: boolean }[]; line: string };
  settlement: { category: string; primary: string; check: string; status: string }[];
  reviews: { id: string; report: string; label: string; findings: Finding[] }[];
  releaseRequirements: { id: string; text: string; status: "open" | "done"; derivedFromChain?: string }[];
  design: string[]; historical: { label: string; path: string }[];
}
interface VerifiedBuild { kind: string; programs: { library: string; programId: string; builds: Record<Cluster, { hash: string }>; deployed: Record<Cluster, { hash: string; matchesBuild: boolean; upgradeAuthority: string } | null> }[] }
interface OperatorFile { clusters: Record<Cluster, { squads: { vault: string; multisig: string; threshold: string } }> }

export interface CurrentStatus {
  schema: "burnticker.current-status/v1"; checkedAt: string; readAt: string; source: string;
  phase: { label: string; line: string };
  host: { cluster: string; programIdWired: boolean; creatorLaunchesOpen: boolean; line: string };
  networks: { cluster: Cluster; role: string; deployment: string; since: string | null }[];
  programs: { name: string; programId: string; version: string; note: string; verifiedBuild: string; devnet: { deployed: boolean; matchesBuild: boolean | null; upgradeAuthority: string | null; authoritySource: "chain" | "verified-build" }; mainnet: { deployed: boolean; line: string } }[];
  upgradeAuthority: { cluster: Cluster; vault: string; multisig: string; threshold: string; members: number | null; timeLockSecs: number | null; timeLockSource: "chain" | "unavailable"; plannedTimeLockSecs: number; plannedFrom: string | null; why: string; line: string }[];
  attesters: StatusFileFull["attesters"]; settlement: StatusFileFull["settlement"]; reviews: StatusFileFull["reviews"];
  releaseRequirements: StatusFileFull["releaseRequirements"]; design: string[]; historical: StatusFileFull["historical"];
  lines: string[];
}

const isKey = (s: string): boolean => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);

/** The time-lock sentence: the value read from chain, the plan beside it (never the plan stated as the fact). */
export function timeLockLine(cluster: Cluster, live: number | null, planned: number, plannedFrom: string | null): string {
  if (live === null) return `${cluster} Squads time lock: could not be read from chain just now (planned: ${fmtSecs(planned)}).`;
  if (live === planned) return `${cluster} Squads time lock: ${fmtSecs(live)}, read from chain.`;
  return `${cluster} Squads time lock: ${fmtSecs(live)} now, read from chain; ${fmtSecs(planned)} planned${plannedFrom ? ` (${plannedFrom})` : ""}.`;
}

export function buildCurrentStatus(i: { root?: string; env?: Readonly<Record<string, string | undefined>>; chain: Partial<Record<Cluster, ChainFacts>>; now?: number }): CurrentStatus {
  const root = i.root ?? process.cwd(), env = i.env ?? process.env, now = i.now ?? Date.now();
  const st = readStatusFile(root) as unknown as StatusFileFull;
  const vb = JSON.parse(fs.readFileSync(path.join(root, "config", "burnticker", "verified-build.json"), "utf8")) as VerifiedBuild;
  const op = JSON.parse(fs.readFileSync(path.join(root, "config", "burnticker", "operator.json"), "utf8")) as OperatorFile;
  const cluster = (env.BURNTICKER_CLUSTER ?? "").trim() === "mainnet" ? "mainnet" : "devnet";
  const wired = isKey((env.BURNTICKER_PROGRAM_ID ?? "").trim());
  const open = /^(1|true|yes|on)$/i.test((env.BURNTICKER_CREATOR_LAUNCHES_ENABLED ?? "").trim());
  const host = { cluster, programIdWired: wired, creatorLaunchesOpen: open, line: `This host reads ${cluster}; ${wired ? "its program id is wired" : "no program id is wired on this host"}; creator launches are ${open ? "open" : "closed"}.` };
  const programs = vb.programs.map((p) => {
    const meta = st.programs.find((x) => x.name === p.library) ?? { version: "—", note: "" };
    const dev = p.deployed.devnet, liveDev = i.chain.devnet?.programs[p.programId];
    const liveMain = i.chain.mainnet?.programs[p.programId];
    const mainDeployed = !!p.deployed.mainnet || !!liveMain?.deployed;
    return {
      name: p.library, programId: p.programId, version: meta.version, note: meta.note, verifiedBuild: vb.kind,
      devnet: { deployed: liveDev ? liveDev.deployed : !!dev, matchesBuild: dev ? dev.matchesBuild : null, upgradeAuthority: liveDev?.deployed ? liveDev.upgradeAuthority : dev?.upgradeAuthority ?? null, authoritySource: (liveDev?.deployed ? "chain" : "verified-build") as "chain" | "verified-build" },
      mainnet: { deployed: mainDeployed, line: mainDeployed ? "deployed on mainnet" : "not deployed on mainnet yet" },
    };
  });
  const upgradeAuthority = (["mainnet", "devnet"] as Cluster[]).map((c) => {
    const sq = op.clusters[c].squads, plan = st.squads[c], live = i.chain[c]?.squads ?? null;
    return { cluster: c, vault: sq.vault, multisig: sq.multisig, threshold: live ? `${live.threshold} of ${live.members}` : sq.threshold, members: live?.members ?? null, timeLockSecs: live?.timeLockSecs ?? null, timeLockSource: (live ? "chain" : "unavailable") as "chain" | "unavailable", plannedTimeLockSecs: plan.plannedTimeLockSecs, plannedFrom: plan.plannedFrom, why: plan.why, line: timeLockLine(c, live?.timeLockSecs ?? null, plan.plannedTimeLockSecs, plan.plannedFrom) };
  });
  const mainTL = upgradeAuthority.find((u) => u.cluster === "mainnet")!;
  const releaseRequirements = st.releaseRequirements.map((r) => (r.derivedFromChain === "mainnet-time-lock" && mainTL.timeLockSecs !== null ? { ...r, status: (mainTL.timeLockSecs >= mainTL.plannedTimeLockSecs ? "done" : "open") as "open" | "done" } : r));
  const anyMain = programs.some((p) => p.mainnet.deployed);
  const lines = [
    st.phase.line,
    `Programs: ${programs.map((p) => `${p.name} ${p.devnet.deployed ? "deployed on devnet" : "not on devnet"}${p.devnet.matchesBuild ? " (bytes match this repository's build)" : ""}, ${p.mainnet.line}`).join("; ")}.`,
    `Signing: ${st.attesters.line}`,
    `Upgrades: the 2-of-3 Squads vault holds the upgrade authority. ${mainTL.line}`,
    `Reviews: no security firm audit; ${st.reviews.reduce((n, r) => n + r.findings.filter((f) => /not done|not re-checked/.test(f.recheck)).length, 0)} fixed findings still wait for an independent re-check.`,
    `Open before release: ${releaseRequirements.filter((r) => r.status === "open").length} requirement(s)${anyMain ? "" : ", starting with the mainnet deployment"}.`,
  ];
  const readAt = Object.values(i.chain).map((c) => c?.readAt).filter(Boolean).sort().pop() ?? new Date(now).toISOString();
  return {
    schema: "burnticker.current-status/v1", checkedAt: st.checkedAt, readAt, source: CURRENT_STATUS_FILE, phase: st.phase, host,
    networks: (["devnet", "mainnet"] as Cluster[]).map((c) => ({ cluster: c, role: st.networks[c].role, deployment: c === "mainnet" && anyMain ? "deployed" : st.networks[c].deployment, since: st.networks[c].since })),
    programs, upgradeAuthority, attesters: st.attesters, settlement: st.settlement, reviews: st.reviews, releaseRequirements, design: st.design, historical: st.historical, lines,
  };
}

// ---- the served object (cached chain reads) ----

let cache: { at: number; facts: Partial<Record<Cluster, ChainFacts>> } | null = null;
export async function currentStatusLive(env: Readonly<Record<string, string | undefined>> = process.env, root = process.cwd(), now = Date.now()): Promise<CurrentStatus> {
  if (!cache || now - cache.at > 300_000) {
    const op = JSON.parse(fs.readFileSync(path.join(root, "config", "burnticker", "operator.json"), "utf8")) as OperatorFile;
    const vb = JSON.parse(fs.readFileSync(path.join(root, "config", "burnticker", "verified-build.json"), "utf8")) as VerifiedBuild;
    const host = (env.BURNTICKER_CLUSTER ?? "").trim() === "mainnet" ? "mainnet" : "devnet";
    const rpcUrl = (c: Cluster) => (c === host && (env.BURNTICKER_RPC_URL ?? "").trim()) || PUBLIC_RPC[c];
    const ids = vb.programs.map((p) => p.programId);
    const [devnet, mainnet] = await Promise.all((["devnet", "mainnet"] as Cluster[]).map((c) => { const ms = op.clusters[c].squads.multisig; return readChainFacts(c, jsonRpc(rpcUrl(c), fetch, { attempts: 2 }), isKey(ms) ? ms : null, ids, now); }));
    cache = { at: now, facts: { devnet, mainnet } };
  }
  return buildCurrentStatus({ root, env, chain: cache.facts, now });
}
