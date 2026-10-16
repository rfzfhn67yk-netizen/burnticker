import { NextResponse } from "next/server";
import { platform, tokenPageData } from "@/lib/burnticker/server";
import { buildPlatformIndex } from "@/lib/burnticker/tokenPage";
import { readAudit } from "@/lib/burnticker/trust";
import { readinessFromStatus, type Readiness } from "@/lib/burnticker/readiness";
import { rankLines } from "@/lib/burnticker/coinRank";
import { leagueData } from "@/lib/burnticker/leaguesServe";
import { publicRegistryRows } from "@/lib/burnticker/devnetHide";
import { testCoinKeys, withoutTestCoins } from "@/lib/burnticker/testCoins";

export const dynamic = "force-dynamic";

/**
 * 2026-10-15 (owner: "loading the coins tab is still slow"): the index read every coin one after another with the full page read
 * (15–18 s with six live coins, past the proxy's 20 s limit on a slow day). It now reads them INDEX_CONCURRENCY at a time, serves its
 * last answer at once and refreshes in the background once it is older than INDEX_MEMO_MS (stale while revalidate, one build in flight);
 * a cold process waits up to INDEX_COLD_WAIT_MS for the first build, then answers 503 "index-loading" with retry-after and the page asks
 * again (CoinsIndex.tsx). The full read stays (the pairs tab needs each status's pair side, which the home's lite read leaves out).
 */
const INDEX_MEMO_MS = 15_000, INDEX_COLD_WAIT_MS = 15_000, INDEX_CONCURRENCY = 6;
let indexMemo: { at: number; body: unknown } | null = null;
let indexInFlight: Promise<void> | null = null;
function refreshIndex(): Promise<void> {
  if (!indexInFlight) indexInFlight = buildIndex().then((body) => { indexMemo = { at: Date.now(), body }; }).catch((e) => { console.error("[burnticker/tokens] build failed:", e); }).finally(() => { indexInFlight = null; });
  return indexInFlight;
}
/** Runs the tasks at most `n` at a time, in order, settling each (a slow coin never blocks the others beyond its own slot). */
async function allLimited<T>(tasks: (() => Promise<T>)[], n: number): Promise<PromiseSettledResult<T>[]> {
  const out: PromiseSettledResult<T>[] = new Array(tasks.length);
  let next = 0;
  const worker = async () => { while (next < tasks.length) { const i = next++; try { out[i] = { status: "fulfilled", value: await tasks[i]() }; } catch (reason) { out[i] = { status: "rejected", reason }; } } };
  await Promise.all(Array.from({ length: Math.min(n, tasks.length) }, worker));
  return out;
}

/**
 * The platform index: every token's status (from the registry + the program client), totals, the audit badge, and which pieces are stubs.
 * Since website-14 each token also carries `readiness` (readiness.ts, from its status and receipts), which the cards' progress strip reads.
 */
export async function GET() {
  const headers = { "cache-control": "public, max-age=10, s-maxage=15" };
  if (indexMemo) {
    if (Date.now() - indexMemo.at >= INDEX_MEMO_MS) void refreshIndex();
    return NextResponse.json(indexMemo.body, { headers: { ...headers, "x-index-memo": "hit" } });
  }
  await Promise.race([refreshIndex(), new Promise<void>((r) => setTimeout(r, INDEX_COLD_WAIT_MS))]);
  if (indexMemo) return NextResponse.json((indexMemo as { body: unknown }).body, { headers: { ...headers, "x-index-memo": "cold" } });
  return NextResponse.json({ loading: true, error: "the coin list is being read; try again in a few seconds", code: "index-loading", retryAfterSec: 5 }, { status: 503, headers: { "cache-control": "no-store", "retry-after": "5" } });
}

async function buildIndex(): Promise<unknown> {
  const started = Date.now();
  const p = platform();
  const now = Date.now();
  const statuses = [];
  const ready = new Map<string, Readiness>();
  // owner decision 2026-10-12: a mainnet host lists no registry row on the devnet cluster (devnetHide.ts)
  // owner 2026-10-14: a coin the operator marked test is not listed (testCoins.ts); /burnticker/test-coins lists it
  const tokens = withoutTestCoins(publicRegistryRows(p.registry.tokens(), p.cluster), testCoinKeys(process.cwd(), p.registry));
  const reads = await allLimited(tokens.map((t) => () => tokenPageData(p, t, now)), INDEX_CONCURRENCY);
  for (const r of reads) { if (r.status !== "fulfilled") continue; /* a token whose page fails is left out, not invented */ const d = r.value; statuses.push(d.status); ready.set(d.status.ticker, readinessFromStatus(d.status, d.receipts)); }
  const audit = readAudit(p.publishDir);
  const index = buildPlatformIndex(statuses, now, audit ? { ok: audit.ok, ranAt: audit.ranAt, receipts: audit.receipts, mismatches: audit.mismatches.length, chainChecked: audit.chainChecked } : null);
  // website-17 wiring item 2: each coin's rank line (coinRank.ts), null when the registry could not be ranked (never a guessed rank)
  const ranks = (() => { try { return rankLines(leagueData(p, now).coins); } catch { return null; } })();
  console.info(`[burnticker/tokens] built in ${Date.now() - started} ms, ${statuses.length} coins`);
  return { ...index, tokens: index.tokens.map((t) => ({ ...t, readiness: ready.get(t.ticker) ?? null, rank: ranks?.get(t.ticker)?.line ?? null })), cluster: p.cluster, stubs: p.stubs };
}
