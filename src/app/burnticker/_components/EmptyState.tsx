import type { ReactNode } from "react";
import { EMPTY_STATE_COPY, type EmptyKind } from "@/lib/burnticker/emptyState";
import { ReceiptMark } from "./Panel";

/**
 * ONE EMPTY STATE FOR EVERY SURFACE (src/lib/burnticker/emptyState.ts): not launched / no activity / loading / data unavailable. The
 * heading is always the kind's own words; `body` replaces the default sentence with a surface-specific one; `details` (operational
 * diagnostics: an HTTP status, an env-var name, an error message) sits behind a disclosure so a visitor reads ordinary words first.
 * `loading` renders a neutral skeleton with the same footprint, never the content it stands in for, and no visible words.
 */
export function EmptyState({ kind, body, details, children, compact = false }: { kind: EmptyKind; body?: ReactNode; details?: string | null; children?: ReactNode; compact?: boolean }) {
  const c = EMPTY_STATE_COPY[kind];
  const tone = kind === "unavailable" ? "border-amber-700/60" : "border-neutral-700";
  return (
    <div role={kind === "loading" ? "status" : undefined} aria-live={kind === "loading" ? "polite" : undefined} aria-busy={kind === "loading" ? true : undefined}
      data-empty-state={kind} className={`rounded-lg border border-dashed ${tone} ${compact ? "p-3" : "p-5"} text-sm text-neutral-300`}>
      {/* review item 18 (2026-10-12): a loading state is a skeleton, not words; the heading and sentence stay for screen readers */}
      {kind === "loading" ? (<>
        <p className="sr-only">{c.heading}</p>
        <div className="space-y-2" aria-hidden="true" data-skeleton>
          <div className="bt-skel h-3 w-1/3 motion-safe:animate-pulse" />
          <div className="bt-skel h-3 w-2/3 motion-safe:animate-pulse" />
          <div className="bt-skel h-3 w-1/2 motion-safe:animate-pulse" />
        </div>
        <p className="sr-only">{body ?? c.body}</p>
      </>) : (
        // legitimacy pass item 4: every empty state in the receipt language, a small receipt mark beside its heading and one sentence
        <div className="bt-empty-row">
          <ReceiptMark size={compact ? 22 : 28} />
          <div>
            <p className="font-mono text-[11px] uppercase tracking-widest text-neutral-500">{c.heading}</p>
            <p className="mt-1">{body ?? c.body}</p>
          </div>
        </div>
      )}
      {children}
      {details ? <details className="mt-2 text-xs text-neutral-500"><summary className="cursor-pointer">Details</summary><p className="mt-1 break-words font-mono">{details}</p></details> : null}
    </div>
  );
}
