/**
 * "IS THIS MINT A BURNTICKER COIN?" (growth batch, owner-approved 2026-10-10). Paste any Solana mint on /burnticker/verify (or call
 * GET /api/burnticker/v1/verify-mint/<mint>) and get one plain answer from two independent places:
 *
 *   · the burn_receipts PROGRAM: is there a TokenConfig account for this mint (read from the chain through the platform's program
 *     client), and which rules sha256 does it hold;
 *   · Burnticker's REGISTRY: is the mint a coin launched under Burnticker's platform (ticker, creator, launch date, receipts), and does
 *     its rules.json hash to the same sha256 the program holds.
 *
 * The verdicts, in the words the page prints (plain, never an accusation — a mint that is not ours is simply not ours):
 *   burnticker      "Burnticker coin: yes"                    both agree (or the program is not read on this host: said so)
 *   program-only    registered with the program, not listed on Burnticker (another launchpad may use the open program)
 *   not-launched    reserved on Burnticker as a draft, or a draft that expired — not a launched coin
 *   not-registered  "NOT registered with the burn_receipts program"
 *   invalid         not a Solana address
 *
 * Pure: verifyMintServe.ts reads the registry and the program and hands the facts here.
 */

export const VERIFY_MINT_SCHEMA = "burnticker.verify-mint/v1";
export type MintVerdict = "burnticker" | "program-only" | "not-launched" | "not-registered" | "invalid";

export interface MintFacts {
  mint: string; cluster: string; programId: string;
  /** The program read: null when this host cannot read the program (no deployed program id / RPC: the fake client). */
  program: { config: string; rulesSha256: string; readings: number; burns: number } | null | "unread";
  coin: { ticker: string; name: string; status: string; creator: string; launchedAt: string | null; rulesSha256: string; receipts: number; burns: number; platformId: string | null } | null;
}
export interface MintCheck { id: "address" | "program" | "registry" | "rules"; ok: boolean | null; detail: string }
export interface MintVerification {
  schema: typeof VERIFY_MINT_SCHEMA; mint: string; cluster: string; programId: string; checkedAt: string;
  verdict: MintVerdict; headline: string; summary: string;
  program: { read: boolean; config: string | null; rulesSha256: string | null; readings: number | null; burns: number | null };
  coin: (NonNullable<MintFacts["coin"]> & { pageUrl: string; rulesMatch: boolean | null }) | null;
  checks: MintCheck[];
  links: { verifier: string; page: string | null; self: string };
}

export const isSolanaAddress = (s: string): boolean => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);

export function verifyMint(f: MintFacts, nowMs: number): MintVerification {
  const base = { schema: VERIFY_MINT_SCHEMA, mint: f.mint, cluster: f.cluster, programId: f.programId, checkedAt: new Date(nowMs).toISOString(), links: { verifier: "/burnticker/check", page: null as string | null, self: `/burnticker/verify?mint=${encodeURIComponent(f.mint)}` } } as const;
  if (!isSolanaAddress(f.mint)) {
    return { ...base, verdict: "invalid", headline: "Not a Solana address", summary: "A mint address is 32–44 base58 characters.", program: { read: false, config: null, rulesSha256: null, readings: null, burns: null }, coin: null, checks: [{ id: "address", ok: false, detail: "not a base58 address of 32–44 characters" }] };
  }
  const read = f.program !== "unread";
  const prog = f.program !== "unread" ? f.program : null;
  const launched = f.coin !== null && f.coin.status !== "draft" && f.coin.status !== "expired";
  const rulesMatch = f.coin && prog ? f.coin.rulesSha256 === prog.rulesSha256 : null;
  const checks: MintCheck[] = [
    { id: "address", ok: true, detail: "a Solana address" },
    { id: "program", ok: read ? prog !== null : null, detail: !read ? "the burn_receipts program is not read on this host (no deployed program id or RPC configured)" : prog ? `TokenConfig ${prog.config} exists under program ${f.programId}` : `no TokenConfig for this mint under program ${f.programId}` },
    { id: "registry", ok: f.coin ? launched : false, detail: f.coin ? `${launched ? "launched" : f.coin.status} on Burnticker as $${f.coin.ticker}` : "not in Burnticker's registry" },
    { id: "rules", ok: rulesMatch, detail: rulesMatch === null ? "nothing to compare" : rulesMatch ? `the registry's rules.json hashes to the sha256 the program holds (${prog!.rulesSha256.slice(0, 12)}…)` : `the registry's rules sha256 ${f.coin!.rulesSha256.slice(0, 12)}… differs from the program's ${prog!.rulesSha256.slice(0, 12)}…` },
  ];
  const coin = f.coin ? { ...f.coin, pageUrl: `/burnticker/t/${encodeURIComponent(f.coin.ticker)}`, rulesMatch } : null;
  const program = { read, config: prog?.config ?? null, rulesSha256: prog?.rulesSha256 ?? null, readings: prog?.readings ?? null, burns: prog?.burns ?? null };
  const links = { ...base.links, page: coin && launched ? coin.pageUrl : null };
  let verdict: MintVerdict, headline: string, summary: string;
  if (launched && (prog || !read) && rulesMatch !== false) {
    verdict = "burnticker"; headline = "Burnticker coin: yes";
    summary = `$${f.coin!.ticker} (${f.coin!.name}), launched ${f.coin!.launchedAt ? f.coin!.launchedAt.slice(0, 10) : "—"} by ${short(f.coin!.creator)} · ${f.coin!.receipts} receipt${f.coin!.receipts === 1 ? "" : "s"} · rules sha256 ${f.coin!.rulesSha256.slice(0, 12)}…${read ? "" : " · the program's TokenConfig is not read on this host"}`;
  } else if (launched && read && !prog) {
    verdict = "not-registered"; headline = "NOT registered with the burn_receipts program";
    summary = `Listed on Burnticker as $${f.coin!.ticker}, but the program holds no TokenConfig for this mint on ${f.cluster}.`;
  } else if (launched && rulesMatch === false) {
    verdict = "not-registered"; headline = "Rules do not match the program";
    summary = `Listed on Burnticker as $${f.coin!.ticker}, but the program's rules sha256 differs from the registry's. Use the receipt verifier and report it.`;
  } else if (prog) {
    verdict = "program-only"; headline = "Registered with the burn_receipts program; not listed on Burnticker";
    summary = `A TokenConfig exists (rules sha256 ${prog.rulesSha256.slice(0, 12)}…), but this mint is not a coin launched on Burnticker. The program is open: another launchpad may use it.`;
  } else if (f.coin) {
    verdict = "not-launched"; headline = f.coin.status === "expired" ? "An expired Burnticker draft — never launched" : "A Burnticker draft — not launched yet";
    summary = `$${f.coin.ticker} is ${f.coin.status === "expired" ? "a draft that was not launched within 24 hours" : "reserved as a draft"}; it has no receipts.`;
  } else {
    verdict = "not-registered"; headline = "NOT registered with the burn_receipts program";
    summary = read ? `No TokenConfig for this mint under program ${f.programId} on ${f.cluster}, and it is not a Burnticker coin.` : "It is not a Burnticker coin. (The program itself is not read on this host.)";
  }
  return { ...base, links, verdict, headline, summary, program, coin, checks };
}

const short = (a: string) => (a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a);
