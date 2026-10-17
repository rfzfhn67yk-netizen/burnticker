// BURNTICKER rivalry pairs (2026-10-09 night): side B derived from side A (binary swap / scalar flip), both hashed on their own with
// the pairId in each canonical rule, un-invertible sides refused, tier-1 only; two bundles in sequence with B naming A's mint; the
// registry's append-only pairs table; a Broncos pair through the multi-keeper on the real KXNFLGAME fixture — each settlement burns
// exactly one side and the tally is the scoreboard; the versus header, the pair tally and the index card.
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { invertMapping, lockRule, pairIdFor, validateRule, ruleStatement } from "@/lib/burnticker/rules";
import { unitStep } from "@/lib/burnticker/units";
import { openRegistry, readingMatches, type Registry } from "@/lib/burnticker/registry";
import { FakeBurnProgram } from "@/lib/burnticker/program";
import { buildPairBundles, FakeLaunchLab } from "@/lib/burnticker/launchBundle";
import { KalshiClient, fixtureFetch, settledMarketsUrl, seriesApiUrl, openMarketsUrl, impliedChanceFrom, parseMarketsBody } from "@/lib/burnticker/oracle/kalshi";
import { CatalogueAdapter } from "@/lib/burnticker/catalogue";
import { runCycle, type KeeperDeps } from "@/lib/burnticker/multiKeeper";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildPlatformIndex, buildReceiptsJson, buildTokenStatus, pairCounterpartFrom, pairTally, publishPlatformIndex, renderPairHtml, renderPlatformIndexHtml, renderTokenHtml, type PairCounterpart, type TokenPageInput } from "@/lib/burnticker/tokenPage";
import { pairDailyText, pairShareLine } from "@/lib/launch/dailyPost";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import { BRONCOS, SPX, DENVER_HIGH, NOW, fx } from "./burntickerHelpers.ts";

const CREATOR = "CreatorWa11et111111111111111111111111111111", ATTESTER = "KeeperDataKey1111111111111111111111111111111";
const MINT_A = "So11111111111111111111111111111111111111112";
/** $BRONCOS burns when Denver LOSES: side A has onNo only; side B (inverted) burns when Denver wins. */
const BRONCOS_LOSE = { ...BRONCOS, binary: { onYes: null, onNo: { fractionOfPool: 0.02 } }, pair: { pairId: "broncos-vs-chiefs-kxnflgame-den", side: "A", counterpartMint: null } };

