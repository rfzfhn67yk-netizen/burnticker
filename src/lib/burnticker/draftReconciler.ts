import { PublicKey } from "@solana/web3.js";
import { configPda } from "@/lib/burnReceipts/pda";
import { launchVenueOf, type LaunchVerifier } from "@/lib/burnticker/launchVerify";
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
 *   3. a TokenConfig owned by burn_receipts: the mint's signatures are scanned page by page (newest first, `before` cursor kept across
 *      sweeps, `until` the newest signature a finished scan saw), and only SUCCESSFUL transactions whose block time falls in the draft's
 *      window go to the verifier the browser's confirm uses (launchVerify.ts checks the content: this mint's initialize_token or the
 *      LaunchLab create, the TokenConfig locking the draft's rule). No positional cap: every in-window transaction is a candidate.
 *   4. a draft whose scan found no create backs off (5 min, doubling, up to 6 h); pages and verifications are capped PER SWEEP; the sweep
 *      runs under the budget phase "drafts" and stops at a budget hold.
 *   5. the first verified create in the window takes the draft live with its signature and block time (registry.takeLiveFromChain; an
 *      expired draft through the append-only revival row). A create after the window is never taken here: only the operator script
 *      (scripts/burnticker-draft-revive.mts --late) does that.
 *
 * Read-only on chain (it signs and sends nothing); a dry run reads and reports and writes nothing.
 */

export const RECONCILE_LOOKBACK_MS = 14 * 86_400_000;
export const RECONCILE_INTERVAL_MS = 5 * 60_000;
export const RECONCILE_STATUS_KEY = "drafts.reconciledAt";
export const SCAN_STATUS_PREFIX = "drafts.scan.";
export const BACKOFF_MIN_MS = 5 * 60_000;
export const BACKOFF_MAX_MS = 6 * 3_600_000;
export const PAGES_PER_SWEEP = 6;
export const VERIFY_PER_SWEEP = 10;
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
  pages: number;
  verified: number;
  errors: string[];
}

interface ScanState { done?: boolean; before?: string; top?: string; until?: string; nextAt?: number; backoffMs?: number }
const windowEnd = (t: TokenRow) => t.createdAt + DRAFT_TTL_MS + DRAFT_GRACE_MS;

