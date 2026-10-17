import crypto from "node:crypto";

/**
 * ONE PREPARE PER DRAFT (audit 2026-10-15 M2). A double click, or the same request sent again after the edge gave up at 90 to 100 s,
 * used to make a second draft, take a second set of bank keys and pin a second metadata file. The launch page now sends an
 * `idempotencyKey` per draft; the first request with a key runs, every later one with the same key (from the same creator, with the same
 * body) waits for it and gets the same answer. Only a successful answer is kept (15 minutes, in this process's memory, never on disk: a
 * bank key's secret rides in it); a refusal is forgotten at once, so pressing Launch again after a refusal runs again. The same key with
 * a different body is refused.
 */
export const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_-]{16,80}$/;
export const IDEMPOTENCY_REUSED = "This launch request reused an earlier request's key with different details. Reload the page and press Launch again.";

/** The fingerprint of a request body: everything except the key itself and the page's timing counters. */
export function bodyFingerprint(body: Record<string, unknown>): string {
  const { idempotencyKey: _k, timings: _t, ...rest } = body;
  void _k; void _t;
  return crypto.createHash("sha256").update(JSON.stringify(rest)).digest("hex");
}

export class IdempotentRuns {
  private runs = new Map<string, { at: number; hash: string; res: Promise<Response> }>();
  private ttlMs: number; private max: number;
  constructor(o: { ttlMs?: number; max?: number } = {}) { this.ttlMs = o.ttlMs ?? 15 * 60_000; this.max = o.max ?? 500; }
  get size(): number { return this.runs.size; }
  /**
   * Runs `make` once per key; `key` null runs it every time. Each caller gets its own copy of the answer. `replayable` (review
   * 2026-10-15 item 4) is asked before a kept answer is handed out again: false drops it and runs `make` afresh (a draft that has since
   * gone live is never handed out as a bundle to sign again).
   */
  async run(key: string | null, hash: string, make: () => Promise<Response>, now = Date.now(), replayable?: (cached: Response) => Promise<boolean> | boolean): Promise<Response> {
    if (!key) return make();
    for (const [k, e] of this.runs) if (now - e.at > this.ttlMs) this.runs.delete(k);
    const had = this.runs.get(key);
    if (had) {
      if (had.hash !== hash) return new Response(JSON.stringify({ error: IDEMPOTENCY_REUSED, code: "idempotency-key-reused" }), { status: 409, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
      const cached = await had.res;
      let ok = true;
      if (replayable && cached.status === 200) { try { ok = await replayable(cached.clone()); } catch { ok = false; } }
      if (ok) return cached.clone();
      if (this.runs.get(key) === had) this.runs.delete(key);
      return this.run(key, hash, make, now);
    }
    while (this.runs.size >= this.max) this.runs.delete(this.runs.keys().next().value as string);
    const res = make().then((r) => { if (r.status !== 200) this.runs.delete(key); return r; }, (e) => { this.runs.delete(key); throw e; });
    this.runs.set(key, { at: now, hash, res });
    return (await res).clone();
  }
}
