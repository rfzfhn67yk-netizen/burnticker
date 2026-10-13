"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { FieldHelp } from "../_components/FieldHelp";
import { ruleOneLiner } from "@/lib/burnticker/coinCard";
import { ReviewCard } from "./ReviewCard";
import type { BurnRule } from "@/lib/burnticker/rules";
import type { DerbyUnderlying } from "@/lib/burnticker/derby/spec";
import { defaultName, defaultTicker, sha256HexWeb, tileHashInput, tileRule, tileSpec, type TileChoice } from "@/lib/burnticker/derby/tile";
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
import { endSentences, pairIdentityProblems, pairNames, pairTickers, patternOptions, PATTERNS } from "@/lib/burnticker/guidedLaunch";
import { EMPTY_PROFILE, ProfileFields, chosenPreview, profileBody, profileProblems, type ProfileValue } from "./ProfileFields";

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
interface CvcDraft { v: 1; a: Hit | null; b: Hit | null; names: { a: string; b: string; ta: string; tb: string }; fraction: number; flip: boolean; raiseSol: string; edited: boolean; profA: Partial<ProfileValue>; profB: Partial<ProfileValue> }
interface Hit { symbol: string; name: string; source: "pyth" | "jupiter"; assetType: string; feed: string | null; mint: string | null; liquidityUsd: number | null; verified: boolean; underlying: DerbyUnderlying | null; why: string | null }
interface Bundle { mint: string; ticker: string; ready: boolean; pending: string[]; mintSecretKey: string | null; rules: { sha256: string; statement: string }; transactions: { label: string; signers: string[]; instructions: SerializedIx[] }[] }

