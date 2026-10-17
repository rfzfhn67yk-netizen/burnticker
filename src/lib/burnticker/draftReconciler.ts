import { PublicKey } from "@solana/web3.js";
import { configPda, feePda } from "@/lib/burnReceipts/pda";
import { launchVenueOf, type LaunchExpectation, type LaunchVerifier } from "@/lib/burnticker/launchVerify";
import { DRAFT_GRACE_MS, DRAFT_TTL_MS, inDraftWindow, type Registry, type TokenRow } from "@/lib/burnticker/registry";
import { budgetPhase, isBudgetHold } from "@/lib/burnticker/apiBudget";
import { CREATOR_LAUNCHES_CLOSED_AT_FLAG } from "@/lib/burnticker/launchAvailability";

/**
 * THE DRAFT RECONCILER (AUDIT A C1, 2026-10-15; bounded after the blind review the same day). Before this, a draft went live only when
 * the creator's browser reported its landed create, and a coin created on chain whose browser never confirmed it was lost after 24 h.
 * The keeper now asks the chain, for drafts whose create could still count:
 *
 *   1. the CANDIDATES are drafts and expired drafts with no launch transaction that are not finished (below). Their TokenConfig addresses
 *      are read in ONE getMultipleAccounts per sweep (100 addresses per call). A draft with no TokenConfig costs nothing more.
 *   2. a draft is FINISHED (status drafts.scan.<mint>: done) when nothing more can make it live: no TokenConfig read after its window
 *      closed (the create needs one, and a create after the window is refused), or a complete scan of its history made after the window
 *      closed found no create in the window. Today's 12 abandoned drafts and 5 expired ones are read until their windows close, then never.
 *   3. a TokenConfig owned by burn_receipts: the coin's FEE PDA history is read (prelaunch audit 2026-10-16 F-2; scanAddress below: the
 *      fee PDA is in every create the verifier accepts and in no swap, so a busy coin's history stays a handful of transactions, where
 *      the mint's history grows with every trade). Pages go newest first (`before` cursor kept across sweeps, `until` the newest signature
 *      a finished read saw) down to the draft's creation; the SUCCESSFUL transactions collected are then offered to the verifier the
 *      browser's confirm uses OLDEST FIRST (launchVerify.ts checks the content: this mint's initialize_token or the LaunchLab create,
 *      the TokenConfig locking the draft's rule). The create is among a coin's first fee-PDA transactions, so it is found in one sweep.
 *   4. the sweep's budget is SHARED: pages in per-draft shares (the draft read longest ago first), verifications one per draft per round,
 *      so one busy or padded draft never starves another. A draft whose read found no create backs off (5 min, doubling, up to 6 h);
 *      the sweep runs under the budget phase "drafts" and stops at a budget hold.
 *   5. the first verified create in the window takes the draft live with its signature and block time (registry.takeLiveFromChain; an
 *      expired draft through the append-only revival row). A verified create AFTER the window is never taken here: the draft is finished
 *      and the owner gets one bt-launch-late alert per coin naming the operator script (scripts/burnticker-draft-revive.mts --late), the
 *      only path that takes it live (F-3).
 *
 * Read-only on chain (it signs and sends nothing); a dry run reads and reports and writes nothing.
 */

export const RECONCILE_LOOKBACK_MS = 14 * 86_400_000;
export const RECONCILE_INTERVAL_MS = 5 * 60_000;
export const RECONCILE_STATUS_KEY = "drafts.reconciledAt";
export const SCAN_STATUS_PREFIX = "drafts.scan.";
export const BACKOFF_MIN_MS = 5 * 60_000;
export const BACKOFF_MAX_MS = 6 * 3_600_000;
/** Pages (1,000 signatures each) per sweep, shared out across the due drafts (each gets at least one). */
export const PAGES_PER_SWEEP = 12;
/** Verifications per sweep, handed out one per draft per round (F-2: one busy draft never starves another). */
export const VERIFY_PER_SWEEP = 10;
/** F-3: a create after the window raises this alert once per mint (registry status drafts.late.<mint> remembers it). */
export const LATE_ALERT_KIND = "bt-launch-late";
export const LATE_STATUS_PREFIX = "drafts.late.";
export const REVIVE_SCRIPT = "scripts/burnticker-draft-revive.mts";
/** After the window closes, wait this long (finality, a slow RPC index) before a scan or a missing TokenConfig finishes the draft. */
export const SETTLE_MS = 10 * 60_000;
const BATCH = 100;
const PAGE = 1000;

