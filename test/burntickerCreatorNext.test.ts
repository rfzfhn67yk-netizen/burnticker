// AUDIT 7 · F08 and the creator aggregation (2026-10-19).
// F08: the token status producer set rules.oneShot from !!rule.market, so a one-game catalogue coin (no market) was not one-shot and the
// creator page showed the keeper's next poll of the source as a new "Next result" for a decided game (the live DENWIN: a one-game pair
// result settled 2026-10-16, waiting for graduation). One-shot-ness is now rules.ts isOneShot everywhere; the status JSON separates the
// next result from the next source check; the creator views say decided, voided or the next result, with the source check on its own row.
// Aggregation: the summary is a registry-only projection, the detail has bounded concurrency, a per-coin bound, an end-to-end deadline
// and a short memo, and a failing coin is listed as unavailable instead of making the account look empty.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { CREATOR, ATTESTER, makeWorld, type World } from "./burntickerApiHelpers.ts";
import { BRONCOS, DEBT_RULE, NOW, ONE_SHOT } from "./burntickerHelpers.ts";
import { isOneShot, type BurnRule } from "@/lib/burnticker/rules";
import { gamePairRule } from "@/lib/burnticker/guidedLaunch";
import { gameSeries } from "@/lib/burnticker/sources/espn";
import { buildLaunchBundle, FakeLaunchLab } from "@/lib/burnticker/launchBundle";
import { tokenPageData } from "@/lib/burnticker/server";
import { nextTimes, type ResultReceipt } from "@/lib/burnticker/nextResult";
import { CREATOR_PAGE, DECIDED, DECIDED_BURNED, DECIDED_VOID, DECIDED_WAITING } from "@/lib/burnticker/creatorBenefits";
import { boundedMap, creatorData, creatorNextFields, creatorSummary, type CoinDetail } from "@/lib/burnticker/creatorServe";
import { KeyedSwr } from "@/lib/burnticker/keyedSwr";
import { lintCopy } from "@/lib/launch/copyLint";
import type { TokenRow } from "@/lib/burnticker/registry";

const GAME_ID = "2475453";   // Seattle Seahawks at Denver Broncos, 2026-10-16 (the DENWIN/SEAWIN game)
const DEN = gameSeries("nfl", GAME_ID, "DEN", "win"), SEA = gameSeries("nfl", GAME_ID, "SEA", "win");
const GAME = gamePairRule("nfl", GAME_ID, "DEN");
const PAIR_GAME = { ...GAME, pair: { pairId: "sea-at-den", side: "A", counterpartMint: null, winnerTakesBurn: true, game: { series: [DEN, SEA] } } } as unknown as BurnRule;
const EVENT = { oracle: "catalogue", market: null, series: "ll2.launch:artemis-ii", derby: undefined } as unknown as BurnRule;
const DERBY = { oracle: "derby", market: null, series: null, derby: { selector: "coinvs", flip: true } } as unknown as BurnRule;
const CHECK = "2026-10-20T00:00:00.000Z";
const SETTLED = "2026-10-16T03:40:00.000Z";

describe("F08 · one-shot-ness is rules.ts isOneShot", () => {
  test("game, pair game, market, catalogue event and derby flip are one-shot; a series is not", () => {
    for (const [name, r] of [["game", GAME], ["pair game (DENWIN)", PAIR_GAME], ["market", ONE_SHOT], ["catalogue event", EVENT], ["derby flip", DERBY]] as const) assert.equal(isOneShot(r as BurnRule), true, name);
    assert.equal(GAME.market, null, "the bug's shape: a one-game catalogue rule has no market");
    for (const r of [BRONCOS, DEBT_RULE]) assert.equal(isOneShot(r as unknown as BurnRule), false);
  });
  test("no producer or creator file re-derives one-shot-ness by hand", () => {
    for (const f of ["src/lib/burnticker/tokenPage.ts", "src/lib/burnticker/coinPage.ts", "src/lib/burnticker/creatorServe.ts"]) assert.doesNotMatch(fs.readFileSync(f, "utf8"), /oneShot: !!rule\.market|oneShot = !!r\.market/, f);
  });
});

