"use client";

import type { StatedJson } from "@/lib/burnticker/pageTypes";
import { statedSentences } from "@/lib/burnticker/sources/polyStated";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { CoinCard } from "../_components/CoinCard";
import { FieldHelp } from "../_components/FieldHelp";
import { pctLabel, RAISE_PRESET_SHARED, RAISE_PRESET_TEXT, type RaisePreset } from "@/lib/burnticker/launchPresets";
import { RetirementFacts } from "../_components/RetirementFacts";
import { pairFactLines, type PairFacts } from "@/lib/burnticker/describe";
import { nameProblem, tickerNormalised, tickerProblem } from "@/lib/burnticker/launchFields";
import { ADVANCED_LABEL, ADVANCED_NOTE } from "@/lib/burnticker/creatorCopy";

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
  /** website-12 (A3): the two-coin economics in four facts and a worked example (describe.ts winnerTakesBurnFacts / independentPairFacts). */
  pairFacts?: PairFacts | null;
  /** "Ends Sep 30, 2027, then winds down" — null when the rule has no end. */
  ends: string | null;
  shares: { options: number[]; value: number; onChange: (v: number) => void };
  /** sources-2: the fade side, "Burn when it happens" / "Burn when it does not happen" (dials.ts dialsFor(rule).inverse); null when the rule cannot take it. */
  inverse?: { options: Chip<string>[]; value: string; onChange: (v: string) => void } | null;
  /** website-14 (LAUNCHPAD-PATH §75): the graduation preset, 40 / 60 / 85 SOL (default 85); `line` is the review's own sentence on the chosen raise and the pool it starts. Null for paired launches. */
  raise?: { options: RaisePreset[]; value: RaisePreset; onChange: (v: RaisePreset) => void; line: string | null } | null;
  durations?: { options: Chip<string>[]; value: string; onChange: (v: string) => void } | null;
  note?: { value: string; onChange: (v: string) => void; problem: string | null } | null;
  problems: string[];
  error: string | null;
  busy: boolean;
  /** Names, tickers and the rule are valid (the button stays enabled without a wallet: pressing it opens the wallet chooser). */
  ready: boolean;
  creator: string | null;
  onLaunch: () => void;
  /** website-14 (product idea 6): the coins already registered with this rule (DuplicateNotice.tsx), under the sentence. */
  duplicate?: ReactNode;
  /** Launch audit 5 L06: the pre-wallet summary (PreWalletSummary.tsx); since website-15 item 12 it is collapsed BELOW the button. */
  summary?: ReactNode;
  /** website-15 item 12: the one cost line above the button ("The estimated cost is about 0.03 SOL."), from the review; null while unread. */
  cost?: string | null;
  /** website-15 item 13: the creator's image, description and links (ProfileFields.tsx), above the rule choices; null for pairs. */
  profile?: ReactNode;
  /** website-18: the image control (ProfileFields part "image"), one per coin; always shown above the choices, never inside Advanced. */
  image?: ReactNode;
  /** website-18: the Team path's one "Advanced" disclosure (closed by default) around every other choice, with the defaults it set. */
  advanced?: { defaults: string[] } | null;
  /** website-15 item 13: what still blocks the launch in those fields (listed beside the button). */
  profileProblems?: string[];
  /** L02 / site audit #4: why the wallet cannot open (preview mode, a closed host, a type this host cannot take); null = it can. */
  blocked?: string | null;
  /** L05: availability warnings carried from the source screen (a schedule that could not be read, …). */
  warnings?: string[];
  /** L01: a share that was moved onto the preset row, said out loud (null when nothing moved). */
  shareNotice?: string | null;
  /** L06 / L12: the event exactly as the source states it — the full question, its link, the outcome that fires, when it resolves. */
  event?: { question: string; url: string | null; outcome: string | null; resolves: string | null; criteria: string | null; /** sources-2: Polymarket's stated source and dispute window for one market */ stated?: StatedJson | null } | null;
  /** L12: the generated name is uncertain — the editor opens with this request. */
  namePrompt?: string | null;
}

