import crypto from "node:crypto";
import type { ConfirmOutcome, SignedTx } from "@/lib/burnKeeper/programPort";
import type { FakeProgram } from "@/lib/burnKeeper/fakeProgram";
import { buybackSpend, formatDate, spendablePool } from "@/lib/burnReceipts/math";
import { OUTCOME_FORWARDED as PROGRAM_OUTCOME_FORWARDED, PAIR_ATTESTATION_DOMAIN, PAIRING_WINDOW_SECS as PROGRAM_PAIRING_WINDOW_SECS, PAIR_RESULT_GRACE_SECS as PROGRAM_PAIR_RESULT_GRACE_SECS, parseForwardMemo as programParseForwardMemo } from "@/lib/burnReceipts/pairs";

/**
 * WINNER TAKES THE BURN (owner decision 2026-10-11, LAUNCHPAD-PATH §40): "the fees for both the winner and loser should burn the
 * winner's supply." For every pair, at each result the LOSER's fuel for that result — buyback_spend(min(its fee PDA − reserve + its
 * WSOL, the platform cap), its units for the result, its fraction) = exactly what it would have burned had it won; 0 under its floor;
 * a one-shot pair (fraction 100 %) moves everything — goes to the WINNER's burn pool through burn_receipts `forward_to_winner`, and the
 * winner's normal cranks buy and burn the winner's coin. The loser's supply is untouched, nobody is paid, a draw forwards nothing.
 *
 * THE PROGRAM'S INTERFACE (fixed by the program builder 2026-10-11; its low-level builders live in src/lib/burnReceipts — this file is
 * the typed ADAPTER the keeper, pages and API code against, with an in-memory fake; the real client binds to the builders):
 *   TokenConfig pair_state 0 none / 1 provisional / 2 paired; PairLink ["pair_link", mint] {mint, pair_mint, paired, witness 0 initialize
 *   / 1 pair_curve, created_at, pairing_deadline, paired_at}. LaunchLab pairs pair through initialize_token's optional accounts: the
 *   first coin is PROVISIONAL and becomes paired only if the partner names it back within PAIRING_WINDOW_SECS (7 days), else both are
 *   plain coins for good. pair_curve pairs pair through `link_pair(pair)` (before register_pair_pool: PairNotLinked).
 *   PairResult ["pair_result", mint_lo, mint_hi, record_date u32 LE] {winner (default = draw), …, forwarded, forwarded_lamports}; both
 *   coins' attester quorums sign `BURNRECEIPTS-PAIR-v1|<genesis>|<program>|<mint_lo>|<mint_hi>|<YYYY-MM-DD>|winner=<base58|draw>|src=…|proof=…`.
 *   `forward_to_winner(record_date)`: the loser's reading for the date must be next in its queue; the reading's outcome becomes
 *   FORWARDED (6); memo `<LOSER PREFIX>|forward|from=<12>|to=<12>|period=<date>|lamports=N|v1`.
 *   crank_buyback on a paired coin: LOST → ForwardRequired; no result → PairResultPending until PAIR_RESULT_GRACE_SECS (72 h) after the
 *   reading was submitted, then it burns unpaired (that period can no longer be forwarded). The winner never waits for the forward.
 */

/** From the program's IDL (src/lib/burnReceipts/pairs.ts — one source): 7 days, 72 h. */
export const PAIRING_WINDOW_SECS = PROGRAM_PAIRING_WINDOW_SECS;
export const PAIR_RESULT_GRACE_SECS = PROGRAM_PAIR_RESULT_GRACE_SECS;
/** The keeper alerts `pair-result-missing` this long after a pair reading without a PairResult — well inside the 72 h grace. */
export const PAIR_RESULT_ALERT_SECS = 12 * 60 * 60;
/** …and `pair-forward-pending` when a due forward has not landed this long after the loser's reading was attested. */
export const PAIR_FORWARD_ALERT_SECS = 60 * 60;
export const OUTCOME_FORWARDED = PROGRAM_OUTCOME_FORWARDED;
export const PAIR_MESSAGE_DOMAIN = PAIR_ATTESTATION_DOMAIN;

