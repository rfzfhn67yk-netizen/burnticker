#!/usr/bin/env node
/**
 * burnkeeper-post-draft — prints a DRAFT post (website + X) filled from the keeper's own published files. It never posts, never signs
 * in, never opens a network connection: stdout only. Every draft is run through the copy lint (config/launch/copy-lint.json) before
 * it is printed; a hit is printed to stderr with the phrase, its category and the rule reference, and the process exits 3.
 *
 *   node --import ./test/alias-hook.mjs scripts/burnkeeper-post-draft.mts --auto                    # today's post, picked by the day's state
 *   … --template=daily [--date=2026-10-08]        # (a) burn day: receipt #, Treasury figure, units → burned, supply, receipt + verify link
 *   … --template=noburn [--reason=weekend|holiday|no-unit|pending|late]   # (b) no-burn day with the factual reason
 *   … --template=weekly [--date=2026-10-11]       # (c) Sunday roll-up for the week containing --date (default: today)
 *   … --template=platform --platform-dir=data/burnticker-site   # (d) @burnticker daily from index.json + t/<ticker>/receipts.json
 *   … --template=incident --what=… --affects=… --action=… --status=… [--not-affected=…] [--at=ISO]   # (e) incident frame
 *   … --template=receipt --platform-dir=… --ticker=RAYS [--event=<eventId>|--date=YYYY-MM-DD]   # (g) @BurnTicker receipt: one post per
 *                                                   confirmed burn (latest, the named event, or every burn settled on --date)
 *   … --template=scoreboard --platform-dir=… [--league=NHL] [--season=2026–27] [--season-over] [--date=YYYY-MM-DD] [--top=3] [--site=…]
 *                                                   # (h) @BurnTicker scoreboard, ONE LEAGUE per post: that league's team coins ranked by
 *                                                   receipts. Without --league: one post per league, then the cross-league count line.
 *                                                   --date is the "yesterday" counted (default: the day before --now, UTC)
 *   … --template=T2                               # the evergreen set T1–T10 (docs/launch/x-threads.md §3) still works; B1 is replaced by `receipt`
 *   … lint "some text" | lint path/to/file.txt | lint -   # lint anything (stdin with -); exit 3 on a hit
 *
 * Common flags: --dir=site/deficit/sample (status.json + burns.json; default BURNKEEPER_PUBLISH_DIR or data/burnkeeper-site),
 * --site=https://deficit.example (fills the verify links), --now=2026-10-09T22:00:00Z (the clock, for previews and tests), --all
 * (one T-draft per burn day), --row='{…}' (a single BurnJson row pasted in).
 *
 * Formats and filled examples: docs/launch/daily-post.md. Reads only. Writes nothing. The owner copies the output by hand — that is
 * the point.
 */

