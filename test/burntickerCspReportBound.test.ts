// 2026-10-16 prelaunch audit F-28: csp-report/route.ts kept an unbounded Map keyed by any directive-shaped name a caller sent, logged it
// every minute, and read the whole body before its 16 KiB check. Now: a fixed allow-list of CSP directive names (anything else counts
// as "other"), a bounded counter, and the body read through readTextCapped (cut at 16 KiB while it streams).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import * as csp from "@/lib/burnticker/csp";

const post = (body: BodyInit, headers: Record<string, string> = {}) => new Request("http://x/api/burnticker/csp-report", { method: "POST", body, headers, duplex: "half" } as RequestInit);

describe("the CSP report counter (F-28)", () => {
  test("a directive name outside the CSP list is counted as other, never as its own key", async () => {
    const { POST } = await import("../src/app/api/burnticker/csp-report/route.ts");
    const r = await POST(post(JSON.stringify({ "csp-report": { "effective-directive": "made-up-directive" } })));
    assert.equal(((await r.json()) as { counted: string }).counted, "other");
    const ok = await POST(post(JSON.stringify({ "csp-report": { "effective-directive": "script-src-elem" } })));
    assert.equal(((await ok.json()) as { counted: string }).counted, "script-src-elem");
  });

  test("a thousand distinct names keep the counter at the allow-list's size", async () => {
    const { POST } = await import("../src/app/api/burnticker/csp-report/route.ts");
    const letters = (i: number) => i.toString(26).replace(/\d/g, (d) => "qrstuvwxyz"[Number(d)]);
    for (let i = 0; i < 1000; i++) await POST(post(JSON.stringify({ "csp-report": { "effective-directive": `zz-${letters(i)}-src` } })));
    const counts = (csp as unknown as { cspReportCounts?: Map<string, number> }).cspReportCounts;
    assert.ok(counts, "the counter is exported from csp.ts so its bound can be checked");
    assert.ok(counts!.size <= (csp as unknown as { CSP_REPORT_MAX_KEYS: number }).CSP_REPORT_MAX_KEYS, `the counter holds ${counts!.size} keys`);
    assert.ok(!counts!.has("zz-a-src"));
  });

  test("a body past 16 KiB with no content-length is cut while it streams (413), not read whole", async () => {
    const { POST } = await import("../src/app/api/burnticker/csp-report/route.ts");
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({ pull(c) { pulled++; if (pulled > 200) { c.close(); return; } c.enqueue(new Uint8Array(4096).fill(120)); } });
    const r = await POST(post(stream));
    assert.equal(r.status, 413);
    assert.ok(pulled < 20, `the route pulled ${pulled} chunks of 4 KiB before refusing`);
  });
});
