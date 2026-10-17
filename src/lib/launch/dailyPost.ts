import type { BurnJson, StatusJson } from "@/lib/burnKeeper/statusPage";
import { dateIn } from "@/lib/burnKeeper/schedule";
import type { PairKind, PairTally, PlatformIndexJson, ReceiptJson, TokenStatusJson } from "@/lib/burnticker/tokenPage";
import { BURNTICKER_DEV_FEE_BPS } from "@/lib/burnticker/fees";
import { byCoin } from "@/lib/burnticker/coinKey";

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
 *   receipt   @BurnTicker RECEIPT (2026-10-10, "the receipt is the product"): one post per confirmed burn, plain and numeric — receipt
 *             number, ticker, settled day, the reading, units → tokens burned, supply, tx + page link. Nothing else.
 *   scoreboard @BurnTicker SCOREBOARD (2026-10-10, "a season is a scoreboard of burns"): ONE LEAGUE, ONE SEASON per post — "NHL 2026–27
 *             · Oct 9 · 4 team coins · 3 burned yesterday", then that league's coins ranked by receipts. The leader is "most receipts so
 *             far"; "champion" only once the season has ended. Never a cross-league ranking: across leagues only a count (`allLeaguesLine`).
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
export interface PlatformDailyInput { index: PlatformIndexJson; receiptsByTicker: Record<string, readonly ReceiptJson[]>; day: string; site?: string | null; /** LP locked forever (2026-10-10): each coin's last claim_lock_fees (status.json lp.lastClaim). */ lpClaims?: { ticker: string; at: string; line: string }[] }

/** A receipt "happened" on a day when its settlement (the reading's period / settled time) falls on that UTC day. */
const onDay = (r: ReceiptJson, day: string) => r.settledAt.slice(0, 10) === day || r.eventId === day;

/** (d) PLATFORM DAILY — coins live, burns today and all-time, new launches with ticker + event + source, the audit badge. */
export function platformDailyText(i: PlatformDailyInput): string {
  const ix = i.index;
  const live = ix.tokens.filter((t) => t.status === "live");
  const today: string[] = [];
  let burnsToday = 0;
  for (const t of ix.tokens) {
    for (const r of byCoin(i.receiptsByTicker, t) ?? []) {
      if (!onDay(r, i.day)) continue;
      if (r.status === "confirmed" && Number(r.burned ?? 0) > 0) { burnsToday++; today.push(`$${t.ticker} — ${t.seriesTitle ?? t.selectorKey} ${r.eventId}, ${plural(r.units, "unit")} → ${fmtInt(r.burned)} burned`); }
      else if (r.status === "skipped") today.push(`$${t.ticker} — ${t.seriesTitle ?? t.selectorKey} ${r.eventId}, ${plural(r.units, "unit")}, nothing bought (${r.skippedReason ?? "under the floor"})`);
    }
  }
  const lpClaims = (i.lpClaims ?? []).filter((c) => c.at.slice(0, 10) === i.day);
  const launches = ix.tokens.filter((t) => t.launchedAt && t.launchedAt.slice(0, 10) === i.day).map((t) => `$${t.ticker} — ${t.seriesTitle ?? t.selectorKey} (${t.oracle === "kalshi" ? "Kalshi" : t.oracle === "polymarket" ? "Polymarket" : t.selectorKey.replace(/^catalogue:/, "")})`);
  const a = ix.audit;
  const audit = a ? (a.ok ? `all ${a.receipts} receipts recompute (${a.chainChecked ? "source + chain" : "source only"}) · ran ${a.ranAt.slice(0, 16).replace("T", " ")}Z` : `${a.mismatches} of ${a.receipts} receipts do not recompute — on the trust page, with the reason`) : "not run yet";
  return [
    `Burnticker · ${i.day}`,
    `Coins live: ${live.length} · burns on the tape today: ${burnsToday} (all-time ${ix.totals.burns}) · tokens burned all-time: ${fmtInt(ix.totals.burnedTokens)}`,
    today.length ? `Today:\n${today.join("\n")}` : `Today: no burn on any coin.`,
    `New launches: ${launches.length ? launches.join("; ") : "none"}`,
    ...(lpClaims.length ? [`LP fees claimed today: ${lpClaims.map((c) => `$${c.ticker}: ${c.line}`).join("; ")}`] : []),
    `Audit: ${audit}`,
    `${PLATFORM_DISCLAIMER} ${siteOf(i.site)}`,
  ].join("\n");
}

