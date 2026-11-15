import fs from "node:fs";
import path from "node:path";
import type { Registry } from "@/lib/burnticker/registry";
import { loadTransparency } from "@/lib/burnticker/trust";

/**
 * TEST COINS OFF THE BROWSE SURFACES (owner, 2026-10-14: "hide the test coins, should only be the Eagles coin and $DEFICIT on the
 * website"). One rule, not a one-off: a coin marked test is left off every place people browse for coins (the home's featured cards and
 * activity line, the coins list and its search, the leaderboard, the sitemap and the keeper's static tokens.html) and is listed instead on
 * /burnticker/test-coins, which only the Trust page links. Its own page stays reachable by direct link, and the Trust page's rehearsal
 * section still discloses it ("listed so you can see it exists, not so you trade it").
 *
 * Where the mark lives:
 *   - an operator coin: `"test": true` on its entry in config/own-tokens.json ($REHEARSAL today). The bots' refusal list ignores the
 *     field, so the coin stays refused by address and ticker.
 *   - a disclosed test launch made through the site: the operator marks its registry row (registry.ts setTokenTest, the token_flags
 *     table), with scripts/burnticker-test-coin.mts.
 * Devnet coins are a separate rule (devnetHide.ts) and keep their own page, /burnticker/devnet.
 */

export const OWN_TOKENS_FILE = path.join("config", "own-tokens.json");
export { TEST_COINS_HREF } from "@/lib/burnticker/testCoinsCopy";

export interface TestCoin {
  ticker: string;
  mint: string | null;
  /** "operator": config/own-tokens.json; "registry": a registry row the operator marked */
  source: "operator" | "registry";
  /** the operator's plain sentence about the coin (the Trust page's rehearsal text when there is one) */
  text: string;
  /** the coin's own page on this site */
  pageHref: string;
}

export interface TestCoinKeys { mints: ReadonlySet<string>; tickers: ReadonlySet<string> }
export const NO_TEST_COINS: TestCoinKeys = { mints: new Set(), tickers: new Set() };

type OwnEntry = { symbol: string; address: string | null; status: string; test?: boolean; note?: string };
function ownEntries(root: string): OwnEntry[] {
  try { const j = JSON.parse(fs.readFileSync(path.join(root, OWN_TOKENS_FILE), "utf8")) as { tokens?: OwnEntry[] }; return Array.isArray(j.tokens) ? j.tokens : []; } catch { return []; }
}

/** The operator's test coins (config/own-tokens.json entries with `test: true`). */
export function operatorTestCoins(root = process.cwd()): TestCoin[] {
  let rehearsals: { symbol: string; mint?: string | null; text?: string }[] = [];
  try { rehearsals = loadTransparency(root).rehearsals as typeof rehearsals; } catch { rehearsals = []; }
  return ownEntries(root).filter((e) => e.test === true).map((e) => {
    const r = rehearsals.find((x) => x.symbol.toUpperCase() === e.symbol.toUpperCase());
    return { ticker: e.symbol.toUpperCase(), mint: e.address ?? r?.mint ?? null, source: "operator" as const, text: r?.text ?? e.note ?? "", pageHref: `/burnticker/t/${encodeURIComponent(e.symbol.toUpperCase())}` };
  });
}

/** Registry rows the operator marked test. An unreadable registry marks nothing (the browse surfaces then read it as before). */
export function registryTestCoins(reg: Pick<Registry, "testTokens" | "token"> | null | undefined): TestCoin[] {
  if (!reg) return [];
  let rows: { mint: string; note: string }[] = [];
  try { rows = reg.testTokens(); } catch { return []; }
  return rows.map((r) => {
    let t: ReturnType<Registry["token"]> = null;
    try { t = reg.token(r.mint); } catch { t = null; }
    return { ticker: t?.ticker ?? "", mint: r.mint, source: "registry" as const, text: r.note, pageHref: `/burnticker/t/${encodeURIComponent(r.mint)}` };
  });
}

/** Every test coin: the operator's, then the registry's. */
export function testCoins(root = process.cwd(), reg: Pick<Registry, "testTokens" | "token"> | null = null): TestCoin[] {
  return [...operatorTestCoins(root), ...registryTestCoins(reg)];
}

/**
 * The keys a browse surface hides by: every test coin's mint, and the tickers of the OPERATOR's test coins (their featured cards and
 * activity rows carry a ticker). A registry coin is hidden by its mint only, so a real coin that happens to share its ticker stays listed.
 */
export function testCoinKeys(root = process.cwd(), reg: (Pick<Registry, "testTokens" | "token"> & Partial<Pick<Registry, "syntheticTokens">>) | null = null): TestCoinKeys {
  const all = testCoins(root, reg);
  // 2026-10-15: the synthetic creator's coins are hidden by mint the same way (not listed on the test-coins page)
  let synthetic: string[] = [];
  try { synthetic = reg?.syntheticTokens ? reg.syntheticTokens().map((r) => r.mint) : []; } catch { synthetic = []; }
  return { mints: new Set([...all.map((c) => c.mint).filter((m): m is string => !!m), ...synthetic]), tickers: new Set(all.filter((c) => c.source === "operator").map((c) => c.ticker)) };
}

/** Whether a coin (by mint, or an operator coin by ticker) is a test coin. */
export function isTestCoin(keys: TestCoinKeys, c: { mint?: string | null; ticker?: string | null; address?: string | null }): boolean {
  const m = c.mint ?? c.address ?? null;
  if (m && keys.mints.has(m)) return true;
  return !m && !!c.ticker && keys.tickers.has(c.ticker.toUpperCase().replace(/^\$/, ""));
}

/** Rows without the test coins (by mint). */
export function withoutTestCoins<T extends { mint?: string | null }>(rows: readonly T[], keys: TestCoinKeys): T[] {
  return rows.filter((r) => !(r.mint && keys.mints.has(r.mint)));
}
