// @burnticker/sdk (2026-10-09) — the public SDK surface on the fakes: rules (validate / canonical / sha256 = the platform's hash),
// fees.split, the launch bundle end to end through the real v1 handlers (mint keypair generated locally, only its public key sent;
// the response re-checked; mint co-signature; mainnet refused unless allowMainnet), token reads, receipt verification from the
// source + chain on the caller's machine (and a tampered receipt failing), the permissionless crank transaction from program
// accounts, and program events / API polling through subscribe().
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  Burnticker, BurntickerApiError, rules, fees, feePdaFor, verifyReceipt, crank, subscribe, decodeEventData, EVENT_IX_TAG, buildLaunchBundleOffline, FakeBurnProgram, FakeLaunchLab, compileUnsigned, PLACEHOLDER_PROGRAM_ID,
  type BurntickerEvent,
} from "../packages/burnticker-sdk/src/index.ts";
import { DEFAULT_ON_END, lockRule } from "@/lib/burnticker/rules";
import { BURN_RECEIPTS_IDL } from "@/lib/burnReceipts/idl";
import { encodeType } from "@/lib/burnReceipts/idlCoder";
import { configPda, readingPda, vaultAddress } from "@/lib/burnReceipts/pda";
import { MODE_VAULT } from "@/lib/burnReceipts/constants";
import { base58Encode } from "@/lib/burnKeeper/solana";
import { API, BLOCKHASH, CREATOR, FakeConnection, MAINNET_GENESIS, encodeAccount, makeWorld, programReceiptTx, routeFetch, upstreamFetch, zeroOf, type World } from "./burntickerApiHelpers.ts";
import { BRONCOS, DENVER_HIGH, NOW } from "./burntickerHelpers.ts";

let w: World;
before(async () => { w = await makeWorld(); });
const client = (o: ConstructorParameters<typeof Burnticker>[0] = {}) => new Burnticker({ apiBase: API, fetch: routeFetch, ...o });

describe("rules + fees (local, no network)", () => {
  test("compose(selector, mapping) → the same canonical bytes and sha256 the platform locks", () => {
    const r = rules.compose({ series: "KXNFLGAME", filter: { tickerIncludes: "-DEN" } }, { kind: "binary", binary: { onYes: { fractionOfPool: 0.02 } } });
    assert.equal(rules.sha256(r), lockRule(BRONCOS).sha256);
    assert.equal(rules.canonical(r), lockRule(BRONCOS).text);
    assert.equal(rules.sha256({ series: "KXNFLGAME", filter: { tickerIncludes: "-DEN" } }, { kind: "binary", binary: { onYes: { fractionOfPool: 0.02 } } }), lockRule(BRONCOS).sha256, "(selector, mapping) form");
    assert.match(rules.receiptFormat("bronco", r), /^BT\|BRONCO\|.*\|rules=sha256:[0-9a-f]{12}\|v3$/);
    assert.ok(rules.statement(BRONCOS).includes("KXNFLGAME"));
  });
  test("validate lists every problem and never throws; fromText refuses a non-canonical rules.json", () => {
    const v = rules.validate({ ...BRONCOS, floorUsd: 1, binary: { onYes: { fractionOfPool: 0.5 } } });
    assert.equal(v.ok, false);
    if (!v.ok) assert.ok(v.problems.length >= 2);
    assert.equal(rules.validate(DENVER_HIGH).ok, true);
    assert.throws(() => rules.fromText(JSON.stringify(BRONCOS)), /canonical/);
  });
  test("fees.split: curve 25 + 25 + 50 bps; per 1 SOL in lamports, fractional bps exact; creators get 0", () => {
    const s = fees.split({ volumeSol: "1" });
    assert.equal(s.totalBps, 100); assert.equal(s.creatorSliceBps, 0);
    assert.deepEqual(s.amounts!.map((a) => a.lamports), ["2500000", "2500000", "5000000"]);
    const post = fees.split({ phase: "post-graduation", volumeSol: "2" });
    assert.equal(post.amounts!.find((a) => a.label === "burn pool")!.lamports, "950000", "4.75 bps of 2 SOL");
    assert.throws(() => fees.split({ volumeSol: "abc" }));
  });
  test("feePdaFor = burn_receipts [\"fee\", mint] — the same address the bundle records as LaunchLab's creator", () => {
    const mint = Keypair.generate().publicKey;
    assert.equal(feePdaFor(PLACEHOLDER_PROGRAM_ID, mint).toBase58(), new FakeBurnProgram().feePdaFor(mint.toBase58()));
    assert.equal(client({ programId: PLACEHOLDER_PROGRAM_ID }).feePdaFor(mint).toBase58(), feePdaFor(PLACEHOLDER_PROGRAM_ID, mint).toBase58());
    assert.throws(() => client().feePdaFor(mint), /programId/);
  });
});

