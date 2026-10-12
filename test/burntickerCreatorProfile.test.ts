// WEBSITE-15 ITEM 13 (owner decisions 2026-10-12): a creator may upload an image, write a description of up to 280 characters and add
// X, Telegram and website links. The generated rule sentence stays first and mandatory; the creator's text follows it and passes the
// creator lint; an upload is checked by type and size in the browser and again on the server, carries the rights line the creator
// confirms, and is pinned with the metadata; the site honors a takedown list; the operator page gives the takedown route.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { Keypair } from "@solana/web3.js";
import { prepareLaunch } from "@/lib/burnticker/api/handlers";
import { FakePinUploader } from "@/lib/burnticker/pin";
import { customImagesEnabled } from "@/lib/burnticker/pin";
import { DESCRIPTION_MAX, IMAGE_MAX_BYTES, RIGHTS_LINE, TAKEDOWN_LINE, creatorLinks, creatorTextOf, decodeCreatorImage, imageFileProblem, sniffImageType, withCreatorText } from "@/lib/burnticker/creatorProfile";
import { imageTakenDown, tokenPageData } from "@/lib/burnticker/server";
import { buildLaunchReview } from "@/lib/burnticker/launchReview";
import { formatHits, lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import { nativeRule } from "@/lib/burnticker/sources/native";
import { teamSeries } from "@/lib/burnticker/sources/espn";
import { CREATOR, makeWorld } from "./burntickerApiHelpers.ts";

const RAYS = nativeRule(teamSeries("mlb", "TB", "win", { kind: "season", year: 2026 }), { fractionOfPool: 0.02 });
const body = (o: Record<string, unknown> = {}) => ({ creator: CREATOR, ticker: "RAYS26", name: "Rays 2026 Wins", rule: RAYS, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true }, ...o });
type Err = { error: { status: number; body: { error: string; code?: string } } };
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 1, 2, 3, 4]);
const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");
const cfg = loadCopyLintConfig();
const clean = (t: string) => { const r = lintCopy(t, cfg); assert.ok(r.ok, formatHits(r)); };