function CoinPicker({ label, value, onPick, exclude, initial }: { label: string; value: Hit | null; onPick: (h: Hit | null) => void; exclude: string | null; initial?: string }) {
  const [q, setQ] = useState(initial ?? ""), [hits, setHits] = useState<Hit[]>([]), [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null);
  // walkthrough snag 6: a link that names a coin (?derby=1&a=SOL&b=ETH) selects it once its search answers, not only types it
  const autoPicked = useRef(false);
  useEffect(() => { if (autoPicked.current || value || !initial) return; const h = hits.find((x) => x.symbol.toUpperCase() === initial.toUpperCase() && !!x.underlying); if (h) { autoPicked.current = true; onPick(h); } }, [hits]); // eslint-disable-line react-hooks/exhaustive-deps
  // intent audit item 12: only the answer to the latest query is shown (a sequence number drops a slow answer to an older one)
  const seq = useRef(0);
  useEffect(() => {
    const s = q.trim();
    if (s.length < 2) { setHits([]); return; }
    const my = ++seq.current;
    setHits([]);
    const t = setTimeout(() => {
      setBusy(true); setErr(null);
      fetch(`/api/burnticker/v1/derby/search?q=${encodeURIComponent(s)}&assets=all`).then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? r.statusText); if (my === seq.current) setHits(j.hits ?? []); }).catch((e) => { if (my === seq.current) setErr(String(e.message ?? e)); }).finally(() => { if (my === seq.current) setBusy(false); });
    }, 300);
    return () => clearTimeout(t);
  }, [q]);
  if (value) return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-3 text-sm flex items-center justify-between gap-2">
      <div><div className="text-xs text-neutral-400">{label}</div><div className="font-semibold">{value.symbol} <span className="text-xs text-neutral-500 font-normal">{value.source === "pyth" ? "Pyth feed" : "pool TWAP"} · cross-read {value.underlying?.cross.split(":")[0] ?? "—"}</span></div></div>
      <button className="text-xs underline" data-decision="what" onClick={() => onPick(null)}>change</button>
    </div>
  );
  return (
    <div className="space-y-2">
      <label className="block text-xs text-neutral-400">{label}<FieldHelp id="derby-coin" /><input data-help="derby-coin" data-decision="what" className="mt-1 w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm" placeholder="a ticker, a name or a mint — WIF, BONK, SHIB…" value={q} onChange={(e) => setQ(e.target.value)} /></label>
      {busy && <p className="text-xs text-neutral-500">Searching…</p>}
      {err && <p className="text-xs text-red-400">{err}</p>}
      <ul className="max-h-56 overflow-y-auto divide-y divide-neutral-800 rounded border border-neutral-800">
        {hits.filter((h) => h.symbol !== exclude).map((h) => (
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
 * `blocked`: why the wallet cannot open (preview mode, a closed host, pairs off on this host) — the review card disables its button and
 * says so. `unavailable`: Coin vs Coin cannot launch on this host at all (launch audit 5 L02) — the tile says why before any picking.
 */
export function CoinVsCoinTile({ pairCurve = false, blocked = null, unavailable = null, unavailableDetail = null, customImages = true, startOpen = false }: { pairCurve?: boolean; blocked?: string | null; unavailable?: string | null; /** A2: the blocker behind the one line, in its details */ unavailableDetail?: string | null; /** website-18: the host takes custom images (catalogue customImages) */ customImages?: boolean; /** website-19: the guided path opens it as question 2, with the burn pattern and the end beside the review */ startOpen?: boolean } = {}) {
  const wallet = useWallet();
  const [open, setOpen] = useState(startOpen);
  // `/burnticker/launch?derby=1&a=WIF&b=SHIB` (the Burn Derby page and the search card) opens the tile with both searches filled in.
  const [initial, setInitial] = useState<{ a: string; b: string }>({ a: "", b: "" });
  useEffect(() => {
    // A2: a direct link never opens the tile while Coin vs Coin is unavailable; the greyed tile says why
    if (unavailable) { setOpen(false); return; }
    const u = new URLSearchParams(window.location.search);
    if (u.get("derby") === "1") { setOpen(true); setInitial({ a: (u.get("a") ?? "").slice(0, 12), b: (u.get("b") ?? "").slice(0, 12) }); }
    // the templates gallery: coin-vs-coin, bracket (a Coin vs Coin season; the operator registers the bracket) and the flippening
    const tpl = u.get("template");
    if (tpl === "coin-vs-coin" || tpl === "bracket" || tpl === "flippening") { setOpen(true); if (tpl === "flippening") setFlip(true); }
  }, [unavailable]);
  const [a, setA] = useState<Hit | null>(null), [b, setB] = useState<Hit | null>(null);
  // fixed on the web: daily windows, a 30-day run; the share is a preset (2 / 5 / 10 %, default 2 %); the flippening only via its template
  const window_ = "daily" as const, seasonDays = 30;
  const [flip, setFlip] = useState(false), [fraction, setFraction] = useState<number>(DEFAULT_SHARE.recurring);
  // website-19 (walkthrough snag 2): the raise is picked once and shared by both coins (the review answers null for the pair curve)
  const [raiseSol, setRaiseSol] = useState<RaisePreset>(DEFAULT_RAISE_SOL);
  // the flippening resolves once: the one-shot presets (100 or 50 %); the daily race keeps the recurring ones
  useEffect(() => { setFraction(flip ? DEFAULT_SHARE.oneShot : DEFAULT_SHARE.recurring); }, [flip]);
  const [names, setNames] = useState({ a: "", b: "", ta: "", tb: "" });
  // website-18 (the owner: "I also don't see the ability to change the thumbnail pic"): each coin of the pair has its own image, description and links
  const [profA, setProfA] = useState<ProfileValue>(EMPTY_PROFILE), [profB, setProfB] = useState<ProfileValue>(EMPTY_PROFILE);
  // intent audit 5 item 19: the pair draft is kept across a refresh, Back and Resume (versioned; an image is never kept), and cleared by
  // Start over (the page removes CVC_STORE with its own draft)
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return; restored.current = true;
    const u = new URLSearchParams(window.location.search);
    if (u.get("derby") === "1" || u.get("template")) return;
    let d: CvcDraft | null = null;
    try { d = JSON.parse(sessionStorage.getItem(CVC_STORE) ?? "null") as CvcDraft | null; } catch { d = null; }
    if (!d || d.v !== 1) return;
    if (d.a) setA(d.a); if (d.b) setB(d.b); setNames(d.names); setFlip(!!d.flip); if (typeof d.fraction === "number") setTimeout(() => setFraction(d!.fraction), 0);
    if (d.raiseSol && (RAISE_PRESETS_SOL as readonly string[]).includes(d.raiseSol)) setRaiseSol(d.raiseSol as RaisePreset);
    setEdited(!!d.edited);
    setProfA((x) => ({ ...x, ...d!.profA })); setProfB((x) => ({ ...x, ...d!.profB }));
  }, []);
  const [hash, setHash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null), [out, setOut] = useState<{ pairId: string; a: Bundle; b: Bundle; notes: string[] } | null>(null);
  const creator = wallet.publicKey?.toBase58() ?? "";
  const now = useMemo(() => Date.now(), []);
  // website-19 (owner, 2026-10-12: "two teamwifs"): both sides are named by the matchup ($WIFVBONK and $BONKVWIF; "WIF vs BONK, WIF side"),
  // generated until the creator types their own
  const [edited, setEdited] = useState(false);
  useEffect(() => {
    if (edited) return;
    if (a && b) { const t = pairTickers(a.symbol, b.symbol), n = pairNames(a.symbol, b.symbol); setNames({ a: n.a, b: n.b, ta: t.a, tb: t.b }); }
    else { if (a) setNames((n) => ({ ...n, a: n.a || defaultName(a.symbol), ta: n.ta || defaultTicker(a.symbol) })); if (b) setNames((n) => ({ ...n, b: n.b || defaultName(b.symbol), tb: n.tb || defaultTicker(b.symbol) })); }
  }, [a, b, edited]);
  useEffect(() => {
    if (!restored.current || (!a && !b)) return;
    const words = (p: ProfileValue) => ({ description: p.description, x: p.x, telegram: p.telegram, website: p.website });
    const d: CvcDraft = { v: 1, a, b, names, fraction, flip, raiseSol, edited, profA: words(profA), profB: words(profB) };
    try { sessionStorage.setItem(CVC_STORE, JSON.stringify(d)); } catch { /* private mode */ }
  }, [a, b, names, fraction, flip, raiseSol, edited, profA, profB]);
  const choice: TileChoice | null = a?.underlying && b?.underlying ? { a: a.underlying, b: b.underlying, window: window_, seasonDays, flip, fraction, now } : null;
  useEffect(() => { setHash(null); if (choice) sha256HexWeb(tileHashInput(choice)).then(setHash).catch(() => setHash(null)); }, [a, b, flip, fraction]); // eslint-disable-line react-hooks/exhaustive-deps
  const model = choice && hash ? tileRule(choice, hash, { a: names.ta.toUpperCase(), b: names.tb.toUpperCase() }) : null;
  const ruleB: BurnRule | null = model?.rule ? { ...model.rule, binary: { onYes: null, onNo: model.rule.binary!.onYes } } : null;
  const b64u = (x: string) => btoa(unescape(encodeURIComponent(x))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  /** The generated receipt art for a rule not launched yet (coinArt.ts via /burnticker/img/preview.svg), never "NO IMAGE". */
  const art = (r: BurnRule | null, tk: string) => (r ? `/burnticker/img/preview.svg?r=${b64u(JSON.stringify(r))}&t=${encodeURIComponent(tk || "TICKER")}&l=${encodeURIComponent(ruleOneLiner(r).slice(0, 120))}` : "");
  // L13: the start boundary too, in UTC (the windows' clock) — the facts list above adds Denver time
  const ends = choice ? (() => { const s = tileSpec(choice).season; const start = new Date(`${s.start}T00:00:00Z`), end = new Date(Date.parse(`${s.start}T00:00:00Z`) + s.days * 86_400_000); const d = (x: Date) => x.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }); return `The windows run from ${d(start)} 00:00 UTC to ${d(end)} 00:00 UTC, which is ${s.days} daily windows. Then each coin's own burn pool burns down over 28 days and the coins retire.`; })() : null;

  // review N6: the venue this host uses for a pair (catalogue venues.pairCurve, passed down by the page). The venue is not shown before
  // launch (the owner's cut list); a 409 naming the other venue switches it and the build is retried once.
  const [venue, setVenue] = useState<PairVenue>(pairCurve ? "pair-curve" : "launchlab");
  useEffect(() => { setVenue(pairCurve ? "pair-curve" : "launchlab"); }, [pairCurve]);
  const [pcOut, setPcOut] = useState<{ pairId: string; pc: PairCurveLaunchBundle; keys: { a: string; b: string } | null; notes: string[] } | null>(null);
  const launch = async () => {
    if (!model?.rule || !creator || !reviewMatchesDraft(slot, curRev.current)) return;   // A6: only the reviewed draft is prepared
    setBusy(true); setErr(null); setOut(null); setPcOut(null);
    const body = { creator, ticker: names.ta.toUpperCase(), name: names.a, description: model.sentence, imageUrl: null, rule: model.rule, firstBuySol: "0", raiseSol, acknowledgements: { ruleLocked: true, noReturns: true }, ...profileBody(profA), pair: { ticker: names.tb.toUpperCase(), name: names.b, description: model.sentence, imageUrl: null, ...profileBody(profB) } };
    const run = async (v: PairVenue, retried: boolean): Promise<void> => {
      try {
        const j = await postPairLaunch((u, init) => fetch(u, init), body, v);
        if (j.venue === "pair-curve") setPcOut({ pairId: j.pair.pairId, pc: j.pairCurve, keys: j.mintSecretKeys, notes: j.pair.notes ?? [] });
        else setOut({ pairId: j.pair.pairId, a: j.bundles.a as Bundle, b: j.bundles.b as Bundle, notes: j.pair.notes ?? [] });
      } catch (e) { const nv = venueFrom409(e); if (nv && !retried) { setVenue(nv); return run(nv, true); } setErr(String((e as Error).message ?? e)); }
    };
    try { await run(venue, false); } finally { setBusy(false); }
  };

  // L06 / L13: the read-only review payload for the pair (the server's numbers), debounced; the pair's side B rule is derived at build
  // A6: keyed by the draft's revision (launchReviewSync.ts): a summary for an older pick or older names is never shown
  const [slot, setSlot] = useState<ReviewSlot<LaunchReview>>(EMPTY_REVIEW_SLOT);
  const reviewKey = draftRevision([model?.rule ?? null, names, profA.description, profB.description, raiseSol]);
  const curRev = useRef(reviewKey); curRev.current = reviewKey;
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
  // intent audit item 5: the two sides must be told apart (ticker and name, any case or spacing)
  const identity = pairIdentityProblems({ ticker: names.ta, name: names.a }, { ticker: names.tb, name: names.b });
  const ready = !!model?.rule && !model.problems.length && /^[A-Z0-9]{2,10}$/.test(names.ta) && /^[A-Z0-9]{2,10}$/.test(names.tb) && identity.length === 0 && !!names.a.trim() && !!names.b.trim();
  // website-19: the burn pattern (each day's winner, or once: the flippening) and the end, read from the rule
  const po = patternOptions({ follow: "coins", rule: model?.rule ?? null });
  const end = model?.rule ? endSentences(model.rule) : null;
  return (
    <section className="rounded-xl border border-amber-400/60 bg-neutral-900 p-4 space-y-4 sm:col-span-2" aria-label="Coin vs Coin">
      <div className="flex items-center justify-between"><h3 className="text-lg font-semibold">{flip ? "Flippening" : "Coin vs Coin"}</h3><span className="flex gap-3 text-xs"><a className="underline" href="/burnticker/derby">Burn Derby pairs and brackets →</a><button className="underline" data-nav onClick={() => setOpen(false)}>close</button></span></div>
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
          <p className="text-xs text-neutral-400" data-pattern-greyed>{po.options.filter((o) => !o.available).map((o) => `${o.label}: ${o.reason}`).join(" ")}</p>
          {end && <div className="space-y-0.5 text-xs text-neutral-300" data-end-sentences><p className="font-medium text-neutral-200">At the end</p>{end.sentences.map((x) => <p key={x}>{x}</p>)}</div>}
        </div>
      )}
      <p className="text-xs text-neutral-300" data-derby-explainer>The two coins you pick are <b>reference feeds</b>. Burnticker only reads their published feeds and never trades or burns them. Launching creates two <b>new</b> coins, and their own trading fees pay for their burns.</p>
      <div className="grid min-w-0 gap-3 md:grid-cols-2">
        <CoinPicker key={`a-${initial.a}`} initial={initial.a} label={flip ? "Reference coin A, the one that may pass the other" : "Reference coin A"} value={a} onPick={setA} exclude={b?.symbol ?? null} />
        <CoinPicker key={`b-${initial.b}`} initial={initial.b} label={flip ? "Reference coin B, the one that may be passed" : "Reference coin B"} value={b} onPick={setB} exclude={a?.symbol ?? null} />
      </div>
      {model && !out && !pcOut && (() => { const x = derbyExplainer(model.spec, { a: names.ta.toUpperCase(), b: names.tb.toUpperCase() }); return (
        <ul className="min-w-0 list-disc space-y-0.5 break-words pl-5 text-xs text-neutral-300" aria-label="What this creates" data-derby-facts>
          <li>{x.references}</li><li>{x.created}</li><li>{x.window}</li><li>{x.start}</li><li>{x.end}</li><li>{x.tie}</li><li>{x.missing}</li>
        </ul>
      ); })()}
      {model && !out && !pcOut && (
        <ReviewCard
          coins={[
            { key: "a", name: names.a, ticker: names.ta, onName: (v) => { setEdited(true); setNames((n) => ({ ...n, a: v })); }, onTicker: (v) => { setEdited(true); setNames((n) => ({ ...n, ta: v })); }, image: profA.image ? chosenPreview(profA)! : art(model.rule, names.ta), oneLiner: model.rule ? ruleOneLiner(model.rule) : "", oracle: "derby", badge: null },
            { key: "b", name: names.b, ticker: names.tb, onName: (v) => { setEdited(true); setNames((n) => ({ ...n, b: v })); }, onTicker: (v) => { setEdited(true); setNames((n) => ({ ...n, tb: v })); }, image: profB.image ? chosenPreview(profB)! : art(ruleB, names.tb), oneLiner: ruleB ? ruleOneLiner(ruleB) : "", oracle: "derby", badge: null },
          ]}
          sentence={model.sentence}
          pairLine={PAIR_REVIEW_LINE}
          pairFacts={winnerTakesBurnFacts(names.ta.toUpperCase() || "A", names.tb.toUpperCase() || "B")}
          ends={ends}
          shares={{ options: [...(flip ? SHARE_PRESETS.oneShot : SHARE_PRESETS.recurring)], value: fraction, onChange: setFraction }}
          raise={shown.review?.raise ? { options: [...RAISE_PRESETS_SOL], value: raiseSol, onChange: setRaiseSol, line: shown.review.raise.line } : null}
          graduation={shown.review?.graduation ?? null}
          image={<div className="grid min-w-0 gap-2 md:grid-cols-2" data-pair-images><ProfileFields value={profA} onChange={setProfA} part="image" who={`$${names.ta.toUpperCase() || "A"}`} customImages={customImages} /><ProfileFields value={profB} onChange={setProfB} part="image" who={`$${names.tb.toUpperCase() || "B"}`} customImages={customImages} pasteTarget={false} /></div>}
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
      {(pcOut || out) && <SignCard plan={pcOut ? pairCurvePlan(pcOut.pc, pcOut.keys, { a: names.ta.toUpperCase(), b: names.tb.toUpperCase() }) : launchlabPlan([out!.a, out!.b])} creator={creator || null} title={`Launch $${names.ta.toUpperCase()} and $${names.tb.toUpperCase()}`} coinHref={(t) => `/burnticker/t/${t}`} />}
      {(pcOut || out) && <p className="text-xs"><a className="underline" href={`/burnticker/p/${(pcOut ?? out)!.pairId}`}>Open the pair page →</a></p>}
    </section>
  );
}
