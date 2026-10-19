import { fitName } from "@/lib/burnticker/launchFields";

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

export interface EventIdentity { subject: string; verb: string | null; rest: string; phrase: string; name: string; ticker: string; confident: boolean }

export function eventIdentity(question: string): EventIdentity {
  const raw = question.trim().replace(/\s*\(resolves once\)$/i, "").replace(/\?+$/, "").replace(/^will\s+/i, "").trim();
  const words = raw.split(/\s+/).filter(Boolean);
  let vi = -1;
  for (let i = 1; i < words.length && i <= 6; i++) if (baseOf(words[i])) { vi = i; break; }
  if (vi < 0) {
    const first = words.find((w) => /^[A-Z0-9]/.test(w) && w.length > 1) ?? words[0] ?? "EVENT";
    return { subject: raw, verb: null, rest: "", phrase: raw, name: fitName(raw), ticker: tickerOf(first, ""), confident: false };
  }
  const subject = words.slice(0, vi).join(" "), verb = baseOf(words[vi])!, restWords = words.slice(vi + 1), rest = restWords.length ? ` ${restWords.join(" ")}` : "";
  const bare = subject.replace(/^the\s+/i, "").replace(/\s*\([A-Z]\)$/, "").trim();
  const plural = /^the\s+/i.test(subject) && ((/s$/i.test(bare) && !/ss$/i.test(bare)) || PLURAL_NICKNAMES.has(bare.toLowerCase()));
  const conj = plural ? verb : conjugate(verb);
  const phrase = `${subject} ${conj}${rest}`;
  const parts = bare.split(/\s+/);
  const alias = ALIAS[bare.toLowerCase()];
  const entityWord = alias ?? (parts.length > 1 && GENERIC_TAIL.has(parts[parts.length - 1].toLowerCase()) ? parts[0] : parts[parts.length - 1]);
  const figure = restWords.find((w) => /\d/.test(w) && !/^(19|20)\d\d$/.test(w));
  const copula = verb === "be" || verb === "have" || verb === "become";
  const tail = copula && restWords[0] ? [titleCase(restWords[0].replace(/[,.;:]$/, ""))] : figure && ["reach", "hit", "cross", "exceed", "surpass", "top", "drop", "fall"].includes(verb) ? [figure.replace(/[,.;:]$/, "")] : [];
  let name = [verb === "win" ? (parts[parts.length - 1] ?? bare) : bare, titleCase(conj), ...tail].join(" ");
  if (name.length > 32) name = fitName([parts[parts.length - 1], titleCase(conj), ...tail].join(" "));
  const suffix = SUFFIX[verb] ?? verb.toUpperCase().slice(0, 4);
  const confident = parts.length >= 1 && parts.length <= 6 && bare.length >= 2 && !/^(it|this|that|there|they)$/i.test(bare);
  return { subject, verb, rest, phrase, name, ticker: tickerOf(entityWord, suffix), confident };
}
