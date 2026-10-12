/**
 * THE BURNTICKER SITE NAVIGATION (the owner, 2026-10-10: the app keeps the Burnticker branding and nothing of any other product). Since
 * 2026-10-11 (site audit #6, R06, BT-22) the list itself is src/lib/burnticker/siteNav.mjs — shared with the static home, the whitepaper
 * and the $DEFICIT site so every surface prints the same links in the same order. This file adds the app's active-section matching.
 */
import { DEFICIT_SITE } from "@/lib/burnticker/creatorLaunches";
import { SEASONS_HREF } from "@/lib/burnticker/currentStatusLinks";
import { SITE_NAV, SITE_FOOTER_EXTRA, LAUNCH_LABELS, SEASONS_NAV } from "@/lib/burnticker/siteNav.mjs";

/** `external`: another origin (new tab, ↗); `static`: a page the static site serves (a plain <a>, not a client-side Link). */
export interface NavItem { label: string; href: string; external?: boolean; static?: boolean; launch?: boolean; /** the header's active match: the href itself plus these prefixes */ match?: string[] }

const MATCH: Record<string, string[]> = {
  "/burnticker/launch": ["/burnticker/templates", "/burnticker/me"],
  "/burnticker": ["/burnticker/t/"],
  // "Seasons" lands on the per-league index (the owner, 2026-10-10: the landing door and the nav go to the same place); the all-seasons
  // scoreboard (/burnticker/rivalries), the Derby, league pages and pair pages belong to it
  [SEASONS_HREF]: ["/burnticker/rivalries", "/burnticker/derby", "/burnticker/p/"],
};
const toItem = (l: { label: string; href: string; kind: string; launch?: boolean }): NavItem => ({
  label: l.label, href: l.kind === "external" && l.label === "$DEFICIT" ? DEFICIT_SITE : l.href,
  ...(l.kind === "external" ? { external: true } : {}), ...(l.kind === "static" ? { static: true } : {}), ...(l.launch ? { launch: true } : {}),
  ...(MATCH[l.href] ? { match: MATCH[l.href] } : {}),
});
export const NAV: NavItem[] = SITE_NAV.map(toItem);
export const FOOTER_EXTRA: NavItem[] = SITE_FOOTER_EXTRA.map(toItem);
export const SEASONS_LINKS: NavItem[] = SEASONS_NAV.map(toItem);
export { LAUNCH_LABELS };

/** The landing page (the static site Caddy serves at the root; in the app itself `/` redirects to /burnticker). */
export const HOME_HREF = "/";
export const X_HREF = "https://x.com/burnticker";
export const API_BASE_PATH = "/api/burnticker/v1";

/** Which entry is current for a pathname: the exact href, or the longest matching prefix. "/burnticker" is exact-only. */
export function activeNav(pathname: string | null): string | null {
  if (!pathname) return null;
  const p = pathname.replace(/\/+$/, "") || "/";
  let best: { href: string; len: number } | null = null;
  for (const n of NAV) {
    if (n.external || n.static) continue;
    const cands = [n.href, ...(n.match ?? [])];
    for (const c of cands) {
      const hit = c === n.href ? (p === c || (c !== "/burnticker" && p.startsWith(`${c}/`))) : p.startsWith(c);
      if (hit && (!best || c.length > best.len)) best = { href: n.href, len: c.length };
    }
  }
  return best?.href ?? null;
}

/** The phone tab bar (TabBar.tsx, under 900 px): the four sections a launchpad user reaches with a thumb. */
export interface TabItem { label: string; href: string; glyph: string }
export const TABS: TabItem[] = [
  { label: "Coins", href: "/burnticker", glyph: "▦" },
  { label: "Launch", href: "/burnticker/launch", glyph: "+" },
  { label: "Seasons", href: SEASONS_HREF, glyph: "⇄" },
  { label: "Trust", href: "/burnticker/trust", glyph: "✓" },
];

/** Which tab is current: the nav's own matching (a coin page belongs to Coins, a pair page to Seasons); Docs/API has no tab. */
export function activeTab(pathname: string | null): string | null {
  const a = activeNav(pathname);
  return a && TABS.some((t) => t.href === a) ? a : null;
}

/**
 * Which footer a page gets (site audit #17): list pages — the leagues index and league pages, Scoreboards, the Derby — print the one-line
 * footer; Coins, Launch, coin and pair pages and every other page keep the full disclosure slip.
 */
const COMPACT_FOOTER = ["/burnticker/leagues", "/burnticker/rivalries", "/burnticker/derby"];
export function footerVariant(pathname: string | null): "full" | "compact" {
  const p = (pathname ?? "").replace(/\/+$/, "");
  return COMPACT_FOOTER.some((c) => p === c || p.startsWith(`${c}/`)) ? "compact" : "full";
}
