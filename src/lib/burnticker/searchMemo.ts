import { createHash } from "node:crypto";
import { LruMap, jsonBytes } from "@/lib/burnticker/lru";

/**
 * HS-119 (ninth audit addendum): during the publish-115 deploy Polymarket's Gamma API answered 404 for about three minutes, and the
 * search route /v1/polymarket/search (with the launch search that uses it) answered 503 for the whole spell, so the deploy smoke's
 * market search failed. The search now keeps the last good answer for each query, the way /v1/trust keeps its last good copy
 * (trustServe.ts, OP9-1), and serves it on an upstream failure marked stale (`x-search-memo: stale`, `stale: true`). Only with no copy
 * held is the answer an error.
 *
 * Each answer is keyed by the normalised query and the status filter. The copies are kept in memory and in the registry's status table
 * (one row per query plus an index row), at most SEARCH_MEMO_MAX_KEYS queries, the most recently answered kept, and none older than
 * SEARCH_MEMO_MAX_AGE_MS. A copy from before a restart answers while the first read after it fails. A read or write of the registry
 * that fails is ignored: the memory copy still serves.
 */
export const SEARCH_MEMO_MAX_KEYS = 200;
export const SEARCH_MEMO_MAX_AGE_MS = 24 * 3_600_000;
/** The most JSON the memory copies hold together, and the largest one answer that is written to the registry. */
export const SEARCH_MEMO_MAX_BYTES = 16 * 1024 * 1024, SEARCH_MEMO_MAX_ROW_BYTES = 512 * 1024;
/** How long a search waits for Gamma before it serves a held copy (under the proxy's 20 s limit). With nothing held it keeps waiting. */
export const SEARCH_DEADLINE_MS = 12_000;
export const SEARCH_MEMO_INDEX_KEY = "polymarket.search.lastGood.index";
export const SEARCH_MEMO_ROW_PREFIX = "polymarket.search.lastGood:";

/** The memo key of a query: its status and a hash of the query lowercased with its spaces collapsed. */
export function searchMemoKey(query: string, status: string): string {
  const norm = query.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
  return `${status}:${createHash("sha256").update(norm).digest("hex").slice(0, 32)}`;
}

export interface SearchCopy<T = unknown> { at: number; body: T }
export interface SearchMemoRegistry { getStatus(key: string): string | null; setStatus(key: string, value: unknown, now?: number): void; deleteStatus?(key: string): void }
export interface SearchMemoStore<T = unknown> { load(key: string, now?: number): SearchCopy<T> | null; save(key: string, copy: SearchCopy<T>): void; keys(): string[] }

/** A last-good store for search answers: memory first, then the registry's status table. */
export function searchMemoStore<T = unknown>(reg?: SearchMemoRegistry | null, o: { maxKeys?: number; maxAgeMs?: number } = {}): SearchMemoStore<T> {
  const maxKeys = o.maxKeys ?? SEARCH_MEMO_MAX_KEYS, maxAgeMs = o.maxAgeMs ?? SEARCH_MEMO_MAX_AGE_MS;
  const mem = new LruMap<string, SearchCopy<T>>(maxKeys, { maxWeight: SEARCH_MEMO_MAX_BYTES, weigh: (c) => jsonBytes(c.body) });
  // the index: [key, at] pairs, newest first, read from the registry once
  let index: [string, number][] | null = null;
  const readIndex = (): [string, number][] => {
    if (index) return index;
    index = [];
    try {
      const raw = reg?.getStatus(SEARCH_MEMO_INDEX_KEY);
      const j = raw ? (JSON.parse(raw) as unknown) : null;
      if (Array.isArray(j)) for (const e of j) if (Array.isArray(e) && typeof e[0] === "string" && typeof e[1] === "number" && index.length < maxKeys) index.push([e[0], e[1]]);
    } catch { index = []; }
    return index;
  };
  const drop = (key: string) => { try { reg?.deleteStatus ? reg.deleteStatus(SEARCH_MEMO_ROW_PREFIX + key) : reg?.setStatus(SEARCH_MEMO_ROW_PREFIX + key, ""); } catch { /* ignored */ } };
  return {
    load(key, now = Date.now()) {
      const m = mem.get(key);
      if (m) return now - m.at <= maxAgeMs ? m : null;
      if (!reg || !readIndex().some(([k]) => k === key)) return null;
      try {
        const raw = reg.getStatus(SEARCH_MEMO_ROW_PREFIX + key);
        if (!raw) return null;
        const j = JSON.parse(raw) as { at?: unknown; body?: unknown };
        if (typeof j.at !== "number" || j.body === undefined || j.body === null || now - j.at > maxAgeMs) return null;
        const copy = { at: j.at, body: j.body as T };
        mem.set(key, copy);
        return copy;
      } catch { return null; }
    },
    save(key, copy) {
      const held = mem.get(key);
      if (held && held.at >= copy.at) return;
      mem.set(key, copy);
      if (!reg) return;
      const idx = readIndex().filter(([k]) => k !== key);
      idx.unshift([key, copy.at]);
      // the bound: past it the oldest queries leave the index and their rows are removed; a copy past the age bound leaves too
      const kept: [string, number][] = [];
      for (const e of idx) { if (kept.length < maxKeys && copy.at - e[1] <= maxAgeMs) kept.push(e); else drop(e[0]); }
      index = kept;
      try {
        const text = JSON.stringify(copy, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
        if (text.length <= SEARCH_MEMO_MAX_ROW_BYTES) reg.setStatus(SEARCH_MEMO_ROW_PREFIX + key, text, copy.at);
        reg.setStatus(SEARCH_MEMO_INDEX_KEY, JSON.stringify(kept), copy.at);
      } catch { /* the memory copy still serves */ }
    },
    keys() { return reg ? readIndex().map(([k]) => k) : [...mem.keys()].reverse(); },
  };
}

/** The headers of a search answer: a held copy goes out with no-store and its age, so the edge never keeps it. */
export function searchMemoHeaders(stale: boolean, ageMs = 0): Record<string, string> {
  return stale ? { "cache-control": "no-store", "x-search-memo": "stale", age: String(Math.max(0, Math.floor(ageMs / 1000))) } : { "x-search-memo": "fresh" };
}

/**
 * The upstream read with the memo around it: a fresh answer is kept and returned; a failure, or no answer within `deadlineMs` while a
 * copy is held, returns the held copy marked stale; a failure with nothing held throws the upstream's error. Without a held copy the
 * deadline does not apply (the read is waited for, as before).
 */
export async function withSearchMemo<T>(store: SearchMemoStore<T>, key: string, read: () => Promise<T>, o: { now?: () => number; deadlineMs?: number } = {}): Promise<{ body: T; stale: boolean; ageMs: number }> {
  const now = o.now ?? Date.now;
  const p = read().then((body) => { store.save(key, { at: now(), body }); return body; });
  const held = store.load(key, now());
  if (!held) return { body: await p, stale: false, ageMs: 0 };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<"late">((r) => { timer = setTimeout(() => r("late"), o.deadlineMs ?? SEARCH_DEADLINE_MS); });
  try {
    const r = await Promise.race([p, late]);
    if (r !== "late") return { body: r as T, stale: false, ageMs: 0 };
    p.catch(() => { /* a late failure: the held copy was already served */ });
  } catch { /* upstream failed: the held copy answers */ } finally { if (timer) clearTimeout(timer); }
  const copy = store.load(key, now()) ?? held;
  return { body: copy.body, stale: true, ageMs: Math.max(0, now() - copy.at) };
}
