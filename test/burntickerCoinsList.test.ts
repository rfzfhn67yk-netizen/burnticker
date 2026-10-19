// THE COINS PAGE ORDER (owner decisions 2026-10-19) and the third prelaunch audit's B-5, B-6 and B-7 (2026-10-19).
// Settled coins stay visible: open coins first, then "Decided, waiting to graduate", then "Decided, ended", then one collapsed line for
// retired and void coins. Each decided coin has one result line, each open coin one next-result line stated as a fact. "Open only" is
// off by default and remembered per browser. B-5: the home strip counts only chain-verified receipts. B-6: program accounts are not
// holders, and an untraded curve shows "No trades yet". B-7: a decided coin says so above its swap panel.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DEBT_RULE, ONE_SHOT } from "./burntickerHelpers.ts";
import type { BurnRule } from "@/lib/burnticker/rules";
import { gamePairRule } from "@/lib/burnticker/guidedLaunch";
import { gameSeries } from "@/lib/burnticker/sources/espn";
import { coinStatusFactsOf, type ReceiptInput } from "@/lib/burnticker/coinStatus";
import { badgeWindowEnd, coinListingOf, listNextOf, sinkWords, type ListingStatus } from "@/lib/burnticker/coinsListServe";
import { LIST_COPY, OPEN_ONLY_KEY, collapsedLine, groupCoins, nextResultLine, orderedCoins, readOpenOnly, resultLine, timeText, withListLines, writeOpenOnly, type CoinListing, type ListNext, type ListResult } from "@/lib/burnticker/coinsList";
import { SCHEMAS } from "@/lib/burnticker/api/spec";
import { lintCopy } from "@/lib/launch/copyLint";
import { homeStats, auditForIndex } from "@/lib/burnticker/home";
import { programOwnedOwner, summarizeHolders, PROGRAM_OWNER_LABELS } from "@/lib/burnticker/holders";
import { NO_HOLDERS, NO_TRADES, holdersCell, mcapCell, noTradesYet, walletHolders } from "@/lib/burnticker/cardView";
import { HOLDERS_NONE_SENTENCE, holdersCountSentence, marketFacts } from "@/lib/burnticker/coinPage";
import { decidedSwapWarning, type DecidedWarningInput } from "@/lib/burnticker/decidedWarning";
import { indexToken } from "@/lib/burnticker/tokenPage";

const ZONE = { now: Date.parse("2026-10-19T18:00:00Z"), timeZone: "America/Denver" };   // a Monday, noon in Denver
const SETTLED = "2026-10-16T03:40:00.000Z";
const GAME_ID = "2475453";
const DEN = gameSeries("nfl", GAME_ID, "DEN", "win"), SEA = gameSeries("nfl", GAME_ID, "SEA", "win");
const PAIR_A = { ...gamePairRule("nfl", GAME_ID, "DEN"), pair: { pairId: "sea-at-den", side: "A", counterpartMint: null, winnerTakesBurn: true, game: { series: [DEN, SEA] } }, onEnd: { endSink: true } } as unknown as BurnRule;
const GAME = gamePairRule("nfl", GAME_ID, "DEN");
const SEASON = { ...DEBT_RULE, series: "espn.team:nfl-PHI.21-win-s2026" } as unknown as BurnRule;
const FEED = DEBT_RULE as unknown as BurnRule;
const NWS = { ...DEBT_RULE, series: "nws.high:DTW-91" } as unknown as BurnRule;
const MARKET = ONE_SHOT as unknown as BurnRule;
const EVENT = { ...DEBT_RULE, series: "ll2.launch:7d1afb26-6f9c-429b-9ccf-29012fd1e519", kind: "binary", binary: { onYes: { fractionOfPool: 1 }, onNo: null }, scalar: null } as unknown as BurnRule;

