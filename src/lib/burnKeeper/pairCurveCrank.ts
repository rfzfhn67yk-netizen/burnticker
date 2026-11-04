import { type Keypair, PublicKey } from "@solana/web3.js";
import type { PairAccount } from "@/lib/pairCurve/accounts";
import { CLAIM_THRESHOLD_LAMPORTS, LP_LOCK_FALLBACK_SECS, registeredSides } from "@/lib/pairCurve/client";
import { bs58 } from "@/lib/burnReceipts/accounts";
import { PAIR_CURVE_PROGRAM_ID } from "@/lib/burnReceipts/constants";
import { decodePair, fetchPairs, pairDiscriminator, STATUS_GRADUATED, STATUS_GRADUATING, STATUS_OPEN, STATUS_VOIDED } from "@/lib/pairCurve/accounts";
import { assertPairCurveCluster, crankPair, simulateAndSend, type CrankStep, type PairCurveContext, type SendResult } from "@/lib/pairCurve/client";
import { feeKeyRecordPda } from "@/lib/burnReceipts/pda";
import { fetchPairLink, linkPairIx, PAIR_STATE_UNLINKED, type PairLinkAccount } from "@/lib/burnReceipts/pairs";
import { fetchTokenConfig } from "@/lib/burnReceipts/accounts";
import { pairErrorSentence } from "@/lib/burnticker/pairForward";

/**
 * THE KEEPER'S PAIR-CURVE CRANK (2026-10-10; docs/burnticker/PAIR-CURVE.md §5). Program mode only, behind
 * BURNTICKER_PAIR_CURVE_ENABLED=1. Every cycle it scans the pair_curve program's Pair accounts (getProgramAccounts with the Pair
 * discriminator and a status filter — no registry needed; every action is permissionless, so the keeper cranks any pair, not only
 * ours) and, per pair, sends what `planPairCrank` says:
 *
 *   Open, ready, before the deadline  → graduate(A), graduate(B) (normally a trade already committed the pair)
 *   Graduating                        → the missing side; ≥ 3 days after the commit, void_pair (accepted only if Raydium blocks it)
 *   Graduating / Graduated            → register_pair_pool for any side not registered yet; a dust swap on a pool with no oracle
 *                                       observation (blind review 2 L-4). A Graduated pair older than 7 days stays in the scan while any
 *                                       work is outstanding (review 2 F2): an unlocked side, an unregistered pool, a missing Fee Key
 *                                       record or a developer accrual to claim; only a fully complete old pair ages out
 *   Open at/after the deadline        → void_pair
 *   any                               → claim_developer_fee once the accrual reaches 0.01 SOL
 *   right after init_pair, first     → link_pair (LAUNCHPAD-PATH §40, winner takes the burn) when both TokenConfigs exist and the two
 *                                       PairLinks do not name each other yet — permissionless, a no-op once paired; register_pair_pool
 *                                       refuses PairNotLinked without it (it also accepts an UNLINKED coin). Round 3: a coin that read first
 *                                       is fine (its periods so far stay unpaired, pair_after_date); refused only for a voided Pair or a
 *                                       refunding side (PairTerminal); every refusal raises the alert `pair-link-refused` (re-check P3-1). Never for an unlinked pair. Its own transaction.
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
  /**
   * Review RL-2: true when the registry records this pair as UNLINKED (unlink_pair ran) — such a pair is never re-linked by the keeper
   * unless the program's rule explicitly allows a re-link. The keeper wires it to the registry; absent = nothing recorded.
   */
  isUnlinked?: (mintA: string, mintB: string) => boolean;
  /** Ops alert sink (the keeper: registry.recordAlert, deduped per Denver day). */
  alert?: (kind: string, key: string, text: string, meta: Record<string, unknown>) => void;
  /**
   * The scan (2026-10-15): the keeper passes a PairScanCache's `scan`, which runs ONE getProgramAccounts (10 credits) every few minutes
   * and re-reads the known pairs by address (getMultipleAccountsInfo, 1 credit) in between. Absent: three status-filtered
   * getProgramAccounts every call, as before.
   */
  scan?: (onUndecodable: (address: PublicKey, e: Error, bytes: number) => void) => Promise<{ address: PublicKey; pair: PairAccount }[]>;
}

/** The Pair's status byte (the offset fetchPairs' status memcmp matches). */
export const PAIR_STATUS_OFFSET = 11;
const bs58Encode = (b: Uint8Array): string => bs58(Buffer.from(b));
/** The statuses the crank works on (Voided pairs only redeem; nothing to crank). */
export const CRANK_STATUSES: readonly number[] = [STATUS_OPEN, STATUS_GRADUATING, STATUS_GRADUATED];

