/**
 * THE KEEPER'S HEARTBEAT (second prelaunch audit 2026-10-18 A-7). Every alert this box raises is sent BY this box, so a dead box, a dead
 * network or a keeper that never starts is seen by nobody. When BURNTICKER_STATUS_HEARTBEAT_URL is set (an off-box monitor's ping URL,
 * any https endpoint that takes a GET), the keeper GETs it once per cycle: no body, a 10-second limit, the answer's body never read. The
 * monitor raises its own alarm when the pings stop. The URL may carry the monitor's token, so it is never logged or published; ops.json
 * says only whether one is configured and how the last ping went.
 *
 * A ping that fails is logged once per change of state (failing, then working again) and never stops the keeper.
 *
 * Which cycles ping (review and re-review, 2026-10-18; heartbeatVerdict):
 *   ok     the cycle completed and its errors, if any, are per coin (`$TICKER: …`, a coin's send `<mint> <event>: …`) or the reading
 *          fence's holds. One held coin repeats its error every cycle and has its own alert; it must not turn the monitor red for days.
 *   fail   the cycle itself failed (no report), or every live coin has an error: the keeper runs but does nothing useful. The monitor's
 *          failure signal is sent where it has one (a Healthchecks URL on hc-ping.com plus "/fail"); for any other monitor, nothing.
 *   skip   the cycle completed with an error that is not about one coin (the pair gates, the Derby sampler): no ping this cycle, so a
 *          lasting fault reaches the monitor through its own timeout.
 * A configured URL that already ends in "/fail" is refused (every good ping would report a failure); the keeper then sends nothing.
 */
export const HEARTBEAT_TIMEOUT_MS = 10_000;

export interface HeartbeatState { configured: boolean; lastOkAt: number | null; lastError: string | null; /** the last failed cycle (no good ping for it) */ lastCycleFailedAt?: number | null }

const endsInFail = (u: URL): boolean => /\/fail\/*$/i.test(u.pathname);

/** The monitor's failure URL: Healthchecks (hc-ping.com) takes "/fail" after the ping URL; null for any other monitor. Never "/fail/fail". */
export function heartbeatFailUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname !== "hc-ping.com" && !u.hostname.endsWith(".hc-ping.com")) return null;
    if (!endsInFail(u)) u.pathname = `${u.pathname.replace(/\/+$/, "")}/fail`;
    return u.toString();
  } catch { return null; }
}

/** The ping URL: https only, and never one that already ends in "/fail" (each good ping would report a failure). */
export function heartbeatUrlFromEnv(env: Readonly<Record<string, string | undefined>>): string | null {
  const url = (env.BURNTICKER_STATUS_HEARTBEAT_URL ?? "").trim();
  if (!/^https:\/\/\S+$/.test(url)) return null;
  try { return endsInFail(new URL(url)) ? null : url; } catch { return null; }
}

export type HeartbeatVerdict = "ok" | "fail" | "skip";
/** PURE: what this cycle tells the monitor (see the header). `live` are the coins the cycle worked on. */
export function heartbeatVerdict(report: { errors: readonly string[] } | null | undefined, live: readonly { ticker: string; mint: string }[]): HeartbeatVerdict {
  if (!report) return "fail";
  const errored = new Set<string>();
  let other = false;
  for (const e of report.errors) {
    const coin = live.find((t) => e.startsWith(`$${t.ticker}:`) || e.startsWith(`fence: $${t.ticker}:`) || e.startsWith(`${t.mint.slice(0, 8)} `));
    if (coin) errored.add(coin.mint); else other = true;
  }
  if (live.length && errored.size >= live.length) return "fail";
  return other ? "skip" : "ok";
}

export class Heartbeat {
  readonly state: HeartbeatState;
  private failing = false;
  private readonly url: string | null;
  private readonly fetchImpl: typeof fetch;
  private readonly log?: (s: string) => void;
  constructor(url: string | null, fetchImpl: typeof fetch = fetch, log?: (s: string) => void) {
    this.url = url; this.fetchImpl = fetchImpl; this.log = log;
    this.state = { configured: url !== null, lastOkAt: null, lastError: null, lastCycleFailedAt: null };
  }
  /**
   * One GET per cycle. Never throws; answers whether a good ping was acknowledged. "fail" (or false): the monitor's failure URL where it
   * has one, else nothing; "skip": nothing.
   */
  async beat(now: number, verdict: HeartbeatVerdict | boolean = "ok"): Promise<boolean> {
    if (!this.url) return false;
    const v: HeartbeatVerdict = verdict === true ? "ok" : verdict === false ? "fail" : verdict;
    if (v === "skip") return false;
    if (v === "fail") {
      this.state.lastCycleFailedAt = now;
      const fail = heartbeatFailUrl(this.url);
      if (fail) { try { const r = await this.fetchImpl(fail, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(HEARTBEAT_TIMEOUT_MS) }); try { await r.body?.cancel(); } catch { /* nothing to read */ } } catch { /* the monitor's timeout covers it */ } }
      return false;
    }
    try {
      const r = await this.fetchImpl(this.url, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(HEARTBEAT_TIMEOUT_MS) });
      try { await r.body?.cancel(); } catch { /* nothing to read */ }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      this.state.lastOkAt = now; this.state.lastError = null;
      if (this.failing) { this.failing = false; this.log?.("  [heartbeat] the monitor answers again"); }
      return true;
    } catch (e) {
      // the error text, never the URL (it may carry the monitor's token)
      const msg = String((e as Error)?.message ?? e).split(this.url).join("<the heartbeat URL>").slice(0, 120);
      this.state.lastError = msg;
      if (!this.failing) { this.failing = true; this.log?.(`  [heartbeat] the ping to the monitor failed: ${msg}`); }
      return false;
    }
  }
}

/** The check-in line (ops.json carries the same). */
export function heartbeatLine(h: HeartbeatState | null | undefined, now: number): string | null {
  if (!h) return null;
  if (!h.configured) return "- heartbeat: not configured (set BURNTICKER_STATUS_HEARTBEAT_URL to an off-box monitor's ping URL, so a dead box is noticed)";
  const min = (t: number) => `${Math.round((now - t) / 60_000)} min ago`;
  const failed = h.lastCycleFailedAt ? `; the last failed cycle was ${min(h.lastCycleFailedAt)}` : "";
  if (h.lastError) return `- heartbeat: configured, FAILING (${h.lastError})${h.lastOkAt ? `; the last good ping was ${min(h.lastOkAt)}` : ""}${failed}`;
  return `- heartbeat: configured, ${h.lastOkAt ? `last ping ${min(h.lastOkAt)}` : "no ping sent yet"}${failed}`;
}
