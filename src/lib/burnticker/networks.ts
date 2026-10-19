/**
 * ONE PER-NETWORK PROGRAM CONFIGURATION (website audit 4, BT-01, 2026-10-11). Every verifier on the site — the receipt verifier
 * (/burnticker/check), the mint verifier (/burnticker/verify), the API's /v1/check/receipts and /v1/verify-mint — reads the program ids
 * and public RPC endpoints from here, never from the host's wiring (a host without BURNTICKER_PROGRAM_ID used to show the fake client's
 * placeholder id and call the result a definitive "not registered").
 *
 * Client-safe: no fs, no web3. test/burntickerNetworks.test.ts holds these values equal to config/burnticker/verified-build.json
 * (programs[].programId with a deployed row per network), config/burnticker/operator.json (clusters.<net>.programs), the IDL's address
 * and src/lib/burnReceipts/constants.ts — a change in one place fails until all agree.
 */

export type Network = "devnet" | "mainnet";
export const NETWORKS: readonly Network[] = ["devnet", "mainnet"] as const;

/** The deployed program ids per network (both programs are deployed at the same address on devnet and mainnet). */
export const PROGRAM_IDS: Record<Network, { burn_receipts: string; pair_curve: string }> = {
  devnet: { burn_receipts: "AuQjoSgq7upmyPBv2itwy2TSZ1VjoVipyy4z9wd7zhMM", pair_curve: "2jQotwSG8WKNYr5pccxuVmNa314qcnnwmrhqbuakELkN" },
  mainnet: { burn_receipts: "AuQjoSgq7upmyPBv2itwy2TSZ1VjoVipyy4z9wd7zhMM", pair_curve: "2jQotwSG8WKNYr5pccxuVmNa314qcnnwmrhqbuakELkN" },
};

/**
 * The address lookup table every browser launch step is compiled against (re-check 2026-10-11; src/lib/burnticker/lookupTable.ts holds
 * its expected entries). `address` null = not created on that network yet: the signing card refuses to sign there. `authority` = the
 * operations key allowed to hold the table before it is frozen; null = the table must be frozen (no authority). Created, extended and
 * frozen with scripts/burnticker-lut.mts; `verify` prints the diff against the expected entries.
 */
export const LOOKUP_TABLES: Record<Network, { address: string | null; authority: string | null }> = {
  devnet: { address: "Es59YYRMUEJj1rNTXcrCDueJ78P2GKrHPe3BaKqqRmkZ", authority: null },   // made and frozen 2026-10-15 from the synthetic creator's devnet wallet (tx 3TS5fqUV…)
  // 2026-10-19 (CPMM tier 14): this frozen 21-entry table lacks index 21 (tier 14), so the code that lists it is refused here; a new
  // 22-entry table is created, frozen and pinned on the host (BURNTICKER_LOOKUP_TABLE) before that code is published, then compiled in here
  mainnet: { address: "8DZaHFo6UnJk5br29BcRQZmdEKRpzKJTCyz1dRsHhJ2T", authority: null },
};

export type LookupTablePin = { address: string | null; authority: string | null };
const PUBKEY_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * THE PIN THE BROWSER CHECKS, READ AT RUNTIME (launch-10, 2026-10-12): pinning a table must not need a code release. On the host's own
 * network BURNTICKER_LOOKUP_TABLE (the table address) and BURNTICKER_LOOKUP_TABLE_AUTHORITY (the operations key still allowed to hold
 * it; unset = the table must be frozen) override LOOKUP_TABLES above; the other network keeps the compiled value. The signing card
 * fetches this from GET /api/burnticker/launch. A malformed address is ignored (the compiled value stays), so a typo cannot unpin a
 * table silently. The address only says WHERE to look: the browser still checks every entry against lookupTable.ts before it signs.
 */
export function lookupTablePin(network: Network, env: Readonly<Record<string, string | undefined>> = process.env): LookupTablePin {
  if (network !== hostNetwork(env)) return LOOKUP_TABLES[network];
  const address = (env.BURNTICKER_LOOKUP_TABLE ?? "").trim(), authority = (env.BURNTICKER_LOOKUP_TABLE_AUTHORITY ?? "").trim();
  if (!PUBKEY_RE.test(address)) return LOOKUP_TABLES[network];
  return { address, authority: PUBKEY_RE.test(authority) ? authority : null };
}

/** Both networks' pins as the host serves them (GET /api/burnticker/launch). */
export const lookupTablePins = (env: Readonly<Record<string, string | undefined>> = process.env): Record<Network, LookupTablePin> =>
  ({ devnet: lookupTablePin("devnet", env), mainnet: lookupTablePin("mainnet", env) });

/** The public JSON-RPC endpoints a verifier falls back to (read-only calls only). */
export const PUBLIC_RPC_URLS: Record<Network, string> = { devnet: "https://api.devnet.solana.com", mainnet: "https://api.mainnet-beta.solana.com" };

/** The network the host's pages and catalogue read (BURNTICKER_CLUSTER; anything but "mainnet" reads devnet, the nearest public cluster). */
export const hostNetwork = (env: Readonly<Record<string, string | undefined>> = process.env): Network => ((env.BURNTICKER_CLUSTER ?? "").trim() === "mainnet" ? "mainnet" : "devnet");

/**
 * The RPC a server-side read of `network` uses: the host's BURNTICKER_RPC_URL only when it serves the SAME network the host reads,
 * else the network's public endpoint. (Before audit 4 the host's devnet RPC answered mainnet reads too: the bounty wallet's mainnet
 * balance read as 0 from devnet.)
 */
export const rpcUrlFor = (network: Network, env: Readonly<Record<string, string | undefined>> = process.env): string =>
  (network === hostNetwork(env) && (env.BURNTICKER_RPC_URL ?? "").trim()) || PUBLIC_RPC_URLS[network];

export const explorerUrl = (kind: "address" | "tx", id: string, network: Network): string =>
  `https://explorer.solana.com/${kind}/${id}${network === "mainnet" ? "" : `?cluster=${network}`}`;
