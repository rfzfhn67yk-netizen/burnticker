import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/**
 * THE VERIFIED-BUILD TABLE (trust pack, 2026-10-10): config/burnticker/verified-build.json, written by scripts/ops/verified-build.sh.
 * The executable hash is solana-verify's: sha256 over the program bytes with trailing zero bytes removed, so a .so built here, a
 * `solana program dump` of the deployed program (padded to the ProgramData length) and `solana-verify get-program-hash` all compare.
 */

export const VERIFIED_BUILD_FILE = path.join("config", "burnticker", "verified-build.json");
export type BuildVariant = "mainnet" | "devnet";
export interface ProgramBuild { features: string[]; bytes: number; hash: string }
export interface Deployed { hash: string; programData: string; upgradeAuthority: string; readAt: string; matchesBuild: boolean; /** the slot the deployed bytes were written at (recorded from round 5) */ slot?: number; /** the read-back's record: stored per program since round 5 (2026-10-16); else filled by the checklist from DEPLOY_EVIDENCE */ evidence?: string;
  /**
   * B-17 (2026-10-21): set when the record's build is newer than the bytes on this network and its upgrade has not been deployed yet
   * (matchesBuild is then false, and `hash` is the earlier build that runs now). A plain note for the operator; the pages say it with
   * pendingUpgradeSentence. Absent when the bytes match, or when they differ for any other reason (then the pages say they DO NOT match).
   */
  pendingUpgrade?: string }
/**
 * Where each network's deployed-bytes read is recorded (audit R05, 2026-10-11): the check page's build table names it per row. The
 * table's own `deployed.<network>.evidence` wins (round 5, 2026-10-16: burn_receipts reads back in mainnet-round5, pair_curve still in
 * mainnet-round4); these are the fallbacks. Mainnet: the latest upgrade read-back; devnet: the verified-build doc (scripts/ops/verified-build.sh
 * --onchain devnet).
 */
export const DEPLOY_EVIDENCE: Record<BuildVariant, string> = {
  mainnet: "docs/burnkeeper/evidence/mainnet-round5/onchain-verify-after.log",
  devnet: "docs/burnticker/VERIFIED-BUILD.md",
};
export interface VerifiedBuild {
  schema: "burnticker.verified-build/v1"; updatedAt: string; note: string;
  kind: "interim-local" | "docker"; kindNote: string; sourceCommit: string; sourceCommitNote: string;
  toolchain: Record<string, string>; workspace: string;
  programs: {
    library: string; programId: string;
    /** The program round its deployed bytes are (round 5, 2026-10-16: burn_receipts 5, pair_curve 4 — pair_curve was not upgraded). */
    round?: number;
    /** The source commit of THIS program's builds when it differs from the table's (pair_curve: round 4's 29f6f5de). */
    sourceCommit?: string;
    /** B-17 (2026-10-21): the source commit of the bytes on chain while an upgrade to this build is pending (burn_receipts: round 5's 089024ff). */
    deployedSourceCommit?: string;
    builds: Record<BuildVariant, ProgramBuild>; deployed: { devnet: Deployed | null; mainnet: Deployed | null };
  }[];
}

export function executableHash(bytes: Uint8Array): string {
  let n = bytes.length;
  while (n > 0 && bytes[n - 1] === 0) n--;
  return crypto.createHash("sha256").update(bytes.subarray(0, n)).digest("hex");
}

