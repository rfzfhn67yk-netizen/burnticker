import { type Keypair, PublicKey } from "@solana/web3.js";
import type { PairAccount } from "@/lib/pairCurve/accounts";
import { LP_LOCK_FALLBACK_SECS } from "@/lib/pairCurve/client";
import { fetchPairs, STATUS_GRADUATED, STATUS_GRADUATING, STATUS_OPEN, STATUS_VOIDED } from "@/lib/pairCurve/accounts";
import { assertPairCurveCluster, crankPair, simulateAndSend, type CrankStep, type PairCurveContext, type SendResult } from "@/lib/pairCurve/client";
import { configPda } from "@/lib/burnReceipts/pda";
import { fetchPairLink, linkPairIx, type PairLinkAccount } from "@/lib/burnReceipts/pairs";
import { pairErrorSentence } from "@/lib/burnticker/pairForward";

/**
 * THE KEEPER'S PAIR-CURVE CRANK (2026-10-10; docs/burnticker/PAIR-CURVE.md §5). Program mode only, behind
 * BURNTICKER_PAIR_CURVE_ENABLED=1. Every cycle it scans the pair_curve program's Pair accounts (getProgramAccounts with the Pair
 * discriminator and a status filter — no registry needed; every action is permissionless, so the keeper cranks any pair, not only
 * ours) and, per pair, sends what `planPairCrank` says:
 *
 *   Open, ready, before the deadline  → graduate(A), graduate(B) (normally a trade already committed the pair)
 *   Graduating                        → the missing side; ≥ 3 days after the commit, void_pair (accepted only if Raydium blocks it)
 *   Graduating / Graduated ≤ 7 days   → register_pair_pool for any side not registered yet; a dust swap on a pool with no oracle
 *                                       observation (blind review 2 L-4)
 *   Open at/after the deadline        → void_pair
 *   any                               → claim_developer_fee once the accrual reaches 0.01 SOL
 *   right after init_pair, first     → link_pair (LAUNCHPAD-PATH §40, winner takes the burn) when both TokenConfigs exist and the two
 *                                       PairLinks do not name each other yet — permissionless, a no-op once paired; register_pair_pool
 *                                       refuses PairNotLinked without it, and since round 2 link_pair refuses once either coin has a reading
 *                                       (PairHasReadings), so it runs before the first reading. Its own transaction, before crankPair's steps.
 *   a graduated side with lp_locked 0 → lock_lp; from 30 days after the commit also burn_lp (LP-lock round 2: the fallback, the only
 *                                       path that destroys LP) — and an alert `pair-side-unlocked` every cycle the side stays unlocked
 *
 * Each action is its own transaction (blind review 2 L-3: a refused registration never blocks a graduation); the genesis hash is checked
 * once per cycle, not per pair (blind review 2 I-1).
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
  /** Ops alert sink (the keeper: registry.recordAlert, deduped per Denver day). */
  alert?: (kind: string, key: string, text: string, meta: Record<string, unknown>) => void;
}

/**
 * LP-lock round 2: every graduated side (pool set) whose LP is not locked yet — before the burn_lp fallback is due as well — one line per
 * side, for the `pair-side-unlocked` alert. Pure.
 */
export function unlockedSides(pairs: readonly { address: PublicKey; pair: Pick<PairAccount, "pools" | "lp_locked" | "graduation_started_at" | "mints"> }[], now: number): { pair: string; side: "A" | "B"; mint: string; days: number; fallbackDue: boolean }[] {
  const out: { pair: string; side: "A" | "B"; mint: string; days: number; fallbackDue: boolean }[] = [];
  for (const { address, pair } of pairs) for (const s of [0, 1] as const) {
    if (pair.pools[s].equals(PublicKey.default) || pair.lp_locked[s] !== BigInt(0)) continue;
    const since = Number(pair.graduation_started_at);
    out.push({ pair: address.toBase58(), side: s === 0 ? "A" : "B", mint: pair.mints[s].toBase58(), days: Math.floor((now - since) / 86_400), fallbackDue: now >= since + LP_LOCK_FALLBACK_SECS });
  }
  return out;
}

/**
 * Winner takes the burn: link_pair is due as soon as both mints have a TokenConfig (right after init_pair; round 2 refuses it once
 * either coin has a reading) and the two PairLinks do not already name each other as paired; never for a voided Pair. Pure.
 */
