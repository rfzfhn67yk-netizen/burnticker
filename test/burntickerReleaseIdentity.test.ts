// I-13 (audit 2026-10-19): /api/burnticker/build reported only a build id; there was no manifest on the host and the publish copies a
// dirty working tree by design. Now the publish writes release.json (monorepo commit and dirty flag, a recomputable digest of the public
// tree), the deploy adds the build id and the public commit into the build, the keeper records the release it runs, and the build route
// serves all of it with the registry schema version and both programs' hashes from the verified-build record.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { KEEPER_RELEASE_FILE, parseRelease, PUBLIC_COMMIT_NOTE, readRelease, releaseView, TREE_RECIPE, writeKeeperRelease } from "@/lib/burnticker/releaseManifest";
import { PUBLIC_REPO_COMMIT } from "@/lib/burnticker/currentStatusLinks";
import { REGISTRY_SCHEMA_VERSION } from "@/lib/burnticker/registry";
import { lintCopy } from "@/lib/launch/copyLint";

const ROOT = path.join(import.meta.dirname, "..");
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");
const MONO = "a".repeat(40), PUB = "b".repeat(40), TREE = "c".repeat(64);

/** A host tree: config/burnticker/verified-build.json copied in, the publish's release.json, optionally the build's copy. */
function tree(o: { build?: string | null; site?: string } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bt-release-"));
  fs.mkdirSync(path.join(root, "config", "burnticker"), { recursive: true });
  fs.copyFileSync(path.join(ROOT, "config", "burnticker", "verified-build.json"), path.join(root, "config", "burnticker", "verified-build.json"));
  const rel = { schema: "burnticker.release/v1", publishedAt: "2026-10-19T15:00:00.000Z", monorepo: { commit: MONO, dirty: true }, publicTree: { sha256: TREE, files: 2402 } };
  fs.writeFileSync(path.join(root, "release.json"), JSON.stringify(rel));
  if (o.build) { fs.mkdirSync(path.join(root, ".next"), { recursive: true }); fs.writeFileSync(path.join(root, ".next", "release.json"), JSON.stringify({ ...rel, publicTree: { ...rel.publicTree, commit: PUB, dirty: false }, build: { id: o.build, builtAt: "2026-10-19T15:05:00.000Z" } })); }
  return root;
}

