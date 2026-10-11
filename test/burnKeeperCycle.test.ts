// BURN KEEPER (2026-10-09) — the ledger and one keeper cycle against a FAKE chain: one tx per record_date, the write-ahead signature
// surviving a crash between send and record (wait while it may land, adopt it when it does, re-sign the SAME memo only once it
// expired), the chain's own memo settling a date, the vesting shortfall (memo-only day, then caught up), the exhausted allocation,
// dry runs that sign nothing, and simulation refusals that back off.
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { openLedger, type Ledger } from "@/lib/burnKeeper/ledger";
import { executePending, ingest, type KeeperCtx } from "@/lib/burnKeeper/cycle";
import { buybackSpend, rulesFromText, solToLamports, usdToCents, type LoadedRules } from "@/lib/burnKeeper/rules";
import { parseBuybackMemo, parseDebtMemo } from "@/lib/burnKeeper/memo";
import { planReading } from "@/lib/burnKeeper/plan";
import type { DebtReading, FeedValidation } from "@/lib/burnKeeper/feeds/treasury";
import { buybackRules, FakeChain, FakeRouter, raw, RULES_TEXT, vaultRules, vaultRulesText } from "./burnKeeperHelpers.ts";

const R = (d: string, a: string): DebtReading => ({ recordDate: d, amount: a, cents: usdToCents(a) });
const V = (...readings: DebtReading[]): FeedValidation => ({ readings, refusals: [] });

// The vault-mode tests run the rule file switched to mode "vault" (the alternative); the buyback tests below run it as committed.
let ledger: Ledger, loaded: LoadedRules, chain: FakeChain, ctx: KeeperCtx, lines: string[], clock: number;
beforeEach(() => {
  ledger = openLedger(":memory:");
  loaded = vaultRules();
  chain = new FakeChain();
  lines = [];
  clock = Date.parse("2026-10-09T21:00:00Z");
  ctx = { ledger, loaded, log: (s) => lines.push(s), now: () => clock, dryRun: false };
});
const T = "DEBT", F = "treasury.debt_to_penny";

describe("ledger", () => {
  test("applyStep is idempotent; the same date with another value throws; the burn row is the idempotency key", () => {
    const base = R("2026-10-07", "40284036147367.19"), day = R("2026-10-08", "40305316210829.72");
    assert.equal(ledger.applyStep(T, F, planReading(loaded.rules, null, null, base)), true);
    const s = planReading(loaded.rules, ledger.lastReading(T, F), null, day);
    assert.equal(ledger.applyStep(T, F, s), true);
    assert.equal(ledger.applyStep(T, F, s), false, "second time: nothing new");
    assert.equal(ledger.burns(T, F).length, 1);
    assert.throws(() => ledger.applyStep(T, F, { ...s, reading: R("2026-10-08", "40305316210829.99") } as typeof s), /already holds/);
    assert.equal(ledger.lastBurnedDate(T, F), "2026-10-08");
    assert.equal(ledger.lastReading(T, F)!.carryOutCents, usdToCents("280063462.53"));
  });
  test("identity binding: a ledger made on one cluster/mint refuses another", () => {
    const id = { cluster: "devnet-genesis", mint: "M1", vault: "V1", keeper: "K1", rulesSha256: "abc" };
    ledger.bindIdentity(id);
    ledger.bindIdentity(id);
    assert.throws(() => ledger.bindIdentity({ ...id, cluster: "mainnet-genesis" }), /belongs to another cluster/);
    assert.throws(() => ledger.bindIdentity({ ...id, mint: "M2" }), /mint/);
  });
  test("a file ledger persists across opens (data/burnkeeper.db shape)", () => {
    const dir = fs.mkdtempSync(path.join(process.env.TMPDIR ?? "/tmp", "bk-"));
    const file = path.join(dir, "burnkeeper.db");
    const a = openLedger(file); a.applyStep(T, F, planReading(loaded.rules, null, null, R("2026-10-07", "40284036147367.19"))); a.setStatus("lastPoll", { ok: 1 }); a.close();
    const b = openLedger(file);
    assert.equal(b.lastReading(T, F)!.recordDate, "2026-10-07");
    assert.equal(b.getStatus("lastPoll"), '{"ok":1}');
    b.close();
  });
});