describe("pair rules", () => {
  test("invertMapping: binary swaps onYes/onNo, scalar flips direction; pairId in both canonical rules; two independent hashes", () => {
    const a = lockRule(BRONCOS_LOSE);
    const b = lockRule(invertMapping(a.rule, MINT_A));
    assert.deepEqual(b.rule.binary, { onYes: { fractionOfPool: 0.02 }, onNo: null });
    assert.deepEqual(b.rule.pair, { pairId: "broncos-vs-chiefs-kxnflgame-den", side: "B", counterpartMint: MINT_A });
    assert.notEqual(a.sha256, b.sha256);
    assert.match(a.text, /"pairId": "broncos-vs-chiefs-kxnflgame-den"/); assert.match(b.text, /"pairId": "broncos-vs-chiefs-kxnflgame-den"/);
    assert.equal(lockRule(BRONCOS_LOSE).sha256, a.sha256, "deterministic");
    const sA = validateRule({ ...SPX, pair: { pairId: "bulls-vs-bears-kxinx", side: "A", counterpartMint: null } });
    assert.equal(invertMapping(sA, MINT_A).scalar!.direction, "down");
    assert.match(ruleStatement(a.rule), /Rivalry pair broncos-vs-chiefs-kxnflgame-den, side A/);
    assert.match(ruleStatement(a.rule), /A YES settlement .* burns nothing/);
  });
  test("refused: both outcomes on one side, abs scalars, side B without a counterpart, non-kalshi sources, bad ids", () => {
    assert.throws(() => validateRule({ ...BRONCOS, pair: { pairId: "x-vs-y-abcd", side: "A", counterpartMint: null }, binary: { onYes: { fractionOfPool: 0.02 }, onNo: { fractionOfPool: 0.02 } } }), /exactly one outcome/);
    assert.throws(() => invertMapping(validateRule({ ...SPX, scalar: { ...SPX.scalar, direction: "abs" } }), MINT_A, "bulls-vs-bears-kxinx"), /abs cannot be inverted/);
    assert.throws(() => validateRule({ ...BRONCOS_LOSE, pair: { ...BRONCOS_LOSE.pair, side: "B" } }), /side B must name side A's mint/);
    assert.throws(() => validateRule({ ...DENVER_HIGH, oracle: "catalogue", series: "treasury.debt", pair: { pairId: "a-vs-b-xxxx", side: "A", counterpartMint: null } }), /tier-1 adjudicated market/);
    assert.throws(() => validateRule({ ...BRONCOS_LOSE, pair: { ...BRONCOS_LOSE.pair, pairId: "Bad Id" } }), /pairId/);
    assert.throws(() => validateRule({ ...BRONCOS, binary: { onYes: null, onNo: null } }), /at least one of onYes, onNo/);
    assert.equal(pairIdFor("BRONCOS", "CHIEFS", "KXNFLGAME:-DEN"), "broncos-vs-chiefs-kxnflgame-den");
  });
  test("the engine: side A burns on NO, side B on YES — exactly one side per settlement; the implied chance follows the side", () => {
    const a = lockRule(BRONCOS_LOSE).rule, b = invertMapping(a, MINT_A);
    const ev = (result: "yes" | "no") => ({ id: "M", at: "2026-10-04T23:41:27Z", result, value: null, title: null, sourceUrl: "" });
    assert.equal(unitStep(a, ev("no"), null).units, 1); assert.equal(unitStep(b, ev("no"), null).units, 0);
    assert.equal(unitStep(a, ev("yes"), null).units, 0); assert.equal(unitStep(b, ev("yes"), null).units, 1);
    const open = parseMarketsBody(fx("kalshi/KXNFLGAME.settled.json")).markets.slice(0, 1).map((m) => ({ ...m, ticker: "KXNFLGAME-26OCT12DENNYJ-DEN", seriesTicker: "KXNFLGAME", status: "active", result: "" as const, closeTime: "2026-10-13T03:00:00Z", yesBid: 0.4, yesAsk: 0.44 }));
    assert.ok(Math.abs(impliedChanceFrom(a, open, null).chance! - 0.58) < 1e-9, "side A burns on NO: 1 − 0.42");
    assert.ok(Math.abs(impliedChanceFrom(b, open, null).chance! - 0.42) < 1e-9);
  });
});

describe("pair bundles and the registry", () => {
  test("buildPairBundles: A first, B derived with A's mint as counterpart, different mints/tickers, same selector, both hashed", async () => {
    const program = new FakeBurnProgram("devnet");
    const inputA = { creator: CREATOR, ticker: "BRONCOS", name: "Broncos", description: "burns when Denver loses", imageUrl: null, links: [], rule: { ...BRONCOS_LOSE, pair: null }, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true }, cluster: "devnet" as const };
    const pr = await buildPairBundles({ a: inputA, b: { ticker: "CHIEFS", name: "Chiefs", description: "burns when Denver wins", imageUrl: null, links: [] }, voidBy: "2026-11-09" }, { program, launchLab: new FakeLaunchLab(), devFeeWallet: null, attesters: [ATTESTER], quorum: 1, metadataUri: (m) => `https://x/${m}.json` });
    assert.equal(pr.pairId, "broncos-vs-chiefs-kxnflgame-den");
    assert.notEqual(pr.a.mint, pr.b.mint); assert.notEqual(pr.a.rules.sha256, pr.b.rules.sha256);
    const rb = JSON.parse(pr.b.rules.text); assert.deepEqual(rb.pair, { pairId: pr.pairId, side: "B", counterpartMint: pr.a.mint, clause: "both-or-neither", voidBy: "2026-11-09", winnerTakesBurn: true }); assert.deepEqual(rb.binary, { onYes: { fractionOfPool: 0.02 }, onNo: null }); assert.deepEqual(rb.onEnd, { windDownDays: 28, sweepThresholdLamports: 50_000_000, endSink: true });
    const ra = JSON.parse(pr.a.rules.text); assert.deepEqual(ra.pair, { pairId: pr.pairId, side: "A", counterpartMint: null, clause: "both-or-neither", voidBy: "2026-11-09", winnerTakesBurn: true });
    assert.equal(program.initialised.length, 2);
    await assert.rejects(buildPairBundles({ a: inputA, b: { ticker: "BRONCOS", name: "x", description: "", imageUrl: null, links: [] } }, { program, launchLab: new FakeLaunchLab(), devFeeWallet: null, attesters: [], quorum: 1, metadataUri: () => "u" }), /different tickers/);
    await assert.rejects(buildPairBundles({ a: { ...inputA, rule: { ...DENVER_HIGH, oracle: "catalogue", series: "treasury.debt", scalar: { unit: 1e9, perUnit: { fractionOfPool: 0.05 }, baseline: "previousSettlement", direction: "up" } } }, b: { ticker: "X", name: "x", description: "", imageUrl: null, links: [] } }, { program, launchLab: new FakeLaunchLab(), devFeeWallet: null, attesters: [], quorum: 1, metadataUri: () => "u" }), /tier-1/);
  });
  test("registerPair checks both rules and the shared selector; the pairs table is append-only", async () => {
    const reg = openRegistry(":memory:"), program = new FakeBurnProgram("devnet");
    const inputA = { creator: CREATOR, ticker: "BRONCOS", name: "Broncos", description: "", imageUrl: null, links: [], rule: { ...BRONCOS_LOSE, pair: null }, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true }, cluster: "devnet" as const };
    const pr = await buildPairBundles({ a: inputA, b: { ticker: "CHIEFS", name: "Chiefs", description: "", imageUrl: null, links: [] } }, { program, launchLab: new FakeLaunchLab(), devFeeWallet: null, attesters: [], quorum: 1, metadataUri: (m) => `https://x/${m}.json` });
    const reg1 = (b: typeof pr.a, ticker: string) => reg.register({ mint: b.mint, ticker, name: b.name, creator: CREATOR, description: b.description, imageUrl: null, links: [], rulesText: b.rules.text, feePda: b.addresses.feePda, vault: null, tokenConfig: null, poolId: null, launchTx: null, cluster: "devnet", platformId: null, baselineAt: "2026-09-01T00:00:00Z", status: "draft" });
    reg1(pr.a, "BRONCOS");
    assert.throws(() => reg.registerPair(pr.pairId, pr.a.mint, pr.b.mint), /both tokens must be registered/);
    reg1(pr.b, "CHIEFS");
    const row = reg.registerPair(pr.pairId, pr.a.mint, pr.b.mint);
    assert.equal(row.selectorKey, "kalshi:KXNFLGAME:binary");
    assert.equal(reg.pairOf(pr.b.mint)!.mintA, pr.a.mint);
    assert.throws(() => reg.registerPair(pr.pairId, pr.b.mint, pr.a.mint), /not side A/);
    assert.throws(() => reg.db.prepare("DELETE FROM pairs").run(), /append-only/);
    assert.throws(() => reg.db.prepare("UPDATE pairs SET mint_b=? WHERE pair_id=?").run("x", pr.pairId), /append-only/);
  });
});

