// HOURLY AUDIT 2026-10-20 00:10 DENVER, RUN 12 (docs/burnticker/audits/continuous/2026-10-20-0010-Denver.md; bugs.md HB-136, HB-137,
// HB-139 to HB-142; suggestion HS-54). HB-138 is the deploy smoke (process) and HB-143 shipped as publish 102. One pure test or source
// check per fix, plus the copy lint on every new public sentence.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { lintCopy, loadCopyLintConfig, formatHits } from "@/lib/launch/copyLint";
import { ruleOneLiner } from "@/lib/burnticker/coinCard";
import { sinkCandidates } from "@/lib/burnticker/endSinks";
import { firstPartyRule } from "@/lib/burnticker/wizard";
import { applyDial } from "@/lib/burnticker/dials";
import { RARE_TORNADO_AREAS, rareFadeLine } from "@/lib/burnticker/hazardSeason";
import { hazardPatternOptions } from "@/lib/burnticker/hazards";
import { dueSoonLine, dueSoonShort } from "@/lib/burnticker/timing";
import { badgeFromText, describeRule } from "@/lib/burnticker/describe";
import { polyRule } from "@/lib/burnticker/search";
import { denverDayOf, storedReadingLabel } from "@/lib/burnticker/browse";
import { ATTESTERS_RETIRED_LINE, ATTESTER_LEVEL1_LINE, attesterSummary } from "@/lib/burnticker/attesterSummary";
import { DEFAULT_TOP_UP_CONFIG, denverDay, drainStopFor, type TopUpRow } from "@/lib/burnticker/ops/topUp";
import { timeText } from "@/lib/burnticker/coinsList";
import type { BurnRule } from "@/lib/burnticker/rules";

