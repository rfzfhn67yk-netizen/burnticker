// The synthetic creator's browser-free decisions (2026-10-15, the devnet bank and the box's slow address search): which instance each
// scenario runs on, the Launch wait from the measured search rate, the sentence when a press times out, the team and rivalry picks and
// the pair's name step; and the service script's devnet bank (its own key and file, one worker, the empty-bank instance).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import { expectedTries, mintWorkerCount } from "@/lib/burnticker/vanityMint";
import {
  bankPlan, describeStall, EMPTY_BANK_SCENARIO, HUNT_WAIT_CEILING_MS, HUNT_WAIT_FLOOR_MS, huntRateLine, huntWaitMs, MIN_LEAD_MS, mintSourceOf,
  nameStepFills, pairTickersFor, pickRivals, pickTeam, type ListedTeam, type StallState,
} from "../scripts/burnticker-synth/plan.mts";

const ROOT = path.join(import.meta.dirname, "..");
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");
const cfg = loadCopyLintConfig();
const clean = (t: string) => { const r = lintCopy(t, cfg); assert.ok(r.ok, `${r.hits.map((h) => `${h.phrase} (${h.rule})`).join(", ")}\n${t}`); };
const E = expectedTries();

describe("which instance each scenario runs on", () => {
  const base = "http://127.0.0.1:3100", emptyBase = "http://127.0.0.1:3101";
  test("with the empty-bank instance: d-mint-source runs there and must see the fallback; everything else runs on the bank", () => {
    assert.equal(EMPTY_BANK_SCENARIO, "d-mint-source");
    assert.deepEqual({ ...bankPlan("d-mint-source", { base, emptyBase, expectEnv: "filled" }), why: "" }, { base: emptyBase, expect: "empty", why: "" }, "the empty instance wins over the env");
    for (const id of ["a-event", "a-team", "a-rivalry-game", "a-rivalry-series", "b-double-press", "b-reject-retry", "b-reload-relaunch", "c-deploy-window", "e-slow", "e-tamper"]) {
      const p = bankPlan(id, { base, emptyBase, expectEnv: "" });
      assert.equal(p.base, base, id); assert.equal(p.expect, null, `${id}: a dry bank only makes the page search, never a failure`);
    }
  });
  test("without it (the Mac, an old service script): one instance, d-mint-source asserts what BURNTICKER_SYNTH_EXPECT_BANK says", () => {
    assert.equal(bankPlan("d-mint-source", { base, emptyBase: null, expectEnv: "" }).expect, null);
    assert.equal(bankPlan("d-mint-source", { base, emptyBase: null, expectEnv: "filled" }).expect, "filled");
    assert.equal(bankPlan("d-mint-source", { base, emptyBase: null, expectEnv: "empty" }).base, base);
  });
  test("the mint source read from the launch requests", () => {
    assert.equal(mintSourceOf([{ status: 200, code: null, ownMint: false }]), "bank");
    assert.equal(mintSourceOf([{ status: 503, code: "mint-bank-empty", ownMint: false }, { status: 200, code: null, ownMint: true }]), "browser");
    assert.equal(mintSourceOf([{ status: 200, code: null, ownMint: true }]), "browser", "a resent press with the page's own key");
    assert.equal(mintSourceOf([]), "none");
    assert.equal(mintSourceOf([{ status: 503, code: "app-unavailable", ownMint: false }]), "none");
  });
});

