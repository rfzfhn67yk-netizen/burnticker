/**
 * A GAME'S STATUS IN WORDS (HB-115, hourly run 9). The schedule feeds say a game's state in their own short codes: one sports data
 * compiler sends "NS" (not started), "FT" (full time), "HT", "PST", "Q1"; the leagues' own feeds send "Scheduled" or "Final". A card,
 * a search row or the review shows this one set of words for every league, never a feed's code. Client-safe, no imports.
 */
const CODE_WORDS: Readonly<Record<string, string>> = {
  NS: "Scheduled", TBD: "Time to be decided", TBA: "Time to be decided", SCHEDULED: "Scheduled", PRE: "Scheduled", PREGAME: "Scheduled",
  FT: "Final", AOT: "Final", AET: "Final", PEN: "Final", FIN: "Final", FINAL: "Final", POST: "Final", AWD: "Final", WO: "Final",
  HT: "Halftime", BT: "Break", P: "In progress", LIVE: "In progress", IN: "In progress", INT: "Interrupted",
  "1H": "In progress", "2H": "In progress", ET: "In progress", OT: "In progress", BREAK: "Break",
  Q1: "In progress", Q2: "In progress", Q3: "In progress", Q4: "In progress", P1: "In progress", P2: "In progress", P3: "In progress",
  PST: "Postponed", POSTP: "Postponed", POSTPONED: "Postponed", SUSP: "Suspended", SUSPENDED: "Suspended",
  CANC: "Cancelled", CANCELED: "Cancelled", CANCELLED: "Cancelled", ABD: "Abandoned", ABANDONED: "Abandoned",
};
/** Innings ("IN1".."IN9", "T5", "B7") are in progress. */
const INNING = /^(?:IN|T|B)\d{1,2}$/;

/**
 * The words for a feed's status: a known code becomes its word ("NS" → "Scheduled"); a phrase the feed already wrote in words
 * ("Final/OT", "Top 5th", "7:10 PM ET") is kept as written; nothing becomes null, so the caller can show the game time instead.
 */
export function gameStatusWords(detail: string | null | undefined): string | null {
  const d = (detail ?? "").trim();
  if (!d) return null;
  const k = d.toUpperCase().replace(/[\s_-]+/g, "");
  if (CODE_WORDS[k]) return CODE_WORDS[k];
  if (INNING.test(k)) return "In progress";
  // a short all-capital token that is not a known code is still a code, never shown as it is
  if (/^[A-Z0-9]{1,4}$/.test(d)) return null;
  return d;
}
