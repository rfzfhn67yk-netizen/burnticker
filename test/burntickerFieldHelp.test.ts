// EVERY INPUT IN THE LAUNCH FLOW HAS A HOVER HELP (ui-conventions.md pattern #27): each <input>, <select> and <textarea> of the wizard
// and the Coin vs Coin tile carries data-help="<id>" and a <FieldHelp id="<id>"> beside it; every id exists in fieldHelp.ts; the toggle
// groups and review rows the owner listed have theirs; every help string passes the copy lint; the component is accessible.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { FIELD_HELP } from "@/lib/burnticker/fieldHelp";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";

const ROOT = path.join(import.meta.dirname, "..");
const FILES = ["src/app/burnticker/launch/page.tsx", "src/app/burnticker/launch/CoinVsCoinTile.tsx", "src/app/burnticker/launch/ReviewCard.tsx"].map((f) => ({ f, src: fs.readFileSync(path.join(ROOT, f), "utf8") }));
const literalIds = (src: string, re: RegExp) => [...src.matchAll(re)].flatMap((m) => [...m[1].matchAll(/"([a-z0-9-]+)"/g)].map((x) => x[1]));

describe("field help", () => {
  test("every help string has both lines and passes the copy lint", () => {
    const cfg = loadCopyLintConfig();
    for (const [id, h] of Object.entries(FIELD_HELP)) {
      assert.ok(h.what.length > 5 && h.does.length > 5, id);
      for (const t of [h.what, h.does]) { const r = lintCopy(t, cfg); assert.ok(r.ok, `${id}: ${r.hits.map((x) => `${x.phrase} (${x.rule})`).join(", ")}`); }
    }
    assert.match(FIELD_HELP["share-recurring"].does, /pool is fees, not supply/); assert.match(FIELD_HELP["share-recurring"].does, /inflation goal/);
    assert.match(FIELD_HELP["share-oneshot"].does, /burns down over four weeks either way/);
    assert.match(FIELD_HELP.window.does, /retires and burns down over four weeks when the window ends/);
  });

  for (const { f, src } of FILES) test(`${f}: every rendered input carries data-help and its FieldHelp`, () => {
    const tags = [...src.matchAll(/<(input|select|textarea)\b([^>]*?)\/?>/g)];
    assert.ok(tags.length > 0);
    for (const t of tags) assert.match(t[2], /data-help=/, `an input without help in ${f}: ${t[0].slice(0, 90)}`);
    const dataIds = literalIds(src, /data-help=(\{[^}]*\}|"[^"]*")/g), helpIds = literalIds(src, /<FieldHelp id=(\{[^}]*\}|"[^"]*")/g);
    for (const id of dataIds) { assert.ok(id in FIELD_HELP, `${id} has help text`); assert.ok(helpIds.includes(id), `${id} has a FieldHelp beside it`); }
    for (const id of helpIds) assert.ok(id in FIELD_HELP, `${id} has help text`);
  });

  // 2026-10-10 the owner's cut ("the UI needs to be simpler"): the dials, windows, league mode, socials, image and acknowledgement
  // checkboxes left the web UI (API-only; test/burntickerThreeDecisions.test.ts asserts they are gone). What remains still has help.
  test("the owner's list, after the cut: the pickers, elections, weather, Coin vs Coin and the review card's fields", () => {
    const all = FILES.map((x) => x.src).join("\n");
    for (const id of ["search", "league-pick", "team-pick", "team-search", "game-search", "market-search", "outcome-search", "browse-filter", "nws-station", "nws-threshold", "race-type", "race-state", "derby-coin", "name", "ticker", "note"]) assert.ok(all.includes(`"${id}"`), `${id} is rendered`);
  });

  test("the component: a button with aria-describedby, a role=tooltip, hover / focus / tap, Escape and outside-tap close, label-safe click", () => {
    const c = fs.readFileSync(path.join(ROOT, "src/app/burnticker/_components/FieldHelp.tsx"), "utf8");
    for (const needle of ["aria-describedby={tipId}", 'role="tooltip"', "onMouseEnter", "onFocus", "onClick", '"Escape"', '"pointerdown"', "e.preventDefault(); e.stopPropagation()"]) assert.ok(c.includes(needle), needle);
  });
});
