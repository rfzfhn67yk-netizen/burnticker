"use client";

import type { StatedJson } from "@/lib/burnticker/pageTypes";
import { statedSentences } from "@/lib/burnticker/sources/polyStated";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { CoinCard } from "../_components/CoinCard";
import { FieldHelp } from "../_components/FieldHelp";
import { MAIN_RECURRING, pctLabel, RAISE_PRESET_SHARED, RAISE_PRESET_TEXT, type RaisePreset } from "@/lib/burnticker/launchPresets";
import { RetirementFacts } from "../_components/RetirementFacts";
import { pairFactLines, type PairFacts } from "@/lib/burnticker/describe";
import { nameProblem, tickerNormalised, tickerProblem } from "@/lib/burnticker/launchFields";
import { ADVANCED_LABEL, ADVANCED_NOTE } from "@/lib/burnticker/creatorCopy";
import { AMOUNT_MATH_LABEL, ELECTION_AUTHORITY_LABEL, GRADUATION_LABEL, NOTE_HELP, NOTE_LABEL, NOTE_VS_DESCRIPTION, PAIR_DIAGRAM_LABEL, UPFRONT_LABEL, lpDisclosureFor, profileMoreLabel, shareExample, type LaunchVenue } from "@/lib/burnticker/guidedLaunch";
import { OPERATOR_SHARE_LINE, PAIR_OPERATOR_SHARE_LINE } from "@/lib/burnticker/feeShareLine";
import type { TickerCheck } from "@/lib/burnticker/tickerCheck";
import { NAME_INPUT_MAX, NAME_MAX_LINE, RESERVED_TICKER_LINE, TICKER_PASTE_MAX } from "./pageCopy";
import type { FundsFlow } from "@/lib/burnticker/pairFundsFlow";

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

export interface ReviewCoin { key: string; name: string; ticker: string; onName: (v: string) => void; onTicker: (v: string) => void; image: string; oneLiner: string; oracle: string; badge: string | null; /** website-25 (QA 11 H5): the wording rules on the name and the ticker, one sentence each (fieldChecks.ts), said under the field */ nameIssue?: string | null; tickerIssue?: string | null }
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
  /** website-15 item 13: what still blocks the launch in those fields (listed beside the button); website-22: each with its Edit link. */
  profileProblems?: Blocker[];
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
  /** website-19 (intent audit item 6): the budget row's label and sentence from the rule's own unit (guidedLaunch.ts budgetCopy). */
  budget?: { label: string; line: string } | null;
  /** website-19 (snag 16): the dispute-window sentence on every one-market Polymarket review (the review payload's `dispute`). */
  dispute?: string | null;
  /** website-19: what graduation means, beside the raise choice (the review payload's `graduation`). */
  graduation?: string[] | null;
  /** website-19 (owner, 2026-10-12): the coins already holding a side's ticker, with free suggestions; a warning, never a refusal. */
  tickerChecks?: TickerCheck[] | null;
  /** website-19 (snag 11): extra plain lines under the rule sentence, such as a result due before graduation. */
  notes?: string[] | null;
  /**
   * website-20 (audit 6 item 12, the owner's mobile rule): "full" = every control on one card (the free-text path, as before); "name" = step 4
   * of the guided launch, the name, ticker, image, description and links only, with `next`; "review" = step 5, the five facts with an Edit
   * link each, the end section and Launch, with no duplicate share or name controls.
   */
  mode?: "full" | "name" | "review";
  /** The five things always visible on the review (guidedLaunch.ts FACT_LABELS), each with an Edit link back to its step. */
  facts?: { label: string; value: string; edit?: (() => void) | null }[] | null;
  /** The end, stated (guidedLaunch.ts END_LABEL and endSentences). */
  endSection?: ReactNode;
  /** Item 53: who decides an election coin's result (guidedLaunch.ts electionAuthorityLines). */
  authority?: string[] | null;
  /** WIRING-SEMANTICS: the edge cases that apply to this rule (ruleEdgeCases.ts), one tap away. */
  edgeNotes?: string[] | null;
  /** Audit 6 item 14: what to know before you start, said again on the review. */
  upfront?: string[] | null;
  /** Step 4's own Next button. */
  next?: ReactNode;
  /** Pass B item 16: the compounding arithmetic, behind "How the amount is calculated". */
  amountMath?: string | null;
  /**
   * website-22 (audit 10 item 3): how the coins launch, which decides the fee sentence. "single" one LaunchLab coin; "independent" two
   * separate LaunchLab launches; "linked" two LaunchLab coins linked at creation; "pair-curve" a registered pair on the pair curve, whose
   * pools open with Raydium's creator fee off (PAIR_LP_LINE). Without it the card reads one coin, or two separate launches.
   */
  venue?: LaunchVenue | null;
  /**
   * website-22 (QA 9 items 11 and 13, audit 10 item 19): each coin's public profile as it is pinned, on the review, with an Edit link per
   * field back to the name step. Replaces the coin previews there, so the full name shows on a phone.
   */
  publicProfile?: { coins: PublicProfileCoin[]; edit: (side: "a" | "b", field: ProfileFieldKey) => void } | null;
  /** website-22 (audit 10 item 24): the small diagram of how two coins burn, beside the pair's facts. */
  pairDiagram?: "independent" | "linked" | null;
  /** website-22 (audit 10 item 17): what the estimate beside the launch button leaves out. */
  costNote?: string | null;
}
export type { LaunchVenue } from "@/lib/burnticker/guidedLaunch";
export type ProfileFieldKey = "name" | "ticker" | "image" | "description" | "x" | "telegram" | "website" | "note";
export interface PublicProfileCoin { side: "a" | "b"; image: string; name: string; ticker: string; description: string; links: { label: string; url: string }[]; note: string | null }
/** A blocker beside the launch button: its sentence and, when a field can fix it, the link back to that field. */
export type Blocker = string | { text: string; edit?: (() => void) | null };
const blockerText = (b: Blocker): string => (typeof b === "string" ? b : b.text);

