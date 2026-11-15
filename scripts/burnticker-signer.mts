// THE SECOND READING SIGNER (signer-2, 2026-10-12; docs/burnticker/SIGNER-TWO.md and SIGNER-TWO-ROLLOUT.md). Runs on its OWN small host,
// never on the keeper's box and never on the trading VPS. For every reading the keeper asks it to co-sign, it reads the coin's rules and
// the primary source itself, works out the reading with the keeper's own code, and signs the exact message only when its bytes equal the
// keeper's. It never sends a transaction and never holds funds; its RPC is read-only (the coin's TokenConfig).
//
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/alias-hook.mjs scripts/burnticker-signer.mts [serve|decide <request.json>|health]
//
//   serve    (default) listen on BURNTICKER_COSIGNER_LISTEN for POST /v1/cosign and GET /v1/health
//   decide   decide one saved request (a dry run of the same decision; prints the answer; signs only with --sign)
//   health   print what the service would serve (key, program, cluster, coins) and exit
//
// Environment (NAMES ONLY; the values live in the host's local env file, read by scripts/service/run-burnticker-signer.sh):
//   BURNTICKER_COSIGNER_KEY         the signer's encrypted key file (must end in .enc.json; outside any repository; mode 600)
//   BURNTICKER_COSIGNER_PASSPHRASE  its passphrase (the owner's; never printed)
//   BURNTICKER_COSIGNER_CLUSTER     mainnet | devnet | localnet
//   BURNTICKER_COSIGNER_PROGRAM_ID  the burn_receipts program id it signs for
//   BURNTICKER_COSIGNER_RPC_URL     a READ-ONLY RPC for the coins' TokenConfig (the previous reading date, the pinned rules hash, the attesters)
//   BURNTICKER_COSIGNER_COINS       the coins it serves: JSON [{ "mint", "ticker", "kind": "debt" | "units", "rulesFile", "baselineAt" }]
//   BURNTICKER_COSIGNER_JOURNAL     every message it signed (append-only JSON lines; default ~/.local/share/burnticker-cosigner/journal.jsonl)
//   BURNTICKER_COSIGNER_LISTEN      host:port (default 127.0.0.1:8790; a tailnet 100.x address so the keeper's box can reach it)
//   BURNTICKER_COSIGNER_TOKEN       the bearer token the keeper sends (required unless listening on loopback)
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { Connection, PublicKey } from "@solana/web3.js";
import { GENESIS_HASH, LOCALNET_GENESIS_TAG } from "../src/lib/burnReceipts/constants.ts";
import { fetchTokenConfig } from "../src/lib/burnReceipts/accounts.ts";
import { loadKeypair } from "../src/lib/burnKeeper/keyfile.ts";
import { fetchDebtHistoryRows, validateDebtResponse } from "../src/lib/burnKeeper/feeds/treasury.ts";
import { wideRule } from "../src/lib/burnticker/registry.ts";
import { CatalogueAdapter } from "../src/lib/burnticker/catalogue/index.ts";
import { PolymarketClient } from "../src/lib/burnticker/oracle/polymarket.ts";
import { loadRefuseList, refusalsFor } from "../src/lib/burnticker/oracle/refuse.ts";
import type { BurnRule } from "../src/lib/burnticker/rules.ts";
import type { SettledEvent } from "../src/lib/burnticker/units.ts";
import { cosignHttpHandler, decideCosign, fileJournal, memoryJournal, type SignerChainView, type SignerCoin, type SignerDeps } from "../src/lib/burnticker/attesters/cosignSigner.ts";

const args = process.argv.slice(2);
const cmd = args[0] && !args[0].startsWith("--") ? args[0] : "serve";
const log = (s: string) => console.log(`[${new Date().toISOString().replace("T", " ").slice(0, 19)}Z] ${s}`);
const die = (s: string): never => { console.error(`signer: ${s}`); process.exit(2); };
const env = (n: string) => process.env[n]?.trim() || undefined;

const cluster = env("BURNTICKER_COSIGNER_CLUSTER") ?? die("BURNTICKER_COSIGNER_CLUSTER (mainnet | devnet | localnet) is required");
if (!["mainnet", "devnet", "localnet"].includes(cluster)) die(`BURNTICKER_COSIGNER_CLUSTER=${cluster}: expected mainnet, devnet or localnet`);
const genesis = cluster === "localnet" ? LOCALNET_GENESIS_TAG : GENESIS_HASH[cluster as "mainnet" | "devnet"];
const programId = env("BURNTICKER_COSIGNER_PROGRAM_ID") ?? die("BURNTICKER_COSIGNER_PROGRAM_ID is required");
new PublicKey(programId);

// ---- the coins (rules read from files this host holds; the chain's pinned hash is checked on every decision) ----
const coinsFile = env("BURNTICKER_COSIGNER_COINS") ?? die("BURNTICKER_COSIGNER_COINS (a JSON file listing the coins) is required");
const coinList = (JSON.parse(fs.readFileSync(coinsFile, "utf8")) as { mint: string; ticker: string; kind: "debt" | "units"; rulesFile: string; baselineAt: string }[]).map((c): SignerCoin => {
  if (c.kind !== "debt" && c.kind !== "units") die(`${c.ticker}: kind must be "debt" or "units"`);
  if (!Number.isFinite(Date.parse(c.baselineAt))) die(`${c.ticker}: baselineAt must be an ISO time (the launch)`);
  new PublicKey(c.mint);
  const rulesPath = path.isAbsolute(c.rulesFile) ? c.rulesFile : path.join(path.dirname(coinsFile), c.rulesFile);
  return { mint: c.mint, ticker: c.ticker, kind: c.kind, rulesText: fs.readFileSync(rulesPath, "utf8"), baselineAt: c.baselineAt };
});
const coins = new Map(coinList.map((c) => [c.mint, c]));

