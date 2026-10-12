import { coinPageHref } from "@/lib/burnticker/coinKey";
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
 *   burnticker      "Burnticker coin: yes"                    both agree (or the program could not be read just now: said so)
 *   program-only    registered with the program on devnet or mainnet, not in the catalogue (a disclosed rehearsal coin is named;
 *                   otherwise another launchpad may use the open program)
 *   not-launched    reserved on Burnticker as a draft, or a draft that expired — not a launched coin
 *   not-registered  "NOT registered with the burn_receipts program" — only when EVERY network's read answered "no TokenConfig"
 *   unavailable     "Unable to verify": a network's read failed and nothing else decides it (audit 4, BT-01: never a definitive no)
 *   invalid         not a Solana address
 *
 * Registration (the program, per network) and catalogue membership (the registry, the host's network) are separate output fields.
 *
 * Pure: verifyMintServe.ts reads the registry and the program and hands the facts here.
 */

export const VERIFY_MINT_SCHEMA = "burnticker.verify-mint/v1";
export type MintVerdict = "burnticker" | "program-only" | "not-launched" | "not-registered" | "unavailable" | "invalid";

/** One network's registration read (mintRegistration.ts); a type-only mirror so this module stays pure. */
export interface MintNetworkRead { network: "devnet" | "mainnet"; programId: string; state: "registered" | "not-registered" | "unavailable"; config: string | null; rulesSha256: string | null; readings: number | null; burns: number | null; reason: string | null }

export interface MintFacts {
  mint: string; cluster: string; programId: string;
  /** The host network's program read: null = the RPC answered and there is no TokenConfig; "unread" = the read failed (UNKNOWN, never "no"). */
  program: { config: string; rulesSha256: string; readings: number; burns: number } | null | "unread";
  /** Every network's read (BT-01: the registration is checked on devnet AND mainnet with the canonical program ids); absent = host only. */
  networks?: MintNetworkRead[];
  /** A coin the platform itself disclosed (a rehearsal), named so it is never called "another launchpad's". */
  disclosed?: { network: string; ticker: string; label: string } | null;
  coin: { ticker: string; name: string; status: string; creator: string; launchedAt: string | null; rulesSha256: string; receipts: number; burns: number; platformId: string | null; /** another coin holds the same ticker (owner 2026-10-12: tickers are not unique); the page link then uses the mint */ tickerShared?: boolean } | null;
}
export interface MintCheck { id: string; ok: boolean | null; detail: string }
export type RegistrationSummary = "registered" | "not-registered" | "unknown";
export type CatalogueState = "launched" | "draft" | "expired" | "absent";
export interface MintVerification {
  schema: typeof VERIFY_MINT_SCHEMA; mint: string; cluster: string; programId: string; checkedAt: string;
  verdict: MintVerdict; headline: string; summary: string;
  /** on-chain registration (the program) — separate from catalogue membership (Burnticker's registry) */
  registration: { state: RegistrationSummary; networks: MintNetworkRead[] };
  catalogue: { state: CatalogueState; network: string };
  disclosed: { network: string; ticker: string; label: string } | null;
  program: { read: boolean; config: string | null; rulesSha256: string | null; readings: number | null; burns: number | null };
  coin: (NonNullable<MintFacts["coin"]> & { pageUrl: string; rulesMatch: boolean | null }) | null;
  checks: MintCheck[];
  links: { verifier: string; page: string | null; self: string };
}

export const isSolanaAddress = (s: string): boolean => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);

/** The host network's read as a MintNetworkRead (for facts that carry only `program`). */
function hostRead(f: MintFacts): MintNetworkRead {
  const p = f.program;
  const net = (f.cluster === "mainnet" ? "mainnet" : "devnet") as MintNetworkRead["network"];
  if (p === "unread") return { network: net, programId: f.programId, state: "unavailable", config: null, rulesSha256: null, readings: null, burns: null, reason: "the burn program could not be read on this site" };
  if (p === null) return { network: net, programId: f.programId, state: "not-registered", config: null, rulesSha256: null, readings: null, burns: null, reason: null };
  return { network: net, programId: f.programId, state: "registered", config: p.config, rulesSha256: p.rulesSha256, readings: p.readings, burns: p.burns, reason: null };
}

