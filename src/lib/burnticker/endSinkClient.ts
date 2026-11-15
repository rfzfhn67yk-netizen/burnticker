import crypto from "node:crypto";
import type { ConfirmOutcome, SignedTx } from "@/lib/burnKeeper/programPort";
import type { FakeProgram } from "@/lib/burnKeeper/fakeProgram";
import { formatDate, spendablePool } from "@/lib/burnReceipts/math";
import { parseEndForwardMemo } from "@/lib/burnReceipts/endSink";
import { INCINERATOR_ADDRESS } from "@/lib/burnticker/rules";
import { QUEUE_UNBLOCK_SECS } from "@/lib/burnReceipts/constants";
/** The rent-exempt minimum of an empty account (Rent::minimum_balance(0)): the smallest credit the incinerator accepts. */
export const INCINERATOR_MIN_LAMPORTS = BigInt(890_880);

/**
 * END SINKS FROM THE KEEPER'S SIDE (owner decision 2026-10-11, LAUNCHPAD-PATH §45; burn_receipts program round 4, end.rs). The typed
 * adapter the keeper (endSinkKeeper.ts) and the pages code against, with an in-memory fake; the real client is endSinkChain.ts over
 * src/lib/burnReceipts/endSink.ts.
 *
 *   EndSink   pinned at initialize_token, never changed: flagship ($DEFICIT, compiled per cluster) / a named coin / the pair winner.
 *   RuleEnd   submit_rule_end: a quorum of the coin's attesters signs the end (date, resolved | void). Once per coin.
 *   forward   forward_on_end (permissionless): after a RESOLVED end, once every reading inside the window is processed, the fee PDA's
 *             spendable SOL + WSOL (all of it: no burn-pool cap since the owner decision of 2026-10-25) moves to the destination the PROGRAM picks (the named coin while it is
 *             live; for a pair winner only when the end date's PairResult names it; else the flagship), never under the EndSink's
 *             minimum. Callable again for the later fee trickle. A VOID end keeps the coin's own wind-down.
 */

export type EndOutcome = "resolved" | "void";
export type EndSinkKindView = "flagship" | "mint" | "pair-winner" | "league-set" | "incinerator";
export interface EndSinkView { kind: EndSinkKindView; sinkMint: string; minForwardLamports: bigint }
export interface RuleEndView { recordDate: number; outcome: EndOutcome; forwardedLamports: bigint; forwards: number; lastForwardAt: number }
/** What forward_on_end would do now; "ready" carries the destination the program will pick. */
export type EndForwardReadiness =
  | { status: "ready"; target: string; intended: string }
  | { status: "not-ended" | "void" | "no-end-sink" | "readings-pending" | "flagship-not-live" | "flagship-not-pinned" };

export interface EndSinkPort {
  readonly mint: string;
  endSink(): Promise<EndSinkView | null>;
  ruleEnd(): Promise<RuleEndView | null>;
  /** The fee PDA's SOL above the reserve plus its WSOL, less the carry held on the coin in the 30-day grace after a RESOLVED end (round-5
   *  R5-4) — what a forward moves (there is no burn-pool cap since 2026-10-25). */
  spendableLamports(): Promise<bigint>;
  /** submit_rule_end, quorum-signed by the client's attester keys (Ed25519SigVerify + the instruction). Signed, not sent. */
  buildRuleEnd(o: { recordDate: number; outcome: EndOutcome; sourceUrl: string; proofHash?: Uint8Array }): Promise<SignedTx & { message: string }>;
  planForward(): Promise<EndForwardReadiness>;
  /** The target fee PDA's WSOL account (idempotent) + forward_on_end, to the destination planForward named. Signed, not sent. */
  buildForward(): Promise<SignedTx>;
  simulate(raw: Uint8Array): Promise<{ err: string | null; logs: string[] }>;
  send(raw: Uint8Array): Promise<void>;
  confirm(tx: Pick<SignedTx, "signature" | "blockhash" | "lastValidBlockHeight">): Promise<ConfirmOutcome>;
  /** A confirmed forward's memo facts (`<PREFIX>|endfwd|to=<12>|lamports=N|v1`), or null when it is not readable (yet). */
  forwardFacts(signature: string): Promise<{ to12: string; lamports: bigint; memo: string } | null>;
}
export interface EndSinkClient {
  /** The flagship mint this build compiles (the fall-through sink). */
  readonly flagship: string;
  port(mint: string): EndSinkPort;
}

