import type { Metadata } from "next";
import Link from "next/link";
import { platform } from "@/lib/burnticker/server";
import { clonesFor } from "@/lib/burnticker/ops/cloneServe";
import type { ClonesJson } from "@/lib/burnticker/ops/cloneWatch";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Not Burnticker", description: "Tokens named like a Burnticker coin that are not Burnticker coins, with what the chain and the pool index showed. Check any mint yourself.", alternates: { canonical: "/burnticker/not-burnticker" } };

/**
 * NOT BURNTICKER (growth batch 2026-10-10; src/lib/burnticker/ops/cloneWatch.ts): the clone watch's public list. Evidence only — the
 * mint, the pool, whether the burn_receipts program knows the mint, the holder-stack signal, the LP state — in plain lines. No person is
 * named and no intent is claimed. The verifier at /burnticker/verify answers for any mint.
 */
export default function NotBurntickerPage() {
  let d: ClonesJson | null = null, err: string | null = null;
  try { d = clonesFor(platform()); } catch (e) { err = e instanceof Error ? e.message : String(e); }
  const short = (a: string) => (a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-6)}` : a);
  return (
    <main className="mx-auto max-w-5xl px-4 py-6 space-y-6 text-sm">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Not Burnticker</h1>
        <p className="text-neutral-400 max-w-3xl">These are tokens on Solana whose name or ticker looks like a Burnticker coin, or like Burnticker itself, and that are <b>not</b> Burnticker coins. A real Burnticker coin is registered with the burn program and has its own coin page on this site. You can check any token on <Link className="underline" href="/burnticker/verify">Verify a mint</Link>.</p>
        <p className="text-xs text-neutral-500 max-w-3xl">{d?.note ?? "This list shows evidence only."} {d ? `The scan searches for ${d.terms.map((t) => (t === "BURNTICKER" ? "Burnticker" : `$${t}`)).join(", ")}.` : ""} {d?.lastScan ? `The last scan ran at ${d.lastScan.at.slice(0, 16).replace("T", " ")} UTC and found ${d.lastScan.hits} ${d.lastScan.hits === 1 ? "match" : "matches"}${d.lastScan.errors.length ? `, with ${d.lastScan.errors.length} search ${d.lastScan.errors.length === 1 ? "error" : "errors"}` : ""}.` : "No scan has run on this site yet."}</p>
      </header>
      {err && <p className="text-red-400 text-xs">The coin registry could not be read just now. The error was: {err}</p>}
      {d && d.clones.length === 0 && <p className="text-neutral-400 border border-neutral-800 rounded p-4">No lookalike tokens have been recorded.</p>}
      {d && d.clones.length > 0 && (
        <ul className="space-y-2">{d.clones.map((c) => (
          <li key={c.mint} className="rounded-lg border border-neutral-800 bg-neutral-900 p-3 space-y-1">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span><span className="font-mono">${c.symbol || "?"}</span> <span className="text-neutral-400">{c.name}</span></span>
              <span className="text-xs text-neutral-500">first seen {c.firstSeenAt.slice(0, 16).replace("T", " ")} UTC</span>
            </div>
            <div className="font-mono text-xs text-neutral-400 break-all">Mint {c.mint}{c.pool ? `, pool ${short(c.pool)}${c.dex ? ` (${c.dex})` : ""}` : ""}</div>
            <ul className="list-disc pl-5 text-xs text-neutral-300">{c.evidence.map((e) => <li key={e}>{e}</li>)}</ul>
            <div className="text-xs"><Link className="underline" href={`/burnticker/verify?mint=${encodeURIComponent(c.mint)}`}>verify this mint →</Link>{c.url && <> · <a className="underline" href={c.url} rel="noopener nofollow" target="_blank">pool on DexScreener</a></>}</div>
          </li>
        ))}</ul>
      )}
      <p className="text-xs text-neutral-500">The same list is available as JSON at <a className="underline" href="/api/burnticker/v1/clones">/api/burnticker/v1/clones</a>.</p>
    </main>
  );
}
