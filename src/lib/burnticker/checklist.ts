/**
 * THE POST-LAUNCH CHECKLIST (cheap-features pass item 10, owner 2026-10-13): where one coin stands on its way to its first burn, as six
 * steps in order, and the one next action with who does it. For "Your coins" and the coin page; GET /v1/coins/{mint}/checklist answers
 * it from the coin's status record (tokenPage.ts) and its receipts and readings.
 *
 *   created         the launch transaction landed and the coin is registered here
 *   trading         the coin trades on its LaunchLab curve
 *   graduated       the curve reached its raise and the coin moved to its Raydium pool
 *   pool verified   that pool is registered with the burn program and verified (crank_buyback needs it)
 *   first reading   the source published a result after the coin's launch, and this site recorded it
 *   first burn      a confirmed burn
 *
 * A step this site could not read is `done: null`, never shown as done; a later step that is done proves the earlier ones (a confirmed
 * burn needs a verified pool, which needs a graduated curve). Pure and client-safe; readiness.ts says the same states as one line.
 */
export type ChecklistStepId = "created" | "trading" | "graduated" | "pool-verified" | "first-reading" | "first-burn";
export interface ChecklistStep { id: ChecklistStepId; label: string; done: boolean | null; detail: string }
export interface Checklist { ticker: string; mint: string; steps: ChecklistStep[]; next: { step: ChecklistStepId; action: string; who: string } | null; line: string }

export interface ChecklistInput {
  ticker: string; mint: string;
  /** registry status: draft, live, paused, retired, expired */ status: string;
  launched: boolean;
  /** the LaunchLab curve's phase, null when not read */ phase: "curve" | "migrating" | "graduated" | null;
  /** the burn program's pool flag, null when the program account was not read */ poolRegistered: boolean | null;
  readings: number; burns: number;
}

export const CHECKLIST_LABELS: Record<ChecklistStepId, string> = {
  created: "Created", trading: "Trading", graduated: "Graduated", "pool-verified": "Pool verified", "first-reading": "First reading", "first-burn": "First burn",
};
const NEXT: Record<ChecklistStepId, { action: string; who: string }> = {
  created: { action: "Sign the launch transaction in your wallet. The draft is kept for 24 hours.", who: "the creator" },
  trading: { action: "The launch has to land on chain before the coin trades. If it landed, confirm it on the launch page.", who: "the creator" },
  graduated: { action: "The curve completes when trading reaches its raise. Nobody can speed this up, and the creator does not need to do anything.", who: "traders on the curve" },
  "pool-verified": { action: "The keeper registers the new pool with the burn program, and the program verifies it. Anyone can send this step.", who: "the keeper" },
  "first-reading": { action: "The source publishes its next result, and the keeper reads it and signs it.", who: "the source, then the keeper" },
  "first-burn": { action: "The keeper runs the burn after a result the rule burns on is signed.", who: "the keeper" },
};

/** A later step of a coin that was never created. */
export const AFTER_CREATE = "This comes after the coin is created.";

/**
 * "Next: <action> This step is up to <who>." The who is its own sentence (launch night 2026-10-13: "(the creator)" was appended after the
 * action's last sentence, "The draft is kept for 24 hours (the creator).", so it read as part of that sentence). The checklist's own line
 * when nothing is next. Shared by the "Your coins" card and the coin page (LaunchChecklist.tsx).
 */
export const checklistNextLine = (a: { next: { action: string; who: string } | null; line: string }): string => (a.next ? `Next: ${a.next.action} This step is up to ${a.next.who}.` : a.line);

export function checklistOf(i: ChecklistInput): Checklist {
  const burned = i.burns > 0;
  const created = i.launched;
  const trading = created ? true : false;
  const pool: boolean | null = burned ? true : i.poolRegistered;
  const graduated: boolean | null = pool === true ? true : i.phase === "graduated" || i.phase === "migrating" ? true : i.phase === "curve" ? false : created ? null : false;
  const reading = i.readings > 0 || burned;
  // launch night 2026-10-13: a coin that was never created has no curve, pool or reading to describe; every later step waits for the
  // launch (a draft said "The curve has not reached its raise yet" and "could not read the burn program")
  const step = (id: ChecklistStepId, done: boolean | null, detail: string): ChecklistStep => (!created && id !== "created" && id !== "trading" ? { id, label: CHECKLIST_LABELS[id], done: false, detail: AFTER_CREATE } : { id, label: CHECKLIST_LABELS[id], done, detail });
  const steps: ChecklistStep[] = [
    step("created", created, created ? "The launch transaction landed and the coin is registered on this site." : i.status === "expired" ? "The draft expired before a launch transaction landed." : "The coin is a draft. Nothing is on chain yet."),
    step("trading", trading, trading ? "The coin trades on its LaunchLab curve, or on its pool after graduation." : "The coin trades once the launch lands."),
    step("graduated", graduated, graduated === true ? "The curve reached its raise and the coin moved to its Raydium pool." : graduated === false ? "The curve has not reached its raise yet. Trading fees collect in the burn pool." : "This site could not read the curve, so whether it has graduated is not known."),
    step("pool-verified", created ? pool : false, pool === true ? "The pool is registered with the burn program and verified." : pool === false ? "The pool is not registered with the burn program yet. Nothing can burn before it is." : "This site could not read the burn program, so the pool's registration is not known."),
    step("first-reading", reading, reading ? "A result from the source has been recorded since the launch." : "No result from the source has been recorded since the launch."),
    step("first-burn", burned, burned ? `The first burn is confirmed. ${i.burns} ${i.burns === 1 ? "burn is" : "burns are"} recorded.` : "No burn yet."),
  ];
  const first = steps.find((s) => s.done !== true) ?? null;
  const next = first && i.status !== "expired" && i.status !== "retired" ? { step: first.id, ...NEXT[first.id] } : null;
  const line = !first ? "Every step is done. Each new result is read, and each one the rule burns on is burned, by the keeper." : i.status === "expired" ? "This draft expired, so there is nothing more to do for it." : i.status === "retired" ? "This coin is retired, so no new step follows." : `Next: ${CHECKLIST_LABELS[first.id].toLowerCase()}. ${NEXT[first.id].action}`;
  return { ticker: i.ticker, mint: i.mint, steps, next, line };
}