/**
 * website-22 (audit 10 item 3): the fee sentence by the actual venue, never by the number of coins. Two separate LaunchLab launches and a
 * LaunchLab pair are each an ordinary LaunchLab coin (LP_LINE for each); only the pair curve's pools open with the creator fee off.
 */
export const lpDisclosure = (venue: LaunchVenue): string => lpDisclosureFor(venue, LP_LINE, PAIR_LP_LINE);

/** website-22 (audit 10 item 24): two separate pools, or a linked pair where the coin whose rule fires takes the burn. Decorative; the label says it. */
export function PairDiagram({ kind }: { kind: "independent" | "linked" }) {
  const label = PAIR_DIAGRAM_LABEL[kind];
  return (
    <figure className="flex min-w-0 items-center gap-3" data-pair-diagram={kind}>
      <svg viewBox="0 0 120 56" width="120" height="56" role="img" aria-label={label} className="shrink-0 text-neutral-400">
        <rect x="2" y="8" width="44" height="28" rx="6" fill="none" stroke="currentColor" />
        <rect x="74" y="8" width="44" height="28" rx="6" fill="none" stroke="currentColor" />
        <text x="24" y="26" textAnchor="middle" fontSize="11" fill="currentColor">A</text>
        <text x="96" y="26" textAnchor="middle" fontSize="11" fill="currentColor">B</text>
        {kind === "independent"
          ? <><line x1="52" y1="22" x2="68" y2="22" stroke="currentColor" strokeDasharray="2 3" /><text x="60" y="50" textAnchor="middle" fontSize="9" fill="currentColor">no SOL moves</text></>
          : <><path d="M70 22 H54" stroke="#fbbf24" strokeWidth="2" markerEnd="url(#bt-arrow)" /><defs><marker id="bt-arrow" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L6 3 L0 6 z" fill="#fbbf24" /></marker></defs><text x="60" y="50" textAnchor="middle" fontSize="9" fill="currentColor">winner takes the burn</text></>}
      </svg>
      <figcaption className="min-w-0 break-words text-xs text-neutral-300">{label}</figcaption>
    </figure>
  );
}

/**
 * website-21 (WIRING-RIVALRY-SERIES): a funds flow the review answered (review.meetings.flow, pairFundsFlow.ts meetingsFundsFlow), rendered
 * the way PairFundsFlow.tsx renders pairFundsFlow: the one line, then the steps, every outcome and the never line behind a disclosure.
 */
export function FundsFlowView({ flow, open = false }: { flow: FundsFlow; open?: boolean }) {
  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-3 text-xs" aria-label="Where the money goes" data-pair-funds-flow={flow.version} data-meetings-flow>
      <p className="font-mono text-[11px] uppercase tracking-widest text-neutral-500">{flow.versionLabel}</p>
      <p className="mt-1 text-sm text-neutral-100">{flow.oneLiner}</p>
      <details className="mt-2" open={open}><summary className="cursor-pointer text-neutral-300">Where the money goes, and what happens on a draw, a missing result or a time-out</summary>
        <dl className="mt-2 space-y-1">{flow.steps.map((s) => <div key={s.title}><dt className="inline font-medium text-neutral-200">{s.title}: </dt><dd className="inline text-neutral-300">{s.text}</dd></div>)}</dl>
        <ul className="mt-2 list-disc pl-5 space-y-1 text-neutral-300">{flow.outcomes.map((o) => <li key={o.when}><b className="text-neutral-200">{o.when}:</b> {o.then}</li>)}</ul>
        <p className="mt-2 text-neutral-400">{flow.never}</p>
      </details>
    </section>
  );
}

export const RECEIPTS_LINE = "Every burn posts a public receipt: the reading it settled on, the amount and the transaction, on the coin's page.";
/** LP locked forever (owner decision 2026-10-10), on the receipts line. */
/**
 * The locked liquidity, said exactly (ChatGPT A4, 2026-10-12): the 80 / 20 split is of the SOL side of the locked liquidity's fees after
 * graduation, not of every trading fee, and SOL sent to a burn pool is a budget, not something already burned. The full split per 1 SOL
 * traded is in the summary below the card.
 */