export type PairState = 0 | 1 | 2;
export const PAIR_STATE_NAMES: Record<PairState, "none" | "provisional" | "paired"> = { 0: "none", 1: "provisional", 2: "paired" };
export interface PairLinkView {
  mint: string; pairMint: string; paired: boolean; witness: 0 | 1; createdAt: number; pairingDeadline: number; pairedAt: number | null;
  /** r2 M-1: the coin's attester-set hash at pairing (hex; all zeros for links written before r2). */
  attesterSetHash?: string;
}
/** The UTC day (YYYYMMDD) the two coins were paired — the later paired_at; no PairResult may be dated before it (PairDateBeforePairing). */
export function pairedOn(a: PairLinkView | null, b: PairLinkView | null): number | null {
  const t = Math.max(a?.pairedAt ?? -1, b?.pairedAt ?? -1);
  if (t < 0) return null;
  const d = new Date(t * 1000);
  return d.getUTCFullYear() * 10_000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
}
/** unlink_pair's evidence (r2 M-2): PairUnlinked.reason and, for 0 / 1, the pair_curve Pair passed as evidence. */
export type UnlinkReason = 0 | 1 | 2;
export const UNLINK_REASON_TEXT: Record<UnlinkReason, string> = {
  0: "the pair curve voided",
  1: "one side is refunding (its pool never came)",
  2: "one coin had no verified pool 30 days after the pairing",
};
/** The per-period result: winner null = draw. */
export interface PairResultView { recordDate: number; winner: string | null; submittedAt: number; forwarded: boolean; forwardedLamports: bigint; forwardedAt: number | null }
export interface ForwardFacts { loserMint: string; winnerMint: string; recordDate: number; units: number; poolLamports: bigint; lamports: bigint; solLamports: bigint; wsolLamports: bigint }

/** The program's pair refusals in plain words (keeper alerts, the API). */
export const PAIR_ERRORS: Record<string, { code: number; sentence: string }> = {
  InvalidPairMint: { code: 6077, sentence: "the pair partner named at initialisation is not a valid mint for a pair" },
  PairMismatch: { code: 6078, sentence: "the two coins do not name each other as pair partners" },
  PairingClosed: { code: 6079, sentence: "the 7-day pairing window closed before the partner named this coin back, so both are plain coins for good" },
  NotPaired: { code: 6080, sentence: "the two coins are not paired on chain, so nothing can be forwarded between them" },
  PairNotLinked: { code: 6081, sentence: "the pair_curve pair is not linked yet: link_pair must run before register_pair_pool" },
  PairOrder: { code: 6082, sentence: "the two mints were given in the wrong order (the lower mint by raw bytes comes first)" },
  InvalidWinner: { code: 6083, sentence: "the named winner is neither coin of the pair" },
  ConflictingPairResult: { code: 6084, sentence: "a different result for this period is already recorded; a recorded result never changes" },
  ForwardRequired: { code: 6085, sentence: "this coin lost the period, so its fuel forwards to the winner instead of burning here" },
  PairResultPending: { code: 6086, sentence: "the period's pair result is not recorded yet; the burn waits up to 72 hours for it" },
  InvalidPairResult: { code: 6087, sentence: "the pair result's signed message or quorum does not check out" },
  NotWinner: { code: 6088, sentence: "the forward names a destination that is not the period's winner" },
  PairSideNotLive: { code: 6089, sentence: "a pair side is not live (no longer raised since round 2: a side without a verified pool forwards 0 lamports and the period is still processed)" },
  PairResultNotServable: { code: 6090, sentence: "a win needs both coins' readings for the date and the loser's still unprocessed; until it can be recorded the period has no result (no draw is substituted)" },
  PairDateBeforePairing: { code: 6091, sentence: "the period is dated before the two coins were paired, so it has no pair result (it burns unpaired after 72 hours)" },
  PairHasReadings: { code: 6092, sentence: "a coin already has readings under its unpaired rule; a pair is linked before its first reading, so this pair stays unlinked" },
  PairStillLive: { code: 6093, sentence: "there is no on-chain evidence yet that the partner can never be live (a voided pair curve, a refunding side, or no verified pool 30 days after pairing)" },
};
export function pairErrorSentence(name: string | null | undefined): string {
  if (!name) return "unknown refusal";
  const n = Object.keys(PAIR_ERRORS).find((k) => name === k || name.includes(k) || name.includes(String(PAIR_ERRORS[k].code)) || name.includes(`0x${PAIR_ERRORS[k].code.toString(16)}`));
  return n ? `${n}: ${PAIR_ERRORS[n].sentence}` : name;
}

