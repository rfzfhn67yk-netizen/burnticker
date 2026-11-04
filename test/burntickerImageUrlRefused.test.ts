// NO IMAGE BY WEB ADDRESS (owner decision 2026-10-19, the audit 7 F07 follow-up). A new coin's image is the creator's uploaded bytes
// (the `image` field, pinned on Arweave with their sha256) or the generated receipt art. Any `imageUrl` (https, ar:// or an Arweave
// gateway link) is refused with 400 image-url-refused: on the single and the pair path, on /v1/launch/bundle, on the launch page's
// route and its dry run. Coins registered earlier with an outside image keep it and keep the truthful "link" label (append-only).
import "./burntickerRenderTsx.ts";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import sharp from "sharp";
import { Keypair } from "@solana/web3.js";
import { prepareLaunch } from "@/lib/burnticker/api/handlers";
import { sha256Hex, type FakePinUploader } from "@/lib/burnticker/pin";
import { IMAGE_OUTSIDE_LINK_LINE, IMAGE_URL_REFUSED, imagePinState } from "@/lib/burnticker/imagePin";
import { buildLaunchBundle, FakeLaunchLab } from "@/lib/burnticker/launchBundle";
import { tokenPageData } from "@/lib/burnticker/server";
import { lintCopy } from "@/lib/launch/copyLint";
import { buildLaunchBundle as sdkBuildLaunchBundle } from "../packages/burnticker-sdk/src/launch.ts";
import { API, ATTESTER, CREATOR, POST_HEADERS, callRoute, makeWorld } from "./burntickerApiHelpers.ts";
import { BRONCOS, DENVER_HIGH } from "./burntickerHelpers.ts";

type Err = { error: { status: number; body: { error: string; code?: string } } };
type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const ACK = { ruleLocked: true, noReturns: true };
const single = (o: Record<string, unknown> = {}) => ({ creator: CREATOR, ticker: "HEAT", name: "Heat", rule: DENVER_HIGH, firstBuySol: "0", acknowledgements: ACK, ...o });
const PAIR_RULE = { ...BRONCOS, binary: { onYes: null, onNo: { fractionOfPool: 0.02 } }, pair: null };
const pairBody = (a: Record<string, unknown> = {}, b: Record<string, unknown> = {}) => ({ creator: CREATOR, ticker: "MILEHI", name: "Mile High", rule: PAIR_RULE, firstBuySol: "0", acknowledgements: ACK, ...a,
  pair: { ticker: "ARROWHD", name: "Arrowhead", description: "", imageUrl: null, links: [], ...b } });
const png = async (c: string) => new Uint8Array(await sharp({ create: { width: 64, height: 64, channels: 3, background: c } }).png().toBuffer());
// every form of an outside address, Arweave references included: no form can be checked without fetching it
const ADDRESSES = ["https://example.org/x.png", `ar://${"a".repeat(43)}`, `https://arweave.net/${"b".repeat(43)}`, `https://gateway.irys.xyz/${"c".repeat(43)}`, "http://example.org/x.png", "not a url"];
const withFlag = async (f: () => Promise<void>) => {
  const prev = process.env.BURNTICKER_CREATOR_LAUNCHES_ENABLED;
  process.env.BURNTICKER_CREATOR_LAUNCHES_ENABLED = "1";
  try { await f(); } finally { if (prev === undefined) delete process.env.BURNTICKER_CREATOR_LAUNCHES_ENABLED; else process.env.BURNTICKER_CREATOR_LAUNCHES_ENABLED = prev; }
};

describe("the refusal", () => {
  test("one plain sentence that points to the image field and passes the copy lint", () => {
    assert.match(IMAGE_URL_REFUSED, /image field/);
    assert.equal(lintCopy(IMAGE_URL_REFUSED, undefined, { scope: "platform" }).ok, true);
    assert.doesNotMatch(IMAGE_URL_REFUSED, /\b(buy|price|will)\b|→|->|\b20\d\d\b/i);
  });
});

