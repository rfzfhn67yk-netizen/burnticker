/**
 * FEDERAL REGISTER: EXECUTIVE ORDERS (sources-2, 2026-10-12). Keyless, public domain. The Office of the Federal Register (National
 * Archives) publishes every executive order the President signs, with its signing date, through the API at
 * https://www.federalregister.gov/api/v1. The reading is read by the generic attested-http engine from the sources.json entry
 * `fedreg.eo`; this module holds what the engine does not: the series id, the hold before a signing day is read, and the coin text.
 *
 *   series   fedreg.eo                one reading per signing day (UTC date as the Federal Register gives it): the count of documents of
 *                                     type Presidential Document, subtype Executive Order, signed that day; days with none read 0
 *   unit     one executive order      baseline 0, direction up, no carry; "burns 2% per executive order signed"
 *   finality a signing day is read 14 days after it ends. Orders are published about five days after signing (median 5, longest
 *            11 in 289 of the 290 orders signed since 2025-01-20; one took 48). An order published after its day was read is never
 *            counted, so the hold is stated in the unit definition and on the card.
 *
 * How it fails: the API answers an error or a page without rows; the engine raises, the keeper records a failed fetch and writes no
 * reading. "Unavailable" is never a zero. Client-safe (no node imports): describe.ts renders the text in the browser.
 */

export const FEDREG_EO_ID = "fedreg.eo";
/** Days after a signing day ends before it is read (sources.json period.completeAfterDays). */
export const FEDREG_EO_HOLD_DAYS = 14;
export const isFedregEo = (series: string | null | undefined): boolean => series === FEDREG_EO_ID;

/** The coin text pieces for fedreg.eo (lint-clean; test/burntickerSources2.test.ts lints every variant). */
export function fedregEoText(spends: string, inverse: boolean): { name: string; ticker: string; oneLiner: string; block: string } {
  const source = `The count comes from the Federal Register, which lists each order by the day it was signed. A day is read ${FEDREG_EO_HOLD_DAYS} days after it ends, so orders published late still count, and an order published after that is not counted.`;
  if (inverse) {
    return {
      name: "No Executive Order Days", ticker: "NOEO", oneLiner: "burns on every day the President signs no executive order",
      block: `For every day the President signs no executive order, ${spends}, with a receipt on chain. ${source} A day with an order burns nothing.`,
    };
  }
  return {
    name: "Executive Orders", ticker: "EXORDER", oneLiner: "burns for every executive order the President signs",
    block: `For every executive order the President signs, ${spends}, with a receipt on chain. Two orders signed on one day burn twice. ${source} A day with no order burns nothing.`,
  };
}
