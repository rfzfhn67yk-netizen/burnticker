// REVIEW 2 F6 (ChatGPT/Codex, 2026-10-11): the pair explanations reversed the mechanics after winner-takes-the-burn shipped — the
// matchup / election-pair / Coin vs Coin templates said the losing coin burns, and the landing page said neither pool can pay the other
// side. One shared sentence (describe.ts PAIR_BURN_SENTENCE) now explains a registered pair everywhere. This test checks it SEMANTICALLY
// against the engine with a named winner and loser (a lint cannot catch reversed economics), then checks that every surface carries it.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { openRegistry } from "@/lib/burnticker/registry";
import { FakeBurnProgram } from "@/lib/burnticker/program";
import { buildPairBundles, FakeLaunchLab } from "@/lib/burnticker/launchBundle";
import { KalshiClient, fixtureFetch, openMarketsUrl, seriesApiUrl, settledMarketsUrl } from "@/lib/burnticker/oracle/kalshi";
import { CatalogueAdapter } from "@/lib/burnticker/catalogue";
import { runCycle } from "@/lib/burnticker/multiKeeper";
import { CANDIDATES_PAIR_SENTENCE, GAME_PAIR_SENTENCE, PAIR_BURN_SENTENCE, PAIR_REVIEW_LINE, pairResultSentence, pairWinnerOf } from "@/lib/burnticker/describe";
import { INDEPENDENT_PAIR_LINE, TEMPLATES, pairLineFor } from "@/lib/burnticker/templates";
import { lockRule, pairMirrorRule, validateRule } from "@/lib/burnticker/rules";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import { BRONCOS, NOW, fx } from "./burntickerHelpers.ts";
import { SHIB, WIF, coinvsRule } from "./burntickerDerbyHelpers.ts";

