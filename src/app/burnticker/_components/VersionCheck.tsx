"use client";

import { useEffect, useRef, useState } from "react";
import { BUILD_PATH, RELOAD_LABEL, VERSION_CHECK_EVENT, mayCheck, staleNotice, usableBuildId } from "@/lib/burnticker/buildVersion";

/**
 * The one-line "earlier version" notice (buildVersion.ts). `served` is the build id the server rendered this page from; the host's current
 * id is asked for when the window regains focus and when the launch page's review opens (VERSION_CHECK_EVENT), at most once every 15 seconds.
 * It never reloads by itself.
 */
export function VersionCheck({ served }: { served: string | null }) {
  const [line, setLine] = useState<string | null>(null);
  const last = useRef<number | null>(null);
  useEffect(() => {
    if (!usableBuildId(served)) return;
    let alive = true;
    const check = () => {
      const now = Date.now();
      if (!mayCheck(last.current, now)) return;
      last.current = now;
      fetch(BUILD_PATH, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j: { build?: unknown } | null) => { if (alive && j) setLine(staleNotice(served, j.build)); }).catch(() => { /* a failed check says nothing */ });
    };
    const onFocus = () => check();
    const onVis = () => { if (document.visibilityState === "visible") check(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener(VERSION_CHECK_EVENT, onFocus);
    return () => { alive = false; window.removeEventListener("focus", onFocus); document.removeEventListener("visibilitychange", onVis); window.removeEventListener(VERSION_CHECK_EVENT, onFocus); };
  }, [served]);
  if (!line) return null;
  return (
    <p role="status" data-version-notice className="z-30 mx-auto max-w-5xl rounded border border-amber-400 bg-neutral-950/95 px-3 py-2 text-sm text-amber-300 sm:sticky" style={{ top: "var(--bt-header-h, 3.5rem)" }}>
      {line} <button type="button" className="underline" onClick={() => window.location.reload()}>{RELOAD_LABEL}</button>
    </p>
  );
}