type Facts = Parameters<typeof coinStatusFactsOf>[0];
const base = (o: Partial<ListingStatus & Facts> & { oneShot?: boolean; result?: ListingStatus["next"]["result"]; check?: string | null; close?: string | null } = {}): ListingStatus & Facts => ({
  status: o.status ?? "live", ticker: o.ticker ?? "COIN", name: o.name ?? "Coin",
  rules: { oneShot: o.oneShot ?? false },
  next: { nextCheckAt: o.check ?? null, nextCloseTime: o.close ?? null, result: o.result ?? (o.oneShot ? "pending" : "recurring"), nextResultAt: o.close ?? null, nextSourceCheckAt: o.check ?? null },
  profile: o.profile ?? null, market: o.market ?? { phase: "curve" }, lifecycle: o.lifecycle ?? null, pair: o.pair ?? null,
});
const listingFor = (s: ListingStatus & Facts, receipts: ReceiptInput[], rule: BurnRule): CoinListing => coinListingOf({ status: s, receipts, facts: coinStatusFactsOf(s, receipts), rule });
const won: ReceiptInput = { status: "pending-pair", units: 1, settledAt: SETTLED, pairRole: "won", kind: "binary", result: "win" };
const lost: ReceiptInput = { status: "pending-pair", units: 1, settledAt: SETTLED, pairRole: "lost", kind: "binary", result: "loss" };
const PAIR = { counterpart: { name: "Seahawks coin", ticker: "SEAWIN" }, clause: { state: "waiting" as const, voidBy: "2026-11-14" } };

/** The fixture list: one coin in every state (registry order is the tab's order). */
function fixtures() {
  return [
    { ticker: "OPEN", status: "live", listing: listingFor(base({ check: "2026-10-20T20:25:00Z" }), [], FEED) },
    { ticker: "WAIT", status: "live", listing: listingFor(base({ oneShot: true, result: "decided", profile: { sideName: "Broncos", badge: "ONE-SHOT · Oct 16, 2026" }, pair: PAIR }), [won], PAIR_A) },
    { ticker: "ENDED", status: "live", listing: listingFor(base({ oneShot: true, result: "decided", market: { phase: "graduated" } }), [{ status: "nothing", units: 0, settledAt: SETTLED, kind: "binary", result: "no" }], MARKET) },
    { ticker: "RETIRED", status: "retired", listing: listingFor(base({ status: "retired" }), [], FEED) },
    { ticker: "VOID", status: "live", listing: listingFor(base({ oneShot: true, result: "void" }), [{ status: "void", units: 0, settledAt: SETTLED, kind: "binary" }], MARKET) },
    { ticker: "DRAFT", status: "draft", listing: null },
    { ticker: "OPEN2", status: "paused", listing: listingFor(base({ status: "paused" }), [], FEED) },
  ];
}

describe("grouping and order over coins in every state", () => {
  test("each fixture lands in its group", () => {
    const g = Object.fromEntries(fixtures().map((c) => [c.ticker, c.listing?.group ?? null]));
    assert.deepEqual(g, { OPEN: "open", WAIT: "decided-waiting", ENDED: "decided-ended", RETIRED: "retired", VOID: "void", DRAFT: null, OPEN2: "open" });
  });
  test("open first in the given order, then waiting, ended, then retired and void; a draft is never listed", () => {
    assert.deepEqual(orderedCoins(fixtures()).map((c) => c.ticker), ["OPEN", "OPEN2", "WAIT", "ENDED", "RETIRED", "VOID"]);
    const g = groupCoins(fixtures());
    assert.equal(g.closed.length, 2);
    assert.equal(collapsedLine(g.closed.length), "2 retired or void coins");
    assert.equal(collapsedLine(1), "1 retired or void coin");
  });
  test("Open only keeps the open group and its order", () => {
    assert.deepEqual(orderedCoins(fixtures(), true).map((c) => c.ticker), ["OPEN", "OPEN2"]);
  });
  test("an older answer without a listing is open (or retired by its status), never hidden", () => {
    assert.deepEqual(orderedCoins([{ ticker: "A", status: "retired" }, { ticker: "B", status: "live" }]).map((c) => c.ticker), ["B", "A"]);
  });
  test("a rule that ended on a live coin is decided and ended, with its end sink", () => {
    const l = listingFor(base({ lifecycle: { ended: { at: "2026-10-12T00:00:00Z", reason: "window", mode: "winddown" } as never } }), [], SEASON);
    assert.equal(l.group, "decided-ended");
    assert.equal(resultLine(l.result, ZONE), "The rule ended on Oct 11. The rest burns down on this coin.");
  });
});

