// 2026-10-27: THE SITE'S COPY OF A COIN'S UPLOADED IMAGE (imageStore.ts, imageChain.ts). The $GASCAT launch happened while the Irys
// gateway redirected every pinned file to a host whose TLS failed; this host kept no copy of the bytes, so the card fell back to the
// receipt initials. Now the launch keeps the exact uploaded bytes under their sha256, GET /burnticker/img/<MINT> serves them only when
// the registry's recorded hash names a sound file, and CoinThumb walks a list of addresses instead of giving up after one.
import { describe, test, after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { clearImageCopyMemo, hasImageCopy, imageCopyDir, imageCopyHref, keepImageCopy, readImageCopy, serveImageCopy, IMAGE_COPY_MAX_BYTES } from "@/lib/burnticker/imageStore";
import { imageSources, IMAGE_MIRROR_RE } from "@/lib/burnticker/imageChain";
import { IMAGE_MIRROR_MISMATCH_LINE, IMAGE_MIRROR_NONE_LINE, IMAGE_MIRROR_OK_LINE, IMAGE_MIRROR_UNREAD_LINE } from "@/lib/burnticker/imagePin";
import { FakePinUploader, pinCoin, sha256Hex, type PinHooks } from "@/lib/burnticker/pin";
import { lintCopy } from "@/lib/launch/copyLint";
import { setPlatformForTests } from "@/lib/burnticker/server";
import { DEBT_RULE } from "./burntickerHelpers.ts";
import { lockRule } from "@/lib/burnticker/rules";

const MINT = "Gas1111111111111111111111111111111111111111";
const OTHER = "Gas2222222222222222222222222222222222222222";
// the smallest real PNG (1 x 1), so the type sniff and the extension agree
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

let dir: string;
before(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "bt-image-copy-")); clearImageCopyMemo(); });
after(() => { fs.rmSync(dir, { recursive: true, force: true }); setPlatformForTests(null); clearImageCopyMemo(); });

describe("imageStore: the copy on disk", () => {
  test("the suite's image directory is a temporary one, never ./data of the checkout", () => {
    assert.ok(path.isAbsolute(imageCopyDir()) && imageCopyDir().startsWith(os.tmpdir().replace(/\/$/, "").split("/").slice(0, 2).join("/")), imageCopyDir());
    assert.notEqual(imageCopyDir(), path.join("data", "burnticker-images"));
    assert.equal(imageCopyDir({}), path.join("data", "burnticker-images"), "the host default");
    assert.equal(imageCopyDir({ BURNTICKER_IMAGE_DIR: " /srv/img " }), "/srv/img");
  });
  test("keepImageCopy writes <sha256>.<ext> from the bytes' own type; readImageCopy gives them back; a second keep is a no-op", () => {
    const k = keepImageCopy(new Uint8Array(PNG), "image/png", dir);
    assert.equal(k.sha256, sha(PNG));
    assert.equal(k.file, path.join(dir, `${sha(PNG)}.png`));
    assert.ok(fs.existsSync(k.file));
    assert.equal(fs.readdirSync(dir).filter((f) => f.endsWith(".tmp")).length, 0, "no temporary file left behind");
    const again = keepImageCopy(new Uint8Array(PNG), "image/png", dir);
    assert.equal(again.file, k.file);
    const r = readImageCopy(sha(PNG), dir);
    assert.ok(r); assert.equal(r.contentType, "image/png"); assert.deepEqual(Buffer.from(r.bytes), PNG);
    assert.equal(hasImageCopy(sha(PNG), dir), true);
    assert.equal(hasImageCopy(sha(PNG).toUpperCase(), dir), true, "the registry's hash case does not matter");
  });
  test("bytes that are not an image, or whose type is not the one named, are refused", () => {
    assert.throws(() => keepImageCopy(new TextEncoder().encode("<svg/>"), "image/svg+xml", dir), /not a PNG, JPG, GIF or WebP/);
    assert.throws(() => keepImageCopy(new Uint8Array(PNG), "image/webp", dir), /image\/png, not the image\/webp/);
    assert.throws(() => keepImageCopy(new Uint8Array(0), "image/png", dir));
  });
  test("a file that does not hash to its name, an oversized file and a malformed hash all read as missing", () => {
    const fake = "ab".repeat(32);
    fs.writeFileSync(path.join(dir, `${fake}.png`), PNG);
    assert.equal(readImageCopy(fake, dir), null, "the name is not the bytes' hash");
    const big = Buffer.concat([PNG, Buffer.alloc(IMAGE_COPY_MAX_BYTES)]);
    fs.writeFileSync(path.join(dir, `${sha(big)}.png`), big);
    assert.equal(readImageCopy(sha(big), dir), null, "over the size bound");
    assert.equal(readImageCopy("../../etc/passwd", dir), null);
    assert.equal(readImageCopy("not-a-hash", dir), null);
    assert.equal(readImageCopy(null, dir), null);
    assert.equal(hasImageCopy("../x", dir), false);
    assert.equal(hasImageCopy(sha(Buffer.from("absent")), dir), false);
  });
});

