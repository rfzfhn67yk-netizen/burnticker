"use client";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * A SCROLL HINT FOR A SIDEWAYS ROW (ChatGPT audit 6 item 24): the Coins filters and the activity line scroll sideways when they do not
 * fit, and nothing said so. This measures whether there is more to see on the left or the right; the row adds the class this returns
 * (globals.css .bt-scroll-hint fades the edge that still has more). It re-measures on scroll, on resize and when `deps` change.
 */
export function useScrollEdges<T extends HTMLElement>(deps: readonly unknown[] = []) {
  const ref = useRef<T>(null);
  const [edges, setEdges] = useState({ start: false, end: false });
  const measure = useCallback(() => {
    const b = ref.current;
    if (!b) return;
    const start = b.scrollLeft > 4, end = b.scrollLeft + b.clientWidth < b.scrollWidth - 4;
    setEdges((e) => (e.start === start && e.end === end ? e : { start, end }));
  }, []);
  useEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the caller's data changes the row's width
  }, [measure, ...deps]);
  const className = `bt-scroll-hint${edges.start ? " more-start" : ""}${edges.end ? " more-end" : ""}`;
  return { ref, onScroll: measure, className, more: edges.start || edges.end };
}
