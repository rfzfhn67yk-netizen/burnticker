// ATTESTATION, QUORUM 2 OFF CHAIN (2026-10-09): the agreement rule, the gate's memory of attested dates, and the keeper cycle
// refusing to sign a swap or a burn for a date the second attester has not confirmed — against the fake chain, no network.
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { openLedger, type Ledger } from "@/lib/burnKeeper/ledger";
import { executePending, ingest, type KeeperCtx } from "@/lib/burnKeeper/cycle";
import { usdToCents, type LoadedRules } from "@/lib/burnKeeper/rules";
import type { DebtReading, FeedValidation } from "@/lib/burnKeeper/feeds/treasury";
import { compareAttested, decimalToCents, fakeAttester, scaledToDecimalString, toDebtReading, type AttestedReading } from "@/lib/burnKeeper/attesters/types";
import { attestedKey, attesterGate } from "@/lib/burnKeeper/attesters/gate";
import { buybackRules, FakeChain, FakeRouter, vaultRules } from "./burnKeeperHelpers.ts";

const R = (d: string, a: string): DebtReading => ({ recordDate: d, amount: a, cents: usdToCents(a) });
const V = (...readings: DebtReading[]): FeedValidation => ({ readings, refusals: [] });
const T = "DEBT", F = "treasury.debt_to_penny";
const BASE = "40284036147367.19", D1 = "40305316210829.72", D2 = "40306500000000.00";
const NOW = Date.parse("2026-10-09T21:00:00Z");
const att = (value: string, extra: Partial<AttestedReading> = {}): AttestedReading => ({ attester: "switchboard:FEED", value, cents: decimalToCents(value), slot: 1000, observedAt: NOW - 60_000, jobHash: null, feedHash: "ab", oracles: ["o1"], evidence: {}, ...extra });

describe("compareAttested — the agreement rule", () => {
  const k = usdToCents(D1);
  test("identical figures agree; tolerance 0 refuses a cent", () => {
    assert.equal(compareAttested(k, att(D1), { toleranceBps: 0, maxAgeMs: 3_600_000, now: NOW }).ok, true);
    const r = compareAttested(k, att("40305316210829.71"), { toleranceBps: 0, maxAgeMs: 3_600_000, now: NOW });
    assert.equal(r.ok, false); assert.match((r as { why: string }).why, /DISAGREES — attested 40305316210829.71, keeper 40305316210829.72, difference 0.01/);
  });
  test("tolerance in bps is on the keeper's figure", () => {
    assert.equal(compareAttested(k, att("40305316210800.00"), { toleranceBps: 1, maxAgeMs: 3_600_000, now: NOW }).ok, true);
    assert.equal(compareAttested(k, att("40310000000000.00"), { toleranceBps: 1, maxAgeMs: 3_600_000, now: NOW }).ok, false, "$4.7B off is beyond 1 bp (≈ $4.03B)");
  });
  test("stale by age or by slot is refused with both figures in the text", () => {
    const old = compareAttested(k, att(D1, { observedAt: NOW - 2 * 86_400_000 }), { toleranceBps: 0, maxAgeMs: 86_400_000, now: NOW });
    assert.equal(old.ok, false); assert.match((old as { why: string }).why, /stale — observed 2880 min ago.*attested 40305316210829.72, keeper 40305316210829.72/);
    const slots = compareAttested(k, att(D1, { slot: 100 }), { toleranceBps: 0, maxAgeMs: 86_400_000, now: NOW, nowSlot: 5_000, maxStalenessSlots: 1_000 });
    assert.equal(slots.ok, false); assert.match((slots as { why: string }).why, /4900 slots behind/);
    assert.equal(compareAttested(k, att(D1, { slot: null }), { toleranceBps: 0, maxAgeMs: 86_400_000, now: NOW, nowSlot: 5_000, maxStalenessSlots: 1_000 }).ok, true, "no slot on the attestation: the slot ceiling does not apply");
  });
  test("a value that is not a two-decimal dollar amount cannot agree", () => {
    const r = compareAttested(k, att("40305316210829.723", { cents: null }), { toleranceBps: 0, maxAgeMs: 3_600_000, now: NOW });
    assert.equal(r.ok, false); assert.match((r as { why: string }).why, /not a dollar amount/);
  });
  test("helpers: scaled i128 → decimal, decimal → cents, Reading view", () => {
    assert.equal(scaledToDecimalString(BigInt("40305316210829720000000000000000"), 18), "40305316210829.72");
    assert.equal(scaledToDecimalString(BigInt("5000000000000000000"), 18), "5");
    assert.equal(scaledToDecimalString(BigInt("1"), 18), "0.000000000000000001");
    assert.equal(decimalToCents("40305316210829.7"), usdToCents("40305316210829.70"));
    assert.equal(decimalToCents("1.234"), null); assert.equal(decimalToCents("-1"), null); assert.equal(decimalToCents("abc"), null);
    assert.deepEqual(toDebtReading(att(D1), "2026-10-08"), { recordDate: "2026-10-08", amount: D1, cents: usdToCents(D1) });
  });
});

