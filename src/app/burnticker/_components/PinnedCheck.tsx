"use client";

import { useCallback, useEffect, useState } from "react";
import { PIN_HOST_ONLY_LINE, PIN_REREAD_OK_LINE, pinnedFileHref } from "@/lib/burnticker/pinCheckClient";
import { IMAGE_MIRROR_MISMATCH_LINE, IMAGE_MIRROR_NONE_LINE, IMAGE_MIRROR_OK_LINE, IMAGE_MIRROR_UNREAD_LINE, IMAGE_OUTSIDE_LINK_LINE, imagePinState } from "@/lib/burnticker/imagePin";
import { IMAGE_MIRROR_RE } from "@/lib/burnticker/imageChain";

/**
 * "Metadata pinned on Arweave · sha256 … · matches the locked description ✓" (pin.ts). The browser reads the pinned JSON again
 * through this site (the pin-check route's ?raw=1 copy since A-28, pinCheckClient.ts), hashes the bytes (WebCrypto) against the
 * sha256 the registry recorded at launch, and compares its `description` with the generated text the coin page shows. The hashing
 * is the browser's own, but the bytes come through this server, so it is not an independent read of Arweave: the gateway link is
 * there for anyone who wants one.
 */
export interface PinnedView { /** the coin's mint, for the host-side check (pin-check route); optional for older callers */ mint?: string; metadataUri: string | null; metadataSha256: string | null; imageUri: string | null; imageSha256: string | null; /** 2026-10-27: this site's copy of the uploaded image (imageStore.ts), when it has one */ imageMirror?: string | null; hosted: boolean; expectedDescription: string }

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function PinnedCheck({ pinned }: { pinned: PinnedView | null | undefined }) {
  const [state, setState] = useState<{ ok: boolean; detail: string } | null>(null);
  // 2026-10-27: the site's copy of a pinned image, read here and hashed in the browser against the hash recorded at launch (imagePin.ts
  // IMAGE_MIRROR_* lines). The Arweave copy stays the permanent record; this says only whether the mirror on this site matches it.
  const [mirror, setMirror] = useState<{ ok: boolean | null; line: string } | null>(null);
  useEffect(() => {
    if (!pinned || imagePinState(pinned) !== "pinned") { setMirror(null); return; }
    if (!pinned.imageMirror || !IMAGE_MIRROR_RE.test(pinned.imageMirror)) { setMirror({ ok: null, line: IMAGE_MIRROR_NONE_LINE }); return; }
    const href = pinned.imageMirror, want = pinned.imageSha256!.toLowerCase();
    let gone = false;
    (async () => {
      try {
        const r = await fetch(href, { cache: "no-store" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const sha = await sha256Hex(await r.arrayBuffer());
        if (!gone) setMirror(sha === want ? { ok: true, line: IMAGE_MIRROR_OK_LINE } : { ok: false, line: IMAGE_MIRROR_MISMATCH_LINE });
      } catch { if (!gone) setMirror({ ok: null, line: IMAGE_MIRROR_UNREAD_LINE }); }
    })();
    return () => { gone = true; };
  }, [pinned]);
  const run = useCallback(async () => {
    if (!pinned?.metadataUri || !pinned.metadataSha256) return;
    setState(null);
    // 2026-10-14: this host checks the pin first (api/burnticker/pin-check: it follows the gateway's redirect to its CDN and hashes the
    // bytes); the browser then reads the file again through this site and hashes it itself, and a read that does not answer is not a failed pin
    let hostSaysOk = false;
    try {
      const mint = (pinned as { mint?: string }).mint;
      if (mint) { const h = await (await fetch(`/api/burnticker/pin-check?mint=${encodeURIComponent(mint)}`, { cache: "no-store" })).json() as { ok: boolean | null; detail: string }; if (h.ok === true) hostSaysOk = true; else if (h.ok === false) { setState({ ok: false, detail: `This site checked the pin and found a problem: ${h.detail}` }); return; } }
    } catch { hostSaysOk = false; }
    try {
      // prelaunch audit 2026-10-18 A-28: the browser's own fetch to the gateway failed on every page (its TLS handshake), so the second
      // check never ran. The browser now reads the pinned bytes through this site (pinnedFileHref) and hashes them itself against the
      // hash recorded at launch; the gateway address stays as a link for anyone who wants to read it there.
      const r = await fetch(pinnedFileHref(pinned), { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const buf = await r.arrayBuffer();
      const sha = await sha256Hex(buf);
      if (sha !== pinned.metadataSha256) { setState({ ok: false, detail: `The pinned file hashes to ${sha.slice(0, 16)}…, but the recorded hash is ${pinned.metadataSha256.slice(0, 16)}…` }); return; }
      const j = JSON.parse(new TextDecoder().decode(buf)) as { description?: string };
      setState(j.description === pinned.expectedDescription ? { ok: true, detail: PIN_REREAD_OK_LINE } : { ok: false, detail: "The pinned description differs from the locked text." });
    } catch (e) {
      if (hostSaysOk) setState({ ok: true, detail: PIN_HOST_ONLY_LINE });
      else setState({ ok: false, detail: `This page could not fetch it again (${String((e as Error).message).slice(0, 80)}). You can check it with the trust page's verifier.` });
    }
  }, [pinned]);
  useEffect(() => { void run(); }, [run]);
  if (!pinned) return null;
  if (pinned.hosted || !pinned.metadataUri) return <p className="text-xs text-amber-300">This coin&apos;s metadata is hosted on this server and is not pinned on Arweave. That is how every coin on the devnet copy is kept.</p>;
  return (
    <p className="text-xs text-neutral-400" aria-label="pinned metadata">
      The metadata is pinned on Arweave: {(pinned as { mint?: string }).mint ? <><a className="underline" href={`/api/burnticker/pin-check?mint=${encodeURIComponent((pinned as { mint?: string }).mint!)}&raw=1`} rel="noopener" target="_blank">open the pinned file through this site</a> (<a className="underline" href={pinned.metadataUri} rel="noopener" target="_blank">or at {pinned.metadataUri.replace(/^https:\/\//, "").slice(0, 28)}…</a>)</> : <a className="underline" href={pinned.metadataUri} rel="noopener" target="_blank">{pinned.metadataUri.replace(/^https:\/\//, "")}</a>} (sha256 <span className="font-mono">{pinned.metadataSha256?.slice(0, 16)}…</span>).
      {" "}{state === null ? "Checking it now…" : state.ok ? <span className="text-emerald-300">{state.detail} ✓</span> : <span className="text-red-400">{state.detail} ✗</span>}
      {/* audit 7 F07: "pinned" only with the recorded hash of uploaded bytes; an outside image address is said to be one */}
      {imagePinState(pinned) === "pinned" && <> The image is <a className="underline" href={pinned.imageUri!} rel="noopener" target="_blank">pinned too</a> (sha256 <span className="font-mono">{pinned.imageSha256!.slice(0, 12)}…</span>).{mirror && <> <span className={mirror.ok === true ? "text-emerald-300" : mirror.ok === false ? "text-red-400" : "text-neutral-400"} data-image-mirror={mirror.ok === true ? "ok" : mirror.ok === false ? "mismatch" : "none"}>{mirror.line}{mirror.ok === true ? " ✓" : mirror.ok === false ? " ✗" : ""}</span></>}</>}
      {imagePinState(pinned) === "outside" && <> <span className="text-amber-300" data-image-outside>{IMAGE_OUTSIDE_LINK_LINE}</span> <a className="underline" href={pinned.imageUri!} rel="noopener noreferrer nofollow ugc" target="_blank">Open the image link</a>.</>}
    </p>
  );
}
