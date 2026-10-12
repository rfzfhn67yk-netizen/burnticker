import crypto from "node:crypto";
import type { EndOutcome, EndSinkPort } from "@/lib/burnticker/endSinkClient";
import { endForwardLine } from "@/lib/burnticker/endSinkClient";
import type { Registry, TokenRow } from "@/lib/burnticker/registry";
import { endSinkOf, isOneShot, SWEEP_EVERY_DAYS, type LockedRule } from "@/lib/burnticker/rules";
import type { PairGate } from "@/lib/burnticker/units";
import { COUNTER_BASE, counterSourceUrl, type BurnProgramClient } from "@/lib/burnticker/program";
import { rulesSha256 } from "@/lib/burnKeeper/rules";
import type { Cosignature, ProgramConfigView, ProgramPort, ReadingInput } from "@/lib/burnKeeper/programPort";

/**
 * THE KEEPER'S END-SINK STEPS (owner decision 2026-10-11, LAUNCHPAD-PATH §45; program round 4). Called from multiKeeper.planRuleEnd once
 * a coin's rule has ENDED (detectRuleEnd), for a coin whose rule carries `onEnd.endSink` and whose TokenConfig has an EndSink on chain:
 *
 *   outcome    VOID when the end is a void (the pair voided, the one-shot's market voided, a derby or season that was voided or
 *              cancelled); RESOLVED otherwise (a season over, a one-shot settled YES or NO, a derby season over, a bracket slot lost).
 *   record     once nothing is left to attest or crank (no planned or sending receipts): submit_rule_end, quorum-signed, dated the
 *              later of the end's UTC day and the coin's last reading (the program refuses an earlier date), never after today.
 *   RESOLVED   no drain, no wind-down: forward_on_end moves what is left to the sink (the program picks the destination), the coin
 *              retires, and later fee income is forwarded again whenever it passes the EndSink's minimum, at most once every
 *              SWEEP_EVERY_DAYS (the retired sweep follows the sink).
 *   VOID       the end is recorded, then planRuleEnd's ordinary wind-down runs on the coin itself (handled = false).
 *   PAIR WINNER  a winner-takes-the-burn pair coin that WON the end date's result is the sink itself ("burns the winning coin"): no end
 *              is recorded for it, it stays live on chain, its partner's leftover forwards to it, and its own leftover and trickle burn
 *              it through the ordinary wind-down and retired sweep (handled = false). Recording its end would make it not live, so the
 *              partner's fuel would fall through to $DEFICIT.
 *
 * Nothing here computes an amount: the program reads the fee PDA. Dry run sends nothing. Every send is simulated first; a refusal is a
 * wait (logged), never a substitute action.
 */

export interface EndSinkStepDeps {
  registry: Registry;
  program: BurnProgramClient;
  log: (line: string) => void;
  now: () => number;
  dryRun: boolean;
  /**
   * signer-2: the keeper's co-signature intake for a READING (multiKeeper.cosignReading), so the flat baseline reading below goes to the
   * second signer like every other reading. Absent: no second signer. The END message itself is not co-signed yet (the signer host
   * answers readings only): at quorum 2 submit_rule_end is refused QuorumNotMet and the step waits, logged.
   */
  cosignReading?: (port: ProgramPort, cfg: ProgramConfigView, input: ReadingInput) => Promise<{ cosignatures: Cosignature[]; hold: string | null; note: string | null }>;
}
export interface EndSinkStepResult {
  /** true: the end-sink path owns this coin's end (resolved); false: the caller runs the wind-down (void, or not an end-sink coin). */
  handled: boolean;
  /** true: this coin's leftover and later trickle burn on the coin itself (the wind-down and the retired sweep). */
  selfBurn: boolean;
  /** One plain line for the cycle log / status. */
  note: string | null;
}

const DAY_MS = 86_400_000;
const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const u32 = (iso: string): number => Number(iso.replace(/-/g, ""));
const NOT_MINE: EndSinkStepResult = { handled: false, selfBurn: true, note: null };
const mine = (outcome: EndOutcome, note: string | null): EndSinkStepResult => ({ handled: outcome === "resolved", selfBurn: outcome !== "resolved", note });
/** The end's UTC day: the day the end falls in, a midnight end counting for the day before (a season over at 00:00 ends the last day). */
const endDayOf = (atMs: number): number => u32(isoDay(atMs - 1));

/** Resolved or void, from the same facts detectRuleEnd used. */
export function endOutcomeOf(reg: Pick<Registry, "receipts">, t: Pick<TokenRow, "mint">, locked: LockedRule, gate: PairGate | null, end: { reason: string }): EndOutcome {
  if (gate?.state === "voided") return "void";
  if (isOneShot(locked.rule)) {
    const ev = reg.receipts(t.mint).filter((b) => !["winddown", "drain", "sweep"].includes(b.kind) && b.status !== "pending-pair")[0];
    if (ev && ev.status === "voided") return "void";
  }
  return /\bvoid(ed)?\b|cancel+ed|no award/i.test(end.reason) ? "void" : "resolved";
}

