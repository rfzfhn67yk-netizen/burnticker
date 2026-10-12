"use client";

import { useEffect, useState } from "react";
import { SHARE_COPY } from "@/lib/burnticker/creatorBenefits";

/**
 * SHARE A COIN (website-17, creator benefits item 4): the routes that already exist, in one block — the coin page's link, the Markdown
 * badge (GET /api/burnticker/v1/badge/<TICKER>.svg linking the page), the live card iframe (/burnticker/embed/<TICKER>) and the image a
 * link preview shows (the badge's PNG, which the coin page's Open Graph tags name). Built from the page's own origin; nothing is fetched
 * except the preview image. Used on the creator page; the coin page can use it too (WIRING-17.md). Words: creatorBenefits.ts SHARE_COPY.
 */
export function ShareBlock({ ticker }: { ticker: string }) {
  const [origin, setOrigin] = useState("https://burnticker.com");
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => { setOrigin(window.location.origin); }, []);
  const t = encodeURIComponent(ticker);
  const page = `${origin}/burnticker/t/${t}`, badge = `${origin}/api/burnticker/v1/badge/${t}.svg`, embed = `${origin}/burnticker/embed/${t}`;
  const alt = `$${ticker} receipts on Burnticker`.replace(/[[\]"<>]/g, "");
  const rows = [
    { id: "link", title: SHARE_COPY.link, text: page },
    { id: "markdown", title: SHARE_COPY.markdown, text: `[![${alt}](${badge})](${page})` },
    { id: "iframe", title: SHARE_COPY.iframe, text: `<iframe src="${embed}" width="480" height="230" style="border:0;max-width:100%" loading="lazy" title="${alt}"></iframe>` },
  ];
  const copy = (k: string, text: string) => { navigator.clipboard?.writeText(text).then(() => { setCopied(k); setTimeout(() => setCopied(null), 1500); }).catch(() => setCopied(null)); };
  return (
    <div className="space-y-2 text-xs" data-share={ticker}>
      {rows.map((r) => (
        <div key={r.id}>
          <div className="flex items-center justify-between gap-2"><span className="text-neutral-400">{r.title}</span><button type="button" className="bt-copy" onClick={() => copy(r.id, r.text)} aria-label={`${SHARE_COPY.copy}: ${r.title}`}>{copied === r.id ? SHARE_COPY.copied : SHARE_COPY.copy}</button></div>
          <pre className="mt-1 overflow-x-auto rounded bg-neutral-950 p-2 whitespace-pre-wrap break-all">{r.text}</pre>
        </div>
      ))}
      <div>
        <span className="text-neutral-400">{SHARE_COPY.preview}</span>
        {/* eslint-disable-next-line @next/next/no-img-element -- the badge route's own PNG */}
        <img src={`/api/burnticker/v1/badge/${t}.png`} alt={alt} width={480} className="mt-1 h-auto max-w-full" loading="lazy" />
        <p className="mt-1 text-neutral-500">{SHARE_COPY.previewNote}</p>
      </div>
    </div>
  );
}
