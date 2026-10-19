// CONTINUOUS AUDIT 2026-10-19 ACC-02: THE OPERATOR MONITOR SAID "CLEAR" ON PARTIAL EVIDENCE. It read recent history only, skipped a
// wallet whose read failed and a transaction the node returned as null, ignored a coin a wallet already held, and left out the disclosed
// mainnet REHEARSAL purchase, then said "No operator wallet holds or has received a platform coin." Now the report carries its scope
// (how many transactions, back to when), what could not be read, and the named exception; a partial read is "incomplete", a current
// holding is a finding, and a stale run is not shown as current.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { neverBuysExceptions, neverBuysScopeLine, runNeverBuys, type NeverBuysException } from "@/lib/burnticker/trustpack/neverBuys";
import { neverBuysView, NEVER_BUYS_STALE_MS } from "@/lib/burnticker/trustpack/api";
import { NEVER_BUYS_STATUS } from "@/lib/burnticker/trustpack/copy";
import type { Rpc } from "@/lib/burnticker/trustpack/receiptCheck";
import { lintCopy } from "@/lib/launch/copyLint";

const OP = "D8seUoC1RZUs7918Atcc7TbFwRf1khqFvPdjkB4qktbn", OP2 = "Bfy67FZExj33ihNN9HDEH9KwLAPR6kW9tWAzvdXqssvx";
const MINT = "4QnwyiBMm2Caz5tJr9hNGzT2wqZcMipZjFHiSBu7AM4F", ATA = "4VcsuCXw3sQqWm4Sv36X7hwkup9owSXcjThwSibtCTzk";
const REHEARSAL = "FwXiFscFSYXzvPVzV4rCw4UBcGDhT53xHDpsL3pVpzkp", RATA = "9t2bzymyAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const BUY = { message: { accountKeys: [OP, "DRay6fNdQ5J82H7xV6uq2aV3mNrUZ1J4PgSKsWgptcm6"], header: { numRequiredSignatures: 1 }, instructions: [{ programIdIndex: 1 }] } };
const bal = (mint: string, amt: string) => [{ mint, owner: OP, uiTokenAmount: { amount: amt } }];
const EXC: NeverBuysException[] = [{ symbol: "REHEARSAL", mint: REHEARSAL, note: "the operator's disclosed $REHEARSAL test purchase" }];

/** A scripted RPC: per wallet, its coin accounts (mint, amount) and their signatures, its own recent signatures, and the transactions. */
function rpc(o: { accounts?: Record<string, { pubkey: string; mint: string; amount: string; sigs: string[] }[]>; recent?: Record<string, string[]>; txs?: Record<string, unknown>; failWallet?: string }): Rpc {
  return {
    async call<T>(m: string, params: unknown[]): Promise<T> {
      const who = params[0] as string;
      if (o.failWallet && who === o.failWallet) throw new Error("429 rate limited");
      if (m === "getTokenAccountsByOwner") return { value: (params[1] as { programId: string }).programId.startsWith("Tokenkeg") ? (o.accounts?.[who] ?? []).map((a) => ({ pubkey: a.pubkey, account: { data: { parsed: { info: { mint: a.mint, owner: who, tokenAmount: { amount: a.amount } } } } } })) : [] } as T;
      if (m === "getSignaturesForAddress") { const acc = Object.values(o.accounts ?? {}).flat().find((a) => a.pubkey === who); return (acc ? acc.sigs : o.recent?.[who] ?? []).map((signature) => ({ signature })) as T; }
      if (m === "getTransaction") return (o.txs?.[who] ?? null) as T;
      throw new Error(m);
    },
  };
}
const base = { cluster: "mainnet", mints: [{ symbol: "DEFICIT", mint: MINT }], evidence: new Map<string, string>(), now: Date.UTC(2026, 9, 19) };

