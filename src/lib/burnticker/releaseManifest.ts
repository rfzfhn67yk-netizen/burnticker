import fs from "node:fs";
import path from "node:path";
import { REGISTRY_SCHEMA_VERSION } from "@/lib/burnticker/registry";
import { loadVerifiedBuild } from "@/lib/burnticker/trustpack/verifiedBuild";
import { PUBLIC_REPO_COMMIT } from "@/lib/burnticker/currentStatusLinks";

/** HB-110: the two public commits a release names, in words (the build JSON's publicTree.commitNote). */
export const PUBLIC_COMMIT_NOTE = "commit is the public commit this host was built from, the last one the publish pushes, which only writes the release commit into two pins. releaseCommit is that release commit, the one the changelog and /v1/trust link.";


/**
 * RELEASE IDENTITY (audit 2026-10-19 I-13). /api/burnticker/build reported only a Next build id, there was no manifest on the host, and
 * the publish copies the monorepo's working tree as it is (dirty or not) by design. Now:
 *
 *   publish   scripts/ops/public-repo-lib.mjs writes release.json at the public tree's root: the monorepo commit and whether its tree had
 *             uncommitted changes, and a digest of every published file (publicTree.sha256, recomputable from a checkout, see TREE_RECIPE).
 *   deploy    scripts/ops/deploy-burnticker-host.sh copies it into the build (<distDir>/release.json) with the build id, the public
 *             checkout's commit (and whether it was dirty) and the build time.
 *   keeper    at start the Burnticker keeper writes keeper-release.json into its publish directory: the release its own tree carries.
 *   serve     GET /api/burnticker/build adds what the running code knows: the registry schema version, both programs' hashes from the
 *             verified-build record (config/burnticker/verified-build.json, read back from chain), and the keeper's record.
 *
 * Nothing private is served: commits, digests, a build id, hashes and a schema number. No path on the host, no environment value.
 */

export const RELEASE_SCHEMA = "burnticker.release/v1";
export const RELEASE_FILE = "release.json";
export const KEEPER_RELEASE_FILE = "keeper-release.json";
/** How to recompute publicTree.sha256 from a checkout of the public repository (the same lines sha256sum prints, sorted by path). */
export const TREE_RECIPE = "git ls-files | grep -v -x -e package.json -e package-lock.json -e release.json | LC_ALL=C sort | xargs sha256sum | sha256sum";

export interface ReleaseFile {
  schema: typeof RELEASE_SCHEMA;
  publishedAt: string;
  monorepo: { commit: string; dirty: boolean };
  publicTree: { sha256: string; files: number; commit?: string | null; dirty?: boolean | null };
  build?: { id: string; builtAt: string };
}

const HEX40 = /^[0-9a-f]{40}$/, HEX64 = /^[0-9a-f]{64}$/;
/** A release file as written by the publish (and the deploy), or null when it is absent or does not have that shape. */
export function parseRelease(raw: string): ReleaseFile | null {
  let j: Partial<ReleaseFile>;
  try { j = JSON.parse(raw) as Partial<ReleaseFile>; } catch { return null; }
  if (!j || j.schema !== RELEASE_SCHEMA || !j.monorepo || !HEX40.test(String(j.monorepo.commit)) || !j.publicTree || !HEX64.test(String(j.publicTree.sha256))) return null;
  return j as ReleaseFile;
}

/** The release this tree runs: the build's copy (<distDir>/release.json, with the build) first, else the publish's at the root. */
export function readRelease(root = process.cwd(), env: Readonly<Record<string, string | undefined>> = process.env): ReleaseFile | null {
  const dist = (env.NEXT_DIST_DIR ?? "").trim() || ".next";
  for (const f of [path.join(root, dist, RELEASE_FILE), path.join(root, RELEASE_FILE)]) {
    try { const r = parseRelease(fs.readFileSync(f, "utf8")); if (r) return r; } catch { /* next */ }
  }
  return null;
}