describe("I-13: the release record", () => {
  test("the build route serves the public commit and digest, the monorepo commit, the build, the schema version and both program hashes", () => {
    const root = tree({ build: "build-42" });
    const v = releaseView({ servedBuildId: "build-42", root, env: { BURNTICKER_PUBLISH_DIR: path.join(root, "site") } });
    assert.equal(v.recorded, true);
    // HB-110 (hourly run 8): beside the served commit, the release commit the changelog links and a note on the two
    assert.deepEqual(v.publicTree, { commit: PUB, releaseCommit: PUBLIC_REPO_COMMIT, commitNote: PUBLIC_COMMIT_NOTE, dirty: false, sha256: TREE, files: 2402, recompute: TREE_RECIPE });
    assert.deepEqual(v.monorepo, { commit: MONO, dirty: true }, "a dirty publish says so");
    assert.deepEqual(v.build, { id: "build-42", builtAt: "2026-10-19T15:05:00.000Z", matchesServed: true });
    assert.equal(v.registrySchemaVersion, REGISTRY_SCHEMA_VERSION);
    const vb = JSON.parse(read("config/burnticker/verified-build.json")) as { programs: { library: string; deployed: { mainnet: { hash: string } } }[] };
    assert.deepEqual(v.programs.map((p) => p.library).sort(), ["burn_receipts", "pair_curve"]);
    for (const p of vb.programs) assert.equal(v.programs.find((x) => x.library === p.library)!.deployed.mainnet?.hash, p.deployed.mainnet.hash);
    assert.equal(v.keeper, null);
  });
  test("a build that does not match the served id, a tree with only the publish's record, and a tree with none", () => {
    assert.equal(releaseView({ servedBuildId: "other", root: tree({ build: "build-42" }), env: {} }).build.matchesServed, false);
    const pubOnly = releaseView({ servedBuildId: "x", root: tree(), env: {} });
    assert.equal(pubOnly.recorded, true); assert.equal(pubOnly.build.id, null); assert.equal(pubOnly.publicTree.commit, null);
    const none = fs.mkdtempSync(path.join(os.tmpdir(), "bt-release-"));
    const v = releaseView({ servedBuildId: null, root: none, env: {} });
    assert.equal(v.recorded, false); assert.equal(v.monorepo.commit, null); assert.deepEqual(v.programs, []);
    assert.equal(parseRelease("{\"schema\":\"burnticker.release/v1\",\"monorepo\":{\"commit\":\"zz\"}}"), null, "a malformed record is ignored");
  });
  test("the keeper records the release its tree carries; the route says whether it is the same release", () => {
    const root = tree({ build: "build-42" }), site = path.join(root, "site");
    const k = writeKeeperRelease(site, root, 1_000);
    assert.deepEqual(k, { startedAt: 1_000, monorepoCommit: MONO, publicCommit: PUB, publicTreeSha256: TREE, buildId: "build-42" });
    assert.ok(fs.existsSync(path.join(site, KEEPER_RELEASE_FILE)));
    const v = releaseView({ servedBuildId: "build-42", root, env: { BURNTICKER_PUBLISH_DIR: site } });
    assert.equal(v.keeper?.sameRelease, true);
    fs.writeFileSync(path.join(site, KEEPER_RELEASE_FILE), JSON.stringify({ ...k, publicTreeSha256: "d".repeat(64) }));
    assert.equal(releaseView({ servedBuildId: "build-42", root, env: { BURNTICKER_PUBLISH_DIR: site } }).keeper?.sameRelease, false, "a keeper still on the old code shows");
    assert.equal(readRelease(root)?.build?.id, "build-42");
  });
  test("nothing private: no host path, no environment value, only commits, digests, ids and hashes", () => {
    const root = tree({ build: "build-42" });
    const s = JSON.stringify(releaseView({ servedBuildId: "build-42", root, env: { BURNTICKER_PUBLISH_DIR: path.join(root, "site"), BURNTICKER_RPC_URL: "https://secret.example/?api-key=SECRET" } }));
    assert.ok(!s.includes(root) && !s.includes("SECRET") && !s.includes(os.tmpdir()));
  });
});

describe("I-13: the wiring", () => {
  test("the route serves build, startedAt (the deploy smoke reads both) and release", () => {
    const r = read("src/app/api/burnticker/build/route.ts");
    assert.match(r, /NextResponse\.json\(\{ build, startedAt: processStartedAtMs\(\), release \}/);
  });
  test("the publish writes release.json with the tree digest, the deploy adds the build, the keeper writes its record", () => {
    const lib = read("scripts/ops/public-repo-lib.mjs");
    assert.match(lib, /const rel = writeRelease\(manifest\);/);
    assert.match(lib, /\$\{sha256\(fs\.readFileSync\(path\.join\(dir, p\)\)\)\}  \$\{p\}\\n/, "sha256sum's line format, so TREE_RECIPE recomputes it");
    assert.match(lib, /new Set\(\[\.\.\.manifest\.keys\(\), "package\.json", "package-lock\.json", "release\.json"\]\)/);
    assert.match(read("scripts/burnticker-keeper.mts"), /writeKeeperRelease\(SITE, process\.cwd\(\), KEEPER_STARTED_AT\)/);
    if (fs.existsSync(path.join(ROOT, "scripts/ops/deploy-burnticker-host.sh"))) {
      const d = read("scripts/ops/deploy-burnticker-host.sh");
      assert.match(d, /> "\$SRC\/\$DIST\/release\.json"/);
      assert.ok(d.indexOf("# >>> release record") < d.indexOf("copying the build"), "written before the build is copied");
    }
  });
  test("the trust page links the release record in plain words", () => {
    const page = read("src/app/burnticker/trust/page.tsx");
    const line = page.slice(page.indexOf("This release:"), page.indexOf("</li>", page.indexOf("This release:")));
    assert.match(line, /href="\/api\/burnticker\/build"/);
    const text = line.replace(/<[^>]+>/g, " ").replace(/&apos;/g, "'");
    assert.equal(lintCopy(text).hits.length, 0, JSON.stringify(lintCopy(text).hits));
  });
});
