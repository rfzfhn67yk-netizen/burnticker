// THE CHATGPT/CODEX ADVERSARIAL PR REVIEW (2026-10-10; docs/burnticker/reviews/2026-10-10-chatgpt-pr-review.md): one regression test per
// finding, written to fail on the code the review read and pass on the fix. The response (finding → disposition → test → commit) is
// docs/burnticker/reviews/2026-10-10-chatgpt-pr-review-response.md.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey } from "@solana/web3.js";
import { openRegistry } from "@/lib/burnticker/registry";
import { FakeBurnProgram } from "@/lib/burnticker/program";
import { buildLaunchBundle, FakeLaunchLab } from "@/lib/burnticker/launchBundle";
import { connectionLaunchVerifier, type LaunchVerifier, type TxReader } from "@/lib/burnticker/launchVerify";
import { fetchDue, planToken, runCycle, type KeeperDeps } from "@/lib/burnticker/multiKeeper";
import type { OracleAdapter } from "@/lib/burnticker/oracle/types";
import { CatalogueAdapter, feedById, loadFixture } from "@/lib/burnticker/catalogue";
import { validateRule } from "@/lib/burnticker/rules";
import { KalshiClient } from "@/lib/burnticker/oracle/kalshi";
import { API, CREATOR, FakeConnection, callRoute, makeWorld, programReceiptTx, upstreamFetch, zeroOf } from "./burntickerApiHelpers.ts";
import { verifyReceipt, burnProvenance, PLACEHOLDER_PROGRAM_ID } from "../packages/burnticker-sdk/src/index.ts";
import { limiter } from "@/lib/burnticker/api/http";
import { tokenPageInput } from "@/lib/burnticker/server";
import { buildTokenStatus, buildReceiptsJson, renderTokenHtml, buildPlatformIndex, renderPlatformIndexHtml, pairTally, renderPairHtml } from "@/lib/burnticker/tokenPage";
import fs from "node:fs";
import path from "node:path";
import { RATE_LIMITS } from "@/lib/burnticker/api/spec";
import { FakePinUploader } from "@/lib/burnticker/pin";
import { eventsFromTransaction, EVENT_IX_TAG, base58Decode as base58DecodeSk } from "../packages/burnticker-sdk/src/events.ts";
import { BURN_RECEIPTS_IDL } from "@/lib/burnReceipts/idl";
import { encodeType } from "@/lib/burnReceipts/idlCoder";
import { base58Encode } from "@/lib/burnKeeper/solana";
import { BRONCOS, DEBT_RULE, DENVER_HIGH, FRED_GFDEBTN_CSV, NOW } from "./burntickerHelpers.ts";

const POST = { "content-type": "application/json", origin: "http://bt.test" };
const ATTESTER = "KeeperDataKey1111111111111111111111111111111";

async function draftIn(reg: ReturnType<typeof openRegistry>, ticker: string, created = NOW, rule: unknown = BRONCOS) {
  const program = new FakeBurnProgram("devnet");
  const b = await buildLaunchBundle({ creator: CREATOR, ticker, name: `${ticker} coin`, description: "a test", imageUrl: null, links: [], rule, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true }, cluster: "devnet" }, { program, launchLab: new FakeLaunchLab(), devFeeWallet: null, attesters: [ATTESTER], quorum: 1, metadataUri: (m) => `https://x/${m}.json` });
  return reg.register({ mint: b.mint, ticker, name: b.name, creator: CREATOR, description: b.description, imageUrl: null, links: [], rulesText: b.rules.text, feePda: b.addresses.feePda, vault: b.addresses.vault, tokenConfig: b.addresses.tokenConfig, poolId: b.addresses.poolId, launchTx: null, cluster: "devnet", platformId: b.addresses.platformId, baselineAt: new Date(created).toISOString(), status: "draft" }, created);
}

