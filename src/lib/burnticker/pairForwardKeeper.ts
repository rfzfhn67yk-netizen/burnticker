import { formatDate } from "@/lib/burnReceipts/math";
import { checkCosignature, type Cosigner } from "@/lib/burnticker/attesters/cosign";
import type { Cosignature } from "@/lib/burnKeeper/programPort";
import type { ProgramPort } from "@/lib/burnKeeper/programPort";
import type { BurnProgramClient } from "@/lib/burnticker/program";
import type { PairRow, ReceiptRow, Registry, TokenRow } from "@/lib/burnticker/registry";
import { pairWinnerTakesBurn } from "@/lib/burnticker/rules";
import { PAIR_FORWARD_ALERT_SECS, PAIR_RESULT_ALERT_SECS, UNLINK_REASON_TEXT, forwardLine, pairErrorSentence, pairedOn, type ForwardFacts, type PairForwardPort, type PairResultView, type UnlinkReason } from "@/lib/burnticker/pairForward";

/**
 * THE KEEPER'S WINNER-TAKES-THE-BURN STEPS (owner decision 2026-10-11, LAUNCHPAD-PATH §40). For a pair whose rules carry
 * `winnerTakesBurn` (or that the program reports paired), every result period D:
 *   1. both coins' receipts carry a pair role (planned in multiKeeper.planToken: the winner's units, and the loser's units "had it won"
 *      — the same units, its own fraction), so both coins attest D with the same units;
 *   2. the PairResult for D is submitted BEFORE either crank (submit_pair_result; idempotent — the same result again is a no-op, a
 *      different one is ConflictingPairResult and an alert);
 *   3. the LOSER's reading D is processed by forward_to_winner, never by crank_buyback (the program refuses ForwardRequired), and the
 *      keeper runs the losers of the cycle first so the forward lands before the winner's crank; the winner never waits for it;
 *   4. a landed forward is written to the loser's receipts (status `forwarded`, the program's amounts), to the append-only
 *      `pair_forwards` table, and logged as "forwarded from $LOSER: N SOL → $WINNER burn pool";
 *   5. `pair-result-missing` when a pair reading has no result PAIR_RESULT_ALERT_SECS after it was attested (the program burns it
 *      unpaired 72 h after the reading, and that period can then never forward); `pair-forward-pending` when a due forward has not
 *      landed PAIR_FORWARD_ALERT_SECS after the loser's reading was attested; `pair-unmatched` daily while a LaunchLab pair's second coin
 *      has not named the first back (7-day pairing window).
 * A draw forwards nothing: each coin burns its own fuel for that period.
 */

/**
 * `active` = forwards apply: the program reports the two coins PAIRED (only then does it gate the cranks and accept forwards). `hold` =
 * do not plan or execute this coin this cycle: its rule says winner takes the burn but the chain cannot say yet whether it is paired
 * (the pair state is unreadable, or a LaunchLab pair is still inside its 7-day pairing window) — a receipt's pair role is written once
 * and never changes, so it is never guessed. A flagged pair the program never paired (window closed) is two plain coins: inactive.
 */
export interface PairCtx {
  pair: PairRow; me: TokenRow; other: TokenRow; port: PairForwardPort; active: boolean; hold?: string;
  /** The pairing day (YYYYMMDD, the later paired_at): periods before it have no PairResult (PairDateBeforePairing) and crank as plain. */
  pairedOn?: number | null;
  /** r3: the later pair_after_date (YYYYMMDD): periods on or before it were read before the pairing — no PairResult (PairPeriodUnpaired). */
  pairAfterDate?: number;
}

