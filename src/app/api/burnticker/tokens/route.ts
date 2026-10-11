import { NextResponse } from "next/server";
import { platform, tokenPageData } from "@/lib/burnticker/server";
import { buildPlatformIndex } from "@/lib/burnticker/tokenPage";
import { readAudit } from "@/lib/burnticker/trust";

export const dynamic = "force-dynamic";

/** The platform index: every token's status (from the registry + the program client), totals, the audit badge, and which pieces are stubs. */
export async function GET() {
  const p = platform();
  const now = Date.now();
  const statuses = [];
  for (const t of p.registry.tokens()) { try { statuses.push((await tokenPageData(p, t, now)).status); } catch { /* a token whose page fails is left out, not invented */ } }
  const audit = readAudit(p.publishDir);
  const index = buildPlatformIndex(statuses, now, audit ? { ok: audit.ok, ranAt: audit.ranAt, receipts: audit.receipts, mismatches: audit.mismatches.length, chainChecked: audit.chainChecked } : null);
  return NextResponse.json({ ...index, cluster: p.cluster, stubs: p.stubs });
}
