// THE END-SINK PICKER (END-SINK-OPTIONS-BRIEF item 2, owner 2026-10-13 ~09:00 Denver: "pick another coin to burn (except the losing coin)")
// and the owner rule of ~09:05 the same morning: a coin never burns itself on its losing path. The program already pins a named coin as an
// end sink (end.rs END_SINK_MINT; a coin not live at the end falls to $DEFICIT); these tests pin the library (GET /sinks, the rule field
// onEnd.mint, the review and bundle refusals, the end sentences), TEST A (setups with a named sink, end to end through the fake program),
// the page model (the choices, the hidden incinerator slot, linked pairs keep the pair winner) and the page wiring by its source.
import { describe, test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { Keypair } from "@solana/web3.js";
import { BURNTICKER_RULES_SCHEMA, DEFAULT_ON_END, END_SELF_ON_LOSS_REFUSAL, WIND_DOWN_ON_END, endSelfOnLossProblem, endSinkOf, lockRule, onEndText, type BurnRule } from "@/lib/burnticker/rules";
import { describeRule, endText } from "@/lib/burnticker/describe";
import { endSinkPin, FakeBurnProgram } from "@/lib/burnticker/program";
import { liveSinks, namedSinkProblem, NAMED_SINK_NOT_LIVE, NAMED_SINK_PARTNER, NAMED_SINK_SELF, searchSinks, sinkCandidates, SINK_FALLBACK_LINE, type SinkRow } from "@/lib/burnticker/endSinks";
import { ruleRefusals, settledPairInput } from "@/lib/burnticker/launchPreflight";
import { buildLaunchReview } from "@/lib/burnticker/launchReview";
import { END_CHOICE_LINES, GUIDED_STEPS, SELF_ON_LOSS_LINE, SINK_NONE_LINE, END_CHOICE_LABEL, candidatesPairRule, endChoiceModel, endChoiceOf, endSentences, gamePairRule, pickedSinkLine, withEndChoice } from "@/lib/burnticker/guidedLaunch";
import { siteLaunchStateFromCatalogue, siteLaunchState } from "@/lib/burnticker/launchAvailability";
import { firstPartyRule } from "@/lib/burnticker/wizard";
import { teamSeries } from "@/lib/burnticker/sources/espn";

import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import { CREATOR, POST_HEADERS, API, callRoute, makeWorld, type World } from "./burntickerApiHelpers.ts";
import { ONE_SHOT } from "./burntickerHelpers.ts";
// review 10 F1: a single one-shot burns 100 % on a host without burn dispersal (the bundle route refuses a smaller share)
const ONE = { ...ONE_SHOT, binary: { onYes: { fractionOfPool: 1 }, onNo: null } };
process.env.BURNTICKER_END_SINK_PICKER = "1"; // the picker is a host option (off by default since 2026-10-13); these tests exercise it on

const cfg = loadCopyLintConfig();
/** Plain English: the copy lint, and none of the words the brief bars (buy, price, will, payout, target, coming soon, dates). */
const clean = (t: string) => {
  const r = lintCopy(t, cfg); assert.ok(r.ok, `${r.hits.map((h) => `${h.phrase} (${h.rule})`).join(", ")}\n${t}`);
  assert.doesNotMatch(t, /\b(will|buy|buys|price|payout|target)\b|coming soon|\b20\d\d\b|\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d/i, t);
};
const read = (f: string) => fs.readFileSync(f, "utf8");

const SINK = Keypair.generate().publicKey.toBase58();
const OTHER = Keypair.generate().publicKey.toBase58();
const named = (r: object, mint = SINK, ticker = "LAD") => ({ ...r, onEnd: { ...DEFAULT_ON_END, mint, ticker } });
const poly = (): BurnRule => ({ schema: BURNTICKER_RULES_SCHEMA, oracle: "polymarket", series: null, market: "0x" + "ab".repeat(32), filter: {}, kind: "binary", binary: { onYes: { fractionOfPool: 1 }, onNo: null }, scalar: null, onVoid: "skip", floorUsd: "1", reserveSol: "0.02", vault: null, onEnd: { ...DEFAULT_ON_END } } as BurnRule);
const season = (abbr: string, outcome: "win" | "loss" = "win") => ({ ...firstPartyRule(teamSeries("mlb", abbr, outcome, { kind: "season", year: 2026 }), 0.02), onEnd: { ...DEFAULT_ON_END } }) as BurnRule;
const row = (o: Partial<SinkRow> & { mint: string; ticker: string }): SinkRow => ({ name: `${o.ticker} coin`, status: "live", cluster: "devnet", tokenConfig: "Cfg111", mode: "buyback", rulesJson: JSON.stringify(lockRule({ ...ONE, onEnd: DEFAULT_ON_END }).rule), ...o });

describe("the rule field onEnd.mint (end.rs END_SINK_MINT)", () => {
  test("a named sink locks with its mint and ticker; the kind is mint; the pin names the coin", () => {
    const l = lockRule(named(ONE));
    assert.equal(endSinkOf(l.rule), "mint");
    assert.deepEqual(l.rule.onEnd, { ...DEFAULT_ON_END, mint: SINK, ticker: "LAD" });
    assert.notEqual(l.sha256, lockRule({ ...ONE, onEnd: DEFAULT_ON_END }).sha256, "the hash locks the named coin");
    assert.deepEqual(endSinkPin(l.rule, null), { kind: "mint", sinkMint: SINK, minForwardLamports: BigInt(50_000_000) });
    assert.match(onEndText(l.rule), /\$LAD's burn pool \(coin \w+\) when that coin is live then, and \$DEFICIT's burn pool otherwise/);
  });
  test("refused: a mint without its ticker, without endSink, a bad ticker, or on a winner-takes-the-burn pair", () => {
    assert.throws(() => lockRule({ ...ONE, onEnd: { ...DEFAULT_ON_END, mint: SINK } }), /both or neither/);
    assert.throws(() => lockRule({ ...ONE, onEnd: { ...WIND_DOWN_ON_END, mint: SINK, ticker: "LAD" } }), /needs onEnd.endSink/);
    assert.throws(() => lockRule({ ...ONE, onEnd: { ...DEFAULT_ON_END, mint: SINK, ticker: "lad!" } }), /both or neither/);
    assert.throws(() => lockRule({ ...named(ONE), pair: { pairId: "p", side: "A", counterpartMint: null, winnerTakesBurn: true } }), /pair winner/);
  });
});

describe("the end sentences say the named coin and end.rs's fall-through", () => {
  test("the review's end facts and the coin description: the rest goes to $X's burn; if $X is not live then, to $DEFICIT's burn", () => {
    const r = lockRule(named(ONE)).rule;
    const e = endText(r);
    assert.equal(e.kind, "mint");
    // owner decision 2026-10-19: ONE spends its whole pool in one burn, so its end names what reaches the pool later (describe.ts oneShotRestCoin)
    assert.equal(e.result, "After its one burn, anything that reaches this coin's pool later, trading fees and the kept reserve, goes to $LAD's burn; if $LAD is not live then, to $DEFICIT's burn. If the rule ends without its burn, the whole pool goes the same way. Then the coin retires.");
    clean(e.result);
    const d = describeRule(lockRule(named(poly())).rule, { ticker: "YES" });
    assert.match(d.paragraph, /whatever is left burns \$LAD, or \$DEFICIT if \$LAD is not live then, and the coin retires/);
    const s = endSentences(r);
    assert.equal(s.kind, "named-coin");
    assert.equal(s.options.filter((o) => o.available).map((o) => o.kind).join(), "named-coin");
  });
  test("the champion path keeps the self-burn on the winning path and sends the losing path to the named coin", () => {
    const r = lockRule(named(season("LAD"), SINK, "DODGE")).rule;
    const e = endText(r, { team: "the Dodgers" });
    assert.equal(e.kind, "champion");
    assert.equal(e.result, "If the Dodgers win the championship, the rest of the pool burns here. If they do not, the rest goes to $DODGE's burn; if $DODGE is not live then, to $DEFICIT's burn.");
    const d = describeRule(r, { ticker: "LADW" });
    assert.match(d.paragraph, /If they do not, the rest goes to \$DODGE's burn; if \$DODGE is not live then, to \$DEFICIT's burn\./);
  });
});

describe("GET /sinks: the live coins that can take the rest", () => {
  const rows = [row({ mint: SINK, ticker: "LAD" }), row({ mint: OTHER, ticker: "DEN" }), row({ mint: "Dft111111111111111111111111111111", ticker: "DEFICIT" }),
    row({ mint: "Drf111111111111111111111111111111", ticker: "DRAFT", status: "draft" }), row({ mint: "Ret111111111111111111111111111111", ticker: "OLD", status: "retired" }),
    row({ mint: "Mai111111111111111111111111111111", ticker: "MAIN", cluster: "mainnet" }), row({ mint: "Vlt111111111111111111111111111111", ticker: "VLT", mode: "vault" }),
    row({ mint: "Noc111111111111111111111111111111", ticker: "NOCFG", tokenConfig: null })];
  test("live, on this network, with a config and a burn pool; never $DEFICIT; sorted by ticker; each with its one-line rule", () => {
    const s = sinkCandidates(rows, { network: "devnet" });
    assert.deepEqual(s.map((x) => x.ticker), ["DEN", "LAD"]);
    for (const x of s) { assert.ok(x.rule.length > 10); assert.ok(x.name); }
    assert.deepEqual(sinkCandidates(rows, { network: "mainnet" }).map((x) => x.ticker), ["MAIN"]);
  });
  test("the pair partner is never offered: by the pairs table, by the partner's counterpart, and by the caller's own counterpart", () => {
    // the pairs table
    assert.deepEqual(sinkCandidates(rows, { network: "devnet", exclude: [OTHER], pairOf: (m) => (m === OTHER ? { mintA: OTHER, mintB: SINK } : null) }).map((x) => x.ticker), []);
    // side B's rule names side A (OTHER) as its counterpart: excluding OTHER drops B too
    const sideB = row({ mint: "SdB111111111111111111111111111111", ticker: "SIDEB", rulesJson: JSON.stringify({ ...lockRule({ ...ONE, onEnd: DEFAULT_ON_END }).rule, pair: { pairId: "x", side: "B", counterpartMint: OTHER } }) });
    assert.deepEqual(sinkCandidates([...rows, sideB], { network: "devnet", exclude: [OTHER] }).map((x) => x.ticker), ["LAD"]);
    // the caller's own row names its partner: excluding the caller drops the partner
    assert.deepEqual(sinkCandidates([...rows, sideB], { network: "devnet", exclude: [sideB.mint] }).map((x) => x.ticker), ["LAD"]);
  });
  test("the picker's search: ticker, name, mint or rule", () => {
    const s = sinkCandidates(rows, { network: "devnet" });
    assert.deepEqual(searchSinks(s, "$lad").map((x) => x.ticker), ["LAD"]);
    assert.deepEqual(searchSinks(s, OTHER).map((x) => x.ticker), ["DEN"]);
    assert.equal(searchSinks(s, "").length, 2);
  });
  test("namedSinkProblem: a plain sentence for a coin not in the list, this coin itself, its pair partner, a wrong ticker", () => {
    const s = sinkCandidates(rows, { network: "devnet" });
    assert.equal(namedSinkProblem(lockRule(named(ONE)).rule, s), null);
    assert.equal(namedSinkProblem(lockRule(named(ONE, "Ret111111111111111111111111111111", "OLD")).rule, s), NAMED_SINK_NOT_LIVE("OLD"));
    assert.equal(namedSinkProblem(lockRule(named(ONE)).rule, s, { own: [SINK] }), NAMED_SINK_SELF);
    assert.equal(namedSinkProblem(lockRule(named(ONE)).rule, s, { partners: [SINK] }), NAMED_SINK_PARTNER("LAD"));
    assert.match(namedSinkProblem(lockRule(named(ONE, SINK, "NOPE")).rule, s)!, /is \$LAD, not \$NOPE/);
    for (const t of [NAMED_SINK_NOT_LIVE("OLD"), NAMED_SINK_SELF, NAMED_SINK_PARTNER("LAD"), SINK_FALLBACK_LINE]) clean(t);
  });
});

describe("the owner rule: a coin never burns itself on its losing path", () => {
  test("a rule that could carry an end sink and ends on the wind-down alone is refused; league mode and fixed-token rules are not", () => {
    const self = lockRule({ ...ONE, onEnd: WIND_DOWN_ON_END });
    assert.equal(endSelfOnLossProblem(self.rule), END_SELF_ON_LOSS_REFUSAL);
    assert.deepEqual(ruleRefusals(self).map((x) => x.code), ["end-self-on-loss"]);
    assert.equal(endSelfOnLossProblem(lockRule({ ...ONE, onEnd: DEFAULT_ON_END }).rule), null);
    assert.equal(endSelfOnLossProblem(lockRule(named(ONE)).rule), null);
    assert.equal(endSelfOnLossProblem({ ...self.rule, set: { id: "s", outcome: "o", forwardBps: 10_000 } }), null, "league mode keeps the wind-down until league-set sinks exist");
    assert.equal(endSelfOnLossProblem({ ...self.rule, kind: "scalar", scalar: { ...self.rule.scalar!, perUnit: { tokens: 100 } } }), null, "a fixed-token rule has no end sink");
    clean(END_SELF_ON_LOSS_REFUSAL); clean(SELF_ON_LOSS_LINE);
  });
  test("the review lists it; a linked pair says its own end-sink refusal once (both settled-pair shapes)", () => {
    const r = buildLaunchReview({ rule: { ...ONE, onEnd: WIND_DOWN_ON_END }, ticker: "HOT", name: "Hot Days" }, { env: {}, reserved: new Set() });
    assert.ok(("review" in r ? r.review.problems : r.problems).includes(END_SELF_ON_LOSS_REFUSAL));
    for (const x of [{ rule: candidatesPairRule("0x" + "cd".repeat(32)), pair: { market: "0x" + "ef".repeat(32), race: "some-race" } }, { rule: gamePairRule("mlb", "401", "LAD"), pair: { opp: "SD" } }]) {
      const locked = lockRule({ ...x.rule, onEnd: WIND_DOWN_ON_END });
      const si = settledPairInput(x.pair)!; const codes = ruleRefusals(locked, { pair: true, candidates: si.candidates, game: si.game }).map((y) => y.code);
      assert.ok(codes.some((c) => /end-sink$/.test(c)), codes.join());
      assert.ok(!codes.includes("end-self-on-loss"), "said once");
    }
  });
  test("the page model: the losing path offers another coin, $DEFICIT (and the incinerator when the launch state has it), never this coin", () => {
    const m = endChoiceModel(lockRule({ ...ONE, onEnd: DEFAULT_ON_END }).rule, { sinkPicker: true });
    assert.equal(m.offered, true); assert.equal(m.winning, null);
    assert.equal(endChoiceModel(ONE as unknown as BurnRule).offered, true, "a rule sent without onEnd gets the default end, so it offers the choice too");
    assert.deepEqual(m.options.map((o) => o.kind), ["coin", "deficit"]);
    assert.ok(!m.options.some((o) => o.line === END_CHOICE_LINES.self));
    assert.deepEqual(endChoiceModel(lockRule({ ...ONE, onEnd: DEFAULT_ON_END }).rule, { burnSol: true, sinkPicker: true }).options.map((o) => o.kind), ["coin", "deficit", "burn-sol"]);
    // the winning path keeps "the rest burns this coin" where the rule has one: the champion path
    const champ = endChoiceModel(season("LAD"), { team: "the Dodgers" });
    assert.equal(champ.winning, "If the Dodgers win the championship, the rest burns this coin.");
    assert.ok(!champ.options.some((o) => o.line === END_CHOICE_LINES.self));
    for (const t of [...Object.values(END_CHOICE_LINES), END_CHOICE_LABEL, SINK_NONE_LINE, pickedSinkLine("LAD"), champ.winning!]) clean(t);
  });
});

describe("pairs: an independent pair's coins pick their own; a linked pair keeps the pair winner", () => {
  test("a winner-takes-the-burn pair (both settled shapes, a Coin vs Coin pair) shows no choice and withEndChoice leaves it alone", () => {
    for (const r of [candidatesPairRule("0x" + "cd".repeat(32)), gamePairRule("mlb", "401", "LAD")]) {
      const linked = { ...r, onEnd: DEFAULT_ON_END, pair: { pairId: "p", side: "A", counterpartMint: null, winnerTakesBurn: true } } as BurnRule;
      assert.equal(endChoiceModel(linked).offered, false);
      assert.deepEqual(withEndChoice(linked, { kind: "coin", mint: SINK, ticker: "LAD" }), linked);
    }
    // a Coin vs Coin coin (derby/tile.ts tileRule) carries the end sink, so its losing side never burns itself
    assert.match(read("src/lib/burnticker/derby/tile.ts"), /onEnd: \{ windDownDays: 28, sweepThresholdLamports: 50_000_000, endSink: true \}/); assert.match(read("src/lib/burnticker/derby/highTile.ts"), /endSink: true \}/);
  });
  test("an independent pair: coin B's own pick is checked in the review, and B's wind-down alone is refused", () => {
    const sinks = [{ mint: SINK, ticker: "LAD", name: "Dodgers", rule: "burns when the Dodgers win" }];
    const ok = buildLaunchReview({ rule: named(ONE), ticker: "HOTA", name: "Hot A", companion: { ticker: "HOTB", name: "Hot B", rule: { ...ONE, onEnd: DEFAULT_ON_END } } } as never, { env: {}, reserved: new Set(), sinks });
    const p0 = "review" in ok ? ok.review.problems : ok.problems;
    assert.ok(!p0.some((x) => /burn itself|cannot take/.test(x)), p0.join("\n"));
    const bad = buildLaunchReview({ rule: { ...ONE, onEnd: DEFAULT_ON_END }, ticker: "HOTA", name: "Hot A", companion: { ticker: "HOTB", name: "Hot B", rule: named(ONE, OTHER, "DEN") } } as never, { env: {}, reserved: new Set(), sinks });
    assert.ok(("review" in bad ? bad.review.problems : bad.problems).includes(`Coin B. ${NAMED_SINK_NOT_LIVE("DEN")}`));
    const self = buildLaunchReview({ rule: { ...ONE, onEnd: DEFAULT_ON_END }, ticker: "HOTA", name: "Hot A", companion: { ticker: "HOTB", name: "Hot B", rule: { ...ONE, onEnd: WIND_DOWN_ON_END } } } as never, { env: {}, reserved: new Set(), sinks });
    assert.ok(("review" in self ? self.review.problems : self.problems).includes(`Coin B. ${END_SELF_ON_LOSS_REFUSAL}`));
  });
  test("withEndChoice and endChoiceOf round-trip; $DEFICIT clears the named coin", () => {
    const r = lockRule({ ...ONE, onEnd: DEFAULT_ON_END }).rule;
    const picked = withEndChoice(r, { kind: "coin", mint: SINK, ticker: "LAD" });
    assert.deepEqual(picked.onEnd, { ...DEFAULT_ON_END, mint: SINK, ticker: "LAD" });
    assert.deepEqual(endChoiceOf(picked), { kind: "coin", mint: SINK, ticker: "LAD" });
    assert.deepEqual(withEndChoice(picked, { kind: "deficit" }).onEnd, DEFAULT_ON_END);
    assert.deepEqual(withEndChoice(r, { kind: "coin" }).onEnd, DEFAULT_ON_END, "no coin picked yet: $DEFICIT");
  });
});