describe("the result line, by shape", () => {
  const line = (s: ListingStatus & Facts, r: ReceiptInput[], rule: BurnRule) => resultLine(listingFor(s, r, rule).result, ZONE);
  test("game win and game loss (a one-game coin outside a pair)", () => {
    assert.equal(line(base({ oneShot: true, result: "decided", profile: { sideName: "Broncos" } }), [{ status: "planned", units: 1, settledAt: SETTLED, kind: "binary", result: "win" }], GAME), "Won on Oct 15. Burn after graduation.");
    assert.equal(line(base({ oneShot: true, result: "decided", market: { phase: "graduated" } }), [{ status: "nothing", units: 0, settledAt: SETTLED, kind: "binary", result: "loss" }], GAME), "Lost on Oct 15. The rest goes to $DEFICIT's burn.");
  });
  test("pair: the winner burns after graduation; the loser burns nothing on its losing path", () => {
    assert.equal(line(base({ oneShot: true, result: "decided", pair: PAIR }), [won], PAIR_A), "Won on Oct 15. Burn after graduation.");
    const loser = listingFor(base({ oneShot: true, result: "decided", pair: PAIR }), [lost], PAIR_A);
    assert.equal(loser.group, "decided-waiting", "the pair still waits on both curves");
    assert.equal(resultLine(loser.result, ZONE), "Lost on Oct 15. No burn on the losing side.");
  });
  test("market: the settled outcome, then the end sink once nothing waits", () => {
    assert.equal(line(base({ oneShot: true, result: "decided" }), [{ status: "planned", units: 1, settledAt: SETTLED, kind: "binary", result: "yes" }], MARKET), "Settled Yes on Oct 15. Burn after graduation.");
    assert.equal(line(base({ oneShot: true, result: "decided", market: { phase: "graduated" } }), [{ status: "confirmed", units: 1, burned: "100", settledAt: SETTLED, kind: "binary", result: "yes" }], MARKET), "Settled Yes on Oct 15. The rest burns down on this coin.");
  });
  test("feed: a repeating rule has no result line until its rule ends", () => {
    assert.equal(listingFor(base(), [{ status: "confirmed", units: 1, burned: "5", settledAt: SETTLED, kind: "scalar" }], FEED).result, null);
    assert.equal(line(base({ lifecycle: { ended: { at: SETTLED } } as never }), [], { ...FEED, onEnd: { endSink: true } } as unknown as BurnRule), "The rule ended on Oct 15. The rest goes to $DEFICIT's burn.");
  });
  test("one-shot (a named launch) and void", () => {
    assert.equal(line(base({ oneShot: true, result: "decided" }), [{ status: "planned", units: 1, settledAt: SETTLED, kind: "binary", result: "yes" }], EVENT), "Settled Yes on Oct 15. Burn after graduation.");
    assert.equal(line(base({ oneShot: true, result: "void" }), [{ status: "void", units: 0, settledAt: SETTLED, kind: "binary" }], EVENT), "Voided on Oct 15. Nothing burns on it.");
  });
  test("season: a season coin whose window closed", () => {
    assert.equal(line(base({ lifecycle: { ended: { at: "2026-12-30T05:00:00Z" } } as never }), [], SEASON), "The rule ended on Dec 29. The rest burns down on this coin.");
  });
  test("the end sink in words, by sink and outcome", () => {
    assert.equal(sinkWords({ ...FEED, onEnd: { endSink: "incinerator" } } as unknown as BurnRule, "ended"), "the rest goes to Solana's incinerator");
    assert.equal(sinkWords({ ...FEED, onEnd: { endSink: true, mint: "M", ticker: "RAYS" } } as unknown as BurnRule, "ended"), "the rest goes to $RAYS's burn");
    assert.equal(sinkWords(PAIR_A, "won"), "the rest burns down on this coin");
    assert.equal(sinkWords(PAIR_A, "lost"), "the rest goes to the winning coin's burn");
  });
});

