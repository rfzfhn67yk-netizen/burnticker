// HB-180 / HS-69 (seventh pre-launch audit, LA7-7 and CH7-4): the keeper key's automatic top-ups have one hard daily ceiling for all
// targets together (default 0.5 SOL a UTC day; BURNTICKER_TOP_UP_MAX_SOL_PER_DAY overrides it), which stops every top-up for the rest
// of the UTC day with one alarm; and the drain stop is latched: it stays stopped after its window until the operator clears it.
// No network, no keys: a fake world that moves balances on each transfer.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  DEFAULT_TOP_UP_CONFIG, REFERENCE_IRYS_PRICES, TOP_UP_CEILING_ALERT, TOP_UP_CEILING_ENV, clearDrainStop, denverDay, loadTopUpConfig,
  parseTopUpConfig, planTopUps, runTopUps, topUpRowsSince, utcDay, withCeilingFromEnv,
  type IrysPayerAccount, type TopUpConfig, type TopUpInput, type TopUpRow,
} from "@/lib/burnticker/ops/topUp";
import { PUSH_KIND_OF_ALERT } from "@/lib/burnticker/push";

const sol = (n: number) => BigInt(Math.round(n * 1e9));
const SIGNER = "FQYod3oyUJNedCw3xbp6AHifyZmG4uNrD1XvLqtpGd5L", PAYER = "EMht6aGcQWsBjKx4Ya41giF3G9MdZn1PVvctEjb6Tt23", DEFICIT = "J5XB9gNiftyMpLPy767KB4LF9R2y2ZefvtNck6xhFTf6";
const HOUR = 3_600_000;
// 2026-10-21 02:00 UTC (20:00 Denver the evening before): the UTC day and the Denver day differ, so the test shows which one counts
const T0 = Date.parse("2026-10-21T02:00:00Z");
const cfg = DEFAULT_TOP_UP_CONFIG;

function input(o: Partial<TopUpInput> = {}): TopUpInput {
  return {
    now: T0, config: cfg, signer: { address: SIGNER, lamports: sol(10) },
    payer: { address: PAYER, walletLamports: sol(0.03), irysLamports: sol(0.02) },
    irysPrices: { ...REFERENCE_IRYS_PRICES }, launchesLast7d: 0, liveCoins: 2,
    deficitKeeper: { address: DEFICIT, lamports: sol(0.0) }, ledger: [], ...o,
  };
}
const row = (o: Partial<TopUpRow>): TopUpRow => ({ id: 1, at: T0, day: denverDay(o.at ?? T0), target: "deficit-keeper", kind: "transfer", from: SIGNER, to: DEFICIT, lamports: sol(0.06), status: "sent", signature: "sig", reason: "r", error: null, ...o });

