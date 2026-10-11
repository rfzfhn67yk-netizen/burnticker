/**
 * THE BURNTICKER SITE NAVIGATION (the owner, 2026-10-10: the app keeps the Burnticker branding and nothing of any other product).
 * One table, read by the header (desktop row + phone menu) and asserted by test/burntickerShell.test.ts: every entry is a Burnticker
 * page, the $DEFICIT site, or the public API — never another app's route.
 */
import { DEFICIT_SITE } from "@/lib/burnticker/creatorLaunches";

export interface NavItem { label: string; href: string; external?: boolean; /** the header's active match: the href itself plus these prefixes */ match?: string[] }

export const NAV: NavItem[] = [
  { label: "Launch", href: "/burnticker/launch", match: ["/burnticker/templates", "/burnticker/me"] },
  { label: "Coins", href: "/burnticker", match: ["/burnticker/t/"] },
  // "Seasons" lands on the per-league index (the owner, 2026-10-10: the landing door and the nav go to the same place); the all-seasons
  // scoreboard (/burnticker/rivalries), league pages and pair pages belong to it
  { label: "Seasons", href: "/burnticker/leagues", match: ["/burnticker/rivalries", "/burnticker/p/"] },
  { label: "Trust", href: "/burnticker/trust" },
  { label: "$DEFICIT", href: DEFICIT_SITE, external: true },
  { label: "Docs/API", href: "/burnticker/docs" },
];

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
    if (n.external) continue;
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
  { label: "Seasons", href: "/burnticker/leagues", glyph: "⇄" },
  { label: "Trust", href: "/burnticker/trust", glyph: "✓" },
];

/** Which tab is current: the nav's own matching (a coin page belongs to Coins, a pair page to Seasons); Docs/API has no tab. */
export function activeTab(pathname: string | null): string | null {
  const a = activeNav(pathname);
  return a && TABS.some((t) => t.href === a) ? a : null;
}