// fees copy (2026-10-12, WIRING-FEES.md; the owner: "it's showing I'm getting 20%"): the operator's share said from the constants
export const LP_LINE = `The pool's liquidity is locked forever. ${OPERATOR_SHARE_LINE} The operator's part of the liquidity fees is fixed in code.`;
export const PAIR_LP_LINE = `The pool's liquidity is locked forever. ${PAIR_OPERATOR_SHARE_LINE} The operator's part of the liquidity fees is fixed in code.`;
/** A4: the dial's name. The share is of the coin's burn pool, never of its supply. */
export const BUDGET_LABEL = "Share of the burn pool per result";
/** Audit 6 item 5: the ticker field takes at most what the server accepts. */
export const TICKER_INPUT_MAX = 10;
/** website-25: the field limits and the reserved-ticker sentence live in pageCopy.ts (tests import it without the component) */
export { NAME_INPUT_MAX, NAME_MAX_LINE, RESERVED_TICKER_LINE, TICKER_PASTE_MAX };
/** website-14: the graduation preset's name. */
export const RAISE_LABEL = "SOL raised before graduation";
/** Labels of the note and the step-4 sections. */
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
  // owner, 2026-10-12: 10 and 25 % behind "More", shown at once when one of them is chosen
  const [moreShares, setMoreShares] = useState(false);
  // website-20 item 153: More and Less always toggle; a chosen 10 or 25 % stays on the main row while the rest is folded
  const showMore = moreShares;
  const mainShares = p.shares.options.filter((f) => p.shares.options.length <= 3 || (MAIN_RECURRING as readonly number[]).includes(f) || (!moreShares && f === p.shares.value));
  const modal = useWalletModal();
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  // ChatGPT A11: connecting and launching are two separate steps. Without a wallet the button is "Connect wallet" (it only opens the
  // chooser); once connected it becomes "Launch", and pressing that is the signing step.
  // L07: every field problem, named per coin; the editor cannot be closed over a problem, and the list sits beside the button
  const many = p.coins.length > 1;
  // website-25 (QA 11 H5): on the name step the Edit link moves focus to the field itself
  const fieldEdit = (side: "a" | "b", f: "name" | "ticker") => (p.mode === "review" && p.publicProfile ? () => p.publicProfile!.edit(side, f) : p.mode === "name" ? () => { const el = document.getElementById(`bt-profile-${side}-${f}`); el?.scrollIntoView({ block: "center" }); el?.focus({ preventScroll: true }); } : null);
  const fieldProblems: { key: string; text: string; edit: (() => void) | null }[] = [...p.coins.flatMap((c, i) => { const who = many ? `Coin ${i === 0 ? "A" : "B"}: ` : ""; const side = i === 0 ? "a" as const : "b" as const; return ([[nameProblem(c.name) || c.nameIssue || null, "name"], [tickerProblem(c.ticker) || c.tickerIssue || null, "ticker"]] as const).filter(([x]) => !!x).map(([x, f]) => ({ key: c.key, text: `${who}${x}`, edit: fieldEdit(side, f) })); }), ...(p.profileProblems ?? []).map((x) => ({ key: "profile", text: blockerText(x), edit: typeof x === "string" ? null : x.edit ?? null }))]
    .filter((x, i, all) => all.findIndex((y) => y.text === x.text) === i);
  const problemList = (label: string, id?: string) => <ul id={id} className="list-disc space-y-0.5 pl-5 text-xs text-red-400" aria-label={label} data-blockers>{fieldProblems.map((x) => <li key={x.text} className="break-words">{x.text}{x.edit && <> <button type="button" data-nav className="underline text-neutral-300" onClick={x.edit}>Edit</button></>}</li>)}</ul>;
  // owner, 2026-10-12 ("whenever i type 2 letters when naming a coin it accepts those 2 letters as the name and moves on"): the editor
  // used to be open only WHILE a field had a problem or the name prompt applied, so the second typed letter cleared the problem and the
  // fields vanished under the creator's cursor. Once the editor opens for any reason it stays open until the creator presses done.
  const forcedOpen = fieldProblems.length > 0 || (!!p.namePrompt && !p.coins.some((c) => c.name.trim() && c.name !== "Event Coin"));
  useEffect(() => { if (forcedOpen) setEditState(true); }, [forcedOpen]);
  const editing = editState || forcedOpen;
  const blockedId = `${uid}-blocked`, problemsId = `${uid}-problems`;
  // L08: when the wallet list closes without a wallet, focus returns to the button that opened it
  const launchBtn = useRef<HTMLButtonElement>(null), modalWasOpen = useRef(false);
  useEffect(() => { if (modal.visible) modalWasOpen.current = true; else if (modalWasOpen.current) { modalWasOpen.current = false; if (!p.creator) launchBtn.current?.focus(); } }, [modal.visible]); // eslint-disable-line react-hooks/exhaustive-deps
  const launch = () => { if (!p.ready || p.busy || p.blocked) return; if (!p.creator) { modal.setVisible(true); return; } p.onLaunch(); };
  const chip = (on: boolean) => `rounded-full border px-3 py-1 text-sm ${on ? "border-amber-400 bg-amber-400 text-neutral-950" : "border-neutral-700 hover:border-neutral-500"}`;
  const tickerCheckList = <>{(p.tickerChecks ?? []).filter((t) => t.warning || t.reserved).map((t) => {
        const coin = p.coins[t.side === "A" ? 0 : 1];
        return (
          <div key={t.side} className="min-w-0 break-words rounded border border-amber-400/40 p-2 text-xs text-amber-200" role="status" data-ticker-check={t.side}>
            {t.reserved ? <p>{many ? `Coin ${t.side}: ` : ""}{RESERVED_TICKER_LINE}</p> : <p>{many ? `Coin ${t.side}: ` : ""}${t.ticker} is in use by <a className="underline" href={t.inUse[0].href}>{t.inUse[0].name}</a>: {t.inUse[0].rule.replace(/\.$/, "")}.{t.inUse.length > 1 ? ` It is also used by ${t.inUse.length - 1} other coin${t.inUse.length === 2 ? "" : "s"}.` : ""} You can keep it, or pick a free one.</p>}
            {t.suggestions.length > 0 && coin && <p className="mt-1 flex flex-wrap items-center gap-2">Free: {t.suggestions.map((s) => <button key={s} type="button" data-decision="name" className="rounded border border-neutral-600 px-2 py-0.5 font-mono" onClick={() => coin.onTicker(s)}>${s}</button>)}</p>}
          </div>
        );
      })}</>;
  const label = p.busy ? "Building…" : p.creator || p.blocked ? (many ? "Launch both" : "Launch") : "Connect wallet";
  const mode = p.mode ?? "full";
  const noteId = "bt-profile-a-note";
  const noteField = p.note && (noteOpen || mode === "name" ? (
    <div className="block text-xs text-neutral-400" data-note-field>
      <label htmlFor={noteId} className="block">{NOTE_LABEL}</label><FieldHelp id="note" />
      <textarea id={noteId} data-help="note" data-optional="note" aria-describedby={`${noteId}-help`} aria-invalid={!!p.note.problem} className="mt-1 w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm" rows={2} maxLength={140} value={p.note.value} onChange={(e) => p.note!.onChange(e.target.value)} />
      <span id={`${noteId}-help`} className="block">{NOTE_HELP} {p.note.value.length} of 140 characters.</span>
      {p.note.problem && <span className="text-red-400" role="alert">{p.note.problem}</span>}
    </div>
  ) : <button type="button" data-optional="note" className="text-xs underline text-neutral-400" onClick={() => setNoteOpen(true)}>add a note</button>);
  // ---- step 4: the name and the look -------------------------------------------------------------------------------------------
  if (mode === "name") return (
    <section className="min-w-0 max-w-full space-y-3 text-sm" aria-label="Name and look" data-name-step>
      <div className={`grid min-w-0 gap-3 ${many ? "md:grid-cols-2" : ""}`} data-review-coins>
        {p.coins.map((c, i) => {
          const who = many ? `Coin ${i === 0 ? "A" : "B"} ` : "";
          const nId = `bt-profile-${c.key}-name`, tId = `bt-profile-${c.key}-ticker`, nErr = nameProblem(c.name) || c.nameIssue || null, tErr = tickerProblem(c.ticker) || c.tickerIssue || null, tNote = tickerNotes[c.key] ?? null;
          return (
            <div key={c.key} className="min-w-0 space-y-2 rounded-lg border border-neutral-800 bg-neutral-900 p-3">
              <div className="bt-preview-frame min-w-0 max-w-full overflow-hidden break-words"><CoinCard href={null} prelaunch c={{ ticker: c.ticker, name: c.name, imageUrl: c.image || null, oneLiner: c.oneLiner, oracle: c.oracle, status: "draft", phase: null, progressPct: null, raised: null, threshold: null, quote: "SOL", burns: 0, lastBurnAt: null, nextAt: null, launchedAt: null, badge: c.badge }} /></div>
              <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_9rem]">
                <div className="min-w-0 text-xs text-neutral-400"><label htmlFor={nId}>{who}Name</label><FieldHelp id="name" /><input id={nId} data-help="name" data-decision="name" aria-invalid={!!nErr} aria-describedby={nErr ? `${nId}-err` : undefined} className="mt-1 w-full min-w-0 rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm" maxLength={NAME_INPUT_MAX} value={c.name} onChange={(e) => c.onName(e.target.value)} />{nErr && <span id={`${nId}-err`} className="mt-0.5 block text-red-400">{nErr}</span>}{!nErr && c.name.length >= NAME_INPUT_MAX && <span className="mt-0.5 block text-amber-300" role="status" data-name-max>{NAME_MAX_LINE}</span>}</div>
                <div className="min-w-0 text-xs text-neutral-400"><label htmlFor={tId}>{who}Ticker</label><FieldHelp id="ticker" /><input id={tId} data-help="ticker" data-decision="name" aria-invalid={!!tErr} aria-describedby={[`${tId}-rule`, tErr ? `${tId}-err` : "", tNote ? `${tId}-note` : ""].filter(Boolean).join(" ")} className="mt-1 w-full min-w-0 rounded border border-neutral-700 bg-neutral-950 px-2 py-1 font-mono text-sm uppercase" maxLength={TICKER_PASTE_MAX} value={c.ticker} onChange={(e) => { const n = tickerNormalised(e.target.value); setTickerNotes((x) => ({ ...x, [c.key]: n.note })); c.onTicker(n.value); }} /><span id={`${tId}-rule`} className="mt-0.5 block text-neutral-500">2 to 10 letters or digits.</span>{tErr && <span id={`${tId}-err`} className="mt-0.5 block text-red-400">{tErr}</span>}{tNote && <span id={`${tId}-note`} className="mt-0.5 block text-amber-300" role="status">{tNote}</span>}</div>
              </div>
            </div>
          );
        })}
      </div>
      {tickerCheckList}
      {p.image}
      <details className="min-w-0 rounded-lg border border-neutral-800 p-3" data-profile-more open={!!p.note?.value}>
        <summary className="cursor-pointer text-sm text-neutral-200">{profileMoreLabel(!!p.note)}</summary>
        {p.note && <p className="mt-2 text-xs text-neutral-400" data-note-vs-description>{NOTE_VS_DESCRIPTION}</p>}
        <div className="mt-2 min-w-0 space-y-3">{p.profile}{noteField}</div>
      </details>
      {fieldProblems.length > 0 && problemList("Not ready yet")}
      {p.next}
    </section>
  );
  return (
    <section className="min-w-0 max-w-full overflow-hidden rounded-xl border border-amber-400/60 bg-neutral-900 p-3 sm:p-4 space-y-3 text-sm" aria-label="Review" data-review-card data-mode={mode}>
      {mode === "review" && p.facts && p.facts.length > 0 && (
        <dl className="min-w-0 divide-y divide-neutral-800 rounded-lg border border-neutral-800" data-review-facts>
          {p.facts.map((f) => (
            <div key={f.label} className="flex min-w-0 items-start justify-between gap-3 px-3 py-2" data-fact={f.label}>
              <div className="min-w-0"><dt className="text-xs text-neutral-500">{f.label}</dt><dd className="break-words text-sm text-neutral-100">{f.value}</dd></div>
              {f.edit && <button type="button" data-nav className="shrink-0 text-xs underline text-neutral-300" aria-label={`Edit: ${f.label.toLowerCase()}`} onClick={f.edit}>Edit</button>}
            </div>
          ))}
        </dl>
      )}
      {/* launch integrity 252: names, tickers, shares, raise, the profile and every other material choice are locked while the launch is
          prepared (busy); the editor latch is untouched, so an open editor stays open, only disabled, until done */}
      <fieldset disabled={p.busy} className="m-0 min-w-0 space-y-3 border-0 p-0" data-review-inputs>
      {/* website-22 (QA 9 item 13, audit 10 item 19): the public profile as it is pinned, every field with its Edit link, full names */}
      {mode === "review" && p.publicProfile && (
        <section className={`grid min-w-0 gap-3 ${many ? "md:grid-cols-2" : ""}`} aria-label="Public profile" data-public-profile>
          {p.publicProfile.coins.map((c) => {
            const edit = (f: ProfileFieldKey, what: string) => <button type="button" data-nav className="shrink-0 text-xs underline text-neutral-300" aria-label={`Edit ${many ? `coin ${c.side.toUpperCase()}'s ` : "the "}${what}`} onClick={() => p.publicProfile!.edit(c.side, f)}>Edit</button>;
            const row = (label: string, value: ReactNode, f: ProfileFieldKey, what: string) => <div className="flex min-w-0 items-start justify-between gap-3 px-3 py-2" data-profile-row={f}><div className="min-w-0"><dt className="text-xs text-neutral-500">{label}</dt><dd className="break-words text-sm text-neutral-100">{value}</dd></div>{edit(f, what)}</div>;
            return (
              <dl key={c.side} className="min-w-0 divide-y divide-neutral-800 rounded-lg border border-neutral-800" data-profile-coin={c.side}>
                <div className="flex min-w-0 items-center gap-3 px-3 py-2">
                  {/* eslint-disable-next-line @next/next/no-img-element -- a local preview (an uploaded file or the generated art) */}
                  <img src={c.image} alt={`The image of $${c.ticker || "TICKER"}`} width={56} height={56} className="h-14 w-14 shrink-0 rounded-md bg-neutral-950 object-cover" data-profile-image />
                  <div className="min-w-0 flex-1"><dt className="text-xs text-neutral-500">Name and ticker</dt><dd className="break-words text-base font-semibold text-neutral-100" data-profile-name>{c.name || "No name yet"} <span className="font-mono text-sm text-neutral-400">${c.ticker || "TICKER"}</span></dd></div>
                  {edit("name", "name and ticker")}
                </div>
                {row("Image", c.image.startsWith("data:") ? "Your image" : "The generated receipt art", "image", "image")}
                {row("Description", c.description.trim() || "None. The coin's page shows the rule sentence only.", "description", "description")}
                {row("Links", c.links.length ? <span className="flex flex-wrap gap-x-3">{c.links.map((l) => <span key={l.label} className="break-all">{l.label}: {l.url}</span>)}</span> : "None", "x", "links")}
                {c.note !== null && row("Note", c.note.trim() || "None", "note", "note")}
              </dl>
            );
          })}
        </section>
      )}
      {!(mode === "review" && p.publicProfile) && <div className={`grid min-w-0 gap-3 ${many ? "md:grid-cols-2" : ""}`}>
        {p.coins.map((c, i) => {
          const who = many ? `Coin ${i === 0 ? "A" : "B"} ` : "";
          const nId = `${uid}-${c.key}-name`, tId = `${uid}-${c.key}-ticker`, nErr = nameProblem(c.name), tErr = tickerProblem(c.ticker), tNote = tickerNotes[c.key] ?? null;
          return (
          <div key={c.key} className="min-w-0 space-y-2">
            {many && <p className="font-mono text-[11px] uppercase tracking-widest text-neutral-500">{who.trim()}</p>}
            <div className="bt-preview-frame min-w-0 max-w-full overflow-hidden break-words"><CoinCard href={null} prelaunch c={{ ticker: c.ticker, name: c.name, imageUrl: c.image || null, oneLiner: c.oneLiner, oracle: c.oracle, status: "draft", phase: null, progressPct: null, raised: null, threshold: null, quote: "SOL", burns: 0, lastBurnAt: null, nextAt: null, launchedAt: null, badge: c.badge }} /></div>
            {mode === "full" && editing ? (
              <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_9rem]">
                <div className="min-w-0 text-xs text-neutral-400"><label htmlFor={nId}>{who}Name</label><FieldHelp id="name" /><input id={nId} data-help="name" data-decision="name" aria-invalid={!!nErr} aria-describedby={nErr ? `${nId}-err` : undefined} className="mt-1 w-full min-w-0 rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm" maxLength={NAME_INPUT_MAX} value={c.name} onChange={(e) => c.onName(e.target.value)} />{nErr && <span id={`${nId}-err`} className="mt-0.5 block text-red-400">{nErr}</span>}{!nErr && c.name.length >= NAME_INPUT_MAX && <span className="mt-0.5 block text-amber-300" role="status" data-name-max>{NAME_MAX_LINE}</span>}</div>
                <div className="min-w-0 text-xs text-neutral-400"><label htmlFor={tId}>{who}Ticker</label><FieldHelp id="ticker" /><input id={tId} data-help="ticker" data-decision="name" aria-invalid={!!tErr} aria-describedby={[tErr ? `${tId}-err` : "", tNote ? `${tId}-note` : ""].filter(Boolean).join(" ") || undefined} className="mt-1 w-full min-w-0 rounded border border-neutral-700 bg-neutral-950 px-2 py-1 font-mono text-sm uppercase" maxLength={TICKER_PASTE_MAX} value={c.ticker} onChange={(e) => { const n = tickerNormalised(e.target.value); setTickerNotes((x) => ({ ...x, [c.key]: n.note })); c.onTicker(n.value); }} />{tErr && <span id={`${tId}-err`} className="mt-0.5 block text-red-400">{tErr}</span>}{tNote && <span id={`${tId}-note`} className="mt-0.5 block text-amber-300" role="status">{tNote}</span>}</div>
              </div>
            ) : null}
          </div>
          );
        })}
      </div>}
      {mode === "full" && tickerCheckList}
      {mode === "full" && <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-400">
        <button type="button" data-decision="name" className="underline disabled:no-underline disabled:opacity-60" aria-expanded={editing} disabled={editing && fieldProblems.length > 0} onClick={() => setEditState(!editState)}>{editing ? (fieldProblems.length ? "Fix the fields above first" : "done") : many ? "edit the names and tickers" : "edit the name or ticker"}</button>
      </div>}
      {mode === "full" && p.namePrompt && <p className="text-xs text-amber-300" role="status">{p.namePrompt}</p>}
      {mode !== "review" && <p className="min-w-0 break-words text-base text-neutral-100" data-summary>{p.sentence}</p>}
      {p.notes && p.notes.length > 0 && <ul className="min-w-0 list-disc space-y-0.5 break-words pl-5 text-xs text-neutral-300" data-review-notes>{p.notes.map((x) => <li key={x}>{x}</li>)}</ul>}
      {p.dispute && !p.event?.stated && <p className="min-w-0 break-words text-xs text-neutral-300" data-dispute>{p.dispute}</p>}
      {p.duplicate}
      {p.event && (
        <div className="min-w-0 break-words rounded border border-neutral-800 p-2 text-xs text-neutral-300" data-event>
          <p>The source states the event as “{p.event.question}”.{p.event.outcome ? ` The coin burns if it resolves ${p.event.outcome}.` : ""}{p.event.resolves ? ` The market is due to close around ${p.event.resolves}.` : ""}{p.event.url && <> <a className="underline" href={p.event.url} rel="noopener" target="_blank">Open the market ↗</a></>}</p>
          {p.event.stated && <p className="mt-1" data-stated>{statedSentences(p.event.stated, p.event.stated.finalAfter)}</p>}
          {p.event.stated?.text && <details className="mt-1 text-neutral-400"><summary className="cursor-pointer">Details</summary><p className="break-words">“{p.event.stated.text}”</p><p>{p.event.stated.finalAfter.ifDisputed}</p></details>}
          {p.event.criteria && <p className="mt-1 whitespace-pre-wrap text-neutral-400">{p.event.criteria.length > 600 ? `${p.event.criteria.slice(0, 600)}… The full rules are on the market page.` : p.event.criteria}</p>}
        </div>
      )}
      {p.pairDiagram && <PairDiagram kind={p.pairDiagram} />}
      {/* website-23 (WIRING-SETTLED-PAIRS): a settled-event pair says its one sentence (review.settled.sentence) above its four facts */}
      {p.pairFacts && p.pairLine && <p className="min-w-0 break-words text-sm text-amber-200" data-pair-line data-settled-line>{p.pairLine}</p>}
      {p.pairFacts ? (mode === "review"
        // website-22 (audit 10 item 24): on the review the four facts sit one tap away; the diagram above says the one thing to know
        ? <details className="min-w-0 text-xs text-neutral-300" data-pair-facts={p.pairFacts.kind}><summary className="cursor-pointer">How the two coins burn</summary><ul className="mt-1 list-disc space-y-0.5 break-words pl-5 text-amber-200" aria-label="How the two coins burn">{pairFactLines(p.pairFacts).map((x) => <li key={x}>{x}</li>)}</ul></details>
        : <ul className="min-w-0 list-disc space-y-0.5 break-words pl-5 text-xs text-amber-200" data-pair-facts={p.pairFacts.kind} aria-label="How the two coins burn">{pairFactLines(p.pairFacts).map((x) => <li key={x}>{x}</li>)}</ul>)
        : p.pairLine && <p className="min-w-0 break-words text-sm text-amber-200" data-pair-line>{p.pairLine} <FieldHelp id="pair-burn" /></p>}
      {p.warnings && p.warnings.length > 0 && <ul className="min-w-0 list-disc space-y-0.5 break-words pl-5 text-xs text-amber-300" aria-label="Source warnings">{p.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
      {p.authority && p.authority.length > 0 && <details className="min-w-0 text-xs text-neutral-300" data-authority><summary className="cursor-pointer">{ELECTION_AUTHORITY_LABEL}</summary>{p.authority.map((x) => <p key={x} className="mt-1 break-words">{x}</p>)}</details>}
      {mode === "review" && !p.facts && p.endSection}
      {/* website-18: the image control stays on the card (one coin, or each side of a pair), above the Advanced disclosure */}
      {mode === "full" && p.image}
      {mode === "full" ? <AdvancedWrap advanced={p.advanced ?? null}>
      {p.profile}
      <div className="flex min-w-0 flex-wrap items-center gap-2" role="radiogroup" aria-label={p.budget?.label ?? BUDGET_LABEL} aria-describedby={`${uid}-budget`}>
        <span className="text-xs text-neutral-500" aria-hidden="true">{p.budget?.label ?? BUDGET_LABEL}</span>
        {/* owner, 2026-10-12: 1, 2 and 5 % on the row; 10 and 25 % behind "More" (open when one of them is chosen) */}
        {mainShares.map((f) => <button key={f} type="button" role="radio" aria-checked={p.shares.value === f} data-optional="preset" className={chip(p.shares.value === f)} onClick={() => p.shares.onChange(f)}>{pctLabel(f)}</button>)}
        {p.shares.options.length > 3 && showMore && p.shares.options.filter((f) => !mainShares.includes(f)).map((f) => <button key={f} type="button" role="radio" aria-checked={p.shares.value === f} data-optional="preset" className={chip(p.shares.value === f)} onClick={() => p.shares.onChange(f)}>{pctLabel(f)}</button>)}
        {/* website-22 (QA 9 item 37): More and Less sit at the end of the row, after every chip */}
        {p.shares.options.length > 3 && <button type="button" data-optional="preset" aria-expanded={showMore} className="text-xs text-neutral-400 underline" onClick={() => setMoreShares(!moreShares)} data-share-more>{showMore ? "Less" : "More"}</button>}
      </div>
      {p.inverse && (
        <div className="flex min-w-0 flex-wrap items-center gap-2" role="radiogroup" aria-label="When the coin burns" data-inverse>
          {p.inverse.options.map((o) => <button key={o.value} type="button" role="radio" aria-checked={p.inverse!.value === o.value} data-optional="preset" className={chip(p.inverse!.value === o.value)} onClick={() => p.inverse!.onChange(o.value)}>{o.label}</button>)}
        </div>
      )}
      <p id={`${uid}-budget`} className="min-w-0 break-words text-xs text-neutral-400" data-budget-line>{p.budget?.line ?? `Each result that fires the rule spends ${pctLabel(p.shares.value)} of the burn pool buying and burning this coin. The token amount bought varies.`} {shareExample(p.shares.value)}</p>
      {p.amountMath && <details className="min-w-0 text-xs text-neutral-400" data-amount-math><summary className="cursor-pointer">{AMOUNT_MATH_LABEL}</summary><p className="mt-1 break-words">{p.amountMath}</p></details>}
      {p.raise && (
        <div className="min-w-0 space-y-1" data-raise>
          <div className="flex min-w-0 flex-wrap items-center gap-2" role="radiogroup" aria-label={RAISE_LABEL} aria-describedby={`${uid}-raise`}>
            <span className="text-xs text-neutral-500" aria-hidden="true">{RAISE_LABEL}</span>
            {p.raise.options.map((x) => <button key={x} type="button" role="radio" aria-checked={p.raise!.value === x} data-optional="preset" className={chip(p.raise!.value === x)} onClick={() => p.raise!.onChange(x)}>{x} SOL</button>)}
          </div>
          <p id={`${uid}-raise`} className="min-w-0 break-words text-xs text-neutral-400" data-raise-line>{RAISE_PRESET_TEXT[p.raise.value]} {RAISE_PRESET_SHARED}</p>
          {p.graduation && p.graduation.length > 0 && (
            <details className="min-w-0 text-xs text-neutral-300" data-graduation>
              <summary className="cursor-pointer text-neutral-300">{GRADUATION_LABEL}</summary>
              {p.graduation.map((x) => <p key={x} className="mt-1 break-words">{x}</p>)}
              <p className="mt-1"><Link className="underline" href="/burnticker/how-burns-settle">How burns are settled</Link></p>
            </details>
          )}
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
      {noteField}
      </AdvancedWrap> : <>
        {p.shareNotice && <p className="min-w-0 break-words text-xs text-amber-300" role="status" data-share-notice>{p.shareNotice}</p>}
        {p.raise && (
          <details className="min-w-0 text-xs text-neutral-300" data-raise>
            <summary className="cursor-pointer">{RAISE_LABEL}{many ? ", the same for both coins" : ""}: {p.raise.value} SOL. Change</summary>
            <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2" role="radiogroup" aria-label={RAISE_LABEL}>{p.raise.options.map((x) => <button key={x} type="button" role="radio" aria-checked={p.raise!.value === x} data-optional="preset" className={chip(p.raise!.value === x)} onClick={() => p.raise!.onChange(x)}>{x} SOL</button>)}</div>
            <p className="mt-1 break-words text-neutral-400" data-raise-line>{RAISE_PRESET_TEXT[p.raise.value]} {RAISE_PRESET_SHARED}</p>
            {p.raise.line && <p className="mt-1 break-words" data-raise-review>{p.raise.line}</p>}
            {p.graduation && p.graduation.length > 0 && <details className="mt-1" data-graduation><summary className="cursor-pointer">{GRADUATION_LABEL}</summary>{p.graduation.map((x) => <p key={x} className="mt-1 break-words">{x}</p>)}</details>}
          </details>
        )}
      </>}
      </fieldset>
      {p.problems.length > 0 && <p className="min-w-0 break-words text-red-400">Can&apos;t launch this rule: {p.problems.join("; ")}</p>}
      {p.error && <p className="min-w-0 break-words text-red-400" role="alert">{p.error}</p>}
      {p.cost && <p className="min-w-0 break-words text-sm text-neutral-200" data-cost-line>{p.cost}{p.costNote && <span className="block text-xs text-neutral-400" data-cost-note>{p.costNote}</span>}</p>}
      <div className="space-y-1 pt-1">
        {fieldProblems.length > 0 && problemList("Not ready to launch", problemsId)}
        {p.blocked && <p id={blockedId} className="min-w-0 break-words text-xs text-amber-300" data-wallet-blocked>{p.blocked}</p>}
        <button ref={launchBtn} type="button" data-decision="launch" className="rounded bg-amber-400 px-5 py-2 text-base font-semibold text-neutral-950 disabled:opacity-40" aria-describedby={[p.blocked ? blockedId : "", fieldProblems.length ? problemsId : ""].filter(Boolean).join(" ") || undefined} disabled={!p.ready || p.busy || p.problems.length > 0 || !!p.blocked || fieldProblems.length > 0} onClick={launch}>{label}</button>
        {!p.creator && !p.blocked && <p className="min-w-0 break-words text-[11px] text-neutral-500" data-connect-note>Connecting shares only your wallet&apos;s public address. The button then becomes Launch, and launching is a separate step that your wallet asks you to sign.</p>}
      </div>
      {/* website-15 item 12 (Claude site audit 3 item 9; ChatGPT repairs 1 and 6): every word is kept, collapsed below the button */}
      <div className="min-w-0 space-y-2 border-t border-neutral-800 pt-2 text-xs" data-review-more>
        {mode === "full" && p.ends && (
          <details className="min-w-0" data-ends>
            <summary className="cursor-pointer text-neutral-300">What the end of the rule means</summary>
            <p className="mt-1 break-words text-neutral-300">{p.ends}</p>
            {!/no end date/.test(p.ends) && <RetirementFacts className="mt-1" open />}
          </details>
        )}
        {p.summary}
        {mode === "review" && p.upfront && p.upfront.length > 0 && <details className="min-w-0 text-neutral-300" data-upfront><summary className="cursor-pointer text-neutral-300">{UPFRONT_LABEL}</summary>{p.upfront.map((x) => <p key={x} className="mt-1 break-words">{x}</p>)}</details>}
        {p.edgeNotes && p.edgeNotes.length > 0 && <details className="min-w-0" data-edge-notes><summary className="cursor-pointer text-neutral-300">Unusual cases for this rule</summary>{p.edgeNotes.map((x) => <p key={x} className="mt-1 break-words text-neutral-400">{x}</p>)}</details>}
        <details className="min-w-0" data-terms open={mode === "review"}>
          <summary className="cursor-pointer text-neutral-300">What you confirm by launching</summary>
          <p className="mt-1 break-words text-neutral-400" data-lp-line>{RECEIPTS_LINE} {lpDisclosure(p.venue ?? (many ? "independent" : "single"))}</p>
          <p className="mt-1 break-words text-neutral-400">{ACK_LINE} <Link className="underline" href="/burnticker/docs">More options: the API</Link></p>
        </details>
      </div>
    </section>
  );
}
