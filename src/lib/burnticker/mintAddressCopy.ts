import { matchesSuffix, SKIP_AFTER_MS } from "@/lib/burnticker/mintSuffix";
import type { GrindSnapshot } from "@/lib/burnticker/vanityMint";

/**
 * The words around the burn-ending mint address (owner, 2026-10-14; vanityMint.ts). Plain English, lint clean
 * (test/burntickerVanityMint.test.ts). The owner's 10-14 note: people must see the search is alive, never frozen, so the progress line
 * carries a count, the seconds and how many searches run at once, and the page redraws it several times a second.
 *
 * Honesty: coins created before 2026-10-14 ($DEFICIT, REHEARSAL, $PHINFLWIN) have plain addresses, and a creator may skip the search, so
 * the general line says coins made here GET such an address (the practice), the trust page dates it and names the skip, and a coin page
 * says its own address ends in burn only when it does.
 */

export const MINT_SEARCH_LINE = "Finding an address that ends in burn. This usually takes under a minute.";
export const MINT_SEARCH_PAIR_LINE = "Finding two addresses that end in burn, one for each coin. This usually takes about a minute.";
export const MINT_SEARCH_DEVICE_LINE = "That is on a laptop. A phone can take a few minutes.";
export const MINT_SEARCH_PRIVATE_LINE = "The search runs in this browser, and the address key never leaves it.";
export const MINT_SKIP_LABEL = "Use a plain address instead";
export const MINT_SKIP_NOTE = "Waiting is the default. A plain address works the same way, but it does not end in burn.";
export const MINT_PLAIN_LINE = "This launch uses a plain address.";
export const MINT_FAILED_LINE = "This browser could not run the address search. You can launch with a plain address instead.";
/** The general line (the launch review and the sign card). */
export const MINT_ADDRESS_NOTE = "Coins made here since October 14, 2026 get an address that ends in burn or BURN, unless the creator chooses a plain one.";
/** The trust page's "How this was built" sentence: dated, and the skip named. */
export const MINT_ADDRESS_TRUST = "Coins made here from October 14, 2026 get an address that ends in burn or BURN. The address is found in the creator's own browser, and its key never reaches this site. A creator who does not want to wait can choose a plain address instead.";

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

/** A coin page's line, only for a coin whose own mint ends in burn or BURN (never the coins made before 2026-10-14). */
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
    showSkip: s.elapsedMs >= SKIP_AFTER_MS,
  };
}

/**
 * Shown under the Launch button from the press until the wallet opens (owner, 2026-10-14: "people need to know the coin is launching
 * while it builds so they don't exit out"). The prepare step pins the coin's art and rule on Arweave and runs the pre-launch check,
 * which can take up to a minute.
 */
export const LAUNCHING_NOTICE = "Your coin is being prepared: its art and rule are being pinned on Arweave and the pre-launch check is running. This can take up to a minute. Keep this tab open; your wallet opens when it is ready.";
