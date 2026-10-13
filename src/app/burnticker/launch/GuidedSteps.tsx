"use client";

import type { ReactNode } from "react";
import { FOLLOW_CHOICES, GUIDED_STEPS, progressLabel, type EndOption, type FollowId, type PatternId, type PatternOption } from "@/lib/burnticker/guidedLaunch";
import { MAIN_RECURRING, pctLabel } from "@/lib/burnticker/launchPresets";

/**
 * THE GUIDED LAUNCH'S SCREENS (website-19; guidedLaunch.ts holds every word and every rule). One question per screen with the progress
 * line ("2 of 4"), Back and Start over always on top, and the sentence the coin is going to carry updating as the creator picks.
 * Presentational: the launch page owns the state and the rules.
 */

export type GuidedPhase = "follow" | "which" | "burn" | "end" | "review";

/**
 * THE PROGRESS STRIP (owner, 2026-10-12: "make the step workflow easier to follow"): four short labels, the current one lit, an answered
 * one showing the choice ("Follows: a team") and tappable to go back to it; Back and Start over beside it on every step.
 */
export function GuidedTop({ phase, onBack, onStartOver, confirm, answers = {}, onJump }: { phase: GuidedPhase; onBack: (() => void) | null; onStartOver: () => void; confirm: ReactNode; answers?: Partial<Record<GuidedPhase, string>>; onJump?: (p: GuidedPhase) => void }) {
  const i = phase === "review" ? GUIDED_STEPS.length : GUIDED_STEPS.findIndex((s) => s.id === phase);
  return (
    <div className="space-y-1" data-guided-top>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-400">
        <span className="sr-only" data-guided-progress>{i < GUIDED_STEPS.length ? `${progressLabel(i)}: ${GUIDED_STEPS[i].question}` : "Review"}</span>
        <ol className="flex min-w-0 flex-wrap items-center gap-1" aria-label="Progress" data-progress-strip>
          {GUIDED_STEPS.map((st, k) => {
            const done = k < i, cur = k === i, a = answers[st.id];
            const text = done && a ? `${st.short}: ${a}` : st.short;
            const cls = `rounded-full px-2 py-0.5 ${cur ? "bg-amber-400 font-semibold text-neutral-950" : done ? "border border-neutral-600 text-neutral-200" : "text-neutral-500"}`;
            return (
              <li key={st.id} className="min-w-0" aria-current={cur ? "step" : undefined}>
                {done && onJump ? <button type="button" data-nav className={`${cls} max-w-[11rem] truncate underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400`} onClick={() => onJump(st.id)} aria-label={`Change ${st.short.toLowerCase()}${a ? `, now ${a}` : ""}`} data-jump={st.id}>{text}</button> : <span className={`${cls} inline-block max-w-[11rem] truncate`}>{text}</span>}
              </li>
            );
          })}
        </ol>
        <span className="flex items-center gap-3">
          {onBack && <button type="button" data-nav className="underline" onClick={onBack}>← Back</button>}
          <button type="button" data-nav className="underline" onClick={onStartOver} data-start-over>Start over</button>
        </span>
      </div>
      {confirm}
    </div>
  );
}

/**
 * The step's one primary action ("Next", "Review"), kept in view at the bottom of the screen, above the phone tab bar (64 px plus the safe
 * area below 900 px wide), never under it.
 */
export function StickyAction({ children }: { children: ReactNode }) {
  return <div className="sticky bottom-[calc(72px+env(safe-area-inset-bottom))] z-20 -mx-1 rounded-lg bg-neutral-950/95 px-1 py-2 min-[900px]:bottom-4" data-sticky-action>{children}</div>;
}

