// HOW A BURN IS SPREAD OUT (owner, 2026-10-20). Creator coins: the burn runs as soon as a reading settles, one burn spends at most the
// program's 2% of the trading pool's SOL, and the carried rest is burned in smaller pieces at seeded random times over six-hour windows,
// at least 20 minutes apart, each small enough to move the pool's rate by under about 2.5%, window after window until none is left.
// $DEFICIT's keeper does not spread its burns (BURNTICKER_DISPERSAL is not set on its host): one run per reading, the rest carried to the
// next run. The sentences are pinned here and on every surface that says them: the settlement page (the coin page's "How burns are
// settled"), the launch review, the whitepaper (md and html), the trust page and the $DEFICIT page. No network.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DEPTH_PPM, DISPERSAL_MIN_GAP_MS, DISPERSAL_WINDOW_MS, PROGRAM_CAP_BPS, dispersalEnabled, priceMovePct } from "@/lib/burnticker/dispersal";
import { SPREAD_DEFICIT_LINE, SPREAD_DEFICIT_STANDALONE, SPREAD_LINES, SPREAD_REVIEW_LINE } from "@/lib/burnticker/spreadCopy";
import { settlementSections } from "@/lib/burnticker/settlementCopy";
import { MAX_SPEND_RESERVE_BPS } from "@/lib/burnReceipts/constants";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";

const ROOT = path.join(import.meta.dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("how a burn is spread out", () => {
  test("the sentences, exactly", () => {
    assert.deepEqual(SPREAD_LINES, [
      "When a reading settles, the keeper runs the burn right away. One burn may spend at most 2% of the trading pool's SOL, and anything above that is carried.",
      "On creator coins, the carried amount is burned in smaller pieces at random times over a six-hour window, at least 20 minutes apart. Each piece is small enough to move the pool's rate by less than about 2.5%.",
      "If some is still left when the window ends, a new six-hour window starts, and this repeats until all of it is burned. The random times come from a fixed seed, so restarting the keeper does not change them.",
    ]);
    assert.equal(SPREAD_DEFICIT_LINE, "$DEFICIT's burns are not spread out this way. Its keeper runs one burn for each reading, up to the same 2% of the trading pool's SOL, and anything above that carries to its next run.");
    assert.equal(SPREAD_REVIEW_LINE, "When a reading settles, the burn runs right away. One burn spends at most 2% of the trading pool's SOL. Anything above that is burned in smaller pieces at random times over the next six hours, at least 20 minutes apart, and a new six-hour window starts if any is left.");
  });

  test("every number is the code's: the program cap, the window, the gap and the depth ceiling", () => {
    assert.equal(PROGRAM_CAP_BPS, MAX_SPEND_RESERVE_BPS); assert.equal(PROGRAM_CAP_BPS, 200);
    assert.equal(DISPERSAL_WINDOW_MS, 6 * 3_600_000); assert.equal(DISPERSAL_MIN_GAP_MS, 20 * 60_000);
    const reserve = BigInt(1_000_000_000_000), piece = (reserve * BigInt(DEPTH_PPM)) / BigInt(1_000_000);
    assert.ok(priceMovePct(piece, reserve) < 2.5, "a piece at the depth ceiling moves the pool's rate under 2.5%");
  });

  test("which coins: the platform keeper's unit turns dispersal on; the $DEFICIT keeper only on an explicit flag its host does not set", () => {
    assert.match(read("deploy/systemd/mct-burnticker-keeper.service"), /^Environment=BURNTICKER_DISPERSAL=1$/m);
    assert.equal(dispersalEnabled({}), false, "unset is off for the $DEFICIT keeper");
    assert.match(read("scripts/burn-keeper.mts"), /const DISPERSAL = dispersalEnabled\(process[.]env\)/);
    for (const f of fs.readdirSync(path.join(ROOT, "deploy/systemd")).filter((x) => /burnkeeper|burn-keeper|deficit/i.test(x))) assert.doesNotMatch(read(`deploy/systemd/${f}`), /BURNTICKER_DISPERSAL=1/, f);
  });

  test("plain English: every sentence passes the copy lint and says nothing about a price", () => {
    const cfg = loadCopyLintConfig();
    for (const s of [...SPREAD_LINES, SPREAD_DEFICIT_LINE, SPREAD_REVIEW_LINE]) { assert.ok(lintCopy(s, cfg).ok, s); assert.doesNotMatch(s, /\bprice|→| \/ |—/i, s); }
  });

  test("the settlement page (the coin page's How burns are settled) says it, with $DEFICIT's own line", () => {
    const f = { marketPollMin: 5, feedPollMin: 60, guardMinMin: 10, guardMaxMin: 20, spendCapPct: 2, umaHours: 2, deficitReads: ["16:30"], deficitZone: "America/New_York" };
    const burn = settlementSections(f).sections.find((s) => s.id === "burn")!.paragraphs;
    for (const s of SPREAD_LINES) assert.ok(burn.includes(s), s);
    assert.ok(burn.includes(SPREAD_DEFICIT_LINE));
    assert.ok(!burn.some((p) => /arrives in slices/.test(p)), "the old one-line wording is gone");
  });

  test("the whitepaper (md and html), the trust page, the launch review and the $DEFICIT page", () => {
    const wp = read("docs/burnticker/WHITEPAPER.md").replace(/\s+/g, " ");
    for (const s of [...SPREAD_LINES, SPREAD_DEFICIT_LINE]) assert.ok(wp.includes(s), s);
    const html = read("site/burnticker/whitepaper.html").replace(/\s+/g, " ").replace(/&#39;|&apos;/g, "'");
    assert.ok(html.includes("burned in smaller pieces at random times over a six-hour window"));
    const trust = read("src/lib/burnticker/trust.ts");
    assert.match(trust, /SPREAD_LINES\.join\(" "\),\n\s+SPREAD_DEFICIT_LINE,/);
    assert.match(read("src/app/burnticker/launch/page.tsx"), /if \(site\.dispersal\.available\) notes\.push\(SPREAD_REVIEW_LINE\);/);
    const deficit = read("site/deficit/index.html");
    // coordinator 2026-10-20: the $DEFICIT page has no creator-coin paragraphs, so its line says both halves (no "this way" without an antecedent)
    assert.ok(deficit.includes(`<p class="replay" data-spread>${SPREAD_DEFICIT_STANDALONE}</p>`));
    assert.doesNotMatch(SPREAD_DEFICIT_STANDALONE, /this way/); assert.ok(lintCopy(SPREAD_DEFICIT_STANDALONE).ok);
    assert.doesNotMatch(deficit.replace(`<p class="replay" data-spread>${SPREAD_DEFICIT_STANDALONE}</p>`, ""), /six-hour window|random times/, "the $DEFICIT page never claims spreading for $DEFICIT (its one line names creator coins as the ones that spread)");
  });
});
