/**
 * A PLAN HELD IN THIS TAB (prelaunch audit 2026-10-18 A-12). A launch plan's mint keys live only in this tab's memory, so a reload between
 * the lock and the create drops them: the rule stays locked on a mint that is never created. The "earlier version" notice (VersionCheck)
 * used to invite exactly that reload on every window focus, and a closing wallet popup focuses the window. While a signing card holds a
 * plan with keys and steps still to send, the notice says to finish first and offers no reload, and leaving the page asks first
 * (beforeunload). Client-safe and pure apart from the module's own set of holds; the components subscribe.
 */
import type { SignPlan } from "@/lib/burnticker/signPlan";

const holds = new Set<string>();
const listeners = new Set<() => void>();

/** A signing card says whether it holds its plan (key: the plan's storage key). */
export function holdPlan(key: string, held: boolean): void {
  const had = holds.has(key);
  if (held) holds.add(key); else holds.delete(key);
  if (had !== held) for (const f of [...listeners]) f();
}
export const planIsHeld = (): boolean => holds.size > 0;
export function subscribePlanHold(f: () => void): () => void { listeners.add(f); return () => { listeners.delete(f); }; }

/** Whether a plan holds keys a reload would lose: some step is not sent yet, a mint key is in memory, and the plan is not abandoned. */
export function planHoldsKeys(plan: Pick<SignPlan, "steps" | "keys">, sentSteps: number, o: { abandoned?: boolean; finished?: boolean } = {}): boolean {
  if (o.abandoned || o.finished || sentSteps >= plan.steps.length) return false;
  return Object.values(plan.keys ?? {}).some((k) => typeof k === "string" && k.length > 0);
}

/** The notice while a plan is held: no reload offered. */
export const STALE_WHILE_SIGNING_LINE = "This site was updated while you were signing. Finish this launch first: reloading now would lose the keys for the steps not sent yet. Reload once the coin is recorded.";

/** What the version notice shows: the usual line with its Reload button, or, while a plan is held, the finish-first line without one. */
export function versionNotice(line: string | null, held: boolean): { text: string; reload: boolean } | null {
  if (!line) return null;
  return held ? { text: STALE_WHILE_SIGNING_LINE, reload: false } : { text: line, reload: true };
}

/** The beforeunload listener: asks the browser to confirm leaving while a plan is held. */
export function beforeUnloadGuard(isHeld: () => boolean): (e: { preventDefault(): void; returnValue?: unknown }) => void {
  return (e) => { if (!isHeld()) return; e.preventDefault(); e.returnValue = ""; };
}
