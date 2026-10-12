"use client";

import type { ReactNode } from "react";
import { FOLLOW_CHOICES, GUIDED_STEPS, progressLabel, type EndOption, type FollowId, type PatternId, type PatternOption } from "@/lib/burnticker/guidedLaunch";
import { pctLabel } from "@/lib/burnticker/launchPresets";

/**
 * THE GUIDED LAUNCH'S SCREENS (website-19; guidedLaunch.ts holds every word and every rule). One question per screen with the progress
 * line ("2 of 4"), Back and Start over always on top, and the sentence the coin is going to carry updating as the creator picks.
 * Presentational: the launch page owns the state and the rules.
 */

export type GuidedPhase = "follow" | "which" | "burn" | "end" | "review";

/** The progress line and the two controls every step has: Back and Start over. */
export function GuidedTop({ phase, onBack, onStartOver, confirm }: { phase: GuidedPhase; onBack: (() => void) | null; onStartOver: () => void; confirm: ReactNode }) {
  const i = GUIDED_STEPS.findIndex((s) => s.id === phase);
  return (
    <div className="space-y-1" aria-label="Progress" data-guided-top>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-400">
        <span data-guided-progress>{i >= 0 ? <>{progressLabel(i)}: <span className="text-neutral-200">{GUIDED_STEPS[i].question}</span></> : <span className="text-neutral-200">Review</span>}</span>
        <span className="flex items-center gap-3">
          {onBack && <button type="button" data-nav className="underline" onClick={onBack}>← Back</button>}
          <button type="button" data-nav className="underline" onClick={onStartOver} data-start-over>Start over</button>
        </span>
      </div>
      <div className="h-1.5 rounded bg-neutral-800"><div className="h-1.5 rounded bg-amber-400" style={{ width: `${(Math.max(0, i < 0 ? GUIDED_STEPS.length : i) + 1) / (GUIDED_STEPS.length + 1) * 100}%` }} /></div>
      {confirm}
    </div>
  );
}

/** Question 1: what the coin follows. */
export function FollowStep({ onPick, blocked }: { onPick: (f: FollowId) => void; blocked: (f: FollowId) => string | null }) {
  return (
    <section className="space-y-3" aria-label={GUIDED_STEPS[0].question} data-guided-step="follow">
      <h2 className="text-xl font-semibold">{GUIDED_STEPS[0].question}</h2>
      <div className="grid gap-2 sm:grid-cols-2">
        {FOLLOW_CHOICES.map((c) => { const why = blocked(c.id); return (
          <div key={c.id} className={`rounded-xl border border-neutral-800 bg-neutral-900 ${why ? "opacity-60" : ""}`} data-follow={c.id}>
            <button type="button" data-decision="what" disabled={!!why} onClick={() => onPick(c.id)} className="w-full rounded-xl p-3 text-left hover:border-amber-400 focus:outline focus:outline-amber-400 disabled:cursor-not-allowed sm:p-4">
              <span className="block text-base font-semibold">{c.label}</span>
              <span className="mt-0.5 block text-sm text-neutral-300">{c.sentence}</span>
              <span className="mt-1 block text-xs text-neutral-500">{c.example}</span>
            </button>
            {why && <p className="px-3 pb-3 text-xs text-amber-300">{why}</p>}
          </div>
        ); })}
      </div>
    </section>
  );
}

/** Question 2 for a rivalry pair: two teams, or two candidates. */
export function RivalryKindStep({ onPick, teamsBlocked }: { onPick: (k: "teams" | "candidates") => void; teamsBlocked: string | null }) {
  const opt = (k: "teams" | "candidates", label: string, sentence: string, why: string | null) => (
    <button key={k} type="button" data-decision="what" disabled={!!why} onClick={() => onPick(k)} className="w-full rounded-xl border border-neutral-800 bg-neutral-900 p-3 text-left hover:border-amber-400 disabled:opacity-60 sm:p-4" data-rivalry={k}>
      <span className="block text-base font-semibold">{label}</span><span className="mt-0.5 block text-sm text-neutral-300">{sentence}</span>{why && <span className="mt-1 block text-xs text-amber-300">{why}</span>}
    </button>
  );
  return (
    <section className="space-y-3" aria-label={GUIDED_STEPS[1].question} data-guided-step="which">
      <h2 className="text-xl font-semibold">{GUIDED_STEPS[1].question}</h2>
      <div className="grid gap-2 sm:grid-cols-2">
        {opt("teams", "Two teams", "One game, or a whole season. Each team gets its own coin.", teamsBlocked)}
        {opt("candidates", "Two candidates in one race", "Each candidate gets its own coin, settled on that candidate's own market.", null)}
      </div>
    </section>
  );
}

