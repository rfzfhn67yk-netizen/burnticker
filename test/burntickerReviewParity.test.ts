// TEST A (ChatGPT audit 6, 2026-10-12): a combinatorial run of the launch review against the bundle route's own refusals, LOCALLY (the
// handler functions are called directly: no host, no rate limit). Every league × 3 teams × every burn mode × shares × raises; every
// catalogue source × shares × directions; 30+ search queries; name / ticker / description fuzz. Per setup it checks: nothing throws;
// review.problems predicts exactly what the bundle refuses; the review's texts describe one rule and never contradict the rule's end;
// no "undefined", "NaN" or raw source id in user-facing text; cost lines sum to the total; fee legs sum to the phase total; default
// tickers are unique per league + season and every generator agrees; no season rule for a finished team without a warning.
// It prints a failure summary by category. BURNTICKER_TEST_A_REPORT=1 prints and never fails (the before-fix run).
import { test } from "node:test";
import assert from "node:assert/strict";
import { prepareLaunch, sportsTeams, sportsRivalry, search, catalogueSources } from "@/lib/burnticker/api/handlers";
import { meetingsPairNames, meetingsPairRules, reviewBlockers, candidatesPairRule, gamePairRule } from "@/lib/burnticker/guidedLaunch";
import { CANDIDATES_PAIR_SENTENCE, GAME_PAIR_SENTENCE } from "@/lib/burnticker/describe";
import { buildLaunchReview, type LaunchReview } from "@/lib/burnticker/launchReview";
import { LEAGUES, teamsOf, teamSeries, gameSeries, seasonYearAt, type LeagueId } from "@/lib/burnticker/sources/espn";
import { firstPartyRule } from "@/lib/burnticker/wizard";
import { teamTicker, teamTickerForRule } from "@/lib/burnticker/guidedLaunch";
import { setNativeClients } from "@/lib/burnticker/sources/native";
import { describeEndSink } from "@/lib/burnticker/describe";
import { lockRule, DEFAULT_ON_END, RULE_BOUNDS, type BurnRule } from "@/lib/burnticker/rules";
import { CREATOR, makeWorld } from "./burntickerApiHelpers.ts";
import { lookalikeRows } from "@/lib/burnticker/launchGuards";
import { DEBT_RULE } from "./burntickerHelpers.ts";
import { BUCS_CID, EAGLES_CID } from "./burntickerPolyHelpers.ts";
import { closingSoonCard } from "@/lib/burnticker/search";
import { ESPN_NOW, espnFixtureClient } from "./burntickerFirstPartyHelpers.ts";
process.env.BURNTICKER_END_SINK_PICKER = "1"; // the picker is a host option (off by default since 2026-10-13); these tests exercise it on

/** The first opponent team `a` meets this season in the fixtures (via /sports/rivalry), or null. */
async function sportsRivalryFirst(p: Parameters<typeof sportsRivalry>[0], league: LeagueId, a: string): Promise<{ opp: string; year: number } | null> {
  for (const b of teamsOf(league)) {
    if (b.abbr === a) continue;
    const r = await sportsRivalry(p, { league, a, b: b.abbr });
    const body = r.body as { offered?: boolean; year?: number | null };
    if (r.status === 200 && body.offered && body.year) return { opp: b.abbr, year: body.year };
    if (r.status === 200 && (body as { scheduleNote?: string | null }).scheduleNote) return null;   // this league's schedule is not readable here
  }
  return null;
}
const REPORT_ONLY = process.env.BURNTICKER_TEST_A_REPORT === "1";
const ENV = { BURNTICKER_CLUSTER: "devnet", BURNTICKER_CREATOR_LAUNCHES_ENABLED: "1" } as Record<string, string>;
const fails = new Map<string, { n: number; samples: string[] }>();
let setups = 0;
const fail = (cat: string, sample: string) => { const f = fails.get(cat) ?? { n: 0, samples: [] }; f.n++; if (f.samples.length < 4) f.samples.push(sample.slice(0, 260)); fails.set(cat, f); };

/** Every user-facing string in a review (the texts a reader sees, not ids, hashes or canonical rule text). */
function userText(r: LaunchReview): string[] {
  return [r.rule.statement, r.rule.sentence, r.rule.share, r.rule.presets, r.rule.endsLine, r.budget, r.prerequisiteLine, r.typeReason ?? "", r.signing ?? "",
    ...r.coins.flatMap((c) => [c.name, c.description ?? ""]), ...r.costs.lines.map((l) => l.label), r.costs.note, ...r.prerequisites, ...r.warnings, ...r.problems, ...(r.raise ? [r.raise.line] : []),
    ...((r as { projection?: { lines?: string[]; reason?: string | null } }).projection?.lines ?? [])];
}
const RAW_ID = /\b(espn\.(team|game):[a-z0-9.]+-|nws\.[a-z]+:|ll2\.launch:|the launch with Launch Library 2 id|github\.milestone:|youtube\.milestone:|[a-z]+\.[A-Za-z0-9]+:[A-Za-z0-9_./-]+)/;
const lam = (s: string): number => Math.round(Number(s.replace(/,/g, "")) * 1e9);

