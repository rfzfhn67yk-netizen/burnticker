// THE DESCRIPTION IS GENERATED AND LOCKED; THE METADATA IS PINNED (owner decisions 2026-10-10). Through the launch pipeline: a draft
// whose name / ticker / note claims an affiliation (or carries a link) is refused with the category named; a custom image is off by
// default; the registry's description is the generated text whatever the request sent; the metadata JSON pinned on Arweave (a fake
// Irys) carries it byte for byte; the token page carries the standing line, the creator's note in its own box and the pin; a failed
// upload refuses the launch unless hosted metadata is allowed; the post-creation gate reads is_mutable / authorities / the URI.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import { prepareLaunch } from "@/lib/burnticker/api/handlers";
import { FakePinUploader, metadataJson, sha256Hex } from "@/lib/burnticker/pin";
import { metadataDescription, registeredDescription, generatedParagraph } from "@/lib/burnticker/coinText";
import { badgeFromText, describeRule } from "@/lib/burnticker/describe";
import { descriptionFooter, lockRule, DEFAULT_ON_END } from "@/lib/burnticker/rules";
import { tokenPageData } from "@/lib/burnticker/server";
import { AFFILIATION_LINE, renderTokenHtml } from "@/lib/burnticker/tokenPage";
import { verifyPinnedMetadata } from "@/lib/burnticker/verify";
import { decodeMetadataAccount, launchGate } from "@/lib/burnticker/launchGate";
import { launchDayText, tokenDayText, withTag, DISCLAIMER } from "@/lib/launch/dailyPost";
import { nativeRule } from "@/lib/burnticker/sources/native";
import { teamSeries } from "@/lib/burnticker/sources/espn";
import { CREATOR, makeWorld } from "./burntickerApiHelpers.ts";
import { DEBT_RULE } from "./burntickerHelpers.ts";

const RAYS = nativeRule(teamSeries("mlb", "TB", "win", { kind: "season", year: 2026 }), { fractionOfPool: 0.02 });
const body = (o: Record<string, unknown> = {}) => ({ creator: CREATOR, ticker: "RAYS26", name: "Rays 2026 Wins", description: "ignored — the description is generated", rule: RAYS, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true }, ...o });
type Err = { error: { status: number; body: { error: string; code?: string; categories?: string[] } } };

describe("the creator's text is linted; the image is the receipt art", () => {
  test("a name, ticker or note that claims an affiliation, or carries a link, is refused with the category named", async () => {
    const w = await makeWorld();
    for (const [o, field] of [[{ name: "Official Rays Coin" }, "name"], [{ ticker: "OFFICIAL" }, "ticker"], [{ note: "partnered with the Rays" }, "note"], [{ note: "see https://x.com/rays" }, "note"], [{ note: "the price will moon" }, "note"]] as const) {
      const r = await prepareLaunch(w.p, body({ ticker: `T${Math.random().toString(36).slice(2, 7).toUpperCase()}`, ...o }), { register: false }) as Err;
      assert.ok("error" in r, JSON.stringify(o));
      assert.equal(r.error.status, 403); assert.equal(r.error.body.code, "copy-lint");
      assert.match(r.error.body.error, new RegExp(`The ${field} cannot `));   // sources-7 round 2: one plain sentence per field
      if (field !== "note" || !/price/.test(JSON.stringify(o))) assert.deepEqual(r.error.body.categories, ["no-affiliation"]);
    }
    assert.ok(!("error" in await prepareLaunch(w.p, body({ name: "Rays Win", ticker: "RAYSWIN" }), { register: false })), "\"Rays Win\" is allowed");
    const long = await prepareLaunch(w.p, body({ note: "x".repeat(141) }), { register: false }) as Err;
    assert.equal(long.error.status, 400);
  });

  test("a custom image is refused unless BURNTICKER_CUSTOM_IMAGES_ENABLED", async () => {
    const w = await makeWorld();
    const r = await prepareLaunch(w.p, body({ imageUrl: "https://example.org/x.png" }), { register: false }) as Err;
    assert.equal(r.error.status, 400); assert.equal(r.error.body.code, "custom-image-off");
    w.p.customImages = true;
    // website-15 item 13: an image of the creator's own carries the rights line they confirm
    assert.equal((await prepareLaunch(w.p, body({ imageUrl: "https://example.org/x.png" }), { register: false }) as Err).error.body.code, "image-rights");
    assert.ok(!("error" in await prepareLaunch(w.p, body({ imageUrl: "https://example.org/x.png", imageRights: true }), { register: false })));
  });
});

