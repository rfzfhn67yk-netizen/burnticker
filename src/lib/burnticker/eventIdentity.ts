import { fitName } from "@/lib/burnticker/launchFields";
import { TEAM_ALIASES } from "@/lib/burnticker/oracle/events";

/**
 * A COIN'S NAME AND TICKER FROM THE EVENT, NOT THE LAST WORD (ChatGPT launch audit 5, L12, 2026-10-11: "Will LeBron James retire before
 * next NBA season?" became "season Wins / $SEASON" and the description said "burns if LeBron James retire before …"). From a market
 * question (or its plain phrase) this reads the SUBJECT (the entity), the VERB (the outcome) and the rest, and builds:
 *
 *   phrase     the grammatical third-person sentence ("LeBron James retires before next NBA season")
 *   name       subject + outcome ("LeBron James Retires", "Bitcoin Reaches $150,000", "El-Sayed Wins")
 *   ticker     the entity's distinctive word + an outcome suffix ("JAMESOUT", "BTCHIT"); a win keeps the bare entity ("ELSAYED")
 *   confident  false when no outcome verb was found or the subject is unusable — the page then asks the creator to name the coin
 *
 * Pure and client-safe; test/burntickerLaunchDraft.test.ts holds the fixtures (retirement, elections, titles, weather, financial
 * thresholds, long names).
 */
const VERBS = ["win", "be", "have", "reach", "cross", "get", "make", "receive", "finish", "hit", "say", "become", "retire", "cut", "raise", "leave", "resign", "sign", "pass", "announce", "release", "launch", "lose", "beat", "score", "break", "land", "return", "join", "play", "appear", "declare", "end", "go", "drop", "rise", "fall", "exceed", "top", "close", "confirm", "approve", "ban", "visit", "meet", "attend", "testify", "veto", "nominate", "endorse", "qualify", "advance", "defeat", "clinch", "surpass", "hold", "keep", "take", "sell", "buy", "file", "post", "trade", "dip", "reveal", "debut", "marry", "die", "stay", "remain", "run", "start"] as const;
const IRREGULAR: Record<string, string> = { be: "is", have: "has", go: "goes", do: "does", say: "says" };
const BASE_OF: Record<string, string> = { is: "be", are: "be", has: "have", goes: "go", does: "do" };
/** Ticker suffix per outcome verb (a win keeps the bare entity, as every election and team card always has). */
const SUFFIX: Record<string, string> = { win: "", be: "", become: "", retire: "OUT", leave: "OUT", resign: "OUT", reach: "HIT", hit: "HIT", cross: "HIT", exceed: "HIT", surpass: "HIT", top: "HIT", cut: "CUT", drop: "DROP", fall: "DROP", dip: "DROP", raise: "UP", rise: "UP", lose: "LOSE", sign: "SIGN", launch: "GO", release: "GO", announce: "SAYS", say: "SAYS" };
const ALIAS: Record<string, string> = { "federal reserve": "FED", "the fed": "FED", fed: "FED", "united states": "US", "supreme court": "SCOTUS", bitcoin: "BTC", ethereum: "ETH", solana: "SOL", "new york city": "NYC" };
const GENERIC_TAIL = new Set(["party", "states", "union", "committee", "court", "bank", "reserve", "house", "senate", "council", "government"]);

export const conjugate = (v: string): string => {
  const b = v.toLowerCase();
  if (IRREGULAR[b]) return IRREGULAR[b];
  if (/(s|sh|ch|x|z|o)$/.test(b)) return `${b}es`;
  if (/[^aeiou]y$/.test(b)) return `${b.slice(0, -1)}ies`;
  return `${b}s`;
};
/** The base form of a verb as it may appear in a question ("retire") or a phrase ("retires"). */
function baseOf(w: string): string | null {
  const l = w.toLowerCase();
  if ((VERBS as readonly string[]).includes(l)) return l;
  if (BASE_OF[l]) return BASE_OF[l];
  for (const v of VERBS) if (conjugate(v) === l) return v;
  return null;
}
const titleCase = (w: string) => (w ? w[0].toUpperCase() + w.slice(1) : w);
const tickerOf = (s: string, suffix: string) => { const base = s.toUpperCase().replace(/[^A-Z0-9]/g, ""); return (base.slice(0, Math.max(2, 10 - suffix.length)) + suffix).slice(0, 10); };

