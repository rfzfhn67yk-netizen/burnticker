// VERSION-1 TRANSACTIONS REACH EVERY READER ON THE LAUNCH PATH (Phantom v1 scope, step 0, 2026-10-19;
// docs/burnticker/phantom-v1-scope-2026-10-19.md "Readers pinned to version 0"). Once a browser launch lands as a v1 transaction
// (0x81 envelope, SIMD-0298), a reader that still asks the RPC for maxSupportedTransactionVersion 0 gets the -32015 refusal instead of
// the transaction, and a landed launch looks unlanded to the site. Two kinds of reader:
//   - @solana/web3.js Connection readers (launchVerify, draftReconciler, launchRecovery, programClient, programAdapter, trust): web3.js
//     1.99.0 parses the v1 JSON into MessageV1 and deserializes the 0x81 wire bytes. Here a real Connection runs over a fake fetch that
//     serves the devnet capture, and refuses with the RPC's own error whenever a reader still asks for version 0.
//   - raw JSON-RPC readers (trustpack receiptCheck, ledger, neverBuys; lifecycleDates): they parse the answer themselves, so each gets
//     a v1 fixture under test/fixtures/burnticker/ (the real devnet shape: version 1, a transactionConfig block inside the message,
//     signatures still under transaction.signatures).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Connection, Keypair, MessageV1, VersionedMessage, VersionedTransaction } from "@solana/web3.js";
import { connectionLaunchVerifier } from "@/lib/burnticker/launchVerify";
import { withSignerReads } from "@/lib/burnticker/draftReconciler";
import { chainReadDeps } from "@/lib/burnticker/launchRecovery";
import { web3ChainReader } from "@/lib/burnticker/trust";
import { checkReceiptTx, type Rpc } from "@/lib/burnticker/trustpack/receiptCheck";
import { readWalletHistory } from "@/lib/burnticker/trustpack/ledger";
import { runNeverBuys } from "@/lib/burnticker/trustpack/neverBuys";
import { sampleReceipts, DEVNET_PROGRAM_ID } from "@/lib/burnticker/trustpack/samples";
import { fetchTx, txView } from "@/lib/burnticker/lifecycleDates";
import { verifyCommands, verifyReceipt } from "@/lib/burnticker/history";
import { encodeV1Message } from "./burntickerV1Helpers.ts";

const ROOT = path.join(import.meta.dirname, "..");
const FIX = path.join(ROOT, "test", "fixtures", "burnticker");
const read = <T,>(f: string): T => JSON.parse(fs.readFileSync(path.join(FIX, f), "utf8")) as T;
type TxJson = { version: number; slot: number; blockTime: number; meta: { err: unknown; preBalances: number[]; postBalances: number[] }; transaction: { signatures: string[]; message: { accountKeys: string[]; header: { numRequiredSignatures: number }; transactionConfig: Record<string, unknown> } } };
const LEDGER = read<{ signature: string; wallet: string; getTransaction: TxJson; getParsedTransaction: Record<string, unknown>; errorWhenAskedForVersion0: string }>("v1-ledger-devnet.json");
const RECEIPT = read<{ ticker: string; recordDate: string; evidence: string; rulesPath: string; tx: TxJson; accounts: { value: unknown[] } }>("v1-receipt-check-devnet.json");
const NEVER = read<{ wallet: string; mint: string; expected: string; getTransaction: TxJson }>("v1-never-buys-devnet.json");
const TREASURY = JSON.parse(fs.readFileSync(path.join(ROOT, "test", "fixtures", "treasury-debt-to-penny-2024-12-to-2026-10-08.json"), "utf8")) as { data: { record_date: string; tot_pub_debt_out_amt: string }[] };

/** The RPC's answer to a reader still pinned to version 0 (JSON-RPC error -32015, the devnet text verbatim). */
const REFUSAL = /Transaction version \(1\) is not supported by the requesting client/;
const refuse = (method: string, params: unknown[]): void => {
  const o = params[1] as { maxSupportedTransactionVersion?: number } | undefined;
  if (method === "getTransaction" && (o?.maxSupportedTransactionVersion ?? -1) < 1) throw new Error(`${method}: ${LEDGER.errorWhenAskedForVersion0}`);
};