/** mint_lo / mint_hi of a pair (raw-byte order, as the PairResult seeds want them). */
export function sortPairMints(a: string, b: string, decode: (s: string) => Uint8Array = base58Bytes): [string, string] {
  return Buffer.compare(Buffer.from(decode(a)), Buffer.from(decode(b))) < 0 ? [a, b] : [b, a];
}
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58Bytes(s: string): Uint8Array {
  let n = BigInt(0);
  for (const ch of s) { const i = B58.indexOf(ch); if (i < 0) throw new Error(`not base58: ${s}`); n = n * BigInt(58) + BigInt(i); }
  const out: number[] = [];
  while (n > BigInt(0)) { out.unshift(Number(n % BigInt(256))); n /= BigInt(256); }
  for (const ch of s) { if (ch === "1") out.unshift(0); else break; }
  return Uint8Array.from(out);
}

/** The forward memo `<LOSER PREFIX>|forward|from=<12>|to=<12>|period=<YYYY-MM-DD>|lamports=N|v1`. */
export function formatForwardMemo(prefix: string, loserMint: string, winnerMint: string, recordDate: number, lamports: bigint): string {
  return `${prefix}|forward|from=${loserMint.slice(0, 12)}|to=${winnerMint.slice(0, 12)}|period=${formatDate(recordDate)}|lamports=${lamports}|v1`;
}
/** The program builder's parser (src/lib/burnReceipts/pairs.ts), with the field names the pages use. */
export function parseForwardMemo(memo: string): { prefix: string; from: string; to: string; period: string; lamports: bigint } | null {
  const m = programParseForwardMemo(memo);
  return m ? { prefix: m.prefix, from: m.from12, to: m.to12, period: m.period, lamports: m.lamports } : null;
}
/** The receipt line for a landed forward. */
export const forwardLine = (loserTicker: string, winnerTicker: string, lamports: bigint): string => lamports === BigInt(0)
  ? `forwarded from $${loserTicker}: 0 SOL → $${winnerTicker} burn pool (nothing to move: under the floor, or a side has no verified pool)`
  : `forwarded from $${loserTicker}: ${lamportsToSol(lamports)} SOL → $${winnerTicker} burn pool`;
function lamportsToSol(l: bigint): string {
  const SOL = BigInt(1_000_000_000), frac = (l % SOL).toString().padStart(9, "0").replace(/0+$/, "");
  return `${l / SOL}${frac ? `.${frac}` : ""}`;
}

/** What a forward moves, by the program's rule (the fake's arithmetic; the pages recompute receipts with it). */
export function forwardAmount(i: { feeLamports: bigint; reserveLamports: bigint; wsolLamports: bigint; capLamports: bigint | null; units: number; fractionBps: number; floorLamports: bigint }): { pool: bigint; lamports: bigint } {
  const actual = spendablePool(i.feeLamports, i.reserveLamports, i.wsolLamports);
  const pool = i.capLamports !== null && actual > i.capLamports ? i.capLamports : actual;
  const amt = buybackSpend(pool, BigInt(i.units), i.fractionBps);
  return { pool, lamports: amt < i.floorLamports ? BigInt(0) : amt };
}

/** One pair's port: links, per-period results, the two instructions, and what a landed forward did. */
export interface PairForwardPort {
  readonly mintA: string;
  readonly mintB: string;
  /** `poolsVerified` [A, B]: each TokenConfig's pool_verified (unlink evidence, a win's servability). */
  links(): Promise<{ a: PairLinkView | null; b: PairLinkView | null; stateA: PairState; stateB: PairState; paired: boolean; poolsVerified?: [boolean, boolean] }>;
  result(recordDate: number): Promise<PairResultView | null>;
  /** submit_pair_result: both coins' quorums sign the same message (on devnet the keeper is both sides' attester). Signed, not sent. */
  buildSubmitResult(o: { recordDate: number; winner: string | null; sourceUrl: string; proofHash?: Uint8Array }): Promise<SignedTx>;
  /** forward_to_winner(record_date) for the loser (creates the winner fee PDA's WSOL ATA idempotently first). Signed, not sent. */
  buildForward(o: { loserMint: string; recordDate: number }): Promise<SignedTx>;
  simulate(raw: Uint8Array): Promise<{ err: string | null; logs: string[] }>;
  send(raw: Uint8Array): Promise<void>;
  confirm(tx: Pick<SignedTx, "signature" | "blockhash" | "lastValidBlockHeight">): Promise<ConfirmOutcome>;
  /** A confirmed forward's facts (the program ALWAYS writes the forward memo, lamports=0 included); "none" = readable, no forward memo; null = not readable yet. */
  forwardFacts(signature: string): Promise<(ForwardFacts & { memo: string | null }) | "none" | null>;
  /** unlink_pair's on-chain evidence now (r2 M-2), or null (PairStillLive). `pair` = the pair_curve Pair to pass for reasons 0 / 1. */
  unlinkEvidence(nowMs: number): Promise<{ reason: UnlinkReason; pair: string | null } | null>;
  /** unlink_pair (permissionless). Signed, not sent. */
  buildUnlink(o: { pair: string | null }): Promise<SignedTx>;
}
export interface PairForwardClient { port(mintA: string, mintB: string): PairForwardPort }

