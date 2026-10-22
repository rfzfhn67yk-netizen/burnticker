// HS-132 / HS-133 (2026-10-22, the owner's World Series pair launch): after a reload the review re-picked a free pair id while the
// launch replayed the first bundle; and a Phantom request that never answered left the page silent. The review now reuses the
// creator's own unsent draft pair id, and every wallet request runs under a watchdog that says so after a minute.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { OWN_DRAFT_DEDUPE_MS, ownDraftPairId } from "@/lib/burnticker/launchPending";
import { WALLET_SLOW_LINE, WALLET_WATCHDOG_MS, signLaunchRequest, withWalletWatchdog } from "@/lib/burnticker/walletProof";
import { lintCopy } from "@/lib/launch/copyLint";
import type { TokenRow } from "@/lib/burnticker/registry";

const CREATOR = "8sJfoY6Xx6o2zZqmX2Vt6NRwzNPr14Ef6qqRd5YLvGbs";
const T0 = 1_792_671_550_676;
const row = (o: Partial<TokenRow> & { mint: string; ticker: string }): TokenRow => ({ creator: CREATOR, status: "draft", launchTx: null, createdAt: T0, ...o } as TokenRow);
const reg = (rows: TokenRow[], pairs: { pairId: string; mintA: string; mintB: string }[], unproven: string[] = []) => ({
  registry: {
    tokens: () => rows,
    unprovenDraftMints: () => new Set(unproven),
    pairOf: (m: string) => { const p = pairs.find((x) => x.mintA === m || x.mintB === m); return p ? { ...p, selectorKey: "k", createdAt: T0 } : null; },
  } as never,
});
const PAIR = { pairId: "milvtb-vs-tbvmil-espn-team-mlb-mil-8-win", mintA: "A1", mintB: "B1" };

describe("HS-132: the review keeps the creator's own unsent draft pair id across a reload", () => {
  test("both sides drafts by the creator, inside the window, proven: the first attempt's pair id", () => {
    const r = reg([row({ mint: "A1", ticker: "MILVTB" }), row({ mint: "B1", ticker: "TBVMIL" })], [PAIR]);
    assert.equal(ownDraftPairId(r, { creator: CREATOR, tickerA: "$milvtb", tickerB: "TBVMIL" }, T0 + 60_000), PAIR.pairId);
    assert.equal(ownDraftPairId(r, { creator: CREATOR, tickerA: "TBVMIL", tickerB: "MILVTB" }, T0 + 60_000), PAIR.pairId, "either order");
  });
  test("null when the window is over, a side was sent or launched, another creator made it, the draft is unproven, or there is no pair row", () => {
    const base = [row({ mint: "A1", ticker: "MILVTB" }), row({ mint: "B1", ticker: "TBVMIL" })];
    assert.equal(ownDraftPairId(reg(base, [PAIR]), { creator: CREATOR, tickerA: "MILVTB", tickerB: "TBVMIL" }, T0 + OWN_DRAFT_DEDUPE_MS), null, "window over");
    assert.equal(ownDraftPairId(reg([base[0], { ...base[1], launchTx: "sig" }], [PAIR]), { creator: CREATOR, tickerA: "MILVTB", tickerB: "TBVMIL" }, T0 + 1), null, "side B sent");
    assert.equal(ownDraftPairId(reg([{ ...base[0], status: "live" as const }, base[1]], [PAIR]), { creator: CREATOR, tickerA: "MILVTB", tickerB: "TBVMIL" }, T0 + 1), null, "side A live");
    assert.equal(ownDraftPairId(reg([{ ...base[0], creator: "Someone" }, base[1]], [PAIR]), { creator: CREATOR, tickerA: "MILVTB", tickerB: "TBVMIL" }, T0 + 1), null, "another creator");
    assert.equal(ownDraftPairId(reg(base, [PAIR], ["A1"]), { creator: CREATOR, tickerA: "MILVTB", tickerB: "TBVMIL" }, T0 + 1), null, "unproven draft (B-19)");
    assert.equal(ownDraftPairId(reg(base, []), { creator: CREATOR, tickerA: "MILVTB", tickerB: "TBVMIL" }, T0 + 1), null, "no pair row");
    assert.equal(ownDraftPairId(reg(base, [PAIR]), { creator: CREATOR, tickerA: "MILVTB", tickerB: "MILVTB" }, T0 + 1), null, "same ticker twice");
  });
  test("the review route wires it ahead of freePairId", () => {
    const src = fs.readFileSync("src/app/api/burnticker/v1/launch/review/route.ts", "utf8");
    assert.match(src, /pairIdPick: \(base\) => ownPairId\(body\) \?\? platform\(\)\.registry\.freePairId\(base\)/);
  });
});

describe("HS-133: a wallet request that does not answer is said after a minute", () => {
  test("the watchdog fires onSlow once after the deadline and still returns the answer; a fast answer never fires it", async () => {
    let slow = 0;
    const late = new Promise<string>((res) => setTimeout(() => res("signed"), 30));
    assert.equal(await withWalletWatchdog(late, () => { slow++; }, 5), "signed");
    assert.equal(slow, 1);
    assert.equal(await withWalletWatchdog(Promise.resolve("fast"), () => { slow++; }, 50), "fast");
    await new Promise((r) => setTimeout(r, 70));
    assert.equal(slow, 1, "a resolved request clears its timer");
    assert.equal(WALLET_WATCHDOG_MS, 60_000);
  });
  test("the proof signing passes onSlow through, and the line reads plainly", async () => {
    let slow = 0;
    const p = await signLaunchRequest(() => new Promise((res) => setTimeout(() => res(new Uint8Array([1, 2, 3])), 1)), { creator: CREATOR, tickers: ["MILVTB"], mints: [], onSlow: () => { slow++; } }, (b) => Buffer.from(b).toString("hex"));
    assert.ok(p && p.signature === "010203");
    assert.equal(slow, 0);
    assert.deepEqual(lintCopy(WALLET_SLOW_LINE, undefined, { scope: "platform" }).hits ?? [], []);
    const sign = fs.readFileSync("src/app/burnticker/launch/SignCard.tsx", "utf8"), page = fs.readFileSync("src/app/burnticker/launch/page.tsx", "utf8");
    assert.equal((sign.match(/withWalletWatchdog\(/g) ?? []).length, 2, "both wallet signatures on the sign card");
    assert.match(page, /onSlow: \(\) => setLaunchErr\(WALLET_SLOW_LINE\)/);
  });
});
