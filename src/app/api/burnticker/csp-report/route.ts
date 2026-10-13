// POST /api/burnticker/csp-report: browsers send Content-Security-Policy reports here (src/lib/burnticker/csp.ts; ChatGPT audit 7
// item 4). Counts only: the report's directive goes into an in-memory counter and the counts are logged at most once a minute. No
// address, page URL, blocked URL or any other part of a report is stored or logged. docs/burnticker/CSP.md says how to read the counts.
import { reportDirective } from "@/lib/burnticker/csp";

export const dynamic = "force-dynamic";

const MAX_BYTES = 16_384;
const counts = new Map<string, number>();
let lastLog = 0;

export async function POST(req: Request) {
  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > MAX_BYTES) return Response.json({ error: "The report is too large." }, { status: 413 });
  let body: unknown = null;
  try { const text = await req.text(); if (text.length > MAX_BYTES) return Response.json({ error: "The report is too large." }, { status: 413 }); body = JSON.parse(text); } catch { body = null; }
  const d = reportDirective(body);
  counts.set(d, (counts.get(d) ?? 0) + 1);
  const now = Date.now();
  if (now - lastLog > 60_000) { lastLog = now; console.log(`[csp-report] counts since start: ${[...counts].map(([k, v]) => `${k}=${v}`).join(" ")}`); }
  return Response.json({ counted: d }, { status: 200, headers: { "Cache-Control": "no-store" } });
}
