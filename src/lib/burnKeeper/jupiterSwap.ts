import { sourceForUrl, takeOrThrow } from "@/lib/burnticker/apiBudget";
/**
 * THE KEEPER'S JUPITER CLIENT (2026-10-09): the two calls the buyback leg needs — the SOL/USD price (for the rule's floor) and a
 * SOL → <mint> market swap built by Jupiter's lite API — and nothing else. Self-contained on purpose: the keeper is published in the
 * open and must import nothing from the private trading code. No cache (one swap a day does not need one), a plain fetch with a
 * timeout, and the same request shape the trading path uses, so a swap built here lands the same way. The transaction returned is
 * checked by `validateSwapTransaction` (program allowlist, fee payer, single signer) before anything signs it — in solanaChain.ts.
 */

export const JUPITER_BASE_URL = "https://lite-api.jup.ag";
export const SOL_MINT = "So11111111111111111111111111111111111111112";
/** The priority-fee cap per swap: "high" with a 1,000,000-lamport ceiling (about a cent), never more. */
export const PRIORITY_MAX_LAMPORTS = 1_000_000;
const TIMEOUT_MS = 15_000;

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

interface JupiterQuoteResponse { inAmount?: string; outAmount?: string; otherAmountThreshold?: string; priceImpactPct?: string; routePlan?: { swapInfo: { label: string } }[]; error?: string }

export interface SwapBuildResult {
  status: "ok" | "no_route" | "unavailable";
  reason?: string;
  /** Base64 serialised transaction for the keeper to validate and sign. */
  swapTransaction?: string;
  summary?: { inputMint: string; outputMint: string; inAmount: string; outAmount: string; minOutAmount: string; priceImpactPct: number; route: string };
}

async function fetchJson<T>(fetchImpl: FetchLike, url: string, init?: RequestInit): Promise<T> {
  await takeOrThrow(sourceForUrl(url));   // the request budget (apiBudget.ts)
  const res = await fetchImpl(url, { ...init, headers: { Accept: "application/json", ...(init?.headers ?? {}) }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Jupiter request failed (${res.status})`);
  return (await res.json()) as T;
}

/** The USD price of a mint from Jupiter's price API; null when Jupiter does not price it. */
export async function usdPrice(mint: string, fetchImpl: FetchLike = fetch): Promise<number | null> {
  const data = await fetchJson<Record<string, { usdPrice?: number }>>(fetchImpl, `${JUPITER_BASE_URL}/price/v3?ids=${mint}`);
  const p = data[mint]?.usdPrice;
  return typeof p === "number" && p > 0 ? p : null;
}

/** Quote then build. Three outcomes kept distinct: a route exists, nobody will trade it, or Jupiter could not be asked. */
export async function buildSwapTransaction(params: { inputMint: string; outputMint: string; amountBaseUnits: string; ownerAddress: string; slippageBps: number }, fetchImpl: FetchLike = fetch): Promise<SwapBuildResult> {
  const { inputMint, outputMint, amountBaseUnits, ownerAddress, slippageBps } = params;
  try {
    const quote = await fetchJson<JupiterQuoteResponse>(fetchImpl, `${JUPITER_BASE_URL}/swap/v1/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amountBaseUnits}&slippageBps=${slippageBps}`);
    if (quote.error || !quote.outAmount) return { status: "no_route", reason: quote.error ?? "no route" };
    await takeOrThrow(sourceForUrl(JUPITER_BASE_URL));
    const res = await fetchImpl(`${JUPITER_BASE_URL}/swap/v1/swap`, {
      method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({
        quoteResponse: quote, userPublicKey: ownerAddress,
        wrapAndUnwrapSol: true,            // Jupiter opens any missing associated token account inside the swap
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: { priorityLevelWithMaxLamports: { maxLamports: PRIORITY_MAX_LAMPORTS, priorityLevel: "high" } },
      }),
    });
    if (!res.ok) return { status: "unavailable", reason: `Jupiter swap build failed (${res.status})` };
    const body = (await res.json()) as { swapTransaction?: string; error?: string };
    if (!body.swapTransaction) return { status: "unavailable", reason: body.error ?? "no transaction returned" };
    const labels = (quote.routePlan ?? []).map((r) => r.swapInfo.label);
    return {
      status: "ok", swapTransaction: body.swapTransaction,
      summary: { inputMint, outputMint, inAmount: quote.inAmount ?? amountBaseUnits, outAmount: quote.outAmount, minOutAmount: quote.otherAmountThreshold ?? quote.outAmount, priceImpactPct: Number(quote.priceImpactPct ?? 0), route: labels.length > 0 ? labels.join(" + ") : "direct" },
    };
  } catch (error) {
    // Unreachable is NOT the same as refused — the caller must tell "nobody will trade this" from "we could not ask".
    return { status: "unavailable", reason: error instanceof Error ? error.message : "unknown error" };
  }
}