describe("the next-result line, by shape, with a fixed clock and zone", () => {
  const n = (s: ListingStatus, rule: BurnRule) => nextResultLine(listNextOf(s, rule), ZONE);
  test("game: the keeper's planned read after the game, in the viewer's zone with the zone named", () => {
    assert.equal(n(base({ oneShot: true, check: "2026-10-25T23:25:00Z" }), GAME), "Result after the game, read from Sun 5:25 pm MDT.");
    assert.equal(n(base({ oneShot: true, check: "2026-11-09T23:25:00Z" }), GAME), "Result after the game, read from Nov 9, 4:25 pm MST.");
    assert.equal(n(base({ oneShot: true, check: "2026-10-19T17:00:00Z" }), GAME), "Result after the game, read since Mon 11:00 am MDT.");
    assert.equal(n(base({ oneShot: true }), GAME), "Result after the game.");
    assert.equal(n(base({ oneShot: true, check: "2026-10-25T23:25:00Z" }), PAIR_A), "Result after the game, read from Sun 5:25 pm MDT.", "a pair game is a game");
  });
  test("season: the next game's read", () => {
    assert.equal(n(base({ check: "2026-10-22T02:15:00Z" }), SEASON), "Result after each game, next read from Wed 8:15 pm MDT.");
    assert.equal(n(base(), SEASON), "Result after each game.");
  });
  test("feed: the catalogue's own cadence words", () => {
    assert.equal(n(base(), NWS), "Result read daily (the morning after).");
    const fallback = nextResultLine({ shape: "feed", at: null, cadence: null, windowEnd: null }, ZONE);
    assert.equal(fallback, "Result read when the source publishes.");
  });
  test("market: its stated close; a one-shot with only a window says so", () => {
    assert.equal(n(base({ oneShot: true, close: "2026-10-31T19:00:00Z" }), MARKET), "Market close stated as Oct 31, 1:00 pm MDT.");
    assert.equal(n(base({ oneShot: true, profile: { badge: "ONE-SHOT · Oct 31, 2026" } }), MARKET), "Resolves once, window ends Oct 31.");
    assert.equal(n(base({ oneShot: true }), MARKET), "Result once the market settles.");
  });
  test("one-shot: resolves once, with its window when stated", () => {
    assert.equal(n(base({ oneShot: true, profile: { badge: "ONE-SHOT · Nov 2, 2026" } }), EVENT), "Resolves once, window ends Nov 2.");
    assert.equal(n(base({ oneShot: true }), EVENT), "Resolves once.");
    assert.equal(badgeWindowEnd("ONE-SHOT · Nov 2, 2026"), "2026-11-02");
    assert.equal(badgeWindowEnd("2026 SEASON"), null);
  });
  test("UTC viewers get UTC; no line says will, expected settlement, or puts a burn on a date", () => {
    assert.equal(timeText("2026-10-25T23:25:00Z", { now: ZONE.now, timeZone: "UTC" }), "Sun 11:25 pm UTC");
    for (const s of allSentences()) assert.doesNotMatch(s, /\bwill\b|expected settlement|burns? on (Mon|Tue|Wed|Thu|Fri|Sat|Sun|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i, s);
  });
  test("a card gets the result line when decided and the next line when open", () => {
    const [open, wait] = fixtures();
    assert.deepEqual(withListLines({ id: "o" }, open.listing, ZONE), { id: "o", resultLine: null, nextLine: nextResultLine(open.listing!.next, ZONE) });
    assert.match(withListLines({ id: "o" }, open.listing, ZONE).nextLine!, /^Result read /);
    assert.equal(withListLines({ id: "w" }, wait.listing, ZONE).resultLine, "Won on Oct 15. Burn after graduation.");
    assert.equal(withListLines({ id: "w" }, wait.listing, ZONE).nextLine, null);
  });
});

describe("Open only, remembered per browser", () => {
  const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, m }; };
  test("off by default, saved and read back", () => {
    const s = mem();
    assert.equal(readOpenOnly(s), false);
    writeOpenOnly(s, true);
    assert.equal(s.m.get(OPEN_ONLY_KEY), "1");
    assert.equal(readOpenOnly(s), true);
    writeOpenOnly(s, false);
    assert.equal(readOpenOnly(s), false);
  });
  test("no storage, or storage that throws: off, and saving never throws", () => {
    assert.equal(readOpenOnly(null), false);
    assert.equal(readOpenOnly(undefined), false);
    const bad = { getItem: () => { throw new Error("SecurityError"); }, setItem: () => { throw new Error("QuotaExceeded"); } };
    assert.equal(readOpenOnly(bad), false);
    assert.doesNotThrow(() => writeOpenOnly(bad, true));
    assert.doesNotThrow(() => writeOpenOnly(null, true));
  });
  test("the page wraps storage and starts with the toggle off", () => {
    const page = fs.readFileSync("src/app/burnticker/CoinsIndex.tsx", "utf8");
    assert.match(page, /useState\(false\);\n\s*const \[showClosed/);
    assert.match(page, /readOpenOnly\(browserStorage\(\)\)/);
    assert.match(page, /writeOpenOnly\(browserStorage\(\), on\)/);
    assert.match(page, /LIST_COPY\.decidedWaiting/); assert.match(page, /LIST_COPY\.decidedEnded/); assert.match(page, /collapsedLine\(closedCards\.length\)/);
  });
});