describe("the image: type by its bytes, 2 MB, the rights line", () => {
  test("browser and server checks refuse the wrong type, an oversize file and bytes that do not match their type", () => {
    assert.equal(imageFileProblem({ size: 10, type: "image/svg+xml" }), "The image has to be a PNG, JPG, GIF or WebP file.");
    assert.equal(imageFileProblem({ size: IMAGE_MAX_BYTES + 1, type: "image/png" }), "The image has to be 2 MB or smaller.");
    assert.equal(imageFileProblem({ size: IMAGE_MAX_BYTES, type: "image/webp" }), null);
    assert.equal(sniffImageType(PNG), "image/png"); assert.equal(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0])), "image/jpeg");
    assert.ok("ok" in decodeCreatorImage({ contentType: "image/png", base64: b64(PNG) }));
    assert.match((decodeCreatorImage({ contentType: "image/jpeg", base64: b64(PNG) }) as { error: string }).error, /do not match its type/);
    assert.match((decodeCreatorImage({ contentType: "image/svg+xml", base64: b64(PNG) }) as { error: string }).error, /PNG, JPG, GIF or WebP/);
    const big = new Uint8Array(IMAGE_MAX_BYTES + 10); big.set(PNG);
    assert.match((decodeCreatorImage({ contentType: "image/png", base64: b64(big) }) as { error: string }).error, /2 MB or smaller/);
    assert.equal(customImagesEnabled({}), true, "on by default"); assert.equal(customImagesEnabled({ BURNTICKER_CUSTOM_IMAGES_ENABLED: "0" }), false);
  });
  test("the server refuses an image without the confirmed rights line, then pins the uploaded bytes and shows them", async () => {
    const w = await makeWorld(); w.p.customImages = true;
    const up = w.p.uploader as FakePinUploader;
    const noRights = await prepareLaunch(w.p, body({ image: { contentType: "image/png", base64: b64(PNG) } }), { register: false }) as Err;
    assert.equal(noRights.error.body.code, "image-rights"); assert.ok(noRights.error.body.error.includes(RIGHTS_LINE));
    const wrong = await prepareLaunch(w.p, body({ image: { contentType: "image/gif", base64: b64(PNG) }, imageRights: true }), { register: false }) as Err;
    assert.equal(wrong.error.body.code, "image-refused");
    const mint = Keypair.generate().publicKey.toBase58();
    const real = new Uint8Array(await (await import("sharp")).default({ create: { width: 64, height: 64, channels: 3, background: "#204080" } }).png().toBuffer());
    const r = await prepareLaunch(w.p, body({ image: { contentType: "image/png", base64: b64(real) }, imageRights: true, creatorDescription: "Made by a Rays fan in Tampa.", links: creatorLinks({ x: "https://x.com/raysfan", website: "https://example.org" }).links }), { register: true, mint });
    assert.ok("ok" in r, JSON.stringify(r).slice(0, 300));
    const meta = w.registry.tokenMeta(mint)!;
    const pinnedImg = up.get(meta.imageTx!)!;
    assert.notDeepEqual([...pinnedImg], [...real], "the pinned copy carries the receipt mark"); assert.equal(sniffImageType(pinnedImg), "image/png");
    const pinned = JSON.parse(new TextDecoder().decode(up.get(meta.metadataTx!)!)) as { description: string; image: string; extensions: Record<string, string>; properties: { files: { type: string }[] } };
    assert.ok(pinned.description.startsWith("2026 SEASON\n$RAYS26 burns when the Rays win."), "the generated rule sentence stays first");
    assert.ok(pinned.description.includes("\n\nMade by a Rays fan in Tampa."), "the creator's text follows it");
    assert.deepEqual(pinned.extensions, { twitter: "https://x.com/raysfan", website: "https://example.org" }); assert.equal(pinned.properties.files[0].type, "image/png");
    const t = w.registry.token(mint)!;
    assert.equal(t.imageUrl, meta.imageUri, "the card and the coin page show the pinned image");
    const page = await tokenPageData(w.p, t, Date.now());
    assert.equal(page.status.profile.creatorText, "Made by a Rays fan in Tampa."); assert.equal(page.status.profile.imageUrl, meta.imageUri);
  });
  test("no image: the generated receipt art is the fallback", async () => {
    const w = await makeWorld();
    const up = w.p.uploader as FakePinUploader;
    const mint = Keypair.generate().publicKey.toBase58();
    assert.ok("ok" in await prepareLaunch(w.p, body(), { register: true, mint }));
    const png = up.get(w.registry.tokenMeta(mint)!.imageTx!)!;
    assert.deepEqual([...png.slice(0, 4)], [0x89, 0x50, 0x4e, 0x47]); assert.equal(w.registry.token(mint)!.imageUrl, null);
  });
});

describe("the description and the links", () => {
  test("the rule sentence comes first; the creator's text is linted (no affiliation) and capped at 280", async () => {
    assert.equal(withCreatorText("$X burns when the Rays win.", "Hi."), "$X burns when the Rays win.\n\nHi."); assert.equal(creatorTextOf("$X burns.\n\nHi."), "Hi."); assert.equal(creatorTextOf("$X burns."), null);
    const w = await makeWorld();
    const off = await prepareLaunch(w.p, body({ creatorDescription: "The official coin of the Tampa Bay Rays." }), { register: false }) as Err;
    assert.equal(off.error.status, 403); assert.equal(off.error.body.code, "copy-lint");
    const long = await prepareLaunch(w.p, body({ creatorDescription: "x".repeat(DESCRIPTION_MAX + 1) }), { register: false }) as Err;
    assert.equal(long.error.body.code, "description-too-long");
    const label = await prepareLaunch(w.p, body({ links: [{ label: "Official site", url: "https://example.org" }] }), { register: false }) as Err;
    assert.equal(label.error.body.code, "copy-lint", "a link label passes the same lint");
    const rv = buildLaunchReview({ rule: RAYS, ticker: "RAYS26", name: "Rays 2026 Wins", creatorDescription: "The official coin of the Rays." } as never);
    assert.ok("review" in rv && rv.review.problems.some((x) => /^The description "The official coin of the Rays\." contains "official"/.test(x)), "the review lists it before any wallet opens");
    assert.deepEqual(creatorLinks({ x: "http://x.com/a", telegram: "https://t.me/a" }), { links: [{ label: "Telegram", url: "https://t.me/a" }], problems: ["The X link has to start with https:// and have no spaces."] });
  });
});

