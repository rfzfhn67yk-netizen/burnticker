// website-18 (the owner's walkthrough, 2026-10-12): "say I want to pick the Dodgers to win the World Series: it should burn every game they
// win until the last game of the World Series, then burn the remaining balance after they win. If they lose, it should ... burn $DEFICIT."
// The source's champion verdict (espn.ts championOf), the keeper's wait until the source and the coin's own receipt agree
// (multiKeeper.recordWindowEnd + endSinkKeeper.championVerdict), the champion's end recorded on the wind-down outcome with honest words,
// and an eliminated team's leftover forwarded to $DEFICIT.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { championSeries, CHAMPION_KNOWN, teamSeries, windowStatus, type Game, type GameSide } from "@/lib/burnticker/sources/espn";
import { recordWindowEnd } from "@/lib/burnticker/multiKeeper";
import { CHAMPION_END_LINE, championVerdict, endOutcomeOf, endSinkStep, isChampionEnd, NOT_CHAMPION_END_LINE } from "@/lib/burnticker/endSinkKeeper";
import { DEFAULT_ON_END, lockRule, type BurnRule } from "@/lib/burnticker/rules";
import { firstPartyRule } from "@/lib/burnticker/wizard";

const LAD = teamSeries("mlb", "LAD", "win", { kind: "season", year: 2026 });
const S = championSeries(LAD)!;
const side = (abbr: string, id: string, score: number, homeAway: "home" | "away"): GameSide => ({ abbr, id, name: abbr, nickname: abbr, score, homeAway, record: null });
const game = (date: string, type: 2 | 3, us: number, them: number): Game => ({ eventId: date.replace(/-/g, ""), league: "mlb", seasonType: type, seasonYear: 2026, startsAt: `${date}T00:00:00Z`, date, name: "x", completed: true, state: "post", detail: "Final", home: side("LAD", S.teamId ?? "", us, "home"), away: side("NYY", "10", them, "away") });
const SEASON = [game("2026-09-27", 2, 5, 3), game("2026-10-28", 3, 2, 1)];
const NOW = Date.parse("2026-11-10T00:00:00Z");

describe("the source: champion or not, from the team's last game of an ended season", () => {
  test("won its last postseason game: champion; lost it: not; no postseason: not; a tie or no score: cannot tell", () => {
    assert.deepEqual([...CHAMPION_KNOWN].sort(), ["mlb", "nba", "nfl", "nhl"], "the NFL joined on 2026-10-13 (owner: the Super Bowl end)");
    const won = windowStatus(S, SEASON, NOW);
    assert.equal(won.ended, true); assert.equal(won.champion, true); assert.equal(won.championDate, "2026-10-28");
    const lost = windowStatus(S, [SEASON[0], game("2026-10-28", 3, 1, 2)], NOW);
    assert.equal(lost.champion, false); assert.equal(lost.championDate, "2026-10-28");
    const missed = windowStatus(S, [game("2026-09-27", 2, 5, 3)], NOW);
    assert.equal(missed.champion, false); assert.equal(missed.championDate, null, "a team that missed the postseason has no last postseason game");
    const unscored = windowStatus(S, [SEASON[0], { ...game("2026-10-28", 3, 0, 0), home: { ...side("LAD", S.teamId ?? "", 0, "home"), score: null } }], NOW);
    assert.equal(unscored.champion, null);
    assert.equal(windowStatus(S, SEASON, Date.parse("2026-10-29T00:00:00Z")).champion, undefined, "before the season is over there is no verdict");
  });
  test("only an MLB, NBA, NHL or NFL wins coin for a whole season takes the path; soccer, a loss coin and a postseason-only coin do not", () => {
    assert.ok(championSeries(teamSeries("nba", "LAL", "win", { kind: "season", year: 2027 })));
    assert.ok(championSeries(teamSeries("nfl", "PHI", "win", { kind: "season", year: 2026 })), "the NFL since 2026-10-13");
    for (const x of [teamSeries("mlb", "LAD", "loss", { kind: "season", year: 2026 }), teamSeries("mlb", "LAD", "win", { kind: "post", year: 2026 }), teamSeries("eng.1", "ARS", "win", { kind: "season", year: 2026 })]) assert.equal(championSeries(x), null, x);
  });
});

const rule = { ...firstPartyRule(LAD, 0.02), onEnd: { ...DEFAULT_ON_END } } as BurnRule;
const locked = lockRule(rule);
type R = { eventId: string; units: number; status: string };
function world(receipts: R[], over: Partial<{ rule: BurnRule }> = {}) {
  const marks: { mint: string; reason: string }[] = [], logs: string[] = [];
  const registry = { ruleEnd: () => null, lockedRule: () => ({ rule: over.rule ?? rule }), markRuleEnded: (mint: string, _m: string, reason: string) => { marks.push({ mint, reason }); return null; }, receipts: () => receipts } as never;
  return { d: { registry, dryRun: false, log: (l: string) => logs.push(l) } as never, marks, logs };
}
const tok = { mint: "M1", ticker: "DODGERS26", status: "live", selectorKey: "k" } as never;
const ended = (w: ReturnType<typeof windowStatus>) => ({ window: { perpetual: w.perpetual, ended: w.ended, endsAt: w.endsAt, reason: w.reason, champion: w.champion, championDate: w.championDate } });

