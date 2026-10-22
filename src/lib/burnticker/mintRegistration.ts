import fs from "node:fs";
import path from "node:path";
import { PublicKey } from "@solana/web3.js";
import { configPda } from "@/lib/burnReceipts/pda";
import { BURN_RECEIPTS_IDL } from "@/lib/burnReceipts/idl";
import { isAccount, readAccount } from "@/lib/burnticker/trustpack/idlReader";
import { base64ToBytes, isPubkey, toHex } from "@/lib/burnticker/trustpack/base58";
import { jsonRpc, type Rpc } from "@/lib/burnticker/trustpack/receiptCheck";
import { NETWORKS, PROGRAM_IDS, rpcUrlFor, type Network } from "@/lib/burnticker/networks";

/**
 * ON-CHAIN REGISTRATION OF A MINT, PER NETWORK (website audit 4, BT-01). Reads the burn_receipts TokenConfig PDA ["config", mint] with a
 * plain read-only getAccountInfo on each network's canonical program id (networks.ts) — the same configuration the receipt verifier uses
 * — and decodes it with the IDL. Three states, never collapsed:
 *
 *   registered      the account exists, is owned by the program and decodes as a TokenConfig
 *   not-registered  the RPC answered and the account does not exist
 *   unavailable     the RPC failed, or the account exists but is not a decodable TokenConfig — whether the mint is registered is UNKNOWN
 *
 * Catalogue membership (Burnticker's registry) is a separate fact, decided in verifyMint.ts.
 */

export type RegistrationState = "registered" | "not-registered" | "unavailable";
export interface NetworkRegistration {
  network: Network; programId: string; state: RegistrationState;
  config: string | null; rulesSha256: string | null; readings: number | null; burns: number | null;
  /** why the read is unavailable (never shown as a negative) */
  reason: string | null;
}
export type RegistrationReader = (network: Network, programId: string, mint: string) => Promise<NetworkRegistration>;

type TokenConfigLite = { mint: string; rules_sha256: Uint8Array; readings: number; burns: number };

export function decodeRegistration(network: Network, programId: string, config: string, acct: { owner: string; data: [string, string] } | null): NetworkRegistration {
  const base = { network, programId, config: null, rulesSha256: null, readings: null, burns: null, reason: null };
  if (acct === null) return { ...base, config, state: "not-registered" };   // config = the address that was read (no account there)
  if (acct.owner !== programId) return { ...base, state: "unavailable", reason: `The account at the TokenConfig address belongs to ${acct.owner}, not to the program.` };
  const bytes = base64ToBytes(acct.data[0]);
  if (!isAccount(BURN_RECEIPTS_IDL, "TokenConfig", bytes)) return { ...base, state: "unavailable", reason: "The account is not a TokenConfig. Its type marker does not match." };
  try {
    const c = readAccount<TokenConfigLite>(BURN_RECEIPTS_IDL, "TokenConfig", bytes);
    return { ...base, state: "registered", config, rulesSha256: toHex(c.rules_sha256), readings: Number(c.readings), burns: Number(c.burns) };
  } catch (e) {
    return { ...base, state: "unavailable", reason: `The TokenConfig could not be decoded. The error was: ${(e as Error).message.slice(0, 80)}` };
  }
}

export async function readRegistration(rpc: Rpc, network: Network, programId: string, mint: string): Promise<NetworkRegistration> {
  if (!isPubkey(mint) || !isPubkey(programId)) return { network, programId, state: "unavailable", config: null, rulesSha256: null, readings: null, burns: null, reason: "This is not a public key." };
  const config = configPda(new PublicKey(programId), new PublicKey(mint)).toBase58();
  try {
    const r = await rpc.call<unknown>("getAccountInfo", [config, { encoding: "base64", commitment: "confirmed" }]);
    // Only an explicit `value: null` inside a getAccountInfo result means "no account". A missing result, a result without `value`,
    // or an account that is not {owner, data:[base64, "base64"]} is NOT an answer about the mint (ChatGPT re-check 2026-10-11 F1).
    const acct = accountInfoValue(r);
    if (acct === undefined) return { ...unavailable(network, programId), config, reason: `The ${network} RPC sent back an answer that was not account data.` };
    return decodeRegistration(network, programId, config, acct);
  } catch (e) {
    return { ...unavailable(network, programId), reason: `The ${network} RPC could not be read just now. The error was: ${(e as Error).message.slice(0, 100)}` };
  }
}

