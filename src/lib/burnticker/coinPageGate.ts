import fs from "node:fs";
import path from "node:path";
import { coinPageFound, deficitMintTarget, type CoinLookup } from "@/lib/burnticker/coinLookup";
import { isMintKey } from "@/lib/burnticker/coinKey";

/**
 * HB-100 REOPENED (hourly run 11): /burnticker/t/NOPE answered 404, but the coin layout's notFound() made Next send its bare error document:
 * the not-found words and links were only inside the client payload, so curl and an HTML-only reader saw none (the root layout's A-24 note).
 * An unmatched URL does not have that problem: Next renders the root not-found (the /burnticker 404 copy) on the server, under a 404. So the
 * proxy decides an unknown coin BEFORE rendering and rewrites it to an address no route matches; the registered-coin path is untouched.
 *
 * HB-152 (hourly run 13): the gate never opens the writable, migrating registry. It opens the registry file READ-ONLY (node:sqlite,
 * imported dynamically, busy timeout 250 ms, no migration, no file created when missing), reads the known-coin set in one query and keeps
 * it for a minute, so one read serves many requests. A miss on a set older than a few seconds reads once more before it answers 404, so a
 * coin launched a moment ago is never refused. Every failure FAILS OPEN (serves the page, where the layout's own check still answers),
 * and the proxy (coinPagePath.ts) also serves the page when the gate takes longer than 300 ms or fails to load.
 */
export { NO_SUCH_COIN_PATH, coinSegmentOf } from "@/lib/burnticker/coinPagePath";

/** What the gate knows: every mint in the registry (any status), and the tickers of LAUNCHED coins (coinLookup.ts lookupCoin, A-40). */
export type KnownCoins = { mints: ReadonlySet<string>; launchedTickers: ReadonlySet<string> };
export type KnownCoinsReader = (file: string) => Promise<KnownCoins | null>;

const KEEP_MS = 60_000;
const MISS_RECHECK_MS = 5_000;
export const GATE_BUSY_TIMEOUT_MS = 250;
/** The layout's registry file (registry.ts REGISTRY_FILE), named here so the proxy never loads the writable registry module. */
export const GATE_REGISTRY_FILE = path.join("data", "burnticker.db");

let known: { at: number; file: string; set: KnownCoins | null } | null = null;
let inflight: { file: string; p: Promise<KnownCoins | null> } | null = null;
let files: { at: number; served: { tickers: string[]; mints: string[] } | null; deficit: string | null } | null = null;

/** One read-only query of the registry file. null when it cannot be told (no file, an import or read failure). */
export async function readKnownCoins(file: string): Promise<KnownCoins | null> {
  try {
    if (!fs.existsSync(file)) return null;   // never create an empty registry (that would 404 every coin)
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      db.exec(`PRAGMA busy_timeout = ${GATE_BUSY_TIMEOUT_MS}`);
      const rows = db.prepare("SELECT mint, ticker, status FROM tokens").all() as { mint: string; ticker: string; status: string }[];
      const mints = new Set<string>(), launchedTickers = new Set<string>();
      for (const r of rows) {
        mints.add(r.mint);
        if (r.status !== "draft" && r.status !== "expired") launchedTickers.add(String(r.ticker).toUpperCase());
      }
      return { mints, launchedTickers };
    } finally { db.close(); }
  } catch { return null; }
}

async function knownCoins(file: string, now: number, read: KnownCoinsReader, wantFresh: boolean): Promise<KnownCoins | null> {
  const age = known && known.file === file ? now - known.at : Infinity;
  // a set is kept a minute; a failed read (null, served open) only a few seconds, so a registry back from a hiccup is read again soon
  if (known && age < (known.set ? KEEP_MS : MISS_RECHECK_MS) && !(wantFresh && age >= MISS_RECHECK_MS)) return known.set;
  if (!inflight || inflight.file !== file) {
    const p = read(file).catch(() => null);
    inflight = { file, p };
    void p.then(() => { if (inflight?.p === p) inflight = null; });
  }
  const set = await inflight.p;
  known = { at: now, file, set };
  return set;
}

/** lookupCoin's answer from the known set: a mint by any status, a ticker by launched coins only. */
export function knownLookup(k: KnownCoins, rawKey: string): CoinLookup {
  const key = rawKey.trim();
  if (!key) return { kind: "none" };
  const hit = key.length >= 32 || isMintKey(key) ? k.mints.has(key) : k.launchedTickers.has(key.toUpperCase());
  return hit ? { kind: "many", ticker: key.toUpperCase(), tokens: [] } : { kind: "none" };
}

function readFiles(root: string, now: number): NonNullable<typeof files> {
  if (files && now - files.at < KEEP_MS) return files;
  let served: { tickers: string[]; mints: string[] } | null = null, deficit: string | null = null;
  try {
    const t = JSON.parse(fs.readFileSync(path.join(root, "config", "burnticker", "transparency.json"), "utf8")) as { rehearsals?: { symbol?: string; mint?: string | null }[] };
    const r = Array.isArray(t.rehearsals) ? t.rehearsals : [];
    served = { tickers: r.flatMap((x) => (typeof x.symbol === "string" ? [x.symbol] : [])), mints: r.flatMap((x) => (typeof x.mint === "string" && x.mint ? [x.mint] : [])) };
  } catch { served = null; }   // unreadable: coinPageFound keeps the page
  try {
    const own = JSON.parse(fs.readFileSync(path.join(root, "config", "own-tokens.json"), "utf8")) as { tokens: { symbol: string; address: string | null; status: string }[] };
    const d = own.tokens.find((x) => x.symbol === "DEFICIT");
    deficit = d && d.status === "launched" ? d.address : null;
  } catch { deficit = null; }
  files = { at: now, served, deficit };
  return files;
}

/** True when /burnticker/t/<segment> is a page this site serves (or when that cannot be told); false only for a known-unknown coin. */
export async function coinSegmentServedAsync(segment: string, o: { root?: string; env?: Readonly<Record<string, string | undefined>>; now?: number; read?: KnownCoinsReader } = {}): Promise<boolean> {
  try {
    const now = o.now ?? Date.now();
    const f = readFiles(o.root ?? process.cwd(), now);
    const env = o.env ?? process.env;
    const file = (env.BURNTICKER_DB ?? "").trim() || GATE_REGISTRY_FILE;
    const read = o.read ?? readKnownCoins;
    const decide = (k: KnownCoins | null): boolean => {
      if (!k) return true;   // the registry cannot be read: serve the page
      if (coinPageFound(segment, (key) => knownLookup(k, key), f.served)) return true;
      // $DEFICIT by its mint redirects in the layout (walkthrough 13): never answered 404 here
      return deficitMintTarget(segment, f.deficit, false) !== null;
    };
    if (decide(await knownCoins(file, now, read, false))) return true;
    return decide(await knownCoins(file, now, read, true));   // a miss: re-read a set older than a few seconds before the 404
  } catch { return true; }
}

/** For tests: forget the kept set and files. */
export function clearCoinPageGate(): void { known = null; inflight = null; files = null; }
