/**
 * THE BROWSER'S RPC PROXY (launch night 2026-10-13: the owner's Eagles launch died with "lookup table mismatch — nothing was sent (403
 * Access forbidden)" because the page read the lookup table through Solana's free public RPC, which refuses some requests). The wallet
 * adapter's Connection now points at /api/burnticker/rpc (NEXT_PUBLIC_BURNTICKER_RPC_URL at build time), and this server forwards a
 * small allow-list of JSON-RPC methods to the host's keyed RPC (networks.ts rpcUrlFor). No key reaches the page; nothing is signed here;
 * the methods are the ones a launch, a wallet balance and a confirm need, read or send-of-a-signed-transaction only.
 */
export const RPC_PROXY_PATH = "/api/burnticker/rpc";
export const RPC_PROXY_METHODS: ReadonlySet<string> = new Set([
  "getAccountInfo", "getMultipleAccounts", "getBalance", "getLatestBlockhash", "getBlockHeight", "getSlot", "getVersion", "getHealth",
  "getMinimumBalanceForRentExemption", "getAddressLookupTable", "getSignatureStatuses", "getTransaction", "getSignaturesForAddress",
  "getTokenAccountBalance", "getTokenAccountsByOwner", "getParsedTokenAccountsByOwner", "simulateTransaction", "sendTransaction",
  "getFeeForMessage", "getRecentPrioritizationFees", "isBlockhashValid", "getEpochInfo", "getProgramAccounts",
]);
export const RPC_PROXY_MAX_BODY = 200_000;

export type RpcCall = { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };

/** Checks one call or a batch: every method must be on the list; returns the refused method, or null when all are allowed. */
export function rpcProxyRefusal(body: unknown): string | null {
  const calls = Array.isArray(body) ? body : [body];
  if (!calls.length || calls.length > 20) return "batch";
  for (const c of calls) {
    const m = c && typeof c === "object" ? (c as RpcCall).method : null;
    if (typeof m !== "string" || !RPC_PROXY_METHODS.has(m)) return typeof m === "string" ? m : "missing method";
    if (m === "getProgramAccounts") return m;   // listed for clarity, never forwarded: too heavy for a browser path
  }
  return null;
}