/** The source the end attestation commits to: the coin, the date, the outcome and why (anyone can read the reason back). */
export const ruleEndSourceUrl = (ticker: string, date: string, outcome: EndOutcome, reason: string): string =>
  `burnticker://${ticker}/end/${date}?outcome=${outcome}&reason=${encodeURIComponent(reason.slice(0, 200))}`;

async function sendOnce(d: EndSinkStepDeps, port: Pick<EndSinkPort, "simulate" | "send" | "confirm">, t: TokenRow, key: string, tx: { signature: string; raw: Uint8Array; blockhash: string; lastValidBlockHeight: number }, memo: string): Promise<"confirmed" | string> {
  const sim = await port.simulate(tx.raw);
  if (sim.err) return `refused: ${sim.err}`;
  d.registry.recordSignature({ signature: tx.signature, mint: t.mint, eventId: key, memo, burnRaw: BigInt(0), spendLamports: BigInt(0), blockhash: tx.blockhash, lastValidBlockHeight: tx.lastValidBlockHeight, sentAt: d.now() });
  try { await port.send(tx.raw); } catch (e) { d.log(`  [end] $${t.ticker} ${key}: send raised ${(e as Error).message.slice(0, 120)}`); }
  const c = await port.confirm(tx);
  if (c.status === "confirmed") { d.registry.setSignatureStatus(tx.signature, "confirmed", null, c.slot); return "confirmed"; }
  if (c.status === "failed") { d.registry.setSignatureStatus(tx.signature, "failed", c.err, null); return `failed: ${c.err}`; }
  return `not confirmed yet (${tx.signature.slice(0, 12)}…)`;
}

