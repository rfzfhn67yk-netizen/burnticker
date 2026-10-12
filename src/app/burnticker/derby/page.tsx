import type { Metadata } from "next";
import Link from "next/link";
import { platform } from "@/lib/burnticker/server";
import { derbyPairJson, tournamentSummaries, type DerbyPairJson } from "@/lib/burnticker/derby/page";
import { PAIR_BURN_SENTENCE } from "@/lib/burnticker/describe";
import { NO_WALLET_LINE } from "@/lib/burnticker/glossary";
import { launchAvailability } from "@/lib/burnticker/creatorLaunches";
import { EXPLORE_VERIFIED_BURN } from "@/lib/burnticker/currentStatusLinks";
import { SeasonsTabs } from "../_components/SeasonsTabs";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Burn Derby", description: "Coin vs Coin pairs and brackets. In a pair, fees from both coins burn the coin whose rule the day's result fires. The receipts are the scoreboard." };

/**
 * BURN DERBY — THE INDEX (2026-10-10): open coin-vs-coin pairs (score as a receipt tally, the last days as a strip, the season end), active
 * brackets, and below them the pairs and brackets that ended (retired, voided, season over). Plain receipts vocabulary: what each coin's
 * supply did, never odds or anything paid out. Read from the registry and the derby store (the same data as GET /v1/derby).
 */
interface Row { j: DerbyPairJson; a: string; b: string; statusA: string; statusB: string }

