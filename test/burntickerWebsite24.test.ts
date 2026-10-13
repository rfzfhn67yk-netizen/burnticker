// WEBSITE-24 (2026-10-13): the launch pages' side of WIRING-ROUND5 (a coin that burns a real token, such as WIF or BONK, instead of
// itself): the launch state's round-5 line, the per-side "Burn the real <symbol>" choice (default off), the admission verdict in the
// library's words, the hashed field only after admission, the review sentence, the pin transaction counted in the pre-wallet summary,
// and the coin page's receipt, held and trust lines. Plus the settled-pair side-B describe context (base 449b3939). Pure pieces are tested
// directly; page wiring is pinned by its source.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { BURN_REAL_LAYOUT_ENV, BURN_REAL_WAITING, burnRealFromEnv, catalogueLaunches, siteLaunchState, siteLaunchStateFromCatalogue } from "@/lib/burnticker/launchAvailability";
import { INITIALIZE_TOKEN_LAYOUT_ENV } from "@/lib/burnReceipts/instructions";
import { SUGGESTED_TARGETS, admissionLine, targetActionSentence, targetChoiceLabel, targetTrustCopy } from "@/lib/burnticker/burnTarget";
import { formatTargetMemo, parseTargetMemo } from "@/lib/burnReceipts/memo";
import { buildLaunchReview } from "@/lib/burnticker/launchReview";
import { BURNTICKER_RULES_SCHEMA, validateRule, type BurnRule } from "@/lib/burnticker/rules";
import { rentLamports, LAMPORTS_PER_SIGNATURE } from "@/lib/burnticker/launchCost";
import { candidatesPairRule } from "@/lib/burnticker/guidedLaunch";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import {
  BURN_TARGET_BYTES, PIN_NOTE, POOL_FIELD_LABEL, REAL_OFF_LINE, SIDE_REAL_OFF, SINGLE_REAL_PICKS, admissionFrom, admissionKey, admissionUrl, checkingLine, lockStepLabel, noPoolLine,
  pinStepLabel, poolFieldHelp, realBlockers, realField, realHeldLine, realMemoBurn, realNotOffered, realPickFor, realReadSentence, realReviewNotes, receiptRealLine, ruleRealBurn, withPinSteps, withRealBurn, type SideReal,
} from "@/app/burnticker/launch/burnReal";

const cfg = loadCopyLintConfig();
const plain = (t: string, where = t) => {
  assert.deepEqual(lintCopy(t, cfg).hits.map((h) => `${h.phrase} (${h.rule})`), [], `${where}: ${t}`);
  assert.doesNotMatch(t, /\bwill\b|\bbuy|\bprice\b|coming soon|\bpayouts?\b|\btarget/i, `${where}: ${t}`);
  assert.doesNotMatch(t, /\b20\d\d-\d\d-\d\d\b/, `${where} carries a date: ${t}`);
};
const read = (f: string) => fs.readFileSync(f, "utf8");
const page = read("src/app/burnticker/launch/page.tsx"), tile = read("src/app/burnticker/launch/CoinVsCoinTile.tsx"), choice = read("src/app/burnticker/launch/BurnRealChoice.tsx"), coin = read("src/app/burnticker/t/[ticker]/page.tsx");
const BONK = SUGGESTED_TARGETS.find((t) => t.symbol === "BONK")!;
const POOL = "HVNwzt7Pxfu76KHCMQPTLuTCLTm6WnQ1esLv4eizseSv";
const BONK_PICK = { symbol: "BONK", mint: BONK.mint, feedId: BONK.feedId, pool: POOL };
const KEY = admissionKey(BONK_PICK, "devnet");
const HELD: SideReal = { on: true, pick: BONK_PICK, admission: admissionFrom(KEY, "BONK", { ok: true, problems: [], line: admissionLine({ ok: true, problems: [], symbol: "BONK" }), pool: { kind: "amm-v4" } }) };
const SINGLE = { schema: BURNTICKER_RULES_SCHEMA, oracle: "kalshi", series: "KXNFLGAME", market: null, filter: { tickerIncludes: "DEN" }, kind: "binary", binary: { onYes: { fractionOfPool: 0.05 }, onNo: null }, scalar: null, onVoid: "skip", floorUsd: "1", reserveSol: "0.02", vault: null, pair: null } as unknown as BurnRule;
const ENV = { BURNTICKER_CLUSTER: "devnet", BURNTICKER_CREATOR_LAUNCHES_ENABLED: "1" } as Record<string, string>;

