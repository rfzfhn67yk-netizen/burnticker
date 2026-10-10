import type { BurnJson, StatusJson } from "@/lib/burnKeeper/statusPage";
import { dateIn } from "@/lib/burnKeeper/schedule";
import type { PairTally, PlatformIndexJson, ReceiptJson, TokenStatusJson } from "@/lib/burnticker/tokenPage";
import { BURNTICKER_DEV_FEE_BPS } from "@/lib/burnticker/fees";

/**
 * THE DAILY POST (the owner, 2026-10-09: "come up with a daily post for updates we can post on the website and twitter"). Five
 * canonical formats, every one a REPORT filled from the keeper's own published files (status.json + burns.json; the platform's
 * index.json + t/<ticker>/receipts.json for the @burnticker daily) — never retyped, never freehand:
 *
 *   daily     BURN DAY: receipt number, the Treasury figure and its change, units → tokens bought back and burned, supply, receipt + verify link
 *   noburn    NO-BURN DAY: the factual reason (weekend / federal holiday / the figure did not add a full $1B / not posted yet) + the last receipt
 *   weekly    SUNDAY ROLL-UP: burn days, units, burned, biggest day, supply, pool, SOL spent, creator fees into the burn pool (derived from
 *             receipts) and, separately, the developer's platform fee (25 bps; from status.platformFeeSol, else "not published")
 *   platform  @burnticker DAILY: coins live, burns today and all-time, new launches (ticker + event + source), the public audit badge
 *   incident  INCIDENT: what / when (Denver + UTC) / affected / not affected / what we did / status — the owner's facts, still linted
 *   pair      RIVALRY PAIR (2026-10-10): "$A 3 : 1 $B — every loss burns", supply both sides, the last settlement (market, result,
 *             which side burned), the next scheduled market, the scoreboard link — from the pair's tally (tokenPage.ts pairTally)
 *
 * `pickTemplate` chooses by the day's state on Treasury's clock (America/New_York) and the owner's clock (America/Denver, Sunday =
 * weekly). The same text is rendered on the $DEFICIT page (site/deficit/index.html #today — its JS mirrors `dailyText`, pinned by a
 * parity test) so the website and the post are the same words. Every output goes through the copy lint before it is printed.
 * Pure: no clock (callers pass `now`), no network, no files.
 */

export const DISCLAIMER = "a memecoin — the rule says what supply does, not what price does";
export const PLATFORM_DISCLAIMER = "Memecoins: the rule says what supply does, not what price does.";
export const PAIR_DISCLAIMER = "two memecoins — each rule says what its supply does, not what price does";
export const TREASURY_TZ = "America/New_York";
export const OWNER_TZ = "America/Denver";

export type DailyTemplate = "daily" | "noburn" | "weekly" | "platform" | "incident";
export type NoBurnReason = "weekend" | "holiday" | "no-unit" | "pending" | "late";

// ---- formatting (the site's JS uses the same forms) ----
export const fmtInt = (s: string | number | null | undefined): string => (s == null ? "—" : String(s).split(".")[0].replace(/^-/, "−").replace(/\B(?=(\d{3})+(?!\d))/g, ","));
export const fmtDollars = (usd: string): string => `$${fmtInt(usd)}`;
export const fmtB = (usd: string | number): string => { const n = Number(usd); return `${n >= 0 ? "+" : "−"}$${(Math.abs(n) / 1e9).toFixed(2)}B`; };
export const fmtSol = (s: string | number | null | undefined): string => (s == null ? "—" : `${Number(s).toFixed(4)} SOL`);
export const fmtPct = (n: number): string => `${n.toFixed(2)}%`;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

