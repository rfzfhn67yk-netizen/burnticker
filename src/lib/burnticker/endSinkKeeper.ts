import crypto from "node:crypto";
import type { EndOutcome, EndSinkPort, EndSinkView } from "@/lib/burnticker/endSinkClient";
import { loadExpectedConfig } from "@/lib/burnticker/admission";
import { endSinkKindOf, endSinkMismatch } from "@/lib/burnticker/admissionAccounts";
import { endBurnLine, endForwardLine } from "@/lib/burnticker/endSinkClient";
import type { Registry, TokenRow } from "@/lib/burnticker/registry";
import { endSinkOf, INCINERATOR_ADDRESS, isOneShot, SWEEP_EVERY_DAYS, type LockedRule } from "@/lib/burnticker/rules";
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
 *              CHAMPION (website-18): a champion-path coin whose team won the championship is recorded with the program's void outcome
 *              (the wind-down on the coin itself) and every keeper word says "won the championship: the rest burns on this coin".
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

/**
 * THE CHAMPION PATH (website-18; describe.ts championPathRule says it on the coin): a season wins coin whose team WON THE CHAMPIONSHIP
 * keeps the rest of its pool and burns it on itself (the ordinary wind-down, then the self-burn sweep); a team that did not win forwards
 * the rest to $DEFICIT like any resolved end. The program has two end outcomes and only "void" leaves the pool on the coin, so the champion's
 * end is recorded on chain with that outcome; every word the keeper writes (the end reason the coin page shows, the log, the memo, the
 * status record and the attested source URL) says "won the championship" instead. multiKeeper.recordWindowEnd writes the reason, and
 * only once the source and the coin's own receipt agree (championVerdict).
 */
export const CHAMPION_END_LINE = "won the championship: the rest burns on this coin";
export const championEndReason = (date: string): string => `${CHAMPION_END_LINE} (the last game was ${date})`;
export const NOT_CHAMPION_END_LINE = "did not win the championship: the rest goes to $DEFICIT's burn";
/**
 * Audit 12 (end-sink picker report): the not-champion line names the sink the coin pinned at launch, never "$DEFICIT" for a coin that named
 * another coin or the incinerator. NOT_CHAMPION_END_LINE stays the $DEFICIT wording (and the prefix every form starts with).
 */
export const NOT_CHAMPION_PREFIX = "did not win the championship";
export function notChampionEndLine(rule?: { onEnd?: { endSink?: unknown; mint?: string; ticker?: string } | null } | null): string {
  const e = rule?.onEnd;
  if (e?.endSink === "incinerator") return `${NOT_CHAMPION_PREFIX}: the rest is sent to Solana's incinerator`;
  if (e?.endSink === true && e.mint && e.ticker) return `${NOT_CHAMPION_PREFIX}: the rest goes to $${e.ticker}'s burn, or to $DEFICIT's burn if $${e.ticker} is not live then`;
  return NOT_CHAMPION_END_LINE;
}
export const notChampionEndReason = (why: string, rule?: Parameters<typeof notChampionEndLine>[0]): string => `${notChampionEndLine(rule)} (${why})`;
export const isChampionEnd = (reason: string): boolean => reason.startsWith(CHAMPION_END_LINE);
/** The words the keeper writes for an end outcome: the champion line for a champion's end, else the outcome itself. */
const endLabel = (outcome: EndOutcome, reason: string): string => (isChampionEnd(reason) ? CHAMPION_END_LINE : outcome);
/** The outcome word in the attested source URL ("champion" for a champion's end). */
const endCode = (outcome: EndOutcome, reason: string): EndOutcome | "champion" => (isChampionEnd(reason) ? "champion" : outcome);

/**
 * The champion verdict for a champion-path coin whose season window ended: the end reason to record, or why the keeper holds (nothing is
 * recorded, nothing moves). Fail safe: the source must say champion or not (espn.ts championOf; null = it cannot tell), and the coin's own
 * receipt for the last game's day must agree: a champion's last game is a win, so it has a burn receipt that day; an eliminated team's last
 * postseason game is a loss, so it has none.
 */
export function championVerdict(reg: Pick<Registry, "receipts">, t: Pick<TokenRow, "mint">, w: { reason: string; champion?: boolean | null; championDate?: string | null }, rule?: Parameters<typeof notChampionEndLine>[0]): { reason: string } | { hold: string } {
  if (w.champion !== true && w.champion !== false) return { hold: "the source cannot tell yet whether the team won the championship" };
  const won = w.championDate ? reg.receipts(t.mint).some((b) => b.eventId === w.championDate && b.units > 0 && b.status !== "void" && b.status !== "voided") : false;
  if (w.champion) return won ? { reason: championEndReason(w.championDate!) } : { hold: `the schedule says the team won its last game${w.championDate ? ` (${w.championDate})` : ""}, but the coin has no burn recorded for it yet` };
  if (won) return { hold: `the schedule says the team lost its last game (${w.championDate}), but the coin recorded a win that day` };
  return { reason: notChampionEndReason(w.reason, rule) };
}

/** Resolved or void, from the same facts detectRuleEnd used. A champion's end is "void" on chain: the program's wind-down on the coin. */
export function endOutcomeOf(reg: Pick<Registry, "receipts">, t: Pick<TokenRow, "mint">, locked: LockedRule, gate: PairGate | null, end: { reason: string }): EndOutcome {
  if (gate?.state === "voided") return "void";
  if (isChampionEnd(end.reason)) return "void";
  if (isOneShot(locked.rule)) {
    const ev = reg.receipts(t.mint).filter((b) => !["winddown", "drain", "sweep"].includes(b.kind) && b.status !== "pending-pair")[0];
    if (ev && ev.status === "voided") return "void";
  }
  return /\bvoid(ed)?\b|cancel+ed|no award/i.test(end.reason) ? "void" : "resolved";
}

