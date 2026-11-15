// The synthetic creator's launch-path scenarios on publish 93 (b-double-press, b-reject-retry, b-reload-relaunch, a-published), each
// reproduced without a browser:
//   · b-double-press / b-reject-retry: the page asked the wallet once per step and prepared once; the scenarios counted SEC-05's
//     `action: "sent"` report (a POST to the same launch route) as a second prepare and read the step count from its answer
//     (plan.mts preparesOf / prepareStepsOf). The card's own contract is pinned here too: two presses run one plan once, and a refusal in
//     the wallet followed by a press signs the same plan (the same mint) again, with no new prepare.
//   · b-reload-relaunch: after a refusal and a reload the kept review asked with no signed request, so it refused the creator's own
//     unlaunched draft as another coin's ticker and Launch stayed off. The page keeps the press's signed request in the tab
//     (launchReviewSync.ts keptReviewProof); a draft whose create was recorded as sent still gets launch-pending at prepare.
//   · a-published: the card's button lost its arrow; the scenario now clicks the debt card's own button by data attributes.
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Keypair, VersionedTransaction } from "@solana/web3.js";
import { bytesToBase58, failureSentence, launchlabPlan, loadPlanRecord, memoryPlanStorage, planStorageKey, sentAckOf, sentReporter, signAndSendPlan, withPlanLock, type LaunchlabBundleLike, type SentAck } from "@/lib/burnticker/signPlan";
import { openRegistry } from "@/lib/burnticker/registry";
import { lockRule } from "@/lib/burnticker/rules";
import { markCreateSent, prepareLaunch, resetConfirmGuards } from "@/lib/burnticker/api/handlers";
import { limiter } from "@/lib/burnticker/api/http";
import { LAUNCH_PENDING_CODE, launchPendingRefusal } from "@/lib/burnticker/launchPending";
import { keptReviewProof, keptReviewProofText, REVIEW_PROOF_STORE, usableReviewProof } from "@/lib/burnticker/launchReviewSync";
import { parseWalletProof, PROOF_MAX_AGE_MS, signLaunchRequest } from "@/lib/burnticker/walletProof";
import { base58 } from "@/lib/burnticker/vanityMint";
import { sameTickerSentence } from "@/lib/burnticker/lookalike";
import { isPrepareBody, mintSourceOf, prepareStepsOf, preparesOf, sourceCardSelector, USE_SOURCE_SELECTOR } from "../scripts/burnticker-synth/plan.mts";
import { API, POST_HEADERS, callRoute, makeWorld } from "./burntickerApiHelpers.ts";
import { BRONCOS } from "./burntickerHelpers.ts";

// deno-lint-ignore no-explicit-any
type Any = any;
const ROOT = path.join(import.meta.dirname, "..");
const RULE = { ...BRONCOS, pair: null };
const T0 = Date.now();
const BH = "GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi";
const creatorKp = Keypair.generate(), CREATOR = creatorKp.publicKey.toBase58();
beforeEach(() => { limiter.reset(); resetConfirmGuards(); });

const ix = (signer: string, lamports = 1) => ({ programId: "11111111111111111111111111111111", label: "test", dataBase64: Buffer.from([2, 0, 0, 0, lamports, 0, 0, 0, 0, 0, 0, 0]).toString("base64"), keys: [{ pubkey: CREATOR, isSigner: true, isWritable: true }, { pubkey: signer, isSigner: true, isWritable: true }] });
const bundle = (ticker: string): LaunchlabBundleLike => {
  const mint = Keypair.generate();
  return { mint: mint.publicKey.toBase58(), ticker, ready: true, pending: [], mintSecretKey: bytesToBase58(mint.secretKey), transactions: [{ label: "create", signers: ["creator", "mint"], instructions: [ix(mint.publicKey.toBase58(), 2)] }] };
};
function registryWith(...mints: { mint: string; ticker: string }[]) {
  const reg = openRegistry(":memory:");
  for (const m of mints) reg.register({ mint: m.mint, ticker: m.ticker, name: "Synth b", creator: CREATOR, description: "", imageUrl: null, links: [], rulesText: lockRule(RULE).text, feePda: "F", vault: null, tokenConfig: null, poolId: null, launchTx: null, cluster: "devnet", platformId: null, baselineAt: new Date(T0).toISOString(), status: "draft" }, T0);
  return reg;
}
/** A fake wallet (refuses the first `refuse` requests as Phantom does) and a fake chain that records every broadcast. */
function deps(reg: ReturnType<typeof openRegistry>, o: { refuse?: number; slowWalletMs?: number } = {}) {
  const asked: string[] = [], sent: string[] = [];
  let refuse = o.refuse ?? 0;
  return {
    asked, sent,
    latestBlockhash: async () => ({ blockhash: BH, lastValidBlockHeight: 100 }),
    simulate: async () => null,
    signTransaction: async (tx: VersionedTransaction) => {
      asked.push("wallet asked");
      if (o.slowWalletMs) await new Promise((r) => setTimeout(r, o.slowWalletMs));
      if (refuse > 0) { refuse--; throw new Error("User rejected the request."); }
      tx.sign([creatorKp]); return tx;
    },
    lookupTable: async () => null,
    sendRaw: async (raw: Uint8Array) => { const s = bytesToBase58(VersionedTransaction.deserialize(raw).signatures[0]); sent.push(s); return s; },
    confirm: async () => ({ err: null }),
    getBlockHeight: async () => 50,
    getSignatureStatus: async () => null,
    storage: memoryPlanStorage(),
    sentReportWaitMs: 200,
  };
}
const sitePost = (reg: ReturnType<typeof openRegistry>, reports: string[]) => async (body: { mint: string; sentTx: string }): Promise<SentAck> => {
  reports.push(body.mint);
  const a = await markCreateSent({ registry: reg, market: null }, body.mint, body.sentTx);
  return sentAckOf(a.status, a.body, body.mint);
};

