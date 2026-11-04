import { dayText } from "@/lib/burnticker/visitorTime";

/**
 * CH6-11 (sixth pass): A PENDING PAIR'S RECEIPT NOTE SAYS WHAT IS STILL CONDITIONAL. A settled-event pair (two teams in one game, two
 * candidates in one race) moves the loser's pool to the winner's burn only once both coins have a pool, and the pair is voided if they do
 * not by the pair's void date. The notes used to state the forward as certain ("$SEAWIN's pool … moves to $DENWIN's burn pool") with no
 * void date, and a losing coin's note began "no change: no burn; carry reset.", the counter's own wording, which reads as noise there.
 *
 * `pairForwardNote` writes the sentence (multiKeeper.planRace); `pendingPairNoteForDisplay` rewrites a note recorded before this fix
 * when its receipt is still pending (tokenPage.ts buildReceiptsJson), so live receipts read the same. Pure and client-safe.
 */
export interface PairNoteInput { role: "won" | "lost"; what: string; other: string; voidBy: string | null; pending: boolean }

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function pairForwardNote(i: PairNoteInput): string {
  const move = i.role === "won" ? `$${i.other}'s pool for this ${i.what} moves to this coin's burn pool, and both burn this coin.` : `this coin's pool for this ${i.what} moves to $${i.other}'s burn pool and burns $${i.other}.`;
  if (!i.pending) return i.role === "won" ? cap(move) : `${cap(move)} The winner takes the burn.`;
  const by = i.voidBy ? dayText(i.voidBy) ?? i.voidBy : null;
  return `If both coins have a pool${by ? ` by ${by}` : ""}, ${move} If not, the pair is voided and nothing burns for this ${i.what}.`;
}

/** The counter's "nothing happened" prefix, which a pair-loss note does not need ("no change: no burn; carry reset."). */
const COUNTER_PREFIX = /^(?:no change|moved [^:]*): no burn; carry reset\.\s*/;
const LOST_CERTAIN = /This coin's pool for the (\w+) moves to \$([A-Z0-9]+)'s burn pool and burns \$\2\. The winner takes the burn\./;
const WON_CERTAIN = /\$([A-Z0-9]+)'s pool for the (\w+) moves to this coin's burn pool, and both burn this coin\./;

/** A recorded note as a visitor reads it: unchanged unless its receipt still waits on the pair, then said as conditional. */
export function pendingPairNoteForDisplay(note: string | null, r: { status: string; pairRole?: string | null; voidBy: string | null }): string | null {
  if (!note || r.status !== "pending-pair" || /If both coins have a pool/.test(note)) return note;
  let out = r.pairRole === "lost" ? note.replace(COUNTER_PREFIX, "") : note;
  out = out.replace(LOST_CERTAIN, (_m, what: string, other: string) => pairForwardNote({ role: "lost", what, other, voidBy: r.voidBy, pending: true }));
  out = out.replace(WON_CERTAIN, (_m, other: string, what: string) => pairForwardNote({ role: "won", what, other, voidBy: r.voidBy, pending: true }));
  return out;
}
