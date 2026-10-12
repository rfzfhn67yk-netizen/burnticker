/**
 * Client-safe wording for the current-status object (no file reads, so "use client" renderers can import it). F1 (2026-10-11): a
 * program's upgrade authority says "none / immutable" ONLY after a ProgramData account was read and decoded with no authority; a
 * failed, partial or malformed read says "unavailable".
 */

/**
 * Where a program's upgrade authority came from: "chain" (decoded just now — null here, and only here, means none), "verified-build"
 * (the recorded value in config/burnticker/verified-build.json, used when no live read was made), "unavailable" (a live read was made
 * and failed, came back partial or did not decode).
 */
export type AuthoritySource = "chain" | "verified-build" | "unavailable";
/** The one sentence every renderer uses for a program's upgrade authority (F1). Whole sentences, so a renderer never splices it. */
export function upgradeAuthorityText(d: { upgradeAuthority: string | null; authoritySource: AuthoritySource; recordedAt?: string | null; recordedUpgradeAuthority?: string | null }): string {
  const rec = d.recordedUpgradeAuthority ? ` The last value recorded in verified-build.json${d.recordedAt ? ` (${d.recordedAt})` : ""} is ${d.recordedUpgradeAuthority}.` : "";
  if (d.authoritySource === "unavailable") return `The upgrade authority is unavailable because the chain read failed.${rec}`;
  if (d.authoritySource === "chain") return d.upgradeAuthority ? `The upgrade authority is ${d.upgradeAuthority}, read from chain.` : "There is no upgrade authority, so the program is immutable. This was read from chain.";
  return d.upgradeAuthority ? `The upgrade authority is ${d.upgradeAuthority}, as recorded in verified-build.json${d.recordedAt ? ` on ${d.recordedAt}` : ""}.` : "The upgrade authority is not recorded.";
}

/** A time lock in words: "0 (none)", "48 h", "60 s". */
export const fmtSecs = (s: number): string => (s === 0 ? "0 (none)" : s % 3600 === 0 ? `${s / 3600} h` : s % 60 === 0 ? `${s / 60} min` : `${s} s`);

/**
 * What the upgrade authority can do, in the words the CURRENT time lock allows (audit R04, 2026-10-11): the Powers Register's shorthand
 * said "a public, time-locked proposal" while the mainnet lock was 0. `timeLockSecs` is the value read from chain (null = not read).
 */
export function upgradeDelaySummary(timeLockSecs: number | null, threshold = "2 of 3"): string {
  if (timeLockSecs === null) return `deploy new program code once ${threshold} approve a Squads proposal. The current time lock could not be read from chain just now; the current status above says more.`;
  if (timeLockSecs === 0) return `deploy new program code once ${threshold} approve a Squads proposal. The time lock is 0 today, so an approved upgrade can execute at once, with no notice period.`;
  return `deploy new program code once ${threshold} approve a Squads proposal. A ${fmtSecs(timeLockSecs)} time lock then runs before it can execute.`;
}
