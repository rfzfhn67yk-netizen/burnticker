// WEBSITE-18 (the owner's walkthrough, 2026-10-12): (A) the create flow is the first thing on the launch page, with the examples and
// what creators get in one closed disclosure at the bottom; (B) the Team path asks league, team, Review, Launch, and its review card says
// the defaults in one sentence each with everything else under one closed "Advanced"; the image control stays on the card for one coin
// and for each coin of a pair, and says so when this site takes no custom images; a pair carries a profile per coin, pinned per coin.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { prepareLaunch } from "@/lib/burnticker/api/handlers";
import type { FakePinUploader } from "@/lib/burnticker/pin";
import { buildLaunchReview } from "@/lib/burnticker/launchReview";
import { ADVANCED_LABEL, ADVANCED_NOTE, CUSTOM_IMAGES_OFF_LINE, teamAdvancedDefaults } from "@/lib/burnticker/creatorCopy";
import { EXAMPLES_AND_BENEFITS_LABEL } from "@/lib/burnticker/exampleTickets";
import { ON_END_DEFAULT } from "@/lib/burnticker/dials";
import { DEFAULT_ON_END } from "@/lib/burnticker/rules";
import { describeRule } from "@/lib/burnticker/describe";
import { firstPartyRule } from "@/lib/burnticker/wizard";
import { teamSeries } from "@/lib/burnticker/sources/espn";
import { formatHits, lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import { CREATOR_LAUNCHES_FLAG } from "@/lib/burnticker/creatorLaunches";
import { CREATOR, makeWorld } from "./burntickerApiHelpers.ts";
import { BRONCOS } from "./burntickerHelpers.ts";

const read = (f: string) => fs.readFileSync(f, "utf8");
const page = read("src/app/burnticker/launch/page.tsx"), card = read("src/app/burnticker/launch/ReviewCard.tsx"), fields = read("src/app/burnticker/launch/ProfileFields.tsx"), cvc = read("src/app/burnticker/launch/CoinVsCoinTile.tsx");
const cfg = loadCopyLintConfig();
const clean = (t: string) => { const r = lintCopy(t, cfg); assert.ok(r.ok, `${t}\n${formatHits(r)}`); };

describe("A: the create flow first; examples and benefits at the bottom, closed", () => {
  test("the first wizard control comes before the disclosure, which is closed and holds both lists; the templates page keeps them as they are", () => {
    const search = page.indexOf('data-free-text'), disc = page.indexOf("data-examples-benefits");
    assert.ok(search > 0 && disc > search, "the search box comes first");
    assert.ok(page.indexOf("<CreatorBenefitsList />") > disc && page.indexOf("<ExampleTickets site=") > disc, "both inside the disclosure");
    assert.match(page, /<p className="z-30 sm:sticky [^"]*"[^>]*data-preview-banner>/, "the preview banner sticks from the sm width up only (at 390 it covered the links)");
    const sum = card.indexOf("data-summary"), launch = card.indexOf('data-decision="launch"');
    assert.ok(sum > 0 && sum < launch, "the card's sentences sit above the Launch button");
    assert.ok(page.indexOf("<CreatorOnboarding />") > disc, "the onboarding block too: measured at 390 by 844 it pushed the search box off the first screen");
    assert.match(page, /<details className="[^"]*" data-examples-benefits>\s*<summary[^>]*>\{EXAMPLES_AND_BENEFITS_LABEL\}<\/summary>/, "closed by default (no open attribute)");
    assert.equal((page.match(/<CreatorBenefitsList \/>/g) ?? []).length, 1); assert.equal((page.match(/<ExampleTickets /g) ?? []).length, 1);
    const tpl = read("src/app/burnticker/templates/page.tsx");
    assert.match(tpl, /<CreatorBenefitsList \/>/); assert.match(tpl, /<ExampleTickets site=\{site\} \/>/); assert.doesNotMatch(tpl, /data-examples-benefits/);
    clean(EXAMPLES_AND_BENEFITS_LABEL);
  });
});

describe("B: the Team path", () => {
  test("league, team, Review, Launch: three steps, and the team rule carries the end clause every launch gets", () => {
    assert.match(page, /team: \["team", "review", "launch"\]/);
    assert.match(page, /if \(flow === "team"\) return team\?\.series \? \{ ...firstPartyRule\([^)]*, 0\.02\), onEnd: \{ \.\.\.ON_END_DEFAULT \} \}/);
    assert.deepEqual(ON_END_DEFAULT, DEFAULT_ON_END);
  });
  test("the review card's sentence: the burn on every win through the postseason, then each end in one sentence", () => {
    const r = { ...firstPartyRule(teamSeries("mlb", "LAD", "win", { kind: "season", year: 2026 }), 0.02), onEnd: { ...ON_END_DEFAULT } } as never;
    const t = describeRule(r, { ticker: "DODGERS26" });
    // the page builds the card's sentence this way (teamPath)
    // website-19 (intent audit item 7): the whole lead sentence (describe.ts leadSentence), never a split on ". "
    assert.match(page, /teamPath \? `\$\{text\.lead\} \$\{text\.windowSentence\.replace\(\/\^This coin covers \[\^\.\]\*\\\.\\s\*\/, ""\)\}`/);
    const sentence = `${t.lead} ${t.windowSentence.replace(/^This coin covers [^.]*\.\s*/, "")}`;
    assert.equal(sentence, "This coin burns 2% of its pool every game the Dodgers win, through the last game of the 2026 postseason. If the Dodgers win the championship, the rest of the pool burns here. If they do not, the rest goes to $DEFICIT's burn.");
  });
  test("everything else sits under one closed Advanced disclosure that lists the defaults; the image stays above it", () => {
    assert.match(card, /<details className="[^"]*" data-advanced>\s*<summary[^>]*>\{ADVANCED_LABEL\}<\/summary>/);
    const wrap = card.indexOf("<AdvancedWrap advanced"), img = card.lastIndexOf("{p.image}", wrap), prof = card.indexOf("{p.profile}", wrap), share = card.indexOf("aria-label={p.budget?.label ?? BUDGET_LABEL}"), inv = card.indexOf("data-inverse"), raise = card.indexOf("data-raise>"), note = card.indexOf("{noteField}", wrap), end = card.indexOf("</AdvancedWrap>");
    assert.ok(img > 0 && img < wrap, "the image control is above Advanced");
    for (const [k, i] of Object.entries({ prof, share, inv, raise, note })) assert.ok(i > wrap && i < end, `${k} is inside Advanced`);
    assert.match(page, /advanced=\{teamPath \? \{ defaults: teamAdvancedDefaults\(/);
    const d = teamAdvancedDefaults({ sharePct: "2%", raiseSol: "85", minForwardSol: "0.05" });
    assert.equal(d.length, 5); for (const s of [...d, ADVANCED_LABEL, ADVANCED_NOTE, CUSTOM_IMAGES_OFF_LINE]) clean(s);
    assert.ok(d.every((s) => !/\bwill\b/i.test(s)));
  });
});

describe("the image control: one coin, each coin of a pair, and a host without custom images", () => {
  test("the control renders for a single coin and for both coins of a Matchup and of Coin vs Coin, above Advanced", () => {
    assert.match(page, /image=\{two \? <div [^>]*data-pair-images>\{imageField\(profile, setProfile, [^)]*\)\}\{imageField\(profileB, setProfileB, [^)]*\)\}<\/div> : imageField\(profile, setProfile, null\)\}/);
    assert.match(cvc, /image=\{<div [^>]*data-pair-images>(?:\{imagesDropped[^\n]*?<\/p>\})?<ProfileFields value=\{profA\}[^>]*part="image"[^>]*\/><ProfileFields value=\{profB\}[^>]*part="image"[^>]*\/><\/div>\}/);
    assert.doesNotMatch(page, /profile=\{pairOn \? null/, "a pair no longer loses its profile fields");
  });
  test("custom images off on this host: the generated art and one sentence, never an empty space", () => {
    assert.match(fields, /\{showImage && !customImages && \(\s*<div [^>]*data-custom-images-off>\s*<div className="bt-profile-square[^"]*"[^>]*><span>Receipt art<\/span><\/div>\s*<p[^>]*>\{CUSTOM_IMAGES_OFF_LINE\}<\/p>/);
    assert.match(page, /customImages=\{customImages\}/); assert.match(page, /<CoinVsCoinTile [^>]*customImages=\{customImages\}/);
    assert.equal(CUSTOM_IMAGES_OFF_LINE, "Custom images are off on this site, so the coin uses its generated receipt art.");
  });
  test("a pair review carries two profiles, and side B's description is checked like side A's", () => {
    const env = { BURNTICKER_CLUSTER: "devnet", [CREATOR_LAUNCHES_FLAG]: "1" };
    const RULE = { ...BRONCOS, binary: { onYes: null, onNo: { fractionOfPool: 0.02 } }, pair: null };
    const r = buildLaunchReview({ rule: RULE, ticker: "BRONCOS", name: "Broncos", creatorDescription: "Orange and blue.", companion: { ticker: "CHIEFS", name: "Chiefs", creatorDescription: "Red and gold." } } as never, { env });
    assert.ok("review" in r);
    assert.deepEqual(r.review.coins.map((c) => c.profile.description), ["Orange and blue.", "Red and gold."]);
    const bad = buildLaunchReview({ rule: RULE, ticker: "BRONCOS", name: "Broncos", pair: { ticker: "CHIEFS", name: "Chiefs", creatorDescription: "x".repeat(281) } } as never, { env });
    assert.ok("review" in bad); assert.ok(bad.review.problems.some((p) => /^Coin B\. The description can be at most 280/.test(p)));
  });
  test("a registered pair pins two metadata files, each with its own uploaded image and the creator's text", async () => {
    const w = await makeWorld(); w.p.customImages = true;
    const up = w.p.uploader as FakePinUploader;
    const png = (c: string) => import("sharp").then(async (s) => new Uint8Array(await s.default({ create: { width: 64, height: 64, channels: 3, background: c } }).png().toBuffer()));
    const [a, b] = [await png("#ff6600"), await png("#cc0000")];
    const RULE = { ...BRONCOS, binary: { onYes: null, onNo: { fractionOfPool: 0.02 } }, pair: null };
    const body = { creator: CREATOR, ticker: "MILEHI", name: "Mile High", rule: RULE, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true },
      image: { contentType: "image/png", base64: Buffer.from(a).toString("base64") }, imageRights: true, imageBadge: false, creatorDescription: "Orange and blue.",
      pair: { ticker: "ARROWHD", name: "Arrowhead", description: "", imageUrl: null, links: [], image: { contentType: "image/png", base64: Buffer.from(b).toString("base64") }, imageRights: true, imageBadge: false, creatorDescription: "Red and gold." } };
    const r = await prepareLaunch(w.p, body, { register: true }) as { pair?: { tokens: { a: { mint: string; imageUrl: string | null }; b: { mint: string; imageUrl: string | null } } }; error?: unknown };
    assert.ok(r.pair, JSON.stringify(r).slice(0, 400));
    for (const [t, bytes, text] of [[r.pair!.tokens.a, a, "Orange and blue."], [r.pair!.tokens.b, b, "Red and gold."]] as const) {
      const meta = w.registry.tokenMeta(t.mint)!;
      assert.deepEqual([...up.get(meta.imageTx!)!], [...bytes], "each coin pins its own upload (badge off: the plain bytes)");
      assert.equal(t.imageUrl, meta.imageUri, "the card shows the pinned copy");
      const json = JSON.parse(new TextDecoder().decode(up.get(meta.metadataTx!)!)) as { description: string };
      assert.ok(json.description.includes(`\n\n${text}`), "the creator's text follows the generated paragraph");
    }
    const noRights = await prepareLaunch(w.p, { ...body, ticker: "ROCKY", name: "Rocky", pair: { ...body.pair, ticker: "PLAINS", name: "Plains", imageRights: false } }, { register: false }) as { error: { body: { error: string; code: string } } };
    assert.equal(noRights.error.body.code, "image-rights"); assert.match(noRights.error.body.error, /^Side B: /);
    w.p.customImages = false;
    const off = await prepareLaunch(w.p, { ...body, ticker: "SUMMIT", name: "Summit", pair: { ...body.pair, ticker: "PRAIRIE", name: "Prairie" }, image: undefined }, { register: false }) as { error: { body: { code: string } } };
    assert.equal(off.error.body.code, "custom-image-off");
  });
});
