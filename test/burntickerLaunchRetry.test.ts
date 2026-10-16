// Prelaunch audits 2026-10-15, block B, the prepare side of a launch:
//   F3 an unchanged pair retry was refused (the stored side-A rule carries the pair clause the request does not; a new pair id would be picked);
//   F4 a retry with changed details pinned a second metadata file while the registry kept the first;
//   H4 checks run before a bank key is taken; failed uploads do not count; one wallet has its own daily pin cap; uploads time out;
//   M2 one prepare per draft (the idempotency key).
import { describe, test, before } from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey } from "@solana/web3.js";
import { prepareLaunch, DEFAULT_PIN_CREATOR_DAILY_CAP } from "@/lib/burnticker/api/handlers";
import { FakePinUploader, sha256Hex, withUploadTimeout } from "@/lib/burnticker/pin";
import { IdempotentRuns, bodyFingerprint } from "@/lib/burnticker/api/idempotency";
import { keyRotatingFetch, withNewBase } from "@/lib/burnticker/prepareKey";
import { safeErrorText } from "@/lib/burnticker/api/errorText";
import { testMintBank } from "./burntickerApiHelpers.ts";
import { limiter } from "@/lib/burnticker/api/http";
import { lintCopy } from "@/lib/launch/copyLint";
import { CREATOR, makeWorld, type World } from "./burntickerApiHelpers.ts";
import { BRONCOS } from "./burntickerHelpers.ts";

const RULE = { ...BRONCOS, binary: { onYes: null, onNo: { fractionOfPool: 0.02 } }, pair: null };
const mintPk = () => Keypair.generate().publicKey.toBase58();
const png = (c: string) => import("sharp").then(async (s) => new Uint8Array(await s.default({ create: { width: 64, height: 64, channels: 3, background: c } }).png().toBuffer()));
type R = Awaited<ReturnType<typeof prepareLaunch>>;
const code = (r: R) => ("error" in r ? (r.error.body as { code?: string }).code : "ok");
const today = () => new Date().toISOString().slice(0, 10);

describe("F3: an unchanged pair launch can be retried with the same addresses", () => {
  let w: World;
  before(async () => { w = await makeWorld(); });
  const pairBody = (over: Record<string, unknown> = {}) => ({ creator: CREATOR, ticker: "MILEHI", name: "Mile High", rule: RULE, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true }, creatorDescription: "Orange and blue.",
    pair: { ticker: "ARROWHD", name: "Arrowhead", description: "", imageUrl: null, links: [], creatorDescription: "Red and gold." }, ...over });
  test("same mints, same body: the same pair id, drafts and row; nothing pinned again (before: 409 own-draft-changed)", async () => {
    const A = mintPk(), B = mintPk(), up = w.p.uploader as FakePinUploader;
    const first = await prepareLaunch(w.p, pairBody(), { register: true, mint: A, mintB: B });
    assert.ok("pair" in first, JSON.stringify(first).slice(0, 300));
    const uploads = up.uploads.length;
    const again = await prepareLaunch(w.p, pairBody(), { register: true, mint: A, mintB: B });
    assert.ok("pair" in again, `retry: ${JSON.stringify("error" in again ? again.error.body : again).slice(0, 300)}`);
    assert.equal(again.pair.pairId, first.pair.pairId, "the recorded pair id, not a free -2");
    assert.equal(again.pair.bundles.a.rules.text, first.pair.bundles.a.rules.text);
    assert.equal(again.pair.bundles.b.rules.text, first.pair.bundles.b.rules.text);
    assert.deepEqual(again.pair.row, first.pair.row);
    assert.equal(up.uploads.length, uploads, "the retry reuses both metadata files");
  });
  test("a changed rule on the same addresses is still refused", async () => {
    const A = mintPk(), B = mintPk();
    assert.equal(code(await prepareLaunch(w.p, pairBody({ ticker: "PEAKS", name: "Peaks", pair: { ...pairBody().pair, ticker: "PLAINS", name: "Plains" } }), { register: true, mint: A, mintB: B })), "ok");
    const changed = await prepareLaunch(w.p, pairBody({ ticker: "PEAKS", name: "Peaks", rule: { ...RULE, binary: { onYes: null, onNo: { fractionOfPool: 0.05 } } }, pair: { ...pairBody().pair, ticker: "PLAINS", name: "Plains" } }), { register: true, mint: A, mintB: B });
    assert.equal(code(changed), "own-draft-changed");
  });
  test("one side already created on chain: the retry is refused naming that mint, never a second create", async () => {
    const A = mintPk(), B = mintPk();
    const body = pairBody({ ticker: "SUMMIT", name: "Summit", pair: { ...pairBody().pair, ticker: "VALLEY", name: "Valley" } });
    assert.equal(code(await prepareLaunch(w.p, body, { register: true, mint: A, mintB: B })), "ok");
    const market = w.p.market, n = (w.p.uploader as FakePinUploader).uploads.length;
    w.p.market = { getAccountInfo: async (k: { toBase58(): string }) => (k.toBase58() === A ? { lamports: 1 } : null) } as never;
    try {
      const r = await prepareLaunch(w.p, body, { register: true, mint: A, mintB: B });
      // the anti-clone guard (mint-exists: the address is already on chain) answers before the side-A check; either way nothing is built or pinned
      assert.ok(["pair-side-a-created", "mint-exists"].includes(String(code(r))), String(code(r)));
      assert.equal((w.p.uploader as FakePinUploader).uploads.length, n);
    } finally { w.p.market = market; }
  });
});