export async function reconcileDrafts(d: ReconcileDeps): Promise<ReconcileReport> {
  const out: ReconcileReport = { skipped: false, checked: 0, takenLive: [], onChainNoCreate: [], finished: [], pages: 0, verified: 0, errors: [] };
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
    for (const t of withConfig) {
      const st = load(t.mint);
      if (st.nextAt && now < st.nextAt) continue;
      if (out.pages >= PAGES_PER_SWEEP || out.verified >= VERIFY_PER_SWEEP) break;
      let found: { signature: string; blockTimeMs: number } | null = null;
      try { found = await scan(d, t, st, out, now); }
      catch (e) { if (isBudgetHold(e)) throw e; out.errors.push(`$${t.ticker}: ${(e as Error).message.slice(0, 120)}`); continue; }
      if (!found) {
        if (st.before) { save(t.mint, st); continue; }   // the scan goes on next sweep from its cursor
        out.onChainNoCreate.push(t.mint);
        if (now > windowEnd(t) + SETTLE_MS) { st.done = true; out.finished.push(t.mint); d.log(`  [drafts] $${t.ticker} ${t.mint}: TokenConfig on chain, no create in its window: finished`); }
        else { const b = Math.min(BACKOFF_MAX_MS, Math.max(BACKOFF_MIN_MS, (st.backoffMs ?? BACKOFF_MIN_MS / 2) * 2)); st.backoffMs = b; st.nextAt = now + b; }
        save(t.mint, st);
        continue;
      }
      const closedAt = recordedClosure(reg, d.env);
      // re-review 2: a closure is not final (launches may reopen, or a wrong closure time is corrected): back off, never finish
      if (closedAt !== null && found.blockTimeMs > closedAt) { out.errors.push(`$${t.ticker}: its create landed after creator launches closed; not taken live`); const b = Math.min(BACKOFF_MAX_MS, Math.max(BACKOFF_MIN_MS, (st.backoffMs ?? BACKOFF_MIN_MS / 2) * 2)); save(t.mint, { ...st, backoffMs: b, nextAt: now + b }); continue; }
      let revived = t.status === "expired", withinWindow = true, changed = true;
      if (!d.dryRun) {
        try { const r = reg.takeLiveFromChain(t.mint, found.signature, t.poolId, found.blockTimeMs, { source: "reconciler", note: "the browser never confirmed this launch; the keeper read it from the chain" }, now); revived = r.revived; withinWindow = r.withinWindow; changed = r.changed; }
        catch (e) { out.errors.push(`$${t.ticker}: ${(e as Error).message.slice(0, 120)}`); continue; }
        save(t.mint, { done: true });
        // review (5): alert only when this sweep took it live (a browser confirm that won the race is not news)
        if (changed) reg.recordAlert({ kind: "draft-reconciled", key: `draft-reconciled:${t.mint}`, text: `$${t.ticker} was created on chain but never confirmed by the browser. The keeper verified its create (${found.signature.slice(0, 12)}…) and took it live${revived ? " (the draft had been marked expired)" : ""}.`, meta: { mint: t.mint, launchTx: found.signature, revived, withinWindow } }, now);
      }
      if (changed) out.takenLive.push({ mint: t.mint, ticker: t.ticker, launchTx: found.signature, blockTimeMs: found.blockTimeMs, revived, withinWindow });
      if (changed) d.log(`  [drafts] $${t.ticker} ${t.mint}: ${d.dryRun ? "would take" : "taken"} live from the chain — create ${found.signature} at ${new Date(found.blockTimeMs).toISOString()}${revived ? " (was expired)" : ""}`);
    }
  } catch (e) {
    if (!isBudgetHold(e)) throw e;
    out.errors.push(`budget hold: ${(e as Error).message.slice(0, 120)}`);
  } finally { budgetPhase(prevPhase); }
  return out;
}

/**
 * One sweep's share of a draft's history scan: pages newest first from the saved cursor (`before`) down to `until` (the newest signature a
 * finished scan saw), offering every successful in-window transaction to the verifier. Mutates `st`: the cursor while pages remain, or
 * `until` = the newest signature of a scan that reached the bottom. A verification budget exhausted mid-page leaves the cursor just
 * above the transaction not yet checked.
 */
async function scan(d: ReconcileDeps, t: TokenRow, st: ScanState, out: ReconcileReport, now: number): Promise<{ signature: string; blockTimeMs: number } | null> {
  const mint = new PublicKey(t.mint), lo = t.createdAt - 60_000, hi = windowEnd(t);
  const expect = { mint: t.mint, creator: t.creator, draftCreatedAtMs: t.createdAt, rulesSha: t.rulesSha, venue: launchVenueOf(t, d.registry.pairOf(t.mint)) };
  while (out.pages < PAGES_PER_SWEEP) {
    const rows = await d.reader.getSignaturesForAddress(mint, { limit: PAGE, ...(st.before ? { before: st.before } : {}), ...(st.until ? { until: st.until } : {}) }, "confirmed");
    out.pages++;
    if (!st.before) st.top = rows[0]?.signature ?? st.until;
    let prev = st.before, bottom = rows.length < PAGE;
    for (const s of rows) {
      const ms = typeof s.blockTime === "number" ? s.blockTime * 1000 : null;
      if (ms !== null && ms < lo) { bottom = true; break; }
      const candidate = (s.err === null || s.err === undefined) && (ms === null || inDraftWindow(t.createdAt, ms));
      if (candidate) {
        if (out.verified >= VERIFY_PER_SWEEP) { st.before = prev; return null; }
        out.verified++;
        const v = await d.verifier.verify(s.signature, expect);
        if (v.ok && v.blockTimeMs <= hi) return { signature: s.signature, blockTimeMs: v.blockTimeMs };
      }
      prev = s.signature;
    }
    if (bottom) { st.until = st.top; delete st.before; delete st.top; return null; }
    st.before = rows[rows.length - 1].signature;
  }
  return null;
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
