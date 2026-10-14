"use client";

import { EmptyState } from "../_components/EmptyState";
import { useJsonRead, ReadFailurePanel } from "../_components/useJsonRead";
import { RepoText } from "../_components/RepoText";
import { denverTime } from "@/lib/burnticker/denverTime";

/**
 * TRUST OPS ON THE TRUST PAGE (2026-10-10 night): which keeper is active, an attesters line per coin, the latest registry snapshot on
 * Arweave, the incident policy and the public status page. From /api/burnticker/trust/ops (src/lib/burnticker/ops/trustOps.ts).
 */
interface KeeperView { source: string; url: string | null; reachable: boolean; role: string | null; active: boolean | null; reason: string | null; hostIdHash: string | null; lastCycleAt: string | null; takeoverAt: string | null; takeoverValid: boolean | null; error: string | null }
interface TrustOps { keepers: KeeperView[]; activeSummary: string; attesters: { ticker: string; count: number; line: string }[]; snapshot: { date: string; sha256: string; arweaveTxId: string; url: string; rowCounts: Record<string, number> } | null; snapshotsApi: string; incidents: { policy: string; template: string; log: string }; statusPage: string }

export default function OpsSection({ card, repo }: { card: string; repo?: string | null }) {
  const { data: t, failure, loading, triedAt, retry } = useJsonRead<TrustOps>("/api/burnticker/trust/ops");
  // audit 4 BT-14: repository paths open the public repository at the pinned commit, never a moving branch
  void repo;
  const link = (rel: string) => <RepoText text={rel} />;
  if (failure) return <section className={card}><h2 className="font-medium">Keepers, attesters and snapshots</h2><ReadFailurePanel what="The operations summary" failure={failure} triedAt={triedAt} loading={loading} retry={retry} /></section>;
  if (!t) return <section className={card}><h2 className="font-medium">Keepers, attesters and snapshots</h2><EmptyState compact kind="loading" /></section>;
  return (<>
    <section className={card}><h2 className="font-medium">Which keeper is active</h2>
      <p className="text-xs">{t.activeSummary} The <a className="underline" href={t.statusPage}>status page</a> has more detail.</p>
      <ul className="text-xs mt-1">{t.keepers.map((k) => <li key={k.source}>{k.source}{k.url ? <> (<code>{k.url}</code>)</> : null}: {k.reachable ? <>{k.role ?? "unknown role"}, <span className={k.active ? "text-emerald-400" : "text-neutral-400"}>{k.active ? "active" : "passive"}</span>. Host <code>{k.hostIdHash ?? "unknown"}</code>. Last cycle {k.lastCycleAt ? denverTime(k.lastCycleAt) : "not recorded"}.{k.takeoverAt ? <> It took over at {denverTime(k.takeoverAt)}{k.takeoverValid === false ? ", and the signature does NOT verify." : ", with a signed note."}</> : null}{k.reason ? <span className="text-neutral-500"> {k.reason}</span> : null}</> : <span className="text-amber-400">{k.error ?? k.reason ?? "It cannot be reached."}</span>}</li>)}</ul>
    </section>
    <section className={card}><h2 className="font-medium">Attesters per coin</h2>
      {t.attesters.length === 0 ? <p className="text-xs text-neutral-500">There are no coins yet.</p> : <ul className="text-xs">{t.attesters.map((a) => <li key={a.ticker}>${a.ticker}: {a.line}</li>)}</ul>}
      <p className="text-xs text-neutral-500 mt-1">These lines come from the registry. The final word is each coin&apos;s settings on chain (TokenConfig), which you can check with <code>scripts/burnticker-attester.mts status &lt;mint&gt;</code>. A key can vouch for a new attester only after 7 days in the set. To run your own attester, see {link("docs/burnticker/ATTESTERS.md")}.</p>
    </section>
    <section className={card}><h2 className="font-medium">Registry snapshots on Arweave</h2>
      {t.snapshot ? <p className="text-xs">The latest snapshot is from {t.snapshot.date}. Its sha256 is <code className="break-all">{t.snapshot.sha256}</code>. The Arweave copy is <a className="underline" href={t.snapshot.url}>{t.snapshot.arweaveTxId}</a>. It holds these rows: {Object.entries(t.snapshot.rowCounts).map(([k, v]) => `${k} ${v}`).join(", ")}.</p> : <p className="text-xs text-neutral-500">No snapshot is recorded on this host yet. Once the upload payer is set, the keeper takes one each UTC day. Nothing else is hosted in place of the Arweave copy.</p>}
      <p className="text-xs text-neutral-500 mt-1">Every snapshot is listed at <a className="underline" href={t.snapshotsApi}>{t.snapshotsApi}</a>. To recompute one, run <code>scripts/burnticker-verify-snapshot.mts &lt;txid&gt;</code>.</p>
    </section>
    <section className={card}><h2 className="font-medium">Incident policy</h2>
      <p className="text-xs">The incident policy says what counts as an incident, sets a public postmortem within 48 hours, and says where it is published and who signs it. The policy is in {link(t.incidents.policy)}. The template is {link(t.incidents.template)}, and the log is {link(t.incidents.log)}, shown below.</p>
    </section>
  </>);
}
