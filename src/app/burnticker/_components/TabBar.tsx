"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { TABS, activeTab } from "./nav";
import { useLaunchAvailability } from "./useLaunchAvailability";

/**
 * THE PHONE TAB BAR (2026-10-10, launchpad conventions: Bags and pump.fun's app keep the main sections one thumb away). Under 900 px a
 * fixed bar at the bottom — Coins · Launch · Seasons · Trust — with Launch stamped in the violet; hidden on wider screens, where the
 * header row carries the same links. Reads only the pathname.
 */
export function TabBar() {
  const active = activeTab(usePathname());
  // audit 4 BT-10: Launch is stamped only while creator launches are open (the header does the same)
  const launchOpen = useLaunchAvailability().open;
  return (
    <nav className="bt-tabbar" aria-label="Burnticker sections">
      {TABS.map((t) => (
        <Link key={t.href} href={t.href} className={`bt-tabbar-item${active === t.href ? " is-active" : ""}${t.href === "/burnticker/launch" && launchOpen ? " is-launch" : ""}`} aria-current={active === t.href ? "page" : undefined}>
          <span aria-hidden="true" className="bt-tabbar-glyph">{t.glyph}</span>
          <span>{t.label}</span>
        </Link>
      ))}
    </nav>
  );
}
