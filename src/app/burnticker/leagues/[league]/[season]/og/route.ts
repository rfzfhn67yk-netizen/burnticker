import { platform } from "@/lib/burnticker/server";
import { coinSeason, leagueOgSvg, resolveLeagueSeason } from "@/lib/burnticker/leagues";
import { leagueData } from "@/lib/burnticker/leaguesServe";
import { LEAGUES } from "@/lib/burnticker/sources/espn";
import { heavyRefusal, pageLimiter } from "@/lib/burnticker/api/http";

export const dynamic = "force-dynamic";

/**
 * Audit 2026-10-18 A-42: the PNG ran sharp on every request with no cache or limit. One rendering per league and season is kept for ten
 * minutes (the counts on the card move slowly; the answer is cached an hour downstream anyway), and a miss takes from the client's heavy
 * bucket.
 */
const OG_TTL_MS = 10 * 60_000;
const ogCache = new Map<string, { png: Uint8Array; at: number }>();
const OG_MAX = 200;

/** GET /burnticker/leagues/<league>/<season>/og — the page's 1200 × 630 OpenGraph image (receipt-slip style, PNG through sharp). */
export async function GET(req: Request, { params }: { params: Promise<{ league: string; season: string }> }) {
  const { league, season } = await params;
  const r = resolveLeagueSeason(league, season);
  if (!r) return new Response("not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  const key = `${r.league}|${r.year}|${season}`;
  const now = Date.now();
  const hit = ogCache.get(key);
  const png200 = (png: Uint8Array) => new Response(png as BodyInit, { status: 200, headers: { "content-type": "image/png", "cache-control": "public, max-age=3600", "x-content-type-options": "nosniff" } });
  if (hit && now - hit.at < OG_TTL_MS) return png200(hit.png);
  const refused = heavyRefusal(req, pageLimiter, now);
  if (refused) return refused;
  let coins = 0, receipts = 0;
  try {
    const d = leagueData(platform());
    const mine = d.coins.filter((c) => { const s = coinSeason(c); return s !== null && s.league === r.league && s.year === r.year; });
    coins = mine.length; receipts = mine.reduce((a, c) => a + c.burns.length, 0);
  } catch { /* the card still renders, with zeros */ }
  const svg = leagueOgSvg({ league: LEAGUES[r.league].label, season: season, coins, receipts });
  const sharp = (await import("sharp")).default;
  const png = new Uint8Array(await sharp(Buffer.from(svg)).png().toBuffer());
  if (ogCache.size >= OG_MAX) ogCache.clear();
  ogCache.set(key, { png, at: now });
  return png200(png);
}