import fs from "node:fs";
import path from "node:path";
import type { BurnJson, StatusJson } from "@/lib/burnKeeper/statusPage";
import type { PlatformIndexJson, ReceiptJson, TokenStatusJson } from "@/lib/burnticker/tokenPage";
import { formatHits, lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import { allLeaguesLine, dailyText, dayState, incidentText, noBurnText, pickTemplate, platformDailyText, receiptPostText, scoreboardLeagues, scoreboardText, snapshotLine, weeklyText, type DailyTemplate, type NoBurnReason } from "@/lib/launch/dailyPost";
import { dateIn } from "@/lib/burnKeeper/schedule";

const positional: string[] = [];
const args = new Map<string, string>();
for (const a of process.argv.slice(2)) { const m = /^--([^=]+)(?:=(.*))?$/.exec(a); if (m) args.set(m[1], m[2] ?? "true"); else positional.push(a); }
const dir = args.get("dir") ?? process.env.BURNKEEPER_PUBLISH_DIR?.trim() ?? path.join("data", "burnkeeper-site");
const platformDir = args.get("platform-dir") ?? process.env.BURNTICKER_PUBLISH_DIR?.trim() ?? path.join("data", "burnticker-site");
const site = (args.get("site") ?? "{SITE_URL}").replace(/\/$/, "");
const now = args.has("now") ? Date.parse(args.get("now")!) : Date.now();
if (Number.isNaN(now)) { console.error(`--now is not a date: ${args.get("now")}`); process.exit(2); }

const lintCfg = loadCopyLintConfig();
const fmtInt = (s: string | null | undefined): string => (s == null ? "—" : String(s).split(".")[0].replace(/\B(?=(\d{3})+(?!\d))/g, ","));
const fmtB = (usd: string): string => { const n = Number(usd); return `${n >= 0 ? "+" : "−"}$${(Math.abs(n) / 1e9).toFixed(2)}B`; };
const fmtT = (usd: string): string => `$${(Number(usd) / 1e12).toFixed(3)}T`;
const fmtSol = (s: string | null): string => (s == null ? "—" : Number(s).toFixed(4));
const SHORT_DISCLAIMER = "a memecoin — supply, not price.";

function readJson<T>(file: string): T | null {
  try { return JSON.parse(fs.readFileSync(file, "utf8")) as T; } catch { return null; }
}

// ---- the evergreen T-set (unchanged wording; see docs/launch/x-threads.md §3) ----
function pickT(b: BurnJson): string {
  if (b.status === "skipped") return "T7";
  if (Number(b.carryIn) > 0 && b.units > 0) return "T6";
  if (b.units >= 100) return "T3";
  if (b.units <= 3) return "T4";
  return "T1";
}
function fillT(t: string, b: BurnJson, s: StatusJson | null): string {
  const v: Record<string, string> = {
    DATE: b.recordDate, PREV_DATE: b.prevDate, DELTA_B: fmtB(b.delta), NOW_T: fmtT(b.now), UNITS: String(b.units),
    BURNED: fmtInt(b.burned), SPENT_SOL: fmtSol(b.spent), POOL_SOL: fmtSol(b.pool),
    TX: b.txUrl ?? "{TX — not sent yet}", SWAP_TX: b.swapUrl ?? "{SWAP_TX — not sent yet}", SOURCE: b.sourceUrl,
    TOTAL_BURNED: fmtInt(s?.burned.total ?? null), PCT: s ? s.burned.pctOfSupply.toFixed(2) : "—",
    CARRY_B: `$${(Number(b.carryIn) / 1e9).toFixed(2)}B`, SKIPPED_REASON: b.skippedReason ?? "under the floor",
    TICKER: s?.ticker ?? "DEFICIT", FEED_ID: "treasury.debt", SITE_URL: site,
  };
  const T: Record<string, string> = {
    T1: `$${v.TICKER} burned ${v.BURNED} tokens today: debt ${v.DELTA_B} on ${v.DATE} → ${v.UNITS} units → receipt ${v.TX}\n\nSource row: ${v.SOURCE}\n${SHORT_DISCLAIMER}`,
    T2: `${v.DATE}: U.S. debt ${v.NOW_T}, ${v.DELTA_B} vs ${v.PREV_DATE} → ${v.UNITS} units.\nSpent ${v.SPENT_SOL} SOL of a ${v.POOL_SOL} SOL fee pool, bought and burned ${v.BURNED} $${v.TICKER}.\nBurn: ${v.TX}\nSwap: ${v.SWAP_TX}\n${SHORT_DISCLAIMER}`,
    T3: `Big reading. Treasury posted ${v.DELTA_B} of new debt for ${v.DATE} — ${v.UNITS} units in one day.\n$${v.TICKER} bought back and burned ${v.BURNED} tokens. Receipt: ${v.TX}\n\nCheck it: fetch the ${v.PREV_DATE} and ${v.DATE} rows, subtract, divide by $1B. ${v.SOURCE}\n${SHORT_DISCLAIMER}`,
    T4: `Small step: ${v.DELTA_B} on ${v.DATE} → ${v.UNITS} unit(s). $${v.TICKER} burned ${v.BURNED} tokens. Receipt: ${v.TX}\nSame rule on a quiet day as on a loud one. ${SHORT_DISCLAIMER}`,
    T5: `No burn for ${v.DATE}: the debt did not rise (change ${v.DELTA_B}). The rule counts nothing on a down day and resets the sub-$1B remainder to zero.\nSource row: ${v.SOURCE}\nThat is the whole rule working as written.`,
    T6: `${v.DATE}: ${v.DELTA_B} of new debt plus ${v.CARRY_B} carried from the run of rises since ${b.carryRunSince ?? v.PREV_DATE} → ${v.UNITS} units. $${v.TICKER} burned ${v.BURNED} tokens.\nReceipt ${v.TX} — the carry is on the page beside the burn. ${SHORT_DISCLAIMER}`,
    T7: `${v.DATE}: ${v.UNITS} unit(s), but the day's spend would have been under $1 (${v.SKIPPED_REASON}). Nothing bought; the pool keeps it for the next burn day.\nRule as written: ${v.SOURCE}`,
    T8: `$${v.TICKER} so far: ${v.TOTAL_BURNED} tokens bought back and burned, ${v.PCT}% of supply, every one with a receipt.\nLatest: ${v.DATE}, ${v.DELTA_B} → ${v.UNITS} units → ${v.TX}\n${SHORT_DISCLAIMER}`,
    T9: `Verify today's $${v.TICKER} burn in three steps:\n1. curl the Treasury rows for ${v.PREV_DATE} and ${v.DATE}: ${v.SOURCE}\n2. units = floor((${v.NOW_T} − prev + carry) / $1B) = ${v.UNITS}\n3. open ${v.TX} and read the memo.\nIf they agree, the receipt is good. No trust required.`,
    T10: `${v.DATE} ${v.DELTA_B} → ${v.UNITS}u → ${v.BURNED} burned`,
  };
  const out = T[t];
  if (!out) throw new Error(`unknown template ${t}; use one of daily, noburn, weekly, platform, incident, receipt, scoreboard, ${Object.keys(T).join(", ")}`);
  return out;
}

// ---- printing through the lint ----
/** Prints a draft if, and only if, it passes the lint. Returns false (and sets exit code 3) on a hit. */
function emit(text: string, header: string): boolean {
  const r = lintCopy(text, lintCfg);
  if (!r.ok) {
    console.error(`refusing to print ${header}: the draft violates the copy rule\n${formatHits(r)}`);
    process.exitCode = 3;
    return false;
  }
  const warn = r.warnings.length ? `\n# NOTE: ${r.warnings.join("; ")}` : "";
  console.log(`# draft · ${header} · ${r.xLength} chars (links count as ${lintCfg.linkCountsAs} on X)${warn}\n${text}\n`);
  return true;
}

function lintCommand(): void {
  const src = positional[1];
  if (!src) { console.error(`usage: lint "<text>" | lint <file> | lint -`); process.exit(2); }
  const text = src === "-" ? fs.readFileSync(0, "utf8") : fs.existsSync(src) ? fs.readFileSync(src, "utf8") : src;
  const r = lintCopy(text, lintCfg);
  if (r.ok) { console.log(`ok · ${r.xLength} chars (links as ${lintCfg.linkCountsAs})${r.warnings.length ? ` · notes: ${r.warnings.join("; ")}` : ""}`); return; }
  console.error(`${r.hits.length} violation(s):\n${formatHits(r)}${r.warnings.length ? `\nnotes: ${r.warnings.join("; ")}` : ""}`);
  process.exit(3);
}

function loadDeficit(): { status: StatusJson | null; burns: BurnJson[] } {
  const status = readJson<StatusJson>(path.join(dir, "status.json"));
  const rowArg = args.get("row");
  if (rowArg) return { status, burns: [JSON.parse(rowArg) as BurnJson] };
  const b = readJson<BurnJson[]>(path.join(dir, "burns.json"));
  if (!b) { console.error(`no burns.json in ${dir} (pass --dir=… or --row='{…}')`); process.exit(2); }
  return { status, burns: b };
}

function needStatus(status: StatusJson | null): StatusJson {
  if (!status) { console.error(`no status.json in ${dir} — the daily formats need it (supply, ticker, feed state)`); process.exit(2); }
  return status;
}

function main(): void {
  if (positional[0] === "lint") return lintCommand();
  const forced = args.get("template") as DailyTemplate | string | undefined;
  const auto = args.has("auto") || !forced;

  if (forced === "incident") {
    const need = ["what", "affects", "action", "status"].filter((k) => !args.get(k));
    if (need.length) { console.error(`incident needs --${need.join(" --")}`); process.exit(2); }
    const at = args.has("at") ? Date.parse(args.get("at")!) : now;
    emit(incidentText({ at, what: args.get("what")!, affects: args.get("affects")!, action: args.get("action")!, status: args.get("status")!, notAffected: args.get("not-affected") }), `incident · ${new Date(at).toISOString()}`);
    return;
  }
  if (forced === "platform") {
    const ix = readJson<PlatformIndexJson>(path.join(platformDir, "index.json"));
    if (!ix) { console.error(`no index.json in ${platformDir} (pass --platform-dir=…)`); process.exit(2); }
    const receiptsByTicker: Record<string, ReceiptJson[]> = {};
    const lpClaims: { ticker: string; at: string; line: string }[] = [];
    for (const t of ix.tokens) {
      // tickers are not unique (owner 2026-10-12): the map is keyed by mint, and a coin's directory is its siteKey when it has one
      receiptsByTicker[t.mint] = readJson<ReceiptJson[]>(path.join(platformDir, "t", t.siteKey ?? t.ticker, "receipts.json")) ?? [];
      // LP locked forever (2026-10-10): the coin's last claim_lock_fees receipt line, from its status.json
      const last = readJson<{ lp?: { lastClaim?: { at: string; line: string } | null } | null }>(path.join(platformDir, "t", t.siteKey ?? t.ticker, "status.json"))?.lp?.lastClaim;
      if (last) lpClaims.push({ ticker: t.ticker, at: last.at, line: last.line });
    }
    const day = args.get("date") ?? new Date(now).toISOString().slice(0, 10);
    // footer: the latest registry snapshot on Arweave (status/status.json, written by the keeper every cycle; trust ops 2026-10-10)
    const snap = snapshotLine(readJson<{ snapshot?: { date: string; sha256: string; arweaveTxId: string } | null }>(path.join(platformDir, "status", "status.json"))?.snapshot ?? null);
    emit([platformDailyText({ index: ix, receiptsByTicker, day, site, lpClaims }), snap].filter(Boolean).join("\n"), `platform · ${day}`);
    return;
  }

  if (forced === "B1") { console.error("B1 is replaced by the @BurnTicker receipt format: --template=receipt --platform-dir=… --ticker=…"); process.exit(2); }
  if (forced === "receipt") {
    const ticker = (args.get("ticker") ?? "").toUpperCase();
    if (!ticker) { console.error("receipt needs --ticker=…"); process.exit(2); }
    const s = readJson<TokenStatusJson>(path.join(platformDir, "t", ticker, "status.json"));
    const receipts = readJson<ReceiptJson[]>(path.join(platformDir, "t", ticker, "receipts.json"));
    if (!s || !receipts) { console.error(`no t/${ticker}/status.json + receipts.json in ${platformDir} (pass --platform-dir=…)`); process.exit(2); }
    const burned = receipts.filter((r) => r.status === "confirmed" && r.burned && r.burned !== "0");
    const ev = args.get("event"), date = args.get("date");
    const chosen = ev ? burned.filter((r) => r.eventId === ev) : date ? burned.filter((r) => r.settledAt.slice(0, 10) === date) : burned.slice(-1);
    if (!chosen.length) { console.error(`no confirmed burn for $${ticker}${ev ? ` event ${ev}` : date ? ` settled ${date}` : ""} — only a confirmed burn has a receipt post`); process.exit(1); }
    for (const r of chosen) {
      if (r.verify && r.verify.verified === false) console.error(`# WARNING: $${ticker} ${r.eventId}'s recomputation did NOT match (${r.verify.checks.join("; ")}). Do not post until the page is green.`);
      emit(receiptPostText(s, receipts, r, site), `receipt · $${ticker} · ${r.settledAt.slice(0, 10)}`);
    }
    return;
  }
  if (forced === "scoreboard") {
    const ix = readJson<PlatformIndexJson>(path.join(platformDir, "index.json"));
    if (!ix) { console.error(`no index.json in ${platformDir} (pass --platform-dir=…)`); process.exit(2); }
    const receiptsByTicker: Record<string, ReceiptJson[]> = {};
    for (const t of ix.tokens) receiptsByTicker[t.mint] = readJson<ReceiptJson[]>(path.join(platformDir, "t", t.siteKey ?? t.ticker, "receipts.json")) ?? [];
    const day = args.get("date") ?? new Date(now - 86_400_000).toISOString().slice(0, 10);
    const top = args.has("top") ? Number(args.get("top")) : undefined;
    const leagues = args.has("league") ? [args.get("league")!.toUpperCase()] : scoreboardLeagues(ix);
    if (!leagues.length) { console.error(`no live team coins in ${platformDir}`); process.exit(1); }
    for (const league of leagues) emit(scoreboardText({ index: ix, receiptsByTicker, league, season: args.get("season") ?? null, day, seasonOver: args.has("season-over"), top, site: args.get("site") ?? null }), `scoreboard · ${league} · ${day}`);
    if (!args.has("league")) emit(allLeaguesLine(ix, receiptsByTicker, day), `scoreboard · all leagues (a count, never a table) · ${day}`);
    return;
  }

  const { status, burns } = loadDeficit();
  if (auto) {
    const s = needStatus(status);
    const p = pickTemplate(s, burns, now, site);
    emit(p.text, `${p.template} · ${p.state.kind === "burn" ? p.state.row!.recordDate : p.state.postDay} · ${p.state.kind}`);
    return;
  }
  if (forced === "daily") {
    const s = needStatus(status);
    const date = args.get("date");
    const row = date ? burns.find((b) => b.recordDate === date) : burns[burns.length - 1];
    if (!row) { console.error(date ? `no burn row for ${date} — a day with no row is a no-burn day (--template=noburn)` : "no burn rows yet"); process.exit(1); }
    const unverified = row.verify && row.verify.verified === false && row.status === "confirmed";
    if (unverified) console.error(`# WARNING: receipt ${row.recordDate}'s recomputation did NOT match (${row.verify.checks.join("; ")}). Do not post until the page is green.`);
    emit(dailyText(s, burns, row, site), `daily · ${row.recordDate}${row.txUrl ? "" : " · no burn tx on the row yet ({TX} unfilled)"}`);
    return;
  }
  if (forced === "noburn") {
    const s = needStatus(status);
    let state = dayState(s, burns, now);
    const reason = args.get("reason") as NoBurnReason | undefined;
    if (reason) {
      const probe = (t: number) => dayState(s, burns, t);
      // Force a reason the way the picker would phrase it on such a day: weekend → the coming Saturday, holiday → needs a holiday date; the others keep today's facts.
      if (reason === "weekend") { let t = now; for (let i = 0; i < 7 && probe(t).kind !== "weekend"; i++) t += 86_400_000; state = probe(t); }
      else if (reason === "holiday") { let t = now, found = false; for (let i = 0; i < 400; i++, t += 86_400_000) if (probe(t).kind === "holiday") { state = probe(t); found = true; break; } if (!found) { console.error("no federal holiday found within 400 days"); process.exit(1); } }
      else if (state.kind !== reason) state = { ...state, kind: reason, reason: reason === "no-unit" ? `Treasury's figure for ${state.expected ?? state.postDay} did not add a full $1,000,000,000 over the previous reading, so the rule counted nothing. A rise under $1B carries into the next consecutive rise; a flat or down day resets the remainder to zero.` : reason === "pending" ? `Treasury's figure for ${state.expected ?? state.postDay} is not posted yet (it usually appears mid-afternoon ET); the keeper reads the feed at 16:30 and 20:00 ET.` : `Treasury's figure for ${state.expected ?? state.postDay} was not posted by 20:30 ET; the keeper keeps checking hourly and reads it, with the day's units, when it appears.`, row: null };
    }
    if (state.kind === "burn") { console.error(`${state.expected} has a burn row — that is a burn day (--template=daily); pass --reason=… to preview a no-burn format`); process.exit(1); }
    emit(noBurnText(s, burns, state, site), `noburn · ${state.postDay} · ${state.kind}`);
    return;
  }
  if (forced === "weekly") {
    const s = needStatus(status);
    emit(weeklyText(s, burns, args.get("date") ?? dateIn(now, "America/Denver"), site), `weekly · ${args.get("date") ?? dateIn(now, "America/Denver")}`);
    return;
  }

  // The evergreen set.
  if (!burns.length) { console.error("no burn rows yet — nothing to draft"); process.exit(1); }
  const date = args.get("date");
  const chosen = args.has("all") ? burns : date ? burns.filter((b) => b.recordDate === date) : [burns[burns.length - 1]];
  if (!chosen.length) { console.error(`no burn row for ${date}`); process.exit(1); }
  if (forced === "T10") {
    const lines = chosen.map((b) => fillT("T10", b, status));
    emit(`This week on the debt tape:\n${lines.join("\n")}\nEvery line has a receipt: ${site}/#receipts\n${SHORT_DISCLAIMER}`, "T10");
    return;
  }
  for (const b of chosen) {
    const t = forced ?? pickT(b);
    const text = fillT(t, b, status);
    const unverified = b.verify && b.verify.verified === false && b.status === "confirmed";
    if (unverified) console.error(`# WARNING: receipt ${b.recordDate}'s recomputation did NOT match (${b.verify?.checks.join("; ")}). Do not post until the page is green.`);
    emit(text, `${t} · ${b.recordDate}${b.txUrl ? "" : " · no burn tx on the row yet ({TX} unfilled)"}`);
  }
}

main();