/** The checks every review gets, whatever its source. */
function checkReview(label: string, rule: BurnRule, r: LaunchReview, o: { series?: string | null } = {}): void {
  for (const t of userText(r)) {
    if (/\bundefined\b|\bNaN\b|\[object Object\]/.test(t)) fail("text: undefined/NaN", `${label}: ${t}`);
    if (o.series && t.includes(o.series)) fail("text: raw source id", `${label}: ${t}`);
    else if (RAW_ID.test(t)) fail("text: raw source id", `${label}: ${RAW_ID.exec(t)![0]} in "${t}"`);
    // sources-6 (QA pass 9 #18-#21): words a rule's type does not have
    const sports = rule.oracle === "catalogue" && /^espn\./.test(rule.series ?? "");
    if (!sports && /season is cancelled|through the postseason/.test(t)) fail("text: season words on a non-sports rule", `${label}: ${t}`);
    if (/\bEach 1 [a-z]/.test(t)) fail("text: 'Each 1 <unit>'", `${label}: ${t}`);
    if (/\bthe (Leeds United|Arsenal|Manchester City|Manchester United|Inter Miami|Real Madrid)\b/.test(t)) fail("text: an article before a club", `${label}: ${t}`);
  }
  // the end line never contradicts the rule's own end: a rule with an end sink says where the rest goes and never that it "sends nothing"
  const end = r.rule.endsLine, sink = describeEndSink(rule), perpetual = /no end date/.test(end);
  if (!perpetual) {
    if (sink && /sends nothing to another coin/.test(end)) fail("end text contradicts onEnd", `${label}: ${end}`);
    if (sink === "flagship" && !/\$DEFICIT/.test(end)) fail("end text contradicts onEnd", `${label}: no $DEFICIT in "${end}"`);
    if (!sink && /\$DEFICIT/.test(end)) fail("end text contradicts onEnd", `${label}: $DEFICIT without a sink in "${end}"`);
    if (sink && /\$DEFICIT/.test(end) && /burns down (on this coin )?what is left over \d+ days\. Then the coin retires/.test(end) && !/void|cancel/i.test(end)) fail("end text contradicts onEnd", `${label}: ${end}`);
  }
  for (const d of r.coins.map((c) => c.description ?? "")) if (sink && /sends nothing to another coin/.test(d)) fail("end text contradicts onEnd", `${label} description: ${d}`);
  const sum = r.costs.lines.reduce((a, l) => a + lam(l.sol), 0), total = lam(r.costs.totalSol);
  if (Math.abs(sum - total) > 100_000) fail("cost lines do not sum to the total", `${label}: ${r.costs.lines.map((l) => l.sol).join(" + ")} != ${r.costs.totalSol}`);
  for (const ph of r.feesPerSol) { const s = ph.legs.reduce((a, l) => a + lam(l.sol), 0); if (Math.abs(s - lam(ph.totalSol)) > 10) fail("fee legs do not sum to totalSol", `${label} ${ph.phase}: ${ph.legs.map((l) => l.sol).join(" + ")} != ${ph.totalSol}`); }
}

