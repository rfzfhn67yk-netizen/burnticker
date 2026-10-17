import { platform } from "@/lib/burnticker/server";
import { coinSeason, leagueOgSvg, resolveLeagueSeason } from "@/lib/burnticker/leagues";
import { leagueData } from "@/lib/burnticker/leaguesServe";
import { LEAGUES } from "@/lib/burnticker/sources/espn";

export const dynamic = "force-dynamic";

/** GET /burnticker/leagues/<league>/<season>/og — the page's 1200 × 630 OpenGraph image (receipt-slip style, PNG through sharp). */
export async function GET(_req: Request, { params }: { params: Promise<{ league: string; season: string }> }) {
  const { league, season } = await params;
  const r = resolveLeagueSeason(league, season);
  if (!r) return new Response("not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  let coins = 0, receipts = 0;
  try {
    const d = leagueData(platform());
    const mine = d.coins.filter((c) => { const s = coinSeason(c); return s !== null && s.league === r.league && s.year === r.year; });
    coins = mine.length; receipts = mine.reduce((a, c) => a + c.burns.length, 0);
  } catch { /* the card still renders, with zeros */ }
  const svg = leagueOgSvg({ league: LEAGUES[r.league].label, season: season, coins, receipts });
  const sharp = (await import("sharp")).default;
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  return new Response(new Uint8Array(png), { status: 200, headers: { "content-type": "image/png", "cache-control": "public, max-age=3600", "x-content-type-options": "nosniff" } });
}
