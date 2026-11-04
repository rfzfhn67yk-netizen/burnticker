// SOURCES-7 ROUND 2 (WIRING-WEBSITE25-REQUESTS, 2026-10-13): the next season is never refused as over; the pair curve's own accounts
// in the review's cost; structured field problems on the review; one creator-text sentence per field; the filter help and the
// unpaired one-game sentence.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DEFAULT_ON_END, type BurnRule } from "@/lib/burnticker/rules";
import { firstPartyRule } from "@/lib/burnticker/wizard";
import { seasonYearAt, teamSeries, type Game, type LeagueId } from "@/lib/burnticker/sources/espn";
import { seasonOverFor, seasonOverRefusal, seasonNotStartedLine } from "@/lib/burnticker/seasonOver";
import { buildLaunchReview, PAIR_ACCOUNT_BYTES, PAIR_TOKEN_VAULT_BYTES } from "@/lib/burnticker/launchReview";
import { rentLamports } from "@/lib/burnticker/launchCost";
import { creatorTextProblems } from "@/lib/burnticker/coinText";
import { creatorFieldSentence } from "@/lib/burnticker/creatorWording";
import { fieldRuleSentence } from "@/app/burnticker/launch/fieldChecks";
import { edgeCase } from "@/lib/burnticker/ruleEdgeCases";
import { patternWords } from "@/lib/burnticker/guidedLaunch";
import { PAIR_CURVE_FLAG } from "@/lib/burnKeeper/pairCurveCrank";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";

const cfgLint = loadCopyLintConfig();
const lint = (t: string) => { const r = lintCopy(t, cfgLint); assert.ok(r.ok, `${r.hits.map((h) => `${h.phrase} (${h.rule})`).join(", ")}\n${t}`); };
const env = { BURNTICKER_CLUSTER: "devnet", BURNTICKER_CREATOR_LAUNCHES_ENABLED: "1" };
const NOW = Date.parse("2026-10-13T12:00:00Z");
const side = (abbr: string) => ({ abbr, name: abbr, nickname: abbr }) as unknown as Game["home"];
/** Every open game is a postseason game, between two teams that are not the ones tested. */
const POST: Game[] = [{ eventId: "1", league: "mlb", seasonType: 3, startsAt: "2026-10-15T23:00:00Z", date: "2026-10-15", name: "x", completed: false, state: "pre", detail: "", home: side("ZZA"), away: side("ZZB") } as Game];
const empty = async () => [] as Game[];

describe("round 2, H6: the next season is never refused as over", () => {
  // one league per season family: a single-year season (MLB), a season that ends in the later year (NBA, NHL), one that starts in the
  // earlier year (Premier League), and the NFL's January playoffs
  for (const [lg, abbr] of [["mlb", "COL"], ["nba", "BOS"], ["nhl", "COL"], ["eng.1", "ARS"], ["nfl", "DAL"]] as [LeagueId, string][]) {
    test(`${lg}: the current season can be over; the next one is offered and passes, said as not listed yet`, async () => {
      const cur = seasonYearAt(lg, NOW);
      const rule = (year: number) => ({ ...firstPartyRule(teamSeries(lg, abbr, "win", { kind: "season", year }), 0.02), onEnd: { ...DEFAULT_ON_END } }) as BurnRule;
      const over = await seasonOverFor(rule(cur), async () => POST.map((g) => ({ ...g, league: lg })), { now: NOW });
      assert.equal(over?.code, "season-over");
      assert.equal(over!.next.year, cur + 1);
      assert.equal(over!.next.series, teamSeries(lg, abbr, "win", { kind: "season", year: cur + 1 }));
      // the offered season: never over, whatever the schedule shows today (empty, or the current postseason)
      for (const sched of [empty, async () => POST]) assert.equal(await seasonOverFor(rule(cur + 1), sched, { now: NOW }), null);
      const note = seasonNotStartedLine(rule(cur + 1), NOW)!;
      assert.match(note, /not listed yet/);
      lint(note);
      assert.equal(seasonNotStartedLine(rule(cur), NOW), null);
      // an earlier season is over without a read, and the offer is the current one
      const past = await seasonOverFor(rule(cur - 1), null, { now: NOW });
      assert.equal(past?.next.year, cur);
      assert.equal(seasonOverRefusal(rule(cur - 1), NOW)?.next.year, cur);
    });
  }
  test("the review takes the not-listed-yet note as a warning, not a problem", () => {
    const r = buildLaunchReview({ rule: { ...firstPartyRule(teamSeries("mlb", "COL", "win", { kind: "season", year: 2027 }), 0.02), onEnd: { ...DEFAULT_ON_END } }, ticker: "COL", name: "Rockies Wins" }, { env, now: NOW, seasonWarning: seasonNotStartedLine({ oracle: "catalogue", series: teamSeries("mlb", "COL", "win", { kind: "season", year: 2027 }) }, NOW) });
    assert.ok("review" in r);
    assert.equal(r.review.seasonOver, undefined);
    assert.ok(r.review.warnings.some((w) => /not listed yet/.test(w)));
  });
});