describe("F4: one draft, one metadata file", () => {
  let w: World;
  before(async () => { w = await makeWorld(); });
  const body = (over: Record<string, unknown> = {}) => ({ creator: CREATOR, ticker: "ONEMETA", name: "One Meta", rule: RULE, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true }, creatorDescription: "Orange.", links: [{ label: "website", url: "https://example.com" }], ...over });
  test("an identical retry reuses the file; the URI it returns is the stored one and the stored hash matches the file", async () => {
    const M = mintPk(), up = w.p.uploader as FakePinUploader;
    const first = await prepareLaunch(w.p, body(), { register: true, mint: M });
    assert.ok("ok" in first, JSON.stringify(first).slice(0, 300));
    const n = up.uploads.length;
    const again = await prepareLaunch(w.p, body(), { register: true, mint: M });
    assert.ok("ok" in again, JSON.stringify("error" in again ? again.error.body : again).slice(0, 300));
    assert.equal(up.uploads.length, n, "nothing uploaded again");
    const meta = w.registry.tokenMeta(M)!;
    assert.equal(again.ok.bundle.metadataUri, meta.metadataUri);
    assert.equal(first.ok.bundle.metadataUri, meta.metadataUri);
    assert.equal(sha256Hex(up.get(meta.metadataTx!)!), meta.metadataSha256, "the file behind the URI is the one the registry hashed");
  });
  for (const [what, over] of [["name", { name: "Other Meta" }], ["description", { creatorDescription: "Blue." }], ["links", { links: [{ label: "website", url: "https://example.org" }] }]] as const) {
    test(`a changed ${what} on the same address is refused before anything is uploaded (before: a second file, the registry kept the first)`, async () => {
      const M = mintPk(), up = w.p.uploader as FakePinUploader;
      assert.equal(code(await prepareLaunch(w.p, body({ ticker: `M${what.slice(0, 4).toUpperCase()}` }), { register: true, mint: M })), "ok");
      const n = up.uploads.length, budget = w.registry.getStatus(`pin.budget.${today()}`);
      const r = await prepareLaunch(w.p, body({ ticker: `M${what.slice(0, 4).toUpperCase()}`, ...over }), { register: true, mint: M });
      assert.equal(code(r), "own-draft-changed");
      assert.match(String(("error" in r ? (r.error.body as { error: string }).error : "")), /different name, description, links or image/);
      assert.equal(up.uploads.length, n, "nothing uploaded");
      assert.equal(w.registry.getStatus(`pin.budget.${today()}`), budget, "nothing counted");
    });
  }
  test("a changed image is refused; the same image again is a safe retry", async () => {
    const [a, b] = [await png("#ff6600"), await png("#0066ff")];
    const img = (x: Uint8Array) => ({ image: { contentType: "image/png", base64: Buffer.from(x).toString("base64") }, imageRights: true, imageBadge: false });
    const M = mintPk(), up = w.p.uploader as FakePinUploader;
    w.p.customImages = true;
    assert.equal(code(await prepareLaunch(w.p, body({ ticker: "IMGONE", ...img(a) }), { register: true, mint: M })), "ok");
    const n = up.uploads.length;
    assert.equal(code(await prepareLaunch(w.p, body({ ticker: "IMGONE", ...img(b) }), { register: true, mint: M })), "own-draft-changed");
    assert.equal(code(await prepareLaunch(w.p, body({ ticker: "IMGONE", ...img(a) }), { register: true, mint: M })), "ok");
    assert.equal(up.uploads.length, n);
  });
  test("the refusal sentence lints", async () => {
    const src = (await import("node:fs")).readFileSync("src/lib/burnticker/api/handlers.ts", "utf8");
    const m = src.match(/const OWN_DRAFT_DETAILS_CHANGED = "([^"]+)"/);
    assert.ok(m);
    assert.deepEqual(lintCopy(m![1]).hits, []);
  });
});

