import { formatDate } from "@/lib/burnReceipts/math";
import type { ExecOutcome, KeeperCtx } from "@/lib/burnKeeper/cycle";
import type { ProgramConfigView, ProgramPort, ProgramReadingView } from "@/lib/burnKeeper/programPort";
import { attesterHold, feedKey, resolveSent, tokenKey } from "@/lib/burnKeeper/cycle";
import { rowUrl } from "@/lib/burnKeeper/feeds/treasury";
import { rawToTokens, type LoadedRules } from "@/lib/burnKeeper/rules";
import { backoffMs } from "@/lib/burnKeeper/schedule";

/**
 * THE KEEPER ON THE PROGRAM PATH (2026-10-10; docs/burnkeeper/README-execution.md). With BURNKEEPER_EXECUTION=program the keeper no
 * longer swaps or burns anything itself: the burn_receipts program does both, inside one instruction, with money the keeper never
 * holds. The keeper's jobs shrink to:
 *
 *   1. ATTEST — for every Treasury reading in its ledger that the program does not have yet, in date order: build the canonical v2
 *      message (BURNRECEIPTS-v3|<cluster genesis>|<program>|<mint>|<feed>|prev=…|<date>|<value>|src=sha256(<exact row URL>)|proof=0…), sign it with
 *      the keeper's ed25519 key(s) (the attesters the TokenConfig lists; quorum from the config), and send submit_reading. The program
 *      counts the units itself.
 *   2. FEED THE POOL (buyback) — best-effort before cranking: claim_launchlab_creator_fee (curve fees → the fee PDA's WSOL ATA) when
 *      LaunchLab's creator-fee vault for the fee PDA exists, and Raydium's collect_creator_fee_permissionless once graduated
 *      (creatorFees.ts). Failures are logged, never fatal.
 *   3. CRANK — crank_buyback / crank_vault / crank_no_units for the next reading in line (planCrank picks), simulated first, its
 *      signature written to the ledger BEFORE the send, confirmed by polling; then the Reading account is read back and THAT is what
 *      the ledger row records (pool, rule spend, carried spend, spent, got, burned, owed, shortfall, outcome) together with the memo
 *      the program wrote. The keeper never invents a number.
 *   4. WAIT, DON'T FAIL — TwapUnavailable / TwapDeviation / PoolNotTradable / EmptyReserves and "no pool registered" leave the day
 *      pending with a wait reason (retried every 10 min); SpendCapBound and BurnPoolCapBound are PARTIAL days the program already
 *      handled (carried spend / capped basis), shown on the status page from the Reading's own fields.
 *   5. check_pool_health once per cycle (buyback, pool registered).
 *
 * Same discipline as the legacy cycle (cycle.ts): every transaction's signature is on the ledger before it is sent; a signature that
 * may still land is waited on, never re-signed; one that landed is adopted; and the CHAIN is the final word — a reading or a crank
 * someone else sent (both are permissionless) is adopted from the Reading account and the crank's own transaction.
 *
 * Everything that touches a chain goes through `ProgramPort` — a THIN ADAPTER over the program client. `solanaProgramPort`
 * (programAdapter.ts) is the web3.js implementation over src/lib/burnReceipts and the only file here that builds or signs program
 * transactions; the second blind review's client changes (SyncNative before a crank, the shared-message Ed25519 layout with a v0 +
 * lookup-table fallback, quorum ≤ 3, the genesis hash in the signed message, the pool on the reading, memos from the program's own
 * Memo CPI) live there. `FakeProgram` (fakeProgram.ts) is the
 * in-memory one the tests use. This file imports no transaction builder.
 */

// ---------------------------------------------------------------------------------------------------------------------------------
// The port
// ---------------------------------------------------------------------------------------------------------------------------------

export type { AttesterView, ConfirmOutcome, CrankKind, CrankPlan, ProgramConfigView, ProgramPort, ProgramReadingView, SignedTx } from "@/lib/burnKeeper/programPort";