describe("the v1 shape, from devnet", () => {
  test("the fixtures are version 1: transactionConfig inside the message, signatures under transaction.signatures, no lookups", () => {
    for (const [name, t] of [["ledger", LEDGER.getTransaction], ["receipt", RECEIPT.tx], ["never-buys", NEVER.getTransaction]] as const) {
      assert.equal(t.version, 1, name);
      assert.deepEqual(Object.keys(t.transaction.message.transactionConfig).sort(), ["computeUnitLimit", "heapSize", "loadedAccountsDataSizeLimit", "priorityFee"], name);
      assert.ok(Array.isArray(t.transaction.signatures) && t.transaction.signatures.length >= 1, name);
      assert.ok(!("addressTableLookups" in t.transaction.message), `${name}: v1 carries no lookup tables`);
    }
    assert.equal(LEDGER.getTransaction.transaction.signatures[0], LEDGER.signature);
    assert.match(LEDGER.errorWhenAskedForVersion0, REFUSAL);
  });
  test("web3.js 1.99.0 deserializes a v1 message: 0x81 envelope on the wire, MessageV1 back from VersionedMessage.deserialize (and refuses to serialize one)", () => {
    const [creator, mint, program] = [Keypair.generate(), Keypair.generate(), Keypair.generate()];
    const fields = {
      header: { numRequiredSignatures: 2, numReadonlySignedAccounts: 1, numReadonlyUnsignedAccounts: 1 },
      staticAccountKeys: [creator.publicKey, mint.publicKey, program.publicKey],
      recentBlockhash: Keypair.generate().publicKey.toBase58(),
      compiledInstructions: [{ programIdIndex: 2, accountKeyIndexes: [0, 1], data: new Uint8Array([1, 2, 3]) }],
      transactionConfig: { computeUnitLimit: 400_000, heapSize: null, loadedAccountsDataSizeLimit: 262_144, priorityFee: 0 },
    };
    const wire = encodeV1Message(fields);
    assert.equal(wire[0], 0x81, "the version prefix: 0x80 | 1");
    assert.equal(VersionedMessage.deserializeMessageVersion(wire), 1);
    const back = VersionedMessage.deserialize(wire);
    assert.equal(back.version, 1);
    assert.deepEqual(back.staticAccountKeys.map((k) => k.toBase58()), [creator, mint, program].map((k) => k.publicKey.toBase58()));
    assert.deepEqual((back as MessageV1).transactionConfig, fields.transactionConfig);
    assert.deepEqual(back.header, fields.header);
    assert.equal(back.recentBlockhash, fields.recentBlockhash);
    assert.deepEqual(back.compiledInstructions, fields.compiledInstructions);
    assert.deepEqual(back.addressTableLookups, [], "v1 has no lookup tables");
    assert.equal(back.isAccountSigner(1), true); assert.equal(back.isAccountWritable(1), false, "the mint is a read-only signer");
    assert.throws(() => (back as MessageV1).serialize(), /Serialization of version 1 transaction messages is not supported/, "1.99.0 reads v1 only: the builder is step 1");
    // every config field present, and none: the mask bits
    const full = VersionedMessage.deserialize(encodeV1Message({ ...fields, transactionConfig: { computeUnitLimit: 1_400_000, heapSize: 65_536, loadedAccountsDataSizeLimit: 67_108_864, priorityFee: 12_345 } })) as MessageV1;
    assert.deepEqual(full.transactionConfig, { computeUnitLimit: 1_400_000, heapSize: 65_536, loadedAccountsDataSizeLimit: 67_108_864, priorityFee: 12_345 });
    const none = VersionedMessage.deserialize(encodeV1Message({ ...fields, transactionConfig: { computeUnitLimit: null, heapSize: null, loadedAccountsDataSizeLimit: null, priorityFee: null } })) as MessageV1;
    assert.deepEqual(none.transactionConfig, { computeUnitLimit: null, heapSize: null, loadedAccountsDataSizeLimit: null, priorityFee: null });
    // the wire transaction: signatures, then the 0x81 message. Deserializing works; signing or serializing does not (step 1's job)
    const wireTx = Uint8Array.from([2, ...new Uint8Array(64), ...new Uint8Array(64), ...wire]);
    const tx = VersionedTransaction.deserialize(wireTx);
    assert.equal(tx.message.version, 1); assert.equal(tx.signatures.length, 2);
    assert.throws(() => tx.sign([creator, mint]), /Serialization of version 1/);
  });
});

/** The fixture as a JSON-RPC endpoint: json → getTransaction, jsonParsed → getParsedTransaction, a batch → getTransactions. */
function fixtureFetch(log: string[] = []): typeof fetch {
  const answer = (req: { id: unknown; method: string; params: unknown[] }) => {
    log.push(req.method);
    try {
      refuse(req.method, req.params);
      if (req.method === "getTransaction") {
        const enc = (req.params[1] as { encoding?: string }).encoding ?? "json";
        return { jsonrpc: "2.0", id: req.id, result: req.params[0] === LEDGER.signature ? (enc === "jsonParsed" ? LEDGER.getParsedTransaction : LEDGER.getTransaction) : null };
      }
      throw new Error(`unexpected ${req.method}`);
    } catch (e) { return { jsonrpc: "2.0", id: req.id, error: { code: -32015, message: (e as Error).message } }; }
  };
  return async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as { id: unknown; method: string; params: unknown[] } | { id: unknown; method: string; params: unknown[] }[];
    return new Response(JSON.stringify(Array.isArray(body) ? body.map(answer) : answer(body)), { status: 200, headers: { "content-type": "application/json" } });
  };
}
/** A real web3.js Connection over the fixture endpoint. */
const fakeConnection = (log: string[] = []): Connection => new Connection("http://127.0.0.1:9/v1-fixture", { commitment: "confirmed", fetch: fixtureFetch(log) });

