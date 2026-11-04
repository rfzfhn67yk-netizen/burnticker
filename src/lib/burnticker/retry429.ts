/**
 * ASK AGAIN AFTER A 429 (2026-10-16 prelaunch audit F-21). The sign card records each landed launch with the launch route; a 429 there
 * (the client's confirm bucket spent) used to stop the card with a sentence, although the coin was already on chain. This wraps the card's
 * fetch: a 429 is asked again after its Retry-After (or the body's retryAfterSec), at most RETRY429_TRIES times, each wait capped at
 * RETRY429_MAX_WAIT_MS; anything else, and the last 429, is handed back unchanged for the card's own sentence. Client-safe.
 */
export const RETRY429_TRIES = 3;
export const RETRY429_MAX_WAIT_MS = 30_000;
const DEFAULT_WAIT_MS = 5_000;

type Resp = { ok: boolean; status: number; headers: { get(name: string): string | null }; json(): Promise<unknown> };

/** The wait a 429 asks for: Retry-After in seconds, else the body's retryAfterSec, else five seconds; capped. */
export function waitFor429(r: Pick<Resp, "headers">, body: unknown): number {
  const h = Number(r.headers.get("retry-after"));
  const b = Number((body as { retryAfterSec?: unknown } | null)?.retryAfterSec);
  const sec = Number.isFinite(h) && h > 0 ? h : Number.isFinite(b) && b > 0 ? b : DEFAULT_WAIT_MS / 1000;
  return Math.min(RETRY429_MAX_WAIT_MS, Math.ceil(sec * 1000));
}

export function retry429<A extends unknown[], R extends Resp>(fetchFn: (...a: A) => Promise<R>, o: { tries?: number; sleep?: (ms: number) => Promise<void> } = {}): (...a: A) => Promise<R> {
  const tries = o.tries ?? RETRY429_TRIES;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  return async (...a: A): Promise<R> => {
    for (let i = 0; ; i++) {
      const r = await fetchFn(...a);
      if (r.status !== 429 || i >= tries) return r;
      // the body is read to find the wait; the answer handed on is the next one, so this one's body is not needed again
      const body = await r.json().catch(() => null);
      await sleep(waitFor429(r, body));
    }
  };
}
