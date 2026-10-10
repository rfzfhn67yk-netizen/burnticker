import Link from "next/link";
import { OPERATOR_LINE, USE_OF_FEES } from "@/lib/burnticker/fees";
import { NAV, X_HREF, API_BASE_PATH } from "./nav";

/** The site-wide memecoin disclaimer (the token pages carry the per-coin DISCLAIMER_FOOTER and their rule on top of this). */
export const SITE_DISCLAIMER = "Memecoins are speculative and can go to zero. Burnticker coins pay nothing and promise nothing: a rule says what a coin's supply does when a settled public event says so — never what its price does. Nothing on this site is investment advice.";
export const SOURCES_LINE = "The public sources the rules read (U.S. Treasury, BLS, NOAA / NWS, ESPN, the FEC, JPL, Wikimedia, Polymarket and others) are not affiliated with and do not endorse any coin.";

/**
 * THE FOOTER (B1 "thermal receipt"): the slip the product prints — torn top edge, label/value rows, dashed rules — carrying the
 * disclaimer, the operator line from src/lib/burnticker/fees.ts (verbatim, so the footer and the trust page can never disagree) and the
 * site's own links. Server-rendered; no client state.
 */
export function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="bt-footer">
      <div className="bt-slip">
        <div className="bt-slip-head">
          <span className="bt-slip-title">BURNTICKER</span>
          <span className="bt-slip-sub">BURNS ON THE NEWS · RECEIPT FOR EVERY BURN</span>
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
          {NAV.map((n) => n.external ? <a key={n.href} href={n.href} rel="noopener">{n.label}</a> : <Link key={n.href} href={n.href}>{n.label}</Link>)}
          <a href={X_HREF} rel="me noopener" target="_blank">X · @burnticker</a>
        </nav>
        <p className="bt-slip-end">— {year} · KEEP THIS RECEIPT —</p>
      </div>
    </footer>
  );
}
