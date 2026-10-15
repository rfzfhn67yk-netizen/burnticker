"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { MintGrindPool, mintWorkerCount, readBurnChoice, writeBurnChoice, type ChoiceStorage, type WorkerLike } from "@/lib/burnticker/vanityMint";
import { MINT_ADDRESS_NOTE, MINT_CHOICE_LABEL, MINT_SEARCH_PRIVATE_LINE, MINT_SKIP_LABEL, MINT_SKIP_NOTE, mintSearchView } from "@/lib/burnticker/mintAddressCopy";

/**
 * The burn-ending switch (owner, 2026-10-14 evening: plain addresses by default, the burn ending opt-in). One value per tab, read from
 * and saved to localStorage, shared by the launch page, the Coin vs Coin tile and the record close. The server render reads it as off.
 */
const choiceStore = (): ChoiceStorage | null => { try { return typeof window === "undefined" ? null : window.localStorage; } catch { return null; } };
let burnChoice: boolean | null = null;
const choiceListeners = new Set<() => void>();
const getBurnChoice = () => (burnChoice ??= readBurnChoice(choiceStore()));
export function setBurnChoice(on: boolean): void {
  burnChoice = on; writeBurnChoice(choiceStore(), on);
  for (const f of choiceListeners) f();
}
/** True when this coin's address is to end in burn (the switch is on); false by default. */
export function useBurnChoice(): boolean {
  return useSyncExternalStore((f) => { choiceListeners.add(f); return () => { choiceListeners.delete(f); }; }, getBurnChoice, () => false);
}

/**
 * The review step's block above Launch: the switch, then (only when it is on) the search panel, then the general line. Turning it off
 * stops the search, and a press already waiting goes on with plain keys.
 */
export function MintChoice({ pool }: { pool: MintGrindPool | null }) {
  const burn = useBurnChoice();
  return (
    <div className="min-w-0 space-y-2" data-mint-choice={burn ? "burn" : "plain"}>
      <label className="flex items-start gap-2 text-xs text-neutral-300">
        <input type="checkbox" role="switch" aria-checked={burn} className="mt-0.5" data-mint-burn-switch checked={burn}
          onChange={(e) => { const on = e.target.checked; setBurnChoice(on); if (!on) pool?.optOut(); }} />
        <span className="min-w-0 break-words">{MINT_CHOICE_LABEL}</span>
      </label>
      {burn && <MintSearch pool={pool} />}
      <p className="min-w-0 break-words text-xs text-neutral-500" data-mint-note>{MINT_ADDRESS_NOTE}</p>
    </div>
  );
}

/**
 * The page's one address search (vanityMint.ts MintGrindPool): made in the browser only, its workers built from vanity.worker.ts, and
 * stopped when the page goes away. A browser without module workers makes the pool fail at start, and the panel offers the plain address.
 */
export function useMintPool(): MintGrindPool | null {
  const [pool, setPool] = useState<MintGrindPool | null>(null);
  useEffect(() => {
    // one pool per tab, shared by the launch page, the Coin vs Coin tile and the record close (one search, one bank of keys)
    if (!shared) shared = { users: 0, pool: new MintGrindPool({
      workers: mintWorkerCount(typeof navigator === "undefined" ? undefined : navigator.hardwareConcurrency),
      makeWorker: () => new Worker(new URL("./vanity.worker.ts", import.meta.url), { type: "module" }) as unknown as WorkerLike,
    }) };
    const s = shared;
    s.users++;
    setPool(s.pool);
    return () => { s.users--; if (s.users === 0) { s.pool.dispose(); if (shared === s) shared = null; } };
  }, []);
  return pool;
}
let shared: { pool: MintGrindPool; users: number } | null = null;

/**
 * The search panel (owner, 2026-10-14: "make sure people know it's working and not frozen"). While searching it redraws four times a
 * second: the plain line, a CSS spinner and a ticking receipt line, how many addresses were tried, the seconds, how many searches run
 * at once; and from the start the "Use a plain address instead" button. Once found it shows the
 * address. Only this panel re-renders on a tick, never the page.
 */
export function MintSearch({ pool }: { pool: MintGrindPool | null }) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!pool) return;
    const off = pool.subscribe(() => tick((x) => x + 1));
    const t = setInterval(() => { if (pool.running) tick((x) => x + 1); }, 250);
    return () => { off(); clearInterval(t); };
  }, [pool]);
  if (!pool) return null;
  const s = pool.snapshot(), v = mintSearchView(s);
  if (v.state === "idle") return null;
  return (
    <div className="min-w-0 rounded-lg border border-amber-400/40 p-3 text-xs" data-mint-search={v.state}>
      {v.state === "searching" && (
        <div className="flex items-start gap-3">
          <span aria-hidden className="mt-0.5 inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-amber-400 border-t-transparent" data-mint-spinner />
          <div className="min-w-0 space-y-1">
            {v.lines.map((x) => <p key={x} className="break-words text-neutral-200">{x}</p>)}
            <p className="font-mono tabular-nums text-amber-300" data-mint-tries={s.tries} data-mint-workers={s.workers}>{v.progress}</p>
            {/* the receipt line: a dot per quarter second, so the panel visibly moves even between counts */}
            <p aria-hidden className="overflow-hidden whitespace-nowrap font-mono text-neutral-500" data-mint-ticker>{"·".repeat(1 + (Math.floor(s.elapsedMs / 250) % 24))}</p>
            <p className="text-neutral-500">{MINT_SEARCH_PRIVATE_LINE}</p>
          </div>
        </div>
      )}
      {v.state !== "searching" && v.lines.map((x) => <p key={x} className="break-all text-neutral-200" role="status" data-mint-found={v.state}>{x}</p>)}
      {v.showSkip && (
        <p className="mt-2">
          <button type="button" data-mint-skip className="rounded border border-amber-400 px-3 py-1 text-amber-300" onClick={() => pool.skip()}>{MINT_SKIP_LABEL}</button>
          <span className="ml-2 text-neutral-500">{MINT_SKIP_NOTE}</span>
        </p>
      )}
    </div>
  );
}
