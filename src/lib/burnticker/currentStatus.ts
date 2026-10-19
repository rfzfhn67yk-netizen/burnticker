import fs from "node:fs";
import { EARLIER_COINS_LINE, OPERATOR_SHARE_LINE } from "@/lib/burnticker/feeShareLine";
import { siteLaunchState } from "@/lib/burnticker/launchAvailability";
import path from "node:path";
import { b58encode, base64ToBytes } from "@/lib/burnticker/trustpack/base58";
import { jsonRpc, type Rpc } from "@/lib/burnticker/trustpack/receiptCheck";
import { rpcUrlFor } from "@/lib/burnticker/networks";
import { CURRENT_STATUS_FILE, readStatusFile } from "@/lib/burnticker/deficitPrelaunch";
import type { AuthoritySource } from "@/lib/burnticker/currentStatusText";
export { upgradeAuthorityText, upgradeDelaySummary, type AuthoritySource } from "@/lib/burnticker/currentStatusText";

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
/** undefined = not decodable (wrong type, truncated, an option tag other than 0/1, or Some with its key cut off) — never read as "none". */
export const upgradeAuthorityOf = (d: Uint8Array): string | null | undefined => {
  if (d.length < 13 || d[0] !== 3) return undefined;
  if (d[12] === 0) return null;
  if (d[12] === 1 && d.length >= 45) return b58encode(d.subarray(13, 45));
  return undefined;
};

import { fmtSecs } from "@/lib/burnticker/currentStatusText";
export { fmtSecs };

interface Acct { owner: string; data: [string, string] }
async function accounts(rpc: Rpc, keys: string[]): Promise<(Acct | null)[]> {
  return (await rpc.call<{ value: (Acct | null)[] }>("getMultipleAccounts", [keys, { encoding: "base64", commitment: "confirmed" }])).value;
}

/**
 * One program's upgrade-authority read (F1, 2026-10-11). "decoded" means the ProgramData account was fetched, owned by the upgradeable
 * loader and decoded — only then does `upgradeAuthority: null` mean "no upgrade authority". A failed, partial or malformed read is
 * "unavailable" and its `upgradeAuthority` carries no meaning.
 */
export type AuthorityRead = "decoded" | "unavailable";
export interface ProgramRead { deployed: boolean; upgradeAuthority: string | null; authorityRead: AuthorityRead }
export interface ChainFacts { cluster: Cluster; readAt: string; error: string | null; squads: SquadsRead | null; programs: Record<string, ProgramRead> }