/** Program refusals that mean "not now": the day waits (retried every WAIT_RETRY_MS), it is not an error and never counts as an attempt. */
export const WAIT_REASONS: Record<string, string> = {
  TwapUnavailable: "waiting for TWAP history — the pool's oracle needs 600–1,200 s of observations before the program will buy (late, never lost)",
  TwapDeviation: "waiting — the spot price sits more than the rule's deviation below the pool's TWAP (a pushed price); retried until it reverts",
  PoolNotTradable: "waiting — the registered pool is not tradable right now",
  EmptyReserves: "waiting — the registered pool has no reserves",
  "waiting-for-pool": "waiting for the CPMM pool — not graduated yet, or register_fee_key / register_pool has not run (the Fee Key is registered first since LP-lock round 2)",
};
export const WAIT_RETRY_MS = 10 * 60_000;

export const recordDateU32 = (d: string): number => Number(d.replace(/-/g, ""));

// ---------------------------------------------------------------------------------------------------------------------------------
// Execution mode
// ---------------------------------------------------------------------------------------------------------------------------------

export type ExecutionMode = "program" | "legacy";

/** BURNKEEPER_EXECUTION=program|legacy; default `program` when BURNTICKER_PROGRAM_ID is set, `legacy` otherwise. */
export function executionModeFromEnv(env: Readonly<Record<string, string | undefined>>): ExecutionMode {
  const v = env.BURNKEEPER_EXECUTION?.trim().toLowerCase();
  if (v === "program" || v === "legacy") return v;
  if (v) throw new Error(`BURNKEEPER_EXECUTION=${v} — expected "program" or "legacy"`);
  return env.BURNTICKER_PROGRAM_ID?.trim() ? "program" : "legacy";
}

/**
 * The legacy Jupiter buyback leg (cycle.ts executeBuybackOne + solanaChain.ts solanaBuyback) is DEPRECATED: it spends the keeper's
 * own SOL, and since review H-2 the creator fees go to the program's fee PDA, which only the program can spend. It must never run
 * for a token whose creator is the fee PDA or that has a TokenConfig — that would buy with money that is not the burn pool's.
 * Returns the refusal, or null when legacy is allowed (vault mode, or a dev token with no program config and another creator).
 */
export function legacyRefusal(i: { mode: "buyback" | "vault"; programId: string | null; feePda: string | null; launchCreator: string | null; launchCreatorOffCurve?: boolean; tokenConfigExists: boolean; claimCreatorFees?: boolean }): string | null {
  if (i.mode !== "buyback") return null;
  if (i.claimCreatorFees) return "BURNKEEPER_CLAIM_CREATOR_FEES=1 with BURNKEEPER_EXECUTION=legacy refused: the creator fees are claimed into the program's fee PDA, which only crank_buyback can spend — claiming them is the program path's job. Use BURNKEEPER_EXECUTION=program.";
  if (i.tokenConfigExists) return `BURNKEEPER_EXECUTION=legacy refused: this mint has a burn_receipts TokenConfig under ${i.programId} — its burns run through the program (crank_buyback); the legacy Jupiter leg would spend the keeper's own SOL beside it. Use BURNKEEPER_EXECUTION=program.`;
  if (i.feePda && i.launchCreator && i.launchCreator === i.feePda) return `BURNKEEPER_EXECUTION=legacy refused: the LaunchLab creator is the program's fee PDA ${i.feePda} — the creator fees belong to the program, and only crank_buyback can spend them. Use BURNKEEPER_EXECUTION=program.`;
  if (i.launchCreator && i.launchCreatorOffCurve) return `BURNKEEPER_EXECUTION=legacy refused: the LaunchLab creator ${i.launchCreator} is a program address (off the ed25519 curve), not a wallet — its fees are a program's to spend (set BURNTICKER_PROGRAM_ID and use BURNKEEPER_EXECUTION=program).`;
  return null;
}

