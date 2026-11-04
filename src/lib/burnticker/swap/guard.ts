import { hostCluster } from "@/lib/burnticker/launchAvailability";
import { loadTransparency, teamWallets } from "@/lib/burnticker/trust";
import { operatorTreasuryRecord } from "@/lib/burnticker/lockFees";

/**
 * THE SWAP PANEL'S GUARD LIST (swap-1, 2026-10-14; server side, served by /api/burnticker/swap-guard). The trust page's rule: the
 * operator's own wallets never trade platform coins. The panel refuses any wallet listed here: every wallet the transparency record
 * names (by pubkey, or by the environment variable holding a public key), the trust page's team wallets and the cluster's operator
 * treasury. It also names the disclosed test coins (transparency.json `rehearsals`), which the panel never swaps, and this host's
 * network. Public keys only, all already shown on the trust page; no secret is read.
 */
export interface SwapGuard { cluster: "mainnet" | "devnet" | "localnet"; operatorWallets: string[]; testMints: string[] }

const PUB = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function swapGuard(env: Readonly<Record<string, string | undefined>> = process.env, root = process.cwd()): SwapGuard {
  const cluster = hostCluster(env);
  const t = loadTransparency(root);
  const fromRecord = t.wallets.flatMap((w) => [w.pubkey, w.envVar ? (env[w.envVar] ?? "").trim() : null]);
  const team = teamWallets(env, root).wallets.map((w) => w.pubkey);
  const treasury = operatorTreasuryRecord(cluster).address;
  const bounty = t.howBuilt.bounty?.wallet ?? null;
  const operatorWallets = [...new Set([...fromRecord, ...team, treasury, bounty].filter((x): x is string => typeof x === "string" && PUB.test(x)))].sort();
  const testMints = t.rehearsals.flatMap((r) => (r.mint && PUB.test(r.mint) ? [r.mint] : []));
  return { cluster, operatorWallets, testMints };
}