/** The slice of @solana/web3.js Connection the reconciler reads (tests pass a fake). */
export interface DraftChainReader {
  getMultipleAccountsInfo(keys: PublicKey[], commitment: "confirmed"): Promise<({ owner: { toBase58(): string } | PublicKey; data: Uint8Array } | null)[]>;
  getSignaturesForAddress(address: PublicKey, opts: { limit: number; before?: string; until?: string }, commitment: "confirmed"): Promise<{ signature: string; err: unknown; blockTime?: number | null }[]>;
}

export interface ReconcileDeps {
  registry: Registry;
  reader: DraftChainReader;
  verifier: LaunchVerifier;
  burnProgramId: string;
  now: () => number;
  log: (line: string) => void;
  dryRun: boolean;
  intervalMs?: number;
  lookbackMs?: number;
  /** the keeper's environment: BURNTICKER_CREATOR_LAUNCHES_CLOSED_AT is read from it (the keeper passes process.env explicitly) */
  env: Record<string, string | undefined>;
}

/**
 * AUDIT A C1 review (1): when creator launches closed, as far as the registry knows: the explicit flag, else the moment the web host first
 * saw launches closed (api/handlers.ts launchesClosedAt writes registry status launches.closedAt; it clears it while launches are open).
 * null: open, or no closure recorded. The keeper reads it this way because its own environment does not carry the web's launch switch.
 */
export function recordedClosure(reg: Pick<Registry, "getStatus">, env: Record<string, string | undefined> = process.env): number | null {
  const flag = Date.parse((env[CREATOR_LAUNCHES_CLOSED_AT_FLAG] ?? "").trim());
  if (Number.isFinite(flag)) return flag;
  const seen = Number(reg.getStatus("launches.closedAt") || NaN);
  return Number.isFinite(seen) && seen > 0 ? seen : null;
}

export interface ReconcileReport {
  skipped: boolean;
  checked: number;
  /** drafts taken live (or, on a dry run, that would be) */
  takenLive: { mint: string; ticker: string; launchTx: string; blockTimeMs: number; revived: boolean; withinWindow: boolean }[];
  /** TokenConfig on chain, no create the verifier accepted yet */
  onChainNoCreate: string[];
  /** drafts finished this sweep (never read again) */
  finished: string[];
  /** F-3: creates found that landed after their draft's window (not taken live; one bt-launch-late alert each) */
  late: { mint: string; ticker: string; launchTx: string; blockTimeMs: number }[];
  pages: number;
  verified: number;
  errors: string[];
}

/**
 * A draft's read state (registry status drafts.scan.<mint>). Review M2: CURSORS, never the history itself, so no transaction is ever
 * dropped (1,000+ dust transfers to the fee PDA cannot push the real create out of a capped list).
 *   disc   a history read part way down: the `before` cursor of each page read so far (newest page first; null = the top), the cursor
 *          of the next page, the lower bound (`until`) and the newest signature seen
 *   walk   a finished read being verified OLDEST FIRST: the pages' cursors (the last one is the oldest page, popped when done), their
 *          lower bound, and `through`, the last transaction of the oldest page already judged
 *   until  the newest signature a finished read saw (the next read stops there); `lastAt` when it was last read; `late` the create found
 *          after the window (F-3)
 */
