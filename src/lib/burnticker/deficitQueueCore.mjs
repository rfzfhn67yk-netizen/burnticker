/**
 * THE QUEUED-UNITS COUNTER (website-14, LAUNCHPAD-PATH §73; owner decision 2026-10-12). Before $DEFICIT graduates, every Treasury reading
 * the keeper attests records its units on chain, and they wait for the pool. This turns the keeper's own published files (status.json and
 * burns.json, written by src/lib/burnKeeper/statusPage.ts) into one honest state and its sentences:
 *
 *   unavailable   the files could not be read (or are not the keeper's schema), including a missing, unparsable or wrong-shape
 *                 burns.json once the coin is launched: say so, never a placeholder number. Only a valid empty list means zero.
 *   not-launched  the pre-launch file: no mint, no reading, nothing queued
 *   no-reading    launched, but the keeper has not published a reading yet (the first one is the baseline)
 *   queued        launched, the trading pool is not registered: N units wait; the debt's rise since launch; 1 − 0.98^N of the burn pool
 *   pool-open     the pool is registered: readings burn as they come in; any units still waiting are counted
 *
 * Plain JavaScript with no imports, because the same function runs in three places: the app's server (src/lib/burnticker/deficitQueue.ts
 * wraps it with types), the $DEFICIT site (scripts/burnticker-site-nav.mts writes its source into site/deficit/index.html) and the
 * tests, which hold all three equal. Every number comes from the two files; nothing here is typed in.
 */

/** Statuses of a burn row that are still waiting for the program (statusPage.ts health.pending). */
export const QUEUE_PENDING = ["planned", "sending", "swap-sent", "swapped"];
/** A published file older than this is called out as possibly out of date (the keeper publishes at least every 15 minutes). */
export const QUEUE_STALE_MS = 60 * 60 * 1000;

/**
 * @param {any} status the keeper's status.json (or null when unread)
 * @param {any} burnsFile the keeper's burns.json (an array, or { burns: [] }), or null
 * @param {number} now
 * @param {string | number | null} [writtenAt] when the keeper wrote status.json (the file's own write time, which the app reads from disk).
 *   Hourly run 6 HB-90: the "published at" line comes from it. Null means the time is not known, and the line is left out. Left out
 *   entirely (the static site and its first paint, which read the file the keeper wrote beside them), the keeper's own stamp in the file is used.
 * @returns {{ state: "unavailable" | "not-launched" | "no-reading" | "queued" | "pool-open"; riseUsd: string | null; units: number; unsigned: number; sharePct: string | null; formula: string | null; readingDate: string | null; generatedAt: string | null; stale: boolean; raiseSol: string | null; headline: string; lines: string[]; card: string | null }}
 */
