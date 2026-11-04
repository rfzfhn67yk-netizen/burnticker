// AUDIT 7 F02, F03, F07, F09 (2026-10-19).
//
// F02: the launch page's review effect stuck on "The summary is being updated for this draft" when a draft was edited and put back
// inside the 600 ms debounce. The effect's state machine now lives in createReviewRequester (launchReviewSync.ts); the page's effect
// only calls want(key, body | null) on [step, reviewKey, gate.kind]. No DOM mounting library is installed (no jsdom, testing-library or
// react-test-renderer), so `page()` below mirrors the effect line for line and the requester runs on a fake clock: every timer, request,
// answer and cancel is the real code's.
// F03: the wallet and its proof are part of the revision (reviewIdentity, usableReviewProof, reviewProofExpiresAt).
// F07: an outside image address is never called pinned (imagePin.ts, PinnedCheck.tsx rendered with react-dom/server).
// F09: the image-preview route answers a structured 400 for null, arrays, bare values and malformed JSON.
import "./burntickerRenderTsx.ts";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import sharp from "sharp";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  createReviewRequester, draftRevision, EMPTY_REVIEW_SLOT, launchRevisions, reviewAnswered, reviewFor, reviewIdentity, reviewMatchesDraft, reviewProofExpiresAt,
  reviewRequestDue, reviewRequested, REVIEW_UPDATING, usableReviewProof, type ReviewSlot,
} from "@/lib/burnticker/launchReviewSync";
import { parseWalletProof, PROOF_MAX_AGE_MS, walletProofMessage, type WalletProof } from "@/lib/burnticker/walletProof";
import { IMAGE_OUTSIDE_LINK_LINE, IMAGE_URL_REFUSED, imagePinState, REVIEW_IMAGE_GENERATED, REVIEW_IMAGE_UPLOADED } from "@/lib/burnticker/imagePin";
import { lintCopy } from "@/lib/launch/copyLint";
import { draftKeys } from "@/lib/burnticker/prepareKey";
import { prepareIfCurrent } from "@/lib/burnticker/preparedLaunch";

// ---- a fake clock and a fake server ------------------------------------------------------------------------------------------------
class Clock {
  now = 0; private seq = 0; private timers = new Map<number, { at: number; f: () => void }>();
  set = (f: () => void, ms: number) => { const id = ++this.seq; this.timers.set(id, { at: this.now + ms, f }); return id; };
  clear = (t: unknown) => { this.timers.delete(t as number); };
  get pending() { return this.timers.size; }
  async tick(ms: number) {
    const end = this.now + ms;
    for (;;) {
      const next = [...this.timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!next) break;
      this.timers.delete(next[0]); this.now = next[1].at; next[1].f();
      await flush();
    }
    this.now = end; await flush();
  }
}
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

type Body = { key: string; creator?: string; walletProof?: WalletProof };
interface Sent { body: Body; resolve: (v: string) => void; reject: (e: unknown) => void }
const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });
const transient = (e: unknown) => /^HTTP (429|502|503|504)\b/.test(String((e as Error)?.message));