export function verifiedBuildProblems(t: Partial<VerifiedBuild> | null): string[] {
  const out: string[] = [];
  if (!t || t.schema !== "burnticker.verified-build/v1") return ["schema must be burnticker.verified-build/v1"];
  if (t.kind !== "interim-local" && t.kind !== "docker") out.push("kind must be interim-local or docker");
  if (!/^[0-9a-f]{40}$/.test(String(t.sourceCommit))) out.push("sourceCommit must be a 40-hex git commit");
  const libs = (t.programs ?? []).map((p) => p.library).sort();
  if (JSON.stringify(libs) !== JSON.stringify(["burn_receipts", "pair_curve"])) out.push("programs must be burn_receipts and pair_curve");
  for (const p of t.programs ?? []) {
    if (p.sourceCommit !== undefined && !/^[0-9a-f]{40}$/.test(String(p.sourceCommit))) out.push(`${p.library}.sourceCommit must be a 40-hex git commit`);
    if (p.deployedSourceCommit !== undefined && !/^[0-9a-f]{40}$/.test(String(p.deployedSourceCommit))) out.push(`${p.library}.deployedSourceCommit must be a 40-hex git commit`);
    if (p.deployedSourceCommit !== undefined && !(["mainnet", "devnet"] as BuildVariant[]).some((v) => p.deployed?.[v]?.pendingUpgrade)) out.push(`${p.library}.deployedSourceCommit is set only while an upgrade is pending`);
    if (p.round !== undefined && !(Number.isInteger(p.round) && p.round >= 1)) out.push(`${p.library}.round must be a positive integer`);
  }
  for (const p of t.programs ?? []) for (const v of ["mainnet", "devnet"] as BuildVariant[]) {
    const b = p.builds?.[v];
    if (!b || !/^[0-9a-f]{64}$/.test(b.hash)) out.push(`${p.library}.${v}: hash must be 64 hex`);
    if (b && v === "devnet" && !b.features.includes("devnet")) out.push(`${p.library}.devnet must build with --features devnet`);
    const d = p.deployed?.[v];
    if (d && d.matchesBuild !== (d.hash === b?.hash)) out.push(`${p.library}.deployed.${v}.matchesBuild disagrees with the hashes`);
    if (d && d.pendingUpgrade !== undefined && (d.matchesBuild || typeof d.pendingUpgrade !== "string" || !d.pendingUpgrade.trim())) out.push(`${p.library}.deployed.${v}.pendingUpgrade is a note, set only while the deployed bytes differ from the build`);
  }
  return out;
}

/**
 * B-17 (2026-10-21): what the pages say for a network whose record holds a newer build than the bytes deployed there (deployed.pendingUpgrade).
 * It never calls the newer build verified: that waits until the bytes read back from chain equal it.
 */
export function pendingUpgradeSentence(network: BuildVariant, buildHash: string, deployedHash: string): string {
  return `This repository has a newer build (${buildHash}) whose upgrade has not been deployed on ${network}, so the bytes there are still the earlier build (${deployedHash}). The newer build is not verified on chain until the bytes read back from ${network} match it.`;
}

/** The deployed-bytes state of one network, for the pages: same as the build, a newer build not deployed yet, or different. */
export type DeployedBytesState = "matches" | "upgrade-pending" | "differs";
export function deployedBytesState(d: Pick<Deployed, "matchesBuild" | "pendingUpgrade">): DeployedBytesState {
  return d.matchesBuild ? "matches" : d.pendingUpgrade ? "upgrade-pending" : "differs";
}

export function loadVerifiedBuild(root = process.cwd()): VerifiedBuild {
  const t = JSON.parse(fs.readFileSync(path.join(root, VERIFIED_BUILD_FILE), "utf8")) as VerifiedBuild;
  const bad = verifiedBuildProblems(t);
  if (bad.length) throw new Error(`${VERIFIED_BUILD_FILE}: ${bad.join("; ")}`);
  return t;
}

/** Built .so files on this host to compare: target/deploy (default build) and target/deploy-devnet (the devnet build), when present. */
export function builtArtifacts(root = process.cwd()): { library: string; variant: BuildVariant; file: string }[] {
  const ws = path.join(root, "programs", "burn-receipts", "target");
  const out: { library: string; variant: BuildVariant; file: string }[] = [];
  for (const [dir, variant] of [["deploy", "mainnet"], ["deploy-devnet", "devnet"]] as const) for (const library of ["burn_receipts", "pair_curve"]) {
    const file = path.join(ws, dir, `${library}.so`);
    if (fs.existsSync(file)) out.push({ library, variant, file });
  }
  return out;
}
