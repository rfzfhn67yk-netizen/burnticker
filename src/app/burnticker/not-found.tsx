import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Page not found", robots: { index: false } };

/**
 * THE BURNTICKER 404 (site audit #11, 2026-10-11): the site's own header and footer stay around it (the root layout), and it offers the
 * pages a visitor most likely wanted. Used for notFound() under /burnticker and, through the public tree's root not-found
 * (config/public-repo/overlay/src/app/not-found.tsx), for every unmatched URL the app serves.
 */
export default function NotFound() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12 space-y-4" data-not-found>
      <p className="font-mono text-xs uppercase tracking-widest text-neutral-500">Error 404</p>
      <h1 className="text-2xl font-semibold">We could not find that page.</h1>
      <p className="text-neutral-300">The link may be old, or the address may have a typo. These pages are a good place to start.</p>
      <ul className="grid gap-2 sm:grid-cols-2 text-sm">
        <li><Link className="underline" href="/burnticker">Coins</Link> <span className="block text-neutral-500">See every coin on this site and its receipts.</span></li>
        <li><Link className="underline" href="/burnticker/leagues">Seasons</Link> <span className="block text-neutral-500">Browse the leagues and their scoreboards.</span></li>
        <li><Link className="underline" href="/burnticker/launch">Launch</Link> <span className="block text-neutral-500">Read how a coin is launched.</span></li>
        <li><Link className="underline" href="/burnticker/trust">Trust</Link> <span className="block text-neutral-500">Check the current status and every wallet.</span></li>
        <li><a className="underline" href="/">The home page</a></li>
      </ul>
    </main>
  );
}
