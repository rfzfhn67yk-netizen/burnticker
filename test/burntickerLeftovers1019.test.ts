// 2026-10-19 leftovers batch: LA6-4 (kept mint key), LA-3 (draft ticker hold bound), copy-lint "moon", the other-http burst floor note,
// tier 9 off the new-coin list and the compiled mainnet lookup table, HB-26 (rule text named in public words), the ownerAction
// cross-origin code, and the HB-46 residues (incident links, current-status deployed/source, whitepaper keys, one sunset date).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import { grindMint, groundMintProblem, base58, base58Decode, type GroundMint } from "@/lib/burnticker/vanityMint";
import { dropsKeptMint, keptMintKey, keptMintText, KEPT_MINT_MAX_AGE_MS, PREPARED_MINT_STORE, withKeptMint } from "@/lib/burnticker/keptMintKey";
import { lookalikeRows, tickerHoldStatus } from "@/lib/burnticker/launchGuards";
import { lookalikeHits } from "@/lib/burnticker/lookalike";
import { DRAFT_TTL_MS } from "@/lib/burnticker/registry";
import { formatHits, lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import { burstCapOf, MIN_SHARED_BURST } from "@/lib/burnticker/apiBudget";
import { CPMM_MAINNET_TIER_9, CPMM_MAINNET_TIER_14, CPMM_PLATFORM_TIERS, KNOWN_TIERS, cpmmTierOf, newCoinTierAccepted, postGraduationBps, tierForPin } from "@/lib/burnticker/cpmmTier";
import { platformTierRow } from "@/lib/burnticker/fees";
import { LOOKUP_TABLES, lookupTablePin } from "@/lib/burnticker/networks";
import { DEFICIT_RULES_WORDS, deficitPrelaunch, CURRENT_STATUS_FILE } from "@/lib/burnticker/deficitPrelaunch";
import { PUBLIC_REPO_URL, repoUrl } from "@/lib/burnticker/currentStatusLinks";
import { markdownLinkParts, resolveRepoLink, PUBLISHED_RECORD } from "@/lib/burnticker/publicPaths";
import { INCIDENTS_COPY } from "@/lib/burnticker/historyCopy";

const read = (f: string) => fs.readFileSync(f, "utf8");
const cfg = loadCopyLintConfig();
const clean = (t: string) => { const r = lintCopy(t, cfg); assert.ok(r.ok, `${formatHits(r)}\n${t}`); };

function seeded(seed: number) {
  let x = seed >>> 0 || 1;
  return (n: number) => { const out = new Uint8Array(n); for (let i = 0; i < n; i++) { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; out[i] = x & 0xff; } return out; };
}
/** A real key ending in "b" (quick to find); the kept-key check is given the same suffix rule the server applies to "burn". */
const key: GroundMint = grindMint({ suffix: "b", batch: 200_000, rng: seeded(7) }).found!;
const check = (mint: string, secret: string): GroundMint => {
  const k = { publicKey: mint, secretKey: base58Decode(secret) };
  const p = groundMintProblem(k, ["b"]);
  if (p) throw new Error(p);
  return k;
};

describe("LA6-4: the prepared mint key is kept in the tab for its wallet and ticker", () => {
  const W = "Wallet1111111111111111111111111111111111111", T0 = 1_760_000_000_000;
  const text = keptMintText({ creator: W, ticker: "fire", mint: key.publicKey, secret: base58(key.secretKey) }, T0, check)!;
  test("kept, read back for the same wallet and ticker inside the age limit; refused otherwise", () => {
    assert.ok(text);
    assert.equal(keptMintKey(text, { creator: W, ticker: "FIRE" }, T0 + 60_000, KEPT_MINT_MAX_AGE_MS, check)?.publicKey, key.publicKey);
    assert.equal(keptMintKey(text, { creator: "Other111111111111111111111111111111111111111", ticker: "FIRE" }, T0, KEPT_MINT_MAX_AGE_MS, check), null, "another wallet");
    assert.equal(keptMintKey(text, { creator: W, ticker: "FIRES" }, T0, KEPT_MINT_MAX_AGE_MS, check), null, "another ticker");
    assert.equal(keptMintKey(text, { creator: W, ticker: "FIRE" }, T0 + KEPT_MINT_MAX_AGE_MS, KEPT_MINT_MAX_AGE_MS, check), null, "past the age limit");
    assert.equal(keptMintKey(text, { creator: null, ticker: "FIRE" }, T0, KEPT_MINT_MAX_AGE_MS, check), null, "no wallet");
    assert.equal(keptMintKey("{not json", { creator: W, ticker: "FIRE" }, T0), null);
    assert.ok(KEPT_MINT_MAX_AGE_MS < DRAFT_TTL_MS, "a kept key never outlives its draft");
  });
  test("a key that does not check is never kept, and the server's own check refuses an address without burn", () => {
    assert.equal(keptMintText({ creator: W, ticker: "FIRE", mint: key.publicKey, secret: null }, T0, check), null);
    assert.equal(keptMintText({ creator: W, ticker: "FIRE", mint: key.publicKey, secret: base58(key.secretKey) }, T0), null, "default check: ends in b, not burn");
  });
  test("a press with a kept key sends it; without one the usual source runs; refusals drop it, busy and network keep it", async () => {
    assert.deepEqual(await withKeptMint(key, { pool: null, n: 1 }, async (k) => k?.[0].publicKey ?? null), key.publicKey);
    assert.equal(await withKeptMint(null, { pool: null, n: 1 }, async (k) => k), null, "the bank first");
    assert.equal(dropsKeptMint({ status: 409, code: "mint-taken" }), true);
    assert.equal(dropsKeptMint({ status: 429 }), false);
    assert.equal(dropsKeptMint({ status: 401 }), false);
    assert.equal(dropsKeptMint(new Error("Failed to fetch")), false);
  });
  test("the page keeps it after a single coin's prepare and clears it on launch, Start over and a refused press", () => {
    const pg = read("src/app/burnticker/launch/page.tsx");
    assert.match(pg, /const keptMint = !pairOn \? readKeptMint\(creator, sent\.a\) : null;/);
    assert.match(pg, /withKeptMint\(keptMint, \{ pool: mintPool/);
    assert.match(pg, /if \(!keptMint\) keepPreparedMint\(\{ creator, ticker: sent\.a, mint: one\.mint, secret: one\.mintSecretKey \}\);/);
    assert.match(pg, /const startOver = [^\n]*sessionStorage\.removeItem\(PREPARED_MINT_STORE\)/);
    assert.match(pg, /const dropDraft = [^\n]*sessionStorage\.removeItem\(PREPARED_MINT_STORE\)/);
    assert.match(pg, /if \(keptMint && dropsKeptMint\(e\)\) dropPreparedMint\(\);/);
    assert.equal(PREPARED_MINT_STORE, "burnticker.launch.mint.v1");
  });
});

describe("LA-3: an unsent draft holds its ticker only inside the draft lifetime", () => {
  const NOW = 1_760_000_000_000, A = "CreatorA11111111111111111111111111111111111", B = "CreatorB11111111111111111111111111111111111";
  const row = (createdAt: number, launchTx: string | null = null) => ({ ticker: "SQUAT", name: "Squat", creator: A, status: "draft" as const, createdAt, launchTx });
  const reg = (rows: ReturnType<typeof row>[]) => ({ tokens: () => rows, lockedRule: () => { throw new Error("no rule"); } }) as never;
  test("past DRAFT_TTL_MS with no create, the draft reads as expired even before a sweep; inside it, it still holds", () => {
    assert.equal(tickerHoldStatus(row(NOW - DRAFT_TTL_MS - 1), NOW), "expired");
    assert.equal(tickerHoldStatus(row(NOW - DRAFT_TTL_MS + 60_000), NOW), "draft");
    assert.equal(tickerHoldStatus(row(NOW - DRAFT_TTL_MS - 1, "sig"), NOW), "draft", "a draft whose create landed is the registry's to decide");
  });
  test("the review's draft-held notice never names a draft past the bound; inside it the creator's own draft is still theirs", () => {
    const old = lookalikeRows(reg([row(NOW - DRAFT_TTL_MS - 1)]), NOW);
    assert.deepEqual(lookalikeHits({ ticker: "SQUAT", name: "x", creator: null }, old, { draftNotice: true }), []);
    assert.deepEqual(lookalikeHits({ ticker: "SQUAT", name: "x", creator: B }, old), [], "another creator may take it");
    const fresh = lookalikeRows(reg([row(NOW - 60_000)]), NOW);
    assert.equal(lookalikeHits({ ticker: "SQUAT", name: "x", creator: null }, fresh, { draftNotice: true })[0]?.how, "draft-held");
    assert.equal(lookalikeHits({ ticker: "SQUAT", name: "x", creator: B }, fresh)[0]?.how, "same-letters");
    assert.deepEqual(lookalikeHits({ ticker: "SQUAT", name: "x", creator: A }, fresh), [], "the creator can finish their own draft");
  });
});

describe("copy lint: moon", () => {
  test("price talk with moon is caught as the word itself; ordinary moon is fine", () => {
    for (const t of ["it will moon", "gonna moon", "moon soon", "to the moon", "mooning"]) assert.ok(lintCopy(t, cfg).hits.some((h) => h.rule === "moon"), t);
    assert.deepEqual(lintCopy("moon soon", cfg).hits.filter((h) => h.rule === "moon").map((h) => h.phrase), ["moon"]);
    for (const t of ["the first moon landing", "Harvest Moon", "a full moon tonight"]) clean(t);
  });
  test("copyLint runs in the publish gate now", () => {
    if (fs.existsSync("scripts/ops/publish-and-deploy.sh")) assert.match(read("scripts/ops/publish-and-deploy.sh"), /test\/copyLint\.test\.ts"/);
  });
});

describe("API-BUDGETS: the other-http burst floor", () => {
  test("two tokens for a shared minute bucket above one read a minute, and the doc says why", () => {
    assert.equal(MIN_SHARED_BURST, 2);
    assert.equal(burstCapOf(1.8 / 60_000, 60_000, {}), 2);
    const d = read("docs/burnticker/API-BUDGETS.md");
    assert.match(d, /Burst floor of two on shared hosts/);
    assert.match(d, /MIN_SHARED_BURST/); assert.match(d, /coverage\/freshReading\.ts/); assert.match(d, /makes two reads/);
  });
});

describe("tier 9 off the new-coin list; the mainnet lookup table compiled in", () => {
  test("tier 9 is refused for a new coin and still described for a coin created on it", () => {
    assert.deepEqual(CPMM_PLATFORM_TIERS.mainnet.map((t) => t.index), [14]);
    assert.equal(newCoinTierAccepted("mainnet", CPMM_MAINNET_TIER_9.id), false);
    assert.equal(newCoinTierAccepted("mainnet", CPMM_MAINNET_TIER_14.id), true);
    assert.equal(platformTierRow(CPMM_MAINNET_TIER_9.id).matches, false);
    assert.ok(KNOWN_TIERS.includes(CPMM_MAINNET_TIER_9));
    assert.equal(cpmmTierOf(CPMM_MAINNET_TIER_9.id)?.index, 9);
    assert.equal(tierForPin("mainnet", CPMM_MAINNET_TIER_9.id).index, 9);
    assert.equal(postGraduationBps(tierForPin("mainnet", CPMM_MAINNET_TIER_9.id), 8_000).tradersPay, 100);
  });
  test("the mainnet default is the 22-entry table; the host pin is a fallback override", () => {
    assert.equal(LOOKUP_TABLES.mainnet.address, "9cyeckGPmGH9KF4gw3wgRhkz5qrad1vriGwe9ej2dNve");
    assert.equal(LOOKUP_TABLES.mainnet.authority, null);
    assert.equal(lookupTablePin("mainnet", { BURNTICKER_CLUSTER: "mainnet" }).address, "9cyeckGPmGH9KF4gw3wgRhkz5qrad1vriGwe9ej2dNve", "no env pin: the compiled default");
    assert.equal(lookupTablePin("mainnet", {}).address, "9cyeckGPmGH9KF4gw3wgRhkz5qrad1vriGwe9ej2dNve", "a devnet host serves the compiled mainnet value");
  });
});

describe("HB-26: a rule text is named in public words, bound by its sha256", () => {
  test("the $DEFICIT page data carries words and a pinned public link, never the repository path", () => {
    if (!fs.existsSync(CURRENT_STATUS_FILE)) return;
    let d: ReturnType<typeof deficitPrelaunch>;
    try { d = deficitPrelaunch(); } catch { return; }   // the evidence files are monorepo-private on some trees
    assert.equal(d.rulesWords, DEFICIT_RULES_WORDS);
    assert.ok(d.rulesUrl.startsWith(`${PUBLIC_REPO_URL}/blob/`));
    const st = JSON.parse(read(CURRENT_STATUS_FILE)) as { deficit: { rulesFile: string } };
    assert.equal(d.rulesUrl, repoUrl(st.deficit.rulesFile));
    assert.equal(d.rulesSha256, crypto.createHash("sha256").update(read(st.deficit.rulesFile)).digest("hex"));
    assert.equal("rulesFile" in d, false);
    assert.doesNotMatch(JSON.stringify({ ...d, rulesUrl: null }), /config\/burnkeeper/);
    clean(DEFICIT_RULES_WORDS);
  });
  test("the page shows the words and the hash, not the file path", () => {
    const pg = read("src/app/burnticker/t/[ticker]/DeficitPrelaunch.tsx");
    assert.doesNotMatch(pg, /Rule file \{d\.rulesFile\}/);
    assert.match(pg, /href=\{d\.rulesUrl\}/);
    clean("Its sha256 is abc. That hash, not the file name, is what ties the coin to this exact text.");
  });
});

describe("ownerAction: cross-origin code and the csp-report exemption are in the tree", () => {
  test("both refusals carry code cross-origin; the CSRF table leaves out csp-report only", (t) => {
    // ownerAction.ts and its test are monorepo-private (the owner's action routes); the public tree has neither, so this check runs only where they exist
    if (!fs.existsSync("src/lib/ownerAction.ts") || !fs.existsSync("test/ownerAction.test.ts")) { t.skip("monorepo-only files"); return; }
    assert.match(read("src/lib/ownerAction.ts"), /code: "cross-origin"/);
    assert.match(read("src/app/api/burnticker/rpc/route.ts"), /code: "cross-origin"/);
    assert.match(read("test/ownerAction.test.ts"), /csp-report\$\{path\.sep\}/);
  });
});

describe("HB-46 residues", () => {
  test("an incident's relative link opens the public repository; its words stay plain", () => {
    assert.equal(resolveRepoLink("docs/burnticker/incidents", "../INCIDENTS.md"), "docs/burnticker/INCIDENTS.md");
    assert.equal(resolveRepoLink("docs", "../../x.md"), null);
    const parts = markdownLinkParts("Postmortem: due under the 48-hour rule in [../INCIDENTS.md](../INCIDENTS.md).", { base: "docs/burnticker/incidents" });
    const link = parts.find((p) => p.href);
    assert.equal(link?.href, repoUrl("docs/burnticker/INCIDENTS.md"));
    assert.equal(link?.text, PUBLISHED_RECORD);
    assert.doesNotMatch(parts.map((p) => p.text).join(""), /\.\.\/|INCIDENTS\.md|\[/);
    const pg = read("src/app/burnticker/incidents/page.tsx");
    assert.match(pg, /\{ base: "docs\/burnticker\/incidents" \}/);
    assert.doesNotMatch(pg, /<RepoText text=\{c\.source\} \/>/);
    clean(INCIDENTS_COPY.sourceLink);
  });
  test("current-status names mainnet for the round 4 and 5 findings and serves no path; whitepaper keys; one sunset date", () => {
    const cs = JSON.parse(read("config/burnticker/current-status.json")) as { reviews: { findings: { deployed: string }[] }[] };
    for (const r of cs.reviews) for (const f of r.findings) assert.match(f.deployed, /^mainnet/, f.deployed);
    assert.match(read("src/app/api/burnticker/v1/current-status/route.ts"), /withoutRepoPaths\(/);
    assert.match(read("docs/burnticker/WHITEPAPER.md"), /The mainnet keys are set/);
    assert.doesNotMatch(read("site/burnticker/whitepaper.html"), /every public key is a placeholder/);
  });
});
