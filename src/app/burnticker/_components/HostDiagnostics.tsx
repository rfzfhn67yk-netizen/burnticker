/**
 * THIS HOST'S WIRING, FOR THE OPERATOR (UX report 3 item 4). The raw notes (client class names, missing environment variables, script
 * names) stay readable but sit behind a disclosure; a visitor sees one ordinary sentence first. These notes describe what THIS web host
 * can read, not whether the programs are deployed — that is the current-status summary on the trust page.
 */
export function HostDiagnostics({ stubs, cluster }: { stubs: string[]; cluster?: string | null }) {
  if (!stubs.length) return null;
  return (
    <details className="text-xs text-neutral-500" data-host-diagnostics>
      <summary className="cursor-pointer">{cluster ? `This host reads ${cluster}. ` : ""}Some live reads are not wired on this host ({stubs.length}) — operator details</summary>
      <ul className="mt-1 list-disc pl-5 break-words font-mono">{stubs.map((s) => <li key={s}>{s}</li>)}</ul>
    </details>
  );
}