// ---- Treasury's calendar ----
const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const weekdayOf = (day: string): number => new Date(`${day}T00:00:00Z`).getUTCDay();
export const addDays = (day: string, n: number): string => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const nthWeekday = (y: number, m: number, dow: number, n: number): string => { const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(); const d = 1 + ((dow - first + 7) % 7) + (n - 1) * 7; return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`; };
const lastWeekday = (y: number, m: number, dow: number): string => { const last = new Date(Date.UTC(y, m, 0)); const d = last.getUTCDate() - ((last.getUTCDay() - dow + 7) % 7); return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`; };
const observed = (day: string): string => { const w = weekdayOf(day); return w === 6 ? addDays(day, -1) : w === 0 ? addDays(day, 1) : day; };
/** U.S. federal holidays (observed) in a year — Treasury's Fiscal Service posts nothing on them. */
export function federalHolidays(y: number): Record<string, string> {
  const h: Record<string, string> = {};
  const fixed: [string, string][] = [[`${y}-01-01`, "New Year's Day"], [`${y}-06-19`, "Juneteenth"], [`${y}-07-04`, "Independence Day"], [`${y}-11-11`, "Veterans Day"], [`${y}-12-25`, "Christmas Day"]];
  for (const [d, name] of fixed) h[observed(d)] = name;
  h[nthWeekday(y, 1, 1, 3)] = "Martin Luther King Jr. Day"; h[nthWeekday(y, 2, 1, 3)] = "Presidents' Day"; h[lastWeekday(y, 5, 1)] = "Memorial Day";
  h[nthWeekday(y, 9, 1, 1)] = "Labor Day"; h[nthWeekday(y, 10, 1, 2)] = "Columbus Day"; h[nthWeekday(y, 11, 4, 4)] = "Thanksgiving Day";
  if (observed(`${y + 1}-01-01`) === `${y}-12-31`) h[`${y}-12-31`] = "New Year's Day (observed)";
  return h;
}
export const holidayName = (day: string): string | null => federalHolidays(Number(day.slice(0, 4)))[day] ?? null;
export const isBusinessDay = (day: string): boolean => { const w = weekdayOf(day); return w !== 0 && w !== 6 && holidayName(day) === null; };
export const previousBusinessDay = (day: string): string => { let d = addDays(day, -1); while (!isBusinessDay(d)) d = addDays(d, -1); return d; };
export const nextBusinessDay = (day: string): string => { let d = addDays(day, 1); while (!isBusinessDay(d)) d = addDays(d, 1); return d; };

/** What Treasury's figure for business day B says about posting day P: B is posted on the next business day after B, in the afternoon ET. */
export interface DayState {
  /** The posting day on Treasury's clock. */
  postDay: string;
  /** The record date whose figure is due (or was due) on postDay; null on a weekend / holiday. */
  expected: string | null;
  kind: "burn" | NoBurnReason;
  reason: string;
  /** The burn row for `expected`, when there is one. */
  row: BurnJson | null;
}

export function dayState(status: StatusJson, burns: readonly BurnJson[], nowMs: number, tz = TREASURY_TZ): DayState {
  const postDay = dateIn(nowMs, tz);
  const w = weekdayOf(postDay);
  const hol = holidayName(postDay);
  const lastRow = burns.length ? burns[burns.length - 1] : null;
  const last = status.feed.lastRecordDate;
  if (w === 0 || w === 6) {
    const nextPost = nextBusinessDay(postDay);
    return { postDay, expected: null, kind: "weekend", reason: `Treasury does not post Debt to the Penny on a ${WEEKDAY[w]}. The next figure is ${previousBusinessDay(nextPost)}'s, posted ${WEEKDAY[weekdayOf(nextPost)]} afternoon ET.`, row: null };
  }
  if (hol) {
    const nextPost = nextBusinessDay(postDay);
    return { postDay, expected: null, kind: "holiday", reason: `Treasury does not post Debt to the Penny on ${hol}. The next figure is ${previousBusinessDay(nextPost)}'s, posted ${WEEKDAY[weekdayOf(nextPost)]} afternoon ET.`, row: null };
  }
  const expected = previousBusinessDay(postDay);
  const row = burns.find((b) => b.recordDate === expected) ?? null;
  if (row) return { postDay, expected, kind: "burn", reason: "", row };
  if (last !== null && last >= expected) {
    return { postDay, expected, kind: "no-unit", reason: `Treasury's figure for ${expected} did not add a full $1,000,000,000 over the previous reading, so the rule counted nothing. A rise under $1B carries into the next consecutive rise; a flat or down day resets the remainder to zero.`, row: null };
  }
  const hhmm = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(nowMs));
  if (hhmm < "20:30") return { postDay, expected, kind: "pending", reason: `Treasury's figure for ${expected} is not posted yet (it usually appears mid-afternoon ET); the keeper reads the feed at 16:30 and 20:00 ET${lastRow ? `. Last reading on file: ${last ?? "none"}` : ""}.`, row: null };
  return { postDay, expected, kind: "late", reason: `Treasury's figure for ${expected} was not posted by 20:30 ET; the keeper keeps checking hourly and reads it, with the day's units, when it appears. Last reading on file: ${last ?? "none"}.`, row: null };
}