// ---------------------------------------------------------------------------------------------------------------------------------
// The fake: the program's pair rules in memory, over the two coins' FakePrograms
// ---------------------------------------------------------------------------------------------------------------------------------

const fakeSig = (label: string): string => crypto.createHash("sha256").update(label).digest("hex");

/**
 * Two coins' pair state and results in memory, wired into each coin's FakeProgram crank gate (round 2): a LOST period refuses
 * ForwardRequired until 72 h after the reading, then cranks unpaired ("forward-missing"); a period with no result refuses
 * PairResultPending for the same time, then cranks unpaired; WON / DRAW crank normally. A WIN is recorded only when both coins have a
 * reading for the date and the loser's is unprocessed (else PairResultNotServable; no pool condition); no result before the pairing day.
 * forward_to_winner moves exactly forwardAmount() from the loser's fee PDA (SOL first, then WSOL) into the winner's WSOL — 0 lamports
 * when a side has no verified pool or the pair is no longer paired — marks the loser's reading processed with outcome "forwarded" and its
 * amount in spentLamports, and ALWAYS writes the forward memo. unlink_pair needs `unlinkReason` (else PairStillLive).
 * Knobs: `paired`, `pairedAtSec`, `simErr`, `dropSends`, `winnerLive` (false = the winner has no verified pool), `unlinkReason`.
 */
