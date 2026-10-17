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

const WORD = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
const word = (n: number): string => WORD[n] ?? String(n);
/**
 * GOVERNANCE AT DECISION TIME (ChatGPT chat audit 6, A9, 2026-10-12): three sentences shown beside the launch review, from the same
 * status record the Trust page reads (config/burnticker/current-status.json attesters and squads, operator.json's threshold, and the
 * time lock last read from chain), so the words change when governance does. Whole sentences; lint-clean.
 */
export function governanceLines(g: { quorum: number; signers: { independent: boolean }[]; operatorKeys: number | null; threshold: string; timeLockSecs: number | null }): string[] {
  const indep = g.signers.filter((x) => x.independent).length;
  const signer = g.signers.length === 1 && indep === 0
    ? "One signer, run by the operator, signs every reading."
    : `${word(g.signers.length).replace(/^./, (c) => c.toUpperCase())} signers sign readings, and ${word(g.quorum)} must agree. ${indep === 0 ? "None of them is" : `${word(indep).replace(/^./, (c) => c.toUpperCase())} of them ${indep === 1 ? "is" : "are"}`} independent of the operator.`;
  const t = /^(\d+) of (\d+)$/.exec(g.threshold.trim());
  const need = t ? Number(t[1]) : null, total = t ? Number(t[2]) : null;
  const keys = g.operatorKeys === null || need === null || total === null
    ? `A program upgrade needs ${g.threshold} keys. Who controls them is on the Trust page.`
    : g.operatorKeys >= need
      ? `The operator controls ${word(g.operatorKeys)} of the ${word(total)} upgrade keys, so it can approve a program upgrade alone.`
      : `The operator controls ${word(g.operatorKeys)} of the ${word(total)} upgrade keys, so an upgrade also needs another key holder.`;
  const wait = g.timeLockSecs === null
    ? "The waiting period for an approved upgrade could not be read just now. The Trust page reads it from the chain."
    : g.timeLockSecs === 0 ? "An approved upgrade has no waiting period today, so it can run at once." : `An approved upgrade waits ${fmtSecs(g.timeLockSecs)} before it can run.`;
  return [signer, keys, wait];
}