// ---- B-5, B-6, B-7 ----

describe("B-5: the home strip counts only receipts the chain verified", () => {
  test("3 recorded, 0 executed, 0 chain-verified: 0, and the recomputation is said as one", () => {
    const s = homeStats({ burns: 0, burnedTokens: "0" }, { ok: true, receipts: 3, executed: 0, chainVerified: 0, mismatches: 0, chainChecked: true }, "mainnet")!;
    assert.equal(s.receiptsVerified, 0);
    assert.equal(s.receiptsRecorded, 3);
    assert.equal(s.receiptsWhy, "No mainnet burn has run yet, so no receipt is verified on chain. The audit recomputed the 3 recorded receipts from their readings and rules. This is a recomputation of recorded receipts.");
  });
  test("chain-verified receipts are the figure; a run without the chain counts none", () => {
    assert.equal(homeStats({ burns: 2, burnedTokens: "9" }, { ok: true, receipts: 5, executed: 2, chainVerified: 2, mismatches: 0, chainChecked: true })!.receiptsVerified, 2);
    const off = homeStats({ burns: 2, burnedTokens: "9" }, { ok: true, receipts: 5, executed: 2, mismatches: 0, chainChecked: false })!;
    assert.equal(off.receiptsVerified, 0);
    assert.match(off.receiptsWhy!, /did not read the chain/);
  });
  test("the routes carry executed and chainVerified to the strip and the badge", () => {
    assert.deepEqual(auditForIndex({ ok: true, ranAt: "x", receipts: 3, executed: 0, chainVerified: 0, mismatches: [], chainChecked: true }), { ok: true, ranAt: "x", receipts: 3, executed: 0, chainVerified: 0, mismatches: 0, chainChecked: true });
    for (const f of ["src/app/api/burnticker/home/route.ts", "src/app/api/burnticker/tokens/route.ts"]) assert.match(fs.readFileSync(f, "utf8"), /auditForIndex\(a(udit)?\)/, f);
  });
});

