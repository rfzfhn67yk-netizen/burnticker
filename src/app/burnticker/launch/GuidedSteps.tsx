"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { AMOUNT_MATH_LABEL, END_LABEL, FOLLOW_CHOICES, GUIDED_STEPS, OTHER_PATTERNS_LABEL, UPFRONT_LABEL, createsLine, progressLabel, shareExample, whichHeading, type EndOption, type FollowId, type PatternId, type PatternOption } from "@/lib/burnticker/guidedLaunch";
import { MAIN_RECURRING, pctLabel } from "@/lib/burnticker/launchPresets";
import { CANDIDATES_PAIR_SENTENCE } from "@/lib/burnticker/describe";
import { HAZARD_FOLLOW } from "@/lib/burnticker/hazards";

/** WIRING-SOURCES3: the natural-disaster card leads step 1; the five others follow. */
const STEP1_CHOICES = [{ ...HAZARD_FOLLOW, coins: 1 as const }, ...FOLLOW_CHOICES];

/**
 * THE GUIDED LAUNCH'S SCREENS (website-19; guidedLaunch.ts holds every word and every rule). One question per screen with the progress
 * line ("2 of 4"), Back and Start over always on top, and the sentence the coin is going to carry updating as the creator picks.
 * Presentational: the launch page owns the state and the rules.
 */

export type GuidedPhase = "follow" | "which" | "burn" | "name" | "review";
/** Audit 6 item 4 / pass D item 40: every step's heading takes focus on a step change (the page moves focus to it). */
export const STEP_HEADING = "data-step-heading";
/** website-22 (QA 9 item 36): the measured height of the step's sticky action bar; the launch page pads its bottom by exactly this. */
export const STICKY_VAR = "--bt-sticky-h";

/**
 * THE PROGRESS STRIP (owner, 2026-10-12: "make the step workflow easier to follow"): four short labels, the current one lit, an answered
 * one showing the choice ("Follows: a team") and tappable to go back to it; Back and Start over beside it on every step.
 */
