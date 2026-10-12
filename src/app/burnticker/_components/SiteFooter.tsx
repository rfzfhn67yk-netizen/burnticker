import Link from "next/link";
import { OPERATOR_LINE, USE_OF_FEES } from "@/lib/burnticker/fees";
import { NAV, FOOTER_EXTRA, API_BASE_PATH, type NavItem } from "./nav";

/** The site-wide memecoin disclaimer (the token pages carry the per-coin DISCLAIMER_FOOTER and their rule on top of this). */
export const SITE_DISCLAIMER = "Memecoins are speculative and can go to zero. Burnticker coins pay nothing and promise nothing: a rule says what a coin's supply does when a settled public event says so — never what its price does. Nothing on this site is investment advice.";
export const SOURCES_LINE = "The public sources the rules read (U.S. Treasury, BLS, NOAA and the National Weather Service, MLB, the NHL, the NBA, TheSportsDB, the FEC, JPL, Wikimedia, Polymarket and others) are not affiliated with and do not endorse any coin.";

/**
 * THE FOOTER (B1 "thermal receipt"): the slip the product prints — torn top edge, label/value rows, dashed rules — carrying the
 * disclaimer, the operator line from src/lib/burnticker/fees.ts (verbatim, so the footer and the trust page can never disagree) and the
 * site's own links. Server-rendered; no client state.
 */
/** One footer link, by the shared set's rules (siteNav.mjs): external → new tab + ↗; static → plain <a>; app → Link. */
export function FooterLink({ n }: { n: NavItem }) {
  if (n.external) return <a href={n.href} target="_blank" rel={n.href.startsWith("https://x.com/") ? "me noopener" : "noopener"}>{n.label}<span aria-hidden="true"> ↗</span></a>;
  if (n.static) return <a href={n.href}>{n.label}</a>;
  return <Link href={n.href}>{n.label}</Link>;
}

export function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="bt-footer" id="disclosure">
      <div className="bt-slip">
        <div className="bt-slip-head">
          <span className="bt-slip-title">BURNTICKER</span>
          <span className="bt-slip-sub">COINS THAT BURN ON REAL-WORLD RESULTS · WITH RECEIPTS</span>
        </div>
        <div className="bt-rule" />
        <p className="bt-slip-text"><b>*** NOT ADVICE ***</b> {SITE_DISCLAIMER}</p>
        <p className="bt-slip-text bt-slip-dim">{SOURCES_LINE}</p>
        <div className="bt-rule" />
        <dl className="bt-rows">
          <div><dt>OPERATOR</dt><dd>{OPERATOR_LINE}</dd></div>
          <div><dt>DEV FEE</dt><dd>{USE_OF_FEES}</dd></div>
          <div><dt>API</dt><dd><Link href="/burnticker/docs">{API_BASE_PATH}</Link></dd></div>
        </dl>
        <div className="bt-rule" />
        <nav className="bt-slip-links" aria-label="Footer">
          {[...NAV, ...FOOTER_EXTRA].map((n) => <FooterLink key={n.href} n={n} />)}
        </nav>
        <p className="bt-slip-end">— {year} · KEEP THIS RECEIPT —</p>
      </div>
    </footer>
  );
}

/**
 * THE ONE-LINE FOOTER (site audit #17, 2026-10-11) for list pages — Seasons/Leagues, Scoreboards, the Derby and league pages: the
 * not-advice line, the operator, the shared links and a link to the full disclosure (the slip above, printed on Coins, Launch and every
 * coin page). FooterSwitch picks it by pathname (nav.ts footerVariant).
 */
export function CompactFooter() {
  return (
    <footer className="bt-footer-compact" data-footer="compact">
      <p><b>Not advice.</b> Memecoins can go to zero. A coin&apos;s rule describes what happens to its supply, never its price. {OPERATOR_LINE}. <Link href="/burnticker#disclosure">Full disclosure</Link></p>
      <nav aria-label="Footer">{[...NAV, ...FOOTER_EXTRA].map((n) => <FooterLink key={n.href} n={n} />)}</nav>
    </footer>
  );
}
