"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV, HOME_HREF, LAUNCH_LABELS, activeNav, type NavItem } from "./nav";
import { useLaunchAvailability } from "./useLaunchAvailability";
import { THEME_KEY, currentTheme, type Theme } from "./theme";

/**
 * THE BURNTICKER HEADER (B1 "thermal receipt", 2026-10-10): the mark + wordmark on the left, the shared Burnticker link set
 * (src/lib/burnticker/siteNav.mjs — the same links in the same order as the home, the whitepaper and the $DEFICIT site) on the right,
 * a MENU toggle under 900 px and the light/dark switch (one `bt-theme` preference shared with the static pages, ./theme.ts).
 *
 * The phone menu (site audit #16, 2026-10-11): opens and closes from the keyboard (Enter/Space on MENU), moves focus to its first link,
 * keeps Tab and Shift+Tab inside the menu and its MENU button while open, closes on Escape (focus back on MENU), on a click outside and
 * on navigation. Reads only the pathname and the launch state.
 */
function NavLink({ item, active, onNavigate, launchOpen, inMenu }: { item: NavItem; active: boolean; onNavigate?: () => void; launchOpen: boolean; inMenu?: boolean }) {
  // audit 4 BT-10 / R06: Launch is always listed; emphasised only while creator launches are open, labelled "Launch · closed" otherwise
  if (item.launch) {
    const label = !launchOpen ? LAUNCH_LABELS.closed : inMenu ? LAUNCH_LABELS.open : LAUNCH_LABELS.openShort;
    return <Link className={`bt-nav-link${active ? " is-active" : ""}${launchOpen ? " is-launch" : ""}`} href={item.href} aria-current={active ? "page" : undefined} onClick={onNavigate} data-launch-link>{label}</Link>;
  }
  if (item.external) return <a className="bt-nav-link" href={item.href} target="_blank" rel="noopener" onClick={onNavigate}>{item.label}<span aria-hidden="true" className="bt-ext">↗</span><span className="sr-only"> (opens a new tab)</span></a>;
  if (item.static) return <a className="bt-nav-link" href={item.href} onClick={onNavigate}>{item.label}</a>;
  return <Link className={`bt-nav-link${active ? " is-active" : ""}`} href={item.href} aria-current={active ? "page" : undefined} onClick={onNavigate}>{item.label}</Link>;
}

export function SiteHeader() {
  const pathname = usePathname();
  const active = activeNav(pathname);
  const launchOpen = useLaunchAvailability().open;
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>("dark");
  useEffect(() => { setTheme(currentTheme()); }, []);
  useEffect(() => { setOpen(false); }, [pathname]);
  const menuBtn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    const links = () => Array.from(menu.current?.querySelectorAll<HTMLElement>("a[href]") ?? []);
    links()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); setOpen(false); menuBtn.current?.focus(); return; }
      if (e.key !== "Tab") return;
      // the focus trap: the menu's links and the MENU button form one loop while the menu is open
      const ring = [menuBtn.current, ...links()].filter((x): x is HTMLElement => !!x);
      const i = ring.indexOf(document.activeElement as HTMLElement);
      if (i === -1) { e.preventDefault(); ring[0]?.focus(); return; }
      const next = e.shiftKey ? (i - 1 + ring.length) % ring.length : (i + 1) % ring.length;
      e.preventDefault(); ring[next]?.focus();
    };
    const onClick = (e: MouseEvent) => { const t = e.target as Node; if (!menu.current?.contains(t) && !menuBtn.current?.contains(t)) setOpen(false); };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("mousedown", onClick); };
  }, [open]);

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
          {NAV.map((n) => <NavLink key={n.href} item={n} active={active === n.href} launchOpen={launchOpen} />)}
        </nav>
        <div className="bt-header-tools">
          <button type="button" className="bt-icon-btn" onClick={toggleTheme} aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"} title={theme === "dark" ? "Light theme" : "Dark theme"}>
            {theme === "dark" ? "☀" : "☾"}
          </button>
          <button type="button" ref={menuBtn} className="bt-menu-btn" aria-expanded={open} aria-controls="bt-mobile-nav" onClick={() => setOpen((o) => !o)}>
            {open ? "CLOSE" : "MENU"}
          </button>
        </div>
      </div>
      <nav id="bt-mobile-nav" ref={menu} className={`bt-nav-mobile${open ? " is-open" : ""}`} aria-label="Burnticker (menu)" hidden={!open}>
        {NAV.map((n) => <NavLink key={n.href} item={n} active={active === n.href} launchOpen={launchOpen} inMenu onNavigate={() => setOpen(false)} />)}
      </nav>
    </header>
  );
}
