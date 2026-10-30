// THE BROWSER RECEIPT VERIFIER (trust pack, 2026-10-10; src/lib/burnticker/trustpack/receiptCheck.ts). Replays frozen devnet bytes
// (test/fixtures/burnticker-trustpack/devnet-receipts.json: getTransaction + the burn program's accounts, captured from devnet) and the
// frozen Treasury series, so every check runs with no network: a real burned receipt and a real below-the-spend-floor receipt pass all
// ten checks; a tampered memo, Reading, rules file, source value or burn amount fails the right line. The browser-safe helpers are held
// equal to the Node references they mirror: the IDL reader to idlCoder.decodeAccount, the memo parser to burnReceipts/memo.ts, the
// arithmetic to burnReceipts/math.ts, base58 to accounts.ts#bs58.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { BURN_RECEIPTS_IDL } from "@/lib/burnReceipts/idl";
import { decodeAccount } from "@/lib/burnReceipts/idlCoder";
import { parseBuybackMemo } from "@/lib/burnReceipts/memo";
import { buybackSpend, step, formatFixed, rawToTokens } from "@/lib/burnReceipts/math";
import { bs58 } from "@/lib/burnReceipts/accounts";
import { readAccount, isAccount } from "@/lib/burnticker/trustpack/idlReader";
import { b58decode, b58encode, base64ToBytes, isSignature } from "@/lib/burnticker/trustpack/base58";
import { checkReceiptTx, fixed, memoFromLogs, parseProgramMemo, ruleSpend, stepUnits, tokens, treasuryUrl, type Rpc, type SourceFetch } from "@/lib/burnticker/trustpack/receiptCheck";
import { sampleReceipts, DEVNET_PROGRAM_ID } from "@/lib/burnticker/trustpack/samples";
import { v1CheckReceipt } from "@/lib/burnticker/trustpack/api";

const ROOT = path.join(import.meta.dirname, "..");
const FIX = JSON.parse(fs.readFileSync(path.join(ROOT, "test", "fixtures", "burnticker-trustpack", "devnet-receipts.json"), "utf8")) as { receipts: { ticker: string; recordDate: string; evidence: string; rulesPath: string; tx: Record<string, unknown>; accounts: { value: ({ owner: string; data: [string, string] } | null)[] } }[] };
const TREASURY = JSON.parse(fs.readFileSync(path.join(ROOT, "test", "fixtures", "treasury-debt-to-penny-2024-12-to-2026-10-08.json"), "utf8")) as { data: { record_date: string; tot_pub_debt_out_amt: string }[] };
const samples = sampleReceipts(ROOT);
const sigOf = (f: (typeof FIX.receipts)[number]) => samples.receipts.find((r) => r.evidence === f.evidence && r.recordDate === f.recordDate)!.signature;
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

/** A fake RPC over one fixture receipt; `edit` may tamper with the transaction or the accounts first. */
function fakeRpc(f: (typeof FIX.receipts)[number], edit?: (tx: Record<string, unknown>, acc: typeof f.accounts) => void): Rpc {
  const tx = clone(f.tx), acc = clone(f.accounts);
  edit?.(tx, acc);
  return { async call<T>(method: string): Promise<T> { if (method === "getTransaction") return tx as T; if (method === "getMultipleAccounts") return acc as T; throw new Error(`unexpected ${method}`); } };
}
/** The Treasury API answering from the frozen series (the URL's eq: date), optionally with a doctored value. */
const treasury = (override?: Record<string, string>): SourceFetch => async (url) => {
  const d = /record_date:eq:(\d{4}-\d{2}-\d{2})/.exec(url)?.[1];
  const row = TREASURY.data.find((r) => r.record_date === d);
  return { ok: true, status: 200, json: async () => ({ data: row ? [{ ...row, ...(override?.[row.record_date] ? { tot_pub_debt_out_amt: override[row.record_date] } : {}) }] : [] }) };
};
const run = (f: (typeof FIX.receipts)[number], o: { rpc?: Rpc; rules?: string | null; source?: SourceFetch | null } = {}) =>
  checkReceiptTx({ signature: sigOf(f), cluster: "devnet", programId: DEVNET_PROGRAM_ID, rpc: o.rpc ?? fakeRpc(f), rulesText: o.rules === undefined ? fs.readFileSync(path.join(ROOT, f.rulesPath), "utf8") : o.rules, fetchSource: o.source === undefined ? treasury() : o.source });
const byId = (r: Awaited<ReturnType<typeof run>>) => Object.fromEntries(r.checks.map((c) => [c.id, c]));
const burned = FIX.receipts.find((r) => r.ticker === "DEFICIT")!, floor = FIX.receipts.find((r) => r.ticker === "PCA")!;

