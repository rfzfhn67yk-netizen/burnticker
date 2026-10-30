import { findStations, nwsSeries, parseNwsSeries, type NwsMetric, type Station } from "@/lib/burnticker/sources/nws";
import { WX_HIGH_MAX_F, WX_HIGH_MIN_F } from "@/lib/burnticker/wxBounds";

/**
 * THE WEATHER INTENT (intent audit 2026-10-12, items 1, 2 and 9: "Detroit high below 32" became "32 °F or hotter"; "above 30 C
 * tomorrow" became a perpetual "31 °F or hotter"; "Denver high below 32 tomorrow" showed only Denver Summit cards). ONE normalized
 * reading of a weather query drives the search card's title, the rule it builds and the coin text (describe.ts reads the rule):
 *
 *   domain "weather", station, metric (high / rain / snow; "low" is read so it can be refused), comparison (lt / le / gt / ge / eq /
 *   range, strict or inclusive), the number as typed, the unit as typed, and the date scope as typed.
 *
 * WHAT THE SOURCE CAN EXPRESS (sources/nws.ts, units.ts, inverse.ts). The climate report gives the daily high in WHOLE degrees
 * Fahrenheit and precipitation in hundredths of an inch; a day runs midnight to midnight in the station's local STANDARD time all year.
 * An nws.high / nws.rain series counts a day whose reading is AT OR ABOVE its threshold T. The fade side (`inverse: true`) counts the
 * days it is NOT, which is exactly "below T". On whole steps:
 *
 *   at least x  → T = ceil(x)            plain        above x     → T = floor(x) + 1      plain
 *   below x     → T = ceil(x)            inverse      at most x   → T = floor(x) + 1      inverse
 *
 * so "below 32" counts 31 °F or colder and never 32, "above 32" counts 33 °F or hotter and never 32. A missing reading (MM) is no
 * reading at all, never "below". NOT EXPRESSIBLE, so REFUSED in words, never dropped: exactly one value, a range, the daily low, a
 * snowfall amount, kelvin, a unit that does not fit the metric, and any date scope ("tomorrow", "on Friday"): a weather rule has no
 * one-day window, only every day with no end date. Celsius, millimetres and centimetres are CONVERTED before the boundary is taken,
 * and the conversion is shown. A date scope on an otherwise supported query also yields the recurring rule as a separate card labelled
 * a related rule (alternative), which the visitor must choose deliberately.
 *
 * Client-safe (no node imports).
 */

export type CompareOp = "lt" | "le" | "gt" | "ge" | "eq" | "range";
export type WeatherUnit = "F" | "C" | "K" | "in" | "mm" | "cm";
export interface WeatherIntent {
  domain: "weather";
  station: Station;
  metric: NwsMetric | "low";
  /** The comparison typed (null: none typed, read as "at least"). `strict` for lt / gt. */
  op: CompareOp | null;
  /** The number as typed (null: none typed). */
  value: number | null;
  /** The unit as typed (null: none typed, read as the source's own unit). */
  unit: WeatherUnit | null;
  /** The date words as typed ("tomorrow", "on Friday"), or null. */
  dateScope: string | null;
  /** The comparison phrase as typed ("below 32", "above 30 C"), for the card's note. */
  wrote: string | null;
  /** "freezing" with no number: read as below 32 °F, and said so. */
  freezing: boolean;
  /** A word where a number belongs ("above boiling", "above normal"): the plan asks for a number, never guesses one. */
  unknownWord: string | null;
}

export type WeatherPlan =
  | { ok: true; intent: WeatherIntent; series: string; inverse: boolean; metric: NwsMetric; threshold: number | null;
      /** The rule's boundary in plain words ("31 °F or colder", "0.50 in of rain or more", "the season's first snow"). */
      boundary: string; note: string | null;
      /** No number was typed: the card uses an example number and is labelled a related rule (never the exact match). */
      example: boolean }
  | { ok: false; intent: WeatherIntent; refusal: string; alternative: WeatherPlan | null };