describe("N1 — a launch confirmation cannot move the baseline", () => {
  test("registry: replaying the accepted launch signature is a no-op — the baseline stays where the launch put it", async () => {
    const reg = openRegistry(":memory:");
    const t = await draftIn(reg, "REPLAY");
    reg.markLaunched(t.mint, "sigA", null, "2026-10-01T00:00:00.000Z");
    reg.markLaunched(t.mint, "sigA", null, "2026-10-09T00:00:00.000Z");
    assert.equal(reg.token(t.mint)!.baselineAt, "2026-10-01T00:00:00.000Z", "the same signature again must not advance the baseline");
    assert.throws(() => reg.markLaunched(t.mint, "sigB", null, "2026-10-09T00:00:00.000Z"), /already launched/);
  });
  test("registry (SQL lock): once launched, no statement can change baseline_at", async () => {
    const reg = openRegistry(":memory:");
    const t = await draftIn(reg, "LOCKED");
    reg.markLaunched(t.mint, "sigA", null, "2026-10-01T00:00:00.000Z");
    assert.throws(() => reg.db.prepare("UPDATE tokens SET baseline_at=? WHERE mint=?").run("2026-10-09T00:00:00.000Z", t.mint), /baseline/);
  });
  test("registry: only a draft goes live (an expired or retired token is refused; a non-draft cannot be re-launched)", async () => {
    const reg = openRegistry(":memory:");
    const t = await draftIn(reg, "RETIRED");
    reg.setTokenStatus(t.mint, "retired");
    assert.throws(() => reg.markLaunched(t.mint, "sigA", null, "2026-10-01T00:00:00.000Z"), /not a draft/);
  });

  const SIG = "5".repeat(88), SIG2 = "4".repeat(88);
  const fakeVerifier = (blockTimes: number[], refuse: Set<string> = new Set()): LaunchVerifier & { calls: number } => {
    const v = { calls: 0, async verify(sig: string) { v.calls++; if (refuse.has(sig)) return { ok: false as const, status: 404 as const, reason: "no confirmed transaction with this signature" }; return { ok: true as const, blockTimeMs: blockTimes[Math.min(v.calls - 1, blockTimes.length - 1)] }; } };
    return v;
  };
  const bundle = async (ticker: string) => {
    const mint = Keypair.generate().publicKey.toBase58();
    const r = await callRoute(`${API}/launch/bundle`, { method: "POST", headers: POST, body: JSON.stringify({ creator: CREATOR, mint, ticker, name: ticker, rule: DENVER_HIGH, acknowledgements: { ruleLocked: true, noReturns: true } }) });
    assert.equal(r.status, 200, JSON.stringify(await r.clone().json()).slice(0, 200));
    return mint;
  };
  const confirm = (mint: string, signature: string) => callRoute(`${API}/launch/confirm`, { method: "POST", headers: POST, body: JSON.stringify({ mint, signature }) });

  test("API: the baseline is the launch transaction's block time; the same signature again returns 200 and leaves it alone", async () => {
    const w = await makeWorld();
    const t1 = Date.parse("2026-10-10T01:00:00Z"), t2 = Date.parse("2026-10-10T05:00:00Z");
    w.p.launchVerifier = fakeVerifier([t1, t2]);
    const mint = await bundle("REPLAYV1");
    assert.equal((await confirm(mint, SIG)).status, 200);
    assert.equal(w.registry.token(mint)!.baselineAt, new Date(t1).toISOString(), "baseline = chain block time, not the API call's clock");
    const again = await confirm(mint, SIG);
    assert.equal(again.status, 200, "an idempotent replay is not an error");
    assert.equal(w.registry.token(mint)!.baselineAt, new Date(t1).toISOString(), "the replay did not move the baseline");
    assert.equal((await confirm(mint, SIG2)).status, 409, "a different signature for a launched coin is refused");
  });
  test("API: an invented (syntactically valid) signature does not activate the draft", async () => {
    const w = await makeWorld();
    w.p.launchVerifier = fakeVerifier([NOW], new Set([SIG]));
    const mint = await bundle("INVENTED");
    const r = await confirm(mint, SIG);
    assert.equal(r.status, 404);
    assert.equal(w.registry.token(mint)!.status, "draft");
    assert.equal(w.registry.token(mint)!.launchTx, null, "a later legitimate confirmation is not blocked");
  });
  test("API: a host without a launch verifier (no RPC) refuses to confirm — fail closed", async () => {
    const w = await makeWorld();
    w.p.launchVerifier = null;
    const mint = await bundle("NORPC");
    const r = await confirm(mint, SIG);
    assert.equal(r.status, 503);
    assert.equal(w.registry.token(mint)!.status, "draft");
  });
  test("connectionLaunchVerifier: success, mint + creator signatures, the burn program, landed after the draft", async () => {
    const mint = Keypair.generate().publicKey.toBase58(), creator = Keypair.generate().publicKey.toBase58(), program = Keypair.generate().publicKey.toBase58(), other = Keypair.generate().publicKey.toBase58();
    const k = (s: string) => ({ toBase58: () => s });
    const tx = (o: { err?: unknown; keys?: string[]; signers?: number; blockTime?: number | null } = {}) => ({ blockTime: o.blockTime === undefined ? NOW / 1000 : o.blockTime, meta: { err: o.err ?? null }, transaction: { message: { header: { numRequiredSignatures: o.signers ?? 2 }, staticAccountKeys: (o.keys ?? [creator, mint, program]).map(k) } } });
    const reader = (r: ReturnType<typeof tx> | null): TxReader => ({ getTransaction: async () => r });
    const exp = { mint, creator, draftCreatedAtMs: NOW - 60_000 };
    assert.deepEqual(await connectionLaunchVerifier(reader(tx()), { burnProgramId: program }).verify("s", exp), { ok: true, blockTimeMs: NOW });
    assert.equal((await connectionLaunchVerifier(reader(null), { burnProgramId: program }).verify("s", exp)).ok, false);
    assert.match(JSON.stringify(await connectionLaunchVerifier(reader(tx({ err: { InstructionError: [0, "x"] } })), { burnProgramId: program }).verify("s", exp)), /failed on chain/);
    assert.match(JSON.stringify(await connectionLaunchVerifier(reader(tx({ keys: [creator, other, mint, program] })), { burnProgramId: program }).verify("s", exp)), /mint/, "the mint is present but not a signer");
    assert.match(JSON.stringify(await connectionLaunchVerifier(reader(tx({ keys: [other, mint, creator, program] })), { burnProgramId: program }).verify("s", exp)), /creator/);
    assert.match(JSON.stringify(await connectionLaunchVerifier(reader(tx({ keys: [creator, mint, other] })), { burnProgramId: program }).verify("s", exp)), /burn_receipts/);
    assert.match(JSON.stringify(await connectionLaunchVerifier(reader(tx({ blockTime: (NOW - 86_400_000) / 1000 })), { burnProgramId: program }).verify("s", exp)), /before this draft/);
  });
});