describe("H4: checks before keys and pins; the pin budget counts only uploads that worked, per wallet too", () => {
  let w: World;
  before(async () => { w = await makeWorld(); });
  const body = (ticker: string, creator = CREATOR, over: Record<string, unknown> = {}) => ({ creator, ticker, name: `${ticker} coin`, rule: RULE, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true }, ...over });
  test("a refused launch never takes a bank key (before: the route took the keys first and discarded them)", async () => {
    let takes = 0;
    const takeMintKeys = (t: string[]) => { takes++; return { keys: t.map(() => Keypair.generate()) }; };
    const refused = await prepareLaunch(w.p, body("BADKEY", CREATOR, { acknowledgements: { ruleLocked: false, noReturns: false } }), { register: true, takeMintKeys });
    assert.ok("error" in refused);
    const image = await prepareLaunch(w.p, body("NORIGHT", CREATOR, { image: { contentType: "image/png", base64: "AAAA" }, imageRights: false }), { register: true, takeMintKeys });
    assert.ok("error" in image);
    assert.equal(takes, 0);
    const okR = await prepareLaunch(w.p, body("GOODKEY"), { register: true, takeMintKeys });
    assert.ok("ok" in okR);
    assert.equal(takes, 1);
    // an empty bank answers with the route's own refusal
    const empty = await prepareLaunch(w.p, body("NOBANK"), { register: true, takeMintKeys: () => ({ error: { status: 503, body: { error: "none", code: "mint-bank-empty" } } }) });
    assert.equal(code(empty), "mint-bank-empty");
  });
  test("a failed upload is not counted against the day (before: counted before the upload)", async () => {
    const good = w.p.uploader;
    w.p.uploader = new FakePinUploader({ fail: true });
    try {
      const before = w.registry.getStatus(`pin.budget.${today()}`);
      assert.equal(code(await prepareLaunch(w.p, body("FAILUP"), { register: true })), "pin-failed");
      assert.equal(w.registry.getStatus(`pin.budget.${today()}`), before);
    } finally { w.p.uploader = good; }
  });
  test("review item 2: the per-requester cap counts the CLIENT; a made-up creator never escapes it and never locks a victim out", async () => {
    w.p.pinCreatorDailyCap = 2;
    const fake = () => Keypair.generate().publicKey.toBase58();
    try {
      // one client rotating made-up creators: the client count governs (before: each new creator string had a fresh allowance)
      assert.equal(code(await prepareLaunch(w.p, body("ROTONE", fake()), { register: true, client: "c1" })), "ok");
      assert.equal(code(await prepareLaunch(w.p, body("ROTTWO", fake()), { register: true, client: "c1" })), "ok");
      const third = await prepareLaunch(w.p, body("ROTTRE", fake()), { register: true, client: "c1" });
      assert.equal(code(third), "upload-budget-client");
      assert.deepEqual(lintCopy(("error" in third ? (third.error.body as { error: string }).error : "")).hits, []);
      // CREATOR has launches confirmed here (a real creator): counted per (client, creator). An attacker on c2 spending CREATOR's
      // allowance does not touch CREATOR's own connection c3 (before: one count per creator string, so a stranger locked the wallet out)
      assert.equal(code(await prepareLaunch(w.p, body("VICONE"), { register: true, client: "c2" })), "ok");
      assert.equal(code(await prepareLaunch(w.p, body("VICTWO"), { register: true, client: "c2" })), "ok");
      const capped = await prepareLaunch(w.p, body("VICTRE"), { register: true, client: "c2" });
      assert.equal(code(capped), "upload-budget-creator");
      assert.equal(code(await prepareLaunch(w.p, body("OWNONE"), { register: true, client: "c3" })), "ok", "the real creator on its own connection still launches");
    } finally { delete w.p.pinCreatorDailyCap; }
    assert.ok(DEFAULT_PIN_CREATOR_DAILY_CAP >= 2 && DEFAULT_PIN_CREATOR_DAILY_CAP < 50);
  });
  test("review item 5: a cap refusal never takes a key; a pair is checked for both sides before side A is pinned", async () => {
    w.p.pinCreatorDailyCap = 1;
    let takes = 0;
    const takeMintKeys = (t: string[]) => { takes++; return { keys: t.map(() => Keypair.generate()) }; };
    try {
      assert.equal(code(await prepareLaunch(w.p, body("KEYONE"), { register: true, client: "k1", takeMintKeys })), "ok");
      assert.equal(takes, 1);
      assert.equal(code(await prepareLaunch(w.p, body("KEYTWO"), { register: true, client: "k1", takeMintKeys })), "upload-budget-creator");
      assert.equal(takes, 1, "the refused request took no key (before: the key was taken, then the pin refused)");
      // a pair needs two pins; with one slot left nothing is pinned and no key is taken
      const up = w.p.uploader as FakePinUploader, n = up.uploads.length;
      const pair = await prepareLaunch(w.p, { ...body("PAIRAA"), pair: { ticker: "PAIRBB", name: "Pair B", description: "", imageUrl: null, links: [] } }, { register: true, client: "k2", takeMintKeys });
      assert.equal(code(pair), "upload-budget-creator");
      assert.equal(up.uploads.length, n, "side A was not pinned");
      assert.equal(takes, 1);
    } finally { delete w.p.pinCreatorDailyCap; }
  });
  test("an upload that hangs is refused after its timeout", async () => {
    await assert.rejects(withUploadTimeout(new Promise(() => {}), 20), /did not finish within/);
    assert.equal(await withUploadTimeout(Promise.resolve(7), 1000), 7);
  });
});

