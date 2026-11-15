/** Client-safe: the trust page renders it. */
/**
 * HB-140 L3 (hourly run 12): the attester section said "has 0 attesters … only our own data key signs" once per coin, retired and voided
 * coins included, beside an ops record of one operator attester per coin. Now: one sentence for the level the site runs at, said once; the
 * coins that still take readings (live or paused) listed with their own count; retired coins named as taking no more readings.
 */
export const ATTESTER_LEVEL1_LINE = "Every coin here is at level 1: our own data key signs each reading, and no independent attester signs yet.";
export const ATTESTERS_RETIRED_LINE = "Retired coins take no more readings, so they are not listed.";
export function attesterSummary<R extends { status?: string; attesters: number; independent: number }>(rows: readonly R[]): { line: string | null; rows: R[]; retired: string | null } {
  const reading = rows.filter((r) => !r.status || r.status === "live" || r.status === "paused");
  return { line: reading.length && reading.every((r) => r.independent === 0) ? ATTESTER_LEVEL1_LINE : null, rows: reading, retired: reading.length < rows.length ? ATTESTERS_RETIRED_LINE : null };
}
