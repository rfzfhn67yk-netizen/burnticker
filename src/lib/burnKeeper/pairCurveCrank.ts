import type { Keypair } from "@solana/web3.js";
import { fetchPairs, STATUS_GRADUATED, STATUS_GRADUATING, STATUS_OPEN } from "@/lib/pairCurve/accounts";
import { crankPair, type CrankStep, type PairCurveContext } from "@/lib/pairCurve/client";

/**
 * THE KEEPER'S PAIR-CURVE CRANK (2026-10-10; docs/burnticker/PAIR-CURVE.md §5). Program mode only, behind
 * BURNTICKER_PAIR_CURVE_ENABLED=1. Every cycle it scans the pair_curve program's Pair accounts (getProgramAccounts with the Pair
 * discriminator and a status filter — no registry needed; every action is permissionless, so the keeper cranks any pair, not only
 * ours) and, per pair, sends what `planPairCrank` says:
 *
 *   Open, ready, before the deadline  → graduate(A) + register_pair_pool(A), then graduate(B) + register_pair_pool(B)
 *   Graduating                        → the missing side (and its registration)
 *   Graduated ≤ 7 days ago            → any registration still missing (a third-party cranker may have graduated without it)
 *   Open at/after the deadline        → void_pair
 *
 * Each transaction is simulated first; a refusal is logged and retried next cycle (graduation can be un-met by a trade between the
 * scan and the send — that is a wait, not an error). The keeper's key pays only transaction fees: every rent and fee is paid from
 * the pair's raise by the program. Dry run simulates and sends nothing.
 */

export const PAIR_CURVE_FLAG = "BURNTICKER_PAIR_CURVE_ENABLED";
export const pairCurveEnabled = (env: Record<string, string | undefined>): boolean => /^(1|true|yes|on)$/i.test((env[PAIR_CURVE_FLAG] ?? "").trim());
export const RECENT_GRADUATION_SECS = 7 * 86_400;

export interface PairCurveCrankDeps {
  ctx: PairCurveContext;
  cranker: Keypair;
  dryRun: boolean;
  log: (line: string) => void;
  now?: () => number;
}

export interface PairCurveCycle { scanned: number; acted: { pair: string; steps: CrankStep[] }[]; errors: string[] }

export async function crankPairCurves(d: PairCurveCrankDeps): Promise<PairCurveCycle> {
  const now = Math.floor((d.now ?? Date.now)() / 1000);
  const out: PairCurveCycle = { scanned: 0, acted: [], errors: [] };
  let pairs: Awaited<ReturnType<typeof fetchPairs>> = [];
  try {
    for (const status of [STATUS_OPEN, STATUS_GRADUATING, STATUS_GRADUATED]) pairs.push(...(await fetchPairs(d.ctx.connection, { programId: d.ctx.programId, status })));
  } catch (e) {
    out.errors.push(`scan: ${(e as Error).message.slice(0, 160)}`);
    return out;
  }
  pairs = pairs.filter(({ pair }) => pair.status !== STATUS_GRADUATED || now - Number(pair.graduated_at) <= RECENT_GRADUATION_SECS);
  out.scanned = pairs.length;
  for (const { address } of pairs) {
    try {
      const steps = await crankPair(d.ctx, d.cranker, address, { now, dryRun: d.dryRun, log: d.log });
      if (steps.some((s) => s.result)) out.acted.push({ pair: address.toBase58(), steps });
    } catch (e) {
      out.errors.push(`${address.toBase58().slice(0, 8)}…: ${(e as Error).message.slice(0, 160)}`);
    }
  }
  return out;
}