/** Question 1: what the coin follows. Compact cards (title and one line); a tap picks and moves on. */
export function FollowStep({ onPick, blocked }: { onPick: (f: FollowId) => void; blocked: (f: FollowId) => string | null }) {
  return (
    <section className="space-y-2" aria-label={GUIDED_STEPS[0].question} data-guided-step="follow">
      <h2 className="text-lg font-semibold sm:text-xl">{GUIDED_STEPS[0].question}</h2>
      <div className="grid gap-2 sm:grid-cols-2" role="group" aria-label={GUIDED_STEPS[0].question}>
        {FOLLOW_CHOICES.map((c) => { const why = blocked(c.id); return (
          <div key={c.id} className={`min-w-0 rounded-xl border border-neutral-800 bg-neutral-900 ${why ? "opacity-60" : ""}`} data-follow={c.id}>
            <button type="button" data-decision="what" data-follow-choice={c.id} aria-label={c.label} aria-describedby={`follow-${c.id}-line`} disabled={!!why} onClick={() => onPick(c.id)} className="flex w-full min-w-0 items-center justify-between gap-2 rounded-xl px-3 py-2 text-left hover:border-amber-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 disabled:cursor-not-allowed">
              <span className="min-w-0"><span className="block text-base font-semibold">{c.label}</span><span id={`follow-${c.id}-line`} className="block truncate text-sm text-neutral-300">{c.line}</span></span>
              <span aria-hidden="true" className="shrink-0 text-neutral-500">›</span>
            </button>
            {why && <p className="px-3 pb-2 text-xs text-amber-300">{why}</p>}
          </div>
        ); })}
      </div>
      <details className="text-xs text-neutral-400" data-follow-examples>
        <summary className="cursor-pointer">Examples</summary>
        <ul className="mt-1 space-y-1">{FOLLOW_CHOICES.map((c) => <li key={c.id}><span className="text-neutral-200">{c.label}.</span> {c.sentence} {c.example}</li>)}</ul>
      </details>
    </section>
  );
}

/** Question 2 for a rivalry pair: two teams, or two candidates. */
export function RivalryKindStep({ onPick, teamsBlocked }: { onPick: (k: "teams" | "candidates") => void; teamsBlocked: string | null }) {
  const opt = (k: "teams" | "candidates", label: string, sentence: string, why: string | null) => (
    <button key={k} type="button" data-decision="what" aria-label={label} disabled={!!why} onClick={() => onPick(k)} className="w-full rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 border border-neutral-800 bg-neutral-900 p-3 text-left hover:border-amber-400 disabled:opacity-60 sm:p-4" data-rivalry={k}>
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
          <button key={o.id} type="button" role="radio" aria-checked={value === o.id} aria-label={o.label} data-decision="what" data-pattern={o.id} data-available={o.available ? "yes" : "no"} disabled={!o.available} onClick={() => onPick(o.id)} className={`rounded-lg border p-3 text-left text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 ${value === o.id ? "border-amber-400 bg-amber-400/10" : "border-neutral-800"} disabled:cursor-not-allowed disabled:opacity-50`}>
            <span className="block font-medium">{o.label}</span>
            <span className="mt-0.5 block text-xs text-neutral-300">{o.sentence}</span>
            {o.reason && <span className="mt-1 block text-xs text-amber-300" data-pattern-reason>{o.reason}</span>}
          </button>
        ))}
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2" role="radiogroup" aria-label="Share of the pool">
        <span className="text-xs text-neutral-500">Share of the pool</span>
        {shares.filter((f) => shares.length <= 3 || (MAIN_RECURRING as readonly number[]).includes(f)).map((f) => <button key={f} type="button" role="radio" aria-checked={Math.abs(share - f) < 1e-9} data-optional="preset" onClick={() => onShare(f)} className={`rounded-full border px-3 py-1 text-sm ${Math.abs(share - f) < 1e-9 ? "border-amber-400 bg-amber-400 text-neutral-950" : "border-neutral-700"}`}>{pctLabel(f)}</button>)}
        {shares.length > 3 && <details className="inline-block" open={!(MAIN_RECURRING as readonly number[]).includes(share)} data-share-more><summary className="cursor-pointer text-xs text-neutral-400">More</summary><span className="ml-1 inline-flex gap-2">
            {shares.filter((f) => !(MAIN_RECURRING as readonly number[]).includes(f)).map((f) => <button key={f} type="button" role="radio" aria-checked={Math.abs(share - f) < 1e-9} data-optional="preset" onClick={() => onShare(f)} className={`rounded-full border px-3 py-1 text-sm ${Math.abs(share - f) < 1e-9 ? "border-amber-400 bg-amber-400 text-neutral-950" : "border-neutral-700"}`}>{pctLabel(f)}</button>)}
        </span></details>}
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