describe("the receipt verifier on frozen devnet bytes", () => {
  test("the $DEFICIT 2026-10-06 receipt (spend capped at 2% of the reserve, the rest carried) passes all ten checks", async () => {
    const r = await run(burned);
    assert.equal(r.verified, true, JSON.stringify(r.checks, null, 1));
    assert.deepEqual(r.checks.map((c) => [c.id, c.ok]), [["tx", true], ["program", true], ["memo", true], ["reading", true], ["config", true], ["rules", true], ["source", true], ["units", true], ["spend", true], ["burn", true]]);
    assert.match(byId(r).source.detail, /40249104431078\.48.*40273024579219\.17/);
    assert.match(byId(r).spend.detail, /= 104345230 lamports .*spent 20132384 \+ carried out 84212846 = rule 104345230/);
    assert.equal(r.facts.sourceUrl, treasuryUrl("2026-10-06"));
  });
  test("the $PCA 2026-10-07 receipt (rule spend under the spend floor: nothing bought) passes, the burn line says nothing was bought", async () => {
    const r = await run(floor);
    assert.equal(r.verified, true, JSON.stringify(r.checks, null, 1));
    assert.match(byId(r).spend.detail, /under the spend floor/);
    assert.match(byId(r).burn.detail, /nothing was bought/);
  });
  test("tampering fails the right line: memo units, Reading bytes, rules file, Treasury value, burn amount, failed tx, wrong program", async () => {
    const memoLine = (tx: Record<string, unknown>) => ((tx.meta as { logMessages: string[] }).logMessages);
    const r1 = await run(burned, { rpc: fakeRpc(burned, (tx) => { const l = memoLine(tx); const i = l.findIndex((x) => x.includes("Memo (len")); l[i] = l[i].replace("units=23", "units=24"); }) });
    assert.equal(r1.verified, false); assert.equal(byId(r1).reading.ok, false); assert.match(byId(r1).reading.detail, /units 23 ≠ memo 24/);
    const r2 = await run(burned, { rpc: fakeRpc(burned, (_tx, acc) => { const a = acc.value.find((x) => x && isAccount(BURN_RECEIPTS_IDL, "Reading", base64ToBytes(x.data[0])))!; const b = base64ToBytes(a.data[0]); b[92] ^= 1; a.data[0] = Buffer.from(b).toString("base64"); }) });
    assert.equal(r2.verified, false); assert.equal(byId(r2).reading.ok, false);
    const r3 = await run(burned, { rules: fs.readFileSync(path.join(ROOT, burned.rulesPath), "utf8").replace("0.01", "0.02") });
    assert.equal(byId(r3).rules.ok, false); assert.equal(r3.verified, false);
    const r4 = await run(burned, { source: treasury({ "2026-10-06": "40273024579219.18" }) });
    assert.equal(byId(r4).source.ok, false); assert.equal(r4.verified, false);
    const r5 = await run(burned, { rpc: fakeRpc(burned, (tx) => { const g = (tx.meta as { innerInstructions: { instructions: { data: string }[] }[] }).innerInstructions[0].instructions; const burn = g.find((ix) => { const d = b58decode(ix.data); return d && d[0] === 8 && d.length === 9; })!; const d = b58decode(burn.data)!; d[1] ^= 1; burn.data = b58encode(d); }) });
    assert.equal(byId(r5).burn.ok, false); assert.equal(r5.verified, false);
    const r6 = await run(burned, { rpc: fakeRpc(burned, (tx) => { (tx.meta as { err: unknown }).err = { InstructionError: [4, "Custom"] }; }) });
    assert.equal(byId(r6).tx.ok, false); assert.equal(r6.verified, false);
    const r7 = await checkReceiptTx({ signature: sigOf(burned), cluster: "devnet", programId: "11111111111111111111111111111111", rpc: fakeRpc(burned), rulesText: null, fetchSource: null });
    assert.equal(byId(r7).program.ok, false);
  });
  test("without a rules file or a source fetch, those lines are – (null) with the reason, and units fall back to the on-chain values", async () => {
    const r = await run(burned, { rules: null, source: null });
    assert.equal(byId(r).rules.ok, null); assert.match(byId(r).rules.detail, /on-chain hash is b9ad29b48ef1/);
    assert.equal(byId(r).source.ok, null); assert.match(byId(r).source.detail, /source_url_hash = sha256/);
    assert.equal(byId(r).units.ok, true); assert.match(byId(r).units.detail, /on-chain values/);
    assert.equal(r.verified, true, "the core checks (tx, program, memo, reading, units) passed");
  });
  test("a malformed signature is an input error (audit 4 BT-07: no checks, no failed verdict, no explorer link); a missing transaction fails the first line and stops", async () => {
    const bad = await checkReceiptTx({ signature: "not-a-signature", cluster: "devnet", programId: DEVNET_PROGRAM_ID, rpc: fakeRpc(burned), rulesText: null, fetchSource: null });
    assert.equal(bad.checks.length, 0); assert.equal(bad.inputError?.state, "malformed"); assert.equal(bad.facts.explorerUrl, null);
    const none = await checkReceiptTx({ signature: sigOf(burned), cluster: "devnet", programId: DEVNET_PROGRAM_ID, rpc: { call: async <T,>() => null as T }, rulesText: null, fetchSource: null });
    assert.equal(none.checks[0].ok, false); assert.equal(none.verified, false);
  });
  test("GET /v1/check/receipts/{signature} runs the same code on the server (injected RPC + source): same verdict; 400 on a bad signature", async () => {
    const res = await v1CheckReceipt(sigOf(burned), { rpc: fakeRpc(burned), fetchSource: treasury(), root: ROOT });
    const body = res.body as { verified: boolean; sample: { ticker: string } | null; ranOn: string };
    assert.equal(res.status, 200); assert.equal(body.verified, true); assert.equal(body.sample?.ticker, "DEFICIT"); assert.match(body.ranOn, /server/);
    assert.equal((await v1CheckReceipt("xyz")).status, 400);
  });
});