// ---- the key ----
const keyPath = env("BURNTICKER_COSIGNER_KEY") ?? die("BURNTICKER_COSIGNER_KEY is required");
if (!keyPath.endsWith(".enc.json")) die("BURNTICKER_COSIGNER_KEY must be an encrypted key file ending in .enc.json (made with burnticker-attester.mts keygen and a passphrase)");
const kp = (() => { try { return loadKeypair({ keyPath, passphrase: env("BURNTICKER_COSIGNER_PASSPHRASE") }); } catch (e) { return die(`the key could not be loaded: ${(e as Error).message}`); } })();

// ---- the sources, read by this host ----
const SOURCE_CACHE_MS = 5 * 60_000;
const cache = new Map<string, { at: number; events: SettledEvent[] }>();
async function readings(rule: BurnRule): Promise<SettledEvent[]> {
  const wide = wideRule(rule);
  const k = JSON.stringify(wide);
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < SOURCE_CACHE_MS) return hit.events;
  let events: SettledEvent[];
  if (wide.oracle === "catalogue") events = (await new CatalogueAdapter().settledSince(wide, null)).events;
  else if (wide.oracle === "polymarket") events = (await new PolymarketClient({ refuse: (titles) => [...new Set(refusalsFor(loadRefuseList(), { titles }).map((x) => x.reason))] }).settledSince(wide, null)).events;
  else throw new Error(`oracle ${wide.oracle}: no independent reader on this signer`);
  cache.set(k, { at: Date.now(), events });
  return events;
}
async function debtRows(from: string) {
  const v = validateDebtResponse(await fetchDebtHistoryRows(from));
  return v.readings;
}

// ---- the chain (read only) ----
const rpcUrl = env("BURNTICKER_COSIGNER_RPC_URL");
const conn = rpcUrl ? new Connection(rpcUrl, "confirmed") : null;
if (!conn && cmd === "serve" && cluster !== "localnet") die("BURNTICKER_COSIGNER_RPC_URL is required to serve on mainnet or devnet (the previous reading date and the pinned rules hash come from the chain)");
async function chain(mint: string): Promise<SignerChainView | null> {
  const r = await fetchTokenConfig(conn!, new PublicKey(programId), new PublicKey(mint));
  if (!r) return null;
  const c = r.config;
  return { genesis: c.cluster_genesis.toBase58(), programId, rulesSha256: Buffer.from(c.rules_sha256).toString("hex"), feedId: c.feedId, valueDecimals: c.rule.value_decimals, hasBaseline: c.has_baseline, lastRecordDate: c.last_record_date, attesters: c.activeAttesters.map((a) => a.key.toBase58()) };
}

const journalFile = env("BURNTICKER_COSIGNER_JOURNAL") ?? path.join(os.homedir(), ".local", "share", "burnticker-cosigner", "journal.jsonl");
const deps = (sign: boolean): SignerDeps => ({
  programId, genesis, secretKey: kp.secretKey, coin: async (m) => coins.get(m) ?? null, readings, debtRows, ...(conn ? { chain } : {}),
  journal: sign ? fileJournal(journalFile) : memoryJournal(), now: () => Date.now(), log,
});
const info = () => ({ service: "burnticker-cosigner", key: kp.publicKey.toBase58(), programId, cluster, coins: coinList.map((c) => ({ mint: c.mint, ticker: c.ticker, kind: c.kind })), readOnlyRpc: !!conn });

if (cmd === "health") { console.log(JSON.stringify(info(), null, 2)); process.exit(0); }

if (cmd === "decide") {
  const file = args[1] ?? die("decide <request.json> needs a saved request");
  const sign = args.includes("--sign");
  const answer = await decideCosign(deps(sign), JSON.parse(fs.readFileSync(file, "utf8")));
  console.log(JSON.stringify(sign ? answer : answer.status === "signed" ? { status: "signed", key: answer.key, note: "a dry run: the signature is not printed and nothing was journaled (pass --sign to keep it)" } : answer, null, 2));
  process.exit(answer.status === "disagree" ? 1 : 0);
}

if (cmd !== "serve") die(`unknown command ${cmd} (serve, decide <request.json>, health)`);
const listen = env("BURNTICKER_COSIGNER_LISTEN") ?? "127.0.0.1:8790";
const m = /^([0-9.]+|localhost|\[[0-9a-f:]+\]):(\d{2,5})$/i.exec(listen) ?? die(`BURNTICKER_COSIGNER_LISTEN=${listen}: expected host:port`);
const host = m[1].replace(/^\[|\]$/g, ""), port = Number(m[2]);
const loopback = host === "127.0.0.1" || host === "localhost" || host === "::1";
if (host === "0.0.0.0" || host === "::") die("refusing to listen on every interface: bind the tailnet address (100.x) or loopback");
const token = env("BURNTICKER_COSIGNER_TOKEN") ?? null;
if (!loopback && !token) die("BURNTICKER_COSIGNER_TOKEN is required when listening beyond loopback");
const server = http.createServer(cosignHttpHandler(deps(true), { token, info }));
server.listen(port, host, () => log(`second signer ${kp.publicKey.toBase58()} serving ${coinList.map((c) => `$${c.ticker}`).join(", ") || "no coins"} on ${host}:${port} (${cluster}, program ${programId.slice(0, 8)}…; journal ${journalFile})`));
const stop = () => { log("stopping"); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 5_000).unref(); };
process.on("SIGTERM", stop); process.on("SIGINT", stop);