describe("the Launch wait from the browser's measured search rate", () => {
  test("the Mac (about 190,000 keys a second): the floor, 300 s, for one address and two", () => {
    assert.equal(huntWaitMs({ rate: 190_000, addresses: 1, expectedTries: E }), HUNT_WAIT_FLOOR_MS);
    assert.equal(huntWaitMs({ rate: 190_000, addresses: 2, expectedTries: E }), HUNT_WAIT_FLOOR_MS);
  });
  test("a box-like rate (30,000 a second, about 189 s an address): 60 s + 3.0 × mean for one, the ceiling for two", () => {
    const one = huntWaitMs({ rate: 30_000, addresses: 1, expectedTries: E });
    assert.equal(one, Math.round(60_000 + 3.0 * (E / 30_000) * 1000));
    assert.ok(one > HUNT_WAIT_FLOOR_MS && one < HUNT_WAIT_CEILING_MS, String(one));
    assert.equal(huntWaitMs({ rate: 30_000, addresses: 2, expectedTries: E }), HUNT_WAIT_CEILING_MS);
  });
  test("bounds: 300 s floor, 900 s ceiling; no rate means the ceiling; an override wins but stays inside the bounds", () => {
    assert.equal(HUNT_WAIT_FLOOR_MS, 300_000); assert.equal(HUNT_WAIT_CEILING_MS, 900_000);
    assert.equal(huntWaitMs({ rate: 1_000, addresses: 1, expectedTries: E }), HUNT_WAIT_CEILING_MS);
    for (const rate of [null, 0, -5, Number.NaN]) assert.equal(huntWaitMs({ rate, addresses: 1, expectedTries: E }), HUNT_WAIT_CEILING_MS, String(rate));
    assert.equal(huntWaitMs({ rate: 190_000, addresses: 1, expectedTries: E, overrideMs: 480_000 }), 480_000);
    assert.equal(huntWaitMs({ rate: 190_000, addresses: 1, expectedTries: E, overrideMs: 10_000 }), HUNT_WAIT_FLOOR_MS);
    assert.equal(huntWaitMs({ rate: 190_000, addresses: 1, expectedTries: E, overrideMs: 5_000_000 }), HUNT_WAIT_CEILING_MS);
    assert.ok(huntWaitMs({ rate: 25_000, addresses: 2, expectedTries: E }) >= huntWaitMs({ rate: 25_000, addresses: 1, expectedTries: E }), "two never wait less than one");
  });
  test("the bench uses the page's worker count, and the report line says the rate and both waits", () => {
    assert.equal(mintWorkerCount(4), 3, "the box's four cores: three searches, as on the page");
    const line = huntRateLine({ rate: 30_000, workers: 3, engine: "webcrypto", problem: null }, E, { one: 626_000, two: 900_000 });
    assert.match(line, /^Browser address search on this host: 30,000 keys a second on 3 workers \(webcrypto\), about 189 s per address; a press of Launch waits up to 626 s for one address and 900 s for two\.$/);
    assert.match(huntRateLine({ rate: null, workers: 0, engine: null, problem: "not a secure context" }, E, { one: 900_000, two: 900_000 }), /could not be measured here \(not a secure context\), so a press of Launch waits up to 900 s/);
  });
});