export function GuidedTop({ phase, onBack, onStartOver, confirm, answers = {}, onJump }: { phase: GuidedPhase; onBack: (() => void) | null; onStartOver: () => void; confirm: ReactNode; answers?: Partial<Record<GuidedPhase, string>>; onJump?: (p: GuidedPhase) => void }) {
  const i = GUIDED_STEPS.findIndex((s) => s.id === phase);
  return (
    <div className="space-y-1" data-guided-top>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-400">
        <span className="sr-only" data-guided-progress>{`${progressLabel(i)}: ${GUIDED_STEPS[i].question}`}</span>
        <ol className="flex min-w-0 flex-wrap items-center gap-1" aria-label="Progress" data-progress-strip>
          {GUIDED_STEPS.map((st, k) => {
            const done = k < i, cur = k === i, a = answers[st.id];
            const text = done && a ? `${st.short}: ${a}` : st.short;
            const cls = `rounded-full px-2 py-0.5 ${cur ? "bg-amber-400 font-semibold text-neutral-950" : done ? "border border-neutral-600 text-neutral-200" : "text-neutral-500"}`;
            return (
              <li key={st.id} className="min-w-0" aria-current={cur ? "step" : undefined}>
                {/* website-22 (QA 9 item 24): a long answer ends in an ellipsis, and the whole answer is the chip's title */}
                {done && onJump ? <button type="button" data-nav title={text} className={`${cls} block max-w-[11rem] truncate underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400`} onClick={() => onJump(st.id)} aria-label={`Change ${st.short.toLowerCase()}${a ? `, now ${a}` : ""}`} data-jump={st.id}>{text}</button> : <span title={text} className={`${cls} inline-block max-w-[11rem] truncate align-bottom`}>{text}</span>}
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
 * The step's one primary action ("Next", "Review"), kept in view at the bottom of the screen, above the phone tab bar (WIRING-POLISH 2: its
 * height --bt-tabbar-h plus the safe area and a 10 px gap below 900 px wide), never under it, on the same opaque ground as the bar.
 */
export function StickyAction({ children }: { children: ReactNode }) {
  // website-22 (QA 9 item 36): the page's bottom padding is this bar's own height (--bt-sticky-h), measured, never a guess
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current, root = document.documentElement;
    if (!el) return;
    const set = () => root.style.setProperty(STICKY_VAR, `${Math.ceil(el.getBoundingClientRect().height)}px`);
    set();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(set);
    ro?.observe(el);
    return () => { ro?.disconnect(); root.style.removeProperty(STICKY_VAR); };
  }, []);
  return <div ref={ref} className="sticky bottom-[calc(var(--bt-tabbar-h,62px)+env(safe-area-inset-bottom)+10px)] z-20 -mx-1 rounded-lg bg-neutral-950 px-1 py-2 min-[900px]:bottom-4" data-sticky-action>{children}</div>;
}

/** Question 1: what the coin follows. Compact cards (title and one line); a tap picks and moves on. */
export function FollowStep({ onPick, blocked, upfront = [], extra = null, value = null, search = null }: { /** audit 7 item 16: the card already chosen (aria-checked) */ value?: FollowId | null; onPick: (f: FollowId) => void; blocked: (f: FollowId) => string | null; /** audit 6 item 14 */ upfront?: string[]; /** WIRING-SOURCES3: an extra entry card after the five */ extra?: ReactNode; /** website-22 (QA 9 item 39): the one free-text line, under the question and above the six cards */ search?: ReactNode }) {
  return (
    <section className="space-y-2" aria-label={GUIDED_STEPS[0].question} data-guided-step="follow">
      <h2 className="text-lg font-semibold sm:text-xl outline-none" tabIndex={-1} data-step-heading>{GUIDED_STEPS[0].question}</h2>
      {search}
      <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label={GUIDED_STEPS[0].question}>
        {STEP1_CHOICES.map((c) => { const why = blocked(c.id); return (
          <div key={c.id} className={`min-w-0 rounded-xl border border-neutral-800 bg-neutral-900 ${why ? "opacity-60" : ""}`} data-follow={c.id}>
            <button type="button" role="radio" aria-checked={value === c.id} data-decision="what" data-follow-choice={c.id} aria-label={c.label} aria-describedby={`follow-${c.id}-line`} disabled={!!why} onClick={() => onPick(c.id)} className="flex w-full min-w-0 items-center justify-between gap-2 rounded-xl px-3 py-2 text-left hover:border-amber-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 disabled:cursor-not-allowed">
              <span className="min-w-0"><span className="block text-base font-semibold">{c.label} <span className="ml-1 align-middle text-[11px] font-normal text-neutral-400" data-creates={c.coins}>{createsLine(c.coins)}</span></span><span id={`follow-${c.id}-line`} className="block truncate text-sm text-neutral-300">{c.line}</span></span>
              <span aria-hidden="true" className="shrink-0 text-neutral-500">›</span>
            </button>
            {why && <p className="px-3 pb-2 text-xs text-amber-300">{why}</p>}
          </div>
        ); })}
        {extra}
      </div>
      <details className="text-xs text-neutral-400" data-follow-examples>
        <summary className="cursor-pointer">Examples</summary>
        <ul className="mt-1 space-y-1">{STEP1_CHOICES.map((c) => <li key={c.id}><span className="text-neutral-200">{c.label}.</span> {c.sentence} {c.example}</li>)}</ul>
      </details>
      {upfront.length > 0 && <details className="text-xs text-neutral-400" data-upfront><summary className="cursor-pointer">{UPFRONT_LABEL}</summary>{upfront.map((x) => <p key={x} className="mt-1">{x}</p>)}</details>}
    </section>
  );
}

/** Question 2 for a rivalry pair: two teams, or two candidates. */
export function RivalryKindStep({ onPick, teamsBlocked, value = null }: { onPick: (k: "teams" | "candidates") => void; teamsBlocked: string | null; /** audit 7 item 16 */ value?: "teams" | "candidates" | null }) {
  const opt = (k: "teams" | "candidates", label: string, sentence: string, why: string | null) => (
    <button key={k} type="button" role="radio" aria-checked={value === k} data-decision="what" aria-label={label} disabled={!!why} onClick={() => onPick(k)} className="w-full rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 border border-neutral-800 bg-neutral-900 p-3 text-left hover:border-amber-400 disabled:opacity-60 sm:p-4" data-rivalry={k}>
      <span className="block text-base font-semibold">{label}</span><span className="mt-0.5 block text-sm text-neutral-300">{sentence}</span>{why && <span className="mt-1 block text-xs text-amber-300">{why}</span>}
    </button>
  );
  return (
    <section className="space-y-3" aria-label={GUIDED_STEPS[1].question} data-guided-step="which">
      <h2 className="text-xl font-semibold outline-none" tabIndex={-1} data-step-heading>{whichHeading("rivalry")}</h2>
      <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label={whichHeading("rivalry")}>
        {opt("teams", "Two teams", "One game, or a whole season. Each team gets its own coin.", teamsBlocked)}
        {/* WIRING-SETTLED-PAIRS (owner 2026-10-13): two candidates in one race are one linked pair, the only form offered */}
        {opt("candidates", "Two candidates in one race", CANDIDATES_PAIR_SENTENCE, null)}
      </div>
    </section>
  );
}

/** Question 3: the four patterns, the share row and the sentence the coin carries. */
export function PatternStep({ preview, options, value, onPick, shares, share, onShare, next, math = null, notice = null, extra = null, pairLabel = false, drain = null }: { /** WIRING-PARITY audit 7 #6: how fast a large share empties the pool */ drain?: string | null; /** item 159: a pair's share is set once for both coins */ pairLabel?: boolean; preview: ReactNode; options: PatternOption[]; value: PatternId | null; onPick: (p: PatternId) => void; shares: readonly number[]; share: number; onShare: (v: number) => void; next: ReactNode; /** pass B item 16 */ math?: string | null; /** audit 6 item 7: why a tap did nothing */ notice?: string | null; /** WIRING-SOURCES3: extra choices (a disaster coin's per-event / next-event pair) */ extra?: ReactNode }) {
  const offered = options.filter((o) => o.available), other = options.filter((o) => !o.available);
  // item 153: More and Less always toggle; the chosen share stays visible on the main row
  const [more, setMore] = useState(false);
  const MAIN = MAIN_RECURRING as readonly number[];
  const mainRow = shares.filter((f) => shares.length <= 3 || MAIN.includes(f) || (!more && Math.abs(f - share) < 1e-9));
  return (
    <section className="space-y-3" aria-label={GUIDED_STEPS[2].question} data-guided-step="burn">
      <h2 className="text-xl font-semibold outline-none" tabIndex={-1} data-step-heading>{GUIDED_STEPS[2].question}</h2>
      <div className="min-w-0 break-words rounded-lg border border-amber-400/50 bg-neutral-900 p-3 text-sm text-neutral-100" data-guided-preview aria-live="polite">{preview}</div>
      <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Burn pattern">
        {offered.map((o) => (
          <button key={o.id} type="button" role="radio" aria-checked={value === o.id} aria-label={o.label} data-decision="what" data-pattern={o.id} data-available={o.available ? "yes" : "no"} disabled={!o.available} onClick={() => onPick(o.id)} className={`rounded-lg border p-3 text-left text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 ${value === o.id ? "border-amber-400 bg-amber-400/10" : "border-neutral-800"} disabled:cursor-not-allowed disabled:opacity-50`}>
            <span className="block font-medium">{o.label}</span>
            <span className="mt-0.5 block text-xs text-neutral-300">{o.sentence}</span>
            {o.reason && <span className="mt-1 block text-xs text-amber-300" data-pattern-reason>{o.reason}</span>}
          </button>
        ))}
      </div>
      {extra}
      {notice && <p className="text-xs text-amber-300" role="status" data-pattern-notice>{notice}</p>}
      {other.length > 0 && (
        <details className="text-xs text-neutral-400" data-other-patterns>
          <summary className="cursor-pointer">{OTHER_PATTERNS_LABEL}</summary>
          <ul className="mt-1 space-y-1">{other.map((o) => <li key={o.id} data-pattern={o.id} data-available="no" aria-disabled="true"><span className="text-neutral-200">{o.label}.</span> {o.reason}</li>)}</ul>
        </details>
      )}
      <div className="flex min-w-0 flex-wrap items-center gap-2" role="radiogroup" aria-label={pairLabel ? "Share of each coin's burn pool, the same for both" : "Share of the burn pool"}>
        <span className="text-xs text-neutral-500">{pairLabel ? "Share of each coin's burn pool, the same for both" : "Share of the burn pool"}</span>
        {mainRow.map((f) => <button key={f} type="button" role="radio" aria-checked={Math.abs(share - f) < 1e-9} data-optional="preset" onClick={() => onShare(f)} className={`rounded-full border px-3 py-1 text-sm ${Math.abs(share - f) < 1e-9 ? "border-amber-400 bg-amber-400 text-neutral-950" : "border-neutral-700"}`}>{pctLabel(f)}</button>)}
        {more && shares.filter((f) => !mainRow.includes(f)).map((f) => <button key={f} type="button" role="radio" aria-checked={Math.abs(share - f) < 1e-9} data-optional="preset" onClick={() => onShare(f)} className={`rounded-full border px-3 py-1 text-sm ${Math.abs(share - f) < 1e-9 ? "border-amber-400 bg-amber-400 text-neutral-950" : "border-neutral-700"}`}>{pctLabel(f)}</button>)}
        {/* website-22 (QA 9 item 37): More and Less sit at the end of the row, after every chip */}
        {shares.length > 3 && <button type="button" data-optional="preset" aria-expanded={more} className="text-xs text-neutral-400 underline" onClick={() => setMore(!more)} data-share-more>{more ? "Less" : "More"}</button>}
      </div>
      <p className="text-xs text-neutral-400" data-share-example>{shareExample(share)}</p>
      {drain && <p className="text-xs text-amber-200" data-drain>{drain}</p>}
      {math && <details className="text-xs text-neutral-400" data-amount-math><summary className="cursor-pointer">{AMOUNT_MATH_LABEL}</summary><p className="mt-1">{math}</p></details>}
      {next}
    </section>
  );
}

/**
 * The end, stated on the review (website-20; pass B item 18, audit 6 item 12): the sentences read from the rule, then the ends the program
 * can pin that this coin does not use, one tap away. Never a menu with one live choice.
 */
export function EndSection({ sentences, options, title = null, choice = null }: { sentences: string[]; options: EndOption[]; /** website-21: a rivalry series pair names its one end ("The rest goes to the series winner") */ title?: string | null; /** the end-sink picker (EndChoicePicker), when this coin may pick */ choice?: ReactNode }) {
  const other = options.filter((o) => !o.available);
  return (
    <section className="min-w-0 space-y-1 rounded-lg border border-neutral-800 p-3 text-sm" aria-label={title ?? END_LABEL} data-end-section>
      <h3 className="text-xs font-medium text-neutral-400">{END_LABEL}</h3>
      {title && <p className="font-medium text-amber-200" data-end-title>{title}</p>}
      <div className="min-w-0 space-y-1 break-words text-neutral-100" data-end-sentences>{sentences.map((s) => <p key={s}>{s}</p>)}</div>
      {choice}
      {other.length > 0 && (
        <details className="text-xs text-neutral-400" data-other-ends>
          <summary className="cursor-pointer">Other ends, not used here</summary>
          <ul className="mt-1 space-y-1">{other.map((o) => <li key={o.kind} data-end-option={o.kind}><span className="text-neutral-200">{o.label}.</span> {o.reason}</li>)}</ul>
        </details>
      )}
    </section>
  );
}
