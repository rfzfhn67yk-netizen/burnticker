// THE VERIFIED BUILD (trust pack, 2026-10-10): config/burnticker/verified-build.json (written by scripts/ops/verified-build.sh) is
// well-formed, docs/burnticker/VERIFIED-BUILD.md shows every hash in it and says plainly whether the build is interim or Docker, the
// executable hash is solana-verify's (trailing zero bytes stripped, so a padded `solana program dump` hashes the same as the .so), and
// — like the IDL test — WHEN A BUILT PROGRAM IS PRESENT ON THIS HOST its hash is one of the table's (default build in
// target/deploy, devnet build in target/deploy-devnet or target/deploy after `anchor build -- --features devnet`); skipped otherwise.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { builtArtifacts, executableHash, loadVerifiedBuild, verifiedBuildProblems } from "@/lib/burnticker/trustpack/verifiedBuild";

const ROOT = path.join(import.meta.dirname, "..");
const table = loadVerifiedBuild(ROOT);
const doc = fs.readFileSync(path.join(ROOT, "docs", "burnticker", "VERIFIED-BUILD.md"), "utf8");
const script = fs.readFileSync(path.join(ROOT, "scripts", "ops", "verified-build.sh"), "utf8");

describe("verified-build.json", () => {
  test("validates: both programs, both builds, 64-hex hashes, the devnet build uses --features devnet, matchesBuild agrees", () => {
    assert.deepEqual(verifiedBuildProblems(table), []);
    assert.deepEqual(table.programs.map((p) => p.library).sort(), ["burn_receipts", "pair_curve"]);
    for (const p of table.programs) {
      assert.match(p.programId, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
      assert.equal(p.deployed.devnet?.matchesBuild, true, `${p.library}: the devnet deployment is this build`);
      assert.equal(p.deployed.devnet?.upgradeAuthority, "A8VVQ8ztPcPmKTzWJDADP8EthMg8DvqKcK15dNBqMffD");
      assert.equal(p.deployed.mainnet?.matchesBuild, true, `${p.library}: the mainnet deployment (2026-10-11) is this build`);
      assert.equal(p.deployed.mainnet?.upgradeAuthority, "8zsHrHjSgunnLmVyPG848GLw5a9xai6u8SZCYaskWrDV", "mainnet upgrade authority is the Squads vault");
      assert.notEqual(p.builds.mainnet.hash, p.builds.devnet.hash, "the devnet build compiles Raydium's devnet ids in");
    }
    assert.deepEqual(verifiedBuildProblems({ ...table, programs: table.programs.map((p) => ({ ...p, deployed: { ...p.deployed, devnet: p.deployed.devnet ? { ...p.deployed.devnet, matchesBuild: false } : null } })) }).length, 2);
    assert.match(verifiedBuildProblems({ ...table, kind: "laptop" as never })[0], /kind/);
  });
  test("the doc shows every hash, the program ids, the source commit, and says INTERIM while the table is not a Docker build", () => {
    for (const p of table.programs) { assert.ok(doc.includes(p.programId)); for (const v of ["mainnet", "devnet"] as const) assert.ok(doc.includes(p.builds[v].hash), `${p.library} ${v} hash on the page`); }
    assert.ok(doc.includes(table.sourceCommit));
    if (table.kind === "interim-local") { assert.match(doc, /Status: INTERIM/); assert.match(doc, /not from solana-verify's Docker image/); }
    for (const must of ["solana-verify verify-from-repo -u https://api.devnet.solana.com", "solana-verify verify-from-repo -um", "solana-verify export-pda-tx", "solana-verify remote submit-job", "--mount-path programs/burn-receipts", "-- --features devnet"]) assert.ok(doc.includes(must), must);
  });
  test("the script builds both variants in both modes, never sends a transaction and never reads a key", () => {
    for (const must of ["--local", "--docker", "--onchain", "--commands", "cargo build-sbf", "solana-verify build", "solana program dump", "--features devnet"]) assert.ok(script.includes(must), must);
    assert.doesNotMatch(script, /solana program (deploy|write-buffer|set-upgrade-authority)|solana transfer|keypair\.json|id\.json|--keypair/);
  });
});

describe("the executable hash", () => {
  test("sha256 of the bytes with trailing zeros removed: padding does not change it, a changed byte does", () => {
    const so = crypto.randomBytes(1000); so[so.length - 1] = 7;
    const padded = Buffer.concat([so, Buffer.alloc(4096)]);
    assert.equal(executableHash(padded), executableHash(so));
    assert.equal(executableHash(so), crypto.createHash("sha256").update(so).digest("hex"));
    const other = Buffer.from(so); other[10] ^= 1;
    assert.notEqual(executableHash(other), executableHash(so));
  });
  test("a program built on this host matches the table (skipped when nothing is built here)", (t) => {
    const built = builtArtifacts(ROOT);
    if (!built.length) { t.skip("no programs/burn-receipts/target/deploy*/ build on this host"); return; }
    for (const b of built) {
      const h = executableHash(fs.readFileSync(b.file));
      const p = table.programs.find((x) => x.library === b.library)!;
      const known = [p.builds.mainnet.hash, p.builds.devnet.hash];
      assert.ok(known.includes(h), `${b.file}: ${h} is neither the table's default nor devnet build — rebuild and run: bash scripts/ops/verified-build.sh --local --write (and update docs/burnticker/VERIFIED-BUILD.md)`);
    }
  });
});
