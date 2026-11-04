import type { Registry } from "@/lib/burnticker/registry";

/**
 * A POOL THAT HAS NEVER TRADED (devnet e2e 2026-10-20). Raydium CPMM writes a price observation only on a swap, so a pool fresh from
 * migration has an empty observation ring, and the program's TWAP guard (cpmm.rs twap_sol_price_x32) refuses every crank with
 * TwapUnavailable until the pool's first trade. Waiting longer never fixes it. When the keeper sees that refusal on an empty ring it:
 *
 *   · says so in its ops line (programChain.ts twapWait: TWAP_EMPTY_REASON instead of "needs 600–1,200 s of observations");
 *   · records the fact in the registry's status table (`twap.empty.<mint>`), which the coin page reads (program.pool.firstTradeWait →
 *     coinStatus.ts "The result is in. The burn runs after the first trade ...");
 *   · raises bt-twap-empty at most once per coin per 6 hours (its own status key, so a clear and a return inside 6 h stay quiet).
 *
 * The fact is cleared the next time the coin's crank simulates clean or is deferred for any other reason.
 */

export const TWAP_EMPTY_ALERT_KIND = "bt-twap-empty";
export const TWAP_EMPTY_ALERT_EVERY_MS = 6 * 3_600_000;
export const twapEmptyKey = (mint: string): string => `twap.empty.${mint}`;
const alertedKey = (mint: string): string => `twap.empty.alerted.${mint}`;

export interface TwapEmptyState { since: number; lastSeenAt: number; recordDate: string }

type Reg = Pick<Registry, "getStatus" | "setStatus" | "recordAlert">;

/** The recorded state, or null when the coin's pool is not known to be waiting for its first trade. */
export function readTwapEmpty(reg: Pick<Registry, "getStatus">, mint: string): TwapEmptyState | null {
  let raw: string | null;
  try { raw = reg.getStatus(twapEmptyKey(mint)); } catch { return null; }
  if (!raw) return null;
  try {
    const j = JSON.parse(raw) as Partial<TwapEmptyState> | null;
    return j && typeof j.since === "number" && typeof j.lastSeenAt === "number" ? { since: j.since, lastSeenAt: j.lastSeenAt, recordDate: String(j.recordDate ?? "") } : null;
  } catch { return null; }
}

/** The alert text (operator channel, not site copy). */
export const twapEmptyAlertText = (ticker: string, recordDate: string): string =>
  `$${ticker}: the burn for ${recordDate} is waiting because the coin's trading pool has had no swap since it was made, so it has no price history yet. The burn runs after the first trade in the pool; waiting longer does not change this. Nothing is lost.`;

/**
 * Records that `mint`'s crank for `recordDate` was deferred on an empty ring, and raises bt-twap-empty when none was raised for the coin
 * in the last 6 hours. Returns the alert row when one was raised, else null. Never throws: the record never changes the wait.
 */
export function noteTwapEmpty(reg: Reg, t: { mint: string; ticker: string }, recordDate: string, now: number, log?: (line: string) => void): { kind: string; key: string } | null {
  try {
    const prev = readTwapEmpty(reg, t.mint);
    const state: TwapEmptyState = { since: prev?.since ?? now, lastSeenAt: now, recordDate };
    reg.setStatus(twapEmptyKey(t.mint), state, now);
    const last = Number(reg.getStatus(alertedKey(t.mint)) || NaN);
    if (Number.isFinite(last) && now - last < TWAP_EMPTY_ALERT_EVERY_MS) return null;
    const text = twapEmptyAlertText(t.ticker, recordDate);
    const row = reg.recordAlert({ kind: TWAP_EMPTY_ALERT_KIND, key: `${TWAP_EMPTY_ALERT_KIND}:${t.mint}:${Math.floor(now / TWAP_EMPTY_ALERT_EVERY_MS)}`, text, meta: { mint: t.mint, recordDate } }, now);
    if (!row) return null;
    reg.setStatus(alertedKey(t.mint), String(now), now);
    log?.(`  [alert] ${TWAP_EMPTY_ALERT_KIND}: ${text}`);
    return { kind: row.kind, key: row.key };
  } catch { return null; }
}

/** Clears the recorded state (the crank simulated clean, or waits for another reason). Writes only when something was recorded. */
export function clearTwapEmpty(reg: Pick<Registry, "getStatus" | "setStatus">, mint: string, now: number): void {
  try { if (readTwapEmpty(reg, mint)) reg.setStatus(twapEmptyKey(mint), "", now); } catch { /* never changes the crank */ }
}