describe("M2: one prepare per draft", () => {
  test("concurrent and repeated requests with one key run once and get the same answer; a refusal is not kept; a different body is refused", async () => {
    const runs = new IdempotentRuns();
    let made = 0;
    const make = async () => { made++; await new Promise((r) => setTimeout(r, 5)); return new Response(JSON.stringify({ n: made }), { status: 200 }); };
    const h = bodyFingerprint({ ticker: "X", idempotencyKey: "k", timings: { a: 1 } });
    assert.equal(h, bodyFingerprint({ ticker: "X", idempotencyKey: "k", timings: { a: 2 } }), "timings are not part of the body");
    const [a, b] = await Promise.all([runs.run("c|k", h, make), runs.run("c|k", h, make)]);
    const c = await runs.run("c|k", h, make);
    assert.deepEqual([await a.json(), await b.json(), await c.json()], [{ n: 1 }, { n: 1 }, { n: 1 }]);
    assert.equal(made, 1);
    assert.equal((await runs.run("c|k", bodyFingerprint({ ticker: "Y" }), make)).status, 409);
    let refusals = 0;
    const refuse = async () => { refusals++; return new Response("{}", { status: 503 }); };
    await runs.run("c|r", h, refuse); await runs.run("c|r", h, refuse);
    assert.equal(refusals, 2, "a refusal is forgotten, so pressing again runs again");
    assert.equal((await runs.run(null, h, make)).status, 200);
    assert.equal(made, 2, "no key: every request runs");
  });
  test("the route runs prepares through the key and the page sends one key per draft", async () => {
    const fs = await import("node:fs");
    const route = fs.readFileSync("src/app/api/burnticker/launch/route.ts", "utf8");
    assert.match(route, /PREPARES\.run\(idem, bodyFingerprint\(body\), \(\) => prepareAnswer\(/);
    assert.match(route, /takeMintKeys/);
    assert.ok(!/bank\?\.take\(tickers\)[\s\S]*prepareLaunch\(p, body, \{ register: true/.test(route.slice(0, route.indexOf("async function prepareAnswer"))), "no key is taken before the prepare");
    const page = fs.readFileSync("src/app/burnticker/launch/page.tsx", "utf8");
    assert.match(page, /const idempotencyKey = draftPrepareKey\(curRev\.current\);/);
  });
});

/** A mint public key that ends in "burn" (the route's rule), built from a 43-character key so it still decodes to 32 bytes. */
function burnMint(): string {
  for (;;) { const k = Keypair.generate().publicKey.toBase58(); if (k.length === 43) { const m = `${k.slice(0, 39)}burn`; try { if (new PublicKey(m).toBase58() === m) return m; } catch { /* try another */ } } }
}
const routePost = async (body: unknown, o: { https?: boolean; ip?: string } = {}) => {
  const { POST } = await import("../src/app/api/burnticker/launch/route.ts");
  limiter.reset();
  return POST(new Request("http://bt.test/api/burnticker/launch", { method: "POST", headers: { host: "bt.test", origin: "http://bt.test", "content-type": "application/json", ...(o.https === false ? {} : { "x-forwarded-proto": "https" }), "x-forwarded-for": o.ip ?? "203.0.113.77" }, body: JSON.stringify(body) }));
};

describe("review 2026-10-15: the prepare key, its replay, and echoed errors", () => {
  const one = (ticker: string, extra: Record<string, unknown> = {}) => ({ creator: CREATOR, ticker, name: `${ticker} coin`, description: "", imageUrl: null, links: [], rule: RULE, acknowledgements: { ruleLocked: true, noReturns: true }, ...extra });
  test("item 1: bank empty, the browser's own mint, then a second press: never idempotency-key-reused (before: 409 for 15 minutes)", async () => {
    const w = await makeWorld(); w.p.mintBank = testMintBank({ refill: false });
    const key = "draft_reviewitemoneaaaa";
    assert.equal((await routePost(one("KEYBANK", { idempotencyKey: key }))).status, 503, "the bank is empty");
    const own = await routePost(one("KEYBANK", { idempotencyKey: key, mint: burnMint() }));
    assert.equal(own.status, 200, JSON.stringify(await own.clone().json()).slice(0, 300));
    // the second press: the page asks the bank first again, under the same key
    const again = await routePost(one("KEYBANK", { idempotencyKey: key }));
    assert.equal(again.status, 503, "the bank answer runs again (not 409)");
    assert.equal(((await again.json()) as { code: string }).code, "mint-bank-empty");
    const own2 = await routePost(one("KEYBANK", { idempotencyKey: key, mint: burnMint() }));
    assert.equal(own2.status, 200);
  });
  test("item 1: a matchup with exactly one bank key: the browser search for both coins goes through (before: every press 409)", async () => {
    const w = await makeWorld();
    const bank = testMintBank({ refill: false });
    const { grindMint } = await import("@/lib/burnticker/vanityMint");
    const { randomBytes } = await import("node:crypto");
    bank.bank.insert(grindMint({ suffix: "b", batch: 200_000, rng: (n: number) => new Uint8Array(randomBytes(n)) }).found!);
    w.p.mintBank = bank;
    const base = "draft_matchuponebankkey";
    assert.equal((await routePost(one("TEAMAA", { idempotencyKey: `${base}_a` }))).status, 200, "coin A took the one key");
    assert.equal((await routePost(one("TEAMBB", { idempotencyKey: `${base}_b` }))).status, 503, "coin B: bank empty");
    // withMintSource now sends both coins with the browser's mints, under the same keys
    const a = await routePost(one("TEAMAA", { idempotencyKey: `${base}_a`, mint: burnMint() }));
    const b = await routePost(one("TEAMBB", { idempotencyKey: `${base}_b`, mint: burnMint() }));
    assert.equal(a.status, 200, JSON.stringify(await a.clone().json()).slice(0, 200));
    assert.equal(b.status, 200);
  });
  test("item 1: the page's fetch starts a new key on idempotency-key-reused and sends once more, keeping the side suffix", async () => {
    const sent: string[] = [];
    let first = true;
    const fake = async (_u: string, init?: { body?: string }) => { sent.push(JSON.parse(init!.body!).idempotencyKey); if (first) { first = false; return new Response(JSON.stringify({ code: "idempotency-key-reused" }), { status: 409 }); } return new Response("{}", { status: 200 }); };
    const f = keyRotatingFetch(fake, () => "draft_fresh");
    const r = await f("/api/burnticker/launch", { method: "POST", body: JSON.stringify({ idempotencyKey: "draft_old_a", ticker: "X" }) });
    assert.equal(r.status, 200);
    assert.deepEqual(sent, ["draft_old_a", "draft_fresh_a"]);
    assert.equal(withNewBase("draft_abc", "draft_new"), "draft_new");
    const page = (await import("node:fs")).readFileSync("src/app/burnticker/launch/page.tsx", "utf8");
    assert.match(page, /const launchFetch = keyRotatingFetch\(/);
    assert.match(page, /await launchFetch\("\/api\/burnticker\/launch"/);
  });
  test("item 4: a kept answer is never replayed to plain HTTP, nor once its draft has gone live", async () => {
    const w = await makeWorld(); w.p.mintBank = testMintBank();
    const key = "draft_reviewitemfouraaaa";
    const r1 = await routePost(one("REPLAY", { idempotencyKey: key }));
    assert.equal(r1.status, 200);
    const mint1 = ((await r1.json()) as { bundle: { mint: string; mintSecretKey: string | null } }).bundle.mint;
    const plain = await routePost(one("REPLAY", { idempotencyKey: key }), { https: false });
    assert.equal(plain.status, 503, "plain HTTP gets no key and no kept secret (before: the kept bundle with its secret)");
    assert.equal(((await plain.json()) as { bundle?: unknown }).bundle, undefined);
    const replay = await routePost(one("REPLAY", { idempotencyKey: key }));
    assert.equal(((await replay.json()) as { bundle: { mint: string } }).bundle.mint, mint1, "HTTPS replays the same draft");
    w.registry.markLaunched(mint1, "5".repeat(87), w.registry.token(mint1)!.poolId, new Date().toISOString());
    // the prepare runs afresh: here the anti-clone guard refuses a second $REPLAY next to the live one; either way the kept bundle is gone
    const after = await routePost(one("REPLAY", { idempotencyKey: key }));
    const aj = await after.json() as { bundle?: { mint: string } };
    assert.notEqual(aj.bundle?.mint, mint1, "a live draft is never handed out to sign again");
  });
  test("item 6: an echoed error never carries a web address or a key", async () => {
    assert.equal(safeErrorText(new Error("fetch failed: https://mainnet.helius-rpc.com/?api-key=SECRET123 503")), "fetch failed: [address hidden] 503");
    assert.doesNotMatch(safeErrorText("rpc mainnet.helius-rpc.com/?api-key=SECRET123 down"), /SECRET123/);
    assert.doesNotMatch(safeErrorText("bad token=SECRET123"), /SECRET123/);
    const w = await makeWorld(); w.p.mintBank = testMintBank();
    (w.registry as unknown as { tokens: () => never }).tokens = () => { throw new Error("read failed at https://rpc.example/key/SECRET123?api-key=SECRET123"); };
    const r = await routePost(one("ECHOED"));
    const text = await r.text();
    assert.ok(r.status >= 500, String(r.status));
    assert.doesNotMatch(text, /SECRET123|rpc\.example/);
    assert.match(text, /\[address hidden\]/);
  });
  test("item 7: the fingerprint is the creator's fields and the locked rule, never the generated (live) text", async () => {
    const { draftIdentity } = await import("@/lib/burnticker/api/handlers");
    const base = { ticker: "X", name: "X coin", creatorText: "Orange.", rulesSha256: "a".repeat(64), links: [], imageUrl: null, imageSha: null, badge: null };
    // a side B description regenerated from a renamed Polymarket market changes nothing the fingerprint reads
    assert.equal(draftIdentity({ ...base, description: "burns if candidate B wins" } as never), draftIdentity({ ...base, description: "burns if candidate B (renamed) wins" } as never));
    assert.notEqual(draftIdentity(base), draftIdentity({ ...base, creatorText: "Blue." }));
    assert.notEqual(draftIdentity(base), draftIdentity({ ...base, rulesSha256: "b".repeat(64) }));
    const src = (await import("node:fs")).readFileSync("src/lib/burnticker/api/handlers.ts", "utf8");
    assert.match(src, /const identity = draftIdentity\(\{ ticker, name, creatorText: creatorText\.trim\(\), rulesSha256: sideRule\.sha256,/);
    assert.match(src, /tk === input\.ticker \? creatorText : creatorTextB\);/, "side B passes its own creator text");
  });
  test("item 7: a retry whose source title changed is still the same draft", async () => {
    const w = await makeWorld();
    const M = mintPk(), up = w.p.uploader as FakePinUploader;
    const orig = w.p.kalshi.seriesInfo.bind(w.p.kalshi);
    const first = await prepareLaunch(w.p, one("LIVETTL", { creatorDescription: "Orange." }), { register: true, mint: M });
    assert.ok("ok" in first);
    const n = up.uploads.length;
    w.p.kalshi.seriesInfo = (async (k: string) => { const i = await orig(k); return i ? { ...i, title: `${i.title} (renamed by the source)` } : i; }) as typeof w.p.kalshi.seriesInfo;
    try {
      const again = await prepareLaunch(w.p, one("LIVETTL", { creatorDescription: "Orange." }), { register: true, mint: M });
      assert.ok("ok" in again, JSON.stringify("error" in again ? again.error.body : {}).slice(0, 300));
      assert.equal(up.uploads.length, n, "the first file is reused");
      assert.equal(again.ok.bundle.metadataUri, w.registry.tokenMeta(M)!.metadataUri);
      const changed = await prepareLaunch(w.p, one("LIVETTL", { creatorDescription: "Blue." }), { register: true, mint: M });
      assert.equal(code(changed), "own-draft-changed", "a creator change is still refused");
    } finally { w.p.kalshi.seriesInfo = orig; }
  });
});