describe("N7 — a late-final event behind the settlement cursor is not skipped", () => {
  const deps = (reg: ReturnType<typeof openRegistry>, lines: string[] = []): KeeperDeps => ({ registry: reg, program: new FakeBurnProgram("devnet"), oracles: { kalshi: new KalshiClient({ fetchImpl: async () => ({ ok: false, status: 404, json: async () => ({}) }), now: () => NOW, minIntervalMs: 0 }), catalogue: new CatalogueAdapter() }, attester: ATTESTER, log: (l) => lines.push(l), now: () => NOW, dryRun: false });
  const live = async (reg: ReturnType<typeof openRegistry>, ticker: string, rule: unknown) => {
    const t = await draftIn(reg, ticker, Date.parse("2026-09-01T00:00:00Z"), rule);
    reg.markLaunched(t.mint, `launch${ticker}`, null, "2026-09-01T00:00:00Z");
    return reg.token(t.mint)!;
  };
  const ev = (id: string, at: string, result: "yes" | "no" | null, value: string | null = null) => ({ id, at, result, value, title: id, sourceUrl: "https://example.test" });

  test("binary: event A closes first but finalises after event B settled — A is still planned (per-event identity, not a watermark)", async () => {
    const reg = openRegistry(":memory:");
    const t = await live(reg, "LATE", BRONCOS);
    const d = deps(reg);
    reg.putReadings("kalshi", t.selectorKey, [ev("KXNFLGAME-26OCT02BBBDEN-DEN", "2026-10-02T20:00:00Z", "yes")], { settlementSourceUrl: null, attestedBy: [ATTESTER] });
    assert.deepEqual(planToken(d, t, reg.lockedRule(t)).map((r) => r.eventId), ["KXNFLGAME-26OCT02BBBDEN-DEN"]);
    reg.putReadings("kalshi", t.selectorKey, [ev("KXNFLGAME-26OCT01AAADEN-DEN", "2026-10-01T20:00:00Z", "yes")], { settlementSourceUrl: null, attestedBy: [ATTESTER] });
    assert.deepEqual(planToken(d, t, reg.lockedRule(t)).map((r) => [r.eventId, r.status]), [["KXNFLGAME-26OCT01AAADEN-DEN", "planned"]], "the late-final event burns");
    assert.equal(reg.state(t.mint).lastSettledAt, "2026-10-02T20:00:00Z", "the cursor never moves backwards");
    assert.deepEqual(planToken(d, t, reg.lockedRule(t)), [], "and it is planned once");
  });
  test("binary: a newly discovered event at the cursor's own timestamp with an earlier id is planned", async () => {
    const reg = openRegistry(":memory:");
    const t = await live(reg, "SAMETS", BRONCOS);
    const d = deps(reg);
    reg.putReadings("kalshi", t.selectorKey, [ev("KXNFLGAME-26OCT02ZZZDEN-DEN", "2026-10-02T20:00:00Z", "yes")], { settlementSourceUrl: null, attestedBy: [ATTESTER] });
    planToken(d, t, reg.lockedRule(t));
    reg.putReadings("kalshi", t.selectorKey, [ev("KXNFLGAME-26OCT02AAADEN-DEN", "2026-10-02T20:00:00Z", "yes")], { settlementSourceUrl: null, attestedBy: [ATTESTER] });
    assert.deepEqual(planToken(d, t, reg.lockedRule(t)).map((r) => r.eventId), ["KXNFLGAME-26OCT02AAADEN-DEN"]);
  });
  test("a reading at or before the launch baseline is never planned (the launch boundary is immutable)", async () => {
    const reg = openRegistry(":memory:");
    const t = await live(reg, "BOUND", BRONCOS);
    reg.putReadings("kalshi", t.selectorKey, [ev("KXNFLGAME-26AUG30AAADEN-DEN", "2026-08-30T20:00:00Z", "yes"), ev("KXNFLGAME-26SEP01AAADEN-DEN", "2026-09-01T00:00:00Z", "yes")], { settlementSourceUrl: null, attestedBy: [ATTESTER] });
    assert.deepEqual(planToken(deps(reg), t, reg.lockedRule(t)), []);
  });
  test("fixed-baseline scalar without carry (each reading independent): a late day is planned on its own value", async () => {
    const reg = openRegistry(":memory:");
    const t = await live(reg, "HOTDAYS", DENVER_HIGH);
    const d = deps(reg);
    reg.putReadings("kalshi", t.selectorKey, [ev("KXHIGHDEN-26OCT02", "2026-10-02T23:00:00Z", null, "85")], { settlementSourceUrl: null, attestedBy: [ATTESTER] });
    planToken(d, t, reg.lockedRule(t));
    reg.putReadings("kalshi", t.selectorKey, [ev("KXHIGHDEN-26OCT01", "2026-10-01T23:00:00Z", null, "83")], { settlementSourceUrl: null, attestedBy: [ATTESTER] });
    const late = planToken(d, t, reg.lockedRule(t));
    assert.deepEqual(late.map((r) => r.eventId), ["KXHIGHDEN-26OCT01"]);
    assert.equal(reg.receipt(t.mint, "KXHIGHDEN-26OCT01")!.units, 3, "83 − 80 = 3 units, independent of the later day");
  });
  test("ordered scalar (previousSettlement): a late period behind the cursor is NOT re-applied against the newest value — carry preserved, an alert raised", async () => {
    const reg = openRegistry(":memory:");
    const SPXLIKE = { ...DENVER_HIGH, scalar: { ...DENVER_HIGH.scalar, baseline: "previousSettlement" } };
    const t = await live(reg, "ORDERED", SPXLIKE);
    const lines: string[] = [];
    const d = deps(reg, lines);
    reg.putReadings("kalshi", t.selectorKey, [ev("KXHIGHDEN-26OCT01", "2026-10-01T23:00:00Z", null, "80"), ev("KXHIGHDEN-26OCT03", "2026-10-03T23:00:00Z", null, "86")], { settlementSourceUrl: null, attestedBy: [ATTESTER] });
    planToken(d, t, reg.lockedRule(t));
    const before = reg.state(t.mint);
    reg.putReadings("kalshi", t.selectorKey, [ev("KXHIGHDEN-26OCT02", "2026-10-02T23:00:00Z", null, "90")], { settlementSourceUrl: null, attestedBy: [ATTESTER] });
    assert.deepEqual(planToken(d, t, reg.lockedRule(t)), [], "the change through Oct 2 is already inside Oct 3's delta from Oct 1");
    assert.deepEqual(reg.state(t.mint), before, "cursor, value and carry untouched");
    assert.ok(reg.alertsSince(0).some((a) => a.kind === "late-reading" && a.text.includes("KXHIGHDEN-26OCT02")), "the skipped late period is surfaced, never silent");
  });
  test("fetch window: while an event awaits finality the read window does not slide past it (a market final weeks later is still read)", async () => {
    const reg = openRegistry(":memory:");
    const t = await live(reg, "ANCHOR", BRONCOS);
    const seen: (string | null)[] = [];
    let awaiting = 1;
    let clock = Date.parse("2026-10-02T21:00:00Z");
    const events = [ev("KXNFLGAME-26OCT02BBBDEN-DEN", "2026-10-02T20:00:00Z", "yes")];
    const kalshi = { id: "kalshi", searchSeries: async () => [], seriesInfo: async () => null, impliedChance: async () => ({ chance: null, marketTicker: null, closeTime: null, basis: "" }),
      settledSince: async (_r: unknown, since: string | null) => { seen.push(since); return { events: events.filter((e) => since === null || e.at > since), awaitingFinal: awaiting, refusals: [], settlementSourceUrl: null }; } } as unknown as OracleAdapter;
    const d: KeeperDeps = { ...deps(reg), oracles: { kalshi, catalogue: new CatalogueAdapter() }, now: () => clock };
    reg.putReadings("kalshi", t.selectorKey, [ev("KXNFLGAME-26SEP20AAADEN-DEN", "2026-09-20T20:00:00Z", "no")], { settlementSourceUrl: null, attestedBy: [ATTESTER] });
    await fetchDue(d, [t]);                          // since = Sep 20 − 7 d; one event awaits finality → the anchor is set
    assert.equal(seen[0], "2026-09-13T20:00:00.000Z");
    clock += 30 * 86_400_000;                        // a month later: the newest reading is Oct 2, the plain window would start Sep 25
    await fetchDue(d, [t]);
    assert.equal(seen[1], "2026-09-13T20:00:00.000Z", "still anchored while the event awaits finality");
    awaiting = 0; clock += 86_400_000;
    await fetchDue(d, [t]);
    awaiting = 0; clock += 86_400_000;
    await fetchDue(d, [t]);
    assert.equal(seen[3], "2026-09-25T20:00:00.000Z", "once nothing awaits, the window slides again");
  });
});

