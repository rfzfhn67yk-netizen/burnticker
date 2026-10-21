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

/** The publishers that settle alone, each named once, in the order above ("the U.S. Geological Survey, … and the National Interagency Fire Center"). */
const singlePublishers = [...new Set(Object.values(SINGLE_SOURCE_PUBLISHER))];
const listWords = (xs: readonly string[]): string => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
/** A game coin's one-source confirmation gap in minutes (sources/gameSettle.ts GAME_CONFIRM_GAP_MS; a test pins the two together). */
export const GAME_CONFIRM_GAP_MINUTES = 5;

/**
 * THE SETTLEMENT SENTENCE FOR THE TRUST PAGE (sixth pass B-16d, HB-58, 2026-10-19): the page said every result needs "a primary source
 * that a second, independent publisher confirms", while $NEXTM6 settles on the USGS alone by owner decision. It now says which sources
 * settle alone, and the owner's rule for game coins (2026-10-20: read once the game is final, settled on a second check five minutes later).
 */
export const SETTLEMENT_SOURCES_SENTENCE = `Each result comes from a primary source. Most rules also need a second, independent publisher to agree, or the on-chain payout of an adjudicated Polymarket market. A few rules use one official source alone, and their rule text says so: the natural-hazard feeds from ${listWords(singlePublishers)}. A game coin settles once the official feed has marked the game final and a second check five minutes later agrees.`;
