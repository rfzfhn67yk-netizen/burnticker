import "server-only";
import { publicOrigin } from "@/lib/burnticker/coinArt";
import { tokenPageData, type Platform } from "@/lib/burnticker/server";
import { findToken } from "@/lib/burnticker/api/v1";
import { registryCoinKey } from "@/lib/burnticker/coinLookup";
import { BADGE_CACHE_SEC, badgePayloadProblems, coinBadge, pairBadge, renderBadgeSvg, type BadgeJson, type SideInput } from "@/lib/burnticker/badge";
import type { TokenRow } from "@/lib/burnticker/registry";
import { safeParam } from "@/lib/burnticker/safeParam";

/**
 * Serving the receipt badge (badge.ts) from the registry: the coin page's own status + receipts (tokenPageData), one memo per
 * (coin or pair, origin) for BADGE_CACHE_SEC so a README that embeds the badge a thousand times costs one page build a minute. The SVG
 * is rendered from the JSON; the PNG through sharp (as the coin image is, coinArtServe.ts). Drafts and expired drafts are not badged.
 */

const memo = new Map<string, { at: number; v: BadgeJson }>();
const MAX = 500;

async function side(p: Platform, t: TokenRow, origin: string, now: number): Promise<SideInput> {
  const d = await tokenPageData(p, t, now);
  return { status: d.status, receipts: d.receipts, rule: p.registry.lockedRule(t).rule, origin, now, key: registryCoinKey(p.registry, t) };
}

const badged = (t: TokenRow | null): t is TokenRow => !!t && t.status !== "draft" && t.status !== "expired";

/** A coin's badge payload, or null when there is no launched coin by that mint (or ticker, when one coin holds it; the route answers a shared ticker with the list). */
export async function coinBadgeData(p: Platform, id: string, origin: string, now = Date.now()): Promise<BadgeJson | null> {
  const t = findToken(p, id);
  if (!badged(t)) return null;
  const key = `coin:${t.mint}:${origin}`;
  const hit = memo.get(key);
  if (hit && now - hit.at < BADGE_CACHE_SEC * 1000) return hit.v;
  const v = coinBadge(await side(p, t, origin, now));
  remember(key, now, v);
  return v;
}

/** A rivalry pair's badge payload, or null when the pair does not exist or a side is not launched. */
export async function pairBadgeData(p: Platform, pairId: string, origin: string, now = Date.now()): Promise<BadgeJson | null> {
  const pair = p.registry.pair(pairId);
  if (!pair) return null;
  const a = p.registry.token(pair.mintA), b = p.registry.token(pair.mintB);
  if (!badged(a) || !badged(b)) return null;
  const key = `pair:${pairId}:${origin}`;
  const hit = memo.get(key);
  if (hit && now - hit.at < BADGE_CACHE_SEC * 1000) return hit.v;
  const [sa, sb] = await Promise.all([side(p, a, origin, now), side(p, b, origin, now)]);
  const v = pairBadge(pairId, sa, sb);
  remember(key, now, v);
  return v;
}

function remember(key: string, at: number, v: BadgeJson): void {
  const problems = badgePayloadProblems(v);
  if (problems.length) throw new Error(`badge payload carries market data: ${problems.join("; ")}`);
  if (memo.size > MAX) memo.clear();
  memo.set(key, { at, v });
}

/** For tests. */
export function clearBadgeMemo(): void { memo.clear(); }

/** `BRONCO.svg` → { id: "BRONCO", fmt: "svg" }; null for anything else. */
export function parseBadgeFile(file: string, idPattern = /^[A-Za-z0-9]{2,44}$/): { id: string; fmt: "svg" | "png" | "json" } | null {
  const m = /^(.+)\.(svg|png|json)$/.exec(safeParam(file));
  return m && idPattern.test(m[1]) ? { id: m[1], fmt: m[2] as "svg" | "png" | "json" } : null;
}

/** The badge in the requested format. */
export async function badgeBody(b: BadgeJson, fmt: "svg" | "png"): Promise<{ body: Uint8Array; type: string }> {
  const svg = renderBadgeSvg(b);
  if (fmt === "svg") return { body: new TextEncoder().encode(svg), type: "image/svg+xml; charset=utf-8" };
  const sharp = (await import("sharp")).default;
  return { body: new Uint8Array(await sharp(Buffer.from(svg), { density: 144 }).png().toBuffer()), type: "image/png" };
}

/**
 * The origin links in a badge point at: BURNTICKER_PUBLIC_ORIGIN when set (the public host), else the request's own origin unless that is
 * a loopback address (behind the proxy every request is http://localhost:3000; audit 2026-10-15 F8), which gets the public origin.
 */
export function badgeOrigin(req: Request, env: Readonly<Record<string, string | undefined>> = process.env): string {
  const pub = (env.BURNTICKER_PUBLIC_ORIGIN ?? "").trim().replace(/\/$/, "");
  if (/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(pub)) return pub;
  const u = new URL(req.url);
  return /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)$/i.test(u.hostname) ? publicOrigin(env) : u.origin;
}