describe("b-double-press: Launch pressed twice quickly asks the wallet once per step and broadcasts once", () => {
  test("two presses of the card's button: one run signs and sends, the other is refused by the plan lock before the wallet is asked", async () => {
    const b = bundle("SYDP"); const reg = registryWith({ mint: b.mint, ticker: "SYDP" });
    const plan = launchlabPlan([b]), d = deps(reg, { slowWalletMs: 30 }), reports: string[] = [];
    // the card's go(): withPlanLock(planStorageKey(plan), run), pressed twice in one render (busy still reads false for both)
    const press = () => withPlanLock(planStorageKey(plan), () => signAndSendPlan(plan, CREATOR, { ...d, onSent: sentReporter(plan, sitePost(reg, reports)) }));
    const [p1, p2] = await Promise.all([press(), press()]);
    assert.deepEqual([p1.ran, p2.ran].sort(), [false, true]);
    const ran = (p1.ran ? p1 : p2) as { ran: true; value: Awaited<ReturnType<typeof signAndSendPlan>> };
    assert.equal(ran.value.error, null);
    assert.equal(d.asked.length, plan.steps.length, "exactly one wallet request for the one transaction");
    assert.equal(d.sent.length, 1, "exactly one broadcast");
    assert.deepEqual(reports, [b.mint], "one sent report, recorded before the broadcast");
    assert.equal(reg.createSends(b.mint).length, 1);
  });

  test("the scenario's own count: publish 93's three launch requests are one prepare, and its step count comes from the prepare", () => {
    // what the page posted on publish 93: the prepare (no action), SEC-05's sent report, the launched confirm
    const posts = [
      { body: { creator: CREATOR, ticker: "SYDP" }, status: 200, json: { ok: true, bundle: { mint: "M", transactions: [{}, {}] } } },
      { body: { action: "sent", mint: "M", sentTx: "x" }, status: 200, json: { ok: true, recorded: { mint: "M", sentAt: T0 } } },
      { body: { action: "launched", mint: "M", signature: "s" }, status: 200, json: { ok: true } },
    ];
    assert.equal(preparesOf(posts).length, 1);
    assert.equal(prepareStepsOf(posts), 2, "two wallet requests for a launch of two transactions is right, not 'asked twice for one'");
    assert.equal(isPrepareBody({ action: "sent" }), false); assert.equal(isPrepareBody({ action: "launched" }), false); assert.equal(isPrepareBody({ ticker: "X" }), true);
    // the sent body carries a mint: it is not an address searched in the browser
    const src = mintSourceOf(preparesOf(posts).map((p) => ({ status: p.status, code: null, ownMint: typeof (p.body as { mint?: unknown }).mint === "string" })));
    assert.equal(src, "bank");
    // the old filter (anything but `launched`) is the regression
    assert.equal(posts.filter((p) => (p.body as { action?: string }).action !== "launched").length, 2);
  });
});

