"use client";

import { useState } from "react";

/** A copy button for a command or an address: says "Copied" for a moment after a successful copy, and names what it copies. */
export function CopyButton({ text, label = "Copy", copied = "Copied", what }: { text: string; label?: string; copied?: string; what: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="bt-copy" aria-label={`${label} ${what}`} onClick={() => { navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); }).catch(() => setDone(false)); }}>
      <span aria-live="polite">{done ? copied : label}</span>
    </button>
  );
}