describe("reads through the API", () => {
  test("catalogue, kalshi.search / series / backtest, tokens, token (next burn + implied chance), receipts, trust, openapi", async () => {
    const bt = client();
    const cat = await bt.catalogue();
    assert.ok(cat.sources.some((s) => s.id === "treasury.debt" && s.tier === 4));
    assert.equal((await bt.kalshi.search("nfl", { category: "Sports" })).results[0].ticker, "KXNFLGAME");
    assert.equal((await bt.kalshi.series("KXHIGHDEN")).series.ticker, "KXHIGHDEN");
    const b = await bt.kalshi.backtest({ series: "KXNFLGAME", filter: { tickerIncludes: "-DEN" } }, { kind: "binary", binary: { onYes: { fractionOfPool: 0.02 } } });
    assert.equal(b.sha256, lockRule(BRONCOS).sha256); assert.ok(b.matched > 0);
    assert.equal((await bt.tokens({ status: "live" })).total, 2);
    const t = await bt.token("BRONCO");
    assert.equal(t.mint, w.bronco.mint); assert.equal(t.receipts.length, 2); assert.ok("impliedChance" in t); assert.equal(t.nextBurn, t.status.next);
    assert.equal((await bt.receipts(w.bronco.mint)).ticker, "BRONCO");
    assert.equal((await bt.trust()).fees.designed.devFeeBps, 25);
    assert.equal((await bt.openapi()).openapi, "3.1.0");
    assert.equal((await bt.verifyOnServer("BRONCO", "KXNFLGAME-26SEP27LARDEN-DEN")).verified, true);
    const v = await bt.validateRemote({ nope: true });
    assert.equal(v.ok, false); assert.ok(v.problems!.length > 0);
  });
  test("errors are typed: 404 → BurntickerApiError with status; no apiBase → a clear error", async () => {
    await assert.rejects(client().token("NOPE"), (e: unknown) => e instanceof BurntickerApiError && e.status === 404);
    assert.throws(() => new Burnticker().catalogue(), /apiBase/);
  });
});