describe("b-reject-retry: a refusal in the wallet, then a press, reuses the prepared draft", () => {
  test("the wallet refuses: nothing is sent or recorded; the next press signs the same plan (same mint), asks the wallet once more and sends once", async () => {
    const b = bundle("SYRJ"); const reg = registryWith({ mint: b.mint, ticker: "SYRJ" });
    const plan = launchlabPlan([b]), d = deps(reg, { refuse: 1 }), reports: string[] = [];
    const card = () => withPlanLock(planStorageKey(plan), () => signAndSendPlan(plan, CREATOR, { ...d, onSent: sentReporter(plan, sitePost(reg, reports)) }));
    const first = await card(); assert.ok(first.ran); if (!first.ran) return;
    assert.equal(first.value.failedAt, 0); assert.equal(first.value.state, "not-sent");
    assert.match(failureSentence(first.value, plan.steps.length), /was not signed in the wallet/);
    assert.equal(d.sent.length, 0); assert.deepEqual(reports, [], "no sent report: the refusal came before the report");
    assert.equal(reg.createSends(b.mint).length, 0);
    const rec = loadPlanRecord(d.storage, plan);
    assert.equal(rec?.pending ?? null, null, "the stored record holds nothing pending, so the retry is not stopped");
    const second = await card(); assert.ok(second.ran); if (!second.ran) return;
    assert.equal(second.value.error, null);
    assert.equal(d.asked.length, 2, "the refused request and one new request");
    assert.equal(d.sent.length, 1);
    assert.deepEqual(reports, [b.mint], "the same mint is reported and sent");
    assert.equal(plan.confirms[0].mint, b.mint);
    assert.equal(reg.tokens().filter((t) => t.ticker === "SYRJ").length, 1, "one draft for the ticker");
  });
});

const signer = (k: Keypair) => { const key = crypto.createPrivateKey({ key: { kty: "OKP", crv: "Ed25519", d: Buffer.from(k.secretKey.slice(0, 32)).toString("base64url"), x: Buffer.from(k.publicKey.toBytes()).toString("base64url") }, format: "jwk" }); return async (m: Uint8Array) => new Uint8Array(crypto.sign(null, Buffer.from(m), key)); };

describe("b-reload-relaunch: a refusal, a reload and Launch again from the kept review", () => {
  test("the press's signed request survives the reload and the kept review counts the creator's own unlaunched draft as theirs", async () => {
    const w = await makeWorld();
    const owner = Keypair.generate(), ownerKey = owner.publicKey.toBase58(), mint = Keypair.generate().publicKey.toBase58();
    // the first press: the wallet signed the request (over the ticker and the prepared mint), the prepare wrote the draft, the wallet then refused
    w.registry.register({ mint, ticker: "SYRLNZPV", name: "Synth reload", creator: ownerKey, description: "", imageUrl: null, links: [], rulesText: lockRule(BRONCOS).text, feePda: "F", vault: null, tokenConfig: null, poolId: null, launchTx: null, cluster: "devnet", platformId: null, baselineAt: new Date().toISOString(), status: "draft" });
    const pressProof = await signLaunchRequest(signer(owner), { creator: ownerKey, tickers: ["SYRLNZPV"], mints: [mint] }, base58);
    assert.ok(pressProof);
    // the page keeps it in the tab; the reload reads it back
    const tab = new Map<string, string>([[REVIEW_PROOF_STORE, keptReviewProofText(pressProof)!]]);
    const kept = keptReviewProof(tab.get(REVIEW_PROOF_STORE), PROOF_MAX_AGE_MS, parseWalletProof);
    assert.deepEqual(kept, pressProof);
    assert.deepEqual(usableReviewProof(kept, ownerKey, ["SYRLNZPV"], parseWalletProof), pressProof, "it rides with the review for this wallet and ticker");
    assert.equal(usableReviewProof(kept, Keypair.generate().publicKey.toBase58(), ["SYRLNZPV"], parseWalletProof), null, "never for another wallet");
    assert.equal(usableReviewProof(kept, ownerKey, ["OTHER"], parseWalletProof), null, "never for other tickers");
    const review = async (extra: Record<string, unknown>) => (await (await callRoute(`${API}/launch/review`, { method: "POST", headers: POST_HEADERS, body: JSON.stringify({ rule: BRONCOS, ticker: "SYRLNZPV", name: "Synth reload", ...extra }) })).json()) as Any;
    // publish 93: the reload's review carried no proof, so the creator's own draft read as another coin's ticker. LA-4 (2026-10-19):
    // without a proof it is now a draft-held notice that leaves Launch on (test/burntickerDraftHeldNotice.test.ts), never the refusal
    const before = await review({ creator: ownerKey });
    assert.doesNotMatch(JSON.stringify(before.problems), new RegExp(sameTickerSentence("SYRLNZPV").replace(/[$.]/g, "\\$&")));
    assert.deepEqual(before.notices.map((n: Any) => n.kind), ["draft-held"]);
    // with the kept proof: no ticker refusal, not taken
    const after = await review({ creator: ownerKey, walletProof: kept });
    assert.doesNotMatch(JSON.stringify(after), /already the ticker of another Burnticker coin/);
    assert.equal(after.tickers[0].taken, false);
  });

  test("a kept proof past its age limit, malformed or empty, is not read back", async () => {
    const owner = Keypair.generate();
    const old = await signLaunchRequest(signer(owner), { creator: owner.publicKey.toBase58(), tickers: ["SYOLD"], mints: [] }, base58, Date.now() - PROOF_MAX_AGE_MS - 1_000);
    assert.equal(keptReviewProof(keptReviewProofText(old), PROOF_MAX_AGE_MS, parseWalletProof), null);
    for (const raw of [null, "", "null", "{", JSON.stringify({ message: 1, signature: "x" }), JSON.stringify({ message: "not ours", signature: "x" })]) assert.equal(keptReviewProof(raw, PROOF_MAX_AGE_MS, parseWalletProof), null);
  });

  test("LA7-5: the resumed prepare on a new mint is refused draft-exists with the first mint; on that mint it is admitted; a draft whose create was recorded as sent is refused launch-pending", async () => {
    const w = await makeWorld();
    (w.p as { market: unknown }).market = { getAccountInfo: async () => null };
    const creator = Keypair.generate(), key = creator.publicKey.toBase58();
    const body = { creator: key, ticker: "SYRESUME", name: "Synth resume", rule: RULE, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true } };
    const m1 = Keypair.generate().publicKey.toBase58(), m2 = Keypair.generate().publicKey.toBase58();
    const a = await prepareLaunch(w.p, body, { register: true, mint: m1 });
    assert.ok("ok" in a, JSON.stringify("error" in a ? a.error.body : a).slice(0, 300));
    // the wallet refused, the tab reloaded, Launch again: a new mint for the same creator and ticker
    const refused = await prepareLaunch(w.p, body, { register: true, mint: m2 });
    assert.ok("error" in refused); if (!("error" in refused)) return;
    assert.equal((refused.error.body as { code?: string; mint?: string }).code, "draft-exists"); assert.equal((refused.error.body as { mint?: string }).mint, m1);
    // the page keeps the mint and the prepare key across the reload (LA6-4 / LA7-6), so it resumes on m1
    const b = await prepareLaunch(w.p, body, { register: true, mint: m1 });
    assert.ok("ok" in b, `a never-sent draft is resumed on its own mint: ${JSON.stringify("error" in b ? b.error.body : b).slice(0, 300)}`);
    // once a create is recorded as sent, another mint is the launch-pending case
    assert.equal(w.registry.recordCreateSent(m1, "5".repeat(88), Date.now()), true);
    const m3 = Keypair.generate().publicKey.toBase58();
    const c = await prepareLaunch(w.p, body, { register: true, mint: m3 });
    assert.ok("error" in c); if (!("error" in c)) return;
    assert.equal(c.error.status, 409); assert.equal((c.error.body as { code?: string }).code, LAUNCH_PENDING_CODE);
    assert.notEqual(await launchPendingRefusal({ registry: w.registry, market: null }, { creator: key, ticker: "SYRESUME", exceptMint: m3 }), null);
  });
});

