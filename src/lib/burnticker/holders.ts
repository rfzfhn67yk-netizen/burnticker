import { PublicKey } from "@solana/web3.js";
import type { Rpc } from "@/lib/burnticker/trustpack/receiptCheck";
import { rawToTokens } from "@/lib/burnKeeper/rules";
import { CPMM_PROGRAM_ID, launchLabAuth, launchLabProgramFor } from "@/lib/burnKeeper/launchlab";
import { decodeMintSupply, rpcErrorText } from "@/lib/burnticker/market";

/**
 * HOLDER COUNT AND TOP-10 CONCENTRATION (indexer-1, 2026-10-12; PLATFORM-NEXT-2 item 3). A holder is a wallet whose token accounts for
 * the coin hold more than zero; the count is every such wallet, read from the chain through the host's own RPC, never estimated:
 *
 *   1. getTokenAccounts (the DAS-style index Helius serves, and the public mainnet endpoint serves under its own parameter name), paged
 *      by cursor, zero balances left out;
 *   2. when the RPC has no such method: getProgramAccounts on the mint's token program, filtered to the mint, with a data slice of just
 *      owner and amount;
 *   3. when neither answers: "unavailable", with the reason. A count is never shown from a partial list: past MAX_TOKEN_ACCOUNTS the
 *      read stops and says so.
 *
 * Concentration is the share of the mint's current supply (burns already off it) held by the ten largest wallets. Owners the caller
 * labels (the bonding curve's and the trading pool's vault authority, the burn pool) are marked, and a second share leaves them out,
 * since a curve vault holding most of a new coin is not a whale. Results are cached per mint for ten minutes; a failed read is kept one
 * minute so a passing RPC hiccup does not stick. Server-only (it reads through an RPC). Nothing here signs or sends.
 */

export const HOLDERS_CACHE_MS = 10 * 60_000;
export const HOLDERS_FAIL_CACHE_MS = 60_000;
/** Stop counting past this many token accounts rather than show a number built from part of the list. */
export const MAX_TOKEN_ACCOUNTS = 50_000;
const PAGE = 1000;

export interface HolderTopRow { owner: string; amount: string; pct: number | null; label: string | null }
export type HoldersRead =
  | { state: "read"; source: "das" | "program-accounts"; holders: number; /** B-6: the holders that are wallets (programOwnedOwner excluded) */ wallets?: number; tokenAccounts: number; top10: HolderTopRow[]; top10Pct: number | null; top10PctUnlabelled: number | null; supply: string; readAt: string }
  | { state: "unavailable"; reason: string; /** the RPC's own error, when there was one */ detail?: string; readAt: string };

export const UNAVAILABLE_NO_INDEX = "This RPC cannot count holders. It has no token-account index, and it refused to list the coin's accounts.";

const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

/** The vault authorities a coin's own pools hold tokens under, labelled for the top-10 list (the caller adds the burn pool and creator). */
export function poolOwnerLabels(cluster: string): Record<string, string> {
  const ll = launchLabProgramFor(cluster as "mainnet" | "devnet");
  const cpmm = cluster === "mainnet" ? CPMM_PROGRAM_ID.mainnet : cluster === "devnet" ? CPMM_PROGRAM_ID.devnet : null;
  const out: Record<string, string> = {};
  if (ll) out[launchLabAuth(ll).toBase58()] = "bonding curve";
  if (cpmm) out[PublicKey.findProgramAddressSync([Buffer.from("vault_and_lp_mint_auth_seed", "utf8")], cpmm)[0].toBase58()] = "trading pool";
  return out;
}

/**
 * THIRD PRELAUNCH AUDIT 2026-10-19 B-6: "Holders 1" on every coin nobody had traded (that one holder is the bonding curve's vault). The
 * labels that name a program's own account (the curve, the trading pool, the burn pool) and any owner that is not a wallet key (an
 * off-curve program address) are not counted as holders; `wallets` is the count without them.
 */
export const PROGRAM_OWNER_LABELS: readonly string[] = ["bonding curve", "trading pool", "burn pool"];
export function programOwnedOwner(owner: string, labels: Record<string, string> = {}): boolean {
  if (labels[owner] && PROGRAM_OWNER_LABELS.includes(labels[owner])) return true;
  try { return !PublicKey.isOnCurve(new PublicKey(owner).toBytes()); } catch { return false; }
}

