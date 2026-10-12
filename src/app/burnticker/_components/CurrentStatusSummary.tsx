"use client";

import type { CurrentStatus } from "@/lib/burnticker/currentStatus";
import { upgradeAuthorityText } from "@/lib/burnticker/currentStatusText";
import { EmptyState } from "./EmptyState";
import { useJsonRead, ReadFailurePanel } from "./useJsonRead";
import { RepoText } from "./RepoText";
import { PUBLIC_REPO_COMMIT } from "@/lib/burnticker/currentStatusLinks";

/**
 * THE CURRENT-STATUS SUMMARY (website brief 2026-10-11 §4), at the top of the trust and operator pages: one object from
 * GET /api/burnticker/v1/current-status. Deployed facts first (network, programs, signing, upgrade authority with the time lock READ
 * FROM CHAIN beside the plan), then the per-finding review status and the open release requirements, then the intended design and the
 * append-only historical logs — three separate labelled blocks, the details behind disclosures.
 */
/**
 * Claude site audit 2 item 2e (website-13): the summary lines that count findings or open requirements link to their own lists, which
 * open when followed.
 */
const LINE_LINKS: { re: RegExp; target: string }[] = [
  { re: /fixed findings? still waits?/, target: "cs-findings" },
  { re: /(things are|thing is) still open before release/, target: "cs-open" },
];
function openList(id: string) { const d = document.getElementById(id); if (d instanceof HTMLDetailsElement) d.open = true; }
function SummaryLine({ l }: { l: string }) {
  const hit = LINE_LINKS.find((x) => x.re.test(l));
  if (!hit) return <li>{l}</li>;
  return <li><a className="underline" href={`#${hit.target}`} onClick={() => openList(hit.target)} data-summary-link={hit.target}>{l}</a></li>;
}

export function CurrentStatusSummary({ card }: { card: string }) {
  const { data: s, failure, loading, triedAt, retry } = useJsonRead<CurrentStatus>("/api/burnticker/v1/current-status");
  if (failure) return <ReadFailurePanel what="The current-status summary" failure={failure} triedAt={triedAt} loading={loading} retry={retry} />;
  if (!s) return <EmptyState kind="loading" body="Reading the current status." />;
  return (
    <section className={card} aria-label="Current status" data-current-status>
      <h2 className="font-medium">Current status <span className="text-xs font-normal text-neutral-500">Checked on {s.checkedAt}. Chain read at {s.readAt.slice(0, 16).replace("T", " ")} UTC.</span></h2>
      <ul className="mt-1 list-disc pl-5 text-xs text-neutral-200 space-y-0.5">{s.lines.map((l) => <SummaryLine key={l} l={l} />)}</ul>
      <p className="mt-1 text-xs text-neutral-500">{s.host.line}</p>
      <details className="mt-2 text-xs"><summary className="cursor-pointer text-neutral-300">The deployed programs and who can upgrade them</summary>
        <ul className="mt-1 space-y-1">{s.programs.map((p) => <li key={p.name}><code>{p.name}</code> <code className="text-neutral-500 break-all">{p.programId}</code>, {p.version}. {p.devnet.deployed ? `It is deployed on devnet${p.devnet.matchesBuild ? ", and its bytes match the build" : ""}. ${upgradeAuthorityText(p.devnet)}` : "It is not deployed on devnet."} {p.mainnet.line}</li>)}</ul>
        <ul className="mt-1 space-y-1">{s.upgradeAuthority.map((u) => <li key={u.cluster}>{u.line} The vault is <code className="break-all">{u.vault}</code>, and it needs {u.threshold} approvals. <span className="text-neutral-500">{u.why}</span></li>)}</ul>
      </details>
      <details className="mt-1 text-xs"><summary className="cursor-pointer text-neutral-300">Where each kind of result comes from</summary>
        <ul className="mt-1 space-y-1">{s.settlement.map((x) => <li key={x.category}><b>{x.category}.</b> The main source is {x.primary}. It is checked against {x.check}. <span className="text-neutral-400">Status: {x.status}.</span></li>)}</ul>
      </details>
      <details id="cs-findings" className="mt-1 text-xs scroll-mt-24"><summary className="cursor-pointer text-neutral-300">Review findings: what was fixed, what was re-checked, what is deployed</summary>
        <div className="overflow-x-auto"><table className="mt-1 w-full"><thead className="text-left text-neutral-400"><tr><th className="p-1">Review</th><th className="p-1">Finding</th><th className="p-1">Fix</th><th className="p-1">Re-check</th><th className="p-1">Deployed</th></tr></thead>
          <tbody>{s.reviews.flatMap((r) => r.findings.map((f) => <tr key={r.id + f.id} className="border-t border-neutral-800 align-top"><td className="p-1">{r.label} <RepoText className="block text-neutral-500" text={r.report} /></td><td className="p-1">{f.id} ({f.severity}) {f.title}</td><td className="p-1">{f.fix}</td><td className={`p-1 ${/not/.test(f.recheck) ? "text-amber-300" : ""}`}>{f.recheck}</td><td className="p-1">{f.deployed}</td></tr>))}</tbody></table></div>
      </details>
      <details id="cs-open" className="mt-1 text-xs scroll-mt-24"><summary className="cursor-pointer text-neutral-300">What is still open before release</summary>
        <ul className="mt-1 space-y-0.5">{s.releaseRequirements.map((r) => <li key={r.id}><span className={`mr-1 rounded px-1 ${r.status === "open" ? "bg-amber-900 text-amber-200" : "bg-neutral-800 text-neutral-300"}`}>{r.status}</span>{r.text}</li>)}</ul>
      </details>
      <details className="mt-1 text-xs"><summary className="cursor-pointer text-neutral-300">How it is meant to work (not all of it is deployed)</summary><ul className="mt-1 list-disc pl-5">{s.design.map((d) => <li key={d}>{d}</li>)}</ul></details>
      <p className="mt-2 text-[11px] text-neutral-500">The history is kept in append-only files: {s.historical.map((h, k) => <span key={h.path}>{k ? (k === s.historical.length - 1 ? " and " : ", ") : ""}the {h.label.charAt(0).toLowerCase() + h.label.slice(1)} in <RepoText text={h.path} /></span>)}. This summary comes from <RepoText text={s.source} />. The links open the public repository at commit <code>{PUBLIC_REPO_COMMIT.slice(0, 8)}</code>.</p>
    </section>
  );
}
