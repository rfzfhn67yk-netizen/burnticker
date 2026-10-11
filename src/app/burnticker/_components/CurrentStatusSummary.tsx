"use client";

import { useEffect, useState } from "react";
import type { CurrentStatus } from "@/lib/burnticker/currentStatus";
import { upgradeAuthorityText } from "@/lib/burnticker/currentStatusText";
import { EmptyState } from "./EmptyState";

/**
 * THE CURRENT-STATUS SUMMARY (website brief 2026-10-11 §4), at the top of the trust and operator pages: one object from
 * GET /api/burnticker/v1/current-status. Deployed facts first (network, programs, signing, upgrade authority with the time lock READ
 * FROM CHAIN beside the plan), then the per-finding review status and the open release requirements, then the intended design and the
 * append-only historical logs — three separate labelled blocks, the details behind disclosures.
 */
export function CurrentStatusSummary({ card }: { card: string }) {
  const [s, setS] = useState<CurrentStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { fetch("/api/burnticker/v1/current-status").then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`); setS(j); }).catch((e) => setErr(String((e as Error).message ?? e))); }, []);
  if (err) return <EmptyState kind="unavailable" body="The current-status summary could not be read just now." details={err} />;
  if (!s) return <EmptyState kind="loading" body="Reading the current status." />;
  return (
    <section className={card} aria-label="Current status" data-current-status>
      <h2 className="font-medium">Current status <span className="text-xs font-normal text-neutral-500">checked {s.checkedAt} · chain read {s.readAt.slice(0, 16).replace("T", " ")} UTC</span></h2>
      <ul className="mt-1 list-disc pl-5 text-xs text-neutral-200 space-y-0.5">{s.lines.map((l) => <li key={l}>{l}</li>)}</ul>
      <p className="mt-1 text-xs text-neutral-500">{s.host.line}</p>
      <details className="mt-2 text-xs"><summary className="cursor-pointer text-neutral-300">Deployed: programs and upgrade authority</summary>
        <ul className="mt-1 space-y-1">{s.programs.map((p) => <li key={p.name}><code>{p.name}</code> <code className="text-neutral-500 break-all">{p.programId}</code> · {p.version} · devnet: {p.devnet.deployed ? `deployed${p.devnet.matchesBuild ? ", bytes = build" : ""}, ${upgradeAuthorityText(p.devnet)}` : "not deployed"} · {p.mainnet.line}</li>)}</ul>
        <ul className="mt-1 space-y-1">{s.upgradeAuthority.map((u) => <li key={u.cluster}>{u.line} Vault <code className="break-all">{u.vault}</code>, {u.threshold}. <span className="text-neutral-500">{u.why}</span></li>)}</ul>
      </details>
      <details className="mt-1 text-xs"><summary className="cursor-pointer text-neutral-300">Settlement providers ({s.settlement.length})</summary>
        <ul className="mt-1 space-y-1">{s.settlement.map((x) => <li key={x.category}><b>{x.category}</b> — {x.primary}; check: {x.check}. <span className="text-neutral-400">{x.status}</span></li>)}</ul>
      </details>
      <details className="mt-1 text-xs"><summary className="cursor-pointer text-neutral-300">Review findings: fix · re-check · deployed</summary>
        <div className="overflow-x-auto"><table className="mt-1 w-full"><thead className="text-left text-neutral-400"><tr><th className="p-1">Review</th><th className="p-1">Finding</th><th className="p-1">Fix</th><th className="p-1">Re-check</th><th className="p-1">Deployed</th></tr></thead>
          <tbody>{s.reviews.flatMap((r) => r.findings.map((f) => <tr key={r.id + f.id} className="border-t border-neutral-800 align-top"><td className="p-1">{r.label}</td><td className="p-1">{f.id} ({f.severity}) {f.title}</td><td className="p-1">{f.fix}</td><td className={`p-1 ${/not/.test(f.recheck) ? "text-amber-300" : ""}`}>{f.recheck}</td><td className="p-1">{f.deployed}</td></tr>))}</tbody></table></div>
      </details>
      <details className="mt-1 text-xs"><summary className="cursor-pointer text-neutral-300">Open before release ({s.releaseRequirements.filter((r) => r.status === "open").length})</summary>
        <ul className="mt-1 space-y-0.5">{s.releaseRequirements.map((r) => <li key={r.id}><span className={`mr-1 rounded px-1 ${r.status === "open" ? "bg-amber-900 text-amber-200" : "bg-neutral-800 text-neutral-300"}`}>{r.status}</span>{r.text}</li>)}</ul>
      </details>
      <details className="mt-1 text-xs"><summary className="cursor-pointer text-neutral-300">Intended design (not all deployed)</summary><ul className="mt-1 list-disc pl-5">{s.design.map((d) => <li key={d}>{d}</li>)}</ul></details>
      <p className="mt-2 text-[11px] text-neutral-500">History, append-only: {s.historical.map((h, k) => <span key={h.path}>{k ? " · " : ""}{h.label} (<code>{h.path}</code>)</span>)}. Source: <code>{s.source}</code>.</p>
    </section>
  );
}
