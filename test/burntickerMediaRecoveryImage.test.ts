// LAUNCH AUDIT 219–227 (launch-media-recovery, 2026-10-12): the creator's image on the review card. ProfileFields.tsx hands every pick
// to profileImagePick.ts pickImage; these tests drive that with fake file reads and a fake preview route, then check the real preview
// route's answer shape and the host limits on the largest body. Nothing is pinned, built or sent.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createLatest } from "@/lib/burnticker/latestOnly";
import { IMAGE_MAX_BYTES, IMAGE_HELP, decodeCreatorImage, imageFileProblem } from "@/lib/burnticker/creatorProfile";
import { BADGE_UNAVAILABLE_LINE, IMAGE_SIZE_HELP, MAX_PAIR_IMAGE_BYTES_IN_BODY, PREVIOUS_IMAGE_KEPT, pickImage, readPreviewAnswer, sniffBase64, type ImageFields, type PickDeps } from "@/lib/burnticker/profileImagePick";
import { BADGE_NOTE } from "@/lib/burnticker/creatorBadgeCopy";
import { IMAGE_NOT_KEPT } from "@/lib/burnticker/guidedLaunch";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";

const ROOT = path.join(import.meta.dirname, "..");
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");
const cfg = loadCopyLintConfig();
const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
const fileOf = (o: { name?: string; type: string; bytes?: Buffer; size?: number }) => Object.defineProperties(new Blob([new Uint8Array(o.bytes ?? PNG_HEAD)]), { name: { value: o.name ?? "a.png" }, type: { value: o.type }, size: { value: o.size ?? (o.bytes ?? PNG_HEAD).length } }) as Blob & { name: string; size: number; type: string };
const dataUrl = (type: string, bytes: Buffer) => `data:${type || "application/octet-stream"};base64,${bytes.toString("base64")}`;

/** a profile held like React state, plus the busy line and the error line the component shows */
function harness(start: Partial<ImageFields> = {}, preview: PickDeps<ImageFields>["preview"] = async () => ({ status: 200, body: { contentType: "image/png", base64: PNG_HEAD.toString("base64") } })) {
  const h = { v: { image: null, rights: false, badge: true, imageState: null, ...start } as ImageFields, busy: false, err: null as string | null };
  const latest = createLatest();
  const deps: PickDeps<ImageFields> = {
    latest, update: (fn) => { h.v = fn(h.v); }, hasImage: () => !!h.v.image, setBusy: (b) => { h.busy = b; }, setError: (m) => { h.err = m; },
    readDataUrl: async (f) => dataUrl((f as Blob & { type: string }).type, Buffer.from(await f.arrayBuffer())), preview,
  };
  return { h, deps, latest };
}
const IMG = { badgedUrl: "data:image/png;base64,OLD", plainUrl: "data:image/png;base64,OLD", contentType: "image/png", base64: "OLD", name: "old.png" };

