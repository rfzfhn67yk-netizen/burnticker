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
 * The platform index: every token's status (from the registry + the program client), totals, the audit badge, and which pieces are stubs.
 * Since website-14 each token also carries `readiness` (readiness.ts, from its status and receipts), which the cards' progress strip reads.
 */
export async function GET() {
  const p = platform();
  const now = Date.now();
  const statuses = [];
  const ready = new Map<string, Readiness>();
  // owner decision 2026-10-12: a mainnet host lists no registry row on the devnet cluster (devnetHide.ts)
  // owner 2026-10-14: a coin the operator marked test is not listed (testCoins.ts); /burnticker/test-coins lists it
  for (const t of withoutTestCoins(publicRegistryRows(p.registry.tokens(), p.cluster), testCoinKeys(process.cwd(), p.registry))) { try { const d = await tokenPageData(p, t, now); statuses.push(d.status); ready.set(d.status.ticker, readinessFromStatus(d.status, d.receipts)); } catch { /* a token whose page fails is left out, not invented */ } }
  const audit = readAudit(p.publishDir);
  const index = buildPlatformIndex(statuses, now, audit ? { ok: audit.ok, ranAt: audit.ranAt, receipts: audit.receipts, mismatches: audit.mismatches.length, chainChecked: audit.chainChecked } : null);
  // website-17 wiring item 2: each coin's rank line (coinRank.ts), null when the registry could not be ranked (never a guessed rank)
  const ranks = (() => { try { return rankLines(leagueData(p, now).coins); } catch { return null; } })();
  return NextResponse.json({ ...index, tokens: index.tokens.map((t) => ({ ...t, readiness: ready.get(t.ticker) ?? null, rank: ranks?.get(t.ticker)?.line ?? null })), cluster: p.cluster, stubs: p.stubs });
}