describe("the launch state says whether round 5 is deployed (never a date)", () => {
  test("the env name is the library's; only r5 turns the choice on", () => {
    assert.equal(BURN_REAL_LAYOUT_ENV, INITIALIZE_TOKEN_LAYOUT_ENV);
    assert.equal(burnRealFromEnv({}), false); assert.equal(burnRealFromEnv({ [BURN_REAL_LAYOUT_ENV]: "r4" }), false); assert.equal(burnRealFromEnv({ [BURN_REAL_LAYOUT_ENV]: " r5 " }), true);
    assert.deepEqual(siteLaunchState({ ...ENV }).burnReal, { available: false, line: BURN_REAL_WAITING });
    assert.deepEqual(siteLaunchState({ ...ENV, [BURN_REAL_LAYOUT_ENV]: "r5" }).burnReal, { available: true, line: null });
    plain(BURN_REAL_WAITING);
    assert.match(BURN_REAL_WAITING, /waits for the round-5 program/);
  });
  test("the catalogue carries it to the browser; a missing or stale reading is waiting (fail closed)", () => {
    const on = { cluster: "devnet", launches: catalogueLaunches({ ...ENV, [BURN_REAL_LAYOUT_ENV]: "r5" }) };
    assert.equal(siteLaunchStateFromCatalogue(on).burnReal.available, true);
    assert.equal(siteLaunchStateFromCatalogue({ cluster: "devnet", launches: catalogueLaunches(ENV) }).burnReal.available, false);
    assert.equal(siteLaunchStateFromCatalogue({ cluster: "devnet", launches: { creators: true } }).burnReal.available, false);
    assert.equal(siteLaunchStateFromCatalogue(null, { failure: "x" }).burnReal.line, BURN_REAL_WAITING);
    assert.equal(siteLaunchStateFromCatalogue(on, { now: Date.now() + 60 * 60_000 }).burnReal.available, false, "stale");
  });
});

