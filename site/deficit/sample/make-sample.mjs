// Builds site/deficit/sample/{status.json,burns.json} in the keeper's published shape (src/lib/burnKeeper/statusPage.ts,
// schema burnkeeper.status/v1) from the frozen Treasury fixture, so the landing page can be previewed before the keeper has
// published anything. It is SAMPLE DATA: no transactions exist (signatures are null, cluster is "replay"), the fee pool is an
// assumed constant $100/day inflow at a $0.001 token price (the replay doc's middle scenario), and the page shows a banner for it.
//
//   node site/deficit/sample/make-sample.mjs            # from the repo root; reads the frozen fixture copied beside it
//
// The arithmetic is the rule as written (every full $1B of increase = 1 unit; remainders carry across consecutive increases
// only; spend = pool × (1 − 0.95^units)). The production page never uses this file — it reads the keeper's own status.json.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..", "..");
const fixture = JSON.parse(fs.readFileSync(path.join(here, "treasury-fixture.json"), "utf8"));
const rows = fixture.data.filter((r) => r.record_date >= "2024-12-31").sort((a, b) => (a.record_date < b.record_date ? -1 : 1));

const RULES_SHA = "dae4d8042ac1753b6195aa91da1e699e534ef72cddc29bab7ae323bed6b81a15";
const UNIT = 1_000_000_000n * 100n; // cents
const F = 0.05, SOL_USD = 200, PRICE = 0.001, INFLOW_USD_DAY = 100;
const cents = (s) => { const [w, f = ""] = s.split("."); return BigInt(w) * 100n + BigInt((f + "00").slice(0, 2)); };
const usd = (c) => { const n = c < 0n ? -c : c; const s = `${c < 0n ? "-" : ""}${n / 100n}.${String(n % 100n).padStart(2, "0")}`; return s; };
const treasury = "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/debt_to_penny?fields=record_date,tot_pub_debt_out_amt";

let prev = rows[0], carry = 0n, runSince = null, poolLamports = 0n, lastDay = Date.parse(rows[0].record_date);
const burns = [], readings = [];
let totalBurned = 0n, totalSpent = 0n;
for (let k = 1; k < rows.length; k++) {
  const r = rows[k];
  const day = Date.parse(r.record_date);
  poolLamports += BigInt(Math.round(((day - lastDay) / 86_400_000) * INFLOW_USD_DAY / SOL_USD * 1e9)); lastDay = day;
  const now = cents(r.tot_pub_debt_out_amt), p = cents(prev.tot_pub_debt_out_amt), delta = now - p;
  readings.push({ recordDate: r.record_date, amount: r.tot_pub_debt_out_amt });
  if (delta <= 0n) { carry = 0n; runSince = null; prev = r; continue; }
  if (carry === 0n) runSince = prev.record_date;
  const carryIn = carry, total = delta + carry, units = Number(total / UNIT); carry = total % UNIT;
  if (units > 0) {
    const pool = poolLamports - 20_000_000n; // 0.02 SOL reserve
    const spent = BigInt(Math.floor(Number(pool) * (1 - Math.pow(1 - F, units))));
    const solSpent = Number(spent) / 1e9, got = Math.floor((solSpent * SOL_USD) / PRICE);
    poolLamports -= spent; totalSpent += spent; totalBurned += BigInt(got);
    const formula = `units = floor((${usd(now)} − ${usd(p)}${carryIn > 0n ? ` + ${usd(carryIn)} carried` : ""}) / 1000000000) = ${units}; spend = pool × (1 − (1 − 0.05)^${units}) = ${pool} × (1 − 0.95^${units}) = ${spent} lamports`;
    burns.push({
      recordDate: r.record_date, prevDate: prev.record_date, prev: usd(p), now: usd(now), delta: usd(delta), carryIn: usd(carryIn), carryRunSince: carryIn > 0n ? runSince : null,
      units, planned: String(units * 100000), shortIn: null, owed: null, burned: String(got), shortOut: null, status: "confirmed",
      memo: `DEBT|${r.record_date}|src=fiscaldata.treasury.gov debt_to_penny|prev=${usd(p)}|now=${usd(now)}|delta=${usd(delta)}|units=${units}|pool=${pool}|spent=${spent}|got=${got}|burn=${got}|swap=none|rules=sha256:${RULES_SHA.slice(0, 12)}|v2`,
      signature: null, txUrl: null, sourceUrl: `${treasury}&filter=record_date:eq:${r.record_date}`,
      mode: "buyback", pool: (Number(pool) / 1e9).toFixed(9).replace(/0+$/, "").replace(/\.$/, ""), spent: solSpent.toFixed(9).replace(/0+$/, "").replace(/\.$/, ""), got: String(got),
      swapSig: null, swapUrl: null, skippedReason: null,
      verify: { curl: `curl -s '${treasury}&filter=record_date:in:(${prev.record_date},${r.record_date})&sort=record_date'`, formula, expected: `spend ${spent} lamports (${solSpent.toFixed(4)} SOL) buying DEFICIT at market; burn every token received (${got})`, checks: [], verified: true },
    });
  }
  prev = r;
}

