import fs from "node:fs";
import { clearStaleRestartRequest, restartRequestPath, takeRestartRequest } from "@/lib/burnticker/restartRequest";

/**
 * THE MINT BANK SERVICE'S LOOP (scripts/burnticker-mint-bank.mts; moved here 2026-10-16 so it can be tested, prelaunch audit F-8).
 *
 * The bank ignored every deploy from 10-15 02:54Z until it was restarted by hand: the process running then predated the deploy-restart
 * check, and in the code since, the request was read only at the top of the loop, which runs once a minute while the bank is full but
 * only between fill chunks while it fills (a 25-key chunk is about half an hour on the box's three workers). Now:
 *
 *   start     a request already on disk is stale (this process runs the deployed code): removed and said, not honoured
 *   idle      while the bank is full, the request is checked every IDLE_CHECK_MS through the IDLE_MS wait (with the stop signal)
 *   filling   a chunk of at most FILL_CHUNK keys stops as soon as a request is waiting (a peek: the file exists), and the loop takes it
 *             before the next chunk; a key job in flight finishes first (the grinder stops between batches)
 *
 * A taken request ends the loop with reason "restart": the script closes the bank and exits 0, and systemd starts the new code.
 */
export const IDLE_MS = 60_000;
export const IDLE_CHECK_MS = 5_000;
export const FILL_CHUNK = 25;
const UNIT = "mintbank";

export interface BankLoopDeps {
  /** Housekeeping for one pass (the script: bankHousekeeping, its log lines and its alert); answers how many keys to grind. */
  housekeeping: (filling: boolean) => { need: number; filling: boolean };
  /** Grinds up to `n` keys, stopping early when `stopWhen()` says so (checked about every second). */
  grind: (n: number, stopWhen: () => boolean) => Promise<unknown>;
  stopping: () => boolean;
  log: (s: string) => void;
  /** This process's start (ms): a request older than it whose file could not be removed is ignored (restartRequest.ts). */
  startedAt: number;
  root?: string;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Tests: stop after this long. */
  maxMs?: number;
}

export async function runBankLoop(d: BankLoopDeps): Promise<{ reason: "restart" | "stopped" | "time"; build?: string }> {
  const now = d.now ?? (() => Date.now());
  const sleep = d.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const t0 = now();
  const over = () => d.maxMs !== undefined && now() - t0 >= d.maxMs;
  const exists = () => { try { return fs.existsSync(restartRequestPath(UNIT, d.root)); } catch { return false; } };
  // F-8 review: a request file that take() would not honour (unreadable, or stale and not removable) is not "pending": the fill and the
  // idle wait carry on and the loop sleeps between passes, instead of spinning on it; it counts again once the file has gone and come back
  let unusable = false;
  const pending = () => exists() && !unusable;
  const take = () => takeRestartRequest(UNIT, { root: d.root, startedAt: d.startedAt });
  { const stale = clearStaleRestartRequest(UNIT, { root: d.root }); if (stale) d.log(`stale restart request (build ${stale.build}) removed: this process already runs the deployed code`); }
  let filling = false;
  while (!d.stopping() && !over()) {
    const rr = take();
    if (rr) { d.log(`restart requested by deploy ${rr.build}: exiting ${filling ? "between fill chunks" : "while full"}; systemd starts the new code`); return { reason: "restart", build: rr.build }; }
    if (exists()) { if (!unusable) { unusable = true; d.log("a restart request file is there but could not be taken (unreadable, or older than this process and not removable): ignored until it is replaced"); } await sleep(IDLE_CHECK_MS); }
    else unusable = false;
    const h = d.housekeeping(filling);
    filling = h.filling;
    if (h.need > 0) { await d.grind(Math.min(FILL_CHUNK, h.need), () => d.stopping() || pending()); continue; }
    // full: wait out the minute, looking for a stop or a restart request every few seconds
    for (let waited = 0; waited < IDLE_MS && !d.stopping() && !over(); waited += IDLE_CHECK_MS) {
      if (pending()) break;
      await sleep(IDLE_CHECK_MS);
    }
  }
  return { reason: d.stopping() ? "stopped" : "time" };
}
