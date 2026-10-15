// SIGN AND SEND FOR EVERY LAUNCH (2026-10-11, the public-launch blocker: a single LaunchLab coin ended at an unsigned bundle card). The
// review card's Launch → the bundle(s) from POST /api/burnticker/launch → ONE signing plan (signPlan.ts) → SignCard.tsx: the mint key
// signs, then the wallet, send, confirm, step by step; then `action: "launched"` with the transaction the mint signed; then the coin
// page. The same plan and card sign a pair (two LaunchLab bundles, or the pair-curve set), so single coins and pairs cannot drift.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { Keypair, VersionedTransaction } from "@solana/web3.js";
import { limiter } from "@/lib/burnticker/api/http";
import { abandonedSentence, bytesToBase58, feesPaidLamports, planAbandoned, storedStepStates, LAMPORTS_PER_SIGNATURE, browserPlanStorage, listStoredLaunches, memoryPlanStorage, recoverStoredLaunch, storedLaunchSentence, confirmPlan, failureSentence, launchlabPlan, loadPlanRecord, planConfirmations, planProblems, planStepStates, planStorageKey, reconcilePending, recordFailureSentence, signAndSendPlan, stepStatusText, type LaunchlabBundleLike, type SignPlan } from "@/lib/burnticker/signPlan";
import { launchedErrorMessage } from "@/lib/burnticker/pairLaunchClient";
import { firstPartyRule } from "@/lib/burnticker/wizard";
import { gameSeries, teamSeries } from "@/lib/burnticker/sources/espn";
import { polyRule } from "@/lib/burnticker/search";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import { DEBT_RULE } from "./burntickerHelpers.ts";
import { makeWorld } from "./burntickerApiHelpers.ts";
import { EAGLES_CID } from "./burntickerPolyHelpers.ts";

const ROOT = path.join(import.meta.dirname, "..");
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");
const BH = "GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi";
const creatorKp = Keypair.generate(), CREATOR = creatorKp.publicKey.toBase58();

const legacy = async (body: Record<string, unknown>) => {
  const { POST } = await import("../src/app/api/burnticker/launch/route.ts");
  const r = await POST(new Request("http://bt.test/api/burnticker/launch", { method: "POST", headers: { host: "bt.test", origin: "http://bt.test", "content-type": "application/json", "x-forwarded-for": `192.0.2.${Math.floor(Math.random() * 200)}` }, body: JSON.stringify(body) }));
  return { status: r.status, json: await r.json() as Record<string, unknown> };
};
const coin = (ticker: string, rule: unknown) => ({ creator: CREATOR, ticker, name: `${ticker} Coin`, description: "", imageUrl: null, links: [], rule, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true } });

/** The page's paths, each with the rule the review card would launch (one LaunchLab coin). */
const PATHS: [string, string, unknown][] = [
  ["the sentence search (a feed card)", "DEBTWATCH", DEBT_RULE],
  ["Team coin", "RAYSWINS", firstPartyRule(teamSeries("mlb", "TB", "win", { kind: "season", year: 2026 }), 0.02)],
  ["Matchup (one side, this game)", "TBGAME", firstPartyRule(gameSeries("mlb", "401999999", "TB", "loss"), 1)],   // review 10 F1: one-shots are 100 % without burn dispersal
  ["Any result / Elections (one market, resolves once)", "EAGLEMKT", polyRule(EAGLES_CID, 1)],
  ["a template (A public number)", "DEBTTPL", { ...DEBT_RULE, scalar: { ...(DEBT_RULE as { scalar: object }).scalar, perUnit: { fractionOfPool: 0.05 } } }],
];

const fakeDeps = (log: string[], over: Partial<{ refuseAt: number; chainErrAt: number }> = {}) => {
  let n = 0;
  // launch recovery 254: the plan keeps the submitted transaction's own signature; `sent` records it (the RPC's answer is not used)
  const sent: string[] = [];
  return {
    sent,
    latestBlockhash: async () => ({ blockhash: BH, lastValidBlockHeight: 1 }),
    signTransaction: async (tx: VersionedTransaction) => {
      const pre = tx.signatures.filter((s) => s.some((b) => b !== 0)).length;
      if (over.refuseAt === n) throw new Error("User rejected the request.");
      log.push(`wallet signs (${pre} key signature(s) already on it)`); tx.sign([creatorKp]); return tx;
    },
    lookupTable: async () => null,
    sendRaw: async (raw: Uint8Array) => { n++; log.push(`send ${n}`); sent.push(bytesToBase58(VersionedTransaction.deserialize(raw).signatures[0])); return `sig${n}`; },
    confirm: async () => ({ err: over.chainErrAt === n ? { InstructionError: [0, "Custom"] } : null }),
  };
};

