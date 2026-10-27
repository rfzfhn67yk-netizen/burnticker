// HS-121 (ninth audit addendum, 2026-10-21): after the B-17 upgrade executed at 17:57 Denver the site kept saying "not yet deployed"
// until verified-build.json was flipped by hand, because the pending-upgrade copy and the tier-pin sentence keyed on the STORED deployed
// record. They now follow the program's ProgramData hash read live (cached a few minutes), like the keeper's register_fee_key gate, and
// fall back to the record (with "last read <time>") only when that read fails. Three states, on every server surface: current status,
// the trust page's chain facts and statements, the check page's build table and the operator page's program rows.
import { describe, test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PublicKey } from "@solana/web3.js";
import { buildCurrentStatus, type ChainFacts } from "@/lib/burnticker/currentStatus";
import { buildTrustPage, chainFacts, deployedTierPinLine, programFacts, type ChainReader } from "@/lib/burnticker/trust";
import { deploymentsOf } from "@/lib/burnticker/trustpack/api";
import { deployedBytesState, deployedNow, executableHash, loadVerifiedBuild, pendingUpgradeSentence, withLiveDeployed, type VerifiedBuild } from "@/lib/burnticker/trustpack/verifiedBuild";
import { PRE_B17_SOURCE_COMMIT, tierPinPendingLive } from "@/lib/burnticker/deployedTierPin";
import { resetLiveProgramHashes } from "@/lib/burnticker/programHash";
import { DEPLOYED_TIER_PIN_LINE } from "@/lib/burnticker/feeShareLine";
import { lintCopy } from "@/lib/launch/copyLint";

const ROOT = path.resolve(import.meta.dirname, "..");
const REAL = loadVerifiedBuild(ROOT);
const BR = REAL.programs.find((p) => p.library === "burn_receipts")!;
const BUILD = BR.builds.mainnet.hash;                                                       // 1aff5fbf… (B-17)
const PRE = "152929ce72292d2113655c09a193a15cb49443109e4db202efdbc68232520821";             // round 5, before B-17
const LIVE_AT = Date.parse("2026-10-22T01:00:00Z");
const clean = (s: string) => assert.equal(lintCopy(s).hits.length, 0, `${s}\n${JSON.stringify(lintCopy(s).hits)}`);

/** The record as it stood before the hand flip: mainnet names round 5 as deployed, with the B-17 upgrade pending. */
function staleRecord(vb: VerifiedBuild, buildHash = BUILD): VerifiedBuild {
  return { ...vb, programs: vb.programs.map((p) => (p.library !== "burn_receipts" ? p : { ...p, deployedSourceCommit: PRE_B17_SOURCE_COMMIT, builds: { ...p.builds, mainnet: { ...p.builds.mainnet, hash: buildHash } },
    deployed: { ...p.deployed, mainnet: { ...p.deployed.mainnet!, hash: PRE, matchesBuild: false, readAt: "2026-10-16", slot: 457461970, pendingUpgrade: "The B-17 build above is newer than the bytes on mainnet, and its upgrade has not been deployed yet." } } })) };
}
/** A root whose config/burnticker/verified-build.json is `vb` and every other file is the checkout's (symlinks, nothing copied). */
function rootWith(vb: VerifiedBuild): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bt-hs121-"));
  for (const e of fs.readdirSync(ROOT)) if (e !== "config" && e !== ".git") fs.symlinkSync(path.join(ROOT, e), path.join(dir, e));
  fs.mkdirSync(path.join(dir, "config", "burnticker"), { recursive: true });
  for (const e of fs.readdirSync(path.join(ROOT, "config"))) if (e !== "burnticker") fs.symlinkSync(path.join(ROOT, "config", e), path.join(dir, "config", e));
  for (const e of fs.readdirSync(path.join(ROOT, "config", "burnticker"))) if (e !== "verified-build.json") fs.symlinkSync(path.join(ROOT, "config", "burnticker", e), path.join(dir, "config", "burnticker", e));
  fs.writeFileSync(path.join(dir, "config", "burnticker", "verified-build.json"), `${JSON.stringify(vb, null, 2)}\n`);
  return dir;
}
const STALE_ROOT = rootWith(staleRecord(REAL));
/** A mainnet chain read whose burn program bytes hash to `hash` (null: the read failed before the program). */
const mainnetRead = (hash: string | null): ChainFacts => ({ cluster: "mainnet", readAt: new Date(LIVE_AT).toISOString(), error: hash ? null : "fetch failed", squads: null,
  programs: hash ? { [BR.programId]: { deployed: true, upgradeAuthority: "8zsHrHjSgunnLmVyPG848GLw5a9xai6u8SZCYaskWrDV", authorityRead: "decoded", hash, slot: 461421913, programData: "CqKa66TxEaqLXAuFyJdha4uosBosEEf2CBccNiE8gbKn" } } : {} });
