// THE $DEFICIT SITE'S FIRST PAINT (campaign readiness 2026-10-19, item 1): renders the keeper's current state into the static page
// (src/lib/burnticker/deficitFirstPaint.ts) so the HTML a crawler, a link preview or a slow first paint sees is true.
//
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/alias-hook.mjs scripts/ops/deficit-first-paint.mts \
//        <template index.html> <status.json> <burns.json> <out index.html>
//
// Run by scripts/ops/deploy-sites.sh on every publish. Writes <out> (tmp + rename) only when the rendered page differs from it and prints
// one line when it did; prints nothing otherwise. A status.json that is missing or unreadable leaves <out> alone (exit 0) and says so;
// a burns.json that is missing or unreadable renders the receipts table as unavailable, never as empty.
import fs from "node:fs";
import { deficitFirstPaint } from "../../src/lib/burnticker/deficitFirstPaint.ts";

const [template, statusFile, burnsFile, out] = process.argv.slice(2);
if (!template || !statusFile || !burnsFile || !out) { console.error("usage: deficit-first-paint.mts <template> <status.json> <burns.json> <out>"); process.exit(2); }
const readJson = (f: string): unknown => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };
const status = readJson(statusFile) as { schema?: string; readiness?: { state?: string } } | null;
if (!status) { console.log(`skipped: ${statusFile} is missing or unreadable, so ${out} is left as it is`); process.exit(0); }
const html = deficitFirstPaint(fs.readFileSync(template, "utf8"), status, readJson(burnsFile));
let current: string | null = null;
try { current = fs.readFileSync(out, "utf8"); } catch { current = null; }
if (current === html) process.exit(0);
const tmp = `${out}.tmp-${process.pid}`;
fs.writeFileSync(tmp, html, { mode: 0o644 });
fs.renameSync(tmp, out);
console.log(`index.html rendered from status.json (${status.schema === "burnkeeper.status/v1" ? `readiness ${status.readiness?.state ?? "unknown"}` : "not the keeper's live schema, template as is"})`);
