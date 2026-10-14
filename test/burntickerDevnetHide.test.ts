// Owner decision 2026-10-12: "hide the devnet rehearsal items from the public site; add the real coins when they launch." A mainnet host's
// home data (featured cards, the activity strip, next results, stats) and registry lists carry no devnet item; a devnet host keeps them;
// the one devnet page (/burnticker/devnet) lists them; $REHEARSAL, a mainnet coin, stays on the mainnet home.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { homeData, type HomeCoin } from "@/lib/burnticker/home";
import { DEVNET_COPY, DEVNET_HREF, devnetPageData, hidesDevnet, isDevnetCard, publicEvents, publicRegistryRows, siteCluster } from "@/lib/burnticker/devnetHide";
import { upcomingSet, type UpcomingRow } from "@/lib/burnticker/upcoming";
import { HISTORY_COPY } from "@/lib/burnticker/historyCopy";
import { formatHits, lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";

const ROOT = path.join(import.meta.dirname, "..");
const NOW = Date.parse("2026-10-12T18:00:00Z");
const DEVNET_DEFICIT_MINT = JSON.parse(fs.readFileSync(path.join(ROOT, "config/burnkeeper/deficit.devnet.rules.json"), "utf8")).mint as string;
const row = (ticker: string, network: "mainnet" | "devnet"): UpcomingRow => ({ ticker, name: ticker, href: `/burnticker/t/${ticker}`, network, event: "A result", source: "A source", sourceUrl: null, schedule: "On the source's own schedule.", nextAt: null, status: "waiting", statusText: "No result has been read for this coin yet.", receiptHref: null });
const devnetCoin: HomeCoin = { ticker: "PRAC", mint: "PracMint", burns: 1, lastBurnAt: "2026-10-08", cluster: "devnet", latestSignature: "SigPrac", readOk: true };
const home = (host: string) => homeData([devnetCoin], ROOT, NOW, { totals: { burns: 0, burnedTokens: "0" }, audit: null }, null, null, null, upcomingSet([row("PRAC", "devnet"), row("MAIN", "mainnet")], [], 2), null, host);
const json = (v: unknown) => JSON.stringify(v);

describe("devnet items off a mainnet host's public pages", () => {
  test("the mainnet home has no devnet card, activity row, next result or stat", () => {
    const d = home("mainnet");
    assert.ok(!d.featured.some((v) => v.id === "deficit-devnet" || isDevnetCard(v)), "no devnet featured card");
    assert.ok(d.events.every((e) => e.network === "mainnet"), "the strip carries mainnet rows only");
    assert.ok(!d.events.some((e) => /devnet rehearsal coin/.test(e.text)));
    assert.deepEqual(d.upcoming.rows.map((r) => r.ticker), ["MAIN"]);
    assert.equal(d.stats?.devnet ?? null, null);
    assert.ok(!json(d).includes(DEVNET_DEFICIT_MINT), "the devnet $DEFICIT mint is nowhere in the answer");
    assert.ok(!json(d).includes("PracMint") && !json(d).includes("SigPrac"));
  });

  // owner 2026-10-14 ("hide the test coins"): $REHEARSAL is marked test in config/own-tokens.json, so it left the home (testCoins.ts)
  test("$REHEARSAL, a test coin, is off the mainnet home; the mainnet $DEFICIT card stays", () => {
    const d = home("mainnet");
    assert.ok(!d.featured.some((v) => v.id === "rehearsal" || v.ticker === "REHEARSAL"));
    assert.ok(!d.events.some((e) => e.ticker === "REHEARSAL"));
    assert.ok(d.featured.some((v) => v.id === "deficit"), "the mainnet $DEFICIT card stays");
  });

  test("a devnet host keeps its devnet items", () => {
    const d = home("devnet");
    assert.ok(d.featured.some((v) => v.id === "deficit-devnet"));
    assert.ok(d.events.some((e) => e.network === "devnet"));
    assert.ok(d.upcoming.rows.some((r) => r.ticker === "PRAC"));
    assert.ok(d.stats?.devnet && d.stats.devnet.burns > 0);
  });

  test("registry rows and activity rows on the devnet cluster are dropped only on a mainnet host", () => {
    const rows = [{ ticker: "A", cluster: "mainnet" }, { ticker: "B", cluster: "devnet" }];
    assert.deepEqual(publicRegistryRows(rows, "mainnet").map((r) => r.ticker), ["A"]);
    assert.deepEqual(publicRegistryRows(rows, "devnet").map((r) => r.ticker), ["A", "B"]);
    assert.deepEqual(publicEvents([{ network: "devnet" as const }, { network: "mainnet" as const }], "mainnet"), [{ network: "mainnet" }]);
    assert.equal(publicEvents([{ network: "devnet" as const }], "devnet").length, 1);
    assert.equal(hidesDevnet("mainnet"), true);
    assert.equal(hidesDevnet("devnet"), false);
    assert.equal(siteCluster({ BURNTICKER_CLUSTER: "mainnet" }), "mainnet");
    assert.equal(siteCluster({}), "devnet");
  });

  test("the home API, tokens API and feeds pass the host's cluster to the filter", () => {
    const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
    assert.match(read("src/app/api/burnticker/home/route.ts"), /publicRegistryRows\(p\.registry\.tokens\(\), p\.cluster\)/);
    assert.match(read("src/app/api/burnticker/home/route.ts"), /rehearsalCurve, p\.cluster, tests\)/);
    assert.match(read("src/app/api/burnticker/tokens/route.ts"), /publicRegistryRows\(p\.registry\.tokens\(\), p\.cluster\)/);
    assert.match(read("src/lib/burnticker/feedsData.ts"), /publicEvents\(activityEvents\(/);
  });
});

describe("the devnet page", () => {
  test("lists each devnet coin with its mint and its burns, each linking its receipt check and transaction", () => {
    const d = devnetPageData(ROOT, [{ ticker: "PRAC", mint: "PracMint", cluster: "devnet", status: "live" }, { ticker: "MAIN", mint: "MainMint", cluster: "mainnet", status: "live" }]);
    const deficit = d.coins.find((c) => c.ticker === "DEFICIT")!;
    assert.equal(deficit.mint, DEVNET_DEFICIT_MINT);
    assert.match(deficit.mintHref!, /cluster=devnet$/);
    assert.ok(deficit.burns.length > 0);
    for (const b of deficit.burns) {
      assert.match(b.checkHref, /&cluster=devnet#verify$/);
      assert.match(b.explorerHref, /\?cluster=devnet$/);
      assert.match(b.text, /^Burned /);
    }
    assert.ok(d.coins.some((c) => c.ticker === "PCA") && d.coins.some((c) => c.ticker === "PCB"));
    assert.equal(d.coins.find((c) => c.ticker === "PRAC")?.pageHref, "/burnticker/t/PRAC");
    assert.ok(!d.coins.some((c) => c.ticker === "MAIN"), "a mainnet coin is not a practice run");
  });

  test("the page is headed by the plain sentence and is linked only from the Trust and History pages", () => {
    assert.equal(DEVNET_COPY.heading, "Practice runs on devnet, a test network where tokens have no money value.");
    const src = fs.readFileSync(path.join(ROOT, "src/app/burnticker/devnet/page.tsx"), "utf8");
    assert.match(src, /title=\{DEVNET_COPY\.heading\}/);
    assert.ok(HISTORY_COPY.links.some((l) => l.href === DEVNET_HREF));
    assert.match(fs.readFileSync(path.join(ROOT, "src/app/burnticker/trust/page.tsx"), "utf8"), /href=\{DEVNET_HREF\}/);
    const walk = (dir: string): string[] => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(dir, e.name)) : /\.(tsx?|mjs)$/.test(e.name) ? [path.join(dir, e.name)] : []);
    const linking = [...walk("src/app/burnticker"), ...walk("src/lib/burnticker")].filter((f) => /DEVNET_HREF|"\/burnticker\/devnet"/.test(fs.readFileSync(path.join(ROOT, f), "utf8")));
    assert.deepEqual(linking.sort(), ["src/app/burnticker/_components/nav.ts", "src/app/burnticker/devnet/page.tsx", "src/app/burnticker/trust/page.tsx", "src/lib/burnticker/devnetCopy.ts", "src/lib/burnticker/devnetHide.ts", "src/lib/burnticker/historyCopy.ts"].sort());
  });

  test("every sentence passes the copy lint", () => {
    const cfg = loadCopyLintConfig(ROOT);
    const lines = [...Object.values(DEVNET_COPY).filter((v): v is string => typeof v === "string"), DEVNET_COPY.burnLine("1014025.155046"), DEVNET_COPY.burnLine(null)];
    for (const t of lines) {
      const r = lintCopy(t, cfg);
      assert.ok(r.ok, `${t}\n${formatHits(r)}`);
      assert.doesNotMatch(t, / → |\bwill\b|\(\d+\)|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d/);
    }
  });
});
