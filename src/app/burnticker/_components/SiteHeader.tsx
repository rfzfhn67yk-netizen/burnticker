"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV, HOME_HREF, activeNav, type NavItem } from "./nav";

/**
 * THE BURNTICKER HEADER (B1 "thermal receipt", 2026-10-10): the mark + wordmark on the left, the site's own six links on the right,
 * a MENU toggle under 768 px, and the light/dark switch. No other product's navigation, state or data — it reads only the pathname.
 */
type Theme = "dark" | "light";
const THEME_KEY = "bt-theme";

function currentTheme(): Theme {
  if (typeof document === "undefined") return "dark";
  const set = document.documentElement.dataset.theme;
  if (set === "light" || set === "dark") return set;
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function NavLink({ item, active, onNavigate }: { item: NavItem; active: boolean; onNavigate?: () => void }) {
  const cls = `bt-nav-link${active ? " is-active" : ""}${item.href === "/burnticker/launch" ? " is-launch" : ""}`;
  if (item.external) return <a className={cls} href={item.href} rel="noopener">{item.label}<span aria-hidden="true" className="bt-ext">↗</span></a>;
  return <Link className={cls} href={item.href} aria-current={active ? "page" : undefined} onClick={onNavigate}>{item.label}</Link>;
}

export function SiteHeader() {
  const pathname = usePathname();
  const active = activeNav(pathname);
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>("dark");
  useEffect(() => { setTheme(currentTheme()); }, []);
  useEffect(() => { setOpen(false); }, [pathname]);

  const toggleTheme = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem(THEME_KEY, next); } catch { /* private window: the switch still works for this page */ }
    setTheme(next);
  };

  return (
    <header className="bt-header">
      <div className="bt-header-row">
        <a className="bt-brand" href={HOME_HREF} aria-label="Burnticker home">
          {/* eslint-disable-next-line @next/next/no-img-element -- a 96 px PNG; the image optimiser is not worth a request here */}
          <img src="/burnticker/brand/mark.png" width={34} height={34} alt="" className="bt-mark" />
          <span className="bt-wordmark">BURNTICKER</span>
        </a>
        <nav className="bt-nav-desktop" aria-label="Burnticker">
          {NAV.map((n) => <NavLink key={n.href} item={n} active={active === n.href} />)}
        </nav>
        <div className="bt-header-tools">
          <button type="button" className="bt-icon-btn" onClick={toggleTheme} aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"} title={theme === "dark" ? "Light theme" : "Dark theme"}>
            {theme === "dark" ? "☀" : "☾"}
          </button>
          <button type="button" className="bt-menu-btn" aria-expanded={open} aria-controls="bt-mobile-nav" onClick={() => setOpen((o) => !o)}>
            {open ? "CLOSE" : "MENU"}
          </button>
        </div>
      </div>
      <nav id="bt-mobile-nav" className={`bt-nav-mobile${open ? " is-open" : ""}`} aria-label="Burnticker (menu)" hidden={!open}>
        {NAV.map((n) => <NavLink key={n.href} item={n} active={active === n.href} onNavigate={() => setOpen(false)} />)}
      </nav>
    </header>
  );
}
