/**
 * SINGLE OFFICIAL SOURCE SETTLEMENT (owner decision, 2026-10-12 ~19:05 Denver): "allow single-publisher settlement for the natural-
 * disaster feeds (USGS earthquakes, NHC, SPC, NIFC, USGS volcano) only." Every other first-party feed still needs an independent second
 * source of the same fact before a reading settles (catalogue/corroborate.ts, coverage/preflight.ts).
 *
 * A source settles alone only when BOTH hold: its sources.json entry says `"settlement": "single-official-source"`, and its base id is in
 * SINGLE_SOURCE_IDS below. The flag without the list does nothing, so a config edit alone cannot widen the exception; a test pins the
 * flagged entries to exactly this list (test/burntickerSources3.test.ts).
 *
 * What it changes: the keeper accepts the publisher's own complete readings without a cross-read (each reading's method says so), the
 * creation preflight does not refuse with "no-cross-read", the coverage matrix counts the category as settleable on a single official
 * source, and the coin text and source card say it plainly. What it does not change: a read that fails (HTTP error, schema refusal, a
 * truncated page) still writes nothing, so a day the feed is unavailable is held, never counted and never guessed.
 *
 * Client-safe.
 */

export const SINGLE_OFFICIAL_SOURCE = "single-official-source" as const;

/** The natural-disaster sources (sources-3) and the publisher each one names. */
export const SINGLE_SOURCE_PUBLISHER: Readonly<Record<string, string>> = {
  "usgs.quakes": "the U.S. Geological Survey", "usgs.quakenext": "the U.S. Geological Survey",
  "nhc.storms": "the National Hurricane Center", "nhc.hurricanes": "the National Hurricane Center", "nhc.next": "the National Hurricane Center",
  "spc.tornadoes": "the Storm Prediction Center", "spc.tornadoday": "the Storm Prediction Center",
  "nifc.acres": "the National Interagency Fire Center", "nifc.firesize": "the National Interagency Fire Center",
  "usgs.volcanoraise": "the U.S. Geological Survey", "usgs.volcanowarning": "the U.S. Geological Survey",
};
export const SINGLE_SOURCE_IDS: readonly string[] = Object.keys(SINGLE_SOURCE_PUBLISHER);

const baseId = (id: string) => id.split(":")[0];
/** A source entry (or a parameterised feed's config) that settles on its own publisher. */
export const isSingleOfficialSource = (e: { id: string; settlement?: string | null }): boolean => e.settlement === SINGLE_OFFICIAL_SOURCE && SINGLE_SOURCE_IDS.includes(baseId(e.id));
/** By series id alone (the client surfaces, which do not hold the config): the allowlist. */
export const isSingleSourceSeries = (series: string | null | undefined): boolean => !!series && SINGLE_SOURCE_IDS.includes(baseId(series));

/** The coin and card sentence (lint-clean; test/burntickerPlainCopy.test.ts covers this module). */
export const singleSourceSentence = (series: string): string => {
  const p = SINGLE_SOURCE_PUBLISHER[baseId(series)] ?? "the publisher";
  return `This coin settles on ${p}'s own published data, a single official source. A day the feed is unavailable is held, not counted.`;
};
/** The receipt's method note for a reading accepted without a cross-read. */
export const singleSourceMethod = (series: string): string => `single official source: ${SINGLE_SOURCE_PUBLISHER[baseId(series)] ?? "the publisher"}'s own published data, no cross-read (owner decision 2026-10-12)`;
