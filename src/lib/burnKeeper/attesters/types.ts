/**
 * THIRD-PARTY ATTESTATION — the shared shape (2026-10-09). An attester is anything OTHER than the keeper that has observed the
 * feed's value and can show its work: a Switchboard On-Demand feed account (oracle-signed, on chain), a zkTLS proof of a page
 * (attestor-signed, off chain), a second operator's signed reading. The keeper's own read is never an attestation.
 *
 * `AttestedReading` is deliberately plain: a decimal string exactly as the attester reports it, where/when it was observed, what
 * program the attester ran (job hash / feed hash) and who signed. `compareAttested` is the ONE agreement rule every attester goes
 * through (tolerance in basis points on the keeper's figure, an age ceiling, an optional slot ceiling); its refusals carry both
 * numbers so the log — and the status page — show what disagreed, not just that something did. Pure except for the clock passed in.
 */

export interface AttestedReading {
  /** Who attested: "switchboard:<feedPubkey>", "zktls:reclaim:<source>", "fake". */
  attester: string;
  /** The value exactly as the attester reports it, decimal, no exponent ("40305316210829.72"). */
  value: string;
  /** `value` in cents when it is a dollar figure with at most two decimals; null otherwise (then it cannot agree with a debt reading). */
  cents: bigint | null;
  /** The Solana slot the attestation refers to (Switchboard result slot); null when the attester has no chain. */
  slot: number | null;
  /** When the attester produced the value, ms since the epoch (Switchboard: the feed's last update timestamp; zkTLS: the claim's timestampS). */
  observedAt: number;
  /** sha256 of the serialized oracle job the attester ran (hex, no 0x); null when it is not knowable from the attestation itself. */
  jobHash: string | null;
  /** The feed hash the attestation is bound to (Switchboard: queue + jobs; zkTLS: the claim identifier); hex, no 0x. */
  feedHash: string | null;
  /** The signers a verifier can check against the attester's public registry (oracle pubkeys; attestor addresses). */
  oracles: string[];
  /** Whatever else a verifier needs, as reported (account pubkeys, raw submissions, the proof itself). Never secrets. */
  evidence: Record<string, unknown>;
}

export interface Attester {
  readonly id: string;
  readAttested(): Promise<AttestedReading>;
}

/** A Reading-compatible view (feeds/treasury.ts DebtReading) of an attestation, for code that only knows readings. */
export function toDebtReading(a: AttestedReading, recordDate: string): { recordDate: string; amount: string; cents: bigint } | null {
  return a.cents === null ? null : { recordDate, amount: a.value, cents: a.cents };
}

const DECIMAL = /^-?(0|[1-9]\d*)(\.\d+)?$/;

/** "40305316210829.72" → 4030531621082972n; null when the string is not a non-negative decimal with at most two places. */
export function decimalToCents(s: string): bigint | null {
  const t = s.trim();
  if (!DECIMAL.test(t) || t.startsWith("-")) return null;
  const [w, f = ""] = t.split(".");
  if (f.length > 2) return null;
  return BigInt(w) * BigInt(100) + BigInt((f + "00").slice(0, 2));
}

/** A fixed-point integer (e.g. Switchboard's i128 scaled by 1e18) → canonical decimal string, trailing fractional zeros removed. */
export function scaledToDecimalString(scaled: bigint, decimals: number): string {
  const neg = scaled < BigInt(0);
  const abs = neg ? -scaled : scaled;
  const s = abs.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, s.length - decimals), frac = s.slice(s.length - decimals).replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

export interface AgreementOpts {
  /** |attested − keeper| ≤ keeper × toleranceBps / 10,000. 0 = the figures must be identical (the right default for a published number). */
  toleranceBps: number;
  /** The attestation must have been observed within this many ms of `now`. */
  maxAgeMs: number;
  /** Optional slot ceiling: `nowSlot − slot` must not exceed it (ignored when either slot is unknown). */
  maxStalenessSlots?: number | null;
  nowSlot?: number | null;
  now: number;
}

export type Agreement = { ok: true; note: string } | { ok: false; why: string };

/** The agreement rule. `keeperCents` is what the keeper recorded for the date; the refusal text carries both figures. */
export function compareAttested(keeperCents: bigint, a: AttestedReading, o: AgreementOpts): Agreement {
  const who = a.attester;
  if (!Number.isFinite(a.observedAt) || a.observedAt <= 0) return { ok: false, why: `${who}: no observation time on the attestation` };
  const age = o.now - a.observedAt;
  if (age > o.maxAgeMs) return { ok: false, why: `${who}: stale — observed ${Math.round(age / 60_000)} min ago, ceiling ${Math.round(o.maxAgeMs / 60_000)} min (attested ${a.value}, keeper ${centsToUsd(keeperCents)})` };
  if (o.maxStalenessSlots != null && o.nowSlot != null && a.slot != null && o.nowSlot - a.slot > o.maxStalenessSlots) {
    return { ok: false, why: `${who}: stale — slot ${a.slot} is ${o.nowSlot - a.slot} slots behind ${o.nowSlot}, ceiling ${o.maxStalenessSlots} (attested ${a.value}, keeper ${centsToUsd(keeperCents)})` };
  }
  if (a.cents === null) return { ok: false, why: `${who}: value ${JSON.stringify(a.value)} is not a dollar amount with at most two decimals (keeper ${centsToUsd(keeperCents)})` };
  const diff = a.cents > keeperCents ? a.cents - keeperCents : keeperCents - a.cents;
  const allowed = (keeperCents * BigInt(Math.max(0, Math.floor(o.toleranceBps)))) / BigInt(10_000);
  if (diff > allowed) return { ok: false, why: `${who}: DISAGREES — attested ${a.value}, keeper ${centsToUsd(keeperCents)}, difference ${centsToUsd(diff)} beyond ${o.toleranceBps} bps` };
  return { ok: true, note: `${who}: agrees — ${a.value}${a.slot != null ? ` @ slot ${a.slot}` : ""}${diff > BigInt(0) ? ` (within tolerance: off by ${centsToUsd(diff)})` : ""}` };
}

export function centsToUsd(c: bigint): string {
  const neg = c < BigInt(0); const a = neg ? -c : c;
  return `${neg ? "-" : ""}${a / BigInt(100)}.${(a % BigInt(100)).toString().padStart(2, "0")}`;
}

/** A fixed attester for tests and dry runs: returns the readings in order (the last one repeats). */
export function fakeAttester(readings: Partial<AttestedReading>[], id = "fake"): Attester & { calls: number } {
  let i = 0;
  const self = {
    id, calls: 0,
    async readAttested(): Promise<AttestedReading> {
      self.calls++;
      const r = readings[Math.min(i++, readings.length - 1)] ?? {};
      const value = r.value ?? "0";
      return { attester: r.attester ?? id, value, cents: r.cents ?? decimalToCents(value), slot: r.slot ?? null, observedAt: r.observedAt ?? Date.now(), jobHash: r.jobHash ?? null, feedHash: r.feedHash ?? null, oracles: r.oracles ?? [], evidence: r.evidence ?? {} };
    },
  };
  return self;
}
