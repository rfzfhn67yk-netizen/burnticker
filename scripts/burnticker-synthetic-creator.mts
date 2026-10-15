#!/usr/bin/env node
// THE SYNTHETIC CREATOR (owner, 2026-10-14 night: "can you write a program that will catch all these bugs?"). Private ops: never in the
// public tree (scripts/ops/public-repo-lib.mjs does not list it).
//
// It drives the REAL site build like a creator, in Chrome through Playwright: fills the launch form through the page, reaches the review,
// presses Launch, connects and signs with a test wallet injected before any page script runs (scripts/burnticker-synth/wallet.mts), and
// checks what the page says at each seam that broke on launch night: the proxy's time limit, a wallet that rewrites the transaction
// (Phantom + Lighthouse), a retry of a registered draft, a double press, a press during a deploy restart, the browser's address search
// when the bank is empty, a wallet slower than the blockhash, a wallet that tampers.
//
//   R() { node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/alias-hook.mjs "$@"; }
//   R scripts/burnticker-synthetic-creator.mts [--base http://127.0.0.1:3000] [--chain real|stub] [--only a-event,b-reject-retry,…]
//       [--headed] [--report logs/synthetic-creator-report.json]
//
// --chain real (the default): the wallet must hold devnet SOL (an airdrop of 2 SOL is asked for when it holds less than 0.3; a failed
//   airdrop stops the run) and the host must pin a real devnet lookup table. Coins are created on devnet and must go live.
// --chain stub: nothing reaches the chain. The browser's RPC calls are intercepted: the pinned lookup table is answered with the expected
//   entries, the page's dry run is answered "ok", and the send is refused ("synthetic stub chain"). Everything up to the send is real:
//   the site's bundle, the page's integrity check, the wallet's rewrite, the blockhash checks (read from devnet). A stub-chain pass proves
//   the page handed a correctly signed, unexpired transaction to the network; it does not prove the coin went live.
//
// Environment: BURNTICKER_SYNTH_KEYPAIR (a devnet keypair JSON file; unset = one is made under ~/.config/burnticker-synth/ and only its
// public key is printed), BURNTICKER_SYNTH_DB (the target instance's registry file: its coins get token_flags.synthetic = 1 and the
// failure alert is recorded there), BURNTICKER_SYNTH_RPC (default https://api.devnet.solana.com), BURNTICKER_SYNTH_SLOW_MS (default
// 50000), BURNTICKER_SYNTH_EXPECT_BANK (empty | filled: assert which mint source the host uses), BURNTICKER_SYNTH_PM_QUERY (the event
// search, default "world cup"), BURNTICKER_THESPORTSDB_KEY (the team and rivalry kinds need it), BURNTICKER_PUSH_URL / _TOKEN (push.ts),
// PLAYWRIGHT_CORE (path to playwright-core's index.mjs; else `playwright-core` or `playwright` must resolve), BURNTICKER_SYNTH_CHROME
// (a Chrome/Chromium executable; else Playwright's chromium, else the installed Google Chrome).
//
// Output: the JSON report (--report, default logs/synthetic-creator-report.json), a plain-English summary on stdout, every mint it made
// appended to logs/synthetic-creator.jsonl. Exit 0 when every scenario passed or was skipped with a reason, 1 on any failure, 2 when the
// run could not start (no browser, no SOL, site down).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, VersionedTransaction } from "@solana/web3.js";
import { SyntheticWallet, walletShimSource, LIGHTHOUSE_PROGRAM, SLOW_DEFAULT_MS, ed25519Verify, type WalletMode } from "./burnticker-synth/wallet.mts";
import { fabricatedLookupTableData, expectedEntries } from "./burnticker-synth/stubChain.mts";