const unavailable = (network: Network, programId: string): NetworkRegistration => ({ network, programId, state: "unavailable", config: null, rulesSha256: null, readings: null, burns: null, reason: null });

/** The `value` of a getAccountInfo result: null (no account), an account record, or undefined when the answer is not one. */
export function accountInfoValue(r: unknown): { owner: string; data: [string, string] } | null | undefined {
  if (r === null || typeof r !== "object" || !("value" in r)) return undefined;
  const v = (r as { value: unknown }).value;
  if (v === null) return null;
  if (v === null || typeof v !== "object") return undefined;
  const a = v as { owner?: unknown; data?: unknown };
  if (typeof a.owner !== "string" || !Array.isArray(a.data) || typeof a.data[0] !== "string" || a.data[1] !== "base64") return undefined;
  return { owner: a.owner, data: [a.data[0], "base64"] };
}

/** The default reader: each network's RPC (rpcUrlFor: the host's own RPC only for the host's network), two attempts. */
export const chainRegistrationReader = (env: Readonly<Record<string, string | undefined>> = process.env): RegistrationReader =>
  (network, programId, mint) => readRegistration(jsonRpc(rpcUrlFor(network, env), fetch, { attempts: 2 }), network, programId, mint);

export async function readAllRegistrations(mint: string, reader: RegistrationReader): Promise<NetworkRegistration[]> {
  return Promise.all(NETWORKS.map((n) => reader(n, PROGRAM_IDS[n].burn_receipts, mint)));
}

// ---- coins the platform itself disclosed (rehearsals): named, so a registered-but-unlisted rehearsal mint is not called "another launchpad's"

export interface DisclosedCoin { mint: string; network: Network; ticker: string; label: string; rulesPath: string }
export const DISCLOSED_RULES: { rulesPath: string; network: Network; label: string }[] = [
  { rulesPath: "config/burnkeeper/deficit.devnet.rules.json", network: "devnet", label: "Burnticker's devnet rehearsal of $DEFICIT (2026-10-10; 1% of the burn pool per $1B unit, the proposed mainnet rule is 2%)" },
  { rulesPath: "config/burnkeeper/paircurve-devnet-1a.rules.json", network: "devnet", label: "Burnticker's devnet pair rehearsal coin A (2026-10-10)" },
  { rulesPath: "config/burnkeeper/paircurve-devnet-1b.rules.json", network: "devnet", label: "Burnticker's devnet pair rehearsal coin B (2026-10-10)" },
  { rulesPath: "config/burnkeeper/rehearsal.rules.json", network: "mainnet", label: "Burnticker's disclosed mainnet rehearsal coin $REHEARSAL (a throwaway under the real platform config; not for trading)" },
];

let disclosedCache: { root: string; coins: DisclosedCoin[] } | null = null;
export function disclosedCoins(root = process.cwd()): DisclosedCoin[] {
  if (disclosedCache && disclosedCache.root === root) return disclosedCache.coins;
  const coins: DisclosedCoin[] = [];
  for (const d of DISCLOSED_RULES) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(root, d.rulesPath), "utf8")) as { mint?: string | null; ticker?: string };
      if (j.mint && isPubkey(j.mint)) coins.push({ mint: j.mint, network: d.network, ticker: j.ticker ?? "", label: d.label, rulesPath: d.rulesPath });
    } catch { /* a missing rules file just means that coin is not named */ }
  }
  disclosedCache = { root, coins };
  return coins;
}
