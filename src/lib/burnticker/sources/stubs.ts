import type { BurnRule } from "@/lib/burnticker/rules";
import type { ImpliedChance, ResolvedSelector, SeriesSummary } from "@/lib/burnticker/oracle/types";
import type { ResolutionSource, SourceKind, Tier } from "@/lib/burnticker/sources/types";

/**
 * SOURCE STUBS (2026-10-09): the interface, a parser where a primary source exists, a fixture, one test — and `launchable: false`
 * with the reason, so nothing can be launched on them until they are built and verified. Each says plainly what was and was not
 * confirmed from primary sources.
 *
 *   polymarket (market, tier 1)  NO LONGER A STUB (2026-10-10): oracle/polymarket.ts is the live adapter — Gamma for discovery, the
 *                                 Conditional Tokens payout vector on Polygon (contract 0x4D97DCd97eC945f40cF65F87097ACe5EA0476045,
 *                                 payoutNumerators / payoutDenominator via eth_call) as the authoritative read; a reading is final
 *                                 only once the chain has the vector. `polymarketCard()` below is its catalogue card (launchable).
 *   uma (assertion, tier 2)       UMA Optimistic Oracle V3: getAssertion(assertionId) → { settled, settlementResolution, ... };
 *                                 an assertion counts only when settled and not disputed-and-lost. EVM read-only; fixture of the
 *                                 struct as eth_call returns it. Not wired.
 *   drift-bet / hedgehog (market) Solana-native prediction venues. NOT VERIFIED from primary sources on 2026-10-09: no public program
 *                                 documentation of a per-market resolution account was located; marked "unverified", no fixture of
 *                                 on-chain data is claimed. They stay stubs until their programs' account layouts are confirmed.
 */

const stub = (id: string, kind: SourceKind, tier: Tier, title: string, sourceName: string, sourceUrl: string, why: string, flags: string[]): ResolutionSource => {
  const summary: SeriesSummary = { oracle: id === "polymarket" ? "polymarket" : "catalogue", ticker: id, title, category: kind, frequency: null, settlementSource: { name: sourceName, url: sourceUrl }, tags: flags };
  return {
    id, kind, tier, title, sourceName, sourceUrl, cadence: "per market", unit: null, direction: null, baseline: null, carry: "none", valueLabel: null, flags, launchable: { ok: false, why },
    async searchSeries() { return []; }, async seriesInfo() { return summary; },
    async settledSince(_r: BurnRule): Promise<ResolvedSelector> { throw new Error(`${id}: ${why}`); },
    async impliedChance(): Promise<ImpliedChance> { return { chance: null, marketTicker: null, closeTime: null, basis: `${id}: stub` }; },
  };
};

export const CTF_POLYGON = "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045";
export const UMA_OOV3_ETHEREUM = "0xfb55F43fB9F48F63f9269DB7Dde3BbBe1ebDC0dE";

/** The Polymarket catalogue card (launchable since 2026-10-10; the adapter is oracle/polymarket.ts, not this stub factory's). */
export const polymarketCard = (): ResolutionSource => ({ ...stub("polymarket", "market", 1, "Polymarket (binary markets, result read on Polygon)", "Polymarket Gamma API + Conditional Tokens on Polygon", "https://gamma-api.polymarket.com", "the catalogue card reads nothing: settled results come from PolymarketClient (oracle/polymarket.ts)", ["market", "evm-read", "binary-only"]), launchable: { ok: true, why: null }, cadence: "per market (settled when the CTF payout vector is on chain)" });
export const umaStub = (): ResolutionSource => stub("uma", "assertion", 2, "UMA Optimistic Oracle V3 assertion", "UMA OO v3 (Ethereum)", `https://etherscan.io/address/${UMA_OOV3_ETHEREUM}`, "v1 stub: getAssertion(assertionId) read-only path not wired; an assertion counts only once settled", ["assertion", "evm-read", "stub"]);
export const driftBetStub = (): ResolutionSource => stub("drift-bet", "market", 1, "Drift BET (Solana)", "Drift prediction markets", "https://app.drift.trade/bet", "UNVERIFIED (2026-10-09): no primary-source documentation of a per-market on-chain resolution account was located; nothing is claimed", ["market", "solana", "unverified", "stub"]);
export const hedgehogStub = (): ResolutionSource => stub("hedgehog", "market", 1, "Hedgehog Markets (Solana)", "Hedgehog Markets", "https://hedgehog.markets", "UNVERIFIED (2026-10-09): no primary-source documentation of a per-market on-chain resolution account was located; nothing is claimed", ["market", "solana", "unverified", "stub"]);

/** Decodes a CTF payout vector from two eth_call results (payoutNumerators for each index, payoutDenominator). Pure; the fixture's shape. */
export function ctfOutcome(numerators: readonly bigint[], denominator: bigint): "yes" | "no" | "void" | null {
  if (denominator === BigInt(0)) return null;   // not reported yet
  const total = numerators.reduce((a, b) => a + b, BigInt(0));
  if (total !== denominator) return null;
  if (numerators.length !== 2) return null;
  if (numerators[0] === denominator) return "yes";
  if (numerators[1] === denominator) return "no";
  return "void";   // a split payout (50/50) = the market resolved to neither
}

/** Decodes a UMA OO v3 Assertion struct's `settled` and `settlementResolution` flags (ABI-decoded by the caller). Pure. */
export function umaOutcome(a: { settled: boolean; settlementResolution: boolean; disputer?: string | null }): "yes" | "no" | null {
  if (!a.settled) return null;
  return a.settlementResolution ? "yes" : "no";
}
