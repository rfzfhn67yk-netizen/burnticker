"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { POST_QUEUE_INTRO, POST_QUEUE_MARK, POST_QUEUE_PIN, POST_QUEUE_TITLE } from "../../_components/featureCopy";

/**
 * /burnticker/operator/post-queue (WEBSITE-26, WIRING-FEATURES item 9): the owner's post-approval queue, operator only. Reads
 * GET /api/burnticker/v1/ops/post-queue?state= with the operator PIN as `x-action-pin` (the route answers 403 off the operator network,
 * 401 for a wrong PIN, 503 when ops are off). Each post sits in a <pre> with a Copy button, its X length and its warnings; "Mark used"
 * sends POST /ops/post-queue/used { id } with the same PIN. Nothing posts automatically. The PIN is held in this component's state
 * only: never in storage or a cookie, and a reload forgets it.
 */
interface Item { id: string; format: string; account: string; subject: string; posts: string[]; xLength: number[]; warnings: string[]; state: "waiting" | "used"; usedAt: string | null }
interface View { items: Item[]; waiting: number; used: number; note: string }
type State = "waiting" | "used" | "all";

export default function PostQueuePage() {
  const [pin, setPin] = useState(""), [state, setState] = useState<State>("waiting");
  const [activePin, setActivePin] = useState("");
  const getActionPin = () => activePin;
  const [v, setV] = useState<View | null>(null), [err, setErr] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null), [marking, setMarking] = useState<string | null>(null);
  const load = useCallback(async (s: State, p: string) => {
    if (!p) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/burnticker/v1/ops/post-queue?state=${s}`, { headers: { "x-action-pin": p }, cache: "no-store" });
      const j = await r.json().catch(() => null);
      if (!r.ok) throw new Error(j?.error ?? `HTTP ${r.status}`);
      setV(j as View);
    } catch (e) { setV(null); setErr(String((e as Error).message ?? e)); } finally { setBusy(false); }
  }, []);
  useEffect(() => { void load(state, activePin); }, [state, activePin, load]);
  const setActionPin = (p: string) => setActivePin(p);
  const unlock = (e: FormEvent) => { e.preventDefault(); if (!pin.trim()) return; setActionPin(pin.trim()); setPin(""); };
  const copy = (k: string, t: string) => { navigator.clipboard?.writeText(t).then(() => { setCopied(k); setTimeout(() => setCopied(null), 1500); }).catch(() => setCopied(null)); };
  const markUsed = async (id: string) => {
    setMarking(id); setErr(null);
    try {
      const r = await fetch("/api/burnticker/v1/ops/post-queue/used", { method: "POST", headers: { "content-type": "application/json", "x-action-pin": getActionPin() }, body: JSON.stringify({ id }) });
      const j = await r.json().catch(() => null);
      if (!r.ok) throw new Error(j?.error ?? `HTTP ${r.status}`);
      await load(state, activePin);
    } catch (e) { setErr(String((e as Error).message ?? e)); } finally { setMarking(null); }
  };
  const card = "rounded-lg border border-neutral-800 bg-neutral-900 p-3";
  return (
    <main className="mx-auto max-w-4xl space-y-5 px-4 py-6 text-sm">
      <header className="space-y-1">
        <p className="text-xs"><Link className="underline" href="/burnticker/operator">← Operator</Link></p>
        <h1 className="text-2xl font-semibold">{POST_QUEUE_TITLE}</h1>
        <p className="text-neutral-400">{POST_QUEUE_INTRO}</p>
      </header>
      {!getActionPin() ? (
        <form className={card + " flex flex-wrap items-end gap-2"} onSubmit={unlock} data-post-queue-pin>
          <label className="text-xs text-neutral-400">{POST_QUEUE_PIN}<input type="password" autoComplete="off" className="mt-1 block w-40 rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm" value={pin} onChange={(e) => setPin(e.target.value)} aria-label={POST_QUEUE_PIN} /></label>
          <button type="submit" className="rounded border border-neutral-700 px-3 py-1 hover:border-amber-400">Open the queue</button>
          <p className="w-full text-xs text-neutral-500">The PIN stays in this tab&apos;s memory and is forgotten on reload.</p>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Which posts">
          {(["waiting", "used", "all"] as const).map((s) => <button key={s} type="button" role="radio" aria-checked={state === s} onClick={() => setState(s)} className={`rounded-full border px-3 py-1 text-xs ${state === s ? "border-amber-400 bg-amber-400 text-neutral-950" : "border-neutral-700"}`}>{s === "waiting" ? "Waiting" : s === "used" ? "Used" : "All"}</button>)}
          <button type="button" className="text-xs underline text-neutral-400" onClick={() => { setActionPin(""); setV(null); }}>Forget the PIN</button>
          {busy && <span className="text-xs text-neutral-500" role="status">Reading the queue.</span>}
        </div>
      )}
      {err && <p className="text-xs text-amber-300" role="alert" data-post-queue-error>{err}</p>}
      {v && (
        <>
          <p className="text-xs text-neutral-400">{`${v.waiting} waiting, ${v.used} used.`}</p>
          {v.items.length === 0 ? <p className="text-xs text-neutral-500">No posts here.</p> : (
            <ul className="space-y-3" data-post-queue-items>
              {v.items.map((it) => (
                <li key={it.id} className={card + " space-y-2"} data-post-item={it.state}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2"><span className="font-medium">{it.subject}</span><span className="text-xs text-neutral-500">{it.format}, {it.account}{it.usedAt ? `, used ${it.usedAt.slice(0, 16).replace("T", " ")} UTC` : ""}</span></div>
                  {it.posts.map((p, i) => (
                    <div key={i} className="min-w-0">
                      <div className="flex items-center justify-between gap-2 text-xs text-neutral-400"><span>{it.posts.length > 1 ? `Post ${i + 1} of ${it.posts.length}, ` : ""}{it.xLength[i] ?? p.length} characters on X</span><button type="button" className="bt-copy" onClick={() => copy(`${it.id}-${i}`, p)} aria-label={`Copy post ${i + 1} of ${it.subject}`}>{copied === `${it.id}-${i}` ? "copied" : "copy"}</button></div>
                      <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words rounded bg-neutral-950 p-2 text-xs text-neutral-200">{p}</pre>
                    </div>
                  ))}
                  {it.warnings.length > 0 && <ul className="list-disc pl-5 text-xs text-amber-300">{it.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
                  {it.state === "waiting" && <label className="flex items-center gap-2 text-xs"><input type="checkbox" disabled={marking === it.id} onChange={(e) => { if (e.target.checked) void markUsed(it.id); }} data-mark-used={it.id} />{POST_QUEUE_MARK}</label>}
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-neutral-500" data-post-queue-note>{v.note}</p>
        </>
      )}
    </main>
  );
}
