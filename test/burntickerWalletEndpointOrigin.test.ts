import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { sameOriginProxy, RPC_PROXY_PATH } from "@/lib/burnticker/walletShell";

// 2026-10-16: the operator claim page opened through an ssh tunnel (http://localhost:3000) failed every RPC call with "Failed to fetch":
// the baked endpoint named https://burnticker.com/api/burnticker/rpc, a cross-origin POST the proxy and Cloudflare refuse.
test("the site's RPC proxy is rewritten to the page's own origin; anything else is left alone", () => {
  const baked = `https://burnticker.com${RPC_PROXY_PATH}`;
  assert.equal(sameOriginProxy(baked, "http://localhost:3000"), `http://localhost:3000${RPC_PROXY_PATH}`);
  assert.equal(sameOriginProxy(baked, "http://192.168.1.20:3000"), `http://192.168.1.20:3000${RPC_PROXY_PATH}`);
  assert.equal(sameOriginProxy(baked, "https://burnticker.com"), baked, "same origin: unchanged");
  assert.equal(sameOriginProxy("https://api.devnet.solana.com", "http://localhost:3000"), "https://api.devnet.solana.com", "a public cluster endpoint is never rewritten");
  assert.equal(sameOriginProxy(baked, undefined), baked, "server render: unchanged");
  assert.equal(sameOriginProxy("not a url", "http://localhost:3000"), "not a url");
});
test("both wallet providers pass the page's origin", () => {
  for (const f of ["src/app/burnticker/_components/ShellWalletProviders.tsx", "src/app/burnticker/launch/WalletProviders.tsx"]) {
    const src = fs.readFileSync(f, "utf8");
    assert.match(src, /sameOriginProxy\(/, f);
    assert.match(src, /typeof window === "undefined" \? undefined : window\.location\.origin/, f);
  }
});