/** The daily post footer's registry-snapshot line (trust ops, 2026-10-10 night): the latest Arweave snapshot's date, sha256 and transaction id; null when none is pinned. */
export const snapshotLine = (s: { date: string; sha256: string; arweaveTxId: string } | null | undefined): string | null => (s ? `Ledger snapshot ${s.date}: sha256 ${s.sha256.slice(0, 16)}… · arweave ${s.arweaveTxId}` : null);

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
/**
 * The FIRST post of a coin (2026-10-10): its auto-generated description (describe.ts — lint-clean by construction) as the launch-day
 * text, until the first reading lands; then the daily receipt posts take over.
 */
export function launchDayText(s: Pick<TokenStatusJson, "ticker"> & { profile?: { description: string; badge?: string } | null }): string | null {
  const d = s.profile?.description?.trim();
  return d ? `${d}\n${withTag(DISCLAIMER, s.profile?.badge)}` : null;
}
/** The footer line with the coin's window tag ("… not what price does · 2026 SEASON"): every token post carries its window. */
export const withTag = (footer: string, tag: string | null | undefined): string => (tag ? `${footer} · ${tag}` : footer);

/** The LP-fee receipt line for a day (LP locked forever, 2026-10-10): the coin's last claim_lock_fees, when it landed that UTC day. */
export const lpClaimLineOn = (s: Pick<TokenStatusJson, "lp">, day: string): string | null => (s.lp?.lastClaim && s.lp.lastClaim.at.slice(0, 10) === day ? s.lp.lastClaim.line : null);

export function tokenDayText(s: TokenStatusJson, receipts: readonly ReceiptJson[], day: string): string {
  const body = tokenDayBody(s, receipts, day);
  const lp = lpClaimLineOn(s, day);
  if (!lp) return body;
  // the LP-fee line goes right above the footer (the footer is always the last line)
  const lines = body.split("\n");
  return [...lines.slice(0, -1), lp, lines[lines.length - 1]].join("\n");
}

function tokenDayBody(s: TokenStatusJson, receipts: readonly ReceiptJson[], day: string): string {
  if (!receipts.length) { const first = launchDayText(s); if (first) return first; }
  const todays = receipts.filter((r) => onDay(r, day));
  const confirmed = todays.filter((r) => r.status === "confirmed" && Number(r.burned ?? 0) > 0);
  if (confirmed.length) {
    const r = confirmed[confirmed.length - 1];
    const n = receipts.findIndex((x) => x.eventId === r.eventId && x.settledAt === r.settledAt) + 1;
    return `Receipt #${n} · ${day}\n${s.seriesTitle ?? s.selectorKey}: ${r.value ?? r.result ?? r.eventId}${r.prevValue !== null ? ` (previous ${r.prevValue})` : ""}\n${plural(r.units, "unit")} → ${fmtInt(r.burned)} $${s.ticker} bought back and burned${r.spent ? ` (${fmtSol(r.spent)})` : ""}\nSupply now ${fmtInt(s.supply.current)}\n${r.txUrl ? `Receipt: ${r.txUrl}\n` : ""}${withTag(DISCLAIMER, s.profile?.badge)}`;
  }
  const last = [...receipts].reverse().find((r) => r.status === "confirmed" && Number(r.burned ?? 0) > 0) ?? null;
  const why = todays.length ? `The ${plural(todays.length, "reading")} for today counted ${todays.reduce((a, r) => a + r.units, 0)} unit(s): ${todays.map((r) => r.status === "skipped" ? `nothing bought (${r.skippedReason ?? "under the floor"})` : r.status).join(", ")}.` : s.next.nextCheckAt ? `No settled reading for today yet; the next check is ${s.next.nextCheckAt.slice(0, 16).replace("T", " ")}Z.` : `No settled reading for today.`;
  return `No burn today, ${day}\n${why}\n${last ? `Last receipt: ${last.eventId} · ${plural(last.units, "unit")} → ${fmtInt(last.burned)} $${s.ticker} burned` : "No receipt yet."}\nSupply ${fmtInt(s.supply.current)}\n${withTag(DISCLAIMER, s.profile?.badge)}`;
}

// ---- the rivalry pair (the pair page's share line and the @burnticker post) ----
/**
 * THE PAIR'S OWN MECHANICS (third prelaunch audit 2026-10-16 F10). Before, every pair's post said "every loss burns" and "one market,
 * inverted rules", which only the original one-market pair does; a head-to-head series pair said it too. Each kind now has its own
 * score label and its own sentence, with the result that burns neither coin. The original pair keeps its words.
 */
