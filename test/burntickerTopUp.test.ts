// AUTOMATIC SOL TOP-UPS (2026-10-19, src/lib/burnticker/ops/topUp.ts): the planner for each floor, the keeper key's reserve and its
// short refusal, the two-step Irys path with a failed second step, no caps (a wallet below its floor is refilled every cycle), the
// unconfirmed wait, the 50-launch notice across Denver midnight, the kill switch, and the skips. No network.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  FAILURE_BACKOFF_CAP_MS, FAILURE_BACKOFF_FIRST_MS, failureBackoffFor,
  DEFAULT_TOP_UP_CONFIG, REFERENCE_IRYS_PRICES, IRYS_FUND_FEE_LAMPORTS, TX_FEE_LAMPORTS, UNCONFIRMED_WAIT_MS, denverDay, irysLevels, loadTopUpConfig, noticeMarkLamports,
  parseTopUpConfig, perLaunchLamports, planTopUps, recordTopUp, runTopUps, topUpModeFromEnv, topUpOpsLines, topUpRowsSince, topUpRunnerFromEnv,
  type IrysPayerAccount, type TopUpInput, type TopUpRow, type TransferOutcome,
} from "@/lib/burnticker/ops/topUp";
import { resetIrysReads } from "@/lib/burnticker/ops/irysReadMemo";
import { checkUploadBalance } from "@/lib/burnticker/ops/snapshot";
import type { PinUploader } from "@/lib/burnticker/pin";

const SOL = BigInt(1_000_000_000);
const sol = (n: number) => BigInt(Math.round(n * 1e9));
const SIGNER = "FQYod3oyUJNedCw3xbp6AHifyZmG4uNrD1XvLqtpGd5L", PAYER = "EMht6aGcQWsBjKx4Ya41giF3G9MdZn1PVvctEjb6Tt23", DEFICIT = "J5XB9gNiftyMpLPy767KB4LF9R2y2ZefvtNck6xhFTf6";
// 2026-10-19 12:00 Denver (MDT, UTC-6)
const NOON = Date.parse("2026-10-19T18:00:00Z");
const cfg = DEFAULT_TOP_UP_CONFIG;
const irysLv = irysLevels({ ...REFERENCE_IRYS_PRICES }, 0, cfg.irys);

function input(o: Partial<TopUpInput> = {}): TopUpInput {
  return {
    now: NOON, config: cfg, signer: { address: SIGNER, lamports: sol(1) },
    payer: { address: PAYER, walletLamports: sol(0.03), irysLamports: sol(0.02) },
    irysPrices: { ...REFERENCE_IRYS_PRICES }, launchesLast7d: 0, liveCoins: 2,
    deficitKeeper: { address: DEFICIT, lamports: sol(0.05) }, ledger: [], ...o,
  };
}
const row = (o: Partial<TopUpRow>): TopUpRow => ({ id: 1, at: NOON, day: denverDay(o.at ?? NOON), target: "upload-payer-wallet", kind: "transfer", from: SIGNER, to: PAYER, lamports: sol(0.02), status: "sent", signature: "sig", reason: "r", error: null, ...o });

describe("the floors", () => {
  test("every wallet at or above its floor: nothing to do", () => {
    const p = planTopUps(input());
    assert.deepEqual(p.steps, []); assert.deepEqual(p.refused, []); assert.equal(p.signerShort, null);
    assert.deepEqual(p.levels.map((l) => l.target), ["upload-payer-wallet", "irys-balance", "deficit-keeper"]);
  });
  test("the upload wallet below 0.01 SOL is filled to 0.03 SOL (fill minus balance, never more)", () => {
    const p = planTopUps(input({ payer: { address: PAYER, walletLamports: sol(0.004), irysLamports: sol(0.02) } }));
    assert.equal(p.steps.length, 1);
    assert.deepEqual({ t: p.steps[0].target, k: p.steps[0].kind, to: p.steps[0].to, l: p.steps[0].lamports }, { t: "upload-payer-wallet", k: "transfer", to: PAYER, l: sol(0.026) });
    assert.equal(planTopUps(input({ payer: { address: PAYER, walletLamports: sol(0.01), irysLamports: sol(0.02) } })).steps.length, 0, "exactly the floor is fine");
  });
  test("the Irys floor: 7 days of snapshots plus the last 7 days' launch pins, kept between 0.005 and 0.05 SOL; fill 30 days", () => {
    // at the reference rates a quiet week is far under the minimum: floor 0.005, fill twice that
    assert.deepEqual(irysLv, { floor: sol(0.005), fill: sol(0.01) });
    // a heavy week (10,000 launches) reaches the maximum
    assert.deepEqual(irysLevels({ ...REFERENCE_IRYS_PRICES }, 10_000, cfg.irys), { floor: sol(0.05), fill: sol(0.05) });
    // between the bounds: price 100,000 lamports a snapshot, 70 launches a week at 400,000 lamports of pins each
    const mid = irysLevels({ metadata: BigInt(100_000), image: BigInt(300_000), snapshot: BigInt(100_000) }, 70, cfg.irys);
    assert.equal(mid.floor, BigInt(7) * (BigInt(100_000) + BigInt(4_000_000))); assert.equal(mid.fill, sol(0.05), "30 days would be 0.123 SOL: held at the maximum");
  });
  test("the $DEFICIT keeper key below 0.03 SOL is filled to 0.06 SOL; the keeper key itself is never a target", () => {
    const p = planTopUps(input({ deficitKeeper: { address: DEFICIT, lamports: sol(0.01) } }));
    assert.deepEqual(p.steps.map((s) => [s.target, s.to, s.lamports]), [["deficit-keeper", DEFICIT, sol(0.05)]]);
    assert.equal(planTopUps(input({ deficitKeeper: { address: SIGNER, lamports: BigInt(0) } })).levels.some((l) => l.address === SIGNER && l.target === "deficit-keeper"), false);
  });
  test("no upload payer: the two payer targets are left out", () => {
    const p = planTopUps(input({ payer: null, deficitKeeper: null }));
    assert.deepEqual(p.levels, []); assert.deepEqual(p.steps, []);
  });
});

