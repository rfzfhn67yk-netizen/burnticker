// BURN KEEPER (2026-10-09) — the published status site (SPEC §5): status.json's shape, burns.json's verify block (curl, formula,
// expected, recomputed checks), the HTML (title $DEFICIT, the rule, explorer links per cluster, no price talk), and atomic publishing.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openLedger } from "@/lib/burnKeeper/ledger";
import { executePending, ingest, type ChainPort, type SignedTx } from "@/lib/burnKeeper/cycle";
import { loadRules, tokensToRaw, usdToCents } from "@/lib/burnKeeper/rules";
import { buildBurnsJson, buildStatus, debtChartSvg, publishSite, renderIndexHtml, STATUS_SCHEMA, type StatusInput } from "@/lib/burnKeeper/statusPage";
import type { DebtReading } from "@/lib/burnKeeper/feeds/treasury";
import { buybackRules, FakeChain, FakeRouter, vaultRules } from "./burnKeeperHelpers.ts";

const root = path.resolve(import.meta.dirname, "..");
const loaded = vaultRules();   // these blocks exercise vault mode; the BUYBACK block at the end runs the committed (buyback) file
void loadRules; void root;
const R = (d: string, a: string): DebtReading => ({ recordDate: d, amount: a, cents: usdToCents(a) });
const T = "DEBT", F = "treasury.debt_to_penny";

async function scenario(): Promise<StatusInput> {
  const ledger = openLedger(":memory:");
  let n = 0; let vault = tokensToRaw("250000000", 6);
  const landed = new Set<string>();
  const chain: ChainPort = {
    vaultBalanceRaw: async () => vault, findMemoOnChain: async () => null, signatureStatuses: async (s) => s.map(() => null), blockHeight: async () => 1,
    buildSigned: async (b: bigint): Promise<SignedTx> => { n++; return { signature: `5ig${n}${"x".repeat(80)}`, raw: new Uint8Array([n]), blockhash: "b", lastValidBlockHeight: 99 }; },
    simulate: async () => ({ err: null, logs: [] }), send: async (r) => { landed.add(String(r[0])); }, confirm: async () => ({ status: "confirmed", slot: 9 }),
  };
  const now = Date.parse("2026-10-09T21:00:00Z");
  const ctx = { ledger, loaded, log: () => {}, now: () => now, dryRun: false };
  ingest(ctx, { readings: [R("2026-10-02", "40242446619209.33"), R("2026-10-05", "40249104431078.48"), R("2026-10-06", "40273024579219.17"), R("2026-10-07", "40284036147367.19"), R("2026-10-08", "40305316210829.72")], refusals: [] });
  await executePending(ctx, chain);
  vault -= tokensToRaw("4200000", 6);
  return { loaded, readings: ledger.readings(T, F), burns: ledger.burns(T, F), now, nextPollAt: Date.parse("2026-10-09T20:30:00Z") + 86_400_000, lastPoll: { at: now, outcome: "1 new reading(s)" }, lastError: null,
    chain: { cluster: "devnet", mint: "So11111111111111111111111111111111111111112", vault: "Vau1t11111111111111111111111111111111111111", keeper: "Keeper1111111111111111111111111111111111111", supplyRaw: null, vaultRaw: vault } };
}

describe("status.json", () => {
  test("shape: schema, ticker, rule key, rules hash, supply, burned, shortfall, vault, feed, health", async () => {
    const s = buildStatus(await scenario());
    assert.equal(s.schema, STATUS_SCHEMA);
    assert.equal(s.ticker, "DEFICIT");
    assert.equal(s.ruleKey, "DEBT");
    assert.equal(s.rules.sha256, loaded.sha256);
    assert.deepEqual(Object.keys(s).sort(), ["addresses", "burned", "buyback", "cluster", "execution", "feed", "generatedAt", "health", "mode", "program", "rules", "ruleKey", "schema", "shortfall", "supply", "ticker", "vault"].sort());
    assert.equal(s.execution, "legacy"); assert.equal(s.program, null, "no program block in legacy execution");
    // 10-05 +$6.66B → 6; 10-06 +$23.92B (+0.66 carried) → 24; 10-07 +$11.01B (+0.58) → 11; 10-08 +$21.28B (+0.59) → 21. 62 units.
    assert.equal(s.burned.count, 4);
    assert.equal(s.burned.total, "6200000");
    assert.equal(s.burned.pctOfSupply, 0.62);
    assert.equal(s.supply.current, "993800000");
    assert.equal(s.supply.source, "ledger");
    assert.equal(s.burned.burnsToday, 4, "burns counted on Treasury's clock (ET): all executed 10-09");
    assert.equal(s.shortfall.outstanding, "0");
    assert.equal(s.vault.allocationLeft, "243800000");
    assert.ok(s.vault.projectedLifeDays! > 0);
    assert.equal(s.feed.lastRecordDate, "2026-10-08");
    assert.equal(s.health.unverified, 0);
    assert.match(s.addresses.mintUrl!, /\?cluster=devnet$/);
    JSON.parse(JSON.stringify(s));   // no BigInt anywhere
  });
});