/** This coin's pair, its counterpart and the pair port — or null outside a pair / without a pair client. */
export async function pairCtxFor(reg: Registry, program: Pick<BurnProgramClient, "pairForward">, t: TokenRow, now: number = Date.now()): Promise<PairCtx | null> {
  const pair = reg.pairOf(t.mint);
  if (!pair || !program.pairForward) return null;
  const other = reg.token(pair.mintA === t.mint ? pair.mintB : pair.mintA);
  if (!other) return null;
  const port = program.pairForward.port(pair.mintA, pair.mintB);
  let ruleSays = false;
  try { ruleSays = pairWinnerTakesBurn(reg.lockedRule(t).rule); } catch { ruleSays = false; }
  let links: Awaited<ReturnType<PairForwardPort["links"]>>;
  try { links = await port.links(); } catch (e) {
    return { pair, me: t, other, port, active: false, ...(ruleSays ? { hold: `pair state unreadable (${(e as Error).message.slice(0, 80)})` } : {}) };
  }
  if (links.paired) return { pair, me: t, other, port, active: true, pairedOn: pairedOn(links.a, links.b), pairAfterDate: links.pairAfterDate ?? 0 };
  const deadline = Math.max(links.a?.pairingDeadline ?? 0, links.b?.pairingDeadline ?? 0);
  const provisional = links.stateA === 1 || links.stateB === 1;
  if (ruleSays && provisional && now < deadline * 1000) return { pair, me: t, other, port, active: false, hold: `pairing window open until ${new Date(deadline * 1000).toISOString()} (the second coin has not named the first back yet)` };
  return { pair, me: t, other, port, active: false };
}

/**
 * The winner of period D from BOTH coins' receipts counted into their readings D: this coin scores its won units plus the other's lost
 * units, the other the reverse; more → that coin, equal → draw (null). On an event day the two agree (the winner's won units = the
 * loser's mirrored lost units); on a one-shot loser's wind-down day only the loser has receipts (lost) and the winner scores them.
 */
export function periodWinner(rows: readonly Pick<ReceiptRow, "pairRole" | "units">[], me: string, other: string, otherRows: readonly Pick<ReceiptRow, "pairRole" | "units">[] = []): string | null {
  const sum = (xs: readonly Pick<ReceiptRow, "pairRole" | "units">[], role: string) => xs.filter((b) => b.pairRole === role).reduce((a, b) => a + b.units, 0);
  const mine = sum(rows, "won") + sum(otherRows, "lost"), theirs = sum(rows, "lost") + sum(otherRows, "won");
  return mine > theirs ? me : theirs > mine ? other : null;
}

const alertKey = (kind: string, pair: string, D: number) => `${kind}:${pair}:${D}`;
/** Registry status key: the pair was unlinked on chain (JSON { reason, reasonText, at, signature }). */
export const unlinkedKey = (pairId: string) => `pair.unlinked.${pairId}`;
function alert(reg: Registry, now: number, log: (s: string) => void, kind: string, key: string, text: string, meta: Record<string, unknown>): void {
  if (reg.recordAlert({ kind, key, text, meta }, now)) log(`  [alert] ${kind}: ${text}`);
}

/** When the keeper attested reading D for this coin (its confirmed submit_reading's send time), or null. */
export function attestedAt(reg: Registry, mint: string, D: number): number | null {
  const s = reg.signatures(mint, `reading:${formatDate(D)}`).find((x) => x.status === "confirmed");
  return s ? s.sentAt : null;
}