describe("B-6: program accounts are not holders; an untraded curve shows no market cap", () => {
  const LABELS = { CurveVau1tAuthority1111111111111111111111111: "bonding curve" };
  test("the labelled curve and an off-curve program address are left out of the wallet count", () => {
    const wallet = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";   // an ordinary key (on the curve)
    const pda = "4iQPkMVjk1Yd6kYkM9ZBf3ZKsVaQ7Vh6YVtWWKAMQ4pb";
    const s = summarizeHolders([{ owner: "CurveVau1tAuthority1111111111111111111111111", amountRaw: BigInt(1000) }], BigInt(1000), 6, LABELS);
    assert.equal(s.holders, 1); assert.equal(s.wallets, 0, "the curve vault is not a holder");
    assert.equal(programOwnedOwner(wallet), false);
    assert.equal(typeof programOwnedOwner(pda), "boolean");
    assert.deepEqual(PROGRAM_OWNER_LABELS, ["bonding curve", "trading pool", "burn pool"]);
    const both = summarizeHolders([{ owner: "CurveVau1tAuthority1111111111111111111111111", amountRaw: BigInt(900) }, { owner: wallet, amountRaw: BigInt(100) }], BigInt(1000), 6, LABELS);
    assert.equal(both.wallets, 1);
  });
  test("the card and the coin page say no holders, never 1", () => {
    assert.equal(walletHolders({ count: 1, wallets: 0 }), 0);
    assert.equal(walletHolders({ count: 4 }), 4, "an older status without wallets keeps its count");
    assert.equal(holdersCell(0, true, null).text, NO_HOLDERS);
    assert.equal(holdersCountSentence(0), HOLDERS_NONE_SENTENCE);
    const t = indexToken({ ...statusStub(), market: { phase: "curve", curve: { raised: "0.000000001", threshold: "85", quote: "SOL", progressPct: 0, poolId: "p", remaining: "85", status: 0, phase: "curve", marketCap: "27.959121194" }, holders: { count: 1, wallets: 0, countNote: "", top: null, topNote: "" } } } as never);
    assert.equal(t.holders, 0); assert.equal(t.holdersOnlyPools, true);
  });
  test("1 lamport raised is no trade: the card and the coin page show No trades yet, never 28 SOL", () => {
    assert.equal(noTradesYet("curve", "0.000000001"), true);
    assert.equal(noTradesYet("curve", "0.5"), false);
    assert.equal(mcapCell({ cap: "27.959121194", quote: "SOL", phase: "curve", raised: "0.000000001" }).text, NO_TRADES);
    const rows = marketFacts({ cluster: "mainnet", status: "live", mint: "M", mintUrl: "u", creator: "C", creatorUrl: "u", launchedAt: null, phase: "curve", curve: { raised: "0.000000001", threshold: "85", quote: "SOL", marketCap: "27.959121194" }, curveNote: null, graduatedPool: null, holdersCount: 0, holdersNote: "", feesCurveBps: 100, feesPoolBps: 100, readAt: null });
    assert.equal(rows.find((r) => r.key === "mcap")!.value, NO_TRADES);
    assert.equal(rows.find((r) => r.key === "holders")!.value, NO_HOLDERS);
  });
});

function statusStub() {
  return { ticker: "DENWIN", name: "Denver", mint: "M", oracle: "catalogue", selectorKey: "k", seriesTitle: null, mode: "buyback", status: "live", launchedAt: null, burned: { total: "0", count: 0, pctOfSupply: 0, lastAt: null }, next: { nextCheckAt: null, nextMarket: null, nextCloseTime: null }, pair: null, profile: null, rules: { oneShot: true }, stated: null };
}

