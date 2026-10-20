import type { BurnRule } from "@/lib/burnticker/rules";
import { parseEspnSeries } from "@/lib/burnticker/sources/espn";

/**
 * LOOKALIKE REFUSAL (growth batch, owner-approved 2026-10-10). A new coin's ticker and name must not pass for an existing Burnticker
 * coin's, nor for Burnticker itself. Both sides are reduced to a SKELETON first — accents stripped (NFKD), Cyrillic and Greek letters
 * that look Latin mapped to Latin, the confusable digits mapped to letters (0→O, 1→I, 3→E, 4→A, 5→S, 7→T, 8→B), l / | / ! → I, "rn" → M,
 * "vv" → W, everything but letters dropped — and then the new coin is refused when its skeleton:
 *
 *   · equals an existing coin's (DEF1CIT, DEFICІT with a Cyrillic І, "dé.ficit");
 *   · is within ONE edit (insert, delete, substitute or swap two neighbours) of it, for skeletons of four letters or more (DEFICT,
 *     DEFIICT); shorter tickers only on equality, or every three-letter ticker would collide;
 *   · is the existing ticker plus a copycat suffix, or the other way round (DEFICIT2, DEFICITV2, DEFICITX, DEFICITINU, REALDEFICIT);
 *   · contains BURNTICKER, the platform's own name.
 *
 * One exemption: two TEAM coins of the same team in the same league (RAYS26 and RAYS27, a season and a postseason coin) are different
 * windows of one team — the generated season tickers carry the year on purpose — and do not refuse each other. Expired drafts do not
 * count (their ticker is free again); a live draft reserves its ticker, and names are compared with launched coins only. Prelaunch audit
 * 2026-10-18 A-2: an IDENTICAL ticker is a hit too (it used to be left to a registry check nobody called); the one exception is the
 * creator's own coin, so a creator may prepare their own draft again. Pure: the launch handler calls `lookalikeRefusal` with the registry's rows; the clone watch uses
 * `skeleton` and `editDistance` to match tokens elsewhere.
 */

const CONFUSABLE: Record<string, string> = {
  // Cyrillic
  "А": "A", "В": "B", "Е": "E", "Ё": "E", "К": "K", "М": "M", "Н": "H", "О": "O", "Р": "P", "С": "C", "Т": "T", "У": "Y", "Х": "X", "І": "I", "Ї": "I", "Ј": "J", "Ѕ": "S", "Ԁ": "D",
  "а": "A", "в": "B", "е": "E", "ё": "E", "к": "K", "м": "M", "н": "H", "о": "O", "р": "P", "с": "C", "т": "T", "у": "Y", "х": "X", "і": "I", "ї": "I", "ј": "J", "ѕ": "S", "ԁ": "D",
  // Greek
  "Α": "A", "Β": "B", "Ε": "E", "Ζ": "Z", "Η": "H", "Ι": "I", "Κ": "K", "Μ": "M", "Ν": "N", "Ο": "O", "Ρ": "P", "Τ": "T", "Υ": "Y", "Χ": "X",
  "α": "A", "β": "B", "ε": "E", "ι": "I", "κ": "K", "ν": "V", "ο": "O", "ρ": "P", "τ": "T", "υ": "U", "χ": "X",
  // digits and symbols that read as letters
  "0": "O", "1": "I", "3": "E", "4": "A", "5": "S", "7": "T", "8": "B", "l": "I", "|": "I", "!": "I", "$": "S", "@": "A",
};

/**
 * The comparison form: what a reader sees, not what the bytes are. "Dé.f1c|t" → "DEFICIT". A leading $ is a ticker sign, dropped. Lossy
 * on purpose and applied to BOTH sides: L and I are one letter here (l / 1 / | / I / L all read alike), "rn" is M, "vv" is W, and digits
 * that do not read as a letter are dropped (DEFICIT2 → DEFICIT).
 */
