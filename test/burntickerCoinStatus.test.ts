// COIN CARD STATUS (2026-10-18, the owner's UX walkthrough): every card answers "what happens next" in one status sentence chosen by
// the coin's state (coinStatus.ts). The facts come from a coin's status.json and receipts; the sentence is a pure function of the facts,
// so the embed and share text can reuse it. Every sentence passes the copy lint.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { formatHits, lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import { ruleReadingDirection, ruleSideName } from "@/lib/burnticker/coinCard";
import { TEAM_ALIASES } from "@/lib/burnticker/oracle/events";
import { teamSeries } from "@/lib/burnticker/sources/espn";
import type { BurnRule } from "@/lib/burnticker/rules";
import { DECIDED_TAILS, END_KINDS, STATUS_SENTENCES, readingSentence, coinStatusFactsOf, coinStatusSentence, dayInWords, sideOf, windowOf, type ReceiptInput, type StatusInput } from "@/lib/burnticker/coinStatus";

const cfg = loadCopyLintConfig();
const clean = (t: string) => { const r = lintCopy(t, cfg); assert.ok(r.ok, `${t}\n${formatHits(r)}`); };

const base: StatusInput = {
  status: "live", ticker: "BRONCOS", name: "Broncos Win", rules: { oneShot: false }, profile: { badge: "2026 SEASON", oneLiner: "burns when the Broncos win", sideName: "Broncos" },
  market: { phase: "graduated" }, program: { initialized: true, pool: { registered: false } }, pair: null, lifecycle: { ended: null },
};
const oneShotPair: StatusInput = { ...base, market: { phase: "curve" }, rules: { oneShot: true }, profile: { badge: "ONE-SHOT · Oct 19, 2026", oneLiner: "burns if the Broncos win this game", sideName: "Broncos" }, pair: { counterpart: { name: "Chiefs Win" }, clause: { state: "live" } } };
const CHIEFS = { profile: { sideName: "Chiefs" } };
const r = (x: Partial<ReceiptInput>): ReceiptInput => ({ status: "planned", units: 1, settledAt: "2026-10-19T23:00:00Z", burned: null, pairRole: null, ...x });
const say = (s: StatusInput, rs: ReceiptInput[] = [], other: { profile: { sideName: string } } | null = CHIEFS) => coinStatusSentence(coinStatusFactsOf(s, rs, other));