const last = rows[rows.length - 1];
const supply = 1_000_000_000n, pct = Number((totalBurned * 1_000_000n) / supply) / 10_000;
const month = last.record_date.slice(0, 7);
const sumBig = (xs) => xs.reduce((a, b) => a + BigInt(b), 0n);
const monthBurns = burns.filter((b) => b.recordDate.startsWith(month));
const status = {
  schema: "burnkeeper.status/v1", generatedAt: "2026-10-09T22:30:00.000Z", ticker: "DEFICIT", ruleKey: "DEBT", cluster: "replay",
  sample: "Replay of the real Treasury series with an assumed $100/day fee inflow at a $0.001 token price. No transactions exist. Built by site/deficit/sample/make-sample.mjs.",
  addresses: { mint: null, vault: null, keeper: null, mintUrl: null, vaultUrl: null, keeperUrl: null },
  rules: { sha256: RULES_SHA, statement: "Every full $1,000,000,000 added to the U.S. Total Public Debt Outstanding (Treasury's Debt to the Penny) since the previous business day's reading is one unit. Remainders under $1B carry forward only across consecutive increases; a day the debt falls or stays flat counts nothing and resets the remainder to zero. On each day with units, the keeper spends 1 - 0.95^units of its fee pool (the token's creator-fee SOL plus a disclosed seed, less a 0.02 SOL fee reserve) buying $DEFICIT at market on the public pool, and burns every token it receives in the next transaction. Days that would spend under $1 buy nothing. The keeper never sells and never sends tokens anywhere but the burn.", unitUsd: "1000000000", burnPerUnitTokens: "100000", file: "rules.json" },
  supply: { initial: "1000000000", current: String(supply - totalBurned), source: "ledger" },
  burned: { total: String(totalBurned), pctOfSupply: pct, today: burns[burns.length - 1].burned, thisMonth: String(sumBig(monthBurns.map((b) => b.burned))), burnsToday: 1, burnsThisMonth: monthBurns.length, count: burns.length },
  shortfall: { outstanding: "0" },
  vault: { allocation: "250000000", balance: null, allocationLeft: "250000000", trailing30d: String(sumBig(burns.filter((b) => Date.parse(b.recordDate) > Date.parse(last.record_date) - 30 * 86_400_000).map((b) => b.burned))), projectedLifeDays: null, vesting: { kind: "vesting", cliffDays: 0, vestDays: 365 } },
  feed: { name: "U.S. Treasury, Debt to the Penny (Total Public Debt Outstanding)", lastRecordDate: last.record_date, lastAmount: last.tot_pub_debt_out_amt, readings: readings.length + 1, lastPollAt: "2026-10-09T20:30:04.000Z", lastPollOutcome: "burned 2026-10-08", nextPollAt: "2026-10-12T20:30:00.000Z" },
  health: { pending: 0, lastError: null, unverified: 0 },
  mode: "buyback",
  buyback: { feePoolSol: (Number(poolLamports - 20_000_000n) / 1e9).toFixed(4), reserveSol: "0.02", fractionPerUnit: "0.05", floorUsd: "1", spentSolToday: burns[burns.length - 1].spent, spentSolMonth: monthBurns.reduce((a, b) => a + Number(b.spent), 0).toFixed(4), spentSolTotal: (Number(totalSpent) / 1e9).toFixed(4), boughtAndBurned: String(totalBurned), skippedDays: 0,
    funding: { feeWallet: null, feeWalletUrl: null, creatorFeeSource: null, creatorFeeSourceUrl: null, seedTx: null, seedTxUrl: null, seedSol: null } },
};
fs.writeFileSync(path.join(here, "status.json"), `${JSON.stringify(status, null, 2)}\n`);
fs.writeFileSync(path.join(here, "burns.json"), `${JSON.stringify(burns, null, 2)}\n`);
console.log(`${burns.length} burn days, ${burns.reduce((a, b) => a + b.units, 0)} units, ${totalBurned} tokens burned (${pct.toFixed(2)}% of supply) → sample/status.json, sample/burns.json`);
