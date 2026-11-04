import type { HttpSourceConfig } from "@/lib/burnticker/sources/attestedHttp";
import { fitName } from "@/lib/burnticker/launchFields";

/**
 * NIFC WILDFIRE ACRES (sources-3, 2026-10-12). The National Interagency Fire Center's WFIGS year-to-date incident service (NIFC's
 * authoritative ArcGIS organisation, keyless; refreshed from IRWIN every five minutes; public, with NIFC's no-warranty disclaimer). Only
 * wildfire records are read (IncidentTypeCategory WF; prescribed fires and complex roll-ups are left out, so no acre is counted twice).
 *
 *   nifc.acres               the year's total wildfire acres in the United States, summed by the service at poll time (a snapshot; the
 *                            keeper records the day's value once the day is over). A rule burns per 100,000 acres added since the previous
 *                            reading, and a remainder carries across consecutive increases (like the debt's $1B). The total restarts each
 *                            January 1 when the service rolls to the new year; that drop burns nothing and counting resumes from it.
 *   nifc.firesize:<acres>    ONE-SHOT: the whole share once, on the discovery day of the first wildfire discovered after launch that
 *                            reaches that size (10,000, 50,000, 100,000, 250,000 or 500,000 acres). A fire can grow past the bar days
 *                            after it was found; the reading appears then, dated by its discovery day, and the keeper plans it because
 *                            the day is after the coin's launch.
 *
 * CLINICAL: a reading is acres and a discovery time. Incident names, locations, causes, costs and anything about people or structures are
 * never requested. How it fails: an HTTP error, a body without the sum, or an error body from the service raises or refuses; the keeper
 * writes nothing.
 */

export const NIFC_ACRES_ID = "nifc.acres", NIFC_FIRESIZE_ID = "nifc.firesize";
export const NIFC_SIZES = [10_000, 50_000, 100_000, 250_000, 500_000] as const;
const fmt = (n: number) => n.toLocaleString("en-US");

export function parseNifcSeries(id: string): { kind: "acres" } | { kind: "size"; acres: number } | null {
  if (id === NIFC_ACRES_ID) return { kind: "acres" };
  const m = /^nifc\.firesize:(\d{5,6})$/.exec(id);
  return m && (NIFC_SIZES as readonly number[]).includes(Number(m[1])) ? { kind: "size", acres: Number(m[1]) } : null;
}

export function applyNifcFireSize(cfg: HttpSourceConfig, param: string): HttpSourceConfig {
  const s = parseNifcSeries(`${NIFC_FIRESIZE_ID}:${param}`);
  if (!s || s.kind !== "size") throw new Error(`nifc.firesize: ${param} is not one of ${NIFC_SIZES.join(", ")}`);
  const sub = (u: string) => u.split("{acres}").join(String(s.acres));
  return { ...cfg, request: { ...cfg.request, url: sub(cfg.request.url) }, title: `The next wildfire of ${fmt(s.acres)} acres or more (NIFC)`, unit: { ...cfg.unit, label: `the next wildfire of ${fmt(s.acres)} acres`, definition: `one reading: the discovery day of the first wildfire discovered after launch that reaches ${fmt(s.acres)} acres` } };
}

/** The coin text pieces (lint-clean; test/burntickerSources3.test.ts): acres, nothing else. */
export function nifcText(s: NonNullable<ReturnType<typeof parseNifcSeries>>, spends: string, inverse: boolean): { name: string; ticker: string; oneLiner: string; block: string; oneShot: boolean } {
  const src = "Only wildfire records in the United States count, not prescribed fires.";
  if (s.kind === "size") return { name: fitName(`Next ${fmt(s.acres)} Acre Fire`), ticker: `FIRE${s.acres / 1000}K`, oneLiner: `burns once on the next wildfire to reach ${fmt(s.acres)} acres`, oneShot: true,
    block: `When the first wildfire discovered after launch reaches ${fmt(s.acres)} acres, ${spends} once, with a receipt on chain. ${src} The reading is a fire's size in acres and the day it was discovered, and nothing else.` };
  if (inverse) return { name: "Flat Acre Days", ticker: "FLATACRES", oneLiner: "burns on every day the year's wildfire acres do not rise", oneShot: false,
    block: `For every day the year's total of wildfire acres in the United States does not rise, ${spends}, with a receipt on chain. ${src} Each day's total is read once the day is over in UTC. A day the total rises burns nothing.` };
  return { name: "Wildfire Acres", ticker: "ACRES", oneLiner: "burns for every 100,000 acres of wildfire in the United States", oneShot: false,
    block: `For every 100,000 acres added to the year's total of wildfire acres in the United States, ${spends}, with a receipt on chain. ${src} Each day's total is read once the day is over in UTC, and a part of 100,000 carries over while the total keeps rising day after day. The reading is acres and nothing else.` };
}
