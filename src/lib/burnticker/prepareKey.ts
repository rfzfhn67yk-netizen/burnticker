/**
 * THE LAUNCH PAGE'S PREPARE KEY (audit 2026-10-15 M2; review item 1). One key per draft revision ("draft_<random>", plus "_a"/"_b" for
 * the two posts of a matchup). If the server ever answers `idempotency-key-reused` (the same key with a different body), the page starts
 * a new key for this draft and sends the request once more, so a press is never stuck on a refusal for the key's 15 minutes. Client-safe.
 */
export const IDEMPOTENCY_REUSED_CODE = "idempotency-key-reused";

export function newPrepareKey(rand: () => string = defaultRandom): string { return `draft_${rand()}`; }
function defaultRandom(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  return typeof c?.randomUUID === "function" ? c.randomUUID().replace(/-/g, "") : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}
/** The body's key moved to a new base, keeping its side suffix ("draft_old_a" → "draft_new_a"). */
export function withNewBase(key: string, base: string): string {
  const m = /^draft_[A-Za-z0-9]+(.*)$/.exec(key);
  return m ? `${base}${m[1]}` : base;
}
type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<Response>;
/** A fetch that, on `idempotency-key-reused`, asks `rotate()` for a new base key and sends the same request once more under it. */
export function keyRotatingFetch(fetchFn: FetchLike, rotate: () => string): FetchLike {
  return async (url, init) => {
    const r = await fetchFn(url, init);
    if (r.status !== 409 || !init?.body) return r;
    const j = await r.clone().json().catch(() => null) as { code?: string } | null;
    if (j?.code !== IDEMPOTENCY_REUSED_CODE) return r;
    let body: Record<string, unknown>;
    try { body = JSON.parse(init.body) as Record<string, unknown>; } catch { return r; }
    if (typeof body.idempotencyKey !== "string") return r;
    return fetchFn(url, { ...init, body: JSON.stringify({ ...body, idempotencyKey: withNewBase(body.idempotencyKey, rotate()) }) });
  };
}
