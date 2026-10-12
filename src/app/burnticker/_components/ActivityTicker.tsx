"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { EVENT_LABEL } from "@/lib/burnticker/activity";
import { useHome } from "./useHome";

/**
 * THE ACTIVITY LINE under the header (the owner's review item 4, brief rule 3; website-14 platform item 6): real rows only, from GET
 * /api/burnticker/home (src/lib/burnticker/home.ts, activity.ts): confirmed burns, readings signed on chain, graduations and pool
 * registrations, each labelled with its kind and linking its own evidence. Devnet rows carry a "devnet" mark. With no rows it prints one
 * line saying so; while it loads it shows a grey bar, not text. On phones the strip scrolls sideways, so its right edge fades until the
 * end is reached (the owner's phone check, LAUNCHPAD-PATH §72). No absolutely positioned hint sits inside the strip: its containing block
 * would be the header, and the page would grow as wide as the strip.
 */
export function ActivityTicker() {
  const { data, error } = useHome();
  const box = useRef<HTMLDivElement>(null);
  const [atEnd, setAtEnd] = useState(true);
  const measure = useCallback(() => { const b = box.current; if (b) setAtEnd(b.scrollLeft + b.clientWidth >= b.scrollWidth - 4); }, []);
  useEffect(() => { measure(); window.addEventListener("resize", measure); return () => window.removeEventListener("resize", measure); }, [measure, data]);
  return (
    <div ref={box} onScroll={measure} className={`bt-ticker${atEnd ? " is-end" : ""}`} aria-label={atEnd ? "Latest activity on chain" : "Latest activity on chain. Scroll sideways for more."} data-activity tabIndex={0}>
      {!data && !error && <><span className="bt-ticker-skel" aria-hidden="true" /><span className="sr-only">Loading the latest activity.</span></>}
      {error && <span>The latest activity could not be read just now.</span>}
      {data && data.events.length === 0 && <span>{data.noEvents}</span>}
      {data && data.events.map((ev) => (
        <Link key={`${ev.kind}-${ev.network}-${ev.at}-${ev.text}`} href={ev.href} className="bt-ticker-item" data-kind={ev.kind}>
          <span className="bt-ticker-kind">{EVENT_LABEL[ev.kind] ?? ev.kind}</span>{ev.network !== "mainnet" && <span className="bt-ticker-net">{ev.network}</span>}{ev.text}
        </Link>
      ))}
    </div>
  );
}