describe("the two-step Irys path", () => {
  test("Irys below its floor and the upload wallet with nothing spare: keeper key to wallet, then the wallet funds Irys", () => {
    const p = planTopUps(input({ payer: { address: PAYER, walletLamports: sol(0.01), irysLamports: sol(0.001) } }));
    const fund = irysLv.fill - sol(0.001);
    // the transfer carries the funding transaction's fee too, so the wallet stays at its floor afterwards
    assert.deepEqual(p.steps.map((s) => [s.target, s.kind, s.lamports, s.after]), [["irys-balance", "transfer", fund + IRYS_FUND_FEE_LAMPORTS, null], ["irys-balance", "irys-fund", fund, 0]]);
    assert.equal(p.steps[0].to, PAYER); assert.equal(p.steps[1].from, PAYER);
  });
  test("a first step that landed and a second that failed: the SOL sits in the wallet, so the next plan funds Irys only (no second transfer)", () => {
    const fund = irysLv.fill - sol(0.001);
    const p = planTopUps(input({ payer: { address: PAYER, walletLamports: sol(0.01) + fund + IRYS_FUND_FEE_LAMPORTS, irysLamports: sol(0.001) } }));
    assert.deepEqual(p.steps.map((s) => [s.kind, s.lamports, s.after]), [["irys-fund", fund, null]]);
  });
  test("both the wallet and Irys low: the wallet goes to its fill and the Irys transfer is the whole funding amount", () => {
    const p = planTopUps(input({ payer: { address: PAYER, walletLamports: sol(0.002), irysLamports: BigInt(0) } }));
    assert.deepEqual(p.steps.map((s) => [s.target, s.kind, s.lamports]), [["upload-payer-wallet", "transfer", sol(0.028)], ["irys-balance", "transfer", irysLv.fill + IRYS_FUND_FEE_LAMPORTS], ["irys-balance", "irys-fund", irysLv.fill]]);
  });
  test("an unreadable Irys balance is refused with its reason, not guessed", () => {
    const p = planTopUps(input({ payer: { address: PAYER, walletLamports: sol(0.03), irysLamports: null } }));
    assert.deepEqual(p.steps, []); assert.match(p.refused[0].reason, /could not be read/);
  });
});