/** Wallet balances → the read (count, top ten, shares). Pure; exported for tests. */
export function summarizeHolders(balances: Iterable<{ owner: string; amountRaw: bigint }>, supplyRaw: bigint, decimals: number, labels: Record<string, string> = {}): { holders: number; wallets: number; top10: HolderTopRow[]; top10Pct: number | null; top10PctUnlabelled: number | null } {
  const byOwner = new Map<string, bigint>();
  for (const b of balances) if (b.amountRaw > BigInt(0)) byOwner.set(b.owner, (byOwner.get(b.owner) ?? BigInt(0)) + b.amountRaw);
  const sorted = [...byOwner.entries()].sort((a, b) => (a[1] === b[1] ? (a[0] < b[0] ? -1 : 1) : a[1] > b[1] ? -1 : 1));
  const pct = (raw: bigint) => (supplyRaw > BigInt(0) ? Number((raw * BigInt(1_000_000)) / supplyRaw) / 10_000 : null);
  const sum = (rows: [string, bigint][]) => rows.reduce((a, r) => a + r[1], BigInt(0));
  const top = sorted.slice(0, 10), topU = sorted.filter(([o]) => !labels[o]).slice(0, 10);
  return {
    holders: byOwner.size,
    wallets: [...byOwner.keys()].filter((o) => !programOwnedOwner(o, labels)).length,
    top10: top.map(([owner, raw]) => ({ owner, amount: rawToTokens(raw, decimals), pct: pct(raw), label: labels[owner] ?? null })),
    top10Pct: sorted.length ? pct(sum(top)) : null,
    top10PctUnlabelled: topU.length ? pct(sum(topU)) : null,
  };
}

/** An amount as an RPC sends it (a JSON number or a decimal string) → raw units; null when it is not a whole non-negative number. */
function amountOf(v: unknown): bigint | null {
  if (typeof v === "number" && Number.isInteger(v) && v >= 0) return BigInt(v);
  if (typeof v === "string" && /^\d+$/.test(v)) return BigInt(v);
  return null;
}
const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const methodMissing = (m: string) => /method not found|-32601|not supported|unknown method|does not exist/i.test(m);
class Refusal extends Error {}

