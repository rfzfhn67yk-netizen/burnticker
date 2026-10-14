import { sourceForUrl, takeOrThrow } from "@/lib/burnticker/apiBudget";
/**
 * POLYMARKET, READ FROM THE CHAIN (2026-10-09). A Polymarket market is a Gnosis Conditional Tokens Framework condition on Polygon;
 * when UMA's optimistic oracle resolves it, the UMA CTF adapter calls `reportPayouts` and the CTF contract stores, per condition,
 * `payoutNumerators[i]` for each outcome slot and `payoutDenominator` (0 until resolved). THAT is the resolution: not gamma-api's
 * `outcomePrices`, not the order book. This module reads it with three hand-encoded `eth_call`s over plain JSON-RPC (no viem, no ABI
 * library — the selectors are keccak-256 prefixes computed once and pinned below), so a stranger can repeat it with curl.
 *
 *   payoutDenominator(bytes32)            0xdd34de67
 *   payoutNumerators(bytes32,uint256)     0x0504c814
 *   getOutcomeSlotCount(bytes32)          0xd42dc0c2
 *
 * Read-only; the RPC is a public endpoint (several are tried). `outcome` is the index of the single winning slot when exactly one
 * slot takes the whole payout; a split payout (e.g. 50/50 on a voided market) reports `outcome: null` and the fractions.
 */

export const POLYGON_CHAIN_ID = 137;
/** Gnosis ConditionalTokens on Polygon — the contract every Polymarket market lives in. */
export const POLYMARKET_CTF = "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045";
/** Polymarket's UMA CTF adapter (what gamma-api reports as `resolvedBy`); label only, nothing here calls it. */
export const POLYMARKET_UMA_CTF_ADAPTER = "0x2F5e3684cb1F318ec51b00Edba38d79Ac2c0aA9d";
export const SEL_PAYOUT_DENOMINATOR = "0xdd34de67";
export const SEL_PAYOUT_NUMERATORS = "0x0504c814";
export const SEL_OUTCOME_SLOT_COUNT = "0xd42dc0c2";
/**
 * Public Polygon JSON-RPC endpoints, tried in order (first that works wins). polygon-bor.publicnode.com answered unauthenticated
 * eth_call on 2026-10-10 (when 1rpc.io timed out and the others refused TLS from this network); 1rpc answered on 2026-10-09. None of
 * them serves eth_getLogs without a key, so the reportPayouts transaction itself is not looked up — the payout vector is the read.
 */
export const DEFAULT_POLYGON_RPCS = ["https://polygon-bor.publicnode.com", "https://1rpc.io/matic", "https://polygon-rpc.com", "https://polygon-bor-rpc.publicnode.com", "https://polygon.drpc.org"];

export interface ConditionResolution {
  conditionId: string;
  chainId: number;
  contract: string;
  rpcUrl: string;
  blockNumber: number | null;
  outcomeSlotCount: number;
  payoutDenominator: string;
  /** One per outcome slot, as decimal strings. */
  payoutNumerators: string[];
  /** payoutDenominator > 0 — UMA has reported and the CTF has stored the result. */
  resolved: boolean;
  /** Fractions numerator/denominator per slot ("1", "0", "1/2"), empty when unresolved. */
  payouts: string[];
  /** The index of the single slot that takes the entire payout; null when unresolved or split. */
  outcome: number | null;
}

export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

const HEX32 = /^0x[0-9a-fA-F]{64}$/;

export function isConditionId(s: unknown): s is string { return typeof s === "string" && HEX32.test(s); }

/** ABI-encodes a call: selector + each argument left-padded to 32 bytes (bytes32 and uint256 only — all this module needs). */
export function encodeCall(selector: string, words: (string | bigint | number)[]): string {
  const enc = words.map((w) => {
    if (typeof w === "string") { if (!HEX32.test(w)) throw new Error(`not a bytes32: ${w}`); return w.slice(2).toLowerCase(); }
    const b = BigInt(w); if (b < BigInt(0)) throw new Error("negative uint256");
    return b.toString(16).padStart(64, "0");
  });
  return `${selector}${enc.join("")}`;
}

