import type { Ledger, BurnRow } from "@/lib/burnKeeper/ledger";
import { compareAttested, centsToUsd, type Agreement, type AttestedReading, type Attester } from "@/lib/burnKeeper/attesters/types";

/**
 * QUORUM 2, OFF CHAIN (2026-10-09): the keeper's own reading is signer one; an independent attester is signer two; a burn for a date
 * happens only when both agree on that date's figure. This is the off-chain stand-in for the Receipts program's quorum until it
 * lands (LAUNCHPAD-PATH §2, §17.4) — the keeper enforces it against itself; a stranger can check the same two sources.
 *
 * WHAT "AGREE ON THAT DATE" MEANS when the attester only reports the LATEST value (a Switchboard feed is a single current number):
 *   · the live attestation agrees (compareAttested) with the keeper's recorded figure for the date → confirmed, and the agreement is
 *     written to the ledger's status table (`attested|<token>|<feed>|<date>`) so it survives restarts;
 *   · the live attestation agrees with ANOTHER recorded reading (Treasury has posted a newer day) → that newer date is recorded as
 *     attested; the date being executed passes only if it was recorded earlier — the keeper polls the attester every cycle, and a
 *     Treasury figure stays "latest" for a business day, so an ordinary day is attested long before its burn;
 *   · the live attestation agrees with NO recorded reading → a disagreement: both figures are logged and the burn is held. A date the
 *     attester never saw (a long outage, then two new Treasury rows at once) is held too — late, never unattested.
 * Nothing here signs or sends; the cycle calls `check` before it signs anything new for a date.
 */

export interface AttesterGate {
  /** The attester's id, for logs and the status page. */
  readonly id: string;
  check(b: BurnRow): Promise<Agreement>;
}

export interface GateOpts {
  attester: Attester;
  ledger: Ledger;
  token: string;
  feed: string;
  toleranceBps: number;
  maxAgeMs: number;
  maxStalenessSlots?: number | null;
  /** The chain's current slot, when the attester is on chain (for the slot ceiling). */
  currentSlot?: (() => Promise<number | null>) | null;
  log: (s: string) => void;
  now: () => number;
}

export const attestedKey = (token: string, feed: string, recordDate: string): string => `attested|${token}|${feed}|${recordDate}`;

export interface AttestedRecord { attester: string; value: string; slot: number | null; observedAt: number; at: number; oracles: string[]; feedHash: string | null }

export function attesterGate(o: GateOpts): AttesterGate {
  const T = o.token, F = o.feed;
  const recorded = (date: string): AttestedRecord | null => {
    const s = o.ledger.getStatus(attestedKey(T, F, date));
    if (!s) return null;
    try { return JSON.parse(s) as AttestedRecord; } catch { return null; }
  };
  const record = (date: string, a: AttestedReading, now: number): void => {
    if (recorded(date)) return;
    o.ledger.setStatus(attestedKey(T, F, date), { attester: a.attester, value: a.value, slot: a.slot, observedAt: a.observedAt, at: now, oracles: a.oracles, feedHash: a.feedHash } satisfies AttestedRecord, now);
    o.log(`  [attest] ${date}: ${a.attester} attests ${a.value}${a.slot != null ? ` @ slot ${a.slot}` : ""} — recorded`);
  };
  return {
    id: o.attester.id,
    async check(b) {
      const now = o.now();
      let a: AttestedReading;
      try { a = await o.attester.readAttested(); } catch (e) { return { ok: false, why: `${o.attester.id}: unreachable — ${(e as Error).message.slice(0, 160)} (keeper ${centsToUsd(b.nowCents)} for ${b.recordDate})` }; }
      const nowSlot = o.currentSlot ? await o.currentSlot().catch(() => null) : null;
      const opts = { toleranceBps: o.toleranceBps, maxAgeMs: o.maxAgeMs, maxStalenessSlots: o.maxStalenessSlots ?? null, nowSlot, now };
      // 1. Does the live attestation agree with the date being executed?
      const live = compareAttested(b.nowCents, a, opts);
      if (live.ok) { record(b.recordDate, a, now); return live; }
      // 2. Does it agree with any other recorded reading (a newer Treasury day)? Record that, so it is attested when its turn comes.
      let matchedOther: string | null = null;
      for (const r of o.ledger.readings(T, F)) {
        if (r.recordDate === b.recordDate) continue;
        if (compareAttested(r.cents, a, opts).ok) { record(r.recordDate, a, now); matchedOther = r.recordDate; }
      }
      // 3. Was this date attested earlier?
      const earlier = recorded(b.recordDate);
      if (earlier) return { ok: true, note: `${earlier.attester}: attested ${b.recordDate} earlier (${earlier.value}${earlier.slot != null ? ` @ slot ${earlier.slot}` : ""}, recorded ${new Date(earlier.at).toISOString()})` };
      if (matchedOther) return { ok: false, why: `${a.attester}: its current value ${a.value} is ${matchedOther}'s figure; ${b.recordDate} (keeper ${centsToUsd(b.nowCents)}) was never attested — holding` };
      return live;   // stale, or a value that matches no reading of ours: the refusal names both figures
    },
  };
}
