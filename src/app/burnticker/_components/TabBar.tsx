"use client";

import { announceLaunchStart } from "@/lib/burnticker/launchStart";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { TABS, activeTab } from "./nav";
import { useLaunchAvailability } from "./useLaunchAvailability";
import { Icon } from "./Icon";

/**
 * THE PHONE TAB BAR (2026-10-10, launchpad conventions; global with Search since 2026-10-12, the owner's review item 16). Under 900 px a
 * fixed bar at the bottom of every page: Coins · Search · Launch · Seasons · Learn. The static pages print the same bar
 * (src/lib/burnticker/siteNav.mjs SITE_TABS). Search opens the coin list with its search box focused. Launch is stamped in the violet
 * only while creator launches are open. Hidden on wider screens, where the header carries the same links. Reads only the pathname.
 */
export function TabBar() {
  const active = activeTab(usePathname());
  const launchOpen = useLaunchAvailability().open;
  return (
    <nav className="bt-tabbar" aria-label="Burnticker sections">
      {TABS.map((t) => (
        <Link key={t.href} href={t.href} className={`bt-tabbar-item${active === t.href ? " is-active" : ""}${t.href === "/burnticker/launch" && launchOpen ? " is-launch" : ""}`} aria-label={t.name} aria-current={active === t.href ? "page" : undefined} onClick={() => announceLaunchStart(t.href)}>
          <span aria-hidden="true" className="bt-tabbar-glyph"><Icon name={t.icon} /></span>
          <span>{t.label}</span>
        </Link>
      ))}
    </nav>
  );
}