/** Ensures the PairResult for D exists (submits it when missing). Returns it, or the reason it is not there yet. */
export async function ensurePairResult(ctx: PairCtx, reg: Registry, D: number, o: { now: number; dryRun: boolean; log: (s: string) => void; winnerReading?: () => Promise<"exists" | "submitted" | "cannot" | { waiting: string }>; /** signer-2: the second signer (multiKeeper's deps.cosigner). */ cosigner?: Cosigner }): Promise<{ result: PairResultView; fresh?: true } | { waiting: string }> {
  const have = await ctx.port.result(D);
  const rows = reg.receiptsForReading(ctx.me.mint, D);
  const winner = periodWinner(rows, ctx.me.mint, ctx.other.mint, reg.receiptsForReading(ctx.other.mint, D));
  const name = (m: string | null) => (m === null ? "draw" : m === ctx.me.mint ? `$${ctx.me.ticker}` : `$${ctx.other.ticker}`);
  if (have) {
    if (have.winner !== winner) alert(reg, o.now, o.log, "pair-result-conflict", alertKey("pair-result-conflict", ctx.pair.pairId, D), `pair ${ctx.pair.pairId} ${formatDate(D)}: the recorded result is ${name(have.winner)}, this coin's receipts say ${name(winner)} — a recorded result never changes`, { pairId: ctx.pair.pairId, recordDate: D });
    return { result: have };
  }
  const at = attestedAt(reg, ctx.me.mint, D);
  if (at !== null && o.now - at >= PAIR_RESULT_ALERT_SECS * 1000) alert(reg, o.now, o.log, "pair-result-missing", alertKey("pair-result-missing", ctx.pair.pairId, D), `pair ${ctx.pair.pairId} ${formatDate(D)}: reading attested ${Math.round((o.now - at) / 3_600_000)} h ago and no pair result is recorded — after 72 h the program burns the period unpaired and it can never forward`, { pairId: ctx.pair.pairId, recordDate: D });
  // This coin lost D: a win needs BOTH coins' readings for D — make sure the winner's exists (a flat 0-unit one on a day the winner had
  // nothing to read, as on a one-shot loser's end-of-rule days). The result is only ever the true one: a draw is posted only for a true
  // draw. If the winner has already read past D the win is impossible — alert; the loser's reading then times out 72 h after it was
  // submitted and burns unpaired (PairForwardMissing / PairResultMissing): never a substitute draw.
  if (winner === ctx.other.mint && o.winnerReading) {
    const wr = await o.winnerReading();
    if (typeof wr === "object") return { waiting: `pair result for ${formatDate(D)} waits for $${ctx.other.ticker}'s reading: ${wr.waiting}` };
    if (wr === "cannot") {
      alert(reg, o.now, o.log, "pair-forward-impossible", alertKey("pair-forward-impossible", ctx.pair.pairId, D), `pair ${ctx.pair.pairId} ${formatDate(D)}: $${ctx.other.ticker} has no reading for the day and has read past it, so the win cannot be recorded — $${ctx.me.ticker}'s period times out 72 h after its reading and burns unpaired`, { pairId: ctx.pair.pairId, recordDate: D });
      return { waiting: `$${ctx.other.ticker} read past ${formatDate(D)} without a reading for it: no win can be recorded (the period times out after 72 h)` };
    }
  }
  if (o.dryRun) { o.log(`  [dry-run] pair ${ctx.pair.pairId} ${formatDate(D)}: would submit_pair_result winner=${name(winner)}`); return { waiting: "dry run" }; }
  const sourceUrl = `burnticker://pair/${ctx.pair.pairId}/${formatDate(D)}?winner=${winner ?? "draw"}`;
  // signer-2: the second signer is asked first; a disagreement is an alert and no result. Without its signature the program decides
  // (QuorumNotMet at quorum 2 is a wait below, as before).
  let cosignatures: Cosignature[] = [];
  if (o.cosigner && ctx.port.resultMessage) {
    const m = await ctx.port.resultMessage({ recordDate: D, winner, sourceUrl });
    const answer = await o.cosigner.cosign({ v: 1, kind: "pair", mintA: ctx.port.mintA, mintB: ctx.port.mintB, programId: m.programId, genesis: m.genesis, recordDate: formatDate(D), winner, sourceUrl, proofHash: "0".repeat(64), message: m.message });
    const r = checkCosignature(answer, m.message, []);
    if (r.kind === "disagree") {
      alert(reg, o.now, o.log, "cosigner-disagree", alertKey("cosigner-disagree", ctx.pair.pairId, D), `pair ${ctx.pair.pairId} ${formatDate(D)}: the second signer did not agree with the keeper's result (${name(winner)}), so no result was sent. ${r.why}`, { pairId: ctx.pair.pairId, recordDate: D });
      return { waiting: "Held. The second signer did not agree with this result, so none is sent until the two agree." };
    }
    if (r.kind === "signed") cosignatures = [r.cosignature];
    else o.log(`  [cosign] pair ${ctx.pair.pairId} ${formatDate(D)}: no second signature (${r.why})`);
  }
  const tx = await ctx.port.buildSubmitResult({ recordDate: D, winner, sourceUrl, ...(cosignatures.length ? { cosignatures } : {}) });
  const sim = await ctx.port.simulate(tx.raw);
  // PairResultNotServable (6090) now means only "a reading for D is missing, or the loser's reading for D is already processed": alert
  // and wait (no pool condition; a dead side makes the forward 0 lamports). Never post a draw that was not the result.
  if (sim.err === "PairResultNotServable" && winner !== null) {
    alert(reg, o.now, o.log, "pair-result-unservable", alertKey("pair-result-unservable", ctx.pair.pairId, D), `pair ${ctx.pair.pairId} ${formatDate(D)}: ${name(winner)}'s win cannot be recorded yet (${pairErrorSentence(sim.err)}); no draw is posted — without a result the period times out 72 h after its reading and burns unpaired`, { pairId: ctx.pair.pairId, recordDate: D });
  }
  if (sim.err) {
    if (sim.err === "ConflictingPairResult") alert(reg, o.now, o.log, "pair-result-conflict", alertKey("pair-result-conflict", ctx.pair.pairId, D), `pair ${ctx.pair.pairId} ${formatDate(D)}: ${pairErrorSentence(sim.err)}`, { pairId: ctx.pair.pairId, recordDate: D });
    return { waiting: `submit_pair_result refused: ${pairErrorSentence(sim.err)}` };
  }
  try { await ctx.port.send(tx.raw); } catch (e) { o.log(`  [pair] ${ctx.pair.pairId}: submit_pair_result send raised ${(e as Error).message.slice(0, 120)}`); }
  const c = await ctx.port.confirm(tx);
  if (c.status !== "confirmed") return { waiting: `submit_pair_result ${c.status === "failed" ? `failed: ${pairErrorSentence(c.err)}` : "not confirmed yet"}` };
  const r = await ctx.port.result(D);
  if (!r) return { waiting: "submit_pair_result confirmed; the result is not readable yet" };
  o.log(`  [pair] ${ctx.pair.pairId} ${formatDate(D)}: result recorded — ${r.winner === null ? "draw (each coin burns its own fuel)" : `${name(r.winner)} takes the burn`} · ${tx.signature}`);
  return { result: r, fresh: true };
}

