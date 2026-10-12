import { tokenPageData, type Platform } from "@/lib/burnticker/server";
import { readKeeperFiles, type KeeperFiles } from "@/lib/burnticker/deficitQueue";
import { burnRowsFromKeeper, burnRowsFromReceipts, csvResponse, readingRowsFromKeeper, readingRowsFromRegistry } from "@/lib/burnticker/csvExport";
import { feedError } from "@/lib/burnticker/feeds";
import { CSV_LINK_COPY, csvHref } from "@/lib/burnticker/exportLinks";

/**
 * The CSV routes' one handler (polish-1): a registered coin from the registry (its recomputed receipts and readings, the same data the
 * coin page reads), else $DEFICIT from its keeper's published files, else 404. A keeper file that exists and cannot be read is a 503,
 * never an empty file; a keeper that has not published yet gives the header row alone (nothing has happened).
 */
export const CSV_COPY = {
  unknown: (t: string) => `No coin with the ticker $${t} is on this site.`,
  unavailable: "This coin's records could not be read just now. Try again in a few minutes.",
  /** the coin page's Burn log links (exportLinks.ts) */
  ...CSV_LINK_COPY,
};
export { csvHref };
const DEBT_SOURCE = "https://fiscaldata.treasury.gov/datasets/debt-to-the-penny/";

export async function coinCsv(p: Platform, rawTicker: string, kind: "burns" | "readings", keeper: () => KeeperFiles = () => readKeeperFiles()): Promise<Response> {
  const ticker = decodeURIComponent(rawTicker).toUpperCase();
  if (!/^[A-Z0-9]{2,12}$/.test(ticker)) return feedError(404, CSV_COPY.unknown(ticker.slice(0, 12)));
  let t;
  try { t = p.registry.tokenByTicker(ticker); } catch { return feedError(503, CSV_COPY.unavailable); }
  if (t && t.status !== "draft" && t.status !== "expired") {
    let d;
    try { d = await tokenPageData(p, t); } catch { return feedError(503, CSV_COPY.unavailable); }
    const lr = d.status.program?.lastReading ?? null;
    return csvResponse(ticker, kind, kind === "burns" ? burnRowsFromReceipts(d.receipts) : readingRowsFromRegistry(d.readings, d.receipts, lr ? { date: lr.date, signature: lr.signature } : null));
  }
  if (ticker !== "DEFICIT") return feedError(404, CSV_COPY.unknown(ticker));
  const k = keeper();
  if (k.error && k.status === null && !/has not published/.test(k.error)) return feedError(503, CSV_COPY.unavailable);
  return csvResponse(ticker, kind, kind === "burns" ? burnRowsFromKeeper(k.burns) : readingRowsFromKeeper(k.status, DEBT_SOURCE));
}
