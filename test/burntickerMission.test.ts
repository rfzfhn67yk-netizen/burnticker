// THE MISSION STATEMENT (2026-10-18): one constant (src/lib/burnticker/mission.ts) feeds the About page, the press page and the
// whitepaper's opening paragraph; the statement and the X bio pass the copy lint; the bio fits 160 characters and avoids the words the
// owner ruled out; the social doc carries the bio verbatim.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { lintCopy, loadCopyLintConfig, formatHits } from "@/lib/launch/copyLint";
import { MISSION_STATEMENT, MISSION_BIO } from "@/lib/burnticker/mission";

const cfg = loadCopyLintConfig();
const read = (p: string) => fs.readFileSync(p, "utf8");

describe("mission statement", () => {
  test("the statement is the owner's exact text", () => {
    assert.equal(MISSION_STATEMENT, "Memecoins got boring. Burnticker ties every coin to something that actually happens: a game, a vote, a number in the news. When it happens, tokens burn. No team, no roadmap, no vibes. Just a result and a receipt anyone can check. On Solana.");
  });
  test("the statement and the bio pass the copy lint", () => {
    for (const t of [MISSION_STATEMENT, MISSION_BIO]) { const r = lintCopy(t, cfg); assert.equal(r.hits.length, 0, `${t}\n${formatHits(r)}`); }
  });
  test("the bio fits an X bio and avoids the ruled-out words", () => {
    assert.ok(MISSION_BIO.length <= 160, `${MISSION_BIO.length}`);
    assert.doesNotMatch(MISSION_BIO, /\b(will|payouts?|price|buy|bet|odds|wager|jackpot|win|gambl\w*|prize)\b/i);
  });
  test("the About page and the press page read the constant", () => {
    for (const p of ["src/app/burnticker/about/page.tsx", "src/app/burnticker/press/page.tsx"]) {
      const s = read(p);
      const importLine = s.split("\n").find((l) => l.startsWith("import") && l.includes("MISSION_STATEMENT"));
      assert.ok(importLine?.endsWith(["", "lib", "burnticker", "mission\";"].join("/")), p);
      assert.match(s, /\{MISSION_STATEMENT\}/, p);
    }
    assert.match(read("src/app/burnticker/press/page.tsx"), /PRESS_COPY\.missionTitle/);
    assert.match(read("src/lib/burnticker/historyCopy.ts"), /missionTitle: "In one paragraph"/);
  });
  test("the whitepaper opens with the statement, in the Markdown and the generated page", () => {
    const md = read("docs/burnticker/WHITEPAPER.md").split("\n");
    assert.match(md[0], /^# /);
    const firstPara = md.slice(1).find((l) => l.trim() !== "");
    assert.equal(firstPara, MISSION_STATEMENT);
    assert.ok(read("site/burnticker/whitepaper.html").includes(MISSION_STATEMENT));
  });
  test("the social doc carries the bio verbatim", () => {
    assert.ok(read("docs/burnticker/SOCIAL.md").includes(MISSION_BIO));
  });
});
