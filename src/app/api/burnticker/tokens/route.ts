import { NextResponse } from "next/server";
import { platform, tokenPageData } from "@/lib/burnticker/server";
import { buildPlatformIndex } from "@/lib/burnticker/tokenPage";
import { readAudit } from "@/lib/burnticker/trust";
import { readinessFromStatus, type Readiness } from "@/lib/burnticker/readiness";
import { rankLines } from "@/lib/burnticker/coinRank";
import { coinStatusFactsOf, type CoinStatusFacts } from "@/lib/burnticker/coinStatus";
import { leagueData } from "@/lib/burnticker/leaguesServe";
import { publicRegistryRows } from "@/lib/burnticker/devnetHide";
import { testCoinKeys, withoutTestCoins } from "@/lib/burnticker/testCoins";
import { chainRows, memoWindowMs, webReadPlatform } from "@/lib/burnticker/webReadCache";
import { coinListingOf } from "@/lib/burnticker/coinsListServe";
import type { CoinListing } from "@/lib/burnticker/coinsList";
import { auditForIndex } from "@/lib/burnticker/home";

export const dynamic = "force-dynamic";

/**
 * 2026-10-15 (owner: "loading the coins tab is still slow"): the index read every coin one after another with the full page read
 * (15–18 s with six live coins, past the proxy's 20 s limit on a slow day). It now reads them INDEX_CONCURRENCY at a time, serves its
 * last answer at once and refreshes in the background once it is older than INDEX_MEMO_MS (stale while revalidate, one build in flight);
 * a cold process waits up to INDEX_COLD_WAIT_MS for the first build, then answers 503 "index-loading" with retry-after and the page asks
 * again (CoinsIndex.tsx). The full read stays (the pairs tab needs each status's pair side, which the home's lite read leaves out).
 */
const INDEX_COLD_WAIT_MS = 15_000, INDEX_CONCURRENCY = 6;
// 2026-10-15 prelaunch audit M7: the memo window scales with the coins read from the chain (webReadCache.ts memoWindowMs): 15 s under 50
let indexMemo: { at: number; body: unknown; memoMs: number } | null = null;
let indexInFlight: Promise<void> | null = null;
function refreshIndex(): Promise<void> {
  if (!indexInFlight) indexInFlight = buildIndex().then(({ body, memoMs }) => { indexMemo = { at: Date.now(), body, memoMs }; }).catch((e) => { console.error("[burnticker/tokens] build failed:", e); }).finally(() => { indexInFlight = null; });
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
  const headers = { "cache-control": "public, max-age=10, s-maxage=15, stale-while-revalidate=30" };
  if (indexMemo) {
    if (Date.now() - indexMemo.at >= indexMemo.memoMs) void refreshIndex();
    return NextResponse.json(indexMemo.body, { headers: { ...headers, "x-index-memo": "hit" } });
  }
  await Promise.race([refreshIndex(), new Promise<void>((r) => setTimeout(r, INDEX_COLD_WAIT_MS))]);
  if (indexMemo) return NextResponse.json((indexMemo as { body: unknown }).body, { headers: { ...headers, "x-index-memo": "cold" } });
  return NextResponse.json({ loading: true, error: "the coin list is being read; try again in a few seconds", code: "index-loading", retryAfterSec: 5 }, { status: 503, headers: { "cache-control": "no-store", "retry-after": "5" } });
}

async function buildIndex(): Promise<{ body: unknown; memoMs: number }> {
  const started = Date.now();
  const p = platform();
  const now = Date.now();
  const statuses = [];
  const ready = new Map<string, Readiness>();
  const facts = new Map<string, CoinStatusFacts>();
  const listings = new Map<string, CoinListing>();
  // owner decision 2026-10-12: a mainnet host lists no registry row on the devnet cluster (devnetHide.ts)
  // owner 2026-10-14: a coin the operator marked test is not listed (testCoins.ts); /burnticker/test-coins lists it
  // block G re-review Low 3: draft and expired-draft mints are not listed publicly (the same rule as GET /v1/tokens)
  const tokens = withoutTestCoins(publicRegistryRows(p.registry.tokens(), p.cluster), testCoinKeys(process.cwd(), p.registry)).filter((t) => t.status !== "draft" && t.status !== "expired");
  // M7: drafts and expired drafts are built from the registry alone (server.ts); the rest read through the batch and the read cache
  const view = await webReadPlatform(p, tokens);
  const reads = await allLimited(tokens.map((t) => () => tokenPageData(view, t, now)), INDEX_CONCURRENCY);
  for (const r of reads) { if (r.status !== "fulfilled") continue; /* a token whose page fails is left out, not invented */ const d = r.value; statuses.push(d.status); ready.set(d.status.mint, readinessFromStatus(d.status, d.receipts)); }
  // review H2: each coin's status facts, with its pair's other coin's status when it was read (the winning side is named by its team)
  for (const r of reads) { if (r.status !== "fulfilled") continue; const d = r.value; const other = d.status.pair ? statuses.find((x) => x.mint === d.status.pair!.counterpart.mint) ?? null : null; facts.set(d.status.mint, coinStatusFactsOf(d.status, d.receipts, other)); }
  // owner 2026-10-19 (coinsList.ts): each coin's group on the Coins page, its result line and its next-result facts, from the status and
  // receipts read above and the registry's locked rule (no further chain or source read)
  for (const [i, r] of reads.entries()) {
    if (r.status !== "fulfilled") continue;
    const d = r.value;
    try { listings.set(d.status.mint, coinListingOf({ status: d.status, receipts: d.receipts, facts: facts.get(d.status.mint) ?? null, rule: p.registry.lockedRule(tokens[i]).rule })); } catch (e) { console.error(`[burnticker/tokens] ${d.status.ticker}: no listing:`, e); }
  }
  const audit = readAudit(p.publishDir);
  // third audit 2026-10-19 B-5: the badge counts executed and chain-verified receipts, so they travel with the audit summary
  const index = buildPlatformIndex(statuses, now, auditForIndex(audit));
  // website-17 wiring item 2: each coin's rank line (coinRank.ts), null when the registry could not be ranked (never a guessed rank)
  const ranks = (() => { try { return rankLines(leagueData(p, now).coins); } catch { return null; } })();
  console.info(`[burnticker/tokens] built in ${Date.now() - started} ms, ${statuses.length} coins`);
  return { memoMs: memoWindowMs(chainRows(tokens).length), body: { ...index, tokens: index.tokens.map((t) => ({ ...t, readiness: ready.get(t.mint) ?? null, rank: ranks?.get(t.mint)?.line ?? null, statusFacts: facts.get(t.mint) ?? null, listing: listings.get(t.mint) ?? null })), cluster: p.cluster, stubs: p.stubs } };
}