/** What a landed forward did, written down: the loser's receipts (via the caller's recordCrank), pair_forwards, the log line. */
export function recordForward(reg: Registry, ctx: PairCtx, D: number, facts: ForwardFacts, signature: string, slot: number | null, now: number, log: (s: string) => void): string {
  reg.recordPairForward({ signature, pairId: ctx.pair.pairId, recordDate: D, loserMint: facts.loserMint, winnerMint: facts.winnerMint, units: facts.units, poolLamports: facts.poolLamports, lamports: facts.lamports, solLamports: facts.solLamports, wsolLamports: facts.wsolLamports, at: now, slot });
  const loser = facts.loserMint === ctx.me.mint ? ctx.me : ctx.other, winner = facts.winnerMint === ctx.me.mint ? ctx.me : ctx.other;
  const line = forwardLine(loser.ticker, winner.ticker, facts.lamports);
  log(`  [pair] ${formatDate(D)}: ${line} · ${signature}`);
  return line;
}

/**
 * The loser's forward for reading D (the caller's crank loop hands over when D's result names the other coin). Returns the processed
 * reading's facts or the reason it waits. Write-ahead under `forward:<date>`; the caller records the receipts with recordCrank.
 */
export async function forwardLoss(ctx: PairCtx, reg: Registry, port: ProgramPort, D: number, o: { now: number; dryRun: boolean; log: (s: string) => void }): Promise<{ signature: string; slot: number | null; memo: string | null; facts: ForwardFacts | null } | { waiting: string; error?: boolean }> {
  const Ds = formatDate(D), mint = ctx.me.mint;
  const at = attestedAt(reg, mint, D);
  const pending = (why: string) => { if (at !== null && o.now - at >= PAIR_FORWARD_ALERT_SECS * 1000) alert(reg, o.now, o.log, "pair-forward-pending", alertKey("pair-forward-pending", ctx.pair.pairId, D), `pair ${ctx.pair.pairId} ${Ds}: $${ctx.me.ticker}'s fuel for the period has not reached $${ctx.other.ticker}'s burn pool — ${why}`, { pairId: ctx.pair.pairId, recordDate: D, loser: mint }); };
  // a forward sent earlier whose confirmation was lost
  for (const s of reg.signatures(mint, `forward:${Ds}`).filter((x) => x.status === "sent")) {
    const c = await ctx.port.confirm(s);
    if (c.status === "confirmed") { reg.setSignatureStatus(s.signature, "confirmed", null, c.slot); const f = await ctx.port.forwardFacts(s.signature); return { signature: s.signature, slot: c.slot, memo: f && f !== "none" ? f.memo : await port.memoOf(s.signature), facts: f && f !== "none" ? f : null }; }
    reg.setSignatureStatus(s.signature, c.status === "failed" ? "failed" : "expired", c.status === "failed" ? c.err : null, null);
  }
  if (o.dryRun) { o.log(`  [dry-run] $${ctx.me.ticker} ${Ds}: would forward_to_winner → $${ctx.other.ticker}`); return { waiting: "dry run" }; }
  const tx = await ctx.port.buildForward({ loserMint: mint, recordDate: D });
  const sim = await ctx.port.simulate(tx.raw);
  // r3 RI-1: past the 72 h window the forward is refused — the planner switches to the paired buyback; a wait, not an error
  if (sim.err === "ForwardWindowClosed") return { waiting: `forward_to_winner: ${pairErrorSentence(sim.err)}` };
  if (sim.err) { const why = `forward_to_winner refused: ${pairErrorSentence(sim.err)}`; pending(why); return { waiting: why, error: true }; }
  reg.recordSignature({ signature: tx.signature, mint, eventId: `forward:${Ds}`, memo: `forward_to_winner ${Ds}`, burnRaw: BigInt(0), spendLamports: BigInt(0), blockhash: tx.blockhash, lastValidBlockHeight: tx.lastValidBlockHeight, sentAt: o.now });
  try { await ctx.port.send(tx.raw); } catch (e) { o.log(`  [pair] $${ctx.me.ticker} ${Ds}: forward send raised ${(e as Error).message.slice(0, 120)} — the signature is on the ledger and will be resolved`); }
  const c = await ctx.port.confirm(tx);
  if (c.status === "failed") { reg.setSignatureStatus(tx.signature, "failed", c.err, null); const why = `forward_to_winner failed on chain: ${pairErrorSentence(c.err)}`; pending(why); return { waiting: why, error: true }; }
  if (c.status === "expired") { pending("the forward is not confirmed yet"); return { waiting: `forward ${tx.signature.slice(0, 12)}… not confirmed yet` }; }
  reg.setSignatureStatus(tx.signature, "confirmed", null, c.slot);
  const f = await ctx.port.forwardFacts(tx.signature);
  return { signature: tx.signature, slot: c.slot, memo: f && f !== "none" ? f.memo : await port.memoOf(tx.signature), facts: f && f !== "none" ? f : null };
}