describe("the rights line and the takedown route", () => {
  test("both pass the copy lint; the review card shows the rights line; the operator page gives the route; the site honors the list", () => {
    clean(RIGHTS_LINE); clean(TAKEDOWN_LINE);
    assert.equal(RIGHTS_LINE, "I have the right to use this image. A team, league or company mark is used at my own risk.");
    assert.equal(TAKEDOWN_LINE, "To ask for an image to be removed from this site, email contact@burnticker.com. The copy on Arweave is permanent and cannot be removed.");
    assert.match(fs.readFileSync("src/app/burnticker/launch/ProfileFields.tsx", "utf8"), /<span data-rights-line>\{RIGHTS_LINE\}<\/span>/);
    assert.match(fs.readFileSync("src/app/burnticker/operator/page.tsx", "utf8"), /<p className="text-xs" data-takedown><MailSafe text=\{TAKEDOWN_LINE\} \/><\/p>/);
    const list = JSON.parse(fs.readFileSync("config/burnticker/image-takedowns.json", "utf8")) as { mints: string[] };
    assert.deepEqual(list.mints, []); assert.equal(imageTakenDown("anything"), false);
    assert.match(fs.readFileSync("src/lib/burnticker/server.ts", "utf8"), /if \(status\.profile && imageTakenDown\(t\.mint\)\) status\.profile = \{ \.\.\.status\.profile, imageUrl: null \};/);
  });
});

