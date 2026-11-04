/**
 * THE PRIVATE SEND ROUTE (burn dispersal, owner decision 2026-10-13). When BURNTICKER_PRIVATE_SEND_URL is set (a Jito block-engine
 * `…/api/v1/transactions` endpoint, or any endpoint that takes the standard JSON-RPC `sendTransaction` with a base64 transaction), every
 * transaction the program port sends — and every rebroadcast while it confirms — goes there instead of the public RPC, so a crank is not
 * visible in the public mempool before it lands. Unset: the port sends through its RPC exactly as before.
 *
 * The URL may carry a credential (a query token, a user:password, a path key). It is NEVER logged: `redactUrl` keeps the scheme and
 * host only, and errors are reported without the URL.
 */

export const PRIVATE_SEND_ENV = "BURNTICKER_PRIVATE_SEND_URL";

export type PrivateSender = { label: string; send(raw: Uint8Array): Promise<string | null> };
type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** scheme://host only — no user info, path, query or fragment (any of them may hold a key). */
export function redactUrl(u: string): string {
  try { const x = new URL(u); return `${x.protocol}//${x.host}`; } catch { return "(unparseable url)"; }
}

/**
 * Listeners told BEFORE every private-route send (2026-10-15 review): this route bypasses the keeper's Connection, so the Burnticker
 * keeper's per-cycle account cache (cycleAccountCache.ts) registers here to drop its values on these sends too. Returns the unsubscribe.
 */
const sendListeners = new Set<() => void>();
export function onPrivateSend(listener: () => void): () => void { sendListeners.add(listener); return () => { sendListeners.delete(listener); }; }

/** The sender for `url`; JSON-RPC sendTransaction, base64. Returns the signature the route reports (or null). Throws on a refusal. */
export function privateSender(url: string, fetchImpl: FetchLike = globalThis.fetch as unknown as FetchLike): PrivateSender {
  if (!/^https:\/\//.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(url)) throw new Error(`${PRIVATE_SEND_ENV} must be an https URL (${redactUrl(url)})`);
  const label = `private route ${redactUrl(url)}`;
  return {
    label,
    async send(raw) {
      for (const l of sendListeners) { try { l(); } catch { /* a listener never stops a send */ } }
      const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "sendTransaction", params: [Buffer.from(raw).toString("base64"), { encoding: "base64" }] });
      let r: Awaited<ReturnType<FetchLike>>;
      try { r = await fetchImpl(url, { method: "POST", headers: { "content-type": "application/json" }, body, signal: AbortSignal.timeout(10_000) }); }
      catch (e) { throw new Error(`${label}: ${(e as Error).name === "TimeoutError" ? "timed out" : "unreachable"}`); }
      let j: { result?: unknown; error?: { message?: unknown } } = {};
      try { j = (await r.json()) as typeof j; } catch { /* no body */ }
      if (!r.ok || j.error) throw new Error(`${label}: refused (HTTP ${r.status}${j.error?.message ? `: ${String(j.error.message).slice(0, 120)}` : ""})`);
      return typeof j.result === "string" ? j.result : null;
    },
  };
}

/** The sender from the environment, or null when the variable is unset. */
export function privateSenderFromEnv(env: Readonly<Record<string, string | undefined>>, fetchImpl?: FetchLike): PrivateSender | null {
  const url = env[PRIVATE_SEND_ENV]?.trim();
  return url ? privateSender(url, fetchImpl) : null;
}