describe("the sentence when a press of Launch times out", () => {
  const base: StallState = { search: null, tries: null, workers: null, pendingLaunch: 0, pendingForMs: null, lastAnswer: null, launching: false, walletList: false, walletBusy: 0, walletConnected: true, launchEnabled: true, alert: null };
  const say = (s: Partial<StallState>) => describeStall({ ...base, ...s }, { waitedMs: 300_000, expectedTries: E });
  test("hunting: the tries so far, the workers and how many addresses' worth that is", () => {
    const t = say({ search: "searching", tries: 8_487_372, workers: 3 });
    assert.equal(t, `Nothing happened within 300 s of pressing Launch: the page was still hunting for an address that ends in burn, with 8,487,372 tries so far on 3 workers (about ${E.toLocaleString("en-US")} expected per address, so 1.5 addresses' worth).`);
  });
  test("waiting for the bank (the launch request unanswered), for the wallet, or the wallet list open or not connected", () => {
    assert.match(say({ pendingLaunch: 1, pendingForMs: 41_000 }), /waiting for the launch service, which had not answered its request after 41 s \(it takes the address from the host's bank/);
    assert.match(say({ walletBusy: 1 }), /waiting for the wallet, which still held a signature request\.$/);
    assert.match(say({ walletBusy: 2 }), /still held 2 signature requests\.$/);
    assert.match(say({ walletList: true }), /waiting for the wallet, with the wallet list open\.$/);
    assert.match(say({ walletConnected: false }), /waiting for the wallet, which was not connected\.$/);
  });
  test("the search outranks the rest (a search in progress is what the creator sees); nothing pending says the last answer", () => {
    assert.match(say({ search: "searching", tries: 1, workers: 1, pendingLaunch: 1, walletList: true }), /hunting for an address/);
    assert.equal(say({ lastAnswer: { status: 503, code: "mint-bank-empty" }, launchEnabled: false, alert: "Something went wrong." }), "Nothing happened within 300 s of pressing Launch: no address search, no pending launch request and no wallet prompt. The last launch request answered HTTP 503 (mint-bank-empty). Launch was still off. Its last message: Something went wrong.");
    assert.match(say({}), /No launch request was made\. Launch was enabled again\.$/);
  });
  test("never the page's text (the old message dumped the footer), and each sentence passes the copy lint", () => {
    for (const s of [say({ search: "searching", tries: 10, workers: 3 }), say({ pendingLaunch: 1, pendingForMs: 5_000 }), say({ walletBusy: 1 }), say({ walletList: true }), say({})]) {
      assert.doesNotMatch(s, /KEEP THIS RECEIPT|Whitepaper|The page shows/);
      clean(s);
    }
    const src = read("scripts/burnticker-synthetic-creator.mts");
    assert.doesNotMatch(src, /Nothing happened within \$\{[^}]+\} s of pressing Launch\. The page shows/, "the page-text dump is gone");
    assert.match(src, /return fail\(describeStall\(await stallState\(page, o\.seen \?\? null\), \{ waitedMs: waitMs \+ \(graced \? LAUNCH_ANSWER_GRACE_MS : 0\), expectedTries: EXPECTED_TRIES \}\)\);/);
  });
});

describe("the team and rivalry forms", () => {
  const NOW = Date.parse("2026-10-15T23:00:00Z");
  const at = (h: number) => new Date(NOW + h * 3_600_000).toISOString();
  const team = (abbr: string, name: string, nickname: string, next: ListedTeam["next"], status = "upcoming"): ListedTeam => ({ abbr, name, nickname, next, season: { status } });
  const nhl: ListedTeam[] = [
    team("ANA", "Anaheim Ducks", "Ducks", { eventId: "e1", startsAt: at(27), opponent: "Bruins" }),
    team("BOS", "Boston Bruins", "Bruins", { eventId: "e1", startsAt: at(27), opponent: "Ducks" }),
    team("BUF", "Buffalo Sabres", "Sabres", { eventId: "e2", startsAt: at(-1), opponent: "Maple Leafs", live: true }),
    team("TOR", "Toronto Maple Leafs", "Maple Leafs", { eventId: "e2", startsAt: at(-1), opponent: "Sabres", live: true }),
    team("CGY", "Calgary Flames", "Flames", { eventId: "e3", startsAt: at(1), opponent: "Golden Knights" }),
    team("VGK", "Vegas Golden Knights", "Golden Knights", { eventId: "e3", startsAt: at(1), opponent: "Flames" }),
    team("SEA", "Seattle Kraken", "Kraken", null, "over"),
  ];
  test("a team coin: an open season with a game ahead; never a season that is over", () => {
    const t = pickTeam(nhl, NOW)!;
    assert.ok(["ANA", "BOS"].includes(t.abbr), t.abbr);
    assert.equal(pickTeam([nhl[6]], NOW), null);
    assert.equal(pickTeam([nhl[2]], NOW)?.abbr, "BUF", "with no game far enough ahead, any open season");
  });
  test("a rivalry: the two teams of a listed game at least three hours ahead, never one live or about to start", () => {
    assert.equal(MIN_LEAD_MS, 3 * 3_600_000);
    const r = pickRivals(nhl, NOW)!;
    assert.deepEqual([r.a.abbr, r.b.abbr].sort(), ["ANA", "BOS"]); assert.equal(r.eventId, "e1");
    assert.equal(pickRivals(nhl.slice(2, 6), NOW), null, "live (BUF/TOR) and one hour away (CGY/VGK): none");
  });
  test("the opponent is matched by nickname or the end of the name, never by a team against itself", () => {
    const two = [team("NYR", "New York Rangers", "Rangers", { eventId: "x", startsAt: at(30), opponent: "Rangers" }), team("TEX", "Texas Rangers", "Rangers", { eventId: "y", startsAt: at(30), opponent: "Rangers" })];
    const r = pickRivals(two, NOW)!;
    assert.notEqual(r.a.abbr, r.b.abbr);
    // no nickname listed for the Kings: "Kings" is matched on the end of "Los Angeles Kings"
    const byName = [team("COL", "Colorado Avalanche", "Avalanche", { eventId: "z", startsAt: at(30), opponent: "Kings" }), { ...team("LAK", "Los Angeles Kings", "", { eventId: "z", startsAt: at(30), opponent: "Avalanche" }), nickname: null }];
    for (let d = 0; d < 2; d++) { const r = pickRivals(byName, NOW + d * 86_400_000)!; assert.deepEqual([r.a.abbr, r.b.abbr].sort(), ["COL", "LAK"]); }
  });
  test("the pick rotates by day, so the nightly run does not launch the same team every night", () => {
    const many = Array.from({ length: 6 }, (_, i) => team(`T${i}`, `Team ${i}`, `N${i}`, { eventId: `g${i}`, startsAt: at(30 + i), opponent: `N${i % 2 ? i - 1 : i + 1}` }));
    const days = new Set(Array.from({ length: 6 }, (_, d) => pickTeam(many, NOW + d * 86_400_000)!.abbr));
    assert.ok(days.size >= 3, [...days].join(","));
  });
  test("the pair's name step: side A then side B, distinct tickers of 2 to 10 letters or digits", () => {
    const [a, b] = pairTickersFor("SYRG7K2Q");
    assert.deepEqual([a, b], ["SYRG7K2QA", "SYRG7K2QB"]);
    for (const t of pairTickersFor("SYRS-LONGTICKER-99")) assert.match(t, /^[A-Z0-9]{2,10}$/);
    assert.deepEqual(nameStepFills([a, b]), [{ index: 0, name: `Synthetic ${a}`, ticker: a }, { index: 1, name: `Synthetic ${b}`, ticker: b }]);
    assert.deepEqual(nameStepFills(["SYTE1234"]), [{ index: 0, name: "Synthetic SYTE1234", ticker: "SYTE1234" }]);
  });
  test("the creator drives them: Team and Rivalry tiles, the league list, the page's team buttons, the one game or the series", () => {
    const src = read("scripts/burnticker-synthetic-creator.mts");
    assert.match(src, /launchKind\("a-team", [^\n]+reviewTeam\)/);
    assert.match(src, /pairKind\("a-rivalry-game", [^\n]+"game"\)/);
    assert.match(src, /pairKind\("a-rivalry-series", [^\n]+"meetings"\)/);
    assert.doesNotMatch(src, /skipSports/);
    for (const sel of ["button[data-follow-choice=team]", "button[data-follow-choice=rivalry]", "button[data-rivalry=teams]", "[data-team-list] button[data-team=", "[data-rivalry-games] button[data-meeting", "[data-rivalry-series]"]) assert.ok(src.includes(sel), sel);
    // the selectors exist on the page
    const page = read("src/app/burnticker/launch/page.tsx"), steps = read("src/app/burnticker/launch/GuidedSteps.tsx");
    for (const attr of ["data-team-list={label}", "data-team={t.abbr}", "data-meeting={m.eventTicker}", "data-rivalry-series data-offered=", "data-rivalry-games"]) assert.ok(page.includes(attr), attr);
    assert.ok(steps.includes("data-rivalry={k}"));
    assert.match(src, /pressLaunch\(page, \{ addresses: 2, seen \}\)/, "a pair waits for two addresses");
  });
});

describe("the devnet mint bank on the box (scripts/service/run-burnticker-synth.sh)", () => {
  const sh = read("scripts/service/run-burnticker-synth.sh");
  test("its own file and key: data/devnet-synth/bank.db sealed by BURNTICKER_SYNTH_BANK_KEY, refused when it is the live bank's key", () => {
    assert.match(sh, /^BANK=\$D\/bank\.db$/m);
    assert.doesNotMatch(sh, /burnticker-mintbank\.db/, "never the live bank's file");
    assert.match(sh, /export BURNTICKER_MINT_BANK_KEY=\\"\\\$BURNTICKER_SYNTH_BANK_KEY\\" BURNTICKER_MINT_BANK_PATH=\$BANK BURNTICKER_MINT_BANK_WORKERS=1/);
    assert.match(sh, /\[ -n "\$L" \] && \[ "\$L" = "\$BURNTICKER_SYNTH_BANK_KEY" \]/);
    assert.match(sh, /refusing: BURNTICKER_SYNTH_BANK_KEY is the live bank's key/);
    assert.doesNotMatch(sh, /echo[^\n]*\$BURNTICKER_SYNTH_BANK_KEY/, "the key is never printed");
  });
  test("one worker at nice 19: a time-boxed top-up before the instance, then held at size in the background and stopped at the end", () => {
    assert.match(sh, /exec nice -n 19 node [^\n]+scripts\/burnticker-mint-bank\.mts --once --to \$SIZE --max-seconds \$1 \$\(\[ "\$\{2:-\}" != bg \] \|\| echo --hold\)"/);
    assert.match(sh, /SIZE=\$\{SIZE:-12\}/); assert.match(sh, /FILL_S=\$\{FILL_S:-300\}/);
    assert.match(sh, /bank_fill "\$FILL_S" \|\|/);
    assert.match(sh, /bank_fill 0 bg/);
    assert.match(sh, /kill -TERM "\$FILL"/);
  });
  test("the bank instance and the empty-bank instance; the creator gets --empty-base", () => {
    assert.match(sh, /start_web "\$PORT" "\$BANK" 1; WEB=\$!/);
    assert.match(sh, /start_web "\$EMPTY_PORT" "\$D\/empty-bank\.db" 0; WEB2=\$!/);
    assert.match(sh, /EMPTY_ARG="--empty-base http:\/\/127\.0\.0\.1:\$EMPTY_PORT"/);
    assert.match(sh, /--base "http:\/\/127\.0\.0\.1:\$PORT" \$EMPTY_ARG/);
    assert.match(sh, /unset BURNTICKER_MINT_BANK_KEY; \\\n\s+if \[ \$3 = 1 \]; then export BURNTICKER_MINT_BANK_KEY=/, "the empty instance never gets a bank key");
  });
  test("the unit: an hour, room for two web instances, Chrome and the grinder", () => {
    const unit = read("deploy/systemd/mct-burnticker-synth.service");
    assert.match(unit, /^TimeoutStartSec=3600$/m);
    assert.match(unit, /^MemoryMax=2048M$/m);
  });
  test("the nightly fill unit: --fill-bank at 06:00 UTC, two hours at most, copied but not enabled by the installer", () => {
    const unit = read("deploy/systemd/mct-burnticker-synthbank.service"), timer = read("deploy/systemd/mct-burnticker-synthbank.timer");
    assert.match(unit, /^ExecStart=\/bin\/sh %h\/meme-coin-trader\/scripts\/service\/run-burnticker-synth\.sh --fill-bank$/m);
    assert.match(unit, /^TimeoutStartSec=7200$/m); assert.match(unit, /^Nice=19$/m);
    assert.match(timer, /^OnCalendar=\*-\*-\* 06:00:00 UTC$/m);
    const inst = read("scripts/ops/install-burnticker-units.sh");
    assert.match(inst, /UNITS="[^"]*mct-burnticker-synthbank\.service mct-burnticker-synthbank\.timer"/);
    assert.doesNotMatch(inst, /(ENABLE|TIMERS)="[^"]*synthbank/);
    assert.match(sh, /if \[ "\$\{1:-\}" = --fill-bank \] \|\| \[ "\$\{1:-\}" = --bank-status \]; then/);
  });
  test("the bank script: --to N tops up, --hold keeps it there, --max-seconds and SIGTERM stop it; stale taken keys swept first", () => {
    const s = read("scripts/burnticker-mint-bank.mts");
    assert.match(s, /const n = to \? Math\.max\(0, to - ready\)/);
    assert.match(s, /const hold = !!to && args\.includes\("--hold"\)/);
    assert.match(s, /const over = \(\) => stopping \|\| \(maxS > 0 && Date\.now\(\) - t0 >= maxS \* 1000\)/);
    assert.match(s, /const swept = bank\.sweep\(Date\.now\(\)\)/);
  });
});
