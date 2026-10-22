import type { Metadata } from "next";
import Link from "next/link";
import { HISTORY_COPY } from "@/lib/burnticker/historyCopy";
import { Page, PageHeader } from "../_components/Panel";
import { withShareCard } from "@/lib/burnticker/pageMeta";

export const metadata: Metadata = withShareCard({ title: HISTORY_COPY.title, description: HISTORY_COPY.description, alternates: { canonical: "/burnticker/history" } });
export const dynamic = "force-dynamic";

/**
 * /burnticker/history (legitimacy pass, the owner's placement rule): the one "History" link on the Trust page lands here. The changelog,
 * the incident log, the bounty and the walk-through. Owner decision 2026-10-22: the reviews index and the press kit left the site.
 * Never linked from the home, coins or coin pages.
 */
export default function HistoryPage() {
  return (
    <Page>
      <PageHeader title={HISTORY_COPY.title} intro={HISTORY_COPY.intro} />
      <ul className="bt-list">
        {HISTORY_COPY.links.map((l) => (
          <li key={l.href} className="bt-panel"><h2 className="bt-h2"><Link className="underline" href={l.href}>{l.label}</Link></h2><p className="bt-body-text">{l.text}</p></li>
        ))}
      </ul>
    </Page>
  );
}