export function decodeUint(hex: unknown): bigint {
  if (typeof hex !== "string" || !/^0x[0-9a-fA-F]*$/.test(hex)) throw new Error(`eth_call returned no uint256 (${String(hex).slice(0, 40)})`);
  if (hex === "0x") throw new Error("eth_call returned empty data (wrong contract or chain?)");
  return BigInt(hex);
}

async function rpc(fetchImpl: FetchLike, url: string, method: string, params: unknown[], timeoutMs: number): Promise<unknown> {
  await takeOrThrow(sourceForUrl(url));   // the request budget (apiBudget.ts), before the timeout starts
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { method: "POST", headers: { "content-type": "application/json", "user-agent": "burnkeeper-attest/1 (curl-compatible)" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: ac.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = (await res.json()) as { result?: unknown; error?: { message?: string } };
    if (j.error) throw new Error(j.error.message ?? "rpc error");
    return j.result;
  } finally { clearTimeout(t); }
}

/** Reads the condition's payout vector from the CTF contract. Throws only when every RPC fails. */
export async function readConditionResolution(conditionId: string, opts: { rpcUrls?: string[]; fetchImpl?: FetchLike; timeoutMs?: number; contract?: string } = {}): Promise<ConditionResolution> {
  if (!isConditionId(conditionId)) throw new Error(`conditionId must be 0x + 64 hex characters, got ${JSON.stringify(conditionId).slice(0, 80)}`);
  const fetchImpl = opts.fetchImpl ?? (fetch as unknown as FetchLike);
  const contract = opts.contract ?? POLYMARKET_CTF;
  const urls = opts.rpcUrls?.length ? opts.rpcUrls : DEFAULT_POLYGON_RPCS;
  const errors: string[] = [];
  for (const url of urls) {
    try {
      const call = async (data: string) => decodeUint(await rpc(fetchImpl, url, "eth_call", [{ to: contract, data }, "latest"], opts.timeoutMs ?? 20_000));
      const slots = Number(await call(encodeCall(SEL_OUTCOME_SLOT_COUNT, [conditionId])));
      if (!(slots >= 1 && slots <= 256)) throw new Error(`outcome slot count ${slots}: the condition is not prepared on this contract`);
      const den = await call(encodeCall(SEL_PAYOUT_DENOMINATOR, [conditionId]));
      const nums: bigint[] = [];
      for (let i = 0; i < slots; i++) nums.push(await call(encodeCall(SEL_PAYOUT_NUMERATORS, [conditionId, i])));
      let blockNumber: number | null = null;
      try { blockNumber = Number(decodeUint(await rpc(fetchImpl, url, "eth_blockNumber", [], 10_000))); } catch { /* informational */ }
      return { conditionId: conditionId.toLowerCase(), chainId: POLYGON_CHAIN_ID, contract, rpcUrl: url, blockNumber, outcomeSlotCount: slots, payoutDenominator: den.toString(), payoutNumerators: nums.map(String), ...interpretPayouts(nums, den) };
    } catch (e) { errors.push(`${url}: ${(e as Error).message.slice(0, 120)}`); }
  }
  throw new Error(`every Polygon RPC failed — ${errors.join(" · ")}`);
}

/** Pure: the payout vector → resolved / fractions / the single winning slot (or null when split). */
export function interpretPayouts(nums: bigint[], den: bigint): { resolved: boolean; payouts: string[]; outcome: number | null } {
  if (den <= BigInt(0)) return { resolved: false, payouts: [], outcome: null };
  const sum = nums.reduce((a, b) => a + b, BigInt(0));
  if (sum !== den) throw new Error(`payout numerators sum to ${sum}, denominator is ${den} — not a CTF resolution`);
  const payouts = nums.map((n) => (n === BigInt(0) ? "0" : n === den ? "1" : `${n}/${den}`));
  const winners = nums.map((n, i) => (n === den ? i : -1)).filter((i) => i >= 0);
  return { resolved: true, payouts, outcome: winners.length === 1 ? winners[0] : null };
}

/** Maps a resolution onto gamma-api's `outcomes` labels (e.g. ["Yes","No"]) — a convenience; the chain knows only slot indices. */
export function outcomeLabel(r: ConditionResolution, labels: string[]): string | null {
  if (!r.resolved) return null;
  if (r.outcome === null) return `split (${r.payouts.join(", ")})`;
  return labels[r.outcome] ?? `slot ${r.outcome}`;
}
