import { repoUrl, splitRepoPaths } from "@/lib/burnticker/currentStatusLinks";

/**
 * A sentence whose repository paths are links to the public repository at the pinned commit (website audit 4, BT-14): the path stays
 * visible and copyable, the link opens the exact version the page cites.
 */
export function RepoText({ text, className }: { text: string | null | undefined; className?: string }) {
  // HB-143: a field the public answer left out (a whole repository path) renders nothing rather than crashing the page
  if (!text) return null;
  return (
    <span className={className}>
      {splitRepoPaths(text).map((p, i) => p.path
        ? <a key={i} className="underline decoration-dotted break-all" href={repoUrl(p.path)} target="_blank" rel="noreferrer" title={`${p.path} at the pinned public commit`}><code>{p.text}</code></a>
        : <span key={i}>{p.text}</span>)}
    </span>
  );
}