// ---- arguments -------------------------------------------------------------------------------------------------------------------
const argv = process.argv.slice(2);
const opt = (k: string): string | null => { const i = argv.indexOf(k); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null; };
const BASE = (opt("--base") ?? process.env.BURNTICKER_SYNTH_BASE ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const CHAIN = (opt("--chain") ?? process.env.BURNTICKER_SYNTH_CHAIN ?? "real") as "real" | "stub";
const ONLY = (opt("--only") ?? process.env.BURNTICKER_SYNTH_ONLY ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const HEADED = argv.includes("--headed");
const REPORT = opt("--report") ?? path.join("logs", "synthetic-creator-report.json");
const LEDGER = path.join("logs", "synthetic-creator.jsonl");
const RPC = (process.env.BURNTICKER_SYNTH_RPC ?? "https://api.devnet.solana.com").trim();
/** the RPC the build's wallet connection calls (NEXT_PUBLIC_BURNTICKER_RPC_URL at build time); never printed (it may carry a key) */
const BROWSER_RPC = (process.env.BURNTICKER_SYNTH_BROWSER_RPC ?? "https://api.devnet.solana.com").trim().replace(/\/$/, "");
const SLOW_MS = Number(process.env.BURNTICKER_SYNTH_SLOW_MS ?? SLOW_DEFAULT_MS) || SLOW_DEFAULT_MS;
const EXPECT_BANK = (process.env.BURNTICKER_SYNTH_EXPECT_BANK ?? "").trim() as "" | "empty" | "filled";
const PM_QUERY = (process.env.BURNTICKER_SYNTH_PM_QUERY ?? "world cup").trim();
/** devnet's genesis hash: the run refuses any other network */
const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const RUN_ID = `synth-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const LAUNCH_ROUTE = "/api/burnticker/launch";
/** the vanity search in a headless browser can take minutes; the owner's line is 3 minutes per address */
const MINT_SEARCH_MS = Number(process.env.BURNTICKER_SYNTH_MINT_SEARCH_MS ?? 240_000);

export type Outcome = "pass" | "fail" | "skip";
export interface ScenarioResult { id: string; title: string; outcome: Outcome; sentence: string | null; detail: string[]; ms: number; mints: string[] }

// ---- small helpers -----------------------------------------------------------------------------------------------------------------
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const now = () => Date.now();
class Skip extends Error {}
class Fail extends Error { readonly sentence: string; readonly detail: string[]; constructor(sentence: string, detail: string[] = []) { super(sentence); this.sentence = sentence; this.detail = detail; } }
const fail = (sentence: string, detail: string[] = []): never => { throw new Fail(sentence, detail); };

/** A ticker for this run: 2 to 10 letters or digits, unique enough per scenario. */
function tickerFor(tag: string): string { const t = Date.now().toString(36).toUpperCase().slice(-4); return `SY${tag.replace(/[^A-Z0-9]/gi, "").toUpperCase().slice(0, 2)}${t}`.slice(0, 10); }

async function loadPlaywright(): Promise<{ chromium: any }> {
  const tries = [process.env.PLAYWRIGHT_CORE, "playwright-core", "playwright", path.join(os.homedir(), ".cache", "burnticker-synth", "node_modules", "playwright-core", "index.mjs")].filter(Boolean) as string[];
  for (const t of tries) { try { return (await import(t)) as { chromium: any }; } catch { /* next */ } }
  throw new Error("Playwright is not installed here. Install it once outside the repository: mkdir -p ~/.cache/burnticker-synth && cd ~/.cache/burnticker-synth && npm i playwright-core@1.48.2, then (Linux) npx playwright-core install --with-deps chromium");
}

async function launchBrowser(pw: { chromium: any }): Promise<any> {
  const exe = (process.env.BURNTICKER_SYNTH_CHROME ?? "").trim();
  if (exe) return pw.chromium.launch({ executablePath: exe, headless: !HEADED });
  try { return await pw.chromium.launch({ headless: !HEADED }); } catch { /* no bundled chromium */ }
  return pw.chromium.launch({ channel: "chrome", headless: !HEADED });
}

function loadOrMakeKeypair(): { kp: Keypair; made: boolean; file: string } {
  const f = (process.env.BURNTICKER_SYNTH_KEYPAIR ?? "").trim() || path.join(os.homedir(), ".config", "burnticker-synth", "synth-devnet.json");
  if (fs.existsSync(f)) return { kp: Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(f, "utf8")) as number[])), made: false, file: f };
  const kp = Keypair.generate();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(Array.from(kp.secretKey)), { mode: 0o600 });
  return { kp, made: true, file: f };
}

/** The wallet's SOL, topped up by the devnet faucet when below 0.3. Returns the balance, or a sentence why it cannot be funded. */
async function fundWallet(conn: Connection, pk: PublicKey): Promise<{ sol: number; problem: string | null }> {
  let sol = (await conn.getBalance(pk)) / LAMPORTS_PER_SOL;
  if (sol >= 0.3) return { sol, problem: null };
  for (const amt of [2, 1]) {
    try { const sig = await conn.requestAirdrop(pk, amt * LAMPORTS_PER_SOL); await conn.confirmTransaction(sig, "confirmed"); sol = (await conn.getBalance(pk)) / LAMPORTS_PER_SOL; return { sol, problem: null }; }
    catch (e) { if (amt === 1) return { sol, problem: `The devnet faucet refused an airdrop to ${pk.toBase58()} (${String((e as Error).message).replace(/\s+/g, " ").slice(0, 160)}). Fund it with \`solana airdrop 2 ${pk.toBase58()} -u devnet\` or the web faucet, then run again.` }; }
  }
  return { sol, problem: "unreachable" };
}

// ---- one browser page with the wallet, the observers and (stub chain) the RPC interception ------------------------------------------
interface Observed { launchPosts: { at: number; body: Record<string, unknown>; status: number | null; json: any }[]; sends: { at: number; tx: VersionedTransaction; blockhashValid: boolean | null; problems: string[] }[]; console: string[] }

async function openPage(browser: any, wallet: SyntheticWallet, conn: Connection, lutPin: string | null): Promise<{ page: any; ctx: any; seen: Observed }> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const seen: Observed = { launchPosts: [], sends: [], console: [] };
  await page.exposeFunction("__btSynthSign", (b64: string) => wallet.signBase64(b64));
  await page.exposeFunction("__btSynthSignMessage", (b64: string) => wallet.signMessageBase64(b64));
  await page.addInitScript(walletShimSource(wallet.publicKey, wallet.keypair.publicKey.toBytes()));
  page.on("console", (m: any) => { if (m.type() === "error" || m.type() === "warning") seen.console.push(m.text().slice(0, 300)); });
  // every launch request the page makes, with its answer
  page.on("response", async (r: any) => {
    try {
      const req = r.request();
      if (req.method() !== "POST" || !req.url().includes(LAUNCH_ROUTE)) return;
      const body = JSON.parse(req.postData() ?? "{}");
      let json: any = null; try { json = await r.json(); } catch { json = null; }
      seen.launchPosts.push({ at: now(), body, status: r.status(), json });
    } catch { /* observer only */ }
  });
  // the browser's RPC: every send is inspected (signatures, blockhash age); the stub chain answers the lookup table, the dry run and the send
  await page.route(`${BROWSER_RPC}/**`, async (route: any) => handleRpc(route, conn, lutPin, seen));
  await page.route(BROWSER_RPC, async (route: any) => handleRpc(route, conn, lutPin, seen));
  return { page, ctx, seen };
}

async function handleRpc(route: any, conn: Connection, lutPin: string | null, seen: Observed): Promise<void> {
  const req = route.request();
  let body: any = null;
  try { body = JSON.parse(req.postData() ?? "null"); } catch { body = null; }
  const one = Array.isArray(body) ? null : body;
  const answer = (result: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ jsonrpc: "2.0", id: one.id, result }) });
  const error = (code: number, message: string) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ jsonrpc: "2.0", id: one.id, error: { code, message } }) });
  if (one?.method === "sendTransaction") {
    const raw = Buffer.from(String(one.params?.[0] ?? ""), (one.params?.[1]?.encoding ?? "base58") === "base64" ? "base64" : "base64");
    let tx: VersionedTransaction | null = null; try { tx = VersionedTransaction.deserialize(raw); } catch { tx = null; }
    if (tx) {
      let valid: boolean | null = null;
      try { valid = (await conn.isBlockhashValid(tx.message.recentBlockhash, { commitment: "confirmed" })).value; } catch { valid = null; }
      seen.sends.push({ at: now(), tx, blockhashValid: valid, problems: signatureProblems(tx) });
    }
    if (CHAIN === "stub") return error(-32002, "Transaction simulation failed: synthetic stub chain, nothing was sent");
  }
  if (CHAIN === "stub" && one) {
    const slot = 1;
    if (one.method === "getAccountInfo" && lutPin && one.params?.[0] === lutPin) {
      return answer({ context: { slot }, value: { data: [fabricatedLookupTableData(expectedEntries("devnet")).toString("base64"), "base64"], executable: false, lamports: 10_000_000, owner: "AddressLookupTab1e1111111111111111111111111", rentEpoch: 0, space: 56 + 32 * expectedEntries("devnet").length } });
    }
    if (one.method === "simulateTransaction") return answer({ context: { slot }, value: { err: null, logs: ["synthetic stub chain: dry run answered ok"], accounts: null, unitsConsumed: 150_000, returnData: null } });
  }
  // the build's own wallet RPC (NEXT_PUBLIC_BURNTICKER_RPC_URL, baked in at build time) may be a mainnet endpoint on a host that serves
  // devnet from the same build: every call is then answered from the devnet RPC instead, so the page reads and sends on devnet only
  if (BROWSER_RPC !== RPC && req.method() === "POST") {
    try { const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: req.postData() ?? "" }); return route.fulfill({ status: r.status, contentType: "application/json", body: await r.text() }); }
    catch { return route.abort(); }
  }
  return route.continue();
}

