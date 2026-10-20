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