describe("the keeper: the end waits until the source and the coin agree", () => {
  test("a champion with the last game's burn on record: the end reason says it won the championship and the rest burns on this coin", () => {
    const w = world([{ eventId: "2026-10-28", units: 1, status: "confirmed" }]);
    assert.deepEqual(recordWindowEnd(w.d, [tok], ended(windowStatus(S, SEASON, NOW))), ["M1"]);
    assert.equal(w.marks[0].reason, `${CHAMPION_END_LINE} (the last game was 2026-10-28)`);
    assert.ok(isChampionEnd(w.marks[0].reason)); assert.doesNotMatch(w.marks[0].reason + w.logs.join(" "), /void/i);
  });
  test("fail safe: no verdict from the source, or the coin's receipt disagrees: nothing is marked and nothing moves", () => {
    const noReceipt = world([]);
    assert.deepEqual(recordWindowEnd(noReceipt.d, [tok], ended(windowStatus(S, SEASON, NOW))), []);
    assert.match(noReceipt.logs[0], /no burn recorded for it yet; the end waits and nothing moves/);
    const unknown = world([]);
    assert.deepEqual(recordWindowEnd(unknown.d, [tok], { window: { perpetual: false, ended: true, endsAt: "2026-10-28T00:00:00Z", reason: "x", champion: null, championDate: null } }), []);
    assert.match(unknown.logs[0], /cannot tell yet whether the team won the championship/);
    const disagree = world([{ eventId: "2026-10-28", units: 1, status: "confirmed" }]);
    assert.deepEqual(recordWindowEnd(disagree.d, [tok], ended(windowStatus(S, [SEASON[0], game("2026-10-28", 3, 1, 2)], NOW))), []);
    assert.match(disagree.logs[0], /lost its last game \(2026-10-28\), but the coin recorded a win that day/);
  });
  test("eliminated (or no postseason): the end reason says the rest goes to $DEFICIT's burn; a coin off the path keeps the plain reason", () => {
    const out = world([{ eventId: "2026-09-27", units: 1, status: "confirmed" }]);
    recordWindowEnd(out.d, [tok], ended(windowStatus(S, [SEASON[0], game("2026-10-28", 3, 1, 2)], NOW)));
    assert.match(out.marks[0].reason, new RegExp(`^${NOT_CHAMPION_END_LINE.replace("$", "\\$")} \\(`));
    const missed = world([{ eventId: "2026-09-27", units: 1, status: "confirmed" }]);
    recordWindowEnd(missed.d, [tok], ended(windowStatus(S, [game("2026-09-27", 2, 5, 3)], NOW)));
    assert.match(missed.marks[0].reason, /^did not win the championship/, "a last regular-season win is not a contradiction");
    // a soccer coin is off the path (the league crowns the table leader; the NFL joined the path on 2026-10-13)
    const off = world([], { rule: { ...firstPartyRule(teamSeries("eng.1", "ARS", "win", { kind: "season", year: 2026 }), 0.02), onEnd: { ...DEFAULT_ON_END } } as BurnRule });
    recordWindowEnd(off.d, [tok], { window: { perpetual: false, ended: true, endsAt: "2027-05-24T00:00:00Z", reason: "the team's last game of the window was 2027-05-24" } });
    assert.equal(off.marks[0].reason, "the coin's window ended: the team's last game of the window was 2027-05-24");
  });
  test("championVerdict and endOutcomeOf: a champion's end is the wind-down outcome on chain; a not-champion end is resolved", () => {
    const reg = { receipts: () => [] } as never;
    assert.deepEqual(championVerdict(reg, { mint: "M" }, { reason: "r", champion: false, championDate: null }), { reason: `${NOT_CHAMPION_END_LINE} (r)` });
    assert.equal(endOutcomeOf(reg, { mint: "M" }, locked, null, { reason: `${CHAMPION_END_LINE} (the last game was 2026-10-28)` }), "void");
    assert.equal(endOutcomeOf(reg, { mint: "M" }, locked, null, { reason: `${NOT_CHAMPION_END_LINE} (the team's last game of the window was 2026-10-28)` }), "resolved");
  });
});

