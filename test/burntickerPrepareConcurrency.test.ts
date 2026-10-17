// Third prelaunch audit 2026-10-16:
//   F03 two prepares for the same mint at once (both past the no-draft check before either registered) each pinned a metadata file and
//       both answered 200, so at least one signed bundle named a file the registry did not keep;
//   F04 the pin caps were checked before the awaited upload and charged after it, so three prepares at once from one client with a cap
//       of one all pinned.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey } from "@solana/web3.js";
import { prepareLaunch, draftIdentityKey } from "@/lib/burnticker/api/handlers";
import { v1LaunchBundle } from "@/lib/burnticker/api/v1";
import { FakePinUploader, type PinUploader } from "@/lib/burnticker/pin";
import { limiter } from "@/lib/burnticker/api/http";
import { CREATOR, makeWorld, type World } from "./burntickerApiHelpers.ts";
import { lintCopy } from "@/lib/launch/copyLint";
import { BRONCOS } from "./burntickerHelpers.ts";

const RULE = { ...BRONCOS, binary: { onYes: null, onNo: { fractionOfPool: 0.02 } }, pair: null };
const mintPk = () => Keypair.generate().publicKey.toBase58();
type R = Awaited<ReturnType<typeof prepareLaunch>>;
const code = (r: R) => ("error" in r ? (r.error.body as { code?: string }).code : "ok");
const today = () => new Date().toISOString().slice(0, 10);
const png = (c: string) => import("sharp").then(async (s) => new Uint8Array(await s.default({ create: { width: 64, height: 64, channels: 3, background: c } }).png().toBuffer()));

/** Holds every upload until `want` uploads are waiting (or `ms` passes), so concurrent prepares all get past their checks first. */
class BarrierUploader implements PinUploader {
  readonly name = "barrier";
  readonly inner = new FakePinUploader();
  private waiting: (() => void)[] = [];
  private want: number; private ms: number;
  constructor(want: number, ms = 250) { this.want = want; this.ms = ms; }
  async upload(body: Uint8Array, contentType: string, tags: { name: string; value: string }[]) {
    await new Promise<void>((res) => {
      this.waiting.push(res);
      if (this.waiting.length >= this.want) { for (const r of this.waiting.splice(0)) r(); }
      else setTimeout(res, this.ms);
    });
    return this.inner.upload(body, contentType);
  }
}

const one = (over: Record<string, unknown> = {}) => ({ creator: CREATOR, ticker: "RACEONE", name: "Race One", rule: RULE, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true }, creatorDescription: "Orange.", links: [{ label: "website", url: "https://example.com" }], ...over });

/** Every 200 must carry the metadata file the registry kept; the registry's identity must be the one that file was made from. */
function assertOneDraft(w: World, mint: string, results: R[]) {
  const oks = results.filter((r): r is Extract<R, { ok: unknown }> => "ok" in r);
  assert.equal(oks.length, 1, `exactly one prepare wins: ${results.map(code).join(", ")}`);
  for (const r of results) if ("error" in r) assert.equal(code(r), "own-draft-changed");
  const meta = w.registry.tokenMeta(mint)!;
  assert.equal(oks[0].ok.bundle.metadataUri, meta.metadataUri, "the winner's bundle names the file the registry kept");
  assert.ok(w.registry.getStatus(draftIdentityKey(mint)), "the identity is recorded");
}