/**
 * One page of a finished read, PINNED at both ends (re-review blocker: the newest page used to be re-read as "the newest 1,000 rows now",
 * so new transactions pushed the create off its bottom): `before` the exclusive cursor it is read below, `head` the newest page's own top
 * row (judged too; null for older pages), `last` its oldest row. Re-read, a page is cut at `last`, whatever arrived since.
 */
interface PageRef { before: string; head: string | null; last: string }
interface Disc { pages: PageRef[]; next: string | null; until: string | null; top: string | null; emptyTries?: number }
interface Walk { pages: PageRef[]; until: string | null; through: string | null }
interface ScanState { done?: boolean; until?: string; nextAt?: number; backoffMs?: number; disc?: Disc; walk?: Walk; lastAt?: number; late?: string }
const windowEnd = (t: TokenRow) => t.createdAt + DRAFT_TTL_MS + DRAFT_GRACE_MS;

export async function reconcileDrafts(d: ReconcileDeps): Promise<ReconcileReport> {
  const out: ReconcileReport = { skipped: false, checked: 0, takenLive: [], onChainNoCreate: [], finished: [], late: [], pages: 0, verified: 0, errors: [] };
  const reg = d.registry, now = d.now();
  const last = Number(reg.getStatus(RECONCILE_STATUS_KEY) ?? 0);
  if (Number.isFinite(last) && last > 0 && now - last < (d.intervalMs ?? RECONCILE_INTERVAL_MS)) { out.skipped = true; return out; }
  const load = (m: string): ScanState => { try { return JSON.parse(reg.getStatus(SCAN_STATUS_PREFIX + m) ?? "{}") as ScanState; } catch { return {}; } };
  const save = (m: string, s: ScanState) => { if (!d.dryRun) reg.setStatus(SCAN_STATUS_PREFIX + m, JSON.stringify(s), now); };
  const drafts = reg.unlaunchedDrafts(now - (d.lookbackMs ?? RECONCILE_LOOKBACK_MS)).filter((t) => !load(t.mint).done);
  out.checked = drafts.length;
  if (!d.dryRun) reg.setStatus(RECONCILE_STATUS_KEY, String(now), now);
  if (!drafts.length) return out;
  const prevPhase = budgetPhase("drafts");
  try {
    const program = new PublicKey(d.burnProgramId);
    const withConfig: TokenRow[] = [];
    for (let i = 0; i < drafts.length; i += BATCH) {
      const chunk = drafts.slice(i, i + BATCH).flatMap((t) => { try { return [{ t, cfg: configPda(program, new PublicKey(t.mint)) }]; } catch { return []; } });
      let infos: Awaited<ReturnType<DraftChainReader["getMultipleAccountsInfo"]>>;
      try { infos = await d.reader.getMultipleAccountsInfo(chunk.map((c) => c.cfg), "confirmed"); }
      catch (e) { if (isBudgetHold(e)) throw e; out.errors.push(`TokenConfig read failed: ${(e as Error).message.slice(0, 120)}`); continue; }
      chunk.forEach((c, k) => {
        const a = infos[k];
        if (a && a.owner.toBase58() === d.burnProgramId) withConfig.push(c.t);
        // no TokenConfig read after the window closed: a create in the window is impossible now (it needs one), so the draft is finished
        else if (now > windowEnd(c.t) + SETTLE_MS) { save(c.t.mint, { ...load(c.t.mint), done: true }); out.finished.push(c.t.mint); }
      });
    }
    // F-2: the drafts due this sweep, the one read longest ago first, so the page budget rotates across sweeps
    // review M1: a draft whose window is still open (it can still go live) goes before one kept only to be finished
    const open = (t: TokenRow) => (now <= windowEnd(t) + SETTLE_MS ? 0 : 1);
    const due = withConfig.map((t) => ({ t, st: load(t.mint) })).filter((x) => !(x.st.nextAt && now < x.st.nextAt)).sort((a, b) => open(a.t) - open(b.t) || (a.st.lastAt ?? 0) - (b.st.lastAt ?? 0));
    // 1. PAGES: each due draft's fee-PDA history, in per-draft shares of the sweep's page budget, down to the bottom of its window
    const share = Math.max(1, Math.floor(PAGES_PER_SWEEP / Math.max(1, due.length)));
    const ready: { t: TokenRow; st: ScanState }[] = [];
    const oldest = new Map<string, Sig[]>();   // the oldest page a read just finished on, so the walk does not read it twice
    for (const x of due) {
      if (x.st.walk && !Array.isArray(x.st.walk.pages)) delete x.st.walk;   // an older state shape: read again
      if (x.st.walk?.pages.length) { x.st.lastAt = now; ready.push(x); continue; }   // a finished read still being verified: no new pages
      if (out.pages >= PAGES_PER_SWEEP) break;
      x.st.lastAt = now;
      try { if (await page(d, x.t, x.st, out, Math.min(share, PAGES_PER_SWEEP - out.pages), oldest)) ready.push(x); else save(x.t.mint, x.st); }
      catch (e) { if (isBudgetHold(e)) throw e; out.errors.push(`$${x.t.ticker}: ${(e as Error).message.slice(0, 120)}`); save(x.t.mint, x.st); }
    }
    const walkers = new Map(ready.map((x) => [x.t, walker(d, x.t, x.st, out, oldest.get(x.t.mint) ?? null)] as const));
    // 2. VERIFY: round robin, one transaction per draft per round, each draft's OLDEST unchecked transaction first
    const active = new Set(ready), found = new Map<TokenRow, { signature: string; blockTimeMs: number }>(), stuck = new Set<TokenRow>();
    while (active.size && out.verified < VERIFY_PER_SWEEP) {
      for (const x of [...active]) {
        if (out.verified >= VERIFY_PER_SWEEP) break;
        const w = walkers.get(x.t)!;
        let head: string | null;
        try { head = await w.head(); }
        catch (e) { if (isBudgetHold(e)) throw e; out.errors.push(`$${x.t.ticker}: ${(e as Error).message.slice(0, 120)}`); stuck.add(x.t); active.delete(x); continue; }
        if (head === null) { active.delete(x); continue; }
        out.verified++;
        let v: Awaited<ReturnType<LaunchVerifier["verify"]>>;
        try { v = await d.verifier.verify(head, expectOf(d, x.t)); }
        catch (e) { if (isBudgetHold(e)) throw e; out.errors.push(`$${x.t.ticker}: ${(e as Error).message.slice(0, 120)}`); stuck.add(x.t); active.delete(x); continue; }
        if (v.ok) { found.set(x.t, { signature: head, blockTimeMs: v.blockTimeMs }); active.delete(x); continue; }
        // a refusal for the transaction's CONTENT is final; so is a 409 (a pair not set up) once the window and its settle time have
        // passed (review M1: an abandoned pair side finishes). Anything else (RPC lag, an account not shown yet, a pair not set up yet
        // inside the window) is retried from the same transaction after a backoff, so the oldest-first order is never skipped
        if ((v.status === 422 && !v.missing) || (v.status === 409 && now > windowEnd(x.t) + SETTLE_MS)) w.consume(head); else { stuck.add(x.t); active.delete(x); }
      }
    }
    // 3. OUTCOMES
    for (const x of ready) {
      const { t, st } = x, hit = found.get(t);
      if (!hit) {
        // unchecked transactions left: the next sweep goes on, after a backoff when the head could not be judged (review M1)
        if (st.walk?.pages.length) { if (stuck.has(t)) backoff(st, now); save(t.mint, st); continue; }
        delete st.walk;
        out.onChainNoCreate.push(t.mint);
        if (now > windowEnd(t) + SETTLE_MS) { st.done = true; out.finished.push(t.mint); d.log(`  [drafts] $${t.ticker} ${t.mint}: TokenConfig on chain, no create found: finished`); }
        else backoff(st, now);
        save(t.mint, st);
        continue;
      }
      // F-3: a create after the draft's window is never taken live here: the owner is told once, with the operator's path
      if (hit.blockTimeMs > windowEnd(t)) {
        out.late.push({ mint: t.mint, ticker: t.ticker, launchTx: hit.signature, blockTimeMs: hit.blockTimeMs });
        out.finished.push(t.mint);
        d.log(`  [drafts] $${t.ticker} ${t.mint}: created on chain at ${new Date(hit.blockTimeMs).toISOString()}, after its draft window: not taken live (operator: ${REVIVE_SCRIPT} --late)`);
        if (!d.dryRun) { alertLaunchLate(reg, t, hit.signature, hit.blockTimeMs, now); save(t.mint, { done: true, late: hit.signature }); }
        continue;
      }
      const closedAt = recordedClosure(reg, d.env);
      // re-review 2: a closure is not final (launches may reopen, or a wrong closure time is corrected): back off, never finish
      if (closedAt !== null && hit.blockTimeMs > closedAt) { out.errors.push(`$${t.ticker}: its create landed after creator launches closed; not taken live`); backoff(st, now); save(t.mint, st); continue; }
      let revived = t.status === "expired", withinWindow = true, changed = true;
      if (!d.dryRun) {
        try { const r = reg.takeLiveFromChain(t.mint, hit.signature, t.poolId, hit.blockTimeMs, { source: "reconciler", note: "the browser never confirmed this launch; the keeper read it from the chain" }, now); revived = r.revived; withinWindow = r.withinWindow; changed = r.changed; }
        catch (e) { out.errors.push(`$${t.ticker}: ${(e as Error).message.slice(0, 120)}`); continue; }
        save(t.mint, { done: true });
        // review (5): alert only when this sweep took it live (a browser confirm that won the race is not news)
        if (changed) reg.recordAlert({ kind: "draft-reconciled", key: `draft-reconciled:${t.mint}`, text: `$${t.ticker} was created on chain but never confirmed by the browser. The keeper verified its create (${hit.signature.slice(0, 12)}…) and took it live${revived ? " (the draft had been marked expired)" : ""}.`, meta: { mint: t.mint, launchTx: hit.signature, revived, withinWindow } }, now);
      }
      if (changed) out.takenLive.push({ mint: t.mint, ticker: t.ticker, launchTx: hit.signature, blockTimeMs: hit.blockTimeMs, revived, withinWindow });
      if (changed) d.log(`  [drafts] $${t.ticker} ${t.mint}: ${d.dryRun ? "would take" : "taken"} live from the chain, create ${hit.signature} at ${new Date(hit.blockTimeMs).toISOString()}${revived ? " (was expired)" : ""}`);
    }
  } catch (e) {
    if (!isBudgetHold(e)) throw e;
    out.errors.push(`budget hold: ${(e as Error).message.slice(0, 120)}`);
  } finally { budgetPhase(prevPhase); }
  return out;
}

