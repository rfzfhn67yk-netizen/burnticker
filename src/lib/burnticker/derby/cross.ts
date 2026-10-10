import type { FetchLike } from "@/lib/burnticker/oracle/types";
import { numToDec } from "@/lib/burnticker/units";

/**
 * THE CROSS-READ (2026-10-10): an independent operator's value for each coin, read at the same window boundaries, so one source cannot
 * decide a burn alone. Disagreement above DERBY_DISAGREEMENT_PP on the winner-determining margin withholds the window (no reading, no
 * burn, an alert). Two adapters, chosen per coin by the rule's `cross` locator:
 *
 *   jup:<mint>                       Jupiter's price API — `https://lite-api.jup.ag/price/v3?ids=<mint>` → { <mint>: { usdPrice, liquidity,
 *                                    blockId, decimals } }. (The brief named `api.jup.ag/price/v2`; on 2026-10-10 that path answered
 *                                    404 and lite-api's v2 "Route not found" — v3 is the live keyless path.)
 *   dexscreener:<chainId>:<address>  DexScreener — `https://api.dexscreener.com/latest/dex/tokens/<address>` → the deepest pair on that
 *                                    chain whose base token is the coin; priceUsd and liquidity.usd. (EVM-native coins such as SHIB.)
 *   redstone:<data feed id>          RedStone's keyless gateway — `https://oracle-gateway-1.a.redstone.finance/data-packages/latest/
 *                                    redstone-primary-prod` → every feed's latest signed data packages (one per signer; 1,010 feeds on
 *                                    2026-10-10: FX "EUR_FX", equities "AAPL", metals "XAU", oil "WTI.T", coins "SHIB"); the median of
 *                                    the packages whose signature RedStone reports valid. One ~2 MB read per sampler pass, shared.
 *
 * Both are SPOT reads with no history, so the keeper snapshots them at each boundary (derby/adapter.ts sampler, within
 * DERBY_SNAPSHOT_TOLERANCE_SEC) and the window's cross-read change is computed from those snapshots. Values are display-grade floats
 * turned into decimal strings for the record; they never set a burn on their own — they can only withhold one.
 *
 * The same Jupiter host serves the token search the wizard uses (`/tokens/v2/search?query=`), which also carries a coin's X link when
 * its metadata has one (the derby post's @handles).
 */

export const JUP_PRICE_URL = "https://lite-api.jup.ag/price/v3";
export const JUP_SEARCH_URL = "https://lite-api.jup.ag/tokens/v2/search";
export const DEXSCREENER_TOKENS_URL = "https://api.dexscreener.com/latest/dex/tokens";

export const REDSTONE_LATEST_URL = "https://oracle-gateway-1.a.redstone.finance/data-packages/latest/redstone-primary-prod";

export interface CrossQuote { source: "jupiter" | "dexscreener" | "redstone"; usd: string; liquidityUsd: number | null; url: string; ref: string | null }

export function parseCross(locator: string): { kind: "jup"; mint: string } | { kind: "dexscreener"; chain: string; address: string } | { kind: "redstone"; feed: string } {
  const rs = /^redstone:([A-Za-z0-9._-]{1,40})$/.exec(locator);
  if (rs) return { kind: "redstone", feed: rs[1] };
  const j = /^jup:([1-9A-HJ-NP-Za-km-z]{32,44})$/.exec(locator);
  if (j) return { kind: "jup", mint: j[1] };
  const d = /^dexscreener:([a-z0-9-]{2,24}):([A-Za-z0-9]{20,64})$/.exec(locator);
  if (d) return { kind: "dexscreener", chain: d[1], address: d[2] };
  throw new Error(`not a cross-read locator: ${locator}`);
}

export const jupPriceUrl = (mint: string): string => `${JUP_PRICE_URL}?ids=${mint}`;
export const dexscreenerUrl = (address: string): string => `${DEXSCREENER_TOKENS_URL}/${address}`;

/** Jupiter v3 body → the coin's quote, or null. Pure. */
export function quoteFromJupiter(body: unknown, mint: string, url: string): CrossQuote | null {
  const row = (body as Record<string, { usdPrice?: number; liquidity?: number; blockId?: number } | null> | null)?.[mint];
  if (!row || typeof row.usdPrice !== "number" || !(row.usdPrice > 0)) return null;
  return { source: "jupiter", usd: numToDec(Number(row.usdPrice.toPrecision(12))), liquidityUsd: typeof row.liquidity === "number" ? row.liquidity : null, url, ref: row.blockId !== undefined ? `block:${row.blockId}` : null };
}

