import type { Metadata } from "next";
import Link from "next/link";
import { readIncidentLog } from "@/lib/burnticker/history";
import { CAUGHT_EARLY, INCIDENTS_COPY } from "@/lib/burnticker/historyCopy";
import { longDay } from "@/lib/burnticker/cardView";
import { INCIDENTS_FILE } from "@/lib/burnticker/trust";
import { repoUrl } from "@/lib/burnticker/currentStatusLinks";
import { EmptyState } from "../_components/EmptyState";
import { Page, PageHeader, Panel } from "../_components/Panel";
import { RepoText } from "../_components/RepoText";
import { withShareCard } from "@/lib/burnticker/pageMeta";

export const metadata: Metadata = withShareCard({ title: INCIDENTS_COPY.title, description: INCIDENTS_COPY.description, alternates: { canonical: "/burnticker/incidents" } });
export const dynamic = "force-dynamic";

/**
 * /burnticker/incidents (legitimacy pass item 2): the append-only incident log (docs/burnticker/incidents/LOG.md, one "## " heading per
 * incident) rendered as it is written, honest when it is empty, and the problems caught before launch as "caught before it mattered"
 * rows (historyCopy.ts CAUGHT_EARLY, each citing its write-up). Linked from the Trust page's history link and the status page.
 */
export default function IncidentsPage() {
  const log = readIncidentLog();
  return (
    <Page>
      <PageHeader title={INCIDENTS_COPY.title} intro={INCIDENTS_COPY.intro}>
        <p className="bt-meta"><a className="underline" href={repoUrl("docs/burnticker/INCIDENTS.md")} target="_blank" rel="noreferrer">{INCIDENTS_COPY.policyLink}</a><span className="bt-meta-sep"> </span><a className="underline" href="/status/">{INCIDENTS_COPY.statusLink}</a></p>
      </PageHeader>
      <Panel title={INCIDENTS_COPY.recordedTitle} id="recorded">
        {!log.present ? <EmptyState kind="unavailable" body={INCIDENTS_COPY.unavailable} compact />
          : log.entries.length === 0 ? <EmptyState kind="no-activity" body={<>{INCIDENTS_COPY.none} {INCIDENTS_COPY.noneMore}</>} compact />
          : <ol className="bt-list">{log.entries.map((e) => <li key={e.heading}><h3 className="bt-h3">{e.heading}</h3><pre className="bt-pre">{e.body}</pre></li>)}</ol>}
        <p className="bt-meta">{INCIDENTS_COPY.logLink}: <RepoText text={INCIDENTS_FILE} /></p>
      </Panel>
      <Panel title={INCIDENTS_COPY.caughtTitle} id="caught">
        <p className="bt-body-text">{INCIDENTS_COPY.caughtIntro}</p>
        <ol className="bt-list">
          {CAUGHT_EARLY.map((c) => (
            <li key={c.id} className="bt-subpanel" data-caught={c.id}>
              <p className="bt-eyebrow"><time dateTime={c.date}>{longDay(c.date) ?? c.date}</time></p>
              <h3 className="bt-h3">{c.title}</h3>
              <dl className="bt-dl">
                <div><dt>{INCIDENTS_COPY.whatHappened}</dt><dd>{c.happened}</dd></div>
                <div><dt>{INCIDENTS_COPY.whatWasDone}</dt><dd>{c.done}</dd></div>
              </dl>
              <p className="bt-meta"><RepoText text={c.source} /></p>
            </li>
          ))}
        </ol>
      </Panel>
      <p className="bt-meta"><Link className="underline" href="/burnticker/history">History and reviews</Link></p>
    </Page>
  );
}
