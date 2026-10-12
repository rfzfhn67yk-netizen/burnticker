"use client";
import { useEffect, useRef } from "react";
import Link from "next/link";
import { LAUNCH_CLOSED } from "@/lib/burnticker/siteNav.mjs";
import { EXPLORE_VERIFIED_BURN } from "@/lib/burnticker/currentStatusLinks";

/**
 * WHAT "LAUNCH A COIN" OPENS WHILE CREATOR LAUNCHES ARE CLOSED (brief rule 1, 2026-10-12): launches are closed until the first coin has
 * receipts, with a way to the coins and to a real receipt. No date, no countdown, no waitlist and no email field. A native <dialog>:
 * Escape and the Close button shut it, and focus returns to the button that opened it.
 */
export function LaunchClosedModal({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current, opener = document.activeElement as HTMLElement | null;
    if (d && !d.open) { if (typeof d.showModal === "function") d.showModal(); else d.setAttribute("open", ""); }
    return () => { opener?.focus?.(); };
  }, []);
  return (
    <dialog ref={ref} className="bt-modal" aria-labelledby="bt-launch-closed-h" onClose={onClose} onCancel={onClose} data-launch-closed>
      <h2 id="bt-launch-closed-h">{LAUNCH_CLOSED.title}</h2>
      <p>{LAUNCH_CLOSED.body}</p>
      <p className="bt-modal-row">
        <Link className="bt-launch-btn" href="/burnticker" onClick={onClose}>{LAUNCH_CLOSED.coins}</Link>
        <Link className="bt-ghost-btn" href={EXPLORE_VERIFIED_BURN.href} onClick={onClose}>{EXPLORE_VERIFIED_BURN.label}</Link>
        <button type="button" className="bt-ghost-btn" onClick={() => { ref.current?.close(); }}>{LAUNCH_CLOSED.close}</button>
      </p>
    </dialog>
  );
}
