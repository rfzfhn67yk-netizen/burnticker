// SHELL POLISH (site audit #11/#12/#14/#19, BT-14, BT-21; 2026-10-11).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (f: string) => fs.readFileSync(f, "utf8");

test("#11: a branded 404 inside the site shell, with links to Coins, Seasons, Launch, Trust and home; the public root uses it for unmatched URLs", () => {
  const nf = read("src/app/burnticker/not-found.tsx");
  for (const href of ['href="/burnticker"', 'href="/burnticker/leagues"', 'href="/burnticker/launch"', 'href="/burnticker/trust"', 'href="/"']) assert.ok(nf.includes(href), href);
  assert.match(nf, /We could not find that page\./); assert.match(nf, /robots: \{ index: false \}/);
  assert.match(read("config/public-repo/overlay/src/app/not-found.tsx"), /export \{ default, metadata \} from ["]@\/app\/burnticker\/not-found["]/);
});

test("#12: the coins index is titled 'Coins · Burnticker' (a server page carrying metadata around the client component)", () => {
  const p = read("src/app/burnticker/page.tsx");
  assert.doesNotMatch(p, /"use client"/);
  assert.match(p, /export const metadata: Metadata = \{ title: "Coins"/);
  assert.match(read("config/public-repo/overlay/src/app/layout.tsx"), /template: "%s · Burnticker"/);
  assert.match(read("src/app/burnticker/CoinsIndex.tsx"), /^"use client";/);
});

test("#14: the check page's instruction table is collapsed by default, below the verifier", () => {
  const c = read("src/app/burnticker/check/page.tsx");
  assert.match(c, /<details className="mt-2 text-xs" data-money-table><summary[^>]*>Show every instruction of both programs/);
  assert.doesNotMatch(c, /data-money-table open/);
  assert.ok(c.indexOf('{verifierAt === "top" && <ReceiptVerifier') < c.indexOf("data-money-table"));
});

test("BT-14: no path-only repository reference left on the trust, check and operator pages' prose", () => {
  for (const [f, path] of [["src/app/burnticker/trust/CoverageSection.tsx", "docs/burnticker/SETTLEMENT-COVERAGE.md"], ["src/app/burnticker/trust/page.tsx", "scripts/burnticker-audit.mts"], ["src/app/burnticker/operator/page.tsx", "docs/burnticker/TODO-OWNER.md"], ["src/app/burnticker/check/page.tsx", "docs/burnticker/CHECK-THIS-YOURSELF.md"], ["src/app/burnticker/check/page.tsx", "docs/burnticker/VERIFIED-BUILD.md"]]) {
    assert.ok(read(f).includes(`<RepoText text="${path}" />`), `${f}: ${path}`);
  }
  for (const f of ["src/app/burnticker/trust/page.tsx", "src/app/burnticker/trust/OpsSection.tsx"]) assert.doesNotMatch(read(f), /\/blob\/main\//, `${f} links a moving branch`);
});

test("#16: long unbroken strings wrap inside the app content; the receipt verifier's controls can shrink to a 320 px column", () => {
  assert.match(read("config/public-repo/overlay/src/app/globals.css"), /\.bt-content p, \.bt-content li, \.bt-content dd, \.bt-content td, \.bt-content summary, \.bt-content code, \.bt-content pre \{ overflow-wrap: anywhere; \}/);
  const v = read("src/app/burnticker/check/ReceiptVerifier.tsx");
  assert.match(v, /<select className="w-full min-w-0 max-w-full truncate/);
  assert.equal((v.match(/<label className="grid min-w-0 gap-1">/g) ?? []).length, 3);
});