describe("F03: concurrent prepares for one mint keep one metadata identity", () => {
  for (const [what, a, b] of [
    ["description", { creatorDescription: "Orange." }, { creatorDescription: "Blue." }],
    ["links", { links: [{ label: "website", url: "https://example.com" }] }, { links: [{ label: "website", url: "https://example.org" }] }],
  ] as const) {
    test(`two prepares differing in ${what}: one 200, one refused, and the 200 names the registry's file (before: both 200)`, async () => {
      const w = await makeWorld(); w.p.uploader = new BarrierUploader(2);
      const M = mintPk(), t = `RC${what.slice(0, 4).toUpperCase()}`;
      const results = await Promise.all([prepareLaunch(w.p, one({ ticker: t, ...a }), { register: true, mint: M, client: "x" }), prepareLaunch(w.p, one({ ticker: t, ...b }), { register: true, mint: M, client: "x" })]);
      assertOneDraft(w, M, results);
    });
  }
  test("two prepares differing in image: one wins", async () => {
    const w = await makeWorld(); w.p.uploader = new BarrierUploader(2); w.p.customImages = true;
    const img = async (c: string) => ({ image: { contentType: "image/png", base64: Buffer.from(await png(c)).toString("base64") }, imageRights: true, imageBadge: false });
    const M = mintPk();
    const results = await Promise.all([prepareLaunch(w.p, one({ ticker: "RCIMG", ...(await img("#ff6600")) }), { register: true, mint: M }), prepareLaunch(w.p, one({ ticker: "RCIMG", ...(await img("#0066ff")) }), { register: true, mint: M })]);
    assertOneDraft(w, M, results);
  });
  test("one through the page's prepare and one through /v1/launch/bundle: the same lock", async () => {
    const w = await makeWorld(); w.p.uploader = new BarrierUploader(2);
    const M = mintPk();
    const [page, api] = await Promise.all([prepareLaunch(w.p, one({ ticker: "RCAPI" }), { register: true, mint: M, client: "x" }), v1LaunchBundle(w.p, { ...one({ ticker: "RCAPI", creatorDescription: "Blue." }), mint: M }, "y")]);
    const apiOk = api.status === 200;
    assert.notEqual("ok" in page, apiOk, `exactly one wins (page ${code(page)}, api ${api.status})`);
    const meta = w.registry.tokenMeta(M)!;
    if (apiOk) assert.equal((api.body as { review: { mint: string } }).review.mint, M);
    else { assert.equal((api.body as { code?: string }).code, "own-draft-changed"); assert.ok("ok" in page && page.ok.bundle.metadataUri === meta.metadataUri); }
  });
  test("two route requests with different idempotency keys for the same mint: one 200", async () => {
    const w = await makeWorld(); w.p.uploader = new BarrierUploader(2);
    const M = burnMint();
    const post = async (body: unknown) => { const { POST } = await import("../src/app/api/burnticker/launch/route.ts"); return POST(new Request("http://bt.test/api/burnticker/launch", { method: "POST", headers: { host: "bt.test", origin: "http://bt.test", "content-type": "application/json", "x-forwarded-proto": "https", "x-forwarded-for": "203.0.113.78" }, body: JSON.stringify(body) })); };
    limiter.reset();
    const [a, b] = await Promise.all([post({ ...one({ ticker: "RCKEY" }), mint: M, idempotencyKey: "draft_concurrentkeyaaaa" }), post({ ...one({ ticker: "RCKEY", creatorDescription: "Blue." }), mint: M, idempotencyKey: "draft_concurrentkeybbbb" })]);
    const statuses = [a.status, b.status].sort();
    assert.deepEqual(statuses, [200, 409], `statuses ${statuses}`);
    const win = (a.status === 200 ? a : b);
    assert.equal(((await win.json()) as { bundle: { metadataUri: string } }).bundle.metadataUri, w.registry.tokenMeta(M)!.metadataUri);
  });
  test("the sequential retry cases still pass: the same details twice reuse the file", async () => {
    const w = await makeWorld();
    const M = mintPk(), up = w.p.uploader as FakePinUploader;
    assert.equal(code(await prepareLaunch(w.p, one({ ticker: "RCSEQ" }), { register: true, mint: M })), "ok");
    const n = up.uploads.length;
    assert.equal(code(await prepareLaunch(w.p, one({ ticker: "RCSEQ" }), { register: true, mint: M })), "ok");
    assert.equal(up.uploads.length, n);
    // two identical prepares at once: both answer the same file
    const M2 = mintPk();
    const both = await Promise.all([prepareLaunch(w.p, one({ ticker: "RCSAME" }), { register: true, mint: M2 }), prepareLaunch(w.p, one({ ticker: "RCSAME" }), { register: true, mint: M2 })]);
    assert.deepEqual(both.map(code), ["ok", "ok"]);
    const uris = both.map((r) => ("ok" in r ? r.ok.bundle.metadataUri : ""));
    assert.equal(uris[0], uris[1]);
    assert.equal(uris[0], w.registry.tokenMeta(M2)!.metadataUri);
  });
});

