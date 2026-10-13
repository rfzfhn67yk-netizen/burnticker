// SOURCES-7 (QA walkthrough 11, 2026-10-13): the library side of the walkthrough's high items. H1 record close on a host with no Pyth
// key; H2 the series pair's description budget; H3 one fee split on the review; H6 a team whose season is over; H7 the flippening's
// "already larger" check and wrapper pairs; H9 impersonating tickers and names. No network.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { openRegistry } from "@/lib/burnticker/registry";
import { DerbyAdapter, type HermesLike } from "@/lib/burnticker/derby/adapter";
import { highNoKeyReason } from "@/lib/burnticker/derby/high";
import { v1DerbyHighBaseline } from "@/lib/burnticker/api/derby";
import type { Platform } from "@/lib/burnticker/server";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import { B, WIF, WIF_FEED, fixtureFetch } from "./burntickerDerbyHelpers.ts";

const cfgLint = loadCopyLintConfig();
const lint = (t: string) => { const r = lintCopy(t, cfgLint); assert.ok(r.ok, `${r.hits.map((h) => `${h.phrase} (${h.rule})`).join(", ")}\n${t}`); };

describe("H1: record close on a host with no Pyth key", () => {
  const NOW = B(13) + 15 * 3600_000;   // 2026-10-13 15:00 UTC; the day before launch is 2026-10-12
  const keyless = () => new DerbyAdapter({ registry: openRegistry(":memory:"), hermes: null, pools: null, fetchImpl: fixtureFetch(), now: () => NOW });
  const snap = (a: DerbyAdapter, d: number, value: string) => a.store.putSample({ key: `pyth:${WIF_FEED}`, kind: "pyth", ts: B(d) + 60_000, slot: 1, value, detail: { source: "pyth-solana", publishTime: B(d) / 1000 + 5 } });

  test("no key and nothing saved: the refusal says what is missing (the key, the close for the day before launch) in plain words", async () => {
    const r = await keyless().highBaseline(WIF, "all", NOW);
    assert.ok("refusal" in r);
    assert.equal(r.refusal.code, "no-readings");
    assert.equal(r.refusal.reason, highNoKeyReason("all", "2026-10-12", 0));
    assert.match(r.refusal.reason, /Pyth access key/);
    assert.match(r.refusal.reason, /2026-10-12, the day before launch/);
    lint(r.refusal.reason);
    lint(highNoKeyReason(30, "2026-10-12", 12));
  });

  test("no key but the site saved the closes itself: the record starts from them, never across a gap, and never claims the feed began", async () => {
    const a = keyless();
    snap(a, 13, "2"); snap(a, 12, "3"); snap(a, 11, "2.5");   // closes of 10-12, 10-11, 10-10
    snap(a, 9, "9");                                            // 10-08's close, behind a gap on 10-09: not part of the record
    const r = await a.highBaseline(WIF, "all", NOW);
    assert.deepEqual(r, { baseline: { kind: "all", since: "2026-10-10", through: "2026-10-12", high: "3", highOn: "2026-10-11", last: "2", feedBegan: false } });
  });

  test("a 30-day window with only part of it saved names how many closes are saved", async () => {
    const a = keyless();
    for (let d = 3; d <= 13; d++) snap(a, d, "2");
    const r = await a.highBaseline(WIF, 30, NOW);
    assert.ok("refusal" in r);
    assert.equal(r.refusal.reason, highNoKeyReason(30, "2026-10-12", 11));
  });

  test("with a key the walk is unchanged: Hermes reads every boundary back to the feed's start", async () => {
    const have = new Map([[B(10), "2"], [B(11), "3"], [B(12), "2.5"], [B(13), "2.6"]]);
    const hermes: HermesLike = { atBoundary: async (_f, ts) => { const v = have.get(ts * 1000); return v ? { ok: true, point: { feed: WIF_FEED, price: "0", conf: "0", expo: 0, value: v, publishTime: ts, slot: null, updateSha256: "0".repeat(64), updateBase64: "", url: "x" } } : { ok: false, reason: "no update" }; } };
    const a = new DerbyAdapter({ registry: openRegistry(":memory:"), hermes, pools: null, fetchImpl: fixtureFetch(), now: () => NOW });
    assert.deepEqual(await a.highBaseline(WIF, "all", NOW), { baseline: { kind: "all", since: "2026-10-09", through: "2026-10-12", high: "3", highOn: "2026-10-10", last: "2.6", feedBegan: true } });
  });

  test("POST /v1/derby/high on a keyless host answers the plain refusal, not a bare no-readings", async () => {
    const p = { oracles: { derby: keyless() } } as unknown as Platform;
    const res = await v1DerbyHighBaseline(p, { u: WIF, span: "all" }, NOW);
    const body = (res as unknown as { body: { today: string; refusal: { code: string; reason: string } } }).body;
    assert.equal(body.today, "2026-10-13");
    assert.equal(body.refusal.code, "no-readings");
    assert.match(body.refusal.reason, /Pyth access key/);
  });
});