describe("buildLaunchBundle", () => {
  test("end to end: local mint keypair (only the public key sent), rule hash re-checked, fresh blockhash from OUR RPC, mint co-signed, creator unsigned; confirm takes it live", async () => {
    const conn = new FakeConnection();
    const bt = client({ connection: conn as never, programId: PLACEHOLDER_PROGRAM_ID });
    const wallet = Keypair.generate();
    const sent: string[] = [];
    const spy = new Burnticker({ apiBase: API, connection: conn as never, programId: PLACEHOLDER_PROGRAM_ID, fetch: async (url, init) => { if (init?.body) sent.push(init.body); return routeFetch(url, init); } });
    const r = await spy.buildLaunchBundle({ wallet: wallet.publicKey, selector: { series: "KXHIGHDEN" }, rule: { kind: "scalar", scalar: { unit: 1, perUnit: { fractionOfPool: 0.01 }, baseline: 80, direction: "up" } }, metadata: { ticker: "hotden", name: "Hot Denver" }, acknowledgements: { ruleLocked: true, noReturns: true } });
    assert.equal(r.rulesSha256, lockRule({ ...DENVER_HIGH, onEnd: DEFAULT_ON_END }).sha256, "the SDK adds the onEnd wind-down the server adds (API 1.4.0)");
    assert.equal(r.feePda, feePdaFor(PLACEHOLDER_PROGRAM_ID, r.mint).toBase58());
    assert.equal(r.review.burnPoolAuthority, r.feePda);
    assert.match(r.receiptFormat, /^BT\|HOTDEN\|/);
    assert.equal(r.blockhash, BLOCKHASH); assert.equal(r.blockhashPlaceholder, false);
    assert.equal(r.ready, false, "the fakes are not signable on a cluster; the bundle says so");
    const secret = base58Encode(r.mintKeypair.secretKey);
    assert.ok(sent.every((b) => !b.includes(secret)), "the mint secret never left this process");
    assert.ok(sent.some((b) => b.includes(r.mint.toBase58())));
    const tx = r.transactions[0];
    assert.equal(tx.feePayer!.toBase58(), wallet.publicKey.toBase58());
    const sigs = Object.fromEntries(tx.signatures.map((s) => [s.publicKey.toBase58(), s.signature !== null]));
    assert.equal(sigs[r.mint.toBase58()], true, "co-signed by the mint");
    assert.equal(sigs[wallet.publicKey.toBase58()], false, "the creator's wallet signs, not the SDK");
    tx.partialSign(wallet);
    assert.ok(tx.verifySignatures(), "creator + mint signatures complete the transaction");
    assert.equal(w.registry.token(r.mint.toBase58())!.status, "draft");
    const c = await bt.confirmLaunch(r.mint, "4".repeat(88));
    assert.equal(c.status, "live");
    void bt;
  });
  test("an invalid rule fails locally before any request; mainnet refused unless allowMainnet (API cluster and RPC genesis)", async () => {
    let calls = 0;
    const bt = new Burnticker({ apiBase: API, fetch: async (u, i) => { calls++; return routeFetch(u, i); } });
    await assert.rejects(bt.buildLaunchBundle({ wallet: CREATOR, rule: { ...BRONCOS, floorUsd: 1 }, metadata: { ticker: "BAD", name: "bad" }, acknowledgements: { ruleLocked: true, noReturns: true } }), /floorUsd/);
    assert.equal(calls, 0);
    const main = new FakeConnection(); main.genesis = MAINNET_GENESIS;
    await assert.rejects(client({ connection: main as never }).buildLaunchBundle({ wallet: CREATOR, rule: BRONCOS, metadata: { ticker: "MAIN", name: "main" }, acknowledgements: { ruleLocked: true, noReturns: true } }), /mainnet/);
    // An API that answers with a mainnet bundle is refused too.
    const liar = new Burnticker({ apiBase: API, fetch: async (u, i) => { const r = await routeFetch(u, i); if (!u.endsWith("/launch/bundle")) return r; const b = await r.json() as Record<string, unknown>; return { ok: true, status: 200, json: async () => ({ ...b, cluster: "mainnet" }) }; } });
    await assert.rejects(liar.buildLaunchBundle({ wallet: CREATOR, rule: BRONCOS, metadata: { ticker: "LIAR", name: "liar" }, acknowledgements: { ruleLocked: true, noReturns: true }, register: false }), /MAINNET/);
  });
  test("a server that swaps the rule or slips in another signer is refused", async () => {
    const tamper = (f: (b: Record<string, unknown>) => void) => new Burnticker({ apiBase: API, fetch: async (u, i) => { const r = await routeFetch(u, i); if (!u.endsWith("/launch/bundle")) return r; const b = await r.json() as Record<string, unknown>; f(b); return { ok: true, status: 200, json: async () => b }; } });
    const opts = { wallet: CREATOR, rule: BRONCOS, metadata: { ticker: "TMPR", name: "tamper" }, acknowledgements: { ruleLocked: true as const, noReturns: true as const }, register: false };
    await assert.rejects(tamper((b) => { (b.review as { rules: { sha256: string } }).rules.sha256 = "0".repeat(64); }).buildLaunchBundle(opts), /rule hash/);
    await assert.rejects(tamper((b) => { (b.transactions as { instructions: { keys: { pubkey: string; isSigner: boolean }[] }[] }[])[0].instructions[0].keys.push({ pubkey: Keypair.generate().publicKey.toBase58(), isSigner: true, isWritable: false } as never); }).buildLaunchBundle(opts), /asks .* to sign/);
  });
  test("offline: the platform's own builder on the fakes + compileUnsigned (dry runs without the API)", async () => {
    const mint = Keypair.generate().publicKey.toBase58();
    const b = await buildLaunchBundleOffline({ creator: CREATOR, ticker: "DRY", name: "dry run", description: "", imageUrl: null, links: [], rule: BRONCOS, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true }, cluster: "devnet" }, { program: new FakeBurnProgram("devnet"), launchLab: new FakeLaunchLab(), devFeeWallet: null, attesters: [], quorum: 1, metadataUri: (m) => `https://x/${m}`, mint });
    assert.equal(b.mintSecretKey, null);
    assert.equal(b.burnPoolAuthority, feePdaFor(PLACEHOLDER_PROGRAM_ID, mint).toBase58());
    const u = compileUnsigned(b.transactions, CREATOR, BLOCKHASH);
    assert.equal(u[0].recentBlockhash, BLOCKHASH); assert.equal(u[0].blockhashPlaceholder, false);
    await assert.rejects(buildLaunchBundleOffline({ creator: CREATOR, ticker: "MAIN", name: "main", description: "", imageUrl: null, links: [], rule: BRONCOS, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true }, cluster: "mainnet" }, { program: new FakeBurnProgram("mainnet"), launchLab: new FakeLaunchLab(), devFeeWallet: null, attesters: [], quorum: 1, metadataUri: (m) => m, mint }), /mainnet is refused/);
  });
});

