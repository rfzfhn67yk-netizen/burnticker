import { receiptStatusWords } from "@/lib/burnticker/receiptWords";

/**
 * QUEUED READINGS ARE NOT RECEIPTS (campaign readiness 2026-10-19, item 3). A reading that counted units but has not burned yet (the
 * keeper's "planned", "sending", "swap-sent" and "swapped" rows: waiting for the pool, a spend floor or the next crank) is a queued
 * reading. Only an executed burn ("confirmed") is a receipt, so the word "receipt" and a receipt number belong to confirmed rows only.
 * The $DEFICIT site's burns table carries the same rule in its own script (site/deficit/index.html, test/burntickerMarketingPrep.test.ts).
 * Client-safe.
 */
export const QUEUED_READING = "Queued reading, no burn yet";
export const QUEUED_STATUSES: readonly string[] = ["planned", "sending", "swap-sent", "swapped"];
export const isQueuedReading = (status: string): boolean => QUEUED_STATUSES.includes(status);
/** A burn that executed on chain: the only kind of row that is a receipt. */
export const isExecutedBurn = (r: { status: string }): boolean => r.status === "confirmed";
/** The burn log's words for a row that did not burn: a queued reading says so; other states keep their plain words. */
export const burnLogWords = (status: string): string => (isQueuedReading(status) ? QUEUED_READING : receiptStatusWords(status));
/** "1 queued reading" / "3 queued readings": the count of readings waiting for a burn. */
export const queuedReadingsCount = (n: number): string => `${n} queued reading${n === 1 ? "" : "s"}`;
/**
 * HB-96 (hourly run 7): /t/DENWIN said "0 receipts are pending" under a row "waiting for both coins to graduate". A reading that waits
 * counts as waiting whether it waits for the pool (a queued reading) or for both coins of a pair to graduate ("pending-pair").
 */
export const isWaitingReading = (status: string): boolean => isQueuedReading(status) || status === "pending-pair";
/** The token page's health line, the same words on the static page and the React page (only executed burns can be unverified). */
export function healthLine(waiting: number, unverified: number): string {
  const w = waiting === 0 ? "No reading is" : waiting === 1 ? "One reading is" : `${waiting} readings are`;
  const u = unverified === 0 ? "no executed burn is" : unverified === 1 ? "one executed burn is" : `${unverified} executed burns are`;
  return `${w} waiting with no burn yet, and ${u} unverified.`;
}