/** Question 3: the four patterns, the share row and the sentence the coin carries. */
export function PatternStep({ preview, options, value, onPick, shares, share, onShare, next }: { preview: ReactNode; options: PatternOption[]; value: PatternId | null; onPick: (p: PatternId) => void; shares: readonly number[]; share: number; onShare: (v: number) => void; next: ReactNode }) {
  return (
    <section className="space-y-3" aria-label={GUIDED_STEPS[2].question} data-guided-step="burn">
      <h2 className="text-xl font-semibold">{GUIDED_STEPS[2].question}</h2>
      <div className="min-w-0 break-words rounded-lg border border-amber-400/50 bg-neutral-900 p-3 text-sm text-neutral-100" data-guided-preview aria-live="polite">{preview}</div>
      <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Burn pattern">
        {options.map((o) => (
          <button key={o.id} type="button" role="radio" aria-checked={value === o.id} data-decision="what" data-pattern={o.id} data-available={o.available ? "yes" : "no"} disabled={!o.available} onClick={() => onPick(o.id)} className={`rounded-lg border p-3 text-left text-sm ${value === o.id ? "border-amber-400 bg-amber-400/10" : "border-neutral-800"} disabled:cursor-not-allowed disabled:opacity-50`}>
            <span className="block font-medium">{o.label}</span>
            <span className="mt-0.5 block text-xs text-neutral-300">{o.sentence}</span>
            {o.reason && <span className="mt-1 block text-xs text-amber-300" data-pattern-reason>{o.reason}</span>}
          </button>
        ))}
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2" role="radiogroup" aria-label="Share of the pool">
        <span className="text-xs text-neutral-500">Share of the pool</span>
        {shares.map((f) => <button key={f} type="button" role="radio" aria-checked={Math.abs(share - f) < 1e-9} data-optional="preset" onClick={() => onShare(f)} className={`rounded-full border px-3 py-1 text-sm ${Math.abs(share - f) < 1e-9 ? "border-amber-400 bg-amber-400 text-neutral-950" : "border-neutral-700"}`}>{pctLabel(f)}</button>)}
      </div>
      {next}
    </section>
  );
}

/** Question 4: the end, as sentences from the rule, with the ends the program pins listed (the ones not built greyed). */
export function EndStep({ sentences, options, next }: { sentences: string[]; options: EndOption[]; next: ReactNode }) {
  return (
    <section className="space-y-3" aria-label={GUIDED_STEPS[3].question} data-guided-step="end">
      <h2 className="text-xl font-semibold">{GUIDED_STEPS[3].question}</h2>
      <div className="min-w-0 space-y-1 break-words rounded-lg border border-amber-400/50 bg-neutral-900 p-3 text-sm text-neutral-100" data-end-sentences>{sentences.map((s) => <p key={s}>{s}</p>)}</div>
      <ul className="space-y-1 text-sm" aria-label="Ends the program can pin">
        {options.map((o) => (
          <li key={o.kind} className={`rounded border p-2 ${o.available ? "border-amber-400" : "border-neutral-800 opacity-60"}`} data-end-option={o.kind} data-available={o.available ? "yes" : "no"}>
            <span className="font-medium">{o.label}</span>{o.available ? <span className="ml-2 text-xs text-amber-300">This coin&apos;s end</span> : <span className="block text-xs text-neutral-400">{o.reason}</span>}
          </li>
        ))}
      </ul>
      {next}
    </section>
  );
}