/**
 * Continuous audit run 2, HB-20: team nicknames that do not end in "s" but take a plural verb ("the Avalanche win", never "wins"); the
 * pinned description is permanent, so the agreement matters. The list is every such nickname in the ESPN team table (MLB, NBA, NHL, WNBA).
 */
export const PLURAL_NICKNAMES: ReadonlySet<string> = new Set(["red sox", "white sox", "heat", "thunder", "magic", "jazz", "avalanche", "wild", "kraken", "lightning", "mammoth", "dream", "sky", "sun", "fever", "lynx", "liberty", "mercury", "fire", "storm", "tempo"]);

/**
 * HB-149 (hourly run 13): whether a question's subject takes a plural verb. The HB-128 fix counted a subject plural only when it opened
 * with "the", so "Will Democrats control the House?" read "Democrats controls the House". A subject is plural when its head noun ends in
 * "s" and is not a known singular (Congress, Texas, Kansas, the United States, a surname such as Sanders), or when it names a party's
 * members or a team ("Democrats", "the Republicans", "Mavericks", "Dallas Mavericks"). A name of more than one word ending in "s" with
 * no team in it ("Bernie Sanders", "LeBron James") stays singular. `group` says the market's own group type is parties or teams: a head
 * ending in "s" then counts as plural whatever its length ("Kansas City Chiefs"); a name with "Party" in it is still one party.
 */
const SINGULAR_S: ReadonlySet<string> = new Set(["congress", "texas", "kansas", "arkansas", "illinois", "paris", "athens", "wales", "news", "united states", "netherlands", "philippines", "bahamas", "states", "sanders", "williams", "adams", "jones", "james", "roberts", "edwards", "evans", "collins", "rogers", "reeves", "peters", "stevens", "phillips", "hughes", "simmons", "rivers", "wells", "mills", "myers", "powers", "burns", "banks", "hayes", "brooks", "fields", "lucas", "thomas", "nicholas", "marcus", "charles", "brussels", "los angeles", "las vegas", "dallas", "memphis", "minneapolis", "indianapolis"]);
const SINGLE_AND: ReadonlySet<string> = new Set(["trinidad and tobago", "bosnia and herzegovina", "antigua and barbuda", "saint kitts and nevis", "st. kitts and nevis", "sao tome and principe", "saint vincent and the grenadines", "papua new guinea", "procter & gamble", "procter and gamble", "at&t", "ben & jerry's", "turks and caicos"]);
const PLURAL_GROUPS: ReadonlySet<string> =new Set(["democrats", "republicans", "dems", "liberals", "conservatives", "progressives", "independents", "libertarians", "tories", "socialists", "greens", "voters"]);
const TEAM_NICKNAMES_S: ReadonlySet<string> = new Set(TEAM_ALIASES.map((t) => t.nickname.toLowerCase().split(/\s+/).pop() ?? "").filter((n) => /s$/.test(n)));
export function subjectIsPlural(subject: string, o: { group?: "party" | "team" } = {}): boolean {
  const the = /^the\s+/i.test(subject);
  const bare = subject.replace(/^the\s+/i, "").replace(/\s*\([A-Z]\)$/, "").trim();
  const words = bare.split(/\s+/).filter(Boolean);
  if (!words.length) return false;
  const lower = bare.toLowerCase(), lastRaw = words[words.length - 1].replace(/[^A-Za-z.]/g, ""), head = lastRaw.toLowerCase();
  const lastTwo = words.slice(-2).join(" ").toLowerCase();
  if (PLURAL_NICKNAMES.has(lower) || PLURAL_NICKNAMES.has(lastTwo)) return true;
  // HB-166 L4 (hourly run 15): "Russia and Ukraine", "Trump and Putin": two subjects joined by "and" take the plural verb (a country
  // named with "and" is one subject)
  if (/\s(and|&)\s/i.test(bare) && !SINGLE_AND.has(lower)) return true;
  if (/\bpart(y|ies)\b/i.test(bare)) return /\bparties\b/i.test(bare);
  if (SINGULAR_S.has(lower) || (SINGULAR_S.has(head) && !TEAM_NICKNAMES_S.has(head))) return false;
  if (/^[A-Z.]{2,5}$/.test(lastRaw)) return false;   // an acronym: the US, NATO, the GOP
  if (!/s$/.test(head) || /(ss|us|is)$/.test(head)) return false;
  if (the || o.group) return true;
  if (TEAM_NICKNAMES_S.has(head) || PLURAL_GROUPS.has(head)) return true;
  return words.length === 1;   // "Democrats", "Lakers"; a longer name ending in s is a person ("Bernie Sanders")
}