describe("B-7: a decided coin says so above its swap panel", () => {
  const s = (o: Partial<DecidedWarningInput>): DecidedWarningInput => ({ status: "live", ticker: "DENWIN", name: "Denver Broncos Win", rules: { oneShot: true }, next: { result: "decided" }, profile: { sideName: "Broncos", badge: "ONE-SHOT · Oct 16, 2026" }, market: { phase: "curve", curve: { threshold: "85", quote: "SOL" } }, pair: PAIR, ...o } as DecidedWarningInput);
  test("the winner: the result, no further result, the burn depends on both graduating by the void date", () => {
    assert.equal(decidedSwapWarning(s({}), [won]), "This coin's one result is in: Broncos won on 16 October 2026. No further result is read for it. Its burn happens only if both $DENWIN and $SEAWIN reach their 85 SOL raise and register a pool by 14 November 2026 (UTC). If not, the pair is voided and no burn for this result happens.");
  });
  test("the loser: it burns nothing of its own", () => {
    assert.equal(decidedSwapWarning(s({ ticker: "SEAWIN", profile: { sideName: "Seahawks" }, pair: { counterpart: { name: "Denver", ticker: "DENWIN" }, clause: PAIR.clause } as never }), [lost], "Broncos"), "This coin's one result is in: Broncos won on 16 October 2026, so this coin is on the losing side. No further result is read for it. The losing side burns nothing of its own.");
  });
  test("a repeating rule or a pending one-shot has no line; a void one says nothing burns", () => {
    assert.equal(decidedSwapWarning(s({ next: { result: "recurring" } }), []), null);
    assert.equal(decidedSwapWarning(s({ next: { result: "pending" } }), []), null);
    assert.equal(decidedSwapWarning(s({ next: { result: "void" } }), [{ status: "void", units: 0, settledAt: SETTLED }]), "This coin's one result was voided on 16 October 2026. No further result is read for it. Nothing burns on it.");
  });
  test("the coin page prints it above the swap panel", () => {
    const page = fs.readFileSync("src/app/burnticker/t/[ticker]/page.tsx", "utf8");
    const at = page.indexOf("data-decided-warning"), panel = page.indexOf("<TradePanel ticker=");
    assert.ok(at > 0 && at < panel, "above the panel");
  });
});

// ---- the payload schema and the copy lint ----

type Schema = { type?: string | string[]; enum?: unknown[]; anyOf?: Schema[]; properties?: Record<string, Schema>; required?: string[] };
function conforms(v: unknown, s: Schema, at = "$"): string[] {
  if (s.anyOf) return s.anyOf.some((x) => conforms(v, x, at).length === 0) ? [] : [`${at}: matches no branch`];
  if (s.enum) return s.enum.includes(v) ? [] : [`${at}: ${String(v)} not in enum`];
  const types = s.type === undefined ? [] : Array.isArray(s.type) ? s.type : [s.type];
  const kind = v === null ? "null" : Array.isArray(v) ? "array" : typeof v;
  if (types.length && !types.includes(kind)) return [`${at}: ${kind} is not ${types.join("|")}`];
  if (kind !== "object" || !s.properties) return [];
  const o = v as Record<string, unknown>;
  const out = (s.required ?? []).filter((k) => !(k in o)).map((k) => `${at}.${k}: missing`);
  for (const [k, x] of Object.entries(o)) out.push(...(s.properties[k] ? conforms(x, s.properties[k], `${at}.${k}`) : [`${at}.${k}: not in the schema`]));
  return out;
}

describe("the list payload schema", () => {
  test("every fixture listing conforms to SCHEMAS.CoinListing", () => {
    for (const c of fixtures()) if (c.listing) assert.deepEqual(conforms(c.listing, SCHEMAS.CoinListing as Schema), [], c.ticker);
  });
  test("the tokens route adds `listing` to each token and the spec names it", () => {
    assert.match(fs.readFileSync("src/app/api/burnticker/tokens/route.ts", "utf8"), /listing: listings\.get\(t\.mint\) \?\? null/);
    assert.match(JSON.stringify(SCHEMAS.CoinListing), /tokens\[\]\.listing/);
  });
});