describe("verifyReceipt (on the caller's machine)", () => {
  // review N3: the chain check needs the burn program's own instruction (Memo CPI + burn on the mint) and its processed Reading
  const chainFor = (memo: string, sig: string) => { const c = new FakeConnection(); c.txs.set(sig, programReceiptTx(c, { programId: PLACEHOLDER_PROGRAM_ID, mint: w.bronco.mint, memo, burnedRaw: BigInt(1) })); return c; };
  const prov = () => ({ programId: PLACEHOLDER_PROGRAM_ID, mint: w.bronco.mint });
  test("a Kalshi receipt: source re-read from Kalshi, units, spend formula, memo on chain — all green", async () => {
    const t = await client().token("BRONCO");
    const r = t.receipts.find((x) => x.status === "confirmed")!;
    const v = await verifyReceipt(r, { ticker: "BRONCO", rulesText: t.rulesText, fetch: upstreamFetch, connection: chainFor(r.memo!, r.signature!) as never, ...prov(), now: NOW });
    assert.equal(v.verified, true, JSON.stringify(v.checks));
    assert.deepEqual(v.checks.map((c) => [c.id, c.ok]), [["rules", true], ["memo", true], ["source", true], ["units", true], ["spend", true], ["chain", true]]);
    // The client's convenience form fetches the receipt + rules itself.
    const v2 = await client({ fetch: routeFetch, connection: chainFor(r.memo!, r.signature!) as never, programId: PLACEHOLDER_PROGRAM_ID }).verifyReceipt("BRONCO", { eventId: r.eventId, now: NOW });
    assert.equal(v2.verified, true);
  });
  test("tampering fails the right check: units, a different memo on chain, a source that disagrees, a swapped rules.json", async () => {
    const t = await client().token("BRONCO");
    const r = t.receipts.find((x) => x.status === "confirmed")!;
    const base = { ticker: "BRONCO", rulesText: t.rulesText, fetch: upstreamFetch, now: NOW };
    const bad = (v: Awaited<ReturnType<typeof verifyReceipt>>) => v.checks.filter((c) => c.ok === false).map((c) => c.id);
    // A program receipt (2026-10-10): the spend belongs to the reading (checked against the memo's unit count), so units tampering fails memo + units.
    assert.deepEqual(bad(await verifyReceipt({ ...r, units: 3 }, base)), ["memo", "units"]);
    assert.deepEqual(bad(await verifyReceipt(r, { ...base, ...prov(), connection: chainFor(`${r.memo!} `, r.signature!) as never })), ["chain"]);
    const flipped = await verifyReceipt({ ...r, result: "no" }, { ...base, fetch: false });
    assert.ok(bad(flipped).includes("units"), "the program's memo carries no result field: a flipped result fails the unit recomputation (and the source check when fetched)");
    const other = await verifyReceipt(r, { ...base, rulesText: lockRule({ ...BRONCOS, binary: { onYes: { fractionOfPool: 0.03 }, onNo: null } }).text });
    assert.ok(bad(other).includes("rules")); assert.equal(other.verified, false);
    const noSource = await verifyReceipt(r, { ...base, fetch: async () => ({ ok: false, status: 503, json: async () => ({}) }) });
    assert.equal(noSource.checks.find((c) => c.id === "source")!.ok, null, "an unreachable source is 'not checked', never a pass");
  });
  test("a catalogue receipt is re-read from the feed's own published request (config from /catalogue)", async () => {
    const v = await client({ fetch: routeFetch }).verifyReceipt("DEFICIT2", { eventId: "2026-10-08", now: NOW });
    assert.equal(v.checks.find((c) => c.id === "source")!.ok, true, JSON.stringify(v.checks));
    assert.equal(v.verified, true);
  });
});

