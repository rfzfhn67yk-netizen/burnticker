"use client";

import { useMemo, useState } from "react";
import { DEFAULT_CAP_LAMPORTS, LAMPORTS, simulateCrank, sol } from "@/lib/burnticker/burnMath";

/**
 * THE BURN CALCULATOR (website brief 2026-10-11 §6): hypothetical inputs, the program's own arithmetic (burnMath.ts → burnReceipts/
 * math.ts). Defaults are the real 2026-10-06 devnet receipt (23 units, 1 %, a 0.5056 SOL burn pool, a 1.0066 SOL trading-pool reserve),
 * so the first screen reproduces a real burn; every field can be changed. A token amount appears only once hypothetical pool
 * reserves are entered, and is labelled an estimate.
 */
const toL = (s: string): bigint => { const n = Number(s); return Number.isFinite(n) && n > 0 ? BigInt(Math.round(n * 1e9)) : BigInt(0); };

export function BurnMath({ defaultPercent = "1" }: { defaultPercent?: string }) {
  const [riseB, setRiseB] = useState("23.92014814069"), [pct, setPct] = useState(defaultPercent), [pool, setPool] = useState("0.505583582"), [reserve, setReserve] = useState("1.0066192"), [tokRes, setTokRes] = useState("");
  const r = useMemo(() => {
    const cents = BigInt(Math.round(Math.max(0, Number(riseB) || 0) * 1e11));
    const bps = Math.min(10_000, Math.max(1, Math.round((Number(pct) || 0) * 100)));
    const tr = Number(tokRes) > 0 ? BigInt(Math.round(Number(tokRes) * 1e6)) : null;
    return { bps, out: simulateCrank({ prev: BigInt(0), now: cents, carryIn: BigInt(0), unit: BigInt(100_000_000_000), carry: "consecutive", fractionBps: bps, poolLamports: toL(pool), capLamports: DEFAULT_CAP_LAMPORTS, carriedInLamports: BigInt(0), floorLamports: LAMPORTS / BigInt(200), reserveSolLamports: toL(reserve), assumedReserveTokenRaw: tr }) };
  }, [riseB, pct, pool, reserve, tokRes]);
  const o = r.out, input = "mt-1 w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1 font-mono text-sm";
  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-3 text-sm" id="math" aria-label="Burn arithmetic" data-burn-math>
      <h2 className="font-medium">How a burn is computed</h2>
      <p className="text-xs text-neutral-400">A share of the spendable burn pool buys the coin and every token bought is burned. It is not a fixed share of the token supply. Hypothetical inputs; the first values are the real 2026-10-06 devnet receipt. Holders&apos; balances are never touched: only tokens the program bought are burned.</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-5 text-xs text-neutral-400">
        <label>Debt rise ($B)<input className={input} inputMode="decimal" value={riseB} onChange={(e) => setRiseB(e.target.value)} /></label>
        <label>Per unit (%)<input className={input} inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} /></label>
        <label>Burn pool (SOL)<input className={input} inputMode="decimal" value={pool} onChange={(e) => setPool(e.target.value)} /></label>
        <label>Trading pool SOL reserve<input className={input} inputMode="decimal" value={reserve} onChange={(e) => setReserve(e.target.value)} /></label>
        <label>Token reserve (hypothetical, optional)<input className={input} inputMode="decimal" value={tokRes} placeholder="leave empty" onChange={(e) => setTokRes(e.target.value)} /></label>
      </div>
      <ol className="mt-3 list-decimal pl-5 space-y-1 text-xs text-neutral-200">
        <li><b>Qualifying units:</b> {o.units.toString()} (each full $1B; the remainder carries only while the debt keeps rising).</li>
        <li><b>Available budget:</b> {sol(o.budget)} SOL{o.capBound ? " (the pre-audit cap of 25 SOL applies)" : ""}.</li>
        <li><b>Planned spend:</b> {sol(o.ruleSpend)} SOL = budget × (1 − (1 − {r.bps / 100}%)^{o.units.toString()}). Compounding: {o.units.toString()} units × {r.bps / 100}% would be {sol(o.naiveSpend)} SOL; each unit spends its share of what the previous one left.</li>
        <li><b>Actual purchase:</b> {o.belowFloor ? "nothing: under the spend floor fixed at launch; the pool keeps the SOL" : `${sol(o.spend)} SOL`}{!o.belowFloor && o.carriedOut > BigInt(0) ? ` — one crank spends at most 2% of the trading pool's SOL reserve (${sol(o.reserveCap)} SOL); ${sol(o.carriedOut)} SOL carries to the next crank` : ""}.</li>
        <li><b>Actual burn:</b> every token the purchase received. {o.estimatedTokensRaw !== null ? <>Estimate with your hypothetical reserves: about {(Number(o.estimatedTokensRaw) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 2 })} tokens (constant-product, after a 0.25% pool fee; not a quote).</> : <>The number of tokens depends on the trading pool&apos;s reserves at the moment of the crank; enter a hypothetical token reserve to estimate it.</>}</li>
      </ol>
    </section>
  );
}