describe("prepareLaunch refuses any imageUrl", () => {
  test("the single path, registering or not, custom images on or off, with the rights line or without", async () => {
    const w = await makeWorld();
    for (const custom of [false, true]) {
      w.p.customImages = custom;
      for (const imageUrl of ADDRESSES) for (const register of [false, true]) {
        const mint = Keypair.generate().publicKey.toBase58();
        const r = await prepareLaunch(w.p, single({ imageUrl, imageRights: true }), { register, mint }) as Err;
        assert.ok("error" in r, imageUrl);
        assert.equal(r.error.status, 400, imageUrl); assert.equal(r.error.body.code, "image-url-refused", imageUrl);
        assert.equal(r.error.body.error, IMAGE_URL_REFUSED);
        assert.equal(w.registry.token(mint), null, "nothing was registered");
      }
    }
  });
  test("the pair path: side A's address or side B's, each named", async () => {
    const w = await makeWorld(); w.p.customImages = true;
    for (const imageUrl of ADDRESSES) {
      const a = await prepareLaunch(w.p, pairBody({ imageUrl, imageRights: true }), { register: true }) as Err;
      assert.equal(a.error.status, 400); assert.equal(a.error.body.code, "image-url-refused"); assert.equal(a.error.body.error, IMAGE_URL_REFUSED);
      const b = await prepareLaunch(w.p, pairBody({}, { imageUrl, imageRights: true }), { register: true }) as Err;
      assert.equal(b.error.status, 400); assert.equal(b.error.body.code, "image-url-refused"); assert.equal(b.error.body.error, `Side B: ${IMAGE_URL_REFUSED}`);
    }
  });
  test("the dry run", async () => {
    const w = await makeWorld();
    const r = await prepareLaunch(w.p, single({ imageUrl: ADDRESSES[0] }), { register: false, dryRun: true }) as Err;
    assert.equal(r.error.status, 400); assert.equal(r.error.body.code, "image-url-refused");
    const p = await prepareLaunch(w.p, pairBody({}, { imageUrl: ADDRESSES[1] }), { register: false, dryRun: true }) as Err;
    assert.equal(p.error.body.code, "image-url-refused");
  });
  test("null, absent and the empty string mean no image: the generated receipt art, pinned with its sha256", async () => {
    const w = await makeWorld();
    const up = w.p.uploader as FakePinUploader;
    for (const [i, extra] of ([{ imageUrl: null }, {}, { imageUrl: "" }] as Record<string, unknown>[]).entries()) {
      const mint = Keypair.generate().publicKey.toBase58();
      const r = await prepareLaunch(w.p, single({ ticker: ["SUNNY", "MAPLE", "ORBIT"][i], name: ["Sunny", "Maple", "Orbit"][i], ...extra }), { register: true, mint }) as Any;
      assert.ok("ok" in r, JSON.stringify(r).slice(0, 300));
      assert.equal(w.registry.token(mint)!.imageUrl, null, "the card draws the generated art");
      const meta = w.registry.tokenMeta(mint)!;
      assert.equal(imagePinState(meta), "pinned");
      assert.equal(sha256Hex(up.get(meta.imageTx!)!), meta.imageSha256);
      assert.ok(!(r.ok.bundle.notes as string[]).some((n) => /link to another website/.test(n)), "no outside-link note on a new bundle");
    }
  });
  test("an uploaded image is pinned and shown from its pinned copy", async () => {
    const w = await makeWorld(); w.p.customImages = true;
    const up = w.p.uploader as FakePinUploader;
    const bytes = await png("#ff6600");
    const mint = Keypair.generate().publicKey.toBase58();
    const r = await prepareLaunch(w.p, single({ ticker: "OWNPIC", name: "Own Pic", image: { contentType: "image/png", base64: Buffer.from(bytes).toString("base64") }, imageRights: true, imageBadge: false }), { register: true, mint }) as Any;
    assert.ok("ok" in r, JSON.stringify(r).slice(0, 300));
    const meta = w.registry.tokenMeta(mint)!;
    assert.deepEqual([...up.get(meta.imageTx!)!], [...bytes]);
    assert.equal(imagePinState(meta), "pinned");
    assert.equal(w.registry.token(mint)!.imageUrl, meta.imageUri);
  });
});

describe("the routes", () => {
  test("POST /v1/launch/bundle: 400 image-url-refused, single and pair", async () => {
    await makeWorld();
    await withFlag(async () => {
      for (const [body, msg] of [[single({ mint: Keypair.generate().publicKey.toBase58(), imageUrl: ADDRESSES[0], register: false }), IMAGE_URL_REFUSED], [pairBody({ mint: Keypair.generate().publicKey.toBase58() }, { imageUrl: ADDRESSES[2] }), `Side B: ${IMAGE_URL_REFUSED}`]] as const) {
        const r = await callRoute(`${API}/launch/bundle`, { method: "POST", headers: { ...POST_HEADERS, "x-forwarded-for": "198.51.100.71" }, body: JSON.stringify(body) });
        const j = await r.json() as { error: string; code: string };
        assert.equal(r.status, 400, JSON.stringify(j)); assert.equal(j.code, "image-url-refused"); assert.equal(j.error, msg);
      }
    });
  });
  test("the launch page's route, its dry run included", async () => {
    await makeWorld();
    await withFlag(async () => {
      const { POST } = await import("@/app/api/burnticker/launch/route");
      let ip = 80;
      const req = (b: unknown) => new Request("https://burnticker.com/api/burnticker/launch", { method: "POST", headers: { "content-type": "application/json", "sec-fetch-site": "same-origin", "x-forwarded-for": `198.51.100.${ip++}` }, body: JSON.stringify(b) });
      const dry = await POST(req({ ...single({ imageUrl: ADDRESSES[0] }), dryRun: true }));
      const dj = await dry.json() as { code: string; dryRun?: boolean };
      assert.equal(dry.status, 400, JSON.stringify(dj)); assert.equal(dj.code, "image-url-refused"); assert.equal(dj.dryRun, true);
      const real = await POST(req(single({ imageUrl: ADDRESSES[1] })));
      const rj = await real.json() as { code: string };
      assert.equal(real.status, 400, JSON.stringify(rj)); assert.equal(rj.code, "image-url-refused");
    });
  });
});

