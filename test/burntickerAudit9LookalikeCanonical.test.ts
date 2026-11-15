// AUDIT 9 (LAUNCH, LA9): HB-188 / B-21 on bc744a85 (9b021229 + 04417de7: one spelling per ESPN window at admission, parsed comparison in
// sameRuleOf, the name check on another window of the same team, a game's event id kept as written). Pure, no network.
// Gate copy (HB-214 fixed 2026-10-21): the LA9-2 case now asserts the refusal. Live coin modelled: $PHINFLWIN "Eagles 2026 Wins" on espn.team:nfl-PHI.21-win-s2026.
import { test } from "node:test";
import assert from "node:assert/strict";
import { lookalikeHits } from "@/lib/burnticker/lookalike";
import { canonicalEspnSeries, parseEspnSeries, pickerTeams } from "@/lib/burnticker/sources/espn";
import { nativeSourceById } from "@/lib/burnticker/sources/native";

const R = (series: string) => ({ oracle: "catalogue", series }) as never;
const LIVE = "espn.team:nfl-PHI.21-win-s2026";
const live = (ticker: string, name: string, series: string) => [{ ticker, name, status: "live", creator: "X", rule: R(series) }] as never;
const hits = (ticker: string, name: string, series: string, ex: never) => lookalikeHits({ ticker, name, rule: R(series), creator: "Y" }, ex);
/** What admission does with an id: ruleRefusals refuses when canon && canon !== id; an id that does not parse has no native source. */
const admission = (id: string) => { const c = canonicalEspnSeries(id); return c === null ? (nativeSourceById(id) ? "parses-no-canon" : "no-source") : c === id ? "admitted-as-is" : `refused->${c}`; };

test("non-canonical spellings of the live window: each is refused at admission or does not parse", () => {
  const forms: Record<string, string> = {
    zzzLetters: "espn.team:nfl-ZZZ.21-win-s2026",
    lowerLetters: "espn.team:nfl-phi.21-win-s2026",
    leadingZeroId: "espn.team:nfl-PHI.021-win-s2026",
    otherNumberSameLetters: "espn.team:nfl-PHI.22-win-s2026",
    zeroWidthInLetters: "espn.team:nfl-PH​I.21-win-s2026",
    zeroWidthInId: "espn.team:nfl-PHI.2​1-win-s2026",
    fullwidthDigits: "espn.team:nfl-PHI.２１-win-s2026",
    upperLeague: "espn.team:NFL-PHI.21-win-s2026",
    trailingSpace: "espn.team:nfl-PHI.21-win-s2026 ",
    nextGameLeadingZero: "espn.team:nfl-PHI.21-win-n01.20261025",
  };
  const out: Record<string, string> = {};
  for (const [k, id] of Object.entries(forms)) out[k] = admission(id);
  console.log(JSON.stringify(out, null, 1));
  for (const [k, v] of Object.entries(out)) assert.ok(v !== "admitted-as-is" && v !== "parses-no-canon", `${k}: ${v}`);
  assert.equal(out.otherNumberSameLetters.startsWith("refused->espn.team:nfl-PHI.21"), false, "a different number is another team, never the Eagles");
});

test("parsed comparison: the ZZZ spelling is the same rule as the live coin (sameRuleOf), so a one-letter ticker is refused", () => {
  const ex = live("PHINFLWIN", "Eagles 2026 Wins", LIVE);
  const h = hits("PH1NFLWIN", "Philly Wins 2026", "espn.team:nfl-ZZZ.21-win-s2026", ex);
  console.log("ZZZ spelling, other name ->", h.map((x) => `${x.field}:${x.how}`).join(",") || "none");
  assert.ok(h.some((x) => x.field === "ticker"));
});