function backoff(st: ScanState, now: number): void {
  const b = Math.min(BACKOFF_MAX_MS, Math.max(BACKOFF_MIN_MS, (st.backoffMs ?? BACKOFF_MIN_MS / 2) * 2));
  st.backoffMs = b; st.nextAt = now + b;
}

const expectOf = (d: ReconcileDeps, t: TokenRow): LaunchExpectation => ({ mint: t.mint, creator: t.creator, draftCreatedAtMs: t.createdAt, rulesSha: t.rulesSha, venue: launchVenueOf(t, d.registry.pairOf(t.mint)) });

/**
 * F-2: the address whose history holds the create. The coin's fee PDA (["fee", mint], the burn pool) is an account of initialize_token
 * (its fee_vault: the pair-curve create and the LaunchLab lock) and LaunchLab's recorded creator in initialize_v2 (the LaunchLab create,
 * a separate transaction since 2026-10-15 that does not carry the TokenConfig). No swap names it, on either venue: a coin with 1,000
 * trades has a handful of fee-PDA transactions. The mint (every swap) and the LaunchLab pool (every swap) are not read.
 */
export const scanAddress = (programId: PublicKey, mint: string): PublicKey => feePda(programId, new PublicKey(mint));

const fetchPage = (d: ReconcileDeps, address: PublicKey, before: string | null, until: string | null) =>
  d.reader.getSignaturesForAddress(address, { limit: PAGE, ...(before ? { before } : {}), ...(until ? { until } : {}) }, "confirmed");

