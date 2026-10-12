import type { Metadata } from "next";
import Link from "next/link";
import { platform } from "@/lib/burnticker/server";
import { derbyStore } from "@/lib/burnticker/derby/store";
import { derbyTournamentJson, type DerbyTournamentJson } from "@/lib/burnticker/derby/page";
import type { Tournament } from "@/lib/burnticker/derby/bracket";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Burn Derby bracket", description: "A Burn Derby bracket. In each round, coins meet in one-on-one matches. A fan coin burns on each day its coin wins, and the fan coin of the coin that loses the match retires." };

/**
 * THE BRACKET PAGE (Burn Derby, 2026-10-10): every round, every match with its day strip (A / B / tie / withheld / open), who advanced and
 * why (more winning days; tiebreak: the compounded % change over the round, then the lower seed), the fan coins that retired (no further
 * readings), the final's doubled burn and the champion. Read from the registry and the derby store; the same JSON is GET /v1/derby/{id}.
 */
export default async function BracketPage({ params }: { params: Promise<{ tournamentId: string }> }) {
  const { tournamentId } = await params;
  let t: DerbyTournamentJson | null = null, err: string | null = null;
  try {
    const p = platform();
    const row = derbyStore(p.registry.db).tournament(decodeURIComponent(tournamentId));
    if (row) t = derbyTournamentJson(p.registry, JSON.parse(row.json) as Tournament, row.sha256);
  } catch (e) { err = e instanceof Error ? e.message : String(e); }
  if (err) return <main className="p-6 text-red-400 text-sm">The coin registry could not be read just now. The error was: {err}</main>;
  if (!t) return <main className="p-6 text-neutral-400 text-sm">There is no Burn Derby bracket called {tournamentId}. <Link className="underline" href="/burnticker/rivalries">See the scoreboards</Link>.</main>;
  const cell = (r: string) => (r === "A" ? "bg-amber-500 text-neutral-950" : r === "B" ? "bg-sky-500 text-neutral-950" : r === "tie" ? "bg-neutral-700" : r === "withheld" ? "bg-neutral-800 text-neutral-400" : "border border-dashed border-neutral-700 text-neutral-600");
  return (
    <main className="mx-auto max-w-6xl px-4 py-6 space-y-6 text-sm">
      <header className="space-y-1">
        <p className="text-xs"><Link className="underline" href="/burnticker">← Burnticker</Link></p>
        <h1 className="text-2xl font-semibold">{t.title}</h1>
        <p className="text-neutral-400 text-xs">This is Burn Derby bracket <code>{t.id}</code>. {t.size} coins play rounds of {t.roundDays} days, from {t.start} to {t.end}. {t.status === "upcoming" ? "The bracket has not started yet." : t.status === "complete" ? "The bracket is complete." : `The bracket is running${t.currentRound !== null ? `, in round ${t.currentRound + 1}` : ""}.`} A winning day burns {Math.round(t.fractionOfPool * 10_000) / 100}% of the fan coin&apos;s burn pool. In the final, a winning day burns {t.finalBurn}. The bracket&apos;s sha256 starts with {t.sha256.slice(0, 12)}…</p>
        {t.champion && <p className="text-amber-300">Champion: {t.champion.symbol}{t.champion.ticker ? ` ($${t.champion.ticker})` : ""}</p>}
      </header>
      <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${t.rounds.length}, minmax(0, 1fr))` }}>
        {t.rounds.map((r) => (
          <section key={r.index} className="space-y-3" aria-label={`Round ${r.index + 1}`}>
            <h2 className="text-xs uppercase tracking-wide text-neutral-400">{r.final ? "Final" : `Round ${r.index + 1}`} <span className="normal-case text-neutral-600">{r.start} to {r.end}</span></h2>
            {r.matches.map((m) => (
              <div key={m.index} className="rounded-lg border border-neutral-800 bg-neutral-900 p-2 space-y-1">
                {([[m.a, m.winsA, "A"], [m.b, m.winsB, "B"]] as const).map(([s, w, k]) => (
                  <div key={k} className={`flex items-center justify-between ${s && m.winner !== null && m.winner !== s.slot ? "text-neutral-500 line-through" : ""}`}>
                    <span>{s ? <>{s.symbol} {s.ticker ? <Link className="underline text-xs" href={`/burnticker/t/${s.ticker}`}>${s.ticker}</Link> : <span className="text-xs text-neutral-600">no fan coin</span>}</> : <span className="text-neutral-600">—</span>}</span>
                    <span className="tabular-nums">{s ? w : ""}</span>
                  </div>
                ))}
                <div className="flex flex-wrap gap-0.5">{m.days.map((d) => <span key={d.date} title={`${d.date}${d.changeA !== null ? `: ${d.changeA}% vs ${d.changeB}%` : ""}`} className={`inline-flex h-5 w-5 items-center justify-center rounded text-[10px] ${cell(d.result)}`}>{d.result === "open" ? "" : d.result === "withheld" ? "–" : d.result === "tie" ? "=" : d.result}</span>)}</div>
                {m.winner !== null && <p className="text-[11px] text-neutral-500">advances on {m.tiebreak === "wins" ? "winning days" : m.tiebreak === "cumulative" ? `the compounded change (${m.cumA}% vs ${m.cumB}%)` : "the lower seed"}</p>}
              </div>
            ))}
          </section>
        ))}
      </div>
      <section className="space-y-1">
        <h2 className="font-medium">Fan coins</h2>
        <ul className="divide-y divide-neutral-800 border border-neutral-800 rounded">{t.coins.map((c) => (
          <li key={c.slot} className="p-2 flex flex-wrap gap-x-3 text-xs"><span className="w-6 text-neutral-500">#{c.slot + 1}</span><span className="font-medium">{c.symbol}</span>{c.ticker ? <Link className="underline" href={`/burnticker/t/${c.ticker}`}>${c.ticker}</Link> : <span className="text-neutral-600">not launched</span>}<span className="text-neutral-500">{c.status === "retired" ? `retired (${c.retiredReason ?? "knocked out"}), with no further readings` : c.eliminatedInRound ? `knocked out in round ${c.eliminatedInRound}` : c.status ?? ""}</span></li>
        ))}</ul>
      </section>
      <p className="text-xs text-neutral-500">Readings come from Pyth, either from its Solana accounts or from a Hermes update with a key. A second data publisher checks each reading, and one signer, run by the operator, signs every reading. If the two sources disagree, that day is withheld.</p>
    </main>
  );
}
