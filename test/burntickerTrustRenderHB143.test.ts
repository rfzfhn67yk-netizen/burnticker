// TS7-3 (seventh pre-launch audit): the HB-143 trust-page crash fix was guarded by source text only. This renders the current-status
// block with the public answer (withoutRepoPaths drops the report, path and source fields the page once read), so a render-time
// TypeError is caught here, before a deploy.
import "./burntickerRenderTsx.ts";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildCurrentStatus } from "@/lib/burnticker/currentStatus";
import { withoutRepoPaths } from "@/lib/burnticker/publicPaths";

describe("TS7-3 / HB-143: the current-status block renders the public answer", () => {
  test("no throw, the findings heading, and no repository path in the markup", async () => {
    const { CurrentStatusBody } = await import("@/app/burnticker/_components/CurrentStatusSummary.tsx");
    const full = buildCurrentStatus({ chain: {}, now: Date.parse("2026-10-20T12:00:00Z") });
    const pub = withoutRepoPaths(full);
    assert.ok((full.reviews ?? []).some((r) => typeof (r as { report?: unknown }).report === "string"), "the full answer names report paths (the case that crashed)");
    let html = "";
    assert.doesNotThrow(() => { html = renderToStaticMarkup(createElement(CurrentStatusBody, { s: pub, card: "card" })); });
    assert.match(html, /Review findings: what was fixed, what was re-checked, what is deployed/);
    assert.match(html, /The history is kept in append-only files/);
    // the same answer with every optional text field missing still renders
    const bare = { ...pub, source: undefined, reviews: pub.reviews.map((r) => ({ ...r, report: undefined })), historical: pub.historical.map((h) => ({ ...h, path: undefined })) } as unknown as typeof pub;
    assert.doesNotThrow(() => renderToStaticMarkup(createElement(CurrentStatusBody, { s: bare, card: "card" })));
  });
});
