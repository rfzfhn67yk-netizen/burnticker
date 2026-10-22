// PRELAUNCH AUDIT 2026-10-18 A-1: burn dispersal was never on on the mainnet host. One decision now serves the keeper and the web: the
// flag 1 / 0 wins, unset is on for a round-5 program (crank_carried); the keeper refuses to start on a crank_carried program unless the
// flag is set either way; ops.json names the five host facts; the keeper unit sets the flag.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { dispersalDecision, dispersalHostLine, dispersalLine, keeperDispersalStart, DEFICIT_DISPERSAL_NAME } from "@/lib/burnticker/dispersal";
import os from "node:os";
import { hostDispersal, hostProgramRound, keeperDispersalFile, webDispersal, writeKeeperDispersal } from "@/lib/burnticker/programHash";
import { buildOpsJson, hostFactLines, type HostFacts } from "@/lib/burnticker/checkin";
import { PUSH_KIND_OF_ALERT } from "@/lib/burnticker/push";

const ROOT = path.resolve(import.meta.dirname, "..");
const PID = "AuQjoSgq7upmyPBv2itwy2TSZ1VjoVipyy4z9wd7zhMM";

describe("the dispersal decision", () => {
  test("1 and 0 win; unset follows the program round; anything else is off and named", () => {
    assert.deepEqual(dispersalDecision({ BURNTICKER_DISPERSAL: "1" }, 4), { on: true, source: "flag-on", crankCarried: false });
    assert.deepEqual(dispersalDecision({ BURNTICKER_DISPERSAL: "0" }, 5), { on: false, source: "flag-off", crankCarried: true });
    assert.deepEqual(dispersalDecision({}, 5), { on: true, source: "default-on", crankCarried: true });
    assert.deepEqual(dispersalDecision({}, 4), { on: false, source: "default-off", crankCarried: false });
    assert.deepEqual(dispersalDecision({}, null), { on: false, source: "default-off", crankCarried: false });
    assert.deepEqual(dispersalDecision({ BURNTICKER_DISPERSAL: "true" }, 5), { on: false, source: "not-understood", crankCarried: true });
  });
  test("the keeper refuses on a crank_carried program unless the flag is 1 or 0, with a sentence that names the fix", () => {
    const unset = keeperDispersalStart({}, 5);
    assert.equal(unset.ok, false);
    assert.match(!unset.ok ? unset.reason : "", /has crank_carried \(round 5\), but BURNTICKER_DISPERSAL is not set\. .*Set BURNTICKER_DISPERSAL=1 in the keeper unit/);
    assert.equal(keeperDispersalStart({ BURNTICKER_DISPERSAL: "yes" }, 5).ok, false);
    const on = keeperDispersalStart({ BURNTICKER_DISPERSAL: "1" }, 5);
    assert.ok(on.ok && on.decision.on && /^burn dispersal: on \(BURNTICKER_DISPERSAL=1\)/.test(on.line));
    const off = keeperDispersalStart({ BURNTICKER_DISPERSAL: "0" }, 5);
    assert.ok(off.ok && !off.decision.on && /OFF on purpose/.test(off.line), "an explicit off is allowed");
    assert.ok(keeperDispersalStart({}, null).ok, "the fake program (no round) never refuses");
    assert.ok(keeperDispersalStart({}, 4).ok, "a round-4 program has no crank_carried");
    assert.match(dispersalLine(dispersalDecision({}, 4)), /has no crank_carried/);
  });
  test("bt-dispersal-off is pushed", () => assert.equal(PUSH_KIND_OF_ALERT["bt-dispersal-off"], "dispersal-off"));
});

describe("the host reads the round from verified-build.json", () => {
  test("mainnet and devnet run round 5, so the web defaults on; another program id or localnet is unknown", () => {
    assert.equal(hostProgramRound({ BURNTICKER_CLUSTER: "mainnet", BURNTICKER_PROGRAM_ID: PID }, ROOT), 5);
    assert.equal(hostProgramRound({ BURNTICKER_CLUSTER: "devnet" }, ROOT), 5);
    assert.equal(hostProgramRound({ BURNTICKER_CLUSTER: "mainnet", BURNTICKER_PROGRAM_ID: "11111111111111111111111111111111" }, ROOT), null);
    assert.equal(hostProgramRound({ BURNTICKER_CLUSTER: "localnet" }, ROOT), null);
    assert.equal(hostDispersal({ BURNTICKER_CLUSTER: "mainnet", BURNTICKER_PROGRAM_ID: PID }, ROOT).on, true);
    assert.equal(hostDispersal({ BURNTICKER_CLUSTER: "mainnet", BURNTICKER_DISPERSAL: "0" }, ROOT).on, false, "an explicit off reaches the web too");
  });
});

