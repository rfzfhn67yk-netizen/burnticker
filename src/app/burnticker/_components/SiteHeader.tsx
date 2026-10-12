"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { NAV, LEARN, HOME_HREF, LAUNCH_LABELS, activeNav, inLearn, type NavItem } from "./nav";
import { useSiteLaunchState } from "./useSiteLaunchState";
import { THEME_KEY, currentTheme, type Theme } from "./theme";
import { ActivityTicker } from "./ActivityTicker";
import { LaunchClosedModal } from "./LaunchClosedModal";
import { SEARCH } from "@/lib/burnticker/siteNav.mjs";
import { WalletButton } from "./WalletButton";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { WALLET_COPY } from "@/lib/burnticker/walletShell";

/**
 * THE BURNTICKER HEADER (B1 "thermal receipt", 2026-10-10; the launchpad skeleton since 2026-10-12, the owner's review items 3, 4 and
 * 11): the mark and wordmark, the primary links Coins · Seasons · Launch with a Learn menu, a search box for the coin list, "Launch a
 * coin" as the one primary button, the real "Connect wallet" to its right (WalletButton, website-13: the one shell-wide wallet provider;
 * it opens "Your coins" and never depends on the launch state), the light/dark switch, a MENU toggle under 900 px (it also carries the
 * wallet button on phones), and the activity line under the row. Every word comes from src/lib/burnticker/siteNav.mjs, which the static pages render too.
 *
 * "Launch a coin" goes to the launch page while creator launches are open. While they are closed (or the state cannot be read) it opens
 * the closed-launches dialog instead: no date, no waitlist, a link to the coins (brief rule 1).
 *
 * The phone menu (site audit #16, 2026-10-11): opens and closes from the keyboard (Enter/Space on MENU), moves focus to its first link,
 * keeps Tab and Shift+Tab inside the menu and its MENU button while open, closes on Escape (focus back on MENU), on a click outside and
 * on navigation. Reads only the pathname and the launch state.
 */
function NavLink({ item, active, onNavigate }: { item: NavItem; active: boolean; onNavigate?: () => void }) {
  if (item.external) return <a className="bt-nav-link" href={item.href} target="_blank" rel="noopener" onClick={onNavigate}>{item.label}<span aria-hidden="true" className="bt-ext">↗</span><span className="sr-only"> (opens a new tab)</span></a>;
  if (item.static) return <a className="bt-nav-link" href={item.href} onClick={onNavigate}>{item.label}</a>;
  return <Link className={`bt-nav-link${active ? " is-active" : ""}`} href={item.href} aria-current={active ? "page" : undefined} onClick={onNavigate} {...(item.launch ? { "data-launch-link": true } : {})}>{item.label}</Link>;
}

/** The Learn menu: a button and a list, closed by Escape, a click outside or a navigation. */
function LearnMenu({ active, current }: { active: string | null; current: boolean }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const onClick = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("keydown", onKey); document.addEventListener("mousedown", onClick);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("mousedown", onClick); };
  }, [open]);
  return (
    <div className="bt-learn" ref={box}>
      <button type="button" className={`bt-nav-link${current ? " is-active" : ""}`} aria-expanded={open} aria-controls="bt-learn-menu" onClick={() => setOpen((o) => !o)}>Learn<span aria-hidden="true" className="bt-ext">▾</span></button>
      <div id="bt-learn-menu" className="bt-learn-menu" hidden={!open}>
        {LEARN.map((n) => <NavLink key={n.href} item={n} active={active === n.href} onNavigate={() => setOpen(false)} />)}
      </div>
    </div>
  );
}

export function SiteHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const active = activeNav(pathname);
  // website-12's site launch record: the wizard link when the wizard may render, else the dialog with the record's sentence
  const launch = useSiteLaunchState();
  const launchOpen = launch.wizard;
  const [open, setOpen] = useState(false);
  const [modal, setModal] = useState(false);
  const [theme, setTheme] = useState<Theme>("dark");
  useEffect(() => { setTheme(currentTheme()); }, []);
  useEffect(() => { setOpen(false); }, [pathname]);
  // the wallet list opened from the phone menu: close the menu so its focus trap does not hold the list's keyboard focus
  const walletList = useWalletModal().visible;
  useEffect(() => { if (walletList) setOpen(false); }, [walletList]);
  // a link to "#launch-closed" opens the dialog (the static pages use the same hash)
  useEffect(() => { if (window.location.hash === "#launch-closed") setModal(true); }, []);
  const menuBtn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    const links = () => Array.from(menu.current?.querySelectorAll<HTMLElement>("a[href],button") ?? []);
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

  // the header search filters the coin list: on the coins page in place (CoinsIndex listens), elsewhere by opening it with ?q=
  const search = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const q = String(new FormData(e.currentTarget).get("q") ?? "").trim();
    const url = q ? `/burnticker?q=${encodeURIComponent(q)}` : "/burnticker";
    if (pathname?.replace(/\/+$/, "") === "/burnticker") { window.history.replaceState(null, "", url); window.dispatchEvent(new CustomEvent("bt-search", { detail: q })); }
    else router.push(url);
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
          <LearnMenu active={active} current={inLearn(pathname)} />
        </nav>
        <form className="bt-search" role="search" action="/burnticker" method="get" onSubmit={search}>
          <label className="sr-only" htmlFor="bt-header-q">{SEARCH.label}</label>
          <input id="bt-header-q" name="q" type="search" placeholder={SEARCH.placeholder} autoComplete="off" />
        </form>
        <div className="bt-header-tools">
          {launchOpen
            ? <Link className="bt-launch-btn bt-launch-head" href="/burnticker/launch" data-launch-button>{LAUNCH_LABELS.button}</Link>
            : <button type="button" className="bt-launch-btn bt-launch-head" onClick={() => setModal(true)} aria-haspopup="dialog" data-launch-button>{LAUNCH_LABELS.button}</button>}
          <WalletButton />
          <button type="button" className="bt-icon-btn" onClick={toggleTheme} aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"} title={theme === "dark" ? "Light theme" : "Dark theme"}>
            {theme === "dark" ? "☀" : "☾"}
          </button>
          <button type="button" ref={menuBtn} className="bt-menu-btn" aria-expanded={open} aria-controls="bt-mobile-nav" onClick={() => setOpen((o) => !o)}>
            {open ? "CLOSE" : "MENU"}
          </button>
        </div>
      </div>
      <nav id="bt-mobile-nav" ref={menu} className={`bt-nav-mobile${open ? " is-open" : ""}`} aria-label="Burnticker (menu)" hidden={!open}>
        {[...NAV, ...LEARN].map((n) => <NavLink key={n.href} item={n} active={active === n.href} onNavigate={() => setOpen(false)} />)}
        <div className="bt-nav-wallet"><p>{WALLET_COPY.menuNote}</p><WalletButton variant="menu" /></div>
      </nav>
      <ActivityTicker />
      {modal && <LaunchClosedModal state={launch} onClose={() => { setModal(false); if (window.location.hash === "#launch-closed") window.history.replaceState(null, "", window.location.pathname + window.location.search); }} />}
    </header>
  );
}
