"use client";

import { utcDateTime } from "@/lib/burnticker/utcWords";
import type { CurrentStatus } from "@/lib/burnticker/currentStatus";
import { upgradeAuthorityText } from "@/lib/burnticker/currentStatusText";
import { EmptyState } from "./EmptyState";
import { useJsonRead, ReadFailurePanel } from "./useJsonRead";
import { RepoText } from "./RepoText";
import { PUBLIC_REPO_COMMIT } from "@/lib/burnticker/currentStatusLinks";

/**
 * THE CURRENT-STATUS SUMMARY (website brief 2026-10-11 §4), at the top of the trust and operator pages: one object from
 * GET /api/burnticker/v1/current-status. Deployed facts first (network, programs, signing, upgrade authority with the time lock READ
 * FROM CHAIN beside the plan), then the open release requirements, then the intended design and the
 * append-only historical logs — three separate labelled blocks, the details behind disclosures.
 */
/**
 * Claude site audit 2 item 2e (website-13): the summary lines that count findings or open requirements link to their own lists, which
 * open when followed.
 */
const LINE_LINKS: { re: RegExp; target: string }[] = [
];
function openList(id: string) { const d = document.getElementById(id); if (d instanceof HTMLDetailsElement) d.open = true; }
function SummaryLine({ l }: { l: string }) {
  const hit = LINE_LINKS.find((x) => x.re.test(l));
  if (!hit) return <li>{l}</li>;
  return <li><a className="underline" href={`#${hit.target}`} onClick={() => openList(hit.target)} data-summary-link={hit.target}>{l}</a></li>;
}

/**
 * website-15 item 17 (Claude site audit 3 item 14): the full block renders once, on Trust. `compact` (the operator page) prints its first
 * line and a link to the full record.
 */
export function CurrentStatusSummary({ card, compact = false }: { card: string; compact?: boolean }) {
  const { data: s, failure, loading, triedAt, retry } = useJsonRead<CurrentStatus>("/api/burnticker/v1/current-status");
  if (failure) return <ReadFailurePanel what="The current-status summary" failure={failure} triedAt={triedAt} loading={loading} retry={retry} />;
  if (!s) return <EmptyState kind="loading" body="Reading the current status." />;
  if (compact) return (
    <section className={card} aria-label="Current status" data-current-status-line>
      <p className="text-xs text-neutral-200">{s.lines[0] ?? s.host.line} <a className="underline" href="/burnticker/trust#current-status">The full current status is on the Trust page.</a></p>
    </section>
  );
  return <CurrentStatusBody s={s} card={card} />;
}

/**
 * TS7-3 (seventh pre-launch audit; HB-143): the full block as a pure component of the answer, so a test renders it with the public
 * current-status answer (withoutRepoPaths drops `report`, `path` and `source`) and a render-time crash is caught before a deploy.
 */
export function CurrentStatusBody({ s, card }: { s: CurrentStatus; card: string }) {
  return (
    <section className={card} aria-label="Current status" id="current-status" data-current-status>
      <h2 className="font-medium">Current status <span className="text-xs font-normal text-neutral-500">Checked on {utcDateTime(s.readAt)}.</span></h2>
      <ul className="mt-1 list-disc pl-5 text-xs text-neutral-200 space-y-0.5">{s.lines.map((l) => <SummaryLine key={l} l={l} />)}</ul>
      <p className="mt-1 text-xs text-neutral-500">{s.host.line}</p>
      <details className="mt-2 text-xs"><summary className="cursor-pointer text-neutral-300">The deployed programs and who can upgrade them</summary>
        <ul className="mt-1 space-y-1">{s.programs.map((p) => <li key={p.name}><code>{p.name}</code> <code className="text-neutral-500 break-all">{p.programId}</code>, {p.version}. {p.devnet.deployed ? `It is deployed on devnet${p.devnet.matchesBuild ? ", and its bytes match the build" : ""}.${p.devnet.upgradePending ? ` ${p.devnet.upgradePending}` : ""} ${upgradeAuthorityText(p.devnet, "devnet")}` : "It is not deployed on devnet."} {p.mainnet.line}</li>)}</ul>
        <ul className="mt-1 space-y-1">{s.upgradeAuthority.map((u) => <li key={u.cluster}>{u.line} The vault is <code className="break-all">{u.vault}</code>, and it needs {u.threshold} approvals. <span className="text-neutral-500">{u.why}</span></li>)}</ul>
      </details>
      <details className="mt-1 text-xs"><summary className="cursor-pointer text-neutral-300">Where each kind of result comes from</summary>
        <ul className="mt-1 space-y-1">{s.settlement.map((x) => <li key={x.category}><b>{x.category}.</b> The main source is {x.primary}. It is checked against {x.check}. <span className="text-neutral-400">Status: {x.status}.</span></li>)}</ul>
      </details>
      <details id="cs-open" className="mt-1 text-xs scroll-mt-24"><summary className="cursor-pointer text-neutral-300">What is still open before release</summary>
        <ul className="mt-1 space-y-0.5">{s.releaseRequirements.map((r) => <li key={r.id}><span className={`mr-1 rounded px-1 ${r.status === "open" ? "bg-amber-900 text-amber-200" : "bg-neutral-800 text-neutral-300"}`}>{r.status}</span>{r.text}</li>)}</ul>
      </details>
      <details className="mt-1 text-xs"><summary className="cursor-pointer text-neutral-300">How it is meant to work (not all of it is deployed)</summary><ul className="mt-1 list-disc pl-5">{s.design.map((d) => <li key={d}>{d}</li>)}</ul></details>
      <p className="mt-2 text-[11px] text-neutral-500">The history is kept in append-only files: {s.historical.map((h, k) => <span key={h.path ?? h.label}>{k ? (k === s.historical.length - 1 ? " and " : ", ") : ""}the {h.label.charAt(0).toLowerCase() + h.label.slice(1)}{h.path ? <> in <RepoText text={h.path} /></> : null}</span>)}.{s.source ? <> This summary comes from <RepoText text={s.source} />.</> : null} The links open the public repository at commit <code>{PUBLIC_REPO_COMMIT.slice(0, 8)}</code>.</p>
    </section>
  );
}