/** The end-forward memo (program memo.rs format_end_forward), parsed by the program builder's client. */
export { parseEndForwardMemo };
/** Round 5: the plain receipt line for a landed burn_sol_on_end (the incinerator end sink). */
export function endBurnLine(fromTicker: string, lamports: bigint): string {
  const SOL = BigInt(1_000_000_000), frac = (lamports % SOL).toString().padStart(9, "0").replace(/0+$/, "");
  return `$${fromTicker}'s rule ended with a result, so ${lamports / SOL}${frac ? `.${frac}` : ""} SOL left in its burn pool was sent to Solana's incinerator, which nothing can spend from.`;
}
/** The plain receipt line for a landed end forward. */
export function endForwardLine(fromTicker: string, toTicker: string, lamports: bigint): string {
  const SOL = BigInt(1_000_000_000), frac = (lamports % SOL).toString().padStart(9, "0").replace(/0+$/, "");
  return `$${fromTicker}'s rule ended with a result, so ${lamports / SOL}${frac ? `.${frac}` : ""} SOL left in its burn pool moved to the $${toTicker} burn pool, where it burns $${toTicker}.`;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The fake: end.rs in memory, over the coins' FakePrograms
// ---------------------------------------------------------------------------------------------------------------------------------

const Z = BigInt(0);
type EndPayload = { kind: "end"; recordDate: number; outcome: EndOutcome; keys: string[] } | { kind: "forward" };

/**
 * One coin's end sink in memory. `pinned` is set by FakeBurnProgram.initializeToken from the rule (rules.ts endSinkOf). submit_rule_end
 * checks what end.rs checks (an EndSink, once, a valid date not in the future and on or after the last reading, the quorum) and sets the
 * coin's FakeProgram endState (readings and cranks after a resolved end are refused there). forward_on_end mirrors handle_forward_on_end:
 * resolved, readings processed (or no pool), the destination (named coin live, pair winner by `partnerWon`, else the flagship, which
 * must be live), the whole spendable amount ≥ the minimum (no cap since 2026-10-25), SOL first then WSOL, carried spend cleared, the memo written.
 */
export class FakeEndSinkPort implements EndSinkPort {
  readonly mint: string;
  pinned: EndSinkView | null = null;
  rule: RuleEndView | null = null;
  /** RuleEnd.submitted_at (unix seconds): the start of the 30-day carry grace (end.rs carry_held_back). */
  submittedAt = 0;
  simErr: string | null = null;
  /** Round 5: lamports this coin sent to the incinerator (burn_sol_on_end), for tests. */
  incinerated = BigInt(0);
  dropSends = false;
  private readonly fake: (m: string) => FakeProgram;
  private readonly flagshipOf: () => string;
  private readonly now: () => number;
  private readonly partnerWon: (mint: string, partner: string, date: number) => boolean;
  private readonly payloads = new Map<string, EndPayload>();
  readonly landed = new Map<string, { err: string | null; memo: string | null; payload: EndPayload }>();
  private n = 0;
  constructor(mint: string, fake: (m: string) => FakeProgram, flagship: () => string, now: () => number, partnerWon: (mint: string, partner: string, date: number) => boolean) {
    this.mint = mint; this.fake = fake; this.flagshipOf = flagship; this.now = now; this.partnerWon = partnerWon;
  }
  async endSink() { return this.pinned; }
  async ruleEnd() { return this.rule; }
  async spendableLamports() { const f = this.fake(this.mint), all = spendablePool(f.feeLamports, f.cfg.reserveLamports, f.wsol), held = this.heldBack(); return all > held ? all - held : Z; }
  private sig(label: string): string { return crypto.createHash("sha256").update(`${this.mint}|${label}|${++this.n}`).digest("hex"); }
  async buildRuleEnd(o: { recordDate: number; outcome: EndOutcome; sourceUrl: string; proofHash?: Uint8Array }) {
    const f = this.fake(this.mint);
    const message = `BURNRECEIPTS-END-v1|fake|${f.programId}|${this.mint}|${formatDate(o.recordDate)}|outcome=${o.outcome}|src=${crypto.createHash("sha256").update(o.sourceUrl).digest("hex")}|proof=${Buffer.from(o.proofHash ?? new Uint8Array(32)).toString("hex")}`;
    const signature = this.sig("end");
    this.payloads.set(signature, { kind: "end", recordDate: o.recordDate, outcome: o.outcome, keys: [...f.heldKeys] });
    return { signature, raw: new TextEncoder().encode(signature), blockhash: "fake", lastValidBlockHeight: 1_000_000, message };
  }
  private destination(): EndForwardReadiness {
    const f = this.fake(this.mint), s = this.pinned;
    if (!s) return { status: "no-end-sink" };
    if (!this.rule) return { status: "not-ended" };
    if (this.rule.outcome === "void") return { status: "void" };
    if (f.cfg.crankCursor !== f.cfg.lastRecordDate && f.cfg.poolRegistered) return { status: "readings-pending" };
    // round-5 review R5-9: a target coin (its BurnTarget pinned: the fake's burnTarget, and not stalled) is live before its own pool is verified
    const live = (m: string): boolean => { try { const x = this.fake(m); return (x.cfg.poolRegistered || (!!x.burnTarget && !x.targetStalled)) && x.endState.state === "live" && x.cfg.mode === "buyback"; } catch { return false; } };
    const flagship = this.flagshipOf();
    if (s.kind === "incinerator") return { status: "ready", target: INCINERATOR_ADDRESS, intended: INCINERATOR_ADDRESS };
    let intended = flagship;
    if (s.kind === "mint") intended = s.sinkMint;
    else if (s.kind === "pair-winner" && this.partnerWon(this.mint, s.sinkMint, this.rule.recordDate)) intended = s.sinkMint;
    const target = intended !== flagship && live(intended) ? intended : flagship;
    if (target === flagship && !live(flagship)) return { status: "flagship-not-live" };
    return { status: "ready", target, intended };
  }
  async planForward() { return this.destination(); }
  async buildForward() {
    const signature = this.sig("forward");
    this.payloads.set(signature, { kind: "forward" });
    return { signature, raw: new TextEncoder().encode(signature), blockhash: "fake", lastValidBlockHeight: 1_000_000 };
  }
  private exec(p: EndPayload, commit: boolean): { err: string } | { memo: string | null } {
    const f = this.fake(this.mint);
    if (p.kind === "end") {
      if (!this.pinned) return { err: "AccountNotInitialized" };
      if (this.rule) return { err: "RuleEnded" };
      const today = Number(new Date(this.now()).toISOString().slice(0, 10).replace(/-/g, ""));
      if (p.recordDate > today || f.cfg.lastRecordDate === 0 || p.recordDate !== f.cfg.lastRecordDate) return { err: "InvalidRuleEnd" };
      const signed = f.cfg.attesters.filter((a) => p.keys.includes(a.key)).length;
      if (signed < f.cfg.quorum) return { err: "QuorumNotMet" };
      if (!commit) return { memo: null };
      this.rule = { recordDate: p.recordDate, outcome: p.outcome, forwardedLamports: Z, forwards: 0, lastForwardAt: 0 };
      this.submittedAt = Math.floor(this.now() / 1000);
      f.endState = { state: p.outcome, date: p.recordDate };
      return { memo: null };
    }
    const d = this.destination();
    if (d.status !== "ready") return { err: d.status === "readings-pending" ? "EndReadingsPending" : d.status === "flagship-not-live" ? "FlagshipNotLive" : "NotEndedResolved" };
    // round-5 review R5-4 (end.rs carry_held_back): for 30 days after a RESOLVED end a SELF coin with a verified pool keeps its carried
    // spend on the coin (crank_carried drains it first); the end paths move only the fuel above it and leave the carry in place. After
    // the grace they move everything and clear it (nothing can strand).
    const heldBack = this.heldBack();
    if (this.pinned!.kind === "incinerator") {
      // burn_sol_on_end: the WSOL unwrapped into the fee PDA first, then the SOL above the reserve (all of it; no cap) to the incinerator,
      // never under the rent-exempt minimum of an empty account (the runtime refuses a smaller credit to the incinerator)
      const above = (f.feeLamports + f.wsol) > f.cfg.reserveLamports ? f.feeLamports + f.wsol - f.cfg.reserveLamports : Z;
      const solAll = above > heldBack ? above - heldBack : Z;
      const amt = solAll;
      if (amt === Z || (amt < this.pinned!.minForwardLamports && this.rule!.forwards > 0) || amt < INCINERATOR_MIN_LAMPORTS) return { err: "NothingToForward" };
      if (!commit) return { memo: null };
      f.feeLamports += f.wsol; f.wsol = Z; f.feeLamports -= amt;
      if (heldBack === Z) f.cfg = { ...f.cfg, carriedSpendLamports: Z };
      this.incinerated += amt;
      const r0 = this.rule!;
      this.rule = { ...r0, forwardedLamports: r0.forwardedLamports + amt, forwards: r0.forwards + 1, lastForwardAt: Math.floor(this.now() / 1000) };
      return { memo: `${f.cfg.memoPrefix}|endburn|to=${INCINERATOR_ADDRESS.slice(0, 12)}|lamports=${amt}|v1` };
    }
    const solAvail = f.feeLamports > f.cfg.reserveLamports ? f.feeLamports - f.cfg.reserveLamports : Z;
    const actual = solAvail + f.wsol > heldBack ? solAvail + f.wsol - heldBack : Z;
    const amount = actual;
    if (amount === Z || (amount < this.pinned!.minForwardLamports && this.rule!.forwards > 0)) return { err: "NothingToForward" };
    if (!commit) return { memo: null };
    const sol = amount < solAvail ? amount : solAvail;
    f.feeLamports -= sol; f.wsol -= amount - sol;
    if (heldBack === Z) f.cfg = { ...f.cfg, carriedSpendLamports: Z };
    this.fake(d.target).deposit(amount);
    const r = this.rule!;
    this.rule = { ...r, forwardedLamports: r.forwardedLamports + amount, forwards: r.forwards + 1, lastForwardAt: Math.floor(this.now() / 1000) };
    return { memo: `${f.cfg.memoPrefix}|endfwd|to=${d.target.slice(0, 12)}|lamports=${amount}|v1` };
  }
  /** end.rs carry_held_back: the carried spend a drainable SELF coin keeps for QUEUE_UNBLOCK_SECS after a RESOLVED end, else 0. */
  heldBack(): bigint {
    const f = this.fake(this.mint);
    const drainable = !f.burnTarget && f.cfg.poolRegistered;
    return drainable && this.rule?.outcome === "resolved" && Math.floor(this.now() / 1000) - this.submittedAt < QUEUE_UNBLOCK_SECS ? f.cfg.carriedSpendLamports : Z;
  }
  async simulate(raw: Uint8Array) {
    if (this.simErr) return { err: this.simErr, logs: [] };
    const p = this.payloads.get(new TextDecoder().decode(raw));
    if (!p) return { err: "unknown transaction", logs: [] };
    const r = this.exec(p, false);
    return "err" in r ? { err: r.err, logs: [] } : { err: null, logs: [] };
  }
  async send(raw: Uint8Array) {
    const sig = new TextDecoder().decode(raw);
    if (this.dropSends || this.landed.has(sig)) return;
    const p = this.payloads.get(sig);
    if (!p) return;
    const r = this.exec(p, true);
    this.landed.set(sig, { err: "err" in r ? r.err : null, memo: "err" in r ? null : r.memo, payload: p });
  }
  async confirm(tx: Pick<SignedTx, "signature">): Promise<ConfirmOutcome> {
    const l = this.landed.get(tx.signature);
    if (!l) return { status: "expired" };
    return l.err ? { status: "failed", err: l.err } : { status: "confirmed", slot: 1 };
  }
  async forwardFacts(signature: string) {
    const memo = this.landed.get(signature)?.memo ?? null;
    const f = memo ? parseEndForwardMemo(memo) : null;
    return f && memo ? { to12: f.to12, lamports: f.lamports, memo } : null;
  }
}

export class FakeEndSink implements EndSinkClient {
  /** The flagship mint (a test that exercises forwards initialises a coin and points this at it). */
  flagship: string;
  readonly ports = new Map<string, FakeEndSinkPort>();
  private readonly fake: (m: string) => FakeProgram;
  private readonly now: () => number;
  /** PAIR_WINNER: does the end date's PairResult name the partner as winner (and is the pair still paired)? Wired by FakeBurnProgram. */
  partnerWon: (mint: string, partner: string, date: number) => boolean = () => false;
  constructor(flagship: string, fake: (m: string) => FakeProgram, now: () => number) { this.flagship = flagship; this.fake = fake; this.now = now; }
  port(mint: string): FakeEndSinkPort {
    let p = this.ports.get(mint);
    if (!p) { p = new FakeEndSinkPort(mint, this.fake, () => this.flagship, this.now, (m, partner, date) => this.partnerWon(m, partner, date)); this.ports.set(mint, p); }
    return p;
  }
}