/** Every required signature on a sent transaction must be present and verify over its message. */
function signatureProblems(tx: VersionedTransaction): string[] {
  const msg = tx.message.serialize(), n = tx.message.header.numRequiredSignatures, out: string[] = [];
  for (let i = 0; i < n; i++) {
    const s = tx.signatures[i], k = tx.message.staticAccountKeys[i];
    if (!s || s.every((b) => b === 0)) out.push(`signature ${i + 1} (${k.toBase58().slice(0, 8)}…) is missing`);
    else if (!ed25519Verify(msg, s, k.toBytes())) out.push(`signature ${i + 1} (${k.toBase58().slice(0, 8)}…) does not verify`);
  }
  return out;
}

// ---- page steps ------------------------------------------------------------------------------------------------------------------
async function mainText(page: any): Promise<string> { try { return (await page.locator("body").innerText()).replace(/\s+/g, " "); } catch { return ""; } }
async function lastAlert(page: any): Promise<string | null> {
  const a = page.locator("[role=alert]");
  const n = await a.count().catch(() => 0);
  for (let i = n - 1; i >= 0; i--) { const t = (await a.nth(i).innerText().catch(() => "")).trim(); if (t) return t; }
  return null;
}

async function gotoLaunch(page: any, query = ""): Promise<void> {
  const r = await page.goto(`${BASE}/burnticker/launch${query}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  if (!r || r.status() !== 200) fail(`The launch page answered HTTP ${r?.status() ?? "nothing"}.`);
  const t = await mainText(page);
  if (/the app is catching up/i.test(t)) fail("The launch page served the fallback page (\"the app is catching up\").");
  await page.getByText("What does this coin follow?", { exact: false }).first().waitFor({ timeout: 30_000 });
}

async function clickText(page: any, text: string | RegExp, timeout = 20_000): Promise<void> { const l = page.getByText(text).first(); await l.waitFor({ timeout }); await l.click(); }
async function clickButton(page: any, name: RegExp, timeout = 20_000): Promise<void> { const b = page.getByRole("button", { name }).first(); await b.waitFor({ timeout }); await b.click(); }

/** From a chosen source: Next through the burn step, set the ticker on the name step, open the review. */
async function throughToReview(page: any, ticker: string): Promise<void> {
  for (let i = 0; i < 6; i++) {
    const tick = page.locator('input[data-help="ticker"]').first();
    if (await tick.isVisible().catch(() => false)) {
      await tick.fill(ticker);
      // a unique name too: the lookalike guard refuses a second coin named like a live one ("Barcelona" twice), as it should
      const nm = page.locator('input[data-help="name"]').first();
      if (await nm.isVisible().catch(() => false)) await nm.fill(`Synthetic ${ticker}`);
      await clickButton(page, /^Review$/);
      await page.locator('button[data-decision="launch"]').first().waitFor({ timeout: 60_000 });
      return;
    }
    const next = page.getByRole("button", { name: /^Next$/ }).first();
    if (await next.isVisible().catch(() => false)) { await next.click(); await sleep(800); continue; }
    await sleep(1500);
  }
  fail(`The form did not reach the name step. The page shows: ${(await mainText(page)).slice(0, 300)}`);
}

/** Kind: a Polymarket event (binary): search, take the first open market, burn on YES. */
async function reviewEvent(page: any, ticker: string): Promise<void> {
  await gotoLaunch(page);
  await clickText(page, "Event outcome");
  const q = page.locator('input[aria-label="Search markets by name"]').first();
  await q.waitFor({ timeout: 20_000 });
  await q.fill(PM_QUERY);
  const pick = page.getByRole("button", { name: /burn on this market|burn if this one wins/ }).first();
  try { await pick.waitFor({ timeout: 30_000 }); } catch { fail(`The market search for "${PM_QUERY}" listed nothing to pick. The page shows: ${(await mainText(page)).slice(-300)}`); }
  await pick.click();
  await throughToReview(page, ticker);
}

/** Kind: published data (the $DEFICIT-style scalar on the national debt feed). */
async function reviewPublished(page: any, ticker: string): Promise<void> {
  await gotoLaunch(page);
  await clickText(page, "Published data");
  await clickText(page, "U.S. national debt (Debt to the Penny)", 30_000);
  // the card's own button
  const card = page.locator("text=use this source →").first();
  await card.click();
  await throughToReview(page, ticker);
}

/** Connects the injected wallet through the page's own wallet list when the page asks. */
async function connectIfAsked(page: any): Promise<boolean> {
  const modal = page.locator(".wallet-adapter-modal-wrapper").first();
  if (!(await modal.isVisible().catch(() => false))) { await sleep(800); if (!(await modal.isVisible().catch(() => false))) return false; }
  const item = modal.getByRole("button", { name: /Phantom/ }).first();
  await item.click();
  await modal.waitFor({ state: "hidden", timeout: 15_000 }).catch(() => undefined);
  return true;
}

/**
 * Connects the injected wallet the way a creator does, before Launch: the header's Connect wallet, the wallet list, Phantom, then waits
 * for the header pill (data-wallet-state="connected"). 2026-10-15: pressing Launch while still disconnected raced the Wallet Standard
 * registration and left the review on "Connect wallet" with Launch never reachable.
 */
async function ensureConnected(page: any): Promise<void> {
  const connected = page.locator('[data-wallet-state="connected"]').first();
  for (let attempt = 0; attempt < 3; attempt++) {
    if (await connected.isVisible().catch(() => false)) return;
    const modal = page.locator(".wallet-adapter-modal-wrapper").first();
    if (!(await modal.isVisible().catch(() => false))) {
      const b = page.locator('[data-wallet-button][data-wallet-state="disconnected"]:visible').first();
      await b.click({ timeout: 15_000 }).catch(() => undefined);
      await modal.waitFor({ state: "visible", timeout: 10_000 }).catch(() => undefined);
    }
    if (await modal.isVisible().catch(() => false)) {
      await modal.getByRole("button", { name: /Phantom/ }).first().click({ timeout: 10_000 }).catch(() => undefined);
      await modal.waitFor({ state: "hidden", timeout: 10_000 }).catch(() => undefined);
    }
    try { await connected.waitFor({ state: "visible", timeout: 20_000 }); return; } catch { await sleep(1000); }
  }
  fail(`The test wallet never connected: the header still shows "${(await page.locator("[data-wallet-button]").first().innerText().catch(() => "?")).trim()}".`);
}

/** Press Launch on the review (connecting first when the page opens the wallet list) and wait for the sign card, an alert or the search. */
async function pressLaunch(page: any, o: { double?: boolean } = {}, note?: (s: string) => void): Promise<"sign-card" | "alert"> {
  let paced = 0;
  await ensureConnected(page);
  const btn = page.locator('button[data-decision="launch"]').first();
  await btn.waitFor({ timeout: 60_000 });
  await btn.scrollIntoViewIfNeeded().catch(() => undefined);
  for (let i = 0; i < 60 && !(await btn.isEnabled().catch(() => false)); i++) await sleep(1000);
  if (!(await btn.isEnabled().catch(() => false))) {
    const why = await page.evaluate(() => { const b = document.querySelector<HTMLButtonElement>('button[data-decision="launch"]'); return (b?.getAttribute("aria-describedby") ?? "").split(" ").filter(Boolean).map((id) => document.getElementById(id)?.innerText ?? "").join(" ").trim(); }).catch(() => "");
    fail(`The Launch button stayed off for 60 s.${why ? ` The review says: ${why}` : ""}`);
  }
  await btn.click();
  if (await connectIfAsked(page)) { await sleep(500); await ensureConnected(page); await btn.click(); }
  if (o.double) await btn.click({ force: true, timeout: 2_000 }).catch(() => undefined);
  let deadline = now() + MINT_SEARCH_MS + 60_000;
  while (now() < deadline) {
    if (await page.locator("[data-sign-card]").first().isVisible().catch(() => false)) return "sign-card";
    const a = await lastAlert(page);
    if (a && !(await page.locator("[data-launching]").first().isVisible().catch(() => false)) && !(await page.locator('[data-mint-search="searching"]').first().isVisible().catch(() => false))) {
      // the host's write bucket (10 an hour per client on a default host): wait as the page says, as a creator would, then press again
      const m = /Too many launch requests from this connection\. Try again in (?:(\d+) seconds|about (\d+) minutes)/.exec(a);
      const wait = m ? (m[1] ? Number(m[1]) : Number(m[2]) * 60) * 1000 + 2000 : 0;
      if (m && wait <= 8 * 60_000 && paced < 3) { paced++; deadline += wait; note?.(`rate limited: waited ${Math.round(wait / 1000)} s as the page said, then pressed Launch again`); await sleep(wait); await btn.click(); continue; }
      return "alert";
    }
    await sleep(1000);
  }
  return fail(`Nothing happened within ${Math.round((MINT_SEARCH_MS + 60_000) / 1000)} s of pressing Launch. The page shows: ${(await mainText(page)).slice(-300)}`);
}

/** The sign card's outcome: complete (live), stopped with a sentence, or still working past the deadline. */
async function signOutcome(page: any, ms = 120_000): Promise<{ state: "complete" | "stopped"; text: string }> {
  const card = page.locator("[data-sign-card]").first();
  if (CHAIN === "real" && ms === 120_000) ms = 360_000;   // two steps, each confirmed on devnet
  const deadline = now() + ms;
  await readCardMints(page);
  while (now() < deadline) {
    if (await card.locator("[data-launch-complete]").first().isVisible().catch(() => false)) return { state: "complete", text: (await card.innerText()).replace(/\s+/g, " ") };
    const red = card.locator("p.text-red-400").first();
    if (await red.isVisible().catch(() => false)) {
      const busy = await card.locator('button[data-decision="launch"][disabled]').count().catch(() => 0);
      if (!busy) return { state: "stopped", text: (await red.innerText()).trim() };
    }
    const blocked = card.getByText("Not signable here yet:").first();
    if (await blocked.isVisible().catch(() => false)) return { state: "stopped", text: (await card.locator(".text-amber-400").first().innerText()).replace(/\s+/g, " ") };
    await sleep(1000);
  }
  return fail(`The signing card did not finish within ${Math.round(ms / 1000)} s. It shows: ${(await card.innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 300)}`);
}

/** Mints the launch answers handed out (single bundle, pair bundles, pair curve). */
function mintsOf(seen: Observed): string[] {
  const out = new Set<string>();
  for (const p of seen.launchPosts) {
    const j = p.json ?? {};
    for (const m of [j.bundle?.mint, j.bundles?.a?.mint, j.bundles?.b?.mint, j.pairCurve?.mints?.a, j.pairCurve?.mints?.b, j.token?.mint]) if (typeof m === "string") out.add(m);
  }
  return [...out];
}

/** How many transactions the prepared launch asks the wallet for (a single coin is two since 2026-10-15: its rule locked, then created). */
function stepsOf(seen: Observed): number {
  const j = [...seen.launchPosts].reverse().find((p) => p.body.action !== "launched" && p.json?.code !== "mint-bank-empty")?.json ?? {};
  const n = (b: any) => (Array.isArray(b?.transactions) ? b.transactions.length : 0);
  return n(j.bundle) + n(j.bundles?.a) + n(j.bundles?.b) + n(j.pairCurve) || 1;
}

/** The launch went through: in stub chain, the page handed a fully signed, unexpired transaction to the network (with the wallet's
 *  Lighthouse instructions when it added them); in real chain, the coin page loads and the API says live. */
async function assertLaunched(page: any, seen: Observed, outcome: { state: string; text: string }, o: { expectGuard: boolean }): Promise<string[]> {
  const detail: string[] = [];
  const send = seen.sends.at(-1);
  if (!send) fail(`The page never sent a transaction. The signing card says: ${outcome.text}`);
  if (send!.problems.length) fail(`The page sent a transaction with bad signatures: ${send!.problems.join("; ")}.`);
  if (send!.blockhashValid === false) fail("The page sent a transaction whose blockhash had already expired.");
  const programs = send!.tx.message.compiledInstructions.map((ix) => send!.tx.message.staticAccountKeys[ix.programIdIndex]?.toBase58() ?? "lookup");
  if (o.expectGuard && !programs.includes(LIGHTHOUSE_PROGRAM.toBase58())) fail("The sent transaction lacks the wallet's Lighthouse instructions: the page sent something other than what the wallet signed.");
  detail.push(`sent: ${programs.length} instructions, all ${send!.tx.message.header.numRequiredSignatures} signatures verify, blockhash ${send!.blockhashValid ? "valid" : "unknown"} at send`);
  if (CHAIN === "stub") {
    if (!/synthetic stub chain/.test(outcome.text)) fail(`The page did not stop at the stub send as expected. It says: ${outcome.text}`);
    detail.push("stub chain: the send was refused on purpose, so the coin stays a draft (going live is not checked in this mode)");
    return detail;
  }
  if (outcome.state !== "complete") fail(`The launch did not finish. The signing card says: ${outcome.text}`);
  detail.push(...(await confirmLive(page, cardMints.get(page) ?? [])));
  return detail;
}

/** The mints the signing card names (plan.confirms): the coins this launch made, not earlier refused drafts. */
const cardMints = new WeakMap<object, string[]>();
async function readCardMints(page: any): Promise<string[]> {
  const ms = await page.locator("[data-sign-card] [data-mint-address]").evaluateAll((es: Element[]) => es.map((e) => e.getAttribute("data-mint-address") ?? "")).catch(() => [] as string[]);
  const out = (ms as string[]).filter(Boolean);
  if (out.length) cardMints.set(page, out);
  return out;
}

/**
 * Real chain: each coin is on chain (the mint account exists) and the API says live, polled for a minute; the coin page is then opened
 * for its status only. A page that fails to load after the coin is live is said, not counted as a failed launch (owner, 2026-10-15).
 */
async function confirmLive(page: any, mints: string[]): Promise<string[]> {
  const detail: string[] = [];
  if (!mints.length) fail("The signing card named no coin address.");
  const conn = new Connection(RPC, "confirmed");
  for (const m of mints) {
    let onChain = false, status = "unknown";
    for (let i = 0; i < 30 && (!onChain || status !== "live"); i++) {
      if (!onChain) { try { onChain = !!(await conn.getAccountInfo(new PublicKey(m))); } catch { /* retry */ } }
      try { const j = await (await fetch(`${BASE}/api/burnticker/tokens/${m}`, { signal: AbortSignal.timeout(30_000) })).json() as { status?: { status?: string } }; status = j?.status?.status ?? "unknown"; } catch { /* retry */ }
      if (!onChain || status !== "live") await sleep(2000);
    }
    if (!onChain) fail(`The mint ${m} does not exist on devnet.`);
    if (status !== "live") fail(`${m} exists on devnet, but the API says it is ${status}, not live.`);
    detail.push(`${m}: on devnet, API status live`);
    try {
      const r = await page.goto(`${BASE}/burnticker/t/${m}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
      detail.push(`coin page ${r?.status() ?? "no answer"}`);
    } catch (e) { detail.push(`landed and live; the coin page then failed to load (${String((e as Error).message).split("\n")[0].slice(0, 120)})`); }
  }
  return detail;
}