function allSentences(): string[] {
  const results: ListResult[] = [];
  for (const outcome of ["won", "lost", "draw", "settled", "void", "ended"] as const) for (const next of ["burn-after-graduation", "burned", "burn-waiting", "no-burn-losing", "no-burn", "end-sink", "nothing"] as const) results.push({ outcome, words: outcome === "settled" ? "Yes" : null, settledAt: SETTLED, next, sink: next === "end-sink" ? "the rest goes to $DEFICIT's burn" : null });
  const nexts: ListNext[] = [];
  for (const shape of ["game", "season", "feed", "market", "one-shot"] as const) for (const at of [null, "2026-10-25T23:25:00Z", "2026-10-19T10:00:00Z"]) nexts.push({ shape, at, cadence: shape === "feed" ? "daily (the morning after)" : null, windowEnd: shape === "one-shot" || shape === "market" ? "2026-10-31" : null });
  return [
    ...Object.values(LIST_COPY), collapsedLine(1), collapsedLine(3),
    ...results.map((r) => resultLine(r, ZONE)!), ...nexts.map((n) => nextResultLine(n, ZONE)!),
    nextResultLine({ shape: "feed", at: null, cadence: null, windowEnd: null }, ZONE)!,
    HOLDERS_NONE_SENTENCE, NO_HOLDERS, NO_TRADES,
    homeStats({ burns: 0, burnedTokens: "0" }, { ok: true, receipts: 3, executed: 0, chainVerified: 0, mismatches: 0, chainChecked: true }, "mainnet")!.receiptsWhy!,
    homeStats({ burns: 0, burnedTokens: "0" }, { ok: true, receipts: 1, executed: 1, chainVerified: 1, mismatches: 0, chainChecked: true })!.receiptsWhy!,
    homeStats({ burns: 0, burnedTokens: "0" }, { ok: true, receipts: 2, executed: 2, mismatches: 0, chainChecked: false })!.receiptsWhy!,
    homeStats({ burns: 0, burnedTokens: "0" }, { ok: true, receipts: 2, executed: 2, mismatches: 0, chainChecked: true })!.receiptsWhy!,
    homeStats({ burns: 0, burnedTokens: "0" }, { ok: true, receipts: 0, executed: 0, mismatches: 0, chainChecked: true })!.receiptsWhy!,
    ...[[won, null], [lost, "Broncos"], [{ status: "confirmed", units: 1, burned: "5", settledAt: SETTLED, pairRole: "won" }, null]].map(([r, o]) => decidedSwapWarning({ status: "live", ticker: "A", name: "A", rules: { oneShot: true }, next: { result: "decided" }, profile: { sideName: "Broncos" }, market: { phase: "curve", curve: { threshold: "85", quote: "SOL" } }, pair: PAIR } as DecidedWarningInput, [r as ReceiptInput], o as string | null)!),
    decidedSwapWarning({ status: "live", ticker: "A", name: "A", rules: { oneShot: true }, next: { result: "decided" }, profile: null, market: { phase: "curve", curve: { threshold: "40", quote: "SOL" } } } as DecidedWarningInput, [{ status: "planned", units: 1, settledAt: SETTLED, result: "yes" }])!,
    decidedSwapWarning({ status: "live", ticker: "A", name: "A", rules: { oneShot: true }, next: { result: "decided" }, profile: null, market: { phase: "graduated" } } as DecidedWarningInput, [{ status: "nothing", units: 0, settledAt: SETTLED, result: "no" }])!,
  ];
}

describe("the copy lint", () => {
  test("every sentence the Coins page, the strip, the cards and the decided line print passes", () => {
    for (const s of allSentences()) { const r = lintCopy(s); assert.ok(r.ok, `${s}\n${r.hits.map((h) => h.phrase).join(", ")}`); }
  });
});