const cfg = loadCopyLintConfig();
const clean = (s: string) => { const r = lintCopy(s, cfg); assert.ok(r.ok, `${s}\n${formatHits(r)}`); };
const plain = (s: string) => { clean(s); assert.doesNotMatch(s, /\bwill\b|\bbuy\b|\bprice\b|coming soon|\bpayouts?\b|\btarget\b|\bguarantee|→|\b20\d\d-\d\d-\d\d\b|\w\/\w+\//i, s); };
const read = (p: string) => fs.readFileSync(p, "utf8");
const feedRule = (series: string, f = 0.02) => applyDial(firstPartyRule(series, 0.02), "fraction", f) as BurnRule;

describe("HB-136: the sinks API and the end-sink picker say a catalogue coin's rule sentence, never its series id", () => {
  test("the next-earthquake coin reads as the token page's sentence", () => {
    const l = ruleOneLiner(feedRule("usgs.quakenext:6", 1));
    assert.equal(l, "burns once on the next earthquake of magnitude 6 or more anywhere in the world");
    assert.doesNotMatch(ruleOneLiner(feedRule("usgs.quakes:6")), /usgs\.|:/);
    const rows = [{ mint: "M1", ticker: "NEXTM6", name: "Next Magnitude 6", status: "live", cluster: "mainnet", tokenConfig: "cfg", mode: "buyback", rulesJson: JSON.stringify(feedRule("usgs.quakenext:6", 1)) }];
    for (const c of sinkCandidates(rows, { network: "mainnet" })) assert.doesNotMatch(c.rule, /[a-z0-9]\.[a-z0-9_.-]+:/i, c.rule);
  });
});

describe("HB-137: a 'When it does not happen' tornado coin on an area with almost no reports warns that it burns nearly every day", () => {
  const ak = { ...feedRule("spc.tornadoes:AK"), inverse: true } as BurnRule;
  test("Alaska: the burn-step card and the review say it, with the month's share", () => {
    const line = rareFadeLine(ak)!;
    assert.equal(line, "Tornado reports in Alaska are rare, so this coin burns 2% of its pool on almost every day: about 45% of its pool a month, for as long as it lives.");
    plain(line);
    const fade = hazardPatternOptions(feedRule("spc.tornadoes:AK"), Date.parse("2026-10-20T06:00:00Z")).options.find((o) => o.id === "fade")!;
    assert.equal(fade.sentence, line, "the fade card at the burn step carries it");
    assert.ok(RARE_TORNADO_AREAS.includes("AK"));
  });
  test("any area whose saved sample of 30 days or more held no report says so; the US and the every-time side never warn", () => {
    const tx = { ...feedRule("spc.tornadoes:TX"), inverse: true } as BurnRule;
    assert.equal(rareFadeLine(tx), null);
    // HB-150 (hourly run 13): one quiet week is not "rare"; a sample of 30 days or more with no report is
    assert.equal(rareFadeLine(tx, { from: "2026-10-05", to: "2026-10-11", triggers: 7 }), null);
    assert.match(rareFadeLine(tx, { from: "2026-09-01", to: "2026-09-30", triggers: 30 }) ?? "", /^Tornado reports in Texas are rare \(none in the saved sample\)/);
    assert.equal(rareFadeLine(tx, { from: "2026-10-05", to: "2026-10-11", triggers: 5 }), null);
    assert.equal(rareFadeLine({ ...feedRule("spc.tornadoes:US"), inverse: true } as BurnRule), null);
    assert.equal(rareFadeLine(feedRule("spc.tornadoes:AK")), null);
    assert.match(read("src/lib/burnticker/launchReview.ts"), /const rare = rareFadeLine\(locked\.rule, /);
    assert.match(read("src/app/burnticker/launch/page.tsx"), /const rare = rareFadeLine\(rule\); if \(rare\) edgeNotes\.unshift\(rare\);/);
  });
});

describe("HB-139: with no wallet the review button never reads Launch", () => {
  test("the label depends on the wallet alone", () => {
    const card = read("src/app/burnticker/launch/ReviewCard.tsx");
    assert.match(card, /const label = p\.busy \? "Building…" : p\.creator \? \(many \? "Launch both" : "Launch"\) : "Connect wallet";/);
    assert.doesNotMatch(card, /p\.creator \|\| p\.blocked \? \(many/);
  });
});

describe("HB-141: the due-soon warning is said once, and the graduation thought once", () => {
  test("the review keeps the server's warning only, shortened beside the one-time note", () => {
    assert.equal(dueSoonShort(dueSoonLine(12)), "This result is due within 12 days.");
    assert.equal(dueSoonShort(dueSoonLine(1)), "This result is due within 1 day.");
    assert.equal(dueSoonShort("Something else. Kept."), "Something else. Kept.");
    const page = read("src/app/burnticker/launch/page.tsx");
    assert.match(page, /if \(timing\?\.warning && !reviewCurrent\) notes\.push\(timing\.warning\);/);
    assert.match(page, /\.map\(\(w\) => \(windowKindOf\(rule\) === "one-shot" \? dueSoonShort\(w\) : w\)\)/);
  });
});

describe("HB-142: a market coin resolves when the market settles, by its close date", () => {
  test("the pinned sentence and the badge read back", () => {
    const t = describeRule(polyRule("0xabc"), { ticker: "RAYSWS", eventPhrase: "the Tampa Bay Rays win the 2026 World Series", endsAt: "2026-11-01T00:00:00Z" });
    assert.match(t.paragraph, /This coin resolves once, when the market settles \(it closes by Oct 31, 2026\)\./);
    assert.doesNotMatch(t.paragraph, /resolves once, on /);
    assert.match(badgeFromText(polyRule("0xabc"), t.paragraph), /OCT 31, 2026/i);
    // a catalogue one-shot keeps its own day
    assert.doesNotMatch(describeRule(feedRule("usgs.quakenext:6", 1), { ticker: "NEXTM6" }).paragraph, /when the market settles/);
    plain("This coin resolves once, when the market settles.");
  });
});

describe("HB-140: source-review residues", () => {
  test("L1: the public RPC route check runs in every tree", () => {
    const t = read("test/burntickerLeftovers1019.test.ts");
    assert.match(t, /test\("the public RPC route refuses another origin with code cross-origin", \(\) => \{\n {4}assert\.match\(read\("src\/app\/api\/burnticker\/rpc\/route\.ts"\)/);
  });
  test("L2: a Browse reading is dated by its Denver day", () => {
    assert.equal(denverDayOf("2026-10-20T03:30:00Z"), "2026-10-19", "an evening read in Denver");
    assert.match(storedReadingLabel({ id: "r1", value: null }, "2026-10-20T03:30:00Z"), /, read 2026-10-19$/);
  });
  test("L3: the attester level is said once; retired coins are not listed with 0 attesters", () => {
    const s = attesterSummary([{ status: "live", attesters: 1, independent: 0 }, { status: "retired", attesters: 0, independent: 0 }, { status: "paused", attesters: 1, independent: 0 }]);
    assert.equal(s.line, ATTESTER_LEVEL1_LINE); assert.equal(s.rows.length, 2); assert.equal(s.retired, ATTESTERS_RETIRED_LINE);
    plain(ATTESTER_LEVEL1_LINE); plain(ATTESTERS_RETIRED_LINE);
    const pg = read("src/app/burnticker/trust/page.tsx");
    assert.doesNotMatch(pg, /This is level 1: only our own data key signs\./);
    assert.match(pg, /const sum = attesterSummary\(t\.attesters\)/);
  });
  test("L4: the back-off time in ops.json is Denver time", () => {
    assert.match(read("src/lib/burnticker/ops/topUp.ts"), /the next try is at \$\{denverTime\(new Date\(b\.until\)\.toISOString\(\)\)\} \(back-off\)/);
  });
  test("L5: the Irys two-step and its funding retry count once against the drain stop", () => {
    const H = 3_600_000, T0 = Date.parse("2026-10-20T06:00:00Z");
    const row = (o: Partial<TopUpRow>): TopUpRow => ({ id: 1, at: T0, day: denverDay(o.at ?? T0), target: "irys-balance", kind: "transfer", from: "S", to: "P", lamports: BigInt(20_000_000), status: "sent", signature: "s", reason: "r", error: null, ...o });
    const ledger = [
      row({ at: T0 }), row({ at: T0, kind: "irys-fund", status: "failed" }),   // the transfer moved SOL, the funding failed
      row({ at: T0 + 0.5 * H, kind: "irys-fund", lamports: BigInt(20_000_000) }),   // the retry from the wallet's spare SOL
      row({ at: T0 + 2 * H }), row({ at: T0 + 2 * H, kind: "irys-fund" }),   // a second real refill
    ];
    assert.equal(drainStopFor("irys-balance", ledger, T0 + 3 * H, DEFAULT_TOP_UP_CONFIG.drainStop), null, "two refills, not three");
    const third = [...ledger, row({ at: T0 + 4 * H }), row({ at: T0 + 4 * H, kind: "irys-fund" })];
    assert.ok(drainStopFor("irys-balance", third, T0 + 5 * H, DEFAULT_TOP_UP_CONFIG.drainStop), "three real refills in 6 h still stop it");
  });
});

describe("HS-54: a next read days away carries its date", () => {
  test("today, tomorrow and yesterday by name; any other day with its date", () => {
    const z = { now: Date.parse("2026-10-20T06:30:00Z"), timeZone: "America/Denver" };   // Tue 00:30 Denver
    assert.equal(timeText("2026-10-26T17:01:41Z", z), "Mon Oct 26, 11:01 am MDT");
    assert.equal(timeText("2026-10-20T17:01:00Z", z), "today 11:01 am MDT");
    assert.equal(timeText("2026-10-21T17:01:00Z", z), "tomorrow 11:01 am MDT");
    assert.equal(timeText("2026-10-19T17:01:00Z", z), "yesterday 11:01 am MDT");
  });
});
