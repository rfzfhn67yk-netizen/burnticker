import type { Metadata } from "next";
import Link from "next/link";
import { BOUNTY_COPY, SECURITY_CONTACT } from "@/lib/burnticker/historyCopy";
import { loadTransparency } from "@/lib/burnticker/trust";
import { PUBLIC_REPO_URL, PUBLIC_REPO_COMMIT } from "@/lib/burnticker/currentStatusLinks";
import { Page, PageHeader, Panel } from "../_components/Panel";
import { MailSafe } from "../_components/MailSafe";
import { BountyWallet } from "./BountyWallet";
import { withShareCard } from "@/lib/burnticker/pageMeta";

export const metadata: Metadata = withShareCard({ title: BOUNTY_COPY.title, description: BOUNTY_COPY.description, alternates: { canonical: "/burnticker/bounty" } });
export const dynamic = "force-dynamic";

/**
 * /burnticker/bounty (legitimacy pass item 3): scope, the bounty wallet and its live balance, the rule that each payment is posted in the
 * report's thread, the decided reports (empty is honest) and how to report. SECURITY.md stays the source of the terms; the range and the
 * contact are read from config/burnticker/transparency.json. /.well-known/security.txt names this page as its policy.
 */
export default function BountyPage() {
  let range: [number, number] | null = null, contact = SECURITY_CONTACT;
  try { const b = loadTransparency().howBuilt.bounty; range = b.rangeSol; contact = b.contact ?? SECURITY_CONTACT; } catch { range = null; }
  const terms = `${PUBLIC_REPO_URL}/blob/${PUBLIC_REPO_COMMIT}/SECURITY.md`;
  return (
    <Page>
      <PageHeader title={BOUNTY_COPY.title} intro={BOUNTY_COPY.intro}>
        <p className="bt-body-text">{BOUNTY_COPY.draft}{range ? <> {BOUNTY_COPY.range(range[0], range[1])}</> : null}</p>
      </PageHeader>
      <Panel title={BOUNTY_COPY.howTitle} id="report">
        <ul className="bt-bullets">{BOUNTY_COPY.how.map((t) => <li key={t}>{t}</li>)}</ul>
        <p className="bt-body-text"><MailSafe text={contact} /></p>
        <p className="bt-meta"><a className="underline" href={terms} target="_blank" rel="noreferrer">{BOUNTY_COPY.termsLink}</a></p>
      </Panel>
      <Panel title={BOUNTY_COPY.scopeTitle} id="scope">
        <ul className="bt-bullets">{BOUNTY_COPY.scope.map((t) => <li key={t}>{t}</li>)}</ul>
        <h3 className="bt-h3">{BOUNTY_COPY.outTitle}</h3>
        <ul className="bt-bullets">{BOUNTY_COPY.out.map((t) => <li key={t}>{t}</li>)}</ul>
      </Panel>
      <Panel title={BOUNTY_COPY.walletTitle} id="wallet">
        <p className="bt-body-text">{BOUNTY_COPY.walletLine} {BOUNTY_COPY.paidRule}</p>
        <BountyWallet />
      </Panel>
      <p className="bt-meta"><Link className="underline" href="/burnticker/history">History and reviews</Link></p>
    </Page>
  );
}