// ---- the receipt arithmetic the templates share ----
export const receiptNo = (burns: readonly BurnJson[], row: BurnJson): number => burns.findIndex((b) => b.recordDate === row.recordDate) + 1;
/** Supply after a row = initial − every token burned through that row (the burn is the only thing that changes supply). */
export function supplyAfter(status: StatusJson, burns: readonly BurnJson[], row: BurnJson): string {
  const i = burns.findIndex((b) => b.recordDate === row.recordDate);
  let burned = BigInt(0);
  for (const b of burns.slice(0, i + 1)) if (b.status === "confirmed" && b.burned) burned += BigInt(b.burned.split(".")[0]);
  return (BigInt(status.supply.initial.split(".")[0]) - burned).toString();
}
export const verifyUrl = (site: string, n: number): string => `${site.replace(/\/$/, "")}/#r-${n}`;
const siteOf = (site: string | null | undefined) => (site && site.trim() ? site.trim().replace(/\/$/, "") : "{SITE_URL}");

/** (a) BURN DAY — one receipt. Skipped days (under the $1 floor) take the second form. */
export function dailyText(status: StatusJson, burns: readonly BurnJson[], row: BurnJson, site?: string | null): string {
  const n = receiptNo(burns, row);
  const t = status.ticker;
  const carry = Number(row.carryIn) > 0 ? ` · ${fmtB(row.carryIn)} carried` : "";
  const head = `Receipt #${n} · ${row.recordDate}\nDebt to the Penny: ${fmtDollars(row.now)} (${fmtB(row.delta)}${carry})`;
  if (row.status === "skipped") {
    return `${head}\n${plural(row.units, "unit")}, but the day's spend would have been under $1 — nothing bought; the pool keeps it for the next burn day\nSupply unchanged at ${fmtInt(supplyAfter(status, burns, row))}\nverify: ${verifyUrl(siteOf(site), n)}\n${DISCLAIMER}`;
  }
  const spent = row.spent != null ? ` (${fmtSol(row.spent)})` : "";
  const tx = row.txUrl ?? "{TX}";
  return `${head}\n${plural(row.units, "unit")} → ${fmtInt(row.burned)} $${t} bought back and burned${spent}\nSupply now ${fmtInt(supplyAfter(status, burns, row))}\nReceipt: ${tx} · verify: ${verifyUrl(siteOf(site), n)}\n${DISCLAIMER}`;
}

/** (b) NO-BURN DAY — the reason, factually, plus the last receipt so the post still reports something checkable. */
export function noBurnText(status: StatusJson, burns: readonly BurnJson[], state: DayState, site?: string | null): string {
  const t = status.ticker;
  const last = burns.length ? burns[burns.length - 1] : null;
  const lastLine = last ? `Last receipt: #${receiptNo(burns, last)} · ${last.recordDate} · ${fmtB(last.delta)} → ${plural(last.units, "unit")} → ${last.status === "skipped" ? "nothing bought (under the $1 floor)" : `${fmtInt(last.burned)} $${t} burned`}` : `No receipt yet: the first reading after launch is the baseline.`;
  const pool = status.buyback?.feePoolSol != null ? ` · fee pool ${fmtSol(status.buyback.feePoolSol)}` : "";
  const label = state.kind === "weekend" ? `(${WEEKDAY[weekdayOf(state.postDay)]})` : state.kind === "holiday" ? `(${holidayName(state.postDay)})` : state.expected ? `(figure for ${state.expected})` : "";
  return `No burn today, ${state.postDay} ${label}\n${state.reason}\n${lastLine}\nSupply ${fmtInt(status.supply.current)}${pool}\nverify: ${siteOf(site)}/#receipts\n${DISCLAIMER}`;
}

/** The ISO week (Mon..Sun) that contains `day`. */
export function weekOf(day: string): { from: string; to: string } { const w = (weekdayOf(day) + 6) % 7; const from = addDays(day, -w); return { from, to: addDays(from, 6) }; }

