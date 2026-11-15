/**
 * ONE CLIENT JSON READ FOR THE TRUST SURFACES (audit R01 / site audit #1, 2026-10-11). The trust page once showed a visitor the browser's
 * own words — "Failed to execute 'json' on 'Response': Unexpected end of JSON input" — because it called `Response.json()` on an empty
 * 500. Every way a read can fail ends here as a typed, plain-words result instead:
 *
 *   network   the request was rejected (offline, DNS, CORS, the host down)      timeout   no answer within `timeoutMs`
 *   http      an HTTP error status (its JSON `error` field kept as detail)      empty     a response with no body
 *   not-json  a body that is not JSON (an HTML error page from a proxy, say)
 *
 * `message` is the sentence a visitor reads; `detail` is the operational fact (status, content type) for the Details disclosure. Neither
 * ever carries a raw parser or Response error. Client-safe: no Node imports.
 */
export type ReadFailure = "network" | "timeout" | "http" | "empty" | "not-json";
export type ReadResult<T> = { ok: true; data: T; status: number } | { ok: false; reason: ReadFailure; status: number | null; message: string; detail: string };

const MESSAGES: Record<ReadFailure, string> = {
  network: "The request did not reach the server (offline, or the site is restarting).",
  timeout: "The server did not answer in time.",
  http: "The server answered with an error.",
  empty: "The server answered with an empty response.",
  "not-json": "The server answered with something other than data (an error page).",
};

type FetchLike = (input: string, init?: { signal?: AbortSignal; cache?: RequestCache; headers?: Record<string, string> }) => Promise<Response>;

export async function readJson<T = unknown>(url: string, opts: { timeoutMs?: number; fetchImpl?: FetchLike } = {}): Promise<ReadResult<T>> {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const f: FetchLike = opts.fetchImpl ?? ((u, i) => fetch(u, i));
  const ctl = typeof AbortController === "function" ? new AbortController() : null;
  let timedOut = false, giveUp: (e: Error) => void = () => {};
  // one timer: abort the request (fetch honours the signal) and reject the race (for a fetch that ignores it)
  const timer = setTimeout(() => { timedOut = true; ctl?.abort(); giveUp(new Error("timeout")); }, timeoutMs);
  const fail = (reason: ReadFailure, status: number | null, detail: string): ReadResult<T> => ({ ok: false, reason, status, message: MESSAGES[reason], detail });
  try {
    let r: Response;
    try {
      r = await Promise.race([
        f(url, { signal: ctl?.signal, cache: "no-store", headers: { accept: "application/json" } }),
        new Promise<never>((_, rej) => { giveUp = rej; }),
      ]);
    } catch {
      return timedOut ? fail("timeout", null, `no answer from ${url} within ${Math.round(timeoutMs / 1000)} s`) : fail("network", null, `${url}: request failed`);
    }
    let text: string;
    try { text = await Promise.race([r.text(), new Promise<never>((_, rej) => { giveUp = rej; })]); } catch { return timedOut ? fail("timeout", r.status, `${url}: the body did not arrive within ${Math.round(timeoutMs / 1000)} s`) : fail("network", r.status, `${url}: HTTP ${r.status}, the body could not be read`); }
    const type = r.headers?.get?.("content-type") ?? "";
    if (!text.trim()) return fail(r.ok ? "empty" : "http", r.status, `${url}: HTTP ${r.status}, empty body`);
    let data: unknown;
    try { data = JSON.parse(text); } catch {
      return fail(r.ok ? "not-json" : "http", r.status, `${url}: HTTP ${r.status}, ${type ? `content type ${type.split(";")[0]}` : "no content type"}, not JSON`);
    }
    if (!r.ok) {
      const e = data && typeof data === "object" && "error" in data ? String((data as { error: unknown }).error).slice(0, 200) : "";
      return fail("http", r.status, `${url}: HTTP ${r.status}${e ? ` — ${e}` : ""}`);
    }
    return { ok: true, data: data as T, status: r.status };
  } finally { clearTimeout(timer); }
}

/** "14:03:22 UTC" — the retry line's timestamp (UTC, the unit every chain read on these pages uses). */
export const utcClock = (ms: number): string => `${new Date(ms).toISOString().slice(11, 19)} UTC`;