describe("Connection readers (web3.js 1.99.0 parses the v1 answer into MessageV1)", () => {
  test("getTransaction: the message is a MessageV1 with its static keys, header and transactionConfig; version 0 is refused by the RPC", async () => {
    const c = fakeConnection();
    const t = await c.getTransaction(LEDGER.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 1 });
    assert.ok(t); assert.equal(t.version, 1);
    assert.equal(t.transaction.message.version, 1);
    assert.deepEqual(t.transaction.message.staticAccountKeys.map((k) => k.toBase58()), LEDGER.getTransaction.transaction.message.accountKeys);
    assert.deepEqual((t.transaction.message as MessageV1).transactionConfig, LEDGER.getTransaction.transaction.message.transactionConfig);
    assert.equal(t.transaction.message.header.numRequiredSignatures, 1);
    await assert.rejects(c.getTransaction(LEDGER.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 }), REFUSAL, "the shape every reader hit before step 0");
  });
  test("launchVerify: the create confirmation reads a v1 transaction and judges its signers (a stranger's v1 transaction is 'not this coin's launch', never a 502)", async () => {
    const log: string[] = [];
    const v = connectionLaunchVerifier(fakeConnection(log), { burnProgramId: DEVNET_PROGRAM_ID });
    const r = await v.verify(LEDGER.signature, { mint: Keypair.generate().publicKey.toBase58(), creator: Keypair.generate().publicKey.toBase58(), draftCreatedAtMs: 0, rulesSha: "00", venue: { kind: "launchlab", platformId: null } });
    assert.equal(r.ok, false);
    assert.equal(r.status, 422, JSON.stringify(r));
    assert.equal(r.foreign, true, "the signers were read from the v1 message");
    assert.deepEqual(log, ["getTransaction"]);
  });
  test("draftReconciler withSignerReads: the batched signer read works on v1 messages (staticAccountKeys up to numRequiredSignatures)", async () => {
    const signers = await withSignerReads(fakeConnection()).signersOf!([LEDGER.signature, "1".repeat(87)]);
    assert.deepEqual(signers, [[LEDGER.wallet], null]);
  });
  test("launchRecovery chainReadDeps: the settle's history read answers the v1 transaction's outcome", async () => {
    const d = chainReadDeps(fakeConnection());
    assert.deepEqual(await d.getTransaction!(LEDGER.signature), { err: null });
    assert.equal(await d.getTransaction!("1".repeat(87)), null);
  });
  test("trust page web3ChainReader.lamportsDelta: the fee payer's change on a v1 transaction (MessageV1.getAccountKeys)", async () => {
    // the reader builds its own Connection over the global fetch (budgetedRpcConfig): route that to the fixture for the call
    const realFetch = globalThis.fetch;
    globalThis.fetch = fixtureFetch();
    try {
      const reader = await web3ChainReader("http://127.0.0.1:9/v1-fixture");
      const d = await reader.lamportsDelta(LEDGER.signature, LEDGER.wallet);
      // HB-122 (hourly run 10): the ledger's one counterparty rule (the largest opposite mover); a fee-only transaction has none
      assert.deepEqual(d, { delta: BigInt(-5000), counterparty: null, memo: null });
    } finally { globalThis.fetch = realFetch; }
  });
  test("programClient / programAdapter: getParsedTransaction (jsonParsed) of a v1 transaction parses, with its slot and no error", async () => {
    const c = fakeConnection();
    const t = await c.getParsedTransaction(LEDGER.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 1 });
    assert.ok(t); assert.equal(t.version, 1); assert.equal(t.slot, LEDGER.getTransaction.slot); assert.equal(t.meta?.err, null);
    assert.deepEqual(t.transaction.message.accountKeys.map((k) => k.pubkey.toBase58()), LEDGER.getTransaction.transaction.message.accountKeys);
    await assert.rejects(c.getParsedTransaction(LEDGER.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 }), REFUSAL);
  });
});

/** The raw JSON-RPC fake the trust pack readers call: refuses version 0 like the RPC, serves the fixture otherwise. */
const rawRpc = (over: Record<string, (params: unknown[]) => unknown>, log: string[] = []): Rpc => ({
  async call<T>(method: string, params: unknown[]): Promise<T> {
    log.push(method);
    refuse(method, params);
    const fn = over[method];
    if (!fn) throw new Error(`unexpected ${method}`);
    return fn(params) as T;
  },
});

