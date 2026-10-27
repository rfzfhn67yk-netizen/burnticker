/**
 * THE OPERATOR LIST IN PLAIN WORDS (prelaunch audit 2026-10-16, M11 / F-14). The coin page's "can" and "cannot" lists come from the
 * program's powers register (docs/burn-receipts/powers-register.json), written for reviewers: it carried "Round 5:", "Re-check R3-4",
 * "LAUNCHPAD-PATH §35", Raydium's field names, and "the current status above says more" on a page with no status above. This turns each
 * line into words a holder can read. The register itself, and the trust page's full table with its sources, are unchanged. Pure.
 *
 * Block G review L2 left the deeper rewrite for later. Still in reviewer terms on the coin page today: crank_buyback and the
 * "CPMM pool"; register_pool's creator + LP checks, the pool PDA, AmmConfig and cpConfigId in the stranding-recovery lines; `quorum`
 * in backticks; renounce_admin; pool_creator and the fee PDA; "the platform sunset"; and the two lowercase "cannot" lines trust.ts adds
 * (no full stop). The cap and cranker-allowlist rows say they were removed (owner decision 2026-10-25).
 */
const LAUNCHLAB_ADMIN_PLAIN = "Change the LaunchLab platform's settings for coins still on their curve: the fee rate, the fee wallets (including the one that receives each graduating coin's Fee Key), the pool settings, the liquidity-lock shares, vesting and curve rules.";

export function plainPower(s: string): string {
  let t = s.trim();
  if (/^updatePlatformConfig\b/.test(t)) return LAUNCHLAB_ADMIN_PLAIN;
  t = t
    .replace(/^Round \d+:\s*/i, "")
    .replace(/\bRe-check R\d+-\d+:\s*(\w?)/g, (_m, c: string) => c.toUpperCase())   // review L2: the sentence after it starts with a capital
    .replace(/\s*\((?:re-check R\d+-\d+|round \d+)\s*[;,—–-]?\s*([^)]*)\)/gi, (_m, rest: string) => (rest.trim() ? ` (${rest.replace(/^the cheap veto by\s*/i, "a veto by ").trim()})` : ""))
    .replace(/\(\s*LAUNCHPAD-PATH §\d+:?\s*[^)]*\)\s*/g, "")
    .replace(/LAUNCHPAD-PATH §\d+:?\s*/g, "")
    .replace(/\bcheap veto\b/g, "veto")
    .replace(/;?\s*the current status above says more\.?/i, "; the Trust page shows the live value.")
    .replace(/^STRANDING RECOVERY:\s*/, "If a coin's pool stops working: ")
    .replace(/^VETO:\s*/, "Veto: ")
    .replace(/\bRAISING\b/g, "raising").replace(/\bSAME\b/g, "same").replace(/\bAND\b/g, "and").replace(/\bOR\b/g, "or")
    // prelaunch audit 2026-10-18 A-6: the check page's register text had arrow chains and a LaunchLab field name
    .replace(/\s*→\s*/g, ", then ")
    .replace(/\bmigrateCpLockNftScale;\s*/g, "")
    .replace(/\s{2,}/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/**
 * What a compiled constant really means (prelaunch audit 2026-10-18 A-6: "no key can change it" on a program that can be upgraded): only
 * an upgrade of the program could change it, and an upgrade needs the Squads vault. Shared by the trust page's statements and its LP block. Client-safe.
 */
export const UPGRADE_CAVEAT = "Only an upgrade of the program could change it. An upgrade needs 2 of the 3 keys of the Squads vault, and for now there is no waiting period before an approved upgrade runs.";