describe("F04: concurrent uploads cannot overrun the pin caps", () => {
  const body = (ticker: string, creator = Keypair.generate().publicKey.toBase58()) => ({ creator, ticker, name: `${ticker} coin`, rule: RULE, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true } });
  test("three prepares at once from one client with a cap of one: one pins (before: all three)", async () => {
    const w = await makeWorld(); const up = new BarrierUploader(3); w.p.uploader = up; w.p.pinCreatorDailyCap = 1;
    const results = await Promise.all(["CAPAA", "CAPBB", "CAPCC"].map((t) => prepareLaunch(w.p, body(t), { register: true, client: "one", mint: mintPk() })));
    // review follow-up 8: refused while the winner still held its slot, so "busy" rather than "used up"
    const codes = results.map(code);
    assert.equal(codes.filter((c) => c === "ok").length, 1, codes.join(", "));
    assert.ok(codes.every((c) => ["ok", "upload-budget-client", "upload-busy"].includes(String(c))), codes.join(", "));
    assert.equal(w.registry.getStatus(`pin.budget.${today()}.client.one`), "1");
  });
  test("the host's daily cap holds under concurrency too", async () => {
    const w = await makeWorld(); w.p.uploader = new BarrierUploader(3);
    const used = Number(w.registry.getStatus(`pin.budget.${today()}`) ?? 0);
    w.p.pinDailyCap = used + 2;
    const results = await Promise.all(["GLBAA", "GLBBB", "GLBCC"].map((t, i) => prepareLaunch(w.p, body(t), { register: true, client: `g${i}`, mint: mintPk() })));
    const codes = results.map(code);
    assert.equal(codes.filter((c) => c === "ok").length, 2, codes.join(", "));
    assert.ok(codes.every((c) => ["ok", "upload-budget", "upload-busy"].includes(String(c))), codes.join(", "));
  });
  test("a failed upload releases its slot; a pair reserves both sides together", async () => {
    const w = await makeWorld(); w.p.pinCreatorDailyCap = 2;
    const good = w.p.uploader;
    w.p.uploader = new FakePinUploader({ fail: true });
    assert.equal(code(await prepareLaunch(w.p, body("RELAA"), { register: true, client: "rel", mint: mintPk() })), "pin-failed");
    w.p.uploader = new BarrierUploader(3);
    // a pair (two slots) and a single coin at once with two slots: one of them is refused, and never half a pair
    const pair = prepareLaunch(w.p, { ...body("RELPA"), pair: { ticker: "RELPB", name: "Rel B", description: "", imageUrl: null, links: [] } }, { register: true, client: "rel", takeMintKeys: (t) => ({ keys: t.map(() => Keypair.generate()) }) });
    const single = prepareLaunch(w.p, body("RELSG"), { register: true, client: "rel", mint: mintPk() });
    const codes = (await Promise.all([pair, single])).map(code);
    assert.equal(codes.filter((c) => c === "ok").length, 1, codes.join(", "));
    assert.ok(Number(w.registry.getStatus(`pin.budget.${today()}.client.rel`) ?? 0) <= 2);
    void good;
  });
});

function burnMint(): string {
  for (;;) { const k = Keypair.generate().publicKey.toBase58(); if (k.length === 43) { const m = `${k.slice(0, 39)}burn`; try { if (new PublicKey(m).toBase58() === m) return m; } catch { /* try another */ } } }
}