export const RECEIPTS_LINE = "Every burn posts a public receipt: the reading it settled on, the amount and the transaction, on the coin's page.";
/** LP locked forever (owner decision 2026-10-10), on the receipts line. */
/**
 * The locked liquidity, said exactly (ChatGPT A4, 2026-10-12): the 80 / 20 split is of the SOL side of the locked liquidity's fees after
 * graduation, not of every trading fee, and SOL sent to a burn pool is a budget, not something already burned. The full split per 1 SOL
 * traded is in the summary below the card.
 */
export const LP_LINE = "The pool's liquidity is locked forever. After graduation, the SOL side of the fees it earns goes 80% to the coin's burn pool and 20% to the operator, a split fixed in code.";
/** A4: the dial's name. The share is of the coin's burn budget, never of its supply. */
export const BUDGET_LABEL = "Burn budget per result";
/** website-14: the graduation preset's name. */
export const RAISE_LABEL = "SOL raised before graduation";
export const ACK_LINE = "By launching, you confirm the rule as written. You also confirm that you make no promises to anyone about this coin. The rule is stored with the coin, and no instruction in the program can change it.";
const okTicker = (t: string) => /^[A-Z0-9]{2,10}$/.test(t);
/**
 * website-18 (the owner: "it feels overcomplicated to set up"): on the Team path every choice after the team sits in ONE disclosure,
 * closed by default, that lists the defaults it already set. Without `advanced` the choices render in place, as before.
 */
