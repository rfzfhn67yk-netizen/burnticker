"use client";

import { useEffect, useState } from "react";
import type { DerbyScoreboard } from "@/lib/burnticker/derby/spec";
import { CALENDAR_ADD, CALENDAR_HEADING, EMBED_RECEIPT_LABEL, EMBED_RECEIPT_NOTE, SCOREBOARD_HEADING, calendarWhen, receiptEmbedSnippet, scoreboardLines } from "../../_components/featureCopy";

/**
 * WEBSITE-26 (WIRING-FEATURES items 2, 7 and 12): three small blocks of the coin page. The burn calendar (GET /v1/coins/<MINT>/calendar,
 * under the rule), the embeddable receipt (a closed disclosure with a copyable snippet of the receipt card by mint) and a Coin vs Coin
 * coin's live scoreboard (status.derbyScoreboard).
 */
interface Entry { id: string; kind: string; at: string | null; day: string; allDay: boolean; title: string; detail: string }
interface Calendar { source: "schedule" | "business-days" | "status" | "none"; entries: Entry[]; note: string; ics: string }

export function BurnCalendar({ mint, card }: { mint: string; card: string }) {
  const [c, setC] = useState<Calendar | null>(null), [err, setErr] = useState(false);
  useEffect(() => {
    let live = true;
    fetch(`/api/burnticker/v1/coins/${encodeURIComponent(mint)}/calendar`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))).then((j: Calendar) => { if (live) setC(j); }).catch(() => { if (live) setErr(true); });
    return () => { live = false; };
  }, [mint]);
  return (
    <section className={card + " text-xs"} aria-labelledby="calendar-h" data-burn-calendar>
      <h2 id="calendar-h" className="mb-2 text-sm font-medium">{CALENDAR_HEADING}</h2>
      {err ? <p className="text-neutral-500">The next readings could not be read just now.</p> : !c ? <p className="text-neutral-500">Reading the schedule.</p> : (
        <>
          {c.source !== "none" && c.entries.length > 0 && (
            <ol className="space-y-1.5" data-calendar-entries>
              {c.entries.map((e) => (
                <li key={e.id} className="min-w-0" data-calendar-kind={e.kind}>
                  <span className="font-mono text-neutral-200">{calendarWhen(e)}</span> <span className="text-neutral-100">{e.title}</span>
                  <span className="block text-[11px] text-neutral-500">{e.detail}</span>
                </li>
              ))}
            </ol>
          )}
          <p className="mt-2 text-neutral-400" data-calendar-note>{c.note}</p>
          {c.source !== "none" && c.entries.length > 0 && <p className="mt-2"><a className="underline" href={c.ics} download data-calendar-ics>{CALENDAR_ADD}</a></p>}
        </>
      )}
    </section>
  );
}

export function ReceiptEmbed({ mint, alt }: { mint: string; alt: string }) {
  const [copied, setCopied] = useState(false);
  const snippet = receiptEmbedSnippet(mint, alt);
  return (
    <details className="rounded-lg border border-neutral-800 bg-neutral-900 p-3 text-xs" data-receipt-embed>
      <summary className="cursor-pointer text-sm font-medium">{EMBED_RECEIPT_LABEL}</summary>
      {/* eslint-disable-next-line @next/next/no-img-element -- the receipt card this site serves */}
      <img src={`/burnticker/img/receipt/${encodeURIComponent(mint)}.png`} alt={alt} width={600} height={315} loading="lazy" className="mt-2 h-auto w-full max-w-[600px] rounded" />
      <div className="mt-2 flex items-center justify-between gap-2"><span className="text-neutral-400">HTML</span><button type="button" className="bt-copy" onClick={() => { navigator.clipboard?.writeText(snippet).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => setCopied(false)); }} aria-label="Copy the embed snippet">{copied ? "copied" : "copy"}</button></div>
      <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all rounded bg-neutral-950 p-2" data-receipt-snippet>{snippet}</pre>
      <p className="mt-2 text-neutral-500">{EMBED_RECEIPT_NOTE}</p>
    </details>
  );
}

export function ScoreboardCard({ s, card }: { s: DerbyScoreboard; card: string }) {
  const l = scoreboardLines(s);
  return (
    <section className={card} aria-label={SCOREBOARD_HEADING} data-derby-scoreboard>
      <h2 className="text-xs font-mono uppercase tracking-widest text-neutral-500">{SCOREBOARD_HEADING}</h2>
      <p className="mt-1 font-mono text-lg tabular-nums" data-score>{l.score}</p>
      <p className="text-xs text-neutral-300" data-run>{l.run}</p>
      {(s.ties > 0 || s.withheld > 0) && <p className="text-xs text-neutral-400">{`Tied days: ${s.ties}. Days withheld: ${s.withheld}.`}</p>}
      {l.streak && <p className="text-xs text-amber-200" data-streak>{l.streak}</p>}
      <p className="text-xs text-neutral-400">{l.moved}</p>
    </section>
  );
}
