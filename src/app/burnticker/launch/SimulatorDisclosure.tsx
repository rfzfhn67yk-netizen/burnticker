"use client";

import { useMemo, useState } from "react";
import type { BurnRule } from "@/lib/burnticker/rules";
import { simulateResults, SIM_DEFAULT_POOL_SOL, type Simulation } from "@/lib/burnticker/simulator";

/** The disclosure's summary and the input's label (WIRING-FEATURES item 6). */
export const SIMULATOR_LABEL = "What one result does";
export const SIMULATOR_POOL_LABEL = "Hypothetical SOL in the burn pool";
export const SIMULATOR_INTRO = "Each row is one way a reading can come out, worked through the burn program's own arithmetic for the amount of SOL you put in.";

/**
 * WEBSITE-26 (WIRING-FEATURES item 6): the result simulator, a CLOSED disclosure under the rule summary. The review's own answer
 * (review.simulation, worked for 1 SOL) is shown until the reader types another amount; then simulateResults (client-safe) runs in the
 * browser with the same rule and the same pair setting the review used. A pair shows both coins in every row. A value that is not a plain
 * number is refused with the simulator's own reason.
 */
export function SimulatorDisclosure({ simulation, rule }: { simulation: Simulation | null | undefined; rule: BurnRule | null }) {
  const [pool, setPool] = useState(SIM_DEFAULT_POOL_SOL);
  const sim = useMemo(() => {
    if (!simulation || !rule || pool.trim() === (simulation.poolSol ?? SIM_DEFAULT_POOL_SOL)) return simulation ?? null;
    const coins = simulation.rows[0]?.coins ?? [];
    const tA = coins[0]?.ticker ?? "A", tB = coins[1]?.ticker ?? "B";
    return simulateResults(rule, { poolSol: pool.trim(), tradingPoolSol: simulation.tradingPoolSol, ticker: tA, pair: simulation.pair ? { tickerA: tA, tickerB: tB, winnerTakesBurn: simulation.pair === "winner-takes-the-burn" } : null });
  }, [simulation, rule, pool]);
  if (!simulation) return null;
  return (
    <details className="min-w-0 rounded-lg border border-neutral-800 p-3 text-xs text-neutral-300" data-simulator>
      <summary className="cursor-pointer text-sm text-neutral-200">{SIMULATOR_LABEL}</summary>
      <p className="mt-2">{SIMULATOR_INTRO}</p>
      <label className="mt-2 block text-neutral-400">{SIMULATOR_POOL_LABEL}
        <input inputMode="decimal" className="mt-1 block w-32 rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-100" value={pool} onChange={(e) => setPool(e.target.value)} aria-describedby="bt-sim-status" data-simulator-pool />
      </label>
      {sim && !sim.available ? <p id="bt-sim-status" className="mt-2 text-amber-300" role="status" data-simulator-refused>{sim.reason}</p> : sim && (
        <>
          <p id="bt-sim-status" className="sr-only" role="status">{`Worked for ${sim.poolSol} SOL.`}</p>
          <ol className="mt-2 min-w-0 space-y-2" data-simulator-rows>
            {sim.rows.map((r) => (
              <li key={r.case} className="min-w-0 rounded border border-neutral-800 p-2" data-sim-case={r.case}>
                <p className="font-medium text-neutral-100">{r.label}</p>
                {r.coins.length > 1 ? (
                  <div className="mt-1 grid min-w-0 gap-2 md:grid-cols-2">{r.coins.map((c) => <CoinCell key={c.side} c={c} />)}</div>
                ) : <p className="mt-1 break-words">{r.line}</p>}
                {r.coins.length === 1 && r.coins[0].burns && <p className="mt-1 text-neutral-500">{`Spent ${r.coins[0].spendSol} SOL. ${r.coins[0].waitsSol !== "0" ? `${r.coins[0].waitsSol} SOL waits. ` : ""}${r.coins[0].poolAfterSol} SOL stays in the pool.`}</p>}
              </li>
            ))}
          </ol>
          <p className="mt-2 text-neutral-500" data-simulator-note>{sim.note}</p>
        </>
      )}
    </details>
  );
}

function CoinCell({ c }: { c: Simulation["rows"][number]["coins"][number] }) {
  return (
    <div className="min-w-0 break-words rounded bg-neutral-950 p-2" data-sim-coin={c.side}>
      <p className="font-mono text-neutral-200">${c.ticker}</p>
      <p className="mt-0.5">{c.line}</p>
      {(c.burns || c.sentSol !== "0") && <p className="mt-0.5 text-neutral-500">{`Spent ${c.spendSol} SOL.${c.receivedSol !== "0" ? ` Received ${c.receivedSol} SOL.` : ""}${c.sentSol !== "0" ? ` Sent ${c.sentSol} SOL.` : ""}${c.waitsSol !== "0" ? ` ${c.waitsSol} SOL waits.` : ""} ${c.poolAfterSol} SOL stays in the pool.`}</p>}
    </div>
  );
}
