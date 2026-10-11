import type { BurnRule } from "@/lib/burnticker/rules";
import type { SettledEvent } from "@/lib/burnticker/units";
import type { ImpliedChance, ResolvedSelector, SeriesSummary } from "@/lib/burnticker/oracle/types";
import type { ResolutionSource } from "@/lib/burnticker/sources/types";

/**
 * ON-CHAIN FACTS (kind "onchain", tier 1 for the keeper's purposes: anyone can read the same RPC call and the Receipts program can
 * verify it directly). v1: Solana block height and slot, read with getBlockHeight / getSlot — a snapshot per UTC day. Admitted: facts
 * that are ACCOUNT DATA or RPC consensus state. Not admitted: anything from an indexer (holder counts, volumes, prices).
 */

export interface SolanaRpcPort { blockHeight(): Promise<number>; slot(): Promise<number>; accountLamports(pubkey: string): Promise<bigint | null> }

export const ONCHAIN_FACTS = {
  "solana.blockHeight": { title: "Solana block height", method: "getBlockHeight", unit: { size: 1_000_000, label: "1M blocks", definition: "every full 1,000,000 blocks added since the previous day's reading" } },
  "solana.slot": { title: "Solana slot", method: "getSlot", unit: { size: 1_000_000, label: "1M slots", definition: "every full 1,000,000 slots since the previous day's reading" } },
} as const;
export type OnchainFactId = keyof typeof ONCHAIN_FACTS;

export function onchainSource(id: OnchainFactId, rpc: SolanaRpcPort | null, o: { now?: () => number; rpcUrl?: string } = {}): ResolutionSource {
  const f = ONCHAIN_FACTS[id];
  const now = o.now ?? (() => Date.now());
  const summary: SeriesSummary = { oracle: "catalogue", ticker: id, title: f.title, category: "on-chain", frequency: "continuous; one reading per UTC day", settlementSource: { name: "Solana RPC", url: o.rpcUrl ?? "https://api.mainnet-beta.solana.com" }, tags: ["onchain", `rpc ${f.method}`] };
  return {
    id, kind: "onchain", tier: 1, title: f.title, sourceName: "Solana RPC (consensus state)", sourceUrl: o.rpcUrl ?? "https://api.mainnet-beta.solana.com", cadence: "continuous; read once per UTC day",
    unit: f.unit, direction: "up", baseline: "previousSettlement", carry: "none", valueLabel: id.endsWith("slot") ? "slots" : "blocks", flags: ["onchain", "verifiable by any RPC and by the program"],
    launchable: { ok: rpc !== null, why: rpc ? null : "no RPC configured on this host" },
    async searchSeries() { return [summary]; },
    async seriesInfo() { return summary; },
    async settledSince(_rule: BurnRule, sinceIso: string | null): Promise<ResolvedSelector> {
      if (!rpc) throw new Error("onchain: no RPC configured");
      const n = await (id === "solana.slot" ? rpc.slot() : rpc.blockHeight());
      const day = new Date(now()).toISOString().slice(0, 10);
      const ev: SettledEvent = { id: day, at: day, result: null, value: String(n), title: `${f.title} on ${day} (first read of the day)`, sourceUrl: `${o.rpcUrl ?? "https://api.mainnet-beta.solana.com"} ${f.method}` };
      return { events: sinceIso !== null && ev.at <= sinceIso ? [] : [ev], awaitingFinal: 0, refusals: [], settlementSourceUrl: summary.settlementSource!.url };
    },
    async impliedChance(): Promise<ImpliedChance> { return { chance: null, marketTicker: null, closeTime: null, basis: "on-chain fact: there is no market to read" }; },
  };
}

/** A port over @solana/web3.js, built only when an RPC URL is configured. */
export async function web3RpcPort(rpcUrl: string): Promise<SolanaRpcPort> {
  const { Connection, PublicKey } = await import("@solana/web3.js");
  const c = new Connection(rpcUrl, "finalized");
  return { blockHeight: () => c.getBlockHeight("finalized"), slot: () => c.getSlot("finalized"), accountLamports: async (pk) => { const a = await c.getAccountInfo(new PublicKey(pk), "finalized"); return a ? BigInt(a.lamports) : null; } };
}
