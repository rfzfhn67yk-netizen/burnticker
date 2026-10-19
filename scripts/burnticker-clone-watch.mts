/**
 * THE CLONE WATCH, one scan (growth batch 2026-10-10; src/lib/burnticker/ops/cloneWatch.ts). Run every 15 minutes by
 * mct-burnticker-clonewatch.timer on the Burnticker host. Searches DexScreener (keyless) for Solana tokens named or tickered like
 * DEFICIT, Burnticker or a launched ticker; for each lookalike that is not a Burnticker coin it asks the burn_receipts program whether it
 * knows the mint (with BURNTICKER_PROGRAM_ID + BURNTICKER_RPC_URL; otherwise "not read"), reads the top holders and supply over the RPC
 * (BURNTICKER_RPC_URL, else the public endpoint) for the holder-stack signal, and appends one observation per token to the registry's
 * database. The page /burnticker/not-burnticker and GET /api/burnticker/v1/clones read those rows. Reads no key, signs nothing.
 *
 *   node --import ./test/alias-hook.mjs scripts/burnticker-clone-watch.mts            # scan and record
 *   node --import ./test/alias-hook.mjs scripts/burnticker-clone-watch.mts --dry-run  # scan and print, record nothing
 */
import { Connection, PublicKey } from "@solana/web3.js";
import { openRegistry, REGISTRY_FILE } from "@/lib/burnticker/registry";
import { ProgramBurnClient } from "@/lib/burnticker/programClient";
import { cloneStore, cloneTerms, evidenceLines, lpState, runCloneWatch, scanClones, termSinceFor, type CloneWatchDeps } from "@/lib/burnticker/ops/cloneWatch";
import type { FetchLike } from "@/lib/burnticker/oracle/types";

const dry = process.argv.includes("--dry-run");
const env = process.env;
const registry = openRegistry((env.BURNTICKER_DB ?? "").trim() || REGISTRY_FILE);
const tokens = registry.tokens();
const terms = cloneTerms(tokens.filter((t) => t.status !== "draft" && t.status !== "expired").map((t) => t.ticker));
const ownMints = new Set(tokens.map((t) => t.mint));
// the review of 2026-10-18: a candidate whose name holds a live coin's full name is listed too
const names = Object.fromEntries(tokens.filter((t) => t.status !== "draft" && t.status !== "expired").map((t) => [t.ticker.toUpperCase().replace(/[^A-Z0-9]/g, ""), t.name]));
const rpcUrl = (env.BURNTICKER_RPC_URL ?? "").trim() || "https://api.mainnet-beta.solana.com";
const conn = new Connection(rpcUrl, { commitment: "confirmed", disableRetryOnRateLimit: true });
const programId = (env.BURNTICKER_PROGRAM_ID ?? "").trim();
const program = programId && (env.BURNTICKER_RPC_URL ?? "").trim() ? new ProgramBurnClient({ connection: conn, programId: new PublicKey(programId), cluster: env.BURNTICKER_CLUSTER === "mainnet" ? "mainnet" : "devnet", payer: null, admin: null, solUsd: async () => { throw new Error("not used"); } }) : null;

const deps: CloneWatchDeps = {
  terms, names, ownMints, termSince: termSinceFor(tokens), fetchImpl: globalThis.fetch as unknown as FetchLike, now: () => Date.now(), pauseMs: 400,
  registered: program ? async (mint) => (await program.port(mint).config()) !== null : undefined,
  holders: async (mint) => {
    const pk = new PublicKey(mint);
    const [largest, supply] = await Promise.all([conn.getTokenLargestAccounts(pk), conn.getTokenSupply(pk)]);
    return { holders: largest.value.map((a) => ({ address: a.address.toBase58(), amount: a.amount })), supply: supply.value.amount, exclude: [] };
  },
};

const stamp = () => new Date().toISOString().slice(0, 19).replace("T", " ");
console.log(`[${stamp()}] clone watch: ${terms.length} term(s) (${terms.join(", ")}) · program ${program ? programId : "not read on this host"} · ${dry ? "DRY RUN" : "recording"}`);
if (dry) {
  const { observations, errors } = await scanClones(deps);
  for (const o of observations) console.log(`  ${o.symbol} ${o.mint}  ${evidenceLines({ mint: o.mint, chain: "solana", symbol: o.symbol, name: o.name, pool: o.pool, dex: o.dex, url: o.url, firstSeenAt: new Date(o.at).toISOString(), lastSeenAt: new Date(o.at).toISOString(), poolCreatedAt: o.poolCreatedAt ? new Date(o.poolCreatedAt).toISOString() : null, matched: o.matched, registered: o.registered, bundle: o.bundle, lp: lpState([{ at: o.at, liquidityUsd: o.liquidityUsd }]) }).join(" · ")}`);
  for (const e of errors) console.log(`  error: ${e}`);
} else {
  const r = await runCloneWatch(cloneStore(registry.db), deps);
  console.log(`[${stamp()}] recorded ${r.hits} observation(s)${r.errors.length ? `; ${r.errors.length} error(s): ${r.errors.join(" | ")}` : ""}`);
}