const PAIR_KIND_COPY: Record<PairKind, { score: string; mechanics: string; live: string }> = {
  inversion: { score: " — every loss burns", mechanics: "one market, inverted rules", live: ", every settlement burns one side" },
  meetings: { score: ", head-to-head wins", mechanics: "Each game between the two teams burns the coin of the team that won it. A draw, a postponed or a cancelled game burns neither.", live: "" },
  game: { score: ", one game", mechanics: "One game: the winning team's coin burns. After a draw neither coin burns.", live: "" },
  candidates: { score: ", one race", mechanics: "One race: the winning candidate's coin burns. If neither candidate wins, neither coin burns.", live: "" },
  derby: { score: ", windows won", mechanics: "Each window burns the pair coin whose reference coin did better in it. A tie or a withheld window burns neither.", live: "" },
  flippening: { score: ", one flippening", mechanics: "One flippening: on the first day one reference coin passes the other, the pair coin on that side burns, once. If neither passes the other before the season ends, neither coin burns.", live: "" },
};
const kindOf = (t: { kind?: PairKind }): PairKind => t.kind ?? "inversion";
/** Before any settlement: what has to be true for a result to burn (never "the first one burns one side"). */
export const PAIR_NO_SETTLEMENT_LINE = "No settlement yet since launch. A result burns a coin only after that coin's pool is registered, and only what its burn pool holds.";

/** The share line alone: "$A 3 : 1 $B — every loss burns" for the original pair; each other kind its own label. */
export const pairShareLine = (t: Pick<PairTally, "a" | "b" | "burnsA" | "burnsB" | "kind">): string => `$${t.a.ticker} ${t.burnsA} : ${t.burnsB} $${t.b.ticker}${PAIR_KIND_COPY[kindOf(t)].score}`;

/**
 * (f) RIVALRY PAIR — the scoreboard as a report: burns A : B, supply A : B (and % of the starting supply left), the last settlement
 * with its market ticker and result and the side it burned, the next scheduled market (no odds, in the post or on the page), the
 * pair page link. Filled from pairTally over both sides' status.json + receipts.json.
 */
/**
 * Both or neither (2026-10-10): the pair's state line — "Pair live: both pools registered", "Pair voided — both sides on the weekly
 * clock", or "Waiting on $B's pool (both or neither; voids after <date> UTC)". Null for a pair made before the clause.
 */
export function pairStateLine(t: Pick<PairTally, "a" | "b" | "clause" | "kind">): string | null {
  const c = t.clause;
  if (!c) return null;
  if (c.state === "live") return `Pair live: both pools registered${PAIR_KIND_COPY[kindOf(t)].live}`;
  if (c.state === "voided") return `Pair voided — both pools wind down over four weeks (no event burns; ${c.voidBy} ended without both pools)`;
  const who = c.waitingOn.length === 2 ? "both pools" : c.waitingOn.length === 1 ? `$${c.waitingOn[0] === "A" ? t.a.ticker : t.b.ticker}'s pool` : "both pools to register";
  return `Waiting on ${who} (both or neither: settlements wait as pending; the pair voids if ${c.voidBy} ends without both)`;
}

export function pairDailyText(t: PairTally, site?: string | null, tag?: string | null): string {
  const A = `$${t.a.ticker}`, B = `$${t.b.ticker}`;
  const ls = t.lastSettlement;
  const outcome = ls ? (ls.result ?? ls.value ?? "—").toUpperCase() : "";
  const kind = kindOf(t), copy = PAIR_KIND_COPY[kind];
  const last = !ls ? PAIR_NO_SETTLEMENT_LINE
    : ls.burnedSide ? `Last: ${ls.eventId} settled ${outcome} → ${ls.burnedSide === "A" ? A : B} burned${ls.burned ? ` ${fmtInt(ls.burned)}` : ""}`
    : `Last: ${ls.eventId} settled ${outcome} → neither side burned${ls.result === "void" ? " (void)" : ""}`;
  return [
    pairShareLine(t),
    pairStateLine(t),
    `Supply ${fmtInt(t.supplyA)} : ${fmtInt(t.supplyB)} (${fmtPct(t.supplyPctA)} : ${fmtPct(t.supplyPctB)} of the start)`,
    kind === "inversion" ? `${t.settlements} ${t.settlements === 1 ? "settlement" : "settlements"}${t.voids ? `, ${t.voids} void` : ""} · ${copy.mechanics}` : `${t.settlements} ${t.settlements === 1 ? "settlement" : "settlements"}${t.voids ? `, ${t.voids} void` : ""}. ${copy.mechanics}`,
    last,
    t.next.market ? `Next market: ${t.next.market}${t.next.closeTime ? ` (closes ${t.next.closeTime.slice(0, 16).replace("T", " ")}Z)` : ""}` : null,
    `Scoreboard: ${siteOf(site)}/p/${t.pairId}/`,
    withTag(PAIR_DISCLAIMER, tag),
  ].filter((x): x is string => x !== null).join("\n");
}

