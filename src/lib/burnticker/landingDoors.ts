import { leagueIndex, LEAGUES_PATH, type LeagueIndex } from "@/lib/burnticker/leagues";

/**
 * THE LANDING PAGE'S SEASONS PREVIEW, FROM THE LEAGUES INDEX (2026-10-10, the owner: all leagues inclusive, never NFL-first, soccer
 * included). site/burnticker/index.html is static; this block is written between `<!-- door2:begin -->` and `<!-- door2:end -->` by
 * scripts/burnticker-door2.mts from the same index /burnticker/leagues serves, and test/burntickerCopy.test.ts fails when the two drift.
 * The sentence names the alphabetical first and last league; the chips are the sports, alphabetical, each with its league count.
 */
export const DOOR2_BEGIN = "<!-- door2:begin -->", DOOR2_END = "<!-- door2:end -->";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function door2Html(ix: LeagueIndex = leagueIndex([], Date.UTC(2026, 9, 10))): string {
  const all = ix.sports.flatMap((s) => s.leagues).map((l) => l.label).sort((a, b) => a.localeCompare(b));
  const sports = [...ix.sports].sort((a, b) => a.label.localeCompare(b.label)).map((s) => s.label.toLowerCase());
  const list = sports.length > 1 ? `${sports.slice(0, -1).join(", ")} and ${sports[sports.length - 1]}` : sports.join("");
  // website-10 (2026-10-12, the owner's review item 15): the "Follow the season" preview on the home, under the coin grid; the links
  // name the three Seasons pages the way every surface does (siteNav.mjs SEASONS_NAV). Plain sentences (owner copy rule, 2026-10-11).
  return [
    `      <div class="head"><h2 id="seasons-h">Follow the season</h2></div>`,
    `      <p>Each league gets one scoreboard per season, from the ${esc(all[0])} to the ${esc(all[all.length - 1])}. A board ranks that league's team coins by their receipts. Rivalries and the Burn Derby keep a running count of burns.</p>`,
    `      <p class="ex">The ${ix.totals.leagues} leagues cover ${esc(list)}. When a league's season ends, the coin with the most receipts is named its champion. That is a line on a scoreboard, and nobody receives anything for it.</p>`,
    `      <p class="links"><a class="go" href="${LEAGUES_PATH}">Leagues</a> <a href="/burnticker/rivalries">Scoreboards</a> <a href="/burnticker/derby">Burn Derby</a></p>`,
].join("\n");
}

/** The landing HTML with door 2 rewritten (throws when the markers are missing). */
export function withDoor2(html: string, block = door2Html()): string {
  const i = html.indexOf(DOOR2_BEGIN), j = html.indexOf(DOOR2_END);
  if (i < 0 || j < i) throw new Error("site/burnticker/index.html: the door2 markers are missing");
  return `${html.slice(0, i + DOOR2_BEGIN.length)}\n${block}\n      ${html.slice(j)}`;
}