type DasStyle = "mint" | "mintAddress";
/** Pages through getTokenAccounts. Throws Refusal for a wrong-shaped answer or too many accounts; other errors come through as thrown. */
async function readDas(rpc: Rpc, mint: string, style: DasStyle): Promise<{ owner: string; amountRaw: bigint }[]> {
  const out: { owner: string; amountRaw: bigint }[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;
  for (let page = 1; ; page++) {
    const params: Record<string, unknown> = style === "mint" ? { mint, limit: PAGE, options: { showZeroBalance: false } } : { mintAddress: mint, limit: PAGE };
    if (cursor) params.cursor = cursor; else if (page > 1) params.page = page;
    const r = await rpc.call<unknown>("getTokenAccounts", params as unknown as unknown[]);
    if (!isObj(r) || !Array.isArray(r.token_accounts)) throw new Refusal("The RPC's getTokenAccounts answer was not a list of token accounts.");
    let fresh = 0;
    for (const a of r.token_accounts as unknown[]) {
      if (!isObj(a) || typeof a.owner !== "string" || typeof a.address !== "string" || (a.mint !== undefined && a.mint !== mint)) throw new Refusal("The RPC's getTokenAccounts answer held an entry that was not a token account of this coin.");
      const amt = amountOf(a.amount);
      if (amt === null) throw new Refusal("The RPC's getTokenAccounts answer held an amount that is not a whole number.");
      if (seen.has(a.address)) continue;
      seen.add(a.address); fresh++;
      out.push({ owner: a.owner, amountRaw: amt });
    }
    if (seen.size > MAX_TOKEN_ACCOUNTS) throw new Refusal(`This coin has more than ${MAX_TOKEN_ACCOUNTS.toLocaleString("en-US")} token accounts. This site stops counting there rather than show a partial count.`);
    if (r.token_accounts.length < PAGE) return out;
    if (fresh === 0) throw new Refusal("The RPC kept sending the same token accounts, so the count could not finish.");
    cursor = typeof r.cursor === "string" && r.cursor ? r.cursor : null;
  }
}

async function readProgramAccounts(rpc: Rpc, mint: string, tokenProgram: string): Promise<{ owner: string; amountRaw: bigint }[]> {
  const filters: unknown[] = [{ memcmp: { offset: 0, bytes: mint } }];
  if (tokenProgram === TOKEN_PROGRAM) filters.unshift({ dataSize: 165 });
  const r = await rpc.call<unknown>("getProgramAccounts", [tokenProgram, { encoding: "base64", commitment: "confirmed", dataSlice: { offset: 32, length: 40 }, filters }]);
  if (!Array.isArray(r)) throw new Refusal("The RPC's getProgramAccounts answer was not a list of accounts.");
  if (r.length > MAX_TOKEN_ACCOUNTS) throw new Refusal(`This coin has more than ${MAX_TOKEN_ACCOUNTS.toLocaleString("en-US")} token accounts. This site stops counting there rather than show a partial count.`);
  return r.map((e: unknown) => {
    const d = isObj(e) && isObj(e.account) && Array.isArray(e.account.data) && typeof e.account.data[0] === "string" ? Buffer.from(e.account.data[0], "base64") : null;
    if (!d || d.length !== 40 || !isObj(e) || !isObj(e.account) || e.account.owner !== tokenProgram) throw new Refusal("The RPC's getProgramAccounts answer held an entry that was not a token account.");
    return { owner: new PublicKey(d.subarray(0, 32)).toBase58(), amountRaw: d.readBigUInt64LE(32) };
  });
}

type Balances = { source: "das" | "program-accounts"; rows: { owner: string; amountRaw: bigint }[]; supplyRaw: bigint; decimals: number; readAt: string };
type Unavailable = Extract<HoldersRead, { state: "unavailable" }>;
const cache = new Map<string, { at: number; v: Balances | Unavailable }>();
/** For tests. */
export function clearHoldersCache(): void { cache.clear(); }

/**
 * Reads one mint's holders. `labels` maps owner wallets to a label for the top-10 list (poolOwnerLabels(cluster) plus the burn pool
 * and the creator, typically). Never throws; a failure is `{ state: "unavailable", reason }`. The balances are cached, so a second
 * caller with other labels costs no RPC call.
 */
export async function readHolders(rpc: Rpc, i: { cluster: string; mint: string; labels?: Record<string, string> }, now = Date.now()): Promise<HoldersRead> {
  const ck = `${i.cluster}:${i.mint}`;
  const hit = cache.get(ck);
  const ttl = (v: Balances | Unavailable) => ("rows" in v || v.reason === UNAVAILABLE_NO_INDEX ? HOLDERS_CACHE_MS : HOLDERS_FAIL_CACHE_MS);
  let v: Balances | Unavailable;
  if (hit && now - hit.at < ttl(hit.v)) v = hit.v;
  else { v = await readBalances(rpc, i.mint, now); cache.set(ck, { at: now, v }); }
  if (!("rows" in v)) return v;
  const s = summarizeHolders(v.rows, v.supplyRaw, v.decimals, i.labels ?? {});
  return { state: "read", source: v.source, holders: s.holders, wallets: s.wallets, tokenAccounts: v.rows.length, top10: s.top10, top10Pct: s.top10Pct, top10PctUnlabelled: s.top10PctUnlabelled, supply: rawToTokens(v.supplyRaw, v.decimals), readAt: v.readAt };
}

const transient = (m: string) => /rate-limited|HTTP 5\d\d|HTTP 429|fetch failed|timed? ?out|ECONN|ENOTFOUND|socket/i.test(m);

async function readBalances(rpc: Rpc, mint: string, now: number): Promise<Balances | Unavailable> {
  const readAt = new Date(now).toISOString();
  const unavailable = (reason: string, detail?: string): Unavailable => (detail ? { state: "unavailable", reason, detail, readAt } : { state: "unavailable", reason, readAt });
  try { new PublicKey(mint); } catch { return unavailable("This is not a mint address."); }
  // the mint: its supply (the shares are of it) and its token program (the fallback lists that program's accounts)
  let supplyRaw: bigint, decimals: number, tokenProgram: string;
  try {
    const r = await rpc.call<unknown>("getAccountInfo", [mint, { encoding: "base64", commitment: "confirmed" }]);
    if (!isObj(r) || !("value" in r)) return unavailable("The RPC sent back an answer that was not account data for the mint.");
    const a = r.value;
    if (a === null) return unavailable("The mint account was not found on this network.");
    if (!isObj(a) || typeof a.owner !== "string" || !Array.isArray(a.data) || typeof a.data[0] !== "string") return unavailable("The RPC sent back an answer that was not account data for the mint.");
    if (a.owner !== TOKEN_PROGRAM && a.owner !== TOKEN_2022) return unavailable("The account at this address is not a token mint.");
    const m = decodeMintSupply(new Uint8Array(Buffer.from(a.data[0], "base64")));
    if (!m) return unavailable("The account at this address is not a token mint.");
    supplyRaw = m.supplyRaw; decimals = m.decimals; tokenProgram = a.owner;
  } catch (e) { return unavailable("The mint could not be read just now.", rpcErrorText(e)); }

  const done = (source: Balances["source"], rows: Balances["rows"]): Balances => ({ source, rows, supplyRaw, decimals, readAt });
  // 1. the token-account index, in Helius's parameter style, then in the public endpoint's
  for (const style of ["mint", "mintAddress"] as const) {
    try { return done("das", await readDas(rpc, mint, style)); } catch (e) {
      if (e instanceof Refusal) return unavailable(e.message);
      const m = e instanceof Error ? e.message : String(e);
      if (methodMissing(m)) break;
      if (style === "mint" && /unknown field `?mint`?|mintAddress/i.test(m)) continue;
      return unavailable("The RPC's token-account index could not be read just now.", rpcErrorText(e));
    }
  }
  // 2. every token account of the mint, owner and amount only
  try { return done("program-accounts", await readProgramAccounts(rpc, mint, tokenProgram)); } catch (e) {
    if (e instanceof Refusal) return unavailable(e.message);
    const m = e instanceof Error ? e.message : String(e);
    return transient(m) ? unavailable("The coin's token accounts could not be listed just now.", rpcErrorText(e)) : unavailable(UNAVAILABLE_NO_INDEX, rpcErrorText(e));
  }
}
