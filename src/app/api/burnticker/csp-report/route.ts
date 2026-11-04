// POST /api/burnticker/csp-report: browsers send Content-Security-Policy reports here (src/lib/burnticker/csp.ts; ChatGPT audit 7
// item 4). Counts only: the report's directive goes into an in-memory counter and the counts are logged at most once a minute, and only
// when they changed. No address, page URL, blocked URL or any other part of a report is stored or logged. docs/burnticker/CSP.md says
// how to read the counts. 2026-10-16 prelaunch audit F-28: the body is cut at 16 KiB while it streams (readTextCapped), and the counter
// takes only CSP directive names (csp.ts CSP_REPORT_DIRECTIVES; anything else is "other") in a bounded map.
import { countCspReport, cspReportCounts } from "@/lib/burnticker/cspReport";
import { readTextCapped } from "@/lib/burnticker/api/http";

export const dynamic = "force-dynamic";

const MAX_BYTES = 16_384;
let lastLog = 0;
let lastLine = "";

export async function POST(req: Request) {
  const text = await readTextCapped(req, MAX_BYTES);
  if (text === null) return Response.json({ error: "The report is too large." }, { status: 413 });
  let body: unknown = null;
  try { body = JSON.parse(text); } catch { body = null; }
  const d = countCspReport(body);
  const now = Date.now();
  if (now - lastLog > 60_000) {
    const line = [...cspReportCounts].map(([k, v]) => `${k}=${v}`).sort().join(" ");
    if (line !== lastLine) { lastLog = now; lastLine = line; console.log(`[csp-report] counts since start: ${line}`); }
  }
  return Response.json({ counted: d }, { status: 200, headers: { "Cache-Control": "no-store" } });
}
