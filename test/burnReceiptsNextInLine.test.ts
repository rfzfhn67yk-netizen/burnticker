// 2026-10-29 (Helius budget hold): planCrank's next-in-line lookup is a getProgramAccounts scan (10 Helius credits). The keeper ran it
// for every coin twice a cycle, every minute, for an answer that could not change — 80,000 credits a day for three coins waiting on
// graduation. The planner now answers idle from the config alone when the cursor has caught up with the last record date, and
// otherwise remembers the scan per (program, coin, cursor) until this process submits a reading, the cursor moves, or ten minutes pass.
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Keypair, type Connection } from "@solana/web3.js";
import { clearNextInLineMemo, forgetNextReadingInLine, NEXT_IN_LINE_CACHE_MS, planCrank } from "@/lib/burnReceipts/crank";
import { configPda, readingPda } from "@/lib/burnReceipts/pda";
import { encodeAccount, FakeConnection } from "./burntickerApiHelpers.ts";

const NOW = Date.UTC(2026, 9, 29, 12);

function coin(o: { cursor: number; last: number; readings: { date: number; prev: number; units: bigint; processed?: boolean }[] }) {
  const conn = new FakeConnection();
  const programId = Keypair.generate().publicKey, mint = Keypair.generate().publicKey;
  const config = configPda(programId, mint);
  conn.accounts.set(config.toBase58(), { owner: programId, lamports: 1, data: encodeAccount("TokenConfig", (v) => {
    v.mint = mint; v.has_baseline = true; v.last_record_date = o.last; v.crank_cursor = o.cursor; (v.rule as Record<string, unknown>).mode = 1;
  }) });
  for (const r of o.readings) conn.accounts.set(readingPda(programId, config, r.date).toBase58(), { owner: programId, lamports: 1, data: encodeAccount("Reading", (v) => {
    v.config = config; v.record_date = r.date; v.prev_date = r.prev; v.units = r.units; v.processed = r.processed ?? false;
  }) });
  const scans = () => conn.calls.filter((c) => c === "getProgramAccounts").length;
  const orig = conn.getProgramAccounts.bind(conn);
  conn.getProgramAccounts = async (p, cfg) => { conn.calls.push("getProgramAccounts"); return orig(p, cfg); };
  const ctx = { connection: conn as unknown as Connection, programId, mint, cluster: "devnet" as const, rememberNextInLine: true };
  return { conn, ctx, programId, mint, config, scans, plan: (at = NOW) => planCrank(ctx, Keypair.generate().publicKey, at) };
}

describe("planCrank without the program-account scan", () => {
  beforeEach(() => clearNextInLineMemo());

  test("a cursor that has caught up with the last record date is idle from the config alone: no scan at all", async () => {
    const c = coin({ cursor: 20261028, last: 20261028, readings: [] });
    const p = await c.plan();
    assert.deepEqual(p, { status: "idle", cursor: 20261028 });
    assert.equal(c.scans(), 0);
  });

  test("a reading in line is found once and remembered: the second plan at the same cursor does not scan again", async () => {
    const c = coin({ cursor: 20261027, last: 20261028, readings: [{ date: 20261028, prev: 20261027, units: BigInt(0) }] });
    const p1 = await c.plan();
    assert.ok("kind" in p1 && p1.kind === "no_units" && p1.recordDate === 20261028);
    assert.equal(c.scans(), 1);
    const p2 = await c.plan(NOW + 60_000);
    assert.ok("kind" in p2 && p2.recordDate === 20261028);
    assert.equal(c.scans(), 1, "remembered");
  });

  test("the memory ends when this process submits a reading (forget), when the cursor moves, or after ten minutes", async () => {
    const c = coin({ cursor: 20261027, last: 20261028, readings: [{ date: 20261028, prev: 20261027, units: BigInt(0) }] });
    await c.plan(); assert.equal(c.scans(), 1);
    forgetNextReadingInLine(c.programId, c.mint);
    await c.plan(NOW + 1); assert.equal(c.scans(), 2, "forgotten after a submit");
    await c.plan(NOW + 1 + NEXT_IN_LINE_CACHE_MS); assert.equal(c.scans(), 3, "expired");
    // someone cranked: the cursor moved to 20261028 and a new reading 20261029 is in line
    c.conn.accounts.set(c.config.toBase58(), { owner: c.programId, lamports: 1, data: encodeAccount("TokenConfig", (v) => {
      v.mint = c.mint; v.has_baseline = true; v.last_record_date = 20261029; v.crank_cursor = 20261028; (v.rule as Record<string, unknown>).mode = 1;
    }) });
    c.conn.accounts.set(readingPda(c.programId, c.config, 20261029).toBase58(), { owner: c.programId, lamports: 1, data: encodeAccount("Reading", (v) => {
      v.config = c.config; v.record_date = 20261029; v.prev_date = 20261028; v.units = BigInt(0);
    }) });
    const p = await c.plan(NOW + 2 + NEXT_IN_LINE_CACHE_MS);
    assert.ok("kind" in p && p.recordDate === 20261029);
    assert.equal(c.scans(), 4, "a new cursor is a new scan");
  });
  test("without rememberNextInLine (the SDK's one-shot crank) every plan scans: a reading added at the same cursor is seen at once", async () => {
    const c = coin({ cursor: 20261027, last: 20261028, readings: [] });
    const ctx = { ...c.ctx, rememberNextInLine: false };
    assert.deepEqual(await planCrank(ctx, Keypair.generate().publicKey, NOW), { status: "idle", cursor: 20261027 });
    c.conn.accounts.set(readingPda(c.programId, c.config, 20261028).toBase58(), { owner: c.programId, lamports: 1, data: encodeAccount("Reading", (v) => { v.config = c.config; v.record_date = 20261028; v.prev_date = 20261027; v.units = BigInt(0); }) });
    const p = await planCrank(ctx, Keypair.generate().publicKey, NOW);
    assert.ok("kind" in p && p.recordDate === 20261028);
    assert.equal(c.scans(), 2);
  });

});