describe("a coin registered earlier with an outside image renders as before", () => {
  test("the registry row keeps the address; the coin page, the token list and the badge still answer; the pinned check says it is a link", async () => {
    const w = await makeWorld();
    const outside = "https://example.com/legacy.png";
    const b = await buildLaunchBundle({ creator: CREATOR, ticker: "LEGACY", name: "Legacy", description: "a test", imageUrl: outside, links: [], rule: DENVER_HIGH, firstBuySol: "0", acknowledgements: ACK, cluster: "devnet" }, { program: w.program, launchLab: new FakeLaunchLab(), devFeeWallet: null, attesters: [ATTESTER], quorum: 1, metadataUri: (m) => `https://arweave.net/${m}` });
    assert.ok(!b.notes.some((n) => /link to another website/.test(n)), "the bundle note is gone");
    const t = w.registry.register({ mint: b.mint, ticker: "LEGACY", name: b.name, creator: CREATOR, description: b.description, imageUrl: outside, links: [], rulesText: b.rules.text, feePda: b.addresses.feePda, vault: b.addresses.vault, tokenConfig: b.addresses.tokenConfig, poolId: b.addresses.poolId, launchTx: null, cluster: "devnet", platformId: b.addresses.platformId, baselineAt: "2026-09-01T00:00:00Z", status: "draft" });
    // what pin.ts recorded for an address before 2026-10-19: the address, no image transaction, an empty hash
    w.registry.putTokenMeta({ mint: t.mint, creatorNote: "", metadataUri: `https://arweave.net/${"m".repeat(43)}`, metadataTx: "m".repeat(43), metadataSha256: "cd".repeat(32), imageUri: outside, imageTx: "", imageSha256: "", hosted: false });
    w.registry.markLaunched(t.mint, "launchLEGACY", b.addresses.poolId, "2026-09-01T00:00:00Z");
    const row = w.registry.token(t.mint)!;
    assert.equal(row.imageUrl, outside);
    const page = await tokenPageData(w.p, row, Date.now());
    assert.equal(page.status.profile.imageUrl, outside, "the coin page shows the image it always showed");
    assert.equal(imagePinState(page.status.pinned!), "outside");
    const { PinnedCheck } = await import("../src/app/burnticker/_components/PinnedCheck.tsx");
    const html = renderToStaticMarkup(createElement(PinnedCheck, { pinned: page.status.pinned! }));
    assert.ok(html.includes(IMAGE_OUTSIDE_LINK_LINE.replace(/'/g, "&#x27;")), html);
    assert.doesNotMatch(html, /pinned too/);
    const list = await (await callRoute(`${API}/tokens`)).json() as { tokens: { mint: string; imageUrl: string | null }[] };
    assert.equal(list.tokens.find((x) => x.mint === t.mint)?.imageUrl, outside, "the card source keeps the address");
    const badge = await callRoute(`${API}/badge/${t.mint}.json`);
    assert.equal(badge.status, 200);
  });
});

describe("the SDK", () => {
  test("metadata.imageUrl is refused before any request; null or absent sends imageUrl: null", async () => {
    let sent: Any = null, calls = 0;
    const api = { origin: "https://bt.test", post: async (_p: string, b: unknown) => { calls++; sent = b; throw new Error("stop here"); } } as Any;
    const o = { wallet: Keypair.generate().publicKey, rule: BRONCOS as Any, acknowledgements: { ruleLocked: true as const, noReturns: true as const } };
    await assert.rejects(sdkBuildLaunchBundle(api, { ...o, metadata: { ticker: "SDKI", name: "SDK image", imageUrl: ADDRESSES[1] as never } }), /metadata\.imageUrl is refused/);
    assert.equal(calls, 0);
    for (const metadata of [{ ticker: "SDKI", name: "SDK image", imageUrl: null }, { ticker: "SDKI", name: "SDK image" }]) {
      await assert.rejects(sdkBuildLaunchBundle(api, { ...o, metadata }), /stop here/);
      assert.equal(sent.imageUrl, null);
    }
  });
});
