// Owner's UX walkthrough 2026-10-18: pair pages opened titled "Burnticker" with no canonical address and showed "Loading" for about
// three seconds. The server layout now gives each pair page its own title, description, canonical address and share card from the
// registry, and the matchup heading is in the first HTML while the slow reads load in the browser.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { pairSeed } from "@/lib/burnticker/pairPageMeta";
import { withShareCard, OG_IMAGE } from "@/lib/burnticker/pageMeta";
import { lintCopy } from "@/lib/launch/copyLint";

const TOK = new Map([
  ["a1", { mint: "a1", ticker: "PITWIN", name: "Steelers win", status: "live", launchTx: "sig" }],
  ["b1", { mint: "b1", ticker: "BALWIN", name: "Ravens win", status: "live", launchTx: "sig" }],
  ["a2", { mint: "a2", ticker: "AAA", name: "Alpha", status: "live", launchTx: "sig" }],
  ["b2", { mint: "b2", ticker: "BBB", name: "Beta", status: "live", launchTx: "sig" }],
]);
const PAIRS = [{ pairId: "pitwin-vs-balwin-2", mintA: "a1", mintB: "b1", selectorKey: "x", createdAt: 1 }, { pairId: "aaa-vs-bbb", mintA: "a2", mintB: "b2", selectorKey: "x", createdAt: 2 }];
const reg = { pair: (id: string) => PAIRS.find((p) => p.pairId === id) ?? null, pairs: () => PAIRS, token: (m: string) => TOK.get(m) ?? null, tokens: () => [...TOK.values()] };

/** A client component file compiled from its TSX and rendered to HTML (next/link as the plain anchor it renders on the server). */
async function renderTsx(file: string, exportName: string, props: object): Promise<string> {
  const linkStub = `data:text/javascript,import { createElement } from ${JSON.stringify(import.meta.resolve("react"))}; export default ({ href, children, ...p }) => createElement("a", { href, ...p }, children);`;
  const js = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
    .replace(/^"use client";/m, "")
    .replace(/from "next\/link";/, `from ${JSON.stringify(linkStub)};`)
    .replace(/from "react\/jsx-runtime";/, `from ${JSON.stringify(import.meta.resolve("react/jsx-runtime"))};`)
    .replace(/from "react";/, `from ${JSON.stringify(import.meta.resolve("react"))};`);
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bt-pair-")), "c.mjs");
  fs.writeFileSync(out, js);
  const mod = (await import(out)) as Record<string, (p: object) => React.ReactElement>;
  return renderToStaticMarkup(React.createElement(mod[exportName], props));
}

describe("pair pages carry their own title, description, canonical address and heading from the registry", () => {
  test("pairSeed: '$A vs $B', the matchup in words, the canonical address; each side linked by its own coin page", () => {
    const s = pairSeed(reg as never, "aaa-vs-bbb")!;
    assert.equal(s.title, "$AAA vs $BBB");
    assert.equal(s.canonical, "/burnticker/p/aaa-vs-bbb");
    assert.equal(s.matchup, "Alpha against Beta");
    assert.deepEqual([s.a.href, s.b.href], ["/burnticker/t/AAA", "/burnticker/t/BBB"]);
    assert.equal(pairSeed(reg as never, "nope"), null);
    assert.deepEqual(lintCopy(s.description).hits, [], s.description);
    assert.doesNotMatch(s.description, /\bwill\b|\bbuy|\bprice|payout|→/i);
  });
  test("the page metadata (before: title 'Burnticker', no canonical, the site's og:url)", () => {
    const s = pairSeed(reg as never, "pitwin-vs-balwin-2")!;
    const m = withShareCard({ title: s.title, description: s.description, alternates: { canonical: s.canonical } });
    assert.equal(m.title, "$PITWIN vs $BALWIN");
    assert.deepEqual(m.alternates, { canonical: "/burnticker/p/pitwin-vs-balwin-2" });
    const og = m.openGraph as { url?: string; title?: string; description?: string; images?: { url: string }[] };
    assert.equal(og.url, "/burnticker/p/pitwin-vs-balwin-2");
    assert.equal(og.title, "$PITWIN vs $BALWIN · Burnticker");
    assert.equal(og.description, s.description);
    assert.equal(og.images?.[0].url, OG_IMAGE.url);
  });
  test("the rendered heading: both tickers linked to their coin pages and the matchup, with no arrow", async () => {
    const s = pairSeed(reg as never, "pitwin-vs-balwin-2")!;
    const html = await renderTsx("src/app/burnticker/p/[pairId]/PairSeed.tsx", "PairSeedHeading", { seed: s });
    assert.match(html, /<h1[^>]*><a href="\/burnticker\/t\/PITWIN"[^>]*>\$PITWIN<\/a> <span[^>]*>vs<\/span> <a href="\/burnticker\/t\/BALWIN"[^>]*>\$BALWIN<\/a><\/h1>/);
    assert.match(html, /<p[^>]*data-pair-matchup="[^"]*">Steelers win against Ravens win<\/p>/);
    assert.doesNotMatch(html, /←|→/);
  });
  test("the layout reads the registry at request time and the page shows the heading while loading", () => {
    const layout = fs.readFileSync("src/app/burnticker/p/[pairId]/layout.tsx", "utf8");
    assert.match(layout, /export async function generateMetadata/);
    assert.match(layout, /withShareCard\(\{ title: s\.title, description: s\.description, alternates: \{ canonical: s\.canonical \} \}\)/);
    assert.match(layout, /<PairSeedProvider seed=\{seedOf\(pairId\)\}>\{children\}<\/PairSeedProvider>/);
    const page = fs.readFileSync("src/app/burnticker/p/[pairId]/page.tsx", "utf8");
    assert.match(page, /if \(!d\) return <main[^>]*>\{seed && <PairSeedHeading seed=\{seed\} \/>\}<EmptyState kind="loading" \/><\/main>;/);
  });
});