/** One setup: the review and the bundle's refusal on the same body; parity and the text checks. */
async function setup(p: Parameters<typeof prepareLaunch>[0], label: string, body: Record<string, unknown>, o: { series?: string | null; network?: boolean } = {}): Promise<{ review: LaunchReview | null; refused: boolean }> {
  setups++;
  let rv: ReturnType<typeof buildLaunchReview>;
  try { rv = buildLaunchReview(body as never, { env: ENV, kalshiEnabled: p.kalshiEnabled !== false, existing: lookalikeRows(p.registry), now: ESPN_NOW }); } catch (e) { fail("throws (review)", `${label}: ${(e as Error).message}`); return { review: null, refused: true }; }
  let bundle: Awaited<ReturnType<typeof prepareLaunch>>;
  try { bundle = await prepareLaunch(p, { creator: CREATOR, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true }, description: "", links: [], ...body }, { register: false }); }
  catch (e) { fail("throws (bundle)", `${label}: ${(e as Error).message}`); return { review: "review" in rv ? rv.review : null, refused: true }; }
  const bErr = "error" in bundle ? bundle.error : null;
  // a venue this host has turned off answers 503 by design (KALSHI_UNAVAILABLE / POLYMARKET_UNAVAILABLE); anything else 5xx is a failure
  if (bErr && bErr.status >= 500 && !o.network && !/is not turned on for this site|turned off on this site/.test(String((bErr.body as { error?: string }).error))) fail("bundle 5xx", `${label}: ${bErr.status} ${(bErr.body as { error?: string }).error}`);
  const reviewProblems = "problems" in rv ? rv.problems : [...rv.review.problems, ...(rv.review.typeAvailable ? [] : [rv.review.typeReason ?? "type"])];
  const reviewRefuses = reviewProblems.length > 0, bundleRefuses = !!bErr;
  // website-22 (audit 10 item 10): every problem the review reports reaches the launch page's one list of blockers, each said once
  { const norm = (x: string) => x.trim().replace(/\.$/, "").toLowerCase(); const listed = reviewBlockers({ serverProblems: reviewProblems }); if (listed.length !== new Set(reviewProblems.map(norm).filter(Boolean)).size || reviewProblems.some((x) => x.trim() && !listed.some((y) => norm(y) === norm(x)))) fail("review blockers: a problem missing from the page's list", `${label}: ${reviewProblems.join(" | ")}`); }
  if (!(o.network && bErr && bErr.status >= 500)) {
    if (!reviewRefuses && bundleRefuses) fail(`parity: review ok, bundle refuses [${String((bErr!.body as { error?: string }).error).replace(/[0-9A-Z]{2,}[0-9A-Za-z.:-]*/g, "#").slice(0, 70)}]`, `${label}: ${bErr!.status} ${(bErr!.body as { code?: string }).code ?? ""} ${(bErr!.body as { error?: string }).error}`);
    if (reviewRefuses && !bundleRefuses) fail("parity: review refuses, bundle ok", `${label}: ${reviewProblems.join(" | ")}`);
  }
  if ("review" in rv) { const raw = body.rule as { onEnd?: unknown }; checkReview(label, lockRule(raw.onEnd === undefined ? { ...raw, onEnd: { ...DEFAULT_ON_END } } : raw).rule, rv.review, o); }
  return { review: "review" in rv ? rv.review : null, refused: bundleRefuses };
}

