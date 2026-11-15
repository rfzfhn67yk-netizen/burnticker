import type { BurnRule } from "@/lib/burnticker/rules";
import { sha256HexWeb } from "@/lib/burnticker/derby/tile";

/**
 * THE PREPARED RULES, RE-CHECKED IN THE BROWSER BEFORE THE WALLET (WIRING-AUDIT12 P1-2). launchBundle.ts preparedRulesCheck is the
 * server's check; it locks rules with node:crypto, so the page cannot import it. This is the same comparison, client-safe: the review's
 * `prepared` sides against the bundles' own `rules.text` and `rules.sha256`. Side B's counterpart mint (made with the coins) and the void
 * date (read by the bundle route) are filled from the bundle before comparing; every other byte must match, and each fingerprint must be
 * the sha256 of its text. An empty list means the wallet is asked to sign exactly what the review showed.
 * test/burntickerWebsite27.test.ts pins it to preparedRulesCheck on the same inputs.
 */
export interface PreparedSideView { side: "A" | "B"; text: string; sha256: string; final: boolean; pending: string[] }
export interface PreparedView { final: boolean; label: "final" | "draft"; sides: PreparedSideView[]; pairId: string | null; voidBy: string | null; note: string }

/** The same spelling as rules.ts canonicalJson: keys sorted at every level, two-space indent, trailing newline. */
export function canonicalRuleJson(v: unknown): string {
  const sort = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(sort);
    if (x && typeof x === "object") return Object.fromEntries(Object.keys(x as object).sort().map((k) => [k, sort((x as Record<string, unknown>)[k])]));
    return x;
  };
  return `${JSON.stringify(sort(v), null, 2)}\n`;
}

export const ruleChangedLine = (side: "A" | "B"): string => `Coin ${side}'s rule changed after the review. Check the review again before signing.`;
export const sideMissingLine = (side: "A" | "B"): string => `Coin ${side} is missing from the prepared launch. Check the review again before signing.`;

export async function preparedRulesCheckWeb(prepared: { sides: readonly PreparedSideView[] }, built: { a: { text: string; sha256: string; mint: string }; b?: { text: string; sha256: string } | null }, sha: (s: string) => Promise<string> = sha256HexWeb): Promise<string[]> {
  const out: string[] = [];
  for (const p of prepared.sides) {
    const got = p.side === "A" ? built.a : built.b ?? null;
    if (!got) { out.push(sideMissingLine(p.side)); continue; }
    let want = p.text;
    try {
      if (p.pending.includes("pair.counterpartMint")) { const r = JSON.parse(want) as BurnRule; want = canonicalRuleJson({ ...r, pair: { ...r.pair!, counterpartMint: built.a.mint } }); }
      if (p.pending.includes("pair.voidBy")) { const w = JSON.parse(want) as BurnRule, g = JSON.parse(got.text) as BurnRule; want = canonicalRuleJson({ ...w, pair: { ...w.pair!, voidBy: g.pair?.voidBy ?? w.pair?.voidBy } }); }
    } catch { out.push(ruleChangedLine(p.side)); continue; }
    if (want !== got.text || (await sha(got.text)) !== got.sha256) out.push(ruleChangedLine(p.side));
  }
  return out;
}

/** WIRING-AUDIT12 P1-2: how a pending field of a draft rule is said beside its text. */
export const PENDING_FIELD_WORDS: Readonly<Record<string, string>> = {
  "pair.counterpartMint": "Coin A's address, made when the coins are created.",
  "pair.voidBy": "The market's end date, read when the launch is prepared.",
};
export const pendingWords = (pending: readonly string[]): string[] => pending.map((k) => PENDING_FIELD_WORDS[k] ?? k);
/** No prepared block on the review (an older server): the wallet stays closed rather than signing an unchecked rule. */
export const PREPARED_MISSING_LINE = "The review did not include the prepared rules, so your wallet was not opened. Check the review again before signing.";
