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
  devnet: { address: null, authority: null },
  mainnet: { address: null, authority: null },
};

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
