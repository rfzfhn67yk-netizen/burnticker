#!/usr/bin/env node
// A GAME COIN HELD BY A DISAGREEMENT (review of b3249737 item 6; docs/burnticker/runbook.md "A game coin held by a disagreement"). The
// keeper keeps each single-game coin's first-read record in the status table (games.firstReads; gameSettle.ts gameSchedule). A record
// with `disputed` set holds the burn until every disputing source reads again and agrees. When a source never will (a market settled the
// wrong way, a feed that keeps a wrong final), the operator reads every source by hand and releases the hold here, never by editing the
// table. Dry run unless --apply.
//
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/alias-hook.mjs scripts/burnticker-game-hold.mts --show [--db data/burnticker.db]
//   ... scripts/burnticker-game-hold.mts --release <league:eventId> --side home|away|tie --note "what was read by hand" [--ignore "<source>"]... [--apply]
//
// --release drops the remembered reads that name another winner, clears the dispute (or contradiction) and starts the 12 hours again
// from now on that result (gameSettle.ts releaseDispute). A source that still reads the other result on the next cycle disputes it again,
// unless it is named with --ignore (repeatable; the source name as --show prints it, e.g. "on-chain payout"): an ignored source is saved
// on the record and its reads are not counted for that game while the record lasts. Use it for a source that will never agree, such as
// a market already settled on chain. Stop the keeper
// first (data/PAUSE-burnticker holds cranks only; reads go on and write this record); the write is refused if the record changed meanwhile.
import fs from "node:fs";
import { openRegistry, REGISTRY_FILE } from "@/lib/burnticker/registry";
import { FIRST_READ_STATUS_KEY, GAME_BURN_DELAY_MS, isFirstRead, releaseDispute, type FirstRead } from "@/lib/burnticker/sources/gameSettle";

const args = process.argv.slice(2);
const arg = (k: string): string | null => { const i = args.indexOf(k); return i >= 0 && i + 1 < args.length ? args[i + 1] : null; };
const db = arg("--db") ?? REGISTRY_FILE;
if (!fs.existsSync(db)) { console.error(`no registry at ${db}`); process.exit(2); }
const reg = openRegistry(db);
const all = (): Record<string, FirstRead> => { try { const v = JSON.parse(reg.getStatus(FIRST_READ_STATUS_KEY) ?? "{}") as Record<string, unknown>; return Object.fromEntries(Object.entries(v).filter(([, m]) => isFirstRead(m))) as Record<string, FirstRead>; } catch { return {}; } };
const iso = (t: number) => new Date(t).toISOString();

if (args.includes("--show")) {
  for (const [k, m] of Object.entries(all())) console.log(JSON.stringify({ key: k, state: m.disputed?.length ? "HELD (disagreement)" : m.contradiction ? "HELD (contradiction)" : "waiting or done", firstReadAt: iso(m.firstReadAt), dueAt: iso(m.firstReadAt + GAME_BURN_DELAY_MS), by: m.by, winner: m.winner, score: m.home === null ? null : `${m.away}-${m.home} (away-home)`, ops: m.ops, reads: m.reads ?? {}, disputed: m.disputed ?? null, contradiction: m.contradiction ?? null, ignored: m.ignored ?? null, release: m.release ?? null }));
  process.exit(0);
}
const ignore = args.flatMap((a, i) => (a === "--ignore" && i + 1 < args.length ? [args[i + 1].trim()] : [])).filter(Boolean);
const key = arg("--release"), side = arg("--side"), note = (arg("--note") ?? "").trim(), apply = args.includes("--apply");
if (!key || (side !== "home" && side !== "away" && side !== "tie") || !note) { console.error("usage: --show | --release <league:eventId> --side home|away|tie --note \"why\" [--ignore \"source\"]... [--apply] [--db file]"); process.exit(2); }
const recs = all(), m = recs[key];
if (!m) { console.error(`no first-read record for ${key} (--show lists them)`); process.exit(1); }
const now = Date.now();
const r = releaseDispute(m, side, note, now, ignore);
if (!r.ok) { console.error(r.why); process.exit(1); }
console.log(JSON.stringify({ key, dropped: r.dropped, before: { winner: m.winner, disputed: m.disputed, contradiction: m.contradiction ?? null }, after: { winner: r.next.winner, ignored: r.next.ignored ?? null, firstReadAt: iso(r.next.firstReadAt), dueAt: iso(r.next.firstReadAt + GAME_BURN_DELAY_MS), reads: r.next.reads }, applied: apply }));
if (!apply) { console.log("dry run: run again with --apply"); process.exit(0); }
// re-read just before the write: a record that changed since (a keeper cycle) is refused
const fresh = all()[key];
if (JSON.stringify(fresh) !== JSON.stringify(m)) { console.error("the record changed while this ran (stop the keeper and try again)"); process.exit(1); }
reg.setStatus(FIRST_READ_STATUS_KEY, { ...all(), [key]: r.next }, now);
console.log(`released ${key}: due ${iso(r.next.firstReadAt + GAME_BURN_DELAY_MS)}`);
