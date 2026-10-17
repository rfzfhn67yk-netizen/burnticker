import Link from "next/link";
import { OPERATOR_LINE, DEV_FEE_LINE } from "@/lib/burnticker/fees";
import { FOOTER_COPY, FOOTER_LEGAL_LINKS, FOOTER_ROWS } from "@/lib/burnticker/siteNav.mjs";
import { NAV, LEARN, API_BASE_PATH, type NavItem } from "./nav";
import { MailSafe } from "./MailSafe";
import { LinkedWords } from "./LinkedWords";

/**
 * THE FOOTER (B1 "thermal receipt"): the slip the product prints — torn top edge, label/value rows, dashed rules. Since 2026-10-12 (the
 * owner's review item 9, brief rule 5) it is the ONE place the disclaimers are printed: "Nothing is ever won. Things are only burned.",
 * the not-advice paragraph, the no-affiliation line and the sources line, all from src/lib/burnticker/siteNav.mjs FOOTER_COPY (the
 * static pages print the same words), plus the operator line from src/lib/burnticker/fees.ts verbatim, so the footer and the trust page
 * can never disagree. Server-rendered; no client state.
 */
/** One footer link, by the shared set's rules (siteNav.mjs): external → new tab + ↗; static → plain <a>; app → Link. */
export function FooterLink({ n }: { n: NavItem }) {
  if (n.external) return <a href={n.href} target="_blank" rel={n.href.startsWith("https://x.com/") ? "me noopener" : "noopener"}>{n.label}<span aria-hidden="true"> ↗</span></a>;
  if (n.static) return <a href={n.href}>{n.label}</a>;
  return <Link href={n.href}>{n.label}</Link>;
}

/**
 * site-polish-2 (2026-10-13): the slip is the static pages' slip row for row (siteNav.mjs shellFooterHtml): no tagline repeating the
 * hero, and each row one line plus a link to its detail (the private review: the footer repeated whole explanations on every page). The
 * full use-of-fees paragraph (USE_OF_FEES) is on the Trust page; the row prints its first line, DEV_FEE_LINE. The API row's address
 * answers (GET /api/burnticker/v1, QA pass 9 item 10). No year: the server's clock never changes the slip.
 */
export function SiteFooter() {
  const R = FOOTER_ROWS;
  return (
    <footer className="bt-footer" id="disclosure">
      <div className="bt-slip">
        <div className="bt-slip-head">
          <span className="bt-slip-title">BURNTICKER</span>
        </div>
        <div className="bt-rule" />
        <p className="bt-slip-text bt-slip-never"><b>{FOOTER_COPY.never}</b></p>
        <p className="bt-slip-text"><b>*** NOT ADVICE ***</b> {FOOTER_COPY.notAdvice}</p>
        <p className="bt-slip-text">{FOOTER_COPY.affiliation} {FOOTER_COPY.chain}</p>
        <p className="bt-slip-text bt-slip-dim">{FOOTER_COPY.sources}</p>
        <p className="bt-slip-text"><LinkedWords text={FOOTER_COPY.legal} links={FOOTER_LEGAL_LINKS} /></p>
        <div className="bt-rule" />
        <dl className="bt-rows">
          <div><dt>{R.operator.label}</dt><dd><span data-operator-line><MailSafe text={OPERATOR_LINE} /></span> <Link href={R.operator.href}>{R.operator.more}</Link></dd></div>
          <div><dt>{R.fees.label}</dt><dd><span data-fee-line>{DEV_FEE_LINE}</span> <Link href={R.fees.href}>{R.fees.more}</Link></dd></div>
          <div><dt>{R.api.label}</dt><dd><a href={API_BASE_PATH}>{API_BASE_PATH}</a> · <Link href={R.api.href}>{R.api.more}</Link></dd></div>
        </dl>
        <div className="bt-rule" />
        <nav className="bt-slip-links" aria-label="Footer">
          {[...NAV, ...LEARN].map((n) => <FooterLink key={n.href} n={n} />)}
        </nav>
        <p className="bt-slip-end">— {R.end} —</p>
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
      <p><b>Not advice.</b> Memecoins can go to zero. A coin&apos;s rule describes what happens to its supply, never its price. {FOOTER_COPY.never} {FOOTER_COPY.affiliation} <MailSafe text={OPERATOR_LINE} />. <Link href="/burnticker#disclosure">Full disclosure</Link></p>
      <nav aria-label="Footer">{[...NAV, ...LEARN].map((n) => <FooterLink key={n.href} n={n} />)}</nav>
    </footer>
  );
}