describe("a Broncos pair through the keeper", () => {
  let reg: Registry, program: FakeBurnProgram, deps: KeeperDeps, clock: number;
  const table = { [settledMarketsUrl("KXNFLGAME")]: fx("kalshi/KXNFLGAME.settled.json"), [seriesApiUrl("KXNFLGAME")]: fx("kalshi/series.KXNFLGAME.json"), [openMarketsUrl("KXNFLGAME")]: { cursor: "", markets: [] } };
  beforeEach(() => { reg = openRegistry(":memory:"); program = new FakeBurnProgram("devnet"); clock = NOW; deps = { registry: reg, program, oracles: { kalshi: new KalshiClient({ fetchImpl: fixtureFetch(table), now: () => clock, minIntervalMs: 0 }), catalogue: new CatalogueAdapter() }, attester: ATTESTER, log: () => {}, now: () => clock, dryRun: false }; });
  async function launchPair() {
    const inputA = { creator: CREATOR, ticker: "BRONCOS", name: "Broncos", description: "", imageUrl: null, links: [], rule: { ...BRONCOS_LOSE, pair: null }, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true }, cluster: "devnet" as const };
    const pr = await buildPairBundles({ a: inputA, b: { ticker: "CHIEFS", name: "Chiefs", description: "", imageUrl: null, links: [] } }, { program, launchLab: new FakeLaunchLab(), devFeeWallet: null, attesters: [ATTESTER], quorum: 1, metadataUri: (m) => `https://x/${m}.json` });
    for (const [b, ticker] of [[pr.a, "BRONCOS"], [pr.b, "CHIEFS"]] as const) {
      reg.register({ mint: b.mint, ticker, name: b.name, creator: CREATOR, description: b.description, imageUrl: null, links: [], rulesText: b.rules.text, feePda: b.addresses.feePda, vault: null, tokenConfig: null, poolId: null, launchTx: null, cluster: "devnet", platformId: null, baselineAt: "2026-09-01T00:00:00Z", status: "draft" }, clock);
      reg.markLaunched(b.mint, `launch${ticker}`, null, "2026-09-01T00:00:00Z");
      program.deposit(b.mint, BigInt(5_000_000_000)); program.supplies.set(b.mint, BigInt("1000000000000000"));
    }
    reg.registerPair(pr.pairId, pr.a.mint, pr.b.mint);
    return { a: reg.token(pr.a.mint)!, b: reg.token(pr.b.mint)!, pairId: pr.pairId };
  }
  async function page(t: ReturnType<Registry["token"]> & object, pair: PairCounterpart): Promise<TokenPageInput> {
    const locked = reg.lockedRule(t);
    return { token: t, locked, readings: reg.readings(t.selectorKey, t.baselineAt).filter((r) => readingMatches(locked.rule, r)), receipts: reg.receipts(t.mint), attesters: reg.attesters(t.mint), state: reg.state(t.mint), feedState: reg.feedState(t.selectorKey), chain: { cluster: "devnet", programId: program.programId, supplyRaw: await program.supplyRaw(t.mint), feePdaLamports: await program.feePdaBalanceLamports(t.mint), vaultRaw: null }, now: clock, nextCheckAt: null, implied: null, seriesTitle: "NFL game winner", selectorPending: 0, operator: { can: [], cannot: [], placeholder: true }, pair };
  }
  test("each settlement burns exactly one side; the tally is 1 : 1 over the two Denver games; the versus header, pair page data and index card agree", async () => {
    const { a, b, pairId } = await launchPair();
    const r = await runCycle(deps);
    assert.equal(r.fetched.length, 1, "one shared selector key, fetched once");
    const ra = reg.receipts(a.mint), rb = reg.receipts(b.mint);
    assert.equal(ra.length, 2); assert.equal(rb.length, 2);
    for (const ev of ra.map((x) => x.eventId)) {
      const sa = ra.find((x) => x.eventId === ev)!, sb = rb.find((x) => x.eventId === ev)!;
      assert.equal((sa.status === "confirmed" ? 1 : 0) + (sb.status === "confirmed" ? 1 : 0), 1, `${ev}: exactly one side burned`);
    }
    assert.equal(ra.find((x) => x.eventId === "KXNFLGAME-26OCT04DENSF-DEN")!.status, "confirmed", "Denver lost to SF: $BRONCOS burned");
    assert.equal(rb.find((x) => x.eventId === "KXNFLGAME-26SEP27LARDEN-DEN")!.status, "confirmed", "Denver beat LAR: $CHIEFS burned");
    const cp = (t: typeof a, other: typeof a, side: "A" | "B"): PairCounterpart => ({ pairId, side, counterpart: { ticker: other.ticker, name: other.name, mint: other.mint, burns: reg.receipts(other.mint).filter((x) => x.status === "confirmed").length, burned: "0", supply: "0", lastBurnAt: null } });
    const ia = await page(a, cp(a, b, "A")), ib = await page(b, cp(b, a, "B"));
    const recA = buildReceiptsJson(ia), recB = buildReceiptsJson(ib);
    const sa = buildTokenStatus(ia, recA), sb = buildTokenStatus(ib, recB);
    assert.equal(sa.pair!.tally.burnsThis, 1); assert.equal(sa.pair!.tally.burnsOther, 1); assert.equal(sa.pair!.pageUrl, `/burnticker/p/${pairId}`);
    const tally = pairTally(sa, sb, recA, recB);
    assert.equal(tally.burnsA + tally.burnsB, tally.settlements - tally.voids, "burns sum to the non-void settlements");
    assert.equal(tally.lastSettlement!.eventId, "KXNFLGAME-26OCT04DENSF-DEN"); assert.equal(tally.lastSettlement!.burnedSide, "A");
    const html = renderTokenHtml(sa, recA, ia.readings);
    assert.match(html, /\$BRONCOS <span class="muted">vs<\/span> <a href="\.\.\/CHIEFS\/">\$CHIEFS<\/a>/);
    assert.match(html, /Burns 1 : 1/);
    const ix = buildPlatformIndex([sa, sb], clock);
    assert.equal(ix.pairs.length, 1); assert.equal(ix.totals.pairs, 1); assert.equal(ix.pairs[0].a.ticker, "BRONCOS"); assert.equal(ix.pairs[0].b.ticker, "CHIEFS");
    assert.ok(ix.tokens.every((t) => t.pairId === pairId));
    const ixHtml = renderPlatformIndexHtml(ix);
    assert.match(ixHtml, /Rivalry pairs/); assert.match(ixHtml, /href="p\/broncos-vs-chiefs-kxnflgame-den\/"/);
    assert.doesNotMatch(ixHtml, /<td><a href="t\/BRONCOS\/">/, "a pair is one card, not two table rows");
    for (const r2 of [...recA, ...recB]) assert.equal(r2.verify.verified, true, `${r2.eventId}: ${r2.verify.checks.join("; ")}`);
  });
  test("the scoreboard: last settlement with its result, supply left, the next market; the static pair page, the share line and the keeper's counterpart", async () => {
    const { a, b, pairId } = await launchPair();
    await runCycle(deps);
    // The keeper's counterpart (registry + supply reader) is what the app's server builds.
    const cpA = await pairCounterpartFrom(reg, (m) => program.supplyRaw(m), a), cpB = await pairCounterpartFrom(reg, (m) => program.supplyRaw(m), b);
    assert.equal(cpA!.side, "A"); assert.equal(cpA!.counterpart.ticker, "CHIEFS"); assert.equal(cpB!.side, "B"); assert.equal(cpB!.counterpart.burns, 1);
    assert.equal(cpA!.counterpart.lastBurnAt!.slice(0, 10), "2026-09-28", "Denver beat LAR (settled 09-28 UTC): $CHIEFS burned");
    assert.equal(await pairCounterpartFrom(reg, async () => null, { mint: "NotAPairMint1111111111111111111111111111111" }), null);
    const ia = await page(a, cpA!), ib = await page(b, cpB!);
    const recA = buildReceiptsJson(ia), recB = buildReceiptsJson(ib);
    const sa = buildTokenStatus({ ...ia, implied: { chance: 0.58, marketTicker: "KXNFLGAME-26OCT12DENNYJ-DEN", closeTime: "2026-10-13T03:00:00Z", basis: "mid" } }, recA);
    const sb = buildTokenStatus({ ...ib, implied: { chance: 0.42, marketTicker: "KXNFLGAME-26OCT12DENNYJ-DEN", closeTime: "2026-10-13T03:00:00Z", basis: "mid" } }, recB);
    const t = pairTally(sa, sb, recA, recB);
    assert.deepEqual({ ...t.lastSettlement!, burned: undefined }, { eventId: "KXNFLGAME-26OCT04DENSF-DEN", settledAt: t.lastSettlement!.settledAt, burnedSide: "A", result: "no", value: null, burned: undefined });
    assert.ok(Number(t.lastSettlement!.burned) > 0);
    assert.ok(t.supplyPctA < 100 && t.supplyPctB < 100 && Math.abs(t.supplyPctA - (100 - sa.burned.pctOfSupply)) < 1e-9);
    assert.deepEqual(t.next, { market: "KXNFLGAME-26OCT12DENNYJ-DEN", closeTime: "2026-10-13T03:00:00Z", chanceA: null, chanceB: null }, "no odds for any coin (owner decision 2026-10-10): the oracle's chance is not carried");
    // The share line and the pair post: a report, lint-clean.
    assert.equal(pairShareLine(t), "$BRONCOS 1 : 1 $CHIEFS — every loss burns");
    const post = pairDailyText(t, "https://burnticker.com");
    const lines = post.split("\n");
    assert.equal(lines[0], "$BRONCOS 1 : 1 $CHIEFS — every loss burns");
    assert.equal(lines.splice(1, 1)[0], "Pair live: both pools registered, every settlement burns one side");
    assert.match(lines[1], /^Supply [\d,]+ : [\d,]+ \(\d+\.\d\d% : \d+\.\d\d% of the start\)$/);
    assert.equal(lines[2], "2 settlements · one market, inverted rules");
    assert.match(lines[3], /^Last: KXNFLGAME-26OCT04DENSF-DEN settled NO → \$BRONCOS burned [\d,]+$/);
    assert.equal(lines[4], "Next market: KXNFLGAME-26OCT12DENNYJ-DEN (closes 2026-10-13 03:00Z)");
    assert.equal(lines[5], `Scoreboard: https://burnticker.com/p/${pairId}/`);
    assert.deepEqual(lintCopy(post, loadCopyLintConfig()).hits.map((h) => `${h.phrase}:${h.rule}`), []);
    // The static pair page: scoreboard header, both receipts tables stacked, both rules.
    const html = renderPairHtml(t, sa, sb, recA, recB);
    assert.match(html, /<div class="score">\$BRONCOS 1 <span class="muted">:<\/span> 1 \$CHIEFS<\/div>/);
    assert.match(html, /Last settlement[\s\S]*KXNFLGAME-26OCT04DENSF-DEN[\s\S]*settled NO/);
    assert.doesNotMatch(html, /implied|58%|42%/, "no odds on the pair page"); assert.match(html, /closes 2026-10-13T03:00:00Z/);
    assert.ok(html.indexOf("<h2>Receipts — $BRONCOS</h2>") < html.indexOf("<h2>Receipts — $CHIEFS</h2>"), "A's table above B's");
    assert.match(html, /Scoreboard: this page/); assert.doesNotMatch(html, /\{SITE_URL\}/);
    assert.match(html, /href="\.\.\/\.\.\/t\/BRONCOS\/rules\.json"/);
    // review follow-up 3: a side whose ticker is shared links by its own site directory (its mint), never another coin's ticker page
    const keyed = renderPairHtml(t, sa, sb, recA, recB, null, new Map([[sa.mint, [sa.mint]], [sb.mint, ["CHIEFS"]]]));
    assert.match(keyed, new RegExp(`href="\\.\\./\\.\\./t/${sa.mint}/"`)); assert.match(keyed, new RegExp(`href="\\.\\./\\.\\./t/${sa.mint}/rules\\.json"`));
    assert.doesNotMatch(keyed, /href="\.\.\/\.\.\/t\/BRONCOS\//);
    assert.match(keyed, /href="\.\.\/\.\.\/t\/CHIEFS\/"/);
    // publishPlatformIndex writes the pair page the index cards link to.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bt-pair-"));
    try {
      publishPlatformIndex(dir, [sa, sb], clock, null, { BRONCOS: recA, CHIEFS: recB });
      assert.ok(fs.existsSync(path.join(dir, "p", pairId, "index.html")));
      const pj = JSON.parse(fs.readFileSync(path.join(dir, "p", pairId, "pair.json"), "utf8"));
      assert.equal(pj.schema, "burnticker.pair/v1"); assert.equal(pj.tally.burnsA, 1); assert.equal(pj.tally.lastSettlement.result, "no");
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