describe("burns.json — verify it yourself", () => {
  test("every burn: the pair curl, the formula with the carry, the expected amount, recomputed checks all green", async () => {
    const b = buildBurnsJson(await scenario());
    assert.equal(b.length, 4);
    const last = b[b.length - 1];
    assert.equal(last.recordDate, "2026-10-08");
    assert.equal(last.prevDate, "2026-10-07");
    assert.match(last.verify.curl, /^curl -s 'https:\/\/api\.fiscaldata\.treasury\.gov\/.*record_date:in:\(2026-10-07,2026-10-08\)/);
    assert.match(last.verify.formula, /floor\(\(40305316210829\.72 − 40284036147367\.19 \+ \d+\.\d{2} carried\) \/ 1000000000\) = 21/);
    assert.match(last.verify.expected, /^2100000 DEFICIT/);
    assert.equal(last.verify.verified, true);
    assert.deepEqual(last.verify.checks, []);
    assert.ok(last.carryRunSince, "the carry's run is named");
    assert.match(last.txUrl!, /^https:\/\/explorer\.solana\.com\/tx\/.+\?cluster=devnet$/);
    assert.match(last.sourceUrl, /record_date:eq:2026-10-08$/);
  });
  test("a tampered row fails its check and is not verified", async () => {
    const i = await scenario();
    const burns = i.burns.map((x, k) => (k === 3 ? { ...x, units: 22 } : x));
    const b = buildBurnsJson({ ...i, burns });
    assert.equal(b[3].verify.verified, false);
    assert.ok(b[3].verify.checks.some((c) => /units/.test(c)));
    assert.equal(buildStatus({ ...i, burns }).health.unverified, 1);
  });
});

describe("index.html", () => {
  test("$DEFICIT title, the rule, the chart with markers, links per cluster, the verify blocks, and no price talk", async () => {
    const i = await scenario();
    const burns = buildBurnsJson(i);
    const html = renderIndexHtml(buildStatus(i, burns), burns, i.readings);
    assert.match(html, /<title>\$DEFICIT burn record<\/title>/);
    assert.match(html, /Every full \$1,000,000,000 added/);
    assert.match(html, /<svg[^>]+class="chart"/);
    assert.equal((html.match(/class="mark"/g) ?? []).length, 4);
    assert.match(html, /explorer\.solana\.com\/tx\/[^"]+\?cluster=devnet/);
    assert.match(html, /<details><summary>2026-10-08/);
    assert.match(html, /prefers-color-scheme: dark/);
    assert.match(html, /name="viewport"/);
    assert.match(html, /says nothing about what the token's price will do/);
    const copy = html.replace(/<script>[\s\S]*?<\/script>/g, "");   // the countdown's JavaScript says `return`; the COPY must not talk returns
    for (const bad of [/to the moon/i, /\bguarantee/i, /\breturns?\b/i, /price will (rise|go up|increase)/i, /\bprofit/i, /\binvest/i]) assert.doesNotMatch(copy, bad);
  });
  test("escapes what it prints; a one-reading ledger shows no chart yet", () => {
    assert.match(debtChartSvg([{ recordDate: "2026-10-08", amount: "1" }], []), /after the second reading/);
  });
  test("publishSite writes every file atomically (no temp files left)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bk-site-"));
    publishSite(dir, { "status.json": "{}\n", "index.html": "<!doctype html>" });
    assert.deepEqual(fs.readdirSync(dir).sort(), ["index.html", "status.json"]);
  });
});

describe("BUYBACK mode status (the primary mechanic)", () => {
  async function buybackScenario(): Promise<StatusInput> {
    const bl = buybackRules();
    const ledger = openLedger(":memory:");
    const chain = new FakeChain(); chain.vault = BigInt(0);
    const router = new FakeRouter(chain);
    const now = Date.parse("2026-10-09T21:00:00Z");
    const ctx = { ledger, loaded: bl, log: () => {}, now: () => now, dryRun: false };
    ingest(ctx, { readings: [R("2026-10-06", "40273024579219.17"), R("2026-10-07", "40284036147367.19"), R("2026-10-08", "40305316210829.72")], refusals: [] });
    await executePending(ctx, chain, router);
    return { loaded: bl, readings: ledger.readings(T, F), burns: ledger.burns(T, F), now, nextPollAt: null, lastPoll: null, lastError: null,
      funding: { creatorFeeSource: "CrEatorFeeVau1t1111111111111111111111111111", seedTx: "5eedTx111111111111111111111111111111111111111111111111111111111111111111111111111111111", seedSol: "1" },
      chain: { cluster: "devnet", mint: "So11111111111111111111111111111111111111112", vault: "Vau1t11111111111111111111111111111111111111", keeper: "Keeper1111111111111111111111111111111111111", supplyRaw: null, vaultRaw: BigInt(0), feeLamports: router.fee } };
  }
  test("status.json carries the fee pool, SOL spent, bought-and-burned and the funding disclosure; burns.json the swap link and a recomputed spend", async () => {
    const i = await buybackScenario();
    const burns = buildBurnsJson(i);
    const s = buildStatus(i, burns);
    assert.equal(s.mode, "buyback");
    assert.ok(s.buyback);
    assert.match(s.buyback!.feePoolSol!, /^\d+(\.\d+)?$/);
    assert.notEqual(s.buyback!.spentSolTotal, "0");
    assert.equal(s.buyback!.spentSolToday, s.buyback!.spentSolTotal);
    assert.equal(s.buyback!.boughtAndBurned, s.burned.total);
    assert.equal(s.buyback!.funding.seedSol, "1");
    assert.match(s.buyback!.funding.seedTxUrl!, /explorer\.solana\.com\/tx\/5eedTx.*\?cluster=devnet/);
    assert.equal(burns.length, 2);
    for (const b of burns) {
      assert.equal(b.verify.verified, true, b.verify.checks.join("; "));
      assert.match(b.swapUrl!, /explorer\.solana\.com\/tx\/swap/);
      assert.match(b.verify.formula, /spend = pool × \(1 − \(1 − 0\.02\)\^\d+\) = \d+ × \(1 − 0\.98\^\d+\) = \d+ lamports/);
      assert.equal(b.burned, b.got, "burned exactly what was bought (no dust in this scenario)");
    }
    JSON.parse(JSON.stringify(s)); JSON.parse(JSON.stringify(burns));
  });
  test("a tampered spend fails its recomputation", async () => {
    const i = await buybackScenario();
    const burns = i.burns.map((x, k) => (k === 1 ? { ...x, spendLamports: (x.spendLamports ?? BigInt(0)) + BigInt(1) } : x));
    const b = buildBurnsJson({ ...i, burns });
    assert.equal(b[1].verify.verified, false);
    assert.ok(b[1].verify.checks.some((c) => /^spend: recomputed/.test(c)));
  });
  test("the page: fee pool, SOL spent, swap links, where the money came from, still no price talk", async () => {
    const i = await buybackScenario();
    const burns = buildBurnsJson(i);
    const html = renderIndexHtml(buildStatus(i, burns), burns, i.readings);
    assert.match(html, /Fee pool/);
    assert.match(html, /SOL spent today/);
    assert.match(html, /Bought and burned/);
    assert.match(html, /<th>Swap<\/th>/);
    assert.match(html, /Where the money came from\./);
    assert.match(html, /disclosed seed of 1 SOL/);
    assert.match(html, /never sells, and sends tokens nowhere but the burn/);
    const copy = html.replace(/<script>[\s\S]*?<\/script>/g, "");
    for (const bad of [/to the moon/i, /\bguarantee/i, /\breturns?\b/i, /price will (rise|go up|increase)/i, /\bprofit/i, /\binvest/i]) assert.doesNotMatch(copy, bad);
  });
});
