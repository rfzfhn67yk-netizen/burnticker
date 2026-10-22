// LA7-5 and LA7-6 (seventh pre-launch audit; LA6-2 and LA6-4): a second registering prepare of the same ticker by the same creator on
// another mint, while the first draft was never sent, registered a second draft (a second upload, a second bank key, and for a client
// that never reports "sent", a second create that can land). It is now refused with 409 draft-exists naming the first draft's mint for
// 30 minutes; a retry on that mint reuses the draft. The launch page also keeps its prepare key in the tab's storage, keyed by the draft
// revision, so a reload sends the same key for the same draft.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Keypair } from "@solana/web3.js";
import { prepareLaunch, resetConfirmGuards } from "@/lib/burnticker/api/handlers";
import { limiter } from "@/lib/burnticker/api/http";
import { DRAFT_EXISTS_CODE, OWN_DRAFT_DEDUPE_MS, draftExistsSentence, ownDraftRefusal } from "@/lib/burnticker/launchPending";
import { draftKeys, type KeyStore } from "@/lib/burnticker/prepareKey";
import { lintCopy, loadCopyLintConfig, formatHits } from "@/lib/launch/copyLint";
import type { TokenRow } from "@/lib/burnticker/registry";
import { CREATOR, makeWorld } from "./burntickerApiHelpers.ts";
import { BRONCOS } from "./burntickerHelpers.ts";

const RULE = { ...BRONCOS, pair: null };
const body = { creator: CREATOR, ticker: "DUPE", name: "Dupe", rule: RULE, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true } };

describe("LA7-5: one unsent draft per creator and ticker at a time", () => {
  test("the second prepare on a new mint is refused with draft-exists and the first mint; a retry on that mint reuses the draft", async () => {
    const w = await makeWorld(); limiter.reset(); resetConfirmGuards();
    const m1 = Keypair.generate().publicKey.toBase58(), m2 = Keypair.generate().publicKey.toBase58();
    const a = await prepareLaunch(w.p, body, { register: true, mint: m1 });
    assert.ok("ok" in a, JSON.stringify("error" in a ? a.error.body : a).slice(0, 300));
    const b = await prepareLaunch(w.p, body, { register: true, mint: m2 });
    assert.ok("error" in b, "the second draft is not registered");
    assert.equal(b.error.status, 409);
    const eb = b.error.body as { code?: string; mint?: string; error?: string };
    assert.equal(eb.code, DRAFT_EXISTS_CODE); assert.equal(eb.mint, m1);
    assert.match(eb.error ?? "", /You already prepared a launch of \$DUPE that was not sent \(mint /);
    assert.deepEqual(w.registry.tokens().filter((t) => t.ticker === "DUPE").map((t) => t.mint), [m1]);
    const again = await prepareLaunch(w.p, body, { register: true, mint: m1 });
    assert.ok("ok" in again, JSON.stringify("error" in again ? again.error.body : again).slice(0, 300));
    // a dry run registers nothing and is never refused by it
    const dry = await prepareLaunch(w.p, body, { register: true, dryRun: true, mint: m2 });
    assert.ok(!("error" in dry) || (dry.error.body as { code?: string }).code !== DRAFT_EXISTS_CODE);
  });
  test("an unproven draft (anyone can make one under any address, B-19) never refuses", async () => {
    const w = await makeWorld(); limiter.reset(); resetConfirmGuards();
    const m1 = Keypair.generate().publicKey.toBase58(), m2 = Keypair.generate().publicKey.toBase58();
    assert.ok("ok" in await prepareLaunch(w.p, body, { register: true, mint: m1, client: "6.6.6.6" }));
    const b = await prepareLaunch(w.p, body, { register: true, mint: m2, client: "1.2.3.4" });
    assert.ok(!("error" in b) || (b.error.body as { code?: string }).code !== DRAFT_EXISTS_CODE);
  });
  test("the window: 30 minutes from the draft; a sent, launched or expired draft never counts; another creator's never counts", () => {
    const base: TokenRow = { mint: "M1", ticker: "DUPE", creator: CREATOR, status: "draft", launchTx: null, createdAt: 1_000_000 } as TokenRow;
    const reg = (rows: TokenRow[]) => ({ registry: { tokens: () => rows } as never });
    const at = (ms: number) => ownDraftRefusal(reg([base]), { creator: CREATOR, ticker: "$dupe", exceptMints: [null] }, base.createdAt + ms);
    assert.equal(at(60_000)?.extra.mint, "M1");
    assert.equal(at(OWN_DRAFT_DEDUPE_MS - 1)?.extra.code, DRAFT_EXISTS_CODE);
    assert.equal(at(OWN_DRAFT_DEDUPE_MS), null, "after the window a new draft is allowed");
    for (const r of [{ ...base, launchTx: "sig" }, { ...base, status: "expired" as const }, { ...base, status: "live" as const }, { ...base, creator: "Someone" }]) assert.equal(ownDraftRefusal(reg([r as TokenRow]), { creator: CREATOR, ticker: "DUPE", exceptMints: [] }, base.createdAt + 60_000), null);
    assert.equal(ownDraftRefusal(reg([base]), { creator: CREATOR, ticker: "DUPE", exceptMints: ["M1"] }, base.createdAt + 60_000), null, "its own mint is a retry");
  });
  test("the refusal reads plainly (creator-facing copy)", () => {
    const r = lintCopy(draftExistsSentence("DUPE", "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin", 29.2), loadCopyLintConfig());
    assert.ok(r.ok, formatHits(r));
    assert.match(draftExistsSentence("DUPE", "M", 0.2), /about 1 minute\./);
  });
});

describe("LA7-6: the page's prepare key survives a reload", () => {
  const memStore = (): KeyStore & { v: string | null } => { const s = { v: null as string | null, read: () => s.v, write: (x: string) => { s.v = x; } }; return s; };
  let n = 0;
  const make = () => `draft_${String(++n).padStart(16, "0")}`;
  test("the same revision after a reload gets the same key; a new revision a new one; a rotation is kept too", () => {
    const store = memStore();
    const first = draftKeys(make, store).keyFor("rev-1");
    const reloaded = draftKeys(make, store);   // a new page, the same tab storage
    assert.equal(reloaded.keyFor("rev-1"), first);
    const other = reloaded.keyFor("rev-2");
    assert.notEqual(other, first);
    const rotated = reloaded.rotate("rev-2");
    assert.equal(draftKeys(make, store).keyFor("rev-2"), rotated);
  });
  test("unreadable or throwing storage (private mode) still gives a key", () => {
    const junk = { read: () => "{not json", write: () => {} };
    assert.match(draftKeys(make, junk).keyFor("r"), /^draft_/);
    const throws = { read: () => { throw new Error("denied"); }, write: () => { throw new Error("denied"); } };
    assert.match(draftKeys(make, throws).keyFor("r"), /^draft_/);
    assert.match(draftKeys(make).keyFor("r"), /^draft_/);
  });
  test("the launch page passes its tab store and clears it with the draft", () => {
    const page = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "app", "burnticker", "launch", "page.tsx"), "utf8");
    assert.match(page, /draftKeys\(undefined, PREPARE_KEY_TAB_STORE\)/);
    assert.equal((page.match(/sessionStorage\.removeItem\(PREPARE_KEY_STORE\)/g) ?? []).length, 2, "Start over and a launch that went live clear it");
  });
});