const WORDS_STRONG = /\b(temp|temps|temperature|temperatures|degrees?|fahrenheit|celsius|centigrade|rain|rains|rainfall|rainy|precip|precipitation|snow|snows|snowfall|snowy|weather|freezing)\b|°/i;
const WORDS_WEAK = /\b(high|highs|low|lows|hot|hotter|heat|cold|colder|cool|cooler|warm|warmer|dry|wet)\b/i;
const DATE_RE = /\b(today|tonight|tomorrow|tmrw|yesterday|this (?:morning|afternoon|evening|weekend|week|month)|next (?:week|weekend|month)|(?:on |this |next )?(?:mon|tues|wednes|thurs|fri|satur|sun)day|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.? (?:[1-9]|[12]\d|3[01])(?:st|nd|rd|th)?\b|(?:in|during|this|next) (?:january|february|march|april|may|june|july|august|september|october|november|december)|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\b/i;
const NUM_UNIT = /(-?\d+(?:\.\d+)?)\s*(\+)?\s*(°\s*[fck]\b|°|degrees?\s*(?:fahrenheit|celsius|centigrade|kelvin|[fck]\b)?|fahrenheit|celsius|centigrade|kelvin|[fck]\b|inch(?:es)?\b|in\b|"|mm\b|millimet(?:er|re)s?\b|cm\b|centimet(?:er|re)s?\b)?/i;

/** The comparison phrases, most specific first. Each is tested right before the number, or (the "or more" forms) right after it. */
const BEFORE: [RegExp, CompareOp][] = [
  [/\b(?:exactly|precisely|equal to|equals|is|=)\s*$/i, "eq"],
  [/\b(?:between|from)\s*$/i, "range"],
  [/\b(?:at least|no less than|not below|not under|a minimum of|minimum of|reaches|reach|reaching|hits|hit|hitting)\s*$|>=\s*$|≥\s*$/i, "ge"],
  [/\b(?:at most|no more than|no higher than|not above|not over|a maximum of|maximum of|max of)\s*$|<=\s*$|≤\s*$/i, "le"],
  [/\b(?:above|over|more than|greater than|exceeds?|exceeding|higher than|hotter than|warmer than|tops?)\s*$|>\s*$/i, "gt"],
  [/\b(?:below|under|less than|lower than|colder than|cooler than|fewer than|stays below|stays under)\s*$|<\s*$/i, "lt"],
];
const WORD_AFTER_COMPARE = /\b(above|over|below|under|more than|less than|greater than|higher than|lower than|hotter than|colder than|warmer than|cooler than|at least|at most|exceeds?|reaches|reach|hits?)\s+(?!freezing\b)([a-z][a-z'-]*)/i;
const AFTER: [RegExp, CompareOp][] = [
  [/^\s*(?:or|and) (?:more|above|higher|hotter|warmer|greater|over)\b/i, "ge"],
  [/^\s*(?:or|and) (?:less|below|lower|colder|cooler|under|fewer)\b/i, "le"],
  [/^\s*(?:-|to|and)\s*-?\d/i, "range"],
];

function unitOf(raw: string | undefined): WeatherUnit | null {
  if (!raw) return null;
  const u = raw.toLowerCase().replace(/\s+/g, "");
  if (/^°?f$|fahrenheit$|^degreesf$|^degreef$/.test(u)) return "F";
  if (/^°?c$|celsius$|centigrade$|^degreesc$|^degreec$/.test(u)) return "C";
  if (/^°?k$|kelvin$/.test(u)) return "K";
  if (/^inch|^in$|^"$/.test(u)) return "in";
  if (/^mm$|^millimet/.test(u)) return "mm";
  if (/^cm$|^centimet/.test(u)) return "cm";
  return null;   // "°" or "degrees" alone: no unit named
}

/**
 * The query read as a weather intent, or null when it is not one: no station is named, or no weather word is used (a number with a
 * comparison counts as one when no team is named, `teamNamed`). `teamNamed` is true when the query names a team by its nickname, so a
 * weak word ("high", "hot") with "Nuggets" stays a team query; a strong word (temperature, degrees, rain, snow, freezing) never does.
 */
export function parseWeatherIntent(q0: string, o: { teamNamed?: boolean } = {}): WeatherIntent[] {
  // intent audit 3 item 1: a minus sign in any form keeps its sign ("-10", "−10", "minus 10", "negative 10"); "zero" is 0
  const q = q0.replace(/[−–](?=\s*\d)/g, "-").replace(/\b(?:minus|negative)\s+(?=\d)/gi, "-").replace(/-\s+(?=\d)/g, "-").replace(/\bzero\b/gi, "0");
  const stations = findStations(q);
  if (!stations.length) return [];
  const strong = WORDS_STRONG.test(q), weak = WORDS_WEAK.test(q);
  const date = DATE_RE.exec(q)?.[0] ?? null;
  const t = date ? q.replace(DATE_RE, " ") : q;
  const nm = NUM_UNIT.exec(t);
  const numberish = !!nm && BEFORE.some(([re]) => re.test(t.slice(0, nm.index)));
  if (!strong && !(weak && !o.teamNamed) && !(numberish && !o.teamNamed)) return [];
  const metric: WeatherIntent["metric"] = /\bsnow/i.test(q) ? "snow" : /\b(rain|rains|rainfall|rainy|precip|precipitation|wet|dry)\b/i.test(q) ? "rain" : /\b(lows?|minimum|overnight low)\b/i.test(q) ? "low" : "high";
  let op: CompareOp | null = null, value: number | null = null, unit: WeatherUnit | null = null, wrote: string | null = null, freezing = false, unknownWord: string | null = null;
  if (nm) {
    value = Number(nm[1]); unit = unitOf(nm[3]);
    if (metric !== "rain" && unit === "in" && /^in$/i.test(nm[3] ?? "")) unit = null;   // "above 90 in Detroit": a preposition, not inches
    const before = t.slice(0, nm.index), after = t.slice(nm.index + nm[0].length);
    const a = AFTER.find(([re]) => re.test(after)), b = BEFORE.find(([re]) => re.test(before));
    op = nm[2] ? "ge" : a?.[1] ?? b?.[1] ?? null;
    const lead = !nm[2] && !a && b ? (b[0].exec(before)?.[0] ?? "").trim() : "";
    const tail = a ? (/^\s*(?:or|and) \w+/i.exec(after)?.[0] ?? "") : "";
    wrote = `${lead} ${nm[0].trim()}${tail}`.replace(/\s+/g, " ").trim();
  } else if (/\bfreezing\b/i.test(q)) {
    freezing = true; value = 32; unit = "F";
    op = /\b(above|over|not below)\s+freezing\b/i.test(q) ? "gt" : /\b(at or below|at most)\s+freezing\b/i.test(q) ? "le" : "lt";
    wrote = /\b(?:\w+\s+)?freezing\b/i.exec(q)?.[0] ?? "freezing";
  } else if (metric === "rain" && /\b(no rain|without rain|dry)\b/i.test(q)) {
    op = "lt"; value = 0.01; unit = "in"; wrote = /\b(no rain|without rain|dry)\b/i.exec(q)?.[0] ?? null;
  } else if (WORD_AFTER_COMPARE.test(t)) {
    // intent audit 3 item 2: a comparison followed by a word that is not a number ("above boiling", "below normal") asks for a number
    const m = WORD_AFTER_COMPARE.exec(t)!;
    op = BEFORE.find(([re]) => re.test(`${m[1]} `))?.[1] ?? null; unknownWord = m[2]; wrote = m[0].trim();
  } else if (/\b(cold|colder|cool|cooler)\b/i.test(q)) {
    op = "lt";   // a cold query with no number: the plan asks for one, never guesses
  }
  return stations.slice(0, 2).map((station) => ({ domain: "weather", station, metric, op, value, unit, dateScope: date, wrote, freezing, unknownWord }));
}

/** The least reportable step at or above x (inclusive) or strictly above x; `per` is the steps per unit (1 for °F, 100 for inches). */
export function leastReportable(x: number, per: number, strict: boolean): number {
  const scaled = Math.round(x * per * 1e6) / 1e6;   // 90.5 → 90.5, 0.29 × 100 → 29 (not 28.999…)
  const step = strict ? Math.floor(scaled) + 1 : Math.ceil(scaled);
  return step / per;
}

const OP_WORD: Record<"lt" | "le" | "gt" | "ge", string> = { lt: "below", le: "at most", gt: "above", ge: "at least" };
const fmtNum = (x: number) => String(Math.round(x * 1000) / 1000);
const DEFAULT_HIGH = 90, DEFAULT_RAIN = 0.5;
// HB-95 (hourly run 7): the one bound set (wxBounds.ts)
export const HIGH_RANGE = { min: WX_HIGH_MIN_F, max: WX_HIGH_MAX_F } as const;
export const RAIN_RANGE = { min: 0.01, max: 10 } as const;

/** One intent → the rule it can be, or the refusal in plain words (and, for a date scope alone, the recurring rule as an alternative). */
export function planWeather(i: WeatherIntent): WeatherPlan {
  const why: string[] = [];
  let altOk = true;
  const city = i.station.city;
  if (i.metric === "low") { why.push(`The climate report rule reads ${city}'s daily high. It does not read the daily low, so a coin on the low is not offered.`); altOk = false; }
  if (i.op === "eq") { why.push("A weather coin can count the days at or above a number, or the days below it. It cannot count the days at exactly one number."); altOk = false; }
  if (i.op === "range") { why.push("A weather coin can count the days at or above a number, or the days below it. It cannot count the days inside a range."); altOk = false; }
  if (i.unit === "K") { why.push("Kelvin is not offered. Write the number in °F or °C."); altOk = false; }
  if (i.metric === "high" && i.unit && !["F", "C"].includes(i.unit)) { why.push("A temperature needs °F or °C, not a length."); altOk = false; }
  if (i.metric === "rain" && i.unit && !["in", "mm", "cm"].includes(i.unit)) { why.push("Rain is measured in inches, millimeters or centimeters, not degrees."); altOk = false; }
  if (i.metric === "snow" && (i.value !== null || i.op !== null)) { why.push("The snow coin counts one thing: the season's first day with 0.1 in of snow or more. It cannot take another amount or comparison."); }
  if (i.unknownWord) { why.push(`I need a number. “${i.unknownWord}” is not a ${i.metric === "rain" ? "rain amount" : "temperature"} the climate report can compare against. Write a number, for example: ${city} ${i.metric === "rain" ? "rain above 0.5 in" : "high above 90"}.`); altOk = false; }
  else if (i.metric === "high" && i.op && i.value === null) { why.push(`Name a temperature, for example: ${city} high below 32.`); altOk = false; }
  if (i.metric === "rain" && i.op && i.value === null && !i.unknownWord) { why.push(`Name an amount, for example: ${city} rain above 0.5 in.`); altOk = false; }
  if (i.dateScope) why.unshift(`You asked about one day (“${i.dateScope.trim()}”). A weather coin counts every day, with no end date, so a coin on one day's weather is not offered.`);
  const base = plainPlan(i);
  // a number outside what the launcher offers is said, never clamped
  if (!why.length && !base && (i.metric === "high" || i.metric === "rain")) why.push(i.metric === "high" ? `The launcher offers temperatures from ${HIGH_RANGE.min} °F to ${HIGH_RANGE.max} °F, and this one is outside that range.` : `The launcher offers rain amounts from ${RAIN_RANGE.min.toFixed(2)} in up to ${RAIN_RANGE.max} in, and this one is outside that range.`);
  if (why.length) {
    const alt = altOk && base ? { ...base, intent: { ...i, dateScope: null } } : null;
    return { ok: false, intent: i, refusal: why.join(" "), alternative: alt };
  }
  return base ?? { ok: false, intent: i, refusal: "This weather rule is not offered.", alternative: null };
}

/** The supported part alone (the date scope ignored by the caller's choice): null when the number is out of range. */
function plainPlan(i: WeatherIntent): Extract<WeatherPlan, { ok: true }> | null {
  const st = i.station;
  if (i.metric === "snow") return { ok: true, intent: i, series: nwsSeries("snow", st.code), inverse: false, metric: "snow", threshold: null, boundary: "the season's first snow", note: null, example: false };
  if (i.unknownWord) return null;
  if (i.metric === "low") return null;
  const op0 = i.op ?? "ge";
  if (op0 === "eq" || op0 === "range") return null;
  const op = op0;
  const below = op === "lt" || op === "le", strictish = op === "gt" || op === "le";   // gt and le both land on floor(x) + 1
  if (i.metric === "high") {
    const typed = i.value ?? DEFAULT_HIGH;
    const f = i.unit === "C" ? typed * 9 / 5 + 32 : typed;
    const T = leastReportable(f, 1, strictish);
    if (T < HIGH_RANGE.min || T > HIGH_RANGE.max) return null;
    const boundary = below ? `${T - 1} °F or colder` : `${T} °F or hotter`;
    const conv = i.unit === "C" ? `${fmtNum(typed)} °C is ${fmtNum(f)} °F. ` : "";
    const lattice = !conv && Number.isInteger(f) && op === "ge" ? "" : `The climate report records whole degrees Fahrenheit, so ${OP_WORD[op]} ${fmtNum(f)} °F means ${boundary}.`;
    const dflt = i.value === null ? `You did not name a temperature, so this card uses ${DEFAULT_HIGH} °F as an example. It is not the exact rule you asked for, and you can change the number on the next screen.` : "";
    const fr = i.freezing ? `Freezing is 32 °F, so “${i.wrote}” means ${boundary}.` : "";
    const head = i.wrote && !i.freezing && (conv || lattice) ? `You wrote “${i.wrote}”. ` : "";
    const noOp = i.op === null && i.value !== null ? `You did not say above or below, so this card counts the days at ${boundary}.` : "";
    const note = [fr || `${head}${conv}${lattice}`.trim(), dflt, noOp].filter(Boolean).join(" ") || null;
    return { ok: true, intent: i, series: nwsSeries("high", st.code, T), inverse: below, metric: "high", threshold: T, boundary, note, example: i.value === null };
  }
  const typed = i.value ?? DEFAULT_RAIN;
  const inches = i.unit === "mm" ? typed / 25.4 : i.unit === "cm" ? typed / 2.54 : typed;
  const T = leastReportable(inches, 100, strictish);
  if (T < RAIN_RANGE.min || T >= RAIN_RANGE.max) return null;
  const boundary = below ? `less than ${T.toFixed(2)} in of rain` : `${T.toFixed(2)} in of rain or more`;
  const conv = i.unit === "mm" || i.unit === "cm" ? `${fmtNum(typed)} ${i.unit} is ${fmtNum(inches)} in. ` : "";
  const exact = Math.abs(inches * 100 - Math.round(inches * 100)) < 1e-6;
  const lattice = !conv && exact && (op === "lt" || op === "ge") ? "" : `The climate report records hundredths of an inch, so ${OP_WORD[op]} ${fmtNum(inches)} in means ${boundary}.`;
  const head = i.wrote && (conv || lattice) ? `You wrote “${i.wrote}”. ` : "";
  const dflt = i.value === null ? `You did not name an amount, so this card uses ${DEFAULT_RAIN.toFixed(2)} in as an example. It is not the exact rule you asked for, and you can change the number on the next screen.` : "";
  return { ok: true, intent: i, series: nwsSeries("rain", st.code, T), inverse: below, metric: "rain", threshold: T, boundary, note: [`${head}${conv}${lattice}`.trim(), dflt].filter(Boolean).join(" ") || null, example: i.value === null };
}

/** The boundary phrase of a locked NWS rule ("31 °F or colder"), from the rule alone (the review and the dials read it). */
export function nwsBoundary(series: string, inverse: boolean): string | null {
  const n = parseNwsSeries(series);
  if (!n) return null;
  if (n.metric === "snow") return "the season's first snow";
  if (n.metric === "high") return inverse ? `${n.threshold - 1} °F or colder` : `${n.threshold} °F or hotter`;
  return inverse ? `less than ${n.threshold.toFixed(2)} in of rain` : `${n.threshold.toFixed(2)} in of rain or more`;
}

/** The station's climate day in words: midnight to midnight in its local standard time all year (the report does not move to daylight time). */
export const STANDARD_ZONE: Record<string, string> = { AZ: "Mountain Standard Time", CO: "Mountain Standard Time", UT: "Mountain Standard Time", CA: "Pacific Standard Time", NV: "Pacific Standard Time", WA: "Pacific Standard Time", TX: "Central Standard Time", MN: "Central Standard Time", IL: "Central Standard Time", MO: "Central Standard Time" };
export const climateDaySentence = (st: Station): string => `Each day runs from midnight to midnight, ${STANDARD_ZONE[st.state] ?? "Eastern Standard Time"}, all year, and is read the next morning.`;

/**
 * THE FIRST-SNOW SEASON (intent audit item 11), as the code settles it (sources/nws.ts qualifies and snowSeasonEnd, multiKeeper.ts
 * planToken and detectRuleEnd): a day counts when it has 0.1 in of snow or more and the report's "since July 1" total equals that day's
 * snow, so the season runs July 1 to June 30. A coin covers the season holding its launch day; only readings after its launch time are
 * planned. It ends after that first snow, or ends void once June 30 passes with none. If this season's first snow already fell, the
 * creation preflight refuses the coin (oneShotEligibility.ts, sources/native.ts).
 */
export const FIRST_SNOW_SEASON = "The snow season runs from July 1 to June 30, the climate report's own season, and the coin covers the season it launches in. Only a first snow after the day the coin launches counts. If this season's first snow already fell, a new coin is not offered. If no snow falls by June 30, the coin ends without a burn.";
