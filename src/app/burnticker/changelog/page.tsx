import type { Metadata } from "next";
import Link from "next/link";
import { readReleases, RELEASES_SINCE } from "@/lib/burnticker/history";
import { CHANGELOG_COPY } from "@/lib/burnticker/historyCopy";
import { longDay } from "@/lib/burnticker/cardView";
import { CHANGELOG_FILE } from "@/lib/burnticker/trust";
import { EmptyState } from "../_components/EmptyState";
import { Page, PageHeader } from "../_components/Panel";
import { RepoText } from "../_components/RepoText";

export const metadata: Metadata = { title: CHANGELOG_COPY.title, description: CHANGELOG_COPY.description, alternates: { canonical: "/burnticker/changelog" } };
export const dynamic = "force-dynamic";

/**
 * /burnticker/changelog (legitimacy pass item 1): every publish of the public repository from docs/burnticker/CHANGELOG.md, newest
 * first, each with its public commit linked when the changelog records it and one plain line per change (history.ts). Read from the
 * file on every request, so the page and the file cannot drift. Reached from the Learn menu and the Trust page's history link.
 */
export default function ChangelogPage() {
  const releases = readReleases();
  const since = longDay(RELEASES_SINCE) ?? RELEASES_SINCE;
  const counted = releases?.filter((r) => r.date >= RELEASES_SINCE).length ?? 0;
  return (
    <Page>
      <PageHeader title={CHANGELOG_COPY.title} intro={CHANGELOG_COPY.intro}>
        {releases && <p className="bt-meta" data-release-count={counted}>{CHANGELOG_COPY.sinceLine(counted, since)}</p>}
      </PageHeader>
      {!releases ? <EmptyState kind="unavailable" body={CHANGELOG_COPY.unavailable} /> : releases.length === 0 ? <EmptyState kind="no-activity" /> : (
        <ol className="bt-list" aria-label={CHANGELOG_COPY.title}>
          {[...releases].reverse().map((r, k) => (
            <li key={`${r.source}-${k}`} className="bt-panel" data-release={r.source}>
              <p className="bt-eyebrow"><time dateTime={r.date}>{longDay(r.date) ?? r.date}</time></p>
              <ul className="bt-bullets">{r.lines.map((l) => <li key={l}>{l}</li>)}</ul>
              <p className="bt-meta">
                {r.publicUrl ? <a className="underline" href={r.publicUrl} target="_blank" rel="noreferrer">{CHANGELOG_COPY.publicLink} <code>{r.publicCommit!.slice(0, 7)}</code></a> : <span>{CHANGELOG_COPY.noPublic}</span>}
                <span className="bt-meta-sep"> </span><span>{CHANGELOG_COPY.source} <code>{r.source}</code>.</span>
              </p>
            </li>
          ))}
        </ol>
      )}
      <p className="bt-meta">{CHANGELOG_COPY.fileLine} <RepoText text={CHANGELOG_FILE} />. <Link className="underline" href="/burnticker/history">History and reviews</Link></p>
    </Page>
  );
}
