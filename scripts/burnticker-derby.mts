// BURN DERBY BRACKETS (2026-10-10): register a tournament in the registry (locked by hash), show its state, print a fan coin's rule.
// Fan coins launch through the normal pipeline (the wizard or POST /v1/launch/bundle), so admission and the creation preflight apply.
// Reads no key and sends nothing.
//
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/alias-hook.mjs scripts/burnticker-derby.mts create <tournament.json>
//   … show <tournament id>          the bracket as GET /v1/derby/{id} returns it
//   … fan-rule <tournament id> <slot>  the rule JSON a fan coin of that slot launches with
import fs from "node:fs";
import { openRegistry, REGISTRY_FILE } from "../src/lib/burnticker/registry.ts";
import { derbyStore } from "../src/lib/burnticker/derby/store.ts";
import { bracketFanRule, registerTournament, type Tournament } from "../src/lib/burnticker/derby/bracket.ts";
import { derbyTournamentJson } from "../src/lib/burnticker/derby/page.ts";
import { rulesSha256 } from "../src/lib/burnKeeper/rules.ts";
import { lockRule } from "../src/lib/burnticker/rules.ts";

const [cmd, a1, a2] = process.argv.slice(2);
const registry = openRegistry(process.env.BURNTICKER_DB?.trim() || REGISTRY_FILE);
const store = derbyStore(registry.db);
try {
  if (cmd === "create" && a1) {
    const r = registerTournament(store, JSON.parse(fs.readFileSync(a1, "utf8")), rulesSha256);
    console.log(`registered ${r.tournament.id} (${r.tournament.underlyings.length} coins, rounds of ${r.tournament.roundDays} days from ${r.tournament.start}) sha256 ${r.sha256}`);
  } else if (cmd === "show" && a1) {
    const row = store.tournament(a1);
    if (!row) throw new Error(`no tournament ${a1}`);
    console.log(JSON.stringify(derbyTournamentJson(registry, JSON.parse(row.json) as Tournament, row.sha256), null, 2));
  } else if (cmd === "fan-rule" && a1 && a2 !== undefined) {
    const row = store.tournament(a1);
    if (!row) throw new Error(`no tournament ${a1}`);
    process.stdout.write(lockRule(bracketFanRule(JSON.parse(row.json) as Tournament, row.sha256, Number(a2))).text);
  } else { console.log("usage: create <tournament.json> | show <id> | fan-rule <id> <slot>"); process.exitCode = 2; }
} catch (e) { console.error((e as Error).message); process.exitCode = 1; } finally { registry.close(); }
