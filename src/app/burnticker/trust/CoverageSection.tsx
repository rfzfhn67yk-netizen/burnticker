"use client";

import { useEffect, useState } from "react";
import type { CoverageMatrix, Verdict } from "@/lib/burnticker/coverage/types";

/**
 * THE TRUST PAGE'S "SETTLEMENT COVERAGE" SECTION (2026-10-10). Reads GET /api/burnticker/v1/coverage — the same matrix
 * docs/burnticker/SETTLEMENT-COVERAGE.md is rendered from — and shows, per category, whether a coin can be settled on a primary source
 * with an independent cross-read, only on Polymarket's on-chain payout vector, or not at all, with the sources, their operators and the
 * 90-day dry run. Facts only; n/a says why.
 */
const VERDICT_CLASS: Record<Verdict, string> = { settleable: "text-emerald-400", "adjudicated-only": "text-amber-300", uncovered: "text-red-400" };
const VERDICT_TEXT: Record<Verdict, string> = { settleable: "settleable", "adjudicated-only": "adjudicated-only (Polymarket)", uncovered: "uncovered" };
const pct = (x: number | null) => (x === null ? "n/a" : `${(x * 100).toFixed(x === 0 || x === 1 ? 0 : 1)}%`);

export default function CoverageSection({ card }: { card: string }) {
  const [m, setM] = useState<CoverageMatrix | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { fetch("/api/burnticker/v1/coverage").then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? r.statusText); setM(j); }).catch((e) => setErr(String(e.message ?? e))); }, []);
  if (err) return <section className={card}><h2 className="font-medium">Settlement coverage</h2><p className="text-xs text-red-400">{err}</p></section>;
  if (!m) return <section className={card}><h2 className="font-medium">Settlement coverage</h2><p className="text-xs text-neutral-500">Loading…</p></section>;
  return (
    <section className={card}>
      <h2 className="font-medium">Settlement coverage</h2>
      <p className="text-xs text-neutral-300">{m.rule}</p>
      <p className="text-xs text-neutral-400 mt-1">{m.summary.settleable} settleable · {m.summary.adjudicatedOnly} adjudicated-only · {m.summary.uncovered} uncovered · no first-party source: {m.summary.withoutPrimary.join(", ") || "none"} · {m.mode} ({m.generatedAt.slice(0, 10)}) · taxonomy <code>{m.taxonomy.file}</code></p>
      <div className="overflow-x-auto mt-2"><table className="w-full text-xs"><thead className="text-neutral-400 text-left"><tr><th className="p-2">Category</th><th className="p-2">Verdict</th><th className="p-2">Primary sources (operator · 90-day hit rate)</th><th className="p-2">Independent cross-reads (disagreement)</th><th className="p-2">Polymarket</th></tr></thead>
        <tbody>{m.categories.map((c) => (
          <tr key={c.id} className="border-t border-neutral-800 align-top">
            <td className="p-2">{c.label}</td>
            <td className={`p-2 ${VERDICT_CLASS[c.verdict]}`}>{VERDICT_TEXT[c.verdict]}</td>
            <td className="p-2">{c.primaries.length ? c.primaries.map((p) => <div key={p.id}><code>{p.id}</code> <span className="text-neutral-500">{p.operator} · {pct(p.dryRun?.hitRate ?? null)}</span></div>) : <span className="text-neutral-500">none</span>}</td>
            <td className="p-2">{c.crossReads.length ? c.crossReads.map((x) => { const d = c.primaries.find((p) => p.id === x.of)?.dryRun; return <div key={`${x.of}-${x.id}`}><code>{x.id}</code> <span className="text-neutral-500">of {x.of} · {d?.crossRead.id === x.id ? pct(d.crossRead.disagreementRate) : "n/a"}</span></div>; }) : <span className="text-neutral-500">none</span>}</td>
            <td className="p-2">{c.polymarket.tags.join(", ") || <span className="text-neutral-500">none</span>}</td>
          </tr>))}</tbody></table></div>
      {m.uncovered.length > 0 && <details className="mt-2 text-xs"><summary className="cursor-pointer text-neutral-300">What cannot be settled today ({m.uncovered.length})</summary><ul className="list-disc pl-5 mt-1 space-y-1">{m.uncovered.map((u) => <li key={`${u.category}-${u.kind}`}><span className="text-neutral-400">{m.categories.find((c) => c.id === u.category)?.label ?? u.category} · {u.kind}:</span> {u.why}</li>)}</ul></details>}
      <p className="text-xs text-neutral-500 mt-2">Kalshi is never a primary or a cross-read: its terms forbid settling products on its data. JSON: <code>/api/burnticker/v1/coverage</code> · full table: <code>docs/burnticker/SETTLEMENT-COVERAGE.md</code>.</p>
    </section>
  );
}