// ---- scenarios -------------------------------------------------------------------------------------------------------------------
interface Ctx { browser: any; wallet: SyntheticWallet; conn: Connection; lutPin: string | null; sportsKey: boolean }
type Scenario = { id: string; title: string; run: (c: Ctx) => Promise<{ detail: string[]; mints: string[] }> };

async function withPage<T>(c: Ctx, f: (page: any, seen: Observed) => Promise<T>): Promise<T & { mints: string[] }> {
  const { page, ctx, seen } = await openPage(c.browser, c.wallet, c.conn, c.lutPin);
  try { const r = await f(page, seen); return { ...r, mints: mintsOf(seen) }; }
  catch (e) {
    (e as { mints?: string[] }).mints = mintsOf(seen);
    // a landed, live coin is a pass even when a later step of the script fails; the report says which part failed
    if (CHAIN === "real" && !(e instanceof Fail) && !(e instanceof Skip)) {
      const ms = cardMints.get(page) ?? await readCardMints(page);
      if (ms.length) {
        try { const d = await confirmLive(page, ms); return { detail: [...d, `landed; the script then failed at: ${String((e as Error).message).split("\n")[0].slice(0, 160)}`], mints: mintsOf(seen) } as unknown as T & { mints: string[] }; } catch { /* not live: the original error stands */ }
      }
    }
    // what the failure looked like: a screenshot, the launch requests and the page's console errors
    try {
      const shot = path.join("logs", `${RUN_ID}-${(e as { scenario?: string }).scenario ?? "scenario"}-${Date.now()}.png`);
      fs.mkdirSync("logs", { recursive: true }); await page.screenshot({ path: shot, fullPage: false });
      const extra = [`screenshot ${shot}`, ...seen.launchPosts.map((p) => `launch request ${String(p.body.action ?? "prepare")}: HTTP ${p.status} ${p.json?.code ?? (p.json?.ok ? "ok" : "")} ${String(p.json?.error ?? "").slice(0, 160)}`), ...seen.console.slice(-5).map((x) => `console: ${x}`)];
      if (e instanceof Fail) e.detail.push(...extra); else (e as { extra?: string[] }).extra = extra;
    } catch { /* diagnostics only */ }
    throw e;
  }
  finally { await ctx.close().catch(() => undefined); }
}

