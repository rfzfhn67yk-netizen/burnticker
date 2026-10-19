import type { Metadata } from "next";
import Link from "next/link";
import { publishedReviews, type ReviewRow } from "@/lib/burnticker/history";
import { HISTORY_COPY } from "@/lib/burnticker/historyCopy";
import { EmptyState } from "../_components/EmptyState";
import { Page, PageHeader, Panel } from "../_components/Panel";
import { RepoText } from "../_components/RepoText";
import { withShareCard } from "@/lib/burnticker/pageMeta";

export const metadata: Metadata = withShareCard({ title: HISTORY_COPY.title, description: HISTORY_COPY.description, alternates: { canonical: "/burnticker/history" } });
export const dynamic = "force-dynamic";

/**
 * /burnticker/history (legitimacy pass, the owner's placement rule): the one "History and reviews" link on the Trust page lands here.
 * The changelog, the incident log, the bounty, the walk-through and the press kit, and the reviews index (config/burnticker/
 * transparency.json howBuilt.reviews whose report file is in the repository). Never linked from the home, coins or coin pages.
 */
export default function HistoryPage() {
  let reviews: ReviewRow[] | null = null;
  try { reviews = publishedReviews(); } catch { reviews = null; }
  return (
    <Page>
      <PageHeader title={HISTORY_COPY.title} intro={HISTORY_COPY.intro} />
      <ul className="bt-list">
        {HISTORY_COPY.links.map((l) => (
          <li key={l.href} className="bt-panel"><h2 className="bt-h2"><Link className="underline" href={l.href}>{l.label}</Link></h2><p className="bt-body-text">{l.text}</p></li>
        ))}
      </ul>
      <Panel title={HISTORY_COPY.reviewsTitle} id="reviews">
        <p className="bt-body-text">{HISTORY_COPY.reviewsIntro}</p>
        {!reviews ? <EmptyState kind="unavailable" compact /> : reviews.length === 0 ? <EmptyState kind="no-activity" body={HISTORY_COPY.reviewsNone} compact /> : (
          <div className="bt-table-wrap"><table className="bt-table" data-reviews={reviews.length}>
            <thead><tr><th>Review</th><th>Status</th><th>Report</th></tr></thead>
            <tbody>{reviews.map((r) => <tr key={r.id}><td>{r.reviewer}</td><td>{r.status}</td><td><RepoText text={r.reportPath} /></td></tr>)}</tbody>
          </table></div>
        )}
      </Panel>
    </Page>
  );
}
