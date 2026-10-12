/**
 * CSV EXPORT OF A COIN'S READINGS AND BURNS (polish-1, 2026-10-12; PLATFORM-NEXT-2-BRIEF.md item 7). The rows are the ones the coin
 * page's Burn log shows: a registered coin's receipts (recomputed at request time, so `verified` is the receipt's own check) and the
 * readings they count, or, for $DEFICIT before it is registered here, its keeper's published burns.json and status.json.
 *
 *   burns.csv     date, value, units, signature, spent, got, burned, memo, verified, status
 *   readings.csv  date, event, result, value, units, signature, source
 *
 * UTF-8, a header row, RFC 4180 quoting, CRLF line ends, streamed one row at a time. Units: `spent` is SOL, `got` and `burned` are
 * whole tokens, `value` is the source's own figure. An empty cell means the value does not exist yet (a planned burn has no signature)
 * or this site did not check it (`verified` on keeper rows). A text cell that a spreadsheet would run as a formula gets a leading
 * apostrophe; numbers never do. Pure apart from the stream.
 */

export const BURNS_HEADER = ["date", "value", "units", "signature", "spent", "got", "burned", "memo", "verified", "status"] as const;
export const READINGS_HEADER = ["date", "event", "result", "value", "units", "signature", "source"] as const;
export type CsvValue = string | number | boolean | null | undefined;
export const CSV_TYPE = "text/csv; charset=utf-8; header=present";
export const CSV_CACHE_SEC = 60;

const NUMERIC = /^[-+]?\d+(\.\d+)?([eE][-+]?\d+)?$/;
/** One cell: quoted when it holds a comma, quote or line break; a formula-looking text cell is defused. */
export function csvCell(v: CsvValue): string {
  if (v === null || v === undefined) return "";
  let s = typeof v === "string" ? v : String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s) && !NUMERIC.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export const csvLine = (cells: readonly CsvValue[]): string => `${cells.map(csvCell).join(",")}\r\n`;

/** The subset of ReceiptJson (pageTypes.ts) a burns row reads. */
export interface ReceiptForCsv { eventId: string; settledAt: string; value: string | null; units: number; signature: string | null; spent: string | null; got: string | null; burned: string | null; memo: string | null; status: string; readingDate?: string | null; verify?: { verified: boolean } | null }
/** The subset of a registry reading (ReadingRow) a readings row reads. */
export interface ReadingForCsv { id: string; at: string; result: string | null; value: string | null; sourceUrl: string | null }

const dayOf = (iso: string | null | undefined): string => (iso ? iso.slice(0, 10) : "");

/** A registered coin's receipts, oldest first. */
export function burnRowsFromReceipts(receipts: readonly ReceiptForCsv[]): CsvValue[][] {
  return [...receipts].sort((a, b) => a.settledAt.localeCompare(b.settledAt)).map((r) => [
    r.readingDate ?? dayOf(r.settledAt), r.value, r.units, r.signature, r.spent, r.got, r.burned, r.memo, r.verify ? r.verify.verified : null, r.status,
  ]);
}

/** A registered coin's readings, oldest first: the units its receipts counted from each, and the signature when this site holds it. */
export function readingRowsFromRegistry(readings: readonly ReadingForCsv[], receipts: readonly ReceiptForCsv[], lastReading: { date: string; signature: string } | null): CsvValue[][] {
  const units = new Map<string, number>();
  for (const r of receipts) units.set(r.eventId, (units.get(r.eventId) ?? 0) + (r.units || 0));
  return [...readings].sort((a, b) => a.at.localeCompare(b.at)).map((r) => {
    const date = dayOf(r.at);
    return [date, r.id, r.result, r.value, units.has(r.id) ? units.get(r.id)! : null, lastReading && lastReading.date === date ? lastReading.signature : null, r.sourceUrl];
  });
}

interface KeeperBurn { recordDate?: string; now?: string | null; units?: number; signature?: string | null; spent?: string | null; got?: string | null; burned?: string | null; memo?: string | null; status?: string }
interface KeeperReading { recordDate?: string; value?: string | null; units?: number | null; signature?: string | null }

/** $DEFICIT's keeper burns.json (statusPage.ts BurnJson), oldest first. `verified` stays empty: this site does not recompute them. */
export function burnRowsFromKeeper(burnsFile: unknown): CsvValue[][] {
  const rows = (Array.isArray(burnsFile) ? burnsFile : (burnsFile as { burns?: unknown[] } | null)?.burns ?? []) as KeeperBurn[];
  return rows.filter((b) => b && typeof b.recordDate === "string").sort((a, b) => a.recordDate!.localeCompare(b.recordDate!))
    .map((b) => [b.recordDate, b.now ?? null, b.units ?? null, b.signature ?? null, b.spent ?? null, b.got ?? null, b.burned ?? null, b.memo ?? null, null, b.status ?? null]);
}

/** $DEFICIT's keeper status.json signed readings (program.attestation.readings), oldest first. */
export function readingRowsFromKeeper(statusFile: unknown, sourceUrl: string | null): CsvValue[][] {
  const s = statusFile as { schema?: string; program?: { attestation?: { readings?: KeeperReading[]; lastReading?: KeeperReading | null } } | null } | null;
  if (!s || s.schema !== "burnkeeper.status/v1") return [];
  const att = s.program?.attestation;
  const list = att?.readings?.length ? att.readings : att?.lastReading ? [att.lastReading] : [];
  return list.filter((r) => typeof r.recordDate === "string").sort((a, b) => a.recordDate!.localeCompare(b.recordDate!))
    .map((r) => [r.recordDate, r.recordDate, null, r.value ?? null, r.units ?? null, r.signature ?? null, sourceUrl]);
}

/** A stream of the header and the rows, one line per chunk. */
export function csvStream(header: readonly string[], rows: readonly (readonly CsvValue[])[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let i = -1;
  return new ReadableStream<Uint8Array>({
    pull(c) {
      if (i < 0) { c.enqueue(enc.encode(csvLine(header))); i = 0; return; }
      if (i >= rows.length) { c.close(); return; }
      c.enqueue(enc.encode(csvLine(rows[i++])));
    },
  });
}

export function csvResponse(ticker: string, kind: "burns" | "readings", rows: readonly (readonly CsvValue[])[]): Response {
  const header = kind === "burns" ? BURNS_HEADER : READINGS_HEADER;
  return new Response(csvStream(header, rows), { status: 200, headers: {
    "content-type": CSV_TYPE, "content-disposition": `attachment; filename="${ticker.replace(/[^A-Za-z0-9]/g, "")}-${kind}.csv"`,
    "cache-control": `public, max-age=${CSV_CACHE_SEC}`, "x-content-type-options": "nosniff", "access-control-allow-origin": "*",
  } });
}