export interface KeeperRelease { startedAt: number; monorepoCommit: string | null; publicCommit: string | null; publicTreeSha256: string | null; buildId: string | null }
/** The keeper's record of the release its tree carries, written once at start (scripts/burnticker-keeper.mts). */
export function writeKeeperRelease(siteDir: string, root = process.cwd(), now = Date.now()): KeeperRelease {
  const r = readRelease(root);
  const rec: KeeperRelease = { startedAt: now, monorepoCommit: r?.monorepo.commit ?? null, publicCommit: r?.publicTree.commit ?? null, publicTreeSha256: r?.publicTree.sha256 ?? null, buildId: r?.build?.id ?? null };
  fs.mkdirSync(siteDir, { recursive: true });
  const tmp = path.join(siteDir, `.${KEEPER_RELEASE_FILE}.${process.pid}`);
  fs.writeFileSync(tmp, `${JSON.stringify(rec)}\n`);
  fs.renameSync(tmp, path.join(siteDir, KEEPER_RELEASE_FILE));
  return rec;
}
export function readKeeperRelease(siteDir: string | null | undefined): KeeperRelease | null {
  if (!siteDir) return null;
  try {
    const j = JSON.parse(fs.readFileSync(path.join(siteDir, KEEPER_RELEASE_FILE), "utf8")) as KeeperRelease;
    return typeof j.startedAt === "number" ? j : null;
  } catch { return null; }
}

export interface ReleaseView {
  schema: typeof RELEASE_SCHEMA;
  /** false when this host has no release file (a development server, or a build shipped before 2026-10-19) */
  recorded: boolean;
  /**
   * HB-110 (hourly run 8): `commit` is the public commit this host's tree was built from: the "Pins" commit the publish pushes last, which
   * only writes the release commit into two pins. `releaseCommit` is that release commit, the one the changelog and /v1/trust link (a
   * commit cannot name itself, so the two always differ by the pins commit). `commitNote` says so in words.
   */
  publicTree: { commit: string | null; releaseCommit: string; commitNote: string; dirty: boolean | null; sha256: string | null; files: number | null; recompute: string };
  monorepo: { commit: string | null; dirty: boolean | null };
  build: { id: string | null; builtAt: string | null; matchesServed: boolean | null };
  publishedAt: string | null;
  registrySchemaVersion: number;
  programs: { library: string; programId: string; round: number | null; buildHash: { mainnet: string; devnet: string }; deployed: { mainnet: { hash: string; matchesBuild: boolean; readAt: string } | null; devnet: { hash: string; matchesBuild: boolean; readAt: string } | null } }[];
  verifiedBuild: { kind: string; record: string } | null;
  keeper: (KeeperRelease & { sameRelease: boolean | null }) | null;
}

/** What the build route serves beside the build id: the release file, the running code's schema, the programs and the keeper. */
export function releaseView(o: { servedBuildId: string | null; root?: string; env?: Readonly<Record<string, string | undefined>> }): ReleaseView {
  const env = o.env ?? process.env, root = o.root ?? process.cwd();
  const r = readRelease(root, env);
  let programs: ReleaseView["programs"] = [], verifiedBuild: ReleaseView["verifiedBuild"] = null;
  try {
    const vb = loadVerifiedBuild(root);
    verifiedBuild = { kind: vb.kind, record: "config/burnticker/verified-build.json" };
    const dep = (d: { hash: string; matchesBuild: boolean; readAt: string } | null) => (d ? { hash: d.hash, matchesBuild: d.matchesBuild, readAt: d.readAt } : null);
    programs = vb.programs.map((p) => ({ library: p.library, programId: p.programId, round: p.round ?? null, buildHash: { mainnet: p.builds.mainnet.hash, devnet: p.builds.devnet.hash }, deployed: { mainnet: dep(p.deployed.mainnet), devnet: dep(p.deployed.devnet) } }));
  } catch { /* no record on this host: programs stay empty */ }
  const k = readKeeperRelease((env.BURNTICKER_PUBLISH_DIR ?? "").trim() || path.join(root, "data", "burnticker-site"));
  return {
    schema: RELEASE_SCHEMA, recorded: !!r,
    publicTree: { commit: r?.publicTree.commit ?? null, releaseCommit: PUBLIC_REPO_COMMIT, commitNote: PUBLIC_COMMIT_NOTE, dirty: r?.publicTree.dirty ?? null, sha256: r?.publicTree.sha256 ?? null, files: r?.publicTree.files ?? null, recompute: TREE_RECIPE },
    monorepo: { commit: r?.monorepo.commit ?? null, dirty: r?.monorepo.dirty ?? null },
    build: { id: r?.build?.id ?? null, builtAt: r?.build?.builtAt ?? null, matchesServed: r?.build && o.servedBuildId ? r.build.id === o.servedBuildId : null },
    publishedAt: r?.publishedAt ?? null,
    registrySchemaVersion: REGISTRY_SCHEMA_VERSION,
    programs, verifiedBuild,
    keeper: k ? { ...k, sameRelease: r ? k.publicTreeSha256 === r.publicTree.sha256 : null } : null,
  };
}
