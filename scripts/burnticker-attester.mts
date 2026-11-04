// BRING YOUR OWN ATTESTER (trust-ops item 3, 2026-10-10 night; guide: docs/burnticker/ATTESTERS.md). Run from the PUBLIC tree on your own
// machine. Nothing here sends a transaction: `propose` and `apply` print the unsigned instruction (the config authority — the Squads
// vault — signs a proposal; anyone may send an apply after the 48 h timelock), `read` prints a signed reading message.
//
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/alias-hook.mjs scripts/burnticker-attester.mts <command> [flags]
//
//   keygen --out ~/.config/burnticker-attester/key.json
//        A fresh ed25519 key (mode 600, refused inside a repository; <out>.address holds the public key). Encrypted (AES-256-GCM +
//        scrypt, the keeper's format) when BURNTICKER_ATTESTER_PASSPHRASE is set in the environment; else plain solana-keygen JSON.
//   read <mint> <YYYY-MM-DD> --site https://burnticker.com [--key <file>] [--rpc <url>] [--cluster devnet|mainnet] [--program <id>] [--prev <date>]
//        Fetches the coin's rules.json and baseline from the site (the rules hash is checked against the site's — and the chain's with
//        --rpc), RE-READS THE SOURCE YOURSELF through the same adapter the keeper uses (catalogue feeds and Polymarket's on-chain payout),
//        runs the keeper's own engine over it and prints the unit counter for that day, the receipts counted into it, the exact message the
//        program verifies and — with --key — your signature over it. With --rpc it also compares your value, previous date and source hash
//        against the program's Reading account for that day (a watchdog check that needs no key at all).
//        Offline instead of --site: --rules <rules.json> --ticker <T> --baseline <ISO time>. --readings-from-site uses the site's
//        published readings instead of re-reading the source (NOT independent; the output says so).
//   status <mint> --rpc <url> [--program <id>]
//        The coin's attesters on chain: keys, kind, when each joined, when each is senior (7 days), the quorum, a pending change and its ETA.
//   propose <mint> --add <pubkey> [--kind 0|1|2] [--remove <pubkey>] [--quorum <n>] --rpc <url> [--program <id>]
//        Checks the change against the program's rules (quorum never lowered; keep ≥ quorum current keys; fewer new keys than the new
//        quorum; new keys only on the strength of ≥ quorum kept keys aged 7 days) and prints the unsigned propose_attesters instruction
//        for the config authority. Exit 1 when the program would refuse it.
//   apply <mint> --payer <pubkey> --rpc <url> [--program <id>]
//        The permissionless apply_attester_change instruction (valid once the ETA has passed), unsigned.
//
// The admin CLI (scripts/burnreceipts-admin.mts) has no attester commands; these build the same instructions with the same client
// (src/lib/burnReceipts/instructions.ts). Defaults: --cluster devnet, --program = the cluster's published burn_receipts id.
import fs from "node:fs";
import { Connection, PublicKey } from "@solana/web3.js";
import { GENESIS_HASH } from "../src/lib/burnReceipts/constants.ts";
import { fetchReading, fetchTokenConfig } from "../src/lib/burnReceipts/accounts.ts";
import { applyAttesterChangeIx, proposeAttestersIx } from "../src/lib/burnReceipts/instructions.ts";
import { loadKeypair } from "../src/lib/burnKeeper/keyfile.ts";
import { lockRule } from "../src/lib/burnticker/rules.ts";
import { wideRule } from "../src/lib/burnticker/registry.ts";
import { CatalogueAdapter } from "../src/lib/burnticker/catalogue/index.ts";
import { PolymarketClient } from "../src/lib/burnticker/oracle/polymarket.ts";
import { loadRefuseList, refusalsFor } from "../src/lib/burnticker/oracle/refuse.ts";
import { DEVNET_PROGRAM_ID } from "../src/lib/burnticker/trustpack/samples.ts";
import type { SettledEvent } from "../src/lib/burnticker/units.ts";
import { attesterStatus, checkProposal, compareChain, counterAt, keygen, parseDay, readingMessage, signReading } from "../src/lib/burnticker/attesters/byo.ts";

