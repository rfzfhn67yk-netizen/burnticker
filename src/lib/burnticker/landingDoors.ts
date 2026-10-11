import { leagueIndex, LEAGUES_PATH, type LeagueIndex } from "@/lib/burnticker/leagues";

/**
 * THE LANDING PAGE'S SEASONS DOOR, FROM THE LEAGUES INDEX (2026-10-10, the owner: all leagues inclusive, never NFL-first, soccer
 * included). site/burnticker/index.html is static; this block is written between `<!-- door2:begin -->` and `<!-- door2:end -->` by
 * scripts/burnticker-door2.mts from the same index /burnticker/leagues serves, and test/burntickerCopy.test.ts fails when the two drift.
 * The sentence names the alphabetical first and last league; the chips are the sports, alphabetical, each with its league count.
 */
export const DOOR2_BEGIN = "<!-- door2:begin -->", DOOR2_END = "<!-- door2:end -->";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function door2Html(ix: LeagueIndex = leagueIndex([], Date.UTC(2026, 9, 10))): string {
  const all = ix.sports.flatMap((s) => s.leagues).map((l) => l.label).sort((a, b) => a.localeCompare(b));
  const sports = [...ix.sports].sort((a, b) => a.label.localeCompare(b.label)).map((s) => `${s.label} (${s.leagues.length})`);
  return [
    `      <a class="door" href="${LEAGUES_PATH}">`,
    `        <span class="k">the show</span>`,
    `        <h3>Seasons</h3>`,
    `        <p>One scoreboard per league and season — every league Burnticker covers, from the ${esc(all[0])} to the ${esc(all[all.length - 1])} — ranking that league's team coins by receipts. Rivalries and the Burn Derby keep a running tally of burns.</p>`,
    `        <span class="ex">${esc(sports.join(" · "))} — ${ix.totals.leagues} leagues, one scoreboard each</span>`,
    `        <span class="go">Follow the season</span>`,
    `      </a>`,
  ].join("\n");
}

/** The landing HTML with door 2 rewritten (throws when the markers are missing). */
export function withDoor2(html: string, block = door2Html()): string {
  const i = html.indexOf(DOOR2_BEGIN), j = html.indexOf(DOOR2_END);
  if (i < 0 || j < i) throw new Error("site/burnticker/index.html: the door2 markers are missing");
  return `${html.slice(0, i + DOOR2_BEGIN.length)}\n${block}\n      ${html.slice(j)}`;
}