describe("vault mode (the alternative): one cycle, ingest → execute", () => {
  test("baseline, then one burn per record_date with the canonical memo; a re-poll sends nothing", async () => {
    ingest(ctx, V(R("2026-10-06", "40273024579219.17")));
    ingest(ctx, V(R("2026-10-07", "40284036147367.19"), R("2026-10-08", "40305316210829.72")));
    const out = await executePending(ctx, chain);
    assert.deepEqual(out.map((o) => o.outcome), ["confirmed", "confirmed"]);
    assert.equal(chain.signed.length, 2);
    const m = parseDebtMemo(chain.signed[1].memo)!;
    assert.equal(m.recordDate, "2026-10-08");
    assert.equal(m.units, 21);   // +$21.28B with $0.01B carried from 10-07 (+$11.01B) = 21
    assert.equal(m.rulesSha12, loaded.sha12);
    assert.equal(chain.vault, raw("250000000") - raw("1100000") - raw("2100000"));
    ingest(ctx, V(R("2026-10-08", "40305316210829.72")));
    assert.deepEqual(await executePending(ctx, chain), []);
    assert.equal(chain.signed.length, 2, "nothing re-sent");
  });

  test("CRASH AFTER SEND: the signature was written first; the next cycle waits while it may land, then adopts it — one tx", async () => {
    ingest(ctx, V(R("2026-10-07", "40284036147367.19"), R("2026-10-08", "40305316210829.72")));
    chain.dropSends = true;   // the RPC accepted and dropped it (or the process died before confirm)
    const first = await executePending(ctx, chain);
    assert.equal(first[0].outcome, "waiting");
    assert.equal(ledger.signatures(T, F, "2026-10-08").length, 1);
    assert.equal(ledger.burn(T, F, "2026-10-08")!.status, "sending");
    const again = await executePending(ctx, chain);
    assert.equal(again[0].outcome, "waiting", "still within its blockhash life: no second signature");
    assert.equal(chain.signed.length, 1);
    // It lands after all.
    const s = chain.signed[0]; chain.vault -= s.burnRaw; chain.landed.set(s.sig, { memo: s.memo, burnRaw: s.burnRaw, slot: 77, kind: "burn" });
    const third = await executePending(ctx, chain);
    assert.equal(third[0].outcome, "confirmed");
    assert.equal(chain.signed.length, 1, "exactly one transaction for the date");
    assert.equal(ledger.burn(T, F, "2026-10-08")!.signature, s.sig);
  });

  test("an expired, never-landed signature is re-signed with the SAME memo", async () => {
    ingest(ctx, V(R("2026-10-07", "40284036147367.19"), R("2026-10-08", "40305316210829.72")));
    chain.dropSends = true;
    await executePending(ctx, chain);
    chain.height += 1_000;   // its blockhash is long dead
    chain.dropSends = false;
    const out = await executePending(ctx, chain);
    assert.equal(out[0].outcome, "confirmed");
    assert.equal(chain.signed.length, 2);
    assert.equal(chain.signed[0].memo, chain.signed[1].memo);
    assert.deepEqual(ledger.signatures(T, F, "2026-10-08").map((s) => s.status), ["expired", "confirmed"]);
  });

  test("the chain is the final word: the keeper's memo for the date already on chain settles it without a send", async () => {
    ingest(ctx, V(R("2026-10-07", "40284036147367.19"), R("2026-10-08", "40305316210829.72")));
    const memo = `DEBT|2026-10-08|src=fiscaldata.treasury.gov debt_to_penny|prev=40284036147367.19|now=40305316210829.72|delta=21280063462.53|units=21|burn=2100000|rules=sha256:${loaded.sha12}|v1`;
    chain.landed.set("lostSig", { memo, burnRaw: raw("2100000"), slot: 5, kind: "burn" });
    const out = await executePending(ctx, chain);
    assert.equal(out[0].outcome, "confirmed");
    assert.equal(chain.signed.length, 0);
    assert.equal(ledger.burn(T, F, "2026-10-08")!.signature, "lostSig");
  });

  test("VESTING SHORTFALL: an empty vault posts a memo-only day (burn=0|short=…); when the vault refills the next burn day catches up", async () => {
    chain.vault = BigInt(0);
    ingest(ctx, V(R("2026-10-07", "40284036147367.19"), R("2026-10-08", "40305316210829.72")));
    const d1 = await executePending(ctx, chain);
    assert.equal(d1[0].outcome, "confirmed");
    assert.equal(chain.signed[0].burnRaw, BigInt(0));
    assert.match(chain.signed[0].memo, /\|burn=0\|short=2100000\|/);
    assert.equal(ledger.burn(T, F, "2026-10-08")!.shortOutRaw, raw("2100000"));
    chain.vault = raw("3000000");   // vested and claimed
    ingest(ctx, V(R("2026-10-09", "40310316210829.72")));   // +$5B (+ $0.28B carried) → 5 units
    const d2 = await executePending(ctx, chain);
    assert.equal(d2[0].outcome, "confirmed");
    const m = parseDebtMemo(chain.signed[1].memo)!;
    assert.equal(m.units, 5);
    assert.equal(m.burn, "2600000", "500,000 for today + the 2,100,000 shortfall carried");
    assert.equal(m.short, undefined);
  });

  test("a partially covered day burns what is there and carries the rest in the memo", async () => {
    chain.vault = raw("1500000");
    ingest(ctx, V(R("2026-10-07", "40284036147367.19"), R("2026-10-08", "40305316210829.72")));
    await executePending(ctx, chain);
    assert.match(chain.signed[0].memo, /\|burn=1500000\|short=600000\|/);
  });

  test("EXHAUSTED: once the allocation is fully burned nothing is owed and nothing is sent", async () => {
    const tiny = rulesFromText(vaultRulesText().replace('"vaultAllocation": "250000000"', '"vaultAllocation": "2000000"'));
    ctx = { ...ctx, loaded: tiny };
    ingest(ctx, V(R("2026-10-06", "40273024579219.17"), R("2026-10-07", "40284036147367.19"), R("2026-10-08", "40305316210829.72"), R("2026-10-09", "40310316210829.72")));
    const out = await executePending(ctx, chain);
    assert.deepEqual(out.map((o) => o.outcome), ["confirmed", "confirmed", "exhausted"]);
    assert.equal(ledger.totalBurnedRaw(T, F), raw("2000000"));
    assert.match(chain.signed[1].memo, /\|burn=900000\|/, "the second day is capped at what the allocation had left (owed capped, so no shortfall)");
  });

  test("DRY RUN signs nothing and fixes no memo", async () => {
    ctx = { ...ctx, dryRun: true };
    ingest(ctx, V(R("2026-10-07", "40284036147367.19"), R("2026-10-08", "40305316210829.72")));
    const out = await executePending(ctx, chain);
    assert.equal(out[0].outcome, "dry-run");
    assert.equal(chain.signed.length, 0);
    assert.equal(ledger.burn(T, F, "2026-10-08")!.memo, null);
  });

  test("a simulation refusal sends nothing and backs off; the date stays planned (late, never lost)", async () => {
    chain.simErr = '{"InstructionError":[1,"Custom(1)"]}';
    ingest(ctx, V(R("2026-10-07", "40284036147367.19"), R("2026-10-08", "40305316210829.72")));
    const out = await executePending(ctx, chain);
    assert.equal(out[0].outcome, "error");
    const b = ledger.burn(T, F, "2026-10-08")!;
    assert.equal(b.status, "planned");
    assert.ok(b.nextAttemptAt! > clock);
    assert.equal((await executePending(ctx, chain))[0].outcome, "waiting", "inside the backoff");
    chain.simErr = null; clock = b.nextAttemptAt! + 1;
    assert.equal((await executePending(ctx, chain))[0].outcome, "confirmed");
  });

  test("an RPC that throws is an error with backoff, not a crash", async () => {
    ingest(ctx, V(R("2026-10-07", "40284036147367.19"), R("2026-10-08", "40305316210829.72")));
    chain.findMemoOnChain = async () => { throw new Error("fetch failed"); };
    const out = await executePending(ctx, chain);
    assert.equal(out[0].outcome, "error");
    assert.match(lines.join("\n"), /RPC\/chain error: fetch failed/);
  });

  test("a feed refusal is logged and holds: nothing after it is planned", () => {
    ingest(ctx, V(R("2026-10-07", "40284036147367.19")));
    const r = ingest(ctx, V(R("2026-10-08", "44305316210829.72"), R("2026-10-09", "44306316210829.72")));
    assert.equal(r.written, 0);
    assert.match(r.refusals[0], /beyond the rule/);
    assert.equal(ledger.lastReading(T, F)!.recordDate, "2026-10-07");
  });
});