describe("the status sentence, one per state", () => {
  test("decided one-shot, the winning side: the decision, then what its burn waits for", () => {
    assert.equal(say(oneShotPair, [r({ pairRole: "won" })]), "Decided: Broncos won. Burns once the curve fills.");
    assert.equal(say({ ...oneShotPair, market: { phase: "graduated" } }, [r({ pairRole: "won", status: "skipped" })]), "Decided: Broncos won. Burns once its trading pool is registered.");
    assert.equal(say({ ...oneShotPair, market: { phase: "graduated" }, program: { initialized: true, pool: { registered: true } } }, [r({ pairRole: "won", status: "sending" })]), "Decided: Broncos won. The burn is being sent.");
    assert.equal(say({ ...oneShotPair, market: { phase: "graduated" } }, [r({ pairRole: "won", status: "confirmed", burned: "1234.5" })]), "Decided: Broncos won. Last burn 1,234.5 $BRONCOS on October 19.");
  });
  test("\"registered\" only when the program was read; an unread program says so (review L3)", () => {
    const grad = { ...oneShotPair, market: { phase: "graduated" as const } };
    assert.equal(say({ ...grad, program: { initialized: true, pool: { registered: false } } }, [r({ pairRole: "won", status: "skipped" })]), "Decided: Broncos won. Burns once its trading pool is registered.");
    assert.equal(say({ ...grad, program: null }, [r({ pairRole: "won", status: "skipped" })]), "Decided: Broncos won. The pool state has not been read yet.");
    assert.equal(say({ ...grad, program: { initialized: true, pool: { registered: true } } }, [r({ pairRole: "won", status: "skipped" })]), "Decided: Broncos won. The burn is on hold.");
  });
  test("a full curve moving to its pool does not wait for the curve (review L2)", () => {
    assert.equal(say({ ...oneShotPair, market: { phase: "migrating" } }, [r({ pairRole: "won" })]), "Decided: Broncos won. Burns once its trading pool opens.");
    assert.doesNotMatch(say({ ...oneShotPair, market: { phase: "migrating" } }, [r({ pairRole: "won" })]), /curve fills/);
  });
  test("decided one-shot, the losing side: the other coin won and this one does not burn", () => {
    assert.equal(say(oneShotPair, [r({ pairRole: "lost", status: "forwarded", units: 1 })]), "Decided: Chiefs won. Its pool goes to the winning coin.");
    assert.equal(say(oneShotPair, [r({ pairRole: "lost", status: "nothing", units: 0 })]), "Decided: Chiefs won. $BRONCOS lost, so this result cannot make it burn."); // HB-109 (hourly run 8)
    // review M1: nothing of the losing coin burns; its pool goes to the winner (never "burns down a little each day")
    assert.equal(say({ ...oneShotPair, lifecycle: { ended: { mode: "winddown" } } }, [r({ pairRole: "lost", status: "nothing", units: 0 })]), "Decided: Chiefs won. Its pool goes to the winning coin.");
    assert.equal(say({ ...oneShotPair, lifecycle: { ended: { mode: "drain" } } }, [r({ pairRole: "lost", status: "nothing", units: 0 })]), "Decided: Chiefs won. Its pool goes to the winning coin.");
    // a one-shot outside a pair still burns its own pool down after its rule ends
    assert.equal(say({ ...oneShotPair, pair: null, lifecycle: { ended: { mode: "winddown" } } }, [r({ status: "nothing", units: 0, result: "no" })]), "Decided: Broncos lost. Its burn pool winds down once the coin graduates.");   // HB-50: still on its curve
    assert.equal(say({ ...oneShotPair, market: { phase: "graduated" }, pair: null, lifecycle: { ended: { mode: "winddown" } } }, [r({ status: "nothing", units: 0, result: "no" })]), "Decided: Broncos lost. Its burn pool now burns down a little each day.");
    assert.equal(say(oneShotPair, [r({ pairRole: "draw", status: "nothing", units: 0 })]), "Decided: a draw. This coin does not burn on it.");
    assert.equal(say(oneShotPair, [r({ status: "void", units: 0 })]), "Decided: the result was voided. Nothing burns on it.");
    // a one-shot outside a pair has no other side to name
    assert.equal(say({ ...oneShotPair, pair: null }, [r({ status: "nothing", units: 0 })]), "Decided: the result is in. This coin does not burn on it.", "no result word recorded");
  });
  test("the decision names the winning SIDE from the rule, never the coin's name (review H2)", () => {
    // the coin is "Broncos Win"; the sentence says "Broncos"
    assert.equal(say(oneShotPair, [r({ pairRole: "won" })]), "Decided: Broncos won. Burns once the curve fills.");
    assert.doesNotMatch(say(oneShotPair, [r({ pairRole: "won" })]), /Broncos Win|Chiefs Win/);
    // the losing side without the other coin's status says its own side lost
    assert.equal(say(oneShotPair, [r({ pairRole: "lost", status: "nothing", units: 0 })], null), "Decided: Broncos lost. This coin does not burn on it.");
    // no side name at all (a market pair): never a coin name
    const market = { ...oneShotPair, profile: { badge: "ONE-SHOT", oneLiner: "burns when X settles YES", sideName: null } };
    assert.equal(say(market, [r({ pairRole: "won" })], null), "Decided: the result is in. Burns once the curve fills.");
    // a one-shot outside a pair: a team leg names its team; a market names its outcome word
    const leg = { ...oneShotPair, pair: null };
    assert.equal(say(leg, [r({ result: "yes", status: "nothing", units: 0 })]), "Decided: Broncos won. This coin does not burn on it.");
    assert.equal(say(leg, [r({ result: "no", units: 1 })]), "Decided: Broncos lost. Burns once the curve fills.");
    const poly = { ...market, pair: null };
    assert.equal(say(poly, [r({ result: "YES", units: 1 })]), "Decided: the market settled Yes. Burns once the curve fills.");
    assert.equal(say(poly, [r({ result: "no", status: "nothing", units: 0 })]), "Decided: the market settled No. This coin does not burn on it.");
    assert.equal(say(poly, [r({ result: "Arsenal", units: 1 })]), "Decided: the market settled on Arsenal. Burns once the curve fills.");
    assert.equal(say(poly, [r({ result: "0x9f3c…", status: "nothing", units: 0 })]), "Decided: the result is in. This coin does not burn on it.");
  });
  test("the side name comes from the locked rule's selector: an ESPN team series, a Kalshi team leg or one game's leg", () => {
    const den = TEAM_ALIASES.find((a) => a.league === "NFL" && a.nickname === "Broncos")!;
    const rule = (x: Partial<BurnRule>) => ({ kind: "binary", binary: { onYes: { fractionOfPool: 1 } }, market: null, series: null, ...x }) as unknown as BurnRule;
    assert.equal(ruleSideName(rule({ oracle: "catalogue", series: teamSeries("nfl", "DEN", "win") } as Partial<BurnRule>)), "Broncos");
    assert.equal(ruleSideName(rule({ oracle: "kalshi", series: den.series, filter: { tickerIncludes: `-${den.abbr}` } } as Partial<BurnRule>)), "Broncos");
    assert.equal(ruleSideName(rule({ oracle: "kalshi", market: `${den.series}-26OCT19${den.abbr}KC-${den.abbr}` } as Partial<BurnRule>)), "Broncos");
    assert.equal(ruleSideName(rule({ oracle: "polymarket", market: "0xabc" } as Partial<BurnRule>)), null);
  });
  test("pending pair: the result counts, and the burn waits on both coins' pools", () => {
    assert.equal(say({ ...oneShotPair, market: { phase: "graduated" } }, [r({ pairRole: "won", status: "pending-pair" })]), "Decided: Broncos won. Burns once both coins in the pair have a trading pool.");
    assert.equal(say({ ...oneShotPair, pair: { counterpart: { name: "Chiefs" }, clause: { state: "waiting" } } }), STATUS_SENTENCES.waitingPair);
  });
  test("waiting one-shot: no reading yet", () => {
    assert.equal(say(oneShotPair), "Waiting for the market to settle.");
    assert.equal(say({ ...base, rules: { oneShot: true }, profile: { badge: null, oneLiner: "burns when the market settles YES" } }), "Waiting for the market to settle.");
  });
  test("season, postseason and next-games coins name the side they burn on", () => {
    assert.equal(say(base), "Burns after each win this season.");
    assert.equal(say({ ...base, profile: { badge: "2026 SEASON", oneLiner: "burns when the Rays lose" } }), "Burns after each loss this season.");
    assert.equal(say({ ...base, profile: { badge: "2026 SEASON", oneLiner: "burns when Arsenal win or draw" } }), "Burns after each result that counts this season.");
    assert.equal(say({ ...base, profile: { badge: "POSTSEASON 2026", oneLiner: "burns when the Rays lose" } }), "Burns after each loss this postseason.");
    assert.equal(say({ ...base, profile: { badge: "NEXT 3 GAMES · ENDS Nov 2, 2026", oneLiner: "burns when the Rays win" } }), "Burns after each win in its next 3 games.");
  });
  test("a season or perpetual coin still on its curve says both facts in one sentence", () => {
    const curve = { ...base, market: { phase: "curve" as const } };
    assert.equal(say(curve), "Burns after each win this season, once the curve fills.");
    assert.equal(say({ ...curve, profile: { badge: "POSTSEASON 2026", oneLiner: "burns when the Rays lose" } }), "Burns after each loss this postseason, once the curve fills.");
    assert.equal(say({ ...curve, profile: { badge: "NEXT 3 GAMES", oneLiner: "burns when the Rays win" } }), "Burns after each win in its next 3 games, once the curve fills.");
    assert.equal(say({ ...curve, profile: { badge: "PERPETUAL", oneLiner: "burns on the Treasury debt feed" } }), "Burns on each new reading once the curve fills.");
    assert.equal(say({ ...curve, profile: { badge: "PERPETUAL", oneLiner: "burns when the Rays lose" } }), "Burns after each loss, once the curve fills.");
    // moving to its pool (the curve is full) or not read: the plain form
    assert.equal(say({ ...base, market: { phase: "migrating" } }), "Burns after each win this season.");
    assert.equal(say({ ...base, market: null }), "Burns after each win this season.");
  });
  test("a reading coin that counts only a rise says so, with the curve clause on its curve (review L1)", () => {
    const deficit = { ...base, ticker: "DEFICIT", name: "Deficit", profile: { badge: "PERPETUAL", oneLiner: "burns on the Treasury debt feed", sideName: null, readingDirection: "up" as const } };
    assert.equal(say({ ...deficit, market: { phase: "curve" } }), "Burns on each new reading that rises once the curve fills.");
    assert.equal(say({ ...deficit, market: { phase: "graduated" } }), "Burns on each new reading that rises.");
    assert.equal(say({ ...deficit, profile: { ...deficit.profile, readingDirection: "down" as const } }), "Burns on each new reading that falls.");
    assert.equal(readingSentence("up", true), "Burns on each new reading that rises once the curve fills.");
    // the featured $DEFICIT fallback (no registry facts) carries the same words
    assert.match(fs.readFileSync("src/lib/burnticker/home.ts", "utf8"), /: readingSentence\("up", \(readable \? live!\.phase \?\? null : kc\?\.phase \?\? null\) === "curve"\),/);
    const rr = (x: object) => ({ kind: "scalar", oracle: "catalogue", series: "treasury.debt", scalar: { unit: 1, perUnit: { fractionOfPool: 0.02 }, baseline: "previousSettlement", direction: "up" }, ...x }) as unknown as BurnRule;
    assert.equal(ruleReadingDirection(rr({})), "up"); assert.equal(ruleReadingDirection(rr({ inverse: true })), null);
    assert.equal(ruleReadingDirection(rr({ series: teamSeries("nfl", "DEN", "win") })), null, "a team's count is not a reading");
  });
  test("a fade coin reads its side as \"do not win\" (review M2)", () => {
    const fade = { ...base, market: { phase: "curve" as const }, profile: { badge: "2026 SEASON", oneLiner: "burns on every game day the Eagles do not win", sideName: "Eagles" } };
    assert.equal(say(fade), "Burns after each game the Eagles do not win this season, once the curve fills.");
    assert.equal(say({ ...fade, market: { phase: "graduated" as const } }), "Burns after each game the Eagles do not win this season.");
    assert.equal(say({ ...fade, profile: { ...fade.profile, badge: "PERPETUAL", oneLiner: "burns on every game day Arsenal do not lose" } }), "Burns after each game Arsenal do not lose, once the curve fills.");
    assert.equal(sideOf("burns on every game day the Eagles do not win"), "not");
    assert.equal(sideOf("burns on every game day the Eagles do not win in the postseason"), "not");
  });
  test("perpetual coins: each new reading, or each win or loss for a team coin", () => {
    assert.equal(say({ ...base, profile: { badge: "PERPETUAL", oneLiner: "burns on the Treasury debt feed" } }), "Burns on each new reading.");
    assert.equal(say({ ...base, profile: { badge: "PERPETUAL", oneLiner: "burns when the Rays lose" } }), "Burns after each loss.");
    assert.equal(say({ ...base, profile: null }), "Burns on each new reading.");
  });
  test("live with receipts: the last burn, its size and day in words", () => {
    assert.equal(say(base, [r({ status: "confirmed", burned: "4010874.872", settledAt: "2026-10-12T03:00:00Z" }), r({ status: "nothing", units: 0, settledAt: "2026-10-14T03:00:00Z" })]), "Last burn 4,010,874.87 $BRONCOS on October 12.");
  });
  test("retired, paused, a rule that ended, a draft", () => {
    assert.equal(say({ ...base, status: "retired" }, [r({ status: "confirmed", burned: "5" })]), "Retired. No new result burns it.");
    assert.equal(say({ ...base, status: "paused" }), "Paused. Burns wait until the operator resumes it.");
    assert.equal(say({ ...base, lifecycle: { ended: { mode: "winddown" } } }), "The rule has ended. Its burn pool burns down a little each day.");
    assert.equal(say({ ...base, lifecycle: { ended: { mode: "drain" } } }), "The rule has ended. Its burn pool is being spent down.");
    assert.equal(say({ ...base, status: "draft" }), "Not launched yet.");
  });
});