export class FakePairForwardPort implements PairForwardPort {
  readonly mintA: string; readonly mintB: string;
  paired = true;
  /** The PairLinks' pairing deadline (unix seconds) the fake reports; the default is long past (a closed window). */
  pairingDeadline = PAIRING_WINDOW_SECS;
  winnerLive = true;
  /** The pairing time (unix seconds) both links report; 0 = 1970 (no date is before it). */
  pairedAtSec = 0;
  /** unlink_pair's evidence on chain now (null = PairStillLive); `unlinked` once it landed. */
  unlinkReason: UnlinkReason | null = null;
  unlinked: { reason: UnlinkReason } | null = null;
  /** A refusal every forward_to_winner simulation returns (a forward that cannot land), e.g. "OutOfOrder". */
  forwardErr: string | null = null;
  simErr: string | null = null;
  dropSends = false;
  results = new Map<number, PairResultView>();
  submittedAt = new Map<string, number>();
  forwards = 0;
  private n = 0;
  private built = new Map<string, { kind: "result"; recordDate: number; winner: string | null } | { kind: "forward"; loser: string; recordDate: number } | { kind: "unlink"; pair: string | null }>();
  private landed = new Map<string, { facts: (ForwardFacts & { memo: string | null }) | null } | { err: string }>();
  private fake: (mint: string) => FakeProgram;
  private now: () => number;
  constructor(mintA: string, mintB: string, fake: (mint: string) => FakeProgram, now: () => number) {
    this.mintA = mintA; this.mintB = mintB; this.fake = fake; this.now = now;
  }
  /** The FakeProgram crank gate for `mint`'s reading D (installed on both coins by FakePairForward). */
  gate(mint: string, D: number, readingSubmittedAtMs: number | null): "won" | "lost" | "draw" | "pending" | "missing" | "forward-missing" | null {
    if (!this.paired) return null;
    const r = this.results.get(D);
    const timedOut = readingSubmittedAtMs !== null && this.now() - readingSubmittedAtMs >= PAIR_RESULT_GRACE_SECS * 1000;
    if (!r) return timedOut ? "missing" : "pending";
    if (r.winner === null) return "draw";
    return r.winner === mint ? "won" : timedOut ? "forward-missing" : "lost";
  }
  private verified(): [boolean, boolean] {
    const v = (m: string) => { try { return this.fake(m).cfg.poolRegistered; } catch { return false; } };
    return [v(this.mintA), v(this.mintB)];
  }
  async links() {
    if (this.unlinked) return { a: null, b: null, stateA: 0 as PairState, stateB: 0 as PairState, paired: false, poolsVerified: this.verified() };
    const v = (mint: string, other: string): PairLinkView => ({ mint, pairMint: other, paired: this.paired, witness: 0, createdAt: 0, pairingDeadline: this.pairingDeadline, pairedAt: this.paired ? this.pairedAtSec : null });
    return { a: v(this.mintA, this.mintB), b: v(this.mintB, this.mintA), stateA: (this.paired ? 2 : 1) as PairState, stateB: (this.paired ? 2 : 1) as PairState, paired: this.paired, poolsVerified: this.verified() };
  }
  async unlinkEvidence(): Promise<{ reason: UnlinkReason; pair: string | null } | null> { return this.paired && this.unlinkReason !== null ? { reason: this.unlinkReason, pair: this.unlinkReason === 2 ? null : `pair:${this.mintA.slice(0, 8)}` } : null; }
  async buildUnlink(o: { pair: string | null }) { const tx = this.sig("unlink"); this.built.set(tx.signature, { kind: "unlink", pair: o.pair }); return tx; }
  async result(D: number) { return this.results.get(D) ?? null; }
  private sig(kind: string): SignedTx { const signature = fakeSig(`pair|${this.mintA}|${this.mintB}|${kind}|${++this.n}`); return { signature, raw: new TextEncoder().encode(signature), blockhash: `pbh${this.n}`, lastValidBlockHeight: 2_000 + this.n }; }
  async buildSubmitResult(o: { recordDate: number; winner: string | null; sourceUrl?: string; proofHash?: Uint8Array }) { const tx = this.sig("result"); this.built.set(tx.signature, { kind: "result", recordDate: o.recordDate, winner: o.winner }); return tx; }
  async buildForward(o: { loserMint: string; recordDate: number }) { const tx = this.sig("forward"); this.built.set(tx.signature, { kind: "forward", loser: o.loserMint, recordDate: o.recordDate }); return tx; }
  private refusal(sig: string): string | null {
    const b = this.built.get(sig);
    if (!b) return "unknown transaction";
    if (b.kind === "unlink") return !this.paired ? "NotPaired" : this.unlinkReason === null ? "PairStillLive" : null;
    if (b.kind === "result") {
      if (!this.paired) return "NotPaired";
      if (b.winner !== null && b.winner !== this.mintA && b.winner !== this.mintB) return "InvalidWinner";
      const on = pairedOn({ mint: this.mintA, pairMint: this.mintB, paired: true, witness: 0, createdAt: 0, pairingDeadline: 0, pairedAt: this.pairedAtSec }, null);
      if (on !== null && b.recordDate < on) return "PairDateBeforePairing";
      const have = this.results.get(b.recordDate);
      if (have && have.winner !== b.winner) return "ConflictingPairResult";
      if (have) return null;
      if (b.winner !== null) {
        // r2 H-1(a): a win needs both readings for the date and the loser's unprocessed — no pool condition (a dead side forwards 0)
        const loserMint = b.winner === this.mintA ? this.mintB : this.mintA;
        const [ra, rb] = [this.fake(this.mintA).readings.get(b.recordDate), this.fake(this.mintB).readings.get(b.recordDate)];
        const loserRd = this.fake(loserMint).readings.get(b.recordDate);
        if (!ra || !rb || !loserRd || loserRd.processed) return "PairResultNotServable";
      }
      return null;
    }
    if (this.forwardErr) return this.forwardErr;
    const r = this.results.get(b.recordDate);
    if (!r) return "PairResultPending";
    if (r.winner === null || r.winner === b.loser) return "NotWinner";
    const loser = this.fake(b.loser);
    const rd = loser.readings.get(b.recordDate);
    if (!rd) return "AccountNotInitialized";
    if (rd.processed) return null;   // already forwarded: a no-op
    if (rd.prevDate !== loser.cfg.crankCursor) return "OutOfOrder";
    return null;
  }
  async simulate(raw: Uint8Array) {
    const err = this.simErr ?? this.refusal(new TextDecoder().decode(raw));
    return err ? { err, logs: [`Program log: AnchorError ${err}`] } : { err: null, logs: ["Program log: Instruction: ForwardToWinner"] };
  }
  async send(raw: Uint8Array) {
    if (this.dropSends) return;
    const sig = new TextDecoder().decode(raw), b = this.built.get(sig);
    if (!b) throw new Error("unknown transaction");
    const err = this.refusal(sig);
    if (err) { this.landed.set(sig, { err }); return; }
    if (b.kind === "unlink") {
      this.unlinked = { reason: this.unlinkReason! }; this.paired = false;
      this.landed.set(sig, { facts: null });
      return;
    }
    if (b.kind === "result") {
      if (!this.results.has(b.recordDate)) this.results.set(b.recordDate, { recordDate: b.recordDate, winner: b.winner, submittedAt: Math.floor(this.now() / 1000), forwarded: false, forwardedLamports: BigInt(0), forwardedAt: null });
      this.landed.set(sig, { facts: null });
      return;
    }
    const r = this.results.get(b.recordDate)!, winnerMint = r.winner!;
    const loser = this.fake(b.loser), winner = this.fake(winnerMint);
    const rd = { ...loser.readings.get(b.recordDate)! };
    if (rd.processed) { this.landed.set(sig, { facts: null }); return; }   // idempotent per period
    // r2 H-1(b): a side without a verified pool, or a pair no longer paired, forwards 0 lamports — the reading is still processed
    const [va, vb] = this.verified();
    const dead = !va || !vb || !this.winnerLive || !this.paired;
    const a0 = forwardAmount({ feeLamports: loser.feeLamports, reserveLamports: loser.cfg.reserveLamports, wsolLamports: loser.wsol, capLamports: loser.capLamports, units: rd.units, fractionBps: loser.cfg.fractionPerUnitBps, floorLamports: loser.cfg.floorLamports });
    const a = dead ? { pool: a0.pool, lamports: BigInt(0) } : a0;
    const avail = loser.feeLamports > loser.cfg.reserveLamports ? loser.feeLamports - loser.cfg.reserveLamports : BigInt(0);
    const sol = a.lamports < avail ? a.lamports : avail, wsol = a.lamports - sol;
    loser.feeLamports -= sol; loser.wsol -= wsol; winner.wsol += a.lamports;
    Object.assign(rd, { processed: true, outcome: "forwarded", poolLamports: a.pool, poolActualLamports: a.pool, spentLamports: a.lamports, ruleSpendLamports: a.lamports, carriedInLamports: BigInt(0), carriedOutLamports: BigInt(0), got: BigInt(0), burned: BigInt(0) });
    loser.readings.set(b.recordDate, rd);
    loser.cfg = { ...loser.cfg, crankCursor: b.recordDate };
    this.results.set(b.recordDate, { ...r, forwarded: true, forwardedLamports: a.lamports, forwardedAt: Math.floor(this.now() / 1000) });
    this.forwards++;
    const memo = formatForwardMemo(loser.cfg.memoPrefix, b.loser, winnerMint, b.recordDate, a.lamports);
    loser.landed.set(sig, { slot: 900 + this.n, err: null, memo, payload: { kind: "other" } });
    this.landed.set(sig, { facts: { loserMint: b.loser, winnerMint, recordDate: b.recordDate, units: rd.units, poolLamports: a.pool, lamports: a.lamports, solLamports: sol, wsolLamports: wsol, memo } });
  }
  async confirm(tx: Pick<SignedTx, "signature">): Promise<ConfirmOutcome> {
    const l = this.landed.get(tx.signature);
    if (!l) return { status: "expired" };
    return "err" in l ? { status: "failed", err: l.err } : { status: "confirmed", slot: 900 + this.n };
  }
  async forwardFacts(sig: string) {
    const l = this.landed.get(sig);
    if (!l || "err" in l) return null;
    return l.facts ?? "none";
  }
  /** Lands a dropped send later. */
  land(sig: string): void { this.dropSends = false; void this.send(new TextEncoder().encode(sig)); }
}

/** The fake client: one port per (unordered) pair; installs the crank gate on both coins' FakePrograms. */
export class FakePairForward implements PairForwardClient {
  readonly ports = new Map<string, FakePairForwardPort>();
  private fake: (mint: string) => FakeProgram;
  private now: () => number;
  constructor(fake: (mint: string) => FakeProgram, now: () => number) { this.fake = fake; this.now = now; }
  port(mintA: string, mintB: string): FakePairForwardPort {
    const [lo, hi] = sortPairMints(mintA, mintB), key = `${lo}|${hi}`;
    let p = this.ports.get(key);
    if (!p) {
      p = new FakePairForwardPort(mintA, mintB, this.fake, this.now);
      const port = p;
      for (const m of [mintA, mintB]) { try { const f = this.fake(m); f.pairGate = (D, at) => port.gate(m, D, at); } catch { /* not initialised (yet) */ } }
      this.ports.set(key, p);
    }
    return p;
  }
}
