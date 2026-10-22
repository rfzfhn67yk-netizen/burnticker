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
import { builtArtifacts, deployedBytesState, executableHash, loadVerifiedBuild, pendingUpgradeSentence, verifiedBuildProblems } from "@/lib/burnticker/trustpack/verifiedBuild";

const ROOT = path.join(import.meta.dirname, "..");
const table = loadVerifiedBuild(ROOT);
const doc = fs.readFileSync(path.join(ROOT, "docs", "burnticker", "VERIFIED-BUILD.md"), "utf8");
const script = fs.readFileSync(path.join(ROOT, "scripts", "ops", "verified-build.sh"), "utf8");

describe("verified-build.json", () => {
  test("validates: both programs, both builds, 64-hex hashes, the devnet build uses --features devnet, matchesBuild agrees", () => {
    assert.deepEqual(verifiedBuildProblems(table), []);
    assert.deepEqual(table.programs.map((p) => p.library).sort(), ["burn_receipts", "pair_curve"]);
    // B-17 (2026-10-21): burn_receipts' table build is the B-17 build, deployed on mainnet that evening (vault transaction 4) and not on
    // devnet (pendingUpgrade there only); pair_curve's deployed round-4 bytes are its build
    const devnetPending = new Set<string>(); // devnet upgraded to B-17 too on 2026-10-21 18:49 Denver (vault transaction 23)
    for (const p of table.programs) {
      assert.match(p.programId, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
      assert.equal(deployedBytesState(p.deployed.devnet!), devnetPending.has(p.library) ? "upgrade-pending" : "matches", `${p.library}: devnet`);
      assert.equal(p.deployed.devnet?.upgradeAuthority, "A8VVQ8ztPcPmKTzWJDADP8EthMg8DvqKcK15dNBqMffD");
      assert.equal(deployedBytesState(p.deployed.mainnet!), "matches", `${p.library}: mainnet`);
      assert.equal(p.deployed.mainnet?.upgradeAuthority, "8zsHrHjSgunnLmVyPG848GLw5a9xai6u8SZCYaskWrDV", "mainnet upgrade authority is the Squads vault");
      assert.notEqual(p.builds.mainnet.hash, p.builds.devnet.hash, "the devnet build compiles Raydium's devnet ids in");
    }
    const flipped = { ...table, programs: table.programs.map((p) => ({ ...p, deployed: { ...p.deployed, mainnet: p.deployed.mainnet ? { ...p.deployed.mainnet, matchesBuild: !p.deployed.mainnet.matchesBuild } : null } })) };
    assert.deepEqual(verifiedBuildProblems(flipped).length, 2);
    assert.match(verifiedBuildProblems({ ...table, kind: "laptop" as never })[0], /kind/);
  });
  test("B-17 is deployed on mainnet (2026-10-21, vault transaction 4) and read back; devnet upgraded the same evening (vault transaction 23); pair_curve keeps round 4", () => {
    const br = table.programs.find((p) => p.library === "burn_receipts")!, pc = table.programs.find((p) => p.library === "pair_curve")!;
    assert.equal(table.sourceCommit, "116ff5ad054e25cd169a8ceeb3eebb16832a33e0");
    assert.equal(br.sourceCommit, "116ff5ad054e25cd169a8ceeb3eebb16832a33e0");
    assert.equal(br.deployedSourceCommit, undefined, "the mainnet bytes are this build's; the old commit lives in the notes");
    assert.equal(br.builds.mainnet.hash, "b5b6e44f7c58531c9e0a62b00e42c7a359c1ae3d660aeb3465cbc1b7ea29978b");
    assert.equal(br.builds.mainnet.bytes, 1030912);
    assert.equal((br.builds.mainnet as { sha256?: string }).sha256, "faf072925c169ede89788e17c66cd6ab446fa332d47ae0362fca46dbb1a4e4f8");
    assert.equal(br.builds.devnet.hash, "34d7b68e21dbb3b9629d437bb309767019be406eb55352ee95915061aa0ae4ee");
    // mainnet: the B-17 bytes, read back from the ProgramData account after the execute
    assert.equal(br.deployed.mainnet?.hash, br.builds.mainnet.hash);
    assert.equal(br.deployed.mainnet?.matchesBuild, true);
    assert.equal(br.deployed.mainnet?.pendingUpgrade, undefined);
    assert.equal(br.deployed.mainnet?.slot, 459823169);
    assert.match(String(br.deployed.mainnet?.readAt), /^2026-10-21T\d{2}:\d{2}:\d{2}Z$/);
    const ev = fs.readFileSync(path.join(ROOT, br.deployed.mainnet!.evidence!), "utf8");
    const sig = (JSON.parse(fs.readFileSync(path.join(ROOT, "config", "burnticker", "current-status.json"), "utf8")) as { programs: { name: string; mainnetDeploy: { squadsExecuteSignature: string } }[] }).programs.find((p) => p.name === "burn_receipts")!.mainnetDeploy.squadsExecuteSignature;
    assert.ok(sig.startsWith("4Pnd") && sig.endsWith("drYp"), "the B-17 execute signature");
    assert.ok(ev.includes(sig) && doc.includes(sig), "the evidence and the doc name the execute signature");
    assert.match(ev, /MATCH  mainnet burn_receipts \S+ b5b6e44f7c58531c9e0a62b00e42c7a359c1ae3d660aeb3465cbc1b7ea29978b/);
    // devnet: upgraded at 00:49Z 10-22 (18:49 Denver 10-21), read back 00:51Z
    assert.equal(br.deployed.devnet?.hash, br.builds.devnet.hash);
    assert.equal(br.deployed.devnet?.matchesBuild, true);
    assert.equal(br.deployed.devnet?.pendingUpgrade, undefined);
    assert.equal(br.deployed.devnet?.slot, 513708808);
    assert.ok(fs.existsSync(path.join(ROOT, br.deployed.devnet!.evidence!)), "devnet evidence");
    assert.equal(pc.sourceCommit, "29f6f5de19f1916945992fae711cefc36927d856");
    assert.equal(pc.builds.mainnet.hash, "567f37001f4ecc9966ddce3ca3ac2da8262a1138d21c90825591c08d0bc8a895");
    assert.equal(pc.builds.devnet.hash, "364eac3de338f5356d66bba2e74dca52859f4f0339c10dbdf759173339a701cf");
    // pendingUpgrade is a note set only while the bytes differ; deployedSourceCommit only while an upgrade is pending
    const withBr = (f: (p: typeof br) => typeof br) => ({ ...table, programs: table.programs.map((p) => (p.library === "burn_receipts" ? f(p) : p)) });
    assert.match(verifiedBuildProblems(withBr((p) => ({ ...p, deployed: { ...p.deployed, mainnet: { ...p.deployed.mainnet!, pendingUpgrade: "a note" } } }))).join(";"), /pendingUpgrade/, "no pending note on a network that matches");
    assert.match(verifiedBuildProblems(withBr((p) => ({ ...p, deployedSourceCommit: "089024ff6ab0cc92ae37899dee1509d52cb5e203", deployed: { ...p.deployed, devnet: { ...p.deployed.devnet!, pendingUpgrade: undefined } } }))).join(";"), /deployedSourceCommit/);
    const s = pendingUpgradeSentence("devnet", br.builds.devnet.hash, "74659afdbb5f63fd0fb79a3366302bd68f7a8e84eea5cf9a6d9cdab97f36785c");
    assert.ok(s.includes(br.builds.devnet.hash) && s.includes("74659afdbb5f63fd0fb79a3366302bd68f7a8e84eea5cf9a6d9cdab97f36785c"));
    assert.match(s, /has not been deployed on devnet/); assert.match(s, /not verified on chain until/);
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

// OPS-2 (2026-10-12): the throwaway-Linux-host script the owner runs prints the comparison against the same numbers as this table.
describe("scripts/ops/reproducible-build-host.sh", () => {
  const host = fs.readFileSync(path.join(ROOT, "scripts", "ops", "reproducible-build-host.sh"), "utf8");
  const val = (arr: string, lib: string) => new RegExp(`${arr}\\[${lib}\\]="([^"]+)"`).exec(host)?.[1];
  test("its expected mainnet hashes and program ids are the table's", () => {
    for (const p of table.programs) {
      assert.equal(val("ID", p.library), p.programId, p.library);
      assert.equal(val("EXE", p.library), p.builds.mainnet.hash, p.library);
      assert.equal(val("SHA", p.library), (p.builds.mainnet as { sha256?: string }).sha256, p.library);
    }
    assert.equal(val("SHA", "burn_receipts"), "faf072925c169ede89788e17c66cd6ab446fa332d47ae0362fca46dbb1a4e4f8"); // B-17 build (116ff5ad), deployed on mainnet 2026-10-21
    // DEPLOYED[<lib>] names an earlier hash only while that program's mainnet upgrade is pending; none is now, so the comparison says MATCH
    for (const p of table.programs) {
      if (p.deployed.mainnet?.pendingUpgrade) assert.equal(val("DEPLOYED", p.library), p.deployed.mainnet.hash, `${p.library}: the bytes mainnet runs until the upgrade`);
      else assert.equal(val("DEPLOYED", p.library), undefined, `${p.library}: no pending mainnet upgrade`);
    }
    assert.equal(val("SHA", "pair_curve"), "8effaac2f1a1c19ff1505ce72f28d1ae60c02c971f2411ffab707bfd29fbded2");
  });
  test("it builds the commit the site pins, compares with mainnet read-only, and the page explains it", async () => {
    const { PUBLIC_REPO_COMMIT } = await import("@/lib/burnticker/currentStatusLinks");
    assert.equal(/^COMMIT="([0-9a-f]{40})"$/m.exec(host)?.[1], PUBLIC_REPO_COMMIT);
    assert.match(host, /solana-verify get-program-hash -u "\$RPC"/);
    // review of the release identity: each program builds at its own public commit (pair_curve stays round 4: public 7e7bab58 carries the
    // program tree of monorepo 29f6f5de, its deployed source), so a third party can get a clean PASS for both
    assert.match(host, /^PAIR_CURVE_COMMIT="7e7bab5804f9e3dee070ebbc2bd3ba1de1c6b999"$/m);
    assert.match(host, /--pair-curve-commit\) PAIR_CURVE_COMMIT="\$2"/);
    assert.match(host, /AT\[burn_receipts\]="\$COMMIT"; AT\[pair_curve\]="\$PAIR_CURVE_COMMIT"/);
    assert.match(host, /git checkout -q "\$\{AT\[\$lib\]\}"/);
    assert.match(host, /its constants, the CPMM pool reader and the\n# TokenConfig type/);
    assert.doesNotMatch(host, /solana program deploy|solana transfer|keypair|--keypair|-k /, "no key, no send");
    assert.match(doc, /### Throwaway Linux host/); assert.match(doc, /ssh root@<server ip> 'bash -s' < scripts\/ops\/reproducible-build-host\.sh/);
    assert.ok(fs.readFileSync(path.join(ROOT, "config", "public-repo.allowlist"), "utf8").split("\n").includes("scripts/ops/reproducible-build-host.sh"));
  });
});