const ROOT = path.join(import.meta.dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const CREATOR = "CreatorWa11et111111111111111111111111111111", ATTESTER = "KeeperDataKey1111111111111111111111111111111";
const BRONCOS_LOSE = { ...BRONCOS, binary: { onYes: null, onNo: { fractionOfPool: 0.02 } }, pair: null };
const lint = (t: string) => lintCopy(t, loadCopyLintConfig()).hits.map((h) => `${h.phrase}:${h.rule}`);

describe("review 2 F6 — one factual pair sentence, checked against the engine", () => {
  test("named fixture: Denver beats the Rams — $CHIEFS (its rule fires on a Denver win) is the winner, $BRONCOS the loser; the keeper agrees and forwards $BRONCOS's share to $CHIEFS's burn pool", async () => {
    let clock = NOW;
    const reg = openRegistry(":memory:"), program = new FakeBurnProgram("devnet");
    const inputA = { creator: CREATOR, ticker: "BRONCOS", name: "BRONCOS", description: "", imageUrl: null, links: [], rule: BRONCOS_LOSE, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true }, cluster: "devnet" as const };
    const pr = await buildPairBundles({ a: inputA, b: { ticker: "CHIEFS", name: "CHIEFS", description: "", imageUrl: null, links: [] }, voidBy: "2026-11-30" }, { program, launchLab: new FakeLaunchLab(), devFeeWallet: null, attesters: [ATTESTER], quorum: 1, metadataUri: (m: string) => `https://x/${m}.json` });
    for (const [b, ticker] of [[pr.a, "BRONCOS"], [pr.b, "CHIEFS"]] as const) {
      reg.register({ mint: b.mint, ticker, name: b.name, creator: CREATOR, description: b.description, imageUrl: null, links: [], rulesText: b.rules.text, feePda: b.addresses.feePda, vault: null, tokenConfig: null, poolId: null, launchTx: null, cluster: "devnet", platformId: null, baselineAt: "2026-09-01T00:00:00Z", status: "draft" }, clock);
      reg.markLaunched(b.mint, `launch${ticker}`, null, "2026-09-01T00:00:00Z");
      program.deposit(b.mint, BigInt(5_000_000_000)); program.supplies.set(b.mint, BigInt("1000000000000000"));
    }
    reg.registerPair(pr.pairId, pr.a.mint, pr.b.mint);
    const ruleA = reg.lockedRule(reg.token(pr.a.mint)!).rule, ruleB = reg.lockedRule(reg.token(pr.b.mint)!).rule;
    // the generated sentence, from the two locked rules and the result (the "-DEN" market: YES = Denver won)
    const sides = { a: { ticker: "BRONCOS", rule: ruleA }, b: { ticker: "CHIEFS", rule: ruleB } };
    const w = pairWinnerOf(sides.a, sides.b, "yes")!;
    assert.deepEqual([w.winner.ticker, w.loser.ticker], ["CHIEFS", "BRONCOS"]);
    const named = pairResultSentence(sides.a, sides.b, "yes");
    assert.equal(named, "This result fires $CHIEFS's rule: eligible fees from both coins fund $CHIEFS's burn, and $BRONCOS's share for it moves to $CHIEFS's burn pool. Nothing is paid to holders.");
    assert.deepEqual(lint(named), []);
    // the engine: run the keeper over the settled games and read the roles and the forward it recorded for that game
    const table = { [settledMarketsUrl("KXNFLGAME")]: fx("kalshi/KXNFLGAME.settled.json"), [seriesApiUrl("KXNFLGAME")]: fx("kalshi/series.KXNFLGAME.json"), [openMarketsUrl("KXNFLGAME")]: { cursor: "", markets: [] } };
    await runCycle({ registry: reg, program, oracles: { kalshi: new KalshiClient({ fetchImpl: fixtureFetch(table), now: () => clock, minIntervalMs: 0 }), catalogue: new CatalogueAdapter() }, attester: ATTESTER, log: () => {}, now: () => clock, dryRun: false });
    const LAR = "KXNFLGAME-26SEP27LARDEN-DEN";
    const rowA = reg.receipt(pr.a.mint, LAR)!, rowB = reg.receipt(pr.b.mint, LAR)!;
    assert.equal(rowA.result, "yes", "the fixture game is a Denver win");
    assert.deepEqual([rowB.pairRole, rowB.status], ["won", "confirmed"], "the winner the sentence names is the coin the engine burns");
    assert.deepEqual([rowA.pairRole, rowA.status], ["lost", "forwarded"], "the loser is forwarded, never burned on its own coin");
    const fwd = reg.pairForwards(pr.pairId).find((f) => f.loserMint === pr.a.mint)!;
    assert.equal(fwd.winnerMint, pr.b.mint, "the loser's share goes to the winner's burn pool");
    assert.ok(fwd.lamports > BigInt(0));
    // and the other result names the other coin
    assert.equal(pairWinnerOf(sides.a, sides.b, "no")!.winner.ticker, "BRONCOS");
  });

  test("Coin vs Coin: the side whose coin did better fires (side A's rule on YES = A out-gained B); the template says so", () => {
    const a = lockRule({ ...coinvsRule({ selector: "coinvs", a: WIF, b: SHIB, window: "daily", measure: "pct", season: { start: "2026-10-05", days: 7 }, flip: false }), pair: null }).rule;
    const b = validateRule(pairMirrorRule(a));
    const w = pairWinnerOf({ ticker: "TEAMWIF", rule: a }, { ticker: "TEAMSHIB", rule: b }, "yes")!;
    assert.equal(w.winner.ticker, "TEAMWIF", "WIF out-gained SHIB: $TEAMWIF's rule fires");
    assert.match(TEMPLATES.find((t) => t.id === "coin-vs-coin")!.example, /\$TEAMWIF burns on a day WIF out-gains SHIB, and \$TEAMSHIB's share for that day goes to \$TEAMWIF's burn\..*WIF and SHIB are only read, never traded or burned\./);
  });

  test("every surface that explains a registered pair carries the one sentence; none says the losing coin burns or that a pool cannot pay the other", () => {
    assert.deepEqual(lint(PAIR_BURN_SENTENCE), []);
    assert.ok(PAIR_REVIEW_LINE.startsWith(PAIR_BURN_SENTENCE), "the review card's line");
    // templates: registered pairs carry it exactly; a matchup says when it is a registered pair and then carries it
    // website-20 item 51: the line follows the pairing the launch page builds: Coin vs Coin and the flippening are registered pairs; a
    // matchup and an election pair are two separate launches (the page posts two coins), so nothing moves between them
    for (const id of ["coin-vs-coin", "flippening"]) assert.equal(TEMPLATES.find((t) => t.id === id)!.pairLine, PAIR_BURN_SENTENCE, id);
    // owner 2026-10-13: an election pair and a one-game matchup are linked pairs too, each with its own one sentence (describe.ts)
    assert.equal(TEMPLATES.find((t) => t.id === "election-pair")!.pairLine, CANDIDATES_PAIR_SENTENCE); assert.equal(TEMPLATES.find((t) => t.id === "matchup")!.pairLine, GAME_PAIR_SENTENCE);
    void INDEPENDENT_PAIR_LINE;
    for (const t of TEMPLATES) if (t.shape === "pair") assert.equal(t.pairLine, pairLineFor(t.pairing), t.id);
    for (const t of TEMPLATES) {
      for (const s of [t.example, t.pairLine ?? ""]) {
        assert.deepEqual(lint(s), [], `${t.id}: ${s}`);
        assert.doesNotMatch(s, /did worse burns|losing side[^.]*burns|who loses[^.]*burns|loses tonight burns/i, `${t.id}: reversed pair wording`);
      }
    }
    assert.match(read("src/app/burnticker/templates/page.tsx"), /\{t\.pairLine && /, "the gallery renders the pair line");
    // the landing page (static HTML): since site audit #7 (2026-10-11) it names rivalries and the Derby without explaining the pair rule;
    // if it ever explains it again, it carries the sentence verbatim. The old lines stay gone.
    const home = read("site/burnticker/index.html");
    if (/data-pair-sentence|both coins fund/i.test(home)) assert.ok(home.includes(`<span data-pair-sentence>${PAIR_BURN_SENTENCE}</span>`), "landing page carries the sentence");
    assert.doesNotMatch(home, /neither pool can pay/i);
    assert.doesNotMatch(home, /winning side burns part of its own pool/i);
    // the review card (launch page + the Coin vs Coin tile pass PAIR_REVIEW_LINE), Derby, the pair pages (Next + static twin)
    assert.match(read("src/app/burnticker/launch/page.tsx"), /pairLine=\{settledPick \? reviewSettled\?\.sentence \?\? settledLine : pairOn && !ruleB \? PAIR_REVIEW_LINE : null\}/);
    assert.match(read("src/app/burnticker/launch/CoinVsCoinTile.tsx"), /pairLine=\{PAIR_REVIEW_LINE\}/);
    const derby = read("src/app/burnticker/derby/page.tsx");
    assert.match(derby, /\{PAIR_BURN_SENTENCE\}/);
    assert.doesNotMatch(derby, /burns part of its own pool/);
    assert.match(read("src/app/burnticker/p/[pairId]/page.tsx"), /\{t\.winnerTakesBurn && <div[^>]*>\{PAIR_BURN_SENTENCE\}<\/div>\}/);
    assert.match(read("src/lib/burnticker/tokenPage.ts"), /esc\(PAIR_BURN_SENTENCE\)/);
  });
});
