import type { Registry, TokenRow } from "@/lib/burnticker/registry";
import { ruleOneLiner } from "@/lib/burnticker/coinCard";
import { coinCanonicalHref, coinKey, isMintKey, type CoinCandidate } from "@/lib/burnticker/coinKey";
export type { CoinCandidate } from "@/lib/burnticker/coinKey";

/**
 * Resolving a coin from a URL key (owner decision 2026-10-12: tickers are not unique; coinKey.ts has the keying rule). A mint resolves
 * to that coin. A ticker resolves to its one non-expired coin, to its one launched coin when the others sharing it are drafts, to the list when several share it, and (as before) to the newest expired
 * draft when only expired drafts carry it. Server side; the registry is the only input.
 */
export type CoinLookup = { kind: "one"; token: TokenRow } | { kind: "many"; ticker: string; tokens: TokenRow[] } | { kind: "none" };
type Reader = Pick<Registry, "token" | "tokenByTicker" | "tokensByTicker">;

const decode = (s: string): string => { try { return decodeURIComponent(s); } catch { return s; } };

export function lookupCoin(r: Reader, rawKey: string): CoinLookup {
  const key = decode(rawKey).trim();
  if (!key) return { kind: "none" };
  if (key.length >= 32 || isMintKey(key)) { const t = r.token(key); return t ? { kind: "one", token: t } : { kind: "none" }; }
  const held = r.tokensByTicker(key);
  // owner 2026-10-14 (/t/PHINFLWIN answered the chooser): a draft never shadows a launched coin. When exactly one of the coins on the
  // ticker is launched, the ticker opens it; the drafts stay reachable by their mints.
  const launched = held.filter((t) => t.status !== "draft");
  if (held.length > 1 && launched.length === 1) return { kind: "one", token: launched[0] };
  if (held.length > 1) return { kind: "many", ticker: key.toUpperCase(), tokens: held };
  if (held.length === 1) return { kind: "one", token: held[0] };
  const t = r.tokenByTicker(key);
  return t ? { kind: "one", token: t } : { kind: "none" };
}

/** Whether this coin's ticker is shared with another non-expired coin (its links then use the mint). */
export function tickerShared(r: Pick<Registry, "tokensByTicker">, t: Pick<TokenRow, "ticker">): boolean {
  try { return r.tokensByTicker(t.ticker).length > 1; } catch { return false; }
}

/** The coin's web key from the registry: its ticker while it alone holds it, its mint once shared (an expired draft whose ticker a live coin now holds is keyed by its mint). */
export function registryCoinKey(r: Pick<Registry, "tokensByTicker">, t: Pick<TokenRow, "ticker" | "mint"> & { status?: string }): string {
  if (t.status === "expired") { try { return r.tokensByTicker(t.ticker).length ? t.mint : t.ticker; } catch { return t.ticker; } }
  return coinKey(t, tickerShared(r, t));
}


export function candidateOf(r: Pick<Registry, "lockedRule">, t: TokenRow): CoinCandidate {
  let rule: string;
  try { rule = ruleOneLiner(r.lockedRule(t).rule); } catch { rule = t.description.split(/(?<=\.)\s/)[0] ?? ""; }
  return { mint: t.mint, ticker: t.ticker, name: t.name, creator: t.creator, status: t.status, rule: rule.replace(/^./, (c) => c.toUpperCase()), href: coinCanonicalHref(t.mint), api: `/api/burnticker/tokens/${encodeURIComponent(t.mint)}` };
}

/** The sentence an ambiguous ticker answers with (plain English; the mints are listed beside it). */
export const sharedTickerSentence = (ticker: string): string => `Several coins use the ticker $${ticker}. Each one is listed here with its mint address, and its page opens by that address.`;

/** The JSON body of a 300 answer for a shared ticker. */
export function sharedTickerBody(r: Pick<Registry, "lockedRule">, l: Extract<CoinLookup, { kind: "many" }>): { error: string; code: "ticker-shared"; ticker: string; candidates: CoinCandidate[] } {
  return { error: sharedTickerSentence(l.ticker), code: "ticker-shared", ticker: l.ticker, candidates: l.tokens.map((t) => candidateOf(r, t)) };
}

/** The plain-text refusal (CSV, images) for a shared ticker: the sentence, then one line per coin with its mint. */
export function sharedTickerText(l: Extract<CoinLookup, { kind: "many" }>): string {
  return [sharedTickerSentence(l.ticker), ...l.tokens.map((t) => `${t.name}: ${t.mint}`)].join("\n");
}

/**
 * WHETHER /burnticker/t/<key> HAS A PAGE (QA walkthrough 11 M13, 2026-10-13: an unknown ticker answered HTTP 200). The layout calls
 * notFound() when this is false. A coin the registry knows has a page, and so does a ticker several coins share (the chooser). So do the
 * pages that exist without a registry row: $DEFICIT's pre-launch page (PRELAUNCH_PAGE_TICKERS) and a disclosed rehearsal coin
 * (transparency.json `rehearsals`, by symbol or mint). A registry that cannot be read, or a rehearsal list that cannot be read (`served`
 * null), never turns into a 404: the page explains itself as before.
 */
export const PRELAUNCH_PAGE_TICKERS: readonly string[] = ["DEFICIT"];
export function coinPageFound(rawKey: string, lookup: (key: string) => CoinLookup, served: { tickers: readonly string[]; mints: readonly string[] } | null = { tickers: [], mints: [] }): boolean {
  const key = decode(rawKey).trim();
  if (!key) return false;
  const upper = key.toUpperCase();
  if (PRELAUNCH_PAGE_TICKERS.includes(upper)) return true;
  if (served && (served.tickers.some((t) => t.toUpperCase() === upper) || served.mints.includes(key))) return true;
  let l: CoinLookup;
  try { l = lookup(key); } catch { return true; }
  if (l.kind !== "none") return true;
  return served === null;
}

/**
 * Walkthrough 13 (2026-10-14): $DEFICIT by its mint answered 404, because $DEFICIT is served from its own keeper's files (the page at
 * /burnticker/t/DEFICIT) and is not a registry row on this host. Its created mint (config/own-tokens.json) now opens that page. Null for
 * any other key, and for $DEFICIT once the registry knows it (the registry's own lookup answers then).
 */
export function deficitMintTarget(rawKey: string, deficitMint: string | null | undefined, registryKnows: boolean): string | null {
  const key = decode(rawKey).trim();
  if (!deficitMint || registryKnows || key !== deficitMint) return null;
  return "/burnticker/t/DEFICIT";
}

/** The coin page's title when the share preview does not set one: the coin's name and ticker, or the ticker as written. */
export function coinPageTitle(rawKey: string, l: CoinLookup | null): string {
  if (l?.kind === "one") return `${l.token.name} ($${l.token.ticker}) on Burnticker`;
  if (l?.kind === "many") return `$${l.ticker} on Burnticker`;
  const key = decode(rawKey).trim();
  return isMintKey(key) ? "A coin on Burnticker" : `$${key.toUpperCase()} on Burnticker`;
}