describe("serveImageCopy and GET /burnticker/img/<MINT>: only on a hash match", () => {
  const registry = (meta: Record<string, string | null>) => ({ tokenMeta: (m: string) => (m in meta ? { imageSha256: meta[m] } : null) });
  test("the registry's recorded hash picks the file; the request contributes the mint only", () => {
    keepImageCopy(new Uint8Array(PNG), "image/png", dir);
    const reg = registry({ [MINT]: sha(PNG), [OTHER]: "cd".repeat(32) });
    const ok = serveImageCopy({ registry: reg, mint: MINT, dir });
    assert.equal(ok.status, 200);
    if (ok.status === 200) { assert.equal(ok.type, "image/png"); assert.equal(ok.sha256, sha(PNG)); assert.deepEqual(Buffer.from(ok.body), PNG); }
    assert.equal(serveImageCopy({ registry: reg, mint: OTHER, dir }).status, 404, "a recorded hash with no file");
    assert.equal(serveImageCopy({ registry: reg, mint: "Nope111111111111111111111111111111111111111", dir }).status, 404, "no such coin");
    assert.equal(serveImageCopy({ registry: registry({ [MINT]: null }), mint: MINT, dir }).status, 404, "no recorded hash: not an uploaded image");
    assert.equal(serveImageCopy({ registry: reg, mint: `${sha(PNG)}.png`, dir }).status, 404, "a file name is not a mint");
    assert.equal(serveImageCopy({ registry: reg, mint: "../" + MINT, dir }).status, 404);
  });
  test("the route: 200 with immutable caching and the hash header on a match; 404 otherwise; the generated art still answers", async () => {
    const saved = process.env.BURNTICKER_IMAGE_DIR;
    process.env.BURNTICKER_IMAGE_DIR = dir;
    clearImageCopyMemo();
    try {
      const locked = lockRule(DEBT_RULE);
      const token = { mint: MINT, ticker: "GASCAT", name: "Gas Cat", status: "live", rulesJson: JSON.stringify(DEBT_RULE), cluster: "mainnet" };
      const reg = { tokenMeta: (m: string) => (m === MINT ? { imageSha256: sha(PNG) } : m === OTHER ? { imageSha256: "ef".repeat(32) } : null), token: (m: string) => (m === MINT ? token : null), tokenByTicker: (t: string) => (t === "GASCAT" ? token : null), tokensByTicker: (t: string) => (t === "GASCAT" ? [token] : []), lockedRule: () => locked };
      setPlatformForTests({ registry: reg } as never);
      const { GET } = await import("../src/app/burnticker/img/[file]/route.ts");
      const ask = (file: string) => GET(new Request(`http://bt.test/burnticker/img/${file}`), { params: Promise.resolve({ file }) });
      const r = await ask(MINT);
      assert.equal(r.status, 200);
      assert.equal(r.headers.get("content-type"), "image/png");
      assert.equal(r.headers.get("cache-control"), "public, max-age=31536000, immutable");
      assert.equal(r.headers.get("x-image-sha256"), sha(PNG));
      assert.equal(r.headers.get("x-content-type-options"), "nosniff");
      assert.deepEqual(Buffer.from(await r.arrayBuffer()), PNG);
      const miss = await ask(OTHER);
      assert.equal(miss.status, 404);
      assert.equal(miss.headers.get("cache-control"), "public, max-age=60");
      assert.equal((await ask("Nope111111111111111111111111111111111111111")).status, 404);
      const art = await ask("GASCAT.svg");
      assert.equal(art.status, 200, "the generated art by ticker is untouched");
      assert.equal(art.headers.get("content-type"), "image/svg+xml");
    } finally { if (saved === undefined) delete process.env.BURNTICKER_IMAGE_DIR; else process.env.BURNTICKER_IMAGE_DIR = saved; clearImageCopyMemo(); }
  });
});