interface DsPair { chainId?: string; pairAddress?: string; priceUsd?: string; liquidity?: { usd?: number }; baseToken?: { address?: string } }
/** DexScreener body → the deepest pair on `chain` whose base token is `address`, or null. Pure. */
export function quoteFromDexscreener(body: unknown, chain: string, address: string, url: string): CrossQuote | null {
  const pairs = ((body as { pairs?: DsPair[] | null } | null)?.pairs ?? []).filter((p) => p.chainId === chain && (p.baseToken?.address ?? "").toLowerCase() === address.toLowerCase() && Number(p.priceUsd) > 0);
  const best = pairs.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
  if (!best) return null;
  return { source: "dexscreener", usd: numToDec(Number(Number(best.priceUsd).toPrecision(12))), liquidityUsd: best.liquidity?.usd ?? null, url, ref: best.pairAddress ? `pair:${best.pairAddress}` : null };
}

interface RsPackage { timestampMilliseconds?: number; isSignatureValid?: boolean; signerAddress?: string; dataPoints?: { dataFeedId?: string; value?: number }[] }
/** RedStone gateway body → the median of the valid-signature packages for one feed, or null. Pure. */
export function quoteFromRedstone(body: unknown, feed: string, url: string): CrossQuote | null {
  const pk = ((body as Record<string, RsPackage[] | undefined> | null)?.[feed] ?? []).filter((x) => x.isSignatureValid !== false);
  const vals = pk.map((x) => x.dataPoints?.find((d) => d.dataFeedId === feed)?.value).filter((v): v is number => typeof v === "number" && v > 0).sort((a, b) => a - b);
  if (!vals.length) return null;
  const mid = vals.length % 2 ? vals[(vals.length - 1) / 2] : (vals[vals.length / 2 - 1] + vals[vals.length / 2]) / 2;
  const ts = Math.max(...pk.map((x) => x.timestampMilliseconds ?? 0));
  return { source: "redstone", usd: numToDec(Number(mid.toPrecision(12))), liquidityUsd: null, url, ref: `signers:${vals.length}@${ts}` };
}

/** One spot read through the locator. Transport failures throw; an unknown coin returns null. `cache` shares the RedStone body in a pass. */
export async function crossQuote(fetchImpl: FetchLike, locator: string, cache: Map<string, unknown> = new Map()): Promise<CrossQuote | null> {
  const c = parseCross(locator);
  const url = c.kind === "jup" ? jupPriceUrl(c.mint) : c.kind === "dexscreener" ? dexscreenerUrl(c.address) : REDSTONE_LATEST_URL;
  let body = cache.get(url);
  if (body === undefined) {
    const res = await fetchImpl(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`${c.kind === "jup" ? "Jupiter" : c.kind === "dexscreener" ? "DexScreener" : "RedStone"} HTTP ${res.status}`);
    body = await res.json();
    if (c.kind === "redstone") cache.set(url, body);
  }
  return c.kind === "jup" ? quoteFromJupiter(body, c.mint, url) : c.kind === "dexscreener" ? quoteFromDexscreener(body, c.chain, c.address, url) : quoteFromRedstone(body, c.feed, url);
}

// ---- the wizard's coin search over Jupiter's token list ----

export interface JupToken { id: string; name: string; symbol: string; decimals: number; liquidity: number | null; isVerified: boolean; tags: string[]; twitter: string | null }

/** Jupiter search body → tokens (trimmed). Pure. */
export function tokensFromJupiter(body: unknown): JupToken[] {
  if (!Array.isArray(body)) return [];
  return body.filter((t) => t && typeof t.id === "string" && typeof t.symbol === "string").map((t) => ({ id: t.id, name: String(t.name ?? ""), symbol: String(t.symbol), decimals: Number(t.decimals ?? 0), liquidity: typeof t.liquidity === "number" ? t.liquidity : null, isVerified: t.isVerified === true, tags: Array.isArray(t.tags) ? t.tags.map(String) : [], twitter: typeof t.twitter === "string" ? t.twitter : null }));
}

/** An X handle from a profile link ("https://x.com/dogwifcoin" → "@dogwifcoin"); null for a status link, a search or anything else. */
export function handleFromLink(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = /^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/?(?:\?.*)?$/.exec(url.trim());
  if (!m || ["home", "search", "i", "intent", "share"].includes(m[1].toLowerCase())) return null;
  return `@${m[1]}`;
}

/** The display symbol Burn Derby uses for a token ("$WIF" → "WIF"); null when it is not 1–12 of A–Z/0–9 after that. */
export const derbySymbol = (s: string): string | null => { const x = s.trim().replace(/^\$/, "").toUpperCase(); return /^[A-Z0-9]{1,12}$/.test(x) ? x : null; };
