import Link from "next/link";
import { SEASONS_LINKS } from "./nav";

/**
 * THE PAGES UNDER SEASONS, NAMED THE SAME EVERYWHERE (BT-22, 2026-10-11): Leagues (/burnticker/leagues), Scoreboards
 * (/burnticker/rivalries — every league's board, plus rivalry pairs) and Burn Derby (/burnticker/derby). From siteNav.mjs SEASONS_NAV, so
 * the home page, the headings and these tabs cannot drift apart. Server-rendered; `current` is the page's own href.
 */
export function SeasonsTabs({ current }: { current: string }) {
  return (
    <nav aria-label="Seasons" className="flex flex-wrap gap-1 text-xs font-mono uppercase tracking-wider" data-seasons-tabs>
      {SEASONS_LINKS.map((l) => (
        <Link key={l.href} href={l.href} aria-current={l.href === current ? "page" : undefined}
          className={`rounded border px-2 py-1 ${l.href === current ? "border-neutral-400 text-neutral-100" : "border-neutral-800 text-neutral-400 hover:text-neutral-100"}`}>{l.label}</Link>
      ))}
    </nav>
  );
}
