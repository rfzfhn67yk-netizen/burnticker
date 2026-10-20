// LA-4 (owner on devnet, 2026-10-19): a creator's kept signature passed its 15-minute age limit, the reload's review could not tell the
// creator from a stranger, refused the creator's own unlaunched draft as "already the ticker of another Burnticker coin" and turned
// Launch off with nothing on the page to sign again: a deadlock. A ticker held by a DRAFT, asked with no proven wallet, is now a notice
// (review.notices, kind "draft-held") with Launch on; the press signs, and the prepare lets only the draft's own wallet through.
// HB-86 (hourly audit run 6): the Name step waits for the same review answer, so exact, near and draft-held tickers are said there.
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { Keypair } from "@solana/web3.js";
import { draftHeldSentence, lookalikeHits, lookalikeRefusal, nearDraftSentence, sameTickerSentence, type LookalikeExisting } from "@/lib/burnticker/lookalike";
import { identityRefusals } from "@/lib/burnticker/launchPreflight";
import { draftHeldExpiredSentence, draftHeldNotices, keptReviewProofText, lapsedKeptProof, launchButtonOff } from "@/lib/burnticker/launchReviewSync";
import { parseWalletProof, PROOF_MAX_AGE_MS, signLaunchRequest } from "@/lib/burnticker/walletProof";
import { base58 } from "@/lib/burnticker/vanityMint";
import { lockRule } from "@/lib/burnticker/rules";
import { prepareLaunch, resetConfirmGuards } from "@/lib/burnticker/api/handlers";
import { limiter } from "@/lib/burnticker/api/http";
import { NAME_STEP_CHECKING, nameStepWaitsForReview } from "../src/app/burnticker/launch/fieldChecks.ts";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import { API, POST_HEADERS, callRoute, makeWorld } from "./burntickerApiHelpers.ts";
import { BRONCOS } from "./burntickerHelpers.ts";

// deno-lint-ignore no-explicit-any
type Any = any;
beforeEach(() => { limiter.reset(); resetConfirmGuards(); });
const signer = (k: Keypair) => { const key = crypto.createPrivateKey({ key: { kty: "OKP", crv: "Ed25519", d: Buffer.from(k.secretKey.slice(0, 32)).toString("base64url"), x: Buffer.from(k.publicKey.toBytes()).toString("base64url") }, format: "jwk" }); return async (m: Uint8Array) => new Uint8Array(crypto.sign(null, Buffer.from(m), key)); };

const OWNER = "OwnerWa11et11111111111111111111111111111111", STRANGER = "StrangerWa11et1111111111111111111111111111";
const rows: LookalikeExisting[] = [
  { ticker: "QUAKEM6", name: "Quake six", status: "draft", creator: OWNER },
  { ticker: "BRONCO", name: "Bronco coin", status: "live", creator: OWNER },
];

