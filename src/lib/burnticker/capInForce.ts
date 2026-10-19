import { DEFAULT_BURN_POOL_CAP_LAMPORTS, DEFAULT_CAP_SUNSET_TS, CAP_TIMELOCK_SECS } from "@/lib/burnReceipts/constants";
import type { PlatformConfigAccount } from "@/lib/burnReceipts/accounts";

/**
 * THE BURN-POOL CAP IN FORCE (website-20 item 162, 2026-10-12: the site said the cap holds "until the program is audited" and that SOL above
 * it is "released after the audit"; no audit changes anything on chain). The program's own rule (programs/burn-receipts state.rs
 * PlatformConfig::active_cap and default_active_cap, instructions/crank_common.rs active_cap), mirrored here so a page can show the cap the
 * program applies, read from chain:
 *
 *   · a PlatformConfig exists      its burn_pool_cap_lamports, while now < its cap_sunset_ts; no cap after that
 *   · no PlatformConfig            the hard-coded default (25 SOL) while now < DEFAULT_CAP_SUNSET_TS (2027-10-01); no cap after that
 *
 * What changes it: initialize_platform (once, by the upgrade authority, at the default 25 SOL), then propose_cap_raise by the platform
 * authority (the Squads vault) and apply_cap_raise by anyone after the 48 h timelock. It can only rise, sunsets on schedule and is never
 * extended; renouncing the authority freezes it where it is until the sunset. SOL above the cap stays in the coin's fee account and is
 * spent once the cap rises or ends. Pure.
 */
export interface EffectiveCap {
  source: "platform-config" | "program-default";
  /** Lamports as a decimal string; null once the cap has sunset (no cap). */
  capLamports: string | null;
  sunsetTs: number;
  pending: { capLamports: string; etaTs: number } | null;
  authorityRenounced: boolean | null;
}

export function effectiveCap(platform: Pick<PlatformConfigAccount, "burn_pool_cap_lamports" | "cap_sunset_ts" | "pending_cap_lamports" | "pending_cap_eta" | "authority"> | null, nowTs: number): EffectiveCap {
  if (!platform) return { source: "program-default", capLamports: nowTs < DEFAULT_CAP_SUNSET_TS ? DEFAULT_BURN_POOL_CAP_LAMPORTS.toString() : null, sunsetTs: DEFAULT_CAP_SUNSET_TS, pending: null, authorityRenounced: null };
  const sunset = Number(platform.cap_sunset_ts);
  const eta = Number(platform.pending_cap_eta);
  return {
    source: "platform-config",
    capLamports: nowTs < sunset ? platform.burn_pool_cap_lamports.toString() : null,
    sunsetTs: sunset,
    pending: eta !== 0 ? { capLamports: platform.pending_cap_lamports.toString(), etaTs: eta } : null,
    authorityRenounced: platform.authority.toBase58() === "11111111111111111111111111111111",
  };
}

const sol = (lamports: string): string => { const n = BigInt(lamports); const whole = n / BigInt(1_000_000_000), frac = n % BigInt(1_000_000_000); return frac === BigInt(0) ? whole.toLocaleString("en-US") : `${whole.toLocaleString("en-US")}.${frac.toString().padStart(9, "0").replace(/0+$/, "")}`; };
const day = (ts: number): string => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", day: "numeric", year: "numeric" }).format(new Date(ts * 1000));

/**
 * How the cap changes, in plain words (the trust page, the fees page, the launch review, the token pages). Continuous audit 2026-10-19
 * ACC-01: it says outright that no audit is needed for a raise or for the end (the launch review still said "until the program is
 * audited"); every surface now takes its cap words from this file.
 */
export const CAP_MECHANISM_SENTENCE = `The platform authority can raise the cap after a public ${CAP_TIMELOCK_SECS / 3600}-hour wait, and it expires by ${day(DEFAULT_CAP_SUNSET_TS)} at the latest. An audit is not required for either change. SOL above the cap stays in the coin's own fee account and is spent once the cap rises or ends.`;

/** The cap in force, in one sentence, from what was read on chain (null when it was not read). */
export function capSentence(e: EffectiveCap | null): string {
  if (!e) return `The default burn-pool cap is ${sol(DEFAULT_BURN_POOL_CAP_LAMPORTS.toString())} SOL. ${CAP_MECHANISM_SENTENCE}`;
  if (e.capLamports === null) return `The burn-pool cap ended on ${day(e.sunsetTs)}, so each burn pool now spends from all of its SOL.`;
  const where = e.source === "platform-config" ? "read from the platform's settings on chain" : "the program's default, because the platform's settings have not been created";
  const pend = e.pending ? ` A raise to ${sol(e.pending.capLamports)} SOL is waiting and can be applied from ${day(e.pending.etaTs)}.` : "";
  return `Each burn pool spends from at most ${sol(e.capLamports)} SOL today (${where}). The cap ends on ${day(e.sunsetTs)}.${pend} ${CAP_MECHANISM_SENTENCE}`;
}

/** ACC-01: the same sentence on a page other than Trust (the launch review, the wallet summary, a token page): an unread cap points to Trust. */
export function capSentenceAway(e: EffectiveCap | null): string {
  return e ? capSentence(e) : `${capSentence(null)} The Trust page shows the cap in force.`;
}

/** ACC-01: SOL held above the cap, for a token page's burn-pool tile: the cap read (or the default when unread), and what releases it. */
export function capHeldSentence(queuedSol: string, e: EffectiveCap | null): string {
  if (e && e.capLamports === null) return `${queuedSol} SOL was held above the burn-pool cap, which has ended, so it can be spent now.`;
  const cap = e && e.capLamports !== null ? `the ${sol(e.capLamports)} SOL burn-pool cap` : `the default ${sol(DEFAULT_BURN_POOL_CAP_LAMPORTS.toString())} SOL burn-pool cap`;
  return `${queuedSol} SOL is held above ${cap} until the cap rises or ends. An audit is not required for either.`;
}