/** endSinkStep over a stub end-sink port: what it records, sends, writes and logs. */
function sinkWorld() {
  const FLAG = "FLAGSHIPMINT1111111111111111111111111111111";
  const st = { rec: null as null | { outcome: "resolved" | "void"; recordDate: number; forwardedLamports: bigint; forwards: number; lastForwardAt: number }, built: [] as { outcome: string; sourceUrl: string }[], forwarded: 0, memos: [] as string[], status: new Map<string, unknown>(), logs: [] as string[], retired: false };
  const signed = (s: string) => ({ signature: s, raw: new TextEncoder().encode(s), blockhash: "b", lastValidBlockHeight: 1 });
  const port = {
    endSink: async () => ({ kind: "flagship", sinkMint: FLAG, minForwardLamports: BigInt(50_000_000) }),
    ruleEnd: async () => st.rec,
    spendableLamports: async () => (st.forwarded ? BigInt(0) : BigInt(2_000_000_000)),
    buildRuleEnd: async (o: { outcome: "resolved" | "void"; sourceUrl: string; recordDate: number }) => { st.built.push(o); return { ...signed(o.outcome === "void" ? "end-w" : "end-r"), message: `BURNRECEIPTS-END-v1|outcome=${o.outcome}`, o } as never; },
    planForward: async () => ({ status: "ready", target: FLAG, intended: FLAG }),
    buildForward: async () => signed("fwd"),
    simulate: async () => ({ err: null, logs: [] }),
    send: async (raw: Uint8Array) => { const s = new TextDecoder().decode(raw); if (s.startsWith("end-")) st.rec = { outcome: s === "end-w" ? "void" : "resolved", recordDate: 20261028, forwardedLamports: BigInt(0), forwards: 0, lastForwardAt: 0 }; if (s === "fwd") st.forwarded++; },
    confirm: async () => ({ status: "confirmed", slot: 1 }),
    forwardFacts: async () => ({ to12: FLAG.slice(0, 12), lamports: BigInt(2_000_000_000), memo: "m" }),
  };
  const registry = {
    pending: () => [], receipts: () => [], token: () => null,
    recordSignature: (r: { memo: string }) => { st.memos.push(r.memo); }, setSignatureStatus: () => {},
    setStatus: (k: string, v: unknown) => { st.status.set(k, v); }, getStatus: () => null, setTokenStatus: () => { st.retired = true; },
  };
  const d = { registry, program: { endSink: { flagship: FLAG, port: () => port }, port: () => ({ config: async () => ({ lastRecordDate: 20261028 }) }) }, log: (l: string) => st.logs.push(l), now: () => NOW, dryRun: false } as never;
  return { d, st };
}
const T = { mint: "M1", ticker: "DODGERS26", rulesSha: "ab".repeat(32), status: "live" } as never;

describe("the end-sink step: a champion's coin winds down on itself, an eliminated team's coin forwards to $DEFICIT", () => {
  test("champion: the program records the wind-down outcome; the source URL, memo, log and status say it won the championship, never void", async () => {
    const w = sinkWorld();
    const r = await endSinkStep(w.d, T, locked, null, { mode: "winddown", reason: `${CHAMPION_END_LINE} (the last game was 2026-10-28)`, at: Date.parse("2026-10-28T00:00:00Z") });
    assert.deepEqual([r.handled, r.selfBurn], [false, true], "the caller runs the ordinary wind-down on this coin");
    assert.equal(w.st.built[0].outcome, "void", "the program's only outcome that keeps the pool on the coin");
    assert.match(w.st.built[0].sourceUrl, /\?outcome=champion&reason=won%20the%20championship/);
    assert.equal(w.st.forwarded, 0, "nothing is forwarded");
    const memo = JSON.parse(w.st.memos[0]) as { outcome: string; reason: string };
    assert.equal(memo.outcome, CHAMPION_END_LINE);
    assert.deepEqual(w.st.status.get("rule.endsink.M1"), { outcome: "champion", line: CHAMPION_END_LINE, recordDate: 20261028, sinkKind: "flagship", sinkMint: "FLAGSHIPMINT1111111111111111111111111111111", signature: "end-w" });
    for (const l of w.st.logs) { assert.doesNotMatch(l, /void/i); assert.match(l, /won the championship: the rest burns on this coin/); }
  });
  test("eliminated: a resolved end, the rest forwarded to the flagship, the coin retired", async () => {
    const w = sinkWorld();
    const r = await endSinkStep(w.d, T, locked, null, { mode: "winddown", reason: `${NOT_CHAMPION_END_LINE} (the team's last game of the window was 2026-10-28)`, at: Date.parse("2026-10-28T00:00:00Z") });
    assert.equal(w.st.built[0].outcome, "resolved");
    assert.equal(w.st.forwarded, 1); assert.equal(w.st.retired, true);
    assert.deepEqual([r.handled, r.selfBurn], [true, false]);
    assert.match(r.note ?? "", /moved to the \$DEFICIT burn pool/);
  });
});
