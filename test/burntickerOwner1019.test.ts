// OWNER DECISIONS 2026-10-19: (1) burning a real token is off by default (BURNTICKER_BURN_REAL_ENABLED), and the review and the bundle
// route refuse what the page hides; (2) the incinerator end sink is on wherever the round-5 program runs (BURNTICKER_BURN_SOL_ENABLED
// turns it off), checked end to end for a single coin; (3) a coin that resolves once and spends 100 % says what reaches its pool after the
// one burn instead of the losing-path words; (4) three plain waiting lines while the launch prepares, confirms and is read back.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  BURN_REAL_ENABLED_FLAG, BURN_REAL_WAITING, BURN_SOL_ENABLED_FLAG, BURN_SOL_NOT_R5, BURN_SOL_OFF, availabilityFromEnv, burnRealEnabledFromEnv,
  burnRealOfferedFromEnv, burnSolEnabledFromEnv, burnSolOfferedFromEnv, catalogueLaunches, siteLaunchState, siteLaunchStateFromCatalogue,
} from "@/lib/burnticker/launchAvailability";
import { BURN_REAL_OFF_CODE, BURN_SOL_OFF_CODE, burnRealRefusal, ruleRefusals } from "@/lib/burnticker/launchPreflight";
import { buildLaunchReview, incineratorRentLabel } from "@/lib/burnticker/launchReview";
import { END_SINK_ACCOUNT_BYTES, rentLamports, solText } from "@/lib/burnticker/launchCost";
import { incineratorStepText } from "@/lib/burnticker/burnTarget";
import { buildLaunchBundle, FakeLaunchLab } from "@/lib/burnticker/launchBundle";
import { FakeBurnProgram } from "@/lib/burnticker/program";
import { ProgramBurnClient } from "@/lib/burnticker/programClient";
import { END_SINK_INCINERATOR, endSinkPda } from "@/lib/burnReceipts/endSink";
import { PROGRAM_IDS } from "@/lib/burnticker/networks";
import { firstPartyRule } from "@/lib/burnticker/wizard";
import { applyDial, ON_END_DEFAULT } from "@/lib/burnticker/dials";
import { DEFAULT_ON_END, INCINERATOR_ADDRESS, lockRule, ruleStatement, validateRule, type BurnRule } from "@/lib/burnticker/rules";
import { END_CHOICE_LABEL_ENDS, END_CHOICE_LABEL_ONE_SHOT, END_CHOICE_LINES, endChoiceLabel, endChoiceModel, endChoiceOf, endSentences, withEndChoice } from "@/lib/burnticker/guidedLaunch";
import { INCINERATOR_END_RESULT, ONE_SHOT_NO_BURN_LINE, ONE_SHOT_REST_DEFICIT, ONE_SHOT_REST_INCINERATOR, describeRule, endText } from "@/lib/burnticker/describe";
import { hasNoBurnOutcome, isOneShot, oneShotFull } from "@/lib/burnticker/nextResult";
import { plainSentence } from "@/lib/burnticker/coinCard";
import { CHAIN_CONFIRM_LINE, LAUNCHING_NOTICE, PREPARING_LAUNCH_LINE, READ_BACK_LINE, waitLineFor } from "@/lib/burnticker/mintAddressCopy";
import { prepareLaunch } from "@/lib/burnticker/api/handlers";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import { BRONCOS, DEBT_RULE } from "./burntickerHelpers.ts";
import { CREATOR, makeWorld } from "./burntickerApiHelpers.ts";

