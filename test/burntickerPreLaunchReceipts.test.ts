// A PRE-LAUNCH RECEIPT (2026-10-28, the $GASCAT incident: 22 weekly results from before the launch planned by the week bug and attested
// in one reading). Three guarantees: the keeper never attests a planned receipt from before the launch (it is voided before any reading
// is built); the audit flags such a receipt unless its note carries the disclosure; the API reports it as preLaunch and does not count it.
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { openRegistry, type Registry } from "@/lib/burnticker/registry";
import { FakeBurnProgram } from "@/lib/burnticker/program";
import { buildLaunchBundle, FakeLaunchLab } from "@/lib/burnticker/launchBundle";
import { KalshiClient, fixtureFetch } from "@/lib/burnticker/oracle/kalshi";
import { CatalogueAdapter, feedById, loadFixture } from "@/lib/burnticker/catalogue";
import { executePending, type KeeperDeps } from "@/lib/burnticker/multiKeeper";
import { auditRegistry } from "@/lib/burnticker/audit";
import { buildReceiptsJson } from "@/lib/burnticker/tokenPage";
import { PRE_LAUNCH_NOTE, receiptBeforeLaunch } from "@/lib/burnticker/launchCut";
import { DEBT_RULE, treasuryAndCrossFetch } from "./burntickerHelpers.ts";

const CREATOR = "CreatorWa11et111111111111111111111111111111";
const ATTESTER = "KeeperDataKey1111111111111111111111111111111";
const LAUNCH = "2026-10-28T00:16:37.000Z";
const treasuryBody = loadFixture(feedById("treasury.debt")!).body;

let reg: Registry, program: FakeBurnProgram, lines: string[], clock: number, deps: KeeperDeps;
beforeEach(() => {
  reg = openRegistry(":memory:"); program = new FakeBurnProgram("devnet"); clock = Date.parse("2026-10-29T12:00:00Z"); program.now = () => clock; lines = [];
  deps = { registry: reg, program, oracles: { kalshi: new KalshiClient({ fetchImpl: fixtureFetch({}), now: () => clock, minIntervalMs: 0 }), catalogue: new CatalogueAdapter({ fetchImpl: treasuryAndCrossFetch(treasuryBody), now: () => clock }) }, attester: ATTESTER, log: (s) => lines.push(s), now: () => clock, dryRun: false };
});

async function launchGas() {
  const b = await buildLaunchBundle({ creator: CREATOR, ticker: "GASX", name: "Gas X coin", description: "a test", imageUrl: null, links: [], rule: DEBT_RULE, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true }, cluster: "devnet" }, { program, launchLab: new FakeLaunchLab(), devFeeWallet: null, attesters: [ATTESTER], quorum: 1, metadataUri: (m) => `https://x/${m}.json` });
  const t = reg.register({ mint: b.mint, ticker: "GASX", name: b.name, creator: CREATOR, description: b.description, imageUrl: null, links: [], rulesText: b.rules.text, feePda: b.addresses.feePda, vault: b.addresses.vault, tokenConfig: b.addresses.tokenConfig, poolId: b.addresses.poolId, launchTx: null, cluster: "devnet", platformId: b.addresses.platformId, baselineAt: LAUNCH, status: "draft" }, clock);
  reg.markLaunched(t.mint, "launchGASX", b.addresses.poolId, LAUNCH);
  reg.addAttester({ mint: t.mint, pubkey: ATTESTER, role: "data-key", addedAt: clock, timelockUntil: null });
  program.supplies.set(t.mint, BigInt("1000000000000000"));
  return reg.token(t.mint)!;
}
const mapping = { fractionOfPool: 0.05 };
const week = (mint: string, id: string, units: number, note: string) =>
  reg.applyStep(mint, { id, at: id, result: null, value: "3.5", title: id, sourceUrl: "https://x" }, { units, mapping: units > 0 ? mapping : null, kind: units > 0 ? "up" : "under-unit", note, carryOut: "0", baseline: null }, { value: "3.4", carryOut: "0" }, true, clock);

