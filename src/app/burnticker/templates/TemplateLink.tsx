"use client";

import { useState } from "react";
import Link from "next/link";
import { DRAFT_STORE, KEEP_DRAFT, REPLACE_DRAFT, draftToReplace, replaceDraftLine } from "@/lib/burnticker/launchDraftStore";

/**
 * HS-53 (hourly run 11): a templates link opens the launch page on that template, and the launch page drops the draft in progress when a
 * link names a template (snag 6). With a draft in this tab's storage the link asks first, naming the draft; "Keep my draft" stays here.
 * Without one it is a plain link.
 */
export function TemplateLink({ href, className, children, ...rest }: { href: string; className?: string; children: React.ReactNode } & Record<`data-${string}`, string | undefined>) {
  const [ask, setAsk] = useState<string | null>(null);
  const onClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;   // a new tab leaves this tab's draft alone
    let stored: string | null = null;
    try { stored = sessionStorage.getItem(DRAFT_STORE); } catch { stored = null; }
    const d = draftToReplace(stored);
    if (!d) return;
    e.preventDefault();
    setAsk(replaceDraftLine(d));
  };
  return (
    <>
      <Link className={className} href={href} onClick={onClick} {...rest}>{children}</Link>
      {ask && (
        <div className="mt-2 rounded border border-amber-400/40 p-2 text-xs text-neutral-200" role="alertdialog" aria-label="Replace your draft" data-replace-draft>
          <p>{ask}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className="rounded bg-amber-400 px-2 py-1 font-medium text-neutral-950" onClick={() => { window.location.href = href; }}>{REPLACE_DRAFT}</button>
            <button type="button" className="rounded border border-neutral-700 px-2 py-1" onClick={() => setAsk(null)}>{KEEP_DRAFT}</button>
          </div>
        </div>
      )}
    </>
  );
}