describe("lookalike.ts: the draft-held kind", () => {
  test("no proven creator, the review's form: an exact ticker held by a draft is a draft-held notice", () => {
    const hits = lookalikeHits({ ticker: "QUAKEM6", name: "Something else", creator: null }, rows, { draftNotice: true });
    assert.deepEqual(hits.map((h) => h.how), ["draft-held"]);
    assert.equal(hits[0].reason, draftHeldSentence("QUAKEM6"));
    assert.doesNotMatch(hits[0].reason, /\bwill\b|\bbuy\b|coming soon|→|\w\/\w/i);
  });
  test("without the review's form (the prepare), the same ask is the ordinary same-ticker refusal", () => {
    const look = lookalikeRefusal({ ticker: "QUAKEM6", name: "Something else", creator: null }, rows);
    assert.ok(look);
    assert.deepEqual(look.hits.map((h) => h.how), ["same-letters"]);
    assert.match(look.reason, /already the ticker of another Burnticker coin/);
  });
  test("the draft's own proven wallet is exempt; another proven wallet is refused, with or without the review's form", () => {
    assert.deepEqual(lookalikeHits({ ticker: "QUAKEM6", name: "x", creator: OWNER }, rows, { draftNotice: true }), []);
    for (const o of [{}, { draftNotice: true }]) {
      const hits = lookalikeHits({ ticker: "QUAKEM6", name: "x", creator: STRANGER }, rows, o);
      assert.deepEqual(hits.map((h) => h.how), ["same-letters"]);
      assert.equal(hits[0].reason, sameTickerSentence("QUAKEM6"));
    }
  });
  test("a LAUNCHED coin's ticker stays refused for everyone, its own creator included, and never becomes a notice", () => {
    for (const creator of [null, OWNER, STRANGER]) {
      const hits = lookalikeHits({ ticker: "BRONCO", name: "x", creator }, rows, { draftNotice: true });
      assert.deepEqual(hits.map((h) => h.how), ["same-letters"], String(creator));
    }
  });
  test("a ticker one letter from a draft's stays a refusal (the creator included) and names the way out", () => {
    for (const creator of [null, OWNER, STRANGER]) {
      const hits = lookalikeHits({ ticker: "QUAKEM7", name: "x", creator }, rows, { draftNotice: true });
      assert.deepEqual(hits.map((h) => h.how), ["one-edit"], String(creator));
      assert.equal(hits[0].reason, nearDraftSentence("QUAKEM7"));
      assert.doesNotMatch(hits[0].reason, /QUAKEM6/, "a draft's ticker is never named");
    }
  });
});

describe("launchPreflight identityRefusals: the notice is split from the refusal", () => {
  test("draft-held alone: code draft-held and no lookalike refusal; with another hit the refusal stays", () => {
    const only = identityRefusals({ ticker: "QUAKEM6", name: "Harmless name" }, { existing: rows, creator: null, draftNotice: true, refuseList: false, reserved: new Set(), majors: new Set() });
    assert.deepEqual(only.map((x) => x.code), ["draft-held"]);
    const both = identityRefusals({ ticker: "QUAKEM6", name: "Bronco coin" }, { existing: rows, creator: null, draftNotice: true, refuseList: false, reserved: new Set(), majors: new Set() });
    assert.deepEqual(both.map((x) => x.code).sort(), ["draft-held", "lookalike"]);
    const prepare = identityRefusals({ ticker: "QUAKEM6", name: "Harmless name" }, { existing: rows, creator: null, refuseList: false, reserved: new Set(), majors: new Set() });
    assert.deepEqual(prepare.map((x) => x.code), ["lookalike"], "without draftNotice nothing changes");
  });
});

