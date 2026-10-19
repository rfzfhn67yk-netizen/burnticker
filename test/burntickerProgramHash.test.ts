// PRELAUNCH AUDIT 2026-10-18 A-4: the trust page's program hash comes from config/burnticker/verified-build.json for the cluster, never
// from a stale host variable; the keeper's daily check compares the chain's ProgramData with the same record and the difference is pushed.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PublicKey } from "@solana/web3.js";
import { compareProgramToRecord, programHashFact, programHashSourceLine, readProgramDataHash, resetProgramHashWarning, PROGRAM_DATA_HEADER } from "@/lib/burnticker/programHash";
import { programFacts } from "@/lib/burnticker/trust";
import { executableHash } from "@/lib/burnticker/trustpack/verifiedBuild";
import { PUSH_KIND_OF_ALERT } from "@/lib/burnticker/push";

const ROOT = path.resolve(import.meta.dirname, "..");
const R5 = "152929ce72292d2113655c09a193a15cb49443109e4db202efdbc68232520821";
const R3 = "e64a27598808e5c9564833341f892bb8be9f6d0b7254108dde68d09f7141dc19";
const PID = "AuQjoSgq7upmyPBv2itwy2TSZ1VjoVipyy4z9wd7zhMM";

describe("the program hash on the trust page (A-4)", () => {
  test("mainnet reads the round-5 record and slot; a stale env hash is ignored and logged once, by name only", () => {
    resetProgramHashWarning();
    const logs: string[] = [];
    const f = programHashFact({ BURNTICKER_CLUSTER: "mainnet", BURNTICKER_PROGRAM_HASH: R3 }, ROOT, { log: (s) => logs.push(s) });
    assert.equal(f.hash, R5);
    assert.equal(f.slot, 457461970);
    assert.equal(f.hostValue, "ignored");
    programHashFact({ BURNTICKER_CLUSTER: "mainnet", BURNTICKER_PROGRAM_HASH: R3 }, ROOT, { log: (s) => logs.push(s) });
    assert.equal(logs.length, 1, "logged once");
    assert.ok(!logs[0].includes(R3), "the env value is never printed");
    assert.match(programHashSourceLine(f), /verified-build\.json \(mainnet, 152929ce…, slot 457461970\); BURNTICKER_PROGRAM_HASH on this host differs and is ignored/);
  });
  test("an env hash equal to the record is reported as equal; unset is unset", () => {
    assert.equal(programHashFact({ BURNTICKER_CLUSTER: "mainnet", BURNTICKER_PROGRAM_HASH: R5 }, ROOT).hostValue, "equal");
    assert.equal(programHashFact({ BURNTICKER_CLUSTER: "mainnet" }, ROOT).hostValue, "unset");
  });
  test("programFacts prints the recorded hash, never the env one, and the verify steps use the executable hash", () => {
    resetProgramHashWarning();
    const p = programFacts({ BURNTICKER_CLUSTER: "mainnet", BURNTICKER_PROGRAM_ID: PID, BURNTICKER_PROGRAM_HASH: R3 }, ROOT);
    assert.equal(p.buildHash, R5);
    assert.ok(!JSON.stringify(p).includes(R3));
    assert.ok(p.verify.some((v) => v.startsWith(`solana-verify get-program-hash ${PID}`)));
    assert.ok(!p.verify.some((v) => /^sha256sum program\.so/.test(v)), "sha256 of a padded dump never equals the executable hash");
  });
});

describe("the keeper's daily program check (A-4)", () => {
  const programDataKey = new PublicKey("CqKa66TxEaqLXAuFyJdha4uosBosEEf2CBccNiE8gbKn");
  const programAccount = (): Uint8Array => { const b = new Uint8Array(36); new DataView(b.buffer).setUint32(0, 2, true); b.set(programDataKey.toBytes(), 4); return b; };
  const programData = (code: Uint8Array, slot: number): Uint8Array => {
    const b = new Uint8Array(PROGRAM_DATA_HEADER + code.length + 64);
    const v = new DataView(b.buffer); v.setUint32(0, 3, true); v.setBigUint64(4, BigInt(slot), true); b[12] = 1;
    b.set(code, PROGRAM_DATA_HEADER); return b;
  };
  const code = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 0, 7]);
  const reader = (slot: number) => ({ accountBytes: async (a: string) => (a === PID ? programAccount() : a === programDataKey.toBase58() ? programData(code, slot) : null) });
  const toB58 = (b: Uint8Array) => new PublicKey(b).toBase58();

  test("reads the executable hash (trailing zeros removed) and the slot from ProgramData", async () => {
    const c = await readProgramDataHash(reader(457461970), PID, toB58);
    assert.deepEqual(c, { hash: executableHash(code), slot: 457461970, programData: programDataKey.toBase58() });
  });
  test("equal chain and record: no alert; a different hash or slot: one sentence naming both", async () => {
    const c = (await readProgramDataHash(reader(457461970), PID, toB58))!;
    const rec = { cluster: "mainnet" as const, programId: PID, hash: c.hash, round: 5, slot: 457461970, source: "verified-build" as const, hostValue: "unset" as const };
    assert.equal(compareProgramToRecord(rec, c), null);
    const other = compareProgramToRecord({ ...rec, hash: R5 }, c)!;
    assert.match(other, /does not match config\/burnticker\/verified-build\.json: its hash on chain is/);
    assert.match(compareProgramToRecord(rec, { ...c, slot: 1 })!, /deployed at slot 1, and the record says slot 457461970/);
    // review 2: a read that gave nothing is retried by the keeper and never compared (no alert, the day not marked checked)
    const k = fs.readFileSync(path.join(ROOT, "scripts", "burnticker-keeper.mts"), "utf8");
    assert.ok(k.indexOf("if (!chain) {") > 0 && k.indexOf("if (!chain) {") < k.indexOf("programCheckDay = denverDate(now);\n  const diff"), "a null read returns before the day is marked and before any alert");
  });
  test("bt-audit-mismatch is a pushed kind", () => {
    assert.equal(PUSH_KIND_OF_ALERT["bt-audit-mismatch"], "audit-mismatch");
  });
});
