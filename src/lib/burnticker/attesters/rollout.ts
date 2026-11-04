import { ATTESTER_SENIORITY_SECS, ATTESTER_TIMELOCK_SECS } from "@/lib/burnReceipts/constants";
import { checkProposal, type AttesterSlot } from "@/lib/burnticker/attesters/byo";

/**
 * THE SECOND-SIGNER ROLLOUT (signer-2, 2026-10-12; docs/burnticker/SIGNER-TWO-ROLLOUT.md). For each coin: add the second signer's key
 * (kind 0, an operator) and raise the quorum 1 → 2, through propose_attesters (signed by the coin's config authority, the Squads vault),
 * a 48-hour public wait, and the permissionless apply. The program's rules (byo.ts checkProposal, mirrored from admin.rs) decide when:
 * a proposal that ADDS a key needs the kept key (the keeper's) to have been in the set 7 days. Pure: the caller reads the configs (a
 * read-only RPC) and builds the unsigned instructions; nothing here signs or sends.
 *
 * A PAIRED coin is not planned: its change applies only through apply_paired_attester_change with the partner's quorum, both coins must
 * keep one set, and the second signer cannot check pair coins yet. Pair coins stay at quorum 1 until it can.
 */

export interface RolloutCoin {
  ticker: string; mint: string;
  attesters: AttesterSlot[]; quorum: number; adminRenounced: boolean; admin: string; paired: boolean;
  pending: { attesters: { key: string; kind: number }[]; quorum: number; etaSec: number } | null;
}

export type RolloutStep =
  | { kind: "done"; why: string }
  | { kind: "refused"; why: string }
  | { kind: "wait-seniority"; proposeFrom: number; applyFrom: number; signerSeniorFrom: number; proposed: { key: string; kind: number }[]; quorum: number }
  | { kind: "propose-now"; applyFrom: number; signerSeniorFrom: number; proposed: { key: string; kind: number }[]; quorum: number }
  | { kind: "pending"; applyFrom: number; applicableNow: boolean; matches: boolean };

export interface RolloutPlan { ticker: string; mint: string; admin: string; step: RolloutStep }

const iso = (s: number) => new Date(s * 1000).toISOString().replace(".000Z", "Z");
export const rolloutIso = iso;

/** One coin's next step toward [keeper, second signer] at quorum 2. */
export function planCoin(c: RolloutCoin, signerKey: string, nowSec: number): RolloutPlan {
  const out = (step: RolloutStep): RolloutPlan => ({ ticker: c.ticker, mint: c.mint, admin: c.admin, step });
  if (c.attesters.some((a) => a.key === signerKey)) return out(c.quorum >= 2 ? { kind: "done", why: `the second signer is listed and the quorum is ${c.quorum}` } : { kind: "refused", why: "the second signer is listed but the quorum is still 1: raise it with a proposal that keeps both keys" });
  if (c.adminRenounced) return out({ kind: "refused", why: "the config authority has renounced: the attester set can never change" });
  if (c.paired) return out({ kind: "refused", why: "a paired coin changes its set only with the partner's quorum (apply_paired_attester_change), and the second signer cannot check pair coins yet: it stays at quorum 1 for now" });
  const proposed = [...c.attesters.map((a) => ({ key: a.key, kind: a.kind })), { key: signerKey, kind: 0 }];
  const quorum = Math.max(2, c.quorum);
  if (c.pending) {
    const matches = c.pending.quorum === quorum && c.pending.attesters.length === proposed.length && proposed.every((p, i) => c.pending!.attesters[i]?.key === p.key && c.pending!.attesters[i]?.kind === p.kind);
    return out({ kind: "pending", applyFrom: c.pending.etaSec, applicableNow: nowSec >= c.pending.etaSec, matches });
  }
  const problems = checkProposal(c.attesters, c.quorum, proposed, quorum, nowSec);
  const seniority = problems.filter((p) => /in the set ≥ 7 days/.test(p));
  const other = problems.filter((p) => !seniority.includes(p));
  if (other.length) return out({ kind: "refused", why: other.join("; ") });
  if (seniority.length) {
    const proposeFrom = c.attesters.map((a) => a.addedAt + ATTESTER_SENIORITY_SECS).sort((a, b) => a - b)[c.quorum - 1];
    return out({ kind: "wait-seniority", proposeFrom, applyFrom: proposeFrom + ATTESTER_TIMELOCK_SECS, signerSeniorFrom: proposeFrom + ATTESTER_TIMELOCK_SECS + ATTESTER_SENIORITY_SECS, proposed, quorum });
  }
  return out({ kind: "propose-now", applyFrom: nowSec + ATTESTER_TIMELOCK_SECS, signerSeniorFrom: nowSec + ATTESTER_TIMELOCK_SECS + ATTESTER_SENIORITY_SECS, proposed, quorum });
}

/** The plan as plain sentences, one per line (the script prints these; the rollout page quotes them). */
export function planLines(p: RolloutPlan): string[] {
  const s = p.step, who = `$${p.ticker}`;
  switch (s.kind) {
    case "done": return [`${who}: nothing to do (${s.why}).`];
    case "refused": return [`${who}: not planned. ${s.why[0].toUpperCase()}${s.why.slice(1)}.`];
    case "pending": return [`${who}: a proposal is pending. ${s.matches ? "It is the planned one." : "It is NOT the planned one: the vault should cancel it."} Anyone may apply it from ${iso(s.applyFrom)}${s.applicableNow ? ", which is now" : ""}.`];
    case "wait-seniority": return [
      `${who}: the keeper's key becomes senior at ${iso(s.proposeFrom)}. The proposal cannot be made before then.`,
      `${who}: propose from ${iso(s.proposeFrom)}, apply from ${iso(s.applyFrom)}. After the apply every reading needs both signatures, and the quorum never comes down.`,
      `${who}: the second signer's key becomes senior at ${iso(s.signerSeniorFrom)}.`,
    ];
    case "propose-now": return [
      `${who}: the proposal can be made now. Apply from ${iso(s.applyFrom)}. After the apply every reading needs both signatures, and the quorum never comes down.`,
      `${who}: the second signer's key becomes senior at ${iso(s.signerSeniorFrom)}.`,
    ];
  }
}