describe("the keeper key's reserve", () => {
  test("below its own 0.1 SOL floor it refills nothing and asks the owner for an amount", () => {
    const p = planTopUps(input({ signer: { address: SIGNER, lamports: sol(0.08) }, payer: { address: PAYER, walletLamports: sol(0.002), irysLamports: sol(0.02) } }));
    assert.deepEqual(p.steps, []);
    assert.match(p.refused[0].reason, /below its own 0\.1000 SOL floor/);
    assert.ok(p.signerShort); assert.match(p.signerShort.text, /Send about 0\.4\d SOL to FQYod/);
    assert.ok(p.signerShort.sendLamports >= sol(0.42) && p.signerShort.sendLamports % sol(0.01) === BigInt(0), "up to its refill level plus what the wallets need, in whole cents");
  });
  test("below its floor with nothing to refill: still the owner alert", () => {
    const p = planTopUps(input({ signer: { address: SIGNER, lamports: sol(0.05) } }));
    assert.deepEqual(p.steps, []); assert.ok(p.signerShort);
  });
  test("a transfer that would break the reserve (floor plus the day's expected fees) is refused; a smaller one still goes", () => {
    const reserve = cfg.signer.floorLamports + cfg.signer.baseFeesPerDayLamports + BigInt(2) * cfg.signer.feesPerCoinPerDayLamports;
    // room for the 0.026 SOL wallet top-up but not the 0.05 SOL $DEFICIT keeper top-up after it
    const signer = reserve + sol(0.026) + TX_FEE_LAMPORTS + sol(0.01);
    const p = planTopUps(input({ signer: { address: SIGNER, lamports: signer }, payer: { address: PAYER, walletLamports: sol(0.004), irysLamports: sol(0.02) }, deficitKeeper: { address: DEFICIT, lamports: sol(0.01) } }));
    assert.equal(p.signer.reserve, reserve);
    assert.deepEqual(p.steps.map((s) => s.target), ["upload-payer-wallet"]);
    assert.deepEqual(p.refused.map((r) => r.target), ["deficit-keeper"]); assert.match(p.refused[0].reason, /under its reserve/);
    assert.ok(p.signerShort); assert.match(p.signerShort.text, /too little to refill the other wallets/);
  });
  test("an Irys funding from the wallet's own spare SOL costs the keeper key nothing, so it goes even when the key is short", () => {
    const fund = irysLv.fill;
    const p = planTopUps(input({ signer: { address: SIGNER, lamports: sol(0.05) }, payer: { address: PAYER, walletLamports: sol(0.03) + fund, irysLamports: BigInt(0) } }));
    assert.deepEqual(p.steps.map((s) => s.kind), ["irys-fund"]);
  });
  test("signer days: (key − floor) ÷ (daily fees + the 7-day average of top-ups)", () => {
    const p = planTopUps(input({ liveCoins: 0, ledger: [row({ at: NOON - 86_400_000, lamports: sol(0.07) })] }));
    const daily = Number(cfg.signer.baseFeesPerDayLamports + sol(0.01));
    assert.ok(Math.abs((p.signerDays ?? 0) - Number(sol(0.9)) / daily) < 1e-9);
  });
});

describe("no caps, one correctness wait", () => {
  test("a wallet below its floor is refilled again in the same hour (every cycle if necessary)", () => {
    const ledger = [row({ at: NOON - 5 * 60_000 }), row({ at: NOON - 2 * 60_000, id: 2 })];
    const p = planTopUps(input({ ledger, payer: { address: PAYER, walletLamports: sol(0.001), irysLamports: sol(0.001) } }));
    assert.deepEqual(p.steps.map((s) => [s.target, s.kind]), [["upload-payer-wallet", "transfer"], ["irys-balance", "transfer"], ["irys-balance", "irys-fund"]]);
    // and no daily total stops it: 100 top-ups today of another wallet (one wallet's own run of top-ups meets the drain stop of
    // HB-108, which is per wallet and not a cap on the day)
    const many = Array.from({ length: 100 }, (_, k) => row({ id: k, target: "deficit-keeper", to: DEFICIT, at: NOON - 3_600_000 - k * 60_000, lamports: sol(0.03) }));

    assert.equal(planTopUps(input({ ledger: many, payer: { address: PAYER, walletLamports: sol(0.001), irysLamports: sol(0.02) }, signer: { address: SIGNER, lamports: sol(10) } })).steps.length, 1);
  });
  test("a transfer whose confirmation did not come back holds its target for UNCONFIRMED_WAIT_MS, then it is planned again", () => {
    const low = { payer: { address: PAYER, walletLamports: sol(0.001), irysLamports: sol(0.02) } } as const;
    const pending = row({ status: "unconfirmed", at: NOON - 60_000 });
    let p = planTopUps(input({ ...low, ledger: [pending] }));
    assert.deepEqual(p.steps, []); assert.match(p.refused[0].reason, /not confirmed yet/);
    p = planTopUps(input({ ...low, ledger: [{ ...pending, at: NOON - UNCONFIRMED_WAIT_MS - 1 }] }));
    assert.equal(p.steps.length, 1);
  });
});