const launchKind = (id: string, title: string, review: (page: any, ticker: string) => Promise<void>): Scenario => ({
  id, title, run: (c) => withPage(c, async (page, seen) => {
    c.wallet.mode = "lighthouse"; c.wallet.queue = [];
    await review(page, tickerFor(id.slice(2, 4)));
    const got = await pressLaunch(page);
    if (got === "alert") fail((await lastAlert(page)) ?? "The review showed an alert.");
    const out = await signOutcome(page);
    return { detail: [...(await assertLaunched(page, seen, out, { expectGuard: true })), ...c.wallet.calls.slice(-1).map((x) => `wallet: ${x.note}`)] };
  }),
});

const skipSports = (id: string, title: string): Scenario => ({ id, title, run: async (c) => { if (!c.sportsKey) throw new Skip("BURNTICKER_THESPORTSDB_KEY is not set here, and the NBA and NFL schedules come from TheSportsDB."); throw new Skip("Not driven yet: this kind's form path is not automated in this version of the script."); } });

const SCENARIOS: Scenario[] = [
  launchKind("a-event", "One Polymarket event coin, signed by a Phantom-like wallet (Lighthouse)", reviewEvent),
  skipSports("a-team", "One team-season coin (NBA or NFL)"),
  skipSports("a-rivalry-game", "A rivalry one-game pair"),
  skipSports("a-rivalry-series", "A rivalry series pair"),
  { id: "a-coin-vs-coin", title: "A Coin vs Coin coin", run: async () => { throw new Skip("Not driven yet: the Coin vs Coin tile's form path is not automated in this version of the script."); } },
  launchKind("a-published", "One published-data coin (the national debt, $DEFICIT-style)", reviewPublished),
  {
    id: "b-double-press", title: "Launch pressed twice quickly prepares one launch", run: (c) => withPage(c, async (page, seen) => {
      c.wallet.mode = "lighthouse"; c.wallet.queue = [];
      await reviewEvent(page, tickerFor("DP"));
      await pressLaunch(page, { double: true });
      const prepares = seen.launchPosts.filter((p) => p.body.action !== "launched");
      // with an empty bank the page asks once, is told mint-bank-empty, searches, and asks once more with its own mint: that is one launch
      const real = prepares.filter((p) => p.json?.code !== "mint-bank-empty");
      if (real.length !== 1) fail(`Two quick presses sent ${real.length} launch requests (expected one).`, prepares.map((p) => `${p.status} ${p.json?.code ?? "ok"}`));
      const out = await signOutcome(page);
      // one wallet request per step at most (in stub chain the first send is refused, so the run stops after one)
      const steps = stepsOf(seen);
      if (c.wallet.calls.length > steps) fail(`The wallet was asked to sign ${c.wallet.calls.length} times for one launch of ${steps} ${steps === 1 ? "transaction" : "transactions"}.`);
      return { detail: [`one launch request, ${c.wallet.calls.length} wallet ${c.wallet.calls.length === 1 ? "request" : "requests"} for ${steps} ${steps === 1 ? "step" : "steps"}`, ...(await assertLaunched(page, seen, out, { expectGuard: true }))] };
    }),
  },
  {
    id: "b-reject-retry", title: "A refusal in the wallet, then a second press, reuses the draft", run: (c) => withPage(c, async (page, seen) => {
      c.wallet.mode = "lighthouse"; c.wallet.queue = ["reject"];
      await reviewEvent(page, tickerFor("RJ"));
      await pressLaunch(page);
      const first = await signOutcome(page);
      if (!/was not signed in the wallet/.test(first.text)) fail(`After the wallet refused, the card should say the step was not signed. It says: ${first.text}`);
      if (seen.sends.length) fail("A transaction was sent although the wallet refused.");
      // the second press: the card's own button (the same plan, the same draft)
      await page.locator('[data-sign-card] button[data-decision="launch"]').first().click();
      const second = await signOutcome(page);
      const text = await mainText(page);
      if (/already registered/i.test(text)) fail(`The retry was refused as already registered: ${second.text}`);
      const prepares = seen.launchPosts.filter((p) => p.body.action !== "launched" && p.json?.code !== "mint-bank-empty");
      if (prepares.length !== 1) fail(`The retry prepared a new launch (${prepares.length} launch requests) instead of reusing the draft.`);
      // and the other way back: start over from the review and launch again; the earlier draft must not block it
      return { detail: [`first press: ${first.text}`, ...(await assertLaunched(page, seen, second, { expectGuard: true }))] };
    }),
  },
  {
    id: "b-reload-relaunch", title: "A refusal, a reload and Launch again from the kept review: no \"already registered\"", run: (c) => withPage(c, async (page, seen) => {
      c.wallet.mode = "lighthouse"; c.wallet.queue = ["reject"];
      await reviewEvent(page, tickerFor("RL"));
      await pressLaunch(page);
      const first = await signOutcome(page);
      if (!/was not signed in the wallet/.test(first.text)) fail(`After the wallet refused, the card should say the step was not signed. It says: ${first.text}`);
      // the tab reloads; "Start a new launch from the review" opens the kept draft on its review (launchDraftStore.ts resumeReviewHref)
      await page.goto(`${BASE}/burnticker/launch?resume=review`, { waitUntil: "domcontentloaded", timeout: 60_000 });
      try { await page.locator('button[data-decision="launch"]').first().waitFor({ timeout: 60_000 }); } catch { fail(`After a reload the kept review did not come back. The page shows: ${(await mainText(page)).slice(0, 300)}`); }
      const got = await pressLaunch(page);
      if (got === "alert") { const a = (await lastAlert(page)) ?? ""; fail(a); }
      const out = await signOutcome(page);
      if (/already registered|different rule or ticker/i.test(await mainText(page))) fail(`The relaunch was refused: ${out.text}`);
      return { detail: [`first press: ${first.text}`, `launch requests: ${seen.launchPosts.filter((p) => p.body.action !== "launched").map((p) => `${p.status} ${p.json?.code ?? "ok"}`).join(", ")}`, ...(await assertLaunched(page, seen, out, { expectGuard: true }))] };
    }),
  },
  { id: "b-reload-pair", title: "Reload after step 1 of a pair offers the right next step", run: async (c) => { throw new Skip(c.sportsKey ? "Not driven yet: needs a pair whose step 1 lands on chain (real chain only)." : "Needs a rivalry pair; BURNTICKER_THESPORTSDB_KEY is not set here."); } },
  { id: "b-pair-twice", title: "A matchup pair launched twice gets its own pair id", run: async (c) => { throw new Skip(c.sportsKey ? "Not driven yet: the matchup form path is not automated in this version." : "Needs a matchup pair; BURNTICKER_THESPORTSDB_KEY is not set here."); } },
  {
    id: "c-deploy-window", title: "A press during a deploy restart shows the update notice, never the fallback text", run: (c) => withPage(c, async (page) => {
      c.wallet.mode = "lighthouse"; c.wallet.queue = [];
      await reviewEvent(page, tickerFor("DW"));
      // what the host serves during a deploy: /deploying.json (DeployNotice.tsx) and Caddy's JSON 503 for the app's API while it restarts
      await page.route("**/deploying.json*", (r: any) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ since: new Date().toISOString(), text: "Burnticker is being updated." }) }));
      await page.route(`**${LAUNCH_ROUTE}`, (r: any) => r.request().method() === "POST" ? r.fulfill({ status: 503, contentType: "application/json", headers: { "retry-after": "30", "cache-control": "no-store" }, body: '{"error":"the app is catching up; receipts and the program are unaffected","code":"app-unavailable","retryAfterSec":30}' }) : r.continue());
      await page.evaluate(() => undefined);
      const got = await pressLaunch(page);
      const alert = (await lastAlert(page)) ?? "";
      if (got !== "alert") fail("The page went on to the signing card although the launch service answered 503.");
      if (/catching up/i.test(alert)) fail(alert);
      if (!/being updated/i.test(alert)) fail(alert || "The page showed no sentence.");
      const strip = await page.locator(".bt-deploy-notice").first().isVisible().catch(() => false);
      return { detail: [`the page said: ${alert}`, strip ? "the update strip is showing" : "the update strip was not showing yet (it polls every 20 s)"] };
    }),
  },
  {
    id: "d-mint-source", title: "The address source: an empty bank falls back to the browser search; a bank hands its key", run: (c) => withPage(c, async (page, seen) => {
      c.wallet.mode = "lighthouse"; c.wallet.queue = [];
      await reviewEvent(page, tickerFor("MB"));
      let searched = false;
      const watch = (async () => { for (let i = 0; i < 60 && !searched; i++) { if (await page.locator("[data-mint-search]").first().isVisible().catch(() => false)) searched = true; await sleep(500); } })();
      const t0 = now();
      await pressLaunch(page);
      await watch;
      const prepares = seen.launchPosts.filter((p) => p.body.action !== "launched");
      const emptied = prepares.some((p) => p.json?.code === "mint-bank-empty");
      const mode = emptied ? "empty" : "filled";
      if (EXPECT_BANK && EXPECT_BANK !== mode) fail(`The host's bank was expected ${EXPECT_BANK} but answered as ${mode}.`);
      const mint = mintsOf(seen)[0] ?? "";
      if (!/burn$/i.test(mint)) fail(`The coin's address ${mint || "(none)"} does not end in burn.`);
      if (mode === "empty") {
        if (!searched) fail("The bank was empty but the browser search panel never showed.");
        const own = prepares.find((p) => typeof p.body.mint === "string");
        if (!own) fail("The bank was empty but the page never sent its own address.");
      } else if (searched) fail("The bank handed a key but the browser search panel showed anyway.");
      const out = await signOutcome(page);
      return { detail: [`bank ${mode}; address ${mint}; ${mode === "empty" ? `browser search and launch request took ${Math.round((now() - t0) / 1000)} s` : "no search panel"}`, ...(await assertLaunched(page, seen, out, { expectGuard: true }))] };
    }),
  },
  {
    id: "e-slow", title: "A wallet slower than the blockhash: the page rebuilds and asks again, never sends a stale transaction", run: (c) => withPage(c, async (page, seen) => {
      c.wallet.mode = "lighthouse"; c.wallet.queue = ["slow"]; c.wallet.slowMs = SLOW_MS;
      await reviewEvent(page, tickerFor("SL"));
      await pressLaunch(page);
      const out = await signOutcome(page, SLOW_MS + 180_000);
      const asked = c.wallet.calls.length;
      const first = c.wallet.calls[0];
      let firstValid: boolean | null = null;
      if (first?.blockhash) { try { firstValid = (await c.conn.isBlockhashValid(first.blockhash, { commitment: "confirmed" })).value; } catch { firstValid = null; } }
      const stale = seen.sends.filter((s) => s.blockhashValid === false);
      if (stale.length) fail("The page sent a transaction whose blockhash had expired.");
      const resent = seen.sends.filter((s) => first?.blockhash && s.tx.message.recentBlockhash === first.blockhash);
      if (firstValid === false && resent.length) fail("The page sent the slow wallet's transaction after its blockhash expired.");
      const detail = [`wallet asked ${asked} time(s); the slow signature's blockhash is ${firstValid === null ? "unknown" : firstValid ? "still valid now" : "expired now"}`];
      if (asked > 1) detail.push("the page rebuilt the step and asked again");
      return { detail: [...detail, ...(await assertLaunched(page, seen, out, { expectGuard: true }))] };
    }),
  },
  {
    id: "e-tamper", title: "A wallet that changes an instruction is refused with the integrity sentence", run: (c) => withPage(c, async (page, seen) => {
      c.wallet.mode = "lighthouse"; c.wallet.queue = ["tamper"];
      await reviewEvent(page, tickerFor("TM"));
      await pressLaunch(page);
      const out = await signOutcome(page);
      if (seen.sends.length) fail("The page sent the tampered transaction.");
      if (!/was not sent because the wallet changed the transaction/.test(out.text)) fail(out.text);
      return { detail: [`the page said: ${out.text}`] };
    }),
  },
];