describe("TEST A: setups with a named sink, through the API on the fakes", () => {
  let w: World;
  before(async () => { w = await makeWorld(); });
  const bundle = (rule: unknown, mint = Keypair.generate().publicKey.toBase58()) => callRoute(`${API}/launch/bundle`, { method: "POST", headers: POST_HEADERS, body: JSON.stringify({ creator: CREATOR, mint, ticker: "HOT", name: "Hot Days", rule, acknowledgements: { ruleLocked: true, noReturns: true }, register: false }) });
  test("GET /sinks lists the live coins with their rules; exclude drops a coin; a bad network or mint is a 400", async () => {
    const j = await (await callRoute(`${API}/sinks`)).json() as { network: string; sinks: { ticker: string; mint: string; rule: string }[]; fallback: string };
    assert.equal(j.network, "devnet");
    assert.deepEqual(j.sinks.map((x) => x.ticker).sort(), ["BRONCO", "DEFICIT2"]);
    assert.equal(j.fallback, SINK_FALLBACK_LINE);
    const ex = await (await callRoute(`${API}/sinks?exclude=${w.bronco.mint}`)).json() as { sinks: { ticker: string }[] };
    assert.deepEqual(ex.sinks.map((x) => x.ticker), ["DEFICIT2"]);
    assert.equal((await callRoute(`${API}/sinks?network=moon`)).status, 400);
    assert.equal((await callRoute(`${API}/sinks?exclude=nope`)).status, 400);
    assert.deepEqual(liveSinks(w.registry, "devnet").map((x) => x.ticker), ["BRONCO", "DEFICIT2"]);
  });
  test("a bundle naming a live coin is built and pins that coin as the end sink; its end facts name it with the fall-through", async () => {
    const res = await bundle(named(ONE, w.bronco.mint, "BRONCO"));
    const body = await res.json() as { review: { rules: { text: string } }; error?: string };
    assert.equal(res.status, 200, body.error);
    const locked = lockRule(JSON.parse(body.review.rules.text));
    assert.deepEqual(endSinkPin(locked.rule, null), { kind: "mint", sinkMint: w.bronco.mint, minForwardLamports: BigInt(50_000_000) });
    assert.match(endText(locked.rule).result, /goes to \$BRONCO's burn; if \$BRONCO is not live then, to \$DEFICIT's burn\./);
    // the fake program pins EndSink kind mint naming BRONCO (end.rs pin_end_sink)
    const p = new FakeBurnProgram("devnet"); p.pinEndSinks = true;
    const mint = Keypair.generate().publicKey.toBase58();
    await p.initializeToken({ mint, creator: CREATOR, ticker: "HOT", rulesSha256: locked.sha256, selectorKey: "k", mode: "buyback", attesters: [CREATOR], quorum: 1, vault: null, rule: locked.rule });
    assert.deepEqual(await p.endSink.port(mint).endSink(), { kind: "mint", sinkMint: w.bronco.mint, minForwardLamports: BigInt(50_000_000) });
  });
  test("a bundle naming a coin that is not live, or itself, is refused in a plain sentence; a wind-down alone is refused too", async () => {
    const ghost = await bundle(named(ONE, OTHER, "GHOST"));
    const g = await ghost.json() as { error: string; code: string };
    assert.equal(ghost.status, 400); assert.equal(g.code, "end-sink-coin"); assert.equal(g.error, NAMED_SINK_NOT_LIVE("GHOST"));
    const mint = Keypair.generate().publicKey.toBase58();
    const own = await (await bundle(named(ONE, mint, "HOT"), mint)).json() as { code: string; error: string };
    assert.equal(own.code, "end-sink-coin"); assert.equal(own.error, NAMED_SINK_SELF);
    const self = await bundle({ ...ONE, onEnd: WIND_DOWN_ON_END });
    assert.equal(self.status, 400); assert.equal((await self.json() as { code: string }).code, "end-self-on-loss");
  });
  test("the review route checks the pick against the same list", async () => {
    const rv = async (rule: unknown) => (await callRoute(`${API}/launch/review`, { method: "POST", headers: POST_HEADERS, body: JSON.stringify({ rule, ticker: "HOT", name: "Hot Days" }) })).json() as Promise<{ problems: string[]; end: { result: string } }>;
    const good = await rv(named(ONE, w.deficit.mint, "DEFICIT2"));
    assert.ok(!good.problems.some((x) => /cannot take/.test(x)), good.problems.join("\n"));
    assert.match(good.end.result, /\$DEFICIT2's burn; if \$DEFICIT2 is not live then, to \$DEFICIT's burn/);
    const bad = await rv(named(ONE, OTHER, "GHOST"));
    assert.ok(bad.problems.includes(NAMED_SINK_NOT_LIVE("GHOST")));
  });
});