describe("the 50-launch notice (a line, never a block)", () => {
  test("the mark: 50 × (metadata pin + image pin + one reading's rent and fees) + 30 snapshots", () => {
    assert.equal(perLaunchLamports({ ...REFERENCE_IRYS_PRICES }), BigInt(2_210) + BigInt(56_561) + BigInt(2_937_120) + BigInt(10_000));
    assert.equal(noticeMarkLamports({ ...REFERENCE_IRYS_PRICES }), BigInt(50) * BigInt(3_005_891) + BigInt(30) * BigInt(2_698));
    assert.equal(cfg.noticeLaunchesPerDay, 50);
  });
  test("the day is the Denver day: top-ups before Denver midnight do not count after it", () => {
    const beforeMidnight = Date.parse("2026-10-20T05:30:00Z");   // 23:30 Denver on the 19th
    const afterMidnight = Date.parse("2026-10-20T06:30:00Z");    // 00:30 Denver on the 20th
    const ledger = [row({ at: beforeMidnight, lamports: sol(0.2) })];
    const late = planTopUps(input({ now: beforeMidnight + 60_000, ledger }));
    assert.equal(late.today.day, "2026-10-19"); assert.equal(late.today.signerLamports, sol(0.2)); assert.equal(late.overNotice, true);
    const next = planTopUps(input({ now: afterMidnight, ledger }));
    assert.equal(next.today.day, "2026-10-20"); assert.equal(next.today.count, 0); assert.equal(next.overNotice, false);
  });
  test("above the mark the plan still sends", () => {
    const p = planTopUps(input({ ledger: [row({ lamports: sol(1) })], signer: { address: SIGNER, lamports: sol(5) }, payer: { address: PAYER, walletLamports: BigInt(0), irysLamports: sol(0.02) } }));
    assert.equal(p.overNotice, true); assert.equal(p.steps.length, 1);
  });
});

// ---- the executor, on an in-memory registry and a fake chain ----

function fakeWorld(o: { signer?: bigint; wallet?: bigint; irys?: bigint; fundFails?: number; transferFails?: boolean } = {}) {
  const bal = new Map<string, bigint>([[SIGNER, o.signer ?? sol(1)], [PAYER, o.wallet ?? sol(0.01)], [DEFICIT, sol(0.05)]]);
  let irysBal = o.irys ?? BigInt(0), fundFails = o.fundFails ?? 0;
  const calls = { transfer: 0, fund: 0, balance: 0, price: 0 };
  const irys: IrysPayerAccount = {
    address: PAYER,
    balance: async () => { calls.balance++; return irysBal; },
    price: async (b) => (calls.price++, b > 1_000_000 ? REFERENCE_IRYS_PRICES.image : b > 10_000 ? REFERENCE_IRYS_PRICES.snapshot : REFERENCE_IRYS_PRICES.metadata),
    fund: async (l) => { calls.fund++; if (fundFails > 0) { fundFails--; throw new Error("Irys node answered 503"); } bal.set(PAYER, bal.get(PAYER)! - l - BigInt(5_000)); irysBal += l; return { id: `fund${calls.fund}` }; },
  };
  const transfer = async (to: string, l: bigint): Promise<TransferOutcome> => {
    calls.transfer++;
    if (o.transferFails) return { status: "failed", signature: null, error: "the simulation failed, nothing was sent: InsufficientFunds" };
    bal.set(SIGNER, bal.get(SIGNER)! - l - BigInt(5_000)); bal.set(to, (bal.get(to) ?? BigInt(0)) + l); return { status: "sent", signature: `tx${calls.transfer}` };
  };
  const db = new DatabaseSync(":memory:");
  const status = new Map<string, string>();
  const registry = { db, setStatus: (k: string, v: unknown) => { status.set(k, typeof v === "string" ? v : JSON.stringify(v)); }, getStatus: (k: string) => status.get(k) ?? null, tokens: () => [] as never[] };
  const alerts: { kind: string; key: string; text: string }[] = [];
  const logs: string[] = [];
  const run = (mode: "on" | "off" = "on", now = NOON) => runTopUps({ registry, config: cfg, mode, now, log: (s) => logs.push(s), alert: (kind, key, text) => { alerts.push({ kind, key, text }); },
    deps: { signerAddress: SIGNER, readLamports: async (a) => bal.get(a) ?? BigInt(0), transfer, irys, deficitKeeper: DEFICIT } });
  return { bal, calls, run, registry, alerts, logs, irys, irysBalance: () => irysBal, setIrys: (l: bigint) => { irysBal = l; }, setFundFails: (n: number) => { fundFails = n; } };
}