describe("BUYBACK mode (the primary mechanic): swap at market, then burn everything received, v2 memo", () => {
  let router: FakeRouter;
  beforeEach(() => {
    loaded = buybackRules();
    chain.vault = BigInt(0);   // the keeper holds no tokens between days
    router = new FakeRouter(chain);
    ctx = { ...ctx, loaded };
  });

  test("the committed rule file is buyback mode with a v2 memo", () => {
    assert.equal(loaded.rules.mode, "buyback");
    assert.equal(loaded.rules.memo.version, "v2");
    assert.equal(loaded.rules.buyback.fractionPerUnit, "0.02", "2% per unit — the owner's 2026-10-10 decision (the Fed's inflation target, pointed the other way)");
  });

  test("one burn day = one swap + one burn; spend = pool × (1 − (1 − f)^units); every token received is burned; the memo links the swap", async () => {
    ingest(ctx, V(R("2026-10-07", "40284036147367.19"), R("2026-10-08", "40305316210829.72")));   // 21 units
    const out = await executePending(ctx, chain, router);
    assert.equal(out[0].outcome, "confirmed");
    const pool = BigInt(5_000_000_000) - solToLamports("0.02");
    const spend = buybackSpend(pool, 21, loaded.rules.buyback.fractionPerUnit);
    assert.deepEqual(chain.signed.map((x) => x.kind), ["swap", "burn"]);
    assert.equal(chain.signed[0].lamports, spend);
    const got = (spend * raw("1000000")) / BigInt(1_000_000_000);
    assert.equal(chain.signed[1].burnRaw, got, "100% of what the swap delivered");
    assert.equal(chain.vault, BigInt(0), "nothing held overnight");
    const m = parseBuybackMemo(chain.signed[1].memo)!;
    assert.ok(m, "a well-formed v2 memo");
    assert.equal(m.units, 21);
    assert.equal(m.pool, pool.toString());
    assert.equal(m.spent, spend.toString());
    assert.equal(m.swap, chain.signed[0].sig.slice(0, 12));
    assert.equal(m.rulesSha12, loaded.sha12);
    const b = ledger.burn("DEBT", "treasury.debt_to_penny", "2026-10-08")!;
    assert.equal(b.status, "confirmed");
    assert.equal(b.swapSig, chain.signed[0].sig);
    assert.equal(b.gotRaw, got);
  });

  test("CRASH BETWEEN SWAP AND BURN: the swap's signature was written first; the next cycle adopts it and burns — no second swap", async () => {
    ingest(ctx, V(R("2026-10-07", "40284036147367.19"), R("2026-10-08", "40305316210829.72")));
    chain.dropSends = true;
    const first = await executePending(ctx, chain, router);
    assert.equal(first[0].outcome, "waiting");
    assert.equal(ledger.burn("DEBT", "treasury.debt_to_penny", "2026-10-08")!.status, "swap-sent");
    chain.dropSends = false;
    // The dropped swap landed after all (late), delivering the tokens.
    const sw = chain.signed[0]; chain.onSwapLand!(sw.lamports!, sw.sig); chain.landed.set(sw.sig, { memo: "swap", burnRaw: BigInt(0), slot: 9, kind: "swap" });
    const again = await executePending(ctx, chain, router);
    assert.equal(again[0].outcome, "confirmed");
    assert.equal(chain.signed.filter((x) => x.kind === "swap").length, 1, "exactly one swap for the date");
    assert.equal(chain.vault, BigInt(0));
  });

  test("an expired, never-landed swap is re-signed with the SAME spend (fixed at the first attempt, not re-read from a changed pool)", async () => {
    ingest(ctx, V(R("2026-10-07", "40284036147367.19"), R("2026-10-08", "40305316210829.72")));
    chain.dropSends = true;
    await executePending(ctx, chain, router);
    router.fee += BigInt(3_000_000_000);   // more fees arrive meanwhile
    chain.height += 1_000; chain.dropSends = false;
    const out = await executePending(ctx, chain, router);
    assert.equal(out[0].outcome, "confirmed");
    const swaps = chain.signed.filter((x) => x.kind === "swap");
    assert.equal(swaps.length, 2);
    assert.equal(swaps[0].lamports, swaps[1].lamports);
  });

  test("dust a crash left in the account is burned with the next day's tokens (never held)", async () => {
    chain.vault = raw("7");
    ingest(ctx, V(R("2026-10-07", "40284036147367.19"), R("2026-10-08", "40305316210829.72")));
    await executePending(ctx, chain, router);
    const m = parseBuybackMemo(chain.signed[1].memo)!;
    assert.equal(BigInt(Math.round(Number(m.burn) * 1e6)) - BigInt(Math.round(Number(m.got) * 1e6)), raw("7"));
    assert.equal(chain.vault, BigInt(0));
  });

  test("under the $1 floor (or an empty pool) nothing is bought: the day is SKIPPED and recorded, no transaction", async () => {
    router.fee = solToLamports("0.02") + BigInt(100_000);   // 0.0001 SOL spendable → 5% ≈ $0.00075
    ingest(ctx, V(R("2026-10-07", "40284036147367.19"), R("2026-10-07".replace("07", "08"), "40285036147367.19")));   // +$1B → 1 unit
    const out = await executePending(ctx, chain, router);
    assert.equal(out[0].outcome, "skipped");
    assert.equal(chain.signed.length, 0);
    const b = ledger.burn("DEBT", "treasury.debt_to_penny", "2026-10-08")!;
    assert.equal(b.status, "skipped");
    assert.match(b.skippedReason!, /under the \$1 floor/);
    router.fee = solToLamports("0.02");
    ingest(ctx, V(R("2026-10-09", "40290036147367.19")));
    assert.equal((await executePending(ctx, chain, router))[0].outcome, "skipped", "an empty pool skips too");
  });

  test("a swap simulation refusal sends nothing and backs off", async () => {
    ingest(ctx, V(R("2026-10-07", "40284036147367.19"), R("2026-10-08", "40305316210829.72")));
    chain.simErr = "slippage";
    const out = await executePending(ctx, chain, router);
    assert.equal(out[0].outcome, "error");
    assert.equal(chain.signed.filter((x) => x.kind === "swap").length, 1, "built and simulated, never sent");
    assert.equal(chain.landed.size, 0);
  });

  test("dry run plans the spend and signs nothing", async () => {
    ctx = { ...ctx, dryRun: true };
    ingest(ctx, V(R("2026-10-07", "40284036147367.19"), R("2026-10-08", "40305316210829.72")));
    const out = await executePending(ctx, chain, router);
    assert.equal(out[0].outcome, "dry-run");
    assert.equal(chain.signed.length, 0);
    assert.match(lines.join("\n"), /would spend \d+ of \d+ lamports/);
  });

  test("the chain is the final word for the burn leg: a v2 memo for the date already on chain settles it", async () => {
    ingest(ctx, V(R("2026-10-07", "40284036147367.19"), R("2026-10-08", "40305316210829.72")));
    const memo = `DEBT|2026-10-08|src=fiscaldata.treasury.gov debt_to_penny|prev=40284036147367.19|now=40305316210829.72|delta=21280063462.53|units=21|pool=100|spent=50|got=5|burn=5|swap=swap1ZZZZZZZ|rules=sha256:${loaded.sha12}|v2`;
    chain.landed.set("lostBurn", { memo, burnRaw: raw("5"), slot: 3, kind: "burn" });
    const out = await executePending(ctx, chain, router);
    assert.equal(out[0].outcome, "confirmed");
    assert.equal(chain.signed.length, 0, "no swap, no burn sent");
  });

  test("executePending refuses buyback mode without a router", async () => {
    ingest(ctx, V(R("2026-10-07", "40284036147367.19"), R("2026-10-08", "40305316210829.72")));
    await assert.rejects(executePending(ctx, chain), /BuybackPort/);
  });
  void RULES_TEXT; void fs; void path; void parseDebtMemo;
});