describe("the choice, the admission and the hashed field", () => {
  test("a Coin vs Coin side's pick is its reference coin (suggested mint and feed first); no mint or no Pyth feed is not offered", () => {
    assert.deepEqual(realPickFor({ symbol: "bonk", pyth: null, mint: null, pool: null }), { symbol: "BONK", mint: BONK.mint, feedId: BONK.feedId, pool: "" });
    assert.deepEqual(realPickFor({ symbol: "MEW", pyth: "a".repeat(64), mint: POOL, pool: "p" }), { symbol: "MEW", mint: POOL, feedId: "a".repeat(64), pool: "p" });
    assert.equal(realPickFor({ symbol: "ETH", pyth: "b".repeat(64), mint: null }), null);
    assert.equal(realPickFor({ symbol: "SHIB", pyth: null, mint: POOL }), null);
    assert.deepEqual(SINGLE_REAL_PICKS.map((p) => p.symbol), ["WIF", "BONK"]);
  });
  test("the admission URL names everything the route checks; its answer is shown in the library's words", () => {
    const u = new URL(admissionUrl(BONK_PICK, "mainnet", null), "http://x");
    assert.equal(u.pathname, "/api/burnticker/burn-target");
    assert.deepEqual(Object.fromEntries(u.searchParams), { mint: BONK.mint, pool: POOL, symbol: "BONK", feed: BONK.feedId, network: "mainnet" });
    const refused = admissionFrom(KEY, "BONK", { ok: false, problems: ["The pool's fee is above 1%."] });
    assert.equal(refused.ok, false); assert.equal(refused.line, "This coin cannot burn BONK: The pool's fee is above 1%.");
    const served = admissionFrom(KEY, "BONK", { ok: false, problems: ["x"], line: "the route's own line" });
    assert.equal(served.line, "the route's own line");
    assert.equal(HELD.admission!.ok, true); assert.equal(HELD.admission!.kind, "amm-v4");
    assert.equal(admissionFrom(KEY, "BONK", null, "HTTP 502").error, "HTTP 502");
  });
  test("the field joins the rule only when on and held for exactly this pick; off strips it; side B never gets side A's", () => {
    assert.equal(realField(SIDE_REAL_OFF, "devnet"), null);
    assert.equal(realField({ ...HELD, on: false }, "devnet"), null);
    assert.equal(realField(HELD, "mainnet"), null, "another network's answer");
    assert.equal(realField({ ...HELD, pick: { ...BONK_PICK, pool: "Other111111111111111111111111111111111111" } }, "devnet"), null, "another pool's answer");
    assert.equal(realField({ ...HELD, admission: { ...HELD.admission!, ok: false } }, "devnet"), null);
    const f = realField(HELD, "devnet")!;
    assert.deepEqual(f, { mint: BONK.mint, pool: POOL, symbol: "BONK", feedId: BONK.feedId });
    const r = validateRule(withRealBurn(SINGLE, f));
    assert.deepEqual(r.burnTarget, f);
    assert.equal("burnTarget" in withRealBurn(r, null), false);
    // the tile builds side B from side A's mapping without side A's field, then adds side B's own
    assert.match(tile, /const ruleA: BurnRule \| null = model\?\.rule \? withRealBurn\(model\.rule, fieldA\) : null;/);
    assert.match(tile, /const ruleB: BurnRule \| null = model\?\.rule \? withRealBurn\(\{ \.\.\.model\.rule, binary: \{ onYes: null, onNo: model\.rule\.binary!\.onYes \} \}, fieldB\) : null;/);
  });
  test("what holds the launch: no pool, the check running, the refusal in the library's words", () => {
    const pickNoPool = { ...BONK_PICK, pool: "" };
    assert.deepEqual(realBlockers([{ ticker: "TEAMBONK", side: { on: true, pick: pickNoPool, admission: null }, network: "devnet" }]), [`$TEAMBONK: ${noPoolLine("BONK")}`]);
    assert.deepEqual(realBlockers([{ ticker: "TEAMBONK", side: { on: true, pick: BONK_PICK, admission: null }, network: "devnet" }]), [`$TEAMBONK: ${checkingLine("BONK")}`]);
    assert.deepEqual(realBlockers([{ ticker: "TEAMBONK", side: { ...HELD, admission: admissionFrom(KEY, "BONK", { ok: false, problems: ["The pool holds too little SOL."] }) }, network: "devnet" }]), ["$TEAMBONK: This coin cannot burn BONK: The pool holds too little SOL."]);
    assert.deepEqual(realBlockers([{ ticker: "TEAMBONK", side: HELD, network: "devnet" }, { ticker: "B", side: SIDE_REAL_OFF, network: "devnet" }]), []);
  });
});

