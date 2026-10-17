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
  // swap-1 (2026-10-14): the coin page's swap panel checks the connection is on the coin's network before it sends (swap/chain.ts)
  "getGenesisHash",
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

/**
 * THE FLIGHT TOKEN (2026-10-15 prelaunch audit C2). Anonymous traffic through this proxy could spend the site's whole Helius day, after
 * which a visitor's swap or launch could not get a blockhash, simulate or confirm. The proxy now counts in its own lane with its own cap
 * (apiBudget.ts LANE_SPLIT), and the calls that carry a transaction through (FLIGHT_METHODS) may use the reserve held back for
 * confirmations when they carry a flight token: a short-lived HMAC token the page fetches from RPC_FLIGHT_PATH just before it builds a
 * transaction (same-origin only, a few an hour per visitor, each good for FLIGHT_TOKEN_CALLS calls over FLIGHT_TOKEN_TTL_MS). A body
 * without a valid token is still forwarded, in the proxy lane. Client-safe: the wrapper below runs in the browser.
 */
export const RPC_FLIGHT_PATH = "/api/burnticker/rpc/flight";
export const RPC_FLIGHT_HEADER = "x-burnticker-flight";
/**
 * What a swap or a launch reads and sends from the browser: building (the lookup table and the accounts it names, balances, the
 * cluster's genesis, rent, fees, the blockhash), simulating, sending and confirming. (Re-review: the build reads were in the proxy lane,
 * so a launch late in a spent day still failed before it was signed.) Safe to admit because the flight lane has its own ceiling.
 */
export const FLIGHT_METHODS: ReadonlySet<string> = new Set(["getLatestBlockhash", "simulateTransaction", "sendTransaction", "getSignatureStatuses", "getBlockHeight",
  "isBlockhashValid", "getFeeForMessage", "getTransaction", "getAccountInfo", "getMultipleAccounts", "getBalance", "getGenesisHash",
  "getMinimumBalanceForRentExemption", "getRecentPrioritizationFees", "getTokenAccountBalance"]);
export const FLIGHT_TOKEN_TTL_MS = 10 * 60_000;
export const FLIGHT_TOKEN_CALLS = 24;
/** The proxy's answer header when a token was sent but not admitted (spent, expired, another visitor's): the page drops it. */
export const RPC_FLIGHT_REFUSED_HEADER = "x-burnticker-flight-refused";

/** The JSON-RPC methods of a body (a call or a batch); [] when it is not one. */
export function rpcMethodsOf(body: unknown): string[] {
  let parsed: unknown = body;
  if (typeof body === "string") { try { parsed = JSON.parse(body); } catch { return []; } }
  const arr = Array.isArray(parsed) ? parsed : [parsed];
  return arr.map((c) => (c && typeof c === "object" && typeof (c as RpcCall).method === "string" ? String((c as RpcCall).method) : ""));
}
/** True when every call in the body carries a transaction through (FLIGHT_METHODS). */
export const isFlightBody = (body: unknown): boolean => { const m = rpcMethodsOf(body); return m.length > 0 && m.every((x) => FLIGHT_METHODS.has(x)); };

type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/**
 * SENDS UNDER WAY (re-review 3): the token rides only while a send is running, never on the page's passive reads (the swap panel's
 * refresh, the market and balance reads). The swap's simulateSignSend (swap/chain.ts) and the launch's sign-and-send run (SignCard.tsx)
 * run inside withFlight; flightFetch attaches the token only while one is under way. A count, so two sends at once both keep it.
 */
let flightsUnderWay = 0;
export async function withFlight<T>(fn: () => Promise<T>): Promise<T> {
  flightsUnderWay++;
  try { return await fn(); } finally { flightsUnderWay = Math.max(0, flightsUnderWay - 1); }
}
export const flightUnderWay = (): boolean => flightsUnderWay > 0;
/** After a failed mint (429, 503, a network error) or a refused token, the page waits this long before it asks for a token again. */
export const FLIGHT_RETRY_AFTER_MS = 2 * 60_000;

/**
 * The wallet connection's fetch (ShellWalletProviders, the launch page's WalletProviders): while a send is under way (withFlight), a
 * body made only of FLIGHT_METHODS sent to this site's proxy carries the flight token, fetched once and reused until it is near its
 * expiry. A token that cannot be fetched, or one the proxy refused, is not asked for again for FLIGHT_RETRY_AFTER_MS (no re-mint storm);
 * meanwhile the calls go on without it, in the proxy lane. The wrapper never fails a call the plain fetch would make.
 */
export function flightFetch(base: FetchFn = (i, n) => fetch(i, n), o: { now?: () => number; always?: boolean } = {}): FetchFn {
  const now = o.now ?? (() => Date.now());
  let token: { value: string; expiresAt: number } | null = null;
  let pending: Promise<void> | null = null;
  let retryAt = 0;
  const refresh = (): Promise<void> => (pending ??= (async () => {
    try {
      const r = await base(RPC_FLIGHT_PATH, { method: "GET", credentials: "same-origin", headers: { accept: "application/json" } });
      if (!r.ok) { retryAt = now() + FLIGHT_RETRY_AFTER_MS; return; }
      const j = (await r.json()) as { token?: unknown; expiresAt?: unknown };
      if (typeof j.token === "string" && typeof j.expiresAt === "number") token = { value: j.token, expiresAt: j.expiresAt };
      else retryAt = now() + FLIGHT_RETRY_AFTER_MS;
    } catch { retryAt = now() + FLIGHT_RETRY_AFTER_MS; /* no token: the call goes on in the proxy lane */ } finally { pending = null; }
  })());
  return async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    let path = "";
    try { path = new URL(url, "http://x").pathname; } catch { path = ""; }
    if (path !== RPC_PROXY_PATH || !isFlightBody(init?.body) || !(o.always || flightUnderWay())) return base(input, init);
    if ((!token || token.expiresAt - now() < 30_000) && now() >= retryAt) await refresh();
    if (!token || token.expiresAt - now() < 1_000) return base(input, init);
    const headers = new Headers(init?.headers);
    headers.set(RPC_FLIGHT_HEADER, token.value);
    const r = await base(input, { ...init, headers });
    // a spent, expired or refused token is dropped, and a new one is not asked for during FLIGHT_RETRY_AFTER_MS
    try { if (r.headers?.get(RPC_FLIGHT_REFUSED_HEADER)) { token = null; retryAt = now() + FLIGHT_RETRY_AFTER_MS; } } catch { /* a response without headers keeps the token */ }
    return r;
  };
}