describe("the browser-safe helpers equal the Node references", () => {
  test("idlReader decodes the devnet Reading and TokenConfig exactly as idlCoder.decodeAccount does (pubkeys as base58)", () => {
    let n = 0;
    for (const f of FIX.receipts) for (const a of f.accounts.value) {
      if (!a) continue;
      const bytes = base64ToBytes(a.data[0]);
      for (const name of ["Reading", "TokenConfig"]) {
        if (!isAccount(BURN_RECEIPTS_IDL, name, bytes)) continue;
        const norm = (x: unknown): unknown => (x && typeof x === "object" && "toBase58" in (x as object) ? (x as { toBase58(): string }).toBase58() : x instanceof Uint8Array ? Array.from(x) : Array.isArray(x) ? x.map(norm) : x && typeof x === "object" ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, norm(v)])) : x);
        assert.deepEqual(norm(readAccount(BURN_RECEIPTS_IDL, name, bytes)), norm(decodeAccount(BURN_RECEIPTS_IDL, name, Buffer.from(bytes))), name);
        n++;
      }
    }
    assert.ok(n >= 4, `decoded ${n} accounts`);
    assert.throws(() => readAccount(BURN_RECEIPTS_IDL, "Reading", new Uint8Array(200)), /discriminator/);
  });
  test("the memo parser agrees with burnReceipts/memo.ts parseBuybackMemo on every devnet receipt memo, and memoFromLogs reads the logged one", () => {
    for (const s of samples.receipts) {
      const a = parseProgramMemo(s.memo), b = parseBuybackMemo(s.memo)!;
      assert.ok(a && b, s.memo);
      assert.deepEqual({ ...a }, { prefix: b.prefix, recordDate: b.recordDate, source: b.source, prev: b.prev, now: b.now, delta: b.delta, units: b.units, pool: b.pool, spent: b.spent, got: b.got, burn: b.burn, swap: b.swap, rulesSha12: b.rulesSha12 });
    }
    assert.equal(samples.receipts.length, 7, "2 $DEFICIT + 2 $PCA + 3 $PCB devnet receipts");
    assert.equal(parseProgramMemo("DEBT|2026-10-06|src=x|v1"), null);
    const logs = (burned.tx.meta as { logMessages: string[] }).logMessages;
    assert.match(memoFromLogs(logs)!, /^DEBT\|2026-10-06\|.*\|v2$/);
  });
  test("units, spend and formatting mirror burnReceipts/math.ts (random vectors)", () => {
    let seed = 7;
    const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed % n; };
    for (let i = 0; i < 300; i++) {
      const unit = BigInt(1 + rnd(1_000_000)), prev = BigInt(rnd(1_000_000_000)), now = prev + BigInt(rnd(5_000_000)) - BigInt(1_000_000), carry = BigInt(rnd(Number(unit)));
      const a = stepUnits(prev, now, carry, unit, 0), b = step(prev, now, carry, unit, 0);
      assert.equal(a.units, b.units); assert.equal(a.carryOut, b.carryOut);
      const pool = BigInt(rnd(2_000_000_000)), units = BigInt(rnd(60)), bps = 1 + rnd(10_000);
      assert.equal(ruleSpend(pool, units, bps), buybackSpend(pool, units, bps));
      const v = BigInt(rnd(1e9)) * BigInt(1e6) + BigInt(rnd(1e6));
      assert.equal(fixed(v, 2), formatFixed(v, 2)); assert.equal(tokens(v, 6), rawToTokens(v, 6));
    }
  });
  test("base58 round-trips and equals accounts.ts#bs58; signatures are recognised", () => {
    for (const s of samples.receipts) { const d = b58decode(s.signature)!; assert.equal(d.length, 64); assert.equal(b58encode(d), s.signature); assert.equal(bs58(d), s.signature); assert.ok(isSignature(s.signature)); }
    assert.equal(b58decode("0OIl"), null);
  });
  test("the verifier module is browser-safe: no node: imports, no Buffer, no web3.js", () => {
    for (const f of ["receiptCheck.ts", "idlReader.ts", "base58.ts", "copy.ts"]) {
      const src = fs.readFileSync(path.join(ROOT, "src", "lib", "burnticker", "trustpack", f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      assert.doesNotMatch(src, /from "node:|@solana\/web3\.js|\bBuffer\.(from|alloc|concat)/, f);
    }
  });
});