export function skeleton(s: string): string {
  const base = s.normalize("NFKC").replace(/^\s*\$/, "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  let out = "";
  for (const ch of base) out += CONFUSABLE[ch] ?? ch;
  return out.toUpperCase().replace(/RN/g, "M").replace(/VV/g, "W").replace(/L/g, "I").replace(/[^A-Z]/g, "");
}

/** Optimal-string-alignment distance (insert, delete, substitute, swap neighbours), stopping early once it exceeds `max`. */
export function editDistance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      rowMin = Math.min(rowMin, d[i][j]);
    }
    if (rowMin > max) return max + 1;
  }
  return d[a.length][b.length];
}

/** Suffixes and prefixes a copycat bolts on ("DEFICIT2", "DEFICITV2", "REALDEFICIT"), kept in skeleton form. */
const SUFFIX = new Set(["1", "3", "4", "5", "7", "8", "0", "11", "V", "V1", "X", "XX", "INU", "AI", "OG", "CLASSIC", "REAL", "NEW", "PRO", "MAX", "PLUS", "COIN", "TOKEN", "SOL", "BURN", "OFFICIAL", "S"].map(skeleton));
const PREFIX = new Set(["REAL", "THE", "NEW", "OG", "BABY", "MINI", "SUPER", "TRUE", "OFFICIAL", "SOL", "X"].map(skeleton));

/** The platform's own name, in skeleton form ("Burn Ticker", "BURNT1CKER" …). */
export const PLATFORM_MARKS = ["BURNTICKER"].map(skeleton);

export interface LookalikeExisting { ticker: string; name: string; status: string; rule?: Pick<BurnRule, "oracle" | "series"> | null; /** A-2: the coin's creator wallet; an identical ticker of the candidate's own coin is not a hit */ creator?: string | null }
export type LookalikeHow = "same-letters" | "one-edit" | "suffix" | "platform-name";
export interface LookalikeHit { field: "ticker" | "name"; existing: string; /** LA-4: "draft-held" only with `draftNotice` (a review asked with no proven wallet) */ how: LookalikeHow | "draft-held"; reason: string }

/**
 * LA-4 (owner, devnet 2026-10-19): the review's sentence for a ticker an unlaunched DRAFT holds, when the review cannot tell who is asking
 * (no signed request, or one past its 15-minute age limit). The creator of that draft may be the one asking: a press of Launch signs a
 * fresh request, the prepare checks the ticker with that signed wallet (launchGuards.ts), and only the draft's own wallet is let through;
 * anyone else gets the ordinary same-ticker refusal after signing. A notice, never a refusal: the review does not turn Launch off for it.
 */
export const draftHeldSentence = (ticker: string): string => `$${ticker.toUpperCase()} is held by a coin that has not launched yet. If that draft is yours, press Launch and sign with the same wallet to continue; otherwise pick another ticker.`;
/**
 * LA-4: a ticker one letter from (or a copycat of) an unlaunched draft's ticker. It stays a refusal for everyone, the draft's own creator
 * included: a draft whose first steps landed can still be finished, and two coins one letter apart is what the lookalike rule forbids.
 * The way out it names is that draft's own ticker (which the creator can finish) or another ticker.
 */
export const nearDraftSentence = (ticker: string): string => `$${ticker.toUpperCase()} is too close to the ticker of another Burnticker coin that has not launched yet. If that unfinished launch is yours, go back to its own ticker to finish it.`;

const teamOf = (r: Pick<BurnRule, "oracle" | "series"> | null | undefined): string | null => {
  const e = r && r.oracle === "catalogue" && r.series ? parseEspnSeries(r.series) : null;
  return e ? `${e.league}:${e.abbr}` : null;
};

/** How two SKELETONS resemble each other (same letters, one edit, a copycat suffix / prefix), or null. Exported for the clone watch. */
export function compare(cand: string, ex: string): LookalikeHow | null {
  if (!cand || !ex) return null;
  if (cand === ex) return "same-letters";
  if (cand.length >= 4 && ex.length >= 4 && editDistance(cand, ex, 1) <= 1) return "one-edit";
  for (const [long, short] of [[cand, ex], [ex, cand]]) {
    if (short.length < 3 || long.length <= short.length) continue;
    if (long.startsWith(short) && SUFFIX.has(long.slice(short.length))) return "suffix";
    if (long.endsWith(short) && PREFIX.has(long.slice(0, long.length - short.length))) return "suffix";
  }
  return null;
}

