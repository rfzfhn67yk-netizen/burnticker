// Continuous-audit suggestions HS-3, HS-5, HS-6, HS-8, HS-9 and HS-10 (docs/burnticker/audits/continuous/suggestions.md), one check each,
// plus the copy lint on every new sentence.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import { leagueInSentence, seasonsStripLine } from "@/lib/burnticker/home";
import { PAIR_LINK_ACCOUNT_BYTES, PAIR_LINK_RENT_LABEL, rentLamports, solText } from "@/lib/burnticker/launchCost";
import { buildLaunchReview } from "@/lib/burnticker/launchReview";
import { MEETINGS_END_LINE, PAIR_COST_EXCLUSIONS, meetingsEndLine, meetingsPairRules } from "@/lib/burnticker/guidedLaunch";
import { MEETINGS_END_RESULT, meetingsEndResult } from "@/lib/burnticker/describe";
import { winPairNames } from "@/app/burnticker/launch/pageCopy";
import { suggestionFor } from "@/lib/burnticker/namePolarity";
import { NAME_MAX_BYTES, utf8Bytes } from "@/lib/burnticker/launchFields";
import { DEPLOY_IDLE_BODY, deployMarkerOn, readDeployMarker } from "@/lib/burnticker/deployNotice";
import { deployRunning } from "@/lib/burnticker/errorCopy";
import { meetingsRule } from "./burntickerRivalrySeriesHelpers.ts";
import type { BurnRule } from "@/lib/burnticker/rules";

const cfg = loadCopyLintConfig();
const plain = (t: string, where = t) => {
  assert.deepEqual(lintCopy(t, cfg).hits.map((h) => `${h.phrase} (${h.rule})`), [], `${where}: ${t}`);
  assert.doesNotMatch(t, /\bbuy|\bwill\b|\bprice\b|payout|target|guarantee|coming soon|→|->|\w\/\w+\/\w/i, `${where}: ${t}`);
};
const read = (p: string) => fs.readFileSync(p, "utf8");

describe("HS-3: 24 px touch targets on the phone review step", () => {
  test("below the sm width every launch nav control and header link is at least 24 x 24; nothing changes above it", () => {
    const css = read("config/public-repo/overlay/src/app/globals.css");
    const block = /@media \(max-width: 639px\) \{\s*\[data-launch-main\] \[data-nav\] \{ min-height: 24px; min-width: 24px; \}\s*\[data-launch-main\] > header a \{ display: inline-flex; align-items: center; min-height: 24px; min-width: 24px; \}\s*\}/;
    assert.match(css, block);
    // the controls the audit measured carry data-nav (Edit, Back, Start over, the step chips)
    assert.match(read("src/app/burnticker/launch/GuidedSteps.tsx"), /data-nav className="underline" onClick=\{onStartOver\}/);
    assert.equal((read("src/app/burnticker/launch/ReviewCard.tsx").match(/data-nav[^>]*>Edit</g) ?? []).length >= 2, true);
  });
});

describe("HS-5: the home scoreboard sentence", () => {
  test("the counts are said apart, from the leagues index", () => {
    const s = seasonsStripLine({ teamCoins: 3, leagues: 25, coinLeagues: ["NFL"] });
    assert.equal(s, "3 team coins so far, all in the NFL. Scoreboards are ready for 25 leagues.");
    assert.equal(seasonsStripLine({ teamCoins: 1, leagues: 25, coinLeagues: ["NBA"] }), "1 team coin so far, in the NBA. Scoreboards are ready for 25 leagues.");
    assert.equal(seasonsStripLine({ teamCoins: 4, leagues: 25, coinLeagues: ["NFL", "La Liga"] }), "4 team coins so far, in the NFL and La Liga. Scoreboards are ready for 25 leagues.");
    assert.equal(seasonsStripLine({ teamCoins: 9, leagues: 25, coinLeagues: ["NFL", "NBA", "MLB"] }), "9 team coins so far, across 3 leagues. Scoreboards are ready for 25 leagues.");
    assert.match(seasonsStripLine({ teamCoins: 0, leagues: 25, coinLeagues: [] }), /^No team coin has launched yet, so all 25 league scoreboards are empty\./);
    assert.equal(leagueInSentence("College football"), "college football");
    assert.equal(leagueInSentence("Premier League"), "the Premier League");
    for (const t of [s, seasonsStripLine({ teamCoins: 4, leagues: 25, coinLeagues: ["NFL", "La Liga"] }), seasonsStripLine({ teamCoins: 9, leagues: 25, coinLeagues: ["NFL", "NBA", "MLB"] })]) plain(t, "HS-5");
  });
  test("the page derives the numbers and passes the line; nothing is typed", () => {
    const page = read("src/app/burnticker/page.tsx");
    assert.match(page, /line: seasonsStripLine\(\{ teamCoins: ix\.totals\.teamCoins, leagues: ix\.totals\.leagues, coinLeagues \}\)/);
    const idx = read("src/app/burnticker/CoinsIndex.tsx");
    assert.match(idx, /\{seasons\.line\}/);
    assert.doesNotMatch(idx, /on the scoreboards of/);
  });
});