describe("the review route and the prepare: a draft whose signature ran out", () => {
  test("no proof: a notice and Launch on; the stranger's proof: refused; the owner's proof: neither; a launched ticker: refused", async () => {
    const w = await makeWorld();
    const owner = Keypair.generate(), ownerKey = owner.publicKey.toBase58(), stranger = Keypair.generate(), strangerKey = stranger.publicKey.toBase58();
    w.registry.register({ mint: Keypair.generate().publicKey.toBase58(), ticker: "SYEXPIRE", name: "Synth expired", creator: ownerKey, description: "", imageUrl: null, links: [], rulesText: lockRule(BRONCOS).text, feePda: "F", vault: null, tokenConfig: null, poolId: null, launchTx: null, cluster: "devnet", platformId: null, baselineAt: new Date().toISOString(), status: "draft" });
    const review = async (ticker: string, extra: Record<string, unknown>) => (await (await callRoute(`${API}/launch/review`, { method: "POST", headers: POST_HEADERS, body: JSON.stringify({ rule: BRONCOS, ticker, name: "Synth expired", ...extra }) })).json()) as Any;
    // the reload after the age limit: the kept proof is dropped, so the review is asked with the wallet and no proof
    const old = await signLaunchRequest(signer(owner), { creator: ownerKey, tickers: ["SYEXPIRE"], mints: [] }, base58, Date.now() - PROOF_MAX_AGE_MS - 60_000);
    for (const extra of [{ creator: ownerKey }, { creator: ownerKey, walletProof: old }]) {
      const r = await review("SYEXPIRE", extra);
      assert.doesNotMatch(JSON.stringify(r.problems), /SYEXPIRE/, "the draft's ticker is not a problem");
      assert.equal(r.fieldProblems.some((x: Any) => x.field === "ticker"), false);
      assert.deepEqual(r.notices, [{ side: "A", field: "ticker", kind: "draft-held", ticker: "SYEXPIRE", text: draftHeldSentence("SYEXPIRE") }]);
    }
    // a stranger who signed: the ordinary same-ticker refusal (Launch off), no notice
    const sp = await signLaunchRequest(signer(stranger), { creator: strangerKey, tickers: ["SYEXPIRE"], mints: [] }, base58);
    const s = await review("SYEXPIRE", { creator: strangerKey, walletProof: sp });
    assert.match(JSON.stringify(s.problems), /already the ticker of another Burnticker coin/);
    assert.deepEqual(s.notices, []);
    // the owner signs again (the Launch press, or the confirm link): no refusal, no notice
    const op = await signLaunchRequest(signer(owner), { creator: ownerKey, tickers: ["SYEXPIRE"], mints: [] }, base58);
    const o = await review("SYEXPIRE", { creator: ownerKey, walletProof: op });
    assert.doesNotMatch(JSON.stringify(o.problems), /already the ticker/);
    assert.deepEqual(o.notices, []);
    // a launched coin's ticker (the world's BRONCO) is refused with no notice, proof or not
    const l = await review(w.bronco.ticker, { creator: ownerKey });
    assert.match(JSON.stringify(l.problems), /already the ticker of another Burnticker coin/);
    assert.deepEqual(l.notices, []);
    // the near ticker: refused (Launch off), naming the way out
    const n = await review("SYEXPIRF", { creator: ownerKey, walletProof: (await signLaunchRequest(signer(owner), { creator: ownerKey, tickers: ["SYEXPIRF"], mints: [] }, base58)) });
    assert.match(JSON.stringify(n.problems), /go back to its own ticker/);
  });

  test("the prepare refuses a stranger's second mint under the draft even with the stranger's own signature; the owner's is admitted", async () => {
    const w = await makeWorld();
    (w.p as { market: unknown }).market = { getAccountInfo: async () => null };
    const owner = Keypair.generate(), ownerKey = owner.publicKey.toBase58(), stranger = Keypair.generate(), strangerKey = stranger.publicKey.toBase58();
    const body = (creator: string) => ({ creator, ticker: "SYHELD", name: "Synth held", rule: { ...BRONCOS, pair: null }, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true } });
    const a = await prepareLaunch(w.p, body(ownerKey), { register: true, mint: Keypair.generate().publicKey.toBase58() });
    assert.ok("ok" in a, JSON.stringify("error" in a ? a.error.body : a).slice(0, 300));
    const walletProof = await signLaunchRequest(signer(stranger), { creator: strangerKey, tickers: ["SYHELD"], mints: [] }, base58);
    const s = await prepareLaunch(w.p, { ...body(strangerKey), walletProof }, { register: true, mint: Keypair.generate().publicKey.toBase58() });
    assert.ok("error" in s); if (!("error" in s)) return;
    assert.equal(s.error.status, 409);
    assert.equal((s.error.body as { code?: string }).code, "ticker-taken");
    const again = await prepareLaunch(w.p, body(ownerKey), { register: true, mint: Keypair.generate().publicKey.toBase58() });
    assert.ok("ok" in again, `the draft's own creator continues: ${JSON.stringify("error" in again ? again.error.body : again).slice(0, 300)}`);
  });
});

describe("copy", () => {
  test("every new sentence passes the copy lint", () => {
    const cfg = loadCopyLintConfig();
    for (const t of [draftHeldSentence("QUAKEM6"), draftHeldExpiredSentence("QUAKEM6", PROOF_MAX_AGE_MS), nearDraftSentence("QUAKEM7"), NAME_STEP_CHECKING]) {
      const r = lintCopy(t, cfg);
      assert.ok(r.ok, `${r.hits.map((h) => `${h.phrase} (${h.rule})`).join(", ")}\n${t}`);
    }
  });
});