describe("end-of-rule receipts are not the decision (review H1)", () => {
  // SEAWIN / DENWIN: the pair gate stopped waiting, the result is in, and the keeper's drain receipts follow on both sides
  const drain = (x: Partial<ReceiptInput>) => r({ kind: "drain", settledAt: "2026-10-21T00:00:00Z", status: "planned", units: 1, ...x });
  test("the losing side still reads as the losing side, with drain receipts newer than its result", () => {
    const lost = r({ pairRole: "lost", status: "forwarded", units: 1, kind: "binary" });
    const said = say(oneShotPair, [lost, drain({}), drain({ settledAt: "2026-10-22T00:00:00Z", status: "sending" })]);
    assert.doesNotMatch(said, /Burns once the curve fills|The burn is being sent/);
    assert.equal(said, say(oneShotPair, [lost]));
  });
  test("the winning side keeps its decision and its hold, with drain receipts present", () => {
    const won = r({ pairRole: "won", status: "planned", kind: "binary" });
    assert.equal(say(oneShotPair, [won, drain({ status: "confirmed", burned: "10" })]).startsWith(say(oneShotPair, [won]).split(".")[0]), true);
    assert.equal(coinStatusFactsOf(oneShotPair, [won, drain({})]).decision?.outcome, "this");
    assert.equal(coinStatusFactsOf(oneShotPair, [won, drain({ kind: "sweep" }), drain({ kind: "winddown" })]).decision?.hold, "curve");
  });
  test("the keeper's END_KINDS and this copy are the same set", () => {
    const src = fs.readFileSync("src/lib/burnticker/multiKeeper.ts", "utf8");
    const m = /export const END_KINDS: ReadonlySet<string> = new Set\((\[[^\]]*\])\)/.exec(src);
    assert.ok(m); assert.deepEqual(JSON.parse(m![1]).sort(), [...END_KINDS].sort());
  });
});