// ---- the run -----------------------------------------------------------------------------------------------------------------------
function record(mints: string[], scenario: string, reg: { setTokenSynthetic(m: string, note?: string): void } | null): void {
  if (!mints.length) return;
  fs.mkdirSync(path.dirname(LEDGER), { recursive: true });
  for (const m of mints) {
    fs.appendFileSync(LEDGER, `${JSON.stringify({ runId: RUN_ID, scenario, mint: m, base: BASE, chain: CHAIN, at: new Date().toISOString(), synthetic: true })}\n`);
    try { reg?.setTokenSynthetic(m, `synthetic creator ${RUN_ID} ${scenario}`); } catch { /* the ledger still has it */ }
  }
}

export function summarise(results: readonly ScenarioResult[], head: string[]): string {
  const n = (o: Outcome) => results.filter((r) => r.outcome === o).length;
  const lines = [...head, `${n("pass")} passed, ${n("fail")} failed, ${n("skip")} skipped.`];
  for (const r of results) lines.push(`${r.outcome === "pass" ? "PASS" : r.outcome === "fail" ? "FAIL" : "SKIP"} ${r.id}: ${r.title}.${r.sentence ? ` ${r.outcome === "fail" ? "The page said" : "Reason"}: ${r.sentence}` : ""}`);
  return lines.join("\n");
}

