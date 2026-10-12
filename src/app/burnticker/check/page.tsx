"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { EmptyState } from "../_components/EmptyState";
import ReceiptVerifier from "./ReceiptVerifier";
import { useJsonRead, ReadFailurePanel } from "../_components/useJsonRead";
import { BurnMath } from "../_components/BurnMath";
import { CHECK_COPY } from "@/lib/burnticker/trustpack/copy";
import { RepoText } from "../_components/RepoText";

/**
 * /burnticker/check — "CHECK THIS YOURSELF" (trust pack, 2026-10-10). The sceptic's checklist against ourselves, rendered from
 * GET /api/burnticker/v1/check (src/lib/burnticker/trustpack/checklist.ts: the two Powers Registers, transparency.json, the
 * verified-build table, operator.json — the same object docs/burnticker/CHECK-THIS-YOURSELF.md is generated from), plus the receipt
 * verifier that runs in the visitor's browser. Words: src/lib/burnticker/trustpack/copy.ts (copy-linted).
 */
interface Item { id: string; title: string; text: string; where: string; status?: string }
interface Check {
  programs: { name: string; programId: string; register: string; privileged: number; overFunds: string }[];
  money: { program: string; instruction: string; class: string; signers: string; outflow: string; outflowClass: string; funds: string }[];
  nonPowers: { program: string; text: string }[];
  powers: { program: string; instruction: string; holder: string; can: string; timelock: string | null }[];
  upgradeAuthority: { program: string; holder: string; sunset: string }[];
  external: { program: string; power: string; holder: string; effect: string }[];
  locked: Item[]; notDone: Item[];
  build: { kind: string; kindNote: string; sourceCommit: string; programs: { library: string; programId: string; builds: Record<"mainnet" | "devnet", { features: string[]; hash: string }>; deployed: Partial<Record<"mainnet" | "devnet", { hash: string; matchesBuild: boolean; upgradeAuthority: string; readAt?: string; evidence?: string } | null>> }[] };
}

const card = "rounded-lg border border-neutral-800 bg-neutral-900 p-3";
const flowTone: Record<string, string> = { none: "text-neutral-500", rent: "text-neutral-400", intoPool: "text-emerald-400", swapBurn: "text-emerald-400", burn: "text-emerald-400", trade: "text-neutral-200", graduate: "text-neutral-200", close: "text-neutral-300" };

