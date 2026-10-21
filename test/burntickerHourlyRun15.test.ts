// HOURLY AUDIT 2026-10-20 03:10 DENVER, RUN 15 (docs/burnticker/audits/continuous/2026-10-20-0310-Denver.md; bugs.md HB-78 reopened,
// HB-156 to HB-166; suggestions HS-59, HS-60, HS-11 widened). The three P2 leads on the publish-103 tree first (HB-164 the first snow's
// end, HB-163 the memo refresher's cadence, HB-165 the market search filter), then the live P3 copy items.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import { openRegistry } from "@/lib/burnticker/registry";
import { FakeBurnProgram } from "@/lib/burnticker/program";
import { buildLaunchBundle, FakeLaunchLab } from "@/lib/burnticker/launchBundle";
import { CatalogueAdapter } from "@/lib/burnticker/catalogue";
import { runCycle, type KeeperDeps } from "@/lib/burnticker/multiKeeper";
import { DEFAULT_ON_END, lockRule, WIND_DOWN_ON_END, type BurnRule } from "@/lib/burnticker/rules";
import { nativeRule } from "@/lib/burnticker/sources/native";
import { nwsSeries } from "@/lib/burnticker/sources/nws";
import type { OracleAdapter } from "@/lib/burnticker/oracle/types";
import { ATTESTER, CREATOR } from "./burntickerRivalrySeriesHelpers.ts";
import { ACTIVE_MS, WARM_HEADER, isVisitorRequest, memoRefresher } from "@/lib/burnticker/memoRefresher";
import fs from "node:fs";
import path from "node:path";

import { closedMatchLine, exactHit, keepHit, noFullMatchLine, noMatchLine, outcomeButtonLabel, searchMatch, type SearchHit } from "@/lib/burnticker/searchMatch";
import { tileRule } from "@/lib/burnticker/derby/tile";
import { FLIP_REST_LINE } from "@/lib/burnticker/derby/spec";
import { PATTERN_REASON, articleFor, budgetCopy, coinvsEndsLine, meetingsStandingLine, rivalrySeriesLabel, subjectKeysMatch, triggerText, wholePoolSliceLine } from "@/lib/burnticker/guidedLaunch";
import { ruleOneLiner } from "@/lib/burnticker/coinCard";
import { derbyExplainer } from "@/lib/burnticker/launchDerby";
import { settledPairFundsFlow } from "@/lib/burnticker/pairFundsFlow";
import { GAME_BURN_LINE, GAME_RESULT_COUNTS_LINE } from "@/lib/burnticker/gameCoin";
import { GAME_PAIR_DETAIL, describeRule } from "@/lib/burnticker/describe";
import { firstPartyRule } from "@/lib/burnticker/wizard";
import { outcomeText } from "@/lib/burnticker/oracle/outcomeFilter";
import { withHitLabel } from "@/lib/burnticker/derby/search";
import { FIELD_HELP } from "@/lib/burnticker/fieldHelp";
import { subjectIsPlural } from "@/lib/burnticker/eventIdentity";
import { heavySpendLine } from "@/lib/burnticker/drain";
import { compoundSentence } from "@/lib/burnticker/teamQuery";
import { BONK, WIF } from "./burntickerDerbyHelpers.ts";
import { lintCopy, loadCopyLintConfig, formatHits } from "@/lib/launch/copyLint";

