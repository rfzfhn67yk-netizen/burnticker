// Shared pieces for the Burnticker tests (2026-10-09): the four example selector rules from the owner's brief, the vault variant, a
// tier-2 Treasury rule, fixture loading, and the frozen "now". Not a test file itself.
import fs from "node:fs";
import path from "node:path";
import { BURNTICKER_RULES_SCHEMA } from "@/lib/burnticker/rules";

export const FIXTURES = path.resolve(import.meta.dirname, "../config/burnticker/fixtures");
export const fx = (f: string): unknown => JSON.parse(fs.readFileSync(path.join(FIXTURES, f), "utf8"));
/** Just after the fixtures were fetched. */
export const NOW = Date.parse("2026-10-10T02:00:00Z");

// "-DEN": Denver's OWN leg of each game. A bare "DEN" would also match the opponent's leg (the event ticker carries both teams), so
// one of the two would settle YES every game — the wizard's back-test lists the matched markets so a creator sees this before locking.
export const BRONCOS = { schema: BURNTICKER_RULES_SCHEMA, oracle: "kalshi", series: "KXNFLGAME", market: null, filter: { tickerIncludes: "-DEN" }, kind: "binary", binary: { onYes: { fractionOfPool: 0.02 }, onNo: null }, scalar: null, onVoid: "skip", floorUsd: "1", reserveSol: "0.02", vault: null };
export const DENVER_HIGH = { schema: BURNTICKER_RULES_SCHEMA, oracle: "kalshi", series: "KXHIGHDEN", market: null, filter: {}, kind: "scalar", scalar: { unit: 1, perUnit: { fractionOfPool: 0.01 }, baseline: 80, direction: "up" }, binary: null, onVoid: "skip", floorUsd: "1", reserveSol: "0.02", vault: null };
export const ONE_SHOT = { schema: BURNTICKER_RULES_SCHEMA, oracle: "kalshi", series: null, market: "KXNFLGAME-26OCT04DENSF-DEN", filter: {}, kind: "binary", binary: { onYes: { fractionOfPool: 0.10 }, onNo: null }, scalar: null, onVoid: "skip", floorUsd: "1", reserveSol: "0.02", vault: null };
export const SPX = { schema: BURNTICKER_RULES_SCHEMA, oracle: "kalshi", series: "KXINX", market: null, filter: { tickerIncludes: "H1600" }, kind: "scalar", scalar: { unit: 10, perUnit: { fractionOfPool: 0.01 }, baseline: "previousSettlement", direction: "up" }, binary: null, onVoid: "skip", floorUsd: "1", reserveSol: "0.02", vault: null };
export const VAULT_RULE = { ...BRONCOS, binary: { onYes: { tokens: 1000000 }, onNo: { tokens: 250000 } }, vault: { share: 0.25, vestDays: 365, cliffDays: 0 } };
/** Tier 2: the $DEFICIT rule as a Burnticker rule (every full $1B added, 5% of the pool per unit, carry fixed by the feed). */
export const DEBT_RULE = { schema: BURNTICKER_RULES_SCHEMA, oracle: "catalogue", series: "treasury.debt", market: null, filter: {}, kind: "scalar", scalar: { unit: 1e9, perUnit: { fractionOfPool: 0.05 }, baseline: "previousSettlement", direction: "up" }, binary: null, onVoid: "skip", floorUsd: "1", reserveSol: "0.02", vault: null };