export function deficitQueueCore(status, burnsFile, now, writtenAt) {
  var PENDING = ["planned", "sending", "swap-sent", "swapped"], STALE = 60 * 60 * 1000;
  var ticker = status && status.ticker ? String(status.ticker) : "DEFICIT";
  function out(state, o) {
    return { state: state, riseUsd: o.riseUsd == null ? null : o.riseUsd, units: o.units || 0, unsigned: o.unsigned || 0, sharePct: o.sharePct == null ? null : o.sharePct,
      formula: o.formula || null, readingDate: o.readingDate || null, generatedAt: o.generatedAt || null, stale: !!o.stale, raiseSol: o.raiseSol || null,
      headline: o.headline, lines: o.lines || [], card: o.card || null };
  }
  if (!status || typeof status !== "object") return out("unavailable", { headline: "The queue is unavailable, because the keeper's published status did not load.", card: null });
  if (status.state === "not-launched" || /prelaunch/.test(String(status.schema || ""))) {
    return out("not-launched", { headline: "$" + ticker + " is not created yet, so no reading has been recorded and nothing is queued.", generatedAt: status.generatedAt || null });
  }
  if (status.schema !== "burnkeeper.status/v1") return out("unavailable", { headline: "The queue is unavailable, because the keeper's status file is in a format this page does not read." });
  // website-15 (code review 6, P2 1): a missing, unparsable or wrong-shape burns.json is unavailable, never an empty history
  var rows = Array.isArray(burnsFile) ? burnsFile : burnsFile && typeof burnsFile === "object" && Array.isArray(burnsFile.burns) ? burnsFile.burns : null;
  if (rows) for (var j = 0; j < rows.length; j++) if (!rows[j] || typeof rows[j] !== "object" || typeof rows[j].status !== "string") { rows = null; break; }
  if (!rows) return out("unavailable", { headline: "The queue is unavailable, because the keeper's list of readings and burns did not load.", generatedAt: status.generatedAt || null });
  var gen = writtenAt === undefined ? Date.parse(status.generatedAt) : writtenAt === null ? NaN : typeof writtenAt === "number" ? writtenAt : Date.parse(writtenAt);
  var stale = isFinite(gen) && now - gen > STALE;
  var feed = status.feed || {};
  var prog = status.program || null;
  var lastOnChain = prog && prog.queue ? prog.queue.lastOnChain : null;
  var units = 0, unsigned = 0;
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (!r || PENDING.indexOf(r.status) < 0) continue;
    var n = Number(r.units) || 0;
    // a reading counts as queued once it is on chain; with no program block the keeper's own record is all there is
    if (!prog || (lastOnChain && String(r.recordDate) <= String(lastOnChain))) units += n; else unsigned += n;
  }
  var riseUsd = null;
  if (feed.baseline && feed.baseline.amount != null && feed.lastAmount != null) {
    var rise = Number(feed.lastAmount) - Number(feed.baseline.amount);
    if (isFinite(rise)) riseUsd = rise.toFixed(2);
  }
  var f = status.buyback && status.buyback.fractionPerUnit != null ? Number(status.buyback.fractionPerUnit) : NaN;
  var keep = isFinite(f) ? Math.round((1 - f) * 10000) / 10000 : null;
  var share = keep === null ? null : (1 - Math.pow(keep, units)) * 100;
  var sharePct = share === null ? null : share.toFixed(2);
  var formula = keep === null ? null : "1 − " + keep + "^" + units;
  var curve = status.curve || null;
  var raiseSol = curve && curve.threshold ? trimNum(curve.threshold) : null;
  var poolOpen = !!(prog && prog.pool && prog.pool.registered);
  var readingDate = feed.lastRecordDate || null;
  var base = { riseUsd: riseUsd, units: units, unsigned: unsigned, sharePct: sharePct, formula: formula, readingDate: readingDate, generatedAt: status.generatedAt || null, stale: stale, raiseSol: raiseSol };
  var lines = [];
  // HB-90: the time the keeper wrote its status file; when that time is not known, no line at all
  var freshness = isFinite(gen) ? "The keeper last wrote its status file at " + denver(gen) + " Denver time." + (stale ? " That was more than an hour ago, so it may be out of date." : "") : null;
  if (!readingDate) {
    base.headline = "The keeper has not published a reading since launch yet. The first reading is the baseline, and nothing is counted for it.";
    base.lines = freshness ? [freshness] : [];
    return out("no-reading", base);
  }
  // Hourly run 6 HB-90: units count every rise from one reading to the next, so a fall and its recovery both count, and the rise is
  // measured from the baseline reading. The headline says both things as what they are, with the baseline's own date.
  var baseDate = feed.baseline && feed.baseline.recordDate ? shortDate(String(feed.baseline.recordDate)) : null;
  var since = baseDate ? "than on " + baseDate : "than at the first reading";
  var riseText = riseUsd === null ? null : Number(riseUsd) >= 0 ? "The debt is " + usd(riseUsd) + " higher " + since + "." : "The debt is " + usd(String(-Number(riseUsd))) + " lower " + since + ".";
  var sinceText = baseDate ? "since " + baseDate : "since the first reading";
  var unitsText = units === 0 ? "No units are queued." : "Daily rises " + sinceText + " add up to " + (units === 1 ? "one queued unit" : groupInt(units) + " queued units") + " ($1B each).";
  if (!poolOpen) {
    base.headline = [unitsText, riseText].filter(Boolean).join(" ");
    if (units > 0 && sharePct !== null) lines.push("When the curve fills" + (raiseSol ? " at " + raiseSol + " SOL" : "") + " and its pool is registered, the queued readings run in order and together spend " + formula + " of the burn pool, which is " + sharePct + "%. Each run spends its whole share at once, with no cap on the size of a burn.");
    else if (units === 0) lines.push("A unit is queued for each full $1B the debt rises from one business day to the next. Nothing burns before the curve fills and its pool is registered.");
    if (riseUsd === null) lines.push("The rise since the first reading is not in the keeper's published file yet.");
    if (unsigned > 0) lines.push((unsigned === 1 ? "One more unit is" : groupInt(unsigned) + " more units are") + " recorded by the keeper and not yet signed on chain.");
    lines.push("The latest reading is the Treasury figure for " + readingDate + "." + (freshness ? " " + freshness : ""));
    base.lines = lines;
    base.card = units > 0 ? "0 $" + ticker + ", " + (units === 1 ? "1 unit" : groupInt(units) + " units") + " queued" : null;
    return out("queued", base);
  }
  base.headline = [riseText, units === 0 ? "The pool is registered, and no units are waiting." : "The pool is registered. " + (units === 1 ? "One unit is" : groupInt(units) + " units are") + " waiting for a burn run."].filter(Boolean).join(" ");
  if (unsigned > 0) lines.push((unsigned === 1 ? "One more unit is" : groupInt(unsigned) + " more units are") + " recorded by the keeper and not yet signed on chain.");
  lines.push("The latest reading is the Treasury figure for " + readingDate + "." + (freshness ? " " + freshness : ""));
  base.lines = lines;
  return out("pool-open", base);

  function groupInt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
  function shortDate(d) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
    if (!m) return null;
    return ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m[2]) - 1] + " " + Number(m[3]);
  }
  function trimNum(s) { var t = String(s); return t.indexOf(".") >= 0 ? t.replace(/0+$/, "").replace(/\.$/, "") : t; }
  function usd(s) {
    var v = Number(s);
    if (v >= 1e9) return "$" + (Math.round(v / 1e7) / 100).toFixed(2) + " billion";
    if (v >= 1e6) return "$" + (Math.round(v / 1e4) / 100).toFixed(2) + " million";
    return "$" + groupInt(Math.round(v));
  }
  function denver(ms) {
    try { return new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(ms)); }
    catch (e) { return new Date(ms).toISOString().slice(0, 16).replace("T", " ") + " UTC"; }
  }
}
