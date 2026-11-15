/**
 * ONLY THE LATEST ANSWER COUNTS (ChatGPT launch-intent audit 5, items 14 and 16). Every picker on the launch page asks the server for
 * something (a league's teams, a league's games, a race list, a market search, an image preview) and the creator can change the question
 * before the answer arrives. A `Latest` hands out a token per request; an answer is applied only while its token is the newest one, and
 * `cancel()` (a removed image, a cleared league) makes every outstanding answer stale. Client-safe, no timers.
 */
export interface Latest { next(): number; isCurrent(token: number): boolean; cancel(): void }

export function createLatest(): Latest {
  let seq = 0;
  return { next: () => ++seq, isCurrent: (t) => t === seq, cancel: () => { seq++; } };
}

/** Runs `request` and applies its answer with `apply` only if no newer request (or a cancel) came first. Resolves to whether it applied. */
export async function applyLatest<T>(l: Latest, request: () => Promise<T>, apply: (v: T) => void, onError?: (e: unknown) => void): Promise<boolean> {
  const t = l.next();
  try {
    const v = await request();
    if (!l.isCurrent(t)) return false;
    apply(v);
    return true;
  } catch (e) {
    if (l.isCurrent(t) && onError) onError(e);
    return false;
  }
}