describe("219 [FIX] an invalid file after a pick in flight clears the busy line", () => {
  test("a valid pick waits on the preview (busy), then a refused file is chosen: busy is off and the error shows", async () => {
    let answer!: (v: { status: number; body: unknown }) => void;
    const { h, deps } = harness({}, () => new Promise((r) => { answer = r; }));
    const first = pickImage(fileOf({ type: "image/png" }), deps);
    await new Promise((r) => setImmediate(r));
    assert.equal(h.busy, true, "the first pick shows Adding the receipt mark");
    // the defect: this branch cancelled the first pick's token, so the first pick's finally never cleared busy; nothing else did either
    assert.equal(await pickImage(fileOf({ type: "text/plain", name: "a.txt" }), deps), "failed");
    assert.equal(h.busy, false, "no spinner forever");
    assert.match(h.err!, /PNG, JPG, GIF or WebP/);
    answer({ status: 200, body: { contentType: "image/png", base64: "AAAA" } });
    assert.equal(await first, "stale", "the older answer is dropped");
    assert.equal(h.busy, false); assert.equal(h.v.image, null);
  });
  test("the component's pick goes through pickImage (no hand-rolled branch left)", () => {
    const pf = read("src/app/burnticker/launch/ProfileFields.tsx");
    assert.match(pf, /void pickImage<ProfileValue>\(f, \{/);
    assert.match(pf, /setBusy, setError: setFileErr/);
    assert.doesNotMatch(pf, /if \(bad\) \{ latest\.cancel\(\); setFileErr\(bad\)/);
  });
});

describe("220 a failed replacement keeps the image already chosen", () => {
  test("refused by the server (400): the old image stays, the launch is not blocked, the message says it is kept", async () => {
    const { h, deps } = harness({ image: IMG, rights: true }, async () => ({ status: 400, body: { error: "The image is too small. Send one at least 16 pixels on each side." } }));
    assert.equal(await pickImage(fileOf({ type: "image/png" }), deps), "failed");
    assert.equal(h.v.image, IMG); assert.equal(h.v.rights, true); assert.equal(h.v.imageState, null);
    assert.equal(h.err, `The image is too small. Send one at least 16 pixels on each side. ${PREVIOUS_IMAGE_KEPT}`);
    assert.equal(h.busy, false);
  });
  test("a wrong file type with an image chosen: the image stays; with none chosen the field shows the failure", async () => {
    const a = harness({ image: IMG });
    await pickImage(fileOf({ type: "application/pdf", name: "a.pdf" }), a.deps);
    assert.deepEqual([a.h.v.image, a.h.v.imageState], [IMG, null]);
    const b = harness();
    await pickImage(fileOf({ type: "application/pdf", name: "a.pdf" }), b.deps);
    assert.deepEqual([b.h.v.image, b.h.v.imageState], [null, "failed"]);
    assert.doesNotMatch(b.h.err!, /kept/);
  });
});

describe("221 the plain image is used when the mark service cannot answer", () => {
  for (const [label, preview] of [["a 502", async () => ({ status: 502, body: { error: "The preview could not be made just now." } })], ["no network", async () => { throw new TypeError("Failed to fetch"); }], ["a broken answer", async () => ({ status: 200, body: { base64: "AAAA" } })]] as const) {
    test(`${label}: the creator's file is chosen without the mark, nothing blocks the launch`, async () => {
      const { h, deps } = harness({}, preview as PickDeps<ImageFields>["preview"]);
      assert.equal(await pickImage(fileOf({ type: "image/png" }), deps), "plain");
      assert.equal(h.v.image!.badgeUnavailable, true);
      assert.equal(h.v.image!.badgedUrl, h.v.image!.plainUrl);
      assert.equal(h.v.badge, false, "a launch then sends imageBadge false: the server pins the plain upload");
      assert.deepEqual([h.v.imageState, h.err, h.busy], [null, null, false]);
    });
  }
  test("a mark that comes back later turns the mark on again", async () => {
    const { h, deps } = harness({ image: { ...IMG, badgeUnavailable: true }, badge: false });
    assert.equal(await pickImage(fileOf({ type: "image/png" }), deps), "badged");
    assert.deepEqual([h.v.badge, h.v.image!.badgeUnavailable], [true, undefined]);
  });
  test("the field says so in place of the mark choice", () => {
    const pf = read("src/app/burnticker/launch/ProfileFields.tsx");
    assert.match(pf, /value\.image\?\.badgeUnavailable && <p data-badge-unavailable>\{BADGE_UNAVAILABLE_LINE\}<\/p>/);
    assert.match(pf, /value\.image && !value\.image\.badgeUnavailable && <label/);
    assert.ok(lintCopy(BADGE_UNAVAILABLE_LINE, cfg).ok);
  });
});

describe("222 the size advice sits beside the image control", () => {
  test("16 pixels minimum and the recommended square size", () => {
    assert.match(IMAGE_SIZE_HELP, /16 pixels/); assert.match(IMAGE_SIZE_HELP, /square image at least 512 pixels/);
    assert.ok(lintCopy(IMAGE_SIZE_HELP, cfg).ok);
    assert.match(read("src/app/burnticker/launch/ProfileFields.tsx"), /\{IMAGE_WAYS\} \{IMAGE_HELP\} \{IMAGE_SIZE_HELP\}/);
    assert.match(read("src/lib/burnticker/creatorBadge.ts"), /if \(w < 16 \|\| h < 16\)/, "the 16 in the help is the server's own floor");
    assert.match(IMAGE_HELP, /2 MB/);
  });
});

describe("223 [VERIFY] the preview response shape", () => {
  test("the route answers { contentType, base64 } for a real image and a plain 400 for a refused one; the client reads exactly that", async () => {
    const sharp = (await import("sharp")).default;
    const { POST } = await import("../src/app/api/burnticker/launch/image-preview/route.ts");
    const call = async (bytes: Buffer) => POST(new Request("http://bt.test/api/burnticker/launch/image-preview", { method: "POST", headers: { host: "bt.test", origin: "http://bt.test", "content-type": "application/json" }, body: JSON.stringify({ image: { contentType: "image/png", base64: bytes.toString("base64") } }) }));
    const ok = await call(await sharp({ create: { width: 64, height: 64, channels: 3, background: "#204080" } }).png().toBuffer());
    const j = await ok.json() as Record<string, unknown>;
    assert.equal(ok.status, 200);
    assert.equal(j.contentType, "image/png"); assert.equal(typeof j.base64, "string"); assert.equal(j.side, 64);
    const a = readPreviewAnswer(ok.status, j);
    assert.ok("ok" in a && sniffBase64(a.ok.base64) === "image/png");
    const small = await call(await sharp({ create: { width: 8, height: 8, channels: 3, background: "#204080" } }).png().toBuffer());
    const sj = await small.json();
    assert.equal(small.status, 400);
    assert.deepEqual(readPreviewAnswer(small.status, sj), { refused: "The image is too small. Send one at least 16 pixels on each side." });
    assert.deepEqual(readPreviewAnswer(200, { contentType: "image/gif", base64: "AAAA" }), { unavailable: true }, "only PNG or JPEG ever comes back");
  });
});

describe("224 [VERIFY] two 2 MB images in one pair body fit every host limit", () => {
  test("the largest body is about 5.6 MB of base64; no proxy, Caddy rule or route cap below it", () => {
    assert.ok(MAX_PAIR_IMAGE_BYTES_IN_BODY < 6 * 1024 * 1024, String(MAX_PAIR_IMAGE_BYTES_IN_BODY));
    // exactly 2 MB decodes on the server (the base64 length guard is not tighter than the byte cap)
    const max = Buffer.alloc(IMAGE_MAX_BYTES); PNG_HEAD.copy(max);
    assert.ok("ok" in decodeCreatorImage({ contentType: "image/png", base64: max.toString("base64") }));
    // Next 16 buffers a body only behind a proxy file (proxyClientMaxBodySize, 10 MB default); there is none here
    for (const f of ["src/proxy.ts", "src/middleware.ts", "proxy.ts", "middleware.ts"]) assert.ok(!fs.existsSync(path.join(ROOT, f)), f);
    assert.doesNotMatch(read("next.config.ts"), /bodySizeLimit|proxyClientMaxBodySize|middlewareClientMaxBodySize/);
    for (const f of fs.readdirSync(path.join(ROOT, "deploy/caddy"))) assert.doesNotMatch(read(`deploy/caddy/${f}`), /request_body|max_size/, f);
    assert.match(read("src/app/api/burnticker/launch/route.ts"), /body = await req\.json\(\)/);
  });
});

describe("225 [VERIFY] an empty browser type", () => {
  test("the old check refused a real PNG whose browser type was empty; the pick now reads its type from its bytes", async () => {
    assert.ok(imageFileProblem({ size: 100, type: "" }), "the declared-type check alone refuses it (the defect)");
    let sent: { contentType: string } | null = null;
    const { h, deps } = harness({}, async (img) => { sent = img; return { status: 200, body: { contentType: "image/png", base64: PNG_HEAD.toString("base64") } }; });
    assert.equal(await pickImage(fileOf({ type: "", name: "" }), deps), "badged");
    assert.equal(sent!.contentType, "image/png");
    assert.equal(h.v.image!.contentType, "image/png"); assert.equal(h.v.image!.name, "pasted-image.png");
    assert.match(h.v.image!.plainUrl, /^data:image\/png;base64,/);
  });
  test("an empty type over bytes that are no image is refused, and an oversized one before it is read", async () => {
    const a = harness();
    assert.equal(await pickImage(fileOf({ type: "", bytes: Buffer.from("hello world, not an image") }), a.deps), "failed");
    assert.match(a.h.err!, /PNG, JPG, GIF or WebP/);
    const b = harness();
    let readCalled = false; b.deps.readDataUrl = async () => { readCalled = true; return ""; };
    assert.equal(await pickImage(fileOf({ type: "", size: IMAGE_MAX_BYTES + 1 }), b.deps), "failed");
    assert.equal(readCalled, false); assert.match(b.h.err!, /2 MB/);
  });
});

describe("226 the receipt mark is branding, not verification", () => {
  test("the note beside the toggle says it is not a verification (already in place)", () => {
    assert.match(BADGE_NOTE, /It is not a verification/);
  });
});

describe("227 a restored Coin vs Coin draft says the image was not kept", () => {
  test("the tile records that an image was chosen, never the image, and says so after a restore", () => {
    const tile = read("src/app/burnticker/launch/CoinVsCoinTile.tsx");
    assert.match(tile, /images: \{ a: !!profA\.image, b: !!profB\.image \}/);
    assert.match(tile, /if \(d\.images\?\.a \|\| d\.images\?\.b\) setImagesDropped\(true\)/);
    assert.match(tile, /imagesDropped && !profA\.image && !profB\.image && <p[^>]*data-image-not-kept>\{IMAGE_NOT_KEPT\}<\/p>/);
    assert.doesNotMatch(tile, /base64: profA|profA\.image\.base64/);
    assert.ok(lintCopy(IMAGE_NOT_KEPT, cfg).ok);
  });
});