describe("F03: the registry is the arbiter when the lock is not shared (another process)", () => {
  test("a draft with another identity written for the mint during the upload: this prepare is refused; its real uploads stay charged and are counted as orphans", async () => {
    const w = await makeWorld();
    const M = mintPk(), inner = new FakePinUploader();
    let raced = false;
    w.p.uploader = { name: "racer", upload: async (b: Uint8Array, c: string, t: { name: string; value: string }[]) => {
      if (!raced) {
        raced = true;
        // the other process's prepare finishes first: its draft and its identity are in the registry
        const live = w.registry.tokens("live")[0];
        w.registry.register({ mint: M, ticker: "RCARB", name: "Race One", creator: CREATOR, description: "", imageUrl: null, links: [], rulesText: live.rulesJson, feePda: live.feePda, vault: null, tokenConfig: live.tokenConfig, poolId: null, launchTx: null, cluster: live.cluster, platformId: live.platformId, baselineAt: live.baselineAt, status: "draft" } as Parameters<World["registry"]["register"]>[0]);
        w.registry.setStatus(draftIdentityKey(M), "f".repeat(64));
      }
      return inner.upload(b, c);
    } };
    // CREATOR has a confirmed launch, so its pins are counted in the connection's bucket for such creators (review follow-up 5)
    const before = w.registry.getStatus(`pin.budget.${today()}.client.arb.real`);
    const r = await prepareLaunch(w.p, one({ ticker: "RCARB" }), { register: true, mint: M, client: "arb" });
    assert.equal(code(r), "own-draft-changed");
    assert.equal(w.registry.getStatus(draftIdentityKey(M)), "f".repeat(64), "the first draft's identity stands");
    // review follow-up 1: the files really were uploaded, so the charge stands; the orphan is counted and the owner's phone hears of it
    assert.equal(Number(w.registry.getStatus(`pin.budget.${today()}.client.arb.real`) ?? 0), Number(before ?? 0) + 1, "the coin's upload stays charged (before the follow-up: refunded although the files exist)");
    assert.ok(Number(w.registry.getStatus(`pin.orphans.${today()}`) ?? 0) >= 1, "the orphaned pin is counted");
    assert.equal((w.registry.db.prepare("SELECT kind FROM alerts WHERE kind = 'bt-pin-orphan'").all() as unknown[]).length, 1, "one alert row");
  });
});

describe("F-20: the per-connection cap always applies; the per-wallet count is an extra limit", () => {
  test("one connection naming creators who already launched cannot pass the connection cap (before: each named wallet had its own allowance)", async () => {
    const w = await makeWorld(); w.p.pinCreatorDailyCap = 2;
    const live = w.registry.tokens("live")[0];
    const realCreator = () => {
      const c = Keypair.generate().publicKey.toBase58(), m = mintPk();
      w.registry.register({ mint: m, ticker: `R${m.slice(0, 5).toUpperCase().replace(/[^A-Z]/g, "X")}`, name: "Real", creator: c, description: "", imageUrl: null, links: [], rulesText: live.rulesJson, feePda: live.feePda, vault: null, tokenConfig: live.tokenConfig, poolId: null, launchTx: "5".repeat(87), cluster: live.cluster, platformId: live.platformId, baselineAt: live.baselineAt, status: "live" } as Parameters<World["registry"]["register"]>[0]);
      return c;
    };
    const body = (ticker: string, creator: string) => ({ creator, ticker, name: `${ticker} coin`, rule: RULE, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true } });
    const codes: string[] = [];
    for (const t of ["FTWAA", "FTWBB", "FTWCC", "FTWDD"]) codes.push(String(code(await prepareLaunch(w.p, body(t, realCreator()), { register: true, client: "f20", mint: mintPk() }))));
    assert.deepEqual(codes, ["ok", "ok", "upload-budget-client", "upload-budget-client"]);
    // the per-wallet limit still holds on top: a real creator on a fresh connection, with its own count used up elsewhere
    const c = realCreator();
    assert.equal(code(await prepareLaunch(w.p, body("FTWEE", c), { register: true, client: "f20b", mint: mintPk() })), "ok");
    assert.equal(code(await prepareLaunch(w.p, body("FTWFF", c), { register: true, client: "f20b", mint: mintPk() })), "ok");
    assert.equal(code(await prepareLaunch(w.p, body("FTWGG", c), { register: true, client: "f20b", mint: mintPk() })), "upload-budget-creator");
  });
});