/**
 * One sweep's share of a draft's history read (review M2): pages newest first from the saved cursor down to `until` (the newest signature
 * a finished read saw) or to the bottom of the draft's window, keeping only each page's cursor. Returns true when the read reached the
 * bottom (the cursors become `st.walk`, verified oldest first); false when pages remain (the cursors are kept for the next sweep).
 */
type Sig = Awaited<ReturnType<DraftChainReader["getSignaturesForAddress"]>>[number];
async function page(d: ReconcileDeps, t: TokenRow, st: ScanState, out: ReconcileReport, pages: number, oldest: Map<string, Sig[]>): Promise<boolean> {
  const address = scanAddress(new PublicKey(d.burnProgramId), t.mint), lo = t.createdAt - 60_000;
  const disc: Disc = st.disc && Array.isArray(st.disc.pages) ? st.disc : { pages: [], next: null, until: st.until ?? null, top: null };
  st.disc = disc;
  for (let k = 0; k < pages; k++) {
    const rows = await fetchPage(d, address, disc.next, disc.until);
    out.pages++;
    // re-review Low 1: an empty page below a cursor may be a lagging node; it counts as the bottom only when a later sweep agrees
    if (!rows.length && disc.next !== null && !disc.emptyTries) { disc.emptyTries = 1; return false; }
    delete disc.emptyTries;
    if (!disc.pages.length && disc.next === null) disc.top = rows[0]?.signature ?? disc.until;
    if (rows.length) {
      const last = rows[rows.length - 1].signature;
      disc.pages.push(disc.next === null ? { before: rows[0].signature, head: rows[0].signature, last } : { before: disc.next, head: null, last });
    }
    const bottom = rows.length < PAGE || rows.some((r) => typeof r.blockTime === "number" && r.blockTime * 1000 < lo);
    if (bottom) {
      if (rows.length) oldest.set(t.mint, rows);
      st.walk = { pages: disc.pages, until: disc.until, through: null };
      if (disc.top) st.until = disc.top;
      delete st.disc;
      return true;
    }
    disc.next = rows[rows.length - 1].signature;
  }
  return false;
}

