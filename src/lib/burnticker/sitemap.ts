import { LEAGUES, seasonYearAt, type LeagueId } from "@/lib/burnticker/sources/espn";
import { coinSeason, leaguePath, LEAGUES_PATH } from "@/lib/burnticker/leagues";
import type { SeasonCoinInput } from "@/lib/burnticker/seasons";

/**
 * THE SITEMAP (growth batch 2026-10-10): /sitemap.xml (Caddy rewrites the apex path to /burnticker/sitemap.xml). Lists the public pages
 * a search engine should know: the app's own pages, the docs (the docs page, the whitepaper, the OpenAPI document), every launched
 * coin's page (live, paused, retired — never a draft), every rivalry pair, the leagues index and each league's current season plus any
 * season that has coins. Embed pages and badges are not listed (they are noindex). Pure: the route feeds it the registry's rows.
 */

export interface SitemapEntry { loc: string; lastmod?: string; changefreq?: "hourly" | "daily" | "weekly" | "monthly"; priority?: number }
export interface SitemapInput { origin: string; nowMs: number; coins: readonly { ticker: string; status: string; at: number }[]; pairs: readonly { pairId: string }[]; seasonCoins: readonly SeasonCoinInput[] }

export const STATIC_PAGES: { path: string; changefreq: SitemapEntry["changefreq"]; priority: number }[] = [
  { path: "/", changefreq: "daily", priority: 1 },
  { path: "/burnticker", changefreq: "hourly", priority: 0.9 },
  { path: "/burnticker/launch", changefreq: "weekly", priority: 0.8 },
  { path: "/burnticker/about", changefreq: "monthly", priority: 0.7 },
  { path: "/burnticker/rivalries", changefreq: "hourly", priority: 0.7 },
  { path: LEAGUES_PATH, changefreq: "daily", priority: 0.7 },
  { path: "/burnticker/derby", changefreq: "daily", priority: 0.5 },
  { path: "/burnticker/trust", changefreq: "weekly", priority: 0.6 },
  { path: "/burnticker/check", changefreq: "weekly", priority: 0.6 },
  { path: "/burnticker/verify", changefreq: "monthly", priority: 0.6 },
  { path: "/burnticker/not-burnticker", changefreq: "daily", priority: 0.5 },
  { path: "/burnticker/fees/ledger", changefreq: "weekly", priority: 0.4 },
  { path: "/burnticker/operator", changefreq: "monthly", priority: 0.4 },
];
export const DOC_PAGES: string[] = ["/burnticker/docs", "/whitepaper.html", "/api/burnticker/v1/openapi.json"];

export function sitemapEntries(i: SitemapInput): SitemapEntry[] {
  const o = i.origin.replace(/\/$/, "");
  const today = new Date(i.nowMs).toISOString().slice(0, 10);
  const out: SitemapEntry[] = [
    ...STATIC_PAGES.map((s) => ({ loc: `${o}${s.path}`, changefreq: s.changefreq, priority: s.priority })),
    ...DOC_PAGES.map((p) => ({ loc: `${o}${p}`, changefreq: "weekly" as const, priority: 0.5 })),
    ...i.coins.filter((c) => c.status === "live" || c.status === "paused" || c.status === "retired").map((c) => ({ loc: `${o}/burnticker/t/${encodeURIComponent(c.ticker)}`, lastmod: today, changefreq: (c.status === "retired" ? "weekly" : "daily") as SitemapEntry["changefreq"], priority: 0.6 })),
    ...i.pairs.map((p) => ({ loc: `${o}/burnticker/p/${encodeURIComponent(p.pairId)}`, changefreq: "daily" as const, priority: 0.5 })),
  ];
  const seasons = new Set<string>();
  for (const id of Object.keys(LEAGUES) as LeagueId[]) seasons.add(leaguePath(id, seasonYearAt(id, i.nowMs)));
  for (const c of i.seasonCoins) { const s = coinSeason(c); if (s) seasons.add(leaguePath(s.league, s.year)); }
  for (const p of [...seasons].sort()) out.push({ loc: `${o}${p}`, changefreq: "daily", priority: 0.5 });
  return out;
}

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
export function sitemapXml(entries: readonly SitemapEntry[]): string {
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
    ...entries.map((e) => `<url><loc>${xml(e.loc)}</loc>${e.lastmod ? `<lastmod>${e.lastmod}</lastmod>` : ""}${e.changefreq ? `<changefreq>${e.changefreq}</changefreq>` : ""}${e.priority !== undefined ? `<priority>${e.priority.toFixed(1)}</priority>` : ""}</url>`),
    `</urlset>`,
    "",
  ].join("\n");
}