/** `pair-unmatched`: a pair whose coins are not paired on chain yet (LaunchLab: the second coin must name the first within 7 days). */
export async function pairUnmatchedAlerts(reg: Registry, program: Pick<BurnProgramClient, "pairForward">, now: number, log: (s: string) => void): Promise<string[]> {
  const out: string[] = [];
  if (!program.pairForward) return out;
  for (const pr of reg.pairs()) {
    const a = reg.token(pr.mintA), b = reg.token(pr.mintB);
    if (!a || !b) continue;
    let rule = false;
    try { rule = pairWinnerTakesBurn(reg.lockedRule(a).rule); } catch { rule = false; }
    if (!rule) continue;
    let l: Awaited<ReturnType<PairForwardPort["links"]>>;
    try { l = await program.pairForward.port(pr.mintA, pr.mintB).links(); } catch { continue; }
    if (l.paired) continue;
    const deadline = Math.max(l.a?.pairingDeadline ?? 0, l.b?.pairingDeadline ?? 0);
    const text = `pair ${pr.pairId} ($${a.ticker} / $${b.ticker}) is not paired on chain (states ${l.stateA}/${l.stateB})${deadline ? `; the pairing window closes ${new Date(deadline * 1000).toISOString()} — after that both are plain coins for good` : ""}`;
    alert(reg, now, log, "pair-unmatched", `pair-unmatched:${pr.pairId}`, text, { pairId: pr.pairId });
    out.push(pr.pairId);
  }
  return out;
}