const cfg = loadCopyLintConfig();
const plain = (t: string) => {
  assert.deepEqual(lintCopy(t, cfg).hits.map((h) => `${h.phrase} (${h.rule})`), [], t);
  assert.doesNotMatch(t, /\bwill\b|\bbuy\b|\bprice\b|coming soon|\bpayouts?\b|→|\b20\d\d-\d\d-\d\d\b/i, t);
};
const read = (f: string) => fs.readFileSync(f, "utf8");
const BONK = { mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", pool: "HVNwzt7Pxfu76KHCMQPTLuTCLTm6WnQ1esLv4eizseSv", symbol: "BONK", feedId: "72b021217ca3fe68922a19aaf990109cb9d84e9ad004b4d2025ad6f529314419" };
const MAINNET = { BURNTICKER_CLUSTER: "mainnet", BURNTICKER_CREATOR_LAUNCHES_ENABLED: "1" };
const R5 = { ...MAINNET, BURNTICKER_INITIALIZE_TOKEN_LAYOUT: "r5" };
const debt = (f = 0.02): BurnRule => ({ ...DEBT_RULE, scalar: { ...DEBT_RULE.scalar, perUnit: { fractionOfPool: f } } }) as unknown as BurnRule;
/** The live NEXTM6's shape: catalogue:usgs.quakenext:6, one burn of 100 %, the default end ($DEFICIT). */
const quakeNext = (f: number, s = "usgs.quakenext:6"): BurnRule => ({ ...applyDial(firstPartyRule(s, 0.02), "fraction", f), onEnd: { ...ON_END_DEFAULT } }) as BurnRule;
const incinerated = (r: BurnRule): BurnRule => ({ ...r, onEnd: { ...ON_END_DEFAULT, endSink: "incinerator" } }) as BurnRule;
const review = (rule: unknown, env: Record<string, string>, extra: Record<string, unknown> = {}) => {
  const r = buildLaunchReview({ rule, ticker: "TESTX", name: "Test X", ...extra } as never, { env, reserved: new Set() });
  assert.ok("review" in r, "problems" in r ? r.problems.join(" | ") : "");
  return r.review;
};
/** Runs `f` with these process.env values, restoring the old ones after (the bundle route and the program client read process.env). */
async function withEnv<T>(vars: Record<string, string | undefined>, f: () => Promise<T>): Promise<T> {
  const old = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { return await f(); } finally { for (const [k, v] of Object.entries(old)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
}

describe("1. burning a real token is off by default", () => {
  test("BURNTICKER_BURN_REAL_ENABLED: off unless 1, true, on or yes; the burn-real source needs the round-5 program AND the flag", () => {
    assert.equal(BURN_REAL_ENABLED_FLAG, "BURNTICKER_BURN_REAL_ENABLED");
    assert.equal(burnRealEnabledFromEnv({}), false);
    for (const v of ["1", "true", "on", "yes", " YES "]) assert.equal(burnRealEnabledFromEnv({ [BURN_REAL_ENABLED_FLAG]: v }), true, v);
    for (const v of ["0", "false", "off", "no", "", "r5"]) assert.equal(burnRealEnabledFromEnv({ [BURN_REAL_ENABLED_FLAG]: v }), false, v);
    assert.equal(burnRealOfferedFromEnv(R5), false, "r5 alone is not enough");
    assert.equal(burnRealOfferedFromEnv({ ...MAINNET, [BURN_REAL_ENABLED_FLAG]: "1" }), false, "the flag without r5 is not enough");
    assert.equal(burnRealOfferedFromEnv({ ...R5, [BURN_REAL_ENABLED_FLAG]: "1" }), true);
    const src = (env: Record<string, string>) => availabilityFromEnv(env, "mainnet").sources.find((s) => s.id === "burn-real")!;
    assert.deepEqual([src(R5).available, src(R5).reason], [false, BURN_REAL_WAITING], "the waiting line stays the reason");
    assert.deepEqual([src({ ...R5, [BURN_REAL_ENABLED_FLAG]: "1" }).available, src({ ...R5, [BURN_REAL_ENABLED_FLAG]: "1" }).reason], [true, null]);
    assert.equal(siteLaunchState(R5).burnReal.available, false);
    assert.equal(siteLaunchStateFromCatalogue({ cluster: "mainnet", launches: catalogueLaunches(R5) }).burnReal.line, BURN_REAL_WAITING);
  });
  test("the launch page offers the choice only from the launch state (realOneOffered and the Coin vs Coin tile read site.burnReal)", () => {
    const page = read("src/app/burnticker/launch/page.tsx");
    assert.match(page, /const realOneOffered = site\.burnReal\.available && !pairOn/);
    assert.match(page, /burnReal=\{site\.burnReal\}|burnReal=\{\{|site\.burnReal/);
  });
  test("the review: a pinned token (side A, side B or a Matchup companion) is one plain problem while the flag is off", () => {
    const off = review({ ...debt(), burnTarget: BONK }, R5);
    assert.deepEqual(off.problems, [BURN_REAL_WAITING]); assert.equal(off.signable, false);
    assert.deepEqual(review({ ...debt(), burnTarget: BONK }, { ...R5, [BURN_REAL_ENABLED_FLAG]: "1" }).problems, []);
    assert.deepEqual(review(debt(), R5).problems, [], "a coin that burns itself is unaffected");
    plain(BURN_REAL_WAITING);
  });
  test("burnRealRefusal: 400 burn-real-off with the waiting line while the flag is off; nothing when on or when nothing is pinned", () => {
    assert.deepEqual(burnRealRefusal(BONK, R5), { status: 400, code: BURN_REAL_OFF_CODE, message: BURN_REAL_WAITING });
    assert.equal(BURN_REAL_OFF_CODE, "burn-real-off");
    assert.equal(burnRealRefusal(BONK, { ...R5, [BURN_REAL_ENABLED_FLAG]: "on" }), null);
    assert.equal(burnRealRefusal(null, R5), null); assert.equal(burnRealRefusal(undefined, R5), null);
  });
  test("the bundle route refuses rule.burnTarget and pair.burnTarget with burn-real-off while the flag is off, and builds them when it is on", async () => {
    const w = await makeWorld();
    const single = { creator: CREATOR, ticker: "REALOFF", name: "Real Off", rule: { ...BRONCOS, burnTarget: BONK }, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true } };
    type Out = { error?: { status: number; body: { error: string; code: string } }; pair?: unknown; bundle?: unknown };
    const a = await withEnv({ [BURN_REAL_ENABLED_FLAG]: undefined }, () => prepareLaunch(w.p, single, { register: false }) as Promise<Out>);
    assert.equal(a.error?.status, 400); assert.equal(a.error?.body.code, "burn-real-off"); assert.equal(a.error?.body.error, BURN_REAL_WAITING);
    const pairBody = { creator: CREATOR, ticker: "MILEHX", name: "Mile High X", rule: { ...BRONCOS, binary: { onYes: null, onNo: { fractionOfPool: 0.02 } }, pair: null }, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true }, pair: { ticker: "ARROWHX", name: "Arrowhead X", description: "", imageUrl: null, links: [], burnTarget: BONK } };
    const b = await withEnv({ [BURN_REAL_ENABLED_FLAG]: undefined }, () => prepareLaunch(w.p, pairBody, { register: false }) as Promise<Out>);
    assert.equal(b.error?.status, 400); assert.equal(b.error?.body.code, "burn-real-off"); assert.equal(b.error?.body.error, `Side B: ${BURN_REAL_WAITING}`);
    // HB-12 + PROD-01 (2026-10-19): with the flag on, a team pair still may not burn another token (burnRealEligibility.ts); the
    // published-data coin that may is covered in test/burntickerBurnRealEligibility.test.ts
    const on = await withEnv({ [BURN_REAL_ENABLED_FLAG]: "1" }, () => prepareLaunch(w.p, { ...pairBody, ticker: "MILEHY", pair: { ...pairBody.pair, ticker: "ARROWHY" } }, { register: false }) as Promise<Out>);
    assert.equal(on.error?.status, 400); assert.equal(on.error?.body.code, "burn-real-family"); assert.match(on.error!.body.error, /^Side B: Only a coin on published data/);
  });
});

describe("2. the incinerator end sink is on wherever round 5 runs", () => {
  // the live NEXTM6's shape with the incinerator end (a per-event quake rule has no end, so it offers no end choice)
  const single = incinerated(quakeNext(1));
  test("BURNTICKER_BURN_SOL_ENABLED: on unless 0, false, off or no; the burn-sol source needs the round-5 program; plain reasons", () => {
    assert.equal(BURN_SOL_ENABLED_FLAG, "BURNTICKER_BURN_SOL_ENABLED");
    assert.equal(burnSolEnabledFromEnv({}), true);
    for (const v of ["0", "false", "off", "no", " OFF "]) assert.equal(burnSolEnabledFromEnv({ [BURN_SOL_ENABLED_FLAG]: v }), false, v);
    for (const v of ["1", "yes", "", "anything"]) assert.equal(burnSolEnabledFromEnv({ [BURN_SOL_ENABLED_FLAG]: v }), true, v);
    const src = (env: Record<string, string>) => availabilityFromEnv(env, "mainnet").sources.find((s) => s.id === "burn-sol")!;
    assert.deepEqual([src(R5).available, src(R5).reason], [true, null], "the mainnet host with r5 needs no env change");
    assert.deepEqual([src({ ...R5, [BURN_SOL_ENABLED_FLAG]: "0" }).available, src({ ...R5, [BURN_SOL_ENABLED_FLAG]: "0" }).reason], [false, BURN_SOL_OFF]);
    assert.deepEqual([src(MAINNET).available, src(MAINNET).reason], [false, BURN_SOL_NOT_R5]);
    assert.equal(burnSolOfferedFromEnv(R5), true); assert.equal(burnSolOfferedFromEnv(MAINNET), false);
    for (const t of [BURN_SOL_OFF, BURN_SOL_NOT_R5, src(R5).label]) plain(t);
    // the catalogue carries it to the browser, which the end step reads (site.burnSol)
    assert.equal(siteLaunchStateFromCatalogue({ cluster: "mainnet", launches: catalogueLaunches(R5) }).burnSol.available, true);
    assert.equal(siteLaunchStateFromCatalogue({ cluster: "mainnet", launches: catalogueLaunches({ ...R5, [BURN_SOL_ENABLED_FLAG]: "no" }) }).burnSol.available, false);
  });
  test("the end step offers two choices for a single coin, the default first; picking the incinerator locks onEnd.endSink \"incinerator\"", () => {
    const rule = quakeNext(0.5);
    const m = endChoiceModel(rule, { burnSol: siteLaunchState(R5).burnSol.available, sinkPicker: siteLaunchState(R5).sinkPicker.available });
    assert.deepEqual(m.options, [{ kind: "deficit", line: END_CHOICE_LINES.deficit }, { kind: "burn-sol", line: END_CHOICE_LINES.burnSol }]);
    assert.equal(endChoiceModel(rule, { burnSol: siteLaunchState(MAINNET).burnSol.available }).options.length, 1);
    const picked = withEndChoice(rule, { kind: "burn-sol" });
    const locked = lockRule(picked);
    assert.equal(locked.rule.onEnd?.endSink, "incinerator");
    assert.deepEqual(endChoiceOf(locked.rule), { kind: "burn-sol" });
    // PROD-03 (2026-10-19): each coin's choices come from its own rule (pairEnds.ts endChoicesFor): a linked pair's coin never offers it
    assert.match(read("src/app/burnticker/launch/page.tsx"), /const choiceA = endPickable && rule \? endChoiceModel\(rule, \{ \.\.\.endChoicesFor\(rule, endSite\), team: teamRef \}\) : null;/);
  });
  test("the review: the end sentence, the EndSink account's rent line and the pin in the lock step; signable on r5; refused when off or without r5", () => {
    const rv = review(single, R5);
    assert.deepEqual(rv.problems, []); assert.equal(rv.signable, true);
    assert.equal(rv.end.kind, "incinerator");
    assert.match(rv.rule.endsLine, /is sent to Solana's incinerator and burned\./);
    assert.match(review(incinerated(quakeNext(0.5)), R5).rule.endsLine, /sent to Solana's incinerator, which nothing can spend from/);
    const rent = rentLamports(END_SINK_ACCOUNT_BYTES);
    const line = rv.costs.lines.find((l) => l.label === incineratorRentLabel("TESTX"));
    assert.ok(line, rv.costs.lines.map((l) => l.label).join(" | "));
    assert.equal(line!.sol, solText(rent)); assert.equal(line!.kind, "rent");
    const plainRv = review(quakeNext(1), R5);
    // the total is shown to 0.0001 SOL, so it differs by the EndSink rent within that rounding
    assert.ok(Math.abs(Math.round((Number(rv.costs.totalSol) - Number(plainRv.costs.totalSol)) * 1e9) - rent) <= 100_000, "the total counts the EndSink rent once");
    assert.equal(rv.costs.lines.length, plainRv.costs.lines.length + 1);
    assert.equal(rv.transactions.steps[0].label, incineratorStepText("TESTX"));
    assert.equal(plainRv.transactions.steps[0].label, "Lock in $TESTX's rule");
    assert.match(rv.rule.statement, new RegExp(`Solana's incinerator \\(${INCINERATOR_ADDRESS}\\)`));
    for (const t of [incineratorRentLabel("TESTX"), incineratorStepText("TESTX")]) plain(t);
    const off = review(single, { ...R5, [BURN_SOL_ENABLED_FLAG]: "0" });
    assert.deepEqual(off.problems, [BURN_SOL_OFF]); assert.equal(off.signable, false);
    assert.equal(review(single, MAINNET).signable, false, "a host without round 5 refuses it (incinerator-not-live)");
    assert.ok(ruleRefusals(lockRule(single), { programRound5: true, burnSol: false }).some((x) => x.code === BURN_SOL_OFF_CODE && x.status === 400));
    assert.ok(!ruleRefusals(lockRule(single), { programRound5: true, burnSol: true }).some((x) => x.code === BURN_SOL_OFF_CODE));
  });
  test("the EndSink account is 123 bytes: 8 + the fields of programs/burn-receipts state.rs EndSink", () => {
    const src = read("programs/burn-receipts/programs/burn_receipts/src/state.rs");
    const body = /pub struct EndSink \{([\s\S]*?)\n\}/.exec(src)![1];
    const size: Record<string, number> = { u8: 1, u64: 8, i64: 8, Pubkey: 32, "[u8; 32]": 32 };
    const fields = [...body.matchAll(/pub \w+: ([^,]+),/g)].map((x) => size[x[1].trim()]);
    assert.ok(fields.every((n) => Number.isFinite(n)), body);
    assert.equal(8 + fields.reduce((a, b) => a + b, 0), END_SINK_ACCOUNT_BYTES);
    assert.equal(END_SINK_ACCOUNT_BYTES, 123);
  });
  test("the bundle: its lock step says the pin; the r5 program client pins EndSink kind INCINERATOR and confirm's expectation records it", async () => {
    const b = await buildLaunchBundle({ creator: CREATOR, ticker: "ASHES", name: "Ashes", description: "a test", imageUrl: null, links: [], rule: single, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true }, cluster: "devnet" }, { program: new FakeBurnProgram("devnet"), launchLab: new FakeLaunchLab(), devFeeWallet: null, attesters: [CREATOR], quorum: 1, metadataUri: (m: string) => `https://x/${m}.json` });
    assert.deepEqual(b.transactions.map((t) => t.label), [incineratorStepText("ASHES"), "Create $ASHES (LaunchLab create)"]);
    const programId = new PublicKey(PROGRAM_IDS.devnet.burn_receipts);
    const client = new ProgramBurnClient({ connection: new Connection("http://127.0.0.1:1"), programId, cluster: "devnet", payer: null, admin: Keypair.generate().publicKey, solUsd: async () => 150, endSinksLive: true });
    const mint = Keypair.generate().publicKey.toBase58();
    const input = { mint, creator: Keypair.generate().publicKey.toBase58(), ticker: "ASHES", rulesSha256: "cd".repeat(32), selectorKey: "catalogue:usgs.quakenext:6", mode: "buyback" as const, attesters: [Keypair.generate().publicKey.toBase58()], quorum: 1, vault: null, rule: lockRule(single).rule };
    await withEnv({ BURNTICKER_INITIALIZE_TOKEN_LAYOUT: undefined }, () => assert.rejects(client.initializeToken(input), /needs the round-5 program/));
    const r = await withEnv({ BURNTICKER_INITIALIZE_TOKEN_LAYOUT: "r5" }, () => client.initializeToken(input));
    assert.ok(r.instructions[0].keys.some((k) => k.pubkey === endSinkPda(programId, new PublicKey(mint)).toBase58() && k.isWritable), "the EndSink PDA rides, writable");
    assert.equal(r.expected.endSink?.kind, END_SINK_INCINERATOR);
    assert.equal(r.expected.endSink?.mint, null);
  });
  test("the coin page says it: the locked statement, the coin's description and its plain sentence", () => {
    const r = lockRule(single).rule;
    assert.match(ruleStatement(r), /is sent to Solana's incinerator \(1nc1nerator11111111111111111111111111111111\), which nothing can spend from/);
    assert.match(describeRule(r, { ticker: "ASHES" }).paragraph + " " + endText(r).line, /Solana's incinerator, which nothing can spend from/);
    assert.match(plainSentence(r, "ASHES"), /is sent to Solana's incinerator and burned\./);
  });
  test("a pair rule with the incinerator end is still refused (rules.ts), and the review of a two-coin launch never offers it", () => {
    assert.throws(() => validateRule({ ...incinerated(quakeNext(1)), pair: { pairId: "x-vs-y-z", side: "A", counterpartMint: null } }), /is for a single coin/);
    const pairOn = true, ruleB = true;
    assert.equal(endChoiceModel(quakeNext(0.5), { burnSol: siteLaunchState(R5).burnSol.available && !(pairOn && ruleB) }).options.some((o) => o.kind === "burn-sol"), false);
  });
});

describe("3. a one-shot that spends 100 % says what reaches its pool after the one burn", () => {
  const next = quakeNext(1);
  test("NEXTM6's shape is one-shot at 100 % (isOneShot and the fraction); a share below 100 % or a repeating rule is not", () => {
    assert.equal(isOneShot(next), true);
    assert.equal(oneShotFull(next), true);
    assert.equal(oneShotFull(quakeNext(0.5)), false);
    assert.equal(oneShotFull(quakeNext(1, "usgs.quakes:6")), false, "per event repeats");
    assert.equal(oneShotFull(debt(1)), false);
  });
  test("the end sentences, the end step's choices and its heading", () => {
    assert.equal(endText(next).result, `${ONE_SHOT_REST_DEFICIT} Then the coin retires.`);
    assert.equal(endSentences(next).sentences[0], ONE_SHOT_REST_DEFICIT);
    assert.equal(endText(incinerated(next)).result, `${ONE_SHOT_REST_INCINERATOR} No coin is swapped for it. Then the coin retires.`);
    const m = endChoiceModel(next, { burnSol: true });
    assert.deepEqual(m.options, [{ kind: "deficit", line: ONE_SHOT_REST_DEFICIT }, { kind: "burn-sol", line: ONE_SHOT_REST_INCINERATOR }]);
    assert.equal(endChoiceLabel(m), END_CHOICE_LABEL_ONE_SHOT);
    // a share below 100 % keeps the old words
    const half = quakeNext(0.5);
    assert.match(endText(half).result, /^When the rule ends on a result, the rest of the pool/);
    assert.equal(endChoiceLabel(endChoiceModel(half, { burnSol: true })), END_CHOICE_LABEL_ENDS);
    assert.equal(endText(incinerated(half)).result, INCINERATOR_END_RESULT);
  });
  test("the review's end sentence and the locked statement", () => {
    const rv = review(next, R5);
    assert.match(rv.rule.endsLine, /After its one burn, anything that reaches this coin's pool later, trading fees and the kept reserve, goes to \$DEFICIT's burn\./);
    assert.doesNotMatch(rv.rule.statement, /When the rule ends with a result, whatever is left in the burn pool moves/);
    assert.match(rv.rule.statement, /The rule resolves once and spends the whole burn pool in that one burn\. After it, whatever reaches the burn pool later \(trading fees that arrive after the burn, the reserve the rule keeps back on every crank, and rounding\) moves to \$DEFICIT's burn pool/);
    assert.match(review(incinerated(next), R5).rule.endsLine, /is sent to Solana's incinerator and burned\./);
    assert.match(plainSentence(lockRule(next).rule, "NEXTM6"), /After its one burn, anything that reaches \$NEXTM6's pool later, trading fees and the kept reserve, goes to \$DEFICIT's burn\./);
  });
  test("a one-shot market with an answer that burns nothing also says the whole pool goes the same way then", () => {
    const market = { ...BRONCOS, series: null, filter: {}, market: "KXNFLGAME-26OCT11DENNYJ-DEN", binary: { onYes: { fractionOfPool: 1 }, onNo: null }, onEnd: { ...DEFAULT_ON_END } } as unknown as BurnRule;
    assert.equal(oneShotFull(market), true); assert.equal(hasNoBurnOutcome(market), true);
    assert.equal(endText(market).result, `${ONE_SHOT_REST_DEFICIT} ${ONE_SHOT_NO_BURN_LINE} Then the coin retires.`);
    assert.match(ruleStatement(lockRule(market).rule), /If the rule ends with the result that burns nothing, whatever is left in the burn pool goes the same way\./);
    assert.equal(hasNoBurnOutcome(next), false);
  });
  test("every new sentence passes the copy lint", () => {
    for (const t of [ONE_SHOT_REST_DEFICIT, ONE_SHOT_REST_INCINERATOR, ONE_SHOT_NO_BURN_LINE, END_CHOICE_LABEL_ONE_SHOT, endText(next).line, endText(incinerated(next)).line]) plain(t);
    // the statement's new end clause (its lead is the per-unit text the wizard audit's F9 tracks)
    plain(ruleStatement(next).slice(ruleStatement(next).indexOf("The rule resolves once")));
  });
  test.todo("usgs.quakenext gap (wizard audit 2026-10-19): the live NEXTM6 (catalogue:usgs.quakenext:6, cadence \"resolves once\") was not treated as one-shot by the older status producer; once the audit settles how a catalogue cadence marks one-shot, check the one-shot 100 % end wording follows it on every surface");
});

describe("4. the waiting lines", () => {
  test("the three sentences, word for word, lint-clean, no \"will\"", () => {
    assert.equal(PREPARING_LAUNCH_LINE, "Preparing the launch: pinning the coin's details and building its transactions. This takes a few seconds.");
    assert.equal(CHAIN_CONFIRM_LINE, "Waiting for the chain to confirm. A few seconds.");
    assert.equal(READ_BACK_LINE, "Writing the coin's accounts on chain. The coin page opens when they are read back.");
    for (const t of [PREPARING_LAUNCH_LINE, CHAIN_CONFIRM_LINE, READ_BACK_LINE, LAUNCHING_NOTICE]) plain(t);
    assert.ok(LAUNCHING_NOTICE.startsWith(PREPARING_LAUNCH_LINE));
  });
  test("the sign card's busy states: nothing idle or while the wallet asks; the chain line while confirming; the read-back line after the last confirmation", () => {
    assert.equal(waitLineFor(false, "chain"), null);
    assert.equal(waitLineFor(true, null), null);
    assert.equal(waitLineFor(true, "wallet"), null);
    assert.equal(waitLineFor(true, "chain"), CHAIN_CONFIRM_LINE);
    assert.equal(waitLineFor(true, "record"), READ_BACK_LINE);
  });
  test("the wiring: the review card shows the preparing line while the prepare runs; the sign card sets each phase around the wallet, the confirmation and the record", () => {
    const card = read("src/app/burnticker/launch/ReviewCard.tsx"), sign = read("src/app/burnticker/launch/SignCard.tsx");
    assert.match(card, /\{p\.busy && <p [^>]*data-launching>\{LAUNCHING_NOTICE\}<\/p>\}/);
    assert.match(sign, /signTransaction: async \(tx\) => \{ setPhase\("wallet"\); const signed = await wallet\.signTransaction!\(tx\); setPhase\("chain"\); return signed; \}/);
    assert.match(sign, /confirm: async \(sig, bh\) => \{ setPhase\("chain"\);/);
    assert.equal((sign.match(/setPhase\("record"\);\s*const c = await confirmPlan\(/g) ?? []).length, 2, "both record paths say the read-back");
    assert.match(sign, /\{waitLineFor\(busy, phase\) && <p [^>]*role="status"[^>]*data-launch-wait=\{phase \?\? ""\}>\{waitLineFor\(busy, phase\)\}<\/p>\}/);
    assert.match(sign, /setBusy\(false\); setPhase\(null\);/);
  });
});