describe("the launch state and the page wiring", () => {
  test("the incinerator slot reads burnSol from the launch state: absent today (hidden), shown only when a burn-sol source says so", () => {
    assert.equal(siteLaunchState({}).burnSol.available, false);
    const cat = (sources: unknown[]) => ({ cluster: "devnet", launches: { creators: "open", mode: "open", types: {}, sources } });
    assert.equal(siteLaunchStateFromCatalogue(cat([])).burnSol.available, false);
    assert.equal(siteLaunchStateFromCatalogue(cat([{ id: "burn-sol", label: "x", available: true, reason: null }])).burnSol.available, true);
  });
  test("the page applies each coin's choice to its own rule, keeps the five steps, the latch, editedFor, prepareIfCurrent and the gates", () => {
    const page = read("src/app/burnticker/launch/page.tsx"), picker = read("src/app/burnticker/launch/EndChoicePicker.tsx"), card = read("src/app/burnticker/launch/ReviewCard.tsx");
    assert.equal(GUIDED_STEPS.length, 5);
    assert.match(page, /const endPickable = !meetingsOn && !settledPick && !\(pairOn && !baseRuleB\);/);
    assert.match(page, /withEndChoice\(r, endA\)/); assert.match(page, /withEndChoice\(ruleB0, endB\)/);
    assert.match(page, /burnSol: site\.burnSol\.available/);
    assert.match(page, /\$\{V1\}\/sinks\?network=\$\{realNet\}/);
    assert.match(page, /label: FACT_LABELS\.ends, [^\n]*extra: endChoiceReview/);
    assert.match(page, /const snapshot = JSON\.stringify\(\{ guide,[^\n]*cardSet, endA, endB, nameAuto, tickerAuto, editedFor, ownImage, note, srcSuggest \}\);/);   // PROD-02: the source suggestion is saved too
    for (const k of ["prepareIfCurrent(sentRev", "setEditedFor(", "reviewMatchesDraft(reviewSlot, curRev.current)"]) assert.ok(page.includes(k), k);
    assert.match(picker, /role="radiogroup"/); assert.match(picker, /data-sink-search/); assert.match(picker, /s\.rule/);
    assert.match(card, /f\.extra && <div/); assert.match(card, /data-name-end-choice/); assert.match(page, /<ReviewCard mode="name" endChoice=\{endChoiceBlock\}/);
    clean("Pick a coin from the list. Until you do, the rest goes to $DEFICIT's burn.");
  });
});

