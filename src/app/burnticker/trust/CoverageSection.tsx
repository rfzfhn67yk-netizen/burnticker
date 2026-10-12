"use client";

import { EmptyState } from "../_components/EmptyState";
import { useJsonRead, ReadFailurePanel } from "../_components/useJsonRead";
import { RepoText } from "../_components/RepoText";
import type { CoverageMatrix, Verdict } from "@/lib/burnticker/coverage/types";

/**
 * THE TRUST PAGE'S "SETTLEMENT COVERAGE" SECTION (2026-10-10). Reads GET /api/burnticker/v1/coverage — the same matrix
 * docs/burnticker/SETTLEMENT-COVERAGE.md is rendered from — and shows, per category, whether a coin can be settled on a primary source
 * with an independent cross-read, only on Polymarket's on-chain payout vector, or not at all, with the sources, their operators and the
 * 90-day dry run. Facts only; a missing figure says "no data".
 */
const VERDICT_CLASS: Record<Verdict, string> = { settleable: "text-emerald-400", "adjudicated-only": "text-amber-300", uncovered: "text-red-400" };
const VERDICT_TEXT: Record<Verdict, string> = { settleable: "can be settled", "adjudicated-only": "Polymarket payout only", uncovered: "not covered" };
const pct = (x: number | null) => (x === null ? "no data" : `${(x * 100).toFixed(x === 0 || x === 1 ? 0 : 1)}%`);
const categories = (n: number) => `${n} ${n === 1 ? "category" : "categories"}`;

export default function CoverageSection({ card }: { card: string }) {
  const { data: m, failure, loading, triedAt, retry } = useJsonRead<CoverageMatrix>("/api/burnticker/v1/coverage");
  if (failure) return <section className={card}><h2 className="font-medium">Settlement coverage</h2><ReadFailurePanel what="The coverage table" failure={failure} triedAt={triedAt} loading={loading} retry={retry} /></section>;
  if (!m) return <section className={card}><h2 className="font-medium">Settlement coverage</h2><EmptyState compact kind="loading" /></section>;
  return (
    <section className={card}>
      <h2 className="font-medium">Settlement coverage</h2>
      <p className="text-xs text-neutral-300">{m.rule}</p>
      <p className="text-xs text-neutral-400 mt-1">{categories(m.summary.settleable)} can be settled, {categories(m.summary.adjudicatedOnly)} only on a Polymarket payout, and {categories(m.summary.uncovered)} not at all. {m.summary.withoutPrimary.length ? `These have no first-party source: ${m.summary.withoutPrimary.join(", ")}.` : "Every category has a first-party source."} The table was built on {m.generatedAt.slice(0, 10)} from {m.mode === "live" ? "live reads of each source" : "saved copies of each source"}, using the categories in <code>{m.taxonomy.file}</code>.</p>
      <div className="overflow-x-auto mt-2"><table className="w-full text-xs"><thead className="text-neutral-400 text-left"><tr><th className="p-2">Category</th><th className="p-2">Verdict</th><th className="p-2">Primary sources, with operator and 90-day hit rate</th><th className="p-2">Independent cross-reads, with disagreement rate</th><th className="p-2">Polymarket</th></tr></thead>
        <tbody>{m.categories.map((c) => (
          <tr key={c.id} className="border-t border-neutral-800 align-top">
            <td className="p-2">{c.label}</td>
            <td className={`p-2 ${VERDICT_CLASS[c.verdict]}`}>{VERDICT_TEXT[c.verdict]}</td>
            <td className="p-2">{c.primaries.length ? c.primaries.map((p) => <div key={p.id}><code>{p.id}</code> <span className="text-neutral-500">{p.operator}, {pct(p.dryRun?.hitRate ?? null)}</span></div>) : <span className="text-neutral-500">none</span>}</td>
            <td className="p-2">{c.crossReads.length ? c.crossReads.map((x) => { const d = c.primaries.find((p) => p.id === x.of)?.dryRun; return <div key={`${x.of}-${x.id}`}><code>{x.id}</code> <span className="text-neutral-500">of {x.of}, {d?.crossRead.id === x.id ? pct(d.crossRead.disagreementRate) : "no data"}</span></div>; }) : <span className="text-neutral-500">none</span>}</td>
            <td className="p-2">{c.polymarket.tags.join(", ") || <span className="text-neutral-500">none</span>}</td>
          </tr>))}</tbody></table></div>
      {m.uncovered.length > 0 && <details className="mt-2 text-xs"><summary className="cursor-pointer text-neutral-300">What cannot be settled today</summary><ul className="list-disc pl-5 mt-1 space-y-1">{m.uncovered.map((u) => <li key={`${u.category}-${u.kind}`}><span className="text-neutral-400">{m.categories.find((c) => c.id === u.category)?.label ?? u.category}, {u.kind}:</span> {u.why}</li>)}</ul></details>}
      <p className="text-xs text-neutral-500 mt-2">Kalshi is never a primary source or a cross-read, because its terms forbid settling products on its data. The data behind this table is at <code>/api/burnticker/v1/coverage</code>, and the full table is in <RepoText text="docs/burnticker/SETTLEMENT-COVERAGE.md" />.</p>
    </section>
  );
}