describe("generated, locked, pinned", () => {
  test("the registry description is the generated text; the pinned metadata carries it byte for byte; the token page shows the standing line, the note and the pin", async () => {
    const w = await makeWorld();
    const up = w.p.uploader as FakePinUploader;
    const mint = Keypair.generate().publicKey.toBase58();
    const r = await prepareLaunch(w.p, body({ note: "go Rays" }), { register: true, mint });
    assert.ok("ok" in r, JSON.stringify(r).slice(0, 300));
    const t = w.registry.token(mint)!;
    const locked = lockRule({ ...RAYS, onEnd: DEFAULT_ON_END });
    const paragraph = describeRule(locked.rule, { ticker: "RAYS26" }).paragraph;
    assert.equal(t.description, `${paragraph} ${descriptionFooter(locked)}`, "never the request's text");
    assert.equal(t.description, registeredDescription(locked, generatedParagraph(locked.rule, "RAYS26", {})));
    const meta = w.registry.tokenMeta(mint)!;
    assert.equal(meta.creatorNote, "go Rays"); assert.equal(meta.hosted, false);
    assert.match(meta.metadataUri!, /^https:\/\/arweave\.net\/[0-9a-f]{43}$/); assert.match(meta.imageUri!, /^https:\/\/arweave\.net\//);
    const pinnedBytes = up.get(meta.metadataTx!)!;
    assert.equal(sha256Hex(pinnedBytes), meta.metadataSha256);
    const pinned = JSON.parse(new TextDecoder().decode(pinnedBytes)) as { description: string; image: string; symbol: string };
    assert.equal(pinned.description, metadataDescription(locked, t.description), "byte for byte");
    assert.equal(pinned.description, `${badgeFromText(locked.rule, t.description)}\n${t.description}`);
    assert.ok(pinned.description.startsWith("2026 SEASON\n$RAYS26 burns when the Rays win."));
    assert.equal(pinned.image, meta.imageUri); assert.equal(pinned.symbol, "RAYS26");
    const png = up.get(meta.imageTx!)!; assert.deepEqual([...png.slice(0, 4)], [0x89, 0x50, 0x4e, 0x47]); assert.equal(sha256Hex(png), meta.imageSha256);
    // the bundle's token URI is the arweave URL
    assert.equal(JSON.stringify(r.ok.bundle).includes(meta.metadataUri!), true);
    // the token page
    const page = await tokenPageData(w.p, t, Date.now());
    assert.equal(page.status.profile.affiliation, AFFILIATION_LINE);
    assert.equal(page.status.profile.note, "go Rays");
    assert.equal(page.status.profile.description, paragraph, "the coin page header shows the generated paragraph");
    assert.equal(page.status.pinned!.expectedDescription, pinned.description);
    const html = renderTokenHtml(page.status, page.receipts, page.readings);
    assert.ok(html.includes(AFFILIATION_LINE)); assert.ok(html.includes("Creator's note (not part of the rule):")); assert.ok(html.includes(meta.metadataUri!));
    // the verifier (coin page and trust page)
    const fetchPin = async (u: string) => ({ ok: true, status: 200, arrayBuffer: async () => { const b = up.get(u.split("/").pop()!)!; return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; } });
    assert.equal((await verifyPinnedMetadata(page.status.pinned, fetchPin)).ok, true);
    assert.equal((await verifyPinnedMetadata({ ...page.status.pinned!, expectedDescription: "tampered" }, fetchPin)).ok, false);
    assert.equal((await verifyPinnedMetadata({ ...page.status.pinned!, metadataSha256: "0".repeat(64) }, fetchPin)).ok, false);
    // the hosted reference JSON serves the same bytes
    assert.equal(metadataJson({ ticker: t.ticker, name: t.name, description: metadataDescription(locked, t.description), oneLiner: "", rule: locked.rule, rulesSha256: t.rulesSha, origin: "https://burnticker.com", links: t.links }, meta.imageUri!), new TextDecoder().decode(pinnedBytes));
  });

  test("a failed upload refuses the launch; only BURNTICKER_ALLOW_HOSTED_METADATA falls back to hosted (and says so)", async () => {
    const w = await makeWorld();
    w.p.uploader = new FakePinUploader({ fail: true });
    const r = await prepareLaunch(w.p, body({ ticker: "RAYSX" }), { register: true, mint: Keypair.generate().publicKey.toBase58() }) as Err;
    assert.equal(r.error.status, 502); assert.equal(r.error.body.code, "pin-failed");
    w.p.uploader = null;
    assert.equal((await prepareLaunch(w.p, body({ ticker: "RAYSY" }), { register: true, mint: Keypair.generate().publicKey.toBase58() }) as Err).error.body.code, "pin-failed", "no uploader configured: refused");
    w.p.allowHostedMetadata = true;
    const mint = Keypair.generate().publicKey.toBase58();
    const ok = await prepareLaunch(w.p, body({ ticker: "RAYSZ" }), { register: true, mint });
    assert.ok("ok" in ok); assert.equal(w.registry.tokenMeta(mint)!.hosted, true);
  });

  test("a preview bundle (register: false) pins nothing", async () => {
    const w = await makeWorld();
    const up = w.p.uploader as FakePinUploader;
    const r = await prepareLaunch(w.p, body({ rule: DEBT_RULE, ticker: "DEBTX", name: "Debt Clock" }), { register: false });
    assert.ok("ok" in r); assert.equal(up.uploads.length, 0);
    assert.ok(JSON.stringify(r.ok.bundle).includes("ar://pending-upload-at-launch"));
  });
});

describe("the post-creation launch gate and the post footers", () => {
  const meta = (o: { isMutable: boolean; uri: string }) => {
    const enc = (s: string, pad: number) => { const b = Buffer.alloc(4 + pad); b.writeUInt32LE(pad, 0); Buffer.from(s).copy(b, 4); return b; };
    return new Uint8Array(Buffer.concat([Buffer.from([4]), Buffer.alloc(64), enc("Rays 2026 Wins", 32), enc("RAYS26", 10), enc(o.uri, 200), Buffer.from([0, 0]), Buffer.from([0]), Buffer.from([0]), Buffer.from([o.isMutable ? 1 : 0])]));
  };
  test("is_mutable false, mint and freeze authority null, the URI on Arweave — anything else fails the gate", () => {
    const good = decodeMetadataAccount(meta({ isMutable: false, uri: "https://arweave.net/" + "a".repeat(43) }));
    assert.deepEqual([good.name, good.symbol, good.isMutable], ["Rays 2026 Wins", "RAYS26", false]);
    assert.equal(launchGate({ metadata: good, mintAuthority: null, freezeAuthority: null }).ok, true);
    assert.equal(launchGate({ metadata: { ...good, isMutable: true }, mintAuthority: null, freezeAuthority: null }).ok, false);
    assert.equal(launchGate({ metadata: good, mintAuthority: CREATOR, freezeAuthority: null }).ok, false);
    assert.equal(launchGate({ metadata: good, mintAuthority: null, freezeAuthority: CREATOR }).ok, false);
    const hosted = decodeMetadataAccount(meta({ isMutable: false, uri: "https://burnticker.com/deficit-devnet.json" }));
    assert.equal(launchGate({ metadata: hosted, mintAuthority: null, freezeAuthority: null }).ok, false);
    assert.equal(launchGate({ metadata: hosted, mintAuthority: null, freezeAuthority: null, allowHosted: true }).ok, true);
  });

  test("the first post and every token post carry the window tag in their footer line", () => {
    assert.equal(withTag(DISCLAIMER, "2026 SEASON"), `${DISCLAIMER} · 2026 SEASON`);
    const first = launchDayText({ ticker: "RAYS26", profile: { description: "$RAYS26 — burns when the Rays win.", badge: "2026 SEASON" } })!;
    assert.ok(first.endsWith(`${DISCLAIMER} · 2026 SEASON`));
    const status = { ticker: "RAYS26", seriesTitle: "Rays", selectorKey: "k", supply: { current: "1000000000" }, next: { nextCheckAt: null }, profile: { description: "", badge: "2026 SEASON", oneLiner: "", links: [], imageUrl: null } } as never;
    assert.ok(tokenDayText(status, [], "2026-10-10").endsWith("· 2026 SEASON"));
  });
});