export default async function DerbyIndex({ searchParams }: { searchParams: Promise<{ a?: string; b?: string }> }) {
  const sp = await searchParams;
  // audit 4 BT-10: the creation CTA matches the launch state — while creator launches are closed it says so and is not a link
  const launchOpen = launchAvailability().open;
  const want = sp.a && sp.b ? [sp.a.toUpperCase(), sp.b.toUpperCase()] : null;
  let rows: Row[] = [], brackets: ReturnType<typeof tournamentSummaries> = [], err: string | null = null;
  try {
    const p = platform();
    const now = Date.now();
    rows = p.registry.pairs().filter((pr) => pr.selectorKey.startsWith("derby:")).flatMap((pr) => {
      const ta = p.registry.token(pr.mintA), tb = p.registry.token(pr.mintB);
      if (!ta || !tb) return [];
      const rc = (m: string) => p.registry.receipts(m).map((r) => ({ eventId: r.eventId, status: r.status, burned: null, signature: r.signature, txUrl: null, units: r.units }));
      const j = derbyPairJson(p.registry, pr, rc(pr.mintA), rc(pr.mintB), now);
      return j ? [{ j, a: ta.ticker, b: tb.ticker, statusA: ta.status, statusB: tb.status }] : [];
    });
    brackets = tournamentSummaries(p.registry, now);
  } catch (e) { err = e instanceof Error ? e.message : String(e); }
  const ended = (r: Row) => r.statusA === "retired" || r.statusB === "retired" || r.j.season.over;
  const open = rows.filter((r) => !ended(r)), done = rows.filter(ended);
  const matches = (r: Row) => !!want && r.j.symbols.a === want[0] && r.j.symbols.b === want[1];
  const cell = (w: string | null, st: string) => (st === "withheld" ? "bg-neutral-800 text-neutral-400" : w === "A" ? "bg-amber-500 text-neutral-950" : w === "B" ? "bg-sky-500 text-neutral-950" : "bg-neutral-700");
  const pairRow = (r: Row) => (
    <li key={r.j.pairId} className={`p-3 space-y-1 ${matches(r) ? "bg-neutral-900" : ""}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Link className="font-mono text-lg underline" href={`/burnticker/p/${encodeURIComponent(r.j.pairId)}`}>${r.a} vs ${r.b}</Link>
        <span className="text-xs text-neutral-400">{r.j.symbols.a} vs {r.j.symbols.b} · {r.j.window}{r.j.flip ? " · one-shot flippening" : ""} · season ends {r.j.season.endsOn}</span>
      </div>
      <div className="text-sm tabular-nums">burn days {r.j.symbols.a} {r.j.score.a} – {r.j.score.b} {r.j.symbols.b} <span className="text-xs text-neutral-500">· {r.j.score.ties} {r.j.score.ties === 1 ? "tie" : "ties"} · {r.j.score.withheld} withheld · {r.j.season.windowsDone} of {r.j.season.windows} windows read</span></div>
      <div className="flex flex-wrap gap-1" aria-label="Last days">{r.j.days.slice(-14).map((d) => <span key={d.windowId} title={d.windowId} className={`inline-flex h-5 w-5 items-center justify-center rounded text-[10px] ${cell(d.winner, d.status)}`}>{d.status === "withheld" ? "–" : d.winner === "tie" ? "=" : d.winner ?? ""}</span>)}</div>
      {(r.statusA === "retired" || r.statusB === "retired") && <p className="text-xs text-neutral-500">{r.j.retired.a ? `$${r.a} retired: ${r.j.retired.a}. ` : ""}{r.j.retired.b ? `$${r.b} retired: ${r.j.retired.b}.` : ""}</p>}
    </li>
  );
  return (
    <main className="mx-auto max-w-5xl px-4 py-6 space-y-6">
      <header className="space-y-2">
        <SeasonsTabs current="/burnticker/derby" />
        <h1 className="text-2xl font-semibold">Burn Derby</h1>
        <p className="text-neutral-400 text-sm max-w-3xl">Each pair compares two coins people already hold, once every UTC day or once every week. The values come from Pyth&apos;s feeds or from a pool&apos;s time-weighted average. A second data publisher checks each value. That second source is a check on the data. It is not a second signer: one signer, run by the operator, signs every reading. A tie burns neither coin. The receipts are the scoreboard.</p>
        <p className="text-amber-200 text-sm max-w-3xl" aria-label="pair rule">{PAIR_BURN_SENTENCE}</p>
        <p className="text-neutral-500 text-xs">{NO_WALLET_LINE}</p>
        {launchOpen
          ? <Link className="inline-block rounded bg-amber-400 px-4 py-2 text-sm font-semibold text-neutral-950" href={`/burnticker/launch?derby=1${want ? `&a=${encodeURIComponent(want[0])}&b=${encodeURIComponent(want[1])}` : ""}`}>Set up a Coin vs Coin pair</Link>
          : <p className="text-sm text-neutral-300" data-launch-closed>You cannot create a Coin vs Coin pair right now, because creator launches are closed. In the meantime, you can still look at a real receipt. <Link className="underline" href={EXPLORE_VERIFIED_BURN.href}>{EXPLORE_VERIFIED_BURN.label}</Link>.</p>}
      </header>
      {err && <p className="text-red-400 text-sm">The coin registry could not be read just now. The error was: {err}</p>}
      {want && !rows.some(matches) && <p className="text-sm text-neutral-400 border border-neutral-800 rounded p-3">No {want[0]} vs {want[1]} pair yet. {launchOpen ? <Link className="underline" href={`/burnticker/launch?derby=1&a=${encodeURIComponent(want[0])}&b=${encodeURIComponent(want[1])}`}>Set one up with Coin vs Coin</Link> : "You cannot create one while creator launches are closed."}</p>}
      <section className="space-y-2">
        <h2 className="font-medium">Open pairs</h2>
        {open.length ? <ul className="divide-y divide-neutral-800 border border-neutral-800 rounded">{open.map(pairRow)}</ul> : <p className="text-sm text-neutral-500">No open coin-vs-coin pairs yet.</p>}
      </section>
      <section className="space-y-2">
        <h2 className="font-medium">Brackets</h2>
        {brackets.filter((b) => b.status !== "complete").length ? (
          <ul className="divide-y divide-neutral-800 border border-neutral-800 rounded">{brackets.filter((b) => b.status !== "complete").map((b) => (
            <li key={b.id} className="p-3 flex flex-wrap items-baseline gap-x-4 gap-y-1"><Link className="underline font-medium" href={`/burnticker/derby/${b.id}`}>{b.title}</Link><span className="text-xs text-neutral-500">{b.size} coins · rounds of {b.roundDays} days · {b.start} to {b.end} · {b.status}{b.currentRound !== null ? ` · round ${b.currentRound + 1}` : ""}</span></li>
          ))}</ul>
        ) : <p className="text-sm text-neutral-500">No active brackets.</p>}
      </section>
      {(done.length > 0 || brackets.some((b) => b.status === "complete")) && (
        <section className="space-y-2">
          <h2 className="font-medium text-neutral-400">Ended pairs and brackets (retired, voided or past the season end)</h2>
          <ul className="divide-y divide-neutral-800 border border-neutral-800 rounded opacity-80">
            {done.map(pairRow)}
            {brackets.filter((b) => b.status === "complete").map((b) => <li key={b.id} className="p-3 text-sm"><Link className="underline" href={`/burnticker/derby/${b.id}`}>{b.title}</Link> <span className="text-xs text-neutral-500">complete{b.champion ? ` · last coin standing ${b.champion.symbol}` : ""}</span></li>)}
          </ul>
        </section>
      )}
    </main>
  );
}
