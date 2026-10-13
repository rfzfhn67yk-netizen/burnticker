import { CUSTOM_ROWS, type HttpSourceConfig } from "@/lib/burnticker/sources/attestedHttp";

/**
 * USGS VOLCANO ALERT LEVELS (sources-3, 2026-10-12). The USGS Volcano Hazards Program's notice system (HANS, volcanoes.usgs.gov/hans-
 * public/api, keyless; USGS data are public domain). A Volcano Activity Notice (VAN) "announces alert-level changes"; when the level
 * changes, its header carries both lines, "Current Volcano Alert Level: X" and "Previous Volcano Alert Level: Y". The scale is NORMAL,
 * ADVISORY, WATCH, WARNING; a volcano coming off UNASSIGNED counts as starting below NORMAL.
 *
 *   usgs.volcanoraise                 each VAN that RAISES a U.S. volcano's alert level counts 1, on its UTC send day.
 *   usgs.volcanowarning:<vnum>        ONE-SHOT: the whole share once, on the first UTC day after launch on which a VAN raises the named
 *                                     volcano (Smithsonian number, one of the 67 the USGS monitors) to WARNING.
 *
 * The read asks the HANS search for the VANs of the last 30 days (one page holds 20 notices). A full page refuses the read, because a
 * 21st notice could be missing: a raise is never left out of a count. CLINICAL: only the volcano, its number and the two alert-level
 * lines are read; the activity text is never read or stored.
 *
 * How it fails: an HTTP error, a body without notices, a notice without its alert-level line, or a full page refuses; the keeper writes
 * nothing.
 */

export const VOLCANO_RAISE_ID = "usgs.volcanoraise", VOLCANO_WARNING_ID = "usgs.volcanowarning";
export const ALERT_RANK: Readonly<Record<string, number>> = { UNASSIGNED: 0, NORMAL: 1, ADVISORY: 2, WATCH: 3, WARNING: 4 };
/** HANS returns at most this many notices per page; a full page may be missing older ones. */
export const HANS_PAGE = 20;

/** The volcanoes the USGS monitors (HANS getMonitoredVolcanoes, captured 2026-10-12): Smithsonian number → name. */
export const US_VOLCANOES: Readonly<Record<string, string>> = {
  "284141": "Ahyi Seamount", "311320": "Akutan", "312090": "Aniakchak", "311160": "Atka volcanic complex", "313010": "Augustine", "323100": "Clear Lake Volcanic Field",
  "311240": "Cleveland", "323180": "Coso Volcanic Field", "322160": "Crater Lake", "312011": "Dutton", "315040": "Edgecumbe", "311350": "Fisher", "311070": "Gareloi",
  "321020": "Glacier Peak", "311120": "Great Sitkin", "312190": "Griggs", "332060": "Haleakala", "332040": "Hualalai", "313020": "Iliamna", "311370": "Isanotski",
  "311110": "Kanaga", "312170": "Katmai", "332010": "Kilauea", "311161": "Korovin", "323080": "Lassen Volcanic Center", "311050": "Little Sitkin",
  "323822": "Long Valley Caldera", "312150": "Mageik", "311310": "Makushin", "323150": "Mammoth Mountain", "312140": "Martin", "332030": "Mauna Kea", "332020": "Mauna Loa",
  "323020": "Medicine Lake volcano", "323110": "Mono Lake Volcanic Field", "323120": "Mono-Inyo Craters", "321040": "Mount Adams", "321010": "Mount Baker",
  "322010": "Mount Hood", "322020": "Mount Jefferson", "321030": "Mount Rainier", "323010": "Mount Shasta", "321050": "Mount St. Helens", "322110": "Newberry",
  "312180": "Novarupta", "244010": "Ofu-Olosega", "311290": "Okmok", "312030": "Pavlof", "313030": "Redoubt", "323200": "Salton Buttes", "311060": "Semisopochnoi",
  "311360": "Shishaldin", "312200": "Snowy Mountain", "313040": "Spurr", "244001": "Ta'u Island", "311090": "Takawangha", "311080": "Tanaga", "322070": "Three Sisters",
  "312160": "Trident", "244020": "Tutuila Island", "323160": "Ubehebe Craters", "312130": "Ugashik-Peulik", "312131": "Ukinrek Maars", "312070": "Veniaminof",
  "311340": "Westdahl", "315020": "Wrangell", "325010": "Yellowstone",
};

export function parseVolcanoSeries(id: string): { kind: "raise" } | { kind: "warning"; vnum: string; name: string } | null {
  if (id === VOLCANO_RAISE_ID) return { kind: "raise" };
  const m = /^usgs\.volcanowarning:(\d{6})$/.exec(id);
  return m && US_VOLCANOES[m[1]] ? { kind: "warning", vnum: m[1], name: US_VOLCANOES[m[1]] } : null;
}