export async function endSinkStep(d: EndSinkStepDeps, t: TokenRow, locked: LockedRule, gate: PairGate | null, end: { mode: "drain" | "winddown"; reason: string; at: number }): Promise<EndSinkStepResult> {
  const client = d.program.endSink;
  if (!client || !endSinkOf(locked.rule)) return NOT_MINE;
  const reg = d.registry, port = client.port(t.mint);
  const sink = await port.endSink();
  if (!sink) return NOT_MINE;   // launched without an EndSink (a coin from before §45): its hashed wind-down applies
  const outcome = endOutcomeOf(reg, t, locked, gate, end);
  const today = isoDay(d.now());
  let rec = await port.ruleEnd();
  const cfg = rec ? null : await d.program.port(t.mint).config();
  // the program dates the end exactly at the coin's last reading (the result that ended the rule; blind review M-1)
  const recordDate = cfg?.lastRecordDate ?? 0;
  // the pair winner of the end date is the sink itself: it winds down on its own coin and stays live for its partner's forward
  if (!rec && outcome === "resolved" && sink.kind === "pair-winner" && d.program.pairForward) {
    // the contest's last period is the date the PARTNER's end will carry: its last reading (the program dates an end exactly there, and
    // the partner reads nothing after its end); not this coin's own last reading, which its wind-down moves on. Before the partner has
    // read at all, the end's own day.
    const partnerLast = (await d.program.port(sink.sinkMint).config().catch(() => null))?.lastRecordDate ?? 0;
    const res = await d.program.pairForward.port(t.mint, sink.sinkMint).result(partnerLast || endDayOf(Math.min(end.at, d.now()))).catch(() => null);
    if (res?.winner === t.mint) return { handled: false, selfBurn: true, note: null };
  }
  // ----- record the end (once), after everything inside the window is attested and cranked -----
  if (!rec) {
    if (reg.pending(t.mint).length > 0) return mine(outcome, `$${t.ticker}: the rule ended (${outcome}); its last results are still being burned`);
    if (recordDate === 0) {
      // a coin that never read (its only result was a void, a tie, or none before the end): one flat baseline reading dated the end's
      // day (the unit counter at its base, 0 units, the clock proof) gives the end a date; the end is recorded on the next cycle
      const day = endDayOf(Math.min(end.at, d.now())), dayIso = `${String(day).slice(0, 4)}-${String(day).slice(4, 6)}-${String(day).slice(6)}`;
      if (!cfg || d.dryRun) return mine(outcome, `$${t.ticker}: the coin has no reading yet; a flat reading for ${dayIso} comes first`);
      const pp = d.program.port(t.mint);
      const input: ReadingInput = { recordDate: day, prevDate: 0, value: COUNTER_BASE, sourceUrl: counterSourceUrl(t.ticker, dayIso, []), feedId: cfg.feedId, valueDecimals: 0, proofHash: Buffer.from(rulesSha256(`clock|${dayIso}|${t.rulesSha}`), "hex") };
      const co = d.cosignReading ? await d.cosignReading(pp, cfg, input) : { cosignatures: [], hold: null, note: null };
      if (co.hold) return mine(outcome, `$${t.ticker}: flat reading for ${dayIso} before the end: ${co.hold}`);
      const tx = await pp.buildReading({ ...input, ...(co.cosignatures.length ? { cosignatures: co.cosignatures } : {}) });
      const r = await sendOnce(d, pp, t, `reading:${dayIso}`, tx, JSON.stringify({ message: tx.message, events: [], value: COUNTER_BASE.toString(), flat: "the reading the end is dated at" }));
      return mine(outcome, `$${t.ticker}: flat reading for ${dayIso} before the end: ${r}`);
    }
    if (d.dryRun) { d.log(`  [dry-run] $${t.ticker}: would record the rule's end (${outcome}, ${recordDate})`); return mine(outcome, null); }
    const dateIso = `${String(recordDate).slice(0, 4)}-${String(recordDate).slice(4, 6)}-${String(recordDate).slice(6)}`;
    const tx = await port.buildRuleEnd({ recordDate, outcome, sourceUrl: ruleEndSourceUrl(t.ticker, dateIso, outcome, end.reason), proofHash: crypto.createHash("sha256").update(`${t.rulesSha}|${end.reason}`).digest() });
    const r = await sendOnce(d, port, t, `rule-end:${outcome}`, tx, JSON.stringify({ message: tx.message, outcome, reason: end.reason }));
    d.log(`  [end] $${t.ticker}: rule end (${outcome}, ${dateIso}) ${r === "confirmed" ? `recorded on chain — ${tx.signature}` : r}`);
    if (r !== "confirmed") return mine(outcome, `$${t.ticker}: recording the rule's end: ${r}`);
    reg.setStatus(`rule.endsink.${t.mint}`, { outcome, recordDate, sinkKind: sink.kind, sinkMint: sink.sinkMint, signature: tx.signature }, d.now());
    rec = await port.ruleEnd();
    if (!rec) return mine(outcome, null);
  }
  if (rec.outcome === "void") return NOT_MINE;   // the wind-down on the coin itself
  // ----- RESOLVED: forward what is left, retire, and forward the later trickle -----
  const lastKey = `endfwd.last.${t.mint}`, lastFwd = reg.getStatus(lastKey);
  const due = !lastFwd || Date.parse(`${today}T00:00:00Z`) - Date.parse(`${lastFwd}T00:00:00Z`) >= SWEEP_EVERY_DAYS * DAY_MS;
  const spendable = await port.spendableLamports();
  const retire = (why: string): void => {
    if (t.status === "retired" || d.dryRun) return;
    reg.setTokenStatus(t.mint, "retired");
    reg.setStatus(`rule.retired.${t.mint}`, JSON.stringify({ reason: end.reason, at: d.now(), mode: "endsink" }));
    d.log(`  [end] $${t.ticker} RETIRED — ${why} (${end.reason})`);
  };
  // the first forward moves whatever is there (the program waives the minimum for it); the trickle waits for the minimum, weekly
  const first = rec.forwards === 0;
  if (spendable === BigInt(0) || (!first && spendable < sink.minForwardLamports) || (!first && !due && t.status === "retired")) { retire("nothing left over the end sink's minimum"); return mine("resolved", null); }
  const plan = await port.planForward();
  if (plan.status !== "ready") return mine("resolved", `$${t.ticker}: forward to the end sink waits (${plan.status})`);
  if (d.dryRun) { d.log(`  [dry-run] $${t.ticker}: would forward ${spendable} lamports to ${plan.target}`); return mine("resolved", null); }
  const tx = await port.buildForward();
  const r = await sendOnce(d, port, t, `endfwd-${today}`, tx, `forward_on_end ${today} → ${plan.target}`);
  if (r !== "confirmed") { d.log(`  [end] $${t.ticker}: forward to the end sink ${r}`); return mine("resolved", `$${t.ticker}: forward to the end sink ${r}`); }
  const facts = await port.forwardFacts(tx.signature);
  const to = reg.token(plan.target)?.ticker ?? (plan.target === client.flagship ? "DEFICIT" : plan.target.slice(0, 8));
  const line = endForwardLine(t.ticker, to, facts?.lamports ?? BigInt(0));
  reg.setStatus(lastKey, today, d.now());
  reg.setStatus(`rule.endfwd.${t.mint}`, { signature: tx.signature, to: plan.target, intended: plan.intended, lamports: (facts?.lamports ?? BigInt(0)).toString(), memo: facts?.memo ?? null, at: d.now(), line }, d.now());
  d.log(`  [end] $${t.ticker}: ${line} — ${tx.signature}`);
  retire("its leftover went to the end sink");
  return mine("resolved", line);
}