describe("N2 — a generic catalogue feed settles only on an agreeing independent cross-read, read in the same cycle", () => {
  const BLS = loadFixture(feedById("bls.eggs")!).body as { Results: { series: { data: { year: string; period: string; value: string }[] }[] } };
  const FRED = loadFixture(feedById("fred.APU0000708111")!).body as string;
  const eggs = feedById("bls.eggs")!;
  const EGGS = validateRule({ ...DEBT_RULE, series: "bls.eggs", scalar: { unit: eggs.unit!.size, perUnit: { fractionOfPool: 0.01 }, baseline: eggs.baseline, direction: eggs.direction } });
  const withValue = (period: string, value: string) => { const b = structuredClone(BLS); b.Results.series[0].data.find((x) => `${x.year}-${x.period.slice(1)}` === period)!.value = value; return b; };
  const routes = (o: { bls?: unknown; fred?: string | null; treasury?: unknown; gfdebtn?: string | null }) => (async (u: string) =>
    u.includes("api.bls.gov") && o.bls ? { ok: true, status: 200, json: async () => o.bls }
    : u.includes("fred.stlouisfed.org") && u.includes("APU0000708111") && o.fred ? { ok: true, status: 200, json: async () => ({}), text: async () => o.fred! }
    : u.includes("fred.stlouisfed.org") && u.includes("GFDEBTN") && o.gfdebtn ? { ok: true, status: 200, json: async () => ({}), text: async () => o.gfdebtn! }
    : u.includes("fiscaldata.treasury.gov") && o.treasury ? { ok: true, status: 200, json: async () => o.treasury }
    : { ok: false, status: 503, json: async () => ({}), text: async () => "" }) as never;
  const adapter = (o: Parameters<typeof routes>[0]) => new CatalogueAdapter({ fetchImpl: routes(o), now: () => NOW });

  test("agreeing periods pass, and each reading's method names the cross-read and its value", async () => {
    const r = await adapter({ bls: BLS, fred: FRED }).settledSince(EGGS, "2026-05");
    assert.deepEqual(r.events.map((e) => e.id), ["2026-06", "2026-07", "2026-08"]);
    assert.ok(r.events.every((e) => /cross-read fred\.APU0000708111 \(Federal Reserve Bank of St\. Louis \(FRED\)\): [\d.]+ for \d{4}-\d{2} agrees/.test(e.method ?? "")), r.events.map((e) => e.method).join(" | "));
  });
  test("the primary later publishes a wrong value: that period and everything after it are held (never written, never attested)", async () => {
    const r = await adapter({ bls: withValue("2026-07", "2.999"), fred: FRED }).settledSince(EGGS, "2026-05");
    assert.deepEqual(r.events.map((e) => e.id), ["2026-06"], "the prefix before the disagreement only");
    assert.equal(r.awaitingFinal, 2);
    assert.ok(r.refusals.some((x) => /2026-07.*disagree/.test(x)), r.refusals.join(" | "));
  });
  test("the cross-read is down while the primary is up: every reading is held", async () => {
    const r = await adapter({ bls: BLS, fred: null }).settledSince(EGGS, "2026-05");
    assert.deepEqual(r.events, []);
    assert.equal(r.awaitingFinal, 3);
    assert.ok(r.refusals.some((x) => /no cross-read could be read this cycle/.test(x)));
  });
  test("the cross-read lags (no value for the newest period yet): the newest period waits", async () => {
    const lagging = FRED.split("\n").filter((l) => !l.startsWith("2026-08-01")).join("\n");
    const r = await adapter({ bls: BLS, fred: lagging }).settledSince(EGGS, "2026-05");
    assert.deepEqual(r.events.map((e) => e.id), ["2026-06", "2026-07"]);
    assert.ok(r.refusals.some((x) => /2026-08: the cross-read .* has no value for this period yet/.test(x)));
  });
  test("through the keeper: a disagreeing reading is not written to the registry", async () => {
    const reg = openRegistry(":memory:");
    const t = await draftIn(reg, "EGGS", Date.parse("2026-05-01T00:00:00Z"), EGGS);
    reg.markLaunched(t.mint, "launchEGGS", null, "2026-05");
    const d: KeeperDeps = { registry: reg, program: new FakeBurnProgram("devnet"), oracles: { kalshi: new KalshiClient({ fetchImpl: routes({}), now: () => NOW, minIntervalMs: 0 }), catalogue: adapter({ bls: withValue("2026-06", "2.200"), fred: FRED }) }, attester: ATTESTER, log: () => {}, now: () => NOW, dryRun: false };
    const [rep] = await fetchDue(d, [reg.token(t.mint)!]);
    assert.equal(rep.error, null);
    assert.ok(!reg.readings(t.selectorKey).some((x) => x.id >= "2026-06"), "nothing from the disagreeing period on reached the registry");
  });
  test("quarter-end pair (Treasury daily vs FRED quarterly): series-level check — readable and no shared quarter → accepted with the limitation stated; a shared quarter that disagrees → held", async () => {
    const treasury = loadFixture(feedById("treasury.debt")!).body as { data: { record_date: string; tot_pub_debt_out_amt: string }[] };
    const ok = await adapter({ treasury, gfdebtn: FRED_GFDEBTN_CSV }).settledSince(validateRule(DEBT_RULE), "2026-10-05");
    assert.deepEqual(ok.events.map((e) => e.id), ["2026-10-06", "2026-10-07", "2026-10-08"]);
    assert.ok(ok.events.every((e) => /series check: cross-read fred\.GFDEBTN .* not individually corroborated/.test(e.method ?? "")));
    const down = await adapter({ treasury, gfdebtn: null }).settledSince(validateRule(DEBT_RULE), "2026-10-05");
    assert.deepEqual(down.events, [], "cross-read unreadable → held");
    // Treasury's read reaching the end of Q2 with a value FRED does not report for 2026-Q2
    const q2 = { ...treasury, data: [...treasury.data, { record_date: "2026-06-30", tot_pub_debt_out_amt: "39900000000000.00" }] };
    const bad = await adapter({ treasury: q2, gfdebtn: FRED_GFDEBTN_CSV }).settledSince(validateRule(DEBT_RULE), "2026-10-05");
    assert.deepEqual(bad.events, []);
    assert.ok(bad.refusals.some((x) => /disagrees on 2026-Q2/.test(x)), bad.refusals.join(" | "));
  });
});

