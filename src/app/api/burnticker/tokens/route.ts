import { NextResponse } from "next/server";
import { platform, tokenPageData } from "@/lib/burnticker/server";
import { buildPlatformIndex, type TokenStatusJson } from "@/lib/burnticker/tokenPage";
import { readAudit } from "@/lib/burnticker/trust";
import { readinessFromStatus, type Readiness } from "@/lib/burnticker/readiness";
import { rankLines } from "@/lib/burnticker/coinRank";
import { coinStatusFactsOf, type CoinStatusFacts } from "@/lib/burnticker/coinStatus";
import { leagueData } from "@/lib/burnticker/leaguesServe";
import { publicRegistryRows } from "@/lib/burnticker/devnetHide";
import { testCoinKeys, withoutTestCoins } from "@/lib/burnticker/testCoins";
import { chainRows, memoWindowMs, webReadCachedView, webReadPlatform } from "@/lib/burnticker/webReadCache";
import { stageClock } from "@/lib/burnticker/buildStages";
import { LIST_BUILD_BUDGETS, earlierReadsNote, readAgoText, readCoinsBounded, anyReadLate } from "@/lib/burnticker/boundedReads";
import { coinListingOf } from "@/lib/burnticker/coinsListServe";
import type { CoinListing } from "@/lib/burnticker/coinsList";
import { auditForIndex } from "@/lib/burnticker/home";
import { indexMemoTooOld } from "@/lib/burnticker/coinsGrid";
import { isVisitorRequest, memoRefresher } from "@/lib/burnticker/memoRefresher";

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
// HB-145 (2026-10-20): rebuilt by a timer behind the requests (memoRefresher.ts); only the very first build after a start is waited for
const indexRefresher = memoRefresher({ refresh: refreshIndex, ageMs: () => (indexMemo ? Date.now() - indexMemo.at : null), freshMs: () => indexMemo?.memoMs ?? 15_000 });

/**
 * The platform index: every token's status (from the registry + the program client), totals, the audit badge, and which pieces are stubs.
 * Since website-14 each token also carries `readiness` (readiness.ts, from its status and receipts), which the cards' progress strip reads.
 */
export async function GET(req: Request) {
  const headers = { "cache-control": "public, max-age=10, s-maxage=15, stale-while-revalidate=30" };
  // HB-163: the start-up warm call (x-burnticker-warm: 1) is not a visitor, so it starts no timer
  indexRefresher.touch(isVisitorRequest(req));
  if (indexMemo) {
    const age = Date.now() - indexMemo.at;
    // LD6-4 + HB-145 (2026-10-20): the visitor never waits for a rebuild: the kept copy is served at once and a rebuild starts behind it
    // (HB-163: the timer builds only while visitors come, so after a quiet spell this request starts it). A copy older than
    // INDEX_SERVE_MAX_AGE_MS is served with no-store and its age, never after a wait on the request path (before: up to INDEX_COLD_WAIT_MS)
    if (age >= indexMemo.memoMs) void refreshIndex();
    if (indexMemoTooOld(age)) return NextResponse.json(indexMemo.body, { headers: { "cache-control": "no-store", "x-index-memo": "stale", "x-index-age-sec": String(Math.round(age / 1000)) } });
    return NextResponse.json(indexMemo.body, { headers: { ...headers, "x-index-memo": "hit" } });
  }
  await Promise.race([refreshIndex(), new Promise<void>((r) => setTimeout(r, INDEX_COLD_WAIT_MS))]);
  if (indexMemo) return NextResponse.json((indexMemo as { body: unknown }).body, { headers: { ...headers, "x-index-memo": "cold" } });
  return NextResponse.json({ loading: true, error: "the coin list is being read; try again in a few seconds", code: "index-loading", retryAfterSec: 5 }, { status: 503, headers: { "cache-control": "no-store", "retry-after": "5" } });
}

/** The words for a coin the index could not read (the home's omitted row says the same). */
const OMITTED_REASON = "This site could not read the coin's page.";
/**
 * HB-145 second half (2026-10-20): timed stage by stage (buildStages.ts; "[burnticker/tokens] built in N ms, 8 coins: registry …, batch …,
 * chain …, shape …; cpu …, loop max …, budget store …"). The chain stage reads every coin under one deadline (boundedReads.ts): a coin
 * whose read is late is served from its last good read and says when it was read (`readNote`), instead of waiting for it.
 */
