"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * "Metadata pinned on Arweave · sha256 … · matches the locked description ✓" (pin.ts). The browser re-fetches the pinned JSON from the
 * arweave gateway, hashes the bytes (WebCrypto) against the sha256 the registry recorded at launch, and compares its `description` with
 * the generated text the coin page shows. Nothing is trusted from this server but the expected values, which are public.
 */
export interface PinnedView { metadataUri: string | null; metadataSha256: string | null; imageUri: string | null; imageSha256: string | null; hosted: boolean; expectedDescription: string }

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function PinnedCheck({ pinned }: { pinned: PinnedView | null | undefined }) {
  const [state, setState] = useState<{ ok: boolean; detail: string } | null>(null);
  const run = useCallback(async () => {
    if (!pinned?.metadataUri || !pinned.metadataSha256) return;
    setState(null);
    try {
      const r = await fetch(pinned.metadataUri, { cache: "no-store" });
      const buf = await r.arrayBuffer();
      const sha = await sha256Hex(buf);
      if (sha !== pinned.metadataSha256) { setState({ ok: false, detail: `The pinned file hashes to ${sha.slice(0, 16)}…, but the recorded hash is ${pinned.metadataSha256.slice(0, 16)}…` }); return; }
      const j = JSON.parse(new TextDecoder().decode(buf)) as { description?: string };
      setState(j.description === pinned.expectedDescription ? { ok: true, detail: "It matches the locked description." } : { ok: false, detail: "The pinned description differs from the locked text." });
    } catch (e) { setState({ ok: false, detail: `This page could not fetch it again (${String((e as Error).message).slice(0, 80)}). You can check it with the trust page's verifier.` }); }
  }, [pinned]);
  useEffect(() => { void run(); }, [run]);
  if (!pinned) return null;
  if (pinned.hosted || !pinned.metadataUri) return <p className="text-xs text-amber-300">This coin&apos;s metadata is hosted on this server and is not pinned on Arweave. It is a devnet test coin made by a script.</p>;
  return (
    <p className="text-xs text-neutral-400" aria-label="pinned metadata">
      The metadata is pinned on Arweave at <a className="underline" href={pinned.metadataUri} rel="noopener" target="_blank">{pinned.metadataUri.replace(/^https:\/\//, "")}</a> (sha256 <span className="font-mono">{pinned.metadataSha256?.slice(0, 16)}…</span>).
      {" "}{state === null ? "Checking it now…" : state.ok ? <span className="text-emerald-300">{state.detail} ✓</span> : <span className="text-red-400">{state.detail} ✗</span>}
      {pinned.imageUri && <> The image is <a className="underline" href={pinned.imageUri} rel="noopener" target="_blank">pinned too</a>{pinned.imageSha256 ? <> (sha256 <span className="font-mono">{pinned.imageSha256.slice(0, 12)}…</span>)</> : null}.</>}
    </p>
  );
}