describe("one signing plan for every launch path", () => {
  for (const [label, ticker, rule] of PATHS) test(`${label}: Launch → bundle → the wallet signs first, then the mint key (Phantom ticket 438485) → sent → "launched" with that transaction`, async () => {
    await makeWorld(); limiter.reset();
    const r = await legacy(coin(ticker, rule));
    assert.equal(r.status, 200, JSON.stringify(r.json).slice(0, 300));
    const b = r.json.bundle as LaunchlabBundleLike;
    assert.ok(b.mintSecretKey, "the bundle hands over its fresh mint key");
    const plan = launchlabPlan([b]);
    assert.ok(plan.steps.length >= 1);
    assert.deepEqual(plan.confirms.map((c) => c.mint), [b.mint]);
    assert.ok(plan.steps[plan.confirms[0].step].signers.includes("mint"), "the confirming step is the one the mint signs (launchVerify)");
    assert.deepEqual(planProblems({ ...plan, pending: [] }, CREATOR), [], "the key matches the mint; only the host's pending pieces remain");
    assert.deepEqual(plan.pending, b.ready ? [] : b.pending, "a bundle that is not ready says why and is not signed");
    const log: string[] = [];
    const s = await signAndSendPlan(plan, CREATOR, fakeDeps(log));
    assert.equal(s.error, null);
    assert.ok(log[0].startsWith("wallet signs (0 key"), "the wallet sees no other signature (Phantom ticket 438485); the mint key signs after");
    assert.deepEqual(planConfirmations(plan, s.signatures), [{ mint: b.mint, launchTx: s.signatures[plan.confirms[0].step] }]);
  });

  test("two coins (a matchup this season, or a pair with the pair curve off): A's steps then B's, each confirmed by its own create", async () => {
    await makeWorld(); limiter.reset();
    const a = (await legacy(coin("TBSEASON", firstPartyRule(teamSeries("mlb", "TB", "loss", { kind: "season", year: 2026 }), 0.02)))).json.bundle as LaunchlabBundleLike;
    const b = (await legacy(coin("NYYSEASON", firstPartyRule(teamSeries("mlb", "NYY", "loss", { kind: "season", year: 2026 }), 0.02)))).json.bundle as LaunchlabBundleLike;
    const plan = launchlabPlan([a, b]);
    assert.deepEqual(plan.confirms.map((c) => [c.ticker, c.step]), [["TBSEASON", 0], ["NYYSEASON", a.transactions.length]]);
    assert.deepEqual(Object.keys(plan.keys).sort(), ["mint0", "mint1"]);
    const s = await signAndSendPlan(plan, CREATOR, fakeDeps([]));
    assert.equal(s.signatures.length, plan.steps.length);
  });
});

/** A two-step LaunchLab bundle with a real fresh mint key: "create" (creator + mint) then "first buy" (creator). */
const bundle = (): LaunchlabBundleLike => {
  const mint = Keypair.generate();
  const A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"; const Z = BigInt(0), B58 = BigInt(58); let x = BigInt("0x" + Buffer.from(mint.secretKey).toString("hex")), secret = ""; while (x > Z) { secret = A[Number(x % B58)] + secret; x /= B58; } for (const b of mint.secretKey) { if (b !== 0) break; secret = "1" + secret; }
  const ix = (signer: string) => ({ programId: "11111111111111111111111111111111", label: "test", dataBase64: Buffer.from([2, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0]).toString("base64"), keys: [{ pubkey: CREATOR, isSigner: true, isWritable: true }, { pubkey: signer, isSigner: true, isWritable: true }] });
  return { mint: mint.publicKey.toBase58(), ticker: "TEST", ready: true, pending: [], mintSecretKey: secret, transactions: [{ label: "create", signers: ["creator", "mint"], instructions: [ix(mint.publicKey.toBase58())] }, { label: "first buy", signers: ["creator"], instructions: [ix(CREATOR)] }] };
};

