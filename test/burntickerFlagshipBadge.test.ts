// Handoff 2026-10-19: /burnticker/embed/DEFICIT and /api/burnticker/v1/badge/DEFICIT.* answered 404 ("no launched coin") while the coin
// page was 200: the flagship has no registry row while its own keeper runs it (F-25), and the badge builder looked only at the registry.
// Now the flagship's card comes from the keeper's published status.json and burns.json, by ticker or by mint, on a mainnet host only.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openRegistry, type Registry } from "@/lib/burnticker/registry";
import type { Platform } from "@/lib/burnticker/server";
import { clearBadgeMemo, coinBadgeData, flagshipBadgeData } from "@/lib/burnticker/badgeServe";
import { badgePayloadProblems, badgeStrings, renderCoinBadgeSvg, type CoinBadgeJson } from "@/lib/burnticker/badge";
import { embedText, renderEmbedHtml } from "@/lib/burnticker/embed";
import { lintCopy, loadCopyLintConfig, formatHits } from "@/lib/launch/copyLint";

const ROOT = path.join(import.meta.dirname, "..");
const DEFICIT_MINT = "AJJ4XxCUYr8zzMWm8FYg3xh638LYAAApdNqWBqCK4oqj";
const NOW = Date.parse("2026-10-19T14:00:00.000Z");
const ORIGIN = "http://bt.test";
const plat = (r: Registry, cluster = "mainnet") => ({ registry: r, cluster }) as unknown as Platform;
const cfg = loadCopyLintConfig();
const lintAll = (texts: string[], what: string) => { for (const t of texts) { const r = lintCopy(t, cfg); assert.ok(r.ok, `${what}: "${t}"\n${formatHits(r)}`); } };

let dir: string;
let env: Record<string, string | undefined>;
before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "bt-flagship-badge-"));
  env = { BURNKEEPER_PUBLISH_DIR: dir };
  fs.writeFileSync(path.join(dir, "status.json"), JSON.stringify({
    schema: "burnkeeper.status/v1", generatedAt: new Date(NOW).toISOString(), ticker: "DEFICIT", cluster: "mainnet",
    rules: { sha256: "8e3e8b66748a7630b9fe0e9793583434a076f2a03e335cad3d4c965758a15be9" },
    feed: { name: "U.S. Treasury, Debt to the Penny", nextPollAt: "2026-10-19T20:30:00.000Z" },
  }));
  fs.writeFileSync(path.join(dir, "burns.json"), JSON.stringify([
    { recordDate: "2026-10-13", units: 42, status: "planned", burned: null, signature: null },
    { recordDate: "2026-10-14", units: 3, status: "confirmed", burned: "300000", signature: "s".repeat(88) },
    { recordDate: "2025-12-30", units: 1, status: "confirmed", burned: "100000", signature: "t".repeat(88) },
    { recordDate: "2026-10-15", units: 2, status: "confirmed", burned: "0", signature: "u".repeat(88) },
  ]));
});
after(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe("the flagship's receipt badge", () => {
  test("by ticker and by mint on a mainnet host: a coin card from the keeper's files, linted, no market-data key, cached", async () => {
    clearBadgeMemo();
    const r = openRegistry(":memory:");
    for (const id of ["DEFICIT", "deficit", DEFICIT_MINT]) {
      const b = await coinBadgeData(plat(r), id, ORIGIN, NOW, env, ROOT) as CoinBadgeJson | null;
      assert.ok(b, id);
      assert.equal(b.kind, "coin"); assert.equal(b.ticker, "DEFICIT"); assert.equal(b.status, "live");
      assert.deepEqual(b.lastBurn, { at: "2026-10-14T00:00:00.000Z", units: 3, burned: "300000" }, "the latest confirmed burn with tokens burned; a planned row and a zero burn do not count");
      assert.deepEqual(b.receipts, { count: 1, label: "in 2026" }, "the calendar-year scope leaves last year's burn out of the count");
      assert.equal(b.rulesSha12, "8e3e8b66748a");
      assert.equal(b.nextSettlementAt, "2026-10-19T20:30:00.000Z"); assert.equal(b.nextSettlementNote, "the keeper's next read of the source");
      assert.equal(b.pageUrl, `${ORIGIN}/burnticker/t/DEFICIT`); assert.equal(b.embedUrl, `${ORIGIN}/burnticker/embed/DEFICIT`);
      assert.equal(b.badgeUrl.svg, `${ORIGIN}/api/burnticker/v1/badge/DEFICIT.svg`);
      assert.deepEqual(badgePayloadProblems(b), []);
      lintAll(badgeStrings(b), `badge ${id}`);
      const svg = renderCoinBadgeSvg(b);
      assert.match(svg, /\$DEFICIT/); assert.match(svg, /last burn 2026-10-14/);
      const html = renderEmbedHtml(b, NOW);
      assert.match(html, /\$DEFICIT receipts · Burnticker/);
      lintAll([embedText(html)], `embed ${id}`);
    }
    // the second read inside the cache window is the memo (same generatedAt), not a second file read
    const first = await coinBadgeData(plat(r), "DEFICIT", ORIGIN, NOW, env, ROOT) as CoinBadgeJson;
    const again = await coinBadgeData(plat(r), "DEFICIT", ORIGIN, NOW + 1000, env, ROOT) as CoinBadgeJson;
    assert.equal(again.generatedAt, first.generatedAt);
  });

  test("no keeper files: the card still answers, with no burn and no next read, never a 404", () => {
    clearBadgeMemo();
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "bt-flagship-empty-"));
    try {
      const b = flagshipBadgeData(plat(openRegistry(":memory:")), "DEFICIT", ORIGIN, NOW, { BURNKEEPER_PUBLISH_DIR: empty }, ROOT);
      assert.ok(b);
      assert.equal(b.lastBurn, null); assert.deepEqual(b.receipts, { count: 0, label: "in 2026" });
      assert.equal(b.nextSettlementAt, null); assert.equal(b.nextSettlementNote, "no result scheduled");
      assert.equal(b.rulesSha12.length, 12, "the locked rules file's hash stands in for the keeper's");
    } finally { fs.rmSync(empty, { recursive: true, force: true }); }
  });

  test("not the flagship: a devnet host, another id, or an unknown coin still get null", async () => {
    clearBadgeMemo();
    const r = openRegistry(":memory:");
    assert.equal(flagshipBadgeData(plat(r, "devnet"), "DEFICIT", ORIGIN, NOW, env, ROOT), null, "the flagship is a mainnet coin");
    assert.equal(flagshipBadgeData(plat(r), "DEFICIT2", ORIGIN, NOW, env, ROOT), null);
    assert.equal(await coinBadgeData(plat(r), "NOSUCHCOIN", ORIGIN, NOW, env, ROOT), null);
  });
});