/** What the producer writes for one coin (the same helpers tokenPage.ts uses), as the creator view reads it. */
const statusOf = (rule: BurnRule, receipts: readonly ResultReceipt[], o: { close?: string | null; phase?: string } = {}) => {
  const oneShot = isOneShot(rule), nextCloseTime = o.close ?? null;
  return { rules: { oneShot } as never, next: { nextCheckAt: CHECK, impliedChance: null, impliedBasis: null, nextMarket: null, nextCloseTime, awaitingFinal: 0, ...nextTimes({ oneShot, receipts, nextCloseTime, nextCheckAt: CHECK }) }, market: { phase: o.phase ?? "curve" } };
};
const result = (status: string) => [{ status, kind: "scalar", settledAt: SETTLED }];

describe("F08 · producer to creator view, every one-shot kind in every state", () => {
  const now = Date.parse("2026-10-19T12:00:00Z");
  for (const [name, rule] of [["game", GAME], ["pair game", PAIR_GAME], ["market", ONE_SHOT], ["catalogue event", EVENT], ["derby flip", DERBY]] as const) {
    test(`${name}: pending shows no source poll as a result; decided and voided never show a new result date`, () => {
      const pending = creatorNextFields(statusOf(rule as BurnRule, []), [], now);
      assert.equal(pending.result, "pending"); assert.equal(pending.nextAt, null);
      assert.equal(pending.nextLine, CREATOR_PAGE.noNext, "the next poll of the source is not a result");
      // hourly run 7, HB-98: the check is a time in Denver time with its zone (00:00 UTC on Oct 20 is 6 PM MDT on Oct 19), never the UTC day
      assert.equal(pending.nextCheckLine, "About Oct 19, 2026, 6:00 PM MDT", "the poll has its own row");
      const closing = creatorNextFields(statusOf(rule as BurnRule, [], { close: "2026-10-25T00:00:00Z" }), [], now);
      assert.equal(closing.nextLine, "25 October 2026", "a scheduled close is the next result");

      // the DENWIN shape: decided (a settled result receipt), waiting for graduation
      const waiting = creatorNextFields(statusOf(rule as BurnRule, result("planned")), result("planned"), now);
      assert.deepEqual([waiting.result, waiting.nextAt, waiting.nextLine, waiting.nextCheckAt, waiting.nextCheckLine], ["decided", null, DECIDED_WAITING, null, null]);
      for (const st of ["pending-pair", "forwarded"]) assert.equal(creatorNextFields(statusOf(rule as BurnRule, result(st)), result(st), now).nextLine, DECIDED_WAITING, st);
      assert.equal(creatorNextFields(statusOf(rule as BurnRule, result("planned"), { phase: "graduated" }), result("planned"), now).nextLine, DECIDED);
      const burned = creatorNextFields(statusOf(rule as BurnRule, result("confirmed"), { phase: "graduated" }), result("confirmed"), now);
      assert.deepEqual([burned.result, burned.nextLine, burned.nextCheckLine], ["decided", DECIDED_BURNED, null]);
      for (const st of ["void", "voided"]) {
        const v = creatorNextFields(statusOf(rule as BurnRule, result(st), { close: "2026-10-25T00:00:00Z" }), result(st), now);
        assert.deepEqual([v.result, v.nextAt, v.nextLine, v.nextCheckLine], ["void", null, DECIDED_VOID, null], st);
      }
      // the end receipts after a decided result never hide it
      const withEnd = [...result("confirmed"), { status: "planned", kind: "drain", settledAt: "2026-10-18T00:00:00Z" }];
      assert.equal(creatorNextFields(statusOf(rule as BurnRule, withEnd), withEnd, now).nextLine, DECIDED_BURNED);
    });
  }
  test("a repeating rule: the next result is the next close, else the next read of the source", () => {
    const r = creatorNextFields(statusOf(BRONCOS as unknown as BurnRule, result("confirmed")), result("confirmed"), now);
    assert.deepEqual([r.result, r.nextAt, r.nextLine, r.nextCheckLine], ["recurring", CHECK, "20 October 2026", null]);
  });
  test("an older status JSON without the new fields is read the same way (the DENWIN status of 2026-10-18 carried oneShot false)", () => {
    const old = { rules: { oneShot: true } as never, next: { nextCheckAt: CHECK, impliedChance: null, impliedBasis: null, nextMarket: null, nextCloseTime: null, awaitingFinal: 0 }, market: { phase: "curve" } };
    assert.equal(creatorNextFields(old, result("planned"), now).nextLine, DECIDED_WAITING);
  });
});