// ---- the two @BurnTicker formats (owner, 2026-10-10): receipts and scoreboards, visibly different on the timeline ----
/** The short disclaimer the @BurnTicker posts carry (fits the 280-character budget). */
export const SHORT_DISCLAIMER = "a memecoin — supply, not price.";
/** The scoreboard footer: during a season (no champion yet) and after it ends (the champion line is a stat, never a prize). */
export const SCOREBOARD_FOOTER = "Receipt counts — nothing is won. Memecoins — supply, not price.";
export const SCOREBOARD_FOOTER_FINAL = "Champion = most receipts, not a prize. Memecoins — supply, not price.";

/** The league of a team coin from its selector (`catalogue:espn.team:<league>-<ABBR>-…` or `…espn.game:<league>-…`); null for any other coin. */
export function teamLeagueOf(selectorKey: string): string | null {
  const m = /^(?:catalogue:)?espn\.(?:team|game):([a-z0-9]+)-/i.exec(selectorKey);
  return m ? m[1].toUpperCase() : null;
}

/**
 * (g) RECEIPT — one post per confirmed burn: plain, numeric, nothing about anything but what happened. The reading line is the
 * receipt's own title (the source's description of the event, e.g. the final score) and the settled result or value; the method names
 * the source and its cross-read. Only a confirmed burn has a receipt post — anything else throws, so a skipped day cannot pose as one.
 */
