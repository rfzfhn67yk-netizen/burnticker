"use client";

import { useMemo, useState } from "react";
import { DEFAULT_CAP_LAMPORTS, LAMPORTS, parseCalcInputs, simulateCrank, sol, type CalcField } from "@/lib/burnticker/burnMath";

/**
 * THE BURN CALCULATOR (website brief 2026-10-11 §6): hypothetical inputs, the program's own arithmetic (burnMath.ts → burnReceipts/
 * math.ts). Defaults are the real 2026-10-06 devnet receipt (23 units, 1 %, a 0.5056 SOL burn pool, a 1.0066 SOL trading-pool reserve),
 * so the first screen reproduces a real burn; every field can be changed. A token amount appears only once hypothetical pool
 * reserves are entered, and is labelled an estimate. Audit 4 (BT-06): every field is validated (parseCalcInputs: exact decimals, a range,
 * never a silent clamp or substitution); while any field is invalid the field says why and no result is shown.
 */

export function BurnMath({ defaultPercent = "1" }: { defaultPercent?: string }) {
  const [riseB, setRiseB] = useState("23.92014814069"), [pct, setPct] = useState(defaultPercent), [pool, setPool] = useState("0.505583582"), [reserve, setReserve] = useState("1.0066192"), [tokRes, setTokRes] = useState("");
  const parsed = useMemo(() => parseCalcInputs({ riseB, pct, pool, reserve, tokRes }), [riseB, pct, pool, reserve, tokRes]);
  const r = useMemo(() => {
    if (!parsed.ok) return null;
    const v = parsed.values;
    return { bps: v.bps, out: simulateCrank({ prev: BigInt(0), now: v.riseCents, carryIn: BigInt(0), unit: BigInt(100_000_000_000), carry: "consecutive", fractionBps: v.bps, poolLamports: v.poolLamports, capLamports: DEFAULT_CAP_LAMPORTS, carriedInLamports: BigInt(0), floorLamports: LAMPORTS / BigInt(200), reserveSolLamports: v.reserveLamports, assumedReserveTokenRaw: v.tokenReserveRaw }) };
  }, [parsed]);
  const input = "mt-1 w-full rounded border bg-neutral-950 px-2 py-1 font-mono text-sm";
  const field = (id: CalcField, label: string, value: string, set: (v: string) => void, placeholder?: string) => {
    const err = parsed.errors[id];
    return (<label key={id}>{label}<input className={`${input} ${err ? "border-red-500" : "border-neutral-700"}`} inputMode="decimal" value={value} placeholder={placeholder} aria-invalid={err ? true : undefined} aria-describedby={err ? `bm-${id}-err` : undefined} onChange={(e) => set(e.target.value)} />{err && <span id={`bm-${id}-err`} className="mt-0.5 block text-red-400" data-field-error={id}>{err}</span>}</label>);
  };
  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-3 text-sm" id="math" aria-label="Burn arithmetic" data-burn-math>
      <h2 className="font-medium">How a burn is computed</h2>
      <p className="text-xs text-neutral-400">A share of the spendable burn pool buys the coin and every token bought is burned. It is not a fixed share of the token supply. Hypothetical inputs go in the fields below. The first values come from the real devnet receipt of 2026-10-06. That rehearsal coin spent 1% of the burn pool per unit, and the rule locked for $DEFICIT on mainnet is 2%. Holders&apos; balances are never touched. Only tokens the program bought are burned.</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-5 text-xs text-neutral-400">
        {field("riseB", "Debt rise ($B)", riseB, setRiseB)}
        {field("pct", "Per unit (%)", pct, setPct)}
        {field("pool", "Burn pool (SOL)", pool, setPool)}
        {field("reserve", "Trading pool SOL reserve", reserve, setReserve)}
        {field("tokRes", "Token reserve (hypothetical, optional)", tokRes, setTokRes, "leave empty")}
      </div>
      {!r ? <p className="mt-3 text-xs text-amber-300" role="status" data-burn-math-invalid>No result is shown while a field is invalid. Fix the field marked in red. The calculator never substitutes a different value for the one you typed.</p> : (() => { const o = r.out; const carries = !o.belowFloor && o.carriedOut > BigInt(0); return (
      <ol className="mt-3 list-decimal pl-5 space-y-1 text-xs text-neutral-200">
        <li><b>Qualifying units:</b> {o.units.toString()} (each full $1B counts once, and the remainder carries over only while the debt keeps rising).</li>
        <li><b>Available budget:</b> {sol(o.budget)} SOL{o.capBound ? " (the default burn-pool cap of 25 SOL applies)" : ""}.</li>
        <li><b>Planned spend:</b> {sol(o.ruleSpend)} SOL = budget × (1 − (1 − {r.bps / 100}%)^{o.units.toString()}). Compounding: {o.units.toString()} units × {r.bps / 100}% would be {sol(o.naiveSpend)} SOL; each unit spends its share of what the previous one left.</li>
        <li><b>Actual purchase:</b> {o.belowFloor ? "nothing, because the spend is under the floor fixed at launch, so the pool keeps the SOL" : `${sol(o.spend)} SOL`}{carries ? `. One run spends at most 2% of the trading pool's SOL reserve (${sol(o.reserveCap)} SOL), so ${sol(o.carriedOut)} SOL carries over to the next run` : ""}.</li>
        <li><b>Actual burn:</b> every token the purchase received. {o.estimatedTokensRaw !== null ? <>With your hypothetical reserves, that is about {(Number(o.estimatedTokensRaw) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 2 })} tokens. This estimate uses the constant-product formula after a 0.25% pool fee, and it is not a quote.</> : <>The number of tokens depends on the trading pool&apos;s reserves at the moment of the run. Enter a hypothetical token reserve to estimate it.</>}</li>
      </ol>); })()}
    </section>
  );
}