const burnRow = (s: ReturnType<typeof buildCurrentStatus>) => s.programs.find((p) => p.name === "burn_receipts")!;
const PENDING_MAINNET = pendingUpgradeSentence("mainnet", BUILD, PRE);

beforeEach(() => resetLiveProgramHashes());

describe("HS-121 the deployed-bytes state follows the live hash", () => {
  test("deployedNow: live = build → matches over a stale record; live = pre-B17 → pending over a flipped record; no live hash → the record", () => {
    const stale = staleRecord(REAL).programs.find((p) => p.library === "burn_receipts")!.deployed.mainnet!;
    const flipped = BR.deployed.mainnet!;
    const a = deployedNow(stale, BUILD, { hash: BUILD, slot: 461421913, readAt: "2026-10-22T01:00:00Z" })!;
    assert.equal(deployedBytesState(a), "matches"); assert.equal(a.pendingUpgrade, undefined); assert.equal(a.source, "chain"); assert.equal(a.readAt, "2026-10-22T01:00:00Z");
    const b = deployedNow(flipped, BUILD, { hash: PRE, slot: 457461970, readAt: "2026-10-22T01:00:00Z" })!;
    assert.equal(deployedBytesState(b), "upgrade-pending"); assert.equal(b.hash, PRE);
    const c = deployedNow(stale, BUILD, null, true)!;
    assert.equal(deployedBytesState(c), "upgrade-pending"); assert.equal(c.source, "record-fallback"); assert.equal(c.readAt, "2026-10-16");
    assert.equal(deployedBytesState(deployedNow(flipped, BUILD, { hash: "ab".repeat(32), slot: 1, readAt: "x" })!), "differs", "a hash nobody recorded is not called the earlier build");
  });
  test("the tier pin follows the live hash the way the keeper's gate does", () => {
    const stale = staleRecord(REAL);
    assert.equal(tierPinPendingLive(stale, BUILD), false, "live = build: no tier-pin sentence, though the record still says round 5");
    assert.equal(tierPinPendingLive(REAL, PRE), true, "live = pre-B17: the sentence stays, though the record was flipped");
    assert.equal(tierPinPendingLive(REAL, "ab".repeat(32)), true, "an unrecorded hash keeps the cautious sentence");
    assert.equal(tierPinPendingLive(stale, null), true, "no live hash: the record decides");
    assert.equal(tierPinPendingLive(REAL, null), false);
    assert.equal(deployedTierPinLine(STALE_ROOT, BUILD), false); assert.equal(deployedTierPinLine(STALE_ROOT), true);
  });
});