describe("review follow-ups: the pin budget's buckets, the busy sentence and the reuse count", () => {
  test("5: made-up creators on a connection cannot use up the bucket a creator with a confirmed launch draws from; real creators share their own connection bucket", async () => {
    const w = await makeWorld(); w.p.pinCreatorDailyCap = 2;
    const tok = w.registry.tokens("live")[0];
    const realCreator = () => { const c = Keypair.generate().publicKey.toBase58(), m = mintPk(); w.registry.register({ mint: m, ticker: `Q${m.slice(0, 5).toUpperCase().replace(/[^A-Z]/g, "X")}`, name: "Real", creator: c, description: "", imageUrl: null, links: [], rulesText: tok.rulesJson, feePda: tok.feePda, vault: null, tokenConfig: tok.tokenConfig, poolId: null, launchTx: "5".repeat(87), cluster: tok.cluster, platformId: tok.platformId, baselineAt: tok.baselineAt, status: "live" } as Parameters<World["registry"]["register"]>[0]); return c; };
    const body = (ticker: string, creator: string) => ({ creator, ticker, name: `${ticker} coin`, rule: RULE, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true } });
    const fake = () => Keypair.generate().publicKey.toBase58();
    const go = async (t: string, c: string) => code(await prepareLaunch(w.p, body(t, c), { register: true, client: "shared", mint: mintPk() }));
    assert.deepEqual([await go("STRAA", fake()), await go("STRBB", fake()), await go("STRCC", fake())], ["ok", "ok", "upload-budget-client"], "strangers use up the connection's bucket");
    const r1 = realCreator(), r2 = realCreator(), r3 = realCreator();
    assert.equal(await go("ORCHID", r1), "ok", "a real creator still launches on the same connection (before the follow-up: refused with the strangers)");
    assert.equal(await go("MAPLE", r2), "ok");
    assert.equal(await go("CEDAR", r3), "upload-budget-client", "real creators on one connection share their own bucket, capped at the client cap");
    assert.equal(w.registry.getStatus(`pin.budget.${today()}.client.shared.real`), "2");
  });
  test("8: a cap reached only by slots other prepares hold says the site is busy, not that the day is used up", async () => {
    const w = await makeWorld(); w.p.uploader = new BarrierUploader(2, 400);
    w.p.pinDailyCap = Number(w.registry.getStatus(`pin.budget.${today()}`) ?? 0) + 1;
    const body = (ticker: string) => ({ creator: Keypair.generate().publicKey.toBase58(), ticker, name: `${ticker} coin`, rule: RULE, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true } });
    const first = prepareLaunch(w.p, body("BUSYAA"), { register: true, client: "b1", mint: mintPk() });
    await new Promise((r) => setTimeout(r, 50));
    const second = await prepareLaunch(w.p, body("BUSYBB"), { register: true, client: "b2", mint: mintPk() });
    assert.equal(code(second), "upload-busy");
    const said = String((second as { error: { body: { error: string } } }).error.body.error);
    assert.match(said, /busy/); assert.doesNotMatch(said, /used up/);
    assert.deepEqual(lintCopy(said).hits, []);
    assert.equal(code(await first), "ok");
    assert.equal(code(await prepareLaunch(w.p, body("BUSYCC"), { register: true, client: "b3", mint: mintPk() })), "upload-budget", "once charged, the day is used up");
  });
  test("9: a draft whose stored metadata cannot be reused (no transaction id or hash) is counted as a new pin", async () => {
    const w = await makeWorld(); w.p.pinCreatorDailyCap = 1;
    const M = mintPk();
    assert.equal(code(await prepareLaunch(w.p, one({ ticker: "REUSE" }), { register: true, mint: M, client: "ru" })), "ok");
    const meta = w.registry.tokenMeta(M)!;
    // an older draft row with a URI but no transaction id or hash (the row is write-once; the test world rewrites it directly)
    void meta; w.registry.db.exec("DROP TRIGGER token_meta_no_update");
    w.registry.db.prepare("UPDATE token_meta SET metadata_tx = NULL, metadata_sha256 = NULL WHERE mint = ?").run(M);
    // pinFor will upload again (it reuses only a file with its id and hash), so the cap must count it: refused before anything uploads
    assert.equal(code(await prepareLaunch(w.p, one({ ticker: "REUSE" }), { register: true, mint: M, client: "ru" })), "upload-budget-creator", "before the follow-up: counted as a reuse (0 pins), then uploaded past the cap");
  });
});
