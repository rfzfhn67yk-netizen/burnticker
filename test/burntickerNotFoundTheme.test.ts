// Prelaunch audit 2026-10-18 A-24: with bt-theme=light stored, the 404 page showed the dark palette under the light header and its
// title flipped from "Page not found" to "$NOPE405 on Burnticker" after hydration. Next 16 answers a notFound() with a bare error
// document and builds the page in the browser, where the root layout's THEME_BOOT script never runs; ThemeSync re-applies the stored
// theme when the root mounts, and the coin layout gives an unknown coin the 404's own title.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { reapplyStoredTheme } from "@/app/burnticker/_components/theme";

const store = (v: string | null) => ({ getItem: (k: string) => (k === "bt-theme" ? v : null) });

/** The 404 component compiled from its TSX and rendered to HTML (next/link as the plain anchor it renders on the server). */
async function renderNotFound(): Promise<{ html: string; metadata: { title?: unknown } }> {
  const src = fs.readFileSync("src/app/burnticker/not-found.tsx", "utf8");
  const linkStub = `data:text/javascript,import { createElement } from ${JSON.stringify(import.meta.resolve("react"))}; export default ({ href, children, ...p }) => createElement("a", { href, ...p }, children);`;
  const js = ts.transpileModule(src, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
    .replace(/from "next\/link";/, `from ${JSON.stringify(linkStub)};`)
    .replace(/from "react\/jsx-runtime";/, `from ${JSON.stringify(import.meta.resolve("react/jsx-runtime"))};`);
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bt-404-")), "not-found.mjs");
  fs.writeFileSync(file, js);
  const mod = (await import(file)) as { default: () => React.ReactElement; metadata: { title?: unknown } };
  return { html: renderToStaticMarkup(React.createElement(mod.default)), metadata: mod.metadata };
}

describe("A-24: the 404 keeps the visitor's theme and its own title", () => {
  test("reapplyStoredTheme sets the stored theme, leaves a set theme alone, and survives blocked storage", () => {
    const root = { dataset: {} as DOMStringMap };
    reapplyStoredTheme(root, store("light"));
    assert.equal(root.dataset.theme, "light", "before: nothing set it on a 404, so the dark palette showed");
    reapplyStoredTheme(root, store("bogus"));
    assert.equal(root.dataset.theme, "light");
    const blank = { dataset: {} as DOMStringMap };
    reapplyStoredTheme(blank, { getItem: () => { throw new Error("SecurityError"); } });
    reapplyStoredTheme(blank, null);
    assert.equal(blank.dataset.theme, undefined, "no stored choice: the default stays");
  });
  test("the public root layout mounts ThemeSync inside the themed root with lang; ThemeSync runs before paint", () => {
    const layout = fs.readFileSync("config/public-repo/overlay/src/app/layout.tsx", "utf8");
    assert.match(layout, /<html lang="en"/);
    assert.match(layout, /<body className="bt-body">\s*\{\/\*[^]*?\*\/\}\s*<ThemeSync \/>/);
    assert.match(fs.readFileSync("config/public-repo/overlay/src/app/not-found.tsx", "utf8"), /export \{ default, metadata \} from ["]@\/app\/burnticker\/not-found["]/);
    assert.match(fs.readFileSync("src/app/burnticker/_components/ThemeSync.tsx", "utf8"), /useLayoutEffect\(\(\) => \{[^]*reapplyStoredTheme\(document\.documentElement, storage\)/);
  });
  test("the rendered 404 body: the site's own copy and links, theme-mapped classes only, and its own title", async () => {
    const { html, metadata } = await renderNotFound();
    assert.match(html, /<main[^>]*data-not-found/);
    assert.match(html, /<h1[^>]*>We could not find that page\.<\/h1>/);
    assert.match(html, /href="\/burnticker"/);
    // every colour class is one the light theme remaps (globals.css :root[data-theme="light"] --color-neutral-*)
    for (const c of html.match(/text-[a-z]+-\d{3}/g) ?? []) assert.match(c, /^text-neutral-\d{3}$/, c);
    assert.equal(metadata.title, "Page not found");
  });
  test("an unknown coin's page keeps the 404 title (before: '$NOPE405 on Burnticker' after hydration)", () => {
    const src = fs.readFileSync("src/app/burnticker/t/[ticker]/layout.tsx", "utf8");
    assert.match(src, /if \(l\?\.kind === "none" && !coinPageFound\(ticker, \(\) => l!, servedPages\(\)\)\) return NOT_FOUND_METADATA;/);
  });
});
