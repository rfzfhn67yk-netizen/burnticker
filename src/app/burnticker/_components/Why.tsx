"use client";

import { useId, useState } from "react";

/**
 * A VALUE THAT WAS NOT READ, WITH ITS REASON ON TAP OR FOCUS (website-15 item 7; Claude site audit 3 items 4b and 4c, ChatGPT repair 3).
 * The dash is a button: tapping, clicking or focusing it shows the reason under it, and the reason is the button's description
 * (aria-describedby), so a screen reader reads it with the dash. It works the same on phones, where nothing hovers. The reason is never
 * printed inline after the value, so no stray "." appears in the row. Unknown is never shown as zero.
 */
export function Why({ why, label = "—", name = "Not available" }: { why: string | null; label?: string; name?: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  if (!why) return <span>{label}</span>;
  return (
    <span className="bt-why" data-why>
      <button type="button" className="bt-why-btn" aria-describedby={id} aria-expanded={open} aria-label={label === "—" || label === "" ? name : undefined}
        onClick={() => setOpen((o) => !o)} onBlur={() => setOpen(false)} onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}>
        {label && <span aria-hidden={label === "—" ? true : undefined}>{label}</span>}<span className="bt-why-mark" aria-hidden="true">?</span>
      </button>
      <span id={id} role="tooltip" className={`bt-why-tip${open ? " is-open" : ""}`}>{why}</span>
    </span>
  );
}