/** Creator fees that arrived in the pool between receipts, derived from each row's pool-before-spend: inflow_i = pool_i − (pool_{i−1} − spent_{i−1}). */
export function feesIntoPool(burns: readonly BurnJson[], from: string, to: string, poolNow: string | null): { sol: number; rows: number; exact: false } | null {
  let sol = 0, rows = 0, any = false;
  for (let i = 1; i < burns.length; i++) {
    const b = burns[i], p = burns[i - 1];
    if (b.recordDate < from || b.recordDate > to) continue;
    if (b.pool == null || p.pool == null) continue;
    any = true; rows++;
    sol += Number(b.pool) - (Number(p.pool) - Number(p.spent ?? 0));
  }
  const last = burns[burns.length - 1];
  if (last && last.recordDate >= from && last.recordDate <= to && last.pool != null && poolNow != null) { any = true; sol += Number(poolNow) - (Number(last.pool) - Number(last.spent ?? 0)); }
  return any ? { sol: Math.max(0, sol), rows, exact: false } : null;
}

/** (c) WEEKLY ROLL-UP — the week ending on `sunday` (any day in the week works; the window is Mon..Sun of record dates). */
export function weeklyText(status: StatusJson, burns: readonly BurnJson[], day: string, site?: string | null): string {
  const t = status.ticker;
  const { from, to } = weekOf(day);
  const rows = burns.filter((b) => b.recordDate >= from && b.recordDate <= to);
  const confirmed = rows.filter((b) => b.status === "confirmed");
  const units = rows.reduce((a, b) => a + b.units, 0);
  const burned = confirmed.reduce((a, b) => a + BigInt((b.burned ?? "0").split(".")[0]), BigInt(0));
  const spent = confirmed.reduce((a, b) => a + Number(b.spent ?? 0), 0);
  const biggest = rows.slice().sort((a, b) => b.units - a.units || Number(b.delta) - Number(a.delta))[0] ?? null;
  const lines = rows.map((b) => `${b.recordDate} ${fmtB(b.delta)} → ${b.units}u → ${b.status === "skipped" ? "nothing bought (under the $1 floor)" : `${fmtInt(b.burned)} burned`}`);
  const fees = status.buyback ? feesIntoPool(burns, from, to, status.buyback.feePoolSol) : null;
  const poolLine = status.buyback ? `Fee pool ${fmtSol(status.buyback.feePoolSol)} · spent this week ${fmtSol(spent)}${fees ? ` · creator fees into the burn pool this week ≈ ${fmtSol(fees.sol)} (from the receipts' pool-before-spend; the fee wallet's transfers are the exact record)` : ""}` : null;
  const pf = status.platformFeeSol;
  const platformLine = `Platform fee (${BURNTICKER_DEV_FEE_BPS} bps of curve volume, to the developer) this week: ${pf && pf.week != null ? `${fmtSol(pf.week)}${pf.total != null ? ` · ${fmtSol(pf.total)} in all` : ""}` : "not published"}`;
  return [
    `Week ${from} → ${to} on the debt tape`,
    rows.length ? lines.join("\n") : `No burn day this week: no business-day figure added a full $1B.`,
    `Burn days ${confirmed.length} · units ${units} · bought back and burned ${fmtInt(burned.toString())} $${t}`,
    biggest ? `Biggest day: ${biggest.recordDate}, ${fmtB(biggest.delta)} → ${plural(biggest.units, "unit")} → ${biggest.status === "skipped" ? "nothing bought" : `${fmtInt(biggest.burned)} burned`}` : null,
    `Supply now ${fmtInt(status.supply.current)} (${fmtPct(status.burned.pctOfSupply)} burned since launch, ${status.burned.count} receipts)`,
    poolLine,
    platformLine,
    `Every line has a receipt: ${siteOf(site)}/#receipts`,
    DISCLAIMER,
  ].filter((x): x is string => x !== null).join("\n");
}

// ---- the platform daily (@burnticker) ----
export interface PlatformDailyInput { index: PlatformIndexJson; receiptsByTicker: Record<string, readonly ReceiptJson[]>; day: string; site?: string | null }

/** A receipt "happened" on a day when its settlement (the reading's period / settled time) falls on that UTC day. */
const onDay = (r: ReceiptJson, day: string) => r.settledAt.slice(0, 10) === day || r.eventId === day;

