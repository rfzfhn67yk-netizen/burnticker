"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { CoinCard } from "../_components/CoinCard";
import { FieldHelp } from "../_components/FieldHelp";

/**
 * THE REVIEW CARD (2026-10-10, the owner: "it feels overly complicated to get a coin set up … the UI needs to be simpler, even if it
 * means giving up a little bit of adjustability"). The ONE screen between "what burns it" and the wallet signature, for every path
 * (sentence search, Team coin, Matchup, Coin vs Coin, Any result, Elections, templates):
 *
 *   the generated art · name + ticker (prefilled; tap "edit" to change them inline) · the rule in one sentence · "ends: …, then winds
 *   down" · the receipts line · ONE preset row (recurring 2 / 5 / 10 %, one-shot 10 / 50 / 100 %; a duration chip where it applies),
 *   the default already chosen · an "add a note" link · Launch.
 *
 * Decisions on the happy path: the card the creator picked before this screen, accepting (or editing) the name, Launch — three. Every
 * interactive element here says which it is: data-decision="name" | "launch" (required) or data-optional="preset" | "note" (a default
 * is already chosen). test/burntickerThreeDecisions.test.ts counts them. The web UI offers presets; the API offers dials
 * (docs/burnticker/ui-conventions.md § Presets, not dials). Pressing Launch is the acknowledgement: the line under the button says so.
 */

export interface ReviewCoin { key: string; name: string; ticker: string; onName: (v: string) => void; onTicker: (v: string) => void; image: string; oneLiner: string; oracle: string; badge: string | null }
export interface Chip<T extends string | number> { value: T; label: string }
export interface ReviewCardProps {
  coins: ReviewCoin[];
  /** The rule in one plain sentence. */
  sentence: string;
  /** A registered rivalry pair: the winner-takes-the-burn line (describe.ts PAIR_REVIEW_LINE) under the sentence; null otherwise. */
  pairLine?: string | null;
  /** "Ends Sep 30, 2027, then winds down" — null when the rule has no end. */
  ends: string | null;
  shares: { options: number[]; value: number; onChange: (v: number) => void };
  durations?: { options: Chip<string>[]; value: string; onChange: (v: string) => void } | null;
  note?: { value: string; onChange: (v: string) => void; problem: string | null } | null;
  problems: string[];
  error: string | null;
  busy: boolean;
  /** Names, tickers and the rule are valid (the button stays enabled without a wallet: pressing it opens the wallet chooser). */
  ready: boolean;
  creator: string | null;
  onLaunch: () => void;
}

const pctLabel = (f: number) => `${Math.round(f * 1000) / 10}%`;
export const RECEIPTS_LINE = "Every burn posts a public receipt: the reading it settled on, the amount and the transaction, on the coin's page.";
/** LP locked forever (owner decision 2026-10-10), on the receipts line. */
export const LP_LINE = "LP locked forever; its fees fund the burn (80% burned, 20% operator, fixed in code).";
export const ACK_LINE = "Launching confirms the rule is locked for good — no one can change it, including you — and that you make no promises to anyone about this coin.";
const okTicker = (t: string) => /^[A-Z0-9]{2,10}$/.test(t);