export function receiptPostText(s: Pick<TokenStatusJson, "ticker" | "seriesTitle" | "selectorKey" | "supply" | "burned">, receipts: readonly ReceiptJson[], r: ReceiptJson, site?: string | null): string {
  if (r.status !== "confirmed" || !r.burned || r.burned === "0") throw new Error(`receiptPostText: $${s.ticker} ${r.eventId} is ${r.status}, not a confirmed burn`);
  const n = receipts.findIndex((x) => x.eventId === r.eventId && x.settledAt === r.settledAt) + 1;
  const what = r.title ?? s.seriesTitle ?? s.selectorKey;
  const reading = r.result !== null ? `settled ${r.result.toUpperCase()}` : r.value !== null ? `reading ${r.value}` : null;
  return [
    `Receipt #${n || "—"} · $${s.ticker} · ${r.settledAt.slice(0, 10)}`,
    `${what}${reading ? ` · ${reading}` : ""}${r.method ? ` (${r.method})` : ""}`,
    `${plural(r.units, "unit")} → ${fmtInt(r.burned)} $${s.ticker} burned${r.spent ? ` · ${fmtSol(r.spent)} spent` : ""}`,
    `Supply ${fmtInt(s.supply.current)} (${fmtPct(s.burned.pctOfSupply)} burned · ${plural(s.burned.count, "receipt")})`,
    `${r.txUrl ? `tx ${r.txUrl} · ` : ""}page ${siteOf(site)}/t/${s.ticker}/`,
    SHORT_DISCLAIMER,
  ].join("\n");
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-10-09" → "Oct 9". */
export const fmtDay = (day: string): string => `${MONTHS[Number(day.slice(5, 7)) - 1]} ${Number(day.slice(8, 10))}`;
/** A date range the way the scoreboards print it: "Oct 3 – 9", "Sep 28 – Oct 4". */
export function fmtRange(from: string, to: string): string {
  return from.slice(0, 7) === to.slice(0, 7) ? `${fmtDay(from)} – ${Number(to.slice(8, 10))}` : `${fmtDay(from)} – ${fmtDay(to)}`;
}

/**
 * The default season label for a league on a day (the caller may pass its own): leagues whose season spans the new year read
 * "2026–27" (NHL, NBA: from July), the NFL reads its starting year (through February), MLB reads "2026", or "2026 postseason" in
 * October and November. Any other league reads the calendar year.
 */
export function seasonLabel(league: string, day: string): string {
  const y = Number(day.slice(0, 4)), m = Number(day.slice(5, 7));
  switch (league.toUpperCase()) {
    case "NHL": case "NBA": return m >= 7 ? `${y}–${String((y + 1) % 100).padStart(2, "0")}` : `${y - 1}–${String(y % 100).padStart(2, "0")}`;
    case "NFL": return String(m >= 3 ? y : y - 1);
    case "MLB": return m >= 10 ? `${y} postseason` : String(y);
    default: return String(y);
  }
}

export interface ScoreboardInput {
  index: PlatformIndexJson; receiptsByTicker: Record<string, readonly ReceiptJson[]>;
  /** The league this scoreboard covers (NHL, MLB, …, as `teamLeagueOf` reads it). Required: there is no cross-league scoreboard. */
  league: string;
  /** The season label; default `seasonLabel(league, day)`. */
  season?: string | null;
  /** The day the "burned yesterday" count reads (UTC date of the settlements) — the post goes out the day after. */
  day: string;
  /** True once the league's season is over: the leader becomes "champion". During the season it is "most receipts so far". */
  seasonOver?: boolean;
  /** How many ranked lines (default 3). */
  top?: number;
  /** Appended to the footer when given (a link costs 24 of the 280 characters; the profile carries the site anyway). */
  site?: string | null;
}

const burnedOn = (receipts: readonly ReceiptJson[] | undefined, day: string) => (receipts ?? []).some((r) => onDay(r, day) && r.status === "confirmed" && Number(r.burned ?? 0) > 0);
const teamCoins = (ix: PlatformIndexJson) => ix.tokens.filter((t) => t.status === "live" && teamLeagueOf(t.selectorKey) !== null);
/** The leagues that have live team coins, in a fixed rotation that never starts with the NFL. */
export function scoreboardLeagues(ix: PlatformIndexJson): string[] {
  const order = ["NHL", "MLB", "NBA", "NFL"];
  const have = [...new Set(teamCoins(ix).map((t) => teamLeagueOf(t.selectorKey)!))];
  return have.sort((a, b) => (order.indexOf(a) < 0 ? 99 : order.indexOf(a)) - (order.indexOf(b) < 0 ? 99 : order.indexOf(b)) || a.localeCompare(b));
}

/**
 * (h) SCOREBOARD — one league, one season: the header, that league's live team coins ranked by receipts (ties by the share of supply
 * burned, then ticker), the leader marked "most receipts so far" — or "champion" once `seasonOver`. Every number is a receipt count or
 * a burned share — never a price, never a pot, never a ranking across leagues.
 */
export function scoreboardText(i: ScoreboardInput): string {
  const league = i.league.toUpperCase();
  const coins = teamCoins(i.index).filter((t) => teamLeagueOf(t.selectorKey) === league);
  const burned = coins.filter((t) => burnedOn(byCoin(i.receiptsByTicker, t), i.day)).length;
  const ranked = [...coins].sort((a, b) => b.burns - a.burns || b.pctOfSupply - a.pctOfSupply || a.ticker.localeCompare(b.ticker));
  const lead = ranked[0]?.burns ?? 0;
  const leaders = lead > 0 ? ranked.filter((t) => t.burns === lead) : [];
  const mark = i.seasonOver ? (leaders.length > 1 ? "champion (tied)" : "champion") : (leaders.length > 1 ? "most receipts so far (tied)" : "most receipts so far");
  const head = `${league} ${i.season ?? seasonLabel(league, i.day)} · ${fmtDay(i.day)} · ${plural(coins.length, "team coin")} · ${burned} burned yesterday`;
  const lines = ranked.slice(0, Math.max(1, i.top ?? 3)).map((t, k) => `${k + 1}. $${t.ticker} ${plural(t.burns, "receipt")}, ${fmtPct(t.pctOfSupply)} burned${leaders.includes(t) ? ` · ${mark}` : ""}`);
  const footer = i.seasonOver ? SCOREBOARD_FOOTER_FINAL : SCOREBOARD_FOOTER;
  return [
    head,
    coins.length ? (lead === 0 ? "No receipts this season so far." : lines.join("\n")) : `No ${league} team coin is live.`,
    i.site && i.site.trim() ? `${footer} ${siteOf(i.site)}/` : footer,
  ].join("\n");
}

/** The one cross-league line allowed: a count, never a table — "Yesterday (Oct 9) across all leagues: 9 team coins burned." */
export function allLeaguesLine(ix: PlatformIndexJson, receiptsByTicker: Record<string, readonly ReceiptJson[]>, day: string): string {
  const n = teamCoins(ix).filter((t) => burnedOn(byCoin(receiptsByTicker, t), day)).length;
  return `Yesterday (${fmtDay(day)}) across all leagues: ${plural(n, "team coin")} burned.`;
}
