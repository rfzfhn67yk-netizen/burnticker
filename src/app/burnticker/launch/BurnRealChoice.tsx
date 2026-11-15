"use client";

import { useEffect } from "react";
import { targetActionSentence, targetChoiceLabel } from "@/lib/burnticker/burnTarget";
import { POOL_FIELD_LABEL, POOL_KIND_WORDS, REAL_OFF_LINE, admissionFrom, admissionKey, admissionUrl, checkingLine, noPoolLine, pickShapeProblems, poolFieldHelp, type RealPick, type SideReal } from "./burnReal";

/**
 * WEBSITE-24 (WIRING-ROUND5): one coin's "Burn the real <symbol>" choice. Default off (the coin burns itself). On: what one burn does
 * (targetActionSentence), the Raydium pool the creator names, and the admission verdict read from the network
 * (GET /api/burnticker/burn-target) in the library's own words. `picks` is one token (a Coin vs Coin side: its reference coin) or the
 * suggested tokens (a single coin). The parent hides this whole block until the launch state says the round-5 program is deployed.
 */
export function BurnRealChoice({ who, picks, value, onChange, network, locked = false, side }: { who: string; picks: readonly RealPick[]; value: SideReal; onChange: (v: SideReal) => void; network: string; locked?: boolean; side: string }) {
  const pick = value.pick;
  const key = pick ? admissionKey(pick, network) : "";
  const pool = pick?.pool.trim() ?? "";
  // the admission read, debounced, keyed by everything it checks; an answer for another key is dropped
  useEffect(() => {
    if (!value.on || !pick || !pool) return;
    if (value.admission && value.admission.key === key && !value.admission.busy) return;
    const shape = pickShapeProblems(pick);
    if (shape.length) { onChange({ ...value, admission: admissionFrom(key, pick.symbol, { ok: false, problems: ["The pool must be a Solana address."] }) }); return; }
    let live = true;
    onChange({ ...value, admission: { key, busy: true, ok: null, line: null, kind: null, error: null } });
    const t = setTimeout(() => {
      fetch(admissionUrl(pick, network)).then(async (r) => { const j = await r.json().catch(() => null); if (live) onChange({ ...value, admission: admissionFrom(key, pick.symbol, j, r.ok ? null : `HTTP ${r.status}`) }); })
        .catch((e) => { if (live) onChange({ ...value, admission: admissionFrom(key, pick.symbol, null, String((e as Error).message ?? e)) }); });
    }, 500);
    return () => { live = false; clearTimeout(t); };
  }, [value.on, key]); // eslint-disable-line react-hooks/exhaustive-deps
  const setPick = (p: RealPick | null) => onChange(p ? { on: true, pick: { ...p, pool: value.pick?.symbol === p.symbol ? value.pick.pool : p.pool }, admission: null } : { on: false, pick: value.pick, admission: null });
  const a = value.admission && value.admission.key === key ? value.admission : null;
  return (
    <div className="min-w-0 space-y-2 rounded-lg border border-neutral-800 p-3 text-sm" data-burn-real={side}>
      {picks.length === 1 ? (
        <label className="flex items-start gap-2">
          <input type="checkbox" className="mt-1" role="switch" aria-checked={value.on} checked={value.on} disabled={locked} data-decision="what" data-burn-real-toggle onChange={(e) => setPick(e.target.checked ? picks[0] : null)} />
          <span className="min-w-0"><span className="font-medium">{who}: {targetChoiceLabel(picks[0].symbol)}</span><span className="block text-xs text-neutral-400">{value.on ? targetActionSentence(picks[0].symbol) : REAL_OFF_LINE}</span></span>
        </label>
      ) : (
        <div role="radiogroup" aria-label={`What ${who} burns`} className="flex flex-wrap gap-2" data-burn-real-picks>
          {[null, ...picks].map((p) => {
            const on = p ? value.on && value.pick?.symbol === p.symbol : !value.on;
            return <button key={p?.symbol ?? "self"} type="button" role="radio" aria-checked={on} disabled={locked} data-decision="what" onClick={() => setPick(p)} className={`rounded-full border px-3 py-1 text-sm ${on ? "border-amber-400 bg-amber-400 text-neutral-950" : "border-neutral-700"}`}>{p ? targetChoiceLabel(p.symbol) : "Burn itself"}</button>;
          })}
          <p className="w-full text-xs text-neutral-400">{value.on && pick ? targetActionSentence(pick.symbol) : REAL_OFF_LINE}</p>
        </div>
      )}
      {value.on && pick && (
        <div className="min-w-0 space-y-1">
          <label className="block text-xs text-neutral-400">{POOL_FIELD_LABEL}
            <input className="mt-1 w-full min-w-0 rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 font-mono text-xs" value={pick.pool} disabled={locked} data-burn-real-pool spellCheck={false} autoComplete="off" placeholder="the pool's address" onChange={(e) => onChange({ on: true, pick: { ...pick, pool: e.target.value }, admission: null })} aria-describedby={`burn-real-help-${side}`} />
          </label>
          <p id={`burn-real-help-${side}`} className="text-[11px] text-neutral-500">{poolFieldHelp(pick.symbol)}</p>
          {!pool && <p className="text-xs text-amber-300" role="status">{noPoolLine(pick.symbol)}</p>}
          {pool && (!a || a.busy) && <p className="text-xs text-neutral-400" role="status">{checkingLine(pick.symbol)}</p>}
          {a && !a.busy && a.line && <p className={`break-words text-xs ${a.ok ? "text-emerald-300" : "text-amber-300"}`} role={a.ok ? "status" : "alert"} data-burn-real-verdict={a.ok ? "held" : "refused"}>{a.line}{a.ok && a.kind ? ` It is ${POOL_KIND_WORDS[a.kind]}.` : ""}</p>}
          {a && !a.busy && !a.line && a.error && <p className="break-words text-xs text-amber-300" role="status">The check could not be read just now. <span className="font-mono text-neutral-500">{a.error}</span></p>}
        </div>
      )}
    </div>
  );
}
