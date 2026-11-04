import fs from "node:fs";
import path from "node:path";

/**
 * THE OWN-TOKEN REFUSE LIST (2026-10-09 — the owner's first launch, $DEFICIT; SPEC §3 and §9.4: "Our trading bots are forbidden from
 * touching either token (hard-coded refuse list; the refusal reason names the policy)").
 *
 * config/own-tokens.json lists the coins we launch — by address once one exists, and by ticker from the day it is chosen. Every arm's
 * ENTRY path asks `ownTokenRefusal` before it buys (the rule's candidates and the owner's manual buys alike) and refuses with the
 * reason below. Exits are never asked: a coin already held (it cannot be, but if it were) must stay sellable, the same reason the
 * kill switch spares exits.
 *
 * WHY TICKERS TOO. Before launch the mint does not exist; the list must work from the moment the name is chosen. And after launch, a
 * copycat under our ticker is still a coin no bot of ours should be seen buying. So a symbol on the list refuses every coin with that
 * symbol, on every chain — a handful of unrelated coins missed is the cost, and it is a cheap one.
 *
 * FAIL CLOSED. A missing file is an empty list (a fresh checkout trades as before); a file that exists but cannot be read or parsed
 * refuses EVERY entry until it is fixed — the list exists to prevent one specific embarrassment, and a typo must not switch it off.
 * The file is re-read when its mtime changes, so adding the mint on launch day needs no restart.
 */

export const OWN_TOKEN_REASON = "own token — policy: our bots never trade our launches";
export const OWN_TOKENS_FILE_DEFAULT = path.join("config", "own-tokens.json");

export interface OwnTokenEntry {
  symbol: string;
  chain: "solana" | "robinhood" | "bsc" | "base" | "arc";
  address: string | null;
  status: "planned" | "launched";
  note?: string;
}
export interface OwnTokenList { addresses: Set<string>; symbols: Set<string>; error: string | null }

/** Solana addresses are case-sensitive base58; EVM addresses compare lowercased. */
export const normalizeAddress = (a: string): string => (/^0x[0-9a-fA-F]{40}$/.test(a.trim()) ? a.trim().toLowerCase() : a.trim());

/** Parses the file's JSON; throws on any malformed entry (the caller turns that into refuse-all). */
export function parseOwnTokens(raw: unknown): OwnTokenList {
  const r = raw as { policy?: unknown; tokens?: unknown } | null;
  if (!r || typeof r !== "object" || !Array.isArray(r.tokens)) throw new Error("own-tokens.json: expected { policy, tokens: [...] }");
  const addresses = new Set<string>(), symbols = new Set<string>();
  for (const [k, t] of (r.tokens as unknown[]).entries()) {
    const e = t as Partial<OwnTokenEntry> | null;
    if (!e || typeof e.symbol !== "string" || !/^[A-Za-z0-9]{1,16}$/.test(e.symbol)) throw new Error(`own-tokens.json: tokens[${k}].symbol must be 1–16 letters/digits`);
    if (!["solana", "robinhood", "bsc", "base", "arc"].includes(String(e.chain))) throw new Error(`own-tokens.json: tokens[${k}].chain is not a known chain`);
    if (e.address !== null && e.address !== undefined) {
      const a = String(e.address).trim();
      const ok = e.chain === "solana" ? /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a) : /^0x[0-9a-fA-F]{40}$/.test(a);
      if (!ok) throw new Error(`own-tokens.json: tokens[${k}].address is not a ${e.chain} address`);
      addresses.add(normalizeAddress(a));
    }
    symbols.add(e.symbol.toUpperCase());
  }
  return { addresses, symbols, error: null };
}

/** The refusal for a coin, or null. A list that failed to load refuses everything (fail closed). */
export function ownTokenRefusalFrom(list: OwnTokenList, coin: { address?: string | null; symbol?: string | null }): string | null {
  if (list.error) return `${OWN_TOKEN_REASON} (the own-token list could not be read — every entry held until it is fixed: ${list.error})`;
  if (coin.address && list.addresses.has(normalizeAddress(coin.address))) return OWN_TOKEN_REASON;
  const sym = (coin.symbol ?? "").trim().replace(/^\$/, "").toUpperCase();
  if (sym && list.symbols.has(sym)) return OWN_TOKEN_REASON;
  return null;
}

/**
 * THE GENERATED LIST (2026-10-09, the Burnticker launchpad). Platform coins are registered in data/burnticker.db; the arms must not
 * open that database on the buy path, so the burnticker keeper writes data/own-tokens.generated.json (same shape: mint + ticker +
 * chain per registered token, drafts included) after every registry change, and this module merges it with the static file. The
 * static file stays authoritative for $DEFICIT and anything hand-added; the generated file only ever ADDS refusals. Both fail closed
 * on a parse error (a generated file is written atomically, so a broken one is a bug worth stopping for, not a race). OWN_TOKENS_GENERATED_PATH
 * overrides the path; a missing generated file means no platform coin yet.
 */
export const OWN_TOKENS_GENERATED_FILE_DEFAULT = path.join("data", "own-tokens.generated.json");

const EMPTY = (): OwnTokenList => ({ addresses: new Set(), symbols: new Set(), error: null });
const caches = new Map<string, { mtimeMs: number; list: OwnTokenList }>();

/** One file, cached by mtime: absent = empty; unreadable or malformed = an error (the caller refuses everything). */
function loadOneList(file: string, label: string): OwnTokenList {
  let st: fs.Stats;
  try { st = fs.statSync(file); } catch { return EMPTY(); }   // no file = no launches yet
  const c = caches.get(file);
  if (c && c.mtimeMs === st.mtimeMs) return c.list;
  let list: OwnTokenList;
  try { list = parseOwnTokens(JSON.parse(fs.readFileSync(file, "utf8"))); }
  catch (e) { const msg = (e instanceof Error ? e.message : String(e)).slice(0, 140); list = { addresses: new Set(), symbols: new Set(), error: label === "own-tokens.json" && msg.startsWith("own-tokens.json:") ? msg : `${label}: ${msg.replace(/^own-tokens\.json: /, "")}` }; }
  caches.set(file, { mtimeMs: st.mtimeMs, list });
  return list;
}

/** The union of two lists; an error in either is kept (fail closed), the static file's first. */
export function mergeOwnTokenLists(a: OwnTokenList, b: OwnTokenList): OwnTokenList {
  return { addresses: new Set([...a.addresses, ...b.addresses]), symbols: new Set([...a.symbols, ...b.symbols]), error: a.error ?? b.error ?? null };
}

/** Loads config/own-tokens.json (OWN_TOKENS_PATH overrides) merged with data/own-tokens.generated.json (OWN_TOKENS_GENERATED_PATH), each re-read when its file changes. */
export function loadOwnTokens(file = process.env.OWN_TOKENS_PATH?.trim() || path.resolve(process.cwd(), OWN_TOKENS_FILE_DEFAULT), generatedFile = process.env.OWN_TOKENS_GENERATED_PATH?.trim() || path.resolve(process.cwd(), OWN_TOKENS_GENERATED_FILE_DEFAULT)): OwnTokenList {
  return mergeOwnTokenLists(loadOneList(file, "own-tokens.json"), loadOneList(generatedFile, "own-tokens.generated.json"));
}

/** What every arm's entry path calls. */
export function ownTokenRefusal(coin: { address?: string | null; symbol?: string | null }): string | null {
  return ownTokenRefusalFrom(loadOwnTokens(), coin);
}