describe("crank (permissionless) from program accounts", () => {
  const programId = Keypair.generate().publicKey;
  const mint = Keypair.generate().publicKey;
  const world = () => {
    const c = new FakeConnection();
    const config = configPda(programId, mint);
    c.accounts.set(config.toBase58(), { owner: programId, lamports: 1, data: encodeAccount("TokenConfig", (v) => { v.mint = mint; (v.rule as Record<string, unknown>).mode = MODE_VAULT; v.crank_cursor = 20261001; }) });
    return { c, config };
  };
  test("vault reading in line → an unsigned crank_vault transaction, fee payer = the cranker; nothing in line → idle", async () => {
    const { c, config } = world();
    const cranker = Keypair.generate().publicKey;
    assert.equal((await crank(mint, cranker, { connection: c as never, programId, cluster: "devnet" })).status, "idle");
    c.accounts.set(readingPda(programId, config, 20261002).toBase58(), { owner: programId, lamports: 1, data: encodeAccount("Reading", (v) => { v.config = config; v.record_date = 20261002; v.prev_date = 20261001; v.units = BigInt(2); }) });
    const plan = await crank(mint, cranker, { connection: c as never, programId, cluster: "devnet" });
    assert.equal(plan.status, "ready");
    if (plan.status !== "ready") return;
    assert.equal(plan.kind, "vault"); assert.equal(plan.recordDate, 20261002);
    assert.equal(plan.transaction.feePayer!.toBase58(), cranker.toBase58());
    assert.equal(plan.transaction.recentBlockhash, BLOCKHASH);
    assert.ok(plan.transaction.instructions.some((ix) => ix.programId.equals(programId)));
    assert.ok(plan.transaction.instructions.some((ix) => ix.keys.some((k) => k.pubkey.equals(vaultAddress(programId, mint)))));
    assert.ok(plan.transaction.signatures.every((s) => s.signature === null), "unsigned");
    const viaClient = await new Burnticker({ connection: c as never, programId, cluster: "devnet" }).crank(mint, cranker);
    assert.equal(viaClient.status, "ready");
  });
  test("mainnet (by genesis hash) is refused unless allowMainnet; the client needs a connection + program id", async () => {
    const { c } = world(); c.genesis = MAINNET_GENESIS;
    await assert.rejects(crank(mint, Keypair.generate().publicKey, { connection: c as never, programId, cluster: "devnet" }), /mainnet/, "a mainnet RPC under a devnet context");
    await assert.rejects(crank(mint, Keypair.generate().publicKey, { connection: c as never, programId, cluster: "mainnet" }), /mainnet refused/);
    assert.equal((await crank(mint, Keypair.generate().publicKey, { connection: c as never, programId, cluster: "mainnet", allowMainnet: true })).status, "idle");
    assert.throws(() => client().crank(mint, mint), /connection, programId/);
  });
});

