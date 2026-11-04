// POLYMARKET RESOLUTION, FROM THE CHAIN (2026-10-09) — reads a market's CTF payout vector on Polygon (read-only, public RPC, no key).
//
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/alias-hook.mjs scripts/burnkeeper-attest-polymarket.mts \
//        read <conditionId | gamma market id | gamma slug> [--rpc=<url>] [--no-gamma]
//
// With a gamma id/slug the condition id and outcome labels come from gamma-api.polymarket.com; the RESULT always comes from the
// ConditionalTokens contract. Prints JSON; exit 0 resolved, 2 unresolved, 1 error.

import { readConditionResolution, outcomeLabel, isConditionId, POLYMARKET_CTF } from "../src/lib/burnKeeper/attesters/polymarketOnchain.ts";

const args = process.argv.slice(2);
const cmd = args[0];
const opt = (n: string): string | undefined => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const flag = (n: string) => args.includes(`--${n}`);

async function gammaLookup(ref: string): Promise<{ conditionId: string; question: string; outcomes: string[]; resolvedBy: string | null; umaResolutionStatus: string | null } | null> {
  const url = /^\d+$/.test(ref) ? `https://gamma-api.polymarket.com/markets/${ref}` : isConditionId(ref) ? `https://gamma-api.polymarket.com/markets?condition_ids=${ref}` : `https://gamma-api.polymarket.com/markets?slug=${encodeURIComponent(ref)}`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) return null;
  const j = (await res.json()) as unknown;
  const m = (Array.isArray(j) ? j[0] : j) as Record<string, unknown> | undefined;
  if (!m || !isConditionId(m.conditionId)) return null;
  let outcomes: string[] = [];
  try { outcomes = JSON.parse(String(m.outcomes ?? "[]")) as string[]; } catch { /* labels are a convenience */ }
  return { conditionId: m.conditionId, question: String(m.question ?? ""), outcomes, resolvedBy: (m.resolvedBy as string) ?? null, umaResolutionStatus: (m.umaResolutionStatus as string) ?? null };
}

if (cmd !== "read" || !args[1]) {
  console.error("usage: burnkeeper-attest-polymarket.mts read <conditionId | gamma id | slug> [--rpc=<url>] [--no-gamma]");
  process.exit(1);
}

try {
  const ref = args[1];
  const gamma = flag("no-gamma") && isConditionId(ref) ? null : await gammaLookup(ref).catch(() => null);
  const conditionId = isConditionId(ref) ? ref : gamma?.conditionId;
  if (!conditionId) throw new Error(`could not resolve ${ref} to a condition id (pass the 0x… condition id, or a gamma market id/slug)`);
  const r = await readConditionResolution(conditionId, { rpcUrls: opt("rpc") ? [opt("rpc")!] : undefined });
  const out = { ...r, contract: POLYMARKET_CTF, gamma: gamma ? { question: gamma.question, outcomes: gamma.outcomes, resolvedBy: gamma.resolvedBy, umaResolutionStatus: gamma.umaResolutionStatus } : null, outcomeLabel: gamma ? outcomeLabel(r, gamma.outcomes) : null,
    verify: `curl -s -X POST -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"eth_call","params":[{"to":"${POLYMARKET_CTF}","data":"0xdd34de67${conditionId.slice(2)}"},"latest"]}' ${r.rpcUrl}   # payoutDenominator; 0x…01 = resolved` };
  console.log(JSON.stringify(out, null, 2));
  process.exit(r.resolved ? 0 : 2);
} catch (e) {
  console.error(`error: ${(e as Error).message}`);
  process.exit(1);
}