/**
 * Review M2, re-review blocker: the oldest unjudged transaction of a finished read, page by page from the oldest page, each re-read by
 * its pinned cursor and cut at its own oldest row (once per sweep), skipping failed transactions and those before the draft. `consume`
 * marks the head judged; an exhausted page is dropped from the walk. A page the node does not serve in full, or a judged transaction it
 * no longer shows, throws: the draft backs off and the walk resumes from the same place, never from the start.
 */
function walker(d: ReconcileDeps, t: TokenRow, st: ScanState, out: ReconcileReport, first: Sig[] | null): { head(): Promise<string | null>; consume(sig: string): void } {
  const address = scanAddress(new PublicKey(d.burnProgramId), t.mint), lo = t.createdAt - 60_000;
  const judgeable = (got: Sig[]) => got.filter((r) => (r.err === null || r.err === undefined) && !(typeof r.blockTime === "number" && r.blockTime * 1000 < lo)).map((r) => r.signature).reverse();
  let rows: string[] | null = first ? judgeable(first) : null;
  return {
    async head() {
      const w = st.walk;
      while (w && w.pages.length) {
        const pg = w.pages[w.pages.length - 1];
        if (rows === null) {
          let got: Sig[] = [];
          if (pg.last !== pg.head) {
            const fetched = await fetchPage(d, address, pg.before, w.until);
            out.pages++;
            const end = fetched.findIndex((r) => r.signature === pg.last);
            if (end < 0) throw new Error("a page of the fee PDA's history was not served in full just now; it is read again later");
            got = fetched.slice(0, end + 1);
          }
          rows = [...judgeable(got), ...(pg.head ? [pg.head] : [])];
        }
        const at = w.through ? rows.indexOf(w.through) + 1 : 0;
        if (w.through && at === 0) throw new Error("a transaction already judged is missing from its page just now; it is read again later");
        if (at < rows.length) return rows[at];
        w.pages.pop(); w.through = null; rows = null;
      }
      return null;
    },
    // re-review Low 2: progress resets the backoff
    consume(sig: string) { if (st.walk) st.walk.through = sig; delete st.backoffMs; },
  };
}