async function launchGameCoin(w: World, ticker = "DENWIN"): Promise<TokenRow> {
  const b = await buildLaunchBundle({ creator: CREATOR, ticker, name: `${ticker} coin`, description: "a test", imageUrl: null, links: [], rule: GAME, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true }, cluster: "devnet" }, { program: w.program, launchLab: new FakeLaunchLab(), devFeeWallet: null, attesters: [ATTESTER], quorum: 1, metadataUri: (m) => `https://x/${m}.json` });
  const t = w.registry.register({ mint: b.mint, ticker, name: b.name, creator: CREATOR, description: b.description, imageUrl: null, links: [], rulesText: b.rules.text, feePda: b.addresses.feePda, vault: b.addresses.vault, tokenConfig: b.addresses.tokenConfig, poolId: b.addresses.poolId, launchTx: null, cluster: "devnet", platformId: b.addresses.platformId, baselineAt: "2026-10-01T00:00:00Z", status: "draft" }, NOW);
  w.registry.markLaunched(t.mint, `launch${ticker}`, b.addresses.poolId, "2026-10-01T00:00:00Z");
  return w.registry.token(t.mint)!;
}

describe("F08 · through the real producer (tokenPageData) and the creator page data", () => {
  test("the DENWIN shape: a one-game coin whose result settled and waits for graduation reads as decided, never a new result date", async () => {
    const w = await makeWorld();
    const t = await launchGameCoin(w);
    const pending = await tokenPageData(w.p, t, NOW);
    assert.equal(pending.status.rules.oneShot, true, "the producer: a one-game catalogue coin is one-shot");
    assert.equal(pending.status.next.result, "pending");
    // the game is decided: DEN won, the result receipt is planned (it burns after graduation)
    w.registry.applyStep(t.mint, { id: `${GAME_ID}-DEN`, at: SETTLED, result: null, value: "1", title: "Seattle Seahawks at Denver Broncos: Final", sourceUrl: "https://site.api.espn.com" }, { units: 1, mapping: { fractionOfPool: 1 }, kind: "scalar", note: "won", carryOut: "0", baseline: null }, { value: null, carryOut: "0" }, true, NOW);
    const decided = await tokenPageData(w.p, t, NOW);
    assert.equal(decided.status.next.result, "decided"); assert.equal(decided.status.next.nextResultAt, null);
    assert.equal(decided.status.next.nextSourceCheckAt, decided.status.next.nextCheckAt, "the source check is still reported, as a source check");
    const view = async () => { const d = await creatorData(CREATOR, NOW, w.p, { memo: null }); assert.equal(d.kind, "ok"); return d.kind === "ok" ? d : null!; };
    let coin = (await view()).coins.find((c) => c.mint === t.mint)!;
    assert.equal(coin.available, true);
    // waiting for graduation on a curve; the fake world may report the pool graduated, which reads "Decided"
    assert.equal(coin.nextLine, decided.status.market?.phase === "graduated" ? DECIDED : DECIDED_WAITING); assert.equal(coin.nextAt, null); assert.equal(coin.nextCheckLine, null);
    w.registry.setReceiptStatus(t.mint, `${GAME_ID}-DEN`, "confirmed", NOW);
    coin = (await view()).coins.find((c) => c.mint === t.mint)!;
    assert.equal(coin.nextLine, DECIDED_BURNED);
    // a voided game (a second coin: a final receipt is frozen)
    const v = await launchGameCoin(w, "DENVOID");
    w.registry.applyStep(v.mint, { id: `${GAME_ID}-DEN`, at: SETTLED, result: null, value: null, title: "Seattle Seahawks at Denver Broncos: postponed", sourceUrl: "https://site.api.espn.com" }, { units: 0, mapping: null, kind: "void", note: "void", carryOut: "0", baseline: null }, { value: null, carryOut: "0" }, true, NOW);
    assert.equal((await tokenPageData(w.p, v, NOW)).status.next.result, "void");
    coin = (await view()).coins.find((c) => c.mint === v.mint)!;
    assert.equal(coin.nextLine, DECIDED_VOID); assert.equal(coin.result, "void"); assert.equal(coin.nextCheckLine, null);
    const bronco = (await view()).coins.find((c) => c.mint === w.bronco.mint)!;
    assert.equal(bronco.result, "recurring", "the series coin is not one-shot");
  });
});

