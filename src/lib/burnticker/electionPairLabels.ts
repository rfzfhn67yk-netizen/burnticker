/**
 * Private review 10 F2: the two sides of an election pair need distinct words, names and tickers. The old wizard took the last word of each
 * outcome's label, so party control ("Democratic Party" and "Republican Party") became "Party vs Party" with two PARTVPART tickers, and two
 * candidates who share a surname collided the same way. Parties are said as their members ("Democrats vs Republicans", $DEMVREP and
 * $REPVDEM); two candidates with one surname take a first initial, then the full name.
 */
import { pairNames } from "@/lib/burnticker/guidedLaunch";

/** A party's plural and its ticker code. */
const PARTIES: Record<string, { word: string; code: string }> = {
  democratic: { word: "Democrats", code: "DEM" },
  democrat: { word: "Democrats", code: "DEM" },
  democrats: { word: "Democrats", code: "DEM" },
  republican: { word: "Republicans", code: "REP" },
  republicans: { word: "Republicans", code: "REP" },
  gop: { word: "Republicans", code: "REP" },
  libertarian: { word: "Libertarians", code: "LIB" },
  green: { word: "Greens", code: "GRN" },
  independent: { word: "Independents", code: "IND" },
  labour: { word: "Labour", code: "LAB" },
  conservative: { word: "Conservatives", code: "CON" },
};

const clean = (label: string) => label.replace(/\s*\([A-Z]\)$/, "").trim().replace(/\s+/g, " ");
const fold = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const code = (s: string, max = 4) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, max);

/** The party an outcome label names ("Democratic Party", "Republican", "The Green Party"), or null for a person. */
export function partyOf(label: string): { word: string; code: string } | null {
  const l = clean(label).replace(/^the\s+/i, "");
  const m = /^(.+?)\s+party$/i.exec(l);
  const key = fold(m ? m[1] : l);
  if (PARTIES[key]) return PARTIES[key];
  if (m) { const word = m[1].trim(); return { word, code: code(word, 3) }; }
  return null;
}

export interface ElectionSideWords { a: { word: string; code: string }; b: { word: string; code: string } }

/** The word each side is called by and its ticker code; the two always differ. */
export function electionSideWords(labelA: string, labelB: string): ElectionSideWords {
  const pa = partyOf(labelA), pb = partyOf(labelB);
  if (pa && pb && fold(pa.word) !== fold(pb.word)) return distinctCodes({ a: pa, b: pb });
  const la = clean(labelA), lb = clean(labelB);
  const words = (l: string) => l.split(" ").filter(Boolean);
  const sur = (l: string) => words(l).pop() ?? l;
  const initial = (l: string) => { const w = words(l); return w.length > 1 ? `${w[0][0].toUpperCase()}. ${sur(l)}` : l; };
  const forms: Array<(l: string) => string> = [sur, initial, (l) => l];
  for (const f of forms) {
    const a = f(la), b = f(lb);
    if (fold(a) !== fold(b)) return distinctCodes({ a: { word: a, code: code(a) }, b: { word: b, code: code(b) } });
  }
  // the same label twice is refused upstream (one outcome cannot be both sides); still never two identical sides
  return distinctCodes({ a: { word: `${la} (A)`, code: code(la, 3) + "A" }, b: { word: `${lb} (B)`, code: code(lb, 3) + "B" } });
}

/** Two codes that read the same ("JSMI" from "J. Smith" and "J. Smithers") get a side letter so the tickers stay apart. */
function distinctCodes(s: ElectionSideWords): ElectionSideWords {
  if (s.a.code && s.a.code !== s.b.code) return s;
  return { a: { ...s.a, code: code(s.a.code || s.a.word, 3) + "A" }, b: { ...s.b, code: code(s.b.code || s.b.word, 3) + "B" } };
}

/** The pair's side words, coin names and tickers ("Democrats vs Republicans", $DEMVREP and $REPVDEM). */
export function electionPairIdentity(labelA: string, labelB: string, raceTitle?: string | null): { words: { a: string; b: string }; names: { a: string; b: string }; tickers: { a: string; b: string } } {
  const s = electionSideWords(labelA, labelB);
  const names = pairNames(s.a.word, s.b.word, { a: s.a.code, b: s.b.code });
  // WZ7-11 (seventh pass): the Senate and the House party-control pairs both came out "Democrats vs Republicans", $DEMVREP. A party pair
  // whose race names a chamber says it: "Democrats vs Republicans, Senate", $DEMSENVREP.
  const ch = partyOf(labelA) && partyOf(labelB) ? chamberOf(raceTitle ?? "") : null;
  if (ch) {
    const named = (x: string) => (new TextEncoder().encode(`${x}, ${ch.word}`).length <= 32 ? `${x}, ${ch.word}` : x);
    return { words: { a: s.a.word, b: s.b.word }, names: { a: named(`${s.a.word} vs ${s.b.word}`), b: named(`${s.b.word} vs ${s.a.word}`) }, tickers: { a: `${s.a.code}${ch.code}V${s.b.code}`.slice(0, 10), b: `${s.b.code}${ch.code}V${s.a.code}`.slice(0, 10) } };
  }
  return { words: { a: s.a.word, b: s.b.word }, names, tickers: { a: `${s.a.code}V${s.b.code}`.slice(0, 10), b: `${s.b.code}V${s.a.code}`.slice(0, 10) } };
}
/** The chamber a party-control race is about ("Which party will win the Senate in 2026?"), or null. */
export function chamberOf(title: string): { word: string; code: string } | null {
  if (/\bsenate\b/i.test(title)) return { word: "Senate", code: "SEN" };
  if (/\bhouse\b/i.test(title)) return { word: "House", code: "HOU" };
  return null;
}
