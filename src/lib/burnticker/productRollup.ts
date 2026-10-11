import type { ProductStore } from "@/lib/burnticker/productStore";

/** The weekly rollup as markdown (scripts/burnticker-search-misses.mts): pure over the store's two summaries. */
export function rollupMarkdown(m: ReturnType<ProductStore["missSummary"]>, t: ReturnType<ProductStore["timingSummary"]>, o: { days: number; now: number }): string {
  const sec = (x: number | null) => (x === null ? "—" : x >= 120 ? `${Math.round(x / 60)} min` : `${x} s`);
  const L = [`# Search misses and time-to-launch — last ${o.days} days`, "", `Generated ${new Date(o.now).toISOString().slice(0, 16)}Z from the registry (anonymous: no IP, no id, no wallet; queries folded to plain words).`, "",
    `## Searches that missed (${m.total}: ${m.noCard} with no card, ${m.noClick} with cards but no click)`, ""];
  if (!m.queries.length) L.push("None in this window.", "");
  else { L.push("| Query | Misses | No card | No click | Last seen (UTC hour) |", "| --- | ---: | ---: | ---: | --- |"); for (const q of m.queries) L.push(`| ${q.query.replace(/\|/g, "/")} | ${q.misses} | ${q.noCard} | ${q.noClick} | ${q.lastHour} |`); L.push(""); }
  L.push(`## Time to launch (${t.drafts} draft${t.drafts === 1 ? "" : "s"})`, "", "| Step | Drafts | p50 | p90 |", "| --- | ---: | ---: | ---: |");
  for (const s of t.steps) L.push(`| ${s.label} | ${s.n} | ${sec(s.p50Sec)} | ${sec(s.p90Sec)} |`);
  L.push(`| **search to Launch, total** | ${t.total.n} | ${sec(t.total.p50Sec)} | ${sec(t.total.p90Sec)} |`, "");
  return L.join("\n");
}