describe("N3 — SDK verification never accepts a memo-only transaction as a burn", () => {
  const setup = async () => {
    const w = await makeWorld();
    const tok = w.registry.token(w.bronco.mint)!;
    const receipts = (await (await callRoute(`${API}/tokens/BRONCO/receipts`)).json()) as { receipts: (Parameters<typeof verifyReceipt>[0] & { status: string })[] };
    const rec = receipts.receipts.find((x) => x.status === "confirmed")!;
    return { w, tok, rec, base: { ticker: "BRONCO", rulesText: tok.rulesJson, fetch: upstreamFetch, now: NOW, programId: PLACEHOLDER_PROGRAM_ID, mint: tok.mint } };
  };
  test("a lone Memo instruction carrying the receipt's exact memo fails the chain check (and never counts as verified chain evidence)", async () => {
    const { rec, tok, base } = await setup();
    const c = new FakeConnection();
    c.txs.set(rec.signature!, programReceiptTx(c, { programId: PLACEHOLDER_PROGRAM_ID, mint: tok.mint, memo: rec.memo!, burnedRaw: BigInt(1), memoOnly: true }));
    const v = await verifyReceipt(rec, { ...base, connection: c as never });
    const chain = v.checks.find((x) => x.id === "chain")!;
    assert.equal(chain.ok, false, chain.detail);
    assert.match(chain.detail, /never calls the burn program/);
    assert.equal(v.verified, false);
  });
  test("without programId + mint the chain check is 'not checked', never a pass — even when a memo matches", async () => {
    const { rec, tok, base } = await setup();
    const c = new FakeConnection();
    c.txs.set(rec.signature!, programReceiptTx(c, { programId: PLACEHOLDER_PROGRAM_ID, mint: tok.mint, memo: rec.memo!, burnedRaw: BigInt(1), memoOnly: true }));
    const v = await verifyReceipt(rec, { ...base, programId: undefined, mint: undefined, connection: c as never });
    assert.equal(v.checks.find((x) => x.id === "chain")!.ok, null);
  });
  test("the real thing passes: the program's own Memo CPI + burn of the mint + a processed Reading with the same burned amount", async () => {
    const { rec, tok, base } = await setup();
    const c = new FakeConnection();
    c.txs.set(rec.signature!, programReceiptTx(c, { programId: PLACEHOLDER_PROGRAM_ID, mint: tok.mint, memo: rec.memo!, burnedRaw: BigInt(777), strayMemo: "decoy" }));
    const v = await verifyReceipt(rec, { ...base, connection: c as never });
    assert.equal(v.checks.find((x) => x.id === "chain")!.ok, true, JSON.stringify(v.checks));
  });
  test("program instruction present but the Reading is not processed, or burned a different amount, or another mint: fails", async () => {
    const { rec, tok, base } = await setup();
    for (const o of [{ readingProcessed: false }, { readingBurned: BigInt(5) }]) {
      const c = new FakeConnection();
      c.txs.set(rec.signature!, programReceiptTx(c, { programId: PLACEHOLDER_PROGRAM_ID, mint: tok.mint, memo: rec.memo!, burnedRaw: BigInt(777), ...o }));
      assert.equal((await verifyReceipt(rec, { ...base, connection: c as never })).checks.find((x) => x.id === "chain")!.ok, false, Object.keys(o).join(","));
    }
    const other = Keypair.generate().publicKey.toBase58();
    const c = new FakeConnection();
    const tx = programReceiptTx(c, { programId: PLACEHOLDER_PROGRAM_ID, mint: other, memo: rec.memo!, burnedRaw: BigInt(777) });
    assert.equal(burnProvenance(tx as never, { programId: PLACEHOLDER_PROGRAM_ID.toBase58(), mint: tok.mint, recordDate: null }).ok, false, "a crank on another mint is not this coin's burn");
  });
  test("SDK events: the memo attached to a program event is the program's own Memo CPI, not the first memo in the logs", () => {
    const programId = Keypair.generate().publicKey;
    const disc = Buffer.from(BURN_RECEIPTS_IDL.events.find((e) => e.name === "ReadingProcessed")!.discriminator);
    const data = Buffer.concat([EVENT_IX_TAG, disc, encodeType(BURN_RECEIPTS_IDL, { defined: { name: "ReadingProcessed" } }, zeroOf({ defined: { name: "ReadingProcessed" } }))]);
    const keys = [Keypair.generate().publicKey, programId, new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr")];
    const tx = { slot: 9, blockTime: 1, meta: { err: null, logMessages: ['Program log: Memo (len 5): "decoy"', 'Program log: Memo (len 4): "real"'], innerInstructions: [{ index: 1, instructions: [{ programIdIndex: 1, data: base58Encode(data) }, { programIdIndex: 2, data: base58Encode(Buffer.from("real", "utf8")) }] }] }, transaction: { message: { getAccountKeys: () => ({ get: (i: number) => keys[i] }) } } };
    const evs = eventsFromTransaction(tx as never, programId, "sig");
    assert.equal(evs.length, 1);
    assert.equal(evs[0].memo, "real");
  });
});

describe("N4 — the legacy wizard route is metered like the public API, and paid uploads have a host-wide daily budget", () => {
  const legacy = async (body: unknown, ip = "198.51.100.40") => {
    const { POST } = await import("../src/app/api/burnticker/launch/route.ts");
    return POST(new Request("http://bt.test/api/burnticker/launch", { method: "POST", headers: { host: "bt.test", origin: "http://bt.test", "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify(body) }));
  };
  test("a client that floods /api/burnticker/launch is rate limited (429 + Retry-After), like /v1/launch/bundle", async () => {
    await makeWorld(); limiter.reset();
    let last: Response | null = null;
    for (let i = 0; i <= RATE_LIMITS.write.burst; i++) last = await legacy({});
    assert.equal(last!.status, 429);
    assert.ok(Number(last!.headers.get("retry-after")) > 0);
    assert.notEqual((await legacy({}, "198.51.100.41")).status, 429, "another client is not affected");
    limiter.reset();
  });
  test("the two routes share one write bucket: spending it on /v1 leaves nothing for the legacy route", async () => {
    await makeWorld(); limiter.reset();
    for (let i = 0; i < RATE_LIMITS.write.burst; i++) await callRoute(`${API}/launch/confirm`, { method: "POST", headers: { ...POST, "x-forwarded-for": "198.51.100.42" }, body: JSON.stringify({ mint: "x", signature: "y" }) });
    assert.equal((await legacy({}, "198.51.100.42")).status, 429);
    limiter.reset();
  });
  test("paid uploads stop at the host's daily budget (BURNTICKER_PIN_DAILY_CAP): the next registered launch is refused before anything is pinned", async () => {
    const w = await makeWorld(); limiter.reset();
    const up = new FakePinUploader();
    w.p.uploader = up; w.p.pinDailyCap = 2;
    const bundle = (ticker: string) => callRoute(`${API}/launch/bundle`, { method: "POST", headers: { ...POST, "x-forwarded-for": `198.51.100.${ticker.length + 50}` }, body: JSON.stringify({ creator: CREATOR, mint: Keypair.generate().publicKey.toBase58(), ticker, name: ticker, rule: DENVER_HIGH, acknowledgements: { ruleLocked: true, noReturns: true } }) });
    assert.equal((await bundle("CAPA")).status, 200);
    assert.equal((await bundle("CAPBB")).status, 200);
    const uploadsBefore = up.uploads?.length ?? null;
    const third = await bundle("CAPCCC");
    assert.equal(third.status, 429, JSON.stringify(await third.clone().json()));
    assert.equal(((await third.json()) as { code: string }).code, "upload-budget");
    if (uploadsBefore !== null) assert.equal(up.uploads.length, uploadsBefore, "nothing more was uploaded");
    assert.equal(w.registry.tokenByTicker("CAPCCC"), null, "and no draft was created");
    limiter.reset();
  });
});

describe("N6 — with the pair curve enabled the wizard route never hands out two independent LaunchLab launches", () => {
  const LOSE = { ...BRONCOS, binary: { onYes: null, onNo: { fractionOfPool: 0.02 } } };
  const pairBody = (extra: Record<string, unknown> = {}) => ({ creator: CREATOR, ticker: "BRONCOS", name: "Broncos", description: "", imageUrl: null, links: [], rule: LOSE, acknowledgements: { ruleLocked: true, noReturns: true }, pair: { ticker: "CHIEFS", name: "Chiefs" }, ...extra });
  const legacy = async (body: unknown) => {
    const { POST } = await import("../src/app/api/burnticker/launch/route.ts");
    return POST(new Request("http://bt.test/api/burnticker/launch", { method: "POST", headers: { host: "bt.test", origin: "http://bt.test", "content-type": "application/json", "x-forwarded-for": `203.0.113.${Math.floor(Math.random() * 200)}` }, body: JSON.stringify(body) }));
  };
  const withFlag = async <T>(fn: () => Promise<T>): Promise<T> => { const was = process.env.BURNTICKER_PAIR_CURVE_ENABLED; process.env.BURNTICKER_PAIR_CURVE_ENABLED = "1"; try { return await fn(); } finally { if (was === undefined) delete process.env.BURNTICKER_PAIR_CURVE_ENABLED; else process.env.BURNTICKER_PAIR_CURVE_ENABLED = was; } };

  test("flag on, a client that does not ask for the pair-curve venue: refused (409) before anything is pinned or registered — no silent LaunchLab fallback", async () => {
    const w = await makeWorld(); limiter.reset();
    const r = await withFlag(() => legacy(pairBody()));
    assert.equal(r.status, 409);
    const j = await r.json() as { code: string; bundles?: unknown };
    assert.equal(j.code, "pair-curve-required");
    assert.equal(j.bundles, undefined);
    assert.equal(w.registry.tokenByTicker("BRONCOS"), null);
    assert.equal(w.registry.tokenByTicker("CHIEFS"), null);
  });
  test("flag on, venue pair-curve: the response carries the pair-curve transaction set and NOT the LaunchLab bundles; drafts carry no LaunchLab pool", async () => {
    const w = await makeWorld(); limiter.reset();
    const r = await withFlag(() => legacy(pairBody({ venue: "pair-curve" })));
    assert.equal(r.status, 200, JSON.stringify(await r.clone().json()).slice(0, 300));
    const j = await r.json() as { venue: string; pairCurve?: { version: string; mints: { a: string; b: string }; transactions: { signers: string[] }[] }; bundles?: unknown; mintSecretKeys?: { a: string | null; b: string | null } };
    assert.equal(j.venue, "pair-curve");
    assert.equal(j.pairCurve?.version, "burnticker.pair-curve-launch/v1");
    assert.equal(j.bundles, undefined, "the independent LaunchLab bundles are not offered");
    assert.ok(!/LaunchLab create|launchpad\.initialize/i.test(JSON.stringify(j.pairCurve)) && !/"bundle"\s*:/.test(JSON.stringify(j)), "no LaunchLab create instruction anywhere in the response");
    // the browser signs tx 1 (creator + mint A) and tx 2 (creator + mint B): both mint secrets ride along and match the pair's mints
    for (const side of ["a", "b"] as const) {
      const sk = j.mintSecretKeys?.[side];
      assert.ok(sk, `mintSecretKeys.${side}`);
      assert.equal(Keypair.fromSecretKey(Buffer.from(base58DecodeSk(sk!))).publicKey.toBase58(), j.pairCurve!.mints[side]);
    }
    assert.deepEqual(j.pairCurve!.transactions.map((t) => t.signers), [["creator", "mintA"], ["creator", "mintB"], ["creator"]]);
    const a = w.registry.tokenByTicker("BRONCOS")!, b = w.registry.tokenByTicker("CHIEFS")!;
    assert.deepEqual([a.mint, b.mint], [j.pairCurve!.mints.a, j.pairCurve!.mints.b], "the drafts are the pair's mints");
    assert.equal(a.poolId, null); assert.equal(b.poolId, null);
  });
  test("launch confirmation of a pair-curve coin: tx 1 confirms side A, tx 2 side B (mint creation + initialize_token, signed by creator + that mint); tx 3 (init_pair) confirms neither", async () => {
    const w = await makeWorld(); limiter.reset();
    const r = await withFlag(() => legacy(pairBody({ venue: "pair-curve" })));
    const j = await r.json() as { pairCurve: { mints: { a: string; b: string }; transactions: { signers: ("creator" | "mintA" | "mintB")[]; instructions: { programId: string; keys: { pubkey: string }[] }[] }[] } };
    const who = { creator: CREATOR, mintA: j.pairCurve.mints.a, mintB: j.pairCurve.mints.b };
    // the transaction as getTransaction would return it once landed: signers first, then every other account and program id
    const landed = (t: (typeof j.pairCurve.transactions)[number]) => {
      const signers = t.signers.map((x) => who[x]);
      const rest = [...new Set(t.instructions.flatMap((ix) => [...ix.keys.map((k) => k.pubkey), ix.programId]))].filter((k) => !signers.includes(k));
      return { blockTime: Math.floor(Date.now() / 1000), meta: { err: null }, transaction: { message: { header: { numRequiredSignatures: signers.length }, staticAccountKeys: [...signers, ...rest].map((k) => ({ toBase58: () => k })) } } };
    };
    const verifierFor = (t: (typeof j.pairCurve.transactions)[number]) => connectionLaunchVerifier({ getTransaction: async () => landed(t) } as never, { burnProgramId: w.p.program.programId });
    const [tx1, tx2, tx3] = j.pairCurve.transactions;
    const a = w.registry.tokenByTicker("BRONCOS")!, b = w.registry.tokenByTicker("CHIEFS")!;
    const exp = (t: typeof a) => ({ mint: t.mint, creator: t.creator, draftCreatedAtMs: t.createdAt });
    assert.equal((await verifierFor(tx1).verify("s", exp(a))).ok, true, "tx 1 is side A's launch");
    assert.equal((await verifierFor(tx2).verify("s", exp(b))).ok, true, "tx 2 is side B's launch");
    assert.equal((await verifierFor(tx1).verify("s", exp(b))).ok, false, "tx 1 is not side B's launch");
    assert.equal((await verifierFor(tx3).verify("s", exp(a))).ok, false, "init_pair is signed by the creator only: not a coin's launch");
    // and through the route: confirming A with tx 1 takes A live with the block time as its baseline
    w.p.launchVerifier = verifierFor(tx1);
    const c = await legacy({ action: "launched", mint: a.mint, launchTx: "5".repeat(88) });
    assert.equal(c.status, 200, JSON.stringify(await c.clone().json()));
    assert.equal(w.registry.token(a.mint)!.status, "live");
  });
  test("flag off: the LaunchLab pair flow is unchanged (two bundles, no pairCurve)", async () => {
    await makeWorld(); limiter.reset();
    const was = process.env.BURNTICKER_PAIR_CURVE_ENABLED; delete process.env.BURNTICKER_PAIR_CURVE_ENABLED;
    try {
      const r = await legacy(pairBody());
      assert.equal(r.status, 200);
      const j = await r.json() as { bundles?: { a: unknown; b: unknown }; pairCurve?: unknown };
      assert.ok(j.bundles?.a && j.bundles?.b); assert.equal(j.pairCurve, undefined);
      assert.equal((await legacy(pairBody({ ticker: "BRONCOS2", pair: { ticker: "CHIEFS2", name: "c" }, venue: "pair-curve" }))).status, 409, "asking for the pair curve on a host without it is refused, not ignored");
    } finally { if (was !== undefined) process.env.BURNTICKER_PAIR_CURVE_ENABLED = was; }
  });
});

describe("C1 (checklist mismatch, owner decision 2026-10-10) — with Kalshi off the keeper does not read Kalshi at all, not even for existing coins", () => {
  const ev = (id: string, at: string) => ({ id, at, result: "yes" as const, value: null, title: id, sourceUrl: "https://example.test" });
  const setup = async (kalshiEnabled: boolean | undefined) => {
    const reg = openRegistry(":memory:");
    const t = await draftIn(reg, "KOLD", Date.parse("2026-09-01T00:00:00Z"), BRONCOS);
    reg.markLaunched(t.mint, "launchKOLD", null, "2026-09-01T00:00:00Z");
    let calls = 0;
    const kalshi = { id: "kalshi", searchSeries: async () => [], seriesInfo: async () => null, impliedChance: async () => ({ chance: null, marketTicker: null, closeTime: null, basis: "" }),
      settledSince: async () => { calls++; return { events: [ev("KXNFLGAME-26OCT02BBBDEN-DEN", "2026-10-02T20:00:00Z")], awaitingFinal: 0, refusals: [], settlementSourceUrl: null }; } } as unknown as OracleAdapter;
    const d: KeeperDeps = { registry: reg, program: new FakeBurnProgram("devnet"), oracles: { kalshi, catalogue: new CatalogueAdapter() }, attester: ATTESTER, log: () => {}, now: () => NOW, dryRun: false, ...(kalshiEnabled === undefined ? {} : { kalshiEnabled }) };
    return { reg, t: reg.token(t.mint)!, d, calls: () => calls };
  };
  test("flag off: no Kalshi read, no reading stored, a 'venue disabled' alert, and the coin is held (nothing planned)", async () => {
    const { reg, t, d, calls } = await setup(false);
    const rep = await fetchDue(d, [t]);
    assert.equal(calls(), 0, "the Kalshi adapter is never called");
    assert.match(rep[0].error ?? "", /venue disabled/);
    assert.deepEqual(reg.readings(t.selectorKey), []);
    assert.ok(reg.alertsSince(0).some((a) => a.kind === "venue-disabled" && a.text.includes("KOLD")));
    reg.putReadings("kalshi", t.selectorKey, [ev("KXNFLGAME-26OCT01AAADEN-DEN", "2026-10-01T20:00:00Z")], { settlementSourceUrl: null, attestedBy: [ATTESTER] });
    const cyc = await runCycle(d);
    assert.equal(calls(), 0);
    assert.deepEqual(cyc.planned, [], "a reading already held is not planned while the venue is off");
  });
  test("flag on (or unset in a unit test): read as before", async () => {
    const { reg, t, d, calls } = await setup(true);
    await fetchDue(d, [t]);
    assert.equal(calls(), 1);
    assert.equal(reg.readings(t.selectorKey).length, 1);
  });
});

describe("No odds for any coin (owner decision 2026-10-10): the market-implied chance is never read, published or rendered", () => {
  test("a status built from an oracle that DID return a chance still publishes impliedChance null; the token, index and pair pages render no chance", async () => {
    const w = await makeWorld();
    const t = w.registry.token(w.bronco.mint)!;
    const input = { ...(await tokenPageInput(w.p, t, NOW, { live: false })), implied: { chance: 0.62, marketTicker: "KXNFLGAME-26OCT12DENNYJ-DEN", closeTime: "2026-10-12T20:00:00Z", basis: "YES mid 0.62" } };
    const receipts = buildReceiptsJson(input);
    const st = buildTokenStatus(input, receipts);
    assert.equal(st.next.impliedChance, null);
    assert.equal(st.next.impliedBasis, null, "a basis that describes a price is not published either");
    assert.equal(st.next.nextMarket, "KXNFLGAME-26OCT12DENNYJ-DEN", "the factual venue label (next market, close time) stays");
    const html = renderTokenHtml(st, receipts, []);
    assert.doesNotMatch(html, /implied|chance of the next burn|YES mid/i);
    const ix = buildPlatformIndex([st], NOW);
    assert.equal(ix.tokens[0].impliedChance, null);
    assert.doesNotMatch(renderPlatformIndexHtml(ix), /chance|implied/i);
    const pair = renderPairHtml(pairTally(st, st, receipts, receipts), st, st, receipts, receipts);
    assert.doesNotMatch(pair, /implied|chance \$/i);
  });
  test("lint: no coin-page renderer reads or formats a chance (app pages, components, the static page renderer)", () => {
    const ROOT = path.resolve(import.meta.dirname, "..");
    const walk = (d: string): string[] => fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : /\.(tsx?|mts)$/.test(e.name) ? [path.join(d, e.name)] : []) : [];
    const files = [...walk(path.join(ROOT, "src/app/burnticker")), ...walk(path.join(ROOT, "src/components")).filter((f) => /burnticker|coin/i.test(f)), path.join(ROOT, "src/lib/burnticker/tokenPage.ts"), path.join(ROOT, "src/lib/launch/dailyPost.ts")];
    const bad: string[] = [];
    for (const f of files) {
      const src = fs.readFileSync(f, "utf8");
      for (const re of [/impliedChance\s*\*\s*100/, /chance[AB]?\s*\*\s*100/, /Market-implied chance/i, /Kalshi-implied chance/i, /Next-burn chance/i, /\.impliedChance\s*!==\s*null\s*&&/]) if (re.test(src)) bad.push(`${path.relative(ROOT, f)}: ${re}`);
    }
    assert.deepEqual(bad, []);
  });
});
