"use client";
import Link from "next/link";
import { useHome } from "./useHome";

/**
 * THE ACTIVITY LINE under the header (the owner's review item 4, brief rule 3): confirmed burns only, newest first, from GET
 * /api/burnticker/home (src/lib/burnticker/home.ts). Devnet rehearsal burns carry a "devnet" mark. Never a sample or placeholder row:
 * with no events it prints one line saying so, and while it loads it shows a grey bar, not text.
 */
export function ActivityTicker() {
  const { data, error } = useHome();
  return (
    <div className="bt-ticker" aria-label="Latest burns" data-activity>
      {!data && !error && <><span className="bt-ticker-skel" aria-hidden="true" /><span className="sr-only">Loading the latest burns.</span></>}
      {error && <span>The latest burns could not be read just now.</span>}
      {data && data.events.length === 0 && <span>{data.noEvents}</span>}
      {data && data.events.map((ev) => (
        <Link key={`${ev.network}-${ev.at}-${ev.text}`} href={ev.href} className="bt-ticker-item">
          {ev.network !== "mainnet" && <span className="bt-ticker-net">{ev.network}</span>}{ev.text}
        </Link>
      ))}
    </div>
  );
}