describe("HS-121 current status (the /v1/current-status object, the summary on home, trust, operator and status)", () => {
  test("live hash = build → the match sentence and no tier pin, even with the stale record", () => {
    const s = buildCurrentStatus({ root: STALE_ROOT, env: { BURNTICKER_CLUSTER: "mainnet" }, chain: { mainnet: mainnetRead(BUILD) }, now: LIVE_AT });
    const m = burnRow(s).mainnet;
    assert.equal(m.matchesBuild, true); assert.equal(m.upgradePending, undefined);
    assert.match(m.line, /^It is deployed on mainnet\. Its bytes there match this repository's recorded build\. Read from chain at 2026-10-22T01:00:00Z\./);
    assert.ok(!s.lines.join(" ").includes(DEPLOYED_TIER_PIN_LINE));
    assert.ok(!s.lines.join(" ").includes("has not been deployed on mainnet"));
    clean(m.line);
  });
  test("live hash = pre-B17 → the pending sentence and the tier pin, even with the flipped record", () => {
    const s = buildCurrentStatus({ root: ROOT, env: { BURNTICKER_CLUSTER: "mainnet" }, chain: { mainnet: mainnetRead(PRE) }, now: LIVE_AT });
    const m = burnRow(s).mainnet;
    assert.equal(m.matchesBuild, false); assert.equal(m.upgradePending, PENDING_MAINNET);
    assert.ok(m.line.startsWith(`It is deployed on mainnet. ${PENDING_MAINNET} Read from chain at 2026-10-22T01:00:00Z.`), m.line);
    assert.ok(s.lines.join(" ").includes(DEPLOYED_TIER_PIN_LINE));
    clean(m.line);
  });
  test("the read fails → the stored record, with when it was last read", () => {
    const s = buildCurrentStatus({ root: STALE_ROOT, env: { BURNTICKER_CLUSTER: "mainnet" }, chain: { mainnet: mainnetRead(null) }, now: LIVE_AT });
    const m = burnRow(s).mainnet;
    assert.equal(m.upgradePending, PENDING_MAINNET);
    assert.ok(m.line.includes(`${PENDING_MAINNET} The chain could not be read just now, so this is the recorded read-back, last read 2026-10-16.`), m.line);
    assert.ok(s.lines.join(" ").includes(DEPLOYED_TIER_PIN_LINE), "the record still says round 5, so the tier pin stays");
    const ok = buildCurrentStatus({ root: ROOT, env: { BURNTICKER_CLUSTER: "mainnet" }, chain: { mainnet: mainnetRead(null) }, now: LIVE_AT });
    assert.ok(burnRow(ok).mainnet.line.includes(`Its bytes there match this repository's recorded build. The chain could not be read just now, so this is the recorded read-back, last read ${BR.deployed.mainnet!.readAt}.`));
    clean(m.line);
  });
});

describe("HS-121 trust page", () => {
  const live = (hash: string | null) => ({ cluster: "mainnet" as const, byProgramId: { [BR.programId]: hash ? { hash, slot: 461421913, programData: "", readAt: "2026-10-22T01:00:00Z" } : null } });
  test("chain facts: matches with a stale record, pending with a flipped record, last read on a failed read", () => {
    const a = chainFacts(STALE_ROOT, live(BUILD)).find((c) => c.library === "burn_receipts")!;
    assert.equal(a.mainnet, "deployed (read from chain at 2026-10-22T01:00:00Z, and the bytes match the recorded build; upgrade authority 8zsHrHjSgunnLmVyPG848GLw5a9xai6u8SZCYaskWrDV)");
    assert.ok(!(a.pending ?? []).some((t) => t.includes("on mainnet")));
    const b = chainFacts(ROOT, live(PRE)).find((c) => c.library === "burn_receipts")!;
    assert.equal(b.mainnet, "deployed (read from chain at 2026-10-22T01:00:00Z, and the bytes are the earlier build because the upgrade to this repository's newer build has not been deployed; upgrade authority 8zsHrHjSgunnLmVyPG848GLw5a9xai6u8SZCYaskWrDV)");
    assert.ok(b.pending?.includes(PENDING_MAINNET));
    const c = chainFacts(STALE_ROOT, live(null)).find((x) => x.library === "burn_receipts")!;
    assert.equal(c.mainnet, "deployed (last read 2026-10-16, because the chain could not be read just now, and the bytes are the earlier build because the upgrade to this repository's newer build has not been deployed; upgrade authority 8zsHrHjSgunnLmVyPG848GLw5a9xai6u8SZCYaskWrDV)");
    for (const t of [a.mainnet, b.mainnet, c.mainnet]) clean(t);
    assert.equal(programFacts({ BURNTICKER_CLUSTER: "mainnet" }, STALE_ROOT, live(BUILD)).buildHash, BUILD, "the hash to compare against is the build the chain runs");
    assert.equal(programFacts({ BURNTICKER_CLUSTER: "mainnet" }, STALE_ROOT, live(null)).buildHash, PRE);
  });
  test("buildTrustPage reads the bytes through the reader: the tier pin leaves the statements when the chain runs the recorded build", async () => {
    const code = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 0, 0]);
    const h = executableHash(code);
    const root = rootWith(staleRecord(REAL, h));
    const pd = new PublicKey("CqKa66TxEaqLXAuFyJdha4uosBosEEf2CBccNiE8gbKn");
    const prog = new Uint8Array(36); new DataView(prog.buffer).setUint32(0, 2, true); prog.set(pd.toBytes(), 4);
    const pdBytes = new Uint8Array(45 + code.length); const v = new DataView(pdBytes.buffer); v.setUint32(0, 3, true); v.setBigUint64(4, BigInt(461421913), true); pdBytes.set(code, 45);
    let up = true;
    const reader: ChainReader = { accountData: async (k) => { if (!up) throw new Error("rpc down"); return k === BR.programId ? prog : k === pd.toBase58() ? pdBytes : null; }, signaturesFor: async () => [], lamportsDelta: async () => null };
    const env = { BURNTICKER_CLUSTER: "mainnet" };
    const page = await buildTrustPage({ reader, env, root, siteDir: root, attesters: [], cluster: "mainnet", now: LIVE_AT, skipFeeLedger: true });
    assert.ok(!page.statements.join(" ").includes(DEPLOYED_TIER_PIN_LINE)); assert.ok(!String(page.feeTiersLine).includes(DEPLOYED_TIER_PIN_LINE));
    assert.match(page.program.chain.find((c) => c.library === "burn_receipts")!.mainnet, /^deployed \(read from chain at 2026-10-22T01:00:00Z, and the bytes match the recorded build;/);
    // the read is cached a few minutes: a down RPC inside that window changes nothing
    up = false;
    const again = await buildTrustPage({ reader, env, root, siteDir: root, attesters: [], cluster: "mainnet", now: LIVE_AT + 60_000, skipFeeLedger: true });
    assert.ok(!again.statements.join(" ").includes(DEPLOYED_TIER_PIN_LINE));
    // past the cache, a failed read falls back to the record (round 5 here), says when it was last read, and keeps the tier pin
    const later = await buildTrustPage({ reader, env, root, siteDir: root, attesters: [], cluster: "mainnet", now: LIVE_AT + 600_000, skipFeeLedger: true });
    assert.ok(later.statements.join(" ").includes(DEPLOYED_TIER_PIN_LINE));
    assert.match(later.program.chain.find((c) => c.library === "burn_receipts")!.mainnet, /^deployed \(last read 2026-10-16, because the chain could not be read just now,/);
  });
});

describe("HS-121 check page and operator page", () => {
  test("the check page's build table follows the live read, and the deployed commit with it", () => {
    const reads = (hash: string | null) => ({ mainnet: { [BR.programId]: hash ? { hash, slot: 1, readAt: "2026-10-22T01:00:00Z" } : null } });
    const a = withLiveDeployed(staleRecord(REAL), reads(BUILD)).programs.find((p) => p.library === "burn_receipts")!;
    assert.equal(a.deployed.mainnet!.matchesBuild, true); assert.equal(a.deployed.mainnet!.pendingUpgrade, undefined);
    assert.equal(a.deployed.mainnet!.readNote, "Read from chain at 2026-10-22T01:00:00Z.");
    assert.equal(a.deployedSourceCommit, undefined, "no 'a newer build has not been deployed yet' beside the commit");
    const b = withLiveDeployed(REAL, reads(PRE)).programs.find((p) => p.library === "burn_receipts")!;
    assert.equal(b.deployed.mainnet!.matchesBuild, false); assert.ok(b.deployed.mainnet!.pendingUpgrade); assert.equal(b.deployedSourceCommit, PRE_B17_SOURCE_COMMIT);
    const c = withLiveDeployed(staleRecord(REAL), reads(null)).programs.find((p) => p.library === "burn_receipts")!;
    assert.equal(c.deployed.mainnet!.readNote, "The chain could not be read just now, so this is the recorded read-back, last read 2026-10-16.");
    assert.equal(c.deployed.mainnet!.hash, PRE);
    for (const t of [a.deployed.mainnet!.readNote!, c.deployed.mainnet!.readNote!]) clean(t);
    assert.equal(withLiveDeployed(REAL, null), REAL, "the static document states the record");
  });
  test("the operator page's program rows say whether the read is live", () => {
    const reads = (hash: string | null) => ({ mainnet: { [BR.programId]: hash ? { hash, slot: 1, readAt: "2026-10-22T01:00:00Z" } : null } });
    assert.deepEqual(deploymentsOf(STALE_ROOT, reads(BUILD)).mainnet.burn_receipts, { readAt: "2026-10-22T01:00:00Z", matchesBuild: true, source: "chain" });
    assert.deepEqual(deploymentsOf(ROOT, reads(PRE)).mainnet.burn_receipts, { readAt: "2026-10-22T01:00:00Z", matchesBuild: false, pendingUpgrade: true, source: "chain" });
    assert.deepEqual(deploymentsOf(STALE_ROOT, reads(null)).mainnet.burn_receipts, { readAt: "2026-10-16", matchesBuild: false, pendingUpgrade: true, source: "record-fallback" });
    const page = fs.readFileSync(path.join(ROOT, "src/app/burnticker/operator/page.tsx"), "utf8");
    assert.match(page, /The bytes read from chain at \$\{d\.readAt\}/); assert.match(page, /The chain could not be read just now\. The bytes last read on \$\{d\.readAt\}/);
  });
});
