import { isBudgetHold } from "@/lib/burnticker/apiBudget";
import { backoffMs } from "@/lib/burnKeeper/schedule";
import type { Registry, TokenRow } from "@/lib/burnticker/registry";
import { lockFeeClaimLine, lockFeeErrorSentence, splitMatches, TREASURY_NOT_PINNED, type LockFeesClient, type LockFeesPort } from "@/lib/burnticker/lockFees";
import type { SignedTx } from "@/lib/burnKeeper/programPort";

/**
 * THE KEEPER'S claim_lock_fees CRANK (owner decision 2026-10-10: LP locked forever, its fees fund the burn). Once per cycle, per
 * registered coin, AHEAD of the buyback cranks (so a crank that runs next spends the freshly claimed 80 %):
 *
 *   1. resolve a claim sent earlier whose confirmation was lost (the signature is written to the registry BEFORE the send);
 *   ROUND 2 (2026-10-11): for policy 0 the order is register_fee_key → register_pool (with the FeeKeyRecord) → claims; refusals carry the
 *   program error in plain words (lockFees.ts LOCK_FEE_ERRORS) into the alert and the coin's lp.lastError.
 *   2. read the lock: not graduated → skip; Fee Key not at the program's fee-keys PDA → ALARM (`lock-fee-key-owner`), no claim;
 *      no FeeKeyRecord yet → register_fee_key first (permissionless, once per mint; the pair-curve order is graduate → lock_lp →
 *      register_pair_pool → register_fee_key → claim); the operator treasury not pinned in this cluster's build (mainnet until the
 *      owner compiles the vault in) → no claim, `lock-fees-treasury` alert (the program would refuse TreasuryNotPinned; the fees stay
 *      in the lock); nothing accrued → skip (no transaction for an empty claim);
 *   3. simulate, record the signature, send, confirm; on confirmation read what the PROGRAM moved (never computed here) and write
 *      one `lock_fee_claims` row — the receipt line "LP fees claimed: X SOL → 80% burn pool / 20% operator; coin side burned" on
 *      the token page, status.json and the daily post. A split that is not exactly the compiled 80/20 raises `lock-fees-split`.
 *   4. a refusal or an on-chain failure raises `lock-fees-failed` (one per coin per Denver day, like the other crank alerts) and
 *      backs off (15 s doubling to 1 h); the buyback cranks go on regardless — the claim is best-effort, never a gate.
 *
 * The instruction is permissionless; the keeper's key only pays the fee. Dry run reads and logs, signs nothing.
 */

export interface LockFeesKeeperDeps {
  registry: Registry;
  lockFees: LockFeesClient | undefined;
  log: (line: string) => void;
  now: () => number;
  dryRun: boolean;
}

export type LockFeesOutcome =
  | { mint: string; outcome: "claimed"; signature: string; line: string }
  | { mint: string; outcome: "skipped" | "waiting" | "dry-run" | "unbound"; why: string }
  | { mint: string; outcome: "error"; why: string };

/** Registry key for this coin's claim signatures (the append-only signatures table) and its backoff state. */
export const LOCK_FEES_EVENT = "lock-fees";
export const REGISTER_EVENT = "register-fee-key";
export const REGISTER_POOL_EVENT = "register-pool";
const backoffKey = (mint: string) => `lock-fees.backoff.${mint}`;

function alert(d: LockFeesKeeperDeps, t: TokenRow, kind: string, text: string, meta: Record<string, unknown>): void {
  if (d.registry.recordAlert({ kind, key: `${kind}:${t.mint}`, text: `$${t.ticker}: ${text}`, meta: { mint: t.mint, ...meta } }, d.now())) d.log(`  [alert] ${kind} $${t.ticker}: ${text}`);
}

async function record(d: LockFeesKeeperDeps, t: TokenRow, port: LockFeesPort, signature: string, slot: number | null): Promise<LockFeesOutcome> {
  const facts = await port.claimFacts(signature);
  if (!facts) return { mint: t.mint, outcome: "waiting", why: `claim ${signature.slice(0, 12)}… confirmed; its amounts are not readable yet` };
  d.registry.setSignatureStatus(signature, "confirmed", null, slot);
  d.registry.setStatus(backoffKey(t.mint), "", d.now());
  // round 2: nothing claimed and nothing paid writes no memo and counts no claim — no receipt row either
  if (facts === "none") { d.log(`  [lp-fees] $${t.ticker}: claim ${signature.slice(0, 12)}… confirmed with nothing to claim (no memo, no receipt)`); return { mint: t.mint, outcome: "skipped", why: "confirmed with nothing claimed (no memo)" }; }
  d.registry.recordLockFeeClaim({ ...facts, signature, mint: t.mint, at: d.now(), slot });
  d.registry.setStatus(lastErrorKey(t.mint), "", d.now());
  const line = lockFeeClaimLine(facts);
  if (!splitMatches(facts)) alert(d, t, "lock-fees-split", `claim ${signature} moved ${facts.toBurnPoolLamports} / ${facts.toOperatorLamports} lamports of ${facts.solLamports} — not the compiled 80/20 split`, { signature });
  d.log(`  [lp-fees] $${t.ticker}: ${line} · ${signature}`);
  return { mint: t.mint, outcome: "claimed", signature, line };
}