function harness() {
  const clock = new Clock(), sent: Sent[] = [];
  let slot: ReviewSlot<string> = EMPTY_REVIEW_SLOT;
  const r = createReviewRequester<string, Body>({
    send: (body) => new Promise<string>((resolve, reject) => { sent.push({ body, resolve, reject }); }),
    onSlot: (s) => { slot = s; }, debounceMs: 600, retryMax: 3, transient, retryingLine: "RETRYING", describe: (e) => `failed: ${(e as Error).message}`,
    setTimer: clock.set, clearTimer: clock.clear,
  });
  // the page: the key is the draft's fields plus who asks (F03); the effect runs when step, key or gate.kind change
  const st = { fields: "A", creator: "", proof: null as WalletProof | null, step: "review", gate: "ready", rule: true as boolean };
  let lastDeps = "";
  const key = () => { const proof = usableReviewProof(st.proof, st.creator, ["AAA"], parseWalletProof); return draftRevision([st.fields, reviewIdentity(st.creator, proof)]); };
  const render = (o: { force?: boolean } = {}) => {
    const k = key(), deps = JSON.stringify([st.step, k, st.gate]);
    if (deps !== lastDeps || o.force) {   // React runs the effect only when a dependency changed; `force` is a StrictMode double run
      lastDeps = deps;
      const active = st.step === "review" && st.rule && st.gate !== "loading";
      const proof = usableReviewProof(st.proof, st.creator, ["AAA"], parseWalletProof);
      r.want(k, active ? { key: st.fields, ...(st.creator ? { creator: st.creator } : {}), ...(proof ? { walletProof: proof } : {}) } : null);
    }
    return { shown: reviewFor(slot, k), launchable: reviewMatchesDraft(slot, k), line: reviewMatchesDraft(slot, k) ? null : REVIEW_UPDATING };
  };
  const set = (patch: Partial<typeof st>) => { Object.assign(st, patch); return render(); };
  return { clock, sent, r, st, set, render, get slot() { return slot; } };
}

const W1 = "8XrHxHqC5m8f3aQGQ2r9yQh1b1CqfGq7m8YyM9u7pump", W2 = "9YsJyJrD6n9g4bRHR3s1zRi2c2DrgHr8n9ZzN1v8abcd";
const proofFor = (creator: string, tickers: string[], issuedAt: number): WalletProof => ({
  message: walletProofMessage({ origin: "https://burnticker.com", creator, tickers, mints: null, nonce: "abcdefghijklmnop" + creator.slice(0, 4), issuedAt: new Date(issuedAt).toISOString() }),
  signature: `sig-${creator.slice(0, 6)}-${issuedAt}`,
});

describe("F02: the pure check is judged against the slot", () => {
  test("due when the slot holds another revision, nothing, or an answered error; not when it holds a review or a request in flight", () => {
    assert.equal(reviewRequestDue(EMPTY_REVIEW_SLOT, "A"), true);
    const a = reviewRequested(EMPTY_REVIEW_SLOT, "A", 1);
    assert.equal(reviewRequestDue(a, "A"), false, "in flight");
    assert.equal(reviewRequestDue(a, "B"), true);
    const answered = reviewAnswered(a, "A", { rev: "A", seq: 1, review: "ok" });
    assert.equal(reviewRequestDue(answered, "A"), false, "a same-key review is used as it is");
    assert.equal(reviewRequestDue(reviewAnswered(a, "A", { rev: "A", seq: 1, error: "x" }), "A"), true, "a failure may be asked again");
    const refreshing = reviewRequested(answered, "A", 2);
    assert.equal(reviewRequestDue(refreshing, "A"), false);
  });
});