function AdvancedWrap({ advanced, children }: { advanced: { defaults: string[] } | null; children: ReactNode }) {
  if (!advanced) return <>{children}</>;
  return (
    <details className="min-w-0 rounded-lg border border-neutral-800 p-3" data-advanced>
      <summary className="cursor-pointer text-sm text-neutral-200">{ADVANCED_LABEL}</summary>
      <div className="mt-2 min-w-0 space-y-3">
        <p className="text-xs text-neutral-400">{ADVANCED_NOTE}</p>
        <ul className="min-w-0 list-disc space-y-0.5 break-words pl-5 text-xs text-neutral-300" data-advanced-defaults>{advanced.defaults.map((x) => <li key={x}>{x}</li>)}</ul>
        {children}
      </div>
    </details>
  );
}
export function ReviewCard(p: ReviewCardProps) {
  const [editState, setEditState] = useState(false), [noteOpen, setNoteOpen] = useState(!!p.note?.value);
  const [tickerNotes, setTickerNotes] = useState<Record<string, string | null>>({});
  const modal = useWalletModal();
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  // ChatGPT A11: connecting and launching are two separate steps. Without a wallet the button is "Connect wallet" (it only opens the
  // chooser); once connected it becomes "Launch", and pressing that is the signing step.
  // L07: every field problem, named per coin; the editor cannot be closed over a problem, and the list sits beside the button
  const many = p.coins.length > 1;
  const fieldProblems = [...p.coins.flatMap((c, i) => { const who = many ? `Coin ${i === 0 ? "A" : "B"}: ` : ""; return [nameProblem(c.name), tickerProblem(c.ticker)].filter(Boolean).map((x) => ({ key: c.key, text: `${who}${x}` })); }), ...(p.profileProblems ?? []).map((x) => ({ key: "profile", text: x }))];
  const editing = editState || fieldProblems.length > 0 || (!!p.namePrompt && !editState && !p.coins.some((c) => c.name.trim() && c.name !== "Event Coin"));
  const blockedId = `${uid}-blocked`, problemsId = `${uid}-problems`;
  // L08: when the wallet list closes without a wallet, focus returns to the button that opened it
  const launchBtn = useRef<HTMLButtonElement>(null), modalWasOpen = useRef(false);
  useEffect(() => { if (modal.visible) modalWasOpen.current = true; else if (modalWasOpen.current) { modalWasOpen.current = false; if (!p.creator) launchBtn.current?.focus(); } }, [modal.visible]); // eslint-disable-line react-hooks/exhaustive-deps
  const launch = () => { if (!p.ready || p.busy || p.blocked) return; if (!p.creator) { modal.setVisible(true); return; } p.onLaunch(); };
  const chip = (on: boolean) => `rounded-full border px-3 py-1 text-sm ${on ? "border-amber-400 bg-amber-400 text-neutral-950" : "border-neutral-700 hover:border-neutral-500"}`;
  const label = p.busy ? "Building…" : p.creator || p.blocked ? (many ? "Launch both" : "Launch") : "Connect wallet";
  return (
    <section className="min-w-0 max-w-full overflow-hidden rounded-xl border border-amber-400/60 bg-neutral-900 p-3 sm:p-4 space-y-3 text-sm" aria-label="Review" data-review-card>
      <div className={`grid min-w-0 gap-3 ${many ? "md:grid-cols-2" : ""}`}>
        {p.coins.map((c, i) => {
          const who = many ? `Coin ${i === 0 ? "A" : "B"} ` : "";
          const nId = `${uid}-${c.key}-name`, tId = `${uid}-${c.key}-ticker`, nErr = nameProblem(c.name), tErr = tickerProblem(c.ticker), tNote = tickerNotes[c.key] ?? null;
          return (
          <div key={c.key} className="min-w-0 space-y-2">
            {many && <p className="font-mono text-[11px] uppercase tracking-widest text-neutral-500">{who.trim()}</p>}
            <div className="bt-preview-frame min-w-0 max-w-full overflow-hidden break-words"><CoinCard href={null} prelaunch c={{ ticker: c.ticker, name: c.name, imageUrl: c.image || null, oneLiner: c.oneLiner, oracle: c.oracle, status: "draft", phase: null, progressPct: null, raised: null, threshold: null, quote: "SOL", burns: 0, lastBurnAt: null, nextAt: null, launchedAt: null, badge: c.badge }} /></div>
            {editing ? (
              <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_9rem]">
                <div className="min-w-0 text-xs text-neutral-400"><label htmlFor={nId}>{who}Name</label><FieldHelp id="name" /><input id={nId} data-help="name" data-decision="name" aria-invalid={!!nErr} aria-describedby={nErr ? `${nId}-err` : undefined} className="mt-1 w-full min-w-0 rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm" maxLength={32} value={c.name} onChange={(e) => c.onName(e.target.value)} />{nErr && <span id={`${nId}-err`} className="mt-0.5 block text-red-400">{nErr}</span>}</div>
                <div className="min-w-0 text-xs text-neutral-400"><label htmlFor={tId}>{who}Ticker</label><FieldHelp id="ticker" /><input id={tId} data-help="ticker" data-decision="name" aria-invalid={!!tErr} aria-describedby={[tErr ? `${tId}-err` : "", tNote ? `${tId}-note` : ""].filter(Boolean).join(" ") || undefined} className="mt-1 w-full min-w-0 rounded border border-neutral-700 bg-neutral-950 px-2 py-1 font-mono text-sm uppercase" maxLength={14} value={c.ticker} onChange={(e) => { const n = tickerNormalised(e.target.value); setTickerNotes((x) => ({ ...x, [c.key]: n.note })); c.onTicker(n.value); }} />{tErr && <span id={`${tId}-err`} className="mt-0.5 block text-red-400">{tErr}</span>}{tNote && <span id={`${tId}-note`} className="mt-0.5 block text-amber-300" role="status">{tNote}</span>}</div>
              </div>
            ) : null}
          </div>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-400">
        <button type="button" data-decision="name" className="underline disabled:no-underline disabled:opacity-60" aria-expanded={editing} disabled={editing && fieldProblems.length > 0} onClick={() => setEditState(!editState)}>{editing ? (fieldProblems.length ? "Fix the fields above first" : "done") : many ? "edit the names and tickers" : "edit the name or ticker"}</button>
      </div>
      {p.namePrompt && <p className="text-xs text-amber-300" role="status">{p.namePrompt}</p>}
      <p className="min-w-0 break-words text-base text-neutral-100" data-summary>{p.sentence}</p>
      {p.duplicate}
      {p.event && (
        <div className="min-w-0 break-words rounded border border-neutral-800 p-2 text-xs text-neutral-300" data-event>
          <p>The source states the event as “{p.event.question}”.{p.event.outcome ? ` The coin burns if it resolves ${p.event.outcome}.` : ""}{p.event.resolves ? ` The market is due to close around ${p.event.resolves}.` : ""}{p.event.url && <> <a className="underline" href={p.event.url} rel="noopener" target="_blank">Open the market ↗</a></>}</p>
          {p.event.stated && <p className="mt-1" data-stated>{statedSentences(p.event.stated, p.event.stated.finalAfter)}</p>}
          {p.event.stated?.text && <details className="mt-1 text-neutral-400"><summary className="cursor-pointer">Details</summary><p className="break-words">“{p.event.stated.text}”</p><p>{p.event.stated.finalAfter.ifDisputed}</p></details>}
          {p.event.criteria && <p className="mt-1 whitespace-pre-wrap text-neutral-400">{p.event.criteria.length > 600 ? `${p.event.criteria.slice(0, 600)}… The full rules are on the market page.` : p.event.criteria}</p>}
        </div>
      )}
      {p.pairFacts ? <ul className="min-w-0 list-disc space-y-0.5 break-words pl-5 text-xs text-amber-200" data-pair-facts={p.pairFacts.kind} aria-label="How the two coins burn">{pairFactLines(p.pairFacts).map((x) => <li key={x}>{x}</li>)}</ul>
        : p.pairLine && <p className="min-w-0 break-words text-sm text-amber-200" data-pair-line>{p.pairLine} <FieldHelp id="pair-burn" /></p>}
      {p.warnings && p.warnings.length > 0 && <ul className="min-w-0 list-disc space-y-0.5 break-words pl-5 text-xs text-amber-300" aria-label="Source warnings">{p.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
      {/* website-18: the image control stays on the card (one coin, or each side of a pair), above the Advanced disclosure */}
      {p.image}
      <AdvancedWrap advanced={p.advanced ?? null}>
      {p.profile}
      <div className="flex min-w-0 flex-wrap items-center gap-2" role="radiogroup" aria-label={BUDGET_LABEL} aria-describedby={`${uid}-budget`}>
        <span className="text-xs text-neutral-500" aria-hidden="true">{BUDGET_LABEL}</span>
        {p.shares.options.map((f) => <button key={f} type="button" role="radio" aria-checked={p.shares.value === f} data-optional="preset" className={chip(p.shares.value === f)} onClick={() => p.shares.onChange(f)}>{pctLabel(f)}</button>)}
      </div>
      {p.inverse && (
        <div className="flex min-w-0 flex-wrap items-center gap-2" role="radiogroup" aria-label="When the coin burns" data-inverse>
          {p.inverse.options.map((o) => <button key={o.value} type="button" role="radio" aria-checked={p.inverse!.value === o.value} data-optional="preset" className={chip(p.inverse!.value === o.value)} onClick={() => p.inverse!.onChange(o.value)}>{o.label}</button>)}
        </div>
      )}
      <p id={`${uid}-budget`} className="min-w-0 break-words text-xs text-neutral-400" data-budget-line>Spend {pctLabel(p.shares.value)} of the available burn budget each time. The tokens bought are burned, and the token amount varies.</p>
      {p.raise && (
        <div className="min-w-0 space-y-1" data-raise>
          <div className="flex min-w-0 flex-wrap items-center gap-2" role="radiogroup" aria-label={RAISE_LABEL} aria-describedby={`${uid}-raise`}>
            <span className="text-xs text-neutral-500" aria-hidden="true">{RAISE_LABEL}</span>
            {p.raise.options.map((x) => <button key={x} type="button" role="radio" aria-checked={p.raise!.value === x} data-optional="preset" className={chip(p.raise!.value === x)} onClick={() => p.raise!.onChange(x)}>{x} SOL</button>)}
          </div>
          <p id={`${uid}-raise`} className="min-w-0 break-words text-xs text-neutral-400" data-raise-line>{RAISE_PRESET_TEXT[p.raise.value]} {RAISE_PRESET_SHARED}</p>
          <p className="min-w-0 break-words text-xs text-neutral-300" data-raise-review>{p.raise.line ?? `The curve is complete once buyers have put in ${p.raise.value} SOL, and the coin moves to its Raydium pool, which starts with roughly ${p.raise.value} SOL.`}</p>
        </div>
      )}
      {p.durations && p.durations.options.length > 1 && (
        <div className="flex min-w-0 flex-wrap items-center gap-2" role="radiogroup" aria-label="How long the coins run">
          <span className="text-xs text-neutral-500" aria-hidden="true">Runs</span>
          {p.durations.options.map((d) => <button key={d.value} type="button" role="radio" aria-checked={p.durations!.value === d.value} data-optional="preset" className={chip(p.durations!.value === d.value)} onClick={() => p.durations!.onChange(d.value)}>{d.label}</button>)}
        </div>
      )}
      {p.shareNotice && <p className="min-w-0 break-words text-xs text-amber-300" role="status" data-share-notice>{p.shareNotice}</p>}
      {p.note && (noteOpen ? (
        <label className="block text-xs text-neutral-400">A note from you, shown in its own box (optional, 140 characters, no links)<FieldHelp id="note" /><textarea data-help="note" data-optional="note" aria-invalid={!!p.note.problem} className="mt-1 w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm" rows={2} maxLength={140} value={p.note.value} onChange={(e) => p.note!.onChange(e.target.value)} />{p.note.problem && <span className="text-red-400">{p.note.problem}</span>}</label>
      ) : <button type="button" data-optional="note" className="text-xs underline text-neutral-400" onClick={() => setNoteOpen(true)}>add a note</button>)}
      </AdvancedWrap>
      {p.problems.length > 0 && <p className="min-w-0 break-words text-red-400">Can&apos;t launch this rule: {p.problems.join("; ")}</p>}
      {p.error && <p className="min-w-0 break-words text-red-400" role="alert">{p.error}</p>}
      {p.cost && <p className="min-w-0 break-words text-sm text-neutral-200" data-cost-line>{p.cost}</p>}
      <div className="space-y-1 pt-1">
        {fieldProblems.length > 0 && <ul id={problemsId} className="list-disc pl-5 text-xs text-red-400" aria-label="Not ready to launch">{fieldProblems.map((x) => <li key={x.text}>{x.text}</li>)}</ul>}
        {p.blocked && <p id={blockedId} className="min-w-0 break-words text-xs text-amber-300" data-wallet-blocked>{p.blocked}</p>}
        <button ref={launchBtn} type="button" data-decision="launch" className="rounded bg-amber-400 px-5 py-2 text-base font-semibold text-neutral-950 disabled:opacity-40" aria-describedby={[p.blocked ? blockedId : "", fieldProblems.length ? problemsId : ""].filter(Boolean).join(" ") || undefined} disabled={!p.ready || p.busy || p.problems.length > 0 || !!p.blocked || fieldProblems.length > 0} onClick={launch}>{label}</button>
        {!p.creator && !p.blocked && <p className="min-w-0 break-words text-[11px] text-neutral-500" data-connect-note>Connecting shares only your wallet&apos;s public address. The button then becomes Launch, and launching is a separate step that your wallet asks you to sign.</p>}
      </div>
      {/* website-15 item 12 (Claude site audit 3 item 9; ChatGPT repairs 1 and 6): every word is kept, collapsed below the button */}
      <div className="min-w-0 space-y-2 border-t border-neutral-800 pt-2 text-xs" data-review-more>
        {p.ends && (
          <details className="min-w-0" data-ends>
            <summary className="cursor-pointer text-neutral-300">What the end of the rule means</summary>
            <p className="mt-1 break-words text-neutral-300">{p.ends}</p>
            {!/no end date/.test(p.ends) && <RetirementFacts className="mt-1" open />}
          </details>
        )}
        {p.summary}
        <details className="min-w-0" data-terms>
          <summary className="cursor-pointer text-neutral-300">What you confirm by launching</summary>
          <p className="mt-1 break-words text-neutral-400">{RECEIPTS_LINE} {LP_LINE}</p>
          <p className="mt-1 break-words text-neutral-400">{ACK_LINE} <Link className="underline" href="/burnticker/docs">More options: the API</Link></p>
        </details>
      </div>
    </section>
  );
}