/**
 * HS-12 (continuous audit run 4): a work's title ("Dune: Part Three", "Toy Story 5") gives its FIRST word plus the sequel number as a digit
 * ($DUNE3, $TOY5), never the last word ($THREE). A title with a colon and no number gives its first word. Null otherwise.
 */
const NUMBER_WORDS: Record<string, string> = { two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10", ii: "2", iii: "3", iv: "4", vi: "6", vii: "7", viii: "8", ix: "9" };
export function titleEntity(bare: string): string | null {
  const parts = bare.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null;
  const first = parts[0].split(/[^A-Za-z0-9]+/).find(Boolean) ?? "";
  const last = parts[parts.length - 1].replace(/[^A-Za-z0-9]/g, "");
  const n = /^\d{1,2}$/.test(last) ? last : NUMBER_WORDS[last.toLowerCase()] ?? null;
  if (n !== null && first) return `${first}${n}`;
  return bare.includes(":") && first ? first : null;
}

/** Words after which a verb-looking word is a noun ("by end", "the close", "a raise"). */
const NOUN_AFTER: ReadonlySet<string> = new Set(["by", "of", "the", "a", "an", "before", "after", "until", "till", "in", "at", "on", "for", "from", "its", "their", "his", "her"]);

export interface EventIdentity { subject: string; verb: string | null; rest: string; phrase: string; name: string; ticker: string; confident: boolean }

export function eventIdentity(question: string, { group }: { group?: "party" | "team" } = {}): EventIdentity {
  const raw = question.trim().replace(/\s*\(resolves once\)$/i, "").replace(/\?+$/, "").replace(/^will\s+/i, "").trim();
  const words = raw.split(/\s+/).filter(Boolean);
  let vi = -1;
  // BT-INC-20261020T0049Z-02 (with HS-33): a word after a preposition or an article is a noun, never the outcome verb ("Netanyahu out by
  // end of 2026" read "end" as the verb and named the coin "Netanyahu out by Ends"); such a question keeps its own whole words
  for (let i = 1; i < words.length && i <= 6; i++) if (baseOf(words[i]) && !NOUN_AFTER.has(words[i - 1].toLowerCase())) { vi = i; break; }
  if (vi < 0) {
    const first = words.find((w) => /^[A-Z0-9]/.test(w) && w.length > 1) ?? words[0] ?? "EVENT";
    return { subject: raw, verb: null, rest: "", phrase: raw, name: fitName(raw), ticker: tickerOf(first, ""), confident: false };
  }
  const subject = words.slice(0, vi).join(" "), verb = baseOf(words[vi])!, restWords = words.slice(vi + 1), rest = restWords.length ? ` ${restWords.join(" ")}` : "";
  const bare = subject.replace(/^the\s+/i, "").replace(/\s*\([A-Z]\)$/, "").trim();
  const conj = subjectIsPlural(subject, { group }) ? verb : conjugate(verb);
  const phrase = `${subject} ${conj}${rest}`;
  const parts = bare.split(/\s+/);
  const alias = ALIAS[bare.toLowerCase()];
  const entityWord = alias ?? titleEntity(bare) ?? (parts.length > 1 && GENERIC_TAIL.has(parts[parts.length - 1].toLowerCase()) ? parts[0] : parts[parts.length - 1]);
  const figure = restWords.find((w) => /\d/.test(w) && !/^(19|20)\d\d$/.test(w));
  const copula = verb === "be" || verb === "have" || verb === "become";
  const tail = copula && restWords[0] ? [titleCase(restWords[0].replace(/[,.;:]$/, ""))] : figure && ["reach", "hit", "cross", "exceed", "surpass", "top", "drop", "fall"].includes(verb) ? [figure.replace(/[,.;:]$/, "")] : [];
  let name = [verb === "win" ? (parts[parts.length - 1] ?? bare) : bare, titleCase(conj), ...tail].join(" ");
  if (name.length > 32) name = fitName([parts[parts.length - 1], titleCase(conj), ...tail].join(" "));
  const suffix = SUFFIX[verb] ?? verb.toUpperCase().slice(0, 4);
  const confident = parts.length >= 1 && parts.length <= 6 && bare.length >= 2 && !/^(it|this|that|there|they)$/i.test(bare);
  return { subject, verb, rest, phrase, name, ticker: tickerOf(entityWord, suffix), confident };
}

/** Lowercase words that follow a name but are never the outcome verb ("Netanyahu out by…", "Bitcoin above…"). */
const NOT_VERB: ReadonlySet<string> = new Set([...NOUN_AFTER, "out", "off", "over", "under", "into", "onto", "and", "or", "nor", "not", "than", "with", "without", "vs", "via", "per", "to", "up", "down", "still", "ever", "again", "also", "all", "both", "each", "any", "no", "yes", "as", "if", "when", "then", "there", "here", "more", "less", "most", "least", "above", "below", "near", "within", "during", "between", "against", "through", "among", "next", "this", "that", "these", "those", "who", "whose", "which"]);

/**
 * HB-128 (hourly run 11): a market QUESTION said as a statement ("Will the Democratic Party control the Senate…?" becomes "the Democratic
 * Party controls the Senate…"). A known outcome verb goes through eventIdentity; a question whose verb eventIdentity does not know still
 * conjugates (third person singular) when its subject is a run of capitalised words and the next word is a plain lowercase verb, unless
 * the subject is plural ("the Democrats control"). The fallback runs only on a question that opened with "Will", so a title with no verb
 * ("US recession in 2026") is never bent into one. Text that is not a question comes back without its "?" and "(resolves once)".
 */
export function statementOf(question: string, o: { group?: "party" | "team" } = {}): string {
  const trimmed = question.trim().replace(/\s*\(resolves once\)$/i, "").replace(/\?+$/, "").trim();
  const asked = /^will\s+/i.test(trimmed);
  const raw = trimmed.replace(/^will\s+/i, "").trim();
  const id = eventIdentity(raw, o);
  if (id.verb) return id.phrase;
  if (!asked) return raw;
  const words = raw.split(/\s+/).filter(Boolean);
  const start = /^the$/i.test(words[0] ?? "") ? 1 : 0;
  let i = start;
  while (i < words.length && /^\(?[A-Z0-9][\w'.&()-]*$/.test(words[i])) i++;
  if (i === start || i >= words.length || i > 8) return raw;
  const w = words[i];
  if (!/^[a-z]{2,}$/.test(w) || NOT_VERB.has(w) || /(ed|ing|ly)$/.test(w) || (/s$/.test(w) && !/ss$/.test(w))) return raw;
  const subject = words.slice(0, i).join(" ");
  return [subject, subjectIsPlural(subject, o) ? w : conjugate(w), ...words.slice(i + 1)].join(" ");
}
