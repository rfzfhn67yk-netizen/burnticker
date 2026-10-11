// THE WIZARD'S PAIR LAUNCH AFTER REVIEW N6 (2026-10-10): the catalogue says which venue this host uses for a rivalry pair; the page
// sends it; the launch route answers with the pair-curve transaction set (flag on) or the two LaunchLab bundles (flag off); a stale
// venue gets a 409 the page turns into a venue switch and a plain sentence; 429 / 503 read as plain sentences; the pair-curve set is
// signed in order, each mint transaction by its mint key and then the wallet, resumable at the failed step.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Keypair, SystemProgram, type Transaction } from "@solana/web3.js";
import { limiter } from "@/lib/burnticker/api/http";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import type { PairCurveLaunchBundle } from "@/lib/burnticker/pairCurveLaunch";
import { confirmLaunched, launchedErrorMessage, base58ToBytes, buildPairCurveTx, launchedSignatures, launchErrorMessage, LaunchRequestError, pairCurveSignProblems, PAIR_CURVE_REVIEW_LINE, postPairLaunch, signAndSendPairCurve, venueFor, venueFrom409 } from "@/lib/burnticker/pairLaunchClient";
import { BRONCOS } from "./burntickerHelpers.ts";
import { CREATOR, makeWorld } from "./burntickerApiHelpers.ts";

const FLAG = "BURNTICKER_PAIR_CURVE_ENABLED";
const withFlag = async <T>(on: boolean, fn: () => Promise<T>): Promise<T> => {
  const was = process.env[FLAG];
  if (on) process.env[FLAG] = "1"; else delete process.env[FLAG];
  try { return await fn(); } finally { if (was === undefined) delete process.env[FLAG]; else process.env[FLAG] = was; }
};
/** The page's fetch, pointed at the real legacy launch route. */
const routeFetch = async (_url: string, init: { method: string; headers: Record<string, string>; body: string }) => {
  const { POST } = await import("../src/app/api/burnticker/launch/route.ts");
  return POST(new Request("http://bt.test/api/burnticker/launch", { method: init.method, headers: { ...init.headers, host: "bt.test", origin: "http://bt.test", "x-forwarded-for": `198.51.100.${Math.floor(Math.random() * 200)}` }, body: init.body }));
};
const LOSE = { ...BRONCOS, binary: { onYes: null, onNo: { fractionOfPool: 0.02 } } };
// Tickers and names that are not lookalikes of the $BRONCO fixture (lookalike.ts refuses a copycat ticker or name since the growth batch).
const pairBody = (a = "MILEHIGH", b = "ARROWHEAD") => ({ creator: CREATOR, ticker: a, name: "Mile High", description: "", imageUrl: null, links: [], rule: LOSE, acknowledgements: { ruleLocked: true, noReturns: true }, pair: { ticker: b, name: "Arrowhead" } });

describe("which venue the page asks for", () => {
  test("the catalogue names the pair curve when the host flag is on, and the page follows it", async () => {
    const { GET } = await import("../src/app/api/burnticker/catalogue/route.ts");
    const on = await withFlag(true, async () => (await (await GET()).json()) as { venues: { pairCurve: boolean } });
    const off = await withFlag(false, async () => (await (await GET()).json()) as { venues: { pairCurve: boolean } });
    assert.equal(on.venues.pairCurve, true); assert.equal(off.venues.pairCurve, false);
    assert.equal(venueFor(on.venues), "pair-curve"); assert.equal(venueFor(off.venues), "launchlab"); assert.equal(venueFor(undefined), "launchlab");
  });
});