describe("the page's pure helpers", () => {
  test("lapsedKeptProof reads back only a well-formed proof past its age limit", async () => {
    const k = Keypair.generate(), key = k.publicKey.toBase58();
    const old = await signLaunchRequest(signer(k), { creator: key, tickers: ["SYOLD"], mints: [] }, base58, Date.now() - PROOF_MAX_AGE_MS - 1_000);
    const fresh = await signLaunchRequest(signer(k), { creator: key, tickers: ["SYOLD"], mints: [] }, base58);
    assert.deepEqual(lapsedKeptProof(keptReviewProofText(old), PROOF_MAX_AGE_MS, parseWalletProof), old);
    assert.equal(lapsedKeptProof(keptReviewProofText(fresh), PROOF_MAX_AGE_MS, parseWalletProof), null);
    for (const raw of [null, "", "{", JSON.stringify({ message: "not ours", signature: "x" })]) assert.equal(lapsedKeptProof(raw, PROOF_MAX_AGE_MS, parseWalletProof), null);
  });
  test("draftHeldNotices: the expired sentence only for this wallet's lapsed signature over that ticker", async () => {
    const k = Keypair.generate(), key = k.publicKey.toBase58();
    const old = await signLaunchRequest(signer(k), { creator: key, tickers: ["QUAKEM6"], mints: [] }, base58, Date.now() - PROOF_MAX_AGE_MS - 1_000);
    const notices = [{ side: "A" as const, field: "ticker", kind: "draft-held", ticker: "QUAKEM6", text: draftHeldSentence("QUAKEM6") }];
    const mine = draftHeldNotices(notices, { lapsed: old, creator: key, maxAgeMs: PROOF_MAX_AGE_MS, parse: parseWalletProof });
    assert.deepEqual(mine, [{ side: "A", ticker: "QUAKEM6", text: draftHeldExpiredSentence("QUAKEM6", PROOF_MAX_AGE_MS), expired: true }]);
    assert.match(mine[0].text, /more than 15 minutes old/);
    assert.equal(draftHeldNotices(notices, { lapsed: old, creator: STRANGER, maxAgeMs: PROOF_MAX_AGE_MS, parse: parseWalletProof })[0].expired, false, "another wallet");
    assert.equal(draftHeldNotices(notices, { lapsed: null, creator: key, maxAgeMs: PROOF_MAX_AGE_MS, parse: parseWalletProof })[0].text, draftHeldSentence("QUAKEM6"));
    assert.deepEqual(draftHeldNotices(undefined, { lapsed: null, creator: key, maxAgeMs: PROOF_MAX_AGE_MS, parse: parseWalletProof }), []);
    for (const t of [mine[0].text, draftHeldSentence("X")]) assert.doesNotMatch(t, /\bwill\b|\bbuy\b|coming soon|→|\w\/\w/i);
  });
  test("launchButtonOff: a notice is not a blocker; problems, field problems, busy, blocked and not ready are", () => {
    const on = { ready: true, busy: false, blocked: false, problems: 0, fieldProblems: 0 };
    assert.equal(launchButtonOff(on), false, "a draft-held notice alone leaves Launch on");
    for (const k of [{ ready: false }, { busy: true }, { blocked: true }, { problems: 1 }, { fieldProblems: 1 }]) assert.equal(launchButtonOff({ ...on, ...k }), true, JSON.stringify(k));
  });
  test("HB-86: the Name step waits for the review answer for the draft on screen, but not on a failed one", () => {
    assert.equal(nameStepWaitsForReview({ reviewCurrent: false, reviewError: null }), true);
    assert.equal(nameStepWaitsForReview({ reviewCurrent: true, reviewError: null }), false);
    assert.equal(nameStepWaitsForReview({ reviewCurrent: false, reviewError: "The review could not be read." }), false);
  });
});