const args = process.argv.slice(2);
const cmd = args[0];
const BOOL = new Set(["--json", "--readings-from-site"]);
const pos: string[] = [];
for (let i = 1; i < args.length; i++) { const a = args[i]; if (a.startsWith("--")) { if (!BOOL.has(a) && !a.includes("=")) i++; } else pos.push(a); }
const opt = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : undefined; };
const flag = (n: string) => args.includes(`--${n}`);
const die = (s: string, code = 2): never => { console.error(`attester: ${s}`); process.exit(code); };
const print = (o: unknown) => console.log(JSON.stringify(o, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
const usage = () => { console.error(fs.readFileSync(new URL(import.meta.url)).toString().split("\n").filter((l) => l.startsWith("//")).map((l) => l.slice(3)).join("\n")); process.exit(2); };

const cluster = opt("cluster") === "mainnet" ? "mainnet" : "devnet";
const programId = () => { const p = opt("program") ?? process.env.BURNTICKER_PROGRAM_ID?.trim() ?? (cluster === "devnet" ? DEVNET_PROGRAM_ID : undefined); if (!p) die("--program <burn_receipts id> is required on mainnet"); return new PublicKey(p!); };
const rpc = () => { const u = opt("rpc"); if (!u) die("--rpc <url> is required for this command"); return new Connection(u!, "confirmed"); };
const mintArg = () => { const m = pos[0]; if (!m || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(m)) die("<mint> (base58) is required"); return m!; };
const cfgOrDie = async (c: Connection, mint: string) => { const r = await fetchTokenConfig(c, programId(), new PublicKey(mint)); if (!r) die(`no burn_receipts TokenConfig for ${mint} under program ${programId().toBase58()} on this RPC`); return r!; };

if (!cmd || !["keygen", "read", "status", "propose", "apply"].includes(cmd)) usage();

if (cmd === "keygen") {
  const out = opt("out") ?? die("--out <path outside any repository> is required");
  try { print(keygen({ out: out!, passphrase: process.env.BURNTICKER_ATTESTER_PASSPHRASE?.trim() || null })); } catch (e) { die((e as Error).message); }
  process.exit(0);
}

if (cmd === "status") {
  const mint = mintArg(); const c = rpc(); const { config } = await cfgOrDie(c, mint);
  print({ mint, programId: programId().toBase58(), ...attesterStatus(config, Math.floor(Date.now() / 1000)) });
  process.exit(0);
}

if (cmd === "propose" || cmd === "apply") {
  const mint = mintArg(); const c = rpc(); const { config } = await cfgOrDie(c, mint);
  const now = Math.floor(Date.now() / 1000);
  if (cmd === "apply") {
    const payer = opt("payer") ?? die("--payer <pubkey that will send it> is required");
    const st = attesterStatus(config, now);
    if (!st.pending) die("there is no pending attester change on this coin", 1);
    const ix = applyAttesterChangeIx({ programId: programId(), caller: new PublicKey(payer!), mint: new PublicKey(mint) });
    print({ mint, pending: st.pending, sendableNow: st.pending!.applicableNow, instruction: { programId: ix.programId.toBase58(), keys: ix.keys.map((k) => ({ pubkey: k.pubkey.toBase58(), isSigner: k.isSigner, isWritable: k.isWritable })), dataBase64: Buffer.from(ix.data).toString("base64") }, note: "permissionless: anyone may send this once the ETA has passed; nothing was signed or sent here" });
    process.exit(0);
  }
  const current = config.activeAttesters.map((a, i) => ({ key: a.key.toBase58(), kind: a.kind, addedAt: Number(config.attester_added_at[i] ?? 0) }));
  const adds = args.flatMap((a, i) => (a === "--add" && args[i + 1] ? [args[i + 1]] : []));
  const removes = new Set(args.flatMap((a, i) => (a === "--remove" && args[i + 1] ? [args[i + 1]] : [])));
  if (!adds.length && !removes.size) die("--add <pubkey> and/or --remove <pubkey> is required");
  const kind = Number(opt("kind") ?? 0);
  const proposed = [...current.filter((a) => !removes.has(a.key)).map((a) => ({ key: a.key, kind: a.kind })), ...adds.filter((k) => !current.some((a) => a.key === k)).map((k) => ({ key: k, kind }))];
  const newKeys = proposed.filter((a) => !current.some((b) => b.key === a.key)).length;
  const quorum = Number(opt("quorum") ?? Math.max(config.quorum, newKeys + 1));
  const problems = checkProposal(current, config.quorum, proposed, quorum, now);
  const ix = proposeAttestersIx({ programId: programId(), admin: config.admin, mint: new PublicKey(mint), attesters: proposed.map((a) => ({ key: new PublicKey(a.key), kind: a.kind })), quorum });
  print({
    mint, admin: config.admin.toBase58(), adminRenounced: config.adminRenounced, current: attesterStatus(config, now), proposed: { attesters: proposed, quorum }, problems, acceptableNow: problems.length === 0 && !config.adminRenounced,
    instruction: { programId: ix.programId.toBase58(), keys: ix.keys.map((k) => ({ pubkey: k.pubkey.toBase58(), isSigner: k.isSigner, isWritable: k.isWritable })), dataBase64: Buffer.from(ix.data).toString("base64") },
    next: ["the config authority (the Squads vault above) wraps this instruction in a vault transaction; two of three members approve", "it waits 48 h in public (AttesterChangeProposed on chain); then anyone sends apply_attester_change (`… apply <mint> --payer <you>`)", quorum > config.quorum ? `the quorum rises ${config.quorum} → ${quorum} and can never come down: every reading after the apply needs ${quorum} signatures — read ATTESTERS.md "What is not built" first` : "the quorum is unchanged"],
  });
  process.exit(problems.length || config.adminRenounced ? 1 : 0);
}

// ---- read ----
const mint = mintArg();
const day = pos[1] ?? die("<YYYY-MM-DD> is required");
let rulesText: string, ticker: string, baselineAt: string, siteReadings: SettledEvent[] | null = null, siteSha: string | null = null;
const site = opt("site")?.replace(/\/$/, "");
if (site) {
  const r = await fetch(`${site}/api/burnticker/v1/tokens/${mint}`, { signal: AbortSignal.timeout(20_000) }).catch((e: Error) => die(`the site could not be read: ${e.message}`));
  if (!r.ok) die(`the site answered HTTP ${r.status} for ${mint}`);
  const j = (await r.json()) as { status: { ticker: string; launchedAt: string | null; rules: { sha256: string } }; rulesText: string; readings: { id: string; at: string; result: string | null; value: string | null; title: string | null; sourceUrl: string; method?: string | null; proof?: string | null }[] };
  rulesText = j.rulesText; ticker = j.status.ticker; baselineAt = j.status.launchedAt ?? die("the coin has not launched (no baseline)"); siteSha = j.status.rules.sha256;
  siteReadings = j.readings.map((x) => ({ id: x.id, at: x.at, result: x.result as SettledEvent["result"], value: x.value, title: x.title, sourceUrl: x.sourceUrl, method: x.method ?? null, proof: x.proof ?? null }));
} else {
  const rf = opt("rules") ?? die("--site <origin>, or --rules <rules.json> --ticker <T> --baseline <ISO>");
  rulesText = fs.readFileSync(rf!, "utf8"); ticker = (opt("ticker") ?? die("--ticker is required with --rules")).toUpperCase(); baselineAt = opt("baseline") ?? die("--baseline <ISO time> is required with --rules");
}
const locked = (() => { try { return lockRule(JSON.parse(rulesText), { stored: true }); } catch (e) { return die(`rules.json does not validate: ${(e as Error).message}`); } })();
if (siteSha && siteSha !== locked.sha256) die(`the site's rules hash ${siteSha} is not the hash of the rules text it served (${locked.sha256})`, 1);
const independent = !flag("readings-from-site");
let readings: SettledEvent[];
if (!independent) { if (!siteReadings) die("--readings-from-site needs --site"); readings = siteReadings!; }
else {
  const rule = wideRule(locked.rule);
  try {
    if (rule.oracle === "catalogue") readings = (await new CatalogueAdapter().settledSince(rule, null)).events;
    else if (rule.oracle === "polymarket") readings = (await new PolymarketClient({ refuse: (titles) => [...new Set(refusalsFor(loadRefuseList(), { titles }).map((x) => x.reason))] }).settledSince(rule, null)).events;
    else readings = die(`oracle ${rule.oracle}: no independent reader in this tool (see ATTESTERS.md)`);
  } catch (e) { readings = die(`the source could not be read: ${(e as Error).message.slice(0, 200)}`); }
}
const recordDate = parseDay(day!);
const conn = opt("rpc") ? rpc() : null;
let genesis = GENESIS_HASH[cluster], chainCfg: Awaited<ReturnType<typeof fetchTokenConfig>> = null, chainReading = null;
if (conn) {
  chainCfg = await fetchTokenConfig(conn, programId(), new PublicKey(mint));
  if (chainCfg) {
    genesis = chainCfg.config.cluster_genesis.toBase58();
    const chainSha = Buffer.from(chainCfg.config.rules_sha256).toString("hex");
    if (chainSha !== locked.sha256) die(`the chain's TokenConfig pins rules sha256 ${chainSha}, not ${locked.sha256} — wrong rules file or wrong coin`, 1);
    chainReading = await fetchReading(conn, programId(), chainCfg.address, recordDate);
  }
}
const prevOpt = opt("prev");
let c;
try { c = counterAt({ mint, ticker, rulesText, baselineAt, readings, recordDate, prevDate: prevOpt ? parseDay(prevOpt) : chainReading ? chainReading.prev_date : null }); } catch (e) { die((e as Error).message); }
const msg = readingMessage({ genesis, programId: programId().toBase58(), mint, c: c! });
let signed: { signature: string; publicKey: string } | null = null;
const keyPath = opt("key");
if (keyPath) { try { signed = signReading(loadKeypair({ keyPath, passphrase: process.env.BURNTICKER_ATTESTER_PASSPHRASE?.trim() || undefined }).secretKey, msg.message); } catch (e) { die(`the key could not be used: ${(e as Error).message}`); } }
const cmp = conn ? (chainCfg ? compareChain(c!, chainReading) : null) : null;
print({
  mint, ticker, date: c!.date, value: c!.value, prevDate: c!.prevDate, units: c!.units, eventIds: c!.eventIds, throughDate: c!.throughDate, sourceUrl: c!.sourceUrl, sourceUrlHash: msg.sourceUrlHash, feedId: c!.feedId,
  readings: { count: readings.length, from: independent ? "re-read from the source by this machine (independent)" : "the site's published readings (NOT independent — re-run without --readings-from-site)" },
  message: msg.message, signer: signed?.publicKey ?? null, signatureBase64: signed?.signature ?? null,
  chain: conn ? (chainCfg ? { reading: chainReading ? "found" : "not attested for this date yet", ...(cmp ?? {}) } : { error: "no TokenConfig for this mint on this RPC" }) : "not checked (pass --rpc)",
  notes: c!.notes,
});
process.exit(cmp && cmp.found && cmp.checks.some((x) => !x.ok) ? 1 : 0);