const ROOT = path.join(import.meta.dirname, "..");
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");
const cfg = loadCopyLintConfig();
const clean = (s: string) => { const r = lintCopy(s, cfg); assert.ok(r.ok, `${s}\n${formatHits(r)}`); };
const plain = (s: string) => { clean(s); assert.doesNotMatch(s, /\bwill\b|\bbuy\b|\bprice\b|coming soon|\bpayouts?\b|\btarget\b|\bguarantee|→|\b20\d\d-\d\d-\d\d\b|\w\/\w+\//i, s); };

const SOL = BigInt(1_000_000_000);
const Z = BigInt(0);
const stub: OracleAdapter = { id: "stub", searchSeries: async () => [], seriesInfo: async () => null, settledSince: async () => ({ events: [], awaitingFinal: 0, refusals: [], settlementSourceUrl: null }), impliedChance: async () => ({ chance: null, marketTicker: null, closeTime: null, basis: "stub" }) };
const D = (iso: string) => Date.parse(iso);

/** One Denver first-snow coin with an end sink ($DEFICIT), the burn pool and the swap pool's SOL reserve as given (2% of it per crank). */
async function snowWorld(o: { fraction: number; dispersal?: boolean; poolLamports?: bigint; reserveWsol?: bigint }) {
  const registry = openRegistry(":memory:"), program = new FakeBurnProgram("devnet");
  program.autoRegisterPool = true; program.pinEndSinks = true;
  const clock = { now: D("2025-10-20T00:00:00Z") };
  program.now = () => clock.now;
  const series = nwsSeries("snow", "DEN");
  const rule = { ...nativeRule(series, { fractionOfPool: o.fraction }), onEnd: { ...DEFAULT_ON_END } } as BurnRule;
  const b = await buildLaunchBundle({ creator: CREATOR, ticker: "DENSNOW", name: "Denver First Snow", description: "", imageUrl: null, links: [], rule, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true }, cluster: "devnet" }, { program, launchLab: new FakeLaunchLab(), devFeeWallet: null, attesters: [ATTESTER], quorum: 1, metadataUri: (m) => `https://x/${m}.json` });
  const t0 = registry.register({ mint: b.mint, ticker: "DENSNOW", name: "Denver First Snow", creator: CREATOR, description: b.description, imageUrl: null, links: [], rulesText: b.rules.text, feePda: b.addresses.feePda, vault: b.addresses.vault, tokenConfig: b.addresses.tokenConfig, poolId: b.addresses.poolId, launchTx: null, cluster: "devnet", platformId: null, baselineAt: "2025-10-01T00:00:00Z", status: "draft" }, D("2025-10-01T00:00:00Z"));
  registry.markLaunched(t0.mint, "launchDENSNOW", b.addresses.poolId, "2025-10-01T00:00:00Z");
  registry.addAttester({ mint: t0.mint, pubkey: ATTESTER, role: "data-key", addedAt: 0, timelockUntil: null });
  program.supplies.set(t0.mint, BigInt("1000000000000000"));
  const coin = program.fake(t0.mint);
  coin.poolReserveWsol = o.reserveWsol ?? BigInt(50) * SOL;
  program.deposit(t0.mint, o.poolLamports ?? BigInt(5) * SOL);
  const flagship = Keypair.generate().publicKey.toBase58();
  await program.initializeToken({ mint: flagship, creator: CREATOR, ticker: "DEFICIT", rulesSha256: "ab".repeat(32), selectorKey: "flagship", mode: "buyback", attesters: [ATTESTER], quorum: 1, vault: null, rule: lockRule({ ...nativeRule("nws.high:DEN-90"), onEnd: WIND_DOWN_ON_END }).rule });
  program.fake(flagship).registerPool();
  program.endSink.flagship = flagship;
  const logs: string[] = [];
  const deps: KeeperDeps = { registry, program, oracles: { kalshi: stub, catalogue: new CatalogueAdapter() }, attester: ATTESTER, log: (l) => logs.push(l), now: () => clock.now, dryRun: false, ...(o.dispersal ? { dispersal: true } : {}) };
  const key = registry.token(t0.mint)!.selectorKey;
  /** Daily snow readings ("1" the first measurable snow, "0" a day without), stored as the keeper's fetch stores them. */
  const readings = (days: [string, "0" | "1"][]) => registry.putReadings("catalogue", key, days.map(([id, value]) => ({ id, at: id, result: null, value, title: `Denver ${id}`, sourceUrl: "https://api.weather.gov/x", method: "nws-cli-final+iem" }) as never), { settlementSourceUrl: null, attestedBy: [ATTESTER] }, clock.now);
  const run = async (until: number, stepMs = 3 * 3600_000) => { while (clock.now < until) { await runCycle(deps, { fetch: false }); clock.now += stepMs; } };
  const sink = program.endSink.port(t0.mint);
  return { registry, program, clock, mint: t0.mint, coin, sink, deps, logs, run, readings, flagship, spentOnCoin: () => coin.cfg.totalSpentLamports, forwarded: async () => (await sink.ruleEnd())?.forwardedLamports ?? Z };
}

describe("HB-164: a first snow under 100% keeps its publish-102 end; only a 100% first snow drains after its first snow", () => {
  for (const order of ["zero day first", "snow day first"] as const) {
    const days: [string, "0" | "1"][] = order === "zero day first" ? [["2025-11-01", "0"], ["2025-11-03", "1"]] : [["2025-11-03", "1"], ["2025-11-04", "0"]];
    test(`a 2% first snow, carried spend > 0, dispersal off, reaches its end sink (${order})`, async () => {
      // a 0.2 SOL crank cap (10 SOL reserve) against 2% of a 50 SOL pool (1 SOL): the result's crank spends 0.2 SOL and carries 0.8 SOL
      const w = await snowWorld({ fraction: 0.02, poolLamports: BigInt(50) * SOL, reserveWsol: BigInt(10) * SOL });
      w.readings(days);
      let carried = Z, guard = 0;
      while (carried === Z && guard++ < 200) { await runCycle(w.deps, { fetch: false }); carried = w.coin.cfg.carriedSpendLamports; w.clock.now += 3 * 3600_000; }
      assert.ok(carried > Z, `the first snow's crank carried spend\n${w.logs.slice(-10).join("\n")}`);
      await w.run(D("2025-11-20T00:00:00Z"));
      const end = w.registry.ruleEnd(w.mint);
      assert.equal(end?.mode, "winddown", "a share under 100% ends as on publish 102");
      assert.match(end!.reason, /^the first snow of the season fell \(2025-11-03\)$/);
      assert.ok(await w.sink.ruleEnd(), `the end is recorded on chain\n${w.logs.slice(-12).join("\n")}`);
      assert.ok((await w.forwarded()) > Z, "the rest reached the end sink with dispersal off");
      assert.ok(!w.logs.some((l) => /not fully spent yet/.test(l)), "nothing holds the end");
      assert.equal(w.registry.alertsSince(0).filter((a) => a.key === `${w.mint}:end-owed`).length, 0, "no end-owed alert");
    });
    test(`a 100% first snow drains on the coin after its first snow (${order})`, async () => {
      const w = await snowWorld({ fraction: 1 });
      w.readings(days);
      await w.run(D("2025-11-20T00:00:00Z"));
      const end = w.registry.ruleEnd(w.mint);
      assert.equal(end?.mode, "drain", w.logs.slice(-10).join("\n"));
      assert.equal(end?.reason, "the first snow of the season fell (2025-11-03) at 100 % of the pool");
      assert.equal(w.spentOnCoin(), BigInt(5) * SOL, "the whole pool was spent on the coin");
      assert.ok(w.registry.receipts(w.mint).filter((r) => r.kind === "drain").length >= 4, "one capped drain crank a day");
      assert.equal(await w.forwarded(), Z);
    });
  }
});

describe("HB-163: the memo timer builds on demand only; nothing for nobody, no fixed beat with visitors", () => {
  const harness = () => {
    let t = 1_000_000, builtAt: number | null = null, refreshes = 0;
    const r = memoRefresher({ refresh: async () => { refreshes++; builtAt = t; }, ageMs: () => (builtAt === null ? null : t - builtAt), freshMs: () => 15_000, now: () => t, enabled: true, tickMs: 60_000_000 });
    /** advance the clock in 2 s ticks (the timer's step) */
    const advance = (ms: number) => { for (let k = 0; k < ms; k += 2_000) { t += 2_000; r.tick(); } };
    return { r, advance, get refreshes() { return refreshes; }, build: () => { refreshes++; builtAt = t; } };
  };
  test("the warm call is not a visitor: no timer, and an hour with no visitor builds nothing", () => {
    const h = harness();
    h.build();   // the warm call's cold build (the route waits for it)
    h.r.touch(isVisitorRequest({ headers: new Headers({ [WARM_HEADER]: "1" }) }));
    assert.equal(h.r.running, false, "the warm call starts no timer");
    h.advance(60 * 60_000);
    assert.equal(h.refreshes, 1, "a quiet hour: no timer build (publish 103 built 60 times)");
    assert.equal(isVisitorRequest({ headers: new Headers() }), true);
    assert.equal(isVisitorRequest(undefined), true, "a route called without a request (a test) counts as a visitor");
  });
  test("one visitor: at most one rebuild after the visit, then nothing for the rest of the five minutes and after", () => {
    const h = harness();
    h.build();
    h.advance(4_000);
    h.r.touch(true);   // a visitor 4 s after the build (the copy is fresh, served as a hit)
    h.advance(10 * 60_000);
    assert.equal(h.refreshes, 2, "one rebuild once the copy passed its window; no 15 s beat for the five active minutes");
  });
  test("steady visitors: the copy is rebuilt when it is older than its window, and not more often", () => {
    const h = harness();
    h.build();
    for (let s = 0; s < 120; s += 4) { h.r.touch(true); h.advance(4_000); }   // a visitor every 4 s for two minutes
    assert.ok(h.refreshes >= 7 && h.refreshes <= 9, `about one rebuild per 15 s window over two minutes (${h.refreshes})`);
    const before = h.refreshes;
    h.advance(ACTIVE_MS + 60_000);
    assert.ok(h.refreshes - before <= 1, "after the visitors leave, at most the one rebuild their last ask earned");
  });
  test("the routes pass the request; web-warm marks its calls; the league table has no timer of its own", () => {
    for (const f of ["src/app/api/burnticker/home/route.ts", "src/app/api/burnticker/tokens/route.ts"]) {
      assert.match(read(f), /export async function GET\(req: Request\)/);
      assert.match(read(f), /\.touch\(isVisitorRequest\(req\)\)/);
    }
    assert.match(read("scripts/service/web-warm.cjs"), /"x-burnticker-warm": "1"/);
    assert.doesNotMatch(read("src/lib/burnticker/leaguesServe.ts"), /setInterval|memoRefresher\(/);
    assert.doesNotMatch(read("src/lib/burnticker/memoRefresher.ts"), /IDLE_REFRESH_MS/);
  });
});

describe("HB-165: the market search keeps exact ids, slugs and one-word aliases; 'closed' only when the server says so; no dimmed list", () => {
  const COND = "0x9cb23d04b2ded06147482076688b69b487a8d982c63ebdda2ab3678cf27cf390";
  const listed = (q: string, hits: SearchHit[]) => { const m = searchMatch(q, hits); return { m, kept: hits.filter((h) => keepHit(m.words, h.texts, { query: q, ids: h.ids })) }; };
  test("a pasted condition id lists its market, undimmed, with no line above it", () => {
    const hits: SearchHit[] = [{ texts: ["Will the Fed cut rates twice in 2026?"], ids: [COND] }];
    const { m, kept } = listed(COND, hits);
    assert.equal(kept.length, 1); assert.equal(m.line, null); assert.equal(m.dim, false);
    assert.equal(exactHit(COND.toUpperCase().replace("0X", "0x"), hits[0]), true, "case does not matter");
  });
  test("an event slug lists its event, undimmed", () => {
    const slug = "will-bitcoin-reach-150000-by-december-31-2026";
    const hits: SearchHit[] = [{ texts: ["What price will Bitcoin hit in 2026?", "↑ 150,000"], ids: [slug, "0xabc"] }];
    const { m, kept } = listed(slug, hits);
    assert.equal(kept.length, 1); assert.equal(m.line, null); assert.equal(m.dim, false);
  });
  test("'superbowl' finds 'Super Bowl' (spaces taken out) and a slug", () => {
    const hits: SearchHit[] = [{ texts: ["Super Bowl Champion 2027", "Kansas City"], ids: ["super-bowl-champion-2027"] }, { texts: ["Who wins the NBA Finals?"], ids: ["nba-finals-2027"] }];
    const { m, kept } = listed("superbowl", hits);
    assert.deepEqual(kept.map((h) => h.texts[0]), ["Super Bowl Champion 2027"]); assert.equal(m.line, null); assert.equal(m.dim, false);
    assert.equal(listed("superbowl", [{ texts: ["Champion"], ids: ["superbowl-lx"] }]).kept.length, 1, "the slug alone");
  });
  test("'AOC' finds 'Alexandria Ocasio-Cortez' by initials, or the slug", () => {
    const hits: SearchHit[] = [{ texts: ["Will Alexandria Ocasio-Cortez run for president?"], ids: ["will-alexandria-ocasio-cortez-run"] }, { texts: ["Cali Open: Smith vs Jones"], ids: ["cali-open"] }];
    const { m, kept } = listed("AOC", hits);
    assert.deepEqual(kept.map((h) => h.texts[0]), ["Will Alexandria Ocasio-Cortez run for president?"]); assert.equal(m.line, null);
    assert.equal(listed("aoc", [{ texts: ["Democratic nominee"], ids: ["aoc-2028"] }]).kept.length, 1);
  });
  test("'gop senate' on an open Senate market: listed, not dimmed, and never 'Closed markets are not listed'", () => {
    const hits: SearchHit[] = [{ texts: ["Which party wins the Senate in 2026?", "Republican", "Democratic"], ids: ["senate-2026"], closed: false }];
    const { m, kept } = listed("gop senate", hits);
    assert.equal(kept.length, 1); assert.equal(m.dim, false);
    assert.equal(m.line, "No open market matches “gop senate”. Here are the closest open ones:");
    assert.doesNotMatch(m.line!, /closed/i);
    // the closed sentence only when the server marked every hit that matches every word closed
    const closed = searchMatch("senate 2024", [{ texts: ["Senate 2024 control"], closed: true }, { texts: ["Senate 2026 control"] }]);
    assert.equal(closed.line, closedMatchLine("senate 2024"));
    assert.equal(searchMatch("senate 2024", [{ texts: ["Senate 2024 control"], closed: false }]).line, null);
  });
  test("HS-57 still holds: 'zzqxv nothing here' drops the hits that matched on 'here'; the copy is plain", () => {
    const { m, kept } = listed("zzqxv nothing here", [{ texts: ["CS Herediano vs Saprissa"], ids: ["herediano-saprissa"] }]);
    assert.equal(kept.length, 0); assert.equal(m.line, noMatchLine("zzqxv nothing here"));
    for (const s of [closedMatchLine("senate 2024"), noFullMatchLine("gop senate"), noMatchLine("snow day")]) plain(s);
  });
});

// ---------------------------------------------------------------- commit 2: the live P3s and the suggestions ----------------------------------------------------------------

describe("HB-78 reopened: the flippening says its one end, word for word, on all five surfaces", () => {
  const NOW = Date.UTC(2026, 9, 20, 9);
  const t = tileRule({ a: WIF, b: BONK, window: "daily", seasonDays: 30, flip: true, fraction: 1, now: NOW }, "09567dbee8" + "0".repeat(54), { a: "WIFVBONK", b: "BONKVWIF" });
  const ruleA = t.rule!;
  const ruleB = { ...ruleA, binary: { onYes: null, onNo: ruleA.binary!.onYes } } as BurnRule;
  test("burn step, When it ends, the Name-step cards, the review's trigger row and What this creates, in full", () => {
    const surfaces = {
      burnStep: t.sentence,
      whenItEnds: coinvsEndsLine(ruleA)!,
      nameCardA: ruleOneLiner(ruleA),
      nameCardB: ruleOneLiner(ruleB),
      triggerRow: triggerText({ pair: { a: "WIFVBONK", b: "BONKVWIF", oneA: ruleOneLiner(ruleA), oneB: ruleOneLiner(ruleB), end: FLIP_REST_LINE }, fallback: "" }),
      inFull: derbyExplainer(t.spec, { a: "WIFVBONK", b: "BONKVWIF" }, { timeZone: "America/New_York" }).end,
    };
    for (const [k, s] of Object.entries(surfaces)) {
      assert.equal(s.split(FLIP_REST_LINE).length - 1, 1, `${k} says the pair's one end once: ${s}`);
      assert.doesNotMatch(s, /whatever is left burns \$DEFICIT after the run ends|burns down over 28 days and the coins retire/, k);
    }
    clean(FLIP_REST_LINE);
  });
});

describe("HB-156 / HS-60: a season series that has started says its standing on the Which step and the review", () => {
  const day = (iso: string) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" }).format(new Date(iso));
  const row = (startsAt: string, result: string) => ({ startsAt, result, status: result === "pending" ? "scheduled" : "final" });
  test("Chiefs and Raiders: Oct 4 played and won by KC, Jan 9 left", () => {
    const s = meetingsStandingLine([row("2026-10-04T20:25:00Z", "win"), row("2027-01-09T21:00:00Z", "pending")], "Chiefs", "Raiders", day)!;
    assert.equal(s, "Played 1, Chiefs lead 1 to 0. One game left, Jan 9. If the Raiders win it the series is level and nothing moves at the end.");
    plain(s);
  });
  test("nothing played yet: nothing new is said; a lead the games left cannot close says the series is won", () => {
    assert.equal(meetingsStandingLine([row("2027-01-09T21:00:00Z", "pending")], "Chiefs", "Raiders", day), null);
    const won = meetingsStandingLine([row("2026-10-04T20:25:00Z", "loss"), row("2026-11-04T20:25:00Z", "loss"), row("2027-01-09T21:00:00Z", "pending")], "Chiefs", "Raiders", day)!;
    assert.match(won, /^Played 2, Raiders lead 2 to 0\. One game left, Jan 9\. The Raiders have won the series whatever happens in the last game\.$/);
    plain(won);
  });
  test("the page shows it under the games list and in the review's When it ends", () => {
    const pg = read("src/app/burnticker/launch/page.tsx");
    assert.match(pg, /data-series-standing/);
    assert.match(pg, /const meetingsEndFact = `\$\{MEETINGS_END_LABEL\}\. \$\{meetingsEndLine\(rule\)\}\$\{seriesStanding \? ` \$\{seriesStanding\}` : ""\}/);
    assert.match(pg, /sentences=\{\[meetingsEndLine\(rule\), \.\.\.\(seriesStanding \? \[seriesStanding\] : \[\]\), MEETINGS_DEADLINE_LINE\]\}/);
  });
});

describe("HB-157: a one-game pair states one settlement rule", () => {
  test("Unusual cases and the pair detail say the 10-18 rule; never 'when a second source agrees' alone", () => {
    const flow = settledPairFundsFlow("game", { a: "LVVKC", b: "KCVLV" }, { a: "Las Vegas Raiders", b: "Kansas City Chiefs" });
    const final = flow.steps.find((s) => s.title === "When the game is final")!.text;
    assert.ok(final.startsWith(GAME_RESULT_COUNTS_LINE), final);
    for (const s of [final, GAME_PAIR_DETAIL]) assert.doesNotMatch(s, /a second source agrees(?! on the final, or)/, s);
    // owner 2026-10-20: the official feed marks the game final, and a second check five minutes later agrees
    assert.match(GAME_PAIR_DETAIL, /once the official feed has marked it final and a second check five minutes later agrees/);
    assert.match(GAME_BURN_LINE, /once the official feed has marked the game final and a second check five minutes later agrees/);
  });
});

describe("HB-158 and HB-159: the flippening side B and the up-or-down fade", () => {
  test("side B reads 'without WIF's market cap passing BONK's'", () => {
    const t = tileRule({ a: WIF, b: BONK, window: "daily", seasonDays: 30, flip: true, fraction: 1, now: Date.UTC(2026, 9, 20, 9) }, "09567dbee8" + "0".repeat(54), { a: "WIFVBONK", b: "BONKVWIF" });
    const ruleB = { ...t.rule!, binary: { onYes: null, onNo: t.rule!.binary!.onYes } } as BurnRule;
    const p = describeRule(ruleB, { ticker: "BONKVWIF" } as never).paragraph;
    assert.match(p, /If the run ends without WIF's market cap passing BONK's,/);
    assert.doesNotMatch(p, /without WIF's market cap passes/);
  });
  test("a CPI fade says a reading equal to the previous one, and that a move under one point burns neither coin", () => {
    const base = firstPartyRule("fred.CPIAUCSL", 0.02) as BurnRule;
    const fade = { ...base, scalar: { ...base.scalar!, unit: 1, baseline: "previousSettlement", direction: "abs" }, inverse: true } as BurnRule;
    const paragraph = describeRule(fade, { ticker: "NOCPI", feed: { title: "Consumer Price Index (CPI-U)", sourceName: "FRED (St. Louis Fed)", unitLabel: "1 index point", crossRead: "the BLS series" } } as never).paragraph;
    assert.doesNotMatch(paragraph, /does not move/);
    assert.match(paragraph, /every reading of Consumer Price Index that is the same as the previous reading/);
    assert.match(paragraph, /A move smaller than 1 index point burns neither this coin nor the coin that burns for each full index point\./);
    clean(paragraph);
    const how = budgetCopy(fade, 0.02, null).line;
    assert.match(how, /Each reading where the number is the same as the previous reading spends 2%/);
    assert.doesNotMatch(how, /the rule's way/);
  });
});

describe("HB-160 / HB-161: ladder outcomes in words; a refused coin prints no liquidity figure", () => {
  test("'↓ 5,000' reads 'Dips to $5,000' on a dollar market; no row opens with an arrow", () => {
    const q = "What price will Bitcoin hit in 2026?";
    assert.equal(outcomeText({ outcome: "↓ 5,000", question: q }), "Dips to $5,000");
    assert.equal(outcomeText({ outcome: "↑ 150,000", question: q }), "Reaches $150,000");
    assert.equal(outcomeText({ outcome: "↑ 10", question: "How many seats?" }), "Reaches 10");
    assert.equal(outcomeText({ outcome: "Lando Norris", question: "Who wins?" }), "Lando Norris");
    assert.equal(outcomeButtonLabel({ outcome: "↓ 5,000", question: q }), "Dips to $5,000: burn if this resolves YES");
    assert.match(read("src/app/burnticker/launch/page.tsx"), /<span className="min-w-0 truncate">\{outcomeText\(m\)\}/);
  });
  test("BONKSOL refused for no SOL pool: the label names no liquidity", () => {
    const refused = withHitLabel({ symbol: "BONKSOL", name: "BonkSOL", source: "jupiter", assetType: "crypto", feed: null, mint: "BonKxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxhtTs", liquidityUsd: 7_700_000, verified: true, underlying: null, why: "Jupiter — Pyth has no feed for this coin. This site reads only Raydium and PumpSwap pools paired with SOL, and it found none for this coin." } as never);
    assert.doesNotMatch(refused.label ?? "", /liquidity/);
    const ok = withHitLabel({ symbol: "WIF", name: "dogwifhat", source: "jupiter", assetType: "crypto", feed: null, mint: "EKpQxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxzcjm", liquidityUsd: 12_300_000, verified: true, underlying: WIF, why: null } as never);
    assert.match(ok.label ?? "", /\$12\.3M liquidity/);
  });
});

describe("HB-162: the copy batch", () => {
  test("(a) 'an 85 SOL raise'", () => {
    assert.equal(articleFor(85), "an"); assert.equal(articleFor(8), "an"); assert.equal(articleFor(18), "an"); assert.equal(articleFor(11), "an");
    assert.equal(articleFor(75), "a"); assert.equal(articleFor(180), "a"); assert.equal(articleFor(1), "a");
    assert.match(wholePoolSliceLine("85"), /on an 85 SOL raise/);
  });
  test("(b) the RAYS26 example only on a season coin's ticker", () => {
    assert.doesNotMatch(FIELD_HELP.ticker.what + FIELD_HELP.ticker.does, /RAYS26/);
    assert.match(FIELD_HELP["ticker-season"].what, /RAYS26/);
    assert.match(read("src/app/burnticker/launch/ReviewCard.tsx"), /<FieldHelp id=\{c\.seasonTicker \? "ticker-season" : "ticker"\} \/>/);
  });
  test("(c) an away game reads 'away against', never 'win at the Chiefs'", () => {
    assert.doesNotMatch(read("src/lib/burnticker/describe.ts"), /c\.game\.home \? "against" : "at"/);
  });
  test("(d) the third card names its season once; (e) the one-game pattern points at its own choice", () => {
    assert.equal(rivalrySeriesLabel("2026"), "Every game between them in the 2026 season");
    assert.equal(rivalrySeriesLabel(null), "Every game between them this season");
    plain(PATTERN_REASON.meetingsOnce);
    assert.doesNotMatch(PATTERN_REASON.meetingsOnce, /this pattern does not apply/);
  });
});

describe("HB-166: restored drafts keep typed names; compound subjects; the HS-2 line", () => {
  test("(L3) a draft saved with the 7-field key keeps its typed name for the same subject", () => {
    const old = ["single", "team", "catalogue", "espn.team:nfl-DEN.7-win-s2026", "DEN", "", ""].join("|");
    assert.equal(subjectKeysMatch(old, `${old}||`), true);
    assert.equal(subjectKeysMatch(old, `${old}|teams|`), true, "the new fields only add to the old ones");
    assert.equal(subjectKeysMatch(old, ["single", "team", "catalogue", "espn.team:nfl-KC.12-win-s2026", "KC", "", "", "", ""].join("|")), false);
    assert.equal(subjectKeysMatch(null, `${old}||`), false);
    assert.match(read("src/app/burnticker/launch/page.tsx"), /if \(editedFor !== subjectKey && subjectKeysMatch\(editedFor, subjectKey\)\) \{ setEditedFor\(subjectKey\); return; \}/);
  });
  test("(L4) 'X and Y' takes the plural verb", () => {
    assert.equal(subjectIsPlural("Russia and Ukraine"), true);
    assert.equal(subjectIsPlural("Trump and Putin"), true);
    assert.equal(subjectIsPlural("Trinidad and Tobago"), false);
    assert.equal(subjectIsPlural("Democrats or Republicans"), true);
  });
  test("(L5) the heavy-spend line names no unit; when 1% also spends more than half it says so", () => {
    const p = { available: true, weeks: 4, rows: [{ share: 0.01, units: 400, spentPct: 98 }, { share: 0.02, units: 400, spentPct: 99.97 }] };
    const l = heavySpendLine(p, 0.02)!;
    assert.doesNotMatch(l, /unit/);
    assert.match(l, /Even the smallest share spends more than half of the pool on these readings\./);
    const m = heavySpendLine({ ...p, rows: [{ share: 0.01, units: 40, spentPct: 33 }, { share: 0.02, units: 40, spentPct: 55 }] }, 0.02)!;
    assert.match(m, /A smaller share keeps more of the pool\./);
    plain(l); plain(m);
  });
});

describe("HS-59: the partial-condition note once, above the cards, the clauses whole", () => {
  test("the sentence quotes whole clauses and asks for another coin; labelTeamIntent no longer copies it under each card", () => {
    const s = compoundSentence({ kept: "The Denver Broncos will win every single home game this season", dropped: ["the Kansas City Chiefs will lose every road game", "the Seattle Seahawks finish above five hundred"] });
    assert.equal(s, "A coin follows one condition. These cards follow “The Denver Broncos will win every single home game this season”, and “the Kansas City Chiefs will lose every road game” and “the Seattle Seahawks finish above five hundred” are left out. Launch another coin for each of those.");
    const src = read("src/lib/burnticker/search.ts");
    assert.doesNotMatch(src, /all\.push\(compoundSentence/);
    assert.match(src, /partialNote: compoundSentence\(compound\)/);
    assert.match(src, /const whole = q\.trim\(\)\.replace\(\/\\s\+\/g, " "\)\.slice\(0, COMPOUND_QUERY_MAX\)/);
    assert.match(read("src/app/burnticker/launch/page.tsx"), /data-partial-note>\{ures\.partialNote\}/);
  });
});

describe("HS-11 widened: no America/Denver for every visitor in the flippening's full text and the one-time lines", () => {
  test("the derby explainer names the visitor's zone in the browser and UTC on the server", () => {
    const t = tileRule({ a: WIF, b: BONK, window: "daily", seasonDays: 7, flip: true, fraction: 1, now: Date.UTC(2026, 9, 20, 9) }, "09567dbee8" + "0".repeat(54), { a: "WIFVBONK", b: "BONKVWIF" });
    const ny = derbyExplainer(t.spec, { a: "WIFVBONK", b: "BONKVWIF" }, { timeZone: "America/New_York" });
    assert.match(ny.start, /in your time zone/); assert.match(ny.start, /EDT|EST/); assert.doesNotMatch(ny.start, /MDT|MST/);
    const srv = derbyExplainer(t.spec, { a: "WIFVBONK", b: "BONKVWIF" }, { where: "server" });
    assert.doesNotMatch(srv.start + srv.end, /your time zone|MDT|MST/);
    for (const f of ["src/lib/burnticker/launchDerby.ts", "src/lib/burnticker/oneShotEligibility.ts"]) assert.doesNotMatch(read(f).replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, ""), /America\/Denver|Denver time/, f);
    assert.doesNotMatch(read("src/lib/burnticker/search.ts"), /Game times are shown in Denver time|Denver time`/);
  });
});