describe("ACC-02: the monitor says what it checked, and never 'clear' on partial evidence", () => {
  test("nothing found: 'clear' says it is a recent-history check, with its scope", async () => {
    const r = await runNeverBuys({ ...base, wallets: [{ role: "keeper", pubkey: OP }], rpc: rpc({ txs: { s1: { blockTime: 1_760_000_000, meta: { err: null } } }, recent: { [OP]: ["s1"] } }) });
    assert.equal(r.status, "clear"); assert.equal(r.line, NEVER_BUYS_STATUS.clear);
    assert.equal(r.line, "No unexplained purchases were found in the transactions checked. This checks recent history only, not every transaction the wallets ever made.");
    assert.deepEqual([r.scope!.transactions, r.scope!.since, r.scope!.recentHistoryOnly, r.scope!.perTokenAccount, r.scope!.recentPerWallet], [1, new Date(1_760_000_000_000).toISOString(), true, 100, 25]);
    assert.match(neverBuysScopeLine(r), /^Checked 1 wallet and 1 listed coin: 1 transaction, the last 100 for each coin account and the last 25 for each wallet\. This checks recent history only, not every transaction the wallets ever made\.$/);
  });
  test("one wallet read fails (a 429) while the other is empty: 'incomplete', never 'clear', and the wallet is named", async () => {
    const r = await runNeverBuys({ ...base, wallets: [{ role: "keeper", pubkey: OP }, { role: "payer", pubkey: OP2 }], rpc: rpc({ failWallet: OP2 }) });
    assert.equal(r.status, "incomplete"); assert.equal(r.line, NEVER_BUYS_STATUS.incomplete);
    assert.deepEqual(r.incomplete!.wallets, ["payer"]);
    assert.match(neverBuysScopeLine(r), /Not read: 1 wallet\. No conclusion is available for those records\./);
  });
  test("a transaction the node returns as null: 'incomplete', with the signature counted", async () => {
    const r = await runNeverBuys({ ...base, wallets: [{ role: "keeper", pubkey: OP }], rpc: rpc({ recent: { [OP]: ["gone"] }, txs: {} }) });
    assert.equal(r.status, "incomplete"); assert.deepEqual(r.incomplete!.nullTransactions, ["gone"]);
    assert.ok(r.errors.some((e) => /1 transaction could not be read/.test(e)));
  });
  test("a coin held now, acquired before the transactions checked: a finding, not 'clear'", async () => {
    const r = await runNeverBuys({ ...base, wallets: [{ role: "keeper", pubkey: OP }], rpc: rpc({ accounts: { [OP]: [{ pubkey: ATA, mint: MINT, amount: "1000000", sigs: [] }] } }) });
    assert.equal(r.acquisitions.length, 0, "no recent acquisition");
    assert.equal(r.status, "holding"); assert.equal(r.line, NEVER_BUYS_STATUS.holding);
    // an empty account (balance zero) is not a holding
    const z = await runNeverBuys({ ...base, wallets: [{ role: "keeper", pubkey: OP }], rpc: rpc({ accounts: { [OP]: [{ pubkey: ATA, mint: MINT, amount: "0", sigs: [] }] } }) });
    assert.equal(z.status, "clear");
  });
  test("an older purchase outside the window does not make the result a lifetime claim; a full window is counted", async () => {
    const sigs = Array.from({ length: 3 }, (_, k) => `old${k}`);
    const txs = Object.fromEntries(sigs.map((s, k) => [s, { blockTime: 1_750_000_000 + k, meta: { err: null } }]));
    const r = await runNeverBuys({ ...base, wallets: [{ role: "keeper", pubkey: OP }], recentPerWallet: 3, rpc: rpc({ recent: { [OP]: sigs }, txs }) });
    assert.equal(r.status, "clear"); assert.equal(r.scope!.windowsFull, 1, "the wallet's window was full: older history was not read");
    assert.match(r.line, /recent history only/);
  });
  test("the disclosed mainnet REHEARSAL purchase is in scope and named: explained, its holding is not a finding", async () => {
    const txs = { rbuy: { blockTime: 1_760_200_000, transaction: BUY, meta: { err: null, preTokenBalances: bal(REHEARSAL, "0"), postTokenBalances: bal(REHEARSAL, "123456") } } };
    const r = await runNeverBuys({ ...base, wallets: [{ role: "keeper", pubkey: OP }], exceptions: EXC, rpc: rpc({ accounts: { [OP]: [{ pubkey: RATA, mint: REHEARSAL, amount: "123456", sigs: ["rbuy"] }] }, txs }) });
    assert.ok(r.mints.some((m) => m.mint === REHEARSAL), "the rehearsal coin is in the scanned list");
    assert.equal(r.status, "explained"); assert.equal(r.line, NEVER_BUYS_STATUS.explained);
    assert.match(r.acquisitions[0].explainedBy!, /disclosed exception/);
    assert.deepEqual(r.exceptions, EXC);
    assert.match(neverBuysScopeLine(r), /The disclosed \$REHEARSAL purchase is a named exception/);
    // without the exception the same purchase is red
    const red = await runNeverBuys({ ...base, mints: [...base.mints, { symbol: "REHEARSAL", mint: REHEARSAL }], wallets: [{ role: "keeper", pubkey: OP }], rpc: rpc({ accounts: { [OP]: [{ pubkey: RATA, mint: REHEARSAL, amount: "123456", sigs: ["rbuy"] }] }, txs }) });
    assert.equal(red.status, "red");
  });
  test("the keeper reads the exception from transparency.json; Trust shows the scope; a stale report is not shown as current", async () => {
    assert.deepEqual(neverBuysExceptions().map((x) => [x.symbol, x.mint]), [["REHEARSAL", REHEARSAL]]);
    const keeper = fs.readFileSync("scripts/burnticker-keeper.mts", "utf8");
    assert.match(keeper, /const exceptions = cluster === "mainnet" \? neverBuysExceptions\(process\.cwd\(\)\) : \[\];/);
    const r = await runNeverBuys({ ...base, wallets: [{ role: "keeper", pubkey: OP }], rpc: rpc({}) });
    const fresh = neverBuysView({ rule: "r", rehearsalNote: "n" }, r, base.now + 3_600_000);
    assert.equal(fresh.status, "clear"); assert.equal(fresh.stale, false); assert.ok(fresh.scopeLine);
    const old = neverBuysView({ rule: "r", rehearsalNote: "n" }, r, base.now + NEVER_BUYS_STALE_MS + 1);
    assert.equal(old.status, "incomplete"); assert.equal(old.line, NEVER_BUYS_STATUS.stale);
    const section = fs.readFileSync("src/app/burnticker/trust/TrustPackSection.tsx", "utf8");
    assert.match(section, /data-never-buys-scope>\{op\.neverBuys\.scopeLine\}/);
    assert.match(fs.readFileSync("src/app/burnticker/operator/page.tsx", "utf8"), /data-never-buys-scope>\{v\.neverBuys\.scopeLine\}/);
    for (const s of Object.values(NEVER_BUYS_STATUS)) assert.deepEqual(lintCopy(s).hits, [], s);
    assert.deepEqual(lintCopy(neverBuysScopeLine({ ...r, exceptions: EXC, incomplete: { wallets: ["payer"], nullTransactions: ["x"] } })).hits, []);
    assert.doesNotMatch(JSON.parse(fs.readFileSync("config/burnticker/operator.json", "utf8")).neverBuys.rehearsalNote, /On mainnet, any acquisition turns the status line red/);
  });
});