describe("HB-125: a failing top-up backs off (10 min, doubling to 1 h, reset on success; at most 24 failed passes a day)", () => {
  const fail = (at: number, target: TopUpRow["target"] = "irys-balance", kind: TopUpRow["kind"] = "irys-fund"): TopUpRow => row({ at, target, kind, status: "failed", signature: null, error: "503" });
  test("the window doubles from 10 minutes to the 1-hour cap and any pass that did not fail resets it", () => {
    let ledger: TopUpRow[] = [];
    const windows: number[] = [];
    for (let k = 0, t = NOON; k < 6; k++) { ledger = [...ledger, fail(t)]; const b = failureBackoffFor("irys-balance", ledger, t)!; windows.push((b.until - t) / 60_000); t = b.until; }
    assert.deepEqual(windows, [10, 20, 40, 60, 60, 60]);
    assert.equal(failureBackoffFor("irys-balance", [fail(NOON)], NOON + FAILURE_BACKOFF_FIRST_MS), null, "the first cycle after the window retries");
    const reset = [fail(NOON - 3 * 3_600_000), fail(NOON - 2 * 3_600_000), row({ at: NOON - 3_600_000, target: "irys-balance", kind: "irys-fund" }), fail(NOON)];
    assert.equal(failureBackoffFor("irys-balance", reset, NOON)!.until - NOON, FAILURE_BACKOFF_FIRST_MS, "a success resets the doubling");
    assert.equal(failureBackoffFor("deficit-keeper", reset, NOON), null, "per target");
    // a failed step-one transfer holds its target too
    assert.ok(failureBackoffFor("deficit-keeper", [fail(NOON, "deficit-keeper", "transfer")], NOON + 60_000));
  });
  test("24 hours of cycles with fund() always throwing: at most 24 fund calls, at most 48 Irys requests, then funds on the first cycle after recovery", async () => {
    const w = fakeWorld({ wallet: sol(0.05), irys: BigInt(0), fundFails: Number.MAX_SAFE_INTEGER });
    for (let k = 0; k < 1_440; k++) await w.run("on", NOON + k * 60_000);
    const irysRequests = w.calls.balance + w.calls.price + w.calls.fund;
    assert.ok(w.calls.fund <= 24, `fund calls ${w.calls.fund}`);
    assert.ok(irysRequests <= 48, `Irys requests ${irysRequests}`);
    const failedAts = topUpRowsSince(w.registry.db, 0).filter((r) => r.status === "failed").map((r) => r.at);
    assert.equal(failedAts.length, w.calls.fund, "one failed row per attempt");
    // past the doubling's first hour: never two failed rows of the target inside an hour
    const steady = failedAts.filter((a) => a >= NOON + 70 * 60_000);
    for (let k = 1; k < steady.length; k++) assert.ok(steady[k] - steady[k - 1] >= FAILURE_BACKOFF_CAP_MS);
    assert.equal(w.calls.transfer, 0);
    // recovery: the node accepts again; the first cycle after the current window funds, within one window of the recovery
    w.setFundFails(0);
    const recoveredAt = NOON + 1_440 * 60_000;
    let fundedAt: number | null = null;
    for (let k = 0; k < 24 * 60 && fundedAt === null; k++) { const r = await w.run("on", recoveredAt + k * 60_000); if (r?.done.some((d) => d.kind === "irys-fund" && d.status === "sent")) fundedAt = recoveredAt + k * 60_000; }
    assert.ok(fundedAt !== null && fundedAt - recoveredAt <= FAILURE_BACKOFF_CAP_MS, `funded ${fundedAt === null ? "never" : `${(fundedAt - recoveredAt) / 60_000} min`} after recovery`);
  });
  test("HB-126: the sender lock is re-taken before every step; a lost lock stops the pass before anything is sent", async () => {
    const w = fakeWorld({ wallet: BigInt(0), irys: BigInt(0) });
    let refreshes = 0;
    const r = await runTopUps({ registry: w.registry, config: cfg, mode: "on", now: NOON, log: () => {}, alert: null, refreshLock: () => { refreshes++; return refreshes < 2; },
      deps: { signerAddress: SIGNER, readLamports: async (a) => w.bal.get(a) ?? BigInt(0), transfer: async () => ({ status: "sent", signature: "t" }), irys: w.irys, deficitKeeper: DEFICIT } });
    assert.equal(r!.done.length, 1, "the first step went; the second found the lock gone");
    assert.ok(r!.skipped.some((s) => /lock is no longer this keeper's/.test(s)));
  });
  test("a recovery inside the doubling is found on the first cycle after the window", async () => {
    const w = fakeWorld({ wallet: sol(0.05), irys: BigInt(0), fundFails: 3 });   // fails at +0, +10, +30 min; recovers before +70
    const funded: number[] = [];
    for (let k = 0; k < 120; k++) { const r = await w.run("on", NOON + k * 60_000); if (r?.done.some((d) => d.kind === "irys-fund" && d.status === "sent")) funded.push(k); }
    assert.deepEqual(funded, [70]);
    assert.equal(w.calls.fund, 4);
  });
});

describe("HB-114: the Irys reads are memoised (at most one balance read an hour; prices only when a refill is due)", () => {
  test("24 hours of 60 s cycles with nothing due: 24 balance reads, no price reads, at most 48 Irys requests", async () => {
    const w = fakeWorld({ wallet: sol(0.03), irys: sol(0.02) });
    for (let k = 0; k < 1_440; k++) await w.run("on", NOON + k * 60_000);
    assert.equal(w.calls.balance, 24, "one balance read per hour");
    assert.equal(w.calls.price, 0, "no refill due: no price read");
    assert.ok(w.calls.balance + w.calls.price <= 48);
    assert.equal(w.calls.transfer + w.calls.fund, 0);
  });
  test("a refill-due cycle reads the price once (snapshot size only with no launches this week); the funding invalidates the balance", async () => {
    const w = fakeWorld({ wallet: sol(0.03), irys: BigInt(0) });
    const r = await w.run("on", NOON);
    assert.deepEqual(r!.done.map((d) => [d.kind, d.status]), [["irys-fund", "sent"]]);
    assert.deepEqual([w.calls.balance, w.calls.price], [1, 1]);
    // after the funding: re-read until the node has had UNCONFIRMED_WAIT_MS to credit it, then one read holds for the hour
    for (let k = 1; k <= 60; k++) await w.run("on", NOON + k * 60_000);
    assert.equal(w.calls.fund, 1, "funded once");
    assert.equal(w.calls.price, 1, "the price is not read again once the balance is above its floor");
    assert.ok(w.calls.balance >= 2 && w.calls.balance <= 6, `balance reads in the hour after a funding: ${w.calls.balance}`);
  });
  test("a cached balance below the floor that a refill cannot fix yet (keeper key short) is not re-read every cycle", async () => {
    const w = fakeWorld({ signer: sol(0.05), wallet: sol(0.0001), irys: BigInt(0) });
    for (let k = 0; k < 60; k++) await w.run("on", NOON + k * 60_000);
    assert.deepEqual([w.calls.balance, w.calls.price, w.calls.fund], [1, 1, 0]);
  });
  test("the HB-82 balance alert's read seeds the top-up step in the same cycle (no double read), and vice versa", async () => {
    resetIrysReads();
    const w = fakeWorld({ wallet: sol(0.03), irys: sol(0.02) });
    const status = new Map<string, string>();
    const reg = { getStatus: (k: string) => status.get(k) ?? null, setStatus: (k: string, v: unknown) => { status.set(k, String(v)); } };
    let reads = 0;
    const uploader = { name: "fake", balance: async () => { reads++; return { address: PAYER, balanceLamports: sol(0.02), priceLamports: REFERENCE_IRYS_PRICES.snapshot }; } } as unknown as PinUploader;
    await checkUploadBalance({ registry: reg, uploader, now: NOON, log: () => {} });
    await w.run("on", NOON);
    assert.deepEqual([reads, w.calls.balance, w.calls.price], [1, 0, 0], "the alert read twice-in-one (balance + price); the top-up step read nothing");
    // the next hour the top-up step reads on its own; a refill-due read with a price would let the next day's alert skip its own read
    await w.run("on", NOON + 3_600_000);
    assert.equal(w.calls.balance, 1);
    resetIrysReads();
  });
  test("an Irys funding recorded as sent holds the Irys target for UNCONFIRMED_WAIT_MS (a late credit cannot fund twice); after it, one funding", () => {
    const low = { payer: { address: PAYER, walletLamports: sol(0.03), irysLamports: BigInt(0) } } as const;
    const ledger = [row({ at: NOON - 60_000, target: "irys-balance", kind: "irys-fund", from: PAYER, to: "irys", lamports: irysLv.fill, signature: "fund1" })];
    const inside = planTopUps(input({ ...low, ledger }));
    assert.deepEqual(inside.steps, []);
    assert.match(inside.refused.find((r) => r.target === "irys-balance")!.reason, /sent less than 3 minutes ago/);
    const after = planTopUps(input({ ...low, ledger, now: NOON - 60_000 + UNCONFIRMED_WAIT_MS }));
    assert.deepEqual(after.steps.map((s) => [s.target, s.kind]), [["irys-balance", "irys-fund"]]);
    // a sent transfer (not a funding) holds nothing: the two-step retry of the funding still goes the next cycle
    const transferOnly = [row({ at: NOON - 60_000, target: "irys-balance", kind: "transfer" })];
    assert.equal(planTopUps(input({ ...low, ledger: transferOnly })).steps.length, 1);
  });
  test("end to end: the node credits late, the cycles inside the wait fund nothing, the first after it funds once", async () => {
    const w = fakeWorld({ wallet: sol(0.05), irys: BigInt(0) });
    await w.run("on", NOON);
    assert.equal(w.calls.fund, 1);
    w.setIrys(BigInt(0));   // the node has not credited it
    await w.run("on", NOON + 60_000); await w.run("on", NOON + 120_000);
    assert.equal(w.calls.fund, 1, "no second funding inside the wait");
    await w.run("on", NOON + UNCONFIRMED_WAIT_MS);
    assert.equal(w.calls.fund, 2, "still low after the wait: one funding");
  });
  test("ops.json's top-up line carries today's Irys requests against the keeper's share", async () => {
    const w = fakeWorld({ wallet: BigInt(0), irys: sol(0.02) });
    await w.run();
    assert.ok(topUpOpsLines(w.registry, NOON).some((l) => /^- Irys reads today: \d+ of the keeper's \d+ share\.$/.test(l)));
  });
});

describe("the executor", () => {
  test("the two steps: the first lands, the second fails; the first cycle after the back-off retries only the second step", async () => {
    const w = fakeWorld({ fundFails: 1 });
    const r1 = await w.run();
    assert.ok(r1);
    assert.deepEqual(r1.done.map((d) => [d.kind, d.status]), [["transfer", "sent"], ["irys-fund", "failed"]]);
    assert.equal(w.calls.transfer, 1); assert.equal(w.irysBalance(), BigInt(0));
    assert.equal(w.alerts.filter((a) => a.kind === "bt-top-up").length, 1, "an informational row for the transfer that landed");
    const held = await w.run("on", NOON + 60_000);
    assert.deepEqual(held!.done, [], "HB-125: held for the back-off window");
    assert.match(held!.plan.refused.find((r) => r.target === "irys-balance")!.reason, /back-off/);
    const r2 = await w.run("on", NOON + FAILURE_BACKOFF_FIRST_MS);
    assert.ok(r2);
    assert.deepEqual(r2.done.map((d) => [d.kind, d.status]), [["irys-fund", "sent"]]);
    assert.equal(w.calls.transfer, 1, "no second transfer"); assert.equal(w.irysBalance(), irysLv.fill);
    const rows = topUpRowsSince(w.registry.db, 0);
    assert.deepEqual(rows.map((x) => [x.target, x.kind, x.status, x.signature]), [["irys-balance", "transfer", "sent", "tx1"], ["irys-balance", "irys-fund", "failed", null], ["irys-balance", "irys-fund", "sent", "fund2"]]);
    assert.ok(rows.every((x) => x.reason.length > 10 && x.at > 0));
    assert.throws(() => w.registry.db.prepare("DELETE FROM top_ups").run(), /append-only/);
    assert.throws(() => w.registry.db.prepare("UPDATE top_ups SET status='sent'").run(), /append-only/);
  });
  test("a top-up that fails twice in a row raises bt-top-up-failed", async () => {
    const w = fakeWorld({ fundFails: 5, wallet: sol(0.01) + sol(0.05) });
    await w.run();
    assert.equal(w.alerts.filter((a) => a.kind === "bt-top-up-failed").length, 0, "one failure is not an alarm");
    await w.run("on", NOON + FAILURE_BACKOFF_FIRST_MS);
    const alarm = w.alerts.filter((a) => a.kind === "bt-top-up-failed");
    assert.equal(alarm.length, 1); assert.match(alarm[0].text, /failed twice in a row\. Last error: Irys node answered 503/);
  });
  test("a failed simulation sends nothing and is recorded as failed", async () => {
    const w = fakeWorld({ transferFails: true, wallet: BigInt(0) });
    const r = await w.run();
    assert.ok(r); assert.match(r.done[0].error ?? "", /simulation failed/);
    // the wallet transfer and the Irys transfer both failed; the Irys funding waits on a transfer that did not land
    assert.deepEqual(r.done.map((d) => [d.target, d.kind, d.status]), [["upload-payer-wallet", "transfer", "failed"], ["irys-balance", "transfer", "failed"]]);
    assert.equal(w.calls.fund, 0); assert.ok(r.skipped.some((s) => /waits/.test(s)));
  });
  test("the keeper key short: bt-keeper-balance-low with the amount, nothing sent", async () => {
    const w = fakeWorld({ signer: sol(0.05), wallet: BigInt(0) });
    const r = await w.run();
    assert.ok(r); assert.equal(r.done.length, 0); assert.equal(w.calls.transfer, 0);
    const a = w.alerts.find((x) => x.kind === "bt-keeper-balance-low");
    assert.ok(a); assert.match(a.text, /Send about \d\.\d\d SOL to FQYod/); assert.match(a.key, /^bt-keeper-balance-low:2026-10-19$/);
  });
  test("the kill switch: BURNTICKER_TOP_UP=off plans and logs, sends and records nothing", async () => {
    assert.equal(topUpModeFromEnv({}), "on"); assert.equal(topUpModeFromEnv({ BURNTICKER_TOP_UP: "off" }), "off"); assert.equal(topUpModeFromEnv({ BURNTICKER_TOP_UP: "on" }), "on");
    const w = fakeWorld({ wallet: BigInt(0) });
    const r = await w.run("off");
    assert.ok(r); assert.equal(r.mode, "off"); assert.equal(r.done.length, 0); assert.equal(w.calls.transfer + w.calls.fund, 0);
    assert.ok(r.skipped.length >= 2); assert.ok(w.logs.some((l) => /off \(BURNTICKER_TOP_UP=off\), would move/.test(l)));
    assert.deepEqual(topUpRowsSince(w.registry.db, 0), []);
    assert.ok(topUpOpsLines(w.registry, NOON).some((l) => /Automatic top-ups are OFF/.test(l)));
  });
  test("the first automatic top-up shows in ops.json: the count, the SOL, the signer's days and the last transaction", async () => {
    const w = fakeWorld({ wallet: BigInt(0), irys: sol(0.02) });
    await w.run();
    const lines = topUpOpsLines(w.registry, NOON);
    assert.match(lines[0], /^- Top-ups: 1 today, 0\.0300 SOL; signer covers about \d+ days\.$/);
    assert.match(lines[1], /^- Last top-up: 0\.0300 SOL to the upload wallet \(transfer\) at .* Denver, tx1$/);
    assert.ok(w.logs.some((l) => /\[top-up\] moved 0\.0300 SOL from the keeper key to the upload wallet: tx1/.test(l)));
  });
  test("ops lines are empty on a registry that never had a top-up (and reading never creates the table)", () => {
    const db = new DatabaseSync(":memory:");
    assert.deepEqual(topUpOpsLines({ db, getStatus: () => null }, NOON), []);
    assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE name='top_ups'").get(), undefined);
    recordTopUp(db, { at: NOON, target: "deficit-keeper", kind: "transfer", from: SIGNER, to: DEFICIT, lamports: sol(0.05), status: "sent", signature: "s", reason: "low", error: null });
    assert.equal(topUpRowsSince(db, 0).length, 1);
  });
});

describe("the wiring", () => {
  const log = () => {};
  test("skipped on a dry run, a read-only keeper, and a non-mainnet keeper without an upload payer", () => {
    assert.match(topUpRunnerFromEnv({ env: {}, cluster: "mainnet", dryRun: true, connection: null, signer: null, log }).why, /dry run/);
    assert.equal(topUpRunnerFromEnv({ env: {}, cluster: "mainnet", dryRun: false, connection: null, signer: null, log }).runner, null);
    const fakeConn = {} as never, fakeSigner = { publicKey: { toBase58: () => SIGNER } } as never;
    const dev = topUpRunnerFromEnv({ env: {}, cluster: "devnet", dryRun: false, connection: fakeConn, signer: fakeSigner, log });
    assert.equal(dev.runner, null); assert.match(dev.why, /devnet without an upload payer/);
    const main = topUpRunnerFromEnv({ env: {}, cluster: "mainnet", dryRun: false, connection: fakeConn, signer: fakeSigner, log, root: path.join(import.meta.dirname, "..") });
    assert.ok(main.runner); assert.match(main.why, /^on/);
    assert.match(topUpRunnerFromEnv({ env: { BURNTICKER_TOP_UP: "off" }, cluster: "mainnet", dryRun: false, connection: fakeConn, signer: fakeSigner, log }).why, /OFF/);
  });
  test("config/burnticker/top-up.json parses to the code defaults and states the 50-launch sizing", () => {
    const file = path.join(import.meta.dirname, "..", "config", "burnticker", "top-up.json");
    if (!fs.existsSync(file)) return;
    assert.deepEqual(loadTopUpConfig(path.join(import.meta.dirname, "..")), DEFAULT_TOP_UP_CONFIG);
    const raw = fs.readFileSync(file, "utf8");
    assert.match(raw, /50 launches/); assert.doesNotMatch(raw, /cap"|Ceiling|maxPerDay/i);
    assert.equal(SOL, BigInt(1_000_000_000));
  });
  test("a bad config is refused, not half applied", () => {
    assert.throws(() => parseTopUpConfig({ uploadPayerWallet: { floorLamports: 30, fillLamports: 10 } }), /fillLamports must be above/);
    assert.throws(() => parseTopUpConfig({ signer: { floorLamports: "0.1" } }), /whole number of lamports/);
  });
});
