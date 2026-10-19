"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ERROR_COPY, deployRunning } from "@/lib/burnticker/errorCopy";

/**
 * THE BURNTICKER ERROR BOUNDARY (audit 2026-10-15 H7). A page under /burnticker that throws while rendering shows this inside the site's
 * header and footer (the root layout stays), never a blank page or a stack trace. "Try again" re-renders the segment (Next's `retry`,
 * else `reset`). The words are neutral; the deploy sentence appears only while /deploying.json exists. Caddy passes this page through
 * unless a deploy is running (deploy/caddy/Caddyfile).
 */
export default function BurntickerError({ error, retry, reset }: { error: Error & { digest?: string }; retry?: () => void; reset?: () => void }) {
  const [deploying, setDeploying] = useState(false);
  useEffect(() => { console.error("[burnticker] page error:", error?.digest ?? "", error?.message ?? error); }, [error]);
  useEffect(() => { let alive = true; void deployRunning().then((on) => { if (alive) setDeploying(on); }); return () => { alive = false; }; }, []);
  const again = () => (retry ?? reset)?.();
  return (
    <main className="mx-auto max-w-3xl px-4 py-12 space-y-4" data-error-boundary role="alert">
      <p className="font-mono text-xs uppercase tracking-widest text-neutral-500">{ERROR_COPY.kicker}</p>
      <h1 className="text-2xl font-semibold">{ERROR_COPY.heading}</h1>
      <p className="text-neutral-300">{deploying ? ERROR_COPY.deploying : ERROR_COPY.body}</p>
      <div className="flex flex-wrap gap-3 text-sm">
        <button type="button" className="bt-launch-btn" onClick={again} data-error-retry>{ERROR_COPY.retry}</button>
        <Link className="underline self-center" href="/burnticker">{ERROR_COPY.coins}</Link>
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- a full page load on purpose: after an error, nothing of the broken page's state is kept */}
        <a className="underline self-center" href="/">{ERROR_COPY.home}</a>
      </div>
      {error?.digest && <p className="text-xs text-neutral-500 break-all">{ERROR_COPY.reference}: <span className="font-mono">{error.digest}</span></p>}
    </main>
  );
}