describe("subscribe", () => {
  test("chain mode: decodes burn_receipts' emit_cpi events from new transactions on the TokenConfig; history before subscribing is skipped", async () => {
    const programId = Keypair.generate().publicKey, mint = Keypair.generate().publicKey;
    const c = new FakeConnection();
    const addr = configPda(programId, mint).toBase58();
    const disc = Buffer.from(BURN_RECEIPTS_IDL.events.find((e) => e.name === "ReadingProcessed")!.discriminator);
    const ev = zeroOf({ defined: { name: "ReadingProcessed" } }) as Record<string, unknown>;
    ev.record_date = 20261008; ev.units = BigInt(3); ev.burned = BigInt(12345);
    const data = Buffer.concat([EVENT_IX_TAG, disc, encodeType(BURN_RECEIPTS_IDL, { defined: { name: "ReadingProcessed" } }, ev)]);
    assert.equal(decodeEventData(data)!.name, "ReadingProcessed");
    const keys = [Keypair.generate().publicKey, programId, new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr")];
    const tx = (memo: string) => ({ slot: 9, blockTime: 1, meta: { err: null, logMessages: [`Program log: Memo (len 3): "${memo}"`], innerInstructions: [{ index: 0, instructions: [{ programIdIndex: 1, data: base58Encode(data) }, { programIdIndex: 0, data: base58Encode(data) }, { programIdIndex: 2, data: base58Encode(Buffer.from(memo, "utf8")) }] }] }, transaction: { message: { getAccountKeys: () => ({ get: (i: number) => keys[i] }) } } });
    c.signatures.set(addr, [{ signature: "old1", slot: 1, err: null, blockTime: 1 }]); c.txs.set("old1", tx("old"));
    const got: BurntickerEvent[] = [];
    const sub = subscribe(mint, (e) => got.push(e), { connection: c as never, programId, pollMs: 60_000 });
    await sub.ready;
    assert.equal(got.length, 0, "since: now skips history");
    c.signatures.set(addr, [{ signature: "new2", slot: 10, err: null, blockTime: 2 }, { signature: "bad", slot: 9, err: { x: 1 }, blockTime: 2 }, { signature: "old1", slot: 1, err: null, blockTime: 1 }]); c.txs.set("new2", tx("abc"));
    await sub.poll();
    sub.stop();
    assert.equal(got.length, 1, "only the program's own inner instruction, only from successful transactions");
    const e = got[0];
    assert.equal(e.kind, "program");
    if (e.kind === "program") { assert.equal(e.name, "ReadingProcessed"); assert.equal(e.data.record_date, 20261008); assert.equal(e.data.burned, BigInt(12345)); assert.equal(e.signature, "new2"); assert.equal(e.memo, "abc"); }
  });
  test("API mode (no connection): receipts polled from the public API; since: recent replays the current ones once", async () => {
    const got: BurntickerEvent[] = [];
    const sub = client().subscribe("BRONCO", (e) => got.push(e), { ticker: "BRONCO", since: "recent", pollMs: 60_000 });
    await sub.ready; await sub.poll(); sub.stop();
    assert.deepEqual(got.map((e) => (e.kind === "receipt" ? [e.name, e.receipt.eventId] : [])), [["ReceiptNew", "KXNFLGAME-26SEP27LARDEN-DEN"], ["ReceiptNew", "KXNFLGAME-26OCT04DENSF-DEN"]]);
    assert.throws(() => subscribe(new PublicKey(w.bronco.mint), () => {}, {}), /connection, programId/);
  });
});
