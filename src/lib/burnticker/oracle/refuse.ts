import fs from "node:fs";
import path from "node:path";

/**
 * WHAT WE REFUSE AT CREATE TIME (LAUNCHPAD-PATH §7; the owner, 2026-10-09: the list applies whatever the oracle — deaths, violence,
 * terror, casualty counts, named private individuals; elections are ALLOWED). The list is config, not code: config/burnticker/
 * refuse.json. Pure apart from `loadRefuseList`, which reads the one file.
 */

export interface RefusePattern { id: string; pattern: string; reason: string }
export interface RefuseList { schema: "burnticker.refuse/v1"; categories: string[]; titlePatterns: RefusePattern[]; namePatterns: RefusePattern[] }

export const REFUSE_FILE = path.join("config", "burnticker", "refuse.json");

export function parseRefuseList(raw: unknown): RefuseList {
  const r = raw as Partial<RefuseList> | null;
  if (!r || r.schema !== "burnticker.refuse/v1" || !Array.isArray(r.titlePatterns) || !Array.isArray(r.namePatterns) || !Array.isArray(r.categories)) throw new Error("refuse list: not a burnticker.refuse/v1 file");
  for (const p of [...r.titlePatterns, ...r.namePatterns]) { if (typeof p.pattern !== "string" || typeof p.id !== "string") throw new Error("refuse list: bad pattern"); new RegExp(p.pattern, "i"); }
  return r as RefuseList;
}

let cached: RefuseList | null = null;
export function loadRefuseList(file = REFUSE_FILE): RefuseList {
  if (cached && file === REFUSE_FILE) return cached;
  const l = parseRefuseList(JSON.parse(fs.readFileSync(file, "utf8")));
  if (file === REFUSE_FILE) cached = l;
  return l;
}

export interface Refusal { kind: "category" | "title" | "name"; id: string; reason: string; matched: string }

/** Refusals for a selection: the series/market/event titles and categories it binds to. Empty = admitted. */
export function refusalsFor(list: RefuseList, sel: { titles: readonly string[]; categories?: readonly string[] }): Refusal[] {
  const out: Refusal[] = [];
  for (const c of sel.categories ?? []) if (list.categories.includes(c)) out.push({ kind: "category", id: c, reason: `category "${c}" is refused`, matched: c });
  for (const t of sel.titles) for (const p of list.titlePatterns) { const m = new RegExp(p.pattern, "i").exec(t); if (m) out.push({ kind: "title", id: p.id, reason: p.reason, matched: `${t.slice(0, 80)} (matched "${m[0]}")` }); }
  return out;
}

/** Refusals for a token's name/ticker (impersonation of institutions and people is a separate, human-moderated list; this is the mechanical part). */
export function nameRefusals(list: RefuseList, name: string, ticker: string): Refusal[] {
  const out: Refusal[] = [];
  for (const p of list.namePatterns) for (const t of [name, ticker]) { const m = new RegExp(p.pattern, "i").exec(t); if (m) out.push({ kind: "name", id: p.id, reason: p.reason, matched: `${t} (matched "${m[0]}")` }); }
  return out;
}