/** Why the on-chain config cannot be driven by this rule file (wrong mint / wrong file / wrong feed), or null. */
export function configRefusal(cfg: ProgramConfigView, loaded: LoadedRules): string | null {
  const r = loaded.rules;
  if (cfg.mode !== r.mode) return `the program config is in ${cfg.mode} mode, the rule file says ${r.mode} — refusing`;
  if (cfg.rulesSha256 !== loaded.sha256) return `the program config's rules sha256 ${cfg.rulesSha256.slice(0, 12)}… ≠ the rule file's ${loaded.sha12}… — wrong mint or wrong rule file; refusing`;
  if (cfg.valueDecimals !== 2) return `the program config reads values with ${cfg.valueDecimals} decimals; the Treasury feed is cents (2) — refusing`;
  if (cfg.memoPrefix !== r.memo.prefix) return `the program writes memos with prefix ${cfg.memoPrefix}, the rule file says ${r.memo.prefix} — refusing`;
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// One program cycle
// ---------------------------------------------------------------------------------------------------------------------------------

export interface ReadingOutcome { recordDate: string; outcome: "submitted" | "adopted" | "waiting" | "quorum-short" | "held" | "dry-run" | "refused"; why?: string; signature?: string; units?: number }
export interface ProgramCycleReport { readings: ReadingOutcome[]; cranks: ExecOutcome[]; claims: string[]; health: string | null; config: ProgramConfigView | null }

/**
 * Attest → feed the pool → check pool health → adopt anything already processed → crank in order. Never throws for a chain refusal
 * of a single step (those are outcomes); throws only when the program config is missing or does not belong to this rule file.
 */
export async function executeProgramPending(ctx: KeeperCtx, port: ProgramPort, o: { maxCranks?: number } = {}): Promise<ProgramCycleReport> {
  const { ledger, loaded } = ctx;
  const T = tokenKey(loaded), F = feedKey(loaded);
  const rep: ProgramCycleReport = { readings: [], cranks: [], claims: [], health: null, config: null };
  let cfg = await port.config();
  if (!cfg) throw new Error(`no burn_receipts TokenConfig for mint ${port.mint} under program ${port.programId} — initialize_token must run first (docs/burnticker/runbook.md)`);
  const refusal = configRefusal(cfg, loaded);
  if (refusal) throw new Error(refusal);
  // A ledger that already holds legacy burns would hand the program dates the keeper's own wallet already paid for.
  if (ledger.burns(T, F).some((b) => b.status === "confirmed" && b.execution !== "program")) throw new Error(`this ledger (${ledger.file}) holds burns made by the legacy leg — program execution needs a fresh BURNKEEPER_DB (its baseline is the program's first reading)`);

  // 1. ATTEST: every ledger reading the program does not have yet, in order.
  cfg = await submitReadings(ctx, port, cfg, rep);

  // 2. FEED THE POOL + 3. POOL HEALTH (buyback only; best-effort).
  const pending = ledger.pendingBurns(T, F);
  if (!ctx.dryRun && cfg.mode === "buyback" && pending.length) {
    try {
      const c = await port.claimCreatorFees();
      for (const s of c.sent) { rep.claims.push(`sent ${s}`); ctx.log(`  [fees] creator fees moved into the fee PDA: ${s}`); }
      for (const n of c.notes) { rep.claims.push(n); ctx.log(`  [fees] ${n}`); }
    } catch (e) { rep.claims.push(`claim failed: ${(e as Error).message.slice(0, 160)}`); ctx.log(`  [fees] claim failed (best-effort, the crank goes on): ${(e as Error).message.slice(0, 160)}`); }
  }
  if (!ctx.dryRun && cfg.mode === "buyback" && cfg.poolRegistered) {
    try { const h = await port.checkPoolHealth(); rep.health = h.note; ctx.log(`  [pool] ${h.note}`); } catch (e) { rep.health = `check failed: ${(e as Error).message.slice(0, 160)}`; ctx.log(`  [pool] check_pool_health failed: ${(e as Error).message.slice(0, 160)}`); }
    cfg = (await port.config()) ?? cfg;
  }

  // 4. ADOPT: pending rows the chain already processed (someone else cranked — cranking is permissionless — or a lost confirmation).
  for (const b of ledger.pendingBurns(T, F)) {
    const D = recordDateU32(b.recordDate);
    const rd = await port.reading(D);
    if (!rd) {
      if (cfg.hasBaseline && D < cfg.lastRecordDate) {
        ledger.markSkipped(T, F, b.recordDate, `never reached the program: a later reading (${formatDate(cfg.lastRecordDate)}) was submitted first, and its delta absorbed this date`, ctx.now());
        ctx.log(`  [program] ${b.recordDate}: not on chain and can no longer be inserted (dates only move forward) — skipped; the next reading's delta absorbed it`);
        rep.cranks.push({ recordDate: b.recordDate, outcome: "skipped", why: "not on chain" });
      }
      continue;
    }
    if (!rd.processed) continue;
    const res = await resolveSent(ctx, port, b.recordDate, "crank");
    const known = "landed" in res ? { signature: res.landed.signature, slot: res.landed.slot, memo: await port.memoOf(res.landed.signature, D) } : null;
    const tx = known ?? (await port.findCrankTx(D));
    if (!tx) { rep.cranks.push({ recordDate: b.recordDate, outcome: "waiting", why: "processed on chain; its crank transaction is not found yet" }); continue; }
    rep.cranks.push(record(ctx, port, cfg, b.recordDate, rd, tx, true));
  }

  // 5. CRANK, strictly in order.
  const max = o.maxCranks ?? 30;
  for (let i = 0; i < max; i++) {
    const plan = await port.planCrank();
    if ("status" in plan) {
      if (plan.status === "waiting-for-pool") {
        const D = formatDate(plan.recordDate);
        const why = WAIT_REASONS["waiting-for-pool"];
        if (ledger.burn(T, F, D) && !ctx.dryRun) ledger.setWait(T, F, D, why, ctx.now() + WAIT_RETRY_MS, ctx.now());
        ctx.log(`  [program] ${D}: ${why}`);
        rep.cranks.push({ recordDate: D, outcome: "waiting", why });
      }
      break;
    }
    const D = formatDate(plan.recordDate);
    const row = ledger.burn(T, F, D);
    const now = ctx.now();
    const res = await resolveSent(ctx, port, D, "crank");
    if ("landed" in res) {
      const rd = await port.reading(plan.recordDate);
      if (!rd?.processed) { rep.cranks.push({ recordDate: D, outcome: "waiting", why: `crank ${res.landed.signature.slice(0, 12)}… landed; the reading is not processed yet` }); break; }
      rep.cranks.push(record(ctx, port, cfg, D, rd, { signature: res.landed.signature, slot: res.landed.slot, memo: await port.memoOf(res.landed.signature, plan.recordDate) }, true));
      continue;
    }
    if ("waiting" in res) { rep.cranks.push({ recordDate: D, outcome: "waiting", why: res.waiting }); break; }
    if (row && !ctx.dryRun && row.nextAttemptAt && now < row.nextAttemptAt) {
      rep.cranks.push({ recordDate: D, outcome: "waiting", why: row.waitReason ? `${row.waitReason} (next try ${new Date(row.nextAttemptAt).toISOString()})` : `backing off until ${new Date(row.nextAttemptAt).toISOString()}` });
      break;
    }
    if (ctx.dryRun) { ctx.log(`  [dry-run] ${D}: would crank_${plan.kind} (the program computes the amounts)`); rep.cranks.push({ recordDate: D, outcome: "dry-run", memo: "", burnRaw: BigInt(0), shortfallRaw: BigInt(0) }); break; }
    const fail = (why: string): ExecOutcome => {
      if (row) ledger.noteError(T, F, D, why, now + backoffMs(row.attempts), now);
      ctx.log(`  [program] ${D}: ${why} — retrying later`);
      return { recordDate: D, outcome: "error", why };
    };
    try {
      const tx = await plan.build();
      const sim = await port.simulate(tx.raw);
      if (sim.err) {
        const wait = WAIT_REASONS[sim.err] ?? (port.retryableErrors?.has(sim.err) ? "waiting — the program reported a retryable condition" : undefined);
        if (wait) {
          if (row) ledger.setWait(T, F, D, `${sim.err}: ${wait}`, now + WAIT_RETRY_MS, now);
          ctx.log(`  [program] ${D}: crank_${plan.kind} deferred by the program (${sim.err}) — ${wait}`);
          rep.cranks.push({ recordDate: D, outcome: "waiting", why: `${sim.err}: ${wait}` });
        } else rep.cranks.push(fail(`crank_${plan.kind} simulation refused: ${sim.err}${sim.logs.length ? ` · ${sim.logs.slice(-2).join(" · ")}` : ""}`));
        break;
      }
      ledger.recordProgramSignature({ kind: "crank", signature: tx.signature, token: T, feed: F, recordDate: D, memo: `crank_${plan.kind} ${D}`, blockhash: tx.blockhash, lastValidBlockHeight: tx.lastValidBlockHeight, sentAt: now });
      try { await port.send(tx.raw); } catch (e) { ctx.log(`  [program] ${D}: send raised ${(e as Error).message.slice(0, 120)} — the signature is on the ledger and will be resolved`); }
      const c = await port.confirm(tx);
      if (c.status === "failed") {
        ledger.setSignatureStatus(tx.signature, "failed", c.err, null);
        if (row) ledger.setBurnStatus(T, F, D, "planned");
        rep.cranks.push(fail(`crank_${plan.kind} failed on chain: ${c.err}`));
        break;
      }
      if (c.status === "expired") { rep.cranks.push({ recordDate: D, outcome: "waiting", why: `crank ${tx.signature.slice(0, 12)}… not confirmed yet` }); break; }
      const rd = await port.reading(plan.recordDate);
      if (!rd?.processed) { rep.cranks.push({ recordDate: D, outcome: "waiting", why: "crank confirmed; the reading is not processed yet" }); break; }
      rep.cranks.push(record(ctx, port, cfg, D, rd, { signature: tx.signature, slot: c.slot, memo: await port.memoOf(tx.signature, plan.recordDate) }, false));
    } catch (e) {
      rep.cranks.push(fail(`RPC/program error: ${(e as Error).message.slice(0, 200)}`));
      break;
    }
  }
  rep.config = (await port.config()) ?? cfg;
  return rep;
}

async function submitReadings(ctx: KeeperCtx, port: ProgramPort, cfg0: ProgramConfigView, rep: ProgramCycleReport): Promise<ProgramConfigView> {
  const { ledger, loaded } = ctx;
  const T = tokenKey(loaded), F = feedKey(loaded);
  let cfg = cfg0;
  for (const r of ledger.readings(T, F)) {
    const D = recordDateU32(r.recordDate);
    const now = ctx.now();
    const onChain = cfg.hasBaseline && D <= cfg.lastRecordDate;
    // An earlier submit for this date may have landed (or may still): resolve it first, so the ledger records what happened.
    const res = await resolveSent(ctx, port, r.recordDate, "reading");
    if ("waiting" in res) { if (onChain) continue; rep.readings.push({ recordDate: r.recordDate, outcome: "waiting", why: res.waiting }); return cfg; }
    if (onChain && !("landed" in res)) continue;
    if ("landed" in res) {
      const rd = await port.reading(D);
      ledger.setSignatureStatus(res.landed.signature, "confirmed", null, res.landed.slot);
      ledger.setProgramReading({ token: T, feed: F, recordDate: r.recordDate, value: r.cents.toString(), signature: res.landed.signature, slot: res.landed.slot, status: "confirmed", kind: rd?.kind ?? null, units: rd?.units ?? null, error: null }, now);
      ctx.log(`  [attest] ${r.recordDate}: an earlier submit_reading landed (${res.landed.signature.slice(0, 12)}…) — recorded`);
      rep.readings.push({ recordDate: r.recordDate, outcome: "adopted", signature: res.landed.signature, units: rd?.units });
      cfg = (await port.config()) ?? cfg;
      continue;
    }
    const mine = port.attesterKeys().filter((k) => cfg.attesters.some((a) => a.key === k));
    if (mine.length < cfg.quorum) {
      const why = `quorum short: the program needs ${cfg.quorum} attester signature(s); this keeper holds ${mine.length} of the listed keys (${cfg.attesters.map((a) => a.key.slice(0, 8)).join(", ")}) — the reading waits for the other attester(s)`;
      ledger.setProgramReading({ token: T, feed: F, recordDate: r.recordDate, value: r.cents.toString(), signature: null, slot: null, status: "quorum-short", kind: null, units: null, error: why }, now);
      ctx.log(`  [attest] ${r.recordDate}: ${why}`);
      rep.readings.push({ recordDate: r.recordDate, outcome: "quorum-short", why });
      return cfg;
    }
    const b = ledger.burn(T, F, r.recordDate);
    if (b && ctx.attester) {
      const hold = await attesterHold(ctx, b);
      if (hold) {
        ledger.setProgramReading({ token: T, feed: F, recordDate: r.recordDate, value: r.cents.toString(), signature: null, slot: null, status: "held", kind: null, units: null, error: `second attester: ${hold}` }, now);
        rep.readings.push({ recordDate: r.recordDate, outcome: "held", why: hold });
        return cfg;
      }
    }
    if (ctx.dryRun) { ctx.log(`  [dry-run] ${r.recordDate}: would attest $${r.amount} (prev ${cfg.hasBaseline ? formatDate(cfg.lastRecordDate) : "none"}) and submit_reading`); rep.readings.push({ recordDate: r.recordDate, outcome: "dry-run" }); return cfg; }
    const tx = await port.buildReading({ recordDate: D, prevDate: cfg.hasBaseline ? cfg.lastRecordDate : 0, value: r.cents, sourceUrl: rowUrl(r.recordDate), feedId: cfg.feedId, valueDecimals: cfg.valueDecimals });
    const sim = await port.simulate(tx.raw);
    if (sim.err) {
      const quorum = sim.err === "QuorumNotMet";
      const why = quorum ? "quorum short: the program did not count enough attester signatures (QuorumNotMet)" : `submit_reading refused: ${sim.err}`;
      ledger.setProgramReading({ token: T, feed: F, recordDate: r.recordDate, value: r.cents.toString(), signature: null, slot: null, status: quorum ? "quorum-short" : "refused", kind: null, units: null, error: why }, now);
      if (b && !quorum) ledger.noteError(T, F, r.recordDate, why, now + backoffMs(b.attempts), now);
      ctx.log(`  [attest] ${r.recordDate}: ${why}`);
      rep.readings.push({ recordDate: r.recordDate, outcome: quorum ? "quorum-short" : "refused", why });
      return cfg;
    }
    ledger.recordProgramSignature({ kind: "reading", signature: tx.signature, token: T, feed: F, recordDate: r.recordDate, memo: tx.message, blockhash: tx.blockhash, lastValidBlockHeight: tx.lastValidBlockHeight, sentAt: now });
    ledger.setProgramReading({ token: T, feed: F, recordDate: r.recordDate, value: r.cents.toString(), signature: tx.signature, slot: null, status: "sent", kind: null, units: null, error: null }, now);
    try { await port.send(tx.raw); } catch (e) { ctx.log(`  [attest] ${r.recordDate}: send raised ${(e as Error).message.slice(0, 120)} — the signature is on the ledger and will be resolved`); }
    const c = await port.confirm(tx);
    if (c.status === "failed") {
      ledger.setSignatureStatus(tx.signature, "failed", c.err, null);
      ledger.setProgramReading({ token: T, feed: F, recordDate: r.recordDate, value: r.cents.toString(), signature: tx.signature, slot: null, status: "refused", kind: null, units: null, error: c.err }, now);
      rep.readings.push({ recordDate: r.recordDate, outcome: "refused", why: c.err });
      return cfg;
    }
    if (c.status === "expired") { rep.readings.push({ recordDate: r.recordDate, outcome: "waiting", why: `submit_reading ${tx.signature.slice(0, 12)}… not confirmed yet` }); return cfg; }
    const rd = await port.reading(D);
    ledger.setSignatureStatus(tx.signature, "confirmed", null, c.slot);
    ledger.setProgramReading({ token: T, feed: F, recordDate: r.recordDate, value: r.cents.toString(), signature: tx.signature, slot: c.slot, status: "confirmed", kind: rd?.kind ?? null, units: rd?.units ?? null, error: null }, ctx.now());
    ctx.log(`  [attest] ${r.recordDate}: $${r.amount} attested and submitted (${rd ? `the program counted ${rd.units} unit(s)${rd.kind === 4 ? " — RESET: out-of-bound change, new baseline" : ""}` : "reading not readable yet"}) — ${tx.signature}`);
    rep.readings.push({ recordDate: r.recordDate, outcome: "submitted", signature: tx.signature, units: rd?.units });
    cfg = (await port.config()) ?? cfg;
  }
  return cfg;
}

/** Writes what the program did for a reading into the ledger (from the Reading account and the crank's own memo). */
function record(ctx: KeeperCtx, port: ProgramPort, cfg: ProgramConfigView, D: string, rd: ProgramReadingView, tx: { signature: string; slot: number | null; memo: string | null }, adopted: boolean): ExecOutcome {
  const { ledger, loaded } = ctx;
  const T = tokenKey(loaded), F = feedKey(loaded), dec = loaded.rules.decimals;
  const row = ledger.burn(T, F, D);
  const pr = ledger.programReading(T, F, D);
  if (pr) ledger.setProgramReading({ ...pr, kind: rd.kind, units: rd.units }, ctx.now());
  if (!row) {
    ledger.setSignatureStatus(tx.signature, "confirmed", null, tx.slot);
    ctx.log(`  [program] ${D}: reading processed on chain (${rd.outcome}, ${rd.units} unit(s)) — no burn was planned for this date${rd.units > 0 ? " BY THE KEEPER; the chain counted units, and the chain is the record" : ""} · ${tx.signature}`);
    return { recordDate: D, outcome: "skipped", why: `processed on chain: ${rd.outcome}` };
  }
  if (row.units !== rd.units) ctx.log(`  [program] ${D}: the program counted ${rd.units} unit(s), the keeper's plan said ${row.units} — the chain is the record`);
  const skippedReason = rd.outcome === "below-floor" ? `the program's spend was under its floor (${cfg.floorLamports} lamports) — nothing bought, the pool keeps the SOL${rd.burned > BigInt(0) ? `; ${rawToTokens(rd.burned, dec)} fee-PDA tokens burned` : ""}` : rd.outcome === "no-units" ? "the program counted no units" : null;
  ledger.markProgramProcessed(T, F, D, {
    signature: tx.signature, slot: tx.slot, outcome: rd.outcome, units: rd.units, memo: tx.memo, poolLamports: rd.poolLamports, poolActualLamports: rd.poolActualLamports,
    spentLamports: rd.spentLamports, ruleSpendLamports: rd.ruleSpendLamports, carriedInLamports: rd.carriedInLamports, carriedOutLamports: rd.carriedOutLamports,
    gotRaw: rd.got, burnRaw: rd.burned, owedRaw: rd.owed, shortfallRaw: rd.shortfall, swapPool: rd.spentLamports > BigInt(0) ? rd.pool ?? cfg.pool : null, skippedReason,
  }, ctx.now());
  const partial = [
    rd.spentLamports > BigInt(0) && rd.carriedOutLamports > BigInt(0) ? `SpendCapBound: spent ${rd.spentLamports} of a ${rd.ruleSpendLamports + rd.carriedInLamports} lamport target, ${rd.carriedOutLamports} carried into the next crank` : null,
    rd.poolActualLamports > rd.poolLamports ? `BurnPoolCapBound: the rule applied to ${rawToTokens(rd.poolLamports, 9)} of ${rawToTokens(rd.poolActualLamports, 9)} SOL` : null,
  ].filter(Boolean).join("; ");
  ctx.log(`  [program] ${D}: ${adopted ? "already processed on chain — adopted" : "CRANKED"} · ${rd.outcome} · ${loaded.rules.mode === "buyback" ? `spent ${rd.spentLamports} lamports, got ${rawToTokens(rd.got, dec)}, ` : ""}burned ${rawToTokens(rd.burned, dec)}${rd.shortfall > BigInt(0) ? `, short ${rawToTokens(rd.shortfall, dec)}` : ""}${partial ? ` · PARTIAL — ${partial}` : ""} · ${tx.signature}${tx.memo ? ` · ${tx.memo}` : ""}`);
  void port;
  if (rd.outcome === "exhausted") return { recordDate: D, outcome: "exhausted" };
  if (rd.outcome === "burned" || rd.outcome === "short") return { recordDate: D, outcome: "confirmed", signature: tx.signature, burnRaw: rd.burned, shortfallRaw: rd.shortfall, memo: tx.memo ?? "", adopted };
  return { recordDate: D, outcome: "skipped", why: skippedReason ?? rd.outcome };
}