export function linkPairDue(pair: Pick<PairAccount, "mints" | "status">, configs: [boolean, boolean], links: [PairLinkAccount | null, PairLinkAccount | null]): boolean {
  if (pair.status === STATUS_VOIDED) return false;
  if (!configs[0] || !configs[1]) return false;
  const ok = (l: PairLinkAccount | null, other: PublicKey) => !!l && l.paired && l.pair_mint.equals(other);
  return !(ok(links[0], pair.mints[1]) && ok(links[1], pair.mints[0]));
}

export interface PairCurveCycle { scanned: number; acted: { pair: string; steps: CrankStep[] }[]; errors: string[]; links?: { pair: string; result: SendResult }[] }

export async function crankPairCurves(d: PairCurveCrankDeps): Promise<PairCurveCycle> {
  const now = Math.floor((d.now ?? Date.now)() / 1000);
  const out: PairCurveCycle = { scanned: 0, acted: [], errors: [] };
  let pairs: Awaited<ReturnType<typeof fetchPairs>> = [];
  try {
    await assertPairCurveCluster(d.ctx);
    for (const status of [STATUS_OPEN, STATUS_GRADUATING, STATUS_GRADUATED]) pairs.push(...(await fetchPairs(d.ctx.connection, { programId: d.ctx.programId, status })));
  } catch (e) {
    out.errors.push(`scan: ${(e as Error).message.slice(0, 160)}`);
    return out;
  }
  pairs = pairs.filter(({ pair }) => pair.status !== STATUS_GRADUATED || now - Number(pair.graduated_at) <= RECENT_GRADUATION_SECS);
  out.scanned = pairs.length;
  for (const u of unlockedSides(pairs, now)) {
    const text = `pair ${u.pair.slice(0, 8)}… side ${u.side} graduated ${u.days} day(s) ago and its LP is still not locked (lock_lp has not succeeded)${u.fallbackDue ? "; the 30-day burn_lp fallback is due" : `; burn_lp opens after ${LP_LOCK_FALLBACK_SECS / 86_400} days`}`;
    d.alert?.("pair-side-unlocked", `pair-side-unlocked:${u.pair}:${u.side}`, text, { pair: u.pair, side: u.side, mint: u.mint, fallbackDue: u.fallbackDue });
    d.log(`  [pair-curve] ${text}`);
  }
  for (const { address, pair } of pairs) {
    try {
      // link_pair BEFORE register_pair_pool (its own transaction; a refusal is logged and retried next cycle, crankPair still runs).
      const B = d.ctx.burnReceiptsProgramId;
      const configs = await Promise.all(pair.mints.map(async (m) => !!(await d.ctx.connection.getAccountInfo(configPda(B, m), "confirmed")))) as [boolean, boolean];
      const links = await Promise.all(pair.mints.map((m) => fetchPairLink(d.ctx.connection, B, m))) as [PairLinkAccount | null, PairLinkAccount | null];
      if (linkPairDue(pair, configs, links)) {
        const result = await simulateAndSend(d.ctx, [linkPairIx({ programId: B, payer: d.cranker.publicKey, pair: address, mintA: pair.mints[0], mintB: pair.mints[1] })], [d.cranker], { dryRun: d.dryRun });
        d.log(`  [pair-curve] ${address.toBase58().slice(0, 8)}… link_pair: ${result.ok ? (result.signature ?? "simulated ok") : `refused — ${pairErrorSentence(result.error)}`}`);
        if (!result.ok && result.error === "PairHasReadings") d.alert?.("pair-link-refused", `pair-link-refused:${address.toBase58()}`, `pair ${address.toBase58().slice(0, 8)}…: ${pairErrorSentence(result.error)}`, { pair: address.toBase58() });
        (out.links ??= []).push({ pair: address.toBase58(), result });
      }
      const steps = await crankPair(d.ctx, d.cranker, address, { now, dryRun: d.dryRun, log: d.log, skipClusterCheck: true });
      if (steps.some((s) => s.result)) out.acted.push({ pair: address.toBase58(), steps });
    } catch (e) {
      out.errors.push(`${address.toBase58().slice(0, 8)}…: ${(e as Error).message.slice(0, 160)}`);
    }
  }
  return out;
}
