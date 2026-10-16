"use client";

import { ERROR_COPY } from "@/lib/burnticker/errorCopy";

/**
 * THE LAST-RESORT ERROR PAGE (audit 2026-10-15 H7): shown only when the root layout itself fails, so it carries its own document and
 * plain inline colours (the site's stylesheet may be what failed). Neutral words; "Try again" re-renders (Next's `retry`, else `reset`).
 */
export default function GlobalError({ error, retry, reset }: { error: Error & { digest?: string }; retry?: () => void; reset?: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#0a0a0a", color: "#ededed", fontFamily: "system-ui, sans-serif" }}>
        <main style={{ maxWidth: 640, margin: "0 auto", padding: "48px 16px" }} data-global-error role="alert">
          <title>{ERROR_COPY.heading}</title>
          <p style={{ fontSize: 12, letterSpacing: "0.1em", textTransform: "uppercase", color: "#a3a3a3" }}>{ERROR_COPY.kicker}</p>
          <h1 style={{ fontSize: 24 }}>{ERROR_COPY.heading}</h1>
          <p>{ERROR_COPY.body}</p>
          <p style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <button type="button" onClick={() => (retry ?? reset)?.()} style={{ padding: "8px 14px", borderRadius: 6, border: "1px solid #ffb000", background: "#ffb000", color: "#12100e", cursor: "pointer" }}>{ERROR_COPY.retry}</button>
            <a href="/burnticker" style={{ color: "#ededed" }}>{ERROR_COPY.coins}</a>
            <a href="/" style={{ color: "#ededed" }}>{ERROR_COPY.home}</a>
          </p>
          {error?.digest && <p style={{ fontSize: 12, color: "#a3a3a3", wordBreak: "break-all" }}>{ERROR_COPY.reference}: {error.digest}</p>}
        </main>
      </body>
    </html>
  );
}
