// CHEAP-FEATURES PASS (owner 2026-10-13, CHEAP-FEATURES-BRIEF items 1-10), the library and API side: the receipt share card and its
// stable widget URL, the burn calendar (JSON + .ics), the leaderboard, direction in generated tickers, last season's count for team
// coins, the result simulator, the daily digest and its post, the operator's post-approval queue, and the post-launch checklist. Every
// route is called in-process against the fakes and its 200 checked against the OpenAPI schema; every sentence passes the copy lint.
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildOpenApi, endpoint, API_VERSION } from "@/lib/burnticker/api/spec";
import { lintCopy } from "@/lib/launch/copyLint";
import { lockRule, type BurnRule } from "@/lib/burnticker/rules";
import { teamSeries, type Game } from "@/lib/burnticker/sources/espn";
import { renderReceiptCardSvg, latestBurnLine } from "@/lib/burnticker/receiptCard";
import { receiptCardImage, receiptCardData, receiptCardPath, clearReceiptCardCache } from "@/lib/burnticker/receiptCardServe";
import { calendarIcs, coinCalendar, upcomingGamesFor } from "@/lib/burnticker/calendar";
import { buildLeaderboard, leaderboard, streaksOf } from "@/lib/burnticker/leaderboard";
import { teamTicker } from "@/lib/burnticker/tickers";
import { countLastSeason, lastSeasonBacktest, previousSeasonOf } from "@/lib/burnticker/lastSeason";
import { simulateResults, SIM_CASES } from "@/lib/burnticker/simulator";
import { buildDigest, digestDay, digestDraft, digestPostText } from "@/lib/burnticker/digest";
import { checkDraft } from "@/lib/launch/postQueue";
import { markUsed, queueView, readUsed } from "@/lib/burnticker/postApproval";
import { checklistOf } from "@/lib/burnticker/checklist";
import { v1OpsPostQueue, v1OpsPostUsed } from "@/lib/burnticker/api/features";
import { buildLaunchReview } from "@/lib/burnticker/launchReview";
import type { ReceiptRow } from "@/lib/burnticker/registry";
import { API, POST_HEADERS, callRoute, makeWorld, validateSchema, type World } from "./burntickerApiHelpers.ts";
import { BRONCOS, NOW } from "./burntickerHelpers.ts";

