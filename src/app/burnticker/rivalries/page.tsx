import type { Metadata } from "next";
import Link from "next/link";
import { platform } from "@/lib/burnticker/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Rivalries", description: "Burnticker rivalry pairs: two coins on one settled event, each burning on its own side's result. The receipts are the scoreboard." };

/** RIVALRIES (2026-10-10): every registered pair, read from the registry. Each links to its pair page (/burnticker/p/<pairId>). */
export default function RivalriesPage() {
  let rows: { pairId: string; a: string; b: string; selectorKey: string; createdAt: number }[] = [];
  let err: string | null = null;
  try {
    const p = platform();
    rows = p.registry.pairs().map((pr) => ({ pairId: pr.pairId, a: p.registry.token(pr.mintA)?.ticker ?? pr.mintA.slice(0, 6), b: p.registry.token(pr.mintB)?.ticker ?? pr.mintB.slice(0, 6), selectorKey: pr.selectorKey, createdAt: pr.createdAt }));
  } catch (e) { err = e instanceof Error ? e.message : String(e); }
  return (
    <main className="mx-auto max-w-5xl px-4 py-6 space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Rivalries</h1>
        <p className="text-neutral-400 text-sm max-w-3xl">Two coins on one settled event — each burns on its own side&apos;s result, under its own locked rule. The receipts are the scoreboard; neither coin pays anything on any outcome.</p>
      </header>
      {err && <p className="text-red-400 text-sm">Registry unavailable: {err}</p>}
      {!err && rows.length === 0 && (
        <p className="text-sm text-neutral-400 border border-neutral-800 rounded p-4">No rivalry pairs yet. A pair is launched from the <Link className="underline" href="/burnticker/launch">wizard</Link> as two coins naming each other.</p>
      )}
      {rows.length > 0 && (
        <ul className="divide-y divide-neutral-800 border border-neutral-800 rounded">
          {rows.map((r) => (
            <li key={r.pairId} className="p-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <Link className="font-mono text-lg underline" href={`/burnticker/p/${encodeURIComponent(r.pairId)}`}>${r.a} vs ${r.b}</Link>
              <span className="font-mono text-xs text-neutral-500">{r.selectorKey}</span>
              <span className="text-xs text-neutral-500">since {new Date(r.createdAt).toISOString().slice(0, 10)}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-neutral-500 text-xs">Memecoin pairs. The rules say what each supply does, not what either price does. Nobody is promised anything.</p>
    </main>
  );
}
