"use client";

import { useEffect, useId, useRef, useState } from "react";
import { helpFor } from "@/lib/burnticker/fieldHelp";

/**
 * FIELD HELP (ui-conventions.md pattern #27): a small "?" after a label. It opens on hover and on keyboard focus, toggles on tap (phones),
 * closes on Escape, on blur and on a tap outside, and is announced through aria-describedby. Two lines from fieldHelp.ts: what to
 * enter, and what it does to the rule or the coin. Inside a <label> the click is stopped so the "?" never toggles the field.
 */
export function FieldHelp({ id }: { id: string }) {
  const h = helpFor(id);
  const uid = useId(), tipId = `help-${id}-${uid.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const [open, setOpen] = useState(false), [pinned, setPinned] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => { if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setPinned(false); } };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); setPinned(false); } };
    document.addEventListener("pointerdown", away); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  if (!h) return null;
  return (
    <span ref={ref} className="bt-help relative ml-1 inline-block align-middle" data-help-for={id}>
      <button type="button" aria-label="What to enter here" aria-describedby={tipId} aria-expanded={open}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-neutral-600 font-mono text-[10px] leading-none text-neutral-300 hover:border-amber-400 hover:text-amber-300 focus:border-amber-400 focus:outline-none"
        onMouseEnter={() => setOpen(true)} onMouseLeave={() => { if (!pinned) setOpen(false); }}
        onFocus={() => setOpen(true)} onBlur={() => { if (!pinned) setOpen(false); }}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setPinned(!pinned || !open); setOpen(!(pinned && open)); }}>?</button>
      <span id={tipId} role="tooltip" hidden={!open}
        className="absolute left-0 top-5 z-50 w-64 max-w-[80vw] rounded-md border border-neutral-700 bg-neutral-950 p-2 text-left text-xs font-normal normal-case tracking-normal text-neutral-200 shadow-lg">
        <span className="block"><b className="text-amber-300">Enter:</b> {h.what}</span>
        <span className="mt-1 block"><b className="text-amber-300">Does:</b> {h.does}</span>
      </span>
    </span>
  );
}
