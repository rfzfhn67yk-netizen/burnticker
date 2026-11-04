// HOW A BURN RUNS (owner, 2026-10-20; rewritten for the owner decision of 2026-10-25, which removed both burn caps from the program).
// The burn runs as soon as a reading settles and spends the rule's full share of the burn pool in one run: there is no burn-pool cap, no
// per-run 2% bound, and no six-hour windows of smaller pieces. A burn waits only under the floor or on a pool that cannot trade, and what
// waits is spent in one piece. $DEFICIT's keeper runs one burn per reading the same way. The sentences are pinned here and on every
// surface that says them: the settlement page (the coin page's "How burns are settled"), the launch review, the whitepaper (md and
// html), the trust page and the $DEFICIT page. No network.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import * as dispersal from "@/lib/burnticker/dispersal";
import { dispersalEnabled } from "@/lib/burnticker/dispersal";
import { SPREAD_DEFICIT_LINE, SPREAD_DEFICIT_STANDALONE, SPREAD_LINES, SPREAD_REVIEW_LINE } from "@/lib/burnticker/spreadCopy";
import { settlementSections } from "@/lib/burnticker/settlementCopy";
import * as constants from "@/lib/burnReceipts/constants";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";

const ROOT = path.join(import.meta.dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("how a burn runs", () => {
  test("the sentences, exactly", () => {
    assert.deepEqual(SPREAD_LINES, [
      "When a reading settles, the burn runs right away and spends the rule's full share of the burn pool in one run.",
      "There is no platform cap on a burn. The burn pool spends what the rule says.",
      "A burn waits only when its share is under the spend floor fixed at launch, or when the trading pool has stopped trading. What waits is spent in one piece by the next run that can trade.",
    ]);
    assert.equal(SPREAD_DEFICIT_LINE, "$DEFICIT's burns run the same way. Its keeper runs one burn for each reading, and each run spends its whole share at once, with no cap on the size of a burn.");
    assert.equal(SPREAD_REVIEW_LINE, "When a reading settles, the burn runs right away and spends the rule's full share of the burn pool in one run.");
  });

  test("the code agrees: no per-run bound, no window, no gap, no depth ceiling", () => {
    for (const n of ["PROGRAM_CAP_BPS", "DISPERSAL_WINDOW_MS", "DISPERSAL_MIN_GAP_MS", "DEPTH_PPM"]) assert.equal(n in dispersal, false, n);
    assert.equal("MAX_SPEND_RESERVE_BPS" in constants, false);
    // the keeper's dispersal step cranks the whole carried amount in one piece
    assert.deepEqual(dispersal.step({ now: 0, carriedLamports: BigInt(5_000_000_000), queueEmpty: true }), { kind: "crank", lamports: BigInt(5_000_000_000) });
  });

  test("which coins: the platform keeper's unit turns dispersal on; the $DEFICIT keeper only on an explicit flag its host does not set", () => {
    assert.match(read("deploy/systemd/mct-burnticker-keeper.service"), /^Environment=BURNTICKER_DISPERSAL=1$/m);
    assert.equal(dispersalEnabled({}), false, "unset is off for the $DEFICIT keeper");
    assert.match(read("scripts/burn-keeper.mts"), /const DISPERSAL = dispersalEnabled\(process[.]env\)/);
    for (const f of fs.readdirSync(path.join(ROOT, "deploy/systemd")).filter((x) => /burnkeeper|burn-keeper|deficit/i.test(x))) assert.doesNotMatch(read(`deploy/systemd/${f}`), /BURNTICKER_DISPERSAL=1/, f);
  });

  test("plain English: every sentence passes the copy lint and says nothing about a price or a cap on the burn", () => {
    const cfg = loadCopyLintConfig();
    for (const s of [...SPREAD_LINES, SPREAD_DEFICIT_LINE, SPREAD_REVIEW_LINE]) { assert.ok(lintCopy(s, cfg).ok, s); assert.doesNotMatch(s, /\bprice|→| \/ |—|at most 2|six-hour|smaller pieces|random times/i, s); }
  });

  test("the settlement page (the coin page's How burns are settled) says it, with $DEFICIT's own line", () => {
    const f = { marketPollMin: 5, feedPollMin: 60, guardMinMin: 10, guardMaxMin: 20, umaHours: 2, deficitReads: ["16:30"], deficitZone: "America/New_York" };
    const burn = settlementSections(f).sections.find((s) => s.id === "burn")!.paragraphs;
    for (const s of SPREAD_LINES) assert.ok(burn.includes(s), s);
    assert.ok(burn.includes(SPREAD_DEFICIT_LINE));
    assert.ok(!burn.some((p) => /arrives in slices/.test(p)), "the old one-line wording is gone");
  });

  test("the whitepaper (md and html), the trust page, the launch review and the $DEFICIT page", () => {
    const wp = read("docs/burnticker/WHITEPAPER.md").replace(/\s+/g, " ");
    for (const s of [...SPREAD_LINES, SPREAD_DEFICIT_LINE]) assert.ok(wp.includes(s), s);
    const html = read("site/burnticker/whitepaper.html").replace(/\s+/g, " ").replace(/&#39;|&apos;/g, "'");
    for (const s of SPREAD_LINES) assert.ok(html.includes(s), s);
    assert.ok(!html.includes("burned in smaller pieces at random times over a six-hour window"));
    const trust = read("src/lib/burnticker/trust.ts");
    assert.match(trust, /SPREAD_LINES\.join\(" "\),\n\s+PLATFORM_AUTHORITY_NO_CAP_SENTENCE,\n\s+SPREAD_DEFICIT_LINE,/);
    assert.match(read("src/app/burnticker/launch/page.tsx"), /^\s+notes\.push\(SPREAD_REVIEW_LINE\);/m);
    const deficit = read("site/deficit/index.html");
    // coordinator 2026-10-20: the $DEFICIT page has no creator-coin paragraphs, so its line says both halves (no "this way" without an antecedent)
    assert.ok(deficit.includes(`<p class="replay" data-spread>${SPREAD_DEFICIT_STANDALONE}</p>`));
    assert.doesNotMatch(SPREAD_DEFICIT_STANDALONE, /this way/); assert.ok(lintCopy(SPREAD_DEFICIT_STANDALONE).ok);
    assert.doesNotMatch(deficit.replace(`<p class="replay" data-spread>${SPREAD_DEFICIT_STANDALONE}</p>`, ""), /six-hour window|random times|smaller pieces|up to 2% of the trading pool/, "the $DEFICIT page says each run spends its whole share");
  });
});