/** A-2: the sentence for a ticker another creator's coin already holds (it names no mint, name or rule: the holder may be a draft). */
export const sameTickerSentence = (ticker: string): string => `$${ticker.toUpperCase()} is already the ticker of another Burnticker coin.`;

const HOW_TEXT: Record<LookalikeHow, string> = { "same-letters": "reads as the same letters as", "one-edit": "is one letter away from", suffix: "is a copycat variant of", "platform-name": "uses the platform's name" };

/**
 * Continuous audit HB-117 b (run 10): a name clash read "The name "Next Magnitude 6" reads as the same letters as "Next Magnitude 6"",
 * the same string on both sides. A name that IS the other coin's name now says so once, and says when that coin follows the same rule
 * (someone copying the rule kept its name); a name that differs from it still quotes both.
 */
export const SAME_RULE_NAME_ASK = "Pick a name that cannot be mistaken for it.";
function nameCloneSentence(cand: { name: string; rule?: Pick<BurnRule, "oracle" | "series"> | null }, e: LookalikeExisting, how: LookalikeHow): string {
  const coin = e.status === "live" ? `the live $${e.ticker}` : `$${e.ticker}, an existing Burnticker coin`;
  const sameRule = !!(cand.rule && e.rule && cand.rule.oracle === e.rule.oracle && (cand.rule.series ?? null) === (e.rule.series ?? null));
  const tail = sameRule ? ", which follows the same rule" : "";
  const sameText = cand.name.trim().toLowerCase().replace(/\s+/g, " ") === e.name.trim().toLowerCase().replace(/\s+/g, " ");
  if (sameText) return `This is the name of ${coin}${tail}.`;
  return `The name "${cand.name}" ${HOW_TEXT[how]} "${e.name}", the name of ${coin}${tail}.`;
}

/** Every way a new coin's ticker or name passes for an existing coin's (or for Burnticker). Empty = no lookalike. */
export function lookalikeHits(cand: { ticker: string; name: string; rule?: Pick<BurnRule, "oracle" | "series"> | null; creator?: string | null }, existing: readonly LookalikeExisting[], o: { /** LA-4: the review's form (launchReview.ts): with no proven creator, an exact ticker held by a draft is a "draft-held" notice, not a refusal. The prepare never passes it. */ draftNotice?: boolean } = {}): LookalikeHit[] {
  const hits: LookalikeHit[] = [];
  const ct = skeleton(cand.ticker), cn = skeleton(cand.name), team = teamOf(cand.rule);
  for (const mark of PLATFORM_MARKS) for (const [field, v] of [["ticker", ct], ["name", cn]] as const) if (v.includes(mark)) hits.push({ field, existing: "Burnticker", how: "platform-name", reason: `The ${field} uses the platform's name, Burnticker.` });
  for (const e of existing) {
    if (e.status === "expired") continue;
    // A-2: the very same ticker, held by another creator's coin (launched or an open draft), is refused whatever the rule; the creator's
    // own coin is not (a retry of their own draft)
    const exact = cand.ticker.trim().toUpperCase().replace(/^\$/, "") === e.ticker.toUpperCase();
    if (exact) {
      // review of block M: every ticker is one coin, so the creator's own LAUNCHED coin refuses it too (a second coin would turn
      // /t/<TICKER> into a chooser); only their own unfinished draft is exempt, so they can prepare it again
      const ownDraft = !!(cand.creator && e.creator && cand.creator === e.creator && e.status === "draft");
      // LA-4: nobody proven is asking and a DRAFT holds it, so its creator may be the one asking: the review says so and leaves Launch
      // on. The press signs; the prepare (and the review asked again with that proof) decide with the signed wallet, as above.
      if (!ownDraft && o.draftNotice && !cand.creator && e.status === "draft") hits.push({ field: "ticker", existing: "a coin not launched yet", how: "draft-held", reason: draftHeldSentence(e.ticker) });
      else if (!ownDraft) hits.push({ field: "ticker", existing: `$${e.ticker}`, how: "same-letters", reason: sameTickerSentence(e.ticker) });
      // HB-117 (run 10): the name is still compared, so a copied ticker AND name are both said at once (the name's refusal used to
      // appear only after the ticker was changed)
      if (ownDraft || e.status === "draft") continue;
    }
    if (!exact && team && teamOf(e.rule) === team) continue;   // another window of the same team: RAYS26 / RAYS27
    const et = skeleton(e.ticker), en = skeleton(e.name);
    const t = exact ? null : compare(ct, et);
    // review of block M: a draft's ticker is never named (it is not public until the coin exists)
    if (t) hits.push(e.status === "draft" ? { field: "ticker", existing: "a coin not launched yet", how: t, reason: nearDraftSentence(cand.ticker) } : { field: "ticker", existing: `$${e.ticker}`, how: t, reason: `$${cand.ticker.toUpperCase()} ${HOW_TEXT[t]} $${e.ticker}, which is an existing Burnticker coin.` });
    if (e.status === "draft") continue;   // a draft reserves its TICKER (checked above); names are compared with launched coins only
    const n = cn.length >= 5 ? compare(cn, en) : null;
    const nt = !n && cn.length >= 4 && et.length >= 4 && cn === et ? "same-letters" : null;   // a name that spells an existing ticker
    if (n) hits.push({ field: "name", existing: e.name, how: n, reason: nameCloneSentence(cand, e, n) });
    else if (nt) hits.push({ field: "name", existing: `$${e.ticker}`, how: nt, reason: `The name "${cand.name}" reads as $${e.ticker}, which is an existing Burnticker coin.` });
  }
  return hits;
}