describe("F02: the review requester on a fake clock (the page's effect, mirrored)", () => {
  test("the finding: A answered, B typed and A put back inside the debounce keeps A's review and Launch", async () => {
    const h = harness();
    h.render(); await h.clock.tick(600);
    assert.equal(h.sent.length, 1); h.sent[0].resolve("review A"); await flush();
    assert.equal(h.render().launchable, true);
    let v = h.set({ fields: "B" });
    assert.equal(v.launchable, false); assert.equal(v.shown.loading, true, "B is being read");
    await h.clock.tick(300);
    v = h.set({ fields: "A" });
    assert.equal(h.clock.pending, 0, "B's timer was cancelled");
    await h.clock.tick(5_000);
    assert.equal(h.sent.length, 1, "B was never sent and A is not asked again");
    assert.equal(v.launchable, true); assert.equal(v.shown.review, "review A"); assert.equal(v.line, null);
  });
  test("the finding with nothing answered yet: A in flight, B typed and put back; A's answer still lands", async () => {
    const h = harness();
    h.render(); await h.clock.tick(600);
    h.set({ fields: "B" }); await h.clock.tick(200); h.set({ fields: "A" });
    await h.clock.tick(2_000);
    assert.equal(h.sent.length, 1);
    h.sent[0].resolve("review A"); await flush();
    assert.equal(h.render().launchable, true);
  });
  test("A to B inside the debounce sends only B", async () => {
    const h = harness();
    h.render(); await h.clock.tick(300); h.set({ fields: "B" }); await h.clock.tick(600);
    assert.deepEqual(h.sent.map((s) => s.body.key), ["B"]);
  });
  test("A to B after B went out, then back to A: A is asked again and B's late answer is dropped", async () => {
    const h = harness();
    h.render(); await h.clock.tick(600); h.sent[0].resolve("review A"); await flush();
    h.set({ fields: "B" }); await h.clock.tick(600);
    assert.equal(h.sent.length, 2);
    let v = h.set({ fields: "A" });
    assert.equal(v.launchable, false, "the slot moved to B when B was sent");
    await h.clock.tick(600);
    assert.equal(h.sent.length, 3);
    h.sent[1].resolve("review B"); await flush();
    assert.equal(h.render().shown.review, null, "B's answer is not shown for A");
    h.sent[2].resolve("review A again"); await flush();
    v = h.render(); assert.equal(v.launchable, true); assert.equal(v.shown.review, "review A again");
  });
  test("out of order: the older request answering last is dropped", async () => {
    const h = harness();
    h.render(); await h.clock.tick(600); h.set({ fields: "B" }); await h.clock.tick(600);
    h.sent[1].resolve("review B"); await flush();
    h.sent[0].resolve("review A"); await flush();
    assert.equal(h.render().shown.review, "review B");
  });
  test("A-22: the gate finishing loading and unrelated re-renders send one request per draft", async () => {
    const h = harness();
    h.set({ gate: "loading" }); await h.clock.tick(5_000);
    assert.equal(h.sent.length, 0, "nothing while the gate loads");
    h.set({ gate: "ready" }); h.render(); h.render({ force: true }); await h.clock.tick(600);
    assert.equal(h.sent.length, 1);
    h.sent[0].resolve("review A"); await flush();
    h.set({ gate: "open" }); h.render({ force: true }); h.set({ step: "name" }); h.set({ step: "review" }); await h.clock.tick(5_000);
    assert.equal(h.sent.length, 1, "a held review is used as it is");
  });
  test("leaving the step inside the debounce cancels the timer and owns nothing; coming back asks", async () => {
    const h = harness();
    h.render(); await h.clock.tick(300); h.set({ step: "name" }); await h.clock.tick(5_000);
    assert.equal(h.sent.length, 0);
    h.set({ step: "review" }); await h.clock.tick(600);
    assert.equal(h.sent.length, 1);
  });
  test("cancel (unmount) clears the debounce; a StrictMode remount asks again", async () => {
    const h = harness();
    h.render(); h.r.cancel(); await h.clock.tick(5_000);
    assert.equal(h.sent.length, 0);
    h.render({ force: true }); await h.clock.tick(600);
    assert.equal(h.sent.length, 1);
  });
  test("a rejected request says why and is asked again on the next visit, not on its own", async () => {
    const h = harness();
    h.render(); await h.clock.tick(600); h.sent[0].reject(httpError(400)); await flush();
    let v = h.render();
    assert.equal(v.shown.error, "failed: HTTP 400"); assert.equal(v.shown.loading, false); assert.equal(v.launchable, false);
    await h.clock.tick(60_000);
    assert.equal(h.sent.length, 1);
    h.set({ step: "name" }); h.set({ step: "review" }); await h.clock.tick(600);
    assert.equal(h.sent.length, 2);
    h.sent[1].resolve("review A"); await flush();
    v = h.render(); assert.equal(v.launchable, true); assert.equal(v.shown.error, null);
  });
  test("a send that throws at once is an error, not a stuck summary", async () => {
    const clock = new Clock(); let slot: ReviewSlot<string> = EMPTY_REVIEW_SLOT;
    const r = createReviewRequester<string, object>({ send: () => { throw new Error("offline"); }, onSlot: (s) => { slot = s; }, setTimer: clock.set, clearTimer: clock.clear });
    r.want("A", {}); await clock.tick(600);
    assert.deepEqual(reviewFor(slot, "A"), { review: null, loading: false, error: "offline" });
  });
  test("the retry ladder: a busy server is asked again after 2, 4 and 8 s, then the failure is said; nothing extra inside a pause", async () => {
    const h = harness();
    h.render(); await h.clock.tick(600);
    for (const [i, pause] of [[0, 2_000], [1, 4_000], [2, 8_000]] as const) {
      h.sent[i].reject(httpError(429)); await flush();
      assert.equal(h.render().shown.error, "RETRYING");
      h.render({ force: true }); h.set({ gate: "open" }); h.set({ gate: "ready" });   // unrelated runs inside the pause
      await h.clock.tick(pause - 1); assert.equal(h.sent.length, i + 1, `round ${i + 1} waits its pause`);
      await h.clock.tick(1 + 600); assert.equal(h.sent.length, i + 2);
    }
    h.sent[3].reject(httpError(503)); await flush();
    assert.equal(h.render().shown.error, "failed: HTTP 503");
    await h.clock.tick(60_000); assert.equal(h.sent.length, 4, "three rounds, then it stops");
  });
  test("a new draft during a pause drops that draft's ladder; the new draft starts its own count", async () => {
    const h = harness();
    h.render(); await h.clock.tick(600); h.sent[0].reject(httpError(502)); await flush();
    h.set({ fields: "B" }); await h.clock.tick(600);
    assert.deepEqual(h.sent.map((s) => s.body.key), ["A", "B"]);
    await h.clock.tick(20_000); assert.equal(h.sent.length, 2, "A's retry never fires");
    h.sent[1].reject(httpError(502)); await flush(); await h.clock.tick(2_600);
    assert.deepEqual(h.sent.map((s) => s.body.key), ["A", "B", "B"]);
  });
  test("a late failure for an older request does not start a ladder or touch the slot", async () => {
    const h = harness();
    h.render(); await h.clock.tick(600); h.set({ fields: "B" }); await h.clock.tick(600);
    h.sent[0].reject(httpError(429)); await flush(); await h.clock.tick(20_000);
    assert.equal(h.sent.length, 2); assert.equal(h.render().shown.loading, true);
  });
});