/** (d) PLATFORM DAILY — coins live, burns today and all-time, new launches with ticker + event + source, the audit badge. */
export function platformDailyText(i: PlatformDailyInput): string {
  const ix = i.index;
  const live = ix.tokens.filter((t) => t.status === "live");
  const today: string[] = [];
  let burnsToday = 0;
  for (const t of ix.tokens) {
    for (const r of i.receiptsByTicker[t.ticker] ?? []) {
      if (!onDay(r, i.day)) continue;
      if (r.status === "confirmed" && Number(r.burned ?? 0) > 0) { burnsToday++; today.push(`$${t.ticker} — ${t.seriesTitle ?? t.selectorKey} ${r.eventId}, ${plural(r.units, "unit")} → ${fmtInt(r.burned)} burned`); }
      else if (r.status === "skipped") today.push(`$${t.ticker} — ${t.seriesTitle ?? t.selectorKey} ${r.eventId}, ${plural(r.units, "unit")}, nothing bought (${r.skippedReason ?? "under the floor"})`);
    }
  }
  const launches = ix.tokens.filter((t) => t.launchedAt && t.launchedAt.slice(0, 10) === i.day).map((t) => `$${t.ticker} — ${t.seriesTitle ?? t.selectorKey} (${t.oracle === "kalshi" ? "Kalshi" : t.selectorKey.replace(/^catalogue:/, "")})`);
  const a = ix.audit;
  const audit = a ? (a.ok ? `all ${a.receipts} receipts recompute (${a.chainChecked ? "source + chain" : "source only"}) · ran ${a.ranAt.slice(0, 16).replace("T", " ")}Z` : `${a.mismatches} of ${a.receipts} receipts do not recompute — on the trust page, with the reason`) : "not run yet";
  return [
    `Burnticker · ${i.day}`,
    `Coins live: ${live.length} · burns on the tape today: ${burnsToday} (all-time ${ix.totals.burns}) · tokens burned all-time: ${fmtInt(ix.totals.burnedTokens)}`,
    today.length ? `Today:\n${today.join("\n")}` : `Today: no burn on any coin.`,
    `New launches: ${launches.length ? launches.join("; ") : "none"}`,
    `Audit: ${audit}`,
    `${PLATFORM_DISCLAIMER} ${siteOf(i.site)}`,
  ].join("\n");
}

// ---- incidents ----
export interface IncidentInput { at: number; what: string; affects: string; action: string; status: string; notAffected?: string }
const stamp = (ms: number, tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(ms)).replace(",", "");
/** (e) INCIDENT — the owner's facts in a fixed frame; the lint runs on the filled text like any other. */
export function incidentText(i: IncidentInput): string {
  return [
    `Incident · ${stamp(i.at, OWNER_TZ)} Denver (${new Date(i.at).toISOString().slice(0, 16).replace("T", " ")} UTC)`,
    `What happened: ${i.what.trim()}`,
    `Affected: ${i.affects.trim()}`,
    `Not affected: ${(i.notAffected ?? "holders' balances, the rule and its hash, every receipt already confirmed").trim()}`,
    `What we did: ${i.action.trim()}`,
    `Status: ${i.status.trim()}`,
    `Any correction posts in this thread with the receipt that shows it.`,
  ].join("\n");
}

// ---- the picker ----
export interface Picked { template: DailyTemplate; state: DayState; text: string }
/** `--auto`: Sunday (owner's clock) → weekly; a burn row for the expected record date → daily; otherwise the no-burn report with its reason. */
export function pickTemplate(status: StatusJson, burns: readonly BurnJson[], nowMs: number, site?: string | null): Picked {
  const state = dayState(status, burns, nowMs);
  if (weekdayOf(dateIn(nowMs, OWNER_TZ)) === 0) return { template: "weekly", state, text: weeklyText(status, burns, dateIn(nowMs, OWNER_TZ), site) };
  if (state.kind === "burn" && state.row) return { template: "daily", state, text: dailyText(status, burns, state.row, site) };
  return { template: "noburn", state, text: noBurnText(status, burns, state, site) };
}