async function buildIndex(): Promise<{ body: unknown; memoMs: number }> {
  const clock = stageClock();
  const B = LIST_BUILD_BUDGETS;
  for (const [k, v] of [["registry", B.registryMs], ["shape", B.shapeMs], ["chain", B.indexChainMs]] as const) clock.budget(k, v);
  const p = platform();
  const now = Date.now();
  const statuses: TokenStatusJson[] = [];
  const ready = new Map<string, Readiness>();
  const facts = new Map<string, CoinStatusFacts>();
  const listings = new Map<string, CoinListing>();
  // owner decision 2026-10-12: a mainnet host lists no registry row on the devnet cluster (devnetHide.ts)
  // owner 2026-10-14: a coin the operator marked test is not listed (testCoins.ts); /burnticker/test-coins lists it
  // block G re-review Low 3: draft and expired-draft mints are not listed publicly (the same rule as GET /v1/tokens)
  const tokens = clock.run("registry", () => withoutTestCoins(publicRegistryRows(p.registry.tokens(), p.cluster), testCoinKeys(process.cwd(), p.registry)).filter((t) => t.status !== "draft" && t.status !== "expired"));
  // M7: drafts and expired drafts are built from the registry alone (server.ts); the rest read through the batch and the read cache
  // HB-145 second half: the batch has a budget; past it the coin reads go on through the cache while the batch lands behind them
  const view = await clock.bounded("batch", B.batchMs, () => webReadPlatform(p, tokens), () => webReadCachedView(p), { onError: () => webReadCachedView(p) });
  const reads = await clock.run("chain", () => readCoinsBounded(tokens.map((t) => ({ key: `full:${t.mint}`, read: () => tokenPageData(view, t, now) })), { concurrency: INDEX_CONCURRENCY, deadlineMs: B.indexChainMs, coldDeadlineMs: B.chainColdMs, scope: p.registry }));
  if (anyReadLate(reads)) clock.markOver("chain");
  clock.note(earlierReadsNote(tokens.map((t, i) => ({ ticker: t.ticker, r: reads[i] })), Date.now()));
  // a coin served from an earlier read says when it was read; a token whose page fails with no earlier read is left out, not invented
  const readNotes = new Map<string, string>();
  const got = reads.flatMap((r) => (r.state === "failed" ? [] : [r]));
  for (const r of got) if (r.state === "earlier") readNotes.set(r.value.status.mint, readAgoText(r.at, now));
  const listingsOf = () => {
    for (const r of got) { const d = r.value; statuses.push(d.status); ready.set(d.status.mint, readinessFromStatus(d.status, d.receipts)); }
    // review H2: each coin's status facts, with its pair's other coin's status when it was read (the winning side is named by its team)
    for (const r of got) { const d = r.value; const other = d.status.pair ? statuses.find((x) => x.mint === d.status.pair!.counterpart.mint) ?? null : null; facts.set(d.status.mint, coinStatusFactsOf(d.status, d.receipts, other)); }
    // owner 2026-10-19 (coinsList.ts): each coin's group on the Coins page, its result line and its next-result facts, from the status and
    // receipts read above and the registry's locked rule (no further chain or source read)
    for (const [i, r] of reads.entries()) {
      if (r.state === "failed") continue;
      const d = r.value;
      try { listings.set(d.status.mint, coinListingOf({ status: d.status, receipts: d.receipts, facts: facts.get(d.status.mint) ?? null, rule: p.registry.lockedRule(tokens[i]).rule })); } catch (e) { console.error(`[burnticker/tokens] ${d.status.ticker}: no listing:`, e); }
    }
  };
  clock.run("shape", listingsOf);
  const audit = clock.run("files", () => readAudit(p.publishDir));
  // third audit 2026-10-19 B-5: the badge counts executed and chain-verified receipts, so they travel with the audit summary
  const index = clock.run("shape", () => buildPlatformIndex(statuses, now, auditForIndex(audit)));
  // website-17 wiring item 2: each coin's rank line (coinRank.ts), null when the registry could not be ranked (never a guessed rank)
  const ranks = clock.run("ranks", () => { try { return rankLines(leagueData(p, now).coins); } catch { return null; } });
  // audit 7 review: a coin with no read (a new coin, or every coin past the cold deadline after a restart) is named in `omitted`, as the
  // home does, and the live and token counts come from the registry rows listed, never from the coins read; `totalsPartial` says the burn
  // totals leave the omitted coins out
  const omitted = tokens.flatMap((t, i) => (reads[i].state === "failed" ? [{ mint: t.mint, ticker: t.ticker, reason: OMITTED_REASON }] : []));
  const totals = { ...index.totals, tokens: tokens.length, live: tokens.filter((t) => t.status === "live").length };
  const body = clock.run("shape", () => ({ ...index, totals, omitted, ...(omitted.length ? { totalsPartial: true } : {}), tokens: index.tokens.map((t) => ({ ...t, readiness: ready.get(t.mint) ?? null, rank: ranks?.get(t.mint)?.line ?? null, statusFacts: facts.get(t.mint) ?? null, listing: listings.get(t.mint) ?? null, ...(readNotes.has(t.mint) ? { readNote: readNotes.get(t.mint)! } : {}) })), cluster: p.cluster, stubs: p.stubs }));
  console.info(clock.line("[burnticker/tokens]", `${statuses.length} coins`));
  return { memoMs: memoWindowMs(chainRows(tokens).length), body };
}