/** The launch handler's refusal: null, or one sentence listing every hit (HTTP 409, code "lookalike"). An exact ticker held by another
 *  creator's coin is refused first by launchGuards.ts (code "ticker-taken"), which also covers a same-team coin this check skips. */
export function lookalikeRefusal(cand: { ticker: string; name: string; rule?: Pick<BurnRule, "oracle" | "series"> | null; creator?: string | null }, existing: readonly LookalikeExisting[]): { reason: string; hits: LookalikeHit[] } | null {
  return lookalikeRefusalOf(lookalikeHits(cand, existing));
}
/** The refusal sentence for hits already found (LA-4: the review leaves its draft-held notices out first). */
export function lookalikeRefusalOf(hits: LookalikeHit[]): { reason: string; hits: LookalikeHit[] } | null {
  return hits.length ? { reason: `This launch is refused. ${[...new Set(hits.map((h) => h.reason))].join(" ")} Please pick a ticker and name that cannot be mistaken for it.`, hits } : null;
}

/**
 * WZ6-10 (sixth pass): the lookalike refusal split by field, for a review that already refused the ticker as reserved. Typing BURNTICKER
 * gave two refusals in the ticker field, the second about the name. Here the ticker's platform-name hit is left out (the reserved
 * sentence already says it) and each other hit goes to its own field, so the name's sentence sits under the name.
 */
export function lookalikeRefusalsByField(cand: { ticker: string; name: string; rule?: Pick<BurnRule, "oracle" | "series"> | null; creator?: string | null }, existing: readonly LookalikeExisting[], o: { tickerReserved: boolean }): { field: "ticker" | "name"; reason: string }[] {
  const hits = lookalikeHits(cand, existing).filter((h) => !(o.tickerReserved && h.field === "ticker" && h.how === "platform-name"));
  const out: { field: "ticker" | "name"; reason: string }[] = [];
  for (const field of ["ticker", "name"] as const) {
    const mine = [...new Set(hits.filter((h) => h.field === field).map((h) => h.reason))];
    if (mine.length) out.push({ field, reason: `This launch is refused. ${mine.join(" ")} Please pick a ${field} that cannot be mistaken for it.` });
  }
  return out;
}

/**
 * NO ADOPTION OF AN OUTSIDE TOKEN. A launch's mint must be NEW: not in the registry, and with no account on chain yet (`onChain` from
 * getAccountInfo; null when this host has no RPC to ask — the program's initialize_token, which the new mint must sign, refuses it there).
 */
export function mintAdoptionRefusal(o: { inRegistry: boolean; onChain: boolean | null }): string | null {
  if (o.inRegistry) return "this mint is already registered on Burnticker";
  if (o.onChain === true) return "this mint already exists on chain — Burnticker never adopts an existing token; generate a fresh mint keypair";
  return null;
}