describe("creator aggregation", () => {
  test("slow and failing coins: the list arrives by the deadline, failing coins are listed as unavailable, never an empty account", async () => {
    const w = await makeWorld();
    const real: CoinDetail = (p, t, n) => tokenPageData(p, t, n);
    const detail: CoinDetail = async (p, t, n) => {
      if (t.mint === w.deficit.mint) throw new Error("RPC 503");
      if (t.ticker === "SLOWCOIN") return new Promise(() => {});   // never answers
      return real(p, t, n);
    };
    await launchGameCoin(w, "SLOWCOIN");
    const started = Date.now();
    const d = await creatorData(CREATOR, NOW, w.p, { memo: null, detail, coinMs: 150, deadlineMs: 600 });
    assert.ok(Date.now() - started < 1_500, `answered by the deadline (${Date.now() - started} ms)`);
    assert.equal(d.kind, "ok");
    if (d.kind !== "ok") return;
    assert.equal(d.coins.length, 3, "every coin is listed");
    assert.equal(d.unavailable, 2);
    const by = (tk: string) => d.coins.find((c) => c.ticker === tk)!;
    assert.equal(by("BRONCO").available, true);
    for (const tk of ["DEFICIT2", "SLOWCOIN"]) {
      const c = by(tk);
      assert.equal(c.available, false, tk); assert.equal(c.nextLine, CREATOR_PAGE.coinUnavailable);
      assert.ok(c.rule.length > 3 && c.page.startsWith("/burnticker/t/"), "registry facts still shown");
    }
    // every coin failing: still listed, all unavailable
    const none = await creatorData(CREATOR, NOW, w.p, { memo: null, detail: async () => { throw new Error("down"); }, coinMs: 100, deadlineMs: 300 });
    assert.ok(none.kind === "ok" && none.coins.length === 3 && none.unavailable === 3);
  });

  test("bounded concurrency and an end-to-end deadline (boundedMap)", async () => {
    let inflight = 0, peak = 0;
    const slow = (ms: number) => async (k: number) => { inflight++; peak = Math.max(peak, inflight); await new Promise((r) => setTimeout(r, ms)); inflight--; return k; };
    const all = await boundedMap(Array.from({ length: 10 }, (_, k) => k), { limit: 3, eachMs: 1_000, deadlineMs: 2_000 }, slow(10), () => -1);
    assert.deepEqual(all, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]); assert.ok(peak <= 3, `peak ${peak}`);
    const t0 = Date.now();
    const cut = await boundedMap(Array.from({ length: 6 }, (_, k) => k), { limit: 2, eachMs: 5_000, deadlineMs: 80 }, slow(400), () => -1);
    assert.ok(Date.now() - t0 < 300, "returned at the deadline");
    assert.deepEqual(cut, [-1, -1, -1, -1, -1, -1]);
  });

  test("the summary is registry-only (no coin page is built) and the detail is kept briefly per wallet", async () => {
    const w = await makeWorld();
    const s = creatorSummary(CREATOR, NOW, w.p);
    assert.ok(!(s instanceof Promise), "synchronous: no chain or oracle read");
    assert.equal(s.kind, "ok");
    if (s.kind === "ok") { assert.deepEqual(s.coins.map((c) => c.ticker).sort(), ["BRONCO", "DEFICIT2"]); assert.ok(s.coins.every((c) => typeof c.receipts === "number" && typeof c.summary === "string")); }
    assert.equal(creatorSummary("nope", NOW, w.p).kind, "bad-wallet");
    let calls = 0;
    const memo = new KeyedSwr<Awaited<ReturnType<typeof creatorData>>>({ freshMs: 30_000, coldWaitMs: 2_000 });
    const detail: CoinDetail = (p, t, n) => { calls++; return tokenPageData(p, t, n); };
    await creatorData(CREATOR, NOW, w.p, { memo, detail });
    await creatorData(CREATOR, NOW, w.p, { memo, detail });
    assert.equal(calls, 2, "two coins built once; the second read is the memo's");
    const route = fs.readFileSync("src/app/burnticker/creator/[wallet]/summary/route.ts", "utf8");
    assert.match(route, /creatorSummary\(wallet\)/); assert.doesNotMatch(route, /creatorData\(/);
  });

  test("the creator page shows partial lists and the source-check row; the new words pass the copy lint", () => {
    const page = fs.readFileSync("src/app/burnticker/creator/[wallet]/page.tsx", "utf8");
    assert.match(page, /data-creator-partial/); assert.match(page, /data-next-check/); assert.match(page, /data-available=/);
    for (const t of [CREATOR_PAGE.partial(1), CREATOR_PAGE.partial(3), CREATOR_PAGE.coinUnavailable, CREATOR_PAGE.labels.check, DECIDED_VOID]) {
      const r = lintCopy(t);
      assert.equal(r.ok, true, `${t}: ${r.hits.map((h) => h.phrase).join(", ")}`);
    }
  });
});
