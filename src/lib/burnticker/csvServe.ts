import { tokenPageData, type Platform } from "@/lib/burnticker/server";
import { readKeeperFiles, type KeeperFiles } from "@/lib/burnticker/deficitQueue";
import { burnRowsFromKeeper, burnRowsFromReceipts, csvResponse, readingRowsFromKeeper, readingRowsFromRegistry } from "@/lib/burnticker/csvExport";
import { feedError } from "@/lib/burnticker/feeds";
import { CSV_LINK_COPY, csvHref } from "@/lib/burnticker/exportLinks";
import { isMintKey } from "@/lib/burnticker/coinKey";
import { lookupCoin, sharedTickerText } from "@/lib/burnticker/coinLookup";
import type { TokenRow } from "@/lib/burnticker/registry";

/**
 * The CSV routes' one handler (polish-1): a registered coin from the registry (its recomputed receipts and readings, the same data the
 * coin page reads), else $DEFICIT from its keeper's published files, else 404. A keeper file that exists and cannot be read is a 503,
 * never an empty file; a keeper that has not published yet gives the header row alone (nothing has happened).
 */
export const CSV_COPY = {
  unknown: (t: string) => `No coin with the ticker $${t} is on this site.`,
  unknownMint: "No launched coin with that mint address is on this site.",
  unavailable: "This coin's records could not be read just now. Try again in a few minutes.",
  /** the coin page's Burn log links (exportLinks.ts) */
  ...CSV_LINK_COPY,
};
export { csvHref };
const DEBT_SOURCE = "https://fiscaldata.treasury.gov/datasets/debt-to-the-penny/";

export async function coinCsv(p: Platform, rawTicker: string, kind: "burns" | "readings", keeper: () => KeeperFiles = () => readKeeperFiles()): Promise<Response> {
  let raw = rawTicker; try { raw = decodeURIComponent(rawTicker); } catch { /* looked up as written */ }
  // a mint address works in place of the ticker (tickers are not unique, owner 2026-10-12; coinKey.ts)
  if (isMintKey(raw)) {
    let m;
    try { m = p.registry.token(raw); } catch { return feedError(503, CSV_COPY.unavailable); }
    if (!m || m.status === "draft" || m.status === "expired") return feedError(404, CSV_COPY.unknownMint);
    return registeredCsv(p, m, kind);
  }
  const ticker = raw.toUpperCase();
  if (!/^[A-Z0-9]{2,12}$/.test(ticker)) return feedError(404, CSV_COPY.unknown(ticker.slice(0, 12)));
  let l;
  try { l = lookupCoin(p.registry, ticker); } catch { return feedError(503, CSV_COPY.unavailable); }
  if (l.kind === "many") return feedError(300, sharedTickerText(l));
  const t = l.kind === "one" ? l.token : null;
  if (t && t.status !== "draft" && t.status !== "expired") return registeredCsv(p, t, kind);
  if (ticker !== "DEFICIT") return feedError(404, CSV_COPY.unknown(ticker));
  const k = keeper();
  if (k.error && k.status === null && !/has not published/.test(k.error)) return feedError(503, CSV_COPY.unavailable);
  return csvResponse(ticker, kind, kind === "burns" ? burnRowsFromKeeper(k.burns) : readingRowsFromKeeper(k.status, DEBT_SOURCE));
}

async function registeredCsv(p: Platform, t: TokenRow, kind: "burns" | "readings"): Promise<Response> {
  let d;
  try { d = await tokenPageData(p, t); } catch { return feedError(503, CSV_COPY.unavailable); }
  const lr = d.status.program?.lastReading ?? null;
  return csvResponse(t.ticker, kind, kind === "burns" ? burnRowsFromReceipts(d.receipts) : readingRowsFromRegistry(d.readings, d.receipts, lr ? { date: lr.date, signature: lr.signature } : null));
}
