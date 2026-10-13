"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { FieldHelp } from "../_components/FieldHelp";
import { ruleOneLiner } from "@/lib/burnticker/coinCard";
import { ReviewCard } from "./ReviewCard";
import type { BurnRule } from "@/lib/burnticker/rules";
import type { DerbyUnderlying } from "@/lib/burnticker/derby/spec";
import { sha256HexWeb, tileHashInput, tileRule, tileSpec, type TileChoice } from "@/lib/burnticker/derby/tile";
import { postPairLaunch, venueFrom409, type PairVenue } from "@/lib/burnticker/pairLaunchClient";
import type { PairCurveLaunchBundle } from "@/lib/burnticker/pairCurveLaunch";
import { SignCard } from "./SignCard";
import { launchlabPlan, pairCurvePlan } from "@/lib/burnticker/signPlan";
import type { SerializedIx } from "@/lib/burnticker/program";
import { PAIR_REVIEW_LINE, winnerTakesBurnFacts } from "@/lib/burnticker/describe";
import { draftRevision, EMPTY_REVIEW_SLOT, reviewAnswered, reviewFor, reviewMatchesDraft, reviewRequested, REVIEW_UPDATING, type ReviewSlot } from "@/lib/burnticker/launchReviewSync";
import { derbyExplainer } from "@/lib/burnticker/launchDerby";
import { PreWalletSummary } from "./PreWalletSummary";
import type { LaunchReview } from "@/lib/burnticker/launchReview";
import { DEFAULT_RAISE_SOL, DEFAULT_SHARE, RAISE_PRESETS_SOL, SHARE_PRESETS, type RaisePreset } from "@/lib/burnticker/launchPresets";
import { derbyShareLine, endSentences, OTHER_PATTERNS_LABEL, pairIdentityProblems, patternOptions, PATTERNS, IMAGE_NOT_KEPT } from "@/lib/burnticker/guidedLaunch";
import { edgeCase } from "@/lib/burnticker/ruleEdgeCases";
import { createLatest } from "@/lib/burnticker/latestOnly";
import { fingerprintFor, prepareIfCurrent, profileRevision, startFingerprint, STALE_PREPARE_SENTENCE, type Fingerprint } from "@/lib/burnticker/preparedLaunch";
import { deepLinkPick, deepLinkQuery, editedFrom, generatedNames, pickerNote, searchToken, visibleHits, NONE_EDITED, type EditedFields } from "@/lib/burnticker/coinPicker";
import { EMPTY_PROFILE, ProfileFields, chosenPreview, profileBody, profileProblems, type ProfileValue } from "./ProfileFields";
import { describeRule, endText } from "@/lib/burnticker/describe";
import { highText, type HighBaseline, type HighSpan, type HighSpec } from "@/lib/burnticker/derby/high";
import { HIGH_CHOICE_LABEL, HIGH_CHOICE_LINE, HIGH_NEW_DAY, HIGH_PATTERNS, HIGH_PICKER_LABEL, HIGH_PYTH_ONLY, HIGH_READING, HIGH_RUN_NOTE, HIGH_SPAN_CHOICES, HIGH_SPAN_LABEL, PAIR_CHOICE_LABEL, PAIR_CHOICE_LINE, highBlock, highGreyed, highHashInput, highRule, highShares } from "@/lib/burnticker/derby/highTile";
import { LaunchRequestError, launchErrorMessage, type LaunchErrorBody } from "@/lib/burnticker/pairLaunchClient";

/**
 * "COIN VS COIN" — the Burn Derby wizard tile (2026-10-10; cut to presets the same day, the owner: "the UI needs to be simpler, even if it
 * means giving up a little bit of adjustability"). Pick two coins (Pyth's catalogue + Jupiter's token list, through
 * GET /api/burnticker/v1/derby/search) → the review card (ReviewCard.tsx: generated art, names, the sentence, "runs for 30 days, then
 * winds down", 2 / 5 / 10 %) → Launch. Daily windows and a 30-day run are fixed here; weekly windows, other lengths and brackets are
 * API-only (POST /api/burnticker/v1/launch/bundle with a derby rule). The flippening is its own template (?template=flippening), never
 * a checkbox. Launch posts the pair to /api/burnticker/launch — side A on "A wins", side B derived by inversion.
 */

/** The Coin vs Coin draft in sessionStorage, version 1 (intent audit 5 item 19). */
export const CVC_STORE = "burnticker.launch.cvc.v1";
/** `edited`: per field since launch audit 248 (an older draft's single boolean is read by editedFrom); `images`: whether an image was chosen (the image itself is never kept; launch audit 227); `shares`: website-20 item 55, the share per mode */
interface CvcDraft { v: 1; a: Hit | null; b: Hit | null; names: { a: string; b: string; ta: string; tb: string }; fraction: number; shares?: { daily: number; flip: number }; flip: boolean; raiseSol: string; edited: EditedFields | boolean; profA: Partial<ProfileValue>; profB: Partial<ProfileValue>; images?: { a: boolean; b: boolean } }
interface Hit { symbol: string; name: string; source: "pyth" | "jupiter"; assetType: string; feed: string | null; mint: string | null; liquidityUsd: number | null; verified: boolean; underlying: DerbyUnderlying | null; why: string | null }
interface Bundle { mint: string; ticker: string; ready: boolean; pending: string[]; mintSecretKey: string | null; rules: { sha256: string; statement: string }; transactions: { label: string; signers: string[]; instructions: SerializedIx[] }[] }

/**
 * One side's coin search (launch audit 241–246, coinPicker.ts): the other side's coin is excluded by asset, a deep link picks by itself
 * only when one asset answers, a query under 2 characters cancels any search in flight, and the line under the box says what to do next.
 */