/**
 * The VAN reader ("hans.van"): every notice → { sent, vnum, volcano, from, to, raise, warning }. `raise` is 1 when the notice carries a
 * previous level and the current one ranks above it; `warning` is 1 when that raise lands on WARNING.
 */
export function hansVanRows(body: unknown): { rows: Record<string, unknown>[]; refusal: string | null } {
  const b = body as { noticeData?: unknown } | null;
  if (!b || !Array.isArray(b.noticeData)) return { rows: [], refusal: "schema: no noticeData in the HANS search answer" };
  if (b.noticeData.length >= HANS_PAGE) return { rows: [], refusal: `unavailable: the HANS page is full (${b.noticeData.length} notices), so an older notice could be missing` };
  const rows: Record<string, unknown>[] = [];
  for (const n of b.noticeData as { sentUnixtime?: unknown; noticeHtml?: unknown }[]) {
    const h = String(n?.noticeHtml ?? "");
    const v = /Volcano: <b>([^<]+)<\/b> \(VNUM #(\d+)\)/.exec(h), cur = /Current Volcano Alert Level: ([A-Z]+)/.exec(h), prev = /Previous Volcano Alert Level: ([A-Z]+)/.exec(h);
    if (!v || !cur || !Number.isFinite(Number(n?.sentUnixtime))) return { rows: [], refusal: "schema: a notice without its volcano, alert level or send time" };
    const to = cur[1], from = prev ? prev[1] : null;
    const raise = from !== null && ALERT_RANK[to] !== undefined && ALERT_RANK[from] !== undefined && to !== "UNASSIGNED" && ALERT_RANK[to] > ALERT_RANK[from];
    rows.push({ sent: Number(n.sentUnixtime), vnum: v[2], volcano: v[1], from: from ?? "", to, raise: raise ? "1" : "0", warning: raise && to === "WARNING" ? "1" : "0" });
  }
  return { rows, refusal: null };
}
CUSTOM_ROWS["hans.van"] = hansVanRows;

export function applyVolcanoWarning(cfg: HttpSourceConfig, param: string): HttpSourceConfig {
  const s = parseVolcanoSeries(`${VOLCANO_WARNING_ID}:${param}`);
  if (!s || s.kind !== "warning") throw new Error(`usgs.volcanowarning: ${param} is not the number of a volcano the USGS monitors`);
  return { ...cfg, sourceUrl: `https://volcanoes.usgs.gov/hans-public/api/volcano/getVolcano/${s.vnum}`, select: { ...cfg.select, filters: [{ path: "vnum", regex: `^${s.vnum}$` }, { path: "warning", regex: "^1$" }] }, title: `${s.name} is raised to WARNING (USGS)`,
    unit: { ...cfg.unit, label: `${s.name} raised to WARNING`, definition: `one reading: the first UTC day after launch on which a USGS notice raises ${s.name} to the WARNING alert level` } };
}

/** The coin text pieces (lint-clean; test/burntickerSources3.test.ts): an alert level, nothing else. */
export function volcanoText(s: NonNullable<ReturnType<typeof parseVolcanoSeries>>, spends: string, inverse: boolean): { name: string; ticker: string; oneLiner: string; block: string; oneShot: boolean } {
  const src = "The USGS notices state each volcano's alert level: normal, advisory, watch or warning.";
  if (s.kind === "warning") return { name: `${s.name} Warning`.slice(0, 32), ticker: `${s.name.replace(/[^A-Za-z]/g, "").toUpperCase().slice(0, 6)}WARN`.slice(0, 10), oneLiner: `burns once if the USGS raises ${s.name} to its warning level`, oneShot: true,
    block: `On the first day after launch on which the USGS raises ${s.name} to the warning alert level, ${spends} once, with a receipt on chain. ${src} Each UTC day is read the day after it ends. The reading is an alert level and nothing else.` };
  if (inverse) return { name: "No Alert Raise Days", ticker: "NORAISE", oneLiner: "burns on every day no U.S. volcano alert level is raised", oneShot: false,
    block: `For every day on which the USGS raises no U.S. volcano's alert level, ${spends}, with a receipt on chain. ${src} Each UTC day is read the day after it ends. A day with a raise burns nothing.` };
  return { name: "Volcano Alert Raises", ticker: "ALERTUP", oneLiner: "burns every time the USGS raises a U.S. volcano's alert level", oneShot: false,
    block: `Every time the USGS raises a U.S. volcano's alert level, ${spends}, with a receipt on chain. ${src} A level that is lowered or repeated counts nothing, and each UTC day is read the day after it ends. The reading is an alert level and nothing else.` };
}