describe("HS-6: the pair-link account's rent is measured", () => {
  test("PairLink is 8 + INIT_SPACE bytes, read from the program's struct", () => {
    const rs = read("programs/burn-receipts/programs/burn_receipts/src/state.rs");
    const body = /pub struct PairLink \{([\s\S]*?)\n\}/.exec(rs)![1];
    const size: Record<string, number> = { u8: 1, bool: 1, i64: 8, Pubkey: 32, "[u8; 32]": 32 };
    const fields = [...body.matchAll(/pub \w+: ([^,]+),/g)].map((m) => size[m[1].trim()]);
    assert.ok(fields.every((x) => typeof x === "number"), "every field has a known size");
    assert.equal(8 + fields.reduce((a, b) => a + b, 0), PAIR_LINK_ACCOUNT_BYTES);
    assert.match(read("programs/burn-receipts/programs/burn_receipts/src/instructions/pair.rs"), /create_pda\(payer, acc, system, 8 \+ PairLink::INIT_SPACE/);
  });
  test("a linked rivalry review lists both link accounts' rent, adds it to the total, and the note drops 'not measured yet'", () => {
    const ENV = { BURNTICKER_CLUSTER: "devnet", BURNTICKER_CREATOR_LAUNCHES_ENABLED: "1" } as Record<string, string>;
    const NOW = Date.parse("2026-01-15T12:00:00Z");
    const body = { rule: meetingsRule(), ticker: "PHIVBOS", name: "76ers vs Celtics", raiseSol: "85", pair: { ticker: "BOSVPHI", name: "Celtics vs 76ers" } };
    const r = buildLaunchReview(body, { env: ENV, now: NOW });
    assert.ok("review" in r);
    const line = r.review.costs.lines.find((l) => l.label === PAIR_LINK_RENT_LABEL);
    assert.ok(line, "the link rent line is listed");
    assert.equal(line!.sol, solText(2 * rentLamports(PAIR_LINK_ACCOUNT_BYTES)));
    const single = buildLaunchReview({ ...body, pair: null, rule: { ...meetingsRule() } as BurnRule }, { env: ENV, now: NOW });
    if ("review" in single) assert.ok(!single.review.costs.lines.some((l) => l.label === PAIR_LINK_RENT_LABEL), "a single coin has no link account");
    assert.doesNotMatch(PAIR_COST_EXCLUSIONS, /not measured/);
    plain(PAIR_LINK_RENT_LABEL, "HS-6 line"); plain(PAIR_COST_EXCLUSIONS, "HS-6 note");
  });
});

describe("HS-8: generated pair names read 'over'", () => {
  test("'Nuggets over Lakers', matchup tickers, within the byte limit; a typed name is untouched", () => {
    const den = { abbr: "DEN", nickname: "Nuggets", name: "Denver Nuggets" }, lal = { abbr: "LAL", nickname: "Lakers", name: "Los Angeles Lakers" };
    const n = winPairNames(den, lal);
    assert.equal(n.a.name, "Nuggets over Lakers"); assert.equal(n.b.name, "Lakers over Nuggets");
    // B-12 (sixth-pass audit): the tickers are the server's matchup tickers ($DENWIN was another coin's, $LALWIN one letter from $BALWIN)
    assert.equal(n.a.ticker, "DENVLAL"); assert.equal(n.b.ticker, "LALVDEN");
    const long = winPairNames({ abbr: "MIN", nickname: "Minnesota Timberwolves", name: "Minnesota Timberwolves" }, { abbr: "POR", nickname: "Portland Trail Blazers", name: "Portland Trail Blazers" });
    for (const s of [long.a, long.b]) { assert.ok(utf8Bytes(s.name) <= NAME_MAX_BYTES, s.name); assert.match(s.name, / over /); assert.doesNotMatch(s.name, /Wins/); }
    // the polarity helper still works on top: a typed (or source) name follows its own side, never this generator
    assert.deepEqual(suggestionFor({ name: "My Nuggets", ticker: "MYDEN", side: "yes" }, "yes"), { name: "My Nuggets", ticker: "MYDEN" });
    assert.equal(suggestionFor({ name: "Nuggets over Lakers", ticker: "DENWIN", side: "yes" }, "no").name, "Nuggets over Lakers No");
    plain(n.a.name, "HS-8");
  });
});

describe("HS-9: /deploying.json answers when no deploy runs", () => {
  test("the idle body turns the banner off; the deploy's own file still turns it on", async () => {
    assert.equal(deployMarkerOn({ ok: true, contentType: "application/json", body: DEPLOY_IDLE_BODY }), false);
    assert.equal(deployMarkerOn({ ok: true, contentType: "application/json", body: '{"deploying":true,"since":"x","text":"y"}' }), true);
    assert.equal(deployMarkerOn({ ok: true, contentType: "application/json", body: '{"since":"x","text":"y"}' }), true, "an older marker without the flag");
    assert.equal(deployMarkerOn({ ok: false, contentType: "text/html", body: "" }), false);
    const answer = (status: number, body: string, type = "application/json") => (async () => new Response(body, { status, headers: { "content-type": type } })) as unknown as typeof fetch;
    assert.equal(await readDeployMarker(answer(200, DEPLOY_IDLE_BODY)), false);
    assert.equal(await deployRunning(answer(200, DEPLOY_IDLE_BODY)), false);
    assert.equal(await deployRunning(answer(200, '{"deploying":true}')), true);
  });
  test("Caddy answers the idle body with no-store only while the file is absent; the deploy script writes the flag", () => {
    // the Caddyfile and the host deploy script are private to the monorepo (not in the public tree): checked only where they exist
    if (fs.existsSync("deploy/caddy/Caddyfile")) {
      const caddy = read("deploy/caddy/Caddyfile");
      assert.match(caddy, /@deploy_idle \{\s*path \/deploying\.json\s*not file \{\s*root \/var\/www\/burnticker\s*try_files \/deploying\.json\s*\}\s*\}/);
      assert.match(caddy, /handle @deploy_idle \{\s*import security\s*header Content-Type "application\/json; charset=utf-8"\s*header Cache-Control "no-store"\s*respond `\{"deploying":false\}` 200\s*\}/);
      assert.ok(caddy.indexOf("handle @deploy_idle") < caddy.indexOf("# The platform's static receipts site"), "before the static catch-all");
    }
    if (fs.existsSync("scripts/ops/deploy-burnticker-host.sh")) assert.match(read("scripts/ops/deploy-burnticker-host.sh"), /printf '\{\\"deploying\\":true,/);
    assert.match(read("src/app/burnticker/_components/DeployNotice.tsx"), /const on = await readDeployMarker\(\);/);
  });
});

describe("HS-10: one league season is named, not 'both seasons'", () => {
  test("a same-league series names its season from the league table; a cross-league pair keeps the two-seasons wording", () => {
    const nba = meetingsPairRules("nba", "DEN", "LAL", 2027);
    const line = meetingsEndLine(nba.a, nba.b);
    assert.equal(line, "When the 2026–27 season is over, playoffs included, the coin of the team that won fewer of their games sends what is left to the other coin's burn. If they won the same number, nothing moves and each coin burns down what is left on itself over four weeks.");
    assert.equal(meetingsEndLine(nba.a), line, "side A alone reads the same season");
    const nfl = meetingsPairRules("nfl", "DEN", "KC", 2026);
    assert.match(meetingsEndLine(nfl.a), /^When the 2026 season is over, playoffs included,/);
    assert.equal(meetingsEndLine(nba.a, nfl.a), MEETINGS_END_LINE, "two league seasons keep the two-seasons wording");
    assert.equal(meetingsEndLine(null), MEETINGS_END_LINE);
    // the review's end (describe.ts endText on the pair as built), for the helper's 76ers and Celtics series in the 2025–26 NBA season
    const ENV = { BURNTICKER_CLUSTER: "devnet", BURNTICKER_CREATOR_LAUNCHES_ENABLED: "1" } as Record<string, string>;
    const r = buildLaunchReview({ rule: meetingsRule(), ticker: "PHIVBOS", name: "76ers vs Celtics", raiseSol: "85", pair: { ticker: "BOSVPHI", name: "Celtics vs 76ers" } }, { env: ENV, now: Date.parse("2026-01-15T12:00:00Z") });
    assert.ok("review" in r);
    const end = r.review.end;
    assert.equal(end.result, meetingsEndResult(meetingsRule()));
    assert.match(end.result, /^When the 2025–26 season is over, playoffs included, the coin of the team that won fewer/);
    assert.notEqual(end.result, MEETINGS_END_RESULT);
    plain(line, "HS-10 line"); plain(end.result, "HS-10 result");
  });
});
