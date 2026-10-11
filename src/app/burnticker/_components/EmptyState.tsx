import type { ReactNode } from "react";
import { EMPTY_STATE_COPY, type EmptyKind } from "@/lib/burnticker/emptyState";

/**
 * ONE EMPTY STATE FOR EVERY SURFACE (src/lib/burnticker/emptyState.ts): not launched / no activity / loading / data unavailable. The
 * heading is always the kind's own words; `body` replaces the default sentence with a surface-specific one; `details` (operational
 * diagnostics: an HTTP status, an env-var name, an error message) sits behind a disclosure so a visitor reads ordinary words first.
 * `loading` renders a neutral skeleton with the same footprint, never the content it stands in for.
 */
export function EmptyState({ kind, body, details, children, compact = false }: { kind: EmptyKind; body?: ReactNode; details?: string | null; children?: ReactNode; compact?: boolean }) {
  const c = EMPTY_STATE_COPY[kind];
  const tone = kind === "unavailable" ? "border-amber-700/60" : "border-neutral-700";
  return (
    <div role={kind === "loading" ? "status" : undefined} aria-live={kind === "loading" ? "polite" : undefined} aria-busy={kind === "loading" ? true : undefined}
      data-empty-state={kind} className={`rounded-lg border border-dashed ${tone} ${compact ? "p-3" : "p-5"} text-sm text-neutral-300`}>
      <p className="font-mono text-[11px] uppercase tracking-widest text-neutral-500">{c.heading}</p>
      {kind === "loading" ? (
        <div className="mt-2 space-y-2" aria-hidden="true">
          <div className="h-3 w-2/3 rounded bg-neutral-800 motion-safe:animate-pulse" />
          <div className="h-3 w-1/2 rounded bg-neutral-800 motion-safe:animate-pulse" />
        </div>
      ) : null}
      <p className={kind === "loading" ? "sr-only" : "mt-1"}>{body ?? c.body}</p>
      {children}
      {details ? <details className="mt-2 text-xs text-neutral-500"><summary className="cursor-pointer">Details</summary><p className="mt-1 break-words font-mono">{details}</p></details> : null}
    </div>
  );
}
