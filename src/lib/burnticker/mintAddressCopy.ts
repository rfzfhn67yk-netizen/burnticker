import { matchesSuffix } from "@/lib/burnticker/mintSuffix";
import type { GrindSnapshot } from "@/lib/burnticker/vanityMint";

/**
 * The words around the burn-ending mint address (owner, 2026-10-14; vanityMint.ts). Plain English, lint clean
 * (test/burntickerVanityMint.test.ts). The owner's 10-14 note: people must see the search is alive, never frozen, so the progress line
 * carries a count, the seconds and how many searches run at once, and the page redraws it several times a second.
 *
 * Owner, 2026-10-14 evening ("the wait for the vanity address is a killer"): plain addresses are the default and the burn ending is a
 * switch on the review step, so the general line says a coin's address is a normal one unless its creator chose the burn ending, and a
 * coin page says its own address ends in burn only when it does. The skip button shows from the start of a search, not after a wait.
 */

export const MINT_SEARCH_LINE = "Finding an address that ends in burn. This usually takes under a minute.";
export const MINT_SEARCH_PAIR_LINE = "Finding two addresses that end in burn, one for each coin. This usually takes about a minute.";
export const MINT_SEARCH_DEVICE_LINE = "That is on a laptop. A phone can take a few minutes.";
export const MINT_SEARCH_PRIVATE_LINE = "The search runs in this browser, and the address key never leaves it.";
export const MINT_SKIP_LABEL = "Use a plain address instead";
export const MINT_SKIP_NOTE = "A plain address works the same way, but it does not end in burn.";
/** The review step's switch (owner's words), off by default and remembered in this browser. */
export const MINT_CHOICE_LABEL = "Give this coin an address that ends in burn (about a minute on a laptop; a pair takes longer)";
export const MINT_PLAIN_LINE = "This launch uses a plain address.";
export const MINT_FAILED_LINE = "This browser could not run the address search. You can launch with a plain address instead.";
/** The general line (the launch review, the sign card and a coin page whose address ends in burn). */
export const MINT_ADDRESS_NOTE = "A coin's address is a normal Solana address unless its creator chose one that ends in burn.";
/** The trust page's "How this was built" sentence. */
export const MINT_ADDRESS_TRUST = "A coin made here has a normal Solana address unless its creator chose one that ends in burn. That address is found in the creator's own browser, and its key never reaches this site.";

const n = (x: number) => Math.round(x).toLocaleString("en-US");

/** "Tried 1,234,567 addresses in 12 seconds, using 9 searches at once." */
export function mintSearchProgress(s: Pick<GrindSnapshot, "tries" | "elapsedMs" | "workers">): string {
  const sec = Math.floor(s.elapsedMs / 1000);
  return `Tried ${n(s.tries)} address${s.tries === 1 ? "" : "es"} in ${sec} second${sec === 1 ? "" : "s"}, using ${s.workers} search${s.workers === 1 ? "" : "es"} at once.`;
}

/** The found line: one address, or each side's. */
export function mintFoundLine(addresses: readonly string[]): string {
  if (!addresses.length) return "";
  return addresses.length === 1 ? `Found an address that ends in burn: ${addresses[0]}.` : `Found ${addresses.length} addresses that end in burn: ${addresses.join(" and ")}.`;
}

/** A coin page's line, only for a coin whose own mint ends in burn or BURN (never a plain one). */
export function coinAddressLine(mint: string): string | null {
  if (!matchesSuffix(mint)) return null;
  return `This coin's address ends in ${mint.slice(-4)}. ${MINT_ADDRESS_NOTE}`;
}

export interface MintSearchView {
  state: "idle" | "searching" | "found" | "plain" | "failed";
  lines: string[];
  /** the live counter line while searching */
  progress: string | null;
  showSkip: boolean;
}

/** What the search panel shows for a pool snapshot (MintSearch.tsx draws it; the tests read it). */
export function mintSearchView(s: GrindSnapshot): MintSearchView {
  const pair = s.wanted > 1;
  if (s.failed && s.found < s.wanted) return { state: "failed", lines: [MINT_FAILED_LINE], progress: null, showSkip: true };
  if (s.wanted > 0 && s.found >= s.wanted) return s.plain ? { state: "plain", lines: [MINT_PLAIN_LINE], progress: null, showSkip: false } : { state: "found", lines: [mintFoundLine(s.addresses)], progress: null, showSkip: false };
  if (!s.running) return { state: "idle", lines: [], progress: null, showSkip: false };
  return {
    state: "searching",
    lines: [pair ? MINT_SEARCH_PAIR_LINE : MINT_SEARCH_LINE, MINT_SEARCH_DEVICE_LINE, ...(pair && s.found ? [`${s.found} of ${s.wanted} found.`] : [])],
    progress: mintSearchProgress(s),
    showSkip: true,   // from the start (owner, 2026-10-14 evening): nobody has to wait to get out of the search
  };
}

/**
 * Shown under the Launch button from the press until the wallet opens (owner, 2026-10-14: "people need to know the coin is launching
 * while it builds so they don't exit out"). The prepare step pins the coin's art and rule on Arweave and runs the pre-launch check,
 * which can take up to a minute.
 */
export const LAUNCHING_NOTICE = "Your coin is being prepared: its art and rule are being pinned on Arweave and the pre-launch check is running. This can take up to a minute. Keep this tab open; your wallet opens when it is ready.";