describe("pinCoin keeps the uploaded bytes after the Arweave upload", () => {
  const input = (image: { bytes: Uint8Array; contentType: string } | null) => ({ ticker: "GASCAT", mint: MINT, name: "Gas Cat", description: "d", oneLiner: "o", rule: lockRule(DEBT_RULE).rule, rulesSha256: lockRule(DEBT_RULE).sha256, origin: "https://bt.test", links: [], image });
  test("the kept hook hears the exact bytes and their sha256 once the image is uploaded; the upload itself is unchanged", async () => {
    const up = new FakePinUploader();
    const heard: { sha: string; type: string; n: number }[] = [];
    const order: string[] = [];
    const hooks: PinHooks = { uploaded: (kind) => order.push(`uploaded:${kind}`), kept: (bytes, s, t) => { order.push("kept"); heard.push({ sha: s, type: t, n: bytes.byteLength }); } };
    const pin = await pinCoin(up, input({ bytes: new Uint8Array(PNG), contentType: "image/png" }), hooks);
    assert.equal(pin.imageSha256, sha(PNG));
    assert.deepEqual(heard, [{ sha: sha(PNG), type: "image/png", n: PNG.length }]);
    assert.deepEqual(order, ["uploaded:image", "kept", "uploaded:metadata"], "after the image upload, before the metadata");
    assert.ok(up.uploads.some((u) => u.contentType === "image/png" && sha256Hex(u.bytes) === sha(PNG)), "the Arweave upload still happened");
  });
  test("a throw from the hook never refuses the launch; a recalled upload still keeps the bytes; the receipt art is not kept", async () => {
    const up = new FakePinUploader();
    const pin = await pinCoin(up, input({ bytes: new Uint8Array(PNG), contentType: "image/png" }), { kept: () => { throw new Error("disk full"); } });
    assert.equal(pin.imageSha256, sha(PNG));
    let kept = 0;
    await pinCoin(up, input({ bytes: new Uint8Array(PNG), contentType: "image/png" }), { recall: (s) => (s === sha(PNG) ? { id: "x", url: "https://arweave.net/x" } : null), kept: () => { kept++; } });
    assert.equal(kept, 1, "a retry that reused the file still writes the copy");
    kept = 0;
    await pinCoin(up, input(null), { kept: () => { kept++; } });
    assert.equal(kept, 0, "the generated art is re-rendered from the rule; no copy");
  });
  test("a failed upload keeps nothing", async () => {
    let kept = 0;
    await assert.rejects(pinCoin(new FakePinUploader({ fail: true }), input({ bytes: new Uint8Array(PNG), contentType: "image/png" }), { kept: () => { kept++; } }));
    assert.equal(kept, 0);
  });
});

describe("imageChain: the addresses CoinThumb walks", () => {
  const TX = "DzUsH1bfBKtyFnhXXZL5sQ6uV7mU7fvPvdv7D5A35qbj";
  test("a pinned image with a site copy: the copy, the row's address, the other gateway, the generated art", () => {
    assert.deepEqual(imageSources({ src: `https://gateway.irys.xyz/${TX}`, mirror: imageCopyHref(MINT), ticker: "GASCAT", generated: true }),
      [`/burnticker/img/${MINT}`, `https://gateway.irys.xyz/${TX}`, `https://arweave.net/${TX}`, "/burnticker/img/GASCAT.svg"]);
    assert.deepEqual(imageSources({ src: `https://arweave.net/${TX}`, mirror: null, ticker: "GASCAT" }),
      [`https://arweave.net/${TX}`, `https://gateway.irys.xyz/${TX}`], "a row naming arweave.net tries the gateway second; no generated art on a card");
    assert.deepEqual(imageSources({ src: `https://devnet.irys.xyz/${TX}`, ticker: "GASCAT" }), [`https://devnet.irys.xyz/${TX}`], "a devnet file is on Irys devnet only");
  });
  test("a mirror address is only ever /burnticker/img/<mint>; other sources keep their old behaviour", () => {
    assert.ok(IMAGE_MIRROR_RE.test(imageCopyHref(MINT)));
    assert.deepEqual(imageSources({ src: "https://example.com/a.png", mirror: "https://evil.example/x", ticker: "X" }), ["https://example.com/a.png"], "a mirror that is not same-origin is ignored");
    assert.deepEqual(imageSources({ src: "https://example.com/a.png", mirror: "/burnticker/img/../../x", ticker: "X" }), ["https://example.com/a.png"]);
    assert.deepEqual(imageSources({ src: "/burnticker/brand/deficit.png", ticker: "DEFICIT" }), ["/burnticker/brand/deficit.png"], "audit 6 item 23: a same-origin image is shown as is");
    assert.deepEqual(imageSources({ src: null, ticker: "GASCAT", generated: true }), ["/burnticker/img/GASCAT.svg"], "no image of its own: the generated art");
    assert.deepEqual(imageSources({ src: null, ticker: "GASCAT" }), [], "nothing to try: the receipt initials at once");
    assert.deepEqual(imageSources({ src: "data:image/png;base64,AAAA", ticker: "X", preview: true }), ["data:image/png;base64,AAAA"]);
    assert.deepEqual(imageSources({ src: "data:image/png;base64,AAAA", ticker: "X" }), [], "a data: image only in a preview");
    assert.deepEqual(imageSources({ src: "javascript:alert(1)", ticker: "X" }), []);
  });
  test("CoinThumb advances through the list on each error (the source code walks an index, keyed per address)", () => {
    const src = fs.readFileSync(path.join(import.meta.dirname, "../src/app/burnticker/_components/CoinCard.tsx"), "utf8");
    const thumb = src.slice(src.indexOf("export function CoinThumb("), src.indexOf("export function VenueChip("));
    assert.match(thumb, /imageSources\(\{ src, mirror, ticker, generated, preview \}\)/);
    assert.match(thumb, /onError=\{\(\) => setFailed\(\(n\) => n \+ 1\)\}/, "a load error moves to the next address");
    assert.match(thumb, /key=\{url\}/, "a new address is a new img element, so the next error fires too");
    assert.match(thumb, /referrerPolicy="no-referrer"/);
    assert.match(thumb, /if \(!url\) return <ReceiptThumb/, "past the last address: the receipt initials");
  });
});