export default function CheckPage() {
  // UX report 3 item 7: /check?demo=1#verify puts the verifier first, under the header, so the checklist loading above it cannot push
  // the anchored result off screen; without ?demo=1 it stays after the checklist. null until the URL is read (no double mount).
  const [verifierAt, setVerifierAt] = useState<"top" | "bottom" | null>(null);
  useEffect(() => { setVerifierAt(new URLSearchParams(window.location.search).get("demo") === "1" ? "top" : "bottom"); }, []);
  const { data: c, failure, loading, triedAt, retry } = useJsonRead<Check>("/api/burnticker/v1/check");
  return (
    <main className="mx-auto max-w-5xl px-4 py-6 space-y-6 text-sm">
      <header>
        <p className="text-xs"><Link className="underline" href="/burnticker/trust">← Trust</Link></p>
        <h1 className="text-2xl font-semibold">{CHECK_COPY.title}</h1>
        <p className="text-neutral-300">{CHECK_COPY.intro}</p>
        <p className="text-xs text-neutral-500 mt-1"><a className="underline" href="#money">{CHECK_COPY.moneyTitle}</a> · <a className="underline" href="#powers">{CHECK_COPY.powersTitle}</a> · <a className="underline" href="#locked">{CHECK_COPY.lockedTitle}</a> · <a className="underline" href="#not-done">{CHECK_COPY.notDoneTitle}</a> · <a className="underline" href="#build">{CHECK_COPY.buildTitle}</a> · <a className="underline" href="#verify">{CHECK_COPY.verifierTitle}</a></p>
      </header>
      {verifierAt === "top" && <ReceiptVerifier card={card} />}
      {failure && <ReadFailurePanel what="The checklist" failure={failure} triedAt={triedAt} loading={loading} retry={retry} />}
      {!c && !failure && <EmptyState kind="loading" />}
      {c && <>
        <section className={card} id="money">
          <h2 className="font-medium">{CHECK_COPY.moneyTitle}</h2>
          <p className="text-xs text-neutral-300">{CHECK_COPY.moneyIntro}</p>
          {/* site audit #14 (2026-10-11): the verifier result stays first; the ~40-row instruction table is collapsed by default */}
          <details className="mt-2 text-xs" data-money-table><summary className="cursor-pointer text-neutral-300">Show all {c.money.length} instructions of both programs and where each one can move money</summary>
          <div className="overflow-x-auto mt-2 max-w-full"><table className="w-full text-xs"><thead className="text-neutral-400 text-left"><tr><th className="p-2">Program</th><th className="p-2">Instruction</th><th className="p-2">Who signs</th><th className="p-2">Where money can go</th></tr></thead>
            <tbody>{c.money.map((m) => <tr key={`${m.program}-${m.instruction}`} className="border-t border-neutral-800 align-top"><td className="p-2 text-neutral-500">{m.program}</td><td className="p-2"><code>{m.instruction}</code></td><td className="p-2">{m.signers}</td><td className="p-2"><span className={flowTone[m.outflowClass] ?? ""}>{m.outflow}</span><details className="text-neutral-500"><summary className="cursor-pointer">What the register says</summary>{m.funds}</details></td></tr>)}</tbody></table></div>
          </details>
          <details className="mt-2 text-xs"><summary className="cursor-pointer text-neutral-300">What does not exist in either program</summary><ul className="list-disc pl-5 mt-1 space-y-1">{c.nonPowers.map((n, i) => <li key={i}><span className="text-neutral-500">{n.program}:</span> {n.text}</li>)}</ul></details>
        </section>

        <section className={card} id="powers">
          <h2 className="font-medium">{CHECK_COPY.powersTitle}</h2>
          <p className="text-xs text-neutral-300">{CHECK_COPY.powersIntro}</p>
          <ul className="text-xs mt-1">{c.programs.map((p) => <li key={p.name}><code>{p.name}</code> <code className="text-neutral-500">{p.programId}</code> has {p.privileged === 0 ? "no" : p.privileged} privileged instruction{p.privileged === 1 ? "" : "s"}. It has <span className="text-emerald-400">{p.overFunds === "none" ? "no" : p.overFunds}</span> power over funds. The list comes from <RepoText className="text-neutral-500" text={p.register} />.</li>)}</ul>
          {c.powers.length > 0 && <div className="overflow-x-auto mt-2"><table className="w-full text-xs"><thead className="text-neutral-400 text-left"><tr><th className="p-2">Program</th><th className="p-2">Instruction</th><th className="p-2">Holder</th><th className="p-2">What it can do</th><th className="p-2">Time lock</th></tr></thead>
            <tbody>{c.powers.map((p) => <tr key={`${p.program}-${p.instruction}`} className="border-t border-neutral-800 align-top"><td className="p-2 text-neutral-500">{p.program}</td><td className="p-2"><code>{p.instruction}</code></td><td className="p-2">{p.holder}</td><td className="p-2">{p.can}</td><td className="p-2 text-neutral-400">{p.timelock ?? "—"}</td></tr>)}</tbody></table></div>}
          <h3 className="text-xs font-medium mt-3">Upgrade authority</h3>
          <ul className="text-xs list-disc pl-5">{c.upgradeAuthority.map((u) => <li key={u.program}><span className="text-neutral-500">{u.program}:</span> {u.holder} <span className="text-neutral-400">When it ends: {u.sunset}</span></li>)}</ul>
          <h3 className="text-xs font-medium mt-3">Powers outside the programs</h3>
          <ul className="text-xs list-disc pl-5">{c.external.map((e, i) => <li key={i}><span className="text-neutral-500">{e.program}:</span> <b>{e.power}</b>. Held by {e.holder}. <span className="text-neutral-400">{e.effect}</span></li>)}</ul>
        </section>

        <section className={card} id="locked">
          <h2 className="font-medium">{CHECK_COPY.lockedTitle}</h2>
          <ul className="text-xs space-y-1 mt-1">{c.locked.map((l) => <li key={l.id}><b>{l.title}.</b>{l.status && <span className="ml-1 rounded bg-neutral-800 px-1 text-neutral-300">{l.status}</span>} <RepoText text={l.text} /> <span className="text-neutral-500">(<RepoText text={l.where} />)</span></li>)}</ul>
        </section>

        <section className={card} id="not-done">
          <h2 className="font-medium">{CHECK_COPY.notDoneTitle}</h2>
          <p className="text-xs text-neutral-300">{CHECK_COPY.notDoneIntro}</p>
          <ul className="text-xs space-y-1 mt-1">{c.notDone.map((n) => <li key={n.id}><span className={`mr-2 rounded px-1 ${n.status === "done" ? "bg-neutral-800 text-neutral-300" : "bg-amber-900 text-amber-200"}`}>{n.status ?? "not done"}</span><b>{n.title}.</b> <RepoText text={n.text} /> <span className="text-neutral-500">(<RepoText text={n.where} />)</span></li>)}</ul>
        </section>

        <section className={card} id="build">
          <h2 className="font-medium">{CHECK_COPY.buildTitle}</h2>
          <p className="text-xs text-neutral-300">{CHECK_COPY.buildIntro}</p>
          <p className="text-xs mt-1"><span className={`rounded px-1 ${c.build.kind === "docker" ? "bg-neutral-800" : "bg-amber-900 text-amber-200"}`}>{c.build.kind}</span> {c.build.kindNote} It was built from source commit <code>{c.build.sourceCommit.slice(0, 12)}</code>.</p>
          {/* audit R05: one row per program and network — a Network column, and each row's deployed bytes, read date and evidence are that network's own */}
          <div className="overflow-x-auto mt-2"><table className="w-full text-xs" data-build-table><thead className="text-neutral-400 text-left"><tr><th className="p-2">Program</th><th className="p-2">Network</th><th className="p-2">Executable hash (this repository)</th><th className="p-2">Deployed bytes on that network</th><th className="p-2">Read</th><th className="p-2">Evidence</th></tr></thead>
            <tbody>{c.build.programs.flatMap((p) => (["mainnet", "devnet"] as const).map((v) => { const d = p.deployed[v]; return <tr key={`${p.library}-${v}`} className="border-t border-neutral-800 align-top"><td className="p-2"><code>{p.library}</code></td><td className="p-2">{v}{p.builds[v].features.length ? <span className="text-neutral-500"> (--features {p.builds[v].features.join(",")})</span> : null}</td><td className="p-2 break-all"><code>{p.builds[v].hash}</code></td><td className="p-2 break-all">{d ? <><code>{d.hash}</code> <span className={d.matchesBuild ? "text-emerald-400" : "text-red-400"}>{d.matchesBuild ? "✓ same bytes" : "✗ differs"}</span></> : <span className="text-neutral-500">no deployed bytes recorded for {v}</span>}</td><td className="p-2 whitespace-nowrap">{d?.readAt ?? "—"}</td><td className="p-2">{d?.evidence ? <RepoText text={d.evidence} /> : "—"}</td></tr>; }))}</tbody></table></div>
          <p className="text-xs text-neutral-500 mt-1">To reproduce the build, run <code>bash scripts/ops/verified-build.sh --local</code>, or use <code>--docker</code> on Linux. Then run it with <code>--onchain devnet</code> or <code>--onchain mainnet</code>. The full steps are in <RepoText text="docs/burnticker/VERIFIED-BUILD.md" />.</p>
        </section>
      </>}
      {verifierAt === "bottom" && <ReceiptVerifier card={card} />}
      <BurnMath />
      <p className="text-xs text-neutral-400">The verifier only checks transactions for coins that the burn program knows. To find out whether a token is a Burnticker coin at all, use <a className="underline" href="/burnticker/verify">Verify a mint</a>. Lookalike coins are listed on <a className="underline" href="/burnticker/not-burnticker">Not Burnticker</a>.</p>
      <p className="text-xs text-neutral-500">The same data is available as JSON at <code>/api/burnticker/v1/check</code>, <code>/api/burnticker/v1/check/receipts</code> and <code>/api/burnticker/v1/check/receipts/&lt;signature&gt;</code>. The checklist is also kept as a document: <RepoText text="docs/burnticker/CHECK-THIS-YOURSELF.md" />.</p>
    </main>
  );
}