describe("attesterGate — memory of attested dates", () => {
  let ledger: Ledger, loaded: LoadedRules, lines: string[];
  beforeEach(() => { ledger = openLedger(":memory:"); loaded = buybackRules(); lines = []; });
  const ctxOf = (): KeeperCtx => ({ ledger, loaded, log: (s) => lines.push(s), now: () => NOW, dryRun: false });
  const gateOf = (a: ReturnType<typeof fakeAttester>) => attesterGate({ attester: a, ledger, token: T, feed: F, toleranceBps: 0, maxAgeMs: 86_400_000, log: (s) => lines.push(s), now: () => NOW });

  test("the live value confirms the date and is recorded; a later check needs no live agreement", async () => {
    ingest(ctxOf(), V(R("2026-10-07", BASE), R("2026-10-08", D1)));
    const a = fakeAttester([att(D1), att(D2)]);
    const g = gateOf(a);
    const b = ledger.burn(T, F, "2026-10-08")!;
    const r1 = await g.check(b); assert.equal(r1.ok, true); assert.match((r1 as { note: string }).note, /agrees/);
    assert.ok(ledger.getStatus(attestedKey(T, F, "2026-10-08")), "recorded in the ledger's status table");
    const r2 = await g.check(b); assert.equal(r2.ok, true); assert.match((r2 as { note: string }).note, /attested 2026-10-08 earlier/);
  });
  test("the attester shows a newer day's figure: that day is recorded, the older unattested day is held, both figures named", async () => {
    ingest(ctxOf(), V(R("2026-10-07", BASE), R("2026-10-08", D1), R("2026-10-09", D2)));
    const g = gateOf(fakeAttester([att(D2)]));
    const r = await g.check(ledger.burn(T, F, "2026-10-08")!);
    assert.equal(r.ok, false); assert.match((r as { why: string }).why, /current value 40306500000000.00 is 2026-10-09's figure; 2026-10-08 \(keeper 40305316210829.72\) was never attested/);
    assert.ok(ledger.getStatus(attestedKey(T, F, "2026-10-09")));
    const r9 = await g.check(ledger.burn(T, F, "2026-10-09")!); assert.equal(r9.ok, true);
  });
  test("a figure matching no reading of ours is a disagreement; an unreachable attester is a hold", async () => {
    ingest(ctxOf(), V(R("2026-10-07", BASE), R("2026-10-08", D1)));
    const r = await gateOf(fakeAttester([att("40305316210829.00")])).check(ledger.burn(T, F, "2026-10-08")!);
    assert.equal(r.ok, false); assert.match((r as { why: string }).why, /DISAGREES/);
    assert.equal(ledger.getStatus(attestedKey(T, F, "2026-10-08")), null);
    const broken = { id: "switchboard:FEED", readAttested: async () => { throw new Error("429 rate limited"); } };
    const r2 = await attesterGate({ attester: broken, ledger, token: T, feed: F, toleranceBps: 0, maxAgeMs: 86_400_000, log: () => {}, now: () => NOW }).check(ledger.burn(T, F, "2026-10-08")!);
    assert.equal(r2.ok, false); assert.match((r2 as { why: string }).why, /unreachable — 429 rate limited \(keeper 40305316210829.72 for 2026-10-08\)/);
  });
});

describe("the cycle under quorum 2", () => {
  let ledger: Ledger, chain: FakeChain, router: FakeRouter, lines: string[];
  beforeEach(() => { ledger = openLedger(":memory:"); chain = new FakeChain(); router = new FakeRouter(chain); lines = []; });
  const ctxWith = (loaded: LoadedRules, a: ReturnType<typeof fakeAttester> | null): KeeperCtx => ({ ledger, loaded, log: (s) => lines.push(s), now: () => NOW, dryRun: false,
    attester: a ? attesterGate({ attester: a, ledger, token: T, feed: F, toleranceBps: 0, maxAgeMs: 86_400_000, log: (s) => lines.push(s), now: () => NOW }) : null });

  test("buyback: disagreement holds the date before any swap is signed; agreement lets it through", async () => {
    const wrong = fakeAttester([att("40305316210829.00")]);
    const ctx = ctxWith(buybackRules(), wrong);
    ingest(ctx, V(R("2026-10-07", BASE), R("2026-10-08", D1)));
    const held = await executePending(ctx, chain, router);
    assert.equal(held[0].outcome, "error"); assert.match((held[0] as { why: string }).why, /second attester: .*DISAGREES — attested 40305316210829.00, keeper 40305316210829.72/);
    assert.equal(chain.signed.length, 0, "nothing was signed");
    const b = ledger.burn(T, F, "2026-10-08")!;
    assert.equal(b.status, "planned"); assert.match(b.lastError ?? "", /second attester/); assert.ok(b.nextAttemptAt! > NOW, "backed off, not skipped");
    assert.ok(lines.some((l) => /\[attest\] 2026-10-08: HELD — /.test(l)));
    // The attester comes round (or the keeper was wrong and the owner fixed it): the next cycle burns.
    const ok = ctxWith(buybackRules(), fakeAttester([att(D1)]));
    const res = await executePending({ ...ok, now: () => NOW + 3_600_000 }, chain, router);
    assert.equal(res[0].outcome, "confirmed");
    assert.equal(chain.signed.filter((s) => s.kind === "swap").length, 1);
    assert.equal(chain.signed.filter((s) => s.kind === "burn").length, 1);
  });
  test("vault mode: the burn is held the same way; a landed transaction is still adopted without asking the attester", async () => {
    const ctx = ctxWith(vaultRules(), fakeAttester([att("1.00")]));
    ingest(ctx, V(R("2026-10-07", BASE), R("2026-10-08", D1)));
    const held = await executePending(ctx, chain);
    assert.equal(held[0].outcome, "error"); assert.match((held[0] as { why: string }).why, /second attester/);
    assert.equal(chain.signed.length, 0);
    // A burn that landed before the record was written (a crash between send and record) is adopted; the attester — which would
    // now disagree — is not asked: a landed transaction is a fact.
    const ok = ctxWith(vaultRules(), fakeAttester([att(D1)]));
    const r1 = await executePending({ ...ok, now: () => NOW + 60_000 }, chain);
    assert.equal(r1[0].outcome, "confirmed");
    ledger.setBurnStatus(T, F, "2026-10-08", "sending");   // pretend the record was lost after the send
    const disagreeing = fakeAttester([att("1.00")]);
    const r2 = await executePending(ctxWith(vaultRules(), disagreeing), chain);
    assert.equal(r2.length, 1); assert.equal(r2[0].outcome, "confirmed"); assert.equal((r2[0] as { adopted: boolean }).adopted, true);
    assert.equal(disagreeing.calls, 0, "the attester is not consulted for a transaction that already landed");
    assert.equal(ledger.burn(T, F, "2026-10-08")!.status, "confirmed");
  });
  test("no attester configured: the cycle is unchanged (quorum 1)", async () => {
    const ctx = ctxWith(buybackRules(), null);
    ingest(ctx, V(R("2026-10-07", BASE), R("2026-10-08", D1)));
    const res = await executePending(ctx, chain, router);
    assert.equal(res[0].outcome, "confirmed");
    assert.ok(!lines.some((l) => l.includes("[attest]")));
  });
  test("dry run: a hold is reported as waiting and writes no error to the ledger", async () => {
    const ctx = { ...ctxWith(buybackRules(), fakeAttester([att("1.00")])), dryRun: true };
    ingest(ctx, V(R("2026-10-07", BASE), R("2026-10-08", D1)));
    const res = await executePending(ctx, chain, router);
    assert.equal(res[0].outcome, "waiting"); assert.match((res[0] as { why: string }).why, /second attester/);
    assert.equal(ledger.burn(T, F, "2026-10-08")!.lastError, null); assert.equal(ledger.burn(T, F, "2026-10-08")!.nextAttemptAt, null);
  });
});