/** Every target drained to zero after each refill (a leaked key): the worst case the audit reproduced. */
function leakWorld(config: TopUpConfig = cfg) {
  const bal = new Map<string, bigint>([[SIGNER, sol(10)], [PAYER, BigInt(0)], [DEFICIT, BigInt(0)]]);
  let irysBal = BigInt(0);
  const irys: IrysPayerAccount = { address: PAYER, balance: async () => irysBal, price: async () => REFERENCE_IRYS_PRICES.snapshot, fund: async (l) => { bal.set(PAYER, bal.get(PAYER)! - l); irysBal += l; return { id: "fund" }; } };
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE status (key TEXT PRIMARY KEY, value TEXT, updated_at INTEGER)");
  const registry = { db, setStatus: (k: string, v: unknown, now = Date.now()) => { db.prepare("INSERT INTO status (key, value, updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(k, typeof v === "string" ? v : JSON.stringify(v), now); }, tokens: () => [] as never[] };
  const alerts: { kind: string; key: string; text: string }[] = [];
  let sig = 0;
  const run = async (now: number) => {
    const r = await runTopUps({ registry, config, mode: "on", now, log: () => {}, alert: (kind, key, text) => { alerts.push({ kind, key, text }); },
      deps: { signerAddress: SIGNER, readLamports: async (a) => bal.get(a) ?? BigInt(0), irys, deficitKeeper: DEFICIT,
        transfer: async (to, l) => { bal.set(SIGNER, bal.get(SIGNER)! - l - BigInt(5_000)); bal.set(to, (bal.get(to) ?? BigInt(0)) + l); return { status: "sent", signature: `tx${++sig}` }; } } });
    // the leak: everything a target received is gone before the next cycle
    bal.set(PAYER, BigInt(0)); bal.set(DEFICIT, BigInt(0)); irysBal = BigInt(0);
    return r;
  };
  const sentFromSigner = (from: number, to: number) => topUpRowsSince(db, 0).filter((x) => x.kind === "transfer" && x.status !== "failed" && x.at >= from && x.at < to).reduce((a, x) => a + x.lamports, BigInt(0));
  return { run, registry, alerts, sentFromSigner, bal };
}

describe("HB-180 · the hard daily ceiling", () => {
  test("the default is 0.5 SOL a UTC day, and the shipped config says so", () => {
    assert.equal(cfg.dailyCeilingLamports, sol(0.5));
    assert.equal(loadTopUpConfig().dailyCeilingLamports, sol(0.5));
    assert.throws(() => parseTopUpConfig({ dailyCeilingLamports: 0 }), /dailyCeilingLamports must be above 0/);
    assert.equal(parseTopUpConfig({ dailyCeilingLamports: "250000000" }).dailyCeilingLamports, sol(0.25));
  });
  test("BURNTICKER_TOP_UP_MAX_SOL_PER_DAY overrides it; a value that does not read keeps the ceiling (a typo never removes it)", () => {
    assert.equal(withCeilingFromEnv(cfg, { [TOP_UP_CEILING_ENV]: "0.25" }).config.dailyCeilingLamports, sol(0.25));
    assert.equal(withCeilingFromEnv(cfg, {}).config.dailyCeilingLamports, sol(0.5));
    for (const bad of ["off", "0", "-1", "1e3", "11", "0.5 SOL"]) {
      const r = withCeilingFromEnv(cfg, { [TOP_UP_CEILING_ENV]: bad });
      assert.equal(r.config.dailyCeilingLamports, sol(0.5), bad);
      assert.match(r.note ?? "", /the ceiling stays 0\.50 SOL/);
    }
  });
  test("a transfer that would pass the ceiling is refused, and so is every later want in the pass", () => {
    const ledger = [row({ at: T0 - HOUR, lamports: sol(0.47) })];   // the same UTC day
    const p = planTopUps(input({ ledger, payer: { address: PAYER, walletLamports: BigInt(0), irysLamports: BigInt(0) } }));
    // the upload wallet's 0.03 fits exactly (0.50 is not above 0.50); the Irys transfer after it would pass, so it and the $DEFICIT keeper wait
    assert.deepEqual(p.steps.map((s) => [s.target, s.kind]), [["upload-payer-wallet", "transfer"]]);
    assert.ok(p.ceiling.stopped);
    assert.deepEqual(p.refused.map((r) => r.target).sort(), ["deficit-keeper", "irys-balance"]);
    assert.ok(p.refused.every((r) => /the daily ceiling/.test(r.reason)));
    assert.match(p.ceiling.text ?? "", /stopped every top-up for the rest of the UTC day 2026-10-21: the keeper key has sent 0\.5000 SOL today and the daily ceiling is 0\.5000 SOL/);
  });
  test("the day is the UTC day: yesterday's UTC sends do not count, whatever the Denver day says", () => {
    const yesterdayUtc = T0 - 3 * HOUR;   // 23:00Z on 10-20, the same Denver day as T0
    assert.equal(denverDay(yesterdayUtc), denverDay(T0)); assert.notEqual(utcDay(yesterdayUtc), utcDay(T0));
    const p = planTopUps(input({ ledger: [row({ at: yesterdayUtc, lamports: sol(0.49) })] }));
    assert.equal(p.ceiling.stopped, false); assert.equal(p.steps.length, 1);
  });
  test("once stopped, the rest of the UTC day plans nothing, even a want that would fit; the next UTC day plans again", () => {
    const stopped = planTopUps(input({ ceilingStoppedDay: utcDay(T0) }));
    assert.deepEqual(stopped.steps, []); assert.match(stopped.refused[0].reason, /waits for 00:00 UTC/);
    assert.equal(planTopUps(input({ ceilingStoppedDay: utcDay(T0 - 24 * HOUR) })).steps.length, 1);
  });
  test("a leak on every target for three days: never more than the ceiling a UTC day, one alarm a day, pushed to the phone", async () => {
    // the drain stop is set wide here so the ceiling alone is measured
    const w = leakWorld({ ...cfg, drainStop: { count: 1000, windowHours: 1, perDay: 1000 } });
    const start = Date.parse("2026-10-21T00:00:00Z");
    for (let now = start; now < start + 72 * HOUR; now += 10 * 60_000) await w.run(now);
    for (let d = 0; d < 3; d++) {
      const out = w.sentFromSigner(start + d * 24 * HOUR, start + (d + 1) * 24 * HOUR);
      assert.ok(out <= sol(0.5), `day ${d}: ${out} lamports`);
      assert.ok(out >= sol(0.4), `day ${d}: the ceiling, not something else, is what stopped it (${out})`);
    }
    const alarms = w.alerts.filter((a) => a.kind === TOP_UP_CEILING_ALERT);
    assert.deepEqual([...new Set(alarms.map((a) => a.key))], [`${TOP_UP_CEILING_ALERT}:2026-10-21`, `${TOP_UP_CEILING_ALERT}:2026-10-22`, `${TOP_UP_CEILING_ALERT}:2026-10-23`]);
    assert.equal(PUSH_KIND_OF_ALERT[TOP_UP_CEILING_ALERT], "top-up-ceiling");
  });
});

describe("HB-180 · the drain stop is latched until the operator clears it", () => {
  test("a draining wallet stays stopped after the 6-hour and the 24-hour windows; only --clear-drain releases it", async () => {
    const w = leakWorld();
    const start = Date.parse("2026-10-21T00:30:00Z");
    for (let k = 0; k < 3; k++) await w.run(start + k * HOUR);
    const tripped = await w.run(start + 3 * HOUR);
    assert.ok(tripped!.plan.draining.some((d) => d.target === "deficit-keeper"));
    const deficitSends = () => topUpRowsSince(w.registry.db, 0).filter((r) => r.target === "deficit-keeper" && r.status === "sent").length;
    assert.equal(deficitSends(), 3);
    // before HB-180 it resumed once the window had passed; now it holds a day and a half later
    for (const later of [9 * HOUR, 25 * HOUR, 36 * HOUR]) {
      const r = await w.run(start + later);
      assert.ok(r!.plan.latched.includes("deficit-keeper"), `held at +${later / HOUR} h`);
      assert.match(r!.plan.refused.find((x) => x.target === "deficit-keeper")!.reason, /stays until the operator clears it \(scripts\/ops\/top-up\.mts --clear-drain deficit-keeper\)/);
    }
    assert.equal(deficitSends(), 3, "nothing more went to the draining wallet");
    assert.match(w.alerts.find((a) => a.kind === "bt-top-up-draining")!.text, /It does not resume on its own/);
    clearDrainStop(w.registry, "deficit-keeper", start + 37 * HOUR);
    const r = await w.run(start + 37 * HOUR + 60_000);
    assert.ok(!r!.plan.latched.includes("deficit-keeper"));
    assert.equal(deficitSends(), 4, "cleared by the operator: refilled at once");
  });
});