const programCheck = (n: MintNetworkRead): MintCheck => ({
  id: `program:${n.network}`,
  ok: n.state === "registered" ? true : n.state === "not-registered" ? false : null,
  detail: n.state === "registered" ? `${n.network}: TokenConfig ${n.config} exists under program ${n.programId}` : n.state === "not-registered" ? `${n.network}: no TokenConfig for this mint under program ${n.programId}` : `${n.network}: unable to verify, because ${n.reason ?? "the program could not be read just now"}`,
});

export function verifyMint(f: MintFacts, nowMs: number): MintVerification {
  const base = { schema: VERIFY_MINT_SCHEMA, mint: f.mint, cluster: f.cluster, programId: f.programId, checkedAt: new Date(nowMs).toISOString(), links: { verifier: "/burnticker/check", page: null as string | null, self: `/burnticker/verify?mint=${encodeURIComponent(f.mint)}` } } as const;
  if (!isSolanaAddress(f.mint)) {
    return { ...base, verdict: "invalid", headline: "Not a Solana address", summary: "A token address is 32 to 44 base58 characters long.", registration: { state: "unknown", networks: [] }, catalogue: { state: "absent", network: f.cluster }, disclosed: null, program: { read: false, config: null, rulesSha256: null, readings: null, burns: null }, coin: null, checks: [{ id: "address", ok: false, detail: "not a base58 address of 32–44 characters" }] };
  }
  const read = f.program !== "unread";
  const prog = f.program !== "unread" ? f.program : null;
  const host = hostRead(f);
  const networks = f.networks && f.networks.length ? [host, ...f.networks.filter((n) => n.network !== host.network)] : [host];
  const elsewhere = networks.find((n) => n.network !== host.network && n.state === "registered") ?? null;
  const regState: RegistrationSummary = networks.some((n) => n.state === "registered") ? "registered" : networks.every((n) => n.state === "not-registered") ? "not-registered" : "unknown";
  const launched = f.coin !== null && f.coin.status !== "draft" && f.coin.status !== "expired";
  const catalogue: CatalogueState = !f.coin ? "absent" : f.coin.status === "draft" ? "draft" : f.coin.status === "expired" ? "expired" : "launched";
  const rulesMatch = f.coin && prog ? f.coin.rulesSha256 === prog.rulesSha256 : null;
  const disclosed = f.disclosed ?? null;
  const checks: MintCheck[] = [
    { id: "address", ok: true, detail: "a Solana address" },
    ...networks.map(programCheck),
    { id: "registry", ok: f.coin ? launched : false, detail: f.coin ? `${launched ? "launched" : f.coin.status} in Burnticker's catalogue on ${f.cluster} as $${f.coin.ticker}` : `not in Burnticker's catalogue of launched coins on ${f.cluster}, the network this site shows` },
    { id: "rules", ok: rulesMatch, detail: rulesMatch === null ? "nothing to compare" : rulesMatch ? `the registry's rules.json hashes to the sha256 the program holds (${prog!.rulesSha256.slice(0, 12)}…)` : `the registry's rules sha256 ${f.coin!.rulesSha256.slice(0, 12)}… differs from the program's ${prog!.rulesSha256.slice(0, 12)}…` },
  ];
  // tickers are not unique (owner 2026-10-12): a coin whose ticker another coin shares links its mint page
  const coin = f.coin ? { ...f.coin, pageUrl: coinPageHref({ ticker: f.coin.ticker, mint: f.mint }, !!f.coin.tickerShared), rulesMatch } : null;
  const program = { read, config: prog?.config ?? null, rulesSha256: prog?.rulesSha256 ?? null, readings: prog?.readings ?? null, burns: prog?.burns ?? null };
  const links = { ...base.links, page: coin && launched ? coin.pageUrl : null };
  const regText = (n: MintNetworkRead) => `The burn program has a record (TokenConfig) for this token on ${n.network}, with rules sha256 ${(n.rulesSha256 ?? "").slice(0, 12)}…, ${n.readings ?? 0} reading${n.readings === 1 ? "" : "s"} and ${n.burns ?? 0} burn${n.burns === 1 ? "" : "s"}.`;
  const otherNet = (n: MintNetworkRead) => (n.network !== f.cluster ? ` This site's catalogue covers ${f.cluster}.` : "");
  let verdict: MintVerdict, headline: string, summary: string;
  if (launched && (prog || !read) && rulesMatch !== false) {
    verdict = "burnticker"; headline = "Burnticker coin: yes";
    summary = `$${f.coin!.ticker} (${f.coin!.name}), launched ${f.coin!.launchedAt ? f.coin!.launchedAt.slice(0, 10) : "—"} by ${short(f.coin!.creator)}. It has ${f.coin!.receipts} receipt${f.coin!.receipts === 1 ? "" : "s"}, and its rules sha256 starts ${f.coin!.rulesSha256.slice(0, 12)}…${read ? "" : " The program's record (TokenConfig) could not be read just now, so its registration is unknown. The catalogue does list it."}`;
  } else if (launched && read && !prog) {
    verdict = "not-registered"; headline = "NOT registered with the burn program";
    summary = `It is listed on Burnticker as $${f.coin!.ticker}, but the burn program has no record (TokenConfig) for this token on ${f.cluster}.`;
  } else if (launched && rulesMatch === false) {
    verdict = "not-registered"; headline = "Rules do not match the program";
    summary = `It is listed on Burnticker as $${f.coin!.ticker}, but the rules hash the program holds differs from the registry's. Check it with the receipt verifier and report it.`;
  } else if (prog || elsewhere) {
    const n = prog ? host : elsewhere!;
    const named = disclosed && disclosed.network === n.network ? disclosed : null;
    verdict = "program-only";
    headline = named ? `Registered on ${n.network}: a disclosed Burnticker rehearsal coin` : `Registered with the burn program on ${n.network}, but not listed on Burnticker`;
    summary = named
      ? `${named.label}. ${regText(n)} It is not in the catalogue of launched coins.${otherNet(n)} Being registered with the program and being listed in the catalogue are separate facts.`
      : `${regText(n)} But this token is not a coin launched on Burnticker.${otherNet(n)} The program is open, so another launchpad may use it.`;
  } else if (f.coin) {
    verdict = "not-launched"; headline = f.coin.status === "expired" ? "An expired Burnticker draft that was never launched" : "A Burnticker draft, not launched yet";
    summary = `$${f.coin.ticker} is ${f.coin.status === "expired" ? "a draft that was not launched within 24 hours" : "reserved as a draft"}. It has no receipts.`;
  } else if (regState === "unknown") {
    const failed = networks.filter((n) => n.state === "unavailable").map((n) => n.network);
    verdict = "unavailable"; headline = "Unable to verify";
    summary = `The burn program could not be read on ${failed.join(" and ")} just now, so it is unknown whether this token is registered. That is not a "no". It is not in Burnticker's catalogue on ${f.cluster}. Try again in a minute.`;
  } else {
    verdict = "not-registered"; headline = "NOT registered with the burn program";
    summary = `The burn program (${f.programId}) has no record (TokenConfig) for this token on ${networks.map((n) => n.network).join(" or ")}. It is not a Burnticker coin.`;
  }
  return { ...base, links, verdict, headline, summary, registration: { state: regState, networks }, catalogue: { state: catalogue, network: f.cluster }, disclosed, program, coin, checks };
}

const short = (a: string) => (a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a);