/** F-3: the owner hears once per coin that a create landed after its draft's window, with the operator's command to take it live. */
export function alertLaunchLate(reg: Pick<Registry, "getStatus" | "setStatus" | "recordAlert">, t: Pick<TokenRow, "mint" | "ticker">, launchTx: string, blockTimeMs: number, now: number): boolean {
  const key = LATE_STATUS_PREFIX + t.mint;
  if (reg.getStatus(key)) return false;
  reg.setStatus(key, launchTx, now);
  reg.recordAlert({ kind: LATE_ALERT_KIND, key: `${LATE_ALERT_KIND}:${t.mint}`, text: `$${t.ticker} was created on chain at ${new Date(blockTimeMs).toISOString()}, after its draft's 24-hour window, so it was not taken live. Its create is ${launchTx}. To take it live anyway (recorded as late): ${REVIVE_SCRIPT} --mint ${t.mint} --tx ${launchTx} --late --note "<why>" --apply`, meta: { mint: t.mint, launchTx, blockTimeMs } }, now);
  return true;
}

/**
 * THE OPERATOR'S PATH (scripts/burnticker-draft-revive.mts; AUDIT A C1 (4), review (1)): verify `launchTx` on chain for this draft and,
 * with `apply`, take it live. A create after the draft's window needs `late` (it is recorded in draft_revivals with within_window 0).
 */
export async function reviveDraft(reg: Registry, verifier: LaunchVerifier, o: { mint: string; launchTx: string; note: string; late: boolean; apply: boolean }): Promise<{ ok: true; applied: boolean; baselineAt: string; withinWindow: boolean } | { ok: false; reason: string }> {
  const t = reg.token(o.mint);
  if (!t) return { ok: false, reason: `no coin with mint ${o.mint}` };
  if (t.status !== "draft" && t.status !== "expired") return { ok: false, reason: `$${t.ticker} is ${t.status}; only a draft or an expired draft is taken live` };
  if (!o.note.trim()) return { ok: false, reason: "a revival needs --note: one plain sentence saying why" };
  const v = await verifier.verify(o.launchTx, { mint: o.mint, creator: t.creator, draftCreatedAtMs: t.createdAt, rulesSha: t.rulesSha, venue: launchVenueOf(t, reg.pairOf(o.mint)) });
  if (!v.ok) return { ok: false, reason: `refused (${v.status}): ${v.reason}` };
  const withinWindow = inDraftWindow(t.createdAt, v.blockTimeMs), baselineAt = new Date(v.blockTimeMs).toISOString();
  if (!withinWindow && !o.late) return { ok: false, reason: `the create landed at ${baselineAt}, after the draft's 24-hour window: pass --late to take it live anyway (it is recorded as late)` };
  if (!o.apply) return { ok: true, applied: false, baselineAt, withinWindow };
  reg.takeLiveFromChain(o.mint, o.launchTx, t.poolId, v.blockTimeMs, { source: "operator", note: o.note.trim(), late: o.late });
  return { ok: true, applied: true, baselineAt, withinWindow };
}