describe("a-published: the published-data browse for the debt source", () => {
  test("the feeds-only browse lists Economics, and its cards include the debt card with a usable source", async () => {
    await makeWorld();
    const cats = (await (await callRoute(`${API}/browse?venue=feed`)).json()) as Any;
    assert.ok(cats.categories.some((c: Any) => c.id === "economics"), JSON.stringify(cats.categories.map((c: Any) => c.id)));
    const j = (await (await callRoute(`${API}/browse?category=economics&venue=feed`)).json()) as Any;
    const debt = j.cards.find((c: Any) => c.title === "U.S. national debt (Debt to the Penny)");
    assert.ok(debt, JSON.stringify(j.cards.map((c: Any) => c.title)));
    assert.equal(debt.venue, "feed"); assert.equal(debt.launchable.ok, true, JSON.stringify(debt.launchable));
    assert.ok(j.cards.every((c: Any) => c.venue === "feed"), "feeds only");
  });

  test("the card and its button carry the attributes the scenario clicks; the scenario no longer looks for the arrow", () => {
    const page = fs.readFileSync(path.join(ROOT, "src/app/burnticker/launch/page.tsx"), "utf8");
    assert.match(page, /data-source-card=\{c\.id\}/);
    assert.match(page, /data-use-source[^>]*>[\s\S]{0,700}?>use this source<\/button>/);
    assert.equal(sourceCardSelector(), "[data-source-card]"); assert.equal(USE_SOURCE_SELECTOR, "button[data-use-source]");
    const script = fs.readFileSync(path.join(ROOT, "scripts/burnticker-synthetic-creator.mts"), "utf8");
    assert.doesNotMatch(script, /use this source →/);
    assert.doesNotMatch(script, /p\.body\.action !== "launched"/, "every prepare count goes through preparesOf");
  });
});