export function ReviewCard(p: ReviewCardProps) {
  const [editing, setEditing] = useState(false), [noteOpen, setNoteOpen] = useState(!!p.note?.value);
  const modal = useWalletModal();
  // Launch without a wallet opens the chooser and launches once the wallet connects (one press, not two)
  const pending = useRef(false);
  useEffect(() => { if (pending.current && p.creator) { pending.current = false; p.onLaunch(); } }, [p.creator]); // eslint-disable-line react-hooks/exhaustive-deps
  const launch = () => { if (!p.ready || p.busy) return; if (!p.creator) { pending.current = true; modal.setVisible(true); return; } p.onLaunch(); };
  const chip = (on: boolean) => `rounded-full border px-3 py-1 text-sm ${on ? "border-amber-400 bg-amber-400 text-neutral-950" : "border-neutral-700 hover:border-neutral-500"}`;
  return (
    <section className="rounded-xl border border-amber-400/60 bg-neutral-900 p-4 space-y-3 text-sm" aria-label="Review" data-review-card>
      <div className={`grid gap-3 ${p.coins.length > 1 ? "md:grid-cols-2" : ""}`}>
        {p.coins.map((c) => (
          <div key={c.key} className="space-y-2">
            <div className="bt-preview-frame"><CoinCard href={null} prelaunch c={{ ticker: c.ticker, name: c.name, imageUrl: c.image || null, oneLiner: c.oneLiner, oracle: c.oracle, status: "draft", phase: null, progressPct: null, raised: null, threshold: null, quote: "SOL", burns: 0, lastBurnAt: null, nextAt: null, launchedAt: null, badge: c.badge }} /></div>
            {editing ? (
              <div className="grid grid-cols-[1fr_9rem] gap-2">
                <label className="block text-xs text-neutral-400">Name<FieldHelp id="name" /><input data-help="name" data-decision="name" className="mt-1 w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm" maxLength={32} value={c.name} onChange={(e) => c.onName(e.target.value)} /></label>
                <label className="block text-xs text-neutral-400">Ticker<FieldHelp id="ticker" /><input data-help="ticker" data-decision="name" className="mt-1 w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1 font-mono text-sm uppercase" maxLength={10} value={c.ticker} onChange={(e) => c.onTicker(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} /></label>
                {!okTicker(c.ticker) && <span className="col-span-2 text-xs text-red-400">a ticker is 2–10 letters or digits</span>}
              </div>
            ) : null}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-400">
        <button type="button" data-decision="name" className="underline" onClick={() => setEditing(!editing)}>{editing ? "done" : p.coins.length > 1 ? "edit the names and tickers" : "edit the name or ticker"}</button>
      </div>
      <p className="text-base text-neutral-100" data-summary>{p.sentence}</p>
      {p.pairLine && <p className="text-sm text-amber-200" data-pair-line>{p.pairLine} <FieldHelp id="pair-burn" /></p>}
      {p.ends && <p className="text-xs text-neutral-300">Ends: {p.ends}</p>}
      <p className="text-xs text-neutral-400">{RECEIPTS_LINE} {LP_LINE}</p>
      <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="How much burns">
        {p.shares.options.map((f) => <button key={f} type="button" role="radio" aria-checked={p.shares.value === f} data-optional="preset" className={chip(p.shares.value === f)} onClick={() => p.shares.onChange(f)}>{pctLabel(f)}</button>)}
        {p.durations && p.durations.options.length > 1 && <span className="mx-1 text-neutral-600" aria-hidden="true">·</span>}
        {p.durations && p.durations.options.length > 1 && p.durations.options.map((d) => <button key={d.value} type="button" role="radio" aria-checked={p.durations!.value === d.value} data-optional="preset" className={chip(p.durations!.value === d.value)} onClick={() => p.durations!.onChange(d.value)}>{d.label}</button>)}
      </div>
      {p.note && (noteOpen ? (
        <label className="block text-xs text-neutral-400">A note from you, shown in its own box (optional, 140 characters, no links)<FieldHelp id="note" /><textarea data-help="note" data-optional="note" className="mt-1 w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm" rows={2} maxLength={140} value={p.note.value} onChange={(e) => p.note!.onChange(e.target.value)} />{p.note.problem && <span className="text-red-400">{p.note.problem}</span>}</label>
      ) : <button type="button" data-optional="note" className="text-xs underline text-neutral-400" onClick={() => setNoteOpen(true)}>add a note</button>)}
      {p.problems.length > 0 && <p className="text-red-400">Can&apos;t launch this rule: {p.problems.join("; ")}</p>}
      {p.error && <p className="text-red-400">{p.error}</p>}
      <div className="space-y-1 pt-1">
        <button type="button" data-decision="launch" className="rounded bg-amber-400 px-5 py-2 text-base font-semibold text-neutral-950 disabled:opacity-40" disabled={!p.ready || p.busy || p.problems.length > 0} onClick={launch}>{p.busy ? "Building…" : p.creator ? (p.coins.length > 1 ? "Launch both" : "Launch") : "Connect a wallet and launch"}</button>
        <p className="text-[11px] text-neutral-500">{ACK_LINE} <Link className="underline" href="/burnticker/docs">More options: the API</Link></p>
      </div>
    </section>
  );
}