describe("the pair launch against the real route, both flag states", () => {
  test("flag on, venue from the catalogue: one pair-curve transaction set, no LaunchLab bundles", async () => {
    await makeWorld(); limiter.reset();
    const j = await withFlag(true, () => postPairLaunch(routeFetch, pairBody(), "pair-curve"));
    assert.equal(j.venue, "pair-curve");
    if (j.venue !== "pair-curve") return;
    assert.equal(j.pairCurve.version, "burnticker.pair-curve-launch/v1");
    assert.equal(j.pairCurve.transactions.length, 3);
    assert.deepEqual(j.pairCurve.transactions.map((t) => t.signers), [["creator", "mintA"], ["creator", "mintB"], ["creator"]]);
    assert.equal((j as unknown as { bundles?: unknown }).bundles, undefined);
    assert.ok(j.mintSecretKeys, "the pair-curve 200 hands over both mint keys (04c7bc4e)");
    assert.ok(!pairCurveSignProblems(j.pairCurve, CREATOR, j.mintSecretKeys).some((p) => /mint key/.test(p)), "both keys match their mints");
    assert.ok(pairCurveSignProblems(j.pairCurve, CREATOR, null).some((p) => /mint keys/.test(p)), "without keys the card says why it cannot sign");
  });

  test("flag on, a stale catalogue (launchlab): 409 → the page switches to the pair curve and says so plainly; nothing registered", async () => {
    const w = await makeWorld(); limiter.reset();
    const e = await withFlag(true, () => postPairLaunch(routeFetch, pairBody(), "launchlab")).then(() => null, (x) => x);
    assert.ok(e instanceof LaunchRequestError); assert.equal(e.status, 409); assert.equal(e.code, "pair-curve-required");
    assert.equal(venueFrom409(e), "pair-curve");
    assert.match(e.message, /both coins graduate together or neither does/);
    assert.equal(w.registry.tokenByTicker("MILEHIGH"), null);
  });

  test("flag off: the LaunchLab pair (two bundles) as before; asking for the pair curve is a 409 that switches back", async () => {
    await makeWorld(); limiter.reset();
    const j = await withFlag(false, () => postPairLaunch(routeFetch, pairBody(), "launchlab"));
    assert.equal(j.venue, "launchlab");
    if (j.venue === "launchlab") assert.ok(j.bundles.a && j.bundles.b);
    const e = await withFlag(false, () => postPairLaunch(routeFetch, pairBody("ORANGE", "REDKC"), "pair-curve")).then(() => null, (x) => x);
    assert.ok(e instanceof LaunchRequestError); assert.equal(e.code, "pair-curve-unavailable"); assert.equal(venueFrom409(e), "launchlab");
  });
});

describe("plain messages", () => {
  test("409 / 429 / 503 read as sentences; every message and the review line pass the copy lint", () => {
    const cfg = loadCopyLintConfig();
    const msgs = [
      launchErrorMessage(409, { code: "pair-curve-required" }),
      launchErrorMessage(409, { code: "pair-curve-unavailable" }),
      launchErrorMessage(409, { code: "ticker-taken", error: "ticker RAYS is taken" }),
      launchErrorMessage(429, { code: "rate-limited" }, "1800"),
      launchErrorMessage(429, { retryAfterSec: 20 }),
      launchErrorMessage(503, { code: "launch-unverifiable" }),
      launchErrorMessage(503, null),
      PAIR_CURVE_REVIEW_LINE,
    ];
    assert.equal(msgs[3], "Too many launch requests from this connection. Try again in about 30 minutes.");
    assert.equal(msgs[4], "Too many launch requests from this connection. Try again in 20 seconds.");
    assert.match(msgs[5], /cannot confirm launches yet/);
    assert.equal(PAIR_CURVE_REVIEW_LINE, "pair curve · both graduate or neither");
    for (const m of msgs) { assert.ok(!/BURNTICKER_|RPC_URL|\bcode\b|409|429|503/.test(m), m); assert.ok(lintCopy(m, cfg).ok, m); }
    assert.equal(venueFrom409(new LaunchRequestError(429, "rate-limited", "x")), null);
  });
});