async function main(): Promise<number> {
  const { kp, made, file } = loadOrMakeKeypair();
  console.log(`synthetic creator ${RUN_ID}: ${BASE}, chain ${CHAIN}, wallet ${kp.publicKey.toBase58()}${made ? ` (new, saved to ${file})` : ""}`);
  const conn = new Connection(RPC, "confirmed");
  const head: string[] = [`Run ${RUN_ID} against ${BASE} (chain: ${CHAIN}).`];
  let reg: any = null;
  const dbPath = (process.env.BURNTICKER_SYNTH_DB ?? "").trim();
  if (dbPath) { try { reg = (await import("@/lib/burnticker/registry")).openRegistry(dbPath); } catch (e) { head.push(`The registry at ${dbPath} could not be opened (${(e as Error).message}); mints are in the ledger only.`); } }
  /** a run that cannot start is a failure too: one push, the sentence that stopped it */
  const stop = async (sentence: string): Promise<number> => {
    console.log(`STOP: ${sentence}`);
    if (reg) { const { pushSyntheticFailed } = await import("@/lib/burnticker/push"); await pushSyntheticFailed({ registry: reg, env: process.env, now: now(), runId: RUN_ID, failures: [{ scenario: "start", sentence }], log: (x) => console.log(x) }); }
    return 2;
  };
  // devnet only: the RPC this run reads, airdrops and (stub chain) forwards through must be devnet's (its genesis hash), never mainnet's
  try { const g = await conn.getGenesisHash(); if (g !== DEVNET_GENESIS) return stop(`BURNTICKER_SYNTH_RPC is not a devnet endpoint (genesis ${g.slice(0, 8)}…). The synthetic creator runs on devnet only.`); }
  catch (e) { return stop(`The devnet RPC did not answer (${String((e as Error).message).slice(0, 120)}).`); }
  // the site answers, and says which lookup table it pins
  let lutPin: string | null = null;
  try { const j = await (await fetch(`${BASE}${LAUNCH_ROUTE}`, { signal: AbortSignal.timeout(20_000) })).json() as { lookupTables?: { devnet?: { address?: string | null } } }; lutPin = j.lookupTables?.devnet?.address ?? null; }
  catch (e) { return stop(`${BASE}${LAUNCH_ROUTE} did not answer (${(e as Error).message}).`); }
  if (CHAIN === "real") {
    const f = await fundWallet(conn, kp.publicKey);
    if (f.problem) return stop(f.problem);
    head.push(`The wallet holds ${f.sol.toFixed(3)} devnet SOL.`);
    if (!lutPin) return stop("The host pins no devnet lookup table (BURNTICKER_LOOKUP_TABLE), so no launch can be signed. Create one with scripts/burnticker-lut.mts or run with --chain stub.");
  } else {
    head.push("Stub chain: everything up to the network send is real; the send is refused on purpose, so no coin goes live and the live checks are not made.");
    if (!lutPin) return stop("The host pins no devnet lookup table. In stub mode set BURNTICKER_LOOKUP_TABLE on the host to any address; the browser is answered with the expected table.");
  }
  let pw: { chromium: any }, browser: any;
  try { pw = await loadPlaywright(); browser = await launchBrowser(pw); } catch (e) { return stop((e as Error).message); }
  const wallet = new SyntheticWallet(kp);
  const c: Ctx = { browser, wallet, conn, lutPin, sportsKey: !!(process.env.BURNTICKER_THESPORTSDB_KEY ?? "").trim() };
  const results: ScenarioResult[] = [];
  for (const s of SCENARIOS) {
    if (ONLY.length && !ONLY.includes(s.id)) continue;
    const t0 = now();
    wallet.calls = []; wallet.queue = [];
    process.stdout.write(`- ${s.id} … `);
    let res: ScenarioResult;
    try {
      const r = await s.run(c);
      res = { id: s.id, title: s.title, outcome: "pass", sentence: null, detail: r.detail, ms: now() - t0, mints: r.mints };
    } catch (e) {
      const mints = (e as { mints?: string[] }).mints ?? [];
      if (e instanceof Skip) res = { id: s.id, title: s.title, outcome: "skip", sentence: e.message, detail: [], ms: now() - t0, mints };
      else if (e instanceof Fail) res = { id: s.id, title: s.title, outcome: "fail", sentence: e.sentence, detail: e.detail, ms: now() - t0, mints };
      else res = { id: s.id, title: s.title, outcome: "fail", sentence: `The script itself failed: ${String((e as Error)?.message ?? e).split("\n")[0].slice(0, 300)}`, detail: (e as { extra?: string[] }).extra ?? [], ms: now() - t0, mints };
    }
    res.detail.push(...wallet.calls.map((x) => `wallet call: ${x.mode}, ${x.note}`));
    record(res.mints, s.id, reg);
    results.push(res);
    console.log(`${res.outcome}${res.sentence ? `: ${res.sentence.slice(0, 200)}` : ""} (${Math.round(res.ms / 1000)} s)`);
  }
  await browser.close().catch(() => undefined);
  const summary = summarise(results, head);
  fs.mkdirSync(path.dirname(REPORT), { recursive: true });
  fs.writeFileSync(REPORT, JSON.stringify({ runId: RUN_ID, base: BASE, chain: CHAIN, wallet: kp.publicKey.toBase58(), at: new Date().toISOString(), results, summary }, null, 2));
  console.log(`\n${summary}\n\nreport: ${REPORT}`);
  const failed = results.filter((r) => r.outcome === "fail");
  if (failed.length && reg) {
    const { pushSyntheticFailed } = await import("@/lib/burnticker/push");
    await pushSyntheticFailed({ registry: reg, env: process.env, now: now(), runId: RUN_ID, failures: failed.map((f) => ({ scenario: f.id, sentence: f.sentence ?? "" })), log: (s) => console.log(s) });
  }
  return failed.length ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("burnticker-synthetic-creator.mts")) {
  main().then((code) => process.exit(code), (e) => { console.error(e); process.exit(2); });
}