describe("pre-launch receipts (the 2026-10-28 $GASCAT incident)", () => {
  test("receiptBeforeLaunch: a week before the launch is before; the launch week and later, a clock receipt and a sports selector are not", () => {
    assert.equal(receiptBeforeLaunch({ settledAt: "2026-W10", kind: "up" }, "catalogue:eia.gasoline", LAUNCH), true);
    assert.equal(receiptBeforeLaunch({ settledAt: "2026-W44", kind: "up" }, "catalogue:eia.gasoline", LAUNCH), true, "W44 starts 2026-10-26, before the launch");
    assert.equal(receiptBeforeLaunch({ settledAt: "2026-W45", kind: "up" }, "catalogue:eia.gasoline", LAUNCH), false);
    assert.equal(receiptBeforeLaunch({ settledAt: "2026-10-27", kind: "up" }, "catalogue:treasury.debt", LAUNCH), true);
    assert.equal(receiptBeforeLaunch({ settledAt: "2026-10-29", kind: "up" }, "catalogue:treasury.debt", LAUNCH), false);
    assert.equal(receiptBeforeLaunch({ settledAt: "2026-10-01", kind: "winddown" }, "catalogue:treasury.debt", LAUNCH), false);
    assert.equal(receiptBeforeLaunch({ settledAt: "2026-10-01", kind: "up" }, "catalogue:espn.team:mlb-X", LAUNCH), false);
    assert.equal(receiptBeforeLaunch({ settledAt: "2026-10-01", kind: "up" }, "catalogue:treasury.debt", null), false);
  });

  test("the keeper voids a planned pre-launch receipt instead of attesting it; a post-launch receipt is attested as before", async () => {
    const t = await launchGas();
    assert.ok(week(t.mint, "2026-W10", 9, "moved 0.487 = 9 units of 0.05"));
    assert.ok(week(t.mint, "2026-10-29", 1, "moved 1 unit"));
    const out = await executePending(deps, t, reg.lockedRule(t));
    const w10 = reg.receipt(t.mint, "2026-W10")!;
    assert.equal(w10.status, "voided");
    assert.match(w10.skippedReason ?? "", /settled before the coin launched/);
    assert.ok(out.some((o) => o.eventId === "2026-W10" && o.outcome === "skipped"));
    assert.ok(lines.some((l) => l.includes("2026-W10: VOIDED")));
    const f = program.fake(t.mint);
    const attested = [...f.landed.values()].filter((l) => l.payload.kind === "reading" && !l.err);
    // the baseline and the one post-launch day: never a reading that carries W10's nine units
    assert.ok(attested.every((l) => !(l.memo ?? "").includes("2026-W10")), "no reading names the pre-launch receipt");
    assert.notEqual(reg.receipt(t.mint, "2026-10-29")!.status, "voided", "the post-launch receipt is attested (and cranked by the fake program)");
    assert.notEqual(reg.receipt(t.mint, "2026-10-29")!.readingDate, null, "the post-launch receipt was counted into a reading");
    assert.equal(reg.pending(t.mint).some((b) => b.eventId === "2026-W10"), false);
  });

  test("the audit flags a pre-launch receipt without the disclosure note and accepts one with it; the receipt JSON says preLaunch", async () => {
    const t = await launchGas();
    week(t.mint, "2026-W10", 9, "moved 0.487 = 9 units of 0.05");
    week(t.mint, "2026-W11", 0, "moved 0.015: under one unit of 0.05");
    week(t.mint, "2026-W12", 2, `${PRE_LAUNCH_NOTE} A keeper fault attested it on chain; not a rule result.`);
    const a = await auditRegistry(reg, { program: null, now: clock });
    const bad = a.mismatches.filter((m) => m.ticker === "GASX").map((m) => m.eventId).sort();
    assert.deepEqual(bad, ["2026-W10", "2026-W11"]);
    assert.ok(a.mismatches.every((m) => m.eventId === "-" || m.checks.join().includes("settled before the coin launched")));
    const locked = reg.lockedRule(t);
    const json = buildReceiptsJson({ token: t, locked, readings: [], receipts: reg.receipts(t.mint), attesters: reg.attesters(t.mint), state: reg.state(t.mint), feedState: reg.feedState(t.selectorKey), chain: { cluster: t.cluster, programId: "", supplyRaw: null, feePdaLamports: null, vaultRaw: null }, now: clock, nextCheckAt: null, implied: null, seriesTitle: null, selectorPending: 0, operator: { can: [], cannot: [], placeholder: true }, pair: null });
    assert.ok(json.every((r) => r.preLaunch === true));
    const w12 = json.find((r) => r.eventId === "2026-W12")!;
    assert.deepEqual(w12.verify.checks, []);
    assert.equal(w12.verify.verified, false, "a planned receipt is never shown verified; only its checks are empty");
    assert.equal(json.find((r) => r.eventId === "2026-W11")!.verify.verified, false, "an undisclosed pre-launch receipt fails");
    assert.ok(w12.note.startsWith(PRE_LAUNCH_NOTE));
  });
});