describe("the review", () => {
  test("the owner's review sentence, word for word (Coin vs Coin names the side's days; a single coin does not)", () => {
    assert.deepEqual(realReviewNotes([{ ticker: "TEAMBONK", symbol: "BONK", daysOf: "BONK's" }]), ["$TEAMBONK burns real BONK on BONK's days, from its own burn pool; BONK's pool on Raydium is not ours and is not locked."]);
    assert.deepEqual(realReviewNotes([{ ticker: "WIFFIRE", symbol: "WIF" }]), ["$WIFFIRE burns real WIF, from its own burn pool; WIF's pool on Raydium is not ours and is not locked."]);
    assert.match(tile, /daysOf: flip \? null : `\$\{fieldA\.symbol\}'s`/);
    assert.match(tile, /notes=\{\[x\.window, x\.tie, \.\.\.realReviewNotes\(realList\)\]\}/);
    assert.match(page, /notes\.push\(\.\.\.realReviewNotes\(realOneList\)\);/);
  });
  test("the pre-wallet summary counts the pin: one more transaction, two signatures, the account's rent; idempotent", () => {
    const rv = buildLaunchReview({ rule: withRealBurn(SINGLE, realField(HELD, "devnet")), ticker: "WIFFIRE", name: "Wif Fire", raiseSol: "85" } as never, { env: ENV, reserved: new Set() });
    assert.ok("review" in rv); if (!("review" in rv)) return;
    const before = rv.review;
    const after = withPinSteps(before, [{ ticker: "WIFFIRE", symbol: "BONK" }]);
    assert.equal(after.transactions.count, before.transactions.count + 1);
    assert.deepEqual(after.transactions.steps.map((s) => s.label), [lockStepLabel("WIFFIRE"), pinStepLabel("WIFFIRE", "BONK")]);
    assert.ok(after.transactions.steps.every((s) => s.signers.includes("your wallet") && s.signers.includes("a new key made for this coin")));
    const added = rentLamports(BURN_TARGET_BYTES) + 2 * LAMPORTS_PER_SIGNATURE;
    assert.ok(Math.abs(Number(after.costs.totalSol) - (Number(before.costs.totalSol) + added / 1e9)) <= 0.00005, `${before.costs.totalSol} + ${added} lamports → ${after.costs.totalSol}`);
    assert.ok(Number(after.costs.totalSol) > Number(before.costs.totalSol));
    assert.equal(after.costs.lines.length, before.costs.lines.length + 2);
    assert.match(after.transactions.note, new RegExp(PIN_NOTE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.equal(withPinSteps(after, [{ ticker: "WIFFIRE", symbol: "BONK" }]), after, "counted once");
    assert.equal(withPinSteps(before, []), before);
    assert.match(after.recovery?.[0] ?? "", /asks 2 separate times/);
    // a review already counting several transactions has its count in the recovery line moved up too
    const three = { ...before, transactions: { ...before.transactions, count: 3, steps: [{ label: "Create $A and lock in its rule", signers: ["your wallet"] }, { label: "Create $B and lock in its rule", signers: ["your wallet"] }, { label: "Link the two coins", signers: ["your wallet"] }] }, recovery: ["Your wallet asks 3 separate times, once for each transaction, in the order above.", "x"] };
    assert.equal(withPinSteps(three, [{ ticker: "A", symbol: "WIF" }]).recovery![0], "Your wallet asks 4 separate times, once for each transaction, in the order above.");
    for (const s of [...after.transactions.steps.map((x) => x.label), ...after.costs.lines.slice(-2).map((x) => x.label), after.transactions.note]) plain(s);
    // a linked pair's side B keeps "and link the two coins" after its pin
    const pair = { ...before, transactions: { ...before.transactions, count: 2, steps: [{ label: "Create $A and lock in its rule", signers: ["your wallet"] }, { label: "Create $B and link the two coins", signers: ["your wallet"] }] } };
    assert.deepEqual(withPinSteps(pair, [{ ticker: "B", symbol: "WIF" }]).transactions.steps.map((s) => s.label), ["Create $A and lock in its rule", "Lock in $B's rule", "Pin WIF's Raydium pool for $B, then create $B and link the two coins"]);
    assert.match(tile, /<PreWalletSummary review=\{shown\.review \? withPinSteps\(shown\.review, realList\) : null\}/);
    assert.match(page, /<PreWalletSummary review=\{shownReview\.review \? withPinSteps\(shownReview\.review, realOneList\) : null\}/);
  });
});

describe("the coin page: receipts, held lines and the trust section", () => {
  const memo = formatTargetMemo({ prefix: "DEBT", recordDate: "2026-10-08", source: "pyth", prev: "1.00", now: "1.10", delta: "0.10", units: 3, pool: "1000000000", spent: "20000000", got: "1234", burn: "1234", target: BONK.mint, own: "0", swap: POOL.slice(0, 12), rulesSha12: "abcdefabcdef", version: "v3" });
  test("the browser-safe memo read agrees with the library's parseTargetMemo", () => {
    const lib = parseTargetMemo(memo)!;
    assert.ok(lib);
    assert.deepEqual(realMemoBurn(memo), { burn: lib.burn, mint: lib.target });
    assert.equal(realMemoBurn("DEBT|2026-10-08|src=x|v2"), null);
    assert.equal(realMemoBurn(null), null);
  });
  test("a receipt that burned the pinned token reads \"burned 1,234 real BONK\"; another mint or no field reads as before", () => {
    const f = ruleRealBurn(JSON.stringify(validateRule(withRealBurn(SINGLE, realField(HELD, "devnet")))));
    assert.equal(receiptRealLine(memo, f), "burned 1,234 real BONK");
    assert.equal(receiptRealLine(memo, null), null);
    assert.equal(receiptRealLine(memo, { ...f!, mint: POOL }), null);
    assert.equal(ruleRealBurn(JSON.stringify(SINGLE)), null);
    assert.equal(ruleRealBurn("not json"), null);
    assert.match(coin, /const rl = receiptRealLine\(b\.memo, real\);/);
  });
  test("a held crank says the library's held line; the trust section lists what such a burn can and cannot do", () => {
    const f = { mint: BONK.mint, pool: POOL, symbol: "BONK", feedId: BONK.feedId };
    assert.match(realHeldLine(f, "custom program error: TargetPoolBelowFloor (6042)") ?? "", /^BONK pool unhealthy: the pinned pool holds less SOL/);
    assert.equal(realHeldLine(f, "TwapDeviation"), null); assert.equal(realHeldLine(null, "TargetPoolUnhealthy"), null);
    assert.match(coin, /realHeldLine\(real, b\.skippedReason\)/);
    assert.match(coin, /const t = targetTrustCopy\(real\.symbol\);/);
    assert.match(coin, /t\.can\.map/); assert.match(coin, /t\.cannot\.map/);
    assert.ok(targetTrustCopy("BONK").cannot.some((s) => /not locked|belongs to its own liquidity providers/i.test(s)));
  });
});

describe("the page wiring and the words", () => {
  test("the choice is hidden until round 5; the waiting line from the launch state stands in its place", () => {
    assert.match(page, /<CoinVsCoinTile burnReal=\{site\.burnReal\} network=\{site\.cluster \?\? cluster\}/);
    assert.match(tile, /const realChoices = !a \|\| !b \? null : !realOn \? \(burnReal\?\.line \? <p [^>]*data-burn-real-waiting>\{burnReal\.line\}<\/p> : null\)/);
    assert.match(page, /const realOneOffered = site\.burnReal\.available && !pairOn && !!rule0 && !rule0\.vault;/);
    assert.match(page, /: site\.burnReal\.line \? <p [^>]*data-burn-real-waiting>\{site\.burnReal\.line\}<\/p> : null;/);
    // default off; one switch per Coin vs Coin side, the suggested tokens for a single coin
    assert.match(tile, /useState<SideReal>\(SIDE_REAL_OFF\), \[realB, setRealB\] = useState<SideReal>\(SIDE_REAL_OFF\)/);
    assert.match(tile, /<BurnRealChoice side="a" who=\{`\$\$\{TA\}`\} picks=\{\[pickA\]\}/);
    assert.match(tile, /<BurnRealChoice side="b" who=\{`\$\$\{TB\}`\} picks=\{\[pickB\]\}/);
    assert.match(page, /<BurnRealChoice side="one" [^>]*picks=\{SINGLE_REAL_PICKS\}/);
    assert.match(choice, /targetChoiceLabel\(picks\[0\]\.symbol\)/);
    assert.match(choice, /data-burn-real-verdict=\{a\.ok \? "held" : "refused"\}>\{a\.line\}/);
    // side B's own pinned token rides in `pair` (the review and the launch); the library must hash it (WIRING-ROUND5.md, left for the library)
    assert.equal((tile.match(/\.\.\.\(fieldB \? \{ burnTarget: fieldB \} : \{\}\)/g) ?? []).length, 2);
    // the preview gate stays: no new path around `blocked`
    assert.match(tile, /blocked=\{blocked \?\? \(reviewCurrent \? null : REVIEW_UPDATING\)\} \/>\}/);
  });
  test("Coin vs Coin's description stops saying the coins are never burned once a side burns its real coin", () => {
    assert.equal(realReadSentence({ a: "WIF", b: "BONK" }, [{ ticker: "WIFVBONK", symbol: "WIF" }]), "BONK is only read, never traded or burned. $WIFVBONK swaps SOL from its own burn pool for real WIF and burns it.");
    assert.equal(realReadSentence({ a: "WIF", b: "BONK" }, [{ ticker: "A", symbol: "WIF" }, { ticker: "B", symbol: "BONK" }]), "$A swaps SOL from its own burn pool for real WIF and burns it. $B swaps SOL from its own burn pool for real BONK and burns it.");
    plain(realReadSentence({ a: "WIF", b: "BONK" }, [{ ticker: "WIFVBONK", symbol: "WIF" }]));
    assert.match(tile, /model\.sentence\.replace\(derbyReadOnlySentence\(model\.spec\), realReadSentence\(/);
    assert.match(tile, /description: sentence!, imageUrl: null, rule: ruleA,/);
  });
  test("every new sentence passes the copy lint (no buy, price, will, target, dates, coming soon, payout)", () => {
    for (const s of [REAL_OFF_LINE, POOL_FIELD_LABEL, poolFieldHelp("BONK"), checkingLine("BONK"), noPoolLine("BONK"), realNotOffered("ETH"), PIN_NOTE, lockStepLabel("WIFFIRE"), pinStepLabel("WIFFIRE", "BONK", true), targetChoiceLabel("BONK"), targetActionSentence("BONK"), "Burn itself", "What burning the real BONK can and cannot do",
      "The two coins you pick are reference feeds. Burnticker reads their published feeds. By default it never trades or burns them; on the next step each side can choose to burn the real coin instead of itself. Launching creates two new coins, and their own trading fees pay for their burns."]) plain(s);
  });
});

describe("settled pairs: side B's describe context (base 449b3939)", () => {
  test("the Michigan pair's coin B reads its own race on the review, from the page's ctxB sent as pair.descCtx", () => {
    // the page's ctxB for two candidates: candidate B's question without "Will" and "?" (page.tsx ctxB)
    const questionB = "Will the Republicans win the Michigan Senate race?";
    const ctxB = { eventPhrase: questionB.replace(/^will\s+/i, "").replace(/\?$/, "") };
    const body = { rule: candidatesPairRule(`0x${"a1".repeat(32)}`), ticker: "ELSAVROGE", name: "El-Sayed MI", descCtx: { eventPhrase: "the Democrats win the Michigan Senate race" }, pair: { ticker: "ROGEVELSA", name: "Rogers MI", market: `0x${"b2".repeat(32)}`, race: "michigan-senate-election-winner", descCtx: ctxB } };
    const rv = buildLaunchReview(body as never, { env: { ...ENV, BURNTICKER_PAIR_CURVE_ENABLED: "1" }, reserved: new Set() });
    assert.ok("review" in rv); if (!("review" in rv)) return;
    assert.match(rv.review.settled!.descriptionB, /^\$ROGEVELSA burns if the Republicans win the Michigan Senate race\./);
    assert.match(page, /descCtx: ctxB \} \}/);
    assert.match(page, /const settledFields = settledPick \? \{ \.\.\.settledPairFields\(settledPick\), descCtx: ctxB \} : \{\};/);
    assert.match(page, /\{reviewSettled\.descriptionB\}<\/p><\/section>\}/);
  });
});
