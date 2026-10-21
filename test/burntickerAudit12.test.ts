// AUDIT 12 (2026-10-13, publish 31 walkthrough): the P1 rule-truth items on LINKED pairs, library side.
//   1  a linked one-shot pair (two candidates, one game, one market, the flippening) offers and accepts 100 % only; single one-shots keep
//      100 / 50 %, recurring pairs keep their row; drafts carrying another share migrate with a notice
//   2  one canonical preparation path: the review's rules and fingerprints are the bundle's, pairing metadata included (review == build)
//   3  the one-game option and the search card say the form that is built (linked, the winner takes the burn)
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildLaunchReview, type LaunchReview } from "@/lib/burnticker/launchReview";
import { buildPairBundles, FakeLaunchLab, preparedRulesCheck, preparePairRules, pairVoidByOffline, defaultVoidBy } from "@/lib/burnticker/launchBundle";
import { FakeBurnProgram } from "@/lib/burnticker/program";
import { LINKED_ONE_SHOT_REFUSAL, ONE_SHOT_SHARE_REFUSAL } from "@/lib/burnticker/linkedShare";
import { LINKED_ONE_SHOT_LINE, SHARE_PRESETS, presetProblem, presetRowLabel, sharePresetsForRule } from "@/lib/burnticker/launchPresets";
import { dialsFor } from "@/lib/burnticker/dials";
import { migrateLinkedShare } from "@/lib/burnticker/launchDraft";
import { candidatesPairRule, gamePairRule, meetingsPairRules, patternWords } from "@/lib/burnticker/guidedLaunch";
import { gameCardCopy, pairFormCopy } from "@/lib/burnticker/pairForms";
import { settingsLine, TEMPLATES } from "@/lib/burnticker/templates";
import { firstPartyRule } from "@/lib/burnticker/wizard";
import { gameSeries } from "@/lib/burnticker/sources/espn";
import { canonicalJson, lockRule, withFullFraction, type BurnRule } from "@/lib/burnticker/rules";
import { setNativeClients } from "@/lib/burnticker/sources/native";
import { ATTESTER, CREATOR } from "./burntickerApiHelpers.ts";
import { BUCS_CID, EAGLES_CID, PM_BUCS } from "./burntickerPolyHelpers.ts";
import { ESPN_NOW, espnFixtureClient } from "./burntickerFirstPartyHelpers.ts";
import { coinvsRule, WIF, BONK } from "./burntickerDerbyHelpers.ts";

const ENV = { BURNTICKER_CLUSTER: "devnet", BURNTICKER_CREATOR_LAUNCHES_ENABLED: "1" } as Record<string, string>;
const RACE = "michigan-senate-election-winner";
const deps = () => ({ program: new FakeBurnProgram("devnet"), launchLab: new FakeLaunchLab(), devFeeWallet: null, attesters: [ATTESTER], quorum: 1, metadataUri: (m: string) => `https://x/${m}.json` });
const input = (rule: unknown, ticker: string) => ({ creator: CREATOR, ticker, name: `${ticker} coin`, description: "", imageUrl: null, links: [], rule, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true }, cluster: "devnet" as const });
const review = (body: Record<string, unknown>, o: Parameters<typeof buildLaunchReview>[1] = {}): LaunchReview => {
  const r = buildLaunchReview(body as never, { env: ENV, ...o });
  assert.ok("review" in r, "problems" in r ? r.problems.join(" | ") : "");
  return r.review;
};
const flipSpec = { selector: "coinvs" as const, a: WIF, b: BONK, window: "daily" as const, measure: "mcap" as const, season: { start: "2026-10-20", days: 30 }, flip: true };
async function firstGame(): Promise<{ eventId: string; a: string; b: string }> {
  setNativeClients({ espn: espnFixtureClient() });
  const g = (await espnFixtureClient().upcoming("mlb", 8)).find((x) => x.away.abbr !== "TBD" && x.home.abbr !== "TBD")!;
  return { eventId: g.eventId, a: g.away.abbr, b: g.home.abbr };
}