test("another window, identical name: refused against a live coin; against a DRAFT it is not checked (record)", () => {
  const post = "espn.team:nfl-PHI.21-win-p2026";
  const vsLive = hits("PH1NFLWIN", "Eagles 2026 Wins", post, live("PHINFLWIN", "Eagles 2026 Wins", LIVE));
  const vsDraft = hits("PH1NFLWIN", "Eagles 2026 Wins", post, [{ ticker: "PHINFLWIN", name: "Eagles 2026 Wins", status: "draft", creator: "X", rule: R(LIVE) }] as never);
  console.log("other window vs live ->", vsLive.map((x) => `${x.field}:${x.how}`).join(",") || "none", "| vs draft ->", vsDraft.map((x) => `${x.field}:${x.how}`).join(",") || "none");
  assert.ok(vsLive.some((x) => x.field === "name"));
});

test("LA9-2 (HB-214): another window of the same team with a one-character name variant is refused on the name, like the identical name", () => {
  const post = "espn.team:nfl-PHI.21-win-p2026", ex = live("PHINFLWIN", "Eagles 2026 Wins", LIVE);
  const r: Record<string, string> = {};
  for (const name of ["Eag1es 2026 Wins", "Eagles 2026 Wins!", "Eagles 2026 Wins.", "Eagles-2026 Wins", "Eagles 2026 Winz"]) r[name] = hits("PH1NFLWIN", name, post, ex).map((x) => `${x.field}:${x.how}`).join(",") || "none";
  // the same names on the SAME window are refused (skeleton comparison), for contrast
  const same: Record<string, string> = {};
  for (const name of ["Eag1es 2026 Wins", "Eagles 2026 Wins!"]) same[name] = hits("PH1NFLWIN", name, LIVE, ex).map((x) => `${x.field}:${x.how}`).join(",") || "none";
  console.log("other window:", JSON.stringify(r), "| same window:", JSON.stringify(same));
  for (const [name, v] of Object.entries(r)) assert.match(v, /name:(same-letters|one-edit)/, `${name}: ${v}`);
  for (const [name, v] of Object.entries(same)) assert.ok(v !== "none", `${name} on the same window: ${v}`);
  // the year still tells two windows apart (RAYS26 / RAYS27 stay exempt)
  const rays = hits("RAYS27", "Rays 2027 Wins", "espn.team:mlb-TB.30-win-s2027", live("RAYS26", "Rays 2026 Wins", "espn.team:mlb-TB.30-win-s2026"));
  assert.equal(rays.map((x) => `${x.field}:${x.how}`).join(","), "", "distinct years on another window stay exempt");
});

test("alternate abbreviations (record): which ids are admitted as-is but compare unequal to the team's own spelling", () => {
  const rows: string[] = [];
  for (const lg of ["nfl", "nba", "mlb", "nhl"] as const) {
    for (const t of pickerTeams(lg)) {
      const alts = ((t as never as { alt?: string[] }).alt ?? []).filter((a) => a !== t.abbr && /^[A-Z]{2,5}$/.test(a));
      for (const a of alts.slice(0, 1)) {
        const own = `espn.team:${lg}-${t.abbr}-win`, alt = `espn.team:${lg}-${a}-win`;
        const g1 = `espn.game:${lg}-401772510-${t.abbr}-win`, g2 = `espn.game:${lg}-401772510-${a}-win`;
        rows.push(`${lg} ${t.abbr}/${a}: legacy alt ${admission(alt)} key-equal=${canonicalEspnSeries(alt) === canonicalEspnSeries(own)} | game alt ${admission(g2)} key-equal=${canonicalEspnSeries(g2) === canonicalEspnSeries(g1)}`);
      }
    }
  }
  console.log(rows.slice(0, 8).join("\n"), `\n(${rows.length} teams with an alternate abbreviation)`);
  assert.ok(true);
});

test("game ids (record): a leading zero is kept as written (04417de7), so it is admitted and compares unequal; the feed matches event ids by string", () => {
  const a = "espn.game:nfl-401772510-PHI-win", b = "espn.game:nfl-0401772510-PHI-win";
  console.log("game:", admission(a), "|", admission(b), "| key-equal:", canonicalEspnSeries(a) === canonicalEspnSeries(b), "| parsed eventIds:", (parseEspnSeries(b) as never as { eventId: string }).eventId);
  assert.ok(true);
});