/**
 * Round 2 (r2 H-1(c)): a LOST period whose forward never landed within 72 h of the reading cranks UNPAIRED (the program emits
 * PairForwardMissing) — its fuel burned this coin instead of moving to the winner. Called with what the crank recorded.
 */
export function forwardMissingAlert(reg: Registry, t: Pick<TokenRow, "mint" | "ticker">, D: number, outcome: string, now: number, log: (s: string) => void): void {
  if (outcome === "forwarded") return;
  const rows = reg.receiptsForReading(t.mint, D);
  if (!rows.some((b) => b.pairRole === "lost")) return;
  const pr = reg.pairOf(t.mint);
  // re-check P3-I3: after unlink_pair the coin is plain — its period burned as a plain coin, which is not a missing forward
  const unlinked = pr ? reg.getStatus(unlinkedKey(pr.pairId)) : null;
  if (unlinked !== null) {
    const at = (() => { try { return new Date(Number((JSON.parse(unlinked) as { at?: number }).at)).toISOString().slice(0, 10); } catch { return "an earlier day"; } })();
    log(`  [pair] $${t.ticker} ${formatDate(D)}: burned as a plain coin (the pair was unlinked on ${at}); no forward was due`);
    return;
  }
  alert(reg, now, log, "pair-forward-missing", alertKey("pair-forward-missing", pr?.pairId ?? t.mint, D), `$${t.ticker} ${formatDate(D)}: lost the period but no forward landed within 72 hours of its reading, so the program cranked it unpaired (PairForwardMissing) — the fuel burned $${t.ticker}, not the winner`, { mint: t.mint, recordDate: D, outcome });
}

/**
 * UNLINK (r2 M-2): for every pair still paired on chain, the keeper sends the permissionless unlink_pair once the program's evidence holds —
 * a voided pair curve, a refunding side, or (round 3) a LaunchLab pair whose locked voidBy day ended with a coin still without a verified
 * pool; there is no time-based evidence. Both coins are plain
 * afterwards (new receipts carry no pair role); the pages say "unpaired (reason)". A pair someone else unlinked is recorded too.
 */