describe("the pinned check's words about the site copy", () => {
  test("every line lints, says the Arweave copy is the permanent record, and calls the site copy a mirror or says there is none", () => {
    for (const l of [IMAGE_MIRROR_OK_LINE, IMAGE_MIRROR_MISMATCH_LINE, IMAGE_MIRROR_NONE_LINE, IMAGE_MIRROR_UNREAD_LINE]) {
      assert.deepEqual(lintCopy(l).hits, [], l);
      assert.match(l, /Arweave copy is the permanent record/);
      assert.doesNotMatch(l, /\bwill\b|\bbuy\b|\bprice\b/i);
    }
    assert.match(IMAGE_MIRROR_OK_LINE, /mirror/);
  });
  test("the pin-check route reports the mirror beside the metadata verdict", async () => {
    const saved = process.env.BURNTICKER_IMAGE_DIR;
    process.env.BURNTICKER_IMAGE_DIR = dir;
    clearImageCopyMemo();
    keepImageCopy(new Uint8Array(PNG), "image/png", dir);
    const body = new TextEncoder().encode(JSON.stringify({ name: "X", description: "locked words" }));
    const metaOf = (imageSha256: string | null) => ({ metadataUri: "https://gateway.irys.xyz/m", metadataSha256: sha(body), imageUri: "https://gateway.irys.xyz/i", imageSha256, hosted: false });
    const reg = { token: (m: string) => (m === MINT || m === OTHER ? { mint: m, ticker: "X", description: "locked words", rulesJson: "{}" } : null), tokenMeta: (m: string) => (m === MINT ? metaOf(sha(PNG)) : m === OTHER ? metaOf(null) : null), lockedRule: () => ({ rule: {} }) };
    setPlatformForTests({ registry: reg } as never);
    const real = globalThis.fetch;
    globalThis.fetch = (async () => new Response(Buffer.from(body), { headers: { "content-type": "application/json" } })) as typeof fetch;
    try {
      const { GET } = await import("../src/app/api/burnticker/pin-check/route.ts");
      const ask = (m: string) => GET(new Request(`http://bt.test/api/burnticker/pin-check?mint=${m}`, { headers: { "x-forwarded-for": "203.0.113.78" } }));
      const a = await (await ask(MINT)).json() as { ok: boolean | null; image: { mirror: string; href: string | null } };
      assert.deepEqual(a.image, { mirror: "ok", href: `/burnticker/img/${MINT}` });
      const b = await (await ask(OTHER)).json() as { image: { mirror: string; href: string | null } };
      assert.deepEqual(b.image, { mirror: "none", href: null }, "no recorded hash: the receipt art or an outside link");
    } finally { globalThis.fetch = real; if (saved === undefined) delete process.env.BURNTICKER_IMAGE_DIR; else process.env.BURNTICKER_IMAGE_DIR = saved; clearImageCopyMemo(); }
  });
});
