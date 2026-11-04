// Audit R01 (client half) / site audit #1, 2026-10-11: the trust page showed "Failed to execute 'json' on 'Response': Unexpected end of
// JSON input" on an empty 500. Every failure mode of a client read is now a typed plain-words result with a Retry, and the static sections
// of the trust page render regardless.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { readJson } from "@/lib/burnticker/readJson";

const res = (body: string, status = 200, type = "application/json") => new Response(body, { status, headers: { "content-type": type } });
const RAW = /Failed to execute|Unexpected end of JSON|Unexpected token|SyntaxError|JSON\.parse/;

test("a good body reads as data", async () => {
  const r = await readJson<{ a: number }>("/x", { fetchImpl: async () => res('{"a":1}') });
  assert.deepEqual(r, { ok: true, data: { a: 1 }, status: 200 });
});

for (const [name, impl, reason] of [
  ["empty 500 (the R01 reproduction)", async () => res("", 500), "http"],
  ["empty 200", async () => res("", 200), "empty"],
  ["HTML error page with 200", async () => res("<html><body>502 Bad Gateway</body></html>", 200, "text/html"), "not-json"],
  ["HTML error page with 503", async () => res("<!doctype html><title>503</title>", 503, "text/html"), "http"],
  ["JSON error body", async () => res('{"error":"rpc down"}', 500), "http"],
  ["rejected request", async () => { throw new TypeError("Failed to fetch"); }, "network"],
] as const) {
  test(`failure: ${name} → ${reason}, plain words only`, async () => {
    const r = await readJson("/api/burnticker/trust", { fetchImpl: impl as () => Promise<Response> });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.reason, reason);
    assert.doesNotMatch(r.message, RAW);
    assert.doesNotMatch(r.detail, RAW);
    assert.ok(r.message.length > 10);
  });
}

test("a JSON error body keeps its error text in the detail", async () => {
  const r = await readJson("/x", { fetchImpl: async () => res('{"error":"rpc down"}', 500) });
  assert.ok(!r.ok && /HTTP 500 — rpc down/.test(r.detail));
});

test("timeout: a fetch that never answers ends as a timeout, even if it ignores the abort signal", async () => {
  const r = await readJson("/slow", { timeoutMs: 30, fetchImpl: () => new Promise<Response>(() => {}) });
  assert.ok(!r.ok && r.reason === "timeout");
});

test("timeout: a body that never arrives ends as a timeout", async () => {
  const stalled = { ok: true, status: 200, headers: new Headers(), text: () => new Promise<string>(() => {}) } as unknown as Response;
  const r = await readJson("/slow-body", { timeoutMs: 30, fetchImpl: async () => stalled });
  assert.ok(!r.ok && r.reason === "timeout");
});

const read = (f: string) => fs.readFileSync(f, "utf8");

test("the trust surfaces never call Response.json() themselves; they read through useJsonRead and offer a Retry", () => {
  for (const f of ["src/app/burnticker/trust/page.tsx", "src/app/burnticker/trust/CoverageSection.tsx", "src/app/burnticker/trust/OpsSection.tsx", "src/app/burnticker/trust/TrustPackSection.tsx", "src/app/burnticker/_components/CurrentStatusSummary.tsx", "src/app/burnticker/check/CheckClient.tsx"]) {
    const s = read(f);
    assert.doesNotMatch(s, /\.json\(\)/, `${f} parses a Response itself`);
    assert.match(s, /useJsonRead/, f);
  }
  assert.match(read("src/app/burnticker/_components/useJsonRead.tsx"), /data-retry[\s\S]*Last tried/);
});

test("the trust page keeps its static sections when the live read fails (no early return on failure)", () => {
  const s = read("src/app/burnticker/trust/page.tsx");
  const body = s.slice(s.indexOf("export default function TrustPage"));
  assert.doesNotMatch(body, /if \((err|failure)\) return/);
  assert.match(body, /<CurrentStatusSummary card=\{card\} \/>[\s\S]*<TrustPackSection card=\{card\} \/>[\s\S]*ReadFailurePanel/);
  assert.match(body, /!t && <><CoverageSection card=\{card\} \/><OpsSection/);
  assert.match(body, /OPERATOR_LINE/, "the operator line is static copy, shown without the API");
});