describe("F03: who asks is part of the review", () => {
  test("connect, switch and disconnect with the fields unchanged each ask again; a late answer for the old wallet is dropped", async () => {
    const h = harness();
    h.render(); await h.clock.tick(600); h.sent[0].resolve("anonymous"); await flush();
    let v = h.set({ creator: W1 });
    assert.equal(v.launchable, false, "connecting a wallet invalidates the anonymous review");
    await h.clock.tick(600);
    assert.equal(h.sent[1].body.creator, W1);
    h.set({ creator: W2 }); await h.clock.tick(600);
    assert.equal(h.sent[2].body.creator, W2);
    h.sent[1].resolve("for W1"); await flush();
    assert.equal(h.render().shown.review, null, "W1's answer arrives after the switch and is dropped");
    h.sent[2].resolve("for W2"); await flush();
    v = h.render(); assert.equal(v.shown.review, "for W2"); assert.equal(v.launchable, true);
    h.set({ creator: "" }); await h.clock.tick(600);
    assert.equal(h.sent.length, 4); assert.equal(h.sent[3].body.creator, undefined);
  });
  test("the proof arriving after the review asks again with it; one from another wallet or for other tickers is not sent", async () => {
    const h = harness();
    h.set({ creator: W1 }); await h.clock.tick(600); h.sent[0].resolve("taken"); await flush();
    h.set({ proof: proofFor(W2, ["AAA"], Date.now()) }); await h.clock.tick(600);
    assert.equal(h.sent.length, 1, "a proof signed by another wallet changes nothing");
    h.set({ proof: proofFor(W1, ["BBB"], Date.now()) }); await h.clock.tick(600);
    assert.equal(h.sent.length, 1, "a proof over other tickers changes nothing");
    const p = proofFor(W1, ["AAA"], Date.now());
    assert.equal(h.set({ proof: p }).launchable, false);
    await h.clock.tick(600);
    assert.equal(h.sent.length, 2); assert.deepEqual(h.sent[1].body.walletProof, p);
    h.sent[1].resolve("yours"); await flush();
    assert.equal(h.render().shown.review, "yours");
    h.set({ proof: null }); await h.clock.tick(600);   // the page drops the proof at its age limit
    assert.equal(h.sent.length, 3); assert.equal(h.sent[2].body.walletProof, undefined);
  });
  test("helpers: identity, usable proof and expiry", () => {
    const t0 = Date.parse("2026-10-19T12:00:00.000Z"), p = proofFor(W1, ["aaa", "bbb"], t0);
    assert.deepEqual(reviewIdentity("", p), ["", ""], "no wallet, no proof");
    assert.deepEqual(reviewIdentity(W1, p), [W1, p.signature]);
    assert.equal(usableReviewProof(p, W1, ["BBB", "AAA"], parseWalletProof), p, "ticker order and case do not matter");
    assert.equal(usableReviewProof(p, W1, ["AAA"], parseWalletProof), null);
    assert.equal(usableReviewProof(p, "", ["AAA", "BBB"], parseWalletProof), null);
    assert.equal(usableReviewProof({ message: "junk", signature: "x" }, W1, ["AAA"], parseWalletProof), null);
    assert.equal(reviewProofExpiresAt(p, PROOF_MAX_AGE_MS, parseWalletProof), t0 + PROOF_MAX_AGE_MS);
    assert.equal(reviewProofExpiresAt(null, PROOF_MAX_AGE_MS, parseWalletProof), null);
    assert.notEqual(draftRevision(["A", reviewIdentity(W1, null)]), draftRevision(["A", reviewIdentity(W2, null)]));
  });
  test("the page wires it: the proof is filtered, expires, and rides in the key", () => {
    const page = fs.readFileSync("src/app/burnticker/launch/page.tsx", "utf8");
    assert.match(page, /const sentProof = usableReviewProof\(reviewProof, creator, \[ticker, \.\.\.\(pairOn \? \[tickerB\] : \[\]\)\], parseWalletProof\);/);
    assert.match(page, /reviewProofExpiresAt\(reviewProof, PROOF_MAX_AGE_MS, parseWalletProof\)/);
    assert.match(page, /\.\.\.\(sentProof \? \{ walletProof: sentProof \} : \{\}\)/);
    assert.doesNotMatch(page, /reviewAsked|reviewRetry/, "the old last-asked bookkeeping is gone");
  });
});