describe("the facts", () => {
  test("window and side readers", () => {
    assert.deepEqual(windowOf("ONE-SHOT · Oct 31, 2026", false), { window: "one-shot", games: null });
    assert.deepEqual(windowOf(null, true), { window: "one-shot", games: null });
    assert.deepEqual(windowOf("NBA 2026-27 SEASON SERIES", false), { window: "season", games: null });
    assert.deepEqual(windowOf("NEXT 1 GAME", false), { window: "games", games: 1 });
    assert.deepEqual(windowOf(undefined, false), { window: "perpetual", games: null });
    assert.equal(sideOf("burns when the Eagles lose"), "lose"); assert.equal(sideOf("burns if the Eagles win this game"), "win");
    assert.equal(sideOf("burns when the Eagles win or lose"), null); assert.equal(sideOf("burns on the feed"), null);
    assert.equal(dayInWords("2026-10-06"), "October 6"); assert.equal(dayInWords("not a day"), null);
  });
  test("the facts are JSON-safe, so a route can send them and the client builds the same sentence", () => {
    const f = coinStatusFactsOf(oneShotPair, [r({ pairRole: "won" })]);
    assert.equal(coinStatusSentence(JSON.parse(JSON.stringify(f))), coinStatusSentence(f));
  });
});

describe("words", () => {
  test("every sentence the builder can say passes the copy lint, and none says buy, price, will, payout, target or coming soon", () => {
    const all = [...Object.values(STATUS_SENTENCES), ...Object.values(DECIDED_TAILS),
      "Decided: Broncos won.", "Decided: Broncos lost.", "Decided: the market settled Yes.", "Decided: the market settled No.", "Decided: the market settled on Arsenal.", "Decided: a draw.", "Decided: the result was voided.", "Decided: the result is in.",
      "Burns after each win this season.", "Burns after each loss this season.", "Burns after each result that counts this season.",
      "Burns after each win this postseason.", "Burns after each loss in its next 3 games.", "Burns after each win in its next game.",
      "Last burn 4,010,874.87 $BRONCOS on October 12.", "Decided: Broncos won. Burns once the curve fills.", "Decided: Broncos won. Burns once its trading pool opens.", "Decided: Broncos won. The pool state has not been read yet.",
      "Burns after each win this season, once the curve fills.", "Burns after each loss this postseason, once the curve fills.", "Burns after each win in its next 3 games, once the curve fills.",
      "Burns on each new reading once the curve fills.", "Burns on each new reading that rises once the curve fills.", "Burns on each new reading that rises.", "Burns on each new reading that falls once the curve fills.", "Burns after each game the Eagles do not win this season, once the curve fills.", "Burns after each game Arsenal do not lose, once the curve fills.", "Burns after each loss, once the curve fills.", "Burns after each result that counts this season, once the curve fills."];
    for (const t of all) { clean(t); assert.doesNotMatch(t, /\b(buy|price|will|payout|target|prize)\b|coming soon|→|—/i, t); }
  });
});