export async function pairUnlinkStep(reg: Registry, program: Pick<BurnProgramClient, "pairForward">, now: number, dryRun: boolean, log: (s: string) => void, o: { send?: boolean } = {}): Promise<{ pairId: string; reason: UnlinkReason | null; signature: string | null }[]> {
  const out: { pairId: string; reason: UnlinkReason | null; signature: string | null }[] = [];
  if (!program.pairForward) return out;
  for (const pr of reg.pairs()) {
    const a = reg.token(pr.mintA), b = reg.token(pr.mintB);
    if (!a || !b) continue;
    const port = program.pairForward.port(pr.mintA, pr.mintB);
    let l: Awaited<ReturnType<PairForwardPort["links"]>>;
    try { l = await port.links(); } catch { continue; }
    // review RL-2: the chain is read every cycle, never the record alone — a pair recorded unlinked that the chain says is paired again
    // (a re-link) is an alert, not something to fight over.
    if (reg.getStatus(unlinkedKey(pr.pairId)) !== null) {
      if (l.paired) alert(reg, now, log, "pair-unlink-drift", `pair-unlink-drift:${pr.pairId}`, `pair ${pr.pairId} ($${a.ticker} / $${b.ticker}) is recorded unlinked but the chain says paired again — the pages say "unpaired"; check who re-linked it`, { pairId: pr.pairId });
      continue;
    }
    if (!l.paired) {
      // unlinked by someone else: both links closed, both coins plain — recorded once the pair had acted as a pair here
      const wasPaired = [...reg.receipts(pr.mintA), ...reg.receipts(pr.mintB)].some((r) => r.pairRole !== null);
      // r3: unlink_pair leaves both coins UNLINKED (pair_state 3); r2-era unlinks left them at 0
      if (wasPaired && !l.a && !l.b && ((l.stateA === 3 && l.stateB === 3) || (l.stateA === 0 && l.stateB === 0))) {
        reg.setStatus(unlinkedKey(pr.pairId), JSON.stringify({ reason: null, reasonText: "unlinked on chain (the reason is in its PairUnlinked event)", at: now, signature: null }));
        log(`  [pair] ${pr.pairId}: unlinked on chain — both coins are plain coins now`);
        out.push({ pairId: pr.pairId, reason: null, signature: null });
      }
      continue;
    }
    let ev: Awaited<ReturnType<PairForwardPort["unlinkEvidence"]>>;
    try { ev = await port.unlinkEvidence(now); } catch { continue; }
    if (!ev) continue;
    const text = UNLINK_REASON_TEXT[ev.reason];
    if (!o.send) { log(`  [pair] ${pr.pairId}: unlink evidence holds (${text}) — not sent (KeeperDeps.pairUnlink is false)`); continue; }
    if (dryRun) { log(`  [dry-run] pair ${pr.pairId}: would unlink_pair (${text})`); continue; }
    const tx = await port.buildUnlink({ pair: ev.pair });
    const sim = await port.simulate(tx.raw);
    if (sim.err) { log(`  [pair] ${pr.pairId}: unlink_pair refused — ${pairErrorSentence(sim.err)}`); continue; }
    try { await port.send(tx.raw); } catch (e) { log(`  [pair] ${pr.pairId}: unlink_pair send raised ${(e as Error).message.slice(0, 120)}`); }
    const c = await port.confirm(tx);
    if (c.status !== "confirmed") { log(`  [pair] ${pr.pairId}: unlink_pair ${c.status === "failed" ? `failed: ${pairErrorSentence(c.err)}` : "not confirmed yet"}`); continue; }
    reg.setStatus(unlinkedKey(pr.pairId), JSON.stringify({ reason: ev.reason, reasonText: text, at: now, signature: tx.signature }));
    alert(reg, now, log, "pair-unlinked", `pair-unlinked:${pr.pairId}`, `pair ${pr.pairId} ($${a.ticker} / $${b.ticker}) unlinked: ${text}; both are plain coins now and nothing forwards between them`, { pairId: pr.pairId, reason: ev.reason });
    out.push({ pairId: pr.pairId, reason: ev.reason, signature: tx.signature });
  }
  return out;
}

/** The recorded unlink of a pair (for the pages and the API), or null. */
export function pairUnlinked(reg: Pick<Registry, "getStatus">, pairId: string): { reason: string; at: string; signature: string | null } | null {
  const raw = reg.getStatus(unlinkedKey(pairId));
  if (!raw) return null;
  try { const j = JSON.parse(raw) as { reasonText: string; at: number; signature: string | null }; return { reason: j.reasonText, at: new Date(j.at).toISOString(), signature: j.signature }; } catch { return null; }
}