function CoinPicker({ label, value, onPick, exclude, initial, locked = false }: { label: string; value: Hit | null; onPick: (h: Hit | null) => void; exclude: Hit | null; initial?: string; /** launch integrity 252: no change while a launch is prepared or signed */ locked?: boolean }) {
  const [q, setQ] = useState(initial ?? ""), [hits, setHits] = useState<Hit[]>([]), [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null), [searched, setSearched] = useState(false);
  const [ambiguous, setAmbiguous] = useState<Hit[]>([]);
  // walkthrough snag 6: a link that names a coin (?derby=1&a=SOL&b=ETH) selects it once its search answers, not only types it
  const autoPicked = useRef(false);
  useEffect(() => {
    if (autoPicked.current || value || !initial) return;
    const r = deepLinkPick(hits, initial, exclude);
    if (r.pick) { autoPicked.current = true; onPick(r.pick); } else setAmbiguous(r.ambiguous);
  }, [hits]); // eslint-disable-line react-hooks/exhaustive-deps
  // intent audit item 12: only the answer to the latest query is shown; a query under 2 characters makes every answer in flight stale
  const latest = useRef(createLatest()).current;
  useEffect(() => {
    const s = q.trim();
    const my = searchToken(latest, q);
    if (my === null) { setHits([]); setBusy(false); setErr(null); setSearched(false); return; }
    setHits([]); setSearched(false);
    const t = setTimeout(() => {
      setBusy(true); setErr(null);
      fetch(`/api/burnticker/v1/derby/search?q=${encodeURIComponent(s)}&assets=all`).then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? r.statusText); if (latest.isCurrent(my)) { setHits(j.hits ?? []); setSearched(true); } }).catch((e) => { if (latest.isCurrent(my)) setErr(String(e.message ?? e)); }).finally(() => { if (latest.isCurrent(my)) setBusy(false); });
    }, 300);
    return () => clearTimeout(t);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps
  if (value) return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-3 text-sm flex items-center justify-between gap-2">
      <div><div className="text-xs text-neutral-400">{label}</div><div className="font-semibold">{value.symbol} <span className="text-xs text-neutral-500 font-normal">{value.source === "pyth" ? "Pyth feed" : "pool TWAP"} · cross-read {value.underlying?.cross.split(":")[0] ?? "—"}</span></div></div>
      {!locked && <button className="text-xs underline" data-decision="what" onClick={() => onPick(null)}>change</button>}
    </div>
  );
  const shown = visibleHits(hits, exclude);
  const note = pickerNote({ query: q, searched, busy, error: err, hits, exclude, ambiguous: q.trim() === (initial ?? "").trim() ? ambiguous : [] });
  return (
    <div className="space-y-2">
      <label className="block text-xs text-neutral-400">{label}<FieldHelp id="derby-coin" /><input data-help="derby-coin" data-decision="what" className="mt-1 w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm" placeholder="a ticker, a name or a mint — WIF, BONK, SHIB…" value={q} onChange={(e) => setQ(e.target.value)} /></label>
      {busy && <p className="text-xs text-neutral-500">Searching…</p>}
      {err && <p className="text-xs text-red-400">{err}</p>}
      {note && <p className="text-xs text-neutral-400" data-picker-note>{note}</p>}
      <ul className="max-h-56 overflow-y-auto divide-y divide-neutral-800 rounded border border-neutral-800">
        {shown.map((h) => (
          <li key={`${h.source}:${h.feed ?? h.mint}`}>
            <button disabled={!h.underlying} data-decision="what" onClick={() => onPick(h)} className={`w-full text-left px-2 py-1.5 text-sm ${h.underlying ? "hover:bg-neutral-900" : "opacity-60 cursor-not-allowed"}`}>
              <span className="font-medium">{h.symbol}</span> <span className="text-xs text-neutral-500">{h.name}</span> <span className="ml-1 rounded bg-neutral-800 px-1.5 text-[10px]">{h.source === "pyth" ? "Pyth" : "Jupiter"}</span>
              {h.why && <span className="block text-[11px] text-neutral-500">{h.why}</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * WIRING-SOURCES4 (website-21): A COIN'S RECORD CLOSE, the tile's other choice (derby/high.ts, derby/highTile.ts). One reference coin
 * (the derby search, Pyth feeds only), how far back its record reaches, every record close or once on the next one, then the server's
 * baseline read (POST /v1/derby/high): its refusal is the review's refusal sentence, its line sits under the rule sentence. The block's
 * season starts on the day the baseline was read (UTC); when the UTC day turns the record is read again (derby/admission.ts refuses an
 * older one). One coin, one LaunchLab launch; the same review, prepare latch and gates as every launch.
 */
function RecordClose({ blocked = null, customImages = true }: { blocked?: string | null; customImages?: boolean }) {
  const wallet = useWallet();
  const creator = wallet.publicKey?.toBase58() ?? "";
  const [ref, setRef] = useState<Hit | null>(null), [span, setSpan] = useState<HighSpan>("all"), [once, setOnce] = useState(false);
  // each pattern keeps its own share (the recurring row defaults to 2 %, the one-time row to 100 %)
  const [shares, setShares] = useState<{ every: number; once: number }>({ every: highShares(false).fallback, once: highShares(true).fallback });
  const fraction = once ? shares.once : shares.every;
  const setFraction = (v: number) => setShares((x) => (once ? { ...x, once: v } : { ...x, every: v }));
  const [raiseSol, setRaiseSol] = useState<RaisePreset>(DEFAULT_RAISE_SOL);
  const [names, setNames] = useState({ name: "", ticker: "" }), [edited, setEdited] = useState({ name: false, ticker: false });
  const [prof, setProf] = useState<ProfileValue>(EMPTY_PROFILE);
  const [now, setNow] = useState(() => Date.now());
  const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  useEffect(() => { const t = setInterval(() => setNow((n) => (utcDay(Date.now()) !== utcDay(n) ? Date.now() : n)), 60_000); return () => clearInterval(t); }, []);
  const today = utcDay(now);
  const [retry, setRetry] = useState(0), [newDay, setNewDay] = useState(false);
  const firstDay = useRef(today); useEffect(() => { if (firstDay.current !== today) { firstDay.current = today; setNewDay(true); } }, [today]);
  const u = ref?.underlying ?? null;
  const noPyth = !!ref && !u?.pyth;
  const baseKey = u && u.pyth ? `${today}|${span}|${JSON.stringify(u)}|${retry}` : "";
  const [base, setBase] = useState<{ key: string; busy: boolean; baseline: HighBaseline | null; line: string | null; refusal: string | null; error: string | null; today: string | null } | null>(null);
  useEffect(() => {
    if (!baseKey || !u) { setBase(null); return; }
    let live = true;
    setBase({ key: baseKey, busy: true, baseline: null, line: null, refusal: null, error: null, today: null });
    fetch("/api/burnticker/v1/derby/high", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ u, span }) })
      .then(async (r) => { const j = await r.json().catch(() => null); if (!r.ok) throw new Error(j?.error ?? `HTTP ${r.status}`); return j as { today: string; baseline?: HighBaseline; line?: string; refusal?: { reason: string } }; })
      .then((j) => { if (live) setBase({ key: baseKey, busy: false, baseline: j.baseline ?? null, line: j.line ?? null, refusal: j.refusal?.reason ?? null, error: null, today: j.today }); })
      .catch((e) => { if (live) setBase({ key: baseKey, busy: false, baseline: null, line: null, refusal: null, error: String((e as Error).message ?? e), today: null }); });
    return () => { live = false; };
  }, [baseKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const block: HighSpec | null = u && base && base.key === baseKey && base.baseline && base.today ? highBlock({ u, span, once, baseline: base.baseline, nowMs: Date.parse(`${base.today}T12:00:00Z`) }) : null;
  const hashIn = block ? highHashInput(block) : null;
  const [hash, setHash] = useState<{ input: string; hex: string } | null>(null);
  useEffect(() => { if (!hashIn) return; let live = true; void sha256HexWeb(hashIn).then((hex) => { if (live) setHash({ input: hashIn, hex }); }); return () => { live = false; }; }, [hashIn]);
  const rule: BurnRule | null = block && hash && hash.input === hashIn ? highRule(block, hash.hex, fraction) : null;
  const gen = block ? highText(block, "") : null;
  useEffect(() => { if (!gen) return; setNames((n) => ({ name: edited.name ? n.name : gen.name, ticker: edited.ticker ? n.ticker : gen.ticker })); }, [gen?.name, gen?.ticker, edited.name, edited.ticker]); // eslint-disable-line react-hooks/exhaustive-deps
  const text = useMemo(() => { if (!rule) return null; try { return describeRule(rule, { ticker: names.ticker.toUpperCase() || "TICKER" }); } catch { return null; } }, [rule, names.ticker]);
  // the review (POST /v1/launch/review), keyed by the draft's revision; Launch prepares only the reviewed draft
  const [slot, setSlot] = useState<ReviewSlot<LaunchReview>>(EMPTY_REVIEW_SLOT);
  const reviewKey = draftRevision([rule, names, raiseSol, prof.description, profileRevision(prof)]);
  const curRev = useRef(reviewKey); curRev.current = reviewKey;
  const seqRef = useRef(0);
  useEffect(() => {
    if (!rule) return;
    const seq = ++seqRef.current, rev = reviewKey;
    setSlot((x) => reviewRequested(x, rev, seq));
    const t = setTimeout(() => {
      fetch("/api/burnticker/v1/launch/review", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rule, ticker: names.ticker.toUpperCase(), name: names.name, raiseSol, creatorDescription: prof.description, links: profileBody(prof).links }) })
        .then(async (r) => { const j = await r.json().catch(() => null); if (!r.ok) throw new Error(r.status === 403 ? "creator launches are closed on this site" : `the review could not be read (HTTP ${r.status})`); return j as LaunchReview; })
        .then((j) => setSlot((x) => reviewAnswered(x, curRev.current, { rev, seq, review: j })))
        .catch((e) => setSlot((x) => reviewAnswered(x, curRev.current, { rev, seq, error: String((e as Error).message) })));
    }, 400);
    return () => clearTimeout(t);
  }, [reviewKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = reviewFor(slot, reviewKey), reviewCurrent = reviewMatchesDraft(slot, reviewKey);
  const [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null), [out, setOut] = useState<{ bundle: Bundle; ticker: string } | null>(null);
  const signPlan = useMemo(() => (out ? launchlabPlan([out.bundle]) : null), [out]);
  const launch = async () => {
    if (!rule || !text || !creator || !reviewMatchesDraft(slot, curRev.current)) return;
    // the UTC day turned since the record was read: read it again for a launch today, then the creator presses Launch again
    if (base?.today && utcDay(Date.now()) !== base.today) { setNow(Date.now()); setErr(HIGH_NEW_DAY); return; }
    setBusy(true); setErr(null); setOut(null);
    const sentRev = curRev.current, ticker = names.ticker.toUpperCase();
    const body = { creator, ticker, name: names.name, description: text.paragraph, note: "", imageUrl: null, rule, firstBuySol: "0", raiseSol, acknowledgements: { ruleLocked: true, noReturns: true }, ...profileBody(prof) };
    try {
      const got = await prepareIfCurrent(sentRev, () => curRev.current, async () => {
        const r = await fetch("/api/burnticker/launch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
        const j = await r.json().catch(() => null);
        if (!r.ok) throw new LaunchRequestError(r.status, j?.code ?? null, launchErrorMessage(r.status, j as LaunchErrorBody | null, r.headers.get("retry-after")));
        return j as { bundle: Bundle };
      });
      if ("stale" in got) { setErr(STALE_PREPARE_SENTENCE); return; }
      setOut({ bundle: got.ok.bundle, ticker });
    } catch (e) { setErr(String((e as Error).message ?? e)); } finally { setBusy(false); }
  };
  const sh = highShares(once);
  const ready = !!rule && /^[A-Z0-9]{2,10}$/.test(names.ticker.toUpperCase()) && !!names.name.trim();
  const greyed = highGreyed(rule);
  return (
    <div className="space-y-3" data-record-close>
      <div className="min-w-0 max-w-md"><CoinPicker label={HIGH_PICKER_LABEL} value={ref} onPick={(h) => { setRef(h); setNewDay(false); }} exclude={null} locked={busy || !!out} /></div>
      {noPyth && <p className="text-xs text-amber-300" role="status" data-high-no-pyth>{HIGH_PYTH_ONLY}</p>}
      <div className="flex min-w-0 flex-wrap items-center gap-2" role="radiogroup" aria-label={HIGH_SPAN_LABEL} data-high-span>
        <span className="text-xs text-neutral-400">{HIGH_SPAN_LABEL}</span>
        {HIGH_SPAN_CHOICES.map((c) => <button key={String(c.span)} type="button" role="radio" aria-checked={span === c.span} data-decision="what" disabled={busy || !!out} onClick={() => setSpan(c.span)} className={`rounded-full border px-3 py-1 text-sm ${span === c.span ? "border-amber-400 bg-amber-400 text-neutral-950" : "border-neutral-700"}`}>{c.label}</button>)}
      </div>
      <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Burn pattern" data-high-patterns>
        {([false, true] as const).map((o) => { const p = o ? HIGH_PATTERNS.once : HIGH_PATTERNS.every; return (
          <button key={String(o)} type="button" role="radio" aria-checked={once === o} data-decision="what" data-pattern={o ? "once" : "every"} disabled={busy || !!out} onClick={() => setOnce(o)} className={`rounded-lg border p-3 text-left text-sm ${once === o ? "border-amber-400 bg-amber-400/10" : "border-neutral-800"}`}>
            <span className="block font-medium">{p.label}</span><span className="mt-0.5 block text-xs text-neutral-300">{p.line}</span>
          </button>
        ); })}
      </div>
      <details className="text-xs text-neutral-400" data-pattern-greyed><summary className="cursor-pointer">{OTHER_PATTERNS_LABEL}</summary>{greyed.map((g) => <p key={g.id} className="mt-1" data-pattern={g.id} data-available="no"><span className="text-neutral-200">{g.label}.</span> {g.reason}</p>)}</details>
      {newDay && <p className="text-xs text-amber-300" role="status" data-high-new-day>{HIGH_NEW_DAY}</p>}
      {base?.busy && <p className="text-xs text-neutral-400" role="status">{HIGH_READING}</p>}
      {base && !base.busy && base.error && <p className="text-xs text-amber-300" role="status" data-high-unread>The daily closes could not be read just now. <button type="button" data-nav className="underline" onClick={() => setRetry((n) => n + 1)}>Retry</button><span className="block break-words font-mono text-neutral-500">{base.error}</span></p>}
      {base && !base.busy && base.refusal && <p className="rounded border border-amber-400/50 p-2 text-sm text-amber-200" role="alert" data-high-refusal>{base.refusal}</p>}
      {rule && text && !out && (
        <ReviewCard
          coins={[{ key: "a", name: names.name, ticker: names.ticker, onName: (v) => { setEdited((e) => ({ ...e, name: true })); setNames((n) => ({ ...n, name: v })); }, onTicker: (v) => { setEdited((e) => ({ ...e, ticker: true })); setNames((n) => ({ ...n, ticker: v })); }, image: prof.image ? chosenPreview(prof)! : art(rule, names.ticker), oneLiner: text.oneLiner, oracle: "derby", badge: text.badge }]}
          sentence={text.lead}
          notes={[...(base?.line ? [base.line] : []), ...(once ? [HIGH_RUN_NOTE] : [])]}
          ends={endText(rule).line}
          shares={{ options: [...sh.options], value: fraction, onChange: setFraction }}
          raise={{ options: [...RAISE_PRESETS_SOL], value: raiseSol, onChange: setRaiseSol, line: shown.review?.raise?.line ?? null }}
          graduation={shown.review?.graduation ?? null}
          image={<ProfileFields value={prof} onChange={setProf} part="image" customImages={customImages} />}
          profile={<ProfileFields value={prof} onChange={setProf} part="text" />}
          profileProblems={profileProblems(prof)}
          problems={reviewCurrent ? shown.review?.problems ?? [] : []}
          error={err}
          busy={busy}
          ready={ready}
          creator={creator || null}
          onLaunch={() => { void launch(); }}
          summary={<PreWalletSummary review={shown.review} loading={shown.loading} error={shown.error} updating={slot.rev !== reviewKey && !!slot.review} />}
          blocked={blocked ?? (reviewCurrent ? null : REVIEW_UPDATING)}
        />
      )}
      {out && signPlan && <SignCard plan={signPlan} creator={creator || null} title={`Launch $${out.ticker}`} coinHref={(t) => `/burnticker/t/${t}`} />}
    </div>
  );
}

/** The generated receipt art for a rule not launched yet (coinArt.ts via /burnticker/img/preview.svg), never "NO IMAGE". */
function art(r: BurnRule | null, tk: string): string {
  const b64u = (x: string) => btoa(unescape(encodeURIComponent(x))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return r ? `/burnticker/img/preview.svg?r=${b64u(JSON.stringify(r))}&t=${encodeURIComponent(tk || "TICKER")}&l=${encodeURIComponent(ruleOneLiner(r).slice(0, 120))}` : "";
}

/**
 * `blocked`: why the wallet cannot open (preview mode, a closed host, pairs off on this host) — the review card disables its button and
 * says so. `unavailable`: Coin vs Coin cannot launch on this host at all (launch audit 5 L02) — the tile says why before any picking.
 */
export function CoinVsCoinTile({ pairCurve = false, blocked = null, unavailable = null, unavailableDetail = null, customImages = true, startOpen = false, entry = null }: { /** website-20 item 60: the link that opened the page (the page drops its parameters from the address once read), so a template or a derby link still lands on what it names */ entry?: { template: string | null; a: string; b: string } | null; pairCurve?: boolean; blocked?: string | null; unavailable?: string | null; /** A2: the blocker behind the one line, in its details */ unavailableDetail?: string | null; /** website-18: the host takes custom images (catalogue customImages) */ customImages?: boolean; /** website-19: the guided path opens it as question 2, with the burn pattern and the end beside the review */ startOpen?: boolean } = {}) {
  const wallet = useWallet();
  const [open, setOpen] = useState(startOpen);
  // WIRING-SOURCES4: two coins racing, or one coin's record close (RecordClose above)
  const [kind, setKind] = useState<"pair" | "high">("pair");
  // `/burnticker/launch?derby=1&a=WIF&b=SHIB` (the Burn Derby page and the search card) opens the tile with both searches filled in.
  const [initial, setInitial] = useState<{ a: string; b: string }>({ a: "", b: "" });
  useEffect(() => {
    // A2: a direct link never opens the tile while Coin vs Coin is unavailable; the greyed tile says why
    if (unavailable) { setOpen(false); return; }
    const u = new URLSearchParams(window.location.search);
    if (u.get("derby") === "1") { setOpen(true); setInitial({ a: deepLinkQuery(u.get("a")), b: deepLinkQuery(u.get("b")) }); }
    else if (entry?.a || entry?.b) { setOpen(true); setInitial({ a: deepLinkQuery(entry.a), b: deepLinkQuery(entry.b) }); }   // website-20 item 60: the page already dropped the address's parameters
    // the templates gallery: coin-vs-coin, bracket (a Coin vs Coin season; the operator registers the bracket) and the flippening
    const tpl = u.get("template") ?? entry?.template ?? null;
    if (tpl === "coin-vs-coin" || tpl === "bracket" || tpl === "flippening") { setOpen(true); if (tpl === "flippening") setFlip(true); }
  }, [unavailable, entry]);
  const [a, setA] = useState<Hit | null>(null), [b, setB] = useState<Hit | null>(null);
  // fixed on the web: daily windows, a 30-day run; the share is a preset (2 / 5 / 10 %, default 2 %); the flippening only via its template
  const window_ = "daily" as const, seasonDays = 30;
  const [flip, setFlip] = useState(false);
  // website-20 item 55: each mode keeps its own share (the daily race 2 % by default, the flippening 100 %), so switching back and forth
  // never resets a choice; the line under the two modes names both
  const [shares, setShares] = useState<{ daily: number; flip: number }>({ daily: DEFAULT_SHARE.recurring, flip: DEFAULT_SHARE.oneShot });
  const fraction = flip ? shares.flip : shares.daily;
  const setFraction = (v: number) => setShares((x) => (flip ? { ...x, flip: v } : { ...x, daily: v }));
  // website-19 (walkthrough snag 2): the raise is picked once and shared by both coins (the review answers null for the pair curve)
  const [raiseSol, setRaiseSol] = useState<RaisePreset>(DEFAULT_RAISE_SOL);
  const [names, setNames] = useState({ a: "", b: "", ta: "", tb: "" });
  // website-18 (the owner: "I also don't see the ability to change the thumbnail pic"): each coin of the pair has its own image, description and links
  const [profA, setProfA] = useState<ProfileValue>(EMPTY_PROFILE), [profB, setProfB] = useState<ProfileValue>(EMPTY_PROFILE);
  // intent audit 5 item 19: the pair draft is kept across a refresh, Back and Resume (versioned; an image is never kept), and cleared by
  // Start over (the page removes CVC_STORE with its own draft)
  const restored = useRef(false);
  // launch audit 227: a restored draft had an image that was not kept; one line beside the image fields says so
  const [imagesDropped, setImagesDropped] = useState(false);
  useEffect(() => {
    if (restored.current) return; restored.current = true;
    const u = new URLSearchParams(window.location.search);
    if (u.get("derby") === "1" || u.get("template") || entry) return;
    let d: CvcDraft | null = null;
    try { d = JSON.parse(sessionStorage.getItem(CVC_STORE) ?? "null") as CvcDraft | null; } catch { d = null; }
    if (!d || d.v !== 1) return;
    if (d.a) setA(d.a); if (d.b) setB(d.b); setNames(d.names); setFlip(!!d.flip); if (d.shares && typeof d.shares.daily === "number" && typeof d.shares.flip === "number") setShares(d.shares); else if (typeof d.fraction === "number") setShares((x) => (d!.flip ? { ...x, flip: d!.fraction } : { ...x, daily: d!.fraction }));
    if (d.raiseSol && (RAISE_PRESETS_SOL as readonly string[]).includes(d.raiseSol)) setRaiseSol(d.raiseSol as RaisePreset);
    setEdited(editedFrom(d.edited));
    setProfA((x) => ({ ...x, ...d!.profA })); setProfB((x) => ({ ...x, ...d!.profB }));
    if (d.images?.a || d.images?.b) setImagesDropped(true);
  }, []);
  // launch integrity 251: the fingerprint is held with the input it was computed for (preparedLaunch.ts)
  const [fp, setFp] = useState<Fingerprint | null>(null);
  const hashLatest = useRef(createLatest()).current;
  // launch integrity 252: the prepared set carries the tickers it was prepared with; the signing card never reads the form again
  const [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null), [out, setOut] = useState<{ pairId: string; a: Bundle; b: Bundle; notes: string[]; tickers: { a: string; b: string } } | null>(null);
  const creator = wallet.publicKey?.toBase58() ?? "";
  // WIRING-SEMANTICS item 72: `now` is re-read whenever the UTC day turns (checked each minute, and again right before Launch), so a
  // draft that crosses 00:00 UTC is rebuilt and re-hashed for the new first day instead of being refused at launch
  const [now, setNow] = useState(() => Date.now());
  const utcDay = (ms: number) => Math.floor(ms / 86_400_000);
  useEffect(() => { const t = setInterval(() => setNow((n) => (utcDay(Date.now()) !== utcDay(n) ? Date.now() : n)), 60_000); return () => clearInterval(t); }, []);
  // WIRING-SEMANTICS item 96: names, images and words the creator typed stay with the side when the picked coins change; say so once
  const [picksMoved, setPicksMoved] = useState(false);
  const picksKey = useRef<string | null>(null);
  // website-19 (owner, 2026-10-12: "two teamwifs"): both sides are named by the matchup ($WIFVBONK and $BONKVWIF; "WIF vs BONK, WIF side"),
  // generated until the creator types their own
  // launch audit 248: each name and ticker is tracked on its own, so typing coin A's name never freezes coin B's generated names
  const [edited, setEdited] = useState<EditedFields>(NONE_EDITED);
  useEffect(() => { const k = `${a?.symbol ?? ""}|${b?.symbol ?? ""}`; if (picksKey.current !== null && picksKey.current !== k && Object.values(edited).some(Boolean)) setPicksMoved(true); picksKey.current = k; }, [a, b]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setNames((n) => generatedNames(a, b, n, edited)); }, [a, b, edited]);
  useEffect(() => {
    if (!restored.current || (!a && !b)) return;
    const words = (p: ProfileValue) => ({ description: p.description, x: p.x, telegram: p.telegram, website: p.website });
    const d: CvcDraft = { v: 1, a, b, names, fraction, shares, flip, raiseSol, edited, profA: words(profA), profB: words(profB), images: { a: !!profA.image, b: !!profB.image } };
    try { sessionStorage.setItem(CVC_STORE, JSON.stringify(d)); } catch { /* private mode */ }
  }, [a, b, names, fraction, shares, flip, raiseSol, edited, profA, profB]);
  const choice: TileChoice | null = a?.underlying && b?.underlying ? { a: a.underlying, b: b.underlying, window: window_, seasonDays, flip, fraction, now } : null;
  useEffect(() => { if (choice) void startFingerprint(hashLatest, tileHashInput(choice), sha256HexWeb, setFp); else { hashLatest.cancel(); setFp(null); } }, [a, b, flip, fraction]); // eslint-disable-line react-hooks/exhaustive-deps
  const hash = choice ? fingerprintFor(fp, tileHashInput(choice)) : null;
  const model = choice && hash ? tileRule(choice, hash, { a: names.ta.toUpperCase(), b: names.tb.toUpperCase() }) : null;
  const ruleB: BurnRule | null = model?.rule ? { ...model.rule, binary: { onYes: null, onNo: model.rule.binary!.onYes } } : null;
  // L13: the start boundary too, in UTC (the windows' clock) — the facts list above adds Denver time
  const ends = choice ? (() => { const s = tileSpec(choice).season; const start = new Date(`${s.start}T00:00:00Z`), end = new Date(Date.parse(`${s.start}T00:00:00Z`) + s.days * 86_400_000); const d = (x: Date) => x.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }); return `The windows run from ${d(start)} 00:00 UTC to ${d(end)} 00:00 UTC, which is ${s.days} daily windows. Then each coin's own burn pool burns down over 28 days and the coins retire.`; })() : null;

  // review N6: the venue this host uses for a pair (catalogue venues.pairCurve, passed down by the page). The venue is not shown before
  // launch (the owner's cut list); a 409 naming the other venue switches it and the build is retried once.
  const [venue, setVenue] = useState<PairVenue>(pairCurve ? "pair-curve" : "launchlab");
  useEffect(() => { setVenue(pairCurve ? "pair-curve" : "launchlab"); }, [pairCurve]);
  const [pcOut, setPcOut] = useState<{ pairId: string; pc: PairCurveLaunchBundle; keys: { a: string; b: string } | null; notes: string[]; tickers: { a: string; b: string } } | null>(null);
  const prepared = pcOut ?? out;
  const launch = async () => {
    if (!model?.rule || !creator || !reviewMatchesDraft(slot, curRev.current)) return;   // A6: only the reviewed draft is prepared
    // item 72: the UTC day turned since this draft was built: rebuild it for the new first day, and the creator presses Launch again
    if (utcDay(Date.now()) !== utcDay(now)) { setNow(Date.now()); setErr(edgeCase(72)); return; }
    setBusy(true); setErr(null); setOut(null); setPcOut(null);
    const sentRev = prepRev.current;
    const body = { creator, ticker: names.ta.toUpperCase(), name: names.a, description: model.sentence, imageUrl: null, rule: model.rule, firstBuySol: "0", raiseSol, acknowledgements: { ruleLocked: true, noReturns: true }, ...profileBody(profA), pair: { ticker: names.tb.toUpperCase(), name: names.b, description: model.sentence, imageUrl: null, ...profileBody(profB) } };
    // launch audit 249: a 409 naming the other venue switches the venue and says so; the creator presses again after the review is
    // read again for the new terms (the venue is part of reviewKey), never a silent rebuild on the other venue
    const run = async (v: PairVenue): Promise<void> => {
      try {
        // launch integrity 252: an answer for a draft that changed while it was prepared is set aside: no plan, no wallet, a fresh review
        const got = await prepareIfCurrent(sentRev, () => prepRev.current, () => postPairLaunch((u, init) => fetch(u, init), body, v));
        if ("stale" in got) { setErr(STALE_PREPARE_SENTENCE); return; }
        const j = got.ok, tickers = { a: body.ticker, b: body.pair.ticker };
        if (j.venue === "pair-curve") setPcOut({ pairId: j.pair.pairId, pc: j.pairCurve, keys: j.mintSecretKeys, notes: j.pair.notes ?? [], tickers });
        else setOut({ pairId: j.pair.pairId, a: j.bundles.a as Bundle, b: j.bundles.b as Bundle, notes: j.pair.notes ?? [], tickers });
      } catch (e) { const nv = venueFrom409(e); if (nv) setVenue(nv); setErr(String((e as Error).message ?? e)); }
    };
    try { await run(venue); } finally { setBusy(false); }
  };

  // L06 / L13: the read-only review payload for the pair (the server's numbers), debounced; the pair's side B rule is derived at build
  // A6: keyed by the draft's revision (launchReviewSync.ts): a summary for an older pick or older names is never shown
  const [slot, setSlot] = useState<ReviewSlot<LaunchReview>>(EMPTY_REVIEW_SLOT);
  const reviewKey = draftRevision([model?.rule ?? null, names, profA.description, profB.description, raiseSol, venue]);
  const curRev = useRef(reviewKey); curRev.current = reviewKey;
  // launch integrity 252: everything the launch body carries, so a change during preparation (a profile link, an image) is seen too
  const prepRev = useRef(""); prepRev.current = draftRevision([reviewKey, fraction, flip, profileRevision(profA), profileRevision(profB)]);
  // the signing plan is built once from the prepared answer (its tickers included) and never from the form
  const signPlan = useMemo(() => (pcOut ? pairCurvePlan(pcOut.pc, pcOut.keys, pcOut.tickers) : out ? launchlabPlan([out.a, out.b]) : null), [pcOut, out]);
  const seqRef = useRef(0);
  useEffect(() => {
    if (!model?.rule) return;
    const seq = ++seqRef.current, rev = reviewKey;
    setSlot((x) => reviewRequested(x, rev, seq));
    const t = setTimeout(() => {
      fetch("/api/burnticker/v1/launch/review", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rule: model.rule, ticker: names.ta.toUpperCase(), name: names.a, raiseSol, creatorDescription: profA.description, pair: { ticker: names.tb.toUpperCase(), name: names.b, creatorDescription: profB.description } }) })
        .then(async (r) => { const j = await r.json().catch(() => null); if (!r.ok) throw new Error(r.status === 403 ? "creator launches are closed on this site" : `the review could not be read (HTTP ${r.status})`); return j as LaunchReview; })
        .then((j) => setSlot((x) => reviewAnswered(x, curRev.current, { rev, seq, review: j })))
        .catch((e) => setSlot((x) => reviewAnswered(x, curRev.current, { rev, seq, error: String((e as Error).message) })));
    }, 400);
    return () => clearTimeout(t);
  }, [reviewKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = reviewFor(slot, reviewKey), reviewCurrent = reviewMatchesDraft(slot, reviewKey);

  const tileButton = (
    <button onClick={() => setOpen(true)} data-decision="what" disabled={!!unavailable} aria-describedby={unavailable ? "cvc-why" : undefined} className="w-full text-left rounded-xl border border-neutral-800 bg-neutral-900 p-5 disabled:cursor-not-allowed hover:border-amber-400 focus:border-amber-400 focus:outline-none disabled:opacity-50" aria-label="Coin vs Coin">
      <div className="text-lg font-semibold">Coin vs Coin <span className="ml-1 rounded bg-amber-400/15 px-1.5 text-xs text-amber-300 align-middle">Burn Derby</span></div>
      <p className="mt-1 text-sm text-neutral-300">Pick two coins that people already hold. Burnticker only reads their published feeds. You launch two new coins that race on those feeds every day, and the new coin on the winning side burns.</p>
      <p className="mt-3 text-xs text-neutral-500">For example, $TEAMWIF burns on every UTC day that WIF gains more than SHIB, read from Pyth at 00:00 UTC.</p>
    </button>
  );
  const tile = unavailable ? (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900" data-tile="derby" data-unavailable="">
      {tileButton}
      <div className="px-5 pb-4">{unavailableDetail ? <details id="cvc-why" className="text-xs text-amber-300" data-pairs-blocked><summary className="cursor-pointer">{unavailable}</summary><p className="mt-1 text-neutral-400">{unavailableDetail}</p></details> : <p id="cvc-why" className="text-xs text-amber-300">{unavailable}</p>}</div>
    </div>
  ) : tileButton;
  if (!open || unavailable) return tile;
  const kindChoice = (
    <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="What the coins follow" data-derby-kind>
      {(["pair", "high"] as const).map((k) => (
        <button key={k} type="button" role="radio" aria-checked={kind === k} data-decision="what" data-derby-kind-choice={k} disabled={busy || !!prepared} onClick={() => setKind(k)} className={`rounded-lg border p-3 text-left text-sm ${kind === k ? "border-amber-400 bg-amber-400/10" : "border-neutral-800"}`}>
          <span className="block font-medium">{k === "pair" ? PAIR_CHOICE_LABEL : HIGH_CHOICE_LABEL}</span><span className="mt-0.5 block text-xs text-neutral-300">{k === "pair" ? PAIR_CHOICE_LINE : HIGH_CHOICE_LINE}</span>
        </button>
      ))}
    </div>
  );
  if (kind === "high") return (
    <section className="rounded-xl border border-amber-400/60 bg-neutral-900 p-4 space-y-4 sm:col-span-2" aria-label={HIGH_CHOICE_LABEL}>
      <div className="flex items-center justify-between"><h3 className="text-lg font-semibold">{HIGH_CHOICE_LABEL}</h3>{!startOpen && <button className="text-xs underline" data-nav onClick={() => setOpen(false)}>close</button>}</div>
      {kindChoice}
      <RecordClose blocked={blocked} customImages={customImages} />
    </section>
  );
  // intent audit item 5: the two sides must be told apart (ticker and name, any case or spacing)
  const identity = pairIdentityProblems({ ticker: names.ta, name: names.a }, { ticker: names.tb, name: names.b });
  const ready = !!model?.rule && !model.problems.length && /^[A-Z0-9]{2,10}$/.test(names.ta) && /^[A-Z0-9]{2,10}$/.test(names.tb) && identity.length === 0 && !!names.a.trim() && !!names.b.trim();
  // website-19: the burn pattern (each day's winner, or once: the flippening) and the end, read from the rule
  const po = patternOptions({ follow: "coins", rule: model?.rule ?? null });
  const end = model?.rule ? endSentences(model.rule) : null;
  return (
    <section className="rounded-xl border border-amber-400/60 bg-neutral-900 p-4 space-y-4 sm:col-span-2" aria-label="Coin vs Coin">
      <div className="flex items-center justify-between"><h3 className="text-lg font-semibold">{flip ? "Flippening" : "Coin vs Coin"}</h3><span className="flex gap-3 text-xs"><a className="underline" href="/burnticker/derby">Burn Derby pairs and brackets →</a>{!(out || pcOut) && <button className="underline" data-nav onClick={() => setOpen(false)}>close</button>}</span></div>
      {kindChoice}
      {startOpen && (
        <div className="space-y-2" data-guided-derby>
          <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Burn pattern">
            {po.options.filter((o) => o.id === "winner" || o.id === "once").map((o) => { const on = o.id === "once" ? flip : !flip; return (
              <button key={o.id} type="button" role="radio" aria-checked={on} data-decision="what" data-pattern={o.id} onClick={() => setFlip(o.id === "once")} className={`rounded-lg border p-3 text-left text-sm ${on ? "border-amber-400 bg-amber-400/10" : "border-neutral-800"}`}>
                <span className="block font-medium">{o.id === "once" ? "Once: the flippening" : PATTERNS.winner.label}</span>
                <span className="mt-0.5 block text-xs text-neutral-300">{o.id === "once" ? "Read once a day at 00:00 UTC for 30 days. The first day coin A's value is above coin B's, coin A's rule fires once. If that day never comes, coin B's rule fires once at the end of the run." : "Read once a day at 00:00 UTC for 30 days. Each day, the coin whose reference gained more fires its rule, and the other coin's share for that day moves to its burn pool."}</span>
              </button>
            ); })}
          </div>
          <p className="text-xs text-neutral-300" data-share-memory>{derbyShareLine(shares.daily, shares.flip)}</p>
          <details className="text-xs text-neutral-400" data-pattern-greyed><summary className="cursor-pointer">{OTHER_PATTERNS_LABEL}</summary>{po.options.filter((o) => !o.available).map((o) => <p key={o.id} className="mt-1"><span className="text-neutral-200">{o.label}.</span> {o.reason}</p>)}</details>
          {end && <div className="space-y-0.5 text-xs text-neutral-300" data-end-sentences><p className="font-medium text-neutral-200">At the end</p>{end.sentences.map((x) => <p key={x}>{x}</p>)}</div>}
        </div>
      )}
      <p className="text-xs text-neutral-300" data-derby-explainer>The two coins you pick are <b>reference feeds</b>. Burnticker only reads their published feeds and never trades or burns them. Launching creates two <b>new</b> coins, and their own trading fees pay for their burns.</p>
      <div className="grid min-w-0 gap-3 md:grid-cols-2">
        <CoinPicker key={`a-${initial.a}`} initial={initial.a} label={flip ? "Reference coin A, the one that may pass the other" : "Reference coin A"} value={a} onPick={setA} exclude={b} locked={busy || !!prepared} />
        <CoinPicker key={`b-${initial.b}`} initial={initial.b} label={flip ? "Reference coin B, the one that may be passed" : "Reference coin B"} value={b} onPick={setB} exclude={a} locked={busy || !!prepared} />
      </div>
      <p className="text-[11px] text-neutral-500" data-same-coin>{edgeCase(74)}</p>
      {picksMoved && <p className="text-xs text-amber-300" role="status" data-picks-moved>{edgeCase(96)}</p>}
      {model && !out && !pcOut && (() => { const x = derbyExplainer(model.spec, { a: names.ta.toUpperCase(), b: names.tb.toUpperCase() }); return (
        <ul className="min-w-0 list-disc space-y-0.5 break-words pl-5 text-xs text-neutral-300" aria-label="What this creates" data-derby-facts>
          <li>{x.references}</li><li>{x.created}</li><li>{x.window}</li><li>{x.start}</li><li>{x.end}</li><li>{x.tie} {edgeCase(69)}</li><li>{x.missing} {edgeCase(87)}</li>
          {flip && <li>{edgeCase(66)}</li>}{flip && <li>{edgeCase(70)}</li>}<li>{edgeCase(72)}</li><li>{edgeCase(62)}</li>
        </ul>
      ); })()}
      {model && !out && !pcOut && (
        <ReviewCard
          coins={[
            { key: "a", name: names.a, ticker: names.ta, onName: (v) => { setEdited((e) => ({ ...e, a: true })); setNames((n) => ({ ...n, a: v })); }, onTicker: (v) => { setEdited((e) => ({ ...e, ta: true })); setNames((n) => ({ ...n, ta: v })); }, image: profA.image ? chosenPreview(profA)! : art(model.rule, names.ta), oneLiner: model.rule ? ruleOneLiner(model.rule) : "", oracle: "derby", badge: null },
            { key: "b", name: names.b, ticker: names.tb, onName: (v) => { setEdited((e) => ({ ...e, b: true })); setNames((n) => ({ ...n, b: v })); }, onTicker: (v) => { setEdited((e) => ({ ...e, tb: true })); setNames((n) => ({ ...n, tb: v })); }, image: profB.image ? chosenPreview(profB)! : art(ruleB, names.tb), oneLiner: ruleB ? ruleOneLiner(ruleB) : "", oracle: "derby", badge: null },
          ]}
          sentence={model.sentence}
          pairLine={PAIR_REVIEW_LINE}
          pairFacts={winnerTakesBurnFacts(names.ta.toUpperCase() || "A", names.tb.toUpperCase() || "B")}
          ends={ends}
          shares={{ options: [...(flip ? SHARE_PRESETS.oneShot : SHARE_PRESETS.recurring)], value: fraction, onChange: setFraction }}
          raise={shown.review?.raise ? { options: [...RAISE_PRESETS_SOL], value: raiseSol, onChange: setRaiseSol, line: shown.review.raise.line } : null}
          graduation={shown.review?.graduation ?? null}
          image={<div className="grid min-w-0 gap-2 md:grid-cols-2" data-pair-images>{imagesDropped && !profA.image && !profB.image && <p className="text-xs text-amber-300 md:col-span-2" data-image-not-kept>{IMAGE_NOT_KEPT}</p>}<ProfileFields value={profA} onChange={setProfA} part="image" who={`$${names.ta.toUpperCase() || "A"}`} customImages={customImages} /><ProfileFields value={profB} onChange={setProfB} part="image" who={`$${names.tb.toUpperCase() || "B"}`} customImages={customImages} pasteTarget={false} /></div>}
          profile={<div className="grid min-w-0 gap-2 md:grid-cols-2"><ProfileFields value={profA} onChange={setProfA} part="text" who={`$${names.ta.toUpperCase() || "A"}`} /><ProfileFields value={profB} onChange={setProfB} part="text" who={`$${names.tb.toUpperCase() || "B"}`} /></div>}
          profileProblems={[...profileProblems(profA).map((x) => `$${names.ta.toUpperCase() || "A"}: ${x}`), ...profileProblems(profB).map((x) => `$${names.tb.toUpperCase() || "B"}: ${x}`), ...identity]}
          problems={model.problems}
          error={err}
          busy={busy}
          ready={ready}
          creator={creator || null}
          onLaunch={() => { void launch(); }}
          summary={<PreWalletSummary review={shown.review} loading={shown.loading} error={shown.error} updating={slot.rev !== reviewKey && !!slot.review} />}
          blocked={blocked ?? (reviewCurrent ? null : REVIEW_UPDATING)}
        />
      )}
      {prepared && signPlan && <SignCard plan={signPlan} creator={creator || null} title={`Launch $${prepared.tickers.a} and $${prepared.tickers.b}`} coinHref={(t) => `/burnticker/t/${t}`} />}
      {(pcOut || out) && <p className="text-xs"><a className="underline" href={`/burnticker/p/${(pcOut ?? out)!.pairId}`}>Open the pair page →</a></p>}
    </section>
  );
}