describe("F07: an outside image is never called pinned", () => {
  const sha = "ab".repeat(32);
  test("imagePinState", () => {
    assert.equal(imagePinState({ imageUri: "https://arweave.net/x", imageSha256: sha }), "pinned");
    assert.equal(imagePinState({ imageUri: "https://example.com/a.png", imageSha256: null }), "outside");
    assert.equal(imagePinState({ imageUri: "https://example.com/a.png", imageSha256: "" }), "outside", "pin.ts stores an empty hash for a URL");
    assert.equal(imagePinState({ imageUri: "https://arweave.net/x", imageSha256: "not-a-hash" }), "outside");
    assert.equal(imagePinState({ imageUri: null, imageSha256: null }), "none");
  });
  const view = (imageUri: string | null, imageSha256: string | null) => ({ mint: W1, metadataUri: "https://arweave.net/meta", metadataSha256: "cd".repeat(32), imageUri, imageSha256, hosted: false, expectedDescription: "x" });
  test("the pinned check on the coin page says which", async () => {
    const { PinnedCheck } = await import("../src/app/burnticker/_components/PinnedCheck.tsx");
    const outside = renderToStaticMarkup(createElement(PinnedCheck, { pinned: view("https://example.com/a.png", null) }));
    assert.doesNotMatch(outside, /pinned too/);
    assert.ok(outside.includes(IMAGE_OUTSIDE_LINK_LINE.replace(/'/g, "&#x27;")), outside);
    assert.match(outside, /href="https:\/\/example\.com\/a\.png" rel="noopener noreferrer nofollow ugc"/);
    const pinned = renderToStaticMarkup(createElement(PinnedCheck, { pinned: view("https://arweave.net/img", sha) }));
    assert.match(pinned, /pinned too<\/a> \(sha256 <span class="font-mono">abababababab…<\/span>\)/);
    assert.doesNotMatch(pinned, /data-image-outside/);
    const none = renderToStaticMarkup(createElement(PinnedCheck, { pinned: view(null, null) }));
    assert.doesNotMatch(none, /pinned too|data-image-outside/);
  });
  test("before the creator pays: no outside link reaches a new bundle (2026-10-19), and the review card's Image row says what is pinned", () => {
    // an imageUrl is refused at the handler (burntickerImageUrlRefused.test.ts), so the bundle's outside-link note could no longer occur
    const bundle = fs.readFileSync("src/lib/burnticker/launchBundle.ts", "utf8");
    assert.doesNotMatch(bundle, /IMAGE_OUTSIDE_LINK_NOTE/);
    const card = fs.readFileSync("src/app/burnticker/launch/ReviewCard.tsx", "utf8");
    assert.match(card, /row\("Image", c\.image\.startsWith\("data:"\) \? REVIEW_IMAGE_UPLOADED : REVIEW_IMAGE_GENERATED, "image", "image"\)/);
  });
  test("the new lines pass the copy lint", () => {
    for (const line of [IMAGE_OUTSIDE_LINK_LINE, IMAGE_URL_REFUSED, REVIEW_IMAGE_UPLOADED, REVIEW_IMAGE_GENERATED, "The request body has to be an object with an image in it.", "The request body is not valid JSON."]) {
      const r = lintCopy(line, undefined, { scope: "platform" });
      assert.equal(r.ok, true, `${line}: ${JSON.stringify(r)}`);
    }
  });
});

describe("F09: the image-preview route refuses a body that is not an object", () => {
  const url = "https://burnticker.com/api/burnticker/launch/image-preview";
  let ip = 10;
  const req = (body: string) => new Request(url, { method: "POST", headers: { "content-type": "application/json", "sec-fetch-site": "same-origin", "x-forwarded-for": `198.51.100.${ip++}` }, body });
  test("null, arrays, bare values and malformed JSON answer a structured 400", async () => {
    const { POST } = await import("@/app/api/burnticker/launch/image-preview/route");
    for (const [body, code] of [["null", "invalid-body"], ["[]", "invalid-body"], ['[{"image":1}]', "invalid-body"], ["7", "invalid-body"], ['"x"', "invalid-body"], ["true", "invalid-body"], ["{nope", "invalid-json"], ["", "invalid-json"]] as const) {
      const r = await POST(req(body));
      assert.equal(r.status, 400, body);
      const j = await r.json() as { error: string; code: string };
      assert.equal(j.code, code, body); assert.equal(typeof j.error, "string");
    }
    const empty = await POST(req("{}"));
    assert.equal(empty.status, 400); assert.equal((await empty.json() as { code: string }).code, "image-refused", "an object without an image still reads as a refused image");
  });
  test("a valid image still renders", async () => {
    const { POST } = await import("@/app/api/burnticker/launch/image-preview/route");
    const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 200, g: 40, b: 40 } } }).png().toBuffer();
    const r = await POST(req(JSON.stringify({ image: { contentType: "image/png", base64: png.toString("base64") } })));
    assert.equal(r.status, 200);
    const j = await r.json() as { contentType: string; base64: string; bytes: number };
    assert.match(j.contentType, /^image\//); assert.ok(j.bytes > 0 && j.base64.length > 0);
  });
});

