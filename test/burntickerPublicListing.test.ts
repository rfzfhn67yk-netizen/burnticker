// Prelaunch audit 2026-10-16 F-25 / F-26: /v1/tokens listed every status by default (drafts expose their mints and creator wallets) and
// had no $DEFICIT; /v1/creators listed drafts; draft and expired pairs were in the sitemap; ranks were keyed by ticker (two coins on one
// ticker shared a rank); the pair page linked each side by TICKER, so a draft pair's links opened the live coin holding that ticker.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Keypair } from "@solana/web3.js";
import { openRegistry, type Registry, type TokenRow } from "@/lib/burnticker/registry";
import { lockRule } from "@/lib/burnticker/rules";
import { v1ListTokens, v1Token } from "@/lib/burnticker/api/v1";
import { v1Creator } from "@/lib/burnticker/api/product";
import { sitemapEntries, listedPairs } from "@/lib/burnticker/sitemap";
import { rankLines } from "@/lib/burnticker/coinRank";
import type { SeasonCoinInput } from "@/lib/burnticker/seasons";
import type { BurnRule } from "@/lib/burnticker/rules";
import type { Platform } from "@/lib/burnticker/server";
import { CREATOR } from "./burntickerApiHelpers.ts";
import { BRONCOS } from "./burntickerHelpers.ts";

const ROOT = path.join(import.meta.dirname, "..");
const T0 = Date.now() - 3_600_000;
const DEFICIT_MINT = "AJJ4XxCUYr8zzMWm8FYg3xh638LYAAApdNqWBqCK4oqj";
const reg = (r: Registry, ticker: string, live: boolean): TokenRow => {
  const t = r.register({ mint: Keypair.generate().publicKey.toBase58(), ticker, name: `${ticker} coin`, creator: CREATOR, description: "", imageUrl: null, links: [], rulesText: lockRule(BRONCOS).text, feePda: "F", vault: null, tokenConfig: null, poolId: "Pool111111111111111111111111111111111111111", launchTx: null, cluster: "devnet", platformId: "Plat111111111111111111111111111111111111111", baselineAt: new Date(T0).toISOString(), status: "draft" }, T0);
  if (live) r.markLaunched(t.mint, `launch${ticker}`.padEnd(88, "x"), t.poolId, new Date(T0).toISOString());
  return r.token(t.mint)!;
};
const plat = (r: Registry, cluster = "mainnet") => ({ registry: r, cluster }) as unknown as Platform;
type Listed = { tokens: { ticker: string; mint: string; status: string; creator?: string }[]; total: number };

test("F-25: /v1/tokens lists live, paused and retired coins by default; drafts only on request; $DEFICIT is listed", () => {
  const r = openRegistry(":memory:");
  const live = reg(r, "LIVE", true), draft = reg(r, "DRAFTY", false);
  const res = v1ListTokens(plat(r), new URLSearchParams());
  assert.equal(res.status, 200);
  const b = res.body as Listed;
  assert.ok(b.tokens.some((t) => t.mint === live.mint));
  assert.ok(!b.tokens.some((t) => t.mint === draft.mint), "a draft's mint and creator are not in the default list");
  assert.ok(b.tokens.some((t) => t.ticker === "DEFICIT" && t.mint === DEFICIT_MINT), "the flagship is listed");
  assert.ok(!(v1ListTokens(plat(r, "devnet"), new URLSearchParams()).body as Listed).tokens.some((t) => t.ticker === "DEFICIT"), "a devnet host does not list the mainnet flagship");
  // review M2: no status reaches a draft or an expired draft
  for (const st of ["draft", "expired"]) { const res = v1ListTokens(plat(r), new URLSearchParams(`status=${st}`)); assert.equal(res.status, 400, st); assert.ok(!JSON.stringify(res.body).includes(draft.mint), st); }
  assert.deepEqual((v1ListTokens(plat(r), new URLSearchParams("status=live")).body as Listed).tokens.map((t) => t.mint).filter((m) => m !== DEFICIT_MINT), [live.mint], "the status filter still works for launched coins");
});

test("F-25: $DEFICIT is reachable as a token by ticker and by mint while it is run by its own keeper", async () => {
  const r = openRegistry(":memory:");
  for (const id of ["DEFICIT", "deficit", DEFICIT_MINT]) {
    const res = await v1Token(plat(r), id);
    assert.equal(res.status, 200, id);
    const b = res.body as { status: { ticker: string; mint: string; registered: boolean; page: string } };
    assert.equal(b.status.ticker, "DEFICIT"); assert.equal(b.status.mint, DEFICIT_MINT); assert.equal(b.status.registered, false);
    assert.equal(b.status.page, "/burnticker/t/DEFICIT");
  }
  assert.equal((await v1Token(plat(r), "NOSUCHCOIN")).status, 404);
});

