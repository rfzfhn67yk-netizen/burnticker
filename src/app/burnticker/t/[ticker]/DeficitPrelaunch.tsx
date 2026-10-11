"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { DeficitPrelaunch as Data } from "@/lib/burnticker/deficitPrelaunch";
import { EmptyState } from "../../_components/EmptyState";
import { BurnMath } from "../../_components/BurnMath";

/**
 * /burnticker/t/DEFICIT BEFORE THE COIN IS REGISTERED ON THIS HOST (website brief 2026-10-11 §1). A useful page instead of "no token":
 * what $DEFICIT is, the rule in one sentence, the 2 % / $1B dial, the launch date when one is set, the whitepaper, the real devnet
 * rehearsal receipt with a verify action, and the served $DEFICIT site as the canonical page (rel=canonical + the visible link).
 * Data: GET /api/burnticker/deficit-prelaunch (deficitPrelaunch.ts — the locked rules file and config/burnticker/current-status.json).
 */
export function DeficitPrelaunch({ fallbackSite }: { fallbackSite: string }) {
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { fetch("/api/burnticker/deficit-prelaunch").then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`); setD(j); }).catch((e) => setErr(String((e as Error).message ?? e))); }, []);
  const card = "rounded-lg border border-neutral-800 bg-neutral-900 p-3";
  return (
    <main className="mx-auto max-w-3xl px-4 py-6 space-y-4 text-sm" data-not-registered data-deficit-prelaunch>
      <link rel="canonical" href={d?.canonical ?? fallbackSite} />
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">$DEFICIT</h1>
        <p className="text-neutral-300">The first Burnticker coin: it burns when the U.S. national debt rises. It is not launched on this network yet, so this host has no rule account, reading or receipt for it.</p>
        <p className="text-xs text-neutral-400">The $DEFICIT page itself is <a className="underline" href={d?.servedAt ?? fallbackSite}>{(d?.servedAt ?? fallbackSite).replace(/^https:\/\//, "").replace(/\/$/, "")}</a>.</p>
      </header>
      {!d && !err && <EmptyState kind="loading" body="Reading the $DEFICIT rule file." />}
      {err && <EmptyState kind="unavailable" body="The $DEFICIT rule could not be read on this host just now." details={err}><p className="mt-2"><a className="underline" href={fallbackSite}>Open the $DEFICIT page</a></p></EmptyState>}
      {d && <>
        <section className={card} aria-label="The rule">
          <h2 className="font-medium">The rule, in one sentence</h2>
          <p className="mt-1 text-neutral-100">{d.oneSentence}</p>
          <dl className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            <div><dt className="text-neutral-500">unit</dt><dd className="font-mono">{d.dial.unitLabel} of debt</dd></div>
            <div><dt className="text-neutral-500">per unit</dt><dd className="font-mono">{d.dial.percent} of the burn pool</dd></div>
            <div><dt className="text-neutral-500">launch date</dt><dd>{d.launch.date ?? "not announced"}</dd></div>
            <div><dt className="text-neutral-500">network</dt><dd>not launched on mainnet</dd></div>
          </dl>
          <p className="mt-2 text-xs text-neutral-400">{d.launch.note} Holders&apos; balances are never touched: burns destroy only tokens the program bought with the burn pool.</p>
          <details className="mt-2 text-xs"><summary className="cursor-pointer text-neutral-300">The locked rule text</summary><p className="mt-1 text-neutral-300">{d.statement}</p><p className="mt-1 break-all text-neutral-500">sha256 {d.rulesSha256} · {d.rulesFile}</p></details>
        </section>
        <section className={card} aria-label="The devnet rehearsal">
          <h2 className="font-medium">A real burn from the devnet rehearsal</h2>
          <p className="mt-1 text-neutral-300">{d.rehearsal.demo.summary}</p>
          <p className="mt-2"><Link className="inline-block rounded bg-amber-400 px-3 py-1.5 font-semibold text-neutral-950" href={d.rehearsal.demo.checkHref}>Verify this receipt in your browser</Link> <a className="ml-2 text-xs underline" href={d.rehearsal.demo.explorerUrl}>transaction on the devnet explorer</a></p>
          <p className="mt-2 text-xs text-neutral-500">{d.rehearsal.note} Devnet is a rehearsal network; nothing there has money value.</p>
        </section>
        <BurnMath />
        <p className="text-xs"><a className="underline" href={d.whitepaper}>Whitepaper</a> · <a className="underline" href={d.servedAt}>The $DEFICIT page</a> · <Link className="underline" href="/burnticker/trust">Current status</Link> · <Link className="underline" href="/burnticker">All coins on this host</Link></p>
      </>}
    </main>
  );
}