describe("failures: never half-signed, resume at the failed step, plain sentences", () => {
  test("a missing or wrong mint key is refused before anything reaches the wallet", async () => {
    const b = bundle();
    assert.ok(planProblems(launchlabPlan([{ ...b, mintSecretKey: null }]), CREATOR).some((p) => /did not hand over the mint key/.test(p)));
    assert.ok(planProblems(launchlabPlan([{ ...b, mint: Keypair.generate().publicKey.toBase58() }]), CREATOR).some((p) => /does not match/.test(p)));
    const log: string[] = [];
    const r = await signAndSendPlan(launchlabPlan([{ ...b, mintSecretKey: null }]), CREATOR, fakeDeps(log));
    assert.deepEqual([r.failedAt, log], [0, []], "nothing signed by the wallet, nothing sent");
  });

  test("a refusal in the wallet stops at that step; the next press resumes there; a chain error says so", async () => {
    const plan = launchlabPlan([bundle()]);
    const log: string[] = [];
    const d1 = fakeDeps(log, { refuseAt: 1 });
    const first = await signAndSendPlan(plan, CREATOR, d1);
    assert.deepEqual([first.signatures, first.failedAt, first.error], [[d1.sent[0]], 1, "Step 2 of 2 was not signed in the wallet"]);
    const again = await signAndSendPlan(plan, CREATOR, fakeDeps(log), undefined, first.signatures);
    assert.equal(again.signatures.length, 2); assert.equal(log.filter((l) => l.startsWith("send")).length, 2, "step 1 sent once");
    const chain = await signAndSendPlan(plan, CREATOR, fakeDeps([], { chainErrAt: 1 }));
    assert.match(chain.error!, /Step 1 of 2 failed because the chain rejected it/);
  });

  test('"launched": 404 retried (~5 × 4 s), then 200; 409 / 422 / 429 / 503 stop with a plain sentence; a live coin is not re-sent', async () => {
    const plan: SignPlan = launchlabPlan([bundle()]);
    const reply = (status: number, body: unknown = {}) => ({ ok: status === 200, status, headers: { get: (h: string) => (h === "retry-after" ? "900" : null) }, json: async () => body });
    let n = 0, waits = 0;
    const ok = await confirmPlan(async () => (++n <= 3 ? reply(404) : reply(200, { ok: true })), plan, ["sig1", "sig2"], launchedErrorMessage, { sleep: async (ms) => { waits += ms; } });
    assert.deepEqual([ok.error, ok.confirmed.length, n, waits], [null, 1, 4, 12000]);
    const cfg = loadCopyLintConfig();
    for (const [st, code, re] of [[409, "", /already recorded as launched/], [422, "launch-unverified", /did not accept that transaction/], [429, "rate-limited", /Try again in about 15 minutes/], [503, "launch-unverifiable", /cannot confirm launches yet/]] as const) {
      const r = await confirmPlan(async () => reply(st, { code }), plan, ["sig1", "sig2"], launchedErrorMessage, { sleep: async () => {} });
      assert.match(r.error!, re); assert.ok(lintCopy(r.error!, cfg).ok, r.error!);
    }
    let calls = 0;
    await confirmPlan(async () => { calls++; return reply(200); }, plan, ["sig1", "sig2"], launchedErrorMessage, { already: [plan.confirms[0].mint] });
    assert.equal(calls, 0);
  });
});