describe("ops.json names the five host facts (names and yes/no only)", () => {
  const facts: HostFacts = { dispersal: { on: true, line: "burn dispersal: on (BURNTICKER_DISPERSAL=1): carried amounts are spent in crank_carried pieces over 6-hour windows" }, webhookConfigured: false, pushConfigured: true, heartbeatConfigured: true, backupDestConfigured: false, programHashSource: "program hash: from config/burnticker/verified-build.json (mainnet, 152929ce…, slot 457461970)" };
  test("lines and the document field", () => {
    const lines = hostFactLines(facts);
    assert.match(lines[0], /burn dispersal: on/);
    assert.match(lines[1], /BURNTICKER_ALERT_WEBHOOK not used \(push only, owner decision 2026-10-18\) · BURNTICKER_PUSH_URL set · BURNTICKER_STATUS_HEARTBEAT_URL set · BURNTICKER_BACKUP_DEST NOT SET/);
    assert.match(hostFactLines({ ...facts, pushConfigured: false })[1], /BURNTICKER_ALERT_WEBHOOK NOT SET \(and no phone push/);
    assert.match(hostFactLines({ ...facts, webhookConfigured: true })[1], /BURNTICKER_ALERT_WEBHOOK set/);
    assert.match(lines[2], /verified-build\.json/);
    const j = buildOpsJson({ now: Date.parse("2026-10-18T12:00:00Z"), snapshot: null, delta: null, alerts: null, firstLaunchAt: null, hostFacts: facts });
    assert.deepEqual(j.hostFacts, facts);
  });
});

describe("review 4 and 5: every process's decision, and the web follows the keeper", () => {
  test("the web follows the keeper's record; without one it applies the same rule to its own environment", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bt-disp-"));
    fs.mkdirSync(path.join(tmp, "config", "burnticker"), { recursive: true });
    fs.copyFileSync(path.join(ROOT, "config", "burnticker", "verified-build.json"), path.join(tmp, "config", "burnticker", "verified-build.json"));
    const env = { BURNTICKER_CLUSTER: "mainnet", BURNTICKER_PROGRAM_ID: PID };
    assert.deepEqual(webDispersal(env, tmp), { on: true, source: "default-on", crankCarried: true, follows: "own-env" }, "unset is on for round 5, like the keeper");
    const dbEnv = { ...env, BURNTICKER_DB: path.join(tmp, "reg", "burnticker.db") };
    writeKeeperDispersal(dispersalDecision({ BURNTICKER_DISPERSAL: "0" }, 5), dbEnv, tmp);
    assert.equal(keeperDispersalFile(dbEnv, tmp), path.join(tmp, "reg", "keeper-dispersal.json"), "beside the registry, never the checkout's ./data");
    assert.ok(fs.existsSync(path.join(tmp, "reg", "keeper-dispersal.json")));
    assert.deepEqual(webDispersal({ ...dbEnv, BURNTICKER_DISPERSAL: "1" }, tmp), { on: false, source: "flag-off", crankCarried: true, follows: "keeper" }, "the keeper's record wins over the web's own env");
  });
  test("ops.json's line names the platform keeper, the web launcher and the $DEFICIT keeper (its own flag)", () => {
    const k = dispersalDecision({ BURNTICKER_DISPERSAL: "1" }, 5);
    assert.equal(dispersalHostLine(k, { ...k, follows: "keeper" }, false), "burn dispersal: platform keeper on (BURNTICKER_DISPERSAL=1); web launcher on (follows the platform keeper's record); $DEFICIT keeper off (its own flag)");
    assert.match(dispersalHostLine(k, { ...dispersalDecision({}, 5), follows: "own-env" }, null), /web launcher on \(unset, on for a round-5 program\); \$DEFICIT keeper not reported \(its own flag\)$/);
    const keeper = fs.readFileSync(path.join(ROOT, "scripts", "burnticker-keeper.mts"), "utf8");
    assert.match(keeper, /dispersalHostLine\(dispersal, webDispersal\(process[.]env\), deficitDispersal\)/);
    assert.match(keeper, /if \(!DRY\) writeKeeperDispersal\(dispersal, \{ \.\.\.process[.]env, BURNTICKER_DB: DB \}\)/);
    const deficit = fs.readFileSync(path.join(ROOT, "scripts", "burn-keeper.mts"), "utf8");
    assert.match(deficit, /fs\.writeFileSync\(path\.join\(BT_DIR, DEFICIT_DISPERSAL_NAME\)/);
    assert.equal(DEFICIT_DISPERSAL_NAME, "burnkeeper-dispersal.json");
    assert.ok(!/BURNTICKER_DISPERSAL=1 in both: off until/.test(fs.readFileSync(path.join(ROOT, "src", "lib", "burnticker", "dispersalKeeper.ts"), "utf8")));
  });
});

describe("review 6: a hand run prints the refusal and exits 1 without a push", () => {
  test("both start refusals push only when the keeper is not run by hand (--once or --dry-run)", () => {
    const k = fs.readFileSync(path.join(ROOT, "scripts", "burnticker-keeper.mts"), "utf8");
    assert.match(k, /const HAND_RUN = ONCE \|\| DRY;/);
    const pushes = [...k.matchAll(/pushKeeperRefused\(\{/g)].length;
    assert.equal([...k.matchAll(/if \(!HAND_RUN\) await pushKeeperRefused\(\{/g)].length, pushes, "every push of a refusal is behind !HAND_RUN");
    assert.match(k, /else console\.error\(`keeper refused \(hand run, not pushed\): \$\{dispersalStart\.reason\}`\);\n  registry\.close\(\);\n  process\.exit\(1\);/);
  });
});

describe("the keeper unit and the keeper", () => {
  test("the unit sets BURNTICKER_DISPERSAL=1; the keeper no longer says dispersal is off until deployed", () => {
    const unit = fs.readFileSync(path.join(ROOT, "deploy", "systemd", "mct-burnticker-keeper.service"), "utf8");
    assert.match(unit, /^Environment=BURNTICKER_DISPERSAL=1$/m);
    const keeper = fs.readFileSync(path.join(ROOT, "scripts", "burnticker-keeper.mts"), "utf8");
    assert.ok(!/off until deployed/.test(keeper));
    assert.match(keeper, /keeperDispersalStart\(process[.]env/);
    assert.match(keeper, /process\.exit\(1\)/);
  });
});