describe("raw JSON-RPC readers (one v1 fixture each)", () => {
  test("receiptCheck: the $DEFICIT receipt re-enveloped as v1 passes all ten checks", async () => {
    const samples = sampleReceipts(ROOT);
    const signature = samples.receipts.find((r) => r.evidence === RECEIPT.evidence && r.recordDate === RECEIPT.recordDate)!.signature;
    const log: string[] = [];
    const rpc = rawRpc({ getTransaction: () => RECEIPT.tx, getMultipleAccounts: () => RECEIPT.accounts }, log);
    const treasury = async (url: string) => { const d = /record_date:eq:(\d{4}-\d{2}-\d{2})/.exec(url)?.[1]; return { ok: true, status: 200, json: async () => ({ data: TREASURY.data.filter((r) => r.record_date === d) }) }; };
    const r = await checkReceiptTx({ signature, cluster: "devnet", programId: DEVNET_PROGRAM_ID, rpc, rulesText: fs.readFileSync(path.join(ROOT, RECEIPT.rulesPath), "utf8"), fetchSource: treasury });
    assert.equal(r.verified, true, JSON.stringify(r.checks, null, 1));
    assert.deepEqual(r.checks.map((c) => [c.id, c.ok]), [["tx", true], ["program", true], ["memo", true], ["reading", true], ["config", true], ["rules", true], ["source", true], ["units", true], ["spend", true], ["burn", true]]);
    assert.deepEqual(log.slice(0, 2), ["getTransaction", "getMultipleAccounts"]);
  });
  test("ledger readWalletHistory: the real devnet v1 transaction books the fee payer's −5,000 lamports", async () => {
    const sigs = [{ signature: LEDGER.signature, slot: LEDGER.getTransaction.slot, blockTime: LEDGER.getTransaction.blockTime, err: null }];
    const h = await readWalletHistory(rawRpc({ getSignaturesForAddress: () => sigs, getTransaction: (p) => (p[0] === LEDGER.signature ? LEDGER.getTransaction : null), getBalance: () => ({ value: 670_425_000 }) }), LEDGER.wallet);
    assert.deepEqual(h.entries.map((e) => [e.signature, e.deltaLamports, e.direction, e.err]), [[LEDGER.signature, "-5000", "out", false]]);
    assert.equal(h.complete, true);
  });
  test("neverBuys: a coin received in a v1 transaction is 'received' (the token balances are read from the v1 answer)", async () => {
    const OP = NEVER.wallet, MINT = NEVER.mint, ATA = "4VcsuCXw3sQqWm4Sv36X7hwkup9owSXcjThwSibtCTzk";
    const rpc = rawRpc({
      getTokenAccountsByOwner: (p) => ({ value: (p[1] as { programId: string }).programId.startsWith("Tokenkeg") ? [{ pubkey: ATA, account: { data: { parsed: { info: { mint: MINT, owner: OP, tokenAmount: { amount: "7" } } } } } }] : [] }),
      getSignaturesForAddress: () => [{ signature: LEDGER.signature }],
      getTransaction: (p) => (p[0] === LEDGER.signature ? NEVER.getTransaction : null),
    });
    const r = await runNeverBuys({ rpc, cluster: "devnet", wallets: [{ role: "keeper", pubkey: OP }], mints: [{ symbol: "DEFICIT", mint: MINT }], evidence: new Map(), now: 0 });
    assert.equal(NEVER.expected, "received"); assert.equal(r.status, "holding");   // ACC-02 (2026-10-19): it still holds the 7 units, a finding
    assert.deepEqual(r.acquisitions.map((a) => [a.signature, a.amountRaw, a.how]), [[LEDGER.signature, "7", "received"]]);
    assert.deepEqual(r.errors, []);
  });
  test("lifecycleDates: txView reads the v1 answer; fetchTx asks again with the version the RPC names", async () => {
    const v = txView(LEDGER.getTransaction);
    assert.ok(v); assert.equal(v.slot, LEDGER.getTransaction.slot); assert.ok(v.keys.has(LEDGER.wallet));
    const log: string[] = [];
    const t = await fetchTx(rawRpc({ getTransaction: () => LEDGER.getTransaction }, log), LEDGER.signature);
    assert.equal(t?.slot, LEDGER.getTransaction.slot);
    assert.deepEqual(log, ["getTransaction", "getTransaction"], "version 0 refused, then version 1");
  });
  test("history: the curl the verify page prints asks for version 1", () => {
    const c = verifyCommands(verifyReceipt(ROOT)).find((x) => x.id === "tx")!;
    assert.match(c.command, /"maxSupportedTransactionVersion":1\}/);
  });
});
