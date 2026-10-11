"use client";

import { useEffect, useState } from "react";

/**
 * TRUST OPS ON THE TRUST PAGE (2026-10-10 night): which keeper is active, an attesters line per coin, the latest registry snapshot on
 * Arweave, the incident policy and the public status page. From /api/burnticker/trust/ops (src/lib/burnticker/ops/trustOps.ts).
 */
interface KeeperView { source: string; url: string | null; reachable: boolean; role: string | null; active: boolean | null; reason: string | null; hostIdHash: string | null; lastCycleAt: string | null; takeoverAt: string | null; takeoverValid: boolean | null; error: string | null }
interface TrustOps { keepers: KeeperView[]; activeSummary: string; attesters: { ticker: string; count: number; line: string }[]; snapshot: { date: string; sha256: string; arweaveTxId: string; url: string; rowCounts: Record<string, number> } | null; snapshotsApi: string; incidents: { policy: string; template: string; log: string }; statusPage: string }

export default function OpsSection({ card, repo }: { card: string; repo?: string | null }) {
  const [t, setT] = useState<TrustOps | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { fetch("/api/burnticker/trust/ops").then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? r.statusText); setT(j); }).catch((e) => setErr(String(e.message ?? e))); }, []);
  const link = (rel: string) => (repo ? <a className="underline" href={`${repo.replace(/\/$/, "")}/blob/main/${rel}`}>{rel}</a> : <code>{rel}</code>);
  if (err) return <section className={card}><h2 className="font-medium">Keepers, attesters, snapshots</h2><p className="text-xs text-amber-400">{err}</p></section>;
  if (!t) return <section className={card}><h2 className="font-medium">Keepers, attesters, snapshots</h2><p className="text-xs text-neutral-500">Loading…</p></section>;
  return (<>
    <section className={card}><h2 className="font-medium">Keepers — which one is active</h2>
      <p className="text-xs">{t.activeSummary} · <a className="underline" href={t.statusPage}>status page</a></p>
      <ul className="text-xs mt-1">{t.keepers.map((k) => <li key={k.source}>{k.source}{k.url ? <> (<code>{k.url}</code>)</> : null}: {k.reachable ? <>{k.role ?? "?"} · <span className={k.active ? "text-emerald-400" : "text-neutral-400"}>{k.active ? "active" : "passive"}</span> · host <code>{k.hostIdHash ?? "?"}</code> · last cycle {k.lastCycleAt ?? "—"}{k.takeoverAt ? <> · took over {k.takeoverAt}{k.takeoverValid === false ? " (signature does NOT verify)" : " (signed note)"}</> : null}{k.reason ? <span className="text-neutral-500"> — {k.reason}</span> : null}</> : <span className="text-amber-400">{k.error ?? k.reason ?? "unreachable"}</span>}</li>)}</ul>
    </section>
    <section className={card}><h2 className="font-medium">Attesters per coin</h2>
      {t.attesters.length === 0 ? <p className="text-xs text-neutral-500">no coins yet</p> : <ul className="text-xs">{t.attesters.map((a) => <li key={a.ticker}>${a.ticker}: {a.line}</li>)}</ul>}
      <p className="text-xs text-neutral-500 mt-1">From the registry; the authority is each coin&apos;s on-chain TokenConfig (<code>scripts/burnticker-attester.mts status &lt;mint&gt;</code>). A key can vouch for a new one only after 7 days in the set. Bring your own attester: {link("docs/burnticker/ATTESTERS.md")}.</p>
    </section>
    <section className={card}><h2 className="font-medium">Registry snapshots on Arweave</h2>
      {t.snapshot ? <p className="text-xs">Latest: {t.snapshot.date} · sha256 <code className="break-all">{t.snapshot.sha256}</code> · <a className="underline" href={t.snapshot.url}>{t.snapshot.arweaveTxId}</a> · {Object.entries(t.snapshot.rowCounts).map(([k, v]) => `${k} ${v}`).join(", ")}</p> : <p className="text-xs text-neutral-500">No snapshot recorded on this host yet (the keeper takes one per UTC day once the upload payer is set; nothing is hosted in place of the Arweave copy).</p>}
      <p className="text-xs text-neutral-500 mt-1">Every snapshot: <a className="underline" href={t.snapshotsApi}>{t.snapshotsApi}</a> · recompute one: <code>scripts/burnticker-verify-snapshot.mts &lt;txid&gt;</code></p>
    </section>
    <section className={card}><h2 className="font-medium">Incident policy</h2>
      <p className="text-xs">What counts as an incident, the 48-hour public postmortem, where it is published and who signs it: {link(t.incidents.policy)} · template {link(t.incidents.template)} · the log {link(t.incidents.log)} (rendered below).</p>
    </section>
  </>);
}