/**
 * THE PAIR SCAN CACHE (2026-10-15; measured: the three status-filtered getProgramAccounts were 30 of the keeper's ~150 credits a cycle,
 * every minute, with no pair on the program). A full scan is ONE getProgramAccounts with the Pair discriminator only (10 credits), its
 * statuses filtered here, every `fullEveryMs` (default 10 minutes); between full scans the known crankable pairs are re-read by address in
 * one getMultipleAccountsInfo per 100 (1 credit, and served by the keeper's per-cycle account cache when it is in front), so a known pair's
 * graduation, void or claim is seen on the very next cycle as before. Only a pair CREATED since the last full scan waits for the next one
 * (at most `fullEveryMs`; launches send link_pair inside init_pair, so the crank's link step is a catch-up).
 */
export class PairScanCache {
  private known: PublicKey[] = [];
  private lastFull = -Infinity;
  readonly stats = { full: 0, byAddress: 0 };
  private o: { connection: Pick<PairCurveContext["connection"], "getProgramAccounts" | "getMultipleAccountsInfo">; programId?: PublicKey; fullEveryMs?: number; now?: () => number };
  constructor(o: { connection: Pick<PairCurveContext["connection"], "getProgramAccounts" | "getMultipleAccountsInfo">; programId?: PublicKey; fullEveryMs?: number; now?: () => number }) { this.o = o; }
  /** Forces the next scan to be a full one (e.g. after a launch of a new pair). */
  expire(): void { this.lastFull = -Infinity; }
  async scan(onUndecodable: (address: PublicKey, e: Error, bytes: number) => void = () => undefined): Promise<{ address: PublicKey; pair: PairAccount }[]> {
    const now = (this.o.now ?? Date.now)();
    let out: { address: PublicKey; pair: PairAccount }[];
    if (now - this.lastFull >= (this.o.fullEveryMs ?? 10 * 60_000)) {
      // one getProgramAccounts with the discriminator filter; the status byte (offset 11, the same byte the old status memcmp matched)
      // is read raw BEFORE decoding, so a voided or old-layout pair the status filters used to exclude is skipped silently, as before
      const list = await this.o.connection.getProgramAccounts(this.o.programId ?? PAIR_CURVE_PROGRAM_ID, { commitment: "confirmed", filters: [{ memcmp: { offset: 0, bytes: bs58Encode(pairDiscriminator()) } }] });
      out = [];
      for (const x of list) {
        const data = x.account.data as Buffer;
        if (data.length <= PAIR_STATUS_OFFSET || !CRANK_STATUSES.includes(data[PAIR_STATUS_OFFSET])) continue;
        try { out.push({ address: x.pubkey, pair: decodePair(data) }); } catch (e) { onUndecodable(x.pubkey, e as Error, data.length); }
      }
      this.lastFull = now; this.stats.full++;
    } else {
      out = [];
      for (let i = 0; i < this.known.length; i += 100) {
        const chunk = this.known.slice(i, i + 100);
        const accs = await this.o.connection.getMultipleAccountsInfo(chunk, "confirmed");
        chunk.forEach((address, j) => {
          const a = accs[j];
          if (!a || a.data.length === 0) return;
          try { const pair = decodePair(a.data); if (CRANK_STATUSES.includes(pair.status)) out.push({ address, pair }); }
          catch (e) { onUndecodable(address, e as Error, a.data.length); }
        });
      }
      this.stats.byAddress++;
    }
    this.known = out.map((x) => x.address);
    return out;
  }
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
 * Winner takes the burn: link_pair is due as soon as both mints have a TokenConfig (since the round-3 re-check P3-1 the launch bundle
 * sends it inside the init_pair transaction; this is the catch-up) and the two PairLinks do not already name each other as paired;
 * never for a voided Pair or a refunding side. Round 3 accepts coins that already read (those periods stay unpaired, pair_after_date)
 * and refuses only a terminal Pair (PairTerminal) or differing attester sets (PairAttestersDiffer). Pure.
 */
export function linkPairDue(pair: Pick<PairAccount, "mints" | "status" | "refunding">, configs: [boolean, boolean], links: [PairLinkAccount | null, PairLinkAccount | null], unlinked = false): boolean {
  // review RL-2: never for a voided Pair, a side that is refunding (the unlink evidence), or a pair the registry records as unlinked
  if (pair.status === STATUS_VOIDED || pair.refunding.some(Boolean) || unlinked) return false;
  if (!configs[0] || !configs[1]) return false;
  const ok = (l: PairLinkAccount | null, other: PublicKey) => !!l && l.paired && l.pair_mint.equals(other);
  return !(ok(links[0], pair.mints[1]) && ok(links[1], pair.mints[0]));
}

/**
 * Review 2 F2: is anything still to do on a graduated pair? An unlocked side (lock_lp / the 30-day burn_lp fallback), a side whose pool
 * is not registered in burn_receipts, a side whose Fee Key record is missing, or a developer accrual over the claim threshold. Reads the
 * two TokenConfigs and the two FeeKeyRecords only when the Pair account alone does not already say "work left".
 */
export async function graduatedPairWorkOutstanding(ctx: Pick<PairCurveContext, "connection" | "burnReceiptsProgramId">, pair: PairAccount): Promise<boolean> {
  const sides = ([0, 1] as const).filter((s) => !pair.pools[s].equals(PublicKey.default));
  if (sides.some((s) => pair.lp_locked[s] === BigInt(0))) return true;
  if (pair.dev_accrued >= CLAIM_THRESHOLD_LAMPORTS) return true;
  const registered = await registeredSides(ctx as PairCurveContext, pair);
  if (sides.some((s) => !registered[s])) return true;
  for (const s of sides) if (!(await ctx.connection.getAccountInfo(feeKeyRecordPda(ctx.burnReceiptsProgramId, pair.mints[s]), "confirmed"))) return true;
  return false;
}

export interface PairCurveCycle { scanned: number; acted: { pair: string; steps: CrankStep[] }[]; errors: string[]; links?: { pair: string; result: SendResult }[] }

export async function crankPairCurves(d: PairCurveCrankDeps): Promise<PairCurveCycle> {
  const now = Math.floor((d.now ?? Date.now)() / 1000);
  const out: PairCurveCycle = { scanned: 0, acted: [], errors: [] };
  let pairs: Awaited<ReturnType<typeof fetchPairs>> = [];
  try {
    await assertPairCurveCluster(d.ctx);
    const onUndecodable = (address: PublicKey, e: Error, bytes: number) => { out.errors.push(`skipped ${address.toBase58()}: ${bytes} bytes, ${e.message.slice(0, 80)}`); };
    if (d.scan) pairs = await d.scan(onUndecodable);
    else for (const status of CRANK_STATUSES) pairs.push(...(await fetchPairs(d.ctx.connection, { programId: d.ctx.programId, status, onUndecodable })));
  } catch (e) {
    out.errors.push(`scan: ${(e as Error).message.slice(0, 160)}`);
    return out;
  }
  // Recent graduations are always scanned; an older Graduated pair only while work is outstanding (review 2 F2: the 7-day cut used to run
  // before unlockedSides and crankPair, so a side whose lock kept refusing vanished from retries and alerts and never reached burn_lp).
  const kept: typeof pairs = [];
  for (const x of pairs) {
    if (x.pair.status !== STATUS_GRADUATED || now - Number(x.pair.graduated_at) <= RECENT_GRADUATION_SECS) { kept.push(x); continue; }
    try { if (await graduatedPairWorkOutstanding(d.ctx, x.pair)) kept.push(x); }
    catch (e) { kept.push(x); out.errors.push(`${x.address.toBase58().slice(0, 8)}…: work check: ${(e as Error).message.slice(0, 120)}`); }   // unreadable: keep it (fail toward retrying)
  }
  pairs = kept;
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
      const cfgs = await Promise.all(pair.mints.map((m) => fetchTokenConfig(d.ctx.connection, B, m)));
      const configs = cfgs.map((c) => !!c) as [boolean, boolean];
      const links = await Promise.all(pair.mints.map((m) => fetchPairLink(d.ctx.connection, B, m))) as [PairLinkAccount | null, PairLinkAccount | null];
      // r3: an UNLINKED coin (pair_state 3) is never re-linked by the keeper, nor a pair the registry records as unlinked (review RL-2)
      const unlinked = cfgs.some((c) => c?.config.pair_state === PAIR_STATE_UNLINKED) || (d.isUnlinked?.(pair.mints[0].toBase58(), pair.mints[1].toBase58()) ?? false);
      if (linkPairDue(pair, configs, links, unlinked)) {
        const result = await simulateAndSend(d.ctx, [linkPairIx({ programId: B, payer: d.cranker.publicKey, pair: address, mintA: pair.mints[0], mintB: pair.mints[1] })], [d.cranker], { dryRun: d.dryRun });
        d.log(`  [pair-curve] ${address.toBase58().slice(0, 8)}… link_pair: ${result.ok ? (result.signature ?? "simulated ok") : `refused — ${pairErrorSentence(result.error)}`}`);
        // re-check P3-1: EVERY refusal is an alert (PairAttestersDiffer, an outage's errors…), repeated each cycle while the pair is unlinked
        if (!result.ok && !d.dryRun) d.alert?.("pair-link-refused", `pair-link-refused:${address.toBase58()}`, `pair ${address.toBase58().slice(0, 8)}…: ${pairErrorSentence(result.error)}`, { pair: address.toBase58() });
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
