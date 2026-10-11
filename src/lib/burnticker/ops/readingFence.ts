import { formatDate } from "@/lib/burnReceipts/math";
import { receiptDay, type KeeperDeps } from "@/lib/burnticker/multiKeeper";
import type { ProgramReadingView } from "@/lib/burnKeeper/programPort";
import type { ReceiptRow, TokenRow } from "@/lib/burnticker/registry";

/**
 * THE FOREIGN-READING FENCE (trust-ops item 5, 2026-10-10 night). Why it exists — the gap a second keeper opens:
 *
 * The program counts units, not events: a reading for day D carries the token's running unit counter, and a crank spends for the
 * DELTA since the previous reading. multiKeeper.submitCounterReadings picks the next day as max(the oldest unassigned receipt's
 * day, the day after the config's lastRecordDate) and adds the units of every unassigned receipt up to it. If ANOTHER keeper (a
 * standby that took over, or a leader that came back from a partition) already landed the reading for day D, this keeper's
 * receipts for D are still "unassigned" in ITS registry — so it would count them AGAIN into day D+1, and the program, seeing the
 * counter rise, would burn for them twice. The program cannot catch that: D+1 is a new date with a plausible delta.
 *
 * The fence runs before every cycle, for every token with unassigned pending receipts. When the on-chain config has a reading
 * dated on or after the oldest such receipt's day that this registry did not write (no write-ahead row of its own is in flight),
 * it walks the on-chain readings back to the last one this registry knows and tries to ADOPT each foreign reading: the unassigned
 * receipts through that reading's date must carry exactly the units the program counted. A match is assigned to the reading (the
 * receipts are then cranked or adopted by the normal path); any mismatch HOLDS the keeper's sends for the cycle and raises
 * `bt-foreign-reading` — a human reconciles, because two registries disagree about what happened.
 *
 * Limits (said plainly in the runbook): adoption matches on unit totals per reading, not on the event ids (the ids are in the
 * reading's source URL, which the program stores only as a hash); a reading whose units match by coincidence is adopted.
 */

export interface FenceHold { mint: string; ticker: string; why: string }
export interface FenceAdoption { mint: string; ticker: string; recordDate: number; eventIds: string[]; units: number }
export interface FenceReport { held: FenceHold[]; adopted: FenceAdoption[]; checked: number }

const MAX_WALK = 120;

export async function readingFence(d: Pick<KeeperDeps, "registry" | "program" | "log" | "dryRun">): Promise<FenceReport> {
  const reg = d.registry;
  const out: FenceReport = { held: [], adopted: [], checked: 0 };
  const tokens: TokenRow[] = [...reg.tokens("live"), ...reg.tokens("retired").filter((t) => reg.ruleEnd(t.mint) !== null)];
  for (const t of tokens) {
    const unassigned = reg.pending(t.mint).filter((b) => b.readingDate === null);
    if (!unassigned.length) continue;
    out.checked++;
    let cfg;
    try { cfg = await d.program.port(t.mint).config(); } catch { continue; }
    if (!cfg?.hasBaseline) continue;
    const d0 = receiptDay(unassigned[0].settledAt);
    if (cfg.lastRecordDate < d0) continue;
    // A reading of our own may still be landing: the write-ahead path (resolveSent) owns that case.
    const inflight = reg.db.prepare("SELECT 1 FROM signatures WHERE mint=? AND event_id LIKE 'reading:%' AND status='sent' LIMIT 1").get(t.mint);
    if (inflight) continue;
    const ownLast = ownLastReading(reg.db, t.mint, reg.receipts(t.mint));
    // Walk the on-chain readings back from the newest to the last one this registry knows.
    const port = d.program.port(t.mint);
    const foreign: ProgramReadingView[] = [];
    let D = cfg.lastRecordDate, broken: string | null = null;
    for (let i = 0; D > ownLast && D !== 0 && i < MAX_WALK; i++) {
      const r = await port.reading(D).catch(() => null);
      if (!r) { broken = `the on-chain reading ${formatDate(D)} could not be read`; break; }
      foreign.unshift(r);
      D = r.prevDate;
    }
    if (!broken && D > ownLast && D !== 0) broken = `more than ${MAX_WALK} on-chain readings this registry did not write`;
    if (broken) { hold(out, d, t, broken); continue; }
    let pool: ReceiptRow[] = [...unassigned];
    const plan: FenceAdoption[] = [];
    let mismatch: string | null = null;
    for (const r of foreign) {
      if (r.prevDate === 0) continue;   // a baseline counts no units
      const group = pool.filter((b) => receiptDay(b.settledAt) <= r.recordDate);
      const units = group.reduce((a, b) => a + b.units, 0);
      if (units !== r.units) { mismatch = `the on-chain reading ${formatDate(r.recordDate)} (not written by this keeper) counted ${r.units} unit(s); this registry's unassigned receipts through that day carry ${units}`; break; }
      if (group.length) plan.push({ mint: t.mint, ticker: t.ticker, recordDate: r.recordDate, eventIds: group.map((b) => b.eventId), units });
      pool = pool.filter((b) => !group.includes(b));
    }
    if (mismatch) { hold(out, d, t, `${mismatch} — reconcile the two registries before this keeper attests again`); continue; }
    for (const a of plan) {
      if (!d.dryRun) reg.assignReading(t.mint, a.eventIds, a.recordDate);
      out.adopted.push(a);
      d.log(`  [fence] $${t.ticker} ${formatDate(a.recordDate)}: a reading another keeper landed counted ${a.units} unit(s) — ${d.dryRun ? "would adopt" : "adopted"} ${a.eventIds.length} receipt(s) into it (${a.eventIds.join(", ")})`);
    }
  }
  return out;
}

function hold(out: FenceReport, d: Pick<KeeperDeps, "log">, t: TokenRow, why: string): void {
  out.held.push({ mint: t.mint, ticker: t.ticker, why });
  d.log(`  [fence] $${t.ticker}: HOLD — ${why}`);
}

/** The newest program reading date this registry wrote or assigned for a mint (0 when none). */
function ownLastReading(db: Pick<KeeperDeps["registry"], "db">["db"], mint: string, receipts: readonly ReceiptRow[]): number {
  let best = 0;
  for (const b of receipts) if (b.readingDate !== null && b.readingDate > best) best = b.readingDate;
  const rows = db.prepare("SELECT event_id FROM signatures WHERE mint=? AND event_id LIKE 'reading:%' AND status='confirmed'").all(mint) as { event_id: string }[];
  for (const r of rows) { const n = Number(r.event_id.slice("reading:".length).replace(/-/g, "")); if (Number.isFinite(n) && n > best) best = n; }
  return best;
}
