"use client";

import { useEffect, useState } from "react";

/**
 * "Embed this coin" (growth batch 2026-10-10): the copy-paste box on every coin page and pair page — an iframe of
 * /burnticker/embed/<id> (the receipt card with a live next-settlement line) and a Markdown badge of /api/burnticker/v1/badge/<id>.svg
 * linking back to the page. Built from the page's own origin; nothing is fetched. The card itself carries no market data (badge.ts).
 */
export function EmbedSnippet({ kind, id, label }: { kind: "coin" | "pair"; id: string; label: string }) {
  const [origin, setOrigin] = useState("https://burnticker.com");
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => { setOrigin(window.location.origin); }, []);
  const enc = encodeURIComponent(id);
  const embed = kind === "coin" ? `/burnticker/embed/${enc}` : `/burnticker/embed/pairs/${enc}`;
  const badge = kind === "coin" ? `/api/burnticker/v1/badge/${enc}.svg` : `/api/burnticker/v1/badge/pairs/${enc}.svg`;
  const page = kind === "coin" ? `/burnticker/t/${enc}` : `/burnticker/p/${enc}`;
  const alt = `${label} receipts on Burnticker`.replace(/[[\]"<>]/g, "");
  const rows = [
    { id: "iframe", title: "iframe (live card)", text: `<iframe src="${origin}${embed}" width="480" height="${kind === "coin" ? 230 : 254}" style="border:0;max-width:100%" loading="lazy" title="${alt}"></iframe>` },
    { id: "markdown", title: "Markdown badge", text: `[![${alt}](${origin}${badge})](${origin}${page})` },
  ];
  const copy = (k: string, t: string) => { navigator.clipboard?.writeText(t).then(() => { setCopied(k); setTimeout(() => setCopied(null), 1500); }).catch(() => setCopied(null)); };
  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-3 text-xs" aria-label={kind === "coin" ? "Embed this coin" : "Embed this pair"}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-medium text-sm">{kind === "coin" ? "Embed this coin" : "Embed this pair"}</h2>
        <span className="text-neutral-500">the receipt card · no market data · refreshes every minute</span>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={badge} alt={alt} width={480} className="mt-2 max-w-full h-auto" loading="lazy" />
      <div className="mt-2 space-y-2">{rows.map((r) => (
        <div key={r.id}>
          <div className="flex items-center justify-between gap-2"><span className="text-neutral-400">{r.title}</span><button type="button" className="bt-copy" onClick={() => copy(r.id, r.text)} aria-label={`Copy the ${r.title}`}>{copied === r.id ? "copied" : "copy"}</button></div>
          <pre className="mt-1 overflow-x-auto rounded bg-neutral-950 p-2 whitespace-pre-wrap break-all">{r.text}</pre>
        </div>
      ))}</div>
      <p className="mt-2 text-neutral-500">Also: <a className="underline" href={badge.replace(/\.svg$/, ".png")}>PNG</a> · <a className="underline" href={badge.replace(/\.svg$/, ".json")}>JSON</a> · <a className="underline" href={embed} target="_blank" rel="noopener">open the embed</a>.</p>
    </section>
  );
}