test("TEST A: review ↔ bundle parity over ≥ 5,000 setups", { timeout: 600_000 }, async () => {
  setNativeClients({ espn: espnFixtureClient() });
  const w = await makeWorld();
  const p = w.p;
  const t0 = Date.now();
  const RAISES = ["40", "60", "85"];
  const SHARES = [0.01, 0.02, 0.05, 0.1], ONE_SHOT = [0.5, 1];

  // ---- 1. every league × 3 teams × every burn mode × shares × raises -------------------------------------------------------------
  const tickersBySeason = new Map<string, Map<string, string>>();
  for (const league of Object.keys(LEAGUES) as LeagueId[]) {
    const year = seasonYearAt(league, ESPN_NOW);
    const all = teamsOf(league);
    // default tickers of every team in the league (season wins): unique within the league and season, and across leagues
    for (const t of all) {
      let series: string; try { series = teamSeries(league, t.abbr, "win", { kind: "season", year }); } catch { continue; }
      const tk = teamTickerForRule(firstPartyRule(series, 0.02), t.abbr) ?? "";
      const key = `${year}`;
      const m = tickersBySeason.get(key) ?? new Map<string, string>();
      if (m.has(tk)) fail("default tickers collide (league + season)", `${tk}: ${m.get(tk)} and ${league} ${t.name}`);
      else m.set(tk, `${league} ${t.name}`);
      tickersBySeason.set(key, m);
    }
    const picks = [all[0], all[Math.floor(all.length / 2)], all[all.length - 1]];
    for (const t of picks) {
      let win: string; try { win = teamSeries(league, t.abbr, "win", { kind: "season", year }); } catch { fail("throws (series)", `${league} ${t.abbr}`); continue; }
      const ticker = (teamTickerForRule(firstPartyRule(win, 0.02), t.abbr) ?? "XX").slice(0, 10);
      for (const raiseSol of RAISES) {
        for (const f of SHARES) {
          const every = firstPartyRule(win, f);
          const r = await setup(p, `${league} ${t.abbr} every ${f} ${raiseSol}`, { rule: every, ticker, name: `${t.nickname} Wins`.slice(0, 32), raiseSol }, { series: win });
          if (r.review && !new RegExp(t.nickname.split(" ")[0], "i").test(r.review.rule.sentence)) fail("sentence does not name the team", `${league} ${t.abbr}: ${r.review.rule.sentence}`);
          const fade = { ...every, inverse: true } as BurnRule;
          const ft = teamTickerForRule(fade, t.abbr) ?? "XX";
          const rf = await setup(p, `${league} ${t.abbr} fade ${f} ${raiseSol}`, { rule: fade, ticker: ft, name: `${t.nickname} No Win`.slice(0, 32), raiseSol }, { series: win });
          if (rf.review && !/\bnot\b|\bno\b|without/i.test(rf.review.rule.sentence)) fail("fade sentence does not say 'not'", `${league} ${t.abbr}: ${rf.review.rule.sentence}`);
          // winner takes the burn: two team coins are separate coins (the page greys it); a pair on an ESPN series is refused by both
          await setup(p, `${league} ${t.abbr} winner ${f} ${raiseSol}`, { rule: every, ticker, name: `${t.nickname} Wins`.slice(0, 32), raiseSol, pair: { ticker: "RIVALX", name: "Rival side", description: "", imageUrl: null, links: [] } }, { series: win });
          // this game only: one ESPN game
          const game = gameSeries(league, "401000001", t.abbr, "loss");
          await setup(p, `${league} ${t.abbr} game ${f} ${raiseSol}`, { rule: firstPartyRule(game, f), ticker: `${ticker.slice(0, 6)}GAME`, name: `${t.nickname} Game`.slice(0, 32), raiseSol }, { series: game });
        }
        for (const f of ONE_SHOT) {
          // once: the title market (a one-market Polymarket rule), at the one-shot shares
          const once = { schema: "burnticker.rules/v1", oracle: "polymarket", series: null, market: EAGLES_CID, filter: {}, kind: "binary", binary: { onYes: { fractionOfPool: f }, onNo: null }, scalar: null, onVoid: "skip", floorUsd: "1", reserveSol: "0.02", vault: null };
          await setup(p, `${league} ${t.abbr} once ${f} ${raiseSol}`, { rule: once, ticker: teamTicker(t.abbr, { league, window: "title" }), name: `${t.nickname} Title`.slice(0, 32), raiseSol }, { network: true });
        }
      }
    }
  }

  // ---- 1b. RIVALRY-SERIES item 4: a meetings pair (every game between two teams this season) for every league with a listed meeting ----
  // Both the review and the bundle accept it (the one ESPN-family pair that is allowed); the review carries the per-game and season-end
  // money path and side B's description; a lone meetings coin is refused by both.
  const leaguesWithMeetings: string[] = [];
  for (const league of Object.keys(LEAGUES) as LeagueId[]) {
    for (const t of teamsOf(league)) {
      const r = await sportsRivalryFirst(p, league, t.abbr);
      if (!r) continue;
      leaguesWithMeetings.push(league);
      const year = r.year, rules = meetingsPairRules(league, t.abbr, r.opp, year), names = meetingsPairNames(t, teamsOf(league).find((x) => x.abbr === r.opp)!);
      for (const f of SHARES) {
        const rv = await setup(p, `${league} ${t.abbr}v${r.opp} meetings ${f}`, { rule: { ...rules.a, scalar: { ...rules.a.scalar!, perUnit: { fractionOfPool: f } } }, ticker: names.a.ticker, name: names.a.name, raiseSol: "85", pair: { ticker: names.b.ticker, name: names.b.name, description: "", imageUrl: null, links: [] } }, { series: rules.a.series });
        if (rv.refused) fail("meetings pair refused", `${league} ${t.abbr} v ${r.opp} ${f}`);
        if (rv.review && !rv.review.meetings) fail("meetings review has no money path", `${league} ${t.abbr} v ${r.opp}`);
        if (rv.review && rv.review.end.kind !== "pair-winner") fail("meetings end is not the pair winner", `${league}: ${rv.review.end.kind}`);
      }
      const lone = await setup(p, `${league} ${t.abbr}v${r.opp} meetings alone`, { rule: rules.a, ticker: names.a.ticker, name: names.a.name, raiseSol: "85" }, { series: rules.a.series });
      if (!lone.refused) fail("a lone meetings coin was not refused", `${league} ${t.abbr}`);
      break;
    }
  }
  if (!leaguesWithMeetings.length) fail("no league with a listed meeting in the fixtures", "TEST A item 4");

  // ---- 2. every catalogue source × shares × directions -----------------------------------------------------------------------------
  const sources = catalogueSources(ESPN_NOW).sources as unknown as { id: string; kind: string; unit: { size: number } | null; direction: string | null; baseline: unknown; launchable: { ok: boolean } }[];
  for (const s of sources) {
    for (const dir of ["up", "down", "abs"]) for (const f of [...SHARES, 0.25, 0.3, ...ONE_SHOT]) {
      const rule = s.kind === "market" || s.kind === "assertion"
        ? { schema: "burnticker.rules/v1", oracle: s.id === "polymarket" ? "polymarket" : s.id, series: null, market: s.id === "polymarket" ? EAGLES_CID : "SOME-MARKET", filter: {}, kind: "binary", binary: { onYes: { fractionOfPool: f }, onNo: null }, scalar: null, onVoid: "skip", floorUsd: "1", reserveSol: "0.02", vault: null }
        : { ...DEBT_RULE, series: s.id, scalar: { unit: s.unit?.size ?? 1, perUnit: { fractionOfPool: f }, baseline: s.baseline ?? "previousSettlement", direction: dir } };
      const r = await setup(p, `source ${s.id} ${dir} ${f}`, { rule, ticker: "FEEDCOIN", name: "Feed Coin", raiseSol: "85" }, { series: s.kind === "market" || s.kind === "assertion" ? null : s.id, network: s.id === "polymarket" });
      if (!s.launchable.ok && r.review && r.review.problems.length === 0) fail("unlaunchable source reviewed without a problem", `${s.id} ${dir} ${f}`);
    }
  }
  // the dangerous selector bodies from the audit: oracles that are off, unknown series, reserves, a catastrophic regex
  const KX = { schema: "burnticker.rules/v1", oracle: "kalshi", series: "KXNFLGAME", market: null, filter: { tickerIncludes: "-DEN" }, kind: "binary", binary: { onYes: { fractionOfPool: 0.02 }, onNo: null }, scalar: null, onVoid: "skip", floorUsd: "1", reserveSol: "0.02", vault: null };
  const hostile: [string, unknown][] = [
    ["uma", { ...KX, oracle: "uma" }], ["kalshi off", KX], ["unknown series", { ...DEBT_RULE, series: "nope.nothing" }],
    ["reserve 0", { ...DEBT_RULE, reserveSol: "0" }], ["reserve 1000", { ...DEBT_RULE, reserveSol: "1000" }], ["reserve 0.5", { ...DEBT_RULE, reserveSol: "0.5" }],
    ["regex (a+)+$", { ...KX, filter: { titleRegex: "(a+)+$" } }], ["regex (.*a){12}", { ...KX, filter: { titleRegex: "(.*a){12}" } }], ["regex ([a-z]+)*x", { ...KX, filter: { titleRegex: "([a-z]+)*x" } }], ["regex ok", { ...KX, filter: { titleRegex: "^Denver" } }],
  ];
  const kOn = p.kalshiEnabled; p.kalshiEnabled = false;
  for (const [l, rule] of hostile) for (const raiseSol of RAISES) { const r = await setup(p, `hostile ${l} ${raiseSol}`, { rule, ticker: "HOSTILE", name: "Hostile", raiseSol }); if (l !== "regex ok" && l !== "reserve 0.5" && r.review && !r.review.problems.length) fail("hostile body reviewed without a problem", `${l}`); }
  p.kalshiEnabled = kOn;

  // ---- 3. search queries ---------------------------------------------------------------------------------------------------------
  const QUERIES = ["dodgers", "Dodgers win the World Series", "yankees", "rays", "broncos", "chiefs", "lakers", "celtics", "bruins", "avalanche", "arsenal", "real madrid", "atlanta", "arizona", "hawks", "dream", "atlanta united",
    "cardinals", "debt", "national debt", "inflation", "cpi", "eggs", "unemployment", "rocket launches", "spacex", "solar flares", "asteroid", "bitcoin", "github stars", "steam players", "denver high", "rain in denver", "snow", "fed rate cut", "abdul el-sayed", "michigan senate", "", "$$$", "<script>alert(1)</script>"];
  for (const q of QUERIES) {
    let r: Awaited<ReturnType<typeof search>>;
    try { r = await search(p, { q }, ESPN_NOW); } catch (e) { fail("throws (search)", `${q}: ${(e as Error).message}`); continue; }
    if (r.status >= 500) { fail("search 5xx", `${q}: ${r.status}`); continue; }
    const cards = ((r.body as { cards?: { id: string; rule: BurnRule | null; suggestedTicker: string | null; suggestedName: string | null; title: string; subtitle: string }[] }).cards ?? []);
    for (const c of cards) {
      for (const t of [c.title, c.subtitle]) if (/\bundefined\b|\bNaN\b/.test(t ?? "")) fail("text: undefined/NaN", `search ${q} ${c.id}: ${t}`);
      if (!c.rule) continue;
      const e = c.rule.oracle === "catalogue" && /^espn\.team:/.test(c.rule.series ?? "");
      if (e && c.suggestedTicker) { const want = teamTickerForRule(c.rule); if (want && c.suggestedTicker.replace(/\d+$/, "") !== want && c.suggestedTicker !== want) fail("ticker generators disagree", `search "${q}" ${c.rule.series}: ${c.suggestedTicker} vs wizard ${want}`); }
      await setup(p, `search "${q}" ${c.id}`, { rule: c.rule, ticker: c.suggestedTicker ?? "SEARCHED", name: c.suggestedName ?? "Searched", raiseSol: "85" }, { series: c.rule.oracle === "catalogue" ? c.rule.series : null, network: c.rule.oracle !== "catalogue" });
    }
  }

  // ---- 4. the sports teams API: tickers agree with the wizard, finished teams carry a warning, no bare record ----------------------
  for (const league of Object.keys(LEAGUES) as LeagueId[]) {
    let r; try { r = await sportsTeams(p, { league }); } catch (e) { fail("throws (teams)", `${league}: ${(e as Error).message}`); continue; }
    const teams = (r.body as { teams?: Record<string, unknown>[] }).teams ?? [];
    for (const t of teams) {
      const series = (t.series as { win: string }).win;
      const want = teamTickerForRule(firstPartyRule(series, 0.02), t.abbr as string);
      if (t.ticker !== want) fail("ticker generators disagree", `teams ${league} ${t.abbr}: ${String(t.ticker)} vs wizard ${want}`);
      if ("record" in t && (t.record === null || t.record === "—")) fail("teams: record null/dash", `${league} ${t.abbr}`);
      const season = t.season as { status?: string; warning?: string | null } | undefined;
      if (t.next === null && !(season && (season.status === "playing" || season.warning || season.status === "unknown"))) fail("season rule offered with no remaining games and no warning", `${league} ${t.abbr}`);
    }
  }

  // ---- 5. name / ticker / description fuzz -----------------------------------------------------------------------------------------
  const NAMES = ["", "A", "AB", "Ten chars!", "Eleven char", "Fourteen chars", "Fifteen chars!!", "lowercase name", "  spaced  ", "$DOLLAR", "Emoji 🔥 coin", "Café Olé", "Sol", "Bitcoin", "<script>alert(1)</script>", "<img src=x onerror=alert(1)>", "Quote \" and ' & amp", "Line\nbreak", "Tab\there", "Zero​width", "Bidi‮evil", "x".repeat(33), "Deficit", "Burn Ticker"];
  const TICKERS = ["", "A", "AB", "ABCDEFGHIJ", "ABCDEFGHIJK", "ABCDEFGHIJKLMN", "lower", "SP ACE", "$DOL", "🔥🔥", "ÉCOLE", "SOL", "USDC", "USDT", "BTC", "ETH", "WSOL", "BONK", "WIF", "JUP", "DEFICIT", "BURNTICKER", "OK2"];
  const DESCS = ["", "x", "Plain words.", "x".repeat(280), "x".repeat(281), "<script>alert(1)</script>", "Line\nbreak", "Bidi‮evil", "Zero​width"];
  const MAJORS = new Set(["SOL", "USDC", "USDT", "BTC", "ETH", "WSOL", "BONK", "WIF", "JUP"]);
  for (const name of NAMES) for (const ticker of TICKERS) {
    const r = await setup(p, `fuzz name=${JSON.stringify(name)} ticker=${JSON.stringify(ticker)}`, { rule: DEBT_RULE, ticker, name, raiseSol: "85" }, { series: "treasury.debt" });
    if (!r.refused && (MAJORS.has(ticker) || MAJORS.has(name.toUpperCase()))) fail("major ticker accepted", `${ticker} / ${name}`);
    if (!r.refused && /[\n\r\t​-‏‪-‮⁦-⁩﻿]/.test(name)) fail("control character accepted", JSON.stringify(name));
  }
  for (const d of DESCS) {
    const r = await setup(p, `fuzz description=${JSON.stringify(d.slice(0, 30))}(${d.length})`, { rule: DEBT_RULE, ticker: "DESCOK", name: "Desc Coin", creatorDescription: d, raiseSol: "85" }, { series: "treasury.debt" });
    if (!r.refused && /[\n\r\t​-‏‪-‮⁦-⁩﻿]/.test(d)) fail("control character accepted", `description ${JSON.stringify(d)}`);
  }

  // ---- 7 (audit 7). rivalry pairs: every listed MLB game, both sides; the review's due date is the picked game, never the next one --
  const mlbGames = await espnFixtureClient().upcoming("mlb", 8).catch(() => []);
  if (!mlbGames.length) fail("rivalry: no fixture games to test", "mlb");
  for (const g of mlbGames) for (const [me, them] of [[g.away, g.home], [g.home, g.away]]) {
    if (me.abbr === "TBD" || them.abbr === "TBD") continue;   // a side not decided yet is never offered (search.ts matchupCard)
    const rule = firstPartyRule(gameSeries("mlb", g.eventId, me.abbr, "loss"), 0.05);
    const other = firstPartyRule(gameSeries("mlb", g.eventId, them.abbr, "loss"), 0.05);
    const body = { rule, ticker: teamTickerForRule(rule) ?? "GAMEA", name: `${me.nickname || me.abbr} Lose`.slice(0, 32), raiseSol: "85", companion: { rule: other, ticker: teamTickerForRule(other) ?? "GAMEB", name: `${them.nickname || them.abbr} Lose`.slice(0, 32) } };
    setups++;
    let rv: ReturnType<typeof buildLaunchReview>;
    try { rv = buildLaunchReview(body as never, { env: ENV, now: ESPN_NOW, game: { eventId: g.eventId, startsAt: g.startsAt, name: g.name, detail: g.detail } }); } catch (e) { fail("throws (review)", `rivalry ${g.eventId}: ${(e as Error).message}`); continue; }
    if (!("review" in rv)) { fail("rivalry: review refused", `${g.eventId}: ${rv.problems.join(" | ")}`); continue; }
    const t = rv.review.timing;
    if (!t || t.dueAt !== new Date(g.startsAt).toISOString()) fail("rivalry: due date is not the picked game", `${g.eventId} ${g.startsAt}: ${t?.dueAt}`);
    if (t && /if\s+necessary/i.test(`${g.detail} ${g.name}`) !== /\(if necessary\)/.test(t.dueLabel ?? "")) fail("rivalry: 'if necessary' not labelled", `${g.eventId}: ${t.dueLabel}`);
    if (!t?.unplayed) fail("rivalry: unplayed game not stated", `${g.eventId} ${me.abbr} ${rule.series}`);
    if (t && t.dueWithinDays !== null && t.dueWithinDays <= 14 && !rv.review.warnings.some((w) => /due within/.test(w))) fail("one-shot due soon without the warning", `${g.eventId}: ${t.dueWithinDays} days`);
    checkReview(`rivalry ${g.eventId} ${me.abbr}`, lockRule({ ...rule, onEnd: { ...DEFAULT_ON_END } }).rule, rv.review, { series: rule.series });
    // 2026-10-13: the same game as ONE linked pair (the default): each coin on its own team's win, both sinks naming each other, LaunchLab
    setups++;
    const linkedRule = gamePairRule("mlb", g.eventId, me.abbr);
    let lv: ReturnType<typeof buildLaunchReview>;
    try { lv = buildLaunchReview({ rule: linkedRule, ticker: `${me.abbr}GM`.slice(0, 10), name: `${me.nickname || me.abbr} Game`.slice(0, 32), raiseSol: "85", pair: { ticker: `${them.abbr}GM`.slice(0, 10), name: `${them.nickname || them.abbr} Game`.slice(0, 32), opp: them.abbr } } as never, { env: { ...ENV, BURNTICKER_PAIR_CURVE_ENABLED: "1" }, now: ESPN_NOW }); } catch (e) { fail("throws (review)", `linked game ${g.eventId}: ${(e as Error).message}`); continue; }
    if (!("review" in lv)) { fail("linked game: review refused", `${g.eventId}: ${lv.problems.join(" | ")}`); continue; }
    if (lv.review.problems.length) fail("linked game: problems", `${g.eventId} ${me.abbr}: ${lv.review.problems.join(" | ")}`);
    if (lv.review.venue !== "launchlab") fail("linked game: not LaunchLab", `${g.eventId}: ${lv.review.venue}`);
    if (lv.review.settled?.sentence !== GAME_PAIR_SENTENCE || lv.review.end.kind !== "pair-winner") fail("linked game: sentence or end", `${g.eventId}: ${lv.review.settled?.sentence} / ${lv.review.end.kind}`);
  }

  // ---- 8 (audit 7). election pairs and market one-shots: two candidates' markets, due soon / not soon --------------------------------
  const market = (cid: string, f: number, endsAt: string) => ({ rule: { schema: "burnticker.rules/v1", oracle: "polymarket", series: null, market: cid, filter: {}, kind: "binary", binary: { onYes: { fractionOfPool: f }, onNo: null }, scalar: null, onVoid: "skip", floorUsd: "1", reserveSol: "0.02", vault: null }, descCtx: { endsAt } });
  for (const days of [1, 3, 13, 15, 40]) for (const f of ONE_SHOT) {
    const endsAt = new Date(ESPN_NOW + days * 86_400_000).toISOString();
    const a = market(EAGLES_CID, f, endsAt), b = market(BUCS_CID, f, endsAt);
    // owner 2026-10-13: an election pair is ONE linked pair (candidate B's market and the race on the pair side), never two separate coins
    const linked = { rule: { ...candidatesPairRule(EAGLES_CID, f) }, descCtx: { endsAt } };
    for (const [label, body] of [[`market one-shot ${days}d ${f}`, { ...a, ticker: "CANDA", name: "Candidate A" }], [`election pair ${days}d ${f}`, { ...linked, ticker: "CANDA", name: "Candidate A", pair: { ticker: "CANDB", name: "Candidate B", market: b.rule.market, race: "michigan-senate-election-winner" } }]] as const) {
      setups++;
      let rv: ReturnType<typeof buildLaunchReview>;
      try { rv = buildLaunchReview(body as never, { env: ENV, now: ESPN_NOW }); } catch (e) { fail("throws (review)", `${label}: ${(e as Error).message}`); continue; }
      if (!("review" in rv)) { fail("market: review refused", `${label}: ${rv.problems.join(" | ")}`); continue; }
      const warned = rv.review.warnings.some((w) => /due within/.test(w));
      if (warned !== days <= 14) fail("one-shot due-soon warning wrong", `${label}: warned=${warned}`);
      if (label.startsWith("election pair")) {
        if (rv.review.venue !== "launchlab" || rv.review.settled?.sentence !== CANDIDATES_PAIR_SENTENCE || rv.review.end.kind !== "pair-winner") fail("election pair: not the linked LaunchLab pair", `${label}: ${rv.review.venue} ${rv.review.end.kind}`);
        if (rv.review.problems.length) fail("election pair: problems", `${label}: ${rv.review.problems.join(" | ")}`);
        continue;
      }
      checkReview(label, lockRule({ ...a.rule, onEnd: { ...DEFAULT_ON_END } }).rule, rv.review);
    }
  }
  // the search hides one-time markets closing within 48 hours unless asked (closingSoonCard)
  for (const [h, hidden] of [[1, true], [47, true], [49, false], [24 * 30, false]] as const) {
    setups++;
    const card = { venue: "polymarket" as const, shape: "one-shot" as const, endAt: new Date(ESPN_NOW + h * 3_600_000).toISOString(), settleAt: null };
    if (closingSoonCard(card, ESPN_NOW) !== hidden) fail("closing-soon filter wrong", `${h} h`);
  }

  // ---- 9 (audit 7). link fields: the review and the bundle refuse the same links -------------------------------------------------
  const LINKS: [string, string, boolean][] = [
    ["X", "javascript:alert(1)", false], ["X", "data:text/html,<script>alert(1)</script>", false], ["X", "http://x.com/coin", false], ["X", "https://facebook.com/coin", false],
    ["X", "https://x.com/burncoin", true], ["X", "https://twitter.com/burncoin", true], ["Telegram", "https://t.me/burncoin", true], ["Telegram", "https://example.com/tg", false],
    ["Website", "https://burnticker.com", false], ["Website", "https://app.burnticker.com/x", false], ["Website", "https://burntlcker.com", false], ["Website", "https://burnt1cker.io", false],
    ["Website", "https://def1cit.xyz", false], ["Website", "https://xn--burntcker-abc.com", false], ["Website", "notaurl", false], ["Website", "https://example.com", true], ["Website", "https://github.com/anza-xyz", true],
  ];
  for (const [label, url, okLink] of LINKS) {
    const r = await setup(p, `link ${label} ${url}`, { rule: DEBT_RULE, ticker: "LINKOK", name: "Link Coin", raiseSol: "85", links: [{ label, url }] }, { series: "treasury.debt" });
    if (r.refused === okLink) fail("link field verdict wrong", `${label} ${url}: refused=${r.refused}`);
  }

  // ---- 6. the share limits say one range per rule type (the lock error, the bounds) ------------------------------------------------
  for (const [label, rule] of [["recurring 0.3", { ...DEBT_RULE, scalar: { ...DEBT_RULE.scalar, perUnit: { fractionOfPool: 0.3 } } }], ["team 0.3", firstPartyRule(teamSeries("mlb", "LAD", "win", { kind: "season", year: 2026 }), 0.3)]] as const) {
    try { lockRule(rule); fail("share limit accepted", label); } catch (e) { const m = /\[([\d.]+), ([\d.]+)\]/.exec((e as Error).message); if (!m || Number(m[2]) !== RULE_BOUNDS.fractionOfPool.max) fail("share limit text disagrees", `${label}: ${(e as Error).message}`); }
  }
  void DEFAULT_ON_END;

  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const lines = [...fails.entries()].sort((a, b) => b[1].n - a[1].n).map(([k, v]) => `  ${String(v.n).padStart(6)}  ${k}\n${v.samples.map((s) => `            e.g. ${s}`).join("\n")}`);
  console.log(`TEST A: ${setups} setups in ${secs}s; ${[...fails.values()].reduce((a, f) => a + f.n, 0)} failures in ${fails.size} categories\n${lines.join("\n")}`);
  assert.ok(setups >= 5000, `only ${setups} setups`);
  if (!REPORT_ONLY) assert.deepEqual([...fails.keys()], [], "TEST A failures (see the summary above)");
});