const DOC = buildOpenApi() as { paths: Record<string, Record<string, { responses: Record<string, { content: Record<string, { schema: Record<string, unknown> }> }> }>> };
async function call(operationId: string, pathParams: Record<string, string> = {}, o: { query?: string; body?: unknown; headers?: Record<string, string>; expect?: number } = {}) {
  const ep = endpoint(operationId);
  const p = ep.path.replace(/\{(\w+)\}/g, (_m, k) => encodeURIComponent(pathParams[k]));
  const res = await callRoute(`${API}${p}${o.query ? `?${o.query}` : ""}`, { method: ep.method, headers: ep.method === "POST" ? { ...POST_HEADERS, ...(o.headers ?? {}) } : o.headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) });
  const body = await res.json() as Record<string, unknown>;
  assert.equal(res.status, o.expect ?? 200, `${operationId} → ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
  const schema = DOC.paths[ep.path][ep.method.toLowerCase()].responses[String(res.status)]?.content["application/json"].schema;
  assert.ok(schema, `${operationId}: status ${res.status} is documented`);
  assert.deepEqual(validateSchema(schema, body, DOC as unknown as Record<string, unknown>), [], `${operationId} ${res.status} matches its schema`);
  return { res, body };
}

/** The brief's lint: the copy lint, and none of buy / price / will / coming soon / payout / target. */
function plain(text: string, where: string) {
  const r = lintCopy(text);
  assert.ok(r.ok, `${where}: ${r.hits.map((h) => h.phrase).join(", ")} in "${text}"`);
  assert.doesNotMatch(text, /\b(buy|buys|buying|price|prices|will|coming soon|payouts?|targets?)\b/i, `${where}: "${text}"`);
}

const team = (abbr: string, outcome: "win" | "loss" | "draw", window: Parameters<typeof teamSeries>[3], league: Parameters<typeof teamSeries>[0] = "mlb"): BurnRule => lockRule({ schema: "burnticker.rules/v1", oracle: "catalogue", series: teamSeries(league, abbr, outcome, window), market: null, filter: {}, kind: "scalar", scalar: { unit: 1, perUnit: { fractionOfPool: 0.02 }, baseline: 0, direction: "up" }, binary: null, onVoid: "skip", floorUsd: "1", reserveSol: "0.02", vault: null }).rule;
const side = (abbr: string, score: number | null, homeAway: "home" | "away") => ({ abbr, name: abbr, nickname: abbr, score, homeAway, record: null });
const game = (id: string, date: string, home: [string, number | null], away: [string, number | null], o: { completed?: boolean; seasonType?: 2 | 3 } = {}): Game => ({ eventId: id, league: "mlb", seasonType: o.seasonType ?? 2, startsAt: `${date}T23:00:00Z`, date, name: `${away[0]} at ${home[0]}`, completed: o.completed ?? home[1] !== null, state: home[1] !== null ? "post" : "pre", detail: "", home: side(home[0], home[1], "home"), away: side(away[0], away[1], "away") });

let w: World;
before(async () => { w = await makeWorld(); });

describe("1 and 7: the receipt share card and the embeddable widget", () => {
  test("the card renders the ticker, the rule's sentence and the latest burn; byte-identical for the same inputs", () => {
    const rule = lockRule(BRONCOS);
    const i = { ticker: "BRONCO", sentence: "Burns after each Broncos win.", rule: rule.rule, sha256: rule.sha256, latest: { tokens: "1234567.891", day: "2026-10-04" }, burns: 3 };
    const a = renderReceiptCardSvg(i), b = renderReceiptCardSvg(i);
    assert.equal(a, b);
    assert.match(a, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="1200" height="630"/);
    assert.match(a, /\$BRONCO/);
    assert.match(a, /Latest burn: 1,234,567\.89 tokens, reading of 2026-10-04/);
    assert.match(a, /3 burns recorded/);
    assert.match(a, /<svg x="44" y="59" width="512" height="512"/, "the coin art is embedded");
    assert.doesNotMatch(a, /price|odds|market cap/i);
    assert.equal(latestBurnLine(null), "No burn recorded yet");
    plain(latestBurnLine(i.latest), "latest line");
  });
  test("served from the registry by mint (the stable URL) or ticker; a new burn changes the card; drafts and unknown coins are 404", async () => {
    clearReceiptCardCache();
    const r = await receiptCardImage({ registry: w.registry, file: `${w.bronco.mint}.svg` });
    assert.equal(r.status, 200); assert.equal(r.type, "image/svg+xml");
    const byTicker = await receiptCardImage({ registry: w.registry, file: "BRONCO.svg" });
    assert.deepEqual(byTicker.body, r.body);
    const d = receiptCardData(w.registry, w.bronco);
    assert.ok(d.burns >= 1, "the fake cycle confirmed at least one burn");
    plain(d.alt.replace(/\$[A-Z0-9]+/g, "coin"), "card alt");
    assert.equal((await receiptCardImage({ registry: w.registry, file: "NOPE.svg" })).status, 404);
    assert.equal((await receiptCardImage({ registry: w.registry, file: "x.gif" })).status, 404);
    const png = await receiptCardImage({ registry: w.registry, file: `${w.bronco.mint}.png` });
    assert.equal(png.type, "image/png");
    assert.equal(receiptCardPath(w.bronco.mint), `/burnticker/img/receipt/${w.bronco.mint}.png`);
    // the route file sits beside the coin art's own route
    assert.ok(fs.existsSync("src/app/burnticker/img/receipt/[file]/route.ts"));
    assert.match(fs.readFileSync("src/lib/burnticker/sharePreviewServe.ts", "utf8"), /receiptCardPath\(t\.mint\)/, "the coin page's Open Graph image is the card");
  });
});

describe("2: the burn calendar", () => {
  const games = [
    game("1", "2026-10-01", ["LAD", 5], ["SF", 3]),
    game("2", "2026-10-11", ["LAD", null], ["SF", null]),
    game("3", "2026-10-12", ["SD", null], ["LAD", null], { seasonType: 3 }),
    game("4", "2026-10-13", ["NYM", null], ["ATL", null]),
  ];
  test("a team coin's next games inside its window, from the schedule port; at most five", async () => {
    const all = team("LAD", "win", { kind: "season", year: 2026 });
    assert.deepEqual(upcomingGamesFor(all, games, NOW).map((g) => g.eventId), ["2", "3", "4"], "the port returns the team's games; the window filter keeps open ones");
    const post = team("LAD", "win", { kind: "post", year: 2026 });
    assert.deepEqual(upcomingGamesFor(post, games, NOW).map((g) => g.eventId), ["3"]);
    const cal = await coinCalendar({ ticker: "LADWIN", mint: "M", page: "/burnticker/t/M", ics: "/x.ics", rule: all, teamSeason: async () => games.slice(0, 3), now: NOW });
    assert.equal(cal.source, "schedule");
    assert.deepEqual(cal.entries.map((e) => e.kind), ["game", "game"]);
    for (const e of cal.entries) plain(e.detail, "calendar detail");
    plain(cal.note, "calendar note");
    const slow = await coinCalendar({ ticker: "LADWIN", mint: "M", page: "/p", ics: "/x.ics", rule: all, teamSeason: () => new Promise(() => {}), now: NOW, timeoutMs: 20 });
    assert.equal(slow.source, "none", "a schedule that does not answer falls back to the status record");
  });
  test("a Treasury coin lists the next five business days; the .ics is RFC 5545 (CRLF, folded, one VEVENT per entry)", async () => {
    const { body } = await call("getCoinCalendar", { mint: w.deficit.mint });
    assert.equal(body.source, "business-days");
    const entries = body.entries as { day: string; allDay: boolean }[];
    assert.equal(entries.length, 5);
    assert.ok(entries.every((e) => e.allDay && ![0, 6].includes(new Date(`${e.day}T00:00:00Z`).getUTCDay())));
    const res = await callRoute(`${API}/coins/${w.deficit.mint}/calendar.ics`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type")!, /^text\/calendar/);
    assert.match(res.headers.get("content-disposition")!, /DEFICIT2-readings\.ics/);
    const ics = await res.text();
    assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n"));
    assert.equal(ics.match(/BEGIN:VEVENT/g)!.length, 5);
    assert.ok(ics.split("\r\n").every((l) => Buffer.byteLength(l, "utf8") <= 75), "lines folded at 75 octets");
    assert.match(ics, /DTSTART;VALUE=DATE:\d{8}/);
    await call("getCoinCalendar", { mint: "NoSuchCoin" }, { expect: 404 });
  });
  test("a timed entry gets DTSTART/DTEND in UTC", () => {
    const ics = calendarIcs({ ticker: "T", mint: "M", page: "/p", ics: "/i", source: "schedule", note: "n", entries: [{ id: "game-1", kind: "game", at: "2026-10-11T23:05:00Z", day: "2026-10-11", allDay: false, title: "$T: SF at LAD", detail: "d, with; commas" }] }, { origin: "https://example.test", now: NOW });
    assert.match(ics, /DTSTART:20261011T230500Z\r\nDTEND:20261012T020500Z/);
    assert.match(ics, /DESCRIPTION:d\\, with\\; commas/);
  });
});

describe("3: the leaderboard", () => {
  const r = (eventId: string, settledAt: string, status: ReceiptRow["status"], burn: number) => ({ eventId, settledAt, status, burnRaw: BigInt(burn) }) as unknown as ReceiptRow;
  test("streaks: a burning result extends the run, one that burned nothing ends it, one still waiting is not counted", () => {
    assert.deepEqual(streaksOf([r("a", "1", "confirmed", 5), r("b", "2", "confirmed", 5), r("c", "3", "nothing", 0), r("d", "4", "confirmed", 1), r("e", "5", "planned", 0), r("f", "6", "confirmed", 2), r("g", "7", "confirmed", 2)]), { longest: 3, current: 3, endedAt: "7" });
  });
  test("four lists from the receipts, launched coins only, memoised per minute; the route validates", async () => {
    const b = buildLeaderboard(w.registry, NOW);
    assert.ok(b.mostBurned.length >= 1);
    assert.equal(b.mostBurned[0].rank, 1);
    assert.ok(b.newestReceipt.every((x, i, a) => i === 0 || `${a[i - 1].at}` >= `${x.at}`));
    for (const row of [...b.mostBurned, ...b.biggestBurn, ...b.longestStreak, ...b.newestReceipt]) plain(row.detail.replace(/\$[A-Z0-9]+/g, "coin"), "leaderboard row");
    plain(b.note, "leaderboard note");
    for (const l of Object.values(b.labels)) plain(l, "label");
    assert.equal(leaderboard(w.registry, NOW), leaderboard(w.registry, NOW + 30_000 - (NOW % 60_000) + 1), "same minute, same object");
    const { body, res } = await call("getLeaderboard");
    assert.ok(Array.isArray(body.longestStreak));
    assert.match(res.headers.get("cache-control")!, /max-age=60/);
  });
});

describe("4: direction in generated tickers", () => {
  test("$LADWIN and $LADLOSS by default; the fade side, the title and pairs unchanged; ten characters at most", () => {
    assert.equal(teamTicker("LAD", { league: "mlb", window: "season", outcome: "win" }), "LADWIN");
    assert.equal(teamTicker("LAD", { league: "mlb", window: "season", outcome: "loss" }), "LADLOSS");
    assert.equal(teamTicker("LAD", { league: "mlb", window: "season", outcome: "draw" }), "LADDRAW");
    assert.equal(teamTicker("LAD", { league: "mlb", window: "season", inverse: true }), "LADNOWIN");
    assert.equal(teamTicker("LAD", { league: "mlb", window: "title" }), "LADWS");
    assert.equal(teamTicker("LAD", { league: "mlb", window: "game", outcome: "loss" }), "LADLOSSGM");
    assert.equal(teamTicker("LAD", { league: "mlb", window: "next", games: 5 }), "LADWINN5", "the window shortens first");
    for (const l of ["mlb", "nba", "wnba", "nfl", "usa.1", "eng.1"]) for (const window of ["season", "post", "next", "perpetual", "game"] as const) for (const inverse of [false, true]) for (const outcome of ["win", "loss", "draw"] as const) {
      const t = teamTicker("ATL", { league: l, window, games: 12, inverse, outcome });
      assert.match(t, /^[A-Z0-9]{2,10}$/, `${l} ${window} ${inverse} ${outcome}`);
      assert.ok(/W|L|D/.test(t.slice(3)), `the side survives: ${t}`);
    }
  });
});

describe("5: last season's count for team coins", () => {
  const last = [
    game("a", "2025-04-01", ["LAD", 5], ["SF", 3]), game("b", "2025-04-02", ["LAD", 1], ["SF", 3]), game("c", "2025-04-03", ["SF", 2], ["LAD", 4]),
    game("d", "2025-10-20", ["LAD", 6], ["NYY", 2], { seasonType: 3 }), game("e", "2025-04-04", ["LAD", null], ["SF", null], { completed: false }),
  ];
  test("counted the keeper's way: the rule's result, inside its window; the fade side counts the rest", () => {
    const win = countLastSeason(team("LAD", "win", { kind: "season", year: 2026 }), last, 2025);
    assert.deepEqual([win.available, win.games, win.burns, win.season], [true, 4, 3, "2025"]);
    assert.equal(win.sentence, "This rule would have burned 3 times last season (2025), in 4 Dodgers games.");
    for (const l of win.lines) plain(l, "backtest line");
    assert.equal(countLastSeason(team("LAD", "loss", { kind: "season", year: 2026 }), last, 2025).burns, 1);
    assert.equal(countLastSeason(team("LAD", "win", { kind: "post", year: 2026 }), last, 2025).burns, 1);
    const fade = lockRule({ ...JSON.parse(JSON.stringify(team("LAD", "win", { kind: "season", year: 2026 }))), inverse: true }).rule;
    assert.equal(countLastSeason(fade, last, 2025).burns, 1);
    assert.equal(countLastSeason(team("LAD", "win", { kind: "season", year: 2026 }), [], 2025).available, false);
    assert.deepEqual(previousSeasonOf(team("LAD", "win", { kind: "season", year: 2026 }), NOW), { league: "mlb", year: 2025 });
  });
  test("read through the port with a time limit; no port or no answer leaves the reason; the review carries it", async () => {
    const rule = team("LAD", "win", { kind: "season", year: 2026 });
    let asked: unknown[] = [];
    const ok = await lastSeasonBacktest(rule, async (...a) => { asked = a; return last; }, { now: NOW });
    assert.equal(ok!.burns, 3); assert.equal(asked[2], 2025);
    assert.equal((await lastSeasonBacktest(rule, null, { now: NOW }))!.available, false);
    assert.equal((await lastSeasonBacktest(rule, () => new Promise(() => {}), { now: NOW, timeoutMs: 10 }))!.available, false);
    assert.equal((await lastSeasonBacktest(rule, async () => { throw new Error("HTTP 500 https://x"); }, { now: NOW }))!.reason, "Last season's schedule could not be read, so it was not counted.");
    assert.equal(await lastSeasonBacktest(lockRule(BRONCOS).rule, async () => last), null, "not a team rule");
    const r = buildLaunchReview({ rule, ticker: "LADWIN", name: "Dodgers Wins" }, { lastSeason: ok, now: NOW });
    assert.ok("review" in r);
    if ("review" in r) { assert.equal(r.review.backtest?.burns, 3); assert.equal(r.review.simulation.available, true); }
  });
});

describe("6: the result simulator", () => {
  test("one coin: the result spends its share (compounding, in one run, no cap), the other cases burn nothing", () => {
    const s = simulateResults(lockRule(BRONCOS).rule, { poolSol: "1", ticker: "BRONCO" });
    assert.deepEqual(s.rows.map((x) => x.case), [...SIM_CASES]);
    const res = s.rows[0].coins[0];
    assert.equal(res.spendSol, "0.02"); assert.equal(res.poolAfterSol, "0.98"); assert.equal(res.burns, true);
    for (const row of s.rows.slice(1)) assert.ok(row.coins.every((c) => !c.burns && c.spendSol === "0"), row.case);
    for (const row of s.rows) { plain(row.line.replace(/\$[A-Z0-9]+/g, "coin"), row.case); plain(row.label, "label"); }
    plain(s.note, "note");
    // owner decision 2026-10-25: no burn-pool cap and no per-run bound, so a 100 SOL pool spends its whole 2% share in one run
    const big = simulateResults(lockRule(BRONCOS).rule, { poolSol: "100", tradingPoolSol: "10" });
    assert.equal(big.rows[0].coins[0].spendSol, "2", "2% of the whole 100 SOL pool, however shallow the trading pool");
    assert.equal(big.rows[0].coins[0].waitsSol, "0", "nothing waits for a later run");
    assert.doesNotMatch(big.rows[0].line, /waits for the next run|at most 2%/);
    assert.equal(simulateResults(lockRule(BRONCOS).rule, { poolSol: "abc" }).available, false);
  });
  test("a draw coin burns on a tie; a winner-takes-the-burn pair moves the loser's share to the winner", () => {
    const draw = simulateResults(team("ARS", "draw", { kind: "season", year: 2026 }, "eng.1"), { poolSol: "1" });
    assert.equal(draw.rows.find((r) => r.case === "tie")!.coins[0].burns, true);
    const pair = simulateResults(lockRule(BRONCOS).rule, { poolSol: "1", pair: { tickerA: "AAA", tickerB: "BBB", winnerTakesBurn: true } });
    const [a, b] = pair.rows[0].coins;
    assert.equal(b.sentSol, "0.02"); assert.equal(a.receivedSol, "0.02"); assert.equal(a.spendSol, "0.04"); assert.equal(a.poolAfterSol, "0.98");
    assert.ok(pair.rows.slice(1).every((r) => r.coins.length === 2 && r.coins.every((c) => !c.burns)));
    const separate = simulateResults(lockRule(BRONCOS).rule, { pair: { tickerA: "AAA", tickerB: "BBB", winnerTakesBurn: false } });
    assert.equal(separate.rows[0].coins[1].burns, false);
  });
});

describe("8: the daily digest", () => {
  test("a day is YYYY-MM-DD in UTC; default today; nonsense is refused", async () => {
    assert.equal(digestDay(null, NOW), "2026-10-10");
    assert.equal(digestDay("2026-02-30", NOW), null);
    assert.equal(digestDay("yesterday", NOW), null);
    await call("getDigest", {}, { query: "day=2026-13-01", expect: 400 });
  });
  test("readings, burns, new coins and graduations of one day; the post fits and passes the lint", async () => {
    const day = w.deficit.baselineAt.slice(0, 10);
    const d = buildDigest(w.registry, day, NOW);
    assert.ok(d.newCoins.some((c) => c.ticker === "DEFICIT2"));
    for (const l of d.lines) plain(l.replace(/\$[A-Z0-9]+/g, "coin"), "digest line");
    const { body } = await call("getDigest", {}, { query: `day=${day}` });
    assert.equal(body.day, day);
    const busy = { day, counts: { readings: 9, burns: 40, newCoins: 2, graduations: 1 }, burns: Array.from({ length: 40 }, (_, i) => ({ ticker: `C${i}`, mint: "m", page: "/p", eventId: "e", tokens: "123456.7", at: "x", signature: null })), newCoins: [] };
    const text = digestPostText(busy);
    assert.ok(text.length <= 280, `${text.length}`);
    assert.match(text, /and \d+ more/);
    const q = checkDraft(digestDraft(busy), { source: "test", now: NOW });
    assert.equal(q.format, "digest");
    checkDraft(digestDraft(d), { source: "test", now: NOW });
    assert.match(fs.readFileSync("scripts/burnticker-posts.mts", "utf8"), /digest --digest-file=FILE/);
  });
});

describe("9: the operator's post-approval queue", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bt-queue-"));
  const queueFile = path.join(dir, "post-queue.jsonl"), usedFile = path.join(dir, "post-queue-used.jsonl");
  const ENV = { BURNTICKER_OPS_PIN: "1234" };
  const req = (o: { host?: string; pin?: string; method?: string; body?: unknown } = {}) => new Request("http://localhost/api/burnticker/v1/ops/post-queue", { method: o.method ?? "GET", headers: { host: o.host ?? "localhost", ...(o.pin ? { "x-action-pin": o.pin } : {}) } });
  before(() => {
    const e = checkDraft({ format: "explainer", account: "@BurnTicker", subject: "how a burn happens", posts: ["A burn happens after a result the rule burns on."] }, { source: "test", now: NOW });
    fs.writeFileSync(queueFile, `${JSON.stringify(e)}\n`);
  });
  test("operator only: another host 403, no PIN configured 503, wrong PIN 401", () => {
    assert.equal(v1OpsPostQueue(req({ host: "burnticker.com", pin: "1234" }), new URLSearchParams(), ENV, { queueFile, usedFile }).status, 403);
    assert.equal(v1OpsPostQueue(req({ pin: "1234" }), new URLSearchParams(), {}, { queueFile, usedFile }).status, 503);
    assert.equal(v1OpsPostQueue(req({ pin: "nope" }), new URLSearchParams(), ENV, { queueFile, usedFile }).status, 401);
    assert.equal(v1OpsPostUsed(req({ method: "POST" }), { id: "x" }, ENV, { queueFile, usedFile }).status, 401);
  });
  test("list and mark used: the mark is appended to its own file, the queue never changes, a second mark keeps the first", () => {
    const before = fs.readFileSync(queueFile);
    const list = v1OpsPostQueue(req({ pin: "1234" }), new URLSearchParams("state=waiting"), ENV, { queueFile, usedFile });
    assert.equal(list.status, 200);
    const items = (list.body as { items: { id: string; state: string }[] }).items;
    assert.equal(items.length, 1); assert.equal(items[0].state, "waiting");
    const id = items[0].id;
    const m = v1OpsPostUsed(req({ pin: "1234", method: "POST" }), { id }, ENV, { queueFile, usedFile }, NOW);
    assert.equal(m.status, 200); assert.equal((m.body as { status: string }).status, "marked");
    assert.equal((v1OpsPostUsed(req({ pin: "1234", method: "POST" }), { id }, ENV, { queueFile, usedFile }, NOW + 1000).body as { status: string; usedAt: string }).usedAt, new Date(NOW).toISOString());
    assert.equal(v1OpsPostUsed(req({ pin: "1234", method: "POST" }), { id: "0123456789abcdef" }, ENV, { queueFile, usedFile }).status, 404);
    assert.equal(readUsed(usedFile).length, 1);
    assert.deepEqual(fs.readFileSync(queueFile), before, "the queue file is never rewritten");
    assert.equal(queueView({ queueFile, usedFile }).used, 1);
    assert.equal(markUsed("not-hex", { queueFile, usedFile }).status, "not-found");
    plain(queueView({ queueFile, usedFile }).note, "queue note");
  });
  test("the routes go through runV1: the POST refuses cross-site, the GET answers 403 off the operator's network", async () => {
    assert.equal((await callRoute(`${API}/ops/post-queue`)).status, 403);
    assert.equal((await callRoute(`${API}/ops/post-queue/used`, { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example" }, body: "{}" })).status, 403);
  });
});

describe("10: the post-launch checklist", () => {
  const base = { ticker: "T", mint: "M", status: "live", launched: true, phase: null, poolRegistered: null, readings: 0, burns: 0 } as const;
  test("six steps in order; the first not done is the next action, with who does it; a later step proves the earlier ones", () => {
    const draft = checklistOf({ ...base, status: "draft", launched: false });
    assert.deepEqual(draft.steps.map((s) => s.id), ["created", "trading", "graduated", "pool-verified", "first-reading", "first-burn"]);
    assert.equal(draft.next?.step, "created"); assert.equal(draft.next?.who, "the creator");
    const curve = checklistOf({ ...base, phase: "curve", poolRegistered: false });
    assert.equal(curve.next?.step, "graduated"); assert.equal(curve.next?.who, "traders on the curve");
    const grad = checklistOf({ ...base, phase: "graduated", poolRegistered: false });
    assert.equal(grad.next?.step, "pool-verified"); assert.equal(grad.next?.who, "the keeper");
    const unknown = checklistOf(base);
    assert.equal(unknown.steps[2].done, null, "not read is never shown as done");
    const burned = checklistOf({ ...base, burns: 2 });
    assert.ok(burned.steps.every((s) => s.done === true)); assert.equal(burned.next, null);
    for (const c of [draft, curve, grad, unknown, burned]) { plain(c.line, "checklist line"); for (const s of c.steps) plain(s.detail, s.id); if (c.next) plain(c.next.action, "next"); }
  });
  test("the route answers for a live coin, with the share image", async () => {
    const { body } = await call("getCoinChecklist", { mint: w.bronco.mint });
    assert.equal((body.steps as unknown[]).length, 6);
    assert.equal(body.shareImage, `/burnticker/img/receipt/${w.bronco.mint}.png`);
    assert.equal((body.steps as { id: string; done: boolean | null }[]).find((s) => s.id === "first-burn")!.done, true);
  });
});

test("the API version moved to 1.18.0 (1.19.0 since the signed launch request, 1.20.0 since images stopped being web addresses, 1.21.0 since receipts say preLaunch) and api.md lists every new path", () => {
  assert.equal(API_VERSION, "1.21.0");
  const md = fs.readFileSync("docs/burnticker/api.md", "utf8");
  for (const p of ["/coins/{mint}/calendar", "/coins/{mint}/calendar.ics", "/coins/{mint}/checklist", "/leaderboard", "/digest", "/ops/post-queue", "/ops/post-queue/used", "/burnticker/img/receipt/"]) assert.ok(md.includes(p), p);
});
