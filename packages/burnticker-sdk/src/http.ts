/** A fetch implementation (the global fetch, undici, or a test double). */
export type Fetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; headers?: { get(name: string): string | null }; json(): Promise<unknown>; text?(): Promise<string> }>;

/** An error answer from the Burnticker API: the HTTP status, the API's `code` and message, and Retry-After on 429. */
export class BurntickerApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly problems: string[];
  readonly retryAfterSec: number | null;
  readonly body: unknown;
  constructor(status: number, body: unknown, retryAfterSec: number | null) {
    const b = (body ?? {}) as { error?: string; code?: string; problems?: string[] };
    super(`Burnticker API ${status}: ${b.error ?? "error"}`);
    this.name = "BurntickerApiError";
    this.status = status; this.code = b.code ?? null; this.problems = Array.isArray(b.problems) ? b.problems : []; this.retryAfterSec = retryAfterSec; this.body = body;
  }
}

/**
 * The SDK's HTTP transport. GETs are plain keyless requests. POSTs send `Content-Type: application/json` and an `Origin` equal to the
 * API's own origin — the API refuses cross-site browser requests, and a bot proves it is not one this way (a browser page cannot set
 * either header cross-site). No keys, cookies or accounts exist.
 */
export class ApiTransport {
  readonly base: string;
  readonly origin: string;
  private readonly fetchImpl: Fetch;
  private readonly userAgent: string;
  private readonly timeoutMs: number;
  constructor(o: { apiBase: string; fetch?: Fetch; userAgent?: string; timeoutMs?: number }) {
    const u = new URL(o.apiBase);
    this.base = o.apiBase.replace(/\/+$/, "");
    this.origin = u.origin;
    this.fetchImpl = o.fetch ?? (globalThis.fetch as unknown as Fetch);
    if (!this.fetchImpl) throw new Error("burnticker: no fetch available — pass { fetch }");
    this.userAgent = o.userAgent ?? "burnticker-sdk/0.1";
    this.timeoutMs = o.timeoutMs ?? 30_000;
  }

  async request<T>(method: "GET" | "POST", path: string, o: { query?: Record<string, string | number | undefined | null>; body?: unknown } = {}): Promise<T> {
    const qs = o.query ? Object.entries(o.query).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join("&") : "";
    const url = `${this.base}${path}${qs ? `?${qs}` : ""}`;
    const headers: Record<string, string> = { accept: "application/json", "user-agent": this.userAgent };
    if (method === "POST") { headers["content-type"] = "application/json"; headers.origin = this.origin; }
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(url, { method, headers, body: method === "POST" ? JSON.stringify(o.body ?? {}) : undefined, signal: ac.signal });
      let body: unknown = null;
      try { body = await res.json(); } catch { body = null; }
      if (!res.ok) {
        const ra = res.headers?.get("retry-after");
        throw new BurntickerApiError(res.status, body, ra ? Number(ra) : null);
      }
      return body as T;
    } finally { clearTimeout(t); }
  }
  get<T>(path: string, query?: Record<string, string | number | undefined | null>): Promise<T> { return this.request<T>("GET", path, { query }); }
  post<T>(path: string, body: unknown): Promise<T> { return this.request<T>("POST", path, { body }); }
}

/** Unwraps a BurntickerApiError of a given status into a value (e.g. 400 validation answers that carry `problems`). */
export async function orStatus<T, U>(p: Promise<T>, status: number, map: (e: BurntickerApiError) => U): Promise<T | U> {
  try { return await p; } catch (e) { if (e instanceof BurntickerApiError && e.status === status) return map(e); throw e; }
}