describe("the receipt mark on an uploaded image (owner addition 2026-10-12)", () => {
  const sharp = async () => (await import("sharp")).default;
  const solid = async (w: number, h: number, fmt: "png" | "jpeg") => { const s = await sharp(); const img = s({ create: { width: w, height: h, channels: 3, background: { r: 255, g: 0, b: 255 } } }); return new Uint8Array(fmt === "png" ? await img.png().toBuffer() : await img.jpeg({ quality: 95 }).toBuffer()); };
  const px = async (bytes: Uint8Array, x: number, y: number) => { const s = await sharp(); const { data, info } = await s(bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true }); const i = (y * info.width + x) * info.channels; return [data[i], data[i + 1], data[i + 2]]; };
  test("a fixture in: the mark sits lower left at about 12% width and 3% inset, on a light keyline; square; the format kept", async () => {
    const { badgeCreatorImage, badgeBox } = await import("@/lib/burnticker/creatorBadge");
    const out = await badgeCreatorImage(await solid(600, 400, "png"), "image/png");
    assert.ok("ok" in out); assert.equal(out.ok.contentType, "image/png"); assert.equal(out.ok.side, 400);
    const s = await sharp(); const m = await s(out.ok.bytes).metadata();
    assert.deepEqual([m.width, m.height, m.format], [400, 400, "png"], "square, same format");
    const b = badgeBox(400);
    assert.deepEqual([b.x, b.size - 2 * b.keyline], [12, 48], "3% inset, 12% wide");
    assert.equal(b.y + b.size, 400 - 12, "3% from the bottom");
    const key = await px(out.ok.bytes, b.x, b.y + Math.floor(b.size / 2));
    assert.ok(key.every((c) => c > 200), `the keyline is light: ${key}`);
    const inside = await px(out.ok.bytes, b.x + Math.floor(b.size / 2), b.y + Math.floor(b.size / 2));
    assert.notDeepEqual(inside, [255, 0, 255], "the mark covers the corner");
    assert.deepEqual(await px(out.ok.bytes, 380, 20), [255, 0, 255], "the rest of the image is untouched");
    assert.deepEqual(await px(out.ok.bytes, b.x + b.size + 4, b.y + Math.floor(b.size / 2)), [255, 0, 255], "nothing beyond the badge");
    const jpg = await badgeCreatorImage(await solid(300, 300, "jpeg"), "image/jpeg");
    assert.ok("ok" in jpg); assert.equal(jpg.ok.contentType, "image/jpeg"); assert.equal((await s(jpg.ok.bytes).metadata()).format, "jpeg");
  });
  test("the 2 MB cap holds after compositing (re-encoded and scaled down when needed); the art fallback is never badged", async () => {
    const { badgeCreatorImage } = await import("@/lib/burnticker/creatorBadge");
    const s = await sharp();
    const n = 1100, raw = (await import("node:crypto")).randomBytes(n * n * 3);
    const noisy = new Uint8Array(await s(raw, { raw: { width: n, height: n, channels: 3 } }).png().toBuffer());
    assert.ok(noisy.length > IMAGE_MAX_BYTES, "the fixture would break the cap as it is");
    const out = await badgeCreatorImage(noisy, "image/png");
    assert.ok("ok" in out); assert.ok(out.ok.bytes.length <= IMAGE_MAX_BYTES); assert.ok(out.ok.side < n);
    const h = fs.readFileSync("src/lib/burnticker/api/handlers.ts", "utf8");
    assert.match(h, /const badged = await badgeCreatorImage\(d\.ok\.bytes, d\.ok\.contentType\);/);
    assert.equal((h.match(/badgeCreatorImage\(/g) ?? []).length, 1, "only an upload is badged (when the creator keeps the mark on); the generated receipt art is the brand already");
    const pf = fs.readFileSync("src/app/burnticker/launch/ProfileFields.tsx", "utf8");
    assert.match(pf, /fetch\("\/api\/burnticker\/launch\/image-preview"/);
  });
});

describe("the receipt mark is optional, on by default (owner, 2026-10-12)", () => {
  test("default on pins the badged copy; imageBadge false pins the plain upload; the choice is recorded; the stub path is unchanged", async () => {
    const { BADGE_NOTE, BADGE_TOGGLE } = await import("@/lib/burnticker/creatorBadgeCopy");
    assert.equal(BADGE_NOTE, "The small receipt mark says the coin was made here. It is not a verification; the coin page and the mint check are.");
    assert.equal(BADGE_TOGGLE, "Add the Burnticker receipt mark"); clean(BADGE_NOTE); clean(BADGE_TOGGLE);
    const real = new Uint8Array(await (await import("sharp")).default({ create: { width: 64, height: 64, channels: 3, background: "#204080" } }).png().toBuffer());
    const run = async (extra: Record<string, unknown>) => {
      const w = await makeWorld(); w.p.customImages = true; const up = w.p.uploader as FakePinUploader;
      const mint = Keypair.generate().publicKey.toBase58();
      const r = await prepareLaunch(w.p, body({ image: { contentType: "image/png", base64: b64(real) }, imageRights: true, ...extra }), { register: true, mint });
      assert.ok("ok" in r, JSON.stringify(r).slice(0, 200));
      const meta = w.registry.tokenMeta(mint)!;
      return { img: up.get(meta.imageTx!)!, json: JSON.parse(new TextDecoder().decode(up.get(meta.metadataTx!)!)) as { attributes: { trait_type: string; value: string }[] } };
    };
    const on = await run({});
    assert.notDeepEqual([...on.img], [...real], "default on: the badged copy");
    assert.deepEqual(on.json.attributes.find((a) => a.trait_type === "Burnticker receipt mark"), { trait_type: "Burnticker receipt mark", value: "on" });
    const off = await run({ imageBadge: false });
    assert.deepEqual([...off.img], [...real], "toggled off: the plain upload, as checked");
    assert.equal(off.json.attributes.find((a) => a.trait_type === "Burnticker receipt mark")!.value, "off");
    const pf = fs.readFileSync("src/app/burnticker/launch/ProfileFields.tsx", "utf8"), pg = fs.readFileSync("src/app/burnticker/launch/page.tsx", "utf8");
    assert.match(pf, /badge: true, description/, "on by default"); assert.match(pf, /data-preview="badged"/); assert.match(pf, /data-preview="plain"/);
    assert.match(pf, /data-badge-toggle checked=\{value\.badge\}/); assert.match(pf, /<p data-badge-note>\{BADGE_NOTE\}<\/p>/);
    assert.match(pf, /out\.imageBadge = v\.badge;/); assert.match(pg, /profileBody\(profile\)/); assert.match(pg, /profileBadge: profile\.badge/, "the choice is kept with the saved draft");
  });
});
