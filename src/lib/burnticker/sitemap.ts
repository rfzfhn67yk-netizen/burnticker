import { LEAGUES, seasonYearAt, type LeagueId } from "@/lib/burnticker/sources/espn";
import { coinSeason, leaguePath, LEAGUES_PATH } from "@/lib/burnticker/leagues";
import type { SeasonCoinInput } from "@/lib/burnticker/seasons";
import { coinPageHref, sharedTickers } from "@/lib/burnticker/coinKey";

/**
 * THE SITEMAP (growth batch 2026-10-10): /sitemap.xml (Caddy rewrites the apex path to /burnticker/sitemap.xml). Lists the public pages
 * a search engine should know: the app's own pages, the docs (the docs page, the whitepaper, the OpenAPI document), every launched
 * coin's page (live, paused, retired — never a draft), every rivalry pair, the leagues index and each league's current season plus any
 * season that has coins. Embed pages and badges are not listed (they are noindex). Pure: the route feeds it the registry's rows.
 */

export interface SitemapEntry { loc: string; lastmod?: string; changefreq?: "hourly" | "daily" | "weekly" | "monthly"; priority?: number }
export interface SitemapInput { origin: string; nowMs: number; coins: readonly { ticker: string; mint?: string; status: string; at: number }[]; pairs: readonly { pairId: string }[]; seasonCoins: readonly SeasonCoinInput[] }

export const STATIC_PAGES: { path: string; changefreq: SitemapEntry["changefreq"]; priority: number }[] = [
  { path: "/", changefreq: "daily", priority: 1 },
  { path: "/burnticker", changefreq: "hourly", priority: 0.9 },
  { path: "/burnticker/launch", changefreq: "weekly", priority: 0.8 },
  { path: "/burnticker/about", changefreq: "monthly", priority: 0.7 },
  // website-14: the next result each coin waits for, and the devnet receipt walked through step by step
  { path: "/burnticker/upcoming", changefreq: "hourly", priority: 0.7 },
  { path: "/burnticker/how-a-burn-works", changefreq: "monthly", priority: 0.6 },
  { path: "/burnticker/rivalries", changefreq: "hourly", priority: 0.7 },
  { path: LEAGUES_PATH, changefreq: "daily", priority: 0.7 },
  { path: "/burnticker/derby", changefreq: "daily", priority: 0.5 },
  { path: "/burnticker/trust", changefreq: "weekly", priority: 0.6 },
  { path: "/burnticker/check", changefreq: "weekly", priority: 0.6 },
  { path: "/burnticker/verify", changefreq: "monthly", priority: 0.6 },
  { path: "/burnticker/not-burnticker", changefreq: "daily", priority: 0.5 },
  { path: "/burnticker/fees/ledger", changefreq: "weekly", priority: 0.4 },
  { path: "/burnticker/operator", changefreq: "monthly", priority: 0.4 },
  // polish-1: the terms and privacy pages
  { path: "/burnticker/terms", changefreq: "monthly", priority: 0.3 },
  { path: "/burnticker/privacy", changefreq: "monthly", priority: 0.3 },
  // the legitimacy pass (website-16): the walk-through, the history pages, the bounty and the press kit
  { path: "/burnticker/verify-yourself", changefreq: "weekly", priority: 0.5 },
  { path: "/burnticker/how-burns-settle", changefreq: "monthly", priority: 0.5 },
  { path: "/burnticker/history", changefreq: "weekly", priority: 0.4 },
  { path: "/burnticker/changelog", changefreq: "daily", priority: 0.4 },
  { path: "/burnticker/incidents", changefreq: "weekly", priority: 0.4 },
  { path: "/burnticker/bounty", changefreq: "weekly", priority: 0.4 },
  { path: "/burnticker/press", changefreq: "monthly", priority: 0.3 },
];
// audit 7 item 27: pages only (the OpenAPI document is JSON, linked from the docs page, not a page to index)
export const DOC_PAGES: string[] = ["/burnticker/docs", "/whitepaper.html", "/burnticker/templates"];

export function sitemapEntries(i: SitemapInput): SitemapEntry[] {
  const o = i.origin.replace(/\/$/, "");
  const today = new Date(i.nowMs).toISOString().slice(0, 10);
  const shared = sharedTickers(i.coins);   // tickers are not unique (owner 2026-10-12): a shared ticker is listed by mint
  const out: SitemapEntry[] = [
    ...STATIC_PAGES.map((s) => ({ loc: `${o}${s.path}`, changefreq: s.changefreq, priority: s.priority })),
    ...DOC_PAGES.map((p) => ({ loc: `${o}${p}`, changefreq: "weekly" as const, priority: 0.5 })),
    ...i.coins.filter((c) => c.status === "live" || c.status === "paused" || c.status === "retired").map((c) => ({ loc: `${o}${coinPageHref({ ticker: c.ticker, mint: c.mint ?? c.ticker }, shared)}`, lastmod: today, changefreq: (c.status === "retired" ? "weekly" : "daily") as SitemapEntry["changefreq"], priority: 0.6 })),
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