describe("signing the pair-curve set", () => {
  const creator = Keypair.generate(), mintA = Keypair.generate(), mintB = Keypair.generate();
  const b58 = (k: Keypair) => { const A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"; const Z = BigInt(0), B = BigInt(58); let n = BigInt("0x" + Buffer.from(k.secretKey).toString("hex")), s = ""; while (n > Z) { s = A[Number(n % B)] + s; n /= B; } for (const x of k.secretKey) { if (x) break; s = "1" + s; } return s; };
  const keys = { a: b58(mintA), b: b58(mintB) };
  const ix = (signer: Keypair | null) => { const t = SystemProgram.transfer({ fromPubkey: creator.publicKey, toPubkey: signer?.publicKey ?? creator.publicKey, lamports: 1 }); if (signer) t.keys.push({ pubkey: signer.publicKey, isSigner: true, isWritable: false }); return { programId: t.programId.toBase58(), keys: t.keys.map((k) => ({ pubkey: k.pubkey.toBase58(), isSigner: k.isSigner, isWritable: k.isWritable })), dataBase64: Buffer.from(t.data).toString("base64"), label: "test" }; };
  const pc = { version: "burnticker.pair-curve-launch/v1", ready: true, pending: ["Metaplex metadata for the two mints is not in this bundle yet"], badge: { id: "pair-curve", label: "Pair curve", text: "" }, pairId: "p", pair: "x", vault: "v", mints: { a: mintA.publicKey.toBase58(), b: mintB.publicKey.toBase58() }, params: {} as PairCurveLaunchBundle["params"], fees: "", notes: [],
    transactions: [{ label: "create mint A", signers: ["creator", "mintA"], instructions: [ix(mintA)] }, { label: "create mint B", signers: ["creator", "mintB"], instructions: [ix(mintB)] }, { label: "init_pair", signers: ["creator"], instructions: [ix(null)] }] } as unknown as PairCurveLaunchBundle;

  test("base58 keys round-trip; a key that does not match its mint is refused before anything is signed", () => {
    assert.deepEqual(Buffer.from(base58ToBytes(keys.a)), Buffer.from(mintA.secretKey));
    assert.deepEqual(pairCurveSignProblems(pc, creator.publicKey.toBase58(), keys), []);
    assert.ok(pairCurveSignProblems(pc, creator.publicKey.toBase58(), { a: keys.b, b: keys.a }).some((p) => /does not match/.test(p)));
    assert.ok(pairCurveSignProblems(pc, null, keys).some((p) => /wallet/.test(p)));
    assert.ok(pairCurveSignProblems({ ...pc, ready: false, pending: ["side A: the initialize_token instruction is a placeholder"] }, creator.publicKey.toBase58(), keys).some((p) => /placeholder/.test(p)));
  });

  test("in order: each mint transaction carries its mint signature before the wallet signs; confirmed one by one; tx 1 / tx 2 confirm the drafts", async () => {
    const log: string[] = [];
    const deps = {
      latestBlockhash: async () => ({ blockhash: "GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi", lastValidBlockHeight: 100 }),
      signTransaction: async (tx: Transaction) => { const signed = tx.signatures.filter((s) => s.signature).map((s) => s.publicKey.toBase58()); log.push(`wallet sees ${signed.length} mint sig(s)`); tx.partialSign(creator); return tx; },
      sendRaw: async (raw: Uint8Array) => { log.push(`send ${raw.length > 0}`); return `sig${log.filter((l) => l.startsWith("send")).length}`; },
      confirm: async (sig: string) => { log.push(`confirm ${sig}`); return { err: null }; },
    };
    const r = await signAndSendPairCurve(pc, creator.publicKey.toBase58(), keys, deps);
    assert.deepEqual(r, { signatures: ["sig1", "sig2", "sig3"], failedAt: null, error: null });
    assert.deepEqual(log, ["wallet sees 1 mint sig(s)", "send true", "confirm sig1", "wallet sees 1 mint sig(s)", "send true", "confirm sig2", "wallet sees 0 mint sig(s)", "send true", "confirm sig3"]);
    // the half-signed refusal: a mint transaction without its key never reaches the wallet or the chain
    const none: string[] = [];
    const noKeys = await signAndSendPairCurve(pc, creator.publicKey.toBase58(), null, { ...deps, signTransaction: async (tx) => { none.push("wallet"); return tx; }, sendRaw: async () => { none.push("send"); return "x"; } });
    assert.deepEqual([noKeys.failedAt, noKeys.signatures, none], [0, [], []]);
    assert.deepEqual(launchedSignatures(pc, r.signatures), [{ mint: pc.mints.a, launchTx: "sig1" }, { mint: pc.mints.b, launchTx: "sig2" }], "tx 1 confirms A, tx 2 confirms B — never init_pair");
    const t1 = buildPairCurveTx(pc.transactions[0], creator.publicKey.toBase58(), keys, "GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi");
    assert.equal(t1.signatures.find((s) => s.publicKey.equals(mintA.publicKey))?.signature?.length, 64);
    assert.throws(() => buildPairCurveTx(pc.transactions[1], creator.publicKey.toBase58(), null, "GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi"), /mintB/);
  });

  test("a refusal in the wallet stops the run at that step; pressing again resumes there and never re-sends a confirmed step", async () => {
    let refuse = true; const sent: number[] = [];
    const deps = {
      latestBlockhash: async () => ({ blockhash: "GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi", lastValidBlockHeight: 1 }),
      signTransaction: async (tx: Transaction) => { if (refuse && tx.instructions[0].keys.some((k) => k.pubkey.equals(mintB.publicKey))) throw new Error("User rejected the request."); tx.partialSign(creator); return tx; },
      sendRaw: async () => { sent.push(sent.length + 1); return `s${sent.length}`; },
      confirm: async () => ({ err: null }),
    };
    const first = await signAndSendPairCurve(pc, creator.publicKey.toBase58(), keys, deps);
    assert.deepEqual([first.signatures, first.failedAt], [["s1"], 1]);
    assert.equal(first.error, "step 2 of 3 was not signed in the wallet");
    refuse = false;
    const again = await signAndSendPairCurve(pc, creator.publicKey.toBase58(), keys, deps, undefined, first.signatures);
    assert.deepEqual(again.signatures, ["s1", "s2", "s3"]); assert.deepEqual(sent, [1, 2, 3], "tx 1 sent once");
    const chainErr = await signAndSendPairCurve(pc, creator.publicKey.toBase58(), keys, { ...deps, confirm: async () => ({ err: { InstructionError: [0, "Custom"] } }) });
    assert.match(chainErr.error!, /step 1 of 3 failed: the chain rejected it/);
  });

  test("confirming the drafts: A with tx 1, then B with tx 2; a not-yet-visible transaction (404) is retried; 422 / 503 stop with a plain sentence; confirmed sides are not re-sent", async () => {
    const calls: { mint: string; launchTx: string }[] = [];
    const reply = (status: number, body: unknown = {}) => ({ ok: status === 200, status, headers: { get: () => null }, json: async () => body });
    let notYet = 2;
    const fetchFn = async (_u: string, init: { body: string }) => { const b = JSON.parse(init.body); calls.push({ mint: b.mint, launchTx: b.launchTx }); assert.equal(b.action, "launched"); if (b.mint === pc.mints.b && notYet-- > 0) return reply(404, { error: "not found" }); return reply(200, { ok: true }); };
    const r = await confirmLaunched(fetchFn, pc, ["s1", "s2", "s3"], { sleep: async () => {} });
    assert.deepEqual(r, { confirmed: [pc.mints.a, pc.mints.b], error: null });
    assert.deepEqual(calls.map((c) => c.launchTx), ["s1", "s2", "s2", "s2"]);
    calls.length = 0;
    const r422 = await confirmLaunched(async (_u, init) => { calls.push(JSON.parse(init.body)); return reply(JSON.parse(init.body).mint === pc.mints.b ? 422 : 200, { code: "launch-unverified" }); }, pc, ["s1", "s2", "s3"], { already: [pc.mints.a], sleep: async () => {} });
    assert.deepEqual(calls.map((c) => c.mint), [pc.mints.b], "A already confirmed: not re-sent");
    assert.deepEqual(r422.confirmed, [pc.mints.a]); assert.match(r422.error!, /did not accept that transaction/);
    const r503 = await confirmLaunched(async () => reply(503, { code: "launch-unverifiable" }), pc, ["s1", "s2", "s3"], { sleep: async () => {} });
    assert.match(r503.error!, /cannot confirm launches yet/);
    const gaveUp = await confirmLaunched(async () => reply(404), pc, ["s1", "s2", "s3"], { retries: 1, sleep: async () => {} });
    assert.match(gaveUp.error!, /not seen the transaction on chain yet/);
    const cfg = loadCopyLintConfig();
    for (const st of [404, 409, 422]) assert.ok(lintCopy(launchedErrorMessage(st, null), cfg).ok, String(st));
  });
});