/** The keeper's last lock-step refusal for a coin (status key; read by lpLockPage.ts into lp.lastError). */
export const lastErrorKey = (mint: string) => `lock-fees.last-error.${mint}`;
export function lastLockError(reg: Pick<Registry, "getStatus">, mint: string): { at: number; error: string } | null {
  const raw = reg.getStatus(lastErrorKey(mint));
  if (!raw) return null;
  try { const j = JSON.parse(raw) as { at: number; error: string }; return j && typeof j.error === "string" ? j : null; } catch { return null; }
}

/**
 * One coin's lock steps, best-effort, in the round-2 order (2026-10-11): (policy 0) register_fee_key → register_pool (it takes the
 * FeeKeyRecord) → claim_lock_fees; (policy 2, pair coins) register_fee_key → claim (the pool is registered by register_pair_pool);
 * policy 1 (a fixed pool) has no platform lock and is skipped. Never throws.
 */
export async function claimLockFeesFor(d: LockFeesKeeperDeps, t: TokenRow): Promise<LockFeesOutcome> {
  const mint = t.mint;
  if (!d.lockFees) return { mint, outcome: "unbound", why: "no claim_lock_fees client on this keeper" };
  const reg = d.registry, now = d.now();
  try {
    const port = d.lockFees.port(mint);
    // 1. A claim sent earlier whose confirmation we never saw.
    for (const s of reg.signatures(mint, LOCK_FEES_EVENT).filter((x) => x.status === "sent")) {
      const c = await port.confirm(s);
      if (c.status === "confirmed") return await record(d, t, port, s.signature, c.slot);
      reg.setSignatureStatus(s.signature, c.status === "failed" ? "failed" : "expired", c.status === "failed" ? c.err : null, null);
    }
    const bo = reg.getStatus(backoffKey(mint));
    const back = bo ? (JSON.parse(bo) as { failures: number; nextAt: number }) : null;
    if (back && now < back.nextAt) return { mint, outcome: "waiting", why: `waiting after ${back.failures} ${back.failures === 1 ? "failure" : "failures"} before trying again` };
    // 2. Read the lock.
    const st = await port.state();
    if (st.policy === 1) return { mint, outcome: "skipped", why: "fixed-pool policy: no LaunchLab lock to claim from" };
    if (!st.graduated) return { mint, outcome: "skipped", why: "not graduated: no locked LP yet" };
    if (st.feeKeyOwner !== port.feeKeysPda) {
      alert(d, t, "lock-fee-key-owner", `the Fee Key ${st.feeKey ?? "(unknown)"} is held by ${st.feeKeyOwner ?? "(unknown)"}, not the program's fee-keys PDA ${port.feeKeysPda}`, { feeKey: st.feeKey, owner: st.feeKeyOwner });
      return { mint, outcome: "error", why: `Fee Key not at the fee-keys PDA (held by ${st.feeKeyOwner ?? "unknown"})` };
    }
    if (st.locker && st.expectedLocker && st.locker !== st.expectedLocker && !st.feeKeyRegistered) {
      alert(d, t, "lock-fee-locker", `${lockFeeErrorSentence("LockerMismatch")} (locker ${st.locker}, expected ${st.expectedLocker})`, { locker: st.locker, expected: st.expectedLocker });
      return { mint, outcome: "error", why: `LockerMismatch: the lock's locker is ${st.locker}, not ${st.expectedLocker}` };
    }
    const fail = (step: string, err: string, how: "simulation refused" | "failed on chain"): LockFeesOutcome => {
      const failures = (back?.failures ?? 0) + 1;
      const why = `${step} ${how}: ${lockFeeErrorSentence(err)}`;
      reg.setStatus(backoffKey(mint), { failures, nextAt: now + backoffMs(failures - 1) }, now);
      reg.setStatus(lastErrorKey(mint), { at: now, error: `${step}: ${err}` }, now);
      alert(d, t, "lock-fees-failed", why, { failures, step, error: err });
      d.log(`  [lp-fees] $${t.ticker}: ${why} — retrying later`);
      return { mint, outcome: "error", why };
    };
    /** One registration step: simulate, write ahead, send, confirm. Returns an outcome to stop with, or null to go on. */
    const step = async (name: "register_fee_key" | "register_pool", build: () => Promise<SignedTx>, event: string, already: RegExp): Promise<LockFeesOutcome | null> => {
      if (d.dryRun) { d.log(`  [dry-run] $${t.ticker}: would ${name}`); return { mint, outcome: "dry-run", why: name }; }
      const tx = await build();
      const sim = await port.simulate(tx.raw);
      if (sim.err && (already.test(sim.err) || /already in use/i.test(sim.logs.join(" ")))) return { mint, outcome: "waiting", why: `${name}: already done by another crank; carrying on next cycle` };
      if (sim.err) return fail(name, sim.err, "simulation refused");
      reg.recordSignature({ signature: tx.signature, mint, eventId: event, memo: name, burnRaw: BigInt(0), spendLamports: BigInt(0), blockhash: tx.blockhash, lastValidBlockHeight: tx.lastValidBlockHeight, sentAt: now });
      try { await port.send(tx.raw); } catch (e) { d.log(`  [lp-fees] $${t.ticker}: ${name} send raised ${(e as Error).message.slice(0, 120)}`); }
      const c = await port.confirm(tx);
      if (c.status === "failed") { reg.setSignatureStatus(tx.signature, "failed", c.err, null); return fail(name, c.err, "failed on chain"); }
      if (c.status === "expired") return { mint, outcome: "waiting", why: `${name} ${tx.signature.slice(0, 12)}… not confirmed yet` };
      reg.setSignatureStatus(tx.signature, "confirmed", null, c.slot);
      d.log(`  [lp-fees] $${t.ticker}: ${name} confirmed${name === "register_fee_key" ? ` (Fee Key ${st.feeKey ?? ""})` : ""} · ${tx.signature}`);
      return null;
    };
    // register_fee_key, once per mint — BEFORE register_pool for policy 0 (round 2).
    if (!st.feeKeyRegistered) { const r = await step("register_fee_key", () => port.buildRegisterFeeKey(), REGISTER_EVENT, /FeeKeyAlreadyRegistered/); if (r) return r; }
    // register_pool with the FeeKeyRecord (policy 0 only; pair coins register through register_pair_pool).
    if ((st.policy ?? 0) === 0 && st.poolRegistered === false) { const r = await step("register_pool", () => port.buildRegisterPool(), REGISTER_POOL_EVENT, /PoolAlreadyRegistered/); if (r) return r; }
    if (!d.lockFees.operatorTreasury()) {
      alert(d, t, "lock-fees-treasury", lockFeeErrorSentence(TREASURY_NOT_PINNED), {});
      return { mint, outcome: "waiting", why: "operator treasury not pinned (TreasuryNotPinned): the fees stay in the lock" };
    }
    if (st.accruedSolLamports === BigInt(0) && st.accruedTokenRaw === BigInt(0)) return { mint, outcome: "skipped", why: "nothing accrued" };
    if (d.dryRun) { d.log(`  [dry-run] $${t.ticker}: would claim_lock_fees (${st.accruedSolLamports} lamports + ${st.accruedTokenRaw} raw accrued)`); return { mint, outcome: "dry-run", why: "claim_lock_fees" }; }
    // 3. Simulate, write ahead, send, confirm.
    const tx = await port.buildClaim();
    const sim = await port.simulate(tx.raw);
    if (sim.err) return fail("claim_lock_fees", sim.err, "simulation refused");
    reg.recordSignature({ signature: tx.signature, mint, eventId: LOCK_FEES_EVENT, memo: "claim_lock_fees", burnRaw: BigInt(0), spendLamports: BigInt(0), blockhash: tx.blockhash, lastValidBlockHeight: tx.lastValidBlockHeight, sentAt: now });
    try { await port.send(tx.raw); } catch (e) { d.log(`  [lp-fees] $${t.ticker}: send raised ${(e as Error).message.slice(0, 120)} — the signature is on the ledger and will be resolved`); }
    const c = await port.confirm(tx);
    if (c.status === "failed") { reg.setSignatureStatus(tx.signature, "failed", c.err, null); return fail("claim_lock_fees", c.err, "failed on chain"); }
    if (c.status === "expired") return { mint, outcome: "waiting", why: `claim ${tx.signature.slice(0, 12)}… not confirmed yet` };
    return await record(d, t, port, tx.signature, c.slot);
  } catch (e) {
    // 2026-10-15 re-review N4: a spent RPC budget is a wait (no alert, no backoff); the step runs again when the budget allows
    if (isBudgetHold(e)) return { mint, outcome: "waiting", why: `the RPC budget is on hold: ${(e as Error).message.slice(0, 120)}` };
    const why = `lock steps: ${(e as Error).message.slice(0, 160)}`;
    alert(d, t, "lock-fees-failed", why, {});
    return { mint, outcome: "error", why };
  }
}
