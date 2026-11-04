import fs from "node:fs";
import path from "node:path";
import { QUEUE_FILE, readQueue, type QueuedPost } from "@/lib/launch/postQueue";

/**
 * THE OWNER'S POST-APPROVAL QUEUE (cheap-features pass item 9, owner 2026-10-13). The post generator (scripts/burnticker-posts.mts,
 * postQueue.ts) appends lint-checked posts to data/launch/post-queue.jsonl and never rewrites it. This module lists that queue for the
 * operator page and records "used" marks in a SEPARATE append-only file (data/launch/post-queue-used.jsonl), so the queue file itself is
 * never touched. Nothing here posts, signs in or opens a network connection: the owner copies a post, posts it by hand, and ticks it.
 * Operator only: the API routes check the operator's network and the ops PIN (opsAuth.ts) before calling anything here.
 */
export const USED_SCHEMA = "burnticker.post-queue-used/v1";
export const USED_FILE = path.join("data", "launch", "post-queue-used.jsonl");

export interface UsedMark { schema: typeof USED_SCHEMA; id: string; at: string; note: string }
export interface QueueItem { id: string; format: string; account: string; subject: string; posts: string[]; queuedAt: string; xLength: number[]; warnings: string[]; state: "waiting" | "used"; usedAt: string | null }
export interface QueueView { items: QueueItem[]; waiting: number; used: number; note: string }

export function readUsed(file: string = USED_FILE): UsedMark[] {
  if (!fs.existsSync(file)) return [];
  const out: UsedMark[] = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { const j = JSON.parse(line) as UsedMark; if (j.schema === USED_SCHEMA && typeof j.id === "string") out.push(j); } catch { /* a torn line is skipped, never rewritten */ }
  }
  return out;
}

/** The queue with each post's state, newest first; `state` filters (waiting / used / all). */
export function queueView(o: { queueFile?: string; usedFile?: string; state?: "waiting" | "used" | "all" } = {}): QueueView {
  const posts: QueuedPost[] = readQueue(o.queueFile ?? QUEUE_FILE);
  const used = new Map<string, string>();
  for (const m of readUsed(o.usedFile ?? USED_FILE)) if (!used.has(m.id)) used.set(m.id, m.at);
  const items: QueueItem[] = posts.map((p) => ({ id: p.id, format: p.format, account: p.account, subject: p.subject, posts: p.posts, queuedAt: p.queuedAt, xLength: p.xLength, warnings: p.warnings, state: used.has(p.id) ? "used" as const : "waiting" as const, usedAt: used.get(p.id) ?? null })).reverse();
  const want = o.state ?? "all";
  return {
    items: want === "all" ? items : items.filter((x) => x.state === want),
    waiting: items.filter((x) => x.state === "waiting").length, used: items.filter((x) => x.state === "used").length,
    note: "Nothing here posts. Copy a post, post it by hand if you choose, then mark it used. Marks are kept in their own file, and the queue itself is never changed.",
  };
}

/** Appends a "used" mark for a queued post. Unknown id: not found; already marked: recorded once, the first time kept. */
export function markUsed(id: string, o: { queueFile?: string; usedFile?: string; now?: number; note?: string } = {}): { ok: boolean; status: "marked" | "already" | "not-found"; at: string | null } {
  const file = o.usedFile ?? USED_FILE;
  if (!/^[0-9a-f]{16}$/.test(id) || !readQueue(o.queueFile ?? QUEUE_FILE).some((p) => p.id === id)) return { ok: false, status: "not-found", at: null };
  const prior = readUsed(file).find((m) => m.id === id);
  if (prior) return { ok: true, status: "already", at: prior.at };
  const mark: UsedMark = { schema: USED_SCHEMA, id, at: new Date(o.now ?? Date.now()).toISOString(), note: (o.note ?? "").replace(/[\r\n]+/g, " ").slice(0, 200) };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const before = fs.existsSync(file) ? fs.readFileSync(file) : Buffer.alloc(0);
  const lead = before.length && before[before.length - 1] !== 0x0a ? "\n" : "";
  fs.appendFileSync(file, `${lead}${JSON.stringify(mark)}\n`, { flag: "a" });
  return { ok: true, status: "marked", at: mark.at };
}
