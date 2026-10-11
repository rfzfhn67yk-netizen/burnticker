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
/** The one sentence every renderer uses for a program's upgrade authority (F1). */
export function upgradeAuthorityText(d: { upgradeAuthority: string | null; authoritySource: AuthoritySource; recordedAt?: string | null; recordedUpgradeAuthority?: string | null }): string {
  const rec = d.recordedUpgradeAuthority ? `; last recorded in verified-build.json${d.recordedAt ? ` (${d.recordedAt})` : ""}: ${d.recordedUpgradeAuthority}` : "";
  if (d.authoritySource === "unavailable") return `upgrade authority unavailable — chain read failed${rec}`;
  if (d.authoritySource === "chain") return d.upgradeAuthority ? `upgrade authority ${d.upgradeAuthority} (read from chain)` : "no upgrade authority (immutable; read from chain)";
  return d.upgradeAuthority ? `upgrade authority ${d.upgradeAuthority} (recorded in verified-build.json${d.recordedAt ? `, ${d.recordedAt}` : ""})` : "upgrade authority not recorded";
}