describe("audit 12 item 1: a linked one-shot pair is 100 % only", () => {
  test("the preset rows: linked one-shot [1]; a single one-shot keeps 100 / 50; a recurring pair keeps its row", async () => {
    const g = await firstGame();
    const game = gamePairRule("mlb", g.eventId, g.a);
    assert.deepEqual(sharePresetsForRule(game, { linked: true }), [1]);
    assert.deepEqual(sharePresetsForRule(game), SHARE_PRESETS.oneShot);
    assert.deepEqual(sharePresetsForRule(candidatesPairRule(EAGLES_CID), { linked: true }), [1]);
    assert.deepEqual(sharePresetsForRule(coinvsRule(flipSpec, 1), { linked: true }), [1]);
    const meetings = meetingsPairRules("mlb", "LAD", "SD", 2026).a;
    assert.deepEqual(sharePresetsForRule(meetings, { linked: true }), SHARE_PRESETS.recurring);
    assert.equal(presetRowLabel("linkedOneShot"), "100%");
    const d = dialsFor(game, { linked: true });
    assert.deepEqual([d.bounds.min, d.bounds.max, d.linkedOneShot], [1, 1, true]);
    assert.equal(dialsFor(game).linkedOneShot, false);
    assert.equal(presetProblem(candidatesPairRule(EAGLES_CID, 0.5), { linked: true }), LINKED_ONE_SHOT_REFUSAL);
    // review 10 F1: a single candidate coin may burn 50 % only on a host with burn dispersal
    assert.equal(presetProblem(candidatesPairRule(EAGLES_CID, 0.5)), ONE_SHOT_SHARE_REFUSAL);
    assert.equal(presetProblem(candidatesPairRule(EAGLES_CID, 0.5), { dispersal: true }), null, "a single candidate coin may burn 50 % with dispersal");
  });

  test("the review refuses 50 % on every linked one-shot shape with the plain sentence, once; a single one-shot at 50 % is fine", async () => {
    const g = await firstGame();
    const shapes: [string, Record<string, unknown>][] = [
      ["candidates", { rule: candidatesPairRule(EAGLES_CID, 0.5), ticker: "CANDA", name: "Candidate A", pair: { ticker: "CANDB", name: "Candidate B", market: BUCS_CID, race: RACE } }],
      ["game", { rule: gamePairRule("mlb", g.eventId, g.a, 0.5), ticker: "GAMEA", name: "Game A", pair: { ticker: "GAMEB", name: "Game B", opp: g.b } }],
      ["market", { rule: PM_BUCS, ticker: "BUCSY", name: "Bucs Yes", pair: { ticker: "BUCSN", name: "Bucs No" } }],
      ["flippening", { rule: coinvsRule(flipSpec, 0.5), ticker: "WIFFLIP", name: "Wif flip", pair: { ticker: "BONKFLIP", name: "Bonk flip" } }],
    ];
    for (const [label, body] of shapes) {
      const r = review(body, { now: ESPN_NOW });
      assert.equal(r.problems.filter((x) => x === LINKED_ONE_SHOT_REFUSAL).length, 1, `${label}: ${r.problems.join(" | ")}`);
      assert.equal(r.signable, false);
      assert.equal(r.rule.presets, LINKED_ONE_SHOT_LINE, label);
    }
    const single = review({ rule: candidatesPairRule(EAGLES_CID, 0.5), ticker: "CANDA", name: "Candidate A" }, { now: ESPN_NOW });
    assert.ok(!single.problems.includes(LINKED_ONE_SHOT_REFUSAL));
    assert.equal(single.rule.share, "50%");
  });

  test("the builder refuses 50 % on a linked one-shot pair (never rewrites it to 100 %), and builds 100 %", async () => {
    await assert.rejects(buildPairBundles({ a: input(PM_BUCS, "BUCSY"), b: { ticker: "BUCSN", name: "No side", description: "", imageUrl: null, links: [] } }, deps()), (e: Error) => e.message === LINKED_ONE_SHOT_REFUSAL);
    const ok = await buildPairBundles({ a: input(withFullFraction(PM_BUCS as BurnRule), "BUCSY"), b: { ticker: "BUCSN", name: "No side", description: "", imageUrl: null, links: [] } }, deps());
    assert.equal(JSON.parse(ok.a.rules.text).binary.onYes.fractionOfPool, 1);
  });

  test("a saved draft with 50 % on a linked pair resumes at 100 % with a notice; other drafts are untouched", async () => {
    const g = await firstGame();
    const a = gamePairRule("mlb", g.eventId, g.a, 0.5), b = gamePairRule("mlb", g.eventId, g.b, 0.5);
    const m = migrateLinkedShare({ flow: "pair", pairMode: "game", fraction: 0.5, draft: { key: "k", a, b } });
    assert.match(m.notice ?? "", /had 50% on a linked pair[\s\S]*100%/);
    assert.equal(m.draft.fraction, 1);
    const d = m.draft.draft as { a: BurnRule; b: BurnRule };
    assert.deepEqual([d.a.binary?.onYes ?? d.a.scalar?.perUnit, d.b.binary?.onYes ?? d.b.scalar?.perUnit].map((x) => (x as { fractionOfPool: number }).fractionOfPool), [1, 1]);
    const single = { flow: "single", pairMode: "game", fraction: 0.5 };
    assert.deepEqual(migrateLinkedShare(single), { draft: single, notice: null });
    const season = { flow: "pair", pairMode: "season", fraction: 0.02 };
    assert.deepEqual(migrateLinkedShare(season), { draft: season, notice: null });
    const fine = { flow: "pair", elPick: { race: {} }, fraction: 1 };
    assert.equal(migrateLinkedShare(fine).notice, null);
  });

  test("templates and examples: no linked pair offers 50 %", () => {
    for (const t of TEMPLATES.filter((x) => x.id === "election-pair" || x.id === "matchup" || x.id === "flippening")) {
      assert.doesNotMatch(settingsLine(t), /50%/, t.id);
      assert.match(settingsLine(t), /100%/, t.id);
    }
    assert.match(TEMPLATES.find((x) => x.id === "flippening")!.example, /takes \$ETHVSOL's pool/);
  });
});

describe("audit 12 item 2: one preparation path, review == build for every pair shape", () => {
  const eq = async (label: string, body: Record<string, unknown>, build: { rule: unknown; tickerA: string; tickerB: string; race?: { slug: string; marketB: string }; game?: { opp: string } }, o: { pairVoidBy?: string } = {}) => {
    const r = review(body, o);
    assert.deepEqual(r.problems, [], label);
    assert.equal(r.rules.length, 2, label);
    const built = await buildPairBundles({ a: input(build.rule, build.tickerA), b: { ticker: build.tickerB, name: "Side B", description: "", imageUrl: null, links: [] }, voidBy: r.prepared.voidBy ?? undefined, ...(build.race ? { race: build.race } : {}), ...(build.game ? { game: build.game } : {}) }, deps());
    assert.deepEqual(preparedRulesCheck(r.prepared, { a: { text: built.a.rules.text, sha256: built.a.rules.sha256, mint: built.a.mint }, b: { text: built.b.rules.text, sha256: built.b.rules.sha256 } }), [], label);
    // side A: the exact rule and the fingerprint shown are the signed ones, pairing metadata included, labelled final
    assert.equal(r.rule.text, built.a.rules.text, label);
    assert.equal(r.rule.sha256, built.a.rules.sha256, label);
    assert.deepEqual([r.rules[0].final, r.rules[0].label, r.rules[0].pending], [true, "final", []], label);
    const ra = JSON.parse(r.rule.text) as BurnRule;
    assert.ok(ra.pair && ra.pair.pairId && ra.pair.clause === "both-or-neither" && ra.pair.voidBy && (ra.pair as { winnerTakesBurn?: boolean }).winnerTakesBurn === true, label);
    // side B: everything but side A's mint, labelled draft with that one pending field
    assert.deepEqual([r.rules[1].final, r.rules[1].label, r.rules[1].pending], [false, "draft", ["pair.counterpartMint"]], label);
    assert.equal(r.prepared.label, "draft");
    const rb = JSON.parse(r.rules[1].text) as BurnRule, bb = JSON.parse(built.b.rules.text) as BurnRule;
    assert.equal(lockRule({ ...rb, pair: { ...rb.pair!, counterpartMint: built.a.mint } }).sha256, built.b.rules.sha256, label);
    assert.equal(bb.pair?.counterpartMint, built.a.mint);
    return { r, built };
  };

  test("two candidates (race, 100 %)", async () => {
    const { r } = await eq("candidates", { rule: candidatesPairRule(EAGLES_CID, 1), ticker: "CANDA", name: "Candidate A", pair: { ticker: "CANDB", name: "Candidate B", market: BUCS_CID, race: RACE } }, { rule: candidatesPairRule(EAGLES_CID, 1), tickerA: "CANDA", tickerB: "CANDB", race: { slug: RACE, marketB: BUCS_CID } });
    assert.ok(JSON.parse(r.rule.text).pair.race.markets.includes(BUCS_CID.toLowerCase()));
  });
  test("one game (game, 100 %)", async () => {
    const g = await firstGame();
    const rule = gamePairRule("mlb", g.eventId, g.a, 1);
    await eq("game", { rule, ticker: "GAMEA", name: "Game A", pair: { ticker: "GAMEB", name: "Game B", opp: g.b } }, { rule, tickerA: "GAMEA", tickerB: "GAMEB", game: { opp: g.b } });
  });
  test("one market (the market's end date passed in by the route; without it side A is a labelled draft)", async () => {
    const rule = withFullFraction(PM_BUCS as BurnRule);
    await eq("market", { rule, ticker: "BUCSY", name: "Bucs Yes", pair: { ticker: "BUCSN", name: "Bucs No" } }, { rule, tickerA: "BUCSY", tickerB: "BUCSN" }, { pairVoidBy: "2027-01-15" });
    const draft = review({ rule, ticker: "BUCSY", name: "Bucs Yes", pair: { ticker: "BUCSN", name: "Bucs No" } });
    assert.deepEqual([draft.rules[0].final, draft.rules[0].label, draft.rules[0].pending], [false, "draft", ["pair.voidBy"]]);
  });
  test("the flippening (void date from the run, 100 %)", async () => {
    const rule = coinvsRule(flipSpec, 1);
    const { r } = await eq("flippening", { rule, ticker: "WIFFLIP", name: "Wif flip", pair: { ticker: "BONKFLIP", name: "Bonk flip" } }, { rule, tickerA: "WIFFLIP", tickerB: "BONKFLIP" });
    assert.equal(r.prepared.voidBy, pairVoidByOffline(rule, { settled: false }));
  });
  test("every game between two teams (a recurring linked pair keeps its share)", async () => {
    const rules = meetingsPairRules("mlb", "LAD", "SD", 2026, 0.05);
    const { r } = await eq("meetings", { rule: rules.a, ticker: "LADVSD", name: "Dodgers v Padres", pair: { ticker: "SDVLAD", name: "Padres v Dodgers" } }, { rule: rules.a, tickerA: "LADVSD", tickerB: "SDVLAD" });
    assert.equal(r.rule.share, "5%");
  });

  test("preparedRulesCheck names a changed rule; the review's pairing is the builder's (preparePairRules)", () => {
    const p = preparePairRules({ a: { ticker: "CANDA", rule: candidatesPairRule(EAGLES_CID, 1) }, b: { ticker: "CANDB" }, race: { slug: RACE, marketB: BUCS_CID }, voidBy: defaultVoidBy(ESPN_NOW) });
    const a = lockRule(p.ruleA), b = lockRule(p.sideB("So11111111111111111111111111111111111111112"));
    const prepared = { sides: [{ side: "A" as const, text: a.text, sha256: a.sha256, final: true, pending: [] }, { side: "B" as const, text: canonicalJson(p.sideB(null)), sha256: "", final: false, pending: ["pair.counterpartMint"] }] };
    assert.deepEqual(preparedRulesCheck(prepared, { a: { ...a, mint: "So11111111111111111111111111111111111111112" }, b }), []);
    const other = lockRule({ ...p.ruleA, pair: { ...p.ruleA.pair!, voidBy: "2099-01-01" } });
    assert.match(preparedRulesCheck(prepared, { a: { ...other, mint: "So11111111111111111111111111111111111111112" }, b }).join(" "), /Coin A's rule changed after the review/);
  });
});

describe("audit 12 item 3: the one-game words follow what is built", () => {
  test("Their next game only says linked, the winner takes the burn, never 'no SOL moves'", () => {
    const w = patternWords("once", { follow: "rivalry", pairKind: "teams", rivalryScope: "season" });
    assert.match(w.label, /winner takes the burn/);
    assert.match(w.sentence, /winning team's coin burns its whole pool and takes the losing team's coin's pool/);
    assert.doesNotMatch(w.sentence, /no SOL moves/);
    const dated = patternWords("once", { follow: "rivalry", pairKind: "teams", rivalryScope: "season", gameLabel: "Sat, May 1, 2027" });
    assert.match(dated.label, /Their game on Sat, May 1, 2027 only, winner takes the burn/);
  });
  test("the search card for one game is the linked pair it opens", () => {
    const c = gameCardCopy("Guardians at Rays");
    assert.doesNotMatch(c.title, /losing team's coin burns/);
    assert.match(c.title, /linked[\s\S]*winning team's coin takes the burn/);
    assert.equal(pairFormCopy("game-linked").linked, true);
    assert.deepEqual(pairFormCopy("game-linked").shares, [1]);
    assert.match(pairFormCopy("game-independent-loss").sentence, /no SOL moves between them/);
  });
  test("a single game still offers its own one-shot shares (sources-6 form)", () => {
    const r = firstPartyRule(gameSeries("mlb", "401000001", "LAD", "loss"), 0.5);
    assert.deepEqual(sharePresetsForRule(r), [1], "review 10 F1: 100 % only without burn dispersal");
    assert.deepEqual(sharePresetsForRule(r, { dispersal: true }), [1, 0.5]);
  });
});

describe("audit 12 P2 and the coordinator's additions", () => {
  test("item 9: an explicit denial is not a claim (note and description share the check); a claim beside a denial is still caught", async () => {
    const { noteProblemOf } = await import("@/lib/burnticker/guidedLaunch");
    const { creatorTextProblems } = await import("@/lib/burnticker/coinText");
    assert.equal(noteProblemOf("Not affiliated with any team."), null);
    assert.deepEqual(creatorTextProblems({ name: "", ticker: "", note: "Not affiliated with any team.", description: "" }), []);
    assert.deepEqual(creatorTextProblems({ name: "", ticker: "", note: "", description: "A fan coin. Not affiliated with, or endorsed by, any team or league." }).filter((x) => x.category === "no-affiliation"), []);
    assert.match(noteProblemOf("Not affiliated with the league, but endorsed by the team.") ?? "", /affiliation or an endorsement/);
    assert.ok(creatorTextProblems({ name: "", ticker: "", note: "The official team coin." }).length > 0);
  });

  test("F2 / item 4: the before-graduation note follows the pinned end sink: linked pairs say each case, a named coin is named, $DEFICIT only where it applies", async () => {
    const { beforeGraduationLine, afterGraduationEnd } = await import("@/lib/burnticker/guidedLaunch");
    const g = await firstGame();
    const game = preparePairRules({ a: { ticker: "GAMEA", rule: gamePairRule("mlb", g.eventId, g.a) }, b: { ticker: "GAMEB" }, game: { opp: g.b } }).ruleA;
    assert.match(afterGraduationEnd(game), /losing team's coin's pool goes to the winning team's coin's burn[\s\S]*After a draw, both pools go to \$DEFICIT's burn[\s\S]*cancelled game moves nothing/);
    const cand = preparePairRules({ a: { ticker: "CANDA", rule: candidatesPairRule(EAGLES_CID) }, b: { ticker: "CANDB" }, race: { slug: RACE, marketB: BUCS_CID } }).ruleA;
    assert.match(afterGraduationEnd(cand), /If neither candidate wins, both pools go to \$DEFICIT's burn/);
    // the page holds side A before the bundle adds the pair field: `linked` names the shape
    assert.match(beforeGraduationLine("Oct 19", gamePairRule("mlb", g.eventId, g.a), "game"), /^This result is due around Oct 19\.[\s\S]*winning team's coin's burn/);
    const single = candidatesPairRule(EAGLES_CID, 0.5);
    assert.match(afterGraduationEnd(single), /^Then the rest of the pool goes to \$DEFICIT's burn\. A voided result moves nothing/);
    const named = { ...single, onEnd: { ...single.onEnd!, endSink: true as const, mint: "So11111111111111111111111111111111111111112", ticker: "OTHER" } } as BurnRule;
    assert.match(afterGraduationEnd(named), /goes to \$OTHER's burn, or if \$OTHER is not live then, to \$DEFICIT's burn/);
    assert.equal(beforeGraduationLine(null), "A coin burns only after it graduates. If the result comes first, it is recorded, and the burn waits until the coin graduates and its pool is registered. Then the rest of the pool goes to $DEFICIT's burn.");
    const r = review({ rule: candidatesPairRule(EAGLES_CID, 1), ticker: "CANDA", name: "Candidate A", pair: { ticker: "CANDB", name: "Candidate B", market: BUCS_CID, race: RACE } });
    assert.match(r.timing?.afterGraduation ?? "", /losing candidate's coin's pool/);
  });

  test("the not-champion end line names the pinned sink", async () => {
    const { notChampionEndLine, NOT_CHAMPION_END_LINE, notChampionEndReason } = await import("@/lib/burnticker/endSinkKeeper");
    assert.equal(notChampionEndLine(null), NOT_CHAMPION_END_LINE);
    assert.equal(notChampionEndLine({ onEnd: { endSink: true } }), NOT_CHAMPION_END_LINE);
    assert.match(notChampionEndLine({ onEnd: { endSink: true, mint: "M", ticker: "OTHER" } }), /goes to \$OTHER's burn, or to \$DEFICIT's burn if \$OTHER is not live then/);
    assert.doesNotMatch(notChampionEndLine({ onEnd: { endSink: "incinerator" } }), /\$DEFICIT/);
    assert.match(notChampionEndReason("the season is over", { onEnd: { endSink: true, mint: "M", ticker: "OTHER" } }), /\$OTHER[\s\S]*\(the season is over\)$/);
  });

  test("the daily race's season tally counts only for the season it tallies", async () => {
    const { derbyReadingInSeason } = await import("@/lib/burnticker/derby/season");
    const spec = { selector: "coinvs" as const, a: WIF, b: BONK, window: "daily" as const, measure: "pct" as const, season: { start: "2026-10-05", days: 7 }, flip: false };
    const rule = coinvsRule(spec), later = coinvsRule({ ...spec, season: { start: "2026-10-10", days: 7 } });
    const tally = { id: "tally-2026-10-12:0123456789abcdef", at: "2026-10-12T23:59:59Z" };
    assert.equal(derbyReadingInSeason(rule, tally), true);
    assert.equal(derbyReadingInSeason(later, tally), false, "a later season covering that day does not count it");
    assert.equal(derbyReadingInSeason(coinvsRule({ ...spec, measure: "mcap", flip: true }, 1), tally), false, "the flippening has no tally");
  });
});

describe("private review 9 F1: old ticker follows migrate only against the complete inventory", () => {
  const A = "So11111111111111111111111111111111111111112", B2 = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
  const legacy = { coins: [], results: [], legacy: { coins: [], results: ["LAD"] } };
  test("two $LAD coins, one retired (missing from the filtered rows): the follow stays unresolved and ambiguous; a missing inventory defers", async () => {
    const { resolveLegacy, resolveLegacyFrom, coinInventory } = await import("@/lib/burnticker/watchlist");
    // the bug: the filtered rows list one $LAD, so the old follow moved to it
    assert.equal(resolveLegacy(legacy, [{ ticker: "LAD", network: "mainnet", mint: A }]).changed, true);
    // the fix: the complete inventory (every status) has both
    const inv = coinInventory([{ ticker: "LAD", mint: A, cluster: "mainnet" }, { ticker: "LAD", mint: B2, cluster: "mainnet" }]);
    const r = resolveLegacyFrom(legacy, inv);
    assert.equal(r.changed, false);
    assert.deepEqual(r.list.legacy.results, ["LAD"]);
    assert.deepEqual(r.ambiguous.map((x) => [x.ticker, x.candidates.length]), [["LAD", 2]]);
    // not read, or failed: nothing migrates, nothing is lost
    assert.deepEqual(resolveLegacyFrom(legacy, null), { list: legacy, changed: false, ambiguous: [] });
    // recovering the missing row changes nothing: the follow is still the visitor's to settle
    assert.deepEqual(resolveLegacyFrom(legacy, inv).list, r.list);
  });
  test("fetchCoinInventory: a failed or incomplete read is null", async () => {
    const { fetchCoinInventory } = await import("@/lib/burnticker/watchlist");
    assert.equal(await fetchCoinInventory((async () => new Response("{}", { status: 503 })) as typeof fetch), null);
    assert.equal(await fetchCoinInventory((async () => new Response(JSON.stringify({ complete: false, coins: [] }))) as typeof fetch), null);
    const ok = await fetchCoinInventory((async () => new Response(JSON.stringify({ complete: true, coins: [{ ticker: "LAD", network: "mainnet", mint: A }] }))) as typeof fetch);
    assert.equal(ok?.coins.length, 1);
  });
  test("editorial: the checker labels its instruction list as the published source beside the deployed commit; the fee line names both venues", async () => {
    const { buildChecklist } = await import("@/lib/burnticker/trustpack/checklist");
    const c = buildChecklist();
    assert.match(c.moneySource, new RegExp(`^These ${c.money.length} instructions are the published source's \\(the programs' registers, round 5\\)`));
    // third prelaunch audit (2026-10-16): round 5 is deployed (burn_receipts, 2026-10-15), so the line no longer says its instructions are missing,
    // and it names each program's deployed round and commit (pair_curve stays on round 4)
    assert.doesNotMatch(c.moneySource, /not on the deployed programs/);
    assert.match(c.moneySource, /8 of them are new in round 5\. They belong to the burn program \(burn_receipts\), which runs round 5, so they are on the deployed program too\./);
    // B-17 (2026-10-21): the table's build is B-17 (116ff5ad), not deployed yet; the deployed burn program is still round 5 from 089024ff
    assert.match(c.moneySource, new RegExp(`the burn program \\(burn_receipts\\) at round 5, from commit 089024ff6a \\(a newer build, from commit ${c.build.sourceCommit.slice(0, 10)}, has not been deployed yet\\), and the pair program \\(pair_curve\\) at round 4, from commit 29f6f5de19\\.`));
    const { DEV_FEE_LINE, devFeeLineFor } = await import("@/lib/burnticker/fees");
    const { EARLIER_COINS_LINE } = await import("@/lib/burnticker/feeShareLine");
    // owner decision 2026-10-19: the shares are the new-coin tier; continuous audit run 2 (HB-13): the line names both tiers and the
    // cutover in words (no machine date)
    // hourly run 5, HS-26: the footer line leads with the split every live coin pays and says where pair pools are explained
    void EARLIER_COINS_LINE;
    assert.ok(DEV_FEE_LINE.endsWith(" Coin-vs-coin pair pools use their own split, shown on the pair page."), DEV_FEE_LINE);
    assert.doesNotMatch(devFeeLineFor("launchlab"), /pair-curve/);
  });
});

describe("audit 12 P2 items 5, 6, 8, 10, 11 and usability 13, 15, 16 (library parts)", () => {
  test("item 6: the fade side says game DAY and the doubleheader cases before it is picked", () => {
    const w = patternWords("fade", { follow: "team", subject: "Rockies", outcome: "win" });
    assert.equal(w.label, "After each Rockies game day without a win");
    assert.match(w.sentence, /A day with two games counts once: it burns only if neither game is a win\. A tie is not a win\. A day with no game played, or only a cancelled one, burns nothing\./);
    const r = patternWords("fade", { follow: "rivalry", pairKind: "teams" });
    assert.match(r.label, /game day/); assert.match(r.sentence, /its own team plays and does not lose/);
  });
  test("item 8: a passed scheduled close is not 'due'; the search marks it", async () => {
    const { dueTiming, CLOSE_PASSED_LINE } = await import("@/lib/burnticker/timing");
    const t = dueTiming("2026-10-13T12:00:00Z", Date.parse("2026-10-13T23:07:00Z"));
    assert.deepEqual([t.closePassed, t.warning], [true, CLOSE_PASSED_LINE]);
    assert.doesNotMatch(CLOSE_PASSED_LINE, /\bdue\b/);
    assert.equal(dueTiming("2026-10-20T12:00:00Z", Date.parse("2026-10-13T23:07:00Z")).closePassed, undefined);
  });
  test("item 10: one-coin and two-coin labels follow the mode", async () => {
    const { whichHeading, createsLineFor, namesRemadeLine } = await import("@/lib/burnticker/guidedLaunch");
    assert.equal(whichHeading("coins", null, "record"), "Choose the coin whose record close is read");
    assert.equal(whichHeading("coins"), "Choose two coins");
    assert.deepEqual([createsLineFor("coins"), createsLineFor("coins", "record"), createsLineFor("coins", "race"), createsLineFor("team")], ["Creates 1 or 2 coins", "Creates 1 coin", "Creates 2 coins", "Creates 1 coin"]);
    assert.doesNotMatch(namesRemadeLine(1), /both coins/);
  });
  test("item 11: the record close says whether it can start, before setup", async () => {
    const { recordCloseAvailability } = await import("@/lib/burnticker/guidedLaunch");
    const off = recordCloseAvailability({ keyed: false });
    assert.equal(off.available, false); assert.match(off.line, /cannot start here today/); assert.doesNotMatch(off.line, /Pyth|access key/, "HB-9: no operator setup detail for creators"); assert.match(off.alternative ?? "", /flippening/);
    assert.equal(recordCloseAvailability({ keyed: true }).available, true);
  });
  test("item 13: a within-event filter and pages over every outcome", async () => {
    const { filterOutcomes } = await import("@/lib/burnticker/oracle/polymarket");
    const ms = Array.from({ length: 30 }, (_, i) => ({ question: `Will the high in Denver be ${70 + i}°F or higher on Oct 14?`, outcome: `${70 + i}°F`, endDate: "2026-10-14T06:00:00Z" }));
    const p1 = filterOutcomes(ms, "");
    assert.deepEqual([p1.shown.length, p1.matched, p1.total, p1.nextOffset], [12, 30, 30, 12]);
    assert.equal(filterOutcomes(ms, "", { offset: 24 }).nextOffset, null);
    const f = filterOutcomes(ms, "85");
    assert.deepEqual(f.shown.map((m) => m.outcome), ["85°F"]);
  });
  test("item 15: the burn-a-real-token line has no release name", async () => {
    const { BURN_REAL_WAITING } = await import("@/lib/burnticker/launchAvailability");
    assert.doesNotMatch(BURN_REAL_WAITING, /round/i);
  });
  test("item 5: a race on two party markets says parties, never candidates", async () => {
    const { settledPairFundsFlow, PARTIES_PAIR_SENTENCE } = await import("@/lib/burnticker/pairFundsFlow");
    const f = settledPairFundsFlow("candidates", { a: "HICK", b: "BAIS" }, { a: "the Democratic Party", b: "the Republican Party" });
    assert.equal(f.oneLiner, PARTIES_PAIR_SENTENCE);
    assert.ok(f.outcomes.some((x) => /Another party wins/.test(x.when)));
    assert.ok(!f.outcomes.some((x) => /candidate/.test(x.when)));
    const r = review({ rule: candidatesPairRule(EAGLES_CID, 1), ticker: "CANDA", name: "Candidate A", pair: { ticker: "CANDB", name: "Candidate B", market: BUCS_CID, race: RACE, names: { a: "the Democratic Party", b: "the Republican Party" } } });
    assert.equal(r.settled?.sentence, PARTIES_PAIR_SENTENCE);
  });
});