describe("round 2, H4: the pair curve's own accounts in the cost", () => {
  test("the Pair account's size is summed from the program's own struct, and the vaults' rent is in the total", () => {
    const src = fs.readFileSync("programs/burn-receipts/programs/pair_curve/src/state.rs", "utf8");
    const body = /pub struct Pair \{([\s\S]*?)\n\}/.exec(src)![1];
    const size: Record<string, number> = { u8: 1, bool: 1, u16: 2, u32: 4, u64: 8, i64: 8, Pubkey: 32 };
    let n = 0;
    for (const m of body.matchAll(/pub \w+: (\[(\w+); (\d+)\]|\w+),/g)) n += m[2] ? size[m[2]] * Number(m[3]) : size[m[1]];
    assert.equal(PAIR_ACCOUNT_BYTES, 8 + n);
    assert.equal(PAIR_TOKEN_VAULT_BYTES, 165);
  });
  test("a pair-curve pair's estimate lists the pair account, the SOL vault and the two token vaults, and says what is still left out", async () => {
    const { tileRule, tileHashInput } = await import("@/lib/burnticker/derby/tile");
    const { rulesSha256 } = await import("@/lib/burnKeeper/rules");
    const { BONK, WIF } = await import("./burntickerDerbyHelpers.ts");
    const c = { a: WIF, b: BONK, window: "daily" as const, seasonDays: 30, flip: false, fraction: 0.02, now: NOW };
    const t = tileRule(c, rulesSha256(tileHashInput(c)), { a: "WIFVBONK", b: "BONKVWIF" });
    const pc = buildLaunchReview({ rule: t.rule, ticker: "WIFVBONK", name: "WIF vs BONK", pair: { ticker: "BONKVWIF", name: "BONK vs WIF" } }, { env: { ...env, [PAIR_CURVE_FLAG]: "1" }, now: NOW });
    assert.ok("review" in pc, JSON.stringify(pc));
    assert.equal(pc.review.venue, "pair-curve");
    const line = pc.review.costs.lines.find((l) => /pair's own account/.test(l.label))!;
    assert.ok(line, pc.review.costs.lines.map((l) => l.label).join("\n"));
    const lamports = rentLamports(PAIR_ACCOUNT_BYTES) + rentLamports(0) + 2 * rentLamports(PAIR_TOKEN_VAULT_BYTES);
    assert.equal(Number(line.sol), Math.round(lamports / 1e5) / 1e4);
    assert.doesNotMatch(pc.review.costs.note, /has not been measured/);
    assert.match(pc.review.costs.note, /wrapped SOL/);
    for (const l of pc.review.costs.lines) lint(l.label);
    lint(pc.review.costs.note);
  });
});

describe("round 2, H5: one sentence per field, and the review's fieldProblems", () => {
  const NAME = "🔥 Avs Guaranteed official", DESC = "Officially endorsed by the NHL. Guaranteed 100x. Join t.me/avscup";
  test("creatorTextProblems says one sentence per field, the same sentence the name step says", () => {
    const ps = creatorTextProblems({ name: NAME, ticker: "AVS", note: "", description: DESC });
    assert.deepEqual(ps.map((x) => x.field), ["name", "description"]);
    assert.equal(ps[0].reason, fieldRuleSentence("name", NAME));
    assert.equal(ps[1].reason, fieldRuleSentence("description", DESC));
    assert.equal(ps[1].reason, creatorFieldSentence("description", DESC, lintCopy(DESC, cfgLint, { scope: "creator" }).hits));
    for (const x of ps) { assert.doesNotMatch(x.reason, /Rule broken|no-affiliation|costume/); assert.ok(x.categories.length >= 1); lint(x.reason.replace(/“[^”]*”/g, "it")); }
  });
  test("the review returns fieldProblems { side, field, text } beside the flat problems", () => {
    const rule = { ...firstPartyRule(teamSeries("nhl", "COL", "win", { kind: "season", year: 2026 }), 0.02), onEnd: { ...DEFAULT_ON_END } };
    const r = buildLaunchReview({ rule, ticker: "DEFICIT", name: NAME, creatorDescription: DESC, note: "Officially endorsed", links: [{ label: "X", url: "not a url" }] } as never, { env, now: NOW });
    assert.ok("review" in r);
    const fp = r.review.fieldProblems;
    const fields = fp.map((x) => `${x.side}:${x.field}`);
    for (const f of ["A:ticker", "A:name", "A:description", "A:note", "A:links"]) assert.ok(fields.includes(f), `${f} in ${fields.join(", ")}`);
    for (const x of fp) assert.ok(r.review.problems.some((p) => p.endsWith(x.text)), x.text);
    assert.equal(fp.filter((x) => x.field === "description" && /cannot use/.test(x.text)).length, 1);
  });
});

describe("round 2: the filter help and the unpaired one-game sentence", () => {
  // audit 12 item 3 (2026-10-13): picking one game builds the LINKED pair, so the option now says that form (it said two unlinked coins)
  test("the filter help no longer names solar flares; the one-game option says the linked pair it builds", () => {
    assert.doesNotMatch(edgeCase(115)!, /solar/i);
    lint(edgeCase(115)!);
    const w = patternWords("once", { follow: "rivalry", pairKind: "teams", rivalryScope: "game" });
    assert.equal(w.label, "Their next game only, winner takes the burn");
    assert.match(w.sentence, /the winning team's coin burns its whole pool and takes the losing team's coin's pool/);
    assert.match(w.sentence, /are linked/);
    lint(w.sentence);
  });
});
