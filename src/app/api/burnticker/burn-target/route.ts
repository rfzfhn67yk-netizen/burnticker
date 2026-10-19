import { NextResponse } from "next/server";
import { edgeJson, heavyRefusal } from "@/lib/burnticker/api/http";
import { Connection, PublicKey } from "@solana/web3.js";
import { checkTargetAdmission, TARGET_MIN_WSOL_RESERVE_LAMPORTS } from "@/lib/burnReceipts/burnTarget";
import { admissionLine, burnTargetShapeProblems } from "@/lib/burnticker/burnTarget";
import { rpcUrlFor, type Network } from "@/lib/burnticker/networks";
import { budgetedRpcConfig } from "@/lib/burnticker/apiBudget";
import { ensureWebApiBudget } from "@/lib/burnticker/server";

export const dynamic = "force-dynamic";

/**
 * ROUND 5 — the launch review's burn-target check: GET /api/burnticker/burn-target?mint=<target mint>&pool=<CPMM or AMM v4 pool>&symbol=<ticker>&feed=<Pyth feed id hex>
 * [&network=devnet|mainnet][&coin=<coin mint>]. Reads the target mint, the pool, its AmmConfig and vaults from the network and runs the
 * program's own admission (src/lib/burnReceipts/burnTarget.ts judgeTargetAdmission): plain SPL Token, no mint or freeze authority, a
 * {target, SOL} pool on classic SPL tokens with swaps on, a fee of at most 1 %, and at least the SOL floor. Read-only; nothing is signed.
 * The program checks it all again at pin_burn_target, so this answer is advice for the review, never a substitute.
 */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const network: Network = q.get("network") === "mainnet" ? "mainnet" : "devnet";
  const symbol = (q.get("symbol") ?? "").trim().toUpperCase();
  const shape = burnTargetShapeProblems({ mint: q.get("mint") ?? "", pool: q.get("pool") ?? "", symbol, feedId: (q.get("feed") ?? "").toLowerCase() });
  const coin = q.get("coin");
  if (shape.length || (coin !== null && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(coin))) return NextResponse.json({ ok: false, problems: [...shape, ...(coin !== null && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(coin) ? ["coin must be a base58 address"] : [])] }, { status: 400 });
  // audit 2026-10-18 A-38: up to four RPC reads per request, so the heavy bucket per client (it had no limit)
  const refused = heavyRefusal(req);
  if (refused) return refused;
  ensureWebApiBudget();
  const connection = new Connection(rpcUrlFor(network), budgetedRpcConfig({ commitment: "confirmed" as const, disableRetryOnRateLimit: true }));
  try {
    const a = await checkTargetAdmission(connection, { cluster: network, targetMint: new PublicKey(q.get("mint")!), pool: new PublicKey(q.get("pool")!), feedId: (q.get("feed") ?? "").toLowerCase(), ...(coin ? { coinMint: new PublicKey(coin) } : {}) });
    const s = (k: PublicKey | null) => (k ? k.toBase58() : null);
    const n = (x: bigint | null) => (x === null ? null : x.toString());
    return NextResponse.json({
      network, ok: a.ok, problems: a.problems, line: admissionLine({ ok: a.ok, problems: a.problems, symbol }),
      target: { mint: a.targetMint.toBase58(), symbol, decimals: a.decimals },
      pool: { address: a.pool.toBase58(), kind: a.poolKind === 1 ? "amm-v4" : a.poolKind === 0 ? "cpmm" : null, referenceX32: n(a.referenceX32), spotX32: n(a.spotX32), ammConfig: s(a.ammConfig), wsolVault: s(a.wsolVault), targetVault: s(a.targetVault), observation: s(a.observation), wsolIsToken0: a.wsolIsToken0, wsolReserveLamports: n(a.wsolReserve), tokenReserve: n(a.tokenReserve), feePpm: n(a.feePpm) },
      floorLamports: TARGET_MIN_WSOL_RESERVE_LAMPORTS[network].toString(),
    });
  } catch (e) {
    return edgeJson({ ok: false, problems: [`the network could not be read: ${(e as Error).message.slice(0, 120)}`] }, 502);
  }
}