// ---- the platform token page's "Today" (tokenPage.ts) ----
/** One Burnticker token's day line, from its own status.json + receipts.json. */
export function tokenDayText(s: TokenStatusJson, receipts: readonly ReceiptJson[], day: string): string {
  const todays = receipts.filter((r) => onDay(r, day));
  const confirmed = todays.filter((r) => r.status === "confirmed" && Number(r.burned ?? 0) > 0);
  if (confirmed.length) {
    const r = confirmed[confirmed.length - 1];
    const n = receipts.findIndex((x) => x.eventId === r.eventId && x.settledAt === r.settledAt) + 1;
    return `Receipt #${n} · ${day}\n${s.seriesTitle ?? s.selectorKey}: ${r.value ?? r.result ?? r.eventId}${r.prevValue !== null ? ` (previous ${r.prevValue})` : ""}\n${plural(r.units, "unit")} → ${fmtInt(r.burned)} $${s.ticker} bought back and burned${r.spent ? ` (${fmtSol(r.spent)})` : ""}\nSupply now ${fmtInt(s.supply.current)}\n${r.txUrl ? `Receipt: ${r.txUrl}\n` : ""}${DISCLAIMER}`;
  }
  const last = [...receipts].reverse().find((r) => r.status === "confirmed" && Number(r.burned ?? 0) > 0) ?? null;
  const why = todays.length ? `The ${plural(todays.length, "reading")} for today counted ${todays.reduce((a, r) => a + r.units, 0)} unit(s): ${todays.map((r) => r.status === "skipped" ? `nothing bought (${r.skippedReason ?? "under the floor"})` : r.status).join(", ")}.` : s.next.nextCheckAt ? `No settled reading for today yet; the next check is ${s.next.nextCheckAt.slice(0, 16).replace("T", " ")}Z.` : `No settled reading for today.`;
  return `No burn today, ${day}\n${why}\n${last ? `Last receipt: ${last.eventId} · ${plural(last.units, "unit")} → ${fmtInt(last.burned)} $${s.ticker} burned` : "No receipt yet."}\nSupply ${fmtInt(s.supply.current)}\n${DISCLAIMER}`;
}

// ---- the rivalry pair (the pair page's share line and the @burnticker post) ----
/** The share line alone: "$A 3 : 1 $B — every loss burns". */
export const pairShareLine = (t: Pick<PairTally, "a" | "b" | "burnsA" | "burnsB">): string => `$${t.a.ticker} ${t.burnsA} : ${t.burnsB} $${t.b.ticker} — every loss burns`;

/**
 * (f) RIVALRY PAIR — the scoreboard as a report: burns A : B, supply A : B (and % of the starting supply left), the last settlement
 * with its market ticker and result and the side it burned, the next scheduled market (no odds in the post; the page shows the
 * display-only implied chance), the pair page link. Filled from pairTally over both sides' status.json + receipts.json.
 */
export function pairDailyText(t: PairTally, site?: string | null): string {
  const A = `$${t.a.ticker}`, B = `$${t.b.ticker}`;
  const ls = t.lastSettlement;
  const outcome = ls ? (ls.result ?? ls.value ?? "—").toUpperCase() : "";
  const last = !ls ? "No settlement yet since launch: the first one burns one side."
    : ls.burnedSide ? `Last: ${ls.eventId} settled ${outcome} → ${ls.burnedSide === "A" ? A : B} burned${ls.burned ? ` ${fmtInt(ls.burned)}` : ""}`
    : `Last: ${ls.eventId} settled ${outcome} → neither side burned${ls.result === "void" ? " (void)" : ""}`;
  return [
    pairShareLine(t),
    `Supply ${fmtInt(t.supplyA)} : ${fmtInt(t.supplyB)} (${fmtPct(t.supplyPctA)} : ${fmtPct(t.supplyPctB)} of the start)`,
    `${t.settlements} ${t.settlements === 1 ? "settlement" : "settlements"}${t.voids ? `, ${t.voids} void` : ""} · one market, inverted rules`,
    last,
    t.next.market ? `Next market: ${t.next.market}${t.next.closeTime ? ` (closes ${t.next.closeTime.slice(0, 16).replace("T", " ")}Z)` : ""}` : null,
    `Scoreboard: ${siteOf(site)}/p/${t.pairId}/`,
    PAIR_DISCLAIMER,
  ].filter((x): x is string => x !== null).join("\n");
}
