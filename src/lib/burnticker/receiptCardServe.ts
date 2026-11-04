import { describeRule } from "@/lib/burnticker/describe";
import { rawToTokens } from "@/lib/burnKeeper/rules";
import { lookupCoin, sharedTickerText } from "@/lib/burnticker/coinLookup";
import { latestBurnLine, renderReceiptCardSvg } from "@/lib/burnticker/receiptCard";
import type { Registry, ReceiptRow, TokenRow } from "@/lib/burnticker/registry";
import { coinDerbyScoreboard } from "@/lib/burnticker/derby/page";

/**
 * Serving the receipt share card (receiptCard.ts) from the registry: GET /burnticker/img/receipt/<MINT or TICKER>.svg|.png. Read-only
 * from the coin's locked rule and its receipts (no chain read, no page build). Rendered once per (coin, newest burn, burn count, format)
 * and kept in memory, so the card changes exactly when a new burn is recorded. The URL by MINT is the stable one (the Open Graph image
 * and the embeddable widget use it); a ticker answers while one coin holds it, and a shared ticker answers 300 naming the mints.
 */
const ZERO = BigInt(0);
const cache = new Map<string, { body: Uint8Array; type: string }>();
const MAX = 500;

/** A coin's confirmed burns that burned tokens, oldest first. */
export const burnsOf = (rows: readonly ReceiptRow[]): ReceiptRow[] => rows.filter((r) => r.status === "confirmed" && (r.burnRaw ?? ZERO) > ZERO);

/** The card's data for one coin (also the coin page's metadata description). */
export function receiptCardData(registry: Registry, t: TokenRow, now = Date.now()): { ticker: string; sentence: string; latest: { tokens: string; day: string; eventId: string; signature: string | null } | null; burns: number; sha256: string; alt: string; scoreboard: string | null } {
  const locked = registry.lockedRule(t);
  const sentence = describeRule(locked.rule, { ticker: t.ticker }).oneLiner;
  const burns = burnsOf(registry.receipts(t.mint));
  const last = [...burns].sort((a, b) => (a.settledAt === b.settledAt ? (a.eventId < b.eventId ? -1 : 1) : a.settledAt < b.settledAt ? -1 : 1)).pop() ?? null;
  const latest = last ? { tokens: rawToTokens(last.burnRaw ?? ZERO, 6), day: last.settledAt.slice(0, 10), eventId: last.eventId, signature: last.signature } : null;
  // cheap-features item 12: a Coin vs Coin coin's card carries its pair's scoreboard line
  const scoreboard = t.selectorKey.startsWith("derby:") ? coinDerbyScoreboard(registry, t.mint, now)?.line ?? null : null;
  return { ticker: t.ticker, sentence, latest, burns: burns.length, sha256: locked.sha256, alt: `\$${t.ticker}. ${sentence} ${scoreboard ?? `${latestBurnLine(latest)}.`}`, scoreboard };
}

export async function receiptCardImage(o: { registry: Registry; file: string; now?: number }): Promise<{ status: number; body: Uint8Array | string; type: string }> {
  const m = /^([A-Za-z0-9]{2,44})\.(svg|png)$/.exec(o.file);
  if (!m) return { status: 404, body: "not found", type: "text/plain; charset=utf-8" };
  const [, name, fmt] = m;
  const l = lookupCoin(o.registry, name);
  if (l.kind === "many") return { status: 300, body: sharedTickerText(l), type: "text/plain; charset=utf-8" };
  if (l.kind === "none" || l.token.status === "draft" || l.token.status === "expired") return { status: 404, body: name.length >= 32 ? `no launched coin with the mint ${name}` : `no launched coin $${name.toUpperCase()}`, type: "text/plain; charset=utf-8" };
  const t = l.token;
  let d: ReturnType<typeof receiptCardData>;
  try { d = receiptCardData(o.registry, t, o.now); } catch (e) { return { status: 500, body: `rule: ${(e as Error).message.slice(0, 160)}`, type: "text/plain; charset=utf-8" }; }
  const key = `${t.mint}:${d.latest?.eventId ?? "-"}:${d.latest?.signature ?? "-"}:${d.burns}:${d.scoreboard ?? ""}:${fmt}`;
  const hit = cache.get(key);
  if (hit) return { status: 200, ...hit };
  const svg = renderReceiptCardSvg({ ticker: t.ticker, sentence: d.sentence, rule: o.registry.lockedRule(t).rule, sha256: d.sha256, latest: d.latest, burns: d.burns, scoreboard: d.scoreboard });
  let out: { body: Uint8Array; type: string };
  if (fmt === "svg") out = { body: new TextEncoder().encode(svg), type: "image/svg+xml" };
  else { const sharp = (await import("sharp")).default; out = { body: new Uint8Array(await sharp(Buffer.from(svg)).png().toBuffer()), type: "image/png" }; }
  if (cache.size > MAX) cache.clear();
  cache.set(key, out);
  return { status: 200, ...out };
}

/** The stable image URL for a coin (by mint): the Open Graph image, the X card and the embeddable widget. */
export const receiptCardPath = (mint: string, fmt: "png" | "svg" = "png"): string => `/burnticker/img/receipt/${encodeURIComponent(mint)}.${fmt}`;
/** For tests. */
export function clearReceiptCardCache(): void { cache.clear(); }