test("F-25: /v1/creators/{wallet} leaves drafts out of the creator's coins", async () => {
  const r = openRegistry(":memory:");
  reg(r, "DRAFTONLY", false);
  const res = await v1Creator(plat(r), CREATOR);
  assert.equal(res.status, 200);
  assert.deepEqual((res.body as { coins: unknown[] }).coins, []);
});

test("F-26: the sitemap lists a pair only when both its coins are launched", () => {
  const coins = [{ ticker: "AAA", mint: "MA", status: "live", at: 0 }, { ticker: "BBB", mint: "MB", status: "live", at: 0 }, { ticker: "CCC", mint: "MC", status: "draft", at: 0 }, { ticker: "DDD", mint: "MD", status: "expired", at: 0 }];
  const pairs = listedPairs([{ pairId: "live1", mintA: "MA", mintB: "MB" }, { pairId: "half", mintA: "MA", mintB: "MC" }, { pairId: "dead", mintA: "MC", mintB: "MD" }], coins);
  assert.deepEqual(pairs.map((p) => p.pairId), ["live1"]);
  const locs = sitemapEntries({ origin: "https://x.test", nowMs: Date.now(), coins, pairs, seasonCoins: [] }).map((e) => e.loc);
  assert.ok(locs.includes("https://x.test/burnticker/p/live1"));
  assert.ok(!locs.some((l) => /\/p\/(half|dead)$/.test(l)));
  const route = fs.readFileSync(path.join(ROOT, "src/app/burnticker/sitemap.xml/route.ts"), "utf8");
  assert.match(route, /listedPairs\(/, "the route feeds the sitemap only listed pairs");
});

test("F-26: ranks are keyed by mint: two coins on one ticker keep their own lines", () => {
  const other = (ticker: string, mint: string, burns: number): SeasonCoinInput => ({ ticker, mint, rule: { oracle: "polymarket", series: null } as unknown as BurnRule, burns: Array.from({ length: burns }, () => ({ settledAt: new Date(T0).toISOString() })), burnedPct: 0, ended: false });
  const r = rankLines([other("SAME", "M1", 5), other("SAME", "M2", 0)]);
  assert.equal(r.get("M1")!.line, "5 receipts, the most on this site.");
  assert.equal(r.get("M2")!.line, "No receipts yet, so it has no rank on this site.");
  for (const f of ["src/app/api/burnticker/tokens/route.ts", "src/app/api/burnticker/home/route.ts", "src/lib/burnticker/creatorServe.ts"]) assert.doesNotMatch(fs.readFileSync(path.join(ROOT, f), "utf8"), /ranks\??\.get\([a-z]+\.ticker\)/, f);
});

test("F-26: the pair page links each side by its mint, never by ticker", () => {
  const src = fs.readFileSync(path.join(ROOT, "src/app/burnticker/p/[pairId]/page.tsx"), "utf8");
  assert.doesNotMatch(src, /href=\{`\/burnticker\/t\/\$\{(s\.status\.ticker|A|B)\}`\}/);
  assert.match(src, /coinCanonicalHref\(/);
});

test("review L3: the flagship sits at index total-1 of the list; an offset past it does not repeat it", () => {
  const r = openRegistry(":memory:");
  reg(r, "ONE", true);
  const at = (q: string) => (v1ListTokens(plat(r), new URLSearchParams(q)).body as Listed).tokens.map((t) => t.ticker);
  assert.deepEqual(at("offset=0"), ["ONE", "DEFICIT"]);
  assert.deepEqual(at("offset=1"), ["DEFICIT"]);
  assert.deepEqual(at("offset=2"), []);
  assert.deepEqual(at("offset=50"), []);
});

test("review L5: the spec describes the default list (live, paused, retired) and that drafts are not listed", async () => {
  const { ENDPOINTS } = await import("@/lib/burnticker/api/spec");
  const op = (ENDPOINTS as unknown as { operationId: string; description: string }[]).find((o) => o.operationId === "listTokens")!;
  assert.match(op.description, /live, paused and retired/); assert.match(op.description, /Drafts are not listed/);
});

test("re-review Low 3: the index route lists no draft or expired draft, and the SDK's tokens() no longer offers those statuses", async () => {
  const { makeWorld } = await import("./burntickerApiHelpers.ts");
  const w = await makeWorld();
  const d = reg(w.registry, "HIDDEN", false);
  const { GET } = await import("../src/app/api/burnticker/tokens/route.ts");
  const res = await GET();
  const text = await res.text();
  assert.equal(res.status, 200, text.slice(0, 200));
  assert.ok(!text.includes(d.mint), "the draft's mint is not in the index");
  const sdk = fs.readFileSync(path.join(ROOT, "packages/burnticker-sdk/src/client.ts"), "utf8");
  assert.doesNotMatch(sdk, /tokens\(o: \{ status\?: [^}]*"draft"/);
});
