#!/usr/bin/env node
// Mark a coin launched through the site as a disclosed TEST coin, or unmark it (owner, 2026-10-14: "hide the test coins"). A marked
// coin is left off the coin list, the home page, search, the leaderboard, the sitemap and tokens.html, and is listed on
// /burnticker/test-coins, linked from the Trust page (src/lib/burnticker/testCoins.ts). Its own page stays reachable by link. The mark
// changes nothing on chain and nothing the keeper does with the coin's burns.
//
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/alias-hook.mjs scripts/burnticker-test-coin.mts \
//     --mint <mint> --note "A test coin the operator made to check the launch flow." [--off] [--db data/burnticker.db] [--list]
//
// Operator coins that are not in the registry ($REHEARSAL) are marked in config/own-tokens.json with "test": true instead.
import fs from "node:fs";
import { openRegistry, REGISTRY_FILE } from "@/lib/burnticker/registry";

const args = process.argv.slice(2);
const arg = (k: string): string | null => { const i = args.indexOf(k); return i >= 0 && i + 1 < args.length ? args[i + 1] : null; };
const db = arg("--db") ?? REGISTRY_FILE;
if (!fs.existsSync(db)) { console.error(`no registry at ${db}`); process.exit(2); }
const reg = openRegistry(db);
if (args.includes("--list")) { console.log(JSON.stringify(reg.testTokens(), null, 2)); process.exit(0); }
const mint = arg("--mint");
if (!mint) { console.error("usage: --mint <mint> --note \"why\" [--off] | --list"); process.exit(2); }
const t = reg.token(mint);
if (!t) { console.error(`no coin with mint ${mint} in ${db}`); process.exit(2); }
const off = args.includes("--off");
const note = arg("--note") ?? "";
if (!off && !note.trim()) { console.error("a test mark needs --note: one plain sentence saying what the coin was for (it is shown on /burnticker/test-coins)"); process.exit(2); }
reg.setTokenTest(mint, !off, note.trim());
console.log(JSON.stringify({ mint, ticker: t.ticker, test: !off, note: note.trim() }));
