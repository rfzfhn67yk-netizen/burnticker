"use client";
import Link from "next/link";
import { EVENT_LABEL } from "@/lib/burnticker/activity";
import { useHome } from "./useHome";
import { useScrollEdges } from "./useScrollEdges";

/**
 * THE ACTIVITY LINE under the header (the owner's review item 4, brief rule 3; website-14 platform item 6): real rows only, from GET
 * /api/burnticker/home (src/lib/burnticker/home.ts, activity.ts): confirmed burns, readings signed on chain, graduations and pool
 * registrations, each labelled with its kind and linking its own evidence. Devnet rows carry a "devnet" mark. With no rows it prints one
 * line saying so; while it loads it shows a grey bar, not text. When the strip is wider than the screen it scrolls sideways, and the edge
 * that still has more fades (the owner's phone check, LAUNCHPAD-PATH §72; at every width since ChatGPT audit 6 item 24: useScrollEdges). No absolutely positioned hint sits inside the strip: its containing block
 * would be the header, and the page would grow as wide as the strip.
 */
export function ActivityTicker() {
  const { data, error } = useHome();
  const hint = useScrollEdges<HTMLDivElement>([data]);
  return (
    <div ref={hint.ref} onScroll={hint.onScroll} className={`bt-ticker ${hint.className}`} aria-label={hint.more ? "Latest activity on chain. Scroll sideways for more." : "Latest activity on chain"} data-activity tabIndex={0}>
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