describe("the page and the tile reach the same signing card", () => {
  test("every Launch ends on SignCard: one coin, two coins and the pair curve; the old pair-only card is gone", () => {
    const page = read("src/app/burnticker/launch/page.tsx"), tile = read("src/app/burnticker/launch/CoinVsCoinTile.tsx"), card = read("src/app/burnticker/launch/SignCard.tsx");
    assert.match(page, /setStep\("launch"\)/, "the review card's Launch moves to the sign step after the bundle arrives");
    assert.match(page, /pcOut \? pairCurvePlan\(.*\) : pairOut \? launchlabPlan\(\[pairOut\.a, pairOut\.b\]\) : launchlabPlan\(\[bundle!\]\)/);
    assert.equal((page.match(/<SignCard\b/g) ?? []).length, 1); assert.equal((tile.match(/<SignCard\b/g) ?? []).length, 2, "website-21: the pair and the record-close coin each end on SignCard");
    assert.ok(!fs.existsSync(path.join(ROOT, "src/app/burnticker/launch/PairCurveSign.tsx")));
    assert.match(card, /signAndSendPlan\(/); assert.match(card, /confirmPlan\(/);
    assert.ok(!/odds|price|chance/i.test(card.replace(/\/\*[\s\S]*?\*\//g, "")), "no odds or prices on the signing card");
  });
});

// ---- review-2 F4: a send that lands while its confirmation is lost ---------------------------------------------------------------
// sendRaw lands the create; confirm throws (an RPC timeout). The signed transaction is persisted BEFORE it is sent, the step stays
// "sent" (outcome unknown) with its signature, and a resumed run (a second press, or a reload with only the stored record) checks the
// ORIGINAL signature first: confirmed → adopted (no second create); failed on chain → rebuilt; absent → rebuilt only once the
// blockhash is proven expired (block height past lastValidBlockHeight), otherwise it stays sent / unknown and nothing new is built.
describe("an ambiguous confirmation keeps the sent transaction and recovers it (review-2 F4)", () => {
  const b58 = (() => { const m = createRequire(import.meta.url)("bs58") as { encode?(b: Uint8Array): string; default?: { encode(b: Uint8Array): string } }; return (b: Uint8Array) => (m.encode ?? m.default!.encode)(b); })();
  const sigOf = (raw: Uint8Array) => b58(VersionedTransaction.deserialize(raw).signatures[0]);
  const memStore = () => { const m = new Map<string, string>(); return { m, get: (k: string) => m.get(k) ?? null, set: (k: string, v: string) => { m.set(k, v); }, remove: (k: string) => { m.delete(k); } }; };
  const TIMEOUT = "TransactionExpiredTimeoutError: Transaction was not confirmed in 30.00 seconds. It is unknown if it succeeded or failed.";
  /** A mocked chain: every sent signature is recorded; `landed` decides what the status query reports for it. */
  const chain = (o: { confirmThrows?: boolean; height?: number; status?: (sig: string) => { err: unknown; confirmationStatus: string } | null; store?: ReturnType<typeof memStore> }) => {
    const sent: string[] = [], pendingAtSend: (string | null)[] = [];
    const deps = {
      latestBlockhash: async () => ({ blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 100 }),
      signTransaction: async (tx: VersionedTransaction) => { tx.sign([creatorKp]); return tx; },
      lookupTable: async () => null,
      sendRaw: async (raw: Uint8Array) => {
        const sig = sigOf(raw);
        const rec = o.store ? [...o.store.m.values()].map((v) => JSON.parse(v) as { pending: { signature: string } | null })[0] : null;
        pendingAtSend.push(rec?.pending?.signature ?? null);
        sent.push(sig); return sig;
      },
      confirm: async () => { if (o.confirmThrows) throw new Error(TIMEOUT); return { err: null }; },
      getSignatureStatus: async (sig: string) => (o.status ? o.status(sig) : null),
      getBlockHeight: async () => o.height ?? 50,
      storage: o.store,
    };
    return { deps, sent, pendingAtSend };
  };
  const confirmedStatus = () => ({ err: null, confirmationStatus: "confirmed" });

  test("send lands, confirm times out: the signature is persisted before the send and kept as \"sent\"; a resumed run adopts it once confirmed — no second create", async () => {
    const plan = launchlabPlan([bundle()]), store = memStore();
    const one = chain({ confirmThrows: true, store });
    const first = await signAndSendPlan(plan, CREATOR, one.deps);
    assert.equal(one.sent.length, 1);
    assert.deepEqual(one.pendingAtSend, [one.sent[0]], "the signed transaction's signature was in storage before sendRaw ran");
    assert.equal(first.failedAt, 0); assert.equal(first.state, "sent"); assert.equal(first.signature, one.sent[0]);
    assert.match(first.error!, /was sent, but the confirmation could not be read \(signature /);
    const rec = loadPlanRecord(store, plan)!;
    assert.equal(rec.pending!.signature, one.sent[0]); assert.equal(rec.pending!.step, 0);
    // the original transaction is now confirmed on chain: the resume adopts it and sends only step 2
    const two = chain({ store, status: (sig) => (sig === one.sent[0] ? confirmedStatus() : null) });
    const steps: [number, string][] = [];
    const again = await signAndSendPlan(plan, CREATOR, two.deps, (i, s) => steps.push([i, s]), first.signatures);
    assert.equal(again.error, null);
    assert.equal(again.signatures[0], one.sent[0], "step 1 is the original signature");
    assert.equal(two.sent.length, 1, "only the first buy was sent; the create was not sent a second time");
    assert.deepEqual(steps.map((s) => s[0]), [0, 1]);
    assert.equal(loadPlanRecord(store, plan)!.pending, null);
  });

  test("status absent and the blockhash proven expired (block height past lastValidBlockHeight): the resume rebuilds and sends a fresh transaction", async () => {
    const plan = launchlabPlan([bundle()]), store = memStore();
    const one = chain({ confirmThrows: true, store, height: 50 });
    const first = await signAndSendPlan(plan, CREATOR, one.deps);
    assert.equal(first.state, "sent", "absent but still within its blockhash: unknown, not rebuilt");
    // launch recovery 255: expiry plus an empty status is proof only with the history read and the create's accounts absent
    const two = chain({ store, height: 101 });
    const again = await signAndSendPlan(plan, CREATOR, { ...two.deps, getTransaction: async () => null, expectedAccounts: async () => "absent" as const }, undefined, first.signatures);
    assert.equal(again.error, null);
    assert.equal(two.sent.length, 2, "a fresh create and the first buy");
    assert.notEqual(two.sent[0], one.sent[0], "the create was rebuilt with a fresh blockhash");
    assert.equal(again.signatures[0], two.sent[0]);
  });

  test("status absent but the block height NOT past lastValidBlockHeight: nothing is rebuilt; the step stays sent / unknown", async () => {
    const plan = launchlabPlan([bundle()]), store = memStore();
    const first = await signAndSendPlan(plan, CREATOR, chain({ confirmThrows: true, store }).deps);
    const two = chain({ store, height: 100 });
    const again = await signAndSendPlan(plan, CREATOR, two.deps, undefined, first.signatures);
    assert.equal(two.sent.length, 0, "no new transaction while the first can still land");
    assert.deepEqual([again.failedAt, again.state, again.signature], [0, "sent", first.signature]);
    assert.ok(again.error!.includes(`was sent, but the confirmation could not be read (signature ${first.signature})`));
    // a status the chain has seen but not yet confirmed ("processed") is unknown too
    const three = chain({ store, height: 101, status: () => ({ err: null, confirmationStatus: "processed" }) });
    assert.equal((await signAndSendPlan(plan, CREATOR, three.deps)).state, "sent"); assert.equal(three.sent.length, 0);
  });

  test("status shows an on-chain error: the step is failed and rebuilding is allowed", async () => {
    const plan = launchlabPlan([bundle()]), store = memStore();
    const failedOnChain = () => ({ err: { InstructionError: [0, "Custom"] }, confirmationStatus: "confirmed" });
    const one = chain({ confirmThrows: true, store, status: failedOnChain });
    const first = await signAndSendPlan(plan, CREATOR, one.deps);
    assert.deepEqual([first.failedAt, first.state, first.signature], [0, "failed", one.sent[0]]);
    assert.match(first.error!, /the chain rejected it/);
    assert.equal(loadPlanRecord(store, plan)!.pending, null, "nothing left pending: the next press may build afresh");
    const two = chain({ store });
    const again = await signAndSendPlan(plan, CREATOR, two.deps, undefined, first.signatures);
    assert.equal(again.error, null); assert.equal(two.sent.length, 2);
  });

  test("the pure reconciliation: confirmed / failed / expired only on a proven absence past lastValidBlockHeight / otherwise unknown", () => {
    const p = { lastValidBlockHeight: 100 };
    assert.equal(reconcilePending(p, { err: null, confirmationStatus: "finalized" }, 10), "confirmed");
    assert.equal(reconcilePending(p, { err: { x: 1 }, confirmationStatus: "confirmed" }, 10), "failed");
    assert.equal(reconcilePending(p, null, 101), "expired");
    assert.equal(reconcilePending(p, null, 100), "unknown");
    assert.equal(reconcilePending(p, null, null), "unknown", "no block height: expiry is not proven");
    assert.equal(reconcilePending(p, undefined, 101), "unknown", "the status query failed: absence is not proven");
    assert.equal(reconcilePending(p, { err: null, confirmationStatus: "processed" }, 101), "unknown");
  });

  test("reload: a fresh run holding only the stored record (sessionStorage format, same key) recovers the pending signature and adopts it", async () => {
    const plan = launchlabPlan([bundle()]), before = memStore();
    const one = chain({ confirmThrows: true, store: before });
    await signAndSendPlan(plan, CREATOR, one.deps);
    const key = planStorageKey(plan);
    assert.equal(key, `burnticker.signplan.${plan.confirms[0].mint}`);
    const raw = before.get(key)!;
    const parsed = JSON.parse(raw) as Record<string, unknown> & { pending: Record<string, unknown> };
    assert.deepEqual(Object.keys(parsed).sort(), ["confirmed", "confirms", "failed", "mints", "paid", "pending", "recorded", "stepSigners", "steps", "updatedAt", "v"]);
    assert.deepEqual(Object.keys(parsed.pending).sort(), ["blockhash", "lastValidBlockHeight", "sentAt", "signature", "step", "tx"]);
    assert.equal(sigOf(Buffer.from(parsed.pending.tx as string, "base64")), one.sent[0], "the stored bytes are the transaction that was sent");
    // the page reloads: a new storage object holding only that string, no `prior`, new deps
    const after = memStore(); after.set(key, raw);
    const two = chain({ store: after, status: (sig) => (sig === one.sent[0] ? confirmedStatus() : null) });
    const r = await signAndSendPlan(plan, CREATOR, two.deps);
    assert.equal(r.error, null); assert.equal(r.signatures[0], one.sent[0]); assert.equal(two.sent.length, 1, "only the first buy");
  });

  test("reload WITHOUT the plan (the launch page's recovery notice): the stored launch is listed, the landed create adopted from storage alone — no send — and the draft recorded; an expired one says to start again", async () => {
    // a single LaunchLab coin has two steps (initialize + create, first buy); the create landed, its confirmation was lost, then the page reloaded
    const plan = launchlabPlan([bundle()]), before = memStore();
    const one = chain({ confirmThrows: true, store: before });
    await signAndSendPlan(plan, CREATOR, one.deps);
    const key = planStorageKey(plan);
    const page = memoryPlanStorage(); page.set(key, before.get(key)!);
    const listed = listStoredLaunches(page);
    assert.equal(listed.length, 1);
    assert.match(storedLaunchSentence(listed[0]), /step 1 of 2 was sent, but the confirmation could not be read \(signature /);
    assert.doesNotMatch(storedLaunchSentence(listed[0]), /Nothing was sent/);
    // the chain says the create is confirmed: adopted; step 2 was never sent, so nothing is recorded yet and the sentence says how to finish
    const posts: string[] = [];
    const fetchFn = async (_u: string, init: { body: string }) => { posts.push(init.body); return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({}) }; };
    const r = await recoverStoredLaunch(page, listed[0], { getSignatureStatus: async (sig) => (sig === one.sent[0] ? confirmedStatus() : null), getBlockHeight: async () => 50 }, fetchFn, () => "refused");
    assert.equal(r.done, false); assert.deepEqual(r.rec.confirmed, [one.sent[0]]); assert.equal(r.rec.pending, null);
    assert.match(r.text, /1 of the 2 steps is confirmed on chain/);
    assert.equal(posts.length, 0, "not recorded while a step is missing");
    // a fully confirmed set (both steps landed before the reload): recorded with the transaction the mint signed, then the record is gone
    const done = memoryPlanStorage();
    done.set(key, JSON.stringify({ ...JSON.parse(before.get(key)!), confirmed: ["SIGSTEP1", "SIGSTEP2"], pending: null }));
    const fin = await recoverStoredLaunch(done, listStoredLaunches(done)[0], {}, fetchFn, () => "refused");
    assert.equal(fin.done, true);
    assert.deepEqual(JSON.parse(posts[0]), { action: "launched", mint: plan.confirms[0].mint, launchTx: "SIGSTEP1" });
    assert.equal(done.get(key), null); assert.deepEqual(listStoredLaunches(done), []);
    // provably expired and absent: failed, and the sentence says start again from the review (no keys to rebuild with)
    const exp = memoryPlanStorage(); exp.set(key, before.get(key)!);
    const x = await recoverStoredLaunch(exp, listStoredLaunches(exp)[0], { getSignatureStatus: async () => null, getBlockHeight: async () => 101, getTransaction: async () => null, expectedAccounts: async () => "absent" }, fetchFn, () => "refused");
    assert.match(x.text, /did not take effect .* start the launch again from the review/);
    // the launch page mounts the notice; it reads storage after mount and never signs or sends
    const src = fs.readFileSync(path.join(import.meta.dirname, "..", "src/app/burnticker/launch/LaunchRecovery.tsx"), "utf8");
    assert.match(fs.readFileSync(path.join(import.meta.dirname, "..", "src/app/burnticker/launch/page.tsx"), "utf8"), /<LaunchRecovery \/>/);
    assert.doesNotMatch(src, /sendRawTransaction|signTransaction/);
    assert.match(src, /for \(const s of listStoredLaunches\(storage\)\) if \(nothingSentAbandoned\(s\)\) archivePlanRecord\(storage, s\.key\);\s*setView\(\{ items: listStoredLaunches\(storage\), finished: \[\] \}\);/);   // 2026-10-14: attempts that sent nothing are archived first
  });

  test("the browser storage wraps sessionStorage and survives its absence", () => {
    const s = browserPlanStorage();
    assert.doesNotThrow(() => { s.set("k", "v"); s.get("k"); s.remove("k"); }, "no window here: falls back to memory without throwing");
    s.set("k", "v"); assert.equal(s.get("k"), "v");
  });

  test('"launched": a transport failure (fetch throws) is a plain sentence that keeps the chain progress; the card clears busy in finally', async () => {
    const plan = launchlabPlan([bundle()]);
    const r = await confirmPlan(async () => { throw new TypeError("Failed to fetch"); }, plan, ["sig1", "sig2"], launchedErrorMessage, { sleep: async () => {} });
    assert.deepEqual(r.confirmed, []); assert.ok(r.error); assert.equal(r.transport, true);
    assert.ok(lintCopy(r.error!, loadCopyLintConfig()).ok, r.error!);
    const card = read("src/app/burnticker/launch/SignCard.tsx");
    assert.match(card, /finally\s*\{\s*setBusy\(false\)/, "busy is cleared whatever happens");
    // a 5xx while recording does not tell the creator nothing was sent
    const r500 = await confirmPlan(async () => ({ ok: false, status: 500, headers: { get: () => null }, json: async () => { throw new SyntaxError("not json"); } }), plan, ["sig1", "sig2"], (st, bd, ra) => recordFailureSentence(st, bd, ra, launchedErrorMessage), { sleep: async () => {} });
    assert.doesNotMatch(r500.error!, /Nothing was sent/); assert.match(r500.error!, /could not record/);
    const r503 = recordFailureSentence(503, null, null, launchedErrorMessage);
    assert.doesNotMatch(r503, /Nothing was sent/);
  });

  test('the card\'s sentences: a sent / unknown step reads "Sent; confirmation unavailable — signature …", never "Nothing was sent"', () => {
    const cfg = loadCopyLintConfig();
    const sig = "5".repeat(88);
    const sent = failureSentence({ signatures: [], failedAt: 0, error: `step 1 of 2: Sent; confirmation unavailable — signature ${sig}`, state: "sent", signature: sig }, 2);
    assert.ok(sent.includes(`Sent; confirmation unavailable — signature ${sig}`)); assert.doesNotMatch(sent, /Nothing was sent/);
    assert.ok(lintCopy(sent, cfg).ok, sent);
    const failed = failureSentence({ signatures: [], failedAt: 0, error: "step 1 of 2 failed: the chain rejected it (x)", state: "failed", signature: sig }, 2);
    assert.doesNotMatch(failed, /Nothing was sent/);
    assert.match(failureSentence({ signatures: [], failedAt: 0, error: "step 1 of 2 was not signed in the wallet", state: "not-sent" }, 2), /Nothing was sent\./);
    assert.match(failureSentence({ signatures: ["a"], failedAt: 1, error: "step 2 of 2 was not signed in the wallet", state: "not-sent" }, 2), /steps before it are confirmed/);
    assert.equal(stepStatusText("sent", sig), `sent, but the confirmation could not be read (signature ${sig})`);
    assert.match(stepStatusText("confirmed", sig), /^confirmed /);
    const states = planStepStates(3, ["a"], { failedAt: 1, state: "sent" });
    assert.deepEqual(states, ["confirmed", "sent", "not-sent"]);
    for (const st of ["confirmed", "sent", "failed", "not-sent"] as const) assert.ok(lintCopy(stepStatusText(st, sig), cfg).ok, st);
  });
});

// ---- the F4 residual (re-check 2026-10-11): a plan whose mint key is gone after a reload is ABANDONED --------------------------------
// Mint keys are never stored (kept rule). A plan that already put something on chain cannot be rebuilt once a remaining step needs a key
// the page no longer holds: every such step reads "abandoned", the sentence says nothing from the plan is live until the create step
// confirms and gives the fee already spent, and the only action is a new plan. No step is built, so no second create is attempted.
describe("an abandoned plan after a reload (F4 residual): confirmed / pending reconcile / abandoned, the fee spent, only a new plan", () => {
  const cfg = loadCopyLintConfig();
  const twoCoins = () => [bundle(), bundle()].map((b, i) => ({ ...b, ticker: i ? "BEE" : "AYE" }));
  test("create A confirmed, then the run stops; after the reload the keys are gone: nothing reaches the wallet or the chain, every remaining step is abandoned", async () => {
    const coins = twoCoins(), store = memoryPlanStorage();
    const plan = launchlabPlan(coins);
    const d1 = fakeDeps([], { refuseAt: 1 });
    const first = await signAndSendPlan(plan, CREATOR, { ...d1, storage: store });
    const sig1 = d1.sent[0];
    assert.deepEqual([first.signatures, first.failedAt], [[sig1], 1]);
    // the page reloads: the bundles come back without their keys (never stored); the record is the only memory
    const reloaded = launchlabPlan(coins.map((c) => ({ ...c, mintSecretKey: null })));
    const rec = loadPlanRecord(store, reloaded)!;
    assert.deepEqual(rec.paid, [{ step: 0, signature: sig1, lamports: 2 * LAMPORTS_PER_SIGNATURE }], "create A paid two signatures' fee");
    assert.equal(planAbandoned(reloaded, rec), true);
    const log: string[] = []; let sends = 0;
    const d = fakeDeps(log);
    const r = await signAndSendPlan(reloaded, CREATOR, { ...d, sendRaw: async () => { sends++; return "x"; }, storage: store });
    assert.deepEqual([log, sends], [[], 0], "no step built: the wallet saw nothing, nothing was sent — no duplicate create");
    assert.deepEqual([r.failedAt, r.state, r.signatures], [1, "abandoned", [sig1]]);
    assert.match(r.error!, /1 of the 4 steps is confirmed on chain\. Steps 2–4 of 4 are abandoned because the mint key was lost on reload/);
    // launch audit 232: per coin — $AYE's create confirmed, so it exists on chain; $BEE was never created
    assert.match(r.error!, /\$AYE was created on chain, but it is not recorded from this plan\. \$BEE was not created\./);
    assert.match(r.error!, /The network transaction fees already paid come to 0\.00001 SOL/);
    assert.match(r.error!, /The only safe thing to do is to start the launch again from the review, as a new plan\./);
    assert.equal(failureSentence(r, 4), r.error, "the card shows that sentence as is");
    assert.deepEqual(planStepStates(4, r.signatures, r), ["confirmed", "abandoned", "abandoned", "abandoned"]);
    assert.equal(stepStatusText("abandoned"), "abandoned because the mint key was lost on reload");
    for (const t of [r.error!, stepStatusText("abandoned")]) assert.ok(lintCopy(t, cfg).ok, t);
    // the launch page's recovery notice (no plan at all) says the same, per step
    const listed = listStoredLaunches(store);
    assert.equal(listed.length, 1);
    assert.deepEqual(storedStepStates(listed[0].rec), ["confirmed", "abandoned", "abandoned", "abandoned"]);
    assert.match(storedLaunchSentence(listed[0]), /For \$AYE and \$BEE, 1 of the 4 steps is confirmed on chain\. Steps 2–4 of 4 are abandoned.*The network transaction fees already paid come to 0\.00001 SOL/);
  });

  test("a step sent with its outcome unknown is pending reconcile, not abandoned; a plan with nothing on chain is not abandoned (just not signable)", async () => {
    const coins = twoCoins(), store = memoryPlanStorage(), plan = launchlabPlan(coins);
    await signAndSendPlan(plan, CREATOR, { ...fakeDeps([]), confirm: async () => { throw new Error("TransactionExpiredTimeoutError"); }, storage: store });
    const reloaded = launchlabPlan(coins.map((c) => ({ ...c, mintSecretKey: null })));
    const rec = loadPlanRecord(store, reloaded)!;
    assert.ok(rec.pending); assert.equal(planAbandoned(reloaded, rec), false);
    assert.deepEqual(storedStepStates({ ...rec, steps: 4 }), ["sent", "abandoned", "abandoned", "abandoned"]);
    assert.equal(planAbandoned(reloaded, { confirmed: [], pending: null, failed: null, paid: [] }), false);
    assert.equal(planAbandoned(plan, { confirmed: ["a"], pending: null, failed: null, paid: [] }), false, "keys present: the plan continues");
  });

  test("a step rejected on chain still paid its fee; the creates confirmed reads differently from creates outstanding", async () => {
    const store = memoryPlanStorage(), plan = launchlabPlan([bundle()]);
    const r = await signAndSendPlan(plan, CREATOR, { ...fakeDeps([], { chainErrAt: 2 }), storage: store });
    assert.equal(r.state, "failed");
    const rec = loadPlanRecord(store, plan)!;
    assert.equal(feesPaidLamports(rec), 2 * LAMPORTS_PER_SIGNATURE + LAMPORTS_PER_SIGNATURE, "the confirmed create (2 signatures) and the rejected step (1)");
    const s = abandonedSentence({ ...rec, confirms: plan.confirms, steps: 2 });
    assert.match(s, /Its create steps are confirmed, but the launch is not recorded from this plan/);
    assert.match(s, /The network transaction fees already paid come to 0\.000015 SOL/);
    assert.ok(lintCopy(s, cfg).ok, s);
  });

  test("the card renders the abandoned steps and offers only a new plan (it drops the record and returns to the review)", () => {
    const card = read("src/app/burnticker/launch/SignCard.tsx");
    assert.match(card, /st === "abandoned" && <span[^>]*>· \{stepStatusText\("abandoned"\)\}/);
    assert.match(card, /stopped\?\.state === "abandoned" \? \(\s*<button[^>]*data-decision="new-plan"[^>]*onClick=\{startNewPlan\}>Start a new plan<\/button>/);
    // launch night 2026-10-13: back to the review with the kept draft (launchDraftStore.ts resumeReviewHref)
    assert.match(card, /const startNewPlan = \(\) => \{ archivePlanRecord\(storage, planStorageKey\(plan\)\); window\.location\.assign\(resumeReviewHref\(window\.location\.pathname\)\); \}/);
    assert.match(card, /planAbandoned\(plan, stored\)/);
    assert.ok(!/odds|price|chance/i.test(card.replace(/\/\*[\s\S]*?\*\//g, "")));
  });
});
