// WEBSITE AUDIT 4 (2026-10-11), BT-19 + BT-23: the proposed Content-Security-Policy (report-only; deploy/caddy/csp-and-cache.proposed.caddy)
// allows every host the pages actually fetch from, keeps framing off, and is not yet imported by the live Caddyfile (the owner applies
// it). The cache proposal keeps every status/receipt file no-store.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PUBLIC_RPC } from "@/lib/burnticker/trustpack/receiptCheck";

const ROOT = path.join(import.meta.dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const proposal = read("deploy/caddy/csp-and-cache.proposed.caddy");
const policy = (name: string) => new RegExp(`\\(${name}\\) \\{\\s*header Content-Security-Policy-Report-Only "([^"]+)"`).exec(proposal)![1];
const directive = (p: string, d: string) => (p.split(";").map((x) => x.trim()).find((x) => x.startsWith(`${d} `)) ?? "").split(/\s+/).slice(1);
const origin = (u: string) => new URL(u).origin;

test("the static-site policy covers the hosts the static pages fetch and style from", () => {
  const p = policy("csp_report_only_static");
  const connect = directive(p, "connect-src");
  for (const u of ["https://api.fiscaldata.treasury.gov/x", "https://burnticker.com/api", PUBLIC_RPC.devnet, PUBLIC_RPC.mainnet]) assert.ok(connect.includes(origin(u)), u);
  // every absolute fetch( URL in the static pages is allowed
  for (const f of ["site/deficit/index.html", "site/burnticker/index.html", "site/burnticker/status/index.html"]) {
    for (const m of read(f).matchAll(/fetch\(\s*["'](https:\/\/[^"'/]+)/g)) assert.ok(connect.includes(m[1]), `${f}: ${m[1]}`);
  }
  assert.ok(directive(p, "style-src").includes("https://fonts.googleapis.com")); assert.ok(directive(p, "font-src").includes("https://fonts.gstatic.com"));
  assert.deepEqual(directive(p, "frame-ancestors"), ["'none'"]); assert.deepEqual(directive(p, "object-src"), ["'none'"]); assert.deepEqual(directive(p, "base-uri"), ["'none'"]);
});

test("the app policy covers the receipt verifier's RPCs (https + wss), Treasury, the arweave/Irys gateways and the host's wallet RPC placeholder", () => {
  const connect = directive(policy("csp_report_only_app"), "connect-src");
  for (const h of [PUBLIC_RPC.devnet, PUBLIC_RPC.mainnet]) { assert.ok(connect.includes(origin(h)), h); assert.ok(connect.includes(origin(h).replace("https:", "wss:")), `wss ${h}`); }
  for (const h of ["https://api.fiscaldata.treasury.gov", "https://arweave.net", "https://gateway.irys.xyz", "https://devnet.irys.xyz"]) assert.ok(connect.includes(h), h);
  assert.ok(connect.some((x) => x.startsWith("{$BURNTICKER_PUBLIC_RPC_ORIGIN")), "the host's NEXT_PUBLIC RPC origin is a named placeholder");
  // the pin uploader's gateways are the ones allowed
  const pin = read("src/lib/burnticker/pin.ts");
  for (const m of pin.matchAll(/`(https:\/\/[a-z.]+)\//g)) assert.ok(connect.includes(m[1]), m[1]);
});

test("report-only, not imported by the live Caddyfile; the cache proposal keeps status files no-store", () => {
  assert.doesNotMatch(proposal, /header Content-Security-Policy "/, "never an enforced policy in this proposal");
  assert.doesNotMatch(read("deploy/caddy/Caddyfile"), /csp_report_only|static_cache/, "the owner applies it on the host");
  const revalidate = /@revalidate path ([^\n]+)/.exec(proposal)![1];
  assert.doesNotMatch(revalidate, /\.json|\/t\/|status|burns|receipts/, "status and receipts are never cached");
  assert.equal(/@fresh not path ([^\n]+)/.exec(proposal)![1], revalidate, "everything not revalidated stays no-store");
});