/** The source the end attestation commits to: the coin, the date, the outcome and why (anyone can read the reason back). */
export const ruleEndSourceUrl = (ticker: string, date: string, outcome: EndOutcome | "champion", reason: string): string =>
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

/**
 * I-14 (audit 2026-10-19): the stored prepare expectation against the EndSink the chain holds, before anything at the end moves. Null
 * when it matches or there is no stored expectation (a coin from before expectations were recorded); else a hold.
 */
export function endSinkHold(d: Pick<EndSinkStepDeps, "registry" | "log" | "now">, t: Pick<TokenRow, "mint" | "ticker">, sink: EndSinkView | null, flagship: string | null | undefined): EndSinkStepResult | null {
  const exp = loadExpectedConfig(d.registry, t.mint);
  if (!exp) return null;
  const pair = d.registry.pairOf(t.mint);
  const facts = sink ? { kind: endSinkKindOf(sink.kind) ?? -1, sinkMint: sink.sinkMint, minForwardLamports: sink.minForwardLamports } : null;
  const off = endSinkMismatch(facts, exp, { mint: t.mint, flagship: flagship ?? null, pairPartner: pair ? (pair.mintA === t.mint ? pair.mintB : pair.mintA) : null });
  if (!off) return null;
  const text = `$${t.ticker}: the coin's end sink on chain differs from the one this site built for it (${off}). Nothing is forwarded or wound down at its end.`;
  d.log(`  [end] $${t.ticker}: HELD — ${off}`);
  try { if (d.registry.recordAlert({ kind: "config-mismatch", key: `end-sink-mismatch:${t.mint}`, text, meta: { mint: t.mint, account: "end_sink" } }, d.now())) d.log(`  [alert] config-mismatch: ${text}`); } catch { /* the alert never changes the hold */ }
  return { handled: true, selfBurn: false, note: text };
}

export async function endSinkStep(d: EndSinkStepDeps, t: TokenRow, locked: LockedRule, gate: PairGate | null, end: { mode: "drain" | "winddown"; reason: string; at: number }): Promise<EndSinkStepResult> {
  const client = d.program.endSink;
  if (!client || !endSinkOf(locked.rule)) return NOT_MINE;
  const reg = d.registry, port = client.port(t.mint);
  const sink = await port.endSink();
  // I-14: the EndSink on chain must be the one this site built at prepare (an edited create could name the creator's own coin);
  // a difference holds the coin's end: nothing is recorded, forwarded or wound down, and the owner is alerted
  const held = endSinkHold(d, t, sink, client.flagship);
  if (held) return held;
  if (!sink) return NOT_MINE;   // launched without an EndSink (a coin from before §45): its hashed wind-down applies
  const outcome = endOutcomeOf(reg, t, locked, gate, end);
  const label = endLabel(outcome, end.reason);
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
    if (reg.pending(t.mint).length > 0) return mine(outcome, `$${t.ticker}: the rule ended (${label}); its last results are still being burned`);
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
    if (d.dryRun) { d.log(`  [dry-run] $${t.ticker}: would record the rule's end (${label}, ${recordDate})`); return mine(outcome, null); }
    const dateIso = `${String(recordDate).slice(0, 4)}-${String(recordDate).slice(4, 6)}-${String(recordDate).slice(6)}`;
    // a champion's end: the program's outcome argument is the wind-down one; the source URL, memo, log and status name the championship
    const code = endCode(outcome, end.reason);
    const tx = await port.buildRuleEnd({ recordDate, outcome, sourceUrl: ruleEndSourceUrl(t.ticker, dateIso, code, end.reason), proofHash: crypto.createHash("sha256").update(`${t.rulesSha}|${end.reason}`).digest() });
    const r = await sendOnce(d, port, t, `rule-end:${code}`, tx, JSON.stringify({ message: tx.message, outcome: label, reason: end.reason }));
    d.log(`  [end] $${t.ticker}: rule end (${label}, ${dateIso}) ${r === "confirmed" ? `recorded on chain — ${tx.signature}` : r}`);
    if (r !== "confirmed") return mine(outcome, `$${t.ticker}: recording the rule's end: ${r}`);
    reg.setStatus(`rule.endsink.${t.mint}`, { outcome: code, line: label, recordDate, sinkKind: sink.kind, sinkMint: sink.sinkMint, signature: tx.signature }, d.now());
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
  // round 5: the incinerator end sink sends the SOL itself to Solana's incinerator (burn_sol_on_end); no coin receives it
  const burned = plan.target === INCINERATOR_ADDRESS;
  const to = burned ? "incinerator" : reg.token(plan.target)?.ticker ?? (plan.target === client.flagship ? "DEFICIT" : plan.target.slice(0, 8));
  const line = burned ? endBurnLine(t.ticker, facts?.lamports ?? BigInt(0)) : endForwardLine(t.ticker, to, facts?.lamports ?? BigInt(0));
  reg.setStatus(lastKey, today, d.now());
  reg.setStatus(`rule.endfwd.${t.mint}`, { signature: tx.signature, to: plan.target, intended: plan.intended, lamports: (facts?.lamports ?? BigInt(0)).toString(), memo: facts?.memo ?? null, at: d.now(), line }, d.now());
  d.log(`  [end] $${t.ticker}: ${line} — ${tx.signature}`);
  retire("its leftover went to the end sink");
  return mine("resolved", line);
}
