import type { HttpSourceConfig } from "@/lib/burnticker/sources/attestedHttp";

/**
 * USGS EARTHQUAKE COUNTS (sources-2, 2026-10-12). The U.S. Geological Survey's event catalogue (earthquake.usgs.gov FDSN event service,
 * GeoJSON, keyless; "USGS-authored or produced data and information are considered to be in the U.S. Public Domain"). Read by the
 * generic attested-http engine from the sources.json entry `usgs.quakes`; this module holds the parameter (magnitude and region) and
 * the coin text.
 *
 *   usgs.quakes:<magnitude>[/<region>]   one reading per UTC day: the number of earthquakes (eventtype=earthquake) of at least that
 *                                         magnitude, worldwide or inside one named box, whose USGS review status is "reviewed"; a day is
 *                                         read two days after it ends so automatic solutions have been reviewed; days with none read 0.
 *   magnitude  4 to 8.5 in half steps.  region  world (no suffix), conus, california, alaska, japan (the boxes below).
 *
 * CLINICAL COPY ONLY: a reading is a count of events at or above a magnitude. Place names, felt reports, alert levels, tsunami flags and
 * anything about people are never read, stored or shown. NOT LAUNCHABLE until the owner confirms (LAUNCHPAD-PATH §7 refuses disaster
 * feeds; the catalogue's usgs.quakes6 carries the same flag), and refuse.json refuses "earthquake" in market titles.
 *
 * How it fails: an HTTP error, a body without features, or an event without a readable time raises or refuses; the keeper writes nothing.
 */

export const USGS_QUAKES_ID = "usgs.quakes";
export const USGS_MAGNITUDES = ["4", "4.5", "5", "5.5", "6", "6.5", "7", "7.5", "8", "8.5"] as const;
/** Named boxes (FDSN minlatitude/maxlatitude/minlongitude/maxlongitude). */
export const USGS_REGIONS: Readonly<Record<string, { label: string; box: [number, number, number, number] }>> = {
  conus: { label: "the contiguous United States", box: [24, 50, -125, -66] },
  california: { label: "California and its coast", box: [32, 42, -125, -114] },
  alaska: { label: "Alaska", box: [51, 72, -180, -129] },
  japan: { label: "Japan and its coast", box: [24, 46, 122, 146] },
};
export const usgsSeries = (magnitude: string | number, region: string | null = null): string => `${USGS_QUAKES_ID}:${String(magnitude)}${region ? `/${region}` : ""}`;
export function parseUsgsSeries(id: string): { magnitude: string; region: string | null } | null {
  const m = /^usgs\.quakes:(\d(?:\.5)?)(?:\/([a-z]+))?$/.exec(id);
  if (!m || !(USGS_MAGNITUDES as readonly string[]).includes(m[1])) return null;
  if (m[2] !== undefined && !USGS_REGIONS[m[2]]) return null;
  return { magnitude: m[1], region: m[2] ?? null };
}
const where = (region: string | null) => (region ? `in ${USGS_REGIONS[region].label}` : "anywhere in the world");

/** The catalogue's parameter hook: magnitude and the region's box into the URL, the unit label and the title. */
export function applyUsgsQuakes(cfg: HttpSourceConfig, param: string): HttpSourceConfig {
  const s = parseUsgsSeries(`${USGS_QUAKES_ID}:${param}`);
  if (!s) throw new Error(`usgs.quakes: ${param} is not <magnitude 4–8.5 in half steps>[/<${Object.keys(USGS_REGIONS).join("|")}>]`);
  const box = s.region ? USGS_REGIONS[s.region].box : null;
  const bbox = box ? `&minlatitude=${box[0]}&maxlatitude=${box[1]}&minlongitude=${box[2]}&maxlongitude=${box[3]}` : "";
  const sub = (u: string) => u.split("{magnitude}").join(s.magnitude).split("{bbox}").join(bbox);
  return { ...cfg, request: { ...cfg.request, url: sub(cfg.request.url) }, sourceUrl: sub(cfg.sourceUrl), title: `Earthquakes of magnitude ${s.magnitude} or more ${where(s.region)} (USGS)`, unit: { ...cfg.unit, label: `1 earthquake of magnitude ${s.magnitude} or more`, definition: `per UTC day: each reviewed earthquake of magnitude ${s.magnitude} or more ${where(s.region)} counts 1` } };
}

/** The coin text pieces: a count, nothing else (lint-clean; test/burntickerSources2.test.ts). */
export function usgsText(s: { magnitude: string; region: string | null }, spends: string, inverse: boolean): { name: string; ticker: string; oneLiner: string; block: string } {
  const src = "The count comes from the U.S. Geological Survey's earthquake catalogue. Only events the USGS has reviewed count, and each UTC day is read two days after it ends.";
  const m = s.magnitude, w = where(s.region);
  if (inverse) return { name: `Quiet Days M${m}`, ticker: `QUIETM${m.replace(".", "")}`, oneLiner: `burns on every day with no earthquake of magnitude ${m} or more ${w}`,
    block: `For every day with no earthquake of magnitude ${m} or more ${w}, ${spends}, with a receipt on chain. ${src} A day with one burns nothing.` };
  return { name: `Magnitude ${m} Count`, ticker: `QUAKEM${m.replace(".", "")}`, oneLiner: `burns for every earthquake of magnitude ${m} or more ${w}`,
    block: `For every earthquake of magnitude ${m} or more ${w}, ${spends}, with a receipt on chain. ${src} The reading is a count of events and nothing else.` };
}
