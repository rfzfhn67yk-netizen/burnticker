import { HOST_GAPS_HEADING, HOST_NOTES_SUMMARY, hostGaps } from "@/lib/burnticker/hostGaps";

/**
 * WHAT THIS SITE DOES NOT SHOW, FOR A VISITOR (UX report 3 item 4; rewritten for ChatGPT audit 6 item 25). The host's raw notes (client
 * class names, missing environment variables, script names) are for the operator, and the old one-line notice about unconnected data
 * told a visitor nothing. A public page now lists only the real gaps, each in plain words with what it means for the visitor
 * (hostGaps.ts), and prints nothing when there is none. The raw notes appear only where `operator` is set (the Trust page), behind their
 * own disclosure. These notes describe what THIS web host reads, not whether the programs are deployed: that is the current-status
 * summary on the Trust page.
 */
export function HostDiagnostics({ stubs, cluster, operator = false }: { stubs: string[]; cluster?: string | null; operator?: boolean }) {
  const gaps = hostGaps(stubs);
  if (!gaps.length && !(operator && stubs.length)) return null;
  return (
    <div className="text-xs text-neutral-500 space-y-1" data-host-gaps>
      {gaps.length > 0 && <>
        <p className="font-medium text-neutral-400">{cluster ? `This site is showing ${cluster}. ` : ""}{HOST_GAPS_HEADING}</p>
        <ul className="list-disc pl-5 space-y-0.5">{gaps.map((g) => <li key={g.id}>{g.text}</li>)}</ul>
      </>}
      {operator && stubs.length > 0 && (
        <details data-host-diagnostics>
          <summary className="cursor-pointer">{HOST_NOTES_SUMMARY}</summary>
          <ul className="mt-1 list-disc pl-5 break-words font-mono">{stubs.map((s) => <li key={s}>{s}</li>)}</ul>
        </details>
      )}
    </div>
  );
}
