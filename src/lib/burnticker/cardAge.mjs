/**
 * THE ONE AGE FUNCTION (ChatGPT audit 6 item 23 and audit 7 item 23, 2026-10-12): a coin's age on every card, in the app (cardView.ts
 * ageText re-exports it) and on the static home page (scripts/burnticker-site-nav.mts writes this function's source into the page's
 * "age-core" region), so the two cannot print different ages for the same coin. Plain JavaScript with no imports, because its source is
 * copied into a static page.
 *
 *   an exact time ("2026-10-11T18:04:00Z")  the time since then: "under an hour", "5 hours", "1 day", "3 days"
 *   a calendar day only ("2026-10-11")      whole days between that day and today in the viewer's own time zone: "under a day", "1 day"
 *
 * A record that gives only a day never pretends to know the hour. Returns null when there is no time or it cannot be read.
 * @param {string | null | undefined} iso
 * @param {number} now
 * @returns {string | null}
 */
export function cardAge(iso, now) {
  if (!iso) return null;
  var plural = function (n, unit) { return n + " " + unit + (n === 1 ? "" : "s"); };
  var day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (day) {
    var then = new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3]));
    var today = new Date(now); today.setHours(0, 0, 0, 0);
    if (!isFinite(then.getTime()) || !isFinite(today.getTime())) return null;
    var days = Math.round((today.getTime() - then.getTime()) / 86400000);
    return days < 1 ? "under a day" : plural(days, "day");
  }
  var ms = now - Date.parse(iso);
  if (!isFinite(ms)) return null;
  if (ms < 3600000) return "under an hour";
  var h = Math.floor(ms / 3600000), d = Math.floor(h / 24);
  return d >= 1 ? plural(d, "day") : plural(h, "hour");
}