export async function readChainFacts(cluster: Cluster, rpc: Rpc, multisig: string | null, programIds: string[], now = Date.now()): Promise<ChainFacts> {
  const out: ChainFacts = { cluster, readAt: new Date(now).toISOString(), error: null, squads: null, programs: {} };
  try {
    const keys = [...(multisig ? [multisig] : []), ...programIds];
    const a = await accounts(rpc, keys);
    if (multisig) { const m = a[0]; out.squads = m && m.owner === SQUADS_PROGRAM ? decodeSquadsMultisig(base64ToBytes(m.data[0])) : null; }
    const progs = a.slice(multisig ? 1 : 0);
    const pd: { id: string; pd: string }[] = [];
    programIds.forEach((id, i) => { const p = progs[i]; const x = p && p.owner === UPGRADEABLE_LOADER ? programDataOf(base64ToBytes(p.data[0])) : null; out.programs[id] = { deployed: !!x, upgradeAuthority: null, authorityRead: "unavailable" }; if (x) pd.push({ id, pd: x }); });
    if (pd.length) {
      const b = await accounts(rpc, pd.map((x) => x.pd));
      pd.forEach((x, i) => {
        const acc = b?.[i];
        // a missing account, a foreign owner or bytes that do not decode stay "unavailable" — never read as "no upgrade authority"
        const auth = acc && acc.owner === UPGRADEABLE_LOADER && Array.isArray(acc.data) ? upgradeAuthorityOf(base64ToBytes(acc.data[0])) : undefined;
        if (auth !== undefined) out.programs[x.id] = { deployed: true, upgradeAuthority: auth, authorityRead: "decoded" };
      });
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
  squads: Record<Cluster, { plannedTimeLockSecs: number; plannedFrom: string | null; why: string; keyControl?: string }>;
  attesters: { quorum: number; active: { label: string; independent: boolean }[]; line: string };
  settlement: { category: string; primary: string; check: string; status: string }[];
  reviews: { id: string; report: string; label: string; findings: Finding[] }[];
  releaseRequirements: { id: string; text: string; status: "open" | "done"; derivedFromChain?: string }[];
  design: string[]; historical: { label: string; path: string }[];
  deficit: { firstBurnPath: { doc: string; line: string } };
}
interface VerifiedBuild { kind: string; programs: { library: string; programId: string; builds: Record<Cluster, { hash: string }>; deployed: Record<Cluster, { hash: string; matchesBuild: boolean; upgradeAuthority: string; readAt?: string } | null> }[] }
interface OperatorFile { clusters: Record<Cluster, { squads: { vault: string; multisig: string; threshold: string } }> }

export interface CurrentStatus {
  schema: "burnticker.current-status/v1"; checkedAt: string; readAt: string; source: string;
  phase: { label: string; line: string };
  host: { cluster: string; programIdWired: boolean; creatorLaunchesOpen: boolean; /** website-12: a launch started on this site can be signed (siteLaunchState.canSign) */ canSign: boolean; line: string };
  networks: { cluster: Cluster; role: string; deployment: string; since: string | null }[];
  programs: { name: string; programId: string; version: string; note: string; verifiedBuild: string; devnet: { deployed: boolean; matchesBuild: boolean | null; upgradeAuthority: string | null; authoritySource: AuthoritySource; recordedAt: string | null; recordedUpgradeAuthority: string | null }; mainnet: { deployed: boolean | null; source: "chain" | "verified-build" | "unavailable"; line: string; matchesBuild?: boolean | null } }[];
  upgradeAuthority: { cluster: Cluster; vault: string; multisig: string; threshold: string; members: number | null; timeLockSecs: number | null; timeLockSource: "chain" | "unavailable"; plannedTimeLockSecs: number; plannedFrom: string | null; why: string; line: string }[];
  attesters: StatusFileFull["attesters"]; settlement: StatusFileFull["settlement"]; reviews: StatusFileFull["reviews"];
  releaseRequirements: StatusFileFull["releaseRequirements"]; design: string[]; historical: StatusFileFull["historical"];
  /** the $DEFICIT prerequisite chain (docs/burnticker/FIRST-BURN-PATH.md) and its one line */
  firstBurnPath: { doc: string; line: string };
  lines: string[];
}

/** A program's devnet authority from the live read (when one was made) or the verified-build record. */
export function devnetAuthority(live: ProgramRead | undefined, recorded: string | null | undefined, readFailed = false): { upgradeAuthority: string | null; authoritySource: AuthoritySource } {
  if (live?.deployed) return live.authorityRead === "decoded" ? { upgradeAuthority: live.upgradeAuthority, authoritySource: "chain" } : { upgradeAuthority: null, authoritySource: "unavailable" };
  // a live read was made and did not reach this program: unavailable (the dated verified-build record is still shown beside it)
  if (readFailed) return { upgradeAuthority: null, authoritySource: "unavailable" };
  return { upgradeAuthority: recorded ?? null, authoritySource: "verified-build" };
}

/**
 * A program's mainnet deployment as a known/unknown state (F1's second instance): "deployed" from the verified-build record or a
 * successful chain read; "not deployed" only when the read succeeded (or no read was made and the record says so); "unknown" when a
 * read was made and failed before it reached this program.
 */
export function mainnetDeployment(recorded: boolean, facts: ChainFacts | undefined, programId: string, build?: { matchesBuild: boolean; upgradeAuthority: string; readAt?: string } | null): { deployed: boolean | null; source: "chain" | "verified-build" | "unavailable"; line: string; matchesBuild?: boolean | null } {
  const live = facts?.programs[programId];
  if (recorded || live?.deployed) {
    // I-1 (audit 2026-10-19): the mainnet read-back is stated too (bytes and authority), never only devnet's
    const auth = live?.deployed && live.authorityRead === "decoded" ? (live.upgradeAuthority ? `Its mainnet upgrade authority is ${live.upgradeAuthority}, read from chain.` : "It has no mainnet upgrade authority, read from chain.")
      : build ? `Its mainnet upgrade authority is ${build.upgradeAuthority}, as recorded in verified-build.json${build.readAt ? ` on ${build.readAt}` : ""}.` : "";
    const bytes = build ? (build.matchesBuild ? " Its bytes there match this repository's recorded build." : " Its bytes there DO NOT match the recorded build.") : "";
    return { deployed: true, source: live?.deployed ? "chain" : "verified-build", line: `It is deployed on mainnet.${bytes}${auth ? ` ${auth}` : ""}`, ...(build ? { matchesBuild: build.matchesBuild } : {}) };
  }
  if (live) return { deployed: false, source: "chain", line: "It is not deployed on mainnet yet." };
  if (facts) return { deployed: null, source: "unavailable", line: "Its mainnet deployment is unknown because the chain read failed." };
  return { deployed: false, source: "verified-build", line: "It is not deployed on mainnet yet." };
}

const isKey = (s: string): boolean => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);

/** The time-lock sentence: the value read from chain, the plan beside it (never the plan stated as the fact). */
export function timeLockLine(cluster: Cluster, live: number | null, planned: number, plannedFrom: string | null): string {
  const Name = cluster === "mainnet" ? "The mainnet" : "The devnet";
  if (live === null) return `${Name} Squads time lock could not be read from chain just now. The plan is ${fmtSecs(planned)}.`;
  if (live === planned) return `${Name} Squads time lock is ${fmtSecs(live)}, read from chain.`;
  return `${Name} Squads time lock is ${fmtSecs(live)} today, read from chain. The plan is ${fmtSecs(planned)}${plannedFrom ? ` from ${plannedFrom}` : ""}.`;
}

/** A plain name for each program, said before its code name (website-9 copy pass). */
export const PROGRAM_PLAIN_NAME: Record<string, string> = { burn_receipts: "the program that records burns", pair_curve: "the program that runs pair launches" };
const plainName = (lib: string): string => PROGRAM_PLAIN_NAME[lib] ?? "the program";
const cap = (t: string): string => t.charAt(0).toUpperCase() + t.slice(1);
const NUMBER_WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve"];
/** A count at the start of a sentence: "Eight", or digits past twelve. */
export const countWord = (n: number): string => NUMBER_WORDS[n] ?? String(n);

export function buildCurrentStatus(i: { root?: string; env?: Readonly<Record<string, string | undefined>>; chain: Partial<Record<Cluster, ChainFacts>>; now?: number }): CurrentStatus {
  const root = i.root ?? process.cwd(), env = i.env ?? process.env, now = i.now ?? Date.now();
  const st = readStatusFile(root) as unknown as StatusFileFull;
  const vb = JSON.parse(fs.readFileSync(path.join(root, "config", "burnticker", "verified-build.json"), "utf8")) as VerifiedBuild;
  const op = JSON.parse(fs.readFileSync(path.join(root, "config", "burnticker", "operator.json"), "utf8")) as OperatorFile;
  const cluster = (env.BURNTICKER_CLUSTER ?? "").trim() === "mainnet" ? "mainnet" : "devnet";
  const wired = isKey((env.BURNTICKER_PROGRAM_ID ?? "").trim());
  const open = /^(1|true|yes|on)$/i.test((env.BURNTICKER_CREATOR_LAUNCHES_ENABLED ?? "").trim());
  // website-12: the launch sentence is the one typed record's (launchAvailability.ts siteLaunchState), never written here
  const launch = siteLaunchState(env, now);
  const host = { cluster, programIdWired: wired, creatorLaunchesOpen: open, canSign: launch.canSign, line: `This site is showing ${cluster}.${wired ? "" : " No program is connected on this site."} ${launch.sentence}` };
  const programs = vb.programs.map((p) => {
    const meta = st.programs.find((x) => x.name === p.library) ?? { version: "—", note: "" };
    const dev = p.deployed.devnet, liveDev = i.chain.devnet?.programs[p.programId];
    const devReadFailed = !!i.chain.devnet && !liveDev;
    return {
      name: p.library, programId: p.programId, version: meta.version, note: meta.note, verifiedBuild: vb.kind,
      devnet: { deployed: liveDev ? liveDev.deployed : !!dev, matchesBuild: dev ? dev.matchesBuild : null, ...devnetAuthority(liveDev, dev?.upgradeAuthority, devReadFailed), recordedAt: dev?.readAt ?? null, recordedUpgradeAuthority: dev?.upgradeAuthority ?? null },
      mainnet: mainnetDeployment(!!p.deployed.mainnet, i.chain.mainnet, p.programId, p.deployed.mainnet),
    };
  });
  const upgradeAuthority = (["mainnet", "devnet"] as Cluster[]).map((c) => {
    const sq = op.clusters[c].squads, plan = st.squads[c], live = i.chain[c]?.squads ?? null;
    return { cluster: c, vault: sq.vault, multisig: sq.multisig, threshold: live ? `${live.threshold} of ${live.members}` : sq.threshold, members: live?.members ?? null, timeLockSecs: live?.timeLockSecs ?? null, timeLockSource: (live ? "chain" : "unavailable") as "chain" | "unavailable", plannedTimeLockSecs: plan.plannedTimeLockSecs, plannedFrom: plan.plannedFrom, why: plan.why, line: timeLockLine(c, live?.timeLockSecs ?? null, plan.plannedTimeLockSecs, plan.plannedFrom) };
  });
  const mainTL = upgradeAuthority.find((u) => u.cluster === "mainnet")!;
  const anyMain = programs.some((p) => p.mainnet.deployed === true), mainUnknown = !anyMain && programs.some((p) => p.mainnet.deployed === null);
  const allMain = programs.every((p) => p.mainnet.deployed === true), noneMainKnown = programs.every((p) => p.mainnet.deployed === false);
  // audit 4 BT-02: the deployment gate is derived from the same typed deployment state as the prose (deployed / absent; unknown keeps the file's value)
  const releaseRequirements = st.releaseRequirements.map((r) => {
    if (r.derivedFromChain === "mainnet-time-lock" && mainTL.timeLockSecs !== null) return { ...r, status: (mainTL.timeLockSecs >= mainTL.plannedTimeLockSecs ? "done" : "open") as "open" | "done" };
    if (r.derivedFromChain === "mainnet-deployment" && (allMain || noneMainKnown)) return { ...r, status: (allMain ? "done" : "open") as "open" | "done" };
    return r;
  });
  const waiting = st.reviews.reduce((n, r) => n + r.findings.filter((f) => /not done|not re-checked/.test(f.recheck)).length, 0);
  const openCount = releaseRequirements.filter((r) => r.status === "open").length;
  const lines = [
    st.phase.line,
    st.deficit.firstBurnPath.line,
    // Claude audit 2 item 2c: one sentence per program when both networks agree it is deployed
    ...programs.map((p) => (p.devnet.deployed && p.mainnet.deployed === true
      ? `${cap(plainName(p.name))} (${p.name}) is deployed on devnet and on mainnet.${p.devnet.matchesBuild && p.mainnet.matchesBuild ? " On both networks its bytes match this repository's recorded build." : p.mainnet.matchesBuild ? " On mainnet its bytes match this repository's recorded build." : p.devnet.matchesBuild ? " On devnet its bytes match this repository's build." : ""}`
      : `${cap(plainName(p.name))} (${p.name}) is ${p.devnet.deployed ? `deployed on devnet${p.devnet.matchesBuild ? ", and its bytes match this repository's build" : ""}` : "not on devnet"}. ${p.mainnet.line}`)),
    st.attesters.line,
    // audit 4 BT-12: who can authorise an upgrade and how much notice there is, in the top-level summary (keys vs controllers)
    `The 2-of-3 Squads vault holds the upgrade authority. ${st.squads.mainnet.keyControl ? `${st.squads.mainnet.keyControl} ` : ""}${mainTL.line}${mainTL.timeLockSecs === 0 ? " With no time lock, an approved upgrade executes at once, with no advance notice." : ""}`,
    `The operator earns 0.25% of curve trading volume. ${OPERATOR_SHARE_LINE} ${EARLIER_COINS_LINE} The coin side of the liquidity fees is burned. Creators take no cash from fees.`,
    `No security firm has audited the code. ${waiting === 1 ? "One fixed finding still waits" : `${countWord(waiting)} fixed findings still wait`} for an independent re-check.`,
    `${openCount === 1 ? "One thing is" : `${countWord(openCount)} things are`} still open before release.${anyMain || mainUnknown ? "" : " The first is the mainnet deployment."}`,
  ];
  const readAt = Object.values(i.chain).map((c) => c?.readAt).filter(Boolean).sort().pop() ?? new Date(now).toISOString();
  return {
    schema: "burnticker.current-status/v1", checkedAt: st.checkedAt, readAt, source: CURRENT_STATUS_FILE, phase: st.phase, host,
    networks: (["devnet", "mainnet"] as Cluster[]).map((c) => ({ cluster: c, role: st.networks[c].role, deployment: c === "mainnet" && anyMain ? "deployed" : c === "mainnet" && mainUnknown ? "unknown, because the chain read failed" : st.networks[c].deployment, since: st.networks[c].since })),
    programs, upgradeAuthority, attesters: st.attesters, settlement: st.settlement, reviews: st.reviews, releaseRequirements, design: st.design, historical: st.historical, firstBurnPath: st.deficit.firstBurnPath, lines,
  };
}

// ---- the served object (cached chain reads) ----

let cache: { at: number; facts: Partial<Record<Cluster, ChainFacts>> } | null = null;
export async function currentStatusLive(env: Readonly<Record<string, string | undefined>> = process.env, root = process.cwd(), now = Date.now()): Promise<CurrentStatus> {
  if (!cache || now - cache.at > 300_000) {
    const op = JSON.parse(fs.readFileSync(path.join(root, "config", "burnticker", "operator.json"), "utf8")) as OperatorFile;
    const vb = JSON.parse(fs.readFileSync(path.join(root, "config", "burnticker", "verified-build.json"), "utf8")) as VerifiedBuild;
    const rpcUrl = (c: Cluster) => rpcUrlFor(c, env);
    const ids = vb.programs.map((p) => p.programId);
    const [devnet, mainnet] = await Promise.all((["devnet", "mainnet"] as Cluster[]).map((c) => { const ms = op.clusters[c].squads.multisig; return readChainFacts(c, jsonRpc(rpcUrl(c), fetch, { attempts: 2 }), isKey(ms) ? ms : null, ids, now); }));
    cache = { at: now, facts: { devnet, mainnet } };
  }
  return buildCurrentStatus({ root, env, chain: cache.facts, now });
}

/**
 * website-12 (A9): the time lock last read from chain for `cluster`, from the cache above, without a new read (null = not read yet). The
 * launch review shows it beside the review; the review route refreshes the cache in the background on a production host.
 */
export function cachedTimeLockSecs(cluster: Cluster): number | null {
  return cache?.facts[cluster]?.squads?.timeLockSecs ?? null;
}