// SECOND AUDIT 2026-10-19 I-12: the review key carries the wallet and the proof (F03), and it was also the prepare's idempotency key and
// the stale-press check, so a proof reaching its 15-minute limit or a wallet change during a Launch press made the page treat a finished,
// paid prepare as stale; the next press uploaded and reserved again. The page now keeps two revisions (launchRevisions): `draft` for the
// prepare key and the stale check, `review` for the requester. This mirrors the page's launch() line for line with the real helpers.
describe("I-12: a proof or wallet change mid-press does not invalidate the prepare", () => {
  const T = Date.parse("2026-10-19T12:00:00Z");
  const fields = ["rule", "AAA", "name", "note", null, [], {}, "0", ["profile"], ""];
  /** One render of the page: the two revisions for the form and the identity of that moment. */
  const render = (creator: string, proof: WalletProof | null, now: number) => {
    const sent = proof && now < (reviewProofExpiresAt(proof, PROOF_MAX_AGE_MS, parseWalletProof) ?? 0) ? usableReviewProof(proof, creator, ["AAA"], parseWalletProof) : null;
    return launchRevisions(fields, reviewIdentity(creator, sent));
  };

  test("the review revision moves with the proof and the wallet; the draft revision does not", () => {
    const p = proofFor(W1, ["AAA"], T);
    const signed = render(W1, p, T + 60_000), expired = render(W1, p, T + PROOF_MAX_AGE_MS + 1), other = render(W2, null, T + 60_000), none = render(W1, null, T);
    assert.notEqual(signed.review, expired.review, "an expired proof asks the review again");
    assert.notEqual(signed.review, other.review, "another wallet asks the review again");
    assert.equal(signed.draft, expired.draft); assert.equal(signed.draft, other.draft); assert.equal(signed.draft, none.draft);
    assert.equal(signed.review, draftRevision([...fields, reviewIdentity(W1, p)]), "the review key is the one F03 introduced");
    assert.notEqual(render(W1, p, T).draft, launchRevisions([...fields.slice(0, 1), "BBB", ...fields.slice(2)], reviewIdentity(W1, p)).draft, "an edit is a new draft");
  });

  test("the proof expires while the Launch press is in flight: the prepare answer stays current and the next press reuses the same key", async () => {
    let made = 0;
    const keys = draftKeys(() => `draft_k${++made}`);
    const p = proofFor(W1, ["AAA"], T);
    let cur = render(W1, p, T + PROOF_MAX_AGE_MS - 1_000);   // pressed one second before the proof's limit
    const sentRev = cur.draft;
    const key1 = keys.keyFor(cur.draft);
    let prepares = 0;
    const out = await prepareIfCurrent(sentRev, () => cur.draft, async () => {
      prepares++;
      cur = render(W1, p, T + PROOF_MAX_AGE_MS + 5_000);   // the page re-renders mid-request: the proof is dropped at its limit
      return { bundle: "paid" };
    });
    assert.deepEqual(out, { ok: { bundle: "paid" } }, "the paid prepare is not set aside as stale");
    assert.equal(keys.keyFor(cur.draft), key1, "a second press sends the same idempotency key (the server answers with the first draft)");
    // the wallet switches too: still the same draft and the same key
    cur = render(W2, null, T + PROOF_MAX_AGE_MS + 6_000);
    assert.equal(keys.keyFor(cur.draft), key1);
    assert.equal(made, 1); assert.equal(prepares, 1);
    // an edit of the coin itself does set the press aside and starts a new key
    const edited = launchRevisions([...fields.slice(0, 2), "renamed", ...fields.slice(3)], reviewIdentity(W1, null)).draft;
    const stale = await prepareIfCurrent(cur.draft, () => edited, async () => ({ bundle: "x" }));
    assert.deepEqual(stale, { stale: true });
    assert.notEqual(keys.keyFor(edited), key1);
    // idempotency-key-reused rotates the current draft's key
    const rotated = keys.rotate(edited);
    assert.equal(keys.keyFor(edited), rotated);
  });
});