// owner decision 2026-10-13 evening: the "another coin" choice is held back until the list is curated (a sink coin has a beneficiary;
// $DEFICIT has none). Off by default: the step-4 model offers only $DEFICIT (and the incinerator when the host has it), and the server
// refuses a named sink with "end-sink-picker-off".
test("the another-coin end choice is hidden and refused unless BURNTICKER_END_SINK_PICKER=1", async () => {
  const { sinkPickerFromEnv } = await import("@/lib/burnticker/launchAvailability");
  assert.equal(sinkPickerFromEnv({}), false); assert.equal(sinkPickerFromEnv({ BURNTICKER_END_SINK_PICKER: "1" }), true);
  const { endChoiceModel } = await import("@/lib/burnticker/guidedLaunch");
  const rule = { schema: "burnticker.rules/v1", oracle: "polymarket", series: null, market: "0xabc", filter: {}, kind: "binary", binary: { onYes: { fractionOfPool: 1 }, onNo: null }, onEnd: { windDownDays: 28, sweepThresholdLamports: 50_000_000, endSink: true } } as never;
  assert.deepEqual(endChoiceModel(rule).options.map((o) => o.kind), ["deficit"]);
  assert.deepEqual(endChoiceModel(rule, { sinkPicker: true }).options.map((o) => o.kind), ["coin", "deficit"]);
  assert.deepEqual(endChoiceModel(rule, { sinkPicker: true, burnSol: true }).options.map((o) => o.kind), ["coin", "deficit", "burn-sol"]);
});
