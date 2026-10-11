import { backoffMs } from "@/lib/burnKeeper/schedule";
import type { Registry, TokenRow } from "@/lib/burnticker/registry";
import { lockFeeClaimLine, splitMatches, type LockFeesClient, type LockFeesPort } from "@/lib/burnticker/lockFees";

/**
 * THE KEEPER'S claim_lock_fees CRANK (owner decision 2026-10-10: LP locked forever, its fees fund the burn). Once per cycle, per
 * registered coin, AHEAD of the buyback cranks (so a crank that runs next spends the freshly claimed 80 %):
 *
 *   1. resolve a claim sent earlier whose confirmation was lost (the signature is written to the registry BEFORE the send);
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
const backoffKey = (mint: string) => `lock-fees.backoff.${mint}`;

function alert(d: LockFeesKeeperDeps, t: TokenRow, kind: string, text: string, meta: Record<string, unknown>): void {
  if (d.registry.recordAlert({ kind, key: `${kind}:${t.mint}`, text: `$${t.ticker}: ${text}`, meta: { mint: t.mint, ...meta } }, d.now())) d.log(`  [alert] ${kind} $${t.ticker}: ${text}`);
}

async function record(d: LockFeesKeeperDeps, t: TokenRow, port: LockFeesPort, signature: string, slot: number | null): Promise<LockFeesOutcome> {
  const facts = await port.claimFacts(signature);
  if (!facts) return { mint: t.mint, outcome: "waiting", why: `claim ${signature.slice(0, 12)}… confirmed; its amounts are not readable yet` };
  d.registry.recordLockFeeClaim({ ...facts, signature, mint: t.mint, at: d.now(), slot });
  d.registry.setSignatureStatus(signature, "confirmed", null, slot);
  d.registry.setStatus(backoffKey(t.mint), "", d.now());
  const line = lockFeeClaimLine(facts);
  if (!splitMatches(facts)) alert(d, t, "lock-fees-split", `claim ${signature} moved ${facts.toBurnPoolLamports} / ${facts.toOperatorLamports} lamports of ${facts.solLamports} — not the compiled 80/20 split`, { signature });
  d.log(`  [lp-fees] $${t.ticker}: ${line} · ${signature}`);
  return { mint: t.mint, outcome: "claimed", signature, line };
}

/** One coin's claim, best-effort. Never throws. */
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
    if (back && now < back.nextAt) return { mint, outcome: "waiting", why: `backing off after ${back.failures} failure(s)` };
    // 2. Read the lock.
    const st = await port.state();
    if (!st.graduated) return { mint, outcome: "skipped", why: "not graduated: no locked LP yet" };
    if (st.feeKeyOwner !== port.feeKeysPda) {
      alert(d, t, "lock-fee-key-owner", `the Fee Key ${st.feeKey ?? "(unknown)"} is held by ${st.feeKeyOwner ?? "(unknown)"}, not the program's fee-keys PDA ${port.feeKeysPda}`, { feeKey: st.feeKey, owner: st.feeKeyOwner });
      return { mint, outcome: "error", why: `Fee Key not at the fee-keys PDA (held by ${st.feeKeyOwner ?? "unknown"})` };
    }
    const fail = (why: string): LockFeesOutcome => {
      const failures = (back?.failures ?? 0) + 1;
      reg.setStatus(backoffKey(mint), { failures, nextAt: now + backoffMs(failures - 1) }, now);
      alert(d, t, "lock-fees-failed", why, { failures });
      d.log(`  [lp-fees] $${t.ticker}: ${why} — retrying later`);
      return { mint, outcome: "error", why };
    };
    // register_fee_key, once per mint (permissionless): claim_lock_fees needs the FeeKeyRecord.
    if (!st.feeKeyRegistered) {
      if (d.dryRun) { d.log(`  [dry-run] $${t.ticker}: would register_fee_key (Fee Key ${st.feeKey ?? "?"})`); return { mint, outcome: "dry-run", why: "register_fee_key" }; }
      const rtx = await port.buildRegisterFeeKey();
      const rsim = await port.simulate(rtx.raw);
      // Someone else registered it first (the pair-curve crank's fee_key step, or any cranker): carry on to the claim next cycle.
      if (rsim.err === "FeeKeyAlreadyRegistered" || /already in use/i.test(rsim.logs.join(" "))) return { mint, outcome: "waiting", why: "the Fee Key was registered by another crank; claiming next cycle" };
      if (rsim.err) return fail(`register_fee_key simulation refused: ${rsim.err}`);
      reg.recordSignature({ signature: rtx.signature, mint, eventId: REGISTER_EVENT, memo: "register_fee_key", burnRaw: BigInt(0), spendLamports: BigInt(0), blockhash: rtx.blockhash, lastValidBlockHeight: rtx.lastValidBlockHeight, sentAt: now });
      try { await port.send(rtx.raw); } catch (e) { d.log(`  [lp-fees] $${t.ticker}: register send raised ${(e as Error).message.slice(0, 120)}`); }
      const rc = await port.confirm(rtx);
      if (rc.status === "failed") { reg.setSignatureStatus(rtx.signature, "failed", rc.err, null); return fail(`register_fee_key failed on chain: ${rc.err}`); }
      if (rc.status === "expired") return { mint, outcome: "waiting", why: `register_fee_key ${rtx.signature.slice(0, 12)}… not confirmed yet` };
      reg.setSignatureStatus(rtx.signature, "confirmed", null, rc.slot);
      d.log(`  [lp-fees] $${t.ticker}: Fee Key ${st.feeKey ?? ""} registered with the program · ${rtx.signature}`);
    }
    if (!d.lockFees.operatorTreasury()) {
      alert(d, t, "lock-fees-treasury", `the operator treasury is not pinned in this cluster's program build: claim_lock_fees would refuse (TreasuryNotPinned); the LP fees stay in the lock until the owner compiles the vault in`, {});
      return { mint, outcome: "waiting", why: "operator treasury not pinned (TreasuryNotPinned): the fees stay in the lock" };
    }
    if (st.accruedSolLamports === BigInt(0) && st.accruedTokenRaw === BigInt(0)) return { mint, outcome: "skipped", why: "nothing accrued" };
    if (d.dryRun) { d.log(`  [dry-run] $${t.ticker}: would claim_lock_fees (${st.accruedSolLamports} lamports + ${st.accruedTokenRaw} raw accrued)`); return { mint, outcome: "dry-run", why: "claim_lock_fees" }; }
    // 3. Simulate, write ahead, send, confirm.
    const tx = await port.buildClaim();
    const sim = await port.simulate(tx.raw);
    if (sim.err) return fail(`claim_lock_fees simulation refused: ${sim.err}`);
    reg.recordSignature({ signature: tx.signature, mint, eventId: LOCK_FEES_EVENT, memo: "claim_lock_fees", burnRaw: BigInt(0), spendLamports: BigInt(0), blockhash: tx.blockhash, lastValidBlockHeight: tx.lastValidBlockHeight, sentAt: now });
    try { await port.send(tx.raw); } catch (e) { d.log(`  [lp-fees] $${t.ticker}: send raised ${(e as Error).message.slice(0, 120)} — the signature is on the ledger and will be resolved`); }
    const c = await port.confirm(tx);
    if (c.status === "failed") { reg.setSignatureStatus(tx.signature, "failed", c.err, null); return fail(`claim_lock_fees failed on chain: ${c.err}`); }
    if (c.status === "expired") return { mint, outcome: "waiting", why: `claim ${tx.signature.slice(0, 12)}… not confirmed yet` };
    return await record(d, t, port, tx.signature, c.slot);
  } catch (e) {
    const why = `claim_lock_fees: ${(e as Error).message.slice(0, 160)}`;
    alert(d, t, "lock-fees-failed", why, {});
    return { mint, outcome: "error", why };
  }
}
