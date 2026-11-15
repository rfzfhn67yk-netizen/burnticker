/**
 * ONE ANSWER PER WALLET (audit 2026-10-15 F7). /burnticker/me reads a wallet's coins and, separately, its weekly summary. Switching
 * wallets while a read was in flight let the older answer land last and render under the new wallet. A read is now tied to the key it
 * was asked for: a newer read cancels the older one (its answer is dropped, whatever order the network answers in), and the page shows a
 * kept answer only while its key is still the one on screen (`shownFor`). Client-safe, no React.
 */
export type ReadResult<T> = { key: string; ok: true; value: T } | { key: string; ok: false; error: string };

/** Starts a read for `key`; returns the cancel function (call it when the key changes or the page unmounts). */
export function readLatest<T>(key: string, load: (signal: AbortSignal) => Promise<T>, done: (r: ReadResult<T>) => void): () => void {
  const ctl = new AbortController();
  let live = true;
  load(ctl.signal).then((value) => { if (live) done({ key, ok: true, value }); }, (e) => { if (live && !ctl.signal.aborted) done({ key, ok: false, error: String((e as Error)?.message ?? e) }); });
  return () => { live = false; ctl.abort(); };
}

/** The kept answer only when it belongs to the key on screen now. */
export function shownFor<T>(slot: { key: string; value: T } | null, key: string): T | null {
  return slot && key && slot.key === key ? slot.value : null;
}
